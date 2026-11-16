'use strict';
// Ronda 2 · frente cot-pasos · P10 — paso "¿Qué estilo estás buscando?".
// Modelo puro (palabras clave por estilo, estilos del artista, orden de la
// cuadrícula), endpoint público sin PII y contrato del front.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
// CRLF del checkout en Windows: los contratos no dependen del fin de línea.
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').replace(/\r\n/g, '\n');

const Model = require('../public/shared/js/quotation-style-model.js');
const suggest = require('../lib/quotation-style-suggest');
const routes = require('../lib/routes/cot-pasos');
const { buildTree, TattooStylesRepo } = require('../lib/repos/tattoo-styles');
const { EXPANDED_TATTOO_STYLES } = require('../lib/expanded-tattoo-styles');
const { LEGACY_STYLE_ALIASES } = require('../lib/registration-catalogs');

const CATALOG = Model.STATIC_CATALOG;
const names = (list) => list.map((item) => (item.style ? item.style.name : item.name));
const top = (idea, limit) => names(Model.suggestStylesForIdea(idea, CATALOG, { limit }));

// ---------------------------------------------------------------------------
// Catálogo y palabras clave
// ---------------------------------------------------------------------------
test('el modelo cubre todo lib/expanded-tattoo-styles.js y los estilos base, con palabras clave', () => {
    const values = CATALOG.map((style) => style.id);
    for (const style of EXPANDED_TATTOO_STYLES) {
        assert.ok(values.includes(style.value), `falta ${style.value} en STATIC_CATALOG`);
        const entry = CATALOG.find((item) => item.id === style.value);
        assert.equal(entry.name, style.label);
    }
    // Estilos base del cotizador (quotation-shared.js).
    const shared = read('public', 'shared', 'js', 'quotation-shared.js');
    const block = shared.slice(shared.indexOf('var TATTOO_STYLE_OPTIONS'), shared.indexOf('function toTitleCase'));
    const sharedValues = [...block.matchAll(/value: '([a-z_]+)'/g)].map((m) => m[1]);
    assert.ok(sharedValues.length >= 56);
    for (const value of sharedValues) assert.ok(values.includes(value), `falta el estilo base ${value}`);

    for (const style of CATALOG) {
        const keywords = Model.keywordsFor(style);
        assert.ok(keywords && keywords.length >= 6, `sin palabras clave suficientes: ${style.name}`);
        assert.ok(keywords.some((k) => k.type === 'name'), `sin nombre: ${style.name}`);
        assert.ok(keywords.some((k) => k.type === 'strong'), `sin señales fuertes: ${style.name}`);
        for (const k of keywords) assert.match(k.norm, /^[a-z0-9]+( [a-z0-9]+)*$/, `clave sin normalizar: ${k.text}`);
    }
    // Cada estilo tiene SU lista (los alias no pisan a otro estilo).
    assert.notEqual(Model.keywordsFor({ name: 'Fineline botanico' }), Model.keywordsFor({ name: 'Ilustracion botanica' }));
});

test('estilos del catálogo vivo con otro nombre encuentran sus palabras clave', () => {
    for (const style of [
        { name: 'Black & Grey', slug: 'black-grey' },
        { name: 'Nordico / Viking', slug: 'nordico-viking' },
        { name: 'FREEHAND', slug: 'freehand' },
        { name: 'Freehand Abstract', slug: 'freehand-abstract' },
        { name: 'CYBERSIGILISMO', slug: 'cybersigilismo' },
        { name: 'Cibersigilismo (Cybersigilism)', slug: 'cibersigilismo-cybersigilism' },
        { name: 'Neotribal (Neo Tribal)', slug: 'neotribal-neo-tribal' },
        { name: 'Japonés', slug: 'japones' },
        { name: 'Neo-Tradicional', slug: 'neo-tradicional' }
    ]) {
        assert.ok(Model.keywordsFor(style), `sin palabras clave: ${style.name}`);
    }
    assert.equal(Model.keywordsFor({ name: 'Estilo inventado', slug: 'estilo-inventado' }), null);
});

test('equivalencias: mismas que el catálogo del registro de tatuadores', () => {
    for (const [label, aliases] of Object.entries(LEGACY_STYLE_ALIASES)) {
        for (const alias of aliases) {
            assert.ok(Model.sameStyle(label, alias), `${label} ≠ ${alias}`);
        }
    }
    assert.equal(Model.sameStyle('Tradicional', 'Neo-Tradicional'), false);
    assert.equal(Model.sameStyle('Tradicional', 'Japonés'), false);
    assert.equal(Model.sameStyle('', ''), false);
    assert.equal(Model.compactKey('Neo-Tradicional'), 'neotradicional');
    assert.equal(Model.normalizeWords('  Dragón  JAPONÉS!! '), 'dragon japones');
});

// ---------------------------------------------------------------------------
// Sugerencia según la idea
// ---------------------------------------------------------------------------
test('la idea sugiere estilos por nombre, señales fuertes y temas', () => {
    assert.equal(top('Quiero un dragón japonés con flores de cerezo')[0], 'Japonés');
    assert.equal(top('retrato realista de mi perro')[0], 'Realismo');
    assert.equal(top('Goku en estilo manga')[0], 'Anime');
    assert.equal(top('mandala en el esternón hecha con puntos')[0], 'Mandala');
    assert.ok(top('mandala en el esternón hecha con puntos').includes('Dotwork'));
    assert.equal(top('Virgen de Guadalupe con rosas')[0], 'Chicano');
    assert.ok(top('el nombre de mi hija y su fecha, algo pequeño y delicado', 5).includes('Lettering'));
    assert.ok(top('el nombre de mi hija y su fecha, algo pequeño y delicado', 5).includes('Fine Line'));
    assert.deepEqual(top('un león'), ['Realismo', 'Neo-Tradicional', 'Black & Grey']);
    assert.equal(top('runas vikingas y el martillo de Thor')[0], 'Nordico / Viking');
});

test('el nombre más largo gana: "neo tradicional" no suma a "Tradicional"', () => {
    const neo = Model.suggestStylesForIdea('algo neo tradicional', CATALOG);
    assert.equal(neo[0].style.name, 'Neo-Tradicional');
    assert.ok(!names(neo).includes('Tradicional'));
    const jp = Model.suggestStylesForIdea('un tigre tradicional japonés', CATALOG);
    assert.equal(jp[0].style.name, 'Japonés');
    assert.ok(!names(jp).includes('Tradicional'));
    // "manga" es un tamaño (manga completa), no anime.
    assert.ok(!top('una manga completa de calaveras y rosas', 8).includes('Anime'));
});

test('plurales, tildes y mayúsculas no cambian el resultado; cada palabra cuenta una vez', () => {
    assert.deepEqual(top('DRAGONES JAPONESES'), top('dragón japonés'));
    const flores = Model.suggestStylesForIdea('flores', CATALOG, { limit: 8 });
    const floral = flores.find((item) => item.style.name === 'Floral');
    assert.equal(floral.score, Model.WEIGHTS.name, '"flor" y "flores" no se suman dos veces');
    const rosas = Model.suggestStylesForIdea('dos rosas', CATALOG, { limit: 8 }).find((item) => item.style.name === 'Floral');
    assert.equal(rosas.score, Model.WEIGHTS.strong);
    assert.deepEqual(rosas.matches.length, 1);
});

test('sin señales no se inventan recomendaciones; entradas raras no rompen', () => {
    assert.deepEqual(Model.suggestStylesForIdea('algo que me represente', CATALOG), []);
    assert.deepEqual(Model.suggestStylesForIdea('', CATALOG), []);
    assert.deepEqual(Model.suggestStylesForIdea(null, CATALOG), []);
    assert.deepEqual(Model.suggestStylesForIdea({ toString: () => 'x' }, CATALOG), []);
    assert.deepEqual(Model.suggestStylesForIdea('<img src=x onerror=alert(1)> %00 \u0000', CATALOG), []);
    // Sin catálogo usa el estático; el límite se acota.
    assert.equal(Model.suggestStylesForIdea('dragón japonés', null)[0].style.name, 'Japonés');
    assert.equal(Model.suggestStylesForIdea('rosa calavera daga león flores letras puntos', CATALOG, { limit: 99 }).length, Model.MAX_LIMIT);
    assert.equal(Model.suggestStylesForIdea('rosa calavera daga león flores letras puntos', CATALOG, { limit: -3 }).length, Model.DEFAULT_LIMIT);
    // La idea se recorta: lo que queda después del límite no cuenta.
    const long = 'x '.repeat(Model.MAX_IDEA_LENGTH) + ' dragón japonés';
    assert.deepEqual(Model.suggestStylesForIdea(long, CATALOG), []);
    for (const item of Model.suggestStylesForIdea('dragón japonés con olas y flores de cerezo', CATALOG)) {
        assert.ok(item.score >= Model.MIN_SCORE);
        assert.ok(item.matches.length >= 1 && item.matches.length <= 4);
    }
});

// ---------------------------------------------------------------------------
// Estilos del artista
// ---------------------------------------------------------------------------
test('estilos del artista: etiquetas viejas, del registro nuevo, en mayúsculas o como JSON', () => {
    const match = (styles, catalog = CATALOG) => names(Model.matchArtistStyles(styles, catalog));
    assert.deepEqual(match(['NEOTRADICIONAL', 'FINELINE', 'REALIMSMO']), ['Realismo', 'Neo-Tradicional', 'Fine Line']);
    assert.deepEqual(match(['Tradicional Americano (Old School)']), ['Tradicional']);
    assert.deepEqual(match(['Tradicional Japonés (Irezumi)']), ['Japonés'], 'no marca "Tradicional"');
    assert.deepEqual(match(['Black and Grey', 'Acuarela (Watercolor)', 'Surrealismo']), ['Acuarela', 'Surrealista', 'Black & Grey']);
    assert.deepEqual(match('["Japones","Geometrico"]'), ['Japonés', 'Geométrico']);
    assert.deepEqual(match('Dotwork, Blackwork'), ['Blackwork', 'Dotwork']);
    assert.deepEqual(match(['Realismo a Color']), ['Realismo'], 'especialidad → estilo raíz');
    assert.deepEqual(match(['Neo Tradicional']), ['Neo-Tradicional'], 'no marca "Tradicional"');
    assert.deepEqual(match(['Blackwork']), ['Blackwork'], 'no marca "Ornamental Blackwork"');
    assert.deepEqual(match([]), []);
    assert.deepEqual(match(null), []);
    assert.deepEqual(match(['Estilo que no existe']), []);
});

test('estilos del artista: los subestilos del catálogo cuentan para su estilo raíz', () => {
    const tree = [
        { id: 'r', name: 'Realismo', slug: 'realismo', substyles: [{ id: 'r1', name: 'Retrato', slug: 'realismo-retrato' }, { id: 'r2', name: 'Micro-realismo', slug: 'micro-realismo' }] },
        { id: 'b', name: 'Blackwork', slug: 'blackwork', substyles: [{ id: 'b1', name: 'Mandala', slug: 'blackwork-mandala' }] },
        { id: 'j', name: 'Japonés', slug: 'japones', substyles: [{ id: 'j1', name: 'Irezumi', slug: 'irezumi' }] },
        { id: 'm', name: 'Mandala', slug: 'mandala', substyles: [] },
        { id: 'mr', name: 'Microrealismo', slug: 'microrealismo', substyles: [] }
    ];
    const match = (styles) => names(Model.matchArtistStyles(styles, tree));
    assert.deepEqual(match(['Retratos']), ['Realismo']);
    assert.deepEqual(match(['Irezumi']), ['Japonés']);
    // "Mandala" y "Microrealismo" existen como raíz: no arrastran a su estilo padre.
    assert.deepEqual(match(['Mandalas']), ['Mandala']);
    assert.deepEqual(match(['Micro realismo']), ['Microrealismo']);
});

// ---------------------------------------------------------------------------
// Orden de la cuadrícula
// ---------------------------------------------------------------------------
test('con artista: sus estilos primero con la insignia "artist"; el resto en orden de catálogo', () => {
    const view = Model.arrangeStyles(CATALOG, { artistStyles: ['Blackwork', 'Japones', 'Fine Line'], idea: 'un dragón japonés' });
    assert.equal(view.mode, 'artist');
    assert.equal(view.artistCount, 3);
    assert.deepEqual(view.items.slice(0, 3).map((item) => item.style.name), ['Japonés', 'Fine Line', 'Blackwork'],
        'entre los del artista va primero el que coincide con la idea');
    assert.ok(view.items.slice(0, 3).every((item) => item.badge === 'artist'));
    assert.ok(view.items.slice(3).every((item) => item.badge === null), 'sin "Recomendado" cuando hay artista');
    assert.equal(view.items.length, CATALOG.length);
    assert.equal(new Set(view.items.map((item) => item.style.id)).size, CATALOG.length);
    assert.deepEqual(view.items.slice(3).map((item) => item.style.id),
        CATALOG.filter((style) => !['japones', 'fine_line', 'blackwork'].includes(style.id)).map((style) => style.id));
});

test('sin artista: recomendados primero; sin idea reconocible queda el catálogo tal cual', () => {
    const view = Model.arrangeStyles(CATALOG, { artistStyles: null, idea: 'retrato realista de mi perro' });
    assert.equal(view.mode, 'recommended');
    assert.equal(view.items[0].style.name, 'Realismo');
    assert.ok(view.recommendedCount >= 2 && view.recommendedCount <= Model.DEFAULT_LIMIT);
    assert.ok(view.items.slice(0, view.recommendedCount).every((item) => item.badge === 'recommended' && item.matches.length));
    assert.ok(view.items.slice(view.recommendedCount).every((item) => item.badge === null));
    assert.equal(view.items.length, CATALOG.length);

    const plain = Model.arrangeStyles(CATALOG, { idea: 'algo bonito' });
    assert.equal(plain.mode, 'plain');
    assert.deepEqual(plain.items.map((item) => item.style.id), CATALOG.map((style) => style.id));
    // Artista sin estilos reconocibles: se comporta como "sin artista".
    assert.equal(Model.arrangeStyles(CATALOG, { artistStyles: ['???'], idea: 'un dragón' }).mode, 'recommended');
    assert.deepEqual(Model.arrangeStyles(null, {}).items, []);
});

// ---------------------------------------------------------------------------
// Endpoint POST /api/quotations/style-suggestions
// ---------------------------------------------------------------------------
function fakeRes() {
    return {
        statusCode: 200, body: null, headers: {},
        set(k, v) { this.headers[k] = v; return this; },
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; }
    };
}

test('endpoint: 400 sin idea ni estilos; respuesta acotada y sin PII', async () => {
    const handler = routes.createStyleSuggestionsHandler({ loadCatalog: async () => CATALOG });
    const empty = fakeRes();
    await handler({ body: {} }, empty);
    assert.equal(empty.statusCode, 400);
    assert.equal(empty.body.success, false);
    assert.match(empty.body.error, /Cuéntanos tu idea/);

    const res = fakeRes();
    await handler({ body: { idea: 'Soy Ana (ana@example.test, +54 11 5555-0000) y quiero un dragón japonés', client_email: 'ana@example.test', limit: 3 } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.body.mode, 'recommended');
    assert.equal(res.body.suggestions[0].slug, 'japones');
    assert.ok(res.body.suggestions.length <= 3);
    assert.deepEqual(Object.keys(res.body).sort(), ['artist_styles', 'mode', 'success', 'suggestions']);
    assert.deepEqual(Object.keys(res.body.suggestions[0]).sort(), ['matches', 'name', 'score', 'slug']);
    // No devuelve la idea ni datos de contacto.
    assert.doesNotMatch(JSON.stringify(res.body), /ana@example|5555|Soy Ana/);

    const artist = fakeRes();
    await handler({ body: { artist_styles: ['NEOTRADICIONAL', 'Blackwork'] } }, artist);
    assert.equal(artist.body.mode, 'artist');
    assert.deepEqual(artist.body.artist_styles.map((s) => s.slug), ['neo-tradicional', 'blackwork']);
    assert.deepEqual(artist.body.suggestions, []);
});

test('endpoint: entradas hostiles se acotan y un error interno no filtra detalles', async () => {
    const input = suggest.normalizeInput({ idea: 'x'.repeat(9000), artist_styles: Array.from({ length: 200 }, (_, i) => 'Estilo ' + i + 'y'.repeat(300)), limit: 999 });
    assert.equal(input.idea.length, Model.MAX_IDEA_LENGTH);
    assert.equal(input.artistStyles.length, suggest.MAX_ARTIST_STYLES);
    assert.ok(input.artistStyles.every((label) => label.length <= 80));
    assert.equal(input.limit, Model.MAX_LIMIT);
    assert.deepEqual(suggest.normalizeInput(null), { idea: '', artistStyles: [], limit: Model.DEFAULT_LIMIT });
    assert.deepEqual(suggest.normalizeInput({ idea: 42, artist_styles: { a: 1 } }).artistStyles, []);

    const original = console.error;
    console.error = () => {};
    try {
        const boom = routes.createStyleSuggestionsHandler({ loadCatalog: async () => { throw new Error('clave secreta en el mensaje'); } });
        const res = fakeRes();
        await boom({ body: { idea: 'un dragón' } }, res);
        assert.equal(res.statusCode, 500);
        assert.doesNotMatch(JSON.stringify(res.body), /secreta/);
        assert.match(res.body.error, /Elige el que más te guste/);
    } finally {
        console.error = original;
    }
});

test('endpoint: catálogo vivo con caché; si la base falla usa el catálogo estático', async () => {
    let calls = 0;
    let clock = 1000;
    const live = [{ id: 'uuid-1', name: 'Japonés', slug: 'japones', substyles: [] }];
    const source = routes.createCatalogSource({ loadStyleCatalog: async () => { calls += 1; return live; }, now: () => clock });
    assert.equal(await source(), live);
    assert.equal(await source(), live);
    assert.equal(calls, 1, 'segunda lectura desde la caché');
    clock += 6 * 60 * 1000;
    await source();
    assert.equal(calls, 2, 'la caché vence a los 5 minutos');

    const original = console.error;
    console.error = () => {};
    try {
        const broken = routes.createCatalogSource({ loadStyleCatalog: async () => { throw new Error('sin base'); } });
        assert.equal(await broken(), Model.STATIC_CATALOG);
        const emptyDb = routes.createCatalogSource({ loadStyleCatalog: async () => [] });
        assert.equal(await emptyDb(), Model.STATIC_CATALOG);
    } finally {
        console.error = original;
    }
});

test('endpoint: se registra por POST con límite propio y server.js lo monta antes del estático', () => {
    const calls = [];
    const app = { post: (...args) => calls.push(args) };
    const limiterStub = (options) => Object.assign((req, res, next) => next(), { options });
    routes.register(app, { rateLimit: { rateLimit: limiterStub } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/api/quotations/style-suggestions');
    assert.equal(calls[0].length, 3, 'ruta + limiter + handler');
    assert.equal(calls[0][1].options.max, 300);
    assert.match(calls[0][1].options.message.error, /Espera un minuto/);
    assert.equal(typeof calls[0][2], 'function');

    const server = read('server.js');
    const line = "require('./lib/routes/cot-pasos').register(app);";
    assert.equal(server.split(line).length - 1, 1, 'una sola línea de registro');
    assert.ok(server.indexOf(line) < server.indexOf('legacyRedirectFor(req.path'));
    assert.ok(server.indexOf(line) < server.indexOf("app.use(express.static(path.join(__dirname, 'public')));"));
    // La idea va en el cuerpo: no hay variante GET con la idea en la URL.
    assert.doesNotMatch(read('lib', 'routes', 'cot-pasos.js'), /app\.get\(/);
});

test('repo tattoo_styles: árbol con subestilos, lectura pública por la capa PostgREST', async () => {
    const tree = buildTree([
        { id: 'b', name: 'Blackwork', slug: 'blackwork', parent_id: null, sort_order: 5 },
        { id: 'a', name: 'Realismo', slug: 'realismo', parent_id: null, sort_order: 1 },
        { id: 'a2', name: 'Animales', slug: 'realismo-animales', parent_id: 'a', sort_order: 2 },
        { id: 'a1', name: 'Retrato', slug: 'realismo-retrato', parent_id: 'a', sort_order: 1 },
        { id: 'x', name: 'Huérfano', slug: 'x', parent_id: 'no-existe', sort_order: 1 },
        null
    ]);
    assert.deepEqual(tree.map((s) => s.name), ['Realismo', 'Blackwork']);
    assert.deepEqual(tree[0].substyles.map((s) => s.name), ['Retrato', 'Animales']);
    assert.deepEqual(buildTree(null), []);

    const seen = {};
    const query = (table, options) => {
        seen.table = table; seen.options = options;
        const q = { select(cols) { seen.cols = cols; return q; }, order() { return q; }, limit() { return q; }, async execute() { return [{ id: 'a', name: 'Realismo', slug: 'realismo', parent_id: null, sort_order: 1 }]; } };
        return q;
    };
    const rows = await TattooStylesRepo.listTree({ query });
    assert.equal(seen.table, 'tattoo_styles');
    assert.deepEqual(seen.options, { key: 'anon' });
    assert.equal(seen.cols, 'id,name,slug,parent_id,sort_order');
    assert.equal(rows[0].name, 'Realismo');
});

// ---------------------------------------------------------------------------
// Front: cuadrícula con insignias
// ---------------------------------------------------------------------------
function browser() {
    const sandbox = { console };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.document = { activeElement: null, createElement: () => ({ setAttribute() {}, className: '' }) };
    const context = vm.createContext(sandbox);
    vm.runInContext(read('public', 'shared', 'js', 'quotation-style-model.js'), context);
    vm.runInContext(read('public', 'shared', 'js', 'quotation-style-step.js'), context);
    return context;
}

test('front: tarjetas con insignia "Artista" / "Recomendado", check y datos escapados', () => {
    const ctx = browser();
    const step = ctx.WoQuotationStyle;
    const artist = step.cardHtml({ style: { id: 'id-1', name: 'Realismo', cover_image_url: 'https://cdn.example.test/r.jpg' }, badge: 'artist', matches: [] }, true);
    assert.match(artist, /<span class="qp-style-badge qp-style-badge--artist">Artista<\/span>/);
    assert.match(artist, /aria-pressed="true"/);
    assert.match(artist, /class="style-card selected"/);
    assert.match(artist, /class="style-check" aria-hidden="true"/);
    assert.match(artist, /aria-label="Realismo\. Estilo que trabaja el artista\."/);
    assert.match(artist, /data-style-id="id-1"/);
    assert.doesNotMatch(artist, /onclick=/, 'sin JS inline: el clic se delega');

    const rec = step.cardHtml({ style: { id: 'id-2', name: 'Japonés' }, badge: 'recommended', matches: ['dragón', 'cerezo'] }, false);
    assert.match(rec, /qp-style-badge--recommended">Recomendado</);
    assert.match(rec, /Recomendado según tu idea\. Por: dragón, cerezo\./);
    assert.match(rec, /aria-pressed="false"/);
    assert.match(rec, /<button type="button" class="style-card" data-style-id="id-2"/, 'sin elegir no lleva la clase selected');
    assert.match(read('public', 'shared', 'css', 'quotation-pasos.css'), /\.style-card:not\(\.selected\) \.style-check \{ display: none; \}/);
    // Sin portada en el catálogo: usa la foto propia del estilo; sin foto propia, el ícono.
    assert.match(rec, /<img src="\/shared\/assets\/ronda2\/registro\/estilos\/tradicional-japones\.webp" alt="" class="style-card-img" loading="lazy">/);
    assert.match(artist, /src="https:\/\/cdn\.example\.test\/r\.jpg"[^>]* data-fallback="\/shared\/assets\/ronda2\/registro\/estilos\/realismo\.webp"/, 'portada del catálogo con respaldo propio');
    const bare = step.cardHtml({ style: { id: 'id-9', name: 'Estilo sin foto' }, badge: null, matches: [] }, false);
    assert.match(bare, /style-card-placeholder/);
    assert.doesNotMatch(bare, /<img/);

    const hostile = step.cardHtml({ style: { id: '"><img src=x onerror=alert(1)>', name: '<b>Hack</b>', cover_image_url: 'javascript:alert(1)' }, badge: null, matches: [] }, false);
    assert.doesNotMatch(hostile, /<b>Hack<\/b>|<img src=x|javascript:/);
    assert.match(hostile, /&lt;b&gt;Hack&lt;\/b&gt;/);
    assert.doesNotMatch(hostile, /qp-style-badge/);
});

test('front: el aviso explica el orden, en español neutro', () => {
    const ctx = browser();
    const step = ctx.WoQuotationStyle;
    const styles = [{ id: '1', name: 'Realismo', slug: 'realismo' }, { id: '2', name: 'Japonés', slug: 'japones' }, { id: '3', name: 'Blackwork', slug: 'blackwork' }];
    const withArtist = step.arrange(styles, { artistStyles: ['Blackwork'], idea: 'un dragón japonés' });
    assert.equal(withArtist.items[0].style.name, 'Blackwork');
    assert.equal(step.hintText(withArtist, { artistName: 'Ana Tinta' }), 'Primero ves los estilos que trabaja Ana Tinta, marcados con «Artista».');
    const noArtist = step.arrange(styles, { artistStyles: null, idea: 'un dragón japonés realista' });
    assert.equal(noArtist.mode, 'recommended');
    assert.match(step.hintText(noArtist, {}), /^Según tu idea te recomendamos (Japonés y Realismo|Realismo y Japonés)\. Están primero, con la etiqueta «Recomendado»\.$/);
    assert.equal(step.hintText(step.arrange(styles, { idea: 'nada' }), {}), '');
});

test('script.js delega la cuadrícula y usa el mismo criterio para el aviso de estilos distintos', () => {
    const script = read('public', 'shared', 'js', 'script.js');
    const fn = script.slice(script.indexOf('function renderStylesGrid(styles)'), script.indexOf('function toggleStyleSelection(styleId)'));
    assert.match(fn, /window\.WoQuotationStyle\.render\(grid, styles, \{/);
    assert.match(fn, /const hasArtist = !!formData\.artist_id && !formData\.no_artist;/);
    assert.match(fn, /idea: formData\.tattoo_idea_description \|\| ''/);
    assert.match(fn, /onToggle: toggleStyleSelection/);
    const mismatch = script.slice(script.indexOf('function checkStyleMismatch()'), script.indexOf('window.toggleStyleSelection = toggleStyleSelection;'));
    assert.match(mismatch, /styleModel\.matchArtistStyles\(artistStyles, TATTOO_STYLES_DATA \|\| \[\]\)/);

    const html = read('public', 'quotation', 'index.html');
    const at = (needle) => html.indexOf(needle);
    assert.ok(at('/shared/js/quotation-style-model.js') > -1);
    assert.ok(at('/shared/js/quotation-style-model.js') < at('/shared/js/quotation-style-step.js'));
    assert.ok(at('/shared/js/quotation-style-step.js') < at('/shared/js/script.js'));
    assert.ok(at('/shared/css/quotation-ds.css') < at('/shared/css/quotation-pasos.css'));
});

test('portadas de respaldo: cada estilo del catálogo cae en una foto que existe', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const cases = {
        'Japonés': 'tradicional-japones', 'Black & Grey': 'black-and-grey', 'Fine Line': 'fine-line', 'Neo-Tradicional': 'neotradicional',
        'Tradicional': 'tradicional-americano', 'Surrealista': 'surrealismo', 'Mandala': 'dotwork', 'Neotribal (Neo Tribal)': 'tribal',
        'Sketch / Boceto': 'ilustrativo', 'Ignorant': 'ignorant-style', 'Acuarela': 'acuarela', 'Dark Art': 'dark-art', 'TRASH POLKA': 'trash-polka'
    };
    for (const [name, slug] of Object.entries(cases)) {
        const cover = Model.fallbackCover(name);
        assert.equal(cover, '/shared/assets/ronda2/registro/estilos/' + slug + '.webp', name);
        assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', cover)), 'existe ' + cover);
    }
    for (const name of ['Floral', 'Pixel Art', 'Art Deco', '', null, undefined]) assert.equal(Model.fallbackCover(name), '', String(name));
});
