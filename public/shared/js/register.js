// ============================================
// WE ÖTZI - Artist Registration Form Logic
// Typeform-style step navigation with Bauhaus aesthetic
// Connected to Supabase artists_db
// ============================================

// Supabase Configuration - Uses config-manager.js (provides window.CONFIG)
const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

// Current user session
let currentUser = null;

// Google Places Autocomplete instance
let placesAutocomplete = null;

// Form State
const formState = {
    currentStep: 1,
    totalSteps: 12,
    // Count of consecutive autosave failures (server draft sync). Reset to 0 on
    // success. The wizard surfaces a banner once this reaches DRAFT_SYNC_WARN_THRESHOLD
    // so the user knows their progress is no longer being persisted server-side.
    draftSyncFailures: 0,
    data: {
        artistic_name: '',
        full_name: '',
        email: '',
        city: '',
        location_city: '',
        location_country: '',
        styles: [],
        experience_years: '',
        session_price: '',
        session_currency: 'USD',
        portfolio_source: '',
        portfolio_url: '',
        instagram_handle: '',
        bio: '',
        work_type: '',
        studio_name: '',
        studio_id: null,
        birth_date: '',
        subscribed_newsletter: false,
        terms_accepted: false
    }
};

// Studio autocomplete state
let studioSearchTimeout = null;
let studioSuggestionsCache = [];

// DOM Elements
const formSteps = document.querySelectorAll('.form-step');
const progressFill = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
const btnBack = document.getElementById('btn-back');
const btnNext = document.getElementById('btn-next');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeAuth();
});

// ============================================
// Registration Draft Autosave
// ============================================
// Persists the wizard's in-progress state to public.artist_registration_drafts
// so a closed tab / network blip / server hiccup doesn't lose the user's work.
// See supabase/migrations/20260513000000_artist_registration_drafts.sql.

const DRAFT_SYNC_DEBOUNCE_MS = 800;
// Stay silent on the first failure (could be a transient blip — the debounce
// will retry on the next field change). Surface the banner once we hit this.
const DRAFT_SYNC_WARN_THRESHOLD = 2;

let draftSyncTimer = null;
let draftSyncInFlight = null;

function scheduleDraftSync() {
    if (!currentUser) return;
    if (draftSyncTimer) clearTimeout(draftSyncTimer);
    draftSyncTimer = setTimeout(() => {
        draftSyncTimer = null;
        saveRegistrationDraftToServer();
    }, DRAFT_SYNC_DEBOUNCE_MS);
}

// Force an immediate sync (e.g., on step transition). Cancels any pending debounce.
function flushDraftSync() {
    if (!currentUser) return Promise.resolve(null);
    if (draftSyncTimer) {
        clearTimeout(draftSyncTimer);
        draftSyncTimer = null;
    }
    return saveRegistrationDraftToServer();
}

async function saveRegistrationDraftToServer() {
    if (!currentUser) return null;

    // Coalesce concurrent calls — return the in-flight promise instead of racing.
    if (draftSyncInFlight) return draftSyncInFlight;

    draftSyncInFlight = (async () => {
        try {
            const { error } = await _supabase
                .from('artist_registration_drafts')
                .upsert({
                    user_id: currentUser.id,
                    draft_data: formState.data,
                    current_step: String(formState.currentStep)
                }, { onConflict: 'user_id' });

            if (error) throw error;

            formState.draftSyncFailures = 0;
            hideDraftSyncWarning();
            return true;
        } catch (error) {
            console.warn('[register] Could not sync registration draft:', error.message || error);
            formState.draftSyncFailures += 1;
            if (formState.draftSyncFailures >= DRAFT_SYNC_WARN_THRESHOLD) {
                showDraftSyncWarning();
            }
            return null;
        } finally {
            draftSyncInFlight = null;
        }
    })();

    return draftSyncInFlight;
}

async function loadRegistrationDraft() {
    if (!currentUser) return null;
    try {
        const { data, error } = await _supabase
            .from('artist_registration_drafts')
            .select('draft_data, current_step')
            .eq('user_id', currentUser.id)
            .maybeSingle();

        if (error) {
            console.warn('[register] Could not load registration draft:', error.message || error);
            return null;
        }
        if (!data || !data.draft_data) return null;

        // Draft overlays whatever loadExistingArtistData() set: the draft is the
        // most recent in-progress state, so a partially-edited field should win
        // over the stored profile value. Email stays pinned to the auth session.
        const incoming = data.draft_data || {};
        const pinnedEmail = formState.data.email;
        Object.assign(formState.data, incoming);
        if (pinnedEmail) formState.data.email = pinnedEmail;
        return data;
    } catch (error) {
        console.warn('[register] Could not load registration draft:', error.message || error);
        return null;
    }
}

async function clearRegistrationDraft() {
    if (!currentUser) return;
    if (draftSyncTimer) {
        clearTimeout(draftSyncTimer);
        draftSyncTimer = null;
    }
    try {
        await _supabase
            .from('artist_registration_drafts')
            .delete()
            .eq('user_id', currentUser.id);
    } catch (error) {
        // Non-fatal: the draft will be overwritten on the user's next wizard visit
        // (or cascade-deleted with the auth user). No need to surface to the user.
        console.warn('[register] Could not clear registration draft:', error.message || error);
    }
}

function showDraftSyncWarning() {
    const banner = document.getElementById('draft-sync-warning');
    if (!banner) return;
    banner.hidden = false;
    banner.classList.add('visible');
}

function hideDraftSyncWarning() {
    const banner = document.getElementById('draft-sync-warning');
    if (!banner) return;
    banner.hidden = true;
    banner.classList.remove('visible');
}

// [CH-10] START: Google Maps Places API Integration
// [CH-15] Updated to use full formatted_address from Google Maps
// Handles address autocomplete and reverse geocoding for geolocation
function initGooglePlaces() {
    const cityInput = document.getElementById('city');
    if (!cityInput || typeof google === 'undefined') return;

    // Remove city restriction to get full address
    placesAutocomplete = new google.maps.places.Autocomplete(cityInput, {
        types: ['geocode'],
        fields: ['formatted_address', 'geometry', 'address_components']
    });

    placesAutocomplete.addListener('place_changed', () => {
        const place = placesAutocomplete.getPlace();
        if (place && place.formatted_address) {
            // Use full formatted_address directly from Google Maps
            cityInput.value = place.formatted_address;
            formState.data.city = place.formatted_address;

            // Extract city and country from address_components
            if (place.address_components) {
                // Reset before extracting
                formState.data.location_city = '';
                formState.data.location_country = '';

                for (const component of place.address_components) {
                    const types = component.types;
                    // Locality (ciudad/localidad)
                    if (types.includes('locality') || types.includes('administrative_area_level_2')) {
                        if (!formState.data.location_city) {
                            formState.data.location_city = component.long_name;
                        }
                    }
                    // Country (país)
                    if (types.includes('country')) {
                        formState.data.location_country = component.long_name;
                    }
                }
            }
            scheduleDraftSync();
        }
    });
}

// Geolocation function using browser API and Google Geocoder
// [CH-15] Updated to return format: "Localidad, Provincia, País"
// [FIX] Added IP-based fallback when browser geolocation fails
function getGeolocation() {
    const btn = document.getElementById('geolocation-btn');
    const hint = document.getElementById('location-hint');
    const cityInput = document.getElementById('city');

    // Show loading state
    btn.classList.add('loading');
    hint.textContent = 'Obteniendo ubicacion...';
    hint.style.color = 'var(--fg)';

    // Helper function to reverse geocode coordinates to address
    // Returns format: "Localidad, Provincia, País"
    async function reverseGeocode(latitude, longitude) {
        const geocoder = new google.maps.Geocoder();
        const response = await geocoder.geocode({
            location: { lat: latitude, lng: longitude }
        });
        if (response.results && response.results[0]) {
            // Extract specific address components for "Localidad, Provincia, País" format
            const components = response.results[0].address_components;
            let locality = '';
            let province = '';
            let country = '';
            
            for (const component of components) {
                const types = component.types;
                // Locality (ciudad/localidad)
                if (types.includes('locality') || types.includes('administrative_area_level_2')) {
                    if (!locality) locality = component.long_name;
                }
                // Province/State (provincia)
                if (types.includes('administrative_area_level_1')) {
                    province = component.long_name;
                }
                // Country (país)
                if (types.includes('country')) {
                    country = component.long_name;
                }
            }
            
            // Store city and country separately in formState
            formState.data.location_city = locality || '';
            formState.data.location_country = country || '';
            scheduleDraftSync();
            
            // Build the formatted address: "Localidad, Provincia, País"
            const parts = [locality, province, country].filter(p => p);
            const formattedLocation = parts.join(', ');
            
            return formattedLocation || response.results[0].formatted_address;
        }
        return null;
    }

    // Helper function to handle successful location
    async function handleLocationSuccess(latitude, longitude) {
        try {
            const fullAddress = await reverseGeocode(latitude, longitude);
            if (fullAddress) {
                cityInput.value = fullAddress;
                formState.data.city = fullAddress;
                hint.textContent = 'Ubicacion detectada!';
                hint.style.color = '#4CAF50';
            } else {
                hint.textContent = 'No se pudo determinar la ubicacion.';
                hint.style.color = 'var(--primary-red)';
            }
        } catch (error) {
            console.error('Geocoding error:', error);
            hint.textContent = 'Error al obtener la direccion.';
            hint.style.color = 'var(--primary-red)';
        }
        btn.classList.remove('loading');
    }

    // Fallback: Use IP-based geolocation service
    async function tryIPGeolocation() {
        try {
            // Use ipapi.co for IP-based geolocation (free, no API key needed)
            const response = await fetch('https://ipapi.co/json/');
            if (!response.ok) throw new Error('IP geolocation failed');
            const data = await response.json();
            
            if (data.latitude && data.longitude) {
                await handleLocationSuccess(data.latitude, data.longitude);
            } else {
                throw new Error('No coordinates in IP response');
            }
        } catch (error) {
            btn.classList.remove('loading');
            hint.textContent = 'No se pudo obtener la ubicacion. Ingresala manualmente.';
            hint.style.color = 'var(--primary-red)';
        }
    }

    // Try browser geolocation first
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const { latitude, longitude } = position.coords;
                await handleLocationSuccess(latitude, longitude);
            },
            async (error) => {
                // If permission denied, don't try fallback - user explicitly denied
                if (error.code === error.PERMISSION_DENIED) {
                    btn.classList.remove('loading');
                    hint.textContent = 'Permiso de ubicacion denegado.';
                    hint.style.color = 'var(--primary-red)';
                    return;
                }
                
                // For other errors (POSITION_UNAVAILABLE, TIMEOUT), try IP fallback
                hint.textContent = 'Intentando metodo alternativo...';
                await tryIPGeolocation();
            },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
        );
    } else {
        // No browser geolocation, try IP fallback directly
        tryIPGeolocation();
    }
}

// Make geolocation globally available
window.getGeolocation = getGeolocation;
window.initGooglePlaces = initGooglePlaces;
// [CH-10] END

// [CH-09] START: Text Formatting Helpers
// Capitalize each word (Title Case)
function capitalizeWords(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

// Format artistic name to username (no spaces, no special chars, ending in .wo)
function formatUsername(artisticName) {
    if (!artisticName) return '';
    
    // Convert to lowercase
    let username = artisticName.toLowerCase();
    
    // Remove accents/diacritics
    username = username.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    // Remove special characters and spaces (keep only letters and numbers)
    username = username.replace(/[^a-z0-9]/g, '');
    
    // Add .wo suffix
    return username + '.wo';
}
// [CH-09] END

// ============================================
// Username Availability Check
// ============================================

// Check if username is available (not taken by another user)
async function checkUsernameAvailability(username, currentUserId) {
    if (!username) return { available: true };
    
    try {
        const { data, error } = await _supabase
            .from('artists_db')
            .select('user_id')
            .eq('username', username)
            .neq('user_id', currentUserId)
            .limit(1);
        
        if (error) {
            console.error('Error checking username:', error);
            return { available: true, error }; // Allow submission on error, let server validate
        }
        
        return { available: !data || data.length === 0 };
    } catch (err) {
        console.error('Username check failed:', err);
        return { available: true }; // Allow submission on error
    }
}

// ============================================
// Birth Date Selects (Day / Month / Year)
// ============================================

const MONTH_NAMES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

function setupBirthDateSelects() {
    const daySel = document.getElementById('birth_day');
    const monthSel = document.getElementById('birth_month');
    const yearSel = document.getElementById('birth_year');
    if (!daySel || !monthSel || !yearSel) return;

    for (let d = 1; d <= 31; d++) {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = String(d).padStart(2, '0');
        daySel.appendChild(opt);
    }

    MONTH_NAMES.forEach((name, i) => {
        const opt = document.createElement('option');
        opt.value = i + 1;
        opt.textContent = name;
        monthSel.appendChild(opt);
    });

    const currentYear = new Date().getFullYear();
    for (let y = currentYear; y >= 1920; y--) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        yearSel.appendChild(opt);
    }

    function syncBirthDateState() {
        const d = daySel.value;
        const m = monthSel.value;
        const y = yearSel.value;
        if (d && m && y) {
            formState.data.birth_date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        } else {
            formState.data.birth_date = '';
        }
        scheduleDraftSync();
    }

    daySel.addEventListener('change', syncBirthDateState);
    monthSel.addEventListener('change', syncBirthDateState);
    yearSel.addEventListener('change', syncBirthDateState);
}

function prefillBirthDateSelects() {
    const iso = formState.data.birth_date;
    if (!iso || !iso.includes('-')) return;
    const [y, m, d] = iso.split('-');
    const daySel = document.getElementById('birth_day');
    const monthSel = document.getElementById('birth_month');
    const yearSel = document.getElementById('birth_year');
    if (daySel) daySel.value = parseInt(d, 10);
    if (monthSel) monthSel.value = parseInt(m, 10);
    if (yearSel) yearSel.value = parseInt(y, 10);
}

function validateBirthDateSelects() {
    const daySel = document.getElementById('birth_day');
    const monthSel = document.getElementById('birth_month');
    const yearSel = document.getElementById('birth_year');
    const d = parseInt(daySel?.value, 10);
    const m = parseInt(monthSel?.value, 10);
    const y = parseInt(yearSel?.value, 10);

    if (!d || !m || !y) return { valid: false, message: 'Selecciona dia, mes y ano.', errorElement: daySel };

    const date = new Date(y, m - 1, d);
    if (date.getDate() !== d || date.getMonth() !== m - 1 || date.getFullYear() !== y) {
        return { valid: false, message: 'Fecha invalida. Revisa el dia seleccionado.', errorElement: daySel };
    }

    const today = new Date();
    let age = today.getFullYear() - y;
    const monthDiff = today.getMonth() - (m - 1);
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d)) age--;
    if (age < 18) {
        return { valid: false, message: 'Debes ser mayor de 18 anos para registrarte.', errorElement: yearSel };
    }

    formState.data.birth_date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return { valid: true };
}

// ============================================
// Authentication & Data Loading
// ============================================

async function initializeAuth() {
    try {
        const requestedReturnTo = window.ArtistAuth?.getReturnTo(window.location.search, '') || '';
        const authUrls = window.ArtistAuth?.getRouteUrls(window.ConfigManager, requestedReturnTo) || {
            login: requestedReturnTo ? `/registerclosedbeta?returnTo=${encodeURIComponent(requestedReturnTo)}` : '/registerclosedbeta'
        };
        const { data: { session }, error } = await _supabase.auth.getSession();
        
        if (error) throw error;

        if (!session) {
            console.log('No authenticated session found. Redirecting to login...');
            window.location.href = authUrls.login;
            return;
        }

        currentUser = session.user;
        console.log('User authenticated:', currentUser.email);

        formState.data.email = currentUser.email;
        const emailInput = document.getElementById('email');
        if (emailInput) {
            emailInput.value = currentUser.email;
            emailInput.readOnly = true;
            emailInput.style.opacity = '0.7';
        }

        await loadExistingArtistData();
        // Draft overlays loadExistingArtistData(): abandoned-mid-edit state wins
        // over the stored profile because it's the most recent in-progress data.
        const draft = await loadRegistrationDraft();
        if (draft) {
            prefillFormInputs();
            if (draft.current_step) {
                const parsed = Number(draft.current_step);
                if (Number.isFinite(parsed) && parsed >= 1 && parsed <= formState.totalSteps) {
                    formState.currentStep = parsed;
                } else if (draft.current_step === 'summary') {
                    formState.currentStep = 'summary';
                }
            }
        }
        await loadAndRenderStylesFromDB();

        initializeForm();
        setupEventListeners();
        setupBirthDateSelects();
        updateUI();

        // Initialize Google Places if API is loaded
        if (typeof google !== 'undefined') {
            initGooglePlaces();
        }

    } catch (error) {
        console.error('Auth initialization error:', error);
        const requestedReturnTo = window.ArtistAuth?.getReturnTo(window.location.search, '') || '';
        const authUrls = window.ArtistAuth?.getRouteUrls(window.ConfigManager, requestedReturnTo) || {
            login: requestedReturnTo ? `/registerclosedbeta?returnTo=${encodeURIComponent(requestedReturnTo)}` : '/registerclosedbeta'
        };
        window.location.href = authUrls.login;
    }
}

async function loadExistingArtistData() {
    if (!currentUser) return;

    try {
        // Use maybeSingle() instead of single() to prevent 406 error when no rows exist
        const { data: artist, error } = await _supabase
            .from('artists_db')
            .select('*')
            .eq('user_id', currentUser.id)
            .maybeSingle();

        if (error) {
            console.error('Error loading artist data:', error);
            return;
        }

        if (artist) {
            formState.data.artistic_name = artist.username ? artist.username.replace(/\.wo$/, '') : '';
            formState.data.full_name = artist.name || '';
            formState.data.email = artist.email || currentUser.email;
            formState.data.city = artist.ubicacion || '';
            formState.data.styles = artist.styles_array || [];
            formState.data.portfolio_url = artist.portafolio || '';
            formState.data.instagram_handle = (artist.instagram || '').replace(/^@/, '');
            if (artist.instagram) {
                formState.data.portfolio_source = 'instagram';
            } else if (artist.portafolio) {
                formState.data.portfolio_source = 'website';
            }
            formState.data.bio = artist.bio_description || '';
            formState.data.session_price = artist.session_price || '';
            formState.data.birth_date = artist.birth_date || '';
            formState.data.subscribed_newsletter = artist.subscribed_newsletter || false;
            formState.data.experience_years = artist.years_experience || '';
            
            // Hydrate work_type from persisted column; fall back to old heuristic
            if (artist.work_type) {
                formState.data.work_type = artist.work_type;
            } else if (artist.estudios === 'Sin estudio/Independiente') {
                formState.data.work_type = 'independent';
            } else if (artist.estudios) {
                formState.data.work_type = 'studio';
            }

            formState.data.studio_id = artist.studio_id || null;
            formState.data.studio_name = (artist.studio_id && artist.estudios && artist.estudios !== 'Sin estudio/Independiente')
                ? artist.estudios
                : (artist.estudios && artist.estudios !== 'Sin estudio/Independiente' ? artist.estudios : '');

            prefillFormInputs();
        }
    } catch (error) {
        console.error('Error loading existing data:', error);
    }
}

// Cached flat list of style objects loaded from tattoo_styles
let _loadedDbStyles = [];

function normalizeStyleName(name) {
    return (name || '').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function loadAndRenderStylesFromDB() {
    const grid = document.getElementById('styles-grid');
    if (!grid) return;

    grid.innerHTML = '<span class="styles-loading" style="opacity:0.5;font-size:0.85rem;">Cargando estilos...</span>';

    try {
        if (window.ConfigManager && typeof window.ConfigManager.loadTattooStylesFlatFromDB === 'function') {
            _loadedDbStyles = await window.ConfigManager.loadTattooStylesFlatFromDB();
        }
    } catch (err) {
        console.error('Error loading tattoo styles from DB:', err);
    }

    const parentStyles = (_loadedDbStyles || [])
        .filter(s => !s.parent_id)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    grid.innerHTML = '';

    parentStyles.forEach(style => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'style-option';
        btn.dataset.style = style.name;
        btn.textContent = style.name;
        grid.appendChild(btn);
    });

    const otherBtn = document.createElement('button');
    otherBtn.type = 'button';
    otherBtn.className = 'style-option style-option-other';
    otherBtn.dataset.style = 'Otro';
    otherBtn.id = 'style-other-btn';
    otherBtn.textContent = '+ Otro';
    grid.appendChild(otherBtn);
}

function prefillFormInputs() {
    const data = formState.data;

    const fieldMappings = {
        'artistic_name': data.artistic_name,
        'full_name': data.full_name,
        'email': data.email,
        'city': data.city,
        'session_price': data.session_price
    };

    Object.entries(fieldMappings).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input && value) {
            input.value = value;
        }
    });
    
    prefillBirthDateSelects();

    // Prefill bio (contenteditable div)
    const bioEditor = document.getElementById('bio');
    if (bioEditor && data.bio) {
        bioEditor.innerHTML = data.bio;
    }

    if (data.styles && data.styles.length > 0) {
        const gridBtns = document.querySelectorAll('#styles-grid .style-option:not(.style-option-other)');
        const normalizedMap = {};
        gridBtns.forEach(btn => {
            normalizedMap[normalizeStyleName(btn.dataset.style)] = btn;
        });

        const stylesGrid = document.getElementById('styles-grid');
        const otherBtn = document.getElementById('style-other-btn');
        const canonicalized = [];

        data.styles.forEach(savedStyle => {
            const norm = normalizeStyleName(savedStyle);
            const matchBtn = normalizedMap[norm];
            if (matchBtn) {
                matchBtn.classList.add('selected');
                canonicalized.push(matchBtn.dataset.style);
            } else if (stylesGrid && otherBtn) {
                const newBtn = document.createElement('button');
                newBtn.type = 'button';
                newBtn.className = 'style-option selected custom-added';
                newBtn.dataset.style = savedStyle;
                newBtn.textContent = savedStyle;
                newBtn.addEventListener('click', () => toggleStyleOption(newBtn));
                stylesGrid.insertBefore(newBtn, otherBtn);
                canonicalized.push(savedStyle);
            }
        });

        formState.data.styles = canonicalized;
    }

    if (data.work_type) {
        const workTypeBtn = document.querySelector(`.work-type-option[data-type="${data.work_type}"]`);
        if (workTypeBtn) {
            workTypeBtn.classList.add('selected');
        }
        
        const studioNameWrapper = document.getElementById('studio-name-wrapper');
        const studioNameInput = document.getElementById('studio_name');
        if (studioNameWrapper && (data.work_type === 'studio' || data.work_type === 'both')) {
            studioNameWrapper.style.display = 'block';
            if (!studioAutocompleteInitialized) {
                initStudioAutocomplete();
                studioAutocompleteInitialized = true;
            }
            if (studioNameInput && data.studio_name) {
                studioNameInput.value = data.studio_name;
            }
        }
    }

    if (data.experience_years) {
        const experienceBtn = document.querySelector(`.experience-option[data-years="${data.experience_years}"]`);
        if (experienceBtn) {
            experienceBtn.classList.add('selected');
        }
    }

    if (data.subscribed_newsletter) {
        const newsletterBtn = document.querySelector('.newsletter-option[data-subscribe="true"]');
        if (newsletterBtn) {
            newsletterBtn.classList.add('selected');
        }
    }

    if (data.portfolio_source) {
        const sourceBtn = document.querySelector(`.portfolio-source-option[data-source="${data.portfolio_source}"]`);
        if (sourceBtn) {
            sourceBtn.classList.add('selected');
            selectPortfolioSource(sourceBtn);
        }
        if ((data.portfolio_source === 'website' || data.portfolio_source === 'other') && data.portfolio_url) {
            const urlInput = document.getElementById('portfolio_url');
            if (urlInput) urlInput.value = data.portfolio_url;
        }
        if (data.portfolio_source === 'instagram' && data.instagram_handle) {
            const igInput = document.getElementById('instagram_handle');
            if (igInput) igInput.value = data.instagram_handle;
        }
    }
}

// ============================================
// Form Initialization & Event Listeners
// ============================================

function initializeForm() {
    // Style options (multi-select)
    const styleButtons = document.querySelectorAll('.style-option');
    styleButtons.forEach(btn => {
        btn.addEventListener('click', () => toggleStyleOption(btn));
    });

    // [CH-15] Custom style add button
    const addCustomStyleBtn = document.getElementById('add-custom-style-btn');
    if (addCustomStyleBtn) {
        addCustomStyleBtn.addEventListener('click', addCustomStyle);
    }
    
    // [CH-15] Allow Enter key to add custom style
    const customStyleInput = document.getElementById('custom_style');
    if (customStyleInput) {
        customStyleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                addCustomStyle();
            }
        });
    }

    // Experience options (single-select)
    const experienceButtons = document.querySelectorAll('.experience-option');
    experienceButtons.forEach(btn => {
        btn.addEventListener('click', () => selectExperienceOption(btn));
    });

    // Work type options (single-select)
    const workTypeButtons = document.querySelectorAll('.work-type-option');
    workTypeButtons.forEach(btn => {
        btn.addEventListener('click', () => selectWorkTypeOption(btn));
    });

    // Portfolio source options (single-select)
    const portfolioSourceButtons = document.querySelectorAll('.portfolio-source-option');
    portfolioSourceButtons.forEach(btn => {
        btn.addEventListener('click', () => selectPortfolioSource(btn));
    });

    // Newsletter options (single-select)
    const newsletterButtons = document.querySelectorAll('.newsletter-option');
    newsletterButtons.forEach(btn => {
        btn.addEventListener('click', () => selectNewsletterOption(btn));
    });

    // Currency selector
    const currencySelect = document.getElementById('session_currency');
    if (currencySelect) {
        currencySelect.addEventListener('change', (e) => {
            formState.data.session_currency = e.target.value;
            scheduleDraftSync();
        });
    }

    // Terms checkbox
    const termsCheckbox = document.getElementById('terms-checkbox');
    if (termsCheckbox) {
        termsCheckbox.addEventListener('change', (e) => {
            formState.data.terms_accepted = e.target.checked;
            scheduleDraftSync();
        });
    }
}

function setupEventListeners() {
    btnNext.addEventListener('click', handleNext);
    btnBack.addEventListener('click', handleBack);

    const draftRetryBtn = document.getElementById('draft-sync-retry');
    if (draftRetryBtn) {
        draftRetryBtn.addEventListener('click', async () => {
            draftRetryBtn.disabled = true;
            try {
                await flushDraftSync();
            } finally {
                draftRetryBtn.disabled = false;
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            const activeElement = document.activeElement;
            // Exclude textarea AND contenteditable elements (e.g. bio editor)
            if (activeElement.tagName !== 'TEXTAREA' && !activeElement.isContentEditable) {
                e.preventDefault();
                handleNext();
            }
        }
    });

    const inputs = document.querySelectorAll('.form-input');
    inputs.forEach(input => {
        input.addEventListener('input', (e) => {
            const field = e.target.id;
            formState.data[field] = e.target.value;
            e.target.classList.remove('error');
            scheduleDraftSync();
        });
    });
}

// ============================================
// Selection Handlers
// ============================================

// [CH-15] Updated to handle "Otro" style option with custom input
function toggleStyleOption(btn) {
    const style = btn.dataset.style;
    
    // Special handling for "Otro" button
    if (style === 'Otro') {
        btn.classList.toggle('selected');
        const customWrapper = document.getElementById('custom-style-wrapper');
        if (customWrapper) {
            if (btn.classList.contains('selected')) {
                customWrapper.style.display = 'block';
                setTimeout(() => document.getElementById('custom_style')?.focus(), 100);
            } else {
                customWrapper.style.display = 'none';
            }
        }
        return;
    }
    
    btn.classList.toggle('selected');

    if (btn.classList.contains('selected')) {
        if (!formState.data.styles.includes(style)) {
            formState.data.styles.push(style);
        }
    } else {
        formState.data.styles = formState.data.styles.filter(s => s !== style);
    }
    scheduleDraftSync();
}

async function addCustomStyle() {
    const customInput = document.getElementById('custom_style');
    const rawValue = customInput?.value.trim();
    if (!rawValue) return;

    const addBtn = document.getElementById('add-custom-style-btn');
    if (addBtn) addBtn.disabled = true;

    try {
        const res = await fetch('/api/tattoo-styles/ensure', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: rawValue })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.error('Error ensuring style:', err);
            return;
        }

        const { style } = await res.json();
        const canonicalName = style?.name || rawValue;

        if (formState.data.styles.includes(canonicalName)) {
            customInput.value = '';
            return;
        }

        const existingBtn = document.querySelector(`#styles-grid .style-option[data-style="${CSS.escape(canonicalName)}"]`);
        if (existingBtn) {
            if (!existingBtn.classList.contains('selected')) {
                existingBtn.classList.add('selected');
                formState.data.styles.push(canonicalName);
            }
        } else {
            formState.data.styles.push(canonicalName);
            const stylesGrid = document.getElementById('styles-grid');
            const otherBtn = document.getElementById('style-other-btn');
            if (stylesGrid && otherBtn) {
                const newBtn = document.createElement('button');
                newBtn.type = 'button';
                newBtn.className = 'style-option selected custom-added';
                newBtn.dataset.style = canonicalName;
                newBtn.textContent = canonicalName;
                newBtn.addEventListener('click', () => toggleStyleOption(newBtn));
                stylesGrid.insertBefore(newBtn, otherBtn);
            }
        }

        customInput.value = '';
        scheduleDraftSync();
    } catch (err) {
        console.error('addCustomStyle network error:', err);
    } finally {
        if (addBtn) addBtn.disabled = false;
    }
}

function selectExperienceOption(btn) {
    document.querySelectorAll('.experience-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    formState.data.experience_years = btn.dataset.years;
    scheduleDraftSync();
}

// ============================================
// Studio Autocomplete
// ============================================

function initStudioAutocomplete() {
    const studioInput = document.getElementById('studio_name');
    const suggestionsEl = document.getElementById('studio-suggestions');
    if (!studioInput || !suggestionsEl) return;

    studioInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        formState.data.studio_name = query;
        formState.data.studio_id = null;
        scheduleDraftSync();

        if (query.length < 2) {
            hideSuggestions();
            return;
        }
        clearTimeout(studioSearchTimeout);
        studioSearchTimeout = setTimeout(() => searchStudios(query), 250);
    });

    studioInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            const active = suggestionsEl.querySelector('.studio-suggestion-item.active');
            if (active) active.click();
            else hideSuggestions();
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            navigateSuggestions(e.key === 'ArrowDown' ? 1 : -1);
        }
        if (e.key === 'Escape') hideSuggestions();
    });

    document.addEventListener('click', (e) => {
        if (!studioInput.contains(e.target) && !suggestionsEl.contains(e.target)) {
            hideSuggestions();
        }
    });
}

async function searchStudios(query) {
    const suggestionsEl = document.getElementById('studio-suggestions');
    if (!suggestionsEl) return;

    try {
        const normalizedQuery = query.toUpperCase();
        const { data, error } = await _supabase
            .from('studios')
            .select('id, name, normalized_name')
            .ilike('normalized_name', `%${normalizedQuery}%`)
            .order('name')
            .limit(8);

        if (error) {
            console.error('Studio search error:', error);
            hideSuggestions();
            return;
        }

        studioSuggestionsCache = data || [];
        renderSuggestions(query);
    } catch (err) {
        console.error('Studio search failed:', err);
        hideSuggestions();
    }
}

function renderSuggestions(query) {
    const suggestionsEl = document.getElementById('studio-suggestions');
    if (!suggestionsEl) return;

    if (studioSuggestionsCache.length === 0) {
        suggestionsEl.innerHTML = `
            <div class="studio-suggestion-item studio-suggestion-new" data-action="create">
                Crear: "${query}"
            </div>`;
    } else {
        const exactMatch = studioSuggestionsCache.some(
            s => s.normalized_name === query.toUpperCase()
        );
        let html = studioSuggestionsCache.map(s => `
            <div class="studio-suggestion-item" data-id="${s.id}" data-name="${s.name}">
                ${s.name}
            </div>
        `).join('');

        if (!exactMatch) {
            html += `
                <div class="studio-suggestion-item studio-suggestion-new" data-action="create">
                    Crear: "${query}"
                </div>`;
        }
        suggestionsEl.innerHTML = html;
    }

    suggestionsEl.querySelectorAll('.studio-suggestion-item').forEach(item => {
        item.addEventListener('click', () => selectStudioSuggestion(item));
    });
    suggestionsEl.classList.add('visible');
}

function selectStudioSuggestion(item) {
    const studioInput = document.getElementById('studio_name');
    if (item.dataset.action === 'create') {
        formState.data.studio_id = null;
    } else {
        formState.data.studio_id = item.dataset.id;
        formState.data.studio_name = item.dataset.name;
        if (studioInput) studioInput.value = item.dataset.name;
    }
    hideSuggestions();
    scheduleDraftSync();
}

function hideSuggestions() {
    const el = document.getElementById('studio-suggestions');
    if (el) {
        el.classList.remove('visible');
        el.innerHTML = '';
    }
}

function navigateSuggestions(direction) {
    const el = document.getElementById('studio-suggestions');
    if (!el) return;
    const items = Array.from(el.querySelectorAll('.studio-suggestion-item'));
    if (!items.length) return;
    const activeIdx = items.findIndex(i => i.classList.contains('active'));
    items.forEach(i => i.classList.remove('active'));
    let nextIdx = activeIdx + direction;
    if (nextIdx < 0) nextIdx = items.length - 1;
    if (nextIdx >= items.length) nextIdx = 0;
    items[nextIdx].classList.add('active');
    items[nextIdx].scrollIntoView({ block: 'nearest' });
}

async function findOrCreateStudio(studioName) {
    if (!studioName) return null;
    const normalized = studioName.toUpperCase().trim();

    if (formState.data.studio_id) {
        return formState.data.studio_id;
    }

    const { data: existing, error: findErr } = await _supabase
        .from('studios')
        .select('id')
        .eq('normalized_name', normalized)
        .maybeSingle();

    if (findErr) {
        console.error('Error finding studio:', findErr);
        return null;
    }
    if (existing) return existing.id;

    const { data: created, error: createErr } = await _supabase
        .from('studios')
        .insert({ name: studioName.trim(), normalized_name: normalized })
        .select('id')
        .single();

    if (createErr) {
        if (createErr.code === '23505') {
            const { data: retry } = await _supabase
                .from('studios')
                .select('id')
                .eq('normalized_name', normalized)
                .single();
            return retry?.id || null;
        }
        console.error('Error creating studio:', createErr);
        return null;
    }
    return created.id;
}

let studioAutocompleteInitialized = false;

function selectWorkTypeOption(btn) {
    document.querySelectorAll('.work-type-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    formState.data.work_type = btn.dataset.type;
    
    const studioNameWrapper = document.getElementById('studio-name-wrapper');
    const studioNameInput = document.getElementById('studio_name');
    
    if (studioNameWrapper) {
        if (btn.dataset.type === 'studio' || btn.dataset.type === 'both') {
            studioNameWrapper.style.display = 'block';
            if (!studioAutocompleteInitialized) {
                initStudioAutocomplete();
                studioAutocompleteInitialized = true;
            }
            setTimeout(() => studioNameInput?.focus(), 100);
        } else {
            studioNameWrapper.style.display = 'none';
            formState.data.studio_name = '';
            formState.data.studio_id = null;
            if (studioNameInput) studioNameInput.value = '';
        }
    }
    scheduleDraftSync();
}

function selectNewsletterOption(btn) {
    document.querySelectorAll('.newsletter-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    formState.data.subscribed_newsletter = btn.dataset.subscribe === 'true';
    scheduleDraftSync();
}

function selectPortfolioSource(btn) {
    document.querySelectorAll('.portfolio-source-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    const source = btn.dataset.source;
    formState.data.portfolio_source = source;
    scheduleDraftSync();

    const urlWrapper = document.getElementById('portfolio-url-wrapper');
    const igWrapper = document.getElementById('portfolio-ig-wrapper');
    const urlLabel = document.getElementById('portfolio-url-label');
    const urlInput = document.getElementById('portfolio_url');
    const igInput = document.getElementById('instagram_handle');

    urlWrapper.style.display = 'none';
    igWrapper.style.display = 'none';

    if (source === 'website') {
        urlWrapper.style.display = 'block';
        urlLabel.textContent = 'URL de tu sitio web';
        urlInput.placeholder = 'https://tusitio.com';
        setTimeout(() => urlInput.focus(), 100);
    } else if (source === 'instagram') {
        igWrapper.style.display = 'block';
        setTimeout(() => igInput.focus(), 100);
    } else if (source === 'other') {
        urlWrapper.style.display = 'block';
        urlLabel.textContent = 'URL de tu portfolio o trabajo';
        urlInput.placeholder = 'https://...';
        setTimeout(() => urlInput.focus(), 100);
    }
}

// ============================================
// Navigation
// ============================================

function handleNext() {
    if (formState.currentStep === 'summary') {
        submitForm();
        return;
    }

    if (formState.currentStep === 'success') {
        return;
    }

    if (!validateCurrentStep()) {
        return;
    }

    saveCurrentStepData();
    // Force-flush the draft on step transition: the user is committing to advance,
    // and we don't want the debounce window to lose state if they close the tab now.
    // Fire-and-forget — the wizard advances regardless of network outcome, and a
    // failure here will surface via the consecutive-failures banner anyway.
    flushDraftSync();

    if (formState.currentStep < formState.totalSteps) {
        goToStep(formState.currentStep + 1);
    } else {
        goToStep('summary');
    }
}

function handleBack() {
    if (formState.currentStep === 'summary') {
        goToStep(formState.totalSteps);
        return;
    }

    if (formState.currentStep > 1) {
        goToStep(formState.currentStep - 1);
    }
}

function saveCurrentStepData() {
    const currentStepEl = document.querySelector(`.form-step[data-step="${formState.currentStep}"]`);
    if (!currentStepEl) return;

    if (formState.currentStep === 8) {
        const urlInput = document.getElementById('portfolio_url');
        const igInput = document.getElementById('instagram_handle');
        const source = formState.data.portfolio_source;
        if (source === 'website' || source === 'other') {
            formState.data.portfolio_url = urlInput ? urlInput.value : '';
        } else if (source === 'instagram') {
            formState.data.instagram_handle = igInput ? igInput.value.replace(/^@/, '') : '';
        }
        return;
    }

    const input = currentStepEl.querySelector('.form-input');
    if (input) {
        formState.data[input.id] = input.value;
    }
}

// ============================================
// Validation
// ============================================

function validateCurrentStep() {
    const step = formState.currentStep;
    let isValid = true;
    let errorElement = null;

    switch (step) {
        case 1:
            const artisticName = document.getElementById('artistic_name');
            if (!artisticName.value.trim()) {
                isValid = false;
                errorElement = artisticName;
            }
            break;

        case 2:
            const fullName = document.getElementById('full_name');
            if (!fullName.value.trim()) {
                isValid = false;
                errorElement = fullName;
            }
            break;

        case 3:
            const email = document.getElementById('email');
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!email.value.trim() || !emailRegex.test(email.value)) {
                isValid = false;
                errorElement = email;
            }
            break;

        case 4:
            const city = document.getElementById('city');
            if (!city.value.trim()) {
                isValid = false;
                errorElement = city;
            }
            break;

        case 5:
            if (formState.data.styles.length === 0) {
                isValid = false;
                const grid = document.getElementById('styles-grid');
                grid.style.animation = 'shake 0.5s ease';
                setTimeout(() => grid.style.animation = '', 500);
            }
            break;

        case 6:
            if (!formState.data.experience_years) {
                isValid = false;
                const options = document.getElementById('experience-options');
                options.style.animation = 'shake 0.5s ease';
                setTimeout(() => options.style.animation = '', 500);
            }
            break;

        case 7:
            const sessionPrice = document.getElementById('session_price');
            if (!sessionPrice.value || parseFloat(sessionPrice.value) <= 0) {
                isValid = false;
                errorElement = sessionPrice;
            }
            break;

        case 8: {
            const source = formState.data.portfolio_source;
            if (!source) {
                isValid = false;
                const options = document.getElementById('portfolio-source-options');
                options.style.animation = 'shake 0.5s ease';
                setTimeout(() => options.style.animation = '', 500);
                break;
            }
            if (source === 'website' || source === 'other') {
                const portfolioUrl = document.getElementById('portfolio_url');
                if (!portfolioUrl.value.trim()) {
                    isValid = false;
                    errorElement = portfolioUrl;
                } else {
                    try {
                        new URL(portfolioUrl.value);
                    } catch {
                        isValid = false;
                        errorElement = portfolioUrl;
                    }
                }
            } else if (source === 'instagram') {
                const igInput = document.getElementById('instagram_handle');
                if (!igInput.value.trim()) {
                    isValid = false;
                    errorElement = igInput;
                }
            }
            break;
        }

        case 9:
            // Bio is optional
            break;

        case 10:
            if (!formState.data.work_type) {
                isValid = false;
                const options = document.getElementById('work-type-options');
                options.style.animation = 'shake 0.5s ease';
                setTimeout(() => options.style.animation = '', 500);
            } else if ((formState.data.work_type === 'studio' || formState.data.work_type === 'both')) {
                // Require studio name for studio or both options
                const studioNameInput = document.getElementById('studio_name');
                if (!studioNameInput.value.trim()) {
                    isValid = false;
                    studioNameInput.classList.add('error');
                    studioNameInput.focus();
                } else {
                    formState.data.studio_name = studioNameInput.value.trim();
                }
            }
            break;

        case 11:
            const birthResult = validateBirthDateSelects();
            if (!birthResult.valid) {
                isValid = false;
                errorElement = birthResult.errorElement;
                alert(birthResult.message);
            }
            break;

        case 12:
            // Newsletter selection - at least one option must be selected
            const selectedNewsletter = document.querySelector('.newsletter-option.selected');
            if (!selectedNewsletter) {
                isValid = false;
                const options = document.getElementById('newsletter-options');
                options.style.animation = 'shake 0.5s ease';
                setTimeout(() => options.style.animation = '', 500);
            }
            break;
    }

    if (!isValid && errorElement) {
        errorElement.classList.add('error');
        errorElement.focus();
    }

    return isValid;
}

// ============================================
// Step Navigation & UI
// ============================================

function goToStep(step) {
    const currentStepEl = document.querySelector('.form-step.active');
    const direction = typeof step === 'number' && step > formState.currentStep ? 'forward' : 'backward';

    if (currentStepEl) {
        currentStepEl.classList.remove('active');
        if (direction === 'forward') {
            currentStepEl.classList.add('exit-left');
        }
        setTimeout(() => {
            currentStepEl.classList.remove('exit-left');
        }, 500);
    }

    formState.currentStep = step;

    setTimeout(() => {
        const newStepEl = document.querySelector(`.form-step[data-step="${step}"]`);
        if (newStepEl) {
            newStepEl.classList.add('active');

            const focusTarget = newStepEl.querySelector('.form-input') || newStepEl.querySelector('.birth-select');
            if (focusTarget) {
                setTimeout(() => focusTarget.focus(), 100);
            }
        }

        updateUI();

        if (step === 'summary') {
            populateSummary();
        }
    }, 100);
}

function injectMobileContinueBtn(stepEl) {
    document.querySelectorAll('.mobile-continue-btn').forEach(b => b.remove());
    if (!stepEl) return;

    const stepValue = stepEl.dataset.step;
    if (stepValue === 'success') return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mobile-continue-btn';

    if (stepValue === 'summary') {
        btn.classList.add('submit-btn');
        btn.innerHTML = `
            Confirmar
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square">
                <path d="M20 6L9 17l-5-5"/>
            </svg>`;
    } else {
        btn.innerHTML = `
            Continuar
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square">
                <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>`;
    }

    btn.addEventListener('click', handleNext);
    stepEl.appendChild(btn);
}

function updateUI() {
    const step = formState.currentStep;

    if (typeof step === 'number') {
        const progress = (step / formState.totalSteps) * 100;
        progressFill.style.width = `${progress}%`;
        progressLabel.textContent = `${String(step).padStart(2, '0')} / ${String(formState.totalSteps).padStart(2, '0')}`;
    } else if (step === 'summary') {
        progressFill.style.width = '100%';
        progressLabel.textContent = 'RESUMEN';
    } else if (step === 'success') {
        progressFill.style.width = '100%';
        progressLabel.textContent = 'LISTO';
    }

    if (typeof step === 'number') {
        if (step <= 4) {
            progressFill.style.background = 'var(--primary-red)';
        } else if (step <= 8) {
            progressFill.style.background = 'var(--primary-yellow)';
        } else {
            progressFill.style.background = 'var(--primary-blue)';
        }
    }

    if (step === 1 || step === 'success') {
        btnBack.style.visibility = 'hidden';
    } else {
        btnBack.style.visibility = 'visible';
    }

    if (step === 'summary') {
        btnNext.innerHTML = `
            Confirmar
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square">
                <path d="M20 6L9 17l-5-5"/>
            </svg>
        `;
        btnNext.classList.add('submit-btn');
    } else if (step === 'success') {
        document.querySelector('.register-footer').classList.add('hidden');
    } else {
        btnNext.innerHTML = `
            Siguiente
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square">
                <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
        `;
        btnNext.classList.remove('submit-btn');
    }

    const activeStep = document.querySelector('.form-step.active');
    if (activeStep) {
        injectMobileContinueBtn(activeStep);
    }
}

// ============================================
// Portfolio Link Resolver
// ============================================

function resolvePortfolioLinks(username) {
    const source = formState.data.portfolio_source;
    const profileUrl = window.location.origin + '/artist/profile?artist=' + encodeURIComponent(username);
    let portafolio = null;
    let instagram = null;
    let displayLabel = '';

    if (source === 'website' || source === 'other') {
        portafolio = formState.data.portfolio_url || null;
        displayLabel = portafolio || 'No especificado';
    } else if (source === 'instagram') {
        const handle = (formState.data.instagram_handle || '').replace(/^@/, '');
        instagram = '@' + handle;
        portafolio = 'https://www.instagram.com/' + handle + '/';
        displayLabel = '@' + handle + ' (Instagram)';
    } else if (source === 'none') {
        portafolio = profileUrl;
        displayLabel = 'Perfil We Otzi';
    }

    return { portafolio, instagram, profileUrl, displayLabel };
}

// ============================================
// Summary
// ============================================

function populateSummary() {
    const summaryCard = document.getElementById('summary-card');
    const data = formState.data;

    // Determine work type display value
    let workTypeDisplay;
    if (data.work_type === 'independent') {
        workTypeDisplay = 'Sin estudio/Independiente';
    } else if (data.work_type === 'studio') {
        workTypeDisplay = `Estudio: ${data.studio_name || '-'}`;
    } else if (data.work_type === 'both') {
        workTypeDisplay = `Ambos (Estudio: ${data.studio_name || '-'})`;
    } else {
        workTypeDisplay = '-';
    }

    const stylesHtml = data.styles.length > 0
        ? data.styles.map(s => `<span class="style-tag">${s}</span>`).join('')
        : '<span style="opacity: 0.5;">No especificado</span>';

    const usernamePreview = formatUsername(data.artistic_name);
    const fullNameCapitalized = capitalizeWords(data.full_name);

    // [CH-15] Format session price: Amount first, then currency
    const priceDisplay = data.session_price 
        ? `${data.session_price} ${data.session_currency}`
        : '<span style="opacity: 0.5;">No especificado</span>';

    // Format birth date as DD/MM/YYYY (Robust split/join to avoid INVALID DATE)
    let birthDateDisplay = '<span style="opacity: 0.5;">No especificado</span>';
    if (data.birth_date) {
        if (data.birth_date.includes('-')) {
            // Handle ISO format YYYY-MM-DD
            const [year, month, day] = data.birth_date.split('-');
            birthDateDisplay = `${day}/${month}/${year}`;
        } else if (data.birth_date.includes('/') && data.birth_date.length === 10) {
            // Handle DD/MM/YYYY format if it somehow got through
            birthDateDisplay = data.birth_date;
        }
    }

    // Newsletter status
    const newsletterDisplay = data.subscribed_newsletter 
        ? '<span style="color: #4CAF50;">Suscrito</span>'
        : '<span style="opacity: 0.5;">No suscrito</span>';

    summaryCard.innerHTML = `
        <div class="summary-row">
            <div class="summary-label">Nombre artistico</div>
            <div class="summary-value">${data.artistic_name || '-'}</div>
        </div>
        <div class="summary-row">
            <div class="summary-label">Username</div>
            <div class="summary-value" style="color: var(--primary-blue);">${usernamePreview || '-'}</div>
        </div>
        <div class="summary-row">
            <div class="summary-label">Nombre completo</div>
            <div class="summary-value">${fullNameCapitalized || '-'}</div>
        </div>
        <div class="summary-row">
            <div class="summary-label">Email</div>
            <div class="summary-value">${data.email || '-'}</div>
        </div>
        <div class="summary-row">
            <div class="summary-label">Ubicacion</div>
            <div class="summary-value">${data.city || '-'}</div>
        </div>
        <div class="summary-row">
            <div class="summary-label">Estilos</div>
            <div class="summary-value">${stylesHtml}</div>
        </div>
        <div class="summary-row">
            <div class="summary-label">Experiencia</div>
            <div class="summary-value">${data.experience_years || '-'} anos</div>
        </div>
        <div class="summary-row">
            <div class="summary-label">Tarifa por sesion</div>
            <div class="summary-value">${priceDisplay}</div>
        </div>
        <div class="summary-row">
            <div class="summary-label">Portfolio</div>
            <div class="summary-value">${resolvePortfolioLinks(usernamePreview).displayLabel || '<span style="opacity: 0.5;">No especificado</span>'}</div>
        </div>
        <div class="summary-row">
            <div class="summary-label">Bio</div>
            <div class="summary-value bio-value">${window.BioFormatting ? window.BioFormatting.sanitizeBioHtml(data.bio) || '<span style="opacity: 0.5;">No especificado</span>' : data.bio || '<span style="opacity: 0.5;">No especificado</span>'}</div>
        </div>
        <div class="summary-row">
            <div class="summary-label">Modalidad</div>
            <div class="summary-value">${workTypeDisplay}</div>
        </div>
        <div class="summary-row">
            <div class="summary-label">Fecha de nacimiento</div>
            <div class="summary-value">${birthDateDisplay}</div>
        </div>
        <div class="summary-row">
            <div class="summary-label">Newsletter</div>
            <div class="summary-value">${newsletterDisplay}</div>
        </div>
    `;
}

// ============================================
// Form Submission
// ============================================

async function submitForm() {
    if (!currentUser) {
        console.error('No authenticated user');
        return;
    }

    // Validate terms acceptance
    if (!formState.data.terms_accepted) {
        alert('Debes aceptar los terminos y condiciones para continuar.');
        const termsCheckbox = document.getElementById('terms-checkbox');
        if (termsCheckbox) {
            termsCheckbox.focus();
        }
        return;
    }

    btnNext.disabled = true;
    btnNext.innerHTML = `<span>Guardando...</span>`;

    try {
        const requestedReturnTo = window.ArtistAuth?.getReturnTo(window.location.search, '') || '';
        const authUrls = window.ArtistAuth?.getRouteUrls(window.ConfigManager, requestedReturnTo) || {
            registerClosedBeta: '/registerclosedbeta',
            dashboard: '/artist/dashboard'
        };
        const username = formatUsername(formState.data.artistic_name);
        const fullNameCapitalized = capitalizeWords(formState.data.full_name);

        // Check username availability before saving
        const usernameCheck = await checkUsernameAvailability(username, currentUser.id);
        if (!usernameCheck.available) {
            btnNext.disabled = false;
            btnNext.innerHTML = `
                Continuar
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
            `;
            alert(`El nombre artistico "${formState.data.artistic_name}" ya esta en uso. Por favor, elige otro nombre.`);
            // Go back to artistic name step
            goToStep(1);
            return;
        }

        // [CH-15] Format session price: Amount first, then currency
        const sessionPriceFormatted = formState.data.session_price 
            ? `${formState.data.session_price} ${formState.data.session_currency}`
            : null;

        // Resolve studio_id via find-or-create if needed
        let resolvedStudioId = null;
        let estudiosValue;
        if (formState.data.work_type === 'independent') {
            estudiosValue = 'Sin estudio/Independiente';
        } else if (formState.data.studio_name) {
            resolvedStudioId = await findOrCreateStudio(formState.data.studio_name);
            estudiosValue = formState.data.studio_name.toUpperCase();
        } else {
            estudiosValue = null;
        }

        // [CH-16] Get preset password from config for storage in artists_db
        const presetPassword = window.CONFIG?.registration?.presetPassword || '';

        // Final validation of birth_date to prevent "INVALID DATE" errors in DB
        let finalBirthDate = null;
        if (formState.data.birth_date && /^\d{4}-\d{2}-\d{2}$/.test(formState.data.birth_date)) {
            finalBirthDate = formState.data.birth_date;
        }

        const resolved = resolvePortfolioLinks(username);

        const artistData = {
            user_id: currentUser.id,
            email: formState.data.email,
            name: fullNameCapitalized,
            username: username,
            ubicacion: formState.data.city,
            city: formState.data.location_city || null,
            country: formState.data.location_country || null,
            styles_array: formState.data.styles,
            estilo: formState.data.styles.join(', '),
            portafolio: resolved.portafolio,
            instagram: resolved.instagram,
            bio_description: window.BioFormatting
                ? (window.BioFormatting.sanitizeBioHtml(formState.data.bio) || null)
                : (formState.data.bio || null),
            estudios: estudiosValue,
            studio_id: resolvedStudioId,
            work_type: formState.data.work_type || null,
            session_price: sessionPriceFormatted,
            birth_date: finalBirthDate,
            subscribed_newsletter: formState.data.subscribed_newsletter,
            years_experience: formState.data.experience_years || null,
            password: presetPassword
        };

        console.log('Saving artist data:', artistData);

        const { data, error } = await _supabase
            .from('artists_db')
            .upsert(artistData, {
                onConflict: 'user_id'
            })
            .select();

        if (error) {
            console.error('Supabase error details:', {
                message: error.message,
                details: error.details,
                hint: error.hint,
                code: error.code,
                status: error.status
            });
            
            // Handle specific error codes
            if (error.code === '23505' || error.status === 409) {
                // Unique constraint violation - likely username conflict
                throw new Error('USERNAME_CONFLICT');
            }
            throw error;
        }

        console.log('Artist profile saved successfully:', data);

        // The profile is now durably in artists_db, so the in-progress draft is
        // obsolete. Fire-and-forget — a stale draft row is harmless (gets
        // overwritten on the user's next visit) but cleaning it up keeps the
        // table tidy.
        clearRegistrationDraft();

        // [CH-15] Update Supabase Auth display_name metadata
        try {
            await _supabase.auth.updateUser({
                data: { display_name: fullNameCapitalized }
            });
            console.log('Auth display_name updated:', fullNameCapitalized);
        } catch (authError) {
            console.warn('Could not update auth display_name:', authError);
        }

        btnNext.disabled = false;
        goToStep('success');

        // Trigger n8n webhook for artist registration completed
        if (window.ConfigManager && typeof window.ConfigManager.sendN8NEvent === 'function') {
            try {
                await window.ConfigManager.sendN8NEvent('artist_registration_completed', {
                    // Account info
                    email: formState.data.email,
                    username: username,
                    password: presetPassword,
                    user_id: currentUser.id,
                    // Profile summary
                    name: fullNameCapitalized,
                    artistic_name: formState.data.artistic_name,
                    city: formState.data.location_city || formState.data.city,
                    country: formState.data.location_country || null,
                    ubicacion: formState.data.city || null,
                    // Styles
                    styles: formState.data.styles || [],
                    styles_text: (formState.data.styles || []).join(', '),
                    // Studio info
                    studio: estudiosValue,
                    work_type: formState.data.work_type || null,
                    // Pricing
                    session_price: sessionPriceFormatted,
                    session_price_amount: formState.data.session_price || null,
                    session_price_currency: formState.data.session_currency || null,
                    // Experience
                    years_experience: formState.data.experience_years || null,
                    // Bio and portfolio
                    bio: formState.data.bio || null,
                    portfolio_url: resolved.portafolio,
                    instagram: resolved.instagram,
                    portfolio_source: formState.data.portfolio_source || null,
                    // Personal info
                    birth_date: finalBirthDate,
                    subscribed_newsletter: formState.data.subscribed_newsletter || false,
                    // URLs
                    dashboard_url: window.location.origin + authUrls.dashboard,
                    profile_url: resolved.profileUrl,
                    login_url: window.location.origin + authUrls.registerClosedBeta
                });
                console.log('n8n event sent: artist_registration_completed');
            } catch (webhookErr) {
                console.warn('Could not send artist_registration_completed event:', webhookErr);
            }
        }

        // Auto-redirect to dashboard after 3 seconds
        setTimeout(() => {
            window.location.href = requestedReturnTo || authUrls.dashboard;
        }, 3000);

    } catch (error) {
        console.error('Error saving artist profile:', error);
        btnNext.disabled = false;
        btnNext.innerHTML = `
            Continuar
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square">
                <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
        `;
        
        // Handle specific error types
        if (error.message === 'USERNAME_CONFLICT') {
            alert(`El nombre artistico "${formState.data.artistic_name}" ya esta en uso por otro artista. Por favor, elige otro nombre.`);
            goToStep(1);
        } else {
            alert('Error al guardar el perfil. Por favor, intenta de nuevo.');
        }
    }
}

// ============================================
// Scroll Indicator
// ============================================

function initScrollIndicator() {
    const formWrapper = document.querySelector('.form-wrapper');
    const scrollIndicator = document.getElementById('scroll-indicator');
    
    if (!formWrapper || !scrollIndicator) return;

    function checkScroll() {
        const isScrollable = formWrapper.scrollHeight > formWrapper.clientHeight;
        const isAtBottom = formWrapper.scrollTop + formWrapper.clientHeight >= formWrapper.scrollHeight - 20;
        
        if (isScrollable && !isAtBottom) {
            scrollIndicator.classList.add('visible');
        } else {
            scrollIndicator.classList.remove('visible');
        }
    }

    formWrapper.addEventListener('scroll', checkScroll);
    window.addEventListener('resize', checkScroll);
    
    // Check on step change
    const observer = new MutationObserver(() => {
        setTimeout(checkScroll, 200);
    });
    
    observer.observe(formWrapper, { childList: true, subtree: true, attributes: true });
    
    // Initial check
    setTimeout(checkScroll, 500);
}

// Initialize scroll indicator after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initScrollIndicator, 100);
    initRichTextEditor();
});

// [CH-11] START: Rich Text Bio Editor Initialization
// Sets up the Bauhaus-style toolbar and contenteditable area
function initRichTextEditor() {
    const bioEditor = document.getElementById('bio');
    const toolbar = document.querySelector('.bio-toolbar');
    const emojiPicker = document.getElementById('emoji-picker');
    const emojiTrigger = document.getElementById('emoji-trigger');
    
    if (!bioEditor || !toolbar) return;

    // Preserve selection on iOS Safari: prevent focus loss when tapping toolbar buttons.
    // mousedown fires before the contenteditable loses focus, so preventDefault here
    // keeps the selection intact for execCommand to work correctly.
    toolbar.addEventListener('mousedown', (e) => {
        const btn = e.target.closest('.toolbar-btn');
        if (btn) e.preventDefault();
    });
    toolbar.addEventListener('touchstart', (e) => {
        const btn = e.target.closest('.toolbar-btn');
        // Don't preventDefault on color-btn: the native color picker needs the touch
        if (btn && !btn.classList.contains('color-btn')) {
            e.preventDefault();
        }
    }, { passive: false });

    // Handle toolbar button clicks
    toolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('.toolbar-btn');
        if (!btn) return;
        
        e.preventDefault();
        const command = btn.dataset.command;
        
        if (!command) return;
        
        // Handle special commands
        if (command === 'createLink') {
            const url = prompt('Ingresa la URL del enlace:', 'https://');
            if (url) {
                document.execCommand(command, false, url);
            }
        } else if (command === 'foreColor' || command === 'hiliteColor') {
            // Color commands are handled by the color input
            return;
        } else {
            document.execCommand(command, false, null);
        }
        
        // Sync content to form state
        syncBioContent();
        
        // Refocus editor
        bioEditor.focus();
    });
    
    // Handle color picker changes
    // We save/restore the selection because opening a color input steals focus
    // from the contenteditable, clearing the selection on iOS Safari.
    const textColorPicker = document.getElementById('text-color-picker');
    const bgColorPicker = document.getElementById('bg-color-picker');
    let savedSelection = null;

    function saveSelection() {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            savedSelection = sel.getRangeAt(0).cloneRange();
        }
    }

    function restoreSelection() {
        if (savedSelection) {
            bioEditor.focus();
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(savedSelection);
        }
    }

    // Save selection when color button is focused (before picker opens)
    if (textColorPicker) {
        textColorPicker.addEventListener('focus', saveSelection);
        textColorPicker.addEventListener('input', (e) => {
            restoreSelection();
            document.execCommand('foreColor', false, e.target.value);
            syncBioContent();
        });
    }

    if (bgColorPicker) {
        bgColorPicker.addEventListener('focus', saveSelection);
        bgColorPicker.addEventListener('input', (e) => {
            restoreSelection();
            // iOS Safari uses 'backColor'; other browsers use 'hiliteColor'
            const cmd = document.queryCommandSupported
                && document.queryCommandSupported('hiliteColor') ? 'hiliteColor' : 'backColor';
            document.execCommand(cmd, false, e.target.value);
            syncBioContent();
        });
    }

    // Also save selection whenever the bio editor loses focus
    bioEditor.addEventListener('blur', saveSelection);
    
    // Handle emoji picker toggle
    if (emojiTrigger && emojiPicker) {
        emojiTrigger.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            emojiPicker.classList.toggle('active');
        });
        
        // Close emoji picker when clicking outside
        document.addEventListener('click', (e) => {
            if (!emojiPicker.contains(e.target) && e.target !== emojiTrigger) {
                emojiPicker.classList.remove('active');
            }
        });
    }
    
    // Handle emoji selection
    if (emojiPicker) {
        emojiPicker.addEventListener('click', (e) => {
            const emojiBtn = e.target.closest('.emoji-item');
            if (emojiBtn) {
                e.preventDefault();
                insertTextAtCaret(emojiBtn.textContent);
                syncBioContent();
                emojiPicker.classList.remove('active');
                bioEditor.focus();
            }
        });
    }
    
    // Sync content on input
    bioEditor.addEventListener('input', syncBioContent);
    
    // Prevent Enter from submitting form
    bioEditor.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.stopPropagation();
        }
    });
}

// Insert text at current caret position
function insertTextAtCaret(text) {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
    }
}

// Sync bio content to form state (sanitized)
function syncBioContent() {
    const bioEditor = document.getElementById('bio');
    if (bioEditor) {
        const raw = bioEditor.innerHTML;
        formState.data.bio = window.BioFormatting
            ? window.BioFormatting.sanitizeBioHtml(raw)
            : raw;
        scheduleDraftSync();
    }
}
// [CH-11] END

// ============================================
// Theme Toggle
// ============================================

function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const btn = document.querySelector('.theme-toggle');
    btn.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-yellow');
    setTimeout(() => {
        btn.style.backgroundColor = '';
    }, 300);
}

// ============================================
// [CH-15] Global Zoom Controls
// ============================================

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.2;
const ZOOM_STEP = 0.1;

function getCurrentZoom() {
    const root = document.documentElement;
    const currentZoom = getComputedStyle(root).getPropertyValue('--zoom-factor');
    return parseFloat(currentZoom) || 0.8;
}

function setZoom(factor) {
    const clampedFactor = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, factor));
    document.documentElement.style.setProperty('--zoom-factor', clampedFactor);
    // Store preference in localStorage
    localStorage.setItem('weotzi-zoom', clampedFactor);
}

function zoomIn() {
    const currentZoom = getCurrentZoom();
    setZoom(currentZoom + ZOOM_STEP);
}

function zoomOut() {
    const currentZoom = getCurrentZoom();
    setZoom(currentZoom - ZOOM_STEP);
}

// Restore zoom preference on page load
function restoreZoomPreference() {
    const savedZoom = localStorage.getItem('weotzi-zoom');
    if (savedZoom) {
        setZoom(parseFloat(savedZoom));
    }
}

// Initialize zoom on load
document.addEventListener('DOMContentLoaded', restoreZoomPreference);
