/**
 * WE OTZI - Interfaz compartida de sesiones (ronda 2 · frente "sesiones")
 * ---------------------------------------------------------------------------
 * Diálogos y controles que usan el expediente del artista
 * (wo-session-flow.js), el calendario y el panel del cliente
 * (client-sessions.js):
 *
 *   · selector de ubicación: sedes de los estudios del artista, ubicaciones
 *     propias, la que eligió el cliente o una dirección escrita con el
 *     autocompletar de Google Maps (reusa address-picker.js + geocoder.js);
 *   · pedir un cambio / responderlo / retirar el pedido;
 *   · calificar y dejar el registro de una sesión pasada;
 *   · pedir una disputa a soporte.
 *
 * No guarda nada por su cuenta: llama a window.WeotziData.SessionFlow (el
 * servidor valida las reglas) y resuelve con el resultado. Todo dato de
 * usuario pasa por esc() antes de llegar al HTML.
 *
 * Requiere wo-session-model.js y data/sessions-flow-repo.js. Expone window.WoSessionUI.
 */
(function () {
    'use strict';

    const M = window.WoSessionModel;
    if (!M) {
        console.error('[wo-session-ui] wo-session-model.js debe cargarse antes.');
        return;
    }

    const CUSTOM = '__custom';
    let seq = 0;

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function repo() {
        const flow = window.WeotziData && window.WeotziData.SessionFlow;
        if (!flow) throw Object.assign(new Error('No pudimos conectar con el servidor.'), { userMessage: 'No pudimos conectar con el servidor.' });
        return flow;
    }

    function basePath() {
        if (window.WEOTZI_BASE_PATH) return String(window.WEOTZI_BASE_PATH).replace(/\/$/, '');
        return /^\/beta(?:\/|$)/.test(String(window.location.pathname || '')) ? '/beta' : '';
    }

    function userError(message) {
        return Object.assign(new Error(message), { userMessage: message });
    }

    // ISO → valor de <input type="datetime-local"> en la hora del navegador.
    function localInputValue(iso) {
        const d = M.toDate(iso);
        if (!d) return '';
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    /* ----------------------------------- aviso ----------------------------------- */
    function toast(message, opts = {}) {
        let node = document.getElementById('ws-toast');
        if (!node) {
            node = document.createElement('div');
            node.id = 'ws-toast';
            node.className = 'ws-toast';
            node.setAttribute('role', 'status');
            node.setAttribute('aria-live', 'polite');
            document.body.appendChild(node);
        }
        node.textContent = message;
        node.classList.toggle('is-error', !!opts.error);
        node.hidden = false;
        window.clearTimeout(toast.timer);
        toast.timer = window.setTimeout(() => { node.hidden = true; }, opts.error ? 6500 : 4200);
    }

    /* ---------------------------------- diálogo ---------------------------------- */
    function focusable(root) {
        return Array.from(root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])'))
            .filter((el) => el.offsetParent !== null || el === document.activeElement);
    }

    /**
     * openDialog({ title, intro, body, actions, cancelLabel, onOpen(form), onSubmit(form, data, action), onClose() })
     * actions: [{ label, value, className }] (el último es el principal). onSubmit
     * puede lanzar un Error con userMessage para mostrarlo dentro del diálogo.
     */
    function openDialog(options) {
        seq += 1;
        const id = `ws-dialog-${seq}`;
        const overlay = document.createElement('div');
        overlay.className = 'wo-overlay ws-overlay';
        const returnFocus = document.activeElement;
        const actions = (options.actions && options.actions.length ? options.actions : [{ label: options.submitLabel || 'Guardar', value: 'submit', className: options.submitClass || '' }]);
        overlay.innerHTML = `
            <form class="wo-modal ws-modal" role="dialog" aria-modal="true" aria-labelledby="${id}-title" novalidate>
                <h2 class="wo-modal-title" id="${id}-title">${esc(options.title)}</h2>
                ${options.intro ? `<p class="ws-dialog-copy">${esc(options.intro)}</p>` : ''}
                ${options.body || ''}
                <p class="ws-dialog-error" role="alert" hidden></p>
                <div class="wo-modal-actions">
                    <button class="wo-btn wo-btn--ghost wo-btn--s" type="button" data-ws-cancel>${esc(options.cancelLabel || 'Cancelar')}</button>
                    ${actions.map((a) => `<button class="wo-btn wo-btn--s ${esc(a.className || '')}" type="submit" name="ws_action" value="${esc(a.value)}">${esc(a.label)}</button>`).join('')}
                </div>
            </form>`;
        document.body.appendChild(overlay);
        const form = overlay.querySelector('form');
        const errorEl = overlay.querySelector('.ws-dialog-error');
        let closed = false;
        let busy = false;

        function close(result) {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            if (typeof options.onClose === 'function') options.onClose(result);
            if (returnFocus && typeof returnFocus.focus === 'function' && document.contains(returnFocus)) returnFocus.focus();
        }
        function onKey(event) {
            if (event.key === 'Escape' && !busy) {
                // El desplegable de Google Places se cierra primero con Escape.
                if (document.querySelector('.pac-container:not([style*="display: none"]) .pac-item')) return;
                event.preventDefault();
                close(null);
                return;
            }
            if (event.key !== 'Tab') return;
            const items = focusable(form);
            if (!items.length) return;
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
        document.addEventListener('keydown', onKey, true);
        overlay.addEventListener('mousedown', (event) => { if (event.target === overlay && !busy) close(null); });
        form.querySelector('[data-ws-cancel]').addEventListener('click', () => { if (!busy) close(null); });
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (busy) return;
            const submitter = event.submitter || form.querySelector('[type="submit"]');
            const action = (submitter && submitter.value) || actions[actions.length - 1].value;
            errorEl.hidden = true;
            busy = true;
            form.querySelectorAll('button').forEach((b) => { b.disabled = true; });
            if (submitter) submitter.setAttribute('aria-busy', 'true');
            try {
                const data = Object.fromEntries(new FormData(form).entries());
                const result = await options.onSubmit(form, data, action);
                busy = false;
                close(result === undefined ? true : result);
            } catch (error) {
                busy = false;
                console.error('[wo-session-ui]', error);
                errorEl.textContent = (error && error.userMessage) || 'No pudimos guardar. Prueba de nuevo.';
                errorEl.hidden = false;
                form.querySelectorAll('button').forEach((b) => { b.disabled = false; });
                if (submitter) submitter.removeAttribute('aria-busy');
            }
        });
        if (typeof options.onOpen === 'function') options.onOpen(form);
        window.setTimeout(() => {
            const first = form.querySelector('[data-ws-autofocus]') || form.querySelector('input:not([type="hidden"]):not([type="radio"]), textarea, select') || form.querySelector('[type="submit"]');
            if (first) first.focus();
        }, 30);
        return { overlay, form, close };
    }

    function dialogPromise(options) {
        return new Promise((resolve) => {
            openDialog(Object.assign({}, options, {
                onClose: (result) => {
                    if (typeof options.onClose === 'function') options.onClose(result);
                    resolve(result || null);
                },
            }));
        });
    }

    function confirmDialog({ title, message, confirmLabel, danger }) {
        return dialogPromise({
            title, intro: message,
            actions: [{ label: confirmLabel || 'Confirmar', value: 'ok', className: danger ? 'wo-btn--danger' : 'wo-btn--accent' }],
            onSubmit: async () => true,
        }).then((result) => !!result);
    }

    function field(label, control, opts = {}) {
        return `<label class="wo-field${opts.wide ? ' is-wide' : ''}"><span class="wo-label">${esc(label)}</span>${control}${opts.help ? `<span class="wo-help">${esc(opts.help)}</span>` : ''}</label>`;
    }

    /* ----------------------------- selector de ubicación ----------------------------- */
    let pickerLoad = null;
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const node = document.createElement('script');
            node.src = basePath() + src;
            node.async = true;
            node.onload = resolve;
            node.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
            document.head.appendChild(node);
        });
    }
    // Reusa el cargador de Google Maps del registro de estudios.
    function ensureAddressPicker() {
        if (window.WeOtziAddressPicker) return Promise.resolve(window.WeOtziAddressPicker);
        if (!pickerLoad) {
            pickerLoad = (window.WeOtziGeocoder ? Promise.resolve() : loadScript('/shared/js/geocoder.js'))
                .then(() => loadScript('/shared/js/address-picker.js'))
                .then(() => window.WeOtziAddressPicker || null)
                .catch((error) => { console.warn('[wo-session-ui] autocompletar de direcciones no disponible:', error); return null; });
        }
        return pickerLoad;
    }

    /**
     * HTML del selector. opts: { id, label, options: [{key, kind, ref, location,
     * place_id, group}], value: { location, location_kind, location_ref,
     * location_place_id }, allowEmpty, help }
     */
    function locationFieldHtml(opts = {}) {
        seq += 1;
        const id = opts.id || `ws-location-${seq}`;
        const options = Array.isArray(opts.options) ? opts.options : [];
        const current = M.clean(opts.value && opts.value.location);
        const match = current ? options.find((o) => M.clean(o.location).toLowerCase() === current.toLowerCase()) : null;
        // Con valor guardado: su opción (o "Otra dirección"). Sin valor: la primera
        // opción (la del cliente o la sede principal), salvo preferEmpty.
        const selected = match ? match.key
            : current ? CUSTOM
                : (opts.preferEmpty && opts.allowEmpty) ? ''
                    : options.length ? (opts.defaultKey || options[0].key) : CUSTOM;
        const groups = [];
        options.forEach((option) => {
            let group = groups.find((g) => g.label === (option.group || 'Ubicaciones'));
            if (!group) { group = { label: option.group || 'Ubicaciones', items: [] }; groups.push(group); }
            group.items.push(option);
        });
        const optionHtml = (o) => `<option value="${esc(o.key)}" data-location="${esc(o.location)}" data-kind="${esc(o.kind)}" data-ref="${esc(o.ref || '')}" data-place="${esc(o.place_id || '')}"${o.key === selected ? ' selected' : ''}>${esc(o.location)}</option>`;
        const custom = selected === CUSTOM;
        const initial = match || (!custom ? options.find((o) => o.key === selected) : null);
        return `
            <div class="ws-location is-wide" data-ws-location data-initial-place="${esc((opts.value && opts.value.location_place_id) || '')}">
                <label class="wo-label" for="${esc(id)}">${esc(opts.label || 'Ubicación')}</label>
                <select class="wo-select" id="${esc(id)}" name="${esc(opts.name || 'ws_location_choice')}" data-ws-loc-select>
                    ${groups.map((g) => `<optgroup label="${esc(g.label)}">${g.items.map(optionHtml).join('')}</optgroup>`).join('')}
                    <option value="${CUSTOM}"${custom ? ' selected' : ''}>Otra dirección…</option>
                    ${opts.allowEmpty ? `<option value=""${selected === '' ? ' selected' : ''}>Sin definir todavía</option>` : ''}
                </select>
                <div class="ws-location-custom" data-ws-loc-custom${custom ? '' : ' hidden'}>
                    <label class="wo-label" for="${esc(id)}-custom">Dirección</label>
                    <input class="wo-input" id="${esc(id)}-custom" type="text" maxlength="${M.LOCATION_MAX}" autocomplete="off"
                        placeholder="Estudio o calle y número, ciudad" value="${custom ? esc(current) : ''}" data-ws-loc-input>
                    <span class="wo-help">Empieza a escribir y elige una sugerencia de Google Maps, o escribe la dirección completa.</span>
                </div>
                <p class="ws-location-preview" data-ws-loc-preview aria-live="polite"${initial || (custom && current) ? '' : ' hidden'}>${esc(initial ? initial.location : current)}</p>
                ${opts.help ? `<span class="wo-help">${esc(opts.help)}</span>` : ''}
            </div>`;
    }

    /** Conecta el selector ya insertado en `root`. → { read(), destroy() } */
    function bindLocationField(root, opts = {}) {
        const box = root && root.querySelector ? root.querySelector('[data-ws-location]') : null;
        if (!box) return { read: () => null, destroy() {} };
        const select = box.querySelector('[data-ws-loc-select]');
        const customBox = box.querySelector('[data-ws-loc-custom]');
        const input = box.querySelector('[data-ws-loc-input]');
        const preview = box.querySelector('[data-ws-loc-preview]');
        let placeId = input.value ? (box.getAttribute('data-initial-place') || '') : '';
        let pickedText = input.value || '';
        let picker = null;
        let destroyed = false;

        function read() {
            const choice = select.value;
            if (!choice) return null;
            if (choice === CUSTOM) {
                const text = M.clean(input.value);
                if (!text) return null;
                // El place_id solo vale si el texto sigue siendo el que eligió en Google.
                return { location: text, location_kind: 'custom', location_ref: null, location_place_id: text === M.clean(pickedText) && placeId ? placeId : null };
            }
            const option = select.options[select.selectedIndex];
            return {
                location: option.getAttribute('data-location') || option.textContent,
                location_kind: option.getAttribute('data-kind') || 'custom',
                location_ref: option.getAttribute('data-ref') || null,
                location_place_id: option.getAttribute('data-place') || null,
            };
        }
        function sync() {
            const custom = select.value === CUSTOM;
            customBox.hidden = !custom;
            const value = read();
            preview.textContent = value ? value.location : '';
            preview.hidden = !value || custom;
            if (typeof opts.onChange === 'function') opts.onChange(value);
        }
        function attachPicker() {
            if (picker || destroyed) return;
            ensureAddressPicker().then((api) => {
                if (!api || destroyed || picker) return;
                picker = api.attach(input, {
                    types: [],
                    onChange(address, place) {
                        const formatted = (address && address.formatted_address) || '';
                        if (!formatted) { placeId = ''; pickedText = ''; sync(); return; }
                        const text = M.fullLocation(place && place.name, formatted);
                        input.value = text;
                        pickedText = text;
                        placeId = (address && address.google_place_id) || '';
                        sync();
                    },
                });
            });
        }
        const onSelect = () => {
            sync();
            if (select.value === CUSTOM) { attachPicker(); window.setTimeout(() => input.focus(), 20); }
        };
        const onInput = () => sync();
        select.addEventListener('change', onSelect);
        input.addEventListener('input', onInput);
        if (select.value === CUSTOM) attachPicker();
        sync();
        return {
            read,
            destroy() {
                destroyed = true;
                select.removeEventListener('change', onSelect);
                input.removeEventListener('input', onInput);
                if (picker && typeof picker.detach === 'function') picker.detach();
            },
        };
    }

    /* ------------------------------ resumen de la sesión ------------------------------ */
    function sessionSummaryHtml(session, opts = {}) {
        const rows = [
            ['Fecha', M.dateTimeLabel(session.session_date)],
            ['Duración', M.durationLabel(session.duration_hours)],
            ['Lugar', session.location || ''],
        ].filter((row) => row[1]);
        if (opts.counterpart) rows.unshift([opts.counterpartLabel || 'Con', opts.counterpart]);
        return `<dl class="ws-summary">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
    }

    /* --------------------------------- pedir un cambio --------------------------------- */
    /**
     * opts: { role, counterpart, locations: { options, defaultKey } }
     * Resuelve con la respuesta del servidor o null si se cancela.
     */
    function changeDialog(session, opts = {}) {
        const role = opts.role === 'artist' ? 'artist' : 'client';
        const other = opts.counterpart || (role === 'artist' ? 'el cliente' : 'el artista');
        const confirmed = M.confirmationOf(session) === 'confirmed';
        const now = new Date();
        const min = localInputValue(new Date(now.getTime() + 60 * 60 * 1000).toISOString());
        const intro = confirmed
            ? `La sesión sigue como está hasta que ${other} acepte el cambio. Se puede pedir hasta ${M.EDIT_WINDOW_DAYS} días antes.`
            : `Propón otra fecha. ${other.charAt(0).toUpperCase() + other.slice(1)} la acepta o te propone otra.`;
        let location = null;
        const artistFields = role === 'artist' ? `
                ${field('Duración (horas)', `<input class="wo-input" name="duration_hours" type="number" min="0.25" max="24" step="0.25" value="${esc(session.duration_hours || '')}">`)}
                ${locationFieldHtml({ options: (opts.locations && opts.locations.options) || [], value: session, allowEmpty: !session.location, preferEmpty: true, label: 'Lugar' })}` : '';
        return dialogPromise({
            title: 'Pedir un cambio de sesión',
            intro,
            body: `${sessionSummaryHtml(session)}
                <div class="ws-grid">
                    ${field('Nueva fecha y hora', `<input class="wo-input" name="proposed_date" type="datetime-local" min="${esc(min)}" value="${esc(localInputValue(session.session_date))}" ${role === 'client' ? 'required' : ''} data-ws-autofocus>`, { wide: role === 'client' })}
                    ${artistFields}
                    ${field('Motivo (opcional)', `<textarea class="wo-textarea ws-textarea" name="note" maxlength="${M.NOTE_MAX}" placeholder="Cuéntale por qué necesitas el cambio."></textarea>`, { wide: true })}
                </div>`,
            actions: [{ label: 'Enviar pedido', value: 'send', className: 'wo-btn--accent' }],
            onOpen(form) { if (role === 'artist') location = bindLocationField(form); },
            async onSubmit(form, data) {
                const body = { note: (data.note || '').trim() };
                if (data.proposed_date) {
                    const date = new Date(data.proposed_date);
                    if (Number.isNaN(date.getTime())) throw userError('La fecha no es válida.');
                    if (date.getTime() <= Date.now()) throw userError('Elige una fecha futura.');
                    if (date.getTime() !== (M.toDate(session.session_date) || new Date(0)).getTime()) body.proposed_date = date.toISOString();
                }
                if (role === 'artist') {
                    const hours = Number(data.duration_hours);
                    if (data.duration_hours && Number.isFinite(hours) && hours !== Number(session.duration_hours || 0)) body.duration_hours = hours;
                    const value = location ? location.read() : null;
                    if (value && M.clean(value.location).toLowerCase() !== M.clean(session.location).toLowerCase()) Object.assign(body, value);
                }
                if (!body.proposed_date && body.duration_hours == null && !body.location) {
                    throw userError(role === 'artist' ? 'Cambia la fecha, la duración o el lugar para enviar el pedido.' : 'Elige una fecha distinta de la actual.');
                }
                return repo().requestChange(session.id, body);
            },
            onClose() { if (location) location.destroy(); },
        });
    }

    /* -------------------------------- responder un cambio -------------------------------- */
    function proposalHtml(session, request) {
        const rows = [];
        if (request.proposed_date) {
            rows.push(['Fecha actual', M.dateTimeLabel(session.session_date)]);
            rows.push(['Fecha propuesta', M.dateTimeLabel(request.proposed_date)]);
        }
        if (request.proposed_duration_hours) rows.push(['Duración propuesta', M.durationLabel(request.proposed_duration_hours)]);
        if (request.proposed_location) rows.push(['Lugar propuesto', request.proposed_location]);
        if (request.note) rows.push(['Motivo', request.note]);
        return `<dl class="ws-summary ws-summary--proposal">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
    }

    function respondDialog(session, opts = {}) {
        const request = session.request;
        if (!request) return Promise.resolve(null);
        const other = opts.counterpart || 'La otra parte';
        return dialogPromise({
            title: 'Responder el pedido de cambio',
            intro: `${other} pidió modificar la sesión. Si aceptas, queda confirmada con los datos nuevos. Si no llegan a un acuerdo, puedes pedir una disputa a soporte.`,
            body: `${proposalHtml(session, request)}
                ${field('Respuesta (opcional)', `<textarea class="wo-textarea ws-textarea" name="note" maxlength="${M.NOTE_MAX}" placeholder="Agrega un comentario para la otra parte."></textarea>`, { wide: true })}`,
            actions: [
                { label: 'Rechazar', value: 'reject', className: 'wo-btn--ghost' },
                { label: 'Aceptar cambio', value: 'accept', className: 'wo-btn--accent' },
            ],
            cancelLabel: 'Cerrar',
            async onSubmit(form, data, action) {
                return repo().respond(request.id, { decision: action === 'accept' ? 'accept' : 'reject', note: (data.note || '').trim() });
            },
        });
    }

    /* ------------------------------- registro y calificación ------------------------------- */
    function starsInputHtml(name, value) {
        const current = Number(value) || 0;
        return `<fieldset class="ws-stars">
            <legend class="wo-label">Calificación</legend>
            <div class="ws-stars-row">
                ${[1, 2, 3, 4, 5].map((n) => `
                    <label class="ws-star">
                        <input type="radio" name="${esc(name)}" value="${n}"${n === current ? ' checked' : ''}${n === (current || 1) ? ' data-ws-autofocus' : ''} required>
                        <span aria-hidden="true"></span>
                        <span class="wo-sr-only">${n} ${n === 1 ? 'estrella' : 'estrellas'}</span>
                    </label>`).join('')}
            </div>
        </fieldset>`;
    }

    function feedbackBlockHtml(label, feedback) {
        if (!feedback) return '';
        return `<div class="ws-record">
            <span class="wo-label">${esc(label)}</span>
            <span class="ws-record-stars" aria-label="${esc(String(feedback.rating))} de 5">${esc(M.stars(feedback.rating))}</span>
            ${feedback.note ? `<p>${esc(feedback.note)}</p>` : ''}
        </div>`;
    }

    function feedbackDialog(session, opts = {}) {
        const mine = session.feedback && session.feedback.mine;
        const other = session.feedback && session.feedback.other;
        return dialogPromise({
            title: mine ? 'Tu registro de la sesión' : 'Calificar y dejar un registro',
            intro: 'Queda guardado para ti, para la otra parte y para soporte. No es la reseña pública del trabajo.',
            body: `${sessionSummaryHtml(session)}
                ${starsInputHtml('rating', mine && mine.rating)}
                ${field('Registro de la sesión', `<textarea class="wo-textarea ws-textarea" name="note" maxlength="${M.FEEDBACK_NOTE_MAX}" placeholder="Qué se hizo, cómo salió y cualquier dato para recordar.">${esc((mine && mine.note) || '')}</textarea>`, { wide: true })}
                ${feedbackBlockHtml(`Registro de ${opts.counterpart || 'la otra parte'}`, other)}`,
            actions: [{ label: mine ? 'Actualizar registro' : 'Guardar registro', value: 'save', className: 'wo-btn--accent' }],
            onOpen(form) {
                // Pinta las estrellas hasta la elegida (sin depender de :has()).
                const paint = () => {
                    const checked = form.querySelector('.ws-star input:checked');
                    const value = checked ? Number(checked.value) : 0;
                    form.querySelectorAll('.ws-star').forEach((star, index) => star.classList.toggle('is-on', index < value));
                };
                form.addEventListener('change', (event) => { if (event.target && event.target.name === 'rating') paint(); });
                paint();
            },
            async onSubmit(form, data) {
                const rating = Number(data.rating);
                if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw userError('Elige de 1 a 5 estrellas.');
                return repo().feedback(session.id, { rating, note: (data.note || '').trim() });
            },
        });
    }

    /* -------------------------------------- disputa -------------------------------------- */
    function disputeDialog(session) {
        return dialogPromise({
            title: 'Pedir una disputa a soporte',
            intro: 'Úsala si no llegaron a un acuerdo sobre la sesión o si hubo un problema. Soporte revisa el caso y responde dentro de las próximas 48 horas hábiles. Mientras esté abierta, el trabajo no se marca como completado.',
            body: `${sessionSummaryHtml(session)}
                <div class="ws-grid">
                    ${field('Motivo', `<select class="wo-select" name="reason" required data-ws-autofocus>
                        <option value="">Elige un motivo</option>
                        ${M.DISPUTE_REASONS.map((r) => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join('')}
                    </select>`, { wide: true })}
                    ${field('¿Qué pasó?', `<textarea class="wo-textarea ws-textarea" name="description" minlength="${M.DISPUTE_MIN}" maxlength="${M.DISPUTE_MAX}" required placeholder="Cuéntanos qué pasó y qué necesitas que cambie."></textarea>`, { wide: true })}
                </div>`,
            actions: [{ label: 'Pedir disputa', value: 'dispute', className: 'wo-btn--danger' }],
            async onSubmit(form, data) {
                if (!data.reason) throw userError('Elige el motivo de la disputa.');
                const description = (data.description || '').trim();
                if (description.length < M.DISPUTE_MIN) throw userError(`Cuéntanos qué pasó (mínimo ${M.DISPUTE_MIN} caracteres).`);
                return repo().dispute(session.id, { reason: data.reason, description });
            },
        });
    }

    /* ---------------------------- bloques de estado reutilizables ---------------------------- */
    function badgeHtml(badge) {
        if (!badge) return '';
        return `<span class="ws-badge ws-badge--${esc(badge.tone || 'info')}">${esc(badge.label)}</span>`;
    }

    function locationLineHtml(session) {
        if (!session.location) return '<span class="ws-place ws-place--empty">Lugar por definir</span>';
        const url = session.maps_url || M.mapsUrl(session.location);
        return `<span class="ws-place">${esc(session.location)}${url ? ` · <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Ver en Google Maps</a>` : ''}</span>`;
    }

    window.WoSessionUI = {
        esc,
        toast,
        openDialog,
        confirmDialog,
        localInputValue,
        locationFieldHtml,
        bindLocationField,
        ensureAddressPicker,
        sessionSummaryHtml,
        changeDialog,
        respondDialog,
        feedbackDialog,
        disputeDialog,
        feedbackBlockHtml,
        badgeHtml,
        locationLineHtml,
        CUSTOM,
    };
})();
