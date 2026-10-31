/**
 * WE OTZI - Modelo puro del We Ötzi Wallet (cuenta del artista · Cobros)
 * ---------------------------------------------------------------------
 * Sin DOM ni red: calcula saldos, próximas liberaciones y actividad a partir
 * de movimientos normalizados. Lo usan wallet-account.js (navegador) y
 * tests/figma-final-cuenta.test.js (Node).
 *
 * Movimiento normalizado:
 *   { id, kind, status, amount (>0), currency, title, counterparty, booking,
 *     quoteId, destinationId, serviceDate, releaseAt, occurredAt, detail,
 *     source, orderNumber, storeHold }   source: metadata_json.source ('store'
 *     en ventas de la Store; orderNumber = ST-… tomado de booking_reference;
 *     storeHold = metadata_json.store_hold, retención de soporte)
 *   kind:   payment | release | withdrawal | fee | dispute | refund | adjustment
 *   status: pending_service | awaiting_release | blocked | processing |
 *           completed | failed | cancelled
 *
 * Saldo disponible (igual que artist_wallet_available_balance en
 * supabase/migrations/20261028150000_artist_wallet.sql):
 *   + release/adjustment completados
 *   - withdrawal en proceso o completado
 *   - fee/refund completados
 *
 * Fuentes de datos (en orden): artist_wallet_movements → artist_financial_entries
 * (+ reservas abiertas de quotations_db) → solo quotations_db (modo derivado).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoWalletModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var KINDS = ['payment', 'release', 'withdrawal', 'fee', 'dispute', 'refund', 'adjustment'];
    var STATUSES = ['pending_service', 'awaiting_release', 'blocked', 'processing', 'completed', 'failed', 'cancelled'];
    var OPEN_PAYMENT = ['pending_service', 'awaiting_release', 'blocked'];
    // Horas desde que el artista marca el trabajo terminado hasta la liberación
    // automática (modo derivado de cotizaciones; el backend real define su regla).
    var AUTO_RELEASE_HOURS = 72;
    var HOUR = 3600000;

    var FILTERS = {
        todos: null,
        liberaciones: ['release'],
        retiros: ['withdrawal'],
        comisiones: ['fee'],
        disputas: ['dispute']
    };

    var STATUS_LABELS = {
        pending_service: 'Pendiente',
        awaiting_release: 'Pendiente',
        blocked: 'Bloqueados',
        processing: 'En proceso',
        completed: 'Completado',
        failed: 'Fallido',
        cancelled: 'Cancelado'
    };

    // Métodos de retiro del modal "Agregar destino de retiro" (801:569).
    var DESTINATION_METHODS = {
        lemon: { label: 'Lemon', detail: 'Billetera cripto/USD', badge: 'LEMON', tone: 'ink', rail: 'ACH', currency: 'USD', available: true },
        bank_usd: { label: 'Cuenta bancaria USD', detail: 'Transferencia ACH', badge: 'BANK', tone: 'sand', rail: 'ACH', currency: 'USD', available: true },
        bank_international: { label: 'Banco internacional', detail: 'Transferencia SEPA / SWIFT', badge: 'SEPA', tone: 'blue', rail: 'SEPA', currency: 'EUR', available: true },
        paypal: { label: 'PayPal', available: false },
        wise: { label: 'Wise', available: false },
        usdt: { label: 'USDT', available: false },
        mercado_pago: { label: 'Mercado Pago', available: false }
    };

    function num(value) {
        var n = typeof value === 'number' ? value : parseFloat(value);
        return isFinite(n) ? n : 0;
    }
    function round2(n) { return Math.round(n * 100) / 100; }
    function upper(code, fallback) { return String(code || fallback || 'USD').trim().toUpperCase(); }
    function time(value) {
        var t = value ? Date.parse(value) : NaN;
        return isNaN(t) ? null : t;
    }

    function normalizeMovement(raw) {
        raw = raw || {};
        var kind = KINDS.indexOf(raw.kind) !== -1 ? raw.kind : 'adjustment';
        var status = STATUSES.indexOf(raw.status) !== -1 ? raw.status : 'completed';
        // Origen del movimiento (metadata_json.source). Las ventas de la Store
        // guardan el número de pedido (ST-…) en booking_reference.
        var meta = raw.metadata_json && typeof raw.metadata_json === 'object' ? raw.metadata_json : {};
        var source = meta.source || raw.source || null;
        return {
            id: raw.id != null ? String(raw.id) : null,
            kind: kind,
            status: status,
            amount: round2(Math.abs(num(raw.amount))),
            currency: upper(raw.currency),
            title: String(raw.title || '').trim(),
            counterparty: raw.counterparty_name || raw.counterparty || null,
            booking: raw.booking_reference || raw.booking || null,
            quoteId: raw.quote_id || raw.quoteId || null,
            destinationId: raw.destination_id || raw.destinationId || null,
            serviceDate: raw.service_date || raw.serviceDate || null,
            releaseAt: raw.release_at || raw.releaseAt || null,
            occurredAt: raw.occurred_at || raw.occurredAt || raw.created_at || null,
            detail: (raw.metadata_json && raw.metadata_json.detail) || raw.detail || null,
            source: source ? String(source) : null,
            orderNumber: source === 'store' ? (raw.booking_reference || meta.order_number || raw.orderNumber || null) : null,
            // Retención de soporte sobre una venta de la Store
            // (set_store_order_funds_hold marca metadata_json.store_hold).
            storeHold: meta.store_hold === true || raw.storeHold === true
        };
    }

    // Contribución de un movimiento al saldo disponible.
    function availableDelta(m) {
        if ((m.kind === 'release' || m.kind === 'adjustment') && m.status === 'completed') return m.amount;
        if (m.kind === 'withdrawal' && (m.status === 'processing' || m.status === 'completed')) return -m.amount;
        if ((m.kind === 'fee' || m.kind === 'refund') && m.status === 'completed') return -m.amount;
        return 0;
    }

    // Moneda dominante del wallet: la preferida si tiene movimientos; si no, la
    // de mayor volumen; si no hay nada, la preferida o USD.
    function primaryCurrency(movements, preferred) {
        var pref = preferred ? upper(preferred) : null;
        var totals = {};
        (movements || []).forEach(function (m) { totals[m.currency] = (totals[m.currency] || 0) + m.amount; });
        if (pref && totals[pref]) return pref;
        var best = null;
        Object.keys(totals).forEach(function (code) { if (!best || totals[code] > totals[best]) best = code; });
        return best || pref || 'USD';
    }

    function summarize(movements, currency, now) {
        var cur = upper(currency);
        var nowMs = now != null ? (typeof now === 'number' ? now : Date.parse(now)) : Date.now();
        var out = { currency: cur, available: 0, pendingService: 0, awaitingRelease: 0, blocked: 0, inWithdrawal: 0, activeDisputes: 0, nextReleaseAt: null, nextReleaseHours: null, blockedCounterparty: null, blockedDispute: null };
        (movements || []).forEach(function (m) {
            if (m.currency !== cur) return;
            out.available += availableDelta(m);
            if (m.kind === 'payment' && m.status === 'pending_service') out.pendingService += m.amount;
            if (m.kind === 'payment' && m.status === 'awaiting_release') {
                out.awaitingRelease += m.amount;
                var t = time(m.releaseAt);
                if (t != null && (out.nextReleaseAt == null || t < Date.parse(out.nextReleaseAt))) out.nextReleaseAt = new Date(t).toISOString();
            }
            if (m.kind === 'dispute' && m.status === 'blocked') {
                out.blocked += m.amount;
                out.activeDisputes += 1;
                if (!out.blockedDispute) { out.blockedDispute = m; out.blockedCounterparty = m.counterparty; }
            }
            if (m.kind === 'withdrawal' && m.status === 'processing') out.inWithdrawal += m.amount;
        });
        out.available = Math.max(0, round2(out.available));
        ['pendingService', 'awaitingRelease', 'blocked', 'inWithdrawal'].forEach(function (k) { out[k] = round2(out[k]); });
        if (out.nextReleaseAt) out.nextReleaseHours = hoursUntil(out.nextReleaseAt, nowMs);
        return out;
    }

    function hoursUntil(iso, now) {
        var t = time(iso);
        if (t == null) return null;
        var nowMs = now != null ? (typeof now === 'number' ? now : Date.parse(now)) : Date.now();
        return Math.max(0, Math.ceil((t - nowMs) / HOUR));
    }

    // Reservas con fondos retenidos: pendientes de realizar, esperando
    // confirmación del cliente o bloqueadas por disputa (en ese orden).
    function upcomingReleases(movements) {
        var order = { pending_service: 0, awaiting_release: 1, blocked: 2 };
        return (movements || []).filter(function (m) {
            return m.kind === 'payment' && OPEN_PAYMENT.indexOf(m.status) !== -1;
        }).sort(function (a, b) {
            if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
            var ta = time(a.serviceDate || a.releaseAt || a.occurredAt) || 0;
            var tb = time(b.serviceDate || b.releaseAt || b.occurredAt) || 0;
            return ta - tb;
        });
    }

    function activity(movements, filter) {
        var kinds = FILTERS[filter] || null;
        return (movements || []).filter(function (m) {
            return !kinds || kinds.indexOf(m.kind) !== -1;
        }).slice().sort(function (a, b) { return (time(b.occurredAt) || 0) - (time(a.occurredAt) || 0); });
    }

    // Presentación de una fila de "Actividad reciente".
    function movementView(m) {
        var view = { icon: '↓', tone: 'success', sign: '', statusLabel: STATUS_LABELS[m.status] || '' };
        if (m.kind === 'release' || m.kind === 'adjustment') { view.icon = '↓'; view.tone = 'success'; view.sign = '+'; }
        else if (m.kind === 'payment') { view.icon = '↓'; view.tone = 'info'; view.sign = ''; }
        else if (m.kind === 'withdrawal') { view.icon = '↑'; view.tone = 'ink'; view.sign = '−'; }
        else if (m.kind === 'fee') { view.icon = '%'; view.tone = 'muted'; view.sign = '−'; }
        else if (m.kind === 'refund') { view.icon = '↑'; view.tone = 'muted'; view.sign = '−'; }
        else if (m.kind === 'dispute') { view.icon = '!'; view.tone = 'danger'; view.sign = ''; }
        if (m.kind === 'payment' && m.status === 'blocked') view.tone = 'danger';
        if (m.status === 'failed' || m.status === 'cancelled') view.tone = 'muted';
        return view;
    }

    // Estado de una reserva en "Próximas liberaciones".
    function releaseView(m, now) {
        if (m.status === 'pending_service') return { label: 'Pendiente por realizar', tone: 'success', meta: m.serviceDate ? 'Servicio: ' + formatShortDate(m.serviceDate) : 'Servicio a confirmar' };
        if (m.status === 'awaiting_release') {
            var h = hoursUntil(m.releaseAt, now);
            return { label: 'Esperando confirmación del cliente', tone: 'info', meta: h == null ? 'Liberación automática pendiente' : 'Liberación automática en ' + formatHours(h) };
        }
        if (m.storeHold) return { label: 'Retenido por soporte', tone: 'danger', meta: 'We Ötzi está revisando el pedido' };
        return { label: 'Bloqueado por disputa', tone: 'danger', meta: 'Disputa activa' };
    }

    function formatHours(h) {
        if (h == null) return '';
        if (h <= 48) return h + ' h';
        return Math.round(h / 24) + ' días';
    }

    // 1240 → "USD 1.240" · 1240.5 → "USD 1.240,50" (números europeos del DS).
    function formatMoney(amount, currency) {
        var n = round2(Math.abs(num(amount)));
        var whole = Math.floor(n);
        var cents = Math.round((n - whole) * 100);
        var grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return upper(currency) + ' ' + grouped + (cents ? ',' + String(cents).padStart(2, '0') : '');
    }

    var MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    function toDate(value) {
        if (!value) return null;
        var s = String(value);
        // Fechas sin hora: interpretarlas como locales para no correr el día.
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        var d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }
    function formatShortDate(value) {
        var d = toDate(value);
        if (!d) return '';
        return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    }

    // "1.240,50" | "1240.5" | "1,240.50" → 1240.5 (NaN si no es válido).
    function parseAmount(text) {
        var s = String(text == null ? '' : text).replace(/[^\d.,]/g, '');
        if (!s || !/\d/.test(s)) return NaN;
        var hasComma = s.indexOf(',') !== -1, hasDot = s.indexOf('.') !== -1;
        var normalized;
        if (hasComma && hasDot) {
            // El último separador es el decimal; el otro agrupa miles.
            var dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
            var other = dec === ',' ? /\./g : /,/g;
            normalized = s.replace(other, '').replace(dec, '.');
        } else if (hasComma) {
            // es-AR: la coma es decimal ("0,50"); varias comas = miles.
            normalized = (s.match(/,/g).length > 1) ? s.replace(/,/g, '') : s.replace(',', '.');
        } else if (hasDot) {
            // "1.240" o "1.240.000" = miles; "12.5" = decimal.
            var dotParts = s.split('.');
            normalized = (dotParts.length > 2 || dotParts[dotParts.length - 1].length === 3) ? s.replace(/\./g, '') : s;
        } else {
            normalized = s;
        }
        var n = parseFloat(normalized);
        return isFinite(n) ? round2(n) : NaN;
    }

    function maskIdentifier(value) {
        var clean = String(value || '').replace(/\s+/g, '');
        if (!clean) return '';
        return '···· ' + clean.slice(-4);
    }
    function last4(value) { return String(value || '').replace(/\s+/g, '').slice(-4); }

    // Número de tarjeta (PAN): 12-19 dígitos que pasan el dígito verificador de
    // Luhn, con cualquier separador que no sea una letra (espacios, guiones,
    // puntos, guiones bajos, barras…): "4111.1111.1111.1111" también es un PAN.
    // Un CBU/CVU (22 dígitos), un IBAN (lleva letras) o un alias nunca lo cumplen.
    function looksLikeCardNumber(value) {
        var text = String(value == null ? '' : value);
        if (typeof text.normalize === 'function') text = text.normalize('NFKC'); // dígitos de ancho completo → ASCII
        text = text.trim();
        if (!text || /[A-Za-z]/.test(text)) return false;
        var digits = text.replace(/\D/g, '');
        if (!/^\d{12,19}$/.test(digits)) return false;
        var sum = 0;
        for (var i = 0; i < digits.length; i++) {
            var d = Number(digits.charAt(digits.length - 1 - i));
            if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
            sum += d;
        }
        return sum % 10 === 0;
    }

    function validateDestination(input) {
        var errors = {};
        var method = DESTINATION_METHODS[input && input.method];
        if (!method || !method.available) errors.method = 'Elegí un método disponible.';
        var holder = String(input && input.holderName || '').trim();
        if (holder.length < 2) errors.holderName = 'Ingresá el titular de la cuenta.';
        var currency = upper(input && input.currency, '');
        if (!/^[A-Z]{3,4}$/.test(currency)) errors.currency = 'Elegí una moneda.';
        var id = String(input && input.accountIdentifier || '').trim();
        if (looksLikeCardNumber(id)) errors.accountIdentifier = 'No ingreses números de tarjeta. Usá el CBU, IBAN o alias de la cuenta.';
        else if (id.length < 4 || id.length > 64) errors.accountIdentifier = 'Ingresá el CBU, IBAN o alias de la cuenta.';
        else if (!/^[A-Za-z0-9 .\-_]+$/.test(id)) errors.accountIdentifier = 'Usá solo letras, números, puntos o guiones.';
        return { ok: Object.keys(errors).length === 0, errors: errors };
    }

    function validateWithdrawal(amount, available, destination) {
        if (!destination) return 'Agregá un destino de retiro.';
        if (destination.verification_status && destination.verification_status !== 'verified') return 'El destino todavía no está verificado.';
        if (!isFinite(amount) || amount <= 0) return 'Ingresá un monto mayor a cero.';
        if (amount > available + 1e-9) return 'El monto supera tu saldo disponible.';
        return null;
    }

    function initials(name) {
        return String(name || '').split(/\s+/).filter(Boolean).slice(0, 3).map(function (p) { return p[0].toUpperCase(); }).join('') || 'WO';
    }

    /* ---------------------- fuentes alternativas ---------------------- */

    // artist_financial_entries (centro de cuenta 2026-08) → movimientos.
    function fromFinancialEntries(entries) {
        var kindMap = { income: 'release', fee: 'fee', payout: 'withdrawal', refund: 'refund', adjustment: 'adjustment' };
        var statusMap = { pending: 'processing', completed: 'completed', failed: 'failed', cancelled: 'cancelled' };
        return (entries || []).filter(function (e) { return !(e.metadata_json && e.metadata_json.summary_only); }).map(function (e) {
            var kind = kindMap[e.entry_type] || 'adjustment';
            var status = statusMap[e.status] || 'completed';
            if (kind === 'release' && status === 'processing') status = 'awaiting_release';
            return normalizeMovement({ id: 'fe-' + e.id, kind: kind, status: status, amount: e.amount, currency: e.currency, title: e.title, occurred_at: e.occurred_at });
        });
    }

    // Cotizaciones → reservas con fondos (modo derivado, sin backend de pagos).
    //   client_approved  → pago pendiente por servicio
    //   artist_completed → esperando confirmación (liberación automática)
    //   completed        → fondos liberados (solo si includeCompleted)
    function fromQuotations(quotes, opts) {
        opts = opts || {};
        var out = [];
        (quotes || []).forEach(function (q) {
            var amount = num(q.final_budget_amount) || num(q.artist_budget_amount);
            if (!(amount > 0)) return;
            var currency = upper(q.final_budget_amount ? q.final_budget_currency : q.artist_budget_currency, opts.currency);
            var who = q.client_full_name || 'Cliente';
            var base = { amount: amount, currency: currency, counterparty_name: who, booking_reference: q.quote_id, quote_id: q.quote_id };
            if (q.quote_status === 'client_approved') {
                out.push(normalizeMovement(Object.assign({ id: 'q-' + q.quote_id, kind: 'payment', status: 'pending_service', title: 'Reserva — ' + who, service_date: q.next_session_date || q.client_preferred_date || null, occurred_at: q.updated_at || q.created_at }, base)));
            } else if (q.quote_status === 'artist_completed') {
                var doneAt = time(q.artist_completed_at || q.updated_at);
                out.push(normalizeMovement(Object.assign({ id: 'q-' + q.quote_id, kind: 'payment', status: 'awaiting_release', title: 'Reserva — ' + who, release_at: doneAt != null ? new Date(doneAt + AUTO_RELEASE_HOURS * HOUR).toISOString() : null, occurred_at: q.artist_completed_at || q.updated_at }, base)));
            } else if (q.quote_status === 'completed' && opts.includeCompleted) {
                out.push(normalizeMovement(Object.assign({ id: 'q-' + q.quote_id, kind: 'release', status: 'completed', title: 'Fondos liberados — ' + who, occurred_at: q.client_completed_at || q.artist_completed_at || q.updated_at }, base)));
            }
        });
        return out;
    }

    return {
        KINDS: KINDS, STATUSES: STATUSES, FILTERS: FILTERS, STATUS_LABELS: STATUS_LABELS,
        DESTINATION_METHODS: DESTINATION_METHODS, AUTO_RELEASE_HOURS: AUTO_RELEASE_HOURS,
        normalizeMovement: normalizeMovement, availableDelta: availableDelta, primaryCurrency: primaryCurrency,
        summarize: summarize, upcomingReleases: upcomingReleases, activity: activity,
        movementView: movementView, releaseView: releaseView, hoursUntil: hoursUntil, formatHours: formatHours,
        formatMoney: formatMoney, formatShortDate: formatShortDate, parseAmount: parseAmount,
        maskIdentifier: maskIdentifier, last4: last4, validateDestination: validateDestination,
        looksLikeCardNumber: looksLikeCardNumber,
        validateWithdrawal: validateWithdrawal, initials: initials,
        fromFinancialEntries: fromFinancialEntries, fromQuotations: fromQuotations
    };
}));
