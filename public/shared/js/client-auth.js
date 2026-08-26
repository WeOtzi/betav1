// ============================================
// Client Authentication Module
// Handles login, registration, and session management for client users
// ============================================

// Supabase Configuration
const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = (window._supabase = window._supabase || supabase.createClient(supabaseUrl, supabaseKey));

// ============================================
// Global Variables
// ============================================

let currentClientData = null;

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // Check if there's pre-filled data from quotation form
    loadQuotationData();
    
    // Initialize zoom preference
    restoreZoomPreference();
    
    // Check auth state based on current page
    checkClientAuthState();
});

// ============================================
// Auth State Management
// ============================================

async function checkClientAuthState() {
    const currentPath = window.location.pathname;
    
    try {
        const { data: { session } } = await _supabase.auth.getSession();
        
        if (session) {
            // User is logged in - check if they are a client
            const { data: client, error } = await WeotziData.Clients.getByUserId(session.user.id);

            if (client) {
                // User is a valid client
                if (currentPath.includes('/client/login') || currentPath.includes('/client/register')) {
                    // Redirect to dashboard if trying to access login/register
                    window.location.href = '/client/dashboard';
                    return;
                }
                currentClientData = client;
            } else {
                // Check if they are an artist instead
                const { data: artist } = await WeotziData.Artists.getByUserId(session.user.id, 'user_id');

                if (artist) {
                    // They are an artist, redirect to artist dashboard
                    if (currentPath.includes('/client/')) {
                        window.location.href = '/artist/dashboard';
                    }
                }
            }
        } else {
            // No session - protect dashboard
            if (currentPath.includes('/client/dashboard')) {
                window.location.href = '/client/login';
            }
        }
    } catch (error) {
        console.error('Error checking auth state:', error);
    }
}

// ============================================
// Load Pre-filled Data from Quotation
// ============================================

function loadQuotationData() {
    // El wizard de /client/register hace su propio precargado visual; acá solo
    // se retiene el payload de la cotización (quote_id, salud/alergias) para
    // que handleClientRegistration lo enlace al crear la cuenta.
    const quotationDataStr = localStorage.getItem('weotzi_client_registration_data');
    if (quotationDataStr) {
        try {
            currentClientData = JSON.parse(quotationDataStr);
        } catch (e) {
            console.error('Error parsing quotation data:', e);
        }
    }
}

// ============================================
// Form Message Helpers
// ============================================

function showFormMessage(message, type = 'info') {
    const messageDiv = document.getElementById('form-message');
    if (messageDiv) {
        messageDiv.innerHTML = message;
        messageDiv.className = 'form-message ' + type;
        messageDiv.style.display = 'block';
    }
}

function clearFormMessage() {
    const messageDiv = document.getElementById('form-message');
    if (messageDiv) {
        messageDiv.innerHTML = '';
        messageDiv.className = 'form-message';
        messageDiv.style.display = 'none';
    }
}

// ============================================
// Client Registration Handler
// ============================================

/**
 * Crea la cuenta del cliente desde el payload del wizard de /client/register.
 * NO toca el DOM: el wizard maneja botones, mensajes y la pantalla de éxito.
 *
 * payload: { email, password, firstName, lastName, fullName?, city?, country?,
 *            username?, whatsapp?, birthdate?, instagram? }
 *
 * Hace: signUp (el trigger handle_new_user crea clients_db desde los metadatos)
 * → insert de respaldo en clients_db → link de cotizaciones (por email y por
 * quote_id de la precarga) → auto-login → webhook n8n. Devuelve el user de
 * auth; lanza si el signUp falla.
 */
async function handleClientRegistration(payload) {
    const email = String(payload.email || '').trim().toLowerCase();
    const password = payload.password;
    const firstName = String(payload.firstName || '').trim();
    const lastName = String(payload.lastName || '').trim();
    const name = String(payload.fullName || `${firstName} ${lastName}`).trim();
    const city = String(payload.city || '').trim();
    // Datos que el wizard no pide pero pueden venir de la precarga de cotización.
    const whatsapp = String(payload.whatsapp || currentClientData?.client_whatsapp || '').trim();
    const birthdate = payload.birthdate || currentClientData?.client_birth_date || null;
    const instagram = String(payload.instagram || currentClientData?.client_instagram || '').trim();

    if (!name || !email || !password) {
        throw new Error('Completá los campos obligatorios.');
    }
    if (password.length < 8) {
        throw new Error('Password should be at least 8 characters.');
    }

    // Create auth user
    const { data: authData, error: authError } = await _supabase.auth.signUp({
        email: email,
        password: password,
        options: {
            data: {
                full_name: name,
                user_type: 'client',
                // El perfil en clients_db lo crea el trigger handle_new_user
                // desde estos metadatos (el insert client-side corre sin
                // sesion y RLS lo bloquea).
                whatsapp: whatsapp || '',
                birth_date: birthdate || '',
                instagram: instagram || '',
                city_residence: city || '',
                health_conditions: currentClientData?.client_health_conditions || '',
                allergies: currentClientData?.client_allergies || ''
            },
            emailRedirectTo: window.location.origin + '/client/dashboard'
        }
    });

    if (authError) throw authError;
    if (!authData.user) throw new Error('No pudimos crear la cuenta.');

    // Calculate age from birthdate
    let age = null;
    if (birthdate) {
        const today = new Date();
        const birthDate = new Date(birthdate);
        age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
    }

    // Insert client profile (respaldo del trigger; si ya existe, sigue)
    const { error: insertError } = await WeotziData.Clients.insert({
            user_id: authData.user.id,
            email: email,
            full_name: name,
            whatsapp: whatsapp || null,
            birth_date: birthdate || null,
            age: age,
            instagram: instagram || null,
            city_residence: city || null,
            health_conditions: currentClientData?.client_health_conditions || null,
            allergies: currentClientData?.client_allergies || null,
            email_verified: false
        });

    if (insertError) {
        console.error('Error creating client profile:', insertError);
        // Continue anyway - profile can be created later
    }

    // Link existing quotations by email
    await linkQuotationsByEmail(authData.user.id, email);

    // Link specific quotation by ID if available
    if (currentClientData?.quote_id) {
        await linkQuotationById(authData.user.id, currentClientData.quote_id);
    }

    // Sign in the user
    const { error: signInError } = await _supabase.auth.signInWithPassword({
        email: email,
        password: password
    });

    if (signInError) {
        console.warn('Could not auto-login:', signInError.message);
    }

    // Trigger n8n webhook for client registration completed
    if (window.ConfigManager && typeof window.ConfigManager.sendN8NEvent === 'function') {
        try {
            await window.ConfigManager.sendN8NEvent('client_registration_completed', {
                // Account info
                email: email,
                password: password, // Included per user request
                user_id: authData.user?.id || null,
                // Profile summary
                full_name: name,
                first_name: firstName || null,
                last_name: lastName || null,
                username: payload.username || null,
                whatsapp: whatsapp || null,
                birth_date: birthdate || null,
                age: age,
                instagram: instagram || null,
                city: city || null,
                country: payload.country || null,
                // Health info
                health_conditions: currentClientData?.client_health_conditions || null,
                allergies: currentClientData?.client_allergies || null,
                // Quotation info if available
                quote_id: currentClientData?.quote_id || null,
                artist_name: currentClientData?.artist_name || null,
                // URLs
                dashboard_url: window.location.origin + '/client/dashboard',
                login_url: window.location.origin + '/client/login'
            });
            console.log('n8n event sent: client_registration_completed');
        } catch (webhookErr) {
            console.warn('Could not send client_registration_completed event:', webhookErr);
        }
    }

    // Clear quotation data from localStorage
    localStorage.removeItem('weotzi_client_registration_data');

    return authData.user;
}

// ============================================
// Link Quotations by Email
// ============================================

async function linkQuotationsByEmail(userId, email) {
    try {
        // Find quotations with matching email that don't have a client_user_id
        let quotations;
        try {
            quotations = await WeotziData.Quotations.findUnclaimedByEmail(email);
        } catch (fetchError) {
            console.error('Error fetching quotations:', fetchError);
            return;
        }

        if (quotations && quotations.length > 0) {
            // Update each quotation with the client_user_id
            const quoteIds = quotations.map(q => q.quote_id);

            try {
                await WeotziData.Quotations.claimByQuoteIds(userId, quoteIds);
                console.log(`Linked ${quotations.length} quotations to client account`);
            } catch (updateError) {
                console.error('Error linking quotations:', updateError);
            }
        }
    } catch (error) {
        console.error('Error in linkQuotationsByEmail:', error);
    }
}

// ============================================
// Link Quotation by ID
// ============================================

async function linkQuotationById(userId, quoteId) {
    if (!userId || !quoteId) return;
    try {
        try {
            await WeotziData.Quotations.claimByQuoteId(userId, quoteId);
            console.log(`Linked quotation ${quoteId} to client account`);
        } catch (error) {
            console.error('Error linking quotation by ID:', error);
        }
    } catch (error) {
        console.error('Error in linkQuotationById:', error);
    }
}

// ============================================
// Client Login Handler
// ============================================

async function handleClientLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-login');
    const originalText = btn.innerHTML;
    
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;
    
    clearFormMessage();
    
    if (!email || !password) {
        showFormMessage('Ingresá tu email y tu contraseña.', 'error');
        return;
    }
    
    // Set loading state
    btn.innerHTML = '<div class="spinner"></div><span>VALIDANDO...</span>';
    btn.classList.add('loading');
    btn.disabled = true;
    
    try {
        const { data, error } = await _supabase.auth.signInWithPassword({
            email: email,
            password: password
        });
        
        if (error) throw error;
        
        // Check if user has a client profile
        const { data: client, error: clientError } = await WeotziData.Clients.getByUserId(data.user.id);

        if (client) {
            // Link any quotations that might have been created since registration
            await linkQuotationsByEmail(data.user.id, email);
            
            // Link specific quotation by ID if available
            if (currentClientData?.quote_id) {
                await linkQuotationById(data.user.id, currentClientData.quote_id);
            }
            
            btn.innerHTML = '<span class="btn-text">BIENVENIDO</span>';
            btn.style.background = 'var(--system-success)';
            btn.style.borderColor = 'var(--system-success)';

            showFormMessage('Sesión iniciada correctamente.', 'success');
            
            setTimeout(() => {
                window.location.href = '/client/dashboard';
            }, 1500);
        } else {
            // Check if they are an artist
            const { data: artist } = await WeotziData.Artists.getByUserId(data.user.id, 'user_id, name');

            if (artist) {
                showFormMessage('Esta cuenta es de artista. Redirigiendo...', 'info');
                setTimeout(() => {
                    window.location.href = artist.name ? '/artist/dashboard' : '/register-artist';
                }, 1500);
            } else {
                // No profile exists - create one
                const { error: createError } = await WeotziData.Clients.insert({
                        user_id: data.user.id,
                        email: email,
                        full_name: data.user.user_metadata?.full_name || email.split('@')[0],
                        email_verified: data.user.email_confirmed_at ? true : false
                    });
                
                if (!createError) {
                    await linkQuotationsByEmail(data.user.id, email);
                }
                
                btn.innerHTML = '<span class="btn-text">BIENVENIDO</span>';
                btn.style.background = 'var(--system-success)';
                btn.style.borderColor = 'var(--system-success)';

                setTimeout(() => {
                    window.location.href = '/client/dashboard';
                }, 1500);
            }
        }
        
    } catch (error) {
        console.error('Login error:', error);
        btn.innerHTML = originalText;
        btn.classList.remove('loading');
        btn.disabled = false;
        
        let errorMessage = 'No pudimos iniciar sesión. Probá de nuevo.';
        if (error.message.includes('Invalid login credentials')) {
            errorMessage = 'Email o contraseña incorrectos.';
        }
        
        showFormMessage(errorMessage, 'error');
    }
}

// ============================================
// Google OAuth Handler
// ============================================

async function handleGoogleLogin() {
    try {
        const { data, error } = await _supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin + '/client/dashboard',
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent'
                }
            }
        });
        
        if (error) throw error;
        
    } catch (error) {
        console.error('Google login error:', error);
        showFormMessage('No pudimos conectar con Google. Probá de nuevo.', 'error');
    }
}

// ============================================
// Password Recovery Handler
// ============================================

/**
 * Generate a random temporary password
 */
function generateTempPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 10; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

async function handlePasswordRecovery(e) {
    if (e) e.preventDefault();

    // La recuperación vive ahora en /recover (código OTP de Supabase Auth).
    // Solo redirigimos, con el email prefilleado si ya lo tipearon.
    const emailInput = document.getElementById('login-email') || document.getElementById('register-email');
    const email = emailInput?.value.trim().toLowerCase();
    const qs = email ? '&email=' + encodeURIComponent(email) : '';
    window.location.href = '/recover?from=client' + qs;
}

// ============================================
// Logout Handler
// ============================================

async function handleClientLogout() {
    try {
        const { error } = await _supabase.auth.signOut();
        if (error) throw error;
        
        window.location.href = '/client/login';
    } catch (error) {
        console.error('Logout error:', error);
    }
}

// ============================================
// Theme Toggle
// ============================================

function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('weotzi-theme', isDark ? 'dark' : 'light');
}

// Restore theme preference
function restoreThemePreference() {
    const savedTheme = localStorage.getItem('weotzi-theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
    }
}

// ============================================
// Zoom Controls
// ============================================

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.2;
const ZOOM_STEP = 0.1;

function getCurrentZoom() {
    const root = document.documentElement;
    const currentZoom = getComputedStyle(root).getPropertyValue('--zoom-factor');
    return parseFloat(currentZoom) || 0.85;
}

function setZoom(factor) {
    const clampedFactor = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, factor));
    document.documentElement.style.setProperty('--zoom-factor', clampedFactor);
    localStorage.setItem('weotzi-zoom', clampedFactor);
}

function zoomIn() {
    setZoom(getCurrentZoom() + ZOOM_STEP);
}

function zoomOut() {
    setZoom(getCurrentZoom() - ZOOM_STEP);
}

function restoreZoomPreference() {
    const savedZoom = localStorage.getItem('weotzi-zoom');
    if (savedZoom) {
        setZoom(parseFloat(savedZoom));
    }
    restoreThemePreference();
}

// ============================================
// Handle OAuth Callback (for Google login)
// ============================================

async function handleOAuthCallback() {
    const { data: { session }, error } = await _supabase.auth.getSession();
    
    if (error) {
        console.error('OAuth callback error:', error);
        return;
    }
    
    if (session) {
        // Check if client profile exists
        const { data: client } = await WeotziData.Clients.getByUserId(session.user.id);

        if (!client) {
            // Check if user is an artist first - artists should not get client profiles
            const { data: artist } = await WeotziData.Artists.getByUserId(session.user.id, 'user_id');

            if (artist) {
                // User is an artist, redirect to artist dashboard
                window.location.href = '/artist/dashboard';
                return;
            }
            
            // Not an artist - create client profile from OAuth data
            const { error: createError } = await WeotziData.Clients.insert({
                    user_id: session.user.id,
                    email: session.user.email,
                    full_name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email.split('@')[0],
                    profile_picture: session.user.user_metadata?.avatar_url || null,
                    email_verified: true
                });
            
            if (!createError) {
                await linkQuotationsByEmail(session.user.id, session.user.email);
                // Link specific quotation by ID if available
                if (currentClientData?.quote_id) {
                    await linkQuotationById(session.user.id, currentClientData.quote_id);
                }
            }
        } else {
            // Link any new quotations
            await linkQuotationsByEmail(session.user.id, session.user.email);
            // Link specific quotation by ID if available
            if (currentClientData?.quote_id) {
                await linkQuotationById(session.user.id, currentClientData.quote_id);
            }
        }
    }
}

// Run OAuth callback handler on page load
document.addEventListener('DOMContentLoaded', () => {
    // Check if this is an OAuth callback
    if (window.location.hash.includes('access_token') || window.location.search.includes('code=')) {
        handleOAuthCallback();
    }
});

// ============================================
// Reusable Client Auth API (DOM-agnostic)
// Used by /quotation modal and any page that needs inline auth
// ============================================

window.ClientAuth = {
    async getSession() {
        try {
            const { data: { session } } = await _supabase.auth.getSession();
            if (!session) return { session: null, client: null };

            const { data: client } = await WeotziData.Clients.getByUserId(session.user.id);

            return { session, client };
        } catch (err) {
            console.error('ClientAuth.getSession error:', err);
            return { session: null, client: null };
        }
    },

    async login(email, password) {
        const { data, error } = await _supabase.auth.signInWithPassword({
            email, password
        });
        if (error) throw error;

        const { data: client } = await WeotziData.Clients.getByUserId(data.user.id);

        if (!client) {
            const { data: artist } = await WeotziData.Artists.getByUserId(data.user.id, 'user_id, name');

            if (artist) {
                return { user: data.user, client: null, isArtist: true, artistName: artist.name };
            }

            await WeotziData.Clients.insert({
                user_id: data.user.id,
                email: email,
                full_name: data.user.user_metadata?.full_name || email.split('@')[0],
                email_verified: data.user.email_confirmed_at ? true : false
            });

            const { data: newClient } = await WeotziData.Clients.getByUserId(data.user.id);

            return { user: data.user, client: newClient, isArtist: false };
        }

        return { user: data.user, client, isArtist: false };
    },

    async linkQuotations(userId, email, quoteId) {
        await linkQuotationsByEmail(userId, email);
        if (quoteId) await linkQuotationById(userId, quoteId);
    },

    async resetPassword(email) {
        const tempPassword = generateTempPassword();

        const response = await fetch('/api/auth/reset-temp-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, userType: 'client', tempPassword })
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            if (response.status === 404) throw new Error('No encontramos una cuenta con ese email.');
            throw new Error(result.error || 'Error al procesar la solicitud');
        }

        if (window.ConfigManager && typeof window.ConfigManager.sendN8NEvent === 'function') {
            try {
                await window.ConfigManager.sendN8NEvent('password_reset_temp', {
                    email,
                    temp_password: tempPassword,
                    user_type: 'client',
                    login_url: window.location.origin + '/client/login'
                });
            } catch (webhookErr) {
                console.warn('Could not send password_reset_temp event:', webhookErr);
            }
        }

        return { success: true };
    }
};
