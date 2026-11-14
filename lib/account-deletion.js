'use strict';

// ===========================================================================
// Bajas de cuenta gestionadas por soporte (ronda 3c · grupo "borrado").
// ---------------------------------------------------------------------------
// Lógica pura + orquestación con dependencias inyectadas (testeable sin red).
//   - Estados, transiciones y textos de las solicitudes
//     (tabla account_deletion_requests, migración 20261113103000).
//   - Avisos por email al usuario: recibida, aprobada, rechazada, completada
//     (eventos account_deletion_* en services/email-event-mapping.js). Son
//     transaccionales: NO pasan por lib/notification-prefs.js (como el reset
//     de contraseña), y salen una sola vez por (solicitud, estado).
//   - executeAccountDeletion(): el borrado real, SOLO desde el servidor con
//     service-role, reutilizando lo que ya existe:
//       · estudios: mismo camino que POST /api/admin/delete-studio (borra la
//         fila de studios; sedes, membresías, spots… caen por CASCADE);
//       · artista: lib/artist-relations.js (libera las FK sin ON DELETE) y
//         borra artists_db → el trigger delete_auth_on_artist_delete
//         anonimiza el soporte y borra auth.users;
//       · cliente: borra clients_db; client_profiles cae con auth.users;
//       · siempre: anonimiza support_conversations (como el trigger del
//         artista) y borra el usuario de Auth (404 = ya no existe, ok).
// ===========================================================================

const ROLES = Object.freeze(['client', 'artist', 'studio']);
const STATUSES = Object.freeze(['pending', 'in_review', 'blocked', 'approved', 'completed', 'cancelled', 'rejected']);
const OPEN_STATUSES = Object.freeze(['pending', 'in_review', 'blocked', 'approved']);
const CONFIRM_WORD = 'ELIMINAR';
const MIGRATION = '20261113103000';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPERADMIN_EMAIL = (process.env.SUPERADMIN_EMAIL || 'isai@weotzi.com').trim().toLowerCase();

const STATUS_TEXT = Object.freeze({
    pending: 'Recibida',
    in_review: 'En revisión',
    blocked: 'Bloqueada',
    approved: 'Aprobada',
    completed: 'Completada',
    cancelled: 'Cancelada',
    rejected: 'Rechazada'
});

const EMAIL_EVENTS = Object.freeze({
    pending: 'account_deletion_received',
    approved: 'account_deletion_approved',
    rejected: 'account_deletion_rejected',
    completed: 'account_deletion_completed'
});

const ACCOUNT_PATHS = Object.freeze({
    artist: '/artist/account#seguridad',
    client: '/client/profile#seguridad',
    studio: '/studio/dashboard#cuenta'
});

function isOpen(status) { return OPEN_STATUSES.includes(status); }
function canCancel(status) { return isOpen(status); }
function isUuid(value) { return typeof value === 'string' && UUID_RE.test(value); }

// "ELIMINAR" exacto (sin distinguir mayúsculas ni espacios de borde).
function isConfirmText(text) {
    return String(text == null ? '' : text).trim().toUpperCase() === CONFIRM_WORD;
}

// Normaliza la lista que devuelve account_deletion_blockers().
function normalizeBlockers(items) {
    if (!Array.isArray(items)) return [];
    return items.filter((i) => i && typeof i === 'object' && i.code).map((i) => ({
        code: String(i.code),
        severity: ['block', 'check', 'warn'].includes(i.severity) ? i.severity : 'block',
        label: String(i.label || i.code),
        detail: i.detail ? String(i.detail) : '',
        count: i.count == null ? null : Number(i.count),
        href: typeof i.href === 'string' && i.href.startsWith('/') && !i.href.startsWith('//') ? i.href : null
    }));
}

// 'block' y 'check' (no verificable) impiden aprobar y ejecutar.
function blockingItems(items) {
    return normalizeBlockers(items).filter((i) => i.severity !== 'warn');
}
function hasBlocking(items) { return blockingItems(items).length > 0; }

// ¿Se puede ejecutar el borrado? { ok } | { ok:false, reason, status }
function executionGate(request, liveBlockers) {
    if (!request) return { ok: false, status: 404, reason: 'No encontramos esa solicitud.' };
    if (request.status === 'completed') return { ok: false, status: 409, reason: 'La baja ya se ejecutó.' };
    if (request.status !== 'approved') return { ok: false, status: 409, reason: 'Primero aprobá la solicitud.' };
    if (!isUuid(String(request.user_id || ''))) return { ok: false, status: 400, reason: 'La solicitud no tiene un usuario válido.' };
    if (!Array.isArray(liveBlockers)) return { ok: false, status: 502, reason: 'No pudimos recalcular los bloqueos.' };
    if (hasBlocking(liveBlockers)) return { ok: false, status: 409, reason: 'Aparecieron bloqueos nuevos: revisalos antes de ejecutar.', blockers: blockingItems(liveBlockers) };
    return { ok: true };
}

function displayName(request) {
    const name = String((request && request.name_snapshot) || '').trim();
    if (name) return name;
    const local = String((request && request.email_snapshot) || '').split('@')[0].trim();
    return local || 'de We Ötzi';
}

function shortRef(id) { return String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase(); }

// Payload del email según el estado de la solicitud (o null si no hay aviso).
function buildEmailPayload(request, baseUrl) {
    if (!request) return null;
    const eventId = EMAIL_EVENTS[request.status];
    if (!eventId) return null;
    const email = String(request.email_snapshot || '').trim();
    if (!email || !email.includes('@')) return null;
    const base = String(baseUrl || '').replace(/\/$/, '');
    const path = ACCOUNT_PATHS[request.role] || '/';
    const note = String(request.support_notes || '').trim();
    const texts = {
        pending: ['recibimos tu solicitud de baja',
            'Soporte la revisa en un plazo de hasta 30 días: verificamos que no queden disputas, saldo en el wallet, trabajos en curso ni pedidos pendientes. Mientras tanto tu cuenta sigue activa y podés cancelar la solicitud desde tu cuenta.'],
        approved: ['soporte aprobó tu solicitud de baja',
            'No encontramos pendientes. Vamos a eliminar tu cuenta en los próximos días y te avisamos cuando esté hecho. Si cambiaste de idea, todavía podés cancelarla desde tu cuenta.'],
        rejected: ['soporte no pudo aprobar tu solicitud de baja',
            'Tu cuenta sigue activa. Revisá la nota de soporte; cuando lo resuelvas podés pedir la baja de nuevo.'],
        completed: ['eliminamos tu cuenta de We Ötzi',
            'Borramos tu perfil y tus datos de acceso. Conservamos solo un registro mínimo de esta solicitud y los datos que la ley nos obliga a guardar (por ejemplo, comprobantes de pagos).']
    }[request.status];
    return {
        eventId,
        payload: {
            email,
            user_name: displayName(request),
            status_title: texts[0],
            status_detail: texts[1],
            support_note: note || '-',
            request_reference: shortRef(request.id),
            account_url: request.status === 'completed' ? `${base}/` : `${base}${path}`
        },
        idempotencyKey: `account_deletion:${request.id}:${request.status}`
    };
}

// Envía (una vez) el aviso del estado actual. deps: { sendEmail, baseUrl }.
async function notifyStatus(request, deps) {
    const built = buildEmailPayload(request, deps && deps.baseUrl);
    if (!built) return { sent: false, skipped: 'no_email_for_status' };
    const result = await deps.sendEmail(built.eventId, built.payload, { idempotencyKey: built.idempotencyKey });
    return {
        sent: !!(result && result.ok && !result.skipped && !result.deduplicated),
        deduplicated: !!(result && result.deduplicated),
        eventId: built.eventId,
        error: result && !result.ok ? (result.error || 'send_failed') : null
    };
}

function isMissingTable(err) {
    const msg = String((err && err.message) || '');
    return (err && err.status === 404) || /42P01|PGRST205|does not exist|Could not find the table/i.test(msg);
}

/**
 * Ejecuta el borrado. deps:
 *   pgrest                       → lib/postgrest (service-role)
 *   deleteAuthUser(userId)       → Promise<{ ok, status }> (Admin API)
 *   artistRelations              → lib/artist-relations (count/clear)
 *   isSuperadminEmail(email)?    → bool
 * Devuelve { ok, steps[] } o lanza Error con .status y .steps.
 */
async function executeAccountDeletion(request, deps) {
    const { pgrest, deleteAuthUser, artistRelations } = deps;
    const isSuper = deps.isSuperadminEmail || ((e) => String(e || '').trim().toLowerCase() === SUPERADMIN_EMAIL);
    const userId = String(request.user_id || '');
    if (!isUuid(userId)) {
        const err = new Error('La solicitud no tiene un usuario válido.');
        err.status = 400;
        throw err;
    }
    const steps = [];
    const fail = (message, status, cause) => {
        const err = new Error(message);
        err.status = status || 502;
        err.steps = steps;
        if (cause) err.cause = cause;
        return err;
    };
    const tryRead = async (table, select) => {
        try { return await pgrest(table).select(select).eq('user_id', userId).execute(); } catch (e) {
            if (isMissingTable(e)) return [];
            throw fail(`No pudimos leer ${table}.`, 502, e);
        }
    };

    const artists = await tryRead('artists_db', 'id,user_id,email');
    const studios = await tryRead('studios', 'id,user_id,email,name');
    const emails = [request.email_snapshot].concat(artists.map((a) => a.email), studios.map((s) => s.email));
    if (emails.some((e) => e && isSuper(e))) throw fail('No se puede eliminar la cuenta superadmin.', 403);

    // Soporte: la conversación queda anónima (mismo criterio que el trigger del artista).
    try {
        await pgrest('support_conversations').eq('user_id', userId).is('anonymous_id', null)
            .patch({ anonymous_id: userId }, { returning: false });
        steps.push({ step: 'support_anonymized', ok: true });
    } catch (e) {
        if (!isMissingTable(e)) throw fail('No pudimos anonimizar las conversaciones de soporte.', 502, e);
        steps.push({ step: 'support_anonymized', ok: true, skipped: 'table' });
    }

    for (const studio of studios) {
        try {
            await pgrest('studios').eq('id', studio.id).delete({ returning: true });
            steps.push({ step: 'studio_deleted', id: studio.id, ok: true });
        } catch (e) {
            throw fail(`No pudimos eliminar el estudio ${studio.name || studio.id} (puede haber registros relacionados).`, 409, e);
        }
    }

    for (const artist of artists) {
        const keys = { id: artist.id, user_id: artist.user_id };
        try {
            const relations = await artistRelations.countArtistRelations(pgrest, keys);
            if (relations.some((r) => r.blocking)) await artistRelations.clearBlockingRelations(pgrest, keys);
            await pgrest('artists_db').eq('id', artist.id).delete({ returning: true });
            steps.push({ step: 'artist_deleted', id: artist.id, ok: true,
                relations: relations.map((r) => `${r.table}=${r.count}`) });
        } catch (e) {
            throw fail('No pudimos eliminar el perfil de artista (puede haber registros relacionados).', 409, e);
        }
    }

    try {
        await pgrest('clients_db').eq('user_id', userId).delete();
        steps.push({ step: 'client_deleted', ok: true });
    } catch (e) {
        if (!isMissingTable(e)) throw fail('No pudimos eliminar el perfil de cliente (puede haber registros relacionados).', 409, e);
        steps.push({ step: 'client_deleted', ok: true, skipped: 'table' });
    }

    // Auth (el trigger del artista ya pudo haberlo borrado: 404 = ok).
    const auth = await deleteAuthUser(userId).catch(() => ({ ok: false, status: 0 }));
    const authOk = !!(auth && (auth.ok || auth.status === 404));
    steps.push({ step: 'auth_deleted', ok: authOk, status: auth && auth.status });
    if (!authOk) throw fail('Borramos el perfil, pero no pudimos eliminar el acceso (Auth). Reintentá la ejecución.', 502);
    return { ok: true, steps };
}

module.exports = {
    ROLES, STATUSES, OPEN_STATUSES, CONFIRM_WORD, MIGRATION, STATUS_TEXT, EMAIL_EVENTS, ACCOUNT_PATHS,
    isOpen, canCancel, isUuid, isConfirmText, normalizeBlockers, blockingItems, hasBlocking,
    executionGate, buildEmailPayload, notifyStatus, executeAccountDeletion, shortRef, isMissingTable
};
