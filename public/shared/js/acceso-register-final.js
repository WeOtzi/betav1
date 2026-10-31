/**
 * WE OTZI - Registro de artistas · Figma final (oct 2026) · área "acceso"
 * ----------------------------------------------------------------------
 * Complementa register.js (que sigue siendo el dueño del acordeón, el borrador
 * y el envío) con lo que el Figma final agrega al wizard /register-artist:
 *
 *   03 · Tu oficio      → panel "Todos los estilos" (2001:3897): búsqueda,
 *                         categorías con estilos y subestilos, contador,
 *                         "Limpiar selección", Cancelar / Aplicar N estilos.
 *   04 · Tu presencia   → Portfolio (801:1091 / 801:1092 / 801:1093): elegir
 *                         origen, conectar Instagram (importador IG existente) o
 *                         subir archivos, grilla "Tus trabajos" con quitar/agregar.
 *   08 · Perfil creado  → "Ir a tu panel" pasa por el loader post-auth v3.
 *   Extras persistidos  → artists_db.profile_links + newsletter_topics vía
 *                         WeotziData.Registration (migración nueva, no aplicada).
 *
 * QA del preview (solo con window.WEOTZI_PREVIEW o modo demo):
 *   ?step=1..8 abre ese grupo (7 = revisión, 8 = perfil creado) y
 *   &state= abre subestados: estilos (03), instagram | cargado (04),
 *   estudio (05), todas (06), aceptado (07), nuevo (02 con contraseñas).
 *
 * La lógica pura (taxonomía, validación de archivos, plan de pasos) se exporta
 * para tests en Node: tests/figma-final-acceso.test.js.
 */
(function (root) {
    'use strict';

    // =====================================================================
    // Núcleo puro
    // =====================================================================

    // Categorías del panel "Todos los estilos" (Figma 2001:3897). `main` son
    // los estilos principales; `subs` los subestilos con sangría.
    const STYLE_TAXONOMY = [
        { title: 'Realismo', main: ['Realismo'], subs: ['Retrato', 'Animales', 'Microrealismo', 'Hiperrealismo', 'Paisajes', 'Black & Grey'] },
        { title: 'Tradicional y Neo-Tradicional', main: ['Tradicional', 'Neo-Tradicional'], subs: ['Old School', 'American Traditional', 'New School'] },
        { title: 'Japonés', main: ['Japonés'], subs: ['Irezumi', 'Neo-Japanese'] },
        { title: 'Blackwork y Ornamental', main: ['Blackwork', 'Dotwork'], subs: ['Ornamental Blackwork', 'Ornamental', 'Mandala', 'Dark Art', 'Pointillism', 'Geométrico'] },
        { title: 'Fine Line y Minimalismo', main: ['Fine Line', 'Minimalista'], subs: ['Linework', 'Fineline botánico'] },
        { title: 'Anime e ilustrativo', main: ['Anime'], subs: ['Ilustración botánica', 'Floral', 'Sketch / Boceto', 'Etching / Grabado', 'Woodcut / Xilografía', 'Surrealista'] },
        { title: 'Tribal y cultural', main: ['Tribal'], subs: ['Polinesio', 'Maorí', 'Haida', 'Celta', 'Nórdico / Viking'] },
        { title: 'Lettering', main: ['Lettering'], subs: ['Blackletter / Gótico', 'Caligrafía'] },
        { title: 'Técnicas manuales', main: ['Freehand', 'Handpoke / Stick and Poke'], subs: [] },
        { title: 'Experimental y contemporáneo', main: ['Acuarela', 'Trash Polka', 'Abstracto'], subs: ['Cybersigilismo', 'Ignorant', 'Abstract Brush', 'Glitch', 'Pixel Art', 'Graffiti', 'Pop Art', 'Patchwork'] },
        { title: 'Histórico y decorativo', main: ['Art Nouveau', 'Art Deco'], subs: ['Barroco', 'Religious / Sacro'] },
        { title: 'Orgánico y oscuro', main: ['Biomecánico', 'Horror'], subs: ['Bioorgánico'] }
    ];

    const MAX_PORTFOLIO_FILE_BYTES = 10 * 1024 * 1024;
    const PORTFOLIO_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

    function normalizeKey(name) {
        return String(name == null ? '' : name).trim().toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[\s\-_/·.]+/g, ' ')
            .trim();
    }

    // Arma los grupos del panel cruzando la taxonomía con el catálogo real
    // (tattoo_styles). Cada chip guarda `value` = nombre a persistir: el del
    // catálogo si existe (styles_array coincide con la tabla) o la etiqueta.
    // Los estilos del catálogo que no están en la taxonomía van a "Otros estilos".
    function buildStyleGroups(dbStyles, taxonomy) {
        const catalog = new Map();
        (Array.isArray(dbStyles) ? dbStyles : []).forEach((style) => {
            const name = style && (style.name || style.display_name);
            if (!name) return;
            const key = normalizeKey(name);
            if (!catalog.has(key)) catalog.set(key, { name: String(name), sort: Number(style.sort_order) || 0 });
        });
        const used = new Set();
        const toChip = (label) => {
            const key = normalizeKey(label);
            used.add(key);
            const hit = catalog.get(key);
            return { key, label, value: hit ? hit.name : label, inCatalog: Boolean(hit) };
        };
        const groups = (taxonomy || STYLE_TAXONOMY).map((group) => ({
            title: group.title,
            main: group.main.map(toChip),
            subs: group.subs.map(toChip)
        }));
        const leftovers = Array.from(catalog.entries())
            .filter(([key]) => !used.has(key))
            .sort((a, b) => a[1].sort - b[1].sort || a[1].name.localeCompare(b[1].name, 'es'))
            .map(([key, entry]) => ({ key, label: entry.name, value: entry.name, inCatalog: true }));
        if (leftovers.length) groups.push({ title: 'Otros estilos', main: leftovers, subs: [] });
        return groups;
    }

    // Filtro de búsqueda: deja solo los chips cuyo nombre contiene la consulta.
    function filterStyleGroups(groups, query) {
        const q = normalizeKey(query);
        if (!q) return groups;
        return groups
            .map((group) => ({
                title: group.title,
                main: group.main.filter((chip) => normalizeKey(chip.label).includes(q)),
                subs: group.subs.filter((chip) => normalizeKey(chip.label).includes(q))
            }))
            .filter((group) => group.main.length || group.subs.length);
    }

    function pluralize(count, singular, plural) {
        return `${count} ${count === 1 ? singular : plural}`;
    }

    // Archivos del portfolio: JPG/PNG/WebP hasta 10 MB (lo mismo que dice la
    // card "Subir manualmente" y el accept del input). La galería pública solo
    // publica imágenes, así que un PDF (el Figma lo menciona; decisión de
    // diseño pendiente) se rechaza con un mensaje que nombra los formatos válidos.
    const PORTFOLIO_FORMATS_LABEL = 'JPG, PNG o WebP';
    function validatePortfolioFile(file) {
        const type = String(file && file.type || '').toLowerCase();
        const size = Number(file && file.size) || 0;
        if (type === 'application/pdf') {
            return { ok: false, reason: 'pdf', message: `Por ahora la galería publica imágenes: subí tus trabajos en ${PORTFOLIO_FORMATS_LABEL}.` };
        }
        if (!PORTFOLIO_IMAGE_TYPES.includes(type)) {
            return { ok: false, reason: 'type', message: `Formato no admitido. Usá ${PORTFOLIO_FORMATS_LABEL}.` };
        }
        if (size > MAX_PORTFOLIO_FILE_BYTES) {
            return { ok: false, reason: 'size', message: 'Cada archivo puede pesar hasta 10 MB.' };
        }
        return { ok: true };
    }

    // ?step= del preview → grupo o pantalla del acordeón.
    const PREVIEW_STEPS = {
        1: { group: 'quien' },
        2: { group: 'acceso' },
        3: { group: 'oficio' },
        4: { group: 'presencia' },
        5: { group: 'trabajo' },
        6: { group: 'novedades' },
        7: { screen: 'summary' },
        8: { screen: 'success' }
    };
    function previewStepPlan(step) {
        const n = Number.parseInt(String(step || ''), 10);
        return PREVIEW_STEPS[n] || null;
    }

    function normalizeInstagramHandle(value) {
        return String(value == null ? '' : value).trim()
            .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
            .replace(/^@+/, '')
            .replace(/[/?#].*$/, '')
            .slice(0, 30);
    }

    const core = {
        STYLE_TAXONOMY,
        MAX_PORTFOLIO_FILE_BYTES,
        normalizeKey,
        buildStyleGroups,
        filterStyleGroups,
        validatePortfolioFile,
        previewStepPlan,
        normalizeInstagramHandle,
        pluralize
    };

    if (typeof module === 'object' && module.exports) {
        module.exports = core;
    }
    if (!root || !root.document) return;

    // =====================================================================
    // DOM
    // =====================================================================
    const document = root.document;
    const $ = (id) => document.getElementById(id);

    function hasRegister() {
        return typeof formState !== 'undefined' && formState && formState.data;
    }

    function isPreviewContext() {
        if (root.WEOTZI_PREVIEW === true) return true;
        try { return root.sessionStorage.getItem('wo_demo_mode') === '1'; } catch (_) { return false; }
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function hydrateIcons(node) {
        if (root.WoIcons && typeof root.WoIcons.hydrate === 'function') root.WoIcons.hydrate(node || document);
    }

    function persist() {
        if (typeof persistRegistrationDraft === 'function') persistRegistrationDraft();
    }

    // ---------------------------------------------------------------------
    // 03 · Chips de estilos (10 visibles, elegidos primero)
    // ---------------------------------------------------------------------
    function catalogRoots() {
        const list = (typeof _loadedDbStyles !== 'undefined' && Array.isArray(_loadedDbStyles)) ? _loadedDbStyles : [];
        return list.filter((s) => s && !s.parent_id)
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
            .map((s) => s.name);
    }

    function renderStyleChips() {
        const grid = $('styles-grid');
        if (!grid || !hasRegister()) return;
        const moreBtn = $('styles-more-btn');
        const selected = (formState.data.styles || []).slice();
        const selectedKeys = new Set(selected.map(normalizeKey));
        const ordered = selected.concat(catalogRoots().filter((name) => !selectedKeys.has(normalizeKey(name))));
        const visible = typeof STYLES_VISIBLE_COUNT === 'number' ? STYLES_VISIBLE_COUNT : 10;

        grid.innerHTML = '';
        ordered.forEach((name, idx) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'style-option' + (idx >= visible ? ' is-extra' : '') + (selectedKeys.has(normalizeKey(name)) ? ' selected' : '');
            btn.dataset.style = name;
            btn.textContent = name;
            btn.addEventListener('click', () => {
                if (typeof toggleStyleOption === 'function') toggleStyleOption(btn);
            });
            grid.appendChild(btn);
        });
        if (moreBtn) {
            moreBtn.hidden = false;
            grid.appendChild(moreBtn);
        }
        if (typeof refreshGroupGate === 'function') refreshGroupGate();
    }

    // El panel reemplaza al "ver más" expandible: el botón siempre está visible.
    function keepMoreStylesVisible() {
        const moreBtn = $('styles-more-btn');
        if (moreBtn) moreBtn.hidden = false;
    }

    // ---------------------------------------------------------------------
    // 03 · Panel "Todos los estilos" (2001:3897)
    // ---------------------------------------------------------------------
    const panelState = { open: false, selection: [], query: '', groups: [], lastFocus: null };

    function selectionKeys() {
        return new Set(panelState.selection.map(normalizeKey));
    }

    function ensureStylesPanel() {
        let overlay = $('ra-styles-overlay');
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'ra-styles-overlay';
        overlay.className = 'ra-styles-overlay';
        overlay.hidden = true;
        overlay.innerHTML = `
            <div class="ra-styles-panel" role="dialog" aria-modal="true" aria-labelledby="ra-styles-title">
                <header class="ra-styles-head">
                    <div class="ra-styles-head-row">
                        <div>
                            <h3 class="ra-styles-title" id="ra-styles-title">Todos los estilos</h3>
                            <p class="ra-styles-sub">Seleccioná todos los estilos que representen tu trabajo.</p>
                        </div>
                        <button type="button" class="ra-styles-close" data-styles-close aria-label="Cerrar">×</button>
                    </div>
                    <div class="ra-styles-tools">
                        <label class="ra-styles-search">
                            <i data-wo-icon="search" aria-hidden="true"></i>
                            <span class="wo-sr-only">Buscar un estilo</span>
                            <input type="search" id="ra-styles-query" placeholder="Buscar un estilo…" autocomplete="off">
                        </label>
                        <p class="ra-styles-count"><span class="ra-styles-count-box" aria-hidden="true"></span><span id="ra-styles-count-text">0 estilos seleccionados</span></p>
                        <button type="button" class="ra-styles-clear" id="ra-styles-clear">Limpiar selección</button>
                    </div>
                </header>
                <div class="ra-styles-body" id="ra-styles-body"></div>
                <footer class="ra-styles-foot">
                    <p class="ra-styles-foot-hint">Cancelar descarta los cambios de este panel</p>
                    <div class="ra-styles-foot-actions">
                        <button type="button" class="ra-styles-cancel" data-styles-close>Cancelar</button>
                        <button type="button" class="ra-styles-apply" id="ra-styles-apply">Aplicar 0 estilos</button>
                    </div>
                </footer>
            </div>`;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay || event.target.closest('[data-styles-close]')) {
                closeStylesPanel();
                return;
            }
            const chip = event.target.closest('[data-style-value]');
            if (chip) {
                toggleWorkingStyle(chip.getAttribute('data-style-value'));
                return;
            }
            const add = event.target.closest('[data-style-add]');
            if (add) {
                toggleWorkingStyle(add.getAttribute('data-style-add'));
                $('ra-styles-query').value = '';
                panelState.query = '';
                renderStylesBody();
            }
        });
        overlay.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') { event.preventDefault(); closeStylesPanel(); }
            if (event.key === 'Tab') trapFocus(event, overlay);
        });
        $('ra-styles-query').addEventListener('input', (event) => {
            panelState.query = event.target.value;
            renderStylesBody();
        });
        $('ra-styles-clear').addEventListener('click', () => {
            panelState.selection = [];
            renderStylesBody();
        });
        $('ra-styles-apply').addEventListener('click', applyStylesPanel);
        hydrateIcons(overlay);
        return overlay;
    }

    function trapFocus(event, container) {
        const focusables = Array.from(container.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])'))
            .filter((el) => !el.disabled && el.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    function toggleWorkingStyle(value) {
        const key = normalizeKey(value);
        if (!key) return;
        const idx = panelState.selection.findIndex((v) => normalizeKey(v) === key);
        if (idx >= 0) panelState.selection.splice(idx, 1);
        else panelState.selection.push(value);
        renderStylesBody();
    }

    function chipHtml(chip, keys, kind) {
        const on = keys.has(chip.key);
        return `<button type="button" class="ra-styles-chip ra-styles-chip--${kind}${on ? ' is-selected' : ''}" data-style-value="${escapeHtml(chip.value)}" aria-pressed="${on}">${escapeHtml(chip.label)}${on ? '<i data-wo-icon="check" aria-hidden="true"></i>' : ''}</button>`;
    }

    function renderStylesBody() {
        const body = $('ra-styles-body');
        if (!body) return;
        const keys = selectionKeys();
        const groups = filterStyleGroups(panelState.groups, panelState.query);
        let html = groups.map((group) => `
            <section class="ra-styles-group">
                <p class="ra-styles-group-title">${escapeHtml(group.title)}</p>
                ${group.main.length ? `<div class="ra-styles-main">${group.main.map((c) => chipHtml(c, keys, 'main')).join('')}</div>` : ''}
                ${group.subs.length ? `<div class="ra-styles-subs">${group.subs.map((c) => chipHtml(c, keys, 'sub')).join('')}</div>` : ''}
            </section>`).join('');
        const query = String(panelState.query || '').trim();
        if (query && !groups.some((g) => g.main.concat(g.subs).some((c) => normalizeKey(c.label) === normalizeKey(query)))) {
            const label = query.charAt(0).toUpperCase() + query.slice(1);
            html += `<section class="ra-styles-group ra-styles-group--add"><p class="ra-styles-group-title">${groups.length ? '¿No está tu estilo?' : 'Sin resultados'}</p><button type="button" class="ra-styles-chip ra-styles-chip--main" data-style-add="${escapeHtml(label)}">Agregar «${escapeHtml(label)}»</button></section>`;
        }
        body.innerHTML = html;
        hydrateIcons(body);
        const count = panelState.selection.length;
        $('ra-styles-count-text').textContent = pluralize(count, 'estilo seleccionado', 'estilos seleccionados');
        const apply = $('ra-styles-apply');
        apply.textContent = 'Aplicar ' + pluralize(count, 'estilo', 'estilos');
    }

    function openStylesPanel() {
        if (!hasRegister()) return;
        const overlay = ensureStylesPanel();
        const dbStyles = (typeof _loadedDbStyles !== 'undefined' && Array.isArray(_loadedDbStyles)) ? _loadedDbStyles : [];
        panelState.groups = buildStyleGroups(dbStyles, STYLE_TAXONOMY);
        panelState.selection = (formState.data.styles || []).slice();
        panelState.query = '';
        panelState.lastFocus = document.activeElement;
        $('ra-styles-query').value = '';
        renderStylesBody();
        overlay.hidden = false;
        document.body.classList.add('ra-styles-open');
        panelState.open = true;
        const moreBtn = $('styles-more-btn');
        if (moreBtn) moreBtn.setAttribute('aria-expanded', 'true');
        setTimeout(() => { try { $('ra-styles-query').focus({ preventScroll: true }); } catch (_) { /* foco opcional */ } }, 30);
    }

    function closeStylesPanel() {
        const overlay = $('ra-styles-overlay');
        if (!overlay) return;
        overlay.hidden = true;
        document.body.classList.remove('ra-styles-open');
        panelState.open = false;
        const moreBtn = $('styles-more-btn');
        if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false');
        if (panelState.lastFocus && typeof panelState.lastFocus.focus === 'function') panelState.lastFocus.focus();
    }

    // Los estilos que no están en tattoo_styles se registran en el catálogo
    // (mismo endpoint que "+ Otro"); si falla, igual quedan en styles_array.
    function ensureCustomStyles(values) {
        const known = new Set(panelState.groups.flatMap((g) => g.main.concat(g.subs)).filter((c) => c.inCatalog).map((c) => c.key));
        values.filter((v) => !known.has(normalizeKey(v))).forEach((name) => {
            if (typeof apiUrl !== 'function') return;
            fetch(apiUrl('/api/tattoo-styles/ensure'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            }).catch(() => { /* best effort */ });
        });
    }

    function applyStylesPanel() {
        if (!hasRegister()) return;
        formState.data.styles = panelState.selection.slice();
        ensureCustomStyles(formState.data.styles);
        persist();
        renderStyleChips();
        closeStylesPanel();
    }

    // ---------------------------------------------------------------------
    // 04 · Portfolio
    // ---------------------------------------------------------------------
    const portfolioUi = { mode: 'choices' }; // choices | instagram

    function portfolioDraft() {
        if (typeof getPortfolioMediaDraft === 'function') return getPortfolioMediaDraft();
        if (!hasRegister()) return [];
        if (!Array.isArray(formState.data.portfolio_media_draft)) formState.data.portfolio_media_draft = [];
        return formState.data.portfolio_media_draft;
    }

    function setPortfolioError(message) {
        const box = $('ra-portfolio-error');
        if (!box) return;
        box.textContent = message || '';
        box.hidden = !message;
    }

    function mediaThumbUrl(item) {
        if (item.source === 'local' || item.preview_url) return item.preview_url || '';
        const raw = item.thumbnail_url || item.cdn_url || '';
        if (!raw) return '';
        return (typeof apiUrl === 'function' ? apiUrl('/api/instagram/proxy-thumb') : '/api/instagram/proxy-thumb') + '?url=' + encodeURIComponent(raw);
    }

    function mediaCaption(item) {
        if (item.name) return item.name;
        if (item.file && item.file.name) return item.file.name;
        if (item.source === 'ig') return item.caption ? String(item.caption).slice(0, 40) : 'Instagram';
        return 'Archivo';
    }

    function renderPortfolio() {
        const section = $('ra-portfolio');
        if (!section) return;
        const draft = portfolioDraft();
        const hasItems = draft.length > 0;
        const choices = $('ra-portfolio-choices');
        const connect = $('ra-ig-connect');
        const works = $('ra-works');
        section.classList.toggle('has-works', hasItems);
        if (choices) choices.hidden = hasItems || portfolioUi.mode === 'instagram';
        if (connect) connect.hidden = portfolioUi.mode !== 'instagram';
        if (works) works.hidden = !hasItems || portfolioUi.mode === 'instagram';

        const grid = $('ra-works-grid');
        const count = $('ra-works-count');
        if (count) count.textContent = pluralize(draft.length, 'archivo', 'archivos');
        if (!grid) return;
        grid.innerHTML = '';
        draft.forEach((item) => {
            const cell = document.createElement('div');
            cell.className = 'ra-work';
            cell.setAttribute('role', 'listitem');
            const media = document.createElement('div');
            media.className = 'ra-work-media';
            const url = mediaThumbUrl(item);
            if (item.kind === 'video' && item.source === 'local') {
                const video = document.createElement('video');
                video.src = url; video.muted = true; video.playsInline = true; video.preload = 'metadata';
                media.appendChild(video);
            } else if (url) {
                const img = document.createElement('img');
                img.src = url; img.alt = mediaCaption(item); img.loading = 'lazy';
                img.addEventListener('error', () => { img.remove(); media.classList.add('is-broken'); });
                media.appendChild(img);
            } else {
                media.classList.add('is-broken');
            }
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'ra-work-remove';
            remove.setAttribute('aria-label', 'Quitar ' + mediaCaption(item));
            remove.innerHTML = '<i data-wo-icon="x" aria-hidden="true"></i>';
            remove.addEventListener('click', () => {
                if (typeof removePortfolioMediaItem === 'function') removePortfolioMediaItem(item.id);
                else {
                    const list = portfolioDraft();
                    const at = list.findIndex((it) => it.id === item.id);
                    if (at >= 0) list.splice(at, 1);
                }
                renderPortfolio();
            });
            media.appendChild(remove);
            const caption = document.createElement('p');
            caption.className = 'ra-work-name';
            caption.textContent = mediaCaption(item);
            cell.appendChild(media);
            cell.appendChild(caption);
            grid.appendChild(cell);
        });
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'ra-work-add';
        add.innerHTML = '<i data-wo-icon="plus" aria-hidden="true"></i><span>Agregar</span>';
        add.addEventListener('click', openFilePicker);
        grid.appendChild(add);
        hydrateIcons(grid);
    }

    function openFilePicker() {
        setPortfolioError('');
        const input = $('ra-works-file');
        if (input) input.click();
    }

    function handleFiles(fileList) {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        const draft = portfolioDraft();
        const rejected = [];
        files.forEach((file) => {
            const check = validatePortfolioFile(file);
            if (!check.ok) { rejected.push(check.message); return; }
            draft.push({
                id: 'local-' + Math.random().toString(36).slice(2),
                source: 'local',
                file,
                name: file.name,
                preview_url: URL.createObjectURL(file),
                kind: 'image',
                category: 'realizados'
            });
        });
        setPortfolioError(rejected.length ? Array.from(new Set(rejected)).join(' ') : '');
        portfolioUi.mode = 'choices';
        if (typeof renderPortfolioMediaGrid === 'function') renderPortfolioMediaGrid();
        renderPortfolio();
    }

    function openInstagramConnect() {
        setPortfolioError('');
        portfolioUi.mode = 'instagram';
        const input = $('ra-ig-connect-handle');
        if (input && !input.value && hasRegister()) {
            const handle = formState.data.instagram_handle || ($('instagram_handle') ? $('instagram_handle').value : '');
            input.value = handle ? '@' + normalizeInstagramHandle(handle) : '';
        }
        setConnectStatus('');
        renderPortfolio();
        if (input) setTimeout(() => { try { input.focus(); } catch (_) { /* opcional */ } }, 20);
    }

    function setConnectStatus(message, tone) {
        const status = $('ra-ig-connect-status');
        if (!status) return;
        status.textContent = message || '';
        status.hidden = !message;
        status.dataset.tone = tone || 'info';
    }

    // CONECTAR: usa el importador de Instagram existente (Apify, solo contenido
    // público). Al terminar, los medios elegidos llegan al borrador del registro.
    function connectInstagram() {
        const input = $('ra-ig-connect-handle');
        const handle = normalizeInstagramHandle(input ? input.value : '');
        if (!handle || !/^[a-z0-9._]{1,30}$/i.test(handle)) {
            setConnectStatus('Escribí tu usuario de Instagram (por ejemplo, @tu_estudio).', 'error');
            if (input) input.focus();
            return;
        }
        if (hasRegister()) {
            formState.data.instagram_handle = handle;
            const igField = $('instagram_handle');
            if (igField && !igField.value) igField.value = handle;
            persist();
        }
        if (!root.IGImport || typeof root.IGImport.open !== 'function') {
            setConnectStatus('El importador de Instagram no está disponible en este momento. Probá subir tus archivos.', 'error');
            return;
        }
        setConnectStatus('Abrimos el importador para @' + handle + '. Seguí los pasos en la ventana de Instagram.', 'info');
        root.IGImport.open({
            target: 'artist',
            mode: 'signup',
            prefillHandle: handle,
            onComplete: (result) => {
                if (typeof applyIGPrefillFromResult === 'function') applyIGPrefillFromResult(result, { overwriteArtisticName: false });
                if (typeof seedPortfolioMediaFromIG === 'function') seedPortfolioMediaFromIG();
                if (typeof renderPortfolioMediaGrid === 'function') renderPortfolioMediaGrid();
                persist();
                portfolioUi.mode = 'choices';
                setConnectStatus('');
                renderPortfolio();
            }
        });
    }

    function cancelInstagramConnect() {
        portfolioUi.mode = 'choices';
        setConnectStatus('');
        renderPortfolio();
    }

    function clearPortfolio() {
        const list = portfolioDraft().slice();
        list.forEach((item) => {
            if (typeof removePortfolioMediaItem === 'function') removePortfolioMediaItem(item.id);
        });
        if (typeof removePortfolioMediaItem !== 'function') portfolioDraft().length = 0;
        renderPortfolio();
    }

    function wirePortfolio() {
        const section = $('ra-portfolio');
        if (!section || section.dataset.wired === 'true') return;
        section.dataset.wired = 'true';
        section.addEventListener('click', (event) => {
            const choice = event.target.closest('[data-portfolio-choice]');
            if (!choice) return;
            if (choice.dataset.portfolioChoice === 'instagram') openInstagramConnect();
            else openFilePicker();
        });
        const file = $('ra-works-file');
        if (file) file.addEventListener('change', (event) => { handleFiles(event.target.files); event.target.value = ''; });
        const go = $('ra-ig-connect-go');
        if (go) go.addEventListener('click', connectInstagram);
        const cancel = $('ra-ig-connect-cancel');
        if (cancel) cancel.addEventListener('click', cancelInstagramConnect);
        const handleInput = $('ra-ig-connect-handle');
        if (handleInput) handleInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); connectInstagram(); }
        });
        const clear = $('ra-works-clear');
        if (clear) clear.addEventListener('click', clearPortfolio);

        // register.js re-dibuja su grilla legada en cada cambio del borrador:
        // la grilla del Figma se sincroniza detrás.
        if (typeof renderPortfolioMediaGrid === 'function' && !renderPortfolioMediaGrid.__accesoWrapped) {
            const original = renderPortfolioMediaGrid;
            const wrapped = function () {
                const out = original.apply(this, arguments);
                try { renderPortfolio(); } catch (_) { /* no bloquear el flujo legado */ }
                return out;
            };
            wrapped.__accesoWrapped = true;
            root.renderPortfolioMediaGrid = wrapped;
        }
    }

    // ---------------------------------------------------------------------
    // Extras persistidos (enlaces separados + temas de novedades)
    // ---------------------------------------------------------------------
    function extrasPayload() {
        if (!hasRegister()) return {};
        if (typeof saveLinkFields === 'function') saveLinkFields();
        return {
            website_url: formState.data.website_url,
            behance_url: formState.data.behance_url,
            other_url: formState.data.other_url,
            newsletter_topics: formState.data.newsletter_topics
        };
    }

    // Se guarda justo antes del evento "registro completado": en ambos flujos
    // la fila existe y hay sesión del artista nuevo.
    function wireExtrasPersistence() {
        if (typeof sendArtistRegistrationCompletedEvent !== 'function' || sendArtistRegistrationCompletedEvent.__accesoWrapped) return;
        const original = sendArtistRegistrationCompletedEvent;
        const wrapped = function (payload) {
            const userId = (payload && payload.user_id) || (typeof currentUser !== 'undefined' && currentUser && currentUser.id);
            const repo = root.WeotziData && root.WeotziData.Registration;
            if (repo && userId) {
                repo.saveProfileExtras(userId, extrasPayload()).then((res) => {
                    if (res && !res.ok) console.warn('[registro] extras sin guardar (¿migración pendiente?):', res.error || res);
                });
            }
            return original.apply(this, arguments);
        };
        wrapped.__accesoWrapped = true;
        root.sendArtistRegistrationCompletedEvent = wrapped;
    }

    function prefillExtras(record) {
        if (!hasRegister() || !record) return;
        const links = record.profile_links && typeof record.profile_links === 'object' ? record.profile_links : null;
        if (links) {
            const map = { website: 'portfolio_url', behance: 'behance_url', other: 'other_url' };
            Object.keys(map).forEach((key) => {
                const input = $(map[key]);
                if (input && links[key] && !input.value) input.value = links[key];
            });
            if (typeof saveLinkFields === 'function') saveLinkFields();
        }
        if (Array.isArray(record.newsletter_topics) && record.newsletter_topics.length) {
            formState.data.newsletter_topics = record.newsletter_topics.slice();
            document.querySelectorAll('.newsletter-topic-input').forEach((box) => {
                box.checked = record.newsletter_topics.includes(box.dataset.topic);
            });
        }
    }

    // ---------------------------------------------------------------------
    // 08 · Perfil creado → loader v3
    // ---------------------------------------------------------------------
    function wireSuccessCta() {
        const cta = $('ra-success-cta');
        if (!cta || cta.dataset.loaderWired === 'true') return;
        cta.dataset.loaderWired = 'true';
        cta.addEventListener('click', (event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
            event.preventDefault();
            const url = cta.getAttribute('href') || '/artist/dashboard';
            if (typeof root.redirectAfterRegistration === 'function') root.redirectAfterRegistration(url);
            else root.location.href = url;
        });
    }

    // ---------------------------------------------------------------------
    // QA del preview: ?step=&state=
    // ---------------------------------------------------------------------
    function seedPreviewPortfolio() {
        const base = String(root.WEOTZI_BASE_PATH || '').replace(/\/$/, '');
        const draft = portfolioDraft();
        if (draft.length) return;
        ['ref-01.svg', 'ref-02.svg', 'ref-03.svg'].forEach((file, i) => {
            draft.push({
                id: 'preview-' + i,
                source: 'local',
                file: null,
                name: ['Logos ideas.png', 'WhatsApp image 2026-06-17.jpeg', 'Mesa de trabajo 1-01.png'][i],
                preview_url: base + '/shared/assets/demo/' + file,
                kind: 'image',
                category: 'realizados'
            });
        });
    }

    function applyPreviewState() {
        if (!isPreviewContext() || !hasRegister()) return;
        let params;
        try { params = new URLSearchParams(root.location.search); } catch (_) { return; }
        const plan = previewStepPlan(params.get('step'));
        if (!plan) return;
        const state = String(params.get('state') || '');

        if (plan.group === 'acceso' && state === 'nuevo') {
            formState.preAuthMode = true;
            if (typeof updatePreAuthFieldsVisibility === 'function') updatePreAuthFieldsVisibility();
        }
        if (plan.group === 'novedades' && state === 'todas') {
            document.querySelectorAll('.newsletter-topic-input').forEach((box) => { box.checked = true; });
            if (typeof commitNewsletterSelection === 'function') commitNewsletterSelection();
        }
        if (plan.group === 'presencia' && state === 'cargado') seedPreviewPortfolio();
        if (plan.screen === 'summary' || plan.screen === 'success') {
            document.querySelectorAll('.newsletter-topic-input').forEach((box) => { box.checked = true; });
            if (typeof commitNewsletterSelection === 'function') commitNewsletterSelection();
        }

        if (plan.group && typeof goToStep === 'function' && typeof groupEntryStep === 'function') {
            goToStep(groupEntryStep(plan.group));
        } else if (plan.screen === 'summary' && typeof goToStep === 'function') {
            goToStep('summary');
            if (state === 'aceptado') {
                const terms = $('terms-checkbox');
                if (terms) { terms.checked = true; formState.data.terms_accepted = true; }
                if (typeof refreshGroupGate === 'function') refreshGroupGate();
            }
        } else if (plan.screen === 'success' && typeof goToStep === 'function') {
            if (typeof renderSuccessScreen === 'function') renderSuccessScreen('/artist/dashboard');
            goToStep('summary'); // marca los 6 grupos como completos en la nav
            goToStep('success');
        }

        if (plan.group === 'oficio' && state === 'estilos') setTimeout(openStylesPanel, 60);
        if (plan.group === 'presencia' && state === 'instagram') openInstagramConnect();
        if (plan.group === 'trabajo' && state === 'estudio') {
            const studioBtn = document.querySelector('.work-type-option[data-type="studio"]');
            if (studioBtn && typeof selectWorkTypeOption === 'function') selectWorkTypeOption(studioBtn);
            const studioInput = $('studio_name');
            if (studioInput) {
                studioInput.value = 'c';
                studioInput.dispatchEvent(new Event('input', { bubbles: true }));
                studioInput.focus();
            }
        }
        renderPortfolio();
        root.scrollTo(0, 0);
        // La captura reproduce el frame sin foco automático en el primer campo
        // (salvo los estados que abren un panel o una búsqueda).
        if (state !== 'estilos' && state !== 'estudio') {
            setTimeout(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }, 400);
        }
    }

    // ---------------------------------------------------------------------
    // Arranque (register.js llama afterInit al terminar initializeAuth)
    // ---------------------------------------------------------------------
    // 02 · Tu acceso: la regla de fuerza y el aviso de coincidencia aparecen al
    // escribir (el frame 801:1087 muestra los tres campos limpios).
    function wirePasswordFeedback() {
        const pairs = [['signup_password', 'password-strength'], ['signup_password_confirm', 'password-match-hint']];
        pairs.forEach(([inputId, hintId]) => {
            const input = $(inputId);
            const hint = $(hintId);
            if (!input || !hint || input.dataset.accesoIdle === 'true') return;
            input.dataset.accesoIdle = 'true';
            const sync = () => { hint.dataset.idle = input.value ? 'false' : 'true'; };
            input.addEventListener('input', sync);
            sync();
        });
    }

    function afterInit(ctx) {
        root.syncStylesMoreButton = keepMoreStylesVisible;
        wirePasswordFeedback();
        renderStyleChips();
        wirePortfolio();
        wireExtrasPersistence();
        wireSuccessCta();
        prefillExtras(ctx && ctx.loadedArtistRecord);
        renderPortfolio();
        applyPreviewState();
    }

    root.AccesoRegister = {
        core,
        afterInit,
        openStylesPanel,
        closeStylesPanel,
        renderStyleChips,
        renderPortfolio
    };
})(typeof window !== 'undefined' ? window : null);
