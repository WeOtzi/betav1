/**
 * WE OTZI - Cuenta → Disponibilidad → "Reservas online" (frente "turnos")
 * ----------------------------------------------------------------------
 * Opt-in del artista y reglas de turno (duración, intervalo, margen,
 * anticipación, horizonte y vigencia del apartado). El horario semanal es el
 * que ya se edita arriba en Disponibilidad (user_preferences.app_settings).
 * Se monta en [data-booking-settings]. Datos: WeotziData.Booking
 * (GET/PUT /api/calendar/booking-settings). Muestra y copia el enlace público
 * /turnos?artist=<usuario>.
 */
(function () {
    'use strict';

    var DURATIONS = [60, 90, 120, 150, 180, 210, 240, 300, 360, 420, 480, 600, 720];
    var STEPS = [15, 30, 60, 90, 120, 180, 240];
    var BUFFERS = [0, 15, 30, 45, 60, 90, 120];
    var NOTICES = [0, 2, 4, 12, 24, 48, 72, 168];
    var HORIZONS = [7, 14, 30, 60, 90, 180, 365];
    var HOLDS = [12, 24, 48, 72, 96, 120, 168];

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function minutesLabel(m) {
        var h = Math.floor(m / 60), r = m % 60;
        if (!h) return r + ' min';
        return h + ' h' + (r ? ' ' + r + ' min' : '');
    }
    function hoursLabel(h) {
        if (h === 0) return 'Sin anticipación';
        if (h % 24 === 0) return (h / 24) + (h === 24 ? ' día' : ' días');
        return h + ' h';
    }
    function daysLabel(d) {
        if (d === 365) return '1 año';
        if (d % 30 === 0 && d >= 60) return (d / 30) + ' meses';
        return d + ' días';
    }
    function options(list, current, label) {
        var values = list.slice();
        if (values.indexOf(current) === -1 && Number.isFinite(current)) values.push(current);
        values.sort(function (a, b) { return a - b; });
        return values.map(function (v) {
            return '<option value="' + v + '"' + (v === current ? ' selected' : '') + '>' + esc(label(v)) + '</option>';
        }).join('');
    }
    function field(id, labelText, control, help) {
        return '<div class="bk-field">' +
            '<label for="' + id + '">' + esc(labelText) + '</label>' + control +
            (help ? '<p class="wo-help" id="' + id + '-help">' + esc(help) + '</p>' : '') +
            '</div>';
    }
    function select(id, list, current, label, help) {
        return '<select class="wo-select" id="' + id + '" name="' + id.replace('bk-', '') + '"' +
            (help ? ' aria-describedby="' + id + '-help"' : '') + '>' + options(list, current, label) + '</select>';
    }

    function render(host, data) {
        var s = data.settings;
        var url = data.username && window.WeotziData && window.WeotziData.Booking ? window.WeotziData.Booking.publicUrl(data.username) : '';
        host.className = 'bk-settings';
        host.setAttribute('aria-labelledby', 'bk-settings-title');
        host.innerHTML =
            '<div class="bk-settings-head">' +
                '<p class="bk-eyebrow">Turnos</p>' +
                '<h2 class="bk-settings-title" id="bk-settings-title">Reservas online</h2>' +
                '<p class="bk-settings-sub">Calculamos tus turnos libres con el horario semanal de arriba y tu calendario. Tus clientes eligen uno desde tu enlace, te llega la solicitud con el turno apartado y, cuando la aceptás, queda agendado y bloqueado.</p>' +
            '</div>' +
            (data.has_schedule ? '' : '<p class="wo-alert wo-alert--warning" role="note">Guardá tu horario semanal (Editar disponibilidad) antes de activar las reservas online.</p>') +
            '<form class="bk-grid" id="bk-settings-form" novalidate>' +
                '<label class="bk-switch bk-field--wide"><input type="checkbox" name="enabled" id="bk-enabled"' + (s.enabled ? ' checked' : '') + '><span>Aceptar reservas online de mis turnos disponibles</span></label>' +
                field('bk-slot', 'Duración del turno', select('bk-slot', DURATIONS, s.slot_minutes, minutesLabel, 'Lo que dura cada turno que ofrecés.'), 'Lo que dura cada turno que ofrecés.') +
                field('bk-step', 'Intervalo entre inicios', select('bk-step', STEPS, s.slot_step_minutes, minutesLabel, 'Cada cuánto puede empezar un turno.'), 'Cada cuánto puede empezar un turno.') +
                field('bk-buffer', 'Margen entre turnos', select('bk-buffer', BUFFERS, s.buffer_minutes, function (v) { return v ? minutesLabel(v) : 'Sin margen'; }, 'Tiempo libre antes y después de cada evento.'), 'Tiempo libre antes y después de cada evento.') +
                field('bk-notice', 'Anticipación mínima', select('bk-notice', NOTICES, s.min_notice_hours, hoursLabel, 'No se ofrecen turnos que empiecen antes.'), 'No se ofrecen turnos que empiecen antes.') +
                field('bk-horizon', 'Horizonte', select('bk-horizon', HORIZONS, s.horizon_days, daysLabel, 'Hasta cuándo se pueden reservar turnos.'), 'Hasta cuándo se pueden reservar turnos.') +
                field('bk-hold', 'Turno apartado durante', select('bk-hold', HOLDS, s.hold_hours, hoursLabel, 'Mientras respondés, nadie más puede pedir ese turno.'), 'Mientras respondés, nadie más puede pedir ese turno.') +
                '<div class="bk-field bk-field--wide"><label for="bk-note">Nota para tus clientes (opcional)</label>' +
                    '<textarea class="wo-textarea" id="bk-note" name="public_note" maxlength="280" rows="2" placeholder="Las sesiones son en Estudio Norte. Traé tu referencia impresa.">' + esc(s.public_note || '') + '</textarea></div>' +
                '<p class="bk-tz-note bk-field--wide">Zona horaria de tus turnos: <strong>' + esc(data.timezone) + '</strong>. La cambiás en Configuración.</p>' +
                '<div class="bk-btn-row bk-field--wide"><button type="submit" class="wo-btn wo-btn--accent wo-btn--hard" id="bk-save">Guardar reservas online</button></div>' +
                '<p class="bk-status bk-field--wide" id="bk-status" role="status" aria-live="polite"></p>' +
            '</form>' +
            (url ? '<div class="bk-field"><span class="bk-eyebrow" id="bk-link-label">Tu enlace de turnos</span>' +
                '<div class="bk-link-box" aria-labelledby="bk-link-label"><code id="bk-link">' + esc(url) + '</code>' +
                '<button type="button" class="wo-btn wo-btn--secondary wo-btn--s" id="bk-copy">Copiar enlace</button>' +
                '<a class="wo-btn wo-btn--ghost wo-btn--s" href="' + esc(url) + '" target="_blank" rel="noopener">Ver página</a></div>' +
                (s.enabled ? '' : '<p class="wo-help">El enlace muestra tus turnos cuando activás las reservas online.</p>') + '</div>' : '');

        var form = host.querySelector('#bk-settings-form');
        form.addEventListener('submit', function (ev) { ev.preventDefault(); save(host, form); });
        var copy = host.querySelector('#bk-copy');
        if (copy) copy.addEventListener('click', function () {
            var status = host.querySelector('#bk-status');
            var done = function (msg) { status.textContent = msg; status.className = 'bk-status bk-field--wide is-ok'; };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { done('Copiamos tu enlace de turnos.'); }, function () { done(url); });
            else done(url);
        });
    }

    function save(host, form) {
        var status = host.querySelector('#bk-status');
        var button = host.querySelector('#bk-save');
        var value = {
            enabled: form.querySelector('#bk-enabled').checked,
            slot_minutes: Number(form.querySelector('#bk-slot').value),
            slot_step_minutes: Number(form.querySelector('#bk-step').value),
            buffer_minutes: Number(form.querySelector('#bk-buffer').value),
            min_notice_hours: Number(form.querySelector('#bk-notice').value),
            horizon_days: Number(form.querySelector('#bk-horizon').value),
            hold_hours: Number(form.querySelector('#bk-hold').value),
            public_note: form.querySelector('#bk-note').value
        };
        button.disabled = true;
        status.className = 'bk-status bk-field--wide';
        status.textContent = 'Guardando…';
        window.WeotziData.Booking.saveSettings(value).then(function () {
            return load(host, true);
        }).then(function () {
            var st = host.querySelector('#bk-status');
            if (st) { st.className = 'bk-status bk-field--wide is-ok'; st.textContent = value.enabled ? 'Listo: tus turnos ya se pueden reservar.' : 'Guardamos tu configuración.'; }
        }).catch(function (err) {
            status.className = 'bk-status bk-field--wide is-error';
            status.textContent = (err && err.message) || 'No pudimos guardar tu configuración de turnos.';
            button.disabled = false;
        });
    }

    function load(host, keepScroll) {
        var repo = window.WeotziData && window.WeotziData.Booking;
        if (!repo) return Promise.resolve();
        if (!keepScroll) host.innerHTML = '<p class="bk-loading"><span class="wo-spinner" aria-hidden="true"></span> Cargando reservas online…</p>';
        return repo.getSettings().then(function (data) { render(host, data); }).catch(function (err) {
            host.innerHTML = '<p class="bk-status is-error" role="alert">' + esc((err && err.message) || 'No pudimos cargar las reservas online.') + '</p>' +
                '<button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-bk-retry>Reintentar</button>';
            host.querySelector('[data-bk-retry]').addEventListener('click', function () { load(host); });
        });
    }

    function start() {
        var host = document.querySelector('[data-booking-settings]');
        if (!host) return;
        try { if (window.ConfigManager && window.ConfigManager.isDemoMode && window.ConfigManager.isDemoMode()) { host.hidden = true; return; } } catch (e) { /* noop */ }
        var tries = 0;
        (function wait() {
            var client = null;
            try { client = window.ConfigManager && window.ConfigManager.getSupabaseClient && window.ConfigManager.getSupabaseClient(); } catch (e) { client = null; }
            if (client || tries++ > 40) { load(host); return; }
            setTimeout(wait, 150);
        })();
        // El horario se guarda arriba: al guardarlo, recargamos el aviso "sin horario".
        document.addEventListener('click', function (ev) {
            if (ev.target && ev.target.closest && ev.target.closest('#av-save')) setTimeout(function () { load(host, true); }, 1200);
        });
    }

    window.WoBookingSettings = { load: load };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
