// ============================================
// WE OTZI - Cotizaciones del artista (/my-quotations)
// Lista de tarjetas agrupadas por período (fidelidad Figma 23-cotizaciones).
// Datos: capa PostgREST unificada (window.WeotziData).
// El drawer de detalle vive en shared-drawer.js.
// ============================================

// Supabase Configuration - Uses config-manager.js (provides window.CONFIG)
const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = (window._supabase = window._supabase || supabase.createClient(supabaseUrl, supabaseKey));

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

// State - These are used by shared-drawer.js
let currentUser = null;
let artistData = null;
let quotations = [];
let filteredQuotations = [];
let selectedQuotes = new Set();
let allAttachments = [];
let allTattooStyles = [];

// Paginación del listado (Figma: "CARGAR COTIZACIONES ANTERIORES")
const PAGE_SIZE = 8;
let visibleCount = PAGE_SIZE;

// Filters & Sorting State
let sortConfig = { field: 'created_at', direction: 'desc' };
let filterConfig = { status: 'all', priority: 'all', quick: 'all', scope: 'all', search: '' };

// ============================================
// VOCABULARIO DE ESTADO Y PRIORIDAD
// ============================================

// Familias de color del Figma: pendiente / respondida / confirmada / rechazada / vencida.
const QUOTE_STATUS_VIEW = {
    pending:          { label: 'Pendiente',          tone: 'pending' },
    responded:        { label: 'Respondida',         tone: 'responded' },
    client_approved:  { label: 'Confirmada',         tone: 'confirmed' },
    in_progress:      { label: 'En progreso',        tone: 'confirmed' },
    artist_completed: { label: 'Lista para cliente', tone: 'confirmed' },
    completed:        { label: 'Completada',         tone: 'confirmed' },
    client_rejected:  { label: 'Rechazada',          tone: 'rejected' },
    expired:          { label: 'Vencida',            tone: 'expired' }
};

const CONFIRMED_STATUSES = ['client_approved', 'in_progress', 'artist_completed', 'completed'];
const ANSWERED_STATUSES = ['responded', 'client_approved', 'in_progress', 'artist_completed', 'completed', 'client_rejected'];
const CLOSED_STATUSES = ['completed', 'client_rejected', 'expired'];

const PRIORITY_VIEW = {
    high:   { label: 'Alta',  tone: 'high' },
    medium: { label: 'Media', tone: 'medium' },
    low:    { label: 'Baja',  tone: 'low' }
};

function statusView(status) {
    return QUOTE_STATUS_VIEW[status] || { label: status || 'Sin estado', tone: 'expired' };
}

function priorityView(priority) {
    return PRIORITY_VIEW[priority] || PRIORITY_VIEW.medium;
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

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

// Global exports
window.handleLogout = handleLogout;

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initializeAdmin();
    restoreZoom();
});

async function initializeAdmin() {
    try {
        // 1. Auth Check
        const { data: { session }, error: authError } = await _supabase.auth.getSession();

        if (authError || !session) {
            console.log('No authenticated session. Redirecting...');
            window.location.href = buildArtistLoginUrl('/my-quotations');
            return;
        }

        currentUser = session.user;

        // 2. Load Artist Profile
        const { data: artist, error: artistError } = await WeotziData.Artists.getByUserIdSingle(currentUser.id);

        if (artistError || !artist) {
            console.error('Artist profile not found');
            window.location.href = appUrl('/artist/dashboard');
            return;
        }

        artistData = artist;

        // Initialize UI
        renderHeroEyebrow();
        setupToolbarListeners();
        setupCurrencySelect();

        // 3. Load Quotations & Attachments
        await loadQuotations();

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('tab') === 'applications') {
            showApplicationsView();
        }

    } catch (err) {
        console.error('Initialization error:', err);
        const list = document.getElementById('quotes-table-body');
        if (list) list.innerHTML = '<div class="table-empty">No pudimos cargar tus cotizaciones. Probá recargar la página.</div>';
    }
}

// ============================================
// ZOOM (el DS Bauhaus no tiene modo oscuro)
// ============================================

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.2;
const ZOOM_STEP = 0.1;

function setZoom(factor) {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, factor));
    document.documentElement.style.setProperty('--zoom-factor', clamped);
    localStorage.setItem('weotzi-zoom', clamped);
}

function zoomIn() {
    const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--zoom-factor')) || 0.8;
    setZoom(current + ZOOM_STEP);
}

function zoomOut() {
    const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--zoom-factor')) || 0.8;
    setZoom(current - ZOOM_STEP);
}

function restoreZoom() {
    const savedZoom = localStorage.getItem('weotzi-zoom');
    if (savedZoom) setZoom(parseFloat(savedZoom));
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

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterConfig.search = e.target.value.toLowerCase();
            applyFiltersAndSort();
        });
    }

    if (statusFilter) {
        statusFilter.addEventListener('change', (e) => {
            filterConfig.status = e.target.value;
            if (filterConfig.quick !== 'all') setQuickFilter('all', { silent: true });
            applyFiltersAndSort();
        });
    }

    if (priorityFilter) {
        priorityFilter.addEventListener('change', (e) => {
            filterConfig.priority = e.target.value;
            if (filterConfig.quick === 'high' && e.target.value !== 'high') setQuickFilter('all', { silent: true });
            applyFiltersAndSort();
        });
    }

    if (scopeSelect) {
        scopeSelect.addEventListener('change', (e) => {
            filterConfig.scope = e.target.value;
            applyFiltersAndSort();
        });
    }

    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            const [field, direction] = e.target.value.split(':');
            sortConfig = { field, direction };
            applyFiltersAndSort();
        });
    }

    document.querySelectorAll('.q-chip[data-quick]').forEach((chip) => {
        chip.addEventListener('click', () => setQuickFilter(chip.dataset.quick));
    });

    if (moreFiltersBtn) {
        moreFiltersBtn.addEventListener('click', () => {
            const panel = document.getElementById('more-filters');
            if (!panel) return;
            const willOpen = panel.hasAttribute('hidden');
            if (willOpen) panel.removeAttribute('hidden');
            else panel.setAttribute('hidden', '');
            moreFiltersBtn.setAttribute('aria-expanded', String(willOpen));
            moreFiltersBtn.classList.toggle('is-active', willOpen);
        });
    }

    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', () => {
            visibleCount += PAGE_SIZE;
            renderList();
        });
    }

    if (exportBtn) exportBtn.addEventListener('click', exportQuotationsCsv);
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

function displayCurrencyPreference() {
    if (window.WeOtziCurrency && typeof window.WeOtziCurrency.getDisplayPreference === 'function') {
        return window.WeOtziCurrency.getDisplayPreference();
    }
    return 'local';
}

function setupCurrencySelect() {
    const select = document.getElementById('currency-select');
    if (!select) return;

    function rebuild() {
        const current = displayCurrencyPreference();
        select.innerHTML = '';
        const localOpt = document.createElement('option');
        localOpt.value = 'local';
        localOpt.textContent = 'Moneda original';
        select.appendChild(localOpt);

        const catalog = (window.WeOtziCurrency && typeof window.WeOtziCurrency.list === 'function')
            ? window.WeOtziCurrency.list()
            : [];
        catalog.forEach((currency) => {
            if (!currency || !currency.code) return;
            const opt = document.createElement('option');
            opt.value = currency.code;
            opt.textContent = currency.name ? `${currency.name} (${currency.code})` : currency.code;
            select.appendChild(opt);
        });
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
    });
}

// Suma importes en una sola moneda. Devuelve null si no hay ninguno convertible.
function aggregateAmount(entries) {
    const usable = entries.filter((e) => e && isFinite(parseFloat(e.amount)) && parseFloat(e.amount) > 0);
    if (!usable.length) return null;

    const pref = displayCurrencyPreference();
    let target = pref !== 'local' ? pref : null;
    if (!target) {
        const tally = {};
        usable.forEach((e) => {
            const code = (e.currency || 'USD').toUpperCase();
            tally[code] = (tally[code] || 0) + 1;
        });
        target = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || 'USD';
    }

    const canConvert = window.WeOtziCurrency && typeof window.WeOtziCurrency.convert === 'function';
    let total = 0;
    let counted = 0;
    usable.forEach((e) => {
        const amount = parseFloat(e.amount);
        const code = (e.currency || 'USD').toUpperCase();
        if (code === target) { total += amount; counted++; return; }
        if (!canConvert) return;
        const converted = window.WeOtziCurrency.convert(amount, code, target);
        if (converted != null) { total += converted; counted++; }
    });

    if (!counted) return null;
    return { total, currency: target };
}

function formatMoney(total, currency) {
    if (window.WeOtziCurrency && typeof window.WeOtziCurrency.format === 'function') {
        return window.WeOtziCurrency.format(total, currency, { decimals: 0 });
    }
    return `${currency} ${Math.round(total).toLocaleString('es-AR')}`;
}

function formatAggregate(entries, empty = '—') {
    const agg = aggregateAmount(entries);
    if (!agg) return empty;
    return formatMoney(agg.total, agg.currency);
}

// Importe que se muestra en la fila: el final si la cotización cerró, si no el del cliente.
function quoteAmountEntry(quote) {
    const useFinal = quote.quote_status === 'completed' && quote.final_budget_amount;
    return {
        amount: useFinal ? quote.final_budget_amount : quote.client_budget_amount,
        currency: useFinal ? (quote.final_budget_currency || 'USD') : (quote.client_budget_currency || 'USD')
    };
}

function formatQuoteAmount(quote) {
    const entry = quoteAmountEntry(quote);
    if (!entry.amount) return 'A definir';
    if (window.WeOtziCurrency && window.WeOtziCurrency.isReady()) {
        return window.WeOtziCurrency.formatInline(entry.amount, entry.currency, { showSecondary: false });
    }
    return `${entry.amount} ${entry.currency}`;
}

// ============================================
// DATA LOADING
// ============================================

async function loadQuotations() {
    try {
        // Cotizaciones (capa PostgREST unificada) + estilos en paralelo.
        const [quotes, stylesResult] = await Promise.all([
            WeotziData.Quotations.listActiveForArtist(currentUser.id),
            WeotziData
                .from('tattoo_styles')
                .select('*')
                .order('sort_order', { ascending: true })
        ]);

        quotations = quotes || [];

        // Store tattoo styles for later use
        if (stylesResult.error) {
            console.warn('Could not load tattoo styles:', stylesResult.error);
            allTattooStyles = [];
        } else {
            allTattooStyles = stylesResult.data || [];
        }

        // Fetch attachments for all quotations
        if (quotations.length > 0) {
            const quoteIds = quotations.map(q => q.quote_id).filter(id => id);
            if (quoteIds.length > 0) {
                allAttachments = await WeotziData.Attachments.listByQuoteIds(quoteIds);
            }
        }

        applyFiltersAndSort();
        updateStats();
        renderHeroTitle();

    } catch (err) {
        console.error('Error loading quotations:', err);
        document.getElementById('quotes-table-body').innerHTML = `<div class="table-empty">Error al cargar los datos: ${escapeHtml(err.message)}</div>`;
    }
}

// ============================================
// FILTERING & SORTING LOGIC
// ============================================

function matchesQuickFilter(quote) {
    switch (filterConfig.quick) {
        case 'pending': return quote.quote_status === 'pending';
        case 'high': return (quote.priority || 'medium') === 'high';
        case 'confirmed': return CONFIRMED_STATUSES.includes(quote.quote_status);
        default: return true;
    }
}

function matchesScope(quote) {
    if (filterConfig.scope === 'open') return !CLOSED_STATUSES.includes(quote.quote_status);
    if (filterConfig.scope === 'closed') return CLOSED_STATUSES.includes(quote.quote_status);
    return true;
}

function applyFiltersAndSort() {
    filteredQuotations = quotations.filter(q => {
        const matchesStatus = filterConfig.status === 'all' || q.quote_status === filterConfig.status;
        const matchesPriority = filterConfig.priority === 'all' || (q.priority || 'medium') === filterConfig.priority;
        const searchStr = [
            q.client_full_name,
            q.client_city_residence,
            q.quote_id || q.id,
            q.tattoo_idea_description
        ].filter(Boolean).join(' ').toLowerCase();
        const matchesSearch = filterConfig.search === '' || searchStr.includes(filterConfig.search);
        return matchesStatus && matchesPriority && matchesSearch && matchesQuickFilter(q) && matchesScope(q);
    });

    filteredQuotations.sort((a, b) => {
        let valA = 0;
        let valB = 0;

        if (sortConfig.field === 'created_at') {
            valA = new Date(a.created_at).getTime();
            valB = new Date(b.created_at).getTime();
        } else if (sortConfig.field === 'budget') {
            valA = parseFloat(a.client_budget_amount) || 0;
            valB = parseFloat(b.client_budget_amount) || 0;
        }

        if (sortConfig.direction === 'asc') return valA - valB;
        return valB - valA;
    });

    visibleCount = PAGE_SIZE;
    renderList();
}

// ============================================
// AGRUPACIÓN POR PERÍODO
// ============================================

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function startOfWeek(date) {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    const offset = (day.getDay() + 6) % 7; // lunes = 0
    day.setDate(day.getDate() - offset);
    return day;
}

function periodLabel(createdAt) {
    const created = new Date(createdAt);
    if (isNaN(created.getTime())) return 'Sin fecha';

    const thisWeek = startOfWeek(new Date());
    if (created >= thisWeek) return 'Esta semana';

    const lastWeek = new Date(thisWeek);
    lastWeek.setDate(lastWeek.getDate() - 7);
    if (created >= lastWeek) return 'Semana pasada';

    return `${MONTH_NAMES[created.getMonth()]} ${created.getFullYear()}`;
}

function groupByPeriod(list) {
    const groups = [];
    const index = {};
    list.forEach((quote) => {
        const label = periodLabel(quote.created_at);
        if (!index[label]) {
            index[label] = { label, quotes: [] };
            groups.push(index[label]);
        }
        index[label].quotes.push(quote);
    });
    return groups;
}

// ============================================
// STYLE HELPERS
// ============================================

function getStyleDisplayName(tattooStyle) {
    if (!tattooStyle) return 'TBD';
    if (typeof tattooStyle === 'string') return tattooStyle;
    if (typeof tattooStyle === 'object') {
        if (tattooStyle.substyle_name) {
            return `${tattooStyle.style_name} - ${tattooStyle.substyle_name}`;
        }
        return tattooStyle.style_name || 'TBD';
    }
    return 'TBD';
}

function shortQuoteRef(quote) {
    if (quote.quote_id) return quote.quote_id;
    return `COT-${String(quote.id).slice(-4).toUpperCase()}`;
}

function shortDate(isoString) {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '—';
    return `${String(date.getDate()).padStart(2, '0')} ${MONTH_SHORT[date.getMonth()]}`;
}

// ============================================
// RENDER DE LA LISTA (tarjetas agrupadas)
// ============================================

function renderQuoteCard(quote, index) {
    const status = statusView(quote.quote_status);
    const priority = priorityView(quote.priority || 'medium');
    const styleName = getStyleDisplayName(quote.tattoo_style);
    const bodyPart = quote.tattoo_body_part;

    const chips = [];
    if (styleName && styleName !== 'TBD') chips.push(styleName);
    if (bodyPart) chips.push(bodyPart);

    return `
        <article class="q-card" data-quote-id="${escapeHtml(quote.id)}" style="--q-card-delay:${index * 0.04}s">
            <div class="q-card-prio">
                <span class="q-prio-mark q-prio-mark--${priority.tone}" aria-hidden="true"></span>
                <span class="q-prio-label">${escapeHtml(priority.label)}</span>
            </div>
            <div class="q-card-body">
                <p class="q-card-meta">${escapeHtml(shortQuoteRef(quote))} · ${escapeHtml(shortDate(quote.created_at))}</p>
                <p class="q-card-head">
                    <span class="q-card-name">${escapeHtml(quote.client_full_name || 'Sin nombre')}</span>
                    ${quote.client_city_residence ? `<span class="q-card-city">${escapeHtml(quote.client_city_residence)}</span>` : ''}
                </p>
                <p class="q-card-desc">${escapeHtml(quote.tattoo_idea_description || 'Sin descripción')}</p>
                ${chips.length ? `<div class="q-card-chips">${chips.map(c => `<span class="q-chip-tag">${escapeHtml(c)}</span>`).join('')}</div>` : ''}
            </div>
            <div class="q-card-side">
                <span class="q-status q-status--${status.tone}">${escapeHtml(status.label)}</span>
                <span class="q-card-price">${escapeHtml(formatQuoteAmount(quote))}</span>
                <button type="button" class="q-card-cta" onclick="inspectQuote('${escapeHtml(quote.id)}')">
                    Ver detalle
                    <i data-wo-icon="arrow-right" aria-hidden="true"></i>
                </button>
            </div>
        </article>`;
}

function renderList() {
    const container = document.getElementById('quotes-table-body');
    const loadMoreWrap = document.getElementById('load-more-wrap');
    if (!container) return;

    updateLegendCount();

    if (filteredQuotations.length === 0) {
        container.innerHTML = '<div class="table-empty">No hay cotizaciones que coincidan con la búsqueda</div>';
        if (loadMoreWrap) loadMoreWrap.setAttribute('hidden', '');
        return;
    }

    const visible = filteredQuotations.slice(0, visibleCount);
    const groups = groupByPeriod(visible);

    let cardIndex = 0;
    container.innerHTML = groups.map((group) => {
        const count = group.quotes.length;
        const subtotal = formatAggregate(group.quotes.map(quoteAmountEntry), 'Sin importe');
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

    requestAnimationFrame(() => {
        container.querySelectorAll('.q-card').forEach((card) => card.classList.add('is-in'));
    });
}

function updateLegendCount() {
    const el = document.getElementById('legend-count');
    if (!el) return;
    const shown = Math.min(visibleCount, filteredQuotations.length);
    const total = filteredQuotations.length;
    el.textContent = `Mostrando ${shown} de ${total} ${total === 1 ? 'cotización' : 'cotizaciones'}`;
}

// ============================================
// HERO Y MÉTRICAS
// ============================================

function renderHeroEyebrow() {
    const el = document.getElementById('q-hero-eyebrow');
    if (!el) return;
    const now = new Date();
    el.textContent = `Módulo · Cotizaciones · ${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
}

function renderHeroTitle() {
    const el = document.getElementById('q-hero-title');
    if (!el) return;
    const weekStart = startOfWeek(new Date());
    const pendingThisWeek = quotations.filter(q =>
        q.quote_status === 'pending' && new Date(q.created_at) >= weekStart
    ).length;
    const noun = pendingThisWeek === 1 ? 'cotización' : 'cotizaciones';
    const verb = pendingThisWeek === 1 ? 'espera' : 'esperan';
    el.innerHTML = `<span class="wo-highlight">${pendingThisWeek} ${noun}</span> ${verb} tu respuesta esta semana.`;
}

function updateStats() {
    const total = quotations.length;
    const pending = quotations.filter(q => q.quote_status === 'pending').length;
    const answered = quotations.filter(q => ANSWERED_STATUSES.includes(q.quote_status)).length;
    const highPriority = quotations.filter(q => (q.priority || 'medium') === 'high').length;
    const responseRate = total > 0 ? Math.round((answered / total) * 100) : 0;

    const revenueEntries = quotations
        .filter(q => q.quote_status === 'completed')
        .map(q => ({ amount: q.final_budget_amount, currency: q.final_budget_currency || 'USD' }));

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
        window.showToast?.('No hay cotizaciones para exportar', 'error');
        return;
    }

    const header = ['ID', 'Fecha', 'Cliente', 'Ciudad', 'Estado', 'Prioridad', 'Estilo', 'Zona', 'Idea', 'Importe', 'Moneda'];
    const rows = filteredQuotations.map((quote) => {
        const entry = quoteAmountEntry(quote);
        return [
            shortQuoteRef(quote),
            new Date(quote.created_at).toISOString().slice(0, 10),
            quote.client_full_name || '',
            quote.client_city_residence || '',
            statusView(quote.quote_status).label,
            priorityView(quote.priority || 'medium').label,
            getStyleDisplayName(quote.tattoo_style),
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
}

// ============================================
// ARCHIVADO (lo dispara el drawer)
// ============================================

window.bulkArchive = async function() {
    if (selectedQuotes.size === 0) return;
    const ids = Array.from(selectedQuotes);
    try {
        await WeotziData.Quotations.setArchivedByIds(ids, true);
        selectedQuotes.clear();
        await loadQuotations();
    } catch (err) { window.showToast?.('Error al archivar: ' + err.message, 'error'); }
};

window.bulkArchiveSingle = async function(id) {
    selectedQuotes.clear();
    selectedQuotes.add(id.toString());
    await bulkArchive();
    if (typeof chatChannel !== 'undefined' && chatChannel) {
        WeotziData.removeChannel(chatChannel);
        chatChannel = null;
    }
    if (typeof currentChatQuoteId !== 'undefined') currentChatQuoteId = null;
    document.getElementById('drawer-toggle').checked = false;
};

// ============================================
// JOB BOARD - ARTIST APPLICATIONS VIEW
// (deep link /my-quotations?tab=applications desde job-board-feed.js)
// ============================================

let myApplications = [];

function showApplicationsView() {
    const mainEl = document.querySelector('main');
    Array.from(mainEl.children).forEach(child => {
        if (child.id === 'applications-view') {
            child.style.display = 'block';
        } else {
            child.style.display = 'none';
        }
    });

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('is-active'));

    loadMyApplications();
}

function showQuotationsView() {
    const mainEl = document.querySelector('main');
    Array.from(mainEl.children).forEach(child => {
        if (child.id === 'applications-view') {
            child.style.display = 'none';
        } else {
            child.style.display = '';
        }
    });

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('is-active'));
    const quotesNav = document.querySelector('a.nav-item[href="/my-quotations"]');
    if (quotesNav) quotesNav.classList.add('is-active');
}

window.showApplicationsView = showApplicationsView;
window.showQuotationsView = showQuotationsView;

// Volver al listado desde la vista de postulaciones sin recargar.
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-item').forEach(nav => {
        if (nav.getAttribute('href') === '/my-quotations') {
            nav.addEventListener('click', (e) => {
                e.preventDefault();
                showQuotationsView();
            });
        }
    });
});

async function loadMyApplications() {
    if (!_supabase || !currentUser) return;

    const container = document.getElementById('applications-table-body');

    try {
        const { data, error } = await WeotziData
            .from('job_board_applications')
            .select('*, job_board_requests(id, request_code, tattoo_idea_description, tattoo_body_part, tattoo_size, tattoo_style, client_city, client_budget_min, client_budget_max, client_budget_currency, status, resulting_quote_id)')
            .eq('artist_id', currentUser.id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        myApplications = data || [];
        renderApplicationsView();
    } catch (err) {
        console.error('Error loading applications:', err);
        container.innerHTML = '<div class="table-empty">Error al cargar postulaciones</div>';
    }
}

function renderApplicationsView() {
    const container = document.getElementById('applications-table-body');

    if (myApplications.length === 0) {
        container.innerHTML = `
            <div class="wo-empty" style="border: var(--border-strong-width) dashed var(--border-muted);">
                <p class="wo-empty-title">Todavía no tenés postulaciones</p>
                <p>Visitá el job board para encontrar solicitudes de tatuaje.</p>
                <a href="/job-board" class="wo-btn wo-btn--s">Explorar job board →</a>
            </div>`;
        return;
    }

    const statusLabels = { pending: 'Pendiente', viewed: 'Vista', accepted: 'Aceptada', rejected: 'Rechazada', withdrawn: 'Retirada' };
    const statusColors = {
        pending: 'var(--yellow-300)',
        viewed: 'var(--blue-400)',
        accepted: 'var(--system-success)',
        rejected: 'var(--red-300)',
        withdrawn: 'var(--neutral-400)'
    };

    let html = '';

    myApplications.forEach(app => {
        const req = app.job_board_requests || {};
        const date = new Date(app.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
        const idea = (req.tattoo_idea_description || '').substring(0, 60) + ((req.tattoo_idea_description || '').length > 60 ? '...' : '');
        const reqCurrency = req.client_budget_currency || 'USD';
        const budget = req.client_budget_min && req.client_budget_max
            ? (window.WeOtziCurrency && window.WeOtziCurrency.isReady()
                ? `${window.WeOtziCurrency.formatInline(req.client_budget_min, reqCurrency, { showSecondary: false })} - ${window.WeOtziCurrency.formatInline(req.client_budget_max, reqCurrency)}`
                : `$${req.client_budget_min}-$${req.client_budget_max} ${reqCurrency}`)
            : '-';
        const isAccepted = app.status === 'accepted';
        const msgPreview = (app.message || '').substring(0, 80) + ((app.message || '').length > 80 ? '...' : '');

        html += `
        <div style="border: var(--border-strong-width) solid var(--border-strong); margin-bottom: var(--space-4); overflow:hidden; background: var(--surface-card);">
            <div style="display:flex; justify-content:space-between; align-items:center; padding: var(--space-2) var(--space-4); background: var(--surface-inverse); color: var(--text-on-dark);">
                <span style="font-family: var(--font-mono); font-size: var(--meta-m-size); letter-spacing: var(--meta-m-track); color: var(--text-accent);">${req.request_code || ''}</span>
                <span style="background:${statusColors[app.status]}; color: var(--white); padding: 2px 8px; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; text-transform:uppercase;">${statusLabels[app.status]}</span>
            </div>
            <div style="padding: var(--space-4);">
                <p style="font-weight: var(--weight-semibold); margin: 0 0 var(--space-2); font-size: var(--body-s-size); color: var(--neutral-500);">${idea || 'Sin descripción'}</p>
                <div style="display:flex; gap: var(--space-4); flex-wrap:wrap; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-bottom: var(--space-3); align-items:center;">
                    ${req.client_city ? '<span style="display:inline-flex;align-items:center;gap:4px;"><i data-wo-icon="map-pin" class="wo-icon-18"></i>' + req.client_city + '</span>' : ''}
                    ${req.tattoo_body_part ? '<span style="display:inline-flex;align-items:center;gap:4px;"><i data-wo-icon="target" class="wo-icon-18"></i>' + req.tattoo_body_part + '</span>' : ''}
                    <span style="display:inline-flex;align-items:center;gap:4px;"><i data-wo-icon="calendar" class="wo-icon-18"></i>${date}</span>
                </div>
                <div style="display:flex; gap: var(--space-5); flex-wrap:wrap; font-size: var(--body-s-size); padding: var(--space-3); background: var(--neutral-100); border: var(--border-hairline) solid var(--border-subtle); color: var(--neutral-500);">
                    <div><strong>Presupuesto del cliente:</strong> ${budget}</div>
                    <div><strong>Tu precio:</strong> ${app.estimated_price ? '$' + app.estimated_price : '—'}</div>
                    <div><strong>Sesiones:</strong> ${app.estimated_sessions || '—'}</div>
                </div>
                ${msgPreview ? `<div style="margin-top: var(--space-3); padding: var(--space-3); border-left: var(--border-rule-width) solid var(--border-strong); font-size: var(--body-s-size); color: var(--text-muted); line-height:1.5;"><strong>Tu mensaje:</strong> ${msgPreview}</div>` : ''}
            </div>
            ${isAccepted && req.resulting_quote_id ? '<div style="padding: var(--space-3) var(--space-4); background: var(--action-direct); text-align:center;"><a href="/my-quotations" style="color: var(--white); font-weight: var(--weight-bold); text-transform:uppercase; font-size: var(--body-s-size); letter-spacing: var(--button-s-track);">Ver cotización creada →</a></div>' : ''}
        </div>`;
    });

    container.innerHTML = html;
}
