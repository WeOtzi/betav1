// Revisión del registro (12 nov 2026) · grupo registro-fix (ronda 3).
// 1. Estilos: el paso 03 "Tu oficio" y la edición del perfil (Cuenta,
//    dashboard) salen del catálogo del registro, no de tattoo_styles. En beta
//    la tabla tiene nombres viejos ("Old School", "Irezumi", "Caligrafia",
//    "Biomecanico"…) que no se tienen que ver; se siguen usando como valor a
//    guardar cuando coinciden.
// 2. Animaciones de entrada sutiles en /register-artist, /registerclosedbeta e
//    /inicio, solo cuando el navegador acepta movimiento.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const core = require('../public/shared/js/acceso-register-final.js');
const catalog = require('../public/register-artist/catalogo-registro.js');
const lib = require('../lib/registration-catalogs.js');

const registerJs = read('public/shared/js/register.js');

// Tabla tattoo_styles como está en beta (proyecto vivo, 12/11/2026): nombres
// viejos, sin tildes, hijos con parent_id y estilos que no están en la revisión.
const BETA_TABLE = [
    ['Realismo', null, 1], ['Tradicional', null, 2], ['Neo-Tradicional', null, 3], ['Japonés', null, 4],
    ['Blackwork', null, 5], ['Fine Line', null, 6], ['Minimalista', null, 7], ['Anime', null, 8],
    ['Chicano', null, 10], ['Dotwork', null, 11], ['Acuarela', null, 12], ['Geométrico', null, 13],
    ['Trash Polka', null, 14], ['New School', null, 15], ['Surrealista', null, 16], ['FREEHAND', null, 17],
    ['CYBERSIGILISMO', null, 18], ['Black & Grey', null, 19], ['Microrealismo', null, 20],
    ['Hiperrealismo', null, 21], ['Ornamental', null, 22], ['Mandala', null, 23], ['Tribal', null, 24],
    ['Polinesio', null, 25], ['Maori', null, 26], ['Haida', null, 27], ['Celta', null, 28],
    ['Nordico / Viking', null, 29], ['Lettering', null, 30], ['Blackletter / Gotico', null, 31],
    ['Caligrafia', null, 32], ['Ignorant', null, 33], ['Handpoke / Stick and Poke', null, 34],
    ['Abstracto', null, 35], ['Biomecanico', null, 43], ['Bioorganico', null, 44], ['Dark Art', null, 46],
    ['Pop Art', null, 50], ['Art Deco', null, 52], ['Barroco', null, 53],
    ['Old School', 'p-trad', 1], ['American Traditional', 'p-trad', 2], ['Irezumi', 'p-jap', 1],
    ['Neo-Japanese', 'p-jap', 2], ['Micro-realismo', 'p-real', 3], ['Retrato', 'p-real', 1]
].map(([name, parent_id, sort_order], i) => ({ id: 's' + i, name, parent_id, sort_order, is_active: true }));

const OLD_NAMES = ['Old School', 'Irezumi', 'Caligrafia', 'Biomecanico', 'Tradicional', 'Neo-Tradicional',
    'Acuarela', 'Surrealista', 'FREEHAND', 'CYBERSIGILISMO', 'Black & Grey', 'Haida', 'Pop Art', 'Barroco'];

const MAIN_LABELS = catalog.STYLE_GROUPS[0].styles;

// Extrae `function name(...) { ... }` con llaves balanceadas.
function extractFunction(src, name) {
    const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
    const match = re.exec(src);
    assert.ok(match, `existe function ${name}`);
    let i = src.indexOf('{', match.index);
    let depth = 0;
    for (; i < src.length; i += 1) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') {
            depth -= 1;
            if (depth === 0) return src.slice(match.index, i + 1);
        }
    }
    throw new Error(`function ${name} sin cierre`);
}

// DOM mínimo para correr loadAndRenderStylesFromDB tal cual está en register.js.
function fakeDom() {
    const byId = new Map();
    function el(tag) {
        const node = {
            tagName: tag.toUpperCase(), children: [], dataset: {}, className: '', textContent: '', hidden: false, id: '',
            classList: { contains: (c) => node.className.split(/\s+/).includes(c) },
            appendChild(child) { node.children = node.children.filter((c) => c !== child); node.children.push(child); return child; },
            querySelectorAll(sel) {
                if (sel === '.style-option.is-extra') return node.children.filter((c) => /\bstyle-option\b/.test(c.className) && /\bis-extra\b/.test(c.className));
                return [];
            }
        };
        Object.defineProperty(node, 'innerHTML', { set() { node.children = []; }, get() { return ''; } });
        return node;
    }
    const grid = el('div'); grid.id = 'styles-grid';
    const more = el('button'); more.id = 'styles-more-btn';
    byId.set('styles-grid', grid);
    byId.set('styles-more-btn', more);
    return {
        grid,
        document: {
            getElementById: (id) => byId.get(id) || null,
            createElement: (tag) => el(tag)
        }
    };
}

function runRegisterGrid({ table, styles, withCore = true }) {
    const dom = fakeDom();
    const window = {
        ConfigManager: { loadTattooStylesFlatFromDB: async () => table },
        WoRegistroCatalogo: catalog
    };
    if (withCore) window.AccesoRegister = { core };
    const ctx = {
        window, document: dom.document, console,
        formState: { data: { styles: styles || [] } },
        _loadedDbStyles: []
    };
    vm.createContext(ctx);
    vm.runInContext([
        extractFunction(registerJs, 'normalizeStyleName'),
        extractFunction(registerJs, 'buildRegisterStyleGridItems'),
        extractFunction(registerJs, 'styleDisplayLabel'),
        extractFunction(registerJs, 'syncStylesMoreButton'),
        extractFunction(registerJs, 'loadAndRenderStylesFromDB'),
        'const STYLES_VISIBLE_COUNT = 10;',
        'this.__run = loadAndRenderStylesFromDB; this.__label = styleDisplayLabel; this.__db = () => _loadedDbStyles;'
    ].join('\n'), ctx);
    return { ctx, dom };
}

// ------------------------------------------------------------ 1 · estilos del paso 03

test('paso 03: con la tabla de beta (nombres viejos) la grilla muestra el catálogo, no la tabla', async () => {
    const { ctx, dom } = runRegisterGrid({ table: BETA_TABLE });
    await ctx.__run();
    const chips = dom.grid.children.filter((c) => /\bstyle-option\b/.test(c.className));
    const visible = chips.filter((c) => !/\bis-extra\b/.test(c.className)).map((c) => c.textContent);
    // Mismos 10 visibles que el grupo "Estilos principales" del catálogo.
    assert.deepEqual(visible, MAIN_LABELS.slice(0, 10));
    // Todo "Estilos principales" está en la grilla (el resto como extra) y nada más de la tabla.
    assert.deepEqual(chips.filter((c) => c.dataset.style !== 'Otro').map((c) => c.textContent), MAIN_LABELS);
    OLD_NAMES.forEach((old) => assert.ok(!chips.some((c) => c.textContent === old), `no se ve «${old}»`));
    // "Ver más estilos" queda después de los chips y antes de "Otro" como hoy.
    const ids = dom.grid.children.map((c) => c.id || c.dataset.style);
    assert.equal(ids[ids.length - 2], 'style-other-btn');
    assert.equal(ids[ids.length - 1], 'styles-more-btn');
    assert.equal(dom.document.getElementById('styles-more-btn').hidden, false);
});

test('paso 03: al guardar se usa el nombre de la tabla cuando coincide (como el panel)', async () => {
    const { ctx, dom } = runRegisterGrid({ table: BETA_TABLE });
    await ctx.__run();
    const byLabel = new Map(dom.grid.children.map((c) => [c.textContent, c.dataset.style]));
    assert.equal(byLabel.get('Tradicional Americano (Old School)'), 'Old School');
    assert.equal(byLabel.get('Tradicional Japonés (Irezumi)'), 'Irezumi');
    assert.equal(byLabel.get('Caligrafía'), 'Caligrafia');
    assert.equal(byLabel.get('Biomecánico'), 'Biomecanico');
    // Sin coincidencia en la tabla se guarda la etiqueta del catálogo.
    assert.equal(byLabel.get('Neojaponés'), 'Neojaponés');
    // Mismo valor que arma el panel "Todos los estilos".
    const panel = core.buildStyleGroups(BETA_TABLE, null)[0].chips;
    panel.forEach((chip) => assert.equal(byLabel.get(chip.label), chip.value, chip.label));
});

test('paso 03: los elegidos van primero y se ven con la etiqueta del catálogo', async () => {
    const { ctx, dom } = runRegisterGrid({ table: BETA_TABLE, styles: ['Old School', 'Caligrafia', 'Mi estilo'] });
    await ctx.__run();
    const chips = dom.grid.children.filter((c) => /\bstyle-option\b/.test(c.className));
    assert.deepEqual(chips.slice(0, 3).map((c) => [c.textContent, c.dataset.style]), [
        ['Tradicional Americano (Old School)', 'Old School'],
        ['Caligrafía', 'Caligrafia'],
        ['Mi estilo', 'Mi estilo']
    ]);
    // Sin duplicados: el chip del catálogo no se repite más abajo.
    assert.equal(chips.filter((c) => c.dataset.style === 'Old School').length, 1);
    assert.equal(chips.filter((c) => !/\bis-extra\b/.test(c.className)).length, 10);
});

test('paso 03: el render del módulo Figma (renderStyleChips) también muestra etiquetas para los elegidos', () => {
    const groups = core.buildStyleGroups(BETA_TABLE, null);
    const canonical = core.canonicalizeStyles(['Japonés', 'Tradicional americano', 'Lettering / Caligrafía'], groups);
    assert.deepEqual(canonical, ['Irezumi', 'Old School', 'Lettering']);
    const chips = core.stepStyleChips(canonical, groups, 10);
    assert.deepEqual(chips.slice(0, 3).map((c) => c.label), ['Tradicional Japonés (Irezumi)', 'Tradicional Americano (Old School)', 'Lettering']);
    assert.deepEqual(chips.slice(0, 3).map((c) => c.name), canonical);
    OLD_NAMES.forEach((old) => assert.ok(!chips.some((c) => c.label === old), `no se ve «${old}»`));
});

test('paso 03: sin acceso-register-final.js la grilla sale igual del catálogo local', async () => {
    const { ctx, dom } = runRegisterGrid({ table: BETA_TABLE, styles: ['Irezumi'], withCore: false });
    await ctx.__run();
    const chips = dom.grid.children.filter((c) => /\bstyle-option\b/.test(c.className) && c.dataset.style !== 'Otro');
    assert.equal(chips[0].textContent, 'Tradicional Japonés (Irezumi)');
    assert.equal(chips[0].dataset.style, 'Irezumi');
    assert.ok(!chips.some((c) => OLD_NAMES.includes(c.textContent)));
    assert.equal(chips.filter((c) => !/\bis-extra\b/.test(c.className)).length, 10);
});

test('resumen y fila del grupo 03 muestran las etiquetas del catálogo', async () => {
    const { ctx } = runRegisterGrid({ table: BETA_TABLE });
    await ctx.__run();
    assert.equal(ctx.__label('Old School'), 'Tradicional Americano (Old School)');
    assert.equal(ctx.__label('Biomecanico'), 'Biomecánico');
    assert.equal(ctx.__label('Mi estilo'), 'Mi estilo');
    assert.match(registerJs, /const parts = \(data\.styles \|\| \[\]\)\.map\(styleDisplayLabel\);/);
    assert.match(registerJs, /d\.styles\.map\(styleDisplayLabel\)\.join\(' · '\)/);
});

// ------------------------------------------------------------ 1 · editar perfil (Cuenta, dashboard)

test('catálogo local: los alias históricos resuelven igual que el servidor', () => {
    for (const [label, aliases] of Object.entries(lib.LEGACY_STYLE_ALIASES)) {
        aliases.forEach((alias) => assert.equal(catalog.styleLabelFor(alias), label, alias));
    }
    lib.QUICK_STYLES.forEach((quick) => assert.equal(catalog.styleLabelFor(quick.label), quick.catalog[0], quick.label));
});

test('perfil: opciones del catálogo, guardados intactos y propios elegidos', () => {
    const saved = ['Old School', 'Japonés', 'Mi estilo', 'Handpoke / Stick and Poke'];
    const opts = catalog.buildStyleOptions(BETA_TABLE, saved);
    // Los guardados primero, con su valor tal cual (no se reescriben al guardar).
    assert.deepEqual(opts.slice(0, 4).map((o) => [o.value, o.label, o.selected, o.custom]), [
        ['Old School', 'Tradicional Americano (Old School)', true, false],
        ['Japonés', 'Tradicional Japonés (Irezumi)', true, false],
        ['Mi estilo', 'Mi estilo', true, true],
        ['Handpoke / Stick and Poke', 'Handpoke / Stick and Poke', true, true]
    ]);
    // El resto es exactamente el catálogo (109 estilos), sin nombres solo de la tabla.
    const rest = opts.slice(4);
    assert.equal(rest.length, 109 - 2);
    assert.ok(rest.every((o) => !o.selected && !o.custom));
    ['Haida', 'Pop Art', 'Barroco'].forEach((name) => assert.ok(!opts.some((o) => o.label === name), name));
    OLD_NAMES.forEach((old) => assert.ok(!rest.some((o) => o.label === old), `no se ve «${old}»`));
    // No elegidos: valor = nombre de tattoo_styles si coincide, si no la etiqueta.
    const value = (label) => rest.find((o) => o.label === label).value;
    assert.equal(value('Caligrafía'), 'Caligrafia');
    assert.equal(value('Biomecánico'), 'Biomecanico');
    assert.equal(value('Neojaponés'), 'Neojaponés');
    assert.equal(new Set(opts.map((o) => o.value)).size, opts.length);
});

test('Cuenta y dashboard arman la lista de estilos desde el catálogo, no desde tattoo_styles', () => {
    const account = read('public/shared/js/artist-account.js');
    const dashboard = read('public/shared/js/dashboard.js');
    const fill = extractFunction(account, 'fillProfile');
    assert.match(fill, /loadProfileStyleOptions\(styles\)/);
    assert.doesNotMatch(fill, /setOptions\(names\)/);
    const load = extractFunction(account, 'loadProfileStyleOptions');
    assert.match(load, /catalog\.buildStyleOptions\(/);
    assert.match(extractFunction(account, 'loadRegistroCatalogo'), /\/register-artist\/catalogo-registro\.js/);
    // El multiselect muestra la etiqueta y guarda el valor.
    const multi = account.slice(account.indexOf('function createMulti('), account.indexOf('function profilePrefs('));
    assert.match(multi, /value="\$\{esc\(opt\.value\)\}"/);
    assert.match(multi, /<span>\$\{esc\(opt\.label\)\}<\/span>/);

    const grid = extractFunction(dashboard, 'loadDashboardStylesGrid');
    assert.match(grid, /catalog\.buildStyleOptions\(_dashboardLoadedStyles, _tempSelectedStyles\)/);
    assert.match(grid, /btn\.textContent = opt\.label/);
    assert.match(grid, /btn\.dataset\.style = opt\.value/);
    const trigger = extractFunction(dashboard, 'updateStylesTriggerUI');
    assert.match(trigger, /escapeDashboardStyle\(dashboardStyleLabel\(s\)\)/);
});

test('Crear cuenta: los 10 estilos rápidos coinciden con styles.quick del catálogo', () => {
    const main = read('public/shared/js/main.js');
    const match = main.match(/const BETA_STYLE_OPTIONS = \[([\s\S]*?)\];/);
    assert.ok(match, 'BETA_STYLE_OPTIONS');
    const quick = JSON.parse('[' + match[1].replace(/'/g, '"') + ']');
    assert.deepEqual(quick, lib.getRegistrationCatalogs().styles.quick.map((q) => q.label));
});

// ------------------------------------------------------------ 2 · animaciones de entrada

const PAGES = [
    { html: 'public/register-artist/index.html', css: 'public/shared/css/register-artist-ds.css', kf: 'ra-rise-in' },
    { html: 'public/registerclosedbeta/index.html', css: 'public/shared/css/registerclosedbeta-ds.css', kf: 'wo-beta-rise-in' },
    { html: 'public/inicio/index.html', css: 'public/inicio/inicio.css', kf: 'inicio-rise-in' }
];

test('entradas al cargar: la clase solo la pone JS y solo sin prefers-reduced-motion', () => {
    PAGES.forEach(({ html }) => {
        const src = read(html);
        const head = src.slice(0, src.indexOf('</head>'));
        assert.match(head, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\)document\.documentElement\.classList\.add\('wo-motion-in'\)/, html);
        assert.doesNotMatch(src, /<html[^>]*wo-motion-in/, `${html}: la clase no viene en el HTML`);
    });
});

test('entradas al cargar: transform/opacity sutiles, 200–450 ms, sin ocultar el estado final', () => {
    PAGES.forEach(({ css, kf }) => {
        const src = read(css);
        const frames = src.match(new RegExp(`@keyframes ${kf}\\s*\\{([\\s\\S]*?\\})\\s*\\}`));
        assert.ok(frames, `${css}: @keyframes ${kf}`);
        assert.match(frames[1], /from\s*\{\s*opacity:0;\s*translate:0 1[24]px;?\s*\}/);
        assert.match(frames[1], /to\s*\{\s*opacity:1;\s*translate:none;?\s*\}/);
        const uses = [...src.matchAll(new RegExp(`animation:\\s*${kf} (\\d+)ms var\\(--ease-standard\\) backwards`, 'g'))];
        assert.ok(uses.length, `${css}: usa ${kf} con relleno backwards`);
        uses.forEach((m) => assert.ok(+m[1] >= 200 && +m[1] <= 450, `${css}: ${m[1]}ms`));
        // Todas las reglas animadas dependen de .wo-motion-in.
        [...src.matchAll(new RegExp(`([^{}]+)\\{[^}]*animation:\\s*${kf}`, 'g'))].forEach((m) => {
            m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((sel) => assert.match(sel, /^\.wo-motion-in /, sel));
        });
        // Con reduce: sin animación.
        const reduce = src.slice(src.lastIndexOf('prefers-reduced-motion'));
        assert.match(reduce, /\.wo-motion-in [^{]*\{\s*animation:none;?\s*\}/, `${css}: reduced-motion`);
    });
});

test('registro: transiciones al cambiar de grupo (panel escalonado + fila resumen)', () => {
    const render = extractFunction(registerJs, 'renderGroups');
    assert.match(render, /if \(isActive && wasHidden\) playPanelEntrance\(panel\);/);
    assert.match(render, /if \(isDone && rowWasHidden && !groupsFirstRender\) playEntrance\(row, 'wo-enter'\);/);
    const css = read('public/shared/css/register-artist-ds.css');
    assert.match(css, /\.register-page \.ra-panel\.wo-enter-stagger\{--wo-enter-distance:14px;--wo-enter-duration:380ms;--wo-enter-step:55ms\}/);
    assert.match(css, /\.register-page \.ra-panel\.wo-enter-stagger > \*,\s*\.register-page \.ra-row\.wo-enter\{animation-fill-mode:backwards\}/);
});

test('inicio: la tarjeta elegida pasa al centro y las otras se achican (FLIP), sin movimiento con reduce', () => {
    const js = read('public/inicio/inicio.js');
    const ctx = { globalThis: {} };
    ctx.window = undefined;
    vm.createContext(ctx);
    vm.runInContext(js.replace("typeof window !== 'undefined' ? window : globalThis", 'globalThis'), ctx);
    const api = ctx.globalThis.WoInicio || ctx.WoInicio;
    assert.deepEqual(JSON.parse(JSON.stringify(api.layoutFor('artist'))), ['client', 'artist', 'studio']);
    assert.deepEqual(JSON.parse(JSON.stringify(api.layoutFor('client'))), ['artist', 'client', 'studio']);
    const css = read('public/inicio/inicio.css');
    assert.match(css, /\.inicio-cards\.has-selection \.inicio-card:not\(:has\(\.inicio-radio:checked\)\) \{ scale:\.86; opacity:\.82; \}/);
    assert.match(js, /if \(!animate \|\| reduceMotion\.matches/);
    assert.match(css, /@media \(prefers-reduced-motion:reduce\) \{\s*\.inicio-card \{ transition:none; \}/);
});
