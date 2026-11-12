/**
 * WE ÖTZI - Vacaciones del artista con efecto (Cuenta 801:571)
 * ------------------------------------------------------------
 * artists_db.vacation_start / vacation_end (fechas 'AAAA-MM-DD', ambas
 * inclusive) se guardan en Cuenta › Disponibilidad. Este módulo puro decide:
 *   - si el artista está (o va a estar) de vacaciones → aviso "De vacaciones
 *     hasta…" en el perfil público;
 *   - qué días no se ofrecen en el cotizador (/quotation) ni en la propuesta
 *     del Job Board.
 * UMD: window.WoArtistVacation en el navegador, require() en los tests.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WoArtistVacation = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
        'septiembre', 'octubre', 'noviembre', 'diciembre'];
    // Aviso anticipado: el perfil avisa de vacaciones que empiezan en ≤ 30 días.
    var UPCOMING_DAYS = 30;

    function isoDay(value) {
        if (!value) return null;
        if (value instanceof Date) {
            if (isNaN(value.getTime())) return null;
            return value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-'
                + String(value.getDate()).padStart(2, '0');
        }
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
        return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
    }

    function addDays(iso, days) {
        var p = iso.split('-').map(Number);
        var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
        return d.toISOString().slice(0, 10);
    }

    /** Rango normalizado { start, end } o null si no hay vacaciones válidas. */
    function range(start, end) {
        var s = isoDay(start);
        var e = isoDay(end);
        if (!s && !e) return null;
        if (s && !e) e = s;
        if (!s && e) s = e;
        if (e < s) { var t = s; s = e; e = t; }
        return { start: s, end: e };
    }

    function fromArtist(artist) {
        return artist ? range(artist.vacation_start, artist.vacation_end) : null;
    }

    /** ¿El día (Date o 'AAAA-MM-DD') cae dentro de las vacaciones? */
    function isDateBlocked(day, vacation) {
        var d = isoDay(day);
        return !!(d && vacation && d >= vacation.start && d <= vacation.end);
    }

    /**
     * Estado para mostrar: 'active' (hoy dentro), 'upcoming' (empieza en ≤ 30
     * días), 'past'/'later' (no se muestra) o null.
     */
    function status(vacation, today) {
        if (!vacation) return null;
        var t = isoDay(today || new Date());
        if (t > vacation.end) return 'past';
        if (t >= vacation.start) return 'active';
        if (vacation.start <= addDays(t, UPCOMING_DAYS)) return 'upcoming';
        return 'later';
    }

    function longDay(iso) {
        var p = iso.split('-').map(Number);
        return p[2] + ' de ' + MONTHS[p[1] - 1];
    }

    /** Día siguiente al fin de las vacaciones ('AAAA-MM-DD'). */
    function returnDay(vacation) {
        return vacation ? addDays(vacation.end, 1) : null;
    }

    /** Texto del aviso público, o '' si no corresponde mostrarlo. */
    function notice(vacation, today) {
        var st = status(vacation, today);
        if (st === 'active') return 'De vacaciones hasta el ' + longDay(vacation.end);
        if (st === 'upcoming') {
            return vacation.start === vacation.end
                ? 'De vacaciones el ' + longDay(vacation.start)
                : 'De vacaciones del ' + longDay(vacation.start) + ' al ' + longDay(vacation.end);
        }
        return '';
    }

    return {
        UPCOMING_DAYS: UPCOMING_DAYS,
        isoDay: isoDay,
        range: range,
        fromArtist: fromArtist,
        isDateBlocked: isDateBlocked,
        status: status,
        returnDay: returnDay,
        longDay: longDay,
        notice: notice
    };
});
