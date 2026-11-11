/*
 * WE ÖTZI · Calendario · enlaces profundos y vínculo con cotizaciones
 * Figma final w3JA83CcP5ISKjyOu87mx1 · 801:542…801:554.
 *
 * Lógica pura (sin DOM ni red) para:
 *   - leer/escribir el estado del calendario en la URL (?view, ?date, ?new,
 *     ?quote, ?event, ?picker) y abrir cada estado del Figma directamente;
 *   - clasificar cotizaciones para el selector "Cotización a vincular"
 *     (801:547) y resumir sus sesiones agendadas;
 *   - decidir dónde se guarda un turno: sesión de la cotización
 *     (quotation_sessions) o reserva pendiente manual (artist_calendar_events).
 *
 * Navegador: window.WeotziCalendarLinks. Node: require() para los tests.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WeotziCalendarLinks = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const VIEWS = ['month', 'week', 'day', 'agenda'];
    const EDITOR_TYPES = [
        'confirmed_session', 'reservation', 'availability', 'blocked_day',
        'guest_spot', 'convention', 'reminder', 'personal',
    ];

    // Alias aceptados en ?new=<tipo>. Incluye el contrato del detalle de
    // cotización (?new=appointment) y nombres en español para QA.
    const TYPE_ALIASES = {
        turno: 'confirmed_session',
        'turno-con-cliente': 'confirmed_session',
        appointment: 'confirmed_session',
        session: 'confirmed_session',
        sesion: 'confirmed_session',
        confirmed_session: 'confirmed_session',
        reserva: 'reservation',
        'reserva-pendiente': 'reservation',
        reservation: 'reservation',
        disponibilidad: 'availability',
        availability: 'availability',
        bloqueo: 'blocked_day',
        bloquear: 'blocked_day',
        'dia-bloqueado': 'blocked_day',
        blocked_day: 'blocked_day',
        guest: 'guest_spot',
        'guest-spot': 'guest_spot',
        guest_spot: 'guest_spot',
        convencion: 'convention',
        convention: 'convention',
        recordatorio: 'reminder',
        reminder: 'reminder',
        personal: 'personal',
        'evento-personal': 'personal',
    };

    const TYPE_SLUGS = {
        confirmed_session: 'turno',
        reservation: 'reserva',
        availability: 'disponibilidad',
        blocked_day: 'bloqueo',
        guest_spot: 'guest-spot',
        convention: 'convencion',
        reminder: 'recordatorio',
        personal: 'personal',
    };

    const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

    function normalizeKey(value) {
        return String(value == null ? '' : value)
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/\s+/g, '-');
    }

    function resolveType(value) {
        const key = normalizeKey(value);
        return TYPE_ALIASES[key] || null;
    }

    function isIsoDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
        const [year, month, day] = String(value).split('-').map(Number);
        const date = new Date(year, month - 1, day);
        return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
    }

    function truthyFlag(value) {
        return value != null && !/^(0|false|no|closed)$/i.test(String(value));
    }

    /**
     * Lee el estado del calendario desde la query string.
     *   view   month | week | day | agenda (también mes/semana/dia)
     *   date   YYYY-MM-DD: día enfocado (y fecha inicial del formulario)
     *   new    abre el editor; con tipo (turno, reserva, …) lo preselecciona
     *   quote  quote_id (texto) o id numérico: preselecciona la cotización
     *   event  id del evento a editar (uuid manual o session:<id>)
     *   picker open: abre la lista de cotizaciones del turno
     *   q      texto de búsqueda inicial
     */
    function parseUrlState(search) {
        const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
        const viewKey = normalizeKey(params.get('view'));
        const viewAliases = { mes: 'month', semana: 'week', dia: 'day' };
        const view = VIEWS.includes(viewKey) ? viewKey : (viewAliases[viewKey] || null);
        const date = isIsoDate(params.get('date')) ? params.get('date') : null;
        const quote = (params.get('quote') || '').trim() || null;
        const event = (params.get('event') || '').trim() || null;
        const hasNew = params.has('new');
        const type = hasNew ? resolveType(params.get('new')) : (quote ? 'confirmed_session' : null);
        return {
            view,
            date,
            editor: hasNew || !!quote || !!event,
            type,
            quote,
            event,
            picker: params.has('picker') && truthyFlag(params.get('picker')),
            search: (params.get('q') || '').trim(),
        };
    }

    /** Arma la query string canónica (sin `?` inicial vacío). */
    function buildUrlState(state) {
        const params = new URLSearchParams();
        if (state.view && state.view !== 'month') params.set('view', state.view);
        if (state.date) params.set('date', state.date);
        if (state.editor) {
            if (state.event) params.set('event', state.event);
            else params.set('new', state.type ? (TYPE_SLUGS[state.type] || state.type) : 'tipo');
            if (state.quote) params.set('quote', state.quote);
        }
        const query = params.toString();
        return query ? `?${query}` : '';
    }

    /* ----------------------------- cotizaciones ----------------------------- */

    const QUOTE_STATUS = {
        client_approved: { group: 'approved', label: 'Confirmada', tone: 'confirmed' },
        in_progress: { group: 'approved', label: 'En progreso', tone: 'progress' },
        artist_completed: { group: 'approved', label: 'Lista para cliente', tone: 'progress' },
        pending: { group: 'unapproved', label: 'Pendiente', tone: 'pending' },
        responded: { group: 'unapproved', label: 'Respondida', tone: 'responded' },
        client_rejected: { group: 'unavailable', label: 'Rechazada', tone: 'rejected', reason: 'rechazada' },
        cancelled: { group: 'unavailable', label: 'Rechazada', tone: 'rejected', reason: 'rechazada' },
        expired: { group: 'unavailable', label: 'Vencida', tone: 'expired', reason: 'vencida' },
        completed: { group: 'unavailable', label: 'Completada', tone: 'expired', reason: 'completada' },
    };

    const QUOTE_GROUPS = [
        { id: 'approved', label: 'Aprobadas y en progreso' },
        { id: 'unapproved', label: 'Sin aprobar · solo como reserva pendiente' },
        { id: 'unavailable', label: 'No disponibles para agendar' },
    ];

    // `in_progress` también lo usa el wizard del cliente para borradores; solo
    // cuenta como trabajo en curso si la cotización ya llegó al artista.
    function isDraft(quote) {
        return quote.quote_status === 'in_progress'
            && !quote.sent_to_artist_at
            && !quote.artist_responded_at;
    }

    function classifyQuote(quote) {
        if (!quote || isDraft(quote) || quote.is_archived) return null;
        const meta = QUOTE_STATUS[quote.quote_status];
        if (meta) return meta;
        return { group: 'unavailable', label: 'Sin estado', tone: 'expired', reason: 'sin estado' };
    }

    function quoteCode(quote) {
        if (!quote) return '';
        if (quote.quote_id) return String(quote.quote_id);
        return `COT-${String(quote.id).slice(-4).toUpperCase()}`;
    }

    function quoteProject(quote) {
        const text = quote?.project_description || quote?.tattoo_idea_description || '';
        const firstLine = String(text).split(/\n/)[0].trim();
        if (firstLine.length <= 64) return firstLine;
        return `${firstLine.slice(0, 61).trim()}…`;
    }

    function formatShortDay(value) {
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
    }

    function activeSessions(sessions) {
        return (sessions || []).filter((session) => session && session.status !== 'cancelled' && session.session_date);
    }

    /**
     * Línea de contexto de cada opción (Figma 801:547):
     *   COT-056 · Sesión 1 de 1 agendada · 9 jul
     *   COT-038 · 1 turno agendado · 23 jul
     *   COT-057 · 2 sesiones · ninguna agendada
     *   COT-058 · Sin turnos agendados
     *   COT-049 · No se puede agendar: rechazada
     */
    function sessionSummary(quote, sessions, now) {
        const code = quoteCode(quote);
        const status = classifyQuote(quote);
        if (status && status.group === 'unavailable') {
            return `${code} · No se puede agendar: ${status.reason}`;
        }
        const reference = now instanceof Date ? now : new Date();
        const active = activeSessions(sessions)
            .slice()
            .sort((a, b) => new Date(a.session_date) - new Date(b.session_date));
        const total = Number(quote.final_sessions) > 0
            ? Number(quote.final_sessions)
            : (Number(quote.tattoo_estimated_sessions) > 0 ? Number(quote.tattoo_estimated_sessions) : 0);
        if (!active.length) {
            if (total > 0) return `${code} · ${total} ${total === 1 ? 'sesión' : 'sesiones'} · ninguna agendada`;
            return `${code} · Sin turnos agendados`;
        }
        const upcoming = active.find((session) => new Date(session.session_date) >= reference);
        const focus = upcoming || active[active.length - 1];
        const when = formatShortDay(focus.session_date);
        const count = active.length;
        if (total > 0) {
            return `${code} · Sesión ${Math.min(count, total)} de ${total} agendada · ${when}`;
        }
        return `${code} · ${count} ${count === 1 ? 'turno agendado' : 'turnos agendados'} · ${when}`;
    }

    function searchable(quote) {
        return [quote.client_full_name, quote.project_description, quote.tattoo_idea_description, quoteCode(quote), quote.id]
            .filter((value) => value != null && value !== '')
            .join(' ')
            .toLocaleLowerCase('es')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '');
    }

    function normalizedQuery(query) {
        return String(query || '')
            .toLocaleLowerCase('es')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .trim();
    }

    /**
     * Agrupa las cotizaciones para el listbox. Devuelve solo los grupos con
     * opciones, en el orden del Figma.
     */
    function buildQuoteOptions(quotes, sessionsByQuoteId, query, now) {
        const needle = normalizedQuery(query);
        const lookup = sessionsByQuoteId instanceof Map
            ? sessionsByQuoteId
            : new Map(Object.entries(sessionsByQuoteId || {}));
        const groups = QUOTE_GROUPS.map((group) => ({ id: group.id, label: group.label, options: [] }));
        (quotes || []).forEach((quote) => {
            const status = classifyQuote(quote);
            if (!status) return;
            if (needle && !searchable(quote).includes(needle)) return;
            const sessions = lookup.get(quote.id) || lookup.get(String(quote.id)) || [];
            groups.find((group) => group.id === status.group).options.push({
                id: String(quote.id),
                code: quoteCode(quote),
                name: quote.client_full_name || 'Cliente sin nombre',
                project: quoteProject(quote),
                badge: status.label,
                tone: status.tone,
                group: status.group,
                disabled: status.group === 'unavailable',
                meta: sessionSummary(quote, sessions, now),
            });
        });
        return groups.filter((group) => group.options.length);
    }

    function matchesQuoteParam(quote, param) {
        if (!quote || param == null || param === '') return false;
        const value = String(param).trim();
        return String(quote.quote_id || '') === value || String(quote.id) === value;
    }

    /**
     * Destino de guardado del formulario "Turno con cliente":
     *   - cotización aprobada/en progreso → 'session' (quotation_sessions)
     *   - cotización sin aprobar          → 'reservation' (reserva pendiente manual)
     *   - sin cotización (turno heredado) → 'manual'
     * Para cualquier otro tipo de evento → 'manual'.
     */
    function saveTarget(selectedType, quote) {
        if (selectedType !== 'confirmed_session' || !quote) return 'manual';
        const status = classifyQuote(quote);
        if (!status || status.group === 'unavailable') return 'blocked';
        return status.group === 'approved' ? 'session' : 'reservation';
    }

    return {
        VIEWS,
        EDITOR_TYPES,
        TYPE_ALIASES,
        TYPE_SLUGS,
        QUOTE_STATUS,
        QUOTE_GROUPS,
        resolveType,
        isIsoDate,
        parseUrlState,
        buildUrlState,
        classifyQuote,
        quoteCode,
        quoteProject,
        formatShortDay,
        sessionSummary,
        buildQuoteOptions,
        matchesQuoteParam,
        saveTarget,
    };
}));
