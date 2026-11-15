/**
 * WE OTZI - Sesiones del lado del artista (ronda 2 · frente "sesiones")
 * ---------------------------------------------------------------------------
 * Suma al expediente (/my-quotations/detail) y al calendario (/calendar):
 *
 *   · el estado de cada sesión frente al cliente (por confirmar, confirmada,
 *     cambio pedido), los pedidos de cambio y su respuesta, el registro con
 *     calificación de las sesiones pasadas y la disputa a soporte (P28);
 *   · el selector de ubicación con la dirección completa: sedes de los
 *     estudios del artista, ubicaciones propias, la que eligió el cliente al
 *     cotizar o una dirección con el autocompletar de Google Maps (P27).
 *
 * quotation-detail-figma.js y calendar.js lo usan solo si está cargado
 * (window.WoSessionFlow): sin este archivo, o si el servidor todavía no tiene
 * las rutas de sesiones, las dos pantallas siguen como antes.
 *
 * Requiere wo-session-model.js, wo-session-ui.js y data/sessions-flow-repo.js.
 */
(function () {
    'use strict';

    const M = window.WoSessionModel;
    const UI = window.WoSessionUI;
    if (!M || !UI) {
        console.error('[wo-session-flow] faltan wo-session-model.js / wo-session-ui.js.');
        return;
    }
    const esc = UI.esc;
    const CUSTOM = UI.CUSTOM;

    const state = {
        signature: null,     // firma de lo último pedido (cotización + sesiones)
        nonce: 0,            // sube al invalidar: fuerza a pedir de nuevo
        available: null,     // null = sin saber · false = servidor sin sesiones
        quote: null,
        byId: new Map(),
        locations: new Map(), // quote_id || '' → Promise<{ options, defaultKey }>
        highlighted: false,
    };

    function flowRepo() {
        return window.WeotziData && window.WeotziData.SessionFlow;
    }

    /* ------------------------------ estado por cotización ------------------------------ */
    function signatureOf(quote, sessions) {
        const parts = (sessions || []).map((s) => [s.id, s.status, s.session_date, s.updated_at || '', s.client_confirmation || ''].join(':'));
        return `${quote.quote_id || quote.id}#${state.nonce}|${parts.join('|')}`;
    }

    /**
     * Pide el estado de las sesiones si cambió algo desde la última vez. Llama
     * a onReady() cuando llega (para repintar solo la sección de sesiones).
     */
    function ensure(quote, sessions, onReady) {
        const repo = flowRepo();
        if (!repo || !quote || !quote.quote_id || state.available === false) return;
        const signature = signatureOf(quote, sessions);
        if (signature === state.signature) return;
        state.signature = signature;
        repo.forQuote(quote.quote_id).then((json) => {
            if (state.signature !== signature) return; // llegó una respuesta vieja
            state.available = true;
            state.quote = json.quote || null;
            state.byId = new Map((json.sessions || []).map((s) => [String(s.id), s]));
            if (typeof onReady === 'function') onReady();
            highlightFromUrl();
        }).catch((error) => {
            if (repo.isUnavailable(error)) state.available = false;
            else console.warn('[wo-session-flow] estado de sesiones:', error && error.message);
        });
    }

    function invalidate() {
        state.nonce += 1;
    }

    function view(sessionId) {
        return state.available ? (state.byId.get(String(sessionId)) || null) : null;
    }

    function counterpart() {
        return (state.quote && state.quote.counterpart_name) || 'el cliente';
    }

    async function changed(message) {
        invalidate();
        if (message) UI.toast(message);
        try {
            if (typeof window.WoQuotationDetailReload === 'function') await window.WoQuotationDetailReload();
        } catch (error) {
            console.warn('[wo-session-flow] recarga del expediente:', error);
        }
    }

    // ?session=<id> (correos): lleva a la fila y la resalta una vez.
    function highlightFromUrl() {
        if (state.highlighted) return;
        let id = '';
        try { id = new URLSearchParams(window.location.search).get('session') || ''; } catch (_) { id = ''; }
        if (!id) return;
        const row = document.querySelector(`[data-ws-session="${window.CSS && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '')}"]`);
        if (!row) return;
        state.highlighted = true;
        row.classList.add('ws-highlight');
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => row.classList.remove('ws-highlight'), 4000);
    }

    /* ------------------------------- fila del expediente ------------------------------- */
    function button(action, sessionId, label, className) {
        return `<button class="${className || 'qd-btn'}" type="button" data-ws-action="${esc(action)}" data-ws-id="${esc(sessionId)}">${esc(label)}</button>`;
    }

    function requestLine(v) {
        const r = v.request;
        if (!r) return '';
        const who = r.mine ? 'Pediste' : `${counterpart()} pidió`;
        const summary = M.proposalSummary(r) || 'un cambio';
        return `<p class="ws-row-note ws-row-note--request"><strong>${esc(who)}:</strong> ${esc(summary)}${r.note ? ` · “${esc(r.note)}”` : ''}</p>`;
    }

    function lastRequestLine(v) {
        const r = v.last_request;
        if (!r || v.request || r.status !== 'rejected') return '';
        return `<p class="ws-row-note">${esc(r.mine ? `${counterpart()} no aceptó tu pedido de cambio.` : 'Rechazaste el pedido de cambio.')}${r.response_note ? ` “${esc(r.response_note)}”` : ''}</p>`;
    }

    function feedbackLine(v) {
        const f = v.feedback || {};
        const parts = [];
        if (f.mine) parts.push(`Tu registro: ${M.stars(f.mine.rating)}`);
        if (f.other) parts.push(`${counterpart()}: ${M.stars(f.other.rating)}`);
        return parts.length ? `<p class="ws-row-note ws-row-note--stars">${esc(parts.join(' · '))}</p>` : '';
    }

    /**
     * Extras de una fila de sesión del expediente. → null si no hay estado del
     * servidor (se pinta como antes).
     * ctx: { hasReschedule } (si el expediente ya ofrece "Reprogramar")
     */
    function rowExtras(session, ctx = {}) {
        if (!session || session.id == null) return null;
        const v = view(session.id);
        if (!v) return null;
        const hasClient = !!(state.quote && state.quote.has_client_account);
        const can = v.can || {};
        const upcoming = v.phase === 'upcoming';
        const actions = [];
        if (can.respond) actions.push(button('respond', v.id, 'Responder pedido', 'qd-btn qd-btn--accent'));
        if (can.withdraw) actions.push(button('withdraw', v.id, 'Retirar pedido', 'qd-btn qd-btn--quiet'));
        if (can.request_change && !v.request) actions.push(button('change', v.id, 'Pedir cambio', 'qd-btn qd-btn--quiet'));
        // Sin confirmar: el artista ajusta la propuesta directo (si el expediente no trae ya "Reprogramar").
        if (can.edit_direct && hasClient && upcoming && !ctx.hasReschedule) {
            actions.push(`<button class="qd-btn qd-btn--quiet" type="button" data-action="session-reschedule" data-session-id="${esc(v.id)}">Editar propuesta</button>`);
        }
        if (can.rate) actions.push(button('rate', v.id, v.feedback && v.feedback.mine ? 'Ver mi registro' : 'Calificar y registrar', 'qd-btn'));
        const disputeUseful = can.dispute && !v.dispute && (v.locked === 'window' || !upcoming || (v.last_request && v.last_request.status === 'rejected'));
        if (disputeUseful) actions.push(button('dispute', v.id, 'Pedir disputa', 'qd-inline-link'));

        const notes = [requestLine(v), lastRequestLine(v)];
        if (upcoming && v.locked === 'window' && hasClient) notes.push(`<p class="ws-row-note ws-row-note--lock">${esc(M.lockCopy('window'))}</p>`);
        if (v.dispute) {
            notes.push(`<p class="ws-row-note ws-row-note--lock">${esc(v.dispute.active ? 'Disputa abierta' : 'Disputa cerrada')}${v.dispute.ticket_number ? ` · ticket N.º ${esc(v.dispute.ticket_number)}` : ''}</p>`);
        }
        notes.push(feedbackLine(v));

        // Confirmada (o pasada) con cuenta de cliente: la fecha no se cambia directo.
        const hideReschedule = hasClient && (v.client_confirmation === 'confirmed' || !upcoming);
        // La insignia "por confirmar / confirmada" solo aporta en sesiones abiertas con cliente.
        const showBadge = hasClient && upcoming && v.badge;
        return {
            badgeHtml: showBadge ? UI.badgeHtml(v.badge) : '',
            placeHtml: v.location ? UI.locationLineHtml(v) : '',
            notesHtml: notes.filter(Boolean).join(''),
            actionsHtml: actions.join(''),
            hideReschedule,
        };
    }

    async function handleAction(action, sessionId) {
        const v = view(sessionId);
        const repo = flowRepo();
        if (!v || !repo) return;
        try {
            if (action === 'respond') {
                const result = await UI.respondDialog(v, { counterpart: counterpart() });
                if (result) await changed(result.accepted ? 'Cambio aceptado: la sesión quedó confirmada con los datos nuevos.' : 'Rechazaste el cambio. La sesión sigue como estaba.');
            } else if (action === 'change') {
                const locations = await locationOptions(state.quote && state.quote.quote_id).catch(() => ({ options: [] }));
                const result = await UI.changeDialog(v, { role: 'artist', counterpart: counterpart(), locations });
                if (result) await changed(`Enviamos el pedido. La sesión sigue como estaba hasta que ${counterpart()} lo acepte.`);
            } else if (action === 'withdraw') {
                if (!v.request) return;
                const ok = await UI.confirmDialog({ title: '¿Retirar el pedido de cambio?', message: 'La sesión sigue en la fecha y el lugar actuales.', confirmLabel: 'Retirar pedido' });
                if (!ok) return;
                await repo.withdraw(v.request.id);
                await changed('Retiraste el pedido de cambio.');
            } else if (action === 'rate') {
                const result = await UI.feedbackDialog(v, { counterpart: counterpart() });
                if (result) await changed('Registro guardado.');
            } else if (action === 'dispute') {
                const result = await UI.disputeDialog(v);
                if (result) await changed(`Disputa registrada${result.ticket_number ? ` (ticket N.º ${result.ticket_number})` : ''}. Soporte revisa el caso.`);
            }
        } catch (error) {
            console.error('[wo-session-flow]', action, error);
            UI.toast((error && error.userMessage) || 'No pudimos completar la acción. Prueba de nuevo.', { error: true });
        }
    }

    document.addEventListener('click', (event) => {
        const target = event.target && event.target.closest ? event.target.closest('[data-ws-action]') : null;
        if (!target || target.closest('[data-ws-client]')) return; // el panel del cliente tiene su propio manejador
        event.preventDefault();
        handleAction(target.getAttribute('data-ws-action'), target.getAttribute('data-ws-id'));
    });

    /* ----------------------------------- ubicaciones ----------------------------------- */
    function locationOptions(quoteId) {
        const key = quoteId || '';
        const repo = flowRepo();
        if (!repo) return Promise.resolve({ options: [], defaultKey: null });
        if (!state.locations.has(key)) {
            const pending = repo.locations(quoteId || undefined).catch((error) => {
                state.locations.delete(key);
                if (!repo.isUnavailable(error)) console.warn('[wo-session-flow] ubicaciones:', error && error.message);
                return { options: [], defaultKey: null };
            });
            state.locations.set(key, pending);
        }
        return state.locations.get(key);
    }

    /**
     * Inserta el selector de ubicación en `slot` (un contenedor vacío de un
     * diálogo). → { read() } con { location, location_kind, location_ref,
     * location_place_id } o null (sin elegir o todavía cargando).
     */
    function mountLocation(slot, opts = {}) {
        let binding = null;
        const handle = { read: () => (binding ? binding.read() : null), destroy() { if (binding) binding.destroy(); } };
        if (!slot) return handle;
        slot.innerHTML = '<p class="wo-help" aria-live="polite">Cargando tus ubicaciones…</p>';
        locationOptions(opts.quoteId).then((data) => {
            if (!slot.isConnected) return;
            slot.innerHTML = UI.locationFieldHtml({
                options: data.options, defaultKey: data.defaultKey, value: opts.value || null,
                allowEmpty: opts.allowEmpty !== false, preferEmpty: !!opts.preferEmpty, label: opts.label || 'Lugar de la sesión',
                help: opts.help || '',
            });
            binding = UI.bindLocationField(slot);
        });
        return handle;
    }

    /** Columnas de ubicación a guardar en quotation_sessions (o {} sin ubicación). */
    function locationPatch(value) {
        const normalized = M.normalizeLocation(value || {});
        return normalized.ok && normalized.value ? normalized.value : {};
    }

    function errorText(error) {
        const cause = error && error.cause;
        return [error && error.message, error && error.code, cause && cause.message, cause && cause.code, cause && cause.details]
            .filter(Boolean).join(' ');
    }

    function needsAgreement(error) {
        return /WOS01|SESSION_NEEDS_AGREEMENT/.test(errorText(error));
    }

    /** Mensaje legible de un rechazo de las reglas de sesiones, o ''. */
    function explain(error) {
        if (error && error.userMessage) return error.userMessage;
        const text = errorText(error);
        if (/WOS01|SESSION_NEEDS_AGREEMENT/.test(text)) {
            return 'El cliente ya confirmó esta sesión: el cambio de fecha, duración o lugar se le pide desde la cotización y tiene que aceptarlo.';
        }
        if (/WOS02|SESSION_PAST/.test(text)) {
            return 'La sesión ya pasó: no se puede modificar. Regístrala como realizada o como ausencia, o pide una disputa.';
        }
        if (/WOS03|SESSION_DELETE_BLOCKED/.test(text)) return 'Una sesión confirmada o pasada no se borra: cancélala o pide una disputa.';
        return '';
    }

    function isMissingLocationColumns(error) {
        const text = errorText(error);
        return /PGRST204|42703|column/i.test(text) && /location_kind|location_ref|location_place_id/.test(text);
    }

    /**
     * Alta de una sesión con su ubicación. Si la base todavía no tiene las
     * columnas nuevas guarda solo el texto (recortado al límite anterior).
     */
    async function createSession(row, location) {
        const detail = window.WeotziData && window.WeotziData.QuotationDetail;
        if (!detail) throw new Error('No pudimos conectar con las sesiones.');
        const patch = locationPatch(location);
        try {
            return await detail.createSession(Object.assign({}, row, patch));
        } catch (error) {
            if (!patch.location || !(isMissingLocationColumns(error) || /quotation_sessions_location_length/.test(errorText(error)))) throw error;
            return detail.createSession(Object.assign({}, row, { location: patch.location.slice(0, 120) }));
        }
    }

    /** Update directo de una sesión con ubicación (mismo respaldo que createSession). */
    async function updateSession(sessionId, patch, location) {
        const detail = window.WeotziData && window.WeotziData.QuotationDetail;
        if (!detail) throw new Error('No pudimos conectar con las sesiones.');
        const loc = locationPatch(location);
        try {
            return await detail.updateSession(sessionId, Object.assign({}, patch, loc));
        } catch (error) {
            const message = explain(error);
            if (message) throw Object.assign(new Error(message), { userMessage: message, cause: error });
            if (!loc.location || !(isMissingLocationColumns(error) || /quotation_sessions_location_length/.test(errorText(error)))) throw error;
            return detail.updateSession(sessionId, Object.assign({}, patch, { location: loc.location.slice(0, 120) }));
        }
    }

    /* ------------------------------------ calendario ------------------------------------ */
    // #event-location sigue siendo un <select> cuyo value es la dirección
    // completa (así el resto del editor no cambia); "Otra dirección…" abre un
    // campo con el autocompletar de Google Maps.
    const cal = { binding: null, input: null, placeId: '', pickedText: '', token: 0, saved: '', touched: false };

    function calendarLocationHtml() {
        return `<span class="cal-select"><select id="event-location" name="event-location" data-ws-cal-select>
                <option value="Estudio propio">Estudio propio</option>
                <option value="${CUSTOM}">Otra dirección…</option>
            </select><i data-wo-icon="chevron-down" aria-hidden="true"></i></span>
            <div class="cal-location-custom" data-ws-cal-custom hidden>
                <input id="event-location-custom" type="text" maxlength="${M.LOCATION_MAX}" autocomplete="off"
                    aria-label="Dirección de la sesión" placeholder="Estudio o calle y número, ciudad">
                <small>Empieza a escribir y elige una sugerencia de Google Maps, o escribe la dirección completa.</small>
            </div>`;
    }

    function calElements() {
        const select = document.getElementById('event-location');
        if (!select || !select.hasAttribute('data-ws-cal-select')) return null;
        return {
            select,
            customBox: document.querySelector('[data-ws-cal-custom]'),
            input: document.getElementById('event-location-custom'),
        };
    }

    function readCalendarLocation() {
        const els = calElements();
        if (!els) return null;
        if (els.select.value === CUSTOM) {
            const text = M.clean(els.input && els.input.value);
            if (!text) return { location: null };
            return { location: text, location_kind: 'custom', location_ref: null, location_place_id: text === M.clean(cal.pickedText) && cal.placeId ? cal.placeId : null };
        }
        const option = els.select.options[els.select.selectedIndex];
        if (!option || !option.value) return { location: null };
        // Sin data-kind = la dirección que ya estaba guardada: se conserva su
        // origen (location_kind vacío → el editor no reescribe kind/ref/place_id).
        return {
            location: option.value,
            location_kind: option.getAttribute('data-kind') || '',
            location_ref: option.getAttribute('data-ref') || null,
            location_place_id: option.getAttribute('data-place') || null,
        };
    }

    /**
     * Completa el <select> del editor con las ubicaciones reales.
     * opts: { quoteId, value, onChange() }
     *   value = dirección guardada ('' si no hay) al abrir el editor;
     *   value undefined = solo cambió la cotización elegida: se conserva lo que
     *   el artista ya eligió (o se pasa a la sede que pidió el cliente).
     */
    function mountCalendarLocation(opts = {}) {
        const els = calElements();
        if (!els) return;
        cal.token += 1;
        const token = cal.token;
        const fresh = opts.value !== undefined || cal.input !== els.input;
        if (fresh) {
            cal.saved = M.clean(opts.value);
            cal.touched = false;
            cal.placeId = '';
            cal.pickedText = '';
            if (cal.binding && typeof cal.binding.detach === 'function') cal.binding.detach();
            cal.binding = null;
            cal.input = els.input;
        }
        const keepCustom = cal.touched && els.select.value === CUSTOM;
        const saved = cal.touched && !keepCustom ? M.clean((readCalendarLocation() || {}).location) : cal.saved;
        const notify = () => { if (typeof opts.onChange === 'function') opts.onChange(); };

        function syncCustom() {
            const custom = els.select.value === CUSTOM;
            if (els.customBox) els.customBox.hidden = !custom;
            if (custom && !cal.binding) {
                UI.ensureAddressPicker().then((api) => {
                    if (!api || cal.binding || cal.input !== els.input || !els.input.isConnected) return;
                    cal.binding = api.attach(els.input, {
                        types: [],
                        onChange(address, place) {
                            const formatted = (address && address.formatted_address) || '';
                            if (!formatted) { cal.placeId = ''; cal.pickedText = ''; notify(); return; }
                            const text = M.fullLocation(place && place.name, formatted);
                            els.input.value = text;
                            cal.pickedText = text;
                            cal.placeId = (address && address.google_place_id) || '';
                            notify();
                        },
                    });
                });
            }
        }
        els.select.onchange = () => { cal.touched = true; syncCustom(); if (els.select.value === CUSTOM && els.input) els.input.focus(); notify(); };
        if (els.input) els.input.oninput = () => { cal.touched = true; notify(); };
        syncCustom();

        locationOptions(opts.quoteId).then((data) => {
            const now = calElements();
            if (!now || cal.token !== token || now.select !== els.select) return;
            const options = data.options || [];
            const match = saved ? options.find((o) => M.clean(o.location).toLowerCase() === saved.toLowerCase()) : null;
            const groups = [];
            options.forEach((option) => {
                let group = groups.find((g) => g.label === (option.group || 'Ubicaciones'));
                if (!group) { group = { label: option.group || 'Ubicaciones', items: [] }; groups.push(group); }
                group.items.push(option);
            });
            const optionHtml = (o) => `<option value="${esc(o.location)}" data-kind="${esc(o.kind)}" data-ref="${esc(o.ref || '')}" data-place="${esc(o.place_id || '')}">${esc(o.location)}</option>`;
            let html = groups.map((g) => `<optgroup label="${esc(g.label)}">${g.items.map(optionHtml).join('')}</optgroup>`).join('');
            // Lo guardado que no es una de sus ubicaciones se conserva tal cual.
            if (saved && !match) html += `<optgroup label="Guardada"><option value="${esc(saved)}">${esc(saved)}</option></optgroup>`;
            if (!options.length && !saved) html += '<option value="Estudio propio" data-kind="custom">Estudio propio</option>';
            html += `<option value="${CUSTOM}">Otra dirección…</option>`;
            els.select.innerHTML = html;
            const preferred = match ? match.location : saved || (options[0] && options[0].location) || 'Estudio propio';
            els.select.value = keepCustom ? CUSTOM : preferred;
            if (els.select.selectedIndex < 0) els.select.selectedIndex = 0;
            syncCustom();
            notify();
        });
    }

    /** El cliente ya confirmó: el cambio hecho en el calendario se le pide. */
    async function requestCalendarChange(event, payload) {
        const repo = flowRepo();
        if (!repo) throw new Error('No pudimos conectar con el servidor.');
        const session = (event && event.raw && event.raw.session) || {};
        const body = {};
        const start = M.toDate(payload.starts_at);
        const end = M.toDate(payload.ends_at);
        const current = M.toDate(session.session_date);
        if (start && (!current || start.getTime() !== current.getTime())) body.proposed_date = start.toISOString();
        if (start && end) {
            const hours = Math.round(Math.max(0.25, (end - start) / 3600000) * 100) / 100;
            if (hours !== Number(session.duration_hours || 1)) body.duration_hours = hours;
        }
        const meta = payload.location_meta && payload.location_meta.location ? payload.location_meta : (payload.location ? { location: payload.location, location_kind: 'custom' } : null);
        if (meta && M.clean(meta.location).toLowerCase() !== M.clean(session.location).toLowerCase()) Object.assign(body, locationPatch(meta));
        const notes = payload.notes ? String(payload.notes).trim() : null;
        // Las notas son del artista: se guardan sin pedir acuerdo.
        if ((notes || null) !== (session.notes || null) && window.WeotziData && window.WeotziData.Sessions) {
            await window.WeotziData.Sessions.update(event.baseId, { notes });
        }
        if (!body.proposed_date && body.duration_hours == null && !body.location) return { requested: false };
        await repo.requestChange(event.baseId, body);
        return { requested: true };
    }

    window.WoSessionFlow = {
        ensure,
        invalidate,
        view,
        available: () => state.available === true,
        hasClientAccount: () => !!(state.quote && state.quote.has_client_account),
        rowExtras,
        handleAction,
        locationOptions,
        mountLocation,
        locationPatch,
        createSession,
        updateSession,
        explain,
        needsAgreement,
        calendarLocationHtml,
        mountCalendarLocation,
        readCalendarLocation,
        requestCalendarChange,
    };
})();
