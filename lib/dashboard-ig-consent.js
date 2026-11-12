'use strict';

// Consentimiento de la importación de Instagram (Figma 2003:1191, ronda 3 · P17).
//
// El paso 01 del importador pide "Confirmo que esta cuenta es mía y autorizo la
// importación de su contenido." Hasta ahora solo bloqueaba el botón en el
// cliente. POST /api/instagram/commit recibe `consent` y el servidor lo deja
// registrado:
//   - en el log de auditoría instagram_imports.imported_fields.consent
//     ({ accepted, version, text, accepted_at, handle }), y
//   - en cada ítem importado de la galería (consent_at), junto a imported_at.
//
// La hora la pone el servidor (no se confía en la del cliente). Sin
// consentimiento el commit sigue funcionando (el alta de register.js
// re-commitea sin este campo) pero no queda registro de aceptación.

const IG_CONSENT_VERSION = 'ig-import-2026-11';
const IG_CONSENT_TEXT = 'Confirmo que esta cuenta es mía y autorizo la importación de su contenido.';

function cleanHandle(value) {
    const handle = String(value || '').trim().replace(/^@+/, '').toLowerCase();
    return /^[a-z0-9._]{1,30}$/.test(handle) ? handle : null;
}

// raw: `true` o { accepted: true, version? }. Cualquier otra cosa → null.
function normalizeImportConsent(raw, { now = new Date(), handle = null } = {}) {
    const accepted = raw === true || (raw && typeof raw === 'object' && raw.accepted === true);
    if (!accepted) return null;
    const when = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    const version = raw && typeof raw === 'object' && typeof raw.version === 'string' && /^[a-z0-9._-]{1,40}$/i.test(raw.version)
        ? raw.version
        : IG_CONSENT_VERSION;
    return {
        accepted: true,
        version,
        text: IG_CONSENT_TEXT,
        accepted_at: when.toISOString(),
        handle: cleanHandle(handle)
    };
}

// El handle real es el del perfil que se importó (payload del preview), no el
// que manda el cliente.
function withHandle(consent, handle) {
    if (!consent) return null;
    return { ...consent, handle: cleanHandle(handle) || consent.handle || null };
}

module.exports = { IG_CONSENT_VERSION, IG_CONSENT_TEXT, normalizeImportConsent, withHandle };
