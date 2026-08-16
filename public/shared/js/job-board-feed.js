// ============================================
// WE OTZI - JOB BOARD FEED
// Feed del artista: rieles curados + detalle de solicitud + propuesta enviada.
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

function formatMoney(value) {
    return Number(value).toLocaleString('es-AR');
}

function formatBudgetRange(min, max, currency) {
    const cur = currency || 'USD';
    if (min && max) {
        return `$${formatMoney(min)} – $${formatMoney(max)} ${cur}`;
    }
    if (min) return `Desde $${formatMoney(min)} ${cur}`;
    if (max) return `Hasta $${formatMoney(max)} ${cur}`;
    return 'A convenir';
}

function isNewRequest(createdAt, days = 7) {
    if (!createdAt) return false;
    const created = new Date(createdAt);
    if (isNaN(created)) return false;
    return (Date.now() - created.getTime()) < days * 24 * 60 * 60 * 1000;
}

function getDaysLeft(expiresAt) {
    if (!expiresAt) return null;
    const now = new Date();
    const expires = new Date(expiresAt);
    const diff = expires - now;
    if (diff <= 0) return 0;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getDaysAgo(createdAt) {
    if (!createdAt) return null;
    const created = new Date(createdAt);
    if (isNaN(created)) return null;
    return Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
}

function formatPublishedAgo(createdAt) {
    const days = getDaysAgo(createdAt);
    if (days === null) return 'Sin fecha';
    if (days <= 0) return 'Hoy';
    if (days === 1) return 'Ayer';
    return `Hace ${days} días`;
}

function formatDayMonth(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return `${d.getDate()} de ${d.toLocaleDateString('es-AR', { month: 'long' })}`;
}

function formatLongDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return `${d.getDate()} de ${d.toLocaleDateString('es-AR', { month: 'long' })}, ${d.getFullYear()}`;
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
    quick: 'recommended',
    sort: 'newest'
};
let selectedRequest = null;
let searchDebounceTimer = null;

// Acordeón de estilos del sidebar: 4 categorías, la primera abierta (ref Figma 40).
const STYLE_GROUPS = [
    {
        key: 'tecnica',
        label: 'Técnica',
        styles: [
            'Realismo', 'Hiperrealismo', 'Microrealismo', 'Black & Grey', 'Fine Line',
            'Linework', 'Blackwork', 'Ornamental Blackwork', 'Pointillism',
            'Handpoke / Stick and Poke', 'Etching / Grabado', 'Woodcut / Xilografia',
            'Sketch / Boceto', 'Acuarela', 'Abstract Brush', 'Puntillismo'
        ]
    },
    {
        key: 'regional',
        label: 'Regional',
        styles: [
            'Japonés', 'Tribal', 'Polinesio', 'Maori', 'Haida', 'Celta',
            'Nordico / Viking', 'Tradicional'
        ]
    },
    {
        key: 'tematico',
        label: 'Temático',
        styles: [
            'Floral', 'Ilustracion botanica', 'Fineline botanico', 'Horror', 'Dark Art',
            'Religious / Sacro', 'Biomecanico', 'Bioorganico', 'Mandala', 'Ornamental'
        ]
    },
    {
        key: 'otros',
        label: 'Otros',
        styles: [
            'Minimalista', 'Geométrico', 'Lettering', 'Blackletter / Gotico', 'Caligrafia',
            'Ignorant', 'Abstracto', 'Glitch', 'Pixel Art', 'Graffiti', 'Pop Art',
            'Art Nouveau', 'Art Deco', 'Barroco', 'Patchwork'
        ]
    }
];

const TOP_STYLES = STYLE_GROUPS.reduce((acc, group) => acc.concat(group.styles), []);

const GROUP_COLLAPSED_COUNT = 4;
let openStyleGroup = 'tecnica';
const expandedStyleGroups = new Set();

// Size mapping for filter matching
const SIZE_MAP = {
    'small': ['pequeño', 'pequeno', 'small'],
    'medium': ['mediano', 'medium'],
    'large': ['grande', 'large', 'media_manga', 'media manga'],
    'xlarge': ['muy_grande', 'muy grande', 'manga_completa', 'manga completa', 'espalda_completa', 'espalda completa', 'pecho_completo', 'pecho completo', 'xlarge']
};

const SIZE_LABELS = {
    'small': 'Pequeño (menos de 10 cm)',
    'medium': 'Mediano (10–20 cm)',
    'large': 'Grande (20–40 cm)',
    'xlarge': 'Muy grande (40+ cm)'
};

const RAIL_CARD_COUNT = 5;
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

function setupCollapseFilters() {
    const btn = document.getElementById('btn-collapse-filters');
    const shell = document.getElementById('marketplace-content');
    if (!btn || !shell) return;

    btn.addEventListener('click', () => {
        const collapsed = shell.classList.toggle('is-filters-collapsed');
        btn.setAttribute('aria-expanded', String(!collapsed));
        btn.setAttribute('aria-label', collapsed ? 'Abrir panel de filtros' : 'Colapsar panel de filtros');
        btn.innerHTML = `<i data-wo-icon="${collapsed ? 'chevron-right' : 'chevron-left'}" class="wo-icon-18" aria-hidden="true"></i>`;
    });
}

function setupLogout() {
    const btn = document.getElementById('auth-logout');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        try {
            if (_supabase?.auth?.signOut) await _supabase.auth.signOut();
        } catch (err) {
            console.warn('Logout failed:', err);
        }
        window.location.href = jobBoardAuthUrls.login;
    });
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    showLoading();
    try {
        setupDashboardNavigationMenu();
        setupCollapseFilters();
        await checkAuthState();
        setupLogout();

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
            initQuickFilters();
            initAdvancedFilters();
            applyFilters();
        } else {
            renderFeed();
        }

        // Setup search and event listeners
        setupSearch();
        setupModalListeners();
        setupHistoryListener();
        openRequestFromQuery();

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

        const artistSelect = 'user_id, username, name, styles_array, city, ubicacion, profile_picture, gallery_images';
        const authState = await window.ArtistAuth.resolveArtistAuthState({
            artistSelect,
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
                const { data: retryArtist } = await WeotziData.Artists.getByUserId(currentUser.id, artistSelect);
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
    const logoutBtn = document.getElementById('auth-logout');
    if (!authBtn || !authLabel) return;

    if (currentUser && isArtist) {
        authLabel.textContent = artistData?.username || 'Mi panel';
        authBtn.href = jobBoardAuthUrls.dashboard;
    } else if (currentUser) {
        authLabel.textContent = 'Completá tu perfil';
        authBtn.href = jobBoardAuthUrls.registerArtist;
    } else {
        authLabel.textContent = 'Ingresá';
        authBtn.href = jobBoardAuthUrls.login;
    }

    if (logoutBtn) logoutBtn.classList.toggle('hidden', !currentUser);
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
// STYLE FILTERS (acordeón por categoría)
// ============================================

function countForStyle(label) {
    return allRequests.filter(r =>
        (r._parsedStyles || []).some(s => s.toLowerCase() === label.toLowerCase())
    ).length;
}

function initStyleFilters() {
    const container = document.getElementById('style-filters');
    if (!container) return;

    // Cada grupo lista solo los estilos con solicitudes abiertas, por cantidad.
    const groups = STYLE_GROUPS.map(group => {
        const withCounts = group.styles
            .map(label => ({ label, count: countForStyle(label) }))
            .filter(s => s.count > 0)
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
        return { ...group, items: withCounts };
    }).filter(group => group.items.length > 0);

    if (groups.length === 0) {
        container.innerHTML = '';
        return;
    }

    if (!groups.some(g => g.key === openStyleGroup)) openStyleGroup = groups[0].key;

    container.innerHTML = groups.map(group => {
        const isOpen = group.key === openStyleGroup;
        const expanded = expandedStyleGroups.has(group.key);
        let visible = expanded ? group.items : group.items.slice(0, GROUP_COLLAPSED_COUNT);
        if (currentFilters.style && !visible.some(s => s.label === currentFilters.style)) {
            const active = group.items.find(s => s.label === currentFilters.style);
            if (active) visible = visible.concat(active);
        }
        const hiddenCount = Math.max(0, group.items.length - GROUP_COLLAPSED_COUNT);

        return `
            <div class="jbf-style-group${isOpen ? ' is-open' : ''}">
                <button type="button" class="jbf-style-group-head" aria-expanded="${isOpen}"
                    onclick="toggleStyleGroup('${escapeHtml(group.key)}')">
                    <span>${escapeHtml(group.label)}</span>
                    <i data-wo-icon="chevron-down" class="wo-icon-18 jbf-style-chevron" aria-hidden="true"></i>
                </button>
                <div class="jbf-style-list"${isOpen ? '' : ' hidden'}>
                    ${visible.map(style => `
                        <button type="button" class="jbf-style-item jb-filter-btn ${currentFilters.style === style.label ? 'is-active' : ''}"
                            onclick="toggleStyleFilter('${escapeHtml(style.label)}')" data-style="${escapeHtml(style.label)}">
                            <span>${escapeHtml(style.label)}</span>
                            <span class="jbf-style-count wo-mono-num">${style.count}</span>
                        </button>
                    `).join('')}
                    ${hiddenCount > 0 ? `
                        <button type="button" class="jbf-style-more" onclick="toggleStyleGroupExpanded('${escapeHtml(group.key)}')">
                            ${expanded ? 'Ver menos' : `+ ${hiddenCount} más`}
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function toggleStyleGroup(key) {
    openStyleGroup = openStyleGroup === key ? null : key;
    initStyleFilters();
}

function toggleStyleGroupExpanded(key) {
    if (expandedStyleGroups.has(key)) expandedStyleGroups.delete(key);
    else expandedStyleGroups.add(key);
    initStyleFilters();
}

function toggleStyleFilter(styleName) {
    if (currentFilters.style === styleName) {
        currentFilters.style = null;
    } else {
        currentFilters.style = styleName;
    }

    document.querySelectorAll('.jb-filter-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.style === currentFilters.style);
    });

    applyFilters();
}

// ============================================
// QUICK FILTERS ("PARA VOS")
// ============================================

function artistStyles() {
    const raw = artistData?.styles_array;
    return getStyleNames(raw).filter(Boolean);
}

function artistCity() {
    const city = artistData?.city || '';
    if (city) return String(city).trim();
    const ubicacion = String(artistData?.ubicacion || '').trim();
    if (!ubicacion) return '';
    return ubicacion.split(',')[0].trim();
}

function initQuickFilters() {
    const container = document.getElementById('quick-filters');
    if (!container) return;

    // "Cerca tuyo" solo tiene sentido si conocemos la ciudad del artista.
    const nearBtn = container.querySelector('[data-quick="near"]');
    if (nearBtn && !artistCity()) nearBtn.classList.add('is-unavailable');

    container.querySelectorAll('[data-quick]').forEach(btn => {
        btn.addEventListener('click', () => {
            const quick = btn.dataset.quick;
            currentFilters.quick = currentFilters.quick === quick ? null : quick;
            currentFilters.sort = currentFilters.quick === 'newest' ? 'newest' : 'newest';
            syncQuickFiltersUI();
            applyFilters();
        });
    });
}

function syncQuickFiltersUI() {
    document.querySelectorAll('#quick-filters [data-quick]').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.quick === currentFilters.quick);
    });
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
    const city = artistCity().toLowerCase();

    filteredRequests = allRequests.filter(request => {
        // Search filter
        if (currentFilters.search) {
            const query = currentFilters.search.toLowerCase();
            const description = (request.tattoo_idea_description || '').toLowerCase();
            const reqCity = (request.client_city || '').toLowerCase();
            const bodyPart = (request.tattoo_body_part || '').toLowerCase();
            const styles = (request._parsedStyles || []).map(s => s.toLowerCase());
            const code = (request.request_code || '').toLowerCase();

            const matchSearch =
                description.includes(query) ||
                reqCity.includes(query) ||
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

        // "Cerca tuyo": misma ciudad que el artista (dato real de artists_db).
        if (currentFilters.quick === 'near' && city) {
            if ((request.client_city || '').trim().toLowerCase() !== city) return false;
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

    sortRequests();
    renderFeed();
    syncFiltersUI();
}

function sortRequests() {
    switch (currentFilters.sort) {
        case 'budget-high':
            filteredRequests.sort((a, b) => {
                const aMax = parseFloat(b.client_budget_max) || parseFloat(b.client_budget_min) || 0;
                const bMax = parseFloat(a.client_budget_max) || parseFloat(a.client_budget_min) || 0;
                return aMax - bMax;
            });
            break;
        case 'deadline':
            filteredRequests.sort((a, b) => {
                const aDate = a.expires_at ? new Date(a.expires_at) : new Date('2099-12-31');
                const bDate = b.expires_at ? new Date(b.expires_at) : new Date('2099-12-31');
                return aDate - bDate;
            });
            break;
        case 'newest':
        default:
            filteredRequests.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            break;
    }
}

function syncFiltersUI() {
    const citySelect = document.getElementById('filter-city');
    const sizeSelect = document.getElementById('filter-size');
    const budgetSelect = document.getElementById('filter-budget');

    if (citySelect) citySelect.value = currentFilters.city || '';
    if (sizeSelect) sizeSelect.value = currentFilters.size || '';
    if (budgetSelect) budgetSelect.value = currentFilters.budget || '';

    syncQuickFiltersUI();

    document.querySelectorAll('.jb-filter-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.style === currentFilters.style);
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
        quick: 'recommended',
        sort: 'newest'
    };
    const searchInput = document.getElementById('smart-search');
    if (searchInput) searchInput.value = '';
    applyFilters();
}

// ============================================
// RENDERING · rieles curados
// ============================================

function hasActiveRefinement() {
    return Boolean(currentFilters.search || currentFilters.style || currentFilters.city ||
        currentFilters.size || currentFilters.budget || currentFilters.quick === 'near');
}

// Rieles derivados de datos reales: el primero cruza los estilos del artista con
// las solicitudes abiertas; los siguientes son los estilos con más solicitudes.
function buildRails() {
    const mine = artistStyles().map(s => s.toLowerCase());
    const matchesArtist = (r) => mine.length > 0 &&
        (r._parsedStyles || []).some(s => mine.includes(s.toLowerCase()));

    const recommended = mine.length > 0
        ? filteredRequests.filter(matchesArtist)
        : filteredRequests;

    const rails = [];
    if (recommended.length > 0) {
        rails.push({
            title: 'Recomendado para vos',
            style: null,
            items: recommended.slice(0, RAIL_CARD_COUNT),
            total: recommended.length
        });
    }

    // Estilos con más solicitudes abiertas dentro del set filtrado.
    const counts = new Map();
    filteredRequests.forEach(r => {
        (r._parsedStyles || []).forEach(raw => {
            const label = TOP_STYLES.find(s => s.toLowerCase() === String(raw).toLowerCase());
            if (!label) return;
            counts.set(label, (counts.get(label) || 0) + 1);
        });
    });

    const ranked = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 2);

    ranked.forEach(([label]) => {
        const items = filteredRequests.filter(r =>
            (r._parsedStyles || []).some(s => s.toLowerCase() === label.toLowerCase())
        );
        if (items.length === 0) return;
        rails.push({
            title: label,
            style: label,
            items: items.slice(0, RAIL_CARD_COUNT),
            total: items.length
        });
    });

    if (rails.length === 0 && filteredRequests.length > 0) {
        rails.push({
            title: 'Solicitudes abiertas',
            style: null,
            items: filteredRequests.slice(0, RAIL_CARD_COUNT),
            total: filteredRequests.length
        });
    }

    return rails;
}

function renderFeed() {
    const railsEl = document.getElementById('job-board-rails');
    const emptyState = document.getElementById('empty-state');
    if (!railsEl) return;

    if (filteredRequests.length === 0) {
        railsEl.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }
    if (emptyState) emptyState.classList.add('hidden');

    // Con un filtro activo el Figma no tiene rieles: se muestra el resultado plano.
    if (hasActiveRefinement()) {
        railsEl.innerHTML = `
            <section class="jbf-rail jbf-rail--flat">
                <div class="jbf-rail-head">
                    <h2 class="jbf-rail-title">${escapeHtml(currentFilters.style || 'Resultados')}</h2>
                </div>
                <div class="jbf-rail-grid">
                    ${filteredRequests.map(r => renderRequestCard(r)).join('')}
                </div>
            </section>
        `;
        return;
    }

    railsEl.innerHTML = buildRails().map(rail => `
        <section class="jbf-rail">
            <div class="jbf-rail-head">
                <h2 class="jbf-rail-title">${escapeHtml(rail.title)}</h2>
                ${rail.total > rail.items.length ? `
                    <button type="button" class="jbf-rail-all" onclick="showAllOf(${rail.style ? `'${escapeHtml(rail.style)}'` : 'null'})">
                        Ver todo <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i>
                    </button>
                ` : ''}
            </div>
            <div class="jbf-rail-track">
                ${rail.items.map(r => renderRequestCard(r)).join('')}
            </div>
        </section>
    `).join('');
}

function showAllOf(style) {
    currentFilters.style = style || null;
    if (!style) currentFilters.quick = null;
    initStyleFilters();
    applyFilters();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderRequestCard(request) {
    // Get thumbnail from attachments
    const attachments = request.job_board_attachments || [];
    const sortedAttachments = [...attachments].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const thumbnail = sortedAttachments.length > 0 ? sortedAttachments[0].file_url : null;

    // Chips: solo estilos (máx. 2), como en el Figma.
    const styles = request._parsedStyles || [];
    const styleTags = styles.slice(0, 2).map(s =>
        `<span class="jbf-tag">${escapeHtml(s)}</span>`
    ).join('');

    // Location & body part
    const city = request.client_city ? toTitleCase(request.client_city) : '';
    const bodyPart = request.tattoo_body_part ? toTitleCase(request.tattoo_body_part.replace(/_/g, ' ')) : '';

    const budgetRange = formatBudgetRange(request.client_budget_min, request.client_budget_max, request.client_budget_currency);

    const appCount = request.application_count || 0;
    const code = request.request_code || '';
    const description = truncate(request.tattoo_idea_description || '', 120);

    return `
        <article class="jbf-card" onclick="viewRequest('${request.id}')">
            <div class="jbf-card-media ${!thumbnail ? 'no-image' : ''}">
                ${thumbnail ? `<img src="${thumbnail}" alt="Referencia del tatuaje" loading="lazy" onerror="this.parentElement.classList.add('no-image'); this.remove();">` : ''}
                <span class="jbf-card-code">${escapeHtml(code)}</span>
                ${isNewRequest(request.created_at) ? '<span class="jbf-card-new">Nuevo</span>' : ''}
            </div>
            <div class="jbf-card-body">
                <h3 class="jbf-card-title">${escapeHtml(description)}</h3>
                <div class="jbf-card-tags">${styleTags}</div>
                <div class="jbf-card-meta">
                    ${city ? `<span><i data-wo-icon="map-pin" aria-hidden="true"></i> ${escapeHtml(city)}</span>` : ''}
                    ${bodyPart ? `<span>${escapeHtml(bodyPart)}</span>` : ''}
                </div>
                <div class="jbf-card-foot">
                    <div>
                        <span class="jbf-card-price">${budgetRange}</span>
                        <span class="jbf-card-apps">${appCount} postulaci${appCount !== 1 ? 'ones' : 'ón'}</span>
                    </div>
                    <button type="button" class="jbf-card-apply" onclick="event.stopPropagation(); handleApply('${request.id}')">
                        Postularme <i data-wo-icon="arrow-right" aria-hidden="true"></i>
                    </button>
                </div>
            </div>
        </article>
    `;
}

function escapeHtml(text) {
    if (!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, c => map[c]);
}

// ============================================
// SEARCH
// ============================================

function setupSearch() {
    const input = document.getElementById('smart-search');
    if (!input) return;

    input.addEventListener('input', (e) => {
        const val = e.target.value.trim();

        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            currentFilters.search = val;
            applyFilters();
        }, 300);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
            currentFilters.search = input.value.trim();
            applyFilters();
        }
    });
}

// ============================================
// VISTAS (feed · detalle · propuesta enviada)
// ============================================

function showView(name) {
    const map = {
        feed: document.getElementById('jbf-feed-view'),
        detail: document.getElementById('jbf-detail-view'),
        sent: document.getElementById('jbf-sent-view')
    };
    Object.entries(map).forEach(([key, el]) => {
        if (el) el.classList.toggle('hidden', key !== name);
    });
    const sidebar = document.getElementById('jbf-sidebar');
    if (sidebar) sidebar.classList.toggle('hidden', name !== 'feed');
    const shell = document.getElementById('marketplace-content');
    if (shell) shell.classList.toggle('is-single-column', name !== 'feed');
    window.scrollTo({ top: 0, behavior: 'auto' });
}

function setupHistoryListener() {
    window.addEventListener('popstate', () => {
        openRequestFromQuery({ push: false });
    });
}

function openRequestFromQuery(options = {}) {
    const code = new URLSearchParams(window.location.search).get('solicitud');
    if (!code) {
        selectedRequest = null;
        showView('feed');
        return;
    }
    const request = allRequests.find(r => r.request_code === code);
    if (!request) {
        showView('feed');
        return;
    }
    openRequestDetail(request, { push: options.push === true });
}

function syncDetailUrl(request, push) {
    if (!window.history?.pushState) return;
    const url = new URL(window.location.href);
    if (request) url.searchParams.set('solicitud', request.request_code || request.id);
    else url.searchParams.delete('solicitud');
    if (push) window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
}

function backToFeed() {
    selectedRequest = null;
    syncDetailUrl(null, true);
    showView('feed');
}

// ============================================
// DETALLE DE LA SOLICITUD (ref Figma 41)
// ============================================

function specificRequirements(request) {
    // Solo hechos reales de la solicitud; el Figma tiene una lista libre que no
    // existe como columna (ver informe: requiere backend nuevo).
    const items = [];
    if (request.tattoo_is_first_tattoo) items.push('Es su primer tatuaje');
    if (request.tattoo_is_cover_up) items.push('Es un cover-up sobre un tatuaje existente');
    if (request.client_preferred_date) items.push(`Fecha preferida: ${request.client_preferred_date}`);
    if (request.client_flexible_dates) items.push(`Fechas flexibles: ${request.client_flexible_dates}`);
    return items;
}

function sizeLabelFor(request) {
    const raw = String(request.tattoo_size || '').toLowerCase().replace(/\s+/g, '_');
    if (!raw) return 'No especificado';
    const key = Object.keys(SIZE_MAP).find(k =>
        SIZE_MAP[k].some(s => raw.includes(s.replace(/\s+/g, '_')) || raw.includes(s))
    );
    return key ? SIZE_LABELS[key] : toTitleCase(raw.replace(/_/g, ' '));
}

function artistPreviewHtml() {
    if (!isArtist || !artistData) return '';
    const name = artistData.username || artistData.name || '';
    const initial = (name || 'A').trim().charAt(0).toUpperCase();
    const city = artistCity();
    const styles = artistStyles().slice(0, 3);
    const gallery = parseStyles(artistData.gallery_images).filter(u => typeof u === 'string').slice(0, 3);
    const avatar = artistData.profile_picture;

    return `
        <div class="jbf-preview">
            <span class="jbf-aside-label wo-meta-s">Así te va a ver el cliente</span>
            <div class="jbf-preview-id">
                <span class="wo-avatar wo-avatar--s">${avatar ? `<img src="${escapeHtml(avatar)}" alt="">` : escapeHtml(initial)}</span>
                <div>
                    <span class="jbf-preview-name">${escapeHtml(name)}</span>
                    ${city ? `<span class="jbf-preview-city wo-meta-s">${escapeHtml(city)}</span>` : ''}
                </div>
            </div>
            ${styles.length ? `<div class="jbf-card-tags">${styles.map(s => `<span class="jbf-tag">${escapeHtml(s)}</span>`).join('')}</div>` : ''}
            ${gallery.length ? `<div class="jbf-preview-shots">${gallery.map(u => `<img src="${escapeHtml(u)}" alt="" loading="lazy">`).join('')}</div>` : ''}
        </div>
    `;
}

function buildDetailMain(request) {
    const code = request.request_code || '';
    const styles = (request._parsedStyles || []).join(' · ');
    const appCount = request.application_count || 0;
    const daysLeft = getDaysLeft(request.expires_at);
    const bodyPart = request.tattoo_body_part ? toTitleCase(request.tattoo_body_part.replace(/_/g, ' ')) : 'No especificada';
    const city = request.client_city ? toTitleCase(request.client_city) : 'No especificada';
    const budgetRange = formatBudgetRange(request.client_budget_min, request.client_budget_max, request.client_budget_currency);
    const reqs = specificRequirements(request);

    const attachments = [...(request.job_board_attachments || [])]
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    const deadlineBand = daysLeft === null ? '' : `
        <div class="jbf-deadline">
            <strong>${daysLeft === 0 ? 'Último día para enviar tu propuesta' : `Quedan ${daysLeft} día${daysLeft !== 1 ? 's' : ''} para enviar tu propuesta`}</strong>
            ${request.expires_at ? `<span>El cliente cierra la recepción de propuestas el ${escapeHtml(formatDayMonth(request.expires_at))}.</span>` : ''}
        </div>
    `;

    const travelLine = request.client_travel_willing
        ? 'No requiere viajar — el cliente puede trasladarse a tu estudio'
        : 'El cliente prefiere no viajar — el trabajo sería en su ciudad';

    return `
        <button type="button" class="jbf-back" onclick="backToFeed()">
            <i data-wo-icon="arrow-left" class="wo-icon-18" aria-hidden="true"></i> Volver al job board
        </button>

        <span class="wo-eyebrow">Job board / Solicitud</span>
        <h1 class="jbf-detail-title">${escapeHtml(request.tattoo_idea_description || 'Solicitud')}</h1>

        <div class="jbf-detail-chips">
            <span class="jbf-chip-code">${escapeHtml(code)}</span>
            ${styles ? `<span class="jbf-chip-style">${escapeHtml(styles)}</span>` : ''}
            <span class="jbf-chip-apps"><b>${appCount}</b> propuesta${appCount !== 1 ? 's' : ''} recibida${appCount !== 1 ? 's' : ''}</span>
        </div>

        ${deadlineBand}

        ${attachments.length ? `
            <span class="jbf-sum-label">Referencias del cliente</span>
            <div class="jbf-refs">
                ${attachments.map(att => `
                    <a class="jbf-ref" href="${escapeHtml(att.file_url)}" target="_blank" rel="noopener">
                        <img src="${escapeHtml(att.file_url)}" alt="${escapeHtml(att.file_name || 'Referencia del cliente')}" loading="lazy">
                    </a>
                `).join('')}
            </div>
        ` : ''}

        <span class="jbf-sum-label">La idea del tatuaje</span>
        <p class="jbf-sum-text">${escapeHtml(request.tattoo_idea_description || 'Sin descripción')}</p>

        <span class="jbf-sum-label">Detalles de la solicitud</span>
        <div class="jbf-detail-grid">
            <div class="jbf-detail-cell">
                <span class="jbf-detail-key">Zona del cuerpo</span>
                <span class="jbf-detail-val">${escapeHtml(bodyPart)}</span>
            </div>
            <div class="jbf-detail-cell">
                <span class="jbf-detail-key">Estilo</span>
                <span class="jbf-detail-val">${escapeHtml(styles || 'No especificado')}</span>
            </div>
            <div class="jbf-detail-cell">
                <span class="jbf-detail-key">Tamaño aproximado</span>
                <span class="jbf-detail-val">${escapeHtml(sizeLabelFor(request))}</span>
            </div>
            ${reqs.length ? `
                <div class="jbf-detail-cell">
                    <span class="jbf-detail-key">Requisitos específicos</span>
                    <ul class="jbf-req-list">
                        ${reqs.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
        </div>

        <div class="jbf-detail-cols">
            <div>
                <span class="jbf-sum-label">Ciudad y modalidad</span>
                <span class="jbf-col-val">${escapeHtml(city)}</span>
                <span class="jbf-col-note">${escapeHtml(travelLine)}</span>
            </div>
            <div>
                <span class="jbf-sum-label">Presupuesto orientativo</span>
                <span class="jbf-col-val wo-mono-num">${budgetRange}</span>
                <span class="jbf-col-note">Referencia del cliente, no cerrado</span>
            </div>
            <div>
                <span class="jbf-sum-label">Publicación</span>
                <span class="jbf-col-val">${escapeHtml(formatPublishedAgo(request.created_at))}</span>
                ${daysLeft !== null ? `<span class="jbf-col-note">${daysLeft === 0 ? 'Último día para enviar tu propuesta' : `Quedan ${daysLeft} día${daysLeft !== 1 ? 's' : ''} para enviar tu propuesta`}</span>` : ''}
            </div>
        </div>

        <span class="jbf-sum-label">Sobre el cliente</span>
        <p class="jbf-client-note">Datos de contacto disponibles cuando el cliente acepte tu propuesta</p>

        <div class="jbf-apps-bar">
            ${appCount} artista${appCount !== 1 ? 's' : ''} ya ${appCount !== 1 ? 'enviaron' : 'envió'} una propuesta para este tatuaje
        </div>
    `;
}

function buildProposalAside(request) {
    if (!isArtist) {
        return `
            <div class="jbf-login-prompt">
                <i data-wo-icon="lock" aria-hidden="true"></i>
                <p>${currentUser ? 'Completá tu perfil de artista para postularte a esta solicitud.' : 'Ingresá como artista para postularte a esta solicitud.'}</p>
                <div class="wo-modal-actions" style="justify-content:center;margin-top:0;">
                    <a href="${currentUser ? jobBoardAuthUrls.registerArtist : jobBoardAuthUrls.login}" class="wo-btn wo-btn--direct wo-btn--s">${currentUser ? 'Completar perfil' : 'Ingresar'}</a>
                    <a href="${currentUser ? jobBoardAuthUrls.dashboard : jobBoardAuthUrls.registerArtist}" class="wo-btn wo-btn--ghost wo-btn--s">${currentUser ? 'Ir a mi panel' : 'Registrarme'}</a>
                </div>
            </div>
        `;
    }

    const sessionOptions = [1, 2, 3, 4, 5, 6]
        .map(n => `<option value="${n}">${n} sesi${n === 1 ? 'ón' : 'ones'}</option>`)
        .join('') + '<option value="7">7 o más sesiones</option>';

    return `
        <h2 class="jbf-aside-title">Tu propuesta</h2>
        <p class="jbf-aside-sub">Completá los datos para enviarle tu propuesta al cliente.</p>
        <form id="application-form" class="jbf-aside-form">
            <div class="wo-field">
                <label class="wo-label" for="app-price">Precio que proponés <span class="req">*</span></label>
                <div class="jbf-money">
                    <span class="jbf-money-sign" aria-hidden="true">$</span>
                    <input type="number" id="app-price" name="estimated_price" class="wo-input" min="1" step="any" required placeholder="Ej: 450">
                </div>
            </div>
            <div class="wo-field">
                <label class="wo-label" for="app-sessions">Cantidad de sesiones <span class="req">*</span></label>
                <select id="app-sessions" name="estimated_sessions" class="wo-select" required>
                    <option value="">Seleccioná una opción</option>
                    ${sessionOptions}
                </select>
            </div>
            <div class="wo-field">
                <label class="wo-label" for="app-availability">Disponibilidad</label>
                <input type="text" id="app-availability" name="availability_note" class="wo-input" placeholder="Ej: Disponible desde el 10/08">
            </div>
            <div class="wo-field">
                <label class="wo-label" for="app-message">Mensaje para el cliente <span class="req">*</span></label>
                <textarea id="app-message" name="message" class="wo-textarea" rows="4" required
                    placeholder="Contale por qué te gustaría hacer este tatuaje…"></textarea>
            </div>
            ${artistPreviewHtml()}
            <button type="submit" class="wo-btn wo-btn--direct wo-btn--block wo-btn--hard" id="btn-submit-application">
                Enviar propuesta <i data-wo-icon="send" class="wo-icon-18" aria-hidden="true"></i>
            </button>
            <p class="jbf-aside-note wo-body-s wo-faint">Vas a poder editar tu propuesta hasta que el cliente la vea.</p>
        </form>
    `;
}

function openRequestDetail(request, options = {}) {
    const view = document.getElementById('jbf-detail-view');
    if (!view || !request) return;

    selectedRequest = request;
    view.innerHTML = `
        <div class="jbf-detail-main">${buildDetailMain(request)}</div>
        <aside class="jbf-detail-aside" aria-label="Enviar propuesta">${buildProposalAside(request)}</aside>
    `;

    const form = document.getElementById('application-form');
    if (form) form.addEventListener('submit', submitApplication);

    syncDetailUrl(request, options.push !== false);
    showView('detail');
}

function viewRequest(requestId) {
    const request = allRequests.find(r => r.id === requestId);
    if (!request) return;
    openRequestDetail(request);
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

    const request = allRequests.find(r => r.id === requestId);
    if (!request) {
        showToast('Solicitud no encontrada.', 'error');
        return;
    }

    try {
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

        if (request.max_applications && request.application_count >= request.max_applications) {
            showToast('Esta solicitud ya alcanzó el máximo de propuestas.', 'warning');
            return;
        }

        openRequestDetail(request);
        document.getElementById('app-price')?.focus();

    } catch (err) {
        console.error('Error checking application status:', err);
        showToast('No pudimos verificar tu propuesta. Probá de nuevo.', 'error');
    }
}

async function submitApplication(e) {
    e.preventDefault();

    if (!selectedRequest || !artistData || !_supabase) {
        showToast('Error: datos incompletos. Recargá la página.', 'error');
        return;
    }

    const submitBtn = document.getElementById('btn-submit-application');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Enviando…';
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
            showToast('Ingresá un precio válido (mayor a 0).', 'error');
            resetSubmitButton();
            return;
        }

        const estimatedSessions = rawSessions ? parseInt(rawSessions, 10) : NaN;
        if (!rawSessions || isNaN(estimatedSessions) || estimatedSessions < 1) {
            showToast('Elegí la cantidad de sesiones estimadas.', 'error');
            resetSubmitButton();
            return;
        }

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

        const requestIndex = allRequests.findIndex(r => r.id === selectedRequest.id);
        if (requestIndex !== -1) {
            allRequests[requestIndex].application_count = (allRequests[requestIndex].application_count || 0) + 1;
        }

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

        renderProposalSent(selectedRequest, {
            price: estimatedPrice,
            currency: selectedRequest.client_budget_currency || 'USD',
            sentAt: application?.created_at || new Date().toISOString()
        });

        applyFilters();

    } catch (err) {
        console.error('Error submitting application:', err);
        showToast('No pudimos enviar la propuesta. Probá de nuevo.', 'error');
        resetSubmitButton();
    }
}

function resetSubmitButton() {
    const submitBtn = document.getElementById('btn-submit-application');
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Enviar propuesta <i data-wo-icon="send" class="wo-icon-18" aria-hidden="true"></i>';
    }
}

// ============================================
// PROPUESTA ENVIADA (ref Figma 42)
// ============================================

function renderProposalSent(request, proposal) {
    const view = document.getElementById('jbf-sent-view');
    if (!view) return;

    view.innerHTML = `
        <div class="jbf-sent-tile" aria-hidden="true">
            <i data-wo-icon="check" aria-hidden="true"></i>
        </div>
        <span class="wo-eyebrow">Job board / Propuesta enviada</span>
        <h1 class="jbf-sent-title">Propuesta enviada</h1>
        <p class="jbf-sent-sub">Le avisamos al cliente que estás interesado en su proyecto. Te va a llegar una notificación apenas responda.</p>

        <div class="jbf-summary">
            <div class="jbf-summary-head">
                <span class="wo-meta-s">Resumen de la propuesta</span>
                <span class="jbf-summary-badge">Enviada</span>
            </div>
            <div class="jbf-summary-body">
                <div class="jbf-summary-row">
                    <span class="jbf-summary-key">Proyecto</span>
                    <span class="jbf-summary-val">${escapeHtml(request.tattoo_idea_description || '')}</span>
                </div>
                <div class="jbf-summary-row">
                    <span class="jbf-summary-key">Solicitud</span>
                    <span class="jbf-summary-val wo-mono-num">${escapeHtml(request.request_code || '')}</span>
                </div>
                <div class="jbf-summary-row">
                    <span class="jbf-summary-key">Precio propuesto</span>
                    <span class="jbf-summary-val wo-mono-num">$${formatMoney(proposal.price)} ${escapeHtml(proposal.currency)}</span>
                </div>
                <div class="jbf-summary-row">
                    <span class="jbf-summary-key">Fecha de envío</span>
                    <span class="jbf-summary-val">${escapeHtml(formatLongDate(proposal.sentAt))}</span>
                </div>
            </div>
        </div>

        <div class="jbf-sent-actions">
            <a href="/my-quotations?tab=applications" class="wo-btn wo-btn--direct wo-btn--hard">
                Ver mis postulaciones <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i>
            </a>
            <button type="button" class="wo-btn wo-btn--secondary wo-btn--hard" onclick="backToFeed()">Seguir explorando solicitudes</button>
        </div>
    `;

    selectedRequest = null;
    syncDetailUrl(null, false);
    showView('sent');
}

// ============================================
// MODALS
// ============================================

function setupModalListeners() {
    const loginModal = document.getElementById('login-modal');
    const closeLoginBtn = document.getElementById('btn-close-login');

    if (closeLoginBtn) closeLoginBtn.addEventListener('click', closeLoginModal);
    if (loginModal) {
        loginModal.addEventListener('click', (e) => {
            if (e.target === loginModal) closeLoginModal();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeLoginModal();
    });
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
    const existing = document.getElementById('jb-toast');
    if (existing) existing.remove();
    if (toastTimeout) clearTimeout(toastTimeout);

    const iconMap = {
        success: 'check-circle',
        error: 'alert-circle',
        warning: 'alert-triangle',
        info: 'info'
    };

    const toast = document.createElement('div');
    toast.id = 'jb-toast';
    toast.className = `jb-toast jb-toast--${type || 'info'}`;
    toast.innerHTML = `
        <i data-wo-icon="${iconMap[type] || iconMap.info}" aria-hidden="true"></i>
        <span>${escapeHtml(message)}</span>
        <button class="jb-toast-close" onclick="this.parentElement.remove()" aria-label="Cerrar aviso">&times;</button>
    `;

    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('jb-toast--visible');
    });

    toastTimeout = setTimeout(() => {
        toast.classList.remove('jb-toast--visible');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ============================================
// EXPORT GLOBALS (onclick handlers in HTML)
// ============================================

window.toggleStyleFilter = toggleStyleFilter;
window.toggleStyleGroup = toggleStyleGroup;
window.toggleStyleGroupExpanded = toggleStyleGroupExpanded;
window.showAllOf = showAllOf;
window.handleApply = handleApply;
window.viewRequest = viewRequest;
window.backToFeed = backToFeed;
window.removeFilter = removeFilter;
window.clearAllFilters = clearAllFilters;
window.closeLoginModal = closeLoginModal;
window.showLoginModal = showLoginModal;
