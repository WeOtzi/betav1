/**
 * WE ÖTZI · Cotizador /quotation · ronda 2 (frente cot-form) — lógica pura.
 * ---------------------------------------------------------------------------
 * Sin DOM ni red: lo usan public/shared/js/quotation-r2.js (interfaz),
 * public/shared/js/script.js (wizard) y los tests (node:test).
 *
 *   edad            birthStatus · birthYears · parse/format de la fecha del wizard
 *   rango de fecha  pickRangeDay · rangeLabel · isInRange
 *   código corto    displayCode
 *   sugeridos       suggestionTags · suggestionBadges · portfolioItems
 *   sedes           locationLabel · locationDates
 *   beneficios      ACCOUNT_BENEFITS · COMING_SOON_BENEFITS
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WoQuotationR2Model = api;
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    var MIN_AGE = 14;
    var ADULT_AGE = 18;
    var MAX_AGE = 100;
    var MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    var MONTHS_LONG = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    var MONTHS_LOWER = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

    function pad(n) { return String(n).padStart(2, '0'); }

    function todayParts(now) {
        var d = now instanceof Date ? now : new Date();
        return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
    }

    function daysInMonth(year, month) {
        if (!year || !month) return 31;
        return new Date(year, month, 0).getDate();
    }

    // ---------- Fecha de nacimiento ----------
    // El wizard guarda "20 Dic 1990" (lo que ya parsea preparePayload).
    function parseBirthDate(value) {
        var empty = { day: null, month: null, year: null };
        if (!value || typeof value !== 'string') return empty;
        var iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
        if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
        var parts = value.trim().toLowerCase().split(/\s+/);
        if (parts.length !== 3) return empty;
        var month = MONTHS_LOWER.indexOf(parts[1].slice(0, 3)) + 1;
        var day = parseInt(parts[0], 10);
        var year = parseInt(parts[2], 10);
        if (!month || !Number.isInteger(day) || !Number.isInteger(year)) return empty;
        return { day: day, month: month, year: year };
    }

    function formatBirthDate(parts) {
        if (!parts || !parts.day || !parts.month || !parts.year) return null;
        return parts.day + ' ' + MONTHS_SHORT[parts.month - 1] + ' ' + parts.year;
    }

    /**
     * Estado de la fecha de nacimiento elegida.
     *   complete  están día, mes y año
     *   valid     la fecha existe y permite cotizar (14 años o más)
     *   tooYoung  menos de 14: no se puede elegir
     *   minor     entre 14 y 17: se puede, con aviso de autorización
     */
    function birthStatus(parts, now) {
        var p = parts || {};
        var out = { complete: false, valid: false, age: null, tooYoung: false, minor: false, real: false };
        if (!p.day || !p.month || !p.year) return out;
        out.complete = true;
        if (p.month < 1 || p.month > 12 || p.day < 1 || p.day > daysInMonth(p.year, p.month)) return out;
        out.real = true;
        var t = todayParts(now);
        var age = t.year - p.year;
        if (t.month < p.month || (t.month === p.month && t.day < p.day)) age -= 1;
        if (age < 0 || age > 120) return out;
        out.age = age;
        out.tooYoung = age < MIN_AGE;
        out.minor = age >= MIN_AGE && age < ADULT_AGE;
        out.valid = age >= MIN_AGE;
        return out;
    }

    // Años elegibles: del más reciente que ya cumple 14 hacia atrás.
    function birthYears(now) {
        var t = todayParts(now);
        var years = [];
        for (var y = t.year - MIN_AGE; y >= t.year - MAX_AGE; y--) years.push(y);
        return years;
    }

    // ---------- Rango de fechas tentativo ----------
    function isIso(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value); }

    /**
     * Un toque en el calendario. Primer toque: inicio. Segundo toque posterior:
     * fin del rango. Toque anterior al inicio: nuevo inicio. Con el rango
     * completo, un toque empieza otro.
     */
    function pickRangeDay(state, iso) {
        var start = state && isIso(state.start) ? state.start : null;
        var end = state && isIso(state.end) ? state.end : null;
        if (!isIso(iso)) return { start: start, end: end };
        if (!start || end) return { start: iso, end: null };
        if (iso < start) return { start: iso, end: null };
        if (iso === start) return { start: start, end: null };
        return { start: start, end: iso };
    }

    function isoLabel(iso) {
        if (!isIso(iso)) return '';
        var p = iso.split('-').map(Number);
        return p[2] + ' ' + MONTHS_SHORT[p[1] - 1] + ' ' + p[0];
    }

    function rangeLabel(start, end) {
        if (!isIso(start)) return '';
        if (!isIso(end) || end === start) return isoLabel(start);
        return isoLabel(start) + ' – ' + isoLabel(end);
    }

    // 'start' | 'end' | 'between' | null
    function rangePosition(iso, start, end) {
        if (!isIso(iso) || !isIso(start)) return null;
        if (iso === start) return 'start';
        if (!isIso(end)) return null;
        if (iso === end) return 'end';
        return iso > start && iso < end ? 'between' : null;
    }

    // ---------- Código corto ----------
    function displayCode(row) {
        var code = row && row.short_code;
        if (typeof code === 'string' && /^[2-9A-HJKMNP-Z]{6}$/.test(code)) return code;
        var id = String((row && row.quote_id) || '').replace(/[^0-9a-z]/gi, '');
        return id ? id.slice(-6).toUpperCase() : '';
    }

    // ---------- Artistas sugeridos ----------
    // Solo se muestra lo que el artista SÍ cumple; cada etiqueta con su color.
    function suggestionTags(s) {
        var tags = [];
        var match = (s && s.match) || {};
        if (match.style === 'exact') tags.push({ key: 'style', tone: 'style', label: 'Trabaja tu estilo' });
        else if (match.style === 'partial') tags.push({ key: 'style', tone: 'style-soft', label: 'Estilo afín' });
        if (match.location === 'city') tags.push({ key: 'place', tone: 'place', label: 'En tu ciudad' });
        else if (match.location === 'near') tags.push({ key: 'place', tone: 'place', label: match.distance_km ? 'A ' + match.distance_km + ' km' : 'Cerca de ti' });
        else if (match.location === 'country') tags.push({ key: 'place', tone: 'place', label: 'En tu país' });
        if (match.budget === 'within') tags.push({ key: 'budget', tone: 'budget', label: 'Dentro de tu presupuesto' });
        return tags;
    }

    function suggestionBadges(s) {
        var badges = [];
        if (s && s.recommended === true) badges.push({ key: 'recommended', label: 'Recomendado', icon: 'star' });
        if (s && s.ambassador === true) badges.push({ key: 'ambassador', label: 'Embajador', icon: 'award' });
        return badges;
    }

    function httpsUrl(value) {
        return typeof value === 'string' && /^https:\/\//i.test(value) ? value : '';
    }

    function portfolioItems(s, limit) {
        var out = [];
        var list = s && Array.isArray(s.portfolio) ? s.portfolio : [];
        for (var i = 0; i < list.length && out.length < (limit || 12); i++) {
            var item = list[i];
            var url = httpsUrl(typeof item === 'string' ? item : item && item.url);
            if (!url) continue;
            var caption = item && typeof item.caption === 'string' ? item.caption.trim().slice(0, 140) : '';
            out.push({ url: url, caption: caption });
        }
        return out;
    }

    // ---------- Sedes ----------
    function shortDay(iso, withYear) {
        if (!isIso(iso)) return '';
        var p = iso.split('-').map(Number);
        return p[2] + ' ' + MONTHS_LOWER[p[1] - 1] + (withYear ? ' ' + p[0] : '');
    }

    function locationDates(option) {
        if (!option || !isIso(option.to)) return '';
        if (!isIso(option.from)) return 'hasta el ' + shortDay(option.to, true);
        var sameYear = option.from.slice(0, 4) === option.to.slice(0, 4);
        return 'del ' + shortDay(option.from, !sameYear) + ' al ' + shortDay(option.to, true);
    }

    function locationKind(option) {
        if (!option) return '';
        if (option.type === 'trip') return 'Viaje';
        if (option.from || option.to) return 'Temporada';
        if (option.type === 'studio_location') return 'Estudio';
        return 'Base';
    }

    // ---------- Beneficios de tener cuenta ----------
    var ACCOUNT_BENEFITS = [
        { icon: 'eye', title: 'Sigue tu solicitud', text: 'Mira el estado y la propuesta del artista en tiempo real.' },
        { icon: 'message-circle', title: 'Chat con el artista', text: 'Resuelve dudas y comparte más referencias sin salir de We Ötzi.' },
        { icon: 'calendar', title: 'Agenda y recordatorios', text: 'Tus sesiones y avisos en un solo lugar.' },
        { icon: 'repeat', title: 'Cotiza con otro artista', text: 'Reutiliza esta misma solicitud sin volver a llenar tus datos.' },
        { icon: 'clock', title: 'Historial', text: 'Todas tus cotizaciones guardadas en tu cuenta.' }
    ];
    // Todavía sin sistema detrás: se anuncian como próximos, sin prometer fecha.
    var COMING_SOON_BENEFITS = [
        { icon: 'tag', title: 'Cupones de descuento', text: 'Descuentos para usar con artistas de la comunidad.' },
        { icon: 'credit-card', title: 'Financiamiento', text: 'Opciones para pagar tu tatuaje en cuotas.' }
    ];

    return {
        MIN_AGE: MIN_AGE,
        ADULT_AGE: ADULT_AGE,
        MONTHS_SHORT: MONTHS_SHORT,
        MONTHS_LONG: MONTHS_LONG,
        daysInMonth: daysInMonth,
        parseBirthDate: parseBirthDate,
        formatBirthDate: formatBirthDate,
        birthStatus: birthStatus,
        birthYears: birthYears,
        pickRangeDay: pickRangeDay,
        rangeLabel: rangeLabel,
        rangePosition: rangePosition,
        isoLabel: isoLabel,
        displayCode: displayCode,
        suggestionTags: suggestionTags,
        suggestionBadges: suggestionBadges,
        portfolioItems: portfolioItems,
        locationDates: locationDates,
        locationKind: locationKind,
        ACCOUNT_BENEFITS: ACCOUNT_BENEFITS,
        COMING_SOON_BENEFITS: COMING_SOON_BENEFITS,
        pad: pad
    };
});
