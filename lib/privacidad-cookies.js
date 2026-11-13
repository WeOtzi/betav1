'use strict';

// ── privacidad ──
// Lógica pura del banner de cookies y de la geolocalización privada.
//   - Configuración del consentimiento (app_settings.cookie_consent_config):
//     valores por defecto, saneo de lo que guarda el backoffice y versión
//     pública que lee el banner (GET /api/privacy/cookie-config).
//   - Registro del consentimiento de un usuario con sesión (user_preferences
//     .privacy.cookie_consent + cookie_consent_log).
//   - IP: anonimización (IPv4 /24, IPv6 /48) y país estimado a partir de la
//     zona horaria / idioma del navegador, sin enviar la IP a terceros.
// Sin dependencias: testeable con node:test (tests/r3c-privacidad.test.js).

const CONFIG_KEY = 'cookie_consent_config';
const CONSENT_VERSION_DEFAULT = '2026-11-13';
const CATEGORY_IDS = ['necessary', 'analytics', 'marketing'];
const SCRIPT_TYPES = ['clarity'];
const CONSENT_SOURCES = ['banner', 'settings', 'gpc'];

const DEFAULT_CONFIG = Object.freeze({
    enabled: true,
    version: CONSENT_VERSION_DEFAULT,
    renew_days: 365,
    policy_url: '/legal/privacy#cookies',
    texts: {
        title: 'Cookies y privacidad',
        body: 'Usamos cookies y almacenamiento local necesarios para que la plataforma funcione. Con tu permiso también usamos analítica para entender cómo se usa y mejorarla. Podés cambiar tu elección cuando quieras desde «Configuración de cookies».',
        accept_all: 'Aceptar todas',
        reject: 'Rechazar no esenciales',
        configure: 'Configurar',
        save: 'Guardar elección',
        gpc_notice: 'Tu navegador envía la señal Global Privacy Control: dejamos apagadas las cookies no esenciales. Si querés, podés activarlas acá.'
    },
    categories: [
        {
            id: 'necessary',
            label: 'Necesarias',
            description: 'Sesión iniciada, seguridad, preferencias de la interfaz, borradores y esta misma elección. Siempre están activas.',
            required: true,
            enabled: true
        },
        {
            id: 'analytics',
            label: 'Analítica',
            description: 'Medición del uso y grabación anónima de sesiones para mejorar la plataforma (Microsoft Clarity).',
            required: false,
            enabled: true
        },
        {
            id: 'marketing',
            label: 'Marketing',
            description: 'Publicidad y medición de campañas. Hoy no usamos ningún servicio de marketing.',
            required: false,
            enabled: false
        }
    ],
    scripts: [
        {
            id: 'clarity',
            type: 'clarity',
            provider: 'Microsoft Clarity',
            category: 'analytics',
            project_id: '',
            enabled: true,
            exclude_paths: ['/backoffice', '/support']
        }
    ]
});

const TEXT_LIMITS = { title: 80, body: 800, accept_all: 40, reject: 40, configure: 40, save: 40, gpc_notice: 300 };

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function cleanText(value, max, fallback) {
    if (typeof value !== 'string') return fallback;
    // Sin etiquetas: el banner pinta los textos con textContent, pero igual se
    // guardan limpios para que nada parezca HTML en el backoffice.
    const text = value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
    return text || fallback;
}

function isValidVersion(value) {
    return typeof value === 'string' && /^[A-Za-z0-9._-]{1,32}$/.test(value);
}

function isValidClarityId(value) {
    return typeof value === 'string' && /^[a-z0-9]{6,20}$/i.test(value) && value !== 'CLARITY_TRACKING_ID';
}

function cleanPolicyUrl(value) {
    if (typeof value !== 'string') return DEFAULT_CONFIG.policy_url;
    const url = value.trim();
    // Solo rutas internas: el banner nunca debe mandar a un dominio arbitrario.
    if (/^\/(?!\/)[A-Za-z0-9/_#.-]{0,120}$/.test(url)) return url;
    return DEFAULT_CONFIG.policy_url;
}

function cleanPaths(list) {
    if (!Array.isArray(list)) return [];
    return list
        .filter((p) => typeof p === 'string' && /^\/[A-Za-z0-9/_-]{0,80}$/.test(p.trim()))
        .map((p) => p.trim())
        .slice(0, 20);
}

/**
 * Normaliza la configuración que llega del backoffice (o de app_settings).
 * Devuelve { config, errors }: errors vacío = válida. Lo desconocido se
 * descarta; lo inválido vuelve al valor por defecto y se informa.
 */
function sanitizeConfig(input) {
    const errors = [];
    const base = clone(DEFAULT_CONFIG);
    const src = input && typeof input === 'object' ? input : {};

    const config = {
        enabled: typeof src.enabled === 'boolean' ? src.enabled : base.enabled,
        version: base.version,
        renew_days: base.renew_days,
        policy_url: cleanPolicyUrl(src.policy_url),
        texts: {},
        categories: [],
        scripts: []
    };

    if (src.version !== undefined) {
        if (isValidVersion(String(src.version))) config.version = String(src.version);
        else errors.push('La versión solo admite letras, números, punto, guion y guion bajo (máx. 32).');
    }

    if (src.renew_days !== undefined) {
        const days = Number(src.renew_days);
        if (Number.isInteger(days) && days >= 30 && days <= 395) config.renew_days = days;
        else errors.push('La renovación tiene que ser un número entero de días entre 30 y 395.');
    }

    const texts = src.texts && typeof src.texts === 'object' ? src.texts : {};
    for (const key of Object.keys(TEXT_LIMITS)) {
        config.texts[key] = cleanText(texts[key], TEXT_LIMITS[key], base.texts[key]);
    }

    const srcCategories = Array.isArray(src.categories) ? src.categories : [];
    for (const def of base.categories) {
        const found = srcCategories.find((c) => c && c.id === def.id) || {};
        const required = def.id === 'necessary';
        config.categories.push({
            id: def.id,
            label: cleanText(found.label, 40, def.label),
            description: cleanText(found.description, 300, def.description),
            required,
            // Las necesarias no se pueden apagar.
            enabled: required ? true : (typeof found.enabled === 'boolean' ? found.enabled : def.enabled)
        });
    }

    const srcScripts = Array.isArray(src.scripts) ? src.scripts : base.scripts;
    const seen = new Set();
    for (const s of srcScripts.slice(0, 10)) {
        if (!s || typeof s !== 'object') continue;
        if (!SCRIPT_TYPES.includes(s.type)) {
            errors.push(`Tipo de script no soportado: ${String(s.type || '?').slice(0, 20)}.`);
            continue;
        }
        const id = typeof s.id === 'string' && /^[a-z0-9_-]{1,32}$/.test(s.id) ? s.id : s.type;
        if (seen.has(id)) continue;
        seen.add(id);
        const category = CATEGORY_IDS.includes(s.category) && s.category !== 'necessary' ? s.category : 'analytics';
        const projectId = typeof s.project_id === 'string' ? s.project_id.trim() : '';
        if (projectId && !isValidClarityId(projectId)) {
            errors.push('El ID de proyecto de Clarity tiene que tener entre 6 y 20 letras o números.');
        }
        config.scripts.push({
            id,
            type: s.type,
            provider: cleanText(s.provider, 60, 'Microsoft Clarity'),
            category,
            project_id: isValidClarityId(projectId) ? projectId : '',
            enabled: typeof s.enabled === 'boolean' ? s.enabled : true,
            exclude_paths: s.exclude_paths === undefined ? ['/backoffice', '/support'] : cleanPaths(s.exclude_paths)
        });
    }

    return { config, errors };
}

/** Lee el valor guardado en app_settings (texto JSON) con tolerancia a basura. */
function parseStoredConfig(raw) {
    if (!raw) return sanitizeConfig({}).config;
    let parsed = raw;
    if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch (_) { return sanitizeConfig({}).config; }
    }
    return sanitizeConfig(parsed).config;
}

/**
 * Lo que recibe el banner: sin scripts apagados ni sin ID, con el ID de
 * Clarity del entorno (CLARITY_PROJECT_ID) como respaldo si el backoffice no
 * cargó uno. Nunca expone nada secreto (no hay secretos en esta config).
 */
function toPublicConfig(config, env = {}) {
    const cfg = sanitizeConfig(config || {}).config;
    const envClarity = typeof env.CLARITY_PROJECT_ID === 'string' && isValidClarityId(env.CLARITY_PROJECT_ID.trim())
        ? env.CLARITY_PROJECT_ID.trim() : '';
    const activeCategories = new Set(cfg.categories.filter((c) => c.enabled).map((c) => c.id));
    const scripts = cfg.scripts
        .map((s) => (s.type === 'clarity' && !s.project_id && envClarity ? { ...s, project_id: envClarity } : s))
        .filter((s) => s.enabled && s.project_id && activeCategories.has(s.category))
        .map((s) => ({ id: s.id, type: s.type, provider: s.provider, category: s.category, project_id: s.project_id, exclude_paths: s.exclude_paths }));
    return {
        enabled: cfg.enabled,
        version: cfg.version,
        renew_days: cfg.renew_days,
        policy_url: cfg.policy_url,
        texts: cfg.texts,
        categories: cfg.categories
            .filter((c) => c.enabled)
            .map((c) => ({
                id: c.id,
                label: c.label,
                description: c.description,
                required: c.required,
                providers: scripts.filter((s) => s.category === c.id).map((s) => s.provider)
            })),
        scripts
    };
}

/**
 * Valida el consentimiento que manda el banner de un usuario con sesión.
 * Devuelve { ok, consent } o { ok:false, error }. Solo booleanos por
 * categoría conocida; "necessary" siempre true.
 */
function normalizeConsentPayload(body, now = new Date()) {
    const src = body && typeof body === 'object' ? body : {};
    if (!isValidVersion(String(src.version || ''))) return { ok: false, error: 'Versión de consentimiento inválida' };
    const cats = src.categories && typeof src.categories === 'object' ? src.categories : null;
    if (!cats) return { ok: false, error: 'Faltan las categorías' };
    const categories = { necessary: true };
    for (const id of CATEGORY_IDS) {
        if (id === 'necessary') continue;
        categories[id] = cats[id] === true;
    }
    const source = CONSENT_SOURCES.includes(src.source) ? src.source : 'banner';
    return {
        ok: true,
        consent: {
            version: String(src.version),
            categories,
            source,
            gpc: src.gpc === true,
            decided_at: now.toISOString()
        }
    };
}

// ── IP ──────────────────────────────────────────────────────────────────

/** IPv4 → a.b.c.0 ; IPv6 → primeros 48 bits + "::" ; inválida → null. */
function anonymizeIp(ip) {
    if (typeof ip !== 'string') return null;
    let value = ip.trim();
    if (!value || value === 'unknown') return null;
    if (value.includes(',')) value = value.split(',')[0].trim();
    const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
    if (mapped) value = mapped[1];
    const v4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
        const parts = v4.slice(1, 4).map(Number);
        if (parts.some((n) => n > 255) || Number(v4[4]) > 255) return null;
        return `${parts.join('.')}.0`;
    }
    if (/^[0-9a-f:]+$/i.test(value) && value.includes(':')) {
        const [head] = value.split('::');
        const groups = head ? head.split(':') : [];
        const keep = groups.slice(0, 3);
        while (keep.length < 3) keep.push('0');
        if (keep.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
        return `${keep.map((g) => g.toLowerCase()).join(':')}::`;
    }
    return null;
}

/** Primera IP del request (x-forwarded-for / x-real-ip / socket), sin anonimizar. */
function requestIp(req) {
    const headers = (req && req.headers) || {};
    const fwd = typeof headers['x-forwarded-for'] === 'string' ? headers['x-forwarded-for'].split(',')[0].trim() : '';
    return fwd || headers['x-real-ip'] || (req && req.socket && req.socket.remoteAddress) || (req && req.ip) || null;
}

// País por zona horaria IANA (mismos nombres en inglés que guardaba ip-api,
// para no romper las vistas de analítica que agrupan por session_logs.country).
const TZ_COUNTRY = {
    'America/Buenos_Aires': 'Argentina', 'America/Cordoba': 'Argentina', 'America/Mendoza': 'Argentina',
    'America/Montevideo': 'Uruguay', 'America/Santiago': 'Chile', 'America/Punta_Arenas': 'Chile',
    'America/Asuncion': 'Paraguay', 'America/La_Paz': 'Bolivia', 'America/Lima': 'Peru',
    'America/Bogota': 'Colombia', 'America/Caracas': 'Venezuela', 'America/Guayaquil': 'Ecuador',
    'Pacific/Galapagos': 'Ecuador', 'America/Panama': 'Panama', 'America/Costa_Rica': 'Costa Rica',
    'America/Guatemala': 'Guatemala', 'America/El_Salvador': 'El Salvador', 'America/Tegucigalpa': 'Honduras',
    'America/Managua': 'Nicaragua', 'America/Santo_Domingo': 'Dominican Republic', 'America/Havana': 'Cuba',
    'America/Puerto_Rico': 'Puerto Rico',
    'America/Mexico_City': 'Mexico', 'America/Monterrey': 'Mexico', 'America/Cancun': 'Mexico',
    'America/Merida': 'Mexico', 'America/Tijuana': 'Mexico', 'America/Chihuahua': 'Mexico',
    'America/Hermosillo': 'Mexico', 'America/Mazatlan': 'Mexico', 'America/Matamoros': 'Mexico',
    'America/Bahia_Banderas': 'Mexico',
    'America/Sao_Paulo': 'Brazil', 'America/Fortaleza': 'Brazil', 'America/Recife': 'Brazil',
    'America/Bahia': 'Brazil', 'America/Manaus': 'Brazil', 'America/Belem': 'Brazil',
    'America/New_York': 'United States', 'America/Chicago': 'United States', 'America/Denver': 'United States',
    'America/Los_Angeles': 'United States', 'America/Phoenix': 'United States', 'America/Anchorage': 'United States',
    'America/Detroit': 'United States', 'Pacific/Honolulu': 'United States',
    'America/Toronto': 'Canada', 'America/Vancouver': 'Canada', 'America/Montreal': 'Canada',
    'America/Edmonton': 'Canada', 'America/Winnipeg': 'Canada', 'America/Halifax': 'Canada',
    'Europe/Madrid': 'Spain', 'Atlantic/Canary': 'Spain', 'Africa/Ceuta': 'Spain',
    'Europe/Lisbon': 'Portugal', 'Atlantic/Madeira': 'Portugal', 'Atlantic/Azores': 'Portugal',
    'Europe/Rome': 'Italy', 'Europe/Paris': 'France', 'Europe/Berlin': 'Germany',
    'Europe/London': 'United Kingdom', 'Europe/Dublin': 'Ireland', 'Europe/Amsterdam': 'Netherlands',
    'Europe/Brussels': 'Belgium', 'Europe/Zurich': 'Switzerland', 'Europe/Vienna': 'Austria',
    'Australia/Sydney': 'Australia', 'Australia/Melbourne': 'Australia', 'Australia/Brisbane': 'Australia',
    'Australia/Perth': 'Australia'
};

const REGION_COUNTRY = {
    AR: 'Argentina', UY: 'Uruguay', CL: 'Chile', PY: 'Paraguay', BO: 'Bolivia', PE: 'Peru', CO: 'Colombia',
    VE: 'Venezuela', EC: 'Ecuador', PA: 'Panama', CR: 'Costa Rica', GT: 'Guatemala', SV: 'El Salvador',
    HN: 'Honduras', NI: 'Nicaragua', DO: 'Dominican Republic', CU: 'Cuba', PR: 'Puerto Rico', MX: 'Mexico',
    BR: 'Brazil', US: 'United States', CA: 'Canada', ES: 'Spain', PT: 'Portugal', IT: 'Italy', FR: 'France',
    DE: 'Germany', GB: 'United Kingdom', IE: 'Ireland', NL: 'Netherlands', BE: 'Belgium', CH: 'Switzerland',
    AT: 'Austria', AU: 'Australia'
};

/**
 * País aproximado sin IP: primero la zona horaria IANA del navegador
 * (Intl.DateTimeFormat().resolvedOptions().timeZone), después la región del
 * idioma (es-AR → Argentina). Devuelve null si no se puede inferir.
 * Nunca devuelve ciudad: la ciudad de la zona horaria no es la del usuario.
 */
function countryFromHints(hints) {
    const src = hints && typeof hints === 'object' ? hints : {};
    const tz = typeof src.tz === 'string' ? src.tz.trim() : '';
    if (tz) {
        if (TZ_COUNTRY[tz]) return TZ_COUNTRY[tz];
        if (/^America\/Argentina\//.test(tz)) return 'Argentina';
        if (/^America\/(Indiana|Kentucky|North_Dakota)\//.test(tz)) return 'United States';
    }
    const lang = typeof src.lang === 'string' ? src.lang.trim() : '';
    const region = lang.match(/^[a-z]{2,3}[-_]([A-Za-z]{2})\b/);
    if (region && REGION_COUNTRY[region[1].toUpperCase()]) return REGION_COUNTRY[region[1].toUpperCase()];
    return null;
}

module.exports = {
    CONFIG_KEY,
    CONSENT_VERSION_DEFAULT,
    CATEGORY_IDS,
    DEFAULT_CONFIG,
    sanitizeConfig,
    parseStoredConfig,
    toPublicConfig,
    normalizeConsentPayload,
    isValidClarityId,
    anonymizeIp,
    requestIp,
    countryFromHints
};
