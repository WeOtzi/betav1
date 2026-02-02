// ============================================
// WE OTZI - Support Dashboard
// Multi-table admin panel for support team
// Manages: Artists, Quotations, Feedback Tickets
// ============================================

// Supabase Configuration - Uses config-manager.js (provides window.CONFIG)
const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

// ============================================
// STATE MANAGEMENT
// ============================================

let currentUser = null;
let supportUser = null;
let activeTab = 'artists';

// Data stores
let artists = [];
let quotes = [];
let tickets = [];
let sessionLogs = [];

// Filtered data
let filteredData = [];

// Filter & Sort config
let filterConfig = { search: '', status: 'all' };
let sortConfig = { field: 'created_at', direction: 'desc' };

// Action management
let pendingAction = null;
let selectedRecord = null;

// Column configurations per tab
const columnConfigs = {
    artists: [
        { id: 'name', label: 'NAME', width: '2fr' },
        { id: 'username', label: 'USERNAME', width: '1.5fr' },
        { id: 'email', label: 'EMAIL', width: '2fr' },
        { id: 'verification', label: 'VERIFICATION', width: '1.2fr' },
        { id: 'embajador', label: 'AMBASSADOR', width: '1fr' },
        { id: 'action', label: 'ACTION', width: '120px' }
    ],
    quotes: [
        { id: 'date', label: 'DATE', width: '100px' },
        { id: 'id', label: 'ID', width: '80px' },
        { id: 'client', label: 'CLIENT', width: '2fr' },
        { id: 'artist', label: 'ARTIST', width: '1.5fr' },
        { id: 'location', label: 'LOCATION', width: '1.5fr' },
        { id: 'concept', label: 'CONCEPT', width: '2fr' },
        { id: 'status', label: 'STATUS', width: '1fr' },
        { id: 'action', label: 'ACTION', width: '120px' }
    ],
    tickets: [
        { id: 'date', label: 'DATE', width: '100px' },
        { id: 'id', label: 'ID', width: '80px' },
        { id: 'reason', label: 'REASON', width: '1.5fr' },
        { id: 'cause', label: 'CAUSE', width: '1.5fr' },
        { id: 'message', label: 'MESSAGE', width: '2fr' },
        { id: 'status', label: 'STATUS', width: '1fr' },
        { id: 'action', label: 'ACTION', width: '120px' }
    ],
    sessions: [
        { id: 'date', label: 'DATE', width: '100px' },
        { id: 'session_id', label: 'SESSION', width: '120px' },
        { id: 'user', label: 'USER', width: '2fr' },
        { id: 'page', label: 'PAGE', width: '2fr' },
        { id: 'entries', label: 'ENTRIES', width: '80px' },
        { id: 'errors', label: 'ERRORS', width: '80px' },
        { id: 'action', label: 'ACTION', width: '120px' }
    ]
};

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initializeSupportDashboard();
    restoreThemeAndZoom();
});

async function initializeSupportDashboard() {
    try {
        console.log('Initializing Support Dashboard...');
        console.log('Supabase URL:', supabaseUrl);
        
        // 1. Check authentication
        const { data: { session }, error: authError } = await _supabase.auth.getSession();
        
        if (authError) {
            console.error('Auth error:', authError);
            document.getElementById('status-indicator').textContent = 'STATUS: AUTH_ERROR';
            window.location.href = 'support-login.html';
            return;
        }
        
        if (!session) {
            console.log('No authenticated session. Redirecting to support login...');
            window.location.href = 'support-login.html';
            return;
        }

        currentUser = session.user;
        console.log('Authenticated as:', currentUser.email);

        // 2. Verify support user access
        const isAuthorized = await verifySupportAccess(currentUser.id);
        
        if (!isAuthorized) {
            console.log('User is not authorized as support');
            showUnauthorizedModal();
            return;
        }

        console.log('Support user verified:', supportUser.full_name, '| Role:', supportUser.role);

        // 3. Update UI with user info
        document.getElementById('logged-as').textContent = `LOGGED_AS: ${supportUser.full_name || currentUser.email.split('@')[0].toUpperCase()}`;
        document.getElementById('status-indicator').textContent = `STATUS: ONLINE | ROLE: ${supportUser.role.toUpperCase()}`;

        // 4. Setup UI
        setupSearchListener();
        renderFilters();
        renderHeaders();
        updateGridStyles();

        // 5. Load all data
        await loadAllData();

    } catch (err) {
        console.error('Initialization error:', err);
        document.getElementById('status-indicator').textContent = 'STATUS: ERROR - ' + err.message;
        document.getElementById('table-body').innerHTML = `
            <div class="empty-state" style="padding: 3rem;">
                <p style="color: var(--bauhaus-red); margin-bottom: 1rem;">ERROR_INITIALIZING: ${err.message}</p>
                <button class="action-btn" onclick="location.reload()">RELOAD PAGE</button>
            </div>
        `;
    }
}

async function verifySupportAccess(userId) {
    try {
        const { data, error } = await _supabase
            .from('support_users_db')
            .select('*')
            .eq('user_id', userId)
            .eq('is_active', true)
            .single();

        if (error || !data) {
            console.log('User is not a support user');
            return false;
        }

        supportUser = data;
        return true;
    } catch (err) {
        console.error('Error verifying support access:', err);
        return false;
    }
}

function showUnauthorizedModal() {
    document.getElementById('unauthorized-modal').style.display = 'flex';
}

// ============================================
// DATA LOADING
// ============================================

async function loadAllData() {
    try {
        console.log('Loading all data from Supabase...');
        const statusEl = document.getElementById('status-indicator');
        statusEl.textContent = 'STATUS: LOADING DATA...';
        
        const [artistsResult, quotesResult, ticketsResult, sessionsResult] = await Promise.all([
            _supabase.from('artists_db').select('*'),
            _supabase.from('quotations_db').select('*').order('created_at', { ascending: false }),
            _supabase.from('feedback_tickets').select('*').order('created_at', { ascending: false }),
            _supabase.from('session_logs').select('*').order('created_at', { ascending: false }).limit(500)
        ]);

        let errors = [];

        if (artistsResult.error) {
            console.error('Error loading artists:', artistsResult.error);
            errors.push(`Artists: ${artistsResult.error.message}`);
        } else {
            console.log(`Loaded ${artistsResult.data?.length || 0} artists`);
        }
        
        if (quotesResult.error) {
            console.error('Error loading quotes:', quotesResult.error);
            errors.push(`Quotes: ${quotesResult.error.message}`);
        } else {
            console.log(`Loaded ${quotesResult.data?.length || 0} quotes`);
        }
        
        if (ticketsResult.error) {
            console.error('Error loading tickets:', ticketsResult.error);
            errors.push(`Tickets: ${ticketsResult.error.message}`);
        } else {
            console.log(`Loaded ${ticketsResult.data?.length || 0} tickets`);
        }

        if (sessionsResult.error) {
            console.error('Error loading session logs:', sessionsResult.error);
            errors.push(`Sessions: ${sessionsResult.error.message}`);
        } else {
            console.log(`Loaded ${sessionsResult.data?.length || 0} session logs`);
        }

        artists = artistsResult.data || [];
        quotes = quotesResult.data || [];
        tickets = ticketsResult.data || [];
        sessionLogs = sessionsResult.data || [];

        if (errors.length > 0) {
            statusEl.textContent = `STATUS: ONLINE | ERRORS: ${errors.length}`;
        } else {
            statusEl.textContent = `STATUS: ONLINE | ROLE: ${supportUser?.role?.toUpperCase() || 'SUPPORT'}`;
        }

        updateStats();
        applyFiltersAndSort();
        
        console.log(`Data loaded - Artists: ${artists.length}, Quotes: ${quotes.length}, Tickets: ${tickets.length}, Sessions: ${sessionLogs.length}`);

    } catch (err) {
        console.error('Error loading data:', err);
        document.getElementById('table-body').innerHTML = `<div class="empty-state">ERROR_LOADING_DATA: ${err.message}</div>`;
        document.getElementById('status-indicator').textContent = 'STATUS: ERROR';
    }
}

// ============================================
// TAB MANAGEMENT
// ============================================

window.switchTab = function(tabName) {
    activeTab = tabName;
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    document.querySelectorAll('.nav-menu-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabName);
    });

    if (tabName === 'quotes') {
        filterConfig = { search: '', status: 'all', archived: 'all' };
    } else if (tabName === 'sessions') {
        filterConfig = { search: '', hasErrors: 'all' };
    } else {
        filterConfig = { search: '', status: 'all' };
    }
    document.getElementById('search-input').value = '';

    renderFilters();
    renderHeaders();
    updateGridStyles();
    applyFiltersAndSort();
};

window.updateSidebarActive = function(element) {
    document.querySelectorAll('.nav-menu-item').forEach(item => {
        item.classList.remove('active');
    });
    element.classList.add('active');
};

// ============================================
// FILTERS & SORTING
// ============================================

function setupSearchListener() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterConfig.search = e.target.value.toLowerCase();
            applyFiltersAndSort();
        });
    }
}

function renderFilters() {
    const filtersContainer = document.getElementById('toolbar-filters');
    let filtersHTML = '';
    
    if (activeTab === 'artists') {
        filtersHTML = `
            <select id="verification-filter" class="toolbar-select" style="border-color: var(--bauhaus-yellow);" onchange="handleFilterChange('verification', this.value)">
                <option value="all">ALL VERIFICATION</option>
                <option value="Yes">VERIFIED</option>
                <option value="No">NOT VERIFIED</option>
                <option value="Requested">REQUESTED</option>
                <option value="In Progress">IN PROGRESS</option>
            </select>
            <select id="embajador-filter" class="toolbar-select" style="border-color: var(--bauhaus-blue);" onchange="handleFilterChange('embajador', this.value)">
                <option value="all">ALL AMBASSADOR</option>
                <option value="si">AMBASSADOR</option>
                <option value="pendiente">PENDING</option>
                <option value="">NOT AMBASSADOR</option>
            </select>
        `;
    } else if (activeTab === 'quotes') {
        filtersHTML = `
            <select id="status-filter" class="toolbar-select" style="border-color: var(--bauhaus-yellow);" onchange="handleFilterChange('status', this.value)">
                <option value="all">ALL STATUS</option>
                <option value="pending">PENDING</option>
                <option value="responded">RESPONDED</option>
                <option value="client_approved">CLIENT APPROVED</option>
                <option value="client_rejected">CLIENT REJECTED</option>
                <option value="completed">COMPLETED</option>
            </select>
            <select id="archived-filter" class="toolbar-select" onchange="handleFilterChange('archived', this.value)">
                <option value="all">ALL</option>
                <option value="false">ACTIVE ONLY</option>
                <option value="true">ARCHIVED ONLY</option>
            </select>
        `;
    } else if (activeTab === 'tickets') {
        filtersHTML = `
            <select id="status-filter" class="toolbar-select" style="border-color: var(--bauhaus-yellow);" onchange="handleFilterChange('status', this.value)">
                <option value="all">ALL STATUS</option>
                <option value="open">OPEN</option>
                <option value="in-review">IN REVIEW</option>
                <option value="resolved">RESOLVED</option>
                <option value="closed">CLOSED</option>
            </select>
        `;
    } else if (activeTab === 'sessions') {
        filtersHTML = `
            <select id="errors-filter" class="toolbar-select" style="border-color: var(--bauhaus-red);" onchange="handleFilterChange('hasErrors', this.value)">
                <option value="all">ALL SESSIONS</option>
                <option value="true">WITH ERRORS</option>
                <option value="false">NO ERRORS</option>
            </select>
            <input type="text" id="user-search" class="toolbar-input" placeholder="Email/IP/Phone..." 
                style="width: 150px; margin-left: 0.5rem;"
                onchange="handleFilterChange('userSearch', this.value)">
        `;
    }

    filtersHTML += `
        <select id="sort-select" class="toolbar-select" onchange="handleSortChange(this.value)">
            <option value="created_at:desc">MOST RECENT</option>
            <option value="created_at:asc">OLDEST</option>
        </select>
    `;

    filtersContainer.innerHTML = filtersHTML;
}

window.handleFilterChange = function(filterType, value) {
    filterConfig[filterType] = value;
    applyFiltersAndSort();
};

window.handleSortChange = function(value) {
    const [field, direction] = value.split(':');
    sortConfig = { field, direction };
    applyFiltersAndSort();
};

function applyFiltersAndSort() {
    let data = [];
    
    if (activeTab === 'artists') {
        data = [...artists];
    } else if (activeTab === 'quotes') {
        data = [...quotes];
    } else if (activeTab === 'tickets') {
        data = [...tickets];
    } else if (activeTab === 'sessions') {
        data = [...sessionLogs];
    }

    if (filterConfig.search) {
        data = data.filter(item => {
            const searchStr = JSON.stringify(item).toLowerCase();
            return searchStr.includes(filterConfig.search);
        });
    }

    if (activeTab === 'artists') {
        if (filterConfig.verification && filterConfig.verification !== 'all') {
            data = data.filter(a => (a.verification_state || 'No') === filterConfig.verification);
        }
        if (filterConfig.embajador !== undefined && filterConfig.embajador !== 'all') {
            data = data.filter(a => (a.embajador || '') === filterConfig.embajador);
        }
    } else if (activeTab === 'quotes') {
        if (filterConfig.status && filterConfig.status !== 'all') {
            data = data.filter(q => q.quote_status === filterConfig.status);
        }
        if (filterConfig.archived && filterConfig.archived !== 'all') {
            const isArchived = filterConfig.archived === 'true';
            data = data.filter(q => q.is_archived === isArchived);
        }
    } else if (activeTab === 'tickets') {
        if (filterConfig.status && filterConfig.status !== 'all') {
            data = data.filter(t => (t.status || 'open') === filterConfig.status);
        }
    } else if (activeTab === 'sessions') {
        if (filterConfig.hasErrors && filterConfig.hasErrors !== 'all') {
            const hasErrors = filterConfig.hasErrors === 'true';
            data = data.filter(s => s.has_errors === hasErrors);
        }
        if (filterConfig.userSearch) {
            const search = filterConfig.userSearch.toLowerCase();
            data = data.filter(s => 
                (s.user_email && s.user_email.toLowerCase().includes(search)) ||
                (s.user_ip && s.user_ip.includes(search)) ||
                (s.user_phone && s.user_phone.includes(search)) ||
                (s.user_id && s.user_id.includes(search))
            );
        }
    }

    data.sort((a, b) => {
        let valA, valB;
        
        if (sortConfig.field === 'created_at') {
            valA = new Date(a.created_at).getTime();
            valB = new Date(b.created_at).getTime();
        } else {
            valA = a[sortConfig.field] || '';
            valB = b[sortConfig.field] || '';
        }

        if (sortConfig.direction === 'asc') return valA > valB ? 1 : -1;
        return valA < valB ? 1 : -1;
    });

    filteredData = data;
    renderTable();
}

// ============================================
// TABLE RENDERING
// ============================================

function renderHeaders() {
    const headerContainer = document.getElementById('table-header');
    const columns = columnConfigs[activeTab];
    
    headerContainer.innerHTML = columns.map(col => 
        `<div class="header-cell"><span>${col.label}</span></div>`
    ).join('');
}

function updateGridStyles() {
    const columns = columnConfigs[activeTab];
    const gridTemplate = columns.map(col => col.width).join(' ');
    document.getElementById('table-container').style.setProperty('--table-columns', gridTemplate);
}

function renderTable() {
    const tbody = document.getElementById('table-body');
    
    if (filteredData.length === 0) {
        tbody.innerHTML = `<div class="empty-state">NO_RECORDS_FOUND</div>`;
        return;
    }

    let rowsHTML = '';
    
    if (activeTab === 'artists') {
        rowsHTML = filteredData.map((artist, idx) => renderArtistRow(artist, idx)).join('');
    } else if (activeTab === 'quotes') {
        rowsHTML = filteredData.map((quote, idx) => renderQuoteRow(quote, idx)).join('');
    } else if (activeTab === 'tickets') {
        rowsHTML = filteredData.map((ticket, idx) => renderTicketRow(ticket, idx)).join('');
    } else if (activeTab === 'sessions') {
        rowsHTML = filteredData.map((session, idx) => renderSessionRow(session, idx)).join('');
    }

    tbody.innerHTML = rowsHTML;

    setTimeout(() => {
        document.querySelectorAll('.data-row').forEach(row => {
            row.style.opacity = '1';
            row.style.transform = 'translateY(0)';
        });
    }, 50);
}

function renderArtistRow(artist, index) {
    const name = artist.name || 'Sin nombre';
    const username = artist.username || '-';
    const email = artist.email || '-';
    const verification = artist.verification_state || 'No';
    const embajador = artist.embajador || '';

    return `
        <div class="quote-row data-row" style="opacity: 0; transform: translateY(20px); transition: all 0.4s; transition-delay: ${index * 0.03}s">
            <div class="client-cell"><span class="client-name">${name}</span></div>
            <div style="font-family: 'Space Mono'; font-size: 0.75rem; color: var(--bauhaus-blue);">@${username}</div>
            <div style="font-size: 0.8rem; word-break: break-all;">${email}</div>
            <div>${getVerificationBadge(verification)}</div>
            <div>${getEmbajadorBadge(embajador)}</div>
            <div><button class="action-btn detail-btn" onclick="inspectRecord('artists', '${artist.user_id}')">MANAGE</button></div>
        </div>
    `;
}

function renderQuoteRow(quote, index) {
    const date = new Date(quote.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
    const id = (quote.quote_id || quote.id.toString()).slice(-5).toUpperCase();
    const client = quote.client_full_name || 'Anonymous';
    const artistInfo = artists.find(a => a.user_id === quote.artist_id);
    const artistName = artistInfo ? artistInfo.name : '-';
    const concept = quote.tattoo_idea_description || 'No description';
    const status = quote.quote_status || 'pending';

    return `
        <div class="quote-row data-row" style="opacity: 0; transform: translateY(20px); transition: all 0.4s; transition-delay: ${index * 0.03}s">
            <div style="font-family: 'Space Mono'; font-size: 0.75rem;">${date}</div>
            <div style="font-family: 'Space Mono'; font-size: 0.75rem; color: var(--bauhaus-red);">#QN${id}</div>
            <div class="client-cell"><span class="client-name">${client}</span></div>
            <div style="font-size: 0.8rem;">${artistName}</div>
            <div style="font-size: 0.8rem; text-transform: uppercase;">${quote.client_city_residence || '-'}</div>
            <div style="font-size: 0.8rem; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${concept}</div>
            <div>${getQuoteStatusBadge(status)}</div>
            <div><button class="action-btn detail-btn" onclick="inspectRecord('quotes', '${quote.id}')">VIEW</button></div>
        </div>
    `;
}

function renderSessionRow(session, index) {
    const date = new Date(session.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
    const sessionId = session.session_id?.slice(-8) || '-';
    const userDisplay = session.user_email || session.user_ip || 'Anonymous';
    const pageUrl = session.page_url ? new URL(session.page_url).pathname : '-';
    const entries = session.log_entries_count || 0;
    const errors = session.error_count || 0;
    const hasErrors = session.has_errors;

    return `
        <div class="quote-row data-row" style="opacity: 0; transform: translateY(20px); transition: all 0.4s; transition-delay: ${index * 0.03}s">
            <div style="font-family: 'Space Mono'; font-size: 0.75rem;">${date}</div>
            <div style="font-family: 'Space Mono'; font-size: 0.7rem; color: var(--bauhaus-blue);">${sessionId}</div>
            <div style="font-size: 0.8rem; word-break: break-all; max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(userDisplay)}</div>
            <div style="font-size: 0.75rem; color: #888; max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(pageUrl)}</div>
            <div style="font-family: 'Space Mono'; font-size: 0.75rem; text-align: center;">${entries}</div>
            <div style="font-family: 'Space Mono'; font-size: 0.75rem; text-align: center; ${hasErrors ? 'color: var(--bauhaus-red); font-weight: bold;' : ''}">${errors}</div>
            <div><button class="action-btn detail-btn" onclick="inspectRecord('sessions', '${session.id}')">VIEW LOG</button></div>
        </div>
    `;
}

function renderTicketRow(ticket, index) {
    const date = new Date(ticket.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
    const id = ticket.id.toString().slice(-5).toUpperCase();
    const reason = ticket.reason || '-';
    const cause = ticket.cause || '-';
    const message = ticket.message || '-';
    const status = ticket.status || 'open';

    return `
        <div class="quote-row data-row" style="opacity: 0; transform: translateY(20px); transition: all 0.4s; transition-delay: ${index * 0.03}s">
            <div style="font-family: 'Space Mono'; font-size: 0.75rem;">${date}</div>
            <div style="font-family: 'Space Mono'; font-size: 0.75rem; color: var(--bauhaus-blue);">#TK${id}</div>
            <div style="font-size: 0.8rem; text-transform: uppercase;">${reason}</div>
            <div style="font-size: 0.8rem; text-transform: uppercase;">${cause}</div>
            <div style="font-size: 0.8rem; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${message}</div>
            <div>${getTicketStatusBadge(status)}</div>
            <div><button class="action-btn detail-btn" onclick="inspectRecord('tickets', '${ticket.id}')">VIEW</button></div>
        </div>
    `;
}

// ============================================
// STATUS BADGES
// ============================================

function getVerificationBadge(state) {
    const states = {
        'Yes': { text: 'VERIFIED', class: 'verified' },
        'No': { text: 'NOT VERIFIED', class: 'not-verified' },
        'Requested': { text: 'REQUESTED', class: 'requested' },
        'In Progress': { text: 'IN PROGRESS', class: 'in-progress' },
        'In Analysis': { text: 'IN ANALYSIS', class: 'in-analysis' },
        'Denied': { text: 'DENIED', class: 'denied' }
    };
    const config = states[state] || states['No'];
    return `<span class="status-badge ${config.class}">${config.text}</span>`;
}

function getEmbajadorBadge(embajador) {
    if (embajador === 'si') return '<span class="status-badge ambassador">AMBASSADOR</span>';
    if (embajador === 'pendiente') return '<span class="status-badge pending">PENDING</span>';
    return '<span class="status-badge none">NO</span>';
}

function getQuoteStatusBadge(status) {
    const states = {
        'pending': { text: 'PENDING', class: 'quote-pending' },
        'responded': { text: 'RESPONDED', class: 'quote-responded' },
        'client_approved': { text: 'CLIENT APPROVED', class: 'quote-completed' }, // Using completed style for now or add new class
        'client_rejected': { text: 'CLIENT REJECTED', class: 'quote-rejected' }, // Need to define this class
        'completed': { text: 'COMPLETED', class: 'quote-completed' }
    };
    const config = states[status] || states['pending'];
    // Fallback for unknown statuses
    if (!config) return `<span class="status-badge">${status}</span>`;
    
    // Inline styles for new statuses if classes don't exist in CSS
    let style = '';
    if (status === 'client_approved') style = 'background: #d4edda; color: #155724; border: 1px solid #c3e6cb;';
    if (status === 'client_rejected') style = 'background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb;';
    
    if (style) {
        return `<span class="status-badge" style="${style}">${config.text}</span>`;
    }
    
    return `<span class="status-badge ${config.class}">${config.text}</span>`;
}

function getTicketStatusBadge(status) {
    const states = {
        'open': { text: 'OPEN', class: 'open' },
        'in-review': { text: 'IN REVIEW', class: 'in-review' },
        'resolved': { text: 'RESOLVED', class: 'resolved' },
        'closed': { text: 'CLOSED', class: 'closed' }
    };
    const config = states[status] || states['open'];
    return `<span class="status-badge ${config.class}">${config.text}</span>`;
}

// ============================================
// STATS
// ============================================

function updateStats() {
    document.getElementById('stat-total-artists').textContent = artists.length;
    document.getElementById('stat-total-quotes').textContent = quotes.length;
    document.getElementById('stat-total-tickets').textContent = tickets.length;
    
    const pendingQuotes = quotes.filter(q => q.quote_status === 'pending' && !q.is_archived).length;
    const openTickets = tickets.filter(t => (t.status || 'open') === 'open').length;
    const pendingVerifications = artists.filter(a => a.verification_state === 'Requested' || a.verification_state === 'In Progress').length;
    
    document.getElementById('stat-pending').textContent = pendingQuotes + openTickets + pendingVerifications;
}

// ============================================
// RECORD INSPECTION
// ============================================

window.inspectRecord = function(type, id) {
    let record = null;
    
    if (type === 'artists') {
        record = artists.find(a => a.user_id === id);
    } else if (type === 'quotes') {
        record = quotes.find(q => q.id.toString() === id.toString());
    } else if (type === 'tickets') {
        record = tickets.find(t => t.id.toString() === id.toString());
    } else if (type === 'sessions') {
        record = sessionLogs.find(s => s.id.toString() === id.toString());
    }
    
    if (!record) return;
    
    selectedRecord = { type, id, data: record };
    const drawerContent = document.getElementById('drawer-content');
    
    if (type === 'artists') {
        drawerContent.innerHTML = renderArtistDrawer(record);
    } else if (type === 'quotes') {
        drawerContent.innerHTML = renderQuoteDrawer(record);
    } else if (type === 'tickets') {
        drawerContent.innerHTML = renderTicketDrawer(record);
    } else if (type === 'sessions') {
        drawerContent.innerHTML = renderSessionDrawer(record);
    }
    
    document.getElementById('drawer-toggle').checked = true;
};

function renderArtistDrawer(artist) {
    const formatDate = (dateStr) => dateStr ? new Date(dateStr).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
    const formatDateTime = (dateStr) => dateStr ? new Date(dateStr).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
    const formatLanguages = (langs) => {
        if (!langs) return '-';
        if (Array.isArray(langs)) return langs.join(', ');
        return langs;
    };
    
    return `
        <div class="shape-decor"></div>
        <p style="font-family: 'Space Mono'; font-size: 0.7rem; color: var(--bauhaus-red);">ARTIST_ID: ${artist.user_id.slice(0, 12)}...</p>
        <h2 style="font-weight: 900; font-size: 1.6rem; margin: 1rem 0;">${artist.name || 'Sin nombre'}</h2>
        
        <!-- Section: Basic Information -->
        <div class="drawer-section">
            <div class="drawer-section-title">Basic Information</div>
            <div class="drawer-form-group">
                <label>Full Name</label>
                <input type="text" value="${escapeHtml(artist.name || '')}" onchange="updateArtistField('${artist.user_id}', 'name', this.value)">
            </div>
            <div class="drawer-form-group">
                <label>Username</label>
                <input type="text" value="${escapeHtml(artist.username || '')}" onchange="updateArtistField('${artist.user_id}', 'username', this.value)">
            </div>
            <div class="drawer-form-group">
                <label>Email</label>
                <input type="email" value="${escapeHtml(artist.email || '')}" onchange="updateArtistField('${artist.user_id}', 'email', this.value)">
            </div>
            <div class="drawer-form-group">
                <label>Birth Date</label>
                <input type="date" value="${artist.birth_date || ''}" onchange="updateArtistField('${artist.user_id}', 'birth_date', this.value)">
            </div>
            <div class="drawer-form-group">
                <label>Profile Picture URL</label>
                <input type="url" value="${escapeHtml(artist.profile_picture || '')}" onchange="updateArtistField('${artist.user_id}', 'profile_picture', this.value)">
                ${artist.profile_picture ? `<a href="${artist.profile_picture}" target="_blank" class="field-link">View Image</a>` : ''}
            </div>
        </div>
        
        <!-- Section: Contact & Social -->
        <div class="drawer-section" style="background: #f0f8ff;">
            <div class="drawer-section-title">Contact & Social</div>
            <div class="drawer-form-group">
                <label>Instagram</label>
                <input type="text" value="${escapeHtml(artist.instagram || '')}" onchange="updateArtistField('${artist.user_id}', 'instagram', this.value)" placeholder="@username or URL">
            </div>
            <div class="drawer-form-group">
                <label>WhatsApp Number</label>
                <input type="text" value="${escapeHtml(artist.whatsapp_number || '')}" onchange="updateArtistField('${artist.user_id}', 'whatsapp_number', this.value)" placeholder="+1234567890">
            </div>
            <div class="drawer-form-group">
                <label>WhatsApp URL</label>
                <input type="text" value="${escapeHtml(artist.whatsapp_url || '')}" class="readonly-field" readonly>
            </div>
            <div class="drawer-form-group">
                <label>Portfolio URL</label>
                <input type="url" value="${escapeHtml(artist.portafolio || '')}" onchange="updateArtistField('${artist.user_id}', 'portafolio', this.value)">
                ${artist.portafolio ? `<a href="${artist.portafolio}" target="_blank" class="field-link">Open Portfolio</a>` : ''}
            </div>
        </div>
        
        <!-- Section: Location -->
        <div class="drawer-section">
            <div class="drawer-section-title">Location</div>
            <div class="drawer-form-group">
                <label>Full Address</label>
                <input type="text" value="${escapeHtml(artist.ubicacion || '')}" onchange="updateArtistField('${artist.user_id}', 'ubicacion', this.value)">
            </div>
            <div class="info-grid">
                <div class="drawer-form-group">
                    <label>City</label>
                    <input type="text" value="${escapeHtml(artist.city || '')}" onchange="updateArtistField('${artist.user_id}', 'city', this.value)">
                </div>
                <div class="drawer-form-group">
                    <label>Country</label>
                    <input type="text" value="${escapeHtml(artist.country || '')}" onchange="updateArtistField('${artist.user_id}', 'country', this.value)">
                </div>
            </div>
        </div>
        
        <!-- Section: Professional -->
        <div class="drawer-section" style="background: #fffaf0;">
            <div class="drawer-section-title">Professional Information</div>
            <div class="drawer-form-group">
                <label>Studio</label>
                <input type="text" value="${escapeHtml(artist.estudios || '')}" onchange="updateArtistField('${artist.user_id}', 'estudios', this.value)" placeholder="Sin estudio/Independiente">
            </div>
            <div class="info-grid">
                <div class="drawer-form-group">
                    <label>Session Price</label>
                    <input type="text" value="${escapeHtml(artist.session_price || '')}" onchange="updateArtistField('${artist.user_id}', 'session_price', this.value)" placeholder="150 USD">
                </div>
                <div class="drawer-form-group">
                    <label>Years Experience</label>
                    <input type="text" value="${escapeHtml(artist.years_experience || '')}" onchange="updateArtistField('${artist.user_id}', 'years_experience', this.value)">
                </div>
            </div>
            <div class="drawer-form-group">
                <label>Styles (comma-separated)</label>
                <input type="text" value="${escapeHtml(artist.estilo || '')}" onchange="updateArtistField('${artist.user_id}', 'estilo', this.value)" placeholder="Realismo, Tradicional, Blackwork">
            </div>
            <div class="drawer-form-group">
                <label>Bio Description</label>
                <textarea rows="4" onchange="updateArtistField('${artist.user_id}', 'bio_description', this.value)">${escapeHtml(artist.bio_description || '')}</textarea>
            </div>
            <div class="drawer-form-group">
                <label>Languages</label>
                <input type="text" value="${formatLanguages(artist.languages)}" class="readonly-field" readonly>
            </div>
        </div>
        
        <!-- Section: Status & Flags -->
        <div class="drawer-section" style="background: #f9f9f9;">
            <div class="drawer-section-title">Status & Flags</div>
            <div class="drawer-form-group">
                <label>Verification Status</label>
                <div style="margin-bottom: 0.75rem;">${getVerificationBadge(artist.verification_state || 'No')}</div>
                <select onchange="updateArtistField('${artist.user_id}', 'verification_state', this.value)">
                    <option value="No" ${artist.verification_state === 'No' || !artist.verification_state ? 'selected' : ''}>NOT VERIFIED</option>
                    <option value="Requested" ${artist.verification_state === 'Requested' ? 'selected' : ''}>REQUESTED</option>
                    <option value="In Progress" ${artist.verification_state === 'In Progress' ? 'selected' : ''}>IN PROGRESS</option>
                    <option value="In Analysis" ${artist.verification_state === 'In Analysis' ? 'selected' : ''}>IN ANALYSIS</option>
                    <option value="Yes" ${artist.verification_state === 'Yes' ? 'selected' : ''}>VERIFIED</option>
                    <option value="Denied" ${artist.verification_state === 'Denied' ? 'selected' : ''}>DENIED</option>
                    <option value="Canceled" ${artist.verification_state === 'Canceled' ? 'selected' : ''}>CANCELED</option>
                </select>
            </div>
            <div class="drawer-form-group">
                <label>Ambassador Status</label>
                <div style="margin-bottom: 0.75rem;">${getEmbajadorBadge(artist.embajador || '')}</div>
                <select onchange="updateArtistField('${artist.user_id}', 'embajador', this.value)">
                    <option value="" ${!artist.embajador ? 'selected' : ''}>NO</option>
                    <option value="pendiente" ${artist.embajador === 'pendiente' ? 'selected' : ''}>PENDING</option>
                    <option value="si" ${artist.embajador === 'si' ? 'selected' : ''}>AMBASSADOR</option>
                </select>
            </div>
            <div class="checkbox-row">
                <label class="checkbox-label">
                    <input type="checkbox" ${artist.is_recommended ? 'checked' : ''} onchange="updateArtistField('${artist.user_id}', 'is_recommended', this.checked)">
                    <span>Is Recommended (Seleccion Otzi)</span>
                </label>
            </div>
            <div class="checkbox-row">
                <label class="checkbox-label">
                    <input type="checkbox" ${artist.subscribed_newsletter ? 'checked' : ''} onchange="updateArtistField('${artist.user_id}', 'subscribed_newsletter', this.checked)">
                    <span>Subscribed to Newsletter</span>
                </label>
            </div>
        </div>
        
        <!-- Section: Vacation -->
        <div class="drawer-section">
            <div class="drawer-section-title">Vacation Period</div>
            <div class="info-grid">
                <div class="drawer-form-group">
                    <label>Vacation Start</label>
                    <input type="date" value="${artist.vacation_start || ''}" onchange="updateArtistField('${artist.user_id}', 'vacation_start', this.value || null)">
                </div>
                <div class="drawer-form-group">
                    <label>Vacation End</label>
                    <input type="date" value="${artist.vacation_end || ''}" onchange="updateArtistField('${artist.user_id}', 'vacation_end', this.value || null)">
                </div>
            </div>
        </div>
        
        <!-- Section: Index & Metrics (Read-only) -->
        <div class="drawer-section" style="background: #f5f5f5;">
            <div class="drawer-section-title">Index & Metrics</div>
            <div class="info-grid">
                <div class="info-block">
                    <label>Artist Index</label>
                    <p class="metric-value">${artist.artist_index ?? '-'}</p>
                </div>
                <div class="info-block">
                    <label>Profile Completeness</label>
                    <p class="metric-value">${artist.profile_completeness ? artist.profile_completeness + '%' : '-'}</p>
                </div>
            </div>
            <div class="info-block">
                <label>Index Updated At</label>
                <p>${formatDateTime(artist.index_updated_at)}</p>
            </div>
        </div>
        
        <!-- Section: Admin -->
        <div class="drawer-section" style="background: #fff0f0;">
            <div class="drawer-section-title">Admin Information</div>
            <div class="drawer-form-group">
                <label>Temporary Password</label>
                <input type="text" value="${escapeHtml(artist.password || '')}" onchange="updateArtistField('${artist.user_id}', 'password', this.value)">
            </div>
            <div class="info-block">
                <label>User ID</label>
                <p class="monospace-text">${artist.user_id}</p>
            </div>
            <div class="info-grid">
                <div class="info-block">
                    <label>Created At</label>
                    <p>${formatDateTime(artist.created_at)}</p>
                </div>
                <div class="info-block">
                    <label>Updated At</label>
                    <p>${formatDateTime(artist.updated_at)}</p>
                </div>
            </div>
        </div>
        
        <div class="drawer-actions">
            <button class="action-btn delete-btn" onclick="deleteRecord('artists', '${artist.user_id}')">DELETE ARTIST</button>
        </div>
    `;
}

// Helper function to escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderQuoteDrawer(quote) {
    const artistInfo = artists.find(a => a.user_id === quote.artist_id);
    const formatDate = (dateStr) => dateStr ? new Date(dateStr).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
    const formatDateTime = (dateStr) => dateStr ? new Date(dateStr).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
    const formatStyles = (styles) => {
        if (!styles) return '-';
        if (Array.isArray(styles)) return styles.join(', ');
        return styles;
    };
    
    return `
        <div class="shape-decor"></div>
        <p style="font-family: 'Space Mono'; font-size: 0.7rem; color: var(--bauhaus-red);">QUOTE_ID: #QN${(quote.quote_id || quote.id.toString()).slice(-5).toUpperCase()}</p>
        <h2 style="font-weight: 900; font-size: 1.6rem; margin: 1rem 0;">${escapeHtml(quote.client_full_name) || 'Anonymous'}</h2>
        
        <!-- Section: Quote Info -->
        <div class="drawer-section" style="background: #fffbf0;">
            <div class="drawer-section-title">Quote Information</div>
            <div class="info-grid">
                <div class="info-block">
                    <label>Quote ID</label>
                    <p class="monospace-text">${quote.quote_id || quote.id}</p>
                </div>
                <div class="drawer-form-group">
                    <label>Status</label>
                    <div style="margin-bottom: 0.5rem;">${getQuoteStatusBadge(quote.quote_status || 'pending')}</div>
                    <select onchange="updateQuoteField('${quote.id}', 'quote_status', this.value)">
                        <option value="pending" ${quote.quote_status === 'pending' || !quote.quote_status ? 'selected' : ''}>PENDING</option>
                        <option value="responded" ${quote.quote_status === 'responded' ? 'selected' : ''}>RESPONDED</option>
                        <option value="client_approved" ${quote.quote_status === 'client_approved' ? 'selected' : ''}>CLIENT APPROVED</option>
                        <option value="client_rejected" ${quote.quote_status === 'client_rejected' ? 'selected' : ''}>CLIENT REJECTED</option>
                        <option value="completed" ${quote.quote_status === 'completed' ? 'selected' : ''}>COMPLETED</option>
                    </select>
                </div>
            </div>
            <div class="info-grid">
                <div class="drawer-form-group">
                    <label>Priority</label>
                    <select onchange="updateQuoteField('${quote.id}', 'priority', this.value)">
                        <option value="" ${!quote.priority ? 'selected' : ''}>NOT SET</option>
                        <option value="low" ${quote.priority === 'low' ? 'selected' : ''}>LOW</option>
                        <option value="medium" ${quote.priority === 'medium' ? 'selected' : ''}>MEDIUM</option>
                        <option value="high" ${quote.priority === 'high' ? 'selected' : ''}>HIGH</option>
                        <option value="critical" ${quote.priority === 'critical' ? 'selected' : ''}>CRITICAL</option>
                    </select>
                </div>
                <div class="checkbox-row" style="padding-top: 1.5rem;">
                    <label class="checkbox-label">
                        <input type="checkbox" ${quote.is_archived ? 'checked' : ''} onchange="updateQuoteField('${quote.id}', 'is_archived', this.checked)">
                        <span>Is Archived</span>
                    </label>
                </div>
            </div>
            <div class="info-grid">
                <div class="info-block">
                    <label>Created At</label>
                    <p>${formatDateTime(quote.created_at)}</p>
                </div>
                <div class="info-block">
                    <label>Updated At</label>
                    <p>${formatDateTime(quote.updated_at)}</p>
                </div>
            </div>
        </div>
        
        <!-- Section: Client Information -->
        <div class="drawer-section">
            <div class="drawer-section-title">Client Information</div>
            <div class="drawer-form-group">
                <label>Full Name</label>
                <input type="text" value="${escapeHtml(quote.client_full_name || '')}" onchange="updateQuoteField('${quote.id}', 'client_full_name', this.value)">
            </div>
            <div class="info-grid">
                <div class="drawer-form-group">
                    <label>Email</label>
                    <input type="email" value="${escapeHtml(quote.client_email || '')}" onchange="updateQuoteField('${quote.id}', 'client_email', this.value)">
                </div>
                <div class="drawer-form-group">
                    <label>WhatsApp</label>
                    <input type="text" value="${escapeHtml(quote.client_whatsapp || '')}" onchange="updateQuoteField('${quote.id}', 'client_whatsapp', this.value)">
                </div>
            </div>
            <div class="info-grid">
                <div class="drawer-form-group">
                    <label>Instagram</label>
                    <input type="text" value="${escapeHtml(quote.client_instagram || '')}" onchange="updateQuoteField('${quote.id}', 'client_instagram', this.value)">
                </div>
                <div class="drawer-form-group">
                    <label>Contact Preference</label>
                    <input type="text" value="${escapeHtml(quote.client_contact_preference || '')}" onchange="updateQuoteField('${quote.id}', 'client_contact_preference', this.value)">
                </div>
            </div>
            <div class="info-grid">
                <div class="drawer-form-group">
                    <label>Birth Date</label>
                    <input type="date" value="${quote.client_birth_date || ''}" onchange="updateQuoteField('${quote.id}', 'client_birth_date', this.value)">
                </div>
                <div class="drawer-form-group">
                    <label>Age</label>
                    <input type="text" value="${escapeHtml(quote.client_age || '')}" onchange="updateQuoteField('${quote.id}', 'client_age', this.value)">
                </div>
            </div>
        </div>
        
        <!-- Section: Client Location -->
        <div class="drawer-section" style="background: #f0fff0;">
            <div class="drawer-section-title">Client Location</div>
            <div class="info-grid">
                <div class="drawer-form-group">
                    <label>City of Residence</label>
                    <input type="text" value="${escapeHtml(quote.client_city_residence || '')}" onchange="updateQuoteField('${quote.id}', 'client_city_residence', this.value)">
                </div>
                <div class="drawer-form-group">
                    <label>Preferred City for Tattoo</label>
                    <input type="text" value="${escapeHtml(quote.client_city_tattoo_preference || '')}" onchange="updateQuoteField('${quote.id}', 'client_city_tattoo_preference', this.value)">
                </div>
            </div>
            <div class="checkbox-row">
                <label class="checkbox-label">
                    <input type="checkbox" ${quote.client_travel_willing ? 'checked' : ''} onchange="updateQuoteField('${quote.id}', 'client_travel_willing', this.checked)">
                    <span>Willing to Travel</span>
                </label>
            </div>
        </div>
        
        <!-- Section: Client Budget & Schedule -->
        <div class="drawer-section">
            <div class="drawer-section-title">Client Budget & Schedule</div>
            <div class="info-grid">
                <div class="drawer-form-group">
                    <label>Budget Amount</label>
                    <input type="text" value="${escapeHtml(quote.client_budget_amount || '')}" onchange="updateQuoteField('${quote.id}', 'client_budget_amount', this.value)">
                </div>
                <div class="drawer-form-group">
                    <label>Budget Currency</label>
                    <input type="text" value="${escapeHtml(quote.client_budget_currency || '')}" onchange="updateQuoteField('${quote.id}', 'client_budget_currency', this.value)">
                </div>
            </div>
            <div class="info-grid">
                <div class="drawer-form-group">
                    <label>Preferred Date</label>
                    <input type="text" value="${escapeHtml(quote.client_preferred_date || '')}" onchange="updateQuoteField('${quote.id}', 'client_preferred_date', this.value)">
                </div>
                <div class="checkbox-row" style="padding-top: 1.5rem;">
                    <label class="checkbox-label">
                        <input type="checkbox" ${quote.client_flexible_dates ? 'checked' : ''} onchange="updateQuoteField('${quote.id}', 'client_flexible_dates', this.checked)">
                        <span>Flexible Dates</span>
                    </label>
                </div>
            </div>
        </div>
        
        <!-- Section: Client Health -->
        <div class="drawer-section" style="background: #fff0f5;">
            <div class="drawer-section-title">Client Health Information</div>
            <div class="drawer-form-group">
                <label>Health Conditions</label>
                <textarea rows="2" onchange="updateQuoteField('${quote.id}', 'client_health_conditions', this.value)">${escapeHtml(quote.client_health_conditions || '')}</textarea>
            </div>
            <div class="drawer-form-group">
                <label>Allergies</label>
                <textarea rows="2" onchange="updateQuoteField('${quote.id}', 'client_allergies', this.value)">${escapeHtml(quote.client_allergies || '')}</textarea>
            </div>
        </div>
        
        <!-- Section: Artist Snapshot (Read-only) -->
        <div class="drawer-section" style="background: #f0f4ff;">
            <div class="drawer-section-title">Artist Snapshot (at quote creation)</div>
            <div class="info-grid">
                <div class="info-block">
                    <label>Artist Name</label>
                    <p>${escapeHtml(quote.artist_name) || '-'}</p>
                </div>
                <div class="info-block">
                    <label>Artist Email</label>
                    <p>${escapeHtml(quote.artist_email) || '-'}</p>
                </div>
            </div>
            <div class="info-grid">
                <div class="info-block">
                    <label>Artist Instagram</label>
                    <p>${escapeHtml(quote.artist_instagram) || '-'}</p>
                </div>
                <div class="info-block">
                    <label>Artist City</label>
                    <p>${escapeHtml(quote.artist_current_city) || '-'}</p>
                </div>
            </div>
            <div class="info-grid">
                <div class="info-block">
                    <label>Studio Name</label>
                    <p>${escapeHtml(quote.artist_studio_name) || '-'}</p>
                </div>
                <div class="info-block">
                    <label>Session Cost</label>
                    <p>${quote.artist_session_cost_amount || '-'} ${quote.artist_session_cost_currency || ''}</p>
                </div>
            </div>
            <div class="info-block">
                <label>Artist Styles</label>
                <p>${formatStyles(quote.artist_styles)}</p>
            </div>
            <div class="checkbox-row">
                <label class="checkbox-label">
                    <input type="checkbox" ${quote.artist_confirmed ? 'checked' : ''} onchange="updateQuoteField('${quote.id}', 'artist_confirmed', this.checked)">
                    <span>Artist Confirmed</span>
                </label>
            </div>
            ${artistInfo ? `<a href="#" onclick="inspectRecord('artists', '${artistInfo.user_id}'); return false;" class="field-link">View Current Artist Profile</a>` : ''}
        </div>
        
        <!-- Section: Tattoo Details -->
        <div class="drawer-section">
            <div class="drawer-section-title">Tattoo Details</div>
            <div class="drawer-form-group">
                <label>Idea Description</label>
                <textarea rows="4" onchange="updateQuoteField('${quote.id}', 'tattoo_idea_description', this.value)">${escapeHtml(quote.tattoo_idea_description || '')}</textarea>
            </div>
            <div class="info-grid">
                <div class="drawer-form-group">
                    <label>Body Part</label>
                    <input type="text" value="${escapeHtml(quote.tattoo_body_part || '')}" onchange="updateQuoteField('${quote.id}', 'tattoo_body_part', this.value)">
                </div>
                <div class="drawer-form-group">
                    <label>Body Side</label>
                    <input type="text" value="${escapeHtml(quote.tattoo_body_side || '')}" onchange="updateQuoteField('${quote.id}', 'tattoo_body_side', this.value)">
                </div>
            </div>
            <div class="info-grid">
                <div class="drawer-form-group">
                    <label>Size</label>
                    <input type="text" value="${escapeHtml(quote.tattoo_size || '')}" onchange="updateQuoteField('${quote.id}', 'tattoo_size', this.value)">
                </div>
                <div class="drawer-form-group">
                    <label>Style</label>
                    <input type="text" value="${escapeHtml(quote.tattoo_style || '')}" onchange="updateQuoteField('${quote.id}', 'tattoo_style', this.value)">
                </div>
            </div>
            <div class="info-grid">
                <div class="drawer-form-group">
                    <label>Color Type</label>
                    <input type="text" value="${escapeHtml(quote.tattoo_color_type || '')}" onchange="updateQuoteField('${quote.id}', 'tattoo_color_type', this.value)">
                </div>
                <div class="drawer-form-group">
                    <label>Reference Images Count</label>
                    <input type="number" value="${quote.reference_images_count || 0}" onchange="updateQuoteField('${quote.id}', 'reference_images_count', parseInt(this.value))">
                </div>
            </div>
            <div class="drawer-form-group">
                <label>References</label>
                <textarea rows="2" onchange="updateQuoteField('${quote.id}', 'tattoo_references', this.value)">${escapeHtml(quote.tattoo_references || '')}</textarea>
            </div>
        </div>
        
        <!-- Section: Tattoo Flags -->
        <div class="drawer-section" style="background: #f5f5f5;">
            <div class="drawer-section-title">Tattoo Flags & Budget</div>
            <div class="checkbox-row">
                <label class="checkbox-label">
                    <input type="checkbox" ${quote.tattoo_is_first_tattoo ? 'checked' : ''} onchange="updateQuoteField('${quote.id}', 'tattoo_is_first_tattoo', this.checked)">
                    <span>Is First Tattoo</span>
                </label>
            </div>
            <div class="checkbox-row">
                <label class="checkbox-label">
                    <input type="checkbox" ${quote.tattoo_is_cover_up ? 'checked' : ''} onchange="updateQuoteField('${quote.id}', 'tattoo_is_cover_up', this.checked)">
                    <span>Is Cover Up</span>
                </label>
            </div>
            <div class="info-grid" style="margin-top: 1rem;">
                <div class="drawer-form-group">
                    <label>Artist Session Cost Amount</label>
                    <input type="text" value="${escapeHtml(quote.artist_session_cost_amount || '')}" onchange="updateQuoteField('${quote.id}', 'artist_session_cost_amount', this.value)">
                </div>
                <div class="drawer-form-group">
                    <label>Artist Session Cost Currency</label>
                    <input type="text" value="${escapeHtml(quote.artist_session_cost_currency || '')}" onchange="updateQuoteField('${quote.id}', 'artist_session_cost_currency', this.value)">
                </div>
            </div>
            <div class="drawer-form-group">
                <label>Estimated Sessions</label>
                <input type="text" value="${escapeHtml(quote.tattoo_estimated_sessions || '')}" onchange="updateQuoteField('${quote.id}', 'tattoo_estimated_sessions', this.value)">
            </div>
        </div>
        
        <!-- Section: Mismatch Flags -->
        <div class="drawer-section" style="background: #fffaf0;">
            <div class="drawer-section-title">Mismatch Acknowledgments</div>
            <div class="checkbox-row">
                <label class="checkbox-label">
                    <input type="checkbox" ${quote.city_mismatch_acknowledged ? 'checked' : ''} onchange="updateQuoteField('${quote.id}', 'city_mismatch_acknowledged', this.checked)">
                    <span>City Mismatch Acknowledged</span>
                </label>
            </div>
            <div class="checkbox-row">
                <label class="checkbox-label">
                    <input type="checkbox" ${quote.style_mismatch_acknowledged ? 'checked' : ''} onchange="updateQuoteField('${quote.id}', 'style_mismatch_acknowledged', this.checked)">
                    <span>Style Mismatch Acknowledged</span>
                </label>
            </div>
        </div>
        
        <!-- Section: Pipeline Tracking -->
        <div class="drawer-section" style="background: #f0f0f0;">
            <div class="drawer-section-title">Pipeline Tracking</div>
            <div class="info-grid">
                <div class="info-block">
                    <label>Sent to Artist At</label>
                    <p>${formatDateTime(quote.sent_to_artist_at)}</p>
                </div>
                <div class="info-block">
                    <label>Artist Responded At</label>
                    <p>${formatDateTime(quote.artist_responded_at)}</p>
                </div>
            </div>
        </div>
        
        <!-- Section: Rating (Support Use) -->
        <div class="drawer-section" style="background: #fff5e6;">
            <div class="drawer-section-title">Rating (Support Use)</div>
            <div class="info-grid">
                <div class="drawer-form-group">
                    <label>Rating</label>
                    <input type="number" min="1" max="5" value="${quote.rating || ''}" onchange="updateQuoteField('${quote.id}', 'rating', this.value ? parseInt(this.value) : null)">
                </div>
                <div class="drawer-form-group">
                    <label>Rating Reason</label>
                    <input type="text" value="${escapeHtml(quote.rating_reason || '')}" onchange="updateQuoteField('${quote.id}', 'rating_reason', this.value)">
                </div>
            </div>
            <div class="drawer-form-group">
                <label>Rating Comment</label>
                <textarea rows="2" onchange="updateQuoteField('${quote.id}', 'rating_comment', this.value)">${escapeHtml(quote.rating_comment || '')}</textarea>
            </div>
        </div>
        
        <div class="drawer-actions">
            <button class="action-btn delete-btn" onclick="deleteRecord('quotes', '${quote.id}')">DELETE QUOTE</button>
        </div>
    `;
}

function renderTicketDrawer(ticket) {
    const formatDateTime = (dateStr) => dateStr ? new Date(dateStr).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
    
    // Lookup user info from artists if user_id exists
    const userInfo = ticket.user_id ? artists.find(a => a.user_id === ticket.user_id) : null;
    
    // Parse metadata
    const metadata = ticket.metadata || {};
    
    return `
        <div class="shape-decor"></div>
        <p style="font-family: 'Space Mono'; font-size: 0.7rem; color: var(--bauhaus-blue);">TICKET_ID: #TK${ticket.id.toString().slice(-5).toUpperCase()}</p>
        <h2 style="font-weight: 900; font-size: 1.6rem; margin: 1rem 0; text-transform: uppercase;">${escapeHtml(ticket.reason) || 'Feedback'}</h2>
        
        <!-- Section: Ticket Info -->
        <div class="drawer-section" style="background: #f0f4ff;">
            <div class="drawer-section-title">Ticket Information</div>
            <div class="info-block">
                <label>Ticket ID</label>
                <p class="monospace-text">${ticket.id}</p>
            </div>
            <div class="drawer-form-group">
                <label>Status</label>
                <div style="margin-bottom: 0.5rem;">${getTicketStatusBadge(ticket.status || 'open')}</div>
                <select onchange="updateTicketField('${ticket.id}', 'status', this.value)">
                    <option value="open" ${(ticket.status || 'open') === 'open' ? 'selected' : ''}>OPEN</option>
                    <option value="in-review" ${ticket.status === 'in-review' ? 'selected' : ''}>IN REVIEW</option>
                    <option value="resolved" ${ticket.status === 'resolved' ? 'selected' : ''}>RESOLVED</option>
                    <option value="closed" ${ticket.status === 'closed' ? 'selected' : ''}>CLOSED</option>
                </select>
            </div>
            <div class="info-grid">
                <div class="drawer-form-group">
                    <label>Reason</label>
                    <select onchange="updateTicketField('${ticket.id}', 'reason', this.value)">
                        <option value="error" ${ticket.reason === 'error' ? 'selected' : ''}>ERROR</option>
                        <option value="sugerencia" ${ticket.reason === 'sugerencia' ? 'selected' : ''}>SUGERENCIA</option>
                        <option value="pregunta" ${ticket.reason === 'pregunta' ? 'selected' : ''}>PREGUNTA</option>
                        <option value="otro" ${ticket.reason === 'otro' || !ticket.reason ? 'selected' : ''}>OTRO</option>
                    </select>
                </div>
                <div class="drawer-form-group">
                    <label>Cause / Area</label>
                    <select onchange="updateTicketField('${ticket.id}', 'cause', this.value)">
                        <option value="registro" ${ticket.cause === 'registro' ? 'selected' : ''}>REGISTRO</option>
                        <option value="perfil" ${ticket.cause === 'perfil' ? 'selected' : ''}>PERFIL</option>
                        <option value="dashboard" ${ticket.cause === 'dashboard' ? 'selected' : ''}>DASHBOARD</option>
                        <option value="interfaz" ${ticket.cause === 'interfaz' ? 'selected' : ''}>INTERFAZ</option>
                        <option value="cotizacion" ${ticket.cause === 'cotizacion' ? 'selected' : ''}>COTIZACION</option>
                        <option value="otro" ${ticket.cause === 'otro' || !ticket.cause ? 'selected' : ''}>OTRO</option>
                    </select>
                </div>
            </div>
            <div class="info-grid">
                <div class="info-block">
                    <label>Created At</label>
                    <p>${formatDateTime(ticket.created_at)}</p>
                </div>
                <div class="info-block">
                    <label>Updated At</label>
                    <p>${formatDateTime(ticket.updated_at)}</p>
                </div>
            </div>
        </div>
        
        <!-- Section: Message -->
        <div class="drawer-section">
            <div class="drawer-section-title">User Message</div>
            <div class="drawer-form-group">
                <label>Message</label>
                <textarea rows="5" onchange="updateTicketField('${ticket.id}', 'message', this.value)">${escapeHtml(ticket.message || '')}</textarea>
            </div>
        </div>
        
        <!-- Section: Submitted By -->
        <div class="drawer-section" style="background: #f9f9f9;">
            <div class="drawer-section-title">Submitted By</div>
            <div class="info-block">
                <label>User ID</label>
                <p class="monospace-text">${ticket.user_id || 'Anonymous (no login)'}</p>
            </div>
            ${userInfo ? `
                <div class="info-grid">
                    <div class="info-block">
                        <label>User Name</label>
                        <p>${escapeHtml(userInfo.name) || '-'}</p>
                    </div>
                    <div class="info-block">
                        <label>User Email</label>
                        <p>${escapeHtml(userInfo.email) || '-'}</p>
                    </div>
                </div>
                <a href="#" onclick="inspectRecord('artists', '${userInfo.user_id}'); return false;" class="field-link">View User Profile</a>
            ` : `
                <div class="info-block">
                    <label>User Info</label>
                    <p style="color: #888;">No linked user account found</p>
                </div>
            `}
        </div>
        
        <!-- Section: Support Response -->
        <div class="drawer-section" style="background: #fff5e6;">
            <div class="drawer-section-title">Support Response</div>
            <div class="drawer-form-group">
                <label>Internal Notes (not visible to user)</label>
                <textarea rows="3" placeholder="Add internal notes here..." onchange="updateTicketField('${ticket.id}', 'internal_notes', this.value)">${escapeHtml(ticket.internal_notes || '')}</textarea>
            </div>
            <div class="drawer-form-group">
                <label>Resolution Summary</label>
                <textarea rows="3" placeholder="Describe how the issue was resolved..." onchange="updateTicketField('${ticket.id}', 'resolution', this.value)">${escapeHtml(ticket.resolution || '')}</textarea>
            </div>
        </div>
        
        <!-- Section: Metadata -->
        <div class="drawer-section" style="background: #f5f5f5;">
            <div class="drawer-section-title">Technical Metadata</div>
            ${Object.keys(metadata).length > 0 ? `
                <div class="metadata-grid">
                    ${metadata.url ? `
                        <div class="metadata-item">
                            <label>Page URL</label>
                            <p class="metadata-value">${escapeHtml(metadata.url)}</p>
                        </div>
                    ` : ''}
                    ${metadata.userAgent ? `
                        <div class="metadata-item">
                            <label>User Agent</label>
                            <p class="metadata-value small">${escapeHtml(metadata.userAgent)}</p>
                        </div>
                    ` : ''}
                    ${metadata.platform ? `
                        <div class="metadata-item">
                            <label>Platform</label>
                            <p class="metadata-value">${escapeHtml(metadata.platform)}</p>
                        </div>
                    ` : ''}
                    ${metadata.language ? `
                        <div class="metadata-item">
                            <label>Language</label>
                            <p class="metadata-value">${escapeHtml(metadata.language)}</p>
                        </div>
                    ` : ''}
                    ${metadata.screenSize || metadata.resolution ? `
                        <div class="metadata-item">
                            <label>Screen Size</label>
                            <p class="metadata-value">${escapeHtml(metadata.screenSize || metadata.resolution || '-')}</p>
                        </div>
                    ` : ''}
                    ${metadata.viewport ? `
                        <div class="metadata-item">
                            <label>Viewport</label>
                            <p class="metadata-value">${escapeHtml(metadata.viewport)}</p>
                        </div>
                    ` : ''}
                    ${metadata.timestamp ? `
                        <div class="metadata-item">
                            <label>Timestamp</label>
                            <p class="metadata-value">${escapeHtml(metadata.timestamp)}</p>
                        </div>
                    ` : ''}
                    ${metadata.quote_id ? `
                        <div class="metadata-item">
                            <label>Related Quote ID</label>
                            <p class="metadata-value">${escapeHtml(metadata.quote_id)}</p>
                        </div>
                    ` : ''}
                </div>
                <details class="metadata-raw">
                    <summary>View Raw JSON</summary>
                    <pre class="metadata-display">${JSON.stringify(metadata, null, 2)}</pre>
                </details>
            ` : `
                <p style="color: #888; font-style: italic;">No metadata available</p>
            `}
        </div>
        
        <div class="drawer-actions">
            <button class="action-btn delete-btn" onclick="deleteRecord('tickets', '${ticket.id}')">DELETE TICKET</button>
        </div>
    `;
}

function renderSessionDrawer(session) {
    const formatDateTime = (dateStr) => dateStr ? new Date(dateStr).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';
    
    // Decompress log data
    let logEntries = [];
    let decompressError = null;
    
    try {
        if (session.log_data) {
            // Check if it's JSON or compressed
            if (session.log_data.startsWith('[') || session.log_data.startsWith('{')) {
                logEntries = JSON.parse(session.log_data);
            } else if (typeof pako !== 'undefined') {
                // Decompress base64 gzip
                const binary = atob(session.log_data);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                const decompressed = pako.ungzip(bytes, { to: 'string' });
                logEntries = JSON.parse(decompressed);
            } else {
                decompressError = 'Pako library not loaded - cannot decompress';
            }
        }
    } catch (err) {
        decompressError = err.message;
    }

    // Find linked tickets
    const linkedTickets = tickets.filter(t => t.session_log_id === session.id);
    
    return `
        <div class="shape-decor" style="background: var(--bauhaus-blue);"></div>
        <p style="font-family: 'Space Mono'; font-size: 0.7rem; color: var(--bauhaus-blue);">SESSION_ID: ${session.session_id}</p>
        <h2 style="font-weight: 900; font-size: 1.4rem; margin: 1rem 0;">Session Log</h2>
        
        <!-- Section: Session Info -->
        <div class="drawer-section" style="background: #f0f4ff;">
            <div class="drawer-section-title">Session Information</div>
            <div class="info-grid">
                <div class="info-block">
                    <label>Started At</label>
                    <p>${formatDateTime(session.started_at)}</p>
                </div>
                <div class="info-block">
                    <label>Ended At</label>
                    <p>${formatDateTime(session.ended_at)}</p>
                </div>
            </div>
            <div class="info-grid">
                <div class="info-block">
                    <label>Log Entries</label>
                    <p class="monospace-text">${session.log_entries_count || 0}</p>
                </div>
                <div class="info-block">
                    <label>Errors</label>
                    <p class="monospace-text" style="${session.has_errors ? 'color: var(--bauhaus-red); font-weight: bold;' : ''}">${session.error_count || 0}</p>
                </div>
            </div>
            <div class="info-block">
                <label>Page URL</label>
                <p class="monospace-text" style="word-break: break-all;">${escapeHtml(session.page_url || '-')}</p>
            </div>
        </div>
        
        <!-- Section: User Identification -->
        <div class="drawer-section" style="background: #f9f9f9;">
            <div class="drawer-section-title">User Identification</div>
            <div class="info-grid">
                <div class="info-block">
                    <label>User ID</label>
                    <p class="monospace-text">${session.user_id || 'Anonymous'}</p>
                </div>
                <div class="info-block">
                    <label>Email</label>
                    <p>${escapeHtml(session.user_email || '-')}</p>
                </div>
            </div>
            <div class="info-grid">
                <div class="info-block">
                    <label>IP Address</label>
                    <p class="monospace-text">${escapeHtml(session.user_ip || '-')}</p>
                </div>
                <div class="info-block">
                    <label>Phone</label>
                    <p>${escapeHtml(session.user_phone || '-')}</p>
                </div>
            </div>
            <div class="info-block">
                <label>Device Fingerprint</label>
                <p class="monospace-text">${escapeHtml(session.device_fingerprint || '-')}</p>
            </div>
            <div class="info-block">
                <label>User Agent</label>
                <p style="font-size: 0.7rem; word-break: break-all;">${escapeHtml(session.user_agent || '-')}</p>
            </div>
        </div>
        
        <!-- Section: Linked Tickets -->
        ${linkedTickets.length > 0 ? `
        <div class="drawer-section" style="background: #fff5e6;">
            <div class="drawer-section-title">Linked Tickets (${linkedTickets.length})</div>
            ${linkedTickets.map(t => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; background: white; margin-bottom: 0.5rem; border-left: 3px solid var(--bauhaus-red);">
                    <span style="font-family: 'Space Mono'; font-size: 0.75rem;">#TK${t.id.toString().slice(-5).toUpperCase()}</span>
                    <span style="font-size: 0.8rem;">${escapeHtml(t.reason || 'feedback')}</span>
                    ${getTicketStatusBadge(t.status || 'open')}
                    <button class="action-btn" style="padding: 0.25rem 0.5rem; font-size: 0.7rem;" onclick="inspectRecord('tickets', '${t.id}')">VIEW</button>
                </div>
            `).join('')}
        </div>
        ` : ''}
        
        <!-- Section: Log Viewer -->
        <div class="drawer-section">
            <div class="drawer-section-title">Activity Log (${logEntries.length} entries)</div>
            ${decompressError ? `
                <p style="color: var(--bauhaus-red); font-style: italic; margin-bottom: 1rem;">Error loading logs: ${escapeHtml(decompressError)}</p>
            ` : ''}
            <div class="log-viewer" style="max-height: 400px; overflow-y: auto; background: #1a1a1a; padding: 1rem; font-family: 'Space Mono', monospace; font-size: 0.7rem;">
                ${logEntries.length > 0 ? logEntries.map(entry => {
                    const time = new Date(entry.t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
                    const levelColors = {
                        'error': '#e63946',
                        'warn': '#f4d03f',
                        'info': '#3498db',
                        'action': '#27ae60',
                        'network': '#9b59b6'
                    };
                    const color = levelColors[entry.l] || '#888';
                    return `<div style="margin-bottom: 0.25rem; border-bottom: 1px solid #333; padding-bottom: 0.25rem;">
                        <span style="color: #666;">${time}</span>
                        <span style="color: ${color}; font-weight: bold; margin-left: 0.5rem;">[${(entry.l || 'log').toUpperCase()}]</span>
                        <span style="color: #888; margin-left: 0.5rem;">[${entry.c || 'general'}]</span>
                        <span style="color: #fff; margin-left: 0.5rem;">${escapeHtml(entry.m || '')}</span>
                        ${entry.d ? `<div style="color: #666; margin-left: 1rem; font-size: 0.65rem; white-space: pre-wrap;">${escapeHtml(JSON.stringify(entry.d, null, 2))}</div>` : ''}
                    </div>`;
                }).join('') : '<p style="color: #888;">No log entries available</p>'}
            </div>
            <button class="action-btn" style="margin-top: 0.5rem; width: 100%;" onclick="copySessionLog('${session.id}')">COPY LOG TO CLIPBOARD</button>
        </div>
        
        <div class="drawer-actions">
            <button class="action-btn delete-btn" onclick="deleteRecord('sessions', '${session.id}')">DELETE SESSION LOG</button>
        </div>
    `;
}

// Copy session log to clipboard
window.copySessionLog = async function(sessionId) {
    const session = sessionLogs.find(s => s.id.toString() === sessionId.toString());
    if (!session) return;
    
    try {
        let logEntries = [];
        if (session.log_data) {
            if (session.log_data.startsWith('[') || session.log_data.startsWith('{')) {
                logEntries = JSON.parse(session.log_data);
            } else if (typeof pako !== 'undefined') {
                const binary = atob(session.log_data);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                const decompressed = pako.ungzip(bytes, { to: 'string' });
                logEntries = JSON.parse(decompressed);
            }
        }
        
        const logText = logEntries.map(entry => {
            const time = new Date(entry.t).toISOString();
            return `${time} [${entry.l}] [${entry.c}] ${entry.m}${entry.d ? ' ' + JSON.stringify(entry.d) : ''}`;
        }).join('\n');
        
        const fullLog = `Session: ${session.session_id}\nUser: ${session.user_email || session.user_ip || 'Anonymous'}\nPage: ${session.page_url}\nStarted: ${session.started_at}\n\n--- LOG ---\n${logText}`;
        
        await navigator.clipboard.writeText(fullLog);
        alert('Log copied to clipboard!');
    } catch (err) {
        console.error('Copy error:', err);
        alert('Error copying log: ' + err.message);
    }
};

// ============================================
// UPDATE FUNCTIONS
// ============================================

window.updateArtistField = async function(userId, field, value) {
    try {
        const updateData = {};
        // Handle boolean values properly (don't convert false to null)
        if (typeof value === 'boolean') {
            updateData[field] = value;
        } else {
            updateData[field] = value || null;
        }
        
        const { error } = await _supabase.from('artists_db').update(updateData).eq('user_id', userId);
        if (error) throw error;
        
        const artist = artists.find(a => a.user_id === userId);
        if (artist) artist[field] = updateData[field];
        
        applyFiltersAndSort();
        updateStats();
        inspectRecord('artists', userId);
    } catch (err) {
        console.error('Error updating artist:', err);
        alert('Error updating: ' + err.message);
    }
};

window.updateQuoteField = async function(id, field, value) {
    try {
        const updateData = {};
        updateData[field] = value;
        
        const { error } = await _supabase.from('quotations_db').update(updateData).eq('id', id);
        if (error) throw error;
        
        const quote = quotes.find(q => q.id.toString() === id.toString());
        if (quote) quote[field] = value;
        
        applyFiltersAndSort();
        updateStats();
        inspectRecord('quotes', id);
    } catch (err) {
        console.error('Error updating quote:', err);
        alert('Error updating: ' + err.message);
    }
};

window.updateTicketField = async function(id, field, value) {
    try {
        const updateData = {};
        updateData[field] = value;
        
        const { error } = await _supabase.from('feedback_tickets').update(updateData).eq('id', id);
        if (error) throw error;
        
        const ticket = tickets.find(t => t.id.toString() === id.toString());
        if (ticket) ticket[field] = value;
        
        applyFiltersAndSort();
        updateStats();
        inspectRecord('tickets', id);
    } catch (err) {
        console.error('Error updating ticket:', err);
        alert('Error updating: ' + err.message);
    }
};

// ============================================
// DELETE FUNCTIONS
// ============================================

window.deleteRecord = function(type, id) {
    pendingAction = { type, id };
    showConfirmModal('Confirmar Eliminacion', 'Esta seguro de eliminar este registro?');
};

window.confirmAction = async function() {
    if (!pendingAction) return;
    
    const { type, id } = pendingAction;
    
    try {
        let tableName = '';
        let idField = 'id';
        
        if (type === 'artists') {
            tableName = 'artists_db';
            idField = 'user_id';
        } else if (type === 'quotes') {
            tableName = 'quotations_db';
        } else if (type === 'tickets') {
            tableName = 'feedback_tickets';
        } else if (type === 'sessions') {
            tableName = 'session_logs';
        }
        
        const { error } = await _supabase.from(tableName).delete().eq(idField, id);
        if (error) throw error;
        
        if (type === 'artists') {
            artists = artists.filter(a => a.user_id !== id);
        } else if (type === 'quotes') {
            quotes = quotes.filter(q => q.id.toString() !== id.toString());
        } else if (type === 'tickets') {
            tickets = tickets.filter(t => t.id.toString() !== id.toString());
        } else if (type === 'sessions') {
            sessionLogs = sessionLogs.filter(s => s.id.toString() !== id.toString());
        }
        
        closeConfirmModal();
        document.getElementById('drawer-toggle').checked = false;
        
        applyFiltersAndSort();
        updateStats();
    } catch (err) {
        console.error('Error deleting record:', err);
        alert('Error deleting: ' + err.message);
        closeConfirmModal();
    }
};

function showConfirmModal(title, message) {
    document.getElementById('confirm-modal-title').textContent = title;
    document.getElementById('confirm-modal-message').textContent = message;
    document.getElementById('confirm-modal').style.display = 'flex';
}

window.closeConfirmModal = function() {
    document.getElementById('confirm-modal').style.display = 'none';
    pendingAction = null;
};

// ============================================
// THEME & ZOOM
// ============================================

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('weotzi-theme', isDark ? 'dark' : 'light');
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
    const savedTheme = localStorage.getItem('weotzi-theme');
    if (savedTheme === 'dark') document.body.classList.add('dark-mode');

    const savedZoom = localStorage.getItem('weotzi-zoom');
    if (savedZoom) setZoom(parseFloat(savedZoom));
}

// ============================================
// LOGOUT
// ============================================

window.handleLogout = async function() {
    try {
        await _supabase.auth.signOut();
        window.location.href = 'index.html';
    } catch (err) {
        console.error('Error logging out:', err);
    }
};

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeConfirmModal();
        document.getElementById('drawer-toggle').checked = false;
    }
});
