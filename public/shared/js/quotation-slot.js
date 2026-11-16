/**
 * WE OTZI - Turno elegido en el cotizador /quotation (frente "turnos")
 * --------------------------------------------------------------------
 * Contrato de URL (lo genera /turnos y el perfil público):
 *   /quotation?artist=<usuario>&slot=<ISO UTC>&dur=<min>
 * También acepta ?date=YYYY-MM-DD[&time=HH:MM] (precarga el día y, si el
 * artista tiene reservas online y ese horario está libre, el turno).
 *
 * script.js llama a estos hooks (cambios acotados para convivir con el
 * frente "cot-form"):
 *   captureFromUrl(params)          · initApp
 *   onArtist(formData)              · handleUrlArtist, con el artista cargado
 *   cardHtml(formData)              · paso Fecha (tarjeta "Turno elegido")
 *   daySlotsHtml(formData)          · bajo el calendario (horarios del día)
 *   busyIndex(formData, y, m)       · días con/sin turnos (CAL-09)
 *   onDatePicked(iso)               · el cliente eligió otro día a mano
 *   payload(formData, mode)         · body.requested_slot solo en 'submit'
 *   handleSubmitError(err, retry)   · 409 slot_taken → alternativas
 *
 * El servidor valida el turno y crea el apartado de forma atómica; aquí solo
 * se precarga, se muestra y se envía.
 */
(function () {
    'use strict';

    var DAY_MS = 86400000;
    var pending = null;          // { slot, dur, date, time } de la URL
    var booking = {};            // username → { enabled, slot_minutes, timezone, months: { 'YYYY-MM': {date:count} | Promise } }
    var daySlots = {};           // 'username:YYYY-MM-DD' → [{start,end,label}] | Promise
    var form = null;             // formData de script.js

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function repo() { return window.WeotziData && window.WeotziData.Booking; }
    function pad(n) { return String(n).padStart(2, '0'); }
    function appUrl(path) {
        var base = window.WEOTZI_BASE_PATH ? String(window.WEOTZI_BASE_PATH).replace(/\/$/, '')
            : (/^\/beta(?:\/|$)/.test(String(window.location.pathname || '')) ? '/beta' : '');
        return base + path;
    }
    function rerenderDate() {
        if (typeof window.renderInlineCalendar === 'function') { try { window.renderInlineCalendar(); } catch (e) { /* paso no visible */ } }
        var card = document.getElementById('q-slot-card-host');
        if (card) card.innerHTML = cardInner(form);
    }
    function persist() {
        if (typeof window.persistAnswer === 'function') { try { window.persistAnswer(); } catch (e) { /* noop */ } }
    }
    function toast(msg) {
        if (typeof window.showToastMessage === 'function') { try { window.showToastMessage(msg); return; } catch (e) { /* noop */ } }
    }
    function username(fd) { return String((fd && fd.artist_username) || '').replace(/^@+/, ''); }

    function captureFromUrl(params) {
        var slot = params.get('slot');
        var dur = Number(params.get('dur'));
        var date = params.get('date') || params.get('fecha');
        var time = params.get('time') || params.get('hora');
        if (slot && Number.isFinite(Date.parse(slot))) pending = { slot: new Date(Date.parse(slot)).toISOString(), dur: Number.isInteger(dur) ? dur : null };
        else if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) pending = { date: date, time: /^\d{2}:\d{2}$/.test(time || '') ? time : null };
        return pending;
    }

    function setSlot(fd, slot, info) {
        fd.requested_slot = {
            start: slot.start, end: slot.end, minutes: info.slot_minutes,
            label: slot.fullLabel || slot.label, timezone: info.timezone, date: slot.date
        };
        fd._preferred_date_iso = slot.date;
        fd.client_preferred_date = fd.requested_slot.label;
        fd.client_flexible_dates = false;
    }

    function clearSlot(fd) {
        if (!fd || !fd.requested_slot) return;
        delete fd.requested_slot;
    }

    function fullLabel(day, slot, info) {
        if (window.WoBookingSlots && window.WoBookingSlots.slotLabel) return window.WoBookingSlots.slotLabel(slot.start, info.timezone, slot.end);
        return day + ' · ' + slot.label;
    }

    // Turnos de un rango con fecha local del artista en cada uno.
    function fetchSlots(u, fromMs, toMs) {
        return repo().publicSlots(u, { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), granularity: 'slot' })
            .then(function (res) {
                var info = booking[u] = booking[u] || {};
                info.enabled = !!res.enabled;
                info.slot_minutes = res.slot_minutes;
                info.timezone = res.timezone;
                var out = [];
                (res.days || []).forEach(function (d) {
                    (d.slots || []).forEach(function (s) {
                        var item = { start: s.start, end: s.end, label: s.label, date: d.date };
                        item.fullLabel = fullLabel(d.date, item, info);
                        out.push(item);
                    });
                });
                return { info: info, slots: out };
            });
    }

    var MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

    // Precarga solo el día (sin turno): mismo formato que el calendario del paso
    // Fecha ("23 nov 2026"), sin fechas pasadas (CC-10).
    function applyDate(fd, iso) {
        if (!fd || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return;
        var t = new Date();
        if (iso < t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate())) return;
        if (typeof window.pickCalendarDay === 'function') {
            try { window.pickCalendarDay(iso); return; } catch (e) { /* paso no visible: se completa abajo */ }
        }
        var p = iso.split('-').map(Number);
        fd._preferred_date_iso = iso;
        fd.client_preferred_date = p[2] + ' ' + MONTHS_SHORT[p[1] - 1] + ' ' + p[0];
        fd.client_flexible_dates = false;
        persist();
    }

    // Día local del artista de un turno de la URL (para precargar al menos la fecha).
    function slotDate(want, info) {
        if (!want) return null;
        if (want.date) return want.date;
        if (want.slot && window.WoBookingSlots && info && info.timezone) {
            try { return window.WoBookingSlots.zonedDate(want.slot, info.timezone); } catch (e) { return null; }
        }
        return null;
    }

    // Con el artista cargado: info de reservas + validación del turno de la URL.
    function onArtist(fd) {
        form = fd;
        var u = username(fd);
        var want = pending;
        pending = null;
        if (!u || !repo()) {
            if (want && want.date) applyDate(fd, want.date);
            return Promise.resolve();
        }
        var center = want && want.slot ? Date.parse(want.slot)
            : want && want.date ? Date.parse(want.date + 'T12:00:00Z') : Date.now();
        var from = Math.max(Date.now(), center - DAY_MS);
        return fetchSlots(u, from, from + 2 * DAY_MS + (want ? 0 : DAY_MS)).then(function (r) {
            if (!want) { rerenderDate(); return; }
            if (!r.info.enabled) {
                applyDate(fd, slotDate(want, r.info));
                if (want.slot) toast('Este artista no está tomando reservas online. Elige una fecha y te propone horario.');
                rerenderDate();
                return;
            }
            var match = null;
            if (want.slot) match = r.slots.find(function (s) { return s.start === want.slot; });
            else if (want.date && want.time) match = r.slots.find(function (s) { return s.date === want.date && s.label === want.time; });
            if (match && (!want.dur || want.dur === r.info.slot_minutes)) {
                setSlot(fd, match, r.info);
            } else {
                clearSlot(fd);
                applyDate(fd, slotDate(want, r.info));
                if (want.slot || want.time) toast('Ese turno ya no está disponible. Elige otro horario del artista.');
            }
            persist();
            rerenderDate();
        }).catch(function () {
            // Sin servidor: el formulario sigue como siempre, con el día de la URL.
            if (want && want.date) applyDate(fd, want.date);
        });
    }

    function cardInner(fd) {
        var s = fd && fd.requested_slot;
        if (!s) return '';
        var u = username(fd);
        return '<div class="bk-slot-card bk-slot-card--held" role="group" aria-label="Turno elegido">' +
            '<p class="bk-eyebrow">Turno elegido</p>' +
            '<p class="bk-slot-when">' + esc(s.label) + '</p>' +
            '<p class="bk-slot-meta">Hora del artista (' + esc(s.timezone || '') + '). Al enviar, el turno queda apartado mientras el artista responde.</p>' +
            '<div class="bk-btn-row">' +
                (u ? '<a class="wo-btn wo-btn--secondary wo-btn--s" href="' + esc(appUrl('/turnos?artist=' + encodeURIComponent(u))) + '">Cambiar turno</a>' : '') +
                '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" onclick="window.WoQuotationSlot.removeSlot()">Quitar turno</button>' +
            '</div></div>';
    }

    function cardHtml(fd) {
        form = fd || form;
        return '<div id="q-slot-card-host">' + cardInner(fd) + '</div>';
    }

    function removeSlot() {
        if (!form) return;
        clearSlot(form);
        var iso = form._preferred_date_iso;
        // Queda el día elegido, sin horario (mismo formato que el calendario).
        if (iso && typeof window.pickCalendarDay === 'function') { window.pickCalendarDay(iso); }
        else { form.client_preferred_date = null; persist(); }
        rerenderDate();
    }

    // Días con turnos para el mes visible (solo si el artista tiene reservas online).
    // Devuelve undefined → usar la RPC de días ocupados; null → cargando.
    function busyIndex(fd, year, month) {
        form = fd || form;
        var u = username(fd);
        var info = u && booking[u];
        if (!info || !info.enabled || !repo()) return undefined;
        info.months = info.months || {};
        var key = year + '-' + pad(month + 1);
        var cached = info.months[key];
        if (cached && typeof cached.then !== 'function') return cached;
        if (!cached) {
            var from = Math.max(Date.now(), Date.UTC(year, month, 1) - DAY_MS);
            var to = Date.UTC(year, month + 1, 1) + DAY_MS;
            if (to <= from) { info.months[key] = {}; return info.months[key]; }
            info.months[key] = repo().publicSlots(u, { from: new Date(from).toISOString(), to: new Date(to).toISOString(), granularity: 'day' })
                .then(function (res) {
                    var counts = {};
                    (res.days || []).forEach(function (d) { counts[d.date] = d.count; });
                    var index = {};
                    var days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
                    var today = new Date();
                    var todayIso = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
                    for (var d = 1; d <= days; d++) {
                        var iso = key + '-' + pad(d);
                        if (iso < todayIso) continue;
                        index[iso] = counts[iso] ? 'available' : 'full';
                    }
                    info.months[key] = index;
                    rerenderDate();
                    return index;
                }).catch(function () { info.months[key] = {}; return {}; });
        }
        return null;
    }

    function slotsForDay(u, iso) {
        var key = u + ':' + iso;
        var cached = daySlots[key];
        if (cached && typeof cached.then !== 'function') return cached;
        if (!cached) {
            var center = Date.parse(iso + 'T12:00:00Z');
            daySlots[key] = fetchSlots(u, Math.max(Date.now(), center - DAY_MS), center + DAY_MS).then(function (r) {
                daySlots[key] = r.slots.filter(function (s) { return s.date === iso; });
                rerenderDate();
                return daySlots[key];
            }).catch(function () { daySlots[key] = []; return []; });
        }
        return null;
    }

    // Horarios del día elegido (solo con reservas online activas).
    function daySlotsHtml(fd) {
        form = fd || form;
        var u = username(fd);
        var info = u && booking[u];
        var iso = fd && fd._preferred_date_iso;
        if (!info || !info.enabled || !iso) return '';
        var slots = slotsForDay(u, iso);
        if (slots === null) return '<div class="q-cal-slots"><p class="bk-note">Buscando horarios…</p></div>';
        if (!slots.length) return '<div class="q-cal-slots"><p class="bk-note">Ese día no tiene turnos libres. Puedes enviar la solicitud de todos modos y el artista te propone horario.</p></div>';
        var chosen = fd.requested_slot && fd.requested_slot.start;
        return '<div class="q-cal-slots"><p class="bk-eyebrow" id="q-cal-slots-title">Turnos de ese día</p>' +
            '<ul class="bk-chips" aria-labelledby="q-cal-slots-title">' + slots.map(function (s) {
                return '<li><button type="button" class="bk-chip" aria-pressed="' + (chosen === s.start) + '" onclick="window.WoQuotationSlot.pickSlot(\'' + esc(s.start) + '\')">' + esc(s.label) + '</button></li>';
            }).join('') + '</ul>' +
            '<p class="bk-note">Opcional: elige un horario y queda apartado al enviar. Hora del artista (' + esc(info.timezone || '') + ').</p></div>';
    }

    function pickSlot(start) {
        if (!form) return;
        var u = username(form);
        var iso = form._preferred_date_iso;
        var slots = daySlots[u + ':' + iso];
        var info = booking[u];
        if (!Array.isArray(slots) || !info) return;
        var slot = slots.find(function (s) { return s.start === start; });
        if (!slot) return;
        if (form.requested_slot && form.requested_slot.start === start) { removeSlot(); return; }
        setSlot(form, slot, info);
        persist();
        rerenderDate();
    }

    // El cliente eligió otro día o un chip de fecha: el turno deja de valer.
    function onDatePicked(iso) {
        if (form && form.requested_slot && form.requested_slot.date !== iso) clearSlot(form);
    }

    function payload(fd, mode) {
        if (mode !== 'submit' || !fd || !fd.requested_slot) return {};
        return { requested_slot: { start: fd.requested_slot.start, minutes: fd.requested_slot.minutes } };
    }

    // Antes de subir referencias: ¿el turno sigue ofrecido? Si no, el mismo
    // error que el 409 del servidor (con alternativas cercanas).
    function precheck(fd) {
        var s = fd && fd.requested_slot;
        var u = username(fd);
        if (!s || !u || !repo()) return Promise.resolve();
        var start = Date.parse(s.start);
        return fetchSlots(u, Math.max(Date.now(), start - DAY_MS), start + 3 * DAY_MS).then(function (r) {
            if (!r.info.enabled) {
                throw Object.assign(new Error('Este artista no está tomando reservas online.'), { code: 'booking_disabled', payload: {} });
            }
            if (r.slots.some(function (x) { return x.start === s.start; })) return;
            var alts = r.slots.slice().sort(function (a, b) {
                return Math.abs(Date.parse(a.start) - start) - Math.abs(Date.parse(b.start) - start);
            }).slice(0, 6).sort(function (a, b) { return Date.parse(a.start) - Date.parse(b.start); })
                .map(function (x) { return { start: x.start, end: x.end, label: x.fullLabel }; });
            throw Object.assign(new Error('Ese turno ya no está disponible.'), { code: 'slot_taken', payload: { alternatives: alts } });
        }, function () { /* sin red: decide el servidor */ });
    }

    // 409 del servidor: modal con alternativas o "enviar sin turno".
    function handleSubmitError(error, retry) {
        var code = error && error.code;
        if (code !== 'slot_taken' && code !== 'booking_disabled') return false;
        var alts = (error.payload && error.payload.alternatives) || [];
        var u = username(form);
        if (u && booking[u]) { booking[u].months = {}; }
        daySlots = {};
        var backdrop = document.createElement('div');
        backdrop.className = 'bk-modal-backdrop';
        backdrop.innerHTML = '<div class="bk-modal" role="dialog" aria-modal="true" aria-labelledby="bk-taken-title">' +
            '<h2 id="bk-taken-title">' + (code === 'slot_taken' ? 'Ese turno ya no está disponible' : 'Reservas online no disponibles') + '</h2>' +
            '<p>' + esc(error.message || '') + (code === 'slot_taken' && alts.length ? ' Elige otro horario o envía la solicitud sin turno.' : ' Puedes enviar la solicitud sin turno y el artista te propone fecha.') + '</p>' +
            (code === 'slot_taken' && alts.length ? '<ul class="bk-chips" aria-label="Turnos alternativos">' + alts.map(function (s, i) {
                return '<li><button type="button" class="bk-chip" data-alt="' + i + '">' + esc(s.label) + '</button></li>';
            }).join('') + '</ul>' : '') +
            '<div class="bk-btn-row"><button type="button" class="wo-btn wo-btn--accent wo-btn--hard" data-without>Enviar sin turno</button>' +
            '<button type="button" class="wo-btn wo-btn--ghost" data-close>Volver</button></div></div>';
        document.body.appendChild(backdrop);
        var close = function () { backdrop.remove(); document.removeEventListener('keydown', onKey); };
        var onKey = function (ev) { if (ev.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey);
        backdrop.addEventListener('click', function (ev) {
            var t = ev.target.closest('button');
            if (!t) { if (ev.target === backdrop) close(); return; }
            if (t.hasAttribute('data-close')) { close(); return; }
            if (t.hasAttribute('data-without')) { clearSlot(form); persist(); close(); retry(); return; }
            if (t.hasAttribute('data-alt')) {
                var alt = alts[Number(t.getAttribute('data-alt'))];
                var info = booking[u] || {};
                if (alt && form) {
                    var date = window.WoBookingSlots && info.timezone ? window.WoBookingSlots.zonedDate(alt.start, info.timezone) : String(alt.start).slice(0, 10);
                    form.requested_slot = { start: alt.start, end: alt.end, minutes: info.slot_minutes || (form.requested_slot && form.requested_slot.minutes), label: alt.label, timezone: info.timezone, date: date };
                    form._preferred_date_iso = date;
                    form.client_preferred_date = alt.label;
                    persist();
                }
                close();
                retry();
            }
        });
        var first = backdrop.querySelector('[data-alt], [data-without]');
        if (first) first.focus();
        return true;
    }

    window.WoQuotationSlot = {
        captureFromUrl: captureFromUrl, onArtist: onArtist, cardHtml: cardHtml, daySlotsHtml: daySlotsHtml,
        busyIndex: busyIndex, onDatePicked: onDatePicked, pickSlot: pickSlot, removeSlot: removeSlot,
        payload: payload, precheck: precheck, handleSubmitError: handleSubmitError
    };
})();
