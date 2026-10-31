/**
 * WE OTZI - Modelo puro de "Disponibilidad por ubicación" (cuenta del artista)
 * --------------------------------------------------------------------------
 * Frames Figma 801:571 (vista) y 801:1110 (edición + confirmación).
 * Ubicaciones = filas de artist_tattoo_locations (period_type current/upcoming,
 * agenda_status open/closed). El horario semanal de cada ubicación vive en
 * user_preferences.app_settings.availability.locations[<location_id>].weekly;
 * el de la ubicación base también se espeja en availability.weekly (formato
 * histórico que leen otras pantallas).
 *
 * Sin DOM ni red. Navegador: window.WoAccountAvailability · Node: require().
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoAccountAvailability = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var DAYS = [
        ['lunes', 'Lunes'], ['martes', 'Martes'], ['miercoles', 'Miércoles'], ['jueves', 'Jueves'],
        ['viernes', 'Viernes'], ['sabado', 'Sábado'], ['domingo', 'Domingo']
    ];
    var WORKDAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'];
    var DEFAULT_START = '10:00';
    var DEFAULT_END = '19:00';
    var HALF_DAY_MAX_HOURS = 6;
    var MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    var CITY_SHORT = { 'ciudad de méxico': 'CDMX', 'ciudad de mexico': 'CDMX', 'buenos aires': 'CABA', 'nueva york': 'NYC', 'new york': 'NYC' };
    var COUNTRY_CODES = {
        'argentina': 'AR', 'méxico': 'MX', 'mexico': 'MX', 'alemania': 'DE', 'españa': 'ES', 'espana': 'ES', 'chile': 'CL',
        'uruguay': 'UY', 'perú': 'PE', 'peru': 'PE', 'colombia': 'CO', 'brasil': 'BR', 'estados unidos': 'US',
        'francia': 'FR', 'italia': 'IT', 'portugal': 'PT', 'reino unido': 'GB'
    };

    function isTime(value) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '')); }
    function minutes(hhmm) { var p = String(hhmm).split(':'); return (+p[0]) * 60 + (+p[1] || 0); }

    function defaultWeekly() {
        return DAYS.map(function (d) { return { day: d[0], enabled: WORKDAYS.indexOf(d[0]) !== -1, start: DEFAULT_START, end: DEFAULT_END }; });
    }

    // Acepta el formato histórico [{day, enabled, start, end}] (7 filas en orden)
    // o un objeto { lunes: {...} }. Lo que falte toma el default.
    function normalizeWeekly(stored) {
        var base = defaultWeekly();
        if (!stored) return base;
        return base.map(function (row, i) {
            var src = Array.isArray(stored)
                ? (stored.find && stored.find(function (s) { return s && s.day === row.day; })) || stored[i]
                : stored[row.day];
            if (!src || typeof src !== 'object') return row;
            return {
                day: row.day,
                enabled: !!src.enabled,
                start: isTime(src.start) ? src.start : row.start,
                end: isTime(src.end) ? src.end : row.end
            };
        });
    }

    function dayHours(row) {
        if (!row || !row.enabled || !isTime(row.start) || !isTime(row.end)) return 0;
        var diff = minutes(row.end) - minutes(row.start);
        return diff > 0 ? diff / 60 : 0;
    }
    function weeklyHours(weekly) {
        var total = (weekly || []).reduce(function (sum, row) { return sum + dayHours(row); }, 0);
        return Math.round(total * 10) / 10;
    }
    function activeDays(weekly) { return (weekly || []).filter(function (r) { return r.enabled; }).length; }
    function isHalfDay(row) { var h = dayHours(row); return h > 0 && h <= HALF_DAY_MAX_HOURS; }

    function validateWeekly(weekly) {
        var errors = [];
        (weekly || []).forEach(function (row) {
            if (!row.enabled) return;
            var label = (DAYS.find(function (d) { return d[0] === row.day; }) || [row.day, row.day])[1];
            if (!isTime(row.start) || !isTime(row.end)) errors.push(label + ': completá el horario.');
            else if (minutes(row.end) <= minutes(row.start)) errors.push(label + ': la hora de fin tiene que ser posterior al inicio.');
        });
        return errors;
    }

    function toDate(value) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
        return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    }
    // "12 — 26 oct 2026" · "28 oct — 3 nov 2026" · "20 dic 2026 — 4 ene 2027"
    function formatRange(start, end) {
        var a = toDate(start), b = toDate(end);
        if (!a && !b) return '';
        if (!a || !b) { var d = a || b; return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
        if (a.getFullYear() !== b.getFullYear()) {
            return a.getDate() + ' ' + MONTHS[a.getMonth()] + ' ' + a.getFullYear() + ' — ' + b.getDate() + ' ' + MONTHS[b.getMonth()] + ' ' + b.getFullYear();
        }
        if (a.getMonth() !== b.getMonth()) {
            return a.getDate() + ' ' + MONTHS[a.getMonth()] + ' — ' + b.getDate() + ' ' + MONTHS[b.getMonth()] + ' ' + b.getFullYear();
        }
        return a.getDate() + ' — ' + b.getDate() + ' ' + MONTHS[b.getMonth()] + ' ' + b.getFullYear();
    }

    function countryCode(loc) {
        var raw = String(loc && (loc.country_code || loc.country) || '').trim();
        if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
        return COUNTRY_CODES[raw.toLowerCase()] || '';
    }

    function isTravel(loc) { return loc && loc.period_type === 'upcoming'; }
    function isPaused(loc) { return loc && loc.agenda_status === 'closed'; }
    function isWaitlist(loc) { return loc && loc.agenda_status === 'waitlist'; }

    // Badge del encabezado oscuro. 'waitlist' = "Lista de espera"
    // (migración 20261028160000_artist_residency_country_waitlist.sql).
    function statusLabel(status) {
        if (status === 'closed') return 'Pausada';
        if (status === 'waitlist') return 'Lista de espera';
        return 'Activa';
    }

    // Etiqueta de la pestaña: ESTUDIO BASE · ESTUDIO PRIVADO · ESTUDIO · TRAVEL.
    function locationKind(loc, locations) {
        if (isTravel(loc)) return 'Travel';
        var currents = (locations || []).filter(function (l) { return !isTravel(l); })
            .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
        if (!currents.length || currents[0] === loc || currents[0].id === loc.id) return 'Estudio base';
        return loc.studio_id ? 'Estudio' : 'Estudio privado';
    }

    // Título visible: estudios → nombre del estudio; Travel → "Ciudad, CC".
    function locationTitle(loc) {
        if (!loc) return '';
        if (isTravel(loc)) {
            var cc = countryCode(loc);
            var city = String(loc.city || '').trim() || String(loc.studio_name || '').trim();
            return cc ? city + ', ' + cc : city;
        }
        var name = String(loc.studio_name || '').trim();
        if (name) return name;
        return loc.city ? 'Estudio propio — ' + loc.city : 'Estudio propio';
    }

    // Detalle bajo el título del encabezado oscuro: "Tinta Negra Studio · Roma Norte".
    function locationDetail(loc) {
        if (!loc) return '';
        var parts = [];
        if (isTravel(loc)) {
            if (loc.studio_name) parts.push(loc.studio_name);
            if (loc.neighborhood || loc.locality) parts.push(loc.neighborhood || loc.locality);
        } else {
            if (loc.address || loc.formatted_address) parts.push(loc.address || loc.formatted_address);
            else if (loc.city) parts.push(loc.city);
        }
        return parts.filter(Boolean).join(' · ');
    }

    function vigencia(loc) {
        if (isTravel(loc)) return formatRange(loc.start_date, loc.end_date);
        return 'Permanente';
    }

    // "5 días · Permanente" · "6 días · 12 — 26 oct 2026" · "Pausada"
    function locationSubtitle(loc, weekly) {
        if (isPaused(loc)) return 'Pausada';
        if (isWaitlist(loc)) return 'Lista de espera · ' + vigencia(loc);
        var n = activeDays(weekly);
        return n + (n === 1 ? ' día' : ' días') + ' · ' + vigencia(loc);
    }

    function cityShort(loc) {
        var city = String(loc && loc.city || '').trim();
        if (!city) return '';
        return CITY_SHORT[city.toLowerCase()] || city.toUpperCase();
    }

    function sortLocations(locations) {
        return (locations || []).slice().sort(function (a, b) {
            var ta = isTravel(a) ? 1 : 0, tb = isTravel(b) ? 1 : 0;
            if (ta !== tb) return ta - tb;
            if (ta) return String(a.start_date || '').localeCompare(String(b.start_date || ''));
            return (a.sort_order || 0) - (b.sort_order || 0);
        });
    }

    // Ubicación inicial: la Travel vigente hoy; si no, la primera abierta.
    function defaultLocation(locations, todayIso) {
        var today = String(todayIso || new Date().toISOString()).slice(0, 10);
        var list = sortLocations(locations);
        var current = list.find(function (l) { return isTravel(l) && !isPaused(l) && l.start_date <= today && l.end_date >= today; });
        return current || list.find(function (l) { return !isPaused(l); }) || list[0] || null;
    }

    // Horario guardado de una ubicación (o el histórico para la base).
    function scheduleFor(availability, loc, isBase) {
        var stored = availability && availability.locations && loc && availability.locations[loc.id];
        if (stored && stored.weekly) return normalizeWeekly(stored.weekly);
        if (isBase && availability && availability.weekly) return normalizeWeekly(availability.weekly);
        return defaultWeekly();
    }

    // Patch de app_settings.availability tras guardar una ubicación.
    function availabilityPatch(availability, loc, weekly, isBase) {
        var next = Object.assign({}, availability || {});
        next.locations = Object.assign({}, (availability && availability.locations) || {});
        next.locations[loc.id] = { weekly: normalizeWeekly(weekly), updated_at: new Date().toISOString() };
        if (isBase) next.weekly = normalizeWeekly(weekly);
        return next;
    }

    function validateUpcoming(input, todayIso) {
        var errors = {};
        if (!String(input && input.city || '').trim()) errors.city = 'Ingresá la ciudad.';
        if (!String(input && input.studioName || '').trim()) errors.studioName = 'Ingresá el estudio o lugar.';
        var start = String(input && input.startDate || ''), end = String(input && input.endDate || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) errors.dates = 'Elegí las fechas de inicio y fin.';
        else if (end < start) errors.dates = 'La fecha de fin tiene que ser posterior al inicio.';
        else if (todayIso && end < String(todayIso).slice(0, 10)) errors.dates = 'El destino ya terminó.';
        return { ok: Object.keys(errors).length === 0, errors: errors };
    }

    return {
        DAYS: DAYS, WORKDAYS: WORKDAYS, HALF_DAY_MAX_HOURS: HALF_DAY_MAX_HOURS,
        defaultWeekly: defaultWeekly, normalizeWeekly: normalizeWeekly, dayHours: dayHours,
        weeklyHours: weeklyHours, activeDays: activeDays, isHalfDay: isHalfDay, validateWeekly: validateWeekly,
        formatRange: formatRange, countryCode: countryCode, isTravel: isTravel, isPaused: isPaused,
        isWaitlist: isWaitlist, statusLabel: statusLabel,
        locationKind: locationKind, locationTitle: locationTitle, locationDetail: locationDetail,
        vigencia: vigencia, locationSubtitle: locationSubtitle, cityShort: cityShort,
        sortLocations: sortLocations, defaultLocation: defaultLocation, scheduleFor: scheduleFor,
        availabilityPatch: availabilityPatch, validateUpcoming: validateUpcoming
    };
}));
