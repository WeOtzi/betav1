/**
 * WE OTZI - Repositorio de la cotización manual (frontend)
 * --------------------------------------------------------
 * Figma final "We Otzi Pantallas final" · 801:556 Nueva cotización manual.
 * Tablas nuevas (migración 20261028120000_quotation_manual_quotes.sql):
 *   artist_manual_quotes  borradores y detalle económico de cada cotización manual
 *   artist_clients        libreta de clientes del artista ("crearlo ahora")
 * La creación final usa WeotziData.Quotations.createManual (RPC).
 *
 * Todos los métodos lanzan como `run`. Si la migración todavía no se aplicó,
 * el error trae `missingSchema = true` para que la página degrade (guarda el
 * borrador en el navegador y avisa) sin excepciones sin capturar.
 *
 * Carga: DESPUÉS de postgrest-client.js. Expone
 * window.WeotziData.{ManualQuotes, ArtistClients, isMissingSchema}.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[quotation-new-repo] postgrest-client.js debe cargarse antes.');
        return;
    }

    // PGRST205 tabla inexistente · PGRST202 función inexistente · 42P01 relación
    // inexistente · 42883 función inexistente. En el preview local, las tablas
    // sin fixture responden "No simulado".
    function isMissingSchema(err) {
        if (!err) return false;
        const code = String(err.code || (err.cause && err.cause.code) || '');
        if (['PGRST205', 'PGRST202', '42P01', '42883'].includes(code)) return true;
        const msg = String(err.message || '') + ' ' + String(err.cause && err.cause.message || '');
        return /Could not find the (table|function)|does not exist|No simulado/i.test(msg);
    }

    async function run(label, builder) {
        try {
            return await D.run(label, builder);
        } catch (err) {
            if (isMissingSchema(err)) err.missingSchema = true;
            throw err;
        }
    }

    const MANUAL_SELECT = 'id, artist_id, quote_ref, status, origin, artist_client_id, quote_id, client, project, line_items, currency, discount_pct, tax_pct, deposit_pct, subtotal, total, deposit_amount, validity_days, cancellation_policy, client_notes, extra_terms, created_at, updated_at, sent_at';

    // ================== artist_manual_quotes ==================
    const ManualQuotes = {
        async getByRef(quoteRef) {
            const { data } = await run('manualQuotes.getByRef', (c) =>
                c.from('artist_manual_quotes').select(MANUAL_SELECT).eq('quote_ref', quoteRef).maybeSingle()
            );
            return data || null;
        },
        async getByQuoteId(quoteId) {
            const { data } = await run('manualQuotes.getByQuoteId', (c) =>
                c.from('artist_manual_quotes').select(MANUAL_SELECT).eq('quote_id', quoteId).maybeSingle()
            );
            return data || null;
        },
        // Borradores del artista (alcance "Borradores" del listado).
        async listDraftsForArtist(artistUserId) {
            const { data } = await run('manualQuotes.listDraftsForArtist', (c) =>
                c.from('artist_manual_quotes').select(MANUAL_SELECT)
                    .eq('artist_id', artistUserId).eq('status', 'draft')
                    .order('updated_at', { ascending: false })
            );
            return data || [];
        },
        // Guarda (o actualiza) el borrador por quote_ref. RLS: solo el dueño y
        // solo mientras siga en draft.
        async saveDraft(record) {
            const payload = Object.assign({}, record, { status: 'draft', updated_at: new Date().toISOString() });
            const { data } = await run('manualQuotes.saveDraft', (c) =>
                c.from('artist_manual_quotes').upsert([payload], { onConflict: 'quote_ref' }).select(MANUAL_SELECT).maybeSingle()
            );
            return data || payload;
        },
        async deleteDraft(quoteRef) {
            await run('manualQuotes.deleteDraft', (c) =>
                c.from('artist_manual_quotes').delete().eq('quote_ref', quoteRef).eq('status', 'draft')
            );
        },
    };

    // ===================== artist_clients =====================
    const CLIENT_SELECT = 'id, artist_id, full_name, email, whatsapp, instagram, city, notes, created_at';

    const ArtistClients = {
        async listForArtist(artistUserId, limit = 300) {
            const { data } = await run('artistClients.listForArtist', (c) =>
                c.from('artist_clients').select(CLIENT_SELECT).eq('artist_id', artistUserId)
                    .order('created_at', { ascending: false }).limit(limit)
            );
            return data || [];
        },
        async create(row) {
            const { data } = await run('artistClients.create', (c) =>
                c.from('artist_clients').insert([row]).select(CLIENT_SELECT).maybeSingle()
            );
            return data || null;
        },
    };

    D.ManualQuotes = ManualQuotes;
    D.ArtistClients = ArtistClients;
    D.isMissingSchema = isMissingSchema;
})();
