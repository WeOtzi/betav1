'use strict';

// ── integracion ── Aviso por email al artista cuando soporte decide sobre un
// documento de verificación, un destino de retiro o un retiro (ronda 3).
//
// Flujo: el panel de soporte llama a la RPC security definer (que valida
// is_support_user() y escribe la decisión en la fila) y después a
// POST /api/support/artist-decision-notify { subject, id }. Este módulo:
//   1. NO confía en el cliente: relee la fila con service-role y deriva la
//      decisión de la base (public/shared/js/support-decision-model.js);
//   2. solo avisa decisiones recién tomadas (15 min) para que el endpoint no
//      sirva para reenviar decisiones viejas;
//   3. respeta lib/notification-prefs.js shouldNotify(artista, 'cuenta', 'email').
//      'cuenta' todavía no es una fila de la matriz de Cuenta (801:572), así que
//      hoy shouldNotify devuelve true (regla "kinds desconocidos → se envía");
//      cuando la matriz sume la fila, el filtro empieza a regir sin tocar esto;
//   4. envía con idempotencia (email_delivery_ledger): una decisión = un email.
// El aviso in-app no se escribe: el panel de notificaciones del artista lo
// deriva de las mismas filas (wo-artist-menu.js + support-decisions-repo.js).

const Model = require('../public/shared/js/support-decision-model.js');

const NOTIF_KIND = 'cuenta';
const EVENT_ID = 'artist_support_decision';
const TABLES = {
    document: { table: 'artist_verification_documents', select: 'id,artist_user_id,doc_type,status,reviewed_at,reviewer_notes' },
    destination: { table: 'artist_payout_destinations', select: 'id,artist_user_id,label,verification_status,verified_at,metadata_json' },
    withdrawal: { table: 'artist_wallet_movements', select: 'id,artist_user_id,kind,status,amount,currency,title,metadata_json' }
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRequest(body) {
    const b = body && typeof body === 'object' ? body : {};
    const subject = String(b.subject || '').trim();
    const id = String(b.id || '').trim();
    if (!TABLES[subject]) return { ok: false, status: 400, error: 'Tipo de decisión inválido.' };
    if (!UUID_RE.test(id)) return { ok: false, status: 400, error: 'Identificador inválido.' };
    return { ok: true, subject, id };
}

/**
 * @param {{ subject: string, id: string }} input
 * @param {{ fetchRow, fetchArtist, shouldNotify, sendEmail, baseUrl?, now? }} deps
 * @returns {Promise<{ ok: boolean, status?: number, sent?: boolean, skipped?: string, error?: string }>}
 */
async function notifyArtistDecision(input, deps) {
    const req = parseRequest(input);
    if (!req.ok) return req;
    const spec = TABLES[req.subject];
    const row = await deps.fetchRow(spec.table, spec.select, req.id);
    if (!row) return { ok: false, status: 404, error: 'No encontramos ese registro.' };
    const decision = Model.fromRow(req.subject, row);
    if (!decision) return { ok: true, sent: false, skipped: 'no_decision' };
    if (!Model.isRecent(decision, deps.now || new Date())) return { ok: true, sent: false, skipped: 'stale' };
    if (!decision.artistUserId) return { ok: true, sent: false, skipped: 'no_artist' };

    const artist = await deps.fetchArtist(decision.artistUserId);
    if (!artist || !artist.email) return { ok: true, sent: false, skipped: 'no_email' };
    const allowed = await deps.shouldNotify({ id: decision.artistUserId, email: artist.email }, NOTIF_KIND, 'email');
    if (!allowed) return { ok: true, sent: false, skipped: 'notification_pref' };

    const payload = Model.emailPayload(decision, artist, { baseUrl: deps.baseUrl });
    const result = await deps.sendEmail(EVENT_ID, payload, { idempotencyKey: Model.idempotencyKey(decision) });
    return {
        ok: true,
        sent: Boolean(result && result.ok && !result.skipped),
        deduplicated: Boolean(result && result.deduplicated),
        channel: result && result.channel
    };
}

module.exports = { NOTIF_KIND, EVENT_ID, TABLES, parseRequest, notifyArtistDecision };
