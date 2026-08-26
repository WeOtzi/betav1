// ============================================
// WE ÖTZI · JOB BOARD — Publicá tu idea (cliente)
// Rediseño Bauhaus 2026 (Figma 295:14727 · 286:8577 · 286:13942).
// Vistas: inspiración (opcional) → formulario → revisión → publicar.
// Cableado preservado del wizard legacy: draft en localStorage, auth-gate
// inline, upload a job-board-references, INSERT a job_board_requests con las
// mismas columnas, job_board_attachments y evento n8n job_board_request_created.
// ============================================

// === STATE ===
let view = 'inspiration';          // inspiration | form | review | auth
let formData = {};
let uploadedFiles = [];            // File[] (máx. 3, en orden de slot)
let bodyPartsData = [];
let tattooStyles = [];
let isSubmitting = false;
let _supabase = null;

// Galería de inspiración
let galleryItems = [];             // { url, style, artist }
let gallerySelection = [];         // urls elegidas como referencia
let galleryFilter = 'Todos';
let gallerySearch = '';
let galleryLoaded = false;

// Calendario
let calCursor = null;              // Date en el día 1 del mes visible

const DRAFT_KEY = 'weotzi_job_board_draft';
const MAX_FILES = 3;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
// Nota: convertIfHEIC corre antes de la validación, produciendo 'image/jpeg' para HEIC.
// Los tipos heic/heif se incluyen por si llegan antes de conversión.

// Zonas del cuerpo del mock (fallback si la config de Supabase no carga).
// Los glifos son marcas geométricas Bauhaus (Feather no trae siluetas de cuerpo).
const ZONE_ICONS = ['triangle', 'square', 'hexagon', 'octagon', 'circle'];
const FALLBACK_ZONES = ['Brazo', 'Pierna', 'Torso', 'Espalda', 'Cabeza'];

const SIDES = ['Izquierdo', 'Ambos', 'Derecho'];

const SIZES = [
    { value: 'pequeno', label: 'Pequeño (< 5 cm)' },
    { value: 'mediano', label: 'Mediano (5 – 15 cm)' },
    { value: 'grande', label: 'Grande (15 – 30 cm)' },
    { value: 'muy_grande', label: 'Muy grande (> 30 cm)' }
];

const COLORS = [
    { value: 'black_grey', label: 'Blanco y negro' },
    { value: 'full_color', label: 'Color' }
];

const CURRENCIES = ['USD', 'EUR', 'ARS', 'MXN', 'COP', 'BRL'];

// Chips de estilos del mock de inspiración (la galería filtra contra styles_array)
const INSPIRATION_STYLES = ['Fine line', 'Blackwork', 'Realismo', 'Japonés', 'Tradicional', 'Color', 'Lettering', 'Ornamental', 'Minimalista'];

const OPEN_INTERP_MARK = '[Interpretación abierta]';

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
    setupSessionChrome();
    await loadConfig();

    const draft = loadDraft();
    if (draft && draft.formData && Object.keys(draft.formData).length > 0) {
        renderResumePrompt();
    } else {
        view = 'inspiration';
        renderView();
    }
    loadGallery();
});

async function loadConfig() {
    // Zonas del cuerpo desde Supabase vía ConfigManager (árbol jerárquico)
    if (window.ConfigManager && typeof window.ConfigManager.loadBodyPartsFromDB === 'function') {
        try {
            bodyPartsData = await window.ConfigManager.loadBodyPartsFromDB();
        } catch (err) {
            console.error('Error loading body parts:', err);
            bodyPartsData = [];
        }
    }

    // Estilos de tatuaje desde Supabase
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

// Muestra LOG OUT solo si hay sesión activa.
async function setupSessionChrome() {
    const btn = document.getElementById('jbrq-logout');
    if (!btn || !_supabase) return;
    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (session) {
            btn.classList.remove('wo-hidden');
            btn.addEventListener('click', async () => {
                try { await _supabase.auth.signOut(); } catch (e) { /* noop */ }
                window.location.href = '/inicio';
            });
        }
    } catch (e) { /* sin sesión */ }
}

// ============================================
// DRAFT PERSISTENCE (mismo storage key y expiración que el wizard legacy)
// ============================================

function saveDraft() {
    try {
        const draft = {
            formData: formData,
            view: view,
            timestamp: Date.now()
        };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (e) {
        // localStorage lleno o no disponible
    }
}

function loadDraft() {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return null;
        const draft = JSON.parse(raw);
        // Expira borradores de más de 7 días
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

function renderResumePrompt() {
    const container = document.getElementById('jbrq-view');
    if (!container) return;
    const stepper = document.getElementById('jbrq-stepper');
    if (stepper) stepper.hidden = true;

    container.innerHTML = `
        <div class="jbrq-resume">
            <span class="wo-eyebrow">Borrador guardado</span>
            <h1 class="wo-h2">Tenés una publicación en curso</h1>
            <p class="jbrq-sub">Guardamos lo que cargaste. ¿Querés seguir donde la dejaste?</p>
            <div class="jbrq-resume-actions">
                <button type="button" class="wo-btn wo-btn--ink wo-btn--hard" onclick="resumeDraft()">Continuar borrador →</button>
                <button type="button" class="wo-btn wo-btn--ghost" onclick="discardDraft()">Empezar de nuevo</button>
            </div>
        </div>
    `;
}

window.resumeDraft = function() {
    const draft = loadDraft();
    if (draft) {
        formData = draft.formData || {};
        view = (draft.view === 'review' || draft.view === 'inspiration') ? draft.view : 'form';
        // Sin archivos persistidos (los File no sobreviven al draft), la revisión
        // igual muestra el resto de los datos.
    }
    renderView();
};

window.discardDraft = function() {
    clearDraft();
    formData = {};
    uploadedFiles = [];
    gallerySelection = [];
    view = 'inspiration';
    renderView();
};

// ============================================
// VIEW ORCHESTRATOR
// ============================================

window.setView = function(next) {
    view = next;
    saveDraft();
    renderView();
};

function renderView() {
    const container = document.getElementById('jbrq-view');
    if (!container) return;
    const stepper = document.getElementById('jbrq-stepper');
    const back = document.getElementById('jbrq-back');

    if (view === 'inspiration') {
        if (stepper) stepper.hidden = true;
        if (back) { back.textContent = '← Volver al dashboard'; back.href = '/client/dashboard'; }
    } else {
        if (stepper) stepper.hidden = false;
        if (back) { back.textContent = '← Volver a mis solicitudes'; back.href = '/client/requests'; }
    }

    container.innerHTML = '';
    const pane = document.createElement('div');
    pane.className = 'jbrq-pane';

    switch (view) {
        case 'inspiration': renderInspiration(pane); break;
        case 'form':        renderForm(pane); break;
        case 'review':      renderReview(pane); break;
        case 'auth':        renderAuth(pane); break;
    }

    container.appendChild(pane);
    window.scrollTo({ top: 0 });
}

// ============================================
// TÍTULO DERIVADO DE LA PUBLICACIÓN
// (sin columna nueva: se calcula en render — primeras ~6 palabras + estilo + zona)
// ============================================

function deriveRequestTitle(description, styles, bodyPart) {
    const desc = String(description || '')
        .replace(/\[interpretación abierta\]/gi, '')
        .trim();
    let words = desc.split(/\s+/).filter(Boolean).slice(0, 6).join(' ').replace(/[.,;:…]+$/, '');
    if (words) words = words.charAt(0).toUpperCase() + words.slice(1);

    const styleList = Array.isArray(styles) ? styles : (styles ? [String(styles)] : []);
    const parts = [];
    if (words) parts.push(words);
    if (styleList.length > 0) parts.push(styleList[0]);
    if (bodyPart) parts.push(bodyPart);
    return parts.join(' · ');
}
window.deriveRequestTitle = deriveRequestTitle;

// ============================================
// VISTA 0 · INSPIRACIÓN ("Construí tu idea")
// ============================================

function renderInspiration(el) {
    el.innerHTML = `
        <header class="jbrq-head">
            <h1 class="wo-h1 jbrq-title">Construí tu idea</h1>
            <p class="jbrq-sub">Explorá referencias, descubrí estilos y guardá lo que te inspira antes de publicar tu proyecto.</p>
        </header>

        <section class="jbrq-ai" aria-label="Inspiración con IA">
            <div class="jbrq-ai-copy">
                <span class="wo-eyebrow jbrq-ai-eyebrow"><span class="jbrq-ai-mark" aria-hidden="true"></span>Inspiración con IA</span>
                <h2 class="wo-h2 jbrq-ai-title">¿No sabés exactamente qué buscás?</h2>
                <p>Contanos tu idea y dejá que We Ötzi encuentre referencias y estilos que puedan inspirarte.</p>
            </div>
            <div class="jbrq-ai-form">
                <label class="wo-label" for="jbrq-ai-prompt">Quiero un tatuaje de…</label>
                <textarea id="jbrq-ai-prompt" class="wo-textarea" rows="3" maxlength="400" placeholder="Ej: olas del mar, minimalista, delicado, para el antebrazo"></textarea>
                <div class="jbrq-ai-actions">
                    <span class="wo-error-msg wo-hidden" id="jbrq-ai-error">No pudimos generar la imagen. Probá de nuevo en un rato.</span>
                    <button type="button" class="wo-btn wo-btn--direct wo-btn--hard" id="jbrq-ai-btn" onclick="generateInspiration()">Inspirarme con IA →</button>
                </div>
                <div class="jbrq-ai-result wo-hidden" id="jbrq-ai-result"></div>
            </div>
        </section>

        <div class="jbrq-search">
            <i data-wo-icon="search" class="wo-icon-18 jbrq-search-icon" aria-hidden="true"></i>
            <input type="search" id="jbrq-gallery-search" class="wo-input" placeholder="Buscar estilos, ideas, tatuajes…" value="${escapeHtml(gallerySearch)}" aria-label="Buscar referencias">
        </div>

        <div class="jbrq-filter-row">
            <div class="jbrq-chips" id="jbrq-gallery-chips" role="group" aria-label="Filtrar por estilo"></div>
            <button type="button" class="wo-btn wo-btn--ink wo-btn--hard jbrq-create-btn" id="jbrq-create-btn" onclick="goToForm()">Crear mi idea →</button>
        </div>
        <p class="wo-meta-s wo-muted jbrq-selcount wo-hidden" id="jbrq-selcount"></p>

        <div class="jbrq-masonry" id="jbrq-gallery"></div>
    `;

    const search = el.querySelector('#jbrq-gallery-search');
    if (search) {
        search.addEventListener('input', () => {
            gallerySearch = search.value.trim().toLowerCase();
            renderGallery();
        });
    }

    renderGalleryChips();
    renderGallery();
    updateSelCount();
}

function renderGalleryChips() {
    const wrap = document.getElementById('jbrq-gallery-chips');
    if (!wrap) return;
    const chips = ['Todos'].concat(INSPIRATION_STYLES);
    wrap.innerHTML = chips.map(name => `
        <button type="button" class="wo-chip ${galleryFilter === name ? 'is-active' : ''}" data-style="${escapeHtml(name)}" onclick="setGalleryFilter(this)">${escapeHtml(name)}</button>
    `).join('');
}

window.setGalleryFilter = function(chip) {
    galleryFilter = chip.dataset.style || 'Todos';
    renderGalleryChips();
    renderGallery();
};

async function loadGallery() {
    if (galleryLoaded) return;
    try {
        const { data, error } = await WeotziData.Artists
            .listPublic('user_id, username, name, styles_array, gallery_images')
            .limit(60);
        if (error || !Array.isArray(data)) throw (error || new Error('sin datos'));

        const items = [];
        data.forEach(artist => {
            const imgs = parseList(artist.gallery_images).filter(u => typeof u === 'string' && /^https?:/.test(u)).slice(0, 3);
            const styles = parseList(artist.styles_array).filter(s => typeof s === 'string');
            const style = styles[0] || '';
            imgs.forEach(url => items.push({
                url: url,
                style: style,
                styles: styles,
                artist: artist.name || artist.username || ''
            }));
        });

        // Intercala artistas para que la grilla no quede en bloques por perfil
        items.sort((a, b) => (a.url.length % 7) - (b.url.length % 7));
        galleryItems = items.slice(0, 36);
        galleryLoaded = true;
    } catch (e) {
        console.warn('[Job Board] No se pudo cargar la galería de referencias:', e?.message || e);
        galleryItems = [];
        galleryLoaded = true;
    }
    renderGallery();
}

function galleryMatches(item) {
    if (galleryFilter !== 'Todos') {
        const wanted = galleryFilter.toLowerCase();
        const inStyles = (item.styles || []).some(s => String(s).toLowerCase().includes(wanted));
        if (!inStyles) return false;
    }
    if (gallerySearch) {
        const haystack = ((item.styles || []).join(' ') + ' ' + item.artist).toLowerCase();
        if (!haystack.includes(gallerySearch)) return false;
    }
    return true;
}

function renderGallery() {
    const wrap = document.getElementById('jbrq-gallery');
    if (!wrap) return;

    if (!galleryLoaded) {
        wrap.innerHTML = '<div class="jbrq-gallery-loading"><div class="wo-spinner"></div><span class="wo-meta-s wo-muted">Cargando referencias…</span></div>';
        return;
    }

    const visible = galleryItems.filter(galleryMatches);
    if (visible.length === 0) {
        wrap.innerHTML = `
            <div class="wo-empty jbrq-gallery-empty">
                <i data-wo-icon="image" aria-hidden="true"></i>
                <span class="wo-empty-title">Sin referencias para mostrar</span>
                <p>Probá con otro estilo, pedile una imagen a la IA o creá tu idea directamente.</p>
            </div>
        `;
        return;
    }

    wrap.innerHTML = visible.map(item => {
        const selected = gallerySelection.includes(item.url);
        const styleLabel = item.style ? 'Tatuaje ' + item.style.toLowerCase() : 'Tatuaje';
        return `
            <button type="button" class="jbrq-ref ${selected ? 'is-selected' : ''}" data-url="${escapeHtml(item.url)}" onclick="toggleGalleryRef(this)" aria-pressed="${selected}">
                <img src="${escapeHtml(item.url)}" alt="${escapeHtml(styleLabel)}" loading="lazy">
                <span class="jbrq-ref-cap">
                    <span class="jbrq-ref-style">${escapeHtml(styleLabel)}</span>
                    ${item.artist ? `<span class="wo-meta-s wo-muted">${escapeHtml(item.artist)}</span>` : ''}
                </span>
                <span class="jbrq-ref-check" aria-hidden="true"><i data-wo-icon="check" class="wo-icon-18"></i></span>
            </button>
        `;
    }).join('');
}

window.toggleGalleryRef = function(card) {
    const url = card.dataset.url;
    if (!url) return;
    const idx = gallerySelection.indexOf(url);
    if (idx >= 0) {
        gallerySelection.splice(idx, 1);
    } else {
        if (gallerySelection.length + uploadedFiles.length >= MAX_FILES) {
            showFormNotice('Podés llevar hasta ' + MAX_FILES + ' referencias a tu publicación');
            return;
        }
        gallerySelection.push(url);
    }
    card.classList.toggle('is-selected', idx < 0);
    card.setAttribute('aria-pressed', String(idx < 0));
    updateSelCount();
};

function updateSelCount() {
    const el = document.getElementById('jbrq-selcount');
    if (!el) return;
    const n = gallerySelection.length;
    if (n === 0) {
        el.classList.add('wo-hidden');
        return;
    }
    el.textContent = n + (n === 1 ? ' referencia seleccionada' : ' referencias seleccionadas') + ' · se suman como imágenes de tu publicación';
    el.classList.remove('wo-hidden');
}

// Trae las referencias elegidas de la galería como archivos y pasa al formulario.
window.goToForm = async function() {
    const btn = document.getElementById('jbrq-create-btn');
    const picks = gallerySelection.slice(0, Math.max(0, MAX_FILES - uploadedFiles.length));
    if (picks.length > 0 && btn) {
        btn.disabled = true;
        btn.textContent = 'Preparando…';
    }
    for (const url of picks) {
        try {
            const resp = await fetch(url);
            const blob = await resp.blob();
            if (blob && blob.type.indexOf('image/') === 0 && blob.size <= MAX_FILE_SIZE) {
                uploadedFiles.push(new File([blob], 'referencia-galeria.jpg', { type: blob.type }));
            }
        } catch (e) {
            console.warn('[Job Board] No se pudo traer la referencia elegida:', e?.message || e);
        }
    }
    gallerySelection = [];
    setView('form');
};

// --- IA de inspiración (POST /api/gemini/generate-image) ---

window.generateInspiration = async function() {
    const promptEl = document.getElementById('jbrq-ai-prompt');
    const btn = document.getElementById('jbrq-ai-btn');
    const errEl = document.getElementById('jbrq-ai-error');
    const resultEl = document.getElementById('jbrq-ai-result');
    if (!promptEl || !btn) return;

    const idea = promptEl.value.trim();
    if (!idea) {
        showFormNotice('Contanos primero qué te gustaría tatuarte');
        return;
    }

    if (errEl) errEl.classList.add('wo-hidden');
    btn.disabled = true;
    btn.textContent = 'Generando…';

    try {
        const response = await fetch('/api/gemini/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: 'Referencia visual para un tatuaje: ' + idea + '. Ilustración de diseño de tatuaje sobre fondo claro, líneas definidas, alto contraste, sin texto.',
                aspectRatio: '1:1',
                imageSize: '1K',
                temperature: 0.7
            })
        });
        const data = await response.json();
        if (!data.success || !data.image) throw new Error(data.error || 'Sin imagen');

        if (resultEl) {
            resultEl.innerHTML = `
                <img src="${data.image}" alt="Referencia generada con IA" class="jbrq-ai-img">
                <div class="jbrq-ai-result-actions">
                    <p class="wo-meta-s wo-muted">Generada a partir de tu idea</p>
                    <button type="button" class="wo-btn wo-btn--secondary wo-btn--s" onclick="useAiReference(this)">Usar como referencia</button>
                    <button type="button" class="wo-btn wo-btn--ghost wo-btn--s" onclick="generateInspiration()">Generar otra</button>
                </div>
            `;
            resultEl.classList.remove('wo-hidden');
        }
    } catch (e) {
        console.warn('[Job Board] Error generando inspiración:', e?.message || e);
        if (errEl) errEl.classList.remove('wo-hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Inspirarme con IA →';
    }
};

window.useAiReference = async function(btnEl) {
    const img = document.querySelector('#jbrq-ai-result .jbrq-ai-img');
    if (!img || !img.src) return;
    if (uploadedFiles.length + gallerySelection.length >= MAX_FILES) {
        showFormNotice('Ya tenés ' + MAX_FILES + ' referencias elegidas');
        return;
    }
    try {
        const resp = await fetch(img.src);
        const blob = await resp.blob();
        uploadedFiles.push(new File([blob], 'inspiracion-ia.png', { type: blob.type || 'image/png' }));
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.textContent = 'Agregada a tu publicación';
        }
        showFormNotice('Referencia agregada · la vas a ver en el formulario');
    } catch (e) {
        showFormNotice('No pudimos guardar la imagen. Probá de nuevo.');
    }
};

// ============================================
// VISTA 1 · FORMULARIO ("¿Qué tatuaje tenés en mente?")
// ============================================

function zonesList() {
    if (Array.isArray(bodyPartsData) && bodyPartsData.length > 0) {
        return bodyPartsData.map((zone, i) => ({
            label: zone.label || zone.id,
            icon: ZONE_ICONS[i % ZONE_ICONS.length]
        }));
    }
    return FALLBACK_ZONES.map((label, i) => ({ label: label, icon: ZONE_ICONS[i] }));
}

function styleChipsSource() {
    if (Array.isArray(tattooStyles) && tattooStyles.length > 0) {
        return tattooStyles.map(s => s.name).filter(Boolean);
    }
    return INSPIRATION_STYLES;
}

function selectedStylesArray() {
    if (!formData.tattoo_style) return [];
    if (Array.isArray(formData.tattoo_style)) return formData.tattoo_style;
    try { return JSON.parse(formData.tattoo_style); } catch (e) { return [String(formData.tattoo_style)]; }
}

function renderForm(el) {
    const descVal = formData.tattoo_idea_description || '';
    const selectedStyles = selectedStylesArray();
    const openInterp = formData.open_interpretation !== false; // default encendido (mock)

    const zoneCards = zonesList().map(zone => {
        const active = formData.tattoo_body_part === zone.label;
        return `
            <button type="button" class="jbrq-zone ${active ? 'is-active' : ''}" data-zone="${escapeHtml(zone.label)}" onclick="selectZone(this)" aria-pressed="${active}">
                <span class="jbrq-zone-check" aria-hidden="true"><i data-wo-icon="check" class="wo-icon-18"></i></span>
                <i data-wo-icon="${zone.icon}" aria-hidden="true"></i>
                <span class="jbrq-zone-label">${escapeHtml(zone.label)}</span>
            </button>
        `;
    }).join('');

    const styleChips = styleChipsSource().map(name => {
        const active = selectedStyles.includes(name);
        return `<button type="button" class="wo-chip ${active ? 'is-active' : ''}" data-style="${escapeHtml(name)}" onclick="toggleStyle(this)" aria-pressed="${active}">${escapeHtml(name)}</button>`;
    }).join('');

    const sideChips = SIDES.map(side => {
        const active = formData.tattoo_body_side === side;
        return `<button type="button" class="wo-chip ${active ? 'is-active' : ''}" data-side="${escapeHtml(side)}" onclick="selectSide(this)" aria-pressed="${active}">${escapeHtml(side)}</button>`;
    }).join('');

    const colorRadios = COLORS.map(opt => `
        <label class="wo-radio">
            <input type="radio" name="jbrq-color" value="${opt.value}" ${formData.tattoo_color_type === opt.value ? 'checked' : ''} onchange="selectColor(this)">
            <span>${opt.label}</span>
        </label>
    `).join('');

    const sizeOptions = ['<option value="" disabled ' + (formData.tattoo_size ? '' : 'selected') + '>Elegí un tamaño</option>']
        .concat(SIZES.map(s => `<option value="${s.value}" ${formData.tattoo_size === s.value ? 'selected' : ''}>${s.label}</option>`))
        .join('');

    const currencyOptions = CURRENCIES.map(c =>
        `<option value="${c}" ${(formData.budget_currency || 'USD') === c ? 'selected' : ''}>${c}</option>`
    ).join('');

    el.innerHTML = `
        <header class="jbrq-head">
            <h1 class="wo-h1 jbrq-title">¿Qué tatuaje tenés en mente?</h1>
            <p class="jbrq-sub">Contanos los detalles y dejá que los tatuadores te encuentren.</p>
        </header>

        <div class="jbrq-form">

            <div class="wo-field">
                <label class="wo-label" for="jbrq-description">Descripción de la idea</label>
                <textarea id="jbrq-description" class="wo-textarea jbrq-desc" maxlength="1000" placeholder="Ej: quiero un lobo aullando, estilo blackwork, en el antebrazo. Busco líneas gruesas y buen contraste…">${escapeHtml(descVal)}</textarea>
                <div class="jbrq-count"><span id="jbrq-desc-count">${descVal.length}</span> / 1000</div>
                <div class="jbrq-checks">
                    <label class="wo-check">
                        <input type="checkbox" id="jbrq-first-tattoo" ${formData.is_first_tattoo ? 'checked' : ''}>
                        <span>Es mi primer tatuaje</span>
                    </label>
                    <label class="wo-check">
                        <input type="checkbox" id="jbrq-cover-up" ${formData.is_cover_up ? 'checked' : ''}>
                        <span>Es un cover-up</span>
                    </label>
                </div>
            </div>

            <div class="wo-field">
                <span class="wo-label">Estilo</span>
                <div class="jbrq-chiprow" id="jbrq-style-chips">${styleChips}</div>
                <p class="wo-help">Podés elegir uno o varios · opcional</p>
            </div>

            <div class="wo-field jbrq-field-half">
                <label class="wo-label" for="jbrq-size">Tamaño aproximado</label>
                <select id="jbrq-size" class="wo-select">${sizeOptions}</select>
            </div>

            <div class="wo-field">
                <span class="wo-label">Parte del cuerpo</span>
                <div class="jbrq-zones" id="jbrq-zones">${zoneCards}</div>
            </div>

            <div class="wo-field">
                <span class="wo-label">¿De qué lado?</span>
                <div class="jbrq-chiprow" id="jbrq-side-chips">${sideChips}</div>
            </div>

            <div class="wo-field">
                <span class="wo-label">Color</span>
                <div class="jbrq-radios">${colorRadios}</div>
            </div>

            <div class="jbrq-row jbrq-row--budget">
                <div class="wo-field">
                    <label class="wo-label" for="jbrq-budget-min">Presupuesto mín.</label>
                    <div class="jbrq-money">
                        <span class="jbrq-money-prefix" aria-hidden="true">$</span>
                        <input type="number" id="jbrq-budget-min" class="wo-input" min="0" inputmode="numeric" placeholder="300" value="${escapeHtml(formData.budget_min || '')}">
                    </div>
                </div>
                <div class="wo-field">
                    <label class="wo-label" for="jbrq-budget-max">Presupuesto máx.</label>
                    <div class="jbrq-money">
                        <span class="jbrq-money-prefix" aria-hidden="true">$</span>
                        <input type="number" id="jbrq-budget-max" class="wo-input" min="0" inputmode="numeric" placeholder="500" value="${escapeHtml(formData.budget_max || '')}">
                    </div>
                </div>
                <div class="wo-field">
                    <label class="wo-label" for="jbrq-currency">Moneda</label>
                    <select id="jbrq-currency" class="wo-select">${currencyOptions}</select>
                </div>
                <div class="wo-field">
                    <label class="wo-label" for="city-input">Ciudad</label>
                    <div class="jbrq-city">
                        <i data-wo-icon="map-pin" class="wo-icon-18 jbrq-city-icon" aria-hidden="true"></i>
                        <input type="text" id="city-input" class="wo-input" placeholder="Tu ciudad" value="${escapeHtml(formData.client_city || '')}" autocomplete="off">
                    </div>
                </div>
            </div>

            <div class="wo-field">
                <span class="wo-label">Fecha aproximada</span>
                <div class="jbrq-cal" id="jbrq-calendar"></div>
                <label class="wo-check jbrq-flex-check">
                    <input type="checkbox" id="jbrq-flexible-dates" ${formData.flexible_dates ? 'checked' : ''}>
                    <span>Tengo fechas flexibles</span>
                </label>
            </div>

            <div class="wo-field">
                <span class="wo-label">Imágenes de referencia</span>
                <div class="jbrq-refs" id="jbrq-refs"></div>
                <input type="file" id="jbrq-file-input" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple class="wo-hidden" onchange="handleFileSelect(event)">
            </div>

            <div class="jbrq-toggle-row">
                <div class="jbrq-toggle-copy">
                    <p class="jbrq-toggle-title">Permitir que el artista proponga su propia interpretación</p>
                    <p class="wo-help">El tatuador podrá sugerir cambios creativos manteniendo tu idea base.</p>
                </div>
                <label class="wo-toggle">
                    <input type="checkbox" id="jbrq-open-interp" ${openInterp ? 'checked' : ''}>
                    <span class="knob"></span>
                </label>
            </div>

            <div class="jbrq-form-foot">
                <button type="button" class="wo-btn wo-btn--ink wo-btn--hard" onclick="continueToReview()">Continuar →</button>
            </div>
        </div>
    `;

    bindFormEvents();
    renderCalendar();
    renderRefSlots();
}

function bindFormEvents() {
    const textarea = document.getElementById('jbrq-description');
    const counter = document.getElementById('jbrq-desc-count');
    if (textarea) {
        textarea.addEventListener('input', () => {
            formData.tattoo_idea_description = textarea.value;
            if (counter) counter.textContent = textarea.value.length;
            textarea.classList.remove('wo-input--error');
        });
    }

    const firstCb = document.getElementById('jbrq-first-tattoo');
    if (firstCb) firstCb.addEventListener('change', () => { formData.is_first_tattoo = firstCb.checked; saveDraft(); });
    const coverCb = document.getElementById('jbrq-cover-up');
    if (coverCb) coverCb.addEventListener('change', () => { formData.is_cover_up = coverCb.checked; saveDraft(); });

    const sizeEl = document.getElementById('jbrq-size');
    if (sizeEl) sizeEl.addEventListener('change', () => { formData.tattoo_size = sizeEl.value; saveDraft(); });

    const minEl = document.getElementById('jbrq-budget-min');
    if (minEl) minEl.addEventListener('input', () => { formData.budget_min = minEl.value; });
    const maxEl = document.getElementById('jbrq-budget-max');
    if (maxEl) maxEl.addEventListener('input', () => { formData.budget_max = maxEl.value; });
    const curEl = document.getElementById('jbrq-currency');
    if (curEl) curEl.addEventListener('change', () => { formData.budget_currency = curEl.value; saveDraft(); });

    const cityEl = document.getElementById('city-input');
    if (cityEl) {
        cityEl.addEventListener('input', () => { formData.client_city = cityEl.value; });

        // Google Places Autocomplete si está disponible
        if (typeof google !== 'undefined' && google.maps && google.maps.places) {
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
                // Google Places no disponible: el input de texto alcanza
            }
        }
    }

    const flexEl = document.getElementById('jbrq-flexible-dates');
    if (flexEl) flexEl.addEventListener('change', () => { formData.flexible_dates = flexEl.checked; saveDraft(); });

    const interpEl = document.getElementById('jbrq-open-interp');
    if (interpEl) interpEl.addEventListener('change', () => { formData.open_interpretation = interpEl.checked; saveDraft(); });
}

window.selectZone = function(card) {
    document.querySelectorAll('#jbrq-zones .jbrq-zone').forEach(c => {
        c.classList.remove('is-active');
        c.setAttribute('aria-pressed', 'false');
    });
    card.classList.add('is-active');
    card.setAttribute('aria-pressed', 'true');
    formData.tattoo_body_part = card.dataset.zone;
    saveDraft();
};

window.selectSide = function(chip) {
    const value = chip.dataset.side;
    const wasActive = formData.tattoo_body_side === value;
    document.querySelectorAll('#jbrq-side-chips .wo-chip').forEach(c => {
        c.classList.remove('is-active');
        c.setAttribute('aria-pressed', 'false');
    });
    if (wasActive) {
        formData.tattoo_body_side = null;
    } else {
        chip.classList.add('is-active');
        chip.setAttribute('aria-pressed', 'true');
        formData.tattoo_body_side = value;
    }
    saveDraft();
};

window.toggleStyle = function(chip) {
    chip.classList.toggle('is-active');
    const styleName = chip.dataset.style;
    let selected = selectedStylesArray().slice();

    if (chip.classList.contains('is-active')) {
        if (!selected.includes(styleName)) selected.push(styleName);
    } else {
        selected = selected.filter(s => s !== styleName);
    }
    chip.setAttribute('aria-pressed', chip.classList.contains('is-active') ? 'true' : 'false');
    formData.tattoo_style = selected;
    saveDraft();
};

window.selectColor = function(input) {
    formData.tattoo_color_type = input.value;
    saveDraft();
};

// --- Calendario inline (fecha aproximada) ---

function selectedDate() {
    if (!formData.preferred_date || !/^\d{4}-\d{2}-\d{2}$/.test(formData.preferred_date)) return null;
    const [y, m, d] = formData.preferred_date.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function renderCalendar() {
    const wrap = document.getElementById('jbrq-calendar');
    if (!wrap) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (!calCursor) {
        const sel = selectedDate();
        const base = sel && sel >= today ? sel : today;
        calCursor = new Date(base.getFullYear(), base.getMonth(), 1);
    }

    const year = calCursor.getFullYear();
    const month = calCursor.getMonth();
    const monthName = calCursor.toLocaleDateString('es-AR', { month: 'long' });
    const monthLabel = monthName.charAt(0).toUpperCase() + monthName.slice(1) + ' ' + year;
    const canGoPrev = new Date(year, month, 1) > new Date(today.getFullYear(), today.getMonth(), 1);

    // Lunes como primer día de la semana
    const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
    const gridStart = new Date(year, month, 1 - firstDow);
    const sel = selectedDate();

    let cells = '';
    for (let i = 0; i < 42; i++) {
        const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
        const iso = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
        const isOut = day.getMonth() !== month;
        const isPast = day < today;
        const isSelected = sel && day.getTime() === sel.getTime();
        cells += `
            <button type="button" class="jbrq-cal-day ${isOut ? 'is-out' : ''} ${isSelected ? 'is-selected' : ''}"
                data-date="${iso}" ${isPast ? 'disabled' : ''} onclick="pickDate(this)"
                aria-label="${iso}" ${isSelected ? 'aria-current="date"' : ''}>${day.getDate()}</button>
        `;
    }

    wrap.innerHTML = `
        <div class="jbrq-cal-head">
            <button type="button" class="jbrq-cal-nav" onclick="calShift(-1)" ${canGoPrev ? '' : 'disabled'} aria-label="Mes anterior"><i data-wo-icon="chevron-left" class="wo-icon-18"></i></button>
            <span class="jbrq-cal-title">${monthLabel}</span>
            <button type="button" class="jbrq-cal-nav" onclick="calShift(1)" aria-label="Mes siguiente"><i data-wo-icon="chevron-right" class="wo-icon-18"></i></button>
        </div>
        <div class="jbrq-cal-grid">
            ${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => `<span class="jbrq-cal-dow" aria-hidden="true">${d}</span>`).join('')}
            ${cells}
        </div>
    `;
}

window.calShift = function(delta) {
    if (!calCursor) return;
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + delta, 1);
    renderCalendar();
};

window.pickDate = function(btn) {
    const iso = btn.dataset.date;
    if (!iso) return;
    formData.preferred_date = (formData.preferred_date === iso) ? '' : iso;
    saveDraft();
    renderCalendar();
};

// --- Dropzones de referencia (3 slots) ---

function renderRefSlots() {
    const wrap = document.getElementById('jbrq-refs');
    if (!wrap) return;

    let html = '';
    for (let i = 0; i < MAX_FILES; i++) {
        const file = uploadedFiles[i];
        if (file) {
            html += `
                <div class="jbrq-refslot has-image">
                    <img src="${URL.createObjectURL(file)}" alt="Referencia ${i + 1}">
                    <button type="button" class="jbrq-ref-remove" onclick="removeFile(${i})" title="Quitar referencia" aria-label="Quitar referencia ${i + 1}"><i data-wo-icon="x" class="wo-icon-18"></i></button>
                </div>
            `;
        } else if (i === uploadedFiles.length) {
            html += `
                <div class="wo-dropzone jbrq-refslot jbrq-refslot--drop" id="jbrq-dropzone" onclick="triggerFileInput()" ondrop="handleDrop(event)" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" role="button" tabindex="0" aria-label="Subir imagen de referencia">
                    <i data-wo-icon="arrow-up" aria-hidden="true"></i>
                    <p class="jbrq-drop-title">Arrastrá o hacé click</p>
                    <p class="jbrq-drop-help">PNG, JPG o WebP · máx. 5 MB</p>
                </div>
            `;
        } else {
            html += `
                <button type="button" class="jbrq-refslot is-placeholder" onclick="triggerFileInput()">
                    <i data-wo-icon="image" aria-hidden="true"></i>
                    <span class="wo-meta-s">Referencia ${i + 1}</span>
                </button>
            `;
        }
    }
    wrap.innerHTML = html;
}

window.triggerFileInput = function() {
    document.getElementById('jbrq-file-input')?.click();
};

window.handleFileSelect = function(e) {
    const files = Array.from(e.target.files || []);
    addFiles(files);
    e.target.value = '';
};

window.handleDragOver = function(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('jbrq-dropzone')?.classList.add('dragover');
};

window.handleDragLeave = function(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('jbrq-dropzone')?.classList.remove('dragover');
};

window.handleDrop = function(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('jbrq-dropzone')?.classList.remove('dragover');
    const files = Array.from(e.dataTransfer?.files || []);
    addFiles(files);
};

async function addFiles(files) {
    const remaining = MAX_FILES - uploadedFiles.length;
    if (remaining <= 0) {
        showFormNotice('Máximo ' + MAX_FILES + ' imágenes de referencia');
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
            showFormNotice('El archivo ' + file.name + ' supera los 5 MB tras compresión');
            continue;
        }

        uploadedFiles.push(compressed);
    }

    renderRefSlots();
}

window.removeFile = function(index) {
    uploadedFiles.splice(index, 1);
    renderRefSlots();
};

// --- Validación y paso a revisión ---

function syncFormFields() {
    const textarea = document.getElementById('jbrq-description');
    if (textarea) formData.tattoo_idea_description = textarea.value;
    const firstCb = document.getElementById('jbrq-first-tattoo');
    if (firstCb) formData.is_first_tattoo = firstCb.checked;
    const coverCb = document.getElementById('jbrq-cover-up');
    if (coverCb) formData.is_cover_up = coverCb.checked;
    const sizeEl = document.getElementById('jbrq-size');
    if (sizeEl && sizeEl.value) formData.tattoo_size = sizeEl.value;
    const minEl = document.getElementById('jbrq-budget-min');
    if (minEl) formData.budget_min = minEl.value;
    const maxEl = document.getElementById('jbrq-budget-max');
    if (maxEl) formData.budget_max = maxEl.value;
    const curEl = document.getElementById('jbrq-currency');
    if (curEl) formData.budget_currency = curEl.value;
    const cityEl = document.getElementById('city-input');
    if (cityEl) formData.client_city = cityEl.value;
    const flexEl = document.getElementById('jbrq-flexible-dates');
    if (flexEl) formData.flexible_dates = flexEl.checked;
    const interpEl = document.getElementById('jbrq-open-interp');
    if (interpEl) formData.open_interpretation = interpEl.checked;
}

window.continueToReview = function() {
    syncFormFields();

    if (!formData.tattoo_idea_description || formData.tattoo_idea_description.trim().length < 10) {
        const textarea = document.getElementById('jbrq-description');
        if (textarea) {
            textarea.classList.add('wo-input--error');
            textarea.focus();
        }
        showFormNotice('La descripción tiene que tener al menos 10 caracteres');
        return;
    }
    if (!formData.tattoo_body_part) {
        showFormNotice('Elegí una parte del cuerpo');
        document.getElementById('jbrq-zones')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    if (!formData.tattoo_size) {
        showFormNotice('Elegí un tamaño aproximado');
        document.getElementById('jbrq-size')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    const min = parseFloat(formData.budget_min);
    const max = parseFloat(formData.budget_max);
    if (!isNaN(min) && !isNaN(max) && min > max) {
        showFormNotice('El presupuesto mínimo no puede superar al máximo');
        document.getElementById('jbrq-budget-min')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    setView('review');
};

// ============================================
// VISTA 2 · REVISIÓN ("Revisá tu publicación")
// ============================================

function formatNumber(value) {
    const n = parseFloat(value);
    if (isNaN(n)) return null;
    return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n);
}

function formatStyleDisplay() {
    const styles = selectedStylesArray();
    if (styles.length === 0) return 'Sin preferencia';
    return styles.join(', ');
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
    const found = SIZES.find(s => s.value === formData.tattoo_size);
    return found ? found.label : '–';
}

function formatBudgetDisplay() {
    const min = formatNumber(formData.budget_min);
    const max = formatNumber(formData.budget_max);
    const currency = formData.budget_currency || 'USD';
    if (min && max) return `$${min} – $${max} ${currency}`;
    if (min) return `Desde $${min} ${currency}`;
    if (max) return `Hasta $${max} ${currency}`;
    return '';
}

function formatDateDisplay() {
    const sel = selectedDate();
    if (!sel) return formData.flexible_dates ? 'A coordinar · fechas flexibles' : '';
    const long = sel.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
    return formData.flexible_dates ? long + ' · fechas flexibles' : long;
}

function renderReview(el) {
    const title = deriveRequestTitle(formData.tattoo_idea_description, selectedStylesArray(), formData.tattoo_body_part);
    const zone = [formData.tattoo_body_part, formData.tattoo_body_side ? 'lado ' + String(formData.tattoo_body_side).toLowerCase() : null]
        .filter(Boolean).join(' · ');
    const openInterp = formData.open_interpretation !== false;

    const refsHtml = uploadedFiles.length > 0
        ? `<div class="jbrq-preview-refs">${uploadedFiles.map((file, i) =>
            `<img src="${URL.createObjectURL(file)}" alt="Referencia ${i + 1}">`).join('')}</div>`
        : '';

    const cell = (label, value, extraClass) => `
        <div class="jbrq-cell">
            <dt>${label}</dt>
            <dd class="${extraClass || ''}">${value}</dd>
        </div>
    `;

    el.innerHTML = `
        <header class="jbrq-head">
            <h1 class="wo-h1 jbrq-title">Revisá tu publicación</h1>
            <p class="jbrq-sub">Así la van a ver los tatuadores en el Job Board.</p>
        </header>

        <article class="wo-card wo-card--flat jbrq-preview">
            <span class="wo-eyebrow">Tu idea</span>
            ${title ? `<h2 class="wo-h3 jbrq-preview-title">${escapeHtml(title)}</h2>` : ''}
            <p class="jbrq-preview-desc">${escapeHtml(formData.tattoo_idea_description || '–')}</p>
            ${refsHtml}
            <hr class="wo-divider">
            <dl class="jbrq-preview-grid">
                ${cell('Estilo', escapeHtml(formatStyleDisplay()))}
                ${cell('Zona del cuerpo', escapeHtml(zone || '–'))}
                ${cell('Tamaño', escapeHtml(formatSizeDisplay()))}
                ${cell('Color', escapeHtml(formatColorDisplay()))}
                ${cell('Presupuesto', escapeHtml(formatBudgetDisplay() || 'A conversar'))}
                ${cell('Ciudad', escapeHtml(formData.client_city || '–'))}
                ${cell('Fecha', escapeHtml(formatDateDisplay() || 'A definir'))}
                ${cell('Interpretación', openInterp ? 'Abierta al artista' : 'Fiel a tu idea', openInterp ? 'is-success' : '')}
                ${formData.is_first_tattoo ? cell('Primer tatuaje', 'Sí') : ''}
                ${formData.is_cover_up ? cell('Cover-up', 'Sí') : ''}
            </dl>
        </article>

        <div class="jbrq-review-actions">
            <p class="wo-meta-s wo-muted jbrq-logged-as" id="jbrq-logged-as"></p>
            <div class="jbrq-review-btns">
                <button type="button" class="wo-btn wo-btn--secondary" onclick="setView('form')"><i data-wo-icon="edit" class="wo-icon-18" aria-hidden="true"></i>Editar</button>
                <button type="button" class="wo-btn wo-btn--direct wo-btn--hard" id="jbrq-btn-publish" onclick="startPublish()">Publicar idea →</button>
            </div>
        </div>
    `;

    fillLoggedAs();
}

async function fillLoggedAs() {
    const label = document.getElementById('jbrq-logged-as');
    if (!label || !_supabase) return;
    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) {
            label.textContent = 'Para publicarla vas a crear tu cuenta en el paso siguiente';
            return;
        }
        const { data: client } = await WeotziData.Clients.getByUserId(session.user.id);
        const name = client?.full_name || session.user.user_metadata?.full_name || session.user.email;
        label.textContent = 'Publicás como ' + name;
    } catch (e) { /* silencioso */ }
}

// ============================================
// PUBLICAR (gate de cuenta + submit)
// ============================================

window.startPublish = async function() {
    if (!_supabase) {
        showFormNotice('Servicio no disponible. Recargá la página.');
        return;
    }
    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) {
            setView('auth');
            return;
        }

        const { data: client } = await WeotziData.Clients.getByUserId(session.user.id);
        if (client) {
            formData._user_id = session.user.id;
            formData._client_email = client.email || session.user.email;
            formData._client_name = client.full_name || '';
        } else {
            // Sesión sin perfil de cliente (p. ej. artista probando el flujo)
            formData._user_id = session.user.id;
            formData._client_email = session.user.email;
            formData._client_name = session.user.user_metadata?.full_name || session.user.email.split('@')[0];
        }
        submitRequest();
    } catch (err) {
        console.error('Error checking session:', err);
        setView('auth');
    }
};

// ============================================
// VISTA 3 · CUENTA (auth-gate inline)
// ============================================

function renderAuth(el) {
    el.innerHTML = `
        <div class="jbrq-auth">
            <button type="button" class="wo-btn wo-btn--ghost wo-btn--s jbrq-auth-back" onclick="setView('review')">← Volver a la revisión</button>
            <header class="jbrq-head">
                <h1 class="wo-h2 jbrq-title">Publicá tu idea</h1>
                <p class="jbrq-sub">Necesitás una cuenta para publicarla y recibir propuestas.</p>
            </header>

            <div class="wo-tabs jbrq-auth-tabs">
                <button type="button" class="wo-tab is-active" data-tab="register" onclick="switchAuthTab('register')">Crear cuenta</button>
                <button type="button" class="wo-tab" data-tab="login" onclick="switchAuthTab('login')">Iniciar sesión</button>
            </div>

            <div id="jb-auth-register" class="jbrq-auth-panel is-active">
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
                <div id="jb-reg-message" class="jbrq-msg" role="status"></div>
                <button type="button" class="wo-btn wo-btn--ink wo-btn--hard wo-btn--block" id="jb-btn-register" onclick="handleJBRegister()">Crear cuenta y publicar</button>
            </div>

            <div id="jb-auth-login" class="jbrq-auth-panel">
                <div class="wo-field">
                    <label class="wo-label" for="jb-login-email">Email</label>
                    <input type="email" id="jb-login-email" class="wo-input" placeholder="tu@email.com" autocomplete="email">
                </div>
                <div class="wo-field">
                    <label class="wo-label" for="jb-login-password">Contraseña</label>
                    <input type="password" id="jb-login-password" class="wo-input" placeholder="Tu contraseña" autocomplete="current-password">
                </div>
                <div id="jb-login-message" class="jbrq-msg" role="status"></div>
                <button type="button" class="wo-btn wo-btn--ink wo-btn--hard wo-btn--block" id="jb-btn-login" onclick="handleJBLogin()">Iniciar sesión y publicar</button>
            </div>
        </div>
    `;
}

window.switchAuthTab = function(tab) {
    document.querySelectorAll('.jbrq-auth-tabs .wo-tab').forEach(t => t.classList.remove('is-active'));
    document.querySelector(`.jbrq-auth-tabs .wo-tab[data-tab="${tab}"]`)?.classList.add('is-active');

    document.getElementById('jb-auth-register').classList.toggle('is-active', tab === 'register');
    document.getElementById('jb-auth-login').classList.toggle('is-active', tab === 'login');
};

// ============================================
// AUTH HANDLERS (cableado legacy preservado)
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

    if (msgEl) { msgEl.textContent = ''; msgEl.className = 'jbrq-msg'; }

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

            showAuthMessage('jb-reg-message', 'Cuenta creada. Publicando tu idea…', 'success');

            setTimeout(() => {
                view = 'review';
                renderView();
                submitRequest();
            }, 700);
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

        showAuthMessage('jb-login-message', 'Sesión iniciada. Publicando tu idea…', 'success');

        setTimeout(() => {
            view = 'review';
            renderView();
            submitRequest();
        }, 700);

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
    el.className = 'jbrq-msg jbrq-msg--' + type;
}

// ============================================
// SUBMIT REQUEST (cableado legacy preservado)
// ============================================

window.submitRequest = async function() {
    if (isSubmitting) return;
    if (!_supabase) {
        showFormNotice('Servicio no disponible. Recargá la página.');
        return;
    }
    isSubmitting = true;

    const btn = document.getElementById('jbrq-btn-publish');
    const overlay = document.getElementById('loading-overlay');

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Publicando…';
    }
    if (overlay) overlay.classList.remove('wo-hidden');

    try {
        const tempId = crypto.randomUUID ? crypto.randomUUID() : generateTempId();

        // Sin columna para "interpretación abierta": va como línea final de la descripción
        const baseDescription = (formData.tattoo_idea_description || '').trim();
        const finalDescription = formData.open_interpretation !== false
            ? baseDescription + '\n\n' + OPEN_INTERP_MARK
            : baseDescription;

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
        const stylesArray = selectedStylesArray();
        if (stylesArray.length > 0) {
            stylesValue = JSON.stringify(stylesArray);
        }

        // 3. Insert into job_board_requests
        const requestPayload = {
            client_user_id: formData._user_id,
            tattoo_body_part: formData.tattoo_body_part || null,
            tattoo_body_side: formData.tattoo_body_side || null,
            tattoo_idea_description: finalDescription || null,
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
                    tattoo_idea_description: finalDescription,
                    tattoo_size: formData.tattoo_size,
                    tattoo_style: stylesArray,
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
                    dashboard_url: window.location.origin + '/client/requests?id=' + insertedRequest.id
                });
                console.log('n8n event sent: job_board_request_created');
            } catch (webhookErr) {
                console.warn('Could not send job_board_request_created event:', webhookErr);
            }
        }

        // 6. Clear draft
        clearDraft();

        // 7. Redirect al seguimiento de la solicitud
        if (overlay) overlay.classList.add('wo-hidden');
        if (btn) btn.textContent = 'Idea publicada';

        console.log('Job board request submitted successfully:', insertedRequest.id);

        setTimeout(() => {
            window.location.href = '/client/requests?id=' + insertedRequest.id;
        }, 1200);

    } catch (error) {
        console.error('Error submitting request:', error);
        isSubmitting = false;
        if (overlay) overlay.classList.add('wo-hidden');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Publicar idea →';
        }
        showFormNotice('No pudimos publicar tu idea. Probá de nuevo.');
    }
};

function generateTempId() {
    return 'jb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// ============================================
// UI HELPERS
// ============================================

function parseList(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        const raw = value.trim();
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
            return raw.split(',').map(s => s.trim()).filter(Boolean);
        }
    }
    return [];
}

function showFormNotice(message) {
    let notice = document.getElementById('jbrq-notice');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'jbrq-notice';
        notice.className = 'jbrq-notice';
        document.body.appendChild(notice);
    }
    notice.textContent = message;
    notice.classList.add('is-visible');
    clearTimeout(notice._timer);
    notice._timer = setTimeout(() => {
        notice.classList.remove('is-visible');
    }, 3000);
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(text)));
    return div.innerHTML;
}
