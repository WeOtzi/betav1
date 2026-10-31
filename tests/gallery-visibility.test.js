// Visibilidad pública de la galería (contrato modo asistido §4): las fotos
// importadas de Instagram quedan ocultas en el perfil público hasta validar la
// cuenta. Se prueba la regla pura (gallery-visibility.js) rama por rama y sus
// consumidores: perfil público (filtra), dashboard (marca PENDIENTE · IG y
// consulta el estado una sola vez, nunca en modo demo) y el estilo del tag.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const V = require('../public/shared/js/gallery-visibility.js');
const Gallery = require('../public/shared/js/dashboard-gallery.js');

const ENFORCED_UNVERIFIED = { enforced: true, verified: false, handle: null };
const VERIFIED_LAURA = { enforced: true, verified: true, handle: 'laura.tattoo' };
const NOT_ENFORCED = { enforced: false, verified: false, handle: null };

const MANUAL = { url: 'https://s/artist-gallery/u1/1700_abc.jpg', category: 'realizados', kind: 'image' };
const IMPORTED = {
    url: 'https://s/artist-gallery/instagram-import/u1/a1b2c3.jpg', category: 'instagram', kind: 'image',
    permalink: 'https://www.instagram.com/p/AAA/', source: 'instagram', ig_handle: 'laura.tattoo', imported_at: '2026-10-29T10:00:00Z'
};

// Bloque de un archivo fuente entre dos marcas (para correrlo en un sandbox).
function slice(src, startMarker, endMarker) {
    const start = src.indexOf(startMarker);
    const end = src.indexOf(endMarker, start + startMarker.length);
    assert.ok(start > -1 && end > start, 'bloque ' + startMarker);
    return src.slice(start, end);
}

/* ------------------------------ regla pura ------------------------------ */

test('normalizeHandle quita @, espacios y mayúsculas; tolera null y números', () => {
    assert.equal(V.normalizeHandle('  @Laura.Tattoo '), 'laura.tattoo');
    assert.equal(V.normalizeHandle('@@laura'), 'laura');
    assert.equal(V.normalizeHandle('laura_tattoo'), 'laura_tattoo');
    assert.equal(V.normalizeHandle(null), '');
    assert.equal(V.normalizeHandle(undefined), '');
    assert.equal(V.normalizeHandle(''), '');
    assert.equal(V.normalizeHandle(123), '123');
});

test('isInstagramItem reconoce source, permalink, carpeta del import y categoría (sola)', () => {
    assert.equal(V.isInstagramItem({ url: 'x.jpg', source: 'instagram' }), true);
    assert.equal(V.isInstagramItem({ url: 'x.jpg', source: 'Instagram' }), true, 'source sin distinguir mayúsculas');
    assert.equal(V.isInstagramItem({ url: 'x.jpg', permalink: 'https://www.instagram.com/p/1/' }), true);
    assert.equal(V.isInstagramItem({ url: 'x.jpg', permalink: 'https://INSTAGRAM.COM/reel/2/' }), true);
    assert.equal(V.isInstagramItem({ url: 'https://s/artist-gallery/instagram-import/u/a.jpg' }), true);
    // Detección solo por categoría (el ítem perdió source/permalink y vive fuera de la carpeta del import).
    assert.equal(V.isInstagramItem({ url: 'https://s/x.jpg', category: 'instagram' }), true);
    assert.equal(V.isInstagramItem({ url: 'https://s/x.mp4', category: 'instagram-reel' }), true);
    assert.equal(V.isInstagramItem({ url: 'https://s/x.jpg', category: 'INSTAGRAM' }), true);

    assert.equal(V.isInstagramItem(MANUAL), false, 'subida manual');
    assert.equal(V.isInstagramItem({ url: 'x.jpg', category: 'flash', source: 'upload' }), false);
    assert.equal(V.isInstagramItem({ url: 'x.jpg', permalink: 'https://www.tiktok.com/@laura/video/1' }), false);
    assert.equal(V.isInstagramItem({ url: 'https://s/artist-gallery/u/instagram.jpg' }), false, 'la palabra en el nombre no alcanza');
    assert.equal(V.isInstagramItem(null), false);
    assert.equal(V.isInstagramItem(undefined), false);
    assert.equal(V.isInstagramItem('https://s/instagram-import/a.jpg'), false, 'solo objetos');
});

test('isPubliclyVisible: lo que no es de Instagram siempre se ve', () => {
    for (const state of [ENFORCED_UNVERIFIED, VERIFIED_LAURA, NOT_ENFORCED, null, undefined]) {
        assert.equal(V.isPubliclyVisible(MANUAL, state), true);
    }
    assert.equal(V.isPubliclyVisible(null, ENFORCED_UNVERIFIED), true);
    assert.equal(V.isPubliclyVisible('texto', ENFORCED_UNVERIFIED), true);
});

test('isPubliclyVisible: ig_legacy conserva públicas las importaciones anteriores a la regla', () => {
    const legacy = { ...IMPORTED, ig_legacy: true, ig_handle: 'otra.cuenta' };
    assert.equal(V.isPubliclyVisible(legacy, ENFORCED_UNVERIFIED), true);
    assert.equal(V.isPubliclyVisible(legacy, VERIFIED_LAURA), true, 'aunque venga de otra cuenta');
    assert.equal(V.isPubliclyVisible({ ...IMPORTED, ig_legacy: 'true' }, ENFORCED_UNVERIFIED), false, 'solo el booleano true');
    assert.equal(V.isPubliclyVisible({ ...IMPORTED, ig_legacy: false }, ENFORCED_UNVERIFIED), false);
});

test('isPubliclyVisible: sin validación en el backend (enforced false o sin estado) todo se ve', () => {
    assert.equal(V.isPubliclyVisible(IMPORTED, NOT_ENFORCED), true);
    assert.equal(V.isPubliclyVisible(IMPORTED, null), true);
    assert.equal(V.isPubliclyVisible(IMPORTED, undefined), true);
    assert.equal(V.isPubliclyVisible(IMPORTED, {}), true);
    assert.equal(V.isPubliclyVisible(IMPORTED, { enforced: 'true', verified: false }), true, 'enforced estricto');
    assert.equal(V.isPubliclyVisible(IMPORTED, { enforced: 1, verified: false }), true);
});

test('isPubliclyVisible: con la regla activa y la cuenta sin validar, la foto de IG se oculta', () => {
    assert.equal(V.isPubliclyVisible(IMPORTED, ENFORCED_UNVERIFIED), false);
    assert.equal(V.isPubliclyVisible({ url: 'https://s/x.jpg', category: 'instagram' }, ENFORCED_UNVERIFIED), false);
    assert.equal(V.isPubliclyVisible({ ...IMPORTED, ig_handle: undefined }, ENFORCED_UNVERIFIED), false);
});

test('isPubliclyVisible: cuenta validada · sin handle en el ítem se ve; con handle tiene que coincidir', () => {
    const { ig_handle, ...noHandle } = IMPORTED;
    assert.equal(ig_handle, 'laura.tattoo');
    assert.equal(V.isPubliclyVisible(noHandle, VERIFIED_LAURA), true, 'ítem sin ig_handle');
    assert.equal(V.isPubliclyVisible({ ...IMPORTED, ig_handle: '' }, VERIFIED_LAURA), true, 'handle vacío = sin handle');
    assert.equal(V.isPubliclyVisible(IMPORTED, VERIFIED_LAURA), true, 'mismo handle');
    assert.equal(V.isPubliclyVisible({ ...IMPORTED, ig_handle: '@Laura.Tattoo' }, VERIFIED_LAURA), true, '@ y mayúsculas en el ítem');
    assert.equal(V.isPubliclyVisible(IMPORTED, { enforced: true, verified: true, handle: '@LAURA.TATTOO ' }), true, '@ y mayúsculas en el estado');
    assert.equal(V.isPubliclyVisible({ ...IMPORTED, ig_handle: 'otra.cuenta' }, VERIFIED_LAURA), false, 'otra cuenta');
    assert.equal(V.isPubliclyVisible(IMPORTED, { enforced: true, verified: true, handle: null }), false, 'validado sin handle conocido');
    assert.equal(V.isPubliclyVisible(noHandle, { enforced: true, verified: true, handle: null }), true);
});

test('isPendingValidation: solo fotos de IG que el público todavía no ve', () => {
    assert.equal(V.isPendingValidation(IMPORTED, ENFORCED_UNVERIFIED), true);
    assert.equal(V.isPendingValidation({ ...IMPORTED, ig_handle: 'otra.cuenta' }, VERIFIED_LAURA), true);
    assert.equal(V.isPendingValidation(IMPORTED, VERIFIED_LAURA), false);
    assert.equal(V.isPendingValidation({ ...IMPORTED, ig_legacy: true }, ENFORCED_UNVERIFIED), false);
    assert.equal(V.isPendingValidation(IMPORTED, NOT_ENFORCED), false);
    assert.equal(V.isPendingValidation(IMPORTED, null), false);
    assert.equal(V.isPendingValidation(MANUAL, ENFORCED_UNVERIFIED), false);
    assert.equal(V.isPendingValidation(null, ENFORCED_UNVERIFIED), false);
});

test('filterPublic y pendingCount: orden e identidad conservados; entradas no-array → vacío', () => {
    const legacy = { ...IMPORTED, url: 'legacy.jpg', ig_legacy: true };
    const other = { ...IMPORTED, url: 'other.jpg', ig_handle: 'otra.cuenta' };
    const byCategory = { url: 'cat.jpg', category: 'instagram-reel', kind: 'video' };
    const feed = [IMPORTED, MANUAL, legacy, other, byCategory];

    const unverified = V.filterPublic(feed, ENFORCED_UNVERIFIED);
    assert.deepEqual(unverified.map((i) => i.url), [MANUAL.url, 'legacy.jpg']);
    assert.equal(unverified[0], MANUAL, 'mismos objetos, sin copiar');
    assert.equal(V.pendingCount(feed, ENFORCED_UNVERIFIED), 3);

    assert.deepEqual(V.filterPublic(feed, VERIFIED_LAURA).map((i) => i.url), [IMPORTED.url, MANUAL.url, 'legacy.jpg', 'cat.jpg']);
    assert.equal(V.pendingCount(feed, VERIFIED_LAURA), 1);

    assert.equal(V.filterPublic(feed, NOT_ENFORCED).length, feed.length);
    assert.equal(V.pendingCount(feed, NOT_ENFORCED), 0);
    assert.notEqual(V.filterPublic(feed, NOT_ENFORCED), feed, 'devuelve un array nuevo');

    for (const bad of [null, undefined, 'x', { length: 2 }, 3]) {
        assert.deepEqual(V.filterPublic(bad, ENFORCED_UNVERIFIED), []);
        assert.equal(V.pendingCount(bad, ENFORCED_UNVERIFIED), 0);
    }
});

test('stateFrom normaliza el RPC público y el objeto instagram del endpoint', () => {
    const empty = { enforced: false, verified: false, handle: null };
    assert.deepEqual(V.stateFrom(null), empty);
    assert.deepEqual(V.stateFrom(undefined), empty);
    assert.deepEqual(V.stateFrom('verified'), empty);
    assert.deepEqual(V.stateFrom({}), empty);

    // RPC get_artist_public_profile_preferences → instagram_validation
    assert.deepEqual(V.stateFrom({ enforced: true, verified: true, handle: '@Laura.Tattoo' }), VERIFIED_LAURA);
    assert.deepEqual(V.stateFrom({ enforced: true, verified: false, handle: null }), ENFORCED_UNVERIFIED);
    assert.deepEqual(V.stateFrom({ enforced: 'true', verified: 'true', handle: '' }), empty, 'flags estrictos');

    // GET /api/artist/instagram-verification → objeto `instagram` (sin `enforced`: lo agrega el consumidor)
    const endpointVerified = {
        success: true, available: true, status: 'verified', handle: 'laura.tattoo', verified_handle: 'laura.tattoo',
        verified_at: '2026-10-29T12:00:00Z', expires_at: null, email_masked: 'l***@mail.com', pending_items: 0, legacy_items: 2
    };
    assert.deepEqual(V.stateFrom(endpointVerified), { enforced: false, verified: true, handle: 'laura.tattoo' });
    assert.deepEqual(V.stateFrom({ ...endpointVerified, enforced: endpointVerified.available === true }), VERIFIED_LAURA);

    const endpointPending = { available: true, status: 'pending', handle: '@Laura.Tattoo', verified_handle: null, verified_at: null };
    assert.deepEqual(V.stateFrom({ ...endpointPending, enforced: true }), { enforced: true, verified: false, handle: 'laura.tattoo' });

    const unavailable = { available: false, status: 'none', handle: null, verified_handle: null, verified_at: null };
    assert.deepEqual(V.stateFrom({ ...unavailable, enforced: unavailable.available === true }), empty);

    // Sin `handle`, usa el handle validado.
    assert.deepEqual(V.stateFrom({ enforced: true, verified_at: '2026-10-29T12:00:00Z', verified_handle: '@Laura.Tattoo' }), VERIFIED_LAURA);

    // Si el artista cambió su Instagram después de validar, manda el validado:
    // las fotos importadas de la cuenta validada siguen públicas.
    const renamed = { available: true, enforced: true, status: 'verified', handle: 'laura.nueva', verified_handle: 'laura.tattoo', verified_at: '2026-10-29T12:00:00Z' };
    assert.deepEqual(V.stateFrom(renamed), VERIFIED_LAURA);
    assert.equal(V.isPubliclyVisible({ url: 'https://x/instagram-import/u/a.jpg', ig_handle: 'laura.tattoo' }, V.stateFrom(renamed)), true);
});

test('gallery-visibility.js es UMD: en el navegador expone window.WoGalleryVisibility', () => {
    const sandbox = {};
    sandbox.self = sandbox;
    vm.runInNewContext(read('public/shared/js/gallery-visibility.js'), sandbox);
    const api = sandbox.WoGalleryVisibility;
    assert.ok(api, 'global definido');
    assert.deepEqual(Object.keys(api).sort(), ['filterPublic', 'isInstagramItem', 'isPendingValidation', 'isPubliclyVisible', 'normalizeHandle', 'pendingCount', 'stateFrom']);
    assert.equal(api.isPubliclyVisible(IMPORTED, ENFORCED_UNVERIFIED), false);
});

/* ---------------------------- perfil público ---------------------------- */

test('perfil público: carga el helper antes de artist-profile.js y filtra el feed crudo antes de mapear', () => {
    const html = read('public/artist/profile/index.html');
    const helper = html.indexOf('src="/shared/js/gallery-visibility.js');
    const profile = html.indexOf('src="/shared/js/artist-profile.js');
    assert.ok(helper > -1, 'incluye gallery-visibility.js');
    assert.ok(helper < profile, 'gallery-visibility.js precede a artist-profile.js');
    assert.equal((html.match(/gallery-visibility\.js/g) || []).length, 1);

    const js = read('public/shared/js/artist-profile.js');
    const body = slice(js, 'function normalizeGalleryItems() {', 'function getVisibleGalleryItems() {');
    const filter = body.indexOf('isPubliclyVisible(raw, igValidationState)');
    assert.ok(filter > -1, 'filtra con isPubliclyVisible sobre el ítem crudo');
    assert.ok(filter < body.indexOf('items.push('), 'el filtro va antes del mapeo');
    assert.match(js, /stateFrom\(validation\)/);
    assert.match(js, /instagram_validation: data\.instagram_validation/);
    assert.match(js, /igValidationState = resolveIgValidationState\(publicProfilePreferences\);\s+populateProfile\(\);/,
        'el estado se resuelve antes del primer render de la galería');
});

function loadProfileGallery({ feed, legacy, prefs, helper = true }) {
    const js = read('public/shared/js/artist-profile.js');
    const code = [
        slice(js, 'async function loadPublicProfilePreferences(artistUserId) {', 'function resolveIgValidationState(preferences) {'),
        slice(js, 'function resolveIgValidationState(preferences) {', '/**'),
        slice(js, 'function normalizeGalleryItems() {', 'function getVisibleGalleryItems() {'),
        ';({ loadPublicProfilePreferences, resolveIgValidationState, normalizeGalleryItems })'
    ].join('\n');
    const sandbox = {
        window: helper ? { WoGalleryVisibility: V } : {},
        WeotziData: { ProfilePublic: { getPreferences: async () => prefs } },
        console: { warn() {} },
        artistData: { gallery_feed_items: feed, gallery_images: legacy || [] },
        igValidationState: null,
        GALLERY_CATEGORY_LABELS: { realizados: 'Realizados', flash: 'Flash', proyectos: 'Proyectos' },
        parseJsonArray: (value) => (Array.isArray(value) ? value : []),
        galleryStylesOf: () => [],
        isUrlVideo: (url) => /\.mp4$/.test(String(url))
    };
    const fns = vm.runInNewContext(code, sandbox);
    return {
        async run() {
            const loaded = await fns.loadPublicProfilePreferences('artist-1');
            sandbox.igValidationState = fns.resolveIgValidationState(loaded);
            return { loaded, state: sandbox.igValidationState, urls: Array.from(fns.normalizeGalleryItems(), (i) => i.url) };
        }
    };
}

test('perfil público: oculta las fotos de IG sin validar y respeta legacy / cuenta validada', async () => {
    const legacy = { ...IMPORTED, url: 'https://s/artist-gallery/instagram-import/u1/old.jpg', ig_legacy: true };
    const feed = [IMPORTED, MANUAL, legacy, { url: 'https://s/x.jpg', category: 'instagram' }];
    const prefs = (validation) => ({ privacy: {}, profile: {}, availability: {}, instagram_validation: validation });

    const unverified = await loadProfileGallery({ feed, prefs: prefs({ enforced: true, verified: false, handle: null }) }).run();
    assert.deepEqual(unverified.state, ENFORCED_UNVERIFIED);
    assert.deepEqual(unverified.urls, [MANUAL.url, legacy.url]);

    const verified = await loadProfileGallery({ feed, prefs: prefs({ enforced: true, verified: true, handle: '@Laura.Tattoo' }) }).run();
    assert.deepEqual(verified.urls, feed.map((i) => i.url));

    const other = await loadProfileGallery({ feed, prefs: prefs({ enforced: true, verified: true, handle: 'otra.cuenta' }) }).run();
    assert.deepEqual(other.urls, [MANUAL.url, legacy.url, 'https://s/x.jpg'], 'el ítem sin ig_handle se ve; el de otra cuenta no');
});

test('perfil público: sin la clave del RPC o sin el helper, la galería queda como antes', async () => {
    const feed = [IMPORTED, MANUAL];
    const noKey = await loadProfileGallery({ feed, prefs: { privacy: {}, profile: {}, availability: {} } }).run();
    assert.equal(noKey.loaded.instagram_validation, null);
    assert.equal(noKey.state, null);
    assert.deepEqual(noKey.urls, [IMPORTED.url, MANUAL.url]);

    const noPrefs = await loadProfileGallery({ feed, prefs: null }).run();
    assert.deepEqual(noPrefs.urls, [IMPORTED.url, MANUAL.url]);

    const noHelper = await loadProfileGallery({
        feed, helper: false, prefs: { instagram_validation: { enforced: true, verified: false, handle: null } }
    }).run();
    assert.equal(noHelper.state, null);
    assert.deepEqual(noHelper.urls, [IMPORTED.url, MANUAL.url]);
});

test('perfil público: si todo el feed quedó oculto no reaparece desde gallery_images', async () => {
    const hidden = await loadProfileGallery({
        feed: [IMPORTED], legacy: [IMPORTED.url],
        prefs: { instagram_validation: { enforced: true, verified: false, handle: null } }
    }).run();
    assert.deepEqual(hidden.urls, []);

    // Sin feed sigue valiendo el respaldo legacy de siempre.
    const legacyOnly = await loadProfileGallery({
        feed: [], legacy: ['https://s/legacy.jpg'],
        prefs: { instagram_validation: { enforced: true, verified: false, handle: null } }
    }).run();
    assert.deepEqual(legacyOnly.urls, ['https://s/legacy.jpg']);
});

/* ------------------------------ dashboard ------------------------------ */

function withWindow(win, fn) {
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
    const prev = globalThis.window;
    globalThis.window = win;
    try { return fn(); } finally {
        if (had) globalThis.window = prev; else delete globalThis.window;
    }
}

test('dashboard: PENDIENTE · IG reemplaza a NUEVO · IG mientras la cuenta no está validada', () => {
    const now = new Date('2026-10-30T12:00:00Z');
    const item = { ...IMPORTED, imported_at: '2026-10-29T12:00:00Z', title: 'Dragón' };

    const pending = withWindow({ WoGalleryVisibility: V, WoIgValidationState: ENFORCED_UNVERIFIED }, () => Gallery.cellMarkup(item, 1, 3, now));
    assert.match(pending, /<span class="wod-gal-tag is-pending" title="Se muestra en tu perfil público cuando valides tu Instagram">PENDIENTE · IG<\/span>/);
    assert.doesNotMatch(pending, /NUEVO · IG/);
    assert.match(pending, /wod-gal-cell[^"]* is-pending/);
    assert.doesNotMatch(pending, /wod-gal-cell[^"]* is-new/);
    assert.match(pending, /aria-label="Ver Dragón \(2 de 3\)\. Pendiente: se muestra en tu perfil público cuando valides tu Instagram\. Alt \+ flechas para reordenar\."/);
    assert.equal(withWindow({ WoGalleryVisibility: V, WoIgValidationState: ENFORCED_UNVERIFIED }, () => Gallery.isPendingImport(item)), true);

    const verified = withWindow({ WoGalleryVisibility: V, WoIgValidationState: VERIFIED_LAURA }, () => Gallery.cellMarkup(item, 1, 3, now));
    assert.match(verified, /NUEVO · IG/);
    assert.doesNotMatch(verified, /PENDIENTE · IG|is-pending/);

    const legacyCell = withWindow({ WoGalleryVisibility: V, WoIgValidationState: ENFORCED_UNVERIFIED }, () => Gallery.cellMarkup({ ...item, ig_legacy: true }, 1, 3, now));
    assert.doesNotMatch(legacyCell, /PENDIENTE · IG/);

    const manual = withWindow({ WoGalleryVisibility: V, WoIgValidationState: ENFORCED_UNVERIFIED }, () => Gallery.cellMarkup({ url: 'a.jpg', kind: 'image' }, 0, 3, now));
    assert.doesNotMatch(manual, /PENDIENTE · IG/);

    // El tag convive con el de video.
    const reel = withWindow({ WoGalleryVisibility: V, WoIgValidationState: ENFORCED_UNVERIFIED }, () => Gallery.cellMarkup({ ...item, kind: 'video', duration: 24 }, 2, 3, now));
    assert.match(reel, /PENDIENTE · IG<\/span><span class="wod-gal-tag is-video" data-gal-duration>VIDEO · 0:24/);
});

test('dashboard: sin helper o sin estado no se marca nada (comportamiento previo)', () => {
    const now = new Date('2026-10-30T12:00:00Z');
    const item = { ...IMPORTED, imported_at: '2026-10-29T12:00:00Z' };
    assert.match(Gallery.cellMarkup(item, 1, 3, now), /NUEVO · IG/, 'Node sin window');
    for (const win of [{}, { WoGalleryVisibility: V }, { WoIgValidationState: ENFORCED_UNVERIFIED }, { WoGalleryVisibility: {}, WoIgValidationState: ENFORCED_UNVERIFIED }]) {
        const markup = withWindow(win, () => Gallery.cellMarkup(item, 1, 3, now));
        assert.doesNotMatch(markup, /PENDIENTE · IG/);
        assert.match(markup, /NUEVO · IG/);
    }
});

test('dashboard: pickExtras conserva ig_handle e ig_legacy para no ocultar fotos al guardar', () => {
    const extras = Gallery.pickExtras({ url: 'u', source: 'instagram', imported_at: 't', ig_handle: 'laura.tattoo', ig_legacy: true, junk: 1 });
    assert.deepEqual(extras, { source: 'instagram', imported_at: 't', ig_handle: 'laura.tattoo', ig_legacy: true });
    assert.equal(Gallery.pickExtras({ ig_legacy: false }).ig_legacy, false);
    // El caso fijado en figma-final-dashboard sigue igual.
    assert.deepEqual(
        Gallery.pickExtras({ title: ' Dragón ', caption: 'c', permalink: 'p', source: 'instagram', imported_at: 't', video_duration: 18.4, junk: 1 }),
        { title: 'Dragón', caption: 'c', permalink: 'p', source: 'instagram', imported_at: 't', duration: 18 }
    );
});

test('dashboard: el helper se carga antes de dashboard-gallery.js y el estado se pide después del render', () => {
    const html = read('public/artist/dashboard/index.html');
    const helper = html.indexOf('src="/shared/js/gallery-visibility.js');
    assert.ok(helper > -1, 'incluye gallery-visibility.js');
    assert.ok(helper < html.indexOf('src="/shared/js/dashboard-gallery.js'), 'precede a dashboard-gallery.js');
    assert.equal((html.match(/gallery-visibility\.js/g) || []).length, 1);

    const js = read('public/shared/js/dashboard.js');
    const apply = slice(js, 'function applyDashboardArtistData(artist) {', 'async function loadArtistData(');
    const render = apply.indexOf("runDashboardStep('render gallery admin', renderGalleryAdmin);");
    const load = apply.indexOf("runDashboardStep('load instagram validation state', loadInstagramValidationStateOnce);");
    assert.ok(render > -1 && load > render, 'se consulta después del primer render de la galería');
});

function loadDashboardValidation({ win, feed, session = null, fetchImpl, pathname = '/artist/dashboard' }) {
    const js = read('public/shared/js/dashboard.js');
    const code = slice(js, 'let _igValidationStateRequested = false;', 'async function loadArtistTattooLocations() {') +
        '\n;({ loadInstagramValidationStateOnce, dashboardAppPath })';
    const calls = { fetch: [], render: 0 };
    const window = Object.assign({ location: { pathname } }, win);
    const sandbox = {
        window,
        currentUser: { id: 'user-1' },
        artistData: { gallery_feed_items: feed },
        parseJsonArraySafe: (value) => (Array.isArray(value) ? value : []),
        renderGalleryAdmin: () => { calls.render += 1; },
        readStoredDashboardSession: () => null,
        _supabase: session ? { auth: { getSession: async () => ({ data: { session } }) } } : null,
        fetch: async (url, init) => {
            calls.fetch.push({ url, init });
            return fetchImpl ? fetchImpl(url, init) : { ok: false, json: async () => ({}) };
        }
    };
    const fns = vm.runInNewContext(code, sandbox);
    return { ...fns, calls, window };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('dashboard: en modo demo no consulta el estado', async () => {
    let apiCalls = 0;
    const ctx = loadDashboardValidation({
        win: { WoGalleryVisibility: V, WoDemo: { enabled: true, api: async () => { apiCalls += 1; return { available: true }; } } },
        feed: [IMPORTED],
        session: { access_token: 'tok' }
    });
    ctx.loadInstagramValidationStateOnce();
    await flush();
    assert.equal(apiCalls, 0);
    assert.equal(ctx.calls.fetch.length, 0);
    assert.equal(ctx.calls.render, 0);
    assert.equal(ctx.window.WoIgValidationState, undefined);

    const js = read('public/shared/js/dashboard.js');
    const fn = slice(js, 'function loadInstagramValidationStateOnce() {', 'async function loadArtistTattooLocations() {');
    assert.ok(fn.indexOf('window.WoDemo && window.WoDemo.enabled') > -1 && fn.indexOf('window.WoDemo && window.WoDemo.enabled') < fn.indexOf('fetchInstagramValidationState()'));
});

test('dashboard: con WoDemo.api arma el estado (available → enforced, handle validado) y repinta una sola vez', async () => {
    const paths = [];
    const ctx = loadDashboardValidation({
        win: {
            WoGalleryVisibility: V,
            WoDemo: {
                enabled: false,
                api: async (p) => {
                    paths.push(p);
                    return { success: true, available: true, status: 'verified', handle: 'Laura.Nueva', verified_handle: '@Laura.Tattoo', verified_at: '2026-10-29T12:00:00Z' };
                }
            }
        },
        feed: [MANUAL, IMPORTED]
    });
    ctx.loadInstagramValidationStateOnce();
    await flush();
    assert.deepEqual(paths, ['/api/artist/instagram-verification']);
    assert.deepEqual({ ...ctx.window.WoIgValidationState }, VERIFIED_LAURA, 'compara contra la cuenta validada');
    assert.equal(ctx.calls.render, 1);
    assert.equal(ctx.calls.fetch.length, 0, 'WoDemo.api ya usa el fetch nativo');

    ctx.loadInstagramValidationStateOnce();
    await flush();
    assert.equal(paths.length, 1, 'una sola consulta por página');
    assert.equal(ctx.calls.render, 1);
});

test('dashboard: sin WoDemo.api usa fetch con Bearer y base path; available false no aplica la regla', async () => {
    const ctx = loadDashboardValidation({
        win: { WoGalleryVisibility: V },
        feed: [IMPORTED],
        session: { access_token: 'tok-123' },
        pathname: '/beta/artist/dashboard',
        fetchImpl: async () => ({ ok: true, json: async () => ({ success: true, available: false, status: 'none', handle: 'laura.tattoo', verified_handle: null, verified_at: null }) })
    });
    ctx.loadInstagramValidationStateOnce();
    await flush();
    assert.equal(ctx.calls.fetch.length, 1);
    assert.equal(ctx.calls.fetch[0].url, '/beta/api/artist/instagram-verification');
    assert.equal(ctx.calls.fetch[0].init.headers.Authorization, 'Bearer tok-123');
    assert.deepEqual({ ...ctx.window.WoIgValidationState }, { enforced: false, verified: false, handle: 'laura.tattoo' });
    assert.equal(ctx.calls.render, 1);

    assert.equal(loadDashboardValidation({ win: { WEOTZI_BASE_PATH: '/preview/x/' }, feed: [] }).dashboardAppPath('/api/a'), '/preview/x/api/a');
    assert.equal(loadDashboardValidation({ win: { WoDemo: { appPath: (p) => '/beta' + p } }, feed: [] }).dashboardAppPath('/api/a'), '/beta/api/a');
});

test('dashboard: las fallas se ignoran en silencio y sin fotos de IG no se consulta', async () => {
    const rejected = loadDashboardValidation({
        win: { WoGalleryVisibility: V },
        feed: [IMPORTED],
        session: { access_token: 'tok' },
        fetchImpl: async () => { throw new Error('offline'); }
    });
    rejected.loadInstagramValidationStateOnce();
    await flush();
    assert.equal(rejected.window.WoIgValidationState, undefined);
    assert.equal(rejected.calls.render, 0);

    const notOk = loadDashboardValidation({ win: { WoGalleryVisibility: V }, feed: [IMPORTED], session: { access_token: 'tok' } });
    notOk.loadInstagramValidationStateOnce();
    await flush();
    assert.equal(notOk.window.WoIgValidationState, undefined, 'respuesta 503 sin migración');

    const noSession = loadDashboardValidation({ win: { WoGalleryVisibility: V }, feed: [IMPORTED] });
    noSession.loadInstagramValidationStateOnce();
    await flush();
    assert.equal(noSession.calls.fetch.length, 0, 'sin token no hay request');

    const noHelper = loadDashboardValidation({ win: {}, feed: [IMPORTED], session: { access_token: 'tok' } });
    noHelper.loadInstagramValidationStateOnce();
    await flush();
    assert.equal(noHelper.calls.fetch.length, 0);

    // Sin fotos de IG no pregunta; cuando llegan (importación) sí.
    const manualOnly = loadDashboardValidation({
        win: { WoGalleryVisibility: V },
        feed: [MANUAL],
        session: { access_token: 'tok' },
        fetchImpl: async () => ({ ok: true, json: async () => ({ success: true, available: true, status: 'none', verified_at: null }) })
    });
    manualOnly.loadInstagramValidationStateOnce();
    await flush();
    assert.equal(manualOnly.calls.fetch.length, 0);
});

/* --------------------------------- CSS --------------------------------- */

// Contraste WCAG 2.x entre dos hex (#RRGGBB).
function contrastRatio(a, b) {
    const lum = (hex) => {
        const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
            .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

function tokenHex(tokens, name) {
    const m = tokens.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})\\b'));
    assert.ok(m, 'token --' + name + ' en tokens.css');
    return m[1];
}

test('el tag PENDIENTE · IG: fondo warning del DS, texto ink con contraste AA, filete amarillo y puntero para el title', () => {
    const css = read('public/shared/css/dashboard-figma-final.css');
    const rule = css.match(/\.wod-gal-tag\.is-pending\s*\{([^}]*)\}/);
    assert.ok(rule, 'regla .wod-gal-tag.is-pending');
    assert.match(rule[1], /background:\s*var\(--status-warning-bg\)/);
    // --status-warning-fg sobre --status-warning-bg da 3,99:1 a 10px: no llega a AA.
    assert.match(rule[1], /color:\s*var\(--neutral-500\)/);
    assert.doesNotMatch(rule[1], /--status-warning-fg/);
    assert.match(rule[1], /box-shadow:\s*inset 0 0 0 1px var\(--yellow-300\)/);
    assert.match(rule[1], /pointer-events:\s*auto/);
    assert.doesNotMatch(rule[1], /#[0-9a-f]{3,8}\b|border-radius/i);
    assert.equal((css.match(/\.wod-gal-tag\.is-pending/g) || []).length, 1, 'una sola regla');

    // --status-warning-bg es var(--warning-bg): el par real de la insignia supera 4.5:1.
    const tokens = read('public/shared/css/ds/tokens.css');
    assert.match(tokens, /--status-warning-bg:\s*var\(--warning-bg\)/);
    const ratio = contrastRatio(tokenHex(tokens, 'neutral-500'), tokenHex(tokens, 'warning-bg'));
    assert.ok(ratio >= 4.5, 'contraste ' + ratio.toFixed(2) + ':1');
    assert.ok(contrastRatio(tokenHex(tokens, 'warning-fg'), tokenHex(tokens, 'warning-bg')) < 4.5, 'el par anterior no llegaba a AA');
});

test('la fila de insignias de la galería se apila a la derecha en celdas angostas y no recorta PENDIENTE · IG', () => {
    const css = read('public/shared/css/dashboard-figma-final.css');
    const rule = css.match(/\.wod-gal-cell > \.wod-gal-tags\s*\{([^}]*)\}/);
    assert.ok(rule, 'regla .wod-gal-cell > .wod-gal-tags (solo la galería del dashboard)');
    assert.match(rule[1], /flex-wrap:\s*wrap/);
    assert.match(rule[1], /justify-content:\s*flex-end/);
    assert.match(rule[1], /max-width:\s*calc\(100% - 20px\)/);
    assert.doesNotMatch(rule[1], /#[0-9a-f]{3,8}\b|position|top|right/i, 'no mueve la fila: sigue arriba a la derecha');
    // La base sigue en dashboard-redesign.css (arriba a la derecha, sin puntero).
    const base = read('public/shared/css/dashboard-redesign.css').match(/\.wod-gal-tags\s*\{([^}]*)\}/);
    assert.ok(base);
    assert.match(base[1], /right:\s*10px/);
    assert.match(base[1], /pointer-events:\s*none/);
    // El dashboard pide la versión nueva de la hoja (cache-buster).
    const html = read('public/artist/dashboard/index.html');
    const link = html.match(/href="\/shared\/css\/dashboard-figma-final\.css\?v=([^"]+)"/);
    assert.ok(link, 'link a dashboard-figma-final.css con ?v=');
    assert.notEqual(link[1], '20261028-figma-final-r2', 'subí el ?v= al cambiar la hoja');
});
