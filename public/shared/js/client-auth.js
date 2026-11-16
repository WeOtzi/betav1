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
const RETURN_TO_EXACT = ['/client/chats', '/client/chats/'];
// cot-detalle: enlace público de una cotización (/cotizacion/<token>). Al
// volver del login o del registro, esa página vincula la cotización a la cuenta.
const RETURN_TO_SHARED_QUOTE = /^\/cotizacion\/[A-Za-z0-9_-]{43}$/;

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
    // Inbox del cliente: el CTA del correo de chat (/client/chats?quote=…)
    // vuelve a la conversación después de iniciar sesión.
    if (pathPart.indexOf(RETURN_TO_PREFIX) !== 0 && RETURN_TO_EXACT.indexOf(pathPart) === -1
        && !RETURN_TO_SHARED_QUOTE.test(pathPart)) return null;
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
    // ?code= de PKCE; atención: "error_code=" (link vencido) NO es una vuelta de OAuth.
    let hasCode = false;
    try { hasCode = new URLSearchParams(String(loc.search || '').replace(/^\?/, '')).has('code'); } catch (_) { hasCode = false; }
    return String(loc.hash || '').includes('access_token') || hasCode;
}

// Se mira al cargar el script: supabase-js limpia el hash cuando lee la sesión
// (Google, Facebook o enlace mágico), y eso puede pasar antes de DOMContentLoaded.
const CLIENT_AUTH_CALLBACK_AT_LOAD = (() => { try { return isOAuthCallbackUrl(); } catch (_) { return false; } })();

function onClientLoginPage() {
    const loc = (typeof window !== 'undefined' && window.location) || {};
    return /\/client\/login\/?$/.test(String(loc.pathname || ''));
}

// Links entre login y registro: conservan ?returnTo= (también los que se
// insertan después, como el «Ingresa» del mensaje de email ya registrado).
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
        const label = RETURN_TO_SHARED_QUOTE.test(returnTo.split(/[?#]/)[0]) ? 'Ver mi cotización' : a.getAttribute('data-ca-return-label');
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

// ── confirmacion-email ─────────────────────────────────────────────
const CLIENT_CONFIRM_KEY = 'client-signup';

function clientConfirmRedirectUrl() {
    const EC = window.WeotziEmailConfirm;
    const params = { confirmado: '1', returnTo: readReturnTo() || '' };
    if (EC) return EC.redirectUrl('/client/register/', params);
    return window.location.origin + clientAppPath('/client/register/') + '?confirmado=1';
}

function clientSignupIsExistingAccount(data) {
    const user = data && data.user;
    return Boolean(user && Array.isArray(user.identities) && user.identities.length === 0);
}

function markPendingClientSignup(userId, email) {
    const EC = window.WeotziEmailConfirm;
    const quoteId = currentClientData?.quote_id || null;
    if (EC) EC.savePending(CLIENT_CONFIRM_KEY, { userId, email, quoteId, sentAt: Date.now() });
}

function readPendingClientSignup() {
    const EC = window.WeotziEmailConfirm;
    return EC ? EC.readPending(CLIENT_CONFIRM_KEY) : null;
}

// Al volver del link de confirmación (ya con sesión): enlaza las cotizaciones
// que quedaron esperando y limpia el marcador. Idempotente.
async function completePendingClientSignup(session) {
    const pending = readPendingClientSignup();
    if (!pending || !session?.user?.id) return false;
    if (pending.userId && pending.userId !== session.user.id) return false;
    const email = String(session.user.email || pending.email || '').toLowerCase();
    await linkQuotationsByEmail(session.user.id, email);
    const quoteId = pending.quoteId || currentClientData?.quote_id;
    if (quoteId) await linkQuotationById(session.user.id, quoteId);
    window.WeotziEmailConfirm?.clearPending(CLIENT_CONFIRM_KEY);
    try { localStorage.removeItem('weotzi_client_registration_data'); } catch (_) {}
    return true;
}

// Login con email sin confirmar: aviso con "Reenviar email" (DS).
function showClientEmailNotConfirmed(email) {
    const EC = window.WeotziEmailConfirm;
    const box = document.getElementById('form-message');
    if (!EC || !box) {
        showFormMessage('Confirma tu email antes de ingresar. Revisa tu bandeja de entrada.', 'error');
        return;
    }
    box.className = ''; // sin el marco de .form-message: el aviso trae el suyo
    EC.renderLoginNotice(box, { email, client: _supabase, redirectTo: clientConfirmRedirectUrl() });
    box.style.display = 'block';
}

// ── acceso (ACC-04): la bienvenida la decide el servidor
// (POST /api/account/welcome, wo-welcome.js): sale una sola vez cuando la
// cuenta ya está confirmada, también si se confirmó en otro dispositivo. Ya
// no depende de una marca en localStorage de este navegador.
async function sendPendingClientWelcome(user) {
    try { localStorage.removeItem('weotzi_pending_client_welcome'); } catch (_) { /* marca vieja */ }
    if (!user?.id || !window.WoWelcome || typeof window.WoWelcome.request !== 'function') return null;
    try {
        return await window.WoWelcome.request('client', { client: _supabase });
    } catch (_) {
        return null; // la bienvenida nunca bloquea el acceso
    }
}

// ── acceso (ACC-08): Términos del cliente.
// El alta por email los manda en options.data.terms_accepted y los sella
// handle_new_user con la hora de la base. Google/Facebook no permiten mandar
// metadatos: se recuerda la aceptación en esta pestaña antes de salir hacia el
// proveedor y, al volver con el perfil creado, el servidor la sella.
const CLIENT_TERMS_OAUTH_KEY = 'wo_client_terms_oauth';

function rememberClientTermsForOAuth() {
    try { sessionStorage.setItem(CLIENT_TERMS_OAUTH_KEY, String(Date.now())); } catch (_) { /* sin storage */ }
}

async function recordClientTerms(session, { onlyIfPending = false } = {}) {
    if (!session?.access_token) return false;
    if (onlyIfPending) {
        let pending = null;
        try { pending = sessionStorage.getItem(CLIENT_TERMS_OAUTH_KEY); } catch (_) { pending = null; }
        // Vale durante la ida y vuelta al proveedor (30 min como máximo).
        if (!pending || Date.now() - Number(pending) > 30 * 60 * 1000) return false;
    }
    try {
        const response = await fetch(clientAppPath('/api/account/terms'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
            body: JSON.stringify({ accepted: true })
        });
        if (response.ok) {
            try { sessionStorage.removeItem(CLIENT_TERMS_OAUTH_KEY); } catch (_) { /* noop */ }
        }
        return response.ok;
    } catch (_) {
        return false;
    }
}

// ── acceso (ACC-17): link vencido o ya usado en /client/login (enlace mágico).
function showClientLinkError(linkError) {
    const EC = window.WeotziEmailConfirm;
    const box = document.getElementById('form-message');
    if (!EC || !box || typeof EC.renderLinkErrorNotice !== 'function') {
        showFormMessage('El link venció o ya se usó. Pide uno nuevo o ingresa con tu contraseña.', 'error');
        return;
    }
    box.className = '';
    EC.renderLinkErrorNotice(box, {
        linkError,
        what: 'link de acceso',
        hint: 'Escribe tu email arriba y pide otro link, o ingresa con tu contraseña.',
        actions: [{ label: 'Enviarme otro link', onClick: () => handleClientMagicLink() }]
    });
    box.style.display = 'block';
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
    // ── confirmacion-email: se lee antes de cualquier await (el wizard lo
    // apaga al terminar y no tiene que disparar la redirección al panel).
    const wizardResumes = Boolean(window.WO_CLIENT_REGISTER_RESUME);

    // ── acceso: en /client/login la vuelta de Google, Facebook o del enlace
    // mágico la resuelve handleOAuthCallback (perfil, Términos, destino).
    if (onClientLoginPage() && (CLIENT_AUTH_CALLBACK_AT_LOAD || isOAuthCallbackUrl())) return;
    if (onClientLoginPage()) {
        const linkError = window.WeotziEmailConfirm?.readAuthLinkError?.() || null;
        if (linkError) showClientLinkError(linkError);
    }

    try {
        const { data: { session } } = await _supabase.auth.getSession();
        
        if (session) {
            // Volviendo de Google con returnTo: handleOAuthCallback crea el
            // perfil si falta y después redirige a la Store.
            if (returnTo && onAuthPage && isOAuthCallbackUrl()) return;

            // User is logged in - check if they are a client
            const { data: client, error } = await WeotziData.Clients.getByUserId(session.user.id);

            if (client) {
                await completePendingClientSignup(session).catch(() => false);
                void sendPendingClientWelcome(session.user);
                // El wizard retoma su borrador tras confirmar el email.
                if (onAuthPage && wizardResumes) {
                    currentClientData = client;
                    return;
                }
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
    // El wizard de /client/register hace su propio precargado visual; aquí solo
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
        throw new Error('Completa los campos obligatorios.');
    }
    // ACC-08: sin aceptar Términos y Privacidad no se crea la cuenta.
    if (payload.termsAccepted !== true) {
        throw new Error('Acepta los Términos y la Política de Privacidad para crear tu cuenta.');
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
        await recordClientTerms(login.session);
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
                allergies: currentClientData?.client_allergies || '',
                // handle_new_user sella terms_accepted_at con la hora de la
                // base y la versión vigente (nunca se copia una fecha de aquí).
                terms_accepted: true
            },
            // Con "Confirm email" activo, el link vuelve al wizard: retoma el
            // borrador (gustos, preferencias) y enlaza la cotización.
            emailRedirectTo: clientConfirmRedirectUrl()
        }
    });

    if (authError) throw authError;
    if (!authData.user) throw new Error('No pudimos crear la cuenta.');
    if (clientSignupIsExistingAccount(authData)) throw new Error('User already registered');

    // ── confirmacion-email: sin sesión = falta confirmar el email. No se asume
    // el modo de Supabase: se mira la respuesta. El perfil base lo crea el
    // trigger handle_new_user; el enlace de cotizaciones y el resto del perfil
    // se completan al volver del link (completePendingClientSignup).
    if (!authData.session) {
        markPendingClientSignup(authData.user.id, email);
        return Object.assign({}, authData.user, { pendingEmailConfirmation: true });
    }

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

    // ACC-08: respaldo del sello de handle_new_user (si el insert del trigger
    // falló, el perfil lo creó el navegador sin Términos). El servidor solo
    // sella si todavía no hay aceptación, con su propia hora.
    await recordClientTerms(authData.session);

    // Bienvenida: la decide y deduplica el servidor (POST /api/account/welcome).
    if (!signInError) await sendPendingClientWelcome(authData.user);

    // Clear quotation data from localStorage
    localStorage.removeItem('weotzi_client_registration_data');

    return authData.user;
}

// ============================================
// Link Quotations by Email
// ============================================

// cot-cliente (CC-02 / ACC-12): el vínculo lo hace el SERVIDOR con el email
// verificado de la sesión (POST /api/client/quotations/claim). Desde el
// navegador la RLS no deja ver ni reclamar cotizaciones sin dueño, y sin sesión
// (registro con confirmación pendiente) no hay nada que hacer aquí: al confirmar
// el email, el trigger on_email_confirmed_link_client_quotations las vincula.
// Los parámetros se conservan por compatibilidad con los llamadores.
// Los llamadores suelen pedir "por email" y "por id" seguidos: una sola llamada.
let lastGuestClaim = null;
function claimGuestQuotations() {
    if (lastGuestClaim && Date.now() - lastGuestClaim.at < 5000) return lastGuestClaim.promise;
    const promise = requestGuestClaim();
    lastGuestClaim = { at: Date.now(), promise };
    promise.then((result) => { if (!result) lastGuestClaim = null; });
    return promise;
}

async function requestGuestClaim() {
    try {
        if (!window.WeotziData || !window.WeotziData.Api || typeof window.WeotziData.Api.claimMine !== 'function') return null;
        const { data } = await _supabase.auth.getSession();
        const token = data && data.session && data.session.access_token;
        if (!token) return null;
        return await window.WeotziData.Api.claimMine(token);
    } catch (error) {
        // 403 = email sin confirmar: no es un error para el usuario.
        if (error && error.status !== 403) console.warn('No pudimos vincular cotizaciones:', error.message);
        return null;
    }
}

async function linkQuotationsByEmail(userId, email) { // eslint-disable-line no-unused-vars
    return claimGuestQuotations();
}

// ============================================
// Link Quotation by ID
// ============================================

// El quote_id de un borrador local no prueba que la cotización sea de esta
// cuenta: solo se vincula si coincide el email verificado (lo resuelve el claim).
async function linkQuotationById(userId, quoteId) { // eslint-disable-line no-unused-vars
    if (!userId || !quoteId) return null;
    return claimGuestQuotations();
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
        showFormMessage('Ingresa tu email y tu contraseña.', 'error');
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
        
        if (window.WeotziEmailConfirm?.isEmailNotConfirmedError(error) || /email not confirmed/i.test(error?.message || '')) {
            showClientEmailNotConfirmed(email);
            return;
        }

        let errorMessage = 'No pudimos iniciar sesión. Prueba de nuevo.';
        if (error.message.includes('Invalid login credentials')) {
            errorMessage = 'Email o contraseña incorrectos.';
        }
        
        showFormMessage(errorMessage, 'error');
    }
}

// ============================================
// Google OAuth Handler
// ============================================

// Google, Facebook y el enlace mágico vuelven a /client/login (con returnTo si
// vino de la Store): handleOAuthCallback crea el perfil si falta, sella los
// Términos, pide la bienvenida y lleva al panel o a la Store.
function clientAuthRedirectUrl() {
    const returnTo = readReturnTo();
    return window.location.origin + withReturnTo(clientAppPath('/client/login'), returnTo);
}

// En /client/register el botón de Google exige el checkbox de Términos; en
// /client/login el aviso "Al continuar… aceptas" acompaña a los botones.
function clientTermsGateForOAuth() {
    const box = document.getElementById('cw-terms');
    if (box && !box.checked) {
        box.focus();
        const msg = document.getElementById('cw-message');
        if (msg) {
            msg.textContent = 'Acepta los Términos y la Política de Privacidad para continuar.';
            msg.className = 'cw-message error';
        }
        return false;
    }
    // Solo cuenta como aceptación si la persona la vio: checkbox marcado o el
    // aviso legal junto a los botones (/client/login).
    if (box || document.querySelector('.ca-legal')) rememberClientTermsForOAuth();
    return true;
}

async function handleClientFacebookLogin() {
    clearFormMessage();
    if (!clientTermsGateForOAuth()) return;
    try {
        const { error } = await _supabase.auth.signInWithOAuth({
            provider: 'facebook',
            options: { redirectTo: clientAuthRedirectUrl(), scopes: 'email' }
        });
        if (error) throw error;
    } catch (error) {
        console.error('Facebook login error:', error);
        showFormMessage('No pudimos conectar con Facebook. Prueba de nuevo o ingresa con tu email.', 'error');
    }
}

// ── acceso (ACC-02): enlace mágico para clientes. Mensaje neutro también si
// el email no tiene cuenta (shouldCreateUser:false → "Signups not allowed").
async function handleClientMagicLink() {
    const input = document.getElementById('login-email');
    const email = String(input?.value || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        showFormMessage('Escribe tu email arriba y te mandamos un link de acceso, sin contraseña.', 'info');
        if (typeof focusClientEmailLogin === 'function') focusClientEmailLogin();
        else if (input) input.focus();
        return;
    }
    // Ronda 2 (N6): el ícono "Email" y el botón de texto visible comparten flujo.
    const magicButtons = ['btn-client-magic-link', 'btn-client-magic-link-text']
        .map((id) => document.getElementById(id)).filter(Boolean);
    magicButtons.forEach((b) => { b.disabled = true; b.setAttribute('aria-busy', 'true'); });
    let error = null;
    try {
        const res = await _supabase.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: false, emailRedirectTo: clientAuthRedirectUrl() }
        });
        error = res && res.error;
    } catch (err) {
        error = err || new Error('network');
    } finally {
        magicButtons.forEach((b) => { b.disabled = false; b.removeAttribute('aria-busy'); });
    }
    const EC = window.WeotziEmailConfirm;
    const outcome = EC && EC.magicLinkOutcome
        ? EC.magicLinkOutcome(error, email)
        : (error ? { ok: false, kind: 'error', message: 'No pudimos enviar el link de acceso. Prueba de nuevo en un momento.' }
            : { ok: true, kind: 'success', message: 'Si tienes una cuenta, te enviamos un link de acceso. Revisa tu correo.' });
    if (!outcome.ok) console.warn('Client magic link error:', error);
    showFormMessage(outcome.message, outcome.kind);
}

async function handleGoogleLogin() {
    if (!clientTermsGateForOAuth()) return;
    try {
        const redirectTo = clientAuthRedirectUrl();
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
        showFormMessage('No pudimos conectar con Google. Prueba de nuevo.', 'error');
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
    // Solo redirigimos, con el email prefilleado si ya lo escribieron.
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
                // ACC-08: aceptó Términos al tocar Google/Facebook en esta pestaña.
                await recordClientTerms(session, { onlyIfPending: true });
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
        await sendPendingClientWelcome(session.user);
        // Google con returnTo: después de crear o vincular el perfil, a la Store.
        // En /client/login (Google, Facebook o enlace mágico) siempre se sale
        // al panel o a la Store; en /client/register sigue el wizard.
        if (readReturnTo() || onClientLoginPage()) window.location.href = postAuthDestination();
    }
}

// Run OAuth callback handler on page load
document.addEventListener('DOMContentLoaded', () => {
    // Check if this is an OAuth callback
    if (CLIENT_AUTH_CALLBACK_AT_LOAD || isOAuthCallbackUrl()) {
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
        if (error) throw new Error('No pudimos procesar la solicitud. Prueba de nuevo en un momento.');
        return { success: true, message: 'Si existe una cuenta, recibirás un correo para recuperar el acceso.' };
    }
};
