// ============================================
// WE ÖTZI - DYNAMIC QUOTATION APP SCRIPT
// ============================================

const _dbg = (...args) => { if (window.__WEOTZI_DEBUG) console.log(...args); };

// ============ SHARED OPTIONS ============
// Reused across /quotation and /pre-cotizador via /shared/js/quotation-shared.js.
// Inline fallbacks ensure backward compatibility if the shared script is missing.
const QUOTATION_SHARED = (typeof window !== 'undefined' && window.WeotziQuotationShared) || {};
const SHARED_TATTOO_SIZE_OPTIONS = QUOTATION_SHARED.TATTOO_SIZE_OPTIONS || [
    { label: 'Pequeño', value: 'pequeño', icon: '📏', subtitle: '< 5cm' },
    { label: 'Mediano', value: 'mediano', icon: '📐', subtitle: '5-15cm' },
    { label: 'Grande', value: 'grande', icon: '🖼️', subtitle: '15-30cm' },
    { label: 'Muy Grande', value: 'muy_grande', icon: '🎨', subtitle: '> 30cm' },
    { label: 'Media Manga', value: 'media_manga', icon: '💪', subtitle: '' },
    { label: 'Manga Completa', value: 'manga_completa', icon: '🦾', subtitle: '' },
    { label: 'Espalda Completa', value: 'espalda_completa', icon: '🔙', subtitle: '' },
    { label: 'Pecho Completo', value: 'pecho_completo', icon: '👔', subtitle: '' }
];
const SHARED_TATTOO_STYLE_OPTIONS = QUOTATION_SHARED.TATTOO_STYLE_OPTIONS || [
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
    { label: 'Surrealista', value: 'surrealista' },
    { label: 'Black & Grey', value: 'black_grey' },
    { label: 'Microrealismo', value: 'microrealismo' },
    { label: 'Hiperrealismo', value: 'hiperrealismo' },
    { label: 'Ornamental', value: 'ornamental' },
    { label: 'Mandala', value: 'mandala' },
    { label: 'Tribal', value: 'tribal' },
    { label: 'Polinesio', value: 'polinesio' },
    { label: 'Maori', value: 'maori' },
    { label: 'Haida', value: 'haida' },
    { label: 'Celta', value: 'celta' },
    { label: 'Nordico / Viking', value: 'nordico_viking' },
    { label: 'Lettering', value: 'lettering' },
    { label: 'Blackletter / Gotico', value: 'blackletter_gotico' },
    { label: 'Caligrafia', value: 'caligrafia' },
    { label: 'Ignorant', value: 'ignorant' },
    { label: 'Handpoke / Stick and Poke', value: 'handpoke_stick_and_poke' },
    { label: 'Abstracto', value: 'abstracto' },
    { label: 'Sketch / Boceto', value: 'sketch_boceto' },
    { label: 'Etching / Grabado', value: 'etching_grabado' },
    { label: 'Woodcut / Xilografia', value: 'woodcut_xilografia' },
    { label: 'Linework', value: 'linework' },
    { label: 'Ilustracion botanica', value: 'ilustracion_botanica' },
    { label: 'Floral', value: 'floral' },
    { label: 'Fineline botanico', value: 'fineline_botanico' },
    { label: 'Biomecanico', value: 'biomecanico' },
    { label: 'Bioorganico', value: 'bioorganico' },
    { label: 'Horror', value: 'horror' },
    { label: 'Dark Art', value: 'dark_art' },
    { label: 'Glitch', value: 'glitch' },
    { label: 'Pixel Art', value: 'pixel_art' },
    { label: 'Graffiti', value: 'graffiti' },
    { label: 'Pop Art', value: 'pop_art' },
    { label: 'Art Nouveau', value: 'art_nouveau' },
    { label: 'Art Deco', value: 'art_deco' },
    { label: 'Barroco', value: 'barroco' },
    { label: 'Abstract Brush', value: 'abstract_brush' },
    { label: 'Patchwork', value: 'patchwork' },
    { label: 'Religious / Sacro', value: 'religious_sacro' },
    { label: 'Ornamental Blackwork', value: 'ornamental_blackwork' },
    { label: 'Pointillism', value: 'pointillism' }
];

// ============ CONFIGURATION ============
// DEFAULT_QUESTIONS_CONFIG - espejo de `quotation_flow_config` (Supabase).
// Solo se usa como fallback si la tabla no está disponible. La agrupación en
// pantallas (Figma) vive en QUOTATION_SCREENS: esta lista sigue siendo la
// fuente de los campos, tipos, opciones y validaciones de cada pregunta.
const DEFAULT_QUESTIONS_CONFIG = [
    { id: 1, step: 'welcome', type: 'welcome', title: 'Pantalla de Bienvenida', editable: false },
    { id: 2, step: 'artist-search', type: 'artist-search', title: '¿Con qué artista te querés tatuar?', field: 'artist_username', editable: false },
    { id: 3, step: 'artist-confirm', type: 'artist-confirm', title: 'Confirmá tu artista', editable: false },
    { id: 4, step: 'body-part', type: 'body-selector', title: '¿Dónde querés llevarlo?', field: 'tattoo_body_part', editable: false },
    { id: 5, step: 'description', type: 'textarea', title: '¿Qué querés tatuarte?', field: 'tattoo_idea_description', placeholder: 'Contanos tu idea con el mayor detalle posible…', minLength: 10, maxLength: 1000 },
    {
        id: 6, step: 'size', type: 'cards', title: '¿Qué tamaño imaginás?', field: 'tattoo_size',
        options: SHARED_TATTOO_SIZE_OPTIONS
    },
    {
        id: 7, step: 'style', type: 'tattoo-styles', title: '¿Qué estilo estás buscando?', field: 'tattoo_style',
        options: SHARED_TATTOO_STYLE_OPTIONS
    },
    {
        id: 8, step: 'color', type: 'options', title: 'Color', field: 'tattoo_color_type',
        options: ['Full Color', 'Blanco y Negro', 'Escala de Grises', 'Solo Líneas', 'Toques de Color']
    },
    { id: 9, step: 'references', type: 'file-upload', title: 'Mostranos lo que te inspira', field: 'tattoo_references', optional: true, editable: false },
    { id: 10, step: 'first-tattoo', type: 'boolean', title: '¿Es tu primer tatuaje?', field: 'tattoo_is_first_tattoo' },
    { id: 11, step: 'cover-up', type: 'boolean', title: '¿Es un cover-up?', field: 'tattoo_is_cover_up' },
    { id: 12, step: 'name', type: 'text', title: '¿Cómo te llamás?', field: 'client_full_name', placeholder: 'Tu nombre completo', minLength: 2 },
    { id: 13, step: 'email', type: 'email', title: 'Tu correo electrónico', field: 'client_email', placeholder: 'ejemplo@email.com' },
    {
        id: 13.1, step: 'whatsapp', type: 'tel',
        title: 'Tu número de WhatsApp',
        subtitle: 'Para que el artista pueda escribirte directamente.',
        field: 'client_whatsapp', placeholder: '11 1234 5678'
    },
    { id: 13.2, step: 'birth-date', type: 'date', title: '¿Cuál es tu fecha de nacimiento?', field: 'client_birth_date' },
    { id: 14, step: 'instagram', type: 'text', title: 'Tu Instagram', field: 'client_instagram', prefix: '@', optional: true },
    { id: 14.1, step: 'medical-boolean', type: 'boolean', title: '¿Tenés alguna condición médica?', field: 'client_medical_boolean' },
    { id: 14.2, step: 'medical-details', type: 'textarea', title: 'Contanos tus condiciones médicas', field: 'client_medical_details', placeholder: 'Describí acá…', minLength: 5, hidden: true },
    { id: 14.3, step: 'allergies', type: 'textarea', title: '¿Tenés alguna alergia que debamos saber?', field: 'client_allergies', placeholder: 'Ej: alergia al látex, tintas rojas…', optional: true },
    { id: 15, step: 'city', type: 'text', title: '¿En qué ciudad vivís?', field: 'client_city_residence', placeholder: 'Ciudad, Provincia, País' },
    { id: 15.5, step: 'travel', type: 'boolean', title: '¿Viajarías para la sesión?', field: 'client_travel_willing', hidden: true },
    { id: 16, step: 'date', type: 'date-range', title: 'Fecha', field: 'client_preferred_date' },
    { id: 17, step: 'budget', type: 'currency', title: 'Presupuesto', field: 'client_budget_amount' },
    {
        id: 18, step: 'contact-pref', type: 'multi-select', title: '¿Cómo preferís que te contacten?', field: 'client_contact_preference',
        options: ['WhatsApp', 'Instagram', 'Email', 'Cualquiera']
    },
    { id: 18.1, step: 'rec-preference', type: 'boolean', title: '¿Querés que te recomendemos otros artistas?', field: 'artist_rec_preference', hidden: true },
    { id: 18.5, step: 'artist-recommendations', type: 'artist-recommendations', title: 'Recomendaciones para vos', editable: false },
    { id: 19, step: 'summary', type: 'summary', title: 'Tu tatuaje', editable: false }
];

// ============ PANTALLAS (capa de presentación · Figma) ============
// El Figma agrupa varias preguntas de `quotation_flow_config` por pantalla
// (8 pantallas numeradas 01…08). Esta tabla NO reemplaza la config: solo dice
// qué preguntas se muestran juntas, en qué orden y con qué titular.
// Referencias: flujo-clientes--15…21.
const QUOTATION_SCREENS = [
    // Pantalla sin numerar: solo aparece cuando se entra con ?artist=usuario.
    {
        id: 'artist', title: 'Confirmá tu artista', steps: ['artist-confirm'],
        skipIf: () => !formData.artist_data
    },
    { id: 'idea', num: '01', title: '¿Qué querés tatuarte?', steps: ['description'], initialReference: true },
    { id: 'style', num: '02', title: '¿Qué estilo estás buscando?', subtitle: 'Podés elegir uno o varios estilos.', steps: ['style'] },
    { id: 'body', num: '03', title: '¿Dónde querés llevarlo?', steps: ['body-part'] },
    { id: 'size', num: '04', title: '¿Qué tamaño imaginás?', steps: ['size'] },
    {
        id: 'references', num: '05', title: 'Mostranos lo que te inspira',
        subtitle: 'Sumá las imágenes que te inspiran · hasta 4.', steps: ['references']
    },
    { id: 'details', num: '06', title: 'Contanos los detalles', steps: ['color', 'date', 'budget'] },
    {
        id: 'client', num: '07', title: 'Contanos quién sos',
        steps: [
            'name', 'email', 'whatsapp', 'birth-date', 'instagram', 'city', 'travel',
            'contact-pref', 'first-tattoo', 'cover-up', 'medical-boolean', 'medical-details', 'allergies'
        ]
    },
    { id: 'summary', num: '08', title: 'Tu tatuaje', steps: ['summary'] }
];

// Pasos que nunca se renderizan como pantalla propia (no existen en el Figma
// del flujo de cliente). `artist-confirm` sí se usa, pero solo vía deep link.
const NON_SCREEN_STEPS = ['welcome', 'artist-search', 'artist-confirm', 'rec-preference', 'artist-recommendations'];

// Etiquetas mono de cada bloque dentro de una pantalla (Figma).
const FIELD_LABELS = {
    'description': 'Descripción de la idea',
    'color': 'Color',
    'date': 'Fecha',
    'budget': '¿Cuánto querés invertir? Es un aproximado: el valor final lo definen después.',
    'name': 'Nombre y apellido',
    'email': 'Email',
    'whatsapp': 'WhatsApp',
    'birth-date': 'Fecha de nacimiento',
    'instagram': 'Instagram',
    'city': 'Ciudad',
    'travel': '¿Viajarías para la sesión?',
    'contact-pref': '¿Cómo preferís que te contacten?',
    'first-tattoo': '¿Es tu primer tatuaje?',
    'cover-up': '¿Es un cover-up?',
    'medical-boolean': '¿Tenés alguna condición médica?',
    'medical-details': 'Contanos cuáles',
    'allergies': 'Alergias (opcional)'
};

// Placeholders en voseo para los campos cuya copy define el Figma. La tabla
// `quotation_flow_config` todavía guarda algunos textos en tuteo; hasta que se
// actualicen en la DB, la pantalla usa estos.
const FIELD_PLACEHOLDERS = {
    'description': 'Contanos tu idea con el mayor detalle posible…',
    'medical-details': 'Contanos qué tenemos que tener en cuenta…',
    'allergies': 'Ej: alergia al látex, tintas rojas…',
    'name': 'Tu nombre completo',
    'city': 'Ciudad, provincia, país'
};

// Opciones que el Figma fija y hoy difieren de `quotation_flow_config`.
// Se aplican como override de presentación; el valor guardado sigue siendo texto.
const FIGMA_COLOR_OPTIONS = ['Black & Grey', 'Color', 'No estoy seguro'];

const FIGMA_SIZE_OPTIONS = [
    { label: 'Pequeño', value: 'pequeño', subtitle: '5–8 cm' },
    { label: 'Mediano', value: 'mediano', subtitle: '8–15 cm' },
    { label: 'Grande', value: 'grande', subtitle: '15–25 cm' },
    { label: 'XL', value: 'muy_grande', subtitle: '25+ cm' }
];

// Chips de fecha del Figma. `flexible` marca client_flexible_dates.
const FIGMA_DATE_CHIPS = [
    { label: 'Lo antes posible', flexible: false },
    { label: 'Este mes', flexible: false },
    { label: 'Próximo mes', flexible: false },
    { label: 'Sin fecha', flexible: true }
];

// Tramos de presupuesto del Figma. `amount` es el valor numérico que se guarda
// en client_budget_amount (punto medio del tramo) para que las vistas de
// artista/backoffice sigan ordenando y precargando por número.
// `{s}` se reemplaza por el símbolo de la moneda activa (WeOtziCurrency).
const FIGMA_BUDGET_TIERS = [
    { label: '< {s}100', amount: 50, bar: 20 },
    { label: '{s}100–200', amount: 150, bar: 34 },
    { label: '{s}200–400', amount: 300, bar: 48 },
    { label: '{s}400–600', amount: 500, bar: 62 },
    { label: '{s}600+', amount: 600, bar: 76 },
    { label: 'No estoy seguro', amount: null, bar: 20 }
];

const MONTHS_SHORT_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MONTHS_LONG_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Tipos de pregunta que se renderizan con un <template> de la página.
const TEMPLATE_TYPES = ['artist-confirm', 'body-selector', 'tattoo-styles', 'file-upload', 'summary'];

// ============ STATE ============
let questionsConfig = [];
// Pantallas resueltas (agrupación Figma sobre questionsConfig).
let screensConfig = [];
// Índice de PANTALLA actual (se conserva el nombre por compatibilidad de draft).
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

// Authenticated client state (populated when user logs in via modal or has active session)
let _authenticatedUserId = null;

// ============ DRAFT PERSISTENCE (LocalStorage) ============
const DRAFT_STORAGE_KEY = 'weotzi_quotation_draft';
const PREQUOTE_HANDOFF_KEY = 'weotzi_prequote_handoff';

/**
 * Load and consume the optional pre-quote handoff stored by /pre-cotizador.
 * Expired or malformed handoffs are silently dropped so they cannot taint
 * regular quotation visits.
 */
function loadPrequoteHandoff() {
    try {
        const raw = localStorage.getItem(PREQUOTE_HANDOFF_KEY);
        if (!raw) return null;
        const handoff = JSON.parse(raw);
        if (!handoff || !handoff.formData || !handoff.expiresAt || handoff.expiresAt < Date.now()) {
            localStorage.removeItem(PREQUOTE_HANDOFF_KEY);
            return null;
        }
        return handoff;
    } catch (e) {
        try { localStorage.removeItem(PREQUOTE_HANDOFF_KEY); } catch (_) {}
        return null;
    }
}

/**
 * Apply the pre-quote handoff to formData. Only runs when explicitly
 * requested (URL param `source=prequote` or a fresh handoff exists). Existing
 * draft/quotation flows are not touched if no handoff is present.
 */
function applyPrequoteHandoff() {
    const handoff = loadPrequoteHandoff();
    if (!handoff || !handoff.formData) return false;
    formData = { ...formData, ...handoff.formData };
    formData.quote_id = formData.quote_id || generateQuoteId();
    formData.quote_status = 'in_progress';
    formData.quotation_source = 'prequote';
    try { localStorage.removeItem(PREQUOTE_HANDOFF_KEY); } catch (_) {}
    saveDraftToLocalStorage();
    _dbg('Applied prequote handoff:', formData.quote_id);
    return true;
}

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
        _dbg('Draft saved to localStorage');
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
        _dbg('Draft cleared from localStorage');
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
 * Populate the steps lists in the recovery modal.
 * Se listan las PANTALLAS del flujo (agrupación Figma), no las preguntas sueltas.
 * @param {Object} draft - The saved draft data
 */
function populateStepsLists(draft) {
    const completedList = document.getElementById('completed-steps-list');
    const pendingList = document.getElementById('pending-steps-list');

    if (!completedList || !pendingList) return;

    completedList.innerHTML = '';
    pendingList.innerHTML = '';

    screensConfig.forEach((screen) => {
        if (screen.id === 'summary' || screen.id === 'artist') return;

        const done = screen.questions.every((q) => {
            if (!q.field || q.optional || q.hidden) return true;
            return isDraftStepCompleted(q, draft.formData || {});
        });

        const li = document.createElement('li');
        li.textContent = screen.title;
        (done ? completedList : pendingList).appendChild(li);
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
        formData = draft.formData || { reference_images_count: 0, quote_status: 'in_progress', quote_id: null };
        selectedBodyParts = draft.selectedBodyParts || [];
        summaryReached = draft.summaryReached || false;

        // El índice guardado puede venir del wizard anterior (una pregunta por
        // paso): se recalcula sobre las pantallas actuales a partir de los datos.
        buildScreensConfig();
        currentStepIndex = findFirstIncompleteScreenIndex();
        historyStack = [];
        for (let i = 0; i < currentStepIndex; i++) {
            if (!isScreenSkipped(screensConfig[i])) historyStack.push(i);
        }

        _dbg('Draft restored:', formData.quote_id, '→ pantalla', currentStepIndex);
    }

    // Hide modal
    const modal = document.getElementById('draft-recovery-modal');
    if (modal) {
        modal.classList.add('hidden');
    }

    renderCurrentStep();
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

// ============ THEME LOGIC (DS Bauhaus: solo tema claro) ============
// El design system no tiene modo oscuro. Se limpia cualquier tema oscuro
// persistido de la versión anterior y toggleTheme queda como stub inofensivo.
function initTheme() {
    document.documentElement.removeAttribute('data-theme');
    try { localStorage.removeItem('weotzi_theme'); } catch (_) {}
}

function toggleTheme() { /* stub: el toggle de tema fue removido del DS */ }

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
            _dbg('Body parts loaded from Supabase:', BODY_PARTS_DATA.length, 'zones');
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
                _dbg('Questions loaded from Supabase:', questionsConfig.length);
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
        _dbg('Using questions from localStorage fallback');
    } else {
        questionsConfig = DEFAULT_QUESTIONS_CONFIG;
        localStorage.setItem('weotzi_questions_config', JSON.stringify(questionsConfig));
        _dbg('Using DEFAULT_QUESTIONS_CONFIG fallback');
    }
}

function initApp() {
    // Detect existing client session for header state
    _detectClientSession();

    // Agrupación Figma sobre la config cargada (Supabase o fallback).
    buildScreensConfig();

    // Pre-cotizador handoff: only applies when source=prequote is in URL or
    // a non-expired handoff is present. We check the URL flag first to avoid
    // affecting regular /quotation visits.
    const initialUrlParams = new URLSearchParams(window.location.search);
    const prequoteSource = initialUrlParams.get('source') === 'prequote';
    let hasPrequoteHandoff = false;
    if (prequoteSource) {
        hasPrequoteHandoff = applyPrequoteHandoff();
    }

    // Check for saved draft FIRST (before URL params)
    const draft = loadDraftFromLocalStorage();

    // If there's a valid draft with quote_id and in_progress status, show recovery modal
    if (!hasPrequoteHandoff && draft && draft.formData?.quote_id && draft.formData?.quote_status === 'in_progress') {
        // Check if URL has artist param - if so, let URL param take precedence for new quote
        const urlParams = new URLSearchParams(window.location.search);
        const artistUsername = urlParams.get('artist');
        
        if (!artistUsername) {
            // No URL artist, show recovery modal
            showDraftRecoveryModal(draft);
            setupKeyboardNavigation();
            _dbg('Found draft quotation:', draft.formData.quote_id);
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
        currentStepIndex = findNextScreenIndex(0);
        if (currentStepIndex === -1) currentStepIndex = 0;
        renderCurrentStep();
    }

    // Global Listeners
    setupKeyboardNavigation();

    _dbg('Cotizador iniciado ·', screensConfig.length, 'pantallas /', questionsConfig.length, 'preguntas');
}

async function handleUrlArtist(username) {
    showLoading();
    try {
        const supabaseClient = window.ConfigManager && window.ConfigManager.getSupabaseClient();
        let artist = null;
        const usernameLower = username.toLowerCase();

        if (supabaseClient && !window.ConfigManager.isDemoMode()) {
            // Case-insensitive lookup using ilike. Public path — exclude
            // password via the shared column list (config-manager.js).
            const { data, error } = await WeotziData.Artists.getPublicByUsername(usernameLower, window.ARTIST_PUBLIC_COLUMNS || '*');
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
            formData.artist_current_city = normalizeQuotationLocation(artist.ubicacion || '');
            formData.artist_studio_name = artist.estudios;
            formData.artist_session_cost_amount = artist.session_price;
            formData.artist_portfolio = artist.portafolio || formatInstagramUrl(artist.instagram);
            formData.no_artist = false;
            formData.quote_id = generateQuoteId();

            // Con artista en la URL se muestra la confirmación como pantalla
            // previa (no numerada): el Figma no tiene búsqueda de artista.
            buildScreensConfig();
            const artistIdx = getScreenIndexById('artist');
            currentStepIndex = artistIdx !== -1 ? artistIdx : findNextScreenIndex(0);
            historyStack = [];
        } else {
            // Sin artista válido el flujo arranca igual en la pantalla 01.
            console.warn('Artist not found for username:', username);
            currentStepIndex = findNextScreenIndex(0);
            historyStack = [];
        }
    } catch (err) {
        console.error('Error handling URL artist:', err);
        currentStepIndex = findNextScreenIndex(0);
        historyStack = [];
    } finally {
        if (currentStepIndex === -1) currentStepIndex = 0;
        hideLoading();
        renderCurrentStep();
        updateBackButton();
    }
}

// ============ DYNAMIC RENDERING ============
// El Figma agrupa varias preguntas por pantalla (01…08). Acá se arma la lista
// de pantallas sobre `questionsConfig` (Supabase → quotation_flow_config) sin
// tocar el contrato de datos: cada pregunta conserva su campo, tipo, opciones
// y validación; lo único que cambia es cuántas se muestran juntas.

function buildScreensConfig() {
    const byStep = {};
    (questionsConfig || []).forEach((q) => { if (q && q.step) byStep[q.step] = q; });

    const used = new Set(NON_SCREEN_STEPS);
    const screens = [];

    QUOTATION_SCREENS.forEach((blueprint) => {
        const questions = blueprint.steps
            .map((stepName) => { used.add(stepName); return byStep[stepName]; })
            .filter(Boolean);
        if (!questions.length && !blueprint.initialReference) return;
        screens.push(Object.assign({}, blueprint, { questions }));
    });

    // Preguntas de la config que el mapa del Figma no cubre (por ejemplo, una
    // nueva agregada desde el backoffice): se muestran antes del resumen, una
    // por pantalla, para no perder ningún dato del flujo.
    (questionsConfig || []).forEach((q) => {
        if (!q || !q.step || used.has(q.step) || q.hidden) return;
        used.add(q.step);
        const extra = { id: 'extra-' + q.step, title: q.title || '', steps: [q.step], questions: [q] };
        const summaryIdx = screens.findIndex((s) => s.id === 'summary');
        if (summaryIdx === -1) screens.push(extra);
        else screens.splice(summaryIdx, 0, extra);
    });

    screensConfig = screens;
    _dbg('Pantallas armadas:', screens.map((s) => s.id).join(' · '));
    return screens;
}

function getScreen(index) { return screensConfig[index] || null; }
function getCurrentScreen() { return getScreen(currentStepIndex); }

function getScreenIndexById(id) { return screensConfig.findIndex((s) => s.id === id); }

function isScreenSkipped(screen) {
    if (!screen) return true;
    if (typeof screen.skipIf === 'function' && screen.skipIf()) return true;
    if (screen.initialReference) return false;
    return !screen.questions.some((q) => isQuestionVisible(q));
}

// Visibilidad condicional dentro de una pantalla. Reemplaza los saltos de paso
// (`logic`) del wizard viejo: ahora las preguntas conviven en una pantalla y se
// muestran u ocultan según lo ya respondido.
function isQuestionVisible(q) {
    if (!q) return false;
    if (q.step === 'medical-details') return formData.client_medical_boolean === true;
    if (q.step === 'travel') return !!formData._travel_required;
    return !q.hidden;
}

function renderCurrentStep() {
    const container = document.getElementById('form-steps-container');
    if (!container) return;
    container.innerHTML = '';

    const screen = getCurrentScreen();
    if (!screen) return;

    const stepEl = document.createElement('section');
    stepEl.id = `screen-${screen.id}`;
    stepEl.className = 'step active q-screen';
    stepEl.dataset.screenId = screen.id;
    stepEl.dataset.stepIndex = currentStepIndex;

    stepEl.innerHTML = [
        '<header class="q-screen-head">',
        screen.num ? `<span class="q-screen-num">${screen.num}</span>` : '',
        `<h1 class="q-screen-title">${escapeQuotationHtml(screen.title || '')}</h1>`,
        '</header>',
        screen.subtitle ? `<p class="q-screen-sub">${escapeQuotationHtml(screen.subtitle)}</p>` : ''
    ].join('');

    const blocks = document.createElement('div');
    blocks.className = 'q-blocks';

    screen.questions.forEach((q) => {
        const block = buildQuestionBlock(q, screen);
        if (block) blocks.appendChild(block);
    });

    // Figma 01: la referencia inicial vive dentro de la pantalla de la idea y
    // usa el mismo pipeline de subida que la pantalla 05.
    if (screen.initialReference) {
        const refBlock = document.createElement('div');
        refBlock.className = 'q-block';
        refBlock.innerHTML =
            '<p class="q-block-label">Referencia inicial (opcional)</p>' +
            renderDropzoneHtml();
        blocks.appendChild(refBlock);
    }

    stepEl.appendChild(blocks);
    container.appendChild(stepEl);

    screen.questions.forEach((q) => setTimeout(() => initQuestionLogic(q, screen), 0));
    if (screen.initialReference) setTimeout(() => { setupFileUpload(); renderPreviews(); }, 0);

    updateFootbar(screen);
}

// Bloque de una pregunta: etiqueta mono + control (o template completo).
function buildQuestionBlock(q, screen) {
    const wrapper = document.createElement('div');
    wrapper.className = 'q-block';
    wrapper.dataset.step = q.step;
    wrapper.id = `block-${q.step}`;
    if (!isQuestionVisible(q)) wrapper.classList.add('hidden');

    if (TEMPLATE_TYPES.includes(q.type)) {
        const tpl = document.getElementById(`tmpl-${q.type}`);
        if (!tpl) {
            wrapper.innerHTML = `<p class="error-msg">No se encontró el template ${q.type}</p>`;
            return wrapper;
        }
        wrapper.classList.add('q-block--full');
        wrapper.appendChild(tpl.content.cloneNode(true));
        return wrapper;
    }

    const labelText = FIELD_LABELS[q.step] || q.title || '';
    // En pantallas de una sola pregunta el titular ya dice todo: la etiqueta
    // solo se muestra cuando el Figma la tiene.
    const showLabel = !!FIELD_LABELS[q.step] || screen.questions.length > 1;

    wrapper.innerHTML =
        (showLabel && labelText ? `<p class="q-block-label">${escapeQuotationHtml(labelText)}</p>` : '') +
        (q.subtitle ? `<p class="q-block-help">${escapeQuotationHtml(q.subtitle)}</p>` : '') +
        renderQuestionControl(q);

    return wrapper;
}

function escapeQuotationHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Barra inferior fija (Figma: ATRÁS a la izquierda · CONTINUAR a la derecha).
function updateFootbar(screen) {
    const bar = document.getElementById('q-footbar');
    const continueBtn = document.getElementById('continue-btn');
    if (!bar || !continueBtn) return;

    const isSummary = screen && screen.id === 'summary';
    // El resumen tiene su propio bloque de CTA (SOLICITAR COTIZACIÓN + EDITAR).
    bar.classList.toggle('hidden', !!isSummary);
    continueBtn.classList.toggle('hidden', !!isSummary);
    updateBackButton();
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

function sanitizeQuotationLocationSegment(segment) {
    if (!segment || typeof segment !== 'string') return '';
    return segment
        .replace(/\b(?:[A-Z]{1,3}\d{3,6}[A-Z]{0,3}|\d{3,8}(?:-\d{3,4})?)\b/gi, '')
        .replace(/\s+/g, ' ')
        .replace(/^[,\s-]+|[,\s-]+$/g, '')
        .trim();
}

function normalizeQuotationLocation(rawLocation) {
    if (!rawLocation || typeof rawLocation !== 'string') return '';
    const parts = rawLocation
        .split(',')
        .map((segment) => sanitizeQuotationLocationSegment(segment))
        .filter(Boolean);

    const deduped = [];
    for (const part of parts) {
        if (!deduped.some((existing) => existing.toLowerCase() === part.toLowerCase())) {
            deduped.push(part);
        }
    }

    return deduped.slice(0, 3).join(', ');
}

function getQuotationAddressComponent(components, acceptedTypes) {
    if (!Array.isArray(components)) return '';
    for (const acceptedType of acceptedTypes) {
        const match = components.find((component) => component.types && component.types.includes(acceptedType));
        if (match && match.long_name) {
            return sanitizeQuotationLocationSegment(match.long_name);
        }
    }
    return '';
}

// Extract normalized city/province/country from Google address components
function extractCityFromComponents(components, fallbackAddress = '') {
    const cityName = getQuotationAddressComponent(components, [
        'locality',
        'postal_town',
        'administrative_area_level_3',
        'administrative_area_level_2',
        'sublocality_level_1',
        'sublocality'
    ]);
    const province = getQuotationAddressComponent(components, [
        'administrative_area_level_1',
        'administrative_area_level_2'
    ]);
    const countryName = getQuotationAddressComponent(components, ['country']);

    const structured = [cityName, province, countryName].filter(Boolean);
    const deduped = structured.filter((part, index, arr) => (
        arr.findIndex((candidate) => candidate.toLowerCase() === part.toLowerCase()) === index
    ));
    const normalizedLocation = deduped.length ? deduped.join(', ') : normalizeQuotationLocation(fallbackAddress);

    return { cityName, province, countryName, normalizedLocation };
}

// Google Maps Autocomplete for City (retries if Maps loads late)
function setupCityAutocomplete(question) {
    const inputId = `field-${question.id}`;
    const input = document.getElementById(inputId);
    if (!input) return;

    function attach() {
        if (!window.google || !window.google.maps || !window.google.maps.places) return false;

        if (input._autocompleteAttached) return true;
        input._autocompleteAttached = true;

        const autocomplete = new google.maps.places.Autocomplete(input, {
            types: ['(cities)'],
            fields: ['formatted_address', 'address_components', 'geometry']
        });

        autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            if (!place) return;

            const parsed = extractCityFromComponents(place.address_components, place.formatted_address);
            const normalizedLocation = parsed.normalizedLocation || normalizeQuotationLocation(place.formatted_address || '');
            if (!normalizedLocation) return;

            input.value = normalizedLocation;
            formData.client_city_residence = normalizedLocation;
            formData.client_city_name = parsed.cityName || normalizedLocation.split(',')[0]?.trim() || '';

            const locationParts = normalizedLocation.split(',').map((part) => part.trim()).filter(Boolean);
            formData.client_country = parsed.countryName || locationParts[locationParts.length - 1] || '';
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') e.preventDefault();
        });

        return true;
    }

    if (attach()) return;

    // Maps not ready yet (loaded dynamically) -- poll until available
    let retries = 0;
    const timer = setInterval(() => {
        retries++;
        if (attach() || retries >= 40) clearInterval(timer);
    }, 250);
}

// GPS Location for City
function useGpsLocation(questionId) {
    const input = document.getElementById(`field-${questionId}`);
    const btn = document.querySelector('.btn-gps');

    if (!input) return;

    function resetBtn() {
        if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
    }

    if (window.isSecureContext === false) {
        showToastMessage('La geolocalización requiere una conexión segura (HTTPS)');
        return;
    }

    if (!navigator.geolocation) {
        showToastMessage('Tu navegador no soporta geolocalización');
        return;
    }

    if (!window.google || !window.google.maps || !window.google.maps.Geocoder) {
        showToastMessage('El mapa aún está cargando. Intentá de nuevo en unos segundos.');
        return;
    }

    if (btn) { btn.classList.add('loading'); btn.disabled = true; }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;

            try {
                const geocoder = new google.maps.Geocoder();
                geocoder.geocode({ location: { lat: latitude, lng: longitude } }, (results, status) => {
                    resetBtn();

                    if (status !== 'OK' || !results || !results.length) {
                        showToastMessage('Error al obtener la ubicación');
                        return;
                    }

                    let cityName = '';
                    let countryName = '';
                    let formattedAddress = '';

                    for (const result of results) {
                        const parsed = extractCityFromComponents(result.address_components, result.formatted_address);
                        if (parsed.normalizedLocation) {
                            cityName = parsed.cityName;
                            countryName = parsed.countryName;
                            formattedAddress = parsed.normalizedLocation;
                            break;
                        }
                    }

                    if (formattedAddress) {
                        input.value = formattedAddress;
                        formData.client_city_residence = formattedAddress;
                        formData.client_city_name = cityName || formattedAddress.split(',')[0]?.trim() || '';
                        formData.client_country = countryName || formattedAddress.split(',').pop()?.trim() || '';
                        showToastMessage('Ubicación detectada correctamente');
                    } else {
                        showToastMessage('No se pudo determinar tu ciudad. Ingresala manualmente.');
                    }
                });
            } catch (err) {
                resetBtn();
                console.error('Geocoding error:', err);
                showToastMessage('Error al procesar tu ubicación');
            }
        },
        (error) => {
            resetBtn();
            switch (error.code) {
                case error.PERMISSION_DENIED:
                    showToastMessage('Permiso de ubicación denegado. Ingresá tu ciudad manualmente.');
                    break;
                case error.POSITION_UNAVAILABLE:
                    showToastMessage('Ubicación no disponible. Ingresá tu ciudad manualmente.');
                    break;
                case error.TIMEOUT:
                    showToastMessage('Tiempo de espera agotado. Ingresá tu ciudad manualmente.');
                    break;
                default:
                    showToastMessage('Error al obtener tu ubicación');
            }
        },
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }
    );
}

// Make useGpsLocation available globally
window.useGpsLocation = useGpsLocation;

// ============ CONTROLES POR PREGUNTA ============
// Cada control se dibuja sin titular ni botonera propia: el titular es el de la
// pantalla y la acción vive en la barra inferior fija (Figma).

function questionPlaceholder(q) {
    return FIELD_PLACEHOLDERS[q.step] || q.placeholder || '';
}

function renderQuestionControl(q) {
    switch (q.type) {
        case 'text':
        case 'email':
        case 'tel':
            return renderTextControl(q);

        case 'textarea':
            return `
                <div class="textarea-wrapper">
                    <textarea id="field-${q.id}" class="wo-textarea"
                        placeholder="${escapeQuotationHtml(questionPlaceholder(q))}"
                        rows="5" maxlength="${q.maxLength || 1000}"
                        aria-label="${escapeQuotationHtml(FIELD_LABELS[q.step] || q.title || '')}"
                    >${escapeQuotationHtml(formData[q.field] || '')}</textarea>
                    <div class="textarea-counter"><span id="char-count-${q.id}">0</span>/${q.maxLength || 1000}</div>
                </div>`;

        case 'options':
            return renderWideOptions(q, q.step === 'color' ? FIGMA_COLOR_OPTIONS : (q.options || []));

        case 'cards':
            return q.step === 'size' ? renderSizeCards(q) : renderWideOptions(q, q.options || []);

        case 'multi-select':
            return `
                <div class="checkbox-options">
                    ${(q.options || []).map((opt) => {
                        const label = typeof opt === 'object' ? opt.label : opt;
                        const selected = formData[q.field] && String(formData[q.field]).split(', ').includes(toTitleCase(label));
                        return `
                            <label class="wo-check checkbox-option">
                                <input type="checkbox" name="${q.field}" value="${escapeQuotationHtml(label)}" ${selected ? 'checked' : ''}>
                                <span>${escapeQuotationHtml(label)}</span>
                            </label>`;
                    }).join('')}
                </div>`;

        case 'boolean':
            return `
                <div class="q-wide-options q-wide-options--pair">
                    <button type="button" class="q-wide-option ${formData[q.field] === true ? 'is-selected' : ''}"
                        data-bool="true" onclick="handleBoolean('${q.field}', true)">Sí</button>
                    <button type="button" class="q-wide-option ${formData[q.field] === false ? 'is-selected' : ''}"
                        data-bool="false" onclick="handleBoolean('${q.field}', false)">No</button>
                </div>`;

        case 'date-range':
            return renderDateControl(q);

        case 'date':
            return `<input type="text" id="date-picker-single" class="wo-input" placeholder="Elegí la fecha" value="${escapeQuotationHtml(formData[q.field] || '')}" readonly>`;

        case 'currency':
            return renderBudgetControl(q);

        default:
            return '';
    }
}

function renderTextControl(q) {
    if (q.type === 'tel') {
        const codes = ['+54', '+52', '+1', '+34', '+57', '+56', '+51', '+58', '+598'];
        const labels = { '+54': 'AR', '+52': 'MX', '+1': 'US', '+34': 'ES', '+57': 'CO', '+56': 'CL', '+51': 'PE', '+58': 'VE', '+598': 'UY' };
        const saved = formData[q.field] || '';
        const savedCode = codes.find((c) => saved.startsWith(c + ' ')) || '+54';
        const savedNumber = saved ? saved.replace(savedCode + ' ', '') : '';
        return `
            <div class="tel-group">
                <select id="country-code-${q.id}" class="wo-select country-select" aria-label="Código de país">
                    ${codes.map((c) => `<option value="${c}" ${c === savedCode ? 'selected' : ''}>${labels[c]} ${c}</option>`).join('')}
                </select>
                <input type="tel" id="field-${q.id}" class="wo-input" placeholder="${escapeQuotationHtml(questionPlaceholder(q))}" value="${escapeQuotationHtml(savedNumber)}">
            </div>`;
    }

    if (q.step === 'instagram') {
        return `<input type="text" id="field-${q.id}" class="wo-input" placeholder="@usuario" value="${escapeQuotationHtml(formData[q.field] || '@')}" oninput="handleInstagramInput(this)">`;
    }

    if (q.step === 'city') {
        const normalized = normalizeQuotationLocation(formData[q.field] || '');
        if (normalized && normalized !== formData[q.field]) formData[q.field] = normalized;
        return `
            <div class="city-input-group">
                <input type="text" id="field-${q.id}" class="wo-input" placeholder="${escapeQuotationHtml(questionPlaceholder(q))}" value="${escapeQuotationHtml(normalized || '')}">
                <button type="button" class="wo-iconbtn btn-gps" onclick="useGpsLocation(${q.id})" title="Usar mi ubicación" aria-label="Usar mi ubicación">
                    <i data-wo-icon="crosshair" class="wo-icon-18"></i>
                </button>
            </div>`;
    }

    return `<input type="${q.type}" id="field-${q.id}" class="wo-input" placeholder="${escapeQuotationHtml(questionPlaceholder(q))}" value="${escapeQuotationHtml(formData[q.field] || '')}">`;
}

// Opciones anchas en fila (Figma 06 · COLOR).
function renderWideOptions(q, options) {
    return `
        <div class="q-wide-options">
            ${options.map((opt) => {
                const label = typeof opt === 'object' ? opt.label : opt;
                const value = typeof opt === 'object' ? opt.value : opt;
                const selected = formData[q.field] === toTitleCase(String(value));
                return `<button type="button" class="q-wide-option ${selected ? 'is-selected' : ''}"
                    data-value="${escapeQuotationHtml(value)}"
                    onclick="handleOptionSelect('${q.field}', '${escapeQuotationHtml(String(value)).replace(/'/g, "\\'")}')">${escapeQuotationHtml(label)}</button>`;
            }).join('')}
        </div>`;
}

// Figma 04: 4 tamaños con rango + enlace "No estoy seguro".
function renderSizeCards(q) {
    const unsure = formData[q.field] === 'No Estoy Seguro';
    return `
        <div class="q-size-grid">
            ${FIGMA_SIZE_OPTIONS.map((opt) => {
                const selected = formData[q.field] === toTitleCase(opt.value);
                return `<button type="button" class="q-size-card ${selected ? 'is-selected' : ''}"
                    data-value="${opt.value}" onclick="handleOptionSelect('${q.field}', '${opt.value}')">
                    <span class="q-size-name">${opt.label}</span>
                    <span class="q-size-range">${opt.subtitle}</span>
                </button>`;
            }).join('')}
        </div>
        <button type="button" class="q-inline-link ${unsure ? 'is-selected' : ''}" onclick="handleOptionSelect('${q.field}', 'No estoy seguro')">No estoy seguro</button>`;
}

// Figma 06 · FECHA: chips + calendario mensual embebido.
function renderDateControl(q) {
    const current = formData[q.field] || '';
    return `
        <div class="q-chips" id="date-chips">
            ${FIGMA_DATE_CHIPS.map((chip) => `
                <button type="button" class="q-chip ${current === chip.label ? 'is-active' : ''}"
                    data-date-chip="${escapeQuotationHtml(chip.label)}"
                    onclick="selectDateChip('${escapeQuotationHtml(chip.label).replace(/'/g, "\\'")}', ${chip.flexible})">${escapeQuotationHtml(chip.label)}</button>`).join('')}
        </div>
        <div class="q-calendar" id="date-calendar"></div>`;
}

// Figma 06 · PRESUPUESTO: 6 tramos dibujados como barras ascendentes.
function renderBudgetControl(q) {
    const symbol = getBudgetSymbol();
    return `
        <div class="q-budget">
            <div class="q-budget-bars">
                ${FIGMA_BUDGET_TIERS.map((tier, index) => {
                    const label = tier.label.replace('{s}', symbol);
                    const active = isBudgetTierActive(tier);
                    return `<button type="button" class="q-budget-tier ${active ? 'is-active' : ''}"
                        data-tier="${index}" onclick="selectBudgetTier(${index})" aria-pressed="${active}">
                        <span class="q-budget-bar" style="height:${tier.bar}px"></span>
                        <span class="q-budget-label">${escapeQuotationHtml(label)}</span>
                    </button>`;
                }).join('')}
            </div>
            <p class="q-block-help">El precio final puede variar según el artista, tamaño, complejidad y número de sesiones.</p>
        </div>`;
}

function renderDropzoneHtml() {
    return `
        <div class="wo-dropzone upload-area" id="drop-zone">
            <i data-wo-icon="upload-cloud"></i>
            <p class="q-drop-title">Arrastrá o hacé click</p>
            <p class="q-drop-hint wo-meta-s">PNG, JPG, HEIC · hasta 4 imágenes</p>
            <input type="file" id="file-input" multiple accept="image/*,image/heic,image/heif" class="hidden">
        </div>
        <div id="preview-container" class="q-ref-grid"></div>`;
}

// ---------- Moneda del presupuesto ----------
function getBudgetCurrency() {
    try {
        const pref = window.WeOtziCurrency && typeof window.WeOtziCurrency.getDisplayPreference === 'function'
            ? window.WeOtziCurrency.getDisplayPreference()
            : null;
        if (pref && /^[A-Z]{3}$/.test(pref)) return pref;
    } catch (_) { /* sin catálogo: se usa el fallback */ }
    return formData.client_budget_currency || 'USD';
}

function getBudgetSymbol() {
    const code = getBudgetCurrency();
    try {
        const entry = window.WeOtziCurrency && typeof window.WeOtziCurrency.get === 'function'
            ? window.WeOtziCurrency.get(code)
            : null;
        if (entry && entry.symbol) return entry.symbol;
    } catch (_) { /* fallback abajo */ }
    return '$';
}

function isBudgetTierActive(tier) {
    if (tier.amount === null) return formData.client_budget_amount === null && formData._budget_tier === 'unsure';
    return String(formData.client_budget_amount || '') === String(tier.amount);
}

function findBudgetTier(amount) {
    if (amount === null || amount === undefined || amount === '') return null;
    return FIGMA_BUDGET_TIERS.find((tier) => String(tier.amount) === String(amount)) || null;
}

function formatBudgetForDisplay() {
    if (formData._budget_tier === 'unsure') return 'No estoy seguro';
    const tier = findBudgetTier(formData.client_budget_amount);
    if (tier) return tier.label.replace('{s}', getBudgetSymbol());
    if (formData.client_budget_amount) {
        return `${formData.client_budget_amount} ${formData.client_budget_currency || ''}`.trim();
    }
    return '-';
}

function selectBudgetTier(index) {
    const tier = FIGMA_BUDGET_TIERS[index];
    if (!tier) return;

    if (tier.amount === null) {
        formData.client_budget_amount = null;
        formData._budget_tier = 'unsure';
    } else {
        formData.client_budget_amount = String(tier.amount);
        formData.client_budget_currency = getBudgetCurrency();
        formData._budget_tier = tier.label;
    }

    document.querySelectorAll('.q-budget-tier').forEach((el) => {
        const active = Number(el.dataset.tier) === index;
        el.classList.toggle('is-active', active);
        el.setAttribute('aria-pressed', String(active));
    });
    persistAnswer();
}

// ---------- Fecha (chips + calendario) ----------
let _calendarCursor = null;

function selectDateChip(label, flexible) {
    formData.client_preferred_date = label;
    formData.client_flexible_dates = !!flexible;
    formData._preferred_date_iso = null;
    document.querySelectorAll('[data-date-chip]').forEach((el) => {
        el.classList.toggle('is-active', el.dataset.dateChip === label);
    });
    renderInlineCalendar();
    persistAnswer();
}

function pickCalendarDay(iso) {
    const [year, month, day] = iso.split('-').map(Number);
    formData.client_preferred_date = `${day} ${MONTHS_SHORT_ES[month - 1]} ${year}`;
    formData._preferred_date_iso = iso;
    formData.client_flexible_dates = false;
    document.querySelectorAll('[data-date-chip]').forEach((el) => el.classList.remove('is-active'));
    renderInlineCalendar();
    persistAnswer();
}

function shiftCalendarMonth(delta) {
    if (!_calendarCursor) _calendarCursor = new Date();
    _calendarCursor = new Date(_calendarCursor.getFullYear(), _calendarCursor.getMonth() + delta, 1);
    renderInlineCalendar();
}

function renderInlineCalendar() {
    const host = document.getElementById('date-calendar');
    if (!host) return;

    if (!_calendarCursor) {
        const iso = formData._preferred_date_iso;
        _calendarCursor = iso ? new Date(iso + 'T00:00:00') : new Date();
        _calendarCursor = new Date(_calendarCursor.getFullYear(), _calendarCursor.getMonth(), 1);
    }

    const year = _calendarCursor.getFullYear();
    const month = _calendarCursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const offset = (firstDay.getDay() + 6) % 7; // lunes primero
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const cells = [];
    for (let i = 0; i < offset; i++) cells.push('<span class="q-cal-day is-empty"></span>');
    for (let day = 1; day <= daysInMonth; day++) {
        const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const selected = formData._preferred_date_iso === iso;
        const past = iso < todayIso;
        cells.push(`<button type="button" class="q-cal-day ${selected ? 'is-selected' : ''} ${past ? 'is-past' : ''}"
            ${past ? 'disabled' : ''} onclick="pickCalendarDay('${iso}')">${day}</button>`);
    }

    host.innerHTML = `
        <div class="q-cal-head">
            <button type="button" class="q-cal-nav" onclick="shiftCalendarMonth(-1)" aria-label="Mes anterior">
                <i data-wo-icon="chevron-left" class="wo-icon-18"></i>
            </button>
            <span class="q-cal-title">${MONTHS_LONG_ES[month]} ${year}</span>
            <button type="button" class="q-cal-nav" onclick="shiftCalendarMonth(1)" aria-label="Mes siguiente">
                <i data-wo-icon="chevron-right" class="wo-icon-18"></i>
            </button>
        </div>
        <div class="q-cal-dow">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d) => `<span>${d}</span>`).join('')}</div>
        <div class="q-cal-grid">${cells.join('')}</div>`;
}

// ---------- Lógica post-render por pregunta ----------
function initQuestionLogic(q, screen) {
    if (q.type === 'body-selector') setupBodySelector();
    if (q.type === 'tattoo-styles') setupTattooStyles();
    if (q.type === 'file-upload') { setupFileUpload(); renderPreviews(); }
    if (q.type === 'summary') generateSummary();
    if (q.type === 'artist-confirm') {
        const artist = formData.artist_data || {};
        if (artist.name) displayArtistCard(artist);
    }

    if (q.type === 'textarea') setupTextareaCounter(q);
    if (q.type === 'date') setupDatePicker(true);
    if (q.type === 'date-range') renderInlineCalendar();

    if (q.step === 'city') {
        setupCityAutocomplete(q);
        const input = document.getElementById(`field-${q.id}`);
        if (input) input.addEventListener('change', () => checkCityMismatch());
    }

    if (q.step === 'email') {
        const input = document.getElementById(`field-${q.id}`);
        if (input) {
            input.addEventListener('blur', () => {
                const value = input.value.trim();
                if (!value || value === formData.client_email) return;
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return;
                formData.client_email = value;
                persistAnswer();
                checkEmailReuse(value);
            });
        }
    }

    // Guardado por pregunta: cada campo de texto persiste al salir del control.
    if (['text', 'email', 'tel', 'textarea'].includes(q.type)) {
        const input = document.getElementById(`field-${q.id}`);
        if (input) input.addEventListener('change', () => { readQuestionValue(q); persistAnswer(); });
    }
}

// Lee el valor del control de una pregunta y lo escribe en formData.
// Devuelve el valor normalizado (o null).
function readQuestionValue(q) {
    if (!q || !q.field) return null;

    switch (q.type) {
        case 'text':
        case 'email':
        case 'tel': {
            const input = document.getElementById(`field-${q.id}`);
            if (!input) return formData[q.field] ?? null;
            let value = input.value.trim();
            if (q.type === 'tel' && value) {
                const code = document.getElementById(`country-code-${q.id}`);
                value = `${code ? code.value : '+54'} ${value}`;
            }
            if (q.type === 'text' && value && q.field !== 'client_instagram') value = toTitleCase(value);
            if (q.field === 'client_instagram' && value.replace(/@/g, '').trim() === '') value = '';
            if (q.step === 'city' && value) value = normalizeQuotationLocation(value);
            formData[q.field] = value || null;
            return formData[q.field];
        }
        case 'textarea': {
            const textarea = document.getElementById(`field-${q.id}`);
            if (!textarea) return formData[q.field] ?? null;
            formData[q.field] = textarea.value.trim() || null;
            return formData[q.field];
        }
        case 'multi-select': {
            const checked = Array.from(document.querySelectorAll(`input[name="${q.field}"]:checked`))
                .map((c) => toTitleCase(c.value));
            formData[q.field] = checked.length ? checked.join(', ') : null;
            return formData[q.field];
        }
        case 'date': {
            const input = document.getElementById('date-picker-single');
            if (input) formData[q.field] = input.value.trim() || null;
            return formData[q.field];
        }
        default:
            return formData[q.field] ?? null;
    }
}

// Quita signos de pregunta para armar mensajes de validación legibles.
function stripQuestionMarks(text) {
    return String(text || '').replace(/[¿?]/g, '').trim();
}

// Valida todas las preguntas visibles de la pantalla y las guarda.
function collectScreenValues(screen) {
    if (!screen) return { ok: true };

    for (const q of screen.questions) {
        if (!isQuestionVisible(q)) continue;
        readQuestionValue(q);

        // En pantallas de una sola pregunta el titular ES la consigna.
        const label = FIELD_LABELS[q.step] || (screen.questions.length === 1 ? screen.title : q.title) || '';
        const value = q.field ? formData[q.field] : null;
        const optional = !!q.optional;

        if (q.type === 'body-selector') {
            if (!selectedBodyParts.length) return { ok: false, message: 'Elegí una zona del cuerpo.' };
            const zone = selectedBodyParts[0];
            if (zone.sides === 'both' && !zone.side) return { ok: false, message: 'Elegí de qué lado va el tatuaje.' };
            continue;
        }

        if (q.type === 'tattoo-styles') {
            const styles = getSelectedStyles();
            if (!styles.length) return { ok: false, message: 'Elegí al menos un estilo.' };
            continue;
        }

        if (q.type === 'file-upload' || q.type === 'summary' || q.type === 'artist-confirm') continue;

        if (q.type === 'boolean') {
            if (!optional && (value === undefined || value === null)) {
                return { ok: false, message: `Respondé: ${stripQuestionMarks(label).toLowerCase()}`, el: document.getElementById(`block-${q.step}`) };
            }
            continue;
        }

        if (q.type === 'currency') {
            if (!optional && !formData.client_budget_amount && formData._budget_tier !== 'unsure') {
                return { ok: false, message: 'Elegí un rango de presupuesto.' };
            }
            continue;
        }

        if (!optional && (value === undefined || value === null || value === '')) {
            const isChoice = q.type === 'cards' || q.type === 'options' || q.type === 'multi-select';
            const message = isChoice
                ? `Elegí una opción en ${stripQuestionMarks(label).toLowerCase()}.`
                : `Completá: ${stripQuestionMarks(label).toLowerCase()}`;
            return { ok: false, message, el: document.getElementById(`field-${q.id}`) || document.getElementById(`block-${q.step}`) };
        }

        if (q.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            return { ok: false, message: 'Revisá el correo electrónico.', el: document.getElementById(`field-${q.id}`) };
        }

        if (q.minLength && value && String(value).length < q.minLength) {
            return { ok: false, message: `Escribí al menos ${q.minLength} caracteres en ${stripQuestionMarks(label).toLowerCase()}.`, el: document.getElementById(`field-${q.id}`) };
        }
    }

    return { ok: true };
}

// Guarda la respuesta actual (borrador local + autosave en Supabase).
function persistAnswer() {
    if (!formData.quote_id) formData.quote_id = generateQuoteId();
    saveDraftToLocalStorage();
    autoSaveQuotation();
}

// ============ NAVIGATION ============
function findNextScreenIndex(fromIndex) {
    for (let i = fromIndex; i < screensConfig.length; i++) {
        if (!isScreenSkipped(screensConfig[i])) return i;
    }
    return -1;
}

function findPrevScreenIndex(fromIndex) {
    for (let i = fromIndex; i >= 0; i--) {
        if (!isScreenSkipped(screensConfig[i])) return i;
    }
    return -1;
}

function nextStep() {
    const screen = getCurrentScreen();
    if (screen) {
        const result = collectScreenValues(screen);
        if (!result.ok) {
            showToastMessage(result.message);
            if (result.el && typeof result.el.focus === 'function') result.el.focus();
            if (result.el && typeof result.el.scrollIntoView === 'function') {
                result.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return;
        }
    }

    const nextIndex = findNextScreenIndex(currentStepIndex + 1);
    if (nextIndex === -1) return;
    commitStepChange(nextIndex);
}

function prevStep() {
    if (historyStack.length > 0) {
        currentStepIndex = historyStack.pop();
        renderCurrentStep();
        updateBackButton();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }
    const prevIndex = findPrevScreenIndex(currentStepIndex - 1);
    if (prevIndex === -1) return;
    currentStepIndex = prevIndex;
    renderCurrentStep();
    updateBackButton();
}

function commitStepChange(newIndex) {
    historyStack.push(currentStepIndex);
    currentStepIndex = newIndex;
    renderCurrentStep();
    updateBackButton();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (formData.quote_id) {
        autoSaveQuotation();
        saveDraftToLocalStorage();
    }
}

// Salta a una pantalla por id (usado por el botón EDITAR del resumen).
function goToScreenById(screenId) {
    const index = getScreenIndexById(screenId);
    if (index === -1 || index === currentStepIndex) return;
    commitStepChange(index);
}

function editQuotationFromSummary() {
    goToScreenById('idea');
}

// ============ UTILITIES ============
function isScreenCompleted(screen) {
    if (!screen) return true;
    return screen.questions.every((q) => {
        if (!isQuestionVisible(q) || !q.field) return true;
        if (q.type === 'file-upload' || q.optional) return true;
        if (q.type === 'body-selector') return !!formData.tattoo_body_part;
        if (q.type === 'tattoo-styles') return getSelectedStyles().length > 0;
        const value = formData[q.field];
        return value !== undefined && value !== null && value !== '';
    });
}

function findFirstIncompleteScreenIndex() {
    for (let i = 0; i < screensConfig.length; i++) {
        const screen = screensConfig[i];
        if (isScreenSkipped(screen)) continue;
        if (screen.id === 'summary') return i;
        if (!isScreenCompleted(screen)) return i;
    }
    return findNextScreenIndex(0);
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

let _autoSaveInFlight = false;
let _autoSavePending = false;

async function autoSaveQuotation() {
    const supabaseClient = window.ConfigManager && window.ConfigManager.getSupabaseClient();
    if (!supabaseClient || window.ConfigManager.isDemoMode()) return;

    if (_autoSaveInFlight) {
        _autoSavePending = true;
        return;
    }

    _autoSaveInFlight = true;
    try {
        const payload = preparePayload();

        await WeotziData.Quotations.upsert(payload);
    } catch (error) {
        console.error('Auto-save error:', error);
    } finally {
        _autoSaveInFlight = false;
        if (_autoSavePending) {
            _autoSavePending = false;
            autoSaveQuotation();
        }
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
        artist_current_city: normalizeQuotationLocation(formData.artist_current_city || ''),
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
        client_city_residence: normalizeQuotationLocation(formData.client_city_residence || ''),
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
        client_user_id: _authenticatedUserId || null,
        quotation_medium: 'web',
        source: formData.quotation_source || 'web_chat',
        tattoo_estimated_sessions: formData.tattoo_estimated_sessions || null,
        updated_at: new Date().toISOString()
    };
}

function updateBackButton() {
    const btn = document.getElementById('back-btn');
    if (!btn) return;
    if (historyStack.length > 0) btn.classList.remove('hidden');
    else btn.classList.add('hidden');
}


// ============ HANDLERS (Standard) ============

// Marca el valor sin avanzar: en el Figma cada pantalla agrupa varias
// preguntas y el avance lo dispara CONTINUAR en la barra inferior.
function skipStep(field) {
    formData[field] = null;
    persistAnswer();
}

// Simple toast notification for form
function showToastMessage(message) {
    // Never show toasts in summary/revision screen
    const screen = getCurrentScreen();
    if (screen && screen.id === 'summary') return;

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

// ============ EMAIL REUSE (Lookup previous quotation by email) ============

let _emailReusePendingData = null;

async function checkEmailReuse(email) {
    try {
        const supabaseClient = window.ConfigManager && window.ConfigManager.getSupabaseClient();
        if (!supabaseClient || (window.ConfigManager.isDemoMode && window.ConfigManager.isDemoMode())) {
            return;
        }

        const normalizedEmail = email.trim().toLowerCase();

        let row;
        try {
            row = await WeotziData.Quotations.findLatestByEmailForReuse(normalizedEmail);
        } catch (error) {
            _dbg('Email reuse lookup error:', error.message);
            return;
        }

        if (!row) return;

        _emailReusePendingData = {
            client_full_name: row.client_full_name || null,
            client_whatsapp: row.client_whatsapp || null,
            client_birth_date: row.client_birth_date || null,
            client_instagram: row.client_instagram || null,
            client_city_residence: row.client_city_residence || null,
            client_contact_preference: row.client_contact_preference || null,
            client_health_conditions: row.client_health_conditions || null,
            client_allergies: row.client_allergies || null
        };

        showEmailReuseModal({
            quote_id: row.quote_id,
            client_full_name: row.client_full_name
        });
    } catch (err) {
        console.warn('Email reuse check error:', err);
    }
}

function showEmailReuseModal(preview) {
    const summaryEl = document.getElementById('reuse-summary-info');
    if (summaryEl) {
        summaryEl.innerHTML = `
            <div class="reuse-detail">
                <span class="reuse-label">Cotización</span>
                <span class="reuse-value highlight">${preview.quote_id || '-'}</span>
            </div>
            <div class="reuse-detail">
                <span class="reuse-label">Cliente</span>
                <span class="reuse-value">${preview.client_full_name || '-'}</span>
            </div>
        `;
    }

    const modal = document.getElementById('email-reuse-modal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function hideEmailReuseModal() {
    const modal = document.getElementById('email-reuse-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function acceptEmailReuse() {
    if (_emailReusePendingData) {
        applyReusedClientData(_emailReusePendingData);
    }
    _emailReusePendingData = null;
    hideEmailReuseModal();
    // Los datos reutilizados se vuelcan en los campos de la pantalla actual.
    renderCurrentStep();
    persistAnswer();
}

function declineEmailReuse() {
    _emailReusePendingData = null;
    hideEmailReuseModal();
}

function applyReusedClientData(data) {
    if (data.client_full_name) formData.client_full_name = data.client_full_name;
    if (data.client_whatsapp) formData.client_whatsapp = data.client_whatsapp;
    if (data.client_birth_date) formData.client_birth_date = data.client_birth_date;
    if (data.client_instagram) formData.client_instagram = data.client_instagram;
    if (data.client_city_residence) {
        formData.client_city_residence = normalizeQuotationLocation(data.client_city_residence);
        formData.client_city_name = formData.client_city_residence.split(',')[0]?.trim() || '';
        formData.client_country = formData.client_city_residence.split(',').pop()?.trim() || '';
    }
    if (data.client_contact_preference) formData.client_contact_preference = data.client_contact_preference;
    if (data.client_allergies && data.client_allergies !== 'Ninguna') {
        formData.client_allergies = data.client_allergies;
    }

    if (data.client_health_conditions && data.client_health_conditions !== 'Ninguna') {
        formData.client_medical_boolean = true;
        formData.client_medical_details = data.client_health_conditions;
    } else {
        formData.client_medical_boolean = false;
        formData.client_medical_details = null;
    }

    _dbg('Client data reused from previous quotation');
}

window.acceptEmailReuse = acceptEmailReuse;
window.declineEmailReuse = declineEmailReuse;

// ============ END EMAIL REUSE ============

// Selección de una opción (color, tamaño…). No avanza de pantalla: solo marca
// el estado y guarda. El avance lo dispara CONTINUAR.
function handleOptionSelect(field, value) {
    const finalValue = typeof value === 'string' ? toTitleCase(value) : value;
    formData[field] = finalValue;

    const container = document.querySelector(`#block-${fieldToStep(field)}`) || document;
    container.querySelectorAll('[data-value]').forEach((el) => {
        el.classList.toggle('is-selected', toTitleCase(String(el.dataset.value)) === finalValue);
    });
    const unsureLink = container.querySelector('.q-inline-link');
    if (unsureLink) unsureLink.classList.toggle('is-selected', finalValue === 'No Estoy Seguro');

    persistAnswer();
}

function fieldToStep(field) {
    const q = (questionsConfig || []).find((item) => item.field === field);
    return q ? q.step : '';
}

function handleBoolean(field, value) {
    formData[field] = value;

    const step = fieldToStep(field);
    const block = document.getElementById(`block-${step}`);
    if (block) {
        block.querySelectorAll('[data-bool]').forEach((el) => {
            el.classList.toggle('is-selected', (el.dataset.bool === 'true') === value);
        });
    }

    // El detalle médico aparece en la misma pantalla cuando corresponde.
    if (field === 'client_medical_boolean') {
        const details = document.getElementById('block-medical-details');
        if (details) details.classList.toggle('hidden', value !== true);
    }

    persistAnswer();
}


// ============ LOGIC MIGRATION (Legacy -> Dynamic) ============
// El Figma del flujo de cliente no tiene búsqueda de artista: la cotización
// sale por match. El artista solo llega por deep link (?artist=usuario), que
// resuelve handleUrlArtist().

function continueWithoutArtist() {
    formData.no_artist = true;
    formData.artist_id = null;
    formData.artist_name = null;
    formData.artist_data = null;

    // Generate Quote ID if not exists
    if (!formData.quote_id) {
        formData.quote_id = generateQuoteId();
    }

    // Sin artista la solicitud sale por match: se arranca en la pantalla 01.
    goToScreenById('idea');
}

async function fetchAllArtists() {
    const supabaseClient = window.ConfigManager && window.ConfigManager.getSupabaseClient();
    if (supabaseClient && !window.ConfigManager.isDemoMode()) {
        // Public path — exclude password via the shared column list
        // (config-manager.js ARTIST_PUBLIC_COLUMNS).
        const { data, error } = await WeotziData.Artists.listPublic(window.ARTIST_PUBLIC_COLUMNS || '*');
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

function confirmArtist() {
    // When the user comes from /pre-cotizador, basic tattoo fields are already
    // filled: se salta a la primera pantalla incompleta en vez de pedir de
    // nuevo lo que ya cargó.
    if (formData.quotation_source === 'prequote') {
        const nextIncomplete = findFirstIncompleteScreenIndex();
        if (nextIncomplete !== -1 && nextIncomplete > currentStepIndex) {
            commitStepChange(nextIncomplete);
            return;
        }
    }
    nextStep();
}

function displayArtistCard(artist) {
    // Fill template data
    setText('artist-name-display', toTitleCase(artist.name));
    setText('artist-styles-display', Array.isArray(artist.styles_array) ? artist.styles_array.map(toTitleCase).join(', ') : toTitleCase(artist.styles_array));
    setText('artist-location-display', toTitleCase(normalizeQuotationLocation(artist.ubicacion || '')));
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
// La ciudad y la disponibilidad de viaje conviven en la pantalla 07: cuando la
// ciudad del cliente no coincide con la del artista se revela el bloque de
// viaje en la misma pantalla (antes era un salto de paso).
function checkCityMismatch() {
    const q = (questionsConfig || []).find((item) => item.step === 'city');
    const cityInput = q ? document.getElementById(`field-${q.id}`) : null;
    const city = cityInput ? normalizeQuotationLocation(cityInput.value.trim()) : (formData.client_city_residence || '');

    if (!city) return;
    if (cityInput) cityInput.value = city;

    formData.client_city_residence = city;
    formData.client_city_name = city.split(',')[0]?.trim() || '';
    formData.client_country = city.split(',').pop()?.trim() || '';

    const artistCity = normalizeQuotationLocation(formData.artist_current_city || '');
    formData.artist_current_city = artistCity;

    const cleanClientCity = city.split(',')[0].toLowerCase().trim();
    const cleanArtistCity = artistCity.split(',')[0].toLowerCase().trim();
    const isMatch = getStringSimilarity(cleanClientCity, cleanArtistCity) >= 0.7;
    const mismatch = !!artistCity && !isMatch;

    formData.city_mismatch_acknowledged = mismatch;
    formData._travel_required = mismatch;
    if (!mismatch) formData.client_travel_willing = false;

    const travelBlock = document.getElementById('block-travel');
    if (travelBlock) travelBlock.classList.toggle('hidden', !mismatch);
    if (mismatch) showToastMessage(`El artista está en ${toTitleCase(artistCity)}.`);

    persistAnswer();
}

function setTravel(val) {
    formData.client_travel_willing = val;
    hideToastMessage();
    persistAnswer();
}


// ============ SELECTOR DE ZONA (Figma 03) ============
// El Figma muestra una grilla PLANA de zonas (BRAZO, ANTEBRAZO, MANO, PIERNA,
// MUSLO, ESPALDA, PECHO, COSTILLAS, CUELLO, CABEZA) y, debajo, un panel con la
// zona elegida y "¿DE QUÉ LADO?" (IZQUIERDO / DERECHO). No hay drill-down.
// La grilla se aplana desde body_parts (zonas raíz + subzonas reales).

function flattenBodyZones() {
    const flat = [];
    (BODY_PARTS_DATA || []).forEach((zone) => {
        flat.push({
            key: zone.id,
            id: zone.id,
            zoneId: zone.id,
            label: zone.label,
            zoneLabel: zone.label,
            image: zone.image || '',
            sides: zone.sides || 'both',
            pain_level: zone.pain_level
        });
        (zone.subparts || []).forEach((part) => {
            flat.push({
                key: `${zone.id}::${part.id}`,
                id: part.id,
                zoneId: zone.id,
                label: part.label,
                zoneLabel: zone.label,
                image: part.image || zone.image || '',
                sides: part.sides || zone.sides || 'both',
                pain_level: part.pain_level
            });
        });
    });
    return flat;
}

function setupBodySelector() {
    renderBodyZones();
    updateBodySidePanel();
}

function renderBodyZones() {
    const grid = document.getElementById('body-zones-grid');
    if (!grid) return;

    const zones = flattenBodyZones();
    if (!zones.length) {
        grid.innerHTML = '<p class="empty-sheet-msg">No hay zonas configuradas</p>';
        return;
    }

    const selectedKey = selectedBodyParts.length ? selectedBodyParts[0].key : null;

    grid.innerHTML = zones.map((zone) => `
        <button type="button" class="q-zone-tile ${zone.key === selectedKey ? 'is-selected' : ''}"
            data-zone-key="${escapeQuotationHtml(zone.key)}" onclick="selectBodyZone('${escapeQuotationHtml(zone.key).replace(/'/g, "\\'")}')">
            <span class="q-zone-media ${zone.image ? '' : 'is-empty'}">
                ${zone.image ? `<img src="${escapeQuotationHtml(zone.image)}" alt="" loading="lazy">` : ''}
            </span>
            <span class="q-zone-label">${escapeQuotationHtml(zone.label)}</span>
        </button>`).join('');
}

function selectBodyZone(key) {
    const zone = flattenBodyZones().find((z) => z.key === key);
    if (!zone) return;

    const previous = selectedBodyParts[0];
    const side = previous && previous.key === key ? previous.side : null;

    selectedBodyParts = [{
        key: zone.key,
        id: zone.id,
        zone: zone.zoneId,
        label: zone.label,
        zoneLabel: zone.zoneLabel,
        sides: zone.sides,
        side: side || null,
        sideLabel: side ? (side === 'left' ? 'Izquierdo' : 'Derecho') : null,
        pain_level: zone.pain_level
    }];

    currentBodyZone = zone;
    currentBodySide = side || null;

    renderBodyZones();
    updateBodySidePanel();
    commitBodySelection();
}

function handleSideChosen(side) {
    if (!selectedBodyParts.length) return;
    selectedBodyParts[0].side = side;
    selectedBodyParts[0].sideLabel = side === 'left' ? 'Izquierdo' : 'Derecho';
    currentBodySide = side;
    updateBodySidePanel();
    commitBodySelection();
}

function updateBodySidePanel() {
    const panel = document.getElementById('body-side-panel');
    if (!panel) return;

    const selection = selectedBodyParts[0];
    if (!selection) {
        panel.classList.add('hidden');
        return;
    }

    panel.classList.remove('hidden');
    const zoneEl = document.getElementById('body-side-zone');
    if (zoneEl) zoneEl.textContent = selection.label;

    const hasSides = selection.sides === 'both';
    const label = document.getElementById('body-side-label');
    const chips = document.getElementById('body-side-chips');
    if (label) label.classList.toggle('hidden', !hasSides);
    if (chips) {
        chips.classList.toggle('hidden', !hasSides);
        chips.querySelectorAll('[data-side]').forEach((el) => {
            el.classList.toggle('is-active', el.dataset.side === selection.side);
        });
    }
}

// Escribe la selección en formData con el mismo formato de texto que ya
// consumen artista/backoffice ("Zona: Subzona") + el lado en su columna.
function commitBodySelection() {
    const selection = selectedBodyParts[0];
    if (!selection) {
        formData.tattoo_body_part = null;
        formData.tattoo_body_side = null;
        formData.tattoo_body_parts_data = [];
        return;
    }

    const shared = window.WeotziQuotationShared;
    const label = shared && typeof shared.formatBodyPartLabel === 'function'
        ? shared.formatBodyPartLabel(selection.zoneLabel, selection.label)
        : (selection.zoneLabel === selection.label ? selection.label : `${selection.zoneLabel}: ${selection.label}`);

    formData.tattoo_body_part = toTitleCase(label);
    formData.tattoo_body_side = selection.sideLabel || null;
    formData.tattoo_body_parts_data = selectedBodyParts;
    persistAnswer();
}

function removeBodyPart() {
    selectedBodyParts = [];
    currentBodyZone = null;
    currentBodySide = null;
    renderBodyZones();
    updateBodySidePanel();
    commitBodySelection();
}

function confirmBodyParts() {
    commitBodySelection();
    nextStep();
}


// ============ ESTILOS (Figma 02) ============
// Multi-selección directa sobre la tarjeta: sin modal intermedio. El badge de
// check va arriba a la derecha y el nombre debajo de la tarjeta, en mono.
let TATTOO_STYLES_DATA = [];

async function setupTattooStyles() {
    const grid = document.getElementById('styles-grid');
    const loading = document.getElementById('styles-loading');

    if (!grid || !loading) return;

    grid.innerHTML = '';
    loading.classList.remove('hidden');

    try {
        TATTOO_STYLES_DATA = await window.ConfigManager.loadTattooStylesFromDB();
        loading.classList.add('hidden');

        if (!TATTOO_STYLES_DATA || TATTOO_STYLES_DATA.length === 0) {
            // Sin catálogo en la DB: se usan los estilos compartidos como
            // último recurso para que la pantalla siga siendo usable.
            TATTOO_STYLES_DATA = SHARED_TATTOO_STYLE_OPTIONS.map((opt) => ({
                id: opt.value, slug: opt.value, name: opt.label, substyles: []
            }));
        }

        renderStylesGrid(TATTOO_STYLES_DATA);
    } catch (err) {
        console.error('Error loading tattoo styles:', err);
        loading.classList.add('hidden');
        grid.innerHTML = '<p class="error-msg">No pudimos cargar los estilos.</p>';
    }
}

// Devuelve siempre un array con los estilos elegidos, sea cual sea el formato
// guardado (objeto único del wizard viejo o el nuevo con `styles`).
function getSelectedStyles() {
    const value = formData.tattoo_style;
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === 'object') {
        if (Array.isArray(value.styles) && value.styles.length) return value.styles;
        return value.style_id ? [value] : [];
    }
    return [{ style_id: String(value), style_slug: String(value), style_name: String(value) }];
}

function isStyleSelected(styleId) {
    return getSelectedStyles().some((s) => String(s.style_id) === String(styleId));
}

function renderStylesGrid(styles) {
    const grid = document.getElementById('styles-grid');
    if (!grid) return;

    grid.innerHTML = styles.map((style) => {
        const selected = isStyleSelected(style.id);
        const cover = style.cover_image_url
            ? `<img src="${escapeQuotationHtml(style.cover_image_url)}" alt="" class="style-card-img" loading="lazy">`
            : '<div class="style-card-placeholder"><i data-wo-icon="pen-tool"></i></div>';

        return `
            <div class="style-card-wrap">
                <button type="button" class="style-card ${selected ? 'selected' : ''}"
                    data-style-id="${escapeQuotationHtml(style.id)}"
                    aria-pressed="${selected}"
                    onclick="toggleStyleSelection('${escapeQuotationHtml(String(style.id)).replace(/'/g, "\\'")}')">
                    <span class="style-card-cover">${cover}</span>
                    ${selected ? '<span class="style-check"><i data-wo-icon="check"></i></span>' : ''}
                </button>
                <p class="style-card-title ${selected ? 'is-selected' : ''}">${escapeQuotationHtml(style.name)}</p>
            </div>`;
    }).join('');
}

function toggleStyleSelection(styleId) {
    const style = (TATTOO_STYLES_DATA || []).find((s) => String(s.id) === String(styleId));
    if (!style) return;

    let selected = getSelectedStyles();
    const already = selected.some((s) => String(s.style_id) === String(styleId));

    if (already) {
        selected = selected.filter((s) => String(s.style_id) !== String(styleId));
    } else {
        selected = selected.concat([{
            style_id: style.id,
            style_slug: style.slug,
            style_name: style.name,
            substyle_id: null,
            substyle_slug: null,
            substyle_name: null
        }]);
    }

    // Formato compatible: el primer estilo queda en la raíz (lo que ya leen
    // artista, backoffice y dashboard del cliente) y la selección completa
    // viaja en `styles`.
    if (!selected.length) {
        formData.tattoo_style = null;
    } else {
        formData.tattoo_style = Object.assign({}, selected[0], { styles: selected });
    }

    checkStyleMismatch();
    renderStylesGrid(TATTOO_STYLES_DATA);
    persistAnswer();
}

// Aviso (no bloqueante) si el artista elegido trabaja otros estilos.
function checkStyleMismatch() {
    const artist = formData.artist_data;
    if (!artist) return;

    const artistStyles = typeof artist.styles_array === 'string'
        ? (artist.styles_array.startsWith('[') ? JSON.parse(artist.styles_array) : [artist.styles_array])
        : (artist.styles_array || []);
    if (!artistStyles.length) return;

    const chosen = getSelectedStyles().map((s) => String(s.style_name || '').toLowerCase().trim()).filter(Boolean);
    if (!chosen.length) return;

    const hasMatch = chosen.some((name) => artistStyles.some((s) => {
        const clean = String(s).toLowerCase().trim();
        return clean.includes(name) || name.includes(clean);
    }));

    formData.style_mismatch_acknowledged = !hasMatch;
    if (!hasMatch) showToastMessage(`${artist.name} trabaja otros estilos, pero podés seguir con la cotización.`);
}

window.toggleStyleSelection = toggleStyleSelection;


// File Upload
// La zona de subida existe en dos lugares: la caja completa de la pantalla 01
// (REFERENCIA INICIAL) y el tile "AÑADIR REFERENCIA" de la pantalla 05. Ambos
// usan el mismo input y el mismo pipeline (storage + Drive/n8n).
function setupFileUpload() {
    const input = document.getElementById('file-input');
    if (!input) return;

    input.onchange = (e) => { handleFiles(e.target.files); e.target.value = ''; };

    const drop = document.getElementById('drop-zone');
    if (drop) {
        drop.onclick = () => input.click();
        drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('dragover'); };
        drop.ondragleave = () => drop.classList.remove('dragover');
        drop.ondrop = (e) => {
            e.preventDefault();
            drop.classList.remove('dragover');
            if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
        };
    }
}

window.openReferencePicker = function openReferencePicker() {
    const input = document.getElementById('file-input');
    if (input) input.click();
};
async function handleFiles(files) {
    const remainingSlots = 4 - uploadedFiles.length;
    if (remainingSlots <= 0) {
        showToastMessage("Máximo 4 imágenes de referencia permitidas.");
        return;
    }

    const filesArray = Array.from(files).slice(0, remainingSlots);
    if (filesArray.length < files.length) {
        showToastMessage("Solo se agregaron las primeras 4 imágenes.");
    }

    // Convertir y comprimir cada archivo antes de agregar a la lista.
    // handleFiles es async — el caller (input.onchange) no necesita awaitar.
    const processedFiles = [];
    for (const file of filesArray) {
        const converted = await convertIfHEIC(file);
        const compressed = await compressImage(converted);
        processedFiles.push(compressed);
    }

    uploadedFiles = [...uploadedFiles, ...processedFiles];
    formData.reference_images_count = uploadedFiles.length;
    renderPreviews();
}

// Figma 05: cada referencia es un tile con botón de borrado arriba a la
// derecha; la última celda es "AÑADIR REFERENCIA" (borde punteado).
function renderPreviews() {
    const cont = document.getElementById('preview-container');
    if (!cont) return;
    cont.innerHTML = '';

    uploadedFiles.forEach((file, index) => {
        const url = URL.createObjectURL(file);
        const tile = document.createElement('div');
        tile.className = 'q-ref-tile';
        tile.style.backgroundImage = `url(${url})`;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'q-ref-remove';
        removeBtn.setAttribute('aria-label', 'Quitar referencia');
        removeBtn.innerHTML = '<i data-wo-icon="x"></i>';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removeUploadedFile(index);
        };

        tile.appendChild(removeBtn);
        cont.appendChild(tile);
    });

    // Tile "AÑADIR REFERENCIA" (solo en la pantalla 05, donde no hay dropzone).
    if (!document.getElementById('drop-zone') && uploadedFiles.length < 4) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'q-ref-add';
        add.onclick = () => window.openReferencePicker();
        add.innerHTML = '<i data-wo-icon="plus"></i><span>Añadir referencia</span>';
        cont.appendChild(add);
    }

    const dropZone = document.getElementById('drop-zone');
    if (dropZone) dropZone.classList.toggle('is-full', uploadedFiles.length >= 4);
}

function removeUploadedFile(index) {
    uploadedFiles.splice(index, 1);
    formData.reference_images_count = uploadedFiles.length;
    renderPreviews();
    persistAnswer();
}

function skipReferences() {
    uploadedFiles = [];
    formData.reference_images_count = 0;
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
        _dbg('No reference images to upload');
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

    _dbg(`Uploading ${uploadedFiles.length} reference images to ${bucketName}/${quoteId}/`);

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

            _dbg(`Uploaded: ${fileName}`);
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
        _dbg('No files to notify n8n about');
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
        _dbg(`Notifying n8n webhook for ${files.length} files...`);
        
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

        let responseData = {};
        try {
            responseData = await response.json();
        } catch (_) {
            _dbg('n8n webhook returned non-JSON response');
        }

        _dbg('n8n webhook notified successfully');
        return {
            success: responseData.success !== false,
            driveFolderUrl: responseData.drive_folder_url || null,
            filesProcessed: responseData.files_processed || 0,
            quoteId: responseData.quote_id || quoteId
        };
    } catch (err) {
        console.error('Error notifying n8n webhook:', err);
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
        _dbg('No files to upload to Google Drive');
        return { success: true, uploadedFiles: [] };
    }
    
    try {
        _dbg(`Uploading ${files.length} files to Google Drive folder for ${quoteId}...`);
        
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
        
        _dbg(`Google Drive folder created: ${result.quoteFolderLink}`);
        _dbg(`Uploaded ${result.uploadedCount} files successfully`);
        
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
        _dbg('No attachment records to save');
        return { success: true };
    }
    
    const supabaseClient = window.ConfigManager && window.ConfigManager.getSupabaseClient();
    if (!supabaseClient) {
        console.warn('Supabase not available for saving attachment records');
        return { success: false, error: 'Supabase not configured' };
    }
    
    try {
        _dbg(`Saving ${uploadedFiles.length} attachment records for ${quoteId}...`);
        
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
        
        const data = await WeotziData.Attachments.insertMany(attachmentRecords);

        _dbg(`Successfully saved ${attachmentRecords.length} attachment records`);
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
                _dbg(`Google Drive folder for ${quoteId}: ${driveUrl}`);
                
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
            // Use n8n webhook for Google Drive upload (authoritative path)
            const webhookUrl = config.n8n?.webhookUrl;
            if (webhookUrl) {
                const notifyResult = await notifyN8NWebhook(quoteId, uploadResult.files);
                
                if (notifyResult.success && notifyResult.driveFolderUrl) {
                    driveUrl = notifyResult.driveFolderUrl;
                    uploadedDriveFiles = new Array(notifyResult.filesProcessed || 0);
                    _dbg(`n8n Drive folder for ${quoteId}: ${driveUrl}`);
                } else if (notifyResult.success) {
                    console.warn('n8n returned success but no Drive folder URL');
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


// ============ RESUMEN (Figma 08 · "Tu tatuaje") ============
// Grilla plana de 7 datos + MOODBOARD + bloque de CTA. Los datos personales
// no aparecen acá: en el Figma viven en el centro de cuenta.
function generateSummary() {
    hideToastMessage();
    summaryReached = true;

    const cont = document.getElementById('summary-content');
    if (!cont) return;

    const styles = getSelectedStyles();
    const stylesText = styles.length
        ? styles.map((s) => s.substyle_name ? `${s.style_name} › ${s.substyle_name}` : s.style_name).join(' · ')
        : '-';

    const location = [formData.tattoo_body_part, formData.tattoo_body_side]
        .filter(Boolean).join(' · ') || '-';

    const size = formatTattooSizeForDisplay(formData.tattoo_size);
    const referencesCount = uploadedFiles.length || formData.reference_images_count || 0;
    const referencesText = referencesCount === 1 ? '1 imagen' : `${referencesCount} imágenes`;

    const rows = [
        { label: 'Idea', value: formData.tattoo_idea_description || '-', wide: true },
        { label: 'Estilo', value: stylesText },
        { label: 'Ubicación', value: location },
        { label: 'Tamaño', value: size },
        { label: 'Referencias', value: referencesText },
        { label: 'Presupuesto', value: formatBudgetForDisplay() },
        { label: 'Fecha', value: formData.client_preferred_date || '-' }
    ];

    cont.innerHTML = rows.map((row) => `
        <div class="q-summary-item ${row.wide ? 'q-summary-item--wide' : ''}">
            <span class="q-summary-k">${escapeQuotationHtml(row.label)}</span>
            <span class="q-summary-v">${escapeQuotationHtml(row.value)}</span>
        </div>`).join('');

    // Moodboard: miniaturas reales de las referencias subidas.
    const moodboard = document.getElementById('summary-moodboard');
    if (moodboard) {
        if (uploadedFiles.length) {
            moodboard.classList.remove('hidden');
            moodboard.innerHTML =
                '<p class="q-summary-k">Moodboard</p>' +
                '<div class="q-moodboard-grid">' +
                uploadedFiles.map((file) => {
                    const url = URL.createObjectURL(file);
                    return `<span class="q-moodboard-thumb" style="background-image:url(${url})"></span>`;
                }).join('') +
                '</div>';
        } else {
            moodboard.classList.add('hidden');
            moodboard.innerHTML = '';
        }
    }

    // El copy final depende de si hay artista elegido (deep link) o si la
    // solicitud sale a los artistas que hagan match.
    const copy = document.getElementById('q-final-copy');
    if (copy) {
        copy.textContent = formData.artist_name
            ? `Vamos a enviar tu solicitud a ${toTitleCase(formData.artist_name)} con todos los detalles.`
            : 'Vamos a enviar tu solicitud a artistas que trabajen con este estilo y ubicación.';
    }
}

// Muestra el tamaño como en el Figma ("Pequeño (5–8 cm)").
function formatTattooSizeForDisplay(value) {
    if (!value) return '-';
    const option = FIGMA_SIZE_OPTIONS.find((opt) => toTitleCase(opt.value) === value || opt.label === value);
    if (option) return `${option.label} (${option.subtitle})`;
    const shared = (SHARED_TATTOO_SIZE_OPTIONS || []).find((opt) => toTitleCase(opt.value) === value);
    if (shared) return shared.subtitle ? `${shared.label} (${shared.subtitle})` : shared.label;
    return String(value).replace(/_/g, ' ');
}


// Salta a la pantalla que contiene un campo dado (por ejemplo desde EDITAR).
function goToStepByField(fieldName) {
    const screenIdx = screensConfig.findIndex((screen) =>
        screen.questions.some((q) => q.field === fieldName));
    if (screenIdx !== -1) commitStepChange(screenIdx);
}

window.goToStepByField = goToStepByField;
window.editQuotationFromSummary = editQuotationFromSummary;
window.goToScreenById = goToScreenById;

// Submit
let _isSubmittingQuotation = false;

async function submitQuotation() {
    if (_isSubmittingQuotation) return;
    _isSubmittingQuotation = true;

    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) submitBtn.disabled = true;

    showLoading();

    // Track warnings for user guidance
    let uploadWarnings = [];

    try {
        // Finalize status
        formData.quote_status = 'pending';

        // 1. Upload reference images to Storage and notify n8n for Google Drive transfer
        let referenceImagesResult = null;
        if (uploadedFiles && uploadedFiles.length > 0) {
            _dbg('Processing reference images...');
            referenceImagesResult = await processReferenceImages(formData.quote_id);
            
            if (referenceImagesResult.success) {
                // Log detailed results
                _dbg(`Reference images processed: Supabase=${referenceImagesResult.filesUploaded || 0}, Drive=${referenceImagesResult.filesUploadedToDrive || 0}`);
                
                if (referenceImagesResult.driveUrl) {
                    // Store the expected Google Drive folder URL
                    formData.tattoo_references = referenceImagesResult.driveUrl;
                    _dbg(`Drive folder: ${referenceImagesResult.driveUrl}`);
                }
                
                // Check if some files failed to upload to Google Drive
                if (referenceImagesResult.filesUploaded > 0 && 
                    referenceImagesResult.filesUploadedToDrive === 0) {
                    // All files failed to upload to Google Drive
                    uploadWarnings.push('Las imágenes de referencia no se pudieron subir a Google Drive, pero quedaron guardadas en el servidor.');
                    console.warn('Warning: All files failed to upload to Google Drive');
                } else if (referenceImagesResult.filesUploaded > referenceImagesResult.filesUploadedToDrive) {
                    // Some files failed
                    const failedCount = referenceImagesResult.filesUploaded - referenceImagesResult.filesUploadedToDrive;
                    uploadWarnings.push(`${failedCount} imagen(es) no se pudieron subir a Google Drive.`);
                    console.warn(`Warning: ${failedCount} files failed to upload to Google Drive`);
                }
            } else {
                // Image upload completely failed
                uploadWarnings.push('No pudimos procesar las imágenes de referencia.');
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

            await WeotziData.Quotations.upsert(payload);
        }

        // 3. Email is now handled by n8n webhook (triggered in step 4.5 below)
        if (!supabaseClient) {
            await new Promise(r => setTimeout(r, 1500));
        }

        // 3. Fetch Next Steps content from app_settings
        let nextStepsContent = '<p><strong>1. Revisá tu correo</strong><br>Te escribimos ahí cuando haya novedades de tu solicitud.</p><p><strong>2. Prepará tus referencias</strong><br>Si tenés más imágenes que te inspiran, tenelas listas para compartir.</p><p><strong>3. Agendá tu sesión</strong><br>Cuando cierres los detalles con el artista, reservá la fecha.</p>';
        let websiteUrl = '';
        
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
                    tattoo_is_first_tattoo: formData.tattoo_is_first_tattoo ?? null,
                    tattoo_is_cover_up: formData.tattoo_is_cover_up ?? null,
                    
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
                _dbg('n8n event sent: client_quotation_submitted');
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
                <div class="wo-alert wo-alert--warning upload-warning">
                    <i data-wo-icon="alert-triangle" class="wo-icon-18"></i>
                    <div>
                        <p><strong>Aviso:</strong> ${uploadWarnings.join(' ')}</p>
                        <p>Tu solicitud se envió igual y las referencias siguen disponibles.</p>
                    </div>
                </div>
            `;
        }

        container.innerHTML = `
            <section class="step active" id="step-success">
                <div class="success-content">
                    <div class="success-icon"><i data-wo-icon="check"></i></div>
                    <h1>Solicitud enviada</h1>
                    ${warningHtml}
                    <p class="success-quote-id">Tu ID · <span class="highlight-text">${formData.quote_id}</span></p>
                    <p class="success-msg">
                        ${formData.artist_name
                            ? `<span>${escapeQuotationHtml(toTitleCase(formData.artist_name))}</span> recibió tu solicitud.`
                            : 'Tu solicitud ya está viajando a los artistas que trabajan con tu estilo y ubicación.'}
                    </p>

                    <!-- Create Account Invitation -->
                    <div class="create-account-section">
                        <div class="account-benefits">
                            <h3><i data-wo-icon="user-plus" class="wo-icon-18"></i> Creá tu cuenta gratuita</h3>
                            <p class="benefits-intro">Accedé a funciones exclusivas:</p>
                            <ul class="benefits-list">
                                <li><i data-wo-icon="eye"></i> Ver el estado de tu cotización en tiempo real</li>
                                <li><i data-wo-icon="message-circle"></i> Chatear directamente con el artista</li>
                                <li><i data-wo-icon="clock"></i> Guardar tu historial de cotizaciones</li>
                                <li><i data-wo-icon="bell"></i> Recibir notificaciones de actualizaciones</li>
                            </ul>
                        </div>
                        <div class="account-actions">
                            <button class="wo-btn wo-btn--accent wo-btn--hard btn-primary btn-create-account" onclick="goToClientRegistration()">
                                <i data-wo-icon="user-plus" class="wo-icon-18"></i> Crear cuenta gratis
                            </button>
                            <button class="wo-btn wo-btn--ghost btn-secondary btn-skip-account" onclick="showSuccessWithoutAccount()">
                                Continuar sin cuenta <i data-wo-icon="arrow-right" class="wo-icon-18"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </section>
        `;
        // Hide progress + back bar on success (topbar stays visible)
        _setQuotationChromeVisible(false);

        // Clear draft from localStorage after successful submission
        clearDraftFromLocalStorage();

        hideLoading();
        _dbg('Quotation submitted:', formData.quote_id);

    } catch (error) {
        _isSubmittingQuotation = false;
        if (submitBtn) submitBtn.disabled = false;
        hideLoading();
        console.error('Submit error:', error);
        alert('Hubo un error al enviar la solicitud. Intentá de nuevo.');
    }
}

// Utilities
function showLoading() { document.getElementById('loading-overlay')?.classList.remove('hidden'); }
function hideLoading() { document.getElementById('loading-overlay')?.classList.add('hidden'); }

// Muestra/oculta el "chrome" del wizard (barra inferior ATRÁS + CONTINUAR).
// En la pantalla de éxito se oculta; el topbar de marca queda visible.
function _setQuotationChromeVisible(visible) {
    const footbarEl = document.getElementById('q-footbar');
    if (footbarEl) footbarEl.style.display = visible ? '' : 'none';
}

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
// El CTA "Conocer We Ötzi" apunta al sitio corporativo. Mientras se trabaja en
// local (o sobre un túnel del server local) no se sale del entorno: se usa la
// home de la app. En producción sigue mandando el valor de app_settings.
function resolveWebsiteUrl(configuredUrl) {
    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '' ||
        /\.ngrok(-free)?\.(app|io)$/.test(host) || /^192\.168\./.test(host);
    if (isLocal) return '/inicio';
    return configuredUrl || '/inicio';
}

async function showSuccessWithoutAccount() {
    // Fetch Next Steps content from app_settings
    let nextStepsContent = '<p><strong>1. Revisá tu correo</strong><br>Te escribimos ahí cuando haya novedades de tu solicitud.</p><p><strong>2. Prepará tus referencias</strong><br>Si tenés más imágenes que te inspiran, tenelas listas para compartir.</p><p><strong>3. Agendá tu sesión</strong><br>Cuando cierres los detalles con el artista, reservá la fecha.</p>';
    let websiteUrl = '';
    
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
                <div class="success-icon"><i data-wo-icon="check"></i></div>
                <h1>Solicitud enviada</h1>
                <p class="success-quote-id">Tu ID · <span class="highlight-text">${formData.quote_id}</span></p>
                <p class="success-msg">
                    <span>${formData.artist_name}</span> recibió tu solicitud.
                </p>

                <!-- Next Steps Section -->
                <div class="next-steps-section">
                    <h3><i data-wo-icon="list" class="wo-icon-18"></i> Próximos pasos</h3>
                    <div class="next-steps-content">
                        ${nextStepsContent}
                    </div>
                </div>

                <!-- Reminder to create account -->
                <div class="account-reminder">
                    <p><i data-wo-icon="info"></i>
                        Recordá: podés <a href="/client/register" onclick="goToClientRegistration(); return false;">crear una cuenta</a>
                        en cualquier momento para ver el estado de tu cotización y chatear con el artista.
                    </p>
                </div>

                <!-- Action Buttons -->
                <div class="success-actions">
                    <button class="wo-btn wo-btn--hard btn-primary" onclick="resetQuotation()">
                        <i data-wo-icon="rotate-ccw" class="wo-icon-18"></i> Volver a cotizar
                    </button>
                    <a href="${resolveWebsiteUrl(websiteUrl)}" class="wo-btn wo-btn--ghost btn-secondary">
                        <i data-wo-icon="globe" class="wo-icon-18"></i> Conocer We Ötzi
                    </a>
                </div>

                <div class="social-links">
                    <a href="https://instagram.com/weotzi" target="_blank" class="social-btn">
                        <i data-wo-icon="instagram" class="wo-icon-18"></i> Seguir a We Ötzi
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
    currentBodyZone = null;
    currentBodySide = null;
    _calendarCursor = null;

    buildScreensConfig();
    currentStepIndex = Math.max(0, findNextScreenIndex(0));

    // Show the footbar again
    _setQuotationChromeVisible(true);

    renderCurrentStep();
    updateBackButton();

    _dbg('Quotation form reset');
}

function setupKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        // Enter en textarea = salto de línea; en el resto avanza la pantalla.
        const target = e.target;
        if (target && (target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
        const overlayOpen = document.querySelector('.q-login-overlay:not(.hidden), .draft-recovery-overlay:not(.hidden)');
        if (overlayOpen) return;

        const btn = document.getElementById('continue-btn');
        if (btn && !btn.disabled && !btn.classList.contains('hidden')) {
            e.preventDefault();
            btn.click();
        }
    });
}

// Solo la fecha de nacimiento usa flatpickr; la fecha preferida se dibuja con
// el calendario embebido del Figma (chips + mes).
function setupDatePicker(isSingle = true) {
    if (window.flatpickr && isSingle) {
        flatpickr('#date-picker-single', {
            mode: 'single', dateFormat: 'd M Y', maxDate: 'today', locale: 'es'
        });
    }
}

// Export global functions for onclick
window.confirmArtist = confirmArtist;
window.continueWithoutArtist = continueWithoutArtist;
window.nextStep = nextStep;
window.skipStep = skipStep;
window.prevStep = prevStep;
window.handleOptionSelect = handleOptionSelect;
window.handleBoolean = handleBoolean;
window.handleInstagramInput = handleInstagramInput;
window.selectDateChip = selectDateChip;
window.pickCalendarDay = pickCalendarDay;
window.shiftCalendarMonth = shiftCalendarMonth;
window.selectBudgetTier = selectBudgetTier;
window.checkCityMismatch = checkCityMismatch;
window.handleCitySelection = checkCityMismatch;
window.setTravel = setTravel;
window.confirmBodyParts = confirmBodyParts;
window.removeBodyPart = removeBodyPart;
window.skipReferences = skipReferences;
window.submitQuotation = submitQuotation;
window.resetQuotation = resetQuotation;
window.toggleTheme = toggleTheme;

// Draft Recovery Functions
window.continueDraft = continueDraft;
window.startNewQuotation = startNewQuotation;

// Body Selector
window.selectBodyZone = selectBodyZone;
window.handleSideChosen = handleSideChosen;

// ============ QUOTATION LOGIN MODAL ============

async function _detectClientSession() {
    if (!window.ClientAuth) return;
    try {
        const { session, client } = await window.ClientAuth.getSession();
        if (session && client) {
            _authenticatedUserId = session.user.id;
            _setHeaderLoggedIn(client.full_name || client.email);
        }
    } catch (e) {
        console.warn('Session detection skipped:', e.message);
    }
}

function _setHeaderLoggedIn(name) {
    const loginBtn = document.getElementById('header-login-btn');
    const userBtn = document.getElementById('header-user-btn');
    if (loginBtn) loginBtn.classList.add('hidden');
    if (userBtn) {
        userBtn.classList.remove('hidden');
        userBtn.title = name || 'Mi cuenta';
    }
}

function _setHeaderLoggedOut() {
    const loginBtn = document.getElementById('header-login-btn');
    const userBtn = document.getElementById('header-user-btn');
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (userBtn) userBtn.classList.add('hidden');
}

function openQuotationLoginModal() {
    if (_authenticatedUserId) {
        _showLoginSuccessView();
    } else {
        _showLoginFormView();
    }
    const overlay = document.getElementById('quotation-login-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        const emailInput = document.getElementById('q-login-email');
        if (emailInput && !_authenticatedUserId) setTimeout(() => emailInput.focus(), 200);
    }
}

function closeQuotationLoginModal() {
    const overlay = document.getElementById('quotation-login-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
        document.body.style.overflow = '';
    }
}

function _showLoginFormView() {
    const formView = document.getElementById('q-login-form-view');
    const successView = document.getElementById('q-login-success-view');
    if (formView) formView.classList.remove('hidden');
    if (successView) successView.classList.add('hidden');
    _clearLoginMessage();
}

function _showLoginSuccessView(name) {
    const formView = document.getElementById('q-login-form-view');
    const successView = document.getElementById('q-login-success-view');
    if (formView) formView.classList.add('hidden');
    if (successView) successView.classList.remove('hidden');
    const nameEl = document.getElementById('q-welcome-name');
    if (nameEl) nameEl.textContent = name || '';
}

function _showLoginMessage(msg, type) {
    const el = document.getElementById('q-login-message');
    if (!el) return;
    el.textContent = msg;
    el.className = 'q-form-message q-msg-' + type;
}

function _clearLoginMessage() {
    const el = document.getElementById('q-login-message');
    if (!el) return;
    el.textContent = '';
    el.className = 'q-form-message';
}

function _setLoginLoading(loading) {
    const btn = document.getElementById('q-btn-login');
    const textEl = btn?.querySelector('.q-btn-text');
    const spinnerEl = btn?.querySelector('.q-spinner');
    if (!btn) return;
    btn.disabled = loading;
    if (textEl) textEl.classList.toggle('hidden', loading);
    if (spinnerEl) spinnerEl.classList.toggle('hidden', !loading);
}

async function handleQuotationLogin(e) {
    e.preventDefault();
    const email = document.getElementById('q-login-email')?.value.trim().toLowerCase();
    const password = document.getElementById('q-login-password')?.value;

    _clearLoginMessage();

    if (!email || !password) {
        _showLoginMessage('Ingresá tu email y contraseña.', 'error');
        return;
    }

    _setLoginLoading(true);
    saveDraftToLocalStorage();

    try {
        const result = await window.ClientAuth.login(email, password);

        if (result.isArtist) {
            _showLoginMessage('Esta cuenta es de artista.', 'error');
            _setLoginLoading(false);
            return;
        }

        _authenticatedUserId = result.user.id;

        await window.ClientAuth.linkQuotations(
            result.user.id,
            email,
            formData.quote_id || null
        );

        _setHeaderLoggedIn(result.client?.full_name || email);
        _showLoginSuccessView(result.client?.full_name || email.split('@')[0]);

    } catch (error) {
        console.error('Quotation login error:', error);
        let msg = 'Error al iniciar sesión.';
        if (error.message?.includes('Invalid login credentials')) {
            msg = 'Email o contraseña incorrectos.';
        }
        _showLoginMessage(msg, 'error');
    } finally {
        _setLoginLoading(false);
    }
}

async function handleQuotationPasswordRecovery(e) {
    if (e) e.preventDefault();
    const email = document.getElementById('q-login-email')?.value.trim().toLowerCase();

    if (!email) {
        _showLoginMessage('Ingresá tu email para recuperar tu contraseña.', 'info');
        return;
    }

    _showLoginMessage('Procesando...', 'info');

    try {
        await window.ClientAuth.resetPassword(email);
        _showLoginMessage('Te enviamos un email con tu contraseña temporal.', 'success');
    } catch (error) {
        _showLoginMessage(error.message || 'Error al procesar la solicitud.', 'error');
    }
}

// Close modal on Escape key and overlay click
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeQuotationLoginModal();
});
document.addEventListener('click', (e) => {
    if (e.target?.id === 'quotation-login-overlay') closeQuotationLoginModal();
});

window.openQuotationLoginModal = openQuotationLoginModal;
window.closeQuotationLoginModal = closeQuotationLoginModal;
window.handleQuotationLogin = handleQuotationLogin;
window.handleQuotationPasswordRecovery = handleQuotationPasswordRecovery;
