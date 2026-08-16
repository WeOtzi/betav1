// ============================================
// WE OTZI - JOB BOARD REQUEST FORM
// 8-step wizard for publishing tattoo requests
// ============================================

// === STATE ===
let currentStep = 0;
let historyStack = [];
let formData = {};
let uploadedFiles = [];
let bodyPartsData = [];
let tattooStyles = [];
let isSubmitting = false;
let _supabase = null;

// Step definitions
const STEPS = [
    { id: 'welcome', title: null },
    { id: 'body-part', title: 'Zona del cuerpo', required: true },
    { id: 'description', title: 'Contá tu idea', required: true },
    { id: 'size', title: 'Tamaño aproximado', required: true },
    { id: 'style', title: 'Estilo', required: false },
    { id: 'color-refs', title: 'Color y referencias', required: false },
    { id: 'preferences', title: 'Preferencias', required: false },
    { id: 'account-gate', title: 'Publicá tu solicitud', required: true }
];

const DRAFT_KEY = 'weotzi_job_board_draft';
const MAX_FILES = 4;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
// Nota: convertIfHEIC corre antes de la validación, produciendo 'image/jpeg' para HEIC.
// Los tipos heic/heif se incluyen por si llegan antes de conversión.

// ============================================
// CONFIG MANAGER WAIT
// ============================================

async function waitForConfigManager(maxWait = 3000) {
    const start = Date.now();
    while (!window.ConfigManager && (Date.now() - start) < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!window.ConfigManager) {
        console.warn('ConfigManager not available, using defaults');
    }
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    await waitForConfigManager();
    _supabase = window.ConfigManager?.getSupabaseClient();
    await loadConfig();
    checkDraftResume();
    renderCurrentStep();
    setupKeyboardNav();
});

async function loadConfig() {
    // Load body parts from Supabase via ConfigManager
    if (window.ConfigManager && typeof window.ConfigManager.loadBodyPartsFromDB === 'function') {
        try {
            bodyPartsData = await window.ConfigManager.loadBodyPartsFromDB();
            console.log('Body parts loaded:', bodyPartsData.length, 'zones');
        } catch (err) {
            console.error('Error loading body parts:', err);
            bodyPartsData = [];
        }
    }

    // Load tattoo styles from Supabase
    if (_supabase) {
        try {
            const { data, error } = await WeotziData
                .from('tattoo_styles')
                .select('*')
                .is('parent_id', null)
                .order('sort_order');
            if (!error && data) {
                tattooStyles = data;
            }
        } catch (err) {
            console.error('Error loading tattoo styles:', err);
        }
    }
}

// ============================================
// DRAFT PERSISTENCE
// ============================================

function saveDraft() {
    try {
        const draft = {
            formData: formData,
            currentStep: currentStep,
            timestamp: Date.now()
        };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (e) {
        // localStorage full or unavailable
    }
}

function loadDraft() {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return null;
        const draft = JSON.parse(raw);
        // Expire drafts older than 7 days
        if (Date.now() - draft.timestamp > 7 * 24 * 60 * 60 * 1000) {
            clearDraft();
            return null;
        }
        return draft;
    } catch (e) {
        return null;
    }
}

function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
}

function checkDraftResume() {
    const draft = loadDraft();
    if (!draft || !draft.formData || Object.keys(draft.formData).length === 0) return;

    const container = document.getElementById('steps-container');
    if (!container) return;

    // Show resume prompt
    container.innerHTML = `
        <div class="jbr-step is-active" data-step="draft-resume">
            <div class="jbr-step-content jbr-center">
                <span class="wo-eyebrow">Borrador guardado</span>
                <h2 class="jbr-title">Tenés una solicitud en curso</h2>
                <p class="jbr-subtitle">Guardamos lo que cargaste. ¿Querés seguir donde la dejaste?</p>
                <div style="margin-top: var(--space-6); gap: var(--space-3); display: flex; justify-content: center; flex-wrap: wrap;">
                    <button type="button" class="wo-btn wo-btn--hard" onclick="resumeDraft()">Continuar borrador →</button>
                    <button type="button" class="wo-btn wo-btn--ghost" onclick="discardDraft()">Empezar de nuevo</button>
                </div>
            </div>
        </div>
    `;
}

window.resumeDraft = function() {
    const draft = loadDraft();
    if (draft) {
        formData = draft.formData || {};
        currentStep = draft.currentStep || 0;
        historyStack = [];
    }
    renderCurrentStep();
};

window.discardDraft = function() {
    clearDraft();
    formData = {};
    currentStep = 0;
    historyStack = [];
    renderCurrentStep();
};

// ============================================
// NAVIGATION
// ============================================

function goToStep(index) {
    if (index < 0 || index >= STEPS.length) return;
    historyStack.push(currentStep);
    currentStep = index;
    renderCurrentStep();
    saveDraft();
}

function goBack() {
    if (historyStack.length > 0) {
        currentStep = historyStack.pop();
        renderCurrentStep();
    }
}

function updateProgress() {
    const fill = document.getElementById('jb-progress-fill');
    const label = document.getElementById('jb-progress-label');
    if (!fill) return;

    const totalSteps = STEPS.length - 1;
    const pad2 = (n) => String(n).padStart(2, '0');

    if (currentStep === 0) {
        fill.style.width = '0%';
        if (label) label.textContent = '';
    } else {
        const pct = Math.round((currentStep / totalSteps) * 100);
        fill.style.width = pct + '%';
        if (label) label.textContent = `${pad2(currentStep)} / ${pad2(totalSteps)}`;
    }
}

function updateNavButtons() {
    const btnBack = document.getElementById('jb-btn-back');
    const btnNext = document.getElementById('jb-btn-next');
    const kbdHint = document.getElementById('jb-kbd-hint');

    if (btnBack) {
        btnBack.style.display = (currentStep === 0) ? 'none' : '';
        btnBack.onclick = () => goBack();
    }

    if (btnNext) {
        // Hide next on welcome (has its own CTA) and account-gate (has submit)
        if (currentStep === 0 || currentStep === STEPS.length - 1) {
            btnNext.style.display = 'none';
        } else {
            btnNext.style.display = '';
            btnNext.textContent = 'Siguiente →';
            btnNext.onclick = () => handleNext();
        }
    }

    if (kbdHint) {
        kbdHint.style.display = (currentStep === STEPS.length - 1) ? 'none' : '';
    }
}

function handleNext() {
    if (!validateCurrentStep()) return;
    goToStep(currentStep + 1);
}

function setupKeyboardNav() {
    document.addEventListener('keydown', (e) => {
        // Do not intercept if typing in textarea or input
        const tag = document.activeElement?.tagName;
        if (tag === 'TEXTAREA' || tag === 'INPUT') {
            if (e.key === 'Enter' && tag === 'INPUT' && !e.shiftKey) {
                e.preventDefault();
                handleNext();
            }
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            if (currentStep === 0) {
                goToStep(1);
            } else {
                handleNext();
            }
        }

        if (e.key === 'Escape') {
            goBack();
        }
    });
}

// ============================================
// RENDER ORCHESTRATOR
// ============================================

function renderCurrentStep() {
    const container = document.getElementById('steps-container');
    if (!container) return;

    container.innerHTML = '';

    const step = STEPS[currentStep];
    if (!step) return;

    const stepEl = document.createElement('div');
    stepEl.className = 'jbr-step is-active';
    stepEl.dataset.step = step.id;

    switch (step.id) {
        case 'welcome':       renderWelcome(stepEl); break;
        case 'body-part':     renderBodyPart(stepEl); break;
        case 'description':   renderDescription(stepEl); break;
        case 'size':          renderSize(stepEl); break;
        case 'style':         renderStyle(stepEl); break;
        case 'color-refs':    renderColorRefs(stepEl); break;
        case 'preferences':   renderPreferences(stepEl); break;
        case 'account-gate':  renderAccountGate(stepEl); break;
    }

    container.appendChild(stepEl);
    updateProgress();
    updateNavButtons();

    // Scroll to top of container
    container.scrollTop = 0;
}

// ============================================
// STEP 0 - WELCOME
// ============================================

function renderWelcome(el) {
    el.innerHTML = `
        <div class="jbr-step-content jbr-center">
            <h1 class="jbr-hero-title">¿Qué tatuaje tenés en mente?</h1>
            <p class="jbr-hero-subtitle">Contanos los detalles y dejá que los tatuadores te encuentren. Recibí propuestas, comparalas y elegí.</p>
            <div class="jbr-features">
                <div class="jbr-feature">
                    <i data-wo-icon="edit-3"></i>
                    <h3>Contá tu idea</h3>
                    <p>Describí el tatuaje que querés en pocos pasos.</p>
                </div>
                <div class="jbr-feature">
                    <i data-wo-icon="message-square"></i>
                    <h3>Recibí propuestas</h3>
                    <p>Los tatuadores interesados te mandan sus propuestas.</p>
                </div>
                <div class="jbr-feature">
                    <i data-wo-icon="check-circle"></i>
                    <h3>Elegí a tu artista</h3>
                    <p>Compará portfolios y elegí al que más te guste.</p>
                </div>
            </div>
            <button type="button" class="wo-btn wo-btn--accent wo-btn--hard wo-btn--block" style="max-width: 320px; margin: 0 auto;" onclick="goToStep(1)">Comenzar →</button>
        </div>
    `;
}

// ============================================
// STEP 1 - BODY PART
// ============================================

function renderBodyPart(el) {
    // bodyPartsData is a hierarchical tree: each item has { id, label, subparts: [...] }
    // Top-level items are the parent zones
    let zonesHtml = '';
    bodyPartsData.forEach(zone => {
        const zoneLabel = zone.label || zone.id;
        const isSelected = formData.tattoo_body_part_parent === zoneLabel;
        zonesHtml += `
            <div class="wo-chip ${isSelected ? 'is-active' : ''}" data-zone="${zoneLabel}" data-zone-id="${zone.id}" onclick="selectBodyZone(this)">${zoneLabel}</div>
        `;
    });

    el.innerHTML = `
        <div class="jbr-step-content">
            <h2 class="jbr-title">¿Dónde va el tatuaje?</h2>
            <p class="jbr-subtitle">Elegí la zona del cuerpo.</p>
            <span class="jbr-section-label">Parte del cuerpo</span>
            <div class="jbr-options" id="jb-body-zones">
                ${zonesHtml}
            </div>
            <div id="jb-body-subparts" class="jbr-subparts"></div>
        </div>
    `;

    // If there was a previous parent selection, render children
    if (formData.tattoo_body_part_parent) {
        renderBodySubParts(formData.tattoo_body_part_parent);
    }
}

window.selectBodyZone = function(card) {
    // Deselect all parent cards
    document.querySelectorAll('#jb-body-zones .wo-chip').forEach(c => c.classList.remove('is-active'));
    card.classList.add('is-active');

    const zoneName = card.dataset.zone;
    formData.tattoo_body_part_parent = zoneName;
    formData.tattoo_body_part = zoneName;
    formData.tattoo_body_side = null;

    renderBodySubParts(zoneName);
};

function renderBodySubParts(parentName) {
    const subContainer = document.getElementById('jb-body-subparts');
    if (!subContainer) return;

    // Find parent zone in the tree by label
    const parent = bodyPartsData.find(bp => (bp.label || bp.id) === parentName);
    if (!parent) {
        subContainer.innerHTML = '';
        return;
    }

    // Children are in the subparts array of the tree node
    const children = parent.subparts || [];
    if (children.length === 0) {
        subContainer.innerHTML = '';
        return;
    }

    let html = '<span class="jbr-section-label">Zona específica · opcional</span><div class="jbr-options">';
    children.forEach(child => {
        const childLabel = child.label || child.id;
        const isSelected = formData.tattoo_body_side === childLabel;
        html += `
            <div class="wo-chip ${isSelected ? 'is-active' : ''}" data-subpart="${childLabel}" onclick="selectBodySubPart(this)">${childLabel}</div>
        `;
    });
    html += '</div>';
    subContainer.innerHTML = html;
}

window.selectBodySubPart = function(card) {
    document.querySelectorAll('#jb-body-subparts .wo-chip').forEach(c => c.classList.remove('is-active'));
    card.classList.add('is-active');

    const subpartName = card.dataset.subpart;
    formData.tattoo_body_side = subpartName;
    formData.tattoo_body_part = formData.tattoo_body_part_parent + ' - ' + subpartName;
};

// ============================================
// STEP 2 - DESCRIPTION
// ============================================

function renderDescription(el) {
    const descVal = formData.tattoo_idea_description || '';
    const isFirst = formData.is_first_tattoo || false;
    const isCover = formData.is_cover_up || false;

    el.innerHTML = `
        <div class="jbr-step-content">
            <h2 class="jbr-title">Contá tu idea</h2>
            <p class="jbr-subtitle">Cuanto más detallada sea, mejor van a entender tu visión los tatuadores.</p>
            <div class="wo-field jbr-textarea-wrap">
                <label class="wo-label" for="jb-description">Descripción de la idea</label>
                <textarea id="jb-description" class="wo-textarea" maxlength="1000" placeholder="Ej.: quiero un lobo aullando, estilo blackwork, en el antebrazo. Busco líneas gruesas y buen contraste…">${descVal}</textarea>
                <div class="jbr-char-counter"><span id="jb-desc-count">${descVal.length}</span> / 1000</div>
            </div>
            <div class="jbr-checks">
                <label class="wo-check">
                    <input type="checkbox" id="jb-first-tattoo" ${isFirst ? 'checked' : ''}>
                    <span>Es mi primer tatuaje</span>
                </label>
                <label class="wo-check">
                    <input type="checkbox" id="jb-cover-up" ${isCover ? 'checked' : ''}>
                    <span>Es un cover-up</span>
                </label>
            </div>
        </div>
    `;

    const textarea = document.getElementById('jb-description');
    const counter = document.getElementById('jb-desc-count');
    if (textarea) {
        textarea.addEventListener('input', () => {
            formData.tattoo_idea_description = textarea.value;
            if (counter) counter.textContent = textarea.value.length;
            textarea.classList.remove('wo-input--error');
        });
        setTimeout(() => textarea.focus(), 100);
    }

    const firstCb = document.getElementById('jb-first-tattoo');
    if (firstCb) firstCb.addEventListener('change', () => { formData.is_first_tattoo = firstCb.checked; });

    const coverCb = document.getElementById('jb-cover-up');
    if (coverCb) coverCb.addEventListener('change', () => { formData.is_cover_up = coverCb.checked; });
}

// ============================================
// STEP 3 - SIZE
// ============================================

function renderSize(el) {
    const sizes = [
        { label: 'Pequeño', value: 'pequeno', subtitle: '< 5 cm' },
        { label: 'Mediano', value: 'mediano', subtitle: '5 – 15 cm' },
        { label: 'Grande', value: 'grande', subtitle: '15 – 30 cm' },
        { label: 'Muy grande', value: 'muy_grande', subtitle: '> 30 cm' }
    ];

    let cardsHtml = '';
    sizes.forEach(s => {
        const isSelected = formData.tattoo_size === s.value;
        cardsHtml += `
            <div class="jbr-card ${isSelected ? 'is-active' : ''}" data-value="${s.value}" onclick="selectSize(this)">
                <span class="jbr-card-label">${s.label}</span>
                <span class="jbr-card-sub">${s.subtitle}</span>
            </div>
        `;
    });

    el.innerHTML = `
        <div class="jbr-step-content">
            <h2 class="jbr-title">Tamaño aproximado</h2>
            <p class="jbr-subtitle">Elegí el tamaño estimado del tatuaje.</p>
            <div class="jbr-cards">
                ${cardsHtml}
            </div>
        </div>
    `;
}

window.selectSize = function(card) {
    document.querySelectorAll('.jbr-step[data-step="size"] .jbr-card').forEach(c => c.classList.remove('is-active'));
    card.classList.add('is-active');
    formData.tattoo_size = card.dataset.value;
};

// ============================================
// STEP 4 - STYLE
// ============================================

function renderStyle(el) {
    const selectedStyles = formData.tattoo_style ? (typeof formData.tattoo_style === 'string' ? JSON.parse(formData.tattoo_style) : formData.tattoo_style) : [];

    let cardsHtml = '';
    tattooStyles.forEach(style => {
        const isSelected = selectedStyles.includes(style.name);
        cardsHtml += `
            <div class="wo-chip ${isSelected ? 'is-active' : ''}" data-style="${style.name}" onclick="toggleStyle(this)">${style.name}</div>
        `;
    });

    el.innerHTML = `
        <div class="jbr-step-content">
            <h2 class="jbr-title">Estilo</h2>
            <p class="jbr-subtitle">Podés elegir uno o varios estilos · opcional.</p>
            <div class="jbr-options" id="jb-styles-grid">
                ${cardsHtml}
            </div>
            <button type="button" class="wo-btn wo-btn--ghost wo-btn--s jbr-skip" onclick="skipStep()">Saltar este paso →</button>
        </div>
    `;
}

window.toggleStyle = function(card) {
    card.classList.toggle('is-active');
    const styleName = card.dataset.style;

    let selected = formData.tattoo_style ? (typeof formData.tattoo_style === 'string' ? JSON.parse(formData.tattoo_style) : [...formData.tattoo_style]) : [];

    if (card.classList.contains('is-active')) {
        if (!selected.includes(styleName)) selected.push(styleName);
    } else {
        selected = selected.filter(s => s !== styleName);
    }

    formData.tattoo_style = selected;
};

window.skipStep = function() {
    goToStep(currentStep + 1);
};

// ============================================
// STEP 5 - COLOR + REFERENCES
// ============================================

function renderColorRefs(el) {
    const colorOptions = [
        { label: 'Blanco y negro', value: 'black_grey' },
        { label: 'Color', value: 'full_color' },
        { label: 'Sin preferencia', value: 'no_preference' }
    ];

    let colorHtml = '';
    colorOptions.forEach(opt => {
        const isSelected = formData.tattoo_color_type === opt.value;
        colorHtml += `
            <label class="wo-radio">
                <input type="radio" name="jb-color-type" value="${opt.value}" ${isSelected ? 'checked' : ''} onchange="selectColor(this)">
                <span>${opt.label}</span>
            </label>
        `;
    });

    // Render previews for already uploaded files
    let previewsHtml = '';
    uploadedFiles.forEach((file, idx) => {
        previewsHtml += `
            <div class="jbr-preview" data-index="${idx}">
                <img src="${URL.createObjectURL(file)}" alt="ref-${idx}">
                <button type="button" class="jbr-preview-remove" onclick="removeFile(${idx})" title="Eliminar"><i data-wo-icon="x" class="wo-icon-18"></i></button>
            </div>
        `;
    });

    el.innerHTML = `
        <div class="jbr-step-content">
            <h2 class="jbr-title">Color y referencias</h2>
            <p class="jbr-subtitle">Contanos cómo lo imaginás.</p>
            <span class="jbr-section-label">Color</span>
            <div class="jbr-radios">
                ${colorHtml}
            </div>
            <span class="jbr-section-label">Imágenes de referencia · opcional</span>
            <div class="wo-dropzone jbr-dropzone" id="jb-upload-area" onclick="triggerFileInput()" ondrop="handleDrop(event)" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)">
                <i data-wo-icon="upload"></i>
                <p class="jbr-dropzone-title">Arrastrá o hacé click</p>
                <p class="jbr-dropzone-help">JPG, PNG o WebP · máx. ${MAX_FILES} imágenes · 5MB cada una</p>
            </div>
            <input type="file" id="jb-file-input" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple style="display:none" onchange="handleFileSelect(event)">
            <div class="jbr-previews" id="jb-file-previews">
                ${previewsHtml}
            </div>
            <button type="button" class="wo-btn wo-btn--ghost wo-btn--s jbr-skip" onclick="skipStep()">Saltar este paso →</button>
        </div>
    `;
}

window.selectColor = function(input) {
    formData.tattoo_color_type = input.value;
};

window.triggerFileInput = function() {
    document.getElementById('jb-file-input')?.click();
};

window.handleFileSelect = function(e) {
    const files = Array.from(e.target.files || []);
    addFiles(files);
    e.target.value = '';
};

window.handleDragOver = function(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('jb-upload-area')?.classList.add('dragover');
};

window.handleDragLeave = function(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('jb-upload-area')?.classList.remove('dragover');
};

window.handleDrop = function(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('jb-upload-area')?.classList.remove('dragover');
    const files = Array.from(e.dataTransfer?.files || []);
    addFiles(files);
};

async function addFiles(files) {
    const remaining = MAX_FILES - uploadedFiles.length;
    if (remaining <= 0) {
        showFormNotice('Máximo ' + MAX_FILES + ' imágenes permitidas');
        return;
    }

    const filesToProcess = Array.from(files).slice(0, remaining);

    for (const file of filesToProcess) {
        // Convertir y comprimir ANTES de validar tipo y tamaño
        const converted = await convertIfHEIC(file);
        const compressed = await compressImage(converted);

        if (!ACCEPTED_IMAGE_TYPES.includes(compressed.type)) {
            showFormNotice('Solo se permiten imágenes JPG, PNG o WebP');
            continue;
        }
        if (compressed.size > MAX_FILE_SIZE) {
            showFormNotice('El archivo ' + file.name + ' supera los 5MB tras compresión');
            continue;
        }

        uploadedFiles.push(compressed);
    }

    renderFilePreviews();
}

window.removeFile = function(index) {
    uploadedFiles.splice(index, 1);
    renderFilePreviews();
};

function renderFilePreviews() {
    const container = document.getElementById('jb-file-previews');
    if (!container) return;

    container.innerHTML = '';
    uploadedFiles.forEach((file, idx) => {
        const div = document.createElement('div');
        div.className = 'jbr-preview';
        div.dataset.index = idx;
        div.innerHTML = `
            <img src="${URL.createObjectURL(file)}" alt="ref-${idx}">
            <button type="button" class="jbr-preview-remove" onclick="removeFile(${idx})" title="Eliminar"><i data-wo-icon="x" class="wo-icon-18"></i></button>
        `;
        container.appendChild(div);
    });
}

// ============================================
// STEP 6 - PREFERENCES
// ============================================

function renderPreferences(el) {
    const budgetMin = formData.budget_min || '';
    const budgetMax = formData.budget_max || '';
    const budgetCurrency = formData.budget_currency || 'USD';
    const cityVal = formData.client_city || '';
    const prefDate = formData.preferred_date || '';
    const flexDates = formData.flexible_dates || false;
    const travelWilling = formData.travel_willing || false;

    el.innerHTML = `
        <div class="jbr-step-content">
            <h2 class="jbr-title">Preferencias</h2>
            <p class="jbr-subtitle">Todo esto es opcional, pero ayuda a que te lleguen mejores propuestas.</p>

            <div class="jbr-form">
                <div class="wo-field">
                    <label class="wo-label">Presupuesto estimado</label>
                    <div class="jbr-budget-row">
                        <input type="number" id="jb-budget-min" class="wo-input" placeholder="Mín." value="${budgetMin}" min="0">
                        <span class="jbr-budget-sep">–</span>
                        <input type="number" id="jb-budget-max" class="wo-input" placeholder="Máx." value="${budgetMax}" min="0">
                        <select id="jb-budget-currency" class="wo-select">
                            ${['USD', 'EUR', 'ARS', 'MXN', 'COP', 'BRL'].map(c => `<option value="${c}" ${budgetCurrency === c ? 'selected' : ''}>${c}</option>`).join('')}
                        </select>
                    </div>
                </div>

                <div class="wo-field">
                    <label class="wo-label" for="city-input">Ciudad</label>
                    <input type="text" id="city-input" class="wo-input" placeholder="Tu ciudad" value="${cityVal}" autocomplete="off">
                </div>

                <div class="wo-field">
                    <label class="wo-label" for="jb-pref-date">Fecha aproximada</label>
                    <input type="month" id="jb-pref-date" class="wo-input" value="${prefDate}">
                </div>

                <div class="jbr-checks">
                    <label class="wo-check">
                        <input type="checkbox" id="jb-flexible-dates" ${flexDates ? 'checked' : ''}>
                        <span>Fechas flexibles</span>
                    </label>
                    <label class="wo-check">
                        <input type="checkbox" id="jb-travel-willing" ${travelWilling ? 'checked' : ''}>
                        <span>Puedo viajar</span>
                    </label>
                </div>
            </div>

            <button type="button" class="wo-btn wo-btn--ghost wo-btn--s jbr-skip" onclick="skipStep()">Saltar este paso →</button>
        </div>
    `;

    // Bind inputs
    const budgetMinEl = document.getElementById('jb-budget-min');
    const budgetMaxEl = document.getElementById('jb-budget-max');
    const currencyEl = document.getElementById('jb-budget-currency');
    const cityEl = document.getElementById('city-input');
    const dateEl = document.getElementById('jb-pref-date');
    const flexEl = document.getElementById('jb-flexible-dates');
    const travelEl = document.getElementById('jb-travel-willing');

    if (budgetMinEl) budgetMinEl.addEventListener('input', () => { formData.budget_min = budgetMinEl.value; });
    if (budgetMaxEl) budgetMaxEl.addEventListener('input', () => { formData.budget_max = budgetMaxEl.value; });
    if (currencyEl) currencyEl.addEventListener('change', () => { formData.budget_currency = currencyEl.value; });
    if (cityEl) cityEl.addEventListener('input', () => { formData.client_city = cityEl.value; });
    if (dateEl) dateEl.addEventListener('change', () => { formData.preferred_date = dateEl.value; });
    if (flexEl) flexEl.addEventListener('change', () => { formData.flexible_dates = flexEl.checked; });
    if (travelEl) travelEl.addEventListener('change', () => { formData.travel_willing = travelEl.checked; });

    // Google Places Autocomplete if available
    if (cityEl && typeof google !== 'undefined' && google.maps && google.maps.places) {
        try {
            const autocomplete = new google.maps.places.Autocomplete(cityEl, {
                types: ['(cities)'],
                fields: ['formatted_address', 'address_components']
            });
            autocomplete.addListener('place_changed', () => {
                const place = autocomplete.getPlace();
                if (place && place.formatted_address) {
                    cityEl.value = place.formatted_address;
                    formData.client_city = place.formatted_address;

                    if (place.address_components) {
                        const locality = place.address_components.find(c => c.types.includes('locality'));
                        const country = place.address_components.find(c => c.types.includes('country'));
                        formData.client_city_name = locality ? locality.long_name : '';
                        formData.client_country = country ? country.long_name : '';
                    }
                }
            });
        } catch (e) {
            // Google Places not available - degrade gracefully
        }
    }
}

// ============================================
// STEP 7 - ACCOUNT GATE
// ============================================

async function renderAccountGate(el) {
    el.innerHTML = '<div class="jbr-step-content jbr-center" style="display:flex;flex-direction:column;align-items:center;gap:var(--space-4);padding-top:var(--space-12);"><div class="wo-spinner"></div><p class="wo-meta">Verificando sesión…</p></div>';

    if (!_supabase) {
        renderAuthContainer(el);
        return;
    }

    try {
        const { data: { session } } = await _supabase.auth.getSession();

        if (session) {
            // Check if client profile exists
            const { data: client } = await WeotziData.Clients.getByUserId(session.user.id);

            if (client) {
                formData._user_id = session.user.id;
                formData._client_email = client.email || session.user.email;
                formData._client_name = client.full_name || '';
                renderSummaryAndSubmit(el, session, client);
            } else {
                // User is logged in but not a client - maybe an artist
                // Create a client profile entry
                formData._user_id = session.user.id;
                formData._client_email = session.user.email;
                formData._client_name = session.user.user_metadata?.full_name || session.user.email.split('@')[0];
                renderSummaryAndSubmit(el, session, null);
            }
        } else {
            renderAuthContainer(el);
        }
    } catch (err) {
        console.error('Error checking session:', err);
        renderAuthContainer(el);
    }
}

function renderAuthContainer(el) {
    el.innerHTML = `
        <div class="jbr-step-content">
            <h2 class="jbr-title">Publicá tu solicitud</h2>
            <p class="jbr-subtitle">Necesitás una cuenta para publicarla y recibir propuestas.</p>

            <div class="wo-tabs jbr-auth-tabs">
                <button type="button" class="wo-tab is-active" data-tab="register" onclick="switchAuthTab('register')">Crear cuenta</button>
                <button type="button" class="wo-tab" data-tab="login" onclick="switchAuthTab('login')">Iniciar sesión</button>
            </div>

            <div id="jb-auth-register" class="jbr-auth-panel is-active">
                <div class="wo-field">
                    <label class="wo-label" for="jb-reg-name">Nombre completo</label>
                    <input type="text" id="jb-reg-name" class="wo-input" placeholder="Tu nombre" autocomplete="name">
                </div>
                <div class="wo-field">
                    <label class="wo-label" for="jb-reg-email">Email</label>
                    <input type="email" id="jb-reg-email" class="wo-input" placeholder="tu@email.com" autocomplete="email">
                </div>
                <div class="wo-field">
                    <label class="wo-label" for="jb-reg-password">Contraseña</label>
                    <input type="password" id="jb-reg-password" class="wo-input" placeholder="Mínimo 6 caracteres" autocomplete="new-password">
                </div>
                <div class="wo-field">
                    <label class="wo-label" for="jb-reg-confirm">Confirmar contraseña</label>
                    <input type="password" id="jb-reg-confirm" class="wo-input" placeholder="Repetí tu contraseña" autocomplete="new-password">
                </div>
                <div id="jb-reg-message" class="jbr-msg"></div>
                <button type="button" class="wo-btn wo-btn--hard wo-btn--block" id="jb-btn-register" onclick="handleJBRegister()">Crear cuenta y publicar</button>
            </div>

            <div id="jb-auth-login" class="jbr-auth-panel">
                <div class="wo-field">
                    <label class="wo-label" for="jb-login-email">Email</label>
                    <input type="email" id="jb-login-email" class="wo-input" placeholder="tu@email.com" autocomplete="email">
                </div>
                <div class="wo-field">
                    <label class="wo-label" for="jb-login-password">Contraseña</label>
                    <input type="password" id="jb-login-password" class="wo-input" placeholder="Tu contraseña" autocomplete="current-password">
                </div>
                <div id="jb-login-message" class="jbr-msg"></div>
                <button type="button" class="wo-btn wo-btn--hard wo-btn--block" id="jb-btn-login" onclick="handleJBLogin()">Iniciar sesión y publicar</button>
            </div>
        </div>
    `;
}

window.switchAuthTab = function(tab) {
    document.querySelectorAll('.jbr-auth-tabs .wo-tab').forEach(t => t.classList.remove('is-active'));
    document.querySelector(`.jbr-auth-tabs .wo-tab[data-tab="${tab}"]`)?.classList.add('is-active');

    document.getElementById('jb-auth-register').classList.toggle('is-active', tab === 'register');
    document.getElementById('jb-auth-login').classList.toggle('is-active', tab === 'login');
};

// ============================================
// AUTH HANDLERS
// ============================================

window.handleJBRegister = async function() {
    if (!_supabase) {
        showFormNotice('Servicio no disponible. Recargá la página.');
        return;
    }

    const btn = document.getElementById('jb-btn-register');
    const msgEl = document.getElementById('jb-reg-message');
    const name = document.getElementById('jb-reg-name')?.value.trim();
    const email = document.getElementById('jb-reg-email')?.value.trim().toLowerCase();
    const password = document.getElementById('jb-reg-password')?.value;
    const confirm = document.getElementById('jb-reg-confirm')?.value;

    if (msgEl) { msgEl.textContent = ''; msgEl.className = 'jbr-msg'; }

    if (!name || !email || !password) {
        showAuthMessage('jb-reg-message', 'Completá todos los campos obligatorios.', 'error');
        return;
    }
    if (password !== confirm) {
        showAuthMessage('jb-reg-message', 'Las contraseñas no coinciden.', 'error');
        return;
    }
    if (password.length < 6) {
        showAuthMessage('jb-reg-message', 'La contraseña tiene que tener al menos 6 caracteres.', 'error');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Creando cuenta…';

    try {
        const { data: authData, error: authError } = await _supabase.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    full_name: name,
                    user_type: 'client'
                },
                emailRedirectTo: window.location.origin + '/client/dashboard'
            }
        });

        if (authError) throw authError;

        if (authData.user) {
            // Insert client profile
            const { error: insertError } = await WeotziData.Clients.insert({
                    user_id: authData.user.id,
                    email: email,
                    full_name: name,
                    email_verified: false
                });

            if (insertError) {
                console.error('Error creating client profile:', insertError);
            }

            // Sign in to establish session
            const { error: signInError } = await _supabase.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (signInError) {
                console.warn('Could not auto-login after signup:', signInError.message);
            }

            // Trigger n8n event
            if (window.ConfigManager && typeof window.ConfigManager.sendN8NEvent === 'function') {
                try {
                    await window.ConfigManager.sendN8NEvent('client_registration_completed', {
                        email: email,
                        user_id: authData.user.id,
                        full_name: name,
                        source: 'job_board',
                        dashboard_url: window.location.origin + '/client/dashboard'
                    });
                } catch (webhookErr) {
                    console.warn('Could not send client_registration_completed event:', webhookErr);
                }
            }

            formData._user_id = authData.user.id;
            formData._client_email = email;
            formData._client_name = name;

            showAuthMessage('jb-reg-message', 'Cuenta creada.', 'success');

            // Re-render as logged-in user with summary
            setTimeout(() => {
                renderAccountGate(document.querySelector('.jbr-step[data-step="account-gate"]'));
            }, 800);
        }

    } catch (error) {
        console.error('Registration error:', error);
        btn.disabled = false;
        btn.textContent = 'Crear cuenta y publicar';

        let errorMessage = 'Error al crear la cuenta.';
        if (error.message?.includes('already registered')) {
            errorMessage = 'Este email ya está registrado. Probá iniciar sesión.';
        }
        showAuthMessage('jb-reg-message', errorMessage, 'error');
    }
};

window.handleJBLogin = async function() {
    if (!_supabase) {
        showFormNotice('Servicio no disponible. Recargá la página.');
        return;
    }

    const btn = document.getElementById('jb-btn-login');
    const email = document.getElementById('jb-login-email')?.value.trim().toLowerCase();
    const password = document.getElementById('jb-login-password')?.value;

    if (!email || !password) {
        showAuthMessage('jb-login-message', 'Ingresá tu email y contraseña.', 'error');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Validando…';

    try {
        const { data, error } = await _supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;

        // Check or create client profile
        const { data: client } = await WeotziData.Clients.getByUserId(data.user.id);

        if (!client) {
            // Create client profile
            await WeotziData.Clients.insert({
                    user_id: data.user.id,
                    email: email,
                    full_name: data.user.user_metadata?.full_name || email.split('@')[0],
                    email_verified: data.user.email_confirmed_at ? true : false
                });
        }

        formData._user_id = data.user.id;
        formData._client_email = client?.email || email;
        formData._client_name = client?.full_name || data.user.user_metadata?.full_name || '';

        showAuthMessage('jb-login-message', 'Sesión iniciada.', 'success');

        // Re-render as logged-in user
        setTimeout(() => {
            renderAccountGate(document.querySelector('.jbr-step[data-step="account-gate"]'));
        }, 800);

    } catch (error) {
        console.error('Login error:', error);
        btn.disabled = false;
        btn.textContent = 'Iniciar sesión y publicar';

        let errorMessage = 'Error al iniciar sesión.';
        if (error.message?.includes('Invalid login credentials')) {
            errorMessage = 'Email o contraseña incorrectos.';
        }
        showAuthMessage('jb-login-message', errorMessage, 'error');
    }
};

function showAuthMessage(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.className = 'jbr-msg jbr-msg--' + type;
}

// ============================================
// SUMMARY CARD + SUBMIT
// ============================================

function renderSummaryAndSubmit(el, session, client) {
    const styleDisplay = formatStyleDisplay();
    const colorDisplay = formatColorDisplay();
    const sizeDisplay = formatSizeDisplay();
    const budgetDisplay = formatBudgetDisplay();

    const summaryItem = (label, value) => `
        <div class="jbr-summary-item">
            <dt>${label}</dt>
            <dd>${value}</dd>
        </div>
    `;

    let refsHtml = '';
    if (uploadedFiles.length > 0) {
        refsHtml = '<div class="jbr-summary-refs">' + uploadedFiles.map((file, idx) =>
            `<img src="${URL.createObjectURL(file)}" alt="Referencia ${idx + 1}">`
        ).join('') + '</div>';
    }

    el.innerHTML = `
        <div class="jbr-step-content">
            <h2 class="jbr-title">Revisá tu publicación</h2>
            <p class="jbr-subtitle">Así la van a ver los tatuadores en el Job Board.</p>

            <div class="jbr-summary">
                <span class="jbr-summary-eyebrow">Tu idea</span>
                <p class="jbr-summary-desc">${escapeHtml(formData.tattoo_idea_description || '–')}</p>
                ${refsHtml}
                <dl class="jbr-summary-grid">
                    ${summaryItem('Zona del cuerpo', escapeHtml(formData.tattoo_body_part || '–'))}
                    ${summaryItem('Tamaño', sizeDisplay)}
                    ${summaryItem('Estilo', escapeHtml(styleDisplay))}
                    ${summaryItem('Color', colorDisplay)}
                    ${summaryItem('Referencias', uploadedFiles.length > 0 ? uploadedFiles.length + (uploadedFiles.length === 1 ? ' imagen' : ' imágenes') : 'Ninguna')}
                    ${budgetDisplay ? summaryItem('Presupuesto', budgetDisplay) : ''}
                    ${formData.client_city ? summaryItem('Ciudad', escapeHtml(formData.client_city)) : ''}
                    ${formData.preferred_date ? summaryItem('Fecha', `${formData.preferred_date}${formData.flexible_dates ? ' · flexible' : ''}`) : ''}
                    ${formData.is_first_tattoo ? summaryItem('Primer tatuaje', 'Sí') : ''}
                    ${formData.is_cover_up ? summaryItem('Cover-up', 'Sí') : ''}
                    ${formData.travel_willing ? summaryItem('Viaje', 'Puedo viajar') : ''}
                </dl>
            </div>

            <div class="jbr-submit-row">
                <p class="jbr-logged-as">Publicás como <strong>${escapeHtml(formData._client_name || formData._client_email)}</strong></p>
                <div class="jbr-submit-actions">
                    <button type="button" class="wo-btn wo-btn--ghost" onclick="goBack()">← Editar</button>
                    <button type="button" class="wo-btn wo-btn--direct wo-btn--hard" id="jb-btn-submit" onclick="submitRequest()">Publicar solicitud →</button>
                </div>
            </div>
        </div>
    `;
}

function formatStyleDisplay() {
    const styles = formData.tattoo_style;
    if (!styles || (Array.isArray(styles) && styles.length === 0)) return 'Sin preferencia';
    if (Array.isArray(styles)) return styles.join(', ');
    return styles;
}

function formatColorDisplay() {
    const map = {
        'full_color': 'Color',
        'black_grey': 'Blanco y negro',
        'no_preference': 'Sin preferencia'
    };
    return map[formData.tattoo_color_type] || 'Sin preferencia';
}

function formatSizeDisplay() {
    const map = {
        'pequeno': 'Pequeño (< 5 cm)',
        'mediano': 'Mediano (5 – 15 cm)',
        'grande': 'Grande (15 – 30 cm)',
        'muy_grande': 'Muy grande (> 30 cm)'
    };
    return map[formData.tattoo_size] || '–';
}

function formatBudgetDisplay() {
    if (!formData.budget_min && !formData.budget_max) return '';
    const currency = formData.budget_currency || 'USD';
    if (formData.budget_min && formData.budget_max) {
        return `$${formData.budget_min} – $${formData.budget_max} ${currency}`;
    }
    if (formData.budget_min) return `Desde $${formData.budget_min} ${currency}`;
    if (formData.budget_max) return `Hasta $${formData.budget_max} ${currency}`;
    return '';
}

// ============================================
// SUBMIT REQUEST
// ============================================

window.submitRequest = async function() {
    if (isSubmitting) return;
    if (!_supabase) {
        showFormNotice('Servicio no disponible. Recargá la página.');
        return;
    }
    isSubmitting = true;

    const btn = document.getElementById('jb-btn-submit');
    const overlay = document.getElementById('loading-overlay');

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Publicando…';
    }
    if (overlay) overlay.classList.remove('hidden');

    try {
        const tempId = crypto.randomUUID ? crypto.randomUUID() : generateTempId();

        // 1. Upload reference images to Supabase Storage
        const attachmentPaths = [];
        for (let i = 0; i < uploadedFiles.length; i++) {
            const file = uploadedFiles[i];
            const ext = file.name.split('.').pop() || 'jpg';
            const filePath = `${tempId}/ref_${i}.${ext}`;

            const { error: uploadError } = await _supabase.storage
                .from('job-board-references')
                .upload(filePath, file, {
                    contentType: file.type,
                    upsert: false
                });

            if (uploadError) {
                console.error('File upload error:', uploadError);
            } else {
                attachmentPaths.push(filePath);
            }
        }

        // 2. Build the styles value
        let stylesValue = null;
        if (formData.tattoo_style && Array.isArray(formData.tattoo_style) && formData.tattoo_style.length > 0) {
            stylesValue = JSON.stringify(formData.tattoo_style);
        }

        // 3. Insert into job_board_requests
        const requestPayload = {
            client_user_id: formData._user_id,
            tattoo_body_part: formData.tattoo_body_part || null,
            tattoo_body_side: formData.tattoo_body_side || null,
            tattoo_idea_description: formData.tattoo_idea_description || null,
            tattoo_size: formData.tattoo_size || null,
            tattoo_style: stylesValue,
            tattoo_color_type: formData.tattoo_color_type || null,
            tattoo_is_first_tattoo: !!formData.is_first_tattoo,
            tattoo_is_cover_up: !!formData.is_cover_up,
            client_budget_min: formData.budget_min ? parseFloat(formData.budget_min) : null,
            client_budget_max: formData.budget_max ? parseFloat(formData.budget_max) : null,
            client_budget_currency: formData.budget_currency || 'USD',
            client_city: formData.client_city || null,
            client_country: formData.client_country || null,
            client_preferred_date: formData.preferred_date || null,
            client_flexible_dates: formData.flexible_dates || 'No',
            client_travel_willing: formData.travel_willing || false,
            status: 'open'
        };

        const { data: insertedRequest, error: insertError } = await WeotziData
            .from('job_board_requests')
            .insert(requestPayload)
            .select()
            .single();

        if (insertError) throw insertError;

        // 4. Insert attachments records
        if (attachmentPaths.length > 0 && insertedRequest) {
            const attachmentRecords = attachmentPaths.map((path, i) => {
                const { data: urlData } = _supabase.storage
                    .from('job-board-references')
                    .getPublicUrl(path);
                return {
                    request_id: insertedRequest.id,
                    storage_path: path,
                    file_url: urlData?.publicUrl || '',
                    file_name: uploadedFiles[i]?.name || `ref_${i}.jpg`,
                    mime_type: uploadedFiles[i]?.type || 'image/jpeg',
                    file_size: uploadedFiles[i]?.size || 0,
                    sort_order: i
                };
            });

            const { error: attachError } = await WeotziData
                .from('job_board_attachments')
                .insert(attachmentRecords);

            if (attachError) {
                console.error('Error inserting attachments:', attachError);
            }
        }

        // 5. Trigger n8n event
        if (window.ConfigManager && typeof window.ConfigManager.sendN8NEvent === 'function') {
            try {
                await window.ConfigManager.sendN8NEvent('job_board_request_created', {
                    request_id: insertedRequest.id,
                    request_code: insertedRequest.request_code || null,
                    client_user_id: formData._user_id,
                    client_email: formData._client_email,
                    client_name: formData._client_name,
                    tattoo_body_part: formData.tattoo_body_part,
                    tattoo_idea_description: formData.tattoo_idea_description,
                    tattoo_size: formData.tattoo_size,
                    tattoo_style: formData.tattoo_style,
                    tattoo_color_type: formData.tattoo_color_type,
                    is_first_tattoo: !!formData.is_first_tattoo,
                    is_cover_up: !!formData.is_cover_up,
                    budget_min: formData.budget_min || null,
                    budget_max: formData.budget_max || null,
                    budget_currency: formData.budget_currency || 'USD',
                    client_city: formData.client_city || null,
                    preferred_date: formData.preferred_date || null,
                    flexible_dates: formData.flexible_dates || false,
                    travel_willing: formData.travel_willing || false,
                    reference_images_count: attachmentPaths.length,
                    dashboard_url: window.location.origin + '/client/dashboard?tab=solicitudes'
                });
                console.log('n8n event sent: job_board_request_created');
            } catch (webhookErr) {
                console.warn('Could not send job_board_request_created event:', webhookErr);
            }
        }

        // 6. Clear draft
        clearDraft();

        // 7. Redirect to client dashboard
        if (overlay) overlay.classList.add('hidden');
        if (btn) btn.textContent = 'Solicitud publicada';

        console.log('Job board request submitted successfully:', insertedRequest.id);

        setTimeout(() => {
            window.location.href = '/client/dashboard?tab=solicitudes';
        }, 1500);

    } catch (error) {
        console.error('Error submitting request:', error);
        isSubmitting = false;
        if (overlay) overlay.classList.add('hidden');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Publicar solicitud →';
        }
        showFormNotice('No pudimos publicar la solicitud. Probá de nuevo.');
    }
};

function generateTempId() {
    return 'jb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// ============================================
// VALIDATION
// ============================================

function validateCurrentStep() {
    const step = STEPS[currentStep];
    if (!step) return true;

    switch (step.id) {
        case 'welcome':
            return true;

        case 'body-part':
            if (!formData.tattoo_body_part) {
                shakeElement('#jb-body-zones');
                showFormNotice('Elegí una zona del cuerpo');
                return false;
            }
            return true;

        case 'description':
            // Sync current textarea value before validating
            syncDescriptionField();
            if (!formData.tattoo_idea_description || formData.tattoo_idea_description.trim().length < 10) {
                showFormNotice('La descripción tiene que tener al menos 10 caracteres');
                const textarea = document.getElementById('jb-description');
                if (textarea) textarea.classList.add('wo-input--error');
                return false;
            }
            return true;

        case 'size':
            if (!formData.tattoo_size) {
                shakeElement('.jbr-step[data-step="size"] .jbr-cards');
                showFormNotice('Elegí un tamaño');
                return false;
            }
            return true;

        case 'style':
            // Optional - always valid
            return true;

        case 'color-refs':
            // Optional - always valid
            return true;

        case 'preferences':
            // Sync all preferences fields before proceeding
            syncPreferencesFields();
            return true;

        case 'account-gate':
            return true;

        default:
            return true;
    }
}

function syncDescriptionField() {
    const textarea = document.getElementById('jb-description');
    if (textarea) {
        formData.tattoo_idea_description = textarea.value;
    }
    const firstCb = document.getElementById('jb-first-tattoo');
    if (firstCb) formData.is_first_tattoo = firstCb.checked;
    const coverCb = document.getElementById('jb-cover-up');
    if (coverCb) formData.is_cover_up = coverCb.checked;
}

function syncPreferencesFields() {
    const fields = {
        'jb-budget-min': 'budget_min',
        'jb-budget-max': 'budget_max',
        'jb-budget-currency': 'budget_currency',
        'city-input': 'client_city',
        'jb-pref-date': 'preferred_date'
    };

    Object.entries(fields).forEach(([elId, key]) => {
        const el = document.getElementById(elId);
        if (el) formData[key] = el.value;
    });

    const flexEl = document.getElementById('jb-flexible-dates');
    if (flexEl) formData.flexible_dates = flexEl.checked;
    const travelEl = document.getElementById('jb-travel-willing');
    if (travelEl) formData.travel_willing = travelEl.checked;
}

// ============================================
// UI HELPERS
// ============================================

function shakeElement(selector) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.style.animation = 'jbr-shake 0.5s ease';
    setTimeout(() => { el.style.animation = ''; }, 500);
}

function showFormNotice(message) {
    // Use a simple toast-like notice
    let notice = document.getElementById('jb-notice');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'jb-notice';
        notice.className = 'jbr-notice';
        document.body.appendChild(notice);
    }
    notice.textContent = message;
    notice.classList.add('is-visible');
    setTimeout(() => {
        notice.classList.remove('is-visible');
    }, 3000);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
}

// ============================================
// EXPORT GLOBALS (onclick handlers in HTML)
// ============================================

window.goToStep = goToStep;
window.goBack = goBack;
window.handleNext = handleNext;
