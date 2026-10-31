/**
 * WE OTZI - Notas de trabajo del expediente (panel lateral de 620px)
 * -------------------------------------------------------------------
 * Figma final (w3JA83CcP5ISKjyOu87mx1) · 801:578 "Brief y preparación",
 * 801:579 "Nueva nota" y plantillas 801:1111–1115.
 *
 * Editor por bloques (texto, título, lista, checklist, cita, separador,
 * imagen) con etiquetas, plantillas, autoguardado y exportación. Persiste en
 * quotation_notes (WeotziData.Notes + WeotziData.QuotationDetail.createNote);
 * el contenido usa bloques compatibles con EditorJS (QuotationDetailModel).
 *
 * API: window.WorkNotesDrawer.open({ quote, user, noteId, isNew, template,
 *      confirm, toast, icons }) · window.WorkNotesDrawer.close()
 */
(function () {
    'use strict';

    const M = window.QuotationDetailModel;
    const D = () => window.WeotziData || {};
    const ADD_TYPES = ['text', 'title', 'list', 'checklist', 'quote', 'separator', 'image'];
    const PLACEHOLDER = {
        text: 'Escribí acá...', title: 'Título', list: 'Elemento de la lista', checklist: 'Tarea',
        quote: 'Cita del cliente', image: 'Pegá la URL de la imagen',
    };

    const st = { opts: null, el: null, notes: [], current: null, timer: null, saving: false, failed: false, pending: null };

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function icon(name, size) {
        const icons = st.opts && st.opts.icons;
        return icons ? icons.icon(name, size) : '';
    }
    function toast(message, opts) {
        if (st.opts && typeof st.opts.toast === 'function') st.opts.toast(message, opts || {});
    }
    function $(selector) { return st.el ? st.el.querySelector(selector) : null; }

    /* ------------------------------------ DOM ------------------------------------ */
    function ensureDom() {
        if (st.el) return;
        const el = document.createElement('div');
        el.className = 'wn-overlay';
        el.hidden = true;
        el.innerHTML = `
            <aside class="wn-panel" role="dialog" aria-modal="true" aria-labelledby="wn-title" tabindex="-1">
                <header class="wn-head">
                    <div class="wn-head-copy">
                        <p class="wn-eyebrow">Notas de trabajo · solo vos</p>
                        <input class="wn-title" id="wn-title" maxlength="120" aria-label="Título de la nota" autocomplete="off">
                        <p class="wn-meta" id="wn-meta" aria-live="polite"></p>
                    </div>
                    <button class="wn-close" type="button" data-wn-close aria-label="Cerrar notas"></button>
                </header>
                <div class="wn-templates" role="group" aria-label="Plantillas">
                    <span class="wn-section-label">Plantillas</span>
                    ${M.NOTE_TEMPLATES.map((t) => `<button class="wn-chip" type="button" data-template="${esc(t.key)}">${esc(t.label)}</button>`).join('')}
                </div>
                <div class="wn-body">
                    <div class="wn-blocks" id="wn-blocks"></div>
                    <div class="wn-section wn-add">
                        <span class="wn-section-label">Agregar bloque</span>
                        ${ADD_TYPES.map((type) => `<button class="wn-add-btn" type="button" data-add-block="${type}">+ ${esc(M.BLOCK_LABELS[type])}</button>`).join('')}
                    </div>
                    <div class="wn-section wn-tags">
                        <span class="wn-section-label">Etiquetas</span>
                        <div class="wn-tag-list" id="wn-tag-list"></div>
                    </div>
                    <div class="wn-section wn-history">
                        <span class="wn-section-label">Notas anteriores</span>
                        <div id="wn-history-list"></div>
                    </div>
                </div>
                <footer class="wn-foot">
                    <p>Las notas son privadas. El cliente nunca las ve.</p>
                    <button class="wn-foot-btn" type="button" data-wn-new>Nueva nota</button>
                    <button class="wn-foot-link" type="button" data-wn-export>Exportar</button>
                </footer>
            </aside>`;
        document.body.appendChild(el);
        st.el = el;
        el.querySelector('[data-wn-close]').innerHTML = icon('x', 18) || '×';
        bindEvents();
    }

    function setTop() {
        const nav = document.querySelector('weotzi-product-nav');
        const top = nav ? Math.max(0, Math.round(nav.getBoundingClientRect().bottom)) : 0;
        st.el.style.setProperty('--wn-top', `${top}px`);
    }

    /* ------------------------------------ modelo ------------------------------------ */
    function fromRow(row) {
        const blocks = M.blocksFromContent(row.content);
        let template = null;
        try { template = (typeof row.content === 'string' ? JSON.parse(row.content) : row.content || {}).template || null; } catch (_) { template = null; }
        return {
            id: row.id,
            title: row.title || 'Nota sin título',
            blocks: blocks.length ? blocks : [M.block('text')],
            tags: M.tagsFromContent(row.content),
            template,
            note_date: row.note_date || row.created_at || new Date().toISOString(),
        };
    }
    function blankNote() {
        return { id: null, title: 'Nueva nota', blocks: [M.block('text')], tags: [], template: null, note_date: new Date().toISOString() };
    }
    function sortNotes() {
        st.notes.sort((a, b) => new Date(b.note_date || b.updated_at || b.created_at || 0) - new Date(a.note_date || a.updated_at || a.created_at || 0));
    }

    async function loadNotes() {
        try {
            st.notes = (await D().Notes.listForQuote(st.opts.quote.id)) || [];
            sortNotes();
        } catch (error) {
            console.error('[work-notes] list', error);
            st.notes = [];
            toast('No pudimos cargar tus notas anteriores.', { error: true });
        }
    }

    function isEmpty(note) {
        return M.isEmptyNote(note.blocks, note.tags, note.title);
    }

    // persist=false (apertura por URL con ?plantilla=): arma la nota sin
    // guardarla; recién se inserta cuando el artista la edita. Así recargar o
    // compartir el link no duplica notas en quotation_notes.
    function applyTemplate(key, persist = true) {
        const template = M.templateByKey(key);
        if (!template || !st.current) return;
        const blocks = template.build(st.opts.quote);
        const onlyBlank = st.current.blocks.every((b) => b.type !== 'separator' && !String(b.text || '').trim() && !String(b.url || '').trim());
        st.current.blocks = onlyBlank ? blocks : st.current.blocks.concat(blocks);
        st.current.template = key;
        renderBlocks();
        if (persist) markDirty();
    }

    /* ---------------------------------- guardado ---------------------------------- */
    function markDirty() {
        st.failed = false;
        renderMeta();
        window.clearTimeout(st.timer);
        st.timer = window.setTimeout(save, 650);
    }

    async function save() {
        window.clearTimeout(st.timer);
        st.timer = null;
        const note = st.current;
        if (!note || (!note.id && isEmpty(note))) { renderMeta(); return; }
        if (st.saving) { st.pending = true; return; }
        st.saving = true;
        renderMeta();
        const now = new Date().toISOString();
        const content = M.contentFromBlocks(note.blocks, note.tags, note.template);
        const title = String(note.title || '').trim() || 'Nota sin título';
        try {
            if (note.id) {
                await D().Notes.update(note.id, { title, content, updated_at: now });
                const row = st.notes.find((n) => String(n.id) === String(note.id));
                if (row) Object.assign(row, { title, content, updated_at: now });
            } else {
                const payload = { quotation_id: st.opts.quote.id, title, label: null, content, note_date: note.note_date, created_at: now, updated_at: now };
                let row = null;
                if (D().QuotationDetail && D().QuotationDetail.createNote) row = await D().QuotationDetail.createNote(payload);
                else await D().Notes.create(payload);
                if (!row) {
                    const rows = (await D().Notes.listForQuote(st.opts.quote.id)) || [];
                    row = rows.find((r) => r.created_at === now && r.title === title) || null;
                }
                const saved = Object.assign({}, payload, row || {});
                if (row && row.id != null) note.id = row.id;
                st.notes.push(saved);
                sortNotes();
            }
            st.failed = false;
        } catch (error) {
            console.error('[work-notes] save', error);
            st.failed = true;
        } finally {
            st.saving = false;
            renderMeta();
            renderHistory();
            if (st.pending) { st.pending = null; save(); }
        }
    }

    async function flush() {
        if (st.timer) await save();
    }

    /* ----------------------------------- render ----------------------------------- */
    function renderMeta() {
        const meta = $('#wn-meta');
        if (!meta || !st.current) return;
        if (st.saving) meta.textContent = 'Guardando…';
        else if (st.failed) meta.textContent = 'No se pudo guardar · reintentá';
        else meta.textContent = `Guardado automáticamente · ${M.blocksLabel(st.current.blocks.length)}`;
        meta.classList.toggle('is-error', !!st.failed);
    }

    function blockControl(b) {
        const ph = esc(PLACEHOLDER[b.type] || '');
        switch (b.type) {
            case 'title':
                return `<input class="wn-heading" data-field="text" value="${esc(b.text)}" placeholder="${ph}" aria-label="Título del bloque" maxlength="160">`;
            case 'list':
                return `<span class="wn-bullet" aria-hidden="true"></span><input class="wn-line" data-field="text" data-line value="${esc(b.text)}" placeholder="${ph}" aria-label="Elemento de lista" maxlength="400">`;
            case 'checklist':
                return `<button class="wn-check${b.checked ? ' is-checked' : ''}" type="button" role="checkbox" aria-checked="${b.checked ? 'true' : 'false'}" aria-label="Marcar tarea" data-toggle-check>${b.checked ? icon('check', 12) : ''}</button><input class="wn-line${b.checked ? ' is-done' : ''}" data-field="text" data-line value="${esc(b.text)}" placeholder="${ph}" aria-label="Tarea" maxlength="400">`;
            case 'quote':
                return `<div class="wn-quote"><textarea class="wn-text wn-text--quote" data-field="text" rows="1" placeholder="${ph}" aria-label="Cita" maxlength="1000">${esc(b.text)}</textarea></div>`;
            case 'separator':
                return '<hr class="wn-sep">';
            case 'image':
                return `<div class="wn-image"><input class="wn-line" data-field="url" type="url" value="${esc(b.url)}" placeholder="${ph}" aria-label="URL de la imagen">${b.url ? `<img src="${esc(b.url)}" alt="${esc(b.text || 'Imagen de la nota')}" loading="lazy">` : ''}</div>`;
            default:
                return `<textarea class="wn-text" data-field="text" rows="1" placeholder="${ph}" aria-label="Texto" maxlength="4000">${esc(b.text)}</textarea>`;
        }
    }

    function renderBlocks(focusId) {
        const host = $('#wn-blocks');
        if (!host || !st.current) return;
        host.innerHTML = st.current.blocks.map((b) => `
            <div class="wn-block wn-block--${b.type}" data-block-id="${esc(b.id)}">
                <span class="wn-block-label">${esc(M.BLOCK_LABELS[b.type] || 'Texto')}</span>
                <div class="wn-block-body">${blockControl(b)}</div>
                <button class="wn-icon-btn" type="button" data-block-remove aria-label="Quitar bloque ${esc(M.BLOCK_LABELS[b.type] || '')}">${icon('trash', 15)}</button>
            </div>`).join('');
        host.querySelectorAll('textarea').forEach(autosize);
        if (focusId) {
            const target = host.querySelector(`[data-block-id="${CSS.escape(String(focusId))}"] [data-field]`);
            if (target) target.focus();
        }
        renderMeta();
    }

    function renderTags() {
        const host = $('#wn-tag-list');
        if (!host || !st.current) return;
        host.innerHTML = st.current.tags.map((tag, i) => `
            <span class="wn-tag">${esc(tag)}<button type="button" data-tag-remove="${i}" aria-label="Quitar etiqueta ${esc(tag)}">${icon('x', 11) || '×'}</button></span>`).join('')
            + '<input class="wn-tag-input" id="wn-tag-input" placeholder="+ etiqueta" aria-label="Agregar etiqueta" maxlength="24">';
    }

    function renderHistory() {
        const host = $('#wn-history-list');
        if (!host) return;
        const currentId = st.current && st.current.id != null ? String(st.current.id) : null;
        const rows = st.notes.filter((n) => String(n.id) !== currentId);
        host.innerHTML = rows.length ? rows.map((n) => `
            <div class="wn-history-row">
                <div class="wn-history-copy">
                    <strong>${esc(n.title || 'Nota sin título')}</strong>
                    <span>${esc(M.noteDateLabel(n.note_date || n.created_at))} · ${esc(M.blocksLabel(M.countBlocks(n.content)))}</span>
                </div>
                <button class="wn-open" type="button" data-note-open="${esc(n.id)}">Abrir</button>
                <button class="wn-icon-btn" type="button" data-note-delete="${esc(n.id)}" aria-label="Borrar nota ${esc(n.title || '')}">${icon('trash', 15)}</button>
            </div>`).join('') : '<p class="wn-empty">Todavía no hay otras notas para esta cotización.</p>';
    }

    function renderAll() {
        const title = $('#wn-title');
        if (title) title.value = st.current.title;
        renderBlocks();
        renderTags();
        renderHistory();
        renderMeta();
    }

    function autosize(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.max(textarea.scrollHeight, 28)}px`;
    }

    /* ----------------------------------- acciones ----------------------------------- */
    function blockOf(node) {
        const row = node.closest('[data-block-id]');
        if (!row || !st.current) return null;
        return st.current.blocks.find((b) => String(b.id) === row.dataset.blockId) || null;
    }

    function addBlock(type, afterId) {
        const fresh = M.block(type);
        const index = afterId ? st.current.blocks.findIndex((b) => String(b.id) === String(afterId)) : -1;
        if (index >= 0) st.current.blocks.splice(index + 1, 0, fresh);
        else st.current.blocks.push(fresh);
        renderBlocks(fresh.id);
        markDirty();
    }

    function removeBlock(id) {
        const blocks = st.current.blocks;
        const index = blocks.findIndex((b) => String(b.id) === String(id));
        if (index < 0) return null;
        blocks.splice(index, 1);
        if (!blocks.length) blocks.push(M.block('text'));
        const previous = blocks[Math.max(0, index - 1)];
        renderBlocks(previous && previous.id);
        markDirty();
        return previous;
    }

    function addTag(raw) {
        const tag = M.normalizeTag(raw);
        if (!tag || st.current.tags.includes(tag)) return false;
        if (st.current.tags.length >= 8) { toast('Máximo 8 etiquetas por nota.', { error: true }); return false; }
        st.current.tags.push(tag);
        renderTags();
        const input = $('#wn-tag-input');
        if (input) input.focus();
        markDirty();
        return true;
    }

    async function openNote(id) {
        await flush();
        const row = st.notes.find((n) => String(n.id) === String(id));
        if (!row) return;
        st.current = fromRow(row);
        renderAll();
        $('.wn-body').scrollTop = 0;
    }

    async function deleteNote(id) {
        const row = st.notes.find((n) => String(n.id) === String(id));
        if (!row) return;
        const ask = st.opts.confirm;
        const ok = ask
            ? await ask({ title: '¿Borrar esta nota?', message: `"${row.title || 'Nota sin título'}" se borra para siempre.`, confirmLabel: 'Borrar nota', danger: true })
            : window.confirm('¿Borrar esta nota?');
        if (!ok) return;
        try {
            await D().Notes.delete(row.id);
            st.notes = st.notes.filter((n) => String(n.id) !== String(id));
            if (st.current && String(st.current.id) === String(id)) { st.current = blankNote(); renderAll(); }
            else renderHistory();
            toast('Nota borrada.');
        } catch (error) {
            console.error('[work-notes] delete', error);
            toast('No pudimos borrar la nota.', { error: true });
        }
    }

    async function newNote() {
        await flush();
        st.current = blankNote();
        renderAll();
        const first = $('#wn-blocks [data-field]');
        if (first) first.focus();
    }

    async function exportNotes() {
        await flush();
        const quote = st.opts.quote;
        const notes = st.notes.slice();
        const current = st.current;
        if (current && !current.id && !isEmpty(current)) {
            notes.unshift({ title: current.title, note_date: current.note_date, content: M.contentFromBlocks(current.blocks, current.tags, current.template) });
        }
        if (!notes.length) { toast('Todavía no hay notas para exportar.', { error: true }); return; }
        const text = [`# Notas de trabajo · ${quote.client_full_name || 'Cliente'} · ${quote.quote_id || quote.id}`, '']
            .concat(notes.map((n) => M.noteToMarkdown(n) + '\n')).join('\n');
        const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `notas-${quote.quote_id || quote.id}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('Notas exportadas.');
    }

    /* ----------------------------------- eventos ----------------------------------- */
    function bindEvents() {
        const el = st.el;
        el.addEventListener('mousedown', (event) => { if (event.target === el) close(); });
        el.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !document.querySelector('.qd-dialog')) { event.stopPropagation(); close(); }
        });
        el.addEventListener('click', (event) => {
            const t = event.target;
            if (t.closest('[data-wn-close]')) { close(); return; }
            const tpl = t.closest('[data-template]');
            if (tpl) { applyTemplate(tpl.dataset.template); return; }
            const add = t.closest('[data-add-block]');
            if (add) { addBlock(add.dataset.addBlock); return; }
            const remove = t.closest('[data-block-remove]');
            if (remove) { const b = blockOf(remove); if (b) removeBlock(b.id); return; }
            const check = t.closest('[data-toggle-check]');
            if (check) {
                const b = blockOf(check);
                if (!b) return;
                b.checked = !b.checked;
                check.classList.toggle('is-checked', b.checked);
                check.setAttribute('aria-checked', b.checked ? 'true' : 'false');
                check.innerHTML = b.checked ? icon('check', 12) : '';
                const line = check.parentNode.querySelector('.wn-line');
                if (line) line.classList.toggle('is-done', b.checked);
                markDirty();
                return;
            }
            const tagRemove = t.closest('[data-tag-remove]');
            if (tagRemove) {
                st.current.tags.splice(Number(tagRemove.dataset.tagRemove), 1);
                renderTags();
                markDirty();
                return;
            }
            const open = t.closest('[data-note-open]');
            if (open) { openNote(open.dataset.noteOpen); return; }
            const del = t.closest('[data-note-delete]');
            if (del) { deleteNote(del.dataset.noteDelete); return; }
            if (t.closest('[data-wn-new]')) { newNote(); return; }
            if (t.closest('[data-wn-export]')) exportNotes();
        });
        el.addEventListener('input', (event) => {
            const t = event.target;
            if (t.id === 'wn-title') { st.current.title = t.value; markDirty(); return; }
            if (t.dataset && t.dataset.field) {
                const b = blockOf(t);
                if (!b) return;
                b[t.dataset.field] = t.value;
                if (t.tagName === 'TEXTAREA') autosize(t);
                markDirty();
            }
        });
        el.addEventListener('change', (event) => {
            const t = event.target;
            if (t.dataset && t.dataset.field === 'url') renderBlocks();
        });
        el.addEventListener('keydown', (event) => {
            const t = event.target;
            if (t.id === 'wn-tag-input') {
                if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault();
                    if (addTag(t.value)) t.value = '';
                } else if (event.key === 'Backspace' && !t.value && st.current.tags.length) {
                    st.current.tags.pop();
                    renderTags();
                    $('#wn-tag-input').focus();
                    markDirty();
                }
                return;
            }
            if (t.hasAttribute && t.hasAttribute('data-line')) {
                const b = blockOf(t);
                if (!b) return;
                if (event.key === 'Enter') { event.preventDefault(); addBlock(b.type, b.id); }
                else if (event.key === 'Backspace' && !t.value && st.current.blocks.length > 1) { event.preventDefault(); removeBlock(b.id); }
            }
        });
        el.addEventListener('focusout', (event) => {
            const t = event.target;
            if (t.id === 'wn-tag-input' && t.value.trim() && addTag(t.value)) {
                const input = $('#wn-tag-input');
                if (input) input.value = '';
            }
            if (t.id === 'wn-title' && !t.value.trim()) { t.value = st.current.title = 'Nueva nota'; }
        });
    }

    /* ------------------------------------ API ------------------------------------ */
    async function open(options) {
        if (!M) { console.error('[work-notes] falta quotation-detail-model.js'); return; }
        st.opts = options || {};
        if (!st.opts.quote) return;
        ensureDom();
        setTop();
        st.el.hidden = false;
        document.documentElement.classList.add('wn-lock');
        st.current = blankNote();
        renderAll();
        st.el.querySelector('.wn-panel').focus({ preventScroll: true });
        await loadNotes();
        const byId = st.opts.noteId != null ? st.notes.find((n) => String(n.id) === String(st.opts.noteId)) : null;
        if (byId) st.current = fromRow(byId);
        else if (!st.opts.isNew && st.notes.length) st.current = fromRow(st.notes[0]);
        else st.current = blankNote();
        renderAll();
        if (st.opts.template) applyTemplate(st.opts.template, false);
    }

    async function close() {
        if (!st.el || st.el.hidden) return;
        await flush();
        st.el.hidden = true;
        document.documentElement.classList.remove('wn-lock');
        const opener = document.querySelector('[data-action="open-notes"]');
        if (opener) opener.focus({ preventScroll: true });
    }

    window.WorkNotesDrawer = { open, close, flush };
    window.addEventListener('beforeunload', () => { if (st.timer) save(); });
}());
