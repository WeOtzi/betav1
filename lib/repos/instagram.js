'use strict';

// Repositorio Instagram imports (servidor) sobre la capa PostgREST unificada.
// Reemplaza los fetch('/rest/v1/instagram_imports') inline del endpoint
// GET /api/admin/integrations/apify/stats. SERVICE-ROLE (vista global, salta
// RLS); la autorizacion (admin) la hace el endpoint antes de llamar.
//
// Nota de implementacion: los conteos antes usaban HEAD + Prefer:count=exact y
// leian content-range. La capa unificada hace el conteo con GET +
// count('exact') + range(0,0): el header content-range y por ende el total es
// identico (a lo sumo trae 1 fila). Se preserva el fallback a 0 ante error.

const { pgrest } = require('../postgrest');

const TABLE = 'instagram_imports';

// Conteo exacto de filas que cumplen `applyFilters` (callback que recibe el
// query builder y le encadena filtros). range(0,0) evita traer todas las filas.
async function _count(applyFilters) {
    try {
        let q = pgrest(TABLE).select('id').count('exact').range(0, 0);
        if (applyFilters) q = applyFilters(q) || q;
        const { count } = await q.execute();
        return Number.isFinite(count) ? count : 0;
    } catch (_) {
        return 0;
    }
}

const InstagramRepo = {
    // Cantidad de imports con created_at >= sinceIso.
    countSince(sinceIso) {
        return _count((q) => q.gte('created_at', sinceIso));
    },

    // Cantidad total de imports (antes: id=not.is.null; id es PK no-nula, asi
    // que un conteo sin filtro da el mismo total).
    countTotal() {
        return _count(null);
    },

    // Suma client-side del costo estimado (los selectores agregados de PostgREST
    // son inconsistentes entre versiones). Fallback a 0 ante error.
    async sumCost() {
        try {
            const rows = await pgrest(TABLE).select('cost_estimate_usd').execute();
            if (!Array.isArray(rows)) return 0;
            return rows.reduce((s, r) => s + (Number(r.cost_estimate_usd) || 0), 0);
        } catch (_) {
            return 0;
        }
    },

    // Ultimos 10 imports para la tarjeta de actividad reciente.
    async recent() {
        try {
            const rows = await pgrest(TABLE)
                .select('id,ig_handle,target,imported_fields,cost_estimate_usd,created_at')
                .order('created_at', { ascending: false })
                .limit(10)
                .execute();
            return Array.isArray(rows) ? rows : [];
        } catch (_) {
            return [];
        }
    },

    // Imports desde sinceIso (asc) para el strip diario de 14 dias.
    async sinceForDailyBreakdown(sinceIso) {
        try {
            const rows = await pgrest(TABLE)
                .select('created_at,cost_estimate_usd')
                .gte('created_at', sinceIso)
                .order('created_at', { ascending: true })
                .execute();
            return Array.isArray(rows) ? rows : [];
        } catch (_) {
            return [];
        }
    },
};

module.exports = { InstagramRepo };
