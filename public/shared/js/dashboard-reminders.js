/* ============================================================================
   WE ÖTZI — Dashboard del artista · Recordatorios (Figma final, oct 2026)
   ----------------------------------------------------------------------------
   Frames: 24:1425 (lista del rail), 801:563 (ver detalle), 801:560 (nuevo),
   801:1109 (editar detalle y prioridad, selector de íconos abierto).
   Datos: window.WeotziData.Reminders (public/shared/js/data/reminders-repo.js).

   QA / estados por URL:
     ?modal=nuevo-recordatorio
     ?modal=recordatorio[&id=<uuid>]            (sin id: el primero de la lista)
     ?modal=editar-recordatorio[&id=<uuid>][&iconos=1]
   ============================================================================ */
(function () {
    'use strict';

    var state = { user: null, list: [], loaded: false, form: null, viewing: null, busy: false };
    var els = {};

    function $(id) { return document.getElementById(id); }
    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function repo() { return window.WeotziData && window.WeotziData.Reminders; }
    function model() { var r = repo(); return r && r.model; }
    function icon(name, cls) {
        return '<i data-wo-icon="' + esc(name) + '"' + (cls ? ' class="' + cls + '"' : '') + ' aria-hidden="true"></i>';
    }
    function hydrate(root) {
        if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') {
            try { window.WoIcons.hydrate(root); } catch (e) { /* íconos opcionales */ }
        }
    }
    var PRIORITY_LABEL = { urgente: 'URGENTE', alta: 'ALTA', normal: 'NORMAL', baja: 'BAJA' };

    /* ------------------------------ toast ------------------------------ */
    function toast(message, tone) {
        var box = $('wod-toast');
        if (!box) {
            box = document.createElement('div');
            box.id = 'wod-toast';
            box.className = 'wod-toast';
            box.setAttribute('role', 'status');
            box.setAttribute('aria-live', 'polite');
            document.body.appendChild(box);
        }
        box.textContent = message;
        box.className = 'wod-toast is-visible' + (tone === 'error' ? ' is-error' : '');
        clearTimeout(toast._t);
        toast._t = setTimeout(function () { box.className = 'wod-toast'; }, 3200);
    }
    window.WodToast = toast;

    /* ============================ lista del rail ============================ */
    function rowHtml(r) {
        return '<li class="wod-rem-item' + (r.completed_at ? ' is-done' : '') + '">' +
            '<button type="button" class="wod-rem-row" data-rem-id="' + esc(r.id) + '" aria-label="Ver recordatorio: ' + esc(r.title) + '">' +
                '<span class="wod-rem-ic">' + icon(r.icon) + '</span>' +
                '<span class="wod-rem-body">' +
                    '<span class="wod-rem-title"><span class="wod-rem-tx">' + esc(r.title) + '</span>' +
                        (r.is_important && !r.completed_at ? '<span class="wod-rem-dot" aria-label="Importante"></span>' : '') +
                    '</span>' +
                    '<span class="wod-rem-meta">' +
                        (r.due_date ? '<span class="wod-rem-date">' + esc(model().formatShortDate(r.due_date)) + '</span>' : '') +
                        (r.completed_at
                            ? '<span class="wod-prio is-done">HECHO</span>'
                            : '<span class="wod-prio is-' + esc(r.priority) + '">' + PRIORITY_LABEL[r.priority] + '</span>') +
                    '</span>' +
                '</span>' +
            '</button></li>';
    }

    function renderList() {
        var ul = $('wod-reminder-list');
        if (!ul) return;
        if (!state.loaded) { ul.innerHTML = '<li class="wod-rem-empty">Cargando recordatorios…</li>'; return; }
        var open = state.list.filter(function (r) { return !r.completed_at; });
        var done = state.list.filter(function (r) { return r.completed_at; }).slice(0, 2);
        var items = open.slice(0, 6).concat(done);
        if (!items.length) {
            ul.innerHTML = '<li class="wod-rem-empty">Sin recordatorios pendientes. Sumá uno con + Nuevo recordatorio.</li>';
            return;
        }
        ul.innerHTML = items.map(rowHtml).join('');
        hydrate(ul);
    }

    function findById(id) {
        return state.list.find(function (r) { return r.id === String(id); }) || null;
    }

    async function load() {
        var R = repo();
        if (!R || !state.user) return;
        try {
            state.list = await R.list(state.user.id);
        } catch (e) {
            console.warn('[recordatorios] lista:', e && e.message);
            state.list = [];
            toast('No pudimos cargar tus recordatorios. Probá recargar la página.', 'error');
        }
        state.loaded = true;
        renderList();
        document.dispatchEvent(new CustomEvent('weotzi:reminders-changed', { detail: { list: state.list } }));
    }

    /* =============================== modales =============================== */
    function ensureOverlay() {
        if (els.overlay) return els.overlay;
        var ov = document.createElement('div');
        ov.className = 'wod-ov';
        ov.hidden = true;
        ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeModal(); });
        document.body.appendChild(ov);
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape' || ov.hidden) return;
            if (els.picker && !els.picker.hidden) { togglePicker(false); return; }
            closeModal();
        });
        els.overlay = ov;
        return ov;
    }

    // Figma: el scrim arranca debajo de la topbar (y = 84 en el frame).
    function placeBelowTopbar() {
        var bar = document.querySelector('weotzi-product-nav .wo-org-product-nav') || document.querySelector('weotzi-product-nav');
        var bottom = bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
        document.documentElement.style.setProperty('--wod-drawer-top', Math.round(bottom) + 'px');
    }

    function openModal(html, label) {
        placeBelowTopbar();
        var ov = ensureOverlay();
        ov.innerHTML = '<div class="wod-modal" role="dialog" aria-modal="true" tabindex="-1" aria-label="' + esc(label) + '">' + html + '</div>';
        ov.hidden = false;
        document.body.classList.add('wod-modal-open');
        hydrate(ov);
        var first = ov.querySelector('[data-autofocus]') || ov.querySelector('.wod-modal');
        if (first) setTimeout(function () { try { first.focus(); } catch (e) { /* noop */ } }, 30);
        return ov.firstChild;
    }

    function closeModal() {
        if (!els.overlay) return;
        els.overlay.hidden = true;
        els.overlay.innerHTML = '';
        els.picker = null;
        state.form = null;
        state.viewing = null;
        document.body.classList.remove('wod-modal-open');
        var trigger = els.lastTrigger;
        els.lastTrigger = null;
        if (trigger && document.contains(trigger)) { try { trigger.focus(); } catch (e) { /* noop */ } }
    }

    function headHtml(title) {
        return '<header class="wod-modal-head"><p class="wod-modal-cap">' + esc(title) + '</p>' +
            '<button type="button" class="wod-modal-x" data-close aria-label="Cerrar">' + icon('x') + '</button></header>';
    }

    /* ---------------------------- ver detalle ---------------------------- */
    function attachmentsHtml(r) {
        if (!r.attachments.length) return '<p class="wod-view-empty">Sin archivos adjuntos.</p>';
        return '<ul class="wod-view-files">' + r.attachments.map(function (a, i) {
            return '<li><button type="button" class="wod-file-link" data-file="' + i + '">' + icon('paperclip') +
                '<span>' + esc(a.name) + '</span></button></li>';
        }).join('') + '</ul>';
    }

    function openView(id, trigger) {
        var r = findById(id);
        if (!r) { toast('No encontramos ese recordatorio.', 'error'); return; }
        els.lastTrigger = trigger || els.lastTrigger;
        state.viewing = r;
        var html = headHtml('RECORDATORIO') +
            '<div class="wod-modal-body wod-view">' +
                '<div class="wod-view-top">' +
                    '<span class="wod-view-ic">' + icon(r.icon) + '</span>' +
                    '<div class="wod-view-heading"><h2 class="wod-view-title' + (r.completed_at ? ' is-done' : '') + '">' + esc(r.title) + '</h2>' +
                    '<p class="wod-view-date">' + esc(model().formatLongDate(r.due_date)) + '</p></div>' +
                '</div>' +
                '<div class="wod-view-tags">' +
                    (r.completed_at ? '<span class="wod-tag is-done">HECHO</span>' : '<span class="wod-tag is-' + esc(r.priority) + '">' + PRIORITY_LABEL[r.priority] + '</span>') +
                    (r.is_important ? '<span class="wod-tag is-important">IMPORTANTE</span>' : '<span class="wod-tag is-plain">NO IMPORTANTE</span>') +
                '</div>' +
                '<p class="wod-label wod-view-cap">DETALLE</p>' +
                '<div class="wod-view-detail">' + (r.detail ? esc(r.detail).replace(/\n/g, '<br>') : '<span class="wod-view-empty">Sin detalle.</span>') + '</div>' +
                '<p class="wod-label wod-view-cap">ARCHIVOS ADJUNTOS · ' + r.attachments.length + '</p>' +
                attachmentsHtml(r) +
                '<footer class="wod-modal-foot">' +
                    '<button type="button" class="wod-btn is-ghost wod-foot-left" data-toggle-done>' + (r.completed_at ? 'REABRIR' : 'MARCAR HECHO') + '</button>' +
                    '<button type="button" class="wod-btn is-danger" data-delete>ELIMINAR</button>' +
                    '<button type="button" class="wod-btn is-ink" data-edit>EDITAR</button>' +
                '</footer>' +
            '</div>';
        var modal = openModal(html, 'Recordatorio: ' + r.title);
        modal.classList.add('wod-modal--view');
        modal.querySelector('[data-close]').addEventListener('click', closeModal);
        modal.querySelector('[data-edit]').addEventListener('click', function () { openForm(r); });
        modal.querySelector('[data-toggle-done]').addEventListener('click', function (e) { toggleDone(r, e.currentTarget); });
        var del = modal.querySelector('[data-delete]');
        del.addEventListener('click', function () {
            if (del.getAttribute('data-confirm') !== '1') {
                del.setAttribute('data-confirm', '1');
                del.textContent = 'CONFIRMAR ELIMINAR';
                setTimeout(function () {
                    if (document.contains(del)) { del.removeAttribute('data-confirm'); del.textContent = 'ELIMINAR'; }
                }, 4000);
                return;
            }
            removeReminder(r, del);
        });
        modal.querySelectorAll('[data-file]').forEach(function (btn) {
            btn.addEventListener('click', function () { openAttachment(r.attachments[Number(btn.getAttribute('data-file'))]); });
        });
    }

    async function openAttachment(file) {
        if (!file) return;
        try {
            var url = await repo().signedUrl(file.path);
            window.open(url, '_blank', 'noopener');
        } catch (e) { toast(e.message || 'No pudimos abrir el archivo.', 'error'); }
    }

    async function toggleDone(r, btn) {
        if (state.busy) return;
        state.busy = true;
        btn.disabled = true;
        try {
            await repo().setCompleted(state.user.id, r.id, !r.completed_at);
            toast(r.completed_at ? 'Recordatorio reabierto.' : 'Recordatorio marcado como hecho.');
            closeModal();
            await load();
        } catch (e) {
            toast(e.message || 'No pudimos actualizar el recordatorio.', 'error');
            btn.disabled = false;
        } finally { state.busy = false; }
    }

    async function removeReminder(r, btn) {
        if (state.busy) return;
        state.busy = true;
        btn.disabled = true;
        try {
            await repo().remove(state.user.id, r.id, r.attachments);
            toast('Recordatorio eliminado.');
            closeModal();
            await load();
        } catch (e) {
            toast(e.message || 'No pudimos eliminar el recordatorio.', 'error');
            btn.disabled = false;
        } finally { state.busy = false; }
    }

    /* --------------------------- nuevo / editar --------------------------- */
    function segHtml(name, options, current) {
        return '<div class="wod-seg wod-seg--' + options.length + '" role="radiogroup" data-seg="' + name + '">' +
            options.map(function (o) {
                var on = String(o[0]) === String(current);
                return '<button type="button" role="radio" aria-checked="' + on + '" class="wod-seg-btn' + (on ? ' is-on' : '') +
                    '" data-value="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
            }).join('') + '</div>';
    }

    function filesHtml(files) {
        if (!files.length) return '';
        return '<ul class="wod-form-files">' + files.map(function (f, i) {
            return '<li><span class="wod-form-file">' + icon('paperclip') + '<span>' + esc(f.name) + '</span>' +
                (f.pending ? '<em>PENDIENTE</em>' : '') + '</span>' +
                '<button type="button" class="wod-form-file-x" data-remove-file="' + i + '" aria-label="Quitar ' + esc(f.name) + '">' + icon('x') + '</button></li>';
        }).join('') + '</ul>';
    }

    function openForm(existing, opts) {
        opts = opts || {};
        var r = existing || null;
        var today = model().isoDateLocal(new Date());
        state.form = {
            id: r ? r.id : null,
            icon: r ? r.icon : 'bell',
            priority: r ? r.priority : 'normal',
            is_important: r ? r.is_important : true,
            files: r ? r.attachments.map(function (a) { return Object.assign({}, a); }) : [],
            removedPaths: [],
            pendingFiles: []
        };
        var title = r ? 'EDITAR RECORDATORIO' : 'NUEVO RECORDATORIO';
        var html = headHtml(title) +
            '<form class="wod-modal-body wod-form" novalidate>' +
                '<p class="wod-label" id="wod-f-title-l">ICONO + TÍTULO</p>' +
                '<div class="wod-form-titlerow">' +
                    '<button type="button" class="wod-icon-pick" aria-haspopup="true" aria-expanded="false" aria-label="Elegir ícono">' +
                        '<span class="wod-icon-pick-ic">' + icon(state.form.icon) + '</span>' + icon('chevron-down', 'wod-icon-pick-chev') +
                    '</button>' +
                    '<input class="wod-input" name="title" maxlength="140" required aria-labelledby="wod-f-title-l" placeholder="Título del recordatorio" value="' + esc(r ? r.title : '') + '" data-autofocus>' +
                    '<div class="wod-icon-grid" role="listbox" aria-label="Íconos" hidden>' +
                        model().ICONS.map(function (name) {
                            var on = name === state.form.icon;
                            return '<button type="button" role="option" aria-selected="' + on + '" class="wod-icon-opt' + (on ? ' is-on' : '') + '" data-icon="' + name + '" aria-label="' + name + '">' + icon(name) + '</button>';
                        }).join('') +
                    '</div>' +
                '</div>' +
                '<label class="wod-label" for="wod-f-date">FECHA</label>' +
                '<input class="wod-input" type="date" id="wod-f-date" name="due_date" value="' + esc(r ? (r.due_date || '') : today) + '">' +
                '<label class="wod-label" for="wod-f-detail">DETALLE</label>' +
                '<textarea class="wod-input wod-textarea" id="wod-f-detail" name="detail" maxlength="2000" rows="4" placeholder="Información adicional del recordatorio…">' + esc(r ? r.detail : '') + '</textarea>' +
                '<p class="wod-label">ARCHIVOS ADJUNTOS</p>' +
                '<label class="wod-attach">+ ADJUNTAR ARCHIVOS<input type="file" name="files" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" hidden></label>' +
                '<div class="wod-form-files-wrap">' + filesHtml(state.form.files) + '</div>' +
                '<p class="wod-label">PRIORIDAD</p>' +
                segHtml('priority', [['urgente', 'URGENTE'], ['alta', 'ALTA'], ['normal', 'NORMAL'], ['baja', 'BAJA']], state.form.priority) +
                '<p class="wod-label">IMPORTANCIA</p>' +
                segHtml('importance', [['1', 'IMPORTANTE'], ['0', 'NO IMPORTANTE']], state.form.is_important ? '1' : '0') +
                '<p class="wod-form-error" role="alert" hidden></p>' +
                '<footer class="wod-modal-foot">' +
                    '<button type="button" class="wod-btn is-ghost" data-cancel>CANCELAR</button>' +
                    '<button type="submit" class="wod-btn is-accent">' + (r ? 'GUARDAR CAMBIOS' : 'GUARDAR RECORDATORIO') + '</button>' +
                '</footer>' +
            '</form>';
        var modal = openModal(html, r ? 'Editar recordatorio' : 'Nuevo recordatorio');
        modal.classList.add('wod-modal--form');
        wireForm(modal, r);
        if (opts.iconsOpen) togglePicker(true);
    }

    function togglePicker(open) {
        if (!els.picker) return;
        els.picker.hidden = !open;
        if (els.pickerBtn) els.pickerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
            var on = els.picker.querySelector('.is-on') || els.picker.querySelector('button');
            if (on) setTimeout(function () { try { on.focus(); } catch (e) { /* noop */ } }, 10);
        }
    }

    function wireForm(modal, existing) {
        var form = modal.querySelector('form');
        els.picker = modal.querySelector('.wod-icon-grid');
        els.pickerBtn = modal.querySelector('.wod-icon-pick');
        modal.querySelector('[data-close]').addEventListener('click', closeModal);
        modal.querySelector('[data-cancel]').addEventListener('click', function () {
            if (existing) openView(existing.id); else closeModal();
        });
        els.pickerBtn.addEventListener('click', function () { togglePicker(els.picker.hidden); });
        els.picker.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-icon]');
            if (!btn) return;
            state.form.icon = btn.getAttribute('data-icon');
            els.picker.querySelectorAll('[data-icon]').forEach(function (b) {
                var on = b === btn;
                b.classList.toggle('is-on', on);
                b.setAttribute('aria-selected', on ? 'true' : 'false');
            });
            var slot = modal.querySelector('.wod-icon-pick-ic');
            slot.innerHTML = icon(state.form.icon);
            hydrate(slot);
            togglePicker(false);
            els.pickerBtn.focus();
        });
        modal.addEventListener('mousedown', function (e) {
            if (!els.picker || els.picker.hidden) return;
            if (!els.picker.contains(e.target) && !els.pickerBtn.contains(e.target)) togglePicker(false);
        });
        modal.querySelectorAll('[data-seg]').forEach(function (group) {
            group.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-value]');
                if (!btn) return;
                group.querySelectorAll('[data-value]').forEach(function (b) {
                    var on = b === btn;
                    b.classList.toggle('is-on', on);
                    b.setAttribute('aria-checked', on ? 'true' : 'false');
                });
                var key = group.getAttribute('data-seg');
                if (key === 'priority') state.form.priority = btn.getAttribute('data-value');
                else state.form.is_important = btn.getAttribute('data-value') === '1';
            });
        });
        var fileInput = form.querySelector('input[type="file"]');
        fileInput.addEventListener('change', function () {
            var chosen = Array.prototype.slice.call(fileInput.files || []);
            fileInput.value = '';
            var M = model();
            var errors = [];
            chosen.forEach(function (file) {
                if (state.form.files.length >= M.MAX_ATTACHMENTS) { errors.push('Hasta ' + M.MAX_ATTACHMENTS + ' archivos por recordatorio.'); return; }
                try { M.validateFile(file); } catch (err) { errors.push(err.message); return; }
                state.form.files.push({ name: file.name, size: file.size, mime: file.type, pending: true, file: file });
            });
            renderFiles(modal);
            if (errors.length) showFormError(modal, errors[0]);
        });
        modal.querySelector('.wod-form-files-wrap').addEventListener('click', function (e) {
            var btn = e.target.closest('[data-remove-file]');
            if (!btn) return;
            var removed = state.form.files.splice(Number(btn.getAttribute('data-remove-file')), 1)[0];
            if (removed && removed.path && !removed.pending) state.form.removedPaths.push(removed.path);
            renderFiles(modal);
        });
        form.addEventListener('submit', function (e) { e.preventDefault(); submitForm(modal, existing); });
    }

    function renderFiles(modal) {
        var wrap = modal.querySelector('.wod-form-files-wrap');
        wrap.innerHTML = filesHtml(state.form.files);
        hydrate(wrap);
    }

    function showFormError(modal, message) {
        var box = modal.querySelector('.wod-form-error');
        if (!box) return;
        box.textContent = message || '';
        box.hidden = !message;
    }

    async function submitForm(modal, existing) {
        if (state.busy) return;
        var form = modal.querySelector('form');
        var submit = form.querySelector('button[type="submit"]');
        var input = {
            title: form.elements.title.value,
            detail: form.elements.detail.value,
            due_date: form.elements.due_date.value || null,
            icon: state.form.icon,
            priority: state.form.priority,
            is_important: state.form.is_important
        };
        try { model().toRow(input, false); } catch (err) {
            showFormError(modal, err.message);
            if (/título/i.test(err.message)) form.elements.title.focus();
            return;
        }
        showFormError(modal, '');
        state.busy = true;
        submit.disabled = true;
        var original = submit.textContent;
        submit.textContent = 'GUARDANDO…';
        try {
            var R = repo();
            var uploaded = [];
            var pending = state.form.files.filter(function (f) { return f.pending; });
            for (var i = 0; i < pending.length; i++) {
                uploaded.push(await R.uploadAttachment(state.user.id, pending[i].file));
            }
            input.attachments = state.form.files.filter(function (f) { return !f.pending; }).concat(uploaded);
            if (existing) {
                await R.update(state.user.id, existing.id, input);
                if (state.form.removedPaths.length) R.removeFiles(state.form.removedPaths).catch(function () { /* best effort */ });
            } else {
                await R.create(state.user.id, input);
            }
            toast(existing ? 'Cambios guardados.' : 'Recordatorio guardado.');
            closeModal();
            await load();
        } catch (err) {
            showFormError(modal, err.message || 'No pudimos guardar el recordatorio.');
            submit.disabled = false;
            submit.textContent = original;
        } finally { state.busy = false; }
    }

    /* ============================== arranque ============================== */
    function wireRail() {
        var add = $('wod-reminder-new');
        if (add && !add._wod) {
            add._wod = true;
            add.addEventListener('click', function () {
                if (!state.user) { toast('Tu sesión todavía se está cargando. Probá en un momento.'); return; }
                els.lastTrigger = add;
                openForm(null);
            });
        }
        var ul = $('wod-reminder-list');
        if (ul && !ul._wod) {
            ul._wod = true;
            ul.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-rem-id]');
                if (!btn) return;
                els.lastTrigger = btn;
                openView(btn.getAttribute('data-rem-id'), btn);
            });
        }
    }

    function applyUrlState() {
        var params = new URLSearchParams(window.location.search);
        var modal = params.get('modal');
        if (!modal) return;
        var id = params.get('id');
        var target = id ? findById(id) : (state.list.find(function (r) { return !r.completed_at; }) || state.list[0]);
        if (modal === 'nuevo-recordatorio') openForm(null);
        else if (modal === 'recordatorio' && target) openView(target.id);
        else if (modal === 'editar-recordatorio' && target) openForm(target, { iconsOpen: params.get('iconos') === '1' });
    }

    async function boot(user) {
        if (state.user || !user) return;
        state.user = user;
        wireRail();
        if (!repo()) {
            state.loaded = true;
            var ul = $('wod-reminder-list');
            if (ul) ul.innerHTML = '<li class="wod-rem-empty">Los recordatorios no están disponibles en este momento.</li>';
            return;
        }
        await load();
        applyUrlState();
    }

    window.WodReminders = {
        reload: load,
        list: function () { return state.list.slice(); },
        openNew: function () { openForm(null); },
        openView: openView
    };

    window.addEventListener('wo:dashboard-ready', function (ev) {
        var d = (ev && ev.detail) || {};
        boot(d.currentUser);
    });
    var tries = 0;
    var poll = setInterval(function () {
        if (state.user) { clearInterval(poll); return; }
        if (window.currentUser) { clearInterval(poll); boot(window.currentUser); }
        else if (++tries > 80) clearInterval(poll);
    }, 250);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireRail);
    else wireRail();
})();
