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
// ============================================

let allArtists = [];
let filteredArtists = [];
let currentPage = 1;
const itemsPerPage = 25; // 5 columns x 5 rows

let currentFilters = {
    search: '',
    style: null,
    city: null,
    country: null,
    priceRange: null,
    language: null,
    experience: null,
    sort: 'recommended'
};

// Estilos destacados (pills). Sin íconos: el DS usa chips tipográficos.
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

// ============ INIT ============
document.addEventListener('DOMContentLoaded', async () => {
    showLoading();
    try {
        await waitForConfigManager();
        allArtists = await fetchArtists() || [];
        console.log('✅ Marketplace loaded with', allArtists.length, 'artists');
        
        if (allArtists.length > 0) {
            initStyleFilters();
            initAdvancedFilters();
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

// ============ UI RENDERING ============
function initStyleFilters() {
    const container = document.getElementById('style-filters');
    if (!container) return;

    container.innerHTML = TOP_STYLES.map(style => {
        const count = allArtists.filter(a => parseStyles(a.styles_array).some(s => s.toLowerCase() === style.label.toLowerCase())).length;
        return `
            <button type="button" class="wo-chip mk-style-chip" onclick="toggleStyleFilter('${style.label}')" data-style="${style.label}">
                <span>${style.label}</span>
                <span class="mk-chip-count">${count}</span>
            </button>
        `;
    }).join('');
}

function initAdvancedFilters() {
    if (!allArtists || allArtists.length === 0) return;

    const countries = [...new Set(allArtists.map(a => a.country).filter(Boolean))].sort();
    const countrySelect = document.getElementById('filter-country');
    if (countrySelect) {
        countrySelect.innerHTML = '<option value="">Todos los países</option>';
        countries.forEach(c => {
            const count = allArtists.filter(a => a.country === c).length;
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = `${c} (${count})`;
            countrySelect.appendChild(opt);
        });
    }

    const allLanguages = [];
    allArtists.forEach(a => {
        if (a.languages) {
            const langs = Array.isArray(a.languages) ? a.languages : [a.languages];
            allLanguages.push(...langs);
        }
    });
    const languages = [...new Set(allLanguages)].sort();
    const langSelect = document.getElementById('filter-language');
    if (langSelect) {
        langSelect.innerHTML = '<option value="">Cualquier idioma</option>';
        languages.forEach(l => {
            const count = allArtists.filter(a => {
                const al = Array.isArray(a.languages) ? a.languages : [a.languages];
                return al.includes(l);
            }).length;
            const opt = document.createElement('option');
            opt.value = l;
            opt.textContent = `${l} (${count})`;
            langSelect.appendChild(opt);
        });
    }
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
    if (countEl) countEl.textContent = `${filteredArtists.length} artistas encontrados`;

    grid.innerHTML = artists.map(artist => {
        const styles = parseStyles(artist.styles_array);
        let price;
        if (artist.session_price_amount && artist.session_price_currency
            && window.WeOtziCurrency && window.WeOtziCurrency.isReady()) {
            price = window.WeOtziCurrency.formatInline(
                artist.session_price_amount,
                artist.session_price_currency,
                { showSecondary: false }
            );
        } else {
            price = artist.session_price || 'Consultar';
        }
        const profilePic = artist.profile_picture;
        const city = toTitleCase((artist.city || artist.ubicacion || '').split(',')[0].trim());
        const mainStyle = styles.length > 0 ? styles[0] : '';
        const metaLine = [city, mainStyle].filter(Boolean).join(' · ');

        return `
            <article class="wo-card wo-card--media wo-card--hover mk-card" onclick="selectArtist('${artist.username}')">
                <div class="mk-card-media">
                    <i data-wo-icon="image" class="mk-media-ph" aria-hidden="true"></i>
                    ${profilePic ? `<img src="${profilePic}" alt="${artist.name}" loading="lazy" onerror="this.remove();">` : ''}
                    ${artist.is_recommended ? '<span class="mk-card-flag">Selección Ötzi</span>' : ''}
                    <div class="mk-card-overlay">
                        <span class="mk-card-avatar" aria-hidden="true">${getInitials(artist.name)}</span>
                        <div class="mk-card-id">
                            <h3 class="mk-card-name">${toTitleCase(artist.name)}</h3>
                            <p class="mk-card-meta">${metaLine}</p>
                        </div>
                    </div>
                </div>
                <div class="mk-card-foot">
                    <div class="mk-card-foot-row">
                        <div class="mk-price">
                            <span class="mk-price-label">Estimado</span>
                            <span class="mk-price-val">${price.replace(',00', '')}</span>
                        </div>
                        <button type="button" class="wo-btn wo-btn--ghost wo-btn--s" onclick="event.stopPropagation(); viewArtistProfile('${artist.username}')">Perfil</button>
                    </div>
                    <button type="button" class="wo-btn wo-btn--s wo-btn--block wo-btn--hard">
                        Cotizá
                        <i data-wo-icon="arrow-right"></i>
                    </button>
                </div>
            </article>
        `;
    }).join('');
}

function updateActiveFiltersUI() {
    const container = document.getElementById('active-filters-section');
    const list = document.getElementById('active-filters-list');
    if (!container || !list) return;

    const activeFilters = [];
    if (currentFilters.search) activeFilters.push({ type: 'search', label: `"${currentFilters.search}"` });
    if (currentFilters.style) activeFilters.push({ type: 'style', label: `Estilo: ${currentFilters.style}` });
    if (currentFilters.city) activeFilters.push({ type: 'city', label: `Ciudad: ${currentFilters.city}` });
    if (currentFilters.country) activeFilters.push({ type: 'country', label: `País: ${currentFilters.country}` });
    if (currentFilters.language) activeFilters.push({ type: 'language', label: `Idioma: ${currentFilters.language}` });
    if (currentFilters.experience) {
        const labels = { junior: 'Junior', mid: 'Intermedio', senior: 'Senior' };
        activeFilters.push({ type: 'experience', label: `Exp: ${labels[currentFilters.experience]}` });
    }
    if (currentFilters.priceRange) {
        const labels = { low: 'Económico', medium: 'Medio', high: 'Premium' };
        activeFilters.push({ type: 'priceRange', label: `Precio: ${labels[currentFilters.priceRange]}` });
    }

    if (activeFilters.length > 0) {
        container.classList.remove('hidden');
        list.innerHTML = activeFilters.map(f => `
            <span class="wo-tag mk-filter-tag">
                <span>${f.label}</span>
                <button type="button" class="wo-tag-x" onclick="removeFilter('${f.type}')" aria-label="Quitar filtro">
                    <i data-wo-icon="x"></i>
                </button>
            </span>
        `).join('');
    } else {
        container.classList.add('hidden');
    }

    document.querySelectorAll('.mk-style-chip').forEach(btn => {
        const style = btn.dataset.style;
        if (style === currentFilters.style) btn.classList.add('is-active');
        else btn.classList.remove('is-active');
    });

    if (document.getElementById('filter-country')) document.getElementById('filter-country').value = currentFilters.country || '';
    if (document.getElementById('filter-language')) document.getElementById('filter-language').value = currentFilters.language || '';
    if (document.getElementById('filter-experience')) document.getElementById('filter-experience').value = currentFilters.experience || '';
    if (document.getElementById('filter-price')) document.getElementById('filter-price').value = currentFilters.priceRange || '';
}

// ============ FILTER LOGIC ============
function applyFilters() {
    filteredArtists = allArtists.filter(artist => {
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
        if (currentFilters.language) {
            const langs = Array.isArray(artist.languages) ? artist.languages : [artist.languages];
            if (!langs.includes(currentFilters.language)) return false;
        }
        if (currentFilters.experience) {
            const years = parseInt(artist.years_experience) || 0;
            if (currentFilters.experience === 'junior' && (years < 1 || years > 3)) return false;
            if (currentFilters.experience === 'mid' && (years < 4 || years > 7)) return false;
            if (currentFilters.experience === 'senior' && years < 8) return false;
        }
        if (currentFilters.priceRange) {
            const price = parsePrice(artist.session_price);
            if (currentFilters.priceRange === 'low' && price > 200) return false;
            if (currentFilters.priceRange === 'medium' && (price < 200 || price > 800)) return false;
            if (currentFilters.priceRange === 'high' && price < 800) return false;
        }
        return true;
    });

    sortArtists();
    currentPage = 1;
    renderMarketplace();
    updateActiveFiltersUI();
}

function renderMarketplace() {
    const totalPages = Math.ceil(filteredArtists.length / itemsPerPage);
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const paginatedArtists = filteredArtists.slice(start, end);

    renderArtists(paginatedArtists);
    updatePaginationUI(totalPages);
}

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
    info.textContent = `Página ${currentPage} de ${totalPages}`;
    
    prevBtn.disabled = currentPage === 1;
    nextBtn.disabled = currentPage === totalPages;
    
    prevBtn.style.opacity = currentPage === 1 ? '0.3' : '1';
    nextBtn.style.opacity = currentPage === totalPages ? '0.3' : '1';
}

function changePage(delta) {
    const totalPages = Math.ceil(filteredArtists.length / itemsPerPage);
    const newPage = currentPage + delta;
    
    if (newPage >= 1 && newPage <= totalPages) {
        currentPage = newPage;
        renderMarketplace();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function sortArtists() {
    if (currentFilters.sort === 'recommended') {
        // Usar artist_index (score calculado) para ordenar por relevancia
        // Fallback a is_recommended si artist_index no existe
        filteredArtists.sort((a, b) => {
            const scoreA = a.artist_index || (a.is_recommended ? 50 : 0);
            const scoreB = b.artist_index || (b.is_recommended ? 50 : 0);
            return scoreB - scoreA;
        });
    } else if (currentFilters.sort === 'name') {
        filteredArtists.sort((a, b) => a.name.localeCompare(b.name));
    } else if (currentFilters.sort === 'price-low') {
        filteredArtists.sort((a, b) => parsePrice(a.session_price) - parsePrice(b.session_price));
    } else if (currentFilters.sort === 'price-high') {
        filteredArtists.sort((a, b) => parsePrice(b.session_price) - parsePrice(a.session_price));
    }
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
                <div class="mk-suggestion" onclick="selectSuggestion('${m.type}', '${m.label}', '${m.username || ''}')">
                    <span class="mk-suggestion-label">${m.label}</span>
                    <span class="mk-suggestion-cat">${m.category}</span>
                </div>
            `).join('');
            suggestions.classList.remove('hidden');
        } else {
            suggestions.classList.add('hidden');
        }
    });

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
    if (type === 'city') currentFilters.city = label;
    document.getElementById('smart-search').value = '';
    document.getElementById('search-suggestions').classList.add('hidden');
    applyFilters();
}

// ============ EVENT HANDLERS ============
function toggleStyleFilter(style) {
    if (currentFilters.style === style) currentFilters.style = null;
    else currentFilters.style = style;
    applyFilters();
}

function handleFilterChange(type, value) {
    currentFilters[type] = value || null;
    applyFilters();
}

function removeFilter(type) {
    currentFilters[type] = null;
    if (type === 'search') currentFilters.search = '';
    if (type === 'city') currentFilters.city = null;
    applyFilters();
}

function clearAllFilters() {
    currentFilters = { 
        search: '', 
        style: null, 
        city: null,
        country: null, 
        priceRange: null, 
        language: null, 
        experience: null, 
        sort: 'recommended' 
    };
    const searchInput = document.getElementById('smart-search');
    if (searchInput) searchInput.value = '';
    applyFilters();
}

function handleSortChange() {
    currentFilters.sort = document.getElementById('sort-select').value;
    applyFilters();
}

function selectArtist(username) {
    // Use root path with query param (works with dev servers that strip index.html)
    window.location.href = `/quotation?artist=${username}`;
}

function viewArtistProfile(username) {
    // Navigate to public artist profile
    window.location.href = `/artist/profile?artist=${encodeURIComponent(username)}`;
}

// ============ EXPORT GLOBALS ============
window.toggleStyleFilter = toggleStyleFilter;
window.handleFilterChange = handleFilterChange;
window.removeFilter = removeFilter;
window.clearAllFilters = clearAllFilters;
window.selectSuggestion = selectSuggestion;
window.handleSortChange = handleSortChange;
window.selectArtist = selectArtist;
window.viewArtistProfile = viewArtistProfile;
window.changePage = changePage;
