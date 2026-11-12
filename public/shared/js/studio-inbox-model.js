/**
 * WE OTZI - Inbox del estudio · lógica pura (sin DOM ni red)
 * ----------------------------------------------------------
 * Ronda 3 (12 nov 2026). Lado estudio de las conversaciones que inicia el
 * artista: "Escribir al estudio" (2007:5795), postulaciones a spots,
 * invitaciones/contratos y vínculos de viaje. Replica el lenguaje del inbox
 * del artista (801:1085): categorías con contador, estado "Esperando
 * respuesta / Respondido", hora corta y panel de contexto.
 *
 * También arma la respuesta a las solicitudes de cambio de una invitación
 * (801:1101): diff de cambios contra la invitación vigente y validación.
 *
 * Migración: supabase/migrations/20261112210000_estudio_inbox.sql.
 * UMD: `window.WoStudioInboxModel` en el navegador, `require` en Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoStudioInboxModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var DAY = 24 * 60 * 60 * 1000;
    var WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
    var MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    var MESSAGE_MAX = 2000;
    var REPLY_MIN_DECLINE = 10;

    // context_type → categoría del sidebar del estudio.
    var CONTEXT_META = {
        studio_contact: { filter: 'contact', label: 'Consulta', tone: 'studio' },
        studio_spot_application: { filter: 'spots', label: 'Spot', tone: 'spot' },
        studio_invitation: { filter: 'invitations', label: 'Invitación', tone: 'invitation' },
        studio_contract: { filter: 'invitations', label: 'Contrato', tone: 'invitation' },
        trip_studio_link: { filter: 'trips', label: 'Viaje', tone: 'trip' }
    };

    var FILTERS = [
        { key: 'all', label: 'Todos' },
        { key: 'contact', label: 'Consultas' },
        { key: 'spots', label: 'Spots' },
        { key: 'invitations', label: 'Invitaciones' },
        { key: 'trips', label: 'Viajes' },
        { key: 'archived', label: 'Archivados' }
    ];

    var LIST_CAPTIONS = {
        all: 'TODAS', contact: 'CONSULTAS', spots: 'SPOTS', invitations: 'INVITACIONES',
        trips: 'VIAJES', archived: 'ARCHIVADAS', favorites: 'FAVORITAS', changes: 'CAMBIOS PEDIDOS'
    };

    var ROLE_LABELS = { resident: 'Residente', itinerant: 'Itinerante', guest: 'Guest', manager: 'Manager' };
    var REASON_LABELS = { guest_spot: 'Guest spot', resident: 'Artista residente', other: 'Otra consulta' };
    var APPLICATION_LABELS = {
        pending: 'Postulación recibida', viewed: 'Postulación vista', shortlisted: 'Preseleccionada',
        accepted: 'Postulación aceptada', rejected: 'Postulación cerrada', withdrawn: 'Retirada por el artista'
    };
    var MEMBERSHIP_LABELS = {
        requested: 'Solicitud del artista', pending_invite: 'Invitación pendiente', pending_acceptance: 'Invitación pendiente',
        active: 'En el equipo', paused: 'En pausa', ended: 'Finalizada', rejected: 'Rechazada'
    };
    var LINK_LABELS = {
        esperando_confirmacion: 'Esperando tu confirmación', confirmada: 'Vínculo confirmado', confirmado: 'Vínculo confirmado',
        rechazada: 'Vínculo rechazado', rechazado: 'Vínculo rechazado', cancelada: 'Solicitud cancelada', cancelado: 'Solicitud cancelada'
    };
    var CONTRACT_LABELS = {
        draft: 'Borrador', sent: 'Enviado para firmar', signed: 'Firmado', declined: 'Rechazado',
        cancelled: 'Cancelado', terminated: 'Rescindido', expired: 'Vencido'
    };
    var CHANGE_FIELDS = ['role', 'location_id', 'revenue_split_pct', 'proposed_start_date',
        'proposed_end_date', 'duration_label', 'message'];

    function text(value) { return value == null ? '' : String(value).trim(); }

    function initials(name) {
        var parts = text(name).split(/\s+/)
            .map(function (part) { return part.replace(/[^\p{L}]/gu, ''); })
            .filter(Boolean);
        if (!parts.length) return '—';
        if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase('es');
        return (parts[0][0] + parts[1][0]).toLocaleUpperCase('es');
    }

    function metaFor(contextType) {
        return CONTEXT_META[contextType] || { filter: 'all', label: 'Mensaje', tone: 'studio' };
    }

    /**
     * Estado de respuesta desde la mirada del estudio. El último mensaje
     * humano decide: si es del artista, falta la respuesta del estudio.
     */
    function responseState(thread) {
        if (thread.status === 'closed') return { key: 'closed', label: 'Cerrado', cls: 'is-closed' };
        if (thread.last_sender_role === 'studio') return { key: 'replied', label: 'Respondido', cls: 'is-replied' };
        if (thread.last_sender_role === 'artist') return { key: 'waiting', label: 'Esperando tu respuesta', cls: 'is-waiting' };
        return { key: 'activity', label: 'Actividad nueva', cls: 'is-closed' };
    }

    function normalizeThread(row) {
        var meta = metaFor(row.context_type);
        var name = text(row.artist_name) || (row.artist_username ? '@' + row.artist_username : 'Artista');
        var context = row.context && typeof row.context === 'object' ? row.context : {};
        return {
            id: row.id,
            raw: row,
            contextType: row.context_type,
            contextId: row.context_id,
            filter: meta.filter,
            label: meta.label,
            tone: meta.tone,
            name: name,
            username: row.artist_username || null,
            initials: initials(name),
            subject: text(row.subject),
            context: context,
            preview: text(row.last_message) || 'Sin mensajes todavía',
            lastAt: row.last_message_at || row.created_at || null,
            unread: Math.max(0, Number(row.unread_count) || 0),
            favorite: !!row.is_favorite,
            archived: !!row.is_archived,
            participant: !!row.is_participant,
            closed: row.status === 'closed',
            priority: !!row.is_priority,
            pendingChange: row.pending_change_request || null,
            response: responseState(row)
        };
    }

    function searchable(thread) {
        return [thread.name, thread.username, thread.subject, thread.preview, thread.label,
            thread.context.studio_name, thread.context.city, thread.context.reason_label]
            .map(text).join(' ').toLocaleLowerCase('es')
            .normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    function filterThreads(threads, filter, query) {
        var q = text(query).toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');
        return (threads || []).filter(function (thread) {
            if (filter === 'archived') { if (!thread.archived) return false; }
            else if (thread.archived) return false;
            else if (filter === 'favorites') { if (!thread.favorite) return false; }
            else if (filter === 'changes') { if (!thread.pendingChange) return false; }
            else if (filter && filter !== 'all' && thread.filter !== filter) return false;
            return !q || searchable(thread).indexOf(q) !== -1;
        });
    }

    function counts(threads) {
        var out = { all: 0, contact: 0, spots: 0, invitations: 0, trips: 0, archived: 0, favorites: 0,
            unread: 0, waiting: 0, replied: 0, changes: 0 };
        (threads || []).forEach(function (thread) {
            if (thread.archived) { out.archived += 1; return; }
            out.all += 1;
            if (out[thread.filter] != null && thread.filter !== 'all') out[thread.filter] += 1;
            if (thread.favorite) out.favorites += 1;
            if (thread.unread > 0) out.unread += 1;
            if (thread.response.key === 'waiting') out.waiting += 1;
            if (thread.response.key === 'replied') out.replied += 1;
            if (thread.pendingChange) out.changes += 1;
        });
        return out;
    }

    function unreadTotal(threads) {
        return (threads || []).reduce(function (sum, thread) {
            return thread.archived ? sum : sum + (thread.unread || 0);
        }, 0);
    }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    function toDate(value) {
        if (!value) return null;
        var date = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? value + 'T12:00:00' : value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function listTime(value, now) {
        var date = toDate(value);
        if (!date) return '';
        now = now ? toDate(now) : new Date();
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        var diff = Math.round((today - day) / DAY);
        if (diff === 0) return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
        if (diff === 1) return 'ayer';
        if (diff > 1 && diff < 7) return WEEKDAYS_SHORT[date.getDay()];
        return pad2(date.getDate()) + ' ' + MONTHS_SHORT[date.getMonth()];
    }

    function shortDate(value) {
        var date = toDate(value);
        if (!date) return '';
        return date.getDate() + ' ' + MONTHS_SHORT[date.getMonth()] + ' ' + date.getFullYear();
    }

    function dateRange(start, end) {
        if (!start && !end) return '';
        if (start && end) return shortDate(start) + ' – ' + shortDate(end);
        return shortDate(start || end);
    }

    /** Filas del panel de contexto (zona 4) para un hilo del estudio. */
    function contextRows(thread) {
        var c = thread.context || {};
        var rows = [];
        var status = null;
        switch (thread.contextType) {
            case 'studio_contact':
                if (c.reason_label || c.reason) rows.push({ label: 'Motivo', value: c.reason_label || REASON_LABELS[c.reason] || c.reason });
                if (c.start_date || c.end_date) rows.push({ label: 'Fechas tentativas', value: dateRange(c.start_date, c.end_date) });
                if (c.portfolio_url) rows.push({ label: 'Portfolio', value: 'Incluido en el mensaje' });
                break;
            case 'studio_spot_application':
                if (thread.subject) rows.push({ label: 'Spot', value: thread.subject });
                if (c.start_date || c.end_date) rows.push({ label: 'Fechas', value: dateRange(c.start_date, c.end_date) });
                if (c.application_status) status = { label: APPLICATION_LABELS[c.application_status] || c.application_status, tone: c.application_status === 'accepted' ? 'success' : c.application_status === 'rejected' || c.application_status === 'withdrawn' ? 'muted' : 'warning' };
                break;
            case 'studio_invitation':
                if (c.role) rows.push({ label: 'Rol', value: ROLE_LABELS[c.role] || c.role });
                if (c.proposed_start_date || c.proposed_end_date) rows.push({ label: 'Fechas propuestas', value: dateRange(c.proposed_start_date, c.proposed_end_date) });
                if (c.membership_status) status = { label: MEMBERSHIP_LABELS[c.membership_status] || c.membership_status, tone: c.membership_status === 'active' ? 'success' : /ended|rejected/.test(c.membership_status) ? 'muted' : 'warning' };
                break;
            case 'studio_contract':
                if (c.contract_number) rows.push({ label: 'Contrato', value: c.contract_number + (c.version > 1 ? ' v' + c.version : '') });
                if (c.role) rows.push({ label: 'Rol', value: ROLE_LABELS[c.role] || c.role });
                if (c.contract_status) status = { label: CONTRACT_LABELS[c.contract_status] || c.contract_status, tone: c.contract_status === 'signed' ? 'success' : c.contract_status === 'sent' ? 'warning' : 'muted' };
                break;
            case 'trip_studio_link':
                if (c.city || c.country) rows.push({ label: 'Destino', value: [c.city, c.country].filter(Boolean).join(', ') });
                if (c.start_date || c.end_date) rows.push({ label: 'Fechas', value: dateRange(c.start_date, c.end_date) });
                if (c.link_status) status = { label: LINK_LABELS[c.link_status] || c.link_status, tone: /confirm/.test(c.link_status) ? 'success' : /esperando/.test(c.link_status) ? 'warning' : 'muted' };
                break;
            default:
                break;
        }
        return { eyebrow: thread.label.toUpperCase(), rows: rows, status: status };
    }

    /** Acción del panel de contexto: a qué pestaña del panel lleva cada hilo. */
    function contextAction(thread) {
        if (thread.pendingChange) return { tab: 'roster', label: 'Responder la solicitud de cambios' };
        switch (thread.contextType) {
            case 'studio_spot_application': return { tab: 'spots', label: 'Ver la postulación en Spots' };
            case 'studio_invitation':
            case 'studio_contract': return { tab: 'roster', label: 'Ver la invitación en Equipo' };
            case 'trip_studio_link': return { tab: 'travel', label: 'Resolver en Visitas' };
            default: return null;
        }
    }

    function messageRole(message, userId) {
        if (!message) return 'in';
        if (message.sender_role === 'system' || message.message_kind === 'system') return 'system';
        if ((userId && message.sender_user_id === userId) || message.sender_role === 'studio') return 'out';
        return 'in';
    }

    function validateMessage(body) {
        var value = text(body);
        if (!value) return 'Escribí un mensaje.';
        if (value.length > MESSAGE_MAX) return 'El mensaje puede tener hasta ' + MESSAGE_MAX + ' caracteres.';
        return null;
    }

    /* ---------------------- solicitudes de cambio ---------------------- */

    function numberOrNull(value) {
        if (value === '' || value == null) return null;
        var n = Number(value);
        return Number.isFinite(n) ? n : NaN;
    }

    /**
     * Compara el formulario con la invitación vigente y devuelve solo las
     * claves que cambiaron (lo que acepta respond_studio_invitation_change_request).
     */
    function buildChanges(form, request) {
        var membership = (request && request.membership) || {};
        var details = (request && request.details) || {};
        var current = {
            role: membership.role || null,
            location_id: membership.location_id || null,
            revenue_split_pct: membership.revenue_split_pct == null ? null : Number(membership.revenue_split_pct),
            proposed_start_date: details.proposed_start_date || null,
            proposed_end_date: details.proposed_end_date || null,
            duration_label: text(details.duration_label) || null,
            message: text(details.message) || null
        };
        var next = {
            role: text(form.role) || null,
            location_id: text(form.location_id) || null,
            revenue_split_pct: numberOrNull(form.revenue_split_pct),
            proposed_start_date: text(form.proposed_start_date) || null,
            proposed_end_date: text(form.proposed_end_date) || null,
            duration_label: text(form.duration_label) || null,
            message: text(form.message) || null
        };
        var changes = {};
        CHANGE_FIELDS.forEach(function (key) {
            if (!(key in form)) return;
            var a = current[key], b = next[key];
            if (key === 'revenue_split_pct') {
                if (a === b || (a != null && b != null && !Number.isNaN(b) && Number(a) === Number(b))) return;
            } else if (a === b) return;
            changes[key] = b;
        });
        return changes;
    }

    function validateResponse(decision, reply, changes, request, today) {
        var r = text(reply);
        if (decision !== 'accepted' && decision !== 'declined') return 'Elegí si actualizás la invitación o mantenés las condiciones.';
        if (r.length > MESSAGE_MAX) return 'La respuesta puede tener hasta ' + MESSAGE_MAX + ' caracteres.';
        if (decision === 'declined') {
            if (r.length < REPLY_MIN_DECLINE) return 'Contale al artista por qué mantenés las condiciones (mínimo ' + REPLY_MIN_DECLINE + ' caracteres).';
            return null;
        }
        var c = changes || {};
        if (!Object.keys(c).length) return 'No hay cambios: si mantenés las condiciones, respondé sin actualizar.';
        if ('role' in c && !ROLE_LABELS[c.role]) return 'Elegí un rol válido.';
        if ('revenue_split_pct' in c && c.revenue_split_pct != null && (Number.isNaN(c.revenue_split_pct) || c.revenue_split_pct < 0 || c.revenue_split_pct > 100)) return 'El reparto debe estar entre 0 y 100.';
        var membership = (request && request.membership) || {};
        if (membership.has_contract && ('role' in c || 'revenue_split_pct' in c)) return 'El rol y el reparto se editan con una nueva versión del contrato.';
        var details = (request && request.details) || {};
        var start = 'proposed_start_date' in c ? c.proposed_start_date : details.proposed_start_date;
        var end = 'proposed_end_date' in c ? c.proposed_end_date : details.proposed_end_date;
        if (start && end && end < start) return 'La fecha de fin no puede ser anterior al inicio.';
        var todayIso = today || new Date().toISOString().slice(0, 10);
        if ('proposed_start_date' in c && c.proposed_start_date && c.proposed_start_date < todayIso) return 'La fecha de inicio no puede estar en el pasado.';
        if ('duration_label' in c && c.duration_label && c.duration_label.length > 80) return 'La duración puede tener hasta 80 caracteres.';
        if ('message' in c && c.message && c.message.length > MESSAGE_MAX) return 'El mensaje puede tener hasta ' + MESSAGE_MAX + ' caracteres.';
        return null;
    }

    /** Traduce los errores de las RPC (que pueden venir en inglés) a copy del panel. */
    function friendlyError(error) {
        var source = error && error.cause && error.cause.message ? error.cause : error;
        var msg = text(source && (source.message || source.details || source)).replace(/^\[[^\]]+\]\s*/, '');
        if (/authentication required/i.test(msg)) return 'Tu sesión venció. Volvé a ingresar.';
        if (/thread not found|No tenés acceso/i.test(msg)) return 'No encontramos esa conversación en tu estudio.';
        if (/message content is required/i.test(msg)) return 'Escribí un mensaje.';
        if (/attachment is too large/i.test(msg)) return 'El archivo supera el límite de 15 MB.';
        // Los errores propios de las RPC del estudio ya vienen en español.
        var spanish = /[áéíóúñ¿¡]|\b(la|el|de|no|ya|tu|por|para|una)\b/i.test(msg);
        var technical = /\b(the|is|must|violates|permission|denied|function|relation|column|duplicate|syntax|null)\b/i.test(msg);
        if (spanish && !technical && msg.length < 200) return msg;
        return 'No pudimos completar la acción. Intentá nuevamente.';
    }

    function changeRequestSummary(request) {
        var details = request.details || {};
        var membership = request.membership || {};
        var parts = [];
        if (membership.role) parts.push(ROLE_LABELS[membership.role] || membership.role);
        if (membership.revenue_split_pct != null) parts.push('Split ' + Number(membership.revenue_split_pct) + '%');
        var range = dateRange(details.proposed_start_date, details.proposed_end_date);
        if (range) parts.push(range);
        if (details.duration_label) parts.push(details.duration_label);
        return parts.join(' · ');
    }

    return {
        CONTEXT_META: CONTEXT_META,
        FILTERS: FILTERS,
        LIST_CAPTIONS: LIST_CAPTIONS,
        ROLE_LABELS: ROLE_LABELS,
        CHANGE_FIELDS: CHANGE_FIELDS,
        MESSAGE_MAX: MESSAGE_MAX,
        initials: initials,
        metaFor: metaFor,
        responseState: responseState,
        normalizeThread: normalizeThread,
        filterThreads: filterThreads,
        counts: counts,
        unreadTotal: unreadTotal,
        listTime: listTime,
        shortDate: shortDate,
        dateRange: dateRange,
        contextRows: contextRows,
        contextAction: contextAction,
        messageRole: messageRole,
        validateMessage: validateMessage,
        buildChanges: buildChanges,
        validateResponse: validateResponse,
        friendlyError: friendlyError,
        changeRequestSummary: changeRequestSummary
    };
}));
