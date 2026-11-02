'use strict';

// ===========================================================================
// Verificación de estudios (servidor).
// ---------------------------------------------------------------------------
// Migración: supabase/migrations/20261102120000_studio_verification.sql.
//
// 1. Estado para el dueño (GET /api/studio/verification): columnas de
//    verificación del estudio, la última solicitud a soporte
//    (studio_verification_requests, la crea el dueño por la RPC
//    request_studio_verification desde el frontend) y el estado del código de
//    Instagram.
// 2. Validación del Instagram del estudio (POST /api/studio/verification/instagram):
//    el mismo flujo que el del artista (services/instagram-verification.js):
//    código WO-XXXXXX que vence en 72 h, se guarda solo su sha256 en
//    studio_instagram_verifications (solo service-role) y se manda al email
//    de auth.users del dueño. El dueño lo manda por DM a @weotzi y el webhook
//    de DMs, si no encuentra el código entre los de artistas, llama a
//    handleInboundCodes (instagram-verification.setStudioInboundHandler).
// 3. Backoffice: parseDecisionInput (validación del body de
//    /api/admin/studio-verifications/:id/decide) y confirmInstagramBySupport
//    (soporte confirma el Instagram al aprobar la verificación).
//
// Las columnas de verificación de `studios` solo las cambia service-role o
// soporte (guard_studio_protected_columns): acá todo corre con service-role a
// través de StudiosRepo (lib/repos/studios.js), salvo la RPC de decisión que
// viaja con el JWT del caller (server.js).
// El código nunca se devuelve en una respuesta ni se escribe en los logs.
// ===========================================================================

const { resolveBearerUser } = require('../lib/auth/supabase-auth');
const { StudiosRepo, isMissingSchemaError: isMissingSchemaCode } = require('../lib/repos/studios');
const emailService = require('./email-service');
const igVerification = require('./instagram-verification');

const {
    generateCode,
    hashCode,
    normalizeCode,
    extractCodes,
    normalizeHandle,
    maskEmail,
    isMissingSchemaError: isMissingSchemaIg
} = igVerification._internal;

const EMAIL_EVENT = 'instagram_verification_code';
const CODE_TTL_HOURS = igVerification.CODE_TTL_HOURS || 72;
const CODE_TTL_MS = CODE_TTL_HOURS * 60 * 60 * 1000;
const MAX_MISMATCH_ATTEMPTS = 5;
const MAX_CODE_CANDIDATES = 10;
const NOTE_MAX = 1000;
const REASON_MIN = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECISIONS = ['approve', 'reject'];
const ADMIN_STATUS_FILTERS = ['pending', 'approved', 'rejected', 'cancelled', 'all'];

const INSTRUCTIONS = Object.freeze({
    account: 'weotzi',
    dm_url: 'https://ig.me/m/weotzi',
    follow_url: 'https://www.instagram.com/weotzi/'
});

const UNAVAILABLE_CODE = 'STUDIO_VERIFICATION_UNAVAILABLE';
const UNAVAILABLE_ERROR = 'La verificación de estudios se habilita pronto.';
const GENERIC_ERROR = 'No pudimos completar la verificación del estudio. Probá de nuevo en un rato.';
const MISSING_HANDLE_ERROR = 'Cargá el Instagram del estudio en el perfil antes de validarlo.';
const INVALID_HANDLE_ERROR = 'Ese usuario de Instagram no es válido. Usá solo letras, números, puntos y guiones bajos.';
const NO_SESSION_ERROR = 'Iniciá sesión para ver la verificación de tu estudio.';
const NO_STUDIO_ERROR = 'No encontramos un estudio asociado a tu cuenta.';

// Dependencias reemplazables desde los tests (_internal.setDeps).
const deps = {
    repo: StudiosRepo,
    resolveBearerUser,
    sendEmail: (...args) => emailService.sendEmail(...args),
    now: () => Date.now()
};

function setDeps(overrides) {
    const previous = { ...deps };
    Object.assign(deps, overrides || {});
    return () => { Object.assign(deps, previous); };
}

// --- Helpers -----------------------------------------------------------------

function timeOf(value) {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
}

function nowIso() {
    return new Date(deps.now()).toISOString();
}

function isMissingSchemaError(error) {
    return isMissingSchemaIg(error) || isMissingSchemaCode(error);
}

function unavailableBody() {
    return { success: false, code: UNAVAILABLE_CODE, error: UNAVAILABLE_ERROR };
}

function logError(scope, error) {
    const status = error && error.status ? ` (${error.status})` : '';
    // Los mensajes de PostgREST pueden traer valores de la fila: nunca un hash entero.
    const message = String((error && error.message) || error || '').replace(/[a-f0-9]{64}/gi, '[hash]').slice(0, 200);
    console.error(`[studio-verify] ${scope} failed${status}:`, message);
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

function studioDisplayName(studio) {
    return String((studio && studio.name) || '').trim() || 'tu estudio';
}

function arrayOrEmpty(value) {
    return Array.isArray(value) ? value : [];
}

// --- Estado ------------------------------------------------------------------

// Objeto `instagram` del estado: 'verified' si el Instagram validado es el
// del perfil (o el perfil no tiene uno), 'pending' si hay un código vigente
// pedido para el Instagram actual, 'none' en cualquier otro caso.
function buildInstagramState({ studio, codes, now } = {}) {
    const s = studio || {};
    const nowMs = now == null ? deps.now() : now;
    const handle = normalizeHandle(s.instagram);
    const verifiedHandle = normalizeHandle(s.instagram_verified_handle);
    const verified = Boolean(verifiedHandle && s.instagram_verified_at) && (!handle || handle === verifiedHandle);
    const rows = arrayOrEmpty(codes)
        .slice()
        .sort((x, y) => timeOf(y && y.created_at) - timeOf(x && x.created_at));
    const pending = verified ? null : rows.find((r) => r && r.status === 'pending'
        && timeOf(r.expires_at) > nowMs
        && (!handle || normalizeHandle(r.ig_handle) === handle)) || null;

    let status = 'none';
    if (verified) status = 'verified';
    else if (pending) status = 'pending';

    return {
        status,
        handle: handle || verifiedHandle || null,
        expires_at: pending ? pending.expires_at || null : null,
        email_masked: pending ? maskEmail(pending.email_sent_to) : null,
        email_sent: pending ? pending.email_sent === true : false
    };
}

function studioState(studio) {
    const s = studio || {};
    return {
        id: s.id || null,
        name: s.name || null,
        instagram: s.instagram || null,
        is_verified: s.is_verified === true,
        verification_status: s.verification_status || 'unverified',
        verification_required: s.verification_required === true,
        verification_reason: s.verification_reason || null,
        verified_at: s.verified_at || null,
        instagram_verified_at: s.instagram_verified_at || null,
        instagram_verified_handle: s.instagram_verified_handle || null
    };
}

function requestState(row) {
    if (!row) return null;
    return {
        id: row.id,
        status: row.status,
        reasons: arrayOrEmpty(row.reasons),
        evidence: row.evidence || null,
        contact_name: row.contact_name || null,
        contact_phone: row.contact_phone || null,
        links: arrayOrEmpty(row.links),
        created_at: row.created_at || null,
        decided_at: row.decided_at || null,
        decision_note: row.decision_note || null
    };
}

async function expireStale(studioId) {
    try {
        await deps.repo.expireStaleStudioInstagramCodes(studioId || null, nowIso());
    } catch (error) {
        if (isMissingSchemaError(error)) throw error;
        logError('expire', error);
    }
}

async function loadCodes(studioId) {
    await expireStale(studioId);
    return deps.repo.listStudioInstagramCodes(studioId, { limit: 10 });
}

// --- Auth ----------------------------------------------------------------------

async function requireOwner(req, res) {
    const user = await deps.resolveBearerUser(req);
    if (!user || !user.id) {
        res.status(401).json({ success: false, error: NO_SESSION_ERROR });
        return null;
    }
    const studio = await deps.repo.getOwnedStudioForVerification(user.id);
    if (!studio) {
        res.status(404).json({ success: false, code: 'STUDIO_NOT_FOUND', error: NO_STUDIO_ERROR });
        return null;
    }
    return { user, studio };
}

// --- Handlers del dueño ------------------------------------------------------------

async function getStudioVerificationHandler(req, res) {
    const ctx = await requireOwner(req, res);
    if (!ctx) return undefined;
    const [request, codes] = await Promise.all([
        deps.repo.getLatestVerificationRequest(ctx.studio.id),
        loadCodes(ctx.studio.id)
    ]);
    return res.json({
        success: true,
        available: true,
        studio: studioState(ctx.studio),
        request: requestState(request),
        instagram: buildInstagramState({ studio: ctx.studio, codes }),
        instructions: { ...INSTRUCTIONS }
    });
}

async function requestInstagramCodeHandler(req, res) {
    const ctx = await requireOwner(req, res);
    if (!ctx) return undefined;
    const { user, studio } = ctx;

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const fromBody = body.handle != null && String(body.handle).trim() !== '';
    const handle = normalizeHandle(fromBody ? body.handle : studio.instagram);
    if (!handle) {
        return res.status(400).json({
            success: false,
            code: fromBody ? 'IG_HANDLE_INVALID' : 'IG_HANDLE_REQUIRED',
            error: fromBody ? INVALID_HANDLE_ERROR : MISSING_HANDLE_ERROR
        });
    }
    if (studio.instagram_verified_at && normalizeHandle(studio.instagram_verified_handle) === handle) {
        return res.status(409).json({ success: false, code: 'IG_ALREADY_VERIFIED', error: `El Instagram @${handle} del estudio ya está validado.` });
    }
    // Siempre el email de la cuenta (auth.users), nunca studios.email.
    const email = user.email ? String(user.email).trim().toLowerCase() : null;
    if (!email) {
        return res.status(400).json({ success: false, code: 'IG_EMAIL_REQUIRED', error: 'No encontramos un email en tu cuenta para mandarte el código.' });
    }

    const expiresAt = new Date(deps.now() + CODE_TTL_MS).toISOString();
    let code = null;
    let row = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        code = generateCode();
        try {
            row = await deps.repo.insertStudioInstagramCode({
                studio_id: studio.id,
                requested_by: user.id,
                ig_handle: handle,
                code_hash: hashCode(code),
                status: 'pending',
                email_sent_to: email,
                email_sent: false,
                attempts: 0,
                expires_at: expiresAt
            });
            break;
        } catch (error) {
            // 409: el hash chocó con otro pendiente (índice único): otro código.
            if (error && error.status === 409 && attempt < 2) continue;
            code = null;
            throw error;
        }
    }
    if (!row || !row.id) {
        code = null;
        throw new Error('insert returned no row');
    }

    // El código nuevo reemplaza solo a los pendientes ANTERIORES del estudio
    // (si dos pedidos se cruzan, el más nuevo queda vigente).
    try {
        await deps.repo.cancelOlderStudioInstagramCodes(studio.id, row, 'Reemplazado por un código nuevo.');
    } catch (error) {
        logError('cancel previous', error);
    }

    let emailSent = false;
    try {
        const result = await deps.sendEmail(EMAIL_EVENT, {
            artist_email: email,
            artist_name: studioDisplayName(studio),
            verification_code: code,
            instagram_handle: '@' + handle,
            expires_label: `${CODE_TTL_HOURS} horas`,
            weotzi_instagram: '@weotzi',
            dm_url: INSTRUCTIONS.dm_url
        }, { idempotencyKey: `studio-ig-verify:${studio.id}:${row.id}` });
        emailSent = Boolean(result && result.ok);
    } catch (error) {
        logError('email', error);
    }
    code = null;

    if (emailSent) {
        try {
            await deps.repo.markStudioInstagramEmailSent(row.id);
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

// --- Webhook de DMs (fallback de estudios) -----------------------------------

async function markVerified(row, { via, senderHandle, verifiedBy, note } = {}) {
    const verifiedAt = nowIso();
    const handle = normalizeHandle(row.ig_handle);
    const update = {
        status: 'verified',
        verified_at: verifiedAt,
        verified_via: via,
        verified_by: verifiedBy || null,
        dm_sender_handle: senderHandle || row.dm_sender_handle || null
    };
    if (note) update.note = note;
    const claimed = await deps.repo.claimStudioInstagramCode(row.id, update, ['pending']);
    if (!Array.isArray(claimed) || !claimed.length) return { ok: false, reason: 'not_pending' };

    try {
        await deps.repo.setStudioInstagramVerified(row.studio_id, handle, verifiedAt);
    } catch (error) {
        try {
            await deps.repo.revertStudioInstagramCode(row.id, 'pending');
        } catch (revertError) {
            logError('revert', revertError);
        }
        throw error;
    }

    try {
        await deps.repo.cancelOtherStudioInstagramCodes(row.studio_id, row.id, 'La cuenta ya quedó validada.');
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
        await deps.repo.registerStudioInstagramMismatch(row.id, patch);
    } catch (error) {
        logError('mismatch', error);
    }
}

// Lo llama el webhook de instagram-verification.js cuando ningún código de
// artista coincide. `codes`: candidatos ya normalizados (extractCodes).
// Devuelve { verified, reason } con los mismos motivos que el webhook.
async function handleInboundCodes({ sender, codes, followsBusiness } = {}) {
    const handle = normalizeHandle(sender);
    if (!handle) return { verified: false, reason: 'missing_sender' };
    const hashes = [...new Set(arrayOrEmpty(codes).map((c) => hashCode(c)).filter(Boolean))].slice(0, MAX_CODE_CANDIDATES);
    if (!hashes.length) return { verified: false, reason: 'no_code' };

    let rows;
    try {
        await expireStale(null);
        rows = await deps.repo.findStudioInstagramCodesByHash(hashes, { limit: MAX_CODE_CANDIDATES });
    } catch (error) {
        // Sin la migración no hay códigos de estudios: para el webhook es lo mismo.
        if (isMissingSchemaError(error)) return { verified: false, reason: 'code_not_found' };
        throw error;
    }
    rows = arrayOrEmpty(rows);
    if (!rows.length) return { verified: false, reason: 'code_not_found' };

    const nowMs = deps.now();
    const live = rows.filter((r) => r.status === 'pending' && timeOf(r.expires_at) > nowMs);
    if (!live.length) {
        const expired = rows.some((r) => r.status === 'expired' || r.status === 'pending');
        return { verified: false, reason: expired ? 'code_expired' : 'code_not_pending' };
    }
    const row = live.find((r) => normalizeHandle(r.ig_handle) === handle);
    if (!row) {
        await registerMismatch(live[0], handle);
        return { verified: false, reason: 'handle_mismatch' };
    }
    if (followsBusiness === false) return { verified: false, reason: 'not_following' };

    const result = await markVerified(row, { via: 'dm_webhook', senderHandle: handle });
    if (!result.ok) return { verified: false, reason: 'code_not_pending' };
    return { verified: true, reason: 'verified' };
}

// --- Backoffice ------------------------------------------------------------------

// Valida params/body de POST /api/admin/studio-verifications/:id/decide.
// { ok:true, id, decision, note, confirmInstagram } | { ok:false, status, error }
function parseDecisionInput(params, body) {
    const id = String((params && params.id) || '').trim();
    if (!UUID_RE.test(id)) return { ok: false, status: 400, error: 'ID de solicitud inválido (se espera UUID).' };
    const b = body && typeof body === 'object' ? body : {};
    if (!DECISIONS.includes(b.decision)) {
        return { ok: false, status: 400, error: 'decision invalida (esperado: approve | reject)' };
    }
    if (b.confirm_instagram != null && typeof b.confirm_instagram !== 'boolean') {
        return { ok: false, status: 400, error: 'confirm_instagram debe ser true o false.' };
    }
    const note = b.note == null ? null : (String(b.note).trim() || null);
    if (note && note.length > NOTE_MAX) {
        return { ok: false, status: 400, error: `La nota admite hasta ${NOTE_MAX} caracteres.` };
    }
    if (b.decision === 'reject' && (!note || note.length < REASON_MIN)) {
        return { ok: false, status: 400, error: 'Contale al estudio por qué no aprobamos la verificación (al menos 3 caracteres).' };
    }
    return {
        ok: true,
        id,
        decision: b.decision,
        note,
        confirmInstagram: b.decision === 'approve' && b.confirm_instagram === true
    };
}

function parseAdminStatus(value) {
    const status = String(value == null || value === '' ? 'pending' : value).trim().toLowerCase();
    return ADMIN_STATUS_FILTERS.includes(status) ? status : null;
}

// Soporte confirma el Instagram del estudio (al aprobar la verificación):
// marca las columnas de Instagram y pasa a verified (verified_via 'support')
// los códigos pendientes de ese usuario; los de otro usuario se cancelan.
async function confirmInstagramBySupport({ studioId, verifiedBy, note } = {}) {
    if (!UUID_RE.test(String(studioId || ''))) return { confirmed: false, reason: 'invalid_studio' };
    const studio = await deps.repo.getStudioById(studioId, {
        select: 'id,instagram,instagram_verified_at,instagram_verified_handle'
    });
    if (!studio) return { confirmed: false, reason: 'studio_not_found' };
    const handle = normalizeHandle(studio.instagram);
    if (!handle) return { confirmed: false, reason: 'no_handle' };
    if (studio.instagram_verified_at && normalizeHandle(studio.instagram_verified_handle) === handle) {
        return { confirmed: true, already: true, handle, verified_at: studio.instagram_verified_at };
    }
    const verifiedAt = nowIso();
    await deps.repo.setStudioInstagramVerified(studio.id, handle, verifiedAt);
    let codesVerified = 0;
    try {
        const rows = await deps.repo.verifyPendingStudioInstagramCodesBySupport(studio.id, handle, {
            verifiedAt, verifiedBy, note: note || 'Confirmado por soporte al verificar el estudio.'
        });
        codesVerified = Array.isArray(rows) ? rows.length : 0;
        await deps.repo.cancelOtherStudioInstagramCodes(studio.id, null, 'La cuenta ya quedó validada.');
    } catch (error) {
        if (!isMissingSchemaError(error)) logError('support codes', error);
    }
    return { confirmed: true, already: false, handle, verified_at: verifiedAt, codes_verified: codesVerified };
}

const getStudioVerification = guard('state endpoint', getStudioVerificationHandler);
const requestInstagramCode = guard('request', requestInstagramCodeHandler);

module.exports = {
    getStudioVerification,
    requestInstagramCode,
    handleInboundCodes,
    parseDecisionInput,
    parseAdminStatus,
    confirmInstagramBySupport,
    isMissingSchemaError,
    INSTRUCTIONS,
    UNAVAILABLE_CODE,
    CODE_TTL_HOURS,
    _internal: {
        buildInstagramState,
        studioState,
        requestState,
        normalizeCode,
        extractCodes,
        setDeps,
        EMAIL_EVENT
    }
};
