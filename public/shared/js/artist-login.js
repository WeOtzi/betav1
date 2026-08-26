// ============================================
// Artist Authentication Module
// Handles login, Google OAuth, password recovery and session
// management for artist users.
// UI: design system Bauhaus (wo-*) — /shared/css/artist-auth-ds.css
// ============================================

const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = (window._supabase = window._supabase || supabase.createClient(supabaseUrl, supabaseKey));
const AUTH_REQUEST_TIMEOUT_MS = 10000;
const PROFILE_LOOKUP_TIMEOUT_MS = 8000;

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

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    if (window.location.hash.includes('access_token') || window.location.search.includes('code=')) {
        handleArtistOAuthCallback();
        return;
    }

    checkArtistAuthState();
});

// ============================================
// View Switching (login <-> recuperar contraseña)
// ============================================

function togglePoster(which) {
    const posterLogin = document.getElementById('poster-login');
    const posterRecovery = document.getElementById('poster-recovery');
    if (posterLogin) posterLogin.hidden = which !== 'login';
    if (posterRecovery) posterRecovery.hidden = which !== 'recovery';
}

function setRecoveryStep(step) {
    const emailStep = document.getElementById('recovery-step-email');
    const sentStep = document.getElementById('recovery-step-sent');
    if (emailStep) emailStep.hidden = step !== 'email';
    if (sentStep) sentStep.hidden = step !== 'sent';
}

function showRecoveryView() {
    const anonView = document.getElementById('login-anonymous-view');
    const recoveryView = document.getElementById('recovery-view');
    if (!recoveryView) return;

    const loginEmail = document.getElementById('login-email');
    const recoveryEmail = document.getElementById('recovery-email');
    if (recoveryEmail && loginEmail && loginEmail.value.trim()) {
        recoveryEmail.value = loginEmail.value.trim();
    }

    setRecoveryStep('email');
    if (anonView) anonView.hidden = true;
    recoveryView.hidden = false;
    togglePoster('recovery');
    clearFormMessage();
    setAuthMessage('recovery-message', '');
    recoveryEmail?.focus();
}

function showLoginView() {
    const anonView = document.getElementById('login-anonymous-view');
    const recoveryView = document.getElementById('recovery-view');
    if (recoveryView) recoveryView.hidden = true;
    if (anonView) anonView.hidden = false;
    togglePoster('login');
    setAuthMessage('recovery-message', '');
    document.getElementById('login-password')?.focus();
}

// ============================================
// Auth State Management
// ============================================

async function checkArtistAuthState() {
    const currentPath = window.location.pathname;
    const onLoginPage = currentPath.includes('/artist/login');

    try {
        const { data: { session } } = await _supabase.auth.getSession();

        if (!session) {
            if (currentPath.includes('/artist/dashboard')) {
                const returnTo = encodeURIComponent(currentPath + window.location.search);
                window.location.href = '/artist/login?returnTo=' + returnTo;
            }
            return;
        }

        if (!onLoginPage) return;

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

function renderAuthenticatedView({ email, role, artist, progress }) {
    const anonView = document.getElementById('login-anonymous-view');
    const recoveryView = document.getElementById('recovery-view');
    const authView = document.getElementById('login-authenticated-view');
    const emailEl = document.getElementById('auth-view-email');
    const kickerEl = document.getElementById('auth-view-kicker');
    const kickerTextEl = document.getElementById('auth-view-kicker-text') || kickerEl;
    const titleEl = document.getElementById('auth-view-title');
    const subcopyEl = document.getElementById('auth-view-subcopy');
    const noteEl = document.getElementById('auth-view-progress-note');
    const actionsEl = document.getElementById('auth-view-actions');

    if (!anonView || !authView || !actionsEl) return;

    anonView.hidden = true;
    if (recoveryView) recoveryView.hidden = true;
    authView.hidden = false;
    togglePoster('login');

    if (emailEl) emailEl.textContent = email || '';

    actionsEl.innerHTML = '';

    if (role === 'artist') {
        kickerTextEl.textContent = 'Sesión activa';
        titleEl.textContent = 'Ya iniciaste sesión';

        if (progress && !progress.isComplete) {
            const stepLabel = progress.nextStep
                ? `paso ${String(progress.nextStep).padStart(2, '0')}`
                : 'siguiente paso';
            setAuthMessage('auth-view-progress-note',
                `Tu perfil de artista está en progreso. Continuá desde el ${stepLabel}.`, 'info');

            actionsEl.appendChild(createActionButton(
                'Continuar registro',
                'primary',
                buildRegisterArtistUrl(progress)
            ));
            actionsEl.appendChild(createActionButton('Ir al dashboard', 'ghost', '/artist/dashboard'));
        } else {
            setAuthMessage('auth-view-progress-note', '');
            subcopyEl.textContent = 'Continuá desde tu panel de artista.';
            actionsEl.appendChild(createActionButton('Ir al dashboard', 'primary', '/artist/dashboard'));
        }

        actionsEl.appendChild(createActionButton('Mis cotizaciones', 'ghost', '/my-quotations'));
        actionsEl.appendChild(createActionButton('Job board', 'ghost', '/job-board'));
    } else if (role === 'client') {
        kickerTextEl.textContent = 'Cuenta cliente';
        titleEl.textContent = 'Esta cuenta es de cliente';
        subcopyEl.innerHTML = `Tenés sesión iniciada como <strong id="auth-view-email">${escapeHtml(email || '')}</strong> en una cuenta de cliente.`;
        setAuthMessage('auth-view-progress-note', '');

        actionsEl.appendChild(createActionButton('Ir al dashboard de cliente', 'primary', '/client/dashboard'));
        actionsEl.appendChild(createActionButton('Mis cotizaciones', 'ghost', '/my-quotations'));
    } else {
        kickerTextEl.textContent = 'Sin perfil';
        titleEl.textContent = 'Completá tu registro';
        subcopyEl.innerHTML = `Tenés sesión como <strong id="auth-view-email">${escapeHtml(email || '')}</strong>, pero todavía no creaste tu perfil de artista.`;
        setAuthMessage('auth-view-progress-note', '');

        actionsEl.appendChild(createActionButton('Crear perfil de artista', 'primary', '/register-artist'));
        actionsEl.appendChild(createActionButton('Mis cotizaciones', 'ghost', '/my-quotations'));
    }
}

function createActionButton(label, kind, href) {
    const btn = document.createElement('a');
    btn.className = kind === 'primary'
        ? 'wo-btn wo-btn--block wo-btn--hard'
        : 'wo-btn wo-btn--ghost wo-btn--block wo-btn--hard';
    btn.href = href;
    btn.innerHTML = `<span class="btn-text">${escapeHtml(label)}</span><i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i>`;
    return btn;
}

function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
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

        if (artist) {
            btn.innerHTML = '<span class="btn-text">Listo</span>';
            showFormMessage('Sesión iniciada. Abriendo tu panel…', 'success');

            const returnTo = getReturnToParam();
            setTimeout(() => {
                window.location.href = returnTo || '/artist/dashboard';
            }, 1500);
            return;
        }

        const client = await lookupClientProfile(data.user.id);
        if (client) {
            showFormMessage('Esta cuenta es de cliente. Te llevamos a tu panel…', 'info');
            setTimeout(() => { window.location.href = '/client/dashboard'; }, 1500);
            return;
        }

        showFormMessage('Sesión iniciada. Abriendo tu panel…', 'success');
        const returnTo = getReturnToParam();
        setTimeout(() => { window.location.href = returnTo || '/artist/dashboard'; }, 1500);

    } catch (error) {
        console.error('Artist login error:', error);
        btn.innerHTML = originalText;
        btn.disabled = false;

        let errorMessage = 'No pudimos iniciar tu sesión.';
        if (error.message && error.message.includes('Invalid login credentials')) {
            errorMessage = 'Email o contraseña incorrectos.';
        } else if (error.message && error.message.includes('Email not confirmed')) {
            errorMessage = 'Confirmá tu email antes de iniciar sesión.';
        }

        showFormMessage(errorMessage, 'error');
    }
}

// ============================================
// Google OAuth
// ============================================

async function handleArtistGoogleLogin() {
    try {
        const returnTo = getReturnToParam();
        const redirectTo = window.location.origin + '/artist/login'
            + (returnTo ? ('?returnTo=' + encodeURIComponent(returnTo)) : '');

        const { error } = await _supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectTo,
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent'
                }
            }
        });

        if (error) throw error;
    } catch (error) {
        console.error('Artist Google login error:', error);
        showFormMessage('No pudimos conectar con Google. Probá de nuevo.', 'error');
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
                const returnTo = getReturnToParam();
                window.location.href = returnTo || '/artist/dashboard';
            } else {
                window.location.href = buildRegisterArtistUrl(progress);
            }
            return;
        }

        const client = await lookupClientProfile(session.user.id);
        if (client) {
            showFormMessage('Esta cuenta está registrada como cliente.', 'info');
            setTimeout(() => { window.location.href = '/client/dashboard'; }, 1500);
            return;
        }

        window.location.href = '/register-artist';
    } catch (err) {
        console.error('Error in handleArtistOAuthCallback:', err);
    }
}

// ============================================
// Password Recovery
// ============================================

function generateTempPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 10; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

// La recuperación vive ahora en /recover (código OTP de Supabase Auth).
// Este handler solo redirige, con el email prefilleado si ya lo tipearon;
// la vista in-page (#recovery-view) y handleRecoverySubmit quedan muertas.
function handleArtistPasswordRecovery(e) {
    if (e) e.preventDefault();
    const loginEmail = document.getElementById('login-email');
    const email = loginEmail ? loginEmail.value.trim().toLowerCase() : '';
    const qs = email ? '&email=' + encodeURIComponent(email) : '';
    window.location.href = '/recover?from=artist' + qs;
}

async function handleRecoverySubmit(e) {
    if (e) e.preventDefault();

    const emailInput = document.getElementById('recovery-email');
    const email = emailInput ? emailInput.value.trim().toLowerCase() : '';

    if (!email) {
        setAuthMessage('recovery-message', 'Ingresá tu email para recuperar tu acceso.', 'info');
        emailInput?.focus();
        return;
    }

    const btn = document.getElementById('btn-recovery');
    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.innerHTML = '<span class="wo-spinner" aria-hidden="true"></span><span class="btn-text">Enviando…</span>';
        btn.disabled = true;
    }
    setAuthMessage('recovery-message', '');

    try {
        await window.ArtistLogin.resetPassword(email);

        const sentEmailEl = document.getElementById('recovery-sent-email');
        if (sentEmailEl) sentEmailEl.textContent = email;
        setRecoveryStep('sent');
    } catch (error) {
        console.error('Artist password recovery error:', error);
        setAuthMessage('recovery-message', error.message || 'No pudimos procesar la solicitud. Probá de nuevo.', 'error');
    } finally {
        if (btn) {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    }
}

// ============================================
// Logout
// ============================================

async function handleArtistLogout() {
    try {
        const { error } = await _supabase.auth.signOut();
        if (error) throw error;
        window.location.href = '/artist/login';
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
        const tempPassword = generateTempPassword();

        const response = await fetch('/api/auth/reset-temp-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, userType: 'artist', tempPassword })
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            if (response.status === 404) throw new Error('No encontramos una cuenta de artista con ese email.');
            throw new Error(result.error || 'Error al procesar la solicitud');
        }

        if (window.ConfigManager && typeof window.ConfigManager.sendN8NEvent === 'function') {
            try {
                await window.ConfigManager.sendN8NEvent('password_reset_temp', {
                    email,
                    temp_password: tempPassword,
                    user_type: 'artist',
                    login_url: window.location.origin + '/artist/login'
                });
            } catch (webhookErr) {
                console.warn('Could not send password_reset_temp event:', webhookErr);
            }
        }

        return { success: true };
    },

    async logout() {
        const { error } = await _supabase.auth.signOut();
        if (error) throw error;
    }
};
