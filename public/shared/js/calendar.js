/*
 * WE ÖTZI · Calendario profesional
 * Figma final w3JA83CcP5ISKjyOu87mx1: 801:542 (mes), 801:544 (semana),
 * 801:545 (día), 801:546 (elegir tipo) y 801:547…801:554 (formularios).
 *
 * Vistas propias (mes, semana, día y agenda) y CRUD real a través de
 * WeotziData.Calendar:
 *   - eventos manuales en artist_calendar_events;
 *   - turnos con cliente = sesiones de la cotización vinculada
 *     (quotation_sessions), creadas/editadas/borradas en su origen;
 *   - guest spots y convenciones de Travel (artist_trips) en solo lectura.
 *
 * Estados por URL (ver calendar-links.js): ?view=week|day|agenda,
 * ?date=YYYY-MM-DD, ?new=<tipo>, ?quote=<quote_id|id>, ?event=<id>, ?picker=open.
 */
(function () {
    'use strict';

    const TYPE_META = {
        confirmed_session: { label: 'Turno confirmado', editorLabel: 'Turno con cliente' },
        pending_request: { label: 'Solicitud pendiente', editorLabel: 'Solicitud pendiente' },
        reservation: { label: 'Reserva', editorLabel: 'Reserva pendiente' },
        blocked_day: { label: 'Día bloqueado', editorLabel: 'Día bloqueado' },
        availability: { label: 'Disponibilidad', editorLabel: 'Disponibilidad' },
        guest_spot: { label: 'Guest Spot', editorLabel: 'Guest Spot' },
        convention: { label: 'Convención', editorLabel: 'Convención' },
        reminder: { label: 'Recordatorio', editorLabel: 'Recordatorio' },
        personal: { label: 'Evento personal', editorLabel: 'Evento personal' },
    };

    const TYPE_ORDER = Object.keys(TYPE_META);
    const MANUAL_TYPES = TYPE_ORDER.filter((type) => type !== 'pending_request');
    const BLOCKING_TYPES = new Set([
        'confirmed_session', 'reservation', 'blocked_day',
        'guest_spot', 'convention', 'personal',
    ]);
    const WEEKDAYS = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];
    const MONTHS = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
    ];
    const HOUR_START = 9;
    const HOUR_END = 21;
    const MONTH_VISIBLE_EVENTS = 3;
    const QUOTE_HINT = 'Elegí una cotización para asociar este turno al cliente y a su proyecto.';
    const MANUAL_QUOTE_PATH = '/my-quotations/new';

    const state = {
        user: null,
        artist: null,
        events: [],
        view: 'month',
        currentDate: startOfDay(new Date()),
        selectedDate: startOfDay(new Date()),
        miniDate: startOfMonth(new Date()),
        enabledTypes: new Set(TYPE_ORDER),
        search: '',
        selectedType: null,
        editingEvent: null,
        conflictTimer: null,
        toastTimer: null,
        quotes: null,
        quoteSessions: new Map(),
        quotesPromise: null,
        quotesError: '',
        selectedQuote: null,
        quoteQuery: '',
        quoteOptions: [],
        activeQuoteId: null,
    };

    const el = {};

    function links() {
        return window.WeotziCalendarLinks || null;
    }

    function cacheElements() {
        [
            'calendar-page', 'calendar-editor', 'calendar-view', 'calendar-summary',
            'calendar-legend', 'cal-period-label', 'calendar-search', 'upcoming-list',
            'upcoming-summary', 'calendar-loading', 'calendar-toast', 'event-type-picker',
            'calendar-event-form', 'event-form-empty', 'event-fields', 'event-form-error',
            'save-event', 'delete-event', 'editor-heading', 'mini-title', 'mini-grid',
            'summary-type', 'summary-date', 'summary-time', 'summary-duration',
            'summary-location', 'calendar-conflict', 'calendar-conflict-list',
        ].forEach((id) => { el[id] = document.getElementById(id); });
    }

    function getBasePath() {
        if (window.WEOTZI_BASE_PATH) return String(window.WEOTZI_BASE_PATH).replace(/\/$/, '');
        const pathname = window.location.pathname || '';
        return pathname === '/beta' || pathname.startsWith('/beta/') ? '/beta' : '';
    }

    function appUrl(path) {
        const normalized = String(path || '').startsWith('/') ? String(path) : `/${path}`;
        const base = getBasePath();
        return base && !normalized.startsWith(`${base}/`) ? `${base}${normalized}` : normalized;
    }

    // Ruta canónica de inicio de sesión del artista (como cuenta, postulaciones
    // e invitaciones); la beta cerrada de registro es "Crear cuenta".
    function buildArtistLoginUrl(returnTo = '/calendar') {
        return appUrl(`/artist/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`);
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/`/g, '&#096;');
    }

    function pad(value) {
        return String(value).padStart(2, '0');
    }

    function startOfDay(date) {
        const value = new Date(date);
        value.setHours(0, 0, 0, 0);
        return value;
    }

    function endOfDay(date) {
        const value = startOfDay(date);
        value.setDate(value.getDate() + 1);
        return value;
    }

    function startOfMonth(date) {
        const value = startOfDay(date);
        value.setDate(1);
        return value;
    }

    function endOfMonth(date) {
        const value = startOfMonth(date);
        value.setMonth(value.getMonth() + 1);
        return value;
    }

    function addDays(date, count) {
        const value = new Date(date);
        value.setDate(value.getDate() + count);
        return value;
    }

    function addMonths(date, count) {
        const original = new Date(date);
        const day = original.getDate();
        original.setDate(1);
        original.setMonth(original.getMonth() + count);
        original.setDate(Math.min(day, new Date(original.getFullYear(), original.getMonth() + 1, 0).getDate()));
        return original;
    }

    function mondayOfWeek(date) {
        const value = startOfDay(date);
        const weekday = value.getDay();
        value.setDate(value.getDate() - (weekday === 0 ? 6 : weekday - 1));
        return value;
    }

    function sameDay(a, b) {
        return a.getFullYear() === b.getFullYear()
            && a.getMonth() === b.getMonth()
            && a.getDate() === b.getDate();
    }

    function dateKey(date) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function parseLocalDate(value) {
        if (!value) return null;
        const parts = String(value).split('-').map(Number);
        if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }

    function asDate(value) {
        const date = value instanceof Date ? new Date(value) : new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function formatMonthYear(date) {
        return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    }

    function formatLongDate(date) {
        return `${date.getDate()} de ${MONTHS[date.getMonth()].toLowerCase()}, ${date.getFullYear()}`;
    }

    function capitalize(text) {
        const value = String(text || '');
        return value ? `${value.charAt(0).toLocaleUpperCase('es')}${value.slice(1)}` : value;
    }

    // Cuántos eventos del día quedan fuera de las barras de la celda del mes.
    function hiddenEventCount(total, visible = MONTH_VISIBLE_EVENTS) {
        return Math.max(0, Number(total || 0) - visible);
    }

    // Agenda: un evento que empezó antes del período (p. ej. un guest spot de
    // varios días) se agrupa en el primer día visible.
    function agendaGroupDate(start, from) {
        const value = asDate(start);
        if (!value) return startOfDay(from);
        return startOfDay(value < from ? from : value);
    }

    function formatShortDate(date) {
        return new Intl.DateTimeFormat('es-AR', {
            day: 'numeric', month: 'short',
        }).format(date).replace('.', '').toUpperCase();
    }

    function formatTime(date) {
        return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function formatHours(hours) {
        const rounded = Math.round(hours * 100) / 100;
        if (rounded === 1) return '1 hora';
        return `${String(rounded).replace('.', ',')} horas`;
    }

    function eventDates(event) {
        return { start: asDate(event.start), end: asDate(event.end) };
    }

    function overlaps(event, from, to) {
        const dates = eventDates(event);
        return dates.start && dates.end && dates.start < to && dates.end > from;
    }

    function eventClass(type) {
        return `type-${TYPE_META[type] ? type : 'personal'}`;
    }

    function getDisplayEvents() {
        const query = state.search.trim().toLocaleLowerCase('es');
        return state.events.filter((event) => {
            if (!state.enabledTypes.has(event.type) || event.status === 'cancelled') return false;
            if (!query) return true;
            const haystack = [event.title, event.clientName, event.location, event.notes, event.quoteCode]
                .filter(Boolean)
                .join(' ')
                .toLocaleLowerCase('es');
            return haystack.includes(query);
        });
    }

    function rangeForLoad() {
        if (state.view === 'agenda') {
            return { start: addDays(startOfMonth(state.currentDate), -7), end: addMonths(startOfMonth(state.currentDate), 13) };
        }
        const start = addDays(startOfMonth(state.currentDate), -7);
        return { start, end: addMonths(start, 5) };
    }

    async function waitForConfig() {
        if (!window.ConfigManager || typeof window.ConfigManager.ready !== 'function') return;
        await Promise.race([
            window.ConfigManager.ready(),
            new Promise((resolve) => window.setTimeout(resolve, 5000)),
        ]);
    }

    /* ------------------------------- URL state ------------------------------- */

    function eventParam(event) {
        if (!event) return null;
        if (event.sourceType === 'quotation_session') return `session:${event.sourceId}`;
        return event.baseId ? String(event.baseId) : event.id;
    }

    function findEventByParam(param) {
        const value = String(param || '').trim();
        if (!value) return null;
        return state.events.find((event) => event.id === value
            || (event.sourceType === 'manual' && String(event.baseId) === value)
            || (event.sourceType === 'quotation_session' && (`session:${event.sourceId}` === value || event.sourceId === value))
            || (event.sourceType === 'artist_trip' && (`trip:${event.sourceId}` === value || event.sourceId === value))) || null;
    }

    function quoteParam(quote) {
        if (!quote) return null;
        return quote.quote_id ? String(quote.quote_id) : String(quote.id);
    }

    function syncUrl() {
        const L = links();
        if (!L || !window.history || typeof window.history.replaceState !== 'function') return;
        const editorOpen = el['calendar-editor'] && !el['calendar-editor'].hidden;
        const focus = editorOpen ? state.selectedDate : state.currentDate;
        const query = L.buildUrlState({
            view: state.view,
            date: focus && !sameDay(focus, new Date()) ? dateKey(focus) : null,
            editor: editorOpen,
            type: state.selectedType,
            event: editorOpen ? eventParam(state.editingEvent) : null,
            quote: editorOpen ? quoteParam(state.selectedQuote) : null,
        });
        try {
            window.history.replaceState(window.history.state, '', `${window.location.pathname}${query}${window.location.hash || ''}`);
        } catch (_error) {
            /* Algunos visores (capturas, iframes) bloquean replaceState. */
        }
    }

    function updateViewTabs() {
        document.querySelectorAll('.cal-view-tabs [data-view]').forEach((tab) => {
            tab.setAttribute('aria-selected', String(tab.dataset.view === state.view));
        });
    }

    /* ------------------------------ inicialización ------------------------------ */

    async function initialize() {
        cacheElements();
        bindEvents();
        watchTimedEventFit();
        renderLegend();
        setLoading(true);

        const L = links();
        const urlState = L ? L.parseUrlState(window.location.search) : { editor: false };

        try {
            await waitForConfig();
            const D = window.WeotziData;
            const client = D?.getClient?.();
            if (!D?.Calendar || !client) throw new Error('No se pudo iniciar la conexión del calendario.');

            const { data: { session }, error } = await client.auth.getSession();
            if (error || !session) {
                window.location.href = buildArtistLoginUrl('/calendar');
                return;
            }

            state.user = session.user;
            const { data: artist, error: artistError } = await D.from('artists_db')
                .select('user_id, username, name')
                .eq('user_id', state.user.id)
                .maybeSingle();
            if (artistError || !artist) throw artistError || new Error('No encontramos tu perfil de artista.');
            state.artist = artist;

            const queryDate = parseLocalDate(urlState.date || new URLSearchParams(window.location.search).get('date'));
            // Fecha inicial: hoy, o ?date=YYYY-MM-DD (demos y QA).
            if (queryDate) state.currentDate = queryDate;
            state.selectedDate = startOfDay(state.currentDate);
            state.miniDate = startOfMonth(state.selectedDate);
            if (urlState.view) state.view = urlState.view;
            if (urlState.search) {
                state.search = urlState.search;
                el['calendar-search'].value = urlState.search;
            }
            updateViewTabs();

            await loadEvents();

            if (urlState.event) {
                const target = findEventByParam(urlState.event);
                if (target && target.readonly) openEventById(target.id);
                else if (target) await openEditor(target, null, { picker: urlState.picker });
                else showToast('No encontramos ese evento en el período visible.', true);
            } else if (urlState.editor) {
                await openEditor(null, queryDate, {
                    type: urlState.type,
                    quote: urlState.quote,
                    picker: urlState.picker,
                });
            }
        } catch (error) {
            console.error('[calendar] Error de inicialización:', error);
            el['calendar-view'].innerHTML = `<div class="cal-empty">${escapeHtml(error.message || 'No pudimos cargar el calendario.')}</div>`;
            el['calendar-summary'].textContent = 'No pudimos sincronizar tu agenda.';
        } finally {
            setLoading(false);
            el['calendar-view'].setAttribute('aria-busy', 'false');
        }
    }

    function bindEvents() {
        document.querySelectorAll('.cal-view-tabs [data-view]').forEach((button) => {
            button.addEventListener('click', async () => {
                state.view = button.dataset.view;
                updateViewTabs();
                syncUrl();
                await loadEvents();
            });
        });

        document.getElementById('cal-prev').addEventListener('click', () => navigate(-1));
        document.getElementById('cal-next').addEventListener('click', () => navigate(1));
        document.getElementById('new-event-button').addEventListener('click', () => openEditor());
        document.getElementById('editor-back').addEventListener('click', closeEditor);
        document.getElementById('cancel-event').addEventListener('click', closeEditor);
        document.getElementById('delete-event').addEventListener('click', deleteCurrentEvent);
        document.getElementById('mini-prev').addEventListener('click', () => {
            state.miniDate = addMonths(state.miniDate, -1);
            renderMiniCalendar();
        });
        document.getElementById('mini-next').addEventListener('click', () => {
            state.miniDate = addMonths(state.miniDate, 1);
            renderMiniCalendar();
        });
        el['calendar-search'].addEventListener('input', () => {
            state.search = el['calendar-search'].value;
            renderAll();
        });
        el['calendar-view'].addEventListener('click', onBoardClick);
        el['calendar-view'].addEventListener('keydown', (event) => {
            if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-date]')) {
                event.preventDefault();
                openEditor(null, parseLocalDate(event.target.dataset.date));
            }
        });
        el['upcoming-list'].addEventListener('click', onEventButtonClick);
        el['upcoming-list'].addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const target = event.target.closest('[data-event-id]');
            if (!target) return;
            event.preventDefault();
            openEventById(target.dataset.eventId);
        });
        el['event-type-picker'].addEventListener('click', (event) => {
            const button = event.target.closest('[data-type]');
            if (!button || state.editingEvent) return;
            chooseType(button.dataset.type);
        });
        el['event-type-picker'].addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || state.editingEvent) return;
            const buttons = [...el['event-type-picker'].querySelectorAll('[data-type]:not(:disabled)')];
            const current = buttons.indexOf(document.activeElement);
            if (current < 0) return;
            event.preventDefault();
            const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
            const next = buttons[(current + direction + buttons.length) % buttons.length];
            next.focus();
            chooseType(next.dataset.type);
        });
        el['calendar-event-form'].addEventListener('submit', saveCurrentEvent);
        el['event-fields'].addEventListener('input', (event) => {
            if (event.target.id === 'event-quote-search') onQuoteSearchInput(event);
            else onFormChanged();
        });
        el['event-fields'].addEventListener('change', (event) => {
            if (event.target.id !== 'event-quote-search') onFormChanged();
        });
        el['event-fields'].addEventListener('focusin', (event) => {
            if (event.target.id === 'event-quote-search') openQuotePicker();
        });
        el['event-fields'].addEventListener('keydown', onQuoteKeydown);
        el['event-fields'].addEventListener('mousedown', (event) => {
            // Evita que el input pierda el foco antes de elegir la opción.
            if (event.target.closest('#quote-listbox')) event.preventDefault();
        });
        el['event-fields'].addEventListener('click', (event) => {
            const option = event.target.closest('[data-quote-id]');
            if (option) {
                selectQuote(option.dataset.quoteId);
                return;
            }
            if (event.target.closest('[data-date-display]')) {
                el['mini-grid'].querySelector('.is-selected')?.focus();
            }
        });
        document.addEventListener('click', (event) => {
            if (!event.target.closest('.cal-quote-block')) closeQuotePicker();
        });
        el['mini-grid'].addEventListener('click', (event) => {
            const button = event.target.closest('[data-date]');
            if (!button) return;
            state.selectedDate = parseLocalDate(button.dataset.date);
            const input = document.getElementById('event-date');
            if (input) input.value = dateKey(state.selectedDate);
            renderMiniCalendar();
            onFormChanged();
        });
        document.getElementById('cal-logout')?.addEventListener('click', async () => {
            const client = window.WeotziData?.getClient?.();
            if (client) await client.auth.signOut();
            window.location.assign(appUrl('/'));
        });
    }

    async function navigate(direction) {
        if (state.view === 'month' || state.view === 'agenda') {
            state.currentDate = addMonths(state.currentDate, direction);
        } else if (state.view === 'week') {
            state.currentDate = addDays(state.currentDate, direction * 7);
        } else {
            state.currentDate = addDays(state.currentDate, direction);
        }
        state.selectedDate = startOfDay(state.currentDate);
        syncUrl();
        await loadEvents();
    }

    async function loadEvents() {
        if (!state.user) return;
        el['calendar-view'].setAttribute('aria-busy', 'true');
        try {
            const range = rangeForLoad();
            state.events = await window.WeotziData.Calendar.listRange(state.user.id, range.start, range.end);
            renderAll();
        } catch (error) {
            console.error('[calendar] No se pudieron cargar eventos:', error);
            showToast(error.message || 'No se pudieron cargar los eventos.', true);
            renderAll();
        } finally {
            el['calendar-view'].setAttribute('aria-busy', 'false');
        }
    }

    /* --------------------------------- vistas --------------------------------- */

    function renderAll() {
        el['calendar-page'].dataset.view = state.view;
        updatePeriodLabel();
        updateHeaderSummary();
        if (state.view === 'month') renderMonth();
        else if (state.view === 'week') renderTimeGrid(7);
        else if (state.view === 'day') renderTimeGrid(1);
        else renderAgenda();
        renderUpcoming();
    }

    function updatePeriodLabel() {
        let label = formatMonthYear(state.currentDate);
        if (state.view === 'week') {
            const start = mondayOfWeek(state.currentDate);
            const end = addDays(start, 6);
            label = start.getMonth() === end.getMonth()
                ? `${start.getDate()} – ${end.getDate()} ${MONTHS[end.getMonth()]}`
                : `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]}`;
        } else if (state.view === 'day') {
            const weekday = new Intl.DateTimeFormat('es-AR', { weekday: 'long' }).format(state.currentDate);
            label = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${state.currentDate.getDate()} ${MONTHS[state.currentDate.getMonth()]}`;
        }
        el['cal-period-label'].textContent = label;
    }

    function monthCounters() {
        const from = startOfMonth(state.currentDate);
        const to = endOfMonth(state.currentDate);
        const inMonth = state.events.filter((event) => overlaps(event, from, to));
        return {
            confirmed: inMonth.filter((event) => event.type === 'confirmed_session').length,
            pending: inMonth.filter((event) => event.type === 'pending_request' || (event.type === 'reservation' && event.status !== 'scheduled')).length,
            blocked: new Set(inMonth
                .filter((event) => event.type === 'blocked_day')
                .map((event) => dateKey(asDate(event.start)))).size,
        };
    }

    function plural(count, singular, pluralForm) {
        return `${count} ${count === 1 ? singular : pluralForm}`;
    }

    function updateHeaderSummary() {
        const { confirmed, pending, blocked } = monthCounters();
        el['calendar-summary'].textContent = `${plural(confirmed, 'turno confirmado', 'turnos confirmados')}, ${plural(pending, 'solicitud esperando respuesta', 'solicitudes esperando respuesta')} y ${plural(blocked, 'día bloqueado', 'días bloqueados')} este mes.`;
    }

    function renderLegend() {
        el['calendar-legend'].innerHTML = TYPE_ORDER.map((type) => `
            <button type="button" class="${eventClass(type)}" data-type="${type}" aria-pressed="true">
                ${escapeHtml(TYPE_META[type].label)}
            </button>
        `).join('');
        el['calendar-legend'].addEventListener('click', (event) => {
            const button = event.target.closest('[data-type]');
            if (!button) return;
            const type = button.dataset.type;
            if (state.enabledTypes.has(type)) state.enabledTypes.delete(type);
            else state.enabledTypes.add(type);
            button.setAttribute('aria-pressed', String(state.enabledTypes.has(type)));
            renderAll();
        });
    }

    function eventsForDay(date, source = getDisplayEvents()) {
        const from = startOfDay(date);
        const to = endOfDay(date);
        return source.filter((event) => overlaps(event, from, to));
    }

    function renderMonth() {
        const monthStart = startOfMonth(state.currentDate);
        const gridStart = mondayOfWeek(monthStart);
        const monthEnd = endOfMonth(state.currentDate);
        let gridEnd = mondayOfWeek(monthEnd);
        if (gridEnd < monthEnd) gridEnd = addDays(gridEnd, 7);
        const days = [];
        for (let date = new Date(gridStart); date < gridEnd; date = addDays(date, 1)) days.push(date);

        const headers = WEEKDAYS.map((day) => `<div class="cal-month-weekday">${day}</div>`).join('');
        const cells = days.map((date) => {
            const dayEvents = eventsForDay(date);
            const outside = date.getMonth() !== state.currentDate.getMonth();
            const eventsHtml = dayEvents.slice(0, MONTH_VISIBLE_EVENTS).map((event) => `
                <button type="button" class="cal-event ${eventClass(event.type)}" data-event-id="${escapeAttr(event.id)}" title="${escapeAttr(event.title)}">
                    ${escapeHtml(event.title)}
                </button>
            `).join('');
            const hidden = hiddenEventCount(dayEvents.length);
            const more = hidden ? `<span class="cal-more" title="${escapeAttr(`${hidden} ${hidden === 1 ? 'evento más' : 'eventos más'}`)}">+${hidden}</span>` : '';
            return `
                <div class="cal-month-day${outside ? ' is-outside' : ''}${sameDay(date, new Date()) ? ' is-today' : ''}${sameDay(date, state.selectedDate) ? ' is-selected' : ''}">
                    <button type="button" class="cal-day-number" data-date="${dateKey(date)}" aria-label="Agregar evento el ${escapeAttr(formatLongDate(date))}">${date.getDate()}</button>
                    <div class="cal-month-events">${eventsHtml}${more}</div>
                </div>
            `;
        }).join('');
        el['calendar-view'].innerHTML = `<div class="cal-month">${headers}${cells}</div>`;
    }

    function renderTimeGrid(columns) {
        const start = columns === 7 ? mondayOfWeek(state.currentDate) : startOfDay(state.currentDate);
        const dates = Array.from({ length: columns }, (_, index) => addDays(start, index));
        const visible = getDisplayEvents();
        const heads = columns === 1 ? '' : dates.map((date) => `
            <div class="cal-time-head${sameDay(date, state.currentDate) ? ' is-selected' : ''}">
                <span>${WEEKDAYS[(date.getDay() + 6) % 7]}</span>
                <strong>${date.getDate()}</strong>
            </div>
        `).join('');
        const hourLabels = Array.from({ length: HOUR_END - HOUR_START }, (_, index) => {
            const hour = HOUR_START + index;
            return `<span class="cal-time-hour-label" style="top:${index * (100 / (HOUR_END - HOUR_START))}%">${pad(hour)}:00</span>`;
        }).join('');
        const dayColumns = dates.map((date) => {
            const dayEvents = eventsForDay(date, visible).filter((event) => !event.allDay);
            const eventHtml = dayEvents.map((event) => renderTimedEvent(event, date, columns === 1)).join('');
            return `<div class="cal-time-column" data-date="${dateKey(date)}">${eventHtml}</div>`;
        }).join('');
        // Los eventos de todo el día van en una franja propia entre la cabecera
        // y las 09:00: no se superponen con los turnos de la mañana.
        const allDayByDate = dates.map((date) => eventsForDay(date, visible).filter((event) => event.allDay));
        const hasAllDay = allDayByDate.some((rows) => rows.length);
        const allDayRow = hasAllDay ? `
            <div class="cal-time-allday-label">Todo el día</div>
            ${dates.map((date, index) => `
                <div class="cal-time-allday" data-date="${dateKey(date)}">${allDayByDate[index].map((event) => `
                    <button type="button" class="cal-event cal-event--allday ${eventClass(event.type)}" data-event-id="${escapeAttr(event.id)}" title="${escapeAttr(`Todo el día · ${event.title}`)}">${escapeHtml(event.title)}</button>
                `).join('')}</div>
            `).join('')}
        ` : '';
        const dayTitle = columns === 1 ? `
            <header class="cal-day-board-title">
                <span>${escapeHtml(new Intl.DateTimeFormat('es-AR', { weekday: 'long' }).format(start))}</span>
                <strong>${start.getDate()} de ${MONTHS[start.getMonth()]}</strong>
            </header>
        ` : '';
        el['calendar-view'].innerHTML = `${dayTitle}
            <div class="cal-time-grid${columns === 1 ? ' cal-time-grid--day' : ''}${hasAllDay ? ' has-allday' : ''}" style="--time-columns:${columns}">
                ${columns === 1 ? '' : '<div class="cal-time-corner"></div>'}
                ${heads}
                ${allDayRow}
                <div class="cal-time-hours">${hourLabels}</div>
                ${dayColumns}
            </div>
        `;
        fitTimedEvents();
    }

    function renderTimedEvent(event, day, isDayView = false) {
        const { start, end } = eventDates(event);
        const dayStart = startOfDay(day);
        const visibleStart = new Date(dayStart);
        visibleStart.setHours(HOUR_START, 0, 0, 0);
        const visibleEnd = new Date(dayStart);
        visibleEnd.setHours(HOUR_END, 0, 0, 0);
        let top;
        let height;
        if (event.allDay) {
            top = 0;
            height = 4.5;
        } else {
            const clippedStart = start < visibleStart ? visibleStart : start;
            const clippedEnd = end > visibleEnd ? visibleEnd : end;
            const totalMinutes = (HOUR_END - HOUR_START) * 60;
            top = Math.max(0, ((clippedStart - visibleStart) / 60000) / totalMinutes * 100);
            height = Math.max(3.5, ((clippedEnd - clippedStart) / 60000) / totalMinutes * 100);
            if (top >= 100) {
                top = 96.5;
                height = 3.5;
            }
        }
        const time = event.allDay ? 'Todo el día' : `${formatTime(start)}–${formatTime(end)}`;
        const eventType = TYPE_META[event.type]?.label || 'Evento';
        const timeLabel = isDayView ? `${time} · ${eventType}` : time;
        const client = isDayView && event.clientName
            ? `<small>${escapeHtml(event.clientName)}</small>`
            : '';
        // La hora de inicio va aparte: en un bloque corto (formato compacto)
        // queda "09:30 Título…" en una sola línea.
        const startLabel = event.allDay ? time : formatTime(start);
        const restLabel = timeLabel.slice(startLabel.length);
        return `
            <button type="button" class="cal-event ${eventClass(event.type)}" data-event-id="${escapeAttr(event.id)}"
                    style="top:${top}%;height:${height}%" title="${escapeAttr(`${time} · ${event.title}`)}">
                <span class="cal-event-time">${escapeHtml(startLabel)}<span class="cal-event-time-rest">${escapeHtml(restLabel)}</span></span><strong>${escapeHtml(event.title)}</strong>${client}
            </button>
        `;
    }

    // Alto del bloque vs. contenido. Un turno de 30 min mide 26,4 px en la
    // semana y 32,8 px en el día, y hora + título necesitan ~33 / ~47 px: en
    // vez de cortar el texto a la mitad se elige un formato que entre.
    //   compact     → una sola línea "09:30 Título…" (no entra hora + título)
    //   titleLines  → líneas de título que entran completas (con elipsis)
    //   showClient  → el cliente (vista día) entra debajo de una línea de título
    function timedEventLayout(metrics) {
        const m = metrics || {};
        const num = (value) => (Number.isFinite(value) ? value : 0);
        const titleLine = num(m.titleLine) || 13;
        const clientLine = num(m.clientLine);
        const tolerance = 0.5;
        const available = num(m.height) - num(m.padding) - num(m.timeLine) - num(m.titleGap) + tolerance;
        if (available < titleLine) return { compact: true, titleLines: 1, showClient: false };
        const showClient = clientLine > 0 && available >= titleLine + clientLine;
        const titleLines = Math.max(1, Math.floor((available - (showClient ? clientLine : 0)) / titleLine));
        return { compact: false, titleLines, showClient };
    }

    function cssPx(value, fallback = 0) {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function lineHeightOf(node) {
        if (!node) return 0;
        const style = getComputedStyle(node);
        return cssPx(style.lineHeight, cssPx(style.fontSize, 12) * 1.2);
    }

    function fitTimedEvents() {
        const view = el['calendar-view'];
        if (!view || (state.view !== 'week' && state.view !== 'day')) return;
        view.querySelectorAll('.cal-time-column .cal-event').forEach((button) => {
            button.classList.remove('is-compact', 'is-client-hidden');
            button.style.removeProperty('--title-lines');
            const height = button.clientHeight;
            if (!height) return; // vista oculta: se vuelve a medir al mostrarse
            const style = getComputedStyle(button);
            const title = button.querySelector('strong');
            const client = button.querySelector('small');
            const layout = timedEventLayout({
                height,
                padding: cssPx(style.paddingTop) + cssPx(style.paddingBottom),
                timeLine: lineHeightOf(button.querySelector('.cal-event-time')),
                titleGap: title ? cssPx(getComputedStyle(title).marginTop) : 0,
                titleLine: lineHeightOf(title),
                clientLine: client ? lineHeightOf(client) + cssPx(getComputedStyle(client).marginTop) : 0,
            });
            button.classList.toggle('is-compact', layout.compact);
            button.classList.toggle('is-client-hidden', !!client && !layout.showClient);
            if (!layout.compact) button.style.setProperty('--title-lines', String(layout.titleLines));
        });
    }

    let fitObserver = null;
    function watchTimedEventFit() {
        const view = el['calendar-view'];
        if (!view) return;
        if (typeof ResizeObserver === 'function') {
            fitObserver = fitObserver || new ResizeObserver(() => fitTimedEvents());
            fitObserver.observe(view);
        } else {
            let frame = 0;
            window.addEventListener('resize', () => {
                window.cancelAnimationFrame(frame);
                frame = window.requestAnimationFrame(fitTimedEvents);
            });
        }
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTimedEvents).catch(() => {});
    }

    function renderAgenda() {
        const from = startOfMonth(state.currentDate);
        const to = addMonths(from, 1);
        const events = getDisplayEvents().filter((event) => overlaps(event, from, to));
        if (!events.length) {
            el['calendar-view'].innerHTML = '<div class="cal-empty">No hay eventos para este período.</div>';
            return;
        }
        const groups = new Map();
        events.forEach((event) => {
            const key = dateKey(agendaGroupDate(event.start, from));
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(event);
        });
        const dayFormat = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
        el['calendar-view'].innerHTML = `<div class="cal-agenda">${[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => {
            const date = parseLocalDate(key);
            return `
                <section class="cal-agenda-day">
                    <h3>${escapeHtml(capitalize(dayFormat.format(date)))}</h3>
                    ${rows.map((event) => {
                        const { start, end } = eventDates(event);
                        const context = [TYPE_META[event.type]?.label, event.location, event.quoteCode].filter(Boolean).join(' · ');
                        return `
                            <button type="button" class="cal-agenda-event ${eventClass(event.type)}" data-event-id="${escapeAttr(event.id)}">
                                <time>${event.allDay ? 'Todo el día' : `${formatTime(start)}–${formatTime(end)}`}</time>
                                <i aria-hidden="true"></i>
                                <span><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(context)}</small></span>
                            </button>
                        `;
                    }).join('')}
                </section>
            `;
        }).join('')}</div>`;
    }

    function renderUpcoming() {
        const viewStart = startOfDay(state.currentDate);
        const events = getDisplayEvents()
            .filter((event) => asDate(event.end) > viewStart)
            .slice(0, 6);
        el['upcoming-list'].innerHTML = events.length ? events.map((event) => {
            const { start } = eventDates(event);
            return `
                <div class="cal-upcoming-item ${eventClass(event.type)}" data-event-id="${escapeAttr(event.id)}" role="button" tabindex="0">
                    <div>
                        <time>${formatShortDate(start)} · ${event.allDay ? 'Todo el día' : formatTime(start)}</time>
                        <strong>${escapeHtml(event.title)}</strong>
                    </div>
                </div>
            `;
        }).join('') : '<p class="cal-upcoming-empty">Sin próximos eventos en este período.</p>';

        const { confirmed, pending, blocked } = monthCounters();
        el['upcoming-summary'].textContent = `${pending} ${pending === 1 ? 'pendiente' : 'pendientes'} de confirmar · ${plural(blocked, 'día bloqueado', 'días bloqueados')} · ${plural(confirmed, 'turno confirmado', 'turnos confirmados')} en total.`;
    }

    function onBoardClick(event) {
        const eventButton = event.target.closest('[data-event-id]');
        if (eventButton) {
            openEventById(eventButton.dataset.eventId);
            return;
        }
        const day = event.target.closest('[data-date]');
        if (day) openEditor(null, parseLocalDate(day.dataset.date));
    }

    function onEventButtonClick(event) {
        const target = event.target.closest('[data-event-id]');
        if (target) openEventById(target.dataset.eventId);
    }

    function openEventById(id) {
        const event = state.events.find((row) => row.id === id);
        if (!event) return;
        if (event.readonly) {
            // Las citas que agenda un estudio se gestionan desde su panel.
            if (event.sourceType === 'studio_booking') {
                showToast(`${event.title} · la gestiona el estudio`);
                return;
            }
            // Los viajes se administran en Travel: abrimos su itinerario.
            if (event.href) {
                window.location.href = appUrl(event.href);
                return;
            }
            showToast(`${event.title} · se administra desde Travel.`);
            return;
        }
        openEditor(event);
    }

    /* --------------------------------- editor --------------------------------- */

    function editorTypeFor(event) {
        if (!event) return null;
        if (event.sourceType === 'quotation_session') return 'confirmed_session';
        if (event.type === 'reservation' && event.quotationId) return 'confirmed_session';
        return event.type;
    }

    function editingValues() {
        const event = state.editingEvent;
        if (!event) return {};
        if (event.sourceType === 'quotation_session') {
            return {
                title: event.title,
                client_name: event.clientName,
                notes: event.raw?.session?.notes || '',
                location: event.location,
                all_day: false,
                recurrence_rule: 'none',
                status: 'scheduled',
            };
        }
        return event.raw || {};
    }

    function isLegacyManualTurno() {
        const event = state.editingEvent;
        return !!event && event.sourceType === 'manual' && event.type === 'confirmed_session' && !event.quotationId;
    }

    async function openEditor(event = null, date = null, options = {}) {
        state.editingEvent = event && !event.readonly ? event : null;
        const requestedType = options.type && MANUAL_TYPES.includes(options.type) ? options.type : null;
        state.selectedType = state.editingEvent ? editorTypeFor(state.editingEvent) : requestedType;
        state.selectedDate = date || (state.editingEvent ? startOfDay(asDate(state.editingEvent.start)) : startOfDay(state.currentDate));
        state.miniDate = startOfMonth(state.selectedDate);
        state.selectedQuote = null;
        state.quoteQuery = '';
        state.activeQuoteId = null;
        el['calendar-page'].hidden = true;
        el['calendar-editor'].hidden = false;
        el['editor-heading'].textContent = state.editingEvent ? 'Editar evento' : 'Agregar al calendario';
        el['delete-event'].hidden = !state.editingEvent;
        el['event-form-error'].textContent = '';
        clearConflict();
        renderTypePicker();
        renderEventFields();
        renderMiniCalendar();
        updateFormSummary();
        checkConflicts();
        syncUrl();
        window.scrollTo({ top: 0, behavior: 'instant' });

        if (state.selectedType !== 'confirmed_session' && !options.quote) return;
        await ensureQuotes();
        if (el['calendar-editor'].hidden) return;

        if (state.editingEvent?.quotationId) {
            state.selectedQuote = findQuote(state.editingEvent.quotationId)
                || state.editingEvent.raw?.quotation
                || null;
        } else if (options.quote) {
            const quote = (state.quotes || []).find((row) => links()?.matchesQuoteParam(row, options.quote));
            const status = quote ? links()?.classifyQuote(quote) : null;
            if (quote && status && status.group !== 'unavailable') {
                state.selectedQuote = quote;
                if (state.selectedType !== 'confirmed_session') {
                    state.selectedType = 'confirmed_session';
                    renderTypePicker();
                }
            } else {
                showToast(quote
                    ? `${links()?.quoteCode(quote) || 'Esa cotización'} no se puede agendar: ${status?.reason || 'no está disponible'}.`
                    : 'No encontramos esa cotización entre las tuyas.', true);
            }
        }
        renderEventFields();
        updateFormSummary();
        checkConflicts();
        syncUrl();
        if (options.picker) {
            openQuotePicker();
            document.getElementById('event-quote-search')?.focus({ preventScroll: true });
        }
    }

    function closeEditor() {
        closeQuotePicker();
        el['calendar-editor'].hidden = true;
        el['calendar-page'].hidden = false;
        state.editingEvent = null;
        state.selectedType = null;
        state.selectedQuote = null;
        clearConflict();
        renderAll();
        syncUrl();
        window.scrollTo({ top: 0, behavior: 'instant' });
    }

    function chooseType(type) {
        if (!MANUAL_TYPES.includes(type)) return;
        state.selectedType = type;
        if (type !== 'confirmed_session') state.selectedQuote = null;
        renderTypePicker();
        renderEventFields();
        updateFormSummary();
        scheduleConflictCheck();
        syncUrl();
        const first = el['event-fields'].querySelector('input:not([type="hidden"]), select, textarea');
        first?.focus({ preventScroll: true });
        if (type === 'confirmed_session') {
            ensureQuotes().then(() => {
                renderQuoteListbox();
                updateQuoteHint();
            });
        }
    }

    function renderTypePicker() {
        el['event-type-picker'].querySelectorAll('[data-type]').forEach((button) => {
            const selected = button.dataset.type === state.selectedType;
            button.setAttribute('aria-checked', String(selected));
            button.disabled = !!state.editingEvent && !selected;
            button.className = eventClass(button.dataset.type);
        });
    }

    function field(label, name, input, required = false, extraClass = '') {
        return `<div class="cal-field ${extraClass}"><label for="${name}">${label}${required ? ' <em>*</em>' : ''}</label>${input}</div>`;
    }

    function textInput(name, value, placeholder, required = false, icon = '', attrs = '') {
        const input = `<input id="${name}" name="${name}" type="text" value="${escapeAttr(value || '')}" placeholder="${escapeAttr(placeholder)}" maxlength="180"${required ? ' required' : ''}${attrs}>`;
        return icon ? `<span class="cal-input-with-icon"><i data-wo-icon="${escapeAttr(icon)}" aria-hidden="true"></i>${input}</span>` : input;
    }

    function selectControl(name, optionsHtml) {
        return `<span class="cal-select"><select id="${name}" name="${name}">${optionsHtml}</select><i data-wo-icon="chevron-down" aria-hidden="true"></i></span>`;
    }

    function buildCommonDateFields(raw) {
        const start = state.editingEvent ? asDate(state.editingEvent.start) : null;
        const selected = start || state.selectedDate;
        const dateValue = dateKey(selected);
        const timeValue = start && !state.editingEvent.allDay ? formatTime(start) : '10:00';
        return {
            date: field('Fecha', 'event-date-display', `
                <span class="cal-input-with-icon cal-date-control">
                    <i data-wo-icon="calendar" aria-hidden="true"></i>
                    <button id="event-date-display" type="button" data-date-display>${escapeHtml(formatLongDate(selected))}</button>
                    <input id="event-date" name="event-date" type="hidden" value="${dateValue}">
                </span>
            `, true),
            time: field('Hora de inicio', 'event-time', timeSelect(timeValue), false, 'cal-field--time'),
            notes: field('Notas', 'event-notes', `<textarea id="event-notes" name="event-notes" placeholder="Detalles adicionales…">${escapeHtml(raw?.notes || '')}</textarea>`),
        };
    }

    function durationSelect(value) {
        const durations = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8];
        const current = Number(value || 1);
        const list = durations.includes(current) ? durations : [...durations, current].sort((a, b) => a - b);
        return selectControl('event-duration', list.map((duration) => `
            <option value="${duration}"${current === duration ? ' selected' : ''}>${formatHours(duration)}</option>
        `).join(''));
    }

    function locationSelect() {
        return selectControl('event-location', `
            <option value="Estudio propio">Estudio propio</option>
            <option value="A domicilio">A domicilio</option>
            <option value="Otro estudio">Otro estudio</option>
        `);
    }

    function toggleField(name, title, copy, checked) {
        return `
            <label class="cal-toggle-row" for="${name}">
                <span class="cal-toggle-copy"><strong>${title}</strong><span>${copy}</span></span>
                <span class="cal-switch"><input id="${name}" name="${name}" type="checkbox" role="switch"${checked ? ' checked' : ''}><span></span></span>
            </label>
        `;
    }

    function checkboxField(name, copy, checked) {
        return `
            <label class="cal-checkbox-row" for="${name}">
                <input id="${name}" name="${name}" type="checkbox"${checked ? ' checked' : ''}>
                <span>${copy}</span>
            </label>
        `;
    }

    function timeSelect(value) {
        const options = [];
        for (let hour = 0; hour < 24; hour += 1) {
            for (const minute of [0, 30]) {
                const optionValue = `${pad(hour)}:${pad(minute)}`;
                const period = hour < 12 ? 'a. m.' : 'p. m.';
                const hour12 = hour % 12 || 12;
                options.push(`<option value="${optionValue}"${optionValue === value ? ' selected' : ''}>${hour12}:${pad(minute)} ${period}</option>`);
            }
        }
        if (!options.some((option) => option.includes(`value="${value}"`))) {
            const [hour, minute] = String(value).split(':').map(Number);
            options.push(`<option value="${value}" selected>${(hour % 12) || 12}:${pad(minute)} ${hour < 12 ? 'a. m.' : 'p. m.'}</option>`);
        }
        return `<select class="cal-time-select" id="event-time" name="event-time" required>${options.join('')}</select>`;
    }

    function quoteDisplay(quote) {
        if (!quote) return '';
        const L = links();
        const project = L ? L.quoteProject(quote) : '';
        return [quote.client_full_name, project, L ? L.quoteCode(quote) : ''].filter(Boolean).join(' · ');
    }

    function renderQuoteLink() {
        const quote = state.selectedQuote;
        return `
            <div class="cal-quote-block">
                <div class="cal-quote-link">
                    <label class="cal-quote-label" for="event-quote-search">Cotización a vincular${isLegacyManualTurno() ? '' : ' <em>*</em>'}</label>
                    <div class="cal-quote-combo">
                        <input id="event-quote-search" type="text" role="combobox" autocomplete="off"
                               aria-autocomplete="list" aria-expanded="false" aria-controls="quote-listbox"
                               aria-describedby="quote-hint"
                               placeholder="Buscá por cliente, proyecto o número de cotización"
                               value="${escapeAttr(quoteDisplay(quote))}">
                        <input id="event-quote-id" name="event-quote-id" type="hidden" value="${escapeAttr(quote ? quote.id : '')}">
                    </div>
                    <p class="cal-quote-hint" id="quote-hint" hidden>${escapeHtml(QUOTE_HINT)}</p>
                    <div class="cal-quote-listbox" id="quote-listbox" role="listbox" aria-label="Cotizaciones" hidden></div>
                </div>
                <p class="cal-quote-create" hidden>¿Todavía no cargaste este trabajo? <a href="${escapeAttr(manualQuoteHref())}">Crear cotización manual</a></p>
            </div>
        `;
    }

    function renderEventFields() {
        if (!state.selectedType) {
            el['event-form-empty'].hidden = false;
            el['event-fields'].hidden = true;
            el['event-fields'].innerHTML = '';
            el['save-event'].disabled = true;
            return;
        }

        const raw = editingValues();
        const common = buildCommonDateFields(raw);
        const durationHours = state.editingEvent
            ? Math.max(0.5, (asDate(state.editingEvent.end) - asDate(state.editingEvent.start)) / 3600000)
            : 1;
        const currentTitle = raw.title || state.editingEvent?.title || '';
        let html = '';

        if (state.selectedType === 'confirmed_session') {
            const quote = state.selectedQuote;
            const client = quote?.client_full_name || raw.client_name || state.editingEvent?.clientName || '';
            html = `
                ${renderQuoteLink()}
                ${field('Cliente', 'event-client', textInput('event-client', client, 'Nombre del cliente', true, 'user', quote ? ' readonly' : ''), true)}
                <div class="cal-field-grid">${common.date}${common.time}</div>
                ${field('Duración', 'event-duration', durationSelect(durationHours))}
                ${field('Ubicación', 'event-location', locationSelect())}
                ${common.notes}
            `;
        } else if (state.selectedType === 'reservation') {
            const client = raw.client_name || state.editingEvent?.clientName || '';
            html = `
                ${field('Cliente', 'event-client', textInput('event-client', client, 'Nombre del cliente', true, 'user'), true)}
                <div class="cal-field-grid">${common.date}${common.time}</div>
                ${field('Duración', 'event-duration', durationSelect(durationHours))}
                ${field('Ubicación', 'event-location', locationSelect())}
                ${common.notes}
                ${checkboxField('event-confirmed', 'La reserva ya está confirmada por el cliente', raw.status === 'scheduled')}
            `;
        } else if (state.selectedType === 'availability') {
            html = `
                ${field('Título', 'event-title', textInput('event-title', currentTitle, 'Título del evento', true), true)}
                <div class="cal-field-grid">${common.date}${common.time}</div>
                ${toggleField('event-recurring', 'Se repite', 'Repetir este evento todas las semanas', raw.recurrence_rule === 'weekly')}
                ${common.notes}
            `;
        } else if (state.selectedType === 'blocked_day') {
            const allDay = raw.all_day !== false;
            html = `
                ${field('Motivo', 'event-title', textInput('event-title', currentTitle, 'Ej: Vacaciones, mantenimiento…', true), true)}
                <div class="cal-field-grid cal-field-grid--blocked">${common.date}<div class="cal-blocked-time"${allDay ? ' hidden' : ''}>${common.time}</div></div>
                ${toggleField('event-all-day', 'Todo el día', 'El evento ocupa toda la jornada', allDay)}
                ${common.notes}
            `;
        } else if (state.selectedType === 'guest_spot') {
            html = `
                ${field('Estudio', 'event-title', textInput('event-title', currentTitle.replace(/^Guest en\s+/i, ''), 'Nombre del estudio', false, 'briefcase'))}
                <div class="cal-field-grid">${common.date}${common.time}</div>
                ${toggleField('event-all-day', 'Todo el día', 'El evento ocupa toda la jornada', !!raw.all_day)}
                ${common.notes}
            `;
        } else if (state.selectedType === 'convention') {
            html = `
                ${field('Nombre del evento', 'event-title', textInput('event-title', currentTitle, 'Ej: Feria Tinta Buenos Aires', true), true)}
                <div class="cal-field-grid">${common.date}${common.time}</div>
                ${toggleField('event-all-day', 'Todo el día', 'El evento ocupa toda la jornada', !!raw.all_day)}
                ${common.notes}
            `;
        } else if (state.selectedType === 'reminder') {
            html = `
                ${field('Título', 'event-title', textInput('event-title', currentTitle, 'Título del evento', true), true)}
                <div class="cal-field-grid">${common.date}${common.time}</div>
                ${toggleField('event-recurring', 'Se repite', 'Repetir este evento todas las semanas', raw.recurrence_rule === 'weekly')}
                ${common.notes}
            `;
        } else {
            html = `
                ${field('Título', 'event-title', textInput('event-title', currentTitle, 'Título del evento', true), true)}
                <div class="cal-field-grid">${common.date}${common.time}</div>
                ${toggleField('event-all-day', 'Todo el día', 'El evento ocupa toda la jornada', !!raw.all_day)}
                ${common.notes}
            `;
        }

        el['event-fields'].innerHTML = `<div class="cal-fields cal-fields--${state.selectedType}">${html}</div>`;
        el['event-fields'].hidden = false;
        el['event-form-empty'].hidden = true;
        el['save-event'].disabled = false;

        const location = document.getElementById('event-location');
        if (location && raw.location) {
            if (![...location.options].some((option) => option.value === raw.location)) {
                location.insertAdjacentHTML('beforeend', `<option value="${escapeAttr(raw.location)}">${escapeHtml(raw.location)}</option>`);
            }
            location.value = raw.location;
        }
        const time = document.getElementById('event-time');
        if (time) time.disabled = !!document.getElementById('event-all-day')?.checked;
        if (state.selectedType === 'confirmed_session') {
            renderQuoteListbox();
            updateQuoteHint();
        }
    }

    /* ----------------------- cotización a vincular (801:547) ----------------------- */

    function findQuote(id) {
        return (state.quotes || []).find((quote) => String(quote.id) === String(id)) || null;
    }

    function ensureQuotes() {
        if (state.quotes) return Promise.resolve(state.quotes);
        if (!state.user || !window.WeotziData?.Calendar?.listLinkableQuotes) {
            state.quotes = [];
            return Promise.resolve(state.quotes);
        }
        if (!state.quotesPromise) {
            state.quotesPromise = window.WeotziData.Calendar.listLinkableQuotes(state.user.id)
                .then((result) => {
                    state.quotes = result.quotes || [];
                    state.quoteSessions = result.sessionsByQuoteId || new Map();
                    state.quotesError = '';
                    return state.quotes;
                })
                .catch((error) => {
                    console.warn('[calendar] No se pudieron cargar las cotizaciones:', error);
                    state.quotes = [];
                    state.quotesError = 'No pudimos cargar tus cotizaciones. Probá de nuevo en un rato.';
                    return state.quotes;
                })
                .finally(() => { state.quotesPromise = null; });
        }
        return state.quotesPromise;
    }

    function invalidateQuotes() {
        state.quotes = null;
        state.quoteSessions = new Map();
    }

    function quoteGroup(quote) {
        return quote ? links()?.classifyQuote(quote)?.group || null : null;
    }

    function resolveSaveTarget() {
        if (state.selectedType !== 'confirmed_session') return 'manual';
        const editing = state.editingEvent;
        const quote = state.selectedQuote;
        if (editing && quote && editing.quotationId && String(editing.quotationId) === String(quote.id)) {
            if (editing.sourceType === 'quotation_session') return 'session';
            if (editing.type === 'reservation') return quoteGroup(quote) === 'approved' ? 'session' : 'reservation';
        }
        if (!quote) return editing?.sourceType === 'quotation_session' ? 'session' : 'manual';
        return links()?.saveTarget('confirmed_session', quote) || 'manual';
    }

    function updateQuoteHint() {
        const hint = document.getElementById('quote-hint');
        if (!hint) return;
        const quote = state.selectedQuote;
        const code = quote ? links()?.quoteCode(quote) : '';
        const target = resolveSaveTarget();
        let text = QUOTE_HINT;
        let tone = '';
        if (state.quotesError) {
            text = state.quotesError;
            tone = 'error';
        } else if (quote && target === 'session') {
            text = `Se agenda como sesión de ${code}: también la vas a ver en el detalle de la cotización.`;
        } else if (quote && target === 'reservation') {
            text = `${code} todavía no está aprobada: el turno se guarda como reserva pendiente.`;
            tone = 'warning';
        } else if (isLegacyManualTurno()) {
            text = 'Este turno no está vinculado a una cotización. Podés vincularlo ahora.';
        }
        hint.textContent = text;
        hint.dataset.tone = tone;
        // 801:547: con la lista cerrada solo se ve el campo. La ayuda genérica
        // y la confirmación "Se agenda como sesión…" quedan como descripción
        // accesible (aria-describedby); solo se ven los avisos que piden
        // atención: reserva pendiente, error de carga y turno heredado.
        hint.hidden = !isVisibleQuoteNotice(text, tone);
        updateQuoteCreate();
    }

    function isVisibleQuoteNotice(text, tone) {
        if (text === QUOTE_HINT) return false;
        return tone === 'warning' || tone === 'error' || isLegacyManualTurno();
    }

    // "Crear cotización manual" fijo debajo del campo: solo cuando no hay
    // ninguna cotización agendable. Después de intentar guardar sin cotización
    // el link va dentro del aviso de error (no se repite acá) y en la lista
    // abierta está en el estado vacío.
    function updateQuoteCreate() {
        const create = el['event-fields']?.querySelector('.cal-quote-create');
        if (!create) return;
        const nothingToLink = Array.isArray(state.quotes)
            && !state.quotes.some((quote) => { const group = quoteGroup(quote); return group && group !== 'unavailable'; });
        const errorHasLink = !!el['event-form-error']?.querySelector?.('a');
        create.hidden = !nothingToLink || errorHasLink;
    }

    // Cotización manual desde el calendario: la hoja abre como cita y precarga
    // la fecha elegida (?origen=cita&fecha=AAAA-MM-DD); Cancelar vuelve acá.
    function manualQuoteHref() {
        const params = new URLSearchParams({ origen: 'cita', fecha: dateKey(state.selectedDate || new Date()) });
        return appUrl(`${MANUAL_QUOTE_PATH}?${params.toString()}`);
    }

    function manualQuoteLink() {
        return `<a href="${escapeAttr(manualQuoteHref())}">Crear cotización manual</a>`;
    }

    function renderQuoteListbox() {
        const box = document.getElementById('quote-listbox');
        if (!box) return;
        const L = links();
        if (!state.quotes || !L) {
            state.quoteOptions = [];
            box.innerHTML = '<p class="cal-quote-empty">Cargando tus cotizaciones…</p>';
            return;
        }
        const groups = L.buildQuoteOptions(state.quotes, state.quoteSessions, state.quoteQuery, new Date());
        state.quoteOptions = groups.flatMap((group) => group.options);
        if (!groups.length) {
            const message = state.quotes.length
                ? 'No encontramos cotizaciones con esa búsqueda.'
                : (state.quotesError || 'Todavía no tenés cotizaciones para vincular.');
            // Si el aviso de error ya enlaza a crear una cotización manual, el
            // estado vacío no repite el link (un solo acceso visible).
            const errorHasLink = !!el['event-form-error']?.querySelector?.('a');
            box.innerHTML = `<p class="cal-quote-empty">${escapeHtml(message)}${errorHasLink ? '' : ` ${manualQuoteLink()}`}</p>`;
            return;
        }
        const enabled = state.quoteOptions.filter((option) => !option.disabled);
        if (!enabled.some((option) => option.id === state.activeQuoteId)) {
            const selectedId = state.selectedQuote ? String(state.selectedQuote.id) : null;
            state.activeQuoteId = enabled.find((option) => option.id === selectedId)?.id || enabled[0]?.id || null;
        }
        box.innerHTML = groups.map((group) => `
            <div class="cal-quote-group" role="group" aria-labelledby="quote-group-${group.id}">
                <p class="cal-quote-group-label" id="quote-group-${group.id}" role="presentation">${escapeHtml(group.label)}</p>
                ${group.options.map(renderQuoteOption).join('')}
            </div>
        `).join('');
        const input = document.getElementById('event-quote-search');
        if (input) {
            if (state.activeQuoteId) input.setAttribute('aria-activedescendant', `quote-option-${state.activeQuoteId}`);
            else input.removeAttribute('aria-activedescendant');
        }
    }

    function renderQuoteOption(option) {
        const selected = !!state.selectedQuote && String(state.selectedQuote.id) === option.id;
        const active = state.activeQuoteId === option.id;
        return `
            <div class="cal-quote-option tone-${escapeAttr(option.tone)}${active ? ' is-active' : ''}" role="option"
                 id="quote-option-${escapeAttr(option.id)}" data-quote-id="${escapeAttr(option.id)}"
                 aria-selected="${selected}"${option.disabled ? ' aria-disabled="true"' : ''}>
                <span class="cal-quote-option-head">
                    <strong>${escapeHtml(option.name)}</strong>
                    <span class="cal-quote-badge">${escapeHtml(option.badge)}</span>
                </span>
                <span class="cal-quote-project">${escapeHtml(option.project || 'Proyecto sin descripción')}</span>
                <span class="cal-quote-meta">${escapeHtml(option.meta)}</span>
            </div>
        `;
    }

    function openQuotePicker() {
        const box = document.getElementById('quote-listbox');
        const input = document.getElementById('event-quote-search');
        if (!box || !input) return;
        renderQuoteListbox();
        box.hidden = false;
        box.closest('.cal-quote-block')?.classList.add('is-open');
        input.setAttribute('aria-expanded', 'true');
        box.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
        if (!state.quotes) {
            ensureQuotes().then(() => {
                if (!box.hidden) renderQuoteListbox();
                updateQuoteHint();
            });
        }
    }

    function closeQuotePicker() {
        const box = document.getElementById('quote-listbox');
        const input = document.getElementById('event-quote-search');
        if (box) {
            box.hidden = true;
            box.closest('.cal-quote-block')?.classList.remove('is-open');
        }
        if (input) {
            input.setAttribute('aria-expanded', 'false');
            input.removeAttribute('aria-activedescendant');
            if (state.selectedQuote && document.activeElement !== input) input.value = quoteDisplay(state.selectedQuote);
        }
    }

    function onQuoteSearchInput(event) {
        state.quoteQuery = event.target.value;
        if (state.selectedQuote) {
            state.selectedQuote = null;
            const hidden = document.getElementById('event-quote-id');
            if (hidden) hidden.value = '';
            const client = document.getElementById('event-client');
            if (client) {
                client.readOnly = false;
                client.value = '';
            }
            updateQuoteHint();
            updateFormSummary();
            syncUrl();
        }
        state.activeQuoteId = null;
        openQuotePicker();
    }

    function moveActiveQuote(direction) {
        const enabled = state.quoteOptions.filter((option) => !option.disabled);
        if (!enabled.length) return;
        const current = enabled.findIndex((option) => option.id === state.activeQuoteId);
        const next = enabled[(current + direction + enabled.length) % enabled.length];
        state.activeQuoteId = next.id;
        renderQuoteListbox();
        document.getElementById(`quote-option-${next.id}`)?.scrollIntoView({ block: 'nearest' });
    }

    function onQuoteKeydown(event) {
        if (event.target.id !== 'event-quote-search') return;
        const box = document.getElementById('quote-listbox');
        const open = box && !box.hidden;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) openQuotePicker();
            else moveActiveQuote(event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key === 'Enter') {
            if (!open) return;
            event.preventDefault();
            if (state.activeQuoteId) selectQuote(state.activeQuoteId);
        } else if (event.key === 'Escape') {
            if (!open) return;
            event.preventDefault();
            closeQuotePicker();
        } else if (event.key === 'Tab') {
            closeQuotePicker();
        }
    }

    function selectQuote(id) {
        const quote = findQuote(id);
        const status = quote ? links()?.classifyQuote(quote) : null;
        if (!quote || !status || status.group === 'unavailable') return;
        state.selectedQuote = quote;
        state.quoteQuery = '';
        state.activeQuoteId = String(quote.id);
        const input = document.getElementById('event-quote-search');
        const hidden = document.getElementById('event-quote-id');
        const client = document.getElementById('event-client');
        if (input) input.value = quoteDisplay(quote);
        if (hidden) hidden.value = quote.id;
        if (client) {
            client.value = quote.client_full_name || '';
            client.readOnly = true;
        }
        // Con la cotización elegida desaparece el aviso de "elegí una
        // cotización" (y su link) antes de recalcular avisos y accesos.
        el['event-form-error'].textContent = '';
        closeQuotePicker();
        updateQuoteHint();
        onFormChanged();
        syncUrl();
    }

    /* ------------------------------ payload y resumen ------------------------------ */

    // lenient: para el resumen y la vista previa de superposición no hace
    // falta que el título esté completo.
    function readFormPayload(options = {}) {
        if (!state.selectedType) return null;
        const dateInput = document.getElementById('event-date');
        const selectedDate = parseLocalDate(dateInput?.value);
        if (!selectedDate) throw new Error('Elegí una fecha válida.');

        const allDay = !!document.getElementById('event-all-day')?.checked;
        const timeValue = document.getElementById('event-time')?.value || '10:00';
        const [hours, minutes] = timeValue.split(':').map(Number);
        const start = startOfDay(selectedDate);
        if (!allDay) start.setHours(hours || 0, minutes || 0, 0, 0);
        const duration = Number(document.getElementById('event-duration')?.value || 1);
        const end = allDay ? endOfDay(start) : new Date(start.getTime() + duration * 3600000);
        const quote = state.selectedType === 'confirmed_session' ? state.selectedQuote : null;
        const client = quote?.client_full_name || document.getElementById('event-client')?.value.trim() || '';
        const inputTitle = document.getElementById('event-title')?.value.trim() || '';
        const target = resolveSaveTarget();
        let eventType = state.selectedType;
        let status = 'scheduled';
        let title = inputTitle;
        if (state.selectedType === 'confirmed_session') {
            if (target === 'reservation') {
                eventType = 'reservation';
                status = 'pending';
                title = `${client} — reserva`;
            } else {
                title = `Sesión — ${client}`;
            }
        }
        if (state.selectedType === 'reservation') {
            title = `${client} — reserva`;
            status = document.getElementById('event-confirmed')?.checked ? 'scheduled' : 'pending';
        }
        if (state.selectedType === 'guest_spot') {
            title = !inputTitle ? 'Guest Spot' : (/^Guest en\s+/i.test(inputTitle) ? inputTitle : `Guest en ${inputTitle}`);
        }
        if (!title && !options.lenient) throw new Error(state.selectedType === 'confirmed_session' || state.selectedType === 'reservation'
            ? 'Ingresá el nombre del cliente.'
            : 'Ingresá un título para el evento.');

        const usesLocation = state.selectedType === 'confirmed_session' || state.selectedType === 'reservation';
        const payload = {
            event_type: eventType,
            title,
            client_name: client || null,
            starts_at: start.toISOString(),
            ends_at: end.toISOString(),
            all_day: allDay,
            location: usesLocation ? (document.getElementById('event-location')?.value || 'Estudio propio') : null,
            notes: document.getElementById('event-notes')?.value.trim() || null,
            status,
            recurrence_rule: document.getElementById('event-recurring')?.checked ? 'weekly' : 'none',
            recurrence_until: null,
        };
        if (quote) {
            payload.quotation_id = quote.id;
            payload.quote_code = links()?.quoteCode(quote) || null;
        }
        return payload;
    }

    function validateBeforeSave() {
        if (state.selectedType !== 'confirmed_session') return null;
        const target = resolveSaveTarget();
        if (target === 'blocked') return 'Esa cotización no se puede agendar. Elegí otra o creá una cotización manual.';
        if (!state.selectedQuote && !isLegacyManualTurno() && state.editingEvent?.sourceType !== 'quotation_session') {
            return 'Elegí la cotización a vincular. Si todavía no existe, creá una cotización manual.';
        }
        return null;
    }

    function onFormChanged() {
        const dateInput = document.getElementById('event-date');
        const date = parseLocalDate(dateInput?.value);
        if (date) {
            state.selectedDate = date;
            if (date.getMonth() !== state.miniDate.getMonth() || date.getFullYear() !== state.miniDate.getFullYear()) {
                state.miniDate = startOfMonth(date);
            }
            renderMiniCalendar();
        }
        const time = document.getElementById('event-time');
        if (time) time.disabled = !!document.getElementById('event-all-day')?.checked;
        const blockedTime = el['event-fields'].querySelector('.cal-blocked-time');
        if (blockedTime) blockedTime.hidden = !!document.getElementById('event-all-day')?.checked;
        const dateDisplay = el['event-fields'].querySelector('[data-date-display]');
        if (dateDisplay && date) dateDisplay.textContent = formatLongDate(date);
        updateFormSummary();
        scheduleConflictCheck();
    }

    function summaryTypeLabel() {
        if (!state.selectedType) return 'Sin elegir';
        if (state.selectedType === 'confirmed_session' && resolveSaveTarget() === 'reservation') {
            return TYPE_META.reservation.editorLabel;
        }
        return TYPE_META[state.selectedType]?.editorLabel || 'Evento';
    }

    function updateFormSummary() {
        el['summary-type'].textContent = summaryTypeLabel();
        el['summary-date'].textContent = state.selectedDate ? formatLongDate(state.selectedDate) : '—';
        if (!state.selectedType) {
            el['summary-time'].textContent = '—';
            el['summary-duration'].textContent = '—';
            el['summary-location'].textContent = '—';
            return;
        }
        try {
            const payload = readFormPayload({ lenient: true });
            const start = asDate(payload.starts_at);
            const end = asDate(payload.ends_at);
            el['summary-time'].textContent = payload.all_day ? 'Todo el día' : formatTime(start);
            const minutes = Math.round((end - start) / 60000);
            el['summary-duration'].textContent = payload.all_day ? '1 día' : minutes >= 60 ? formatHours(minutes / 60) : `${minutes} min`;
            el['summary-location'].textContent = payload.location || '—';
        } catch (_error) {
            el['summary-time'].textContent = document.getElementById('event-time')?.value || '—';
            el['summary-duration'].textContent = document.getElementById('event-all-day')?.checked ? '1 día' : '1 hora';
            el['summary-location'].textContent = document.getElementById('event-location')?.value || '—';
        }
    }

    function renderMiniCalendar() {
        el['mini-title'].textContent = formatMonthYear(state.miniDate);
        const gridStart = mondayOfWeek(startOfMonth(state.miniDate));
        const headers = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((day) => `<span>${day}</span>`).join('');
        const lastDay = endOfMonth(state.miniDate);
        let weeks = Math.ceil((lastDay - gridStart) / (7 * 24 * 60 * 60 * 1000));
        weeks = Math.max(5, Math.min(6, weeks));
        const days = Array.from({ length: weeks * 7 }, (_, index) => addDays(gridStart, index));
        const body = days.map((date) => {
            const outside = date.getMonth() !== state.miniDate.getMonth();
            const hasEvents = eventsForDay(date, state.events).length > 0;
            return `
                <button type="button" data-date="${dateKey(date)}" class="${outside ? 'is-outside ' : ''}${sameDay(date, state.selectedDate) ? 'is-selected ' : ''}${hasEvents ? 'has-events' : ''}" aria-label="${escapeAttr(formatLongDate(date))}"${sameDay(date, state.selectedDate) ? ' aria-pressed="true"' : ''}>
                    ${date.getDate()}
                </button>
            `;
        }).join('');
        el['mini-grid'].className = 'cal-mini-grid';
        el['mini-grid'].innerHTML = headers + body;
    }

    /* ------------------------------ superposición ------------------------------ */

    function sameEvent(a, b) {
        return !!a && !!b && a.sourceType === b.sourceType && String(a.baseId) === String(b.baseId);
    }

    function localProjectedConflicts(payload) {
        const start = asDate(payload.starts_at);
        const end = asDate(payload.ends_at);
        return state.events.filter((event) => {
            if (!BLOCKING_TYPES.has(event.type)) return false;
            if (state.editingEvent && sameEvent(event, state.editingEvent)) return false;
            return overlaps(event, start, end);
        });
    }

    function scheduleConflictCheck() {
        window.clearTimeout(state.conflictTimer);
        state.conflictTimer = window.setTimeout(checkConflicts, 280);
    }

    async function checkConflicts() {
        let payload;
        try {
            if (state.selectedType) payload = readFormPayload({ lenient: true });
            else {
                const start = startOfDay(state.selectedDate);
                start.setHours(10, 0, 0, 0);
                payload = {
                    event_type: 'confirmed_session',
                    starts_at: start.toISOString(),
                    ends_at: new Date(start.getTime() + 3600000).toISOString(),
                    recurrence_rule: 'none',
                    recurrence_until: null,
                };
            }
        } catch (_error) {
            clearConflict();
            return;
        }

        const local = localProjectedConflicts(payload);
        const excludeId = state.editingEvent?.sourceType === 'manual' ? state.editingEvent.baseId : null;
        try {
            const remote = await window.WeotziData.Calendar.checkConflicts(payload, excludeId);
            const combined = new Map();
            local.forEach((event) => combined.set(`${event.title}:${event.start}`, event));
            remote.forEach((event) => {
                if (state.editingEvent && String(event.id) === String(excludeId)) return;
                combined.set(`${event.title}:${new Date(event.starts_at).toISOString()}`, {
                    title: event.title,
                    start: event.starts_at,
                });
            });
            renderConflicts([...combined.values()]);
        } catch (error) {
            console.warn('[calendar] Vista previa de solapamiento no disponible:', error);
            renderConflicts(local);
        }
    }

    function renderConflicts(conflicts) {
        if (!conflicts.length) {
            clearConflict();
            return;
        }
        el['calendar-conflict'].hidden = false;
        el['calendar-conflict-list'].innerHTML = conflicts.slice(0, 4).map((event) => {
            const start = asDate(event.start || event.starts_at);
            return `<p>${start ? formatTime(start) : ''} — ${escapeHtml(event.title)}</p>`;
        }).join('');
    }

    function clearConflict() {
        el['calendar-conflict'].hidden = true;
        el['calendar-conflict-list'].innerHTML = '';
    }

    /* ------------------------------- persistencia ------------------------------- */

    function setSaveLabel(text) {
        el['save-event'].innerHTML = `${escapeHtml(text)} <i data-wo-icon="arrow-right" aria-hidden="true"></i>`;
    }

    async function persist(kind, payload) {
        const Calendar = window.WeotziData.Calendar;
        if (kind === 'session') return Calendar.createQuoteSession(payload);
        return Calendar.create(state.user.id, payload);
    }

    async function persistUpdate(kind, event, payload) {
        const Calendar = window.WeotziData.Calendar;
        if (kind === 'session') return Calendar.updateQuoteSession(event.baseId, payload);
        return Calendar.update(event.baseId, state.user.id, payload);
    }

    async function persistRemove(event) {
        const Calendar = window.WeotziData.Calendar;
        if (event.sourceType === 'quotation_session') return Calendar.removeQuoteSession(event.baseId);
        return Calendar.remove(event.baseId, state.user.id);
    }

    async function saveCurrentEvent(event) {
        event.preventDefault();
        el['event-form-error'].textContent = '';
        let payload;
        try {
            const invalid = validateBeforeSave();
            if (invalid) throw new Error(invalid);
            payload = readFormPayload();
            const form = el['calendar-event-form'];
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }
        } catch (error) {
            el['event-form-error'].textContent = error.message;
            if (/cotización/i.test(error.message)) {
                // Sin cotización elegida: el aviso enlaza a crear una manual.
                el['event-form-error'].innerHTML = escapeHtml(error.message).replace(
                    'creá una cotización manual',
                    `<a href="${escapeAttr(manualQuoteHref())}">creá una cotización manual</a>`,
                );
                updateQuoteCreate();
                renderQuoteListbox();
                document.getElementById('event-quote-search')?.focus();
            }
            return;
        }

        const target = resolveSaveTarget();
        const targetKind = target === 'session' ? 'session' : 'manual';
        const editing = state.editingEvent;
        const sourceKind = editing ? (editing.sourceType === 'quotation_session' ? 'session' : 'manual') : null;

        el['save-event'].disabled = true;
        setSaveLabel('Guardando…');
        try {
            if (!editing) {
                await persist(targetKind, payload);
                showToast(targetKind === 'session'
                    ? `Turno agendado en ${payload.quote_code || 'la cotización'}.`
                    : (payload.quote_code
                        ? `Reserva pendiente guardada · ${payload.quote_code}.`
                        : 'Evento guardado en tu calendario.'));
            } else if (sourceKind === targetKind) {
                await persistUpdate(targetKind, editing, payload);
                showToast('Evento actualizado.');
            } else {
                // Cambió el destino (p. ej. la cotización se aprobó): se crea en
                // la tabla correcta y se quita la fila anterior, sin duplicar.
                await persist(targetKind, payload);
                await persistRemove(editing);
                showToast(targetKind === 'session' ? 'La reserva pasó a ser un turno de la cotización.' : 'Evento actualizado.');
            }
            if (payload.quotation_id != null || sourceKind === 'session') invalidateQuotes();
            state.currentDate = startOfDay(asDate(payload.starts_at));
            closeEditor();
            await loadEvents();
        } catch (error) {
            const overlap = error.code === '23P01' || /CALENDAR_OVERLAP|superpone/i.test(error.message || '');
            el['event-form-error'].textContent = overlap
                ? 'Ese horario se superpone con otro evento. Elegí otro horario o editá el evento existente.'
                : (error.message || 'No pudimos guardar el evento.');
        } finally {
            el['save-event'].disabled = false;
            setSaveLabel('Guardar evento');
        }
    }

    async function deleteCurrentEvent() {
        const editing = state.editingEvent;
        if (!editing) return;
        const message = editing.sourceType === 'quotation_session'
            ? `¿Eliminar “${editing.title}”? La sesión también se quita del detalle de ${editing.quoteCode || 'la cotización'}.`
            : `¿Eliminar “${editing.title}”?${editing.recurrenceRule === 'weekly' ? ' Se borran todas las repeticiones.' : ''}`;
        if (!window.confirm(message)) return;
        el['delete-event'].disabled = true;
        try {
            await persistRemove(editing);
            if (editing.sourceType === 'quotation_session' || editing.quotationId) invalidateQuotes();
            showToast('Evento eliminado.');
            closeEditor();
            await loadEvents();
        } catch (error) {
            el['event-form-error'].textContent = error.message || 'No pudimos eliminar el evento.';
        } finally {
            el['delete-event'].disabled = false;
        }
    }

    function setLoading(active) {
        el['calendar-loading'].hidden = !active;
    }

    function showToast(message, isError = false) {
        window.clearTimeout(state.toastTimer);
        el['calendar-toast'].textContent = message;
        el['calendar-toast'].classList.toggle('is-error', !!isError);
        el['calendar-toast'].hidden = false;
        state.toastTimer = window.setTimeout(() => { el['calendar-toast'].hidden = true; }, 4200);
    }

    window.WeotziCalendar = {
        TYPE_META,
        mondayOfWeek,
        dateKey,
        parseLocalDate,
        formatLongDate,
        overlaps,
        capitalize,
        hiddenEventCount,
        agendaGroupDate,
        buildArtistLoginUrl,
        timedEventLayout,
    };

    document.addEventListener('DOMContentLoaded', initialize);
})();
