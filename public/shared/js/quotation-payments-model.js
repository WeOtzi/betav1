/**
 * WE OTZI - Modelo puro de pagos de clientes por cotización
 * ---------------------------------------------------------
 * Ronda 3 · grupo "pagos" (Figma w3JA83CcP5ISKjyOu87mx1: 24:1425 REGISTRAR PAGO,
 * actividad «Pago recibido» y «Saldo pend.»; 801:556 seña requerida;
 * 801:580–583 saldo pendiente del expediente).
 *
 * Sin DOM ni red. Lo usan quotation-payment-dialog.js, quotation-payments-panel.js,
 * dashboard-payments.js / dashboard-redesign.js (navegador) y
 * tests/r3-pagos.test.js (Node).
 *
 * Tabla: public.quotation_payments (migración 20261112170000). Los pagos los
 * registra el artista a mano: es dinero que cobró él, fuera de We Ötzi. Por eso
 * nunca suman al saldo retirable del Wallet (ver wallet-model.js).
 *
 * Pago normalizado:
 *   { id, quotationId, quoteId, kind, method, amount (>0), currency, paidOn
 *     (YYYY-MM-DD), note, clientName, receiptPath, receiptName, createdAt }
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoPaymentsModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Mismas 24 monedas que CurrencyUtils.COUNTRY_CURRENCIES (currency-utils.js)
    // y que el CHECK de quotation_payments.currency. El test lo compara.
    var CURRENCY_CODES = ['USD', 'CAD', 'MXN', 'CRC', 'COP', 'VES', 'PEN', 'BRL', 'ARS', 'CLP', 'UYU',
        'EUR', 'GBP', 'CHF', 'DKK', 'NOK', 'SEK', 'PLN', 'KRW', 'THB', 'IDR', 'JPY', 'AUD', 'NZD'];

    var KINDS = ['deposit', 'session', 'balance', 'other'];
    var KIND_LABELS = { deposit: 'Seña', session: 'Pago de sesión', balance: 'Saldo', other: 'Otro' };
    var KIND_EVENT = { deposit: 'Seña recibida', session: 'Pago recibido', balance: 'Saldo recibido', other: 'Pago recibido' };
    var METHODS = ['cash', 'transfer', 'other'];
    var METHOD_LABELS = { cash: 'Efectivo', transfer: 'Transferencia', other: 'Otro' };

    // Estados en los que se puede registrar un pago (igual que la RPC
    // record_quotation_payment). in_progress sin respuesta ni acuerdo es el
    // borrador del cotizador del cliente.
    var PAYABLE_STATUSES = ['responded', 'client_approved', 'in_progress', 'en_progreso', 'artist_completed', 'completed'];
    // Trabajo comprometido con cobro abierto (Saldo pend. del dashboard).
    var OPEN_BALANCE_STATUSES = ['client_approved', 'in_progress', 'en_progreso', 'artist_completed'];

    var MAX_AMOUNT = 1000000000;
    var MAX_NOTE = 500;
    var MAX_FILE_BYTES = 10 * 1024 * 1024;
    var RECEIPT_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
    var MIN_DATE = '2015-01-01';

    function round2(n) { return Math.round(n * 100) / 100; }
    function upper(code) { return String(code == null ? '' : code).trim().toUpperCase(); }
    function pad2(n) { return String(n).padStart(2, '0'); }

    function isoDateLocal(date) {
        var d = date instanceof Date ? date : new Date(date);
        if (isNaN(d.getTime())) return null;
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    function cleanDate(value) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value == null ? '' : value).trim());
        if (!m) return null;
        var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
        return m[1] + '-' + m[2] + '-' + m[3];
    }

    function addDays(iso, days) {
        var p = cleanDate(iso).split('-');
        return isoDateLocal(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + days));
    }

    // "1.240,50" | "1240.5" | "1,240.50" → 1240.5 (NaN si no es válido).
    // Mismo criterio que WoWalletModel.parseAmount (números europeos del DS).
    function parseAmount(text) {
        if (typeof text === 'number') return isFinite(text) ? text : NaN;
        var raw = String(text == null ? '' : text).trim();
        if (/^-/.test(raw)) return NaN;
        var s = raw.replace(/[^\d.,]/g, '');
        if (!s || !/\d/.test(s)) return NaN;
        var hasComma = s.indexOf(',') !== -1, hasDot = s.indexOf('.') !== -1;
        var normalized;
        if (hasComma && hasDot) {
            var dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
            normalized = s.replace(dec === ',' ? /\./g : /,/g, '').replace(dec, '.');
        } else if (hasComma) {
            normalized = (s.match(/,/g).length > 1) ? s.replace(/,/g, '') : s.replace(',', '.');
        } else if (hasDot) {
            var parts = s.split('.');
            normalized = (parts.length > 2 || parts[parts.length - 1].length === 3) ? s.replace(/\./g, '') : s;
        } else {
            normalized = s;
        }
        var n = parseFloat(normalized);
        return isFinite(n) ? n : NaN;
    }

    // Monto guardado en quotations_db (texto) → número o null.
    function storedAmount(value) {
        if (value == null || value === '') return null;
        var n = parseAmount(value);
        return isFinite(n) && n > 0 ? round2(n) : null;
    }

    function hasDecimalsOver2(n) {
        return Math.abs(round2(n) - n) > 1e-9;
    }

    function isCurrency(code) { return CURRENCY_CODES.indexOf(upper(code)) !== -1; }

    function isDraft(q) {
        var s = q && q.quote_status;
        if (s !== 'in_progress' && s !== 'en_progreso') return false;
        return !q.artist_responded_at && !storedAmount(q.final_budget_amount) && !String(q.final_sessions || '').trim();
    }

    function isPayable(q) {
        return !!q && PAYABLE_STATUSES.indexOf(q.quote_status) !== -1 && !isDraft(q) && !q.is_archived;
    }

    /* ------------------------------ normalización ------------------------------ */
    function normalize(raw) {
        raw = raw || {};
        return {
            id: raw.id != null ? String(raw.id) : null,
            quotationId: raw.quotation_id != null ? Number(raw.quotation_id) : (raw.quotationId != null ? Number(raw.quotationId) : null),
            quoteId: raw.quote_id || raw.quoteId || null,
            kind: KINDS.indexOf(raw.kind) !== -1 ? raw.kind : 'other',
            method: METHODS.indexOf(raw.method) !== -1 ? raw.method : 'other',
            amount: round2(Math.abs(Number(raw.amount) || 0)),
            currency: upper(raw.currency || 'USD'),
            paidOn: cleanDate(raw.paid_on || raw.paidOn) || null,
            note: raw.note ? String(raw.note) : '',
            clientName: raw.client_name || raw.clientName || null,
            receiptPath: raw.receipt_path || raw.receiptPath || null,
            receiptName: raw.receipt_name || raw.receiptName || null,
            createdAt: raw.created_at || raw.createdAt || null
        };
    }

    // Más reciente primero (fecha de pago, después alta).
    function sortPayments(list) {
        return (list || []).slice().sort(function (a, b) {
            if (a.paidOn !== b.paidOn) return String(b.paidOn || '').localeCompare(String(a.paidOn || ''));
            return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
        });
    }

    /* --------------------------------- acuerdo --------------------------------- */
    // Total acordado: presupuesto final; si no, el del artista; si no, el total
    // de la cotización manual. { amount, currency, source } o null.
    function agreedTotal(quote, manual) {
        var q = quote || {};
        var finalAmount = storedAmount(q.final_budget_amount);
        if (finalAmount) return { amount: finalAmount, currency: upper(q.final_budget_currency || q.artist_budget_currency || 'USD'), source: 'final' };
        var artistAmount = storedAmount(q.artist_budget_amount);
        if (artistAmount) return { amount: artistAmount, currency: upper(q.artist_budget_currency || (manual && manual.currency) || 'USD'), source: 'artist' };
        var manualTotal = manual ? storedAmount(manual.total) : null;
        if (manualTotal) return { amount: manualTotal, currency: upper(manual.currency || 'USD'), source: 'manual' };
        return null;
    }

    // Seña requerida de la cotización manual (801:556): artist_manual_quotes.
    function depositRequired(manual) {
        if (!manual) return null;
        var amount = storedAmount(manual.deposit_amount);
        if (!amount) return null;
        var pct = Number(manual.deposit_pct);
        return { amount: amount, currency: upper(manual.currency || 'USD'), pct: isFinite(pct) ? pct : null };
    }

    // Convierte con la función dada (CurrencyUtils.convert); null si no se puede.
    function convertWith(convert, amount, from, to) {
        if (upper(from) === upper(to)) return amount;
        if (typeof convert !== 'function') return null;
        try {
            var out = convert(amount, upper(from), upper(to));
            return out == null || !isFinite(out) ? null : Number(out);
        } catch (e) { return null; }
    }

    // Suma pagos en `currency`; lo que no se puede convertir queda aparte.
    function sumIn(payments, currency, convert, filter) {
        var total = 0;
        var others = {};
        (payments || []).forEach(function (p) {
            if (filter && !filter(p)) return;
            var v = convertWith(convert, p.amount, p.currency, currency);
            if (v == null) { others[p.currency] = round2((others[p.currency] || 0) + p.amount); return; }
            total += v;
        });
        return {
            total: round2(total),
            others: Object.keys(others).sort().map(function (code) { return { currency: code, amount: others[code] }; })
        };
    }

    /**
     * Estado de cobro de una cotización.
     *   { currency, total, paid, balance, others, count, percent, lastPaidOn,
     *     deposit: { required, currency, pct, paid, status } | null }
     * status de la seña: 'paid' (cubierta con pagos de seña o con lo cobrado en
     * total) · 'partial' · 'pending'.
     */
    function summarize(quote, manual, payments, opts) {
        opts = opts || {};
        var list = sortPayments((payments || []).map(function (p) { return p && p.paidOn !== undefined && p.quotationId !== undefined ? p : normalize(p); }));
        var agreed = agreedTotal(quote, manual);
        var dep = depositRequired(manual);
        var currency = agreed ? agreed.currency : (dep ? dep.currency : (list[0] ? list[0].currency : upper(opts.currency || 'USD')));
        var paid = sumIn(list, currency, opts.convert);
        var total = agreed ? agreed.amount : null;
        var out = {
            currency: currency,
            total: total,
            paid: paid.total,
            others: paid.others,
            balance: total != null ? round2(Math.max(0, total - paid.total)) : null,
            overpaid: total != null && paid.total - total > 0.005 ? round2(paid.total - total) : 0,
            count: list.length,
            percent: total ? Math.min(100, Math.round((paid.total / total) * 100)) : 0,
            lastPaidOn: list[0] ? list[0].paidOn : null,
            payments: list,
            deposit: null
        };
        if (dep) {
            var depPaid = sumIn(list, dep.currency, opts.convert, function (p) { return p.kind === 'deposit'; }).total;
            var allPaid = currency === dep.currency ? paid.total : sumIn(list, dep.currency, opts.convert).total;
            var status = 'pending';
            if (depPaid + 0.005 >= dep.amount || allPaid + 0.005 >= dep.amount) status = 'paid';
            else if (depPaid > 0 || allPaid > 0) status = 'partial';
            out.deposit = { required: dep.amount, currency: dep.currency, pct: dep.pct, paid: round2(depPaid), status: status };
        }
        return out;
    }

    /* ------------------------------- validación ------------------------------- */
    function validateFile(file) {
        if (!file) return null;
        if (file.size > MAX_FILE_BYTES) return 'El comprobante puede pesar hasta 10 MB.';
        var mime = String(file.type || '').toLowerCase();
        var name = String(file.name || '').toLowerCase();
        var ok = RECEIPT_MIME.indexOf(mime) !== -1 || (!mime && /\.(jpe?g|png|webp|heic|heif|pdf)$/.test(name));
        if (!ok) return 'Subí una imagen (JPG, PNG, WEBP, HEIC) o un PDF.';
        return null;
    }

    /**
     * Valida el formulario de "Registrar pago". Devuelve
     *   { ok, errors: { campo: mensaje }, value: { kind, method, amount, currency, paid_on, note } }
     * opts.today (Date o ISO) para fijar el "hoy" en los tests.
     */
    function validate(input, opts) {
        input = input || {};
        opts = opts || {};
        var errors = {};
        var today = cleanDate(opts.today instanceof Date ? isoDateLocal(opts.today) : opts.today) || isoDateLocal(new Date());

        if (!input.quotationId && input.quotationId !== 0) errors.quotationId = 'Elegí la cotización.';
        var kind = KINDS.indexOf(input.kind) !== -1 ? input.kind : null;
        if (!kind) errors.kind = 'Elegí el tipo de pago.';
        var method = METHODS.indexOf(input.method) !== -1 ? input.method : null;
        if (!method) errors.method = 'Elegí el medio de pago.';

        var amount = parseAmount(input.amount);
        if (!isFinite(amount) || amount <= 0) errors.amount = 'Ingresá un monto mayor a cero.';
        else if (amount > MAX_AMOUNT) errors.amount = 'El monto es demasiado alto.';
        else if (hasDecimalsOver2(amount)) errors.amount = 'Usá hasta 2 decimales.';

        var currency = upper(input.currency);
        if (!isCurrency(currency)) errors.currency = 'Elegí una moneda de la lista.';

        var paidOn = cleanDate(input.paidOn || input.paid_on);
        if (!paidOn) errors.paidOn = 'Elegí la fecha del pago.';
        else if (paidOn > addDays(today, 1)) errors.paidOn = 'La fecha del pago no puede ser futura.';
        else if (paidOn < MIN_DATE) errors.paidOn = 'Revisá la fecha del pago.';

        var note = String(input.note == null ? '' : input.note).trim();
        if (note.length > MAX_NOTE) errors.note = 'La nota puede tener hasta ' + MAX_NOTE + ' caracteres.';

        var fileError = validateFile(input.file);
        if (fileError) errors.file = fileError;

        return {
            ok: Object.keys(errors).length === 0,
            errors: errors,
            value: {
                quotationId: input.quotationId != null ? Number(input.quotationId) : null,
                kind: kind, method: method,
                amount: isFinite(amount) ? round2(amount) : null,
                currency: currency, paid_on: paidOn, note: note || null
            }
        };
    }

    // Tipo sugerido según lo que falta: seña si hay seña pendiente, saldo si el
    // pago cubriría el resto, sesión en el medio.
    function suggestKind(summary) {
        if (!summary) return 'deposit';
        if (summary.deposit && summary.deposit.status !== 'paid' && summary.paid === 0) return 'deposit';
        if (summary.total != null && summary.paid > 0) return 'balance';
        return summary.deposit ? 'deposit' : 'session';
    }

    // Monto sugerido para el tipo elegido (en la moneda del resumen).
    function suggestAmount(summary, kind) {
        if (!summary) return null;
        if (kind === 'deposit' && summary.deposit && summary.deposit.status !== 'paid') {
            return round2(Math.max(0, summary.deposit.required - summary.deposit.paid)) || null;
        }
        if (kind === 'balance' && summary.balance) return summary.balance;
        return null;
    }

    function safeFileName(name) {
        var base = String(name || 'comprobante').normalize('NFD').replace(/[̀-ͯ]/g, '');
        base = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        return (base || 'comprobante').slice(-80);
    }

    // Ruta en el bucket privado: <artista>/<cotización>/<id>-<archivo>.
    function receiptPath(artistUserId, quotationId, fileName, unique) {
        return String(artistUserId) + '/' + String(quotationId) + '/' + String(unique || Date.now().toString(36)) + '-' + safeFileName(fileName);
    }

    /* -------------------------------- dashboard -------------------------------- */
    function groupByQuotation(payments) {
        var out = {};
        (payments || []).forEach(function (p) {
            var key = String(p.quotationId);
            (out[key] = out[key] || []).push(p);
        });
        return out;
    }

    // «Saldo pend.» (24:1425): acordado − cobrado en las cotizaciones con
    // trabajo comprometido. Las completadas cuentan solo si el artista ya
    // registra pagos en ellas (las cerradas antes del registro de pagos no se
    // toman como deuda). Sin tipo de cambio, esa cotización no suma.
    function dashboardDue(quotes, payments, target, convert) {
        var byQuote = groupByQuotation(payments);
        var due = 0;
        (quotes || []).forEach(function (q) {
            if (!q || isDraft(q)) return;
            var list = byQuote[String(q.id)] || [];
            var open = OPEN_BALANCE_STATUSES.indexOf(q.quote_status) !== -1;
            if (!open && !(q.quote_status === 'completed' && list.length)) return;
            var s = summarize(q, null, list, { convert: convert });
            if (s.total == null || !s.balance) return;
            var v = convertWith(convert, s.balance, s.currency, target);
            if (v != null) due += v;
        });
        return round2(due);
    }

    // Ingresos del mes y de la semana (lunes): pagos registrados por fecha de
    // pago + cotizaciones completadas SIN pagos registrados (por fecha de
    // cierre, como antes). Así no se cuenta dos veces el mismo trabajo.
    function income(quotes, payments, target, convert, now) {
        var base = now instanceof Date ? now : (now ? new Date(now) : new Date());
        var monthStart = new Date(base.getFullYear(), base.getMonth(), 1);
        var weekStart = new Date(base.getFullYear(), base.getMonth(), base.getDate());
        weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
        var monthIso = isoDateLocal(monthStart), weekIso = isoDateLocal(weekStart);
        var out = { month: 0, week: 0, counted: 0 };
        var withPayments = {};
        (payments || []).forEach(function (p) {
            withPayments[String(p.quotationId)] = true;
            var v = convertWith(convert, p.amount, p.currency, target);
            if (v == null || !p.paidOn) return;
            out.counted += 1;
            if (p.paidOn >= monthIso) out.month += v;
            if (p.paidOn >= weekIso) out.week += v;
        });
        (quotes || []).forEach(function (q) {
            if (!q || q.quote_status !== 'completed' || withPayments[String(q.id)]) return;
            var amount = storedAmount(q.final_budget_amount);
            if (!amount) return;
            var v = convertWith(convert, amount, q.final_budget_currency || target, target);
            if (v == null) return;
            var when = new Date(q.client_completed_at || q.artist_completed_at || q.updated_at || q.created_at);
            if (isNaN(when.getTime())) return;
            out.counted += 1;
            if (when >= monthStart) out.month += v;
            if (when >= weekStart) out.week += v;
        });
        out.month = round2(out.month);
        out.week = round2(out.week);
        return out;
    }

    // Fecha del evento en el feed: el alta si el pago es de hoy; si no, el
    // mediodía del día del pago (no "hace 1 min" para un pago de la semana pasada).
    function eventTime(p) {
        var created = p.createdAt ? new Date(p.createdAt) : null;
        if (p.paidOn && created && !isNaN(created.getTime()) && isoDateLocal(created) === p.paidOn) return created.toISOString();
        if (p.paidOn) {
            var d = p.paidOn.split('-');
            return new Date(Number(d[0]), Number(d[1]) - 1, Number(d[2]), 12, 0, 0).toISOString();
        }
        return p.createdAt || null;
    }

    // Actividad reciente (24:1425): «Pago recibido · Mateo · $180».
    function activityEvents(payments, opts) {
        opts = opts || {};
        var money = typeof opts.money === 'function' ? opts.money : formatMoney;
        var since = opts.sinceDays != null ? Date.now() - opts.sinceDays * 86400000 : null;
        return (payments || []).map(function (p) {
            var when = eventTime(p);
            if (since != null && when && Date.parse(when) < since) return null;
            var who = String(p.clientName || '').trim().split(/\s+/)[0] || 'Cliente';
            return {
                icon: 'dollar-sign',
                txt: (KIND_EVENT[p.kind] || 'Pago recibido') + ' · ' + who + ' · ' + money(p.amount, p.currency),
                when: when,
                quoteId: p.quoteId
            };
        }).filter(Boolean);
    }

    /* -------------------------------- formato -------------------------------- */
    // 1240 → "USD 1.240" · 1240.5 → "USD 1.240,50" (números europeos del DS).
    function formatMoney(amount, currency) {
        var n = round2(Math.abs(Number(amount) || 0));
        var whole = Math.floor(n);
        var cents = Math.round((n - whole) * 100);
        var grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return upper(currency || 'USD') + ' ' + grouped + (cents ? ',' + String(cents).padStart(2, '0') : '');
    }

    var MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    function formatDate(iso) {
        var c = cleanDate(iso);
        if (!c) return '';
        var p = c.split('-');
        return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] + ' ' + p[0];
    }

    function depositLabel(status) {
        if (status === 'paid') return 'Pagada';
        if (status === 'partial') return 'Parcial';
        return 'Pendiente';
    }

    return {
        CURRENCY_CODES: CURRENCY_CODES, KINDS: KINDS, KIND_LABELS: KIND_LABELS, KIND_EVENT: KIND_EVENT,
        METHODS: METHODS, METHOD_LABELS: METHOD_LABELS, PAYABLE_STATUSES: PAYABLE_STATUSES,
        OPEN_BALANCE_STATUSES: OPEN_BALANCE_STATUSES, MAX_AMOUNT: MAX_AMOUNT, MAX_NOTE: MAX_NOTE,
        MAX_FILE_BYTES: MAX_FILE_BYTES, RECEIPT_MIME: RECEIPT_MIME,
        round2: round2, isoDateLocal: isoDateLocal, cleanDate: cleanDate, parseAmount: parseAmount,
        storedAmount: storedAmount, isCurrency: isCurrency, isDraft: isDraft, isPayable: isPayable,
        normalize: normalize, sortPayments: sortPayments, agreedTotal: agreedTotal,
        depositRequired: depositRequired, convertWith: convertWith, summarize: summarize,
        validate: validate, validateFile: validateFile, suggestKind: suggestKind, suggestAmount: suggestAmount,
        safeFileName: safeFileName, receiptPath: receiptPath, groupByQuotation: groupByQuotation,
        dashboardDue: dashboardDue, income: income, eventTime: eventTime, activityEvents: activityEvents,
        formatMoney: formatMoney, formatDate: formatDate, depositLabel: depositLabel
    };
}));
