// ============================================
// WE ÖTZI - DYNAMIC QUOTATION APP SCRIPT
// ============================================

// ============ CONFIGURATION ============
// DEFAULT_QUESTIONS_CONFIG - Synced with admin.js questionsConfig
// This is the fallback if no localStorage config exists
const DEFAULT_QUESTIONS_CONFIG = [
    { id: 1, step: 'welcome', type: 'welcome', title: 'Pantalla de Bienvenida', editable: false },
    { id: 2, step: 'artist-search', type: 'artist-search', title: '¿Con qué artista te gustaría tatuarte?', field: 'artist_username', editable: false },
    { id: 3, step: 'artist-confirm', type: 'artist-confirm', title: 'Confirmar Artista', editable: false },
    { id: 4, step: 'body-part', type: 'body-selector', title: '¿Dónde te gustaría el tatuaje?', field: 'tattoo_body_part', editable: false },
    { id: 5, step: 'description', type: 'textarea', title: 'Cuéntanos tu idea', field: 'tattoo_idea_description', placeholder: 'Describe tu idea de tatuaje con el mayor detalle posible...', minLength: 10, maxLength: 1000 },
    {
        id: 6, step: 'size', type: 'cards', title: '¿Qué tamaño aproximado?', field: 'tattoo_size',
        options: [
            { label: 'Pequeño', value: 'pequeño', icon: '📏', subtitle: '< 5cm' },
            { label: 'Mediano', value: 'mediano', icon: '📐', subtitle: '5-15cm' },
            { label: 'Grande', value: 'grande', icon: '🖼️', subtitle: '15-30cm' },
            { label: 'Muy Grande', value: 'muy_grande', icon: '🎨', subtitle: '> 30cm' },
            { label: 'Media Manga', value: 'media_manga', icon: '💪', subtitle: '' },
            { label: 'Manga Completa', value: 'manga_completa', icon: '🦾', subtitle: '' },
            { label: 'Espalda Completa', value: 'espalda_completa', icon: '🔙', subtitle: '' },
            { label: 'Pecho Completo', value: 'pecho_completo', icon: '👔', subtitle: '' }
        ]
    },
    {
        id: 7, step: 'style', type: 'cards', title: '¿Qué estilo prefieres?', field: 'tattoo_style',
        options: [
            { label: 'Realismo', value: 'realismo' },
            { label: 'Tradicional', value: 'tradicional' },
            { label: 'Neo-Tradicional', value: 'neo_tradicional' },
            { label: 'Japonés', value: 'japones' },
            { label: 'Minimalista', value: 'minimalista' },
            { label: 'Fine Line', value: 'fine_line' },
            { label: 'Blackwork', value: 'blackwork' },
            { label: 'Dotwork', value: 'dotwork' },
            { label: 'Acuarela', value: 'acuarela' },
            { label: 'Geométrico', value: 'geometrico' },
            { label: 'Trash Polka', value: 'trash_polka' },
            { label: 'Chicano', value: 'chicano' },
            { label: 'New School', value: 'new_school' },
            { label: 'Anime', value: 'anime' },
            { label: 'Ilustrativo', value: 'ilustrativo' },
            { label: 'Surrealista', value: 'surrealista' }
        ]
    },
    {
        id: 8, step: 'color', type: 'options', title: '¿Color o Blanco y Negro?', field: 'tattoo_color_type',
        options: ['Full Color', 'Blanco y Negro', 'Escala de Grises', 'Solo Líneas', 'Toques de Color']
    },
    { id: 9, step: 'references', type: 'file-upload', title: 'Referencias visuales', field: 'tattoo_references', optional: true, editable: false },
    {
        id: 10, step: 'first-tattoo', type: 'boolean', title: '¿Es tu primer tatuaje?', field: 'tattoo_is_first_tattoo',
        logic: { triggerValue: true, action: 'jump', targetStep: 'name' }
    },
    { id: 11, step: 'cover-up', type: 'boolean', title: '¿Es un Cover-up?', field: 'tattoo_is_cover_up' },
    { id: 12, step: 'name', type: 'text', title: '¿Cómo te llamas?', field: 'client_full_name', placeholder: 'Tu nombre completo', minLength: 2 },
    { id: 13, step: 'email', type: 'email', title: 'Tu correo electrónico', field: 'client_email', placeholder: 'ejemplo@email.com' },
    { 
        id: 13.1, step: 'whatsapp', type: 'tel', 
        title: 'Tu número de WhatsApp', 
        subtitle: 'Para que el artista pueda comunicarse contigo directamente por chat.',
        field: 'client_whatsapp', placeholder: '11 1234 5678' 
    },
    { id: 13.2, step: 'birth-date', type: 'date', title: '¿Cuál es tu fecha de nacimiento?', field: 'client_birth_date' },
    { id: 14, step: 'instagram', type: 'text', title: 'Tu Instagram', field: 'client_instagram', prefix: '@', optional: true },
    { id: 14.1, step: 'medical-boolean', type: 'boolean', title: '¿Tienes alguna condición médica?', field: 'client_medical_boolean' },
    { id: 14.2, step: 'medical-details', type: 'textarea', title: 'Indícanos tus condiciones médicas', field: 'client_medical_details', placeholder: 'Describe aquí...', minLength: 5, hidden: true },
    { id: 14.3, step: 'allergies', type: 'textarea', title: '¿Tienes alguna alergia que debamos saber?', field: 'client_allergies', placeholder: 'Ej: Alergia al látex, tintas rojas, etc...', optional: true },
    { id: 15, step: 'city', type: 'text', title: '¿En qué ciudad vives?', field: 'client_city_residence', placeholder: 'Ciudad, País' },
    { id: 15.5, step: 'travel', type: 'boolean', title: 'Disponibilidad de Viaje', field: 'client_travel_willing', hidden: true },
    { id: 16, step: 'date', type: 'date-range', title: '¿Para cuándo lo planeas?', field: 'client_preferred_date' },
    { id: 17, step: 'budget', type: 'currency', title: 'Presupuesto aproximado', field: 'client_budget_amount' },
    {
        id: 18, step: 'contact-pref', type: 'multi-select', title: '¿Cómo prefieres que te contacten?', field: 'client_contact_preference',
        options: ['WhatsApp', 'Instagram', 'Email', 'Cualquiera']
    },
    { id: 18.1, step: 'rec-preference', type: 'boolean', title: '¿Te gustaría que te recomendemos otros artistas?', field: 'artist_rec_preference', hidden: true },
    { id: 18.5, step: 'artist-recommendations', type: 'artist-recommendations', title: 'Recomendaciones para ti', editable: false },
    { id: 19, step: 'summary', type: 'summary', title: 'Resumen de tu solicitud', editable: false }
];

// ============ STATE ============
let questionsConfig = [];
let currentStepIndex = 0;
let formData = {
    reference_images_count: 0,
    quote_status: 'in_progress',
    quote_id: null
};
let selectedBodyParts = [];
let uploadedFiles = [];
let historyStack = [];
let summaryReached = false; // Flag to track if user reached summary once
let toastTimeout = null; // Timeout for form toasts

// BODY PARTS DATA (Loaded from ConfigManager)
let BODY_PARTS_DATA = [];
let currentBodyZone = null;
let currentBodySide = null; // New state for side selection flow

// ============ DRAFT PERSISTENCE (LocalStorage) ============
const DRAFT_STORAGE_KEY = 'weotzi_quotation_draft';

/**
 * Save draft state to localStorage for recovery on page reload/close
 */
function saveDraftToLocalStorage() {
    const draft = {
        currentStepIndex,
        formData,
        historyStack,
        selectedBodyParts,
        summaryReached,
        savedAt: new Date().toISOString()
    };
    try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
        console.log('📝 Draft saved to localStorage');
    } catch (e) {
        console.warn('Could not save draft to localStorage:', e);
    }
}

/**
 * Load draft state from localStorage
 * @returns {Object|null} The saved draft or null if none exists
 */
function loadDraftFromLocalStorage() {
    try {
        const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
        return saved ? JSON.parse(saved) : null;
    } catch (e) {
        console.warn('Could not load draft from localStorage:', e);
        return null;
    }
}

/**
 * Clear draft from localStorage (after successful submit or manual reset)
 */
function clearDraftFromLocalStorage() {
    try {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
        console.log('🗑️ Draft cleared from localStorage');
    } catch (e) {
        console.warn('Could not clear draft from localStorage:', e);
    }
}

/**
 * Check if a step is completed based on draft form data (for recovery modal)
 * @param {Object} step - The step configuration
 * @param {Object} data - The form data from draft
 * @returns {boolean} True if step is completed
 */
function isDraftStepCompleted(step, data) {
    // Steps without fields (welcome, summary, etc.) are considered complete if we've passed them
    if (!step.field) return false;
    
    const value = data[step.field];
    
    // Check for meaningful value
    if (value === null || value === undefined || value === '') return false;
    
    // For arrays, check if not empty
    if (Array.isArray(value) && value.length === 0) return false;
    
    return true;
}

/**
 * Populate the steps lists in the recovery modal
 * @param {Object} draft - The saved draft data
 */
function populateStepsLists(draft) {
    const completedList = document.getElementById('completed-steps-list');
    const pendingList = document.getElementById('pending-steps-list');
    
    if (!completedList || !pendingList) return;
    
    completedList.innerHTML = '';
    pendingList.innerHTML = '';
    
    // Filter out hidden steps and steps past the current index
    questionsConfig.forEach((step, index) => {
        // Skip welcome and summary for the lists
        if (step.step === 'welcome' || step.step === 'summary') return;
        
        // Skip hidden steps
        if (step.hidden) return;
        
        const li = document.createElement('li');
        li.textContent = step.title;
        
        if (isDraftStepCompleted(step, draft.formData)) {
            completedList.appendChild(li);
        } else if (index <= draft.currentStepIndex) {
            // Current step - show as pending
            pendingList.appendChild(li);
        } else {
            pendingList.appendChild(li);
        }
    });
    
    // Update summary info
    const artistName = draft.formData.artist_name || 'Sin artista seleccionado';
    const savedDate = draft.savedAt ? new Date(draft.savedAt).toLocaleString('es-ES', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    }) : '';
    
    const summaryEl = document.getElementById('draft-summary-info');
    if (summaryEl) {
        summaryEl.innerHTML = `
            <p><strong>Artista:</strong> ${artistName}</p>
            <p><strong>Guardado:</strong> ${savedDate}</p>
        `;
    }
}

/**
 * Show the draft recovery modal
 * @param {Object} draft - The saved draft data
 */
function showDraftRecoveryModal(draft) {
    populateStepsLists(draft);
    const modal = document.getElementById('draft-recovery-modal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

/**
 * Continue with the saved draft quotation
 */
function continueDraft() {
    const draft = loadDraftFromLocalStorage();
    if (draft) {
        // Restore state
        currentStepIndex = draft.currentStepIndex || 0;
        formData = draft.formData || { reference_images_count: 0, quote_status: 'in_progress', quote_id: null };
        historyStack = draft.historyStack || [];
        selectedBodyParts = draft.selectedBodyParts || [];
        summaryReached = draft.summaryReached || false;
        
        console.log('✅ Draft restored:', formData.quote_id);
    }
    
    // Hide modal
    const modal = document.getElementById('draft-recovery-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    
    // Render the restored step
    renderCurrentStep();
    updateProgress();
    updateBackButton();
}

/**
 * Start a new quotation, discarding the saved draft
 */
function startNewQuotation() {
    clearDraftFromLocalStorage();
    
    // Hide modal
    const modal = document.getElementById('draft-recovery-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    
    // Reset and start fresh
    resetQuotation();
}

// Save draft before page unload (close/reload)
window.addEventListener('beforeunload', () => {
    if (formData.quote_id && formData.quote_status === 'in_progress') {
        saveDraftToLocalStorage();
    }
});

// Also save on visibility change (mobile tab switching)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && formData.quote_id && formData.quote_status === 'in_progress') {
        saveDraftToLocalStorage();
    }
});

// ... (skip unchanged) ...




// ============ INIT ============
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    // Wait for ConfigManager to be ready (it loads async)
    await waitForConfigManager();
    await loadConfig();
    initApp();
});

// ============ THEME LOGIC ============
function initTheme() {
    const savedTheme = localStorage.getItem('weotzi_theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    let theme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
    setTheme(theme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('weotzi_theme', theme);
    
    const icon = document.getElementById('theme-icon');
    if (icon) {
        icon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }
    
    // Dispatch event for components that might need to react
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }));
}

async function waitForConfigManager(maxWait = 3000) {
    const start = Date.now();
    while (!window.ConfigManager && (Date.now() - start) < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!window.ConfigManager) {
        console.warn('⚠️ ConfigManager not available, using defaults');
    }
}

async function loadConfig() {
    // Load Body Parts from Supabase (async)
    if (window.ConfigManager && typeof window.ConfigManager.loadBodyPartsFromDB === 'function') {
        try {
            BODY_PARTS_DATA = await window.ConfigManager.loadBodyPartsFromDB();
            console.log('✅ Body parts loaded from Supabase:', BODY_PARTS_DATA.length, 'zones');
        } catch (err) {
            console.error('Error loading body parts:', err);
            BODY_PARTS_DATA = window.ConfigManager.getBodyParts() || [];
        }
    } else {
        console.warn('⚠️ ConfigManager not available, body parts will be empty');
        BODY_PARTS_DATA = [];
    }

    // Load Questions from Supabase (Source of Truth)
    if (window.ConfigManager && typeof window.ConfigManager.loadQuestionsFromDB === 'function') {
        try {
            const dbQuestions = await window.ConfigManager.loadQuestionsFromDB();
            if (dbQuestions && dbQuestions.length > 0) {
                questionsConfig = dbQuestions;
                localStorage.setItem('weotzi_questions_config', JSON.stringify(questionsConfig));
                console.log('✅ Questions loaded from Supabase:', questionsConfig.length);
            } else {
                useFallbackQuestions();
            }
        } catch (err) {
            console.error('Error loading questions from Supabase:', err);
            useFallbackQuestions();
        }
    } else {
        useFallbackQuestions();
    }
}

function useFallbackQuestions() {
    const saved = localStorage.getItem('weotzi_questions_config');
    if (saved) {
        questionsConfig = JSON.parse(saved);
        console.log('ℹ️ Using questions from localStorage fallback');
    } else {
        questionsConfig = DEFAULT_QUESTIONS_CONFIG;
        localStorage.setItem('weotzi_questions_config', JSON.stringify(questionsConfig));
        console.log('ℹ️ Using DEFAULT_QUESTIONS_CONFIG fallback');
    }
}

function initApp() {
    // Check for saved draft FIRST (before URL params)
    const draft = loadDraftFromLocalStorage();
    
    // If there's a valid draft with quote_id and in_progress status, show recovery modal
    if (draft && draft.formData?.quote_id && draft.formData?.quote_status === 'in_progress') {
        // Check if URL has artist param - if so, let URL param take precedence for new quote
        const urlParams = new URLSearchParams(window.location.search);
        const artistUsername = urlParams.get('artist');
        
        if (!artistUsername) {
            // No URL artist, show recovery modal
            showDraftRecoveryModal(draft);
            setupKeyboardNavigation();
            console.log('📋 Found draft quotation:', draft.formData.quote_id);
            return; // Wait for user choice
        }
        // If URL has artist, proceed normally (user likely wants a new quote with that artist)
    }
    
    // Check for artist in URL
    const urlParams = new URLSearchParams(window.location.search);
    const artistUsername = urlParams.get('artist');

    if (artistUsername) {
        handleUrlArtist(artistUsername);
    } else {
        renderCurrentStep();
        updateProgress();
    }

    // Global Listeners
    setupKeyboardNavigation();

    console.log('🚀 Dynamic App Initialized with', questionsConfig.length, 'steps');
}

async function handleUrlArtist(username) {
    showLoading();
    try {
        const supabaseClient = window.ConfigManager && window.ConfigManager.getSupabaseClient();
        let artist = null;
        const usernameLower = username.toLowerCase();

        if (supabaseClient && !window.ConfigManager.isDemoMode()) {
            // Case-insensitive lookup using ilike
            const { data, error } = await supabaseClient
                .from('artists_db')
                .select('*')
                .ilike('username', usernameLower)
                .single();
            if (!error) artist = data;
        }

        if (!artist) {
            // Fallback to fetchAllArtists with case-insensitive match
            const all = await fetchAllArtists();
            artist = all.find(a => a.username && a.username.toLowerCase() === usernameLower);
        }

        if (artist) {
            // Populate formData with artist info
            formData.artist_username = artist.username;
            formData.artist_data = artist;
            formData.artist_id = artist.user_id;
            formData.artist_name = artist.name;
            formData.artist_email = artist.email;
            formData.artist_instagram = artist.instagram;
            formData.artist_styles = artist.styles_array;
            formData.artist_current_city = artist.ubicacion;
            formData.artist_studio_name = artist.estudios;
            formData.artist_session_cost_amount = artist.session_price;
            formData.artist_portfolio = artist.portafolio || formatInstagramUrl(artist.instagram);
            formData.no_artist = false;
            formData.quote_id = generateQuoteId();

            // Skip search, go to confirm
            const confirmIdx = questionsConfig.findIndex(q => q.step === 'artist-confirm');
            const searchIdx = questionsConfig.findIndex(q => q.step === 'artist-search');
            if (confirmIdx !== -1) {
                currentStepIndex = confirmIdx;
                // History: welcome -> search -> confirm (so back goes to search)
                historyStack = [0, searchIdx !== -1 ? searchIdx : 1];
            }
        } else {
            // Artist not found - go to search step instead of welcome
            const searchIdx = questionsConfig.findIndex(q => q.step === 'artist-search');
            if (searchIdx !== -1) {
                currentStepIndex = searchIdx;
                historyStack = [0]; // Back from search goes to welcome
            }
            console.warn('Artist not found for username:', username);
        }
    } catch (err) {
        console.error('Error handling URL artist:', err);
        // On error, go to search step
        const searchIdx = questionsConfig.findIndex(q => q.step === 'artist-search');
        if (searchIdx !== -1) {
            currentStepIndex = searchIdx;
            historyStack = [0];
        }
    } finally {
        hideLoading();
        renderCurrentStep();
        updateProgress();
        updateBackButton();
    }
}

// ============ DYNAMIC RENDERING ============
function renderCurrentStep() {
    const container = document.getElementById('form-steps-container');
    container.innerHTML = ''; // Clear previous

    const question = questionsConfig[currentStepIndex];
    if (!question) {
        return;
    }

    // Create Step Wrapper
    const stepEl = document.createElement('section');
    stepEl.id = `step-${question.step}`;
    stepEl.className = 'step active';
    stepEl.dataset.stepIndex = currentStepIndex;

    // Render Content based on Type
    let contentHtml = '';

    // Check for Custom Templates first
    if (['welcome', 'artist-search', 'artist-confirm', 'body-selector', 'tattoo-styles', 'file-upload', 'artist-recommendations', 'summary'].includes(question.type)) {
        const template = document.getElementById(`tmpl-${question.type}`);
        if (template) {
            stepEl.appendChild(template.content.cloneNode(true));
            // Initialize custom logic logic after appending
            setTimeout(() => initCustomStepLogic(question.type), 0);
        } else {
            stepEl.innerHTML = `<div class="error">Template not found for ${question.type}</div>`;
        }
    } else {
        // Standard Types Renderer
        contentHtml = generateStandardQuestionHtml(question);
        stepEl.innerHTML = contentHtml;
    }

    container.appendChild(stepEl);

    // Post-render inputs setup
    // Special case: City needs special logic on "Continuar" + Google Maps Autocomplete
    if (question.step === 'artist-search') {
        const input = document.getElementById('artist-username');
        if (input) {
            input.focus();
            input.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    searchArtist();
                }
            };
        }
    }

    if (question.step === 'city') {
        const btn = stepEl.querySelector('.btn-primary');
        if (btn) {
            btn.onclick = () => handleCitySelection();
        }
        // Initialize Google Maps Autocomplete
        setupCityAutocomplete(question);
    }

    if (question.type === 'date-range') setupDatePicker();
    if (question.type === 'date') setupDatePicker(true);
    if (question.type === 'currency') setupCurrencyInput(question);
    if (question.type === 'textarea') setupTextareaCounter(question);
}

// Setup character counter for textarea
function setupTextareaCounter(question) {
    const textarea = document.getElementById(`field-${question.id}`);
    const counter = document.getElementById(`char-count-${question.id}`);

    if (!textarea || !counter) return;

    // Initial count
    counter.textContent = textarea.value.length;

    // Update on input
    textarea.addEventListener('input', () => {
        counter.textContent = textarea.value.length;
        textarea.style.borderColor = ''; // Reset border on input
    });
}

// Google Maps Autocomplete for City
function setupCityAutocomplete(question) {
    const inputId = `field-${question.id}`;
    const input = document.getElementById(inputId);

    if (!input || !window.google || !window.google.maps || !window.google.maps.places) {
        console.warn('Google Maps API not available for city autocomplete');
        return;
    }

    const autocomplete = new google.maps.places.Autocomplete(input, {
        types: ['(cities)'],
        fields: ['formatted_address', 'address_components', 'geometry']
    });

    autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (place && place.formatted_address) {
            input.value = place.formatted_address;
            formData.client_city_residence = place.formatted_address;

            // Extract city and country for better data
            if (place.address_components) {
                const city = place.address_components.find(c => c.types.includes('locality'));
                const country = place.address_components.find(c => c.types.includes('country'));
                formData.client_city_name = city ? city.long_name : '';
                formData.client_country = country ? country.long_name : '';
            }
        }
    });

    // Prevent form submission on Enter when autocomplete is open
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
        }
    });
}

// GPS Location for City
function useGpsLocation(questionId) {
    const input = document.getElementById(`field-${questionId}`);
    const btn = document.querySelector('.btn-gps');
    
    if (!input) return;

    // Check if geolocation is available
    if (!navigator.geolocation) {
        showToastMessage('Tu navegador no soporta geolocalización');
        return;
    }

    // Check if Google Maps Geocoder is available
    if (!window.google || !window.google.maps || !window.google.maps.Geocoder) {
        showToastMessage('El servicio de ubicación no está disponible');
        return;
    }

    // Show loading state
    if (btn) {
        btn.classList.add('loading');
        btn.disabled = true;
    }

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const { latitude, longitude } = position.coords;
            
            try {
                const geocoder = new google.maps.Geocoder();
                const latlng = { lat: latitude, lng: longitude };
                
                geocoder.geocode({ location: latlng }, (results, status) => {
                    // Remove loading state
                    if (btn) {
                        btn.classList.remove('loading');
                        btn.disabled = false;
                    }

                    if (status === 'OK' && results[0]) {
                        // Find city and country from results
                        let cityName = '';
                        let countryName = '';
                        let formattedAddress = '';

                        for (const result of results) {
                            const addressComponents = result.address_components;
                            
                            const locality = addressComponents.find(c => c.types.includes('locality'));
                            const adminArea = addressComponents.find(c => c.types.includes('administrative_area_level_1'));
                            const country = addressComponents.find(c => c.types.includes('country'));

                            if (locality && country) {
                                cityName = locality.long_name;
                                countryName = country.long_name;
                                formattedAddress = `${cityName}, ${adminArea ? adminArea.long_name + ', ' : ''}${countryName}`;
                                break;
                            }
                        }

                        if (formattedAddress) {
                            input.value = formattedAddress;
                            formData.client_city_residence = formattedAddress;
                            formData.client_city_name = cityName;
                            formData.client_country = countryName;
                            showToastMessage('Ubicación detectada correctamente');
                        } else {
                            showToastMessage('No se pudo determinar tu ciudad');
                        }
                    } else {
                        showToastMessage('Error al obtener la ubicación');
                    }
                });
            } catch (error) {
                // Remove loading state
                if (btn) {
                    btn.classList.remove('loading');
                    btn.disabled = false;
                }
                console.error('Geocoding error:', error);
                showToastMessage('Error al procesar tu ubicación');
            }
        },
        (error) => {
            // Remove loading state
            if (btn) {
                btn.classList.remove('loading');
                btn.disabled = false;
            }

            switch (error.code) {
                case error.PERMISSION_DENIED:
                    showToastMessage('Permiso de ubicación denegado');
                    break;
                case error.POSITION_UNAVAILABLE:
                    showToastMessage('Ubicación no disponible');
                    break;
                case error.TIMEOUT:
                    showToastMessage('Tiempo de espera agotado');
                    break;
                default:
                    showToastMessage('Error al obtener tu ubicación');
            }
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

// Make useGpsLocation available globally
window.useGpsLocation = useGpsLocation;

function generateStandardQuestionHtml(q) {
    let inputsHtml = '';

    switch (q.type) {
        case 'text':
        case 'email':
        case 'tel':
            let inputField = '';
            if (q.type === 'tel') {
                inputField = `
                    <div class="tel-group">
                        <select id="country-code-${q.id}" class="country-select">
                            <option value="+54">🇦🇷 +54</option>
                            <option value="+52">🇲🇽 +52</option>
                            <option value="+1">🇺🇸 +1</option>
                            <option value="+34">🇪🇸 +34</option>
                            <option value="+57">🇨🇴 +57</option>
                            <option value="+56">🇨🇱 +56</option>
                            <option value="+51">🇵🇪 +51</option>
                            <option value="+58">🇻🇪 +58</option>
                            <option value="+598">🇺🇾 +598</option>
                        </select>
                        <input type="tel" id="field-${q.id}" placeholder="${q.placeholder || ''}" value="${formData[q.field] ? formData[q.field].split(' ').slice(1).join(' ') : ''}">
                    </div>
                `;
            } else if (q.step === 'instagram') {
                inputField = `
                    <input type="text" id="field-${q.id}" placeholder="@usuario" value="${formData[q.field] || '@'}" oninput="handleInstagramInput(this)">
                `;
            } else if (q.step === 'city') {
                inputField = `
                    <div class="city-input-group">
                        <input type="text" id="field-${q.id}" placeholder="${q.placeholder || ''}" value="${formData[q.field] || ''}">
                        <button type="button" class="btn-gps" onclick="useGpsLocation(${q.id})" title="Usar mi ubicación">
                            <i class="fa-solid fa-location-crosshairs"></i>
                        </button>
                    </div>
                `;
            } else if (q.prefix) {
            } else {
                inputField = `
                    <input type="${q.type}" id="field-${q.id}" placeholder="${q.placeholder || ''}" value="${formData[q.field] || ''}">
                `;
            }

            const isOptional = q.optional || (q.step === 'whatsapp' && !formData.client_contact_preference?.includes('WhatsApp'));
            const hasValue = formData[q.field] !== undefined && formData[q.field] !== null && formData[q.field] !== '';

            inputsHtml = `
                <div class="question-container">
                    <h2>${q.title}</h2>
                    ${q.subtitle ? `<p class="subtitle">${q.subtitle}</p>` : ''}
                    ${inputField}
                    <div class="actions-row">
                        ${isOptional ? `<button class="btn btn-text" onclick="skipStep('${q.field}')">Omitir</button>` : ''}
                        ${hasValue ? `<button class="btn btn-secondary" onclick="nextStep()">Siguiente</button>` : ''}
                        <button class="btn btn-primary" onclick="validateAndNext('${q.field}', '${q.id}', '${q.type}')">Continuar</button>
                    </div>
                </div>
            `;
            break;

        case 'textarea':
            inputsHtml = `
                <div class="question-container">
                    <h2>${q.title}</h2>
                    ${q.subtitle ? `<p class="subtitle">${q.subtitle}</p>` : '<p class="subtitle">Describe tu idea con el mayor detalle posible</p>'}
                    <div class="textarea-wrapper">
                        <textarea 
                            id="field-${q.id}" 
                            placeholder="${q.placeholder || 'Escribe aquí tu idea...'}"
                            rows="6"
                            maxlength="${q.maxLength || 1000}"
                        >${formData[q.field] || ''}</textarea>
                        <div class="textarea-counter">
                            <span id="char-count-${q.id}">0</span>/${q.maxLength || 1000} caracteres
                        </div>
                    </div>
                    <div class="actions-row">
                        ${q.optional ? `<button class="btn btn-text" onclick="skipStep('${q.field}')">Omitir</button>` : ''}
                        ${formData[q.field] ? `<button class="btn btn-secondary" onclick="nextStep()">Siguiente</button>` : ''}
                        <button class="btn btn-primary" onclick="validateTextarea('${q.field}', '${q.id}', ${q.minLength || 0})">Continuar</button>
                    </div>
                </div>
            `;
            break;

        case 'options':
            inputsHtml = `
                <div class="question-container">
                    <h2>${q.title}</h2>
                    ${q.subtitle ? `<p class="subtitle">${q.subtitle}</p>` : ''}
                    <div class="options-list">
                        ${q.options.map(opt => {
                            const isSelected = formData[q.field] === toTitleCase(opt);
                            return `
                                <button class="btn-option-wide ${isSelected ? 'selected' : ''}" onclick="handleOptionSelect('${q.field}', '${opt}')">
                                    ${opt}
                                </button>
                            `;
                        }).join('')}
                    </div>
                    ${formData[q.field] ? `
                        <div class="actions-row" style="margin-top: 20px;">
                            <button class="btn btn-secondary" onclick="nextStep()">Siguiente</button>
                        </div>
                    ` : ''}
                </div>
            `;
            break;

        case 'cards':
            inputsHtml = `
                <div class="question-container">
                    <h2>${q.title}</h2>
                    ${q.subtitle ? `<p class="subtitle">${q.subtitle}</p>` : ''}
                    <div class="grid-options ${q.options.length > 8 ? 'dense' : ''}">
                        ${q.options.map(opt => {
                const label = typeof opt === 'object' ? opt.label : opt;
                const val = typeof opt === 'object' ? opt.value : opt;
                const icon = (typeof opt === 'object' && opt.icon) ? `<span class="option-icon">${opt.icon}</span>` : '';
                const sub = (typeof opt === 'object' && opt.subtitle) ? `<span class="option-hint">${opt.subtitle}</span>` : '';
                const isSelected = formData[q.field] === toTitleCase(val);
                return `
                                <button class="btn-option ${isSelected ? 'selected' : ''}" data-value="${val}" onclick="handleOptionSelect('${q.field}', '${val}')">
                                    ${icon}
                                    <span class="option-label">${label}</span>
                                    ${sub}
                                </button>
                            `;
            }).join('')}
                    </div>
                    ${formData[q.field] ? `
                        <div class="actions-row" style="margin-top: 20px;">
                            <button class="btn btn-secondary" onclick="nextStep()">Siguiente</button>
                        </div>
                    ` : ''}
                </div>
            `;
            break;

        case 'multi-select':
            inputsHtml = `
                <div class="question-container">
                    <h2>${q.title}</h2>
                    ${q.subtitle ? `<p class="subtitle">${q.subtitle}</p>` : ''}
                    <div class="checkbox-options">
                        ${q.options.map(opt => {
                            const isSelected = formData[q.field] && formData[q.field].split(', ').includes(toTitleCase(opt));
                            return `
                                <label class="checkbox-option">
                                    <input type="checkbox" name="${q.field}" value="${opt}" ${isSelected ? 'checked' : ''}>
                                    <span class="checkbox-box"></span>
                                    <span>${opt}</span>
                                </label>
                            `;
                        }).join('')}
                    </div>
                    <div class="actions-row">
                        ${formData[q.field] ? `<button class="btn btn-secondary" onclick="nextStep()">Siguiente</button>` : ''}
                        <button class="btn btn-primary" onclick="handleMultiSelect('${q.field}')">Continuar</button>
                    </div>
                </div>
            `;
            break;

        case 'boolean':
            let subtitleHtml = q.subtitle ? `<p class="subtitle">${q.subtitle}</p>` : '';
            
            // Special display for travel question to show mismatch
            if (q.step === 'travel' && formData.artist_current_city && formData.client_city_residence) {
                subtitleHtml = `
                    <div class="mismatch-display">
                        <div class="mismatch-item">
                            <span class="mismatch-label">Artista en:</span>
                            <span class="mismatch-value">${toTitleCase(formData.artist_current_city)}</span>
                        </div>
                        <div class="mismatch-divider"><i class="fa-solid fa-arrows-left-right"></i></div>
                        <div class="mismatch-item">
                            <span class="mismatch-label">Tú en:</span>
                            <span class="mismatch-value">${toTitleCase(formData.client_city_residence)}</span>
                        </div>
                    </div>
                    <p class="subtitle" style="margin-top: 20px;">Las ubicaciones no coinciden. ¿Tendrías disponibilidad de viajar para la sesión?</p>
                `;
            }

            inputsHtml = `
                <div class="question-container">
                    <h2>${q.title}</h2>
                    ${subtitleHtml}
                    <div class="options-row">
                        <button class="btn btn-option-large ${formData[q.field] === true ? 'selected' : ''}" onclick="handleBoolean('${q.field}', true)">
                            <i class="fa-solid fa-check"></i> Sí
                        </button>
                        <button class="btn btn-option-large ${formData[q.field] === false ? 'selected' : ''}" onclick="handleBoolean('${q.field}', false)">
                            <i class="fa-solid fa-xmark"></i> No
                        </button>
                    </div>
                    ${formData[q.field] !== undefined && formData[q.field] !== null ? `
                        <div class="actions-row" style="margin-top: 20px;">
                            <button class="btn btn-secondary" onclick="nextStep()">Siguiente</button>
                        </div>
                    ` : ''}
                </div>
            `;
            break;

        case 'date-range':
            inputsHtml = `
                <div class="question-container">
                    <h2>${q.title}</h2>
                    ${q.subtitle ? `<p class="subtitle">${q.subtitle}</p>` : ''}
                    <input type="text" id="date-picker" placeholder="Selecciona fecha(s)" readonly>
                    <label class="checkbox-wrapper">
                        <input type="checkbox" id="date-flexible">
                        <span class="checkmark"></span>
                        <span>Tengo flexibilidad</span>
                    </label>
                    <button class="btn btn-primary" onclick="handleDateSelection('${q.field}')">Continuar</button>
                </div>
            `;
            break;

        case 'date':
            inputsHtml = `
                <div class="question-container">
                    <h2>${q.title}</h2>
                    ${q.subtitle ? `<p class="subtitle">${q.subtitle}</p>` : ''}
                    <input type="text" id="date-picker-single" placeholder="Selecciona fecha" readonly>
                    <button class="btn btn-primary" onclick="handleSingleDateSelection('${q.field}')">Continuar</button>
                </div>
            `;
            break;

        case 'currency':
            inputsHtml = `
                <div class="question-container">
                     <h2>${q.title}</h2>
                     ${q.subtitle ? `<p class="subtitle">${q.subtitle}</p>` : ''}
                     <div class="budget-input-group">
                        <select id="currency-select">
                            <option value="USD">USD</option><option value="EUR">EUR</option>
                            <option value="MXN">MXN</option><option value="ARS">ARS</option>
                        </select>
                        <input type="number" id="field-${q.id}" placeholder="0" min="0" value="${formData[q.field] || ''}">
                     </div>
                     <div class="actions-row">
                        ${formData[q.field] ? `<button class="btn btn-secondary" onclick="nextStep()">Siguiente</button>` : ''}
                        <button class="btn btn-primary" onclick="handleCurrency('${q.field}', '${q.id}')">Continuar</button>
                     </div>
                </div>
            `;
            break;
    }
    return inputsHtml;
}

function initCustomStepLogic(type) {
    if (type === 'body-selector') setupBodySelector();
    if (type === 'tattoo-styles') setupTattooStyles();
    if (type === 'file-upload') setupFileUpload();
    if (type === 'artist-recommendations') initRecommendations();
    if (type === 'summary') generateSummary();
    if (type === 'artist-confirm') {
        const artist = formData.artist_data || {}; // Ensure we have artist data
        if (artist.name) displayArtistCard(artist);
        else console.warn('No artist data found for summary');

        // Setup render logic for confirm (bind events dynamically if needed)
    }
}


// ============ NAVIGATION ============
function nextStep(triggerVal = null) {
    const currentQ = questionsConfig[currentStepIndex];

    // Logic Handler (Conditional Jumping)
    if (currentQ.logic && currentQ.logic.action === 'jump') {
        const valToCheck = triggerVal !== null ? triggerVal : formData[currentQ.field];
        if (valToCheck === currentQ.logic.triggerValue) {
            const targetStep = currentQ.logic.targetStep;
            const targetIndex = questionsConfig.findIndex(q => q.step === targetStep);
            if (targetIndex !== -1) {
                commitStepChange(targetIndex);
                return;
            }
        }
    }

    // Custom Logic for Medical Conditions
    if (currentQ.step === 'medical-boolean') {
        if (formData.client_medical_boolean === false) {
            // Skip medical-details
            const detailsIdx = questionsConfig.findIndex(q => q.step === 'medical-details');
            if (detailsIdx !== -1) {
                commitStepChange(detailsIdx + 1);
                return;
            }
        }
    }

    // Default: Next index
    if (currentStepIndex < questionsConfig.length - 1) {
        let nextIndex = currentStepIndex + 1;
        const currentQ = questionsConfig[currentStepIndex];

        // Recommendation Flow
        if (currentQ.step === 'contact-pref' && formData.no_artist) {
            // User chose "Continue Without Artist" - go directly to recommendations
            // Skip the rec-preference boolean since intent was already expressed
            const recIdx = questionsConfig.findIndex(q => q.step === 'artist-recommendations');
            if (recIdx !== -1) {
                commitStepChange(recIdx);
            } else {
                commitStepChange(questionsConfig.findIndex(q => q.step === 'summary'));
            }
            return;
        } else if (currentQ.step === 'contact-pref' && !formData.no_artist) {
            // Skip recommendations if artist already selected
            const summaryIdx = questionsConfig.findIndex(q => q.step === 'summary');
            if (summaryIdx !== -1) nextIndex = summaryIdx;
        } else if (currentQ.step === 'rec-preference') {
            // This path is for users who selected an artist but want additional recommendations
            if (formData.artist_rec_preference === true) {
                const recIdx = questionsConfig.findIndex(q => q.step === 'artist-recommendations');
                if (recIdx !== -1) nextIndex = recIdx;
            } else {
                const summaryIdx = questionsConfig.findIndex(q => q.step === 'summary');
                if (summaryIdx !== -1) nextIndex = summaryIdx;
            }
        }

        // Smart jump: If the form is already mostly completed (e.g. editing from summary)
        // jump to the next hole or the summary
        const nextIncomplete = findNextIncompleteStepIndex(nextIndex);
        if (nextIncomplete !== -1 && nextIncomplete > nextIndex) {
            nextIndex = nextIncomplete;
        }

        commitStepChange(nextIndex);
    }
}

function prevStep() {
    if (historyStack.length > 0) {
        const prevIndex = historyStack.pop();
        currentStepIndex = prevIndex;

        // Transition effect could be added here similar to old script
        renderCurrentStep();
        updateProgress();
        updateBackButton();
    }
}

function commitStepChange(newIndex) {
    historyStack.push(currentStepIndex);
    currentStepIndex = newIndex;
    renderCurrentStep();
    updateProgress();
    updateBackButton();

    // Auto-save progress (Supabase + localStorage)
    if (formData.quote_id) {
        autoSaveQuotation();
        saveDraftToLocalStorage();
    }
}

// ============ UTILITIES ============
function isStepCompleted(question) {
    if (!question || !question.field) return true; // Steps without fields (like welcome) are "completed"
    
    const val = formData[question.field];
    
    // Special case for references
    if (question.type === 'file-upload') {
        // Only mark as complete if we already have files OR if we reached summary once
        return uploadedFiles.length > 0 || summaryReached;
    }

    // Special case for medical details
    if (question.step === 'medical-details') {
        if (formData.client_medical_boolean === false) return true;
        return val !== undefined && val !== null && val !== '';
    }

    // Optional fields:
    // If user has reached summary once, they can be considered "completed" even if empty
    // If not reached summary, user MUST see them (unless they skip them)
    if (question.optional && summaryReached) return true;

    // Required fields must have a value
    return val !== undefined && val !== null && val !== '';
}

function findNextIncompleteStepIndex(startIndex) {
    for (let i = startIndex; i < questionsConfig.length; i++) {
        const q = questionsConfig[i];
        if (q.step === 'summary') return i;
        if (!isStepCompleted(q)) return i;
    }
    return -1;
}

function handleInstagramInput(input) {
    if (!input.value.startsWith('@')) {
        input.value = '@' + input.value.replace(/^@+/, '');
    }
    // Prevent multiple @ at the start
    if (input.value.length > 1 && input.value[1] === '@') {
        input.value = '@' + input.value.substring(2);
    }
}

function getStringSimilarity(s1, s2) {
    let longer = s1;
    let shorter = s2;
    if (s1.length < s2.length) {
        longer = s2;
        shorter = s1;
    }
    const longerLength = longer.length;
    if (longerLength === 0) {
        return 1.0;
    }
    return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength);
}

function editDistance(s1, s2) {
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();

    const costs = new Array();
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0)
                costs[j] = j;
            else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1))
                        newValue = Math.min(Math.min(newValue, lastValue),
                            costs[j]) + 1;
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0)
            costs[s2.length] = lastValue;
    }
    return costs[s2.length];
}

function parseSpanishDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    
    const months = {
        'ene': 0, 'feb': 1, 'mar': 2, 'abr': 3, 'may': 4, 'jun': 5,
        'jul': 6, 'ago': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dic': 11
    };
    
    // Format expected: "20 Dic 1990"
    const parts = dateStr.toLowerCase().split(' ');
    if (parts.length !== 3) return new Date(dateStr); // Fallback to native
    
    const day = parseInt(parts[0]);
    const month = months[parts[1]] !== undefined ? months[parts[1]] : parseInt(parts[1]) - 1;
    const year = parseInt(parts[2]);
    
    return new Date(year, month, day);
}

function toTitleCase(str) {
    if (!str || typeof str !== 'string') return str;
    return str.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

// ============ PERSISTENCE ============
function generateQuoteId() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return 'QN' + (((timestamp % 100000) + random) % 100000).toString().padStart(5, '0');
}

async function autoSaveQuotation() {
    const supabaseClient = window.ConfigManager && window.ConfigManager.getSupabaseClient();
    if (!supabaseClient || window.ConfigManager.isDemoMode()) return;

    try {
        const payload = preparePayload();
        
        // Try INSERT first, if conflict (duplicate) then UPDATE
        let error = null;
        const { error: insertError } = await supabaseClient
            .from('quotations_db')
            .insert([payload]);
        
        if (insertError) {
            // If duplicate key error (23505), try update instead
            if (insertError.code === '23505') {
                const { error: updateError } = await supabaseClient
                    .from('quotations_db')
                    .update(payload)
                    .eq('quote_id', payload.quote_id);
                error = updateError;
            } else {
                error = insertError;
            }
        }

        if (error) throw error;
        console.log('💾 Progress auto-saved:', formData.quote_id);
    } catch (error) {
        console.error('Auto-save error:', error);
    }
}

function preparePayload() {
    // Helper to format date for Supabase
    const formatSupabaseDate = (dateStr) => {
        if (!dateStr) return null;
        const d = parseSpanishDate(dateStr);
        if (!d || isNaN(d.getTime())) return null;
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // Helper to ensure array
    const ensureArray = (val) => {
        if (!val) return [];
        if (Array.isArray(val)) return val;
        try {
            const parsed = JSON.parse(val);
            return Array.isArray(parsed) ? parsed : [val];
        } catch (e) {
            return [val];
        }
    };

    return {
        quote_id: formData.quote_id,
        quote_status: formData.quote_status,
        artist_id: formData.artist_id || null,
        artist_name: formData.artist_name,
        artist_email: formData.artist_email,
        artist_instagram: formData.artist_instagram,
        artist_session_cost_amount: formData.artist_session_cost_amount,
        artist_styles: ensureArray(formData.artist_styles),
        artist_current_city: formData.artist_current_city,
        artist_studio_name: formData.artist_studio_name,
        tattoo_body_part: formData.tattoo_body_part,
        tattoo_body_side: formData.tattoo_body_side,
        tattoo_idea_description: formData.tattoo_idea_description || '',
        tattoo_size: formData.tattoo_size,
        tattoo_style: formData.tattoo_style,
        tattoo_color_type: formData.tattoo_color_type,
        reference_images_count: formData.reference_images_count,
        tattoo_references: formData.tattoo_references || null,
        tattoo_is_first_tattoo: formData.tattoo_is_first_tattoo,
        tattoo_is_cover_up: formData.tattoo_is_cover_up,
        client_full_name: formData.client_full_name,
        client_email: formData.client_email,
        client_instagram: formData.client_instagram,
        client_city_residence: formData.client_city_residence,
        client_travel_willing: formData.client_travel_willing ? 'true' : 'false',
        city_mismatch_acknowledged: formData.city_mismatch_acknowledged ? 'true' : 'false',
        style_mismatch_acknowledged: formData.style_mismatch_acknowledged ? 'true' : 'false',
        client_preferred_date: formData.client_preferred_date,
        client_flexible_dates: formData.client_flexible_dates,
        client_budget_amount: formData.client_budget_amount,
        client_budget_currency: formData.client_budget_currency,
        client_contact_preference: formData.client_contact_preference,
        client_whatsapp: formData.client_whatsapp,
        client_birth_date: formatSupabaseDate(formData.client_birth_date),
        client_age: formData.client_age,
        client_health_conditions: formData.client_medical_boolean ? formData.client_medical_details : 'Ninguna',
        client_allergies: formData.client_allergies || 'Ninguna',
        updated_at: new Date().toISOString()
    };
}

function updateProgress() {
    const current = currentStepIndex + 1;
    const total = questionsConfig.length;
    const progress = (current / total) * 100;
    
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.width = `${progress}%`;

    const stepText = document.getElementById('progress-step-text');
    if (stepText) {
        stepText.textContent = `Paso ${current} de ${total}`;
        // Brief pulse effect
        stepText.style.transform = 'scale(1.1)';
        setTimeout(() => stepText.style.transform = 'scale(1)', 200);
    }

    // Fun messages based on progress
    const funMessages = [
        { threshold: 0, text: "¡Empecemos la tinta! ✍️" },
        { threshold: 15, text: "Gran elección de artista 😎" },
        { threshold: 30, text: "Esa zona va a doler... ¡mentira! 😂" },
        { threshold: 45, text: "Tu idea suena increíble ✨" },
        { threshold: 60, text: "Casi lo tenemos, no te rindas 💪" },
        { threshold: 75, text: "Últimos detalles, ¡ya casi! 🚀" },
        { threshold: 90, text: "¡A un paso de tu nueva piel! 🔥" }
    ];

    const messageText = document.getElementById('progress-fun-message');
    if (messageText) {
        const message = [...funMessages].reverse().find(m => progress >= m.threshold);
        if (message) {
            messageText.textContent = message.text;
        }
    }
}

function updateBackButton() {
    const btn = document.getElementById('back-btn');
    if (!btn) return;
    if (historyStack.length > 0) btn.classList.remove('hidden');
    else btn.classList.add('hidden');
}


// ============ HANDLERS (Standard) ============

function validateAndNext(field, id, type) {
    const input = document.getElementById(`field-${id}`);
    let val = input.value.trim();

    if (type === 'tel') {
        const countryCode = document.getElementById(`country-code-${id}`).value;
        if (val) val = `${countryCode} ${val}`;
    }

    if (type === 'email' && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        return; // Validation failed, just return
    }

    const currentQ = questionsConfig[currentStepIndex];
    const isOptional = currentQ.optional || (currentQ.step === 'whatsapp' && !formData.client_contact_preference?.includes('WhatsApp'));

    if (!val && !isOptional) {
        return; // Validation failed, just return
    }

    // Normalize text if applicable - skip for Instagram handles
    if (type === 'text' && val && field !== 'client_instagram') {
        val = toTitleCase(val);
    }

    formData[field] = val || null;
    nextStep();
}

function skipStep(field) {
    formData[field] = null;
    nextStep();
}

function validateTextarea(field, id, minLength) {
    const textarea = document.getElementById(`field-${id}`);
    let val = textarea.value.trim();

    if (minLength && val.length < minLength) {
        showToastMessage(`Por favor escribe al menos ${minLength} caracteres`);
        return;
    }

    // Skip toTitleCase for description fields to preserve user's original formatting
    // These fields should not have word-by-word capitalization
    const skipTitleCaseFields = ['tattoo_idea_description', 'client_medical_details', 'client_allergies'];
    
    if (val && !skipTitleCaseFields.includes(field)) {
        val = toTitleCase(val);
    }

    formData[field] = val;
    nextStep();
}

// Simple toast notification for form
function showToastMessage(message) {
    // Never show toasts in summary/revision step
    const currentQ = questionsConfig[currentStepIndex];
    if (currentQ && currentQ.step === 'summary') return;

    // Check if toast already exists
    let toast = document.getElementById('form-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'form-toast';
        toast.className = 'form-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    
    // Clear previous timeout if exists
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
        toastTimeout = null;
    }, 4000); // Slightly longer for travel notes
}

function hideToastMessage() {
    const toast = document.getElementById('form-toast');
    if (toast) {
        toast.classList.remove('show');
        if (toastTimeout) {
            clearTimeout(toastTimeout);
            toastTimeout = null;
        }
    }
}

function handleOptionSelect(field, value) {
    let finalValue = value;
    
    // Normalize if simple text
    if (typeof value === 'string') {
        finalValue = toTitleCase(value);
    }

    formData[field] = finalValue;
    
    // Style mismatch warning
    if (field === 'tattoo_style' && formData.artist_data) {
        const artist = formData.artist_data;
        const artistStyles = typeof artist.styles_array === 'string' ? 
            (artist.styles_array.startsWith('[') ? JSON.parse(artist.styles_array) : [artist.styles_array]) : 
            (artist.styles_array || []);
        
        const cleanVal = finalValue.toLowerCase().trim();
        const hasMatch = artistStyles.some(s => {
            const cleanArtistStyle = s.toLowerCase().trim();
            return cleanArtistStyle.includes(cleanVal) || cleanVal.includes(cleanArtistStyle);
        });

        if (artistStyles.length > 0 && !hasMatch) {
            showToastMessage(`Nota: ${artist.name} se especializa en otros estilos, pero puedes continuar con la cotización.`);
            formData.style_mismatch_acknowledged = true;
        } else {
            formData.style_mismatch_acknowledged = false;
        }
    }
    
    nextStep();
}

function handleMultiSelect(field) {
    const checked = Array.from(document.querySelectorAll(`input[name="${field}"]:checked`))
        .map(c => toTitleCase(c.value));
    if (checked.length === 0) { alert('Selecciona al menos uno'); return; }
    formData[field] = checked.join(', ');
    nextStep();
}

function handleBoolean(field, value) {
    formData[field] = value;
    nextStep(value); // Pass value to logic checker
}

function handleDateSelection(field) {
    const val = document.getElementById('date-picker').value;
    const flex = document.getElementById('date-flexible').checked;

    if (!val && !flex) return;

    formData[field] = val || 'Flexible';
    formData['client_flexible_dates'] = flex;
    nextStep();
}

function handleCurrency(field, id) {
    const amount = document.getElementById(`field-${id}`).value;
    const curr = document.getElementById('currency-select').value;
    if (!amount) return;

    formData[field] = amount;
    formData['client_budget_currency'] = curr; // Explicitly save currency
    nextStep();
}


// ============ LOGIC MIGRATION (Legacy -> Dynamic) ============
// Artist Search
async function searchArtist() {
    const username = document.getElementById('artist-username').value.trim();
    const errorEl = document.getElementById('artist-error');

    if (!username) {
        if (errorEl) {
            errorEl.textContent = 'Por favor ingresa un usuario';
            errorEl.classList.remove('hidden');
        }
        return;
    }

    if (errorEl) errorEl.classList.add('hidden');
    showLoading();

    try {
        let artist = null;
        const usernameLower = username.toLowerCase();
        // Try Supabase if configured - use ConfigManager to get properly initialized client
        const supabaseClient = window.ConfigManager && window.ConfigManager.getSupabaseClient();

        if (supabaseClient && !window.ConfigManager.isDemoMode()) {
            // Case-insensitive lookup using ilike
            const { data, error } = await supabaseClient
                .from('artists_db')
                .select('*')
                .ilike('username', usernameLower)
                .single();

            if (error) throw error;
            artist = data;
        } else {
            // Demo mode - simulate search with case-insensitive match
            await new Promise(r => setTimeout(r, 800));
            // Try to find in demo artists first
            const demoArtists = window.ConfigManager ? window.ConfigManager.getDemoArtists() : [];
            const foundDemo = demoArtists.find(a => a.username && a.username.toLowerCase() === usernameLower);
            
            if (foundDemo) {
                artist = {
                    user_id: foundDemo.userId,
                    name: foundDemo.name,
                    email: foundDemo.email,
                    instagram: foundDemo.instagram,
                    styles_array: JSON.stringify(foundDemo.styles),
                    ubicacion: foundDemo.location,
                    estudios: foundDemo.studio,
                    session_price: foundDemo.sessionPrice,
                    username: foundDemo.username
                };
            } else {
                // Simulated fallback for demo
                artist = {
                    user_id: 'demo_123',
                    name: 'Yomico Moreno (Demo)',
                    email: 'demo@weotzi.com',
                    instagram: 'https://instagram.com/' + username,
                    styles_array: '["Realismo", "Surrealismo"]',
                    ubicacion: 'Caracas / NYC',
                    estudios: 'Last Rites',
                    session_price: '1500 USD',
                    username: username
                };
            }
        }

        if (!artist) throw new Error('Artista no encontrado');

        // Generate Quote ID if not exists
        if (!formData.quote_id) {
            formData.quote_id = generateQuoteId();
        }

        // Store artist data including username
        formData.artist_username = artist.username;
        formData.artist_data = artist;
        formData.artist_id = artist.user_id;
        formData.artist_name = artist.name;
        formData.artist_email = artist.email;
        formData.artist_instagram = artist.instagram;
        formData.artist_styles = artist.styles_array;
        formData.artist_current_city = artist.ubicacion;
        formData.artist_studio_name = artist.estudios;
        formData.artist_session_cost_amount = artist.session_price;
        formData.artist_portfolio = artist.portafolio || formatInstagramUrl(artist.instagram); // Use instagram as fallback
        formData.no_artist = false; // We found an artist

        // Trigger immediate auto-save after artist selection
        autoSaveQuotation();

        hideLoading();
        
        // Go to confirmation step
        const confirmIdx = questionsConfig.findIndex(q => q.step === 'artist-confirm');
        if (confirmIdx !== -1) commitStepChange(confirmIdx);
        else nextStep();

    } catch (error) {
        hideLoading();
        if (errorEl) {
            errorEl.textContent = 'Artista no encontrado. Verifica el usuario e intenta de nuevo.';
            errorEl.classList.remove('hidden');
        }
        console.error('Artist search error:', error);
    }
}

function continueWithoutArtist() {
    formData.no_artist = true;
    formData.artist_id = null;
    formData.artist_name = null;
    
    // Generate Quote ID if not exists
    if (!formData.quote_id) {
        formData.quote_id = generateQuoteId();
    }

    // Jump to body-part step (id: 4 in DEFAULT_QUESTIONS_CONFIG)
    const targetIdx = questionsConfig.findIndex(q => q.step === 'body-part');
    if (targetIdx !== -1) {
        commitStepChange(targetIdx);
    } else {
        nextStep();
    }
}

async function initRecommendations() {
    const grid = document.getElementById('recommendations-grid');
    if (!grid) return;

    showLoading();
    try {
        const recommendations = await getRecommendedArtists();
        grid.innerHTML = '';

        if (recommendations.length === 0) {
            // This shouldn't happen as getRecommendedArtists always returns top candidates
            grid.innerHTML = '<p class="text-muted">No hay artistas disponibles en este momento.</p>';
        } else {
            // Check if any artist has positive match reasons
            const hasGoodMatches = recommendations.some(a => a.matchReasons && a.matchReasons.length > 0);
            if (!hasGoodMatches) {
                // Show a note that these are closest available matches
                const notice = document.createElement('p');
                notice.className = 'text-muted';
                notice.textContent = 'No encontramos coincidencias exactas, pero estos artistas podrían interesarte:';
                grid.before(notice);
            }
            renderRecommendationCards(recommendations);
        }
    } catch (err) {
        console.error('Error loading recommendations:', err);
        grid.innerHTML = '<p class="error-msg">Error al cargar recomendaciones.</p>';
    } finally {
        hideLoading();
    }
}

/**
 * Parse currency string to numeric value
 * Handles formats like "9500,00 US$", "1500 USD", "$1,500.00"
 */
function parseCurrency(priceStr) {
    if (!priceStr) return 0;
    // Remove currency symbols and text, keep only numbers, commas, dots
    let clean = priceStr.replace(/[^\d.,]/g, '');
    // Handle European format (1.234,56) vs US format (1,234.56)
    if (clean.includes(',') && clean.includes('.')) {
        // Check which comes last - that's the decimal separator
        const lastComma = clean.lastIndexOf(',');
        const lastDot = clean.lastIndexOf('.');
        if (lastComma > lastDot) {
            // European format: 1.234,56
            clean = clean.replace(/\./g, '').replace(',', '.');
        } else {
            // US format: 1,234.56
            clean = clean.replace(/,/g, '');
        }
    } else if (clean.includes(',')) {
        // Could be European decimal (1234,56) or US thousands (1,234)
        // If comma is followed by exactly 2 digits at end, treat as decimal
        if (/,\d{2}$/.test(clean)) {
            clean = clean.replace(',', '.');
        } else {
            clean = clean.replace(/,/g, '');
        }
    }
    return parseFloat(clean) || 0;
}

// Helper to format tattoo_style (JSONB or string) for display
function formatTattooStyleForDisplay(tattooStyle) {
    if (!tattooStyle) return '-';
    
    // Handle JSONB object format
    if (typeof tattooStyle === 'object') {
        if (tattooStyle.substyle_name) {
            return `${tattooStyle.style_name} › ${tattooStyle.substyle_name}`;
        }
        return tattooStyle.style_name || '-';
    }
    
    // Handle legacy string format
    return toTitleCase(tattooStyle);
}

// Helper to get style name string for matching (handles both JSONB and string)
function getTattooStyleString(tattooStyle) {
    if (!tattooStyle) return '';
    
    if (typeof tattooStyle === 'object') {
        // Include both style and substyle for matching
        let styleStr = tattooStyle.style_name || '';
        if (tattooStyle.substyle_name) {
            styleStr += ' ' + tattooStyle.substyle_name;
        }
        return styleStr.toLowerCase();
    }
    
    return String(tattooStyle).toLowerCase();
}

async function getRecommendedArtists() {
    const allArtists = await fetchAllArtists();
    const style = getTattooStyleString(formData.tattoo_style);
    const clientCity = (formData.client_city_name || formData.client_city_residence || '').toLowerCase();
    const clientBudget = parseFloat(formData.client_budget_amount) || 0;
    const clientCurrency = (formData.client_budget_currency || 'USD').toUpperCase();
    const travel = formData.client_travel_willing;

    // Scoring system - combines persistent artist_index with dynamic matching
    const scored = allArtists.map(artist => {
        // Base score from persistent artist_index (0-100)
        // Falls back to 0 if not yet calculated
        let score = artist.artist_index || 0;
        let reasons = [];
        
        // Helper to parse styles_array (handles both array and string formats)
        const artistStyles = Array.isArray(artist.styles_array) 
            ? artist.styles_array 
            : (typeof artist.styles_array === 'string' 
                ? (artist.styles_array.startsWith('[') ? JSON.parse(artist.styles_array) : [artist.styles_array]) 
                : []);
        
        // 1. Style match (Highest priority - +100 points)
        if (style && artistStyles.some(s => s && s.toLowerCase().includes(style) || style.includes(s?.toLowerCase() || ''))) {
            score += 100;
            reasons.push('Estilo');
        }

        // 2. Location match (Medium priority - +50 points)
        const artistCity = (artist.city || artist.ubicacion || '').split(',')[0].toLowerCase().trim();
        if (artistCity && clientCity) {
            const cityMatch = artistCity.includes(clientCity) || clientCity.includes(artistCity);
            if (cityMatch) {
                score += 50;
                reasons.push('Ubicación');
            } else if (travel === false) {
                // Penalize if client doesn't want to travel and artist is far
                score -= 30;
            }
        }

        // 3. Budget match (Low-Medium priority - +30 points)
        const artistPrice = parseCurrency(artist.session_price);
        if (clientBudget > 0 && artistPrice > 0) {
            // Budget is within range: client budget >= artist price OR within 20% above
            if (clientBudget >= artistPrice || clientBudget >= artistPrice * 0.8) {
                score += 30;
                reasons.push('Presupuesto');
            } else if (clientBudget >= artistPrice * 0.5) {
                // Partial match if budget is at least 50% of artist price
                score += 15;
            }
        }

        const artistName = toTitleCase(artist.name);
        
        // Build match reason based on dynamic matches
        let matchReason;
        if (reasons.length > 0) {
            matchReason = `Recomendado por ${reasons.join(' y ')}`;
        } else if (artist.artist_index >= 70) {
            matchReason = 'Artista destacado';
        } else if (artist.artist_index >= 50) {
            matchReason = 'Artista establecido';
        } else {
            matchReason = 'Artista disponible';
        }

        return { 
            ...artist, 
            name: artistName,
            score, 
            matchReason,
            matchReasons: reasons
        };
    });

    // Sort by score and take top candidates
    // Always return at least 2 artists (the best available) even if no perfect matches
    const sorted = scored.sort((a, b) => b.score - a.score);
    
    // If we have artists with positive scores, prioritize them
    const withPositiveScore = sorted.filter(a => a.score > 0);
    if (withPositiveScore.length >= 2) {
        return withPositiveScore.slice(0, 3);
    }
    
    // Otherwise return top 2-3 artists as "closest" matches
    return sorted.slice(0, 3).map(a => ({
        ...a,
        matchReason: a.score > 0 ? a.matchReason : 'Artista disponible'
    }));
}

async function fetchAllArtists() {
    const supabaseClient = window.ConfigManager && window.ConfigManager.getSupabaseClient();
    if (supabaseClient && !window.ConfigManager.isDemoMode()) {
        const { data, error } = await supabaseClient
            .from('artists_db')
            .select('*');
        if (error) throw error;
        return data;
    } else {
        // Fallback to demo artists or JSON
        return window.ConfigManager.getDemoArtists().map(a => ({
            user_id: a.userId,
            name: a.name,
            username: a.username,
            email: a.email,
            instagram: a.instagram,
            styles_array: JSON.stringify(a.styles),
            ubicacion: a.location,
            estudios: a.studio,
            session_price: a.sessionPrice,
            city: a.location.split(',')[0].trim(),
            profile_picture: null,
            portafolio: '#'
        }));
    }
}

function renderRecommendationCards(artists) {
    const grid = document.getElementById('recommendations-grid');
    if (!grid) return;
    
    grid.innerHTML = artists.map(artist => {
        const styles = typeof artist.styles_array === 'string' ? 
            (artist.styles_array.startsWith('[') ? JSON.parse(artist.styles_array) : [artist.styles_array]) : 
            (artist.styles_array || []);
        
        const profilePic = artist.profile_picture ? 
            `<img src="${artist.profile_picture}" alt="${artist.name}" class="artist-profile-img">` : 
            `<div class="artist-avatar"><i class="fa-solid fa-palette"></i></div>`;
        
        // Build match reason badges with icons for each criterion
        let matchBadgesHtml = '';
        if (artist.matchReasons && artist.matchReasons.length > 0) {
            const badgeIcons = {
                'Estilo': 'fa-paintbrush',
                'Ubicación': 'fa-location-dot',
                'Presupuesto': 'fa-dollar-sign'
            };
            matchBadgesHtml = `
                <div class="match-badges">
                    ${artist.matchReasons.map(reason => {
                        const icon = badgeIcons[reason] || 'fa-star';
                        return `<span class="match-badge"><i class="fa-solid ${icon}"></i> ${reason}</span>`;
                    }).join('')}
                </div>
            `;
        } else if (artist.matchReason) {
            matchBadgesHtml = `<p class="match-reason-badge"><i class="fa-solid fa-star"></i> ${artist.matchReason}</p>`;
        }
        
        return `
            <div class="artist-card recommendation-card">
                <div class="recommendation-header">
                    ${profilePic}
                    <div class="recommendation-title">
                        <h3 class="artist-name">${toTitleCase(artist.name)}</h3>
                        <p class="artist-styles">${styles.map(toTitleCase).join(', ')}</p>
                        ${matchBadgesHtml}
                    </div>
                </div>
                
                <div class="recommendation-body">
                    <div class="artist-meta-small">
                        <span><i class="fa-solid fa-location-dot"></i> ${toTitleCase(artist.ubicacion || 'Ubicación no especificada')}</span>
                        <span class="price-tag"><i class="fa-solid fa-tag"></i> ${artist.session_price || 'Consultar'}</span>
                    </div>
                    
                    <div class="recommendation-links">
                        ${artist.instagram ? `<a href="${formatInstagramUrl(artist.instagram)}" target="_blank" class="btn-text" onclick="event.stopPropagation();">Ver Portfolio</a>` : ''}
                    </div>
                </div>

                <button class="btn btn-primary btn-sm" onclick="selectRecommendedArtist('${artist.user_id}')">
                    Seleccionar Artista
                </button>
            </div>
        `;
    }).join('');
}

function selectRecommendedArtist(artistId) {
    // Fetch artist data and proceed with the flow
    showLoading();
    fetchAllArtists().then(artists => {
        const artist = artists.find(a => a.user_id === artistId);
        if (artist) {
            // Store artist data including username
            formData.artist_username = artist.username;
            formData.artist_data = artist;
            formData.artist_id = artist.user_id;
            formData.artist_name = artist.name;
            formData.artist_email = artist.email;
            formData.artist_instagram = artist.instagram;
            formData.artist_styles = Array.isArray(artist.styles_array) ? JSON.stringify(artist.styles_array) : artist.styles_array;
            formData.artist_current_city = artist.ubicacion;
            formData.artist_studio_name = artist.estudios;
            formData.artist_session_cost_amount = artist.session_price;
            formData.artist_portfolio = artist.portafolio || formatInstagramUrl(artist.instagram);
            formData.no_artist = false; // Now we have one

            autoSaveQuotation();
            
            // Find next incomplete step - if form is complete, go to summary; otherwise continue flow
            const bodyPartIdx = questionsConfig.findIndex(q => q.step === 'body-part');
            const nextIncomplete = findNextIncompleteStepIndex(bodyPartIdx !== -1 ? bodyPartIdx : 0);
            
            if (nextIncomplete !== -1) {
                commitStepChange(nextIncomplete);
            } else {
                // All steps complete, go to summary
                const summaryIdx = questionsConfig.findIndex(q => q.step === 'summary');
                if (summaryIdx !== -1) {
                    commitStepChange(summaryIdx);
                } else {
                    nextStep();
                }
            }
        }
        hideLoading();
    }).catch(err => {
        console.error(err);
        hideLoading();
    });
}

function confirmArtist() {
    nextStep();
}

function displayArtistCard(artist) {
    // Fill template data
    setText('artist-name-display', toTitleCase(artist.name));
    setText('artist-styles-display', Array.isArray(artist.styles_array) ? artist.styles_array.map(toTitleCase).join(', ') : toTitleCase(artist.styles_array));
    setText('artist-location-display', toTitleCase(artist.ubicacion));
    setText('artist-studio-display', toTitleCase(artist.estudios || 'Independiente'));
    setText('artist-price-display', artist.session_price || 'Consultar');
    
    // Profile Picture Logic
    const defaultAvatar = document.getElementById('artist-avatar-default');
    const profileImg = document.getElementById('artist-profile-img');
    
    if (artist.profile_picture) {
        if (profileImg) {
            profileImg.src = artist.profile_picture;
            profileImg.classList.remove('hidden');
        }
        if (defaultAvatar) defaultAvatar.classList.add('hidden');
    } else {
        if (profileImg) profileImg.classList.add('hidden');
        if (defaultAvatar) defaultAvatar.classList.remove('hidden');
    }

    const link = document.getElementById('artist-instagram-link');
    if (link) link.href = formatInstagramUrl(artist.instagram);
}
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

function formatInstagramUrl(instagram) {
    if (!instagram) return '#';
    if (instagram.startsWith('http')) return instagram;
    const handle = instagram.replace('@', '').trim();
    if (!handle) return '#';
    return `https://www.instagram.com/${handle}/`;
}


// City & Travel Logic
function handleCitySelection() {
    // Try both fixed ID and dynamic ID (field-14)
    const q = questionsConfig[currentStepIndex];
    const cityInput = document.getElementById(`field-${q.id}`) || document.getElementById('client-city');
    let city = cityInput ? cityInput.value.trim() : '';

    if (!city) {
        return;
    }

    // Title case the city name
    city = toTitleCase(city);
    formData.client_city_residence = city;

    const artistCity = formData.artist_current_city || '';
    const cleanClientCity = city.split(',')[0].toLowerCase().trim();
    const cleanArtistCity = artistCity.split(',')[0].toLowerCase().trim();

    // Intelligent match check (70% similarity)
    const similarity = getStringSimilarity(cleanClientCity, cleanArtistCity);
    const isMatch = similarity >= 0.7;

    if (artistCity && !isMatch) {
        // Warning: City mismatch
        showToastMessage(`Nota: El artista se encuentra en ${toTitleCase(artistCity)}.`);
        formData.city_mismatch_acknowledged = true;
        
        // Show Travel question
        const travelIdx = questionsConfig.findIndex(q => q.step === 'travel');
        if (travelIdx !== -1) commitStepChange(travelIdx);
        else nextStep();
    } else {
        // Cities match or no artist data
        formData.city_mismatch_acknowledged = false;
        formData.client_travel_willing = false; // Not needed if cities match

        // Skip travel, go to next available step after travel
        const travelIdx = questionsConfig.findIndex(q => q.step === 'travel');
        if (travelIdx !== -1) {
            commitStepChange(travelIdx + 1);
        } else {
            nextStep();
        }
    }
}
function setTravel(val) {
    formData.client_travel_willing = val;
    hideToastMessage();
    nextStep();
}


// Redesigned Body Selector Logic (Bauhaus Edition)
function setupBodySelector() {
    showMainBodyParts();
    updateBodyUI();
}

function showMainBodyParts() {
    currentBodyZone = null;
    currentBodySide = null;
    
    document.getElementById('body-nav-header').classList.add('hidden');
    document.getElementById('body-sub-view').classList.add('hidden');
    document.getElementById('body-side-overlay').classList.add('hidden');
    
    const mainGrid = document.getElementById('body-main-view');
    mainGrid.classList.remove('hidden');

    if (!BODY_PARTS_DATA || BODY_PARTS_DATA.length === 0) {
        mainGrid.innerHTML = `<p class="empty-sheet-msg">No hay zonas configuradas</p>`;
        return;
    }

    mainGrid.innerHTML = BODY_PARTS_DATA.map((zone, index) => {
        const rotation = index % 2 === 0 ? '-1deg' : '1deg';
        const hasImage = !!zone.image;
        
        return `
            <div class="bauhaus-card-creative" style="--card-rot: ${rotation}" onclick="handleZoneClick('${zone.id}')">
                <button class="btn-info-trigger" onclick="event.stopPropagation(); openBodyPartDetail('${zone.id}')" aria-label="Ver información">
                    <i class="fa-solid fa-info"></i>
                </button>
                <div class="card-img-wrapper ${!hasImage ? 'no-image' : ''}">
                    ${hasImage ? `<img src="${zone.image}" alt="${zone.label}">` : ''}
                </div>
                <div class="card-title-block">
                    <h3 class="card-title-text">${zone.label}</h3>
                </div>
                <div class="bauhaus-pattern-grid">
                    <div class="card-technical-data">
                        <div class="tech-item">
                            <i class="fa-solid fa-layer-group"></i>
                            <span>${(zone.subparts || []).length} SUBSISTEMAS</span>
                        </div>
                        <div class="tech-item">
                            <i class="fa-solid fa-microchip"></i>
                            <span>REF: ${zone.id.toUpperCase()}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    document.getElementById('body-subtitle').textContent = 'Selecciona una zona principal para ver detalles';
}

function handleZoneClick(zoneId) {
    const zone = BODY_PARTS_DATA.find(z => z.id === zoneId);
    if (!zone) return;

    currentBodyZone = zone;

    // If zone has sides, show overlay first
    if (zone.sides === 'both') {
        showSideSelection();
    } else {
        showSubBodyParts(zoneId, null);
    }
}

function showSideSelection() {
    document.getElementById('body-main-view').classList.add('hidden');
    document.getElementById('body-side-overlay').classList.remove('hidden');
    document.getElementById('body-subtitle').textContent = '¿De qué lado será el tatuaje?';
}

function handleSideChosen(side) {
    currentBodySide = side;
    document.getElementById('body-side-overlay').classList.add('hidden');
    showSubBodyParts(currentBodyZone.id, side);
}

function showSubBodyParts(zoneId, side) {
    const zone = BODY_PARTS_DATA.find(z => z.id === zoneId);
    if (!zone) return;

    currentBodyZone = zone;
    currentBodySide = side;

    // Update Header
    document.getElementById('body-nav-header').classList.remove('hidden');
    const sideText = side ? ` [${side === 'both' ? 'AMBOS' : side === 'left' ? 'IZQUIERDO' : 'DERECHO'}]` : '';
    document.getElementById('current-body-zone').textContent = zone.label + sideText;
    document.getElementById('body-subtitle').textContent = 'Selecciona las partes específicas';

    // Hide others, Show Sub
    document.getElementById('body-main-view').classList.add('hidden');
    document.getElementById('body-side-overlay').classList.add('hidden');
    const subGrid = document.getElementById('body-sub-view');
    subGrid.classList.remove('hidden');

    const subparts = zone.subparts || [];
    const gridContainer = document.getElementById('sub-parts-grid');

    if (subparts.length === 0) {
        gridContainer.innerHTML = '<p class="empty-sheet-msg">No hay subpartes definidas</p>';
        return;
    }

    gridContainer.innerHTML = subparts.map(part => {
        const isSelected = selectedBodyParts.some(p => p.id === part.id && p.zone === zone.id && p.side === side);
        const painLevel = part.pain_level || 5;
        const painClass = painLevel <= 3 ? 'pain-val-low' : (painLevel <= 6 ? 'pain-val-medium' : 'pain-val-high');

        return `
            <div class="bauhaus-sub-card ${isSelected ? 'selected' : ''}" onclick="toggleSubPart('${part.id}', '${zone.id}')">
                <button class="btn-info-trigger" onclick="event.stopPropagation(); openBodyPartDetail('${part.id}', '${zone.id}')" aria-label="Ver información">
                    <i class="fa-solid fa-info"></i>
                </button>
                <div class="sub-card-header">
                    <span class="sub-card-label">${part.label}</span>
                    <div class="sub-card-indicator">
                        ${isSelected ? '<i class="fa-solid fa-check"></i>' : ''}
                    </div>
                </div>
                <div class="card-technical-data">
                    <div class="tech-item">
                        <i class="fa-solid fa-fire"></i>
                        <span class="${painClass}">DOLOR: ${painLevel}/10</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function toggleSubPart(partId, zoneId) {
    const zone = BODY_PARTS_DATA.find(z => z.id === zoneId);
    const part = zone.subparts.find(p => p.id === partId);
    const side = currentBodySide;

    const existingIndex = selectedBodyParts.findIndex(p => p.id === partId && p.zone === zoneId && p.side === side);

    if (existingIndex >= 0) {
        selectedBodyParts.splice(existingIndex, 1);
    } else {
        selectedBodyParts.push({
            id: partId,
            zone: zoneId,
            label: part.label,
            zoneLabel: zone.label,
            side: side,
            sideLabel: side ? (side === 'both' ? 'Ambos' : (side === 'left' ? 'Izquierdo' : 'Derecho')) : null,
            pain_level: part.pain_level
        });
    }

    // Update the card UI without full re-render if possible, but for simplicity let's re-render sub-parts
    showSubBodyParts(zoneId, side);
    updateBodyUI();
}

function updateBodyUI() {
    const sheetContent = document.getElementById('selected-parts-sheet');
    const continueBtn = document.getElementById('body-continue-btn');

    if (!sheetContent) return;

    if (selectedBodyParts.length === 0) {
        sheetContent.innerHTML = '<p class="empty-sheet-msg">Ninguna zona seleccionada en el sistema</p>';
        if (continueBtn) continueBtn.disabled = true;
        return;
    }

    sheetContent.innerHTML = selectedBodyParts.map(p => `
        <div class="sheet-entry">
            <div class="entry-path">
                <span class="path-zone">${p.zoneLabel}</span>
                <span class="path-sep">/</span>
                <span class="path-part">${p.label}</span>
                ${p.sideLabel ? `<span class="path-side">${p.sideLabel.toUpperCase()}</span>` : ''}
            </div>
            <button class="btn-entry-remove" onclick="removeBodyPart('${p.id}', '${p.zone}', '${p.side}')">
                <i class="fa-solid fa-times"></i>
            </button>
        </div>
    `).join('');

    if (continueBtn) continueBtn.disabled = false;
}

function removeBodyPart(partId, zoneId, side) {
    // Correctly handle null side in comparison
    selectedBodyParts = selectedBodyParts.filter(p => 
        !(p.id === partId && p.zone === zoneId && (p.side === side || (p.side === null && side === 'null')))
    );

    // If currently viewing that zone and side, refresh view
    if (currentBodyZone && currentBodyZone.id === zoneId && (currentBodySide === side || (currentBodySide === null && side === 'null'))) {
        showSubBodyParts(zoneId, currentBodySide);
    }

    updateBodyUI();
}

function confirmBodyParts() {
    const grouped = {};
    selectedBodyParts.forEach(p => {
        if (!grouped[p.zoneLabel]) grouped[p.zoneLabel] = [];
        const sideText = p.sideLabel ? ` (${p.sideLabel})` : '';
        grouped[p.zoneLabel].push(p.label + sideText);
    });

    const textResult = Object.keys(grouped).map(k => `${toTitleCase(k)}: ${grouped[k].map(toTitleCase).join(', ')}`).join('; ');

    formData.tattoo_body_part = textResult;
    formData.tattoo_body_parts_data = selectedBodyParts;
    nextStep();
}

// Clean up unused legacy functions
function togglePartInfo() {}
function openBodyPartInfoModal() {}
function closeBodyPartInfoModal() {}
function selectSide() {}
function toggleWholeZone() {}
function updateZoneSelectAllState() {}


function openBodyPartDetail(partId, zoneId = null) {
    let part = null;
    
    if (zoneId) {
        // Find subpart
        const zone = BODY_PARTS_DATA.find(z => z.id === zoneId);
        if (zone) {
            part = zone.subparts.find(p => p.id === partId);
        }
    } else {
        // Find main zone
        part = BODY_PARTS_DATA.find(p => p.id === partId);
    }

    if (!part) return;

    // Populate Modal
    document.getElementById('body-part-detail-title').textContent = part.label;
    
    // Render expanded media in header
    renderBodyPartDetailMedia(part);
    
    // Sensitivity
    const sensitivity = part.sensitivity || 5;
    document.getElementById('bp-sensitivity-val').textContent = `${sensitivity}/10`;
    document.getElementById('bp-sensitivity-fill').style.width = `${sensitivity * 10}%`;

    // Pain
    const pain = part.pain_level || 5;
    document.getElementById('bp-pain-val').textContent = `${pain}/10`;
    document.getElementById('bp-pain-fill').style.width = `${pain * 10}%`;

    // Text Content
    const setContent = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = text ? text.replace(/\n/g, '<br>') : '<em>No hay información disponible.</em>';
    };

    setContent('bp-description', part.description);
    setContent('bp-tattoo-info', part.tattoo_info);
    setContent('bp-experience-info', part.experience_info);

    // Show Modal
    const overlay = document.getElementById('body-part-detail-overlay');
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // Prevent background scrolling
}

/**
 * Render media (image/video) in the body part detail modal header
 * @param {Object} part - The body part data object
 */
function renderBodyPartDetailMedia(part) {
    const mediaContainer = document.getElementById('bp-detail-media');
    const headerContainer = document.getElementById('bp-detail-header');
    
    if (!mediaContainer || !headerContainer) return;

    // Get media settings from part data
    const mediaType = part.expanded_media_type || 'none';
    const mediaUrl = part.expanded_media_url || '';
    const mediaBg = part.expanded_media_bg || '#1a1a1a';
    const alignH = part.expanded_media_align_h || 'center';
    const alignV = part.expanded_media_align_v || 'center';
    const mediaFit = part.expanded_media_fit || 'cover';

    // Apply background color to header
    headerContainer.style.backgroundColor = mediaBg;

    // Build object-position from alignment values
    const objectPosition = `${alignH} ${alignV}`;

    // Render based on media type
    if (mediaType === 'image' && mediaUrl) {
        mediaContainer.innerHTML = `
            <img 
                src="${mediaUrl}" 
                alt="${part.label}" 
                style="
                    width: 100%; 
                    height: 100%; 
                    object-fit: ${mediaFit}; 
                    object-position: ${objectPosition};
                    display: block;
                "
            >
        `;
        mediaContainer.classList.remove('style-detail-header-placeholder');
        mediaContainer.style.cssText = 'width: 100%; height: 100%; background: none; display: block;';
    } else if (mediaType === 'video' && mediaUrl) {
        mediaContainer.innerHTML = `
            <video 
                src="${mediaUrl}" 
                autoplay 
                loop 
                muted 
                playsinline
                style="
                    width: 100%; 
                    height: 100%; 
                    object-fit: ${mediaFit}; 
                    object-position: ${objectPosition};
                    display: block;
                "
            ></video>
        `;
        mediaContainer.classList.remove('style-detail-header-placeholder');
        mediaContainer.style.cssText = 'width: 100%; height: 100%; background: none; display: block;';
    } else {
        // Default placeholder with gradient background
        mediaContainer.innerHTML = '<i class="fa-solid fa-layer-group"></i>';
        mediaContainer.classList.add('style-detail-header-placeholder');
        mediaContainer.style.cssText = '';
        // Reset header background for placeholder mode
        headerContainer.style.backgroundColor = '';
    }
}

function closeBodyPartDetailModal() {
    const overlay = document.getElementById('body-part-detail-overlay');
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
}

// ============ TATTOO STYLES SELECTOR ============
let TATTOO_STYLES_DATA = [];
let currentModalStyle = null; // Style currently being viewed in modal
let selectedModalSubstyle = null; // Substyle selected in modal

async function setupTattooStyles() {
    const grid = document.getElementById('styles-grid');
    const loading = document.getElementById('styles-loading');
    
    if (!grid || !loading) return;
    
    // Show loading
    grid.innerHTML = '';
    loading.classList.remove('hidden');
    
    try {
        // Load styles from Supabase via ConfigManager
        TATTOO_STYLES_DATA = await window.ConfigManager.loadTattooStylesFromDB();
        loading.classList.add('hidden');
        
        if (!TATTOO_STYLES_DATA || TATTOO_STYLES_DATA.length === 0) {
            grid.innerHTML = '<p class="empty-state">No hay estilos configurados</p>';
            return;
        }
        
        renderStylesGrid(TATTOO_STYLES_DATA);
    } catch (err) {
        console.error('Error loading tattoo styles:', err);
        loading.classList.add('hidden');
        grid.innerHTML = '<p class="error-msg">Error al cargar estilos</p>';
    }
}

function renderStylesGrid(styles) {
    const grid = document.getElementById('styles-grid');
    if (!grid) return;
    
    grid.innerHTML = styles.map(style => {
        const hasSubstyles = style.substyles && style.substyles.length > 0;
        const coverImg = style.cover_image_url 
            ? `<img src="${style.cover_image_url}" alt="${style.name}" class="style-card-img">`
            : `<div class="style-card-placeholder"><i class="fa-solid fa-palette"></i></div>`;
        
        // Check if this style is currently selected
        const currentSelection = formData.tattoo_style;
        let isSelected = false;
        if (currentSelection && typeof currentSelection === 'object') {
            isSelected = currentSelection.style_id === style.id;
        }
        
        return `
            <div class="style-card ${isSelected ? 'selected' : ''}" 
                 onclick="openStyleDetailModal('${style.id}')">
                <div class="style-card-cover">
                    ${coverImg}
                    ${hasSubstyles ? `<span class="style-badge">${style.substyles.length} subestilos</span>` : ''}
                </div>
                <div class="style-card-body">
                    <h4 class="style-card-title">${style.name}</h4>
                </div>
            </div>
        `;
    }).join('');
}

function openStyleDetailModal(styleId) {
    const style = TATTOO_STYLES_DATA.find(s => s.id === styleId);
    if (!style) {
        console.error('Style not found:', styleId);
        return;
    }
    
    currentModalStyle = style;
    selectedModalSubstyle = null;
    
    // Check if there's already a selection for this style
    const currentSelection = formData.tattoo_style;
    if (currentSelection && typeof currentSelection === 'object' && currentSelection.style_id === style.id) {
        selectedModalSubstyle = currentSelection.substyle_id || null;
    }
    
    // Populate modal
    const overlay = document.getElementById('style-detail-overlay');
    const img = document.getElementById('style-detail-img');
    const placeholder = document.getElementById('style-detail-placeholder');
    const title = document.getElementById('style-detail-title');
    const description = document.getElementById('style-detail-description');
    const substylesCount = document.getElementById('style-detail-substyles-count');
    const substylesSection = document.getElementById('style-detail-substyles-section');
    const substylesGrid = document.getElementById('substyles-grid');
    
    // Set image or placeholder
    if (style.cover_image_url) {
        img.src = style.cover_image_url;
        img.alt = style.name;
        img.classList.remove('hidden');
        placeholder.classList.add('hidden');
    } else {
        img.classList.add('hidden');
        placeholder.classList.remove('hidden');
    }
    
    // Set title and description
    title.textContent = style.name;
    description.textContent = style.description || 'Sin descripción disponible.';
    
    // Handle substyles
    const hasSubstyles = style.substyles && style.substyles.length > 0;
    if (hasSubstyles) {
        substylesCount.textContent = `${style.substyles.length} Subestilos`;
        substylesCount.classList.remove('hidden');
        substylesSection.classList.remove('hidden');
        
        // Render substyles options
        substylesGrid.innerHTML = style.substyles.map(sub => {
            const isSubSelected = selectedModalSubstyle === sub.id;
            return `
                <div class="substyle-option ${isSubSelected ? 'selected' : ''}" 
                     onclick="selectModalSubstyle('${sub.id}')">
                    <span class="substyle-option-name">${sub.name}</span>
                    <span class="substyle-option-check">${isSubSelected ? '✓' : ''}</span>
                </div>
            `;
        }).join('');
    } else {
        substylesCount.classList.add('hidden');
        substylesSection.classList.add('hidden');
        substylesGrid.innerHTML = '';
    }
    
    // Update button state
    updateSelectButtonState();
    
    // Show modal
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function selectModalSubstyle(substyleId) {
    // Toggle selection
    if (selectedModalSubstyle === substyleId) {
        selectedModalSubstyle = null;
    } else {
        selectedModalSubstyle = substyleId;
    }
    
    // Update UI
    document.querySelectorAll('.substyle-option').forEach(opt => {
        opt.classList.remove('selected');
        opt.querySelector('.substyle-option-check').textContent = '';
    });
    
    if (selectedModalSubstyle) {
        const selectedOpt = document.querySelector(`.substyle-option[onclick*="${selectedModalSubstyle}"]`);
        if (selectedOpt) {
            selectedOpt.classList.add('selected');
            selectedOpt.querySelector('.substyle-option-check').textContent = '✓';
        }
    }
    
    updateSelectButtonState();
}

function updateSelectButtonState() {
    const btn = document.getElementById('btn-select-style');
    if (!btn || !currentModalStyle) return;
    
    const hasSubstyles = currentModalStyle.substyles && currentModalStyle.substyles.length > 0;
    
    if (hasSubstyles && selectedModalSubstyle) {
        const sub = currentModalStyle.substyles.find(s => s.id === selectedModalSubstyle);
        btn.querySelector('span').textContent = `Seleccionar "${sub?.name || 'Subestilo'}"`;
    } else if (hasSubstyles) {
        btn.querySelector('span').textContent = `Seleccionar "${currentModalStyle.name}" (sin subestilo)`;
    } else {
        btn.querySelector('span').textContent = `Seleccionar "${currentModalStyle.name}"`;
    }
}

function closeStyleDetailModal() {
    const overlay = document.getElementById('style-detail-overlay');
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
    currentModalStyle = null;
    selectedModalSubstyle = null;
}

function confirmStyleSelection() {
    if (!currentModalStyle) return;
    
    let substyle = null;
    if (selectedModalSubstyle && currentModalStyle.substyles) {
        substyle = currentModalStyle.substyles.find(s => s.id === selectedModalSubstyle);
    }
    
    // Save as JSONB object matching the plan structure
    formData.tattoo_style = {
        style_id: currentModalStyle.id,
        style_slug: currentModalStyle.slug,
        style_name: currentModalStyle.name,
        substyle_id: substyle ? substyle.id : null,
        substyle_slug: substyle ? substyle.slug : null,
        substyle_name: substyle ? substyle.name : null
    };
    
    console.log('Selected tattoo style:', formData.tattoo_style);
    
    // Close modal
    closeStyleDetailModal();
    
    // Update grid to show selection
    renderStylesGrid(TATTOO_STYLES_DATA);
    
    // Proceed to next step after a short delay
    setTimeout(() => nextStep(), 200);
}

// Make functions globally available
window.openStyleDetailModal = openStyleDetailModal;
window.closeStyleDetailModal = closeStyleDetailModal;
window.selectModalSubstyle = selectModalSubstyle;
window.confirmStyleSelection = confirmStyleSelection;


// File Upload
function setupFileUpload() {
    const drop = document.getElementById('drop-zone');
    const input = document.getElementById('file-input');
    if (!drop || !input) return;

    drop.onclick = () => input.click();
    input.onchange = (e) => handleFiles(e.target.files);
    // Drag/Drop events (simplified for brevity)
}
function handleFiles(files) {
    const remainingSlots = 4 - uploadedFiles.length;
    if (remainingSlots <= 0) {
        showToastMessage("Máximo 4 imágenes de referencia permitidas.");
        return;
    }

    const filesArray = Array.from(files).slice(0, remainingSlots);
    if (filesArray.length < files.length) {
        showToastMessage("Solo se agregaron las primeras 4 imágenes.");
    }

    uploadedFiles = [...uploadedFiles, ...filesArray];
    formData.reference_images_count = uploadedFiles.length;
    renderPreviews();
}

function renderPreviews() {
    const cont = document.getElementById('preview-container');
    if (!cont) return;
    cont.innerHTML = '';
    
    uploadedFiles.forEach((f, index) => {
        const url = URL.createObjectURL(f);
        const div = document.createElement('div');
        div.className = 'preview-item';
        div.style.backgroundImage = `url(${url})`;
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.innerHTML = '&times;';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removeUploadedFile(index);
        };
        
        div.appendChild(removeBtn);
        cont.appendChild(div);
    });

    // Update drop zone visibility/state if needed
    const dropZone = document.getElementById('drop-zone');
    if (dropZone) {
        if (uploadedFiles.length >= 4) {
            dropZone.style.opacity = '0.5';
            dropZone.style.pointerEvents = 'none';
        } else {
            dropZone.style.opacity = '1';
            dropZone.style.pointerEvents = 'auto';
        }
    }
}

function removeUploadedFile(index) {
    uploadedFiles.splice(index, 1);
    formData.reference_images_count = uploadedFiles.length;
    renderPreviews();
}
function skipReferences() {
    uploadedFiles = [];
    nextStep();
}

// ============ REFERENCE IMAGES - STORAGE UPLOAD ============

/**
 * Upload reference images to Supabase Storage
 * @param {string} quoteId - The quotation ID (e.g., QN12345)
 * @returns {Promise<{success: boolean, files: Array, error?: string}>}
 */
async function uploadReferencesToStorage(quoteId) {
    if (!uploadedFiles || uploadedFiles.length === 0) {
        console.log('ℹ️ No reference images to upload');
        return { success: true, files: [] };
    }

    const supabaseClient = window.ConfigManager && window.ConfigManager.getSupabaseClient();
    if (!supabaseClient) {
        console.warn('⚠️ Supabase not available for image upload');
        return { success: false, files: [], error: 'Supabase not configured' };
    }

    const config = window.ConfigManager.get();
    const bucketName = config.supabase?.storageBucket || 'quotation-references';
    const uploadedUrls = [];
    const errors = [];

    console.log(`📤 Uploading ${uploadedFiles.length} reference images to ${bucketName}/${quoteId}/`);

    for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        const fileExt = file.name.split('.').pop().toLowerCase();
        const fileName = `ref_${i + 1}_${Date.now()}.${fileExt}`;
        const filePath = `${quoteId}/${fileName}`;

        try {
            // Upload to Supabase Storage
            const { data, error } = await supabaseClient
                .storage
                .from(bucketName)
                .upload(filePath, file, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (error) {
                console.error(`❌ Error uploading ${fileName}:`, error.message);
                errors.push({ file: fileName, error: error.message });
                continue;
            }

            // Get public URL
            const { data: urlData } = supabaseClient
                .storage
                .from(bucketName)
                .getPublicUrl(filePath);

            uploadedUrls.push({
                fileName: fileName,
                originalName: file.name,
                path: filePath,
                publicUrl: urlData.publicUrl,
                mimeType: file.type,
                size: file.size
            });

            console.log(`✅ Uploaded: ${fileName}`);
        } catch (err) {
            console.error(`❌ Exception uploading ${fileName}:`, err);
            errors.push({ file: fileName, error: err.message });
        }
    }

    if (errors.length > 0) {
        console.warn(`⚠️ ${errors.length} files failed to upload`);
    }

    return {
        success: errors.length === 0,
        files: uploadedUrls,
        errors: errors.length > 0 ? errors : undefined
    };
}

/**
 * Notify n8n webhook about new reference images for Google Drive transfer
 * @param {string} quoteId - The quotation ID
 * @param {Array} files - Array of uploaded file info
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function notifyN8NWebhook(quoteId, files) {
    const config = window.ConfigManager.get();
    const webhookUrl = config.n8n?.webhookUrl;

    if (!webhookUrl) {
        console.warn('⚠️ n8n webhook URL not configured');
        return { success: false, error: 'Webhook URL not configured' };
    }

    if (!files || files.length === 0) {
        console.log('ℹ️ No files to notify n8n about');
        return { success: true };
    }

    const payload = {
        quote_id: quoteId,
        client_name: formData.client_full_name || '',
        artist_name: formData.artist_name || '',
        files: files.map(f => ({
            file_name: f.fileName,
            original_name: f.originalName,
            public_url: f.publicUrl,
            mime_type: f.mimeType,
            size: f.size
        })),
        drive_folder_id: config.n8n?.driveFolderId || '',
        timestamp: new Date().toISOString()
    };

    try {
        console.log(`📡 Notifying n8n webhook for ${files.length} files...`);
        
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        console.log('✅ n8n webhook notified successfully');
        return { success: true };
    } catch (err) {
        console.error('❌ Error notifying n8n webhook:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Upload files to Google Drive via backend API
 * Creates a folder with the quote number and uploads all images to it
 * @param {string} quoteId - The quotation ID (e.g., QN12345)
 * @param {Array} files - Array of uploaded file info from Supabase
 * @returns {Promise<{success: boolean, quoteFolderLink?: string, uploadedFiles?: Array, error?: string}>}
 */
async function uploadToGoogleDrive(quoteId, files) {
    const config = window.ConfigManager.get();
    const mainFolderId = config.googleDrive?.mainFolderId;
    const serviceAccountJson = config.googleDrive?.serviceAccountJson;
    
    if (!mainFolderId) {
        console.warn('Google Drive main folder not configured');
        return { success: false, error: 'Google Drive folder not configured' };
    }
    
    if (!serviceAccountJson) {
        console.warn('Google Drive credentials not configured');
        return { success: false, error: 'Google Drive credentials not configured' };
    }
    
    // Parse credentials
    let credentials;
    try {
        credentials = JSON.parse(serviceAccountJson);
    } catch (e) {
        console.error('Invalid Google Drive credentials JSON');
        return { success: false, error: 'Invalid credentials format' };
    }
    
    if (!files || files.length === 0) {
        console.log('No files to upload to Google Drive');
        return { success: true, uploadedFiles: [] };
    }
    
    try {
        console.log(`Uploading ${files.length} files to Google Drive folder for ${quoteId}...`);
        
        const response = await fetch('/api/google-drive/create-quote-folder', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                quoteId: quoteId,
                quoteNumber: quoteId,
                mainFolderId: mainFolderId,
                credentials: credentials,
                files: files.map(f => ({
                    url: f.publicUrl,
                    fileName: f.fileName,
                    mimeType: f.mimeType
                }))
            })
        });
        
        const result = await response.json();
        
        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Failed to upload to Google Drive');
        }
        
        console.log(`Google Drive folder created: ${result.quoteFolderLink}`);
        console.log(`Uploaded ${result.uploadedCount} files successfully`);
        
        // Log any upload errors for debugging
        if (result.uploadErrors && result.uploadErrors.length > 0) {
            console.warn('Some files failed to upload:', result.uploadErrors);
        }
        
        if (result.warning) {
            console.warn('Upload warning:', result.warning);
        }
        
        return {
            success: true,
            quoteFolderLink: result.quoteFolderLink,
            quoteFolderId: result.quoteFolderId,
            uploadedCount: result.uploadedCount,
            uploadedFiles: result.uploadedFiles || [], // Array of { id, name, webViewLink, webContentLink }
            uploadErrors: result.uploadErrors,
            partialSuccess: result.partialSuccess
        };
    } catch (err) {
        console.error('Error uploading to Google Drive:', err);
        return { success: false, error: err.message, uploadedFiles: [] };
    }
}

/**
 * Save attachment records to Supabase quotations_attachments table
 * @param {string} quoteId - The quotation ID
 * @param {Array} uploadedFiles - Array of uploaded file info from Google Drive
 * @param {Array} originalFiles - Original file info with mimeType
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function saveAttachmentRecords(quoteId, uploadedFiles, originalFiles) {
    if (!uploadedFiles || uploadedFiles.length === 0) {
        console.log('No attachment records to save');
        return { success: true };
    }
    
    const supabaseClient = window.ConfigManager && window.ConfigManager.getSupabaseClient();
    if (!supabaseClient) {
        console.warn('Supabase not available for saving attachment records');
        return { success: false, error: 'Supabase not configured' };
    }
    
    try {
        console.log(`Saving ${uploadedFiles.length} attachment records for ${quoteId}...`);
        
        // Map uploaded files to attachment records
        const attachmentRecords = uploadedFiles.map((file, index) => {
            // Find matching original file for mimeType
            const originalFile = originalFiles && originalFiles[index];
            
            return {
                quotation_id: quoteId,
                google_drive_id: file.id,
                google_drive_url: file.webViewLink || file.webContentLink,
                file_name: file.name,
                mime_type: originalFile?.mimeType || 'image/jpeg',
                attachment_type: 'reference',
                status: 'pending',
                sort_order: index + 1,
                created_at: new Date().toISOString()
            };
        });
        
        const { data, error } = await supabaseClient
            .from('quotations_attachments')
            .insert(attachmentRecords)
            .select();
        
        if (error) {
            console.error('Error saving attachment records:', error);
            return { success: false, error: error.message };
        }
        
        console.log(`Successfully saved ${attachmentRecords.length} attachment records`);
        return { success: true, records: data };
    } catch (err) {
        console.error('Exception saving attachment records:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Process reference images: upload to Supabase storage and Google Drive
 * @param {string} quoteId - The quotation ID
 * @returns {Promise<{success: boolean, driveUrl?: string, error?: string}>}
 */
async function processReferenceImages(quoteId) {
    // Step 1: Upload to Supabase Storage (as backup and for fast access)
    const uploadResult = await uploadReferencesToStorage(quoteId);
    
    if (!uploadResult.success && uploadResult.files.length === 0) {
        return { success: false, error: uploadResult.error || 'Upload failed' };
    }

    // Step 2: Upload to Google Drive via backend API (primary storage)
    let driveUrl = null;
    let uploadedDriveFiles = [];
    
    if (uploadResult.files.length > 0) {
        const config = window.ConfigManager.get();
        const mainFolderId = config.googleDrive?.mainFolderId;
        
        if (mainFolderId) {
            // Use new Google Drive API integration
            const driveResult = await uploadToGoogleDrive(quoteId, uploadResult.files);
            
            if (driveResult.success && driveResult.quoteFolderLink) {
                driveUrl = driveResult.quoteFolderLink;
                uploadedDriveFiles = driveResult.uploadedFiles || [];
                console.log(`Google Drive folder for ${quoteId}: ${driveUrl}`);
                
                // Step 3: Save attachment records to database
                if (uploadedDriveFiles.length > 0) {
                    const attachmentResult = await saveAttachmentRecords(
                        quoteId, 
                        uploadedDriveFiles,
                        uploadResult.files // Original files with mimeType
                    );
                    
                    if (!attachmentResult.success) {
                        console.warn('Failed to save attachment records:', attachmentResult.error);
                        // Don't fail the whole process - files are uploaded, just not tracked in DB
                    }
                }
                
                // Log if some files failed to upload
                if (driveResult.uploadErrors && driveResult.uploadErrors.length > 0) {
                    console.warn(`${driveResult.uploadErrors.length} file(s) failed to upload to Google Drive`);
                }
            } else {
                console.warn('Google Drive upload failed, using Supabase storage only');
            }
        } else {
            // Fallback: Try legacy n8n webhook if Google Drive API not configured
            const webhookUrl = config.n8n?.webhookUrl;
            if (webhookUrl) {
                console.log('Using legacy n8n webhook for Google Drive transfer...');
                const notifyResult = await notifyN8NWebhook(quoteId, uploadResult.files);
                
                if (notifyResult.success) {
                    const legacyFolderId = config.n8n?.driveFolderId;
                    driveUrl = legacyFolderId 
                        ? `https://drive.google.com/drive/folders/${legacyFolderId}` 
                        : null;
                }
            }
        }

        return {
            success: true,
            filesUploaded: uploadResult.files.length,
            filesUploadedToDrive: uploadedDriveFiles.length,
            driveUrl: driveUrl
        };
    }

    return { success: true, filesUploaded: 0, filesUploadedToDrive: 0 };
}


// Summary
function generateSummary() {
    hideToastMessage();
    summaryReached = true; // Mark that user reached the end
    const cont = document.getElementById('summary-content');
    if (!cont) return;

    // Calculate age if birth date exists
    let ageDisplay = '-';
    if (formData.client_birth_date) {
        try {
            const birthDate = parseSpanishDate(formData.client_birth_date);
            if (birthDate && !isNaN(birthDate.getTime())) {
                const today = new Date();
                let age = today.getFullYear() - birthDate.getFullYear();
                const m = today.getMonth() - birthDate.getMonth();
                if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                    age--;
                }
                ageDisplay = age + ' Años';
                formData.client_age = age.toString(); // Sync age field
            }
        } catch (e) { console.error('Error calculating age', e); }
    }

    const medicalConditions = formData.client_medical_boolean ? 
        `Si (${formData.client_medical_details || 'Sin detalles'})` : 'No';
    
    const allergies = formData.client_allergies || 'Ninguna';

    // Reference image thumbnails
    let imagesHtml = '';
    if (uploadedFiles.length > 0) {
        imagesHtml = `
            <div class="summary-thumbnails">
                ${uploadedFiles.map(f => {
                    const url = URL.createObjectURL(f);
                    return `<div class="summary-thumb" style="background-image: url(${url})"></div>`;
                }).join('')}
            </div>
        `;
    }

    cont.innerHTML = `
        <div class="summary-section">
            <div class="section-header">
                <h3 class="summary-title">Artista</h3>
                <button class="btn-edit-small" onclick="goToStepByField('artist_username')">Editar</button>
            </div>
            <div class="summary-row"><span class="summary-label">Nombre:</span> <span class="summary-value">${toTitleCase(formData.artist_name) || 'Pendiente de recomendación'}</span></div>
            ${formData.artist_studio_name ? `<div class="summary-row"><span class="summary-label">Estudio:</span> <span class="summary-value">${toTitleCase(formData.artist_studio_name)}</span></div>` : ''}
            ${formData.artist_session_cost_amount ? `<div class="summary-row"><span class="summary-label">Costo sesión:</span> <span class="summary-value">${formData.artist_session_cost_amount}</span></div>` : ''}
            ${formData.artist_portfolio ? `<div class="summary-row"><span class="summary-label">Portfolio:</span> <span class="summary-value"><a href="${formData.artist_portfolio}" target="_blank" class="summary-link">Ver Trabajo <i class="fa-solid fa-external-link"></i></a></span></div>` : ''}
        </div>

        <div class="summary-section">
            <div class="section-header">
                <h3 class="summary-title">Tatuaje</h3>
                <button class="btn-edit-small" onclick="goToStepByField('tattoo_body_part')">Editar</button>
            </div>
            <div class="summary-row"><span class="summary-label">Idea:</span> <span class="summary-value">${formData.tattoo_idea_description || '-'}</span></div>
            <div class="summary-row"><span class="summary-label">Estilo:</span> <span class="summary-value">${formatTattooStyleForDisplay(formData.tattoo_style)}</span></div>
            <div class="summary-row"><span class="summary-label">Zona:</span> <span class="summary-value">${toTitleCase(formData.tattoo_body_part) || '-'}</span></div>
            <div class="summary-row"><span class="summary-label">Tamaño:</span> <span class="summary-value">${toTitleCase(formData.tattoo_size) || '-'}</span></div>
            <div class="summary-row"><span class="summary-label">Color:</span> <span class="summary-value">${toTitleCase(formData.tattoo_color_type) || '-'}</span></div>
            <div class="summary-row"><span class="summary-label">Referencias:</span> <span class="summary-value">${formData.reference_images_count || 0} imágenes</span></div>
            ${imagesHtml}
        </div>

        <div class="summary-section">
            <div class="section-header">
                <h3 class="summary-title">Tus Datos</h3>
                <button class="btn-edit-small" onclick="goToStepByField('client_full_name')">Editar</button>
            </div>
            <div class="summary-row"><span class="summary-label">Nombre:</span> <span class="summary-value">${toTitleCase(formData.client_full_name) || '-'}</span></div>
            <div class="summary-row"><span class="summary-label">Edad:</span> <span class="summary-value">${ageDisplay}</span></div>
            <div class="summary-row"><span class="summary-label">Ciudad:</span> <span class="summary-value">${toTitleCase(formData.client_city_residence) || '-'}</span></div>
            <div class="summary-row"><span class="summary-label">WhatsApp:</span> <span class="summary-value">${formData.client_whatsapp || '-'}</span></div>
            <div class="summary-row"><span class="summary-label">Instagram:</span> <span class="summary-value">${formData.client_instagram ? (formData.client_instagram.startsWith('@') ? formData.client_instagram : '@' + formData.client_instagram) : '-'}</span></div>
            <div class="summary-row"><span class="summary-label">Fecha:</span> <span class="summary-value">${formData.client_preferred_date || '-'}</span></div>
            <div class="summary-row"><span class="summary-label">Presupuesto:</span> <span class="summary-value">${formData.client_budget_amount || '-'} ${formData.client_budget_currency || ''}</span></div>
            <div class="summary-row"><span class="summary-label">Salud:</span> <span class="summary-value">${medicalConditions}</span></div>
            <div class="summary-row"><span class="summary-label">Alergias:</span> <span class="summary-value">${allergies}</span></div>
        </div>
    `;
}

function goToStepByField(fieldName) {
    const stepIdx = questionsConfig.findIndex(q => q.field === fieldName);
    if (stepIdx !== -1) {
        commitStepChange(stepIdx);
    }
}

window.goToStepByField = goToStepByField;

// Submit
async function submitQuotation() {
    showLoading();

    // Track warnings for user feedback
    let uploadWarnings = [];

    try {
        // Finalize status
        formData.quote_status = 'pending';

        // 1. Upload reference images to Storage and notify n8n for Google Drive transfer
        let referenceImagesResult = null;
        if (uploadedFiles && uploadedFiles.length > 0) {
            console.log('Processing reference images...');
            referenceImagesResult = await processReferenceImages(formData.quote_id);
            
            if (referenceImagesResult.success) {
                // Log detailed results
                console.log(`Reference images processed:`);
                console.log(`  - Uploaded to Supabase: ${referenceImagesResult.filesUploaded || 0} files`);
                console.log(`  - Uploaded to Google Drive: ${referenceImagesResult.filesUploadedToDrive || 0} files`);
                
                if (referenceImagesResult.driveUrl) {
                    // Store the expected Google Drive folder URL
                    formData.tattoo_references = referenceImagesResult.driveUrl;
                    console.log(`  - Drive folder: ${referenceImagesResult.driveUrl}`);
                }
                
                // Check if some files failed to upload to Google Drive
                if (referenceImagesResult.filesUploaded > 0 && 
                    referenceImagesResult.filesUploadedToDrive === 0) {
                    // All files failed to upload to Google Drive
                    uploadWarnings.push('Las imagenes de referencia no se pudieron subir a Google Drive, pero se guardaron en el servidor.');
                    console.warn('Warning: All files failed to upload to Google Drive');
                } else if (referenceImagesResult.filesUploaded > referenceImagesResult.filesUploadedToDrive) {
                    // Some files failed
                    const failedCount = referenceImagesResult.filesUploaded - referenceImagesResult.filesUploadedToDrive;
                    uploadWarnings.push(`${failedCount} imagen(es) no se pudieron subir a Google Drive.`);
                    console.warn(`Warning: ${failedCount} files failed to upload to Google Drive`);
                }
            } else {
                // Image upload completely failed
                uploadWarnings.push('No se pudieron procesar las imagenes de referencia.');
                console.error('Error processing reference images:', referenceImagesResult.error);
            }
        }

        // 2. Save to Supabase - use ConfigManager to get properly initialized client
        const supabaseClient = window.ConfigManager && window.ConfigManager.getSupabaseClient();

        if (supabaseClient && !window.ConfigManager.isDemoMode()) {
            const payload = preparePayload();
            // Add created_at for the final submission if it doesn't exist (though upsert handles it)
            payload.created_at = new Date().toISOString();
            
            // Add reference images URL if available
            if (formData.tattoo_references) {
                payload.tattoo_references = formData.tattoo_references;
            }

            const { error } = await supabaseClient
                .from('quotations_db')
                .upsert([payload], { onConflict: 'quote_id' });
                
            if (error) throw error;
        }

        // 3. Send Email via EmailJS
        if (typeof emailjs !== 'undefined' && window.APP_CONFIG && window.APP_CONFIG.emailjs) {
            await emailjs.send(
                window.APP_CONFIG.emailjs.serviceId,
                window.APP_CONFIG.emailjs.templateId,
                {
                    to_email: formData.artist_email,
                    artist_name: formData.artist_name,
                    client_name: formData.client_full_name,
                    client_email: formData.client_email,
                    client_whatsapp: formData.client_whatsapp,
                    client_age: formData.client_age,
                    quote_id: formData.quote_id,
                    tattoo_description: formData.tattoo_idea_description || 'N/A',
                    tattoo_location: formData.tattoo_body_part,
                    tattoo_size: formData.tattoo_size,
                    tattoo_style: formData.tattoo_style,
                    client_budget: `${formData.client_budget_amount} ${formData.client_budget_currency}`,
                    client_date: formData.client_preferred_date,
                    medical_conditions: formData.client_medical_boolean ? formData.client_medical_details : 'Ninguna'
                }
            );
        } else if (!supabaseClient) {
            // Fallback for purely local demo
            await new Promise(r => setTimeout(r, 1500));
        }

        // 3. Fetch Next Steps content from app_settings
        let nextStepsContent = '<p><strong>1. Revisa tu correo</strong><br>El artista recibira tu solicitud y te contactara pronto.</p><p><strong>2. Prepara tus referencias</strong><br>Si tienes mas imagenes de inspiracion, tenlas listas para compartir.</p><p><strong>3. Agenda tu cita</strong><br>Una vez confirmes los detalles con el artista, agenda tu sesion.</p>';
        let websiteUrl = 'https://beta.weotzi.com';
        
        if (window.ConfigManager && typeof window.ConfigManager.getAppSettingFromDB === 'function') {
            try {
                const [nextSteps, webUrl] = await Promise.all([
                    window.ConfigManager.getAppSettingFromDB('success_next_steps'),
                    window.ConfigManager.getAppSettingFromDB('website_url')
                ]);
                if (nextSteps) nextStepsContent = nextSteps;
                if (webUrl) websiteUrl = webUrl;
            } catch (e) {
                console.warn('Could not fetch app settings:', e);
            }
        }

        // 4. Save client data for registration (before showing success)
        saveClientDataForRegistration();

        // 4.5 Trigger n8n webhook to send quotation summary email to client
        if (window.ConfigManager && typeof window.ConfigManager.sendN8NEvent === 'function') {
            try {
                await window.ConfigManager.sendN8NEvent('client_quotation_submitted', {
                    // Quotation info
                    quote_id: formData.quote_id,
                    quote_status: formData.quote_status || 'completed',
                    created_at: new Date().toISOString(),
                    
                    // Client info
                    client_name: formData.client_full_name,
                    client_email: formData.client_email,
                    client_whatsapp: formData.client_whatsapp || null,
                    client_instagram: formData.client_instagram || null,
                    client_age: formData.client_age || null,
                    client_birth_date: formData.client_birth_date || null,
                    client_city: formData.client_city_residence || null,
                    client_country: formData.client_country || null,
                    client_contact_preference: formData.client_contact_preference || null,
                    
                    // Artist info
                    artist_id: formData.artist_id || null,
                    artist_name: formData.artist_name,
                    artist_email: formData.artist_email || null,
                    artist_instagram: formData.artist_instagram || null,
                    artist_styles: formData.artist_styles || [],
                    artist_city: formData.artist_current_city || null,
                    artist_studio: formData.artist_studio_name || null,
                    artist_session_cost: formData.artist_session_cost_amount || null,
                    artist_portfolio: formData.artist_portfolio || null,
                    
                    // Tattoo details - Location
                    tattoo_body_part: formData.tattoo_body_part || null,
                    tattoo_body_side: formData.tattoo_body_side || null,
                    
                    // Tattoo details - Design
                    tattoo_description: formData.tattoo_idea_description || 'N/A',
                    tattoo_size: formData.tattoo_size || null,
                    tattoo_style: formData.tattoo_style || null,
                    tattoo_color_type: formData.tattoo_color_type || null,
                    
                    // Tattoo details - References
                    tattoo_references: formData.tattoo_references || null,
                    reference_images_count: formData.reference_images_count || 0,
                    
                    // Tattoo details - Experience
                    tattoo_is_first_tattoo: formData.tattoo_is_first_tattoo || null,
                    tattoo_is_cover_up: formData.tattoo_is_cover_up || null,
                    
                    // Client preferences - Budget
                    client_budget: formData.client_budget_amount ? `${formData.client_budget_amount} ${formData.client_budget_currency || ''}`.trim() : null,
                    client_budget_amount: formData.client_budget_amount || null,
                    client_budget_currency: formData.client_budget_currency || null,
                    
                    // Client preferences - Dates
                    client_preferred_date: formData.client_preferred_date || null,
                    client_flexible_dates: formData.client_flexible_dates || null,
                    
                    // Client preferences - Travel
                    client_travel_willing: formData.client_travel_willing || false,
                    city_mismatch: formData.city_mismatch_acknowledged || false,
                    style_mismatch: formData.style_mismatch_acknowledged || false,
                    
                    // Medical info
                    has_medical_conditions: formData.client_medical_boolean || false,
                    medical_details: formData.client_medical_boolean ? formData.client_medical_details : null,
                    client_allergies: formData.client_allergies || null,
                    
                    // URLs
                    register_url: window.location.origin + '/client/register',
                    login_url: window.location.origin + '/client/login'
                });
                console.log('n8n event sent: client_quotation_submitted');
            } catch (webhookErr) {
                console.warn('Could not send client_quotation_submitted event:', webhookErr);
            }
        }

        // 5. Show Success
        hideToastMessage(); // Hide any city mismatch or other toast notifications
        const container = document.getElementById('form-steps-container');
        // Clear history to prevent back nav
        historyStack = [];
        updateBackButton();

        // Build warning HTML if there were upload issues
        let warningHtml = '';
        if (uploadWarnings.length > 0) {
            warningHtml = `
                <div class="upload-warning" style="background: #FFF3CD; border: 1px solid #FFECB5; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; text-align: left;">
                    <p style="margin: 0; color: #856404; font-size: 14px;">
                        <i class="fa-solid fa-triangle-exclamation" style="margin-right: 8px;"></i>
                        <strong>Aviso:</strong> ${uploadWarnings.join(' ')}
                    </p>
                    <p style="margin: 8px 0 0; color: #856404; font-size: 12px;">
                        Tu solicitud fue enviada correctamente. El artista aun puede ver tus referencias.
                    </p>
                </div>
            `;
        }

        container.innerHTML = `
            <section class="step active" id="step-success">
                <div class="success-content">
                    <div class="success-icon"><i class="fa-solid fa-check"></i></div>
                    <h1>¡Solicitud Enviada!</h1>
                    ${warningHtml}
                    <p class="success-quote-id">Tu ID: <span class="highlight-text">${formData.quote_id}</span></p>
                    <p class="success-msg">
                        <span>${formData.artist_name}</span> ha recibido tu solicitud.
                    </p>
                    
                    <!-- Create Account Invitation -->
                    <div class="create-account-section">
                        <div class="account-benefits">
                            <h3><i class="fa-solid fa-user-plus"></i> Crea tu cuenta gratuita</h3>
                            <p class="benefits-intro">Accede a funciones exclusivas:</p>
                            <ul class="benefits-list">
                                <li><i class="fa-solid fa-eye"></i> Ver el estado de tu cotizacion en tiempo real</li>
                                <li><i class="fa-solid fa-comments"></i> Chatear directamente con el artista</li>
                                <li><i class="fa-solid fa-history"></i> Guardar historial de cotizaciones</li>
                                <li><i class="fa-solid fa-bell"></i> Recibir notificaciones de actualizaciones</li>
                            </ul>
                        </div>
                        <div class="account-actions">
                            <button class="btn btn-primary btn-create-account" onclick="goToClientRegistration()">
                                <i class="fa-solid fa-user-plus"></i> Crear Cuenta Gratis
                            </button>
                            <button class="btn btn-secondary btn-skip-account" onclick="showSuccessWithoutAccount()">
                                <i class="fa-solid fa-arrow-right"></i> Continuar sin cuenta
                            </button>
                        </div>
                    </div>
                </div>
            </section>
        `;
        // Hide progress bar on success
        document.querySelector('.app-header').style.display = 'none';

        // Clear draft from localStorage after successful submission
        clearDraftFromLocalStorage();

        hideLoading();
        console.log('✅ Quotation submitted:', formData);

    } catch (error) {
        hideLoading();
        console.error('Submit error:', error);
        alert('Hubo un error al enviar la solicitud. Por favor intenta de nuevo.');
    }
}

// Utilities
function showLoading() { document.getElementById('loading-overlay')?.classList.remove('hidden'); }
function hideLoading() { document.getElementById('loading-overlay')?.classList.add('hidden'); }

// ============================================
// Client Registration Functions
// ============================================

/**
 * Save client data from quotation for pre-filling registration form
 */
function saveClientDataForRegistration() {
    const clientData = {
        client_full_name: formData.client_full_name,
        client_email: formData.client_email,
        client_whatsapp: formData.client_whatsapp,
        client_birth_date: formData.client_birth_date,
        client_age: formData.client_age,
        client_instagram: formData.client_instagram,
        client_city_residence: formData.client_city_residence,
        client_health_conditions: formData.client_health_conditions,
        client_allergies: formData.client_allergies,
        quote_id: formData.quote_id
    };
    
    localStorage.setItem('weotzi_client_registration_data', JSON.stringify(clientData));
}

/**
 * Redirect to client registration page
 */
function goToClientRegistration() {
    window.location.href = '/client/register';
}

/**
 * Show traditional success page without account invitation
 */
async function showSuccessWithoutAccount() {
    // Fetch Next Steps content from app_settings
    let nextStepsContent = '<p><strong>1. Revisa tu correo</strong><br>El artista recibira tu solicitud y te contactara pronto.</p><p><strong>2. Prepara tus referencias</strong><br>Si tienes mas imagenes de inspiracion, tenlas listas para compartir.</p><p><strong>3. Agenda tu cita</strong><br>Una vez confirmes los detalles con el artista, agenda tu sesion.</p>';
    let websiteUrl = 'https://beta.weotzi.com';
    
    if (window.ConfigManager && typeof window.ConfigManager.getAppSettingFromDB === 'function') {
        try {
            const [nextSteps, webUrl] = await Promise.all([
                window.ConfigManager.getAppSettingFromDB('success_next_steps'),
                window.ConfigManager.getAppSettingFromDB('website_url')
            ]);
            if (nextSteps) nextStepsContent = nextSteps;
            if (webUrl) websiteUrl = webUrl;
        } catch (e) {
            console.warn('Could not fetch app settings:', e);
        }
    }
    
    const container = document.getElementById('form-steps-container');
    container.innerHTML = `
        <section class="step active" id="step-success">
            <div class="success-content">
                <div class="success-icon"><i class="fa-solid fa-check"></i></div>
                <h1>¡Solicitud Enviada!</h1>
                <p class="success-quote-id">Tu ID: <span class="highlight-text">${formData.quote_id}</span></p>
                <p class="success-msg">
                    <span>${formData.artist_name}</span> ha recibido tu solicitud.
                </p>
                
                <!-- Next Steps Section -->
                <div class="next-steps-section">
                    <h3><i class="fa-solid fa-list-check"></i> Proximos Pasos</h3>
                    <div class="next-steps-content">
                        ${nextStepsContent}
                    </div>
                </div>
                
                <!-- Reminder to create account -->
                <div class="account-reminder">
                    <p><i class="fa-solid fa-info-circle"></i> 
                        Recuerda: puedes <a href="/client/register" onclick="goToClientRegistration(); return false;">crear una cuenta</a> 
                        en cualquier momento para ver el estado de tu cotizacion y chatear con el artista.
                    </p>
                </div>
                
                <!-- Action Buttons -->
                <div class="success-actions">
                    <button class="btn btn-primary" onclick="resetQuotation()">
                        <i class="fa-solid fa-rotate-left"></i> Volver a Cotizar
                    </button>
                    <a href="${websiteUrl}" target="_blank" class="btn btn-secondary">
                        <i class="fa-solid fa-globe"></i> Conocer We Otzi
                    </a>
                </div>
                
                <div class="social-links">
                    <a href="https://instagram.com/weotzi" target="_blank" class="social-btn">
                        <i class="fa-brands fa-instagram"></i> Seguir a We Otzi
                    </a>
                </div>
            </div>
        </section>
    `;
}

// Expose functions globally
window.goToClientRegistration = goToClientRegistration;
window.showSuccessWithoutAccount = showSuccessWithoutAccount;
window.saveClientDataForRegistration = saveClientDataForRegistration;

/**
 * Reset the quotation form to start a new quotation
 * Clears all form data and returns to the first step
 */
function resetQuotation() {
    // Clear draft from localStorage
    clearDraftFromLocalStorage();
    
    // Reset form data
    formData = {
        reference_images_count: 0,
        quote_status: 'in_progress',
        quote_id: null
    };
    
    // Reset state variables
    selectedBodyParts = [];
    uploadedFiles = [];
    historyStack = [];
    summaryReached = false;
    currentStepIndex = 0;
    currentBodyZone = null;
    currentBodySide = null;
    
    // Show the header/progress bar again
    const appHeader = document.querySelector('.app-header');
    if (appHeader) {
        appHeader.style.display = '';
    }
    
    // Re-render the first step
    renderCurrentStep();
    updateBackButton();
    
    console.log('✅ Quotation form reset');
}

function setupKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            // Special handling for search step is now in renderCurrentStep input listener
            const currentQ = questionsConfig[currentStepIndex];
            if (currentQ && currentQ.step === 'artist-search') return;

            const btn = document.querySelector('.step.active .btn-primary');
            if (btn && !btn.disabled) btn.click();
        }
    });
}
function setupDatePicker(isSingle = false) {
    if (window.flatpickr) {
        if (isSingle) {
            flatpickr('#date-picker-single', {
                mode: 'single', dateFormat: 'd M Y', maxDate: 'today', locale: 'es'
            });
        } else {
            flatpickr('#date-picker', {
                mode: 'range', dateFormat: 'd M Y', minDate: 'today', locale: 'es'
            });
        }
    }
}

function handleSingleDateSelection(field) {
    const val = document.getElementById('date-picker-single').value;
    if (!val) return;
    formData[field] = val;
    nextStep();
}
function setupCurrencyInput(q) {
    // Optional: setup logic if needed
}

// Export global functions for onclick
window.searchArtist = searchArtist;
window.confirmArtist = confirmArtist;
window.continueWithoutArtist = continueWithoutArtist;
window.selectRecommendedArtist = selectRecommendedArtist;
window.nextStep = nextStep;
window.skipStep = skipStep;
window.prevStep = prevStep;
window.validateAndNext = validateAndNext;
window.handleOptionSelect = handleOptionSelect;
window.handleMultiSelect = handleMultiSelect;
window.handleBoolean = handleBoolean;
window.handleDateSelection = handleDateSelection;
window.handleSingleDateSelection = handleSingleDateSelection;
window.handleCurrency = handleCurrency;
window.handleCitySelection = handleCitySelection;
window.setTravel = setTravel;
window.confirmBodyParts = confirmBodyParts;
window.removeBodyPart = removeBodyPart;
window.skipReferences = skipReferences;
window.submitQuotation = submitQuotation;
window.resetQuotation = resetQuotation;
window.validateTextarea = validateTextarea;
window.toggleTheme = toggleTheme;

// Draft Recovery Functions
window.continueDraft = continueDraft;
window.startNewQuotation = startNewQuotation;

// Body Selector Imports
window.showMainBodyParts = showMainBodyParts;
window.handleZoneClick = handleZoneClick;
window.handleSideChosen = handleSideChosen;
window.showSubBodyParts = showSubBodyParts;
window.toggleSubPart = toggleSubPart;
window.toggleWholeZone = toggleWholeZone;
