/**
 * WE OTZI - Modelo puro de turnos disponibles (reservas online)
 * --------------------------------------------------------------
 * Calcula los turnos libres de un tatuador a partir de:
 *   - su horario semanal (user_preferences.app_settings.availability, el mismo
 *     que edita Cuenta → Disponibilidad; ver account-availability-model.js),
 *   - la ubicación vigente por fecha (artist_tattoo_locations: el destino
 *     Travel que cubre el día o, si no, la ubicación base; agenda 'closed' =
 *     sin turnos),
 *   - los intervalos ocupados (eventos que bloquean, sesiones, citas de
 *     estudio, viajes confirmados, vacaciones y apartados vigentes; los arma la
 *     base con list_artist_blocking_intervals),
 *   - las reglas del artista (duración, paso, margen, anticipación, horizonte).
 *
 * Todas las horas se calculan en la zona horaria del artista (con DST real vía
 * Intl) y se devuelven en ISO UTC. Sin DOM ni red.
 * Navegador: window.WoBookingSlots · Node: require().
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./account-availability-model.js'));
    } else {
        root.WoBookingSlots = factory(root.WoAccountAvailability);
    }
}(typeof self !== 'undefined' ? self : this, function (AV) {
    'use strict';

    var MIN = 60 * 1000;
    var HOUR = 60 * MIN;
    var DAY = 24 * HOUR;
    var DEFAULT_TZ = 'America/Argentina/Buenos_Aires';
    var DAY_KEYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

    // Decisión del dueño (beta cerrada): valores por defecto, configurables.
    var DEFAULTS = {
        enabled: false,
        slot_minutes: 180,
        slot_step_minutes: 60,
        buffer_minutes: 30,
        min_notice_hours: 24,
        horizon_days: 365,
        hold_hours: 72,
        public_note: null
    };
    // Mismos rangos que los CHECK de artist_booking_settings.
    var LIMITS = {
        slot_minutes: [30, 720],
        buffer_minutes: [0, 240],
        min_notice_hours: [0, 720],
        horizon_days: [7, 400],
        hold_hours: [1, 336]
    };
    var STEP_OPTIONS = [15, 30, 60, 90, 120, 180, 240];
    var HARD_KINDS = ['event', 'session', 'studio_booking'];

    /* ------------------------------ reglas ------------------------------ */

    function toInt(value) {
        var n = Number(value);
        return Number.isFinite(n) ? Math.round(n) : NaN;
    }

    function validateSettings(input) {
        var src = input || {};
        var errors = {};
        var out = {};
        Object.keys(LIMITS).forEach(function (key) {
            var raw = src[key] == null || src[key] === '' ? DEFAULTS[key] : src[key];
            var n = toInt(raw);
            var lim = LIMITS[key];
            if (!Number.isFinite(n) || n < lim[0] || n > lim[1]) errors[key] = 'Tiene que estar entre ' + lim[0] + ' y ' + lim[1] + '.';
            else out[key] = n;
        });
        var step = toInt(src.slot_step_minutes == null || src.slot_step_minutes === '' ? DEFAULTS.slot_step_minutes : src.slot_step_minutes);
        if (STEP_OPTIONS.indexOf(step) === -1) errors.slot_step_minutes = 'Elige un intervalo válido.';
        else out.slot_step_minutes = step;
        out.enabled = src.enabled === true || src.enabled === 'true' || src.enabled === 1 || src.enabled === '1';
        var note = src.public_note == null ? '' : String(src.public_note).trim();
        if (note.length > 280) errors.public_note = 'La nota pública admite hasta 280 caracteres.';
        out.public_note = note || null;
        return { ok: Object.keys(errors).length === 0, errors: errors, value: out };
    }

    // Para el cálculo: completa con defaults y fuerza los rangos (nunca lanza).
    function normalizeSettings(raw) {
        var src = raw || {};
        var out = {};
        Object.keys(DEFAULTS).forEach(function (key) { out[key] = src[key] == null ? DEFAULTS[key] : src[key]; });
        Object.keys(LIMITS).forEach(function (key) {
            var n = toInt(out[key]);
            var lim = LIMITS[key];
            out[key] = Number.isFinite(n) ? Math.min(lim[1], Math.max(lim[0], n)) : DEFAULTS[key];
        });
        var step = toInt(out.slot_step_minutes);
        out.slot_step_minutes = STEP_OPTIONS.indexOf(step) === -1 ? DEFAULTS.slot_step_minutes : step;
        out.enabled = !!out.enabled && out.enabled !== 'false';
        return out;
    }

    /* --------------------------- zona horaria --------------------------- */

    function validTimeZone(tz) {
        if (typeof tz !== 'string' || !tz) return false;
        try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
    }

    var fmtCache = {};
    function formatter(tz) {
        if (!fmtCache[tz]) {
            fmtCache[tz] = new Intl.DateTimeFormat('en-US', {
                timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
        }
        return fmtCache[tz];
    }

    function zonedParts(ms, tz) {
        var parts = formatter(tz).formatToParts(new Date(ms));
        var get = function (type) {
            for (var i = 0; i < parts.length; i++) if (parts[i].type === type) return Number(parts[i].value);
            return 0;
        };
        return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
    }

    function pad(n) { return String(n).padStart(2, '0'); }

    function zonedDate(value, tz) {
        var p = zonedParts(new Date(value).getTime(), tz);
        return p.y + '-' + pad(p.m) + '-' + pad(p.d);
    }

    function zonedTime(value, tz) {
        var p = zonedParts(new Date(value).getTime(), tz);
        return pad(p.h) + ':' + pad(p.mi);
    }

    function tzOffsetMs(ms, tz) {
        var whole = ms - (((ms % 1000) + 1000) % 1000);
        var p = zonedParts(whole, tz);
        return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - whole;
    }

    // Hora de pared local ('YYYY-MM-DD' + minutos desde medianoche) → ms UTC.
    // Respeta los cambios de horario (misma técnica que lib/gcal-sync).
    function wallToUtc(dateStr, minutes, tz) {
        var p = String(dateStr).split('-').map(Number);
        var guess = Date.UTC(p[0], p[1] - 1, p[2], 0, minutes || 0);
        var off = tzOffsetMs(guess, tz);
        var t = guess - off;
        var off2 = tzOffsetMs(t, tz);
        if (off2 !== off) t = guess - off2;
        return t;
    }

    function addDays(dateStr, n) {
        var p = String(dateStr).split('-').map(Number);
        var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
        return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
    }

    // 0 = lunes … 6 = domingo, de una fecha local 'YYYY-MM-DD'.
    function weekdayIndex(dateStr) {
        var p = String(dateStr).split('-').map(Number);
        return (new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() + 6) % 7;
    }

    function hhmmToMinutes(hhmm) {
        var m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || ''));
        return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    }

    /* ----------------------------- horario ------------------------------ */

    function isTravel(loc) { return !!loc && loc.period_type === 'upcoming'; }

    function baseLocation(locations) {
        var currents = (locations || []).filter(function (l) { return l && !isTravel(l); })
            .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
        return currents[0] || null;
    }

    // Destino Travel que cubre la fecha (el que empezó más tarde) o la base.
    function effectiveLocation(locations, dateStr) {
        var travel = (locations || []).filter(function (l) {
            return isTravel(l) && l.start_date && l.end_date
                && String(l.start_date).slice(0, 10) <= dateStr && String(l.end_date).slice(0, 10) >= dateStr;
        }).sort(function (a, b) { return String(b.start_date).localeCompare(String(a.start_date)); });
        return travel[0] || baseLocation(locations);
    }

    function hasStoredSchedule(availability) {
        if (!availability || typeof availability !== 'object') return false;
        if (availability.weekly) return true;
        var locs = availability.locations;
        return !!locs && Object.keys(locs).some(function (k) { return locs[k] && locs[k].weekly; });
    }

    // Horario semanal guardado para una ubicación. Un destino Travel sin horario
    // propio no hereda el de la base (no se ofrecen turnos ahí).
    function weeklyFor(availability, loc) {
        var av = availability || {};
        var stored = loc && av.locations && av.locations[loc.id];
        if (stored && stored.weekly) return AV.normalizeWeekly(stored.weekly);
        if (!isTravel(loc) && av.weekly) return AV.normalizeWeekly(av.weekly);
        return null;
    }

    /* --------------------------- intervalos ---------------------------- */

    function toMs(value) {
        if (typeof value === 'number') return value;
        var t = Date.parse(value);
        return Number.isFinite(t) ? t : NaN;
    }

    function normalizeBusy(busy) {
        return (busy || []).map(function (b) {
            return { s: toMs(b.start != null ? b.start : b.starts_at), e: toMs(b.end != null ? b.end : b.ends_at), kind: b.kind || 'event' };
        }).filter(function (b) { return Number.isFinite(b.s) && Number.isFinite(b.e) && b.e > b.s; })
            .sort(function (a, b) { return a.s - b.s; });
    }

    // Resta a [start, end) los intervalos ocupados (ya expandidos por el margen).
    function subtract(start, end, busy) {
        var out = [];
        var cursor = start;
        for (var i = 0; i < busy.length && cursor < end; i++) {
            var b = busy[i];
            if (b.e <= cursor || b.s >= end) continue;
            if (b.s > cursor) out.push({ s: cursor, e: Math.min(b.s, end) });
            cursor = Math.max(cursor, b.e);
        }
        if (cursor < end) out.push({ s: cursor, e: end });
        return out;
    }

    /* ------------------------------ cálculo ----------------------------- */

    /**
     * computeDays({ tz, from, to, now, settings, availability, locations, busy })
     *  → { reason, days: [{ date, open:{s,e}|null, windows:[{s,e}], slots:[{start,end}] }] }
     *
     * - from/to: instantes (ms o ISO) que acotan el rango pedido; se recorre por
     *   día local del artista.
     * - windows: huecos libres dentro del horario (después de la anticipación y
     *   de los ocupados con su margen). Son la base de la capacidad.
     * - slots: inicios candidatos cada `slot_step_minutes` desde la apertura,
     *   de `slot_minutes` de duración, que entran completos en un hueco.
     * - reason: 'disabled' | 'no_schedule' | null.
     */
    function computeDays(opts) {
        var o = opts || {};
        var tz = validTimeZone(o.tz) ? o.tz : DEFAULT_TZ;
        var s = normalizeSettings(o.settings);
        var now = Number.isFinite(toMs(o.now)) ? toMs(o.now) : Date.now();
        var result = { tz: tz, reason: null, days: [] };
        if (!o.ignoreEnabled && !s.enabled) { result.reason = 'disabled'; return result; }
        if (!hasStoredSchedule(o.availability)) { result.reason = 'no_schedule'; return result; }

        var earliest = now + s.min_notice_hours * HOUR;
        var latest = now + s.horizon_days * DAY; // último inicio posible
        var from = Math.max(Number.isFinite(toMs(o.from)) ? toMs(o.from) : now, now);
        var to = Math.min(Number.isFinite(toMs(o.to)) ? toMs(o.to) : latest + DAY, latest + DAY);
        if (to <= from) return result;

        var buffer = s.buffer_minutes * MIN;
        var dur = s.slot_minutes * MIN;
        var step = s.slot_step_minutes * MIN;
        var busy = normalizeBusy(o.busy);
        var locations = o.locations || [];

        var date = zonedDate(from, tz);
        var lastDate = zonedDate(to - 1, tz);
        var guard = 0;
        while (date <= lastDate && guard++ < 800) {
            var day = { date: date, open: null, windows: [], slots: [] };
            result.days.push(day);
            var loc = effectiveLocation(locations, date);
            var weekly = locations.length ? weeklyFor(o.availability, loc) : (o.availability && o.availability.weekly ? AV.normalizeWeekly(o.availability.weekly) : null);
            if (loc && loc.agenda_status === 'closed') weekly = null;
            var row = weekly ? weekly[weekdayIndex(date)] : null;
            var startMin = row && row.enabled ? hhmmToMinutes(row.start) : null;
            var endMin = row && row.enabled ? hhmmToMinutes(row.end) : null;
            if (startMin != null && endMin != null && endMin > startMin) {
                var openS = wallToUtc(date, startMin, tz);
                var openE = wallToUtc(date, endMin, tz);
                day.open = { s: openS, e: openE };
                var travelDay = isTravel(loc);
                // Los viajes confirmados no tapan los días de un destino Travel
                // con horario propio (es justamente donde se tatúa).
                var dayBusy = busy.filter(function (b) {
                    return !(travelDay && b.kind === 'trip') && b.s < openE + buffer && b.e > openS - buffer;
                }).map(function (b) {
                    // Viajes y vacaciones son días completos: sin margen.
                    var pad = b.kind === 'trip' || b.kind === 'vacation' ? 0 : buffer;
                    return { s: b.s - pad, e: b.e + pad };
                }).sort(function (a, b) { return a.s - b.s; });
                var windowStart = Math.max(openS, earliest);
                var windowEnd = openE;
                if (windowStart < windowEnd) {
                    day.windows = subtract(windowStart, windowEnd, dayBusy);
                    for (var t = openS; t + dur <= openE; t += step) {
                        if (t < earliest || t > latest) continue;
                        var fits = day.windows.some(function (w) { return t >= w.s && t + dur <= w.e; });
                        if (fits) day.slots.push({ start: new Date(t).toISOString(), end: new Date(t + dur).toISOString() });
                    }
                }
            }
            date = addDays(date, 1);
        }
        return result;
    }

    // Capacidad: turnos que entran sin superponerse (con margen entre turnos).
    function windowCapacity(win, settings) {
        var s = normalizeSettings(settings);
        var len = (win.e - win.s) / MIN;
        if (len < s.slot_minutes) return 0;
        return Math.floor((len + s.buffer_minutes) / (s.slot_minutes + s.buffer_minutes));
    }

    function tally(days, settings, fromMs, toMs) {
        var turnos = 0;
        var minutes = 0;
        (days || []).forEach(function (day) {
            (day.windows || []).forEach(function (w) {
                var s = Math.max(w.s, fromMs);
                var e = Math.min(w.e, toMs);
                if (e <= s) return;
                turnos += windowCapacity({ s: s, e: e }, settings);
                minutes += (e - s) / MIN;
            });
        });
        return { turnos: turnos, horasLibres: Math.round((minutes / 60) * 10) / 10 };
    }

    /**
     * summarize({ days, now, tz, settings })
     *  → { week, month, next3Months, year, nextSlot }
     * week = semana calendario actual (lunes a domingo), month = mes calendario
     * actual, next3Months = de hoy a 90 días, year = de hoy a 365 días. Siempre
     * desde ahora (lo pasado no cuenta).
     */
    function summarize(opts) {
        var o = opts || {};
        var tz = validTimeZone(o.tz) ? o.tz : DEFAULT_TZ;
        var now = Number.isFinite(toMs(o.now)) ? toMs(o.now) : Date.now();
        var today = zonedDate(now, tz);
        var weekStart = addDays(today, -weekdayIndex(today));
        var weekEnd = wallToUtc(addDays(weekStart, 7), 0, tz);
        var monthParts = today.split('-').map(Number);
        var nextMonth = monthParts[1] === 12 ? (monthParts[0] + 1) + '-01-01' : monthParts[0] + '-' + pad(monthParts[1] + 1) + '-01';
        var monthEnd = wallToUtc(nextMonth, 0, tz);
        var days = o.days || [];
        var nextSlot = null;
        for (var i = 0; i < days.length && !nextSlot; i++) {
            if (days[i].slots && days[i].slots.length) nextSlot = days[i].slots[0];
        }
        return {
            week: tally(days, o.settings, now, weekEnd),
            month: tally(days, o.settings, now, monthEnd),
            next3Months: tally(days, o.settings, now, now + 90 * DAY),
            year: tally(days, o.settings, now, now + 365 * DAY),
            nextSlot: nextSlot
        };
    }

    // Vista pública: solo inicio/fin y la etiqueta horaria local (sin nada más).
    function publicDays(days, tz) {
        var zone = validTimeZone(tz) ? tz : DEFAULT_TZ;
        return (days || []).filter(function (d) { return d.slots && d.slots.length; }).map(function (d) {
            return {
                date: d.date,
                slots: d.slots.map(function (sl) { return { start: sl.start, end: sl.end, label: zonedTime(sl.start, zone) }; })
            };
        });
    }

    function dayCounts(days) {
        return (days || []).filter(function (d) { return d.slots && d.slots.length; })
            .map(function (d) { return { date: d.date, count: d.slots.length }; });
    }

    // ¿El turno pedido (inicio ISO + minutos) está entre los ofrecidos?
    function isOffered(days, startIso, minutes, settings) {
        var s = normalizeSettings(settings);
        var start = toMs(startIso);
        if (!Number.isFinite(start) || Number(minutes) !== s.slot_minutes) return false;
        return (days || []).some(function (d) {
            return (d.slots || []).some(function (sl) { return toMs(sl.start) === start; });
        });
    }

    // "jue 20 nov 2026 · 15:00" en la zona del artista.
    var WEEKDAYS_SHORT = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
    var MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    function slotLabel(startIso, tz, endIso) {
        var zone = validTimeZone(tz) ? tz : DEFAULT_TZ;
        var ms = toMs(startIso);
        if (!Number.isFinite(ms)) return '';
        var date = zonedDate(ms, zone);
        var p = date.split('-').map(Number);
        var label = WEEKDAYS_SHORT[weekdayIndex(date)] + ' ' + p[2] + ' ' + MONTHS_SHORT[p[1] - 1] + ' ' + p[0] + ' · ' + zonedTime(ms, zone);
        if (endIso && Number.isFinite(toMs(endIso))) label += '–' + zonedTime(toMs(endIso), zone);
        return label;
    }

    return {
        DEFAULTS: DEFAULTS, LIMITS: LIMITS, STEP_OPTIONS: STEP_OPTIONS, HARD_KINDS: HARD_KINDS,
        DEFAULT_TZ: DEFAULT_TZ, DAY_KEYS: DAY_KEYS,
        validateSettings: validateSettings, normalizeSettings: normalizeSettings,
        validTimeZone: validTimeZone, zonedDate: zonedDate, zonedTime: zonedTime, wallToUtc: wallToUtc,
        addDays: addDays, weekdayIndex: weekdayIndex,
        effectiveLocation: effectiveLocation, hasStoredSchedule: hasStoredSchedule, weeklyFor: weeklyFor,
        subtract: subtract, computeDays: computeDays, windowCapacity: windowCapacity,
        summarize: summarize, publicDays: publicDays, dayCounts: dayCounts, isOffered: isOffered,
        slotLabel: slotLabel
    };
}));
