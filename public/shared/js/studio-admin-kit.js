// ============================================
// We Ötzi — Kit compartido del panel de estudio (y de Supplies)
// window.WeOtziStudioKit · también exportable a Node (module.exports).
//
// Contrato: docs/plans/2026-10-30-estudios-plataforma.md → "Kit compartido".
//   - Formato: dinero siempre agrupado por moneda, fechas locales (las fechas
//     SQL 'YYYY-MM-DD' son de calendario, no instantes UTC), períodos.
//   - Etiquetas en español para cada estado/enum del contrato + badges.
//   - UI: toasts, confirm/prompt, modal y drawer sobre <dialog> nativo (foco
//     atrapado, Esc, foco restaurado), empty states, tablas y barras HTML/CSS.
//   - Utilidades: guarded, unwrap, friendlyError, CSV (BOM + ';'), readForm,
//     listEditor y postNotify (nunca lanza).
//
// Nada se resuelve en el nivel superior salvo window/globalThis/module:
// document, fetch, URL, Blob y setTimeout se buscan al usarse, para que el
// archivo corra en Node y en una VM de tests sin DOM.
// Las funciones que devuelven HTML (badge, renderTable, emptyState, barChart,
// kpis, optionsHtml) escapan todo lo que reciben como texto; solo los campos
// *Html / render() / body de modal se insertan crudos (ya escapados por quien llama).
// ============================================

(function (root, factory) {
    'use strict';
    const kit = factory(root);
    if (typeof module === 'object' && module && module.exports) module.exports = kit;
    if (typeof window !== 'undefined' && window) window.WeOtziStudioKit = kit;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
    'use strict';

    const DEFAULT_CURRENCY = 'USD';
    const ISO_CURRENCIES = ['ARS', 'USD', 'EUR', 'BRL', 'CLP', 'MXN', 'COP', 'UYU', 'PEN'];
    const NBSP = ' ';
    const TONES = ['neutral', 'info', 'success', 'warning', 'danger'];
    const MISSING_SCHEMA_CODES = ['PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', '42703', '42883', '42P01'];
    const MISSING_SCHEMA_MESSAGE = 'Esta función todavía no está disponible (falta aplicar una migración).';
    const GENERIC_ERROR = 'No pudimos completar la acción. Intentá de nuevo.';
    const NETWORK_ERROR = 'No pudimos conectarnos con el servidor. Revisá tu conexión e intentá de nuevo.';
    const NETWORK_RE = /failed to fetch|networkerror|load failed|network request failed/i;

    // -------------------------------------------------------------
    // Entorno (resuelto al usarse)
    // -------------------------------------------------------------
    function getDoc() {
        if (typeof document !== 'undefined' && document) return document;
        return (root && root.document) || null;
    }
    function later(fn, ms) {
        const st = typeof setTimeout === 'function' ? setTimeout : (root && root.setTimeout);
        return typeof st === 'function' ? st(fn, ms) : null;
    }
    function cancelLater(id) {
        const ct = typeof clearTimeout === 'function' ? clearTimeout : (root && root.clearTimeout);
        if (id != null && typeof ct === 'function') ct(id);
    }
    function basePath() {
        if (root && root.WEOTZI_BASE_PATH) return String(root.WEOTZI_BASE_PATH).replace(/\/$/, '');
        const pathname = (root && root.location && root.location.pathname) || '';
        return pathname.startsWith('/beta/') ? '/beta' : '';
    }
    function appUrl(path) {
        const p = String(path || '');
        if (!p.startsWith('/') || p.startsWith('//')) return p;
        const base = basePath();
        if (base && (p === base || p.startsWith(base + '/'))) return p;
        return base + p;
    }

    // -------------------------------------------------------------
    // HTML / URLs
    // -------------------------------------------------------------
    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escapeAttr(v) { return escapeHtml(v).replace(/`/g, '&#96;'); }

    // Solo http(s) con host. Cualquier otro protocolo (javascript:, data:, …),
    // rutas relativas o basura devuelven null.
    function safeUrl(u) {
        if (u == null) return null;
        const s = String(u).trim();
        if (!s || !/^https?:\/\//i.test(s) || /[\u0000-\u001f\u007f]/.test(s)) return null;
        const U = typeof URL === 'function' ? URL : (root && root.URL);
        if (typeof U === 'function') {
            try {
                const parsed = new U(s);
                return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname ? parsed.href : null;
            } catch (_) { return null; }
        }
        return /^https?:\/\/[^\s/?#]+[^\s]*$/i.test(s) ? s : null;
    }

    // Atributos HTML desde un objeto ({'data-id': 1, disabled: true}). Ignora
    // nombres inválidos y handlers on*.
    function htmlAttrs(obj) {
        if (!obj || typeof obj !== 'object') return '';
        return Object.keys(obj)
            .filter(k => /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(k) && !/^on/i.test(k) && obj[k] != null && obj[k] !== false)
            .map(k => (obj[k] === true ? ' ' + k : ' ' + k + '="' + escapeAttr(obj[k]) + '"'))
            .join('');
    }

    function pick(row, key) {
        if (row == null || key == null) return undefined;
        if (typeof key === 'function') return key(row);
        if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
        return String(key).split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), row);
    }

    // -------------------------------------------------------------
    // Números y dinero
    // -------------------------------------------------------------
    function toNumber(v) {
        if (v == null || v === '' || typeof v === 'boolean') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    function normalizeCurrency(cur) {
        const code = String(cur == null ? '' : cur).trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
        return code || DEFAULT_CURRENCY;
    }
    function hasCents(n) { return Math.abs(Math.round(n * 100)) % 100 !== 0; }
    function groupNumber(n, decimals) {
        const fixed = Math.abs(n).toFixed(decimals);
        const parts = fixed.split('.');
        const grouped = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return (n < 0 && Number(fixed) !== 0 ? '-' : '') + grouped + (parts[1] ? ',' + parts[1] : '');
    }

    const formatterCache = new Map();
    function currencyFormatter(code, wantCents) {
        const key = code + '|' + (wantCents ? 1 : 0);
        if (formatterCache.has(key)) return formatterCache.get(key);
        const base = new Intl.NumberFormat('es-AR', { style: 'currency', currency: code });
        const max = base.resolvedOptions().maximumFractionDigits;
        const fmt = new Intl.NumberFormat('es-AR', {
            style: 'currency', currency: code,
            minimumFractionDigits: wantCents ? max : 0,
            maximumFractionDigits: wantCents ? max : 0
        });
        formatterCache.set(key, fmt);
        return fmt;
    }

    // "$ 1.234" / "US$ 1.234,50". Sin decimales si el importe es entero.
    // Fallback (código inválido o sin Intl): "$ 1.234 ARS". La salida es HTML-safe.
    function fmtMoney(n, cur, opts) {
        const empty = opts && opts.empty != null ? opts.empty : '—';
        const amount = toNumber(n);
        if (amount == null) return empty;
        const code = normalizeCurrency(cur);
        const wantCents = hasCents(amount);
        try {
            if (typeof Intl === 'undefined' || !Intl.NumberFormat) throw new Error('sin Intl');
            return currencyFormatter(code, wantCents).format(amount);
        } catch (_) {
            return '$' + NBSP + groupNumber(amount, wantCents ? 2 : 0) + NBSP + code;
        }
    }
    function fmtNumber(n, decimals) {
        const v = toNumber(n);
        if (v == null) return '—';
        const d = decimals != null ? decimals : (hasCents(v) ? 2 : 0);
        return groupNumber(v, d);
    }
    function fmtPercent(n, decimals) {
        const v = toNumber(n);
        if (v == null) return '—';
        return fmtNumber(v, decimals != null ? decimals : (Math.round(v * 100) % 100 !== 0 ? 2 : 0)) + NBSP + '%';
    }

    // Totales por moneda: objeto plano {ARS: 1234.5, USD: 10} (claves ordenadas)
    // que además responde como un Map (get/has/forEach/size/entries/for…of),
    // así sirve tanto para Object.entries(t) como para t.get('ARS').
    function withMapApi(obj) {
        const hidden = (name, value) => Object.defineProperty(obj, name, { value, enumerable: false, configurable: true, writable: true });
        hidden('get', cur => obj[normalizeCurrency(cur)]);
        hidden('has', cur => Object.prototype.hasOwnProperty.call(obj, normalizeCurrency(cur)));
        hidden('forEach', cb => Object.keys(obj).forEach(k => cb(obj[k], k, obj)));
        hidden('entries', () => Object.keys(obj).map(k => [k, obj[k]]));
        hidden('keys', () => Object.keys(obj));
        hidden('values', () => Object.keys(obj).map(k => obj[k]));
        if (typeof Symbol === 'function' && Symbol.iterator) hidden(Symbol.iterator, function* () { for (const k of Object.keys(obj)) yield [k, obj[k]]; });
        Object.defineProperty(obj, 'size', { get: () => Object.keys(obj).length, enumerable: false, configurable: true });
        return obj;
    }
    function totalsEntries(map) {
        if (!map) return [];
        if (Array.isArray(map)) return map.filter(p => Array.isArray(p) && p.length >= 2).map(p => [normalizeCurrency(p[0]), Number(p[1]) || 0]);
        if (typeof Map === 'function' && map instanceof Map) return Array.from(map.entries()).map(([k, v]) => [normalizeCurrency(k), Number(v) || 0]);
        if (typeof map === 'object') return Object.keys(map).map(k => [normalizeCurrency(k), Number(map[k]) || 0]);
        return [];
    }
    function centsToTotals(cents) {
        const out = {};
        Object.keys(cents).sort().forEach(cur => { out[cur] = cents[cur] / 100; });
        return withMapApi(out);
    }
    function sumByCurrency(rows, amountKey, currencyKey) {
        const aKey = amountKey == null ? 'amount' : amountKey;
        const cKey = currencyKey == null ? 'currency' : currencyKey;
        const cents = {};
        (Array.isArray(rows) ? rows : []).forEach(row => {
            if (!row) return;
            const amount = toNumber(pick(row, aKey));
            if (amount == null) return;
            const cur = normalizeCurrency(pick(row, cKey));
            cents[cur] = (cents[cur] || 0) + Math.round(amount * 100);
        });
        return centsToTotals(cents);
    }
    // a + sign·b por moneda (sign = -1 para restar). Acepta objetos, Maps o pares.
    function mergeTotals(a, b, sign) {
        const s = sign == null ? 1 : Number(sign) || 0;
        const cents = {};
        totalsEntries(a).forEach(([cur, v]) => { cents[cur] = (cents[cur] || 0) + Math.round(v * 100); });
        totalsEntries(b).forEach(([cur, v]) => { cents[cur] = (cents[cur] || 0) + s * Math.round(v * 100); });
        return centsToTotals(cents);
    }
    function fmtTotals(map, opts) {
        const o = opts || {};
        const parts = totalsEntries(map).sort((x, y) => x[0].localeCompare(y[0])).map(([cur, v]) => fmtMoney(v, cur));
        return parts.length ? parts.join(o.separator != null ? o.separator : ' · ') : (o.empty != null ? o.empty : '—');
    }
    // Una moneda por línea, para KPIs: <span class="sk-total">…</span>…
    function fmtTotalsHtml(map, opts) {
        const o = opts || {};
        const parts = totalsEntries(map).sort((x, y) => x[0].localeCompare(y[0]))
            .map(([cur, v]) => '<span class="sk-total' + (v < 0 ? ' is-negative' : '') + '">' + escapeHtml(fmtMoney(v, cur)) + '</span>');
        return parts.length ? parts.join('') : '<span class="sk-total sk-muted">' + escapeHtml(o.empty != null ? o.empty : '—') + '</span>';
    }

    // -------------------------------------------------------------
    // Fechas (locales; 'YYYY-MM-DD' es fecha de calendario)
    // -------------------------------------------------------------
    const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
    const pad2 = n => String(n).padStart(2, '0');
    const capitalize = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

    function toDate(value) {
        if (value == null || value === '') return null;
        if (value instanceof Date || Object.prototype.toString.call(value) === '[object Date]') {
            const d = new Date(value.getTime());
            return Number.isNaN(d.getTime()) ? null : d;
        }
        if (typeof value === 'number') {
            const d = new Date(value);
            return Number.isNaN(d.getTime()) ? null : d;
        }
        const s = String(value).trim();
        let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
        m = /^(\d{4})-(\d{2})$/.exec(s);
        if (m) return new Date(Number(m[1]), Number(m[2]) - 1, 1, 12, 0, 0);
        m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
        if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

    // fmtDate(d) → "30/10/2026". opts.style: 'short' ("30/10"), 'long'
    // ("30 de octubre de 2026"), 'weekday' ("Jue 30/10").
    function fmtDate(d, opts) {
        const date = toDate(d);
        if (!date) return '—';
        const style = opts && opts.style;
        if (style === 'short') return pad2(date.getDate()) + '/' + pad2(date.getMonth() + 1);
        if (style === 'long') return date.getDate() + ' de ' + MONTHS[date.getMonth()] + ' de ' + date.getFullYear();
        if (style === 'weekday') return capitalize(WEEKDAYS_SHORT[date.getDay()]) + ' ' + pad2(date.getDate()) + '/' + pad2(date.getMonth() + 1);
        return pad2(date.getDate()) + '/' + pad2(date.getMonth() + 1) + '/' + date.getFullYear();
    }
    function fmtTime(d) {
        const date = toDate(d);
        return date ? pad2(date.getHours()) + ':' + pad2(date.getMinutes()) : '—';
    }
    function fmtDateTime(d) {
        const date = toDate(d);
        return date ? fmtDate(date) + ' ' + fmtTime(date) : '—';
    }
    // Para <input type="date">.
    function toDateInput(d) {
        if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) return d.trim();
        const date = toDate(d);
        return date ? ymd(date) : '';
    }
    // Para <input type="datetime-local"> (hora local).
    function toLocalInput(d) {
        const date = toDate(d);
        return date ? ymd(date) + 'T' + pad2(date.getHours()) + ':' + pad2(date.getMinutes()) : '';
    }
    // 'YYYY-MM-DDTHH:mm' local → ISO UTC (o null).
    function fromLocalInput(s) {
        if (s == null || String(s).trim() === '') return null;
        const raw = String(s).trim();
        const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw);
        const date = m
            ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0))
            : toDate(raw);
        return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
    }
    function monthKey(d) {
        if (typeof d === 'string' && /^\d{4}-\d{2}(-\d{2})?/.test(d.trim()) && !/[T ]\d{2}:/.test(d)) return d.trim().slice(0, 7);
        const date = toDate(d);
        return date ? date.getFullYear() + '-' + pad2(date.getMonth() + 1) : '';
    }
    // '2026-10' → "Octubre 2026" (opts.short → "Oct 2026").
    function monthLabel(key, opts) {
        const k = monthKey(key);
        const m = /^(\d{4})-(\d{2})$/.exec(k);
        if (!m) return '—';
        const idx = Number(m[2]) - 1;
        if (idx < 0 || idx > 11) return '—';
        return capitalize((opts && opts.short ? MONTHS_SHORT : MONTHS)[idx]) + ' ' + m[1];
    }
    function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    // Días calendario de "now" a d (negativo si ya pasó).
    function daysUntil(d, now) {
        const date = toDate(d);
        if (!date) return null;
        const base = toDate(now) || new Date();
        return Math.round((startOfDay(date) - startOfDay(base)) / 86400000);
    }
    // "hoy", "ayer", "hace 3 días", "en 2 semanas"…
    function fmtRelative(d, now) {
        const days = daysUntil(d, now);
        if (days == null) return '—';
        if (days === 0) return 'hoy';
        if (days === -1) return 'ayer';
        if (days === 1) return 'mañana';
        const abs = Math.abs(days);
        let text;
        if (abs < 14) text = abs + ' días';
        else if (abs < 60) text = Math.round(abs / 7) + ' semanas';
        else if (abs < 730) text = Math.round(abs / 30) + ' meses';
        else text = Math.round(abs / 365) + ' años';
        return days < 0 ? 'hace ' + text : 'en ' + text;
    }

    const PERIOD_PRESETS = ['this_month', 'last_month', 'last_3_months', 'last_6_months', 'last_12_months', 'this_year', 'custom'];

    // periodRange(preset, custom, now) → {preset, label, from, to (YYYY-MM-DD,
    // inclusivos), fromIso, toIso (instantes locales; toIso exclusivo),
    // fromMonth, toMonth ('YYYY-MM-01', para vistas mensuales), months}.
    // Los presets de meses están alineados a meses calendario completos.
    function periodRange(preset, custom, now) {
        const today = toDate(now) || new Date();
        const y = today.getFullYear(), mo = today.getMonth();
        let id = PERIOD_PRESETS.includes(preset) ? preset : 'this_month';
        let start, end;
        const monthsBack = { this_month: 1, last_3_months: 3, last_6_months: 6, last_12_months: 12 };
        if (monthsBack[id]) {
            start = new Date(y, mo - (monthsBack[id] - 1), 1);
            end = new Date(y, mo + 1, 0);
        } else if (id === 'last_month') {
            start = new Date(y, mo - 1, 1);
            end = new Date(y, mo, 0);
        } else if (id === 'this_year') {
            start = new Date(y, 0, 1);
            end = new Date(y, 11, 31);
        } else {
            const c = custom || {};
            const from = toDate(c.from), to = toDate(c.to);
            if (from && to) { start = startOfDay(from); end = startOfDay(to); }
            else if (from) { start = startOfDay(from); end = startOfDay(today); }
            else if (to) { start = new Date(to.getFullYear(), to.getMonth(), 1); end = startOfDay(to); }
            else { start = new Date(y, mo, 1); end = new Date(y, mo + 1, 0); }
            if (start > end) { const t = start; start = end; end = t; }
        }
        const months = [];
        for (let cur = new Date(start.getFullYear(), start.getMonth(), 1); cur <= end && months.length < 240; cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)) {
            months.push(cur.getFullYear() + '-' + pad2(cur.getMonth() + 1));
        }
        const from = ymd(start), to = ymd(end);
        const label = id === 'custom' ? 'Del ' + fmtDate(from) + ' al ' + fmtDate(to) : LABELS.periodPreset[id];
        return {
            preset: id,
            label,
            from,
            to,
            fromIso: new Date(start.getFullYear(), start.getMonth(), start.getDate()).toISOString(),
            toIso: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).toISOString(),
            fromMonth: from.slice(0, 7) + '-01',
            toMonth: to.slice(0, 7) + '-01',
            months
        };
    }

    // -------------------------------------------------------------
    // Etiquetas (español) y tonos de badge
    // -------------------------------------------------------------
    const FINANCE_CATEGORIES = {
        expense: ['rent', 'supplies', 'inventory_purchase', 'salaries', 'artist_payout', 'utilities', 'marketing', 'equipment', 'maintenance', 'taxes', 'fees', 'software', 'other'],
        income: ['chair_rent', 'merch_manual', 'service_other', 'sponsorship', 'other_income']
    };

    const LABELS = {
        membershipStatus: {
            requested: 'Solicitud pendiente',
            pending_invite: 'Invitación pendiente',
            pending_acceptance: 'Esperando aceptación',
            active: 'Activo',
            paused: 'En pausa',
            rejected: 'Rechazado',
            ended: 'Finalizado'
        },
        membershipRole: { resident: 'Residente', guest: 'Guest', itinerant: 'Itinerante', manager: 'Manager' },
        initiatedBy: { studio: 'Estudio', artist: 'Artista' },
        contractStatus: {
            draft: 'Borrador',
            sent: 'Pendiente de firma',
            signed: 'Firmado',
            declined: 'Rechazado',
            cancelled: 'Cancelado',
            terminated: 'Rescindido',
            expired: 'Vencido'
        },
        contractOrigin: {
            spot_application: 'Postulación a spot',
            invitation: 'Invitación del estudio',
            request: 'Solicitud del artista',
            manual: 'Carga manual'
        },
        compensationModel: { percentage: 'Porcentaje', fixed: 'Pago fijo', mixed: 'Mixto' },
        fixedPeriod: { per_session: 'Por sesión', daily: 'Por día', weekly: 'Semanal', monthly: 'Mensual', one_time: 'Pago único' },
        fixedPayer: {
            artist_to_studio: 'Alquiler de puesto: el artista paga al estudio',
            studio_to_artist: 'Pago al artista: el estudio paga'
        },
        fixedPayerShort: { artist_to_studio: 'Alquiler de puesto', studio_to_artist: 'Pago al artista' },
        bookingStatus: { confirmed: 'Confirmada', completed: 'Completada', cancelled: 'Cancelada', no_show: 'No asistió' },
        bookingCreatedByRole: { studio: 'Estudio', support: 'Soporte' },
        busySource: {
            agenda_personal: 'Agenda personal',
            otro_estudio: 'Cita en otro estudio',
            calendar: 'Agenda personal',
            artist_calendar: 'Agenda personal',
            quotation: 'Sesión de cotización',
            quotation_session: 'Sesión de cotización',
            studio_booking: 'Cita en otro estudio',
            other_studio: 'Cita en otro estudio'
        },
        movementKind: {
            restock: 'Reposición',
            consumption: 'Consumo',
            adjustment: 'Ajuste',
            loss: 'Pérdida',
            assignment: 'Entrega a artista',
            return: 'Devolución'
        },
        financeEntryType: { expense: 'Gasto', income: 'Ingreso' },
        financeEntryStatus: { recorded: 'Registrado', voided: 'Anulado' },
        financeCategory: {
            rent: 'Alquiler',
            supplies: 'Insumos',
            inventory_purchase: 'Compra de inventario',
            salaries: 'Sueldos',
            artist_payout: 'Pago fijo a artistas',
            utilities: 'Servicios',
            marketing: 'Marketing',
            equipment: 'Equipamiento',
            maintenance: 'Mantenimiento',
            taxes: 'Impuestos',
            fees: 'Comisiones',
            software: 'Software',
            other: 'Otros gastos',
            chair_rent: 'Alquiler de puesto',
            merch_manual: 'Merch (manual)',
            service_other: 'Otros servicios',
            sponsorship: 'Sponsors',
            other_income: 'Otros ingresos'
        },
        paymentMethod: { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', other: 'Otro' },
        supplyOrderStatus: {
            submitted: 'Solicitado',
            confirmed: 'Confirmado',
            rejected: 'Rechazado',
            shipped: 'Despachado',
            delivered: 'Entregado',
            received: 'Recibido',
            cancelled: 'Cancelado'
        },
        supplyOrderAction: { confirm: 'Confirmar', reject: 'Rechazar', ship: 'Despachar', deliver: 'Marcar entregado', cancel: 'Cancelar' },
        supplyActorRole: { studio: 'Estudio', vendor: 'Proveedor', support: 'Soporte' },
        supplyCategory: {
            inks: 'Tintas',
            needles_cartridges: 'Agujas y cartuchos',
            gloves: 'Guantes',
            paper_film: 'Papel y film',
            hygiene: 'Higiene',
            aftercare: 'Aftercare',
            machines: 'Máquinas',
            power_supplies: 'Fuentes de poder',
            furniture: 'Mobiliario',
            piercing: 'Piercing',
            other: 'Otros'
        },
        claimStatus: { pending: 'En revisión', approved: 'Aprobado', rejected: 'Rechazado' },
        claimDecision: { approve: 'Aprobar', reject: 'Rechazar' },
        requestDecision: { accept: 'Aprobar', reject: 'Rechazar' },
        spotKind: { resident: 'Residencia', itinerant: 'Itinerante', guest_spot: 'Guest spot' },
        spotStatus: { draft: 'Borrador', open: 'Abierto', filled: 'Cubierto', closed: 'Cerrado', expired: 'Vencido' },
        applicationStatus: {
            pending: 'Nueva',
            viewed: 'Vista',
            shortlisted: 'Preseleccionada',
            accepted: 'Aceptada',
            rejected: 'Rechazada',
            withdrawn: 'Retirada',
            contrato_pendiente: 'Contrato pendiente de firma'
        },
        counterOfferStatus: { pending: 'Pendiente', accepted: 'Aceptada', rejected: 'Rechazada', superseded: 'Reemplazada' },
        counterOfferAuthor: { artist: 'Artista', studio: 'Estudio' },
        changeRequestStatus: { pending: 'Pendiente', accepted: 'Aceptado', declined: 'Cerrado', superseded: 'Reemplazado' },
        stipendFrequency: { weekly: 'Semanal', monthly: 'Mensual', one_time: 'Pago único' },
        jobStatus: { completed: 'Completado', voided: 'Anulado' },
        invoiceStatus: { draft: 'Borrador', sent: 'Enviada', paid: 'Pagada', overdue: 'Vencida', void: 'Anulada' },
        vendorStatus: { verified: 'Verificado', unverified: 'En revisión', inactive: 'Inactivo' },
        periodPreset: {
            this_month: 'Este mes',
            last_month: 'Mes pasado',
            last_3_months: 'Últimos 3 meses',
            last_6_months: 'Últimos 6 meses',
            last_12_months: 'Últimos 12 meses',
            this_year: 'Este año',
            custom: 'Personalizado'
        },
        currency: ISO_CURRENCIES.reduce((acc, c) => { acc[c] = c; return acc; }, {})
    };

    // Tono de badge por diccionario. Lo que no figura cae en GENERIC_TONES.
    const STATUS_TONES = {
        membershipStatus: { requested: 'warning', pending_invite: 'warning', pending_acceptance: 'warning', active: 'success', paused: 'neutral', rejected: 'danger', ended: 'neutral' },
        contractStatus: { draft: 'neutral', sent: 'info', signed: 'success', declined: 'danger', cancelled: 'neutral', terminated: 'warning', expired: 'warning' },
        bookingStatus: { confirmed: 'info', completed: 'success', cancelled: 'neutral', no_show: 'danger' },
        movementKind: { restock: 'success', consumption: 'info', adjustment: 'neutral', loss: 'danger', assignment: 'warning', return: 'neutral' },
        financeEntryType: { income: 'success', expense: 'warning' },
        financeEntryStatus: { recorded: 'success', voided: 'neutral' },
        supplyOrderStatus: { submitted: 'warning', confirmed: 'info', rejected: 'danger', shipped: 'info', delivered: 'info', received: 'success', cancelled: 'neutral' },
        claimStatus: { pending: 'warning', approved: 'success', rejected: 'danger' },
        spotStatus: { draft: 'neutral', open: 'success', filled: 'info', closed: 'neutral', expired: 'warning' },
        applicationStatus: { pending: 'warning', viewed: 'info', shortlisted: 'info', accepted: 'success', rejected: 'danger', withdrawn: 'neutral', contrato_pendiente: 'warning' },
        counterOfferStatus: { pending: 'warning', accepted: 'success', rejected: 'danger', superseded: 'neutral' },
        changeRequestStatus: { pending: 'warning', accepted: 'success', declined: 'neutral', superseded: 'neutral' },
        jobStatus: { completed: 'success', voided: 'neutral' },
        invoiceStatus: { draft: 'neutral', sent: 'info', paid: 'success', overdue: 'danger', void: 'neutral' },
        vendorStatus: { verified: 'success', unverified: 'warning', inactive: 'neutral' }
    };
    const GENERIC_TONES = {
        active: 'success', signed: 'success', approved: 'success', accepted: 'success', completed: 'success', received: 'success', paid: 'success', verified: 'success', open: 'success',
        pending: 'warning', requested: 'warning', submitted: 'warning', pending_invite: 'warning', pending_acceptance: 'warning', expired: 'warning', terminated: 'warning',
        sent: 'info', confirmed: 'info', shipped: 'info', delivered: 'info', viewed: 'info', shortlisted: 'info',
        rejected: 'danger', declined: 'danger', no_show: 'danger', overdue: 'danger', loss: 'danger'
    };
    // Fallback para valores que no están en ningún diccionario: nunca el crudo en inglés.
    const GENERIC_LABELS = {
        pending: 'Pendiente', active: 'Activo', inactive: 'Inactivo', draft: 'Borrador', sent: 'Enviado', signed: 'Firmado',
        accepted: 'Aceptado', approved: 'Aprobado', rejected: 'Rechazado', declined: 'Rechazado', cancelled: 'Cancelado',
        canceled: 'Cancelado', completed: 'Completado', expired: 'Vencido', ended: 'Finalizado', paused: 'En pausa',
        confirmed: 'Confirmado', open: 'Abierto', closed: 'Cerrado', archived: 'Archivado', other: 'Otro', unknown: 'Sin dato'
    };

    function dictName(dict) {
        if (typeof dict === 'string') return dict;
        if (!dict || typeof dict !== 'object') return null;
        return Object.keys(LABELS).find(name => LABELS[name] === dict) || null;
    }
    function resolveDict(dict) {
        if (typeof dict === 'string') return LABELS[dict] || null;
        if (Array.isArray(dict)) return dict.reduce((acc, v) => { acc[v] = v; return acc; }, {});
        return dict && typeof dict === 'object' ? dict : null;
    }
    // label('contractStatus', 'sent') → "Pendiente de firma". Vacío → "—".
    function label(dict, value, fallback) {
        if (value == null || value === '') return '—';
        const d = resolveDict(dict);
        const key = String(value);
        if (d && Object.prototype.hasOwnProperty.call(d, key)) return d[key];
        if (Object.prototype.hasOwnProperty.call(GENERIC_LABELS, key)) return GENERIC_LABELS[key];
        return fallback != null ? fallback : 'Otro';
    }
    function normTone(tone) {
        const t = String(tone || '').toLowerCase();
        if (TONES.includes(t)) return t;
        if (t === 'error' || t === 'danger' || t === 'alert') return 'danger';
        if (t === 'ok' || t === 'success') return 'success';
        if (t === 'warn') return 'warning';
        return 'neutral';
    }
    function badge(text, tone) {
        return '<span class="sk-badge sk-badge--' + normTone(tone) + '">' + escapeHtml(text) + '</span>';
    }
    function statusTone(dict, value) {
        const name = dictName(dict);
        const key = String(value == null ? '' : value);
        const tones = name && STATUS_TONES[name];
        if (tones && tones[key]) return tones[key];
        return GENERIC_TONES[key] || 'neutral';
    }
    function statusBadge(dict, value) {
        if (value == null || value === '') return badge('—', 'neutral');
        return badge(label(dict, value), statusTone(dict, value));
    }
    // <option>s desde un diccionario (o array). opts.only fija orden/subconjunto; opts.empty agrega una opción vacía.
    function optionsHtml(dict, selected, opts) {
        const o = opts || {};
        const d = resolveDict(dict) || {};
        const keys = Array.isArray(o.only) ? o.only : Object.keys(d);
        const sel = (Array.isArray(selected) ? selected : (selected == null ? [] : [selected])).map(String);
        const empty = o.empty != null ? '<option value="">' + escapeHtml(o.empty) + '</option>' : '';
        return empty + keys.map(k => '<option value="' + escapeAttr(k) + '"' + (sel.includes(String(k)) ? ' selected' : '') + '>'
            + escapeHtml(Object.prototype.hasOwnProperty.call(d, k) ? d[k] : label(dict, k)) + '</option>').join('');
    }
    function currencyOptionsHtml(selected) {
        const cur = selected ? normalizeCurrency(selected) : '';
        const list = cur && !ISO_CURRENCIES.includes(cur) ? ISO_CURRENCIES.concat(cur) : ISO_CURRENCIES;
        return optionsHtml(list, cur);
    }

    // -------------------------------------------------------------
    // Bloques HTML: empty state, tabla, KPIs, barras
    // -------------------------------------------------------------
    function emptyState(opts) {
        const o = opts || {};
        return '<div class="sk-empty' + (o.compact ? ' sk-empty--compact' : '') + '">'
            + (o.icon ? '<i class="sk-empty__icon ' + escapeAttr(o.icon) + '" aria-hidden="true"></i>' : '')
            + (o.title ? '<p class="sk-empty__title">' + escapeHtml(o.title) + '</p>' : '')
            + (o.body ? '<p class="sk-empty__body">' + escapeHtml(o.body) + '</p>' : '')
            + (o.actionHtml ? '<div class="sk-empty__action">' + o.actionHtml + '</div>' : '')
            + '</div>';
    }

    function cellClass(col) {
        const cls = [];
        if (col.align === 'right' || col.format === 'money' || col.format === 'number' || col.format === 'percent') cls.push('sk-num');
        if (col.align === 'center') cls.push('sk-center');
        if (col.className) cls.push(col.className);
        return cls.length ? ' class="' + escapeAttr(cls.join(' ')) + '"' : '';
    }
    function cellHtml(col, row, i) {
        if (typeof col.render === 'function') {
            const out = col.render(row, i);
            return out == null ? '' : String(out);
        }
        const value = typeof col.value === 'function' ? col.value(row, i) : pick(row, col.key);
        if (col.badge) return statusBadge(col.badge, value);
        if (value == null || value === '') return '<span class="sk-muted">—</span>';
        switch (col.format) {
            case 'money': return escapeHtml(fmtMoney(value, pick(row, col.currencyKey || 'currency')));
            case 'date': return escapeHtml(fmtDate(value));
            case 'datetime': return escapeHtml(fmtDateTime(value));
            case 'time': return escapeHtml(fmtTime(value));
            case 'month': return escapeHtml(monthLabel(value));
            case 'number': return escapeHtml(fmtNumber(value, col.decimals));
            case 'percent': return escapeHtml(fmtPercent(value, col.decimals));
            default: break;
        }
        if (col.dict) return escapeHtml(label(col.dict, value));
        if (Array.isArray(value)) return escapeHtml(value.join(', '));
        return escapeHtml(value);
    }
    // columns: [{key, label, render(row,i)→HTML, value(row), format:'money'|'date'|…,
    //   currencyKey, dict, badge, align, className, headerHtml}]
    function renderTable(opts) {
        const o = opts || {};
        const columns = (Array.isArray(o.columns) ? o.columns : []).filter(Boolean).map(c => (typeof c === 'string' ? { key: c, label: c } : c));
        const rows = Array.isArray(o.rows) ? o.rows : [];
        if (!rows.length) return emptyState({ body: o.emptyText || 'No hay datos para mostrar.', compact: true });
        const head = columns.map(c => '<th scope="col"' + cellClass(c) + '>' + (c.headerHtml != null ? c.headerHtml : escapeHtml(c.label == null ? '' : c.label)) + '</th>').join('');
        const body = rows.map((row, i) => {
            const attrs = typeof o.rowAttrs === 'function' ? htmlAttrs(o.rowAttrs(row, i)) : '';
            const rowCls = typeof o.rowClass === 'function' ? o.rowClass(row, i) : '';
            return '<tr' + (rowCls ? ' class="' + escapeAttr(rowCls) + '"' : '') + attrs + '>'
                + columns.map(c => '<td' + cellClass(c) + ' data-label="' + escapeAttr(c.label == null ? '' : c.label) + '">' + cellHtml(c, row, i) + '</td>').join('')
                + '</tr>';
        }).join('');
        return '<div class="sk-table-wrap"><table class="sk-table' + (o.className ? ' ' + escapeAttr(o.className) : '') + '">'
            + (o.caption ? '<caption class="sk-table__caption">' + escapeHtml(o.caption) + '</caption>' : '')
            + '<thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody>'
            + (o.footHtml ? '<tfoot>' + o.footHtml + '</tfoot>' : '')
            + '</table></div>';
    }

    // items: [{label, value (texto) | valueHtml, hint, tone}]
    function kpis(items) {
        const list = (Array.isArray(items) ? items : []).filter(Boolean);
        return '<div class="sk-kpis">' + list.map(it => '<div class="sk-kpi' + (it.tone ? ' sk-kpi--' + normTone(it.tone) : '') + '">'
            + '<span class="sk-kpi__label">' + escapeHtml(it.label) + '</span>'
            + '<strong class="sk-kpi__value">' + (it.valueHtml != null ? it.valueHtml : escapeHtml(it.value == null ? '—' : it.value)) + '</strong>'
            + (it.hint ? '<small class="sk-kpi__hint">' + escapeHtml(it.hint) + '</small>' : '')
            + '</div>').join('') + '</div>';
    }

    // Barras horizontales HTML/CSS. items: [{label, value, tone, hint, currency}],
    // format: function(value, item) → texto | 'money' | 'number' | 'percent'.
    function barChart(opts) {
        const o = opts || {};
        const items = (Array.isArray(o.items) ? o.items : []).filter(Boolean);
        if (!items.length) return emptyState({ body: o.emptyText || 'Sin datos para mostrar.', compact: true });
        const values = items.map(it => toNumber(it.value) || 0);
        const max = toNumber(o.max) || Math.max.apply(null, values.map(Math.abs).concat([0]));
        const format = (v, it) => {
            if (typeof o.format === 'function') return o.format(v, it);
            if (o.format === 'money') return fmtMoney(v, it.currency);
            if (o.format === 'percent') return fmtPercent(v);
            return fmtNumber(v);
        };
        return '<ul class="sk-bars"' + (o.ariaLabel ? ' aria-label="' + escapeAttr(o.ariaLabel) + '"' : '') + '>' + items.map((it, i) => {
            const v = values[i];
            const pct = max > 0 ? Math.min(100, Math.round((Math.abs(v) / max) * 1000) / 10) : 0;
            const tone = it.tone ? normTone(it.tone) : (v < 0 ? 'danger' : '');
            const text = format(v, it);
            return '<li class="sk-bar' + (tone ? ' sk-bar--' + tone : '') + (v === 0 ? ' is-zero' : '') + '">'
                + '<span class="sk-bar__label">' + escapeHtml(it.label) + (it.hint ? '<small>' + escapeHtml(it.hint) + '</small>' : '') + '</span>'
                + '<span class="sk-bar__track" aria-hidden="true"><span class="sk-bar__fill" style="width:' + pct + '%"></span></span>'
                + '<span class="sk-bar__value">' + escapeHtml(text) + '</span>'
                + '</li>';
        }).join('') + '</ul>';
    }

    // -------------------------------------------------------------
    // Errores
    // -------------------------------------------------------------
    function errCode(err) {
        if (!err || typeof err !== 'object') return '';
        const code = err.code != null ? err.code : (err.original && err.original.code != null ? err.original.code : (err.cause && err.cause.code));
        return code == null ? '' : String(code);
    }
    function isResultShape(obj) {
        return obj && typeof obj === 'object' && 'error' in obj && !('message' in obj) && !('code' in obj);
    }
    function isMissingSchema(err) {
        if (!err) return false;
        if (typeof err === 'string') return MISSING_SCHEMA_CODES.includes(err);
        if (isResultShape(err)) return isMissingSchema(err.error);
        const code = errCode(err);
        if (code) return MISSING_SCHEMA_CODES.includes(code);
        return /in the schema cache/i.test(String(err.message || ''));
    }
    function friendlyError(err, fallback) {
        const fb = fallback || GENERIC_ERROR;
        if (err == null || err === false) return fb;
        if (typeof err === 'string') return err.trim() || fb;
        if (isResultShape(err)) return err.error ? friendlyError(err.error, fallback) : fb;
        if (isMissingSchema(err)) return MISSING_SCHEMA_MESSAGE;
        const msg = String(err.message || err.error_description || err.msg || (typeof err.error === 'string' ? err.error : '') || err.details || '').trim();
        if (!msg) return fb;
        if (!errCode(err) && NETWORK_RE.test(msg)) return NETWORK_ERROR;
        return msg;
    }
    function looksLikeError(e) {
        return !!e && typeof e === 'object' && typeof e.message === 'string' && typeof e.stack === 'string';
    }
    function toError(e) {
        if (looksLikeError(e)) return e;
        const src = e && typeof e === 'object' ? e : { message: String(e) };
        const error = new Error(src.message || src.details || GENERIC_ERROR);
        ['code', 'details', 'hint', 'status'].forEach(k => { if (src[k] != null) error[k] = src[k]; });
        error.original = src;
        return error;
    }
    // {data, error} → data; lanza (con .code intacto) si hay error.
    function unwrap(res) {
        if (res && typeof res === 'object' && 'error' in res && res.error) throw toError(res.error);
        if (looksLikeError(res)) throw res;
        if (res && typeof res === 'object' && 'data' in res) return res.data;
        return res == null ? null : res;
    }

    // -------------------------------------------------------------
    // Toasts
    // -------------------------------------------------------------
    const overlayStack = [];
    let toastStack = null;

    function mountRoot() {
        const doc = getDoc();
        if (!doc) return null;
        return (typeof doc.querySelector === 'function' && doc.querySelector('.studio-page')) || doc.body || null;
    }
    function removeNode(node) {
        if (!node) return;
        if (typeof node.remove === 'function') node.remove();
        else if (node.parentNode) node.parentNode.removeChild(node);
    }
    // Con un modal abierto, el stack vive dentro del <dialog> superior (top layer);
    // si no, en la raíz del panel.
    function placeToastStack() {
        const doc = getDoc();
        if (!doc) return null;
        if (toastStack && toastStack.ownerDocument && toastStack.ownerDocument !== doc) toastStack = null;
        if (!toastStack) {
            toastStack = doc.createElement('div');
            toastStack.className = 'sk-toast-stack';
            toastStack.setAttribute('aria-live', 'polite');
        }
        const top = overlayStack[overlayStack.length - 1];
        const host = top ? top.el : mountRoot();
        if (host && toastStack.parentNode !== host) host.appendChild(toastStack);
        return toastStack;
    }
    function toast(msg, tone, opts) {
        const o = opts || {};
        const doc = getDoc();
        const stack = placeToastStack();
        if (!doc || !stack) return { el: null, close() {} };
        const t = normTone(tone || 'info');
        const text = msg != null && typeof msg === 'object' ? friendlyError(msg) : String(msg == null ? '' : msg);
        const el = doc.createElement('div');
        el.className = 'sk-toast sk-toast--' + t;
        if (t === 'danger') el.setAttribute('role', 'alert');
        const p = doc.createElement('p');
        p.className = 'sk-toast__text';
        p.textContent = text;
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'sk-toast__close';
        btn.setAttribute('aria-label', 'Cerrar aviso');
        btn.textContent = '×';
        el.appendChild(p);
        el.appendChild(btn);
        let timer = null;
        let closed = false;
        const close = () => {
            if (closed) return;
            closed = true;
            cancelLater(timer);
            removeNode(el);
        };
        btn.addEventListener('click', close);
        stack.appendChild(el);
        // Máximo 4 en pantalla: se va el más viejo.
        const kids = stack.children ? Array.from(stack.children) : [];
        if (kids.length > 4) kids.slice(0, kids.length - 4).forEach(removeNode);
        const timeout = o.persist ? 0 : (o.timeout != null ? Number(o.timeout) : (t === 'danger' ? 7000 : 4500));
        if (timeout > 0) timer = later(close, timeout);
        return { el, close };
    }

    // -------------------------------------------------------------
    // Overlays: modal y drawer sobre <dialog>
    // -------------------------------------------------------------
    const FOCUSABLE = 'a[href], area[href], button, input, select, textarea, iframe, summary, [contenteditable="true"], [tabindex]';
    const MODAL_SIZES = ['sm', 'md', 'lg', 'xl'];
    let overlaySeq = 0;
    let keyHandlerDoc = null;

    function isVisible(node) {
        if (typeof node.getClientRects !== 'function') return true;
        return node.getClientRects().length > 0;
    }
    function focusables(container) {
        if (!container || typeof container.querySelectorAll !== 'function') return [];
        return Array.from(container.querySelectorAll(FOCUSABLE)).filter(n =>
            !n.disabled && n.getAttribute('tabindex') !== '-1' && n.type !== 'hidden' && !n.hidden && isVisible(n));
    }
    function focusNode(node) {
        if (node && typeof node.focus === 'function') {
            try { node.focus({ preventScroll: false }); } catch (_) { node.focus(); }
        }
    }
    function onDocumentKeydown(event) {
        const top = overlayStack[overlayStack.length - 1];
        if (!top) return;
        if (event.key === 'Escape' || event.key === 'Esc') {
            if (event.defaultPrevented) return; // lo resolvió un control interno
            event.preventDefault();
            if (top.dismissible && !top.busy) top.close(null);
            return;
        }
        if (event.key !== 'Tab') return;
        const doc = getDoc();
        const items = focusables(top.el);
        if (!items.length) { event.preventDefault(); return; }
        const first = items[0], last = items[items.length - 1];
        const active = doc && doc.activeElement;
        const inside = active && typeof top.el.contains === 'function' && top.el.contains(active);
        if (event.shiftKey) {
            if (!inside || active === first) { event.preventDefault(); focusNode(last); }
        } else if (!inside || active === last) {
            event.preventDefault();
            focusNode(first);
        }
    }
    function installKeyHandler(doc) {
        if (!doc || keyHandlerDoc === doc || typeof doc.addEventListener !== 'function') return;
        doc.addEventListener('keydown', onDocumentKeydown);
        keyHandlerDoc = doc;
    }
    function setScrollLock(doc) {
        const html = doc && doc.documentElement;
        if (html && html.classList) html.classList.toggle('sk-scroll-lock', overlayStack.length > 0);
    }
    // body/acciones string = HTML (ya escapado por quien llama). Si no empieza
    // con una etiqueta se envuelve en un párrafo. Node o array de Nodes se anexan.
    function appendContent(host, content) {
        if (content == null || content === '') return;
        if (Array.isArray(content)) { content.forEach(c => appendContent(host, c)); return; }
        if (typeof content === 'object' && content.nodeType) { host.appendChild(content); return; }
        const raw = String(content);
        const html = /^\s*</.test(raw) ? raw : '<p class="sk-overlay__text">' + raw + '</p>';
        if (typeof host.insertAdjacentHTML === 'function') host.insertAdjacentHTML('beforeend', html);
        else host.innerHTML = (host.innerHTML || '') + html;
    }
    function actionClass(action) {
        const v = String(action.variant || action.tone || (action.primary ? 'primary' : '')).toLowerCase();
        if (v === 'primary') return 'studio-btn studio-btn-primary';
        if (v === 'danger' || v === 'error') return 'studio-btn studio-btn-primary sk-btn--danger';
        if (v === 'ghost' || v === 'secondary' || v === 'cancel') return 'studio-btn studio-btn-ghost';
        return 'studio-btn';
    }
    function hasFormFields(node) {
        return !!(node && typeof node.querySelector === 'function' && node.querySelector('input:not([type="hidden"]), select, textarea'));
    }

    function stubOverlay() {
        return {
            el: null, panel: null, body: null, footer: null,
            close() {}, setError() {}, setBusy() {}, setTitle() {},
            closed: Promise.resolve(null)
        };
    }

    // kind: 'modal' | 'drawer'
    function openOverlay(kind, opts) {
        const o = opts || {};
        const doc = getDoc();
        const host = mountRoot();
        if (!doc || !host) return stubOverlay();
        installKeyHandler(doc);

        const id = 'sk-overlay-' + (++overlaySeq);
        const el = doc.createElement('dialog');
        const native = typeof el.showModal === 'function';
        const size = String(kind === 'drawer' ? (o.width || 'md') : (o.size || 'md'));
        const sizeClass = MODAL_SIZES.includes(size) ? ' sk-' + kind + '--' + size : '';
        el.className = 'sk-overlay sk-' + kind + sizeClass + (native ? '' : ' sk-overlay--fallback') + (o.className ? ' ' + o.className : '');
        if (!native) {
            el.setAttribute('role', 'dialog');
            el.setAttribute('aria-modal', 'true');
        }
        el.setAttribute('aria-labelledby', id + '-title');

        const panel = doc.createElement('div');
        panel.className = 'sk-overlay__panel';
        if (!sizeClass && size) {
            const w = /^\d+$/.test(size) ? size + 'px' : size;
            if (/^[\d.]+(px|rem|em|vw|%)$/.test(w) && panel.style) panel.style.width = w;
        }

        const head = doc.createElement('header');
        head.className = 'sk-overlay__head';
        const title = doc.createElement('h2');
        title.className = 'sk-overlay__title';
        title.id = id + '-title';
        title.textContent = o.title || '';
        const closeBtn = doc.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'sk-overlay__close';
        closeBtn.setAttribute('aria-label', 'Cerrar');
        closeBtn.textContent = '×';
        head.appendChild(title);
        head.appendChild(closeBtn);

        const body = doc.createElement('div');
        body.className = 'sk-overlay__body';
        appendContent(body, o.body);

        const error = doc.createElement('p');
        error.className = 'sk-overlay__error';
        error.setAttribute('role', 'alert');
        error.hidden = true;

        const footer = doc.createElement('footer');
        footer.className = 'sk-overlay__foot';

        panel.appendChild(head);
        panel.appendChild(body);
        panel.appendChild(error);
        panel.appendChild(footer);
        el.appendChild(panel);

        let resolveClosed;
        const closed = new Promise(resolve => { resolveClosed = resolve; });
        const previousFocus = doc.activeElement || null;
        const buttons = [];
        const state = {
            el,
            dismissible: o.dismissible !== false,
            busy: false,
            done: false,
            close: null
        };

        const api = {
            el, panel, body, footer, closed,
            close(value) { state.close(value === undefined ? null : value); },
            setError(msg) {
                const text = msg ? (typeof msg === 'object' ? friendlyError(msg) : String(msg)) : '';
                error.textContent = text;
                error.hidden = !text;
            },
            setBusy(flag) {
                state.busy = !!flag;
                el.setAttribute('aria-busy', state.busy ? 'true' : 'false');
                buttons.forEach(b => { b.disabled = state.busy || b._skDisabled; });
                closeBtn.disabled = state.busy;
            },
            setTitle(text) { title.textContent = text || ''; },
            isBusy() { return state.busy; }
        };

        state.close = value => {
            if (state.done) return;
            state.done = true;
            const idx = overlayStack.indexOf(state);
            if (idx >= 0) overlayStack.splice(idx, 1);
            if (toastStack && toastStack.parentNode === el) {
                const next = overlayStack[overlayStack.length - 1];
                const target = next ? next.el : mountRoot();
                if (target) target.appendChild(toastStack);
            }
            try { if (native && el.open) el.close(); } catch (_) { /* ya cerrado */ }
            removeNode(el);
            setScrollLock(doc);
            if (previousFocus && previousFocus.isConnected !== false) focusNode(previousFocus);
            // Si el foco quedó en <body> (p. ej. el botón que abrió estaba
            // deshabilitado por "ocupado") y queda otro overlay, vuelve a ese.
            const below = overlayStack[overlayStack.length - 1];
            if (below && (!doc.activeElement || doc.activeElement === doc.body || !below.el.contains(doc.activeElement))) {
                focusNode(focusables(below.el)[0] || below.el);
            }
            resolveClosed(value);
            if (typeof o.onClose === 'function') {
                try { o.onClose(value); } catch (_) { /* el cierre no depende del callback */ }
            }
        };

        // Acciones del pie
        const actions = Array.isArray(o.actions) ? o.actions.filter(Boolean) : [];
        if (typeof o.actions === 'string' && o.actions) footer.innerHTML = o.actions;
        else if (o.actions && o.actions.nodeType) footer.appendChild(o.actions);
        actions.forEach(action => {
            const b = doc.createElement('button');
            b.type = action.type === 'submit' ? 'submit' : 'button';
            b.className = actionClass(action) + (action.className ? ' ' + action.className : '');
            if (action.html) b.innerHTML = action.html; else b.textContent = action.label || 'Aceptar';
            if (action.id) b.id = action.id;
            if (action.autofocus) b.setAttribute('data-autofocus', '');
            b._skDisabled = !!action.disabled;
            b.disabled = !!action.disabled;
            b.addEventListener('click', async event => {
                if (state.busy || b.disabled || state.done) return;
                if (typeof action.onClick !== 'function') {
                    state.close(action.value !== undefined ? action.value : null);
                    return;
                }
                api.setError('');
                api.setBusy(true);
                let result;
                try {
                    result = await action.onClick(api, event);
                } catch (err) {
                    api.setBusy(false);
                    api.setError(friendlyError(err));
                    if (!state.done) focusNode(b);
                    return;
                }
                api.setBusy(false);
                const active = doc.activeElement;
                if (!state.done && (!active || active === doc.body || active === el || !el.contains(active))) focusNode(b);
                if (state.done || result === false || action.close === false) return;
                state.close(action.value !== undefined ? action.value : (result === undefined ? null : result));
            });
            buttons.push(b);
            footer.appendChild(b);
        });
        if (!actions.length && !(o.actions && (typeof o.actions === 'string' || o.actions.nodeType))) footer.hidden = true;

        closeBtn.addEventListener('click', () => { if (!state.busy) state.close(null); });

        // Click en el fondo: solo si empezó y terminó sobre el fondo (no al
        // arrastrar una selección desde un input). 'auto' = solo sin campos.
        let downOnBackdrop = false;
        el.addEventListener('mousedown', e => { downOnBackdrop = e.target === el; });
        el.addEventListener('click', e => {
            const wasDown = downOnBackdrop;
            downOnBackdrop = false;
            if (e.target !== el || !wasDown || !state.dismissible || state.busy) return;
            const mode = o.closeOnBackdrop == null ? 'auto' : o.closeOnBackdrop;
            if (mode === true || (mode === 'auto' && !hasFormFields(body))) state.close(null);
        });
        // Esc nativo (si el keydown no lo frenó) y cierres externos.
        el.addEventListener('cancel', e => {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            if (state.dismissible && !state.busy) state.close(null);
        });
        el.addEventListener('close', () => { if (!state.done) state.close(null); });

        host.appendChild(el);
        overlayStack.push(state);
        if (native) {
            try { el.showModal(); } catch (_) {
                el.setAttribute('open', '');
                el.className += ' sk-overlay--fallback';
            }
        } else {
            el.setAttribute('open', '');
        }
        setScrollLock(doc);
        if (toastStack && toastStack.parentNode && toastStack.children && toastStack.children.length) placeToastStack();

        const initial = (typeof el.querySelector === 'function' && el.querySelector('[autofocus], [data-autofocus]'))
            || (typeof body.querySelector === 'function' && body.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])'))
            || buttons.find(b => !b.disabled && /studio-btn-primary/.test(b.className))
            || buttons[buttons.length - 1]
            || closeBtn;
        focusNode(initial);
        return api;
    }

    function openModal(opts) { return openOverlay('modal', opts); }
    function openDrawer(opts) { return openOverlay('drawer', opts); }

    function confirmDialog(opts) {
        const o = opts || {};
        const danger = normTone(o.tone) === 'danger';
        const m = openModal({
            title: o.title || '¿Confirmás esta acción?',
            body: o.body || '',
            size: o.size || 'sm',
            className: 'sk-confirm',
            closeOnBackdrop: true,
            actions: [
                { label: o.cancelLabel || 'Cancelar', variant: 'ghost', value: false, autofocus: danger },
                { label: o.confirmLabel || 'Confirmar', variant: danger ? 'danger' : 'primary', value: true, autofocus: !danger }
            ]
        });
        return m.closed.then(v => v === true);
    }

    // → Promise<string|null> (null = cancelado). Devuelve el texto recortado.
    function promptDialog(opts) {
        const o = opts || {};
        const doc = getDoc();
        if (!doc || !mountRoot()) return Promise.resolve(null);
        const fieldId = 'sk-prompt-' + (++overlaySeq);
        const wrap = doc.createElement('div');
        wrap.className = 'sk-prompt';
        if (o.body) {
            const p = doc.createElement('p');
            p.className = 'sk-overlay__text';
            p.textContent = o.body;
            wrap.appendChild(p);
        }
        const field = doc.createElement('div');
        field.className = 'sk-field';
        const lab = doc.createElement('label');
        lab.className = 'studio-label';
        lab.setAttribute('for', fieldId);
        lab.textContent = o.label || o.title || 'Respuesta';
        const input = doc.createElement(o.multiline ? 'textarea' : 'input');
        input.id = fieldId;
        input.className = o.multiline ? 'studio-textarea' : 'studio-input';
        if (!o.multiline) input.type = o.type || 'text';
        if (o.placeholder) input.setAttribute('placeholder', o.placeholder);
        if (o.maxLength) input.setAttribute('maxlength', String(o.maxLength));
        if (o.required) { input.setAttribute('required', ''); input.setAttribute('aria-required', 'true'); }
        if (o.autocomplete) input.setAttribute('autocomplete', o.autocomplete);
        input.value = o.value == null ? '' : String(o.value);
        field.appendChild(lab);
        field.appendChild(input);
        if (o.help) {
            const help = doc.createElement('span');
            help.className = 'studio-help';
            help.textContent = o.help;
            field.appendChild(help);
        }
        wrap.appendChild(field);

        let confirmBtn = null;
        const m = openModal({
            title: o.title || 'Completá el dato',
            body: wrap,
            size: o.size || 'sm',
            className: 'sk-prompt-dialog',
            closeOnBackdrop: false,
            actions: [
                { label: o.cancelLabel || 'Cancelar', variant: 'ghost', value: null },
                {
                    label: o.confirmLabel || 'Aceptar',
                    variant: normTone(o.tone) === 'danger' ? 'danger' : 'primary',
                    onClick(modal) {
                        const v = String(input.value == null ? '' : input.value).trim();
                        if (o.required && !v) {
                            modal.setError(o.requiredMessage || 'Completá este campo para continuar.');
                            input.setAttribute('aria-invalid', 'true');
                            focusNode(input);
                            return false;
                        }
                        if (o.minLength && v && v.length < o.minLength) {
                            modal.setError('Ingresá al menos ' + o.minLength + ' caracteres.');
                            input.setAttribute('aria-invalid', 'true');
                            focusNode(input);
                            return false;
                        }
                        modal.close(v);
                        return false;
                    }
                }
            ]
        });
        confirmBtn = m.footer && m.footer.lastChild;
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !o.multiline && !e.isComposing) {
                e.preventDefault();
                if (confirmBtn && typeof confirmBtn.click === 'function') confirmBtn.click();
            }
        });
        focusNode(input);
        return m.closed.then(v => (typeof v === 'string' ? v : null));
    }

    // Imprime solo el documento: lo clona en .sk-print-root (fuera de los
    // <dialog>), marca html.sk-print-mode y limpia en afterprint.
    let printCleanup = null;
    function printDocument(source, opts) {
        const o = opts || {};
        const doc = getDoc();
        if (!doc || !doc.body || !root || typeof root.print !== 'function') return false;
        if (printCleanup) printCleanup();
        const holder = doc.createElement('div');
        holder.className = 'sk-print-root';
        if (typeof source === 'string') holder.innerHTML = source;
        else if (source && source.nodeType) holder.appendChild(typeof source.cloneNode === 'function' ? source.cloneNode(true) : source);
        else return false;
        doc.body.appendChild(holder);
        const html = doc.documentElement;
        if (html && html.classList) html.classList.add('sk-print-mode');
        const prevTitle = doc.title;
        if (o.title) doc.title = o.title;
        printCleanup = () => {
            printCleanup = null;
            removeNode(holder);
            if (html && html.classList) html.classList.remove('sk-print-mode');
            if (o.title) doc.title = prevTitle;
        };
        if (typeof root.addEventListener === 'function') root.addEventListener('afterprint', () => { if (printCleanup) printCleanup(); }, { once: true });
        root.print();
        return true;
    }

    // -------------------------------------------------------------
    // Botones y formularios
    // -------------------------------------------------------------
    // guarded(btn, asyncFn, opts) ejecuta YA asyncFn con el botón deshabilitado
    // (ignora dobles clicks), muestra el error en un toast y resuelve con el
    // resultado (o undefined si falló). guarded(asyncFn) devuelve un handler.
    function guarded(btn, asyncFn, opts) {
        if (typeof btn === 'function' && asyncFn == null) {
            const fn = btn;
            return function (event) { return guarded(event && event.currentTarget, () => fn(event), opts); };
        }
        const o = opts || {};
        let target = btn;
        if (target && !target.nodeType && target.currentTarget) target = target.currentTarget;
        if (target && (target.disabled || target._skBusy)) return Promise.resolve(undefined);
        const prevLabel = target && o.busyLabel ? target.textContent : null;
        if (target) {
            target._skBusy = true;
            target.disabled = true;
            if (typeof target.setAttribute === 'function') target.setAttribute('aria-busy', 'true');
            if (o.busyLabel) target.textContent = o.busyLabel;
        }
        const release = () => {
            if (!target) return;
            target._skBusy = false;
            target.disabled = false;
            if (typeof target.removeAttribute === 'function') target.removeAttribute('aria-busy');
            if (prevLabel != null) target.textContent = prevLabel;
        };
        return Promise.resolve()
            .then(() => (typeof asyncFn === 'function' ? asyncFn() : undefined))
            .then(result => { release(); return result; }, err => {
                release();
                if (typeof o.onError === 'function') o.onError(err);
                else if (!o.silent) toast(friendlyError(err), 'danger');
                if (o.rethrow) throw err;
                return undefined;
            });
    }

    function debounce(fn, wait) {
        const ms = wait == null ? 300 : wait;
        let timer = null;
        let lastArgs = null;
        let lastThis = null;
        function debounced() {
            lastArgs = arguments;
            lastThis = this;
            cancelLater(timer);
            timer = later(() => { timer = null; fn.apply(lastThis, lastArgs); }, ms);
        }
        debounced.cancel = () => { cancelLater(timer); timer = null; };
        debounced.flush = () => {
            if (timer == null) return;
            cancelLater(timer);
            timer = null;
            fn.apply(lastThis, lastArgs);
        };
        return debounced;
    }

    // readForm(formOContenedor, {emptyAsNull, includeDisabled}) → {campo: valor}.
    // Clave: name → data-field → id. checkbox → boolean (o array si varios
    // comparten name), number → Number|null, select múltiple → array, texto → recortado.
    function readForm(form, opts) {
        const o = opts || {};
        if (!form) return {};
        const fields = form.elements && typeof form.elements.length === 'number'
            ? Array.from(form.elements)
            : (typeof form.querySelectorAll === 'function' ? Array.from(form.querySelectorAll('input, select, textarea')) : []);
        const keyOf = el => el.name || (el.getAttribute && el.getAttribute('data-field')) || el.id || '';
        const usable = fields.filter(el => {
            const tag = String(el.tagName || '').toLowerCase();
            const type = String(el.type || '').toLowerCase();
            if (!keyOf(el)) return false;
            if (tag === 'button' || tag === 'fieldset' || tag === 'output' || tag === 'object') return false;
            if (['submit', 'button', 'reset', 'image'].includes(type)) return false;
            if (el.disabled && !o.includeDisabled) return false;
            return true;
        });
        const checkboxCount = {};
        usable.forEach(el => { if (String(el.type).toLowerCase() === 'checkbox') checkboxCount[keyOf(el)] = (checkboxCount[keyOf(el)] || 0) + 1; });
        const out = {};
        usable.forEach(el => {
            const key = keyOf(el);
            const type = String(el.type || '').toLowerCase();
            if (type === 'checkbox') {
                if (checkboxCount[key] > 1) {
                    if (!Array.isArray(out[key])) out[key] = [];
                    if (el.checked) out[key].push(el.value);
                } else out[key] = !!el.checked;
                return;
            }
            if (type === 'radio') {
                if (el.checked) out[key] = el.value;
                else if (!(key in out)) out[key] = null;
                return;
            }
            if (type === 'file') {
                const files = el.files ? Array.from(el.files) : [];
                out[key] = el.multiple ? files : (files[0] || null);
                return;
            }
            if (type === 'select-multiple' || (el.multiple && String(el.tagName || '').toLowerCase() === 'select')) {
                out[key] = Array.from(el.options || []).filter(opt => opt.selected).map(opt => opt.value);
                return;
            }
            const raw = String(el.value == null ? '' : el.value).trim();
            if (type === 'number' || type === 'range') {
                out[key] = raw === '' ? null : toNumber(raw.replace(',', '.'));
                return;
            }
            out[key] = raw === '' && o.emptyAsNull ? null : raw;
        });
        return out;
    }

    function normalizeItems(list, max, maxLen) {
        const out = [];
        const seen = new Set();
        (Array.isArray(list) ? list : []).forEach(item => {
            if (out.length >= max) return;
            const text = String(item == null ? '' : item).replace(/\s+/g, ' ').trim().slice(0, maxLen).trim();
            const key = text.toLowerCase();
            if (!text || seen.has(key)) return;
            seen.add(key);
            out.push(text);
        });
        return out;
    }

    // Lista editable de chips (variant 'chips') o líneas (variant 'lines') para
    // "Qué incluye", "Beneficios", etc. → {el, getItems, setItems, input}.
    function listEditor(opts) {
        const o = opts || {};
        const max = Math.max(1, Math.min(100, parseInt(o.max, 10) || 20));
        const maxLen = Math.max(1, Math.min(2000, parseInt(o.maxLen, 10) || 200));
        const variant = o.variant === 'lines' ? 'lines' : 'chips';
        let items = normalizeItems(o.items, max, maxLen);
        const doc = getDoc();
        if (!doc) {
            return {
                el: null,
                getItems: () => items.slice(),
                setItems: list => { items = normalizeItems(list, max, maxLen); }
            };
        }
        const el = doc.createElement('div');
        el.className = 'sk-list-editor sk-list-editor--' + variant;
        const list = doc.createElement('ul');
        list.className = 'sk-list-editor__items';
        const row = doc.createElement('div');
        row.className = 'sk-list-editor__add';
        const input = doc.createElement('input');
        input.type = 'text';
        input.className = 'studio-input sk-list-editor__input';
        input.setAttribute('maxlength', String(maxLen));
        input.setAttribute('placeholder', o.placeholder || 'Escribí y presioná Enter');
        input.setAttribute('aria-label', o.label || o.placeholder || 'Agregar ítem');
        const addBtn = doc.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'studio-btn studio-btn-ghost sk-list-editor__add-btn';
        addBtn.textContent = o.addLabel || 'Agregar';
        const counter = doc.createElement('span');
        counter.className = 'sk-list-editor__count';
        counter.setAttribute('aria-live', 'polite');
        row.appendChild(input);
        row.appendChild(addBtn);
        el.appendChild(list);
        el.appendChild(row);
        el.appendChild(counter);

        const changed = () => { if (typeof o.onChange === 'function') o.onChange(items.slice()); };
        function render() {
            list.textContent = '';
            items.forEach((text, i) => {
                const li = doc.createElement('li');
                li.className = 'sk-list-editor__item';
                if (variant === 'lines') {
                    const line = doc.createElement('input');
                    line.type = 'text';
                    line.className = 'studio-input sk-list-editor__line';
                    line.setAttribute('maxlength', String(maxLen));
                    line.setAttribute('aria-label', 'Ítem ' + (i + 1));
                    line.value = text;
                    line.addEventListener('input', () => { items[i] = String(line.value || '').slice(0, maxLen); changed(); });
                    li.appendChild(line);
                } else {
                    const span = doc.createElement('span');
                    span.className = 'sk-list-editor__text';
                    span.textContent = text;
                    li.appendChild(span);
                }
                const rm = doc.createElement('button');
                rm.type = 'button';
                rm.className = 'sk-list-editor__remove';
                rm.setAttribute('aria-label', 'Quitar «' + text + '»');
                rm.textContent = '×';
                rm.addEventListener('click', () => {
                    items.splice(i, 1);
                    render();
                    changed();
                    focusNode(input);
                });
                li.appendChild(rm);
                list.appendChild(li);
            });
            const full = items.length >= max;
            input.disabled = full;
            addBtn.disabled = full;
            counter.textContent = items.length + '/' + max + (full ? ' · máximo alcanzado' : '');
            list.hidden = !items.length;
        }
        function add(raw) {
            const parts = String(raw == null ? '' : raw).split(/\r?\n/);
            const before = items.length;
            items = normalizeItems(items.concat(parts), max, maxLen);
            render();
            if (items.length !== before) changed();
        }
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                add(input.value);
                input.value = '';
            }
        });
        input.addEventListener('paste', e => {
            const text = e.clipboardData && typeof e.clipboardData.getData === 'function' ? e.clipboardData.getData('text') : '';
            if (/\r?\n/.test(text)) {
                e.preventDefault();
                add(text);
                input.value = '';
            }
        });
        addBtn.addEventListener('click', () => {
            add(input.value);
            input.value = '';
            focusNode(input);
        });
        render();

        return {
            el,
            input,
            // Incluye lo tipeado y no agregado todavía, para no perderlo al guardar.
            getItems() {
                const pending = String(input.value || '').trim();
                return normalizeItems(pending ? items.concat([pending]) : items, max, maxLen);
            },
            setItems(listItems) {
                items = normalizeItems(listItems, max, maxLen);
                input.value = '';
                render();
            }
        };
    }

    // -------------------------------------------------------------
    // CSV (Excel en español: BOM + ';' + coma decimal)
    // -------------------------------------------------------------
    function csvValue(v) {
        if (v == null) return '';
        if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : '';
        if (typeof v === 'boolean') return v ? 'Sí' : 'No';
        if (v instanceof Date || Object.prototype.toString.call(v) === '[object Date]') {
            return Number.isNaN(v.getTime()) ? '' : ymd(v) + ' ' + pad2(v.getHours()) + ':' + pad2(v.getMinutes());
        }
        if (Array.isArray(v)) return v.map(x => (x == null ? '' : String(x))).join(', ');
        if (typeof v === 'object') { try { return JSON.stringify(v); } catch (_) { return ''; } }
        const s = String(v);
        // Anti inyección de fórmulas, sin romper números negativos escritos como texto.
        return /^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s) ? "'" + s : s;
    }
    function csvField(s) {
        return /[";\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    // columns: [{key, label, value(row)}] o strings. Sin BOM (lo agrega downloadCsv).
    function toCsv(columns, rows) {
        const cols = (Array.isArray(columns) ? columns : []).filter(Boolean).map(c => (typeof c === 'string' ? { key: c, label: c } : c));
        const header = cols.map(c => csvField(String(c.label != null ? c.label : (c.key || '')))).join(';');
        const lines = (Array.isArray(rows) ? rows : []).map(row => cols.map(c => {
            const v = typeof c.value === 'function' ? c.value(row) : pick(row, c.key);
            return csvField(csvValue(v));
        }).join(';'));
        return [header].concat(lines).join('\r\n') + '\r\n';
    }
    function downloadCsv(filename, columns, rows) {
        const content = '﻿' + toCsv(columns, rows);
        const doc = getDoc();
        const BlobCtor = typeof Blob === 'function' ? Blob : (root && root.Blob);
        const URLCtor = typeof URL === 'function' ? URL : (root && root.URL);
        let name = String(filename || 'export').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'export';
        if (!/\.csv$/i.test(name)) name += '.csv';
        if (!doc || !doc.body || typeof BlobCtor !== 'function' || !URLCtor || typeof URLCtor.createObjectURL !== 'function') return content;
        const blob = new BlobCtor([content], { type: 'text/csv;charset=utf-8' });
        const href = URLCtor.createObjectURL(blob);
        const a = doc.createElement('a');
        a.href = href;
        a.download = name;
        a.rel = 'noopener';
        a.hidden = true;
        doc.body.appendChild(a);
        a.click();
        removeNode(a);
        later(() => { try { URLCtor.revokeObjectURL(href); } catch (_) { /* nada */ } }, 1500);
        return content;
    }

    // -------------------------------------------------------------
    // Notificaciones (POST con el Bearer de la sesión). Nunca lanza.
    // -------------------------------------------------------------
    async function sessionToken(client) {
        const candidates = [];
        if (client) candidates.push(() => client);
        else {
            candidates.push(() => root && root.WeotziData && typeof root.WeotziData.getClient === 'function' && root.WeotziData.getClient());
            candidates.push(() => root && root.WeOtziStudioAuth && typeof root.WeOtziStudioAuth.getSupabase === 'function' && root.WeOtziStudioAuth.getSupabase());
            candidates.push(() => root && root._supabase);
        }
        for (const get of candidates) {
            try {
                const c = get();
                if (!c || !c.auth || typeof c.auth.getSession !== 'function') continue;
                const res = await c.auth.getSession();
                const token = res && res.data && res.data.session && res.data.session.access_token;
                if (token) return token;
            } catch (_) { /* probamos el siguiente */ }
        }
        return null;
    }
    // → {ok, data, status, sent, error?}. ok = HTTP 2xx y success !== false;
    // sent = además sent !== false (p. ej. un estudio sin dueño no recibe email).
    async function postNotify(path, payload, client, opts) {
        const o = opts || {};
        try {
            const doFetch = o.fetch || (typeof fetch === 'function' ? fetch : (root && root.fetch));
            if (typeof doFetch !== 'function') return { ok: false, data: null, status: 0, sent: false, error: new Error('fetch no disponible') };
            const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
            const token = await sessionToken(client);
            if (token) headers.Authorization = 'Bearer ' + token;
            const res = await doFetch(appUrl(path), { method: 'POST', headers, body: JSON.stringify(payload || {}) });
            let data = null;
            try { data = res && typeof res.json === 'function' ? await res.json() : null; } catch (_) { data = null; }
            const ok = !!(res && res.ok) && !(data && data.success === false);
            return { ok, data, status: res && res.status ? res.status : 0, sent: ok && !(data && data.sent === false) };
        } catch (error) {
            return { ok: false, data: null, status: 0, sent: false, error };
        }
    }

    return {
        // formato
        escapeHtml, escapeAttr, safeUrl, htmlAttrs, appUrl,
        fmtMoney, fmtNumber, fmtPercent, normalizeCurrency,
        sumByCurrency, mergeTotals, fmtTotals, fmtTotalsHtml,
        fmtDate, fmtDateTime, fmtTime, toDate, toDateInput, toLocalInput, fromLocalInput,
        monthKey, monthLabel, daysUntil, fmtRelative, periodRange,
        // etiquetas
        LABELS, STATUS_TONES, FINANCE_CATEGORIES, ISO_CURRENCIES, PERIOD_PRESETS,
        label, badge, statusBadge, statusTone, optionsHtml, currencyOptionsHtml,
        // UI
        toast, confirmDialog, promptDialog, openModal, openDrawer, printDocument,
        emptyState, renderTable, kpis, barChart,
        // utilidades
        guarded, unwrap, friendlyError, isMissingSchema, MISSING_SCHEMA_CODES, MISSING_SCHEMA_MESSAGE,
        toCsv, downloadCsv, debounce, readForm, listEditor, postNotify
    };
});
