// Selectores del registro de estudios (revisión Estudios v1, paso 2):
//   - yearPicker: año de fundación como calendario de años (grilla de 12 por
//     página, navegación por década, teclado completo).
//   - languagePicker: idiomas como selección múltiple con chips, filtro y
//     "agregar otro".
// Los dos guardan el valor en un <input type="hidden"> (el wizard sigue
// leyendo/guardando ese campo) y pueden montarse más de una vez sobre el mismo
// input (el preview editable del paso 5): todas las instancias se sincronizan.
// Exportable a Node para tests (module.exports) y a window.WeOtziStudioPickers.
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (root) root.WeOtziStudioPickers = api;
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    const LANGUAGES = ['Español', 'Inglés', 'Portugués', 'Francés', 'Italiano', 'Alemán', 'Catalán', 'Guaraní',
        'Neerlandés', 'Ruso', 'Japonés', 'Chino', 'Coreano', 'Árabe', 'Hebreo', 'Lengua de señas'];
    const MAX_LANGUAGES = 10;
    const PAGE = 12;
    const instances = new Map(); // input -> Set(instance)

    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fold = value => String(value == null ? '' : value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

    // ---------------- helpers puros (tests) ----------------
    function parseLanguages(raw) {
        const seen = new Set();
        const out = [];
        String(raw == null ? '' : raw).split(',').forEach(part => {
            const text = part.replace(/\s+/g, ' ').trim().slice(0, 40);
            if (!text || seen.has(fold(text))) return;
            seen.add(fold(text));
            const known = LANGUAGES.find(lang => fold(lang) === fold(text));
            out.push(known || text.charAt(0).toUpperCase() + text.slice(1));
        });
        return out.slice(0, MAX_LANGUAGES);
    }
    function serializeLanguages(list) { return parseLanguages((list || []).join(',')).join(', '); }
    // Primer año de la página que contiene `year`. Las páginas se alinean al año
    // máximo (el actual): la primera muestra los últimos 12 años elegibles.
    function pageStart(year, min, max) {
        const back = Math.floor((max - Math.min(max, Math.max(min, year))) / PAGE);
        return max - PAGE + 1 - back * PAGE;
    }
    function yearPage(start, { min, max, selected }) {
        return Array.from({ length: PAGE }, (_, i) => {
            const year = start + i;
            return { year, disabled: year < min || year > max, selected: year === selected };
        });
    }

    function register(input, instance) {
        if (!instances.has(input)) instances.set(input, new Set());
        instances.get(input).add(instance);
    }
    function broadcast(input, except) {
        (instances.get(input) || []).forEach(instance => { if (instance !== except) instance.refresh(); });
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    let uid = 0;
    function onOutside(box, close) {
        const handler = event => { if (!box.contains(event.target)) close(); };
        document.addEventListener('pointerdown', handler, true);
        return () => document.removeEventListener('pointerdown', handler, true);
    }

    // ---------------- año de fundación ----------------
    function yearPicker(input, host, opts = {}) {
        const id = 'yp' + (++uid);
        const min = opts.min || 1900;
        const max = opts.max || new Date().getFullYear();
        const placeholder = opts.placeholder || 'Elegí el año';
        const triggerId = opts.triggerId || id + '-trigger';
        let start = pageStart(Number(input.value) || max, min, max);
        let focusYear = null;
        let unbind = null;

        host.classList.add('sr-picker');
        host.innerHTML = '<button type="button" class="wo-input sr-picker-trigger" id="' + esc(triggerId) + '" aria-haspopup="dialog" aria-expanded="false" aria-controls="' + id + '-pop"' +
            (opts.labelledBy ? ' aria-labelledby="' + esc(opts.labelledBy) + ' ' + esc(triggerId) + '"' : '') + '>' +
            '<span data-value></span><span class="sr-picker-icon" aria-hidden="true">' + calendarIcon() + '</span></button>' +
            '<div class="sr-picker-pop sr-year-pop" id="' + id + '-pop" role="dialog" aria-modal="false" aria-label="' + esc(opts.dialogLabel || 'Elegí el año de fundación') + '" hidden>' +
            '<div class="sr-year-head"><button type="button" class="sr-year-nav" data-prev aria-label="Años anteriores">‹</button>' +
            '<strong data-range aria-live="polite"></strong>' +
            '<button type="button" class="sr-year-nav" data-next aria-label="Años siguientes">›</button></div>' +
            '<div class="sr-year-grid" data-grid></div>' +
            '<div class="sr-year-foot"><button type="button" class="sr-link-btn" data-clear>Borrar</button>' +
            '<button type="button" class="sr-link-btn" data-current>Este año</button></div></div>';
        const trigger = host.querySelector('.sr-picker-trigger');
        const pop = host.querySelector('.sr-picker-pop');
        const grid = host.querySelector('[data-grid]');

        function selected() { const n = Number(input.value); return Number.isInteger(n) && n >= min && n <= max ? n : null; }
        function refresh() {
            const year = selected();
            const label = host.querySelector('[data-value]');
            label.textContent = year ? String(year) : placeholder;
            trigger.classList.toggle('is-empty', !year);
            if (!pop.hidden) renderGrid();
        }
        function renderGrid() {
            const cells = yearPage(start, { min, max, selected: selected() });
            host.querySelector('[data-range]').textContent = start + ' – ' + (start + PAGE - 1);
            host.querySelector('[data-prev]').disabled = start <= min;
            host.querySelector('[data-next]').disabled = start + PAGE - 1 >= max;
            const target = focusYear && cells.some(c => c.year === focusYear && !c.disabled) ? focusYear
                : (cells.find(c => c.selected) || cells.filter(c => !c.disabled).pop() || {}).year;
            grid.innerHTML = cells.map(c => '<button type="button" class="sr-year' + (c.selected ? ' is-selected' : '') + '" data-year="' + c.year + '"' +
                (c.disabled ? ' disabled' : '') + ' aria-pressed="' + (c.selected ? 'true' : 'false') + '" tabindex="' + (c.year === target ? '0' : '-1') + '">' + c.year + '</button>').join('');
        }
        function setValue(year) {
            input.value = year ? String(year) : '';
            refresh();
            broadcast(input, api);
        }
        function open() {
            start = pageStart(selected() || max, min, max);
            focusYear = selected() || max;
            pop.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
            renderGrid();
            (grid.querySelector('[tabindex="0"]') || grid.querySelector('button:not([disabled])'))?.focus();
            unbind = onOutside(host, () => close(false));
        }
        function close(returnFocus = true) {
            if (pop.hidden) return;
            pop.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
            if (unbind) { unbind(); unbind = null; }
            if (returnFocus) trigger.focus();
        }
        function move(delta) {
            const current = Number(document.activeElement?.dataset?.year) || focusYear || max;
            let next = Math.min(max, Math.max(min, current + delta));
            focusYear = next;
            if (next < start || next >= start + PAGE) start = pageStart(next, min, max);
            renderGrid();
            grid.querySelector('[data-year="' + next + '"]')?.focus();
        }

        trigger.addEventListener('click', () => (pop.hidden ? open() : close()));
        trigger.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); open(); } });
        host.querySelector('[data-prev]').addEventListener('click', () => { if (start > min) start -= PAGE; focusYear = null; renderGrid(); });
        host.querySelector('[data-next]').addEventListener('click', () => { if (start + PAGE - 1 < max) start += PAGE; focusYear = null; renderGrid(); });
        host.querySelector('[data-clear]').addEventListener('click', () => { setValue(null); close(); });
        host.querySelector('[data-current]').addEventListener('click', () => { setValue(max); close(); });
        grid.addEventListener('click', event => {
            const button = event.target.closest('[data-year]');
            if (!button || button.disabled) return;
            setValue(Number(button.dataset.year));
            close();
        });
        pop.addEventListener('keydown', event => {
            const keys = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4, PageUp: -PAGE, PageDown: PAGE };
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
            if (event.key in keys && event.target.closest('[data-grid]')) { event.preventDefault(); move(keys[event.key]); return; }
            if (event.key === 'Tab') {
                const focusables = Array.from(pop.querySelectorAll('button:not([disabled])')).filter(el => el.tabIndex !== -1);
                if (!focusables.length) return;
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        });

        const api = { refresh, open, close, focus: () => trigger.focus(), trigger };
        register(input, api);
        refresh();
        return api;
    }

    // ---------------- idiomas ----------------
    function languagePicker(input, host, opts = {}) {
        const id = 'lp' + (++uid);
        const options = opts.languages || LANGUAGES;
        let active = -1;
        let unbind = null;
        host.classList.add('sr-picker', 'sr-multi');
        // Campo arriba y chips abajo: el campo queda alineado con los de la misma fila.
        host.innerHTML = '<div class="sr-multi-field"><input type="text" class="wo-input sr-multi-input" id="' + esc(opts.inputId || id + '-input') + '" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="' + id + '-list" autocomplete="off" maxlength="40" placeholder="' + esc(opts.placeholder || 'Buscá o escribí un idioma') + '"' +
            (opts.labelledBy ? ' aria-labelledby="' + esc(opts.labelledBy) + '"' : '') + '>' +
            '<ul class="sr-picker-pop sr-multi-list" id="' + id + '-list" role="listbox" aria-multiselectable="true" aria-label="Idiomas" hidden></ul></div>' +
            '<ul class="sr-chips" data-chips aria-label="Idiomas elegidos"></ul>';
        const field = host.querySelector('.sr-multi-input');
        const list = host.querySelector('[role="listbox"]');
        const chips = host.querySelector('[data-chips]');

        function values() { return parseLanguages(input.value); }
        function save(next) {
            input.value = serializeLanguages(next);
            refresh();
            broadcast(input, api);
        }
        function toggle(lang) {
            const current = values();
            const exists = current.some(v => fold(v) === fold(lang));
            if (!exists && current.length >= MAX_LANGUAGES) return;
            save(exists ? current.filter(v => fold(v) !== fold(lang)) : current.concat(lang));
        }
        function filtered() {
            const q = fold(field.value);
            const current = values();
            const known = options.filter(lang => !q || fold(lang).includes(q));
            const custom = current.filter(v => !options.some(o => fold(o) === fold(v)) && (!q || fold(v).includes(q)));
            const rows = known.concat(custom).map(lang => ({ lang, selected: current.some(v => fold(v) === fold(lang)) }));
            const text = field.value.replace(/\s+/g, ' ').trim();
            if (text.length >= 2 && !rows.some(r => fold(r.lang) === fold(text))) rows.push({ lang: text, selected: false, add: true });
            return rows;
        }
        function renderList() {
            const rows = filtered();
            if (active >= rows.length) active = rows.length - 1;
            list.innerHTML = rows.length ? rows.map((r, i) => '<li role="option" id="' + id + '-opt-' + i + '" class="sr-multi-option' + (i === active ? ' is-active' : '') + '" data-lang="' + esc(r.lang) + '" aria-selected="' + (r.selected ? 'true' : 'false') + '">' +
                '<span class="sr-check" aria-hidden="true"></span>' + (r.add ? 'Agregar «' + esc(r.lang) + '»' : esc(r.lang)) + '</li>').join('')
                : '<li class="sr-multi-empty" role="presentation">Sin coincidencias</li>';
            field.setAttribute('aria-activedescendant', active >= 0 && rows.length ? id + '-opt-' + active : '');
        }
        function refresh() {
            const current = values();
            chips.innerHTML = current.map(lang => '<li class="sr-chip">' + esc(lang) + '<button type="button" data-remove="' + esc(lang) + '" aria-label="Quitar ' + esc(lang) + '">×</button></li>').join('');
            chips.hidden = !current.length;
            field.placeholder = current.length >= MAX_LANGUAGES ? 'Máximo ' + MAX_LANGUAGES + ' idiomas' : (opts.placeholder || 'Buscá o escribí un idioma');
            if (!list.hidden) renderList();
        }
        function open() {
            if (!list.hidden) return;
            list.hidden = false;
            field.setAttribute('aria-expanded', 'true');
            active = -1;
            renderList();
            unbind = onOutside(host, close);
        }
        function close() {
            if (list.hidden) return;
            list.hidden = true;
            field.setAttribute('aria-expanded', 'false');
            field.removeAttribute('aria-activedescendant');
            if (unbind) { unbind(); unbind = null; }
        }

        field.addEventListener('focus', open);
        field.addEventListener('click', open);
        field.addEventListener('input', () => { open(); active = field.value.trim() ? 0 : -1; renderList(); });
        field.addEventListener('keydown', event => {
            const rows = filtered();
            if (event.key === 'ArrowDown') { event.preventDefault(); open(); active = Math.min(rows.length - 1, active + 1); renderList(); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); active = Math.max(0, active - 1); renderList(); }
            else if (event.key === 'Enter') {
                event.preventDefault();
                const row = rows[active >= 0 ? active : 0];
                if (row) { toggle(row.lang); field.value = ''; active = -1; renderList(); }
            } else if (event.key === 'Escape') { if (!list.hidden) { event.preventDefault(); event.stopPropagation(); close(); } }
            else if (event.key === 'Backspace' && !field.value) { const current = values(); if (current.length) save(current.slice(0, -1)); }
            else if (event.key === 'Tab') close();
        });
        list.addEventListener('mousedown', event => event.preventDefault()); // el foco queda en el campo
        list.addEventListener('click', event => {
            const option = event.target.closest('[data-lang]');
            if (!option) return;
            toggle(option.dataset.lang);
            field.value = '';
            renderList();
            field.focus();
        });
        chips.addEventListener('click', event => {
            const button = event.target.closest('[data-remove]');
            if (!button) return;
            save(values().filter(v => fold(v) !== fold(button.dataset.remove)));
            field.focus();
        });

        const api = { refresh, open, close, focus: () => field.focus(), field };
        register(input, api);
        refresh();
        return api;
    }

    function calendarIcon() {
        return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="0"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';
    }

    // Vuelve a leer el input oculto en todas las instancias (p. ej. al restaurar el borrador).
    function refreshAll(input) { (instances.get(input) || []).forEach(instance => instance.refresh()); }

    return { yearPicker, languagePicker, refreshAll, parseLanguages, serializeLanguages, pageStart, yearPage, LANGUAGES, MAX_LANGUAGES };
});
