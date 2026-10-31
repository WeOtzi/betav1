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
// returnTo (Store: /store/checkout, /store/purchases, /store/license…)
// ============================================
// Solo se aceptan paths del mismo origen bajo /store/ (sin base path, sin
// esquema, sin //host, sin barras invertidas, sin segmentos . o ..). Sin un
// returnTo válido, todo sigue yendo a /client/dashboard como siempre.

const RETURN_TO_PARAM = 'returnTo';
const RETURN_TO_PREFIX = '/store/';

function clientBasePath() {
    const w = typeof window !== 'undefined' ? window : {};
    if (w.WEOTZI_BASE_PATH) return String(w.WEOTZI_BASE_PATH).replace(/\/$/, '');
    const pathname = (w.location && w.location.pathname) || '';
    return /^\/beta(?:\/|$)/.test(pathname) ? '/beta' : '';
}

// Agrega el base path (/beta, preview) a una ruta absoluta del producto. Idempotente.
function clientAppPath(path) {
    const base = clientBasePath();
    const s = String(path || '');
    if (!base || s.charAt(0) !== '/' || s.charAt(1) === '/' || s === base || s.indexOf(base + '/') === 0) return s;
    return base + s;
}

// '/store/item/?id=1' → '/store/item/?id=1' · 'https://otro.com/x', '//x',
// '/client/dashboard', '/store/../client' → null.
function normalizeReturnTo(value) {
    if (value == null) return null;
    let s = String(value).trim();
    if (!s || s.length > 2048) return null;
    // Controles, espacios internos y barras invertidas ('/\otro.com' = //otro.com).
    if (/[\u0000-\u001F\u007F\s\\]/.test(s)) return null;
    // Solo paths: nada de esquemas (https:, javascript:, data:) ni //host.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) || s.charAt(0) !== '/' || s.charAt(1) === '/') return null;
    const base = clientBasePath();
    if (base && (s === base || s.indexOf(base + '/') === 0)) s = s.slice(base.length) || '/';
    const cut = s.search(/[?#]/);
    let pathPart = cut === -1 ? s : s.slice(0, cut);
    const rest = cut === -1 ? '' : s.slice(cut);
    // Puntos y barras codificados: se rechazan para no resolver «..» escondidos.
    if (/%(2e|2f|5c)/i.test(pathPart)) return null;
    if (pathPart.split('/').some((seg) => seg === '.' || seg === '..')) return null;
    if (pathPart === '/store') pathPart = RETURN_TO_PREFIX;
    if (pathPart.indexOf(RETURN_TO_PREFIX) !== 0) return null;
    return pathPart + rest;
}

function readReturnTo(search) {
    try {
        const source = search != null ? search : ((typeof window !== 'undefined' && window.location && window.location.search) || '');
        return normalizeReturnTo(new URLSearchParams(source).get(RETURN_TO_PARAM));
    } catch (_) {
        return null;
    }
}

// Destino después de ingresar: el returnTo (con base path) o el default de siempre.
function postAuthDestination(fallback = '/client/dashboard') {
    const returnTo = readReturnTo();
    return returnTo ? clientAppPath(returnTo) : fallback;
}

function isOAuthCallbackUrl() {
    const loc = (typeof window !== 'undefined' && window.location) || {};
    return String(loc.hash || '').includes('access_token') || String(loc.search || '').includes('code=');
}

// Links entre login y registro: conservan ?returnTo= (también los que se
// insertan después, como el «Ingresá» del mensaje de email ya registrado).
function withReturnTo(href, returnTo) {
    if (!href || !returnTo) return href;
    const raw = String(href);
    const hashAt = raw.indexOf('#');
    const main = hashAt === -1 ? raw : raw.slice(0, hashAt);
    const hash = hashAt === -1 ? '' : raw.slice(hashAt);
    const qAt = main.indexOf('?');
    const path = qAt === -1 ? main : main.slice(0, qAt);
    const params = new URLSearchParams(qAt === -1 ? '' : main.slice(qAt + 1));
    params.set(RETURN_TO_PARAM, returnTo);
    return path + '?' + params.toString() + hash;
}

function isClientAuthLink(href) {
    const raw = String(href || '');
    if (!raw || raw.charAt(0) !== '/' || raw.charAt(1) === '/') return false;
    const base = clientBasePath();
    let path = raw.split(/[?#]/)[0];
    if (base && path.indexOf(base + '/') === 0) path = path.slice(base.length);
    return /^\/client\/(login|register)\/?$/.test(path);
}

function propagateReturnTo(root) {
    const returnTo = readReturnTo();
    if (!returnTo || !root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href');
        if (isClientAuthLink(href)) a.setAttribute('href', withReturnTo(href, returnTo));
    });
    // CTA de la pantalla de éxito del registro: vuelve a la Store.
    root.querySelectorAll('[data-ca-return-link]').forEach((a) => {
        a.setAttribute('href', clientAppPath(returnTo));
        const label = a.getAttribute('data-ca-return-label');
        if (!label) return;
        const textNode = Array.prototype.find.call(a.childNodes, (n) => n.nodeType === 3 && n.textContent.trim());
        if (textNode) textNode.textContent = label + ' ';
    });
}

if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', () => propagateReturnTo(document));
    document.addEventListener('click', (e) => {
        const target = e && e.target;
        const a = target && typeof target.closest === 'function' ? target.closest('a[href]') : null;
        if (!a) return;
        const returnTo = readReturnTo();
        const href = a.getAttribute('href');
        if (returnTo && isClientAuthLink(href) && href.indexOf(RETURN_TO_PARAM + '=') === -1) {
            a.setAttribute('href', withReturnTo(href, returnTo));
        }
    }, true);
}

async function ensureClientMode(session) {
    const response = await fetch('/api/account/mode', {method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({mode:'client'})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No pudimos activar el modo cliente.');
}

async function sendPendingClientWelcome(user) {
    if (!user?.id || !window.ConfigManager?.sendN8NEvent) return;
    try {
        if (localStorage.getItem('weotzi_pending_client_welcome') !== user.id) return;
        const result = window.EmailClient?.sendEmail
            ? await window.EmailClient.sendEmail('client_registration_completed', {}, { keepalive: true })
            : await window.ConfigManager.sendN8NEvent('client_registration_completed', {});
        if (result?.success) localStorage.removeItem('weotzi_pending_client_welcome');
    } catch (_) {
        // The profile remains usable; the pending marker is retained for login.
    }
}

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
    const onAuthPage = currentPath.includes('/client/login') || currentPath.includes('/client/register');
    const returnTo = readReturnTo();
    
    try {
        const { data: { session } } = await _supabase.auth.getSession();
        
        if (session) {
            // Volviendo de Google con returnTo: handleOAuthCallback crea el
            // perfil si falta y después redirige a la Store.
            if (returnTo && onAuthPage && isOAuthCallbackUrl()) return;

            // User is logged in - check if they are a client
            const { data: client, error } = await WeotziData.Clients.getByUserId(session.user.id);

            if (client) {
                void sendPendingClientWelcome(session.user);
                // User is a valid client
                if (onAuthPage) {
                    // Redirect to dashboard (o al returnTo de la Store) if trying to access login/register
                    window.location.href = postAuthDestination();
                    return;
                }
                currentClientData = client;
            } else {
                // Check if they are an artist instead
                const { data: artist } = await WeotziData.Artists.getByUserId(session.user.id, 'user_id');

                if (artist) {
                    // La Store acepta cuentas de artista: con returnTo vuelve
                    // ahí sin cambiar el modo de la cuenta.
                    if (returnTo && onAuthPage) {
                        window.location.href = postAuthDestination();
                        return;
                    }
                    // They are an artist, redirect to artist dashboard
                    if (currentPath.includes('/client/')) {
                        await ensureClientMode(session);
                        window.location.href = '/client/dashboard';
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
    const testing = await fetch('/api/account/testing').then(r => r.json()).catch(() => ({registrationOpen:false}));
    if (testing.registrationOpen) {
        const response = await fetch('/api/register/test-client',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,full_name:name})});
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'No pudimos crear la cuenta.');
        const {data:login,error:loginError} = await _supabase.auth.signInWithPassword({email,password});
        if (loginError) throw loginError;
        await WeotziData.Clients.updateByUserId(login.user.id,{city_residence:city||null,whatsapp:whatsapp||null});
        localStorage.setItem('weotzi_pending_client_welcome',login.user.id);
        await sendPendingClientWelcome(login.user);
        localStorage.removeItem('weotzi_client_registration_data');
        return login.user;
    }
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
            emailRedirectTo: window.location.origin + postAuthDestination()
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

    // Persist a non-secret marker while email confirmation prevents a session.
    // Retry after authenticated login; the server ledger prevents duplicates.
    try { localStorage.setItem('weotzi_pending_client_welcome', authData.user.id); } catch (_) {}
    if (!signInError) await sendPendingClientWelcome(authData.user);

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
            void sendPendingClientWelcome(data.user);
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
                window.location.href = postAuthDestination();
            }, 1500);
        } else {
            // Check if they are an artist
            const { data: artist } = await WeotziData.Artists.getByUserId(data.user.id, 'user_id, name');

            if (artist) {
                // Con returnTo (Store) el artista vuelve a comprar sin cambiar
                // el modo de su cuenta.
                const returnTo = readReturnTo();
                if (!returnTo) await ensureClientMode(data.session);
                showFormMessage(returnTo ? 'Sesión iniciada correctamente.' : 'Modo cliente activado.', 'success');
                setTimeout(() => {
                    window.location.href = postAuthDestination();
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
                    window.location.href = postAuthDestination();
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
        // Con returnTo, Google vuelve al login (que crea el perfil si falta y
        // redirige a la Store); sin returnTo, al dashboard como siempre.
        const returnTo = readReturnTo();
        const redirectTo = returnTo
            ? window.location.origin + withReturnTo(clientAppPath('/client/login'), returnTo)
            : window.location.origin + '/client/dashboard';
        const { data, error } = await _supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo,
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
    const basePath = window.WEOTZI_BASE_PATH || (/^\/beta(?:\/|$)/.test(window.location.pathname) ? '/beta' : '');
    window.location.href = basePath + '/recover?from=client' + qs;
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
                // User is an artist, redirect to artist dashboard (o a la Store
                // si vino con returnTo: la Store acepta cuentas de artista)
                window.location.href = readReturnTo() ? postAuthDestination() : '/artist/dashboard';
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
        void sendPendingClientWelcome(session.user);
        // Google con returnTo: después de crear o vincular el perfil, a la Store.
        if (readReturnTo()) window.location.href = postAuthDestination();
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

            if (client) void sendPendingClientWelcome(session.user);
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

        void sendPendingClientWelcome(data.user);
        return { user: data.user, client, isArtist: false };
    },

    async linkQuotations(userId, email, quoteId) {
        await linkQuotationsByEmail(userId, email);
        if (quoteId) await linkQuotationById(userId, quoteId);
    },

    // returnTo de la Store (ver normalizeReturnTo arriba).
    normalizeReturnTo,
    readReturnTo,
    postAuthDestination,

    async resetPassword(email) {
        // Recovery verifies ownership before changing the password. It shares the
        // same OTP delivery path as /recover and never sends credentials twice.
        const { error } = await _supabase.auth.resetPasswordForEmail(String(email || '').trim().toLowerCase());
        if (error) throw new Error('No pudimos procesar la solicitud. Probá de nuevo en un momento.');
        return { success: true, message: 'Si existe una cuenta, recibirás un correo para recuperar el acceso.' };
    }
};
