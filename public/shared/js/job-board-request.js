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
    { id: 'description', title: 'Describe tu idea', required: true },
    { id: 'size', title: 'Tamano del tatuaje', required: true },
    { id: 'style', title: 'Estilo', required: false },
    { id: 'color-refs', title: 'Color y referencias', required: false },
    { id: 'preferences', title: 'Preferencias', required: false },
    { id: 'account-gate', title: 'Publicar solicitud', required: true }
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
        <div class="jb-step active" data-step="draft-resume">
            <div class="jb-step-content jb-center">
                <h2 class="jb-title">Tienes un borrador guardado</h2>
                <p class="jb-subtitle">Encontramos una solicitud en progreso. Quieres continuar donde la dejaste?</p>
                <div class="jb-actions-row" style="margin-top: 2rem; gap: 1rem; display: flex; justify-content: center; flex-wrap: wrap;">
                    <button class="jb-btn jb-btn-primary" onclick="resumeDraft()">Continuar borrador</button>
                    <button class="jb-btn jb-btn-secondary" onclick="discardDraft()">Empezar de nuevo</button>
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

    if (currentStep === 0) {
        fill.style.width = '0%';
        if (label) label.textContent = '';
    } else {
        const pct = Math.round((currentStep / (STEPS.length - 1)) * 100);
        fill.style.width = pct + '%';
        if (label) label.textContent = `${currentStep} / ${STEPS.length - 1}`;
    }
}

function updateNavButtons() {
    const btnBack = document.getElementById('jb-btn-back');
    const btnNext = document.getElementById('jb-btn-next');

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
            btnNext.textContent = 'Siguiente';
            btnNext.onclick = () => handleNext();
        }
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
    stepEl.className = 'jb-step active';
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
        <div class="jb-step-content jb-center">
            <h1 class="jb-hero-title">Publica tu solicitud de tatuaje</h1>
            <p class="jb-hero-subtitle">Describe tu idea y deja que los artistas te encuentren. Recibe propuestas, compara y elige.</p>
            <div class="jb-features-row">
                <div class="jb-feature-card">
                    <div class="jb-feature-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                    </div>
                    <h3>Describe tu idea</h3>
                    <p>Cuentanos que tatuaje quieres en pocos pasos</p>
                </div>
                <div class="jb-feature-card">
                    <div class="jb-feature-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    </div>
                    <h3>Recibe propuestas</h3>
                    <p>Artistas interesados te enviaran sus propuestas</p>
                </div>
                <div class="jb-feature-card">
                    <div class="jb-feature-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    </div>
                    <h3>Elige tu artista</h3>
                    <p>Compara portfolios y elige al que mas te guste</p>
                </div>
            </div>
            <button class="jb-btn jb-btn-primary jb-btn-lg" onclick="goToStep(1)">Comenzar</button>
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
            <div class="jb-option-card ${isSelected ? 'selected' : ''}" data-zone="${zoneLabel}" data-zone-id="${zone.id}" onclick="selectBodyZone(this)">
                <span class="jb-option-label">${zoneLabel}</span>
            </div>
        `;
    });

    el.innerHTML = `
        <div class="jb-step-content">
            <h2 class="jb-title">Donde te gustaria el tatuaje?</h2>
            <p class="jb-subtitle">Selecciona la zona del cuerpo</p>
            <div class="jb-options-grid cols-3" id="jb-body-zones">
                ${zonesHtml}
            </div>
            <div id="jb-body-subparts" class="jb-subparts-container"></div>
        </div>
    `;

    // If there was a previous parent selection, render children
    if (formData.tattoo_body_part_parent) {
        renderBodySubParts(formData.tattoo_body_part_parent);
    }
}

window.selectBodyZone = function(card) {
    // Deselect all parent cards
    document.querySelectorAll('#jb-body-zones .jb-option-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');

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

    let html = '<p class="jb-subparts-label">Selecciona la zona especifica (opcional)</p><div class="jb-options-grid cols-3">';
    children.forEach(child => {
        const childLabel = child.label || child.id;
        const isSelected = formData.tattoo_body_side === childLabel;
        html += `
            <div class="jb-option-card jb-option-sm ${isSelected ? 'selected' : ''}" data-subpart="${childLabel}" onclick="selectBodySubPart(this)">
                <span class="jb-option-label">${childLabel}</span>
            </div>
        `;
    });
    html += '</div>';
    subContainer.innerHTML = html;
}

window.selectBodySubPart = function(card) {
    document.querySelectorAll('#jb-body-subparts .jb-option-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');

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
        <div class="jb-step-content">
            <h2 class="jb-title">Describe tu idea</h2>
            <p class="jb-subtitle">Se lo mas detallado posible para que los artistas entiendan tu vision</p>
            <div class="jb-textarea-wrapper">
                <textarea id="jb-description" class="jb-textarea" maxlength="1000" placeholder="Describe la idea de tu tatuaje... Se lo mas detallado posible">${descVal}</textarea>
                <div class="jb-char-counter"><span id="jb-desc-count">${descVal.length}</span> / 1000</div>
            </div>
            <div class="jb-checkboxes" style="margin-top: 1.5rem;">
                <label class="jb-checkbox-label">
                    <input type="checkbox" id="jb-first-tattoo" ${isFirst ? 'checked' : ''}>
                    <span>Es mi primer tatuaje</span>
                </label>
                <label class="jb-checkbox-label">
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
        { label: 'Pequeno', value: 'pequeno', subtitle: '< 5cm' },
        { label: 'Mediano', value: 'mediano', subtitle: '5 - 15cm' },
        { label: 'Grande', value: 'grande', subtitle: '15 - 30cm' },
        { label: 'Muy Grande', value: 'muy_grande', subtitle: '> 30cm' }
    ];

    let cardsHtml = '';
    sizes.forEach(s => {
        const isSelected = formData.tattoo_size === s.value;
        cardsHtml += `
            <div class="jb-option-card ${isSelected ? 'selected' : ''}" data-value="${s.value}" onclick="selectSize(this)">
                <span class="jb-option-label">${s.label}</span>
                <span class="jb-option-sub">${s.subtitle}</span>
            </div>
        `;
    });

    el.innerHTML = `
        <div class="jb-step-content">
            <h2 class="jb-title">Tamano del tatuaje</h2>
            <p class="jb-subtitle">Selecciona el tamano aproximado</p>
            <div class="jb-options-grid cols-2">
                ${cardsHtml}
            </div>
        </div>
    `;
}

window.selectSize = function(card) {
    document.querySelectorAll('.jb-step[data-step="size"] .jb-option-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
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
            <div class="jb-option-card jb-option-multi ${isSelected ? 'selected' : ''}" data-style="${style.name}" onclick="toggleStyle(this)">
                <span class="jb-option-label">${style.name}</span>
            </div>
        `;
    });

    el.innerHTML = `
        <div class="jb-step-content">
            <h2 class="jb-title">Estilo de tatuaje</h2>
            <p class="jb-subtitle">Puedes seleccionar uno o varios estilos (opcional)</p>
            <div class="jb-options-grid cols-3" id="jb-styles-grid">
                ${cardsHtml}
            </div>
            <button class="jb-btn jb-btn-ghost" onclick="skipStep()" style="margin-top: 1.5rem;">Saltar este paso</button>
        </div>
    `;
}

window.toggleStyle = function(card) {
    card.classList.toggle('selected');
    const styleName = card.dataset.style;

    let selected = formData.tattoo_style ? (typeof formData.tattoo_style === 'string' ? JSON.parse(formData.tattoo_style) : [...formData.tattoo_style]) : [];

    if (card.classList.contains('selected')) {
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
        { label: 'Full Color', value: 'full_color' },
        { label: 'Black & Grey', value: 'black_grey' },
        { label: 'Sin preferencia', value: 'no_preference' }
    ];

    let colorHtml = '';
    colorOptions.forEach(opt => {
        const isSelected = formData.tattoo_color_type === opt.value;
        colorHtml += `
            <div class="jb-option-card ${isSelected ? 'selected' : ''}" data-value="${opt.value}" onclick="selectColor(this)">
                <span class="jb-option-label">${opt.label}</span>
            </div>
        `;
    });

    // Render previews for already uploaded files
    let previewsHtml = '';
    uploadedFiles.forEach((file, idx) => {
        previewsHtml += `
            <div class="jb-file-preview" data-index="${idx}">
                <img src="${URL.createObjectURL(file)}" alt="ref-${idx}">
                <button class="jb-file-remove" onclick="removeFile(${idx})" title="Eliminar">&times;</button>
            </div>
        `;
    });

    el.innerHTML = `
        <div class="jb-step-content">
            <h2 class="jb-title">Color y referencias</h2>
            <p class="jb-subtitle">Selecciona el tipo de color</p>
            <div class="jb-options-grid cols-3" style="margin-bottom: 2rem;">
                ${colorHtml}
            </div>
            <h3 class="jb-section-title">Imagenes de referencia (opcional)</h3>
            <p class="jb-hint">Maximo ${MAX_FILES} imagenes, 5MB cada una</p>
            <div class="jb-upload-area" id="jb-upload-area" onclick="triggerFileInput()" ondrop="handleDrop(event)" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <p>Arrastra imagenes aqui o haz click para seleccionar</p>
            </div>
            <input type="file" id="jb-file-input" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple style="display:none" onchange="handleFileSelect(event)">
            <div class="jb-file-previews" id="jb-file-previews">
                ${previewsHtml}
            </div>
            <button class="jb-btn jb-btn-ghost" onclick="skipStep()" style="margin-top: 1.5rem;">Saltar este paso</button>
        </div>
    `;
}

window.selectColor = function(card) {
    document.querySelectorAll('.jb-step[data-step="color-refs"] .jb-options-grid:first-of-type .jb-option-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    formData.tattoo_color_type = card.dataset.value;
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
    document.getElementById('jb-upload-area')?.classList.add('drag-over');
};

window.handleDragLeave = function(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('jb-upload-area')?.classList.remove('drag-over');
};

window.handleDrop = function(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('jb-upload-area')?.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer?.files || []);
    addFiles(files);
};

async function addFiles(files) {
    const remaining = MAX_FILES - uploadedFiles.length;
    if (remaining <= 0) {
        showFormNotice('Maximo ' + MAX_FILES + ' imagenes permitidas');
        return;
    }

    const filesToProcess = Array.from(files).slice(0, remaining);

    for (const file of filesToProcess) {
        // Convertir y comprimir ANTES de validar tipo y tamaño
        const converted = await convertIfHEIC(file);
        const compressed = await compressImage(converted);

        if (!ACCEPTED_IMAGE_TYPES.includes(compressed.type)) {
            showFormNotice('Solo se permiten imagenes JPG, PNG o WebP');
            continue;
        }
        if (compressed.size > MAX_FILE_SIZE) {
            showFormNotice('El archivo ' + file.name + ' supera los 5MB tras compresion');
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
        div.className = 'jb-file-preview';
        div.dataset.index = idx;
        div.innerHTML = `
            <img src="${URL.createObjectURL(file)}" alt="ref-${idx}">
            <button class="jb-file-remove" onclick="removeFile(${idx})" title="Eliminar">&times;</button>
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
        <div class="jb-step-content">
            <h2 class="jb-title">Preferencias</h2>
            <p class="jb-subtitle">Toda esta informacion es opcional</p>

            <div class="jb-form-group">
                <label class="jb-label">Presupuesto estimado</label>
                <div class="jb-budget-row">
                    <input type="number" id="jb-budget-min" class="jb-input jb-input-sm" placeholder="Min" value="${budgetMin}" min="0">
                    <span class="jb-budget-sep">-</span>
                    <input type="number" id="jb-budget-max" class="jb-input jb-input-sm" placeholder="Max" value="${budgetMax}" min="0">
                    <select id="jb-budget-currency" class="jb-select jb-select-sm">
                        ${['USD', 'EUR', 'ARS', 'MXN', 'COP', 'BRL'].map(c => `<option value="${c}" ${budgetCurrency === c ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                </div>
            </div>

            <div class="jb-form-group">
                <label class="jb-label">Ciudad</label>
                <input type="text" id="city-input" class="jb-input" placeholder="Tu ciudad" value="${cityVal}" autocomplete="off">
            </div>

            <div class="jb-form-group">
                <label class="jb-label">Fecha preferida</label>
                <input type="month" id="jb-pref-date" class="jb-input" value="${prefDate}">
            </div>

            <div class="jb-checkboxes">
                <label class="jb-checkbox-label">
                    <input type="checkbox" id="jb-flexible-dates" ${flexDates ? 'checked' : ''}>
                    <span>Fechas flexibles</span>
                </label>
                <label class="jb-checkbox-label">
                    <input type="checkbox" id="jb-travel-willing" ${travelWilling ? 'checked' : ''}>
                    <span>Dispuesto/a a viajar</span>
                </label>
            </div>

            <button class="jb-btn jb-btn-ghost" onclick="skipStep()" style="margin-top: 1.5rem;">Saltar este paso</button>
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
    el.innerHTML = '<div class="jb-step-content jb-center"><div class="jb-loading-spinner"></div><p>Verificando sesion...</p></div>';

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
        <div class="jb-step-content">
            <h2 class="jb-title">Publicar solicitud</h2>
            <p class="jb-subtitle">Necesitas una cuenta para publicar tu solicitud</p>

            <div class="jb-auth-tabs">
                <button class="jb-tab active" data-tab="register" onclick="switchAuthTab('register')">Registrarse</button>
                <button class="jb-tab" data-tab="login" onclick="switchAuthTab('login')">Iniciar sesion</button>
            </div>

            <div id="jb-auth-register" class="jb-auth-panel active">
                <div class="jb-form-group">
                    <label class="jb-label">Nombre completo</label>
                    <input type="text" id="jb-reg-name" class="jb-input" placeholder="Tu nombre" autocomplete="name">
                </div>
                <div class="jb-form-group">
                    <label class="jb-label">Email</label>
                    <input type="email" id="jb-reg-email" class="jb-input" placeholder="tu@email.com" autocomplete="email">
                </div>
                <div class="jb-form-group">
                    <label class="jb-label">Contrasena</label>
                    <input type="password" id="jb-reg-password" class="jb-input" placeholder="Minimo 6 caracteres" autocomplete="new-password">
                </div>
                <div class="jb-form-group">
                    <label class="jb-label">Confirmar contrasena</label>
                    <input type="password" id="jb-reg-confirm" class="jb-input" placeholder="Repite tu contrasena" autocomplete="new-password">
                </div>
                <div id="jb-reg-message" class="jb-form-message"></div>
                <button class="jb-btn jb-btn-primary jb-btn-full" id="jb-btn-register" onclick="handleJBRegister()">Crear cuenta y publicar</button>
            </div>

            <div id="jb-auth-login" class="jb-auth-panel">
                <div class="jb-form-group">
                    <label class="jb-label">Email</label>
                    <input type="email" id="jb-login-email" class="jb-input" placeholder="tu@email.com" autocomplete="email">
                </div>
                <div class="jb-form-group">
                    <label class="jb-label">Contrasena</label>
                    <input type="password" id="jb-login-password" class="jb-input" placeholder="Tu contrasena" autocomplete="current-password">
                </div>
                <div id="jb-login-message" class="jb-form-message"></div>
                <button class="jb-btn jb-btn-primary jb-btn-full" id="jb-btn-login" onclick="handleJBLogin()">Iniciar sesion y publicar</button>
            </div>
        </div>
    `;
}

window.switchAuthTab = function(tab) {
    document.querySelectorAll('.jb-auth-tabs .jb-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.jb-tab[data-tab="${tab}"]`)?.classList.add('active');

    document.getElementById('jb-auth-register').classList.toggle('active', tab === 'register');
    document.getElementById('jb-auth-login').classList.toggle('active', tab === 'login');
};

// ============================================
// AUTH HANDLERS
// ============================================

window.handleJBRegister = async function() {
    if (!_supabase) {
        showFormNotice('Servicio no disponible. Recarga la pagina.');
        return;
    }

    const btn = document.getElementById('jb-btn-register');
    const msgEl = document.getElementById('jb-reg-message');
    const name = document.getElementById('jb-reg-name')?.value.trim();
    const email = document.getElementById('jb-reg-email')?.value.trim().toLowerCase();
    const password = document.getElementById('jb-reg-password')?.value;
    const confirm = document.getElementById('jb-reg-confirm')?.value;

    if (msgEl) { msgEl.textContent = ''; msgEl.className = 'jb-form-message'; }

    if (!name || !email || !password) {
        showAuthMessage('jb-reg-message', 'Completa todos los campos obligatorios.', 'error');
        return;
    }
    if (password !== confirm) {
        showAuthMessage('jb-reg-message', 'Las contrasenas no coinciden.', 'error');
        return;
    }
    if (password.length < 6) {
        showAuthMessage('jb-reg-message', 'La contrasena debe tener al menos 6 caracteres.', 'error');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Creando cuenta...';

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

            showAuthMessage('jb-reg-message', 'Cuenta creada exitosamente.', 'success');

            // Re-render as logged-in user with summary
            setTimeout(() => {
                renderAccountGate(document.querySelector('.jb-step[data-step="account-gate"]'));
            }, 800);
        }

    } catch (error) {
        console.error('Registration error:', error);
        btn.disabled = false;
        btn.textContent = 'Crear cuenta y publicar';

        let errorMessage = 'Error al crear la cuenta.';
        if (error.message?.includes('already registered')) {
            errorMessage = 'Este email ya esta registrado. Intenta iniciar sesion.';
        }
        showAuthMessage('jb-reg-message', errorMessage, 'error');
    }
};

window.handleJBLogin = async function() {
    if (!_supabase) {
        showFormNotice('Servicio no disponible. Recarga la pagina.');
        return;
    }

    const btn = document.getElementById('jb-btn-login');
    const email = document.getElementById('jb-login-email')?.value.trim().toLowerCase();
    const password = document.getElementById('jb-login-password')?.value;

    if (!email || !password) {
        showAuthMessage('jb-login-message', 'Ingresa tu email y contrasena.', 'error');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Validando...';

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

        showAuthMessage('jb-login-message', 'Sesion iniciada correctamente.', 'success');

        // Re-render as logged-in user
        setTimeout(() => {
            renderAccountGate(document.querySelector('.jb-step[data-step="account-gate"]'));
        }, 800);

    } catch (error) {
        console.error('Login error:', error);
        btn.disabled = false;
        btn.textContent = 'Iniciar sesion y publicar';

        let errorMessage = 'Error al iniciar sesion.';
        if (error.message?.includes('Invalid login credentials')) {
            errorMessage = 'Email o contrasena incorrectos.';
        }
        showAuthMessage('jb-login-message', errorMessage, 'error');
    }
};

function showAuthMessage(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.className = 'jb-form-message jb-msg-' + type;
}

// ============================================
// SUMMARY CARD + SUBMIT
// ============================================

function renderSummaryAndSubmit(el, session, client) {
    const styleDisplay = formatStyleDisplay();
    const colorDisplay = formatColorDisplay();
    const sizeDisplay = formatSizeDisplay();
    const budgetDisplay = formatBudgetDisplay();

    el.innerHTML = `
        <div class="jb-step-content">
            <h2 class="jb-title">Resumen de tu solicitud</h2>
            <p class="jb-subtitle">Revisa la informacion antes de publicar</p>

            <div class="jb-summary-card">
                <div class="jb-summary-row">
                    <span class="jb-summary-label">Zona del cuerpo</span>
                    <span class="jb-summary-value">${formData.tattoo_body_part || '-'}</span>
                </div>
                <div class="jb-summary-row">
                    <span class="jb-summary-label">Descripcion</span>
                    <span class="jb-summary-value jb-summary-desc">${escapeHtml(formData.tattoo_idea_description || '-')}</span>
                </div>
                <div class="jb-summary-row">
                    <span class="jb-summary-label">Tamano</span>
                    <span class="jb-summary-value">${sizeDisplay}</span>
                </div>
                <div class="jb-summary-row">
                    <span class="jb-summary-label">Estilo</span>
                    <span class="jb-summary-value">${styleDisplay}</span>
                </div>
                <div class="jb-summary-row">
                    <span class="jb-summary-label">Color</span>
                    <span class="jb-summary-value">${colorDisplay}</span>
                </div>
                <div class="jb-summary-row">
                    <span class="jb-summary-label">Referencias</span>
                    <span class="jb-summary-value">${uploadedFiles.length > 0 ? uploadedFiles.length + ' imagen(es)' : 'Ninguna'}</span>
                </div>
                ${budgetDisplay ? `
                <div class="jb-summary-row">
                    <span class="jb-summary-label">Presupuesto</span>
                    <span class="jb-summary-value">${budgetDisplay}</span>
                </div>
                ` : ''}
                ${formData.client_city ? `
                <div class="jb-summary-row">
                    <span class="jb-summary-label">Ciudad</span>
                    <span class="jb-summary-value">${escapeHtml(formData.client_city)}</span>
                </div>
                ` : ''}
                ${formData.preferred_date ? `
                <div class="jb-summary-row">
                    <span class="jb-summary-label">Fecha preferida</span>
                    <span class="jb-summary-value">${formData.preferred_date}${formData.flexible_dates ? ' (flexible)' : ''}</span>
                </div>
                ` : ''}
                ${formData.is_first_tattoo ? `
                <div class="jb-summary-row">
                    <span class="jb-summary-label">Primer tatuaje</span>
                    <span class="jb-summary-value">Si</span>
                </div>
                ` : ''}
                ${formData.is_cover_up ? `
                <div class="jb-summary-row">
                    <span class="jb-summary-label">Cover-up</span>
                    <span class="jb-summary-value">Si</span>
                </div>
                ` : ''}
                ${formData.travel_willing ? `
                <div class="jb-summary-row">
                    <span class="jb-summary-label">Dispuesto a viajar</span>
                    <span class="jb-summary-value">Si</span>
                </div>
                ` : ''}
            </div>

            <div class="jb-submit-section">
                <p class="jb-logged-as">Publicando como: <strong>${escapeHtml(formData._client_name || formData._client_email)}</strong></p>
                <button class="jb-btn jb-btn-primary jb-btn-lg jb-btn-full" id="jb-btn-submit" onclick="submitRequest()">Publicar solicitud</button>
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
        'full_color': 'Full Color',
        'black_grey': 'Black & Grey',
        'no_preference': 'Sin preferencia'
    };
    return map[formData.tattoo_color_type] || 'Sin preferencia';
}

function formatSizeDisplay() {
    const map = {
        'pequeno': 'Pequeno (< 5cm)',
        'mediano': 'Mediano (5-15cm)',
        'grande': 'Grande (15-30cm)',
        'muy_grande': 'Muy Grande (> 30cm)'
    };
    return map[formData.tattoo_size] || '-';
}

function formatBudgetDisplay() {
    if (!formData.budget_min && !formData.budget_max) return '';
    const currency = formData.budget_currency || 'USD';
    if (formData.budget_min && formData.budget_max) {
        return `${formData.budget_min} - ${formData.budget_max} ${currency}`;
    }
    if (formData.budget_min) return `Desde ${formData.budget_min} ${currency}`;
    if (formData.budget_max) return `Hasta ${formData.budget_max} ${currency}`;
    return '';
}

// ============================================
// SUBMIT REQUEST
// ============================================

window.submitRequest = async function() {
    if (isSubmitting) return;
    if (!_supabase) {
        showFormNotice('Servicio no disponible. Recarga la pagina.');
        return;
    }
    isSubmitting = true;

    const btn = document.getElementById('jb-btn-submit');
    const overlay = document.getElementById('loading-overlay');

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Publicando...';
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
            btn.textContent = 'Publicar solicitud';
        }
        showFormNotice('Error al publicar la solicitud. Por favor, intenta de nuevo.');
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
                showFormNotice('Selecciona una zona del cuerpo');
                return false;
            }
            return true;

        case 'description':
            // Sync current textarea value before validating
            syncDescriptionField();
            if (!formData.tattoo_idea_description || formData.tattoo_idea_description.trim().length < 10) {
                showFormNotice('La descripcion debe tener al menos 10 caracteres');
                const textarea = document.getElementById('jb-description');
                if (textarea) textarea.classList.add('jb-input-error');
                return false;
            }
            return true;

        case 'size':
            if (!formData.tattoo_size) {
                shakeElement('.jb-step[data-step="size"] .jb-options-grid');
                showFormNotice('Selecciona un tamano');
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
    el.style.animation = 'jb-shake 0.5s ease';
    setTimeout(() => { el.style.animation = ''; }, 500);
}

function showFormNotice(message) {
    // Use a simple toast-like notice
    let notice = document.getElementById('jb-notice');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'jb-notice';
        notice.className = 'jb-notice';
        document.body.appendChild(notice);
    }
    notice.textContent = message;
    notice.classList.add('visible');
    setTimeout(() => {
        notice.classList.remove('visible');
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
