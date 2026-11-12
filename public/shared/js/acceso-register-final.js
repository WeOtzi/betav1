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

    // Catálogo local de respaldo (public/register-artist/catalogo-registro.js).
    // La fuente principal es GET /api/registration/catalogs; ver loadCatalogs().
    function localCatalog() {
        if (root && root.WoRegistroCatalogo) return root.WoRegistroCatalogo;
        if (typeof module === 'object' && module.exports && typeof require === 'function') {
            try { return require('../../register-artist/catalogo-registro.js'); } catch (_) { /* sin respaldo */ }
        }
        return { STYLE_GROUPS: [], STYLE_ALIASES: {}, COUNTRIES: [], CURRENCIES: [] };
    }

    const MAX_PORTFOLIO_FILE_BYTES = 10 * 1024 * 1024;
    const PORTFOLIO_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    const BIO_MAX_LENGTH = 2000;
    const IG_SIGNUP_MAX_POSTS = 50;

    function normalizeKey(name) {
        return String(name == null ? '' : name).trim().toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[\s\-_/·.]+/g, ' ')
            .trim();
    }

    // Claves de búsqueda de un estilo: la etiqueta completa, sin el paréntesis
    // ("Tradicional Americano") y el contenido del paréntesis ("Old School").
    function styleKeys(label) {
        const text = String(label == null ? '' : label);
        const keys = [normalizeKey(text)];
        const base = normalizeKey(text.replace(/\s*\([^)]*\)\s*/g, ' '));
        const match = text.match(/\(([^)]*)\)/);
        const alt = match ? normalizeKey(match[1]) : '';
        [base, alt].forEach((key) => { if (key && !keys.includes(key)) keys.push(key); });
        return keys.filter(Boolean);
    }

    // Respuesta de /api/registration/catalogs → [{ id, title, styles: [nombre] }].
    // Acepta { styleGroups } o { style_groups } con `styles`, `items` o `chips`
    // como textos u objetos { name | label | value }. null si no sirve.
    function normalizeStyleGroups(raw) {
        const list = Array.isArray(raw) ? raw : null;
        if (!list) return null;
        const groups = list.map((group, idx) => {
            if (!group || typeof group !== 'object') return null;
            const title = String(group.title || group.name || group.label || '').trim();
            const items = group.styles || group.items || group.chips || [];
            const styles = (Array.isArray(items) ? items : [])
                .map((item) => (typeof item === 'string' ? item : item && (item.label || item.name || item.value)))
                .map((name) => String(name || '').trim())
                .filter(Boolean);
            if (!title || !styles.length) return null;
            return { id: String(group.id || group.key || 'grupo-' + (idx + 1)), title, styles };
        }).filter(Boolean);
        return groups.length ? groups : null;
    }

    // Monedas de /api/registration/catalogs → [{ code, name, region }]. Acepta
    // códigos sueltos o objetos { code, name | label, region }; el nombre en
    // español sale del catálogo local cuando el servidor no lo manda.
    function normalizeCurrencies(raw, fallback) {
        const local = new Map((fallback || localCatalog().CURRENCIES || []).map((c) => [c.code, c]));
        const list = Array.isArray(raw) ? raw : null;
        if (!list) return null;
        const seen = new Set();
        const out = list.map((item) => {
            const code = String(typeof item === 'string' ? item : (item && (item.code || item.currency)) || '').trim().toUpperCase();
            if (!/^[A-Z]{3}$/.test(code) || seen.has(code)) return null;
            seen.add(code);
            const known = local.get(code) || {};
            const name = (item && typeof item === 'object' && (item.name_es || item.label || item.name)) || known.name || code;
            return { code, name: String(name), region: (item && item.region) || known.region || 'Otras' };
        }).filter(Boolean);
        return out.length ? out : null;
    }

    // Respuesta completa de /api/registration/catalogs (grupo Backend):
    //   { styles: { quick: [{ label, catalog, aliases }], groups: [{ id, label,
    //     styles: [{ label, value, aliases }] }] }, countries, currencies }
    // También acepta { styleGroups } (formato del brief). Devuelve grupos,
    // monedas y un mapa de alias (clave normalizada → etiqueta del catálogo).
    function parseCatalogPayload(data) {
        const out = { styleGroups: null, currencies: null, aliases: null };
        if (!data || typeof data !== 'object') return out;
        const rawGroups = (data.styles && data.styles.groups) || data.styleGroups || data.style_groups;
        out.styleGroups = normalizeStyleGroups(rawGroups);
        out.currencies = normalizeCurrencies(data.currencies);
        const aliases = {};
        (Array.isArray(rawGroups) ? rawGroups : []).forEach((group) => {
            (group && Array.isArray(group.styles) ? group.styles : []).forEach((style) => {
                if (!style || typeof style !== 'object' || !style.label) return;
                (Array.isArray(style.aliases) ? style.aliases : []).forEach((alias) => {
                    const key = normalizeKey(alias);
                    if (key && !aliases[key]) aliases[key] = style.label;
                });
            });
        });
        const quick = data.styles && Array.isArray(data.styles.quick) ? data.styles.quick : [];
        quick.forEach((entry) => {
            const key = entry && normalizeKey(entry.label);
            const target = entry && Array.isArray(entry.catalog) ? entry.catalog[0] : '';
            if (key && target && !aliases[key]) aliases[key] = target;
        });
        out.aliases = Object.keys(aliases).length ? aliases : null;
        return out;
    }

    // Moneda sugerida para el país que llega de Crear cuenta (nombre o código ISO).
    function currencyForCountry(country, countries) {
        const key = normalizeKey(country);
        if (!key) return '';
        const hit = (countries || localCatalog().COUNTRIES || []).find((c) => normalizeKey(c.name) === key || normalizeKey(c.code) === key);
        return hit && Array.isArray(hit.currencies) && hit.currencies[0] ? hit.currencies[0] : '';
    }

    // Arma los grupos del panel cruzando el catálogo de la revisión con
    // tattoo_styles. Cada chip guarda `value` = nombre a persistir: el de
    // tattoo_styles si coincide (styles_array sigue a la tabla) o la etiqueta.
    // El catálogo es exacto: lo que está en la tabla y no en la revisión no se
    // muestra (sigue disponible con la búsqueda → "Agregar «x»" u "Otro").
    function buildStyleGroups(dbStyles, groups) {
        const catalog = new Map();
        (Array.isArray(dbStyles) ? dbStyles : []).forEach((style) => {
            const name = style && (style.name || style.display_name);
            if (!name) return;
            const key = normalizeKey(name);
            if (!catalog.has(key)) catalog.set(key, String(name));
        });
        const source = normalizeStyleGroups(groups) || localCatalog().STYLE_GROUPS || [];
        return source.map((group) => ({
            id: group.id,
            title: group.title,
            chips: group.styles.map((label) => {
                const keys = styleKeys(label);
                const hitKey = keys.find((key) => catalog.has(key));
                return { key: keys[0], keys, label, value: hitKey ? catalog.get(hitKey) : label, inCatalog: Boolean(hitKey) };
            })
        }));
    }

    function allChips(groups) {
        return (groups || []).reduce((acc, group) => acc.concat(group.chips || []), []);
    }

    // Chip del catálogo que corresponde a un nombre guardado (estilo de Crear
    // cuenta, borrador viejo o valor de tattoo_styles). null si es propio.
    function findStyleChip(value, groups, aliases) {
        const key = normalizeKey(value);
        if (!key) return null;
        const aliasMap = aliases || localCatalog().STYLE_ALIASES || {};
        const aliasKey = aliasMap[key] ? normalizeKey(aliasMap[key]) : '';
        const chips = allChips(groups);
        return chips.find((chip) => chip.key === key || normalizeKey(chip.value) === key)
            || (aliasKey && chips.find((chip) => chip.key === aliasKey))
            || chips.find((chip) => chip.keys.includes(key))
            || null;
    }

    // Lleva los estilos guardados al nombre del catálogo (sin duplicados). Los
    // que no están en el catálogo quedan como estilos propios.
    function canonicalizeStyles(values, groups, aliases) {
        const out = [];
        const seen = new Set();
        (Array.isArray(values) ? values : []).forEach((value) => {
            const raw = String(value == null ? '' : value).trim();
            if (!raw) return;
            const chip = findStyleChip(raw, groups, aliases);
            const name = chip ? chip.value : raw;
            const key = normalizeKey(name);
            if (seen.has(key)) return;
            seen.add(key);
            out.push(name);
        });
        return out;
    }

    // Filtro de búsqueda: deja solo los chips cuyo nombre contiene la consulta.
    function filterStyleGroups(groups, query) {
        const q = normalizeKey(query);
        if (!q) return groups;
        return (groups || [])
            .map((group) => Object.assign({}, group, {
                chips: (group.chips || []).filter((chip) => chip.keys.some((key) => key.includes(q)))
            }))
            .filter((group) => group.chips.length);
    }

    // Vista alfabética (sin agrupar): todos los chips, sin repetidos, A→Z.
    function alphabeticalChips(groups) {
        const seen = new Set();
        return allChips(groups)
            .filter((chip) => {
                if (seen.has(chip.key)) return false;
                seen.add(chip.key);
                return true;
            })
            .sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
    }

    // Chips visibles del grupo 03: primero los elegidos y después los estilos
    // principales del catálogo (los que pasan de `visible` quedan como extra).
    function stepStyleChips(selected, groups, visible) {
        const chosen = (Array.isArray(selected) ? selected : []).filter((v) => String(v || '').trim());
        const chosenKeys = new Set(chosen.map(normalizeKey));
        const main = (groups && groups[0] && groups[0].chips) || [];
        const items = chosen.map((value) => ({ name: value, selected: true }))
            .concat(main.filter((chip) => !chosenKeys.has(normalizeKey(chip.value))).map((chip) => ({ name: chip.value, label: chip.label, selected: false })));
        const limit = typeof visible === 'number' ? visible : 10;
        return items.map((item, idx) => Object.assign({ label: item.label || item.name, extra: idx >= Math.max(limit, chosen.length) }, item));
    }

    // ---- Fecha de nacimiento (página 3): solo mayores de 18, sin futuro ----
    function pad2(n) { return String(n).padStart(2, '0'); }
    function shiftYears(today, years) {
        const y = today.getFullYear() - years;
        const m = today.getMonth();
        const lastDay = new Date(y, m + 1, 0).getDate();
        const d = Math.min(today.getDate(), lastDay);
        return `${y}-${pad2(m + 1)}-${pad2(d)}`;
    }
    function birthDateBounds(today) {
        const now = today instanceof Date ? today : new Date();
        return { min: shiftYears(now, 100), max: shiftYears(now, 18) };
    }

    // ---- Enlaces con prefijo fijo (página 7) ----
    // El input muestra el prefijo aparte (.wo-prefixed); el valor guardado se
    // normaliza igual que antes: handle sin @, web con https:// y Behance como
    // "behance.net/usuario".
    function websiteFromInput(raw) {
        let text = String(raw == null ? '' : raw).trim();
        if (!text) return '';
        text = text.replace(/^(https?:)?\/\//i, '').replace(/^\/+/, '');
        return text ? 'https://' + text : '';
    }
    function websiteToInput(stored) {
        return String(stored == null ? '' : stored).trim().replace(/^(https?:)?\/\//i, '');
    }
    function behanceToInput(stored) {
        return String(stored == null ? '' : stored).trim()
            .replace(/^(https?:)?\/\//i, '')
            .replace(/^(www\.)?behance\.net\/?/i, '')
            .replace(/^[@/]+/, '');
    }
    function behanceFromInput(raw) {
        const user = behanceToInput(raw);
        return user ? 'behance.net/' + user : '';
    }
    function isValidWebsite(url) {
        if (!url) return true;
        try {
            const parsed = new URL(url);
            return /^https?:$/.test(parsed.protocol) && parsed.hostname.includes('.') && !/\s/.test(url);
        } catch (_) {
            return false;
        }
    }

    // ---- Reanudar el registro (pedido nuevo) ----
    // Hay avance real cuando el artista completó algo más que lo que trae
    // Crear cuenta (nombre, email, país, ciudad y estilo).
    const PROGRESS_FIELDS = ['artistic_name', 'birth_date', 'experience_years', 'session_price', 'bio',
        'instagram_handle', 'website_url', 'behance_url', 'other_url', 'portfolio_url', 'work_type', 'studio_name'];
    function hasResumableProgress(data) {
        if (!data || typeof data !== 'object') return false;
        if (PROGRESS_FIELDS.some((field) => String(data[field] == null ? '' : data[field]).trim())) return true;
        if (data.address && typeof data.address === 'object' && Object.keys(data.address).length) return true;
        if (Array.isArray(data.newsletter_topics) && data.newsletter_topics.length) return true;
        if (Array.isArray(data.portfolio_ig_items) && data.portfolio_ig_items.length) return true;
        return false;
    }

    // ---- Error al finalizar (página 10) ----
    // Traduce el error del envío a un mensaje claro que conserve el detalle
    // real (estado HTTP y texto del servidor) para poder reportarlo.
    function describeSubmitError(error) {
        const err = error || {};
        const status = Number(err.status) || 0;
        const server = String(err.serverMessage || '').trim();
        const detail = String(err.detail || '').trim();
        const raw = String(err.message || '').trim();
        if (err.code === 'PASSWORD_REQUIRED') {
            return { title: 'Falta tu contraseña', message: 'Por seguridad no guardamos tu contraseña mientras completás el registro. Escribila de nuevo en «Tu acceso» y confirmá.', retry: false };
        }
        if (err.name === 'TypeError' || /failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
            return { title: 'Sin conexión con el servidor', message: 'No pudimos comunicarnos con We Ötzi. Revisá tu conexión y volvé a intentar: tus datos siguen acá.', retry: true };
        }
        if (status === 409) {
            const text = server || raw || 'Ya existe una cuenta con esos datos.';
            return { title: 'Ese email ya tiene una cuenta', message: (/[.!?]$/.test(text) ? text : text + '.') + ' Iniciá sesión o cambiá el email en «Tu acceso». (Error 409)', retry: true };
        }
        if (status === 429) {
            return { title: 'Demasiados intentos seguidos', message: 'Esperá un minuto y volvé a intentar. Tus datos siguen acá.', retry: true };
        }
        const parts = [];
        const main = server || raw || 'No se pudo finalizar el registro.';
        parts.push(/[.!?]$/.test(main) ? main : main + '.');
        if (detail && detail !== main) parts.push('Detalle: ' + (/[.!?]$/.test(detail) ? detail : detail + '.'));
        if (status) parts.push('(Error ' + status + ')');
        return { title: 'No pudimos crear tu perfil', message: parts.join(' '), retry: true };
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
        MAX_PORTFOLIO_FILE_BYTES,
        BIO_MAX_LENGTH,
        IG_SIGNUP_MAX_POSTS,
        localCatalog,
        normalizeKey,
        styleKeys,
        normalizeStyleGroups,
        normalizeCurrencies,
        parseCatalogPayload,
        currencyForCountry,
        buildStyleGroups,
        findStyleChip,
        canonicalizeStyles,
        filterStyleGroups,
        alphabeticalChips,
        stepStyleChips,
        birthDateBounds,
        websiteFromInput,
        websiteToInput,
        behanceFromInput,
        behanceToInput,
        isValidWebsite,
        hasResumableProgress,
        describeSubmitError,
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
    // Catálogos del registro (estilos en 3 grupos + monedas · páginas 5 y 6)
    // ---------------------------------------------------------------------
    // GET /api/registration/catalogs → { styleGroups, currencies }. Si el
    // endpoint no existe o falla, se usa el catálogo local (mismo contenido).
    const catalogState = {
        styleGroups: null,
        currencies: null,
        aliases: null,
        promise: null
    };

    function currentStyleGroups() {
        return catalogState.styleGroups || localCatalog().STYLE_GROUPS || [];
    }
    function currentAliases() {
        return catalogState.aliases || localCatalog().STYLE_ALIASES || {};
    }
    function currentCurrencies() {
        return catalogState.currencies || localCatalog().CURRENCIES || [];
    }

    function loadCatalogs() {
        if (catalogState.promise) return catalogState.promise;
        const url = typeof apiUrl === 'function' ? apiUrl('/api/registration/catalogs') : '/api/registration/catalogs';
        catalogState.promise = fetch(url, { headers: { Accept: 'application/json' } })
            .then((res) => (res.ok ? res.json() : null))
            .catch(() => null)
            .then((payload) => {
                const data = payload && (payload.data || payload);
                const parsed = parseCatalogPayload(data);
                if (parsed.styleGroups) catalogState.styleGroups = parsed.styleGroups;
                if (parsed.currencies) catalogState.currencies = parsed.currencies;
                if (parsed.aliases) catalogState.aliases = Object.assign({}, localCatalog().STYLE_ALIASES || {}, parsed.aliases);
                return { remote: Boolean(parsed.styleGroups || parsed.currencies) };
            });
        return catalogState.promise;
    }

    function dbStyles() {
        return (typeof _loadedDbStyles !== 'undefined' && Array.isArray(_loadedDbStyles)) ? _loadedDbStyles : [];
    }

    function styleGroupsForUi() {
        return buildStyleGroups(dbStyles(), currentStyleGroups());
    }

    // Estilos guardados (Crear cuenta, borrador viejo) → nombre del catálogo.
    function canonicalizeSelectedStyles() {
        if (!hasRegister()) return;
        const before = (formState.data.styles || []).slice();
        const after = canonicalizeStyles(before, styleGroupsForUi(), currentAliases());
        if (after.join('\u0001') !== before.join('\u0001')) {
            formState.data.styles = after;
            persist();
        }
    }

    // ---------------------------------------------------------------------
    // 03 · Monedas: solo las de los países del listado (página 5)
    // ---------------------------------------------------------------------
    function renderCurrencyOptions() {
        const select = $('session_currency');
        if (!select) return;
        const saved = hasRegister() ? String(formState.data.session_currency || select.value || 'USD').toUpperCase() : (select.value || 'USD');
        const list = currentCurrencies().slice();
        // Un borrador viejo con una moneda fuera del listado no se pierde.
        if (saved && !list.some((c) => c.code === saved)) list.push({ code: saved, name: saved, region: 'Otras' });
        const regions = [];
        list.forEach((c) => { if (!regions.includes(c.region)) regions.push(c.region); });
        select.innerHTML = regions.map((region) => `<optgroup label="${escapeHtml(region)}">${list
            .filter((c) => c.region === region)
            .map((c) => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.name)} (${escapeHtml(c.code)})</option>`)
            .join('')}</optgroup>`).join('');
        select.value = list.some((c) => c.code === saved) ? saved : 'USD';
        if (root.WoControls && typeof root.WoControls.refresh === 'function') {
            try { root.WoControls.refresh(select); } catch (_) { /* el control nativo sigue funcionando */ }
        }
    }

    // ---------------------------------------------------------------------
    // 03 · Chips de estilos (10 visibles, elegidos primero) + "Otro"
    // ---------------------------------------------------------------------
    function ensureOtherStyleButton() {
        let btn = $('styles-other-btn');
        if (btn) return btn;
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'styles-other-btn';
        btn.className = 'ra-more-styles ra-other-style';
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-controls', 'custom-style-wrapper');
        btn.textContent = 'Otro';
        btn.addEventListener('click', () => toggleCustomStyle());
        return btn;
    }

    function toggleCustomStyle(force) {
        const wrapper = $('custom-style-wrapper');
        const btn = $('styles-other-btn');
        if (!wrapper) return;
        const open = typeof force === 'boolean' ? force : wrapper.hidden || wrapper.style.display === 'none';
        wrapper.hidden = !open;
        wrapper.style.display = '';
        if (btn) {
            btn.setAttribute('aria-expanded', String(open));
            btn.classList.toggle('is-open', open);
        }
        if (open) {
            const input = $('custom_style');
            if (input) setTimeout(() => { try { input.focus(); } catch (_) { /* opcional */ } }, 30);
        }
    }

    function renderStyleChips() {
        const grid = $('styles-grid');
        if (!grid || !hasRegister()) return;
        const moreBtn = $('styles-more-btn');
        const otherBtn = ensureOtherStyleButton();
        const visible = typeof STYLES_VISIBLE_COUNT === 'number' ? STYLES_VISIBLE_COUNT : 10;
        const chips = stepStyleChips(formState.data.styles || [], styleGroupsForUi(), visible);

        grid.innerHTML = '';
        chips.forEach((chip) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'style-option' + (chip.extra ? ' is-extra' : '') + (chip.selected ? ' selected' : '');
            btn.dataset.style = chip.name;
            btn.setAttribute('aria-pressed', String(chip.selected));
            btn.textContent = chip.label;
            btn.addEventListener('click', () => {
                if (typeof toggleStyleOption === 'function') toggleStyleOption(btn);
                btn.setAttribute('aria-pressed', String(btn.classList.contains('selected')));
            });
            grid.appendChild(btn);
        });
        if (moreBtn) {
            moreBtn.hidden = false;
            grid.appendChild(moreBtn);
        }
        grid.appendChild(otherBtn);
        syncStylesLaterHint();
        if (typeof refreshGroupGate === 'function') refreshGroupGate();
    }

    // Crear cuenta permite "Añadir más adelante" el estilo: el grupo 03 deja
    // seguir sin estilo y el aviso guía (opcional) a la lista completa o a
    // "Otro". La marca queda en el borrador (`styles_later`) para sobrevivir
    // a una recarga sin ?styleLater=1. Sin la marca, el estilo es obligatorio.
    function stylesLaterRequested() {
        if (hasRegister() && formState.data && formState.data.styles_later === true) return true;
        try {
            const params = new URLSearchParams(root.location.search || '');
            if (/^(1|true)$/i.test(params.get('styleLater') || '')) return true;
        } catch (_) { /* sin URL */ }
        const handoff = readSignupHandoff();
        return Boolean(handoff && handoff.style_later === true);
    }

    // ---------------------------------------------------------------------
    // Datos que llegan de Crear cuenta (main.js · página 2)
    // ---------------------------------------------------------------------
    // El borrador del servidor ya trae nombre, email, país, ciudad y estilo
    // (artists_db). Lo que no tiene columna viaja en localStorage bajo
    // `wo:artist-registration:signup-handoff` (+ ?styleLater=1 en la URL).
    const SIGNUP_HANDOFF_KEY = 'wo:artist-registration:signup-handoff';
    const SIGNUP_HANDOFF_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

    function readSignupHandoff() {
        let parsed = null;
        try { parsed = JSON.parse(root.localStorage.getItem(SIGNUP_HANDOFF_KEY) || 'null'); } catch (_) { return null; }
        if (!parsed || typeof parsed !== 'object') return null;
        if (parsed.saved_at && Date.now() - Number(parsed.saved_at) > SIGNUP_HANDOFF_MAX_AGE_MS) return null;
        const draftId = typeof registrationDraftId !== 'undefined' ? registrationDraftId : null;
        const email = hasRegister() ? String(formState.data.email || '').trim().toLowerCase() : '';
        const sameDraft = parsed.draft_id && draftId && parsed.draft_id === draftId;
        const sameEmail = parsed.email && email && String(parsed.email).toLowerCase() === email;
        return sameDraft || sameEmail ? parsed : null;
    }

    // Completa lo que falte (nunca pisa lo que el artista ya cargó) y, en la
    // primera llegada, sugiere la moneda del país elegido.
    function applySignupHandoff(firstArrival) {
        if (!hasRegister()) return;
        const handoff = readSignupHandoff();
        const data = formState.data;
        let changed = false;
        if (handoff) {
            if (!String(data.full_name || '').trim() && handoff.full_name) { data.full_name = String(handoff.full_name); changed = true; }
            if (!String(data.location_country || '').trim() && handoff.country) { data.location_country = String(handoff.country); changed = true; }
            if (!String(data.location_city || '').trim() && handoff.city) { data.location_city = String(handoff.city); changed = true; }
            if (!String(data.city || '').trim() && handoff.city) { data.city = String(handoff.city); changed = true; }
            if (!(data.styles || []).length && !handoff.style_later && Array.isArray(handoff.styles) && handoff.styles.length) {
                data.styles = handoff.styles.filter((s) => String(s || '').trim());
                changed = true;
            }
            const fullName = $('full_name');
            if (fullName && !fullName.value && data.full_name) fullName.value = data.full_name;
        }
        if (data.styles_later !== true && stylesLaterRequested()) { data.styles_later = true; changed = true; }
        if (firstArrival && !String(data.session_price || '').trim() && (!data.session_currency || data.session_currency === 'USD')) {
            const suggested = currencyForCountry(data.location_country);
            if (suggested && currentCurrencies().some((c) => c.code === suggested) && suggested !== data.session_currency) {
                data.session_currency = suggested;
                changed = true;
            }
        }
        if (changed) persist();
    }

    function syncStylesLaterHint() {
        const hint = $('styles-later-hint');
        if (!hint || !hasRegister()) return;
        hint.hidden = !(stylesLaterRequested() && !(formState.data.styles || []).length);
    }

    // ---------------------------------------------------------------------
    // 03 · Panel "Todos los estilos" (2001:3897 + revisión página 5)
    // ---------------------------------------------------------------------
    const panelState = { open: false, selection: [], query: '', groups: [], view: 'grouped', lastFocus: null };
    const PANEL_VIEW_KEY = 'wo:register:styles-view';

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
            <div class="ra-styles-panel" role="dialog" aria-modal="true" aria-labelledby="ra-styles-title" tabindex="-1">
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
                        <div class="ra-styles-view" role="group" aria-label="Ordenar estilos">
                            <button type="button" class="ra-styles-view-btn" data-styles-view="grouped" aria-pressed="true">Por grupo</button>
                            <button type="button" class="ra-styles-view-btn" data-styles-view="alpha" aria-pressed="false">A–Z</button>
                        </div>
                        <p class="ra-styles-count"><span class="ra-styles-count-box" aria-hidden="true"></span><span id="ra-styles-count-text" aria-live="polite">0 estilos seleccionados</span></p>
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
            const viewBtn = event.target.closest('[data-styles-view]');
            if (viewBtn) {
                setPanelView(viewBtn.getAttribute('data-styles-view'));
                return;
            }
            const chip = event.target.closest('[data-style-value]');
            if (chip) {
                toggleWorkingStyle(chip.getAttribute('data-style-value'));
                const again = overlay.querySelector(`[data-style-value="${cssEscape(chip.getAttribute('data-style-value'))}"]`);
                if (again) again.focus();
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

    function cssEscape(value) {
        if (root.CSS && typeof root.CSS.escape === 'function') return root.CSS.escape(value);
        return String(value).replace(/["\\]/g, '\\$&');
    }

    function setPanelView(view) {
        panelState.view = view === 'alpha' ? 'alpha' : 'grouped';
        try { root.localStorage.setItem(PANEL_VIEW_KEY, panelState.view); } catch (_) { /* preferencia opcional */ }
        document.querySelectorAll('[data-styles-view]').forEach((btn) => {
            btn.setAttribute('aria-pressed', String(btn.getAttribute('data-styles-view') === panelState.view));
        });
        renderStylesBody();
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

    function chipHtml(chip, keys) {
        const on = keys.has(normalizeKey(chip.value));
        return `<button type="button" class="ra-styles-chip${on ? ' is-selected' : ''}" data-style-value="${escapeHtml(chip.value)}" aria-pressed="${on}">${escapeHtml(chip.label)}${on ? '<i data-wo-icon="check" aria-hidden="true"></i>' : ''}</button>`;
    }

    function renderStylesBody() {
        const body = $('ra-styles-body');
        if (!body) return;
        const keys = selectionKeys();
        const groups = filterStyleGroups(panelState.groups, panelState.query);
        let html;
        if (panelState.view === 'alpha') {
            const chips = alphabeticalChips(groups);
            html = chips.length
                ? `<section class="ra-styles-group ra-styles-group--alpha" aria-label="Estilos en orden alfabético"><div class="ra-styles-chips">${chips.map((c) => chipHtml(c, keys)).join('')}</div></section>`
                : '';
        } else {
            html = groups.map((group) => `
                <section class="ra-styles-group" aria-label="${escapeHtml(group.title)}">
                    <p class="ra-styles-group-title">${escapeHtml(group.title)}</p>
                    <div class="ra-styles-chips">${group.chips.map((c) => chipHtml(c, keys)).join('')}</div>
                </section>`).join('');
        }
        // Estilos elegidos que no están en el catálogo (propios o de un
        // borrador viejo): se ven y se pueden quitar desde el panel.
        const catalogKeys = new Set(allChips(panelState.groups).map((c) => normalizeKey(c.value)));
        const custom = panelState.selection.filter((v) => !catalogKeys.has(normalizeKey(v)));
        if (custom.length && !String(panelState.query || '').trim()) {
            html += `<section class="ra-styles-group ra-styles-group--custom" aria-label="Tus estilos propios"><p class="ra-styles-group-title">Tus estilos propios</p><div class="ra-styles-chips">${custom.map((v) => chipHtml({ value: v, label: v }, keys)).join('')}</div></section>`;
        }
        const query = String(panelState.query || '').trim();
        if (query && !groups.some((g) => g.chips.some((c) => c.keys.includes(normalizeKey(query))))) {
            const label = query.charAt(0).toUpperCase() + query.slice(1);
            html += `<section class="ra-styles-group ra-styles-group--add"><p class="ra-styles-group-title">${groups.length ? '¿No está tu estilo?' : 'Sin resultados'}</p><div class="ra-styles-chips"><button type="button" class="ra-styles-chip" data-style-add="${escapeHtml(label)}">Agregar «${escapeHtml(label)}»</button></div><p class="ra-styles-note">Un estilo propio puede afectar tu ratio de descubrimiento: te recomendamos sumar también algún estilo de la lista.</p></section>`;
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
        panelState.groups = styleGroupsForUi();
        panelState.selection = (formState.data.styles || []).slice();
        panelState.query = '';
        try { panelState.view = root.localStorage.getItem(PANEL_VIEW_KEY) === 'alpha' ? 'alpha' : 'grouped'; } catch (_) { panelState.view = 'grouped'; }
        panelState.lastFocus = document.activeElement;
        $('ra-styles-query').value = '';
        document.querySelectorAll('[data-styles-view]').forEach((btn) => {
            btn.setAttribute('aria-pressed', String(btn.getAttribute('data-styles-view') === panelState.view));
        });
        renderStylesBody();
        overlay.hidden = false;
        overlay.scrollTop = 0;
        document.body.classList.add('ra-styles-open');
        panelState.open = true;
        const moreBtn = $('styles-more-btn');
        if (moreBtn) moreBtn.setAttribute('aria-expanded', 'true');
        // Foco en el diálogo (no en el buscador): el frame 2001:3897 abre con el buscador en reposo.
        setTimeout(() => { try { overlay.querySelector('.ra-styles-panel').focus({ preventScroll: true }); } catch (_) { /* foco opcional */ } }, 30);
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
    // (mismo endpoint que "Otro"); si falla, igual quedan en styles_array.
    function ensureCustomStyles(values) {
        const known = new Set(allChips(panelState.groups).filter((c) => c.inCatalog).map((c) => normalizeKey(c.value)));
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
        // Página 8: con publicaciones de Instagram se puede volver a importar
        // y se recuerda que no son públicas hasta validar la cuenta.
        const hasIg = draft.some((item) => item && item.source === 'ig');
        const igNote = $('ra-works-ig-note');
        if (igNote) igNote.hidden = !hasIg;
        const reimport = $('ra-works-reimport');
        if (reimport) reimport.textContent = hasIg ? 'Volver a importar de Instagram' : 'Importar de Instagram';
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
        openInstagramImporter(handle);
    }

    // Importador IG del registro (página 8): hasta 50 publicaciones, sin
    // "Publicaciones a buscar", con el aviso de verificación y re-importable.
    // Volver a importar arranca con lo ya importado marcado y reemplaza las
    // publicaciones de Instagram del portfolio (las subidas a mano quedan).
    function igDraftItems() {
        return portfolioDraft().filter((item) => item && item.source === 'ig');
    }

    function openInstagramImporter(handle) {
        if (!root.IGImport || typeof root.IGImport.open !== 'function') {
            setConnectStatus('El importador de Instagram no está disponible en este momento. Probá subir tus archivos.', 'error');
            return;
        }
        if (portfolioUi.mode === 'instagram') {
            setConnectStatus('Abrimos el importador para @' + handle + '. Seguí los pasos en la ventana de Instagram.', 'info');
        }
        const previous = igDraftItems();
        root.IGImport.open({
            target: 'artist',
            mode: 'signup',
            prefillHandle: handle,
            maxPosts: IG_SIGNUP_MAX_POSTS,
            preselectPermalinks: previous.map((item) => item.permalink).filter(Boolean),
            // Cupo del registro: 50 publicaciones. Los videos siguen las reglas
            // de la galería (2 de hasta 30 s), igual que antes.
            getGalleryState: () => ({
                count: 0,
                max: IG_SIGNUP_MAX_POSTS,
                videos: 0,
                maxVideos: 2,
                maxVideoSeconds: 30
            }),
            onComplete: (result) => {
                const media = result && result.prefill && Array.isArray(result.prefill.media) ? result.prefill.media : [];
                if (media.length) {
                    // Re-importación: la selección nueva reemplaza a la anterior.
                    igDraftItems().forEach((item) => {
                        if (typeof removePortfolioMediaItem === 'function') removePortfolioMediaItem(item.id);
                    });
                    if (hasRegister()) formState.data.portfolio_media_seeded = false;
                }
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

    function reimportInstagram() {
        setPortfolioError('');
        const handle = normalizeInstagramHandle(hasRegister() ? (formState.data.instagram_handle || '') : '');
        if (handle && /^[a-z0-9._]{1,30}$/i.test(handle)) openInstagramImporter(handle);
        else openInstagramConnect();
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
        const reimport = $('ra-works-reimport');
        if (reimport) reimport.addEventListener('click', reimportInstagram);

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
            const toInput = { website: websiteToInput, behance: behanceToInput, other: (v) => v };
            Object.keys(map).forEach((key) => {
                const input = $(map[key]);
                if (input && links[key] && !input.value) input.value = toInput[key](links[key]);
            });
            if (typeof saveLinkFields === 'function') saveLinkFields();
            if (typeof syncLinkToggles === 'function') syncLinkToggles();
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

    // El panel reemplaza al "ver más" expandible: el botón siempre está visible.
    function keepMoreStylesVisible() {
        const moreBtn = $('styles-more-btn');
        if (moreBtn) moreBtn.hidden = false;
    }

    // ---------------------------------------------------------------------
    // Reanudar el registro (recarga o navegador cerrado a mitad)
    // ---------------------------------------------------------------------
    // Diálogo "Continuar donde lo dejé" / "Empezar de cero". register.js
    // decide cuándo ofrecerlo y qué hace cada opción.
    function offerResume(options) {
        const opts = options || {};
        const existing = $('ra-resume-overlay');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = 'ra-resume-overlay';
        overlay.className = 'wo-overlay ra-resume-overlay';
        const where = opts.groupLabel ? ` Te quedaste en <strong>${escapeHtml(opts.groupLabel)}</strong>.` : '';
        const filesNote = opts.localFilesLost
            ? '<p class="ra-resume-note">Las fotos que subiste desde tu dispositivo no se guardan en el borrador: vas a tener que volver a cargarlas.</p>'
            : '';
        overlay.innerHTML = `
            <div class="wo-modal ra-resume" role="dialog" aria-modal="true" aria-labelledby="ra-resume-title" aria-describedby="ra-resume-text" tabindex="-1">
                <p class="ra-eyebrow">Registro en curso</p>
                <h2 class="wo-modal-title ra-resume-title" id="ra-resume-title">¿Seguimos donde lo dejaste?</h2>
                <p class="ra-resume-text" id="ra-resume-text">Guardamos lo que completaste.${where} Podés continuar o empezar de cero (se borra lo que cargaste).</p>
                ${filesNote}
                <div class="wo-modal-actions ra-resume-actions">
                    <button type="button" class="ra-ghost ra-resume-restart" data-resume="restart">Empezar de cero</button>
                    <button type="button" class="ra-continue ra-resume-continue" data-resume="continue">Continuar donde lo dejé <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i></button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        document.body.classList.add('ra-resume-open');
        hydrateIcons(overlay);
        const close = () => {
            overlay.remove();
            document.body.classList.remove('ra-resume-open');
        };
        overlay.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-resume]');
            if (!btn) return;
            const choice = btn.getAttribute('data-resume');
            close();
            if (choice === 'restart' && typeof opts.onRestart === 'function') opts.onRestart();
            if (choice === 'continue' && typeof opts.onContinue === 'function') opts.onContinue();
        });
        overlay.addEventListener('keydown', (event) => {
            if (event.key === 'Tab') trapFocus(event, overlay);
            // Escape = seguir (la opción que no borra nada).
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
                if (typeof opts.onContinue === 'function') opts.onContinue();
            }
        });
        setTimeout(() => {
            const primary = overlay.querySelector('[data-resume="continue"]');
            if (primary) { try { primary.focus(); } catch (_) { /* foco opcional */ } }
        }, 30);
        return overlay;
    }

    // ---------------------------------------------------------------------
    // Estados de QA de la revisión (solo preview): ?step=&state=
    // ---------------------------------------------------------------------
    function applyReviewPreviewState() {
        if (!isPreviewContext() || !hasRegister()) return;
        let params;
        try { params = new URLSearchParams(root.location.search); } catch (_) { return; }
        const state = String(params.get('state') || '');
        const step = String(params.get('step') || '');
        if (state === 'reanudar') {
            offerResume({ groupLabel: 'Tu oficio', localFilesLost: true, onContinue: () => {}, onRestart: () => {} });
        }
        if (step === '5' && state === 'estudio-nuevo') {
            const studioBtn = document.querySelector('.work-type-option[data-type="studio"]');
            if (studioBtn && typeof selectWorkTypeOption === 'function') selectWorkTypeOption(studioBtn);
            const studioInput = $('studio_name');
            if (studioInput && typeof selectStudioSuggestion === 'function') {
                studioInput.value = 'Estudio Nuevo de Prueba';
                formState.data.studio_name = studioInput.value;
                const fake = document.createElement('div');
                fake.dataset.action = 'create';
                selectStudioSuggestion(fake);
            }
        }
        if (step === '7' && state === 'error' && typeof showSubmitError === 'function') {
            const err = new Error('No se pudo finalizar el registro');
            err.status = 500;
            err.serverMessage = 'No se pudo finalizar el registro';
            showSubmitError(err);
        }
        if (step === '8' && state === 'link' && typeof renderStudioClaim === 'function') {
            renderStudioClaim('https://beta.weotzi.com/studio/register?alta=preview-0000', new Date(Date.now() + 14 * 864e5).toISOString());
        }
    }

    function afterInit(ctx) {
        root.syncStylesMoreButton = keepMoreStylesVisible;
        wirePasswordFeedback();
        applySignupHandoff(Boolean(ctx && ctx.firstArrival));
        canonicalizeSelectedStyles();
        renderCurrencyOptions();
        renderStyleChips();
        wirePortfolio();
        wireExtrasPersistence();
        wireSuccessCta();
        prefillExtras(ctx && ctx.loadedArtistRecord);
        renderPortfolio();
        applyPreviewState();
        applyReviewPreviewState();
        // Catálogo del servidor: si responde, reemplaza al local (mismo formato).
        loadCatalogs().then((result) => {
            if (!result || !result.remote) return;
            canonicalizeSelectedStyles();
            renderCurrencyOptions();
            renderStyleChips();
            if (panelState.open) {
                panelState.groups = styleGroupsForUi();
                renderStylesBody();
            }
        });
    }

    root.AccesoRegister = {
        core,
        afterInit,
        openStylesPanel,
        closeStylesPanel,
        renderStyleChips,
        renderPortfolio,
        renderCurrencyOptions,
        toggleCustomStyle,
        stylesLaterRequested,
        offerResume,
        reimportInstagram
    };
})(typeof window !== 'undefined' ? window : null);
