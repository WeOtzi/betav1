// ============================================
// Studio Dashboard — Materiales por artista (pestaña Inventario)
//
// Se monta en #inventory-materials con WeOtziStudioAdmin.register('inventory').
// Contrato: docs/plans/2026-10-30-estudios-plataforma.md → Módulos → Inventario.
//
//   - Balance por artista e ítem: vista studio_artist_material_balance (M3,
//     20261030202000_studio_agenda_inventory) vía StudioOps.listMaterialBalance.
//   - "Entregar materiales": modal con varias líneas (varios ítems para un
//     artista). Todas las líneas van en UN solo INSERT de movimientos
//     'assignment' (StudioOps.createInventoryMovement con un array): o se
//     registran todas o ninguna. Los triggers de M3 validan artista activo y
//     stock por fila; como los AFTER que descuentan stock corren al final de
//     la sentencia, el mismo ítem no puede repetirse en dos líneas.
//   - "Registrar devolución": ítems que el artista tiene → movimientos
//     'return', con el costo promedio de lo entregado.
//   - CSV del balance (kit.downloadCsv: BOM + ';').
//
// Sin M3 la vista no existe (listMaterialBalance devuelve `unavailable`): la
// sección muestra el aviso de migración pendiente y no ofrece acciones.
//
// Eventos en `document`: despacha y escucha 'weotzi:studio-inventory-changed'
// ({detail: {source}}) para que Stock (studio-dashboard-ops.js) y Materiales
// se refresquen entre sí.
//
// Las funciones puras se exportan a Node (module.exports) para los tests.
// ============================================

(function (root) {
    'use strict';

    const TAB = 'inventory';
    const SOURCE = 'materials';
    const INVENTORY_CHANGED_EVENT = 'weotzi:studio-inventory-changed';
    const MAX_LINES = 30;
    const MIGRATION_PENDING = 'Esta función todavía no está disponible (falta aplicar una migración).';
    const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

    // -------------------------------------------------------------
    // Helpers puros
    // -------------------------------------------------------------
    function toNum(value) {
        if (value == null || value === '' || typeof value === 'boolean') return null;
        const n = Number(String(value).trim().replace(',', '.'));
        return Number.isFinite(n) ? n : null;
    }
    // Cantidades con 3 decimales (numeric(10,3)) sin ruido de coma flotante.
    function roundQty(n) { return Math.round(Number(n) * 1000) / 1000; }
    function fmtQty(value) {
        const n = Number(value);
        if (value == null || !Number.isFinite(n)) return '—';
        return n.toLocaleString('es-AR', { maximumFractionDigits: 3 });
    }
    function unitSuffix(unit) { return unit ? ' ' + unit : ''; }
    function currencyOf(value) {
        const code = String(value || '').trim().toUpperCase();
        return /^[A-Z]{3}$/.test(code) ? code : 'USD';
    }

    // Costo unitario promedio de lo que el artista todavía tiene entregado
    // (assigned_cost / net_assigned_qty), a centavos. Sin saldo o sin costo,
    // el fallback.
    function outstandingUnitCost(row, fallback) {
        const net = Number(row && row.net_assigned_qty);
        const cost = Number(row && row.assigned_cost);
        if (net > 0 && Number.isFinite(cost) && cost > 0) return Math.round((cost / net) * 100) / 100;
        return fallback == null ? null : fallback;
    }

    function artistName(names, id) {
        if (!id) return 'Artista';
        if (names && typeof names.get === 'function') return names.get(id) || 'Artista';
        return (names && names[id]) || 'Artista';
    }

    // Filas de la vista + nombre del artista, ordenadas por artista e ítem.
    // opts: {artistId, pendingOnly}.
    function filterBalance(rows, names, opts) {
        const o = opts || {};
        return (Array.isArray(rows) ? rows : [])
            .filter(row => row && row.artist_user_id)
            .filter(row => !o.artistId || row.artist_user_id === o.artistId)
            .filter(row => !o.pendingOnly || Number(row.net_assigned_qty) > 0)
            .map(row => ({ ...row, artist_name: artistName(names, row.artist_user_id) }))
            .sort((a, b) => a.artist_name.localeCompare(b.artist_name, 'es') || String(a.item_name || '').localeCompare(String(b.item_name || ''), 'es'));
    }

    // Resumen por artista: ítems con saldo, costo neto por moneda y último
    // movimiento. → [{artist_user_id, artist_name, pending_items, items, cost: {CUR: n}, last_movement_at}]
    function summarizeByArtist(rows, names) {
        const byArtist = new Map();
        (Array.isArray(rows) ? rows : []).forEach(row => {
            if (!row || !row.artist_user_id) return;
            const entry = byArtist.get(row.artist_user_id) || {
                artist_user_id: row.artist_user_id,
                artist_name: artistName(names, row.artist_user_id),
                pending_items: 0,
                items: 0,
                cost: {},
                last_movement_at: null
            };
            entry.items += 1;
            if (Number(row.net_assigned_qty) > 0) entry.pending_items += 1;
            const cost = toNum(row.assigned_cost);
            if (cost) {
                const cur = currencyOf(row.currency);
                entry.cost[cur] = Math.round(((entry.cost[cur] || 0) + cost) * 100) / 100;
            }
            if (row.last_movement_at && (!entry.last_movement_at || new Date(row.last_movement_at) > new Date(entry.last_movement_at))) {
                entry.last_movement_at = row.last_movement_at;
            }
            byArtist.set(row.artist_user_id, entry);
        });
        return Array.from(byArtist.values()).sort((a, b) => a.artist_name.localeCompare(b.artist_name, 'es'));
    }

    // Costo total estimado de una entrega por moneda: cantidad × costo de la
    // línea (o el cost_per_unit del ítem si la línea no lo trae).
    function deliveryTotals(lines, items) {
        const byId = new Map((Array.isArray(items) ? items : []).map(item => [item.id, item]));
        const cents = {};
        (Array.isArray(lines) ? lines : []).forEach(line => {
            const item = byId.get(line && line.itemId);
            const qty = toNum(line && line.quantity);
            if (!item || !qty || qty <= 0) return;
            const cost = toNum(line.cost) != null ? toNum(line.cost) : toNum(item.cost_per_unit);
            if (cost == null) return;
            const cur = currencyOf(item.currency);
            cents[cur] = (cents[cur] || 0) + Math.round(qty * cost * 100);
        });
        const out = {};
        Object.keys(cents).sort().forEach(cur => { out[cur] = cents[cur] / 100; });
        return out;
    }

    function checkWhen(performedAt, now) {
        if (performedAt == null || performedAt === '') return null;
        const when = new Date(performedAt);
        if (Number.isNaN(when.getTime())) throw new Error('Revisá la fecha.');
        const ref = now ? new Date(now) : new Date();
        if (when.getTime() > ref.getTime() + FUTURE_TOLERANCE_MS) throw new Error('La fecha no puede ser futura.');
        return when.toISOString();
    }
    function cleanNotes(notes) {
        const text = String(notes == null ? '' : notes).trim();
        return text ? text.slice(0, 500) : null;
    }

    // Entrega multi-línea → filas 'assignment' para un único INSERT.
    // input: {artistId, lines: [{itemId, quantity, cost}], performedAt (ISO), notes}
    // ctx: {studioId, items (inventario activo), activeArtistIds, now}
    // Lanza Error con el mensaje para el usuario.
    function buildDeliveryRows(input, ctx) {
        const i = input || {};
        const c = ctx || {};
        const artistId = String(i.artistId || '').trim();
        if (!artistId) throw new Error('Elegí a qué artista le entregás los materiales.');
        if (Array.isArray(c.activeArtistIds) && !c.activeArtistIds.includes(artistId)) {
            throw new Error('Solo podés entregar materiales a artistas activos del estudio.');
        }
        const items = new Map((Array.isArray(c.items) ? c.items : []).map(item => [item.id, item]));
        const lines = (Array.isArray(i.lines) ? i.lines : [])
            .map((line, index) => ({ ...line, n: index + 1 }))
            .filter(line => String(line.itemId || '').trim() || String(line.quantity == null ? '' : line.quantity).trim());
        if (!lines.length) throw new Error('Agregá al menos un ítem con su cantidad.');
        if (lines.length > MAX_LINES) throw new Error('Podés registrar hasta ' + MAX_LINES + ' ítems por entrega.');
        const performedAt = checkWhen(i.performedAt, c.now);
        const notes = cleanNotes(i.notes);
        const seen = new Set();
        return lines.map(line => {
            const itemId = String(line.itemId || '').trim();
            if (!itemId) throw new Error('Elegí el ítem de la línea ' + line.n + '.');
            const item = items.get(itemId);
            if (!item) throw new Error('El ítem de la línea ' + line.n + ' ya no está en el inventario.');
            if (seen.has(itemId)) throw new Error('Repetiste ' + (item.name || 'un ítem') + ' en la línea ' + line.n + ': sumá las cantidades en una sola línea.');
            seen.add(itemId);
            const quantity = toNum(line.quantity);
            if (quantity == null || quantity <= 0) throw new Error('Ingresá una cantidad mayor a 0 en la línea ' + line.n + '.');
            const stock = toNum(item.quantity_on_hand);
            if (stock != null && roundQty(quantity) > roundQty(stock)) {
                throw new Error('No hay stock suficiente de ' + (item.name || 'ese ítem') + ': quedan ' + fmtQty(Math.max(stock, 0)) + unitSuffix(item.unit) + '.');
            }
            const cost = toNum(line.cost);
            if (cost != null && cost < 0) throw new Error('El costo unitario de la línea ' + line.n + ' no puede ser negativo.');
            const row = {
                item_id: itemId,
                studio_id: c.studioId,
                kind: 'assignment',
                quantity: roundQty(quantity),
                related_artist_user_id: artistId,
                // null → el trigger de M3 completa el cost_per_unit del ítem.
                unit_cost: cost == null ? null : Math.round(cost * 100) / 100,
                notes
            };
            if (performedAt) row.performed_at = performedAt;
            return row;
        });
    }

    // Devolución → filas 'return'. Solo ítems que el artista tiene.
    // input: {artistId, lines: [{itemId, quantity}], performedAt, notes}
    // ctx: {studioId, balanceRows (de la vista), now}
    function buildReturnRows(input, ctx) {
        const i = input || {};
        const c = ctx || {};
        const artistId = String(i.artistId || '').trim();
        if (!artistId) throw new Error('Elegí qué artista devuelve los materiales.');
        const holdings = new Map((Array.isArray(c.balanceRows) ? c.balanceRows : [])
            .filter(row => row.artist_user_id === artistId && Number(row.net_assigned_qty) > 0)
            .map(row => [row.item_id, row]));
        const lines = (Array.isArray(i.lines) ? i.lines : [])
            .filter(line => line && String(line.quantity == null ? '' : line.quantity).trim() !== '' && toNum(line.quantity) !== 0);
        if (!lines.length) throw new Error('Indicá cuánto devuelve de al menos un ítem.');
        const performedAt = checkWhen(i.performedAt, c.now);
        const notes = cleanNotes(i.notes);
        const seen = new Set();
        return lines.map(line => {
            const itemId = String(line.itemId || '').trim();
            const held = holdings.get(itemId);
            const name = (held && held.item_name) || line.itemName || 'ese ítem';
            if (!held) throw new Error('Ese artista no tiene ' + name + ' por devolver.');
            if (seen.has(itemId)) throw new Error('Repetiste ' + name + ': sumá las cantidades en una sola línea.');
            seen.add(itemId);
            const quantity = toNum(line.quantity);
            if (quantity == null || quantity <= 0) throw new Error('La cantidad a devolver de ' + name + ' tiene que ser mayor a 0.');
            if (roundQty(quantity) > roundQty(held.net_assigned_qty)) {
                throw new Error('La devolución de ' + name + ' supera lo entregado: quedan ' + fmtQty(held.net_assigned_qty) + unitSuffix(held.unit) + ' por devolver.');
            }
            const row = {
                item_id: itemId,
                studio_id: c.studioId,
                kind: 'return',
                quantity: roundQty(quantity),
                related_artist_user_id: artistId,
                unit_cost: outstandingUnitCost(held, null),
                notes
            };
            if (performedAt) row.performed_at = performedAt;
            return row;
        });
    }

    // Sin M3, el CHECK vivo de kind rechaza 'assignment'/'return'.
    function saveError(error, kit) {
        const text = String((error && error.message) || '') + ' ' + String((error && error.details) || '');
        if (/studio_inventory_movements_kind_check|studio_inventory_movements_artist_required/.test(text)) return new Error(MIGRATION_PENDING);
        const message = kit && typeof kit.friendlyError === 'function' ? kit.friendlyError(error) : ((error && error.message) || '');
        return new Error(message || 'No pudimos registrar el movimiento. Intentá nuevamente.');
    }

    function csvColumns() {
        return [
            { label: 'Artista', key: 'artist_name' },
            { label: 'Ítem', key: 'item_name' },
            { label: 'Unidad', key: 'unit' },
            { label: 'Entregado', value: row => toNum(row.assigned_qty) },
            { label: 'Devuelto', value: row => toNum(row.returned_qty) },
            { label: 'En poder del artista', value: row => toNum(row.net_assigned_qty) },
            { label: 'Consumo registrado', value: row => toNum(row.consumed_qty) },
            { label: 'Costo neto entregado', value: row => toNum(row.assigned_cost) },
            { label: 'Moneda', value: row => currencyOf(row.currency) },
            { label: 'Último movimiento', value: row => (row.last_movement_at ? new Date(row.last_movement_at) : null) }
        ];
    }
    function csvFilename(studio, now) {
        const d = now ? new Date(now) : new Date();
        const pad = n => String(n).padStart(2, '0');
        const slug = String((studio && (studio.slug || studio.name)) || 'estudio').toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'estudio';
        return 'materiales-' + slug + '-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.csv';
    }

    const pure = {
        outstandingUnitCost, filterBalance, summarizeByArtist, deliveryTotals,
        buildDeliveryRows, buildReturnRows, saveError, csvColumns, csvFilename, fmtQty, MAX_LINES
    };
    if (typeof module === 'object' && module && module.exports) module.exports = pure;

    // -------------------------------------------------------------
    // Módulo (navegador)
    // -------------------------------------------------------------
    const admin = root && root.WeOtziStudioAdmin;
    if (!admin || typeof admin.register !== 'function') {
        if (root && root.document) console.warn('[materials] falta WeOtziStudioAdmin: cargá studio-dashboard.js antes.');
        return;
    }

    function getDoc() { return (root && root.document) || (typeof document !== 'undefined' ? document : null); }
    function emitChanged(detail) {
        const doc = getDoc();
        const Ctor = (root && root.CustomEvent) || (typeof CustomEvent === 'function' ? CustomEvent : null);
        if (!doc || typeof doc.dispatchEvent !== 'function' || typeof Ctor !== 'function') return;
        doc.dispatchEvent(new Ctor(INVENTORY_CHANGED_EVENT, { detail: { source: SOURCE, ...detail } }));
    }

    const state = {
        root: null,
        ctx: null,
        rows: [],
        names: new Map(),
        members: [],
        unavailable: false,
        error: null,
        loaded: false,
        filter: { artistId: '', pendingOnly: true },
        seq: 0
    };

    function kitOf(ctx) { return (ctx && ctx.kit) || (root && root.WeOtziStudioKit); }
    function dataOf(ctx) { return (ctx && ctx.data) || (root && root.WeotziData) || {}; }

    // Nombres por user_id: roster activo y, para ex integrantes que todavía
    // tienen material, artists_db por id. Nunca lanza.
    async function resolveNames(data, members, ids) {
        const names = new Map();
        (members || []).forEach(m => {
            const id = (m.artists_db && m.artists_db.user_id) || m.artist_user_id;
            if (id) names.set(id, (m.artists_db && (m.artists_db.name || m.artists_db.username)) || 'Artista');
        });
        const missing = Array.from(new Set((ids || []).filter(id => id && !names.has(id))));
        if (missing.length && data.Artists && typeof data.Artists.listByUserIds === 'function') {
            try {
                const res = await data.Artists.listByUserIds(missing, 'user_id, name, username');
                ((res && res.data) || []).forEach(a => names.set(a.user_id, a.name || a.username || 'Artista'));
            } catch (_) { /* quedan como "Artista" */ }
        }
        return names;
    }

    function sectionHtml() {
        return `
            <section class="sk-section studio-materials" aria-labelledby="materials-title">
                <div class="sk-section-head">
                    <div>
                        <p class="studio-section-kicker">Materiales</p>
                        <h2 class="sk-section-title" id="materials-title">Materiales por artista</h2>
                        <p class="studio-help">Lo que entregás a cada artista sale del stock y lo que devuelve vuelve a entrar. Cada entrega guarda su costo.</p>
                    </div>
                    <div class="sk-row-actions">
                        <button type="button" class="studio-btn studio-btn-primary" data-materials-action="deliver">Entregar materiales</button>
                        <button type="button" class="studio-btn" data-materials-action="return">Registrar devolución</button>
                        <button type="button" class="studio-btn studio-btn-ghost" data-materials-action="csv">Exportar CSV</button>
                    </div>
                </div>
                <div class="sk-toolbar">
                    <div class="sk-field">
                        <label for="materials-artist-filter">Artista</label>
                        <select id="materials-artist-filter" data-materials-filter="artist"><option value="">Todos los artistas</option></select>
                    </div>
                    <label class="sk-field sk-field--inline"><input type="checkbox" data-materials-filter="pending" checked> Solo con material pendiente de devolver</label>
                </div>
                <div data-materials-body aria-live="polite"><p class="studio-help">Cargando materiales…</p></div>
            </section>`;
    }

    function q(sel) { return state.root && typeof state.root.querySelector === 'function' ? state.root.querySelector(sel) : null; }

    function setActionsEnabled(enabled) {
        if (!state.root || typeof state.root.querySelectorAll !== 'function') return;
        Array.from(state.root.querySelectorAll('[data-materials-action]')).forEach(btn => {
            btn.disabled = !enabled;
            if (enabled) btn.removeAttribute('title');
            else btn.setAttribute('title', MIGRATION_PENDING);
        });
    }

    function renderFilterOptions(kit) {
        const select = q('[data-materials-filter="artist"]');
        if (!select) return;
        const ids = new Set(state.rows.map(row => row.artist_user_id).filter(Boolean));
        const options = Array.from(ids).map(id => ({ id, name: artistName(state.names, id) }))
            .sort((a, b) => a.name.localeCompare(b.name, 'es'));
        if (state.filter.artistId && !ids.has(state.filter.artistId)) options.push({ id: state.filter.artistId, name: artistName(state.names, state.filter.artistId) });
        select.innerHTML = '<option value="">Todos los artistas</option>' + options.map(o =>
            '<option value="' + kit.escapeAttr(o.id) + '"' + (o.id === state.filter.artistId ? ' selected' : '') + '>' + kit.escapeHtml(o.name) + '</option>').join('');
    }

    function qtyCell(kit, value, unit) {
        return '<span class="sk-num">' + kit.escapeHtml(fmtQty(value) + unitSuffix(unit)) + '</span>';
    }

    function bodyHtml(kit) {
        if (state.unavailable) {
            return kit.emptyState({ title: 'Materiales por artista', body: MIGRATION_PENDING, compact: true });
        }
        if (state.error) {
            return '<div class="studio-status studio-status-error" role="alert">' + kit.escapeHtml(kit.friendlyError(state.error, 'No pudimos cargar los materiales.')) + '</div>'
                + '<p><button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-materials-action="reload">Reintentar</button></p>';
        }
        if (!state.rows.length) {
            return kit.emptyState({
                title: 'Todavía no entregaste materiales',
                body: 'Registrá lo que le das a cada artista (tintas, agujas, guantes…) para saber qué tiene en su poder y cuánto cuesta.',
                actionHtml: '<button type="button" class="studio-btn studio-btn-primary" data-materials-action="deliver">Entregar materiales</button>'
            });
        }
        const detail = filterBalance(state.rows, state.names, state.filter);
        const scope = state.filter.artistId ? state.rows.filter(row => row.artist_user_id === state.filter.artistId) : state.rows;
        const summary = summarizeByArtist(scope, state.names);
        const pendingRows = scope.filter(row => Number(row.net_assigned_qty) > 0);
        const holders = new Set(pendingRows.map(row => row.artist_user_id));
        const totalCost = kit.sumByCurrency(scope, 'assigned_cost', 'currency');
        const activeIds = new Set(state.members.map(m => (m.artists_db && m.artists_db.user_id) || m.artist_user_id));

        const kpis = kit.kpis([
            { label: 'Artistas con material', value: String(holders.size) },
            { label: 'Ítems en su poder', value: String(pendingRows.length), hint: 'Artista × ítem con saldo' },
            { label: 'Costo neto entregado', valueHtml: kit.fmtTotalsHtml(totalCost), hint: 'Entregas menos devoluciones' }
        ]);

        const summaryTable = kit.renderTable({
            caption: 'Resumen por artista',
            emptyText: 'Sin artistas para este filtro.',
            rows: summary,
            columns: [
                { label: 'Artista', render: row => '<strong>' + kit.escapeHtml(row.artist_name) + '</strong>' },
                { label: 'Ítems pendientes', align: 'right', render: row => kit.escapeHtml(String(row.pending_items)) },
                { label: 'Costo neto', align: 'right', render: row => kit.escapeHtml(kit.fmtTotals(row.cost)) },
                { label: 'Último movimiento', render: row => kit.escapeHtml(kit.fmtDateTime(row.last_movement_at)) },
                {
                    label: 'Acciones',
                    render: row => '<div class="sk-row-actions">'
                        + (activeIds.has(row.artist_user_id) ? '<button type="button" class="studio-btn sk-btn-sm" data-materials-deliver="' + kit.escapeAttr(row.artist_user_id) + '">Entregar</button>' : '')
                        + (row.pending_items ? '<button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-materials-return="' + kit.escapeAttr(row.artist_user_id) + '">Devolución</button>' : '')
                        + '</div>'
                }
            ]
        });

        const detailTable = kit.renderTable({
            caption: 'Detalle por ítem',
            emptyText: state.filter.pendingOnly ? 'Nadie tiene material pendiente de devolver con este filtro.' : 'Sin movimientos para este filtro.',
            rows: detail,
            columns: [
                { label: 'Artista', render: row => kit.escapeHtml(row.artist_name) },
                { label: 'Ítem', render: row => '<strong>' + kit.escapeHtml(row.item_name || 'Ítem') + '</strong>' },
                { label: 'Entregado', align: 'right', render: row => qtyCell(kit, row.assigned_qty, row.unit) },
                { label: 'Devuelto', align: 'right', render: row => qtyCell(kit, row.returned_qty, row.unit) },
                { label: 'En su poder', align: 'right', render: row => '<strong>' + qtyCell(kit, row.net_assigned_qty, row.unit) + '</strong>' },
                { label: 'Consumo registrado', align: 'right', render: row => qtyCell(kit, row.consumed_qty, row.unit) },
                { label: 'Costo neto', align: 'right', render: row => kit.escapeHtml(kit.fmtMoney(row.assigned_cost, currencyOf(row.currency))) },
                { label: 'Último movimiento', render: row => kit.escapeHtml(kit.fmtDateTime(row.last_movement_at)) },
                {
                    label: 'Acciones',
                    render: row => Number(row.net_assigned_qty) > 0
                        ? '<button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-materials-return="' + kit.escapeAttr(row.artist_user_id) + '" data-item="' + kit.escapeAttr(row.item_id) + '">Devolver</button>'
                        : ''
                }
            ]
        });

        return kpis + '<div class="sk-section">' + summaryTable + '</div><div class="sk-section">' + detailTable + '</div>';
    }

    function render() {
        const kit = kitOf(state.ctx);
        const body = q('[data-materials-body]');
        if (!kit || !body) return;
        renderFilterOptions(kit);
        body.innerHTML = bodyHtml(kit);
        setActionsEnabled(!state.unavailable);
    }

    async function load() {
        const ctx = state.ctx;
        const data = dataOf(ctx);
        const token = ++state.seq;
        const ops = data.StudioOps || {};
        const [balance, membersRes] = await Promise.all([
            typeof ops.listMaterialBalance === 'function'
                ? ops.listMaterialBalance(ctx.studioId) : Promise.resolve({ data: [], error: null, unavailable: true }),
            data.StudioMemberships && typeof data.StudioMemberships.listActiveArtists === 'function'
                ? Promise.resolve(data.StudioMemberships.listActiveArtists(ctx.studioId)).catch(error => ({ data: null, error }))
                : Promise.resolve({ data: [], error: null })
        ]);
        if (token !== state.seq) return;
        state.unavailable = !!(balance && balance.unavailable);
        state.error = balance && balance.error ? balance.error : null;
        state.rows = state.error ? [] : ((balance && balance.data) || []);
        state.members = (membersRes && !membersRes.error && membersRes.data) || [];
        state.names = await resolveNames(data, state.members, state.rows.map(row => row.artist_user_id));
        if (token !== state.seq) return;
        state.loaded = true;
        render();
    }

    // Ya se guardó: un error al refrescar no puede volver al modal (invitaría
    // a registrar dos veces la misma entrega).
    async function afterSave(kind, rows) {
        try {
            emitChanged({ kind, item_ids: rows.map(row => row.item_id) });
            await load();
        } catch (err) {
            console.error('[materials] guardado, pero no se pudo refrescar', err);
        }
    }

    // ---------------- Entregar materiales ----------------
    function itemOptionsHtml(kit, items, selected) {
        return '<option value="">Elegí un ítem</option>' + items.map(item => {
            const stock = toNum(item.quantity_on_hand) || 0;
            const text = (item.name || 'Ítem') + ' · ' + (stock > 0 ? fmtQty(stock) + unitSuffix(item.unit) + ' disponibles' : 'sin stock');
            return '<option value="' + kit.escapeAttr(item.id) + '"' + (item.id === selected ? ' selected' : '') + (stock > 0 ? '' : ' disabled') + '>' + kit.escapeHtml(text) + '</option>';
        }).join('');
    }
    function deliveryLineHtml(kit, items, n) {
        return `
            <div class="sk-toolbar" data-line>
                <div class="sk-field" style="flex:2 1 220px;">
                    <label for="md-item-${n}">Ítem</label>
                    <select id="md-item-${n}" data-field="item">${itemOptionsHtml(kit, items, null)}</select>
                </div>
                <div class="sk-field" style="flex:1 1 110px;">
                    <label for="md-qty-${n}" data-qty-label>Cantidad</label>
                    <input id="md-qty-${n}" data-field="quantity" type="number" min="0" step="0.001" inputmode="decimal">
                </div>
                <div class="sk-field" style="flex:1 1 130px;">
                    <label for="md-cost-${n}" data-cost-label>Costo unitario</label>
                    <input id="md-cost-${n}" data-field="cost" type="number" min="0" step="0.01" inputmode="decimal">
                </div>
                <button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-remove-line aria-label="Quitar la línea ${n}">Quitar</button>
            </div>`;
    }
    function readLines(body) {
        if (!body || typeof body.querySelectorAll !== 'function') return [];
        return Array.from(body.querySelectorAll('[data-line]')).map(line => {
            const field = name => line.querySelector('[data-field="' + name + '"]');
            return {
                itemId: (field('item') && field('item').value) || '',
                quantity: (field('quantity') && field('quantity').value) || '',
                cost: (field('cost') && field('cost').value) || ''
            };
        });
    }

    async function openDeliver(presetArtistId) {
        const ctx = state.ctx;
        const kit = kitOf(ctx);
        const data = dataOf(ctx);
        if (state.unavailable) { kit.toast(MIGRATION_PENDING, 'warning'); return; }
        const [itemsRes, membersRes] = await Promise.all([
            data.StudioOps.listInventoryItems(ctx.studioId),
            data.StudioMemberships.listActiveArtists(ctx.studioId)
        ]);
        const items = (kit.unwrap(itemsRes) || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
        const members = kit.unwrap(membersRes) || [];
        const names = await resolveNames(data, members, []);
        const artists = Array.from(names.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
        if (!artists.length) { kit.toast('Sumá artistas activos al roster para entregarles materiales.', 'warning'); return; }
        if (!items.some(item => (toNum(item.quantity_on_hand) || 0) > 0)) { kit.toast('No hay ítems con stock. Cargá stock en el inventario antes de entregar.', 'warning'); return; }
        const preset = artists.some(a => a.id === presetArtistId) ? presetArtistId : '';
        let lineSeq = 1;
        const bodyMarkup = `
            <div class="sk-materials-form" data-deliver-form>
                <div class="sk-grid-2">
                    <div class="sk-field">
                        <label for="md-artist">Artista que recibe</label>
                        <select id="md-artist" data-field="artist" required>
                            <option value="">Elegí un artista</option>
                            ${artists.map(a => '<option value="' + kit.escapeAttr(a.id) + '"' + (a.id === preset ? ' selected' : '') + '>' + kit.escapeHtml(a.name) + '</option>').join('')}
                        </select>
                    </div>
                    <div class="sk-field">
                        <label for="md-when">Fecha de entrega</label>
                        <input id="md-when" data-field="when" type="datetime-local" value="${kit.escapeAttr(kit.toLocalInput(new Date()))}">
                    </div>
                </div>
                <p class="sk-field-hint">Cada línea descuenta stock. El costo unitario se precarga con el del ítem; si lo dejás vacío se usa ese mismo.</p>
                <div data-lines>${deliveryLineHtml(kit, items, lineSeq)}</div>
                <p><button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-add-line>+ Agregar otro ítem</button></p>
                <div class="sk-field">
                    <label for="md-notes">Notas (opcional)</label>
                    <textarea id="md-notes" data-field="notes" maxlength="500" rows="2"></textarea>
                </div>
                <p class="studio-help" data-total>Costo estimado: —</p>
            </div>`;
        const itemsById = new Map(items.map(item => [item.id, item]));
        const modal = kit.openModal({
            title: 'Entregar materiales',
            size: 'lg',
            body: bodyMarkup,
            actions: [
                { label: 'Cancelar', variant: 'ghost' },
                {
                    label: 'Registrar entrega',
                    variant: 'primary',
                    async onClick(m) {
                        const form = m.body;
                        const artistEl = form.querySelector('[data-field="artist"]');
                        const whenEl = form.querySelector('[data-field="when"]');
                        const notesEl = form.querySelector('[data-field="notes"]');
                        const artistId = artistEl ? artistEl.value : '';
                        const rows = buildDeliveryRows({
                            artistId,
                            lines: readLines(form),
                            performedAt: whenEl && whenEl.value ? kit.fromLocalInput(whenEl.value) : null,
                            notes: notesEl ? notesEl.value : ''
                        }, { studioId: ctx.studioId, items, activeArtistIds: artists.map(a => a.id) });
                        const res = await data.StudioOps.createInventoryMovement(rows);
                        if (res && res.error) throw saveError(res.error, kit);
                        const count = rows.length;
                        kit.toast('Entregaste ' + count + (count === 1 ? ' ítem' : ' ítems') + ' a ' + artistName(names, artistId) + '.', 'success');
                        await afterSave('assignment', rows);
                        return true;
                    }
                }
            ]
        });
        const form = modal && modal.body;
        if (!form || typeof form.addEventListener !== 'function') return;
        const updateTotal = () => {
            const totalEl = form.querySelector('[data-total]');
            if (totalEl) totalEl.textContent = 'Costo estimado: ' + kit.fmtTotals(deliveryTotals(readLines(form), items));
        };
        form.addEventListener('change', event => {
            const select = event.target && event.target.closest ? event.target.closest('[data-field="item"]') : null;
            if (select) {
                const line = select.closest('[data-line]');
                const item = itemsById.get(select.value);
                const cost = line && line.querySelector('[data-field="cost"]');
                if (cost && !cost.dataset.touched) cost.value = item && item.cost_per_unit != null ? String(item.cost_per_unit) : '';
                const costLabel = line && line.querySelector('[data-cost-label]');
                if (costLabel) costLabel.textContent = item ? 'Costo unitario (' + currencyOf(item.currency) + ')' : 'Costo unitario';
                const qtyLabel = line && line.querySelector('[data-qty-label]');
                if (qtyLabel) qtyLabel.textContent = item && item.unit ? 'Cantidad (' + item.unit + ')' : 'Cantidad';
                const qty = line && line.querySelector('[data-field="quantity"]');
                if (qty && item) qty.setAttribute('max', String(toNum(item.quantity_on_hand) || 0));
            }
            updateTotal();
        });
        form.addEventListener('input', event => {
            const target = event.target;
            if (target && target.dataset && target.getAttribute && target.getAttribute('data-field') === 'cost') target.dataset.touched = '1';
            updateTotal();
        });
        form.addEventListener('click', event => {
            const add = event.target && event.target.closest ? event.target.closest('[data-add-line]') : null;
            const remove = event.target && event.target.closest ? event.target.closest('[data-remove-line]') : null;
            const host = form.querySelector('[data-lines]');
            if (add && host) {
                if (host.querySelectorAll('[data-line]').length >= MAX_LINES) { modal.setError('Podés registrar hasta ' + MAX_LINES + ' ítems por entrega.'); return; }
                lineSeq += 1;
                host.insertAdjacentHTML('beforeend', deliveryLineHtml(kit, items, lineSeq));
                const select = host.querySelector('#md-item-' + lineSeq);
                if (select && typeof select.focus === 'function') select.focus();
            } else if (remove && host) {
                const line = remove.closest('[data-line]');
                if (host.querySelectorAll('[data-line]').length > 1) line.remove();
                else {
                    line.querySelectorAll('select, input').forEach(el => { el.value = ''; if (el.dataset) delete el.dataset.touched; });
                    const costLabel = line.querySelector('[data-cost-label]');
                    const qtyLabel = line.querySelector('[data-qty-label]');
                    if (costLabel) costLabel.textContent = 'Costo unitario';
                    if (qtyLabel) qtyLabel.textContent = 'Cantidad';
                }
                updateTotal();
            }
        });
    }

    // ---------------- Registrar devolución ----------------
    function returnLinesHtml(kit, artistId, presetItemId) {
        const held = filterBalance(state.rows, state.names, { artistId, pendingOnly: true });
        if (!artistId) return '<p class="studio-help">Elegí un artista para ver lo que tiene en su poder.</p>';
        if (!held.length) return '<p class="studio-help">Este artista no tiene materiales pendientes de devolver.</p>';
        return held.map((row, i) => {
            const id = 'mr-qty-' + i;
            const avg = outstandingUnitCost(row, null);
            return `
                <div class="sk-toolbar" data-return-line data-item="${kit.escapeAttr(row.item_id)}" data-item-name="${kit.escapeAttr(row.item_name || '')}">
                    <div class="sk-field" style="flex:2 1 220px;">
                        <span class="sk-field-label">${kit.escapeHtml(row.item_name || 'Ítem')}</span>
                        <span class="studio-help">Tiene ${kit.escapeHtml(fmtQty(row.net_assigned_qty) + unitSuffix(row.unit))}${avg != null ? ' · costo promedio ' + kit.escapeHtml(kit.fmtMoney(avg, currencyOf(row.currency))) : ''}</span>
                    </div>
                    <div class="sk-field" style="flex:1 1 140px;">
                        <label for="${id}">Devuelve${row.unit ? ' (' + kit.escapeHtml(row.unit) + ')' : ''}</label>
                        <input id="${id}" data-field="quantity" type="number" min="0" step="0.001" max="${kit.escapeAttr(row.net_assigned_qty)}" inputmode="decimal"${row.item_id === presetItemId ? ' data-autofocus' : ''}>
                    </div>
                    <button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-return-all="${kit.escapeAttr(row.net_assigned_qty)}" aria-label="Devolver todo de ${kit.escapeAttr(row.item_name || 'este ítem')}">Todo</button>
                </div>`;
        }).join('');
    }
    function readReturnLines(body) {
        if (!body || typeof body.querySelectorAll !== 'function') return [];
        return Array.from(body.querySelectorAll('[data-return-line]')).map(line => {
            const input = line.querySelector('[data-field="quantity"]');
            return { itemId: line.getAttribute('data-item') || '', itemName: line.getAttribute('data-item-name') || '', quantity: input ? input.value : '' };
        });
    }

    function openReturn(presetArtistId, presetItemId) {
        const ctx = state.ctx;
        const kit = kitOf(ctx);
        const data = dataOf(ctx);
        if (state.unavailable) { kit.toast(MIGRATION_PENDING, 'warning'); return; }
        const holders = summarizeByArtist(state.rows, state.names).filter(row => row.pending_items > 0);
        if (!holders.length) { kit.toast('Ningún artista tiene materiales pendientes de devolver.', 'info'); return; }
        const preset = holders.some(h => h.artist_user_id === presetArtistId) ? presetArtistId : (holders.length === 1 ? holders[0].artist_user_id : '');
        const bodyMarkup = `
            <div class="sk-materials-form" data-return-form>
                <div class="sk-grid-2">
                    <div class="sk-field">
                        <label for="mr-artist">Artista que devuelve</label>
                        <select id="mr-artist" data-field="artist" required>
                            <option value="">Elegí un artista</option>
                            ${holders.map(h => '<option value="' + kit.escapeAttr(h.artist_user_id) + '"' + (h.artist_user_id === preset ? ' selected' : '') + '>' + kit.escapeHtml(h.artist_name) + ' · ' + kit.escapeHtml(String(h.pending_items)) + (h.pending_items === 1 ? ' ítem' : ' ítems') + '</option>').join('')}
                        </select>
                    </div>
                    <div class="sk-field">
                        <label for="mr-when">Fecha de devolución</label>
                        <input id="mr-when" data-field="when" type="datetime-local" value="${kit.escapeAttr(kit.toLocalInput(new Date()))}">
                    </div>
                </div>
                <p class="sk-field-hint">Lo devuelto vuelve al stock con el costo promedio de lo entregado.</p>
                <div data-return-lines>${returnLinesHtml(kit, preset, presetItemId)}</div>
                <div class="sk-field">
                    <label for="mr-notes">Notas (opcional)</label>
                    <textarea id="mr-notes" data-field="notes" maxlength="500" rows="2"></textarea>
                </div>
            </div>`;
        const modal = kit.openModal({
            title: 'Registrar devolución',
            size: 'lg',
            body: bodyMarkup,
            actions: [
                { label: 'Cancelar', variant: 'ghost' },
                {
                    label: 'Registrar devolución',
                    variant: 'primary',
                    async onClick(m) {
                        const form = m.body;
                        const artistEl = form.querySelector('[data-field="artist"]');
                        const whenEl = form.querySelector('[data-field="when"]');
                        const notesEl = form.querySelector('[data-field="notes"]');
                        const artistId = artistEl ? artistEl.value : '';
                        const rows = buildReturnRows({
                            artistId,
                            lines: readReturnLines(form),
                            performedAt: whenEl && whenEl.value ? kit.fromLocalInput(whenEl.value) : null,
                            notes: notesEl ? notesEl.value : ''
                        }, { studioId: ctx.studioId, balanceRows: state.rows });
                        const res = await data.StudioOps.createInventoryMovement(rows);
                        if (res && res.error) throw saveError(res.error, kit);
                        const count = rows.length;
                        kit.toast('Registraste la devolución de ' + count + (count === 1 ? ' ítem' : ' ítems') + ' de ' + artistName(state.names, artistId) + '.', 'success');
                        await afterSave('return', rows);
                        return true;
                    }
                }
            ]
        });
        const form = modal && modal.body;
        if (!form || typeof form.addEventListener !== 'function') return;
        form.addEventListener('change', event => {
            const target = event.target;
            if (!target || typeof target.getAttribute !== 'function' || target.getAttribute('data-field') !== 'artist') return;
            const host = form.querySelector('[data-return-lines]');
            if (host) host.innerHTML = returnLinesHtml(kit, event.target.value, null);
        });
        form.addEventListener('click', event => {
            const all = event.target && event.target.closest ? event.target.closest('[data-return-all]') : null;
            if (!all) return;
            const input = all.closest('[data-return-line]').querySelector('[data-field="quantity"]');
            if (input) { input.value = all.getAttribute('data-return-all'); if (typeof input.focus === 'function') input.focus(); }
        });
    }

    function exportCsv() {
        const kit = kitOf(state.ctx);
        const rows = filterBalance(state.rows, state.names, state.filter);
        if (!rows.length) { kit.toast('No hay filas para exportar con este filtro.', 'info'); return; }
        kit.downloadCsv(csvFilename(state.ctx.studio), csvColumns(), rows);
    }

    function onRootClick(event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        const kit = kitOf(state.ctx);
        const btn = target.closest('[data-materials-action], [data-materials-deliver], [data-materials-return]');
        if (!btn || btn.disabled) return;
        const action = btn.getAttribute('data-materials-action');
        if (action === 'deliver') return kit.guarded(btn, () => openDeliver(state.filter.artistId));
        if (action === 'return') return kit.guarded(btn, () => openReturn(state.filter.artistId, null));
        if (action === 'csv') return kit.guarded(btn, () => exportCsv());
        if (action === 'reload') return kit.guarded(btn, () => load());
        if (btn.hasAttribute('data-materials-deliver')) return kit.guarded(btn, () => openDeliver(btn.getAttribute('data-materials-deliver')));
        if (btn.hasAttribute('data-materials-return')) return kit.guarded(btn, () => openReturn(btn.getAttribute('data-materials-return'), btn.getAttribute('data-item')));
        return undefined;
    }

    function onRootChange(event) {
        const target = event.target;
        if (!target || typeof target.getAttribute !== 'function') return;
        const filter = target.getAttribute('data-materials-filter');
        if (filter === 'artist') state.filter.artistId = target.value || '';
        else if (filter === 'pending') state.filter.pendingOnly = !!target.checked;
        else return;
        render();
    }

    function onInventoryChanged(event) {
        if (!state.ctx || (event && event.detail && event.detail.source === SOURCE)) return;
        load().catch(err => console.error('[materials] no se pudo actualizar', err));
    }

    function mount(rootEl, ctx) {
        state.root = rootEl;
        state.ctx = ctx;
        rootEl.innerHTML = sectionHtml();
        rootEl.addEventListener('click', onRootClick);
        rootEl.addEventListener('change', onRootChange);
        const doc = getDoc();
        if (doc && typeof doc.addEventListener === 'function') doc.addEventListener(INVENTORY_CHANGED_EVENT, onInventoryChanged);
    }

    // Cada visita a la pestaña recarga el balance. params.artist filtra.
    function show(rootEl, ctx, params) {
        state.ctx = ctx;
        if (params && typeof params.artist === 'string') state.filter.artistId = params.artist;
        return load();
    }

    admin.register(TAB, { mount, show });
})(typeof window !== 'undefined' ? window : globalThis);
