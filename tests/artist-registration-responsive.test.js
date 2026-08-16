// Tests del wizard de registro de artistas (public/register-artist/index.html).
// Diseño actual: DS Bauhaus — el CSS de página vive en
// public/shared/css/register-artist-ds.css (solo tokens var(--token) de
// public/shared/css/ds/tokens.css); la tipografía de preguntas es
// var(--font-display) (Archivo Black) y el chrome es wo-topbar del DS.
// La lógica sigue en public/shared/js/register.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const registerArtistHtml = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'register-artist', 'index.html'),
    'utf8'
);
const registerJs = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'shared', 'js', 'register.js'),
    'utf8'
);
const dsCss = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'shared', 'css', 'register-artist-ds.css'),
    'utf8'
);
const tokensCss = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'shared', 'css', 'ds', 'tokens.css'),
    'utf8'
);

// Extrae un bloque @media (max-width:Npx){...} del CSS del DS.
// Los bloques responsive van en orden (1024 → 768 → 600 → 480) al final del archivo.
function mediaBlock(width) {
    const marker = `@media (max-width:${width}px){`;
    const start = dsCss.indexOf(marker);
    assert.notEqual(start, -1, `missing media block: ${marker}`);
    const next = dsCss.indexOf('@media', start + marker.length);
    return next === -1 ? dsCss.slice(start) : dsCss.slice(start, next);
}

test('artist registration removes the standalone artist city step', () => {
    assert.doesNotMatch(registerArtistHtml, /id="city"/);
    assert.doesNotMatch(registerArtistHtml, /Step 4: City\/Location/);
    assert.doesNotMatch(registerArtistHtml, /wo-step04/);
    assert.doesNotMatch(registerArtistHtml, /data-step="12"/);
    // El paso 4 es Estilos (grupo "Tu oficio"), no Ubicación.
    assert.match(registerArtistHtml, /<section class="form-step wo-bauhaus-step wo-step05" data-step="4">[\s\S]*?04 · Tu oficio[\s\S]*?¿Qué estilos<br>trabajás\?/);
    assert.match(registerJs, /totalSteps:\s*11/);
    assert.doesNotMatch(registerJs, /case 4:\s*const city/);
    assert.match(registerJs, /case 4:\s*if \(formState\.data\.styles\.length === 0\)/);
    assert.match(registerJs, /if \(!Array\.isArray\(d\.styles\) \|\| d\.styles\.length === 0\) return 4/);
});

test('artist registration option chips wrap and stay usable at tablet and phone widths', () => {
    // Los pasos densos (estilos/experiencia/portfolio) usan chips que envuelven:
    // el contenido nunca queda recortado porque la página escrolea normalmente.
    assert.match(dsCss, /\.styles-grid,\s*\.experience-options,\s*\.portfolio-source-options\{\s*display:flex;\s*flex-wrap:wrap/);
    assert.match(dsCss, /\.style-option,\s*\.experience-option,\s*\.portfolio-source-option\{[^}]*min-height:var\(--control-h-sm\)/);
    // Estados de selección con tokens: múltiple (estilos) amarillo, única azul.
    assert.match(dsCss, /\.style-option\.selected\{\s*background:var\(--yellow-300\)/);
    assert.match(dsCss, /\.experience-option\.selected,\s*\.portfolio-source-option\.selected\{\s*background:var\(--blue-100\)/);
    // En phones los chips se compactan sin desaparecer.
    const xs = mediaBlock(480);
    assert.match(xs, /\.styles-grid,\s*\.experience-options,\s*\.portfolio-source-options\{gap:var\(--space-2\)\}/);
    assert.match(xs, /\.style-option,\s*\.experience-option,\s*\.portfolio-source-option\{font-size:11px/);
    // Hooks del paso de estilos.
    assert.match(registerArtistHtml, /id="styles-grid"/);
    assert.match(registerArtistHtml, /id="custom-style-wrapper"/);
    assert.match(registerArtistHtml, /id="add-custom-style-btn"/);
});

test('artist registration steps flow with the page without the old fixed poster shell', () => {
    // La columna póster del diseño anterior quedó fuera del layout.
    assert.match(dsCss, /\.wo-poster-col\{display:none !important\}/);
    // Un paso visible a la vez, en flujo normal de documento (sin shell fijo).
    assert.match(dsCss, /\.form-step\{display:none\}/);
    assert.match(dsCss, /\.form-step\.active\{\s*display:block/);
    assert.doesNotMatch(dsCss, /\.register-container\{[^}]*position:fixed/);
    // Los únicos bloqueos de scroll son los de modales móviles.
    assert.match(dsCss, /body\.summary-review-lock,\s*body\.bio-modal-lock\{overflow:hidden\}/);
});

test('artist registration form controls use DS control tokens and stack on narrow screens', () => {
    assert.match(dsCss, /\.form-input,\s*\.birth-select,\s*\.currency-select,\s*\.studio-location-select\{\s*width:100%;\s*box-sizing:border-box;\s*min-height:var\(--control-h-md\)/);
    assert.match(dsCss, /\.form-input:focus,[\s\S]*?\.studio-location-select:focus\{[^}]*border:var\(--border-strong-width\) solid var\(--border-focus\)/);
    assert.match(dsCss, /\.form-input\.error\{border:var\(--border-strong-width\) solid var\(--system-error\)/);
    // En tablet los controles largos se apilan a ancho completo.
    const sm = mediaBlock(768);
    assert.match(sm, /\.price-wrapper\{flex-direction:column\}/);
    assert.match(sm, /\.currency-select\{width:100%\}/);
    assert.match(sm, /\.birth-date-selects\{grid-template-columns:repeat\(3,1fr\)\}/);
});

test('artist registration shell keeps topbar, progress hooks and container anchored', () => {
    // Topbar del DS con nav de grupos y sync de progreso.
    assert.match(registerArtistHtml, /<header class="wo-topbar ra-topbar"/);
    assert.equal((registerArtistHtml.match(/class="ra-group[" ]/g) || []).length, 7, 'topbar must list the 7 wizard groups');
    assert.match(registerArtistHtml, /id="ra-progress-copy"/);
    assert.match(registerArtistHtml, /new MutationObserver\(syncTopbarFromLabel\)/);
    // Hooks legacy de progreso que register.js sigue escribiendo.
    assert.match(registerArtistHtml, /class="ra-legacy-progress" hidden[\s\S]*?id="progress-fill"[\s\S]*?id="progress-label"/);
    assert.match(dsCss, /\.ra-legacy-progress\{display:none\}/);
    // Contenedor centrado y con box-sizing correcto; topbar pegada arriba.
    assert.match(dsCss, /\.register-container\{[^}]*max-width:824px[^}]*margin:0 auto[^}]*box-sizing:border-box/);
    assert.match(dsCss, /\.ra-topbar\{\s*position:sticky;\s*top:0/);
    // Responsive del chrome: grupos fuera en 1024, burger + drawer en 768.
    assert.match(mediaBlock(1024), /\.ra-topbar-groups\{display:none\}/);
    const sm = mediaBlock(768);
    assert.match(sm, /\.ra-burger\{display:inline-flex\}/);
    assert.match(sm, /\.register-container\{padding:/);
    assert.match(registerArtistHtml, /id="wo-drawer" aria-hidden="true"/);
    assert.match(registerArtistHtml, /function toggleWoDrawer\(forceState\)/);
});

test('artist registration mobile shows a styled continue CTA instead of the hidden footer nav', () => {
    // El footer de navegación legacy queda oculto; los botones por paso son proxies.
    assert.match(dsCss, /\.register-footer\{display:none\}/);
    assert.match(registerArtistHtml, /id="btn-back"/);
    assert.match(registerArtistHtml, /id="btn-next"/);
    assert.match(registerArtistHtml, /document\.getElementById\('btn-next'\)\?\.click\(\)/);
    // En móvil el wo-next-btn se oculta y register.js inyecta .mobile-continue-btn.
    const mobile = mediaBlock(600);
    assert.match(mobile, /\.wo-next-btn\{display:none\}/);
    assert.match(mobile, /\.success-step \.wo-next-btn,\s*\.saving-step \.wo-next-btn\{display:inline-flex\}/);
    assert.match(mobile, /\.mobile-continue-btn\{display:flex\}/);
    assert.match(dsCss, /\.mobile-continue-btn\{[^}]*min-height:var\(--control-h-lg\)[^}]*background:var\(--action-primary\)/);
    assert.match(dsCss, /\.mobile-continue-btn\.submit-btn\{\s*background:var\(--action-accent\)/);
    assert.match(registerJs, /function injectMobileContinueBtn\(stepEl\)/);
    assert.match(registerJs, /btn\.className = 'mobile-continue-btn'/);
    assert.match(registerJs, /btn\.classList\.add\('submit-btn'\)/);
    // Footer institucional inyectado por componente compartido.
    assert.match(registerArtistHtml, /<footer class="bauhaus-footer" data-bauhaus-footer/);
});

test('artist registration mobile swaps desktop hints for compact terms row and mobile copy', () => {
    assert.match(dsCss, /\.mobile-terms\{display:none\}/);
    assert.match(dsCss, /\.question-subtitle \.mobile-copy\{display:none\}/);
    const mobile = mediaBlock(600);
    assert.match(mobile, /\.wo-step01-actions\{flex-wrap:wrap\}/);
    assert.match(mobile, /\.keyhint\{order:3;flex-basis:100%/);
    assert.match(mobile, /\.desktop-keyhint\{display:none\}/);
    assert.match(mobile, /\.mobile-terms\{display:inline\}/);
    assert.match(mobile, /\.question-subtitle \.desktop-copy\{display:none\}/);
    assert.match(mobile, /\.question-subtitle \.mobile-copy\{display:inline\}/);
    assert.match(registerArtistHtml, /class="mobile-terms"><a href="https:\/\/weotzi\.com\/terms"/);
    assert.match(registerArtistHtml, /<span class="mobile-copy">/);
});

test('artist registration propagates the DS question system to every wizard step', () => {
    const chunks = registerArtistHtml.split('<section class="form-step').slice(1);
    const steps = chunks.map((chunk) => {
        const m = chunk.match(/data-step="([^"]+)"/);
        assert.ok(m, 'every form-step section declares data-step');
        return { step: m[1], chunk };
    });
    assert.deepEqual(
        steps.map(s => s.step),
        ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', 'summary', 'saving', 'success'],
        'wizard must keep steps 0-11 plus summary/saving/success in order'
    );
    for (const { step, chunk } of steps) {
        assert.ok(chunk.includes('wo-form-col'), `step ${step} keeps the wo-form-col column`);
        assert.ok(chunk.includes('question-title'), `step ${step} keeps its question-title`);
        assert.ok(chunk.includes('step-indicator'), `step ${step} keeps the legacy step-indicator hook`);
    }
    const numbered = steps.filter(s => /^([1-9]|1[01])$/.test(s.step));
    for (const { step, chunk } of numbered) {
        assert.ok(chunk.includes('wo-step01-actions'), `step ${step} keeps its actions row`);
        assert.ok(chunk.includes('wo-back-btn'), `step ${step} keeps its back proxy`);
        assert.ok(chunk.includes('wo-next-btn'), `step ${step} keeps its continue proxy`);
    }
    const summary = steps.find(s => s.step === 'summary');
    assert.ok(summary.chunk.includes('wo-step01-actions') && summary.chunk.includes('wo-next-btn'));
    // El sistema tipográfico de la pregunta se define una sola vez con tokens.
    assert.match(dsCss, /\.question-title\{[^}]*font-family:var\(--font-display\)/);
    assert.match(dsCss, /\.wo-step-indicator\{[^}]*font-family:var\(--font-mono\)/);
});

test('artist registration success screen keeps the DS confirmation state', () => {
    assert.match(registerArtistHtml, /class="form-step wo-bauhaus-step wo-step-success success-step" data-step="success"/);
    assert.match(registerArtistHtml, /class="question-title success-title"/);
    assert.match(registerArtistHtml, /class="success-animation"/);
    assert.match(registerArtistHtml, /href="\/registerclosedbeta" class="wo-next-btn"/);
    assert.match(dsCss, /\.saving-step \.wo-form-col,\s*\.success-step \.wo-form-col\{\s*align-items:center;\s*text-align:center/);
    assert.match(dsCss, /\.success-circle\{[^}]*background:var\(--status-success-bg\);\s*border:var\(--border-strong-width\) solid var\(--system-success\)/);
    assert.match(dsCss, /\.success-check\{[^}]*color:var\(--success-fg\)/);
    assert.match(dsCss, /\.success-step \.wo-step01-actions\{border-top:0;justify-content:center/);
});

test('artist registration step question titles use the DS display font', () => {
    // Archivo Black vía token --font-display; Source Serif 4 quedó fuera.
    assert.match(registerArtistHtml, /family=Archivo\+Black/);
    assert.doesNotMatch(registerArtistHtml, /Source\+Serif|Source Serif/);
    assert.doesNotMatch(registerArtistHtml, /--question-serif/);
    assert.doesNotMatch(dsCss, /Source Serif/);
    assert.match(tokensCss, /--font-display:'Archivo Black'/);
    assert.match(dsCss, /\.question-title\{[^}]*font-family:var\(--font-display\)/);
    assert.match(dsCss, /\.ra-intro-title\{[^}]*font-family:var\(--font-display\)/);
    // El CSS inline de 2.699 líneas fue reemplazado por la hoja del DS.
    assert.doesNotMatch(registerArtistHtml, /<style[\s>]/);
});

test('artist registration review step uses a scrollable mobile modal without losing editing hooks', () => {
    assert.match(registerArtistHtml, /id="summary-mobile-open"[\s\S]*?class="summary-mobile-open"[\s\S]*?aria-controls="summary-review-modal"/);
    assert.match(registerArtistHtml, /id="summary-review-modal"[\s\S]*?class="summary-review-modal"[\s\S]*?aria-hidden="true"/);
    assert.match(registerArtistHtml, /id="summary-review-close"[\s\S]*?class="summary-review-close"/);
    assert.match(registerArtistHtml, /class="summary-review-scroll"[\s\S]*?id="summary-card"/);
    // Desktop: la card se ve inline; móvil: botón que abre el modal fijo con scroll.
    assert.match(dsCss, /\.summary-mobile-open\{display:none\}/);
    assert.match(dsCss, /\.summary-review-modal\{display:block\}/);
    const mobile = mediaBlock(600);
    assert.match(mobile, /\.summary-mobile-open\{\s*display:flex/);
    assert.match(mobile, /\.summary-review-modal\{\s*display:none;\s*position:fixed;\s*inset:0/);
    assert.match(mobile, /\.summary-review-modal\.is-open\{display:flex;align-items:flex-end\}/);
    assert.match(mobile, /\.summary-review-modal\.is-open \.summary-review-panel\{[^}]*max-height:86vh/);
    assert.match(mobile, /\.summary-review-modal\.is-open \.summary-review-scroll\{overflow:auto;min-height:0\}/);
    assert.match(registerJs, /function setupSummaryReviewModal\(\)/);
    assert.match(registerJs, /summaryOpen\.addEventListener\('click',\s*openSummaryReviewModal\)/);
    assert.match(registerJs, /document\.body\.classList\.add\('summary-review-lock'\)/);
    assert.match(registerJs, /const cell = e\.target\.closest\('\.summary-editable'\)/);
});

test('artist registration review step can edit Instagram from the modal summary', () => {
    assert.match(registerJs, /const portfolioSummary = resolvePortfolioLinks\(usernamePreview\)/);
    assert.match(registerJs, /portfolioEditableHtml = editable\([\s\S]*'edit-field': 'instagram_handle'[\s\S]*'edit-type': 'instagram'/);
    assert.match(registerJs, /let valueToStore = newValue/);
    assert.match(registerJs, /if \(field === 'instagram_handle'\)[\s\S]*replace\(\/\^@\+\/,\s*''\)[\s\S]*formState\.data\.portfolio_source = 'instagram'/);
    assert.match(registerJs, /wizardInput\.value = valueToStore/);
    assert.match(registerJs, /summary-edit-save/);
    assert.match(registerJs, /summary-edit-cancel/);
});

test('artist registration review complex rows expose visible edit buttons', () => {
    assert.match(registerJs, /function jumpToStep\(label,\s*step\)[\s\S]*\$\{editChip\}/);
    assert.match(registerJs, /<div class="summary-label">Estilos<\/div>[\s\S]*\$\{jumpToStep\(stylesHtml,\s*4\)\}/);
    assert.match(registerJs, /<div class="summary-label">Modalidad<\/div>[\s\S]*\$\{jumpToStep\(escapeHtmlSummary\(workTypeDisplay\),\s*9\)\}/);
    assert.match(registerJs, /<div class="summary-label">Fecha de nacimiento<\/div>[\s\S]*\$\{jumpToStep\(birthDateDisplay,\s*10\)\}/);
    assert.match(registerJs, /<div class="summary-label">Newsletter<\/div>[\s\S]*\$\{jumpToStep\(newsletterDisplay,\s*11\)\}/);
    assert.match(registerJs, /summary-media-edit[\s\S]*data-summary-media-edit[\s\S]*Editar/);
    // En el DS el chip de edición es siempre visible y las filas son clickeables.
    assert.match(dsCss, /\.summary-edit-action,\s*\.summary-media-edit\{[^}]*display:inline-flex/);
    assert.match(dsCss, /\.summary-editable,\s*\.summary-jump\{cursor:pointer\}/);
    assert.match(dsCss, /\.summary-editable:hover,\s*\.summary-jump:hover\{background:var\(--surface-input\)\}/);
});

test('artist registration autosave does not let stale draft responses drop selected styles', () => {
    assert.match(registerJs, /let registrationDraftSyncPending = false/);
    assert.match(registerJs, /let registrationDraftLocalVersion = 0/);
    assert.match(registerJs, /function persistRegistrationDraft\(\)[\s\S]*registrationDraftLocalVersion \+= 1/);
    assert.match(registerJs, /if \(registrationDraftSyncInFlight && !options\.force\)[\s\S]*registrationDraftSyncPending = true/);
    assert.match(registerJs, /const syncVersion = registrationDraftLocalVersion/);
    assert.match(registerJs, /const hasNewerLocalChanges = registrationDraftLocalVersion !== syncVersion/);
    assert.match(registerJs, /if \(payload\.artist && !hasNewerLocalChanges\)[\s\S]*applyArtistDraftFromServer\(payload\.artist\)/);
    assert.match(registerJs, /registrationDraftSyncPending \|\| registrationDraftLocalVersion !== syncVersion/);
});

test('artist registration draft resume loads safely before saving session price', () => {
    assert.match(registerJs, /function normalizeSessionPriceAmount\(value\)/);
    assert.match(registerJs, /function extractSessionPriceCurrency\(value\)/);
    assert.match(registerJs, /const serverSessionPrice = normalizeSessionPriceAmount\(artist\.session_price_amount \?\? artist\.session_price\)/);
    assert.match(registerJs, /async function loadRegistrationDraftFromServer\(\)/);
    assert.match(registerJs, /fetch\(apiUrl\(`\/api\/register\/artist-draft\?\$\{params\.toString\(\)\}`\)\)/);
    assert.match(registerJs, /restoredDraftStep = restoreRegistrationDraft\(\)/);
    assert.match(registerJs, /loadedRemoteDraft = await loadRegistrationDraftFromServer\(\)/);
    assert.match(registerJs, /if \(!registrationDraftId \|\| restoredDraftStep \|\| !loadedRemoteDraft\)[\s\S]*saveRegistrationDraftToServer\(\{ force: true \}\)/);
    assert.match(registerJs, /const summarySessionPrice = normalizeSessionPriceAmount\(data\.session_price\)/);
    assert.match(registerJs, /sessionCurrencySelect\.value = data\.session_currency/);
});

test('artist registration review summary card uses DS tokens and stacks on mobile', () => {
    assert.match(dsCss, /\.summary-card\{\s*background:var\(--surface-card\);\s*border:var\(--border-hairline\) solid var\(--border-strong\)/);
    assert.match(dsCss, /\.summary-row\{\s*display:grid;\s*grid-template-columns:180px 1fr/);
    assert.match(dsCss, /\.summary-label\{[^}]*font-family:var\(--font-mono\)[^}]*text-transform:uppercase/);
    assert.match(dsCss, /\.summary-value\{[^}]*min-width:0/);
    assert.match(dsCss, /\.summary-value-text\{overflow-wrap:anywhere;min-width:0\}/);
    assert.match(dsCss, /\.summary-edit-input\{[^}]*border:var\(--border-strong-width\) solid var\(--border-focus\)/);
    assert.match(dsCss, /\.summary-edit-save\{\s*background:var\(--action-primary\)/);
    // En tablet/móvil las filas pasan a una sola columna.
    assert.match(mediaBlock(768), /\.summary-row\{grid-template-columns:1fr;gap:var\(--space-1\)\}/);
});

test('artist registration review terms are DS-styled and wired to the accept gate', () => {
    assert.match(registerArtistHtml, /class="terms-container"[\s\S]*?id="terms-checkbox"[\s\S]*?class="terms-text"/);
    assert.match(registerArtistHtml, /class="terms-info"/);
    assert.match(dsCss, /\.terms-checkbox\{\s*appearance:none;[^}]*border:var\(--border-strong-width\) solid var\(--border-strong\)/);
    assert.match(dsCss, /\.terms-checkbox:checked\{background:var\(--neutral-500\)\}/);
    assert.match(dsCss, /\.terms-checkbox:checked::before\{[^}]*border-left:3px solid var\(--accent\)/);
    assert.match(dsCss, /\.terms-link\{color:var\(--text-link\)\}/);
    assert.match(dsCss, /\.terms-info\{margin:0;font-size:12px;color:var\(--text-muted\)\}/);
});

test('artist registration step 9 opens the bio editor as a mobile modal', () => {
    assert.match(registerArtistHtml, /id="bio-mobile-open"[\s\S]*?class="bio-mobile-open"/);
    assert.match(registerArtistHtml, /id="bio-mobile-preview"[\s\S]*?class="bio-mobile-preview"/);
    assert.match(registerArtistHtml, /id="bio-modal-close"[\s\S]*?class="bio-modal-close"/);
    assert.match(registerArtistHtml, /class="bio-modal-head"/);
    // Desktop: editor inline; móvil: disparador + modal a pantalla completa.
    assert.match(dsCss, /\.bio-mobile-open\{display:none\}/);
    assert.match(dsCss, /\.bio-modal-head\{display:none\}/);
    const mobile = mediaBlock(600);
    assert.match(mobile, /\.bio-mobile-open\{\s*display:flex/);
    assert.match(mobile, /\.bio-editor-wrapper\{display:none\}/);
    assert.match(mobile, /\.bio-editor-wrapper\.bio-modal-open\{\s*display:flex;\s*position:fixed;\s*inset:0/);
    assert.match(mobile, /\.bio-editor-wrapper\.bio-modal-open \.bio-modal-head\{\s*display:flex/);
    assert.match(mobile, /\.bio-editor-wrapper\.bio-modal-open \.bio-editor\{flex:1\}/);
    assert.match(registerJs, /bioModal\.classList\.add\('bio-modal-open'\)/);
    assert.match(registerJs, /document\.body\.classList\.add\('bio-modal-lock'\)/);
});

test('artist registration step 10 work modality collapses cleanly on phones', () => {
    assert.match(dsCss, /\.work-type-options\{\s*display:grid;\s*grid-template-columns:repeat\(auto-fit,minmax\(200px,1fr\)\)/);
    assert.match(dsCss, /\.work-type-option\.selected\{background:var\(--blue-100\);box-shadow:3px 3px 0 var\(--neutral-500\)\}/);
    assert.match(dsCss, /\.work-type-label\{\s*font-family:var\(--font-display\)/);
    assert.match(mediaBlock(480), /\.work-type-options\{grid-template-columns:1fr\}/);
    // Campos condicionales de la modalidad siguen presentes.
    assert.match(registerArtistHtml, /id="studio-name-wrapper"/);
    assert.match(registerArtistHtml, /id="studio-location-select-wrapper"/);
    assert.match(registerArtistHtml, /id="address-picker-wrapper"/);
    assert.match(registerArtistHtml, /id="address_search"/);
    assert.match(registerArtistHtml, /id="studio-address-preview"/);
    assert.match(dsCss, /\.studio-name-wrapper,\s*\.studio-location-select-wrapper,\s*\.address-picker-wrapper\{[\s\S]*?margin-top:var\(--space-4\)/);
});

test('artist registration step 10 scrolls mobile to the follow-up field after work type selection', () => {
    assert.match(registerJs, /function scrollWorkTypeFollowupIntoView\(workType\)/);
    assert.match(registerJs, /window\.matchMedia\('\(max-width: 600px\)'\)\.matches/);
    assert.match(registerJs, /const target = isStudioWork[\s\S]*studio-name-wrapper[\s\S]*address-picker-wrapper/);
    assert.match(registerJs, /scroller\.scrollTo\(\{[\s\S]*top:[\s\S]*behavior: reduceMotion \? 'auto' : 'smooth'[\s\S]*\}\)/);
    assert.match(registerJs, /function selectWorkTypeOption\(btn\)[\s\S]*applyAddressPickerVisibility\(btn\.dataset\.type\)[\s\S]*scrollWorkTypeFollowupIntoView\(btn\.dataset\.type\)/);
});

test('artist registration step 11 newsletter invite keeps the compact copy with DS styling', () => {
    assert.match(registerArtistHtml, /class="newsletter-invite-block"[\s\S]*?class="newsletter-invite"/);
    assert.match(registerArtistHtml, /Radar de artistas We Ötzi/);
    assert.match(registerArtistHtml, /Recibí lanzamientos, mejoras del perfil, oportunidades y avisos importantes para crecer con menos ruido\./);
    assert.doesNotMatch(registerArtistHtml, /Te enviaremos novedades utiles sobre lanzamientos, mejoras del perfil, oportunidades con estudios, convocatorias/);
    assert.match(dsCss, /\.newsletter-invite\{\s*padding:var\(--space-5\);\s*background:var\(--surface-card\)/);
    assert.match(dsCss, /\.newsletter-invite\{[^}]*border-left-width:var\(--border-rule-width\)/);
    assert.match(dsCss, /\.newsletter-option\.selected\{background:var\(--blue-100\);box-shadow:3px 3px 0 var\(--neutral-500\)\}/);
    assert.match(mediaBlock(480), /\.newsletter-option\{width:100%;justify-content:center\}/);
});

test('artist registration step 11 starts without a newsletter default and blocks review until selection', () => {
    assert.match(registerJs, /subscribed_newsletter:\s*null/);
    assert.match(registerJs, /formState\.data\.subscribed_newsletter = null/);
    assert.match(registerJs, /typeof data\.subscribed_newsletter === 'boolean'/);
    assert.match(registerJs, /typeof formState\.data\.subscribed_newsletter !== 'boolean'/);
    assert.match(registerJs, /function setNewsletterSelectionError\(show\)/);
    assert.match(registerJs, /formState\.data\.subscribed_newsletter = btn\.dataset\.subscribe === 'true'/);
    assert.match(registerJs, /setNewsletterSelectionError\(true\)/);
    assert.match(registerArtistHtml, /id="newsletter-options"[^>]*aria-describedby="newsletter-error"/);
    assert.match(registerArtistHtml, /data-subscribe="true"/);
    assert.match(registerArtistHtml, /data-subscribe="false"/);
    assert.match(registerArtistHtml, /id="newsletter-error" role="alert" hidden>Elegí una opción para continuar\./);
    // Estado de error visible con tokens del sistema.
    assert.match(dsCss, /\.newsletter-options\.has-error \.newsletter-option\{border-color:var\(--system-error\)\}/);
    assert.match(dsCss, /\.newsletter-error\{[^}]*color:var\(--status-error-fg\)/);
    assert.match(dsCss, /@keyframes shake\{/);
});

test('artist registration bio editor exposes requested rich text controls', () => {
    assert.match(registerArtistHtml, /data-command="bold"/);
    assert.match(registerArtistHtml, /data-command="italic"/);
    assert.match(registerArtistHtml, /data-command="underline"/);
    assert.match(registerArtistHtml, /data-command="strikeThrough"/);
    assert.match(registerArtistHtml, /data-command="undo"/);
    assert.match(registerArtistHtml, /data-command="redo"/);
    assert.match(registerArtistHtml, /id="text-color-picker"[\s\S]*?type="color"/);
    assert.match(registerArtistHtml, /data-command="createLink"/);
    assert.match(registerArtistHtml, /id="emoji-trigger"[\s\S]*?class="[^"]*emoji-btn/);
    assert.match(registerArtistHtml, /id="emoji-picker"[\s\S]*?class="emoji-picker"[\s\S]*?class="emoji-item"/);
});

test('artist registration mobile bio toolbar preserves touch activation and selection', () => {
    const editorBlockStart = registerJs.indexOf('function initRichTextEditor()');
    const editorBlockEnd = registerJs.indexOf('// Insert text at current caret position', editorBlockStart);
    assert.notEqual(editorBlockStart, -1, 'missing rich text editor initializer');
    assert.notEqual(editorBlockEnd, -1, 'missing rich text editor insertion marker');

    const editorBlock = registerJs.slice(editorBlockStart, editorBlockEnd);
    assert.doesNotMatch(
        editorBlock,
        /toolbar\.addEventListener\('touchstart'[\s\S]*?e\.preventDefault\(\)/,
        'touchstart preventDefault can suppress synthetic clicks on iPhone Chrome/Safari'
    );
    assert.match(editorBlock, /function saveSelectionFromEditor\(\)/);
    assert.match(editorBlock, /function restoreSelection\(\)[\s\S]*bioEditor\.focus\(\)[\s\S]*sel\.addRange\(savedSelection\)/);
    assert.match(editorBlock, /insertTextAtCaret\(emojiBtn\.textContent\);\s*syncBioContent/);
});

test('artist registration bio toolbar uses selection wrapping for mobile-safe inline formatting', () => {
    const editorBlockStart = registerJs.indexOf('function initRichTextEditor()');
    const editorBlockEnd = registerJs.indexOf('// Insert text at current caret position', editorBlockStart);
    const editorBlock = registerJs.slice(editorBlockStart, editorBlockEnd);

    assert.match(editorBlock, /function wrapSelectionWithElement\(tagName,\s*options = \{\}\)/);
    assert.match(editorBlock, /case 'bold':[\s\S]*wrapSelectionWithElement\('strong'\)/);
    assert.match(editorBlock, /case 'italic':[\s\S]*wrapSelectionWithElement\('em'\)/);
    assert.match(editorBlock, /case 'underline':[\s\S]*wrapSelectionWithElement\('u'\)/);
    assert.match(editorBlock, /case 'strikeThrough':[\s\S]*wrapSelectionWithElement\('s'\)/);
    assert.match(editorBlock, /case 'createLink':[\s\S]*wrapSelectionWithElement\('a',\s*\{[\s\S]*href/);
    assert.doesNotMatch(editorBlock, /document\.execCommand\(command/);
});

test('artist registration bio toolbar applies active inline formats to newly typed mobile text', () => {
    const editorBlockStart = registerJs.indexOf('function initRichTextEditor()');
    const editorBlockEnd = registerJs.indexOf('// Insert text at current caret position', editorBlockStart);
    const editorBlock = registerJs.slice(editorBlockStart, editorBlockEnd);

    assert.match(editorBlock, /const activeInlineFormats = \{/);
    assert.match(editorBlock, /function insertFormattedTextAtCaret\(text\)/);
    assert.match(editorBlock, /bioEditor\.addEventListener\('beforeinput'[\s\S]*e\.inputType === 'insertText'[\s\S]*insertFormattedTextAtCaret\(e\.data\)/);
    assert.match(editorBlock, /bioEditor\.addEventListener\('keydown'[\s\S]*e\.key\.length === 1[\s\S]*insertFormattedTextAtCaret\(e\.key\)/);
    assert.match(editorBlock, /function toggleInlineFormat\(formatName\)/);
});

test('artist registration bio toolbar can deactivate inline formats for following text', () => {
    const editorBlockStart = registerJs.indexOf('function initRichTextEditor()');
    const editorBlockEnd = registerJs.indexOf('// Insert text at current caret position', editorBlockStart);
    const editorBlock = registerJs.slice(editorBlockStart, editorBlockEnd);

    assert.match(editorBlock, /function moveCaretOutsideFormat\(formatName\)/);
    assert.match(editorBlock, /function setInlineFormat\(formatName,\s*enabled\)/);
    assert.match(editorBlock, /const currentlyEnabled = activeInlineFormats\[formatName\] \|\| Boolean\(findFormatAncestor\(formatName\)\)/);
    assert.match(editorBlock, /setInlineFormat\(formatName,\s*!currentlyEnabled\)/);
    assert.match(editorBlock, /if \(!enabled\) moveCaretOutsideFormat\(formatName\)/);
});

test('artist registration bio toolbar supports undo and redo history', () => {
    const editorBlockStart = registerJs.indexOf('function initRichTextEditor()');
    const editorBlockEnd = registerJs.indexOf('// Insert text at current caret position', editorBlockStart);
    const editorBlock = registerJs.slice(editorBlockStart, editorBlockEnd);

    assert.match(editorBlock, /const editorHistory = \{/);
    assert.match(editorBlock, /function recordEditorHistory\(/);
    assert.match(editorBlock, /function restoreEditorHistory\(/);
    assert.match(editorBlock, /case 'undo':[\s\S]*restoreEditorHistory\('undo'\)/);
    assert.match(editorBlock, /case 'redo':[\s\S]*restoreEditorHistory\('redo'\)/);
});

test('artist registration DS layer keeps token purity, radius scale and breakpoints', () => {
    // La página carga tokens + componentes + capa DS, y ya no la hoja legacy.
    assert.match(registerArtistHtml, /href="\/shared\/css\/ds\/tokens\.css"/);
    assert.match(registerArtistHtml, /href="\/shared\/css\/ds\/components\.css"/);
    assert.match(registerArtistHtml, /href="\/shared\/css\/register-artist-ds\.css"/);
    assert.doesNotMatch(registerArtistHtml, /shared\/css\/register\.css/);

    // Cero hex sueltos fuera de data-URIs: todo color sale de var(--token).
    const cssSansDataUris = dsCss.replace(/url\((?:"|')?data:[^)]*\)/g, 'url(DATA_URI)');
    const hexMatches = cssSansDataUris.match(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g) || [];
    assert.deepEqual(hexMatches, [], `register-artist-ds.css must not hardcode hex colors: ${hexMatches.join(', ')}`);

    // Radius Bauhaus: solo 0 / 2px / 999px / 50% (vía tokens --radius-*).
    const radiusDecls = dsCss.match(/border-radius:[^;}]*/g) || [];
    assert.ok(radiusDecls.length > 0, 'expected border-radius declarations using radius tokens');
    for (const decl of radiusDecls) {
        assert.match(
            decl,
            /border-radius:(?:var\(--radius-(?:none|sm|pill|circle)\)|0|2px|999px|50%)\s*$/,
            `off-scale border-radius: ${decl}`
        );
    }

    // Breakpoints del DS presentes.
    for (const width of [1024, 768, 600, 480]) {
        assert.ok(dsCss.includes(`@media (max-width:${width}px){`), `missing ${width}px breakpoint`);
    }
});
