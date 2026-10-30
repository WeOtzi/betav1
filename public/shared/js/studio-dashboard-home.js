// ============================================
// We Ötzi — Panel de estudio · Inicio (W-HOME)
// Pestaña 'inicio' (la que abre el panel): lo que el estudio tiene pendiente
// y los números del mes.
//
// Contrato: docs/plans/2026-10-30-estudios-plataforma.md → "Módulos › Inicio".
//   - Tarjetas de pendientes, cada una con su enlace vía ctx.navigate:
//     solicitudes y cambios pedidos (más contraofertas), contratos enviados /
//     por vencer (3 días o menos) / vencidos, citas de hoy y de mañana, stock
//     bajo, pedidos de reposición en camino o por recibir (y totales
//     actualizados por el proveedor) y spots con postulaciones nuevas.
//   - KPIs del mes por moneda: tatuajes, ingreso del estudio y gastos.
//   - Cada fuente se lee por separado y nunca frena a las demás. Si falla por
//     "migración pendiente" (Reglas transversales §5) o el repo no tiene el
//     método, su tarjeta se oculta. Otro error deja la tarjeta visible con
//     "No pudimos cargar este dato".
//
// Datos solo vía window.WeotziData (studios-repo, studio-contracts-repo,
// studio-finance-repo, supplies-repo). Todo texto que viene de datos pasa por
// WeOtziStudioKit.escapeHtml; el dinero siempre se agrupa por moneda.
// ============================================

(function () {
    'use strict';

    const TAB = 'inicio';
    const TAB_PATTERN = /^[a-z]+$/;
    const SOON_DAYS = 3;                 // "por vencer": 3 días o menos
    const EXPIRED_WINDOW_DAYS = 30;      // contratos vencidos que todavía se muestran
    const DAY_MS = 86400000;
    const MAX_LINES = 3;                 // detalle por tarjeta antes de "y N más"
    const MAX_SPOTS = 12;                // spots abiertos que se revisan por visita
    const CONTRACT_STATUSES = ['draft', 'sent', 'signed', 'expired'];
    const ORDER_STATUSES = ['confirmed', 'shipped', 'delivered'];
    const MISSING_SCHEMA_CODES = ['PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', '42703', '42883', '42P01'];
    const MISSING = Object.freeze({ state: 'missing' });

    const COPY = {
        loadError: 'No pudimos cargar este dato.',
        partialError: 'Parte de este dato no se pudo cargar.',
        nothingPending: 'Nada pendiente.',
        loadingPending: 'Buscando pendientes…',
        loadingMonth: 'Calculando el mes…',
        failed: 'No pudimos cargar el inicio. Tocá “Actualizar” para reintentar.'
    };

    function kit() { return window.WeOtziStudioKit || null; }
    function esc(v) { return kit().escapeHtml(v); }
    function escAttr(v) { return kit().escapeAttr(v); }

    function toNum(v) {
        if (v == null || v === '' || typeof v === 'boolean') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    function ts(v) {
        const date = v ? kit().toDate(v) : null;
        return date ? date.getTime() : null;
    }
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
    function artistName(artist) {
        if (!artist) return '';
        return String(artist.name || (artist.username ? '@' + artist.username : '')).trim();
    }

    // -------------------------------------------------------------
    // Fuentes: cada lectura se resuelve en
    //   {state:'ok', rows, partial?} | {state:'missing'} | {state:'error', error}
    // -------------------------------------------------------------
    function isMissing(err) {
        const k = kit();
        if (k && typeof k.isMissingSchema === 'function') return k.isMissingSchema(err);
        const code = String((err && (err.code || (err.cause && err.cause.code))) || '');
        return MISSING_SCHEMA_CODES.includes(code);
    }

    // Llama D[ns][name](...args) si existe; si no, undefined (= migración o
    // repo pendiente). No captura: settleSource se ocupa de los errores.
    function call(D, ns, name, ...args) {
        const repo = D && D[ns];
        if (!repo || typeof repo[name] !== 'function') return undefined;
        return repo[name](...args);
    }

    async function settleSource(read) {
        let res;
        try {
            res = await read();
        } catch (error) {
            return isMissing(error) ? MISSING : { state: 'error', error };
        }
        if (res == null) return MISSING; // método ausente
        if (res.unavailable) return MISSING;
        if (res.error) return isMissing(res.error) ? MISSING : { state: 'error', error: res.error };
        return { state: 'ok', rows: Array.isArray(res.data) ? res.data.filter(Boolean) : [] };
    }

    // Spots abiertos con postulaciones en estado 'pending' (Nueva). Solo se
    // consultan los spots con application_count > 0 (o desconocido).
    async function loadSpotsWithNewApplications(D, studioId) {
        const spots = await settleSource(() => call(D, 'StudioSpots', 'listByStudio', studioId));
        if (spots.state !== 'ok') return spots;
        const open = spots.rows
            .filter(s => s.status === 'open' && (toNum(s.application_count) == null || toNum(s.application_count) > 0))
            .slice(0, MAX_SPOTS);
        if (!open.length) return { state: 'ok', rows: [] };
        const results = await Promise.all(open.map(s => settleSource(() => call(D, 'StudioSpots', 'listApplications', s.id))));
        const okCount = results.filter(r => r.state === 'ok').length;
        if (!okCount) return results.find(r => r.state === 'error') || MISSING;
        return {
            state: 'ok',
            partial: okCount < results.length,
            rows: open.map((s, i) => ({
                id: s.id,
                title: s.title,
                newCount: results[i].state === 'ok' ? results[i].rows.filter(a => a.status === 'pending').length : 0
            }))
        };
    }

    // Rangos locales: hoy 00:00 → pasado mañana 00:00 y el mes calendario.
    function ranges(now) {
        const k = kit();
        const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
        const month = k.periodRange('this_month', null, now);
        return { fromIso: startToday.toISOString(), toIso: endTomorrow.toISOString(), monthFrom: month.from, monthTo: month.to };
    }

    async function collectSources(ctx, now) {
        const D = (ctx && ctx.data) || window.WeotziData || {};
        const id = ctx && ctx.studioId;
        const r = ranges(now);
        const [requests, changes, counters, contracts, bookings, stock, orders, spots, metrics, expenses] = await Promise.all([
            settleSource(() => call(D, 'StudioMemberships', 'listRequestsForStudio', id)),
            settleSource(() => call(D, 'StudioMemberships', 'listChangeRequestsForStudio', id)),
            settleSource(() => call(D, 'StudioSpots', 'listArtistCounterOffersForStudio', id)),
            settleSource(() => call(D, 'StudioContracts', 'listForStudio', id, { status: CONTRACT_STATUSES })),
            settleSource(() => call(D, 'StudioOps', 'listBookingsRange', id, r.fromIso, r.toIso)),
            settleSource(() => call(D, 'StudioOps', 'listInventoryItems', id)),
            settleSource(() => call(D, 'Supplies', 'listOrdersForStudio', id, { status: ORDER_STATUSES })),
            loadSpotsWithNewApplications(D, id),
            settleSource(() => call(D, 'StudioOps', 'listMonthlyMetrics', id, r.monthFrom, r.monthTo)),
            settleSource(() => call(D, 'StudioFinance', 'monthlyByCategory', id, r.monthFrom, r.monthTo))
        ]);
        return { requests, changes, counters, contracts, bookings, stock, orders, spots, metrics, expenses };
    }

    // -------------------------------------------------------------
    // Tarjetas de pendientes (modelos puros)
    // card = {id, tab, params?, label, cta, count, tone, lines[], emptyText,
    //         failed?, partial?}
    // -------------------------------------------------------------
    function rowsOf(source) { return source && source.state === 'ok' ? source.rows : []; }

    // Oculta si todas las fuentes faltan; "failed" si ninguna respondió bien.
    function combine(sources) {
        const list = sources.filter(Boolean);
        if (!list.length || list.every(s => s.state === 'missing')) return { hidden: true };
        const ok = list.filter(s => s.state === 'ok');
        const errors = list.filter(s => s.state === 'error');
        if (!ok.length) return { failed: true };
        return { partial: errors.length > 0 || ok.some(s => s.partial) };
    }

    function finishCard(card, status) {
        if (status.failed) return { ...card, count: null, tone: 'neutral', lines: [], params: undefined, failed: true };
        const lines = (card.lines || []).filter(Boolean);
        const out = { ...card, lines: card.count > 0 ? lines : [] };
        if (status.partial) out.lines = out.lines.concat(COPY.partialError);
        return out;
    }

    function requestsCard(src) {
        const status = combine([src.requests, src.changes, src.counters]);
        if (status.hidden) return null;
        const open = (rows, st) => rows.filter(row => !row.status || row.status === st).length;
        const requests = open(rowsOf(src.requests), 'requested');
        const changes = open(rowsOf(src.changes), 'pending');
        const counters = open(rowsOf(src.counters), 'pending');
        return finishCard({
            id: 'solicitudes', tab: 'solicitudes', label: 'Solicitudes', cta: 'Ver solicitudes',
            count: requests + changes + counters,
            tone: 'warning',
            emptyText: 'No hay altas, cambios ni contraofertas esperando.',
            lines: [
                requests && plural(requests, 'alta para aprobar', 'altas para aprobar'),
                changes && plural(changes, 'cambio pedido', 'cambios pedidos'),
                counters && plural(counters, 'contraoferta', 'contraofertas')
            ]
        }, status);
    }

    function contractKeys(c) {
        const keys = [];
        if (c.membership_id) keys.push('m:' + c.membership_id);
        if (c.application_id) keys.push('a:' + c.application_id);
        if (c.contract_number) keys.push('n:' + c.contract_number);
        return keys;
    }

    // waiting = enviados sin firmar y en plazo; expiringSoon = de esos, los que
    // vencen en 3 días o menos; endingSoon = firmados cuya vigencia termina en
    // 3 días o menos; overdue = enviados con el plazo pasado (todavía sin
    // expireOverdue) y vencidos de los últimos 30 días que nadie reemplazó.
    function classifyContracts(rows, now) {
        const k = kit();
        const nowMs = now.getTime();
        const out = { waiting: [], expiringSoon: [], endingSoon: [], overdue: [] };
        const list = (Array.isArray(rows) ? rows : []).filter(Boolean);
        const latestOpen = new Map(); // clave -> created_at más reciente de un draft/sent/signed
        list.forEach(c => {
            if (!['draft', 'sent', 'signed'].includes(c.status)) return;
            const created = ts(c.created_at) || 0;
            contractKeys(c).forEach(key => latestOpen.set(key, Math.max(latestOpen.has(key) ? latestOpen.get(key) : -1, created)));
        });
        list.forEach(c => {
            const exp = ts(c.expires_at);
            if (c.status === 'sent') {
                if (exp != null && exp < nowMs) { out.overdue.push(c); return; }
                out.waiting.push(c);
                const days = exp == null ? null : k.daysUntil(c.expires_at, now);
                if (days != null && days <= SOON_DAYS) out.expiringSoon.push(c);
            } else if (c.status === 'expired') {
                if (exp == null || nowMs - exp > EXPIRED_WINDOW_DAYS * DAY_MS) return;
                const created = ts(c.created_at) || 0;
                const replaced = contractKeys(c).some(key => latestOpen.has(key) && latestOpen.get(key) > created);
                if (!replaced) out.overdue.push(c);
            } else if (c.status === 'signed' && c.end_date) {
                const days = k.daysUntil(c.end_date, now);
                if (days != null && days >= 0 && days <= SOON_DAYS) out.endingSoon.push(c);
            }
        });
        return out;
    }

    function contractsCard(src, now) {
        const status = combine([src.contracts]);
        if (status.hidden) return null;
        const c = classifyContracts(rowsOf(src.contracts), now);
        const soon = c.expiringSoon.length + c.endingSoon.length;
        return finishCard({
            id: 'contratos', tab: 'contratos', label: 'Contratos', cta: 'Ver contratos',
            count: c.waiting.length + c.endingSoon.length + c.overdue.length,
            tone: c.overdue.length ? 'danger' : (soon ? 'warning' : 'info'),
            emptyText: 'No hay contratos esperando firma ni por vencer.',
            lines: [
                c.waiting.length && plural(c.waiting.length, 'contrato esperando firma', 'contratos esperando firma'),
                c.expiringSoon.length && plural(c.expiringSoon.length, 'vence', 'vencen') + ' en 3 días o menos',
                c.endingSoon.length && plural(c.endingSoon.length, 'termina', 'terminan') + ' su vigencia en 3 días o menos',
                c.overdue.length && plural(c.overdue.length, 'vencido sin firmar', 'vencidos sin firmar')
            ]
        }, status);
    }

    function bookingWho(b) {
        const client = String(b.client_name || '').trim();
        const artist = artistName(b.artists_db);
        if (client && artist) return client + ' con ' + artist;
        if (artist) return 'Cita con ' + artist;
        return client || 'Cita';
    }

    function agendaCard(src, now) {
        const status = combine([src.bookings]);
        if (status.hidden) return null;
        const k = kit();
        const nowMs = now.getTime();
        const today = k.toDateInput(now);
        const tomorrow = k.toDateInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12));
        const rows = rowsOf(src.bookings).filter(b => !b.status || b.status === 'confirmed');
        let todayCount = 0;
        let tomorrowCount = 0;
        rows.forEach(b => {
            const day = k.toDateInput(b.starts_at);
            if (!day) return;
            if (day <= today) todayCount += 1; // incluye la que empezó antes y sigue hoy
            else if (day === tomorrow) tomorrowCount += 1;
        });
        const next = rows
            .filter(b => (ts(b.ends_at) || ts(b.starts_at) || 0) > nowMs)
            .sort((a, b) => (ts(a.starts_at) || 0) - (ts(b.starts_at) || 0))[0];
        let nextLine = null;
        if (next) {
            const day = k.toDateInput(next.starts_at);
            nextLine = 'Próxima: ' + (day === tomorrow ? 'mañana' : 'hoy') + ' ' + k.fmtTime(next.starts_at) + ' · ' + bookingWho(next);
        }
        return finishCard({
            id: 'agenda', tab: 'agenda', label: 'Citas de hoy y mañana', cta: 'Ver agenda',
            count: todayCount + tomorrowCount,
            tone: 'info',
            emptyText: 'Sin citas para hoy ni para mañana.',
            lines: ['Hoy: ' + plural(todayCount, 'cita', 'citas'), 'Mañana: ' + plural(tomorrowCount, 'cita', 'citas'), nextLine]
        }, status);
    }

    function needsReorder(item) {
        if (item.needs_reorder != null) return item.needs_reorder === true;
        const qty = toNum(item.quantity_on_hand);
        const min = toNum(item.reorder_level);
        return qty != null && min != null && qty <= min;
    }

    function stockCard(src) {
        const status = combine([src.stock]);
        if (status.hidden) return null;
        const k = kit();
        const low = rowsOf(src.stock).filter(needsReorder)
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
        const lines = low.slice(0, MAX_LINES).map(item => {
            const unit = String(item.unit || '').trim();
            return (String(item.name || '').trim() || 'Ítem sin nombre') + ': '
                + k.fmtNumber(toNum(item.quantity_on_hand) || 0) + (unit ? ' ' + unit : '')
                + ' (mín. ' + k.fmtNumber(item.reorder_level) + ')';
        });
        if (low.length > MAX_LINES) lines.push('y ' + plural(low.length - MAX_LINES, 'ítem más', 'ítems más'));
        return finishCard({
            id: 'stock', tab: 'inventory', label: 'Stock bajo', cta: 'Ver inventario',
            count: low.length,
            tone: low.some(item => (toNum(item.quantity_on_hand) || 0) <= 0) ? 'danger' : 'warning',
            emptyText: 'Todo el stock está por encima del mínimo.',
            lines
        }, status);
    }

    // En camino = despachados; por recibir = entregados por el proveedor;
    // total actualizado = confirmados a los que el proveedor les sumó envío.
    function restockCard(src) {
        const status = combine([src.orders]);
        if (status.hidden) return null;
        const k = kit();
        const rows = rowsOf(src.orders);
        const shipped = rows.filter(o => o.status === 'shipped');
        const delivered = rows.filter(o => o.status === 'delivered');
        const updated = rows.filter(o => o.status === 'confirmed' && (toNum(o.shipping_amount) || 0) > 0);
        const counted = shipped.concat(delivered, updated);
        return finishCard({
            id: 'reposicion', tab: 'reposicion', label: 'Pedidos de reposición', cta: 'Ver pedidos',
            // Un solo pedido abre su detalle; si no, Reposición abre en "Mis
            // pedidos" (sin {view} abriría en Sugerencias si hay faltantes).
            params: counted.length === 1 && counted[0].id ? { order: counted[0].id } : { view: 'pedidos' },
            count: counted.length,
            tone: delivered.length ? 'warning' : 'info',
            emptyText: 'No hay pedidos en camino ni por recibir.',
            lines: [
                shipped.length && plural(shipped.length, 'pedido en camino', 'pedidos en camino'),
                delivered.length && plural(delivered.length, 'entregado: registrá la recepción', 'entregados: registrá la recepción'),
                updated.length && plural(updated.length, 'con total actualizado por el proveedor', 'con total actualizado por el proveedor')
                    + ': ' + k.fmtTotals(k.sumByCurrency(updated, 'total', 'currency'))
            ]
        }, status);
    }

    function spotsCard(src) {
        const status = combine([src.spots]);
        if (status.hidden) return null;
        const withNew = rowsOf(src.spots).filter(s => s.newCount > 0).sort((a, b) => b.newCount - a.newCount);
        const lines = withNew.slice(0, MAX_LINES).map(s =>
            (String(s.title || '').trim() || 'Spot sin título') + ': ' + plural(s.newCount, 'nueva', 'nuevas'));
        if (withNew.length > MAX_LINES) lines.push('y ' + plural(withNew.length - MAX_LINES, 'spot más', 'spots más'));
        return finishCard({
            id: 'spots', tab: 'spots', label: 'Postulaciones nuevas', cta: 'Ver spots',
            count: withNew.reduce((n, s) => n + s.newCount, 0),
            tone: 'warning',
            emptyText: 'No hay postulaciones nuevas en tus spots.',
            lines
        }, status);
    }

    // -------------------------------------------------------------
    // KPIs del mes (por moneda)
    // -------------------------------------------------------------
    function monthKpis(src) {
        const k = kit();
        const items = [];
        const metrics = src.metrics;
        if (metrics && metrics.state !== 'missing') {
            if (metrics.state === 'error') {
                items.push({ id: 'tatuajes', label: 'Tatuajes', value: '—', hint: COPY.loadError });
                items.push({ id: 'ingreso', label: 'Ingreso del estudio', value: '—', hint: COPY.loadError });
            } else {
                const rows = metrics.rows;
                const jobs = rows.reduce((n, row) => n + (toNum(row.jobs_count) || 0), 0);
                items.push({
                    id: 'tatuajes', label: 'Tatuajes', value: k.fmtNumber(jobs, 0),
                    hint: jobs ? 'Bruto: ' + k.fmtTotals(k.sumByCurrency(rows, 'gross_amount', 'currency')) : 'Todavía no hay tatuajes completados este mes.'
                });
                items.push({
                    id: 'ingreso', label: 'Ingreso del estudio',
                    valueHtml: k.fmtTotalsHtml(k.sumByCurrency(rows, 'studio_net', 'currency'), { empty: 'Sin ingresos' }),
                    hint: 'Lo que le queda al estudio por los tatuajes completados.'
                });
            }
        }
        const expenses = src.expenses;
        if (expenses && expenses.state !== 'missing') {
            if (expenses.state === 'error') {
                items.push({ id: 'gastos', label: 'Gastos', value: '—', hint: COPY.loadError });
            } else {
                const rows = expenses.rows.filter(row => row.entry_type === 'expense');
                items.push({
                    id: 'gastos', label: 'Gastos',
                    valueHtml: k.fmtTotalsHtml(k.sumByCurrency(rows, 'total', 'currency'), { empty: 'Sin gastos' }),
                    hint: 'Registrados en Finanzas.'
                });
            }
        }
        return items;
    }

    function buildModel(src, now) {
        const k = kit();
        const cards = [
            requestsCard(src),
            contractsCard(src, now),
            agendaCard(src, now),
            stockCard(src),
            restockCard(src),
            spotsCard(src)
        ].filter(Boolean);
        return { cards, kpis: monthKpis(src), monthLabel: k.monthLabel(k.monthKey(now)) };
    }

    // -------------------------------------------------------------
    // Render
    // -------------------------------------------------------------
    function summaryText(cards) {
        if (!cards.length) return 'Todavía no hay datos para mostrar acá.';
        const total = cards.reduce((n, c) => n + (c.failed ? 0 : (c.count || 0)), 0);
        const failed = cards.some(c => c.failed || c.partial);
        const text = total > 0
            ? 'Tenés ' + plural(total, 'novedad', 'novedades') + ' para revisar.'
            : 'Estás al día: no hay nada pendiente.';
        return failed ? text + ' Algunos datos no se pudieron cargar.' : text;
    }

    function cardHtml(card) {
        const k = kit();
        const tone = !card.failed && card.count > 0 ? card.tone : '';
        const lines = card.failed ? [COPY.loadError] : (card.lines.length ? card.lines : [card.emptyText || COPY.nothingPending]);
        return '<a class="sk-kpi' + (tone ? ' sk-kpi--' + escAttr(tone) : '') + '" href="#' + escAttr(card.tab) + '"'
            + ' data-home-card="' + escAttr(card.id) + '" data-nav="' + escAttr(card.tab) + '">'
            + '<span class="sk-kpi__label">' + esc(card.label) + '</span>'
            + '<span class="sk-kpi__value">' + esc(card.failed ? '—' : k.fmtNumber(card.count, 0)) + '</span>'
            + lines.map(line => '<small class="sk-kpi__hint">' + esc(line) + '</small>').join('')
            + '<small class="sk-kpi__hint" style="color:var(--fg);text-decoration:underline;">' + esc(card.cta)
            + ' <span aria-hidden="true">→</span></small>'
            + '</a>';
    }

    function pendingSectionHtml(model, opts) {
        const body = !model
            ? '<p class="studio-help" data-home-loading>' + esc(opts && opts.failed ? COPY.failed : COPY.loadingPending) + '</p>'
            : '<p class="studio-help" data-home-summary>' + esc(summaryText(model.cards)) + '</p>'
                + (model.cards.length ? '<div class="sk-kpis" data-home-cards>' + model.cards.map(cardHtml).join('') + '</div>' : '');
        return '<section class="sk-section" data-home-section="pending" aria-labelledby="home-pending-title">'
            + '<div class="sk-section-head">'
            + '<h2 class="sk-section-title" id="home-pending-title">Pendientes</h2>'
            + '<button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-home-refresh>Actualizar</button>'
            + '</div>'
            + body
            + '</section>';
    }

    function monthSectionHtml(model, monthLabel, opts) {
        const k = kit();
        if (model ? !model.kpis.length : (opts && opts.failed)) return '';
        const body = model
            ? k.kpis(model.kpis.map(item => ({ label: item.label, value: item.value, valueHtml: item.valueHtml, hint: item.hint })))
            : '<p class="studio-help">' + esc(COPY.loadingMonth) + '</p>';
        return '<section class="sk-section" data-home-section="month" aria-labelledby="home-month-title">'
            + '<div class="sk-section-head">'
            + '<h2 class="sk-section-title" id="home-month-title">Este mes</h2>'
            + '<span class="studio-help">' + esc(monthLabel) + ' · por moneda</span>'
            + '</div>'
            + body
            + '<div class="sk-toolbar">'
            + '<a class="studio-btn studio-btn-ghost sk-btn-sm" href="#finanzas" data-nav="finanzas">Ver finanzas</a>'
            + '<a class="studio-btn studio-btn-ghost sk-btn-sm" href="#analytics" data-nav="analytics">Ver reportes</a>'
            + '</div>'
            + '</section>';
    }

    function renderHome(model, opts) {
        const k = kit();
        const label = model ? model.monthLabel : k.monthLabel(k.monthKey(new Date()));
        return pendingSectionHtml(model, opts) + monthSectionHtml(model, label, opts);
    }

    // -------------------------------------------------------------
    // Montaje y carga
    // -------------------------------------------------------------
    const state = { loading: null, model: null };

    function setBusy(root, busy) {
        if (!root || typeof root.setAttribute !== 'function') return;
        if (busy) root.setAttribute('aria-busy', 'true');
        else if (typeof root.removeAttribute === 'function') root.removeAttribute('aria-busy');
    }

    // Una sola carga en vuelo; mientras tanto queda lo último que se pintó.
    // Nunca rechaza: el shell muestra un toast si show() falla.
    function load(root, ctx) {
        if (state.loading) return state.loading;
        setBusy(root, true);
        state.loading = (async () => {
            try {
                const now = new Date();
                const sources = await collectSources(ctx, now);
                state.model = buildModel(sources, now);
                root.innerHTML = renderHome(state.model);
            } catch (err) {
                console.error('[studio-home] no se pudo cargar el inicio', err);
                if (!state.model) root.innerHTML = renderHome(null, { failed: true });
            } finally {
                setBusy(root, false);
                state.loading = null;
            }
        })();
        return state.loading;
    }

    function focusRefresh(root) {
        const btn = typeof root.querySelector === 'function' ? root.querySelector('[data-home-refresh]') : null;
        if (btn && typeof btn.focus === 'function') btn.focus();
    }

    function onClick(event, root, ctx) {
        const target = event && event.target && typeof event.target.closest === 'function' ? event.target : null;
        if (!target) return;
        const refreshBtn = target.closest('[data-home-refresh]');
        if (refreshBtn) {
            event.preventDefault();
            const k = kit();
            const run = () => load(root, ctx).then(() => focusRefresh(root));
            if (k && typeof k.guarded === 'function') k.guarded(refreshBtn, run);
            else run();
            return;
        }
        const link = target.closest('[data-nav]');
        if (!link || (typeof root.contains === 'function' && !root.contains(link))) return;
        // Ctrl/Cmd/Shift-click y botón del medio: abrir en otra pestaña con el hash.
        if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const tab = String(link.getAttribute('data-nav') || '');
        if (!TAB_PATTERN.test(tab) || !ctx || typeof ctx.navigate !== 'function') return;
        event.preventDefault();
        const cardId = link.getAttribute('data-home-card');
        const card = cardId && state.model ? state.model.cards.find(c => c.id === cardId) : null;
        ctx.navigate(tab, card && card.params ? card.params : undefined);
    }

    function mount(root, ctx) {
        if (!kit()) throw new Error('No pudimos cargar las herramientas del panel. Recargá la página.');
        root.innerHTML = renderHome(null);
        root.addEventListener('click', event => onClick(event, root, ctx));
    }

    // Se llama en cada visita a la pestaña: vuelve a leer todo.
    function show(root, ctx) {
        return load(root, ctx);
    }

    const admin = window.WeOtziStudioAdmin;
    if (admin && typeof admin.register === 'function') admin.register(TAB, { mount, show });
    else console.warn('[studio-home] falta window.WeOtziStudioAdmin (studio-dashboard.js debe cargarse antes).');
})();
