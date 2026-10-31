// ============================================
// WE OTZI - Nueva cotización manual (/my-quotations/new)
// Figma final "We Otzi Pantallas final":
//   801:556 (+ instancia 2004:2968) Cotizaciones - Nueva cotización manual
//   801:557 Cotizaciones - Vista previa para el cliente  (?step=preview)
// Hoja lateral sobre el listado. Se abre desde "Cotización manual" (listado)
// o entrando directo a /my-quotations/new (?origen=cliente|cita desde el
// dashboard o el calendario, ?fecha=AAAA-MM-DD precarga la fecha tentativa,
// ?borrador=<COT-ref> retoma un borrador, ?volver=<ruta> define a dónde vuelve
// "Cancelar"; sin volver, regresa a la página de origen si es de We Ötzi).
// Crea la cotización real vía WeotziData.Quotations.createManual (RPC) y el
// cliente vía WeotziData.ArtistClients; los borradores vía WeotziData.ManualQuotes.
// Lógica pura: quotation-new-model.js (window.WoQuotationNewModel).
// ============================================
(function () {
    'use strict';

    const M = window.WoQuotationNewModel;
    const VM = window.WoQuotationsViewModel;
    const page = () => window.QuotationsPage;
    const D = () => window.WeotziData;

    const LOCAL_KEY = 'weotzi:quotation-new:drafts';
    const MAX_FILES = 10;
    const MAX_FILE_MB = 10;

    let state = null;
    let files = [];
    let openFlag = false;
    let pushedHistory = false;
    let returnTo = null;   // a dónde vuelve "Cancelar" si la hoja se abrió por URL directa
    let sheetUrl = '';     // URL de la hoja (para restaurarla si el Atrás del navegador se cancela)
    let ready = false;
    let pendingOpen = null;
    let savedSnapshot = '';
    let busy = false;
    let baseTitle = '';
    let clientsCache = null;
    let catalogs = null;
    let ui = { clientQuery: '', creatingClient: false, newClient: { name: '', email: '', whatsapp: '', instagram: '', city: '' }, clientError: '', showResults: false };

    const $ = (sel, root) => (root || document).querySelector(sel);
    const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    function appUrl(path) {
        if (page()) return page().appUrl(path);
        const base = window.WEOTZI_BASE_PATH ? String(window.WEOTZI_BASE_PATH).replace(/\/$/, '') : '';
        return base + path;
    }

    function toast(msg, tone) { if (page()) page().toast(msg, tone); }

    function isNewRoute() { return /\/my-quotations\/new\/?$/.test(window.location.pathname); }

    // ---------------------------------------------------------------- borradores locales
    function readLocalDrafts() {
        try { return JSON.parse(window.localStorage.getItem(LOCAL_KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function writeLocalDraft(record) {
        try {
            const all = readLocalDrafts();
            all[record.quote_ref] = Object.assign({}, record, { updated_at: new Date().toISOString() });
            window.localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
            return true;
        } catch (e) { return false; }
    }
    function removeLocalDraft(ref) {
        try {
            const all = readLocalDrafts();
            delete all[ref];
            window.localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
        } catch (e) { /* storage bloqueado */ }
    }

    // ---------------------------------------------------------------- catálogos
    async function loadCatalogs() {
        if (catalogs) return catalogs;
        const cm = window.ConfigManager || {};
        const artist = page() && page().getArtist();
        const user = page() && page().getUser();
        const result = { styles: [], bodyParts: [], locations: [], currencies: [] };
        try {
            const tree = typeof cm.loadTattooStylesFromDB === 'function' ? await cm.loadTattooStylesFromDB() : [];
            (tree || []).forEach((s) => {
                if (!s || !s.name) return;
                result.styles.push({ id: s.id, slug: s.slug, name: s.name });
                (s.substyles || []).forEach((sub) => sub && sub.name && result.styles.push({ id: sub.id, slug: sub.slug, name: sub.name, parent: s.name }));
            });
        } catch (e) { console.warn('[quotation-new] estilos', e); }
        try {
            const parts = typeof cm.loadBodyPartsFromDB === 'function' ? await cm.loadBodyPartsFromDB() : [];
            const flat = [];
            (parts || []).forEach(function walk(p) {
                if (!p) return;
                const name = p.display_name || p.name || p.label;
                if (name && !flat.includes(name)) flat.push(name);
                (p.children || p.subparts || []).forEach(walk);
            });
            result.bodyParts = flat;
        } catch (e) { console.warn('[quotation-new] zonas', e); }
        if (artist && Array.isArray(artist.styles_array)) {
            artist.styles_array.forEach((name) => {
                if (name && !result.styles.some((s) => s.name.toLowerCase() === String(name).toLowerCase())) result.styles.unshift({ id: name, slug: String(name).toLowerCase(), name });
            });
        }
        try {
            if (user && D().ArtistLocations) {
                const { data } = await D().ArtistLocations.listSimpleByArtistUserId(user.id, 'city, studio_name, period_type, sort_order');
                (data || []).forEach((loc) => {
                    const label = [loc.studio_name, loc.city].filter(Boolean).join(' — ');
                    if (label && !result.locations.includes(label)) result.locations.push(label);
                });
            }
        } catch (e) { console.warn('[quotation-new] ubicaciones', e); }
        if (artist && artist.estudios && !result.locations.some((l) => l.indexOf(artist.estudios) === 0)) {
            result.locations.unshift([artist.estudios, artist.city].filter(Boolean).join(' — '));
        }
        result.locations.push('A coordinar con el cliente');
        const codes = (window.WeOtziCurrency && typeof window.WeOtziCurrency.list === 'function' ? window.WeOtziCurrency.list() : [])
            .map((c) => c && String(c.code || '').toUpperCase()).filter(Boolean);
        result.currencies = codes.length ? codes : ['ARS', 'USD', 'EUR'];
        catalogs = result;
        return result;
    }

    async function loadClients() {
        if (clientsCache) return clientsCache;
        const user = page() && page().getUser();
        if (!user) return [];
        let book = [];
        let fromQuotes = [];
        try { book = await D().ArtistClients.listForArtist(user.id); } catch (e) { if (!e.missingSchema) console.warn('[quotation-new] libreta', e); }
        try { fromQuotes = M.clientsFromQuotes(await D().Quotations.listClientContactsForArtist(user.id)); } catch (e) { console.warn('[quotation-new] contactos', e); }
        clientsCache = M.mergeClients(book, fromQuotes);
        return clientsCache;
    }

    // ---------------------------------------------------------------- render
    function options(list, selected, opts) {
        opts = opts || {};
        return (opts.placeholder ? `<option value="">${esc(opts.placeholder)}</option>` : '') +
            list.map((o) => {
                const value = typeof o === 'object' ? o.value : o;
                const label = typeof o === 'object' ? o.label : o;
                return `<option value="${esc(value)}"${String(value) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`;
            }).join('');
    }

    function segmented(field, items, value, label) {
        return `<div class="qn-seg" role="radiogroup" aria-label="${esc(label)}">${items.map((it) => `
            <button type="button" class="qn-seg-btn${String(it.value) === String(value) ? ' is-on' : ''}" role="radio" aria-checked="${String(it.value) === String(value)}" data-qn-seg="${esc(field)}" data-value="${esc(it.value)}">${esc(it.label)}</button>`).join('')}</div>`;
    }

    function field(label, control, id) {
        return `<div class="qn-field"><label class="qn-label"${id ? ` for="${id}"` : ''}>${esc(label)}</label>${control}</div>`;
    }

    function clientBlockHtml() {
        if (state.client) {
            const c = state.client;
            const meta = [c.email, c.whatsapp, c.city].filter(Boolean).join(' · ');
            return `
                <div class="qn-client-card">
                    <span class="qn-client-avatar" aria-hidden="true">${esc(VM.initials(c.name))}</span>
                    <div class="qn-client-main">
                        <strong>${esc(c.name)}</strong>
                        <span>${esc(meta || 'Sin datos de contacto')}</span>
                    </div>
                    <button type="button" class="qn-link" data-qn-action="change-client">Cambiar</button>
                </div>`;
        }
        const results = ui.showResults ? M.searchClients(clientsCache || [], ui.clientQuery, 6) : [];
        const resultsHtml = ui.showResults ? `
            <div class="qn-results" role="listbox" aria-label="Clientes">
                ${clientsCache === null ? '<p class="qn-results-empty">Buscando clientes…</p>' : results.length ? results.map((c, i) => `
                    <button type="button" class="qn-result" role="option" data-qn-pick="${i}">
                        <strong>${esc(c.name)}</strong><span>${esc([c.email, c.whatsapp, c.city].filter(Boolean).join(' · '))}</span>
                    </button>`).join('') : `<p class="qn-results-empty">No encontramos a «${esc(ui.clientQuery)}». Crealo con el enlace de abajo.</p>`}
            </div>` : '';
        const createForm = ui.creatingClient ? `
            <div class="qn-newclient">
                <div class="qn-newclient-grid">
                    ${field('Nombre y apellido', `<input id="qn-nc-name" class="qn-input" data-qn-nc="name" value="${esc(ui.newClient.name)}" autocomplete="off" placeholder="Ej. Marina Ibáñez">`, 'qn-nc-name')}
                    ${field('Correo', `<input id="qn-nc-email" type="email" class="qn-input" data-qn-nc="email" value="${esc(ui.newClient.email)}" autocomplete="off" placeholder="nombre@correo.com">`, 'qn-nc-email')}
                    ${field('WhatsApp', `<input id="qn-nc-wa" type="tel" class="qn-input" data-qn-nc="whatsapp" value="${esc(ui.newClient.whatsapp)}" autocomplete="off" placeholder="+54 9 11 …">`, 'qn-nc-wa')}
                    ${field('Instagram', `<input id="qn-nc-ig" class="qn-input" data-qn-nc="instagram" value="${esc(ui.newClient.instagram)}" autocomplete="off" placeholder="@usuario">`, 'qn-nc-ig')}
                    ${field('Ciudad', `<input id="qn-nc-city" class="qn-input" data-qn-nc="city" value="${esc(ui.newClient.city)}" autocomplete="off" placeholder="Ej. Buenos Aires">`, 'qn-nc-city')}
                </div>
                ${ui.clientError ? `<p class="qn-error" role="alert">${esc(ui.clientError)}</p>` : ''}
                <div class="qn-newclient-actions">
                    <button type="button" class="qn-btn qn-btn--outline" data-qn-action="save-client">Guardar cliente</button>
                    <button type="button" class="qn-btn qn-btn--text" data-qn-action="cancel-client">Cancelar</button>
                </div>
            </div>` : '';
        return `
            <div class="qn-search">
                <i data-wo-icon="search" aria-hidden="true"></i>
                <input type="search" id="qn-client-search" class="qn-search-input" value="${esc(ui.clientQuery)}" placeholder="Buscar cliente por nombre, correo o teléfono..." autocomplete="off" aria-label="Buscar cliente por nombre, correo o teléfono">
            </div>
            ${resultsHtml}
            ${ui.creatingClient ? '' : '<button type="button" class="qn-link qn-link--create" data-qn-action="create-client"><i data-wo-icon="plus" aria-hidden="true"></i>El cliente no está registrado, crearlo ahora</button>'}
            ${createForm}`;
    }

    function itemsHtml() {
        return state.items.map((it, index) => `
            <div class="qn-item" data-qn-row="${esc(it.id)}">
                <div class="qn-item-concept">
                    <input class="qn-input qn-input--ink" data-qn-item="${esc(it.id)}" data-qn-prop="name" value="${esc(it.name)}" placeholder="Nombre del concepto" aria-label="Nombre del concepto ${index + 1}">
                    <input class="qn-input qn-input--sm" data-qn-item="${esc(it.id)}" data-qn-prop="description" value="${esc(it.description)}" placeholder="Descripción opcional" aria-label="Descripción del concepto ${index + 1}">
                </div>
                <input class="qn-input qn-input--ink qn-input--qty" type="number" min="0" step="1" inputmode="numeric" data-qn-item="${esc(it.id)}" data-qn-prop="qty" value="${esc(it.qty)}" aria-label="Cantidad del concepto ${index + 1}">
                <input class="qn-input qn-input--ink qn-input--price" type="number" min="0" step="any" inputmode="decimal" data-qn-item="${esc(it.id)}" data-qn-prop="price" value="${esc(it.price)}" aria-label="Precio del concepto ${index + 1}">
                <div class="qn-item-tools">
                    <button type="button" class="qn-icon-btn qn-icon-btn--edit" data-qn-action="edit-item" data-qn-target="${esc(it.id)}" aria-label="Editar concepto ${index + 1}"><i data-wo-icon="edit" aria-hidden="true"></i></button>
                    <button type="button" class="qn-icon-btn" data-qn-action="remove-item" data-qn-target="${esc(it.id)}" aria-label="Quitar concepto ${index + 1}"><i data-wo-icon="trash-2" aria-hidden="true"></i></button>
                </div>
            </div>`).join('');
    }

    function filesHtml() {
        if (!files.length) return '<p class="qn-refs-empty">Todavía no adjuntaste referencias.</p>';
        return `<ul class="qn-files">${files.map((f, i) => `
            <li class="qn-file"><i data-wo-icon="${/^image\//.test(f.type) ? 'image' : 'file'}" aria-hidden="true"></i><span class="qn-file-name">${esc(f.name)}</span><span class="qn-file-size">${esc(Math.max(1, Math.round(f.size / 1024)))} KB</span>
            <button type="button" class="qn-icon-btn" data-qn-action="remove-file" data-qn-target="${i}" aria-label="Quitar ${esc(f.name)}"><i data-wo-icon="x" aria-hidden="true"></i></button></li>`).join('')}</ul>`;
    }

    function totalsHtml() {
        const t = M.computeTotals(state);
        const money = (n) => VM.formatMoney(n, state.currency);
        const curr = (catalogs && catalogs.currencies) || [state.currency];
        const list = curr.includes(state.currency) ? curr : [state.currency].concat(curr);
        return `
            <div class="qn-totals-head">
                <span>Totales</span>
                <span class="qn-totals-currency"><select data-qn-field="currency" aria-label="Moneda">${options(list, state.currency)}</select><i data-wo-icon="chevron-down" aria-hidden="true"></i></span>
            </div>
            <div class="qn-totals-body">
                <div class="qn-trow qn-trow--rule"><span>Subtotal</span><span class="qn-tval" data-qn-total="subtotal">${esc(money(t.subtotal))}</span></div>
                <div class="qn-trow qn-trow--rule"><label for="qn-f-discount">Descuento</label><span class="qn-pct"><input id="qn-f-discount" type="number" min="0" max="100" step="any" data-qn-field="discountPct" value="${esc(state.discountPct)}"><span>%</span></span></div>
                <div class="qn-trow qn-trow--rule"><label for="qn-f-tax">Impuestos</label><span class="qn-pct"><input id="qn-f-tax" type="number" min="0" max="100" step="any" data-qn-field="taxPct" value="${esc(state.taxPct)}"><span>%</span></span></div>
                <div class="qn-trow qn-trow--total"><span>Total</span><span class="qn-tbig" data-qn-total="total">${esc(money(t.total))}</span></div>
                <div class="qn-trow qn-trow--top"><label for="qn-f-deposit">Seña requerida</label><span class="qn-pct"><input id="qn-f-deposit" type="number" min="0" max="100" step="any" data-qn-field="depositPct" value="${esc(state.depositPct)}"><span>%</span></span></div>
                <div class="qn-trow"><span>Seña</span><span class="qn-tval qn-tval--bold" data-qn-total="deposit">${esc(money(t.deposit))}</span></div>
                <div class="qn-trow"><span>Saldo restante</span><span class="qn-tval" data-qn-total="balance">${esc(money(t.balance))}</span></div>
                <p class="qn-totals-note">Todos los valores son editables antes de enviar.</p>
            </div>`;
    }

    function sheetHtml() {
        const c = catalogs || { styles: [], bodyParts: [], locations: [] };
        const styleValue = state.style ? (state.style.id != null ? state.style.id : state.style.name) : '';
        const styleOptions = c.styles.map((s) => ({ value: s.id, label: s.parent ? `${s.parent} · ${s.name}` : s.name }));
        if (state.style && !c.styles.some((s) => String(s.id) === String(styleValue))) styleOptions.unshift({ value: styleValue, label: M.styleLabel(state.style) });
        const locations = c.locations.slice();
        if (state.location && !locations.includes(state.location)) locations.unshift(state.location);
        return `
            <header class="qn-head">
                <div class="qn-head-top">
                    <div class="qn-head-titles">
                        <div class="qn-head-ref"><span class="qn-ref">${esc(state.ref)}</span><span class="qn-badge">Borrador</span></div>
                        <h2 class="qn-title" id="qn-title">Nueva cotización manual</h2>
                    </div>
                    <button type="button" class="qn-close" data-qn-action="cancel" aria-label="Cerrar">×</button>
                </div>
                <div class="qn-head-actions">
                    <div class="qn-actions-row">
                        <button type="button" class="qn-btn qn-btn--outline" data-qn-action="save-draft">Guardar borrador</button>
                        <button type="button" class="qn-btn qn-btn--preview" data-qn-action="preview"><i data-wo-icon="eye" aria-hidden="true"></i>Previsualizar</button>
                        <button type="button" class="qn-btn qn-btn--submit" data-qn-action="submit" data-qn-submit>Crear y enviar cotización</button>
                        <button type="button" class="qn-btn qn-btn--text" data-qn-action="cancel">Cancelar</button>
                    </div>
                    <p class="qn-hint" data-qn-hint></p>
                </div>
            </header>
            <div class="qn-body">
                <div class="qn-form">
                    <h3 class="qn-step qn-step--first">01 · Datos del cliente</h3>
                    <div class="qn-client" data-qn-client>${clientBlockHtml()}</div>

                    <h3 class="qn-step">02 · Información del tatuaje</h3>
                    ${field('Título del proyecto', `<input id="qn-f-title" class="qn-input qn-input--lg" data-qn-field="title" value="${esc(state.title)}" maxlength="140" placeholder="Ej. Jaguar en blackwork cubriendo antebrazo">`, 'qn-f-title')}
                    ${field('Descripción de la idea', `<textarea id="qn-f-desc" class="qn-textarea" data-qn-field="description" maxlength="4000" placeholder="Contá qué quiere el cliente, referencias, detalles a tener en cuenta...">${esc(state.description)}</textarea>`, 'qn-f-desc')}
                    <div class="qn-grid">
                        ${field('Estilo', `<span class="qn-select"><select id="qn-f-style" data-qn-field="style">${options(styleOptions, styleValue, { placeholder: 'Elegir estilo' })}</select></span>`, 'qn-f-style')}
                        ${field('Parte del cuerpo', `<input id="qn-f-body" class="qn-input" data-qn-field="bodyPart" value="${esc(state.bodyPart)}" list="qn-body-parts" placeholder="Ej. Antebrazo" autocomplete="off"><datalist id="qn-body-parts">${c.bodyParts.map((p) => `<option value="${esc(p)}"></option>`).join('')}</datalist>`, 'qn-f-body')}
                        ${field('Tamaño aproximado', `<span class="qn-select"><select id="qn-f-size" data-qn-field="size">${options(M.SIZE_OPTIONS, state.size)}</select></span>`, 'qn-f-size')}
                        ${field('Color', `<span class="qn-select"><select id="qn-f-color" data-qn-field="color">${options(M.COLOR_OPTIONS, state.color)}</select></span>`, 'qn-f-color')}
                        ${field('Complejidad', `<span class="qn-select"><select id="qn-f-complexity" data-qn-field="complexity">${options(M.COMPLEXITY_OPTIONS, state.complexity)}</select></span>`, 'qn-f-complexity')}
                        ${field('Cover-up', segmented('coverUp', [{ value: 'true', label: 'Sí' }, { value: 'false', label: 'No' }], String(!!state.coverUp), 'Cover-up'))}
                        ${field('Sesiones estimadas', `<input id="qn-f-sessions" class="qn-input qn-input--mono" type="number" min="1" max="50" step="1" data-qn-field="sessions" value="${esc(state.sessions)}">`, 'qn-f-sessions')}
                        ${field('Duración por sesión', `<span class="qn-select"><select id="qn-f-hours" data-qn-field="sessionHours">${options(M.DURATION_OPTIONS.map((h) => ({ value: h, label: `${h} ${h === 1 ? 'hora' : 'horas'}` })), state.sessionHours)}</select></span>`, 'qn-f-hours')}
                        ${field('Estudio o ubicación', `<span class="qn-select"><select id="qn-f-location" data-qn-field="location">${options(locations, state.location, { placeholder: 'Elegir ubicación' })}</select></span>`, 'qn-f-location')}
                        ${field('Fecha tentativa', `<input id="qn-f-date" class="qn-input" type="date" data-qn-field="date" value="${esc(state.date)}">`, 'qn-f-date')}
                        ${field('Prioridad', segmented('priority', M.PRIORITIES, state.priority, 'Prioridad'))}
                    </div>

                    <div class="qn-refs-head">
                        <span class="qn-label">Referencias y archivos</span>
                        <button type="button" class="qn-link" data-qn-action="attach"><i data-wo-icon="plus" aria-hidden="true"></i>Adjuntar archivo</button>
                        <input type="file" id="qn-file-input" class="qn-file-input" multiple accept="image/*,application/pdf" tabindex="-1" aria-hidden="true">
                    </div>
                    <div class="qn-refs" data-qn-files>${filesHtml()}</div>

                    <h3 class="qn-step qn-step--wide">03 · Desglose económico</h3>
                    <div class="qn-econ">
                        <div class="qn-items">
                            <div class="qn-items-head" aria-hidden="true"><span>Concepto</span><span>Cant.</span><span>Precio</span><span></span></div>
                            <div data-qn-items>${itemsHtml()}</div>
                            <div class="qn-items-add">
                                <button type="button" class="qn-btn qn-btn--add" data-qn-action="add-item"><i data-wo-icon="plus" aria-hidden="true"></i>Agregar concepto</button>
                                <div class="qn-quick">${M.QUICK_CONCEPTS.map((q) => `<button type="button" class="qn-quick-chip" data-qn-quick="${esc(q.key)}">+ ${esc(q.label)}</button>`).join('')}</div>
                            </div>
                        </div>
                        <aside class="qn-totals" data-qn-totals aria-label="Totales">${totalsHtml()}</aside>
                    </div>

                    <h3 class="qn-step qn-step--wide">04 · Condiciones</h3>
                    <div class="qn-cond">
                        ${field('Vigencia de la cotización', `<span class="qn-select"><select id="qn-f-validity" data-qn-field="validityDays">${options(M.VALIDITY_OPTIONS.map((d) => ({ value: d, label: `${d} días` })), state.validityDays)}</select></span>`, 'qn-f-validity')}
                        ${field('Política de reserva y cancelación', `<span class="qn-select"><select id="qn-f-policy" data-qn-field="policy">${options(M.POLICIES.map((p) => ({ value: p.value, label: p.label })), state.policy)}</select></span>`, 'qn-f-policy')}
                    </div>
                    ${field('Notas para el cliente', `<textarea id="qn-f-notes" class="qn-textarea" data-qn-field="clientNotes" maxlength="4000" placeholder="Lo que quieras aclararle sobre el proyecto, cuidados o tiempos.">${esc(state.clientNotes)}</textarea>`, 'qn-f-notes')}
                    ${field('Términos adicionales', `<textarea id="qn-f-terms" class="qn-textarea" data-qn-field="extraTerms" maxlength="4000" placeholder="Términos propios de esta cotización.">${esc(state.extraTerms)}</textarea>`, 'qn-f-terms')}

                    <footer class="qn-foot">
                        <div class="qn-foot-row">
                            <button type="button" class="qn-btn qn-btn--submit qn-btn--lg" data-qn-action="submit" data-qn-submit>Crear y enviar cotización</button>
                            <button type="button" class="qn-btn qn-btn--outline qn-btn--lg" data-qn-action="save-draft">Guardar borrador</button>
                            <button type="button" class="qn-btn qn-btn--preview qn-btn--lg" data-qn-action="preview">Previsualizar</button>
                        </div>
                        <p class="qn-foot-hint" data-qn-hint></p>
                    </footer>
                </div>
            </div>`;
    }

    function previewHtml() {
        const artist = page() && page().getArtist();
        const p = M.previewModel(state, { artistName: artist && (artist.name || artist.username) });
        return `
            <div class="qn-pv-head">
                <span>${esc(p.header)}</span>
                <button type="button" class="qn-pv-close" data-qn-action="close-preview" aria-label="Cerrar vista previa">×</button>
            </div>
            <div class="qn-pv-body">
                <p class="qn-pv-byline">${esc(p.byline)}</p>
                <h3 class="qn-pv-title" id="qn-pv-title">${esc(p.title)}</h3>
                <p class="qn-pv-client">${esc(p.clientLine)}</p>
                <div class="qn-pv-block">
                    <p class="qn-pv-desc">${esc(p.description)}</p>
                    <div class="qn-pv-chips">${p.chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div>
                </div>
                <p class="qn-pv-label">Detalle</p>
                <div class="qn-pv-items">${p.items.map((it) => `
                    <div class="qn-pv-item">
                        <div>${it.name ? `<strong>${esc(it.name)}</strong>` : ''}<span>${esc(it.qtyLine)}</span>${it.description ? `<em>${esc(it.description)}</em>` : ''}</div>
                        <span class="qn-pv-amount">${esc(it.total)}</span>
                    </div>`).join('')}</div>
                <div class="qn-pv-total"><span>Total</span><strong>${esc(p.total)}</strong></div>
                <p class="qn-pv-deposit">${esc(p.depositLine)}</p>
                <div class="qn-pv-conditions">
                    <p>${esc(p.conditions)}</p>
                    ${p.notes ? `<p class="qn-pv-extra"><strong>Notas:</strong> ${esc(p.notes)}</p>` : ''}
                    ${p.terms ? `<p class="qn-pv-extra"><strong>Términos:</strong> ${esc(p.terms)}</p>` : ''}
                </div>
                ${p.missing ? `<p class="qn-pv-missing" data-qn-pv-missing hidden>${esc(p.missing)} para poder enviarla.</p>` : ''}
                <div class="qn-pv-actions">
                    <button type="button" class="qn-btn qn-btn--ink-solid" data-qn-action="close-preview">Seguir editando</button>
                    <button type="button" class="qn-btn qn-btn--accent-solid" data-qn-action="submit-from-preview">Crear y enviar</button>
                </div>
            </div>`;
    }

    // ---------------------------------------------------------------- DOM base
    function ensureRoot() {
        if ($('#qn-sheet')) return;
        const wrap = document.createElement('div');
        wrap.innerHTML = `
            <div class="qn-overlay" id="qn-overlay" hidden></div>
            <section class="qn-sheet" id="qn-sheet" role="dialog" aria-modal="true" aria-labelledby="qn-title" tabindex="-1" hidden></section>
            <div class="qn-pv-overlay" id="qn-pv-overlay" hidden></div>
            <section class="qn-preview" id="qn-preview" role="dialog" aria-modal="true" aria-labelledby="qn-pv-title" tabindex="-1" hidden></section>`;
        while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);
        bindEvents();
    }

    function navBottom() {
        const nav = document.querySelector('weotzi-product-nav');
        const target = nav && (nav.querySelector('header, nav, .wo-topbar') || nav.firstElementChild || nav);
        return target ? Math.max(0, Math.round(target.getBoundingClientRect().bottom)) : 0;
    }

    function syncTop() { document.documentElement.style.setProperty('--qn-top', navBottom() + 'px'); }

    function renderSheet() {
        const sheet = $('#qn-sheet');
        if (!sheet) return;
        sheet.innerHTML = sheetHtml();
        refreshComputed();
    }

    function rerender(selector, html) {
        const el = $(selector, $('#qn-sheet'));
        if (el) el.innerHTML = html;
    }

    function refreshComputed() {
        const sheet = $('#qn-sheet');
        if (!sheet || !state) return;
        const missing = M.missingRequirements(state);
        const message = M.missingMessage(missing);
        sheet.querySelectorAll('[data-qn-hint]').forEach((el) => { el.textContent = message || '·'; el.classList.toggle('is-empty', !message); });
        sheet.querySelectorAll('[data-qn-submit]').forEach((btn) => {
            btn.classList.toggle('is-ready', !message);
            btn.setAttribute('aria-disabled', String(!!message));
            btn.title = message || 'Crear la cotización y enviársela al cliente';
        });
        const t = M.computeTotals(state);
        ['subtotal', 'total', 'deposit', 'balance'].forEach((k) => {
            const el = sheet.querySelector(`[data-qn-total="${k}"]`);
            if (el) el.textContent = VM.formatMoney(t[k], state.currency);
        });
    }

    // ---------------------------------------------------------------- abrir / cerrar
    function buildNewUrl(extra) {
        const params = new URLSearchParams();
        if (state && state.origin && state.origin !== 'manual') params.set('origen', state.origin);
        Object.keys(extra || {}).forEach((k) => { if (extra[k]) params.set(k, extra[k]); });
        const q = params.toString();
        return appUrl('/my-quotations/new' + (q ? '?' + q : ''));
    }

    function listUrl() {
        const url = new URL(window.location.href);
        const keep = new URLSearchParams();
        const scope = url.searchParams.get('alcance');
        if (scope) keep.set('alcance', scope);
        const q = keep.toString();
        return appUrl('/my-quotations' + (q ? '?' + q : ''));
    }

    async function initState(opts) {
        const artist = page() && page().getArtist();
        const prefCurrency = window.WeOtziCurrency && typeof window.WeOtziCurrency.getDisplayPreference === 'function' ? window.WeOtziCurrency.getDisplayPreference() : 'local';
        const currency = prefCurrency && prefCurrency !== 'local' ? prefCurrency : (artist && (artist.session_price_currency || artist.session_currency)) || 'ARS';
        if (opts.draftRef) {
            let record = null;
            try { record = await D().ManualQuotes.getByRef(opts.draftRef); } catch (e) { if (!e.missingSchema) console.warn('[quotation-new] borrador', e); }
            if (!record) record = readLocalDrafts()[opts.draftRef] || null;
            if (record && record.status !== 'sent') return M.stateFromDraft(record, { currency });
            if (record && record.status === 'sent') toast('Esa cotización ya fue enviada.', 'info');
            else toast('No encontramos ese borrador. Empezamos una cotización nueva.', 'info');
        }
        return M.createInitialState({ origin: opts.origin, currency, date: opts.date });
    }

    // "Cancelar" vuelve a donde estaba el artista (calendario, dashboard...) cuando
    // la hoja se abrió por URL directa: ?volver=<ruta interna> o el referrer de We Ötzi.
    function resolveReturnTo(opts) {
        const explicit = M.safeReturnPath(opts && opts.returnTo);
        if (explicit) return explicit;
        try {
            if (!document.referrer || window.history.length < 2) return null;
            const ref = new URL(document.referrer);
            if (ref.origin !== window.location.origin) return null;
            // Desde el propio listado (o la hoja) no hace falta salir: se cierra en el lugar.
            if (/\/my-quotations(\/new)?\/?$/.test(ref.pathname)) return null;
            return 'history';
        } catch (e) { return null; }
    }

    function rememberSheetUrl() {
        if (openFlag && isNewRoute()) sheetUrl = window.location.pathname + window.location.search;
    }

    async function open(opts) {
        opts = opts || {};
        if (!ready) { pendingOpen = opts; return; }
        if (window.QuotationSummary && window.QuotationSummary.isOpen && window.QuotationSummary.isOpen()) window.QuotationSummary.close();
        ensureRoot();
        files = [];
        ui = { clientQuery: '', creatingClient: false, newClient: { name: '', email: '', whatsapp: '', instagram: '', city: '' }, clientError: '', showResults: false };
        await loadCatalogs();
        state = await initState(opts);
        if (state.origin === 'cliente' && !state.client) ui.creatingClient = true;
        savedSnapshot = snapshotOf(state);

        syncTop();
        renderSheet();
        const sheet = $('#qn-sheet');
        const overlay = $('#qn-overlay');
        sheet.hidden = false;
        overlay.hidden = false;
        document.documentElement.classList.add('qn-open');
        if (!baseTitle) baseTitle = document.title.indexOf('Nueva cotización') !== -1 ? 'WE ÖTZI | Cotizaciones' : document.title;
        document.title = 'WE ÖTZI | Nueva cotización manual';
        openFlag = true;
        void sheet.offsetWidth; // fuerza el estilo inicial para que la transición corra sin depender de rAF
        sheet.classList.add('is-open');
        overlay.classList.add('is-open');

        if (!isNewRoute() && opts.pushUrl !== false) {
            window.history.pushState({ qn: true }, '', buildNewUrl({ borrador: opts.draftRef }));
            pushedHistory = true;
            returnTo = null;
        } else {
            returnTo = pushedHistory ? null : resolveReturnTo(opts);
            if (opts.draftRef && !new URLSearchParams(window.location.search).get('borrador')) {
                window.history.replaceState(window.history.state, '', buildNewUrl({ borrador: opts.draftRef }));
            }
        }
        rememberSheetUrl();

        loadClients().then(() => { if (openFlag && ui.showResults) rerender('[data-qn-client]', clientBlockHtml()); });

        if (opts.step === 'preview') {
            openPreview();
        } else {
            const focusTarget = state.origin === 'cliente' && !state.client ? '#qn-nc-name' : state.origin === 'cita' ? '#qn-f-date' : (state.client ? '#qn-f-title' : '#qn-client-search');
            setTimeout(() => {
                const el = $(focusTarget);
                if (!el) return;
                // El buscador recibe el cursor al abrir pero sin el anillo de foco (Figma 801:556);
                // el anillo aparece con la primera tecla, el primer clic o al volver con Tab.
                const box = focusTarget === '#qn-client-search' ? el.closest('.qn-search') : null;
                if (box) {
                    box.classList.add('is-quiet');
                    const wake = () => {
                        box.classList.remove('is-quiet');
                        ['keydown', 'pointerdown', 'blur'].forEach((type) => el.removeEventListener(type, wake));
                    };
                    ['keydown', 'pointerdown', 'blur'].forEach((type) => el.addEventListener(type, wake));
                }
                el.focus({ preventScroll: true });
            }, 60);
        }
    }

    // Huella del formulario sin ids internos de los conceptos (para avisar cambios sin guardar).
    function snapshotOf(s) {
        const record = M.buildDraftRecord(s, {});
        record.line_items = record.line_items.map((it) => ({ name: it.name, description: it.description, qty: String(it.qty), price: String(it.price) }));
        return JSON.stringify(record);
    }

    function isDirty() {
        if (!state) return false;
        return snapshotOf(state) !== savedSnapshot || files.length > 0;
    }

    function close(opts) {
        opts = opts || {};
        if (!openFlag) return;
        if (!opts.force && isDirty() && !window.confirm('Tenés cambios sin guardar en esta cotización. ¿Querés salir igual?')) return;
        closePreview({ keepUrl: true });
        openFlag = false;
        const sheet = $('#qn-sheet');
        const overlay = $('#qn-overlay');
        sheet.classList.remove('is-open');
        overlay.classList.remove('is-open');
        sheet.hidden = true;
        overlay.hidden = true;
        sheet.innerHTML = '';
        document.documentElement.classList.remove('qn-open');
        if (baseTitle) document.title = baseTitle;
        state = null;
        files = [];
        sheetUrl = '';
        const back = opts.stay ? null : returnTo;
        returnTo = null;
        if (opts.fromPop) return;
        if (pushedHistory) {
            pushedHistory = false;
            window.history.back();
        } else if (back === 'history') {
            window.history.back();
        } else if (back) {
            window.location.assign(back);
        } else {
            window.history.replaceState({}, '', listUrl());
        }
    }

    function openPreview() {
        if (!state) return;
        const pv = $('#qn-preview');
        const ov = $('#qn-pv-overlay');
        pv.innerHTML = previewHtml();
        pv.hidden = false;
        ov.hidden = false;
        document.documentElement.classList.add('qn-pv-open');
        void pv.offsetWidth;
        pv.classList.add('is-open');
        ov.classList.add('is-open');
        pv.focus({ preventScroll: true });
        const url = new URL(window.location.href);
        if (url.searchParams.get('step') !== 'preview') {
            url.searchParams.set('step', 'preview');
            window.history.replaceState(window.history.state, '', url.pathname + url.search);
        }
        rememberSheetUrl();
    }

    function closePreview(opts) {
        const pv = $('#qn-preview');
        const ov = $('#qn-pv-overlay');
        if (!pv || pv.hidden) return;
        pv.classList.remove('is-open');
        ov.classList.remove('is-open');
        pv.hidden = true;
        ov.hidden = true;
        pv.innerHTML = '';
        document.documentElement.classList.remove('qn-pv-open');
        if (!(opts && opts.keepUrl)) {
            const url = new URL(window.location.href);
            url.searchParams.delete('step');
            window.history.replaceState(window.history.state, '', url.pathname + url.search);
        }
        rememberSheetUrl();
    }

    // ---------------------------------------------------------------- acciones
    function addItem(seed) {
        const empty = state.items.length === 1 && !state.items[0].name && !M.num(state.items[0].price);
        if (seed && empty) state.items = [];
        state.items.push(M.newItem(seed || {}));
        rerender('[data-qn-items]', itemsHtml());
        refreshComputed();
        const last = state.items[state.items.length - 1];
        const input = $(`[data-qn-item="${last.id}"][data-qn-prop="${seed && seed.name ? 'price' : 'name'}"]`);
        if (input) input.focus();
    }

    function removeItem(id) {
        state.items = state.items.filter((it) => it.id !== id);
        if (!state.items.length) state.items = [M.newItem()];
        rerender('[data-qn-items]', itemsHtml());
        refreshComputed();
    }

    function pickClient(client) {
        state.client = { id: client.id || null, name: client.name, email: client.email || '', whatsapp: client.whatsapp || '', instagram: client.instagram || '', city: client.city || '' };
        ui.showResults = false;
        ui.clientQuery = '';
        ui.creatingClient = false;
        rerender('[data-qn-client]', clientBlockHtml());
        refreshComputed();
        const title = $('#qn-f-title');
        if (title && !state.title) title.focus();
    }

    async function saveClient() {
        const input = Object.assign({}, ui.newClient);
        const error = M.validateNewClient(input);
        if (error) {
            ui.clientError = error;
            rerender('[data-qn-client]', clientBlockHtml());
            const el = $('#qn-nc-name');
            if (el && !input.name.trim()) el.focus();
            return;
        }
        const user = page() && page().getUser();
        const row = {
            artist_id: user && user.id,
            full_name: input.name.trim(),
            email: input.email.trim().toLowerCase() || null,
            whatsapp: input.whatsapp.trim() || null,
            instagram: input.instagram.trim().replace(/^@/, '') || null,
            city: input.city.trim() || null
        };
        try {
            const saved = await D().ArtistClients.create(row);
            const client = { id: saved && saved.id, name: row.full_name, email: row.email, whatsapp: row.whatsapp, instagram: row.instagram, city: row.city };
            if (clientsCache) clientsCache.unshift(client);
            pickClient(client);
            toast('Cliente creado y agregado a tu libreta.', 'success');
        } catch (err) {
            const code = String(err && (err.code || (err.cause && err.cause.code)) || '');
            if (code === '23505' && clientsCache) {
                const existing = clientsCache.find((c) => c.email && row.email && c.email.toLowerCase() === row.email);
                if (existing) { pickClient(existing); toast('Ese cliente ya estaba en tu libreta: lo seleccionamos.', 'info'); return; }
            }
            pickClient({ id: null, name: row.full_name, email: row.email, whatsapp: row.whatsapp, instagram: row.instagram, city: row.city });
            if (err && err.missingSchema) toast('Usamos este cliente en la cotización. La libreta de clientes se activa cuando se aplique la actualización de la base de datos.', 'info');
            else { console.error('[quotation-new] cliente', err); toast('No pudimos guardar el cliente en tu libreta; lo usamos solo en esta cotización.', 'error'); }
        }
    }

    async function saveDraft() {
        if (!state || busy) return;
        busy = true;
        const user = page() && page().getUser();
        const record = M.buildDraftRecord(state, { artistId: user && user.id });
        try {
            await D().ManualQuotes.saveDraft(record);
            removeLocalDraft(record.quote_ref);
            toast(`Borrador ${state.ref} guardado.`, 'success');
        } catch (err) {
            writeLocalDraft(record);
            if (err && err.missingSchema) toast('Guardamos el borrador en este navegador. Los borradores en la nube se activan con la actualización de la base de datos.', 'info');
            else { console.error('[quotation-new] borrador', err); toast('No pudimos guardar en la nube; dejamos el borrador en este navegador.', 'error'); }
        } finally {
            busy = false;
        }
        savedSnapshot = snapshotOf(state);
        const url = new URL(window.location.href);
        if (url.searchParams.get('borrador') !== state.ref) {
            url.searchParams.set('borrador', state.ref);
            window.history.replaceState(window.history.state, '', url.pathname + url.search);
        }
        rememberSheetUrl();
    }

    function focusMissing() {
        const missing = M.missingRequirements(state);
        let selector = null;
        if (missing.includes('cliente')) selector = state.client ? null : (ui.creatingClient ? '#qn-nc-name' : '#qn-client-search');
        else if (missing.includes('título')) selector = '#qn-f-title';
        else if (missing.length) selector = `[data-qn-item="${state.items[0].id}"][data-qn-prop="${state.items[0].name ? 'price' : 'name'}"]`;
        const el = selector && $(selector);
        if (el) { el.focus(); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }

    async function uploadFiles(quoteId) {
        if (!files.length) return { ok: 0, failed: 0 };
        const client = D().getClient && D().getClient();
        const uploaded = [];
        let failed = 0;
        for (const file of files) {
            try {
                if (!window.WeOtziUploader) throw new Error('uploader');
                const res = await window.WeOtziUploader.uploadFile({ supabase: client, bucket: 'quotation-references', file, pathPrefix: quoteId });
                uploaded.push(res);
            } catch (e) {
                failed++;
            }
        }
        if (uploaded.length) {
            try {
                await D().Attachments.insertMany(uploaded.map((u, i) => ({
                    quotation_id: quoteId, google_drive_url: u.publicUrl, file_name: u.name, mime_type: u.mimeType,
                    attachment_type: 'reference', status: 'confirmed', sort_order: i
                })));
            } catch (e) {
                console.warn('[quotation-new] adjuntos', e);
                failed += uploaded.length;
                return { ok: 0, failed };
            }
        }
        return { ok: uploaded.length, failed };
    }

    async function submit() {
        if (!state || busy) return;
        if (!M.isReady(state)) {
            toast(M.missingMessage(M.missingRequirements(state)) + '.', 'error');
            closePreview();
            focusMissing();
            return;
        }
        busy = true;
        const sheet = $('#qn-sheet');
        sheet.querySelectorAll('[data-qn-submit]').forEach((b) => { b.classList.add('is-busy'); b.textContent = 'Enviando…'; });
        const snapshot = state;
        const quotePayload = M.buildQuotePayload(snapshot);
        const details = M.buildDetailsPayload(snapshot);
        try {
            const result = await D().Quotations.createManual(quotePayload, details);
            if (!result || result.error) throw Object.assign(new Error((result && result.error) || 'Sin respuesta'), { code: '22023' });
            const quoteId = result.quote_id || snapshot.ref;
            removeLocalDraft(snapshot.ref);
            const uploads = await uploadFiles(quoteId);
            try {
                const artist = page() && page().getArtist();
                const event = window.ConfigManager && window.ConfigManager.sendN8NEvent && window.ConfigManager.sendN8NEvent('artist_responded_quotation', {
                    quote_id: quoteId,
                    client_name: quotePayload.client_full_name,
                    client_email: quotePayload.client_email || '',
                    artist_name: artist ? (artist.name || '') : '',
                    artist_budget_amount: quotePayload.artist_budget_amount,
                    artist_budget_currency: quotePayload.artist_budget_currency,
                    estimated_sessions: quotePayload.tattoo_estimated_sessions,
                    tattoo_style: quotePayload.tattoo_style ? quotePayload.tattoo_style.style_name : '',
                    tattoo_size: quotePayload.tattoo_size || '',
                    tattoo_body_part: quotePayload.tattoo_body_part || ''
                });
                if (event && typeof event.catch === 'function') event.catch(() => {});
            } catch (e) { /* la notificación no bloquea la creación */ }
            busy = false;
            close({ force: true, stay: true }); // queda en el listado con el resumen de la nueva
            await page().reload();
            toast(`Cotización ${quoteId} creada y enviada a ${quotePayload.client_full_name}.` + (uploads.failed ? ` No pudimos subir ${uploads.failed} ${uploads.failed === 1 ? 'archivo' : 'archivos'}.` : ''), uploads.failed ? 'info' : 'success');
            const created = page().findQuote(quoteId);
            if (created && window.QuotationSummary) window.QuotationSummary.open(created.id);
        } catch (err) {
            busy = false;
            sheet.querySelectorAll('[data-qn-submit]').forEach((b) => { b.classList.remove('is-busy'); b.textContent = 'Crear y enviar cotización'; });
            const user = page() && page().getUser();
            writeLocalDraft(M.buildDraftRecord(snapshot, { artistId: user && user.id }));
            if (err && err.missingSchema) {
                toast('Para crear cotizaciones manuales falta aplicar la actualización de la base de datos. Guardamos la cotización como borrador en este navegador.', 'error');
            } else {
                console.error('[quotation-new] crear', err);
                const detail = err && err.cause && err.cause.message ? ` (${err.cause.message})` : '';
                toast('No pudimos crear la cotización' + detail + '. Guardamos un borrador en este navegador.', 'error');
            }
        }
    }

    function onAction(action, target) {
        switch (action) {
            case 'cancel': return close();
            case 'save-draft': return saveDraft();
            case 'preview': return openPreview();
            case 'close-preview': return closePreview();
            case 'submit': return submit();
            case 'submit-from-preview': {
                if (!M.isReady(state)) {
                    const note = $('[data-qn-pv-missing]');
                    if (note) note.hidden = false;
                    toast(M.missingMessage(M.missingRequirements(state)) + '.', 'error');
                    return;
                }
                return submit();
            }
            case 'add-item': return addItem();
            case 'remove-item': return removeItem(target);
            case 'edit-item': {
                const input = $(`[data-qn-item="${target}"][data-qn-prop="name"]`);
                if (input) { input.focus(); input.select(); }
                return;
            }
            case 'attach': { const input = $('#qn-file-input'); if (input) input.click(); return; }
            case 'remove-file': {
                files.splice(Number(target), 1);
                rerender('[data-qn-files]', filesHtml());
                return;
            }
            case 'create-client': {
                ui.creatingClient = true;
                ui.clientError = '';
                ui.showResults = false;
                if (ui.clientQuery && !/@|\d/.test(ui.clientQuery)) ui.newClient.name = ui.clientQuery;
                else if (/@/.test(ui.clientQuery)) ui.newClient.email = ui.clientQuery;
                else if (/\d/.test(ui.clientQuery)) ui.newClient.whatsapp = ui.clientQuery;
                rerender('[data-qn-client]', clientBlockHtml());
                const el = $('#qn-nc-name');
                if (el) el.focus();
                return;
            }
            case 'cancel-client': {
                ui.creatingClient = false;
                ui.clientError = '';
                rerender('[data-qn-client]', clientBlockHtml());
                return;
            }
            case 'save-client': return saveClient();
            case 'change-client': {
                state.client = null;
                ui.creatingClient = false;
                ui.showResults = true;
                rerender('[data-qn-client]', clientBlockHtml());
                refreshComputed();
                const el = $('#qn-client-search');
                if (el) el.focus();
                return;
            }
            default:
        }
    }

    function setField(name, raw) {
        if (!state) return;
        if (name === 'style') {
            const s = (catalogs && catalogs.styles || []).find((x) => String(x.id) === String(raw));
            state.style = raw ? (s ? { id: s.id, slug: s.slug, name: s.name } : state.style) : null;
        } else if (['sessions', 'sessionHours', 'validityDays'].includes(name)) {
            state[name] = raw === '' ? '' : Number(raw);
        } else if (['discountPct', 'taxPct', 'depositPct'].includes(name)) {
            state[name] = raw === '' ? 0 : Math.min(100, Math.max(0, Number(raw) || 0));
        } else if (name === 'currency') {
            state.currency = String(raw || 'ARS').toUpperCase();
        } else {
            state[name] = raw;
        }
        refreshComputed();
    }

    function bindEvents() {
        const sheet = $('#qn-sheet');
        const overlay = $('#qn-overlay');
        const pv = $('#qn-preview');
        const pvOverlay = $('#qn-pv-overlay');

        overlay.addEventListener('click', () => close());
        pvOverlay.addEventListener('click', () => closePreview());

        sheet.addEventListener('click', (event) => {
            const pick = event.target.closest('[data-qn-pick]');
            if (pick) {
                const list = M.searchClients(clientsCache || [], ui.clientQuery, 6);
                const client = list[Number(pick.dataset.qnPick)];
                if (client) pickClient(client);
                return;
            }
            const seg = event.target.closest('[data-qn-seg]');
            if (seg) {
                const fieldName = seg.dataset.qnSeg;
                state[fieldName] = fieldName === 'coverUp' ? seg.dataset.value === 'true' : seg.dataset.value;
                seg.parentElement.querySelectorAll('.qn-seg-btn').forEach((b) => {
                    const on = b === seg;
                    b.classList.toggle('is-on', on);
                    b.setAttribute('aria-checked', String(on));
                });
                return;
            }
            const quick = event.target.closest('[data-qn-quick]');
            if (quick) {
                const concept = M.QUICK_CONCEPTS.find((q) => q.key === quick.dataset.qnQuick);
                if (concept) addItem({ name: concept.label, qty: 1, price: '' });
                return;
            }
            const btn = event.target.closest('[data-qn-action]');
            if (btn) {
                event.preventDefault();
                onAction(btn.dataset.qnAction, btn.dataset.qnTarget);
            }
        });

        pv.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-qn-action]');
            if (btn) { event.preventDefault(); onAction(btn.dataset.qnAction); }
        });

        sheet.addEventListener('input', (event) => {
            const t = event.target;
            if (t.id === 'qn-client-search') {
                ui.clientQuery = t.value;
                ui.showResults = true;
                const caret = t.selectionStart;
                rerender('[data-qn-client]', clientBlockHtml());
                const again = $('#qn-client-search');
                if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (e) { /* type=search */ } }
                if (clientsCache === null) loadClients().then(() => { if (ui.showResults) { rerender('[data-qn-client]', clientBlockHtml()); const el = $('#qn-client-search'); if (el) el.focus(); } });
                return;
            }
            if (t.dataset.qnNc) { ui.newClient[t.dataset.qnNc] = t.value; return; }
            if (t.dataset.qnItem) {
                const item = state.items.find((it) => it.id === t.dataset.qnItem);
                if (item) item[t.dataset.qnProp] = t.value;
                refreshComputed();
                return;
            }
            if (t.dataset.qnField && t.tagName !== 'SELECT') setField(t.dataset.qnField, t.value);
        });

        sheet.addEventListener('change', (event) => {
            const t = event.target;
            if (t.id === 'qn-file-input') {
                const picked = Array.from(t.files || []);
                const tooBig = picked.filter((f) => f.size > MAX_FILE_MB * 1024 * 1024);
                const accepted = picked.filter((f) => f.size <= MAX_FILE_MB * 1024 * 1024);
                files = files.concat(accepted).slice(0, MAX_FILES);
                if (tooBig.length) toast(`${tooBig.length} ${tooBig.length === 1 ? 'archivo supera' : 'archivos superan'} los ${MAX_FILE_MB} MB.`, 'error');
                t.value = '';
                rerender('[data-qn-files]', filesHtml());
                return;
            }
            if (t.dataset.qnField && t.tagName === 'SELECT') setField(t.dataset.qnField, t.value);
        });

        // La lista de clientes se abre al tocar o escribir en el buscador (no con el foco inicial).
        sheet.addEventListener('mousedown', (event) => {
            if (event.target.id === 'qn-client-search' && !ui.showResults) {
                ui.showResults = true;
                rerender('[data-qn-client]', clientBlockHtml());
                const el = $('#qn-client-search');
                if (el) el.focus();
                if (clientsCache === null) loadClients().then(() => { if (ui.showResults) { rerender('[data-qn-client]', clientBlockHtml()); const again = $('#qn-client-search'); if (again) again.focus(); } });
            }
        });

        sheet.addEventListener('keydown', (event) => {
            if (event.target.dataset && event.target.dataset.qnNc && event.key === 'Enter') { event.preventDefault(); saveClient(); }
            if (event.target.id === 'qn-client-search' && event.key === 'Enter') {
                event.preventDefault();
                const first = M.searchClients(clientsCache || [], ui.clientQuery, 1)[0];
                if (first) pickClient(first);
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || !openFlag) return;
            const pvEl = $('#qn-preview');
            if (pvEl && !pvEl.hidden) closePreview();
            else if (ui.showResults) { ui.showResults = false; rerender('[data-qn-client]', clientBlockHtml()); }
            else close();
        });

        window.addEventListener('resize', () => { if (openFlag) syncTop(); });
    }

    // ---------------------------------------------------------------- arranque
    function paramsOpts() {
        const params = new URLSearchParams(window.location.search);
        return { origin: params.get('origen'), draftRef: params.get('borrador'), step: params.get('step'), date: params.get('fecha'), returnTo: params.get('volver'), pushUrl: false };
    }

    document.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-quotation-new-open]');
        if (!trigger || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
        if (!ready) return; // sin sesión cargada, el link navega a /my-quotations/new
        event.preventDefault();
        open({ draftRef: trigger.dataset.draftRef || null });
    });

    window.addEventListener('popstate', () => {
        if (isNewRoute() && !openFlag) open(paramsOpts());
        else if (!isNewRoute() && openFlag) {
            // El Atrás del navegador pide la misma confirmación que "×" y "Cancelar".
            if (isDirty() && !window.confirm('Tenés cambios sin guardar en esta cotización. ¿Querés salir igual?')) {
                window.history.pushState({ qn: true }, '', sheetUrl || buildNewUrl({}));
                pushedHistory = true;
                return;
            }
            pushedHistory = false;
            close({ force: true, fromPop: true });
        }
    });

    // Recargar, cerrar la pestaña o salir a otra página con cambios sin guardar.
    window.addEventListener('beforeunload', (event) => {
        if (!openFlag || busy || !isDirty()) return;
        event.preventDefault();
        event.returnValue = '';
    });

    document.addEventListener('weotzi:quotations-ready', () => {
        ready = true;
        if (pendingOpen) { const o = pendingOpen; pendingOpen = null; open(o); return; }
        if (isNewRoute() || document.body.hasAttribute('data-quotation-new-autostart')) open(paramsOpts());
    });

    window.QuotationNew = {
        open,
        close,
        isOpen: () => openFlag,
        openPreview,
        _state: () => state
    };
})();
