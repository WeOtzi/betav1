'use strict';

// Repositorio Currencies (servidor) sobre la capa PostgREST unificada.
// Reemplaza los fetch('/rest/v1/currencies') y fetch('/rest/v1/currency_refresh_logs')
// inline de los endpoints GET /api/currencies y POST /api/admin/currencies/*.
//
// Auth por sitio (igual que el codigo previo):
//   - list(): ANON key (lectura publica, respeta RLS).
//   - upsertRates()/logRefresh(): SERVICE-ROLE (cron/backoffice, salta RLS).

const { pgrest } = require('../postgrest');

const CURRENCY_LIST_COLS =
    'code,name,symbol,decimals,units_per_usd,units_per_eur,is_active,last_updated_at,source';

const CurrenciesRepo = {
    // Lista publica de monedas activas (anon key, respeta RLS).
    listActive() {
        return pgrest('currencies', { key: 'anon' })
            .select(CURRENCY_LIST_COLS)
            .eq('is_active', true)
            .order('code', { ascending: true })
            .execute();
    },

    // Upsert masivo de tasas (service-role). on_conflict=code.
    // returning=true => devuelve las filas (para contar); false => return=minimal.
    upsertRates(rows, { returning = true } = {}) {
        return pgrest('currencies').upsert(rows, { onConflict: 'code', returning });
    },

    // Audit log de refresh (service-role, best-effort). return=minimal.
    logRefresh(entry) {
        return pgrest('currency_refresh_logs').insert(entry, { returning: false });
    },
};

module.exports = { CurrenciesRepo };
