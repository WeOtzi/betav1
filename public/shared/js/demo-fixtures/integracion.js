/**
 * Fixtures de preview/demo · grupo "integracion" (ronda 3, 12 nov 2026).
 * Extensión que wo-demo-fixtures.js aplica al final de build() (después de
 * "cuenta" y "pagos"). Cubre la migración NO aplicada 20261112220000:
 *   - RPC support_settle_artist_withdrawal (espejo del SQL): un retiro
 *     'processing' pasa a 'completed' (referencia obligatoria) o 'failed'
 *     (nota obligatoria); metadata_json.settlement con referencia, nota y fecha.
 *   - Una solicitud de cambios abierta sobre la invitación pendiente más
 *     reciente del artista (801:1101 · «Cambios solicitados · esperando al estudio»),
 *     si la extensión "invitaciones" no dejó ya una.
 * El retiro en proceso de la extensión "cuenta" (USD 500) es el que se liquida.
 */
(function (root) {
    'use strict';
    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};
    root.WoDemoFixtureExtensions['integracion'] = function (ctx) {
        var tables = ctx.tables;
        var DAY = (ctx.helpers && ctx.helpers.DAY) || 86400000;
        var now = Date.now();
        var artistId = (ctx.identity && ctx.identity.userId) || null;

        function fail(msg) { throw new Error(msg); }
        function text(v) { return String(v == null ? '' : v).trim(); }

        ['artist_wallet_movements', 'studio_invitation_change_requests'].forEach(function (t) {
            if (ctx.TABLES.indexOf(t) === -1) ctx.TABLES.push(t);
            tables[t] = tables[t] || [];
        });

        /* ---------------- solicitud de cambios abierta (801:1101) ---------------- */
        var pendingInvites = (tables.studio_artist_memberships || []).filter(function (m) {
            return m && (!artistId || m.artist_user_id === artistId) && (m.status === 'pending_invite' || m.status === 'pending_acceptance');
        }).sort(function (a, b) { return String(b.invited_at || '').localeCompare(String(a.invited_at || '')); });
        var target = pendingInvites[1] || pendingInvites[0] || null;
        var hasOpen = tables.studio_invitation_change_requests.some(function (r) { return r && r.status === 'pending' && (!artistId || r.artist_user_id === artistId); });
        if (target && !hasOpen) {
            tables.studio_invitation_change_requests.push({
                id: '0000c4a0-0000-4000-8000-1e0000000001',
                membership_id: target.id,
                artist_user_id: target.artist_user_id || artistId,
                message: '¿Podríamos arrancar dos semanas más tarde y llevar el split a 60/40?',
                status: 'pending',
                created_at: new Date(now - 2 * DAY).toISOString(),
                resolved_at: null
            });
        }

        /* ---------------- liquidar retiros (soporte) ---------------- */
        ctx.rpcs.support_settle_artist_withdrawal = function (args, store) {
            var outcome = args.p_outcome;
            var reference = text(args.p_reference) || null;
            var note = text(args.p_note) || null;
            if (outcome !== 'completed' && outcome !== 'failed') fail('Resultado inválido.');
            if (outcome === 'completed' && (!reference || reference.length < 3)) fail('Escribí la referencia de la transferencia (mínimo 3 caracteres).');
            if (outcome === 'failed' && (!note || note.length < 5)) fail('Escribí el motivo del fallo (mínimo 5 caracteres). Lo ve el artista.');
            if (reference && reference.length > 120) fail('La referencia puede tener hasta 120 caracteres.');
            if (note && note.length > 500) fail('La nota puede tener hasta 500 caracteres.');
            var row = store.rows('artist_wallet_movements').find(function (m) { return String(m.id) === String(args.p_movement_id) && m.kind === 'withdrawal'; });
            if (!row) fail('No encontramos ese retiro.');
            if (row.status !== 'processing') fail('Ese retiro ya fue resuelto (estado: ' + row.status + ').');
            var at = new Date().toISOString();
            return store.update('artist_wallet_movements', [{ col: 'id', op: 'eq', value: String(row.id), negated: false }], {
                status: outcome,
                updated_at: at,
                metadata_json: Object.assign({}, row.metadata_json, {
                    settlement: { outcome: outcome, reference: reference, note: note, settled_at: at, settled_by: 'preview-support' }
                })
            })[0] || null;
        };
    };
}(typeof self !== 'undefined' ? self : this));
