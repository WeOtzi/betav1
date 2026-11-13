/**
 * WE OTZI - Repositorio de pagos de clientes por cotización (frontend)
 * --------------------------------------------------------------------
 * Ronda 3 · grupo "pagos". Tabla public.quotation_payments (solo lectura por
 * PostgREST) + RPC record_quotation_payment / void_quotation_payment + bucket
 * privado quotation-payment-receipts (migración 20261112170000, NO aplicada).
 *
 * Mientras la migración no esté aplicada, isAvailable() devuelve false y la UI
 * avisa que el registro de pagos todavía no está activo (nada se inventa).
 *
 * Carga: DESPUÉS de postgrest-client.js. Expone window.WeotziData.QuotationPayments.
 */
(function (root) {
    'use strict';

    var TABLE = 'quotation_payments';
    var BUCKET = 'quotation-payment-receipts';
    var SELECT = 'id, quotation_id, quote_id, artist_user_id, kind, method, amount, currency, paid_on, note, client_name, receipt_path, receipt_name, receipt_mime, receipt_size, created_at';
    var QUOTE_SELECT = 'id, quote_id, quote_status, client_full_name, final_budget_amount, final_budget_currency, artist_budget_amount, artist_budget_currency, final_sessions, artist_responded_at, client_completed_at, artist_completed_at, is_archived, updated_at, created_at';
    var PAYABLE = ['responded', 'client_approved', 'in_progress', 'en_progreso', 'artist_completed', 'completed'];

    var D = root.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[quotation-payments-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    var run = D.run;
    var probe = null;

    function isMissing(err) {
        var cause = (err && err.cause) || err || {};
        var code = String(cause.code || (err && err.code) || '');
        var msg = String(cause.message || (err && err.message) || '');
        return code === '42P01' || code === 'PGRST205' || code === 'PGRST202' || code === 'PREVIEW_UNSUPPORTED'
            || /does not exist|schema cache|could not find the (table|function)|no simulad/i.test(msg);
    }

    // Mensaje legible de un error de la RPC (los raise del SQL ya vienen en voseo).
    function friendly(err, fallback) {
        var cause = (err && err.cause) || {};
        var msg = String(cause.message || (err && err.message) || '').replace(/^\[[^\]]+\]\s*/, '');
        if (isMissing(err)) return 'El registro de pagos todavía no está activo en tu cuenta.';
        if (/JWT|not authenticated|Iniciá sesión/i.test(msg)) return 'Tu sesión venció. Volvé a iniciar sesión.';
        if (msg && /[áéíóúñ¿]|Elegí|Ingresá|Usá|Subilo|No encontramos|Solo podés|no puede|demasiados/i.test(msg)) return msg;
        return fallback || 'No pudimos guardar el pago. Probá de nuevo.';
    }

    function newId() {
        try {
            if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID().slice(0, 8);
        } catch (e) { /* sigue */ }
        return Date.now().toString(36);
    }

    function safeFileName(name) {
        var M = root.WoPaymentsModel;
        if (M && M.safeFileName) return M.safeFileName(name);
        return String(name || 'comprobante').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80) || 'comprobante';
    }

    var QuotationPayments = {
        TABLE: TABLE,
        BUCKET: BUCKET,
        friendly: friendly,

        async isAvailable() {
            if (!probe) {
                probe = run('quotationPayments.probe', function (c) {
                    return c.from(TABLE).select('id', { count: 'exact', head: true }).limit(1);
                }).then(function () { return true; }).catch(function (err) {
                    if (!isMissing(err)) console.warn('[quotation-payments-repo] probe:', err && err.message);
                    return false;
                });
            }
            return probe;
        },

        async listForQuotation(quotationId) {
            if (quotationId == null) return [];
            var res = await run('quotationPayments.listForQuotation', function (c) {
                return c.from(TABLE).select(SELECT).eq('quotation_id', quotationId)
                    .order('paid_on', { ascending: false }).order('created_at', { ascending: false }).limit(200);
            });
            return res.data || [];
        },

        // Pagos del artista (más recientes primero). opts.quotationIds acota.
        async listForArtist(artistUserId, opts) {
            opts = opts || {};
            if (!artistUserId) return [];
            var res = await run('quotationPayments.listForArtist', function (c) {
                var q = c.from(TABLE).select(SELECT).eq('artist_user_id', artistUserId);
                if (Array.isArray(opts.quotationIds) && opts.quotationIds.length) q = q.in('quotation_id', opts.quotationIds.slice(0, 300));
                if (opts.since) q = q.gte('paid_on', opts.since);
                return q.order('paid_on', { ascending: false }).order('created_at', { ascending: false }).limit(opts.limit || 500);
            });
            return res.data || [];
        },

        // Cotizaciones en las que se puede registrar un pago (selector del modal).
        async listPayableQuotes(artistUserId) {
            if (!artistUserId) return [];
            var res = await run('quotationPayments.listPayableQuotes', function (c) {
                return c.from('quotations_db').select(QUOTE_SELECT).eq('artist_id', artistUserId)
                    .eq('is_archived', false).in('quote_status', PAYABLE)
                    .order('updated_at', { ascending: false }).limit(120);
            });
            return res.data || [];
        },

        async getQuote(quotationId) {
            var res = await run('quotationPayments.getQuote', function (c) {
                return c.from('quotations_db').select(QUOTE_SELECT).eq('id', quotationId).maybeSingle();
            });
            return res.data || null;
        },

        // Seña de la cotización manual (801:556): artist_manual_quotes enviadas.
        async manualQuotesFor(quoteIds) {
            var ids = (quoteIds || []).filter(Boolean).map(String);
            if (!ids.length) return [];
            var res = await run('quotationPayments.manualQuotesFor', function (c) {
                return c.from('artist_manual_quotes')
                    .select('quote_id, currency, total, deposit_pct, deposit_amount, status')
                    .in('quote_id', ids.slice(0, 200)).eq('status', 'sent');
            });
            return res.data || [];
        },

        // input: { quotationId, kind, method, amount, currency, paid_on, note, receipt? }
        async record(input) {
            var r = input.receipt || null;
            var res = await run('quotationPayments.record', function (c) {
                return c.rpc('record_quotation_payment', {
                    p_quotation_id: Number(input.quotationId),
                    p_kind: input.kind,
                    p_method: input.method,
                    p_amount: input.amount,
                    p_currency: input.currency,
                    p_paid_on: input.paid_on || null,
                    p_note: input.note || null,
                    p_receipt_path: r ? r.path : null,
                    p_receipt_name: r ? r.name : null,
                    p_receipt_mime: r ? r.mime : null,
                    p_receipt_size: r ? r.size : null
                });
            });
            var row = Array.isArray(res.data) ? res.data[0] : res.data;
            return row || null;
        },

        // Anula (borra) el pago y, si tenía comprobante, lo borra del bucket.
        async void(paymentId) {
            var res = await run('quotationPayments.void', function (c) {
                return c.rpc('void_quotation_payment', { p_payment_id: paymentId });
            });
            var out = res.data || {};
            if (out.receipt_path) await this.removeReceipt(out.receipt_path).catch(function () { /* best-effort */ });
            return out;
        },

        async uploadReceipt(artistUserId, quotationId, file) {
            var client = D.getClient();
            if (!client || !client.storage) throw new Error('No pudimos conectar con el almacenamiento.');
            var path = String(artistUserId) + '/' + String(quotationId) + '/' + newId() + '-' + safeFileName(file.name);
            var result = await client.storage.from(BUCKET).upload(path, file, {
                upsert: false, contentType: file.type || undefined, cacheControl: '3600'
            });
            if (result && result.error) {
                var msg = String(result.error.message || '');
                throw new Error(/no simulad/i.test(msg)
                    ? 'La subida de comprobantes no está disponible en esta vista previa.'
                    : 'No pudimos subir el comprobante. Probá de nuevo o guardá el pago sin él.');
            }
            return { path: path, name: String(file.name || 'comprobante').slice(0, 180), mime: file.type || null, size: file.size || null };
        },

        async removeReceipt(path) {
            var client = D.getClient();
            if (!client || !client.storage || !path) return;
            await client.storage.from(BUCKET).remove([path]);
        },

        async receiptUrl(path) {
            var client = D.getClient();
            if (!client || !client.storage) throw new Error('No pudimos conectar con el almacenamiento.');
            var result = await client.storage.from(BUCKET).createSignedUrl(path, 300);
            if (result.error || !result.data) throw new Error('No pudimos abrir el comprobante.');
            return result.data.signedUrl;
        }
    };

    D.QuotationPayments = QuotationPayments;
}(typeof window !== 'undefined' ? window : this));
