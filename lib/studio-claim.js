'use strict';

// ===========================================================================
// Link de alta de un estudio creado por un tatuador (revision 12 nov, pag. 9).
// ---------------------------------------------------------------------------
// Cuando un tatuador registra un estudio que no existe, el estudio queda en el
// catalogo para que otros tatuadores lo usen, sin duenio y con
// `location_verified = false`. El tatuador recibe un link de alta de UN SOLO
// USO que comparte con el representante del estudio. El token viaja solo en
// el link: en la base se guarda su SHA-256 (studio_claim_links.token_hash).
//
// Al registrarse con el link (/studio/register?alta=<token>) el representante
// puede corregir nombre y ubicacion; el RPC complete_studio_registration
// (rama claim_token -> private.claim_studio_with_link) asigna el duenio,
// actualiza la sede principal EN EL LUGAR (las membresias de los tatuadores
// apuntan a ella), propaga el nombre a los tatuadores vinculados y marca la
// ubicacion como verificada. Ver
// supabase/migrations/20261112120000_studio_claim_links.sql.
// ===========================================================================

const crypto = require('crypto');

const CLAIM_TOKEN_BYTES = 32;
const CLAIM_TTL_DAYS = 30;
const CLAIM_QUERY_PARAM = 'alta';
const CLAIM_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

function enc(value) {
    return encodeURIComponent(String(value));
}

function generateClaimToken() {
    return crypto.randomBytes(CLAIM_TOKEN_BYTES).toString('base64url');
}

function isWellFormedClaimToken(token) {
    return typeof token === 'string' && CLAIM_TOKEN_RE.test(token);
}

// Mismo hash que calcula Postgres: encode(sha256(convert_to(token,'UTF8')),'hex').
function hashClaimToken(token) {
    return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function buildStudioClaimPath(token) {
    return `/studio/register?${CLAIM_QUERY_PARAM}=${enc(token)}`;
}

// Emite un link nuevo (revoca los anteriores sin usar del mismo estudio) via
// el RPC service-role public.issue_studio_claim_link. Devuelve el token en
// claro UNA sola vez; nunca se vuelve a poder leer.
async function issueStudioClaimLink(fetchRest, { studioId, createdBy, ttlDays = CLAIM_TTL_DAYS } = {}) {
    if (!studioId || !createdBy) throw new Error('studioId y createdBy son obligatorios');
    const token = generateClaimToken();
    const rows = await fetchRest('rpc/issue_studio_claim_link', {
        method: 'POST',
        body: {
            p_studio_id: studioId,
            p_token_hash: hashClaimToken(token),
            p_created_by: createdBy,
            p_ttl_days: ttlDays
        }
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    return {
        token,
        path: buildStudioClaimPath(token),
        link_id: row && (row.link_id || row.id) || null,
        expires_at: row && row.expires_at || null
    };
}

function claimLinkStatus(link, studio, now = Date.now()) {
    if (!link) return 'invalid';
    if (link.used_at) return 'used';
    if (link.revoked_at) return 'revoked';
    if (link.expires_at && new Date(link.expires_at).getTime() <= now) return 'expired';
    if (!studio) return 'invalid';
    if (studio.user_id) return 'claimed';
    return 'valid';
}

const PREVIEW_LOCATION_COLUMNS = [
    'id', 'label', 'country', 'country_code', 'state_province', 'city', 'locality', 'street',
    'street_number', 'unit', 'postal_code', 'formatted_address', 'latitude', 'longitude', 'google_place_id'
].join(',');

// Datos minimos para precargar el registro del estudio. Nunca expone el hash,
// ni quien creo el link, ni otros datos del estudio.
async function loadClaimPreview(fetchRest, token, { now = Date.now() } = {}) {
    if (!isWellFormedClaimToken(token)) return { status: 'invalid' };
    const links = await fetchRest(
        `studio_claim_links?token_hash=eq.${enc(hashClaimToken(token))}` +
        '&select=id,studio_id,expires_at,used_at,revoked_at&limit=1'
    );
    const link = Array.isArray(links) && links[0] ? links[0] : null;
    if (!link) return { status: 'invalid' };

    const studios = await fetchRest(
        `studios?id=eq.${enc(link.studio_id)}&select=id,name,user_id,primary_location_id,location_verified&limit=1`
    );
    const studio = Array.isArray(studios) && studios[0] ? studios[0] : null;
    const status = claimLinkStatus(link, studio, now);
    if (status !== 'valid') return { status };

    let location = null;
    if (studio.primary_location_id) {
        const locs = await fetchRest(
            `studio_locations?id=eq.${enc(studio.primary_location_id)}&select=${PREVIEW_LOCATION_COLUMNS}&limit=1`
        );
        location = Array.isArray(locs) && locs[0] ? locs[0] : null;
    }

    return {
        status,
        expires_at: link.expires_at || null,
        studio: {
            id: studio.id,
            name: studio.name,
            location_verified: studio.location_verified === true
        },
        location
    };
}

// Estudio sin duenio que creo este tatuador (para regenerar su link de alta).
async function findArtistCreatedStudio(fetchRest, artistUserId, studioId) {
    if (!artistUserId) return null;
    const filter = studioId ? `&id=eq.${enc(studioId)}` : '';
    const rows = await fetchRest(
        `studios?created_by_artist_user_id=eq.${enc(artistUserId)}${filter}` +
        '&select=id,name,user_id,location_verified,created_at&order=created_at.desc&limit=1'
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function getActiveClaimLink(fetchRest, studioId) {
    const nowIso = new Date().toISOString();
    const rows = await fetchRest(
        `studio_claim_links?studio_id=eq.${enc(studioId)}&used_at=is.null&revoked_at=is.null` +
        `&expires_at=gt.${enc(nowIso)}&select=id,created_at,expires_at&order=created_at.desc&limit=1`
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

module.exports = {
    CLAIM_QUERY_PARAM,
    CLAIM_TTL_DAYS,
    buildStudioClaimPath,
    claimLinkStatus,
    findArtistCreatedStudio,
    generateClaimToken,
    getActiveClaimLink,
    hashClaimToken,
    isWellFormedClaimToken,
    issueStudioClaimLink,
    loadClaimPreview
};
