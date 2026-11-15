/**
 * WE OTZI - Modelo de sesiones (ronda 2 · frente "sesiones" · P28 y P27-sesión)
 * ---------------------------------------------------------------------------
 * Reglas puras, compartidas por el servidor (lib/sesiones.js) y el navegador:
 *
 *   · Una sesión que agenda el artista nace "por confirmar": el cliente la
 *     confirma o pide otra fecha.
 *   · Confirmada, solo se cambia con el acuerdo de las dos partes y hasta
 *     EDIT_WINDOW_DAYS (3) días antes. Después, o si no hay acuerdo, queda
 *     pedir una disputa a soporte.
 *   · Una sesión pasada no se modifica: se califica, se deja un registro y, si
 *     hace falta, se disputa.
 *   · La ubicación es un texto completo ("Estudio X - Av. Corrientes 2151,
 *     Buenos Aires, Argentina") con su origen (sede, propia, la del cliente o
 *     libre con Google Places).
 *
 * Las mismas reglas viven en la base (migración 20261116150000): acá solo se
 * decide qué mostrar y qué pedirle al servidor.
 *
 * Navegador: window.WoSessionModel. Node (tests y servidor): require().
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoSessionModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var EDIT_WINDOW_DAYS = 3;
    var DAY_MS = 24 * 60 * 60 * 1000;
    var OPEN_STATUSES = ['scheduled', 'rescheduled'];
    var CONFIRMATIONS = ['pending', 'confirmed', 'change_requested'];
    var LOCATION_KINDS = ['studio', 'own', 'client', 'custom'];
    var LOCATION_MAX = 300;
    var NOTE_MAX = 1000;
    var FEEDBACK_NOTE_MAX = 2000;
    var DISPUTE_MIN = 10;
    var DISPUTE_MAX = 4000;
    var CLOSED_QUOTE = ['cancelled', 'expired', 'client_rejected'];
    var DISPUTABLE_QUOTE = ['client_approved', 'in_progress', 'en_progreso', 'artist_completed', 'completed'];

    // Motivos de disputa de una sesión (subconjunto de support_tickets.dispute_reason).
    var DISPUTE_REASONS = [
        { id: 'cancelacion', label: 'Cambio o cancelación sin acuerdo' },
        { id: 'no_presentacion', label: 'La otra parte no se presentó' },
        { id: 'trato', label: 'Trato durante la sesión' },
        { id: 'higiene', label: 'Higiene o seguridad' },
        { id: 'calidad', label: 'Resultado de la sesión' },
        { id: 'pago', label: 'Pago o seña' },
        { id: 'otro', label: 'Otro motivo' }
    ];

    var LOCATION_KIND_LABELS = {
        studio: 'Sede de estudio',
        own: 'Ubicación propia',
        client: 'Elegida por el cliente',
        custom: 'Otra dirección'
    };

    function toDate(value) {
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
        if (value == null || value === '') return null;
        var date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function clean(value, max) {
        var text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
        return max && text.length > max ? text.slice(0, max).trim() : text;
    }

    function isOpen(session) {
        return !!session && OPEN_STATUSES.indexOf(String(session.status || 'scheduled')) !== -1;
    }

    function isPast(session, now) {
        var date = toDate(session && session.session_date);
        var ref = toDate(now) || new Date();
        return !!date && date.getTime() <= ref.getTime();
    }

    // Filas anteriores a la migración (sin la columna) ya estaban acordadas.
    function confirmationOf(session) {
        var value = session && session.client_confirmation;
        return CONFIRMATIONS.indexOf(value) !== -1 ? value : 'confirmed';
    }

    /** upcoming | past (abierta con fecha vencida) | done | no_show | cancelled */
    function phase(session, now) {
        var status = String((session && session.status) || 'scheduled');
        if (status === 'cancelled' || status === 'canceled') return 'cancelled';
        if (status === 'completed') return 'done';
        if (status === 'no_show') return 'no_show';
        return isPast(session, now) ? 'past' : 'upcoming';
    }

    /** Último instante en que una sesión confirmada admite un pedido de cambio. */
    function editDeadline(session) {
        var date = toDate(session && session.session_date);
        return date ? new Date(date.getTime() - EDIT_WINDOW_DAYS * DAY_MS) : null;
    }

    function withinEditWindow(session, now) {
        var deadline = editDeadline(session);
        var ref = toDate(now) || new Date();
        return !!deadline && ref.getTime() <= deadline.getTime();
    }

    function quoteClosed(status) {
        return CLOSED_QUOTE.indexOf(String(status || '')) !== -1;
    }

    function quoteDisputable(status) {
        return DISPUTABLE_QUOTE.indexOf(String(status || '')) !== -1;
    }

    /**
     * Qué puede hacer `role` con la sesión.
     * ctx: { role: 'client'|'artist', hasClientAccount, request (solicitud
     *        pendiente o null), now, quoteStatus, disputeActive }
     * locked: null | 'window' (faltan menos de 3 días) | 'past' | 'closed' | 'quote'
     */
    function permissions(session, ctx) {
        var c = ctx || {};
        var role = c.role === 'artist' ? 'artist' : 'client';
        var request = c.request && c.request.status !== undefined && c.request.status !== 'pending' ? null : (c.request || null);
        var ph = phase(session, c.now);
        var confirmation = confirmationOf(session);
        var hasClient = c.hasClientAccount !== false;
        var can = {
            confirm: false, requestChange: false, editDirect: false, respond: false,
            withdraw: false, dispute: false, rate: false, locked: null
        };
        var disputable = quoteDisputable(c.quoteStatus) && !c.disputeActive;

        if (ph === 'cancelled') {
            can.locked = 'closed';
            can.dispute = disputable && hasClient;
            return can;
        }
        if (ph !== 'upcoming') {
            // Pasada (registrada o no): solo registro, calificación y disputa.
            can.locked = 'past';
            can.rate = true;
            can.dispute = disputable;
            return can;
        }
        if (quoteClosed(c.quoteStatus) || c.quoteStatus === 'completed') {
            can.locked = 'quote';
            return can;
        }
        if (!hasClient) {
            // Cotización sin cuenta de cliente: no hay con quién acordar.
            can.editDirect = role === 'artist';
            return can;
        }

        var mine = !!request && request.requested_by_role === role;
        var theirs = !!request && request.requested_by_role !== role;

        if (confirmation !== 'confirmed') {
            can.dispute = disputable;
            if (role === 'client') {
                can.confirm = true;
                can.requestChange = true;
                can.withdraw = mine;
            } else {
                can.editDirect = true;
                can.respond = theirs;
            }
            return can;
        }

        // Confirmada: cambios solo de común acuerdo y hasta 3 días antes.
        var inWindow = withinEditWindow(session, c.now);
        can.respond = theirs;
        can.withdraw = mine;
        can.requestChange = inWindow && !theirs;
        can.dispute = disputable;
        if (!inWindow) can.locked = 'window';
        return can;
    }

    /** Etiqueta de estado para la fila/tarjeta. tone: info|success|warning|muted|danger */
    function statusBadge(session, ctx) {
        var c = ctx || {};
        var role = c.role === 'artist' ? 'artist' : 'client';
        var ph = phase(session, c.now);
        if (ph === 'cancelled') return { key: 'cancelled', label: 'Cancelada', tone: 'muted' };
        if (ph === 'done') return { key: 'done', label: 'Realizada', tone: 'success' };
        if (ph === 'no_show') return { key: 'no_show', label: 'Ausencia registrada', tone: 'danger' };
        if (ph === 'past') return { key: 'past', label: 'Fecha pasada', tone: 'muted' };
        if (c.hasClientAccount === false) return { key: 'scheduled', label: 'Agendada', tone: 'info' };
        var confirmation = confirmationOf(session);
        var request = c.request || null;
        if (confirmation === 'pending') {
            return role === 'client'
                ? { key: 'pending', label: 'Por confirmar', tone: 'warning' }
                : { key: 'pending', label: 'Espera confirmación', tone: 'warning' };
        }
        if (confirmation === 'change_requested') {
            return role === 'client'
                ? { key: 'change_requested', label: 'Pediste un cambio', tone: 'warning' }
                : { key: 'change_requested', label: 'El cliente pidió un cambio', tone: 'warning' };
        }
        if (request) {
            return request.requested_by_role === role
                ? { key: 'change_pending', label: 'Cambio en revisión', tone: 'info' }
                : { key: 'change_pending', label: 'Te pidieron un cambio', tone: 'warning' };
        }
        return { key: 'confirmed', label: 'Confirmada', tone: 'success' };
    }

    /** "Estudio X - Av. Corrientes 2151, Buenos Aires, Argentina" (sin repetir el nombre). */
    function fullLocation(name, address) {
        var n = clean(name);
        var a = clean(address);
        if (!n) return clean(a, LOCATION_MAX);
        if (!a) return clean(n, LOCATION_MAX);
        if (a.toLowerCase().indexOf(n.toLowerCase()) === 0) return clean(a, LOCATION_MAX);
        return clean(n + ' - ' + a, LOCATION_MAX);
    }

    /** Dirección de una sede (studio_locations) con respaldo en el estudio. */
    function studioAddress(location, studio) {
        var l = location || {};
        var s = studio || {};
        if (clean(l.formatted_address)) return clean(l.formatted_address);
        var street = [l.street, l.street_number].map(function (p) { return clean(p); }).filter(Boolean).join(' ');
        var parts = [street, clean(l.locality), clean(l.city), clean(l.state_province), clean(l.country)].filter(Boolean);
        var seen = {};
        parts = parts.filter(function (p) {
            var key = p.toLowerCase();
            if (seen[key]) return false;
            seen[key] = true;
            return true;
        });
        if (parts.length) return parts.join(', ');
        return clean(s.formatted_address) || [clean(s.city), clean(s.country)].filter(Boolean).join(', ');
    }

    /** Enlace a Google Maps de una dirección (con place_id si se conoce). */
    function mapsUrl(text, placeId) {
        var query = clean(text);
        if (!query) return '';
        var url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
        var id = clean(placeId);
        if (id && /^[A-Za-z0-9_-]{10,300}$/.test(id)) url += '&query_place_id=' + encodeURIComponent(id);
        return url;
    }

    /**
     * Normaliza la ubicación que manda un formulario.
     * → { ok: true, value: { location, location_kind, location_ref, location_place_id } | null }
     *   (value null = sin ubicación) o { ok: false, error }
     */
    function normalizeLocation(input) {
        var src = input || {};
        var text = clean(src.location);
        if (!text) return { ok: true, value: null };
        if (text.length > LOCATION_MAX) {
            return { ok: false, error: 'La ubicación no puede superar los ' + LOCATION_MAX + ' caracteres.' };
        }
        var kind = LOCATION_KINDS.indexOf(src.location_kind) !== -1 ? src.location_kind : 'custom';
        var ref = clean(src.location_ref);
        var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        var place = clean(src.location_place_id);
        return {
            ok: true,
            value: {
                location: text,
                location_kind: kind,
                location_ref: (kind === 'studio' || kind === 'own' || kind === 'client') && uuid.test(ref) ? ref.toLowerCase() : null,
                location_place_id: place && /^[A-Za-z0-9_-]{10,300}$/.test(place) ? place : null
            }
        };
    }

    function locationKindLabel(kind) {
        return LOCATION_KIND_LABELS[kind] || '';
    }

    function disputeReasonLabel(id) {
        for (var i = 0; i < DISPUTE_REASONS.length; i += 1) {
            if (DISPUTE_REASONS[i].id === id) return DISPUTE_REASONS[i].label;
        }
        return '';
    }

    function stars(rating) {
        var n = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
        return new Array(n + 1).join('★') + new Array(5 - n + 1).join('☆');
    }

    function dateTimeLabel(value, options) {
        var date = toDate(value);
        if (!date) return '';
        var opts = options || {};
        try {
            var day = new Intl.DateTimeFormat('es', {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: opts.timeZone
            }).format(date);
            var time = new Intl.DateTimeFormat('es', {
                hour: '2-digit', minute: '2-digit', hour12: false, timeZone: opts.timeZone
            }).format(date);
            return day.charAt(0).toUpperCase() + day.slice(1) + ' · ' + time + ' h';
        } catch (_) {
            return date.toISOString();
        }
    }

    function dayLabel(value, options) {
        var date = toDate(value);
        if (!date) return '';
        try {
            return new Intl.DateTimeFormat('es', {
                day: 'numeric', month: 'long', year: 'numeric', timeZone: options && options.timeZone
            }).format(date);
        } catch (_) {
            return date.toISOString().slice(0, 10);
        }
    }

    function durationLabel(hours) {
        var value = Number(hours);
        if (!Number.isFinite(value) || value <= 0) return '';
        var total = Math.round(value * 60);
        var h = Math.floor(total / 60);
        var m = total % 60;
        if (!h) return m + ' min';
        return m ? h + ' h ' + m + ' min' : h + ' h';
    }

    /** Texto corto de lo que propone una solicitud de cambio. */
    function proposalSummary(request, options) {
        var r = request || {};
        var parts = [];
        if (r.proposed_date) parts.push('Nueva fecha: ' + dateTimeLabel(r.proposed_date, options));
        if (r.proposed_duration_hours) parts.push('Duración: ' + durationLabel(r.proposed_duration_hours));
        if (r.proposed_location) parts.push('Lugar: ' + clean(r.proposed_location));
        return parts.join(' · ');
    }

    /** Copia del candado de edición para la interfaz. */
    function lockCopy(locked) {
        if (locked === 'window') {
            return 'Faltan menos de ' + EDIT_WINDOW_DAYS + ' días: la sesión ya no se puede modificar. Si necesitas un cambio, pide una disputa a soporte.';
        }
        if (locked === 'past') return 'La sesión ya pasó: no se puede modificar. Puedes calificarla, dejar un registro o pedir una disputa.';
        if (locked === 'closed') return 'La sesión está cancelada.';
        if (locked === 'quote') return 'La cotización está cerrada.';
        return '';
    }

    /** Sesiones ordenadas para un panel: primero las que piden acción, luego por fecha. */
    function sortForPanel(sessions, now) {
        var ref = toDate(now) || new Date();
        return (Array.isArray(sessions) ? sessions.slice() : []).sort(function (a, b) {
            var pa = phase(a, ref) === 'upcoming' ? 0 : 1;
            var pb = phase(b, ref) === 'upcoming' ? 0 : 1;
            if (pa !== pb) return pa - pb;
            var da = (toDate(a.session_date) || ref).getTime();
            var db = (toDate(b.session_date) || ref).getTime();
            return pa === 0 ? da - db : db - da;
        });
    }

    return {
        EDIT_WINDOW_DAYS: EDIT_WINDOW_DAYS,
        OPEN_STATUSES: OPEN_STATUSES,
        CONFIRMATIONS: CONFIRMATIONS,
        LOCATION_KINDS: LOCATION_KINDS,
        LOCATION_MAX: LOCATION_MAX,
        NOTE_MAX: NOTE_MAX,
        FEEDBACK_NOTE_MAX: FEEDBACK_NOTE_MAX,
        DISPUTE_MIN: DISPUTE_MIN,
        DISPUTE_MAX: DISPUTE_MAX,
        DISPUTE_REASONS: DISPUTE_REASONS,
        toDate: toDate,
        clean: clean,
        isOpen: isOpen,
        isPast: isPast,
        confirmationOf: confirmationOf,
        phase: phase,
        editDeadline: editDeadline,
        withinEditWindow: withinEditWindow,
        quoteClosed: quoteClosed,
        quoteDisputable: quoteDisputable,
        permissions: permissions,
        statusBadge: statusBadge,
        fullLocation: fullLocation,
        studioAddress: studioAddress,
        mapsUrl: mapsUrl,
        normalizeLocation: normalizeLocation,
        locationKindLabel: locationKindLabel,
        disputeReasonLabel: disputeReasonLabel,
        stars: stars,
        dateTimeLabel: dateTimeLabel,
        dayLabel: dayLabel,
        durationLabel: durationLabel,
        proposalSummary: proposalSummary,
        lockCopy: lockCopy,
        sortForPanel: sortForPanel
    };
}));
