'use strict';

// ===========================================================================
// Frente "acceso" · lógica pura (testeable sin red ni base).
// ---------------------------------------------------------------------------
// 1) Bienvenida idempotente (ACC-04). El correo de bienvenida
//    (artist_registration_completed / client_registration_completed) sale
//    cuando la persona entra con la cuenta ya confirmada, en este o en otro
//    dispositivo, con contraseña, Google, Facebook o enlace mágico. El ledger
//    (`registration:<user_id>`) evita duplicados. Para no mandar bienvenidas
//    masivas a cuentas viejas (en vivo hay ~180 sin registro en el ledger),
//    solo califican las cuentas creadas después de la fecha de corte
//    WELCOME_EMAIL_CUTOFF y con menos de WELCOME_EMAIL_MAX_AGE_DAYS días.
// 2) Aceptación de Términos del cliente (ACC-08). Siempre la sella el
//    servidor con su propia hora; nunca se copia una fecha del navegador.
// ===========================================================================

const { TERMS_VERSION } = require('./terms-acceptance');

// Fecha de corte por defecto: salida de la beta cerrada. Se cambia con
// WELCOME_EMAIL_CUTOFF (ISO 8601) en el .env del servidor.
const DEFAULT_WELCOME_CUTOFF = '2026-11-15T00:00:00Z';
const DEFAULT_WELCOME_MAX_AGE_DAYS = 30;
const WELCOME_EVENTS = { artist: 'artist_registration_completed', client: 'client_registration_completed' };

function welcomeConfig(env = process.env) {
    const rawCutoff = String(env.WELCOME_EMAIL_CUTOFF || '').trim();
    const parsedCutoff = Date.parse(rawCutoff);
    const cutoff = Number.isFinite(parsedCutoff) ? parsedCutoff : Date.parse(DEFAULT_WELCOME_CUTOFF);
    const days = Number.parseInt(env.WELCOME_EMAIL_MAX_AGE_DAYS, 10);
    const maxAgeDays = Number.isFinite(days) && days > 0 && days <= 365 ? days : DEFAULT_WELCOME_MAX_AGE_DAYS;
    return { cutoff, maxAgeDays };
}

function normalizeRole(value) {
    const role = String(value || '').trim().toLowerCase();
    return role === 'artist' || role === 'client' ? role : null;
}

/**
 * ¿Corresponde la bienvenida? Devuelve { send, reason, eventId }.
 *   user: { id, raw: { email_confirmed_at, created_at } }  (de /auth/v1/user)
 *   role: 'artist' | 'client' (lo que pide la página)
 *   artist / client: filas de artists_db / clients_db (o null)
 */
function welcomeDecision({ user, role, artist = null, client = null, now = Date.now(), config = welcomeConfig() }) {
    const wanted = normalizeRole(role);
    if (!user || !user.id) return { send: false, reason: 'no_user' };
    if (!wanted) return { send: false, reason: 'bad_role' };
    const raw = user.raw || {};
    // Con "Confirm email" activo, la cuenta sin confirmar no recibe bienvenida
    // (OAuth y enlace mágico siempre traen email_confirmed_at).
    if (!raw.email_confirmed_at && !raw.confirmed_at) return { send: false, reason: 'email_not_confirmed' };
    const createdAt = Date.parse(raw.created_at || '');
    if (!Number.isFinite(createdAt)) return { send: false, reason: 'unknown_created_at' };
    if (createdAt < config.cutoff) return { send: false, reason: 'before_cutoff' };
    if (now - createdAt > config.maxAgeDays * 24 * 60 * 60 * 1000) return { send: false, reason: 'too_old' };
    if (wanted === 'artist') {
        if (!artist) return { send: false, reason: 'no_profile' };
        // Registro sin terminar (OAuth a mitad del wizard): todavía no.
        if (String(artist.registration_status || '').toLowerCase() === 'incompleto') return { send: false, reason: 'registration_incomplete' };
    } else {
        if (!client) return { send: false, reason: 'no_profile' };
        // Un artista que activa el modo cliente ya recibió su bienvenida.
        if (artist && String(artist.registration_status || '').toLowerCase() !== 'incompleto') {
            return { send: false, reason: 'artist_account' };
        }
    }
    return { send: true, reason: 'eligible', eventId: WELCOME_EVENTS[wanted] };
}

/**
 * Patch de aceptación de Términos del cliente: hora del servidor y versión
 * vigente. `accepted` tiene que ser exactamente true.
 */
function clientTermsPatch(accepted, { now = new Date(), version = TERMS_VERSION } = {}) {
    if (accepted !== true) return null;
    return { acceptedAt: new Date(now).toISOString(), version };
}

/**
 * Un artista que pasa a modo cliente ya aceptó los mismos Términos en su
 * registro: se reutiliza esa aceptación (dato del servidor, no del navegador).
 */
function termsFromArtist(artist) {
    if (!artist || !artist.terms_accepted_at) return null;
    return { acceptedAt: artist.terms_accepted_at, version: artist.terms_version || TERMS_VERSION };
}

module.exports = {
    DEFAULT_WELCOME_CUTOFF,
    DEFAULT_WELCOME_MAX_AGE_DAYS,
    WELCOME_EVENTS,
    welcomeConfig,
    normalizeRole,
    welcomeDecision,
    clientTermsPatch,
    termsFromArtist
};
