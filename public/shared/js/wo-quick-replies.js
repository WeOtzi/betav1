/**
 * Ronda 2 · Inbox [P9] — mensajes rápidos.
 *
 * Plantillas guardadas por usuario que se insertan con un toque en el campo
 * del chat, con gestión (crear, editar, borrar, ordenar). Compartido por
 * /artist/inbox (role 'artist' → artist_message_templates kind = 'chat') y
 * /client/chats (role 'client' → client_message_templates).
 *
 *   WoQuickReplies.attach({
 *     role, getUserId, button, form, input,
 *     canUse,            () => boolean  (hilo abierto y no cerrado)
 *     notify,            (mensaje, tono) => void
 *     onOpenAutomations  opcional (artista): abre "Respuestas automáticas"
 *   }) → { close(), openManager() }
 *
 * Datos: WeotziData.QuickReplies (inbox-extras-repo.js). Reglas puras:
 * WeotziInboxExtras (inbox-extras-model.js). Todo texto del usuario se pinta
 * con textContent.
 */
(function () {
    'use strict';

    const X = window.WeotziInboxExtras;
    if (!X) {
        console.error('[wo-quick-replies] inbox-extras-model.js debe cargarse antes.');
        return;
    }

    let seq = 0;

    function h(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    }

    function button(className, text, label) {
        const node = h('button', className, text);
        node.type = 'button';
        if (label) node.setAttribute('aria-label', label);
        return node;
    }

    function focusables(root) {
        return Array.prototype.filter.call(
            root.querySelectorAll('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'),
            function (node) { return !node.disabled && !node.hidden && node.offsetParent !== null; }
        );
    }

    function attach(options) {
        const opts = options || {};
        const role = opts.role === 'client' ? 'client' : 'artist';
        const trigger = opts.button;
        const form = opts.form;
        const input = opts.input;
        if (!trigger || !form || !input) return { close: function () {}, openManager: function () {} };

        const repo = function () { return (window.WeotziData || {}).QuickReplies || null; };
        const userId = function () { return typeof opts.getUserId === 'function' ? opts.getUserId() : null; };
        const notify = function (message, tone) { if (typeof opts.notify === 'function') opts.notify(message, tone); };
        const id = 'wo-qr-' + (++seq);

        let items = null;      // null = todavía no se cargó
        let loading = null;
        let loadError = false;
        let modal = null;      // refs del diálogo de gestión mientras está abierto
        let editingId = null;
        let confirmingId = null;
        let busy = false;

        /* ------------------------------------------------------------- panel */

        const panel = h('div', 'wo-qr-panel');
        panel.id = id;
        panel.hidden = true;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Mensajes rápidos');

        const head = h('div', 'wo-qr-head');
        head.appendChild(h('span', 'wo-qr-title', 'Mensajes rápidos'));
        const manageBtn = button('wo-qr-link', 'Administrar');
        const closeBtn = button('wo-qr-close', '×', 'Cerrar mensajes rápidos');
        head.appendChild(manageBtn);
        head.appendChild(closeBtn);

        const list = h('ul', 'wo-qr-list');
        const hint = h('p', 'wo-qr-hint');
        const foot = h('div', 'wo-qr-foot');
        const createBtn = button('wo-btn wo-btn--s wo-qr-create', 'Crear mensaje rápido');
        foot.appendChild(createBtn);
        if (typeof opts.onOpenAutomations === 'function') {
            const autoBtn = button('wo-qr-link', 'Respuestas automáticas');
            autoBtn.addEventListener('click', function () {
                closePanel(false);
                opts.onOpenAutomations();
            });
            foot.appendChild(autoBtn);
        }

        panel.appendChild(head);
        panel.appendChild(list);
        panel.appendChild(hint);
        panel.appendChild(foot);
        form.appendChild(panel);

        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.setAttribute('aria-controls', id);
        trigger.setAttribute('aria-expanded', 'false');

        function load(force) {
            if (items && !force) return Promise.resolve(items);
            if (loading) return loading;
            const api = repo();
            const uid = userId();
            if (!api || !uid) {
                loadError = true;
                return Promise.resolve([]);
            }
            loadError = false;
            loading = api.list(role, uid).then(function (rows) {
                items = X.sortQuickReplies(rows);
                loading = null;
                return items;
            }).catch(function (error) {
                console.warn('[wo-quick-replies] cargar', error);
                loading = null;
                loadError = true;
                return [];
            });
            return loading;
        }

        function renderPanel() {
            list.textContent = '';
            const rows = items || [];
            rows.forEach(function (item) {
                const li = h('li', 'wo-qr-row');
                const pick = button('wo-qr-item');
                pick.dataset.id = item.id;
                pick.appendChild(h('span', 'wo-qr-item-title', item.title));
                pick.appendChild(h('span', 'wo-qr-item-body', item.body));
                li.appendChild(pick);
                list.appendChild(li);
            });
            list.hidden = !rows.length;
            if (loading) {
                hint.textContent = 'Cargando tus mensajes rápidos…';
                hint.hidden = false;
            } else if (loadError) {
                hint.textContent = 'No pudimos cargar tus mensajes rápidos. Cierra este panel y vuelve a abrirlo.';
                hint.hidden = false;
            } else if (!rows.length) {
                hint.textContent = 'Todavía no tienes mensajes rápidos. Guarda las respuestas que más usas e insértalas con un toque.';
                hint.hidden = false;
            } else {
                hint.hidden = true;
            }
            createBtn.textContent = rows.length ? 'Crear otro' : 'Crear mensaje rápido';
        }

        function openPanel() {
            if (typeof opts.canUse === 'function' && !opts.canUse()) return;
            panel.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
            const pending = load(loadError);
            renderPanel();
            pending.then(function () {
                if (panel.hidden) return;
                renderPanel();
                const first = list.querySelector('.wo-qr-item') || createBtn;
                try { first.focus(); } catch (_) { /* noop */ }
            });
            document.addEventListener('mousedown', onOutside, true);
            document.addEventListener('keydown', onPanelKey, true);
        }

        function closePanel(restoreFocus) {
            if (panel.hidden) return;
            panel.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
            document.removeEventListener('mousedown', onOutside, true);
            document.removeEventListener('keydown', onPanelKey, true);
            if (restoreFocus) {
                try { trigger.focus(); } catch (_) { /* noop */ }
            }
        }

        function onOutside(event) {
            if (panel.contains(event.target) || trigger.contains(event.target)) return;
            closePanel(false);
        }

        function onPanelKey(event) {
            if (event.key === 'Escape' && !modal) {
                event.preventDefault();
                event.stopPropagation();
                closePanel(true);
            }
        }

        function insert(item) {
            if (!item || input.disabled) return;
            const max = Number(input.getAttribute('maxlength')) || 2000;
            input.value = X.insertQuickReply(input.value, item.body, max);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            closePanel(false);
            try {
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
            } catch (_) { /* noop */ }
        }

        trigger.addEventListener('click', function () {
            if (panel.hidden) openPanel();
            else closePanel(true);
        });
        closeBtn.addEventListener('click', function () { closePanel(true); });
        list.addEventListener('click', function (event) {
            const pick = event.target.closest('.wo-qr-item');
            if (!pick) return;
            insert((items || []).find(function (item) { return String(item.id) === pick.dataset.id; }));
        });
        manageBtn.addEventListener('click', function () {
            closePanel(false);
            openManager();
        });
        createBtn.addEventListener('click', function () {
            closePanel(false);
            openManager();
        });

        /* ----------------------------------------------------------- gestión */

        function openManager() {
            if (modal) return;
            const returnFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : trigger;
            const overlay = h('div', 'wo-overlay wo-qr-overlay');
            const dialog = h('div', 'wo-modal wo-qr-modal');
            dialog.setAttribute('role', 'dialog');
            dialog.setAttribute('aria-modal', 'true');
            dialog.setAttribute('aria-labelledby', id + '-title');

            const top = h('div', 'wo-qr-modal-head');
            const title = h('h2', 'wo-modal-title', 'Mensajes rápidos');
            title.id = id + '-title';
            const close = button('wo-qr-close', '×', 'Cerrar');
            top.appendChild(title);
            top.appendChild(close);

            const intro = h('p', 'wo-qr-modal-intro', 'Guarda las respuestas que usas seguido. En el chat las insertas con un toque y puedes editarlas antes de enviar.');

            const grid = h('div', 'wo-qr-modal-grid');
            const listCol = h('section', 'wo-qr-manage');
            listCol.setAttribute('aria-label', 'Tus mensajes rápidos');
            const count = h('p', 'wo-qr-count');
            const manageList = h('ul', 'wo-qr-manage-list');
            const empty = h('p', 'wo-qr-manage-empty');
            listCol.appendChild(count);
            listCol.appendChild(manageList);
            listCol.appendChild(empty);

            const editor = h('form', 'wo-qr-form');
            editor.noValidate = true;
            const formTitle = h('h3', 'wo-qr-form-title', 'Nuevo mensaje');
            const titleField = h('div', 'wo-field');
            const titleLabel = h('label', 'wo-label', 'Nombre');
            titleLabel.htmlFor = id + '-name';
            const titleInput = h('input', 'wo-input');
            titleInput.type = 'text';
            titleInput.id = id + '-name';
            titleInput.maxLength = X.QUICK_LIMITS.title;
            titleInput.autocomplete = 'off';
            titleInput.placeholder = 'Ej.: Cuidados después de la sesión';
            titleField.appendChild(titleLabel);
            titleField.appendChild(titleInput);

            const bodyField = h('div', 'wo-field');
            const bodyLabel = h('label', 'wo-label', 'Mensaje');
            bodyLabel.htmlFor = id + '-body';
            const bodyInput = h('textarea', 'wo-textarea wo-qr-textarea');
            bodyInput.id = id + '-body';
            bodyInput.maxLength = X.QUICK_LIMITS.body;
            bodyInput.rows = 4;
            bodyInput.placeholder = 'Escribe el texto tal como lo enviarías';
            const counter = h('span', 'wo-help wo-qr-counter');
            counter.id = id + '-counter';
            bodyInput.setAttribute('aria-describedby', counter.id);
            bodyField.appendChild(bodyLabel);
            bodyField.appendChild(bodyInput);
            bodyField.appendChild(counter);

            const error = h('p', 'wo-error-msg wo-qr-error');
            error.setAttribute('role', 'alert');
            error.hidden = true;

            const actions = h('div', 'wo-qr-form-actions');
            const save = h('button', 'wo-btn wo-btn--s', 'Guardar');
            save.type = 'submit';
            const cancelEdit = button('wo-btn wo-btn--ghost wo-btn--s', 'Cancelar');
            cancelEdit.hidden = true;
            actions.appendChild(save);
            actions.appendChild(cancelEdit);

            editor.appendChild(formTitle);
            editor.appendChild(titleField);
            editor.appendChild(bodyField);
            editor.appendChild(error);
            editor.appendChild(actions);

            grid.appendChild(listCol);
            grid.appendChild(editor);
            dialog.appendChild(top);
            dialog.appendChild(intro);
            dialog.appendChild(grid);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            modal = {
                overlay: overlay, dialog: dialog, count: count, list: manageList, empty: empty,
                formTitle: formTitle, titleInput: titleInput, bodyInput: bodyInput, counter: counter,
                error: error, save: save, cancelEdit: cancelEdit, returnFocus: returnFocus,
            };
            editingId = null;
            confirmingId = null;

            const syncCounter = function () {
                counter.textContent = bodyInput.value.length + ' / ' + X.QUICK_LIMITS.body;
            };
            bodyInput.addEventListener('input', syncCounter);
            syncCounter();

            close.addEventListener('click', closeManager);
            overlay.addEventListener('mousedown', function (event) {
                if (event.target === overlay) closeManager();
            });
            dialog.addEventListener('keydown', function (event) {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeManager();
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
            manageList.addEventListener('click', onManageClick);
            editor.addEventListener('submit', onSubmit);
            cancelEdit.addEventListener('click', function () { startEdit(null); });

            renderManager();
            load(loadError).then(function () {
                if (!modal) return;
                renderManager();
            });
            try { titleInput.focus(); } catch (_) { /* noop */ }
        }

        function closeManager() {
            if (!modal) return;
            const target = modal.returnFocus;
            modal.overlay.remove();
            modal = null;
            editingId = null;
            confirmingId = null;
            try { (target && document.contains(target) && !target.disabled ? target : trigger).focus(); } catch (_) { /* noop */ }
        }

        function showError(message) {
            if (!modal) return;
            modal.error.textContent = message || '';
            modal.error.hidden = !message;
        }

        function renderManager() {
            if (!modal) return;
            const rows = items || [];
            modal.count.textContent = loading ? 'Cargando…' : rows.length + ' de ' + X.QUICK_LIMITS.max;
            modal.list.textContent = '';
            rows.forEach(function (item, index) {
                const li = h('li', 'wo-qr-manage-row' + (item.id === editingId ? ' is-editing' : ''));
                li.dataset.id = item.id;
                const copy = h('div', 'wo-qr-manage-copy');
                copy.appendChild(h('strong', 'wo-qr-manage-title', item.title));
                copy.appendChild(h('span', 'wo-qr-manage-body', item.body));
                const tools = h('div', 'wo-qr-manage-tools');
                if (item.id === confirmingId) {
                    tools.appendChild(h('span', 'wo-qr-confirm', '¿Borrar?'));
                    const yes = button('wo-qr-tool is-danger', 'Sí, borrar');
                    yes.dataset.action = 'confirm-delete';
                    const no = button('wo-qr-tool', 'No');
                    no.dataset.action = 'cancel-delete';
                    tools.appendChild(yes);
                    tools.appendChild(no);
                } else {
                    const up = button('wo-qr-tool wo-qr-tool--icon', '↑', 'Subir «' + item.title + '»');
                    up.dataset.action = 'up';
                    up.disabled = index === 0 || busy;
                    const down = button('wo-qr-tool wo-qr-tool--icon', '↓', 'Bajar «' + item.title + '»');
                    down.dataset.action = 'down';
                    down.disabled = index === rows.length - 1 || busy;
                    const edit = button('wo-qr-tool', 'Editar', 'Editar «' + item.title + '»');
                    edit.dataset.action = 'edit';
                    const del = button('wo-qr-tool', 'Borrar', 'Borrar «' + item.title + '»');
                    del.dataset.action = 'delete';
                    tools.appendChild(up);
                    tools.appendChild(down);
                    tools.appendChild(edit);
                    tools.appendChild(del);
                }
                li.appendChild(copy);
                li.appendChild(tools);
                modal.list.appendChild(li);
            });
            modal.list.hidden = !rows.length;
            modal.empty.hidden = Boolean(rows.length) || Boolean(loading);
            modal.empty.textContent = loadError
                ? 'No pudimos cargar tus mensajes rápidos. Cierra y vuelve a abrir.'
                : 'Todavía no guardaste ninguno. Crea el primero con el formulario.';
        }

        function startEdit(item) {
            if (!modal) return;
            editingId = item ? item.id : null;
            confirmingId = null;
            modal.formTitle.textContent = item ? 'Editar mensaje' : 'Nuevo mensaje';
            modal.titleInput.value = item ? item.title : '';
            modal.bodyInput.value = item ? item.body : '';
            modal.bodyInput.dispatchEvent(new Event('input'));
            modal.cancelEdit.hidden = !item;
            modal.save.textContent = item ? 'Guardar cambios' : 'Guardar';
            showError('');
            renderManager();
            try { modal.titleInput.focus(); } catch (_) { /* noop */ }
        }

        function focusRowTool(rowId, action) {
            if (!modal) return;
            const rows = modal.list.querySelectorAll('.wo-qr-manage-row');
            const row = Array.prototype.find.call(rows, function (node) { return node.dataset.id === String(rowId); });
            const target = row && (row.querySelector('[data-action="' + action + '"]:not(:disabled)') || row.querySelector('button:not(:disabled)'));
            if (target) {
                try { target.focus(); } catch (_) { /* noop */ }
            }
        }

        async function onManageClick(event) {
            const tool = event.target.closest('[data-action]');
            if (!tool || !modal || busy) return;
            const row = tool.closest('.wo-qr-manage-row');
            const item = (items || []).find(function (entry) { return String(entry.id) === row.dataset.id; });
            if (!item) return;
            const action = tool.dataset.action;
            if (action === 'edit') {
                startEdit(item);
            } else if (action === 'delete') {
                confirmingId = item.id;
                renderManager();
                focusRowTool(item.id, 'cancel-delete');
            } else if (action === 'cancel-delete') {
                confirmingId = null;
                renderManager();
                focusRowTool(item.id, 'delete');
            } else if (action === 'confirm-delete') {
                await removeItem(item);
            } else if (action === 'up' || action === 'down') {
                await moveItem(item, action);
            }
        }

        async function removeItem(item) {
            const api = repo();
            const uid = userId();
            if (!api || !uid) return;
            busy = true;
            try {
                await api.remove(role, uid, item.id);
                items = (items || []).filter(function (entry) { return entry.id !== item.id; });
                if (editingId === item.id) startEdit(null);
                confirmingId = null;
                showError('');
            } catch (error) {
                console.error('[wo-quick-replies] borrar', error);
                showError('No pudimos borrar el mensaje rápido. Vuelve a intentarlo.');
            } finally {
                busy = false;
                renderManager();
                if (modal) {
                    try { modal.titleInput.focus(); } catch (_) { /* noop */ }
                }
            }
        }

        async function moveItem(item, direction) {
            const api = repo();
            const uid = userId();
            if (!api || !uid) return;
            const result = X.moveQuickReply(items, item.id, direction);
            if (!result.moved) return;
            const previous = items;
            items = result.list;
            busy = true;
            renderManager();
            try {
                await api.reorder(role, uid, result.changes);
            } catch (error) {
                console.error('[wo-quick-replies] ordenar', error);
                items = previous;
                showError('No pudimos guardar el orden. Vuelve a intentarlo.');
            } finally {
                busy = false;
                renderManager();
                focusRowTool(item.id, direction);
            }
        }

        async function onSubmit(event) {
            event.preventDefault();
            if (!modal || busy) return;
            const api = repo();
            const uid = userId();
            if (!api || !uid) {
                showError('No pudimos guardar el mensaje rápido. Vuelve a intentarlo.');
                return;
            }
            const check = X.normalizeQuickReply({ title: modal.titleInput.value, body: modal.bodyInput.value });
            if (!check.ok) {
                showError(check.errors.title || check.errors.body);
                try { (check.errors.title ? modal.titleInput : modal.bodyInput).focus(); } catch (_) { /* noop */ }
                return;
            }
            if (!editingId && (items || []).length >= X.QUICK_LIMITS.max) {
                showError(X.quickRepliesError('quick_replies_limit'));
                return;
            }
            busy = true;
            modal.save.disabled = true;
            showError('');
            try {
                if (editingId) {
                    const saved = await api.update(role, uid, editingId, check.value);
                    items = (items || []).map(function (entry) {
                        return entry.id === editingId ? Object.assign({}, entry, check.value, saved || {}) : entry;
                    });
                    notify('Mensaje rápido actualizado.', 'success');
                } else {
                    const created = await api.create(role, uid, Object.assign({ sort: X.nextQuickSort(items) }, check.value));
                    if (created && created.id) items = X.sortQuickReplies((items || []).concat(created));
                    else items = await api.list(role, uid).then(X.sortQuickReplies);
                    notify('Mensaje rápido guardado.', 'success');
                }
                busy = false;
                if (modal) {
                    modal.save.disabled = false;
                    startEdit(null);
                }
            } catch (error) {
                console.error('[wo-quick-replies] guardar', error);
                busy = false;
                if (modal) {
                    modal.save.disabled = false;
                    showError(X.quickRepliesError(error));
                }
            }
        }

        return {
            close: function () { closePanel(false); },
            openManager: openManager,
        };
    }

    window.WoQuickReplies = { attach: attach };
})();
