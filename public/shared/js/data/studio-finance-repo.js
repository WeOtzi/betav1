/**
 * WE OTZI - Repositorio de Finanzas de estudio (frontend)
 * -------------------------------------------------------
 * Metodos con nombre sobre la capa PostgREST unificada (postgrest-client.js)
 * para el libro de gastos e ingresos del estudio
 * (docs/plans/2026-10-30-estudios-plataforma.md, M4).
 *
 * Tablas: studio_finance_entries (dueno/soporte: SELECT, INSERT, UPDATE; sin
 * DELETE: anular es un UPDATE a 'voided'), con embeds de studio_suppliers y
 * studio_locations. Vista: studio_finance_monthly_by_category (solo filas
 * 'recorded').
 *
 * Contrato: igual que studios-repo.js. Son WRAPPERS FINOS que devuelven el
 * builder sin resolver (`{ data, error }`) y nunca lanzan. Las lecturas que
 * corren al cargar la pantalla tragan la "migracion pendiente" y devuelven
 * `{ data: [], error: null, unavailable: true }`.
 *
 * Carga: DESPUES de postgrest-client.js. Expone window.WeotziData.StudioFinance.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.from !== 'function') {
        console.error('[studio-finance-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const from = D.from;

    // Codigos de "falta aplicar una migracion" (Reglas transversales §5).
    const MISSING_SCHEMA_CODES = ['PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', '42703', '42883', '42P01'];
    function isMissingSchema(error) {
        if (!error) return false;
        return MISSING_SCHEMA_CODES.indexOf(String(error.code || (error.cause && error.cause.code) || '')) !== -1;
    }
    function guard(build) {
        try {
            return build();
        } catch (error) {
            return Promise.resolve({ data: null, error });
        }
    }
    async function settle(build) {
        try {
            const result = await build();
            return result || { data: null, error: null };
        } catch (error) {
            return { data: null, error };
        }
    }
    async function soft(build, empty) {
        const result = await settle(build);
        if (result.error && isMissingSchema(result.error)) return { data: empty, error: null, unavailable: true };
        return result;
    }
    async function allRows(buildQuery) {
        const rows = [];
        for (let offset = 0; ; offset += 500) {
            const result = await buildQuery().range(offset, offset + 499);
            if (result.error) return result;
            rows.push(...(result.data || []));
            if ((result.data || []).length < 500) return { data: rows, error: null };
        }
    }
    // string -> eq, array -> in, vacio -> sin filtro.
    function byValue(query, column, value) {
        if (Array.isArray(value)) return value.length ? query.in(column, value) : query;
        return value ? query.eq(column, value) : query;
    }
    function monthStart(value) {
        const text = String(value || '');
        return /^\d{4}-\d{2}/.test(text) ? `${text.slice(0, 7)}-01` : value;
    }

    // Columnas que el estudio puede escribir. supply_order_id, status,
    // voided_*, created_by_user_id y las fechas las maneja el servidor (guard
    // private.guard_finance_entry_write); studio_id solo al crear.
    const EDITABLE = [
        'location_id', 'entry_type', 'category', 'description', 'amount', 'currency', 'occurred_on',
        'payment_method', 'counterparty', 'supplier_id', 'membership_id', 'artist_user_id', 'receipt_storage_path',
    ];
    function pick(obj, keys) {
        const out = {};
        for (const key of keys) {
            if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined) out[key] = obj[key];
        }
        return out;
    }

    const StudioFinance = {
        // Libro del estudio. from/to: 'YYYY-MM-DD' sobre occurred_on; type:
        // 'expense' | 'income'; category: string o array; includeVoided
        // false => solo 'recorded'. Paginado con allRows.
        listEntries(studioId, { from: fromDate = null, to: toDate = null, type = null, category = null, includeVoided = false } = {}) {
            return soft(() => allRows(() => {
                let query = from('studio_finance_entries')
                    .select('*, studio_suppliers ( id, name ), studio_locations ( id, label )')
                    .eq('studio_id', studioId);
                if (fromDate) query = query.gte('occurred_on', fromDate);
                if (toDate) query = query.lte('occurred_on', toDate);
                query = byValue(query, 'entry_type', type);
                query = byValue(query, 'category', category);
                if (!includeVoided) query = query.eq('status', 'recorded');
                return query
                    .order('occurred_on', { ascending: false })
                    .order('created_at', { ascending: false })
                    .order('id');
            }), []);
        },

        // Crea (sin obj.id; exige obj.studio_id) o edita un movimiento. Solo
        // envia las columnas editables. Devuelve la fila. .select().single().
        saveEntry(obj) {
            const entry = obj || {};
            const payload = pick(entry, EDITABLE);
            if (entry.id) {
                return guard(() => from('studio_finance_entries').update(payload).eq('id', entry.id).select().single());
            }
            return guard(() => from('studio_finance_entries')
                .insert({ ...payload, studio_id: entry.studio_id })
                .select()
                .single());
        },

        // Anula un movimiento registrado (las filas voided no se editan).
        voidEntry(id, reason) {
            return guard(() => from('studio_finance_entries')
                .update({ status: 'voided', voided_at: new Date().toISOString(), void_reason: reason || null })
                .eq('id', id)
                .eq('status', 'recorded')
                .select()
                .single());
        },

        // Totales por mes, moneda, tipo y categoria (from/to 'YYYY-MM-DD'; el
        // inicio se lleva al dia 1 de su mes).
        monthlyByCategory(studioId, fromDate, toDate) {
            return soft(() => allRows(() => {
                let query = from('studio_finance_monthly_by_category').select('*').eq('studio_id', studioId);
                if (fromDate) query = query.gte('month', monthStart(fromDate));
                if (toDate) query = query.lte('month', toDate);
                return query.order('month').order('currency').order('entry_type').order('category');
            }), []);
        },
    };

    D.StudioFinance = StudioFinance;
})();
