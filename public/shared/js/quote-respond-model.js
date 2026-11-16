/**
 * WE OTZI - Modelo puro de la propuesta del artista (ronda 2 · cot-respuesta)
 * -------------------------------------------------------------------------
 * Lógica compartida entre el diálogo "Aceptar y enviar presupuesto"
 * (quote-respond-dialog.js) y el servidor (lib/cot-respuesta.js):
 *
 *   - quién puede (re)enviar una propuesta: mientras la cotización NO esté
 *     aprobada por ambas partes (P25) y cuándo el saldo acordado está activo;
 *   - respuestas rápidas con variables ({{cliente}}, {{presupuesto}},
 *     {{moneda}}, {{sesiones}}, {{duracion}}, {{anticipo}}, {{fechas}},
 *     {{estudio}}, {{artista}}) y su resolución antes de guardar (P4).
 *     {{seña}}, {{sena}}, {{señal}}, {{deposito}} y {{depósito}} siguen
 *     resolviendo como alias de {{anticipo}} (plantillas ya guardadas);
 *   - fechas ofrecidas: turnos con horario ("slot") y rangos de días
 *     ("range"), su validación, etiquetas en la zona horaria del artista y el
 *     cruce con la agenda real (P4). Lo confirmado bloquea: eventos que
 *     ocupan agenda, sesiones, citas de estudio, viajes y vacaciones. Los
 *     apartados pendientes de otros clientes no (todavía no son un turno);
 *   - los campos de la cotización manual en la respuesta a una solicitud de
 *     cliente (P29): desglose económico, política de reserva y cancelación,
 *     notas, términos, estudio o ubicación y complejidad. Los totales salen de
 *     WoQuotationNewModel (misma cuenta que /my-quotations/new);
 *   - los patches de quotations_db y de artist_manual_quotes.
 *
 * Sin DOM ni red. Navegador: window.WoQuoteRespondModel (requiere
 * booking-slots-model.js y quotation-new-model.js). Node: require().
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./booking-slots-model.js'), require('./quotation-new-model.js'));
    } else {
        root.WoQuoteRespondModel = factory(root.WoBookingSlots, root.WoQuotationNewModel);
    }
}(typeof self !== 'undefined' ? self : this, function (B, N) {
    'use strict';

    var MIN = 60 * 1000;
    var DAY = 24 * 60 * MIN;

    var MAX_OFFERS = 12;
    var MAX_RANGE_DAYS = 31;
    var HORIZON_DAYS = 365;
    var MAX_MESSAGE = 2000;
    var MAX_AVAILABILITY_NOTE = 140;
    var MAX_AVAILABILITY_SUMMARY = 700;
    var MAX_LOCATION = 120;
    var MAX_LONG_TEXT = 4000;
    var MAX_ITEMS = 20;
    var MAX_AMOUNT = 1000000000;
    var MAX_TEMPLATES = 20;
    var MAX_TEMPLATE_TITLE = 80;

    /* ------------------------------ utilidades ------------------------------ */
    function clean(value) { return String(value == null ? '' : value).trim(); }
    function round2(n) { return Math.round(n * 100) / 100; }
    function pad(n) { return String(n).padStart(2, '0'); }
    function isoDate(value) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(value));
        if (!m) return '';
        var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? m[0] : '';
    }
    function timeMs(value) {
        if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
        var t = Date.parse(value);
        return Number.isFinite(t) ? t : NaN;
    }
    function zone(tz) { return B.validTimeZone(tz) ? tz : B.DEFAULT_TZ; }

    // "410.000" · "410000" · "1.240,50" · "1240.5" → número (NaN si no es válido).
    function parseMoney(value) {
        if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
        var raw = clean(value);
        if (!raw || /^-/.test(raw)) return NaN;
        var s = raw.replace(/[^\d.,]/g, '');
        if (!/\d/.test(s)) return NaN;
        var hasComma = s.indexOf(',') !== -1;
        var hasDot = s.indexOf('.') !== -1;
        var normalized;
        if (hasComma && hasDot) {
            var dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
            normalized = s.replace(dec === ',' ? /\./g : /,/g, '').replace(dec, '.');
        } else if (hasComma) {
            normalized = s.match(/,/g).length > 1 || /,\d{3}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
        } else if (hasDot) {
            var parts = s.split('.');
            normalized = parts.length > 2 || parts[parts.length - 1].length === 3 ? s.replace(/\./g, '') : s;
        } else {
            normalized = s;
        }
        var n = parseFloat(normalized);
        return Number.isFinite(n) ? n : NaN;
    }

    // 410000 → "410.000" · 1240.5 → "1.240,50".
    function formatAmount(value) {
        var n = typeof value === 'number' ? value : parseMoney(value);
        if (!Number.isFinite(n)) return '';
        var fixed = round2(Math.abs(n));
        var whole = Math.floor(fixed);
        var cents = Math.round((fixed - whole) * 100);
        return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (cents ? ',' + pad(cents) : '');
    }

    function durationText(minutes) {
        var m = Math.round(Number(minutes));
        if (!Number.isFinite(m) || m <= 0) return '';
        var h = Math.floor(m / 60);
        var r = m % 60;
        if (!h) return r + ' min';
        return h + ' h' + (r ? ' ' + r + ' min' : '');
    }

    function sessionsText(count) {
        var n = Math.round(Number(count));
        if (!Number.isFinite(n) || n <= 0) return '';
        return n + (n === 1 ? ' sesión' : ' sesiones');
    }

    function firstName(name) { return clean(name).split(/\s+/)[0] || ''; }

    /* ------------------------- estado de la cotización ------------------------- */
    // Aprobada por ambas partes: el cliente aceptó la propuesta (o el artista
    // registró el acuerdo) y todo lo que viene después.
    var APPROVED_STATUSES = ['client_approved', 'in_progress', 'en_progreso', 'artist_completed', 'completed'];

    // in_progress sin respuesta ni acuerdo es el borrador del cotizador del cliente.
    function isDraftQuote(q) {
        if (!q) return false;
        var s = q.quote_status;
        if (s !== 'in_progress' && s !== 'en_progreso') return false;
        return !q.artist_responded_at && !clean(q.final_budget_amount) && !clean(q.final_sessions);
    }

    function approvedByBoth(q) {
        return !!q && APPROVED_STATUSES.indexOf(q.quote_status) !== -1 && !isDraftQuote(q);
    }

    // El saldo/importe acordado solo está activo con la cotización aprobada
    // por ambas partes; antes es solo el presupuesto propuesto (P4).
    function agreementActive(q) { return approvedByBoth(q); }

    // 'respond' primera respuesta · 'update' reenvía una propuesta abierta ·
    // 'requote' vuelve a cotizar una vencida. Una rechazada por el cliente no
    // se vuelve a cotizar: el rechazo la da por finalizada (P23).
    function proposalMode(q) {
        var s = q && q.quote_status;
        if (s === 'responded') return 'update';
        if (s === 'expired') return 'requote';
        return 'respond';
    }

    var CLIENT_REJECTED_REASON = 'El cliente rechazó esta cotización y quedó finalizada. Para retomarla, el cliente tiene que iniciar una nueva.';

    // ¿El artista puede enviar o modificar la propuesta? Lista de bloqueo: todo
    // estado que no sea "aprobada por ambos" o cerrado admite propuesta, así un
    // estado nuevo de la negociación no queda afuera.
    function canPropose(q) {
        if (!q) return { ok: false, code: 'not_found', reason: 'No encontramos la cotización.' };
        if (isDraftQuote(q)) return { ok: false, code: 'draft', reason: 'Esta solicitud todavía es un borrador del cliente.' };
        if (q.quote_status === 'cancelled') return { ok: false, code: 'cancelled', reason: 'La cotización está cancelada: ya no admite propuestas.' };
        // P23: el rechazo del cliente es definitivo; el artista no la reabre.
        if (q.quote_status === 'client_rejected') return { ok: false, code: 'client_rejected', reason: CLIENT_REJECTED_REASON };
        if (approvedByBoth(q)) {
            return { ok: false, code: 'approved', reason: 'La cotización ya está aprobada por ambas partes. Los cambios posteriores se acuerdan con el cliente.' };
        }
        if ((q.dispute_status || 'none') === 'open') return { ok: false, code: 'dispute', reason: 'Hay un reclamo abierto: la propuesta no se puede modificar hasta que se resuelva.' };
        return { ok: true, mode: proposalMode(q) };
    }

    /* --------------------------- respuestas rápidas --------------------------- */
    var VARIABLES = [
        { key: 'cliente', label: 'Cliente', hint: 'Nombre del cliente' },
        { key: 'presupuesto', label: 'Presupuesto', hint: 'Monto de tu propuesta' },
        { key: 'moneda', label: 'Moneda', hint: 'Moneda del presupuesto' },
        { key: 'sesiones', label: 'Sesiones', hint: 'Cantidad de sesiones' },
        { key: 'duracion', label: 'Duración', hint: 'Duración por sesión' },
        { key: 'anticipo', label: 'Anticipo', hint: 'Anticipo para reservar' },
        { key: 'fechas', label: 'Fechas', hint: 'Fechas que ofreces' },
        { key: 'estudio', label: 'Estudio', hint: 'Estudio o ubicación' },
        { key: 'artista', label: 'Artista', hint: 'Tu nombre' }
    ];
    // {{anticipo}} es la variable canónica. Las formas anteriores quedan como
    // alias: los artistas ya tienen respuestas rápidas guardadas con {{seña}}.
    var VARIABLE_ALIASES = {
        'seña': 'anticipo', sena: 'anticipo', 'señal': 'anticipo', deposito: 'anticipo', 'depósito': 'anticipo',
        'duración': 'duracion', monto: 'presupuesto', precio: 'presupuesto',
        nombre: 'cliente', fecha: 'fechas', turnos: 'fechas', lugar: 'estudio', ubicacion: 'estudio', 'ubicación': 'estudio'
    };
    var VARIABLE_RE = /\{\{\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ_]{2,24})\s*\}\}/g;

    var DEFAULT_TEMPLATES = [
        {
            id: 'default-propuesta', title: 'Propuesta completa',
            body: 'Hola {{cliente}}, gracias por tu solicitud. Mi presupuesto para tu tatuaje es de {{presupuesto}} {{moneda}}, en {{sesiones}} de {{duracion}}. Para reservar pido un anticipo de {{anticipo}}. Estas son las fechas que te puedo ofrecer: {{fechas}}. Cuéntame cuál te queda mejor.'
        },
        {
            id: 'default-fechas', title: 'Fechas disponibles',
            body: 'Hola {{cliente}}, estas son las fechas que tengo disponibles: {{fechas}}. Elige la que prefieras y la confirmamos.'
        },
        {
            id: 'default-ajuste', title: 'Propuesta actualizada',
            body: 'Hola {{cliente}}, actualicé la propuesta con lo que conversamos: {{presupuesto}} {{moneda}}, {{sesiones}}. Revísala y cuéntame si te parece bien.'
        },
        {
            id: 'default-dudas', title: 'Antes de confirmar',
            body: 'Hola {{cliente}}, te envío mi propuesta: {{presupuesto}} {{moneda}}. Si quieres ajustar el tamaño, la zona o las fechas, escríbeme y lo vemos juntos.'
        }
    ];

    function variableKey(raw) {
        var key = clean(raw).toLowerCase();
        if (VARIABLE_ALIASES[key]) key = VARIABLE_ALIASES[key];
        return VARIABLES.some(function (v) { return v.key === key; }) ? key : '';
    }

    /**
     * Valores de las variables para una propuesta.
     * input: { clientName, artistName, amount, currency, sessions, minutes,
     *          depositPct, depositAmount, offerLabels: [], location }
     */
    function templateVars(input) {
        var o = input || {};
        var amount = typeof o.amount === 'number' ? o.amount : parseMoney(o.amount);
        var currency = clean(o.currency).toUpperCase();
        var pct = o.depositPct == null || o.depositPct === '' ? NaN : Number(o.depositPct);
        var depositAmount = o.depositAmount == null || o.depositAmount === '' ? NaN : Number(o.depositAmount);
        if (!Number.isFinite(depositAmount) && Number.isFinite(pct) && Number.isFinite(amount)) depositAmount = round2(amount * pct / 100);
        var deposit = 'sin anticipo';
        if (Number.isFinite(pct) && pct > 0) {
            deposit = String(pct).replace('.', ',') + ' %';
            if (Number.isFinite(depositAmount) && depositAmount > 0) deposit += ' (' + formatAmount(depositAmount) + (currency ? ' ' + currency : '') + ')';
        }
        var labels = (Array.isArray(o.offerLabels) ? o.offerLabels : []).map(clean).filter(Boolean);
        return {
            cliente: firstName(o.clientName),
            presupuesto: Number.isFinite(amount) && amount > 0 ? formatAmount(amount) : '',
            moneda: currency,
            sesiones: sessionsText(o.sessions),
            duracion: durationText(o.minutes),
            anticipo: deposit,
            fechas: labels.length ? labels.join('; ') : 'a coordinar',
            estudio: clean(o.location) || 'a confirmar',
            artista: clean(o.artistName)
        };
    }

    /**
     * Reemplaza las variables conocidas. Las desconocidas quedan tal cual y se
     * informan en `unknown`; las conocidas sin valor se informan en `empty`.
     */
    function resolveTemplate(body, vars) {
        var unknown = [];
        var empty = [];
        var values = vars || {};
        var text = String(body == null ? '' : body).replace(VARIABLE_RE, function (match, raw) {
            var key = variableKey(raw);
            if (!key) { if (unknown.indexOf(match) === -1) unknown.push(match); return match; }
            var value = clean(values[key]);
            if (!value && empty.indexOf(key) === -1) empty.push(key);
            return value;
        });
        // Un valor vacío no deja dobles espacios ni un espacio antes de la puntuación.
        text = text.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.;:!?])/g, '$1').replace(/[ \t]+\n/g, '\n').trim();
        return { text: text, unknown: unknown, empty: empty };
    }

    // Inserta {{clave}} en la posición del cursor. Devuelve el texto y el cursor nuevo.
    function insertVariable(text, key, selectionStart, selectionEnd) {
        var value = String(text == null ? '' : text);
        var token = '{{' + key + '}}';
        var start = Number.isInteger(selectionStart) ? Math.max(0, Math.min(selectionStart, value.length)) : value.length;
        var end = Number.isInteger(selectionEnd) ? Math.max(start, Math.min(selectionEnd, value.length)) : start;
        var before = value.slice(0, start);
        var after = value.slice(end);
        var lead = before && !/\s$/.test(before) ? ' ' : '';
        var trail = after && !/^[\s,.;:!?)]/.test(after) ? ' ' : '';
        var inserted = lead + token + trail;
        return { text: before + inserted + after, caret: before.length + inserted.length };
    }

    function validateTemplate(input) {
        var title = clean(input && input.title);
        var body = clean(input && input.body);
        var errors = {};
        if (!title) errors.title = 'Ponle un nombre a la respuesta rápida.';
        else if (title.length > MAX_TEMPLATE_TITLE) errors.title = 'El nombre admite hasta ' + MAX_TEMPLATE_TITLE + ' caracteres.';
        if (!body) errors.body = 'Escribe el mensaje antes de guardarlo.';
        else if (body.length > MAX_MESSAGE) errors.body = 'El mensaje admite hasta ' + MAX_MESSAGE + ' caracteres.';
        return { ok: Object.keys(errors).length === 0, errors: errors, value: { title: title, body: body } };
    }

    /* ----------------------------- fechas ofrecidas ----------------------------- */
    var MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    var WEEKDAYS_SHORT = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
    var WEEKDAYS_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
    var MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

    function dateParts(date) { var p = String(date).split('-').map(Number); return { y: p[0], m: p[1], d: p[2] }; }

    // "sáb 5 dic 2026".
    function dayLabel(date) {
        var p = dateParts(date);
        return WEEKDAYS_SHORT[B.weekdayIndex(date)] + ' ' + p.d + ' ' + MONTHS_SHORT[p.m - 1] + ' ' + p.y;
    }
    // "sábado 5 de diciembre de 2026" (lectores de pantalla).
    function dayLabelLong(date) {
        var p = dateParts(date);
        return WEEKDAYS_LONG[B.weekdayIndex(date)] + ' ' + p.d + ' de ' + MONTHS_LONG[p.m - 1] + ' de ' + p.y;
    }
    // "5 al 12 dic 2026" · "28 nov al 3 dic 2026" · "28 dic 2026 al 3 ene 2027".
    function rangeLabel(from, to) {
        if (from === to) return dayLabel(from);
        var a = dateParts(from);
        var b = dateParts(to);
        if (a.y !== b.y) return a.d + ' ' + MONTHS_SHORT[a.m - 1] + ' ' + a.y + ' al ' + b.d + ' ' + MONTHS_SHORT[b.m - 1] + ' ' + b.y;
        if (a.m !== b.m) return a.d + ' ' + MONTHS_SHORT[a.m - 1] + ' al ' + b.d + ' ' + MONTHS_SHORT[b.m - 1] + ' ' + b.y;
        return a.d + ' al ' + b.d + ' ' + MONTHS_SHORT[b.m - 1] + ' ' + b.y;
    }
    function monthLabel(month) {
        var m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
        return m ? MONTHS_LONG[+m[2] - 1] + ' ' + m[1] : '';
    }
    function daysBetween(from, to) {
        var a = dateParts(from);
        var b = dateParts(to);
        return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY);
    }
    function eachDate(from, to, visit) {
        var guard = 0;
        for (var d = from; d <= to && guard++ < 800; d = B.addDays(d, 1)) visit(d);
    }

    function offerLabel(offer, tz) {
        if (!offer) return '';
        if (offer.kind === 'range') return rangeLabel(offer.from, offer.to);
        return B.slotLabel(offer.start, zone(tz), offer.end);
    }

    function offerKey(offer) {
        return offer.kind === 'range' ? 'range:' + offer.from + ':' + offer.to : 'slot:' + offer.start + ':' + offer.end;
    }

    /**
     * Valida y normaliza UNA fecha ofrecida.
     *   { kind: 'slot', start, end }        turno con horario (instantes ISO)
     *   { kind: 'range', from, to }         rango de días en la zona del artista
     * → { ok, value } | { ok: false, error }
     */
    function normalizeOffer(raw, opts) {
        var o = opts || {};
        var tz = zone(o.tz);
        var now = Number.isFinite(timeMs(o.now)) ? timeMs(o.now) : Date.now();
        var kind = raw && raw.kind === 'range' ? 'range' : 'slot';
        if (!raw || typeof raw !== 'object') return { ok: false, error: 'La fecha ofrecida no es válida.' };
        if (kind === 'range') {
            var from = isoDate(raw.from);
            var to = isoDate(raw.to || raw.from);
            if (!from || !to) return { ok: false, error: 'El rango de fechas no es válido.' };
            if (to < from) return { ok: false, error: 'El rango termina antes de empezar.' };
            if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) return { ok: false, error: 'Un rango admite hasta ' + MAX_RANGE_DAYS + ' días.' };
            var today = B.zonedDate(now, tz);
            if (from < today) return { ok: false, error: 'El rango empieza en una fecha que ya pasó.' };
            if (daysBetween(today, from) > HORIZON_DAYS) return { ok: false, error: 'Ofrece fechas dentro de los próximos 12 meses.' };
            return {
                ok: true,
                value: {
                    kind: 'range', from: from, to: to,
                    start: new Date(B.wallToUtc(from, 0, tz)).toISOString(),
                    end: new Date(B.wallToUtc(B.addDays(to, 1), 0, tz)).toISOString()
                }
            };
        }
        var start = timeMs(raw.start);
        var end = timeMs(raw.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return { ok: false, error: 'El horario ofrecido no es válido.' };
        if (end <= start) return { ok: false, error: 'El horario termina antes de empezar.' };
        var length = (end - start) / MIN;
        if (length < 15) return { ok: false, error: 'Un turno dura al menos 15 minutos.' };
        if (length > 24 * 60) return { ok: false, error: 'Un turno no puede durar más de 24 horas.' };
        if (start <= now) return { ok: false, error: 'Ese horario ya pasó.' };
        if (start - now > HORIZON_DAYS * DAY) return { ok: false, error: 'Ofrece fechas dentro de los próximos 12 meses.' };
        return { ok: true, value: { kind: 'slot', start: new Date(start).toISOString(), end: new Date(end).toISOString() } };
    }

    /**
     * Lista completa: sin duplicados, ordenada y con tope. `errors` lleva el
     * índice original de cada ítem inválido.
     */
    function normalizeOffers(list, opts) {
        var items = Array.isArray(list) ? list : [];
        var errors = [];
        var seen = {};
        var value = [];
        if (items.length > MAX_OFFERS) {
            return { ok: false, value: [], errors: [{ index: -1, error: 'Puedes ofrecer hasta ' + MAX_OFFERS + ' fechas.' }] };
        }
        items.forEach(function (raw, index) {
            var result = normalizeOffer(raw, opts);
            if (!result.ok) { errors.push({ index: index, error: result.error }); return; }
            var key = offerKey(result.value);
            if (seen[key]) return;
            seen[key] = true;
            value.push(Object.assign({ index: index }, result.value));
        });
        value.sort(function (a, b) { return timeMs(a.start) - timeMs(b.start) || timeMs(a.end) - timeMs(b.end); });
        return { ok: errors.length === 0, value: value, errors: errors };
    }

    // Forma guardada en quotations_db.offered_slots.
    function storedOffers(offers, tz) {
        var z = zone(tz);
        return (offers || []).map(function (offer) {
            var out = { kind: offer.kind, start: offer.start, end: offer.end, label: offerLabel(offer, z), tz: z };
            if (offer.kind === 'range') { out.from = offer.from; out.to = offer.to; }
            return out;
        });
    }

    // Lo guardado → entrada del diálogo (para reabrirlo precargado). Descarta
    // lo que ya pasó.
    function offersFromStored(stored, opts) {
        var o = opts || {};
        var now = Number.isFinite(timeMs(o.now)) ? timeMs(o.now) : Date.now();
        return (Array.isArray(stored) ? stored : []).map(function (item) {
            if (!item || typeof item !== 'object') return null;
            if (item.kind === 'range') {
                var from = isoDate(item.from);
                var to = isoDate(item.to);
                if (!from || !to || !(timeMs(item.end) > now)) return null;
                // Un rango a medio transcurrir se reabre desde hoy.
                var today = B.zonedDate(now, zone(item.tz));
                if (from < today) from = today;
                if (to < from) return null;
                return { kind: 'range', from: from, to: to, label: rangeLabel(from, to) };
            }
            var start = timeMs(item.start);
            var end = timeMs(item.end);
            if (!Number.isFinite(start) || !Number.isFinite(end) || start <= now) return null;
            return { kind: 'slot', start: new Date(start).toISOString(), end: new Date(end).toISOString(), label: clean(item.label) };
        }).filter(Boolean);
    }

    // Texto para artist_availability (lo que ya muestran el panel del cliente
    // y los correos): nota libre + etiquetas.
    function offersSummary(offers, note, tz) {
        var parts = [];
        var free = clean(note);
        if (free) parts.push(free);
        (offers || []).forEach(function (offer) {
            var label = clean(offer.label) || offerLabel(offer, tz);
            if (label) parts.push(label);
        });
        var text = parts.join('; ');
        if (text.length <= MAX_AVAILABILITY_SUMMARY) return text;
        var kept = [];
        var length = 0;
        for (var i = 0; i < parts.length; i++) {
            if (length + parts[i].length + 2 > MAX_AVAILABILITY_SUMMARY - 12) break;
            kept.push(parts[i]);
            length += parts[i].length + 2;
        }
        return kept.join('; ') + '; y ' + (parts.length - kept.length) + ' más';
    }

    // Nota libre que el artista escribió junto a las fechas: es lo que queda
    // del resumen guardado al quitarle las etiquetas de las fechas.
    function noteFromSummary(summary, stored) {
        var text = clean(summary);
        if (!text) return '';
        var labels = (Array.isArray(stored) ? stored : []).map(function (s) { return clean(s && s.label); }).filter(Boolean);
        if (!labels.length) return text.slice(0, MAX_AVAILABILITY_NOTE);
        var tail = labels.join('; ');
        if (text === tail) return '';
        if (text.length > tail.length + 2 && text.slice(-(tail.length + 2)) === '; ' + tail) {
            return text.slice(0, text.length - tail.length - 2).slice(0, MAX_AVAILABILITY_NOTE);
        }
        return '';
    }

    /* --------------------------------- agenda --------------------------------- */
    // Lo que ocupa la agenda de verdad (confirmado). 'hold' = apartado pendiente
    // de otra solicitud: todavía no es un turno.
    var CONFIRMED_KINDS = ['event', 'session', 'studio_booking', 'trip', 'vacation'];
    var KIND_LABELS = {
        event: 'Evento del calendario', session: 'Sesión agendada', studio_booking: 'Cita de estudio',
        trip: 'Viaje confirmado', vacation: 'Vacaciones'
    };
    var KIND_PHRASES = {
        event: 'un evento de tu calendario', session: 'una sesión agendada', studio_booking: 'una cita de estudio',
        trip: 'un viaje confirmado', vacation: 'tus vacaciones'
    };
    // Sin horario semanal guardado, el calendario usa una jornada genérica.
    var DEFAULT_DAY = { start: '09:00', end: '21:00' };

    function defaultWeekly() {
        return B.DAY_KEYS.map(function (day) { return { day: day, enabled: true, start: DEFAULT_DAY.start, end: DEFAULT_DAY.end }; });
    }

    /**
     * Intervalos confirmados a partir de list_artist_blocking_intervals.
     * `own` = sesiones y eventos de ESTA cotización ({ start, end }): una
     * propuesta nueva puede volver a ofrecer el horario que ya ocupa ella misma.
     */
    function confirmedBusy(blocking, own) {
        var mine = (Array.isArray(own) ? own : []).map(function (o) {
            return { s: timeMs(o.start != null ? o.start : o.starts_at), e: timeMs(o.end != null ? o.end : o.ends_at) };
        }).filter(function (o) { return Number.isFinite(o.s); });
        return (Array.isArray(blocking) ? blocking : []).map(function (b) {
            return {
                s: timeMs(b.start != null ? b.start : b.starts_at),
                e: timeMs(b.end != null ? b.end : b.ends_at),
                kind: b.kind || 'event'
            };
        }).filter(function (b) {
            if (!Number.isFinite(b.s) || !Number.isFinite(b.e) || b.e <= b.s) return false;
            if (CONFIRMED_KINDS.indexOf(b.kind) === -1) return false;
            if (b.kind !== 'session' && b.kind !== 'event') return true;
            return !mine.some(function (o) {
                return Math.abs(o.s - b.s) < 1000 && (!Number.isFinite(o.e) || Math.abs(o.e - b.e) < 1000);
            });
        }).sort(function (a, b) { return a.s - b.s; });
    }

    function mergeIntervals(list) {
        var sorted = (list || []).slice().sort(function (a, b) { return a.s - b.s; });
        var out = [];
        sorted.forEach(function (item) {
            var last = out[out.length - 1];
            if (last && item.s <= last.e) last.e = Math.max(last.e, item.e);
            else out.push({ s: item.s, e: item.e });
        });
        return out;
    }

    /**
     * Estado de un día para el calendario del diálogo.
     *   past     ya pasó
     *   busy     ocupado: lo confirmado no deja un hueco del largo de la sesión
     *   closed   sin horario de atención ese día (se puede ofrecer igual)
     *   partial  con horario y algo confirmado, pero queda lugar
     *   free     con horario y sin nada confirmado
     */
    function dayAvailability(o) {
        var tz = zone(o.tz);
        var date = o.date;
        var now = Number.isFinite(timeMs(o.now)) ? timeMs(o.now) : Date.now();
        var minutes = Math.max(15, Math.round(Number(o.minutes)) || 60);
        var dayStart = B.wallToUtc(date, 0, tz);
        var dayEnd = B.wallToUtc(B.addDays(date, 1), 0, tz);
        var busy = (o.busy || []).filter(function (b) { return b.s < dayEnd && b.e > dayStart; });
        var windows = (o.windows || []).map(function (w) { return { s: w.s, e: w.e }; });
        var slots = (o.slots || []).map(function (s) { return { start: s.start, end: s.end }; });
        var day = {
            date: date, status: 'free',
            open: o.open ? { s: o.open.s, e: o.open.e } : null,
            windows: windows, slots: slots, busy: busy
        };
        if (date < B.zonedDate(now, tz)) { day.status = 'past'; day.slots = []; day.windows = []; return day; }
        var ref = day.open || { s: dayStart, e: dayEnd };
        var from = Math.max(ref.s, now);
        if (from >= ref.e) { day.status = 'closed'; day.slots = []; return day; }
        // El motor de turnos ya decidió que hay lugar (p. ej. un destino Travel
        // con horario propio dentro de un viaje confirmado).
        if (slots.length) {
            day.status = busy.some(function (b) { return b.kind !== 'trip'; }) ? 'partial' : 'free';
            return day;
        }
        var free = B.subtract(from, ref.e, mergeIntervals(busy));
        var fits = free.some(function (w) { return w.e - w.s >= minutes * MIN; });
        if (!fits) day.status = busy.length ? 'busy' : 'closed';
        else if (!day.open) day.status = 'closed';
        else day.status = busy.length ? 'partial' : 'free';
        return day;
    }

    /**
     * Agenda del artista para un rango de días (inclusive), con el largo de
     * sesión de la propuesta.
     * computeAgenda({ tz, from, to, now, minutes, settings, availability,
     *                 locations, busy })
     *   → { tz, schedule: 'own' | 'default', minutes, days: [dayAvailability] }
     */
    function computeAgenda(opts) {
        var o = opts || {};
        var tz = zone(o.tz);
        var now = Number.isFinite(timeMs(o.now)) ? timeMs(o.now) : Date.now();
        var minutes = Math.min(1440, Math.max(15, Math.round(Number(o.minutes)) || 180));
        var from = isoDate(o.from);
        var to = isoDate(o.to);
        var out = { tz: tz, schedule: 'own', minutes: minutes, days: [] };
        if (!from || !to || to < from) return out;
        var hasSchedule = B.hasStoredSchedule(o.availability);
        var availability = hasSchedule ? o.availability : { weekly: defaultWeekly() };
        var locations = hasSchedule ? (o.locations || []) : [];
        if (!hasSchedule) out.schedule = 'default';
        var base = B.normalizeSettings(o.settings || {});
        var settings = {
            enabled: true,
            slot_minutes: Math.min(B.LIMITS.slot_minutes[1], Math.max(B.LIMITS.slot_minutes[0], minutes)),
            slot_step_minutes: base.slot_step_minutes,
            buffer_minutes: base.buffer_minutes,
            min_notice_hours: 0,
            horizon_days: B.LIMITS.horizon_days[1],
            hold_hours: base.hold_hours
        };
        var busy = (o.busy || []).filter(function (b) { return b && Number.isFinite(b.s) && Number.isFinite(b.e) && b.e > b.s; });
        var computed = B.computeDays({
            tz: tz, now: now, settings: settings, availability: availability, locations: locations, ignoreEnabled: true,
            from: B.wallToUtc(from, 0, tz), to: B.wallToUtc(B.addDays(to, 1), 0, tz),
            busy: busy.map(function (b) { return { start: b.s, end: b.e, kind: b.kind }; })
        });
        var byDate = {};
        (computed.days || []).forEach(function (d) { byDate[d.date] = d; });
        eachDate(from, to, function (date) {
            var c = byDate[date] || {};
            out.days.push(dayAvailability({
                date: date, tz: tz, now: now, minutes: minutes, busy: busy,
                open: c.open || null, windows: c.windows || [], slots: c.slots || []
            }));
        });
        return out;
    }

    function busyLabel(b, dayStart, dayEnd, tz) {
        var name = KIND_LABELS[b.kind] || 'Ocupado';
        if (b.s <= dayStart && b.e >= dayEnd) return name + ' · todo el día';
        return name + ' · ' + B.zonedTime(Math.max(b.s, dayStart), tz) + '–' + B.zonedTime(Math.min(b.e, dayEnd), tz);
    }

    // Forma pública del calendario (lo que viaja al navegador del artista).
    function publicAgenda(agenda) {
        var tz = zone(agenda && agenda.tz);
        return {
            timezone: tz,
            schedule: agenda.schedule,
            minutes: agenda.minutes,
            days: (agenda.days || []).map(function (day) {
                var dayStart = B.wallToUtc(day.date, 0, tz);
                var dayEnd = B.wallToUtc(B.addDays(day.date, 1), 0, tz);
                return {
                    date: day.date,
                    status: day.status,
                    open: day.open ? B.zonedTime(day.open.s, tz) + '–' + B.zonedTime(day.open.e, tz) : null,
                    slots: (day.slots || []).map(function (s) {
                        return { start: s.start, end: s.end, label: B.zonedTime(s.start, tz) + '–' + B.zonedTime(s.end, tz) };
                    }),
                    busy: (day.busy || []).map(function (b) {
                        return {
                            start: new Date(Math.max(b.s, dayStart)).toISOString(),
                            end: new Date(Math.min(b.e, dayEnd)).toISOString(),
                            kind: b.kind, label: busyLabel(b, dayStart, dayEnd, tz)
                        };
                    })
                };
            })
        };
    }

    // Rango de fechas (inclusive) que cubre todas las ofertas, para pedir la agenda.
    function offersSpan(offers, tz) {
        var z = zone(tz);
        var from = '';
        var to = '';
        (offers || []).forEach(function (offer) {
            var a = offer.kind === 'range' ? offer.from : B.zonedDate(offer.start, z);
            var b = offer.kind === 'range' ? offer.to : B.zonedDate(timeMs(offer.end) - 1, z);
            if (!from || a < from) from = a;
            if (!to || b > to) to = b;
        });
        return from ? { from: from, to: to } : null;
    }

    /**
     * Ofertas que chocan con la agenda confirmada.
     * findConflicts(offers, agenda) → [{ index, label, reason }]
     *   slot   se superpone con algo confirmado (salvo que caiga entero en un
     *          hueco que el motor de turnos ya dio por libre);
     *   range  incluye algún día ocupado o que ya pasó.
     */
    function findConflicts(offers, agenda) {
        var tz = zone(agenda && agenda.tz);
        var days = {};
        ((agenda && agenda.days) || []).forEach(function (d) { days[d.date] = d; });
        var conflicts = [];
        (offers || []).forEach(function (offer, position) {
            var index = offer.index != null ? offer.index : position;
            var label = offerLabel(offer, tz);
            if (offer.kind === 'range') {
                var blocked = [];
                eachDate(offer.from, offer.to, function (date) {
                    var day = days[date];
                    if (day && (day.status === 'busy' || day.status === 'past')) blocked.push(date);
                });
                if (blocked.length) {
                    var names = blocked.slice(0, 4).map(function (date) { var p = dateParts(date); return p.d + ' ' + MONTHS_SHORT[p.m - 1]; });
                    conflicts.push({
                        index: index, label: label, kind: 'range', dates: blocked,
                        reason: 'Incluye días ocupados en tu agenda: ' + names.join(', ') + (blocked.length > 4 ? ' y ' + (blocked.length - 4) + ' más' : '') + '.'
                    });
                }
                return;
            }
            var s = timeMs(offer.start);
            var e = timeMs(offer.end);
            var day = days[B.zonedDate(s, tz)];
            if (day && (day.windows || []).some(function (w) { return s >= w.s && e <= w.e; })) return;
            var hit = null;
            ((agenda && agenda.days) || []).some(function (d) {
                hit = (d.busy || []).find(function (b) { return s < b.e && e > b.s; }) || null;
                return !!hit;
            });
            if (hit) {
                conflicts.push({
                    index: index, label: label, kind: 'slot', busyKind: hit.kind,
                    reason: 'Se superpone con ' + (KIND_PHRASES[hit.kind] || 'algo confirmado en tu agenda') + '.'
                });
            }
        });
        return conflicts;
    }

    // Días consecutivos sin ocupar dentro de [from, to]: el diálogo los usa para
    // partir un rango que cruza días ocupados. `statusOf(date)` → estado del día.
    function splitRange(from, to, statusOf) {
        var ranges = [];
        var skipped = [];
        var current = null;
        eachDate(from, to, function (date) {
            var status = statusOf(date);
            if (status === 'busy' || status === 'past') {
                skipped.push(date);
                if (current) { ranges.push(current); current = null; }
                return;
            }
            if (current) current.to = date;
            else current = { kind: 'range', from: date, to: date };
        });
        if (current) ranges.push(current);
        return { ranges: ranges, skipped: skipped };
    }

    /* ------------------------ campos de la cotización manual ------------------------ */
    var NO_POLICY = '';
    var POLICY_OPTIONS = [{ value: NO_POLICY, label: 'Sin política indicada' }].concat(N.POLICIES.map(function (p) {
        return { value: p.value, label: p.label };
    }));
    var COMPLEXITY_OPTIONS = N.COMPLEXITY_OPTIONS.slice();

    function policyValue(value) {
        var v = clean(value);
        return N.POLICIES.some(function (p) { return p.value === v; }) ? v : NO_POLICY;
    }

    function cleanItems(items) {
        return (Array.isArray(items) ? items : []).map(function (it) {
            var qty = it && it.qty != null && it.qty !== '' ? N.num(it.qty) : 1;
            return {
                name: clean(it && it.name).slice(0, 120),
                description: clean(it && it.description).slice(0, 240),
                qty: Math.max(0, qty),
                price: Math.max(0, N.num(it && it.price))
            };
        }).filter(function (it) { return it.name || it.price > 0; });
    }

    // Misma cuenta que la cotización manual (subtotal, descuento, impuestos,
    // total, anticipo y saldo).
    function extrasTotals(extras, depositPct) {
        var e = extras || {};
        return N.computeTotals({
            items: cleanItems(e.items), discountPct: e.discountPct, taxPct: e.taxPct, depositPct: depositPct
        });
    }

    // Fila de artist_manual_quotes → campos del diálogo.
    function extrasFromManual(manual) {
        var m = manual || {};
        var project = m.project && typeof m.project === 'object' ? m.project : {};
        return {
            items: (Array.isArray(m.line_items) ? m.line_items : []).map(function (it) {
                return { name: clean(it && it.name), description: clean(it && it.description), qty: it && it.qty != null ? it.qty : 1, price: it && it.price != null ? it.price : '' };
            }).filter(function (it) { return it.name || N.num(it.price) > 0; }),
            discountPct: N.num(m.discount_pct),
            taxPct: N.num(m.tax_pct),
            policy: manual ? policyValue(m.cancellation_policy) : NO_POLICY,
            clientNotes: clean(m.client_notes),
            extraTerms: clean(m.extra_terms),
            complexity: COMPLEXITY_OPTIONS.indexOf(clean(project.complexity)) !== -1 ? clean(project.complexity) : '',
            location: clean(project.location)
        };
    }

    /* -------------------------------- propuesta -------------------------------- */
    /**
     * Valida el formulario de la propuesta.
     * input: { amount, currency, sessions, minutes, deposit_pct, expiry_enabled,
     *          expiry_days, location, complexity, availability_note, message,
     *          extras: { items, discount_pct, tax_pct, policy, client_notes,
     *                    extra_terms } }
     * → { ok, errors: { campo: mensaje }, firstError, value }
     */
    function validateProposal(input) {
        var src = input || {};
        var rawExtras = src.extras && typeof src.extras === 'object' ? src.extras : {};
        var errors = {};

        var rawItems = Array.isArray(rawExtras.items) ? rawExtras.items : [];
        var items = cleanItems(rawItems);
        if (rawItems.length > MAX_ITEMS || items.length > MAX_ITEMS) errors.items = 'El desglose admite hasta ' + MAX_ITEMS + ' conceptos.';
        else if (items.some(function (it) { return it.price > 0 && !it.name; })) errors.items = 'Ponle un nombre a cada concepto con precio.';
        else if (items.some(function (it) { return it.price > MAX_AMOUNT || it.qty > 9999; })) errors.items = 'Revisa las cantidades y los precios del desglose.';
        var priced = items.filter(function (it) { return it.name && N.lineTotal(it) > 0; });
        var hasBreakdown = priced.length > 0;

        var discountPct = hasBreakdown ? N.num(rawExtras.discount_pct != null ? rawExtras.discount_pct : rawExtras.discountPct) : 0;
        var taxPct = hasBreakdown ? N.num(rawExtras.tax_pct != null ? rawExtras.tax_pct : rawExtras.taxPct) : 0;
        if (discountPct < 0 || discountPct > 100) errors.discount_pct = 'El descuento tiene que estar entre 0 y 100 %.';
        if (taxPct < 0 || taxPct > 100) errors.tax_pct = 'Los impuestos tienen que estar entre 0 y 100 %.';

        var totals = N.computeTotals({ items: hasBreakdown ? items : [], discountPct: discountPct, taxPct: taxPct, depositPct: 0 });
        var amount = hasBreakdown ? totals.total : parseMoney(src.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            errors.amount = hasBreakdown ? 'El desglose tiene que sumar un total mayor a cero.' : 'Ingresa un presupuesto válido.';
        } else if (amount > MAX_AMOUNT) errors.amount = 'El presupuesto es demasiado alto.';
        else amount = round2(amount);

        var currency = clean(src.currency).toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) errors.currency = 'Elige la moneda del presupuesto.';

        var sessions = /^\d{1,2}$/.test(clean(src.sessions)) ? parseInt(clean(src.sessions), 10) : NaN;
        if (!(sessions >= 1 && sessions <= 30)) errors.sessions = 'Indica cuántas sesiones estimas (de 1 a 30).';

        var minutes = Math.round(Number(src.minutes));
        if (!Number.isFinite(minutes) || minutes < 15) errors.minutes = 'La duración por sesión tiene que ser de al menos 15 minutos.';
        else if (minutes > 1440) errors.minutes = 'La duración por sesión no puede superar las 24 horas.';

        var depositRaw = clean(src.deposit_pct != null ? src.deposit_pct : src.depositPct);
        var depositPct = null;
        if (depositRaw) {
            var pct = parseMoney(depositRaw);
            if (!Number.isFinite(pct) || pct < 0 || pct > 100) errors.deposit_pct = 'El anticipo tiene que ser un porcentaje entre 0 y 100.';
            else if (pct > 0) depositPct = round2(pct);
        }
        var depositAmount = depositPct != null && Number.isFinite(amount) && amount > 0 ? round2(amount * depositPct / 100) : null;

        var expiryEnabled = src.expiry_enabled === true || src.expiry_enabled === '1' || src.expiry_enabled === 1 || src.expiry_enabled === 'true';
        var expiryDays = null;
        if (expiryEnabled) {
            var rawDays = clean(src.expiry_days);
            expiryDays = /^\d{1,3}$/.test(rawDays) ? parseInt(rawDays, 10) : NaN;
            if (!(expiryDays >= 1 && expiryDays <= 365)) errors.expiry_days = 'Indica entre 1 y 365 días de vencimiento.';
        }

        var location = clean(src.location);
        if (location.length > MAX_LOCATION) errors.location = 'El estudio o ubicación admite hasta ' + MAX_LOCATION + ' caracteres.';
        var complexity = clean(src.complexity);
        if (complexity && COMPLEXITY_OPTIONS.indexOf(complexity) === -1) errors.complexity = 'Elige una complejidad de la lista.';
        var note = clean(src.availability_note != null ? src.availability_note : src.availabilityNote);
        if (note.length > MAX_AVAILABILITY_NOTE) errors.availability_note = 'La nota de disponibilidad admite hasta ' + MAX_AVAILABILITY_NOTE + ' caracteres.';
        var message = clean(src.message);
        if (message.length > MAX_MESSAGE) errors.message = 'El mensaje admite hasta ' + MAX_MESSAGE + ' caracteres.';
        // El mensaje se guarda ya resuelto: al cliente nunca le llega una variable cruda.
        else if (/\{\{[^{}]*\}\}/.test(message)) errors.message = 'El mensaje tiene variables sin resolver. Corrígelas o quítalas antes de enviar.';

        var rawPolicy = clean(rawExtras.policy);
        if (rawPolicy && policyValue(rawPolicy) !== rawPolicy) errors.policy = 'Elige una política de la lista.';
        var clientNotes = clean(rawExtras.client_notes != null ? rawExtras.client_notes : rawExtras.clientNotes);
        if (clientNotes.length > MAX_LONG_TEXT) errors.client_notes = 'Las notas admiten hasta ' + MAX_LONG_TEXT + ' caracteres.';
        var extraTerms = clean(rawExtras.extra_terms != null ? rawExtras.extra_terms : rawExtras.extraTerms);
        if (extraTerms.length > MAX_LONG_TEXT) errors.extra_terms = 'Los términos admiten hasta ' + MAX_LONG_TEXT + ' caracteres.';

        var value = {
            amount: amount, currency: currency, sessions: sessions, minutes: minutes,
            depositPct: depositPct, depositAmount: depositAmount,
            balance: Number.isFinite(amount) ? round2(amount - (depositAmount || 0)) : null,
            expiry: { enabled: expiryEnabled, days: expiryEnabled ? expiryDays : null },
            location: location, complexity: complexity, availabilityNote: note, message: message,
            hasBreakdown: hasBreakdown,
            extras: {
                items: hasBreakdown ? items.map(function (it) {
                    return { name: it.name, description: it.description || null, qty: it.qty, price: it.price, total: N.lineTotal(it) };
                }) : [],
                discountPct: discountPct, taxPct: taxPct,
                subtotal: hasBreakdown ? totals.subtotal : (Number.isFinite(amount) ? amount : 0),
                policy: policyValue(rawPolicy), clientNotes: clientNotes, extraTerms: extraTerms
            }
        };
        value.hasExtras = hasBreakdown || !!value.extras.policy || !!clientNotes || !!extraTerms || !!complexity;
        var order = ['amount', 'currency', 'sessions', 'deposit_pct', 'minutes', 'expiry_days', 'location', 'complexity',
            'availability_note', 'items', 'discount_pct', 'tax_pct', 'policy', 'client_notes', 'extra_terms', 'message'];
        var first = order.find(function (key) { return errors[key]; }) || null;
        return { ok: !first, errors: errors, firstError: first ? { field: first, message: errors[first] } : null, value: value };
    }

    // Pestaña del diálogo donde vive cada campo (para llevar al primer error).
    var FIELD_TAB = {
        amount: 'propuesta', currency: 'propuesta', sessions: 'propuesta', deposit_pct: 'propuesta', minutes: 'propuesta',
        expiry_days: 'propuesta', location: 'propuesta', complexity: 'propuesta',
        availability_note: 'disponibilidad', offered: 'disponibilidad',
        items: 'condiciones', discount_pct: 'condiciones', tax_pct: 'condiciones', policy: 'condiciones',
        client_notes: 'condiciones', extra_terms: 'condiciones', message: 'mensaje'
    };

    /**
     * Patch de quotations_db con la propuesta validada.
     * ctx: { status, nowIso, offers (storedOffers), summary }
     * El estado solo viaja si cambia (la propuesta reenviada sigue 'responded').
     */
    function quotePatch(value, ctx) {
        var c = ctx || {};
        var patch = {
            artist_budget_amount: value.amount,
            artist_budget_currency: value.currency,
            tattoo_estimated_sessions: value.sessions,
            artist_session_minutes: value.minutes,
            artist_availability: clean(c.summary) || null,
            artist_responded_at: c.nowIso,
            artist_deposit_pct: value.depositPct,
            artist_deposit_amount: value.depositAmount,
            quote_expiry_enabled: value.expiry.enabled,
            quote_expiry_days: value.expiry.enabled ? value.expiry.days : null,
            offered_slots: Array.isArray(c.offers) ? c.offers : [],
            proposal_message: value.message || null
        };
        if (c.status !== 'responded') patch.quote_status = 'responded';
        // El lugar solo se pisa si el artista escribió uno.
        if (value.location) patch.artist_studio_name = value.location;
        return patch;
    }

    // Columnas de 20261116120000: si la migración todavía no corrió, el
    // servidor reintenta sin ellas (la propuesta no se pierde).
    var OPTIONAL_QUOTE_COLUMNS = ['offered_slots', 'proposal_message'];

    // Referencia de la fila de artist_manual_quotes que acompaña a una
    // solicitud de cliente (su quote_id no tiene forma COT-…).
    function manualRef(quotationId) {
        var n = Math.abs(Math.round(Number(quotationId))) || 0;
        return 'COT-RSP' + n.toString(36).toUpperCase().padStart(6, '0').slice(-9);
    }

    /**
     * Fila de artist_manual_quotes con los campos de la cotización manual.
     * → null (nada que guardar) | { mode: 'insert', row } | { mode: 'patch', id, patch }
     * La leen el panel del cliente (RLS: status 'sent' + cotización propia) y
     * el panel de pagos del artista.
     */
    function manualRecord(value, ctx) {
        var c = ctx || {};
        var quote = c.quote || {};
        var existing = c.existing || null;
        if (!existing && !value.hasExtras) return null;
        var previous = existing && existing.project && typeof existing.project === 'object' ? existing.project : {};
        var project = Object.assign({}, previous, {
            complexity: value.complexity || null,
            location: value.location || previous.location || null,
            sessions: value.sessions,
            session_hours: round2(value.minutes / 60),
            expiry_enabled: value.expiry.enabled
        });
        var economic = {
            line_items: value.extras.items,
            currency: value.currency,
            discount_pct: value.extras.discountPct,
            tax_pct: value.extras.taxPct,
            deposit_pct: value.depositPct || 0,
            subtotal: value.extras.subtotal,
            total: value.amount,
            deposit_amount: value.depositAmount || 0,
            validity_days: value.expiry.enabled ? value.expiry.days : ((existing && existing.validity_days) || 14),
            cancellation_policy: value.extras.policy,
            client_notes: value.extras.clientNotes || null,
            extra_terms: value.extras.extraTerms || null,
            project: project,
            updated_at: c.nowIso
        };
        if (existing) return { mode: 'patch', id: existing.id, patch: economic };
        project.title = clean(quote.project_description) || clean(quote.tattoo_idea_description).slice(0, 120) || 'Cotización';
        project.description = clean(quote.tattoo_idea_description);
        return {
            mode: 'insert',
            row: Object.assign({
                artist_id: c.artistId,
                quote_ref: manualRef(quote.id),
                status: 'sent',
                origin: 'cliente',
                quote_id: quote.quote_id,
                client: { name: clean(quote.client_full_name) },
                sent_at: c.nowIso
            }, economic)
        };
    }

    // Tras "Confirmar acuerdo": el anticipo de la fila manual sigue al acordado
    // (el panel de pagos prioriza la fila manual). null si no hay nada que tocar.
    function agreementManualPatch(quote, manual) {
        if (!quote || !manual) return null;
        var pct = Number(quote.artist_deposit_pct);
        var amount = Number(quote.artist_deposit_amount);
        var next = {
            deposit_pct: Number.isFinite(pct) && pct > 0 ? round2(pct) : 0,
            deposit_amount: Number.isFinite(amount) && amount > 0 ? round2(amount) : 0
        };
        if (Number(manual.deposit_pct) === next.deposit_pct && Number(manual.deposit_amount) === next.deposit_amount) return null;
        return next;
    }

    /**
     * Valores iniciales del diálogo: lo guardado en la cotización, los campos
     * de la fila manual y, encima, lo que pida quien abre el diálogo (prefill
     * del evento 'wo:quote-respond').
     */
    function initialValues(quote, manual, prefill, opts) {
        var q = quote || {};
        var now = opts && Number.isFinite(timeMs(opts.now)) ? timeMs(opts.now) : Date.now();
        var p = prefill && typeof prefill === 'object' ? prefill : {};
        var extras = extrasFromManual(manual);
        var pe = p.extras && typeof p.extras === 'object' ? p.extras : {};
        var amount = parseMoney(q.artist_budget_amount);
        var minutes = Math.round(Number(q.artist_session_minutes)) || 120;
        var has = function (key) { return p[key] != null && p[key] !== ''; };
        var sessions = parseInt(clean(q.tattoo_estimated_sessions), 10);
        var depositPct = q.artist_deposit_pct == null || q.artist_deposit_pct === '' ? '' : String(Number(q.artist_deposit_pct));
        if (!depositPct && manual && N.num(manual.deposit_amount) > 0) depositPct = String(N.num(manual.deposit_pct));
        var out = {
            amount: has('amount') ? String(p.amount) : (Number.isFinite(amount) && amount > 0 ? formatAmount(amount) : ''),
            currency: clean(has('currency') ? p.currency : (q.artist_budget_currency || q.client_budget_currency || 'USD')).toUpperCase(),
            sessions: has('sessions') ? String(p.sessions) : String(sessions >= 1 ? sessions : 1),
            minutes: has('minutes') ? Math.round(Number(p.minutes)) || minutes : minutes,
            depositPct: has('deposit_pct') ? String(p.deposit_pct) : depositPct,
            location: clean(has('location') ? p.location : (extras.location || q.artist_studio_name)),
            complexity: clean(has('complexity') ? p.complexity : extras.complexity),
            availabilityNote: clean(p.availability_note).slice(0, MAX_AVAILABILITY_NOTE),
            message: clean(has('message') ? p.message : ''),
            offered: Array.isArray(p.offered) ? p.offered : offersFromStored(q.offered_slots, { now: now }),
            items: Array.isArray(pe.items) ? pe.items : extras.items,
            discountPct: pe.discount_pct != null ? N.num(pe.discount_pct) : extras.discountPct,
            taxPct: pe.tax_pct != null ? N.num(pe.tax_pct) : extras.taxPct,
            policy: pe.policy != null ? policyValue(pe.policy) : extras.policy,
            clientNotes: pe.client_notes != null ? clean(pe.client_notes) : extras.clientNotes,
            extraTerms: pe.extra_terms != null ? clean(pe.extra_terms) : extras.extraTerms
        };
        if (COMPLEXITY_OPTIONS.indexOf(out.complexity) === -1) out.complexity = '';
        // La nota libre ("Fines de semana, desde agosto") sale del resumen
        // guardado, sin las etiquetas de las fechas estructuradas.
        if (!has('availability_note')) out.availabilityNote = noteFromSummary(q.artist_availability, q.offered_slots);
        return out;
    }

    return {
        MAX_OFFERS: MAX_OFFERS, MAX_RANGE_DAYS: MAX_RANGE_DAYS, HORIZON_DAYS: HORIZON_DAYS, MAX_MESSAGE: MAX_MESSAGE,
        MAX_AVAILABILITY_NOTE: MAX_AVAILABILITY_NOTE, MAX_LOCATION: MAX_LOCATION, MAX_LONG_TEXT: MAX_LONG_TEXT,
        MAX_ITEMS: MAX_ITEMS, MAX_TEMPLATES: MAX_TEMPLATES, MAX_TEMPLATE_TITLE: MAX_TEMPLATE_TITLE,
        APPROVED_STATUSES: APPROVED_STATUSES, CONFIRMED_KINDS: CONFIRMED_KINDS, KIND_LABELS: KIND_LABELS,
        VARIABLES: VARIABLES, DEFAULT_TEMPLATES: DEFAULT_TEMPLATES, POLICY_OPTIONS: POLICY_OPTIONS,
        COMPLEXITY_OPTIONS: COMPLEXITY_OPTIONS, NO_POLICY: NO_POLICY, FIELD_TAB: FIELD_TAB,
        OPTIONAL_QUOTE_COLUMNS: OPTIONAL_QUOTE_COLUMNS, QUICK_CONCEPTS: N.QUICK_CONCEPTS,
        parseMoney: parseMoney, formatAmount: formatAmount, durationText: durationText, sessionsText: sessionsText,
        isDraftQuote: isDraftQuote, approvedByBoth: approvedByBoth, agreementActive: agreementActive,
        proposalMode: proposalMode, canPropose: canPropose,
        variableKey: variableKey, templateVars: templateVars, resolveTemplate: resolveTemplate,
        insertVariable: insertVariable, validateTemplate: validateTemplate,
        dayLabel: dayLabel, dayLabelLong: dayLabelLong, rangeLabel: rangeLabel, monthLabel: monthLabel,
        daysBetween: daysBetween, offerLabel: offerLabel, offerKey: offerKey,
        normalizeOffer: normalizeOffer, normalizeOffers: normalizeOffers, storedOffers: storedOffers,
        offersFromStored: offersFromStored, offersSummary: offersSummary, offersSpan: offersSpan,
        noteFromSummary: noteFromSummary,
        confirmedBusy: confirmedBusy, mergeIntervals: mergeIntervals, dayAvailability: dayAvailability,
        computeAgenda: computeAgenda, publicAgenda: publicAgenda, findConflicts: findConflicts, splitRange: splitRange,
        policyValue: policyValue, cleanItems: cleanItems, extrasTotals: extrasTotals, extrasFromManual: extrasFromManual,
        validateProposal: validateProposal, quotePatch: quotePatch, manualRef: manualRef, manualRecord: manualRecord,
        agreementManualPatch: agreementManualPatch, initialValues: initialValues
    };
}));
