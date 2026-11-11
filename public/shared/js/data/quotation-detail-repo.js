/**
 * WE OTZI - Repositorio del expediente de cotización (frontend)
 * -------------------------------------------------------------
 * Figma final del flujo de artista (oct 2026) · área "cotizaciones-detalle".
 * Métodos con nombre sobre la capa PostgREST unificada (postgrest-client.js)
 * para /my-quotations/detail: búsqueda puntual de la cotización, updates que
 * degradan si la migración 20261028130000 todavía no está aplicada, notas de
 * trabajo con id devuelto, disputas y fotos de sesión (Storage privado).
 *
 * Carga: DESPUÉS de postgrest-client.js y quotations-repo.js.
 * Expone window.WeotziData.QuotationDetail.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[quotation-detail-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const run = D.run;

    // Columnas nuevas de la migración 20261028130000 (no aplicada): si el
    // backend no las conoce, el update se reintenta sin ellas.
    const OPTIONAL_QUOTE_COLUMNS = ['artist_session_minutes', 'artist_viewed_at'];
    const OPTIONAL_SESSION_COLUMNS = ['photo_urls'];
    const PHOTO_BUCKET = 'quotation-session-photos';

    function errorText(error) {
        const cause = error && error.cause;
        return [error && error.message, error && error.code, cause && cause.message, cause && cause.code, cause && cause.details, cause && cause.hint]
            .filter(Boolean).join(' ');
    }

    // Tabla/relación inexistente o no simulada en preview.
    function isMissingRelation(error) {
        return /PGRST205|PGRST200|42P01|PREVIEW_UNSUPPORTED|does not exist|schema cache|No simulado|not found/i.test(errorText(error));
    }

    // Columna desconocida para PostgREST (PGRST204) o Postgres (42703).
    function isMissingColumn(error, column) {
        const text = errorText(error);
        return /PGRST204|42703|column/i.test(text) && (!column || text.indexOf(column) !== -1);
    }

    function without(patch, columns) {
        const copy = Object.assign({}, patch);
        columns.forEach((column) => { delete copy[column]; });
        return copy;
    }

    async function updateWithFallback(label, table, id, patch, optional) {
        try {
            await run(label, (c) => c.from(table).update(patch).eq('id', id));
            return { patch, dropped: [] };
        } catch (error) {
            const dropped = optional.filter((column) => column in patch && isMissingColumn(error, column));
            const anyOptional = optional.some((column) => column in patch);
            if (!dropped.length && !(anyOptional && isMissingColumn(error))) throw error;
            const removed = dropped.length ? dropped : optional.filter((column) => column in patch);
            const reduced = without(patch, removed);
            if (Object.keys(reduced).length) {
                await run(label + '.fallback', (c) => c.from(table).update(reduced).eq('id', id));
            }
            return { patch: reduced, dropped: removed };
        }
    }

    const QuotationDetail = {
        isMissingRelation,

        // Cotización del artista por id numérico o por quote_id (texto).
        async findForArtist(artistUserId, identifier) {
            const value = String(identifier || '').trim();
            if (!value) return null;
            const { data } = await run('quotationDetail.findForArtist', (c) => {
                let q = c.from('quotations_db').select('*').eq('artist_id', artistUserId);
                q = /^\d+$/.test(value) ? q.eq('id', Number(value)) : q.eq('quote_id', value);
                return q.limit(1);
            });
            return Array.isArray(data) ? (data[0] || null) : (data || null);
        },

        // Update de quotations_db que tolera la ausencia de columnas nuevas.
        // Devuelve { patch, dropped } con lo que efectivamente se guardó.
        updateQuote(id, patch) {
            return updateWithFallback('quotationDetail.updateQuote', 'quotations_db', id, patch, OPTIONAL_QUOTE_COLUMNS);
        },

        updateSession(id, patch) {
            return updateWithFallback('quotationDetail.updateSession', 'quotation_sessions', id, patch, OPTIONAL_SESSION_COLUMNS);
        },

        // Alta de sesión; si photo_urls no existe en el backend, reintenta sin ella.
        // El número lo asigna el trigger trg_set_quotation_session_number; si la
        // fila vuelve sin número (backend sin trigger, preview), se completa acá.
        async createSession(session) {
            let row;
            try {
                row = await D.Sessions.create(session);
            } catch (error) {
                if (!('photo_urls' in session) || !isMissingColumn(error, 'photo_urls')) throw error;
                row = await D.Sessions.create(without(session, ['photo_urls']));
            }
            if (row && row.id != null && (row.session_number == null || row.session_number <= 0)) {
                try {
                    const all = await D.Sessions.listForQuote(session.quotation_id);
                    const max = (all || []).reduce((m, s) => (String(s.id) === String(row.id) ? m : Math.max(m, Number(s.session_number) || 0)), 0);
                    await D.Sessions.update(row.id, { session_number: max + 1 });
                    row.session_number = max + 1;
                } catch (_) { /* el orden por fecha sigue funcionando */ }
            }
            return row;
        },

        // ---------------- notas de trabajo (quotation_notes) ----------------
        // Igual que WeotziData.Notes.create pero devuelve la fila (con su id)
        // para que el autoguardado siga actualizando la misma nota.
        async createNote(note) {
            const { data } = await run('quotationDetail.createNote', (c) =>
                c.from('quotation_notes').insert([note]).select().maybeSingle()
            );
            return data || null;
        },

        // ---------------- disputas (quotation_disputes) ----------------
        // { available, rows }: available=false si la tabla no existe todavía.
        async listDisputes(quotationId) {
            try {
                const { data } = await run('quotationDetail.listDisputes', (c) =>
                    c.from('quotation_disputes').select('*').eq('quotation_id', quotationId).order('created_at', { ascending: false })
                );
                return { available: true, rows: data || [] };
            } catch (error) {
                if (isMissingRelation(error)) return { available: false, rows: [] };
                throw error;
            }
        },

        async respondDispute(disputeId, response) {
            const { data } = await run('quotationDetail.respondDispute', (c) =>
                c.from('quotation_disputes')
                    .update({ artist_response: response, artist_responded_at: new Date().toISOString() })
                    .eq('id', disputeId)
                    .select()
                    .maybeSingle()
            );
            return data || null;
        },

        // ---------------- fotos de sesión (Storage privado) ----------------
        async uploadSessionPhoto(file, { artistId, quotationId, sessionId }) {
            const client = D.getClient();
            if (!client || !client.storage) throw new Error('Storage no disponible.');
            const safe = String(file && file.name || 'foto').normalize('NFD').replace(/[̀-ͯ]/g, '')
                .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'foto';
            const path = `${artistId}/${quotationId}/${sessionId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
            const { error } = await client.storage.from(PHOTO_BUCKET).upload(path, file, {
                cacheControl: '3600', upsert: false, contentType: file.type || undefined,
            });
            if (error) throw Object.assign(new Error(error.message || 'No se pudo subir la foto.'), { cause: error });
            return path;
        },

        // URL visible de una foto: absolutas/relativas tal cual; rutas del
        // bucket privado → URL firmada (null si no se puede firmar).
        async photoUrl(value) {
            const raw = String(value || '');
            if (!raw) return null;
            if (/^(https?:|data:|blob:|\/)/i.test(raw)) return raw;
            const client = D.getClient();
            if (!client || !client.storage) return null;
            try {
                const { data, error } = await client.storage.from(PHOTO_BUCKET).createSignedUrl(raw, 3600);
                return error ? null : (data && data.signedUrl) || null;
            } catch (_) {
                return null;
            }
        },
    };

    D.QuotationDetail = QuotationDetail;
})();
