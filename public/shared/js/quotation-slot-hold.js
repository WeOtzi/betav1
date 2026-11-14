/**
 * WE OTZI - Detalle de cotización (artista): "Turno pedido" (frente "turnos")
 * --------------------------------------------------------------------------
 * Satélite de quotation-detail-figma.js: escucha 'wo:quotation-detail-rendered'
 * y pinta en #qd-slot-hold-slot el turno que el cliente pidió desde /turnos:
 *   - Apartado (pending): "Reservar este turno" (crea la sesión y bloquea el
 *     turno), "Proponer otro horario" (elige entre tus turnos libres) y
 *     "Liberar turno".
 *   - Vencido: se puede reservar igual si sigue libre, o proponer otro.
 *   - Confirmado / liberado: informativo.
 * También expone hooks para los diálogos del detalle:
 *   respondFieldHtml(q) · confirmFor(q) · confirmedSessionId(q) · labelFor(q)
 * Datos: WeotziData.Booking (servidor, lib/routes/turnos.js).
 */
(function () {
    'use strict';

    var cache = {};      // quotationId → respuesta de holdForQuotation | Promise
    var current = null;  // { quote, readOnly }
    var STATUS = {
        pending: ['Apartado', 'bk-slot-card--held'],
        expired: ['Apartado vencido', 'bk-slot-card--expired'],
        confirmed: ['Turno reservado', 'bk-slot-card--confirmed'],
        released: ['Turno liberado', 'bk-slot-card--released']
    };

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function repo() { return window.WeotziData && window.WeotziData.Booking; }
    function isDemo() {
        try { return !!(window.ConfigManager && window.ConfigManager.isDemoMode && window.ConfigManager.isDemoMode()); } catch (e) { return false; }
    }
    function host() { return document.getElementById('qd-slot-hold-slot'); }
    function holdOf(q) {
        var c = q && cache[q.id];
        return c && typeof c.then !== 'function' ? c.hold : null;
    }
    function holdInfo(q) {
        var c = q && cache[q.id];
        return c && typeof c.then !== 'function' ? c : null;
    }
    function pendingLike(hold) {
        return hold && (hold.status === 'pending' || hold.status === 'expired');
    }

    function relativeExpiry(hold) {
        var ms = Date.parse(hold.expires_at) - Date.now();
        if (!Number.isFinite(ms)) return '';
        if (ms <= 0) return 'venció';
        var h = Math.round(ms / 3600000);
        if (h < 1) return 'vence en menos de 1 h';
        if (h < 48) return 'vence en ' + h + ' h';
        return 'vence en ' + Math.round(h / 24) + ' días';
    }

    function cardHtml(info, readOnly) {
        var hold = info && info.hold;
        if (!hold) return '';
        var st = STATUS[hold.status] || STATUS.released;
        var expired = hold.status === 'expired' || (hold.status === 'pending' && Date.parse(hold.expires_at) <= Date.now());
        if (expired) st = STATUS.expired;
        var meta = hold.status === 'pending' && !expired
            ? 'Apartado hasta ' + esc(hold.expires_label || '') + ' (' + esc(relativeExpiry(hold)) + '). Mientras tanto no se ofrece a otros clientes.'
            : expired ? 'El cliente eligió este turno pero el apartado venció: puede que ya no esté libre.'
            : hold.status === 'confirmed' ? (hold.session_id ? 'Quedó agendado como sesión y bloqueado en tu calendario.' : 'La sesión de este turno se eliminó.')
            : 'El turno volvió a quedar libre.';
        var actions = '';
        if (!readOnly && pendingLike(hold)) {
            actions = '<div class="bk-btn-row">' +
                '<button type="button" class="wo-btn wo-btn--accent wo-btn--hard wo-btn--s" data-hold-confirm>Reservar este turno</button>' +
                '<button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-hold-propose>Proponer otro horario</button>' +
                (hold.status === 'pending' ? '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-hold-release>Liberar turno</button>' : '') +
                '</div><div data-hold-alternatives></div>';
        }
        return '<section class="bk-slot-card ' + st[1] + '" aria-labelledby="qd-slot-hold-title">' +
            '<p class="bk-eyebrow" id="qd-slot-hold-title">Turno pedido · ' + esc(st[0]) + '</p>' +
            '<p class="bk-slot-when">' + esc(hold.label) + '</p>' +
            '<p class="bk-slot-meta">' + meta + ' Hora de tu zona (' + esc(hold.timezone || info.timezone || '') + ').</p>' +
            actions + '<p class="bk-status" role="status" aria-live="polite" data-hold-status></p></section>';
    }

    function setStatus(text, tone) {
        var el = host() && host().querySelector('[data-hold-status]');
        if (el) { el.textContent = text; el.className = 'bk-status' + (tone ? ' is-' + tone : ''); }
    }

    function reload() {
        if (typeof window.WoQuotationDetailReload === 'function') return window.WoQuotationDetailReload();
        window.location.reload();
        return Promise.resolve();
    }

    function confirmHold(q, options) {
        var hold = holdOf(q);
        if (!hold) return Promise.reject(new Error('No hay turno pedido.'));
        return repo().confirmHold(hold.id, options || {}).then(function (res) {
            delete cache[q.id];
            return res;
        }).catch(function (err) {
            var e = new Error(err && err.message ? err.message : 'No pudimos reservar el turno.');
            e.userMessage = err && err.code === 'slot_taken'
                ? 'Ese horario ya está ocupado por otro turno, evento o cita. Elegí otro horario o seguí sin reservar el turno pedido.'
                : e.message;
            e.code = err && err.code;
            throw e;
        });
    }

    function wire(q, info) {
        var el = host();
        if (!el) return;
        var c = el.querySelector('[data-hold-confirm]');
        if (c) c.addEventListener('click', function () {
            c.disabled = true;
            setStatus('Reservando el turno…');
            confirmHold(q).then(function () {
                setStatus('Turno reservado: quedó agendado y le avisamos al cliente.', 'ok');
                return reload();
            }).catch(function (err) { c.disabled = false; setStatus(err.userMessage || err.message, 'error'); });
        });
        var r = el.querySelector('[data-hold-release]');
        if (r) r.addEventListener('click', function () {
            if (!window.confirm('¿Liberar este turno? Vuelve a quedar disponible para otros clientes. La solicitud sigue abierta.')) return;
            r.disabled = true;
            repo().releaseHold(info.hold.id, 'artist').then(function () {
                delete cache[q.id];
                return reload();
            }).catch(function (err) { r.disabled = false; setStatus(err.message, 'error'); });
        });
        var p = el.querySelector('[data-hold-propose]');
        if (p) p.addEventListener('click', function () { proposeOther(q, info, p); });
    }

    // "Proponer otro horario": tus turnos libres de 2 semanas alrededor del pedido.
    function proposeOther(q, info, button) {
        var box = host().querySelector('[data-hold-alternatives]');
        if (!box) return;
        button.disabled = true;
        box.innerHTML = '<p class="bk-note">Buscando tus turnos libres…</p>';
        var center = Math.max(Date.parse(info.hold.starts_at), Date.now());
        repo().ownSlots(new Date(Math.max(Date.now(), center - 3 * 86400000)).toISOString(), new Date(center + 14 * 86400000).toISOString())
            .then(function (res) {
                var slots = [];
                (res.days || []).forEach(function (d) { (d.slots || []).forEach(function (s) { slots.push({ start: s.start, end: s.end, date: d.date, label: s.label }); }); });
                slots = slots.filter(function (s) { return s.start !== info.hold.starts_at; }).slice(0, 24);
                if (!slots.length) {
                    box.innerHTML = '<p class="bk-note">No tenés turnos libres en esas dos semanas. Respondé con tu disponibilidad o agendá la sesión desde el acuerdo.</p>';
                    return;
                }
                var minutes = info.hold.minutes;
                box.innerHTML = '<p class="bk-eyebrow" id="qd-hold-alt-title">Tus turnos libres</p><ul class="bk-chips" aria-labelledby="qd-hold-alt-title">' +
                    slots.map(function (s, i) {
                        var label = window.WoBookingSlots ? window.WoBookingSlots.slotLabel(s.start, res.timezone) : s.date + ' · ' + s.label;
                        return '<li><button type="button" class="bk-chip" data-alt="' + i + '">' + esc(label) + '</button></li>';
                    }).join('') + '</ul>';
                box.querySelectorAll('[data-alt]').forEach(function (b) {
                    b.addEventListener('click', function () {
                        var s = slots[Number(b.getAttribute('data-alt'))];
                        if (!window.confirm('¿Reservar ' + b.textContent + ' para esta cotización? Se agenda la sesión y le avisamos al cliente.')) return;
                        b.disabled = true;
                        setStatus('Reservando el nuevo horario…');
                        confirmHold(q, { starts_at: s.start, minutes: minutes }).then(function () {
                            setStatus('Turno reservado en el nuevo horario.', 'ok');
                            return reload();
                        }).catch(function (err) { b.disabled = false; setStatus(err.userMessage || err.message, 'error'); });
                    });
                });
            })
            .catch(function (err) { box.innerHTML = '<p class="bk-status is-error">' + esc(err.message) + '</p>'; })
            .then(function () { button.disabled = false; });
    }

    function paint() {
        var el = host();
        if (!el || !current) return;
        var info = holdInfo(current.quote);
        el.innerHTML = cardHtml(info, current.readOnly);
        if (info && info.hold) wire(current.quote, info);
    }

    function onRendered(ev) {
        var d = ev && ev.detail;
        if (!d || !d.quote || !d.quote.id || isDemo() || !repo()) return;
        current = { quote: d.quote, readOnly: !!d.readOnly };
        var q = d.quote;
        if (!cache[q.id]) {
            cache[q.id] = repo().holdForQuotation(q.id).then(function (res) {
                cache[q.id] = res;
                if (current && current.quote.id === q.id) paint();
                return res;
            }).catch(function () {
                cache[q.id] = { hold: null };
                return cache[q.id];
            });
            return;
        }
        paint();
    }

    document.addEventListener('wo:quotation-detail-rendered', onRendered);

    window.WoSlotHold = {
        // Casilla del diálogo "Aceptar y enviar presupuesto".
        respondFieldHtml: function (q) {
            var hold = holdOf(q);
            if (!pendingLike(hold)) return '';
            return '<div class="wo-field is-wide"><input type="hidden" name="reserve_slot_offered" value="1">' +
                '<label class="bk-switch"><input type="checkbox" name="reserve_slot" value="1" checked aria-describedby="qd-reserve-slot-help">' +
                '<span>Reservar el turno pedido: ' + esc(hold.label) + '</span></label>' +
                '<p class="wo-help" id="qd-reserve-slot-help">Si lo destildás, el turno se libera y vuelve a estar disponible para otros clientes.</p></div>';
        },
        // options: { starts_at, minutes } para agendarlo en otro horario;
        // from_agreement: true si el aviso al cliente lo manda el acuerdo.
        confirmFor: function (q, options) {
            var hold = holdOf(q);
            if (!pendingLike(hold)) return Promise.resolve(null);
            return confirmHold(q, options);
        },
        // El artista respondió sin reservar el turno: se libera (no queda tomado 72 h).
        releaseFor: function (q, reason) {
            var hold = holdOf(q);
            if (!hold || hold.status !== 'pending' || !repo()) return Promise.resolve(null);
            return repo().releaseHold(hold.id, reason || 'artist').then(function (res) {
                delete cache[q.id];
                return res;
            });
        },
        // Inicio del turno apartado (pendiente o vencido), para precargar el acuerdo.
        pendingStart: function (q) {
            var hold = holdOf(q);
            return pendingLike(hold) ? hold.starts_at : null;
        },
        confirmedSessionId: function (q) {
            var hold = holdOf(q);
            return hold && hold.status === 'confirmed' ? hold.session_id || null : null;
        },
        labelFor: function (q) {
            var hold = holdOf(q);
            return hold ? hold.label : '';
        },
        _cache: cache
    };
})();
