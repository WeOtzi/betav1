/**
 * WE OTZI - Repositorio · decisiones de soporte sobre la cuenta del artista
 * ------------------------------------------------------------------------
 * Ronda 3 · integracion. El panel de notificaciones del artista
 * (wo-artist-menu.js) muestra "Aprobamos tu documento…", "Verificamos tu
 * destino…", "Pagamos tu retiro…" a partir de las filas que soporte decidió
 * (RLS del dueño en las tres tablas). La lógica de texto vive en
 * support-decision-model.js. Carga: después de postgrest-client.js.
 * Expone WeotziData.SupportDecisions.
 */
(function (root) {
    'use strict';

    var D = root.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[support-decisions-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    var run = D.run;

    // Una tabla que falta (migración sin aplicar) no tumba a las otras.
    function soft(label, fn) {
        return run(label, fn).then(function (res) { return (res && res.data) || []; })
            .catch(function (err) { console.warn('[support-decisions-repo] ' + label + ':', err && err.message); return []; });
    }

    var SupportDecisions = {
        // sinceIso: decisiones desde esa fecha (por defecto, 14 días).
        async listRecentForArtist(artistUserId, sinceIso) {
            if (!artistUserId) return { documents: [], destinations: [], withdrawals: [] };
            var since = sinceIso || new Date(Date.now() - 14 * 86400000).toISOString();
            var results = await Promise.all([
                soft('supportDecisions.documents', function (c) {
                    return c.from('artist_verification_documents')
                        .select('id, artist_user_id, doc_type, status, reviewed_at, reviewer_notes')
                        .eq('artist_user_id', artistUserId).in('status', ['verificado', 'rechazado'])
                        .gte('reviewed_at', since).order('reviewed_at', { ascending: false }).limit(20);
                }),
                soft('supportDecisions.destinations', function (c) {
                    return c.from('artist_payout_destinations')
                        .select('id, artist_user_id, label, verification_status, verified_at, metadata_json, updated_at')
                        .eq('artist_user_id', artistUserId).in('verification_status', ['verified', 'rejected'])
                        .gte('updated_at', since).order('updated_at', { ascending: false }).limit(20);
                }),
                soft('supportDecisions.withdrawals', function (c) {
                    return c.from('artist_wallet_movements')
                        .select('id, artist_user_id, kind, status, amount, currency, title, metadata_json, updated_at')
                        .eq('artist_user_id', artistUserId).eq('kind', 'withdrawal').in('status', ['completed', 'failed'])
                        .gte('updated_at', since).order('updated_at', { ascending: false }).limit(20);
                })
            ]);
            return { documents: results[0], destinations: results[1], withdrawals: results[2] };
        }
    };

    D.SupportDecisions = SupportDecisions;
}(typeof window !== 'undefined' ? window : this));
