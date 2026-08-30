/*
 * WE ÖTZI · Calendario profesional
 * Figma: 52:8311 / 52:9043 / 52:9286 / 153:4421…9373
 * Vistas propias (mes, semana, dia y agenda), CRUD real y proyecciones de
 * quotation_sessions + artist_trips a traves de WeotziData.Calendar.
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
    const DAY_MS = 24 * 60 * 60 * 1000;

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
    };

    const el = {};

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

    function buildArtistLoginUrl(returnTo = '/calendar') {
        const params = new URLSearchParams();
        if (returnTo) params.set('returnTo', returnTo);
        const query = params.toString();
        return appUrl(`/registerclosedbeta${query ? `?${query}` : ''}`);
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
        return new Intl.DateTimeFormat('es-AR', {
            day: 'numeric', month: 'long', year: 'numeric',
        }).format(date);
    }

    function formatShortDate(date) {
        return new Intl.DateTimeFormat('es-AR', {
            day: 'numeric', month: 'short',
        }).format(date).replace('.', '').toUpperCase();
    }

    function formatTime(date) {
        return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
            const haystack = [event.title, event.clientName, event.location, event.notes]
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

    async function initialize() {
        cacheElements();
        bindEvents();
        renderLegend();
        setLoading(true);

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

            const queryDate = parseLocalDate(new URLSearchParams(window.location.search).get('date'));
            if (queryDate) state.currentDate = queryDate;
            else if (String(artist.username || '').toLowerCase() === 'isainazartattoo.wo') {
                state.currentDate = new Date(2026, 6, 7);
            }
            state.selectedDate = startOfDay(state.currentDate);
            state.miniDate = startOfMonth(state.selectedDate);

            await loadEvents();
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
                document.querySelectorAll('.cal-view-tabs [data-view]').forEach((tab) => {
                    tab.setAttribute('aria-selected', String(tab === button));
                });
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
        el['event-type-picker'].addEventListener('click', (event) => {
            const button = event.target.closest('[data-type]');
            if (!button || state.editingEvent) return;
            chooseType(button.dataset.type);
        });
        el['calendar-event-form'].addEventListener('submit', saveCurrentEvent);
        el['event-fields'].addEventListener('input', onFormChanged);
        el['event-fields'].addEventListener('change', onFormChanged);
        el['mini-grid'].addEventListener('click', (event) => {
            const button = event.target.closest('[data-date]');
            if (!button) return;
            state.selectedDate = parseLocalDate(button.dataset.date);
            const input = document.getElementById('event-date');
            if (input) input.value = dateKey(state.selectedDate);
            renderMiniCalendar();
            onFormChanged();
        });
        document.getElementById('cal-logout').addEventListener('click', async () => {
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

    function renderAll() {
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
            label = new Intl.DateTimeFormat('es-AR', {
                weekday: 'long', day: 'numeric', month: 'long',
            }).format(state.currentDate);
            label = label.charAt(0).toUpperCase() + label.slice(1);
        }
        el['cal-period-label'].textContent = label;
    }

    function updateHeaderSummary() {
        const from = startOfMonth(state.currentDate);
        const to = endOfMonth(state.currentDate);
        const inMonth = state.events.filter((event) => overlaps(event, from, to));
        const confirmed = inMonth.filter((event) => event.type === 'confirmed_session').length;
        const pending = inMonth.filter((event) => event.type === 'pending_request' || event.type === 'reservation').length;
        const blocked = new Set(inMonth
            .filter((event) => event.type === 'blocked_day')
            .map((event) => dateKey(asDate(event.start)))).size;
        el['calendar-summary'].textContent = `${confirmed} turnos confirmados, ${pending} solicitudes esperando respuesta y ${blocked} días bloqueados este mes.`;
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
            const dayEvents = eventsForDay(date).slice(0, 4);
            const outside = date.getMonth() !== state.currentDate.getMonth();
            const eventsHtml = dayEvents.slice(0, 3).map((event) => `
                <button type="button" class="cal-event ${eventClass(event.type)}" data-event-id="${escapeAttr(event.id)}" title="${escapeAttr(event.title)}">
                    ${escapeHtml(event.title)}
                </button>
            `).join('');
            const more = dayEvents.length > 3 ? `<span class="cal-more">+${dayEvents.length - 3}</span>` : '';
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
        const heads = dates.map((date) => `
            <div class="cal-time-head${sameDay(date, state.currentDate) ? ' is-selected' : ''}">
                <span>${columns === 1 ? new Intl.DateTimeFormat('es-AR', { weekday: 'long' }).format(date) : WEEKDAYS[(date.getDay() + 6) % 7]}</span>
                <strong>${date.getDate()}</strong>
            </div>
        `).join('');
        const hourLabels = Array.from({ length: HOUR_END - HOUR_START }, (_, index) => {
            const hour = HOUR_START + index;
            return `<span class="cal-time-hour-label" style="top:${index * (100 / (HOUR_END - HOUR_START))}%">${pad(hour)}:00</span>`;
        }).join('');
        const dayColumns = dates.map((date) => {
            const dayEvents = eventsForDay(date, visible);
            const eventHtml = dayEvents.map((event) => renderTimedEvent(event, date)).join('');
            return `<div class="cal-time-column" data-date="${dateKey(date)}">${eventHtml}</div>`;
        }).join('');
        el['calendar-view'].innerHTML = `
            <div class="cal-time-grid" style="--time-columns:${columns}">
                <div class="cal-time-corner"></div>
                ${heads}
                <div class="cal-time-hours">${hourLabels}</div>
                ${dayColumns}
            </div>
        `;
    }

    function renderTimedEvent(event, day) {
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
        }
        const time = event.allDay ? 'Todo el día' : `${formatTime(start)}–${formatTime(end)}`;
        return `
            <button type="button" class="cal-event ${eventClass(event.type)}" data-event-id="${escapeAttr(event.id)}"
                    style="top:${top}%;height:${height}%" title="${escapeAttr(`${time} · ${event.title}`)}">
                ${escapeHtml(time)}<strong>${escapeHtml(event.title)}</strong>
            </button>
        `;
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
            const key = dateKey(asDate(event.start));
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(event);
        });
        el['calendar-view'].innerHTML = `<div class="cal-agenda">${[...groups.entries()].map(([key, rows]) => {
            const date = parseLocalDate(key);
            return `
                <section class="cal-agenda-day">
                    <h3>${escapeHtml(new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(date))}</h3>
                    ${rows.map((event) => {
                        const { start, end } = eventDates(event);
                        return `
                            <button type="button" class="cal-agenda-event ${eventClass(event.type)}" data-event-id="${escapeAttr(event.id)}">
                                <time>${event.allDay ? 'Todo el día' : `${formatTime(start)}–${formatTime(end)}`}</time>
                                <i aria-hidden="true"></i>
                                <span><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.location || TYPE_META[event.type]?.label || '')}</small></span>
                            </button>
                        `;
                    }).join('')}
                </section>
            `;
        }).join('')}</div>`;
    }

    function renderUpcoming() {
        const viewStart = state.view === 'week' ? mondayOfWeek(state.currentDate) : startOfDay(state.currentDate);
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
        }).join('') : '<p class="cal-upcoming-foot">Sin próximos eventos en este período.</p>';

        const monthEvents = state.events.filter((event) => overlaps(event, startOfMonth(state.currentDate), endOfMonth(state.currentDate)));
        const pending = monthEvents.filter((event) => event.type === 'pending_request' || event.type === 'reservation').length;
        const blocked = new Set(monthEvents.filter((event) => event.type === 'blocked_day').map((event) => dateKey(asDate(event.start)))).size;
        const confirmed = monthEvents.filter((event) => event.type === 'confirmed_session').length;
        el['upcoming-summary'].textContent = `${pending} pendientes de confirmar · ${blocked} días bloqueados · ${confirmed} turnos confirmados en total.`;
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
            const source = event.sourceType === 'quotation_session' ? 'Cotizaciones' : 'Travel';
            showToast(`${event.title} · se administra desde ${source}.`);
            return;
        }
        openEditor(event);
    }

    function openEditor(event = null, date = null) {
        state.editingEvent = event && !event.readonly ? event : null;
        state.selectedType = state.editingEvent?.type || null;
        state.selectedDate = date || (state.editingEvent ? startOfDay(asDate(state.editingEvent.start)) : startOfDay(state.currentDate));
        state.miniDate = startOfMonth(state.selectedDate);
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
        window.scrollTo({ top: 0, behavior: 'instant' });
    }

    function closeEditor() {
        el['calendar-editor'].hidden = true;
        el['calendar-page'].hidden = false;
        state.editingEvent = null;
        state.selectedType = null;
        clearConflict();
        renderAll();
        window.scrollTo({ top: 0, behavior: 'instant' });
    }

    function chooseType(type) {
        if (!MANUAL_TYPES.includes(type)) return;
        state.selectedType = type;
        renderTypePicker();
        renderEventFields();
        updateFormSummary();
        const first = el['event-fields'].querySelector('input, select, textarea');
        first?.focus();
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

    function textInput(name, value, placeholder, required = false) {
        return `<input id="${name}" name="${name}" type="text" value="${escapeAttr(value || '')}" placeholder="${escapeAttr(placeholder)}" maxlength="180"${required ? ' required' : ''}>`;
    }

    function buildCommonDateFields(raw) {
        const start = state.editingEvent ? asDate(state.editingEvent.start) : null;
        const selected = start || state.selectedDate;
        const dateValue = dateKey(selected);
        const timeValue = start && !state.editingEvent.allDay ? formatTime(start) : '10:00';
        return {
            date: field('Fecha', 'event-date', `<input id="event-date" name="event-date" type="date" value="${dateValue}" required>`, true),
            time: field('Hora de inicio', 'event-time', `<input id="event-time" name="event-time" type="time" value="${timeValue}" required>`, false),
            notes: field('Notas', 'event-notes', `<textarea id="event-notes" name="event-notes" placeholder="Detalles adicionales…">${escapeHtml(raw?.notes || '')}</textarea>`),
        };
    }

    function durationSelect(value) {
        const durations = [0.5, 1, 1.5, 2, 3, 4, 8];
        return `<select id="event-duration" name="event-duration">${durations.map((duration) => `
            <option value="${duration}"${Number(value || 1) === duration ? ' selected' : ''}>${duration === 1 ? '1 hora' : `${String(duration).replace('.', ',')} horas`}</option>
        `).join('')}</select>`;
    }

    function toggleField(name, title, copy, checked) {
        return `
            <label class="cal-toggle-row" for="${name}">
                <span class="cal-toggle-copy"><strong>${title}</strong><span>${copy}</span></span>
                <span class="cal-switch"><input id="${name}" name="${name}" type="checkbox"${checked ? ' checked' : ''}><span></span></span>
            </label>
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

        const raw = state.editingEvent?.raw || {};
        const common = buildCommonDateFields(raw);
        const durationHours = state.editingEvent
            ? Math.max(0.5, (asDate(state.editingEvent.end) - asDate(state.editingEvent.start)) / 3600000)
            : 1;
        const currentTitle = raw.title || state.editingEvent?.title || '';
        let html = '';

        if (state.selectedType === 'confirmed_session' || state.selectedType === 'reservation') {
            const client = raw.client_name || state.editingEvent?.clientName || '';
            html = `
                ${field('Cliente', 'event-client', textInput('event-client', client, 'Nombre del cliente', true), true)}
                <div class="cal-field-grid">${common.date}${common.time}</div>
                ${field('Duración', 'event-duration', durationSelect(durationHours))}
                ${field('Ubicación', 'event-location', `
                    <select id="event-location" name="event-location">
                        <option value="Estudio propio">Estudio propio</option>
                        <option value="A domicilio">A domicilio</option>
                        <option value="Otro estudio">Otro estudio</option>
                    </select>
                `)}
                ${common.notes}
                ${state.selectedType === 'reservation' ? toggleField('event-confirmed', 'Reserva confirmada', 'La reserva ya está confirmada por el cliente', raw.status === 'scheduled') : ''}
            `;
        } else if (state.selectedType === 'availability') {
            html = `
                ${field('Título', 'event-title', textInput('event-title', currentTitle, 'Título del evento', true), true)}
                <div class="cal-field-grid">${common.date}${common.time}</div>
                ${toggleField('event-recurring', 'Se repite', 'Repetir este evento todas las semanas', raw.recurrence_rule === 'weekly')}
                ${common.notes}
            `;
        } else if (state.selectedType === 'blocked_day') {
            html = `
                ${field('Motivo', 'event-title', textInput('event-title', currentTitle, 'Ej: Vacaciones, mantenimiento…', true), true)}
                <div class="cal-field-grid">${common.date}${common.time}</div>
                ${toggleField('event-all-day', 'Todo el día', 'El evento ocupa toda la jornada', raw.all_day !== false)}
                ${common.notes}
            `;
        } else if (state.selectedType === 'guest_spot') {
            html = `
                ${field('Estudio', 'event-title', textInput('event-title', currentTitle.replace(/^Guest en\s+/i, ''), 'Nombre del estudio', true), true)}
                <div class="cal-field-grid">${common.date}${common.time}</div>
                ${toggleField('event-all-day', 'Todo el día', 'El evento ocupa toda la jornada', !!raw.all_day)}
                ${common.notes}
            `;
        } else if (state.selectedType === 'convention') {
            html = `
                ${field('Nombre del evento', 'event-title', textInput('event-title', currentTitle, 'Ej: Feria Tinta Buenos Aires', true), true)}
                <div class="cal-field-grid">${common.date}${common.time}</div>
                ${toggleField('event-all-day', 'Todo el día', 'El evento ocupa toda la jornada', raw.all_day !== false)}
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

        el['event-fields'].innerHTML = `<div class="cal-fields">${html}</div>`;
        el['event-fields'].hidden = false;
        el['event-form-empty'].hidden = true;
        el['save-event'].disabled = false;

        const location = document.getElementById('event-location');
        if (location && raw.location) location.value = raw.location;
    }

    function readFormPayload() {
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
        const client = document.getElementById('event-client')?.value.trim() || '';
        const inputTitle = document.getElementById('event-title')?.value.trim() || '';
        let title = inputTitle;
        if (state.selectedType === 'confirmed_session') title = `Sesión — ${client}`;
        if (state.selectedType === 'reservation') title = `${client} — reserva`;
        if (state.selectedType === 'guest_spot') title = /^Guest en\s+/i.test(inputTitle) ? inputTitle : `Guest en ${inputTitle}`;
        if (!title) throw new Error(state.selectedType === 'confirmed_session' || state.selectedType === 'reservation'
            ? 'Ingresá el nombre del cliente.'
            : 'Ingresá un título para el evento.');

        return {
            event_type: state.selectedType,
            title,
            client_name: client || null,
            starts_at: start.toISOString(),
            ends_at: end.toISOString(),
            all_day: allDay,
            location: document.getElementById('event-location')?.value || (state.selectedType === 'confirmed_session' || state.selectedType === 'reservation' ? 'Estudio propio' : null),
            notes: document.getElementById('event-notes')?.value.trim() || null,
            status: state.selectedType === 'reservation' && !document.getElementById('event-confirmed')?.checked ? 'pending' : 'scheduled',
            recurrence_rule: document.getElementById('event-recurring')?.checked ? 'weekly' : 'none',
            recurrence_until: null,
        };
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
        updateFormSummary();
        scheduleConflictCheck();
    }

    function updateFormSummary() {
        el['summary-type'].textContent = state.selectedType ? TYPE_META[state.selectedType].editorLabel : 'Sin elegir';
        el['summary-date'].textContent = state.selectedDate ? formatLongDate(state.selectedDate) : '—';
        try {
            const payload = readFormPayload();
            const start = asDate(payload.starts_at);
            const end = asDate(payload.ends_at);
            el['summary-time'].textContent = payload.all_day ? 'Todo el día' : formatTime(start);
            const minutes = Math.round((end - start) / 60000);
            el['summary-duration'].textContent = payload.all_day ? '1 día' : minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`;
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
        const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
        const body = days.map((date) => {
            const outside = date.getMonth() !== state.miniDate.getMonth();
            const hasEvents = eventsForDay(date, state.events).length > 0;
            return `
                <button type="button" data-date="${dateKey(date)}" class="${outside ? 'is-outside ' : ''}${sameDay(date, state.selectedDate) ? 'is-selected ' : ''}${hasEvents ? 'has-events' : ''}">
                    ${date.getDate()}
                </button>
            `;
        }).join('');
        el['mini-grid'].className = 'cal-mini-grid';
        el['mini-grid'].innerHTML = headers + body;
    }

    function localProjectedConflicts(payload) {
        if (!BLOCKING_TYPES.has(payload.event_type)) return [];
        const start = asDate(payload.starts_at);
        const end = asDate(payload.ends_at);
        return state.events.filter((event) => {
            if (!BLOCKING_TYPES.has(event.type)) return false;
            if (state.editingEvent && event.baseId === state.editingEvent.baseId) return false;
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
            payload = readFormPayload();
        } catch (_error) {
            clearConflict();
            return;
        }
        if (!BLOCKING_TYPES.has(payload.event_type)) {
            clearConflict();
            return;
        }

        const local = localProjectedConflicts(payload);
        try {
            const remote = await window.WeotziData.Calendar.checkConflicts(payload, state.editingEvent?.baseId || null);
            const combined = new Map();
            local.forEach((event) => combined.set(`${event.title}:${event.start}`, event));
            remote.forEach((event) => combined.set(`${event.title}:${event.starts_at}`, {
                title: event.title,
                start: event.starts_at,
            }));
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

    async function saveCurrentEvent(event) {
        event.preventDefault();
        el['event-form-error'].textContent = '';
        let payload;
        try {
            payload = readFormPayload();
            const form = el['calendar-event-form'];
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }
        } catch (error) {
            el['event-form-error'].textContent = error.message;
            return;
        }

        el['save-event'].disabled = true;
        el['save-event'].textContent = 'Guardando…';
        try {
            if (state.editingEvent) {
                await window.WeotziData.Calendar.update(state.editingEvent.baseId, state.user.id, payload);
                showToast('Evento actualizado.');
            } else {
                await window.WeotziData.Calendar.create(state.user.id, payload);
                showToast('Evento guardado en tu calendario.');
            }
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
            el['save-event'].textContent = 'Guardar evento →';
        }
    }

    async function deleteCurrentEvent() {
        if (!state.editingEvent) return;
        if (!window.confirm(`¿Eliminar “${state.editingEvent.title}”?`)) return;
        el['delete-event'].disabled = true;
        try {
            await window.WeotziData.Calendar.remove(state.editingEvent.baseId, state.user.id);
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
        el['calendar-toast'].style.background = isError ? 'var(--red-400)' : 'var(--ink)';
        el['calendar-toast'].hidden = false;
        state.toastTimer = window.setTimeout(() => { el['calendar-toast'].hidden = true; }, 4200);
    }

    window.WeotziCalendar = {
        TYPE_META,
        mondayOfWeek,
        dateKey,
        parseLocalDate,
        overlaps,
    };

    document.addEventListener('DOMContentLoaded', initialize);
})();
