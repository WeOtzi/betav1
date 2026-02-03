// ============================================
// Client Authentication Module
// Handles login, registration, and session management for client users
// ============================================

// Supabase Configuration
const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

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
            const { data: client, error } = await _supabase
                .from('clients_db')
                .select('*')
                .eq('user_id', session.user.id)
                .maybeSingle();
            
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
                const { data: artist } = await _supabase
                    .from('artists_db')
                    .select('user_id')
                    .eq('user_id', session.user.id)
                    .maybeSingle();
                
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
    const quotationDataStr = localStorage.getItem('weotzi_client_registration_data');
    if (quotationDataStr) {
        try {
            const quotationData = JSON.parse(quotationDataStr);
            
            // Pre-fill form fields if they exist
            const nameInput = document.getElementById('register-name');
            const emailInput = document.getElementById('register-email');
            const whatsappInput = document.getElementById('register-whatsapp');
            const birthdateInput = document.getElementById('register-birthdate');
            const instagramInput = document.getElementById('register-instagram');
            const cityInput = document.getElementById('register-city');
            
            if (nameInput && quotationData.client_full_name) {
                nameInput.value = quotationData.client_full_name;
            }
            if (emailInput && quotationData.client_email) {
                emailInput.value = quotationData.client_email;
            }
            if (whatsappInput && quotationData.client_whatsapp) {
                whatsappInput.value = quotationData.client_whatsapp;
            }
            if (birthdateInput && quotationData.client_birth_date) {
                birthdateInput.value = quotationData.client_birth_date;
            }
            if (instagramInput && quotationData.client_instagram) {
                instagramInput.value = quotationData.client_instagram;
            }
            if (cityInput && quotationData.client_city_residence) {
                cityInput.value = quotationData.client_city_residence;
            }
            
            // Store for later use
            currentClientData = quotationData;
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

async function handleClientRegistration(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-register');
    const originalText = btn.innerHTML;
    
    // Get form values
    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim().toLowerCase();
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm-password').value;
    const whatsapp = document.getElementById('register-whatsapp')?.value.trim() || '';
    const birthdate = document.getElementById('register-birthdate')?.value || null;
    const instagram = document.getElementById('register-instagram')?.value.trim() || '';
    const city = document.getElementById('register-city')?.value.trim() || '';
    
    clearFormMessage();
    
    // Validation
    if (!name || !email || !password) {
        showFormMessage('Por favor completa todos los campos obligatorios.', 'error');
        return;
    }
    
    if (password !== confirmPassword) {
        showFormMessage('Las contrasenas no coinciden.', 'error');
        return;
    }
    
    if (password.length < 6) {
        showFormMessage('La contrasena debe tener al menos 6 caracteres.', 'error');
        return;
    }
    
    // Set loading state
    btn.innerHTML = '<div class="spinner"></div><span>REGISTRANDO...</span>';
    btn.classList.add('loading');
    btn.disabled = true;
    
    try {
        // Create auth user
        const { data: authData, error: authError } = await _supabase.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    full_name: name,
                    user_type: 'client'
                },
                emailRedirectTo: window.location.origin + '/client/dashboard'
            }
        });
        
        if (authError) throw authError;
        
        if (authData.user) {
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
            
            // Insert client profile
            const { error: insertError } = await _supabase
                .from('clients_db')
                .insert({
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
                        whatsapp: whatsapp || null,
                        birth_date: birthdate || null,
                        age: age,
                        instagram: instagram || null,
                        city: city || null,
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
            
            // Success
            btn.innerHTML = '<span class="btn-text">CUENTA CREADA</span>';
            btn.style.background = '#4CAF50';
            
            showFormMessage('Cuenta creada exitosamente. Redirigiendo...', 'success');
            
            setTimeout(() => {
                window.location.href = '/client/dashboard';
            }, 1500);
        }
        
    } catch (error) {
        console.error('Registration error:', error);
        btn.innerHTML = originalText;
        btn.classList.remove('loading');
        btn.disabled = false;
        
        let errorMessage = 'Error al crear la cuenta. Por favor, intenta de nuevo.';
        if (error.message.includes('already registered')) {
            errorMessage = 'Este email ya esta registrado. <a href="/client/login">Iniciar sesion</a>';
        } else if (error.message.includes('Invalid email')) {
            errorMessage = 'El email ingresado no es valido.';
        }
        
        showFormMessage(errorMessage, 'error');
    }
}

// ============================================
// Link Quotations by Email
// ============================================

async function linkQuotationsByEmail(userId, email) {
    try {
        // Find quotations with matching email that don't have a client_user_id
        const { data: quotations, error: fetchError } = await _supabase
            .from('quotations_db')
            .select('quote_id')
            .ilike('client_email', email)
            .is('client_user_id', null);
        
        if (fetchError) {
            console.error('Error fetching quotations:', fetchError);
            return;
        }
        
        if (quotations && quotations.length > 0) {
            // Update each quotation with the client_user_id
            const quoteIds = quotations.map(q => q.quote_id);
            
            const { error: updateError } = await _supabase
                .from('quotations_db')
                .update({ client_user_id: userId })
                .in('quote_id', quoteIds);
            
            if (updateError) {
                console.error('Error linking quotations:', updateError);
            } else {
                console.log(`Linked ${quotations.length} quotations to client account`);
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
        const { error } = await _supabase
            .from('quotations_db')
            .update({ client_user_id: userId })
            .eq('quote_id', quoteId)
            .is('client_user_id', null);
        
        if (error) {
            console.error('Error linking quotation by ID:', error);
        } else {
            console.log(`Linked quotation ${quoteId} to client account`);
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
        showFormMessage('Por favor ingresa tu email y contrasena.', 'error');
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
        const { data: client, error: clientError } = await _supabase
            .from('clients_db')
            .select('*')
            .eq('user_id', data.user.id)
            .maybeSingle();
        
        if (client) {
            // Link any quotations that might have been created since registration
            await linkQuotationsByEmail(data.user.id, email);
            
            // Link specific quotation by ID if available
            if (currentClientData?.quote_id) {
                await linkQuotationById(data.user.id, currentClientData.quote_id);
            }
            
            btn.innerHTML = '<span class="btn-text">BIENVENIDO</span>';
            btn.style.background = '#4CAF50';
            
            showFormMessage('Sesion iniciada correctamente.', 'success');
            
            setTimeout(() => {
                window.location.href = '/client/dashboard';
            }, 1500);
        } else {
            // Check if they are an artist
            const { data: artist } = await _supabase
                .from('artists_db')
                .select('user_id, name')
                .eq('user_id', data.user.id)
                .maybeSingle();
            
            if (artist) {
                showFormMessage('Esta cuenta es de artista. Redirigiendo...', 'info');
                setTimeout(() => {
                    window.location.href = artist.name ? '/artist/dashboard' : '/register-artist';
                }, 1500);
            } else {
                // No profile exists - create one
                const { error: createError } = await _supabase
                    .from('clients_db')
                    .insert({
                        user_id: data.user.id,
                        email: email,
                        full_name: data.user.user_metadata?.full_name || email.split('@')[0],
                        email_verified: data.user.email_confirmed_at ? true : false
                    });
                
                if (!createError) {
                    await linkQuotationsByEmail(data.user.id, email);
                }
                
                btn.innerHTML = '<span class="btn-text">BIENVENIDO</span>';
                btn.style.background = '#4CAF50';
                
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
        
        let errorMessage = 'Error al iniciar sesion.';
        if (error.message.includes('Invalid login credentials')) {
            errorMessage = 'Email o contrasena incorrectos.';
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
        showFormMessage('Error al conectar con Google. Por favor, intenta de nuevo.', 'error');
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
    
    const emailInput = document.getElementById('login-email') || document.getElementById('register-email');
    const email = emailInput?.value.trim().toLowerCase();
    
    if (!email) {
        showFormMessage('Por favor ingresa tu email para recuperar tu contrasena.', 'info');
        return;
    }
    
    showFormMessage('Procesando solicitud...', 'info');
    
    try {
        // Generate a temporary password
        const tempPassword = generateTempPassword();
        
        // Call backend to reset password
        const response = await fetch('/api/auth/reset-temp-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                userType: 'client',
                tempPassword: tempPassword
            })
        });
        
        const result = await response.json();
        
        if (!response.ok || !result.success) {
            if (response.status === 404) {
                throw new Error('No encontramos una cuenta con ese email.');
            }
            throw new Error(result.error || 'Error al procesar la solicitud');
        }
        
        // Trigger n8n webhook to send email with temp password
        if (window.ConfigManager && typeof window.ConfigManager.sendN8NEvent === 'function') {
            try {
                await window.ConfigManager.sendN8NEvent('password_reset_temp', {
                    email: email,
                    temp_password: tempPassword,
                    user_type: 'client',
                    login_url: window.location.origin + '/client/login'
                });
                console.log('n8n event sent: password_reset_temp (client)');
            } catch (webhookErr) {
                console.warn('Could not send password_reset_temp event:', webhookErr);
            }
        }
        
        showFormMessage('Te hemos enviado un email con tu nueva contrasena temporal.', 'success');
        
    } catch (error) {
        console.error('Password recovery error:', error);
        showFormMessage(error.message || 'Error al procesar la solicitud.', 'error');
    }
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
        const { data: client } = await _supabase
            .from('clients_db')
            .select('*')
            .eq('user_id', session.user.id)
            .maybeSingle();
        
        if (!client) {
            // Create client profile from OAuth data
            const { error: createError } = await _supabase
                .from('clients_db')
                .insert({
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
