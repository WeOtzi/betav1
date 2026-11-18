'use strict';

// ===========================================================================
// Gate de Términos y bloqueo de reingreso · lógica pura (2.7.0).
// ---------------------------------------------------------------------------
// Decisión del dueño (2026-11-18): todas las personas vuelven a aceptar los
// Términos vigentes (TERMS_VERSION) al iniciar sesión. La fuente de verdad es
// public.terms_acceptances (migración 20261118120000); como respaldo cuenta
// también cualquier perfil propio ya sellado con la versión vigente (altas
// nuevas que sella handle_new_user, complete_studio_registration o el
// finalize del artista).
//
// Bloqueo de reingreso: las altas que el servidor no ve (cliente y estudio
// desde el navegador, Google, Facebook, enlace mágico) se revisan sin
// depender del navegador: un barrido periódico del servidor
// (lib/routes/terminos.js, RPC terms_reentry_pending) y, además, cada
// GET /api/account/terms-status y POST /api/account/terms-accept. Se revisa
// toda cuenta creada desde REENTRY_ENFORCED_SINCE (fecha fija del release, no
// una ventana móvil) que todavía no tiene una fila en terms_acceptances: se
// comparan correo, teléfono e Instagram con los identificadores baneados
// (lib/sanciones-service.checkReentry, equipo T3). Las cuentas anteriores al
// release no se bloquean solas. Invariante: el servidor solo inserta en
// terms_acceptances después de esa comprobación.
//
// Excepción de soporte: si soporte levanta el cierre de una cuenta (por
// ejemplo, el automático de blockNewAccount por un falso positivo) o descarta
// su alerta de reingreso, la cuenta queda con cleared_at en
// terms_reentry_checks. checkReentry (sanciones-service) deja de bloquearla
// por las huellas de OTRA cuenta en todos los caminos que pasan su userId
// (terms-status, terms-accept, barrido, modo cliente, validación de
// Instagram); el barrido además la saltea en la RPC. Las huellas de la cuenta
// sancionada original siguen bloqueando a cualquier otra cuenta, y un alta sin
// cuenta todavía (precheck, finalize del artista) no tiene excepción posible.
//
// lib/sanciones-service.js se carga de forma diferida y con try/catch: si
// falta o falla, el registro sigue (falla abierta con un aviso en el log).
// ===========================================================================

const { TERMS_VERSION } = require('./terms-acceptance');
const { REGISTRATION_COUNTRIES } = require('./registration-catalogs');

// Desde cuándo una cuenta nueva pasa por el bloqueo de reingreso (release 2.7.0).
const REENTRY_ENFORCED_SINCE = '2026-11-18T00:00:00Z';
const REENTRY_ENFORCED_SINCE_MS = Date.parse(REENTRY_ENFORCED_SINCE);

// Mensaje único al bloquear un alta: nunca dice por qué.
const REGISTRATION_BLOCKED_MESSAGE = 'No podemos crear esta cuenta. Si crees que es un error, escribe a soporte.';
const REGISTRATION_BLOCKED = Object.freeze({ code: 'REGISTRATION_BLOCKED', error: REGISTRATION_BLOCKED_MESSAGE });

const SURFACES = Object.freeze(['artist', 'client', 'studio', 'signup', 'gate']);
const SANCTION_KINDS_VISIBLE = Object.freeze(['suspension', 'ban']);

function normalizeSurface(value) {
    const v = String(value || '').trim().toLowerCase();
    return SURFACES.includes(v) ? v : 'gate';
}

function cleanString(value, max) {
    const text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return text ? text.slice(0, max) : '';
}

// ── país → ISO 3166-1 alfa-2 ────────────────────────────────────────────────
// artists_db.country guarda nombres ("Argentina", "Mexico", "United States");
// studios.country_code ya trae el código. normalizePhone (T3) usa el ISO2.
function foldText(value) {
    return String(value || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/\s+/g, ' ').trim();
}

const COUNTRY_ALIASES = Object.freeze({
    'united states': 'US', 'usa': 'US', 'eeuu': 'US', 'ee.uu.': 'US', 'estados unidos de america': 'US',
    'spain': 'ES', 'mexico': 'MX', 'brazil': 'BR', 'peru': 'PE', 'germany': 'DE',
    'united kingdom': 'GB', 'uk': 'GB', 'canada': 'CA', 'new zealand': 'NZ'
});

const COUNTRY_BY_NAME = (() => {
    const map = new Map();
    for (const c of REGISTRATION_COUNTRIES) map.set(foldText(c.name), c.code);
    for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) map.set(alias, code);
    return map;
})();

function countryIso2(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
    return COUNTRY_BY_NAME.get(foldText(raw)) || null;
}

// ── perfiles y aceptación ───────────────────────────────────────────────────

function asProfiles(profiles) {
    const p = profiles || {};
    return {
        artist: p.artist || null,
        client: p.client || null,
        studios: Array.isArray(p.studios) ? p.studios.filter(Boolean) : []
    };
}

function rolesFrom(profiles) {
    const p = asProfiles(profiles);
    return { artist: Boolean(p.artist), client: Boolean(p.client), studio: p.studios.length > 0 };
}

function profileRows(profiles) {
    const p = asProfiles(profiles);
    return [p.artist, p.client].concat(p.studios).filter(Boolean);
}

/**
 * ¿Aceptó la versión vigente?
 *   acceptances: filas de terms_acceptances del usuario ({version, accepted_at})
 *                o null si la tabla todavía no existe.
 *   profiles:    { artist, client, studios[] } con terms_version / terms_accepted_at.
 * Devuelve { accepted, acceptedVersion } (acceptedVersion: la vigente si la
 * aceptó; si no, la última que se sabe que aceptó, o null).
 */
function acceptanceState({ acceptances, profiles, current = TERMS_VERSION }) {
    const rows = Array.isArray(acceptances) ? acceptances.filter((r) => r && r.version) : [];
    const stamped = profileRows(profiles).filter((r) => r.terms_version && r.terms_accepted_at);
    const accepted = rows.some((r) => r.version === current) || stamped.some((r) => r.terms_version === current);
    if (accepted) return { accepted: true, acceptedVersion: current };
    const candidates = rows.map((r) => ({ version: r.version, at: Date.parse(r.accepted_at) || 0 }))
        .concat(stamped.map((r) => ({ version: r.terms_version, at: Date.parse(r.terms_accepted_at) || 0 })))
        .sort((a, b) => b.at - a.at);
    return { accepted: false, acceptedVersion: candidates.length ? candidates[0].version : null };
}

function accountCreatedAt(user) {
    const raw = (user && user.raw) || {};
    const t = Date.parse(raw.created_at || (user && user.created_at) || '');
    return Number.isFinite(t) ? t : null;
}

// ¿La cuenta se creó desde el release del bloqueo de reingreso?
function isEnforcedAccount(user, since = REENTRY_ENFORCED_SINCE_MS) {
    const created = accountCreatedAt(user);
    if (created == null) return false;
    return created >= since;
}

/**
 * La comprobación de reingreso corre para toda cuenta creada desde
 * REENTRY_ENFORCED_SINCE que todavía no tiene ninguna fila en
 * terms_acceptances. Si la tabla no existe (acceptances null) también corre:
 * es más seguro revisar de más.
 */
function needsReentryCheck({ user, acceptances, since = REENTRY_ENFORCED_SINCE_MS }) {
    if (!isEnforcedAccount(user, since)) return false;
    return !(Array.isArray(acceptances) && acceptances.length > 0);
}

function uniqueNonEmpty(values) {
    const seen = new Set();
    const out = [];
    for (const v of values) {
        const s = cleanString(v, 200);
        if (!s) continue;
        const key = s.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
    }
    return out;
}

/**
 * Identificadores a comparar para una cuenta ya creada. Devuelve una lista de
 * entradas para checkReentry: la primera con todo (correo, primer teléfono,
 * primer Instagram, país) y luego una por cada teléfono o Instagram extra.
 */
function reentryInputs({ user, profiles, flow = 'login' }) {
    const p = asProfiles(profiles);
    const raw = (user && user.raw) || {};
    const meta = raw.user_metadata || {};
    const studio = p.studios[0] || null;
    const phones = uniqueNonEmpty([
        raw.phone,
        p.artist && p.artist.whatsapp_number,
        p.client && p.client.whatsapp,
        ...p.studios.flatMap((s) => [s.whatsapp, s.contact_phone, s.phone]),
        meta.whatsapp
    ]);
    const instagrams = uniqueNonEmpty([
        p.artist && p.artist.instagram,
        ...p.studios.map((s) => s.instagram),
        p.client && p.client.instagram,
        meta.instagram
    ]);
    const country = countryIso2(
        (p.artist && (p.artist.country_code || p.artist.country)) ||
        (studio && (studio.country_code || studio.country)) ||
        (p.client && p.client.country) || ''
    );
    const userId = user && user.id ? user.id : null;
    const base = {
        email: cleanString(user && user.email, 320) || null,
        phone: phones[0] || null,
        instagram: instagrams[0] || null,
        country,
        flow,
        userId
    };
    const inputs = [base];
    phones.slice(1).forEach((phone) => inputs.push({ email: null, phone, instagram: null, country, flow, userId }));
    instagrams.slice(1).forEach((instagram) => inputs.push({ email: null, phone: null, instagram, country, flow, userId }));
    return inputs;
}

function sanctionView(sanction) {
    if (!sanction || typeof sanction !== 'object') return null;
    const kind = String(sanction.kind || '');
    if (!SANCTION_KINDS_VISIBLE.includes(kind)) return null;
    return { kind, ends_at: sanction.ends_at || null };
}

/**
 * Valida el cuerpo de POST /api/account/terms-accept.
 * { ok:true, version } | { ok:false, status, code, error }
 */
function validateAccept(body, current = TERMS_VERSION) {
    const b = body && typeof body === 'object' ? body : {};
    if (b.accepted !== true) {
        return { ok: false, status: 400, code: 'TERMS_REQUIRED', error: 'Para continuar, acepta los Términos y la Política de privacidad.' };
    }
    if (String(b.version || '') !== current) {
        return { ok: false, status: 409, code: 'TERMS_OUTDATED', error: 'Los Términos se actualizaron mientras leías. Recarga la página para ver la versión vigente.', current };
    }
    return { ok: true, version: current };
}

/**
 * Entrada de POST /api/register/precheck (sin sesión). Recorta todo; el
 * correo tiene que parecer un correo. { ok:true, input } | { ok:false }
 */
function precheckInput(body) {
    const b = body && typeof body === 'object' ? body : {};
    const email = cleanString(b.email, 320).toLowerCase();
    const phone = cleanString(b.phone, 40);
    const instagram = cleanString(b.instagram, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false };
    if (!email && !phone && !instagram) return { ok: false };
    // El flujo que entiende sanciones-service (FLOW_LABELS) es 'precheck'; el
    // origen (cliente, estudio…) no cambia nada y no se confía en él.
    const flow = 'precheck';
    return {
        ok: true,
        input: { email: email || null, phone: phone || null, instagram: instagram || null, country: countryIso2(b.country), flow, userId: null }
    };
}

// ── lib/sanciones-service (T3) con carga diferida y falla abierta ───────────

function warnDefault(...args) { console.warn(...args); }

function loadSanctionsService(requireFn = require) {
    try {
        const mod = requireFn('./sanciones-service');
        return mod && typeof mod === 'object' ? mod : null;
    } catch (err) {
        // Sin el módulo (todavía no desplegado) no se avisa en cada request;
        // un error de carga real sí queda en el log.
        if (!err || err.code !== 'MODULE_NOT_FOUND') warnDefault('[terms-gate] no se pudo cargar sanciones-service:', err && err.message);
        return null;
    }
}

// Reemplazo del servicio para tests (server.js y account-modes usan el real).
let serviceOverride;
function setSanctionsService(svc) {
    const previous = serviceOverride;
    serviceOverride = svc;
    return () => { serviceOverride = previous; };
}

function resolveService(service) {
    if (service !== undefined) return service || null;
    if (serviceOverride !== undefined) return serviceOverride || null;
    return loadSanctionsService();
}

/**
 * checkReentry sin romper nunca el registro. Acepta una entrada o una lista
 * (se corta en la primera coincidencia). Devuelve { blocked, matches, checked }.
 */
async function checkReentrySafe(inputOrList, { service, log = warnDefault } = {}) {
    const svc = resolveService(service);
    const list = (Array.isArray(inputOrList) ? inputOrList : [inputOrList]).filter(Boolean);
    if (!svc || typeof svc.checkReentry !== 'function') {
        log('[terms-gate] sanciones-service no disponible: bloqueo de reingreso sin comprobar');
        return { blocked: false, matches: [], checked: false };
    }
    for (const input of list) {
        try {
            const result = await svc.checkReentry(input);
            if (result && result.blocked === true) {
                return { blocked: true, matches: Array.isArray(result.matches) ? result.matches : [], checked: true };
            }
        } catch (err) {
            log('[terms-gate] checkReentry falló (se deja pasar):', err && err.message);
            return { blocked: false, matches: [], checked: false };
        }
    }
    return { blocked: false, matches: [], checked: true };
}

async function blockNewAccountSafe(args, { service, log = warnDefault } = {}) {
    const svc = resolveService(service);
    if (!svc || typeof svc.blockNewAccount !== 'function') {
        log('[terms-gate] blockNewAccount no disponible');
        return false;
    }
    try {
        await svc.blockNewAccount(args);
        return true;
    } catch (err) {
        log('[terms-gate] blockNewAccount falló:', err && err.message);
        return false;
    }
}

async function activeSanctionSafe(userId, { service, log = warnDefault } = {}) {
    const svc = resolveService(service);
    if (!svc || typeof svc.getActiveSanction !== 'function') return null;
    try {
        return sanctionView(await svc.getActiveSanction(userId));
    } catch (err) {
        log('[terms-gate] getActiveSanction falló:', err && err.message);
        return null;
    }
}

module.exports = {
    TERMS_VERSION,
    REENTRY_ENFORCED_SINCE,
    REGISTRATION_BLOCKED,
    REGISTRATION_BLOCKED_MESSAGE,
    SURFACES,
    normalizeSurface,
    countryIso2,
    rolesFrom,
    acceptanceState,
    isEnforcedAccount,
    needsReentryCheck,
    reentryInputs,
    sanctionView,
    validateAccept,
    precheckInput,
    loadSanctionsService,
    checkReentrySafe,
    blockNewAccountSafe,
    activeSanctionSafe,
    _internal: { setSanctionsService }
};
