// ============================================
// WE ÖTZI - Artist Registration Form Logic
// Typeform-style step navigation with Bauhaus aesthetic
// Connected to Supabase artists_db
// ============================================

// Supabase Configuration - Uses config-manager.js (provides window.CONFIG)
const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = (window._supabase = window._supabase || supabase.createClient(supabaseUrl, supabaseKey));

// Note: the historical `resolvePresetPassword()` / `DEFAULT_ARTIST_PASSWORD`
// helpers used to seed every new artist with the shared "OtziArtist2025"
// password. They were removed when the wizard switched to per-user passwords
// (captured via the signup_password field) — there is no longer any
// codepath that should fall back to a hardcoded value.

// Current user session
let currentUser = null;
let loadedArtistRecord = null;
let registrationDraftId = null;
let registrationSource = 'manual';
let registrationDraftSyncTimer = null;
let registrationDraftSyncInFlight = false;
let registrationDraftSyncPending = false;
let registrationDraftLocalVersion = 0;
const REGISTRATION_DRAFT_CONTEXT_KEY = 'wo:artist-registration:active-draft';

// Google Places Autocomplete instance
let placesAutocomplete = null;

// Form State
const formState = {
    currentStep: 1,
    totalSteps: 11,
    data: {
        artistic_name: '',
        full_name: '',
        email: '',
        signup_password: '',
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
        studio_location_id: null,
        studio_location_label: '',
        address: null,
        birth_date: '',
        subscribed_newsletter: null,
        terms_accepted: false
    }
};

const REGISTRATION_DRAFT_STORAGE_PREFIX = 'wo:artist-registration:draft:v1';
const REGISTRATION_DRAFT_FIELDS = [
    'artistic_name',
    'full_name',
    'email',
    'city',
    'location_city',
    'location_country',
    'styles',
    'experience_years',
    'session_price',
    'session_currency',
    'portfolio_source',
    'portfolio_url',
    'instagram_handle',
    'bio',
    'work_type',
    'studio_name',
    'studio_id',
    'studio_location_id',
    'studio_location_label',
    'address',
    'birth_date',
    'subscribed_newsletter',
    'terms_accepted'
];
const REGISTRATION_DRAFT_BOOLEAN_FIELDS = new Set(['subscribed_newsletter', 'terms_accepted']);
const REGISTRATION_DRAFT_NULLABLE_FIELDS = new Set(['studio_id', 'studio_location_id', 'address']);

function getRegistrationDraftStorageKey() {
    if (registrationDraftId) return `${REGISTRATION_DRAFT_STORAGE_PREFIX}:draft:${registrationDraftId}`;
    if (currentUser?.id) return `${REGISTRATION_DRAFT_STORAGE_PREFIX}:user:${currentUser.id}`;
    return null;
}

function buildRegistrationDraftPayload() {
    const data = {};
    REGISTRATION_DRAFT_FIELDS.forEach((field) => {
        const value = formState.data[field];
        if (Array.isArray(value)) {
            data[field] = [...value];
        } else {
            data[field] = value;
        }
    });

    return {
        version: 1,
        userId: currentUser?.id || null,
        draftId: registrationDraftId || null,
        source: registrationSource,
        step: typeof formState.currentStep === 'number' ? formState.currentStep : null,
        savedAt: Date.now(),
        data
    };
}

function persistRegistrationDraft() {
    const storageKey = getRegistrationDraftStorageKey();
    if (!storageKey) return;
    registrationDraftLocalVersion += 1;

    try {
        const payload = buildRegistrationDraftPayload();
        localStorage.setItem(storageKey, JSON.stringify(payload));
        scheduleRegistrationDraftSync();
    } catch (error) {
        console.warn('Could not persist registration draft:', error);
    }
}

function applyRegistrationDraftData(draftData) {
    if (!draftData || typeof draftData !== 'object') return;

    REGISTRATION_DRAFT_FIELDS.forEach((field) => {
        if (!Object.prototype.hasOwnProperty.call(draftData, field)) return;

        const value = draftData[field];

        if (field === 'styles') {
            formState.data.styles = Array.isArray(value)
                ? value.filter(item => typeof item === 'string' && item.trim().length > 0)
                : [];
            return;
        }

        if (field === 'session_price') {
            formState.data.session_price = normalizeSessionPriceAmount(value);
            return;
        }

        if (field === 'session_currency') {
            formState.data.session_currency = String(value || '').trim().toUpperCase() || 'USD';
            return;
        }

        if (REGISTRATION_DRAFT_BOOLEAN_FIELDS.has(field)) {
            if (typeof value === 'boolean') {
                formState.data[field] = value;
            } else if (field === 'subscribed_newsletter' && value === null) {
                formState.data[field] = null;
            }
            return;
        }

        if (REGISTRATION_DRAFT_NULLABLE_FIELDS.has(field)) {
            if (field === 'address' && (value === null || (value && typeof value === 'object'))) {
                formState.data[field] = value;
            }
            if (field !== 'address' && (value === null || typeof value === 'string')) {
                formState.data[field] = value;
            }
            return;
        }

        if (typeof value === 'string') {
            formState.data[field] = value;
        }
    });
}

function restoreRegistrationDraft() {
    const storageKey = getRegistrationDraftStorageKey();
    if (!storageKey) return null;

    try {
        const rawDraft = localStorage.getItem(storageKey);
        if (!rawDraft) return null;

        const parsedDraft = JSON.parse(rawDraft);
        if (!parsedDraft || typeof parsedDraft !== 'object') return null;
        if (registrationDraftId && parsedDraft.draftId !== registrationDraftId) return null;
        if (!registrationDraftId && currentUser?.id && parsedDraft.userId !== currentUser.id) return null;

        applyRegistrationDraftData(parsedDraft.data);

        const parsedStep = Number.parseInt(String(parsedDraft.step || ''), 10);
        if (Number.isInteger(parsedStep) && parsedStep >= 1 && parsedStep <= formState.totalSteps) {
            return parsedStep;
        }
    } catch (error) {
        console.warn('Could not restore registration draft:', error);
    }

    return null;
}

function clearRegistrationDraft() {
    const storageKey = getRegistrationDraftStorageKey();
    if (!storageKey) return;

    try {
        localStorage.removeItem(storageKey);
    } catch (error) {
        console.warn('Could not clear registration draft:', error);
    }
}

function getRegistrationDraftContext() {
    const params = new URLSearchParams(window.location.search || '');
    const draft = params.get('draft') || params.get('draft_id') || '';
    const source = params.get('source') || '';
    const email = params.get('email') || '';
    return {
        draftId: /^[0-9a-f-]{36}$/i.test(draft) ? draft : '',
        source: source ? source.toLowerCase() : '',
        email: email ? email.trim().toLowerCase() : ''
    };
}

function rememberRegistrationDraft(draftId) {
    if (!draftId) return;
    registrationDraftId = draftId;
    try {
        localStorage.setItem(REGISTRATION_DRAFT_CONTEXT_KEY, JSON.stringify({
            draftId,
            source: registrationSource,
            savedAt: Date.now()
        }));
    } catch (_) {}

    try {
        const url = new URL(window.location.href);
        if (!url.searchParams.get('draft')) {
            url.searchParams.set('draft', draftId);
            window.history.replaceState({}, '', url.toString());
        }
    } catch (_) {}
}

function normalizeSessionPriceAmount(value) {
    if (value === null || value === undefined) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    const normalizedRaw = raw.replace(',', '.');
    const numericMatch = normalizedRaw.match(/\d+(?:\.\d+)?/);
    return numericMatch ? numericMatch[0] : raw.replace(/\s+[A-Z]{3}$/i, '').trim();
}

function extractSessionPriceCurrency(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/\b([A-Z]{3})$/i);
    return match ? match[1].toUpperCase() : '';
}

function applyArtistDraftFromServer(artist) {
    if (!artist || typeof artist !== 'object') return;
    loadedArtistRecord = artist;
    if (artist.registration_draft_id) rememberRegistrationDraft(artist.registration_draft_id);
    if (artist.registration_source) registrationSource = artist.registration_source;

    formState.data.email = artist.email || formState.data.email || '';
    formState.data.artistic_name = artist.username ? artist.username.replace(/\.wo$/i, '') : formState.data.artistic_name;
    formState.data.full_name = artist.name || formState.data.full_name;
    formState.data.city = artist.city || artist.ubicacion || formState.data.city;
    formState.data.location_city = artist.city || formState.data.location_city;
    formState.data.location_country = artist.country || formState.data.location_country;
    formState.data.styles = Array.isArray(artist.styles_array) ? artist.styles_array : formState.data.styles;
    formState.data.portfolio_url = artist.portafolio || formState.data.portfolio_url;
    formState.data.instagram_handle = (artist.instagram || formState.data.instagram_handle || '').replace(/^@/, '');
    if (artist.instagram) formState.data.portfolio_source = 'instagram';
    if (!artist.instagram && artist.portafolio) formState.data.portfolio_source = 'website';
    formState.data.bio = artist.bio_description || formState.data.bio;
    const serverSessionPrice = normalizeSessionPriceAmount(artist.session_price_amount ?? artist.session_price);
    if (serverSessionPrice) formState.data.session_price = serverSessionPrice;
    formState.data.session_currency = artist.session_price_currency
        || extractSessionPriceCurrency(artist.session_price)
        || formState.data.session_currency
        || 'USD';
    formState.data.birth_date = artist.birth_date || formState.data.birth_date;
    formState.data.subscribed_newsletter = typeof artist.subscribed_newsletter === 'boolean'
        ? artist.subscribed_newsletter
        : null;
    formState.data.experience_years = artist.years_experience || formState.data.experience_years;
    formState.data.work_type = artist.work_type || formState.data.work_type;
    formState.data.studio_id = artist.studio_id || formState.data.studio_id;
    formState.data.studio_name = artist.estudios && artist.estudios !== 'Sin estudio/Independiente'
        ? artist.estudios
        : formState.data.studio_name;
}

async function loadRegistrationDraftFromServer() {
    if (!registrationDraftId && !formState.data.email) return false;

    try {
        const params = new URLSearchParams();
        if (registrationDraftId) params.set('draft', registrationDraftId);
        if (formState.data.email) params.set('email', formState.data.email);
        const res = await fetch(apiUrl(`/api/register/artist-draft?${params.toString()}`));
        const payload = await readJsonResponse(res);
        if (!res.ok || !payload.success || !payload.artist) return false;
        applyArtistDraftFromServer(payload.artist);
        return true;
    } catch (error) {
        console.warn('[register] Could not load registration draft:', error.message || error);
        return false;
    }
}

async function saveRegistrationDraftToServer(options = {}) {
    if (!formState.preAuthMode) return null;
    if (registrationDraftSyncInFlight && !options.force) {
        registrationDraftSyncPending = true;
        return null;
    }

    const syncVersion = registrationDraftLocalVersion;
    registrationDraftSyncInFlight = true;
    try {
        prepareRegistrationLocationData();
        const res = await fetch(apiUrl('/api/register/artist-draft'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                draft_id: registrationDraftId,
                source: registrationSource,
                step: typeof formState.currentStep === 'number' ? formState.currentStep : null,
                email: formState.data.email,
                data: { ...formState.data, registration_source: registrationSource }
            })
        });
        const payload = await readJsonResponse(res);
        if (!res.ok || !payload.success) throw new Error(payload.error || 'Draft save failed');
        rememberRegistrationDraft(payload.draft_id);
        const hasNewerLocalChanges = registrationDraftLocalVersion !== syncVersion;
        if (payload.artist && !hasNewerLocalChanges) {
            applyArtistDraftFromServer(payload.artist);
        } else if (payload.artist) {
            loadedArtistRecord = payload.artist;
        }
        return payload;
    } catch (error) {
        console.warn('[register] Could not sync registration draft:', error.message || error);
        return null;
    } finally {
        registrationDraftSyncInFlight = false;
        if (!options.force && (registrationDraftSyncPending || registrationDraftLocalVersion !== syncVersion)) {
            registrationDraftSyncPending = false;
            clearTimeout(registrationDraftSyncTimer);
            registrationDraftSyncTimer = setTimeout(() => {
                saveRegistrationDraftToServer();
            }, 0);
        }
    }
}

function scheduleRegistrationDraftSync() {
    if (!formState.preAuthMode || !registrationDraftId) return;
    clearTimeout(registrationDraftSyncTimer);
    registrationDraftSyncTimer = setTimeout(() => {
        saveRegistrationDraftToServer();
    }, 650);
}

// Studio autocomplete state
let studioSearchTimeout = null;
let studioSuggestionsCache = [];
let studioLocationsCache = [];

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

function getAppBasePath() {
    if (typeof window === 'undefined') return '';
    if (window.WEOTZI_BASE_PATH) return String(window.WEOTZI_BASE_PATH).replace(/\/$/, '');
    const path = window.location?.pathname || '';
    return path === '/beta' || path.startsWith('/beta/') ? '/beta' : '';
}

function appUrl(path) {
    const normalized = String(path || '').startsWith('/') ? String(path || '') : '/' + String(path || '');
    const basePath = getAppBasePath();
    if (basePath && (normalized === basePath || normalized.startsWith(basePath + '/'))) {
        return normalized;
    }
    return basePath + normalized;
}

function apiUrl(path) {
    return appUrl(path);
}

async function readJsonResponse(res) {
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : {};
    } catch (_) {
        return {
            success: false,
            error: `Respuesta invalida del servidor (${res.status}). Verifica que la API este activa en ${apiUrl('/api/instagram/preview')}.`
        };
    }
}

// [CH-10] START: Google Maps Places API Integration
// [CH-15] Updated to use full formatted_address from Google Maps
// Handles address autocomplete and reverse geocoding for geolocation
function initGooglePlaces() {
    const cityInput = document.getElementById('city');
    if (!cityInput || typeof google === 'undefined') return;
    if (!google.maps || !google.maps.places || !google.maps.places.Autocomplete) {
        console.warn('Google Places Autocomplete is not available; address autocomplete disabled.');
        return;
    }

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

            persistRegistrationDraft();
            updateLocationPlainPreview();
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
                persistRegistrationDraft();
                updateLocationPlainPreview();
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
    return String(str)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/(^|[\s'-])\p{L}/gu, match => match.toUpperCase());
}

function normalizeArtistHandle(artisticName) {
    if (!artisticName) return '';
    return String(artisticName)
        .trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\.wo$/i, '')
        .replace(/[^a-z0-9]+/g, '')
        .slice(0, 30);
}

// Format artistic name to username (no spaces, no special chars, ending in .wo)
function formatUsername(artisticName) {
    const username = normalizeArtistHandle(artisticName);
    return username ? username + '.wo' : '';
}
// [CH-09] END

function getDisplayAddress(address) {
    if (!address || typeof address !== 'object') return '';
    return address.formatted_address
        || [address.street && address.street_number ? `${address.street} ${address.street_number}` : address.street, address.city || address.locality, address.state_province, address.country]
            .filter(Boolean)
            .join(', ');
}

function getAddressCity(address) {
    if (!address || typeof address !== 'object') return '';
    return String(address.city || address.locality || '').trim();
}

function getAddressCountry(address) {
    if (!address || typeof address !== 'object') return '';
    return String(address.country || '').trim();
}

function syncLocationFieldsFromAddress(address) {
    const city = getAddressCity(address);
    const country = getAddressCountry(address);
    formState.data.location_city = city;
    formState.data.location_country = country;
    formState.data.city = city;
}

function getRegistrationCity() {
    return getAddressCity(formState.data.address)
        || String(formState.data.location_city || formState.data.city || '').trim();
}

function getRegistrationCountry() {
    return getAddressCountry(formState.data.address)
        || String(formState.data.location_country || '').trim();
}

function prepareRegistrationLocationData() {
    if (formState.data.address && typeof formState.data.address === 'object') {
        syncLocationFieldsFromAddress(formState.data.address);
        return;
    }
    formState.data.city = getRegistrationCity();
    formState.data.location_country = getRegistrationCountry();
}

function updateLocationPlainPreview() {
    const preview = document.getElementById('location-plain');
    if (!preview) return;
    const value = String(formState.data.city || document.getElementById('city')?.value || '').trim();
    const target = preview.querySelector('strong');
    if (target) target.textContent = value;
    preview.hidden = !value;
}

function updateStudioAddressPreview(addressText) {
    const preview = document.getElementById('studio-address-preview');
    if (!preview) return;
    const text = String(addressText || getDisplayAddress(formState.data.address) || '').trim();
    const target = preview.querySelector('strong');
    if (target) target.textContent = text;
    preview.hidden = !text;
}

const COMMON_PASSWORDS = new Set([
    'password', 'password1', 'password123', '123456', '1234567', '12345678', '123456789', '1234567890',
    'qwerty', 'qwerty123', 'qwertyuiop', 'admin123', 'admin1234', 'letmein', 'letmein123', 'welcome123',
    'iloveyou', 'abc123456', '11111111', '00000000', 'otziartist2025',
    'weotzi2025', 'weotzi123', 'contraseña', 'contrasena', 'contrasena123'
]);

function hasSequentialPasswordPattern(password) {
    const text = String(password || '').toLowerCase();
    const compact = text.replace(/[^a-z0-9]/g, '');
    if (!compact) return false;
    return /(.)\1{3,}/.test(compact)
        || 'abcdefghijklmnopqrstuvwxyz'.includes(compact)
        || '0123456789'.includes(compact)
        || 'qwertyuiopasdfghjklzxcvbnm'.includes(compact);
}

function evaluatePasswordStrength(password) {
    const value = String(password || '');
    const lower = value.toLowerCase();
    const normalizedEmail = String(formState.data.email || '').split('@')[0]?.toLowerCase() || '';
    const normalizedArtist = normalizeArtistHandle(formState.data.artistic_name);
    const normalizedFullName = normalizeArtistHandle(formState.data.full_name);
    const common = COMMON_PASSWORDS.has(lower) || hasSequentialPasswordPattern(value);
    const personal = [normalizedEmail, normalizedArtist, normalizedFullName]
        .filter(v => v && v.length >= 4)
        .some(v => lower.includes(v));

    const checks = {
        length: value.length >= 6,
        case: /[a-z]/.test(value) && /[A-Z]/.test(value),
        number: /\d/.test(value),
        symbol: /[^A-Za-z0-9]/.test(value),
        common: !common && !personal
    };
    const score = Object.values(checks).filter(Boolean).length;
    const valid = score === 5;
    const label = !value
        ? 'Usa una mezcla dificil de adivinar.'
        : valid
            ? 'Contraseña segura.'
            : score >= 3
                ? 'Casi lista: faltan requisitos.'
                : 'Contraseña demasiado debil.';
    return { valid, score, checks, label };
}

function updatePasswordFeedback() {
    const pw = document.getElementById('signup_password');
    const pw2 = document.getElementById('signup_password_confirm');
    const fill = document.getElementById('password-strength-fill');
    const text = document.getElementById('password-strength-text');
    const match = document.getElementById('password-match-hint');
    const result = evaluatePasswordStrength(pw?.value || '');

    if (fill) {
        fill.style.width = `${Math.max(0, result.score) * 20}%`;
        fill.style.background = result.valid ? 'var(--blue)' : result.score >= 3 ? 'var(--yellow)' : 'var(--red)';
    }
    if (text) text.textContent = result.label;
    Object.entries(result.checks).forEach(([rule, ok]) => {
        const el = document.querySelector(`#password-rules [data-rule="${rule}"]`);
        if (el) {
            el.classList.toggle('is-ok', ok);
            el.textContent = (ok ? '✓ ' : '· ') + el.textContent.replace(/^[✓·]\s*/, '');
        }
    });

    if (match && pw2) {
        if (!pw2.value) {
            match.textContent = 'Repite la contraseña para confirmar.';
            match.style.color = '';
        } else if (pw?.value === pw2.value) {
            match.textContent = '✓ Las contraseñas coinciden.';
            match.style.color = 'var(--ink)';
        } else {
            match.textContent = 'Las contraseñas no coinciden.';
            match.style.color = 'var(--red)';
        }
    }
    return result;
}

function validateSignupPasswordFields() {
    const pw = document.getElementById('signup_password');
    const pw2 = document.getElementById('signup_password_confirm');
    const pwVal = String(pw?.value || '');
    const pw2Val = String(pw2?.value || '');
    const strength = updatePasswordFeedback();
    if (!strength.valid) {
        showPasswordError('La contraseña debe tener 6+ caracteres, mayusculas, minusculas, numero, simbolo y no ser comun.');
        return { valid: false, element: pw };
    }
    if (pwVal !== pw2Val) {
        showPasswordError('Las contraseñas no coinciden.');
        return { valid: false, element: pw2 };
    }
    formState.data.signup_password = pwVal;
    return { valid: true };
}

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
    const latestAdultBirthYear = currentYear - 18;
    for (let y = latestAdultBirthYear; y >= 1920; y--) {
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
        persistRegistrationDraft();
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
        const startOverRequested = isStartOverRequested(window.location.search || '');
        const igSignupPreAuth = isInstagramSignup();
        let restoredDraftStep = null;
        let loadedRemoteDraft = false;
        const draftContext = getRegistrationDraftContext();
        if (draftContext.draftId) registrationDraftId = draftContext.draftId;
        if (draftContext.source) registrationSource = draftContext.source;
        if (igSignupPreAuth) registrationSource = 'instagram';
        if (draftContext.email) formState.data.email = draftContext.email;
        const hasDraftContext = Boolean(registrationDraftId || draftContext.source || draftContext.email);
        const { data: { session }, error } = await _supabase.auth.getSession();

        if (error) throw error;

        // IG signup ALWAYS runs as a fresh registration — even if there's
        // an active session in this browser. We treat it as pre-auth and
        // ignore the existing user. Reasons:
        //   1) the person at the keyboard may not be the one who logged in
        //      previously (managers registering an artist, shared device);
        //   2) assuming someone else's email creates duplicate-account chaos.
        // We don't signOut() because that would invalidate sessions in
        // other tabs. Final Auth creation happens server-side without
        // creating a browser session.
        const treatAsPreAuth = igSignupPreAuth || hasDraftContext || !session;

        if (!session && !igSignupPreAuth && !hasDraftContext) {
            console.log('No authenticated session found. Redirecting to login...');
            window.location.href = authUrls.login;
            return;
        }

        if (treatAsPreAuth) {
            console.log('IG pre-auth flow — wizard collects email/password as if anonymous.');
            formState.preAuthMode = true;
            if (!startOverRequested) {
                restoredDraftStep = restoreRegistrationDraft();
                if (!restoredDraftStep && registrationDraftId) {
                    loadedRemoteDraft = await loadRegistrationDraftFromServer();
                }
            }
            if (!registrationDraftId || restoredDraftStep || !loadedRemoteDraft) {
                await saveRegistrationDraftToServer({ force: true });
            }
            // Don't pre-fill email from any prior session; force the user
            // to type it themselves on Step 3.
        } else if (session) {
            currentUser = session.user;
            console.log('User authenticated:', currentUser.email);

            formState.data.email = currentUser.email;
            const emailInput = document.getElementById('email');
            if (emailInput) {
                emailInput.value = currentUser.email;
                emailInput.readOnly = true;
                emailInput.style.opacity = '0.7';
            }
        }

        // Only load the existing artist row when we actually trust the
        // session (non-IG flow). In IG signup we explicitly want a clean
        // wizard, even if the prior session belongs to someone with a row.
        if (session && !treatAsPreAuth) await loadExistingArtistData();
        await loadAndRenderStylesFromDB();
        if (startOverRequested) {
            resetFormDataForStartOver(session && currentUser ? currentUser.email : formState.data.email);
            loadedArtistRecord = null;
            clearRegistrationDraft();
        }
        const draftStep = startOverRequested ? null : (restoredDraftStep || restoreRegistrationDraft());
        prefillFormInputs();
        const igSignup = isInstagramSignup();
        const resumeStep = startOverRequested ? (igSignup ? 0 : 1) : (draftStep || resolveRegistrationResumeStep());

        initializeForm();
        setupEventListeners();
        setupBirthDateSelects();
        prefillBirthDateSelects();
        setupIGStep0();
        setupPortfolioMediaUI();
        seedPortfolioMediaFromIG();
        renderPortfolioMediaGrid();
        renderPortfolioMediaModalGrid();
        updatePreAuthFieldsVisibility();
        updateUI();

        // IG-signup users: jump to the dedicated Step 0 (which is hidden by
        // default for everyone else). Others follow the normal resume logic.
        const targetStep = igSignup && !startOverRequested ? 0 : resumeStep;
        if (targetStep === 0) {
            goToStep(0);
        } else if (targetStep > 1 && targetStep <= formState.totalSteps) {
            goToStep(targetStep);
        }

        persistRegistrationDraft();

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
            loadedArtistRecord = null;
            return;
        }

        if (artist) {
            loadedArtistRecord = artist;
            formState.data.artistic_name = artist.username ? artist.username.replace(/\.wo$/, '') : '';
            formState.data.full_name = artist.name || '';
            formState.data.email = artist.email || currentUser.email;
            formState.data.city = artist.city || artist.ubicacion || '';
            formState.data.location_city = artist.city || '';
            formState.data.location_country = artist.country || '';
            formState.data.styles = artist.styles_array || [];
            formState.data.portfolio_url = artist.portafolio || '';
            formState.data.instagram_handle = (artist.instagram || '').replace(/^@/, '');
            if (artist.instagram) {
                formState.data.portfolio_source = 'instagram';
            } else if (artist.portafolio) {
                formState.data.portfolio_source = 'website';
            }
            formState.data.bio = artist.bio_description || '';
            formState.data.session_price = normalizeSessionPriceAmount(artist.session_price_amount ?? artist.session_price);
            formState.data.session_currency = artist.session_price_currency || extractSessionPriceCurrency(artist.session_price) || 'USD';
            formState.data.birth_date = artist.birth_date || '';
            formState.data.subscribed_newsletter = typeof artist.subscribed_newsletter === 'boolean'
                ? artist.subscribed_newsletter
                : null;
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
        } else {
            loadedArtistRecord = null;
        }
    } catch (error) {
        console.error('Error loading existing data:', error);
        loadedArtistRecord = null;
    }
}

function parseResumeStepFromUrl(search) {
    const rawValue = new URLSearchParams(search || '').get('resumeStep');
    const parsed = Number.parseInt(rawValue || '', 10);

    if (!Number.isInteger(parsed)) return null;
    if (parsed < 1 || parsed > formState.totalSteps) return null;
    return parsed;
}

function isStartOverRequested(search) {
    return new URLSearchParams(search || '').get('startOver') === '1';
}

function resetFormDataForStartOver(email) {
    formState.data.artistic_name = '';
    formState.data.full_name = '';
    formState.data.email = email || '';
    formState.data.city = '';
    formState.data.location_city = '';
    formState.data.location_country = '';
    formState.data.styles = [];
    formState.data.experience_years = '';
    formState.data.session_price = '';
    formState.data.session_currency = 'USD';
    formState.data.portfolio_source = '';
    formState.data.portfolio_url = '';
    formState.data.instagram_handle = '';
    formState.data.bio = '';
    formState.data.work_type = '';
    formState.data.studio_name = '';
    formState.data.studio_id = null;
    formState.data.studio_location_id = null;
    formState.data.studio_location_label = '';
    formState.data.address = null;
    formState.data.birth_date = '';
    formState.data.subscribed_newsletter = null;
    formState.data.terms_accepted = false;
}

function resolveRegistrationResumeStep() {
    const stepFromUrl = parseResumeStepFromUrl(window.location.search || '');
    if (stepFromUrl !== null) {
        return stepFromUrl;
    }

    if (window.ArtistRegistrationProgress?.analyzeArtistProfile && loadedArtistRecord) {
        const progress = window.ArtistRegistrationProgress.analyzeArtistProfile(loadedArtistRecord);
        if (!progress.isComplete && Number.isInteger(progress.nextStep)) {
            return progress.nextStep;
        }
    }

    if (loadedArtistRecord && !String(loadedArtistRecord.name || '').trim()) {
        return 2;
    }

    return 1;
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

    document.querySelectorAll('#styles-grid .style-option').forEach(btn => btn.classList.remove('selected'));
    document.querySelectorAll('.experience-option').forEach(btn => btn.classList.remove('selected'));
    document.querySelectorAll('.work-type-option').forEach(btn => btn.classList.remove('selected'));
    document.querySelectorAll('.newsletter-option').forEach(btn => btn.classList.remove('selected'));
    document.querySelectorAll('.portfolio-source-option').forEach(btn => btn.classList.remove('selected'));
    const studioNameWrapperReset = document.getElementById('studio-name-wrapper');
    if (studioNameWrapperReset) studioNameWrapperReset.style.display = 'none';
    const portfolioUrlWrapper = document.getElementById('portfolio-url-wrapper');
    const portfolioIgWrapper = document.getElementById('portfolio-ig-wrapper');
    if (portfolioUrlWrapper) portfolioUrlWrapper.style.display = 'none';
    if (portfolioIgWrapper) portfolioIgWrapper.style.display = 'none';

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
    const sessionCurrencySelect = document.getElementById('session_currency');
    if (sessionCurrencySelect && data.session_currency) {
        sessionCurrencySelect.value = data.session_currency;
    }
    updateLocationPlainPreview();
    
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
            updateStudioAddressPreview(getDisplayAddress(data.address));
        }
        applyAddressPickerVisibility(data.work_type);
    }

    if (data.experience_years) {
        const experienceBtn = document.querySelector(`.experience-option[data-years="${data.experience_years}"]`);
        if (experienceBtn) {
            experienceBtn.classList.add('selected');
        }
    }

    if (typeof data.subscribed_newsletter === 'boolean') {
        const newsletterBtn = document.querySelector(`.newsletter-option[data-subscribe="${data.subscribed_newsletter ? 'true' : 'false'}"]`);
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

    const termsCheckbox = document.getElementById('terms-checkbox');
    if (termsCheckbox) {
        termsCheckbox.checked = Boolean(data.terms_accepted);
    }

    // Bio editor (Step 9) — contenteditable, not covered by fieldMappings.
    if (data.bio) {
        const bioEditor = document.getElementById('bio');
        if (bioEditor && !bioEditor.textContent.trim()) {
            // Preserve newlines as <br> so IG bios render with line breaks.
            const bioHtml = String(data.bio)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, '<br>');
            bioEditor.innerHTML = bioHtml;
            bioEditor.dispatchEvent(new Event('input', { bubbles: true }));
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
            persistRegistrationDraft();
        });
    }

    const sessionPriceInput = document.getElementById('session_price');
    if (sessionPriceInput && sessionPriceInput.dataset.bound !== 'true') {
        sessionPriceInput.dataset.bound = 'true';
        sessionPriceInput.addEventListener('input', (e) => {
            formState.data.session_price = String(e.target.value || '').trim();
            persistRegistrationDraft();
        });
        sessionPriceInput.addEventListener('change', (e) => {
            formState.data.session_price = String(e.target.value || '').trim();
            persistRegistrationDraft();
        });
    }

    // Terms checkbox
    const termsCheckbox = document.getElementById('terms-checkbox');
    if (termsCheckbox) {
        termsCheckbox.addEventListener('change', (e) => {
            formState.data.terms_accepted = e.target.checked;
            persistRegistrationDraft();
        });
    }
    setupSummaryReviewModal();

    document.querySelectorAll('[data-password-toggle]').forEach(btn => {
        if (btn.dataset.bound === 'true') return;
        btn.dataset.bound = 'true';
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.passwordToggle);
            if (!input) return;
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            btn.setAttribute('aria-pressed', show ? 'true' : 'false');
            btn.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
            const eye = btn.querySelector('.icon-eye');
            const eyeOff = btn.querySelector('.icon-eye-off');
            if (eye) eye.hidden = show;
            if (eyeOff) eyeOff.hidden = !show;
            input.focus();
        });
    });

    ['signup_password', 'signup_password_confirm'].forEach(id => {
        const input = document.getElementById(id);
        if (input && input.dataset.passwordFeedbackBound !== 'true') {
            input.dataset.passwordFeedbackBound = 'true';
            input.addEventListener('input', updatePasswordFeedback);
        }
    });
}

function setupEventListeners() {
    btnNext.addEventListener('click', handleNext);
    btnBack.addEventListener('click', handleBack);

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
            if (field === 'full_name') {
                formState.data.full_name = e.target.value;
            }
            e.target.classList.remove('error');
            persistRegistrationDraft();
        });
        if (input.id === 'full_name') {
            input.addEventListener('blur', (e) => {
                const capitalized = capitalizeWords(e.target.value);
                e.target.value = capitalized;
                formState.data.full_name = capitalized;
                persistRegistrationDraft();
            });
        }
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
        persistRegistrationDraft();
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

    persistRegistrationDraft();
}

async function addCustomStyle() {
    const customInput = document.getElementById('custom_style');
    const rawValue = customInput?.value.trim();
    if (!rawValue) return;

    const addBtn = document.getElementById('add-custom-style-btn');
    if (addBtn) addBtn.disabled = true;

    try {
        const res = await fetch(apiUrl('/api/tattoo-styles/ensure'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: rawValue })
        });

        if (!res.ok) {
            const err = await readJsonResponse(res);
            console.error('Error ensuring style:', err);
            return;
        }

        const { style } = await readJsonResponse(res);
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
        persistRegistrationDraft();
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
    persistRegistrationDraft();
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
        formState.data.studio_location_id = null;
        formState.data.studio_location_label = '';
        studioLocationsCache = [];
        renderStudioLocationSelect([]);
        updateStudioAddressPreview('');
        persistRegistrationDraft();

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
            .select('id, name, normalized_name, country, country_code, state_province, city, locality, street, street_number, unit, postal_code, formatted_address, latitude, longitude, google_place_id')
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
        let html = studioSuggestionsCache.map((s, idx) => {
            const address = getDisplayAddress(s);
            return `
            <div class="studio-suggestion-item" data-cache-index="${idx}" data-id="${escapeHtmlSummary(s.id)}" data-name="${escapeHtmlSummary(s.name)}">
                ${escapeHtmlSummary(s.name)}${address ? `<small>${escapeHtmlSummary(address)}</small>` : ''}
            </div>
        `}).join('');

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

function addressFromStudioLocation(location) {
    if (!location || typeof location !== 'object') return null;
    return {
        country: location.country || '',
        country_code: location.country_code || '',
        state_province: location.state_province || '',
        city: location.city || '',
        locality: location.locality || '',
        street: location.street || '',
        street_number: location.street_number || '',
        unit: location.unit || '',
        postal_code: location.postal_code || '',
        formatted_address: location.formatted_address || '',
        latitude: location.latitude ?? null,
        longitude: location.longitude ?? null,
        google_place_id: location.google_place_id || ''
    };
}

function fallbackLocationFromStudio(studio) {
    if (!studio) return null;
    const address = addressFromStudioLocation(studio);
    if (!getDisplayAddress(address)) return null;
    return {
        id: '',
        label: 'Sede principal',
        is_primary: true,
        ...address
    };
}

async function loadStudioLocations(studioId, fallbackStudio) {
    if (!studioId) return [];
    try {
        const { data, error } = await _supabase
            .from('studio_locations')
            .select('id, label, is_primary, is_active, sort_order, country, country_code, state_province, city, locality, street, street_number, unit, postal_code, formatted_address, latitude, longitude, google_place_id')
            .eq('studio_id', studioId)
            .eq('is_active', true)
            .order('is_primary', { ascending: false })
            .order('sort_order', { ascending: true });
        if (error) throw error;
        const locations = Array.isArray(data) ? data.filter(loc => getDisplayAddress(loc)) : [];
        if (locations.length > 0) return locations;
    } catch (error) {
        console.warn('[register] Studio locations lookup failed:', error);
    }
    const fallback = fallbackLocationFromStudio(fallbackStudio);
    return fallback ? [fallback] : [];
}

function renderStudioLocationSelect(locations) {
    const wrapper = document.getElementById('studio-location-select-wrapper');
    const select = document.getElementById('studio_location_select');
    if (!wrapper || !select) return;
    studioLocationsCache = Array.isArray(locations) ? locations : [];
    if (studioLocationsCache.length <= 1) {
        wrapper.hidden = true;
        select.innerHTML = '';
        return;
    }
    select.innerHTML = studioLocationsCache.map((loc, idx) => {
        const label = loc.label || getDisplayAddress(loc) || `Sede ${idx + 1}`;
        const selected = loc.id && loc.id === formState.data.studio_location_id ? ' selected' : '';
        return `<option value="${idx}"${selected}>${escapeHtmlSummary(label)}</option>`;
    }).join('');
    wrapper.hidden = false;
    if (!select.dataset.bound) {
        select.dataset.bound = 'true';
        select.addEventListener('change', () => {
            const loc = studioLocationsCache[Number.parseInt(select.value, 10)] || null;
            applyStudioLocation(loc);
        });
    }
}

function syncAddressDetailsVisibility() {
    const details = document.getElementById('address-details');
    const preview = document.getElementById('address-preview');
    if (!details) return;
    const hasAddress = Boolean(getDisplayAddress(formState.data.address));
    details.hidden = !hasAddress;
    if (preview) preview.hidden = !hasAddress;
}

function applyStudioLocation(location) {
    const address = addressFromStudioLocation(location);
    if (!address || !getDisplayAddress(address)) return;
    formState.data.studio_location_id = location.id || null;
    formState.data.studio_location_label = location.label || '';
    formState.data.address = address;
    syncLocationFieldsFromAddress(address);
    const picker = ensureAddressPicker();
    picker?.setValue?.(address);
    const preview = document.getElementById('address-preview');
    if (window.WeOtziAddressPicker) window.WeOtziAddressPicker.renderPreview(preview, address);
    syncAddressDetailsVisibility();
    updateStudioAddressPreview(getDisplayAddress(address));
    persistRegistrationDraft();
}

async function selectStudioSuggestion(item) {
    const studioInput = document.getElementById('studio_name');
    if (item.dataset.action === 'create') {
        formState.data.studio_id = null;
        formState.data.studio_location_id = null;
        formState.data.studio_location_label = '';
        renderStudioLocationSelect([]);
        updateStudioAddressPreview('');
    } else {
        const cached = studioSuggestionsCache[Number.parseInt(item.dataset.cacheIndex, 10)] || null;
        formState.data.studio_id = item.dataset.id;
        formState.data.studio_name = item.dataset.name;
        if (studioInput) studioInput.value = item.dataset.name;
        if (cached) {
            const locations = await loadStudioLocations(item.dataset.id, cached);
            renderStudioLocationSelect(locations);
            const preferred = locations.find(loc => loc.id && loc.id === formState.data.studio_location_id)
                || locations.find(loc => loc.is_primary)
                || locations[0];
            if (preferred) {
                applyStudioLocation(preferred);
            } else {
                updateStudioAddressPreview('');
                syncAddressDetailsVisibility();
            }
        }
    }
    persistRegistrationDraft();
    hideSuggestions();
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

async function persistSelectedStudioLocation(studioIdOverride) {
    const workType = formState.data.work_type;
    if (!currentUser || workType === 'independent' || !(workType === 'studio' || workType === 'both')) return;
    const studioId = studioIdOverride || formState.data.studio_id || null;
    const studioName = String(formState.data.studio_name || '').trim();
    if (!studioName) return;
    const address = formState.data.address || {};
    try {
        const row = {
            artist_user_id: currentUser.id,
            period_type: 'current',
            sort_order: 0,
            studio_id: studioId,
            studio_name: studioName.toUpperCase(),
            city: getRegistrationCity() || null,
            agenda_status: 'open'
        };
        const { error } = await _supabase
            .from('artist_tattoo_locations')
            .upsert(row, { onConflict: 'artist_user_id,period_type,sort_order' });
        if (error) throw error;
    } catch (error) {
        console.warn('[register] Could not persist artist tattoo location:', error);
    }
}

let studioAutocompleteInitialized = false;
let addressPickerInstance = null;

function ensureAddressPicker() {
    if (addressPickerInstance) return addressPickerInstance;
    const input = document.getElementById('address_search');
    const preview = document.getElementById('address-preview');
    if (!input || !window.WeOtziAddressPicker) return null;
    addressPickerInstance = window.WeOtziAddressPicker.attach(input, {
        placeholder: 'Calle 123, Ciudad, País',
        onChange(address) {
            formState.data.address = address;
            syncLocationFieldsFromAddress(address);
            if (formState.data.studio_location_id) {
                const selectedLocation = studioLocationsCache.find(loc => loc.id === formState.data.studio_location_id);
                if (getDisplayAddress(address) !== getDisplayAddress(selectedLocation)) {
                    formState.data.studio_location_id = null;
                    formState.data.studio_location_label = '';
                }
            }
            window.WeOtziAddressPicker.renderPreview(preview, address);
            syncAddressDetailsVisibility();
            if (formState.data.work_type === 'studio' || formState.data.work_type === 'both') {
                updateStudioAddressPreview(getDisplayAddress(address));
            }
            persistRegistrationDraft();
        }
    });
    return addressPickerInstance;
}

function applyAddressPickerVisibility(workType) {
    const wrapper = document.getElementById('address-picker-wrapper');
    const label   = document.getElementById('address-picker-label');
    const help    = document.getElementById('address-picker-help');
    if (!wrapper) return;

    if (workType === 'studio' || workType === 'both') {
        wrapper.style.display = 'block';
        if (label) label.textContent = 'Dirección del estudio';
        if (help)  help.textContent = 'Buscá la dirección y elegila de las sugerencias para que el mapa la ubique con precisión.';
        ensureAddressPicker();
        syncAddressDetailsVisibility();
    } else if (workType === 'independent') {
        wrapper.style.display = 'block';
        if (label) label.textContent = 'Dirección donde recibís clientes';
        if (help)  help.textContent = 'Como artista independiente, indicá la dirección de tu espacio de trabajo (estudio propio, casa, etc.).';
        ensureAddressPicker();
        syncAddressDetailsVisibility();
    } else {
        wrapper.style.display = 'none';
        syncAddressDetailsVisibility();
    }
}

function scrollWorkTypeFollowupIntoView(workType) {
    const isStudioWork = workType === 'studio' || workType === 'both';
    const target = isStudioWork
        ? document.getElementById('studio-name-wrapper')
        : document.getElementById('address-picker-wrapper');
    const focusTarget = isStudioWork
        ? document.getElementById('studio_name')
        : document.getElementById('address_search');
    if (!target) return;

    const isMobile = window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
    const shouldFocus = isStudioWork || isMobile;

    setTimeout(() => {
        const reduceMotion = window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (isMobile) {
            const step = target.closest('.form-step');
            const scroller = step?.querySelector('.wo-form-col') || step;
            if (scroller && typeof scroller.scrollTo === 'function') {
                const scrollerRect = scroller.getBoundingClientRect();
                const targetRect = target.getBoundingClientRect();
                const top = Math.max(0, scroller.scrollTop + targetRect.top - scrollerRect.top - 10);
                scroller.scrollTo({
                    top: top,
                    behavior: reduceMotion ? 'auto' : 'smooth'
                });
            } else {
                target.scrollIntoView({
                    block: 'start',
                    behavior: reduceMotion ? 'auto' : 'smooth'
                });
            }
        }

        if (shouldFocus && focusTarget) {
            setTimeout(() => {
                try {
                    focusTarget.focus({ preventScroll: true });
                } catch (_) {
                    focusTarget.focus();
                }
            }, isMobile ? 180 : 0);
        }
    }, isMobile ? 80 : 100);
}

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
        } else {
            studioNameWrapper.style.display = 'none';
            formState.data.studio_name = '';
            formState.data.studio_id = null;
            formState.data.studio_location_id = null;
            formState.data.studio_location_label = '';
            studioLocationsCache = [];
            renderStudioLocationSelect([]);
            if (studioNameInput) studioNameInput.value = '';
            updateStudioAddressPreview('');
        }
    }

    applyAddressPickerVisibility(btn.dataset.type);
    if (btn.dataset.type === 'studio' || btn.dataset.type === 'both') {
        updateStudioAddressPreview(getDisplayAddress(formState.data.address));
    }

    scrollWorkTypeFollowupIntoView(btn.dataset.type);
    persistRegistrationDraft();
}

function selectNewsletterOption(btn) {
    document.querySelectorAll('.newsletter-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    formState.data.subscribed_newsletter = btn.dataset.subscribe === 'true';
    setNewsletterSelectionError(false);
    persistRegistrationDraft();
}

function setNewsletterSelectionError(show) {
    const options = document.getElementById('newsletter-options');
    const error = document.getElementById('newsletter-error');

    if (options) {
        options.classList.toggle('has-error', show);
        options.setAttribute('aria-invalid', show ? 'true' : 'false');
        if (show) {
            options.style.animation = 'shake 0.5s ease';
            setTimeout(() => options.style.animation = '', 500);
        }
    }

    if (error) {
        error.hidden = !show;
        error.classList.toggle('is-visible', show);
    }
}

// ============================================
// Instagram signup flow
// When the landing page (/registerclosedbeta/) is reached by clicking
// "INSTAGRAM", a flag is stashed in localStorage. After signup, the
// redirect URL also carries ?source=instagram. The wizard then displays
// Step 0 (a dedicated "Connect your Instagram" screen) before everything
// else, instead of starting at Step 1.
// ============================================
function isInstagramSignup() {
    try {
        const url = new URL(window.location.href);
        if (url.searchParams.get('source') === 'instagram') return true;
    } catch (_) {}
    try { return localStorage.getItem('weotzi_signup_via_instagram') === '1'; } catch (_) { return false; }
}

function clearInstagramSignupFlag() {
    try { localStorage.removeItem('weotzi_signup_via_instagram'); } catch (_) {}
}

// Inline non-modal error for password fields on Step 3. Avoids alert()
// which blocks the page and breaks the wizard flow if the user misses the
// dismiss button. Auto-hides after 4 seconds.
function showPasswordError(msg) {
    const wrapper = document.querySelector('.ig-preauth-only');
    if (!wrapper) return;
    let box = document.getElementById('signup_password_error');
    if (!box) {
        box = document.createElement('div');
        box.id = 'signup_password_error';
        box.style.cssText = 'margin-top:10px; padding:10px 12px; background:transparent; border:1.5px solid var(--red); color:var(--red); border-radius:0; font-family:var(--mono); font-size:11px; letter-spacing:.08em; text-transform:uppercase;';
        wrapper.appendChild(box);
    }
    box.textContent = msg;
    box.style.display = 'block';
    clearTimeout(showPasswordError._t);
    showPasswordError._t = setTimeout(() => { if (box) box.style.display = 'none'; }, 4000);
}

// Show/hide the password fields on Step 3 based on whether the wizard is
// running pre-auth (IG signup, no session) vs post-auth (normal flow).
function updatePreAuthFieldsVisibility() {
    const preAuth = formState.preAuthMode === true;
    document.querySelectorAll('.ig-preauth-only').forEach(el => {
        el.style.display = preAuth ? 'block' : 'none';
    });
    // In pre-auth mode the email is editable and the user must type it; in
    // authed mode it's prefilled from session.user.email and locked.
    const emailInput = document.getElementById('email');
    if (emailInput && preAuth) {
        emailInput.readOnly = false;
        emailInput.style.opacity = '1';
    }
}

// Apply the prefill returned by the IG import (commit response) to formState
// and any visible inputs. Mirrors the existing "Step 8" callback but works
// for the dedicated Step 0 screen on instagram-signup flow.
function applyIGPrefillFromResult(result, opts) {
    const pf = (result && result.prefill) || {};
    const summary = (result && result.summary) || {};
    const handle = result && result.handle;
    const overwrite = !!(opts && opts.overwriteArtisticName);

    if (handle) {
        formState.data.instagram_handle = handle;
        formState.data.portfolio_source = 'instagram';
        // overwriteArtisticName=true (Step 0 quick-start flow) replaces any
        // existing value because that flow runs before the user types
        // anything. The default (false, used by the Step 8 modal) only
        // fills when empty so it never clobbers a manually typed name.
        if (overwrite || !String(formState.data.artistic_name || '').trim()) {
            formState.data.artistic_name = handle;
            const artisticInput = document.getElementById('artistic_name');
            if (artisticInput) {
                artisticInput.value = handle;
                artisticInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    }

    // Pre-fill full_name from IG profile when available. IG's full_name is
    // what the person chose to display (often "Isai Nazar" or a stylized
    // name). We only fill when empty so we never clobber manual entries —
    // the user always sees the question in Step 2 and can edit.
    if (summary.full_name && !String(formState.data.full_name || '').trim()) {
        formState.data.full_name = summary.full_name;
        const fullNameInput = document.getElementById('full_name');
        if (fullNameInput) {
            fullNameInput.value = summary.full_name;
            fullNameInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    if (pf.bio)      formState.data.bio = pf.bio;
    if (pf.bio_link) formState.data.portfolio_url   = pf.bio_link;

    // Location guess: keep IG's location as a non-authoritative hint only.
    // The saved artist city now comes from the registered work/studio address.
    if (pf.location_guess) {
        formState.data.ig_location_guess = pf.location_guess;
    }

    // Imported media (CDN urls). We keep these in memory + draft for the
    // portfolio step to render thumbnails. Persisted upload to Storage
    // happens after the final server-side registration creates the user.
    if (Array.isArray(pf.media) && pf.media.length > 0) {
        formState.data.ig_imported_media = pf.media;
        formState.data.portfolio_media_seeded = false;
    }

    // Mirror to inputs that already exist in DOM. Hidden steps keep their
    // values queued so they're ready when the wizard renders that step.
    const artistic = document.getElementById('artistic_name');
    if (artistic && handle && !artistic.value) artistic.value = handle;
    const ig = document.getElementById('instagram_handle');
    if (ig && handle) ig.value = handle;
    const portfolio = document.getElementById('portfolio_url');
    if (portfolio && pf.bio_link) portfolio.value = pf.bio_link;
    const bioEditor = document.getElementById('bio');
    if (bioEditor && pf.bio && !bioEditor.textContent.trim()) {
        // Convert plain-text newlines to <br> so the contenteditable
        // preserves IG's line breaks visually (Instagram bios use them).
        const bioHtml = String(pf.bio)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
        bioEditor.innerHTML = bioHtml;
        // Dispatch input so any listeners (counters, autosave, validators)
        // pick up the change. Without this they assume the editor is empty.
        bioEditor.dispatchEvent(new Event('input', { bubbles: true }));
        formState.data.bio = pf.bio;
    }
}

// ============================================
// Portfolio Media (Step 8) — IG imports + local uploads
// ============================================
// We keep media as a list of items in formState.data.portfolio_media_draft.
// Each item is either:
//   { id, source: 'ig',    permalink, cdn_url, kind, caption, timestamp }
//   { id, source: 'local', file: File, preview_url: blob:, kind:'image' }
// Both shapes are rendered as thumbnails in the same grid. The submitForm
// handler turns this list into actual Storage uploads + gallery_feed_items
// at end of wizard.

function getPortfolioMediaDraft() {
    if (!Array.isArray(formState.data.portfolio_media_draft)) {
        formState.data.portfolio_media_draft = [];
    }
    return formState.data.portfolio_media_draft;
}

function getPortfolioMediaCounts() {
    const draft = getPortfolioMediaDraft();
    return draft.reduce((counts, item) => {
        if (item.kind === 'video' || item.category === 'instagram-reel') counts.videos += 1;
        else counts.photos += 1;
        return counts;
    }, { photos: 0, videos: 0 });
}

function seedPortfolioMediaFromIG() {
    // Run once: if we have an IG import that hasn't been seeded yet, copy
    // each media item into the draft. Marked seeded so a wizard refresh
    // doesn't duplicate them.
    if (formState.data.portfolio_media_seeded === true) return;
    const igMedia = formState.data.ig_imported_media;
    if (!Array.isArray(igMedia) || igMedia.length === 0) return;
    const draft = getPortfolioMediaDraft();
    const existingKeys = new Set(draft.map(item => item.permalink || item.cdn_url || item.id).filter(Boolean));
    for (const m of igMedia) {
        const key = m.permalink || m.cdn_url;
        if (key && existingKeys.has(key)) continue;
        draft.push({
            id: 'ig-' + (m.permalink ? hashString(m.permalink) : Math.random().toString(36).slice(2)),
            source: 'ig',
            permalink: m.permalink || null,
            cdn_url: m.cdn_url,
            thumbnail_url: m.thumbnail_url || null,
            kind: m.kind === 'reel' ? 'video' : 'image',
            category: m.category || (m.kind === 'reel' ? 'instagram-reel' : 'instagram'),
            caption: m.caption || null,
            timestamp: m.timestamp || null
        });
        if (key) existingKeys.add(key);
    }
    formState.data.portfolio_media_seeded = true;
}

function hashString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
}

let _portfolioMediaWired = false;
function setupPortfolioMediaUI() {
    if (_portfolioMediaWired) return;
    const section = document.getElementById('portfolio-media-section');
    const addBtn = document.getElementById('portfolio-media-add-btn');
    const fileInput = document.getElementById('portfolio-media-file-input');
    if (!section || !addBtn || !fileInput) return;

    addBtn.addEventListener('click', () => fileInput.click());
    document.getElementById('portfolio-media-modal-add')?.addEventListener('click', () => fileInput.click());
    document.getElementById('portfolio-media-modal-close')?.addEventListener('click', closePortfolioMediaModal);
    document.getElementById('portfolio-media-modal')?.addEventListener('click', (e) => {
        if (e.target?.id === 'portfolio-media-modal') closePortfolioMediaModal();
    });
    document.getElementById('portfolio-media-modal-import')?.addEventListener('click', openPortfolioMediaInstagramImport);
    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        const draft = getPortfolioMediaDraft();
        for (const file of files) {
            if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue;
            draft.push({
                id: 'local-' + Math.random().toString(36).slice(2),
                source: 'local',
                file,
                preview_url: URL.createObjectURL(file),
                kind: file.type.startsWith('video/') ? 'video' : 'image',
                category: 'realizados'
            });
        }
        e.target.value = ''; // allow re-selecting same file later
        renderPortfolioMediaGrid();
        renderPortfolioMediaModalGrid();
    });
    _portfolioMediaWired = true;
}

function renderPortfolioMediaGrid() {
    const section = document.getElementById('portfolio-media-section');
    const grid = document.getElementById('portfolio-media-grid');
    if (!section || !grid) return;

    const draft = getPortfolioMediaDraft();
    // Show section whenever we have items OR the user is on the IG flow.
    const igFlow = formState.preAuthMode === true || formState.data.portfolio_source === 'instagram';
    section.style.display = (draft.length > 0 || igFlow) ? '' : 'none';

    grid.innerHTML = '';
    for (const item of draft) {
        const wrap = document.createElement('div');
        wrap.className = 'portfolio-media-item';
        wrap.dataset.id = item.id;

        const tag = document.createElement('span');
        tag.className = 'portfolio-media-source-tag' + (item.source === 'local' ? ' local' : '');
        tag.textContent = item.source === 'ig' ? 'IG' : 'tuya';
        wrap.appendChild(tag);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'portfolio-media-remove';
        remove.innerHTML = '<span aria-hidden="true">×</span>';
        remove.title = 'Quitar';
        remove.setAttribute('aria-label', 'Quitar medio');
        remove.addEventListener('click', (e) => {
            e.preventDefault();
            removePortfolioMediaItem(item.id);
        });
        wrap.appendChild(remove);

        // For IG items, route through our /api/instagram/proxy-thumb because
        // IG CDN sets Cross-Origin-Resource-Policy: same-origin. Local files
        // are blob: URLs — they don't need proxying.
        // For IG videos (reels) we use a poster-frame approach: the proxy
        // endpoint returns the thumbnail image even when the URL is a video
        // (Apify's `displayUrl` for reels is already a still). If only a
        // video URL is available, we still try the proxy and fall back to
        // a placeholder div on error.
        const isLocal = item.source === 'local';
        const mediaUrl = item.thumbnail_url || item.preview_url || item.cdn_url;
        const url = isLocal
            ? item.preview_url
            : apiUrl('/api/instagram/proxy-thumb') + '?url=' + encodeURIComponent(mediaUrl);
        if (item.kind === 'video' && isLocal) {
            const v = document.createElement('video');
            v.src = url;
            v.muted = true;
            v.playsInline = true;
            wrap.appendChild(v);
        } else {
            // IG image OR IG reel (which we render as still thumbnail)
            const img = document.createElement('img');
            img.src = url;
            img.alt = item.caption || 'Portfolio';
            img.loading = 'lazy';
            // Failed loads show a soft placeholder so the grid keeps shape.
            img.addEventListener('error', () => {
                img.style.display = 'none';
                wrap.style.background = '#181818';
                if (!wrap.querySelector('.portfolio-media-fallback')) {
                    const fb = document.createElement('div');
                    fb.className = 'portfolio-media-fallback';
                    fb.style.cssText = 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#666; font-size:11px; text-align:center; padding:8px;';
                    fb.textContent = item.kind === 'video' ? 'Reel' : 'Foto';
                    wrap.appendChild(fb);
                }
            });
            wrap.appendChild(img);
            // Mark reels visually so the user can tell them apart.
            if (item.kind === 'video') {
                const reelBadge = document.createElement('span');
                reelBadge.style.cssText = 'position:absolute; bottom:4px; right:4px; background:rgba(0,0,0,0.7); color:#fff; font-size:10px; padding:2px 5px; border-radius:3px; pointer-events:none;';
                reelBadge.textContent = '▶ Reel';
                wrap.appendChild(reelBadge);
            }
        }
        grid.appendChild(wrap);
    }
}

function removePortfolioMediaItem(id) {
    const draft = getPortfolioMediaDraft();
    const idx = draft.findIndex(it => it.id === id);
    if (idx === -1) return;
    const removed = draft.splice(idx, 1)[0];
    // Free blob URL if it's a local item.
    if (removed && removed.source === 'local' && removed.preview_url) {
        try { URL.revokeObjectURL(removed.preview_url); } catch (_) {}
    }
    renderPortfolioMediaGrid();
    renderPortfolioMediaModalGrid();
    persistRegistrationDraft();
}

function renderPortfolioMediaModalGrid() {
    const grid = document.getElementById('portfolio-media-modal-grid');
    if (!grid) return;
    const draft = getPortfolioMediaDraft();
    grid.innerHTML = '';
    if (!draft.length) {
        const empty = document.createElement('p');
        empty.className = 'portfolio-media-empty';
        empty.textContent = 'Todavia no hay fotos ni videos cargados.';
        grid.appendChild(empty);
        return;
    }
    for (const item of draft) {
        const wrap = document.createElement('div');
        wrap.className = 'portfolio-media-item';
        wrap.dataset.id = item.id;

        const tag = document.createElement('span');
        tag.className = 'portfolio-media-source-tag' + (item.source === 'local' ? ' local' : '');
        tag.textContent = item.source === 'ig' ? 'IG' : 'tuya';
        wrap.appendChild(tag);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'portfolio-media-remove';
        remove.innerHTML = '<span aria-hidden="true">×</span>';
        remove.title = 'Quitar';
        remove.setAttribute('aria-label', 'Quitar medio');
        remove.addEventListener('click', (e) => {
            e.preventDefault();
            removePortfolioMediaItem(item.id);
        });
        wrap.appendChild(remove);

        const isLocal = item.source === 'local';
        const mediaUrl = item.thumbnail_url || item.preview_url || item.cdn_url;
        const url = isLocal
            ? item.preview_url
            : apiUrl('/api/instagram/proxy-thumb') + '?url=' + encodeURIComponent(mediaUrl);
        if (item.kind === 'video' && isLocal) {
            const video = document.createElement('video');
            video.src = url;
            video.muted = true;
            video.playsInline = true;
            video.preload = 'metadata';
            wrap.appendChild(video);
        } else {
            const img = document.createElement('img');
            img.src = url;
            img.alt = item.caption || 'Portfolio';
            img.loading = 'lazy';
            img.addEventListener('error', () => {
                img.style.display = 'none';
                wrap.style.background = '#181818';
            });
            wrap.appendChild(img);
        }
        if (item.kind === 'video') {
            const reelBadge = document.createElement('span');
            reelBadge.style.cssText = 'position:absolute; bottom:4px; right:4px; background:rgba(0,0,0,0.72); color:#fff; font-size:10px; padding:2px 5px; border-radius:0; pointer-events:none;';
            reelBadge.textContent = '▶ video';
            wrap.appendChild(reelBadge);
        }
        grid.appendChild(wrap);
    }
}

function openPortfolioMediaModal() {
    setupPortfolioMediaUI();
    renderPortfolioMediaModalGrid();
    const modal = document.getElementById('portfolio-media-modal');
    if (!modal) return;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
}

function closePortfolioMediaModal() {
    const modal = document.getElementById('portfolio-media-modal');
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
}

function openPortfolioMediaInstagramImport() {
    if (typeof window.IGImport?.open !== 'function') {
        alert('El importador de Instagram no esta disponible en este momento.');
        return;
    }
    const handle = String(formState.data.instagram_handle || document.getElementById('instagram_handle')?.value || '').replace(/^@/, '');
    window.IGImport.open({
        target: 'artist',
        mode: 'signup',
        prefillHandle: handle,
        onComplete: (result) => {
            applyIGPrefillFromResult(result, { overwriteArtisticName: false });
            seedPortfolioMediaFromIG();
            renderPortfolioMediaGrid();
            renderPortfolioMediaModalGrid();
            persistRegistrationDraft();
        }
    });
}

// Run at end-of-wizard after the artist row exists. Persists the
// portfolio media draft to Storage:
//   - local files: uploaded directly via the JS Supabase client (browser
//     has the new auth session so RLS allows it)
//   - IG items:    a fresh preview + commit(mode:'dashboard',
//     allowed_permalinks=...) tells the server to download only the
//     permalinks the user actually kept in the draft
// Failures here don't abort the wizard — the user lands on the dashboard
// with their profile saved, even if photos couldn't be persisted.
async function persistPortfolioMedia() {
    const draft = getPortfolioMediaDraft();
    if (!draft.length || !currentUser) return;

    const igItems = draft.filter(it => it.source === 'ig');
    const localItems = draft.filter(it => it.source === 'local');

    // 1) Local files → Supabase Storage directly from the browser.
    const localItemsForFeed = [];
    for (const it of localItems) {
        try {
            const ext = ((it.file && it.file.name) || 'photo.jpg').split('.').pop().toLowerCase();
            const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
            const path = `${currentUser.id}/${filename}`;
            const { error: upErr } = await _supabase.storage
                .from('artist-gallery')
                .upload(path, it.file, { contentType: it.file.type, upsert: false });
            if (upErr) { console.warn('[portfolio] local upload failed', upErr); continue; }
            const { data: pub } = _supabase.storage.from('artist-gallery').getPublicUrl(path);
            localItemsForFeed.push({
                url: pub.publicUrl,
                category: 'realizados',
                kind: it.kind === 'video' ? 'video' : 'image',
                created_at: new Date().toISOString()
            });
        } catch (e) {
            console.warn('[portfolio] local upload exception', e);
        }
    }

    // 2) IG items → server-side fetch + Storage upload, filtered by the
    //    permalinks still present in the draft.
    if (igItems.length > 0 && formState.data.instagram_handle) {
        try {
            const igHandle = String(formState.data.instagram_handle).replace(/^@/, '');
            const { data: { session } } = await _supabase.auth.getSession();
            const headers = {
                'Content-Type': 'application/json',
                ...(session ? { 'Authorization': 'Bearer ' + session.access_token } : {})
            };
            const wantPhotos = igItems.some(it => it.kind === 'image');
            const wantReels = igItems.some(it => it.kind === 'video');
            const limit = igItems.length <= 12 ? 12 : igItems.length <= 24 ? 24 : 50;

            // Fresh preview to get unexpired CDN URLs.
            const previewRes = await fetch(apiUrl('/api/instagram/preview'), {
                method: 'POST', headers,
                body: JSON.stringify({ handle: igHandle, limit, mode: 'dashboard' })
            });
            const preview = await readJsonResponse(previewRes);
            if (!preview.success) {
                console.warn('[portfolio] IG fresh preview failed', preview);
            } else {
                const allowedPermalinks = igItems.map(it => it.permalink).filter(Boolean);
                // If none of the IG items have permalinks (rare — Apify
                // failed to return p.url), drop the filter so the server
                // imports everything. An empty `allowed_permalinks` would
                // otherwise produce zero imports silently.
                const body = {
                    payload_id: preview.payload_id,
                    selection: { bio: false, bio_link: false, location: false, photos: wantPhotos, reels: wantReels },
                    target: 'artist',
                    target_user_id: currentUser.id,
                    mode: 'dashboard'
                };
                if (allowedPermalinks.length > 0) body.allowed_permalinks = allowedPermalinks;
                const commitRes = await fetch(apiUrl('/api/instagram/commit'), {
                    method: 'POST', headers,
                    body: JSON.stringify(body)
                });
                const commitData = await readJsonResponse(commitRes);
                if (!commitData.success) {
                    console.warn('[portfolio] IG finalize commit failed', commitData);
                } else {
                    const im = commitData.imported || {};
                    const errs = Array.isArray(commitData.errors) ? commitData.errors : [];
                    console.info(
                        '[portfolio] IG finalize: photos=%d reels=%d errors=%d',
                        im.photos || 0, im.reels || 0, errs.length
                    );
                    if (errs.length > 0) {
                        console.warn('[portfolio] IG finalize errors sample:', errs.slice(0, 3));
                    }
                }
            }
        } catch (e) {
            console.warn('[portfolio] IG finalize exception', e);
        }
    }

    // 3) Merge local items into the row (the server-side commit already
    //    wrote IG items, so we read+update to avoid clobbering).
    if (localItemsForFeed.length > 0) {
        try {
            const { data: existing, error: readErr } = await _supabase
                .from('artists_db')
                .select('gallery_feed_items')
                .eq('user_id', currentUser.id)
                .single();
            if (readErr) throw readErr;
            const existingItems = Array.isArray(existing && existing.gallery_feed_items)
                ? existing.gallery_feed_items
                : [];
            const merged = existingItems.concat(localItemsForFeed);
            const { error: updErr } = await _supabase
                .from('artists_db')
                .update({ gallery_feed_items: merged })
                .eq('user_id', currentUser.id);
            if (updErr) throw updErr;
        } catch (e) {
            console.warn('[portfolio] local merge exception', e);
        }
    }
}

// After Step 0 (IG import), where do we send the user?
//
// In IG signup we always go to Step 1 — the user must walk through each
// question and confirm the prefilled values, even if every field is filled.
// Skipping prefilled steps would mean the user never sees the data IG sent,
// which is bad UX (they should review before submitting).
//
// In other entry paths (returning user resuming a draft), we advance past
// the steps that already have data — that's the original "resume" behavior.
function findFirstEmptyStep() {
    if (isInstagramSignup()) return 1;
    const d = formState.data || {};
    if (!String(d.artistic_name || '').trim()) return 1;
    if (!String(d.full_name || '').trim()) return 2;
    if (!String(d.email || '').trim()) return 3;
    if (!Array.isArray(d.styles) || d.styles.length === 0) return 4;
    if (!d.experience_years) return 5;
    if (!d.session_price) return 6;
    if (!d.portfolio_source) return 7;
    if (!String(d.bio || '').trim()) return 8;
    if (!d.work_type) return 9;
    if (!d.birth_date) return 10;
    return 11;
}

// Wire the Step 0 IG screen — search button, skip button, status text.
function setupIGStep0() {
    const handleInput = document.getElementById('ig-step-handle');
    const importBtn   = document.getElementById('ig-step-import-btn');
    const skipBtn     = document.getElementById('ig-step-skip-btn');
    const statusEl    = document.getElementById('ig-step-status');
    const summaryEl   = document.getElementById('ig-step-summary');
    if (!handleInput || !importBtn || !skipBtn) return;

    let stagedPayloadId = null;
    let stagedSummary = null;
    let stagedHandle = null;

    function setStatus(html, tone) {
        statusEl.className = 'ig-step-status';
        if (tone === 'success') statusEl.classList.add('is-success');
        if (tone === 'error') statusEl.classList.add('is-error');
        statusEl.innerHTML = html;
    }

    async function authHeaders() {
        try {
            const session = window._supabase
                ? (await window._supabase.auth.getSession()).data.session
                : null;
            return session ? { 'Authorization': 'Bearer ' + session.access_token } : {};
        } catch (_) { return {}; }
    }

    async function runPreview() {
        const handle = handleInput.value.trim().replace(/^@/, '');
        if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) {
            setStatus('Handle inválido. Solo letras, números, puntos y guiones bajos.', 'error');
            return;
        }
        setStatus('Buscando perfil en Instagram… esto puede tomar 5-15 segundos.', 'muted');
        importBtn.disabled = true;
        try {
            const headers = await authHeaders();
            const res = await fetch(apiUrl('/api/instagram/preview'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ handle, limit: 12, mode: 'signup' })
            });
            const data = await readJsonResponse(res);
            if (!res.ok || !data.success) {
                const msg = (data && (data.error || data.code)) || ('HTTP ' + res.status);
                setStatus('No se pudo buscar el perfil: ' + msg, 'error');
                return;
            }
            stagedPayloadId = data.payload_id;
            stagedSummary = data.summary;
            stagedHandle = handle;
            renderPreview();
        } catch (err) {
            setStatus('Error de red: ' + err.message, 'error');
        } finally {
            importBtn.disabled = false;
        }
    }

    function renderPreview() {
        const s = stagedSummary || {};
        const photosCount = s.photos_count || 0;
        const reelsCount = s.reels_count || 0;
        setStatus('Perfil encontrado: <strong>' + (s.full_name || ('@' + stagedHandle)) + '</strong>. Marcá qué traer y confirmá.', 'success');
        summaryEl.innerHTML = `
            <div class="ig-step-preview">
                <label class="ig-step-option ${s.bio_present ? '' : 'is-disabled'}">
                    <input type="checkbox" id="ig-step-cb-bio" ${s.bio_present ? 'checked' : ''} ${s.bio_present ? '' : 'disabled'}>
                    <span>Biografía ${s.bio_present ? '' : '<small>(no disponible)</small>'}</span>
                </label>
                <label class="ig-step-option ${s.bio_link_present ? '' : 'is-disabled'}">
                    <input type="checkbox" id="ig-step-cb-link" ${s.bio_link_present ? 'checked' : ''} ${s.bio_link_present ? '' : 'disabled'}>
                    <span>Enlace de bio ${s.bio_link_present ? '' : '<small>(no disponible)</small>'}</span>
                </label>
                <label class="ig-step-option ${s.location_guess ? '' : 'is-disabled'}">
                    <input type="checkbox" id="ig-step-cb-location" ${s.location_guess ? 'checked' : ''} ${s.location_guess ? '' : 'disabled'}>
                    <span>Ubicación ${s.location_guess ? '<small>(' + escapeHtml(s.location_guess) + ')</small>' : '<small>(no detectada)</small>'}</span>
                </label>
                <label class="ig-step-option ${photosCount > 0 ? '' : 'is-disabled'}">
                    <input type="checkbox" id="ig-step-cb-photos" ${photosCount > 0 ? 'checked' : ''} ${photosCount > 0 ? '' : 'disabled'}>
                    <span>Fotos ${photosCount > 0 ? '<small>(' + photosCount + ')</small>' : '<small>(0)</small>'}</span>
                </label>
                <label class="ig-step-option ${reelsCount > 0 ? '' : 'is-disabled'}">
                    <input type="checkbox" id="ig-step-cb-reels" ${reelsCount > 0 ? 'checked' : ''} ${reelsCount > 0 ? '' : 'disabled'}>
                    <span>Reels ${reelsCount > 0 ? '<small>(' + reelsCount + ')</small>' : '<small>(0)</small>'}</span>
                </label>
                <small class="ig-step-preview-note">Las fotos y reels los podrás revisar y editar en el paso del portfolio antes de finalizar.</small>
            </div>
        `;
        importBtn.textContent = 'Importar y continuar';
        importBtn.onclick = runCommit;
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    async function runCommit() {
        if (!stagedPayloadId) return;
        const selection = {
            bio:      document.getElementById('ig-step-cb-bio')?.checked || false,
            bio_link: document.getElementById('ig-step-cb-link')?.checked || false,
            location: document.getElementById('ig-step-cb-location')?.checked || false,
            photos:   document.getElementById('ig-step-cb-photos')?.checked || false,
            reels:    document.getElementById('ig-step-cb-reels')?.checked || false
        };
        setStatus('Importando…', 'muted');
        importBtn.disabled = true;
        try {
            const headers = await authHeaders();
            const res = await fetch(apiUrl('/api/instagram/commit'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({
                    payload_id: stagedPayloadId,
                    selection,
                    target: 'artist',
                    mode: 'signup'
                })
            });
            const data = await readJsonResponse(res);
            if (!res.ok || !data.success) {
                const msg = (data && (data.error || data.code)) || ('HTTP ' + res.status);
                setStatus('No se pudo importar: ' + msg, 'error');
                importBtn.disabled = false;
                return;
            }
            applyIGPrefillFromResult(
                { ...data, handle: stagedHandle, summary: stagedSummary },
                { overwriteArtisticName: true } // Step 0 runs before manual entry
            );
            seedPortfolioMediaFromIG();
            renderPortfolioMediaGrid();
            renderPortfolioMediaModalGrid();
            persistRegistrationDraft();
            clearInstagramSignupFlag();
            setStatus('Importado. Continuamos con el resto de tu registro.', 'success');
            // Move to first step that still needs data.
            setTimeout(() => goToStep(findFirstEmptyStep()), 600);
        } catch (err) {
            setStatus('Error de red: ' + err.message, 'error');
            importBtn.disabled = false;
        }
    }

    importBtn.onclick = runPreview;
    skipBtn.onclick = () => {
        clearInstagramSignupFlag();
        goToStep(findFirstEmptyStep());
    };

    handleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            importBtn.click();
        }
    });
}

// ============================================
// Instagram Import (mode: signup)
// Mounts the IGImport component inside Step 8 when the user picks Instagram.
// On completion, copies bio / portafolio / and stashes location_guess for
// the next steps. Photos/reels are deferred to dashboard mode after signup.
// ============================================
let _igImportMounted = false;
function mountIGImportInRegister() {
    if (_igImportMounted) return;
    if (typeof window.IGImport?.mount !== 'function') return;
    const container = document.getElementById('ig-import-mount');
    if (!container) return;

    window.IGImport.mount(container, {
        target: 'artist',
        mode: 'signup',
        prefillHandle: document.getElementById('instagram_handle')?.value || '',
        onComplete: (result) => {
            applyIGPrefillFromResult(result, { overwriteArtisticName: false });
            seedPortfolioMediaFromIG();
            renderPortfolioMediaGrid();
            renderPortfolioMediaModalGrid();

            const pf = result && result.prefill ? result.prefill : {};

            // 1) Copy the IG handle into the wizard input so it persists
            //    in formState.data.instagram_handle on the next blur/save.
            if (result.handle) {
                const igInput = document.getElementById('instagram_handle');
                if (igInput && !igInput.value) {
                    igInput.value = result.handle;
                    igInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }

            // 2) Bio prefill — populate the rich-text editor in Step 9.
            if (pf.bio) {
                const bioEditor = document.getElementById('bio');
                if (bioEditor && !bioEditor.textContent.trim()) {
                    bioEditor.textContent = pf.bio;
                    bioEditor.dispatchEvent(new Event('input', { bubbles: true }));
                    formState.data.bio = pf.bio;
                }
            }

            // 3) Bio link → portfolio_url field (the wizard already collects
            //    this elsewhere; we only set it if empty).
            if (pf.bio_link) {
                const urlInput = document.getElementById('portfolio_url');
                if (urlInput && !urlInput.value) {
                    urlInput.value = pf.bio_link;
                    formState.data.portfolio_url = pf.bio_link;
                }
            }

            // 4) Location_guess — store on formState so the wizard can show
            //    it as a suggestion on the address-picker step if revisited.
            //    We do NOT overwrite an already-picked address.
            if (pf.location_guess) {
                formState.data.ig_location_guess = pf.location_guess;
            }

            // Persist immediately so a refresh keeps the prefilled values.
            if (typeof persistRegistrationDraft === 'function') {
                persistRegistrationDraft();
            }
        }
    });
    _igImportMounted = true;
}

function selectPortfolioSource(btn) {
    document.querySelectorAll('.portfolio-source-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    const source = btn.dataset.source;
    formState.data.portfolio_source = source;

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
        mountIGImportInRegister();
        // Show portfolio media section so the user can preview imports
        // and / or add photos from their device.
        renderPortfolioMediaGrid();
        renderPortfolioMediaModalGrid();
    } else if (source === 'other') {
        urlWrapper.style.display = 'block';
        urlLabel.textContent = 'URL de tu portfolio o trabajo';
        urlInput.placeholder = 'https://...';
        setTimeout(() => urlInput.focus(), 100);
    }

    persistRegistrationDraft();
}

// ============================================
// Navigation
// ============================================

function handleNext() {
    if (formState.currentStep === 'summary') {
        submitForm();
        return;
    }

    if (formState.currentStep === 'success' || formState.currentStep === 'saving') {
        return;
    }

    if (!validateCurrentStep()) {
        return;
    }

    saveCurrentStepData();

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
    if (formState.currentStep === 'saving' || formState.currentStep === 'success') return;

    if (formState.currentStep > 1) {
        goToStep(formState.currentStep - 1);
    }
}

function saveCurrentStepData() {
    const currentStepEl = document.querySelector(`.form-step[data-step="${formState.currentStep}"]`);
    if (!currentStepEl) return;

    if (formState.currentStep === 7) {
        const urlInput = document.getElementById('portfolio_url');
        const igInput = document.getElementById('instagram_handle');
        const source = formState.data.portfolio_source;
        if (source === 'website' || source === 'other') {
            formState.data.portfolio_url = urlInput ? urlInput.value : '';
        } else if (source === 'instagram') {
            formState.data.instagram_handle = igInput ? igInput.value.replace(/^@/, '') : '';
        }
        persistRegistrationDraft();
        return;
    }

    if (formState.currentStep === 8) {
        syncBioContent({ normalizeEditor: true });
        return;
    }

    const input = currentStepEl.querySelector('.form-input');
    if (input) {
        if (input.id === 'full_name') {
            input.value = capitalizeWords(input.value);
        }
        formState.data[input.id] = input.value;
    }

    persistRegistrationDraft();
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
            if (!artisticName.value.trim() || normalizeArtistHandle(artisticName.value).length < 3) {
                isValid = false;
                errorElement = artisticName;
            } else {
                const username = formatUsername(artisticName.value);
                const liveAvailability = window.__weotziUsernameAvailability || null;
                if (liveAvailability?.username === username && liveAvailability.state === 'taken') {
                    isValid = false;
                    errorElement = artisticName;
                }
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
                break;
            }
            // Pre-auth registration: validate password fields now; the server
            // creates Auth only after the final review step.
            if (formState.preAuthMode) {
                const pwValidation = validateSignupPasswordFields();
                if (!pwValidation.valid) {
                    isValid = false;
                    errorElement = pwValidation.element;
                    break;
                }
            }
            break;

        case 4:
            if (formState.data.styles.length === 0) {
                isValid = false;
                const grid = document.getElementById('styles-grid');
                grid.style.animation = 'shake 0.5s ease';
                setTimeout(() => grid.style.animation = '', 500);
            }
            break;

        case 5:
            if (!formState.data.experience_years) {
                isValid = false;
                const experienceOptions = document.getElementById('experience-options');
                experienceOptions.style.animation = 'shake 0.5s ease';
                setTimeout(() => experienceOptions.style.animation = '', 500);
            }
            break;

        case 6:
            const sessionPrice = document.getElementById('session_price');
            const sessionPriceValue = String(sessionPrice.value || '').trim();
            if (!sessionPriceValue || parseFloat(sessionPriceValue) <= 0) {
                isValid = false;
                errorElement = sessionPrice;
            } else {
                formState.data.session_price = sessionPriceValue;
                formState.data.session_currency = document.getElementById('session_currency')?.value || formState.data.session_currency || 'USD';
            }
            break;

        case 7: {
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

        case 8:
            // Bio is optional
            break;

        case 9:
            if (!formState.data.work_type) {
                isValid = false;
                const workTypeOptions = document.getElementById('work-type-options');
                workTypeOptions.style.animation = 'shake 0.5s ease';
                setTimeout(() => workTypeOptions.style.animation = '', 500);
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
            if (isValid) {
                prepareRegistrationLocationData();
                if (!getRegistrationCity()) {
                    isValid = false;
                    errorElement = document.getElementById('address_search');
                    if (errorElement) errorElement.classList.add('error');
                }
            }
            break;

        case 10:
            const birthResult = validateBirthDateSelects();
            if (!birthResult.valid) {
                isValid = false;
                errorElement = birthResult.errorElement;
                alert(birthResult.message);
            }
            break;

        case 11:
            // Newsletter selection - at least one option must be selected
            const selectedNewsletter = document.querySelector('.newsletter-option.selected');
            if (!selectedNewsletter || typeof formState.data.subscribed_newsletter !== 'boolean') {
                isValid = false;
                setNewsletterSelectionError(true);
            } else {
                setNewsletterSelectionError(false);
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

let stepTransitionToken = 0;

function goToStep(step) {
    const transitionToken = ++stepTransitionToken;
    const activeSteps = Array.from(document.querySelectorAll('.form-step.active'));
    const direction = typeof step === 'number' && step > formState.currentStep ? 'forward' : 'backward';

    activeSteps.forEach((currentStepEl) => {
        currentStepEl.classList.remove('active');
        if (direction === 'forward') {
            currentStepEl.classList.add('exit-left');
        }
        setTimeout(() => {
            currentStepEl.classList.remove('exit-left');
        }, 500);
    });

    formState.currentStep = step;
    persistRegistrationDraft();

    setTimeout(() => {
        if (transitionToken !== stepTransitionToken) return;

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
    if (stepValue === '0') return;
    if (stepValue === 'saving') return;
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
    const registerFooter = document.querySelector('.register-footer');
    const scrollIndicator = document.getElementById('scroll-indicator');

    if (registerFooter) {
        registerFooter.classList.toggle('step-hidden', step === 0);
        if (step !== 'success') {
            registerFooter.classList.remove('hidden');
        }
    }

    if (scrollIndicator) {
        scrollIndicator.classList.toggle('step-hidden', step === 0);
    }

    if (step === 0) {
        progressFill.style.width = '4%';
        progressFill.style.background = 'var(--primary-red)';
        progressLabel.textContent = `IG / ${String(formState.totalSteps).padStart(2, '0')}`;
    } else if (typeof step === 'number') {
        const progress = (step / formState.totalSteps) * 100;
        progressFill.style.width = `${progress}%`;
        progressLabel.textContent = `${String(step).padStart(2, '0')} / ${String(formState.totalSteps).padStart(2, '0')}`;
    } else if (step === 'summary') {
        progressFill.style.width = '100%';
        progressLabel.textContent = 'RESUMEN';
    } else if (step === 'saving') {
        progressFill.style.width = '100%';
        progressLabel.textContent = 'CREANDO';
    } else if (step === 'success') {
        progressFill.style.width = '100%';
        progressLabel.textContent = 'LISTO';
    }

    if (typeof step === 'number' && step > 0) {
        if (step <= 4) {
            progressFill.style.background = 'var(--primary-red)';
        } else if (step <= 8) {
            progressFill.style.background = 'var(--primary-yellow)';
        } else {
            progressFill.style.background = 'var(--primary-blue)';
        }
    }

    if (step === 0 || step === 1 || step === 'success' || step === 'saving') {
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
    } else if (step === 'saving') {
        document.querySelector('.register-footer').classList.add('hidden');
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
    const profileUrl = window.location.origin + appUrl('/artist/profile?artist=' + encodeURIComponent(username));
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

function escapeHtmlSummary(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isSummaryMobileViewport() {
    return window.matchMedia
        ? window.matchMedia('(max-width: 600px)').matches
        : window.innerWidth <= 600;
}

function getSummaryReviewElements() {
    return {
        summaryOpen: document.getElementById('summary-mobile-open'),
        modal: document.getElementById('summary-review-modal'),
        close: document.getElementById('summary-review-close')
    };
}

const summaryReviewModalHome = {
    parent: null,
    nextSibling: null
};

function openSummaryReviewModal() {
    const { summaryOpen, modal, close } = getSummaryReviewElements();
    if (!modal || !isSummaryMobileViewport()) return;

    if (modal.parentNode !== document.body) {
        summaryReviewModalHome.parent = modal.parentNode;
        summaryReviewModalHome.nextSibling = modal.nextSibling;
        document.body.appendChild(modal);
    }
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    if (summaryOpen) summaryOpen.setAttribute('aria-expanded', 'true');
    document.body.classList.add('summary-review-lock');
    requestAnimationFrame(() => {
        if (close) close.focus({ preventScroll: true });
    });
}

function closeSummaryReviewModal(options = {}) {
    const { summaryOpen, modal } = getSummaryReviewElements();
    if (!modal) return;

    modal.classList.remove('is-open');
    if (summaryReviewModalHome.parent && modal.parentNode === document.body) {
        summaryReviewModalHome.parent.insertBefore(modal, summaryReviewModalHome.nextSibling);
    }
    modal.setAttribute('aria-hidden', isSummaryMobileViewport() ? 'true' : 'false');
    if (summaryOpen) summaryOpen.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('summary-review-lock');

    if (options.restoreFocus !== false && summaryOpen && isSummaryMobileViewport()) {
        summaryOpen.focus({ preventScroll: true });
    }
}

let _summaryReviewModalWired = false;
function setupSummaryReviewModal() {
    if (_summaryReviewModalWired) return;
    const { summaryOpen, modal, close } = getSummaryReviewElements();
    if (!summaryOpen || !modal) return;

    function syncViewportState() {
        if (!isSummaryMobileViewport()) {
            closeSummaryReviewModal({ restoreFocus: false });
            modal.setAttribute('aria-hidden', 'false');
        } else if (!modal.classList.contains('is-open')) {
            modal.setAttribute('aria-hidden', 'true');
        }
    }

    summaryOpen.addEventListener('click', openSummaryReviewModal);
    if (close) close.addEventListener('click', closeSummaryReviewModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeSummaryReviewModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('is-open')) {
            closeSummaryReviewModal();
        }
    });

    if (window.matchMedia) {
        const query = window.matchMedia('(max-width: 600px)');
        if (query.addEventListener) query.addEventListener('change', syncViewportState);
        else if (query.addListener) query.addListener(syncViewportState);
    } else {
        window.addEventListener('resize', syncViewportState);
    }

    syncViewportState();
    _summaryReviewModalWired = true;
}

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
        ? data.styles.map(s => `<span class="style-tag">${escapeHtmlSummary(s)}</span>`).join('')
        : '<span style="opacity: 0.5;">No especificado</span>';

    const usernamePreview = formatUsername(data.artistic_name);
    const fullNameCapitalized = capitalizeWords(data.full_name);
    if (fullNameCapitalized && fullNameCapitalized !== data.full_name) {
        data.full_name = fullNameCapitalized;
    }

    const summarySessionPrice = normalizeSessionPriceAmount(data.session_price);
    const summarySessionCurrency = data.session_currency
        || extractSessionPriceCurrency(data.session_price)
        || 'USD';
    const priceDisplay = summarySessionPrice
        ? `${escapeHtmlSummary(summarySessionPrice)} ${escapeHtmlSummary(summarySessionCurrency)}`
        : '<span style="opacity: 0.5;">No especificado</span>';
    const registrationCity = getRegistrationCity();
    const registrationCityDisplay = registrationCity
        ? escapeHtmlSummary(registrationCity)
        : '<span style="opacity: 0.5;">No especificado</span>';

    // Format birth date as DD/MM/YYYY
    let birthDateDisplay = '<span style="opacity: 0.5;">No especificado</span>';
    if (data.birth_date) {
        if (data.birth_date.includes('-')) {
            const [year, month, day] = data.birth_date.split('-');
            birthDateDisplay = `${day}/${month}/${year}`;
        } else if (data.birth_date.includes('/') && data.birth_date.length === 10) {
            birthDateDisplay = data.birth_date;
        }
    }

    const newsletterDisplay = data.subscribed_newsletter
        ? '<span style="color: #4CAF50;">Suscrito</span>'
        : '<span style="opacity: 0.5;">No suscrito</span>';
    const mediaCounts = getPortfolioMediaCounts();
    const mediaDisplay = (mediaCounts.photos || mediaCounts.videos)
        ? `${mediaCounts.photos} foto(s) · ${mediaCounts.videos} video(s)`
        : '<span style="opacity: 0.5;">Sin medios cargados</span>';

    // Helper: render an editable cell. Shows a persistent "Editar" chip so
    // the affordance is obvious without hover. The click handler in
    // setupSummaryEditing() swaps the cell to an input/textarea on demand.
    // SVG used inline because Font Awesome is not loaded in this page.
    const pencilSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
    const editChip = `<span class="summary-edit-action" aria-hidden="true">${pencilSvg}<span>Editar</span></span>`;

    function editable(value, attrs) {
        const display = value == null || value === '' ? '<span style="opacity: 0.5;">No especificado</span>' : escapeHtmlSummary(value);
        const dataAttrs = Object.entries(attrs)
            .map(([k, v]) => `data-${k}="${escapeHtmlSummary(v)}"`)
            .join(' ');
        return `<div class="summary-value summary-editable" ${dataAttrs} title="Click para editar"><span class="summary-value-text">${display}</span>${editChip}</div>`;
    }

    const portfolioSummary = resolvePortfolioLinks(usernamePreview);
    let portfolioLabel = 'Portfolio';
    let portfolioEditableHtml = `<div class="summary-value summary-readonly">${portfolioSummary.displayLabel || '<span style="opacity: 0.5;">No especificado</span>'}</div>`;
    if (data.portfolio_source === 'instagram') {
        portfolioLabel = 'Instagram';
        portfolioEditableHtml = editable(portfolioSummary.displayLabel || '', { 'edit-field': 'instagram_handle', 'edit-type': 'instagram' });
    }

    // Non-editable: complex multi-field cells link back to the relevant step.
    function jumpToStep(label, step) {
        return `<div class="summary-value summary-jump" data-jump-step="${step}" title="Editar este campo"><span class="summary-value-text">${label}</span>${editChip}</div>`;
    }

    summaryCard.innerHTML = `
        <div class="summary-row">
            <div class="summary-label">Nombre artistico</div>
            ${editable(data.artistic_name || '', { 'edit-field': 'artistic_name', 'edit-type': 'text' })}
        </div>
        <div class="summary-row">
            <div class="summary-label">Username</div>
            <div class="summary-value summary-readonly" style="color: var(--primary-blue);" title="Se genera del nombre artístico">${escapeHtmlSummary(usernamePreview || '-')}</div>
        </div>
        <div class="summary-row">
            <div class="summary-label">Nombre completo</div>
            ${editable(fullNameCapitalized || '', { 'edit-field': 'full_name', 'edit-type': 'text' })}
        </div>
        <div class="summary-row">
            <div class="summary-label">Email</div>
            ${editable(data.email || '', { 'edit-field': 'email', 'edit-type': 'email' })}
        </div>
        <div class="summary-row">
            <div class="summary-label">Ciudad</div>
            ${jumpToStep(registrationCityDisplay, 9)}
        </div>
        <div class="summary-row">
            <div class="summary-label">Estilos</div>
            ${jumpToStep(stylesHtml, 4)}
        </div>
        <div class="summary-row">
            <div class="summary-label">Experiencia</div>
            ${editable((data.experience_years || '') + (data.experience_years ? ' anos' : ''), { 'edit-field': 'experience_years', 'edit-type': 'number' })}
        </div>
        <div class="summary-row">
            <div class="summary-label">Tarifa por sesion</div>
            <div class="summary-value summary-editable" data-edit-field="session_price" data-edit-type="number" title="Click para editar el monto"><span class="summary-value-text">${priceDisplay}</span>${editChip}</div>
        </div>
        <div class="summary-row">
            <div class="summary-label">${portfolioLabel}</div>
            ${portfolioEditableHtml}
        </div>
        <div class="summary-row">
            <div class="summary-label">Fotos / videos</div>
            <div class="summary-value summary-readonly summary-media-value"><span class="summary-value-text">${mediaDisplay}</span><button type="button" class="summary-media-edit" data-summary-media-edit aria-label="Editar fotos y videos">${pencilSvg}<span>Editar</span></button></div>
        </div>
        <div class="summary-row">
            <div class="summary-label">Bio</div>
            <div class="summary-value summary-editable bio-value" data-edit-field="bio" data-edit-type="textarea" title="Click para editar tu biografía"><span class="summary-value-text">${window.BioFormatting ? window.BioFormatting.sanitizeBioHtml(data.bio) || '<span style="opacity: 0.5;">No especificado</span>' : escapeHtmlSummary(data.bio || '') || '<span style="opacity: 0.5;">No especificado</span>'}</span>${editChip}</div>
        </div>
        <div class="summary-row">
            <div class="summary-label">Modalidad</div>
            ${jumpToStep(escapeHtmlSummary(workTypeDisplay), 9)}
        </div>
        <div class="summary-row">
            <div class="summary-label">Fecha de nacimiento</div>
            ${jumpToStep(birthDateDisplay, 10)}
        </div>
        <div class="summary-row">
            <div class="summary-label">Newsletter</div>
            ${jumpToStep(newsletterDisplay, 11)}
        </div>
    `;

    setupSummaryEditing();
}

// Wire click handlers on the summary card. We use event delegation so
// re-renders don't require re-binding. The card calls populateSummary()
// after each save which preserves attributes/handlers via this single
// listener.
let _summaryEditingWired = false;
function setupSummaryEditing() {
    if (_summaryEditingWired) return;
    const card = document.getElementById('summary-card');
    if (!card) return;
    card.addEventListener('click', (e) => {
        const mediaEdit = e.target.closest('[data-summary-media-edit]');
        if (mediaEdit) {
            e.preventDefault();
            openPortfolioMediaModal();
            return;
        }
        const cell = e.target.closest('.summary-editable');
        if (cell) return startEditCell(cell);
        const jump = e.target.closest('.summary-jump');
        if (jump) {
            const step = parseInt(jump.dataset.jumpStep, 10);
            if (Number.isFinite(step)) {
                closeSummaryReviewModal({ restoreFocus: false });
                goToStep(step);
            }
        }
    });
    _summaryEditingWired = true;
}

function startEditCell(cell) {
    if (cell.dataset.editing === 'true') return;
    const field = cell.dataset.editField;
    const type = cell.dataset.editType || 'text';
    if (!field) return;

    const currentValue = formState.data[field] != null ? String(formState.data[field]) : '';

    cell.dataset.editing = 'true';
    cell.classList.add('summary-editing');
    cell.innerHTML = '';

    let input;
    if (type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = 4;
    } else {
        input = document.createElement('input');
        input.type = type === 'number' ? 'number' : type === 'email' ? 'email' : 'text';
    }
    input.value = currentValue;
    input.className = 'summary-edit-input';
    cell.appendChild(input);

    const controls = document.createElement('div');
    controls.className = 'summary-edit-controls';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'summary-edit-save';
    saveBtn.textContent = 'Guardar';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'summary-edit-cancel';
    cancelBtn.textContent = 'Cancelar';
    controls.append(saveBtn, cancelBtn);
    cell.appendChild(controls);

    function commit() {
        if (cell.dataset.editing !== 'true') return;
        const newValue = type === 'number' ? input.value.replace(/[^\d.]/g, '') : input.value.trim();
        let valueToStore = newValue;
        if (field === 'instagram_handle') {
            valueToStore = newValue.replace(/^@+/, '').replace(/\s+/g, '');
            formState.data.portfolio_source = 'instagram';
            document.querySelectorAll('.portfolio-source-option').forEach(b => b.classList.remove('selected'));
            const instagramSource = document.querySelector('.portfolio-source-option[data-source="instagram"]');
            if (instagramSource) instagramSource.classList.add('selected');
            const urlWrapper = document.getElementById('portfolio-url-wrapper');
            const igWrapper = document.getElementById('portfolio-ig-wrapper');
            if (urlWrapper) urlWrapper.style.display = 'none';
            if (igWrapper) igWrapper.style.display = 'block';
        }

        // Validation per type — keep loose, the wizard's own per-step
        // validation is the source of truth. Here we just block obvious
        // garbage from getting saved on summary.
        if (type === 'email' && valueToStore && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valueToStore)) {
            input.style.borderColor = '#d33';
            input.focus();
            return;
        }

        formState.data[field] = valueToStore;

        // Side effects: mirror to the wizard input for this field if it
        // exists, so the user sees consistent state if they navigate back.
        const wizardInput = document.getElementById(field);
        if (wizardInput) {
            if (wizardInput.tagName === 'DIV' && wizardInput.contentEditable === 'true') {
                // Bio editor (contenteditable)
                const bioHtml = valueToStore
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/\n/g, '<br>');
                wizardInput.innerHTML = bioHtml;
            } else {
                wizardInput.value = valueToStore;
            }
            wizardInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        persistRegistrationDraft();
        delete cell.dataset.editing;
        populateSummary(); // re-render the whole card
    }

    function cancel() {
        delete cell.dataset.editing;
        populateSummary();
    }

    saveBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
    saveBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        commit();
    });
    cancelBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
    cancelBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        cancel();
    });
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && type !== 'textarea') {
            ev.preventDefault();
            input.blur();
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            cancel();
        }
    });
    setTimeout(() => { input.focus(); input.select && input.select(); }, 50);
}

// ============================================
// Form Submission
// ============================================

async function finalizePreAuthRegistration(username) {
    const email = String(formState.data.email || '').trim().toLowerCase();
    const password = String(formState.data.signup_password || '');
    if (!email || !password) {
        throw new Error('Faltan email o contrasena.');
    }
    if (!registrationDraftId) {
        const draft = await saveRegistrationDraftToServer({ force: true });
        if (!draft?.draft_id) throw new Error('No se pudo crear el borrador de registro.');
    } else {
        await saveRegistrationDraftToServer({ force: true });
    }
    prepareRegistrationLocationData();

    const checkRes = await fetch(apiUrl('/api/register/check-uniqueness'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            draft_id: registrationDraftId,
            email,
            username,
            instagram: String(formState.data.instagram_handle || '').replace(/^@/, '')
        })
    });
    const checkData = await readJsonResponse(checkRes);
    if (checkRes.ok && checkData.success && !checkData.available) {
        const labels = {
            email: 'el email',
            username: 'el nombre artistico (username)',
            instagram: 'el usuario de Instagram'
        };
        const conflicting = (checkData.conflicts || []).map(c => labels[c] || c).join(' y ');
        const error = new Error('Ya existe una cuenta con ' + conflicting + '. Elegi valores distintos o inicia sesion con esa cuenta.');
        error.code = 'REGISTRATION_CONFLICT';
        throw error;
    }

    const finalizeRes = await fetch(apiUrl('/api/register/artist-finalize'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            draft_id: registrationDraftId,
            source: registrationSource,
            email,
            password,
            data: { ...formState.data, registration_source: registrationSource }
        })
    });
    const finalizeData = await readJsonResponse(finalizeRes);
    if (!finalizeRes.ok || !finalizeData.success) {
        const error = new Error(finalizeData.error || 'No se pudo finalizar el registro.');
        error.conflicts = finalizeData.conflicts || [];
        throw error;
    }
    return finalizeData;
}

const MIN_REGISTRATION_WAIT_MS = 10000;
const REGISTRATION_EMAIL_TIMEOUT_MS = 8000;
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function startRegistrationWaitScreen() {
    goToStep('saving');
    return Date.now();
}

async function finishRegistrationWaitScreen(startedAt) {
    const elapsed = Date.now() - (startedAt || Date.now());
    const remaining = Math.max(0, MIN_REGISTRATION_WAIT_MS - elapsed);
    if (remaining > 0) await wait(remaining);
}

function sendArtistRegistrationCompletedEvent(payload) {
    const eventId = 'artist_registration_completed';
    const warnFailure = (err) => {
        console.warn('Could not send artist_registration_completed event:', err);
    };

    try {
        let dispatch = null;
        if (window.EmailClient && typeof window.EmailClient.sendEmail === 'function') {
            dispatch = window.EmailClient.sendEmail(eventId, payload, {
                timeoutMs: REGISTRATION_EMAIL_TIMEOUT_MS,
                keepalive: true
            });
        } else if (window.ConfigManager && typeof window.ConfigManager.sendN8NEvent === 'function') {
            dispatch = window.ConfigManager.sendN8NEvent(eventId, payload);
        }

        if (dispatch && typeof dispatch.then === 'function') {
            dispatch.then((result) => {
                if (result && result.success === false) warnFailure(result.error || result);
            }).catch(warnFailure);
        }
    } catch (err) {
        warnFailure(err);
    }
}

async function submitForm() {
    // Validate terms acceptance first — applies to all flows.
    if (!formState.data.terms_accepted) {
        alert('Debes aceptar los terminos y condiciones para continuar.');
        const termsCheckbox = document.getElementById('terms-checkbox');
        if (termsCheckbox) termsCheckbox.focus();
        return;
    }
    prepareRegistrationLocationData();

    btnNext.disabled = true;
    btnNext.innerHTML = `<span>Guardando...</span>`;
    const waitStartedAt = startRegistrationWaitScreen();

    if (formState.preAuthMode) {
        try {
            const requestedReturnTo = window.ArtistAuth?.getReturnTo(window.location.search, '') || '';
            const authUrls = window.ArtistAuth?.getRouteUrls(window.ConfigManager, requestedReturnTo) || {
                registerClosedBeta: '/registerclosedbeta',
                dashboard: '/artist/dashboard'
            };
            const username = formatUsername(formState.data.artistic_name);
            const fullNameCapitalized = capitalizeWords(formState.data.full_name);
            const sessionPriceFormatted = formState.data.session_price
                ? `${formState.data.session_price} ${formState.data.session_currency}`
                : null;
            const resolved = resolvePortfolioLinks(username);
            const finalBirthDate = formState.data.birth_date && /^\d{4}-\d{2}-\d{2}$/.test(formState.data.birth_date)
                ? formState.data.birth_date
                : null;
            const registrationCity = getRegistrationCity();
            const registrationCountry = getRegistrationCountry();
            const newEmail = String(formState.data.email || '').trim().toLowerCase();
            const newPassword = String(formState.data.signup_password || '');
            let postRegistrationUrl = authUrls.dashboard;

            const finalizeData = await finalizePreAuthRegistration(username);
            currentUser = { id: finalizeData.user_id, email: formState.data.email };

            // The finalize endpoint creates the auth user server-side via the
            // admin API, which does NOT establish a browser session. We sign
            // into the newly-created account before showing success so the
            // same wait screen covers account creation, session swap and media
            // persistence.
            try {
                await _supabase.auth.signOut().catch(() => {});
                if (newEmail && newPassword) {
                    const { data: signInData, error: signInError } = await _supabase.auth.signInWithPassword({
                        email: newEmail,
                        password: newPassword
                    });
                    if (signInError) throw signInError;
                    if (signInData?.user) currentUser = signInData.user;
                } else {
                    throw new Error('Missing credentials for auto sign-in.');
                }
            } catch (signInErr) {
                console.warn('Auto sign-in after registration failed:', signInErr?.message || signInErr);
                const loginUrl = newEmail
                    ? `${authUrls.registerClosedBeta}${authUrls.registerClosedBeta.includes('?') ? '&' : '?'}email=${encodeURIComponent(newEmail)}`
                    : authUrls.registerClosedBeta;
                postRegistrationUrl = loginUrl;
            }

            await persistSelectedStudioLocation(finalizeData.artist?.studio_id || formState.data.studio_id);

            try {
                await persistPortfolioMedia();
            } catch (mediaErr) {
                console.warn('Portfolio media persistence failed:', mediaErr);
            }

            clearRegistrationDraft();
            clearInstagramSignupFlag();

            sendArtistRegistrationCompletedEvent({
                email: formState.data.email,
                username,
                // The cleartext password the artist just chose in the
                // wizard. n8n uses this to send the credentials email.
                // It is also mirrored to artists_db.password by the
                // finalize endpoint.
                password: formState.data.signup_password || null,
                user_id: finalizeData.user_id,
                registration_status: finalizeData.registration_status || 'pendiente de validacion',
                name: fullNameCapitalized,
                artistic_name: formState.data.artistic_name,
                city: registrationCity || null,
                country: registrationCountry || null,
                ubicacion: registrationCity || null,
                styles: formState.data.styles || [],
                styles_text: (formState.data.styles || []).join(', '),
                studio: formState.data.work_type === 'independent'
                    ? 'Sin estudio/Independiente'
                    : (formState.data.studio_name || null),
                work_type: formState.data.work_type || null,
                session_price: sessionPriceFormatted,
                session_price_amount: formState.data.session_price || null,
                session_price_currency: formState.data.session_currency || null,
                years_experience: formState.data.experience_years || null,
                bio: formState.data.bio || null,
                portfolio_url: resolved.portafolio,
                instagram: resolved.instagram,
                portfolio_source: formState.data.portfolio_source || null,
                birth_date: finalBirthDate,
                subscribed_newsletter: formState.data.subscribed_newsletter || false,
                dashboard_url: finalizeData.dashboard_url || (window.location.origin + appUrl(authUrls.dashboard)),
                profile_url: finalizeData.profile_url || resolved.profileUrl,
                login_url: finalizeData.login_url || (window.location.origin + appUrl(authUrls.registerClosedBeta))
            });

            await finishRegistrationWaitScreen(waitStartedAt);
            btnNext.disabled = false;
            goToStep('success');
            setTimeout(() => {
                window.location.href = appUrl(postRegistrationUrl);
            }, 3000);
            return;
        } catch (error) {
            console.error('Error finalizing pre-auth registration:', error);
            btnNext.disabled = false;
            btnNext.innerHTML = `Continuar`;
            goToStep('summary');
            alert(error.message || 'No se pudo finalizar el registro. Intenta de nuevo.');
            return;
        }
    }

    if (!currentUser) {
        console.error('No authenticated user');
        btnNext.disabled = false;
        goToStep('summary');
        return;
    }

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

        // Persist the structured address. For studio/both, write it to the
        // studios row we just resolved. For independent, it belongs on the
        // artist row itself (added to artistData below).
        const pickedAddress = formState.data.address || null;
        if (resolvedStudioId && pickedAddress && pickedAddress.formatted_address && !formState.data.studio_location_id) {
            try {
                await _supabase.from('studios').update({
                    country:           pickedAddress.country || null,
                    country_code:      pickedAddress.country_code || null,
                    state_province:    pickedAddress.state_province || null,
                    city:              pickedAddress.city || null,
                    locality:          pickedAddress.locality || null,
                    street:            pickedAddress.street || null,
                    street_number:     pickedAddress.street_number || null,
                    unit:              pickedAddress.unit || null,
                    postal_code:       pickedAddress.postal_code || null,
                    formatted_address: pickedAddress.formatted_address || null,
                    latitude:          Number.isFinite(pickedAddress.latitude)  ? pickedAddress.latitude  : null,
                    longitude:         Number.isFinite(pickedAddress.longitude) ? pickedAddress.longitude : null,
                    google_place_id:   pickedAddress.google_place_id || null,
                    geocoded_at:       new Date().toISOString()
                }).eq('id', resolvedStudioId);
            } catch (addrErr) {
                console.warn('[register] Could not persist studio address:', addrErr);
            }
        }

        // Final validation of birth_date to prevent "INVALID DATE" errors in DB
        let finalBirthDate = null;
        if (formState.data.birth_date && /^\d{4}-\d{2}-\d{2}$/.test(formState.data.birth_date)) {
            finalBirthDate = formState.data.birth_date;
        }

        const resolved = resolvePortfolioLinks(username);
        const registrationCity = getRegistrationCity();
        const registrationCountry = getRegistrationCountry();

        // For independent artists, include their own structured address.
        // For studio/both artists we leave these null — the view falls back
        // to the studio's address.
        const isIndependentLocation = formState.data.work_type === 'independent';
        const selectedAddress = formState.data.address || {};
        const indepAddress = isIndependentLocation ? selectedAddress : {};

        const artistData = {
            user_id: currentUser.id,
            email: formState.data.email,
            name: fullNameCapitalized,
            username: username,
            ubicacion: registrationCity || null,
            city: registrationCity || null,
            country: registrationCountry || null,
            country_code:      indepAddress.country_code      || null,
            state_province:    indepAddress.state_province    || null,
            locality:          indepAddress.locality          || null,
            street:            indepAddress.street            || null,
            street_number:     indepAddress.street_number     || null,
            unit:              indepAddress.unit              || null,
            postal_code:       indepAddress.postal_code       || null,
            formatted_address: indepAddress.formatted_address || null,
            google_place_id:   indepAddress.google_place_id   || null,
            latitude:          Number.isFinite(indepAddress.latitude)  ? indepAddress.latitude  : null,
            longitude:         Number.isFinite(indepAddress.longitude) ? indepAddress.longitude : null,
            geocoded_at:       isIndependentLocation && indepAddress.formatted_address
                                  ? new Date().toISOString()
                                  : null,
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
            session_price_amount: formState.data.session_price ? parseFloat(formState.data.session_price) || null : null,
            session_price_currency: formState.data.session_currency || null,
            birth_date: finalBirthDate,
            subscribed_newsletter: formState.data.subscribed_newsletter,
            years_experience: formState.data.experience_years || null
        };
        // NOTE: we deliberately do NOT write `password` here. The auth.users
        // password is the source of truth for login, and the artists_db
        // cleartext mirror is populated by the registration wizard's
        // preAuth/finalize endpoints (or by the dashboard "change password"
        // flow). Writing a placeholder here would desync the mirror from
        // the user's actual login credential.

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

        await persistSelectedStudioLocation(resolvedStudioId);

        // [CH-15] Update Supabase Auth display_name metadata
        try {
            await _supabase.auth.updateUser({
                data: { display_name: fullNameCapitalized }
            });
            console.log('Auth display_name updated:', fullNameCapitalized);
        } catch (authError) {
            console.warn('Could not update auth display_name:', authError);
        }

        // Persist any portfolio media (IG imports + local uploads) to
        // Storage now that the user is authenticated and the row exists.
        // Failures are non-fatal — the user lands on success either way.
        try {
            await persistPortfolioMedia();
        } catch (mediaErr) {
            console.warn('Portfolio media persistence failed:', mediaErr);
        }

        clearRegistrationDraft();

        // Trigger n8n webhook for artist registration completed.
        // For the credentials email we send the *real* password the artist
        // chose at registration (now mirrored in artists_db.password). For
        // legacy users who completed a stub without ever setting one, we
        // send null and let n8n handle the absence (e.g. include a password
        // reset link instead of the cleartext).
        const savedArtistRow = Array.isArray(data) && data[0] ? data[0] : null;
        const credentialPassword = savedArtistRow?.password
            || loadedArtistRecord?.password
            || formState.data.signup_password
            || null;
        sendArtistRegistrationCompletedEvent({
            // Account info
            email: formState.data.email,
            username: username,
            password: credentialPassword,
            user_id: currentUser.id,
            // Profile summary
            name: fullNameCapitalized,
            artistic_name: formState.data.artistic_name,
            city: registrationCity || null,
            country: registrationCountry || null,
            ubicacion: registrationCity || null,
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
            dashboard_url: window.location.origin + appUrl(authUrls.dashboard),
            profile_url: resolved.profileUrl,
            login_url: window.location.origin + appUrl(authUrls.registerClosedBeta)
        });

        await finishRegistrationWaitScreen(waitStartedAt);
        btnNext.disabled = false;
        goToStep('success');

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
            goToStep('summary');
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
        const activeStep = formWrapper.querySelector('.form-step.active');
        const activeHeight = activeStep ? activeStep.scrollHeight : formWrapper.scrollHeight;
        const isScrollable = activeHeight > formWrapper.clientHeight - 24;
        const isAtBottom = formWrapper.scrollTop + formWrapper.clientHeight >= formWrapper.scrollHeight - 20;

        formWrapper.classList.toggle('is-step-scrollable', isScrollable);
        if (!isScrollable && formWrapper.scrollTop !== 0) {
            formWrapper.scrollTop = 0;
        }
        
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
function getBioMobilePreviewText(rawHtml, editor) {
    const plain = window.BioFormatting
        ? window.BioFormatting.bioHtmlToPlainText(rawHtml || '')
        : (editor ? editor.textContent.trim() : '');
    if (!plain) return '';
    return window.BioFormatting
        ? window.BioFormatting.truncatePlainText(plain, 180)
        : plain.slice(0, 180);
}

function updateBioMobilePreview() {
    const bioEditor = document.getElementById('bio');
    const preview = document.getElementById('bio-mobile-preview');
    const trigger = document.getElementById('bio-mobile-open');
    if (!bioEditor || !preview || !trigger) return;

    const text = getBioMobilePreviewText(formState.data.bio || bioEditor.innerHTML, bioEditor);
    const hasBio = Boolean(text);
    trigger.classList.toggle('has-bio', hasBio);
    preview.textContent = hasBio ? text : 'Toca para escribir tu bio.';
}

function isBioMobileViewport() {
    return window.matchMedia
        ? window.matchMedia('(max-width: 600px)').matches
        : window.innerWidth <= 600;
}

// Sets up the Bauhaus-style toolbar and contenteditable area
function initRichTextEditor() {
    const bioEditor = document.getElementById('bio');
    const toolbar = document.querySelector('.bio-toolbar');
    const emojiPicker = document.getElementById('emoji-picker');
    const emojiTrigger = document.getElementById('emoji-trigger');
    const bioModal = document.getElementById('bio-editor-modal') || bioEditor?.closest('.bio-editor-wrapper');
    const bioMobileOpen = document.getElementById('bio-mobile-open');
    const bioModalClose = document.getElementById('bio-modal-close');
    let bioModalReturnFocus = null;
    const bioModalHome = {
        parent: bioModal ? bioModal.parentNode : null,
        nextSibling: bioModal ? bioModal.nextSibling : null
    };
    
    if (!bioEditor || !toolbar) return;

    function openBioModal() {
        if (!bioModal) return;
        if (!isBioMobileViewport()) {
            bioEditor.focus();
            return;
        }

        bioModalReturnFocus = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : bioMobileOpen;
        if (bioModal.parentNode !== document.body) {
            bioModalHome.parent = bioModal.parentNode;
            bioModalHome.nextSibling = bioModal.nextSibling;
            document.body.appendChild(bioModal);
        }
        bioModal.classList.add('bio-modal-open');
        bioModal.setAttribute('role', 'dialog');
        bioModal.setAttribute('aria-modal', 'true');
        bioModal.setAttribute('aria-labelledby', 'bio-modal-title');
        document.body.classList.add('bio-modal-lock');
        if (bioMobileOpen) bioMobileOpen.setAttribute('aria-expanded', 'true');
        requestAnimationFrame(() => bioEditor.focus());
    }

    function closeBioModal(options = {}) {
        if (!bioModal || !bioModal.classList.contains('bio-modal-open')) return;
        syncBioContent({ normalizeEditor: true });
        updateBioMobilePreview();
        if (bioModalHome.parent && bioModal.parentNode === document.body) {
            bioModalHome.parent.insertBefore(bioModal, bioModalHome.nextSibling);
        }
        bioModal.classList.remove('bio-modal-open');
        bioModal.removeAttribute('role');
        bioModal.removeAttribute('aria-modal');
        bioModal.removeAttribute('aria-labelledby');
        document.body.classList.remove('bio-modal-lock');
        if (bioMobileOpen) bioMobileOpen.setAttribute('aria-expanded', 'false');
        if (options.restoreFocus !== false && bioModalReturnFocus) {
            bioModalReturnFocus.focus();
        }
    }

    if (bioMobileOpen) {
        bioMobileOpen.setAttribute('aria-expanded', 'false');
        bioMobileOpen.addEventListener('click', openBioModal);
    }
    if (bioModalClose) {
        bioModalClose.addEventListener('click', () => closeBioModal());
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeBioModal();
    });
    if (window.matchMedia) {
        const mobileQuery = window.matchMedia('(max-width: 600px)');
        const onViewportChange = (e) => {
            if (!e.matches) closeBioModal({ restoreFocus: false });
        };
        if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', onViewportChange);
        else if (mobileQuery.addListener) mobileQuery.addListener(onViewportChange);
    }
    updateBioMobilePreview();

    // Handle color picker changes
    // We save/restore the selection because toolbar controls steal focus from
    // the contenteditable on mobile Safari/Chrome.
    const textColorPicker = document.getElementById('text-color-picker');
    const bgColorPicker = document.getElementById('bg-color-picker');
    let savedSelection = null;
    const editorHistory = {
        undoStack: [],
        redoStack: [],
        isRestoring: false
    };
    const activeInlineFormats = {
        bold: false,
        italic: false,
        underline: false,
        strikeThrough: false,
        color: '',
        backgroundColor: ''
    };

    function selectionBelongsToEditor(range) {
        return bioEditor.contains(range.commonAncestorContainer)
            || range.commonAncestorContainer === bioEditor;
    }

    function saveSelectionFromEditor() {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && selectionBelongsToEditor(sel.getRangeAt(0))) {
            savedSelection = sel.getRangeAt(0).cloneRange();
        }
    }

    function restoreSelection() {
        bioEditor.focus();
        if (savedSelection) {
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(savedSelection);
        }
    }

    function normalizeEditorUrl(rawUrl) {
        const trimmed = String(rawUrl || '').trim();
        if (!trimmed || trimmed === 'https://') return '';
        if (/^(https?:|mailto:)/i.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('#')) {
            return trimmed;
        }
        return 'https://' + trimmed;
    }

    function getCurrentSelectedText() {
        const sel = window.getSelection();
        return sel && sel.rangeCount > 0 ? sel.toString().trim() : '';
    }

    function hasActiveInlineFormats() {
        return activeInlineFormats.bold
            || activeInlineFormats.italic
            || activeInlineFormats.underline
            || activeInlineFormats.strikeThrough
            || Boolean(activeInlineFormats.color)
            || Boolean(activeInlineFormats.backgroundColor);
    }

    function setCaretRange(range) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        savedSelection = range.cloneRange();
    }

    function moveCaretToEditorEnd() {
        const range = document.createRange();
        range.selectNodeContents(bioEditor);
        range.collapse(false);
        bioEditor.focus();
        setCaretRange(range);
    }

    function updateHistoryButtons() {
        const undoBtn = toolbar.querySelector('[data-command="undo"]');
        const redoBtn = toolbar.querySelector('[data-command="redo"]');
        if (undoBtn) undoBtn.disabled = editorHistory.undoStack.length <= 1;
        if (redoBtn) redoBtn.disabled = editorHistory.redoStack.length === 0;
    }

    function recordEditorHistory(options = {}) {
        if (editorHistory.isRestoring) return;
        const current = bioEditor.innerHTML;
        const last = editorHistory.undoStack[editorHistory.undoStack.length - 1];
        if (current === last) {
            updateHistoryButtons();
            return;
        }
        editorHistory.undoStack.push(current);
        if (editorHistory.undoStack.length > 60) editorHistory.undoStack.shift();
        if (!options.keepRedo) editorHistory.redoStack = [];
        updateHistoryButtons();
    }

    function restoreEditorHistory(direction) {
        const undoing = direction === 'undo';
        const fromStack = undoing ? editorHistory.undoStack : editorHistory.redoStack;
        const toStack = undoing ? editorHistory.redoStack : editorHistory.undoStack;
        if (undoing && fromStack.length <= 1) return false;
        if (!undoing && fromStack.length === 0) return false;

        editorHistory.isRestoring = true;
        if (undoing) {
            toStack.push(fromStack.pop());
            bioEditor.innerHTML = fromStack[fromStack.length - 1] || '';
        } else {
            const next = fromStack.pop();
            toStack.push(next);
            bioEditor.innerHTML = next || '';
        }
        syncBioContent({ normalizeEditor: true });
        updateBioMobilePreview();
        moveCaretToEditorEnd();
        editorHistory.isRestoring = false;
        updateHistoryButtons();
        return true;
    }

    function buildFormattedInlineNode(text) {
        let node = document.createTextNode(text);
        if (activeInlineFormats.strikeThrough) {
            const strike = document.createElement('s');
            strike.appendChild(node);
            node = strike;
        }
        if (activeInlineFormats.underline) {
            const underline = document.createElement('u');
            underline.appendChild(node);
            node = underline;
        }
        if (activeInlineFormats.italic) {
            const italic = document.createElement('em');
            italic.appendChild(node);
            node = italic;
        }
        if (activeInlineFormats.bold) {
            const bold = document.createElement('strong');
            bold.appendChild(node);
            node = bold;
        }
        if (activeInlineFormats.color || activeInlineFormats.backgroundColor) {
            const span = document.createElement('span');
            if (activeInlineFormats.color) span.style.color = activeInlineFormats.color;
            if (activeInlineFormats.backgroundColor) span.style.backgroundColor = activeInlineFormats.backgroundColor;
            span.appendChild(node);
            node = span;
        }
        return node;
    }

    function getFormatTags(formatName) {
        if (formatName === 'bold') return ['strong', 'b'];
        if (formatName === 'italic') return ['em', 'i'];
        if (formatName === 'underline') return ['u'];
        if (formatName === 'strikeThrough') return ['s', 'strike', 'del'];
        return [];
    }

    function findFormatAncestor(formatName) {
        restoreSelection();
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const range = sel.getRangeAt(0);
        if (!selectionBelongsToEditor(range)) return null;

        const tags = getFormatTags(formatName);
        let node = range.startContainer.nodeType === Node.ELEMENT_NODE
            ? range.startContainer
            : range.startContainer.parentElement;
        while (node && node !== bioEditor) {
            if (tags.includes(node.tagName.toLowerCase())) return node;
            node = node.parentElement;
        }
        return null;
    }

    function moveCaretOutsideFormat(formatName) {
        const ancestor = findFormatAncestor(formatName);
        if (!ancestor) return;
        const range = document.createRange();
        range.setStartAfter(ancestor);
        range.collapse(true);
        setCaretRange(range);
    }

    function insertFormattedTextAtCaret(text) {
        restoreSelection();
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return false;

        const range = sel.getRangeAt(0);
        if (!selectionBelongsToEditor(range)) return false;

        range.deleteContents();
        const node = buildFormattedInlineNode(text);
        range.insertNode(node);

        const nextRange = document.createRange();
        nextRange.setStartAfter(node);
        nextRange.collapse(true);
        setCaretRange(nextRange);
        return true;
    }

    function setInlineFormat(formatName, enabled) {
        if (!Object.hasOwn(activeInlineFormats, formatName)) return;
        activeInlineFormats[formatName] = Boolean(enabled);
        const btn = toolbar.querySelector(`[data-command="${formatName}"]`);
        if (btn) btn.setAttribute('aria-pressed', String(activeInlineFormats[formatName]));
        if (!enabled) moveCaretOutsideFormat(formatName);
    }

    function toggleInlineFormat(formatName) {
        if (!Object.hasOwn(activeInlineFormats, formatName)) return;
        const currentlyEnabled = activeInlineFormats[formatName] || Boolean(findFormatAncestor(formatName));
        setInlineFormat(formatName, !currentlyEnabled);
    }

    function wrapSelectionWithElement(tagName, options = {}) {
        restoreSelection();
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return false;

        const range = sel.getRangeAt(0);
        if (!selectionBelongsToEditor(range)) return false;

        const wrapper = document.createElement(tagName);
        if (options.href) {
            wrapper.setAttribute('href', options.href);
            wrapper.setAttribute('target', '_blank');
            wrapper.setAttribute('rel', 'noopener noreferrer');
        }
        if (options.style) {
            Object.assign(wrapper.style, options.style);
        }

        if (range.collapsed) {
            const text = options.text || '';
            if (!text) return false;
            wrapper.textContent = text;
            range.insertNode(wrapper);
        } else {
            const selectedContent = range.extractContents();
            wrapper.appendChild(selectedContent);
            range.insertNode(wrapper);
        }

        const nextRange = document.createRange();
        nextRange.selectNodeContents(wrapper);
        setCaretRange(nextRange);
        bioEditor.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }

    function applyToolbarCommand(command) {
        switch (command) {
            case 'undo':
                return restoreEditorHistory('undo');
            case 'redo':
                return restoreEditorHistory('redo');
            case 'bold':
                if (!wrapSelectionWithElement('strong')) toggleInlineFormat('bold');
                return true;
            case 'italic':
                if (!wrapSelectionWithElement('em')) toggleInlineFormat('italic');
                return true;
            case 'underline':
                if (!wrapSelectionWithElement('u')) toggleInlineFormat('underline');
                return true;
            case 'strikeThrough':
                if (!wrapSelectionWithElement('s')) toggleInlineFormat('strikeThrough');
                return true;
            case 'createLink': {
                restoreSelection();
                const selectedText = getCurrentSelectedText();
                const url = prompt('Ingresa la URL del enlace:', 'https://');
                const href = normalizeEditorUrl(url);
                if (!href) return false;
                restoreSelection();
                return wrapSelectionWithElement('a', {
                    href: href,
                    text: selectedText || href
                });
            }
            default:
                return false;
        }
    }

    document.addEventListener('selectionchange', saveSelectionFromEditor);
    bioEditor.addEventListener('keyup', saveSelectionFromEditor);
    bioEditor.addEventListener('mouseup', saveSelectionFromEditor);
    bioEditor.addEventListener('touchend', saveSelectionFromEditor);
    recordEditorHistory({ keepRedo: true });

    // Preserve selection for mouse users without cancelling iPhone touch clicks.
    toolbar.addEventListener('mousedown', (e) => {
        const btn = e.target.closest('.toolbar-btn');
        if (btn && !btn.classList.contains('color-btn')) e.preventDefault();
    });

    // Handle toolbar button clicks
    toolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('.toolbar-btn');
        if (!btn) return;
        if (btn.disabled) return;
        
        e.preventDefault();
        const command = btn.dataset.command;
        
        if (!command) return;
        
        if (command === 'foreColor' || command === 'hiliteColor') {
            // Color commands are handled by the color input
            return;
        }

        applyToolbarCommand(command);

        // Sync content to form state
        syncBioContent();
        updateBioMobilePreview();
        
        // Refocus editor
        bioEditor.focus();
        saveSelectionFromEditor();
    });

    // Save selection when color button is focused (before picker opens)
    if (textColorPicker) {
        textColorPicker.addEventListener('focus', saveSelectionFromEditor);
        textColorPicker.addEventListener('input', (e) => {
            const applied = wrapSelectionWithElement('span', {
                style: { color: e.target.value }
            });
            if (!applied) activeInlineFormats.color = e.target.value;
            syncBioContent();
            updateBioMobilePreview();
            saveSelectionFromEditor();
        });
    }

    if (bgColorPicker) {
        bgColorPicker.addEventListener('focus', saveSelectionFromEditor);
        bgColorPicker.addEventListener('input', (e) => {
            const applied = wrapSelectionWithElement('span', {
                style: { backgroundColor: e.target.value }
            });
            if (!applied) activeInlineFormats.backgroundColor = e.target.value;
            syncBioContent();
            updateBioMobilePreview();
            saveSelectionFromEditor();
        });
    }

    // Normalize heavy mobile paste markup when leaving the editor.
    bioEditor.addEventListener('blur', () => {
        saveSelectionFromEditor();
        syncBioContent({ normalizeEditor: true });
        updateBioMobilePreview();
    });

    bioEditor.addEventListener('paste', (e) => {
        if (!window.BioFormatting) return;
        const clipboard = e.clipboardData || window.clipboardData;
        if (!clipboard) return;

        const rawHtml = clipboard.getData('text/html');
        const rawText = clipboard.getData('text/plain');
        const safeHtml = window.BioFormatting.sanitizeBioHtml(rawHtml || rawText || '');
        if (!safeHtml) return;

        e.preventDefault();
        document.execCommand('insertHTML', false, safeHtml);
        syncBioContent();
        updateBioMobilePreview();
    });
    
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
                restoreSelection();
                insertTextAtCaret(emojiBtn.textContent);
                syncBioContent();
                updateBioMobilePreview();
                emojiPicker.classList.remove('active');
                bioEditor.focus();
                saveSelectionFromEditor();
            }
        });
    }
    
    // Sync content on input
    bioEditor.addEventListener('beforeinput', (e) => {
        if (e.inputType === 'insertText' && e.data && hasActiveInlineFormats()) {
            e.preventDefault();
            if (insertFormattedTextAtCaret(e.data)) {
                syncBioContent();
                updateBioMobilePreview();
                recordEditorHistory();
            }
        }
    });

    bioEditor.addEventListener('input', () => {
        saveSelectionFromEditor();
        syncBioContent();
        updateBioMobilePreview();
        recordEditorHistory();
    });
    
    bioEditor.addEventListener('keydown', (e) => {
        if (
            hasActiveInlineFormats()
            && e.key.length === 1
            && !e.ctrlKey
            && !e.metaKey
            && !e.altKey
            && !e.isComposing
        ) {
            e.preventDefault();
            if (insertFormattedTextAtCaret(e.key)) {
                syncBioContent();
                updateBioMobilePreview();
                recordEditorHistory();
            }
            return;
        }

        // Prevent Enter from submitting form
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
function syncBioContent(options = {}) {
    const bioEditor = document.getElementById('bio');
    if (bioEditor) {
        const raw = bioEditor.innerHTML;
        const safe = window.BioFormatting
            ? window.BioFormatting.sanitizeBioHtml(raw)
            : raw;
        formState.data.bio = safe;
        if (options.normalizeEditor && raw !== safe) {
            bioEditor.innerHTML = safe;
        }
        persistRegistrationDraft();
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
