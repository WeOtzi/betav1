/**
 * WE OTZI - Resumen de turnos disponibles (dashboard del artista + /calendar)
 * --------------------------------------------------------------------------
 * Se monta en cada [data-booking-summary] ("dashboard" | "calendar").
 * Cuatro bloques: Semana · Mes · 3 meses · Año con la capacidad real
 * (turnos que entran sin superponerse en los huecos libres) y las horas
 * libres; el próximo turno; acciones "Compartir turnos" y "Configurar".
 * Estados: cargando · sin horario · reservas apagadas · error.
 * Datos: WeotziData.Booking.summary() (servidor, lib/routes/turnos.js).
 * Publica window.WoBookingSummary.last y el evento 'wo:booking-summary'
 * (el encabezado del calendario suma "N turnos libres este mes").
 */
(function () {
    'use strict';

    var TILES = [
        ['week', 'Semana'],
        ['month', 'Mes'],
        ['next3Months', '3 meses'],
        ['year', 'Año']
    ];
    var DEMO = {
        success: true, enabled: true, reason: null, timezone: 'America/Argentina/Buenos_Aires', username: 'demo.wo',
        settings: { slot_minutes: 180 },
        summary: {
            week: { turnos: 4, horasLibres: 16 }, month: { turnos: 18, horasLibres: 72 },
            next3Months: { turnos: 54, horasLibres: 216 }, year: { turnos: 210, horasLibres: 840 }
        },
        next_slot: { label: 'jue 20 nov 2026 · 15:00–18:00' }
    };

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
    function hydrate(root) {
        if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') {
            try { window.WoIcons.hydrate(root); } catch (e) { /* íconos opcionales */ }
        }
    }
    function isDemo() {
        try { return !!(window.ConfigManager && window.ConfigManager.isDemoMode && window.ConfigManager.isDemoMode()); } catch (e) { return false; }
    }
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
    function hours(h) {
        var n = Math.round(Number(h || 0) * 10) / 10;
        return String(n).replace('.', ',') + ' h libres';
    }

    function tilesHtml(summary) {
        return '<ul class="bk-tiles">' + TILES.map(function (t) {
            var v = (summary && summary[t[0]]) || { turnos: 0, horasLibres: 0 };
            return '<li class="bk-tile">' +
                '<span class="bk-tile-label">' + esc(t[1]) + '</span>' +
                '<span class="bk-tile-value">' + esc(v.turnos) + '<span class="bk-sr"> ' + (v.turnos === 1 ? 'turno' : 'turnos') + '</span></span>' +
                '<span class="bk-tile-sub">' + esc(v.turnos === 1 ? 'turno' : 'turnos') + ' · ' + esc(hours(v.horasLibres)) + '</span>' +
                '</li>';
        }).join('') + '</ul>';
    }

    function render(host, data) {
        var compact = host.getAttribute('data-booking-summary') === 'calendar';
        host.classList.add('bk-summary');
        host.classList.toggle('bk-summary--compact', compact);
        host.setAttribute('aria-busy', 'false');
        var configUrl = appUrl('/artist/account/#disponibilidad');
        var head = '<div class="bk-summary-head"><h2 class="bk-summary-title">Turnos disponibles</h2>' +
            (data && data.reason !== 'no_schedule'
                ? '<span class="bk-summary-status ' + (data.enabled ? 'is-on' : 'is-off') + '">' + (data.enabled ? 'Reservas online activas' : 'Reservas online apagadas') + '</span>'
                : '') + '</div>';

        if (!data) {
            host.innerHTML = head + '<p class="bk-note" role="alert">No pudimos calcular tus turnos.</p>' +
                '<div class="bk-btn-row"><button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-bk-retry>Reintentar</button></div>';
            host.querySelector('[data-bk-retry]').addEventListener('click', function () { load(host); });
            return;
        }
        if (data.reason === 'no_schedule') {
            host.innerHTML = head + '<p class="bk-note">Configurá tu horario semanal y te mostramos los turnos libres de la semana, el mes, los próximos 3 meses y el año.</p>' +
                '<div class="bk-btn-row"><a class="wo-btn wo-btn--accent wo-btn--hard wo-btn--s" href="' + esc(configUrl) + '">Configurar horario</a></div>';
            return;
        }
        var s = data.summary || {};
        var next = data.next_slot && data.next_slot.label
            ? '<p class="bk-next">Próximo turno libre: <strong>' + esc(data.next_slot.label) + '</strong></p>'
            : '<p class="bk-next">No quedan turnos libres en el horizonte configurado.</p>';
        var off = data.enabled ? '' : '<p class="bk-note">Tus clientes todavía no pueden reservar estos turnos. Activá las reservas online para compartir tu enlace.</p>';
        var actions = data.enabled
            ? '<button type="button" class="wo-btn wo-btn--accent wo-btn--hard wo-btn--s" data-bk-share><i data-wo-icon="share-2" aria-hidden="true"></i> Compartir turnos</button>' +
              '<a class="wo-btn wo-btn--secondary wo-btn--s" href="' + esc(configUrl) + '">Configurar</a>'
            : '<a class="wo-btn wo-btn--accent wo-btn--hard wo-btn--s" href="' + esc(configUrl) + '">Activar reservas online</a>';
        host.innerHTML = head + tilesHtml(s) + next + off + '<div class="bk-btn-row">' + actions + '</div>' +
            '<p class="bk-status" role="status" aria-live="polite" data-bk-status></p>';
        var share = host.querySelector('[data-bk-share]');
        if (share) share.addEventListener('click', function () { shareLink(host, data); });
        hydrate(host);
    }

    function shareLink(host, data) {
        var username = data.username || (window.artistData && window.artistData.username) || '';
        // En el dashboard, el panel de compartir ya tiene QR, WhatsApp y copiar.
        if (window.WodShare && typeof window.WodShare.open === 'function' && host.getAttribute('data-booking-summary') === 'dashboard') {
            window.WodShare.open('share', 'turnos', host.querySelector('[data-bk-share]'));
            return;
        }
        var url = window.WeotziData && window.WeotziData.Booking ? window.WeotziData.Booking.publicUrl(username) : '';
        var status = host.querySelector('[data-bk-status]');
        if (!url) { if (status) status.textContent = 'Completá tu usuario en el perfil para compartir tus turnos.'; return; }
        var done = function (msg) { if (status) { status.textContent = msg; status.className = 'bk-status is-ok'; } };
        if (navigator.share) {
            navigator.share({ title: 'Mis turnos disponibles · We Ötzi', text: 'Elegí un turno y pedime tu cotización', url: url })
                .then(function () { done('Enlace compartido.'); }).catch(function () { /* cancelado */ });
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(function () { done('Copiamos el enlace de tus turnos.'); })
                .catch(function () { done(url); });
        } else {
            done(url);
        }
    }

    function publish(data) {
        window.WoBookingSummary.last = data;
        try { document.dispatchEvent(new CustomEvent('wo:booking-summary', { detail: data })); } catch (e) { /* noop */ }
    }

    function load(host) {
        host.classList.add('bk-summary');
        host.setAttribute('aria-busy', 'true');
        host.innerHTML = '<div class="bk-summary-head"><h2 class="bk-summary-title">Turnos disponibles</h2></div>' +
            '<ul class="bk-tiles" aria-hidden="true">' + TILES.map(function () { return '<li class="wo-skeleton"></li>'; }).join('') + '</ul>' +
            '<p class="bk-sr" role="status">Calculando tus turnos disponibles…</p>';
        if (isDemo()) { render(host, DEMO); publish(DEMO); return Promise.resolve(DEMO); }
        var repo = window.WeotziData && window.WeotziData.Booking;
        if (!repo) { render(host, null); return Promise.resolve(null); }
        return repo.summary().then(function (data) {
            render(host, data);
            publish(data);
            return data;
        }).catch(function (err) {
            console.warn('[booking-summary]', err && err.message);
            render(host, null);
            return null;
        });
    }

    function mountAll() {
        var hosts = document.querySelectorAll('[data-booking-summary]');
        if (!hosts.length) return;
        // Una sola consulta por página aunque haya más de un resumen.
        var first = load(hosts[0]);
        for (var i = 1; i < hosts.length; i++) {
            (function (h) { first.then(function (d) { render(h, d); }); })(hosts[i]);
        }
    }

    // "N turnos libres este mes" para el encabezado del calendario.
    function monthPhrase(data) {
        if (!data || data.reason === 'no_schedule' || !data.summary || !data.summary.month) return '';
        return plural(data.summary.month.turnos, 'turno libre', 'turnos libres') + ' este mes';
    }

    window.WoBookingSummary = { load: load, mountAll: mountAll, monthPhrase: monthPhrase, last: null };

    // Espera la sesión (los scripts de auth cargan antes y resuelven al rato).
    function start() {
        var tries = 0;
        (function wait() {
            var client = null;
            try { client = window.ConfigManager && window.ConfigManager.getSupabaseClient && window.ConfigManager.getSupabaseClient(); } catch (e) { client = null; }
            if (client || isDemo() || tries++ > 40) { mountAll(); return; }
            setTimeout(wait, 150);
        })();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
