'use strict';

// ===========================================================================
// Validación de la cuenta de Instagram del artista (servidor).
// ---------------------------------------------------------------------------
// Flujo:
//   1. El artista pide un código (POST /api/artist/instagram-verification).
//      Generamos WO-XXXXXX, guardamos solo su sha256 en
//      artist_instagram_verifications (vence en 72 h) y se lo mandamos al
//      email de su cuenta (evento instagram_verification_code).
//   2. El artista se lo manda por mensaje directo a @weotzi desde la cuenta
//      que quiere validar. La automatización de DMs (n8n + Meta) llama a
//      POST /api/instagram-verification/inbound con el remitente y el texto.
//   3. Si el código está vigente y el remitente es la cuenta de la fila,
//      marcamos artists_db.instagram_verified_at / instagram_verified_handle.
//      El trigger de la migración también se dispara con esas dos columnas y
//      recalcula gallery_images (las fotos importadas de esa cuenta pasan a
//      ser públicas, ver public/shared/js/gallery-visibility.js). No se
//      reescribe gallery_feed_items: una copia leída antes podría pisar una
//      edición de la galería guardada en el medio.
//   Soporte puede confirmar o rechazar a mano (/api/support/instagram-verifications).
//
// La tabla y las columnas vienen de la migración 20261030120000 (todavía NO
// aplicada). Sin ella los endpoints del artista responden 503
// IG_VERIFICATION_UNAVAILABLE y getStateForArtist devuelve available:false.
// El código nunca se devuelve en una respuesta ni se escribe en los logs.
// ===========================================================================

const crypto = require('crypto');
const { resolveBearerUser } = require('../lib/auth/supabase-auth');
const { pgrest } = require('../lib/postgrest');
const appSettings = require('../lib/app-settings');
const emailService = require('./email-service');
const visibility = require('../public/shared/js/gallery-visibility.js');

const TABLE = 'artist_instagram_verifications';
const EMAIL_EVENT = 'instagram_verification_code';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_PREFIX = 'WO-';
const CODE_LENGTH = 6;
const CODE_TTL_HOURS = 72;
const CODE_TTL_MS = CODE_TTL_HOURS * 60 * 60 * 1000;
const MAX_DM_LENGTH = 2000;
const MAX_CODE_CANDIDATES = 10;
const MAX_MISMATCH_ATTEMPTS = 5;
const MAX_NOTE_LENGTH = 500;
const SUPPORT_LIST_LIMIT = 200;
const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UNAVAILABLE_CODE = 'IG_VERIFICATION_UNAVAILABLE';
const UNAVAILABLE_ERROR = 'La validación de Instagram se habilita pronto.';
const GENERIC_ERROR = 'No pudimos completar la validación de Instagram. Probá de nuevo en un rato.';
const MISSING_HANDLE_ERROR = 'Cargá tu usuario de Instagram en Mi perfil antes de validar.';
const INVALID_HANDLE_ERROR = 'Ese usuario de Instagram no es válido. Usá solo letras, números, puntos y guiones bajos.';
const DM_URL = 'https://ig.me/m/weotzi';
const INSTRUCTIONS = Object.freeze({
    account: 'weotzi',
    follow_url: 'https://www.instagram.com/weotzi/',
    dm_url: DM_URL
});

const ARTIST_BASE_COLUMNS = 'user_id,name,username,email,instagram,gallery_feed_items';
const ARTIST_VERIFY_COLUMNS = ARTIST_BASE_COLUMNS + ',instagram_verified_at,instagram_verified_handle';
const STATE_COLUMNS = 'id,ig_handle,status,email_sent_to,email_sent,created_at,expires_at,verified_at';
const SUPPORT_COLUMNS = 'id,artist_user_id,ig_handle,status,email_sent_to,email_sent,attempts,created_at,expires_at,verified_at,verified_via,dm_sender_handle,note';
const CONFIRM_COLUMNS = SUPPORT_COLUMNS + ',code_hash';
const SUPPORT_FILTERS = ['pending', 'verified', 'expired', 'cancelled', 'rejected', 'all'];

// Dependencias reemplazables desde los tests (_internal.setDeps).
const deps = {
    pgrest,
    resolveBearerUser,
    sendEmail: (...args) => emailService.sendEmail(...args),
    getSetting: (...args) => appSettings.getSetting(...args),
    now: () => Date.now()
};

function setDeps(overrides) {
    const previous = { ...deps };
    Object.assign(deps, overrides || {});
    return () => { Object.assign(deps, previous); };
}

// --- Helpers puros ---------------------------------------------------------

function timeOf(value) {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
}

function nowIso() {
    return new Date(deps.now()).toISOString();
}

// Acepta "laura", "@Laura.Tattoo" o la URL del perfil. Devuelve el usuario en
// minúsculas (Instagram no distingue mayúsculas) o null si no es válido.
function normalizeHandle(value) {
    let s = String(value == null ? '' : value).trim();
    const fromUrl = /^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/([^/?#\s]+)/i.exec(s);
    if (fromUrl) s = fromUrl[1];
    s = s.replace(/^@+/, '');
    return HANDLE_RE.test(s) ? s.toLowerCase() : null;
}

function generateCode() {
    let body = '';
    for (let i = 0; i < CODE_LENGTH; i++) body += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    return CODE_PREFIX + body;
}

// 'WO4F7K2Q', 'wo-4f7k2q', 'WO — 4F7K2Q' y '4F7K2Q' quedan como 'WO-4F7K2Q'.
// Devuelve null si no es un código posible del alfabeto.
function normalizeCode(value) {
    const s = String(value == null ? '' : value).normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
    let body = null;
    if (s.length === CODE_LENGTH + 2 && s.startsWith('WO')) body = s.slice(2);
    else if (s.length === CODE_LENGTH) body = s;
    if (!body || ![...body].every((ch) => CODE_ALPHABET.includes(ch))) return null;
    return CODE_PREFIX + body;
}

function hashCode(value) {
    const code = normalizeCode(value);
    return code ? crypto.createHash('sha256').update(code, 'utf8').digest('hex') : null;
}

// Busca códigos en el texto libre de un DM ("hola!! mi código es wo-4f7k2q").
// Primero los que traen guion (WO-XXXXXX), después los escritos con espacio,
// raya o pegados, así una palabra suelta no desplaza al código real.
function extractCodes(text) {
    const src = String(text == null ? '' : text).slice(0, MAX_DM_LENGTH).normalize('NFKC').toUpperCase();
    const body = '([A-HJ-NP-Z2-9]{6})';
    const patterns = [
        new RegExp('WO-' + body, 'g'),
        new RegExp('WO[\\s\\u2010-\\u2015\\u2212:_.-]{0,3}' + body, 'g')
    ];
    const found = [];
    for (const re of patterns) {
        let m;
        while ((m = re.exec(src)) && found.length < MAX_CODE_CANDIDATES) {
            const code = normalizeCode(m[1]);
            if (code && !found.includes(code)) found.push(code);
        }
    }
    return found;
}

function extractCode(text) {
    return extractCodes(text)[0] || null;
}

// 'laura@gmail.com' -> 'la•••a@gmail.com'
function maskEmail(email) {
    const value = String(email == null ? '' : email).trim().toLowerCase();
    const at = value.lastIndexOf('@');
    if (at < 1 || at === value.length - 1) return null;
    const local = value.slice(0, at);
    const head = local.slice(0, local.length > 4 ? 2 : 1);
    const tail = local.length > 2 ? local.slice(-1) : '';
    return `${head}•••${tail}@${value.slice(at + 1)}`;
}

// Comparación en tiempo constante: se comparan los sha256 (mismo largo
// siempre), así tampoco se filtra el largo del secreto.
function safeEqual(provided, expected) {
    if (typeof provided !== 'string' || typeof expected !== 'string' || !provided || !expected) return false;
    const a = crypto.createHash('sha256').update(provided, 'utf8').digest();
    const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
    return crypto.timingSafeEqual(a, b);
}

// Tabla o columna de la migración todavía ausente (PostgREST/Postgres).
function isMissingSchemaError(error) {
    if (!error) return false;
    if (error.status === 404) return true;
    const text = `${error.code || ''} ${error.message || ''}`;
    return /PGRST205|PGRST204|42P01|42703/.test(text)
        || /could not find the .*(table|column)|does not exist/i.test(text);
}

function cleanNote(value) {
    const note = String(value == null ? '' : value).trim().slice(0, MAX_NOTE_LENGTH);
    return note || null;
}

function artistDisplayName(artist) {
    const a = artist || {};
    return String(a.name || '').trim() || String(a.username || '').replace(/\.wo$/i, '') || 'artista';
}

function unavailableBody() {
    return { success: false, code: UNAVAILABLE_CODE, error: UNAVAILABLE_ERROR };
}

function logError(scope, error) {
    const status = error && error.status ? ` (${error.status})` : '';
    // Los mensajes de PostgREST pueden traer valores de la fila: nunca un hash entero.
    const message = String((error && error.message) || error || '').replace(/[a-f0-9]{64}/gi, '[hash]').slice(0, 200);
    console.error(`[ig-verify] ${scope} failed${status}:`, message);
}

function guard(scope, handler) {
    return async function guardedHandler(req, res) {
        try {
            return await handler(req, res);
        } catch (error) {
            const missing = isMissingSchemaError(error);
            if (!missing) logError(scope, error);
            if (res.headersSent) return undefined;
            return missing
                ? res.status(503).json(unavailableBody())
                : res.status(500).json({ success: false, error: GENERIC_ERROR });
        }
    };
}

// --- Estado ------------------------------------------------------------------

// Objeto `instagram` del contrato (GET /api/artist/onboarding y
// GET /api/artist/instagram-verification). Además de las claves del contrato
// agrega `enforced` y `verified` para que WoGalleryVisibility.stateFrom()
// lo lea igual que el RPC público.
function buildState({ artist, verifications, authEmail, available, now } = {}) {
    const a = artist || {};
    const isAvailable = Boolean(available);
    const nowMs = now == null ? deps.now() : now;
    const handle = normalizeHandle(a.instagram);
    const verifiedHandle = isAvailable ? normalizeHandle(a.instagram_verified_handle) : null;
    const verifiedAt = verifiedHandle && a.instagram_verified_at ? a.instagram_verified_at : null;
    const verified = Boolean(verifiedAt);
    const rows = (Array.isArray(verifications) ? verifications : [])
        .slice()
        .sort((x, y) => timeOf(y && y.created_at) - timeOf(x && x.created_at));
    // Un código vale para la cuenta con la que se pidió. Si el artista cambió
    // el usuario en Mi perfil, ese código ya no sirve (el DM llegaría desde
    // otra cuenta): el estado queda 'none' y la tarjeta ofrece un código nuevo
    // para el usuario actual (pedirlo cancela el anterior).
    const forProfile = (r) => !handle || normalizeHandle(r && r.ig_handle) === handle;
    const pending = isAvailable
        ? rows.find((r) => r && r.status === 'pending' && timeOf(r.expires_at) > nowMs && forProfile(r)) || null
        : null;
    const latest = isAvailable ? rows[0] || null : null;

    let status = 'none';
    if (verified && (!handle || handle === verifiedHandle)) status = 'verified';
    else if (pending) status = 'pending';
    else if (latest && forProfile(latest) && (latest.status === 'expired' || latest.status === 'pending')) status = 'expired';

    const feed = Array.isArray(a.gallery_feed_items) ? a.gallery_feed_items : [];
    const galleryState = { enforced: isAvailable, verified, handle: verifiedHandle };
    let expiresAt = null;
    if (status === 'pending') expiresAt = pending.expires_at || null;
    else if (status === 'expired') expiresAt = latest.expires_at || null;

    return {
        available: isAvailable,
        enforced: isAvailable,
        status,
        handle: handle || null,
        verified,
        verified_handle: verifiedHandle,
        verified_at: verifiedAt,
        expires_at: expiresAt,
        email_masked: status === 'pending' ? maskEmail(pending.email_sent_to || authEmail) : null,
        pending_items: visibility.pendingCount(feed, galleryState),
        legacy_items: feed.filter((item) => visibility.isInstagramItem(item) && item.ig_legacy === true).length
    };
}

// Lee el artista con las columnas de validación; si la migración no está
// aplicada vuelve a leerlo sin ellas y marca available:false.
async function loadArtist(userId) {
    try {
        const artist = await deps.pgrest('artists_db').select(ARTIST_VERIFY_COLUMNS)
            .eq('user_id', userId).limit(1).single().execute();
        return { artist, available: true };
    } catch (error) {
        if (!isMissingSchemaError(error)) throw error;
        const artist = await deps.pgrest('artists_db').select(ARTIST_BASE_COLUMNS)
            .eq('user_id', userId).limit(1).single().execute();
        return { artist, available: false };
    }
}

// Vencimiento perezoso: los pendientes vencidos pasan a 'expired' al leer.
async function expireStale(userId) {
    try {
        let query = deps.pgrest(TABLE).eq('status', 'pending').lt('expires_at', nowIso());
        if (userId) query = query.eq('artist_user_id', userId);
        await query.patch({ status: 'expired' }, { returning: false });
    } catch (error) {
        if (isMissingSchemaError(error)) throw error;
        logError('expire', error);
    }
}

async function loadVerifications(userId) {
    await expireStale(userId);
    return deps.pgrest(TABLE).select(STATE_COLUMNS).eq('artist_user_id', userId)
        .order('created_at', { ascending: false }).limit(10).execute();
}

function hasVerificationColumns(row) {
    return Boolean(row) && ['instagram', 'gallery_feed_items', 'instagram_verified_at', 'instagram_verified_handle']
        .every((key) => Object.prototype.hasOwnProperty.call(row, key));
}

// Nunca lanza: ante cualquier falla devuelve el estado con available:false.
async function getStateForArtist({ userId, artist, authUser } = {}) {
    const uid = userId || (artist && artist.user_id) || null;
    const authEmail = (authUser && authUser.email) || null;
    if (!uid) return buildState({ artist, authEmail, available: false });
    try {
        let row = artist;
        if (!hasVerificationColumns(row)) {
            const loaded = await loadArtist(uid);
            row = loaded.artist || artist || {};
            if (!loaded.available) return buildState({ artist: row, authEmail, available: false });
        }
        const verifications = await loadVerifications(uid);
        return buildState({ artist: row, verifications, authEmail, available: true });
    } catch (error) {
        if (!isMissingSchemaError(error)) logError('state', error);
        return buildState({ artist, authEmail, available: false });
    }
}

// --- Validación (webhook y soporte) ----------------------------------------

async function markVerified(row, { via, verifiedBy, senderHandle, note, fromStatuses } = {}) {
    const verifiedAt = nowIso();
    // Siempre en minúsculas y sin @, igual que lo compara gallery-visibility.js.
    const handle = normalizeHandle(row.ig_handle);
    const update = {
        status: 'verified',
        verified_at: verifiedAt,
        verified_via: via,
        verified_by: verifiedBy || null,
        dm_sender_handle: senderHandle || row.dm_sender_handle || null
    };
    if (note) update.note = note;
    // Se "reclama" la fila solo si sigue en un estado confirmable (evita
    // procesar dos veces el mismo DM).
    const claimed = await deps.pgrest(TABLE).eq('id', row.id).in('status', fromStatuses || ['pending']).patch(update);
    if (!Array.isArray(claimed) || !claimed.length) return { ok: false, reason: 'not_pending' };

    try {
        // Solo las dos columnas de la validación: el trigger
        // trigger_sync_artist_gallery_feed_items se dispara con ellas y
        // recalcula gallery_images. Reescribir gallery_feed_items desde una
        // lectura previa revertiría una edición de la galería hecha en el medio.
        await deps.pgrest('artists_db').eq('user_id', row.artist_user_id)
            .patch({ instagram_verified_at: verifiedAt, instagram_verified_handle: handle }, { returning: false });
    } catch (error) {
        try {
            await deps.pgrest(TABLE).eq('id', row.id).eq('status', 'verified').patch({
                status: row.status === 'expired' ? 'expired' : 'pending',
                verified_at: null, verified_via: null, verified_by: null
            }, { returning: false });
        } catch (revertError) {
            logError('revert', revertError);
        }
        throw error;
    }

    try {
        await deps.pgrest(TABLE).eq('artist_user_id', row.artist_user_id).eq('status', 'pending').neq('id', row.id)
            .patch({ status: 'cancelled', note: 'La cuenta ya quedó validada.' }, { returning: false });
    } catch (error) {
        logError('cancel others', error);
    }
    return { ok: true, verified_at: verifiedAt, handle };
}

async function registerMismatch(row, senderHandle) {
    const attempts = (Number(row.attempts) || 0) + 1;
    const patch = { attempts, dm_sender_handle: senderHandle };
    if (attempts >= MAX_MISMATCH_ATTEMPTS) {
        patch.status = 'cancelled';
        patch.note = 'Se canceló por varios intentos desde otra cuenta de Instagram.';
    }
    try {
        await deps.pgrest(TABLE).eq('id', row.id).eq('status', 'pending').patch(patch, { returning: false });
    } catch (error) {
        logError('mismatch', error);
    }
}

// --- Auth ------------------------------------------------------------------

async function requireArtist(req, res) {
    const user = await deps.resolveBearerUser(req);
    if (!user || !user.id) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return null;
    }
    const loaded = await loadArtist(user.id);
    if (!loaded.artist) {
        res.status(403).json({ success: false, error: 'Artist profile required' });
        return null;
    }
    return { user, artist: loaded.artist, available: loaded.available };
}

// Equivalente a server.js _getActiveSupportAgent.
async function resolveSupportAgent(req) {
    let user;
    try {
        user = await deps.resolveBearerUser(req);
    } catch (error) {
        logError('support auth', error);
        return { ok: false, status: 500, error: 'Could not verify support agent' };
    }
    if (!user || !user.id) return { ok: false, status: 401, error: 'Authentication required' };
    try {
        const supportUser = await deps.pgrest('support_users_db').select('user_id,email,full_name,role,is_active')
            .eq('user_id', user.id).eq('is_active', true).limit(1).single().execute();
        if (!supportUser) return { ok: false, status: 403, error: 'Support agent access required' };
        return { ok: true, authUser: user.raw || user, supportUser, supportUserId: supportUser.user_id || user.id };
    } catch (error) {
        logError('support auth', error);
        return { ok: false, status: 500, error: 'Could not verify support agent' };
    }
}

// Secreto propio del webhook; si falta, el compartido con n8n.
async function resolveWebhookSecret() {
    const own = String(process.env.IG_VERIFY_WEBHOOK_SECRET || '').trim();
    if (own) return own;
    try {
        const shared = await deps.getSetting('n8n_webhook_secret', { envFallback: 'N8N_WEBHOOK_SECRET' });
        return String(shared || '').trim() || null;
    } catch (error) {
        logError('webhook secret', error);
        return String(process.env.N8N_WEBHOOK_SECRET || '').trim() || null;
    }
}

// --- Handlers del artista ---------------------------------------------------

async function getArtistVerificationHandler(req, res) {
    const ctx = await requireArtist(req, res);
    if (!ctx) return undefined;
    if (!ctx.available) return res.status(503).json(unavailableBody());
    const state = await getStateForArtist({ userId: ctx.user.id, artist: ctx.artist, authUser: ctx.user });
    if (!state.available) return res.status(503).json(unavailableBody());
    return res.json({ success: true, ...state, instructions: { ...INSTRUCTIONS } });
}

async function requestArtistVerificationHandler(req, res) {
    const ctx = await requireArtist(req, res);
    if (!ctx) return undefined;
    if (!ctx.available) return res.status(503).json(unavailableBody());

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const fromBody = body.handle != null && String(body.handle).trim() !== '';
    const handle = normalizeHandle(fromBody ? body.handle : ctx.artist.instagram);
    if (!handle) {
        return res.status(400).json({
            success: false,
            code: fromBody ? 'IG_HANDLE_INVALID' : 'IG_HANDLE_REQUIRED',
            error: fromBody ? INVALID_HANDLE_ERROR : MISSING_HANDLE_ERROR
        });
    }
    if (ctx.artist.instagram_verified_at && normalizeHandle(ctx.artist.instagram_verified_handle) === handle) {
        return res.status(409).json({ success: false, code: 'IG_ALREADY_VERIFIED', error: `Tu cuenta @${handle} ya está validada.` });
    }
    const email = ctx.user.email || ctx.artist.email || null;
    if (!email) {
        return res.status(400).json({ success: false, code: 'IG_EMAIL_REQUIRED', error: 'No encontramos un email en tu cuenta para mandarte el código.' });
    }

    const userId = ctx.user.id;
    const expiresAt = new Date(deps.now() + CODE_TTL_MS).toISOString();
    let code = null;
    let row = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        code = generateCode();
        try {
            const inserted = await deps.pgrest(TABLE).insert({
                artist_user_id: userId,
                ig_handle: handle,
                code_hash: hashCode(code),
                status: 'pending',
                email_sent_to: email,
                email_sent: false,
                attempts: 0,
                expires_at: expiresAt
            });
            row = Array.isArray(inserted) ? inserted[0] || null : null;
            break;
        } catch (error) {
            // 409: el hash chocó con otro pendiente (índice único): otro código.
            if (error.status === 409 && attempt < 2) continue;
            throw error;
        }
    }
    if (!row || !row.id) throw new Error('insert returned no row');

    // El código nuevo reemplaza a los pendientes ANTERIORES del artista. Solo
    // los más viejos: si dos pedidos se cruzan (dos pestañas o dispositivos),
    // cada uno cancelaría la fila del otro y ningún código enviado serviría.
    // Así el más nuevo siempre queda vigente.
    try {
        let previous = deps.pgrest(TABLE).eq('artist_user_id', userId).eq('status', 'pending');
        previous = row.created_at ? previous.lt('created_at', row.created_at) : previous.neq('id', row.id);
        await previous.patch({ status: 'cancelled', note: 'Reemplazado por un código nuevo.' }, { returning: false });
    } catch (error) {
        logError('cancel previous', error);
    }

    let emailSent = false;
    try {
        const result = await deps.sendEmail(EMAIL_EVENT, {
            artist_email: email,
            artist_name: artistDisplayName(ctx.artist),
            verification_code: code,
            instagram_handle: '@' + handle,
            expires_label: `${CODE_TTL_HOURS} horas`,
            weotzi_instagram: '@weotzi',
            dm_url: DM_URL
        }, { idempotencyKey: `ig-verify:${userId}:${row.id}` });
        emailSent = Boolean(result && result.ok);
    } catch (error) {
        logError('email', error);
    }
    code = null;

    if (emailSent) {
        try {
            await deps.pgrest(TABLE).eq('id', row.id).patch({ email_sent: true }, { returning: false });
        } catch (error) {
            logError('email flag', error);
        }
    }

    return res.json({
        success: true,
        status: 'pending',
        handle,
        expires_at: row.expires_at || expiresAt,
        email_masked: maskEmail(email),
        email_sent: emailSent
    });
}

// --- Webhook de DMs ------------------------------------------------------------

async function handleInboundHandler(req, res) {
    const secret = await resolveWebhookSecret();
    if (!secret) return res.status(503).json({ success: false, error: 'Instagram verification webhook secret not configured' });
    const provided = req.headers && req.headers['x-weotzi-webhook-token'];
    if (!safeEqual(typeof provided === 'string' ? provided : '', secret)) {
        return res.status(401).json({ success: false, error: 'Invalid webhook token' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const sender = normalizeHandle(body.sender_username);
    if (!sender) return res.status(400).json({ success: false, verified: false, reason: 'missing_sender' });
    const codes = extractCodes(body.message_text);
    if (!codes.length) return res.json({ success: true, verified: false, reason: 'no_code' });

    await expireStale(null);
    const rows = await deps.pgrest(TABLE).select('id,artist_user_id,ig_handle,status,attempts,expires_at,created_at,dm_sender_handle')
        .in('code_hash', codes.map(hashCode)).order('created_at', { ascending: false }).limit(MAX_CODE_CANDIDATES).execute();
    if (!rows.length) return res.json({ success: true, verified: false, reason: 'code_not_found' });

    const nowMs = deps.now();
    const live = rows.filter((r) => r.status === 'pending' && timeOf(r.expires_at) > nowMs);
    if (!live.length) {
        const expired = rows.some((r) => r.status === 'expired' || r.status === 'pending');
        return res.json({ success: true, verified: false, reason: expired ? 'code_expired' : 'code_not_pending' });
    }
    const row = live.find((r) => normalizeHandle(r.ig_handle) === sender);
    if (!row) {
        await registerMismatch(live[0], sender);
        return res.json({ success: true, verified: false, reason: 'handle_mismatch' });
    }
    if (body.follows_business === false) return res.json({ success: true, verified: false, reason: 'not_following' });

    const result = await markVerified(row, { via: 'dm_webhook', senderHandle: sender });
    // Otra entrega del mismo DM ganó el reclamo de la fila: para la
    // automatización es lo mismo que un reenvío posterior.
    if (!result.ok) return res.json({ success: true, verified: false, reason: 'code_not_pending' });
    return res.json({ success: true, verified: true, reason: 'verified' });
}

// --- Cola de soporte -----------------------------------------------------------

async function listForSupportHandler(req, res) {
    const agent = await resolveSupportAgent(req);
    if (!agent.ok) return res.status(agent.status).json({ success: false, error: agent.error });
    const status = String((req.query && req.query.status) || 'pending').trim().toLowerCase();
    if (!SUPPORT_FILTERS.includes(status)) return res.status(400).json({ success: false, error: 'Estado no válido.' });

    await expireStale(null);
    let query = deps.pgrest(TABLE).select(SUPPORT_COLUMNS).order('created_at', { ascending: false }).limit(SUPPORT_LIST_LIMIT);
    if (status !== 'all') query = query.eq('status', status);
    const rows = await query.execute();

    const ids = [...new Set(rows.map((r) => r.artist_user_id).filter(Boolean))];
    const artists = ids.length
        ? await deps.pgrest('artists_db')
            .select('user_id,name,username,gallery_feed_items,instagram_verified_at,instagram_verified_handle')
            .in('user_id', ids).execute()
        : [];
    const byUser = new Map(artists.map((a) => [a.user_id, a]));

    const items = rows.map((r) => {
        const a = byUser.get(r.artist_user_id) || {};
        const verifiedHandle = normalizeHandle(a.instagram_verified_handle);
        const galleryState = { enforced: true, verified: Boolean(verifiedHandle && a.instagram_verified_at), handle: verifiedHandle };
        return {
            id: r.id,
            artist_user_id: r.artist_user_id,
            artist_name: a.name || null,
            username: a.username || null,
            ig_handle: r.ig_handle,
            status: r.status,
            created_at: r.created_at || null,
            expires_at: r.expires_at || null,
            verified_at: r.verified_at || null,
            verified_via: r.verified_via || null,
            email_masked: maskEmail(r.email_sent_to),
            pending_items: visibility.pendingCount(a.gallery_feed_items, galleryState),
            email_sent: r.email_sent === true,
            attempts: Number(r.attempts) || 0,
            dm_sender_handle: r.dm_sender_handle || null,
            note: r.note || null
        };
    });
    return res.json({ success: true, items });
}

async function confirmForSupportHandler(req, res) {
    const agent = await resolveSupportAgent(req);
    if (!agent.ok) return res.status(agent.status).json({ success: false, error: agent.error });
    const id = String((req.params && req.params.id) || '');
    if (!UUID_RE.test(id)) return res.status(400).json({ success: false, error: 'Validación no válida.' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const force = body.force === true;
    const hasCode = body.code != null && String(body.code).trim() !== '';
    if (!hasCode && !force) {
        return res.status(400).json({ success: false, code: 'IG_CODE_REQUIRED', error: 'Indicá el código que mandó el artista o confirmá sin código.' });
    }
    const codeHash = hasCode ? hashCode(body.code) : null;
    if (hasCode && !codeHash) {
        return res.status(400).json({ success: false, code: 'IG_CODE_INVALID', error: 'El código tiene que tener el formato WO-XXXXXX.' });
    }

    const row = await deps.pgrest(TABLE).select(CONFIRM_COLUMNS).eq('id', id).limit(1).single().execute();
    if (!row) return res.status(404).json({ success: false, error: 'No encontramos esa validación.' });
    if (row.status === 'verified') return res.status(409).json({ success: false, error: 'Esta validación ya está confirmada.' });
    if (row.status !== 'pending' && row.status !== 'expired') {
        return res.status(409).json({ success: false, error: 'Esta validación ya no está pendiente.' });
    }
    if (codeHash && !safeEqual(codeHash, String(row.code_hash || ''))) {
        return res.status(400).json({ success: false, code: 'IG_CODE_MISMATCH', error: 'El código no coincide con el que le mandamos al artista.' });
    }
    const expired = row.status === 'expired' || timeOf(row.expires_at) <= deps.now();
    if (expired && !force) {
        return res.status(409).json({ success: false, code: 'IG_CODE_EXPIRED', error: 'El código venció. Confirmá sin código o pedile al artista que genere uno nuevo.' });
    }

    const result = await markVerified(row, {
        via: 'support',
        verifiedBy: agent.supportUserId,
        note: cleanNote(body.note),
        fromStatuses: ['pending', 'expired']
    });
    if (!result.ok) return res.status(409).json({ success: false, error: 'Esta validación ya no está pendiente.' });
    return res.json({ success: true, id, status: 'verified', ig_handle: result.handle, verified_at: result.verified_at });
}

async function rejectForSupportHandler(req, res) {
    const agent = await resolveSupportAgent(req);
    if (!agent.ok) return res.status(agent.status).json({ success: false, error: agent.error });
    const id = String((req.params && req.params.id) || '');
    if (!UUID_RE.test(id)) return res.status(400).json({ success: false, error: 'Validación no válida.' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const updated = await deps.pgrest(TABLE).eq('id', id).in('status', ['pending', 'expired'])
        .patch({ status: 'rejected', note: cleanNote(body.note), verified_by: agent.supportUserId });
    if (!Array.isArray(updated) || !updated.length) {
        const existing = await deps.pgrest(TABLE).select('id,status').eq('id', id).limit(1).single().execute();
        if (!existing) return res.status(404).json({ success: false, error: 'No encontramos esa validación.' });
        return res.status(409).json({ success: false, error: 'Esta validación ya no está pendiente.' });
    }
    return res.json({ success: true, id, status: 'rejected' });
}

const getArtistVerification = guard('state endpoint', getArtistVerificationHandler);
const requestArtistVerification = guard('request', requestArtistVerificationHandler);
const handleInbound = guard('inbound', handleInboundHandler);
const listForSupport = guard('support list', listForSupportHandler);
const confirmForSupport = guard('support confirm', confirmForSupportHandler);
const rejectForSupport = guard('support reject', rejectForSupportHandler);

module.exports = {
    getArtistVerification,
    requestArtistVerification,
    handleInbound,
    listForSupport,
    confirmForSupport,
    rejectForSupport,
    getStateForArtist,
    resolveSupportAgent,
    isMissingSchemaError,
    normalizeHandle,
    maskEmail,
    CODE_ALPHABET,
    CODE_TTL_HOURS,
    INSTRUCTIONS,
    UNAVAILABLE_CODE,
    _internal: {
        generateCode,
        normalizeCode,
        hashCode,
        extractCode,
        extractCodes,
        maskEmail,
        normalizeHandle,
        safeEqual,
        isMissingSchemaError,
        buildState,
        resolveWebhookSecret,
        setDeps,
        TABLE
    }
};
