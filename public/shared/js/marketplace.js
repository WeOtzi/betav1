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

const TOP_STYLES = [
    { label: 'Realismo', icon: 'fa-solid fa-eye' },
    { label: 'Tradicional', icon: 'fa-solid fa-anchor' },
    { label: 'Fine Line', icon: 'fa-solid fa-pen-nib' },
    { label: 'Blackwork', icon: 'fa-solid fa-brush' },
    { label: 'Minimalista', icon: 'fa-solid fa-minus' },
    { label: 'Japonés', icon: 'fa-solid fa-dragon' },
    { label: 'Geométrico', icon: 'fa-solid fa-shapes' },
    { label: 'Acuarela', icon: 'fa-solid fa-droplet' }
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
            const { data, error } = await supabaseClient
                .from('artists_db')
                .select('*');
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
            <button class="filter-btn" onclick="toggleStyleFilter('${style.label}')" data-style="${style.label}">
                <i class="${style.icon}"></i>
                <span>${style.label} (${count})</span>
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

    grid.innerHTML = artists.map((artist, index) => {
        const styles = parseStyles(artist.styles_array);
        const price = artist.session_price || 'Consultar';
        const profilePic = artist.profile_picture;
        const experience = artist.years_experience ? `${artist.years_experience} años exp.` : 'Pro';
        const rotation = (index % 2 === 0 ? 0.5 : -0.5);
        
        return `
            <div class="marketplace-card" onclick="selectArtist('${artist.username}')" style="--card-rot: ${rotation}deg">
                ${artist.is_recommended ? '<div class="recommendation-badge">Selección Ötzi</div>' : ''}
                <div class="card-img-wrapper ${!profilePic ? 'no-image' : ''}">
                    ${profilePic ? `<img src="${profilePic}" alt="${artist.name}" loading="lazy" onerror="this.parentElement.classList.add('no-image'); this.remove();">` : ''}
                </div>
                <div class="card-content">
                    <div class="card-styles-bar">
                        ${styles.slice(0, 3).map(s => `<span class="tag-mini">${s}</span>`).join('')}
                    </div>
                    <div class="artist-name-block">
                        <h3 class="card-artist-name">${toTitleCase(artist.name)}</h3>
                    </div>
                    <div class="card-meta">
                        <div class="meta-item">
                            <i class="fa-solid fa-location-dot"></i>
                            <span>${toTitleCase(artist.city || artist.ubicacion)}</span>
                        </div>
                        <div class="meta-item">
                            <i class="fa-solid fa-bolt"></i>
                            <span>${experience}</span>
                        </div>
                    </div>
                    <div class="card-footer">
                        <div class="footer-top-row">
                            <div class="price-box">
                                <span class="price-label">ESTIMADO</span>
                                <span class="price-val">${price.replace(',00', '')}</span>
                            </div>
                            <button class="profile-btn" onclick="event.stopPropagation(); viewArtistProfile('${artist.username}')">
                                <i class="fa-solid fa-user"></i>
                                <span>Perfil</span>
                            </button>
                        </div>
                        <button class="quote-btn">
                            <span>Cotizar</span>
                            <i class="fa-solid fa-arrow-right"></i>
                        </button>
                    </div>
                </div>
            </div>
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
            <div class="filter-chip">
                <span>${f.label}</span>
                <button onclick="removeFilter('${f.type}')">&times;</button>
            </div>
        `).join('');
    } else {
        container.classList.add('hidden');
    }

    document.querySelectorAll('.filter-btn').forEach(btn => {
        const style = btn.dataset.style;
        if (style === currentFilters.style) btn.classList.add('active');
        else btn.classList.remove('active');
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
                <div class="suggestion-item" onclick="selectSuggestion('${m.type}', '${m.label}', '${m.username || ''}')">
                    <span class="suggestion-label">${m.label}</span>
                    <span class="suggestion-category">${m.category}</span>
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
