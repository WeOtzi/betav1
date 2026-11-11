// ============================================
// WE OTZI - Cotizaciones del artista (/my-quotations)
// Figma final "We Otzi Pantallas final" · 801:555 Listado y prioridades.
// Lista de tarjetas agrupadas por período + resumen lateral (quotations-summary.js)
// + nueva cotización manual (quotation-new.js, ruta /my-quotations/new).
// Datos: capa PostgREST unificada (window.WeotziData). Lógica pura en
// quotations-view-model.js (window.WoQuotationsViewModel).
// ============================================

// Supabase Configuration - Uses config-manager.js (provides window.CONFIG)
const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = (window._supabase = window._supabase || supabase.createClient(supabaseUrl, supabaseKey));

const VM = window.WoQuotationsViewModel;

function getAppBasePath() {
    if (window.WEOTZI_BASE_PATH) return String(window.WEOTZI_BASE_PATH).replace(/\/$/, '');
    const path = window.location?.pathname || '';
    return path === '/beta' || path.startsWith('/beta/') ? '/beta' : '';
}

function appUrl(path) {
    const normalized = String(path || '').startsWith('/') ? String(path || '') : '/' + String(path || '');
    const basePath = getAppBasePath();
    if (basePath && (normalized === basePath || normalized.startsWith(basePath + '/'))) {
        return normalized;
    }
    return basePath + normalized;
}

function buildArtistLoginUrl(returnTo = '/my-quotations') {
    const params = new URLSearchParams();
    if (returnTo) params.set('returnTo', returnTo);
    const query = params.toString();
    return appUrl('/registerclosedbeta' + (query ? `?${query}` : ''));
}

// ============================================
// ESTADO
// ============================================

let currentUser = null;
let artistData = null;
let quotations = [];          // activas (no archivadas, sin borradores del wizard)
let archivedQuotations = null; // alcance "Archivadas" (carga diferida)
let manualDrafts = null;       // alcance "Borradores" (carga diferida)
let filteredQuotations = [];

// Paginación del listado (Figma: "CARGAR COTIZACIONES ANTERIORES")
const PAGE_SIZE = 8;
let visibleCount = PAGE_SIZE;

let sortConfig = { field: 'created_at', direction: 'desc' };
let filterConfig = { status: 'all', priority: 'all', quick: 'all', scope: 'all', search: '' };

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ============================================
// TOAST (feedback de acciones del listado, del resumen y de la cotización manual)
// ============================================

function toast(message, tone = 'info') {
    let host = document.getElementById('q-toast-host');
    if (!host) {
        host = document.createElement('div');
        host.id = 'q-toast-host';
        host.className = 'q-toast-host';
        host.setAttribute('role', 'status');
        host.setAttribute('aria-live', 'polite');
        document.body.appendChild(host);
    }
    const item = document.createElement('div');
    item.className = `q-toast q-toast--${tone === 'error' ? 'error' : tone === 'success' ? 'success' : 'info'}`;
    item.textContent = message;
    host.appendChild(item);
    setTimeout(() => { item.classList.add('is-out'); }, 3800);
    setTimeout(() => { item.remove(); }, 4300);
}

if (typeof window.showToast !== 'function') window.showToast = toast;

// ============================================
// AUTH & LOGOUT
// ============================================

async function handleLogout() {
    try {
        const { error } = await _supabase.auth.signOut();
        if (error) throw error;
        window.location.href = appUrl('/registerclosedbeta');
    } catch (error) {
        console.error('Logout error:', error);
    }
}

window.handleLogout = handleLogout;

// ============================================
// INICIALIZACIÓN
// ============================================

document.addEventListener('DOMContentLoaded', initializeAdmin);

async function initializeAdmin() {
    const params = new URLSearchParams(window.location.search);

    // Las postulaciones del job board viven en /artist/applications (ruta canónica).
    if (params.get('tab') === 'applications') {
        window.location.replace(appUrl('/artist/applications'));
        return;
    }

    try {
        const { data: { session }, error: authError } = await _supabase.auth.getSession();
        if (authError || !session) {
            if (/\/my-quotations\/new\/?$/.test(window.location.pathname)) {
                window.location.href = buildArtistLoginUrl('/my-quotations/new' + window.location.search);
            } else {
                window.location.href = buildArtistLoginUrl('/my-quotations');
            }
            return;
        }

        currentUser = session.user;

        const { data: artist, error: artistError } = await WeotziData.Artists.getByUserIdSingle(currentUser.id);
        if (artistError || !artist) {
            console.error('Artist profile not found');
            window.location.href = appUrl('/artist/dashboard');
            return;
        }
        artistData = artist;

        renderHeroEyebrow();
        const manualBtn = document.getElementById('manual-quote-btn');
        if (manualBtn) manualBtn.setAttribute('href', appUrl('/my-quotations/new'));
        setupToolbarListeners();
        setupCurrencySelect();

        const scopeParam = params.get('alcance');
        if (scopeParam) {
            filterConfig.scope = VM.scopeFromParam(scopeParam);
            const scopeSelect = document.getElementById('scope-select');
            if (scopeSelect) scopeSelect.value = filterConfig.scope;
        }

        await loadQuotations();
        if (filterConfig.scope === 'archived' || filterConfig.scope === 'drafts') await loadScopeData(filterConfig.scope);
        applyFiltersAndSort();

        document.dispatchEvent(new CustomEvent('weotzi:quotations-ready', { detail: { artist: artistData, user: currentUser } }));

        const summaryRef = params.get('resumen');
        if (summaryRef && window.QuotationSummary) {
            const quote = findQuote(summaryRef);
            if (quote) window.QuotationSummary.open(quote.id, { keepUrl: true });
        }
    } catch (err) {
        console.error('Initialization error:', err);
        const list = document.getElementById('quotes-table-body');
        if (list) list.innerHTML = '<div class="q-empty"><strong>No pudimos cargar tus cotizaciones.</strong>Probá recargar la página.</div>';
    }
}

// ============================================
// TOOLBAR & LISTENERS
// ============================================

function setupToolbarListeners() {
    const searchInput = document.getElementById('search-input');
    const statusFilter = document.getElementById('status-filter');
    const priorityFilter = document.getElementById('priority-filter');
    const scopeSelect = document.getElementById('scope-select');
    const sortSelect = document.getElementById('sort-select');
    const moreFiltersBtn = document.getElementById('more-filters-btn');
    const loadMoreBtn = document.getElementById('load-more-btn');
    const exportBtn = document.getElementById('export-quotes-btn');
    const list = document.getElementById('quotes-table-body');

    searchInput?.addEventListener('input', (e) => {
        filterConfig.search = e.target.value.toLowerCase().trim();
        applyFiltersAndSort();
    });

    statusFilter?.addEventListener('change', (e) => {
        filterConfig.status = e.target.value;
        if (filterConfig.quick !== 'all') setQuickFilter('all', { silent: true });
        applyFiltersAndSort();
    });

    priorityFilter?.addEventListener('change', (e) => {
        filterConfig.priority = e.target.value;
        if (filterConfig.quick === 'high' && e.target.value !== 'high') setQuickFilter('all', { silent: true });
        applyFiltersAndSort();
    });

    scopeSelect?.addEventListener('change', async (e) => {
        filterConfig.scope = e.target.value;
        syncScopeParam();
        if (filterConfig.scope === 'archived' || filterConfig.scope === 'drafts') {
            list.innerHTML = '<div class="loading-placeholder">Cargando cotizaciones...</div>';
            await loadScopeData(filterConfig.scope);
        }
        applyFiltersAndSort();
    });

    sortSelect?.addEventListener('change', (e) => {
        const [field, direction] = e.target.value.split(':');
        sortConfig = { field, direction };
        applyFiltersAndSort();
    });

    document.querySelectorAll('.q-chip[data-quick]').forEach((chip) => {
        chip.addEventListener('click', () => setQuickFilter(chip.dataset.quick));
    });

    moreFiltersBtn?.addEventListener('click', () => {
        const panel = document.getElementById('more-filters');
        if (!panel) return;
        const willOpen = panel.hasAttribute('hidden');
        if (willOpen) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
        moreFiltersBtn.setAttribute('aria-expanded', String(willOpen));
        moreFiltersBtn.classList.toggle('is-active', willOpen);
    });

    loadMoreBtn?.addEventListener('click', () => {
        visibleCount += PAGE_SIZE;
        renderList();
    });

    exportBtn?.addEventListener('click', exportQuotationsCsv);

    // Tocar una fila abre el resumen lateral; "Ver detalle" navega al expediente.
    list?.addEventListener('click', (event) => {
        if (event.target.closest('a, button')) return;
        const card = event.target.closest('.q-card[data-quote-id]');
        if (card) openCard(card);
    });
    list?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const card = event.target.closest('.q-card[data-quote-id]');
        if (!card || event.target !== card) return;
        event.preventDefault();
        openCard(card);
    });
}

function openCard(card) {
    if (card.dataset.draftRef) {
        if (window.QuotationNew) window.QuotationNew.open({ draftRef: card.dataset.draftRef });
        else window.location.href = appUrl(`/my-quotations/new?borrador=${encodeURIComponent(card.dataset.draftRef)}`);
        return;
    }
    if (window.QuotationSummary) window.QuotationSummary.open(card.dataset.quoteId);
}

function syncScopeParam() {
    try {
        const url = new URL(window.location.href);
        if (filterConfig.scope === 'all') url.searchParams.delete('alcance');
        else url.searchParams.set('alcance', VM.paramForScope(filterConfig.scope));
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    } catch (e) { /* URL no disponible */ }
}

function setQuickFilter(value, options = {}) {
    filterConfig.quick = value;

    document.querySelectorAll('.q-chip[data-quick]').forEach((chip) => {
        const active = chip.dataset.quick === value;
        chip.classList.toggle('is-active', active);
        chip.setAttribute('aria-pressed', String(active));
    });

    // El chip manda: reinicia los selects finos para no filtrar dos veces.
    const statusFilter = document.getElementById('status-filter');
    const priorityFilter = document.getElementById('priority-filter');
    if (value === 'high') {
        filterConfig.status = 'all';
        filterConfig.priority = 'high';
    } else if (value !== 'all') {
        filterConfig.priority = 'all';
        filterConfig.status = 'all';
    } else if (!options.silent) {
        filterConfig.status = 'all';
        filterConfig.priority = 'all';
    }
    if (statusFilter) statusFilter.value = filterConfig.status;
    if (priorityFilter) priorityFilter.value = filterConfig.priority;

    if (!options.silent) applyFiltersAndSort();
}

// ============================================
// MONEDA
// ============================================

function artistCurrency() {
    const code = artistData && (artistData.session_price_currency || artistData.session_currency);
    return /^[A-Za-z]{3}$/.test(String(code || '')) ? String(code).toUpperCase() : 'ARS';
}

// "Mostrar en" (Figma: "Pesos (ARS)"): la moneda que eligió el artista o, si nunca
// eligió, la moneda de sus sesiones. Si falta el tipo de cambio, cada importe se
// muestra en su moneda original.
function displayCurrencyPreference() {
    let pref = 'local';
    if (window.WeOtziCurrency && typeof window.WeOtziCurrency.getDisplayPreference === 'function') {
        pref = window.WeOtziCurrency.getDisplayPreference();
    }
    return pref && pref !== 'local' ? String(pref).toUpperCase() : artistCurrency();
}

// Nombres cortos en español para el select "Mostrar en" (Figma: "Pesos (ARS)").
const CURRENCY_DISPLAY_NAMES = {
    ARS: 'Pesos', USD: 'Dólares', EUR: 'Euros', BRL: 'Reales',
    MXN: 'Pesos mexicanos', CLP: 'Pesos chilenos', COP: 'Pesos colombianos',
    UYU: 'Pesos uruguayos', PEN: 'Soles', GBP: 'Libras',
};

function setupCurrencySelect() {
    const select = document.getElementById('currency-select');
    if (!select) return;

    function rebuild() {
        const current = displayCurrencyPreference();
        select.innerHTML = '';

        const catalog = (window.WeOtziCurrency && typeof window.WeOtziCurrency.list === 'function')
            ? window.WeOtziCurrency.list()
            : [];
        const seen = new Set();
        const addOption = (code, name) => {
            const upper = String(code || '').toUpperCase();
            if (!upper || seen.has(upper)) return;
            seen.add(upper);
            const opt = document.createElement('option');
            opt.value = upper;
            const pretty = CURRENCY_DISPLAY_NAMES[upper] || name;
            opt.textContent = pretty ? `${pretty} (${upper})` : upper;
            select.appendChild(opt);
        };
        catalog.forEach((currency) => { if (currency && currency.code) addOption(currency.code, currency.name); });
        // La moneda vigente siempre está en la lista aunque el catálogo no la traiga.
        addOption(current, null);
        select.value = current;
    }

    rebuild();
    document.addEventListener('weotzi:currencies-loaded', rebuild);

    select.addEventListener('change', () => {
        if (window.WeOtziCurrency && typeof window.WeOtziCurrency.setDisplayPreference === 'function') {
            window.WeOtziCurrency.setDisplayPreference(select.value);
        }
        renderList();
        updateStats();
        document.dispatchEvent(new CustomEvent('weotzi:quotations-currency'));
    });
}

// Convierte (si el artista eligió "Mostrar en") y formatea como el Figma: "$185.000".
function moneyFor(amount, currency) {
    let n = VM.toNumber(amount);
    if (!isFinite(n)) return null;
    let code = String(currency || 'USD').toUpperCase();
    const pref = displayCurrencyPreference();
    if (pref !== code && window.WeOtziCurrency && typeof window.WeOtziCurrency.convert === 'function') {
        const converted = window.WeOtziCurrency.convert(n, code, pref);
        if (converted != null) { n = converted; code = pref; }
    }
    return { amount: n, currency: code };
}

function formatQuoteAmount(quote) {
    const entry = VM.amountEntry(quote);
    const money = moneyFor(entry.amount, entry.currency);
    return money && money.amount > 0 ? VM.formatMoney(money.amount, money.currency) : 'A definir';
}

// Suma importes en una sola moneda: la de "Mostrar en"; si sin tipo de cambio esa
// moneda deja afuera importes, usa la moneda más frecuente (nunca "$0" por no poder convertir).
function aggregateAmount(entries) {
    const usable = entries.filter((e) => e && isFinite(VM.toNumber(e.amount)) && VM.toNumber(e.amount) > 0);
    if (!usable.length) return null;

    const canConvert = window.WeOtziCurrency && typeof window.WeOtziCurrency.convert === 'function';
    const sumIn = (target) => {
        let total = 0;
        let counted = 0;
        usable.forEach((e) => {
            const amount = VM.toNumber(e.amount);
            const code = (e.currency || 'USD').toUpperCase();
            if (code === target) { total += amount; counted++; return; }
            if (!canConvert) return;
            const converted = window.WeOtziCurrency.convert(amount, code, target);
            if (converted != null) { total += converted; counted++; }
        });
        return { total, counted, currency: target };
    };

    const preferred = sumIn(displayCurrencyPreference());
    let best = preferred;
    if (preferred.counted < usable.length) {
        const tally = {};
        usable.forEach((e) => {
            const code = (e.currency || 'USD').toUpperCase();
            tally[code] = (tally[code] || 0) + 1;
        });
        const frequent = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || 'USD';
        const alt = sumIn(frequent);
        if (alt.counted > preferred.counted) best = alt;
    }

    if (!best.counted) return null;
    return { total: best.total, currency: best.currency };
}

function formatAggregate(entries, empty = '—') {
    const agg = aggregateAmount(entries);
    if (!agg) return empty;
    return VM.formatMoney(agg.total, agg.currency);
}

// ============================================
// CARGA DE DATOS
// ============================================

async function loadQuotations() {
    try {
        // Incluye "En progreso" (trabajo iniciado) y descarta los borradores del wizard del cliente.
        const rows = await WeotziData.Quotations.listActiveForArtist(currentUser.id, { excludeInProgress: false }) || [];
        quotations = rows.filter((q) => !VM.isClientWizardDraft(q));
        updateStats();
        renderHeroTitle();
    } catch (err) {
        console.error('Error loading quotations:', err);
        quotations = [];
        document.getElementById('quotes-table-body').innerHTML = `<div class="q-empty"><strong>No pudimos cargar tus cotizaciones.</strong>${escapeHtml(err.message)}</div>`;
    }
}

async function loadScopeData(scope) {
    if (scope === 'archived' && archivedQuotations === null) {
        try {
            archivedQuotations = await WeotziData.Quotations.listArchivedForArtist(currentUser.id);
        } catch (err) {
            console.error('Error loading archived quotations:', err);
            archivedQuotations = [];
            toast('No pudimos cargar las cotizaciones archivadas.', 'error');
        }
    }
    if (scope === 'drafts' && manualDrafts === null) {
        try {
            manualDrafts = (await WeotziData.ManualQuotes.listDraftsForArtist(currentUser.id)).map(draftAsQuote);
        } catch (err) {
            manualDrafts = [];
            if (err && err.missingSchema) {
                toast('Los borradores en la nube necesitan una actualización de la base de datos. Los borradores locales se abren desde "Cotización manual".', 'info');
            } else {
                console.error('Error loading drafts:', err);
                toast('No pudimos cargar tus borradores.', 'error');
            }
        }
    }
}

// Los borradores de cotización manual se muestran como tarjetas "Borrador".
function draftAsQuote(draft) {
    const client = draft.client || {};
    const project = draft.project || {};
    return {
        id: `draft-${draft.quote_ref}`,
        quote_id: draft.quote_ref,
        quote_status: 'draft',
        created_at: draft.updated_at || draft.created_at,
        client_full_name: client.name || 'Sin cliente',
        client_city_residence: client.city || '',
        tattoo_idea_description: project.description || project.title || 'Sin descripción todavía',
        tattoo_style: project.style || null,
        tattoo_body_part: project.body_part || '',
        priority: project.priority || 'medium',
        artist_budget_amount: draft.total || null,
        artist_budget_currency: draft.currency || 'ARS',
        _draftRef: draft.quote_ref,
    };
}

function sourceList() {
    if (filterConfig.scope === 'archived') return archivedQuotations || [];
    if (filterConfig.scope === 'drafts') return manualDrafts || [];
    return quotations;
}

function findQuote(idOrRef) {
    const key = String(idOrRef);
    const pools = [quotations, archivedQuotations || [], manualDrafts || []];
    for (const pool of pools) {
        const hit = pool.find((q) => String(q.id) === key || String(q.quote_id) === key);
        if (hit) return hit;
    }
    return null;
}

// ============================================
// FILTROS Y ORDEN
// ============================================

function applyFiltersAndSort() {
    filteredQuotations = sourceList().filter((q) => {
        const matchesStatus = filterConfig.status === 'all' || q.quote_status === filterConfig.status;
        const matchesPriority = filterConfig.priority === 'all' || (q.priority || 'medium') === filterConfig.priority;
        const searchStr = [
            q.client_full_name,
            q.client_city_residence,
            q.quote_id || q.id,
            q.tattoo_idea_description,
            q.project_description
        ].filter(Boolean).join(' ').toLowerCase();
        const matchesSearch = filterConfig.search === '' || searchStr.includes(filterConfig.search);
        return matchesStatus && matchesPriority && matchesSearch
            && VM.matchesQuick(q, filterConfig.quick) && VM.matchesScope(q, filterConfig.scope);
    });

    // Por presupuesto compara en la moneda de "Mostrar en" cuando hay tipo de cambio.
    filteredQuotations = VM.sortQuotes(filteredQuotations, sortConfig, (q) => {
        const entry = VM.amountEntry(q);
        return moneyFor(entry.amount, entry.currency) || entry;
    });

    visibleCount = PAGE_SIZE;
    renderList();
}

// ============================================
// RENDER DE LA LISTA (tarjetas agrupadas)
// ============================================

function renderQuoteCard(quote, index) {
    const status = VM.statusBadge(quote.quote_status);
    const priority = VM.priorityView(quote.priority || 'medium');
    const styleName = VM.styleName(quote.tattoo_style);
    const bodyPart = quote.tattoo_body_part;
    const isDraft = quote.quote_status === 'draft';

    const chips = [];
    if (styleName) chips.push(styleName);
    if (bodyPart) chips.push(bodyPart);

    const cta = isDraft
        ? `<a class="q-card-cta" href="${escapeHtml(appUrl(`/my-quotations/new?borrador=${encodeURIComponent(quote._draftRef)}`))}" data-quotation-new-open data-draft-ref="${escapeHtml(quote._draftRef)}">Retomar<i data-wo-icon="arrow-right" aria-hidden="true"></i></a>`
        : `<a class="q-card-cta" href="${escapeHtml(appUrl(VM.detailUrl(quote)))}">Ver detalle<i data-wo-icon="arrow-right" aria-hidden="true"></i></a>`;

    const selected = window.QuotationSummary && window.QuotationSummary.currentId && String(window.QuotationSummary.currentId()) === String(quote.id);

    return `
        <article class="q-card${selected ? ' is-selected is-in' : ''}" data-quote-id="${escapeHtml(quote.id)}"${isDraft ? ` data-draft-ref="${escapeHtml(quote._draftRef)}"` : ''} tabindex="0" aria-label="${escapeHtml(`${isDraft ? 'Retomar borrador' : 'Abrir resumen'} de ${quote.client_full_name || 'cotización'}`)}" style="--q-card-delay:${Math.min(index, 10) * 0.04}s">
            <div class="q-card-prio">
                <span class="q-prio-mark q-prio-mark--${priority.tone}" aria-hidden="true"></span>
                <span class="q-prio-label">${escapeHtml(priority.label)}</span>
            </div>
            <div class="q-card-body">
                <p class="q-card-meta">${escapeHtml(VM.shortRef(quote))} · ${escapeHtml(VM.shortDate(quote.created_at))}</p>
                <p class="q-card-head">
                    <span class="q-card-name">${escapeHtml(quote.client_full_name || 'Sin nombre')}</span>
                    ${quote.client_city_residence ? `<span class="q-card-city">${escapeHtml(quote.client_city_residence)}</span>` : ''}
                </p>
                <p class="q-card-desc">${escapeHtml(quote.tattoo_idea_description || quote.project_description || 'Sin descripción')}</p>
                ${chips.length ? `<div class="q-card-chips">${chips.map((c) => `<span class="q-chip-tag">${escapeHtml(c)}</span>`).join('')}</div>` : ''}
            </div>
            <div class="q-card-side">
                <span class="q-status q-status--${status.tone}"${status.detail !== status.label ? ` title="${escapeHtml(status.detail)}"` : ''}>${escapeHtml(status.label)}${status.detail !== status.label ? `<span class="q-visually-hidden"> · ${escapeHtml(status.detail)}</span>` : ''}</span>
                <span class="q-card-price">${escapeHtml(formatQuoteAmount(quote))}</span>
                ${cta}
            </div>
        </article>`;
}

function emptyStateHtml() {
    const hasFilters = filterConfig.search || filterConfig.quick !== 'all' || filterConfig.status !== 'all' || filterConfig.priority !== 'all';
    if (hasFilters) return '<div class="q-empty"><strong>No hay cotizaciones que coincidan.</strong>Probá con otra búsqueda o limpiá los filtros.</div>';
    if (filterConfig.scope === 'archived') return '<div class="q-empty"><strong>No tenés cotizaciones archivadas.</strong>Las cotizaciones que archives van a aparecer acá.</div>';
    if (filterConfig.scope === 'drafts') return '<div class="q-empty"><strong>No tenés borradores.</strong>Los borradores de cotizaciones manuales que guardes aparecen acá.</div>';
    return '<div class="q-empty"><strong>Todavía no tenés cotizaciones.</strong>Cuando un cliente te pida un presupuesto, o cargues una cotización manual, la vas a ver acá.</div>';
}

function renderList() {
    const container = document.getElementById('quotes-table-body');
    const loadMoreWrap = document.getElementById('load-more-wrap');
    if (!container) return;

    updateLegendCount();

    if (filteredQuotations.length === 0) {
        container.innerHTML = emptyStateHtml();
        loadMoreWrap?.setAttribute('hidden', '');
        return;
    }

    const visible = filteredQuotations.slice(0, visibleCount);
    // Por fecha: grupos por período (Figma). Por presupuesto: lista plana en un solo grupo.
    const groups = VM.groupForList(visible, sortConfig);

    let cardIndex = 0;
    container.innerHTML = groups.map((group) => {
        const count = group.quotes.length;
        const subtotal = formatAggregate(group.quotes.map(VM.amountEntry), 'Sin importe');
        const cards = group.quotes.map((quote) => renderQuoteCard(quote, cardIndex++)).join('');
        return `
            <section class="q-group">
                <header class="q-group-head">
                    <span class="q-group-title">${escapeHtml(group.label)}</span>
                    <span class="q-group-sum">${count} ${count === 1 ? 'cotización' : 'cotizaciones'} · ${escapeHtml(subtotal)}</span>
                </header>
                ${cards}
            </section>`;
    }).join('');

    if (loadMoreWrap) {
        if (filteredQuotations.length > visibleCount) loadMoreWrap.removeAttribute('hidden');
        else loadMoreWrap.setAttribute('hidden', '');
    }

    // Entrada escalonada de las tarjetas (con respaldo si la pestaña no pinta frames).
    const reveal = () => container.querySelectorAll('.q-card:not(.is-in)').forEach((card) => card.classList.add('is-in'));
    requestAnimationFrame(reveal);
    setTimeout(reveal, 120);
}

function updateLegendCount() {
    const el = document.getElementById('legend-count');
    if (!el) return;
    const shown = Math.min(visibleCount, filteredQuotations.length);
    el.textContent = VM.countLabel(shown, filteredQuotations.length);
}

// ============================================
// HERO Y MÉTRICAS
// ============================================

function renderHeroEyebrow() {
    const el = document.getElementById('q-hero-eyebrow');
    if (!el) return;
    const now = new Date();
    el.textContent = `Módulo · Cotizaciones · ${VM.MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
}

function renderHeroTitle() {
    const el = document.getElementById('q-hero-title');
    if (!el) return;
    const weekStart = VM.startOfWeek(new Date());
    const pendingThisWeek = quotations.filter((q) =>
        q.quote_status === 'pending' && new Date(q.created_at) >= weekStart
    ).length;
    const copy = VM.heroCopy(pendingThisWeek);
    el.innerHTML = `<span class="q-hero-mark">${escapeHtml(copy.highlight)}</span> ${escapeHtml(copy.rest)}`;
}

function updateStats() {
    const total = quotations.length;
    const pending = quotations.filter((q) => q.quote_status === 'pending').length;
    const answered = quotations.filter((q) => VM.ANSWERED_STATUSES.includes(q.quote_status)).length;
    const highPriority = quotations.filter((q) => (q.priority || 'medium') === 'high').length;
    const responseRate = total > 0 ? Math.round((answered / total) * 100) : 0;

    // Figma: suma de las cotizaciones con badge "Confirmada" (mismo criterio que el chip
    // CONFIRMADAS): aprobadas por el cliente, en progreso, listas y completadas.
    const revenueEntries = quotations
        .filter((q) => VM.CONFIRMED_STATUSES.includes(q.quote_status))
        .map(VM.amountEntry);

    setText('stat-total-quotes', total);
    setText('stat-pending-quotes', pending);
    setText('stat-response-rate', `${responseRate}%`);
    setText('stat-revenue', formatAggregate(revenueEntries, '$0'));
    setText('stat-high-priority', highPriority);
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

// ============================================
// EXPORTAR (CSV de lo que está filtrado)
// ============================================

function csvCell(value) {
    const str = String(value == null ? '' : value).replace(/"/g, '""');
    return `"${str}"`;
}

function exportQuotationsCsv() {
    if (!filteredQuotations.length) {
        toast('No hay cotizaciones para exportar.', 'error');
        return;
    }

    const header = ['ID', 'Fecha', 'Cliente', 'Ciudad', 'Estado', 'Prioridad', 'Estilo', 'Zona', 'Idea', 'Importe', 'Moneda'];
    const rows = filteredQuotations.map((quote) => {
        const entry = VM.amountEntry(quote);
        const created = new Date(quote.created_at);
        return [
            VM.shortRef(quote),
            isNaN(created.getTime()) ? '' : created.toISOString().slice(0, 10),
            quote.client_full_name || '',
            quote.client_city_residence || '',
            VM.statusView(quote.quote_status).label,
            VM.priorityView(quote.priority || 'medium').label,
            VM.styleName(quote.tattoo_style),
            quote.tattoo_body_part || '',
            quote.tattoo_idea_description || '',
            entry.amount || '',
            entry.amount ? entry.currency : ''
        ].map(csvCell).join(',');
    });

    const csv = '﻿' + [header.map(csvCell).join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cotizaciones-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exportaste ${filteredQuotations.length} ${filteredQuotations.length === 1 ? 'cotización' : 'cotizaciones'}.`, 'success');
}

// ============================================
// API PARA EL RESUMEN LATERAL Y LA COTIZACIÓN MANUAL
// ============================================

window.QuotationsPage = {
    appUrl,
    toast,
    escapeHtml,
    moneyFor,
    formatQuoteAmount,
    getUser: () => currentUser,
    getArtist: () => artistData,
    getQuotations: () => quotations.slice(),
    findQuote,
    // Refleja un cambio hecho desde el resumen (estado, prioridad, archivo).
    applyChange(quote, patch) {
        Object.assign(quote, patch);
        if ('is_archived' in patch) {
            if (patch.is_archived) {
                quotations = quotations.filter((q) => q !== quote);
                if (archivedQuotations) archivedQuotations.unshift(quote);
            } else {
                if (archivedQuotations) archivedQuotations = archivedQuotations.filter((q) => q !== quote);
                if (!quotations.includes(quote)) quotations.unshift(quote);
            }
        }
        updateStats();
        renderHeroTitle();
        applyFiltersAndSort();
    },
    removeQuote(quote) {
        quotations = quotations.filter((q) => q !== quote);
        if (archivedQuotations) archivedQuotations = archivedQuotations.filter((q) => q !== quote);
        updateStats();
        renderHeroTitle();
        applyFiltersAndSort();
    },
    // La cotización manual recién creada entra al listado sin recargar.
    async reload() {
        archivedQuotations = null;
        manualDrafts = null;
        await loadQuotations();
        if (filterConfig.scope === 'archived' || filterConfig.scope === 'drafts') await loadScopeData(filterConfig.scope);
        applyFiltersAndSort();
    },
    selectCard(id) {
        document.querySelectorAll('.q-card.is-selected').forEach((c) => c.classList.remove('is-selected'));
        if (id == null) return;
        const card = document.querySelector(`.q-card[data-quote-id="${CSS.escape(String(id))}"]`);
        if (card) card.classList.add('is-selected');
    },
};
