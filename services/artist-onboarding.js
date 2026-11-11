'use strict';

// ===========================================================================
// Estado del onboarding / modo asistido del artista (servidor)
// ---------------------------------------------------------------------------
//   GET  /api/artist/onboarding  -> estado calculado (pasos, checks, progreso)
//   POST /api/artist/onboarding  -> actualiza app_settings.onboarding
// server.js monta los handlers:
//   app.get('/api/artist/onboarding', onboarding.getOnboarding)
//   app.post('/api/artist/onboarding', onboarding.patchOnboarding)
//
// Los pasos se calculan con datos leidos con service role (lib/postgrest.js).
// Cada fuente opcional degrada sin lanzar:
//   - artist_payout_destinations ausente      -> paso "retiro" unavailable
//   - artist_verification_documents ausente   -> paso "verificacion" unavailable
//   - services/instagram-verification.js ausente o con error
//       -> instagram { available:false }; en "portafolio" los checks de
//          Instagram pasan a opcionales ("se habilita pronto") y el paso se
//          completa con al menos un trabajo
//   - columnas opcionales de artists_db (preferred_display_currency,
//     instagram_verified_*, profile_links) -> se reintenta sin ellas
//
// user_preferences.app_settings.onboarding lo escribe SOLO este modulo, con
// merge profundo: el resto de app_settings (profile, availability, reminders,
// recovery...) se lee y se vuelve a escribir entero, sin perder claves.
// Cada lectura-merge-escritura corre en una cola por usuario (en el proceso),
// asi dos POST que se cruzan (dos "mas tarde" seguidos) conservan ambos cambios.
// ===========================================================================

const { resolveBearerUser } = require('../lib/auth/supabase-auth');
const { pgrest } = require('../lib/postgrest');
const { applicationBase } = require('./email-request-context');

const NEW_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

const STEP_IDS = Object.freeze([
    'perfil', 'portafolio', 'compartir', 'retiro', 'disponibilidad', 'notificaciones', 'verificacion', 'configuracion'
]);
const ACK_IDS = Object.freeze(['compartir.enlace', 'compartir.bio', 'compartir', 'notificaciones', 'configuracion']);

// `section` es la seccion de /artist/account donde se completa (null: dentro del panel).
const STEP_DEFS = Object.freeze({
    perfil: { title: 'Completá tu perfil', section: 'perfil' },
    portafolio: { title: 'Validá tu Instagram y tu portafolio', section: 'portafolio' },
    compartir: { title: 'Compartí tu perfil en Instagram', section: null },
    retiro: { title: 'Configurá un medio de retiro', section: 'cobros' },
    disponibilidad: { title: 'Configurá tu disponibilidad', section: 'disponibilidad' },
    notificaciones: { title: 'Configurá tus notificaciones', section: 'notificaciones' },
    verificacion: { title: 'Completá la verificación', section: 'verificacion' },
    configuracion: { title: 'Completá la configuración', section: 'configuracion' }
});

function deepFreeze(value) {
    if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

const DEFAULT_ONBOARDING = deepFreeze({
    demo_suggestions: true,
    demo_auto_started_at: null,
    assisted: {
        active: false,
        started_at: null,
        completed_at: null,
        welcome_seen_at: null,
        acknowledged: {},
        skipped: {}
    }
});

const WORK_TYPES = ['independent', 'studio', 'both'];
const INDEPENDENT_STUDIO_LABEL = 'sin estudio/independiente';
const VERIFICATION_IN_PROCESS = ['Requested', 'In Progress', 'In Analysis', 'Yes'];
const INSTAGRAM_STATUSES = ['none', 'pending', 'verified', 'expired'];

// Columnas de artists_db que leen los checks. Las opcionales pueden no existir
// todavia en la base viva (migraciones sin aplicar).
const ARTIST_COLUMNS = Object.freeze([
    'user_id', 'username', 'name', 'email', 'instagram', 'portafolio', 'profile_picture', 'whatsapp_number',
    'bio_description', 'city', 'country', 'work_type', 'estudios', 'studio_id', 'verification_state',
    'ms_profile_shared', 'gallery_feed_items', 'gallery_images'
]);
const ARTIST_OPTIONAL_COLUMNS = Object.freeze([
    'preferred_display_currency', 'instagram_verified_at', 'instagram_verified_handle', 'profile_links'
]);

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function plainObject(value) {
    return isPlainObject(value) ? value : {};
}
function hasText(value) {
    return value != null && String(value).trim().length > 0;
}
function cleanHandle(value) {
    return value == null ? '' : String(value).trim().replace(/^@+/, '').trim();
}
function plainText(html) {
    return String(html == null ? '' : html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').trim();
}
function isoOrNull(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    return Number.isFinite(Date.parse(value)) ? value : null;
}
function nonNegativeInt(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
function present(value) {
    return value !== undefined && value !== null;
}

// Mapa { id: iso } filtrado a los ids permitidos.
function timestampMap(value, allowed) {
    const out = {};
    for (const [key, stamp] of Object.entries(plainObject(value))) {
        if (allowed.includes(key) && isoOrNull(stamp)) out[key] = stamp;
    }
    return out;
}

// Forma completa del contrato (§2) a partir de lo guardado; ignora claves ajenas.
function normalizeOnboarding(raw) {
    const src = plainObject(raw);
    const assisted = plainObject(src.assisted);
    return {
        demo_suggestions: src.demo_suggestions !== false,
        demo_auto_started_at: isoOrNull(src.demo_auto_started_at),
        assisted: {
            active: assisted.active === true,
            started_at: isoOrNull(assisted.started_at),
            completed_at: isoOrNull(assisted.completed_at),
            welcome_seen_at: isoOrNull(assisted.welcome_seen_at),
            acknowledged: timestampMap(assisted.acknowledged, ACK_IDS),
            skipped: timestampMap(assisted.skipped, STEP_IDS)
        }
    };
}

// Objeto `instagram` del contrato (§3). Sin estado del modulo -> available:false.
function normalizeInstagram(raw, artist) {
    const src = plainObject(raw);
    const hasState = isPlainObject(raw);
    const available = hasState ? src.available !== false : false;
    const verifiedAt = isoOrNull(src.verified_at);
    return {
        available,
        // `enforced` y `verified` permiten pasar este objeto directo a
        // WoGalleryVisibility.stateFrom() en el navegador.
        enforced: available,
        verified: Boolean(verifiedAt) || src.verified === true,
        status: INSTAGRAM_STATUSES.includes(src.status) ? src.status : 'none',
        handle: cleanHandle(src.handle) || cleanHandle(artist && artist.instagram) || null,
        verified_handle: cleanHandle(src.verified_handle) || null,
        verified_at: isoOrNull(src.verified_at),
        expires_at: isoOrNull(src.expires_at),
        email_masked: hasText(src.email_masked) ? String(src.email_masked) : null,
        pending_items: nonNegativeInt(src.pending_items),
        legacy_items: nonNegativeInt(src.legacy_items)
    };
}

function check(id, label, done, optional) {
    return { id, label, done: !!done, optional: !!optional };
}

function countWorks(artist) {
    const feed = Array.isArray(artist.gallery_feed_items) ? artist.gallery_feed_items : [];
    const fromFeed = feed.filter((item) => item && hasText(item.url)).length;
    if (fromFeed) return fromFeed;
    const legacy = Array.isArray(artist.gallery_images) ? artist.gallery_images : [];
    return legacy.filter((url) => typeof url === 'string' && url.trim()).length;
}

// weekly: formato historico [{day, enabled, start, end}] u objeto { lunes: {...} }.
function hasEnabledDay(weekly) {
    const days = Array.isArray(weekly) ? weekly : isPlainObject(weekly) ? Object.values(weekly) : [];
    return days.some((day) => isPlainObject(day) && !!day.enabled && day.enabled !== 'false');
}

// Misma lectura que artist-account.js docStatus().
function docStatus(doc) {
    if (!doc) return 'missing';
    const status = String(doc.status || '').toLowerCase();
    if (status.includes('verific') || status.includes('aprob')) return 'verified';
    if (status.includes('rechaz') || status.includes('deneg')) return 'rejected';
    return 'pending';
}

// ---------------------------------------------------------------------------
// computeSteps (puro)
// input = { artist, prefs, payouts:{available,count}, documents:[]|null, instagram, onboarding }
//   documents === null significa "tabla no disponible".
// ---------------------------------------------------------------------------

function computeSteps(input) {
    const src = plainObject(input);
    const artist = plainObject(src.artist);
    const prefs = plainObject(src.prefs);
    const appSettings = plainObject(prefs.app_settings);
    const profilePrefs = plainObject(appSettings.profile);
    const onboarding = normalizeOnboarding(present(src.onboarding) ? src.onboarding : appSettings.onboarding);
    const acked = onboarding.assisted.acknowledged;
    const skipped = onboarding.assisted.skipped;
    const payouts = plainObject(src.payouts);
    const documents = src.documents === null ? null : Array.isArray(src.documents) ? src.documents : [];
    const instagram = normalizeInstagram(src.instagram, artist);

    const built = {};

    // perfil
    const profileLinks = plainObject(artist.profile_links);
    built.perfil = {
        checks: [
            check('banner', 'Banner de perfil', hasText(profilePrefs.banner_url)),
            check('foto', 'Foto de perfil', hasText(artist.profile_picture)),
            check('redes', 'Instagram, TikTok o sitio web', cleanHandle(artist.instagram) || cleanHandle(profilePrefs.tiktok)
                || hasText(artist.portafolio) || hasText(profileLinks.website)),
            check('whatsapp', 'WhatsApp de contacto', String(artist.whatsapp_number || '').replace(/\D/g, '').length >= 6),
            check('email', 'Email de contacto', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(artist.email || '').trim())),
            check('bio', 'Biografía', plainText(artist.bio_description).length > 0, true)
        ]
    };

    // portafolio: mientras la validacion de Instagram no esta disponible
    // (migracion sin aplicar) sus dos checks pasan a opcionales y el paso se
    // completa con `trabajos`. No es 'unavailable': el trabajo sigue haciendo
    // falta y el panel oculta los checks de los pasos unavailable.
    const igReady = instagram.available;
    const soon = igReady ? '' : ' (se habilita pronto)';
    built.portafolio = {
        checks: [
            check('trabajos', 'Al menos un trabajo en tu portafolio', countWorks(artist) >= 1),
            check('instagram_validado', 'Instagram validado' + soon, igReady && instagram.status === 'verified', !igReady),
            check('portafolio_validado', 'Fotos de Instagram validadas' + soon, igReady && instagram.pending_items === 0, !igReady)
        ]
    };

    // compartir
    built.compartir = {
        checks: [
            check('enlace_copiado', 'Enlace de tu perfil copiado', !!acked['compartir.enlace'], true),
            check('bio_copiada', 'Texto para tu bio copiado', !!acked['compartir.bio'], true),
            check('pegado', 'Enlace pegado en tu bio de Instagram', !!acked.compartir || artist.ms_profile_shared === true)
        ]
    };

    // retiro
    const payoutsAvailable = payouts.available !== false;
    built.retiro = {
        unavailable: !payoutsAvailable,
        checks: [check('destino', 'Al menos un destino de retiro', payoutsAvailable && nonNegativeInt(payouts.count) >= 1)]
    };

    // disponibilidad
    const workType = String(artist.work_type || '').trim().toLowerCase();
    const studioName = String(artist.estudios || '').trim().toLowerCase();
    const hasStudio = hasText(artist.studio_id) || (!!studioName && studioName !== INDEPENDENT_STUDIO_LABEL);
    const availability = plainObject(appSettings.availability);
    const locationWeekly = Object.values(plainObject(availability.locations))
        .some((loc) => hasEnabledDay(plainObject(loc).weekly));
    built.disponibilidad = {
        checks: [
            check('modalidad', 'Modalidad de trabajo', WORK_TYPES.includes(workType)),
            check('estudio', 'Estudio donde trabajás', workType === 'independent'
                || ((workType === 'studio' || workType === 'both') && hasStudio)),
            check('horarios', 'Días y horarios de atención', hasEnabledDay(availability.weekly) || locationWeekly)
        ]
    };

    // notificaciones
    built.notificaciones = {
        checks: [check('preferencias', 'Preferencias de notificaciones guardadas',
            Object.keys(plainObject(prefs.notification_prefs)).length > 0 || !!acked.notificaciones)]
    };

    // verificacion: un documento cuenta si existe y no esta rechazado. Una cuenta
    // ya verificada (verification_state 'Yes') no vuelve a pedir documentos.
    const docs = documents || [];
    const docOf = (type) => docs.find((doc) => doc && doc.doc_type === type) || null;
    const docLoaded = (type) => { const status = docStatus(docOf(type)); return status !== 'missing' && status !== 'rejected'; };
    const accountVerified = artist.verification_state === 'Yes';
    const identityVerified = docStatus(docOf('identidad')) === 'verified';
    built.verificacion = {
        unavailable: documents === null && !accountVerified,
        checks: [
            check('identidad', 'Documento de identidad', accountVerified || docLoaded('identidad')),
            check('domicilio', 'Comprobante de domicilio', accountVerified || docLoaded('domicilio')),
            check('bioseguridad', 'Certificado de bioseguridad', docLoaded('bioseguridad'), true),
            check('solicitud', 'Solicitud de verificación enviada',
                VERIFICATION_IN_PROCESS.includes(artist.verification_state) || identityVerified)
        ]
    };

    // configuracion: done si (region && moneda) o ack 'configuracion'
    const region = (hasText(appSettings.country) || hasText(artist.country)) && hasText(appSettings.timezone);
    built.configuracion = {
        forceDone: !!acked.configuracion,
        checks: [
            check('region', 'Región y zona horaria', region),
            check('moneda', 'Moneda de visualización', hasText(artist.preferred_display_currency)),
            check('revisada', 'Configuración revisada', !!acked.configuracion, true)
        ]
    };

    const steps = STEP_IDS.map((id) => {
        const def = STEP_DEFS[id];
        const step = built[id];
        const requiredDone = step.checks.every((c) => c.optional || c.done);
        let status = 'pending';
        if (step.unavailable) status = 'unavailable';
        else if (requiredDone || step.forceDone) status = 'done';
        else if (skipped[id]) status = 'skipped';
        return { id, title: def.title, section: def.section, status, checks: step.checks };
    });

    const firstPending = steps.find((step) => step.status === 'pending');
    return {
        steps,
        current_step: firstPending ? firstPending.id : null,
        completed: !firstPending,
        progress: { done: steps.filter((step) => step.status === 'done').length, total: steps.length }
    };
}

// ---------------------------------------------------------------------------
// mergeOnboardingPatch (puro)
// Aplica el body del POST (solo claves del contrato) sobre app_settings y
// devuelve el app_settings COMPLETO a escribir. No muta la entrada.
//   -> { ok:true, app_settings, onboarding, effects:{ profileShared } }
//   -> { ok:false, error }
// ---------------------------------------------------------------------------

function mergeOnboardingPatch(appSettings, body, nowIso) {
    const now = isoOrNull(nowIso) || new Date().toISOString();
    const fail = (error) => ({ ok: false, error });
    const settings = plainObject(appSettings);
    const input = body == null ? {} : body;
    if (!isPlainObject(input)) return fail('El cuerpo de la solicitud tiene que ser un objeto.');

    const stored = plainObject(settings.onboarding);
    const next = normalizeOnboarding(stored);
    const assisted = next.assisted;
    const effects = { profileShared: false };

    if (present(input.demo_suggestions)) {
        if (typeof input.demo_suggestions !== 'boolean') return fail('demo_suggestions tiene que ser true o false.');
        next.demo_suggestions = input.demo_suggestions;
    }
    if (present(input.demo_auto_started)) {
        if (typeof input.demo_auto_started !== 'boolean') return fail('demo_auto_started tiene que ser true o false.');
        next.demo_auto_started_at = input.demo_auto_started ? (next.demo_auto_started_at || now) : null;
    }
    if (present(input.assisted)) {
        const patch = input.assisted;
        if (!isPlainObject(patch)) return fail('assisted tiene que ser un objeto.');
        if (present(patch.active)) {
            if (typeof patch.active !== 'boolean') return fail('assisted.active tiene que ser true o false.');
            assisted.active = patch.active;
            if (patch.active && !assisted.started_at) assisted.started_at = now;
        }
        if (present(patch.acknowledge)) {
            if (!ACK_IDS.includes(patch.acknowledge)) return fail('Ese paso no se puede marcar como hecho.');
            if (!assisted.acknowledged[patch.acknowledge]) assisted.acknowledged[patch.acknowledge] = now;
            if (patch.acknowledge === 'compartir') effects.profileShared = true;
        }
        if (present(patch.skip)) {
            if (!STEP_IDS.includes(patch.skip)) return fail('El paso indicado no existe.');
            if (!assisted.skipped[patch.skip]) assisted.skipped[patch.skip] = now;
        }
        if (present(patch.unskip)) {
            if (!STEP_IDS.includes(patch.unskip)) return fail('El paso indicado no existe.');
            delete assisted.skipped[patch.unskip];
        }
        if (present(patch.welcome_seen)) {
            if (typeof patch.welcome_seen !== 'boolean') return fail('assisted.welcome_seen tiene que ser true o false.');
            assisted.welcome_seen_at = patch.welcome_seen ? (assisted.welcome_seen_at || now) : null;
        }
    }

    // Merge profundo: se conservan claves que no son del contrato dentro de
    // onboarding / assisted y todo el resto de app_settings.
    const merged = { ...stored, ...next, assisted: { ...plainObject(stored.assisted), ...assisted } };
    return { ok: true, app_settings: { ...settings, onboarding: merged }, onboarding: next, effects };
}

function withCompletedAt(appSettings, nowIso) {
    const settings = plainObject(appSettings);
    const onboarding = plainObject(settings.onboarding);
    return { ...settings, onboarding: { ...onboarding, assisted: { ...plainObject(onboarding.assisted), completed_at: nowIso } } };
}

// ---------------------------------------------------------------------------
// Cuenta nueva y URL del perfil publico
// ---------------------------------------------------------------------------

function toMillis(value) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    return Date.parse(String(value == null ? '' : value));
}

// Cuenta de auth creada hace <= NEW_WINDOW_DAYS dias (una fecha futura cuenta como nueva).
function isNewAccount(createdAt, now, windowDays) {
    const created = toMillis(createdAt);
    if (!Number.isFinite(created)) return false;
    const reference = present(now) ? toMillis(now) : Date.now();
    const days = Number.isFinite(windowDays) ? windowDays : NEW_WINDOW_DAYS;
    return (Number.isFinite(reference) ? reference : Date.now()) - created <= days * DAY_MS;
}

// base: string ya resuelto, o la request (misma resolucion que los emails:
// PUBLIC_APP_URL / APP_URL, o el origen local + req.weotziBasePath).
function buildProfileUrl(username, baseOrReq) {
    const slug = String(username == null ? '' : username).trim().replace(/\.wo$/i, '');
    if (!slug) return null;
    const base = typeof baseOrReq === 'string' ? baseOrReq : applicationBase(baseOrReq || { headers: {} });
    return `${String(base).replace(/\/+$/, '')}/artist/profile?artist=${encodeURIComponent(slug)}`;
}

// ---------------------------------------------------------------------------
// Fuentes de datos (service role). `query` se inyecta en tests.
// ---------------------------------------------------------------------------

function errorText(err) {
    return String((err && err.message) || '');
}

function isMissingTable(err) {
    return !!err && (err.status === 404 || /PGRST205|42P01|Could not find the table|relation .* does not exist/i.test(errorText(err)));
}

function missingColumn(err) {
    const text = errorText(err);
    if (!(err && err.status === 400) && !/42703|PGRST204/.test(text)) return null;
    const match = /column\s+"?(?:\w+\.)?(\w+)"?\s+does not exist/i.exec(text)
        || /Could not find the '(\w+)' column/i.exec(text);
    return { column: match ? match[1] : null };
}

async function loadArtist(userId, query = pgrest) {
    let optional = ARTIST_OPTIONAL_COLUMNS.slice();
    for (;;) {
        try {
            return await query('artists_db').select(ARTIST_COLUMNS.concat(optional).join(','))
                .eq('user_id', userId).limit(1).single().execute();
        } catch (err) {
            const missing = missingColumn(err);
            if (!missing || !optional.length) throw err;
            // Si PostgREST nombra la columna se saca solo esa; si no, todas las opcionales.
            optional = missing.column && optional.includes(missing.column)
                ? optional.filter((column) => column !== missing.column) : [];
        }
    }
}

async function loadPrefs(userId, query = pgrest) {
    return query('user_preferences').select('user_id,notification_prefs,app_settings')
        .eq('user_id', userId).limit(1).single().execute();
}

async function loadPayouts(userId, query = pgrest) {
    try {
        const rows = await query('artist_payout_destinations').select('id')
            .eq('artist_user_id', userId).eq('active', true).limit(50).execute();
        return { available: true, count: Array.isArray(rows) ? rows.length : 0 };
    } catch (err) {
        if (isMissingTable(err)) return { available: false, count: 0 };
        console.warn('[Artist Onboarding] payout destinations:', errorText(err));
        return { available: true, count: 0 };
    }
}

async function loadDocuments(userId, query = pgrest) {
    try {
        const rows = await query('artist_verification_documents').select('doc_type,status')
            .eq('artist_user_id', userId).execute();
        return Array.isArray(rows) ? rows : [];
    } catch (err) {
        if (isMissingTable(err)) return null;
        console.warn('[Artist Onboarding] verification documents:', errorText(err));
        return [];
    }
}

// services/instagram-verification.js lo escribe otra pieza; si falta o falla
// se devuelve el estado "no disponible" sin romper el endpoint.
async function loadInstagram({ userId, artist, authUser }, requireModule = require) {
    let mod = null;
    try {
        mod = requireModule('./instagram-verification');
    } catch (err) {
        if (!(err && err.code === 'MODULE_NOT_FOUND' && errorText(err).includes('instagram-verification'))) {
            console.warn('[Artist Onboarding] instagram module:', errorText(err));
        }
    }
    if (!mod || typeof mod.getStateForArtist !== 'function') return normalizeInstagram(null, artist);
    try {
        const state = await mod.getStateForArtist({ userId, artist, authUser });
        return isPlainObject(state) ? normalizeInstagram(state, artist) : normalizeInstagram(null, artist);
    } catch (err) {
        console.warn('[Artist Onboarding] instagram state:', errorText(err));
        return normalizeInstagram(null, artist);
    }
}

async function savePrefs(userId, appSettings, query = pgrest) {
    await query('user_preferences').upsert({ user_id: userId, app_settings: appSettings },
        { onConflict: 'user_id', returning: false });
}

async function markProfileShared(userId, query = pgrest) {
    await query('artists_db').eq('user_id', userId).patch({ ms_profile_shared: true }, { returning: false });
}

// ---------------------------------------------------------------------------
// Handlers Express
// ---------------------------------------------------------------------------

const DEFAULT_DEPS = Object.freeze({
    resolveUser: resolveBearerUser,
    loadArtist: (userId) => loadArtist(userId),
    loadPrefs: (userId) => loadPrefs(userId),
    loadPayouts: (userId) => loadPayouts(userId),
    loadDocuments: (userId) => loadDocuments(userId),
    loadInstagram: (ctx) => loadInstagram(ctx),
    savePrefs: (userId, appSettings) => savePrefs(userId, appSettings),
    markProfileShared: (userId) => markProfileShared(userId),
    now: () => new Date()
});

async function settle(fn, fallback, label) {
    try {
        return await fn();
    } catch (err) {
        console.warn(`[Artist Onboarding] ${label}:`, errorText(err));
        return fallback;
    }
}

function createHandlers(overrides) {
    const deps = { ...DEFAULT_DEPS, ...plainObject(overrides) };

    // Cola de escrituras de app_settings por usuario (mismo patron que
    // prefsQueues en public/shared/js/data/account-repo.js). savePrefs escribe
    // app_settings entero: sin la cola, dos requests que leen a la vez se pisan
    // y gana el ultimo upsert. Cubre un proceso; varias instancias del servidor
    // todavia comparten la ventana de un viaje a la base.
    const writeQueues = new Map();
    function serializeWrites(userId, task) {
        const previous = writeQueues.get(userId) || Promise.resolve();
        const run = previous.catch(() => null).then(task);
        const tail = run.catch(() => null);
        writeQueues.set(userId, tail);
        tail.then(() => { if (writeQueues.get(userId) === tail) writeQueues.delete(userId); });
        return run;
    }

    async function authenticate(req, res) {
        const user = await deps.resolveUser(req);
        if (!user) {
            res.status(401).json({ success: false, error: 'Authentication required' });
            return null;
        }
        const artist = await deps.loadArtist(user.id);
        if (!artist) {
            res.status(403).json({ success: false, error: 'Artist profile required' });
            return null;
        }
        return { user, artist };
    }

    // Fuentes opcionales en paralelo. Las preferencias se cargan aparte porque
    // un POST nunca escribe app_settings si no pudo leer el actual.
    async function loadSources(user, artist) {
        const [payouts, documents, instagram] = await Promise.all([
            settle(() => deps.loadPayouts(user.id), { available: true, count: 0 }, 'payouts'),
            settle(() => deps.loadDocuments(user.id), [], 'documents'),
            settle(() => deps.loadInstagram({ userId: user.id, artist, authUser: user }), null, 'instagram')
        ]);
        return { payouts, documents, instagram: normalizeInstagram(instagram, artist) };
    }

    function payload({ req, user, artist, prefs, sources, appSettings, now }) {
        const onboarding = normalizeOnboarding(appSettings.onboarding);
        const state = computeSteps({ artist, prefs: { ...plainObject(prefs), app_settings: appSettings },
            payouts: sources.payouts, documents: sources.documents, instagram: sources.instagram, onboarding });
        const createdAt = user.raw && user.raw.created_at;
        return {
            success: true,
            user_id: user.id,
            username: artist.username || null,
            artist_name: artist.name || null,
            is_new: isNewAccount(createdAt, now),
            account_created_at: isoOrNull(createdAt),
            new_window_days: NEW_WINDOW_DAYS,
            profile_url: buildProfileUrl(artist.username, req),
            onboarding,
            steps: state.steps,
            current_step: state.current_step,
            completed: state.completed,
            progress: state.progress,
            instagram: sources.instagram
        };
    }

    function needsCompletedAt(appSettings, ctx) {
        const onboarding = normalizeOnboarding(appSettings.onboarding);
        if (onboarding.assisted.completed_at) return false;
        return computeSteps({ ...ctx, prefs: { ...plainObject(ctx.prefs), app_settings: appSettings }, onboarding }).completed;
    }

    async function getOnboarding(req, res) {
        try {
            const auth = await authenticate(req, res);
            if (!auth) return undefined;
            const { user, artist } = auth;
            const now = deps.now();
            let prefsOk = true;
            const [loadedPrefs, sources] = await Promise.all([
                Promise.resolve().then(() => deps.loadPrefs(user.id)).catch((err) => {
                    prefsOk = false;
                    console.warn('[Artist Onboarding] preferences:', errorText(err));
                    return null;
                }),
                loadSources(user, artist)
            ]);
            // Sin preferencias no se puede saber qué eligió el artista: responder
            // los valores por defecto (asistido apagado, sugerencia prendida)
            // cerraría el panel o reactivaría la sugerencia por un error pasajero.
            // El navegador conserva su estado ante un 503.
            if (!prefsOk) {
                return res.status(503).json({
                    success: false,
                    code: 'ONBOARDING_PREFS_UNAVAILABLE',
                    error: 'No pudimos cargar tu progreso. Probá de nuevo en unos minutos.'
                });
            }
            let prefs = loadedPrefs;
            let appSettings = plainObject(prefs && prefs.app_settings);
            const ctx = { artist, prefs, ...sources };
            // Si el artista esta usando el modo asistido y ya completo todo (por
            // ejemplo guardando el ultimo dato en la cuenta), se registra completed_at.
            const engaged = normalizeOnboarding(appSettings.onboarding).assisted.started_at;
            if (prefsOk && engaged && needsCompletedAt(appSettings, ctx)) {
                try {
                    // En la cola del usuario y releyendo app_settings: escribir la
                    // copia leida arriba pisaria un POST que haya guardado en el medio.
                    const written = await serializeWrites(user.id, async () => {
                        const fresh = await deps.loadPrefs(user.id);
                        const current = plainObject(fresh && fresh.app_settings);
                        const freshCtx = { ...ctx, prefs: fresh };
                        if (!normalizeOnboarding(current.onboarding).assisted.started_at
                            || !needsCompletedAt(current, freshCtx)) return { prefs: fresh, appSettings: current };
                        const next = withCompletedAt(current, now.toISOString());
                        await deps.savePrefs(user.id, next);
                        return { prefs: fresh, appSettings: next };
                    });
                    prefs = written.prefs;
                    appSettings = written.appSettings;
                } catch (err) {
                    console.warn('[Artist Onboarding] completed_at:', errorText(err));
                }
            }
            return res.json(payload({ req, user, artist, prefs, sources, appSettings, now }));
        } catch (err) {
            console.error('[Artist Onboarding] GET failed:', errorText(err));
            return res.status(500).json({ success: false, error: 'No pudimos cargar tu progreso. Probá de nuevo en unos minutos.' });
        }
    }

    async function patchOnboarding(req, res) {
        try {
            const auth = await authenticate(req, res);
            if (!auth) return undefined;
            const now = deps.now();
            const nowIso = now.toISOString();
            // Validacion del body antes de leer el resto de los datos.
            const validation = mergeOnboardingPatch({}, req.body, nowIso);
            if (!validation.ok) return res.status(400).json({ success: false, error: validation.error });

            const { user } = auth;
            // Las fuentes opcionales no escriben: se cargan fuera de la cola.
            const pendingSources = loadSources(user, auth.artist);
            pendingSources.catch(() => null);

            // Lectura, merge y upsert de app_settings de a uno por usuario: un
            // POST que se cruza con otro lee lo que el anterior ya guardo.
            const result = await serializeWrites(user.id, async () => {
                let artist = auth.artist;
                const [prefs, sources] = await Promise.all([deps.loadPrefs(user.id), pendingSources]);
                const current = plainObject(prefs && prefs.app_settings);
                const merged = mergeOnboardingPatch(current, req.body, nowIso);
                if (!merged.ok) return { error: merged.error };

                if (merged.effects.profileShared && artist.ms_profile_shared !== true) {
                    try {
                        await deps.markProfileShared(user.id);
                        artist = { ...artist, ms_profile_shared: true };
                    } catch (err) {
                        // El ack 'compartir' ya satisface el check "pegado".
                        console.warn('[Artist Onboarding] ms_profile_shared:', errorText(err));
                    }
                }

                let appSettings = merged.app_settings;
                if (needsCompletedAt(appSettings, { artist, prefs, ...sources })) appSettings = withCompletedAt(appSettings, nowIso);
                if (JSON.stringify(appSettings) !== JSON.stringify(current)) await deps.savePrefs(user.id, appSettings);
                return { artist, prefs, sources, appSettings };
            });
            if (result.error) return res.status(400).json({ success: false, error: result.error });

            return res.json(payload({ req, user, now, ...result }));
        } catch (err) {
            console.error('[Artist Onboarding] POST failed:', errorText(err));
            return res.status(500).json({ success: false, error: 'No pudimos guardar tu progreso. Probá de nuevo en unos minutos.' });
        }
    }

    return { getOnboarding, patchOnboarding };
}

const { getOnboarding, patchOnboarding } = createHandlers();

module.exports = {
    getOnboarding,
    patchOnboarding,
    _internal: {
        computeSteps,
        mergeOnboardingPatch,
        isNewAccount,
        buildProfileUrl,
        DEFAULT_ONBOARDING,
        STEP_IDS,
        ACK_IDS,
        NEW_WINDOW_DAYS,
        normalizeOnboarding,
        normalizeInstagram,
        createHandlers,
        loaders: { loadArtist, loadPrefs, loadPayouts, loadDocuments, loadInstagram, savePrefs, markProfileShared },
        ARTIST_COLUMNS,
        ARTIST_OPTIONAL_COLUMNS
    }
};
