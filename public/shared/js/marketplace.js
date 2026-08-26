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

function parsePrice(priceStr) {
    if (!priceStr) return 0;
    const match = priceStr.match(/\d+/);
    return match ? parseInt(match[0]) : 0;
}

function toTitleCase(str) {
    if (!str || typeof str !== 'string') return '';
    return str.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

function getInitials(name) {
    if (!name || typeof name !== 'string') return 'Ö';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'Ö';
    const first = parts[0].charAt(0);
    const second = parts.length > 1 ? parts[parts.length - 1].charAt(0) : (parts[0].charAt(1) || '');
    return (first + second).toUpperCase();
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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
// WE ÖTZI - MARKETPLACE LOGIC
// Referencia: Figma "flujo-clientes/06-marketplace".
// ============================================

let allArtists = [];
let filteredArtists = [];
let allStudios = [];
let filteredStudios = [];
let browseMode = 'artists'; // 'artists' | 'studios'

// Estado de agenda por artista, derivado de artist_tattoo_locations
// (period_type + agenda_status + rango de fechas). Es la única señal real de
// disponibilidad del modelo de datos: no hay campo de "fully booked" propio.
let artistAgenda = {};   // user_id -> { available, booked, guestNow, travelling }
let artistRatings = {};  // user_id -> { average_rating, review_count }

// Favoritos (client_favorites via WeotziData.Favorites). Decisión v1: sin
// sesión los corazones persisten en localStorage y se migran a la tabla al
// loguear (merge silencioso en loadFavorites) — no se fuerza el login.
let favoriteIds = new Set();   // artist user_ids marcados
let favoritesOnly = false;     // atajo corazón del hero: filtra solo favoritos
let sessionUserId = null;      // uid del cliente logueado (null = anónimo)
const FAV_STORAGE_KEY = 'weotzi_mk_favorites';
// Señales de búsqueda para "Artistas para vos" (client-side, sin backend).
const SIGNALS_STORAGE_KEY = 'weotzi_mk_signals';
let featuredIds = [];          // user_ids mostrados en "Artistas destacados"

let currentFilters = {
    search: '',
    style: null,
    city: null,
    country: null,
    location: null,
    priceRange: null,
    availability: null,
    travel: null,
    studio: null
};

// Estilos destacados (catálogo compartido). Sin íconos: el DS usa chips tipográficos.
// Nota: el formato `label: '...'` es literal a propósito — lo verifica
// tests/tattoo-styles-catalog.test.js contra lib/expanded-tattoo-styles.
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

const PRICE_OPTIONS = [
    { value: 'low', label: 'Económico · menos de 200 USD' },
    { value: 'medium', label: 'Medio · 200 – 800 USD' },
    { value: 'high', label: 'Premium · más de 800 USD' }
];

const FILTER_TITLES = {
    style: 'Estilo',
    location: 'Ubicación',
    priceRange: 'Precio',
    availability: 'Disponibilidad',
    travel: 'Viajes',
    studio: 'Estudio'
};

// ============ INIT ============
document.addEventListener('DOMContentLoaded', async () => {
    showLoading();
    try {
        await waitForConfigManager();
        await applySessionTopbar();
        await loadFavorites();

        allArtists = await fetchArtists() || [];
        console.log('✅ Marketplace loaded with', allArtists.length, 'artists');

        if (allArtists.length > 0) {
            await Promise.all([loadArtistAgenda(), loadArtistRatings()]);
            initFilterMenus();
            applyFilters();
            setupSearch();
        } else {
            console.warn('No artists found to display');
            renderArtists([]); // Show empty state
        }
    } catch (err) {
        console.error('Error initializing marketplace:', err);
        renderArtists([]); // Show empty state on error
    } finally {
        hideLoading();
    }
});

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
        const right = document.getElementById('mk-topbar-right');
        if (!nav || !right) return;

        nav.innerHTML = `
            <a class="wo-topbar-item" href="/client/dashboard">Cotizaciones</a>
            <a class="wo-topbar-item" href="/job-board">Job board</a>
            <a class="wo-topbar-item is-active" href="/marketplace" aria-current="page">Explorar artistas</a>
            <a class="wo-topbar-item" href="/explore">Tattoo globe</a>
        `;

        const meta = session.user.user_metadata || {};
        const initials = getInitials(meta.full_name || meta.name || session.user.email || '');
        right.innerHTML = `
            <a class="mk-profile-tile" href="/client/dashboard" title="Centro de cuenta" aria-label="Ir al centro de cuenta">${escapeHtml(initials)}</a>
            <button class="wo-btn wo-btn--danger wo-btn--s wo-btn--mono" type="button" onclick="handleMarketplaceLogout()">Log out</button>
        `;
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

async function fetchArtists() {
    const supabaseClient = window.ConfigManager && window.ConfigManager.getSupabaseClient();
    if (supabaseClient && !window.ConfigManager.isDemoMode()) {
        try {
            // Public path — anon can read finalized rows via the marketplace
            // RLS policy. Use the shared public column list so we don't leak
            // password (see config-manager.js ARTIST_PUBLIC_COLUMNS).
            const { data, error } = await WeotziData.Artists.listPublic(window.ARTIST_PUBLIC_COLUMNS || '*');
            if (error) throw error;

            return (data || []).map(a => ({
                ...a,
                is_recommended: a.is_recommended || false,
                languages: a.languages || ['Español'],
                country: a.country || (a.ubicacion ? a.ubicacion.split(', ').pop() : 'Desconocido'),
                years_experience: a.years_experience || '5'
            }));
        } catch (err) {
            console.error('Supabase fetch error, falling back:', err);
            return fallbackFetch();
        }
    } else {
        return fallbackFetch();
    }
}

async function fallbackFetch() {
    try {
        const response = await fetch('artists_db_rows.json');
        if (!response.ok) throw new Error('Local JSON not found');
        const data = await response.json();
        return data.map(a => ({
            ...a,
            is_recommended: a.username === 'yomicoart.wo',
            languages: ['Español'],
            country: a.ubicacion ? a.ubicacion.split(', ').pop() : 'México',
            years_experience: '10'
        }));
    } catch (e) {
        console.warn('Fallback to demo artists');
        return window.ConfigManager.getDemoArtists().map(a => ({
            user_id: a.userId,
            name: a.name,
            username: a.username,
            email: a.email,
            instagram: a.instagram,
            styles_array: a.styles,
            ubicacion: a.location,
            estudios: a.studio,
            session_price: a.sessionPrice,
            city: a.location.split(',')[0].trim(),
            country: a.location.split(',')[1]?.trim() || 'Desconocido',
            profile_picture: null,
            is_recommended: false,
            languages: ['Español'],
            years_experience: '5'
        }));
    }
}

// ============ SEÑALES REALES DE ESTADO ============

// artist_tattoo_locations es pública (policy "Public can view tattoo locations").
// period_type='current' + agenda_status da disponible/agenda cerrada;
// period_type='upcoming' con rango en curso da guest, y con inicio futuro, viaje.
async function loadArtistAgenda() {
    artistAgenda = {};
    try {
        const today = new Date().toISOString().slice(0, 10);
        const { data, error } = await WeotziData
            .from('artist_tattoo_locations')
            .select('artist_user_id, period_type, agenda_status, start_date, end_date');
        if (error) throw error;

        (data || []).forEach(row => {
            const entry = artistAgenda[row.artist_user_id] ||
                (artistAgenda[row.artist_user_id] = { available: false, booked: false, guestNow: false, travelling: false });

            if (row.period_type === 'current') {
                if (row.agenda_status === 'closed') entry.booked = true;
                else entry.available = true;
                return;
            }
            if (row.period_type === 'upcoming') {
                if (row.start_date && row.start_date > today) entry.travelling = true;
                else if (row.start_date && row.end_date && row.start_date <= today && row.end_date >= today) entry.guestNow = true;
            }
        });
    } catch (err) {
        console.error('Error loading artist agenda:', err);
    }
}

// public_review_summary agrega verified_reviews aprobadas (vista pública).
async function loadArtistRatings() {
    artistRatings = {};
    try {
        const { data, error } = await WeotziData
            .from('public_review_summary')
            .select('reviewee_user_id, average_rating, review_count')
            .eq('reviewee_type', 'artist');
        if (error) throw error;
        (data || []).forEach(row => { artistRatings[row.reviewee_user_id] = row; });
    } catch (err) {
        console.error('Error loading artist ratings:', err);
    }
}

// ============ FAVORITOS ============
// Logueado: client_favorites via WeotziData.Favorites (RLS owner). Anónimo:
// localStorage; al volver con sesión, loadFavorites migra lo local a la tabla
// y limpia la copia local (merge silencioso, sin CTA de login).
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
        // Merge de favoritos anónimos guardados antes de loguear.
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

    // Con el filtro de favoritos activo, quitar un corazón saca la card.
    if (favoritesOnly) applyFilters();
}

// Sincroniza todos los corazones de un artista (grid + destacados + para vos).
function syncHeartButtons(artistUserId) {
    const isFav = favoriteIds.has(artistUserId);
    document.querySelectorAll(`.mk-card-fav[data-fav-artist="${CSS.escape(artistUserId)}"]`).forEach(btn => {
        btn.classList.toggle('is-fav', isFav);
        btn.setAttribute('aria-pressed', String(isFav));
        btn.setAttribute('aria-label', isFav ? 'Quitar de favoritos' : 'Guardar en favoritos');
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
    applyFilters();
}

// Estado único de la card. Precedencia: guest activo > agenda cerrada >
// viaje próximo > disponible. Sin datos de agenda no se dibuja chip.
// Labels en español (criterio del manifiesto), alineados con
// AVAILABILITY_OPTIONS / TRAVEL_OPTIONS.
function getArtistStatus(artist) {
    const entry = artistAgenda[artist.user_id];
    if (!entry) return null;
    if (entry.guestNow) return { key: 'guest', label: 'Artista invitado' };
    if (entry.booked && !entry.available) return { key: 'booked', label: 'Agenda cerrada' };
    if (entry.travelling) return { key: 'travelling', label: 'De viaje pronto' };
    if (entry.available) return { key: 'available', label: 'Disponible' };
    return null;
}

// ============ ESTUDIOS (toggle ARTISTAS / ESTUDIOS) ============
async function fetchStudios() {
    if (allStudios.length) return allStudios;
    try {
        const { data, error } = await WeotziData
            .from('studios')
            .select('id, slug, name, tagline, cover_image, logo_image, is_verified')
            .eq('is_active', true)
            .order('name', { ascending: true });
        if (error) throw error;

        const studios = data || [];
        const ids = studios.map(s => s.id).filter(Boolean);
        const byStudio = {};
        if (ids.length) {
            const { data: locations } = await WeotziData.StudioLocations.listPrimaryByStudioIds(ids);
            (locations || []).forEach(l => { byStudio[l.studio_id] = l; });
        }

        allStudios = studios.map(s => {
            const loc = byStudio[s.id] || {};
            return { ...s, city: loc.city || '', country: loc.country || '' };
        });
        return allStudios;
    } catch (err) {
        console.error('Error loading studios:', err);
        allStudios = [];
        return allStudios;
    }
}

async function setBrowseMode(mode) {
    if (browseMode === mode) return;
    browseMode = mode;

    document.getElementById('mode-artists')?.classList.toggle('is-active', mode === 'artists');
    document.getElementById('mode-studios')?.classList.toggle('is-active', mode === 'studios');

    const filtersRow = document.getElementById('mk-filters');
    // Los 6 filtros describen atributos de artista: no aplican al listado de
    // estudios. Idem los atajos del hero (favoritos + drawer de filtros).
    if (filtersRow) filtersRow.hidden = mode === 'studios';
    const heroActions = document.getElementById('mk-hero-actions');
    if (heroActions) heroActions.hidden = mode === 'studios';
    if (mode === 'studios') {
        const drawer = document.getElementById('mk-filter-drawer');
        if (drawer && !drawer.hidden) toggleAllFilters();
    }

    if (mode === 'studios') {
        showLoading();
        try {
            await fetchStudios();
        } finally {
            hideLoading();
        }
    }
    applyFilters();
}

// ============ MENÚS DE FILTRO ============
function normalizeKey(value) {
    return String(value || '').trim().toLowerCase();
}

function artistCity(artist) {
    return toTitleCase((artist.city || artist.ubicacion || '').split(',')[0].trim());
}

function countBy(list, getKey) {
    const counts = new Map();
    list.forEach(item => {
        const keys = getKey(item);
        (Array.isArray(keys) ? keys : [keys]).filter(Boolean).forEach(k => {
            counts.set(k, (counts.get(k) || 0) + 1);
        });
    });
    return counts;
}

function initFilterMenus() {
    // ESTILO — catálogo compartido acotado a los estilos con artistas reales.
    const styleCounts = countBy(allArtists, a => parseStyles(a.styles_array).map(s => s.trim()));
    const styleOptions = TOP_STYLES
        .map(s => {
            let count = 0;
            styleCounts.forEach((n, key) => { if (normalizeKey(key) === normalizeKey(s.label)) count += n; });
            return { value: s.label, label: s.label, count };
        })
        .filter(o => o.count > 0)
        .sort((a, b) => b.count - a.count);

    // UBICACIÓN — ciudades reales de los perfiles.
    const cityCounts = countBy(allArtists, a => artistCity(a));
    const locationOptions = [...cityCounts.entries()]
        .map(([value, count]) => ({ value, label: value, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    // ESTUDIO — nombre de estudio declarado en el perfil.
    const studioCounts = countBy(allArtists, a => (a.estudios || '').trim());
    const studioOptions = [...studioCounts.entries()]
        .map(([value, count]) => ({ value, label: value, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    const agendaCounts = { available: 0, booked: 0, guest: 0, travelling: 0 };
    allArtists.forEach(a => {
        const status = getArtistStatus(a);
        if (!status) return;
        if (status.key === 'guest') agendaCounts.guest++;
        if (status.key === 'booked') agendaCounts.booked++;
        if (status.key === 'travelling') agendaCounts.travelling++;
        if (status.key === 'available') agendaCounts.available++;
    });

    renderFilterMenu('style', styleOptions);
    renderFilterMenu('location', locationOptions);
    renderFilterMenu('priceRange', PRICE_OPTIONS.map(o => ({ ...o, count: null })));
    renderFilterMenu('availability', AVAILABILITY_OPTIONS.map(o => ({ ...o, count: agendaCounts[o.value] })));
    renderFilterMenu('travel', TRAVEL_OPTIONS.map(o => ({ ...o, count: agendaCounts[o.value] })));
    renderFilterMenu('studio', studioOptions);

    // Drawer "Todos los filtros": mismas opciones, en selects del DS.
    populateDrawerSelect('style', styleOptions);
    populateDrawerSelect('location', locationOptions);
    populateDrawerSelect('priceRange', PRICE_OPTIONS);
    populateDrawerSelect('availability', AVAILABILITY_OPTIONS);
    populateDrawerSelect('travel', TRAVEL_OPTIONS);
    populateDrawerSelect('studio', studioOptions);
    bindFilterDrawer();

    const filtersRow = document.getElementById('mk-filters');
    if (filtersRow && !filtersRow.dataset.woBound) {
        filtersRow.dataset.woBound = '1';
        filtersRow.addEventListener('click', (e) => {
            const opt = e.target.closest('.mk-filter-opt[data-filter-key]');
            if (!opt || opt.disabled) return;
            selectFilterOption(opt.dataset.filterKey, opt.dataset.filterValue || '');
        });
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.mk-filter')) closeAllFilterMenus();
    });
}

function renderFilterMenu(key, options) {
    const menu = document.getElementById(`mk-filter-menu-${key}`);
    if (!menu) return;

    if (!options.length) {
        menu.innerHTML = '<button type="button" class="mk-filter-opt" disabled>Sin opciones disponibles</button>';
        return;
    }

    // Los valores viajan por data-* (no interpolados en onclick): así no rompen
    // con apóstrofes ni comillas en nombres de ciudad o estudio.
    const rows = options.map(o => `
        <button type="button" class="mk-filter-opt${currentFilters[key] === o.value ? ' is-selected' : ''}"
                role="option" aria-selected="${currentFilters[key] === o.value}"
                data-filter-key="${escapeHtml(key)}" data-filter-value="${escapeHtml(o.value)}">
            <span>${escapeHtml(o.label)}</span>
            ${o.count == null ? '' : `<span class="mk-filter-opt-count">${o.count}</span>`}
        </button>
    `).join('');

    const clearRow = currentFilters[key]
        ? `<button type="button" class="mk-filter-opt" data-filter-key="${escapeHtml(key)}" data-filter-value=""><span>Quitar filtro</span></button>`
        : '';

    menu.innerHTML = clearRow + rows;
}

// ============ DRAWER "TODOS LOS FILTROS" (Figma 286:12041 + 286:11985) ============
// Mismo patrón que el drawer de /explore: toggle + panel con los filtros
// expandidos. Lo abren tanto el chip de la fila como el botón Filtros del hero.
function populateDrawerSelect(key, options) {
    const select = document.querySelector(`select[data-drawer-key="${key}"]`);
    if (!select) return;
    const placeholder = select.querySelector('option[value=""]');
    select.innerHTML = '';
    if (placeholder) select.appendChild(placeholder);
    options.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.count == null ? o.label : `${o.label} (${o.count})`;
        select.appendChild(opt);
    });
    select.value = currentFilters[key] || '';
}

function bindFilterDrawer() {
    const drawer = document.getElementById('mk-filter-drawer');
    if (!drawer || drawer.dataset.woBound) return;
    drawer.dataset.woBound = '1';
    drawer.addEventListener('change', (e) => {
        const select = e.target.closest('select[data-drawer-key]');
        if (!select) return;
        selectFilterOption(select.dataset.drawerKey, select.value);
    });
}

function toggleAllFilters() {
    const drawer = document.getElementById('mk-filter-drawer');
    if (!drawer) return;
    const open = drawer.hidden;
    drawer.hidden = !open;
    ['mk-filters-open', 'mk-allfilters-btn'].forEach(id => {
        document.getElementById(id)?.setAttribute('aria-expanded', String(open));
    });
    if (open) closeAllFilterMenus();
}

function syncDrawerSelects() {
    document.querySelectorAll('select[data-drawer-key]').forEach(select => {
        select.value = currentFilters[select.dataset.drawerKey] || '';
    });
}

function closeAllFilterMenus() {
    document.querySelectorAll('.mk-filter-menu').forEach(m => { m.hidden = true; });
    document.querySelectorAll('.mk-filter-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

function toggleFilterMenu(key) {
    const menu = document.getElementById(`mk-filter-menu-${key}`);
    if (!menu) return;
    const wasOpen = !menu.hidden;
    closeAllFilterMenus();
    if (wasOpen) return;
    menu.hidden = false;
    menu.parentElement.querySelector('.mk-filter-btn')?.setAttribute('aria-expanded', 'true');
}

function selectFilterOption(key, value) {
    currentFilters[key] = value || null;
    if (key === 'location') currentFilters.city = value || null;
    closeAllFilterMenus();
    applyFilters();
}

function syncFilterButtons() {
    syncDrawerSelects();
    Object.keys(FILTER_TITLES).forEach(key => {
        const wrap = document.querySelector(`.mk-filter[data-filter-key="${key}"]`);
        const label = document.getElementById(`mk-filter-label-${key}`);
        if (!wrap || !label) return;

        const value = currentFilters[key];
        wrap.classList.toggle('is-set', !!value);

        if (!value) {
            label.textContent = FILTER_TITLES[key];
            return;
        }
        if (key === 'priceRange') {
            const opt = PRICE_OPTIONS.find(o => o.value === value);
            label.textContent = `${FILTER_TITLES[key]} · ${opt ? opt.label.split(' · ')[0] : value}`;
            return;
        }
        if (key === 'availability') {
            const opt = AVAILABILITY_OPTIONS.find(o => o.value === value);
            label.textContent = `${FILTER_TITLES[key]} · ${opt ? opt.label : value}`;
            return;
        }
        if (key === 'travel') {
            const opt = TRAVEL_OPTIONS.find(o => o.value === value);
            label.textContent = `${FILTER_TITLES[key]} · ${opt ? opt.label : value}`;
            return;
        }
        label.textContent = `${FILTER_TITLES[key]} · ${value}`;
    });
}

// ============ UI RENDERING ============

// Delegación de click de las cards (el destino viaja en data-card-href).
// El corazón intercepta antes de navegar. Se aplica a los tres grids
// (principal, destacados y para vos).
function bindCardsContainer(id) {
    const grid = document.getElementById(id);
    if (!grid || grid.dataset.woBound) return;
    grid.dataset.woBound = '1';
    grid.addEventListener('click', (e) => {
        const fav = e.target.closest('.mk-card-fav');
        if (fav) {
            e.stopPropagation();
            toggleFavorite(fav.dataset.favArtist);
            return;
        }
        const card = e.target.closest('.mk-card[data-card-href]');
        if (!card) return;
        window.location.href = card.dataset.cardHref;
    });
}

function bindGridNavigation() {
    bindCardsContainer('marketplace-grid');
    bindCardsContainer('mk-featured-grid');
    bindCardsContainer('mk-foryou-grid');
}

// Card de artista compartida por el grid, "Artistas destacados" y
// "Artistas para vos". opts.sponsored agrega el badge "Patrocinado".
function artistCardHtml(artist, opts = {}) {
    const styles = parseStyles(artist.styles_array);
    const profilePic = artist.profile_picture;
    const city = artistCity(artist);
    const mainStyle = styles.length > 0 ? styles[0] : '';
    const metaLine = [city, mainStyle].filter(Boolean).join(' · ');
    const status = getArtistStatus(artist);
    const summary = artistRatings[artist.user_id];
    const name = escapeHtml(toTitleCase(artist.name));
    const userId = escapeHtml(artist.user_id || '');
    const isFav = favoriteIds.has(artist.user_id);

    return `
        <article class="wo-card wo-card--media wo-card--hover mk-card" data-card-href="${escapeHtml(`/artist/profile?artist=${encodeURIComponent(artist.username || '')}`)}">
            <div class="mk-card-media">
                <i data-wo-icon="image" class="mk-media-ph" aria-hidden="true"></i>
                ${profilePic ? `<img src="${escapeHtml(profilePic)}" alt="${name}" loading="lazy" onerror="this.remove();">` : ''}
                <span class="mk-card-topfade" aria-hidden="true"></span>
                <div class="mk-card-top">
                    ${opts.sponsored ? `<span class="mk-card-sponsored"><i data-wo-icon="award" aria-hidden="true"></i>Patrocinado</span>` : ''}
                    ${status ? `<span class="mk-card-status mk-card-status--${status.key}">${escapeHtml(status.label)}</span>` : ''}
                </div>
                ${userId ? `
                <button type="button" class="mk-card-fav${isFav ? ' is-fav' : ''}" data-fav-artist="${userId}"
                        aria-pressed="${isFav}" aria-label="${isFav ? 'Quitar de favoritos' : 'Guardar en favoritos'}">
                    <i data-wo-icon="heart" aria-hidden="true"></i>
                </button>` : ''}
                <div class="mk-card-overlay">
                    <span class="mk-card-avatar" aria-hidden="true">${getInitials(artist.name)}</span>
                    <div class="mk-card-id">
                        <h3 class="mk-card-name">${name}</h3>
                    </div>
                </div>
                <div class="mk-card-metarow">
                    <p class="mk-card-meta">${escapeHtml(metaLine)}</p>
                    ${summary && summary.average_rating
                        ? `<span class="mk-card-rating"><i data-wo-icon="star"></i>${Number(summary.average_rating).toFixed(1)}</span>`
                        : ''}
                </div>
            </div>
        </article>
    `;
}

function renderArtists(artists) {
    const grid = document.getElementById('marketplace-grid');
    const countEl = document.getElementById('results-count');
    const emptyState = document.getElementById('empty-state');

    if (!grid) return;

    if (artists.length === 0) {
        grid.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        if (countEl) countEl.textContent = '0 artistas encontrados';
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');
    if (countEl) countEl.textContent = `${artists.length} artistas encontrados`;
    bindGridNavigation();

    grid.innerHTML = artists.map(artist => artistCardHtml(artist)).join('');
}

// ¿Hay algún filtro, búsqueda o atajo de favoritos activo?
function hasActiveFilters() {
    return !!(currentFilters.search || currentFilters.style || currentFilters.location ||
        currentFilters.city || currentFilters.country || currentFilters.priceRange ||
        currentFilters.availability || currentFilters.travel || currentFilters.studio ||
        favoritesOnly);
}

// ============ ARTISTAS DESTACADOS (Figma 286:12580) ============
// v1 sin campo de curaduría en artists_db: top 4 por rating real de
// public_review_summary (ya cargado en artistRatings). Solo visible en modo
// artistas y sin filtros/búsqueda activos, como en el mock.
function renderFeatured() {
    const section = document.getElementById('mk-featured');
    const grid = document.getElementById('mk-featured-grid');
    featuredIds = [];
    if (!section || !grid) return;

    if (browseMode !== 'artists' || hasActiveFilters()) {
        section.classList.add('hidden');
        return;
    }

    const top = allArtists
        .filter(a => artistRatings[a.user_id] && artistRatings[a.user_id].average_rating)
        .sort((a, b) => {
            const ra = artistRatings[a.user_id], rb = artistRatings[b.user_id];
            return (rb.average_rating - ra.average_rating) || ((rb.review_count || 0) - (ra.review_count || 0));
        })
        .slice(0, 4);

    if (!top.length) {
        section.classList.add('hidden');
        return;
    }

    featuredIds = top.map(a => a.user_id);
    grid.innerHTML = top.map(artist => artistCardHtml(artist, { sponsored: true })).join('');
    section.classList.remove('hidden');
    bindGridNavigation();
}

function scrollFeaturedIntoView() {
    document.getElementById('mk-featured-grid')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ============ ARTISTAS PARA VOS (Figma 286:12794) ============
// Personalización client-side: rankea por coincidencia con los estilos y
// ciudades buscados/filtrados recientemente (localStorage). Sin señal, la
// sección no se muestra. Solo en modo artistas sin filtros activos.
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
    const style = currentFilters.style;
    const city = currentFilters.city || currentFilters.location;
    if (!style && !city) return;
    try {
        const signals = readSearchSignals();
        const push = (list, value) => {
            const key = normalizeKey(value);
            const next = [value, ...list.filter(v => normalizeKey(v) !== key)];
            return next.slice(0, 8); // últimas 8 señales por tipo
        };
        if (style) signals.styles = push(signals.styles, style);
        if (city) signals.cities = push(signals.cities, city);
        localStorage.setItem(SIGNALS_STORAGE_KEY, JSON.stringify(signals));
    } catch (e) { /* sin storage no hay personalización, nada que romper */ }
}

function renderForYou() {
    const section = document.getElementById('mk-foryou');
    const grid = document.getElementById('mk-foryou-grid');
    if (!section || !grid) return;

    if (browseMode !== 'artists' || hasActiveFilters()) {
        section.classList.add('hidden');
        return;
    }

    const signals = readSearchSignals();
    if (!signals.styles.length && !signals.cities.length) {
        section.classList.add('hidden');
        return;
    }

    const styleKeys = signals.styles.map(normalizeKey);
    const cityKeys = signals.cities.map(normalizeKey);
    const scored = allArtists
        .filter(a => !featuredIds.includes(a.user_id))
        .map(artist => {
            const artistStyles = parseStyles(artist.styles_array).map(normalizeKey);
            const city = normalizeKey(artistCity(artist));
            let score = 0;
            styleKeys.forEach((key, idx) => {
                if (artistStyles.some(s => s.includes(key) || key.includes(s))) {
                    score += 2 + (styleKeys.length - idx) * 0.1; // más peso a lo reciente
                }
            });
            cityKeys.forEach((key, idx) => {
                if (city && (city.includes(key) || key.includes(city))) {
                    score += 2 + (cityKeys.length - idx) * 0.1;
                }
            });
            return { artist, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);

    if (!scored.length) {
        section.classList.add('hidden');
        return;
    }

    grid.innerHTML = scored.map(item => artistCardHtml(item.artist)).join('');
    section.classList.remove('hidden');
    bindGridNavigation();
}

function renderStudios(studios) {
    const grid = document.getElementById('marketplace-grid');
    const countEl = document.getElementById('results-count');
    const emptyState = document.getElementById('empty-state');

    if (!grid) return;

    if (studios.length === 0) {
        grid.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        if (countEl) countEl.textContent = '0 estudios encontrados';
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');
    if (countEl) countEl.textContent = `${studios.length} estudios encontrados`;
    bindGridNavigation();

    grid.innerHTML = studios.map(studio => {
        const cover = studio.cover_image || studio.logo_image;
        const metaLine = [studio.city, studio.country].filter(Boolean).join(' · ');
        const name = escapeHtml(studio.name || 'Estudio');
        const ref = studio.slug || studio.id;

        return `
            <article class="wo-card wo-card--media wo-card--hover mk-card" data-card-href="${escapeHtml(`/studio/profile?studio=${encodeURIComponent(ref || '')}`)}">
                <div class="mk-card-media">
                    <i data-wo-icon="image" class="mk-media-ph" aria-hidden="true"></i>
                    ${cover ? `<img src="${escapeHtml(cover)}" alt="${name}" loading="lazy" onerror="this.remove();">` : ''}
                    <span class="mk-card-topfade" aria-hidden="true"></span>
                    <div class="mk-card-overlay">
                        <span class="mk-card-avatar" aria-hidden="true">${getInitials(studio.name)}</span>
                        <div class="mk-card-id">
                            <h3 class="mk-card-name">${name}</h3>
                        </div>
                    </div>
                    <div class="mk-card-metarow">
                        <p class="mk-card-meta">${escapeHtml(metaLine || studio.tagline || '')}</p>
                    </div>
                </div>
            </article>
        `;
    }).join('');
}

function updateActiveFiltersUI() {
    const container = document.getElementById('active-filters-section');
    const list = document.getElementById('active-filters-list');
    syncFilterButtons();
    if (!container || !list) return;

    const activeFilters = [];
    if (favoritesOnly && browseMode === 'artists') activeFilters.push({ type: 'favorites', label: 'Solo favoritos' });
    if (currentFilters.search) activeFilters.push({ type: 'search', label: `"${currentFilters.search}"` });
    if (currentFilters.style) activeFilters.push({ type: 'style', label: `Estilo: ${currentFilters.style}` });
    if (currentFilters.location) activeFilters.push({ type: 'location', label: `Ubicación: ${currentFilters.location}` });
    if (currentFilters.studio) activeFilters.push({ type: 'studio', label: `Estudio: ${currentFilters.studio}` });
    if (currentFilters.availability) {
        const opt = AVAILABILITY_OPTIONS.find(o => o.value === currentFilters.availability);
        activeFilters.push({ type: 'availability', label: `Disponibilidad: ${opt ? opt.label : currentFilters.availability}` });
    }
    if (currentFilters.travel) {
        const opt = TRAVEL_OPTIONS.find(o => o.value === currentFilters.travel);
        activeFilters.push({ type: 'travel', label: `Viajes: ${opt ? opt.label : currentFilters.travel}` });
    }
    if (currentFilters.priceRange) {
        const labels = { low: 'Económico', medium: 'Medio', high: 'Premium' };
        activeFilters.push({ type: 'priceRange', label: `Precio: ${labels[currentFilters.priceRange]}` });
    }

    if (activeFilters.length > 0) {
        container.classList.remove('hidden');
        list.innerHTML = activeFilters.map(f => `
            <span class="wo-tag mk-filter-tag">
                <span>${escapeHtml(f.label)}</span>
                <button type="button" class="wo-tag-x" data-remove-filter="${escapeHtml(f.type)}" aria-label="Quitar filtro">
                    <i data-wo-icon="x"></i>
                </button>
            </span>
        `).join('');
        if (!list.dataset.woBound) {
            list.dataset.woBound = '1';
            list.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-remove-filter]');
                if (btn) removeFilter(btn.dataset.removeFilter);
            });
        }
    } else {
        container.classList.add('hidden');
    }
}

// ============ FILTER LOGIC ============
function applyFilters() {
    if (browseMode === 'studios') {
        const query = currentFilters.search.toLowerCase();
        filteredStudios = allStudios.filter(studio => {
            if (!query) return true;
            return [studio.name, studio.city, studio.country, studio.tagline]
                .some(v => String(v || '').toLowerCase().includes(query));
        });
        renderStudios(filteredStudios);
        renderFeatured();
        renderForYou();
        updateActiveFiltersUI();
        return;
    }

    filteredArtists = allArtists.filter(artist => {
        if (favoritesOnly && !favoriteIds.has(artist.user_id)) return false;
        if (currentFilters.search) {
            const query = currentFilters.search.toLowerCase();
            const name = (artist.name || '').toLowerCase();
            const username = (artist.username || '').toLowerCase();
            const artistStyles = parseStyles(artist.styles_array).map(s => s.toLowerCase());
            const city = (artist.city || artist.ubicacion || '').toLowerCase();

            const matchSearch = name.includes(query) ||
                               username.includes(query) ||
                               artistStyles.some(s => s.includes(query)) ||
                               city.includes(query);

            if (!matchSearch) return false;
        }
        if (currentFilters.style) {
            const artistStyles = parseStyles(artist.styles_array).map(s => s.toLowerCase());
            if (!artistStyles.some(s => s.includes(currentFilters.style.toLowerCase()))) return false;
        }
        if (currentFilters.city) {
            const city = (artist.city || artist.ubicacion || '').toLowerCase();
            if (!city.includes(currentFilters.city.toLowerCase())) return false;
        }
        if (currentFilters.country && artist.country !== currentFilters.country) return false;
        if (currentFilters.studio) {
            if (normalizeKey(artist.estudios) !== normalizeKey(currentFilters.studio)) return false;
        }
        if (currentFilters.availability || currentFilters.travel) {
            const status = getArtistStatus(artist);
            if (!status) return false;
            if (currentFilters.availability && status.key !== currentFilters.availability) return false;
            if (currentFilters.travel && status.key !== currentFilters.travel) return false;
        }
        if (currentFilters.priceRange) {
            const price = parsePrice(artist.session_price);
            if (currentFilters.priceRange === 'low' && price > 200) return false;
            if (currentFilters.priceRange === 'medium' && (price < 200 || price > 800)) return false;
            if (currentFilters.priceRange === 'high' && price < 800) return false;
        }
        return true;
    });

    recordSearchSignals();
    sortArtists();
    renderArtists(filteredArtists);
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

// ============ SEARCH & AUTOCOMPLETE ============
function setupSearch() {
    const input = document.getElementById('smart-search');
    const suggestions = document.getElementById('search-suggestions');
    if (!input || !suggestions) return;

    input.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (val.length < 2) {
            suggestions.classList.add('hidden');
            return;
        }

        const matches = [];
        const query = val.toLowerCase();

        const matchedStyles = TOP_STYLES
            .filter(s => s.label.toLowerCase().includes(query))
            .map(s => ({ label: s.label, category: 'Estilo', type: 'style' }));
        matches.push(...matchedStyles);

        const cities = [...new Set(allArtists.map(a => (a.city || a.ubicacion || '').split(',')[0].trim()))];
        const matchedCities = cities
            .filter(c => c.toLowerCase().includes(query))
            .map(c => ({ label: c, category: 'Ubicación', type: 'city' }));
        matches.push(...matchedCities);

        const matchedNames = allArtists
            .filter(a => a.name.toLowerCase().includes(query))
            .map(a => ({ label: a.name, category: 'Artista', type: 'artist', username: a.username }));
        matches.push(...matchedNames.slice(0, 5));

        if (matches.length > 0) {
            suggestions.innerHTML = matches.map(m => `
                <div class="mk-suggestion" data-sug-type="${escapeHtml(m.type)}" data-sug-label="${escapeHtml(m.label)}" data-sug-username="${escapeHtml(m.username || '')}">
                    <span class="mk-suggestion-label">${escapeHtml(m.label)}</span>
                    <span class="mk-suggestion-cat">${escapeHtml(m.category)}</span>
                </div>
            `).join('');
            suggestions.classList.remove('hidden');
        } else {
            suggestions.classList.add('hidden');
        }
    });

    if (!suggestions.dataset.woBound) {
        suggestions.dataset.woBound = '1';
        suggestions.addEventListener('click', (e) => {
            const row = e.target.closest('.mk-suggestion[data-sug-type]');
            if (!row) return;
            selectSuggestion(row.dataset.sugType, row.dataset.sugLabel, row.dataset.sugUsername);
        });
    }

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            currentFilters.search = input.value.trim();
            suggestions.classList.add('hidden');
            applyFilters();
        }
    });

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !suggestions.contains(e.target)) {
            suggestions.classList.add('hidden');
        }
    });
}

function selectSuggestion(type, label, username) {
    if (type === 'artist') {
        selectArtist(username);
        return;
    }
    if (type === 'style') currentFilters.style = label;
    if (type === 'city') {
        currentFilters.city = label;
        currentFilters.location = label;
    }
    document.getElementById('smart-search').value = '';
    document.getElementById('search-suggestions').classList.add('hidden');
    applyFilters();
}

// ============ EVENT HANDLERS ============
function removeFilter(type) {
    if (type === 'favorites') {
        if (favoritesOnly) toggleFavoritesOnly();
        return;
    }
    currentFilters[type] = null;
    if (type === 'search') currentFilters.search = '';
    if (type === 'location') currentFilters.city = null;
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
    currentFilters = {
        search: '',
        style: null,
        city: null,
        country: null,
        location: null,
        priceRange: null,
        availability: null,
        travel: null,
        studio: null
    };
    const searchInput = document.getElementById('smart-search');
    if (searchInput) searchInput.value = '';
    applyFilters();
}

function selectArtist(username) {
    // La card lleva al perfil público; el CTA de cotización vive ahí.
    window.location.href = `/artist/profile?artist=${encodeURIComponent(username)}`;
}

function selectStudio(ref) {
    window.location.href = `/studio/profile?studio=${encodeURIComponent(ref)}`;
}

function viewArtistProfile(username) {
    // Navigate to public artist profile
    window.location.href = `/artist/profile?artist=${encodeURIComponent(username)}`;
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
