'use strict';
// ── confirmacion-email ──
// Lógica pura (testeable) para las cuentas que crea el SERVIDOR con la admin
// API de Supabase (artistas en /api/register/artist-finalize y usuarios de
// soporte). El navegador ya respeta el interruptor "Confirm email" porque
// usa auth.signUp; la admin API, en cambio, crea la cuenta como se le pida.
//
// Regla: el servidor NO asume el modo. Lee GET /auth/v1/settings
// (`mailer_autoconfirm`):
//   - mailer_autoconfirm === true  → confirmación DESACTIVADA: email_confirm
//     true (comportamiento de siempre, el artista entra directo).
//   - mailer_autoconfirm === false → confirmación ACTIVADA: email_confirm false
//     y se envía el email "Confirm signup" de Supabase (POST /auth/v1/resend).
//   - no se pudo leer → se exige confirmación (opción segura: la cuenta
//     funciona igual, solo pide abrir el link). Override por entorno:
//     AUTH_EMAIL_CONFIRMATION=required|disabled|auto (default auto).

const DEFAULT_TTL_MS = 60 * 1000;

function normalizeMode(value) {
    const v = String(value || '').trim().toLowerCase();
    if (['required', 'on', 'true', '1', 'enabled'].includes(v)) return 'required';
    if (['disabled', 'off', 'false', '0'].includes(v)) return 'disabled';
    return 'auto';
}

// true = hay que confirmar · false = autoconfirm · null = desconocido.
function confirmationRequiredFromSettings(settings) {
    if (!settings || typeof settings !== 'object') return null;
    if (settings.mailer_autoconfirm === true) return false;
    if (settings.mailer_autoconfirm === false) return true;
    return null;
}

function resolveConfirmationRequired({ mode, settings } = {}) {
    const m = normalizeMode(mode);
    if (m === 'required') return true;
    if (m === 'disabled') return false;
    const fromSettings = confirmationRequiredFromSettings(settings);
    return fromSettings === null ? true : fromSettings;
}

// Campos del POST /auth/v1/admin/users según el modo.
function adminCreateConfirmFields(confirmationRequired) {
    return { email_confirm: !confirmationRequired };
}

function buildResendRequest({ supabaseUrl, apiKey, email, redirectTo }) {
    const base = String(supabaseUrl || '').replace(/\/$/, '');
    const qs = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
    return {
        url: `${base}/auth/v1/resend${qs}`,
        init: {
            method: 'POST',
            headers: {
                apikey: apiKey,
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ type: 'signup', email: String(email || '').trim().toLowerCase() })
        }
    };
}

// Lector cacheado del modo de Supabase (una llamada por minuto como mucho).
function createConfirmationModeReader({ fetchImpl, supabaseUrl, apiKey, mode, ttlMs = DEFAULT_TTL_MS, now = () => Date.now(), log = () => {} } = {}) {
    let cache = null; // { at, settings }
    return async function isConfirmationRequired() {
        const m = normalizeMode(mode);
        if (m !== 'auto') return m === 'required';
        if (cache && now() - cache.at < ttlMs) return resolveConfirmationRequired({ settings: cache.settings });
        let settings = null;
        try {
            const base = String(supabaseUrl || '').replace(/\/$/, '');
            const res = await fetchImpl(`${base}/auth/v1/settings`, { headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` } });
            if (res && res.ok) settings = await res.json();
            else log(`[email-confirmation] /auth/v1/settings HTTP ${res && res.status}`);
        } catch (err) {
            log(`[email-confirmation] /auth/v1/settings: ${err && err.message}`);
        }
        if (confirmationRequiredFromSettings(settings) !== null) cache = { at: now(), settings };
        return resolveConfirmationRequired({ settings });
    };
}

async function sendSignupConfirmation({ fetchImpl, supabaseUrl, apiKey, email, redirectTo }) {
    const { url, init } = buildResendRequest({ supabaseUrl, apiKey, email, redirectTo });
    try {
        const res = await fetchImpl(url, init);
        if (res && res.ok) return { ok: true, status: res.status };
        let detail = '';
        try { detail = JSON.stringify(await res.json()).slice(0, 200); } catch (_) { /* sin cuerpo */ }
        return { ok: false, status: res ? res.status : 0, error: detail || 'resend failed' };
    } catch (err) {
        return { ok: false, status: 0, error: err && err.message ? err.message : String(err) };
    }
}

// Rutas a las que vuelve el link de confirmación (deben estar en
// Authentication → URL Configuration → Redirect URLs).
const CONFIRM_REDIRECT_PATHS = Object.freeze({
    artist: '/register-artist/?confirmado=1',
    support: '/support/login?confirmado=1'
});

module.exports = {
    DEFAULT_TTL_MS,
    CONFIRM_REDIRECT_PATHS,
    normalizeMode,
    confirmationRequiredFromSettings,
    resolveConfirmationRequired,
    adminCreateConfirmFields,
    buildResendRequest,
    createConfirmationModeReader,
    sendSignupConfirmation
};
