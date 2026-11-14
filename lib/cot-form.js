'use strict';

// ===========================================================================
// Cotizador web (/quotation) — helpers puros del servidor.
// ---------------------------------------------------------------------------
// - Referencias del cliente: Storage (bucket quotation-references) es la
//   fuente de verdad. El navegador sube los archivos al folder de su borrador
//   y manda solo los paths; el servidor los valida y registra las URLs.
// - Cotización sin artista → Job Board: mapeo de la cotización a
//   job_board_requests.
// - Config pública: nunca publica secretos (service account de Drive, key de
//   Gemini, PRESET_PASSWORD, webhooks).
// ===========================================================================

const REFERENCE_BUCKET = 'quotation-references';
const MAX_REFERENCES = 4;
const QUOTE_ID_RE = /^QN[0-9a-f]{32}$/;
// QN<32 hex>/ref_<n>_<timestamp>.<ext> (lo que genera uploadReferencesToStorage).
const REFERENCE_PATH_RE = /^(QN[0-9a-f]{32})\/ref_(\d{1,2})_(\d{10,14})\.(jpe?g|png|webp|gif|heic|heif)$/i;
const MIME_BY_EXT = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    gif: 'image/gif', heic: 'image/heic', heif: 'image/heif'
};

function httpError(message, status = 400, extra = {}) {
    const error = new Error(message);
    error.status = status;
    Object.assign(error, { extra });
    return error;
}

/**
 * Valida la lista de referencias que manda el navegador en el envío final.
 * Solo acepta paths del folder del propio borrador (quoteId), sin duplicados
 * y como máximo 4. Devuelve [{ path, file_name, mime_type }].
 */
function normalizeReferences(list, quoteId) {
    if (list == null) return [];
    if (!Array.isArray(list)) throw httpError('Las referencias no son válidas.');
    if (!QUOTE_ID_RE.test(String(quoteId || ''))) throw httpError('La cotización no es válida.');
    const out = [];
    for (const item of list) {
        const path = typeof item === 'string' ? item : item && item.path;
        const match = REFERENCE_PATH_RE.exec(String(path || ''));
        if (!match || match[1] !== quoteId) throw httpError('Una de las referencias no pertenece a esta solicitud.');
        if (out.some((ref) => ref.path === path)) continue;
        const ext = match[4].toLowerCase();
        out.push({ path, file_name: path.split('/').pop(), mime_type: MIME_BY_EXT[ext] || 'image/jpeg' });
    }
    if (out.length > MAX_REFERENCES) throw httpError(`Podés adjuntar hasta ${MAX_REFERENCES} referencias.`);
    return out;
}

function referencePublicUrl(supabaseUrl, path) {
    const base = String(supabaseUrl || '').replace(/\/$/, '');
    const encoded = String(path).split('/').map(encodeURIComponent).join('/');
    return `${base}/storage/v1/object/public/${REFERENCE_BUCKET}/${encoded}`;
}

// El espejo a Drive solo descarga archivos del folder de la propia cotización.
function isOwnReferenceUrl(url, supabaseUrl, quoteId) {
    if (typeof url !== 'string' || !QUOTE_ID_RE.test(String(quoteId || ''))) return false;
    const prefix = `${String(supabaseUrl || '').replace(/\/$/, '')}/storage/v1/object/public/${REFERENCE_BUCKET}/${quoteId}/`;
    if (!url.startsWith(prefix)) return false;
    const rest = url.slice(prefix.length);
    return /^ref_\d{1,2}_\d{10,14}\.(jpe?g|png|webp|gif|heic|heif)$/i.test(rest);
}

function attachmentRows(quoteId, references, supabaseUrl) {
    return references.map((ref, index) => ({
        quotation_id: quoteId,
        google_drive_url: referencePublicUrl(supabaseUrl, ref.path),
        file_name: ref.file_name,
        mime_type: ref.mime_type,
        attachment_type: 'reference',
        status: 'confirmed',
        sort_order: index + 1
    }));
}

// Nombres legibles de los estilos elegidos ("Fine Line · Blackwork").
function styleNames(tattooStyle) {
    const names = [];
    const visit = (value) => {
        if (value == null || value === '') return;
        if (Array.isArray(value)) { value.forEach(visit); return; }
        if (typeof value === 'object') {
            if (Array.isArray(value.styles) && value.styles.length) { value.styles.forEach(visit); return; }
            const name = value.style_name || value.name || value.label || value.style_slug;
            if (name) names.push(String(name).trim());
            return;
        }
        names.push(String(value).trim());
    };
    visit(tattooStyle);
    return [...new Set(names.filter(Boolean))];
}

// Edad a partir de la fecha de nacimiento (YYYY-MM-DD). null si no es válida.
function ageFromBirthDate(value, now = new Date()) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const birth = new Date(Date.UTC(year, month - 1, day));
    if (birth.getUTCMonth() !== month - 1 || birth.getTime() > now.getTime()) return null;
    let age = now.getUTCFullYear() - year;
    const beforeBirthday = now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day);
    if (beforeBirthday) age -= 1;
    return age >= 0 && age <= 120 ? age : null;
}

// Tramos del Figma 06 (script.js FIGMA_BUDGET_TIERS): el wizard guarda el
// punto medio; el Job Board guarda min/max.
const BUDGET_TIERS = { 50: [null, 100], 150: [100, 200], 300: [200, 400], 500: [400, 600], 600: [600, null] };

function budgetRange(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return { min: null, max: null };
    if (BUDGET_TIERS[n]) return { min: BUDGET_TIERS[n][0], max: BUDGET_TIERS[n][1] };
    return { min: null, max: Math.round(n) };
}

function splitCityCountry(text) {
    const parts = String(text || '').split(',').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return { city: null, country: null };
    return { city: parts[0], country: parts.length > 1 ? parts[parts.length - 1] : null };
}

function truthy(value) {
    return value === true || value === 'true' || value === 'Sí' || value === 'si';
}

/**
 * Cotización (normalizada por el intake) → fila de job_board_requests.
 * Los campos destacados/sponsor quedan en sus defaults (los cuida el trigger
 * enforce_job_request_curated_fields).
 */
function buildJobBoardRequest(q, extras, userId) {
    const { city, country } = splitCityCountry(q.client_city_residence);
    const { min, max } = budgetRange(q.client_budget_amount);
    let description = String(q.tattoo_idea_description || '').trim();
    if (extras && extras.personalization_level === 'interpretacion') {
        description += '\n\nAbierto a interpretación del artista.';
    } else if (extras && extras.personalization_level === 'propuesta') {
        description += '\n\nQuiero que el artista me proponga algo.';
    }
    const styles = styleNames(q.tattoo_style);
    return {
        client_user_id: userId,
        tattoo_idea_description: description.slice(0, 4000),
        tattoo_body_part: q.tattoo_body_part || null,
        tattoo_body_side: q.tattoo_body_side || null,
        tattoo_size: q.tattoo_size || null,
        tattoo_style: styles.length ? styles : null,
        tattoo_color_type: q.tattoo_color_type || null,
        tattoo_is_first_tattoo: truthy(q.tattoo_is_first_tattoo),
        tattoo_is_cover_up: truthy(q.tattoo_is_cover_up),
        client_city: city,
        client_country: country,
        client_travel_willing: truthy(q.client_travel_willing),
        client_preferred_date: q.client_preferred_date || null,
        client_flexible_dates: q.client_flexible_dates == null ? null : String(q.client_flexible_dates),
        client_budget_min: min,
        client_budget_max: max,
        client_budget_currency: /^[A-Z]{3}$/.test(String(q.client_budget_currency || '')) ? q.client_budget_currency : 'USD',
        status: 'open',
        is_public: true
    };
}

function jobBoardAttachmentRows(requestId, references, supabaseUrl) {
    return references.slice(0, 3).map((ref, index) => ({
        request_id: requestId,
        file_url: referencePublicUrl(supabaseUrl, ref.path),
        storage_path: `${REFERENCE_BUCKET}/${ref.path}`,
        file_name: ref.file_name,
        mime_type: ref.mime_type,
        sort_order: index
    }));
}

/**
 * Config pública servida en /shared/js/app-config.json. Quita todo secreto y
 * deja solo banderas: el navegador nunca recibe credenciales de servidor.
 */
function sanitizePublicConfig(config, env = {}) {
    const out = JSON.parse(JSON.stringify(config || {}));
    const driveEnabled = !!(env.GOOGLE_DRIVE_FOLDER_ID && env.GOOGLE_DRIVE_SERVICE_ACCOUNT);
    out.googleDrive = { enabled: driveEnabled };
    const gemini = out.gemini && typeof out.gemini === 'object' ? out.gemini : {};
    delete gemini.apiKey;
    gemini.enabled = !!env.GEMINI_API_KEY || gemini.enabled === true;
    out.gemini = gemini;
    if (out.registration && typeof out.registration === 'object') delete out.registration.presetPassword;
    if (out.n8n && typeof out.n8n === 'object') {
        delete out.n8n.webhookUrl;
        delete out.n8n.driveFolderId;
    }
    return out;
}

module.exports = {
    REFERENCE_BUCKET,
    MAX_REFERENCES,
    QUOTE_ID_RE,
    REFERENCE_PATH_RE,
    httpError,
    normalizeReferences,
    referencePublicUrl,
    isOwnReferenceUrl,
    attachmentRows,
    styleNames,
    ageFromBirthDate,
    budgetRange,
    buildJobBoardRequest,
    jobBoardAttachmentRows,
    sanitizePublicConfig
};
