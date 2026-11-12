/**
 * WE OTZI - Repositorio de soporte · verificación de destinos y documentos
 * ------------------------------------------------------------------------
 * Ronda 3 · grupo "pagos" (funciones-b P1 puntos 3 y 4; Figma 801:568/569/573).
 * Lecturas con la sesión de soporte (RLS is_support_user() en
 * artist_payout_destinations, artist_verification_documents, artists_db y el
 * bucket artist-verification). Escrituras SOLO por RPC security definer que
 * vuelven a chequear is_support_user() (migración 20261112170000):
 *   support_review_payout_destination(id, 'verified'|'rejected', nota)
 *   support_review_verification_document(id, 'verificado'|'rechazado', nota)
 *   support_set_artist_verification_state(user_id, 'Yes'|'Denied'|'Requested'|'No')
 *
 * Carga: DESPUÉS de postgrest-client.js. Expone WeotziData.SupportVerification.
 */
(function (root) {
    'use strict';

    var D = root.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[support-verification-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    var run = D.run;

    var DEST_SELECT = 'id, artist_user_id, method, label, holder_name, currency, account_identifier, rail, country_code, verification_status, verified_at, is_default, active, metadata_json, created_at, updated_at';
    var DOC_SELECT = 'id, artist_user_id, doc_type, file_name, storage_path, status, uploaded_at, reviewed_at, reviewer_notes';
    var ARTIST_SELECT = 'user_id, name, username, email, country, city, verification_state';
    var DEST_STATUS = { pending: 'pending', verified: 'verified', rejected: 'rejected' };
    var DOC_STATUS = { pending: 'pendiente', verified: 'verificado', rejected: 'rechazado' };
    var WD_SELECT = 'id, artist_user_id, kind, status, amount, currency, title, destination_id, occurred_at, metadata_json, created_at, updated_at';
    var WD_STATUS = { pending: 'processing', verified: 'completed', rejected: 'failed' };

    function rpcRow(data) { return Array.isArray(data) ? (data[0] || null) : (data || null); }

    var SupportVerification = {
        // status: 'pending' | 'verified' | 'rejected' | 'all'
        async listDestinations(status) {
            var res = await run('supportVerification.destinations', function (c) {
                var q = c.from('artist_payout_destinations').select(DEST_SELECT).eq('active', true);
                if (DEST_STATUS[status]) q = q.eq('verification_status', DEST_STATUS[status]);
                return q.order('created_at', { ascending: true }).limit(300);
            });
            return res.data || [];
        },

        async listDocuments(status) {
            var res = await run('supportVerification.documents', function (c) {
                var q = c.from('artist_verification_documents').select(DOC_SELECT);
                if (DOC_STATUS[status]) q = q.eq('status', DOC_STATUS[status]);
                return q.order('uploaded_at', { ascending: true }).limit(300);
            });
            return res.data || [];
        },

        async listDocumentsForArtist(artistUserId) {
            var res = await run('supportVerification.artistDocuments', function (c) {
                return c.from('artist_verification_documents').select(DOC_SELECT).eq('artist_user_id', artistUserId);
            });
            return res.data || [];
        },

        async artistsByUserIds(userIds) {
            var ids = Array.from(new Set((userIds || []).filter(Boolean).map(String)));
            if (!ids.length) return [];
            var res = await run('supportVerification.artists', function (c) {
                return c.from('artists_db').select(ARTIST_SELECT).in('user_id', ids.slice(0, 300));
            });
            return res.data || [];
        },

        async countPending() {
            var dest = await run('supportVerification.countDestinations', function (c) {
                return c.from('artist_payout_destinations').select('id', { count: 'exact', head: true })
                    .eq('active', true).eq('verification_status', 'pending');
            });
            var docs = await run('supportVerification.countDocuments', function (c) {
                return c.from('artist_verification_documents').select('id', { count: 'exact', head: true })
                    .eq('status', 'pendiente');
            });
            // ── integracion ── retiros en proceso (si la tabla no responde, 0).
            var wd = await run('supportVerification.countWithdrawals', function (c) {
                return c.from('artist_wallet_movements').select('id', { count: 'exact', head: true })
                    .eq('kind', 'withdrawal').eq('status', 'processing');
            }).catch(function () { return { count: 0 }; });
            return { destinations: dest.count || 0, documents: docs.count || 0, withdrawals: wd.count || 0 };
        },

        // ── integracion ── retiros del Wallet (RLS artist_wallet_movements_support_all).
        // status: 'pending' (processing) | 'verified' (completed) | 'rejected' (failed) | 'all'
        async listWithdrawals(status) {
            var res = await run('supportVerification.withdrawals', function (c) {
                var q = c.from('artist_wallet_movements').select(WD_SELECT).eq('kind', 'withdrawal');
                if (WD_STATUS[status]) q = q.eq('status', WD_STATUS[status]);
                else q = q.in('status', ['processing', 'completed', 'failed']);
                return q.order('occurred_at', { ascending: true }).limit(300);
            });
            return res.data || [];
        },

        async destinationsByIds(ids) {
            var list = Array.from(new Set((ids || []).filter(Boolean).map(String)));
            if (!list.length) return [];
            var res = await run('supportVerification.destinationsByIds', function (c) {
                return c.from('artist_payout_destinations').select(DEST_SELECT).in('id', list.slice(0, 300));
            });
            return res.data || [];
        },

        // outcome: 'completed' (pagado, con referencia) | 'failed' (con nota).
        async settleWithdrawal(id, outcome, reference, note) {
            var res = await run('supportVerification.settleWithdrawal', function (c) {
                return c.rpc('support_settle_artist_withdrawal', {
                    p_movement_id: id, p_outcome: outcome, p_reference: reference || null, p_note: note || null
                });
            });
            return rpcRow(res.data);
        },

        async reviewDestination(id, decision, note) {
            var res = await run('supportVerification.reviewDestination', function (c) {
                return c.rpc('support_review_payout_destination', { p_destination_id: id, p_decision: decision, p_note: note || null });
            });
            return rpcRow(res.data);
        },

        async reviewDocument(id, decision, note) {
            var res = await run('supportVerification.reviewDocument', function (c) {
                return c.rpc('support_review_verification_document', { p_document_id: id, p_decision: decision, p_note: note || null });
            });
            return rpcRow(res.data);
        },

        async setArtistVerification(artistUserId, state) {
            var res = await run('supportVerification.setArtistState', function (c) {
                return c.rpc('support_set_artist_verification_state', { p_artist_user_id: artistUserId, p_state: state });
            });
            return rpcRow(res.data);
        },

        // URL firmada corta (2 min) del documento en el bucket privado.
        async documentUrl(path) {
            var client = D.getClient();
            if (!client || !client.storage) throw new Error('No pudimos conectar con el almacenamiento.');
            var result = await client.storage.from('artist-verification').createSignedUrl(path, 120);
            if (result.error || !result.data) throw new Error('No pudimos abrir el documento.');
            return result.data.signedUrl;
        }
    };

    D.SupportVerification = SupportVerification;
}(typeof window !== 'undefined' ? window : this));
