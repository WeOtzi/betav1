// ============================================
// Artist Authentication Module — /artist/login
// Figma final del flujo de artista (oct 2026):
//   801:585   Iniciar sesión - Email y redes sociales
//   2001:3334 Iniciar sesión - usuario registrado ("Ya iniciaste sesión")
//   801:1099 / 2001:3335 loader post-auth (v1 login · v2 sesión activa)
// Maneja login con email/contraseña, link de acceso por email (OTP de
// Supabase), OAuth de Facebook, la vista de sesión activa y el logout.
// UI: design system Bauhaus (wo-*) — /shared/css/artist-auth-ds.css
// ============================================

const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = (window._supabase = window._supabase || supabase.createClient(supabaseUrl, supabaseKey));
const AUTH_REQUEST_TIMEOUT_MS = 10000;
const PROFILE_LOOKUP_TIMEOUT_MS = 8000;
const POSTAUTH_DELAY_MS = 1400;

const ARTIST_PROFILE_SELECT = [
    'user_id',
    'username',
    'name',
    'email',
    'ubicacion',
    'styles_array',
    'estilo',
    'years_experience',
    'session_price',
    'portafolio',
    'instagram',
    'work_type',
    'estudios',
    'birth_date',
    'subscribed_newsletter',
    'ms_profile_complete',
    'profile_completeness'
].join(', ');

// ============================================
// Helpers
// ============================================

// Prefijo de la app (/beta en producción, /preview/<id> en el preview local).
function artistLoginBasePath() {
    if (window.WEOTZI_BASE_PATH) return String(window.WEOTZI_BASE_PATH).replace(/\/$/, '');
    return /^\/beta(?:\/|$)/.test(window.location.pathname) ? '/beta' : '';
}

function appPath(path) {
    const normalized = String(path || '/').startsWith('/') ? String(path || '/') : '/' + String(path || '');
    const base = artistLoginBasePath();
    if (base && (normalized === base || normalized.startsWith(base + '/'))) return normalized;
    return base + normalized;
}

function isPreviewContext() {
    if (window.WEOTZI_PREVIEW === true) return true;
    try { return window.sessionStorage.getItem('wo_demo_mode') === '1'; } catch (_) { return false; }
}

function normalizeReturnTo(value) {
    if (window.ArtistAuth?.normalizeReturnTo) {
        return window.ArtistAuth.normalizeReturnTo(value, '');
    }
    if (!value || typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '';
    if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(trimmed)) return '';
    return trimmed;
}

function getReturnToParam() {
    const raw = new URLSearchParams(window.location.search || '').get('returnTo');
    return normalizeReturnTo(raw);
}

function getArtistProgress(artist) {
    if (window.ArtistRegistrationProgress?.analyzeArtistProfile) {
        return window.ArtistRegistrationProgress.analyzeArtistProfile(artist);
    }
    const hasName = Boolean(artist && String(artist.name || '').trim());
    return {
        isComplete: hasName,
        nextStep: hasName ? null : 2
    };
}

function buildRegisterArtistUrl(progress) {
    const baseUrl = '/register-artist';
    if (window.ArtistRegistrationProgress?.withResumeStep) {
        return window.ArtistRegistrationProgress.withResumeStep(baseUrl, progress?.nextStep || null);
    }
    return baseUrl;
}

// Loader post-auth (Figma 801:1099). Sin el script cargado, redirige directo.
function goWithPostAuthLoader(targetPath, { role = 'artist', variant = 'v1' } = {}) {
    const url = appPath(targetPath);
    if (window.WoPostAuthLoader && typeof window.WoPostAuthLoader.show === 'function') {
        window.WoPostAuthLoader.show({ role, targetUrl: url, variant, delayMs: POSTAUTH_DELAY_MS });
    } else {
        window.location.href = url;
    }
}

// Mensajes de estado — usan las clases wo-alert del DS.
function setAuthMessage(id, message, type = 'info') {
    const el = document.getElementById(id);
    if (!el) return;
    if (!message) {
        el.hidden = true;
        el.textContent = '';
        el.className = 'wo-auth-message';
        return;
    }
    const tone = type === 'success' ? 'success' : (type === 'error' ? 'error' : 'info');
    el.innerHTML = message;
    el.className = 'wo-auth-message wo-alert wo-alert--' + tone;
    el.hidden = false;
}

function showFormMessage(message, type = 'info') {
    setAuthMessage('form-message', message, type);
}

function clearFormMessage() {
    setAuthMessage('form-message', '');
}

function withArtistLoginTimeout(promise, timeoutMs, label) {
    let timeoutId = null;
    const timeout = new Promise((resolve) => {
        timeoutId = setTimeout(() => {
            resolve({
                timedOut: true,
                error: new Error(`${label} timed out after ${timeoutMs}ms`)
            });
        }, timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
    });
}

async function lookupArtistProfile(userId) {
    const { data, error, timedOut } = await withArtistLoginTimeout(WeotziData.Artists.getByUserId(userId, ARTIST_PROFILE_SELECT), PROFILE_LOOKUP_TIMEOUT_MS, 'Artist profile lookup');
    if (timedOut) {
        console.warn('Artist lookup timed out.');
        return null;
    }
    if (error && error.code !== 'PGRST116') {
        console.warn('Artist lookup error:', error);
    }
    return data || null;
}

async function lookupClientProfile(userId) {
    const { data, error, timedOut } = await withArtistLoginTimeout(
        WeotziData.Clients.getByUserId(userId, 'user_id'),
        PROFILE_LOOKUP_TIMEOUT_MS, 'Client profile lookup');
    if (timedOut) {
        console.warn('Client lookup timed out.');
        return null;
    }
    if (error && error.code !== 'PGRST116') {
        console.warn('Client lookup error:', error);
    }
    return data || null;
}

function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search || '');
    const prefillEmail = (params.get('email') || '').trim();
    const emailInput = document.getElementById('login-email');
    if (prefillEmail && emailInput) emailInput.value = prefillEmail;

    if (window.location.hash.includes('access_token') || params.has('code')) {
        handleArtistOAuthCallback();
        return;
    }

    checkArtistAuthState();
});

// ============================================
// Auth State Management
// ============================================

async function checkArtistAuthState() {
    const currentPath = window.location.pathname;
    const onLoginPage = currentPath.includes('/artist/login');
    const params = new URLSearchParams(window.location.search || '');

    try {
        const { data: { session } } = await _supabase.auth.getSession();

        if (!session) {
            if (currentPath.includes('/artist/dashboard')) {
                const returnTo = encodeURIComponent(currentPath + window.location.search);
                window.location.href = appPath('/artist/login?returnTo=' + returnTo);
                return;
            }
            // Atajo desde /registerclosedbeta: "Continuá con Facebook".
            if (onLoginPage && params.get('oauth') === 'facebook') {
                handleArtistSocialLogin('facebook');
            }
            return;
        }

        if (!onLoginPage) return;

        // QA del preview: ?state=login muestra el formulario aunque haya sesión
        // ficticia. En producción el parámetro se ignora.
        if (params.get('state') === 'login' && isPreviewContext()) return;

        const artist = await lookupArtistProfile(session.user.id);
        if (artist) {
            renderAuthenticatedView({
                email: session.user.email || artist.email,
                role: 'artist',
                artist,
                progress: getArtistProgress(artist)
            });
            return;
        }

        const client = await lookupClientProfile(session.user.id);
        if (client) {
            renderAuthenticatedView({
                email: session.user.email,
                role: 'client'
            });
            return;
        }

        renderAuthenticatedView({
            email: session.user.email,
            role: 'unregistered'
        });
    } catch (error) {
        console.error('Error checking artist auth state:', error);
    }
}

function renderAuthenticatedView({ email, role, progress }) {
    const anonView = document.getElementById('login-anonymous-view');
    const authView = document.getElementById('login-authenticated-view');
    const titleEl = document.getElementById('auth-view-title');
    const subcopyEl = document.getElementById('auth-view-subcopy');
    const actionsEl = document.getElementById('auth-view-actions');

    if (!anonView || !authView || !actionsEl) return;

    anonView.hidden = true;
    authView.hidden = false;
    actionsEl.innerHTML = '';
    setAuthMessage('auth-view-progress-note', '');

    if (role === 'artist') {
        titleEl.textContent = 'Ya iniciaste sesión';

        if (progress && !progress.isComplete) {
            const stepLabel = progress.nextStep
                ? `paso ${String(progress.nextStep).padStart(2, '0')}`
                : 'siguiente paso';
            subcopyEl.textContent = 'Tu perfil de artista está en progreso.';
            setAuthMessage('auth-view-progress-note',
                `Continuá tu registro desde el ${stepLabel}.`, 'info');
            actionsEl.appendChild(createActionButton('Continuar registro', 'primary', buildRegisterArtistUrl(progress)));
            actionsEl.appendChild(createActionButton('Dashboard', 'outline', '/artist/dashboard', { loader: 'v2' }));
        } else {
            subcopyEl.textContent = 'Continuá desde tu panel de artista';
            actionsEl.appendChild(createActionButton('Dashboard', 'primary', '/artist/dashboard', { loader: 'v2' }));
            actionsEl.appendChild(createActionButton('Mis cotizaciones', 'outline', '/my-quotations'));
            actionsEl.appendChild(createActionButton('Job board', 'outline', '/job-board'));
        }
    } else if (role === 'client') {
        titleEl.textContent = 'Esta cuenta es de cliente';
        subcopyEl.innerHTML = `Tenés sesión iniciada como <strong>${escapeHtml(email || '')}</strong> en una cuenta de cliente.`;
        actionsEl.appendChild(createActionButton('Dashboard de cliente', 'primary', '/client/dashboard', { loader: 'v2', role: 'client' }));
        actionsEl.appendChild(createActionButton('Mis cotizaciones', 'outline', '/my-quotations'));
    } else {
        titleEl.textContent = 'Completá tu registro';
        subcopyEl.innerHTML = `Tenés sesión como <strong>${escapeHtml(email || '')}</strong>, pero todavía no creaste tu perfil de artista.`;
        actionsEl.appendChild(createActionButton('Crear perfil de artista', 'primary', '/register-artist'));
        actionsEl.appendChild(createActionButton('Mis cotizaciones', 'outline', '/my-quotations'));
    }

    if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') window.WoIcons.hydrate(actionsEl);
}

function createActionButton(label, kind, href, opts = {}) {
    const btn = document.createElement('a');
    btn.className = kind === 'primary' ? 'wo-auth-btn' : 'wo-auth-btn wo-auth-btn--outline';
    btn.href = appPath(href);
    btn.innerHTML = `<span class="btn-text">${escapeHtml(label)}</span><i data-wo-icon="arrow-right" aria-hidden="true"></i>`;
    if (opts.loader) {
        btn.addEventListener('click', (event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
            event.preventDefault();
            goWithPostAuthLoader(href, { role: opts.role || 'artist', variant: opts.loader });
        });
    }
    return btn;
}

// ============================================
// Login Handler (email + password)
// ============================================

async function handleArtistLogin(e) {
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

    btn.innerHTML = '<span class="wo-spinner" aria-hidden="true"></span><span class="btn-text">Validando…</span>';
    btn.disabled = true;

    try {
        let { data, error, timedOut } = await withArtistLoginTimeout(_supabase.auth.signInWithPassword({
            email: email,
            password: password
        }), AUTH_REQUEST_TIMEOUT_MS, 'Artist login');

        if (timedOut) {
            const sessionResult = await withArtistLoginTimeout(
                _supabase.auth.getSession(),
                3000,
                'Artist login session recovery'
            );
            const session = sessionResult?.data?.session;
            if (session?.user) {
                data = { user: session.user, session };
                error = null;
            } else {
                throw error;
            }
        }

        if (error) throw error;

        const artist = await lookupArtistProfile(data.user.id);
        const returnTo = getReturnToParam();

        if (artist) {
            const progress = getArtistProgress(artist);
            if (progress && !progress.isComplete) {
                // Perfil a medias: retomamos el registro donde quedó.
                window.location.href = appPath(buildRegisterArtistUrl(progress));
                return;
            }
            goWithPostAuthLoader(returnTo || '/artist/dashboard', { role: 'artist', variant: 'v1' });
            return;
        }

        const client = await lookupClientProfile(data.user.id);
        if (client) {
            goWithPostAuthLoader('/client/dashboard', { role: 'client', variant: 'v1' });
            return;
        }

        goWithPostAuthLoader(returnTo || '/artist/dashboard', { role: 'artist', variant: 'v1' });

    } catch (error) {
        console.error('Artist login error:', error);
        btn.innerHTML = originalText;
        btn.disabled = false;

        let errorMessage = 'No pudimos iniciar tu sesión.';
        const message = String(error?.message || '');
        if (message.includes('Invalid login credentials')) {
            errorMessage = 'Email o contraseña incorrectos.';
        } else if (message.includes('Email not confirmed')) {
            errorMessage = 'Confirmá tu email antes de iniciar sesión.';
        } else if (error?.code === 'PREVIEW_INPUT') {
            errorMessage = escapeHtml(message);
        }

        showFormMessage(errorMessage, 'error');
    }
}

// ============================================
// Redes: Instagram · Email (link de acceso) · Facebook
// ============================================

function setSocialBusy(provider, busy) {
    const btn = document.querySelector(`.wo-auth-social-btn[data-social="${provider}"]`);
    if (!btn) return;
    btn.disabled = Boolean(busy);
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function oauthRedirectUrl() {
    const returnTo = getReturnToParam();
    return window.location.origin + appPath('/artist/login')
        + (returnTo ? ('?returnTo=' + encodeURIComponent(returnTo)) : '');
}

async function handleArtistSocialLogin(provider) {
    clearFormMessage();

    if (provider === 'instagram') {
        // Meta no ofrece login con Instagram para cuentas personales y Supabase
        // no tiene ese proveedor. "Instagram" (Recomendado en el Figma 801:585)
        // abre el mismo inicio rápido que Crear cuenta: el wizard pide el
        // @usuario, importa el perfil público y sigue con email y contraseña.
        // Si el email ya tiene cuenta, el paso 02 del registro avisa y ofrece
        // volver a ingresar; las cuentas existentes entran con email arriba.
        setSocialBusy('instagram', true);
        try { localStorage.setItem('weotzi_signup_via_instagram', '1'); } catch (_) {}
        window.location.href = appPath('/register-artist/?source=instagram');
        return;
    }

    if (provider === 'email') {
        const emailInput = document.getElementById('login-email');
        const email = String(emailInput?.value || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
            showFormMessage('Escribí tu email arriba y te mandamos un link de acceso, sin contraseña.', 'info');
            emailInput?.focus();
            return;
        }
        setSocialBusy('email', true);
        try {
            const { error } = await _supabase.auth.signInWithOtp({
                email,
                options: { shouldCreateUser: false, emailRedirectTo: oauthRedirectUrl() }
            });
            if (error) throw error;
            showFormMessage(`Si ${escapeHtml(email)} tiene una cuenta, te enviamos un link de acceso. Revisá tu correo.`, 'success');
        } catch (error) {
            console.warn('Artist email link error:', error);
            showFormMessage('No pudimos enviar el link de acceso. Probá de nuevo en un momento o ingresá con tu contraseña.', 'error');
        } finally {
            setSocialBusy('email', false);
        }
        return;
    }

    if (provider === 'facebook') {
        setSocialBusy('facebook', true);
        try {
            const { error } = await _supabase.auth.signInWithOAuth({
                provider: 'facebook',
                options: { redirectTo: oauthRedirectUrl(), scopes: 'email' }
            });
            if (error) throw error;
        } catch (error) {
            console.warn('Artist Facebook login error:', error);
            showFormMessage('No pudimos conectar con Facebook. Probá de nuevo o ingresá con tu email.', 'error');
            setSocialBusy('facebook', false);
        }
    }
}

async function handleArtistOAuthCallback() {
    try {
        const { data: { session }, error } = await _supabase.auth.getSession();
        if (error) {
            console.error('OAuth callback error:', error);
            showFormMessage('No pudimos completar el inicio de sesión.', 'error');
            return;
        }
        if (!session) return;

        const artist = await lookupArtistProfile(session.user.id);
        if (artist) {
            const progress = getArtistProgress(artist);
            if (progress?.isComplete) {
                goWithPostAuthLoader(getReturnToParam() || '/artist/dashboard', { role: 'artist', variant: 'v1' });
            } else {
                window.location.href = appPath(buildRegisterArtistUrl(progress));
            }
            return;
        }

        const client = await lookupClientProfile(session.user.id);
        if (client) {
            goWithPostAuthLoader('/client/dashboard', { role: 'client', variant: 'v1' });
            return;
        }

        window.location.href = appPath('/register-artist');
    } catch (err) {
        console.error('Error in handleArtistOAuthCallback:', err);
    }
}

// ============================================
// Password Recovery → /recover (OTP de Supabase Auth)
// ============================================

function handleArtistPasswordRecovery(e) {
    if (e) e.preventDefault();
    const loginEmail = document.getElementById('login-email');
    const email = loginEmail ? loginEmail.value.trim().toLowerCase() : '';
    const qs = email ? '&email=' + encodeURIComponent(email) : '';
    window.location.href = appPath('/recover?from=artist' + qs);
}

// ============================================
// Logout
// ============================================

async function handleArtistLogout() {
    try {
        const { error } = await _supabase.auth.signOut();
        if (error) throw error;
        window.location.href = appPath('/artist/login');
    } catch (error) {
        console.error('Artist logout error:', error);
    }
}

// ============================================
// Reusable Artist Auth API
// ============================================

window.ArtistLogin = {
    async getSession() {
        try {
            const { data: { session } } = await _supabase.auth.getSession();
            if (!session) return { session: null, artist: null };
            const artist = await lookupArtistProfile(session.user.id);
            return { session, artist };
        } catch (err) {
            console.error('ArtistLogin.getSession error:', err);
            return { session: null, artist: null };
        }
    },

    async login(email, password) {
        const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const artist = await lookupArtistProfile(data.user.id);
        if (artist) {
            const progress = getArtistProgress(artist);
            return { user: data.user, artist, progress, isArtist: true };
        }

        const client = await lookupClientProfile(data.user.id);
        return { user: data.user, artist: null, isArtist: false, isClient: Boolean(client) };
    },

    async resetPassword(email) {
        // Mismo canal OTP que /recover: nunca se envían credenciales.
        const { error } = await _supabase.auth.resetPasswordForEmail(String(email || '').trim().toLowerCase());
        if (error) throw new Error('No pudimos procesar la solicitud. Probá de nuevo en un momento.');
        return { success: true, message: 'Si existe una cuenta, recibirás un correo para recuperar el acceso.' };
    },

    async logout() {
        const { error } = await _supabase.auth.signOut();
        if (error) throw error;
    }
};
