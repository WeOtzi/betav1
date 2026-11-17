/**
 * WE ÖTZI · Flash Tattoos · página /flash?artist=<usuario>&id=<id del flash>
 * ---------------------------------------------------------------------------
 * El cliente reserva un flash publicado en la galería del artista:
 *   0 · Tus datos     resumen del flash + nombre, email, teléfono, primer tatuaje
 *                     (con sesión de cliente se precargan)
 *   1 · Zona y salud  zona del cuerpo (primero las sugeridas por el artista),
 *                     condiciones médicas y alergias (opcionales) y fecha de
 *                     nacimiento (mínimo 14 años; aviso entre 14 y 17)
 *   2 · Cuándo        turno libre real si el artista tiene reservas online
 *                     (queda apartado 72 h al enviar); si no, rango tentativo
 *   3 · Revisión      "Enviar la solicitud no genera un cobro" + Términos y
 *                     Privacidad
 * Final: "Solicitud enviada" con el código corto de la cotización.
 *
 * El precio, el título y el tamaño que se muestran salen de la galería pública;
 * el servidor (POST /api/flash/request) vuelve a leerlos y nunca usa los del
 * navegador. Datos: WeotziData.Artists / Clients / Booking · modelo:
 * flash-model.js · edad y rango: quotation-r2-model.js · turnos:
 * booking-slots-model.js.
 */
(function () {
    'use strict';

    var F = window.WoFlash;
    var R2 = window.WoQuotationR2Model;
    var B = window.WoBookingSlots;
    var D = window.WeotziData || {};
    var DAY_MS = 86400000;
    var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    var WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
    var DATE_CHIPS = ['Lo antes posible', 'Este mes', 'Próximo mes', 'Sin fecha'];
    // Zonas raíz del cotizador (body_parts) por si la tabla no responde.
    var FALLBACK_ZONES = ['Brazo', 'Antebrazo', 'Hombro', 'Mano', 'Muñeca', 'Pierna', 'Muslo', 'Pantorrilla', 'Tobillo', 'Pie', 'Torso', 'Pecho', 'Costillas', 'Abdomen', 'Espalda', 'Cuello', 'Cabeza'];
    var STEPS = ['Tus datos', 'Zona y salud', 'Cuándo', 'Revisión'];
    var ARTIST_COLUMNS = 'user_id,username,name,profile_picture,ubicacion,city,gallery_feed_items';

    var main = document.getElementById('fb-main');
    var params = new URLSearchParams(window.location.search);
    var username = String(params.get('artist') || '').replace(/^@+/, '').trim().toLowerCase();
    var flashId = String(params.get('id') || '').trim();

    var state = {
        artist: null, item: null, view: null, user: null, token: '',
        zones: [], step: 0, errors: {}, submitting: false, done: null, notice: '',
        booking: { loaded: false, enabled: false, minutes: null, tz: null, counts: {}, daySlots: {}, month: null, day: null, alternatives: [] },
        rangeMonth: null,
        form: {
            name: '', email: '', phone: '', first: null,
            zone: '', zoneOther: '', health: '', allergies: '',
            birth: { day: null, month: null, year: null },
            slot: null, range: { start: null, end: null }, chip: null, terms: false
        }
    };

    /* ------------------------------------------------------------ utilidades */
    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function appPath(path) {
        if (window.WoDemo && typeof window.WoDemo.appPath === 'function') return window.WoDemo.appPath(path);
        var base = window.WEOTZI_BASE_PATH ? String(window.WEOTZI_BASE_PATH).replace(/\/$/, '')
            : (/^\/beta(?:\/|$)/.test(String(window.location.pathname || '')) ? '/beta' : '');
        return base && String(path).indexOf(base + '/') !== 0 ? base + path : path;
    }
    function hydrate(el) {
        if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') { try { window.WoIcons.hydrate(el); } catch (_) { /* opcional */ } }
    }
    function pad(n) { return String(n).padStart(2, '0'); }
    function todayIso() { var t = new Date(); return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()); }
    function profileUrl() { return appPath('/artist/profile?artist=' + encodeURIComponent(username)); }
    function longDay(date) {
        var p = date.split('-').map(Number);
        var idx = B ? B.weekdayIndex(date) : new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
        return WEEKDAYS[idx] + ' ' + p[2] + ' de ' + MONTHS[p[1] - 1];
    }
    function newKey() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
        var b = new Uint8Array(16);
        (window.crypto || window.msCrypto).getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
        var h = Array.prototype.map.call(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
        return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    }
    // Llave del envío: la misma mientras la pestaña siga en este flash (un
    // reintento no crea otra solicitud).
    function submissionKey() {
        var storeKey = 'wo-flash-key:' + username + ':' + flashId;
        try {
            var saved = window.sessionStorage.getItem(storeKey);
            if (/^[0-9a-f-]{36}$/i.test(saved || '')) return saved;
            var key = newKey();
            window.sessionStorage.setItem(storeKey, key);
            return key;
        } catch (_) { return state.fallbackKey || (state.fallbackKey = newKey()); }
    }
    function forgetKey() { try { window.sessionStorage.removeItem('wo-flash-key:' + username + ':' + flashId); } catch (_) { /* opcional */ } }

    /* ----------------------------------------------------------- pantallas */
    function renderMessage(title, message, actions) {
        main.innerHTML = '<section class="fb-message"><span class="wo-marks" aria-hidden="true"><span class="wo-mark-square"></span><span class="wo-mark-circle"></span><span class="wo-mark-triangle"></span></span>' +
            '<h1 class="fb-message-title">' + esc(title) + '</h1><p>' + esc(message) + '</p>' +
            '<div class="fb-message-actions">' + (actions || '') +
            '<a class="wo-btn wo-btn--secondary" href="' + esc(appPath('/marketplace')) + '">Explorar artistas</a></div></section>';
        hydrate(main);
    }

    function summaryHtml() {
        var v = state.view;
        var a = state.artist;
        var facts = [
            ['Precio', v.priceLabel],
            ['Tamaño aprox.', v.size || 'Según el diseño'],
            ['Tipo', v.unique ? 'Único · se tatúa una sola vez' : 'Se repite']
        ];
        return '<aside class="fb-summary" aria-label="Flash elegido">' +
            '<div class="fb-summary-media"><img src="' + esc(v.image) + '" alt="Flash ' + esc(v.title) + '" width="480" height="480"></div>' +
            '<div class="fb-summary-body">' +
                '<p class="wo-label fb-summary-eyebrow"><span class="wo-flash-badge">Flash</span> Precio fijo</p>' +
                '<h1 class="fb-summary-title">' + esc(v.title) + '</h1>' +
                '<dl class="fb-summary-facts">' + facts.map(function (f) {
                    return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>';
                }).join('') + '</dl>' +
                '<a class="fb-summary-artist" href="' + esc(profileUrl()) + '">' +
                    (a.profile_picture ? '<img src="' + esc(a.profile_picture) + '" alt="" width="36" height="36">' : '<span class="fb-avatar" aria-hidden="true">' + esc(String(a.name || a.username || 'Ö').charAt(0).toUpperCase()) + '</span>') +
                    '<span><small>Artista</small>' + esc(a.name || a.username) + '</span></a>' +
            '</div></aside>';
    }

    function stepperHtml() {
        return '<ol class="fb-steps" aria-label="Pasos">' + STEPS.map(function (label, i) {
            var cls = i === state.step ? ' is-active' : (i < state.step ? ' is-done' : '');
            return '<li class="wo-step' + cls + '"' + (i === state.step ? ' aria-current="step"' : '') + '><span class="dot">' + (i + 1) + '</span><span class="fb-step-label">' + esc(label) + '</span></li>';
        }).join('<li class="wo-step-line" aria-hidden="true"></li>') + '</ol>';
    }

    function errorOf(field) {
        var msg = state.errors[field];
        return msg ? '<p class="wo-error-msg fb-error" id="fb-err-' + field + '">' + esc(msg) + '</p>' : '';
    }
    function invalidAttrs(field) {
        return state.errors[field] ? ' aria-invalid="true" aria-describedby="fb-err-' + field + '"' : '';
    }
    function inputClass(field) { return 'wo-input' + (state.errors[field] ? ' wo-input--error' : ''); }

    function stepContactHtml() {
        var f = state.form;
        return '<h2 class="fb-step-title">Inicia tu reserva</h2>' +
            '<p class="fb-step-lead">Cuéntanos cómo contactarte. El artista confirma el turno y el anticipo.</p>' +
            '<div class="fb-grid">' +
                '<div class="wo-field"><label class="wo-label" for="fb-name">Nombre <span class="req">*</span></label>' +
                    '<input class="' + inputClass('client_full_name') + '" id="fb-name" data-field="name" autocomplete="name" maxlength="120" value="' + esc(f.name) + '"' + invalidAttrs('client_full_name') + '>' + errorOf('client_full_name') + '</div>' +
                '<div class="wo-field"><label class="wo-label" for="fb-email">Email <span class="req">*</span></label>' +
                    '<input class="' + inputClass('client_email') + '" id="fb-email" type="email" data-field="email" autocomplete="email" maxlength="160" value="' + esc(f.email) + '"' + invalidAttrs('client_email') + '>' + errorOf('client_email') + '</div>' +
                '<div class="wo-field"><label class="wo-label" for="fb-phone">Teléfono <span class="req">*</span></label>' +
                    '<input class="' + inputClass('client_whatsapp') + '" id="fb-phone" type="tel" data-field="phone" autocomplete="tel" maxlength="40" placeholder="Con código de país" value="' + esc(f.phone) + '"' + invalidAttrs('client_whatsapp') + '>' + errorOf('client_whatsapp') + '</div>' +
                '<div class="wo-field"><span class="wo-label" id="fb-first-label">¿Es tu primer tatuaje? <span class="req">*</span></span>' +
                    '<div class="fb-choice' + (state.errors.tattoo_is_first_tattoo ? ' is-invalid' : '') + '" role="radiogroup" aria-labelledby="fb-first-label"' + invalidAttrs('tattoo_is_first_tattoo') + '>' +
                        '<button type="button" class="fb-choice-btn" role="radio" data-first="yes" aria-checked="' + (f.first === true) + '">Sí</button>' +
                        '<button type="button" class="fb-choice-btn" role="radio" data-first="no" aria-checked="' + (f.first === false) + '">No</button>' +
                    '</div>' + errorOf('tattoo_is_first_tattoo') + '</div>' +
            '</div>';
    }

    function zoneOptions() {
        var suggested = state.view.zones || [];
        var seen = {};
        var out = [];
        suggested.forEach(function (z) { var k = z.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push({ label: z, suggested: true }); } });
        state.zones.forEach(function (z) { var k = z.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push({ label: z, suggested: false }); } });
        return out;
    }

    function birthHtml() {
        var b = state.form.birth;
        var maxDay = R2.daysInMonth(b.year, b.month);
        var opt = function (items, value, placeholder) {
            return '<option value="">' + placeholder + '</option>' + items.map(function (it) {
                return '<option value="' + it.value + '"' + (String(it.value) === String(value || '') ? ' selected' : '') + '>' + esc(it.label) + '</option>';
            }).join('');
        };
        var days = []; for (var d = 1; d <= maxDay; d++) days.push({ value: d, label: String(d) });
        var months = R2.MONTHS_LONG.map(function (m, i) { return { value: i + 1, label: m }; });
        var years = R2.birthYears().map(function (y) { return { value: y, label: String(y) }; });
        var bad = state.errors.client_birth_date ? ' wo-input--error' : '';
        var status = R2.birthStatus(b);
        var notice = '';
        if (status.complete && (!status.real || status.tooYoung)) {
            notice = '<div class="wo-alert wo-alert--error fb-notice" role="status">' + (status.real
                ? 'Para reservar un tatuaje necesitas tener al menos ' + R2.MIN_AGE + ' años. Elige otra fecha.'
                : 'Esa fecha no existe. Revisa el día y el mes.') + '</div>';
        } else if (status.minor) {
            notice = '<div class="wo-alert wo-alert--warning fb-notice" role="status"><p><strong>Eres menor de edad.</strong> Para tatuarte necesitas la autorización de tu madre, tu padre o tu representante legal. El artista la verá en tu solicitud y te la pedirá.</p></div>';
        }
        return '<div class="wo-field"><span class="wo-label" id="fb-birth-label">Fecha de nacimiento <span class="req">*</span></span>' +
            '<div class="fb-birth" role="group" aria-labelledby="fb-birth-label"' + invalidAttrs('client_birth_date') + '>' +
                '<select class="wo-select' + bad + '" data-birth="day" aria-label="Día" autocomplete="bday-day">' + opt(days, b.day, 'Día') + '</select>' +
                '<select class="wo-select' + bad + '" data-birth="month" aria-label="Mes" autocomplete="bday-month">' + opt(months, b.month, 'Mes') + '</select>' +
                '<select class="wo-select' + bad + '" data-birth="year" aria-label="Año" autocomplete="bday-year">' + opt(years, b.year, 'Año') + '</select>' +
            '</div>' + errorOf('client_birth_date') +
            (notice || state.errors.client_birth_date ? notice : '<p class="wo-help">Necesitas tener al menos ' + R2.MIN_AGE + ' años.</p>') + '</div>';
    }

    function stepBodyHtml() {
        var f = state.form;
        var options = zoneOptions();
        var other = f.zone && !options.some(function (o) { return o.label === f.zone; });
        return '<h2 class="fb-step-title">¿Dónde lo quieres?</h2>' +
            '<div class="fb-cols">' +
                '<div class="wo-field fb-zones-field"><span class="wo-label" id="fb-zone-label">Zona del cuerpo <span class="req">*</span></span>' +
                    '<div class="fb-zones' + (state.errors.tattoo_body_part ? ' is-invalid' : '') + '" role="radiogroup" aria-labelledby="fb-zone-label"' + invalidAttrs('tattoo_body_part') + '>' +
                        options.map(function (o) {
                            return '<button type="button" class="fb-zone' + (o.suggested ? ' is-suggested' : '') + '" role="radio" data-zone="' + esc(o.label) + '" aria-checked="' + (f.zone === o.label) + '"' +
                                (o.suggested ? ' title="Sugerida por el artista"' : '') + '>' + esc(o.label) + (o.suggested ? ' <small>sugerida</small>' : '') + '</button>';
                        }).join('') +
                    '</div>' +
                    '<label class="fb-zone-other"><span class="wo-help">¿Otra zona?</span><input class="wo-input" data-field="zoneOther" maxlength="80" placeholder="Escríbela aquí" value="' + esc(other ? f.zone : f.zoneOther) + '"></label>' +
                    errorOf('tattoo_body_part') +
                '</div>' +
                '<div class="fb-stack">' +
                    '<div class="fb-pair">' +
                        '<div class="wo-field"><label class="wo-label" for="fb-health">Condiciones médicas (opcional)</label>' +
                            '<textarea class="wo-textarea fb-textarea" id="fb-health" data-field="health" maxlength="2000" rows="2" placeholder="Ej.: diabetes, anticoagulantes">' + esc(f.health) + '</textarea></div>' +
                        '<div class="wo-field"><label class="wo-label" for="fb-allergies">Alergias (opcional)</label>' +
                            '<textarea class="wo-textarea fb-textarea" id="fb-allergies" data-field="allergies" maxlength="2000" rows="2" placeholder="Ej.: látex, tintas rojas">' + esc(f.allergies) + '</textarea></div>' +
                    '</div>' +
                    birthHtml() +
                '</div>' +
            '</div>';
    }

    /* ------------------------------------------------------- paso Cuándo */
    function monthTitle(key) { var p = key.split('-').map(Number); return MONTHS[p[1] - 1] + ' ' + p[0]; }
    function shiftMonth(key, delta) {
        var p = key.split('-').map(Number);
        var m = p[1] - 1 + delta;
        var y = p[0] + Math.floor(m / 12);
        m = ((m % 12) + 12) % 12;
        return y + '-' + pad(m + 1);
    }
    function monthGrid(key, cell) {
        var p = key.split('-').map(Number);
        var first = key + '-01';
        var offset = B ? B.weekdayIndex(first) : (new Date(Date.UTC(p[0], p[1] - 1, 1)).getUTCDay() + 6) % 7;
        var daysIn = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
        var cells = [];
        for (var i = 0; i < offset; i++) cells.push('<span class="fb-day is-blank" aria-hidden="true"></span>');
        for (var d = 1; d <= daysIn; d++) cells.push(cell(key + '-' + pad(d), d));
        return '<div class="fb-cal-dow" aria-hidden="true">' + ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>' +
            '<div class="fb-cal-grid">' + cells.join('') + '</div>';
    }
    function calHead(key, canPrev, canNext, attr) {
        return '<div class="fb-cal-head">' +
            '<button type="button" class="wo-iconbtn wo-iconbtn--s" ' + attr + '="-1" aria-label="Mes anterior"' + (canPrev ? '' : ' disabled') + '><i data-wo-icon="chevron-left" aria-hidden="true"></i></button>' +
            '<p class="fb-cal-title">' + esc(monthTitle(key)) + '</p>' +
            '<button type="button" class="wo-iconbtn wo-iconbtn--s" ' + attr + '="1" aria-label="Mes siguiente"' + (canNext ? '' : ' disabled') + '><i data-wo-icon="chevron-right" aria-hidden="true"></i></button>' +
            '</div>';
    }

    function slotStepHtml() {
        var bk = state.booking;
        var thisMonth = todayIso().slice(0, 7);
        var cal = calHead(bk.month, bk.month > thisMonth, bk.month < shiftMonth(thisMonth, 3), 'data-slot-month') + monthGrid(bk.month, function (date, d) {
            var n = bk.counts[date] || 0;
            var on = bk.day === date;
            return n ? '<button type="button" class="fb-day has-slots' + (on ? ' is-selected' : '') + '" data-slot-day="' + date + '" aria-pressed="' + on + '" aria-label="' + esc(longDay(date) + ': ' + n + (n === 1 ? ' turno libre' : ' turnos libres')) + '">' + d + '</button>'
                : '<span class="fb-day" aria-hidden="true">' + d + '</span>';
        });
        var times;
        if (!bk.day) {
            times = '<p class="fb-note">Elige un día marcado: tienen turnos libres.</p>';
        } else {
            var slots = bk.daySlots[bk.day];
            if (slots === undefined) times = '<p class="fb-note"><span class="wo-spinner" aria-hidden="true"></span> Buscando horarios…</p>';
            else if (!slots.length) times = '<p class="fb-note">Ese día ya no tiene turnos libres. Elige otro.</p>';
            else {
                times = '<p class="wo-label">' + esc(longDay(bk.day)) + '</p><ul class="fb-times" aria-label="Horarios disponibles">' + slots.map(function (s) {
                    var on = state.form.slot && state.form.slot.start === s.start;
                    return '<li><button type="button" class="fb-time" data-slot="' + esc(s.start) + '" aria-pressed="' + !!on + '">' + esc(s.label) + '</button></li>';
                }).join('') + '</ul>';
            }
        }
        var alts = bk.alternatives.length ? '<div class="wo-alert wo-alert--warning fb-notice" role="status"><p>Ese turno ya no está disponible. Estos están cerca:</p><ul class="fb-times">' +
            bk.alternatives.map(function (s, i) { return '<li><button type="button" class="fb-time" data-alt="' + i + '">' + esc(s.label) + '</button></li>'; }).join('') + '</ul></div>' : '';
        return '<h2 class="fb-step-title">Elige tu turno</h2>' +
            '<p class="fb-step-lead">Turnos libres de ' + esc(state.artist.name || state.artist.username) + ' (hora del artista, ' + esc(bk.tz) + '). Cada turno dura ' + esc(minutesLabel(bk.minutes)) + '. Al enviar, el turno queda apartado 72 h mientras el artista confirma.</p>' +
            alts +
            '<div class="fb-cols fb-when' + (state.errors.when ? ' is-invalid' : '') + '"' + invalidAttrs('when') + '>' +
                '<div class="fb-cal">' + cal + '</div>' +
                '<div class="fb-day-panel">' + times +
                    (state.form.slot ? '<p class="fb-picked" role="status">Turno elegido: <strong>' + esc(state.form.slot.label) + '</strong></p>' : '') +
                '</div>' +
            '</div>' + errorOf('when');
    }
    function minutesLabel(m) { var h = Math.floor((m || 0) / 60), r = (m || 0) % 60; return h ? h + ' h' + (r ? ' ' + r + ' min' : '') : r + ' min'; }

    function rangeStepHtml() {
        var f = state.form;
        var today = todayIso();
        var key = state.rangeMonth;
        var cal = calHead(key, key > today.slice(0, 7), key < shiftMonth(today.slice(0, 7), 18), 'data-range-month') + monthGrid(key, function (date, d) {
            if (date < today) return '<span class="fb-day is-past" aria-hidden="true">' + d + '</span>';
            var pos = R2.rangePosition(date, f.range.start, f.range.end);
            return '<button type="button" class="fb-day' + (pos ? ' is-range is-' + pos : '') + '" data-range-day="' + date + '" aria-pressed="' + !!pos + '" aria-label="' + esc(longDay(date)) + '">' + d + '</button>';
        });
        return '<h2 class="fb-step-title">¿Cuándo te gustaría tatuarte?</h2>' +
            '<p class="fb-step-lead">Elige una opción o marca en el calendario un <strong>rango de fechas tentativo</strong>: toca el primer día y después el último. Es solo tu preferencia: <strong>no garantiza disponibilidad</strong>; el artista confirma la fecha final.</p>' +
            '<div class="fb-cols fb-when' + (state.errors.when ? ' is-invalid' : '') + '"' + invalidAttrs('when') + '>' +
                '<div class="fb-cal">' + cal + '</div>' +
                '<div class="fb-day-panel">' +
                    '<div class="fb-chips" role="radiogroup" aria-label="Opciones rápidas">' + DATE_CHIPS.map(function (c) {
                        return '<button type="button" class="wo-chip fb-chip" role="radio" data-chip="' + esc(c) + '" aria-checked="' + (f.chip === c) + '">' + esc(c) + '</button>';
                    }).join('') + '</div>' +
                    (f.range.start ? '<p class="fb-picked" role="status">' + (f.range.end ? 'Rango tentativo' : 'Desde') + ': <strong>' + esc(R2.rangeLabel(f.range.start, f.range.end)) + '</strong>' + (f.range.end ? '' : ' · toca otro día para marcar hasta cuándo') + '</p>' : '') +
                '</div>' +
            '</div>' + errorOf('when');
    }

    function whenLabel() {
        var f = state.form;
        if (f.slot) return f.slot.label;
        if (f.range.start) return R2.rangeLabel(f.range.start, f.range.end);
        return f.chip || '';
    }

    function stepReviewHtml() {
        var f = state.form;
        var status = R2.birthStatus(f.birth);
        var rows = [
            ['Flash', state.view.title + ' · ' + state.view.priceLabel],
            ['Tamaño', state.view.size || 'Según el diseño'],
            ['Zona', f.zone],
            ['Cuándo', whenLabel() + (f.slot ? ' · turno apartado 72 h al enviar' : '')],
            ['Contacto', f.name + ' · ' + f.email + ' · ' + f.phone],
            ['Primer tatuaje', f.first ? 'Sí' : 'No'],
            ['Salud', [f.health ? 'Condiciones: ' + f.health : '', f.allergies ? 'Alergias: ' + f.allergies : ''].filter(Boolean).join(' · ') || 'Sin condiciones ni alergias declaradas']
        ];
        var base = appPath('');
        return '<h2 class="fb-step-title">Revisa tu solicitud</h2>' +
            '<dl class="fb-review">' + rows.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl>' +
            '<div class="wo-alert wo-alert--info fb-notice"><p><strong>Enviar la solicitud no genera un cobro.</strong> El artista confirma el turno y, si corresponde, te pide un anticipo para reservar.</p>' +
                (status.minor ? '<p class="fb-notice-minor">Al ser menor de edad, necesitas la autorización de tu madre, tu padre o tu representante legal.</p>' : '') + '</div>' +
            '<label class="wo-check fb-terms' + (state.errors.terms_accepted ? ' is-invalid' : '') + '"><input type="checkbox" data-field="terms"' + (f.terms ? ' checked' : '') + invalidAttrs('terms_accepted') + '> <span>Acepto los <a href="' + esc(base + '/legal/terms') + '" target="_blank" rel="noopener">Términos y condiciones</a> y la <a href="' + esc(base + '/legal/privacy') + '" target="_blank" rel="noopener">Política de privacidad</a>.</span></label>' +
            errorOf('terms_accepted') +
            (state.notice ? '<div class="wo-alert wo-alert--error fb-notice" role="alert"><p>' + esc(state.notice) + '</p></div>' : '');
    }

    function footbarHtml() {
        var last = state.step === STEPS.length - 1;
        return '<div class="fb-footbar">' +
            '<button type="button" class="wo-btn wo-btn--nav fb-back"' + (state.step === 0 ? ' hidden' : '') + ' data-nav="back"><i data-wo-icon="arrow-left" aria-hidden="true"></i> Atrás</button>' +
            '<span class="fb-dots" aria-hidden="true">' + STEPS.map(function (_, i) { return '<span class="' + (i === state.step ? 'is-on' : '') + '"></span>'; }).join('') + '</span>' +
            '<button type="button" class="wo-btn wo-btn--hard wo-btn--accent fb-next" data-nav="next"' + (state.submitting ? ' disabled' : '') + '>' +
                (last ? (state.submitting ? '<span class="wo-spinner" aria-hidden="true"></span> Enviando…' : 'Enviar solicitud <i data-wo-icon="send" aria-hidden="true"></i>') : 'Continuar <i data-wo-icon="arrow-right" aria-hidden="true"></i>') +
            '</button></div>';
    }

    function stepHtml() {
        if (state.step === 0) return stepContactHtml();
        if (state.step === 1) return stepBodyHtml();
        if (state.step === 2) return state.booking.enabled ? slotStepHtml() : rangeStepHtml();
        return stepReviewHtml();
    }

    function render(focusSelector) {
        main.innerHTML = '<div class="fb-layout">' + summaryHtml() +
            '<section class="fb-panel" aria-labelledby="fb-step-heading">' +
                '<p class="wo-sr-only" id="fb-step-heading">Paso ' + (state.step + 1) + ' de ' + STEPS.length + ': ' + esc(STEPS[state.step]) + '</p>' +
                stepperHtml() +
                '<form class="fb-form" novalidate>' + stepHtml() + '</form>' +
                footbarHtml() +
            '</section></div>';
        hydrate(main);
        if (focusSelector) {
            var el = main.querySelector(focusSelector);
            if (el) { try { el.focus(); } catch (_) { /* opcional */ } }
        }
    }

    function renderDone(result) {
        var f = state.form;
        var a = state.artist;
        var code = result.short_code || (result.quote_id ? String(result.quote_id).slice(-6).toUpperCase() : '');
        var held = result.slot && result.slot.status === 'held';
        main.innerHTML = '<section class="fb-done" aria-labelledby="fb-done-title">' +
            '<div class="fb-done-main">' +
                '<span class="wo-marks" aria-hidden="true"><span class="wo-mark-square"></span><span class="wo-mark-circle"></span><span class="wo-mark-triangle"></span></span>' +
                '<p class="wo-label">Solicitud enviada</p>' +
                '<h1 class="fb-done-title" id="fb-done-title" tabindex="-1">Tu pedido del flash «' + esc(state.view.title) + '» llegó a ' + esc(a.name || a.username) + '</h1>' +
                (code ? '<p class="fb-code"><span>Código de tu solicitud</span><strong>' + esc(code) + '</strong></p>' : '') +
                '<p class="fb-done-msg">El artista revisa tu pedido y te responde con la confirmación' + (held ? ' del turno' : ' de la fecha') + ' y el anticipo, si corresponde. Te escribimos a <strong>' + esc(f.email) + '</strong>.</p>' +
                (held ? '<p class="fb-done-detail">Tu turno <strong>' + esc(result.slot.label || (f.slot && f.slot.label) || '') + '</strong> queda apartado 72 h mientras el artista responde.</p>' : '') +
                (R2.birthStatus(f.birth).minor ? '<p class="fb-done-detail">Recuerda que, al ser menor de edad, necesitas la autorización de tu madre, tu padre o tu representante legal.</p>' : '') +
                (result.preview ? '<p class="fb-done-detail">Vista previa con datos ficticios: no se envió nada.</p>' : '') +
                '<div class="fb-message-actions">' +
                    '<a class="wo-btn wo-btn--accent wo-btn--hard" href="' + esc(profileUrl()) + '">Ver más de ' + esc(a.name || a.username) + '</a>' +
                    (state.user ? '<a class="wo-btn wo-btn--secondary" href="' + esc(appPath('/client/dashboard')) + '">Ir a mi cuenta</a>' : '<a class="wo-btn wo-btn--secondary" href="' + esc(appPath('/marketplace')) + '">Explorar artistas</a>') +
                '</div>' +
            '</div>' +
            '<div class="fb-done-media"><img src="' + esc(state.view.image) + '" alt="Flash ' + esc(state.view.title) + '" width="360" height="360"></div>' +
            '</section>';
        hydrate(main);
        var title = document.getElementById('fb-done-title');
        if (title) title.focus();
    }

    /* --------------------------------------------------------- validación */
    function validate(step) {
        var f = state.form;
        var e = {};
        if (step === 0) {
            if (!f.name.trim()) e.client_full_name = 'Escribe tu nombre.';
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.client_email = 'Escribe un correo válido.';
            if (f.phone.replace(/\D/g, '').length < 6) e.client_whatsapp = 'Escribe un teléfono de contacto.';
            if (f.first === null) e.tattoo_is_first_tattoo = 'Cuéntanos si es tu primer tatuaje.';
        } else if (step === 1) {
            if (!currentZone()) e.tattoo_body_part = 'Elige la zona del cuerpo.';
            var st = R2.birthStatus(f.birth);
            if (!st.complete) e.client_birth_date = 'Indica tu fecha de nacimiento.';
            else if (!st.real) e.client_birth_date = 'Esa fecha no existe. Revisa el día y el mes.';
            else if (st.tooYoung) e.client_birth_date = 'Para reservar un tatuaje necesitas tener al menos ' + R2.MIN_AGE + ' años.';
        } else if (step === 2) {
            if (state.booking.enabled ? !f.slot : (!f.range.start && !f.chip)) e.when = state.booking.enabled ? 'Elige un turno.' : 'Elige cuándo te gustaría tatuarte.';
        } else if (step === 3) {
            if (!f.terms) e.terms_accepted = 'Acepta los Términos y la Política de privacidad para enviar la solicitud.';
        }
        return e;
    }
    function currentZone() {
        var f = state.form;
        return (f.zoneOther.trim() || f.zone || '').slice(0, 255);
    }
    var FIELD_STEP = { client_full_name: 0, client_email: 0, client_whatsapp: 0, tattoo_is_first_tattoo: 0,
        tattoo_body_part: 1, client_birth_date: 1, when: 2, requested_slot: 2, terms_accepted: 3 };
    var FIELD_FOCUS = { client_full_name: '#fb-name', client_email: '#fb-email', client_whatsapp: '#fb-phone',
        tattoo_is_first_tattoo: '[data-first]', tattoo_body_part: '[data-zone]', client_birth_date: '[data-birth]',
        when: '.fb-when button:not([disabled])', terms_accepted: '[data-field="terms"]' };

    function showErrors(errors) {
        state.errors = errors;
        var first = Object.keys(errors)[0];
        render(first ? FIELD_FOCUS[first] : null);
    }

    /* ----------------------------------------------------------- acciones */
    function go(step) {
        state.step = Math.max(0, Math.min(STEPS.length - 1, step));
        state.errors = {};
        state.notice = '';
        if (state.step === 2 && state.booking.enabled && !state.booking.month) initSlotMonth();
        render();
        var heading = main.querySelector('.fb-step-title');
        if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus(); }
    }

    function next() {
        var errors = validate(state.step);
        if (Object.keys(errors).length) { showErrors(errors); return; }
        if (state.step < STEPS.length - 1) { go(state.step + 1); return; }
        submit();
    }

    function birthIso() {
        var b = state.form.birth;
        return b.year && b.month && b.day ? b.year + '-' + pad(b.month) + '-' + pad(b.day) : '';
    }

    function submit() {
        if (state.submitting) return;
        var f = state.form;
        var body = {
            submission_key: submissionKey(),
            artist: username,
            flash_id: flashId,
            client_full_name: f.name.trim(),
            client_email: f.email.trim().toLowerCase(),
            client_whatsapp: f.phone.trim(),
            tattoo_is_first_tattoo: f.first,
            tattoo_body_part: currentZone(),
            client_birth_date: birthIso(),
            client_health_conditions: f.health.trim(),
            client_allergies: f.allergies.trim(),
            requested_slot: f.slot ? { start: f.slot.start, minutes: f.slot.minutes } : null,
            preferred_date_from: f.range.start || null,
            preferred_date_to: f.range.start ? (f.range.end || f.range.start) : null,
            client_preferred_date: !f.slot && !f.range.start ? f.chip : null,
            client_preferred_date_label: whenLabel(),
            terms_accepted: f.terms === true
        };
        state.submitting = true;
        state.notice = '';
        render();
        var headers = { 'Content-Type': 'application/json' };
        if (state.token) headers.Authorization = 'Bearer ' + state.token;
        fetch(appPath('/api/flash/request'), { method: 'POST', headers: headers, body: JSON.stringify(body) })
            .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data || {} }; }); })
            .then(function (out) {
                state.submitting = false;
                var data = out.data;
                if (data.preview && out.status === 501) {
                    forgetKey();
                    renderDone({ preview: true, short_code: 'DEMO00', slot: f.slot ? { status: 'held', label: f.slot.label } : null });
                    return;
                }
                if (out.status >= 200 && out.status < 300 && data.success) {
                    forgetKey();
                    state.done = data;
                    renderDone(data);
                    return;
                }
                handleError(out.status, data);
            })
            .catch(function () {
                state.submitting = false;
                state.notice = 'No pudimos enviar tu solicitud. Revisa tu conexión e inténtalo de nuevo.';
                render();
            });
    }

    function handleError(status, data) {
        var code = data.code;
        if (code === 'flash_reserved' || code === 'flash_not_found' || code === 'flash_without_price') {
            forgetKey();
            renderMessage(code === 'flash_reserved' ? 'Este flash ya está reservado' : 'Este flash ya no está disponible',
                data.error || 'Mira los otros flashes del artista.',
                '<a class="wo-btn wo-btn--accent wo-btn--hard" href="' + esc(profileUrl()) + '">Ver otros flashes</a>');
            return;
        }
        if (code === 'slot_taken' || code === 'booking_disabled') {
            state.form.slot = null;
            state.booking.daySlots = {};
            state.booking.alternatives = code === 'slot_taken' ? (data.alternatives || []).slice(0, 6) : [];
            if (code === 'booking_disabled') state.booking.enabled = false;
            state.step = 2;
            state.errors = { when: data.error || 'Ese turno ya no está disponible. Elige otro.' };
            if (state.booking.enabled) loadCounts().then(function () { render(); });
            render('.fb-when button:not([disabled])');
            return;
        }
        if (data.field && FIELD_STEP[data.field] != null) {
            state.step = FIELD_STEP[data.field];
            var errors = {};
            errors[data.field] = data.error || 'Revisa este dato.';
            showErrors(errors);
            return;
        }
        state.notice = data.error || (status === 429 ? 'Estás haciendo muchas solicitudes seguidas. Espera un minuto y vuelve a intentarlo.' : 'No pudimos enviar tu solicitud. Inténtalo de nuevo.');
        render();
    }

    /* --------------------------------------------------------- turnos */
    function loadCounts() {
        var bk = state.booking;
        if (!D.Booking) return Promise.resolve();
        return D.Booking.publicSlots(username, { granularity: 'day', from: new Date().toISOString(), to: new Date(Date.now() + 120 * DAY_MS).toISOString() })
            .then(function (info) {
                bk.loaded = true;
                bk.enabled = !!(info && info.enabled);
                bk.minutes = info && info.slot_minutes;
                bk.tz = (info && info.timezone) || (B && B.DEFAULT_TZ) || 'America/Argentina/Buenos_Aires';
                bk.counts = {};
                (info && info.days || []).forEach(function (d) { if (d.count) bk.counts[d.date] = d.count; });
                // Sin turnos libres en los próximos meses: se pide un rango tentativo.
                if (!Object.keys(bk.counts).length) bk.enabled = false;
            })
            .catch(function () { bk.loaded = true; bk.enabled = false; });
    }

    function initSlotMonth() {
        var bk = state.booking;
        var firstDay = Object.keys(bk.counts).sort()[0];
        bk.month = firstDay ? firstDay.slice(0, 7) : todayIso().slice(0, 7);
        if (firstDay && !bk.day) { bk.day = firstDay; loadDay(firstDay); }
    }

    function loadDay(date) {
        var bk = state.booking;
        if (bk.daySlots[date] !== undefined || !D.Booking || !B) return;
        var next = new Date(Date.parse(date + 'T12:00:00Z') + DAY_MS).toISOString().slice(0, 10);
        var from = new Date(B.wallToUtc(date, 0, bk.tz)).toISOString();
        var to = new Date(B.wallToUtc(next, 0, bk.tz)).toISOString();
        D.Booking.publicSlots(username, { granularity: 'slot', from: from, to: to }).then(function (res) {
            var day = (res.days || []).find(function (d) { return d.date === date; });
            bk.daySlots[date] = (day && day.slots || []).map(function (s) {
                return { start: s.start, end: s.end, label: s.label, fullLabel: B.slotLabel(s.start, bk.tz, s.end) };
            });
        }).catch(function () { bk.daySlots[date] = []; }).then(function () {
            if (state.step === 2 && !state.done) render();
        });
    }

    /* ------------------------------------------------------------ eventos */
    main.addEventListener('input', function (ev) {
        var t = ev.target;
        var field = t.getAttribute && t.getAttribute('data-field');
        if (!field || field === 'terms') return;
        state.form[field] = t.value;
        if (field === 'zoneOther' && t.value.trim()) {
            state.form.zone = '';
            Array.prototype.forEach.call(main.querySelectorAll('[data-zone]'), function (b) { b.setAttribute('aria-checked', 'false'); });
        }
    });

    main.addEventListener('change', function (ev) {
        var t = ev.target;
        if (t.getAttribute('data-field') === 'terms') { state.form.terms = t.checked; return; }
        var part = t.getAttribute('data-birth');
        if (part) {
            state.form.birth[part] = Number(t.value) || null;
            var b = state.form.birth;
            if (b.day && b.day > R2.daysInMonth(b.year, b.month)) b.day = null;
            delete state.errors.client_birth_date;
            render('[data-birth="' + part + '"]');
        }
    });

    main.addEventListener('submit', function (ev) { ev.preventDefault(); next(); });

    main.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && ev.target && ev.target.tagName === 'INPUT' && ev.target.type !== 'checkbox') { ev.preventDefault(); next(); }
    });

    main.addEventListener('click', function (ev) {
        var t = ev.target.closest('button');
        if (!t || t.disabled) return;
        var f = state.form;
        var bk = state.booking;
        if (t.hasAttribute('data-nav')) { if (t.getAttribute('data-nav') === 'back') go(state.step - 1); else next(); return; }
        if (t.hasAttribute('data-first')) {
            f.first = t.getAttribute('data-first') === 'yes';
            delete state.errors.tattoo_is_first_tattoo;
            render('[data-first="' + t.getAttribute('data-first') + '"]');
            return;
        }
        if (t.hasAttribute('data-zone')) {
            f.zone = t.getAttribute('data-zone');
            f.zoneOther = '';
            delete state.errors.tattoo_body_part;
            render('[data-zone="' + CSS.escape(f.zone) + '"]');
            return;
        }
        if (t.hasAttribute('data-chip')) {
            var chip = t.getAttribute('data-chip');
            f.chip = f.chip === chip ? null : chip;
            f.range = { start: null, end: null };
            delete state.errors.when;
            render('[data-chip="' + CSS.escape(chip) + '"]');
            return;
        }
        if (t.hasAttribute('data-range-day')) {
            f.range = R2.pickRangeDay(f.range, t.getAttribute('data-range-day'));
            f.chip = null;
            delete state.errors.when;
            render('[data-range-day="' + t.getAttribute('data-range-day') + '"]');
            return;
        }
        if (t.hasAttribute('data-range-month')) {
            state.rangeMonth = shiftMonth(state.rangeMonth, Number(t.getAttribute('data-range-month')));
            render('[data-range-month="' + t.getAttribute('data-range-month') + '"]');
            return;
        }
        if (t.hasAttribute('data-slot-month')) {
            bk.month = shiftMonth(bk.month, Number(t.getAttribute('data-slot-month')));
            bk.day = null;
            render('[data-slot-month="' + t.getAttribute('data-slot-month') + '"]');
            return;
        }
        if (t.hasAttribute('data-slot-day')) {
            bk.day = t.getAttribute('data-slot-day');
            loadDay(bk.day);
            render('[data-slot-day="' + bk.day + '"]');
            return;
        }
        if (t.hasAttribute('data-slot')) {
            var start = t.getAttribute('data-slot');
            var s = (bk.daySlots[bk.day] || []).find(function (x) { return x.start === start; });
            if (!s) return;
            f.slot = f.slot && f.slot.start === start ? null : { start: s.start, end: s.end, minutes: bk.minutes, label: s.fullLabel || s.label };
            bk.alternatives = [];
            delete state.errors.when;
            render('[data-slot="' + CSS.escape(start) + '"]');
            return;
        }
        if (t.hasAttribute('data-alt')) {
            var alt = bk.alternatives[Number(t.getAttribute('data-alt'))];
            if (!alt) return;
            f.slot = { start: alt.start, end: alt.end, minutes: bk.minutes, label: alt.label };
            bk.alternatives = [];
            delete state.errors.when;
            render();
        }
    });

    /* ------------------------------------------------------------- inicio */
    function loadZones() {
        if (typeof D.from !== 'function') return Promise.resolve(FALLBACK_ZONES.slice());
        return Promise.resolve().then(function () {
            return D.from('body_parts').select('*').order('sort_order');
        }).then(function (res) {
            var rows = (res && res.data) || [];
            var roots = rows.filter(function (r) { return !r.parent_id; });
            var labels = (roots.length ? roots : rows).map(function (r) { return String(r.label || r.display_name || r.name || '').trim(); }).filter(Boolean);
            return labels.length ? labels : FALLBACK_ZONES.slice();
        }).catch(function () { return FALLBACK_ZONES.slice(); });
    }

    function loadSession() {
        var client = typeof D.getClient === 'function' ? D.getClient()
            : (window.ConfigManager && window.ConfigManager.getSupabaseClient && window.ConfigManager.getSupabaseClient());
        if (!client || !client.auth) return Promise.resolve();
        return client.auth.getSession().then(function (res) {
            var session = res && res.data && res.data.session;
            if (!session || !session.user) return;
            state.user = session.user;
            state.token = session.access_token || '';
            state.form.email = state.form.email || String(session.user.email || '');
            if (!D.Clients || typeof D.Clients.getByUserId !== 'function') return;
            // Mismo criterio que el cotizador: el correo queda en el de la cuenta
            // (así la cotización se vincula sola) y el resto se precarga.
            return Promise.resolve(D.Clients.getByUserId(session.user.id, 'full_name,whatsapp')).then(function (out) {
                var row = out && (out.data !== undefined ? out.data : out);
                if (Array.isArray(row)) row = row[0];
                if (!row) return;
                state.form.name = state.form.name || String(row.full_name || '');
                state.form.phone = state.form.phone || String(row.whatsapp || '');
            });
        }).catch(function () { /* sin sesión: el formulario queda vacío */ });
    }

    function start() {
        if (!F || !R2) { renderMessage('No pudimos cargar el flash', 'Recarga la página para intentarlo de nuevo.'); return; }
        var cancel = document.getElementById('fb-cancel');
        if (!username || !F.validId(flashId)) {
            renderMessage('Falta el flash', 'El enlace tiene que incluir el artista y el flash. Ábrelo desde el perfil del artista.');
            return;
        }
        if (cancel) cancel.href = profileUrl();
        if (!D.Artists || typeof D.Artists.getPublicByExactUsername !== 'function') {
            renderMessage('No pudimos cargar el flash', 'Recarga la página para intentarlo de nuevo.');
            return;
        }
        state.rangeMonth = todayIso().slice(0, 7);
        // ConfigManager carga la config (URL y clave pública) en forma asíncrona.
        var ready = window.ConfigManager && typeof window.ConfigManager.ready === 'function'
            ? Promise.resolve(window.ConfigManager.ready()).catch(function () { return null; }) : Promise.resolve();
        ready.then(function () {
            return D.Artists.getPublicByExactUsername(username, ARTIST_COLUMNS);
        }).then(function (res) {
            var artist = res && res.data;
            if (!artist) { renderMessage('No encontramos a ese artista', 'Revisa el enlace o busca al artista en We Ötzi.'); return null; }
            state.artist = artist;
            var feed = artist.gallery_feed_items;
            if (typeof feed === 'string') { try { feed = JSON.parse(feed); } catch (_) { feed = []; } }
            state.item = F.findItem(feed, flashId);
            state.view = state.item ? F.flashOf(state.item) : null;
            document.title = (state.view ? 'Reservar ' + state.view.title : 'Flash') + ' · ' + (artist.name || artist.username) + ' · We Ötzi';
            var profileAction = '<a class="wo-btn wo-btn--accent wo-btn--hard" href="' + esc(profileUrl()) + '">Ver el perfil del artista</a>';
            if (!state.view) { renderMessage('Este flash ya no está disponible', 'El artista lo quitó de su galería. Mira sus otros trabajos.', profileAction); return null; }
            return Promise.all([loadSession(), loadZones(), loadCounts()]).then(function (out) {
                state.zones = out[1] || FALLBACK_ZONES.slice();
                if (state.user && state.user.id === artist.user_id) {
                    renderMessage('Este flash es tuyo', 'Así lo ven tus clientes en tu perfil. Edita el precio y la disponibilidad desde tu galería.', '<a class="wo-btn wo-btn--accent wo-btn--hard" href="' + esc(appPath('/artist/dashboard')) + '">Ir a mi galería</a>');
                    return;
                }
                if (!state.view.available) { renderMessage('Este flash ya está reservado', 'Otra persona ya lo reservó. Mira los otros flashes del artista.', profileAction); return; }
                if (!F.canBook(state.view, { owner: false })) { renderMessage('Este flash todavía no se puede reservar', 'El artista no le puso precio. Puedes pedirle una cotización desde su perfil.', profileAction); return; }
                render();
            });
        }).catch(function () {
            renderMessage('No pudimos cargar el flash', 'Prueba de nuevo en unos minutos.');
        });
    }

    start();
})();
