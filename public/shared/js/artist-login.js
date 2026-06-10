// ============================================
// Artist Authentication Module
// Handles login, Google OAuth, password recovery and session
// management for artist users.
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
    const { data, error, timedOut } = await withArtistLoginTimeout(_supabase
        .from('artists_db')
        .select(ARTIST_PROFILE_SELECT)
        .eq('user_id', userId)
        .maybeSingle(), PROFILE_LOOKUP_TIMEOUT_MS, 'Artist profile lookup');
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
    const { data, error, timedOut } = await withArtistLoginTimeout(_supabase
        .from('clients_db')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle(), PROFILE_LOOKUP_TIMEOUT_MS, 'Client profile lookup');
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
    restoreZoomPreference();

    if (window.location.hash.includes('access_token') || window.location.search.includes('code=')) {
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
    const authView = document.getElementById('login-authenticated-view');
    const emailEl = document.getElementById('auth-view-email');
    const kickerEl = document.getElementById('auth-view-kicker');
    const titleEl = document.getElementById('auth-view-title');
    const subcopyEl = document.getElementById('auth-view-subcopy');
    const noteEl = document.getElementById('auth-view-progress-note');
    const actionsEl = document.getElementById('auth-view-actions');

    if (!anonView || !authView || !actionsEl) return;

    anonView.hidden = true;
    authView.hidden = false;

    if (emailEl) emailEl.textContent = email || '';

    actionsEl.innerHTML = '';

    if (role === 'artist') {
        kickerEl.textContent = 'Sesion activa';
        titleEl.textContent = 'Ya iniciaste sesion';

        if (progress && !progress.isComplete) {
            const stepLabel = progress.nextStep
                ? `paso ${String(progress.nextStep).padStart(2, '0')}`
                : 'siguiente paso';
            noteEl.hidden = false;
            noteEl.className = 'form-message info';
            noteEl.style.display = 'block';
            noteEl.textContent = `Tu perfil de artista esta en progreso. Continua desde el ${stepLabel}.`;

            actionsEl.appendChild(createActionButton(
                'Continuar registro',
                'quote-cta-btn',
                buildRegisterArtistUrl(progress)
            ));
        } else {
            noteEl.hidden = true;
            subcopyEl.textContent = 'Continua desde tu panel de artista.';
        }

        actionsEl.appendChild(createActionButton('Ir al dashboard', 'action-btn', '/artist/dashboard'));
        actionsEl.appendChild(createActionButton('Mis cotizaciones', 'action-btn', '/my-quotations'));
        actionsEl.appendChild(createActionButton('Job Board', 'action-btn', '/job-board'));
    } else if (role === 'client') {
        kickerEl.textContent = 'Cuenta cliente';
        titleEl.textContent = 'Esta cuenta es de cliente';
        subcopyEl.innerHTML = `Estas logueado como <strong id="auth-view-email">${escapeHtml(email || '')}</strong> en una cuenta de cliente.`;
        noteEl.hidden = true;

        actionsEl.appendChild(createActionButton('Ir a dashboard cliente', 'quote-cta-btn', '/client/dashboard'));
        actionsEl.appendChild(createActionButton('Mis cotizaciones', 'action-btn', '/my-quotations'));
    } else {
        kickerEl.textContent = 'Sin perfil';
        titleEl.textContent = 'Completa tu registro';
        subcopyEl.innerHTML = `Tienes sesion como <strong id="auth-view-email">${escapeHtml(email || '')}</strong>, pero aun no has creado tu perfil de artista.`;
        noteEl.hidden = true;

        actionsEl.appendChild(createActionButton('Crear perfil de artista', 'quote-cta-btn', '/register-artist'));
        actionsEl.appendChild(createActionButton('Mis cotizaciones', 'action-btn', '/my-quotations'));
    }
}

function createActionButton(label, className, href) {
    const btn = document.createElement('a');
    btn.className = className;
    btn.href = href;
    btn.innerHTML = `<span class="btn-text">${escapeHtml(label)}</span>`;
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
        showFormMessage('Por favor ingresa tu email y contrasena.', 'error');
        return;
    }

    btn.innerHTML = '<div class="spinner"></div><span>VALIDANDO...</span>';
    btn.classList.add('loading');
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
            btn.innerHTML = '<span class="btn-text">BIENVENIDO</span>';
            btn.style.background = '#4CAF50';
            showFormMessage('Sesion iniciada correctamente.', 'success');

            const returnTo = getReturnToParam();
            setTimeout(() => {
                window.location.href = returnTo || '/artist/dashboard';
            }, 1500);
            return;
        }

        const client = await lookupClientProfile(data.user.id);
        if (client) {
            showFormMessage('Esta cuenta es de cliente. Redirigiendo a tu dashboard...', 'info');
            setTimeout(() => { window.location.href = '/client/dashboard'; }, 1500);
            return;
        }

        showFormMessage('Sesion iniciada. Abriendo dashboard...', 'success');
        const returnTo = getReturnToParam();
        setTimeout(() => { window.location.href = returnTo || '/artist/dashboard'; }, 1500);

    } catch (error) {
        console.error('Artist login error:', error);
        btn.innerHTML = originalText;
        btn.classList.remove('loading');
        btn.disabled = false;
        btn.style.background = '';

        let errorMessage = 'Error al iniciar sesion.';
        if (error.message && error.message.includes('Invalid login credentials')) {
            errorMessage = 'Email o contrasena incorrectos.';
        } else if (error.message && error.message.includes('Email not confirmed')) {
            errorMessage = 'Debes confirmar tu email antes de iniciar sesion.';
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
        showFormMessage('Error al conectar con Google. Por favor, intenta de nuevo.', 'error');
    }
}

async function handleArtistOAuthCallback() {
    try {
        const { data: { session }, error } = await _supabase.auth.getSession();
        if (error) {
            console.error('OAuth callback error:', error);
            showFormMessage('Error al completar el inicio de sesion.', 'error');
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
            showFormMessage('Esta cuenta esta registrada como cliente.', 'info');
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

async function handleArtistPasswordRecovery(e) {
    if (e) e.preventDefault();

    const emailInput = document.getElementById('login-email');
    const email = emailInput?.value.trim().toLowerCase();

    if (!email) {
        showFormMessage('Por favor ingresa tu email para recuperar tu contrasena.', 'info');
        emailInput?.focus();
        return;
    }

    showFormMessage('Procesando solicitud...', 'info');

    try {
        const tempPassword = generateTempPassword();

        const response = await fetch('/api/auth/reset-temp-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: email,
                userType: 'artist',
                tempPassword: tempPassword
            })
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            if (response.status === 404) {
                throw new Error('No encontramos una cuenta de artista con ese email.');
            }
            throw new Error(result.error || 'Error al procesar la solicitud');
        }

        if (window.ConfigManager && typeof window.ConfigManager.sendN8NEvent === 'function') {
            try {
                await window.ConfigManager.sendN8NEvent('password_reset_temp', {
                    email: email,
                    temp_password: tempPassword,
                    user_type: 'artist',
                    login_url: window.location.origin + '/artist/login'
                });
            } catch (webhookErr) {
                console.warn('Could not send password_reset_temp event:', webhookErr);
            }
        }

        showFormMessage('Te hemos enviado un email con tu nueva contrasena temporal.', 'success');
    } catch (error) {
        console.error('Artist password recovery error:', error);
        showFormMessage(error.message || 'Error al procesar la solicitud.', 'error');
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
// Theme Toggle + Zoom
// ============================================

function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('weotzi-theme', isDark ? 'dark' : 'light');
}

function restoreThemePreference() {
    const savedTheme = localStorage.getItem('weotzi-theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
    }
}

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.2;
const ZOOM_STEP = 0.1;

function getCurrentZoom() {
    const root = document.documentElement;
    const currentZoom = getComputedStyle(root).getPropertyValue('--zoom-factor');
    return parseFloat(currentZoom) || 0.85;
}

function setZoom(factor) {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, factor));
    document.documentElement.style.setProperty('--zoom-factor', clamped);
    localStorage.setItem('weotzi-zoom', clamped);
}

function zoomIn() { setZoom(getCurrentZoom() + ZOOM_STEP); }
function zoomOut() { setZoom(getCurrentZoom() - ZOOM_STEP); }

function restoreZoomPreference() {
    const savedZoom = localStorage.getItem('weotzi-zoom');
    if (savedZoom) setZoom(parseFloat(savedZoom));
    restoreThemePreference();
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
            if (response.status === 404) throw new Error('No encontramos una cuenta con ese email.');
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
