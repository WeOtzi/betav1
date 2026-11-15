'use strict';

// Frente "perfil" (beta cerrada): URL corta, meta OG del lado servidor,
// integridad del username y contratos del perfil público.
// Auditoría perfil-publico PP-01..PP-16 (sin PP-12 ni PP-15).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const root = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').replace(/\r\n/g, '\n');

const PublicUrl = require('../public/shared/js/artist-public-url.js');
const ProfileMeta = require('../lib/profile-meta');
const { createProfileRoutes, register, resolveAppBase } = require('../lib/routes/perfil');
const { reservedHandles, isReservedHandle, resetCache } = require('../lib/reserved-handles');
const { createArtistsPublicRepo } = require('../lib/repos/artists-public');
const ShareSheet = require('../public/shared/js/wo-share-sheet.js');

// ---------------------------------------------------------------------------
// URL pública (artist-public-url.js)
// ---------------------------------------------------------------------------

test('normalizeUsername: sin espacios ni @, en minúsculas y con .wo', () => {
    assert.equal(PublicUrl.normalizeUsername('  @@LauUmarth '), 'lauumarth.wo');
    assert.equal(PublicUrl.normalizeUsername('lauumarth.WO'), 'lauumarth.wo');
    assert.equal(PublicUrl.normalizeUsername('lauumarth.wo'), 'lauumarth.wo');
    assert.equal(PublicUrl.normalizeUsername(''), '');
    assert.equal(PublicUrl.normalizeUsername(null), '');
});

test('publicProfileUrl: URL corta y alias largo cuando no corresponde', () => {
    const base = 'https://beta.weotzi.com/';
    assert.equal(PublicUrl.publicProfileUrl('lauumarth.wo', base), 'https://beta.weotzi.com/lauumarth');
    assert.equal(PublicUrl.publicProfileUrl('@LauUmarth', base), 'https://beta.weotzi.com/lauumarth');
    assert.equal(PublicUrl.publicProfileUrl('lauumarth.wo', base, { hash: 'block-gallery' }), 'https://beta.weotzi.com/lauumarth#block-gallery');
    // Reservado (ruta de la app) → alias.
    assert.equal(PublicUrl.publicProfileUrl('explore.wo', base), 'https://beta.weotzi.com/artist/profile?artist=explore.wo');
    // Fila vieja fuera de formato → alias, escapado.
    assert.equal(PublicUrl.publicProfileUrl('laura-auditoria.wo', ''), '/artist/profile?artist=laura-auditoria.wo');
    assert.equal(PublicUrl.publicProfileUrl('a"b<c>.wo', ''), '/artist/profile?artist=a%22b%3Cc%3E.wo');
    // 31 caracteres: no entra en la URL corta.
    assert.equal(PublicUrl.handleFromUsername('a'.repeat(31) + '.wo'), '');
    assert.equal(PublicUrl.publicProfileUrl('', base), '');
    assert.equal(PublicUrl.publicProfileUrl('lau.wo', '', { reserved: ['lau'] }), '/artist/profile?artist=lau.wo');
});

test('parsePathHandle: /lau, /@lau y /lau.wo; nada reservado ni con otros caracteres', () => {
    assert.deepEqual(PublicUrl.parsePathHandle('lauumarth'), { handle: 'lauumarth', username: 'lauumarth.wo', canonical: true });
    assert.deepEqual(PublicUrl.parsePathHandle('@lauumarth'), { handle: 'lauumarth', username: 'lauumarth.wo', canonical: false });
    assert.deepEqual(PublicUrl.parsePathHandle('LauUmarth.WO'), { handle: 'lauumarth', username: 'lauumarth.wo', canonical: false });
    assert.deepEqual(PublicUrl.parsePathHandle('%40lau'), { handle: 'lau', username: 'lau.wo', canonical: false });
    for (const bad of ['explore', 'api', 'studio', 'favicon.ico', 'lau-marth', 'lau.marth', 'a'.repeat(31), '', '%E0%A4%A', 'lau/x']) {
        assert.equal(PublicUrl.parsePathHandle(bad), null, bad);
    }
});

test('usernameFromSearch: ?artist= oficial y los alias viejos ?u= / ?username=', () => {
    assert.equal(PublicUrl.usernameFromSearch('?artist=lau.wo&u=otro'), 'lau.wo');
    assert.equal(PublicUrl.usernameFromSearch('?u=lau.wo'), 'lau.wo');
    assert.equal(PublicUrl.usernameFromSearch('?username=lau'), 'lau');
    assert.equal(PublicUrl.usernameFromSearch('?id=123'), '');
    assert.ok(PublicUrl.isUuid('3f2b8c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f'));
    assert.ok(!PublicUrl.isUuid('3f2b8c1e'));
});

test('toda carpeta alfanumérica de public/ está reservada en la lista compartida', () => {
    const entries = fs.readdirSync(path.join(root, 'public'), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name.toLowerCase())
        .filter((name) => /^[a-z0-9]{1,30}$/.test(name));
    for (const name of entries) {
        assert.ok(PublicUrl.RESERVED.includes(name), `falta reservar /${name} en artist-public-url.js`);
    }
    // Rutas retiradas que redirige el servidor.
    const legacy = Object.keys(require('../lib/legacy-routes').LEGACY_ARTIST_ROUTES)
        .map((route) => route.slice(1)).filter((r) => /^[a-z0-9]+$/.test(r));
    for (const name of legacy) assert.ok(PublicUrl.RESERVED.includes(name), `falta reservar /${name}`);
});

test('reserved-handles (servidor) suma en vivo las entradas de public/', () => {
    resetCache();
    const publicDir = path.join(root, 'public');
    const set = reservedHandles(publicDir);
    assert.ok(set.has('explore'));
    assert.ok(set.has('favicon'));
    assert.ok(set.has('api'));
    assert.ok(isReservedHandle(publicDir, 'marketplace'));
    assert.ok(!isReservedHandle(publicDir, 'lauumarth'));
});

// ---------------------------------------------------------------------------
// Meta OG (lib/profile-meta.js)
// ---------------------------------------------------------------------------

const TEMPLATE = read('public', 'artist', 'profile', 'index.html');
const ARTIST = {
    user_id: '3f2b8c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    username: 'lauumarth.wo',
    name: 'Lau <script>alert(1)</script> "Marth"',
    bio_description: '<p>Fine line &amp; botánico.</p><script>alert(2)</script><p>Turnos en Buenos Aires.</p>',
    profile_picture: 'https://flbgmlvfiejfttlawnfu.supabase.co/storage/v1/object/public/a/lau.jpg',
    gallery_images: [],
    city: 'Buenos Aires',
    country: 'Argentina',
    styles_array: ['Fine line', 'Botánico']
};

test('buildArtistMeta: título, descripción sin HTML, imagen y robots según la privacidad', () => {
    const meta = ProfileMeta.buildArtistMeta({
        artist: ARTIST,
        prefs: { privacy: { allow_search_indexing: false } },
        canonicalUrl: 'https://beta.weotzi.com/lauumarth',
        defaultImage: 'https://beta.weotzi.com/shared/img/og-default.jpg'
    });
    assert.equal(meta.title, 'Lau <script>alert(1)</script> "Marth" · Tatuador en We Ötzi');
    assert.ok(!/<|alert\(2\)/.test(meta.description), meta.description);
    assert.match(meta.description, /^Fine line & botánico\./);
    assert.equal(meta.image, ARTIST.profile_picture);
    assert.equal(meta.robots, 'noindex,nofollow');
    assert.equal(ProfileMeta.buildArtistMeta({ artist: ARTIST, prefs: { privacy: { allow_search_indexing: true } } }).robots, 'index,follow');
    assert.equal(ProfileMeta.buildArtistMeta({ artist: ARTIST }).robots, 'noindex,nofollow', 'sin preferencias no se indexa');
});

test('pickImage: foto → primer trabajo raster → imagen por defecto (sin relativas, SVG ni video)', () => {
    const def = 'https://beta.weotzi.com/shared/img/og-default.jpg';
    assert.deepEqual(ProfileMeta.pickImage({ profile_picture: '/shared/assets/demo/client-avatar.svg', gallery_images: ['/shared/assets/demo/ref-01.svg'] }, def), { url: def, isDefault: true });
    assert.deepEqual(ProfileMeta.pickImage({
        profile_picture: '',
        gallery_images: JSON.stringify(['https://x.supabase.co/a/clip.mp4', 'https://x.supabase.co/a/logo.svg', { url: 'https://x.supabase.co/a/v.webm' }, 'https://x.supabase.co/a/work.jpg'])
    }, def), { url: 'https://x.supabase.co/a/work.jpg', isDefault: false });
    assert.equal(ProfileMeta.pickImage({ profile_picture: 'javascript:alert(1)' }, def).url, def);
});

test('describe sin bio: estilos y ciudad (la ciudad solo si es pública)', () => {
    const artist = { ...ARTIST, bio_description: '' };
    const withCity = ProfileMeta.buildArtistMeta({ artist, prefs: { privacy: { show_city: true } } }).description;
    assert.match(withCity, /Fine line, Botánico · Buenos Aires\. Mirá el portafolio/);
    const noCity = ProfileMeta.buildArtistMeta({ artist, prefs: { privacy: { show_city: false } } }).description;
    assert.doesNotMatch(noCity, /Buenos Aires/);
    const long = ProfileMeta.buildArtistMeta({ artist: { ...ARTIST, bio_description: 'palabra '.repeat(80) } }).description;
    assert.ok(long.length <= 160 && long.endsWith('…'), long);
});

test('injectMeta: escapa todo, completa OG/Twitter/canonical y deja un solo valor por etiqueta', () => {
    const meta = ProfileMeta.buildArtistMeta({
        artist: { ...ARTIST, name: 'Lau $& "x"' },
        prefs: {},
        canonicalUrl: 'https://beta.weotzi.com/lauumarth',
        defaultImage: 'https://beta.weotzi.com/shared/img/og-default.jpg'
    });
    const html = ProfileMeta.injectMeta(TEMPLATE, meta);
    assert.match(html, /<title>Lau \$&amp; &quot;x&quot; · Tatuador en We Ötzi<\/title>/);
    assert.match(html, /<meta property="og:title" id="og-title" content="Lau \$&amp; &quot;x&quot; · Tatuador en We Ötzi">/);
    assert.match(html, /<meta property="og:url" id="og-url" content="https:\/\/beta\.weotzi\.com\/lauumarth">/);
    assert.match(html, /<link rel="canonical" id="profile-canonical" href="https:\/\/beta\.weotzi\.com\/lauumarth">/);
    assert.match(html, /<meta name="twitter:card" id="twitter-card" content="summary_large_image">/);
    assert.match(html, /<meta property="og:image" id="og-image" content="https:\/\/flbgmlvfiejfttlawnfu/);
    assert.match(html, /<meta name="twitter:image" id="twitter-image"/);
    assert.match(html, /<meta property="og:site_name" id="og-site-name" content="We Ötzi">/);
    assert.match(html, /<meta property="og:locale" id="og-locale" content="es_AR">/);
    assert.match(html, /<meta property="profile:username" id="profile-username" content="lauumarth\.wo">/);
    assert.match(html, /<meta name="robots" id="profile-robots" content="noindex,nofollow">/);
    for (const id of ['og-title', 'og-image', 'profile-robots', 'profile-canonical', 'twitter-title']) {
        assert.equal(html.split(`id="${id}"`).length - 1, 1, `una sola etiqueta ${id}`);
    }
    assert.doesNotMatch(html, /<script>alert/);
    // Volver a inyectar no duplica.
    const twice = ProfileMeta.injectMeta(html, meta);
    assert.equal(twice.split('id="og-image"').length - 1, 1);
});

test('fallback: imagen por defecto 1200x630 y noindex', () => {
    const html = ProfileMeta.injectMeta(TEMPLATE, ProfileMeta.buildFallbackMeta({ defaultImage: 'https://beta.weotzi.com/shared/img/og-default.jpg' }));
    assert.match(html, /og:image" id="og-image" content="https:\/\/beta\.weotzi\.com\/shared\/img\/og-default\.jpg"/);
    assert.match(html, /og:image:width" id="og-image-width" content="1200"/);
    assert.match(html, /content="noindex,nofollow"/);
    assert.doesNotMatch(html, /id="profile-canonical"/);
    assert.ok(fs.existsSync(path.join(root, 'public', 'shared', 'img', 'og-default.jpg')), 'imagen por defecto raster');
});

// ---------------------------------------------------------------------------
// Rutas (lib/routes/perfil.js) con el repo simulado
// ---------------------------------------------------------------------------

function fakeRepo(artists, calls = []) {
    return {
        async findPublicByUsername(u) { calls.push(['u', u]); return artists.find((a) => a.username === PublicUrl.normalizeUsername(u)) || null; },
        async findPublicByUserId(id) { calls.push(['id', id]); return artists.find((a) => a.user_id === id) || null; },
        async getPublicPrefs() { return { privacy: { allow_search_indexing: true } }; }
    };
}

async function withServer(deps, fn, { basePath = '' } = {}) {
    const app = express();
    app.set('trust proxy', 1);
    if (basePath) {
        app.use((req, res, next) => {
            if (req.url.startsWith(basePath + '/')) { req.weotziBasePath = basePath; req.url = req.url.slice(basePath.length); }
            next();
        });
    }
    register(app, deps);
    app.get('*', (req, res) => res.status(404).send('fallthrough'));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
        await fn(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

const ENV = { PUBLIC_APP_URL: 'https://beta.weotzi.com' };
const publicDir = path.join(root, 'public');

test('GET /artist/profile?artist= sirve el HTML con los meta del artista', async () => {
    await withServer({ publicDir, env: ENV, repo: fakeRepo([ARTIST]) }, async (base) => {
        const res = await fetch(`${base}/artist/profile?artist=LauUmarth`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type'), /text\/html/);
        assert.match(res.headers.get('cache-control'), /max-age=300/);
        const html = await res.text();
        assert.match(html, /<link rel="canonical" id="profile-canonical" href="https:\/\/beta\.weotzi\.com\/lauumarth">/);
        assert.match(html, /content="index,follow"/, 'robots según la preferencia');
        assert.match(html, /id="artist-name"/, 'es la página del perfil');
        // Alias de siempre y el viejo ?u= del cliente.
        for (const q of ['?u=lauumarth.wo', '?username=@lauumarth', '?id=' + ARTIST.user_id]) {
            const alias = await (await fetch(`${base}/artist/profile/${q}`)).text();
            assert.match(alias, /og:title" id="og-title" content="Lau/, q);
        }
    });
});

test('artista inexistente o error: HTML original con noindex (y 404 si no existe)', async () => {
    const broken = { ...fakeRepo([]), async findPublicByUsername() { throw new Error('PostgREST caído'); } };
    const warn = console.warn;
    console.warn = () => {};
    try {
        await withServer({ publicDir, env: ENV, repo: fakeRepo([]) }, async (base) => {
            const res = await fetch(`${base}/artist/profile?artist=nadie`);
            assert.equal(res.status, 404);
            const html = await res.text();
            assert.match(html, /content="noindex,nofollow"/);
            assert.match(html, /id="profile-error"/, 'la página igual muestra "Artista no encontrado"');
            const empty = await fetch(`${base}/artist/profile`);
            assert.equal(empty.status, 200);
        });
        await withServer({ publicDir, env: ENV, repo: broken }, async (base) => {
            const res = await fetch(`${base}/artist/profile?artist=lauumarth`);
            assert.equal(res.status, 200);
            assert.match(await res.text(), /content="noindex,nofollow"/);
            const short = await fetch(`${base}/lauumarth`);
            assert.equal(await short.text(), 'fallthrough', 'la URL corta cae al 404 de siempre');
        });
    } finally {
        console.warn = warn;
    }
});

test('URL corta: /<handle> sirve el perfil, /@handle y /handle.wo redirigen, lo reservado sigue de largo', async () => {
    const calls = [];
    await withServer({ publicDir, env: {}, repo: fakeRepo([ARTIST], calls) }, async (base) => {
        const res = await fetch(`${base}/beta/lauumarth`);
        assert.equal(res.status, 200);
        const html = await res.text();
        assert.match(html, /profile-canonical" href="http:\/\/127\.0\.0\.1:\d+\/beta\/lauumarth"/, 'canonical con el base path');
        assert.match(html, /og-image" content="https:\/\/flbgmlvfiejfttlawnfu/);

        for (const [from, to] of [['/@lauumarth?x=1', '/lauumarth?x=1'], ['/lauumarth.wo', '/lauumarth'], ['/LauUmarth', '/lauumarth']]) {
            const r = await fetch(base + from, { redirect: 'manual' });
            assert.equal(r.status, 301, from);
            assert.equal(r.headers.get('location'), to, from);
        }

        calls.length = 0;
        for (const p of ['/explore', '/marketplace', '/api', '/favicon.ico', '/nadie', '/lau-marth']) {
            const r = await fetch(base + p);
            assert.equal(await r.text(), 'fallthrough', p);
        }
        assert.deepEqual(calls, [['u', 'nadie.wo']], 'solo consulta la base para handles posibles');
    }, { basePath: '/beta' });
});

test('resolveAppBase: PUBLIC_APP_URL manda; si no, host saneado y https fuera de localhost', () => {
    assert.equal(resolveAppBase({ headers: { host: 'x' } }, { PUBLIC_APP_URL: 'https://beta.weotzi.com/' }), 'https://beta.weotzi.com');
    assert.equal(resolveAppBase({ headers: { host: 'beta.weotzi.com' }, protocol: 'http' }, {}), 'https://beta.weotzi.com');
    assert.equal(resolveAppBase({ headers: { host: 'localhost:4545' }, protocol: 'http', weotziBasePath: '/beta' }, {}), 'http://localhost:4545/beta');
    assert.equal(resolveAppBase({ headers: { host: 'evil"><script>' }, protocol: 'http' }, {}), 'https://beta.weotzi.com');
    // Producción: un Host ajeno no llega al canonical cacheado.
    assert.equal(resolveAppBase({ headers: { host: 'evil.example' }, protocol: 'http' }, { NODE_ENV: 'production' }), 'https://beta.weotzi.com');
    assert.equal(resolveAppBase({ headers: { host: 'weotzi.com' }, protocol: 'http', weotziBasePath: '/beta' }, { NODE_ENV: 'production' }), 'https://weotzi.com/beta');
});

test('el lookup se cachea: dos pedidos seguidos, una consulta', async () => {
    const calls = [];
    const routes = createProfileRoutes({ publicDir, env: ENV, repo: fakeRepo([ARTIST], calls) });
    const res = () => ({ status() { return this; }, set() { return this; }, send() { return this; } });
    await routes.serveProfile({ originalUrl: '/artist/profile?artist=lauumarth', headers: {} }, res());
    await routes.serveProfile({ originalUrl: '/artist/profile?artist=LAUUMARTH.wo', headers: {} }, res());
    assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------------------
// Repo del servidor (lib/repos/artists-public.js)
// ---------------------------------------------------------------------------

test('artists-public: anon key, solo filas publicadas y usuario normalizado', async () => {
    const seen = [];
    const query = (table, opts) => {
        const q = { table, opts, filters: [], select(c) { this.cols = c; return this; }, or(c) { this.orFilter = c; return this; },
            eq(c, v) { this.filters.push([c, v]); return this; }, limit() { return this; },
            async execute() { seen.push(this); return [{ username: 'lauumarth.wo' }]; } };
        return q;
    };
    query.raw = async (p, opts) => { seen.push({ raw: p, opts }); return { privacy: {} }; };
    const repo = createArtistsPublicRepo({ query });
    assert.deepEqual(await repo.findPublicByUsername(' @LauUmarth '), { username: 'lauumarth.wo' });
    assert.equal(seen[0].table, 'artists_db');
    assert.deepEqual(seen[0].opts, { key: 'anon' });
    assert.deepEqual(seen[0].filters, [['username', 'lauumarth.wo']]);
    assert.deepEqual(seen[0].orFilter, [
        { col: 'registration_status', op: 'is', val: 'null' },
        { col: 'registration_status', op: 'neq', val: 'incompleto' }
    ]);
    assert.doesNotMatch(seen[0].cols, /email|whatsapp|birth|street/);
    assert.equal(await repo.findPublicByUserId('no-uuid'), null);
    await repo.getPublicPrefs(ARTIST.user_id);
    assert.equal(seen[1].raw, 'rpc/get_artist_public_profile_preferences');
    assert.equal(seen[1].opts.key, 'anon');
});

// ---------------------------------------------------------------------------
// Hoja "Compartir"
// ---------------------------------------------------------------------------

test('wo-share-sheet: enlaces de las redes, codificados (ronda 2: sin Mail, Telegram ni LinkedIn)', () => {
    const l = ShareSheet.networkLinks('https://beta.weotzi.com/lau?x=1&y=2', 'Mirá a Lau & cía', 'Lau · We Ötzi');
    assert.equal(l.whatsapp, 'https://wa.me/?text=' + encodeURIComponent('Mirá a Lau & cía: https://beta.weotzi.com/lau?x=1&y=2'));
    assert.equal(l.facebook, 'https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fbeta.weotzi.com%2Flau%3Fx%3D1%26y%3D2');
    assert.match(l.x, /^https:\/\/twitter\.com\/intent\/tweet\?url=https%3A/);
    assert.deepEqual(Object.keys(l).sort(), ['facebook', 'whatsapp', 'x'], 'nota N8: sin Mail, Telegram ni LinkedIn');
    assert.deepEqual(ShareSheet.NETWORKS, ['whatsapp', 'instagram', 'facebook', 'x', 'qr']);
});

// ---------------------------------------------------------------------------
// Contratos de HTML / JS
// ---------------------------------------------------------------------------

test('perfil público: barra según la sesión, franja del dueño, compartir y scripts', () => {
    const html = TEMPLATE;
    assert.doesNotMatch(html, /<weotzi-product-nav/, 'la barra del artista no va fija para cualquier visitante');
    assert.match(html, /id="profile-topbar"[\s\S]*?class="wo-topbar profile-public-topbar"/);
    assert.match(html, /id="profile-owner-bar"[^>]*hidden/);
    assert.match(html, /<button type="button" class="[^"]*hero-cta-share" id="profile-share-btn"/);
    assert.match(html, /id="gallery-owner-cta" href="\/artist\/account#portafolio" hidden/);
    assert.match(html, /id="cta-turnos-link" href="#turnos" hidden/);
    assert.match(html, /content="noindex,nofollow"/, 'el HTML sin servidor no se indexa');
    assert.doesNotMatch(html, /We Otzi/);
    assert.doesNotMatch(html, /href="\/quotations"/);
    const order = ['artist-public-url.js', 'wo-share-sheet.js', 'artist-profile.js'].map((n) => html.indexOf(`/shared/js/${n}`));
    assert.ok(order.every((i) => i > -1) && order[0] < order[1] && order[1] < order[2], 'orden de scripts');
    assert.match(html, /\/shared\/css\/wo-share-sheet\.css/);
});

test('artist-profile.js: alias, sesión, galería del visitante, anclas y sello verificado', () => {
    const js = read('public', 'shared', 'js', 'artist-profile.js');
    assert.match(js, /usernameFromSearch\(window\.location\.search\)/);
    assert.match(js, /getPublicByUserId\(ref\.userId/);
    assert.match(js, /history\.replaceState/);
    assert.match(js, /getAttribute\('content'\)/, 'lee el usuario que dejó el servidor en la URL corta');
    assert.match(js, /function applySessionTopbar\(\)/);
    assert.match(js, /viewer\.kind === 'owner' \|\| viewer\.kind === 'artist'/);
    assert.match(js, /function gallerySlotCount\(visibleCount, owner\)/);
    assert.match(js, /function scrollToRequestedSection/);
    assert.match(js, /prefers-reduced-motion: reduce/);
    assert.match(js, /publicProfilePreferences\.verified === true/);
    assert.match(js, /acknowledgeOnboarding\('compartir\.enlace'\)/);
    assert.match(js, /if \(!isOwnerView\(\) \|\| onboardingAcks\.has\(id\)\) return;/, 'solo el dueño marca su onboarding');
    assert.match(js, /return `\/quotation\?artist=\$\{encodeURIComponent\(username\)\}`;/);
    assert.doesNotMatch(js, /\/quotations\?artist=/);
    assert.doesNotMatch(js, /We Otzi/);
    // Funciones auxiliares del archivo que el nuevo código usa.
    const fnSrc = js.slice(js.indexOf('function gallerySlotCount'), js.indexOf('function renderGalleryGrid'));
    const gallerySlotCount = new Function('MIN_GALLERY_SLOTS', `${fnSrc}; return gallerySlotCount;`)(9);
    // Ronda 2: el visitante ve solo los trabajos (sin huecos punteados); el
    // dueño, los 9 espacios del Figma como invitación a completar.
    assert.equal(gallerySlotCount(0, false), 0);
    assert.equal(gallerySlotCount(4, false), 4);
    assert.equal(gallerySlotCount(0, true), 9);
    assert.equal(gallerySlotCount(10, true), 12);
});

test('enlaces del cliente al perfil usan ?artist= y van escapados (PP-04)', () => {
    const dash = read('public', 'shared', 'js', 'client-dashboard.js');
    const reqs = read('public', 'shared', 'js', 'client-requests.js');
    for (const src of [dash, reqs]) assert.doesNotMatch(src, /artist\/profile\?u=/);
    assert.match(dash, /escapeFeedHtml\('\/artist\/profile\?artist=' \+ encodeURIComponent\(artist\.username\)\)/);
    assert.match(dash, /\$\{escapeFeedHtml\(app\.message \|\| 'Sin mensaje'\)\}/);
});

test('artists-repo (front): búsqueda en minúsculas, solo publicados y sin maybeSingle', () => {
    const repo = read('public', 'shared', 'js', 'data', 'artists-repo.js');
    const block = repo.slice(repo.indexOf('async getPublicByExactUsername'), repo.indexOf('findByUsername('));
    assert.match(block, /toLowerCase\(\)/);
    assert.match(block, /registration_status\.is\.null,registration_status\.neq\.incompleto/);
    assert.match(block, /\.limit\(1\)/);
    assert.doesNotMatch(block, /maybeSingle/);
    assert.match(block, /async getPublicByUserId\(userId, columns = '\*'\)/);
});

test('dashboard-share: URL corta, acks del onboarding, redes de la ronda 2 y gestos sincrónicos', () => {
    const share = read('public', 'shared', 'js', 'dashboard-share.js');
    assert.match(share, /WoArtistPublicUrl\.publicProfileUrl\(u, base\(\), \{ hash: hash \}\)/);
    assert.match(share, /ack\('compartir\.enlace'\)/);
    assert.match(share, /ack\('compartir'\)/);
    assert.match(share, /assisted: \{ acknowledge: id \}/);
    assert.match(share, /'wo:assist-refresh'/);
    for (const net of ['facebook', 'x']) assert.match(share, new RegExp(`netLink\\('${net}'`));
    // Nota N8: sin Mail, Telegram ni LinkedIn en ninguna hoja de compartir.
    assert.doesNotMatch(share, /t\.me\/share|linkedin\.com|mailto:|data-net="(mail|telegram|linkedin)"|netLink\('(telegram|linkedin)'/i);
    // Instagram: la historia se prepara al pintar el panel y se comparte en el mismo click.
    const ig = share.slice(share.indexOf("var ig = p.querySelector('[data-net=\"instagram\"]')"), share.indexOf("var qrBtn"));
    assert.ok(ig.indexOf('prepareStory();') > -1 && ig.indexOf('prepareStory();') < ig.indexOf("ig.addEventListener('click', shareStory)"), 'la imagen se prepara antes del click');
    assert.match(share, /function prepareCardBlob\(\)/);
    assert.doesNotMatch(share, /cardBlob\(\)\.then\(function \(blob\) \{\s*var file/);
    const dash = read('public', 'artist', 'dashboard', 'index.html');
    const urlScript = dash.indexOf('src="/shared/js/artist-public-url.js');
    assert.ok(urlScript > -1 && urlScript < dash.indexOf('src="/shared/js/dashboard-share.js'), 'artist-public-url.js antes de dashboard-share.js');
});

test('server.js registra las rutas del perfil antes del estático', () => {
    const server = read('server.js');
    const reg = server.indexOf("require('./lib/routes/perfil').register(app");
    assert.ok(reg > -1);
    assert.ok(reg < server.indexOf("app.use(express.static(path.join(__dirname, 'public')))"));
    assert.match(server, /username=eq\.\$\{encodeURIComponent\(normalizedUsername\)\}&or=\(registration_status\.is\.null,registration_status\.neq\.incompleto\)/);
});

test('registro: el usuario generado no pasa de 30 caracteres (formato de la base)', () => {
    const { formatArtistUsername } = require('../lib/artist-registration');
    const u = formatArtistUsername('Estudio De Tatuajes Muy Largo Del Barrio Sur', 'x@y.com');
    assert.ok(PublicUrl.isValidUsername(u), u);
    assert.equal(u, 'estudiodetatuajesmuylargodelba.wo');
});

// ---------------------------------------------------------------------------
// Migración (validada con begin…rollback contra la base viva)
// ---------------------------------------------------------------------------

test('migración 20261115110000: formato, unicidad parcial, trigger y sello verificado', () => {
    const sql = read('supabase', 'migrations', '20261115110000_perfil_username_integridad.sql');
    const down = read('supabase', 'rollbacks', '20261115110000_perfil_username_integridad.down.sql');
    assert.match(sql, /'\^\[a-z0-9\]\{1,30\}\\\.wo\$'/);
    assert.match(sql, /create unique index if not exists artists_db_username_lower_finalized_uniq\s+on public\.artists_db \(lower\(username\)\)\s+where username is not null and registration_status is distinct from 'incompleto'/);
    assert.match(sql, /drop trigger if exists trg_guard_artist_username on public\.artists_db;\s*create trigger trg_guard_artist_username\s+before insert or update of username, registration_status on public\.artists_db/);
    assert.match(sql, /errcode = '23505'/);
    assert.match(sql, /errcode = '23514'/);
    assert.match(sql, /'verified', \(\s*artist\.verification_state = 'Yes'/);
    assert.match(sql, /doc\.doc_type = 'identidad'/);
    assert.match(sql, /stable security definer\s+set search_path = ''/);
    assert.match(sql, /grant execute on function public\.get_artist_public_profile_preferences\(uuid\) to anon, authenticated/);
    assert.doesNotMatch(sql, /^\s*(begin|commit);/im, 'la migración no abre su propia transacción');
    assert.match(down, /drop trigger if exists trg_guard_artist_username/);
    assert.match(down, /drop index if exists public\.artists_db_username_lower_finalized_uniq/);
    assert.doesNotMatch(down, /'verified', \(/, 'la reversa vuelve a la RPC sin el sello');
});

test('centro de la cuenta: el usuario sigue el formato de la base y muestra sus errores', () => {
    const js = read('public', 'shared', 'js', 'artist-account.js');
    assert.match(js, /\/\^\[a-z0-9\]\{3,30\}\$\/\.test\(typed\)/);
    assert.match(js, /code === '23505'/);
    assert.doesNotMatch(js, /\[a-z0-9\._-\]\{3,40\}/);
});
