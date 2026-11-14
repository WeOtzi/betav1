/**
 * WE OTZI - Perfil público del artista: "Próximos turnos" (#turnos)
 * -----------------------------------------------------------------
 * Si el artista tiene reservas online activas y turnos libres, muestra los
 * próximos 3 días con turnos (cada horario lleva directo a /quotation con el
 * turno elegido) y "Reservar sesión" pasa a abrir /turnos?artist=<usuario>.
 * Sin reservas online o sin turnos, la sección queda oculta y los botones
 * siguen yendo al cotizador como siempre.
 */
(function () {
    'use strict';

    var Booking = window.WeotziData && window.WeotziData.Booking;
    var M = window.WoBookingSlots;
    var WEEKDAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
    var MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    var RESERVE_IDS = ['reserve-cta-top-btn', 'reserve-cta-bottom-btn', 'reserve-cta-bar-btn'];

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
    function dayTitle(date) {
        var p = date.split('-').map(Number);
        return WEEKDAYS[M.weekdayIndex(date)] + ' ' + p[2] + ' ' + MONTHS[p[1] - 1];
    }

    var api = window.WoProfileTurnos = { reserveUrl: null };

    function applyReserveLinks() {
        if (!api.reserveUrl) return;
        RESERVE_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.href = api.reserveUrl;
        });
    }

    function render(info) {
        var section = document.getElementById('turnos');
        var list = document.getElementById('turnos-days');
        var all = document.getElementById('turnos-all');
        if (!section || !list) return;
        var u = info.artist.username;
        var days = (info.days || []).filter(function (d) { return d.slots && d.slots.length; }).slice(0, 3);
        if (!days.length) return;
        var turnosUrl = appUrl('/turnos?artist=' + encodeURIComponent(u));
        if (all) all.href = turnosUrl;
        list.innerHTML = days.map(function (d) {
            return '<li class="bk-profile-day"><h3>' + esc(dayTitle(d.date)) + '</h3><ul class="bk-chips">' +
                d.slots.slice(0, 4).map(function (s) {
                    var href = appUrl('/quotation?artist=' + encodeURIComponent(u) + '&slot=' + encodeURIComponent(s.start) + '&dur=' + encodeURIComponent(info.slot_minutes));
                    return '<li><a class="bk-chip bk-chip-link" href="' + esc(href) + '" aria-label="' + esc('Pedir el turno del ' + dayTitle(d.date) + ' a las ' + s.label) + '">' + esc(s.label) + '</a></li>';
                }).join('') + '</ul></li>';
        }).join('');
        section.hidden = false;
    }

    function start() {
        if (!Booking || !M) return;
        var params = new URLSearchParams(window.location.search);
        var username = String(params.get('artist') || '').replace(/^@+/, '').trim();
        if (!username) return;
        try { if (window.ConfigManager && window.ConfigManager.isDemoMode && window.ConfigManager.isDemoMode()) return; } catch (e) { /* noop */ }
        Booking.publicSlots(username, {
            granularity: 'slot',
            from: new Date().toISOString(),
            to: new Date(Date.now() + 31 * 86400000).toISOString()
        }).then(function (info) {
            if (!info || !info.enabled || !info.artist) return;
            api.reserveUrl = appUrl('/turnos?artist=' + encodeURIComponent(info.artist.username));
            applyReserveLinks();
            render(info);
            if (window.location.hash === '#turnos') {
                var section = document.getElementById('turnos');
                if (section && !section.hidden) section.scrollIntoView({ block: 'start' });
            }
        }).catch(function () { /* sin turnos: el perfil sigue igual */ });
    }

    api.applyReserveLinks = applyReserveLinks;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
