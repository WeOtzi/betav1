'use strict';

// Ronda 2 · frente "perfil": los módulos del navegador corriendo de verdad en
// una VM con el DOM mínimo simulado (no hay navegador en la suite).
//   - N9: resolveViewer con la configuración todavía sin cargar (isDemoMode true)
//   - historia 1080×1920 y tarjeta OG 1200×630 dibujadas en un canvas falso
//   - subida de la tarjeta OG: solo el dueño, una vez por cambio

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const Presentation = require('../public/shared/js/artist-profile-presentation.js');
// Los objetos que salen de la VM tienen otro prototipo: se comparan como datos.
const plain = (value) => JSON.parse(JSON.stringify(value));

const UID = '3f2b8c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

// ---------------------------------------------------------------------------
// N9 · artist-profile.js
// ---------------------------------------------------------------------------

function loadProfileScript({ session = null, ownProfile = null, demoMode = true, woDemo = null } = {}) {
    const state = { session, authListeners: [], windowListeners: {} };
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout,
        URLSearchParams, URL,
        document: {
            addEventListener() {},
            getElementById() { return null; },
            querySelector() { return null; },
            querySelectorAll() { return []; },
            documentElement: { classList: { add() {}, remove() {} } },
            body: { classList: { toggle() {}, add() {}, remove() {} } }
        },
        WeotziData: { Artists: { getOwnProfile: async () => ({ data: ownProfile }) } },
        supabase: {
            createClient: () => ({
                auth: {
                    getSession: async () => ({ data: { session: state.session } }),
                    onAuthStateChange(cb) { state.authListeners.push(cb); }
                }
            })
        },
        // El flag que causaba el bug: true por defecto hasta que carga app-config.json.
        ConfigManager: { isDemoMode: () => demoMode },
        ArtistProfilePresentation: Presentation,
        WoDemo: woDemo,
        location: { search: '', pathname: '/lauumarth', origin: 'https://beta.weotzi.com', hash: '', href: 'https://beta.weotzi.com/lauumarth' },
        addEventListener(name, cb) { state.windowListeners[name] = cb; }
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(read('public', 'shared', 'js', 'artist-profile.js'), sandbox, { filename: 'artist-profile.js' });
    return { sandbox, state };
}

test('N9: con la configuración sin cargar (isDemoMode true) un visitante sigue siendo visitante', async () => {
    const guest = loadProfileScript({ session: null, demoMode: true });
    assert.equal((await guest.sandbox.resolveViewer(UID)).kind, 'guest', 'antes del arreglo devolvía owner');
    assert.equal(guest.sandbox.isOwnerView(), false);

    // Ni el sandbox demo activo alcanza sin la sesión del dueño.
    const demo = loadProfileScript({ session: null, demoMode: true, woDemo: { enabled: true, identity: { userId: UID } } });
    assert.equal((await demo.sandbox.resolveViewer(UID)).kind, 'guest');

    const owner = loadProfileScript({ session: { user: { id: UID }, access_token: 't' }, demoMode: false });
    const ownerView = await owner.sandbox.resolveViewer(UID);
    assert.equal(ownerView.kind, 'owner');
    assert.equal(ownerView.demo, false);
    assert.equal(ownerView.session.user.id, UID);

    const client = loadProfileScript({ session: { user: { id: OTHER } }, ownProfile: null, demoMode: true });
    assert.equal((await client.sandbox.resolveViewer(UID)).kind, 'client');
    const artist = loadProfileScript({ session: { user: { id: OTHER } }, ownProfile: { user_id: OTHER }, demoMode: true });
    assert.equal((await artist.sandbox.resolveViewer(UID)).kind, 'artist', 'otro artista con sesión: no es el dueño');

    // El dueño en el recorrido demo sigue viendo su perfil como dueño (con su sesión).
    const tour = loadProfileScript({ session: { user: { id: UID } }, woDemo: { enabled: true, identity: { userId: UID } } });
    const tourView = await tour.sandbox.resolveViewer(UID);
    assert.equal(tourView.kind, 'owner');
    assert.equal(tourView.demo, true);
});

test('N9: si Auth no responde, el perfil se muestra como a un visitante', async () => {
    const broken = {
        console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, URLSearchParams, URL,
        document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } },
        supabase: { createClient: () => ({ auth: { getSession: async () => { throw new Error('auth caído'); } } }) },
        ArtistProfilePresentation: Presentation,
        location: { search: '', pathname: '/x', origin: 'https://beta.weotzi.com', hash: '' },
        addEventListener() {}
    };
    broken.window = broken;
    vm.createContext(broken);
    vm.runInContext(read('public', 'shared', 'js', 'artist-profile.js'), broken, { filename: 'artist-profile.js' });
    assert.equal((await broken.resolveViewer(UID)).kind, 'guest');
});

// ---------------------------------------------------------------------------
// wo-share-cards.js en una VM con canvas falso
// ---------------------------------------------------------------------------

function fakeCanvasWorld({ imageOk = true, tainted = false, session = { user: { id: UID } }, demo = false, storedCard = null, extra = {} } = {}) {
    const log = { text: [], images: [], rects: 0, canvases: [], uploads: [], scripts: [], storage: {}, listeners: {} };
    function makeContext(canvas) {
        const ctx = {
            font: '10px sans-serif', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: 'left', textBaseline: 'alphabetic', letterSpacing: '0px',
            fillRect() { log.rects += 1; }, strokeRect() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, fill() {}, stroke() {},
            fillText(text, x, y) { log.text.push({ text: String(text), x, y, font: ctx.font, canvas: `${canvas.width}x${canvas.height}` }); },
            measureText(text) {
                const size = Number((/(\d+(?:\.\d+)?)px/.exec(ctx.font) || [0, 10])[1]);
                return { width: String(text).length * size * 0.58 };
            },
            drawImage(...args) { log.images.push({ args: args.slice(1), canvas: `${canvas.width}x${canvas.height}` }); canvas._hasPhoto = true; },
            getImageData() { if (tainted && canvas._hasPhoto) throw new Error('SecurityError'); return { data: [0, 0, 0, 0] }; }
        };
        return ctx;
    }
    const document = {
        documentElement: {},
        head: { appendChild(node) { log.scripts.push(node.src); setTimeout(() => node.onerror && node.onerror(), 0); } },
        createElement(tag) {
            if (tag === 'canvas') {
                const canvas = {
                    width: 0, height: 0, _hasPhoto: false,
                    getContext() { return canvas._ctx || (canvas._ctx = makeContext(canvas)); },
                    toBlob(cb, type, quality) { cb({ type, quality, size: canvas.width * canvas.height, canvas: `${canvas.width}x${canvas.height}` }); }
                };
                log.canvases.push(canvas);
                return canvas;
            }
            return { set src(v) { this._src = v; }, get src() { return this._src; } };
        },
        addEventListener(name, cb) { log.listeners[name] = cb; }
    };
    class FakeImage {
        set src(value) {
            this._src = value;
            log.photoUrl = value;
            setTimeout(() => {
                if (imageOk) { this.naturalWidth = 1600; this.naturalHeight = 2000; this.onload && this.onload(); }
                else this.onerror && this.onerror();
            }, 0);
        }
        get src() { return this._src; }
    }
    const repo = {
        async getPreferences() { return { privacy: { show_city: true } }; },
        async getShareCard() { return storedCard; },
        async saveShareCard(userId, blob, options) {
            log.uploads.push({ userId, blob, options });
            storedCard = { og_path: options.path, signature: options.signature };
            return { og_path: options.path };
        }
    };
    const sandbox = {
        console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, Promise, Math, Date, Number, String, Object, Array, JSON,
        document,
        Image: FakeImage,
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        localStorage: { getItem: (k) => (k in log.storage ? log.storage[k] : null), setItem: (k, v) => { log.storage[k] = String(v); } },
        location: { origin: 'https://beta.weotzi.com', pathname: '/artist/dashboard' },
        WeotziData: { ProfilePublic: repo },
        _supabase: { auth: { getSession: async () => ({ data: { session } }) } },
        WoDemo: demo ? { enabled: true } : null,
        ...(typeof extra === 'function' ? extra({ repo }) : extra)
    };
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(read('public', 'shared', 'js', 'wo-share-cards.js'), sandbox, { filename: 'wo-share-cards.js' });
    return { Cards: sandbox.WoShareCards, log, sandbox };
}

const ARTIST = {
    user_id: UID, username: 'lauumarth.wo', name: 'Lau Marth de la Fuente Larguísima',
    profile_picture: 'https://flbgmlvfiejfttlawnfu.supabase.co/storage/v1/object/public/profile-pictures/x/lau.jpg',
    city: 'Buenos Aires', country: 'Argentina', styles_array: ['Fine line', 'Botánico', 'Blackwork'], gallery_images: []
};
const INPUT = { artist: ARTIST, prefs: { privacy: { show_city: true } }, url: 'https://beta.weotzi.com/lauumarth' };

test('historia 1080×1920: foto con recorte, nombre, estilos, ciudad, enlace corto y marca', async () => {
    const { Cards, log } = fakeCanvasWorld();
    const canvas = await Cards.renderStory(INPUT);
    assert.equal(canvas.width, 1080);
    assert.equal(canvas.height, 1920);
    const texts = log.text.map((t) => t.text);
    assert.ok(texts.includes('WE ÖTZI'), 'marca');
    assert.ok(texts.includes('TATUADOR · BUENOS AIRES'), 'ciudad');
    assert.ok(texts.includes('FINE LINE · BOTÁNICO · BLACKWORK'), 'estilos');
    assert.ok(texts.includes('beta.weotzi.com/lauumarth'), 'enlace corto');
    assert.ok(texts.join(' ').includes('LAU MARTH'), 'nombre');
    // La foto se pide con CORS y se dibuja a todo el ancho con recorte tipo cover.
    assert.match(log.photoUrl, /lau\.jpg\?wo_card=1$/);
    assert.equal(log.images.length, 1);
    const [sx, sy, sw, sh, dx, dy, dw, dh] = log.images[0].args;
    assert.deepEqual([dx, dy, dw, dh], [0, 0, 1080, 1000]);
    assert.ok(Math.abs(sw / sh - 1080 / 1000) < 0.001, 'misma proporción que el destino');
    assert.ok(sx >= 0 && sy >= 0 && sx + sw <= 1600 && sy + sh <= 2000, 'recorte dentro de la foto');
    // Nada importante en las franjas que tapa la interfaz de Instagram.
    for (const t of log.text) {
        assert.ok(t.y >= 250 && t.y <= 1600, `"${t.text}" en y=${t.y}`);
        assert.ok(t.x >= 0 && t.x < 1080);
    }
    // El nombre largo entra en dos líneas dentro del ancho útil.
    const nameLines = log.text.filter((t) => /Archivo Black/.test(t.font) && t.text !== 'WE ÖTZI');
    assert.ok(nameLines.length >= 1 && nameLines.length <= 2, String(nameLines.length));
    for (const line of nameLines) {
        const size = Number(/(\d+)px/.exec(line.font)[1]);
        assert.ok(line.text.length * size * 0.58 <= 1080 - 144 + 1, `${line.text} @${size}`);
    }
    const blob = await Cards.storyBlob(INPUT);
    assert.equal(blob.type, 'image/jpeg');
    assert.equal(blob.canvas, '1080x1920');
});

test('tarjeta Open Graph 1200×630 y respaldos: sin foto, foto sin CORS y ciudad privada', async () => {
    const og = fakeCanvasWorld();
    const canvas = await og.Cards.renderOg(INPUT);
    assert.deepEqual([canvas.width, canvas.height], [1200, 630]);
    const texts = og.log.text.map((t) => t.text);
    for (const expected of ['WE ÖTZI', 'TATUADOR · BUENOS AIRES', 'FINE LINE · BOTÁNICO · BLACKWORK', 'beta.weotzi.com/lauumarth', 'Pide tu cotización →']) {
        assert.ok(texts.includes(expected), expected);
    }
    for (const t of og.log.text) assert.ok(t.y > 0 && t.y < 630 && t.x >= 0 && t.x < 690, `"${t.text}" fuera del panel de texto`);
    assert.deepEqual(og.log.images[0].args.slice(4), [690, 0, 510, 630]);
    assert.equal((await og.Cards.ogBlob(INPUT)).canvas, '1200x630');

    // Sin foto (o si falla): iniciales sobre tinta, sin drawImage.
    const noPhoto = fakeCanvasWorld({ imageOk: false });
    await noPhoto.Cards.renderOg(INPUT);
    assert.equal(noPhoto.log.images.length, 0);
    assert.ok(noPhoto.log.text.some((t) => t.text === 'LM'), 'iniciales');

    // Foto sin permiso CORS: el canvas quedaría contaminado → se repinta sin ella.
    const tainted = fakeCanvasWorld({ tainted: true });
    const clean = await tainted.Cards.renderOg(INPUT);
    assert.equal(clean._hasPhoto, false);
    assert.equal(tainted.log.canvases.length, 2);

    // Ciudad oculta en la privacidad: no se dibuja.
    const priv = fakeCanvasWorld();
    await priv.Cards.renderStory({ ...INPUT, prefs: { privacy: { show_city: false } } });
    assert.ok(priv.log.text.some((t) => t.text === 'TATUADOR'));
    assert.ok(!priv.log.text.some((t) => /BUENOS AIRES/.test(t.text)));
});

test('tarjeta OG: la sube solo el dueño, a su carpeta, y una vez por cambio', async () => {
    const world = fakeCanvasWorld();
    const first = await world.Cards.syncOgCard(INPUT);
    assert.equal(first.uploaded, true);
    assert.equal(world.log.uploads.length, 1);
    const upload = world.log.uploads[0];
    assert.equal(upload.userId, UID);
    assert.match(upload.options.path, new RegExp(`^${UID}/og-card-\\d{13}\\.jpg$`));
    assert.equal(upload.options.bucket, 'profile-pictures');
    assert.deepEqual([upload.options.width, upload.options.height], [1200, 630]);
    assert.equal(upload.blob.canvas, '1200x630');
    assert.equal(upload.options.signature, world.Cards.signature(world.Cards.cardData(INPUT)));
    // Sin cambios: no se vuelve a subir (ni se consulta de más).
    assert.deepEqual(plain(await world.Cards.syncOgCard(INPUT)), { uploaded: false, reason: 'al-dia' });
    assert.equal(world.log.uploads.length, 1);
    // Cambió el nombre: se regenera y se pasa la ruta anterior para limpiarla.
    const renamed = { ...INPUT, artist: { ...ARTIST, name: 'Lau M.' } };
    assert.equal((await world.Cards.syncOgCard(renamed)).uploaded, true);
    assert.equal(world.log.uploads.length, 2);
    assert.equal(world.log.uploads[1].options.previousPath, upload.options.path);
    // Chequeo automático justo después de otra subida: espera (no hay ping-pong).
    const again = { ...INPUT, artist: { ...ARTIST, name: 'Otra vez' }, auto: true };
    assert.deepEqual(plain(await world.Cards.syncOgCard(again)), { uploaded: false, reason: 'reciente' });
    assert.equal((await world.Cards.syncOgCard({ ...again, auto: false })).uploaded, true, 'guardar o compartir no esperan');

    // Otro usuario, sin sesión o en demo: nunca sube.
    const stranger = fakeCanvasWorld({ session: { user: { id: OTHER } } });
    assert.deepEqual(plain(await stranger.Cards.syncOgCard(INPUT)), { uploaded: false, reason: 'sin-sesion' });
    const anon = fakeCanvasWorld({ session: null });
    assert.deepEqual(plain(await anon.Cards.syncOgCard(INPUT)), { uploaded: false, reason: 'sin-sesion' });
    const demo = fakeCanvasWorld({ demo: true });
    assert.deepEqual(plain(await demo.Cards.syncOgCard(INPUT)), { uploaded: false, reason: 'demo' });
    for (const w of [stranger, anon, demo]) assert.equal(w.log.uploads.length, 0);
    assert.deepEqual(plain(await world.Cards.syncOgCard({ artist: { user_id: 'x' } })), { uploaded: false, reason: 'sin-artista' });
    assert.deepEqual(plain(await world.Cards.syncOgCard({ artist: ARTIST, url: '' })), { uploaded: false, reason: 'sin-enlace' });

    // La base ya tiene esa misma tarjeta (otro dispositivo): no se sube de nuevo.
    const sig = world.Cards.signature(world.Cards.cardData(INPUT));
    const synced = fakeCanvasWorld({ storedCard: { og_path: `${UID}/og-card-1763240000000.jpg`, signature: sig } });
    assert.deepEqual(plain(await synced.Cards.syncOgCard(INPUT)), { uploaded: false, reason: 'al-dia' });
    assert.equal(synced.log.uploads.length, 0);
});

test('centro de la cuenta: al guardar "Mi perfil" se regenera la tarjeta con la URL corta', async () => {
    const PublicUrl = require('../public/shared/js/artist-public-url.js');
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const fast = (fn, ms) => setTimeout(fn, Math.min(Number(ms) || 0, 5));
    const account = (overrides = {}) => fakeCanvasWorld({
        extra: ({ repo }) => ({
            setTimeout: fast,
            location: { origin: 'https://beta.weotzi.com', pathname: '/artist/account' },
            WoArtistPublicUrl: PublicUrl,
            WeotziData: {
                ProfilePublic: repo,
                Artists: { getPublicByUserId: async (userId) => ({ data: { ...ARTIST, user_id: userId }, error: null }) }
            },
            ...overrides
        })
    });

    const world = account();
    const onSave = world.log.listeners['wo:assist-refresh'];
    assert.equal(typeof onSave, 'function', 'escucha las guardadas del centro de la cuenta');
    onSave({ detail: { section: 'disponibilidad' } });
    await wait(40);
    assert.equal(world.log.uploads.length, 0, 'otras secciones no tocan la tarjeta');
    // Varias guardadas seguidas (foto + datos) → una sola tarjeta.
    onSave({ detail: { section: 'perfil' } });
    onSave({ detail: { section: 'perfil' } });
    onSave({ detail: { section: 'portafolio' } });
    await wait(80);
    assert.equal(world.log.uploads.length, 1);
    assert.match(world.log.uploads[0].options.path, new RegExp(`^${UID}/og-card-\\d{13}\\.jpg$`));
    assert.ok(world.log.text.some((t) => t.text === 'beta.weotzi.com/lauumarth'), 'la misma URL corta que usa el perfil');

    // Sin la regla de URL corta (el script no carga) no se genera una tarjeta con otro enlace.
    const noUrl = account({ WoArtistPublicUrl: undefined });
    assert.equal(plain(await noUrl.Cards.syncForSession()).reason, 'sin-repo');
    assert.ok(noUrl.log.scripts.some((src) => /\/shared\/js\/artist-public-url\.js$/.test(src)), 'intenta cargarla a demanda');
    assert.equal(noUrl.log.uploads.length, 0);
    // Sin sesión no hace nada.
    const anon = fakeCanvasWorld({
        session: null,
        extra: ({ repo }) => ({ WoArtistPublicUrl: PublicUrl, WeotziData: { ProfilePublic: repo, Artists: { getPublicByUserId: async () => ({ data: ARTIST }) } } })
    });
    assert.equal(plain(await anon.Cards.syncForSession()).reason, 'sin-sesion');
});

// ---------------------------------------------------------------------------
// wo-share-sheet.js: el toque en Instagram (nota N8)
// ---------------------------------------------------------------------------

function shareSheetWorld({ touch = false, canShareFiles = true, storyDelay = 0, storyFails = false, withCards = true } = {}) {
    const log = { copied: [], shared: [], downloads: [], opened: [], tracked: [], order: [] };
    // Los hijos se buscan sobre el mismo HTML del diálogo (el panel es parte de él).
    const makeEl = () => ({
        hidden: false, textContent: '', disabled: false, attrs: {}, width: 270, height: 480,
        setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
        addEventListener() {}, focus() {}, querySelector(selector) { return dialog.querySelector(selector); },
        getContext() { return { drawImage() {} }; }
    });
    const dialog = {
        listeners: {}, html: '', els: {}, open: false, className: '',
        set innerHTML(value) { this.html = value; this.els = {}; },
        get innerHTML() { return this.html; },
        querySelector(selector) {
            const marker = selector.startsWith('.') ? selector.slice(1) : selector.slice(1, -1);
            if (!this.html.includes(marker)) return null;
            return this.els[selector] || (this.els[selector] = makeEl());
        },
        setAttribute() {}, removeAttribute() {}, contains() { return true; },
        addEventListener(name, cb) { this.listeners[name] = cb; },
        showModal() { this.open = true; }, close() { this.open = false; }
    };
    const sandbox = {
        console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, Promise, Object, String, File,
        URL: { createObjectURL: () => 'blob:historia', revokeObjectURL() {} },
        document: {
            documentElement: { classList: { add() {}, remove() {} } },
            body: { appendChild() {} },
            contains() { return false; },
            createElement(tag) {
                if (tag === 'dialog') return dialog;
                return { set href(v) { this._href = v; }, get href() { return this._href; }, click() { log.downloads.push({ href: this._href, name: this.download }); log.order.push('download'); }, remove() {} };
            }
        },
        navigator: {
            clipboard: { writeText: async (text) => { log.copied.push(text); log.order.push('copy'); } },
            share: touch || canShareFiles ? async (data) => { log.shared.push(data); log.order.push('share'); } : undefined,
            canShare: (data) => canShareFiles && Array.isArray(data.files) && data.files.length === 1
        },
        matchMedia: () => ({ matches: touch }),
        open: (url) => { log.opened.push(url); },
        WoShareCards: withCards ? {
            renderStory: (input) => new Promise((resolve, reject) => setTimeout(() => {
                log.storyInput = input;
                storyFails ? reject(new Error('sin canvas')) : resolve({ width: 1080, height: 1920 });
            }, storyDelay)),
            toBlob: async (canvas, type) => new Blob(['x'], { type }),
            storyFileName: (name) => `historia-${name}.jpg`
        } : undefined
    };
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(read('public', 'shared', 'js', 'wo-share-sheet.js'), sandbox, { filename: 'wo-share-sheet.js' });
    const open = () => sandbox.WoShareSheet.open({
        url: 'https://beta.weotzi.com/lauumarth', title: 'Lau · We Ötzi', text: 'Mira el perfil', name: 'Lau Marth', fileName: 'lauumarth',
        story: withCards ? { artist: ARTIST, prefs: {} } : null,
        onShare: (channel) => log.tracked.push(channel)
    });
    const click = (attrs) => dialog.listeners.click({
        target: { closest: () => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null), querySelector: () => null }) },
        preventDefault() {}
    });
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    return { log, dialog, open, click, wait };
}

test('N8: la hoja ofrece cinco destinos y ninguno es Mail, Telegram ni LinkedIn', async () => {
    const { dialog, open, wait } = shareSheetWorld();
    open();
    await wait(10);
    const nets = [...dialog.html.matchAll(/data-net="([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(nets, ['whatsapp', 'instagram', 'facebook', 'x', 'qr']);
    assert.doesNotMatch(dialog.html, /telegram|linkedin|mailto:|t\.me|>Mail</i);
    assert.match(dialog.html, /aria-controls="wss-story"/);
    assert.match(dialog.html, /Historia de Instagram/);
    assert.equal(dialog.open, true);
});

test('N8 teléfono: Instagram comparte la imagen de la historia en el mismo toque y copia el enlace', async () => {
    const { log, dialog, open, click, wait } = shareSheetWorld({ touch: true });
    open();
    await wait(15); // la imagen se prepara al abrir la hoja
    assert.equal(log.storyInput.url, 'https://beta.weotzi.com/lauumarth');
    click({ 'data-net': 'instagram' });
    // Todo dentro del mismo click (sin esperar promesas): copia y menú del sistema.
    assert.deepEqual(log.order, ['copy', 'share']);
    assert.deepEqual(log.copied, ['https://beta.weotzi.com/lauumarth']);
    assert.equal(log.shared.length, 1);
    assert.equal(log.shared[0].files.length, 1);
    assert.equal(log.shared[0].files[0].name, 'historia-lauumarth.jpg');
    assert.equal(log.shared[0].files[0].type, 'image/jpeg');
    assert.equal(log.shared[0].url, undefined, 'solo la imagen: así aparece Instagram Historias');
    assert.deepEqual(log.opened, [], 'ya no abre instagram.com');
    assert.equal(log.downloads.length, 0);
    await wait(10);
    assert.deepEqual(log.tracked, ['instagram', 'story']);
    assert.equal(dialog.querySelector('[data-share-story]').hidden, false);
    assert.match(dialog.querySelector('[data-story-note]').textContent, /pega el enlace: ya está copiado/);
});

test('N8 escritorio: Instagram descarga la imagen, copia el enlace y muestra los pasos', async () => {
    const { log, dialog, open, click, wait } = shareSheetWorld({ touch: false });
    open();
    await wait(15);
    click({ 'data-net': 'instagram' });
    assert.deepEqual(log.order, ['copy', 'download']);
    assert.equal(log.shared.length, 0, 'en escritorio no se abre el menú del sistema');
    assert.deepEqual(log.downloads, [{ href: 'blob:historia', name: 'historia-lauumarth.jpg' }]);
    await wait(10);
    assert.equal(dialog.querySelector('[data-story-note]').textContent, 'Copiamos el enlace. Sube la imagen a tu historia y pega el enlace con el sticker de enlace.');
    assert.equal(dialog.querySelector('[data-share-act="story-share"]').hidden, true);
    assert.equal(dialog.querySelector('[data-share-act="story-download"]').disabled, false);
    // Otro toque no vuelve a descargar sola; el botón "Descargar imagen", sí.
    click({ 'data-net': 'instagram' });
    assert.equal(log.downloads.length, 1);
    click({ 'data-share-act': 'story-download' });
    assert.equal(log.downloads.length, 2);

    // La imagen todavía se está generando al tocar: se descarga cuando termina.
    const slow = shareSheetWorld({ touch: false, storyDelay: 30 });
    slow.open();
    slow.click({ 'data-net': 'instagram' });
    assert.equal(slow.log.downloads.length, 0);
    assert.equal(slow.dialog.querySelector('[data-share-act="story-download"]').disabled, true);
    await slow.wait(70);
    assert.equal(slow.log.downloads.length, 1);
    assert.equal(slow.dialog.querySelector('[data-share-act="story-download"]').disabled, false);
});

test('N8 respaldos: sin imagen o sin compositor el enlace igual queda copiado', async () => {
    // El canvas falla: se avisa y no se descarga nada.
    const failed = shareSheetWorld({ touch: false, storyFails: true });
    failed.open();
    await failed.wait(15);
    failed.click({ 'data-net': 'instagram' });
    await failed.wait(10);
    assert.deepEqual(failed.log.copied, ['https://beta.weotzi.com/lauumarth']);
    assert.equal(failed.log.downloads.length, 0);
    assert.match(failed.dialog.querySelector('[data-story-wait]').textContent, /No pudimos crear la imagen/);
    // Teléfono sin poder compartir archivos: queda el panel con "Descargar imagen".
    const noFiles = shareSheetWorld({ touch: true, canShareFiles: false });
    noFiles.open();
    await noFiles.wait(15);
    noFiles.click({ 'data-net': 'instagram' });
    assert.equal(noFiles.log.shared.length, 0);
    assert.equal(noFiles.dialog.querySelector('[data-share-story]').hidden, false);
    assert.equal(noFiles.dialog.querySelector('[data-share-act="story-share"]').hidden, true);
    // Sin wo-share-cards.js (otra página): copia y abre Instagram, como antes.
    const bare = shareSheetWorld({ withCards: false });
    bare.open();
    bare.click({ 'data-net': 'instagram' });
    assert.deepEqual(bare.log.copied, ['https://beta.weotzi.com/lauumarth']);
    assert.deepEqual(bare.log.opened, ['https://www.instagram.com/']);
    assert.doesNotMatch(bare.dialog.html, /wss-story/);
});
