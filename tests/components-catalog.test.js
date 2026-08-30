const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const fromRoot = (...parts) => path.join(root, ...parts);
const read = (file) => fs.readFileSync(fromRoot(file), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

const ATOMIC_NODES = Object.freeze({
  'weotzi-typography': '1:31',
  'weotzi-logos': '3:198',
  'weotzi-colors': '3:25',
  'weotzi-buttons': '4:6',
  'weotzi-icons': '4:185',
  'weotzi-checkboxes': '6:525',
  'weotzi-avatars': '6:591',
  'weotzi-system-status': '6:657',
  'weotzi-input-fields': '6:1800',
  'weotzi-toggle-switches': '6:1889',
  'weotzi-loaders': '6:1949',
  'weotzi-mood-board': '6:2035',
  'weotzi-cards': '6:2102',
  'weotzi-dropdowns': '8:151',
  'weotzi-miscellany': '8:193',
  'weotzi-tables': '8:487',
  'weotzi-navigation': '8:816',
  'weotzi-tags': '11:32',
  'weotzi-charts': '11:256',
  'weotzi-empty-error': '11:382',
  'weotzi-form-fields': '11:428'
});

const MOLECULE_REFERENCES = Object.freeze([
  ['21:7026', 'ingresos-lateral'],
  ['21:7025', 'acciones-rapidas'],
  ['21:7024', 'recordatorios'],
  ['21:7027', 'ingresos-estadisticas'],
  ['21:7028', 'barra-progreso'],
  ['21:7032', 'proximos-turnos'],
  ['21:7033', 'agenda-lateral-1'],
  ['21:7034', 'disenos-en-proceso'],
  ['21:7035', 'agenda-lateral-2'],
  ['21:7036', 'titulares-subtitulos'],
  ['21:7038', 'carrusel'],
  ['21:7037', 'encabezado-resultados'],
  ['21:7039', 'filtros-laterales'],
  ['21:7040', 'filtros-comprimidos'],
  ['21:7031', 'informacion-perfil'],
  ['21:7030', 'perfil'],
  ['21:7449', 'mosaico-seccion'],
  ['21:7450', 'barra-herramientas-resultados'],
  ['21:7350', 'galeria-trabajos-2'],
  ['21:7245', 'galeria-trabajos'],
  ['21:7454', 'tabla-contenido'],
  ['21:7453', 'tabla-porcentual-2'],
  ['21:7452', 'tabla-porcentaje'],
  ['21:7247', 'actividad-reciente'],
  ['21:7248', 'cotizaciones-preview'],
  ['21:7086', 'form-cotizacion'],
  ['21:7162', 'form-inicio'],
  ['21:7244', 'form-crear-cuenta']
]);

const ORGANISM_REFERENCES = Object.freeze([
  ['weotzi-dashboard', '34:533', ''],
  ['weotzi-product-nav', '80:13241', ''],
  ['weotzi-dashboard-sidebar', '34:134', ''],
  ['weotzi-income-stats', '34:135', ''],
  ['weotzi-upcoming-appointments', '34:137', ''],
  ['weotzi-agenda-designs', '34:139', ''],
  ['weotzi-agenda-board', '34:138', ''],
  ['weotzi-profile-panel', '34:136', ''],
  ['weotzi-quotes-activity', '34:523', ''],
  ['weotzi-job-board', '34:525', ''],
  ['weotzi-job-filters', '34:526', 'expanded'],
  ['weotzi-job-filters', '34:527', 'compact'],
  ['weotzi-spots', '34:524', ''],
  ['weotzi-quote-form', '34:528', ''],
  ['weotzi-auth-form', '34:529', ''],
  ['weotzi-portfolio-gallery', '34:522', 'full'],
  ['weotzi-portfolio-gallery', '34:521', 'compact'],
  ['weotzi-statistics-dashboard', '34:532', '']
]);

function createDocument(overrides = {}) {
  return {
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    ...overrides
  };
}

function loadRuntime(document = createDocument()) {
  class HTMLElement {}
  const registry = new Map();
  const sandbox = {
    console,
    URLSearchParams,
    HTMLElement,
    HTMLInputElement: class HTMLInputElement {},
    HTMLTextAreaElement: class HTMLTextAreaElement {},
    document,
    customElements: {
      define(name, constructor) { registry.set(name, constructor); },
      get(name) { return registry.get(name); },
      whenDefined() { return Promise.resolve(); }
    }
  };
  sandbox.window = sandbox;

  for (const file of [
    'public/shared/js/ds/site-components.js',
    'public/shared/js/ds/organisms.js',
    'public/shared/js/ds/molecules.js',
    'public/componentes/componentes.js',
    'public/componentes/compuestos/compuestos.js'
  ]) {
    vm.runInNewContext(read(file), sandbox, { filename: file });
  }

  return { sandbox, registry };
}

function assertDependenciesInOrder(html, dependencies) {
  let previous = -1;
  for (const dependency of dependencies) {
    const current = html.indexOf(dependency);
    assert.notEqual(current, -1, `missing dependency ${dependency}`);
    assert.ok(current > previous, `${dependency} must load after the preceding DS dependency`);
    previous = current;
  }
}

const runtime = loadRuntime();

test('catalog publishes the literal 21 UI Kit and 28 molecule references', () => {
  const references = plain(runtime.sandbox.WeotziDocs.COMPONENT_REFERENCES);
  const atomic = references.filter((item) => item.category !== 'Moléculas');
  const molecules = references.filter((item) => item.category === 'Moléculas');

  assert.equal(references.length, 49);
  assert.equal(atomic.length, 21);
  assert.equal(molecules.length, 28);
  assert.deepEqual(
    Object.fromEntries(atomic.map((item) => [item.tag, item.nodeId])),
    ATOMIC_NODES
  );
  assert.deepEqual(
    molecules.map((item) => [item.nodeId, item.variant]),
    MOLECULE_REFERENCES
  );
  assert.ok(molecules.every((item) => item.tag === 'weotzi-molecule'));
  assert.equal(new Set(references.map((item) => item.id)).size, 49);
  assert.equal(new Set(references.map((item) => item.nodeId)).size, 49);
  assert.equal(new Set(molecules.map((item) => item.variant)).size, 28);

  const moleculeMetadata = plain(runtime.sandbox.WeotziMolecules.metadata);
  for (const item of molecules) {
    assert.deepEqual(
      { nodeId: item.nodeId, width: item.width, height: item.height },
      { nodeId: moleculeMetadata[item.variant].nodeId, width: moleculeMetadata[item.variant].width, height: moleculeMetadata[item.variant].height },
      `${item.variant} must publish its exact Figma metadata`
    );
  }
});

test('shared libraries register every atomic, molecule and organism custom element', () => {
  const atomicMeta = plain(runtime.sandbox.WeotziAtomicComponents.meta);
  const moleculeNodes = plain(runtime.sandbox.WeotziMolecules.nodeIds);
  assert.deepEqual(
    Object.fromEntries(Object.entries(atomicMeta).map(([tag, meta]) => [tag, meta.node])),
    ATOMIC_NODES
  );

  for (const tag of Object.keys(ATOMIC_NODES)) {
    assert.ok(runtime.registry.has(tag), `${tag} is not registered`);
  }
  assert.ok(runtime.registry.has('weotzi-molecule'), 'weotzi-molecule is not registered');
  for (const variant of runtime.sandbox.WeotziMolecules.variants) {
    const output = runtime.sandbox.WeotziMolecules.render(variant);
    assert.ok(output.trim(), `${variant} has an empty renderer`);
    assert.doesNotMatch(output, /undefined/, `${variant} renders undefined fixture data`);
  }
  assert.deepEqual(
    moleculeNodes,
    Object.fromEntries(MOLECULE_REFERENCES.map(([nodeId, variant]) => [variant, nodeId]))
  );

  for (const tag of new Set(ORGANISM_REFERENCES.map(([name]) => name))) {
    assert.ok(runtime.registry.has(tag), `${tag} is not registered`);
  }
});

test('catalog routes render Vista/Código and Desktop/Tablet/Móvil controls', () => {
  const html = read('public/componentes/index.html');
  const compounds = read('public/componentes/compuestos/index.html');
  const preview = read('public/componentes/preview/index.html');
  const source = read('public/componentes/componentes.js');

  assert.match(html, /href="\/componentes\/compuestos"/);
  assert.match(compounds, /href="\/componentes"/);
  assert.match(preview, /id="preview-root"/);
  assert.match(source, /return `\/componentes\/preview\/\?\$\{params\.toString\(\)\}`/);
  assert.match(source, /data-tab="preview">Vista<\/button>/);
  assert.match(source, /data-tab="code"[^>]*>Código<\/button>/);
  assert.match(source, /data-viewport="desktop"[^>]*>[\s\S]*Desktop 1440/);
  assert.match(source, /data-viewport="tablet"[^>]*>[\s\S]*Tablet 768/);
  assert.match(source, /data-viewport="mobile"[^>]*>[\s\S]*Móvil 390/);
  assert.deepEqual(plain(runtime.sandbox.WeotziDocs.VIEWPORTS), { desktop: 1440, tablet: 768, mobile: 390 });
});

test('catalog search matches unaccented queries against accented component metadata', () => {
  const listeners = {};
  const search = {
    value: '',
    dataset: {},
    addEventListener(type, listener) { listeners[type] = listener; },
    focus() {}
  };
  const status = { textContent: '' };
  const count = { textContent: '' };
  const empty = { hidden: true };
  const article = { id: 'miscelaneas', dataset: {}, hidden: false };
  const group = { hidden: false, querySelector: () => (article.hidden ? null : article) };
  const renderRoot = {
    innerHTML: '',
    querySelector(selector) { return selector === '[data-empty-search]' ? empty : null; },
    querySelectorAll(selector) {
      if (selector === '[data-component-demo]') return [];
      if (selector === '[data-catalog-item]') {
        const match = this.innerHTML.match(/data-search="([^"]+)"/);
        article.dataset.search = match ? match[1] : '';
        return [article];
      }
      if (selector === '[data-catalog-group]') return [group];
      return [];
    }
  };
  const document = createDocument({
    querySelector(selector) {
      if (selector === '[data-catalog-search]') return search;
      if (selector === '[data-search-status]') return status;
      return null;
    },
    querySelectorAll(selector) { return selector === '[data-result-count]' ? [count] : []; }
  });
  const { sandbox } = loadRuntime(document);

  sandbox.WeotziDocs.renderCatalog({
    root: renderRoot,
    items: [{
      category: 'Contenido y datos',
      id: 'miscelaneas',
      title: 'Misceláneas',
      nodeId: '8:193',
      width: 1547,
      height: 1199,
      tag: 'weotzi-miscellany',
      description: 'Piezas de navegación y clasificación.',
      states: 'Paginación y selección'
    }]
  });

  assert.match(renderRoot.innerHTML, /data-search="miscelaneas[^\"]*paginacion/);
  search.value = 'miscelaneas';
  listeners.input();
  assert.equal(article.hidden, false);
  assert.equal(count.textContent, '1');

  search.value = 'paginacion';
  listeners.input();
  assert.equal(article.hidden, false);

  search.value = 'sin coincidencia';
  listeners.input();
  assert.equal(article.hidden, true);
  assert.equal(empty.hidden, false);
});

test('organism catalog and implementation agree on all 17 references and Figma nodes', () => {
  const catalog = plain(runtime.sandbox.WEOTZI_ORGANISM_CATALOG);
  const nodeManifest = plain(runtime.sandbox.WeotziOrganisms.nodeIds);
  const flattened = [];

  assert.equal(catalog.length, 17);
  for (const item of catalog) {
    if (item.variants) {
      for (const variant of item.variants) flattened.push([item.tag, variant.nodeId, variant.value]);
    } else {
      flattened.push([item.tag, item.nodeId, item.variant || '']);
    }
  }
  assert.deepEqual(flattened, ORGANISM_REFERENCES);
  assert.equal(new Set(flattened.map(([, nodeId]) => nodeId)).size, flattened.length);

  for (const [tag, nodeId, variant] of flattened) {
    const implementationNode = nodeManifest[tag];
    assert.equal(
      typeof implementationNode === 'string' ? implementationNode : implementationNode[variant],
      nodeId,
      `${tag}${variant ? ` (${variant})` : ''} points at the wrong Figma node`
    );
  }

  const productNav = catalog.find((item) => item.tag === 'weotzi-product-nav');
  assert.deepEqual(
    {
      nodeId: productNav.nodeId,
      width: productNav.width,
      height: productNav.height,
      figmaFile: productNav.figmaFile
    },
    {
      nodeId: '80:13241',
      width: 1440,
      height: 76,
      figmaFile: 'https://www.figma.com/design/UmVbDewiAHkfLedTR5uyFj/Pantallas--We-Otzi'
    }
  );
});

test('artist product navigation always renders the seven Figma destinations in order', () => {
  const html = runtime.sandbox.WeotziOrganisms.render.productNav('statistics');
  const desktopLinks = html.match(/<div class="wo-org-product-nav__links">([\s\S]*?)<\/div>/)[1];
  const destinations = [...desktopLinks.matchAll(/href="([^"]+)"[^>]*>([^<]+)<\/a>/g)]
    .map(([, href, label]) => [href, label]);

  assert.deepEqual(destinations, [
    ['/my-quotations', 'COTIZACIONES'],
    ['/job-board', 'JOB BOARD'],
    ['/studio-spots', 'SPOTS'],
    ['/calendar', 'CALENDARIO'],
    ['/my-quotations/statistics', 'ESTADÍSTICAS'],
    ['/artist/travel', 'TRAVEL'],
    ['/artist/inbox', 'INBOX']
  ]);
  assert.match(html, /data-figma-node="80:13241"/);
  assert.match(html, /href="\/my-quotations\/statistics" aria-current="page">ESTADÍSTICAS<\/a>/);
});

test('artist product navigation renders the Dashboard chrome while preserving page hooks', () => {
  const html = runtime.sandbox.WeotziOrganisms.render.productNav('travel', {
    menuToggleId: 'tv-mobile-menu-toggle',
    menuId: 'tv-mobile-menu',
    menuClass: 'tvl-mobile-menu',
    profileId: 'auth-nav-btn',
    profileClass: 'tvl-auth',
    profileLabelId: 'auth-nav-label',
    logoutId: 'tv-logout',
    logoutClass: 'tvl-logout',
    logoutHidden: true
  });

  assert.match(html, /<header class="wo-org-product-nav wo-topbar wo-topbar--artist"/);
  assert.match(html, /id="tv-mobile-menu-toggle"[^>]*aria-controls="tv-mobile-menu"/);
  assert.match(html, /id="auth-nav-btn"[^>]*class="[^"]*wo-o-tile[^"]*tvl-auth/);
  assert.match(html, /id="auth-nav-label" class="wo-sr-only">Centro de la cuenta<\/span>/);
  assert.match(html, /id="tv-logout"[^>]*class="[^"]*tvl-logout[^"]*"[^>]*hidden/);
  assert.match(html, /id="tv-mobile-menu"[^>]*class="[^"]*tvl-mobile-menu[^"]*"[^>]*hidden/);
  assert.match(html, /href="\/artist\/travel" aria-current="page">TRAVEL<\/a>/);
});

test('artist product navigation can retain the quotations archive mobile affordance', () => {
  const html = runtime.sandbox.WeotziOrganisms.render.productNav('quotations', {
    archiveExtra: true
  });

  assert.match(html, /href="\/archive">ARCHIVO<\/a>/);
});

test('artist product navigation marks an active auxiliary Dashboard destination', () => {
  const html = runtime.sandbox.WeotziOrganisms.render.productNav('visitors', {
    dashboardExtras: true
  });

  assert.match(html, /href="\/artist\/visitors\/" class="is-active" aria-current="page">VISITANTES<\/a>/);
});

test('Figma fixture data retains the key product literals used by the organisms', () => {
  const data = plain(runtime.sandbox.WeotziOrganismData);

  assert.deepEqual(
    [data.profile.name, data.profile.handle, data.profile.verification, data.profile.rate],
    ['LAUUMARTH', '@lauumarth.wo', 'NO VERIFICADO', '$150 / SESIÓN']
  );
  assert.deepEqual(
    data.agenda.map(({ time, name, status }) => ({ time, name, status })),
    [
      { time: '10:00', name: 'Sofía Martínez', status: 'CONFIRMADO' },
      { time: '13:30', name: 'Mateo Ruiz', status: 'CONFIRMADO' },
      { time: '16:00', name: 'Julia Ferrer', status: 'POR CONFIRMAR' },
      { time: '18:30', name: 'Tomás Vega', status: 'CONFIRMADO' }
    ]
  );
  assert.deepEqual(data.jobs.map((job) => job.id), ['JB-59407', 'JB-76217', 'JB-33005', 'JB-34654', 'JB-28471']);
  assert.deepEqual(
    data.spots.slice(0, 3).map((spot) => spot.title),
    ['Palermo Tattoo Club', 'Bang Bang NYC', 'Sur Tattoo House']
  );
  assert.deepEqual(
    [data.statistics.month, data.statistics.profileViews, data.statistics.income, data.statistics.conversion],
    ['JULIO 2026', '4.820', '$3.150.000', '1,6%']
  );
});

test('design-system delivery contains local Figma assets and no temporary MCP asset URLs', () => {
  const expectedAssets = [
    ...Array.from({ length: 18 }, (_, index) => `mood-board/mood-${String(index + 1).padStart(2, '0')}.png`),
    'spots-bang-bang-nyc.png',
    'spots-texture.png'
  ];
  const assetRoot = fromRoot('public/shared/assets/figma/design-system');

  for (const relative of expectedAssets) {
    const file = path.join(assetRoot, relative);
    assert.ok(fs.statSync(file).size > 0, `${relative} is empty`);
    assert.equal(fs.readFileSync(file).subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${relative} is not a PNG`);
  }

  const textFiles = [
    'public/componentes/index.html',
    'public/componentes/componentes.js',
    'public/componentes/componentes.css',
    'public/componentes/compuestos/index.html',
    'public/componentes/compuestos/compuestos.js',
    'public/componentes/compuestos/compuestos.css',
    'public/componentes/preview/index.html',
    'public/componentes/preview/preview.js',
    'public/shared/js/ds/site-components.js',
    'public/shared/js/ds/molecules.js',
    'public/shared/js/ds/organisms.js',
    'public/shared/css/ds/tokens.css',
    'public/shared/css/ds/components.css',
    'public/shared/css/ds/site-components.css',
    'public/shared/css/ds/molecules.css',
    'public/shared/css/ds/organisms.css',
    'public/my-quotations/statistics/index.html'
  ];
  assert.doesNotMatch(textFiles.map(read).join('\n'), /figma\.com\/api\/mcp\/asset/i);
});

test('statistics uses the canonical artist navigation for desktop and mobile logout flow', () => {
  const html = read('public/my-quotations/statistics/index.html');

  assert.match(html, /<weotzi-product-nav[\s\S]*active="statistics"[\s\S]*menu-id="admin-mobile-menu"[\s\S]*logout-handler="handleStatsLogout"/);
  assert.doesNotMatch(html, /stats-desktop-nav|stats-mobile-topbar/);
  assert.equal((html.match(/<weotzi-product-nav\b/g) || []).length, 1);
});

test('catalog and production HTML load design-system dependencies in executable order', () => {
  const baseStyles = [
    '/shared/css/ds/tokens.css',
    '/shared/css/ds/components.css',
    '/shared/css/ds/site-components.css'
  ];
  const baseScripts = [
    '/shared/js/wo-icons.js',
    '/shared/js/ds/site-components.js'
  ];
  const catalogDependencies = [
    ...baseStyles,
    '/shared/css/ds/molecules.css',
    '/shared/css/ds/organisms.css',
    ...baseScripts,
    '/shared/js/ds/organisms.js',
    '/shared/js/ds/molecules.js'
  ];

  for (const file of [
    'public/componentes/index.html',
    'public/componentes/compuestos/index.html',
    'public/componentes/preview/index.html'
  ]) {
    assertDependenciesInOrder(read(file), catalogDependencies);
  }

  assertDependenciesInOrder(read('public/my-quotations/statistics/index.html'), [
    ...baseStyles,
    '/shared/css/ds/organisms.css',
    ...baseScripts,
    '/shared/js/ds/organisms.js'
  ]);

  assertDependenciesInOrder(read('public/componentes/index.html'), [
    '/shared/js/ds/molecules.js',
    '/componentes/componentes.js'
  ]);
  assertDependenciesInOrder(read('public/componentes/compuestos/index.html'), [
    '/componentes/componentes.js',
    '/componentes/compuestos/compuestos.js'
  ]);
  assertDependenciesInOrder(read('public/componentes/preview/index.html'), [
    '/shared/js/ds/molecules.js',
    '/componentes/preview/preview.js'
  ]);
});
