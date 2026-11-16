'use strict';

// ===========================================================================
// Enlaces de invitación del estudio (beta cerrada · ROSTER-03/06).
// ---------------------------------------------------------------------------
// El dueño del estudio genera un enlace para que los tatuadores se sumen a su
// equipo (opcionalmente atado a una sede, con rol, vencimiento y tope de
// usos). El token viaja solo en el enlace: en la base se guarda su SHA-256
// (studio_invite_links.token_hash), igual que el link de alta de estudios
// (lib/studio-claim.js).
//
//   /artist/join-studio?unirse=<token>   → con cuenta: "Sumarme"; sin cuenta:
//                                          "Crear mi perfil" (/registerclosedbeta?unirse=…)
//
// El canje es la RPC service-role public.redeem_studio_invite_link
// (supabase/migrations/20261115230000_studio_invite_links.sql).
//
// Este módulo es lógica pura (sin red) para poder testearla.
// ===========================================================================

const crypto = require('crypto');

const INVITE_TOKEN_BYTES = 32;
const INVITE_QUERY_PARAM = 'unirse';
const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const INVITE_TTL_OPTIONS = Object.freeze([7, 30, 90]);
const INVITE_DEFAULT_TTL_DAYS = 30;
const INVITE_ROLES = Object.freeze(['resident', 'guest', 'itinerant']);
const ROLE_LABELS = Object.freeze({
    resident: 'Residente',
    guest: 'Guest',
    itinerant: 'Itinerante',
    manager: 'Manager'
});
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function generateInviteToken() {
    return crypto.randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
}

function isWellFormedInviteToken(token) {
    return typeof token === 'string' && INVITE_TOKEN_RE.test(token);
}

// Mismo hash que calcula Postgres: encode(sha256(convert_to(token,'UTF8')),'hex').
function hashInviteToken(token) {
    return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function buildJoinPath(token) {
    return `/artist/join-studio?${INVITE_QUERY_PARAM}=${encodeURIComponent(token)}`;
}

function buildRegisterPath(token) {
    return `/registerclosedbeta?${INVITE_QUERY_PARAM}=${encodeURIComponent(token)}`;
}

function normalizeEmail(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
}

function isValidEmail(value) {
    const email = normalizeEmail(value);
    return email.length > 3 && email.length <= 320 && EMAIL_RE.test(email);
}

function cleanText(value, max) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return text.length > max ? text.slice(0, max) : text;
}

function isUuid(value) {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// Valida lo que manda el panel del estudio al generar un enlace. Nunca confía
// en el cliente para el estudio ni el creador: esos los pone el servidor.
function normalizeIssueInput(body = {}) {
    const role = String(body.role || 'resident').trim();
    if (!INVITE_ROLES.includes(role)) return { ok: false, error: 'Elige un rol válido: residente, guest o itinerante.' };

    const locationId = body.location_id ? String(body.location_id) : null;
    if (locationId && !isUuid(locationId)) return { ok: false, error: 'La sede elegida no es válida.' };

    const ttl = Number.parseInt(body.ttl_days, 10);
    const ttlDays = INVITE_TTL_OPTIONS.includes(ttl) ? ttl : INVITE_DEFAULT_TTL_DAYS;

    let maxUses = null;
    if (body.max_uses !== undefined && body.max_uses !== null && body.max_uses !== '') {
        maxUses = Number.parseInt(body.max_uses, 10);
        if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 500) {
            return { ok: false, error: 'El tope de usos va de 1 a 500.' };
        }
    }

    return {
        ok: true,
        value: {
            role,
            locationId,
            ttlDays,
            maxUses,
            requiresApproval: body.requires_approval === undefined ? true : body.requires_approval !== false && body.requires_approval !== 'false',
            label: cleanText(body.label, 80)
        }
    };
}

// Invitación personal por email (ROSTER-06). La respuesta del servidor es la
// misma exista o no una cuenta con ese email (anti-enumeración).
function normalizeEmailInviteInput(body = {}) {
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) return { ok: false, error: 'Escribe un email válido.' };
    const role = String(body.role || 'resident').trim();
    if (!INVITE_ROLES.includes(role)) return { ok: false, error: 'Elige un rol válido: residente, guest o itinerante.' };
    const locationId = body.location_id ? String(body.location_id) : null;
    if (locationId && !isUuid(locationId)) return { ok: false, error: 'La sede elegida no es válida.' };
    return {
        ok: true,
        value: {
            email,
            name: cleanText(body.name, 120),
            role,
            locationId,
            message: cleanText(body.message, 1000)
        }
    };
}

// Estado de un enlace para el preview público. `studio` es la fila del estudio
// (id, user_id, is_active) o null.
function inviteLinkStatus(link, studio, now = Date.now()) {
    if (!link) return 'invalid';
    if (link.revoked_at) return 'revoked';
    if (link.expires_at && new Date(link.expires_at).getTime() <= now) return 'expired';
    if (link.max_uses != null && Number(link.uses_count || 0) >= Number(link.max_uses)) return 'exhausted';
    if (!studio || studio.is_active === false || !studio.user_id) return 'unavailable';
    return 'valid';
}

// 404 para lo que nunca existió; 410 para lo que existió y ya no sirve.
function previewHttpStatus(status) {
    if (status === 'valid') return 200;
    if (status === 'invalid') return 404;
    return 410;
}

const STATUS_MESSAGES = Object.freeze({
    invalid: 'Este enlace de invitación no es válido. Pídele al estudio uno nuevo.',
    revoked: 'El estudio desactivó este enlace. Pídele uno nuevo.',
    expired: 'Este enlace de invitación venció. Pídele al estudio uno nuevo.',
    exhausted: 'Este enlace ya alcanzó su cantidad de usos. Pídele al estudio uno nuevo.',
    unavailable: 'Este estudio no está recibiendo artistas por ahora.',
    not_artist: 'Necesitas un perfil de artista para sumarte a un estudio.'
});

function statusMessage(status) {
    return STATUS_MESSAGES[status] || 'No pudimos usar este enlace de invitación.';
}

// Fila para el panel del estudio: nunca incluye el hash.
function publicLinkRow(link, now = Date.now()) {
    if (!link) return null;
    let status = 'active';
    if (link.revoked_at) status = 'revoked';
    else if (link.expires_at && new Date(link.expires_at).getTime() <= now) status = 'expired';
    else if (link.max_uses != null && Number(link.uses_count || 0) >= Number(link.max_uses)) status = 'exhausted';
    return {
        id: link.id,
        role: link.role,
        location_id: link.location_id || null,
        requires_approval: link.requires_approval !== false,
        label: link.label || null,
        invitee_email: link.invitee_email || null,
        invitee_name: link.invitee_name || null,
        max_uses: link.max_uses == null ? null : Number(link.max_uses),
        uses_count: Number(link.uses_count || 0),
        expires_at: link.expires_at || null,
        revoked_at: link.revoked_at || null,
        created_at: link.created_at || null,
        status
    };
}

function roleLabel(role) {
    return ROLE_LABELS[role] || 'Artista';
}

module.exports = {
    INVITE_DEFAULT_TTL_DAYS,
    INVITE_QUERY_PARAM,
    INVITE_ROLES,
    INVITE_TTL_OPTIONS,
    ROLE_LABELS,
    buildJoinPath,
    buildRegisterPath,
    generateInviteToken,
    hashInviteToken,
    inviteLinkStatus,
    isUuid,
    isValidEmail,
    isWellFormedInviteToken,
    normalizeEmail,
    normalizeEmailInviteInput,
    normalizeIssueInput,
    previewHttpStatus,
    publicLinkRow,
    roleLabel,
    statusMessage
};
