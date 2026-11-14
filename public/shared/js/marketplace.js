// ============================================
// WE ÖTZI - MARKETPLACE (flujo clientes)
// Referencias: Figma 801:1127 "Descubrí artistas" y 2113:9145 "Descubrí
// estudios". Lógica pura (estilos, precio, agenda, ciudades, estudios) en
// marketplace-core.js; lecturas en data/marketplace-repo.js.
// ============================================

const Core = window.WeotziMarketplaceCore;
const escapeHtml = Core.escapeHtml;

function getInitials(name) {
    if (!name || typeof name !== 'string') return 'Ö';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'Ö';
    const first = parts[0].charAt(0);
    const second = parts.length > 1 ? parts[parts.length - 1].charAt(0) : (parts[0].charAt(1) || '');
    return (first + second).toUpperCase();
}

function showLoading() { document.getElementById('loading-overlay')?.classList.remove('hidden'); }
function hideLoading() { document.getElementById('loading-overlay')?.classList.add('hidden'); }

// ConfigManager se publica antes de terminar de leer app-config.json: hay que
// esperar ready() o el cliente Supabase todavía no existe (MK-01).
async function waitForConfigManager(maxWait = 3000) {
    const start = Date.now();
    while (!window.ConfigManager && (Date.now() - start) < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!window.ConfigManager) throw new Error('No se pudo cargar la configuración');
    await window.ConfigManager.ready();
}

// ============================================
// ESTADO
// ============================================

let allArtists = [];
let filteredArtists = [];
let allStudios = null;          // null = todavía no se cargaron
let filteredStudios = [];
let browseMode = 'artists';     // 'artists' | 'studios'
let dataReady = false;          // true cuando terminó la carga inicial

// Banderas de agenda por artista (marketplace-core buildAgenda):
// { available, booked, guestNow, travelling, onVacation, nextTrip }.
let artistAgenda = {};
let artistRatings = {};         // user_id -> { average_rating, review_count }
let studioRatings = {};         // studio id -> { average_rating, review_count }
let studioNames = {};           // studio id -> { name, slug }

// Favoritos (client_favorites vía WeotziData.Favorites). Sin sesión viven en
// localStorage y se migran a la tabla al loguear (merge silencioso).
let favoriteIds = new Set();
let favoritesOnly = false;
let sessionUserId = null;
const FAV_STORAGE_KEY = 'weotzi_mk_favorites';
const SIGNALS_STORAGE_KEY = 'weotzi_mk_signals';
let featuredIds = [];

// Paginado: la grilla muestra de a PAGE_SIZE y "Cargar más" suma otra tanda.
const PAGE_SIZE = { artists: 24, studios: 8 };
const visibleCount = { artists: PAGE_SIZE.artists, studios: PAGE_SIZE.studios };

function emptyFilters(mode) {
    return mode === 'studios'
        ? { search: '', style: null, location: null, availability: null, services: null, verified: false }
        : { search: '', style: null, location: null, priceRange: null, availability: null, travel: null, studio: null, verified: false };
}
const filtersByMode = { artists: emptyFilters('artists'), studios: emptyFilters('studios') };
function currentFilters() { return filtersByMode[browseMode]; }

// Opciones calculadas de cada filtro, por modo: { key: [{ value, label, count }] }.
const filterOptions = { artists: {}, studios: {} };

// Estilos del catálogo compartido. Sin íconos: el DS usa chips tipográficos.
// Nota: el formato `label: '...'` es literal a propósito — lo verifica
// tests/tattoo-styles-catalog.test.js contra lib/expanded-tattoo-styles.
// Solo alimenta el autocompletado del buscador: las opciones del filtro salen
// de los estilos REALES de los perfiles (marketplace-core buildStyleOptions).
const TOP_STYLES = [
    { label: 'Realismo' },
    { label: 'Tradicional' },
    { label: 'Fine Line' },
    { label: 'Blackwork' },
    { label: 'Minimalista' },
    { label: 'Japonés' },
    { label: 'Geométrico' },
    { label: 'Acuarela' },
    { label: 'Black & Grey' },
    { label: 'Microrealismo' },
    { label: 'Hiperrealismo' },
    { label: 'Ornamental' },
    { label: 'Mandala' },
    { label: 'Tribal' },
    { label: 'Polinesio' },
    { label: 'Maori' },
    { label: 'Haida' },
    { label: 'Celta' },
    { label: 'Nordico / Viking' },
    { label: 'Lettering' },
    { label: 'Blackletter / Gotico' },
    { label: 'Caligrafia' },
    { label: 'Ignorant' },
    { label: 'Handpoke / Stick and Poke' },
    { label: 'Abstracto' },
    { label: 'Sketch / Boceto' },
    { label: 'Etching / Grabado' },
    { label: 'Woodcut / Xilografia' },
    { label: 'Linework' },
    { label: 'Ilustracion botanica' },
    { label: 'Floral' },
    { label: 'Fineline botanico' },
    { label: 'Biomecanico' },
    { label: 'Bioorganico' },
    { label: 'Horror' },
    { label: 'Dark Art' },
    { label: 'Glitch' },
    { label: 'Pixel Art' },
    { label: 'Graffiti' },
    { label: 'Pop Art' },
    { label: 'Art Nouveau' },
    { label: 'Art Deco' },
    { label: 'Barroco' },
    { label: 'Abstract Brush' },
    { label: 'Patchwork' },
    { label: 'Religious / Sacro' },
    { label: 'Ornamental Blackwork' },
    { label: 'Pointillism' }
];

const AVAILABILITY_OPTIONS = [
    { value: 'available', label: 'Disponible' },
    { value: 'booked', label: 'Agenda cerrada' }
];

const TRAVEL_OPTIONS = [
    { value: 'guest', label: 'Artista invitado' },
    { value: 'travelling', label: 'De viaje pronto' }
];

const PRICE_OPTIONS = Core.PRICE_BUCKETS.map(b => ({ value: b.value, label: b.label, short: b.short }));

const INDEPENDENT_KEY = 'independent';

// Filtros de cada modo (orden del Figma). `all` = opción vacía del drawer.
const FILTER_DEFS = {
    artists: [
        { key: 'style', title: 'Estilo', all: 'Todos los estilos' },
        { key: 'location', title: 'Ubicación', all: 'Todas las ciudades' },
        { key: 'priceRange', title: 'Precio', all: 'Cualquier precio' },
        { key: 'availability', title: 'Disponibilidad', all: 'Cualquier disponibilidad' },
        { key: 'travel', title: 'Viajes', all: 'Cualquier estado de viaje' },
        { key: 'studio', title: 'Estudio', all: 'Todos los estudios' }
    ],
    studios: [
        { key: 'style', title: 'Estilo', all: 'Todos los estilos' },
        { key: 'location', title: 'Ubicación', all: 'Todas las ciudades' },
        { key: 'availability', title: 'Disponibilidad', all: 'Cualquier disponibilidad' },
        { key: 'services', title: 'Servicios', all: 'Todos los servicios' }
    ]
};

// Textos que cambian con el modo (Figma 801:1127 / 2113:9145).
const MODE_COPY = {
    artists: {
        title: 'Descubrí artistas',
        sub: 'Encontrá el tatuador que encaja con tu estilo.',
        placeholder: 'Buscar artistas, estilos, ciudades…',
        loading: 'Cargando artistas…',
        noun: ['artista encontrado', 'artistas encontrados'],
        more: 'Cargar más artistas',
        emptyTitle: 'No encontramos artistas con esos criterios',
        emptyText: 'Probá con otro estilo o ciudad, o limpiá los filtros para ver todos.',
        emptyCta: 'Ver todos los artistas',
        featuredTitle: 'Artistas destacados',
        featuredSub: 'Artistas promocionados en We Ötzi',
        featuredLink: 'Ver artistas destacados →',
        forYouTitle: 'Artistas para vos',
        forYouSub: 'Basado en tu búsqueda e intereses'
    },
    studios: {
        title: 'Descubrí estudios',
        sub: 'Encontrá el estudio y los artistas para tu próximo tatuaje.',
        placeholder: 'Buscar estudios, estilos, ciudades…',
        loading: 'Cargando estudios…',
        noun: ['estudio encontrado', 'estudios encontrados'],
        more: 'Cargar más estudios',
        emptyTitle: 'No encontramos estudios con esos criterios',
        emptyText: 'Probá con otra ciudad o estilo, o limpiá los filtros para ver todos.',
        emptyCta: 'Ver todos los estudios',
        featuredTitle: 'Estudios destacados',
        featuredSub: 'Estudios promocionados en We Ötzi',
        featuredLink: 'Ver estudios destacados →',
        forYouTitle: 'Estudios para vos',
        forYouSub: 'Según tus estilos guardados y tus favoritos'
    }
};

const MOBILE_QUERY = '(max-width: 768px)';
function isMobileViewport() {
    try { return window.matchMedia(MOBILE_QUERY).matches; } catch (e) { return false; }
}

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    bindStaticUi();
    const params = new URLSearchParams(window.location.search);
    if (/^estudios?$|^studios?$/i.test(params.get('modo') || params.get('mode') || '')) {
        browseMode = 'studios';
        applyModeChrome();
    }
    showLoading();
    try {
        await waitForConfigManager();
        await applySessionTopbar();
        await Promise.all([loadStyleCatalog(), loadFavorites()]);

        allArtists = await fetchArtists();
        await Promise.all([loadArtistAgenda(), loadRatings(), loadStudioNames()]);
        if (browseMode === 'studios') await fetchStudios();

        initFilterMenus();
        applyFilters();
        setupSearch();
        dataReady = true;
    } catch (err) {
        console.error('Error initializing marketplace:', err);
        showLoadError();
    } finally {
        hideLoading();
    }
});

function showLoadError() {
    const grid = document.getElementById('marketplace-grid');
    if (grid) grid.innerHTML = '';
    setText('results-count', browseMode === 'studios' ? 'No pudimos cargar los estudios' : 'No pudimos cargar los artistas');
    const empty = document.getElementById('empty-state');
    if (!empty) return;
    empty.classList.remove('hidden');
    setText('empty-title', browseMode === 'studios' ? 'No pudimos cargar los estudios' : 'No pudimos cargar los artistas');
    setText('empty-text', 'Revisá tu conexión y reintentá.');
    const retry = document.getElementById('empty-cta');
    if (retry) {
        retry.textContent = 'Reintentar';
        retry.onclick = () => window.location.reload();
    }
    document.getElementById('mk-load-more-wrap')?.classList.add('hidden');
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

// Catálogo de estilos del registro (alias de etiquetas históricas). Si falla,
// marketplace-core usa su copia local de los alias: el filtro sigue andando.
async function loadStyleCatalog() {
    try {
        const base = window.WEOTZI_BASE_PATH || '';
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 4000) : null;
        const res = await fetch(base + '/api/registration/catalogs', controller ? { signal: controller.signal } : undefined);
        if (timer) clearTimeout(timer);
        if (!res.ok) return;
        Core.setStyleCatalog(await res.json());
    } catch (err) {
        console.warn('[marketplace] catálogo de estilos no disponible, uso alias locales:', err && err.message);
    }
}

// ============================================
// TOPBAR / NAVEGACIÓN (Figma: Explorar artistas · Job board · Tattooglobe · Inbox)
// ============================================
const CLIENT_NAV = [
    { href: '/marketplace', label: 'Explorar artistas', active: true },
    { href: '/client/dashboard?tab=solicitudes', label: 'Job board' },
    { href: '/explore/globe', label: 'Tattooglobe' },
    { href: '/client/chats/', label: 'Inbox' }
];

function navLinksHtml(items, cls) {
    return items.map(item => `
        <a class="${cls}${item.active ? ' is-active' : ''}" href="${escapeHtml(item.href)}"${item.active ? ' aria-current="page"' : ''}>${escapeHtml(item.label)}</a>
    `).join('');
}

// El Figma muestra el marketplace con sesión iniciada (nav del cliente + tile Ö
// + LOG OUT). La página sigue siendo pública: sin sesión queda el CTA anónimo.
async function applySessionTopbar() {
    try {
        const client = window.ConfigManager && window.ConfigManager.getSupabaseClient();
        if (!client || window.ConfigManager.isDemoMode()) return;

        const { data: { session } } = await client.auth.getSession();
        if (!session) return;
        sessionUserId = session.user.id;

        const nav = document.getElementById('mk-nav');
        const mobileNav = document.getElementById('mk-mobile-menu');
        const right = document.getElementById('mk-topbar-right');
        if (!nav || !right) return;

        nav.innerHTML = navLinksHtml(CLIENT_NAV, 'wo-topbar-item');
        if (mobileNav) {
            mobileNav.innerHTML = navLinksHtml(CLIENT_NAV, 'mk-mobile-menu-link') +
                '<a class="mk-mobile-menu-link" href="/client/dashboard">Mis cotizaciones</a>' +
                '<button type="button" class="mk-mobile-menu-link mk-mobile-menu-logout" data-mk-logout>Log out</button>';
        }

        const meta = session.user.user_metadata || {};
        const initials = getInitials(meta.full_name || meta.name || session.user.email || '');
        right.innerHTML = `
            <a class="mk-profile-tile" href="/client/dashboard" title="Centro de cuenta" aria-label="Ir al centro de cuenta">${escapeHtml(initials)}</a>
            <button class="wo-btn wo-btn--danger wo-btn--s wo-btn--mono mk-logout" type="button" data-mk-logout>Log out</button>
            <button class="wo-iconbtn wo-iconbtn--s mk-burger" id="mk-menu-toggle" type="button"
                    aria-expanded="false" aria-controls="mk-mobile-menu" aria-label="Abrir menú">
                <i data-wo-icon="menu" class="wo-icon-18" aria-hidden="true"></i>
            </button>
        `;
        bindMobileMenu();
    } catch (err) {
        console.error('Error resolving marketplace session:', err);
    }
}

async function handleMarketplaceLogout() {
    try {
        const client = window.ConfigManager && window.ConfigManager.getSupabaseClient();
        if (client) await client.auth.signOut();
    } catch (err) {
        console.error('Logout error:', err);
    }
    window.location.href = '/client/login';
}

// Menú hamburguesa (≤ 768px). Se vuelve a enlazar si la topbar se reescribe.
function setMobileMenuOpen(open) {
    const toggle = document.getElementById('mk-menu-toggle');
    const menu = document.getElementById('mk-mobile-menu');
    if (!menu) return;
    menu.hidden = !open;
    if (toggle) {
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    }
}

let mobileMenuDocBound = false;
function bindMobileMenu() {
    const toggle = document.getElementById('mk-menu-toggle');
    const menu = document.getElementById('mk-mobile-menu');
    if (!menu) return;
    if (toggle && !toggle.dataset.woBound) {
        toggle.dataset.woBound = '1';
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            setMobileMenuOpen(menu.hidden);
        });
    }
    setMobileMenuOpen(false);
    if (mobileMenuDocBound) return;
    mobileMenuDocBound = true;
    menu.addEventListener('click', (e) => {
        if (e.target.closest('a, button')) setMobileMenuOpen(false);
    });
    document.addEventListener('click', (e) => {
        const current = document.getElementById('mk-menu-toggle');
        if (menu.hidden) return;
        if (!menu.contains(e.target) && !(current && current.contains(e.target))) setMobileMenuOpen(false);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !menu.hidden) {
            setMobileMenuOpen(false);
            document.getElementById('mk-menu-toggle')?.focus();
        }
    });
    window.addEventListener('resize', () => { if (!isMobileViewport()) setMobileMenuOpen(false); });
}

// ============================================
// DATOS
// ============================================

async function fetchArtists() {
    await waitForConfigManager();
    const supabaseClient = window.ConfigManager && window.ConfigManager.getSupabaseClient();
    if (!supabaseClient || window.ConfigManager.isDemoMode()) {
        throw new Error('La conexión con los artistas no está disponible');
    }
    // Lectura pública: solo columnas de la lista blanca de artists_db (RLS
    // acota a registros completos). Lista corta para la grilla (MK-17).
    const M = window.WeotziData && window.WeotziData.Marketplace;
    const { data, error } = M
        ? await M.listArtists()
        : await WeotziData.Artists.listPublic(window.ARTIST_PUBLIC_COLUMNS || '*');
    if (error) throw error;
    return (data || []).map(a => ({ ...a, is_recommended: a.is_recommended || false }));
}

// ============ SEÑALES REALES DE ESTADO ============

// Resuelve un builder de PostgREST sin romper la página: los datos
// complementarios (agenda, reseñas, viajes) son opcionales.
async function safeQuery(label, build) {
    try {
        const res = await build();
        if (res && res.error) throw res.error;
        return (res && res.data) || [];
    } catch (err) {
        console.warn(`[marketplace] ${label} no disponible:`, err && (err.message || err));
        return [];
    }
}

// Agenda: artist_tattoo_locations (pública) + viajes de Travel
// (public_artist_trips) + vacaciones del perfil.
async function loadArtistAgenda() {
    const M = WeotziData.Marketplace;
    const [locations, trips] = await Promise.all([
        safeQuery('agenda', () => M.listAgenda()),
        safeQuery('viajes', () => M.listUpcomingTrips())
    ]);
    artistAgenda = Core.buildAgenda({ locations, trips, artists: allArtists, today: todayIso() });
}

function todayIso() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// public_review_summary agrega verified_reviews aprobadas (vista pública).
async function loadRatings() {
    const M = WeotziData.Marketplace;
    const [artists, studios] = await Promise.all([
        safeQuery('reseñas de artistas', () => M.listReviewSummaries('artist')),
        safeQuery('reseñas de estudios', () => M.listReviewSummaries('studio'))
    ]);
    artistRatings = {};
    studioRatings = {};
    artists.forEach(row => { artistRatings[row.reviewee_user_id] = row; });
    studios.forEach(row => { studioRatings[row.reviewee_user_id] = row; });
}

// Nombre real del estudio al que está afiliado cada artista (studio_id).
async function loadStudioNames() {
    const ids = [...new Set(allArtists.map(a => a.studio_id).filter(Boolean))];
    studioNames = {};
    if (!ids.length) return;
    const rows = await safeQuery('estudios de los artistas', () => WeotziData.Marketplace.listStudioNames(ids));
    rows.forEach(row => { studioNames[row.id] = { name: row.name || 'Estudio', slug: row.slug || row.id }; });
    allArtists.forEach(a => { a._studioName = a.studio_id && studioNames[a.studio_id] ? studioNames[a.studio_id].name : ''; });
}

function artistFlags(artist) {
    return artistAgenda[artist.user_id] || null;
}

function getArtistStatus(artist) {
    return Core.artistStatus(artistFlags(artist));
}

// Clave de afiliación: el estudio real (studio_id) o, sin él, el texto libre
// `estudios` (descartando "Sin estudio / Independiente") o independiente.
function artistStudioKey(artist) {
    if (artist.studio_id) return `id:${artist.studio_id}`;
    const text = String(artist.estudios || '').trim();
    if (text && !/^(sin estudio|independiente|ninguno|no)\b/i.test(text)) return `txt:${Core.normalizeKey(text)}`;
    return INDEPENDENT_KEY;
}

function artistStudioLabel(artist) {
    if (artist.studio_id) return artist._studioName || '';
    const key = artistStudioKey(artist);
    return key.startsWith('txt:') ? String(artist.estudios).trim() : '';
}

function isVerifiedArtist(artist) {
    return artist.verification_state === 'Yes';
}

// ============ ESTUDIOS (Figma 2113:9145) ============
async function fetchStudios() {
    if (Array.isArray(allStudios)) return allStudios;
    const M = WeotziData.Marketplace;
    const { data, error } = await M.listStudios();
    if (error) throw error;
    const studios = data || [];
    const ids = studios.map(s => s.id).filter(Boolean);
    const locations = ids.length ? await safeQuery('sedes', () => M.listStudioLocations(ids)) : [];
    const byStudio = {};
    locations.forEach(l => { (byStudio[l.studio_id] = byStudio[l.studio_id] || []).push(l); });

    allStudios = studios.map(s => {
        const sedes = (byStudio[s.id] || []).slice().sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary));
        const cities = sedes.map(l => l.city).filter(Boolean);
        if (!cities.length && s.city) cities.push(s.city);
        const roster = allArtists.filter(a => a.studio_id === s.id);
        const styles = Core.parseList(s.specialty_styles);
        roster.forEach(a => Core.parseList(a.styles_array).forEach(st => styles.push(st)));
        return {
            ...s,
            _cities: cities,
            _country: (sedes[0] && sedes[0].country) || s.country || '',
            _styles: styles,
            _roster: roster,
            _flags: Core.studioFlags(s, { roster, agenda: artistAgenda, today: todayIso() }),
            _services: Core.parseList(s.equipment)
        };
    });
    return allStudios;
}

async function setBrowseMode(mode) {
    if (mode !== 'artists' && mode !== 'studios') return;
    if (browseMode === mode) return;
    closeAllFilterMenus();
    const drawer = document.getElementById('mk-filter-drawer');
    if (drawer && !drawer.hidden) toggleAllFilters(false);
    browseMode = mode;
    applyModeChrome();
    // Durante la carga inicial solo cambia el modo: el init termina el trabajo.
    if (!dataReady) return;
    try {
        const url = new URL(window.location.href);
        if (mode === 'studios') url.searchParams.set('modo', 'estudios');
        else url.searchParams.delete('modo');
        window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (e) { /* sin history: el modo vive solo en memoria */ }

    if (mode === 'studios' && !Array.isArray(allStudios)) {
        showLoading();
        try {
            await fetchStudios();
        } catch (err) {
            console.error('Error loading studios:', err);
            allStudios = null;
            hideLoading();
            showLoadError();
            return;
        }
        hideLoading();
    }
    initFilterMenus();
    applyFilters();
}

// Títulos, buscador y botones según el modo (sin datos).
function applyModeChrome() {
    const copy = MODE_COPY[browseMode];
    setText('mk-title', copy.title);
    setText('mk-sub', copy.sub);
    const input = document.getElementById('smart-search');
    if (input) {
        input.placeholder = copy.placeholder;
        input.setAttribute('aria-label', copy.placeholder.replace('…', ''));
        input.value = currentFilters().search || '';
    }
    document.getElementById('search-suggestions')?.classList.add('hidden');
    ['artists', 'studios'].forEach(m => {
        const btn = document.getElementById(`mode-${m}`);
        if (!btn) return;
        btn.classList.toggle('is-active', m === browseMode);
        btn.setAttribute('aria-pressed', String(m === browseMode));
    });
    // El corazón del hero filtra artistas favoritos: no aplica a estudios.
    const fav = document.getElementById('mk-fav-toggle');
    if (fav) fav.hidden = browseMode === 'studios';
    document.getElementById('mk-featured')?.classList.toggle('mk-featured--studios', browseMode === 'studios');
    setText('mk-featured-title', copy.featuredTitle);
    setText('mk-featured-sub', copy.featuredSub);
    setText('mk-featured-link', copy.featuredLink);
    setText('mk-foryou-title', copy.forYouTitle);
    setText('mk-foryou-sub', copy.forYouSub);
    setText('empty-title', copy.emptyTitle);
    setText('empty-text', copy.emptyText);
    const cta = document.getElementById('empty-cta');
    if (cta) { cta.textContent = copy.emptyCta; cta.onclick = () => clearAllFilters(); }
    setText('results-count', copy.loading);
}

// ============================================
// FAVORITOS
// ============================================
function readLocalFavorites() {
    try {
        const raw = localStorage.getItem(FAV_STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.filter(Boolean) : [];
    } catch (e) {
        return [];
    }
}

function writeLocalFavorites(ids) {
    try {
        localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify([...ids]));
    } catch (e) { /* storage lleno o bloqueado: el corazón vive solo en memoria */ }
}

async function loadFavorites() {
    if (!sessionUserId || !window.WeotziData || !window.WeotziData.Favorites) {
        favoriteIds = new Set(readLocalFavorites());
        return;
    }
    try {
        const pending = readLocalFavorites();
        for (const artistId of pending) {
            await WeotziData.Favorites.add(sessionUserId, artistId);
        }
        if (pending.length) {
            try { localStorage.removeItem(FAV_STORAGE_KEY); } catch (e) { /* noop */ }
        }
        const rows = await WeotziData.Favorites.listByClient(sessionUserId);
        favoriteIds = new Set(rows.map(r => r.artist_user_id));
    } catch (err) {
        console.error('Error loading favorites:', err);
        favoriteIds = new Set(readLocalFavorites());
    }
}

// Toggle optimista: la UI cambia ya; si el backend falla, se revierte.
async function toggleFavorite(artistUserId) {
    if (!artistUserId) return;
    const wasFavorite = favoriteIds.has(artistUserId);
    if (wasFavorite) favoriteIds.delete(artistUserId);
    else favoriteIds.add(artistUserId);
    syncHeartButtons(artistUserId);

    if (sessionUserId && window.WeotziData && window.WeotziData.Favorites) {
        try {
            await WeotziData.Favorites.toggle(sessionUserId, artistUserId, wasFavorite);
        } catch (err) {
            console.error('Error toggling favorite:', err);
            if (wasFavorite) favoriteIds.add(artistUserId);
            else favoriteIds.delete(artistUserId);
            syncHeartButtons(artistUserId);
            return;
        }
    } else {
        writeLocalFavorites(favoriteIds);
    }
    if (favoritesOnly) applyFilters();
}

function syncHeartButtons(artistUserId) {
    const isFav = favoriteIds.has(artistUserId);
    document.querySelectorAll(`.mk-card-fav[data-fav-artist="${CSS.escape(artistUserId)}"]`).forEach(btn => {
        btn.classList.toggle('is-fav', isFav);
        btn.setAttribute('aria-pressed', String(isFav));
    });
}

// Atajo corazón del hero (Figma 286:11980): filtra solo favoritos.
function toggleFavoritesOnly() {
    favoritesOnly = !favoritesOnly;
    const btn = document.getElementById('mk-fav-toggle');
    if (btn) {
        btn.classList.toggle('is-active', favoritesOnly);
        btn.setAttribute('aria-pressed', String(favoritesOnly));
    }
    resetPaging();
    applyFilters();
}

// ============================================
// OPCIONES DE FILTRO
// ============================================
function computeArtistOptions() {
    const style = Core.buildStyleOptions(allArtists, a => a.styles_array);
    const location = Core.buildCityOptions(allArtists, a => Core.cityOf(a));

    const priceCounts = { low: 0, medium: 0, high: 0 };
    allArtists.forEach(a => {
        const bucket = Core.priceBucket(a.session_price_amount_usd);
        if (bucket) priceCounts[bucket] += 1;
    });
    const priceRange = PRICE_OPTIONS.map(o => ({ ...o, count: priceCounts[o.value] }));

    const flagsOf = a => artistFlags(a);
    const availability = AVAILABILITY_OPTIONS.map(o => ({
        ...o, count: allArtists.filter(a => Core.matchesAvailability(flagsOf(a), o.value)).length
    }));
    const travel = TRAVEL_OPTIONS.map(o => ({
        ...o, count: allArtists.filter(a => Core.matchesTravel(flagsOf(a), o.value)).length
    }));

    const studioMap = new Map();
    let independents = 0;
    allArtists.forEach(a => {
        const key = artistStudioKey(a);
        if (key === INDEPENDENT_KEY) { independents += 1; return; }
        const label = artistStudioLabel(a) || 'Estudio';
        const entry = studioMap.get(key) || { value: key, label, count: 0 };
        entry.count += 1;
        studioMap.set(key, entry);
    });
    const studio = [...studioMap.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'es'));
    if (independents) studio.push({ value: INDEPENDENT_KEY, label: 'Independiente', count: independents });

    return { style, location, priceRange, availability, travel, studio };
}

function computeStudioOptions() {
    const studios = allStudios || [];
    return {
        style: Core.buildStyleOptions(studios, s => s._styles),
        location: Core.buildCityOptions(studios, s => s._cities),
        availability: Core.STUDIO_AVAILABILITY_OPTIONS
            .map(o => ({ ...o, count: studios.filter(s => s._flags[o.value]).length }))
            .filter(o => o.count > 0),
        services: Core.buildCityOptions(studios, s => s._services)
    };
}

function initFilterMenus() {
    filterOptions[browseMode] = browseMode === 'studios' ? computeStudioOptions() : computeArtistOptions();
    renderFilterRow();
    renderDrawer();
}

function optionsFor(key) {
    return (filterOptions[browseMode] && filterOptions[browseMode][key]) || [];
}

function optionLabel(key, value) {
    const opt = optionsFor(key).find(o => o.value === value);
    if (!opt) return value;
    return opt.short || opt.label;
}

function verifiedCount() {
    return browseMode === 'studios'
        ? (allStudios || []).filter(s => s.is_verified === true).length
        : allArtists.filter(isVerifiedArtist).length;
}

// Fila de filtros del modo actual. Un filtro sin opciones reales no se muestra.
function renderFilterRow() {
    const row = document.getElementById('mk-filters');
    if (!row) return;
    const defs = FILTER_DEFS[browseMode];
    row.innerHTML = defs.map(def => {
        const hasOptions = optionsFor(def.key).length > 0;
        return `
            <div class="mk-filter" data-filter-key="${def.key}"${hasOptions ? '' : ' hidden'}>
                <button type="button" class="mk-filter-btn" id="mk-filter-btn-${def.key}" data-filter-toggle="${def.key}"
                        aria-expanded="false" aria-controls="mk-filter-menu-${def.key}">
                    <span class="mk-filter-label" id="mk-filter-label-${def.key}">${escapeHtml(def.title)}</span>
                    <i data-wo-icon="chevron-down" aria-hidden="true"></i>
                </button>
                <div class="mk-filter-menu" id="mk-filter-menu-${def.key}" role="group"
                     aria-label="${escapeHtml(def.title)}" hidden></div>
            </div>
        `;
    }).join('') + `
        <button type="button" class="mk-filter-btn mk-verified-btn" id="mk-verified-btn" data-verified-toggle aria-pressed="false">
            <i data-wo-icon="check-circle" aria-hidden="true"></i>
            <span class="mk-filter-label">Verificados</span>
            <span class="mk-filter-count" id="mk-verified-count">${verifiedCount()}</span>
        </button>
        <span class="mk-filters-sep" aria-hidden="true"></span>
        <button type="button" class="mk-filter-btn mk-allfilters-btn" id="mk-allfilters-btn"
                aria-expanded="${String(!document.getElementById('mk-filter-drawer')?.hidden)}" aria-controls="mk-filter-drawer" data-allfilters-toggle>
            <i data-wo-icon="sliders" aria-hidden="true"></i>
            <span class="mk-filter-label">Todos los filtros</span>
        </button>
    `;
    syncFilterButtons();
}

// Menú de un filtro: se arma al abrirlo con el estado actual.
function renderFilterMenu(key) {
    const menu = document.getElementById(`mk-filter-menu-${key}`);
    if (!menu) return;
    const def = FILTER_DEFS[browseMode].find(d => d.key === key);
    const selected = currentFilters()[key];
    const options = optionsFor(key);
    const rows = options.map(o => `
        <button type="button" class="mk-filter-opt${selected === o.value ? ' is-selected' : ''}"
                aria-pressed="${selected === o.value}" data-filter-key="${escapeHtml(key)}" data-filter-value="${escapeHtml(o.value)}">
            <span>${escapeHtml(o.label)}</span>
            ${o.count == null ? '' : `<span class="mk-filter-opt-count">${o.count}</span>`}
        </button>
    `).join('');
    menu.innerHTML = `
        <div class="mk-filter-menu-head">
            <span class="mk-filter-menu-title">${escapeHtml(def ? def.title : '')}</span>
            <button type="button" class="mk-filter-menu-close" data-filter-close aria-label="Cerrar">
                <i data-wo-icon="x" aria-hidden="true"></i>
            </button>
        </div>
        <div class="mk-filter-menu-list">
            ${selected ? `<button type="button" class="mk-filter-opt mk-filter-opt--clear" data-filter-key="${escapeHtml(key)}" data-filter-value=""><span>Quitar filtro</span></button>` : ''}
            ${rows || '<p class="mk-filter-empty">Sin opciones disponibles</p>'}
        </div>
    `;
}

// Drawer "Todos los filtros": los mismos filtros en selects del DS.
function renderDrawer() {
    const grid = document.getElementById('mk-drawer-grid');
    if (!grid) return;
    const filters = currentFilters();
    grid.innerHTML = FILTER_DEFS[browseMode]
        .filter(def => optionsFor(def.key).length > 0)
        .map(def => `
            <div class="wo-field">
                <label class="wo-label" for="mk-drawer-${def.key}">${escapeHtml(def.title)}</label>
                <select id="mk-drawer-${def.key}" class="wo-select" data-drawer-key="${def.key}">
                    <option value="">${escapeHtml(def.all)}</option>
                    ${optionsFor(def.key).map(o => `<option value="${escapeHtml(o.value)}"${filters[def.key] === o.value ? ' selected' : ''}>${escapeHtml(o.count == null ? o.label : `${o.label} (${o.count})`)}</option>`).join('')}
                </select>
            </div>
        `).join('');
}

function toggleAllFilters(force) {
    const drawer = document.getElementById('mk-filter-drawer');
    if (!drawer) return;
    const open = typeof force === 'boolean' ? force : drawer.hidden;
    drawer.hidden = !open;
    ['mk-filters-open', 'mk-allfilters-btn'].forEach(id => {
        document.getElementById(id)?.setAttribute('aria-expanded', String(open));
    });
    if (open) {
        closeAllFilterMenus();
        drawer.querySelector('select')?.focus();
    }
}

function syncDrawerSelects() {
    const filters = currentFilters();
    document.querySelectorAll('select[data-drawer-key]').forEach(select => {
        const value = filters[select.dataset.drawerKey] || '';
        if (select.value !== value) select.value = value;
    });
}

let openMenuKey = null;

function closeAllFilterMenus({ restoreFocus = false } = {}) {
    const previous = openMenuKey;
    document.querySelectorAll('.mk-filter-menu').forEach(m => { m.hidden = true; });
    document.querySelectorAll('[data-filter-toggle]').forEach(b => b.setAttribute('aria-expanded', 'false'));
    document.body.classList.remove('mk-sheet-open');
    const scrim = document.getElementById('mk-filter-scrim');
    if (scrim) scrim.hidden = true;
    openMenuKey = null;
    if (restoreFocus && previous) document.getElementById(`mk-filter-btn-${previous}`)?.focus();
}

function toggleFilterMenu(key) {
    const menu = document.getElementById(`mk-filter-menu-${key}`);
    if (!menu) return;
    const wasOpen = !menu.hidden;
    closeAllFilterMenus();
    if (wasOpen) return;
    renderFilterMenu(key);
    menu.hidden = false;
    openMenuKey = key;
    document.getElementById(`mk-filter-btn-${key}`)?.setAttribute('aria-expanded', 'true');
    // En móvil el menú es un bottom sheet sobre un fondo (CSS ≤ 768px).
    if (isMobileViewport()) {
        document.body.classList.add('mk-sheet-open');
        const scrim = document.getElementById('mk-filter-scrim');
        if (scrim) scrim.hidden = false;
    }
    (menu.querySelector('.mk-filter-opt.is-selected') || menu.querySelector('.mk-filter-opt'))?.focus();
}

function selectFilterOption(key, value) {
    const filters = currentFilters();
    filters[key] = value || null;
    closeAllFilterMenus({ restoreFocus: true });
    resetPaging();
    applyFilters();
}

function toggleVerifiedOnly() {
    const filters = currentFilters();
    filters.verified = !filters.verified;
    resetPaging();
    applyFilters();
}

function syncFilterButtons() {
    syncDrawerSelects();
    const filters = currentFilters();
    FILTER_DEFS[browseMode].forEach(def => {
        const wrap = document.querySelector(`.mk-filter[data-filter-key="${def.key}"]`);
        const label = document.getElementById(`mk-filter-label-${def.key}`);
        if (!wrap || !label) return;
        const value = filters[def.key];
        wrap.classList.toggle('is-set', !!value);
        label.textContent = value ? `${def.title} · ${optionLabel(def.key, value)}` : def.title;
    });
    const verifiedBtn = document.getElementById('mk-verified-btn');
    if (verifiedBtn) {
        verifiedBtn.classList.toggle('is-set', !!filters.verified);
        verifiedBtn.setAttribute('aria-pressed', String(!!filters.verified));
    }
}

// ============================================
// RENDER
// ============================================

function cardMedia(item) {
    const own = Core.safeMediaUrl(item.profile_picture);
    if (own) return own;
    const gallery = Core.parseList(item.gallery_images).map(Core.safeMediaUrl).filter(Boolean);
    return gallery[0] || '';
}

function verifiedBadge(label) {
    return `<span class="mk-card-verified" title="${escapeHtml(label)}"><i data-wo-icon="check-circle" aria-hidden="true"></i><span class="wo-sr-only">${escapeHtml(label)}</span></span>`;
}

function ratingHtml(summary) {
    if (!summary || !Number(summary.average_rating)) return '';
    return `<span class="mk-card-rating"><i data-wo-icon="star" aria-hidden="true"></i><span class="wo-sr-only">Calificación </span>${Number(summary.average_rating).toFixed(1)}</span>`;
}

// Card de artista compartida por la grilla, "destacados" y "para vos".
// Toda la card es un enlace real (mk-card-hit: Tab, clic medio, nueva pestaña);
// el corazón queda por encima.
function artistCardHtml(artist, opts = {}) {
    const styles = Core.parseList(artist.styles_array);
    const media = cardMedia(artist);
    const city = Core.titleCase(Core.cityOf(artist));
    const mainStyle = styles.length > 0 ? (Core.canonicalStyleLabel(styles[0]) || styles[0]) : '';
    const metaLine = [city, mainStyle].filter(Boolean).join(' · ');
    const status = getArtistStatus(artist);
    const displayName = Core.titleCase(artist.name || artist.username || 'Artista');
    const name = escapeHtml(displayName);
    const userId = escapeHtml(artist.user_id || '');
    const isFav = favoriteIds.has(artist.user_id);
    const verified = isVerifiedArtist(artist);
    const studioLabel = artistStudioLabel(artist);
    const href = `/artist/profile?artist=${encodeURIComponent(artist.username || '')}`;

    return `
        <article class="wo-card wo-card--media wo-card--hover mk-card">
            <div class="mk-card-media">
                <i data-wo-icon="image" class="mk-media-ph" aria-hidden="true"></i>
                ${media ? `<img src="${escapeHtml(media)}" alt="" loading="lazy" decoding="async" onerror="this.remove();">` : ''}
                <span class="mk-card-topfade" aria-hidden="true"></span>
                <a class="mk-card-hit" href="${escapeHtml(href)}" aria-label="${escapeHtml(`Ver el perfil de ${displayName}${verified ? ' (verificado)' : ''}`)}"></a>
                <div class="mk-card-top">
                    ${opts.sponsored ? `<span class="mk-card-sponsored"><i data-wo-icon="award" aria-hidden="true"></i>Patrocinado</span>` : ''}
                    ${status ? `<span class="mk-card-status mk-card-status--${status.key}">${escapeHtml(status.label)}</span>` : ''}
                </div>
                ${userId ? `
                <button type="button" class="mk-card-fav${isFav ? ' is-fav' : ''}" data-fav-artist="${userId}"
                        aria-pressed="${isFav}" aria-label="${escapeHtml(`Guardar a ${displayName} en favoritos`)}">
                    <i data-wo-icon="heart" aria-hidden="true"></i>
                </button>` : ''}
                <div class="mk-card-overlay">
                    <span class="mk-card-avatar" aria-hidden="true">${escapeHtml(getInitials(artist.name))}</span>
                    <div class="mk-card-id">
                        <h3 class="mk-card-name"><span class="mk-card-name-text">${name}</span>${verified ? verifiedBadge('Artista verificado') : ''}</h3>
                        ${studioLabel ? `<p class="mk-card-studio">${escapeHtml(studioLabel)}</p>` : ''}
                    </div>
                </div>
                <div class="mk-card-metarow">
                    <p class="mk-card-meta">${escapeHtml(metaLine)}</p>
                    ${ratingHtml(artistRatings[artist.user_id])}
                </div>
            </div>
        </article>
    `;
}

function studioCardHtml(studio, opts = {}) {
    const media = Core.safeMediaUrl(studio.cover_image) || Core.safeMediaUrl(studio.logo_image)
        || (Array.isArray(studio.photo_feed_items) ? studio.photo_feed_items.map(p => Core.safeMediaUrl(p && p.url)).find(Boolean) : '') || '';
    const city = Core.titleCase(studio._cities && studio._cities[0] ? studio._cities[0] : '');
    const styles = Core.buildStyleOptions([studio], s => s._styles);
    const mainStyle = styles[0] ? styles[0].label : '';
    const metaLine = [city, mainStyle].filter(Boolean).join(' · ') || studio.tagline || '';
    const status = Core.studioStatus(studio._flags);
    const displayName = studio.name || 'Estudio';
    const verified = studio.is_verified === true;
    const ref = studio.slug || studio.id;
    const href = `/studio/profile?studio=${encodeURIComponent(ref || '')}`;
    const artists = studio._roster ? studio._roster.length : 0;

    return `
        <article class="wo-card wo-card--media wo-card--hover mk-card mk-card--studio">
            <div class="mk-card-media">
                <i data-wo-icon="image" class="mk-media-ph" aria-hidden="true"></i>
                ${media ? `<img src="${escapeHtml(media)}" alt="" loading="lazy" decoding="async" onerror="this.remove();">` : ''}
                <span class="mk-card-topfade" aria-hidden="true"></span>
                <a class="mk-card-hit" href="${escapeHtml(href)}" aria-label="${escapeHtml(`Ver el estudio ${displayName}${verified ? ' (verificado)' : ''}`)}"></a>
                <div class="mk-card-top">
                    ${opts.sponsored ? `<span class="mk-card-sponsored"><i data-wo-icon="award" aria-hidden="true"></i>Patrocinado</span>` : ''}
                    ${status ? `<span class="mk-card-status mk-card-status--${status.key}">${escapeHtml(status.label)}</span>` : ''}
                </div>
                <div class="mk-card-overlay">
                    <span class="mk-card-avatar" aria-hidden="true">${escapeHtml(getInitials(studio.name))}</span>
                    <div class="mk-card-id">
                        <h3 class="mk-card-name"><span class="mk-card-name-text">${escapeHtml(displayName)}</span>${verified ? verifiedBadge('Estudio verificado') : ''}</h3>
                        ${artists ? `<p class="mk-card-studio">${escapeHtml(Core.plural(artists, 'artista', 'artistas'))}</p>` : ''}
                    </div>
                </div>
                <div class="mk-card-metarow">
                    <p class="mk-card-meta">${escapeHtml(metaLine)}</p>
                    ${ratingHtml(studioRatings[studio.id])}
                </div>
            </div>
        </article>
    `;
}

function resetPaging() {
    visibleCount.artists = PAGE_SIZE.artists;
    visibleCount.studios = PAGE_SIZE.studios;
}

// Grilla principal del modo actual con "Cargar más".
function renderResults() {
    const grid = document.getElementById('marketplace-grid');
    const emptyState = document.getElementById('empty-state');
    const moreWrap = document.getElementById('mk-load-more-wrap');
    const moreBtn = document.getElementById('mk-load-more');
    if (!grid) return;

    const list = browseMode === 'studios' ? filteredStudios : filteredArtists;
    const copy = MODE_COPY[browseMode];
    setText('results-count', Core.plural(list.length, copy.noun[0], copy.noun[1]));

    if (list.length === 0) {
        grid.innerHTML = '';
        emptyState?.classList.remove('hidden');
        moreWrap?.classList.add('hidden');
        return;
    }
    emptyState?.classList.add('hidden');

    const page = Core.pageInfo(list.length, visibleCount[browseMode]);
    const cardHtml = browseMode === 'studios' ? (s => studioCardHtml(s)) : (a => artistCardHtml(a));
    grid.innerHTML = list.slice(0, page.shown).map(cardHtml).join('');

    if (moreWrap && moreBtn) {
        moreWrap.classList.toggle('hidden', !page.hasMore);
        moreBtn.textContent = `${copy.more} · ${page.remaining}`;
    }
}

function loadMore() {
    const before = visibleCount[browseMode];
    visibleCount[browseMode] += PAGE_SIZE[browseMode];
    renderResults();
    // Foco en la primera card nueva (teclado / lector de pantalla).
    const links = document.querySelectorAll('#marketplace-grid .mk-card-hit');
    if (links[before]) links[before].focus();
}

// ¿Hay algún filtro, búsqueda o atajo de favoritos activo?
function hasActiveFilters() {
    const filters = currentFilters();
    const anyKey = FILTER_DEFS[browseMode].some(def => !!filters[def.key]);
    return !!(filters.search || filters.verified || anyKey || (browseMode === 'artists' && favoritesOnly));
}

// ============ DESTACADOS (Figma 286:12580 / 2113:9145) ============
// v1 sin campo de curaduría: top 4 por rating real (public_review_summary).
// Solo sin filtros/búsqueda activos, como en el mock.
function renderFeatured() {
    const section = document.getElementById('mk-featured');
    const grid = document.getElementById('mk-featured-grid');
    featuredIds = [];
    if (!section || !grid) return;
    if (hasActiveFilters()) {
        section.classList.add('hidden');
        return;
    }

    let html = '';
    if (browseMode === 'studios') {
        const top = (allStudios || [])
            .filter(s => studioRatings[s.id] && Number(studioRatings[s.id].average_rating))
            .sort((a, b) => {
                const ra = studioRatings[a.id], rb = studioRatings[b.id];
                return (rb.average_rating - ra.average_rating) || ((rb.review_count || 0) - (ra.review_count || 0));
            })
            .slice(0, 4);
        featuredIds = top.map(s => s.id);
        html = top.map(s => studioCardHtml(s, { sponsored: true })).join('');
    } else {
        const top = allArtists
            .filter(a => artistRatings[a.user_id] && Number(artistRatings[a.user_id].average_rating))
            .sort((a, b) => {
                const ra = artistRatings[a.user_id], rb = artistRatings[b.user_id];
                return (rb.average_rating - ra.average_rating) || ((rb.review_count || 0) - (ra.review_count || 0));
            })
            .slice(0, 4);
        featuredIds = top.map(a => a.user_id);
        html = top.map(a => artistCardHtml(a, { sponsored: true })).join('');
    }

    if (!featuredIds.length) {
        section.classList.add('hidden');
        return;
    }
    grid.innerHTML = html;
    section.classList.remove('hidden');
}

function scrollFeaturedIntoView() {
    const grid = document.getElementById('mk-featured-grid');
    grid?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    grid?.querySelector('.mk-card-hit')?.focus({ preventScroll: true });
}

// ============ PARA VOS (Figma 286:12794 / 2113:9145) ============
// Personalización client-side: estilos y ciudades filtrados recientemente
// (localStorage) y, en artistas, los favoritos. Sin señal no se muestra.
function readSearchSignals() {
    try {
        const raw = localStorage.getItem(SIGNALS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return {
            styles: Array.isArray(parsed?.styles) ? parsed.styles : [],
            cities: Array.isArray(parsed?.cities) ? parsed.cities : []
        };
    } catch (e) {
        return { styles: [], cities: [] };
    }
}

function recordSearchSignals() {
    const filters = currentFilters();
    const style = filters.style;
    const city = filters.location;
    if (!style && !city) return;
    try {
        const signals = readSearchSignals();
        const push = (list, value) => [value, ...list.filter(v => v !== value)].slice(0, 8);
        if (style) signals.styles = push(signals.styles, style);
        if (city) signals.cities = push(signals.cities, city);
        localStorage.setItem(SIGNALS_STORAGE_KEY, JSON.stringify(signals));
    } catch (e) { /* sin storage no hay personalización */ }
}

function renderForYou() {
    const section = document.getElementById('mk-foryou');
    const grid = document.getElementById('mk-foryou-grid');
    if (!section || !grid) return;
    if (hasActiveFilters()) {
        section.classList.add('hidden');
        return;
    }
    const signals = readSearchSignals();
    // Las señales se guardan como claves normalizadas (grupo de estilo / ciudad).
    const styleKeys = signals.styles.map(s => Core.styleGroupKey(s));
    const cityKeys = signals.cities.map(c => Core.normalizeKey(c));

    const scoreOf = (styles, cities) => {
        const own = new Set(Core.parseList(styles).map(s => Core.styleGroupKey(s)));
        const ownCities = new Set(Core.parseList(cities).map(c => Core.normalizeKey(c)));
        let score = 0;
        styleKeys.forEach((key, idx) => { if (own.has(key)) score += 2 + (styleKeys.length - idx) * 0.1; });
        cityKeys.forEach((key, idx) => { if (ownCities.has(key)) score += 2 + (cityKeys.length - idx) * 0.1; });
        return score;
    };

    let html = '';
    if (browseMode === 'studios') {
        // Estudios de los artistas favoritos suman señal.
        const favStudios = new Set(allArtists.filter(a => favoriteIds.has(a.user_id) && a.studio_id).map(a => a.studio_id));
        if (!styleKeys.length && !cityKeys.length && !favStudios.size) { section.classList.add('hidden'); return; }
        const scored = (allStudios || [])
            .filter(s => !featuredIds.includes(s.id))
            .map(s => ({ s, score: scoreOf(s._styles, s._cities) + (favStudios.has(s.id) ? 3 : 0) }))
            .filter(x => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 4);
        html = scored.map(x => studioCardHtml(x.s)).join('');
    } else {
        if (!styleKeys.length && !cityKeys.length) { section.classList.add('hidden'); return; }
        const scored = allArtists
            .filter(a => !featuredIds.includes(a.user_id))
            .map(a => ({ a, score: scoreOf(a.styles_array, [Core.cityOf(a)]) }))
            .filter(x => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 4);
        html = scored.map(x => artistCardHtml(x.a)).join('');
    }
    if (!html) { section.classList.add('hidden'); return; }
    grid.innerHTML = html;
    section.classList.remove('hidden');
}

// ============ FILTROS ACTIVOS ============
function updateActiveFiltersUI() {
    const container = document.getElementById('active-filters-section');
    const list = document.getElementById('active-filters-list');
    syncFilterButtons();
    if (!container || !list) return;

    const filters = currentFilters();
    const active = [];
    if (favoritesOnly && browseMode === 'artists') active.push({ type: 'favorites', label: 'Solo favoritos' });
    if (filters.search) active.push({ type: 'search', label: `"${filters.search}"` });
    if (filters.verified) active.push({ type: 'verified', label: 'Solo verificados' });
    FILTER_DEFS[browseMode].forEach(def => {
        if (filters[def.key]) active.push({ type: def.key, label: `${def.title}: ${optionLabel(def.key, filters[def.key])}` });
    });

    if (!active.length) {
        container.classList.add('hidden');
        list.innerHTML = '';
        return;
    }
    container.classList.remove('hidden');
    list.innerHTML = active.map(f => `
        <span class="wo-tag mk-filter-tag">
            <span>${escapeHtml(f.label)}</span>
            <button type="button" class="wo-tag-x" data-remove-filter="${escapeHtml(f.type)}" aria-label="${escapeHtml(`Quitar filtro ${f.label}`)}">
                <i data-wo-icon="x" aria-hidden="true"></i>
            </button>
        </span>
    `).join('');
}

// ============================================
// LÓGICA DE FILTROS
// ============================================
function artistMatches(artist, filters) {
    if (favoritesOnly && !favoriteIds.has(artist.user_id)) return false;
    if (filters.verified && !isVerifiedArtist(artist)) return false;
    if (filters.search && !Core.matchesSearch(filters.search,
        [artist.name, artist.username, Core.cityOf(artist), artist.country, artistStudioLabel(artist)],
        artist.styles_array)) return false;
    if (filters.style && !Core.hasStyle(artist.styles_array, filters.style)) return false;
    if (filters.location && Core.normalizeKey(Core.cityOf(artist)) !== filters.location) return false;
    if (filters.studio && artistStudioKey(artist) !== filters.studio) return false;
    const flags = artistFlags(artist);
    if (filters.availability && !Core.matchesAvailability(flags, filters.availability)) return false;
    if (filters.travel && !Core.matchesTravel(flags, filters.travel)) return false;
    if (filters.priceRange && Core.priceBucket(artist.session_price_amount_usd) !== filters.priceRange) return false;
    return true;
}

function studioMatches(studio, filters) {
    if (filters.verified && studio.is_verified !== true) return false;
    if (filters.search && !Core.matchesSearch(filters.search,
        [studio.name, studio.tagline, studio._country].concat(studio._cities || []),
        studio._styles)) return false;
    if (filters.style && !Core.hasStyle(studio._styles, filters.style)) return false;
    if (filters.location && !(studio._cities || []).some(c => Core.normalizeKey(c) === filters.location)) return false;
    if (filters.availability && !studio._flags[filters.availability]) return false;
    if (filters.services && !(studio._services || []).some(s => Core.normalizeKey(s) === filters.services)) return false;
    return true;
}

function applyFilters() {
    const filters = currentFilters();
    if (browseMode === 'studios') {
        filteredStudios = (allStudios || []).filter(s => studioMatches(s, filters));
        filteredStudios.sort((a, b) =>
            (Number(b.is_verified === true) - Number(a.is_verified === true)) ||
            ((studioRatings[b.id]?.average_rating || 0) - (studioRatings[a.id]?.average_rating || 0)) ||
            String(a.name || '').localeCompare(String(b.name || ''), 'es'));
    } else {
        filteredArtists = allArtists.filter(a => artistMatches(a, filters));
        sortArtists();
    }
    recordSearchSignals();
    renderResults();
    renderFeatured();
    renderForYou();
    updateActiveFiltersUI();
}

// Orden por defecto: artist_index (score real ya calculado en artists_db).
function sortArtists() {
    filteredArtists.sort((a, b) => {
        const scoreA = a.artist_index || (a.is_recommended ? 50 : 0);
        const scoreB = b.artist_index || (b.is_recommended ? 50 : 0);
        return scoreB - scoreA;
    });
}

// ============================================
// BÚSQUEDA EN VIVO + AUTOCOMPLETADO
// ============================================
const SEARCH_DEBOUNCE_MS = 250;
let searchTimer = null;

function suggestionsFor(query) {
    const q = Core.normalizeKey(query);
    if (q.length < 2) return [];
    const matches = [];
    const seenStyles = new Set();
    const styleSource = browseMode === 'studios'
        ? optionsFor('style')
        : optionsFor('style').concat(TOP_STYLES.map(s => ({ value: Core.styleGroupKey(s.label), label: s.label })));
    styleSource.forEach(o => {
        if (seenStyles.has(o.value) || !optionsFor('style').some(x => x.value === o.value)) return;
        if (Core.normalizeKey(o.label).includes(q)) {
            seenStyles.add(o.value);
            const real = optionsFor('style').find(x => x.value === o.value);
            matches.push({ type: 'style', value: o.value, label: real ? real.label : o.label, category: 'Estilo' });
        }
    });
    optionsFor('location').forEach(o => {
        if (Core.normalizeKey(o.label).includes(q)) matches.push({ type: 'city', value: o.value, label: o.label, category: 'Ubicación' });
    });
    if (browseMode === 'studios') {
        (allStudios || []).filter(s => Core.normalizeKey(s.name).includes(q)).slice(0, 5)
            .forEach(s => matches.push({ type: 'studio', value: s.slug || s.id, label: s.name || 'Estudio', category: 'Estudio' }));
    } else {
        allArtists.filter(a => Core.normalizeKey(a.name || a.username).includes(q)).slice(0, 5)
            .forEach(a => matches.push({ type: 'artist', value: a.username || '', label: Core.titleCase(a.name || a.username || ''), category: 'Artista' }));
    }
    return matches.slice(0, 12);
}

function renderSuggestions(query) {
    const box = document.getElementById('search-suggestions');
    const input = document.getElementById('smart-search');
    if (!box) return;
    const matches = suggestionsFor(query);
    if (!matches.length) {
        box.classList.add('hidden');
        box.innerHTML = '';
        input?.setAttribute('aria-expanded', 'false');
        return;
    }
    box.innerHTML = matches.map(m => `
        <button type="button" class="mk-suggestion" data-sug-type="${escapeHtml(m.type)}" data-sug-value="${escapeHtml(m.value)}">
            <span class="mk-suggestion-label">${escapeHtml(m.label)}</span>
            <span class="mk-suggestion-cat">${escapeHtml(m.category)}</span>
        </button>
    `).join('');
    box.classList.remove('hidden');
    input?.setAttribute('aria-expanded', 'true');
}

function hideSuggestions() {
    document.getElementById('search-suggestions')?.classList.add('hidden');
    document.getElementById('smart-search')?.setAttribute('aria-expanded', 'false');
}

// La búsqueda se aplica mientras se escribe (debounce) y vaciar el campo
// limpia el filtro (MK-13). Enter aplica al instante.
function setupSearch() {
    const input = document.getElementById('smart-search');
    if (!input || input.dataset.woBound) return;
    input.dataset.woBound = '1';

    const commit = () => {
        const value = input.value.trim();
        if (currentFilters().search === value) return;
        currentFilters().search = value;
        resetPaging();
        applyFilters();
    };

    input.addEventListener('input', () => {
        renderSuggestions(input.value.trim());
        clearTimeout(searchTimer);
        searchTimer = setTimeout(commit, SEARCH_DEBOUNCE_MS);
    });
    input.addEventListener('search', () => { clearTimeout(searchTimer); commit(); });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(searchTimer);
            hideSuggestions();
            commit();
        } else if (e.key === 'Escape') {
            hideSuggestions();
        } else if (e.key === 'ArrowDown') {
            const first = document.querySelector('#search-suggestions:not(.hidden) .mk-suggestion');
            if (first) { e.preventDefault(); first.focus(); }
        }
    });
}

function selectSuggestion(type, value) {
    const input = document.getElementById('smart-search');
    if (type === 'artist') { selectArtist(value); return; }
    if (type === 'studio') { selectStudio(value); return; }
    const filters = currentFilters();
    if (type === 'style') filters.style = value;
    if (type === 'city') filters.location = value;
    if (input) input.value = '';
    filters.search = '';
    hideSuggestions();
    resetPaging();
    applyFilters();
}

// ============================================
// EVENTOS (delegación; sin onclick inline)
// ============================================
function bindStaticUi() {
    bindMobileMenu();

    document.addEventListener('click', (e) => {
        const logout = e.target.closest('[data-mk-logout]');
        if (logout) { handleMarketplaceLogout(); return; }

        if (e.target.closest('[data-fav-only]')) { toggleFavoritesOnly(); return; }
        if (e.target.closest('[data-featured-link]')) { scrollFeaturedIntoView(); return; }

        const modeLink = e.target.closest('[data-mk-mode]');
        if (modeLink) {
            e.preventDefault();
            setBrowseMode(modeLink.dataset.mkMode);
            document.getElementById('smart-search')?.focus();
            return;
        }

        const toggle = e.target.closest('[data-filter-toggle]');
        if (toggle) { toggleFilterMenu(toggle.dataset.filterToggle); return; }

        if (e.target.closest('[data-filter-close]')) { closeAllFilterMenus({ restoreFocus: true }); return; }

        const opt = e.target.closest('.mk-filter-opt[data-filter-key]');
        if (opt) { selectFilterOption(opt.dataset.filterKey, opt.dataset.filterValue || ''); return; }

        if (e.target.closest('[data-verified-toggle]')) { toggleVerifiedOnly(); return; }
        if (e.target.closest('[data-allfilters-toggle]')) { toggleAllFilters(); return; }

        const remove = e.target.closest('[data-remove-filter]');
        if (remove) { removeFilter(remove.dataset.removeFilter); return; }

        const fav = e.target.closest('.mk-card-fav');
        if (fav) { e.preventDefault(); toggleFavorite(fav.dataset.favArtist); return; }

        const sug = e.target.closest('.mk-suggestion[data-sug-type]');
        if (sug) { selectSuggestion(sug.dataset.sugType, sug.dataset.sugValue); return; }

        if (e.target.id === 'mk-filter-scrim') { closeAllFilterMenus({ restoreFocus: true }); return; }

        if (!e.target.closest('.mk-filter')) closeAllFilterMenus();
        if (!e.target.closest('.mk-search')) hideSuggestions();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (openMenuKey) { closeAllFilterMenus({ restoreFocus: true }); return; }
        const drawer = document.getElementById('mk-filter-drawer');
        if (drawer && !drawer.hidden && drawer.contains(document.activeElement)) {
            toggleAllFilters(false);
            document.getElementById('mk-allfilters-btn')?.focus();
        }
    });

    // Flechas dentro de las sugerencias y de un menú de filtro.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const container = e.target.closest('#search-suggestions, .mk-filter-menu');
        if (!container) return;
        const items = [...container.querySelectorAll('.mk-suggestion, .mk-filter-opt')];
        const idx = items.indexOf(e.target);
        if (idx === -1) return;
        e.preventDefault();
        const next = items[idx + (e.key === 'ArrowDown' ? 1 : -1)];
        if (next) next.focus();
        else if (e.key === 'ArrowUp' && container.id === 'search-suggestions') document.getElementById('smart-search')?.focus();
    });

    document.getElementById('mk-filter-drawer')?.addEventListener('change', (e) => {
        const select = e.target.closest('select[data-drawer-key]');
        if (!select) return;
        currentFilters()[select.dataset.drawerKey] = select.value || null;
        resetPaging();
        applyFilters();
    });

    document.getElementById('mk-load-more')?.addEventListener('click', loadMore);

    // Al pasar de móvil a escritorio el bottom sheet vuelve a ser dropdown.
    window.addEventListener('resize', () => {
        if (!openMenuKey || isMobileViewport()) return;
        document.body.classList.remove('mk-sheet-open');
        const scrim = document.getElementById('mk-filter-scrim');
        if (scrim) scrim.hidden = true;
    });
}

function removeFilter(type) {
    if (type === 'favorites') {
        if (favoritesOnly) toggleFavoritesOnly();
        return;
    }
    const filters = currentFilters();
    if (type === 'search') {
        filters.search = '';
        const input = document.getElementById('smart-search');
        if (input) input.value = '';
    } else if (type === 'verified') {
        filters.verified = false;
    } else {
        filters[type] = null;
    }
    resetPaging();
    applyFilters();
}

function clearAllFilters() {
    if (favoritesOnly) {
        favoritesOnly = false;
        const favBtn = document.getElementById('mk-fav-toggle');
        if (favBtn) {
            favBtn.classList.remove('is-active');
            favBtn.setAttribute('aria-pressed', 'false');
        }
    }
    filtersByMode[browseMode] = emptyFilters(browseMode);
    const searchInput = document.getElementById('smart-search');
    if (searchInput) searchInput.value = '';
    resetPaging();
    applyFilters();
}

function selectArtist(username) {
    window.location.href = `/artist/profile?artist=${encodeURIComponent(username || '')}`;
}

function selectStudio(ref) {
    window.location.href = `/studio/profile?studio=${encodeURIComponent(ref || '')}`;
}

function viewArtistProfile(username) {
    selectArtist(username);
}

// ============ EXPORT GLOBALS ============
window.toggleFilterMenu = toggleFilterMenu;
window.toggleAllFilters = toggleAllFilters;
window.toggleFavoritesOnly = toggleFavoritesOnly;
window.toggleFavorite = toggleFavorite;
window.scrollFeaturedIntoView = scrollFeaturedIntoView;
window.selectFilterOption = selectFilterOption;
window.setBrowseMode = setBrowseMode;
window.removeFilter = removeFilter;
window.clearAllFilters = clearAllFilters;
window.selectSuggestion = selectSuggestion;
window.selectArtist = selectArtist;
window.selectStudio = selectStudio;
window.viewArtistProfile = viewArtistProfile;
window.handleMarketplaceLogout = handleMarketplaceLogout;
