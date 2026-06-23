// ============================================
// WE OTZI - JOB BOARD FEED
// Public directory of tattoo requests
// ============================================

// ============ UTILS ============

function parseStyles(styles) {
    if (!styles) return [];
    if (Array.isArray(styles)) return styles;
    if (typeof styles === 'string') {
        try {
            if (styles.startsWith('[')) return JSON.parse(styles);
            return styles.split(',').map(s => s.trim()).filter(Boolean);
        } catch (e) {
            return [styles];
        }
    }
    return [String(styles)];
}

function truncate(text, maxLen) {
    if (!text || typeof text !== 'string') return '';
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen).trimEnd() + '...';
}

function formatBudgetRange(min, max, currency) {
    const cur = currency || 'USD';
    if (min && max) {
        return `$${Number(min).toLocaleString()} - $${Number(max).toLocaleString()} ${cur}`;
    }
    if (min) return `Desde $${Number(min).toLocaleString()} ${cur}`;
    if (max) return `Hasta $${Number(max).toLocaleString()} ${cur}`;
    return 'A convenir';
}

function getDaysLeft(expiresAt) {
    if (!expiresAt) return null;
    const now = new Date();
    const expires = new Date(expiresAt);
    const diff = expires - now;
    if (diff <= 0) return 0;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getStyleNames(styleJson) {
    return parseStyles(styleJson).map(s => {
        if (typeof s === 'string') return s;
        if (s && s.label) return s.label;
        return String(s);
    });
}

function toTitleCase(str) {
    if (!str || typeof str !== 'string') return '';
    return str.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

function showLoading() { document.getElementById('loading-overlay')?.classList.remove('hidden'); }
function hideLoading() { document.getElementById('loading-overlay')?.classList.add('hidden'); }

async function waitForConfigManager(maxWait = 3000) {
    const start = Date.now();
    while (!window.ConfigManager && (Date.now() - start) < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

// ============================================
// STATE
// ============================================

let allRequests = [];
let filteredRequests = [];
let currentPage = 1;
const ITEMS_PER_PAGE = 20;
let _supabase = null;
let currentUser = null;
let isArtist = false;
let artistData = null;
let artistAuthStatus = 'anonymous';
let jobBoardAuthUrls = {
    registerClosedBeta: '/registerclosedbeta',
    login: '/registerclosedbeta?returnTo=%2Fjob-board',
    registerArtist: '/register-artist?returnTo=%2Fjob-board',
    dashboard: '/artist/dashboard',
    jobBoard: '/job-board'
};
let currentFilters = {
    search: '',
    style: null,
    city: null,
    size: null,
    budget: null,
    sort: 'newest'
};
let selectedRequest = null;
let searchDebounceTimer = null;

const TOP_STYLES = [
    { label: 'Realismo', icon: 'fa-solid fa-eye' },
    { label: 'Tradicional', icon: 'fa-solid fa-anchor' },
    { label: 'Fine Line', icon: 'fa-solid fa-pen-nib' },
    { label: 'Blackwork', icon: 'fa-solid fa-brush' },
    { label: 'Minimalista', icon: 'fa-solid fa-minus' },
    { label: 'Japonés', icon: 'fa-solid fa-dragon' },
    { label: 'Geométrico', icon: 'fa-solid fa-shapes' },
    { label: 'Acuarela', icon: 'fa-solid fa-droplet' },
    { label: 'Black & Grey', icon: 'fa-solid fa-circle-half-stroke' },
    { label: 'Microrealismo', icon: 'fa-solid fa-magnifying-glass' },
    { label: 'Hiperrealismo', icon: 'fa-solid fa-eye' },
    { label: 'Ornamental', icon: 'fa-solid fa-fan' },
    { label: 'Mandala', icon: 'fa-solid fa-circle-dot' },
    { label: 'Tribal', icon: 'fa-solid fa-bolt' },
    { label: 'Polinesio', icon: 'fa-solid fa-water' },
    { label: 'Maori', icon: 'fa-solid fa-shield-halved' },
    { label: 'Haida', icon: 'fa-solid fa-feather' },
    { label: 'Celta', icon: 'fa-solid fa-ring' },
    { label: 'Nordico / Viking', icon: 'fa-solid fa-mountain' },
    { label: 'Lettering', icon: 'fa-solid fa-font' },
    { label: 'Blackletter / Gotico', icon: 'fa-solid fa-book' },
    { label: 'Caligrafia', icon: 'fa-solid fa-pen-fancy' },
    { label: 'Ignorant', icon: 'fa-solid fa-pencil' },
    { label: 'Handpoke / Stick and Poke', icon: 'fa-solid fa-hand-point-up' },
    { label: 'Abstracto', icon: 'fa-solid fa-shapes' },
    { label: 'Sketch / Boceto', icon: 'fa-solid fa-pencil' },
    { label: 'Etching / Grabado', icon: 'fa-solid fa-layer-group' },
    { label: 'Woodcut / Xilografia', icon: 'fa-solid fa-tree' },
    { label: 'Linework', icon: 'fa-solid fa-pen-nib' },
    { label: 'Ilustracion botanica', icon: 'fa-solid fa-leaf' },
    { label: 'Floral', icon: 'fa-solid fa-spa' },
    { label: 'Fineline botanico', icon: 'fa-solid fa-seedling' },
    { label: 'Biomecanico', icon: 'fa-solid fa-gears' },
    { label: 'Bioorganico', icon: 'fa-solid fa-dna' },
    { label: 'Horror', icon: 'fa-solid fa-ghost' },
    { label: 'Dark Art', icon: 'fa-solid fa-moon' },
    { label: 'Glitch', icon: 'fa-solid fa-wave-square' },
    { label: 'Pixel Art', icon: 'fa-solid fa-border-all' },
    { label: 'Graffiti', icon: 'fa-solid fa-spray-can' },
    { label: 'Pop Art', icon: 'fa-solid fa-star' },
    { label: 'Art Nouveau', icon: 'fa-solid fa-fan' },
    { label: 'Art Deco', icon: 'fa-solid fa-gem' },
    { label: 'Barroco', icon: 'fa-solid fa-landmark' },
    { label: 'Abstract Brush', icon: 'fa-solid fa-brush' },
    { label: 'Patchwork', icon: 'fa-solid fa-table-cells-large' },
    { label: 'Religious / Sacro', icon: 'fa-solid fa-church' },
    { label: 'Ornamental Blackwork', icon: 'fa-solid fa-circle' },
    { label: 'Pointillism', icon: 'fa-solid fa-braille' }
];

// Size mapping for filter matching
const SIZE_MAP = {
    'small': ['pequeño', 'pequeno', 'small'],
    'medium': ['mediano', 'medium'],
    'large': ['grande', 'large', 'media_manga', 'media manga'],
    'xlarge': ['muy_grande', 'muy grande', 'manga_completa', 'manga completa', 'espalda_completa', 'espalda completa', 'pecho_completo', 'pecho completo', 'xlarge']
};

const DASHBOARD_MOBILE_MENU_BREAKPOINT = 768;

function setDashboardMobileMenuOpen(isOpen) {
    const toggleBtn = document.getElementById('dashboard-mobile-menu-toggle');
    const menu = document.getElementById('dashboard-mobile-menu');
    if (!toggleBtn || !menu) return;

    const shouldOpen = Boolean(isOpen);
    menu.hidden = !shouldOpen;
    toggleBtn.setAttribute('aria-expanded', String(shouldOpen));
}

function setupDashboardNavigationMenu() {
    const toggleBtn = document.getElementById('dashboard-mobile-menu-toggle');
    const menu = document.getElementById('dashboard-mobile-menu');
    if (!toggleBtn || !menu) return;
    if (toggleBtn.dataset.menuBound === 'true') return;

    setDashboardMobileMenuOpen(false);

    toggleBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const shouldOpen = toggleBtn.getAttribute('aria-expanded') !== 'true';
        setDashboardMobileMenuOpen(shouldOpen);
    });

    menu.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => {
            setDashboardMobileMenuOpen(false);
        });
    });

    document.addEventListener('click', (event) => {
        if (menu.hidden) return;
        if (menu.contains(event.target)) return;
        if (toggleBtn.contains(event.target)) return;
        setDashboardMobileMenuOpen(false);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            setDashboardMobileMenuOpen(false);
        }
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > DASHBOARD_MOBILE_MENU_BREAKPOINT) {
            setDashboardMobileMenuOpen(false);
        }
    });

    toggleBtn.dataset.menuBound = 'true';
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    showLoading();
    try {
        setupDashboardNavigationMenu();
        await checkAuthState();

        if (!_supabase) {
            console.warn('ConfigManager not available or in demo mode');
            hideLoading();
            renderFeed();
            return;
        }

        // Fetch open requests
        await fetchRequests();
        console.log('Job Board loaded with', allRequests.length, 'open requests');

        if (allRequests.length > 0) {
            initStyleFilters();
            initAdvancedFilters();
            applyFilters();
        } else {
            renderFeed();
        }

        // Setup search and event listeners
        setupSearch();
        setupModalListeners();
        setupPaginationListeners();

    } catch (err) {
        console.error('Error initializing job board feed:', err);
        renderFeed();
    } finally {
        hideLoading();
    }
});

// ============================================
// AUTH
// ============================================

async function checkAuthState() {
    try {
        if (!window.ArtistAuth || typeof window.ArtistAuth.resolveArtistAuthState !== 'function') {
            throw new Error('ArtistAuth helper is not available.');
        }

        const authState = await window.ArtistAuth.resolveArtistAuthState({
            artistSelect: 'user_id, username, name',
            returnTo: '/job-board',
            fallbackReturnTo: '/job-board'
        });

        artistAuthStatus = authState.status;
        _supabase = authState.supabase;
        currentUser = authState.currentUser;
        isArtist = authState.isArtist;
        artistData = authState.artist;

        if (authState.urls) {
            jobBoardAuthUrls = authState.urls;
        }

        if (authState.status === 'artist_lookup_failed' && _supabase && currentUser) {
            console.warn('Job Board: artist lookup failed, retrying directly...');
            try {
                const { data: retryArtist } = await _supabase
                    .from('artists_db')
                    .select('user_id, username, name')
                    .eq('user_id', currentUser.id)
                    .maybeSingle();
                if (retryArtist && String(retryArtist.name || '').trim()) {
                    isArtist = true;
                    artistData = retryArtist;
                    artistAuthStatus = 'authenticated_artist';
                } else {
                    artistAuthStatus = retryArtist ? 'profile_incomplete' : 'authenticated_non_artist';
                }
            } catch (retryErr) {
                console.warn('Artist retry also failed:', retryErr);
                artistAuthStatus = 'authenticated_non_artist';
            }
        }

        updateHeaderAuth();

    } catch (err) {
        console.error('Error checking auth state:', err);
        artistAuthStatus = 'auth_error';
        _supabase = null;
        currentUser = null;
        isArtist = false;
        artistData = null;
        updateHeaderAuth();
    }
}

function updateHeaderAuth() {
    const authBtn = document.getElementById('auth-nav-btn');
    const authLabel = document.getElementById('auth-nav-label');
    if (!authBtn || !authLabel) return;

    if (currentUser && isArtist) {
        authLabel.textContent = artistData?.username || 'Mi Panel';
        authBtn.href = jobBoardAuthUrls.dashboard;
        authBtn.querySelector('i')?.setAttribute('class', 'fa-solid fa-user');
    } else if (currentUser) {
        authLabel.textContent = 'Completar Perfil';
        authBtn.href = jobBoardAuthUrls.registerArtist;
        authBtn.querySelector('i')?.setAttribute('class', 'fa-solid fa-user');
    } else {
        authLabel.textContent = 'Iniciar Sesion';
        authBtn.href = jobBoardAuthUrls.login;
        authBtn.querySelector('i')?.setAttribute('class', 'fa-solid fa-right-to-bracket');
    }
}

// ============================================
// DATA FETCHING
// ============================================

async function fetchRequests() {
    if (!_supabase) {
        allRequests = [];
        return;
    }

    try {
        const { data, error } = await WeotziData
            .from('job_board_requests')
            .select('*, job_board_attachments(id, file_url, file_name, sort_order)')
            .eq('status', 'open')
            .eq('is_public', true)
            .order('created_at', { ascending: false });

        if (error) throw error;

        allRequests = (data || []).map(r => ({
            ...r,
            // Ensure application_count is a number
            application_count: r.application_count || 0,
            // Parse styles for consistency
            _parsedStyles: getStyleNames(r.tattoo_style)
        }));

    } catch (err) {
        console.error('Error fetching job board requests:', err);
        allRequests = [];
    }
}

// ============================================
// STYLE FILTERS
// ============================================

function initStyleFilters() {
    const container = document.getElementById('style-filters');
    if (!container) return;

    container.innerHTML = TOP_STYLES.map(style => {
        const count = allRequests.filter(r => {
            return r._parsedStyles.some(s => s.toLowerCase() === style.label.toLowerCase());
        }).length;

        return `
            <button class="filter-btn jb-filter-btn" onclick="toggleStyleFilter('${style.label}')" data-style="${style.label}">
                <i class="${style.icon}"></i>
                <span>${style.label} (${count})</span>
            </button>
        `;
    }).join('');
}

function toggleStyleFilter(styleName) {
    if (currentFilters.style === styleName) {
        currentFilters.style = null;
    } else {
        currentFilters.style = styleName;
    }

    // Update button active states
    document.querySelectorAll('.jb-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.style === currentFilters.style);
    });

    applyFilters();
}

// ============================================
// ADVANCED FILTERS
// ============================================

function initAdvancedFilters() {
    if (!allRequests || allRequests.length === 0) return;

    // Populate city dropdown
    const cities = [...new Set(
        allRequests
            .map(r => r.client_city)
            .filter(Boolean)
            .map(c => c.trim())
    )].sort();

    const citySelect = document.getElementById('filter-city');
    if (citySelect) {
        citySelect.innerHTML = '<option value="">Todas las ciudades</option>';
        cities.forEach(city => {
            const count = allRequests.filter(r => (r.client_city || '').trim() === city).length;
            const opt = document.createElement('option');
            opt.value = city;
            opt.textContent = `${toTitleCase(city)} (${count})`;
            citySelect.appendChild(opt);
        });

        citySelect.addEventListener('change', () => {
            currentFilters.city = citySelect.value || null;
            applyFilters();
        });
    }

    // Size filter listener
    const sizeSelect = document.getElementById('filter-size');
    if (sizeSelect) {
        sizeSelect.addEventListener('change', () => {
            currentFilters.size = sizeSelect.value || null;
            applyFilters();
        });
    }

    // Budget filter listener
    const budgetSelect = document.getElementById('filter-budget');
    if (budgetSelect) {
        budgetSelect.addEventListener('change', () => {
            currentFilters.budget = budgetSelect.value || null;
            applyFilters();
        });
    }

    // Sort listener
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            currentFilters.sort = sortSelect.value || 'newest';
            applyFilters();
        });
    }

    // Clear filters button
    const clearBtn = document.getElementById('btn-clear-filters');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearAllFilters);
    }
}

// ============================================
// FILTER LOGIC
// ============================================

function applyFilters() {
    filteredRequests = allRequests.filter(request => {
        // Search filter
        if (currentFilters.search) {
            const query = currentFilters.search.toLowerCase();
            const description = (request.tattoo_idea_description || '').toLowerCase();
            const city = (request.client_city || '').toLowerCase();
            const bodyPart = (request.tattoo_body_part || '').toLowerCase();
            const styles = (request._parsedStyles || []).map(s => s.toLowerCase());
            const code = (request.request_code || '').toLowerCase();

            const matchSearch =
                description.includes(query) ||
                city.includes(query) ||
                bodyPart.includes(query) ||
                styles.some(s => s.includes(query)) ||
                code.includes(query);

            if (!matchSearch) return false;
        }

        // Style filter
        if (currentFilters.style) {
            const styles = (request._parsedStyles || []).map(s => s.toLowerCase());
            if (!styles.some(s => s.includes(currentFilters.style.toLowerCase()))) return false;
        }

        // City filter
        if (currentFilters.city) {
            if ((request.client_city || '').trim() !== currentFilters.city) return false;
        }

        // Size filter
        if (currentFilters.size) {
            const requestSize = (request.tattoo_size || '').toLowerCase().replace(/\s+/g, '_');
            const validSizes = SIZE_MAP[currentFilters.size] || [];
            if (!validSizes.some(s => requestSize.includes(s.replace(/\s+/g, '_')) || requestSize.includes(s))) return false;
        }

        // Budget filter
        if (currentFilters.budget) {
            const budgetMin = parseFloat(request.client_budget_min) || 0;
            const budgetMax = parseFloat(request.client_budget_max) || 0;
            const effectiveBudget = budgetMax || budgetMin;

            if (currentFilters.budget === 'low' && effectiveBudget > 200) return false;
            if (currentFilters.budget === 'medium' && (effectiveBudget < 200 || effectiveBudget > 800)) return false;
            if (currentFilters.budget === 'high' && effectiveBudget < 800) return false;
        }

        return true;
    });

    // Sort
    sortRequests();

    // Reset pagination
    currentPage = 1;

    // Render
    renderFeed();
    updateActiveFiltersUI();
}

function sortRequests() {
    switch (currentFilters.sort) {
        case 'newest':
            filteredRequests.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            break;
        case 'budget-high':
            filteredRequests.sort((a, b) => {
                const aMax = parseFloat(b.client_budget_max) || parseFloat(b.client_budget_min) || 0;
                const bMax = parseFloat(a.client_budget_max) || parseFloat(a.client_budget_min) || 0;
                return aMax - bMax;
            });
            break;
        case 'budget-low':
            filteredRequests.sort((a, b) => {
                const aMin = parseFloat(a.client_budget_min) || parseFloat(a.client_budget_max) || 0;
                const bMin = parseFloat(b.client_budget_min) || parseFloat(b.client_budget_max) || 0;
                return aMin - bMin;
            });
            break;
        case 'deadline':
            filteredRequests.sort((a, b) => {
                const aDate = a.expires_at ? new Date(a.expires_at) : new Date('2099-12-31');
                const bDate = b.expires_at ? new Date(b.expires_at) : new Date('2099-12-31');
                return aDate - bDate;
            });
            break;
        default:
            break;
    }
}

// ============================================
// RENDERING
// ============================================

function renderFeed() {
    const grid = document.getElementById('job-board-grid');
    const countEl = document.getElementById('results-count');
    const emptyState = document.getElementById('empty-state');

    if (!grid) return;

    const totalPages = Math.ceil(filteredRequests.length / ITEMS_PER_PAGE);
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const paginatedRequests = filteredRequests.slice(start, end);

    // Update results count
    if (countEl) {
        const total = filteredRequests.length;
        countEl.textContent = `${total} solicitud${total !== 1 ? 'es' : ''} encontrada${total !== 1 ? 's' : ''}`;
    }

    // Empty state
    if (filteredRequests.length === 0) {
        grid.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        updatePaginationUI(0);
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    // Render cards
    grid.innerHTML = paginatedRequests.map(request => renderRequestCard(request)).join('');

    // Update pagination
    updatePaginationUI(totalPages);
}

function renderRequestCard(request) {
    // Get thumbnail from attachments
    const attachments = request.job_board_attachments || [];
    const sortedAttachments = [...attachments].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const thumbnail = sortedAttachments.length > 0 ? sortedAttachments[0].file_url : null;

    // Style tags
    const styles = request._parsedStyles || [];
    const styleTag = styles.slice(0, 2).map(s =>
        `<span class="jb-card-tag jb-card-tag--style">${escapeHtml(s)}</span>`
    ).join('');

    // Size tag
    const sizeLabel = request.tattoo_size ? toTitleCase(request.tattoo_size.replace(/_/g, ' ')) : '';
    const sizeTag = sizeLabel ? `<span class="jb-card-tag jb-card-tag--size">${escapeHtml(sizeLabel)}</span>` : '';

    // Color tag
    const colorLabel = request.tattoo_color_type || '';
    const colorTag = colorLabel ? `<span class="jb-card-tag jb-card-tag--color">${escapeHtml(colorLabel)}</span>` : '';

    // Location & body part
    const city = request.client_city ? toTitleCase(request.client_city) : 'No especificada';
    const bodyPart = request.tattoo_body_part ? toTitleCase(request.tattoo_body_part.replace(/_/g, ' ')) : '';

    // Budget
    const budgetRange = formatBudgetRange(request.client_budget_min, request.client_budget_max, request.client_budget_currency);

    // Days left
    const daysLeft = getDaysLeft(request.expires_at);
    const daysLeftText = daysLeft !== null
        ? (daysLeft === 0 ? 'Ultimo dia' : `${daysLeft} dia${daysLeft !== 1 ? 's' : ''} restante${daysLeft !== 1 ? 's' : ''}`)
        : 'Sin fecha limite';

    // Application count
    const appCount = request.application_count || 0;

    // Request code
    const code = request.request_code || '';

    // Description
    const description = truncate(request.tattoo_idea_description || '', 120);

    // Button state
    const applyBtnText = isArtist
        ? 'POSTULARME'
        : currentUser
            ? 'COMPLETAR PERFIL'
            : 'INICIA SESION';
    const applyBtnDisabled = '';

    return `
        <div class="jb-card" onclick="viewRequest('${request.id}')">
            <div class="jb-card-image ${!thumbnail ? 'no-image' : ''}">
                ${thumbnail ? `<img src="${thumbnail}" alt="Referencia" loading="lazy" onerror="this.parentElement.classList.add('no-image'); this.remove();">` : ''}
                <span class="jb-card-code">${escapeHtml(code)}</span>
            </div>
            <div class="jb-card-body">
                <p class="jb-card-description">${escapeHtml(description)}</p>
                <div class="jb-card-tags">
                    ${styleTag}${sizeTag}${colorTag}
                </div>
                <div class="jb-card-meta">
                    ${city ? `<span class="jb-card-meta-item"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(city)}</span>` : ''}
                    ${bodyPart ? `<span class="jb-card-meta-item"><i class="fa-solid fa-hand"></i> ${escapeHtml(bodyPart)}</span>` : ''}
                </div>
            </div>
            <div class="jb-card-stats">
                <span>${appCount} postulacion${appCount !== 1 ? 'es' : ''}</span>
                <span>${daysLeftText}</span>
            </div>
            <div class="jb-card-footer">
                <div class="jb-card-budget">${budgetRange}</div>
                <button class="jb-card-apply-btn" onclick="event.stopPropagation(); handleApply('${request.id}')" ${applyBtnDisabled}>
                    ${applyBtnText}
                </button>
            </div>
        </div>
    `;
}

function escapeHtml(text) {
    if (!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, c => map[c]);
}

// ============================================
// ACTIVE FILTERS UI
// ============================================

function updateActiveFiltersUI() {
    const container = document.getElementById('active-filters-display');
    if (!container) return;

    const activeFilters = [];
    if (currentFilters.search) activeFilters.push({ type: 'search', label: `"${currentFilters.search}"` });
    if (currentFilters.style) activeFilters.push({ type: 'style', label: `Estilo: ${currentFilters.style}` });
    if (currentFilters.city) activeFilters.push({ type: 'city', label: `Ciudad: ${toTitleCase(currentFilters.city)}` });
    if (currentFilters.size) {
        const sizeLabels = { small: 'Pequeno', medium: 'Mediano', large: 'Grande', xlarge: 'Muy Grande' };
        activeFilters.push({ type: 'size', label: `Tamano: ${sizeLabels[currentFilters.size] || currentFilters.size}` });
    }
    if (currentFilters.budget) {
        const budgetLabels = { low: 'Hasta $200', medium: '$200-$800', high: '$800+' };
        activeFilters.push({ type: 'budget', label: `Presupuesto: ${budgetLabels[currentFilters.budget] || currentFilters.budget}` });
    }

    if (activeFilters.length > 0) {
        container.innerHTML = activeFilters.map(f => `
            <div class="filter-chip">
                <span>${f.label}</span>
                <button onclick="removeFilter('${f.type}')">&times;</button>
            </div>
        `).join('') + `
            <button class="filter-chip filter-chip--clear" onclick="clearAllFilters()">
                <i class="fa-solid fa-xmark"></i> Limpiar filtros
            </button>
        `;
    } else {
        container.innerHTML = '';
    }

    // Sync select dropdowns with current state
    const citySelect = document.getElementById('filter-city');
    const sizeSelect = document.getElementById('filter-size');
    const budgetSelect = document.getElementById('filter-budget');
    const sortSelect = document.getElementById('sort-select');

    if (citySelect) citySelect.value = currentFilters.city || '';
    if (sizeSelect) sizeSelect.value = currentFilters.size || '';
    if (budgetSelect) budgetSelect.value = currentFilters.budget || '';
    if (sortSelect) sortSelect.value = currentFilters.sort || 'newest';

    // Sync style buttons
    document.querySelectorAll('.jb-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.style === currentFilters.style);
    });
}

function removeFilter(type) {
    if (type === 'search') {
        currentFilters.search = '';
        const searchInput = document.getElementById('smart-search');
        if (searchInput) searchInput.value = '';
    } else {
        currentFilters[type] = null;
    }
    applyFilters();
}

function clearAllFilters() {
    currentFilters = {
        search: '',
        style: null,
        city: null,
        size: null,
        budget: null,
        sort: 'newest'
    };
    const searchInput = document.getElementById('smart-search');
    if (searchInput) searchInput.value = '';
    applyFilters();
}

// ============================================
// PAGINATION
// ============================================

function updatePaginationUI(totalPages) {
    const container = document.getElementById('pagination-controls');
    const info = document.getElementById('page-info');
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');

    if (!container || totalPages <= 1) {
        container?.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    info.textContent = `Pagina ${currentPage} de ${totalPages}`;

    prevBtn.disabled = currentPage === 1;
    nextBtn.disabled = currentPage === totalPages;

    prevBtn.style.opacity = currentPage === 1 ? '0.3' : '1';
    nextBtn.style.opacity = currentPage === totalPages ? '0.3' : '1';
}

function changePage(delta) {
    const totalPages = Math.ceil(filteredRequests.length / ITEMS_PER_PAGE);
    const newPage = currentPage + delta;

    if (newPage >= 1 && newPage <= totalPages) {
        currentPage = newPage;
        renderFeed();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function setupPaginationListeners() {
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');

    if (prevBtn) prevBtn.addEventListener('click', () => changePage(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => changePage(1));
}

// ============================================
// SEARCH
// ============================================

function setupSearch() {
    const input = document.getElementById('smart-search');
    if (!input) return;

    // Debounced input search
    input.addEventListener('input', (e) => {
        const val = e.target.value.trim();

        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            currentFilters.search = val;
            applyFilters();
        }, 300);
    });

    // Immediate search on Enter
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
            currentFilters.search = input.value.trim();
            applyFilters();
        }
    });
}

// ============================================
// APPLICATION FLOW
// ============================================

async function handleApply(requestId) {
    if (!currentUser) {
        showLoginModal();
        return;
    }

    if (!isArtist) {
        window.location.href = jobBoardAuthUrls.registerArtist;
        return;
    }

    // Find the request
    const request = allRequests.find(r => r.id === requestId);
    if (!request) {
        showToast('Solicitud no encontrada.', 'error');
        return;
    }

    try {
        // Check if already applied
        const { data: existingApp, error: checkError } = await WeotziData
            .from('job_board_applications')
            .select('id')
            .eq('request_id', requestId)
            .eq('artist_id', artistData.user_id)
            .maybeSingle();

        if (checkError) throw checkError;

        if (existingApp) {
            showToast('Ya te postulaste a esta solicitud.', 'warning');
            return;
        }

        // Check max applications
        if (request.max_applications && request.application_count >= request.max_applications) {
            showToast('Esta solicitud ya alcanzo el maximo de postulaciones.', 'warning');
            return;
        }

        // Store selected request and open modal
        selectedRequest = request;
        openApplicationModal(request);

    } catch (err) {
        console.error('Error checking application status:', err);
        showToast('Error al verificar postulacion. Intenta nuevamente.', 'error');
    }
}

function openApplicationModal(request) {
    const modal = document.getElementById('application-modal');
    const codeEl = document.getElementById('modal-request-code');
    const summaryEl = document.getElementById('modal-request-summary');
    const form = document.getElementById('application-form');

    if (!modal || !summaryEl) return;

    // Set request code
    if (codeEl) codeEl.textContent = request.request_code || '';

    // Build summary HTML
    const styles = (request._parsedStyles || []).join(', ') || 'No especificado';
    const budgetRange = formatBudgetRange(request.client_budget_min, request.client_budget_max, request.client_budget_currency);
    const bodyPart = request.tattoo_body_part ? toTitleCase(request.tattoo_body_part.replace(/_/g, ' ')) : 'No especificado';
    const size = request.tattoo_size ? toTitleCase(request.tattoo_size.replace(/_/g, ' ')) : 'No especificado';
    const city = request.client_city ? toTitleCase(request.client_city) : 'No especificada';
    const description = request.tattoo_idea_description || 'Sin descripcion';

    // Attachments gallery
    const attachments = request.job_board_attachments || [];
    const sortedAttachments = [...attachments].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const galleryHtml = sortedAttachments.length > 0
        ? `<div class="modal-gallery">
            ${sortedAttachments.map(att =>
                `<img src="${escapeHtml(att.file_url)}" alt="${escapeHtml(att.file_name || 'Referencia')}" class="modal-gallery-img" loading="lazy" onclick="window.open('${escapeHtml(att.file_url)}', '_blank')">`
            ).join('')}
           </div>`
        : '';

    summaryEl.innerHTML = `
        <div class="modal-detail-grid">
            <div class="modal-detail">
                <span class="modal-detail-label">Descripcion</span>
                <p class="modal-detail-value">${escapeHtml(description)}</p>
            </div>
            ${galleryHtml}
            <div class="modal-detail-row">
                <div class="modal-detail">
                    <span class="modal-detail-label">Estilos</span>
                    <span class="modal-detail-value">${escapeHtml(styles)}</span>
                </div>
                <div class="modal-detail">
                    <span class="modal-detail-label">Tamano</span>
                    <span class="modal-detail-value">${escapeHtml(size)}</span>
                </div>
                <div class="modal-detail">
                    <span class="modal-detail-label">Color</span>
                    <span class="modal-detail-value">${escapeHtml(request.tattoo_color_type || 'No especificado')}</span>
                </div>
            </div>
            <div class="modal-detail-row">
                <div class="modal-detail">
                    <span class="modal-detail-label">Zona del cuerpo</span>
                    <span class="modal-detail-value">${escapeHtml(bodyPart)}</span>
                </div>
                <div class="modal-detail">
                    <span class="modal-detail-label">Ciudad</span>
                    <span class="modal-detail-value">${escapeHtml(city)}</span>
                </div>
                <div class="modal-detail">
                    <span class="modal-detail-label">Presupuesto</span>
                    <span class="modal-detail-value">${budgetRange}</span>
                </div>
            </div>
        </div>
    `;

    // Reset and show form
    if (form) form.reset();

    // Show modal
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

async function submitApplication(e) {
    e.preventDefault();

    if (!selectedRequest || !artistData || !_supabase) {
        showToast('Error: datos incompletos. Recarga la pagina.', 'error');
        return;
    }

    const submitBtn = document.getElementById('btn-submit-application');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';
    }

    try {
        const message = document.getElementById('app-message')?.value?.trim();
        const rawPrice = document.getElementById('app-price')?.value?.trim();
        const rawSessions = document.getElementById('app-sessions')?.value?.trim();
        const availabilityNote = document.getElementById('app-availability')?.value?.trim() || null;

        if (!message || message.length < 10) {
            showToast('El mensaje debe tener al menos 10 caracteres.', 'error');
            resetSubmitButton();
            return;
        }

        const estimatedPrice = rawPrice ? parseFloat(rawPrice) : NaN;
        if (!rawPrice || isNaN(estimatedPrice) || estimatedPrice <= 0) {
            showToast('Ingresa un precio estimado valido (mayor a 0).', 'error');
            resetSubmitButton();
            return;
        }

        const estimatedSessions = rawSessions ? parseInt(rawSessions, 10) : NaN;
        if (!rawSessions || isNaN(estimatedSessions) || estimatedSessions < 1) {
            showToast('Ingresa al menos 1 sesion estimada.', 'error');
            resetSubmitButton();
            return;
        }

        // Insert application
        const { data: application, error: insertError } = await WeotziData
            .from('job_board_applications')
            .insert([{
                request_id: selectedRequest.id,
                artist_id: artistData.user_id,
                message: message,
                estimated_price: estimatedPrice,
                estimated_sessions: estimatedSessions,
                availability_note: availabilityNote,
                status: 'pending'
            }])
            .select()
            .single();

        if (insertError) throw insertError;

        // Increment application count locally
        const requestIndex = allRequests.findIndex(r => r.id === selectedRequest.id);
        if (requestIndex !== -1) {
            allRequests[requestIndex].application_count = (allRequests[requestIndex].application_count || 0) + 1;
        }

        // Trigger n8n event
        if (window.ConfigManager && typeof window.ConfigManager.sendN8NEvent === 'function') {
            try {
                await window.ConfigManager.sendN8NEvent('job_board_application_received', {
                    application_id: application.id,
                    request_id: selectedRequest.id,
                    request_code: selectedRequest.request_code,
                    artist_id: artistData.user_id,
                    artist_username: artistData.username,
                    artist_name: artistData.name,
                    message: message,
                    estimated_price: estimatedPrice,
                    estimated_sessions: estimatedSessions,
                    timestamp: new Date().toISOString()
                });
            } catch (n8nErr) {
                console.warn('n8n event failed (non-blocking):', n8nErr);
            }
        }

        // Close modal and show success
        closeApplicationModal();
        showToast('Postulacion enviada con exito.', 'success');

        // Re-render to update card
        applyFilters();

    } catch (err) {
        console.error('Error submitting application:', err);
        showToast('Error al enviar postulacion. Intenta nuevamente.', 'error');
    } finally {
        resetSubmitButton();
    }
}

function resetSubmitButton() {
    const submitBtn = document.getElementById('btn-submit-application');
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar postulacion';
    }
}

// ============================================
// VIEW REQUEST DETAIL
// ============================================

function viewRequest(requestId) {
    const request = allRequests.find(r => r.id === requestId);
    if (!request) return;

    if (currentUser && isArtist) {
        // Artist: open application modal with details
        selectedRequest = request;
        openApplicationModal(request);
    } else {
        // Non-artist or not logged in: open application modal in read-only,
        // but show login prompt instead of form
        openDetailModal(request);
    }
}

function openDetailModal(request) {
    const modal = document.getElementById('application-modal');
    const codeEl = document.getElementById('modal-request-code');
    const summaryEl = document.getElementById('modal-request-summary');
    const form = document.getElementById('application-form');

    if (!modal || !summaryEl) return;

    // Set request code
    if (codeEl) codeEl.textContent = request.request_code || '';

    // Build summary HTML (same as openApplicationModal)
    const styles = (request._parsedStyles || []).join(', ') || 'No especificado';
    const budgetRange = formatBudgetRange(request.client_budget_min, request.client_budget_max, request.client_budget_currency);
    const bodyPart = request.tattoo_body_part ? toTitleCase(request.tattoo_body_part.replace(/_/g, ' ')) : 'No especificado';
    const size = request.tattoo_size ? toTitleCase(request.tattoo_size.replace(/_/g, ' ')) : 'No especificado';
    const city = request.client_city ? toTitleCase(request.client_city) : 'No especificada';
    const description = request.tattoo_idea_description || 'Sin descripcion';

    const attachments = request.job_board_attachments || [];
    const sortedAttachments = [...attachments].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const galleryHtml = sortedAttachments.length > 0
        ? `<div class="modal-gallery">
            ${sortedAttachments.map(att =>
                `<img src="${escapeHtml(att.file_url)}" alt="${escapeHtml(att.file_name || 'Referencia')}" class="modal-gallery-img" loading="lazy" onclick="window.open('${escapeHtml(att.file_url)}', '_blank')">`
            ).join('')}
           </div>`
        : '';

    summaryEl.innerHTML = `
        <div class="modal-detail-grid">
            <div class="modal-detail">
                <span class="modal-detail-label">Descripcion</span>
                <p class="modal-detail-value">${escapeHtml(description)}</p>
            </div>
            ${galleryHtml}
            <div class="modal-detail-row">
                <div class="modal-detail">
                    <span class="modal-detail-label">Estilos</span>
                    <span class="modal-detail-value">${escapeHtml(styles)}</span>
                </div>
                <div class="modal-detail">
                    <span class="modal-detail-label">Tamano</span>
                    <span class="modal-detail-value">${escapeHtml(size)}</span>
                </div>
                <div class="modal-detail">
                    <span class="modal-detail-label">Color</span>
                    <span class="modal-detail-value">${escapeHtml(request.tattoo_color_type || 'No especificado')}</span>
                </div>
            </div>
            <div class="modal-detail-row">
                <div class="modal-detail">
                    <span class="modal-detail-label">Zona del cuerpo</span>
                    <span class="modal-detail-value">${escapeHtml(bodyPart)}</span>
                </div>
                <div class="modal-detail">
                    <span class="modal-detail-label">Ciudad</span>
                    <span class="modal-detail-value">${escapeHtml(city)}</span>
                </div>
                <div class="modal-detail">
                    <span class="modal-detail-label">Presupuesto</span>
                    <span class="modal-detail-value">${budgetRange}</span>
                </div>
            </div>
        </div>
        <div class="modal-login-prompt">
            <i class="fa-solid fa-lock"></i>
            <p>${currentUser ? 'Completa tu perfil de artista para postularte a esta solicitud.' : 'Inicia sesion como artista para postularte a esta solicitud.'}</p>
            <div class="modal-actions">
                <a href="${currentUser ? jobBoardAuthUrls.registerArtist : jobBoardAuthUrls.login}" class="btn btn-primary">${currentUser ? 'Completar Perfil' : 'Iniciar Sesion'}</a>
                <a href="${currentUser ? jobBoardAuthUrls.dashboard : jobBoardAuthUrls.registerArtist}" class="btn btn-secondary">${currentUser ? 'Ir a mi Panel' : 'Registrarme'}</a>
            </div>
        </div>
    `;

    // Hide application form for non-artists
    if (form) form.style.display = 'none';

    // Show modal
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

// ============================================
// MODALS
// ============================================

function setupModalListeners() {
    // Application modal
    const appModal = document.getElementById('application-modal');
    const closeAppBtn = document.getElementById('btn-close-application');
    const appForm = document.getElementById('application-form');

    if (closeAppBtn) closeAppBtn.addEventListener('click', closeApplicationModal);
    if (appModal) {
        appModal.addEventListener('click', (e) => {
            if (e.target === appModal) closeApplicationModal();
        });
    }
    if (appForm) appForm.addEventListener('submit', submitApplication);

    // Login modal
    const loginModal = document.getElementById('login-modal');
    const closeLoginBtn = document.getElementById('btn-close-login');

    if (closeLoginBtn) closeLoginBtn.addEventListener('click', closeLoginModal);
    if (loginModal) {
        loginModal.addEventListener('click', (e) => {
            if (e.target === loginModal) closeLoginModal();
        });
    }

    // Escape key closes modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeApplicationModal();
            closeLoginModal();
        }
    });
}

function closeApplicationModal() {
    const modal = document.getElementById('application-modal');
    const form = document.getElementById('application-form');
    if (modal) modal.classList.add('hidden');
    if (form) {
        form.reset();
        form.style.display = '';
    }
    selectedRequest = null;
    document.body.style.overflow = '';
}

function showLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) {
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }
}

function closeLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) modal.classList.add('hidden');
    document.body.style.overflow = '';
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================

let toastTimeout = null;

function showToast(message, type) {
    // Remove existing toast
    const existing = document.getElementById('jb-toast');
    if (existing) existing.remove();
    if (toastTimeout) clearTimeout(toastTimeout);

    const iconMap = {
        success: 'fa-solid fa-check-circle',
        error: 'fa-solid fa-exclamation-circle',
        warning: 'fa-solid fa-exclamation-triangle',
        info: 'fa-solid fa-info-circle'
    };

    const toast = document.createElement('div');
    toast.id = 'jb-toast';
    toast.className = `jb-toast jb-toast--${type || 'info'}`;
    toast.innerHTML = `
        <i class="${iconMap[type] || iconMap.info}"></i>
        <span>${escapeHtml(message)}</span>
        <button class="jb-toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;

    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('jb-toast--visible');
    });

    // Auto dismiss
    toastTimeout = setTimeout(() => {
        toast.classList.remove('jb-toast--visible');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ============================================
// EXPORT GLOBALS (onclick handlers in HTML)
// ============================================

window.toggleStyleFilter = toggleStyleFilter;
window.handleApply = handleApply;
window.viewRequest = viewRequest;
window.removeFilter = removeFilter;
window.clearAllFilters = clearAllFilters;
window.changePage = changePage;
window.closeApplicationModal = closeApplicationModal;
window.closeLoginModal = closeLoginModal;
window.showLoginModal = showLoginModal;
