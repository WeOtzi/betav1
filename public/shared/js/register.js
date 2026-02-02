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
        portfolio_url: '',
        bio: '',
        work_type: '',
        studio_name: '',
        birth_date: '',
        subscribed_newsletter: false,
        terms_accepted: false
    }
};

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
// Date Formatting Helpers (DD/MM/YYYY)
// ============================================

// Parse DD/MM/YYYY string to Date object
function parseDateDDMMYYYY(dateStr) {
    if (!dateStr) return null;
    
    // Match DD/MM/YYYY pattern
    const match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // JS months are 0-indexed
    const year = parseInt(match[3], 10);
    
    // Validate ranges
    if (day < 1 || day > 31 || month < 0 || month > 11 || year < 1900 || year > 2100) {
        return null;
    }
    
    const date = new Date(year, month, day);
    
    // Check if date is valid (handles cases like 31/02/2000)
    if (date.getDate() !== day || date.getMonth() !== month || date.getFullYear() !== year) {
        return null;
    }
    
    return date;
}

// Format Date object to DD/MM/YYYY string
function formatDateDDMMYYYY(date) {
    if (!date || !(date instanceof Date) || isNaN(date)) return '';
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    return `${day}/${month}/${year}`;
}

// Flatpickr instance reference
let birthDatePicker = null;

// Initialize Flatpickr date picker with Bauhaus styling
function setupDateInputFormatting() {
    const dateInput = document.getElementById('birth_date');
    const datePickerBtn = document.getElementById('date-picker-btn');
    
    if (!dateInput || typeof flatpickr === 'undefined') return;
    
    // Initialize Flatpickr
    birthDatePicker = flatpickr(dateInput, {
        dateFormat: 'd/m/Y',
        allowInput: true,
        locale: 'es',
        maxDate: 'today',
        disableMobile: false,
        clickOpens: true,
        // Set default date if we have one stored
        defaultDate: formState.data.birth_date ? new Date(formState.data.birth_date + 'T00:00:00') : null,
        onChange: function(selectedDates, dateStr, instance) {
            if (selectedDates.length > 0) {
                const d = selectedDates[0];
                // Store in ISO format (YYYY-MM-DD) without timezone shifts
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                formState.data.birth_date = `${year}-${month}-${day}`;
            }
        },
        onReady: function(selectedDates, dateStr, instance) {
            // Add Bauhaus class to calendar container (with safety check)
            if (instance && instance.calendarContainer) {
                instance.calendarContainer.classList.add('bauhaus-datepicker');
            }
        }
    });
    
    // Connect the calendar button to open the picker
    if (datePickerBtn) {
        datePickerBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (birthDatePicker) {
                birthDatePicker.open();
            }
        });
    }

    // Auto-format date input with slashes (DD/MM/YYYY) as user types
    dateInput.addEventListener('input', (e) => {
        // Only format if it's a manual input (not from flatpickr)
        if (e.inputType === 'deleteContentBackward') return;

        let value = e.target.value.replace(/\D/g, ''); // Remove non-digits
        if (value.length > 8) value = value.slice(0, 8);
        
        let formatted = value;
        if (value.length > 2) {
            formatted = value.slice(0, 2) + '/' + value.slice(2);
        }
        if (value.length > 4) {
            formatted = formatted.slice(0, 5) + '/' + formatted.slice(5);
        }
        
        e.target.value = formatted;
        
        // If complete, sync with flatpickr and formState
        if (formatted.length === 10) {
            const parsed = parseDateDDMMYYYY(formatted);
            if (parsed) {
                const year = parsed.getFullYear();
                const month = String(parsed.getMonth() + 1).padStart(2, '0');
                const day = String(parsed.getDate()).padStart(2, '0');
                formState.data.birth_date = `${year}-${month}-${day}`;
                if (birthDatePicker) birthDatePicker.setDate(parsed, false);
            }
        }
    });
    
    // Handle manual input validation
    dateInput.addEventListener('blur', (e) => {
        const value = e.target.value;
        if (value && value.length === 10) {
            const parsed = parseDateDDMMYYYY(value);
            if (parsed) {
                const year = parsed.getFullYear();
                const month = String(parsed.getMonth() + 1).padStart(2, '0');
                const day = String(parsed.getDate()).padStart(2, '0');
                formState.data.birth_date = `${year}-${month}-${day}`;
                // Update flatpickr with the parsed date
                if (birthDatePicker) {
                    birthDatePicker.setDate(parsed, false);
                }
            }
        }
    });
}

// ============================================
// Authentication & Data Loading
// ============================================

async function initializeAuth() {
    try {
        const { data: { session }, error } = await _supabase.auth.getSession();
        
        if (error) throw error;

        if (!session) {
            console.log('No authenticated session found. Redirecting to login...');
            window.location.href = '/registerclosedbeta';
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

        initializeForm();
        setupEventListeners();
        setupDateInputFormatting();
        updateUI();

        // Initialize Google Places if API is loaded
        if (typeof google !== 'undefined') {
            initGooglePlaces();
        }

    } catch (error) {
        console.error('Auth initialization error:', error);
        window.location.href = '/registerclosedbeta';
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
            formState.data.bio = artist.bio_description || '';
            formState.data.session_price = artist.session_price || '';
            formState.data.birth_date = artist.birth_date || '';
            formState.data.subscribed_newsletter = artist.subscribed_newsletter || false;
            formState.data.experience_years = artist.years_experience || '';
            
            // Determine work_type and studio_name from estudios field
            if (artist.estudios === 'Sin estudio/Independiente') {
                formState.data.work_type = 'independent';
                formState.data.studio_name = '';
            } else if (artist.estudios) {
                // Assume it's a studio name - could be studio or both
                formState.data.studio_name = artist.estudios;
                // Default to 'studio' if we have a studio name
                formState.data.work_type = 'studio';
            }

            prefillFormInputs();
        }
    } catch (error) {
        console.error('Error loading existing data:', error);
    }
}

function prefillFormInputs() {
    const data = formState.data;

    const fieldMappings = {
        'artistic_name': data.artistic_name,
        'full_name': data.full_name,
        'email': data.email,
        'city': data.city,
        'portfolio_url': data.portfolio_url,
        'session_price': data.session_price
    };

    Object.entries(fieldMappings).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input && value) {
            input.value = value;
        }
    });
    
    // Prefill birth_date using flatpickr
    if (data.birth_date && birthDatePicker) {
        birthDatePicker.setDate(new Date(data.birth_date), true);
    } else if (data.birth_date) {
        // Fallback: set input value directly if flatpickr not yet initialized
        const birthDateInput = document.getElementById('birth_date');
        if (birthDateInput) {
            const dateParts = data.birth_date.split('-');
            if (dateParts.length === 3) {
                birthDateInput.value = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
            }
        }
    }

    // Prefill bio (contenteditable div)
    const bioEditor = document.getElementById('bio');
    if (bioEditor && data.bio) {
        bioEditor.innerHTML = data.bio;
    }

    if (data.styles && data.styles.length > 0) {
        data.styles.forEach(style => {
            const styleBtn = document.querySelector(`.style-option[data-style="${style}"]`);
            if (styleBtn) {
                styleBtn.classList.add('selected');
            }
        });
    }

    if (data.work_type) {
        const workTypeBtn = document.querySelector(`.work-type-option[data-type="${data.work_type}"]`);
        if (workTypeBtn) {
            workTypeBtn.classList.add('selected');
        }
        
        // Show studio name input if work_type is studio or both
        const studioNameWrapper = document.getElementById('studio-name-wrapper');
        const studioNameInput = document.getElementById('studio_name');
        if (studioNameWrapper && (data.work_type === 'studio' || data.work_type === 'both')) {
            studioNameWrapper.style.display = 'block';
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
        });
    }

    // Terms checkbox
    const termsCheckbox = document.getElementById('terms-checkbox');
    if (termsCheckbox) {
        termsCheckbox.addEventListener('change', (e) => {
            formState.data.terms_accepted = e.target.checked;
        });
    }
}

function setupEventListeners() {
    btnNext.addEventListener('click', handleNext);
    btnBack.addEventListener('click', handleBack);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            const activeElement = document.activeElement;
            if (activeElement.tagName !== 'TEXTAREA') {
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
}

// [CH-15] Add custom style to the list
function addCustomStyle() {
    const customInput = document.getElementById('custom_style');
    const customStyle = customInput?.value.trim();
    
    if (customStyle && !formState.data.styles.includes(customStyle)) {
        formState.data.styles.push(customStyle);
        
        // Create a new style tag to show the added custom style
        const stylesGrid = document.getElementById('styles-grid');
        const otherBtn = document.getElementById('style-other-btn');
        
        if (stylesGrid && otherBtn) {
            const newBtn = document.createElement('button');
            newBtn.type = 'button';
            newBtn.className = 'style-option selected custom-added';
            newBtn.dataset.style = customStyle;
            newBtn.textContent = customStyle;
            newBtn.addEventListener('click', () => toggleStyleOption(newBtn));
            
            // Insert before the "Otro" button
            stylesGrid.insertBefore(newBtn, otherBtn);
        }
        
        // Clear input
        customInput.value = '';
    }
}

function selectExperienceOption(btn) {
    document.querySelectorAll('.experience-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    formState.data.experience_years = btn.dataset.years;
}

function selectWorkTypeOption(btn) {
    document.querySelectorAll('.work-type-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    formState.data.work_type = btn.dataset.type;
    
    // Show/hide studio name input based on selection
    const studioNameWrapper = document.getElementById('studio-name-wrapper');
    const studioNameInput = document.getElementById('studio_name');
    
    if (studioNameWrapper) {
        if (btn.dataset.type === 'studio' || btn.dataset.type === 'both') {
            studioNameWrapper.style.display = 'block';
            setTimeout(() => studioNameInput?.focus(), 100);
        } else {
            studioNameWrapper.style.display = 'none';
            formState.data.studio_name = '';
            if (studioNameInput) studioNameInput.value = '';
        }
    }
}

function selectNewsletterOption(btn) {
    document.querySelectorAll('.newsletter-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    formState.data.subscribed_newsletter = btn.dataset.subscribe === 'true';
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

    const input = currentStepEl.querySelector('.form-input');
    if (input) {
        // Special handling for birth_date to prevent overwriting ISO format with raw text
        if (input.id === 'birth_date') {
            const parsed = parseDateDDMMYYYY(input.value);
            if (parsed) {
                const year = parsed.getFullYear();
                const month = String(parsed.getMonth() + 1).padStart(2, '0');
                const day = String(parsed.getDate()).padStart(2, '0');
                formState.data.birth_date = `${year}-${month}-${day}`;
            }
        } else {
            formState.data[input.id] = input.value;
        }
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

        case 8:
            const portfolioUrl = document.getElementById('portfolio_url');
            if (portfolioUrl.value.trim()) {
                try {
                    new URL(portfolioUrl.value);
                } catch {
                    isValid = false;
                    errorElement = portfolioUrl;
                }
            }
            break;

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
            const birthDateInput = document.getElementById('birth_date');
            const birthDateValue = birthDateInput.value;
            if (!birthDateValue) {
                isValid = false;
                errorElement = birthDateInput;
            } else {
                // Parse DD/MM/YYYY format
                const parsedDate = parseDateDDMMYYYY(birthDateValue);
                if (!parsedDate) {
                    isValid = false;
                    errorElement = birthDateInput;
                    alert('Formato de fecha invalido. Usa DD/MM/AAAA');
                } else {
                    // Check if user is at least 18
                    const today = new Date();
                    let age = today.getFullYear() - parsedDate.getFullYear();
                    const monthDiff = today.getMonth() - parsedDate.getMonth();
                    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < parsedDate.getDate())) {
                        age--;
                    }
                    if (age < 18) {
                        isValid = false;
                        errorElement = birthDateInput;
                        alert('Debes ser mayor de 18 anos para registrarte.');
                    } else {
                        // Store in ISO format (YYYY-MM-DD) for database
                        const year = parsedDate.getFullYear();
                        const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
                        const day = String(parsedDate.getDate()).padStart(2, '0');
                        formState.data.birth_date = `${year}-${month}-${day}`;
                    }
                }
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

            const input = newStepEl.querySelector('.form-input');
            if (input) {
                setTimeout(() => input.focus(), 100);
            }
        }

        updateUI();

        if (step === 'summary') {
            populateSummary();
        }
    }, 100);
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
            <div class="summary-value">${data.portfolio_url || '<span style="opacity: 0.5;">No especificado</span>'}</div>
        </div>
        <div class="summary-row">
            <div class="summary-label">Bio</div>
            <div class="summary-value bio-value">${data.bio || '<span style="opacity: 0.5;">No especificado</span>'}</div>
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

        // Determine estudios value based on work type
        let estudiosValue;
        if (formState.data.work_type === 'independent') {
            estudiosValue = 'Sin estudio/Independiente';
        } else {
            // For 'studio' or 'both', use the studio name (normalized to uppercase)
            estudiosValue = formState.data.studio_name ? formState.data.studio_name.toUpperCase() : null;
        }

        // [CH-16] Get preset password from config for storage in artists_db
        const presetPassword = window.CONFIG?.registration?.presetPassword || 'OtziArtist2025';

        // Final validation of birth_date to prevent "INVALID DATE" errors in DB
        let finalBirthDate = null;
        if (formState.data.birth_date && /^\d{4}-\d{2}-\d{2}$/.test(formState.data.birth_date)) {
            finalBirthDate = formState.data.birth_date;
        }

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
            portafolio: formState.data.portfolio_url || null,
            bio_description: formState.data.bio || null,
            estudios: estudiosValue,
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

        // Auto-redirect to dashboard after 3 seconds
        setTimeout(() => {
            window.location.href = '/artist/dashboard';
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
    const textColorPicker = document.getElementById('text-color-picker');
    const bgColorPicker = document.getElementById('bg-color-picker');
    
    if (textColorPicker) {
        textColorPicker.addEventListener('input', (e) => {
            document.execCommand('foreColor', false, e.target.value);
            syncBioContent();
            bioEditor.focus();
        });
    }
    
    if (bgColorPicker) {
        bgColorPicker.addEventListener('input', (e) => {
            document.execCommand('hiliteColor', false, e.target.value);
            syncBioContent();
            bioEditor.focus();
        });
    }
    
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

// Sync bio content to form state
function syncBioContent() {
    const bioEditor = document.getElementById('bio');
    if (bioEditor) {
        formState.data.bio = bioEditor.innerHTML;
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
