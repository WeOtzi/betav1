// ============================================
// WE OTZI - Quotations Admin Panel Logic
// Connected to Supabase quotations_db
// Uses shared-drawer.js for drawer functionality
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

// Column Configuration (Updated V4 · DS Bauhaus)
const defaultColumns = [
    { id: 'select', label: '', width: '40px', field: 'select' },
    { id: 'created_at', label: 'Fecha', width: '100px', field: 'created_at' },
    { id: 'id', label: 'ID', width: '80px', field: 'id' },
    { id: 'client', label: 'Cliente', width: '2fr', field: 'client_full_name' },
    { id: 'location', label: 'Ubicación', width: '1.5fr', field: 'client_city_residence' },
    { id: 'concept', label: 'Proyecto', width: '2fr', field: 'tattoo_idea_description' },
    { id: 'timing', label: 'Fecha deseada', width: '1.5fr', field: 'client_preferred_date' },
    { id: 'value', label: 'Valor', width: '110px', field: 'client_budget_amount' },
    { id: 'action', label: 'Acción', width: '150px', field: 'action' }
];

// Force reset if using old column version
let tableColumns = JSON.parse(localStorage.getItem('wo_table_columns_v4')) || defaultColumns;

// Filters & Sorting State
let sortConfig = { field: 'created_at', direction: 'desc' };
let filterConfig = { status: 'all', search: '' };

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
    restoreThemeAndZoom();
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
        const displayName = artist.username ? artist.username.toUpperCase() : currentUser.email.split('@')[0].toUpperCase();
        document.getElementById('logged-as').textContent = `LOGGED_AS: ${displayName}`;

        // Initialize UI
        renderHeaders();
        updateGridStyles();
        setupToolbarListeners();

        // 3. Load Quotations & Attachments
        await loadQuotations();

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('tab') === 'applications') {
            showApplicationsView();
        }

    } catch (err) {
        console.error('Initialization error:', err);
        document.getElementById('status-indicator').textContent = 'STATUS: OFFLINE (ERROR)';
    }
}

// ============================================
// THEME & ZOOM CONTROLS
// ============================================

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('weotzi-theme', isDark ? 'dark' : 'light');
    
    // Bauhaus visual feedback
    const btn = document.querySelector('.theme-toggle');
    if (btn) {
        btn.style.backgroundColor = 'var(--bauhaus-yellow)';
        setTimeout(() => btn.style.backgroundColor = '', 300);
    }
}

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

function restoreThemeAndZoom() {
    // Sin modo oscuro en el DS Bauhaus: solo se restaura el zoom.
    const savedZoom = localStorage.getItem('weotzi-zoom');
    if (savedZoom) {
        setZoom(parseFloat(savedZoom));
    }
}

// ============================================
// TOOLBAR & LISTENERS
// ============================================

function setupToolbarListeners() {
    const searchInput = document.getElementById('search-input');
    const statusFilter = document.getElementById('status-filter');
    const sortSelect = document.getElementById('sort-select');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterConfig.search = e.target.value.toLowerCase();
            applyFiltersAndSort();
        });
    }

    if (statusFilter) {
        statusFilter.addEventListener('change', (e) => {
            filterConfig.status = e.target.value;
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

    } catch (err) {
        console.error('Error loading quotations:', err);
        document.getElementById('quotes-table-body').innerHTML = `<div class="table-empty" style="color: var(--red-700);">Error al cargar los datos: ${err.message}</div>`;
    }
}

// ============================================
// FILTERING & SORTING LOGIC
// ============================================

function applyFiltersAndSort() {
    // 1. Filter
    filteredQuotations = quotations.filter(q => {
        const matchesStatus = filterConfig.status === 'all' || q.quote_status === filterConfig.status;
        const searchStr = (q.client_full_name + ' ' + (q.quote_id || q.id)).toLowerCase();
        const matchesSearch = filterConfig.search === '' || searchStr.includes(filterConfig.search);
        return matchesStatus && matchesSearch;
    });

    // 2. Sort
    filteredQuotations.sort((a, b) => {
        let valA, valB;

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

    renderTable();
}

// ============================================
// UI RENDERING & COLUMN MANAGEMENT
// ============================================

function renderHeaders() {
    const headerContainer = document.getElementById('table-header');
    headerContainer.innerHTML = '';

    tableColumns.forEach((col, index) => {
        const th = document.createElement('div');
        th.className = 'header-cell';
        if (col.id !== 'select') {
            th.draggable = true;
            th.dataset.index = index;
            th.innerHTML = `<span>${col.label}</span><div class="resize-handle" data-index="${index}"></div>`;
            th.addEventListener('dragstart', handleDragStart);
            th.addEventListener('dragover', handleDragOver);
            th.addEventListener('drop', handleDrop);
            th.addEventListener('dragend', handleDragEnd);
            const resizer = th.querySelector('.resize-handle');
            resizer.addEventListener('mousedown', initResize);
        } else {
            th.innerHTML = `<input type="checkbox" id="select-all-quotes" onclick="toggleSelectAll(event)">`;
        }
        headerContainer.appendChild(th);
    });
}

function updateGridStyles() {
    const gridTemplate = tableColumns.map(col => col.width).join(' ');
    document.getElementById('table-container').style.setProperty('--table-columns', gridTemplate);
}

function saveColumnConfig() {
    localStorage.setItem('wo_table_columns_v4', JSON.stringify(tableColumns));
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

// ============================================
// ROW RENDERING
// ============================================

function renderTable() {
    const tbody = document.getElementById('quotes-table-body');
    
    if (filteredQuotations.length === 0) {
        tbody.innerHTML = `<div class="table-empty">No hay cotizaciones que coincidan con la búsqueda</div>`;
        return;
    }

    tbody.innerHTML = filteredQuotations.map((quote, index) => {
        const id = (quote.quote_id || quote.id.toString()).slice(-5).toUpperCase();
        const date = new Date(quote.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
        // Show final_budget if completed, otherwise show client_budget
        const displayAmount = quote.quote_status === 'completed' && quote.final_budget_amount 
            ? quote.final_budget_amount 
            : quote.client_budget_amount;
        const displayCurrency = quote.quote_status === 'completed' && quote.final_budget_currency 
            ? quote.final_budget_currency 
            : quote.client_budget_currency;
        const value = displayAmount
            ? (window.WeOtziCurrency && window.WeOtziCurrency.isReady()
                ? window.WeOtziCurrency.formatInline(displayAmount, displayCurrency || 'USD')
                : `${displayAmount} ${displayCurrency || ''}`)
            : 'A definir';
        const isFinished = ['responded', 'completed', 'client_approved', 'artist_completed', 'client_rejected'].includes(quote.quote_status);
        const isSelected = selectedQuotes.has(quote.id.toString());

        const dataMap = {
            select: `<input type="checkbox" class="quote-checkbox" data-id="${quote.id}" ${isSelected ? 'checked' : ''} onclick="toggleSelect('${quote.id}', event)">`,
            created_at: `<span class="quote-date">${date}</span>`,
            id: `<span class="quote-id">#QN${id}</span>`,
            client: `
                <div class="client-cell">
                    <span class="client-name">${quote.client_full_name || 'Sin nombre'}</span>
                    <span class="client-sub">${quote.client_age ? quote.client_age + ' años' : '—'} · ${quote.client_instagram || 'sin instagram'}</span>
                </div>
            `,
            location: `<div class="location-cell">${quote.client_city_residence || '—'}</div>`,
            concept: `
                <div class="tattoo-cell">
                    <span class="tattoo-idea">${quote.tattoo_idea_description || 'Sin descripción'}</span>
                    <span class="tattoo-specs">${quote.tattoo_body_part || 'A definir'} · ${getStyleDisplayName(quote.tattoo_style)}</span>
                </div>
            `,
            timing: `<div class="timing-cell"><span class="status-badge ${isFinished ? 'completed' : ''}">${quote.client_preferred_date || 'Flexible'}</span></div>`,
            value: `<div class="price-cell">${value}</div>`,
            action: `
                <button class="action-btn detail-btn" onclick="inspectQuote('${quote.id}')">
                    Ver detalle
                    <i data-wo-icon="arrow-up-right" class="wo-icon-18"></i>
                </button>
            `
        };

        const rowCells = tableColumns.map(col => dataMap[col.id] || `<div>-</div>`).join('');

        return `<div class="quote-row ${isSelected ? 'selected' : ''}" style="opacity: 0; transform: translateY(12px); transition: opacity var(--duration-fade) var(--ease-standard), transform var(--duration-fade) var(--ease-standard); transition-delay: ${index * 0.04}s">${rowCells}</div>`;
    }).join('');

    setTimeout(() => {
        const rows = document.querySelectorAll('.quote-row');
        rows.forEach(row => { row.style.opacity = '1'; row.style.transform = 'translateY(0)'; });
    }, 50);

    updateBulkBar();
}

function updateStats() {
    const total = quotations.length;
    const pending = quotations.filter(q => q.quote_status === 'pending').length;
    document.getElementById('stat-total-quotes').textContent = total;
    document.getElementById('stat-pending-quotes').textContent = pending;
    // Only count completed quotes using final_budget_amount
    const revenue = quotations
        .filter(q => q.quote_status === 'completed')
        .reduce((sum, q) => sum + (parseFloat(q.final_budget_amount) || 0), 0);
    document.getElementById('stat-revenue').textContent = `$${(revenue / 1000).toFixed(1)}k`;
}

// ============================================
// SELECTION & BULK ACTIONS
// ============================================

window.toggleSelect = function(id, e) {
    if (selectedQuotes.has(id.toString())) selectedQuotes.delete(id.toString());
    else selectedQuotes.add(id.toString());
    renderTable();
};

window.toggleSelectAll = function(e) {
    if (e.target.checked) filteredQuotations.forEach(q => selectedQuotes.add(q.id.toString()));
    else selectedQuotes.clear();
    renderTable();
};

function updateBulkBar() {
    const bar = document.getElementById('bulk-action-bar');
    if (!bar) return;
    if (selectedQuotes.size > 0) {
        bar.classList.add('active');
        document.getElementById('selection-count').textContent = selectedQuotes.size === 1
            ? '1 seleccionada'
            : `${selectedQuotes.size} seleccionadas`;
    } else bar.classList.remove('active');
}

window.bulkArchive = async function() {
    if (selectedQuotes.size === 0) return;
    const ids = Array.from(selectedQuotes);
    try {
        await WeotziData.Quotations.setArchivedByIds(ids, true);
        selectedQuotes.clear();
        await loadQuotations();
    } catch (err) { alert('Error archiving: ' + err.message); }
};

window.bulkDelete = async function() {
    if (selectedQuotes.size === 0) return;
    if (!confirm('¿Seguro que querés eliminar las cotizaciones seleccionadas?')) return;
    const ids = Array.from(selectedQuotes);
    try {
        await WeotziData.Quotations.hardDeleteByIds(ids);
        selectedQuotes.clear();
        await loadQuotations();
    } catch (err) { alert('Error deleting: ' + err.message); }
};

window.bulkUpdateStatus = async function(newStatus) {
    if (selectedQuotes.size === 0) return;
    const ids = Array.from(selectedQuotes);
    try {
        await WeotziData.Quotations.updateStatusByIds(ids, newStatus);
        selectedQuotes.clear();
        await loadQuotations();
    } catch (err) { alert('Error updating status: ' + err.message); }
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
// LIST MANAGEMENT
// ============================================

window.openCreateListModal = function() {
    document.getElementById('create-list-modal').style.display = 'flex';
};

window.closeCreateListModal = function() {
    document.getElementById('create-list-modal').style.display = 'none';
    document.getElementById('new-list-name').value = '';
};

window.createList = function() {
    const name = document.getElementById('new-list-name').value.trim();
    if (!name) {
        alert('Please enter a list name');
        return;
    }
    // List creation logic would go here
    console.log('Creating list:', name);
    closeCreateListModal();
};

// ============================================
// DRAG & RESIZE LOGIC
// ============================================

let dragSrcIndex = null;
function handleDragStart(e) { this.classList.add('dragging'); dragSrcIndex = this.dataset.index; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/html', this.innerHTML); }
function handleDragOver(e) { if (e.preventDefault) e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; }
function handleDrop(e) {
    if (e.stopPropagation) e.stopPropagation();
    const dropTarget = e.target.closest('.header-cell');
    if (dropTarget && dragSrcIndex !== dropTarget.dataset.index) {
        const fromIndex = parseInt(dragSrcIndex);
        const toIndex = parseInt(dropTarget.dataset.index);
        const itemToMove = tableColumns[fromIndex];
        tableColumns.splice(fromIndex, 1);
        tableColumns.splice(toIndex, 0, itemToMove);
        saveColumnConfig(); renderHeaders(); updateGridStyles(); renderTable();
    }
    return false;
}
function handleDragEnd() { this.classList.remove('dragging'); document.querySelectorAll('.header-cell').forEach(col => col.classList.remove('dragging')); }

let startX, startWidth, resizerColIndex;
function initResize(e) { e.preventDefault(); e.stopPropagation(); const resizer = e.target; const headerCell = resizer.closest('.header-cell'); resizerColIndex = headerCell.dataset.index; startX = e.clientX; startWidth = headerCell.offsetWidth; document.documentElement.addEventListener('mousemove', doResize); document.documentElement.addEventListener('mouseup', stopResize); document.body.style.cursor = 'col-resize'; }
function doResize(e) { const newWidth = startWidth + (e.clientX - startX); if (newWidth > 50) { tableColumns[resizerColIndex].width = `${newWidth}px`; updateGridStyles(); } }
function stopResize() { document.documentElement.removeEventListener('mousemove', doResize); document.documentElement.removeEventListener('mouseup', stopResize); document.body.style.cursor = ''; saveColumnConfig(); }

// ============================================
// JOB BOARD - ARTIST APPLICATIONS VIEW
// ============================================

let myApplications = [];

function showApplicationsView() {
    // Hide main quotations content, show applications
    const mainContent = document.querySelector('main > *:not(#applications-view)');
    // Actually, let's hide everything in main except applications-view
    const mainEl = document.querySelector('main');
    Array.from(mainEl.children).forEach(child => {
        if (child.id === 'applications-view') {
            child.style.display = 'block';
        } else {
            child.style.display = 'none';
        }
    });

    // Update nav active states
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('is-active'));
    const navApp = document.getElementById('nav-applications');
    if (navApp) navApp.classList.add('is-active');

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

    // Reset nav
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('is-active'));
    const quotesNav = document.querySelector('a.nav-item[href="/my-quotations"]');
    if (quotesNav) quotesNav.classList.add('is-active');
}

// Make existing nav items restore quotations view
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-item:not(#nav-applications)').forEach(nav => {
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
        container.innerHTML = '<div style="text-align:center; padding:2rem;">Error al cargar postulaciones</div>';
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
