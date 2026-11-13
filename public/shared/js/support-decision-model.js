/**
 * WE OTZI - Decisiones de soporte que se le avisan al artista (ronda 3 · integracion)
 * ---------------------------------------------------------------------------------
 * Soporte decide en /support/dashboard · VERIFICACIONES sobre:
 *   - un documento de verificación      (artist_verification_documents: status + reviewed_at + reviewer_notes)
 *   - un destino de retiro              (artist_payout_destinations: verification_status + metadata_json.review)
 *   - un retiro del Wallet              (artist_wallet_movements kind 'withdrawal': status + metadata_json.settlement)
 * La decisión vive en la fila (fuente de verdad). Este módulo, sin DOM ni red,
 * la convierte en:
 *   - un ítem del panel de notificaciones del artista (wo-artist-menu.js), y
 *   - el payload del email artist_support_decision (lib/integracion-support-notify.js).
 * Navegador: window.WoSupportDecisionModel. Node: require().
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoSupportDecisionModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var SUBJECTS = ['document', 'destination', 'withdrawal'];
    var DOC_LABELS = { identidad: 'documento de identidad', domicilio: 'comprobante de domicilio', bioseguridad: 'certificado de bioseguridad' };
    // Ventana para el email: solo decisiones recién tomadas (evita reenviar
    // decisiones viejas si alguien llama al endpoint más tarde).
    var EMAIL_WINDOW_MS = 15 * 60 * 1000;
    // Ventana del panel de notificaciones del artista.
    var FEED_WINDOW_DAYS = 14;

    function text(v) { return v == null ? '' : String(v).trim(); }
    function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
    function validTime(iso) {
        var t = iso ? Date.parse(iso) : NaN;
        return Number.isFinite(t) ? new Date(t).toISOString() : null;
    }
    function money(amount, currency) {
        var n = Number(amount);
        if (!Number.isFinite(n)) return text(currency);
        var fixed = Math.round(n * 100) / 100;
        var parts = fixed.toFixed(Number.isInteger(fixed) ? 0 : 2).split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return (text(currency).toUpperCase() + ' ' + parts.join(',')).trim();
    }

    /**
     * Fila → decisión normalizada, o null si la fila no tiene una decisión de
     * soporte (pendiente, en proceso, sin fecha de decisión).
     * @returns {{ subject, id, artistUserId, outcome: 'approved'|'rejected'|'paid'|'failed',
     *             decidedAt, note, reference, label, amount, currency } | null}
     */
    function fromRow(subject, row) {
        if (SUBJECTS.indexOf(subject) === -1 || !row || row.id == null) return null;
        var base = { subject: subject, id: String(row.id), artistUserId: row.artist_user_id ? String(row.artist_user_id) : null,
            outcome: null, decidedAt: null, note: null, reference: null, label: '', amount: null, currency: null };
        if (subject === 'document') {
            var s = text(row.status).toLowerCase();
            base.outcome = s === 'verificado' ? 'approved' : s === 'rechazado' ? 'rejected' : null;
            base.decidedAt = validTime(row.reviewed_at);
            base.note = text(row.reviewer_notes) || null;
            base.label = DOC_LABELS[row.doc_type] || 'documento';
        } else if (subject === 'destination') {
            var review = obj(obj(row.metadata_json).review);
            var vs = text(row.verification_status);
            base.outcome = vs === 'verified' ? 'approved' : vs === 'rejected' ? 'rejected' : null;
            base.decidedAt = validTime(review.reviewed_at) || (vs === 'verified' ? validTime(row.verified_at) : null);
            base.note = text(review.note) || null;
            base.label = text(row.label) || 'destino de retiro';
        } else {
            if (text(row.kind) && row.kind !== 'withdrawal') return null;
            var st = obj(obj(row.metadata_json).settlement);
            base.outcome = row.status === 'completed' ? 'paid' : row.status === 'failed' ? 'failed' : null;
            base.decidedAt = validTime(st.settled_at);
            base.note = text(st.note) || null;
            base.reference = text(st.reference) || null;
            base.amount = row.amount != null ? Number(row.amount) : null;
            base.currency = text(row.currency).toUpperCase() || null;
            base.label = text(row.title) || 'Retiro';
        }
        if (!base.outcome || !base.decidedAt) return null;
        return base;
    }

    function href(d) { return d.subject === 'document' ? '/artist/account#verificacion' : '/artist/account#cobros'; }

    // Título y detalle en voseo (los usan el panel y el email).
    function describe(d) {
        if (!d) return null;
        var title, detail;
        if (d.subject === 'document') {
            if (d.outcome === 'approved') {
                title = 'Aprobamos tu ' + d.label;
                detail = 'Ya cuenta para la verificación de tu perfil.';
            } else {
                title = 'Rechazamos tu ' + d.label;
                detail = (d.note ? 'Motivo: ' + d.note + '. ' : '') + 'Podés subir uno nuevo desde Cuenta · Verificación.';
            }
        } else if (d.subject === 'destination') {
            if (d.outcome === 'approved') {
                title = 'Verificamos tu destino de retiro «' + d.label + '»';
                detail = 'Ya podés pedir retiros a esa cuenta.';
            } else {
                title = 'No pudimos verificar tu destino de retiro «' + d.label + '»';
                detail = (d.note ? 'Motivo: ' + d.note + '. ' : '') + 'Revisá los datos en Cuenta · Cobros.';
            }
        } else {
            var amount = d.amount != null ? money(d.amount, d.currency) : 'tu retiro';
            if (d.outcome === 'paid') {
                title = 'Pagamos tu retiro de ' + amount;
                detail = (d.reference ? 'Referencia de la transferencia: ' + d.reference + '. ' : '') + 'Puede tardar unas horas en verse en tu cuenta.';
            } else {
                title = 'Tu retiro de ' + amount + ' no se pudo pagar';
                detail = (d.note ? 'Motivo: ' + d.note + '. ' : '') + 'El monto volvió a tu saldo disponible.';
            }
        }
        return { title: title, detail: detail.trim() };
    }

    function feedKey(d) { return 'sup:' + d.subject + ':' + d.id + ':' + d.decidedAt; }

    var FEED_ICON = { document: 'shield', destination: 'credit-card', withdrawal: 'dollar-sign' };

    // Ítem del panel de notificaciones (mismo formato que wo-artist-menu.js).
    function feedItem(d, seen) {
        var text2 = describe(d);
        if (!text2) return null;
        var key = feedKey(d);
        return {
            key: key, type: 'soporte', icon: FEED_ICON[d.subject] || 'bell',
            title: text2.title, desc: text2.detail, ts: d.decidedAt,
            unread: !(seen && typeof seen.has === 'function' && seen.has(key)),
            href: href(d)
        };
    }

    // Filas de las tres tablas → ítems del panel, solo decisiones recientes.
    function feedItems(input, opts) {
        opts = opts || {};
        var now = opts.now instanceof Date ? opts.now.getTime() : (opts.now ? Date.parse(opts.now) : Date.now());
        var since = now - (opts.days != null ? opts.days : FEED_WINDOW_DAYS) * 86400000;
        var out = [];
        [['document', input && input.documents], ['destination', input && input.destinations], ['withdrawal', input && input.withdrawals]]
            .forEach(function (pair) {
                (Array.isArray(pair[1]) ? pair[1] : []).forEach(function (row) {
                    var d = fromRow(pair[0], row);
                    if (!d || Date.parse(d.decidedAt) < since) return;
                    var item = feedItem(d, opts.seen);
                    if (item) out.push(item);
                });
            });
        return out.sort(function (a, b) { return Date.parse(b.ts) - Date.parse(a.ts); });
    }

    function isRecent(d, now, windowMs) {
        if (!d || !d.decidedAt) return false;
        var t = Date.parse(d.decidedAt);
        var n = now instanceof Date ? now.getTime() : (now ? Date.parse(now) : Date.now());
        var w = windowMs != null ? windowMs : EMAIL_WINDOW_MS;
        // Tolerancia de 1 min por desfasaje de reloj entre la base y el servidor.
        return Number.isFinite(t) && t <= n + 60000 && n - t <= w;
    }

    // Payload del email artist_support_decision (services/email-event-mapping.js).
    function emailPayload(d, artist, opts) {
        opts = opts || {};
        var t = describe(d);
        if (!t) return null;
        var a = artist || {};
        var base = text(opts.baseUrl).replace(/\/+$/, '');
        return {
            artist_email: text(a.email) || null,
            artist_user_id: d.artistUserId,
            artist_name: text(a.name) || text(a.username) || 'artista',
            decision_title: t.title,
            decision_detail: t.detail,
            support_note: d.note || '-',
            support_reference: d.reference || '-',
            dashboard_url: base + href(d)
        };
    }

    // Clave de idempotencia del envío (email_delivery_ledger).
    function idempotencyKey(d) { return 'support-decision:' + d.subject + ':' + d.id + ':' + d.decidedAt; }

    return {
        SUBJECTS: SUBJECTS,
        EMAIL_WINDOW_MS: EMAIL_WINDOW_MS,
        FEED_WINDOW_DAYS: FEED_WINDOW_DAYS,
        fromRow: fromRow,
        describe: describe,
        href: href,
        feedKey: feedKey,
        feedItem: feedItem,
        feedItems: feedItems,
        isRecent: isRecent,
        emailPayload: emailPayload,
        idempotencyKey: idempotencyKey,
        money: money
    };
}));
