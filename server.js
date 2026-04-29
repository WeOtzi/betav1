// ============================================
// WE ÖTZI - UNIFIED SERVER
// Express server for local development
// ============================================

// Load environment variables from .env file
try { require('dotenv').config(); } catch (e) { /* dotenv not installed, using system env */ }

const express = require('express');
const path = require('path');
const { Readable } = require('stream');
const archiver = require('archiver');
const fs = require('fs-extra');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 4545;
let googleApiModule = null;

function getGoogleApisModule() {
    if (!googleApiModule) {
        // Lazy-load to avoid blocking server boot on heavy module initialization.
        googleApiModule = require('googleapis');
    }
    return googleApiModule;
}

// ============================================
// STABILITY & ERROR HANDLING
// ============================================

// Global error handlers to prevent silent crashes
process.on('uncaughtException', (err) => {
    console.error(' [CRITICAL] Uncaught Exception:', err.message);
    console.error(err.stack);
    // Give PM2 a chance to restart the process cleanly
    setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(' [CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Memory monitoring
setInterval(() => {
    const used = process.memoryUsage();
    if (used.heapUsed > 250 * 1024 * 1024) { // 250MB
        console.warn(` [WARN] High memory usage: ${Math.round(used.heapUsed / 1024 / 1024)}MB. Triggering manual GC if available.`);
        if (global.gc) {
            global.gc();
        }
    }
}, 30000);

// ============================================
// SECURITY MIDDLEWARE
// ============================================

// Helmet: Security headers
app.use(helmet({
    contentSecurityPolicy: false, // Disabled — app uses inline scripts and CDN resources
    crossOriginEmbedderPolicy: false
}));

// CORS: Restrict origins
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:4545')
    .split(',')
    .map(o => o.trim());

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (server-to-server, curl, mobile apps)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));

// Rate limiting: General API endpoints
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please try again later.' }
});

// Rate limiting: Sensitive endpoints (auth, password)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many authentication attempts, please try again later.' }
});

// Apply rate limits
app.use('/api/', apiLimiter);
app.use('/api/admin/update-user-password', authLimiter);
app.use('/api/auth/reset-temp-password', authLimiter);

// Middleware for JSON body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============================================
// GEMINI API INTEGRATION
// ============================================

/**
 * Generate image using Gemini API
 * POST /api/gemini/generate-image
 * Body: { prompt, model, aspectRatio, imageSize }
 * API key read from process.env (NEVER from frontend)
 */
app.post('/api/gemini/generate-image', async (req, res) => {
    const {
        prompt,
        model,
        aspectRatio,
        imageSize,
        temperature,
        maxOutputTokens,
        safetySettings
    } = req.body;

    const apiKey = process.env.GEMINI_API_KEY;

    if (!prompt) {
        return res.status(400).json({ success: false, error: 'Prompt is required' });
    }

    if (!apiKey) {
        return res.status(500).json({ success: false, error: 'Server missing GEMINI_API_KEY environment variable' });
    }

    try {
        const targetModel = model || 'gemini-3-pro-image-preview';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

        // Note: maxOutputTokens should NOT be set for image generation
        // Images are returned as base64 which requires many tokens
        // Setting a low limit causes finishReason: MAX_TOKENS with empty content
        const requestBody = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                responseModalities: ["IMAGE"],
                temperature: temperature !== undefined ? temperature : 0.7,
                // Removed maxOutputTokens - not applicable for image generation
                imageConfig: {
                    aspectRatio: aspectRatio || "1:1",
                    imageSize: imageSize || "1K" // "1K", "2K", "4K" allowed for Gemini 3 Pro
                }
            }
        };

        // Add safety settings if provided
        if (safetySettings) {
            requestBody.safetySettings = safetySettings;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error?.message || 'Failed to generate image');
        }

        // Extract image data
        // Response format: candidates[0].content.parts[0].inlineData.data (base64)
        const candidates = data.candidates;
        if (!candidates || candidates.length === 0) {
            throw new Error('No image candidates returned');
        }

        // Handle case where parts might be undefined (API returned different structure)
        if (!candidates[0].content?.parts) {
            throw new Error('API response missing image parts. The model may not support image generation or returned text instead.');
        }

        const part = candidates[0].content.parts.find(p => p.inlineData);
        if (!part) {
            throw new Error('No image data found in response');
        }

        const base64Image = part.inlineData.data;
        const mimeType = part.inlineData.mimeType;

        return res.json({
            success: true,
            image: `data:${mimeType};base64,${base64Image}`
        });

    } catch (error) {
        console.error('Gemini API Error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// GOOGLE DRIVE API INTEGRATION
// ============================================

/**
 * Get authenticated Google Drive client from provided credentials
 * @param {Object} credentials - Service account credentials object
 * @returns {Object|null} Google Drive client or null if failed
 */
function getGoogleDriveClient(credentials) {
    try {
        if (!credentials) {
            console.error('No credentials provided');
            return null;
        }
        
        // Validate required fields
        if (!credentials.client_email || !credentials.private_key) {
            console.error('Invalid credentials: missing client_email or private_key');
            return null;
        }

        const { google } = getGoogleApisModule();
        
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive']
        });
        
        return google.drive({ version: 'v3', auth });
    } catch (error) {
        console.error('Error initializing Google Drive client:', error.message);
        return null;
    }
}

/**
 * Test Google Drive API connection
 * POST /api/google-drive/test
 * Body: { folderId, credentials }
 */
app.post('/api/google-drive/test', async (req, res) => {
    const { folderId, credentials } = req.body;
    
    if (!folderId) {
        return res.status(400).json({ success: false, error: 'Folder ID is required' });
    }
    
    if (!credentials) {
        return res.status(400).json({ success: false, error: 'Service account credentials are required' });
    }
    
    const drive = getGoogleDriveClient(credentials);
    
    if (!drive) {
        return res.status(500).json({ 
            success: false, 
            error: 'Failed to initialize Google Drive client. Check credentials format.' 
        });
    }
    
    try {
        // Try to get folder metadata to verify access
        // supportsAllDrives is required for Shared Drives
        const response = await drive.files.get({
            fileId: folderId,
            fields: 'id, name, mimeType, webViewLink, driveId',
            supportsAllDrives: true
        });
        
        if (response.data.mimeType !== 'application/vnd.google-apps.folder') {
            return res.status(400).json({ 
                success: false, 
                error: 'The provided ID is not a folder' 
            });
        }
        
        return res.json({
            success: true,
            folderName: response.data.name,
            folderId: response.data.id,
            webViewLink: response.data.webViewLink
        });
    } catch (error) {
        console.error('Google Drive test error:', error.message);
        
        let errorMessage = 'Failed to access folder';
        if (error.code === 404) {
            errorMessage = 'Carpeta no encontrada. Asegurate que la carpeta existe y esta compartida con el email de la cuenta de servicio.';
        } else if (error.code === 403) {
            errorMessage = 'Acceso denegado. Comparte la carpeta con el email de la cuenta de servicio (permisos de Editor).';
        } else if (error.message.includes('invalid_grant')) {
            errorMessage = 'Credenciales invalidas. Verifica que el JSON de la cuenta de servicio sea correcto.';
        }
        
        return res.status(error.code || 500).json({ 
            success: false, 
            error: errorMessage 
        });
    }
});

/**
 * Create a quote folder and upload images
 * POST /api/google-drive/create-quote-folder
 * Body: { quoteId, quoteNumber, mainFolderId, credentials, files: [{ url, fileName, mimeType }] }
 */
app.post('/api/google-drive/create-quote-folder', async (req, res) => {
    const { quoteId, quoteNumber, mainFolderId, credentials, files } = req.body;
    
    console.log(`[DEBUG] ====== CREATE QUOTE FOLDER REQUEST ======`);
    console.log(`[DEBUG] quoteNumber: ${quoteNumber}`);
    console.log(`[DEBUG] mainFolderId: "${mainFolderId}"`);
    console.log(`[DEBUG] mainFolderId length: ${mainFolderId?.length}`);
    console.log(`[DEBUG] files count: ${files?.length}`);
    console.log(`[DEBUG] ===========================================`);
    
    console.log(`[Google Drive] Creating folder for quote: ${quoteNumber}`);
    console.log(`[Google Drive] Files to upload: ${files ? files.length : 0}`);
    
    if (!quoteNumber || !mainFolderId) {
        return res.status(400).json({ 
            success: false, 
            error: 'Quote number and main folder ID are required' 
        });
    }
    
    if (!credentials) {
        return res.status(400).json({ 
            success: false, 
            error: 'Service account credentials are required' 
        });
    }
    
    const drive = getGoogleDriveClient(credentials);
    
    if (!drive) {
        return res.status(500).json({ 
            success: false, 
            error: 'Failed to initialize Google Drive client' 
        });
    }
    
    try {
        // Step 1: Check if folder already exists for this quote
        const existingFolder = await findExistingQuoteFolder(drive, mainFolderId, quoteNumber);
        
        let quoteFolderId;
        let quoteFolderLink;
        
        if (existingFolder) {
            // Use existing folder
            quoteFolderId = existingFolder.id;
            quoteFolderLink = existingFolder.webViewLink;
            console.log(`[Google Drive] Using existing folder for quote ${quoteNumber}: ${quoteFolderId}`);
        } else {
            // Step 2: Create new folder for this quote
            const folderMetadata = {
                name: quoteNumber,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [mainFolderId]
            };
            
            const folder = await drive.files.create({
                resource: folderMetadata,
                fields: 'id, webViewLink',
                supportsAllDrives: true
            });
            
            quoteFolderId = folder.data.id;
            quoteFolderLink = folder.data.webViewLink;
            console.log(`[Google Drive] Created new folder for quote ${quoteNumber}: ${quoteFolderId}`);
        }
        
        // Step 3: Upload files to the quote folder
        const uploadedFiles = [];
        const uploadErrors = [];
        
        if (files && files.length > 0) {
            console.log(`[Google Drive] Starting upload of ${files.length} files...`);
            
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                console.log(`[Google Drive] Uploading file ${i + 1}/${files.length}: ${file.fileName}`);
                console.log(`[Google Drive] Source URL: ${file.url}`);
                
                try {
                    const uploadResult = await uploadFileToFolder(drive, quoteFolderId, file);
                    if (uploadResult) {
                        uploadedFiles.push(uploadResult);
                        console.log(`[Google Drive] Successfully uploaded: ${file.fileName}`);
                    }
                } catch (uploadError) {
                    const errorDetail = {
                        fileName: file.fileName,
                        error: uploadError.message,
                        url: file.url
                    };
                    uploadErrors.push(errorDetail);
                    console.error(`[Google Drive] Failed to upload ${file.fileName}:`, uploadError.message);
                }
            }
            
            console.log(`[Google Drive] Upload complete: ${uploadedFiles.length}/${files.length} files successful`);
        }
        
        // Determine overall success - folder created is minimum success
        // But warn if files failed to upload
        const hasUploadErrors = uploadErrors.length > 0;
        const allFilesFailed = files && files.length > 0 && uploadedFiles.length === 0;
        
        return res.json({
            success: true, // Folder was created successfully
            quoteFolderId,
            quoteFolderLink,
            uploadedCount: uploadedFiles.length,
            uploadedFiles,
            // Include error details so frontend can handle appropriately
            uploadErrors: hasUploadErrors ? uploadErrors : undefined,
            warning: allFilesFailed ? 'All files failed to upload to Google Drive' : undefined,
            partialSuccess: hasUploadErrors && uploadedFiles.length > 0
        });
        
    } catch (error) {
        console.error('[Google Drive] Error creating quote folder:', error.message);
        return res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * Find existing folder for a quote number
 */
async function findExistingQuoteFolder(drive, parentId, quoteNumber) {
    try {
        const response = await drive.files.list({
            q: `'${parentId}' in parents and name = '${quoteNumber}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name, webViewLink)',
            pageSize: 1,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });
        
        return response.data.files.length > 0 ? response.data.files[0] : null;
    } catch (error) {
        console.error('Error finding existing folder:', error.message);
        return null;
    }
}

/**
 * Upload a file to a Google Drive folder
 * @param {Object} drive - Google Drive client
 * @param {string} folderId - Target folder ID
 * @param {Object} file - File info { url, fileName, mimeType }
 */
async function uploadFileToFolder(drive, folderId, file) {
    const startTime = Date.now();
    
    try {
        // Validate file URL
        if (!file.url) {
            throw new Error('File URL is missing or empty');
        }
        
        console.log(`[Upload] Fetching file from: ${file.url}`);
        
        // Download file from URL (Supabase storage) with timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        let response;
        try {
            response = await fetch(file.url, { 
                signal: controller.signal,
                headers: {
                    'User-Agent': 'WeOtzi-Server/1.0'
                }
            });
        } finally {
            clearTimeout(timeout);
        }
        
        console.log(`[Upload] Fetch response status: ${response.status} ${response.statusText}`);
        console.log(`[Upload] Content-Type: ${response.headers.get('content-type')}`);
        console.log(`[Upload] Content-Length: ${response.headers.get('content-length')}`);
        
        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'Unable to read error body');
            throw new Error(`Failed to download file: HTTP ${response.status} ${response.statusText}. Body: ${errorBody.substring(0, 200)}`);
        }
        
        const buffer = Buffer.from(await response.arrayBuffer());
        console.log(`[Upload] Downloaded ${buffer.length} bytes in ${Date.now() - startTime}ms`);
        
        if (buffer.length === 0) {
            throw new Error('Downloaded file is empty (0 bytes)');
        }
        
        // Create readable stream from buffer
        const stream = new Readable();
        stream.push(buffer);
        stream.push(null);
        
        // Upload to Google Drive
        const fileMetadata = {
            name: file.fileName || `reference_${Date.now()}.jpg`,
            parents: [folderId]
        };
        
        const media = {
            mimeType: file.mimeType || 'image/jpeg',
            body: stream
        };
        
        console.log(`[Upload] Uploading to Google Drive: ${fileMetadata.name} (${buffer.length} bytes, ${media.mimeType})`);
        
        const uploadResponse = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id, name, webViewLink, webContentLink',
            supportsAllDrives: true
        });
        
        const totalTime = Date.now() - startTime;
        console.log(`[Upload] Successfully uploaded: ${uploadResponse.data.name} (${totalTime}ms total)`);
        
        return {
            id: uploadResponse.data.id,
            name: uploadResponse.data.name,
            webViewLink: uploadResponse.data.webViewLink,
            webContentLink: uploadResponse.data.webContentLink
        };
    } catch (error) {
        const totalTime = Date.now() - startTime;
        
        // Provide detailed error information
        if (error.name === 'AbortError') {
            console.error(`[Upload] TIMEOUT after ${totalTime}ms fetching: ${file.url}`);
            throw new Error(`Fetch timeout after 30 seconds for ${file.fileName}`);
        }
        
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            console.error(`[Upload] NETWORK ERROR (${error.code}): Cannot reach ${file.url}`);
            throw new Error(`Network error (${error.code}): Cannot reach Supabase storage`);
        }
        
        console.error(`[Upload] ERROR after ${totalTime}ms:`, error.message);
        console.error(`[Upload] Error stack:`, error.stack);
        throw error;
    }
}

// ============================================
// CLIENT INFO & SESSION LOGGING
// ============================================

/**
 * Get client information including IP address
 * GET /api/client-info
 */
app.get('/api/client-info', (req, res) => {
    // Get IP from various headers (supports proxies)
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
               req.headers['x-real-ip'] ||
               req.connection?.remoteAddress ||
               req.socket?.remoteAddress ||
               req.ip ||
               'unknown';
    
    res.json({
        ip: ip,
        timestamp: new Date().toISOString()
    });
});

/**
 * Receive session log data via sendBeacon on page unload
 * This endpoint handles the final persist when user leaves the page
 * POST /api/session-log
 * Also resolves IP geolocation (country/city) and updates the session_logs record
 */
app.post('/api/session-log', async (req, res) => {
    const { session_id, session_log_id, log_data, log_entries_count, has_errors, error_count, ended_at } = req.body;

    if (!session_id) {
        return res.status(400).json({ success: false, error: 'Session ID required' });
    }

    console.log(`[Session Log] Received final log for session ${session_id}: ${log_entries_count} entries, ${error_count} errors`);

    // Respond immediately (fire-and-forget for sendBeacon)
    res.status(200).json({ success: true, received: true });

    // Background: resolve IP geolocation and update the record
    if (session_log_id) {
        try {
            const cfg = getHealthConfig();
            if (!cfg.supabaseUrl || !cfg.supabaseServiceKey) return;

            // Get the client IP from the request
            const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
                || req.headers['x-real-ip']
                || req.socket.remoteAddress;

            const isLocal = !clientIp || clientIp === '::1' || clientIp === '127.0.0.1' || clientIp.startsWith('192.168.') || clientIp.startsWith('10.');

            if (!isLocal) {
                const geoRes = await fetch(`http://ip-api.com/json/${clientIp}?fields=status,country,city`, {
                    signal: AbortSignal.timeout(3000)
                });
                const geo = await geoRes.json();

                if (geo.status === 'success' && (geo.country || geo.city)) {
                    await fetch(`${cfg.supabaseUrl}/rest/v1/session_logs?id=eq.${session_log_id}`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            'apikey': cfg.supabaseServiceKey,
                            'Authorization': `Bearer ${cfg.supabaseServiceKey}`,
                            'Prefer': 'return=minimal'
                        },
                        body: JSON.stringify({ country: geo.country, city: geo.city })
                    });
                    console.log(`[Session Log] Geo resolved for ${session_log_id}: ${geo.city}, ${geo.country}`);
                }
            }
        } catch (err) {
            console.error(`[Session Log] Geo resolution failed for ${session_log_id}:`, err.message);
        }
    }
});

// ============================================
// SUPABASE ADMIN API - PASSWORD UPDATE
// ============================================

/**
 * Update user password using Supabase Admin API
 * POST /api/admin/update-user-password
 * Body: { userId, newPassword }
 * Keys read from process.env (NEVER from frontend)
 */
app.post('/api/admin/update-user-password', async (req, res) => {
    const { userId, newPassword } = req.body;

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({
            success: false,
            error: 'Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables'
        });
    }

    if (!userId || !newPassword) {
        return res.status(400).json({
            success: false,
            error: 'Faltan parametros requeridos (userId, newPassword)'
        });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({
            success: false,
            error: 'La contrasena debe tener al menos 6 caracteres'
        });
    }

    try {
        // Use Supabase Admin API to update user password
        const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'apikey': serviceRoleKey,
                'Authorization': `Bearer ${serviceRoleKey}`
            },
            body: JSON.stringify({
                password: newPassword
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            console.error('[Admin API] Error updating password:', data);
            throw new Error(data.message || data.error || 'Error al actualizar la contrasena');
        }
        
        console.log(`[Admin API] Password updated for user: ${userId}`);
        
        return res.json({
            success: true,
            message: 'Contrasena actualizada correctamente'
        });
        
    } catch (error) {
        console.error('[Admin API] Error:', error.message);
        return res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================
// TEMPORARY PASSWORD RESET FOR N8N EMAIL FLOW
// ============================================

/**
 * Reset user password to a temporary password for n8n email flow
 * This endpoint is used when users request password reset via the app
 * POST /api/auth/reset-temp-password
 * Body: { email, userType ('artist' | 'client'), tempPassword }
 * 
 * Flow:
 * 1. Lookup user by email in artists_db or clients_db
 * 2. Update auth password via Supabase Admin API
 * 3. For artists, also update artists_db.password
 * 4. Return success (caller then triggers n8n webhook)
 */
app.post('/api/auth/reset-temp-password', async (req, res) => {
    const { email, userType, tempPassword } = req.body;
    
    // Validation
    if (!email || !userType || !tempPassword) {
        return res.status(400).json({ 
            success: false, 
            error: 'Faltan parametros requeridos (email, userType, tempPassword)' 
        });
    }
    
    if (!['artist', 'client'].includes(userType)) {
        return res.status(400).json({ 
            success: false, 
            error: 'userType debe ser "artist" o "client"' 
        });
    }
    
    if (tempPassword.length < 6) {
        return res.status(400).json({ 
            success: false, 
            error: 'La contrasena temporal debe tener al menos 6 caracteres' 
        });
    }
    
    // Get Supabase credentials from environment
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !serviceRoleKey) {
        console.error('[Auth] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
        return res.status(500).json({ 
            success: false, 
            error: 'Configuracion de servidor incompleta. Contacta al administrador.' 
        });
    }
    
    try {
        // Determine which table to query
        const tableName = userType === 'artist' ? 'artists_db' : 'clients_db';
        
        // Step 1: Lookup user by email
        const lookupResponse = await fetch(`${supabaseUrl}/rest/v1/${tableName}?email=eq.${encodeURIComponent(email)}&select=user_id,email`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'apikey': serviceRoleKey,
                'Authorization': `Bearer ${serviceRoleKey}`
            }
        });
        
        if (!lookupResponse.ok) {
            const errorData = await lookupResponse.json();
            console.error('[Auth] Error looking up user:', errorData);
            throw new Error('Error al buscar usuario');
        }
        
        const users = await lookupResponse.json();
        
        if (!users || users.length === 0) {
            console.log(`[Auth] User not found: ${email} (type: ${userType})`);
            return res.status(404).json({ 
                success: false, 
                error: 'Usuario no encontrado' 
            });
        }
        
        const userId = users[0].user_id;
        console.log(`[Auth] Found user ${email} with user_id: ${userId}`);
        
        // Step 2: Update auth password via Admin API
        const authUpdateResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'apikey': serviceRoleKey,
                'Authorization': `Bearer ${serviceRoleKey}`
            },
            body: JSON.stringify({
                password: tempPassword
            })
        });
        
        const authData = await authUpdateResponse.json();
        
        if (!authUpdateResponse.ok) {
            console.error('[Auth] Error updating auth password:', authData);
            throw new Error(authData.message || authData.error || 'Error al actualizar contrasena en auth');
        }
        
        console.log(`[Auth] Auth password updated for user: ${userId}`);
        
        // Step 3: For artists, also update artists_db.password column
        if (userType === 'artist') {
            const dbUpdateResponse = await fetch(`${supabaseUrl}/rest/v1/artists_db?user_id=eq.${userId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': serviceRoleKey,
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                    password: tempPassword
                })
            });
            
            if (!dbUpdateResponse.ok) {
                // Log but don't fail - auth update succeeded
                console.warn('[Auth] Warning: Could not update artists_db.password');
            } else {
                console.log(`[Auth] artists_db.password updated for user: ${userId}`);
            }
        }
        
        console.log(`[Auth] Temporary password reset complete for: ${email}`);
        
        return res.json({
            success: true,
            message: 'Contrasena temporal establecida correctamente',
            userType: userType
        });
        
    } catch (error) {
        console.error('[Auth] Error in reset-temp-password:', error.message);
        return res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================
// TATTOO STYLES - ENSURE / CREATE
// ============================================

/**
 * Ensure a tattoo style exists in tattoo_styles.
 * If a matching row (accent/case-insensitive) already exists, return it.
 * Otherwise insert a new top-level style and return it.
 * POST /api/tattoo-styles/ensure
 * Body: { name: string }
 */
app.post('/api/tattoo-styles/ensure', async (req, res) => {
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'name is required' });
    }

    const trimmed = name.trim();
    if (trimmed.length > 100) {
        return res.status(400).json({ success: false, error: 'name must be 100 characters or fewer' });
    }

    let supabaseUrl = process.env.SUPABASE_URL;
    let apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !apiKey) {
        try {
            const configPath = path.join(__dirname, 'public', 'shared', 'js', 'app-config.json');
            if (fs.pathExistsSync(configPath)) {
                const cfg = fs.readJsonSync(configPath);
                supabaseUrl = supabaseUrl || cfg.supabase?.url;
                apiKey = apiKey || cfg.supabase?.anonKey;
            }
        } catch (_) { /* ignore */ }
    }

    if (!supabaseUrl || !apiKey) {
        console.error('[Styles] Missing Supabase credentials');
        return res.status(500).json({ success: false, error: 'Server configuration incomplete' });
    }

    const headers = {
        'Content-Type': 'application/json',
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Prefer': 'return=representation'
    };

    try {
        const allRes = await fetch(
            `${supabaseUrl}/rest/v1/tattoo_styles?parent_id=is.null&select=id,name,slug,sort_order`,
            { method: 'GET', headers }
        );
        if (!allRes.ok) throw new Error('Failed to fetch existing styles');
        const existing = await allRes.json();

        const normalize = (s) => s.trim().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        const normalizedInput = normalize(trimmed);
        const match = existing.find(s => normalize(s.name) === normalizedInput);

        if (match) {
            return res.json({ success: true, style: match, created: false });
        }

        const slug = trimmed.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

        const maxSort = existing.reduce((max, s) => Math.max(max, s.sort_order || 0), 0);

        const insertRes = await fetch(`${supabaseUrl}/rest/v1/tattoo_styles`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                name: trimmed,
                slug: slug,
                parent_id: null,
                sort_order: maxSort + 1,
                substyles_display_mode: 'grouped'
            })
        });

        if (!insertRes.ok) {
            const err = await insertRes.json().catch(() => ({}));
            throw new Error(err.message || 'Failed to insert style');
        }

        const [created] = await insertRes.json();
        console.log(`[Styles] Created new style: ${created.name} (${created.id})`);
        return res.json({ success: true, style: created, created: true });

    } catch (error) {
        console.error('[Styles] Error in ensure:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// SYSTEM BACKUP - FULL BACKUP WITH INSTALLER
// ============================================

/**
 * Generate full system backup with installer
 * POST /api/admin/generate-backup
 * Body: { dbData: { tableName: data[] }, config: {}, originalDomain: string }
 */
app.post('/api/admin/generate-backup', async (req, res) => {
    const { dbData, config, originalDomain } = req.body;
    
    console.log('[Backup] Starting full system backup generation...');
    
    try {
        // Set response headers for ZIP download
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        const filename = `weotzi-backup-${timestamp}.zip`;
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        // Create ZIP archive
        const archive = archiver('zip', {
            zlib: { level: 9 } // Maximum compression
        });
        
        // Handle archive errors
        archive.on('error', (err) => {
            console.error('[Backup] Archive error:', err);
            throw err;
        });
        
        // Pipe archive to response
        archive.pipe(res);
        
        // 1. Add metadata
        const metadata = {
            created: new Date().toISOString(),
            originalDomain: originalDomain || '',
            version: '1.0.0',
            backupType: 'full',
            nodeVersion: process.version
        };
        archive.append(JSON.stringify(metadata, null, 2), { name: 'backup/metadata.json' });
        console.log('[Backup] Added metadata.json');
        
        // 2. Add database dumps
        if (dbData && typeof dbData === 'object') {
            for (const [tableName, tableData] of Object.entries(dbData)) {
                archive.append(
                    JSON.stringify(tableData, null, 2), 
                    { name: `backup/database/${tableName}.json` }
                );
                console.log(`[Backup] Added database/${tableName}.json (${Array.isArray(tableData) ? tableData.length : 0} records)`);
            }
        }
        
        // 3. Add configuration
        if (config) {
            archive.append(JSON.stringify(config, null, 2), { name: 'backup/config/app-config.json' });
            console.log('[Backup] Added config/app-config.json');
        }
        
        // 4. Add application files
        const publicDir = path.join(__dirname, 'public');
        if (await fs.pathExists(publicDir)) {
            archive.directory(publicDir, 'public');
            console.log('[Backup] Added public/ directory');
        }
        
        // 5. Add server.js
        const serverPath = path.join(__dirname, 'server.js');
        if (await fs.pathExists(serverPath)) {
            archive.file(serverPath, { name: 'server.js' });
            console.log('[Backup] Added server.js');
        }
        
        // 6. Add package.json
        const packagePath = path.join(__dirname, 'package.json');
        if (await fs.pathExists(packagePath)) {
            archive.file(packagePath, { name: 'package.json' });
            console.log('[Backup] Added package.json');
        }
        
        // 7. Add setup.js (installer bootstrapper)
        const setupPath = path.join(__dirname, 'setup.js');
        if (await fs.pathExists(setupPath)) {
            archive.file(setupPath, { name: 'setup.js' });
            console.log('[Backup] Added setup.js');
        }
        
        // 8. Add installer directory
        const installerDir = path.join(__dirname, 'installer');
        if (await fs.pathExists(installerDir)) {
            archive.directory(installerDir, 'installer');
            console.log('[Backup] Added installer/ directory');
        }
        
        // 9. Create logs directory structure
        archive.append('', { name: 'logs/server_clients/.gitkeep' });
        console.log('[Backup] Added logs/ directory structure');
        
        // Finalize archive
        await archive.finalize();
        console.log('[Backup] Backup ZIP finalized successfully');
        
    } catch (error) {
        console.error('[Backup] Error generating backup:', error.message);
        if (!res.headersSent) {
            return res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    }
});

/**
 * Get list of database tables for backup selection
 * GET /api/admin/backup-tables
 */
app.get('/api/admin/backup-tables', (req, res) => {
    // Return the list of known tables
    const tables = [
        { name: 'artists_db', description: 'Artistas registrados' },
        { name: 'quotations_db', description: 'Cotizaciones' },
        { name: 'tattoo_styles', description: 'Estilos de tatuaje' },
        { name: 'body_parts', description: 'Partes del cuerpo' },
        { name: 'quotation_flow_config', description: 'Configuracion del flujo' },
        { name: 'support_users_db', description: 'Usuarios de soporte' },
        { name: 'feedback_tickets', description: 'Tickets de feedback' },
        { name: 'app_settings', description: 'Configuracion de la app' },
        { name: 'session_logs', description: 'Logs de sesion' },
        { name: 'client_accounts', description: 'Cuentas de clientes' }
    ];
    
    res.json({ success: true, tables });
});

// ============================================
// DYNAMIC CONFIGURATION ENDPOINT
// Serves app-config.json with environment variable overrides
// This allows Easypanel to manage configuration
// ============================================

/**
 * Serve dynamic configuration
 * GET /shared/js/app-config.json
 * Reads base config and overrides with environment variables
 */
app.get('/shared/js/app-config.json', async (req, res) => {
    try {
        // Read base configuration file
        const configPath = path.join(__dirname, 'public', 'shared', 'js', 'app-config.json');
        let config = {};
        
        if (await fs.pathExists(configPath)) {
            const fileContent = await fs.readFile(configPath, 'utf8');
            config = JSON.parse(fileContent);
        }
        
        // Override with environment variables if they exist
        // Supabase configuration
        if (process.env.SUPABASE_URL) {
            config.supabase = config.supabase || {};
            config.supabase.url = process.env.SUPABASE_URL;
        }
        if (process.env.SUPABASE_ANON_KEY) {
            config.supabase = config.supabase || {};
            config.supabase.anonKey = process.env.SUPABASE_ANON_KEY;
        }
        if (process.env.SUPABASE_STORAGE_BUCKET) {
            config.supabase = config.supabase || {};
            config.supabase.storageBucket = process.env.SUPABASE_STORAGE_BUCKET;
        }
        
        // Google Maps configuration
        if (process.env.GOOGLE_MAPS_API_KEY) {
            config.googleMaps = config.googleMaps || {};
            config.googleMaps.apiKey = process.env.GOOGLE_MAPS_API_KEY;
        }

        // n8n configuration
        if (process.env.N8N_WEBHOOK_URL) {
            config.n8n = config.n8n || {};
            config.n8n.webhookUrl = process.env.N8N_WEBHOOK_URL;
        }
        if (process.env.N8N_DRIVE_FOLDER_ID) {
            config.n8n = config.n8n || {};
            config.n8n.driveFolderId = process.env.N8N_DRIVE_FOLDER_ID;
        }
        
        // Google Drive configuration
        if (process.env.GOOGLE_DRIVE_FOLDER_ID) {
            config.googleDrive = config.googleDrive || {};
            config.googleDrive.mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
        }
        if (process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT) {
            config.googleDrive = config.googleDrive || {};
            config.googleDrive.serviceAccountJson = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT;
        }
        
        // EmailJS configuration
        if (process.env.EMAILJS_SERVICE_ID) {
            config.emailjs = config.emailjs || {};
            config.emailjs.serviceId = process.env.EMAILJS_SERVICE_ID;
        }
        if (process.env.EMAILJS_TEMPLATE_ID) {
            config.emailjs = config.emailjs || {};
            config.emailjs.templateId = process.env.EMAILJS_TEMPLATE_ID;
        }
        if (process.env.EMAILJS_PUBLIC_KEY) {
            config.emailjs = config.emailjs || {};
            config.emailjs.publicKey = process.env.EMAILJS_PUBLIC_KEY;
        }
        
        // Gemini AI configuration
        if (process.env.GEMINI_API_KEY) {
            config.gemini = config.gemini || {};
            config.gemini.apiKey = process.env.GEMINI_API_KEY;
            config.gemini.enabled = true;
        }
        
        // WeOtzi configuration
        if (process.env.WHATSAPP_NUMBER) {
            config.weOtzi = config.weOtzi || {};
            config.weOtzi.whatsapp = process.env.WHATSAPP_NUMBER;
        }
        
        // Registration configuration
        if (process.env.PRESET_PASSWORD) {
            config.registration = config.registration || {};
            config.registration.presetPassword = process.env.PRESET_PASSWORD;
        }
        
        // Feature flags from environment
        if (process.env.DEMO_MODE !== undefined) {
            config.features = config.features || {};
            config.features.demoMode = process.env.DEMO_MODE === 'true';
        }
        
        // Set last modified timestamp
        config.lastModified = new Date().toISOString();
        
        // Send JSON response with cache headers
        res.set('Content-Type', 'application/json');
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.json(config);
        
    } catch (error) {
        console.error('[Config] Error serving dynamic config:', error.message);
        res.status(500).json({ error: 'Failed to load configuration' });
    }
});

// ============================================
// JOB BOARD - ACCEPT APPLICATION ENDPOINT
// ============================================

/**
 * Accept an artist's application to a job board request
 * Creates a quotation in quotations_db and updates statuses
 * POST /api/job-board/accept-application
 * Body: { applicationId, requestId }
 */
app.post('/api/job-board/accept-application', async (req, res) => {
    const { applicationId, requestId } = req.body;

    if (!applicationId || !requestId) {
        return res.status(400).json({
            success: false,
            error: 'applicationId and requestId are required'
        });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({
            success: false,
            error: 'Server configuration incomplete'
        });
    }

    const headers = {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Prefer': 'return=representation'
    };

    try {
        console.log(`[Job Board] Accepting application ${applicationId} for request ${requestId}`);

        // 0. Authenticate: extract caller identity from Authorization header
        const authHeader = req.headers['authorization'];
        let callerUserId = null;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.replace('Bearer ', '');
            try {
                const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
                    headers: {
                        'apikey': serviceRoleKey,
                        'Authorization': `Bearer ${token}`
                    }
                });
                if (userResponse.ok) {
                    const userData = await userResponse.json();
                    callerUserId = userData?.id || null;
                }
            } catch (authErr) {
                console.warn('[Job Board] Auth check failed:', authErr.message);
            }
        }

        if (!callerUserId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        // 1. Fetch the application with artist data
        const appResponse = await fetch(
            `${supabaseUrl}/rest/v1/job_board_applications?id=eq.${applicationId}&select=*`,
            { headers }
        );
        const appData = await appResponse.json();
        if (!appData || appData.length === 0) {
            throw new Error('Application not found');
        }
        const application = appData[0];

        // 1b. Race condition guard: application must still be pending
        if (application.status !== 'pending' && application.status !== 'viewed') {
            return res.status(409).json({
                success: false,
                error: `Application already ${application.status}`
            });
        }

        // 2. Fetch the request with client data
        const reqResponse = await fetch(
            `${supabaseUrl}/rest/v1/job_board_requests?id=eq.${requestId}&select=*`,
            { headers }
        );
        const reqData = await reqResponse.json();
        if (!reqData || reqData.length === 0) {
            throw new Error('Request not found');
        }
        const request = reqData[0];

        // 2b. Verify caller owns this request
        if (request.client_user_id !== callerUserId) {
            return res.status(403).json({
                success: false,
                error: 'Only the request owner can accept applications'
            });
        }

        // 2c. Race condition guard: request must still be open
        if (request.status !== 'open' && request.status !== 'in_review') {
            return res.status(409).json({
                success: false,
                error: `Request already ${request.status}`
            });
        }

        // 3. Fetch artist details
        const artistResponse = await fetch(
            `${supabaseUrl}/rest/v1/artists_db?user_id=eq.${application.artist_id}&select=*`,
            { headers }
        );
        const artistData = await artistResponse.json();
        const artist = artistData?.[0] || {};

        // 4. Fetch client details
        const clientResponse = await fetch(
            `${supabaseUrl}/rest/v1/clients_db?user_id=eq.${request.client_user_id}&select=*`,
            { headers }
        );
        const clientData = await clientResponse.json();
        const client = clientData?.[0] || {};

        // 5. Generate quote ID
        const quoteId = 'QN-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

        // 6. Create quotation in quotations_db
        const quotationPayload = {
            quote_id: quoteId,
            quote_status: 'pending',
            source: 'job_board',
            job_board_request_id: request.id,

            // Tattoo data from request
            tattoo_body_part: request.tattoo_body_part,
            tattoo_body_side: request.tattoo_body_side,
            tattoo_idea_description: request.tattoo_idea_description,
            tattoo_size: request.tattoo_size,
            tattoo_style: request.tattoo_style,
            tattoo_color_type: request.tattoo_color_type,
            tattoo_is_first_tattoo: !!request.tattoo_is_first_tattoo,
            tattoo_is_cover_up: !!request.tattoo_is_cover_up,

            // Client data
            client_full_name: client.full_name || '',
            client_email: client.email || '',
            client_whatsapp: client.whatsapp || '',
            client_age: client.age ? String(client.age) : '',
            client_city_residence: request.client_city || client.city_residence || '',
            client_preferred_date: request.client_preferred_date || '',
            client_flexible_dates: request.client_flexible_dates || '',
            client_travel_willing: request.client_travel_willing ? 'true' : 'false',
            client_budget_amount: request.client_budget_max ? String(request.client_budget_max) : '',
            client_budget_currency: request.client_budget_currency || 'USD',
            client_user_id: request.client_user_id,
            client_instagram: client.instagram || '',

            // Artist data
            artist_id: application.artist_id,
            artist_name: artist.name || artist.username || '',
            artist_email: artist.email || '',
            artist_instagram: artist.instagram || '',
            artist_session_cost_amount: artist.session_price || '',
            artist_styles: artist.styles_array || [],
            artist_current_city: artist.ubicacion || artist.city || '',
            artist_studio_name: artist.estudios || '',

            // Accepted application offer
            artist_budget_amount: application.estimated_price ? String(application.estimated_price) : '',
            artist_budget_currency: request.client_budget_currency || 'USD',
            tattoo_estimated_sessions: application.estimated_sessions || null,

            created_at: new Date().toISOString()
        };

        const createQuoteResponse = await fetch(
            `${supabaseUrl}/rest/v1/quotations_db`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify(quotationPayload)
            }
        );

        if (!createQuoteResponse.ok) {
            const err = await createQuoteResponse.json();
            console.error('[Job Board] Error creating quotation:', err);
            throw new Error('Failed to create quotation: ' + (err.message || JSON.stringify(err)));
        }

        console.log(`[Job Board] Created quotation ${quoteId}`);

        // 7. Update accepted application
        const updateAppResponse = await fetch(
            `${supabaseUrl}/rest/v1/job_board_applications?id=eq.${applicationId}`,
            {
                method: 'PATCH',
                headers: { ...headers, 'Prefer': 'return=minimal' },
                body: JSON.stringify({
                    status: 'accepted',
                    decided_at: new Date().toISOString()
                })
            }
        );

        if (!updateAppResponse.ok) {
            console.warn('[Job Board] Warning: Could not update application status');
        }

        // 8. Reject all other pending applications
        const rejectResponse = await fetch(
            `${supabaseUrl}/rest/v1/job_board_applications?request_id=eq.${requestId}&id=neq.${applicationId}&status=in.(pending,viewed)`,
            {
                method: 'PATCH',
                headers: { ...headers, 'Prefer': 'return=minimal' },
                body: JSON.stringify({
                    status: 'rejected',
                    decided_at: new Date().toISOString()
                })
            }
        );

        if (!rejectResponse.ok) {
            console.warn('[Job Board] Warning: Could not reject other applications');
        }

        // 9. Update request status
        const updateReqResponse = await fetch(
            `${supabaseUrl}/rest/v1/job_board_requests?id=eq.${requestId}`,
            {
                method: 'PATCH',
                headers: { ...headers, 'Prefer': 'return=minimal' },
                body: JSON.stringify({
                    status: 'accepted',
                    accepted_at: new Date().toISOString(),
                    accepted_artist_id: application.artist_id,
                    accepted_application_id: applicationId,
                    resulting_quote_id: quoteId,
                    is_public: false
                })
            }
        );

        if (!updateReqResponse.ok) {
            console.warn('[Job Board] Warning: Could not update request status');
        }

        console.log(`[Job Board] Accept flow complete: application=${applicationId}, quote=${quoteId}`);

        return res.json({
            success: true,
            quoteId,
            message: 'Application accepted and quotation created'
        });

    } catch (error) {
        console.error('[Job Board] Error in accept-application:', error.message);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// CLIENT - HIDE QUOTATION ENDPOINT
// ============================================

/**
 * Hide a quotation from the client's dashboard (soft-delete for client only).
 * Sets client_deleted_at on the quotation row after verifying ownership.
 * POST /api/client/quotations/:quoteId/hide
 * Headers: Authorization: Bearer <supabase_access_token>
 */
app.post('/api/client/quotations/:quoteId/hide', async (req, res) => {
    const { quoteId } = req.params;

    if (!quoteId) {
        return res.status(400).json({ success: false, error: 'quoteId is required' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({ success: false, error: 'Server configuration incomplete' });
    }

    const headers = {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Prefer': 'return=representation'
    };

    try {
        // 1. Authenticate caller from Bearer token
        const authHeader = req.headers['authorization'];
        let callerUserId = null;
        let callerEmail = null;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.replace('Bearer ', '');
            try {
                const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
                    headers: {
                        'apikey': serviceRoleKey,
                        'Authorization': `Bearer ${token}`
                    }
                });
                if (userResponse.ok) {
                    const userData = await userResponse.json();
                    callerUserId = userData?.id || null;
                    callerEmail = userData?.email || null;
                }
            } catch (authErr) {
                console.warn('[Client Hide] Auth check failed:', authErr.message);
            }
        }

        if (!callerUserId) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        // 2. Fetch the quotation by quote_id
        const quoteResponse = await fetch(
            `${supabaseUrl}/rest/v1/quotations_db?quote_id=eq.${encodeURIComponent(quoteId)}&select=id,quote_id,client_user_id,client_email,client_deleted_at`,
            { headers }
        );
        const quoteData = await quoteResponse.json();

        if (!quoteData || quoteData.length === 0) {
            return res.status(404).json({ success: false, error: 'Quotation not found' });
        }

        const quotation = quoteData[0];

        // 3. Verify ownership: client_user_id must match, or client_email must match
        let isOwner = quotation.client_user_id === callerUserId;

        if (!isOwner && callerEmail && quotation.client_email &&
            quotation.client_email.toLowerCase() === callerEmail.toLowerCase()) {
            // Link the quotation to this client before hiding
            await fetch(
                `${supabaseUrl}/rest/v1/quotations_db?id=eq.${quotation.id}`,
                {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({ client_user_id: callerUserId })
                }
            );
            isOwner = true;
        }

        if (!isOwner) {
            return res.status(403).json({ success: false, error: 'You do not own this quotation' });
        }

        if (quotation.client_deleted_at) {
            return res.json({ success: true, quoteId, message: 'Already hidden' });
        }

        // 4. Set client_deleted_at
        const patchResponse = await fetch(
            `${supabaseUrl}/rest/v1/quotations_db?id=eq.${quotation.id}`,
            {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ client_deleted_at: new Date().toISOString() })
            }
        );

        if (!patchResponse.ok) {
            const errBody = await patchResponse.text();
            throw new Error(`Failed to hide quotation: ${errBody}`);
        }

        console.log(`[Client Hide] Client ${callerUserId} hid quotation ${quoteId}`);
        return res.json({ success: true, quoteId });

    } catch (error) {
        console.error('[Client Hide] Error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// HEALTH CHECK ENDPOINTS
// ============================================

/**
 * Helper: read config for health checks (env vars override file config)
 */
function getHealthConfig() {
    const configPath = path.join(__dirname, 'public', 'shared', 'js', 'app-config.json');
    let config = {};
    try {
        if (fs.pathExistsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
    } catch (e) { /* use empty config */ }

    return {
        supabaseUrl: process.env.SUPABASE_URL || config.supabase?.url || '',
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY || config.supabase?.anonKey || '',
        supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        storageBucket: process.env.SUPABASE_STORAGE_BUCKET || config.supabase?.storageBucket || 'quotation-references',
        googleMapsKey: process.env.GOOGLE_MAPS_API_KEY || config.googleMaps?.apiKey || '',
        n8nWebhookUrl: process.env.N8N_WEBHOOK_URL || config.n8n?.webhookUrl || '',
        geminiApiKey: process.env.GEMINI_API_KEY || config.gemini?.apiKey || '',
        emailjsServiceId: process.env.EMAILJS_SERVICE_ID || config.emailjs?.serviceId || '',
        emailjsPublicKey: process.env.EMAILJS_PUBLIC_KEY || config.emailjs?.publicKey || '',
        gdriveCredentials: process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT || config.googleDrive?.serviceAccountJson || '',
        gdriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || config.googleDrive?.mainFolderId || '',
        gcalClientId: config.googleCalendar?.clientId || '',
        gcalApiKey: config.googleCalendar?.apiKey || '',
        gcalEnabled: config.googleCalendar?.enabled || false
    };
}

/**
 * Helper: log health check result to Supabase
 */
async function logHealthCheck(cfg, serviceName, status, latencyMs, errorMessage, metadata) {
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return;
    try {
        await fetch(`${cfg.supabaseUrl}/rest/v1/service_health_logs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.supabaseAnonKey,
                'Authorization': `Bearer ${cfg.supabaseAnonKey}`
            },
            body: JSON.stringify({
                service_name: serviceName,
                status,
                latency_ms: latencyMs,
                error_message: errorMessage || null,
                metadata: metadata || {},
                checked_by: 'server'
            })
        });
    } catch (e) {
        console.error(`[HealthLog] Failed to log ${serviceName}:`, e.message);
    }
}

/**
 * Check a single service health
 */
async function checkServiceHealth(serviceName, cfg) {
    const start = Date.now();
    let status = 'unconfigured';
    let error = null;
    let metadata = {};

    try {
        switch (serviceName) {
            case 'supabase': {
                if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) break;
                // Test 1: REST API query
                const dbRes = await fetch(
                    `${cfg.supabaseUrl}/rest/v1/artists_db?select=id&limit=1`,
                    {
                        headers: {
                            'apikey': cfg.supabaseAnonKey,
                            'Authorization': `Bearer ${cfg.supabaseAnonKey}`
                        }
                    }
                );
                if (!dbRes.ok) throw new Error(`DB query failed: HTTP ${dbRes.status}`);
                metadata.dbQuery = 'ok';

                // Test 2: Storage bucket accessible
                const storageRes = await fetch(
                    `${cfg.supabaseUrl}/storage/v1/bucket/${cfg.storageBucket}`,
                    {
                        headers: {
                            'apikey': cfg.supabaseAnonKey,
                            'Authorization': `Bearer ${cfg.supabaseAnonKey}`
                        }
                    }
                );
                metadata.storageBucket = storageRes.ok ? 'ok' : `HTTP ${storageRes.status}`;

                status = dbRes.ok && storageRes.ok ? 'healthy' : 'degraded';
                break;
            }

            case 'n8n': {
                if (!cfg.n8nWebhookUrl) break;
                // Use HEAD request to avoid triggering webhook actions
                const n8nRes = await fetch(cfg.n8nWebhookUrl, {
                    method: 'HEAD',
                    signal: AbortSignal.timeout(10000)
                });
                // n8n webhooks may return various codes; anything other than network error = reachable
                metadata.httpStatus = n8nRes.status;
                status = (n8nRes.status < 500) ? 'healthy' : 'degraded';
                break;
            }

            case 'gemini': {
                if (!cfg.geminiApiKey) break;
                // List models endpoint — lightweight, no token consumption
                const geminiRes = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models?key=${cfg.geminiApiKey}&pageSize=1`,
                    { signal: AbortSignal.timeout(10000) }
                );
                if (!geminiRes.ok) {
                    const errData = await geminiRes.json().catch(() => ({}));
                    throw new Error(errData.error?.message || `HTTP ${geminiRes.status}`);
                }
                status = 'healthy';
                break;
            }

            case 'google-maps': {
                if (!cfg.googleMapsKey) break;
                // Geocoding test with a known address
                const mapsRes = await fetch(
                    `https://maps.googleapis.com/maps/api/geocode/json?address=Buenos+Aires&key=${cfg.googleMapsKey}`,
                    { signal: AbortSignal.timeout(10000) }
                );
                const mapsData = await mapsRes.json();
                if (mapsData.status === 'OK') {
                    status = 'healthy';
                } else if (mapsData.status === 'REQUEST_DENIED') {
                    throw new Error(`API Key denied: ${mapsData.error_message || 'check restrictions'}`);
                } else {
                    status = 'degraded';
                    metadata.apiStatus = mapsData.status;
                }
                break;
            }

            case 'google-drive': {
                if (!cfg.gdriveFolderId || !cfg.gdriveCredentials) break;
                let credentials;
                try {
                    credentials = typeof cfg.gdriveCredentials === 'string'
                        ? JSON.parse(cfg.gdriveCredentials)
                        : cfg.gdriveCredentials;
                } catch (e) {
                    throw new Error('Invalid service account JSON');
                }
                const drive = getGoogleDriveClient(credentials);
                if (!drive) throw new Error('Failed to initialize Drive client');
                const folderRes = await drive.files.get({
                    fileId: cfg.gdriveFolderId,
                    fields: 'id,name'
                });
                metadata.folderName = folderRes.data.name;
                status = 'healthy';
                break;
            }

            case 'emailjs': {
                if (!cfg.emailjsServiceId || !cfg.emailjsPublicKey) break;
                // EmailJS cannot be tested without sending email
                // Validate credentials format only
                status = 'healthy';
                metadata.note = 'Credentials present; real test requires sending email';
                break;
            }

            case 'google-calendar': {
                if (!cfg.gcalEnabled || !cfg.gcalApiKey) break;
                // Validate API key format
                if (cfg.gcalApiKey.startsWith('AIza') && cfg.gcalClientId.includes('.apps.googleusercontent.com')) {
                    status = 'healthy';
                    metadata.note = 'Credentials format valid; real OAuth test requires browser';
                } else {
                    status = 'degraded';
                    metadata.note = 'Credentials format invalid';
                }
                break;
            }

            default:
                error = `Unknown service: ${serviceName}`;
                status = 'down';
        }
    } catch (err) {
        status = 'down';
        error = err.message;
    }

    const latency = Date.now() - start;
    return { service: serviceName, status, latency_ms: latency, error, metadata };
}

const HEALTH_SERVICES = ['supabase', 'n8n', 'gemini', 'google-maps', 'google-drive', 'emailjs', 'google-calendar'];

/**
 * GET /api/health/all — Check all services
 */
app.get('/api/health/all', async (req, res) => {
    const cfg = getHealthConfig();
    const results = {};

    const checks = await Promise.allSettled(
        HEALTH_SERVICES.map(svc => checkServiceHealth(svc, cfg))
    );

    for (const check of checks) {
        if (check.status === 'fulfilled') {
            const r = check.value;
            results[r.service] = r;
            // Log to DB in background (don't await)
            logHealthCheck(cfg, r.service, r.status, r.latency_ms, r.error, r.metadata);
        }
    }

    const allHealthy = Object.values(results).every(r => r.status === 'healthy' || r.status === 'unconfigured');
    res.json({
        success: true,
        overall: allHealthy ? 'healthy' : 'degraded',
        checked_at: new Date().toISOString(),
        services: results
    });
});

/**
 * GET /api/health/:service — Check a single service
 */
app.get('/api/health/:service', async (req, res) => {
    const serviceName = req.params.service;
    if (!HEALTH_SERVICES.includes(serviceName)) {
        return res.status(400).json({ success: false, error: `Unknown service: ${serviceName}. Valid: ${HEALTH_SERVICES.join(', ')}` });
    }

    const cfg = getHealthConfig();
    const result = await checkServiceHealth(serviceName, cfg);

    // Log to DB in background
    logHealthCheck(cfg, result.service, result.status, result.latency_ms, result.error, result.metadata);

    res.json({ success: true, ...result });
});

/**
 * GET /api/health/history/:service — Get health check history
 */
app.get('/api/health/history/:service', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const serviceName = req.params.service;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    try {
        const historyRes = await fetch(
            `${cfg.supabaseUrl}/rest/v1/service_health_logs?service_name=eq.${encodeURIComponent(serviceName)}&order=checked_at.desc&limit=${limit}`,
            {
                headers: {
                    'apikey': cfg.supabaseAnonKey,
                    'Authorization': `Bearer ${cfg.supabaseAnonKey}`
                }
            }
        );
        const data = await historyRes.json();
        res.json({ success: true, service: serviceName, history: data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// ANALYTICS ENDPOINTS
// ============================================

/**
 * Helper: make authenticated request to Supabase REST API
 */
async function supabaseQuery(cfg, path) {
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
        headers: {
            'apikey': cfg.supabaseAnonKey,
            'Authorization': `Bearer ${cfg.supabaseAnonKey}`
        }
    });
    if (!res.ok) throw new Error(`Supabase query failed: HTTP ${res.status}`);
    return res.json();
}

/**
 * GET /api/analytics/users — Users by type and period
 * Query params: period (day|week|month), env (production|development|all), days (default 30)
 */
app.get('/api/analytics/users', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const env = req.query.env || 'all';
    const period = req.query.period || 'day';

    try {
        // Users by type
        const userTypes = await supabaseQuery(cfg,
            `analytics_user_sessions?select=user_type,created_at&created_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}${env !== 'all' ? `&environment=eq.${env}` : ''}`
        );

        // Aggregate by type
        const typeCounts = {};
        const timeline = {};
        for (const row of userTypes) {
            typeCounts[row.user_type] = (typeCounts[row.user_type] || 0) + 1;

            let key;
            const d = new Date(row.created_at);
            if (period === 'month') key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            else if (period === 'week') {
                const weekStart = new Date(d);
                weekStart.setDate(d.getDate() - d.getDay());
                key = weekStart.toISOString().split('T')[0];
            } else {
                key = d.toISOString().split('T')[0];
            }

            if (!timeline[key]) timeline[key] = { date: key, artist: 0, client: 0, anonymous: 0, authenticated_other: 0 };
            timeline[key][row.user_type] = (timeline[key][row.user_type] || 0) + 1;
        }

        // New vs returning
        const fingerprints = await supabaseQuery(cfg,
            `analytics_user_sessions?select=device_fingerprint,created_at&created_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}${env !== 'all' ? `&environment=eq.${env}` : ''}`
        );
        const fpFirst = {};
        for (const row of fingerprints) {
            if (!fpFirst[row.device_fingerprint] || row.created_at < fpFirst[row.device_fingerprint]) {
                fpFirst[row.device_fingerprint] = row.created_at;
            }
        }
        const cutoff = new Date(Date.now() - days * 86400000).toISOString();
        let newVisitors = 0, returningVisitors = 0;
        for (const [fp, firstSeen] of Object.entries(fpFirst)) {
            if (firstSeen >= cutoff) newVisitors++;
            else returningVisitors++;
        }

        res.json({
            success: true,
            period: { days, groupBy: period, environment: env },
            summary: typeCounts,
            newVsReturning: { new: newVisitors, returning: returningVisitors },
            timeline: Object.values(timeline).sort((a, b) => a.date.localeCompare(b.date))
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/analytics/devices — Device/OS/Browser distribution
 * Query params: days (default 30), env (production|development|all)
 */
app.get('/api/analytics/devices', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const env = req.query.env || 'all';

    try {
        const devices = await supabaseQuery(cfg,
            `analytics_devices?select=os,device_type,browser,created_at${env !== 'all' ? `&environment=eq.${env}` : ''}&created_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}`
        );

        const byOS = {};
        const byDeviceType = {};
        const byBrowser = {};
        for (const row of devices) {
            byOS[row.os] = (byOS[row.os] || 0) + 1;
            byDeviceType[row.device_type] = (byDeviceType[row.device_type] || 0) + 1;
            byBrowser[row.browser] = (byBrowser[row.browser] || 0) + 1;
        }

        res.json({
            success: true,
            total: devices.length,
            os: byOS,
            deviceType: byDeviceType,
            browser: byBrowser
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/analytics/pages — Most visited pages
 * Query params: days (default 30), env (production|development|all), limit (default 20)
 */
app.get('/api/analytics/pages', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const env = req.query.env || 'all';
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    try {
        const sessions = await supabaseQuery(cfg,
            `analytics_user_sessions?select=page_path,created_at${env !== 'all' ? `&environment=eq.${env}` : ''}&created_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}`
        );

        const pageCounts = {};
        for (const row of sessions) {
            pageCounts[row.page_path] = (pageCounts[row.page_path] || 0) + 1;
        }

        const pages = Object.entries(pageCounts)
            .map(([page, visits]) => ({ page, visits }))
            .sort((a, b) => b.visits - a.visits)
            .slice(0, limit);

        res.json({ success: true, total: sessions.length, pages });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/analytics/errors — Sessions with errors
 * Query params: days (default 30), env (production|development|all)
 */
app.get('/api/analytics/errors', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const env = req.query.env || 'all';

    try {
        const errorSessions = await supabaseQuery(cfg,
            `analytics_user_sessions?select=page_path,error_count,user_type,environment,created_at&has_errors=eq.true&created_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}${env !== 'all' ? `&environment=eq.${env}` : ''}&order=created_at.desc`
        );

        // Aggregate by page
        const byPage = {};
        let totalErrors = 0;
        const timeline = {};
        for (const row of errorSessions) {
            byPage[row.page_path] = (byPage[row.page_path] || 0) + (row.error_count || 1);
            totalErrors += row.error_count || 1;

            const day = new Date(row.created_at).toISOString().split('T')[0];
            timeline[day] = (timeline[day] || 0) + 1;
        }

        const errorPages = Object.entries(byPage)
            .map(([page, errors]) => ({ page, errors }))
            .sort((a, b) => b.errors - a.errors);

        res.json({
            success: true,
            totalErrorSessions: errorSessions.length,
            totalErrors,
            byPage: errorPages,
            timeline: Object.entries(timeline)
                .map(([date, count]) => ({ date, errorSessions: count }))
                .sort((a, b) => a.date.localeCompare(b.date))
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/analytics/locations — Geographic distribution from resolved IPs
 * Query params: days (default 30), env (production|development|all)
 */
app.get('/api/analytics/locations', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const env = req.query.env || 'all';

    try {
        const sessions = await supabaseQuery(cfg,
            `analytics_user_sessions?select=user_ip,country,city,created_at&user_ip=not.is.null${env !== 'all' ? `&environment=eq.${env}` : ''}&created_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}`
        );

        const countryCounts = {};
        const cityCounts = {};
        const ipCounts = {};
        let localhostCount = 0;
        let resolvedCount = 0;

        for (const row of sessions) {
            if (row.user_ip === '::1' || row.user_ip === '127.0.0.1') {
                localhostCount++;
                continue;
            }
            ipCounts[row.user_ip] = (ipCounts[row.user_ip] || 0) + 1;

            if (row.country) {
                resolvedCount++;
                countryCounts[row.country] = (countryCounts[row.country] || 0) + 1;
                if (row.city) {
                    const key = `${row.city}, ${row.country}`;
                    cityCounts[key] = (cityCounts[key] || 0) + 1;
                }
            }
        }

        const topCountries = Object.entries(countryCounts)
            .map(([country, count]) => ({ country, sessions: count }))
            .sort((a, b) => b.sessions - a.sessions);

        const topCities = Object.entries(cityCounts)
            .map(([city, count]) => ({ city, sessions: count }))
            .sort((a, b) => b.sessions - a.sessions)
            .slice(0, 20);

        const uniqueIPs = Object.entries(ipCounts)
            .map(([ip, count]) => ({ ip, sessions: count }))
            .sort((a, b) => b.sessions - a.sessions);

        res.json({
            success: true,
            totalSessions: sessions.length,
            localhostSessions: localhostCount,
            uniquePublicIPs: uniqueIPs.length,
            resolvedSessions: resolvedCount,
            countries: topCountries,
            cities: topCities,
            topIPs: uniqueIPs.slice(0, 20)
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/analytics/quotations — Quotation metrics
 * Query params: days (default 90)
 * Returns: status breakdown, avg response time, conversion by style, conversion by artist, trend over time
 */
app.get('/api/analytics/quotations', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const days = Math.min(parseInt(req.query.days) || 90, 365);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    try {
        const quotes = await supabaseQuery(cfg,
            `quotations_db?select=quote_id,quote_status,tattoo_style,artist_id,artist_name,created_at,sent_to_artist_at,artist_responded_at&created_at=gte.${since}`
        );

        // 1. Total by status
        const byStatus = {};
        for (const q of quotes) {
            const s = q.quote_status || 'unknown';
            byStatus[s] = (byStatus[s] || 0) + 1;
        }

        // 2. Average response time (sent_to_artist_at → artist_responded_at)
        const responseTimes = [];
        for (const q of quotes) {
            if (q.sent_to_artist_at && q.artist_responded_at) {
                const sent = new Date(q.sent_to_artist_at).getTime();
                const responded = new Date(q.artist_responded_at).getTime();
                if (responded > sent) {
                    responseTimes.push(responded - sent);
                }
            }
        }
        const avgResponseMs = responseTimes.length > 0
            ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
            : null;
        const avgResponseHours = avgResponseMs ? Math.round(avgResponseMs / 3600000 * 10) / 10 : null;

        // 3. Conversion by style (tattoo_style is JSONB with style_name)
        const CONVERTED_STATUSES = ['client_approved', 'in_progress', 'en_progreso', 'completed'];
        const styleStats = {};
        for (const q of quotes) {
            const styleName = q.tattoo_style?.style_name || 'Sin estilo';
            if (!styleStats[styleName]) styleStats[styleName] = { total: 0, converted: 0 };
            styleStats[styleName].total++;
            if (CONVERTED_STATUSES.includes(q.quote_status)) {
                styleStats[styleName].converted++;
            }
        }
        const conversionByStyle = Object.entries(styleStats)
            .map(([style, s]) => ({
                style,
                total: s.total,
                converted: s.converted,
                rate: s.total > 0 ? Math.round(s.converted / s.total * 1000) / 10 : 0
            }))
            .sort((a, b) => b.total - a.total);

        // 4. Conversion by artist
        const artistStats = {};
        for (const q of quotes) {
            if (!q.artist_id) continue;
            const key = q.artist_id;
            if (!artistStats[key]) artistStats[key] = { name: q.artist_name || 'Unknown', total: 0, converted: 0, responseTimes: [] };
            artistStats[key].total++;
            if (CONVERTED_STATUSES.includes(q.quote_status)) {
                artistStats[key].converted++;
            }
            if (q.sent_to_artist_at && q.artist_responded_at) {
                const diff = new Date(q.artist_responded_at).getTime() - new Date(q.sent_to_artist_at).getTime();
                if (diff > 0) artistStats[key].responseTimes.push(diff);
            }
        }
        const conversionByArtist = Object.entries(artistStats)
            .map(([artistId, s]) => ({
                artistId,
                name: s.name,
                total: s.total,
                converted: s.converted,
                rate: s.total > 0 ? Math.round(s.converted / s.total * 1000) / 10 : 0,
                avgResponseHours: s.responseTimes.length > 0
                    ? Math.round(s.responseTimes.reduce((a, b) => a + b, 0) / s.responseTimes.length / 3600000 * 10) / 10
                    : null
            }))
            .sort((a, b) => b.total - a.total);

        // 5. Trend by week
        const weekBuckets = {};
        for (const q of quotes) {
            const d = new Date(q.created_at);
            const weekStart = new Date(d);
            weekStart.setDate(d.getDate() - d.getDay());
            const key = weekStart.toISOString().slice(0, 10);
            if (!weekBuckets[key]) weekBuckets[key] = { total: 0, converted: 0 };
            weekBuckets[key].total++;
            if (CONVERTED_STATUSES.includes(q.quote_status)) {
                weekBuckets[key].converted++;
            }
        }
        const trend = Object.entries(weekBuckets)
            .map(([week, s]) => ({ week, total: s.total, converted: s.converted }))
            .sort((a, b) => a.week.localeCompare(b.week));

        res.json({
            success: true,
            period: { days, since: since.slice(0, 10) },
            total: quotes.length,
            byStatus,
            avgResponseHours,
            responseSamples: responseTimes.length,
            conversionByStyle,
            conversionByArtist,
            trend
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/analytics/summary — Dashboard summary of all analytics
 * Query params: days (default 30), env (production|development|all)
 */
app.get('/api/analytics/summary', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const env = req.query.env || 'all';

    try {
        const sessions = await supabaseQuery(cfg,
            `analytics_user_sessions?select=user_type,page_path,has_errors,error_count,device_fingerprint,environment,created_at&created_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}${env !== 'all' ? `&environment=eq.${env}` : ''}`
        );

        const devices = await supabaseQuery(cfg,
            `analytics_devices?select=device_type,created_at&created_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}`
        );

        // Compute summary
        const totalSessions = sessions.length;
        const uniqueVisitors = new Set(sessions.map(s => s.device_fingerprint)).size;
        const errorSessions = sessions.filter(s => s.has_errors).length;
        const totalErrors = sessions.reduce((sum, s) => sum + (s.error_count || 0), 0);

        const userTypes = {};
        for (const s of sessions) {
            userTypes[s.user_type] = (userTypes[s.user_type] || 0) + 1;
        }

        const deviceTypes = {};
        for (const d of devices) {
            deviceTypes[d.device_type] = (deviceTypes[d.device_type] || 0) + 1;
        }

        res.json({
            success: true,
            period: { days, environment: env },
            summary: {
                totalSessions,
                uniqueVisitors,
                errorSessions,
                totalErrors,
                errorRate: totalSessions > 0 ? ((errorSessions / totalSessions) * 100).toFixed(1) + '%' : '0%'
            },
            userTypes,
            deviceTypes
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/artists/geocode
 * Persist geocoding results computed by the client (Explore Map page).
 *
 * Body: {
 *   user_id: string (UUID, required),
 *   latitude: number (required),
 *   longitude: number (required),
 *   geocoded_address: string (optional, formatted address from Google)
 * }
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS (the public anon role cannot
 * UPDATE arbitrary artists_db rows). Validates that coordinates are finite
 * numbers within Earth bounds before writing.
 *
 * Idempotent: subsequent calls with the same (user_id, lat, lng) just refresh
 * geocoded_at.
 */
app.post('/api/artists/geocode', async (req, res) => {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(503).json({
            success: false,
            error: 'Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
        });
    }

    const { user_id, latitude, longitude, geocoded_address } = req.body || {};

    if (!user_id || typeof user_id !== 'string') {
        return res.status(400).json({ success: false, error: 'user_id is required' });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        return res.status(400).json({ success: false, error: 'latitude must be a finite number in [-90, 90]' });
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        return res.status(400).json({ success: false, error: 'longitude must be a finite number in [-180, 180]' });
    }

    try {
        const updateRes = await fetch(
            `${supabaseUrl}/rest/v1/artists_db?user_id=eq.${encodeURIComponent(user_id)}`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': serviceRoleKey,
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify({
                    latitude: lat,
                    longitude: lng,
                    geocoded_address: geocoded_address ? String(geocoded_address).slice(0, 500) : null,
                    geocoded_at: new Date().toISOString()
                })
            }
        );

        if (!updateRes.ok) {
            const errBody = await updateRes.text();
            console.error('[Geocode] Supabase PATCH failed:', updateRes.status, errBody);
            return res.status(502).json({
                success: false,
                error: `Supabase update failed: HTTP ${updateRes.status}`
            });
        }

        const rows = await updateRes.json();
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Artist not found for given user_id' });
        }

        return res.json({
            success: true,
            artist: {
                user_id: rows[0].user_id,
                latitude: rows[0].latitude,
                longitude: rows[0].longitude,
                geocoded_at: rows[0].geocoded_at
            }
        });
    } catch (err) {
        console.error('[Geocode] Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Redirect root to quotation page
app.get('/', (req, res) => {
    res.redirect('/quotation');
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Handle clean URLs (without .html extension)
app.get('*', (req, res) => {
    // Skip requests for static files
    if (req.path.includes('.')) {
        return res.status(404).send('Not Found');
    }

    // Try to serve index.html from the requested path
    const requestedPath = path.join(__dirname, 'public', req.path, 'index.html');
    
    res.sendFile(requestedPath, (err) => {
        if (err) {
            // If not found, try the path as-is with .html
            const htmlPath = path.join(__dirname, 'public', req.path + '.html');
            res.sendFile(htmlPath, (err2) => {
                if (err2) {
                    res.status(404).send(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>404 - Not Found</title>
                            <style>
                                body { 
                                    font-family: 'JetBrains Mono', monospace; 
                                    display: flex; 
                                    justify-content: center; 
                                    align-items: center; 
                                    height: 100vh; 
                                    margin: 0;
                                    background: #1a1a1a;
                                    color: #fff;
                                }
                                .error { 
                                    text-align: center;
                                    border: 3px solid #E63946;
                                    padding: 40px;
                                }
                                h1 { color: #E63946; margin: 0 0 10px 0; }
                                p { margin: 0; }
                                a { color: #F4D03F; }
                            </style>
                        </head>
                        <body>
                            <div class="error">
                                <h1>404</h1>
                                <p>Page not found</p>
                                <p style="margin-top: 20px;"><a href="/">Go to home</a></p>
                            </div>
                        </body>
                        </html>
                    `);
                }
            });
        }
    });
});

// Start server
app.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════╗');
    console.log('║     WE ÖTZI - Unified Server Running       ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log('');
    console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`  Port:        ${PORT}`);
    console.log(`  Local:       http://localhost:${PORT}`);
    console.log('');
    
    // Log configuration status
    console.log('  Configuration Status:');
    console.log('  ─────────────────────────────────────────');
    console.log(`  Supabase:     ${process.env.SUPABASE_URL ? 'Configured (env)' : 'Using file config'}`);
    console.log(`  Google Maps:  ${process.env.GOOGLE_MAPS_API_KEY ? 'Configured (env)' : 'Using file config'}`);
    console.log(`  n8n Webhook:  ${process.env.N8N_WEBHOOK_URL ? 'Configured (env)' : 'Using file config'}`);
    console.log(`  Demo Mode:    ${process.env.DEMO_MODE || 'Not set (check file)'}`);
    console.log('');
    
    console.log('  Routes available:');
    console.log('  ─────────────────────────────────────────');
    console.log(`  /registerclosedbeta    - Landing & Registration`);
    console.log(`  /register-artist       - Artist Registration Form`);
    console.log(`  /artist/dashboard      - Artist Dashboard`);
    console.log(`  /artist/profile        - Public Artist Profile`);
    console.log(`  /my-quotations         - Artist Quotations Panel`);
    console.log(`  /calendar              - Calendar View`);
    console.log(`  /archive               - Archived Quotations`);
    console.log(`  /quotation             - Quotation Form (Client)`);
    console.log(`  /marketplace           - Artists Marketplace`);
    console.log(`  /backoffice            - Admin Panel`);
    console.log(`  /support/login         - Support Login`);
    console.log(`  /support/dashboard     - Support Dashboard`);
    console.log(`  /tutorial              - Interactive Tour`);
    console.log('');
    console.log('  Client Portal:');
    console.log('  ─────────────────────────────────────────');
    console.log(`  /client/login          - Client Login`);
    console.log(`  /client/register       - Client Registration`);
    console.log(`  /client/dashboard      - Client Dashboard`);
    console.log('');
    console.log('  Job Board:');
    console.log('  ─────────────────────────────────────────');
    console.log('  /job-board             - Job Board (Public Feed)');
    console.log('  /job-board/request     - Publish Tattoo Request');
    console.log('');
});
