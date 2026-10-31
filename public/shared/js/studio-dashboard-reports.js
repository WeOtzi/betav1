// ============================================
// Studio Dashboard — Reportes (pestaña 'analytics', W-FIN)
//
// Se monta en #reports-extended, arriba del contenido histórico de la
// pestaña (analytics-summary/monthly/artist, de studio-dashboard-ops.js), que
// queda como está. Se registra en window.WeOtziStudioAdmin.
//   - Período por meses completos (las fuentes son vistas mensuales).
//   - KPIs siempre por moneda: tatuajes (cantidad y bruto), ingreso del
//     estudio por tatuajes (studio_net), merch, otros ingresos, gastos y
//     resultado = ingreso por tatuajes + merch + otros ingresos − gastos.
//   - Merch: con la Tienda (window.WeotziData.Store.getSalesReport) en
//     unidades e ingresos; sin Tienda, la suma de los ingresos 'merch_manual'
//     de Finanzas, con unidades "—".
//   - Tablas con CSV: resultado mensual, gastos por categoría (con barras),
//     top artistas, materiales entregados por artista y compras a Supplies
//     por proveedor.
// Cada fuente degrada sola: si le falta su migración, su sección lo avisa y
// el resto del reporte sigue.
//
// Contrato: docs/plans/2026-10-30-estudios-plataforma.md → "Reportes".
// ============================================

(function () {
    'use strict';

    const root = typeof window !== 'undefined' ? window : globalThis;
    const TAB = 'analytics';
    const DEFAULT_PRESET = 'last_6_months';
    const DEAD_ORDER_STATUSES = ['cancelled', 'rejected'];
    const TOP_ARTISTS = 20;

    const COPY = {
        formula: 'Resultado = ingreso del estudio por tatuajes + merch + otros ingresos − gastos. Cada moneda se calcula por separado.',
        months: 'Los reportes se calculan por mes completo.',
        merchManual: 'Unidades: — · Activá la Tienda para ver unidades',
        topArtists: 'Últimos 12 meses (no depende del período elegido)',
        missingPrefix: 'Falta aplicar una migración',
        legacy: 'Resumen histórico · últimos 12 meses'
    };

    const SOURCE_LABELS = {
        metrics: 'tatuajes',
        finance: 'gastos e ingresos de Finanzas',
        artists: 'performance por artista',
        materials: 'materiales entregados',
        orders: 'pedidos a Supplies'
    };

    const states = new WeakMap(); // root del módulo -> estado

    // -------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------
    function K() { return root.WeOtziStudioKit; }
    function D() { return root.WeotziData || {}; }
    function esc(v) { return K().escapeHtml(v); }
    function attr(v) { return K().escapeAttr(v); }
    function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
    function cents(v) { return Math.round(num(v) * 100); }
    function cur(v) { return K().normalizeCurrency(v); }
    function pad2(n) { return String(n).padStart(2, '0'); }
    function cleanText(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

    async function settle(build) {
        try {
            const result = await build();
            return result || { data: null, error: null };
        } catch (error) {
            return { data: null, error };
        }
    }

    // {data, error, unavailable} → {status: 'ok'|'unavailable'|'error', rows, message}
    function sourceState(res) {
        const k = K();
        if (!res) return { status: 'unavailable', rows: [] };
        if (res.unavailable || (res.error && k.isMissingSchema(res.error))) return { status: 'unavailable', rows: [] };
        if (res.error) return { status: 'error', rows: [], message: k.friendlyError(res.error) };
        return { status: 'ok', rows: Array.isArray(res.data) ? res.data.filter(Boolean) : [] };
    }

    // 'YYYY-MM' → último día 'YYYY-MM-DD'.
    function lastDayOfMonth(key) {
        const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
        if (!m) return null;
        const d = new Date(Number(m[1]), Number(m[2]), 0, 12);
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    // Período alineado a meses completos. custom: {from, to} 'YYYY-MM' (o fechas).
    function reportRange(preset, custom, now) {
        const k = K();
        const id = k.PERIOD_PRESETS.includes(preset) ? preset : DEFAULT_PRESET;
        if (id !== 'custom') return k.periodRange(id, null, now);
        const c = custom || {};
        const nowKey = k.monthKey(now || new Date());
        let fromKey = k.monthKey(c.from) || '';
        let toKey = k.monthKey(c.to) || '';
        if (!fromKey && !toKey) { fromKey = nowKey; toKey = nowKey; }
        else if (!fromKey) fromKey = toKey;
        else if (!toKey) toKey = nowKey >= fromKey ? nowKey : fromKey;
        if (fromKey > toKey) { const t = fromKey; fromKey = toKey; toKey = t; }
        return k.periodRange('custom', { from: fromKey + '-01', to: lastDayOfMonth(toKey) }, now);
    }

    function inRange(dateValue, range) {
        const day = K().toDateInput(dateValue);
        return !!day && day >= range.from && day <= range.to;
    }

    function totalsTone(totals) {
        const values = Object.keys(totals || {}).map(c => Number(totals[c]) || 0);
        if (values.some(v => v < 0)) return 'danger';
        if (values.some(v => v > 0)) return 'success';
        return null;
    }

    // -------------------------------------------------------------
    // Fuentes
    // -------------------------------------------------------------
    // Ventas de la Tienda si está disponible; si no (o si falla), el
    // reporte usa los ingresos 'merch_manual' de Finanzas.
    async function loadMerch(studioId, range) {
        const store = D().Store;
        if (!store || typeof store.getSalesReport !== 'function') return { source: 'manual', rows: [] };
        try {
            if (typeof store.isAvailable === 'function' && (await store.isAvailable()) === false) return { source: 'manual', rows: [] };
            const out = await store.getSalesReport('studio', studioId, range.from, range.to);
            if (out && !Array.isArray(out) && out.error) return { source: 'manual', rows: [], error: out.error };
            const rows = Array.isArray(out) ? out : (out && Array.isArray(out.data) ? out.data : null);
            if (!rows) return { source: 'manual', rows: [] };
            return { source: 'store', rows: rows.filter(Boolean) };
        } catch (error) {
            return { source: 'manual', rows: [], error };
        }
    }

    async function loadSources(studioId, range) {
        const d = D();
        const call = (repo, method, ...args) => (repo && typeof repo[method] === 'function'
            ? settle(() => repo[method](...args))
            : Promise.resolve({ data: [], error: null, unavailable: true }));
        const [metrics, finance, artists, materials, orders, roster, merch] = await Promise.all([
            call(d.StudioOps, 'listMonthlyMetrics', studioId, range.fromMonth, range.to),
            call(d.StudioFinance, 'monthlyByCategory', studioId, range.fromMonth, range.to),
            call(d.StudioOps, 'getArtistPerformance', studioId, { limit: TOP_ARTISTS }),
            call(d.StudioOps, 'listMaterialAssignmentsMonthly', studioId, range.fromMonth, range.to),
            call(d.Supplies, 'listOrdersForStudio', studioId),
            call(d.StudioMemberships, 'listRoster', studioId),
            loadMerch(studioId, range)
        ]);
        return {
            metrics: sourceState(metrics),
            finance: sourceState(finance),
            artists: sourceState(artists),
            materials: sourceState(materials),
            orders: sourceState(orders),
            roster: sourceState(roster),
            merch
        };
    }

    // -------------------------------------------------------------
    // Cálculo (puro)
    // -------------------------------------------------------------
    function artistNameMap(sources) {
        const names = new Map();
        ((sources.roster && sources.roster.rows) || []).forEach(m => {
            const a = m && m.artists_db;
            if (a && a.user_id && !names.has(a.user_id)) names.set(a.user_id, cleanText(a.name) || (a.username ? '@' + a.username : ''));
        });
        ((sources.artists && sources.artists.rows) || []).forEach(r => {
            if (r && r.artist_user_id && !names.get(r.artist_user_id)) names.set(r.artist_user_id, cleanText(r.name) || (r.username ? '@' + r.username : ''));
        });
        return names;
    }

    // sources: salida de loadSources (o equivalente en tests). range: reportRange.
    function buildReport(sources, range) {
        const k = K();
        const s = sources || {};
        const metrics = (s.metrics && s.metrics.rows) || [];
        const finance = (s.finance && s.finance.rows) || [];
        const merchSrc = s.merch || { source: 'manual', rows: [] };
        const hasStore = merchSrc.source === 'store';
        const storeRows = hasStore ? (merchSrc.rows || []) : [];

        const income = finance.filter(r => r.entry_type === 'income');
        const merchManualRows = income.filter(r => r.category === 'merch_manual');
        const otherIncomeRows = income.filter(r => r.category !== 'merch_manual');
        const expenseRows = finance.filter(r => r.entry_type === 'expense');

        const tattooGross = k.sumByCurrency(metrics, 'gross_amount', 'currency');
        const tattooNet = k.sumByCurrency(metrics, 'studio_net', 'currency');
        const jobs = metrics.reduce((acc, r) => acc + num(r.jobs_count), 0);
        const merchStore = k.sumByCurrency(storeRows, 'gross_amount', 'currency');
        const merchManual = k.sumByCurrency(merchManualRows, 'total', 'currency');
        const merch = k.mergeTotals(merchStore, merchManual);
        const merchUnits = hasStore ? storeRows.reduce((acc, r) => acc + num(r.units), 0) : null;
        const otherIncome = k.sumByCurrency(otherIncomeRows, 'total', 'currency');
        const expenses = k.sumByCurrency(expenseRows, 'total', 'currency');
        const result = k.mergeTotals(k.mergeTotals(k.mergeTotals(tattooNet, merch), otherIncome), expenses, -1);

        // Resultado mensual (mes × moneda), en centavos para no arrastrar redondeos.
        const monthly = new Map();
        const slot = (month, currency) => {
            const key = k.monthKey(month) + '|' + cur(currency);
            if (!monthly.has(key)) {
                monthly.set(key, { month: k.monthKey(month), currency: cur(currency), jobs: 0, gross: 0, tattooNet: 0, merch: 0, otherIncome: 0, expenses: 0 });
            }
            return monthly.get(key);
        };
        metrics.forEach(r => {
            if (!k.monthKey(r.month)) return;
            const m = slot(r.month, r.currency);
            m.jobs += num(r.jobs_count);
            m.gross += cents(r.gross_amount);
            m.tattooNet += cents(r.studio_net);
        });
        storeRows.forEach(r => { if (k.monthKey(r.month)) slot(r.month, r.currency).merch += cents(r.gross_amount); });
        merchManualRows.forEach(r => { if (k.monthKey(r.month)) slot(r.month, r.currency).merch += cents(r.total); });
        otherIncomeRows.forEach(r => { if (k.monthKey(r.month)) slot(r.month, r.currency).otherIncome += cents(r.total); });
        expenseRows.forEach(r => { if (k.monthKey(r.month)) slot(r.month, r.currency).expenses += cents(r.total); });
        const monthlyRows = Array.from(monthly.values())
            .filter(m => !range || !range.months || range.months.includes(m.month))
            .sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency))
            .map(m => ({
                month: m.month,
                currency: m.currency,
                jobs: m.jobs,
                gross: m.gross / 100,
                tattooNet: m.tattooNet / 100,
                merch: m.merch / 100,
                otherIncome: m.otherIncome / 100,
                expenses: m.expenses / 100,
                result: (m.tattooNet + m.merch + m.otherIncome - m.expenses) / 100
            }));

        // Gastos por categoría (categoría × moneda) con participación por moneda.
        const byCat = new Map();
        const curTotals = {};
        expenseRows.forEach(r => {
            const c = cur(r.currency);
            const key = String(r.category) + '|' + c;
            if (!byCat.has(key)) byCat.set(key, { category: String(r.category), currency: c, total: 0, entries: 0 });
            const row = byCat.get(key);
            row.total += cents(r.total);
            row.entries += num(r.entries);
            curTotals[c] = (curTotals[c] || 0) + cents(r.total);
        });
        const categoryRows = Array.from(byCat.values())
            .map(r => ({ category: r.category, currency: r.currency, total: r.total / 100, entries: r.entries, share: curTotals[r.currency] ? Math.round((r.total / curTotals[r.currency]) * 1000) / 10 : 0 }))
            .sort((a, b) => a.currency.localeCompare(b.currency) || b.total - a.total || a.category.localeCompare(b.category));

        const names = artistNameMap(s);

        // Top artistas (vista de los últimos 12 meses).
        const artistRows = ((s.artists && s.artists.rows) || []).map(r => ({
            artist_user_id: r.artist_user_id,
            name: names.get(r.artist_user_id) || cleanText(r.name) || (r.username ? '@' + r.username : 'Artista'),
            currency: cur(r.currency),
            jobs: num(r.jobs_count),
            gross: num(r.gross_billed),
            avgTicket: r.avg_ticket == null ? null : num(r.avg_ticket),
            supplies: num(r.supplies_consumed_cost),
            daysSinceLast: r.days_since_last_job == null ? null : num(r.days_since_last_job)
        })).sort((a, b) => a.currency.localeCompare(b.currency) || b.gross - a.gross);

        // Materiales entregados (netos de devoluciones) por artista × moneda.
        const mats = new Map();
        ((s.materials && s.materials.rows) || []).forEach(r => {
            if (range && range.months && k.monthKey(r.month) && !range.months.includes(k.monthKey(r.month))) return;
            const c = cur(r.currency);
            const key = String(r.artist_user_id) + '|' + c;
            if (!mats.has(key)) mats.set(key, { artist_user_id: r.artist_user_id, currency: c, quantity: 0, cost: 0 });
            const row = mats.get(key);
            row.quantity += Math.round(num(r.quantity) * 100);
            row.cost += cents(r.cost);
        });
        const materialRows = Array.from(mats.values()).map(r => ({
            artist_user_id: r.artist_user_id,
            name: names.get(r.artist_user_id) || 'Artista sin nombre',
            currency: r.currency,
            quantity: r.quantity / 100,
            cost: r.cost / 100
        })).sort((a, b) => a.currency.localeCompare(b.currency) || b.cost - a.cost || a.name.localeCompare(b.name));

        // Compras a Supplies por proveedor: pedidos no cancelados ni
        // rechazados; un pedido recibido cuenta en el mes de la recepción.
        const purchases = new Map();
        ((s.orders && s.orders.rows) || []).forEach(o => {
            if (!o || DEAD_ORDER_STATUSES.includes(o.status)) return;
            const when = o.status === 'received' ? (o.received_at || o.submitted_at || o.created_at) : (o.submitted_at || o.created_at);
            if (range && !inRange(when, range)) return;
            const vendor = o.supply_vendors || {};
            const c = cur(o.currency);
            const key = String(o.vendor_id || vendor.id || '') + '|' + c;
            if (!purchases.has(key)) {
                purchases.set(key, { vendor_id: o.vendor_id || vendor.id || null, vendor: cleanText(vendor.name) || 'Proveedor', currency: c, orders: 0, received: 0, open: 0, total: 0 });
            }
            const row = purchases.get(key);
            row.orders += 1;
            if (o.status === 'received') row.received += 1; else row.open += 1;
            row.total += cents(o.total);
        });
        const purchaseRows = Array.from(purchases.values()).map(r => Object.assign({}, r, { total: r.total / 100 }))
            .sort((a, b) => a.currency.localeCompare(b.currency) || b.total - a.total || a.vendor.localeCompare(b.vendor));

        const missing = Object.keys(SOURCE_LABELS).filter(key => s[key] && s[key].status === 'unavailable');
        const failed = Object.keys(SOURCE_LABELS).filter(key => s[key] && s[key].status === 'error');

        return {
            range,
            hasStore,
            jobs,
            tattooGross,
            tattooNet,
            merch,
            merchManual,
            merchUnits,
            otherIncome,
            expenses,
            result,
            monthlyRows,
            categoryRows,
            artistRows,
            materialRows,
            purchaseRows,
            missing,
            failed
        };
    }

    // -------------------------------------------------------------
    // HTML
    // -------------------------------------------------------------
    function kpisHtml(report) {
        const k = K();
        const manual = Object.keys(report.merchManual || {}).length > 0;
        const merchHint = report.hasStore
            ? k.fmtNumber(report.merchUnits || 0, 0) + ' unidades vendidas en la Tienda' + (manual ? ' · incluye ventas manuales' : '')
            : COPY.merchManual;
        return '<div class="sfin-report-kpis">' + k.kpis([
            {
                label: 'Tatuajes',
                valueHtml: '<span class="sk-total">' + esc(k.fmtNumber(report.jobs, 0)) + '</span>'
                    + '<span class="sfin-kpi-sub">' + k.fmtTotalsHtml(report.tattooGross) + '</span>',
                hint: 'Cantidad y bruto facturado'
            },
            { label: 'Ingreso del estudio por tatuajes', valueHtml: k.fmtTotalsHtml(report.tattooNet), hint: 'Lo que le queda al estudio de cada trabajo' },
            { label: 'Merch', valueHtml: k.fmtTotalsHtml(report.merch), hint: merchHint },
            { label: 'Otros ingresos', valueHtml: k.fmtTotalsHtml(report.otherIncome), hint: 'Alquiler de puesto, sponsors y otros' },
            { label: 'Gastos', valueHtml: k.fmtTotalsHtml(report.expenses), hint: 'Registrados en Finanzas' },
            { label: 'Resultado', valueHtml: k.fmtTotalsHtml(report.result), tone: totalsTone(report.result), hint: 'Por moneda' }
        ]) + '</div>';
    }

    function noticesHtml(report) {
        const out = [];
        if (report.missing.length) {
            out.push('<p class="sfin-notice">' + esc(COPY.missingPrefix + ': el reporte todavía no incluye '
                + report.missing.map(key => SOURCE_LABELS[key]).join(', ') + '.') + '</p>');
        }
        if (report.failed.length) {
            out.push('<p class="sfin-notice sfin-notice--error" role="alert">' + esc('No pudimos cargar '
                + report.failed.map(key => SOURCE_LABELS[key]).join(', ') + '. Los totales pueden estar incompletos.')
                + ' <button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-action="retry">Reintentar</button></p>');
        }
        return out.join('');
    }

    // Aviso de una fuente que no cargó. opts.errorsOnly: la falta de migración
    // ya la explica el aviso general (para tablas que mezclan fuentes).
    function sourceBlock(sources, key, opts) {
        const k = K();
        const src = sources && sources[key];
        if (!src || src.status === 'ok') return '';
        if (src.status === 'unavailable') return opts && opts.errorsOnly ? '' : k.emptyState({ compact: true, body: k.MISSING_SCHEMA_MESSAGE });
        return '<p class="studio-status studio-status-error" role="alert">' + esc(src.message || k.friendlyError(null)) + '</p>';
    }

    function sectionHtml(id, title, opts) {
        const o = opts || {};
        return '<section class="sk-section sfin-report-section" data-section="' + attr(id) + '" aria-labelledby="sfin-r-' + attr(id) + '">'
            + '<div class="sk-section-head">'
            + '<h2 class="studio-h2" id="sfin-r-' + attr(id) + '">' + esc(title) + '</h2>'
            + (o.csv ? '<button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-csv="' + attr(id) + '"' + (o.csvDisabled ? ' disabled' : '') + '>'
                + '<i class="fa-solid fa-file-csv" aria-hidden="true"></i> CSV</button>' : '')
            + '</div>'
            + (o.caption ? '<p class="studio-help sfin-caption">' + esc(o.caption) + '</p>' : '')
            + (o.bodyHtml || '')
            + '</section>';
    }

    // Barras agrupadas por moneda (nunca se comparan importes de monedas distintas).
    function barsByCurrency(rows, opts) {
        const k = K();
        const o = opts || {};
        const groups = new Map();
        rows.forEach(r => {
            if (!groups.has(r.currency)) groups.set(r.currency, []);
            groups.get(r.currency).push(r);
        });
        if (!groups.size) return '';
        return '<div class="sfin-bars">' + Array.from(groups.entries()).map(([currency, list]) =>
            '<div class="sfin-bars__group">'
            + '<p class="sfin-bars__title">' + esc(currency) + '</p>'
            + k.barChart({
                items: list.map(r => ({ label: o.label(r), value: o.value(r), currency, hint: o.hint ? o.hint(r) : null })),
                format: 'money',
                ariaLabel: (o.ariaLabel || 'Gráfico') + ' en ' + currency
            })
            + '</div>'
        ).join('') + '</div>';
    }

    function monthlySection(report, sources) {
        const k = K();
        const rows = report.monthlyRows;
        const body = rows.length
            ? barsByCurrency(rows, { label: r => k.monthLabel(r.month, { short: true }), value: r => r.result, ariaLabel: 'Resultado por mes' })
                + k.renderTable({
                    className: 'sfin-report-table',
                    rows,
                    columns: [
                        { key: 'month', label: 'Mes', format: 'month' },
                        { key: 'currency', label: 'Moneda' },
                        { key: 'jobs', label: 'Tatuajes', format: 'number', decimals: 0 },
                        { key: 'tattooNet', label: 'Ingreso por tatuajes', format: 'money' },
                        { key: 'merch', label: 'Merch', format: 'money' },
                        { key: 'otherIncome', label: 'Otros ingresos', format: 'money' },
                        { key: 'expenses', label: 'Gastos', format: 'money' },
                        { key: 'result', label: 'Resultado', align: 'right', render: r => '<strong class="sfin-amount' + (r.result < 0 ? ' is-negative' : '') + '">' + esc(k.fmtMoney(r.result, r.currency)) + '</strong>' }
                    ]
                })
            : k.emptyState({ compact: true, body: 'Todavía no hay trabajos ni movimientos en este período.' });
        const warn = [sourceBlock(sources, 'metrics', { errorsOnly: true }), sourceBlock(sources, 'finance', { errorsOnly: true })].filter(Boolean).join('');
        return sectionHtml('monthly', 'Resultado mensual', { csv: true, csvDisabled: !rows.length, bodyHtml: warn + body });
    }

    function categoriesSection(report, sources) {
        const k = K();
        const rows = report.categoryRows;
        const blocked = sourceBlock(sources, 'finance');
        const body = blocked || (rows.length
            ? barsByCurrency(rows, {
                label: r => k.label('financeCategory', r.category),
                value: r => r.total,
                hint: r => (r.entries === 1 ? '1 movimiento' : r.entries + ' movimientos'),
                ariaLabel: 'Gastos por categoría'
            })
                + k.renderTable({
                    className: 'sfin-report-table',
                    rows,
                    columns: [
                        { key: 'category', label: 'Categoría', dict: 'financeCategory' },
                        { key: 'currency', label: 'Moneda' },
                        { key: 'entries', label: 'Movimientos', format: 'number', decimals: 0 },
                        { key: 'total', label: 'Total', format: 'money' },
                        { key: 'share', label: '% de la moneda', format: 'percent', decimals: 1 },
                        {
                            key: 'category', label: 'Detalle',
                            render: r => '<button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-action="finance" data-category="' + attr(r.category) + '"'
                                + ' aria-label="' + attr('Ver en Finanzas los gastos de ' + k.label('financeCategory', r.category)) + '">Ver en Finanzas</button>'
                        }
                    ]
                })
            : k.emptyState({ compact: true, body: 'No registraste gastos en este período.' }));
        return sectionHtml('categories', 'Gastos por categoría', { csv: true, csvDisabled: !rows.length, bodyHtml: body });
    }

    function artistsSection(report, sources) {
        const k = K();
        const rows = report.artistRows;
        const blocked = sourceBlock(sources, 'artists');
        const body = blocked || (rows.length
            ? k.renderTable({
                className: 'sfin-report-table',
                rows,
                columns: [
                    { key: 'name', label: 'Artista' },
                    { key: 'currency', label: 'Moneda' },
                    { key: 'jobs', label: 'Trabajos', format: 'number', decimals: 0 },
                    { key: 'gross', label: 'Bruto', format: 'money' },
                    { key: 'avgTicket', label: 'Ticket promedio', format: 'money' },
                    { key: 'supplies', label: 'Insumos consumidos', format: 'money' },
                    { key: 'daysSinceLast', label: 'Último trabajo', render: r => (r.daysSinceLast == null ? '<span class="sk-muted">—</span>' : esc(r.daysSinceLast === 0 ? 'hoy' : 'hace ' + r.daysSinceLast + (r.daysSinceLast === 1 ? ' día' : ' días'))) }
                ]
            })
            : k.emptyState({ compact: true, body: 'Todavía no hay trabajos registrados por artista.' }));
        return sectionHtml('artists', 'Top artistas', { csv: true, csvDisabled: !rows.length, caption: COPY.topArtists, bodyHtml: body });
    }

    function materialsSection(report, sources) {
        const k = K();
        const rows = report.materialRows;
        const blocked = sourceBlock(sources, 'materials');
        const body = blocked || (rows.length
            ? k.renderTable({
                className: 'sfin-report-table',
                rows,
                columns: [
                    { key: 'name', label: 'Artista' },
                    { key: 'currency', label: 'Moneda' },
                    { key: 'quantity', label: 'Cantidad neta', format: 'number' },
                    { key: 'cost', label: 'Costo', format: 'money' }
                ]
            })
            : k.emptyState({ compact: true, body: 'No entregaste materiales a artistas en este período.' }));
        return sectionHtml('materials', 'Materiales entregados por artista', {
            csv: true, csvDisabled: !rows.length, caption: 'Entregas menos devoluciones, al costo de cada movimiento.', bodyHtml: body
        });
    }

    function purchasesSection(report, sources) {
        const k = K();
        const rows = report.purchaseRows;
        const blocked = sourceBlock(sources, 'orders');
        const body = blocked || (rows.length
            ? k.renderTable({
                className: 'sfin-report-table',
                rows,
                columns: [
                    { key: 'vendor', label: 'Proveedor' },
                    { key: 'currency', label: 'Moneda' },
                    { key: 'orders', label: 'Pedidos', format: 'number', decimals: 0 },
                    { key: 'received', label: 'Recibidos', format: 'number', decimals: 0 },
                    { key: 'open', label: 'En curso', format: 'number', decimals: 0 },
                    { key: 'total', label: 'Total', format: 'money' }
                ]
            })
            : k.emptyState({ compact: true, body: 'No hiciste pedidos a Supplies en este período.' }));
        return sectionHtml('purchases', 'Compras a Supplies por proveedor', {
            csv: true, csvDisabled: !rows.length, caption: 'Sin pedidos cancelados ni rechazados. Un pedido recibido cuenta en el mes en que lo recibiste.', bodyHtml: body
        });
    }

    function reportHtml(report, sources) {
        return kpisHtml(report)
            + '<p class="studio-help sfin-formula">' + esc(COPY.formula) + '</p>'
            + noticesHtml(report)
            + monthlySection(report, sources)
            + categoriesSection(report, sources)
            + artistsSection(report, sources)
            + materialsSection(report, sources)
            + purchasesSection(report, sources);
    }

    function shellHtml(preset) {
        const k = K();
        return '<div class="sfin-report">'
            + '<div class="sk-section-head sfin-report-head">'
            + '<h2 class="studio-h2">Resultado del período</h2>'
            + '<div class="sk-toolbar sfin-report-toolbar" data-region="period-filters" role="group" aria-label="Período del reporte">'
            + '<div class="sk-field"><label for="sfin-r-preset">Período</label><select id="sfin-r-preset" name="preset">'
            + k.optionsHtml('periodPreset', preset, { only: k.PERIOD_PRESETS }) + '</select></div>'
            + '<div class="sk-field" data-custom hidden><label for="sfin-r-from">Desde (mes)</label><input id="sfin-r-from" name="from" type="month" placeholder="AAAA-MM"></div>'
            + '<div class="sk-field" data-custom hidden><label for="sfin-r-to">Hasta (mes)</label><input id="sfin-r-to" name="to" type="month" placeholder="AAAA-MM"></div>'
            + '</div>'
            + '</div>'
            + '<p class="sfin-period-label" data-region="period" aria-live="polite"></p>'
            + '<div data-region="report" aria-live="polite"><p class="studio-help">Cargando reportes…</p></div>'
            + '<p class="studio-section-kicker sfin-legacy-kicker">' + esc(COPY.legacy) + '</p>'
            + '</div>';
    }

    // -------------------------------------------------------------
    // CSV
    // -------------------------------------------------------------
    function csvFor(kind, report) {
        const k = K();
        const map = {
            monthly: {
                rows: report.monthlyRows,
                columns: [
                    { label: 'Mes', value: r => k.monthLabel(r.month) },
                    { label: 'Moneda', key: 'currency' },
                    { label: 'Tatuajes', key: 'jobs' },
                    { label: 'Bruto por tatuajes', key: 'gross' },
                    { label: 'Ingreso del estudio por tatuajes', key: 'tattooNet' },
                    { label: 'Merch', key: 'merch' },
                    { label: 'Otros ingresos', key: 'otherIncome' },
                    { label: 'Gastos', key: 'expenses' },
                    { label: 'Resultado', key: 'result' }
                ]
            },
            categories: {
                rows: report.categoryRows,
                columns: [
                    { label: 'Categoría', value: r => k.label('financeCategory', r.category) },
                    { label: 'Moneda', key: 'currency' },
                    { label: 'Movimientos', key: 'entries' },
                    { label: 'Total', key: 'total' },
                    { label: '% de la moneda', key: 'share' }
                ]
            },
            artists: {
                rows: report.artistRows,
                columns: [
                    { label: 'Artista', key: 'name' },
                    { label: 'Moneda', key: 'currency' },
                    { label: 'Trabajos', key: 'jobs' },
                    { label: 'Bruto', key: 'gross' },
                    { label: 'Ticket promedio', key: 'avgTicket' },
                    { label: 'Insumos consumidos', key: 'supplies' },
                    { label: 'Días desde el último trabajo', key: 'daysSinceLast' }
                ]
            },
            materials: {
                rows: report.materialRows,
                columns: [
                    { label: 'Artista', key: 'name' },
                    { label: 'Moneda', key: 'currency' },
                    { label: 'Cantidad neta', key: 'quantity' },
                    { label: 'Costo', key: 'cost' }
                ]
            },
            purchases: {
                rows: report.purchaseRows,
                columns: [
                    { label: 'Proveedor', key: 'vendor' },
                    { label: 'Moneda', key: 'currency' },
                    { label: 'Pedidos', key: 'orders' },
                    { label: 'Recibidos', key: 'received' },
                    { label: 'En curso', key: 'open' },
                    { label: 'Total', key: 'total' }
                ]
            }
        };
        return map[kind] || null;
    }

    const CSV_NAMES = {
        monthly: 'resultado-mensual',
        categories: 'gastos-por-categoria',
        artists: 'top-artistas',
        materials: 'materiales-por-artista',
        purchases: 'compras-supplies'
    };

    function exportCsv(state, kind) {
        const k = K();
        const spec = state.report ? csvFor(kind, state.report) : null;
        if (!spec || !spec.rows.length) { k.toast('No hay datos para exportar.', 'info'); return null; }
        const range = state.report.range;
        return k.downloadCsv('reporte-' + CSV_NAMES[kind] + '-' + range.from + '_' + range.to, spec.columns, spec.rows);
    }

    // -------------------------------------------------------------
    // Estado, carga y eventos
    // -------------------------------------------------------------
    function createState(rootEl, ctx) {
        return { root: rootEl, ctx, preset: DEFAULT_PRESET, from: '', to: '', range: null, sources: null, report: null, seq: 0 };
    }

    function q(state, selector) {
        return state.root && typeof state.root.querySelector === 'function' ? state.root.querySelector(selector) : null;
    }

    function syncToolbar(state) {
        const preset = q(state, '[name="preset"]');
        if (preset) preset.value = state.preset;
        if (state.root && typeof state.root.querySelectorAll === 'function') {
            Array.from(state.root.querySelectorAll('[data-custom]')).forEach(el => { el.hidden = state.preset !== 'custom'; });
        }
        const from = q(state, '[name="from"]');
        if (from) from.value = state.from || '';
        const to = q(state, '[name="to"]');
        if (to) to.value = state.to || '';
    }

    async function reload(state) {
        const k = K();
        const token = ++state.seq;
        const range = reportRange(state.preset, { from: state.from, to: state.to });
        state.range = range;
        const period = q(state, '[data-region="period"]');
        if (period) {
            const span = range.preset === 'custom' ? range.label : range.label + ' · del ' + k.fmtDate(range.from) + ' al ' + k.fmtDate(range.to);
            period.textContent = span + '. ' + COPY.months;
        }
        const target = q(state, '[data-region="report"]');
        if (target && typeof target.setAttribute === 'function') target.setAttribute('aria-busy', 'true');
        const sources = await loadSources(state.ctx.studioId, range);
        if (token !== state.seq) return false;
        state.sources = sources;
        state.report = buildReport(sources, range);
        if (target) {
            target.innerHTML = reportHtml(state.report, sources);
            if (typeof target.removeAttribute === 'function') target.removeAttribute('aria-busy');
        }
        return true;
    }

    function onChange(state, event) {
        const t = event && event.target;
        if (!t || !t.name || typeof t.closest !== 'function' || !t.closest('[data-region="period-filters"]')) return;
        const k = K();
        if (t.name === 'preset') {
            state.preset = k.PERIOD_PRESETS.includes(t.value) ? t.value : DEFAULT_PRESET;
            if (state.preset === 'custom' && !state.from && !state.to && state.range) {
                state.from = state.range.from.slice(0, 7);
                state.to = state.range.to.slice(0, 7);
            }
        } else if (t.name === 'from') state.from = t.value || '';
        else if (t.name === 'to') state.to = t.value || '';
        else return;
        syncToolbar(state);
        reload(state);
    }

    function onClick(state, event) {
        const k = K();
        const target = event && event.target;
        const btn = target && typeof target.closest === 'function' ? target.closest('[data-csv], [data-action]') : null;
        if (!btn || (state.root && typeof state.root.contains === 'function' && !state.root.contains(btn))) return;
        const csv = btn.getAttribute('data-csv');
        if (csv) { exportCsv(state, csv); return; }
        const action = btn.getAttribute('data-action');
        if (action === 'retry') k.guarded(btn, () => reload(state));
        else if (action === 'finance' && state.ctx && typeof state.ctx.navigate === 'function' && state.range) {
            state.ctx.navigate('finanzas', { tipo: 'expense', categoria: btn.getAttribute('data-category') || '', desde: state.range.from, hasta: state.range.to });
        }
    }

    function mount(rootEl, ctx) {
        const state = createState(rootEl, ctx);
        states.set(rootEl, state);
        rootEl.innerHTML = shellHtml(state.preset);
        if (typeof rootEl.addEventListener === 'function') {
            rootEl.addEventListener('change', e => onChange(state, e));
            rootEl.addEventListener('click', e => onClick(state, e));
        }
        syncToolbar(state);
        return state;
    }

    // Cada visita recarga: Finanzas, Agenda o Reposición pudieron cambiar datos.
    async function show(rootEl, ctx) {
        const state = states.get(rootEl) || mount(rootEl, ctx);
        await reload(state);
    }

    const api = {
        TAB, DEFAULT_PRESET, COPY,
        lastDayOfMonth, reportRange, inRange, sourceState, loadMerch, loadSources, buildReport,
        kpisHtml, reportHtml, shellHtml, csvFor, exportCsv, createState, reload, onClick, onChange, mount, show
    };
    if (typeof module === 'object' && module && module.exports) module.exports = api;

    const admin = root.WeOtziStudioAdmin;
    if (admin && typeof admin.register === 'function') admin.register(TAB, { mount, show });
})();
