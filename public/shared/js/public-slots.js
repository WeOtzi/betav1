/**
 * WE OTZI - Página pública de turnos: /turnos?artist=<usuario>
 * -------------------------------------------------------------
 * Muestra los turnos libres del artista (solo inicio/fin, calculados en el
 * servidor) en una tira de meses, una grilla mensual y los horarios del día
 * elegido. "Pedir este turno" lleva a /quotation con artista + turno
 * preseleccionados: /quotation?artist=<u>&slot=<ISO UTC>&dur=<min>.
 * Horas en la zona del artista (con aviso si el navegador está en otra).
 * Datos: WeotziData.Booking.publicSlots (GET /api/public/artists/:u/slots).
 */
(function () {
    'use strict';

    var M = window.WoBookingSlots;
    var Booking = window.WeotziData && window.WeotziData.Booking;
    var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    var MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    var WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
    var DAY_MS = 86400000;

    var root = document.getElementById('bk-root');
    var params = new URLSearchParams(window.location.search);
    var username = String(params.get('artist') || params.get('a') || '').replace(/^@+/, '').trim();
    var state = { info: null, counts: {}, month: null, monthSlots: {}, day: null, slot: null, loadingMonth: null };

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function appUrl(path) {
        var base = window.WEOTZI_BASE_PATH ? String(window.WEOTZI_BASE_PATH).replace(/\/$/, '')
            : (/^\/beta(?:\/|$)/.test(String(window.location.pathname || '')) ? '/beta' : '');
        return base + path;
    }
    function hydrate(el) {
        if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') { try { window.WoIcons.hydrate(el); } catch (e) { /* opcional */ } }
    }
    function quotationUrl(slot) {
        var q = '/quotation?artist=' + encodeURIComponent(state.info.artist.username);
        if (slot) q += '&slot=' + encodeURIComponent(slot.start) + '&dur=' + encodeURIComponent(state.info.slot_minutes);
        return appUrl(q);
    }
    function dateParts(date) { var p = date.split('-').map(Number); return { y: p[0], m: p[1], d: p[2] }; }
    function monthKey(date) { return date.slice(0, 7); }
    function longDay(date) {
        var p = dateParts(date);
        return WEEKDAYS[M.weekdayIndex(date)] + ' ' + p.d + ' de ' + MONTHS[p.m - 1];
    }
    function pad(n) { return String(n).padStart(2, '0'); }

    function renderError(title, message, withQuote) {
        root.innerHTML = '<div class="bk-empty"><h1 class="bk-artist-name">' + esc(title) + '</h1><p>' + esc(message) + '</p>' +
            '<div class="bk-btn-row">' +
            (withQuote ? '<a class="wo-btn wo-btn--accent wo-btn--hard" href="' + esc(quotationUrl(null)) + '">Pedir cotización</a>' : '') +
            '<a class="wo-btn wo-btn--secondary" href="' + esc(appUrl('/marketplace')) + '">Ver artistas</a></div></div>';
    }

    function headerHtml() {
        var a = state.info.artist;
        var initials = String(a.name || a.username || 'Ö').replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 ]/g, '').split(' ').map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase() || 'Ö';
        var profile = appUrl('/artist/profile?artist=' + encodeURIComponent(a.username));
        return '<header class="bk-artist">' +
            (a.avatar ? '<img src="' + esc(a.avatar) + '" alt="" width="72" height="72" loading="eager">' : '<span class="bk-avatar" aria-hidden="true">' + esc(initials) + '</span>') +
            '<div><p class="bk-eyebrow">Turnos disponibles</p><h1 class="bk-artist-name">' + esc(a.name) + '</h1>' +
            '<p class="bk-artist-sub">' + (a.city ? esc(a.city) + ' · ' : '') + '<a href="' + esc(profile) + '">Ver perfil</a></p></div>' +
            '</header>';
    }

    function tzNote() {
        var browserTz = '';
        try { browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { browserTz = ''; }
        var tz = state.info.timezone;
        return '<p class="bk-tz-note">Horarios en la zona del artista (' + esc(tz) + ')' +
            (browserTz && browserTz !== tz ? '. Tu navegador está en ' + esc(browserTz) + ': revisa la diferencia horaria.' : '.') +
            ' Cada turno dura ' + esc(minutes(state.info.slot_minutes)) + '.</p>';
    }
    function minutes(m) { var h = Math.floor(m / 60), r = m % 60; return h ? h + ' h' + (r ? ' ' + r + ' min' : '') : r + ' min'; }

    function monthList() {
        var tz = state.info.timezone;
        var today = M.zonedDate(Date.now(), tz);
        var list = [];
        var y = dateParts(today).y, m = dateParts(today).m;
        var months = Math.min(13, Math.ceil((state.info.horizon_days || 365) / 30) + 1);
        for (var i = 0; i < months; i++) {
            var mm = ((m - 1 + i) % 12) + 1;
            var yy = y + Math.floor((m - 1 + i) / 12);
            list.push(yy + '-' + pad(mm));
        }
        return list;
    }
    function monthCount(key) {
        var n = 0;
        Object.keys(state.counts).forEach(function (d) { if (d.indexOf(key) === 0) n += state.counts[d]; });
        return n;
    }

    function monthsHtml() {
        return '<ul class="bk-months" aria-label="Meses">' + monthList().map(function (key) {
            var p = key.split('-').map(Number);
            var on = key === state.month;
            var n = monthCount(key);
            return '<li><button type="button" class="bk-month" data-month="' + key + '" aria-pressed="' + on + '" aria-label="' + esc(MONTHS[p[1] - 1] + ' ' + p[0] + ': ' + n + (n === 1 ? ' turno' : ' turnos')) + '">' +
                esc(MONTHS_SHORT[p[1] - 1] + ' ' + String(p[0]).slice(2)) + '<b>' + n + '</b></button></li>';
        }).join('') + '</ul>';
    }

    function calendarHtml() {
        var p = state.month.split('-').map(Number);
        var first = state.month + '-01';
        var offset = M.weekdayIndex(first);
        var daysIn = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
        var cells = [];
        for (var i = 0; i < offset; i++) cells.push('<span class="bk-day is-blank" aria-hidden="true"></span>');
        var slotsByDay = state.monthSlots[state.month] || {};
        for (var d = 1; d <= daysIn; d++) {
            var date = state.month + '-' + pad(d);
            var n = slotsByDay[date] ? slotsByDay[date].length : (state.counts[date] || 0);
            var selected = state.day === date;
            cells.push(n
                ? '<button type="button" class="bk-day has-slots' + (selected ? ' is-selected' : '') + '" data-day="' + date + '" aria-pressed="' + selected + '" aria-label="' + esc(longDay(date) + ': ' + n + (n === 1 ? ' turno libre' : ' turnos libres')) + '">' + d + '</button>'
                : '<button type="button" class="bk-day" disabled aria-label="' + esc(longDay(date) + ': sin turnos') + '">' + d + '</button>');
        }
        return '<div class="bk-cal-head"><h2 class="bk-cal-title">' + esc(MONTHS[p[1] - 1] + ' ' + p[0]) + '</h2></div>' +
            '<div class="bk-cal-dow" aria-hidden="true">' + ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>' +
            '<div class="bk-cal-grid">' + cells.join('') + '</div>';
    }

    function dayPanelHtml() {
        if (state.loadingMonth === state.month) return '<p class="bk-loading"><span class="wo-spinner" aria-hidden="true"></span> Buscando horarios…</p>';
        if (!state.day) {
            var any = monthCount(state.month) || Object.keys(state.monthSlots[state.month] || {}).length;
            return '<div><h2 class="bk-day-title">Elige un día</h2><p class="bk-note">' +
                (any ? 'Los días marcados tienen turnos libres.' : 'Este mes no tiene turnos libres. Prueba con otro mes.') + '</p></div>';
        }
        var slots = (state.monthSlots[state.month] || {})[state.day] || [];
        if (!slots.length) {
            return '<div><h2 class="bk-day-title">' + esc(longDay(state.day)) + '</h2><p class="bk-note">Ese día ya no tiene turnos libres. Elige otro.</p></div>';
        }
        return '<div class="bk-panel-day"><h2 class="bk-day-title">' + esc(longDay(state.day)) + '</h2></div>' +
            '<ul class="bk-chips" aria-label="Horarios disponibles">' + slots.map(function (s) {
                var on = state.slot && state.slot.start === s.start;
                return '<li><button type="button" class="bk-chip" data-slot="' + esc(s.start) + '" aria-pressed="' + on + '">' + esc(s.label) +
                    '<small>hasta ' + esc(M.zonedTime(s.end, state.info.timezone)) + '</small></button></li>';
            }).join('') + '</ul>' +
            '<div class="bk-cta">' +
            (state.slot
                ? '<a class="wo-btn wo-btn--accent wo-btn--hard" href="' + esc(quotationUrl(state.slot)) + '">Pedir este turno <i data-wo-icon="arrow-right" aria-hidden="true"></i></a>' +
                  '<p class="bk-note">Vas a completar tu idea en el cotizador. El turno queda apartado mientras el artista responde.</p>'
                : '<button type="button" class="wo-btn wo-btn--accent wo-btn--hard" disabled>Elige un horario</button>') +
            '</div>';
    }

    function render() {
        var info = state.info;
        if (!info.enabled) {
            root.innerHTML = headerHtml() +
                '<div class="bk-empty"><h2>Reservas online no disponibles</h2><p>' + esc(info.artist.name) + ' no está tomando reservas online por ahora. Pide una cotización y te propone fecha.</p>' +
                '<div class="bk-btn-row"><a class="wo-btn wo-btn--accent wo-btn--hard" href="' + esc(quotationUrl(null)) + '">Pedir cotización</a></div></div>';
            hydrate(root);
            return;
        }
        var total = Object.keys(state.counts).reduce(function (n, d) { return n + state.counts[d]; }, 0);
        var empty = state.countsLoaded && !total
            ? '<div class="bk-empty"><h2>Sin turnos libres por ahora</h2><p>Todos los turnos están tomados. Pide una cotización y el artista te propone fecha.</p>' +
              '<div class="bk-btn-row"><a class="wo-btn wo-btn--accent wo-btn--hard" href="' + esc(quotationUrl(null)) + '">Pedir cotización</a></div></div>'
            : '';
        root.innerHTML = headerHtml() +
            (info.public_note ? '<p class="bk-note">' + esc(info.public_note) + '</p>' : '') +
            empty +
            '<div class="bk-layout">' +
                '<section class="bk-panel" aria-label="Calendario de turnos">' + monthsHtml() + calendarHtml() + '</section>' +
                '<section class="bk-panel" aria-label="Horarios del día" id="bk-day-panel">' + dayPanelHtml() + '</section>' +
            '</div>' + tzNote() +
            '<p class="bk-note">¿Ningún turno te sirve? <a href="' + esc(quotationUrl(null)) + '">Pide una cotización sin turno</a> y el artista te propone fecha.</p>';
        hydrate(root);
    }

    // Rango [inicio de mes, inicio del mes siguiente) en la zona del artista.
    function monthRange(key) {
        var p = key.split('-').map(Number);
        var next = p[1] === 12 ? (p[0] + 1) + '-01-01' : p[0] + '-' + pad(p[1] + 1) + '-01';
        return { from: new Date(M.wallToUtc(key + '-01', 0, state.info.timezone)).toISOString(), to: new Date(M.wallToUtc(next, 0, state.info.timezone)).toISOString() };
    }

    function loadMonth(key) {
        if (state.monthSlots[key]) return Promise.resolve();
        state.loadingMonth = key;
        var r = monthRange(key);
        return Booking.publicSlots(username, { from: r.from, to: r.to, granularity: 'slot' }).then(function (res) {
            var byDay = {};
            (res.days || []).forEach(function (d) { byDay[d.date] = d.slots || []; });
            state.monthSlots[key] = byDay;
        }).catch(function () { state.monthSlots[key] = {}; }).then(function () {
            if (state.loadingMonth === key) state.loadingMonth = null;
        });
    }

    // Contadores por día en tramos de 90 días hasta el horizonte.
    function loadCounts() {
        var horizon = Math.min(state.info.horizon_days || 365, 400);
        var start = Date.now();
        var chunks = [];
        for (var off = 0; off < horizon; off += 90) chunks.push([start + off * DAY_MS, start + Math.min(off + 90, horizon + 1) * DAY_MS]);
        return chunks.reduce(function (p, c) {
            return p.then(function () {
                return Booking.publicSlots(username, { from: new Date(c[0]).toISOString(), to: new Date(c[1]).toISOString(), granularity: 'day' })
                    .then(function (res) { (res.days || []).forEach(function (d) { state.counts[d.date] = d.count; }); render(); })
                    .catch(function () { /* el mes elegido igual carga sus turnos */ });
            });
        }, Promise.resolve()).then(function () { state.countsLoaded = true; render(); });
    }

    function selectMonth(key) {
        state.month = key;
        state.day = null;
        state.slot = null;
        render();
        loadMonth(key).then(function () {
            if (state.month !== key) return;
            var days = Object.keys(state.monthSlots[key] || {}).filter(function (d) { return state.monthSlots[key][d].length; }).sort();
            if (days.length && !state.day) state.day = days[0];
            render();
        });
    }

    root.addEventListener('click', function (ev) {
        var t = ev.target.closest('button');
        if (!t || t.disabled) return;
        if (t.hasAttribute('data-month')) { selectMonth(t.getAttribute('data-month')); return; }
        if (t.hasAttribute('data-day')) {
            state.day = t.getAttribute('data-day');
            state.slot = null;
            render();
            var panel = document.getElementById('bk-day-panel');
            if (panel && window.matchMedia && window.matchMedia('(max-width: 899px)').matches) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
        if (t.hasAttribute('data-slot')) {
            var start = t.getAttribute('data-slot');
            var slots = (state.monthSlots[state.month] || {})[state.day] || [];
            state.slot = slots.find(function (s) { return s.start === start; }) || null;
            render();
            var cta = root.querySelector('.bk-cta .wo-btn');
            if (cta) cta.focus();
        }
    });

    function start() {
        if (!M || !Booking) { renderError('No pudimos cargar los turnos', 'Recarga la página para intentarlo de nuevo.', false); return; }
        if (!username) { renderError('Falta el artista', 'El enlace de turnos tiene que incluir el usuario del artista.', false); return; }
        Booking.publicSlots(username, { granularity: 'day', from: new Date().toISOString(), to: new Date(Date.now() + 90 * DAY_MS).toISOString() }).then(function (info) {
            state.info = info;
            document.title = 'Turnos de ' + (info.artist && info.artist.name ? info.artist.name : 'artista') + ' · We Ötzi';
            if (!info.enabled) { render(); return; }
            (info.days || []).forEach(function (d) { state.counts[d.date] = d.count; });
            var wanted = /^\d{4}-\d{2}$/.test(params.get('mes') || '') ? params.get('mes') : null;
            var firstDay = Object.keys(state.counts).sort()[0];
            selectMonth(wanted || (firstDay ? monthKey(firstDay) : monthList()[0]));
            loadCounts();
        }).catch(function (err) {
            if (err && err.status === 404) renderError('No encontramos a ese artista', 'Revisa el enlace o busca al artista en We Ötzi.', false);
            else renderError('No pudimos cargar los turnos', 'Prueba de nuevo en unos minutos.', false);
        });
    }

    start();
})();
