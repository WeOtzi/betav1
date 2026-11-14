'use strict';
// Frente cot-form · contrato del wizard /quotation (public/shared/js/script.js)
// y de la migración de cierre de RLS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
// CRLF del checkout en Windows: se normaliza para que los contratos no dependan del fin de línea.
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').replace(/\r\n/g, '\n');
const script = read('public', 'shared', 'js', 'script.js');
const html = read('public', 'quotation', 'index.html');
const css = read('public', 'shared', 'css', 'quotation-ds.css');

function runtime() {
    const elements = {};
    const context = vm.createContext({
        window: { addEventListener() {}, scrollTo() {} },
        document: {
            addEventListener() {},
            body: { classList: { toggle() {} } },
            querySelector: () => null,
            querySelectorAll: () => [],
            getElementById: (id) => elements[id] || null
        },
        console, URLSearchParams, setTimeout, clearTimeout, Uint8Array, Math, Promise,
        crypto: { getRandomValues: (b) => { for (let i = 0; i < b.length; i++) b[i] = (i * 37) % 256; return b; } },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
    });
    vm.runInContext(script, context);
    return context;
}

test('el navegador ya no tiene secretos, Drive, n8n ni inserts directos', () => {
    assert.doesNotMatch(script, /serviceAccountJson/);
    assert.doesNotMatch(script, /google-drive\/create-quote-folder/);
    assert.doesNotMatch(script, /notifyN8NWebhook|config\.n8n|webhookUrl/);
    assert.doesNotMatch(script, /Attachments\.insertMany|IntakeExtras\.upsert|findLatestByEmailForReuse/);
    // La confirmación al cliente la manda el servidor (CC-08).
    assert.doesNotMatch(script, /sendN8NEvent\('client_quotation_submitted'/);
    assert.doesNotMatch(script, /alert\(/);
});

test('envío: borrador → referencias a Storage → submit con paths (Storage como fuente de verdad)', () => {
    const submit = script.slice(script.indexOf('async function submitQuotation()'), script.indexOf('// ============ COTIZACIÓN SIN ARTISTA'));
    const draft = submit.indexOf("saveWebQuotation('draft')");
    const upload = submit.indexOf('uploadReferencesToStorage(formData.quote_id)');
    const final = submit.indexOf("saveWebQuotation('submit', { references: upload.paths })");
    assert.ok(draft > -1 && upload > draft && final > upload);
    // Sin artista no se envía: primero el destino.
    assert.match(submit, /if \(!formData\.artist_id\) return showArtistSuggestions\(\);/);
    assert.match(submit, /needs_destination/);
});

test('segunda cotización en la misma página: el envío y resetQuotation liberan todo el estado', () => {
    const submit = script.slice(script.indexOf('async function submitQuotation()'), script.indexOf('// ============ COTIZACIÓN SIN ARTISTA'));
    assert.match(submit, /finally \{[\s\S]*_isSubmittingQuotation = false;/);
    const ctx = runtime();
    vm.runInContext(`
        renderCurrentStep = () => {}; updateBackButton = () => {}; buildScreensConfig = () => {};
        findNextScreenIndex = () => 0; _setQuotationChromeVisible = () => {}; hideLoading = () => {};
        _isSubmittingQuotation = true; _autoSaveInFlight = true; _quotationSuggestions = [{}]; _pendingAfterLogin = 'jobboard';
        formData = { quote_id: 'QNx', submission_key: 'k', quote_status: 'pending' };
        resetQuotation();
    `, ctx);
    assert.equal(vm.runInContext('_isSubmittingQuotation', ctx), false);
    assert.equal(vm.runInContext('_autoSaveInFlight', ctx), false);
    assert.equal(vm.runInContext('_quotationSuggestions.length', ctx), 0);
    assert.equal(vm.runInContext('_pendingAfterLogin', ctx), null);
    assert.equal(vm.runInContext('formData.submission_key', ctx), undefined, 'nueva llave de borrador');
    assert.equal(vm.runInContext('formData.quote_status', ctx), 'in_progress');
});

test('llave de borrador: UUID v4 aun sin crypto.randomUUID', () => {
    const ctx = runtime();
    const key = vm.runInContext('newSubmissionKey()', ctx);
    assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('autosave con debounce y solo con correo; sin autosave después de enviar', () => {
    assert.match(script, /const AUTOSAVE_DEBOUNCE_MS = 1500;/);
    const ctx = runtime();
    assert.equal(vm.runInContext("formData = { client_email: '' }; hasServerDraftData()", ctx), false);
    assert.equal(vm.runInContext("formData = { client_email: 'qa@example.test' }; hasServerDraftData()", ctx), true);
    assert.match(script, /function autoSaveQuotation\(\) \{\n\s*if \(_isSubmittingQuotation \|\| formData\.quote_status !== 'in_progress'\) return;/);
});

test('sesión vencida: refresca el token, reintenta sin sesión y avisa sin trabar el wizard', () => {
    const api = script.slice(script.indexOf('async function postQuotationApi'), script.indexOf('function saveWebQuotation'));
    assert.match(api, /response\.status === 401 && token/);
    assert.match(api, /getQuotationAccessToken\(true\)/);
    assert.match(api, /auth !== 'required'\) \(\{ response, data \} = await send\(null\)\)/);
    assert.match(api, /response\.status === 429/);
    assert.match(script, /result\.session_expired/);
});

test('sugerencias: tarjetas escapadas, foto solo https y acción por artista', () => {
    const ctx = runtime();
    const html = vm.runInContext(`suggestionCardHtml({ user_id: 'a1', username: 'x"><img src=x onerror=alert(1)>', name: '<b>Ana</b>',
        profile_picture: 'javascript:alert(1)', styles: ['<i>Fine</i>'], city: 'Buenos Aires', country: 'Argentina', verified: true,
        match: { style: 'exact', location: 'city', budget: 'within' } }, 0)`, ctx);
    assert.doesNotMatch(html, /<b>Ana<\/b>|<i>Fine<\/i>|javascript:|onerror=alert/);
    assert.match(html, /&lt;b&gt;Ana&lt;\/b&gt;/);
    assert.match(html, /Enviar mi solicitud a este artista/);
    assert.match(html, /Trabaja tu estilo/);
    assert.match(html, /En tu ciudad/);
    assert.match(html, /Verificado/);
    assert.match(html, /data-suggestion="0"/);
    assert.match(html, /href="\/artist\/profile\?artist=x%22%3E%3Cimg/);
});

test('sin artista: el paso final ofrece sugeridos y el Job Board (con login si hace falta)', () => {
    assert.match(script, /'\/api\/quotations\/suggestions'/);
    assert.match(script, /'\/api\/quotations\/intake\/job-board'/);
    assert.match(script, /No elegir ninguno: publicar mi idea en el Job Board/);
    assert.match(script, /formData\.quotation_source = 'recommendation';/);
    const jb = script.slice(script.indexOf('async function publishQuotationToJobBoard()'), script.indexOf('window.showArtistSuggestions'));
    assert.match(jb, /openQuotationLoginModal\(\{ reason: 'jobboard' \}\)/);
    assert.match(jb, /auth: 'required'/);
    // Tras el login el flujo sigue solo.
    assert.match(script, /if \(_pendingAfterLogin === 'jobboard'\) \{[\s\S]*publishQuotationToJobBoard\(\)/);
    assert.doesNotMatch(script, /Tu solicitud ya está viajando a los artistas/);
    assert.match(html, /id="q-login-context"/);
});

test('cliente con sesión: correo de la cuenta, precarga y "No soy yo"', () => {
    assert.match(script, /function _applyClientSessionPrefill\(\)/);
    assert.match(script, /q\.step === 'email' && _authenticatedEmail/);
    assert.match(script, /onclick="quotationSignOut\(\)">No soy yo<\/button>/);
    const ctx = runtime();
    vm.runInContext(`_authenticatedEmail = 'cuenta@example.test'; _authenticatedClient = { full_name: 'Cliente Real', whatsapp: '+54 11 1' };
        formData = { client_full_name: 'Ya escrito' }; _applyClientSessionPrefill();`, ctx);
    assert.equal(vm.runInContext('formData.client_email', ctx), 'cuenta@example.test');
    assert.equal(vm.runInContext('formData.client_full_name', ctx), 'Ya escrito', 'no pisa lo escrito');
    assert.equal(vm.runInContext('formData.client_whatsapp', ctx), '+54 11 1');
});

test('pre-cotizador: el estilo en slug se convierte en la selección del catálogo', () => {
    const ctx = runtime();
    vm.runInContext(`saveDraftToLocalStorage = () => {};
        TATTOO_STYLES_DATA = [{ id: 'id-fl', slug: 'fine-line', name: 'Fine Line' }];
        formData = { tattoo_style: 'Fine Line' }; normalizeStoredStyleSelection();`, ctx);
    assert.equal(vm.runInContext('formData.tattoo_style.style_id', ctx), 'id-fl');
    assert.equal(vm.runInContext('formData.tattoo_style.styles.length', ctx), 1);
    vm.runInContext(`formData = { tattoo_style: 'no-existe' }; normalizeStoredStyleSelection();`, ctx);
    assert.equal(vm.runInContext('formData.tattoo_style', ctx), null);
});

test('referencias: extensión por MIME (el path siempre pasa la validación del servidor)', () => {
    const ctx = runtime();
    assert.equal(vm.runInContext("referenceExtension({ type: 'image/jpeg', name: 'foto' })", ctx), 'jpg');
    assert.equal(vm.runInContext("referenceExtension({ type: '', name: 'IMG.PNG' })", ctx), 'png');
    assert.equal(vm.runInContext("referenceExtension({ type: '', name: 'raro.bmp' })", ctx), 'jpg');
    assert.match(script, /`\$\{quoteId\}\/ref_\$\{i \+ 1\}_\$\{Date\.now\(\)\}\.\$\{referenceExtension\(file\)\}`/);
});

test('el borrador restaurado avisa que las imágenes no se guardan', () => {
    assert.match(script, /Las imágenes de referencia no se guardan en el borrador/);
});

test('?artist= sigue resolviéndose en initApp (lo usa el frente turnos)', () => {
    assert.match(script, /const artistUsername = urlParams\.get\('artist'\);/);
    assert.match(script, /handleUrlArtist\(artistUsername\);/);
});

test('página: sin EmailJS ni modal de reutilizar email, flatpickr con versión fija', () => {
    assert.doesNotMatch(html, /emailjs/i);
    assert.doesNotMatch(html, /email-reuse-modal/);
    assert.match(html, /flatpickr@4\.6\.13\/dist\/flatpickr\.min\.js/);
    assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/npm\/flatpickr"/);
});

test('estilos del destino: tokens del DS, responsive y sin hex', () => {
    const block = css.slice(css.indexOf('Cotización sin artista: artistas sugeridos'));
    assert.match(block, /\.q-dest-grid \{[\s\S]*grid-template-columns: repeat\(auto-fill, minmax\(260px, 1fr\)\)/);
    assert.match(block, /@media \(max-width: 768px\) \{[\s\S]*\.q-dest-grid \{ grid-template-columns: 1fr; \}/);
    assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/);
    assert.match(block, /\.q-sug-actions \.wo-btn \{[^}]*min-height: 48px/);
});

test('migración de cierre de RLS: idempotente, con guarda de columnas y rollback', () => {
    const sql = read('supabase', 'migrations', '20261115130000_cot_form_rls_cierre.sql');
    const down = read('supabase', 'rollbacks', '20261115130000_cot_form_rls_cierre.down.sql');
    for (const policy of ['Allow anon select in_progress', 'Allow anon update in_progress quotations', 'Allow all insert quotations']) {
        assert.match(sql, new RegExp(`drop policy if exists "${policy}" on public\\.quotations_db;`));
        assert.match(down, new RegExp(`create policy "${policy}" on public\\.quotations_db`));
    }
    assert.match(sql, /drop policy if exists qie_insert_open/);
    assert.match(sql, /drop policy if exists attachments_public_insert/);
    assert.match(sql, /create trigger trg_a_quotations_client_column_guard/);
    assert.match(sql, /current_user not in \('anon', 'authenticated'\)/);
    assert.match(sql, /file_size_limit = 10485760/);
    assert.match(sql, /private\.is_open_web_quote_draft\(split_part\(name, '\/', 1\)\)/);
    assert.doesNotMatch(sql, /in_progress'\s+or\s+q\.(artist|client)/i, 'sin ramas in_progress en las políticas nuevas');
    assert.match(down, /drop trigger if exists trg_a_quotations_client_column_guard/);
});
