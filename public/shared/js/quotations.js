// ============================================
// WE OTZI - Quotations Admin Panel Logic
// Connected to Supabase quotations_db
// Uses shared-drawer.js for drawer functionality
// ============================================

// Supabase Configuration - Uses config-manager.js (provides window.CONFIG)
const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

// State - These are used by shared-drawer.js
let currentUser = null;
let artistData = null;
let quotations = [];
let filteredQuotations = [];
let selectedQuotes = new Set();
let allAttachments = [];
let allTattooStyles = [];

// Column Configuration (Updated V3)
const defaultColumns = [
    { id: 'select', label: '', width: '40px', field: 'select' },
    { id: 'created_at', label: 'DATE', width: '100px', field: 'created_at' },
    { id: 'id', label: 'ID', width: '80px', field: 'id' },
    { id: 'client', label: 'Client Entity', width: '2fr', field: 'client_full_name' },
    { id: 'location', label: 'CLIENT LOCATION', width: '1.5fr', field: 'client_city_residence' },
    { id: 'concept', label: 'Tattoo Concept', width: '2fr', field: 'tattoo_idea_description' },
    { id: 'timing', label: 'FECHA DESEADA', width: '1.5fr', field: 'client_preferred_date' },
    { id: 'value', label: 'Value', width: '100px', field: 'client_budget_amount' },
    { id: 'action', label: 'Action', width: '140px', field: 'action' }
];

// Force reset if using old column version
let tableColumns = JSON.parse(localStorage.getItem('wo_table_columns_v3')) || defaultColumns;

// Filters & Sorting State
let sortConfig = { field: 'created_at', direction: 'desc' };
let filterConfig = { status: 'all', search: '' };

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
            window.location.href = 'index.html';
            return;
        }

        currentUser = session.user;
        
        // 2. Load Artist Profile
        const { data: artist, error: artistError } = await _supabase
            .from('artists_db')
            .select('*')
            .eq('user_id', currentUser.id)
            .single();

        if (artistError || !artist) {
            console.error('Artist profile not found');
            window.location.href = 'dashboard.html';
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
    // Restore Theme
    const savedTheme = localStorage.getItem('weotzi-theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
    }

    // Restore Zoom
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
        // Fetch quotations and tattoo styles in parallel (excluding drafts/in_progress)
        const [quotesResult, stylesResult] = await Promise.all([
            _supabase
                .from('quotations_db')
                .select('*')
                .eq('artist_id', currentUser.id)
                .eq('is_archived', false)
                .neq('quote_status', 'in_progress'),
            _supabase
                .from('tattoo_styles')
                .select('*')
                .order('sort_order', { ascending: true })
        ]);

        if (quotesResult.error) throw quotesResult.error;
        quotations = quotesResult.data || [];

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
                const { data: attachments, error: attachError } = await _supabase
                    .from('quotations_attachments')
                    .select('*')
                    .in('quotation_id', quoteIds);
                
                if (attachError) throw attachError;
                allAttachments = attachments || [];
            }
        }

        applyFiltersAndSort();
        updateStats();

    } catch (err) {
        console.error('Error loading quotations:', err);
        document.getElementById('quotes-table-body').innerHTML = `<div style="padding: 2rem; text-align: center; color: var(--bauhaus-red);">ERROR_LOADING_DATA: ${err.message}</div>`;
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
    localStorage.setItem('wo_table_columns_v3', JSON.stringify(tableColumns));
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
        tbody.innerHTML = `<div style="padding: 3rem; text-align: center; font-family: 'Space Mono', monospace; opacity: 0.5;">NO_RECORDS_FOUND_MATCHING_CRITERIA</div>`;
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
        const value = displayAmount ? `${displayAmount} ${displayCurrency || ''}` : 'TBD';
        const isFinished = ['responded', 'completed', 'client_approved', 'client_rejected'].includes(quote.quote_status);
        const isSelected = selectedQuotes.has(quote.id.toString());

        const dataMap = {
            select: `<input type="checkbox" class="quote-checkbox" data-id="${quote.id}" ${isSelected ? 'checked' : ''} onclick="toggleSelect('${quote.id}', event)">`,
            created_at: `<span class="quote-date" style="font-family: 'Space Mono', monospace; font-size: 0.75rem;">${date}</span>`,
            id: `<span class="quote-id">#QN${id}</span>`,
            client: `
                <div class="client-cell">
                    <span class="client-name">${quote.client_full_name || 'Anonymous'}</span>
                    <span class="client-sub">${quote.client_age || '??'}yr • ${quote.client_instagram || '@not_provided'}</span>
                </div>
            `,
            location: `<div class="location-cell" style="font-size: 0.75rem; text-transform: uppercase;">${quote.client_city_residence || '-'}</div>`,
            concept: `
                <div class="tattoo-cell">
                    <span class="tattoo-idea">${quote.tattoo_idea_description || 'No description'}</span>
                    <span class="tattoo-specs">${quote.tattoo_body_part || 'TBD'} • ${getStyleDisplayName(quote.tattoo_style)}</span>
                </div>
            `,
            timing: `<div class="timing-cell"><span class="status-badge ${isFinished ? 'completed' : ''}">${quote.client_preferred_date || 'Flexible'}</span></div>`,
            value: `<div class="price-cell">${value}</div>`,
            action: `
                <button class="action-btn detail-btn" onclick="inspectQuote('${quote.id}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="margin-right: 5px;">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                    </svg>
                    DETALLES
                </button>
            `
        };

        const rowCells = tableColumns.map(col => dataMap[col.id] || `<div>-</div>`).join('');

        return `<div class="quote-row ${isSelected ? 'selected' : ''}" style="opacity: 0; transform: translateY(20px); transition: all 0.6s cubic-bezier(0.19, 1, 0.22, 1); transition-delay: ${index * 0.05}s">${rowCells}</div>`;
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
        document.getElementById('selection-count').textContent = `${selectedQuotes.size} selected`;
    } else bar.classList.remove('active');
}

window.bulkArchive = async function() {
    if (selectedQuotes.size === 0) return;
    const ids = Array.from(selectedQuotes);
    try {
        const { error } = await _supabase.from('quotations_db').update({ is_archived: true }).in('id', ids);
        if (error) throw error;
        selectedQuotes.clear();
        await loadQuotations();
    } catch (err) { alert('Error archiving: ' + err.message); }
};

window.bulkDelete = async function() {
    if (selectedQuotes.size === 0) return;
    if (!confirm(`Are you sure?`)) return;
    const ids = Array.from(selectedQuotes);
    try {
        const { error } = await _supabase.from('quotations_db').delete().in('id', ids);
        if (error) throw error;
        selectedQuotes.clear();
        await loadQuotations();
    } catch (err) { alert('Error deleting: ' + err.message); }
};

window.bulkUpdateStatus = async function(newStatus) {
    if (selectedQuotes.size === 0) return;
    const ids = Array.from(selectedQuotes);
    try {
        const { error } = await _supabase.from('quotations_db').update({ quote_status: newStatus }).in('id', ids);
        if (error) throw error;
        selectedQuotes.clear();
        await loadQuotations();
    } catch (err) { alert('Error updating status: ' + err.message); }
};

window.bulkArchiveSingle = async function(id) {
    selectedQuotes.clear();
    selectedQuotes.add(id.toString());
    await bulkArchive();
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
