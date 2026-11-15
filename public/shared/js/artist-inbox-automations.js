/**
 * Ronda 2 · Inbox [P9] — respuestas automáticas del artista.
 *
 * Diálogo de configuración del saludo y de la respuesta de ausencia. Los
 * mensajes NO se envían desde acá: los envía la base (triggers de la migración
 * 20261116160200) cuando un cliente escribe. Esta pantalla solo guarda la
 * configuración (artist_inbox_automations) y muestra el estado actual que
 * calcula la base (get_inbox_automation_status).
 *
 *   WoInboxAutomations.open({ getUserId, notify, accountHref })
 *
 * Datos: WeotziData.InboxAutomations (inbox-extras-repo.js). Reglas puras:
 * WeotziInboxExtras (inbox-extras-model.js).
 */
(function () {
    'use strict';

    const X = window.WeotziInboxExtras;
    if (!X) {
        console.error('[artist-inbox-automations] inbox-extras-model.js debe cargarse antes.');
        return;
    }

    let current = null; // diálogo abierto

    function h(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    }

    function focusables(root) {
        return Array.prototype.filter.call(
            root.querySelectorAll('button, [href], input, textarea, select'),
            function (node) { return !node.disabled && !node.hidden && node.offsetParent !== null; }
        );
    }

    function toggle(id, labelId) {
        const label = h('label', 'wo-toggle wo-ia-toggle');
        const input = h('input');
        input.type = 'checkbox';
        input.id = id;
        input.setAttribute('role', 'switch');
        input.setAttribute('aria-labelledby', labelId);
        const knob = h('span', 'knob');
        knob.setAttribute('aria-hidden', 'true');
        label.appendChild(input);
        label.appendChild(knob);
        return { label: label, input: input };
    }

    function textField(id, labelText, rows, placeholder) {
        const field = h('div', 'wo-field wo-ia-field');
        const label = h('label', 'wo-label', labelText);
        label.htmlFor = id;
        const area = h('textarea', 'wo-textarea wo-ia-textarea');
        area.id = id;
        area.rows = rows;
        area.maxLength = X.AUTO_LIMITS.body;
        if (placeholder) area.placeholder = placeholder;
        const counter = h('span', 'wo-help wo-ia-counter');
        counter.id = id + '-counter';
        const error = h('span', 'wo-error-msg wo-ia-field-error');
        error.id = id + '-error';
        error.hidden = true;
        area.setAttribute('aria-describedby', counter.id + ' ' + error.id);
        const sync = function () { counter.textContent = area.value.length + ' / ' + X.AUTO_LIMITS.body; };
        area.addEventListener('input', sync);
        field.appendChild(label);
        field.appendChild(area);
        field.appendChild(counter);
        field.appendChild(error);
        return { field: field, area: area, error: error, sync: sync };
    }

    function check(id, text) {
        const label = h('label', 'wo-check wo-ia-check');
        const input = h('input');
        input.type = 'checkbox';
        input.id = id;
        label.appendChild(input);
        label.appendChild(h('span', '', text));
        return { label: label, input: input };
    }

    function open(options) {
        if (current) return;
        const opts = options || {};
        const api = (window.WeotziData || {}).InboxAutomations || null;
        const uid = typeof opts.getUserId === 'function' ? opts.getUserId() : null;
        const notify = function (message, tone) { if (typeof opts.notify === 'function') opts.notify(message, tone); };
        const returnFocus = document.activeElement;

        const overlay = h('div', 'wo-overlay wo-ia-overlay');
        const dialog = h('div', 'wo-modal wo-ia-modal');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'wo-ia-title');

        const head = h('div', 'wo-ia-head');
        const title = h('h2', 'wo-modal-title', 'Respuestas automáticas');
        title.id = 'wo-ia-title';
        const close = h('button', 'wo-qr-close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', 'Cerrar');
        head.appendChild(title);
        head.appendChild(close);

        const intro = h('p', 'wo-ia-intro', 'Se envían solas cuando un cliente te escribe y se ven marcadas como «' + X.AUTO_LABEL + '». No se envían si le escribiste a mano en la última hora.');

        const form = h('form', 'wo-ia-form');
        form.noValidate = true;
        const grid = h('div', 'wo-ia-grid');

        // --- Saludo
        const greetCard = h('section', 'wo-ia-card');
        const greetHead = h('div', 'wo-ia-card-head');
        const greetTitle = h('h3', 'wo-ia-card-title', 'Saludo automático');
        greetTitle.id = 'wo-ia-greeting-title';
        const greetToggle = toggle('wo-ia-greeting-on', greetTitle.id);
        greetHead.appendChild(greetTitle);
        greetHead.appendChild(greetToggle.label);
        const greetHelp = h('p', 'wo-ia-help', 'Responde al primer mensaje de un cliente, una sola vez por conversación.');
        const greetText = textField('wo-ia-greeting-body', 'Mensaje de saludo', 4);
        const greetNote = h('p', 'wo-ia-note', 'Si ese primer mensaje llega mientras estás ausente, se envía solo la respuesta de ausencia.');
        greetCard.appendChild(greetHead);
        greetCard.appendChild(greetHelp);
        greetCard.appendChild(greetText.field);
        greetCard.appendChild(greetNote);

        // --- Ausencia
        const awayCard = h('section', 'wo-ia-card');
        const awayHead = h('div', 'wo-ia-card-head');
        const awayTitle = h('h3', 'wo-ia-card-title', 'Respuesta de ausencia');
        awayTitle.id = 'wo-ia-away-title';
        const awayToggle = toggle('wo-ia-away-on', awayTitle.id);
        awayHead.appendChild(awayTitle);
        awayHead.appendChild(awayToggle.label);
        const awayHelp = h('p', 'wo-ia-help', 'Responde cuando no estás, una vez por conversación en cada ausencia.');
        const scope = h('div', 'wo-ia-scope');
        scope.setAttribute('role', 'group');
        scope.setAttribute('aria-label', 'Cuándo se envía la respuesta de ausencia');
        const offHours = check('wo-ia-away-hours', 'Fuera de mi horario');
        const vacation = check('wo-ia-away-vacation', 'Durante mis vacaciones');
        scope.appendChild(offHours.label);
        scope.appendChild(vacation.label);
        const scopeError = h('span', 'wo-error-msg wo-ia-field-error');
        scopeError.hidden = true;
        const awayText = textField('wo-ia-away-body', 'Mensaje de ausencia', 3);
        const vacationText = textField('wo-ia-vacation-body', 'Mensaje para vacaciones (opcional)', 2, 'Si lo dejas vacío se usa el mensaje de ausencia');
        const status = h('p', 'wo-ia-status');
        status.setAttribute('role', 'status');
        const statusText = h('span', 'wo-ia-status-text', 'Consultando tu horario…');
        const statusLink = h('a', 'wo-ia-status-link', 'Editar horario y vacaciones');
        statusLink.href = opts.accountHref || '/artist/account#disponibilidad';
        status.appendChild(statusText);
        status.appendChild(statusLink);
        awayCard.appendChild(awayHead);
        awayCard.appendChild(awayHelp);
        awayCard.appendChild(scope);
        awayCard.appendChild(scopeError);
        awayCard.appendChild(awayText.field);
        awayCard.appendChild(vacationText.field);
        awayCard.appendChild(status);

        grid.appendChild(greetCard);
        grid.appendChild(awayCard);

        const error = h('p', 'wo-error-msg wo-ia-error');
        error.setAttribute('role', 'alert');
        error.hidden = true;

        const actions = h('div', 'wo-modal-actions wo-ia-actions');
        const cancel = h('button', 'wo-btn wo-btn--ghost wo-btn--s', 'Cancelar');
        cancel.type = 'button';
        const save = h('button', 'wo-btn wo-btn--s', 'Guardar');
        save.type = 'submit';
        actions.appendChild(cancel);
        actions.appendChild(save);

        form.appendChild(grid);
        form.appendChild(error);
        form.appendChild(actions);
        dialog.appendChild(head);
        dialog.appendChild(intro);
        dialog.appendChild(form);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        current = overlay;

        const controls = [greetToggle.input, greetText.area, awayToggle.input, offHours.input, vacation.input, awayText.area, vacationText.area, save];

        function setBusy(value) {
            controls.forEach(function (node) { node.disabled = value; });
            if (!value) syncEnabled();
        }

        // Los textos quedan editables aunque el automático esté apagado: se
        // pueden preparar antes de activarlo. Solo se atenúa la tarjeta.
        function syncEnabled() {
            greetCard.classList.toggle('is-off', !greetToggle.input.checked);
            awayCard.classList.toggle('is-off', !awayToggle.input.checked);
            offHours.input.disabled = !awayToggle.input.checked;
            vacation.input.disabled = !awayToggle.input.checked;
        }

        function fill(values) {
            greetToggle.input.checked = values.greeting_enabled;
            greetText.area.value = values.greeting_body;
            awayToggle.input.checked = values.away_enabled;
            offHours.input.checked = values.away_off_hours;
            vacation.input.checked = values.away_vacation;
            awayText.area.value = values.away_body;
            vacationText.area.value = values.away_vacation_body;
            [greetText, awayText, vacationText].forEach(function (field) { field.sync(); });
            syncEnabled();
        }

        function read() {
            return {
                greeting_enabled: greetToggle.input.checked,
                greeting_body: greetText.area.value,
                away_enabled: awayToggle.input.checked,
                away_off_hours: offHours.input.checked,
                away_vacation: vacation.input.checked,
                away_body: awayText.area.value,
                away_vacation_body: vacationText.area.value,
            };
        }

        function fieldError(field, message) {
            field.error.textContent = message || '';
            field.error.hidden = !message;
            field.area.classList.toggle('wo-input--error', Boolean(message));
            if (message) field.area.setAttribute('aria-invalid', 'true');
            else field.area.removeAttribute('aria-invalid');
        }

        function showErrors(errors) {
            fieldError(greetText, errors.greeting_body);
            fieldError(awayText, errors.away_body);
            fieldError(vacationText, errors.away_vacation_body);
            scopeError.textContent = errors.away_scope || '';
            scopeError.hidden = !errors.away_scope;
        }

        function closeDialog() {
            if (current !== overlay) return;
            overlay.remove();
            current = null;
            try {
                if (returnFocus && document.contains(returnFocus) && !returnFocus.disabled) returnFocus.focus();
            } catch (_) { /* noop */ }
        }

        close.addEventListener('click', closeDialog);
        cancel.addEventListener('click', closeDialog);
        overlay.addEventListener('mousedown', function (event) {
            if (event.target === overlay) closeDialog();
        });
        dialog.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeDialog();
                return;
            }
            if (event.key !== 'Tab') return;
            const nodes = focusables(dialog);
            if (!nodes.length) return;
            const first = nodes[0];
            const last = nodes[nodes.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
        [greetToggle.input, awayToggle.input].forEach(function (input) {
            input.addEventListener('change', syncEnabled);
        });

        form.addEventListener('submit', async function (event) {
            event.preventDefault();
            if (!api || !uid) {
                error.textContent = 'No pudimos guardar tus respuestas automáticas. Vuelve a intentarlo.';
                error.hidden = false;
                return;
            }
            const result = X.normalizeAutomations(read());
            showErrors(result.errors);
            error.hidden = true;
            if (!result.ok) {
                const firstBad = result.errors.greeting_body ? greetText.area
                    : result.errors.away_scope ? offHours.input
                        : result.errors.away_body ? awayText.area : vacationText.area;
                try { firstBad.focus(); } catch (_) { /* noop */ }
                return;
            }
            setBusy(true);
            save.textContent = 'Guardando…';
            try {
                await api.save(uid, result.value);
                notify('Respuestas automáticas guardadas.', 'success');
                closeDialog();
            } catch (failure) {
                console.error('[artist-inbox-automations] guardar', failure);
                error.textContent = 'No pudimos guardar tus respuestas automáticas. Vuelve a intentarlo.';
                error.hidden = false;
                save.textContent = 'Guardar';
                setBusy(false);
            }
        });

        // Carga: configuración guardada + estado actual del horario.
        fill(X.automationsFromRow(null));
        setBusy(true);
        const loadConfig = api && uid ? api.get(uid) : Promise.reject(new Error('sin sesión'));
        loadConfig.then(function (row) {
            if (current !== overlay) return;
            fill(X.automationsFromRow(row));
            setBusy(false);
            try { greetToggle.input.focus(); } catch (_) { /* noop */ }
        }).catch(function (failure) {
            if (current !== overlay) return;
            console.warn('[artist-inbox-automations] cargar', failure);
            error.textContent = 'No pudimos cargar tu configuración. Cierra y vuelve a abrir.';
            error.hidden = false;
            try { close.focus(); } catch (_) { /* noop */ }
        });
        const loadStatus = api ? api.status() : Promise.resolve(null);
        loadStatus.then(function (value) {
            if (current !== overlay) return;
            const info = X.awayStatus(value);
            statusText.textContent = info.text || 'La ausencia usa el horario de Cuenta › Disponibilidad.';
            status.classList.toggle('is-away', info.tone === 'away');
            status.classList.toggle('is-open', info.tone === 'open');
        }).catch(function () {
            if (current !== overlay) return;
            statusText.textContent = 'La ausencia usa el horario de Cuenta › Disponibilidad.';
        });
        try { close.focus(); } catch (_) { /* noop */ }
    }

    window.WoInboxAutomations = { open: open };
})();
