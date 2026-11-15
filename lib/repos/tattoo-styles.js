'use strict';

// Repositorio TattooStyles (servidor) sobre la capa PostgREST unificada.
// Catálogo público de estilos del cotizador (tabla tattoo_styles: estilos raíz
// + subestilos por parent_id). Lectura pública → anon key (respeta RLS).

const { pgrest } = require('../postgrest');

const STYLE_COLS = 'id,name,slug,parent_id,sort_order';

// Filas planas → estilos raíz con `substyles`, en el orden del catálogo.
function buildTree(rows) {
    const list = (Array.isArray(rows) ? rows : []).filter((row) => row && row.id && row.name);
    const byId = new Map(list.map((row) => [row.id, {
        id: row.id,
        name: row.name,
        slug: row.slug || '',
        sort_order: Number(row.sort_order) || 0,
        substyles: []
    }]));
    const roots = [];
    list.forEach((row) => {
        const node = byId.get(row.id);
        if (row.parent_id && byId.has(row.parent_id)) byId.get(row.parent_id).substyles.push(node);
        else if (!row.parent_id) roots.push(node);
    });
    const bySort = (a, b) => a.sort_order - b.sort_order;
    roots.forEach((root) => root.substyles.sort(bySort));
    return roots.sort(bySort);
}

const TattooStylesRepo = {
    // Catálogo completo como árbol (raíces con sus subestilos).
    async listTree({ query = pgrest } = {}) {
        const rows = await query('tattoo_styles', { key: 'anon' })
            .select(STYLE_COLS)
            .order('sort_order', { ascending: true })
            .limit(1000)
            .execute();
        return buildTree(rows);
    }
};

module.exports = { TattooStylesRepo, buildTree, STYLE_COLS };
