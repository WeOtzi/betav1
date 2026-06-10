// ============================================
// WE OTZI - Support Dashboard
// Multi-table admin panel for support team
// Manages: Artists, Quotations, Sessions, Support Chats
// ============================================

// Supabase Configuration - Uses config-manager.js (provides window.CONFIG)
const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = (window._supabase = window._supabase || supabase.createClient(supabaseUrl, supabaseKey));

// ============================================
// STATE MANAGEMENT
// ============================================

let currentUser = null;
let supportUser = null;
let activeTab = 'artists';

// Data stores
let artists = [];
let quotes = [];
let sessionLogs = [];
let reviews = [];
let chats = [];           // support_conversations list (bandeja)
let chatMessages = [];    // mensajes de la conversación abierta
let chatRealtimeChannel = null;   // inbox subscription
let chatMessagesChannel = null;   // per-open-conversation subscription
let activeChatId = null;          // conversación abierta en drawer

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
    sessions: [
        { id: 'date', label: 'DATE', width: '100px' },
        { id: 'session_id', label: 'SESSION', width: '120px' },
        { id: 'user', label: 'USER', width: '2fr' },
        { id: 'page', label: 'PAGE', width: '2fr' },
        { id: 'entries', label: 'ENTRIES', width: '80px' },
        { id: 'errors', label: 'ERRORS', width: '80px' },
        { id: 'action', label: 'ACTION', width: '120px' }
    ],
    chats: [
        { id: 'last', label: 'LAST MSG', width: '120px' },
        { id: 'id', label: 'ID', width: '80px' },
        { id: 'user', label: 'USER', width: '2fr' },
        { id: 'role', label: 'ROLE', width: '90px' },
        { id: 'status', label: 'STATUS', width: '1fr' },
        { id: 'page', label: 'PAGE', width: '1.5fr' },
        { id: 'action', label: 'ACTION', width: '120px' }
    ],
    reviews: [
        { id: 'date', label: 'DATE', width: '110px' },
        { id: 'reviewer', label: 'REVIEWER', width: '1.5fr' },
        { id: 'target', label: 'TARGET', width: '1.5fr' },
        { id: 'rating', label: 'RATING', width: '90px' },
        { id: 'comment', label: 'COMMENT', width: '2fr' },
        { id: 'status', label: 'STATUS', width: '1fr' },
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
        
        const [artistsResult, quotesResult, sessionsResult, chatsResult, reviewsResult] = await Promise.all([
            _supabase.from('artists_db').select('*'),
            _supabase.from('quotations_db').select('*').order('created_at', { ascending: false }),
            _supabase.from('session_logs').select('*').order('created_at', { ascending: false }).limit(500),
            _supabase.from('support_conversations').select('*').order('last_message_at', { ascending: false }).limit(500),
            _supabase.from('verified_reviews').select('*').order('created_at', { ascending: false }).limit(500)
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
        
        if (sessionsResult.error) {
            console.error('Error loading session logs:', sessionsResult.error);
            errors.push(`Sessions: ${sessionsResult.error.message}`);
        } else {
            console.log(`Loaded ${sessionsResult.data?.length || 0} session logs`);
        }

        if (chatsResult.error) {
            console.error('Error loading support chats:', chatsResult.error);
            errors.push(`Chats: ${chatsResult.error.message}`);
        } else {
            console.log(`Loaded ${chatsResult.data?.length || 0} support conversations`);
        }

        if (reviewsResult.error) {
            console.error('Error loading reviews:', reviewsResult.error);
            errors.push(`Reviews: ${reviewsResult.error.message}`);
        } else {
            console.log(`Loaded ${reviewsResult.data?.length || 0} reviews`);
        }

        artists = artistsResult.data || [];
        quotes = quotesResult.data || [];
        sessionLogs = sessionsResult.data || [];
        chats = chatsResult.data || [];
        reviews = reviewsResult.data || [];

        if (errors.length > 0) {
            statusEl.textContent = `STATUS: ONLINE | ERRORS: ${errors.length}`;
        } else {
            statusEl.textContent = `STATUS: ONLINE | ROLE: ${supportUser?.role?.toUpperCase() || 'SUPPORT'}`;
        }

        updateStats();
        applyFiltersAndSort();
        updateChatsBadge();
        subscribeChatsInbox();

        console.log(`Data loaded - Artists: ${artists.length}, Quotes: ${quotes.length}, Sessions: ${sessionLogs.length}, Chats: ${chats.length}, Reviews: ${reviews.length}`);

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
    } else if (tabName === 'chats') {
        filterConfig = { search: '', status: 'awaiting_human', mine: 'all' };
    } else if (tabName === 'reviews') {
        filterConfig = { search: '', status: 'pending' };
    } else {
        filterConfig = { search: '', status: 'all' };
    }
    document.getElementById('search-input').value = '';

    renderFilters();
    renderHeaders();
    updateGridStyles();
    applyFiltersAndSort();

    // Hide NEW button on chats tab (no manual chat creation from support side)
    const createBtn = document.getElementById('create-new-btn');
    if (createBtn) createBtn.style.display = (tabName === 'chats' || tabName === 'reviews') ? 'none' : '';
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
                <option value="in_progress">IN PROGRESS</option>
                <option value="artist_completed">ARTIST COMPLETED</option>
                <option value="client_rejected">CLIENT REJECTED</option>
                <option value="completed">COMPLETED</option>
            </select>
            <select id="archived-filter" class="toolbar-select" onchange="handleFilterChange('archived', this.value)">
                <option value="all">ALL</option>
                <option value="false">ACTIVE ONLY</option>
                <option value="true">ARCHIVED ONLY</option>
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
    } else if (activeTab === 'chats') {
        filtersHTML = `
            <select id="chat-status-filter" class="toolbar-select" style="border-color: var(--bauhaus-red);" onchange="handleFilterChange('status', this.value)">
                <option value="awaiting_human" ${filterConfig.status === 'awaiting_human' ? 'selected' : ''}>AWAITING HUMAN</option>
                <option value="human" ${filterConfig.status === 'human' ? 'selected' : ''}>HUMAN</option>
                <option value="bot" ${filterConfig.status === 'bot' ? 'selected' : ''}>BOT</option>
                <option value="closed" ${filterConfig.status === 'closed' ? 'selected' : ''}>CLOSED</option>
                <option value="all" ${filterConfig.status === 'all' ? 'selected' : ''}>ALL</option>
            </select>
            <select id="chat-mine-filter" class="toolbar-select" onchange="handleFilterChange('mine', this.value)">
                <option value="all">ALL AGENTS</option>
                <option value="mine">ASSIGNED TO ME</option>
                <option value="unassigned">UNASSIGNED</option>
            </select>
        `;
    } else if (activeTab === 'reviews') {
        filtersHTML = `
            <select id="review-status-filter" class="toolbar-select" style="border-color: var(--bauhaus-red);" onchange="handleFilterChange('status', this.value)">
                <option value="pending" ${filterConfig.status === 'pending' ? 'selected' : ''}>PENDING</option>
                <option value="approved" ${filterConfig.status === 'approved' ? 'selected' : ''}>APPROVED</option>
                <option value="rejected" ${filterConfig.status === 'rejected' ? 'selected' : ''}>REJECTED</option>
                <option value="hidden" ${filterConfig.status === 'hidden' ? 'selected' : ''}>HIDDEN</option>
                <option value="all" ${filterConfig.status === 'all' ? 'selected' : ''}>ALL</option>
            </select>
        `;
    }

    if (activeTab === 'chats') {
        filtersHTML += `
            <select id="sort-select" class="toolbar-select" onchange="handleSortChange(this.value)">
                <option value="last_message_at:desc">RECENT ACTIVITY</option>
                <option value="created_at:desc">NEWEST CONVO</option>
                <option value="created_at:asc">OLDEST CONVO</option>
            </select>
        `;
    } else {
        filtersHTML += `
            <select id="sort-select" class="toolbar-select" onchange="handleSortChange(this.value)">
                <option value="created_at:desc">MOST RECENT</option>
                <option value="created_at:asc">OLDEST</option>
            </select>
        `;
    }

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
    } else if (activeTab === 'sessions') {
        data = [...sessionLogs];
    } else if (activeTab === 'chats') {
        data = [...chats];
    } else if (activeTab === 'reviews') {
        data = [...reviews];
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
    } else if (activeTab === 'chats') {
        if (filterConfig.status && filterConfig.status !== 'all') {
            data = data.filter(c => (c.status || 'bot') === filterConfig.status);
        }
        if (filterConfig.mine === 'mine') {
            data = data.filter(c => c.assigned_support_user_id === (supportUser?.user_id || currentUser?.id));
        } else if (filterConfig.mine === 'unassigned') {
            data = data.filter(c => !c.assigned_support_user_id);
        }
    } else if (activeTab === 'reviews') {
        if (filterConfig.status && filterConfig.status !== 'all') {
            data = data.filter(r => (r.moderation_status || 'pending') === filterConfig.status);
        }
    }

    data.sort((a, b) => {
        let valA, valB;

        if (sortConfig.field === 'created_at') {
            valA = new Date(a.created_at).getTime();
            valB = new Date(b.created_at).getTime();
        } else if (sortConfig.field === 'last_message_at') {
            valA = new Date(a.last_message_at || a.created_at).getTime();
            valB = new Date(b.last_message_at || b.created_at).getTime();
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
    } else if (activeTab === 'sessions') {
        rowsHTML = filteredData.map((session, idx) => renderSessionRow(session, idx)).join('');
    } else if (activeTab === 'chats') {
        rowsHTML = filteredData.map((chat, idx) => renderChatRow(chat, idx)).join('');
    } else if (activeTab === 'reviews') {
        rowsHTML = filteredData.map((review, idx) => renderReviewRow(review, idx)).join('');
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

function renderReviewRow(review, index) {
    const date = new Date(review.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
    const reviewer = review.reviewer_username || review.reviewer_display_name || review.reviewer_user_id;
    const target = review.reviewee_display_name || `${review.reviewee_type}:${String(review.reviewee_user_id || '').slice(0, 8)}`;
    const comment = review.comment || '';

    return `
        <div class="quote-row data-row" style="opacity: 0; transform: translateY(20px); transition: all 0.4s; transition-delay: ${index * 0.03}s">
            <div style="font-family: 'Space Mono'; font-size: 0.75rem;">${date}</div>
            <div class="client-cell"><span class="client-name">${escapeHtml(reviewer)}</span></div>
            <div style="font-size: 0.8rem;">${escapeHtml(target)}</div>
            <div style="font-family: 'Space Mono'; font-size: 0.75rem;">${'★'.repeat(Number(review.rating || 0))} ${review.rating || '-'}</div>
            <div style="font-size: 0.8rem; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(comment)}</div>
            <div>${getReviewStatusBadge(review.moderation_status || 'pending')}</div>
            <div><button class="action-btn detail-btn" onclick="inspectRecord('reviews', '${review.id}')">MODERATE</button></div>
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
        'in_progress': { text: 'IN PROGRESS', class: 'quote-responded' },
        'artist_completed': { text: 'ARTIST COMPLETED', class: 'quote-responded' },
        'client_rejected': { text: 'CLIENT REJECTED', class: 'quote-rejected' }, // Need to define this class
        'completed': { text: 'COMPLETED', class: 'quote-completed' }
    };
    const config = states[status] || states['pending'];
    // Fallback for unknown statuses
    if (!config) return `<span class="status-badge">${status}</span>`;
    
    // Inline styles for new statuses if classes don't exist in CSS
    let style = '';
    if (status === 'client_approved') style = 'background: #d4edda; color: #155724; border: 1px solid #c3e6cb;';
    if (status === 'artist_completed') style = 'background: #fff3cd; color: #856404; border: 1px solid #ffeeba;';
    if (status === 'client_rejected') style = 'background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb;';
    
    if (style) {
        return `<span class="status-badge" style="${style}">${config.text}</span>`;
    }
    
    return `<span class="status-badge ${config.class}">${config.text}</span>`;
}

function getReviewStatusBadge(status) {
    const states = {
        pending: { text: 'PENDING', style: 'background:#fff3cd;color:#856404;border:1px solid #ffeeba;' },
        approved: { text: 'APPROVED', style: 'background:#d4edda;color:#155724;border:1px solid #c3e6cb;' },
        rejected: { text: 'REJECTED', style: 'background:#f8d7da;color:#721c24;border:1px solid #f5c6cb;' },
        hidden: { text: 'HIDDEN', style: 'background:#e2e3e5;color:#383d41;border:1px solid #d6d8db;' }
    };
    const config = states[status] || states.pending;
    return `<span class="status-badge" style="${config.style}">${config.text}</span>`;
}

// ============================================
// STATS
// ============================================

function updateStats() {
    document.getElementById('stat-total-artists').textContent = artists.length;
    document.getElementById('stat-total-quotes').textContent = quotes.length;
    
    const pendingQuotes = quotes.filter(q => q.quote_status === 'pending' && !q.is_archived).length;
    const pendingVerifications = artists.filter(a => a.verification_state === 'Requested' || a.verification_state === 'In Progress').length;
    const pendingReviews = reviews.filter(r => (r.moderation_status || 'pending') === 'pending').length;
    
    document.getElementById('stat-pending').textContent = pendingQuotes + pendingVerifications + pendingReviews;
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
    } else if (type === 'sessions') {
        record = sessionLogs.find(s => s.id.toString() === id.toString());
    } else if (type === 'chats') {
        record = chats.find(c => c.id === id);
    } else if (type === 'reviews') {
        record = reviews.find(r => r.id === id);
    }

    if (!record) return;

    selectedRecord = { type, id, data: record };
    const drawerContent = document.getElementById('drawer-content');

    if (type === 'artists') {
        drawerContent.innerHTML = renderArtistDrawer(record);
    } else if (type === 'quotes') {
        drawerContent.innerHTML = renderQuoteDrawer(record);
    } else if (type === 'sessions') {
        drawerContent.innerHTML = renderSessionDrawer(record);
    } else if (type === 'chats') {
        openChatDrawer(record);
    } else if (type === 'reviews') {
        drawerContent.innerHTML = renderReviewDrawer(record);
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

function renderReviewDrawer(review) {
    const formatDateTime = (dateStr) => dateStr ? new Date(dateStr).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
    const tags = Array.isArray(review.tags) ? review.tags : [];
    const photos = Array.isArray(review.photo_urls) ? review.photo_urls : [];

    return `
        <div class="shape-decor"></div>
        <p style="font-family:'Space Mono';font-size:0.7rem;color:var(--bauhaus-red);">REVIEW_ID: ${escapeHtml(String(review.id).slice(0, 12))}...</p>
        <h2 style="font-weight:900;font-size:1.6rem;margin:1rem 0;">Review Moderation</h2>

        <div class="drawer-section" style="background:#fffbf0;">
            <div class="drawer-section-title">Status</div>
            <div style="margin-bottom:0.7rem;">${getReviewStatusBadge(review.moderation_status || 'pending')}</div>
            <div class="form-group">
                <label>Moderation Reason</label>
                <textarea rows="3" id="review-moderation-reason">${escapeHtml(review.moderation_reason || '')}</textarea>
            </div>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.8rem;">
                <button class="action-btn accept-btn" onclick="updateReviewModeration('${review.id}', 'approved')">APPROVE</button>
                <button class="action-btn" onclick="updateReviewModeration('${review.id}', 'hidden')">HIDE</button>
                <button class="action-btn delete-btn" onclick="updateReviewModeration('${review.id}', 'rejected')">REJECT</button>
            </div>
        </div>

        <div class="drawer-section">
            <div class="drawer-section-title">Review</div>
            <div class="detail-row"><span>Created</span><strong>${formatDateTime(review.created_at)}</strong></div>
            <div class="detail-row"><span>Context</span><strong>${escapeHtml(review.context_type || '-')}</strong></div>
            <div class="detail-row"><span>Reviewer</span><strong>${escapeHtml(review.reviewer_username || review.reviewer_display_name || '-')} (${escapeHtml(review.reviewer_type || '-')})</strong></div>
            <div class="detail-row"><span>Country</span><strong>${escapeHtml(review.reviewer_country || '-')}</strong></div>
            <div class="detail-row"><span>Target</span><strong>${escapeHtml(review.reviewee_display_name || review.reviewee_type || '-')}</strong></div>
            <div class="detail-row"><span>Rating</span><strong>${'★'.repeat(Number(review.rating || 0))} ${review.rating || '-'}</strong></div>
            <div class="form-group">
                <label>Comment</label>
                <textarea rows="6" readonly>${escapeHtml(review.comment || '')}</textarea>
            </div>
            <div class="detail-row"><span>Tags</span><strong>${escapeHtml(tags.join(', ') || '-')}</strong></div>
            <div class="detail-row"><span>Photos</span><strong>${escapeHtml(photos.join(', ') || '-')}</strong></div>
        </div>

        <div class="drawer-section" style="background:#f0f4ff;">
            <div class="drawer-section-title">Response</div>
            <div class="detail-row"><span>Status</span><strong>${escapeHtml(review.response_status || 'none')}</strong></div>
            <div class="form-group">
                <label>Response Comment</label>
                <textarea rows="4" readonly>${escapeHtml(review.response_comment || '')}</textarea>
            </div>
            ${review.response_comment ? `<button class="action-btn accept-btn" onclick="approveReviewResponse('${review.id}')">APPROVE RESPONSE</button>` : ''}
        </div>
    `;
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
                        <option value="in_progress" ${quote.quote_status === 'in_progress' ? 'selected' : ''}>IN PROGRESS</option>
                        <option value="artist_completed" ${quote.quote_status === 'artist_completed' ? 'selected' : ''}>ARTIST COMPLETED</option>
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
                    <p>${quote.artist_session_cost_amount ? (window.WeOtziCurrency && window.WeOtziCurrency.isReady() ? window.WeOtziCurrency.formatInline(quote.artist_session_cost_amount, quote.artist_session_cost_currency || 'USD') : `${quote.artist_session_cost_amount} ${quote.artist_session_cost_currency || ''}`) : '-'}</p>
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
                    <input type="checkbox" ${quote.tattoo_is_first_tattoo === true ? 'checked' : ''} onchange="updateQuoteField('${quote.id}', 'tattoo_is_first_tattoo', this.checked)">
                    <span>Is First Tattoo</span>
                </label>
            </div>
            <div class="checkbox-row">
                <label class="checkbox-label">
                    <input type="checkbox" ${quote.tattoo_is_cover_up === true ? 'checked' : ''} onchange="updateQuoteField('${quote.id}', 'tattoo_is_cover_up', this.checked)">
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
        // The password field is special — a direct PATCH to artists_db only
        // updates the cleartext mirror and leaves auth.users untouched, which
        // means the artist can no longer log in with the new value. Route
        // through the server endpoint that updates BOTH auth and the mirror.
        if (field === 'password') {
            return await syncArtistPasswordViaApi(userId, value);
        }

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

async function syncArtistPasswordViaApi(userId, newPassword) {
    const artist = artists.find(a => a.user_id === userId);
    if (!artist?.email) {
        alert('No se encontro el email del artista');
        return;
    }
    if (!newPassword || String(newPassword).length < 6) {
        alert('La contrasena debe tener al menos 6 caracteres');
        return;
    }
    const { data: sessionData } = await _supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) {
        alert('Sesion de soporte no encontrada — inicia sesion de nuevo.');
        return;
    }
    const res = await fetch('/api/auth/reset-temp-password', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
            email: artist.email,
            userType: 'artist',
            tempPassword: String(newPassword)
        })
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.success) {
        throw new Error(result.error || `Reset failed (${res.status})`);
    }
    artist.password = String(newPassword);
    applyFiltersAndSort();
    updateStats();
    inspectRecord('artists', userId);
    console.log(`[support] artist password updated for ${artist.email}`);
}

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

window.updateReviewModeration = async function(id, status) {
    try {
        const reasonEl = document.getElementById('review-moderation-reason');
        const updateData = {
            moderation_status: status,
            moderation_reason: reasonEl ? reasonEl.value.trim() || null : null
        };

        if (status === 'approved') {
            updateData.approved_at = new Date().toISOString();
            updateData.approved_by_user_id = currentUser?.id || null;
        }

        const { error } = await _supabase.from('verified_reviews').update(updateData).eq('id', id);
        if (error) throw error;

        const review = reviews.find(r => r.id === id);
        if (review) Object.assign(review, updateData);

        applyFiltersAndSort();
        updateStats();
        inspectRecord('reviews', id);
    } catch (err) {
        console.error('Error updating review:', err);
        alert('Error updating review: ' + err.message);
    }
};

window.approveReviewResponse = async function(id) {
    try {
        const updateData = {
            response_status: 'approved',
            response_updated_at: new Date().toISOString()
        };
        const { error } = await _supabase.from('verified_reviews').update(updateData).eq('id', id);
        if (error) throw error;

        const review = reviews.find(r => r.id === id);
        if (review) Object.assign(review, updateData);

        inspectRecord('reviews', id);
    } catch (err) {
        console.error('Error approving response:', err);
        alert('Error approving response: ' + err.message);
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
        } else if (type === 'sessions') {
            tableName = 'session_logs';
        }
        
        const { error } = await _supabase.from(tableName).delete().eq(idField, id);
        if (error) throw error;
        
        if (type === 'artists') {
            artists = artists.filter(a => a.user_id !== id);
        } else if (type === 'quotes') {
            quotes = quotes.filter(q => q.id.toString() !== id.toString());
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
        // si cerramos drawer, desuscribirse del canal de mensajes
        unsubscribeChatMessages();
        activeChatId = null;
    }
});

// ============================================
// SUPPORT LIVE CHAT — bandeja + conversación
// ============================================

const CHAT_STATUS_META = {
    bot:            { label: 'BOT',             color: '#ddd',        text: '#0A0A0A' },
    awaiting_human: { label: 'AWAITING HUMAN',  color: '#F4B942',     text: '#0A0A0A' },
    human:          { label: 'HUMAN CONNECTED', color: '#E23E28',     text: '#fff' },
    closed:         { label: 'CLOSED',          color: '#999',        text: '#fff' }
};

function renderChatStatusBadge(status) {
    const meta = CHAT_STATUS_META[status] || CHAT_STATUS_META.bot;
    return `<span class="status-badge" style="background:${meta.color}; color:${meta.text}; font-family:'Space Mono',monospace; font-size:0.65rem; padding:2px 8px; border:1.5px solid var(--bauhaus-black,#0A0A0A);">${meta.label}</span>`;
}

function formatChatWhen(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function chatUserLabel(chat) {
    if (chat.user_id) {
        const artist = artists.find(a => a.user_id === chat.user_id);
        if (artist) return artist.name || artist.username || artist.email || chat.user_id.slice(0, 8);
        return chat.user_id.slice(0, 8) + '…';
    }
    if (chat.anonymous_id) return 'Anon ' + chat.anonymous_id.slice(0, 6);
    return 'Unknown';
}

function renderChatRow(chat, index) {
    const shortId = chat.id.slice(0, 5).toUpperCase();
    const user = chatUserLabel(chat);
    const role = (chat.user_role || 'anonymous').toUpperCase();
    const page = chat.page_context ? (() => {
        try { return new URL(chat.page_context).pathname; } catch { return chat.page_context; }
    })() : '-';
    const status = chat.status || 'bot';
    const lastWhen = formatChatWhen(chat.last_message_at || chat.created_at);

    return `
        <div class="quote-row data-row" style="opacity: 0; transform: translateY(20px); transition: all 0.4s; transition-delay: ${index * 0.03}s">
            <div style="font-family: 'Space Mono'; font-size: 0.75rem;">${lastWhen}</div>
            <div style="font-family: 'Space Mono'; font-size: 0.75rem; color: var(--bauhaus-blue);">#SC${shortId}</div>
            <div style="font-size: 0.85rem;">${escapeHtml(user)}</div>
            <div style="font-family: 'Space Mono'; font-size: 0.7rem;">${role}</div>
            <div>${renderChatStatusBadge(status)}</div>
            <div style="font-size: 0.75rem; color:#666; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(page)}</div>
            <div><button class="action-btn detail-btn" onclick="inspectRecord('chats', '${chat.id}')">OPEN</button></div>
        </div>
    `;
}

async function openChatDrawer(chat) {
    activeChatId = chat.id;
    const drawerContent = document.getElementById('drawer-content');
    drawerContent.innerHTML = `
        <div class="shape-decor"></div>
        <p style="font-family: 'Space Mono'; font-size: 0.7rem; color: var(--bauhaus-red);">CONVERSATION_ID: ${chat.id}</p>
        <h2 style="font-weight: 900; font-size: 1.4rem; margin: 1rem 0;">${escapeHtml(chatUserLabel(chat))}</h2>
        <div id="chat-drawer-body">
            <div class="loading-placeholder" style="padding:1rem; font-family:'Space Mono',monospace;">LOADING_MESSAGES...</div>
        </div>
    `;

    try {
        const { data, error } = await _supabase
            .from('support_messages')
            .select('*')
            .eq('conversation_id', chat.id)
            .order('created_at', { ascending: true });
        if (error) throw error;
        chatMessages = data || [];
        renderChatDrawerBody(chat);
        subscribeChatMessages(chat.id);
    } catch (err) {
        console.error('Error loading messages:', err);
        document.getElementById('chat-drawer-body').innerHTML =
            `<div class="empty-state" style="padding:1rem; color:var(--bauhaus-red);">ERROR: ${escapeHtml(err.message)}</div>`;
    }
}

function renderChatDrawerBody(chat) {
    const body = document.getElementById('chat-drawer-body');
    if (!body) return;

    const meId = supportUser?.user_id || currentUser?.id;
    const isMine = chat.assigned_support_user_id === meId;
    const status = chat.status || 'bot';
    const canTake = status === 'awaiting_human' || status === 'bot';
    const canSend = status === 'human' && isMine;
    const canRelease = status === 'human' && isMine;
    const canClose = status !== 'closed';

    const assignedName = chat.assigned_support_user_id
        ? (chat.assigned_support_user_id === meId ? 'YOU' : chat.assigned_support_user_id.slice(0, 8) + '…')
        : 'UNASSIGNED';

    const metaBlock = `
        <div class="drawer-section" style="background:#f9f9f9;">
            <div class="drawer-section-title">Conversation</div>
            <div class="info-grid">
                <div class="info-block"><label>Status</label><p>${renderChatStatusBadge(status)}</p></div>
                <div class="info-block"><label>Role</label><p>${escapeHtml((chat.user_role || 'anonymous').toUpperCase())}</p></div>
            </div>
            <div class="info-grid">
                <div class="info-block"><label>Assigned</label><p style="font-family:'Space Mono',monospace; font-size:0.8rem;">${assignedName}</p></div>
                <div class="info-block"><label>Escalations</label><p style="font-family:'Space Mono',monospace;">${chat.escalation_count ?? 0}</p></div>
            </div>
            <div class="info-block"><label>User ID</label><p class="monospace-text">${chat.user_id || '(anon) ' + (chat.anonymous_id || '-')}</p></div>
            <div class="info-block"><label>Page Context</label><p style="font-size:0.75rem; word-break:break-all;">${escapeHtml(chat.page_context || '-')}</p></div>
        </div>
    `;

    const actionsBlock = `
        <div class="drawer-actions" style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:1rem;">
            ${canTake ? `<button class="action-btn save-btn" onclick="assignChat('${chat.id}')">TOMAR CONVERSACIÓN</button>` : ''}
            ${canRelease ? `<button class="action-btn" onclick="releaseChat('${chat.id}')">DEVOLVER AL BOT</button>` : ''}
            ${canClose ? `<button class="action-btn delete-btn" onclick="closeChat('${chat.id}')">CERRAR</button>` : ''}
        </div>
    `;

    const messagesHTML = chatMessages.map(m => renderChatMessage(m)).join('') ||
        `<div class="empty-state" style="padding:1rem;">NO_MESSAGES</div>`;

    const composerBlock = canSend ? `
        <div class="drawer-section" style="background:#fffbe6;">
            <div class="drawer-section-title">Send as human agent</div>
            <textarea id="chat-agent-input" rows="3" placeholder="Type your reply..."
                style="width:100%; font-family:Inter,sans-serif; font-size:0.9rem; border:2px solid var(--bauhaus-black,#0A0A0A); padding:0.5rem; resize:vertical;"></textarea>
            <div style="display:flex; justify-content:flex-end; margin-top:0.5rem;">
                <button class="action-btn save-btn" onclick="sendAgentMessage('${chat.id}')">SEND</button>
            </div>
        </div>
    ` : (status === 'human' && !isMine ? `
        <div class="drawer-section" style="background:#f5f5f5;">
            <p style="font-family:'Space Mono',monospace; font-size:0.8rem;">Asignada a otro agente. Puedes ver el transcript pero no enviar mensajes.</p>
        </div>
    ` : (status === 'awaiting_human' ? `
        <div class="drawer-section" style="background:#fffbe6;">
            <p style="font-family:'Space Mono',monospace; font-size:0.8rem;">Usuario esperando agente. Pulsa <strong>TOMAR CONVERSACIÓN</strong> para responder.</p>
        </div>
    ` : (status === 'closed' ? `
        <div class="drawer-section" style="background:#f5f5f5;">
            <p style="font-family:'Space Mono',monospace; font-size:0.8rem;">Conversación cerrada.</p>
        </div>
    ` : '')));

    body.innerHTML = `
        ${metaBlock}
        ${actionsBlock}
        <div class="drawer-section" style="background:#fff;">
            <div class="drawer-section-title">Transcript</div>
            <div id="chat-transcript" style="max-height:420px; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding:8px; border:2px solid var(--bauhaus-black,#0A0A0A); background:#fafafa;">
                ${messagesHTML}
            </div>
        </div>
        ${composerBlock}
    `;

    // autoscroll
    const t = document.getElementById('chat-transcript');
    if (t) t.scrollTop = t.scrollHeight;
}

function renderChatMessage(msg) {
    const role = msg.role || 'user';
    const time = msg.created_at ? new Date(msg.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '';
    const common = `padding:8px 10px; font-size:0.85rem; line-height:1.35; border:2px solid var(--bauhaus-black,#0A0A0A); max-width:85%; word-wrap:break-word;`;

    if (role === 'user') {
        return `<div style="align-self:flex-end; background:#0A0A0A; color:#F2F0E9; ${common}">
            <div>${escapeHtml(msg.content || '')}</div>
            <div style="font-family:'Space Mono',monospace; font-size:0.65rem; opacity:0.6; margin-top:4px;">USER · ${time}</div>
        </div>`;
    }
    if (role === 'assistant') {
        return `<div style="align-self:flex-start; background:#fff; ${common}">
            <div>${escapeHtml(msg.content || '')}</div>
            <div style="font-family:'Space Mono',monospace; font-size:0.65rem; opacity:0.6; margin-top:4px;">BOT${msg.model ? ' · ' + msg.model : ''} · ${time}</div>
        </div>`;
    }
    if (role === 'human_agent') {
        return `<div style="align-self:flex-start; background:var(--bauhaus-red,#E23E28); color:#fff; ${common}">
            <div>${escapeHtml(msg.content || '')}</div>
            <div style="font-family:'Space Mono',monospace; font-size:0.65rem; opacity:0.85; margin-top:4px;">AGENT · ${time}</div>
        </div>`;
    }
    if (role === 'system') {
        return `<div style="align-self:center; background:transparent; border:1px dashed var(--bauhaus-black,#0A0A0A); font-style:italic; font-size:0.75rem; ${common}">
            <div>${escapeHtml(msg.content || '')}</div>
        </div>`;
    }
    if (role === 'tool') {
        return `<div style="align-self:flex-start; background:#eef; border:1px dashed #88a; font-family:'Space Mono',monospace; font-size:0.7rem; ${common}">
            <div><strong>TOOL</strong> ${escapeHtml(msg.content || '').slice(0, 200)}</div>
        </div>`;
    }
    return '';
}

// --- Actions ---

async function _getSupportAuthToken() {
    const { data: { session } } = await _supabase.auth.getSession();
    return session?.access_token;
}

async function _postSupportChatAPI(path, payload) {
    const token = await _getSupportAuthToken();
    const res = await fetch(path, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload || {})
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
}

window.assignChat = async function(conversationId) {
    try {
        await _postSupportChatAPI('/api/support-chat/assign', { conversation_id: conversationId });
        // refresh local record
        const updated = await _supabase.from('support_conversations').select('*').eq('id', conversationId).single();
        if (updated.data) {
            const idx = chats.findIndex(c => c.id === conversationId);
            if (idx >= 0) chats[idx] = updated.data;
            if (activeChatId === conversationId) renderChatDrawerBody(updated.data);
            applyFiltersAndSort();
        }
    } catch (err) {
        alert('Error tomando conversación: ' + err.message);
    }
};

window.releaseChat = async function(conversationId) {
    try {
        await _postSupportChatAPI('/api/support-chat/release', { conversation_id: conversationId });
        const updated = await _supabase.from('support_conversations').select('*').eq('id', conversationId).single();
        if (updated.data) {
            const idx = chats.findIndex(c => c.id === conversationId);
            if (idx >= 0) chats[idx] = updated.data;
            if (activeChatId === conversationId) renderChatDrawerBody(updated.data);
            applyFiltersAndSort();
        }
    } catch (err) {
        alert('Error devolviendo al bot: ' + err.message);
    }
};

window.closeChat = async function(conversationId) {
    if (!confirm('¿Cerrar esta conversación?')) return;
    try {
        await _postSupportChatAPI('/api/support-chat/close', { conversation_id: conversationId });
        const updated = await _supabase.from('support_conversations').select('*').eq('id', conversationId).single();
        if (updated.data) {
            const idx = chats.findIndex(c => c.id === conversationId);
            if (idx >= 0) chats[idx] = updated.data;
            if (activeChatId === conversationId) renderChatDrawerBody(updated.data);
            applyFiltersAndSort();
        }
    } catch (err) {
        alert('Error cerrando: ' + err.message);
    }
};

window.sendAgentMessage = async function(conversationId) {
    const input = document.getElementById('chat-agent-input');
    if (!input) return;
    const content = (input.value || '').trim();
    if (!content) return;
    input.disabled = true;
    try {
        await _postSupportChatAPI('/api/support-chat/agent-message', {
            conversation_id: conversationId,
            content
        });
        input.value = '';
        // el mensaje entrará via realtime; pero forzamos refresh por si acaso
        const msgsRes = await _supabase
            .from('support_messages')
            .select('*')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true });
        if (!msgsRes.error) {
            chatMessages = msgsRes.data || [];
            const chat = chats.find(c => c.id === conversationId);
            if (chat) renderChatDrawerBody(chat);
        }
    } catch (err) {
        alert('Error enviando: ' + err.message);
    } finally {
        input.disabled = false;
        input.focus();
    }
};

// --- Realtime ---

function subscribeChatsInbox() {
    if (chatRealtimeChannel) return;
    try {
        chatRealtimeChannel = _supabase
            .channel('support-inbox')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'support_conversations'
            }, (payload) => {
                const row = payload.new || payload.old;
                if (!row) return;
                if (payload.eventType === 'DELETE') {
                    chats = chats.filter(c => c.id !== row.id);
                } else {
                    const idx = chats.findIndex(c => c.id === row.id);
                    if (idx >= 0) chats[idx] = payload.new;
                    else chats.unshift(payload.new);
                }
                if (activeTab === 'chats') applyFiltersAndSort();
                updateChatsBadge();
                // si la convo abierta cambió, refresh meta/acciones
                if (activeChatId && payload.new && payload.new.id === activeChatId) {
                    renderChatDrawerBody(payload.new);
                }
            })
            .subscribe();
    } catch (err) {
        console.warn('Chat inbox realtime error:', err);
    }
}

function subscribeChatMessages(conversationId) {
    unsubscribeChatMessages();
    try {
        chatMessagesChannel = _supabase
            .channel('support-msgs-' + conversationId)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'support_messages',
                filter: `conversation_id=eq.${conversationId}`
            }, (payload) => {
                if (!payload.new) return;
                if (chatMessages.some(m => m.id === payload.new.id)) return;
                chatMessages.push(payload.new);
                const chat = chats.find(c => c.id === conversationId);
                if (chat) renderChatDrawerBody(chat);
            })
            .subscribe();
    } catch (err) {
        console.warn('Chat messages realtime error:', err);
    }
}

function unsubscribeChatMessages() {
    if (chatMessagesChannel) {
        try { _supabase.removeChannel(chatMessagesChannel); } catch {}
        chatMessagesChannel = null;
    }
}

function updateChatsBadge() {
    const pending = chats.filter(c => c.status === 'awaiting_human').length;
    ['nav-chats-badge', 'tab-chats-badge'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (pending > 0) {
            el.textContent = String(pending);
            el.style.display = 'inline-block';
        } else {
            el.style.display = 'none';
        }
    });
}
