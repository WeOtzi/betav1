// Perfil público y entradas (W-PUBLIC, plataforma de estudios):
// - /studio/profile: roster en "Residentes" y "Guest e itinerantes" con
//   "Hasta {ends_on}", "Spots abiertos" (listOpenByStudio) y el hueco #studio-store.
// - /bienvenida: cards Estudio y Supplies junto a cliente y artista.
// - /studio-spots: modalidad (porcentaje / fijo y quién paga) y beneficios.
// Contrato: docs/plans/2026-10-30-estudios-plataforma.md → "Perfil público y entradas".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fakeElement(id) {
    return {
        id, innerHTML: '', textContent: '', hidden: true, value: '', disabled: false,
        style: {}, attrs: {}, listeners: {},
        classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
        removeAttribute(k) { delete this.attrs[k]; },
        addEventListener(type, cb) { (this.listeners[type] = this.listeners[type] || []).push(cb); },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        closest() { return null; }
    };
}

function fakeDocument(overrides = {}) {
    const els = new Map();
    const doc = {
        els,
        title: '',
        readyState: 'loading',
        listeners: {},
        body: fakeElement('body'),
        addEventListener(type, cb) { (doc.listeners[type] = doc.listeners[type] || []).push(cb); },
        getElementById(id) { if (!els.has(id)) els.set(id, fakeElement(id)); return els.get(id); },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement(tag) { return fakeElement(tag); }
    };
    return Object.assign(doc, overrides);
}

// Corre un IIFE del frontend en una VM y expone sus funciones internas
// reemplazando el cierre final `})();`.
function runIife(file, expose, context) {
    const source = read(file);
    assert.match(source, /\}\)\(\);\s*$/, `${file} debe terminar en })();`);
    const exposed = source.replace(/\}\)\(\);\s*$/, `globalThis.__api = { ${expose} }; })();`);
    const ctx = Object.assign({
        console: { warn() {}, error() {}, log() {} },
        setTimeout, clearTimeout, Promise, Date, URL, URLSearchParams, JSON, Intl, Map, Set, WeakSet, Number, String, Array, Object
    }, context);
    vm.runInNewContext(exposed, ctx);
    return ctx.__api;
}

// ---------------------------------------------------------------
// /studio/profile
// ---------------------------------------------------------------
const PROFILE_EXPOSE = 'groupRoster, rosterHtml, rosterCardHtml, spotsHtml, spotCardHtml, spotDatesText, endsOnLabel, roleLabel, prepareStoreSlot, safeUrl';

function profile(options = {}) {
    const document = options.document || fakeDocument();
    const window = Object.assign({
        location: { search: options.search || '' },
        WeotziData: options.data || {},
        WeOtziStudioKit: options.kit
    }, options.window || {});
    const api = runIife('public/shared/js/studio-profile.js', PROFILE_EXPOSE, {
        window, document, WeotziData: window.WeotziData
    });
    return { api, document, window };
}

const kit = require('../public/shared/js/studio-admin-kit.js');

const ROSTER = [
    { membership_id: 'm1', role: 'guest', ends_on: '2026-12-15', artists_db: { name: 'Zoe Guest', username: 'zoe', profile_picture: 'https://cdn.example.com/z.jpg' } },
    { membership_id: 'm2', role: 'resident', ends_on: '2027-03-01', artists_db: { name: 'Bruno', username: 'bruno' } },
    { membership_id: 'm3', role: 'itinerant', ends_on: '2026-11-20', artists_db: { name: 'Ana <script>', username: 'ana', profile_picture: 'javascript:alert(1)' } },
    { membership_id: 'm4', role: 'manager', ends_on: null, artists_db: { name: 'Alicia', username: 'alicia' } },
    { membership_id: 'm5', role: 'resident', ends_on: null, artists_db: { name: 'Abel', username: null } }
];

test('perfil: el markup trae el roster agrupado, Spots abiertos y el hueco #studio-store', () => {
    const html = read('public/studio/profile/index.html');
    assert.match(html, /<section id="studio-store" class="studio-profile-store" aria-label="Tienda del estudio" hidden><\/section>/);
    assert.match(html, /<section id="profile-spots-section" hidden>[\s\S]*Spots <span[^>]*>abiertos<\/span>[\s\S]*id="profile-spots"/);
    assert.match(html, /id="profile-roster"/);
    // El kit (safeUrl / fmtDate) carga antes del script del perfil.
    assert.ok(html.indexOf('/shared/js/studio-admin-kit.js') > html.indexOf('/shared/js/data/studios-repo.js'));
    assert.ok(html.indexOf('/shared/js/studio-admin-kit.js') < html.indexOf('/shared/js/studio-profile.js'));
    assert.match(html, /id="studio-reviews"/);
    // Sin CSS nueva en studio.css: solo un bloque propio de la página.
    assert.doesNotMatch(read('public/shared/css/studio.css'), /studio-profile-roster|studio-profile-spot/);
});

test('perfil: groupRoster separa Residentes de Guest e itinerantes y ordena guests por ends_on', () => {
    const { api } = profile({ kit });
    const groups = api.groupRoster(ROSTER);
    assert.deepEqual(Array.from(groups.residents, m => m.membership_id), ['m5', 'm2', 'm4']);
    assert.deepEqual(Array.from(groups.guests, m => m.membership_id), ['m3', 'm1']);
    assert.deepEqual(JSON.parse(JSON.stringify(api.groupRoster(null))), { residents: [], guests: [] });
});

test('perfil: el roster muestra "Hasta {ends_on}" solo en guests, roles en español y escapa datos', () => {
    const { api } = profile({ kit });
    const html = api.rosterHtml(api.groupRoster(ROSTER));
    assert.match(html, /Residentes <span class="count">· 3<\/span>/);
    assert.match(html, /Guest e itinerantes <span class="count">· 2<\/span>/);
    assert.ok(html.indexOf('Residentes') < html.indexOf('Guest e itinerantes'));
    assert.match(html, /Hasta 15 de diciembre de 2026/);
    assert.match(html, /Hasta 20 de noviembre de 2026/);
    assert.doesNotMatch(html, /Hasta 1 de marzo de 2027/, 'los residentes no muestran fin');
    assert.match(html, /<span class="role">Itinerante<\/span>/);
    assert.match(html, /<span class="role">Manager<\/span>/);
    assert.doesNotMatch(html, /<span class="role">(resident|guest|itinerant|manager)<\/span>/);
    assert.match(html, /Ana &lt;script&gt;/);
    assert.doesNotMatch(html, /javascript:/);
    assert.match(html, /background-image:url\('https:\/\/cdn\.example\.com\/z\.jpg'\)/);
    assert.match(html, /href="\/artist\/profile\?artist=zoe"/);
    // Sin username no hay link roto.
    assert.match(html, /<div class="studio-roster-card">[\s\S]*Abel/);
    assert.equal(api.rosterHtml(api.groupRoster([])), '<p class="studio-help">Sin artistas en el roster por ahora.</p>');
});

test('perfil: sin el kit, las fechas de calendario se formatean igual (sin correr por UTC)', () => {
    const { api } = profile();
    assert.equal(api.endsOnLabel('2026-01-01'), 'Hasta 1 de enero de 2026');
    assert.equal(api.spotDatesText({ start_date: '2026-11-01', end_date: '2026-11-30' }), 'Del 01/11/2026 al 30/11/2026');
    assert.equal(api.safeUrl('javascript:alert(1)'), '');
});

test('perfil: Spots abiertos linkea al directorio, traduce el tipo y muestra beneficios escapados', () => {
    const { api } = profile({ kit });
    const html = api.spotsHtml([
        { id: 'sp 1', title: 'Guest de verano', kind: 'guest_spot', start_date: '2026-12-01', end_date: null, application_count: 1, benefit_tags: ['Hospedaje', '<b>Kit</b>'] },
        { id: 'sp2', title: 'Residencia', kind: 'resident', start_date: null, end_date: null, application_count: 0, benefit_tags: [] },
        { title: 'sin id' }
    ]);
    assert.equal((html.match(/class="spot-card studio-profile-spot"/g) || []).length, 2);
    assert.match(html, /href="\/studio-spots\?spot=sp%201"/);
    assert.match(html, /role-guest">Guest spot</);
    assert.match(html, /role-resident">Residencia</);
    assert.match(html, /Desde el 01\/12\/2026/);
    assert.match(html, /Fechas a convenir/);
    assert.match(html, /1 postulación</);
    assert.match(html, /Postulaciones abiertas/);
    assert.match(html, /&lt;b&gt;Kit&lt;\/b&gt;/);
    assert.doesNotMatch(html, /guest_spot</);
});

test('perfil: el hueco de la Tienda queda vacío con data-studio-id/slug', () => {
    const { api, document } = profile({ kit });
    api.prepareStoreSlot({ id: 'st-1', slug: 'tinta-norte' });
    const slot = document.getElementById('studio-store');
    assert.equal(slot.attrs['data-studio-id'], 'st-1');
    assert.equal(slot.attrs['data-studio-slug'], 'tinta-norte');
    assert.equal(slot.innerHTML, '');
});

test('perfil: un roster o spots sin migración no rompen la página', async () => {
    const calls = [];
    const data = {
        Studios: { getBySlug: async () => ({ data: { id: 'st-1', slug: 'tinta', name: 'Tinta', is_active: true }, error: null }) },
        StudioLocations: { listActiveByStudio: async () => ({ data: [], error: null }) },
        StudioMemberships: {
            listActiveRosterWithArtists: async (id) => { calls.push(['roster', id]); return { data: null, error: { code: '42501', message: 'permiso' } }; }
        },
        StudioSpots: {
            listOpenByStudio: async (id) => { calls.push(['spots', id]); return { data: null, error: { code: 'PGRST205' } }; }
        },
        StudioOps: { listPublicSponsors: async () => ({ data: [], error: null }) }
    };
    const { document } = profile({
        kit, data, search: '?studio=tinta',
        window: { WeOtziGeocoder: { ensureGoogleMapsLoaded: async () => { throw new Error('sin mapas'); } } }
    });
    await document.listeners.DOMContentLoaded[0]();
    await tick();
    assert.deepEqual(calls, [['roster', 'st-1'], ['spots', 'st-1']]);
    assert.equal(document.getElementById('profile-h1').textContent, 'Tinta');
    assert.match(document.getElementById('profile-roster').innerHTML, /No pudimos cargar el roster/);
    assert.equal(document.getElementById('profile-spots-section').hidden, true);
    assert.equal(document.getElementById('studio-store').attrs['data-studio-id'], 'st-1');
    assert.match(document.getElementById('studio-map').innerHTML, /Mapa no disponible/);
});

test('perfil: con datos, el roster sale agrupado y se muestran los spots abiertos', async () => {
    const data = {
        Studios: { getById: async () => ({ data: { id: '0a1b2c3d-0000-4000-8000-000000000001', name: 'Tinta', is_active: true }, error: null }) },
        StudioLocations: { listActiveByStudio: async () => ({ data: [], error: null }) },
        StudioMemberships: { listActiveRosterWithArtists: async () => ({ data: ROSTER, error: null }) },
        StudioSpots: { listOpenByStudio: async () => ({ data: [{ id: 'sp1', title: 'Guest', kind: 'guest_spot', benefit_tags: ['Hospedaje'] }], error: null }) },
        StudioOps: { listPublicSponsors: async () => ({ data: [], error: null }) }
    };
    const { document } = profile({
        kit, data, search: '?studio=0a1b2c3d-0000-4000-8000-000000000001',
        window: { WeOtziGeocoder: { ensureGoogleMapsLoaded: async () => { throw new Error('sin mapas'); } } }
    });
    await document.listeners.DOMContentLoaded[0]();
    await tick();
    assert.match(document.getElementById('profile-roster').innerHTML, /data-roster-group="guests"/);
    assert.equal(document.getElementById('profile-spots-section').hidden, false);
    assert.match(document.getElementById('profile-spots').innerHTML, /Hospedaje/);
});

// ---------------------------------------------------------------
// /bienvenida
// ---------------------------------------------------------------
function bienvenida(options = {}) {
    const checked = options.checked ? { value: options.checked, checked: true } : null;
    const document = fakeDocument({
        querySelector(sel) { return sel === '.bnv-card-input:checked' ? checked : null; }
    });
    const storage = new Map(Object.entries(options.storage || {}));
    let sessionCalls = 0;
    const window = {
        location: { pathname: options.pathname || '/bienvenida', search: options.search || '', href: '' },
        localStorage: { getItem: k => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, v) },
        ConfigManager: {
            ready: async () => {},
            getSupabaseClient: () => ({ auth: { getSession: async () => { sessionCalls += 1; return { data: { session: null } }; } } })
        }
    };
    const api = runIife('public/shared/js/bienvenida.js', 'roleFromQuery, readStoredRole, proceed, isRole, ROUTES', { window, document });
    return { api, window, storage, sessionCalls: () => sessionCalls };
}

test('bienvenida: cards Estudio y Supplies en el mismo radio group, sin romper el copy del Figma', () => {
    const html = read('public/bienvenida/index.html');
    const roles = [...html.matchAll(/<div class="bnv-card[^"]*" data-role="([a-z]+)" id="bnv-card-\1">/g)].map(m => m[1]);
    assert.deepEqual(roles, ['client', 'artist', 'studio', 'supplies']);
    assert.match(html, /id="bnv-role-studio" value="studio"/);
    assert.match(html, /id="bnv-role-supplies" value="supplies"/);
    assert.equal((html.match(/name="bnv-role"/g) || []).length, 4);
    assert.match(html, /<span class="bnv-card-tag">Estudio<\/span>/);
    assert.match(html, /<span class="bnv-card-tag">Supplies<\/span>/);
    assert.match(html, /class="bnv-card-go" data-role="studio">Continuar como estudio/);
    assert.match(html, /class="bnv-card-go" data-role="supplies">Continuar como proveedor/);
    assert.match(html, /<p class="bnv-cards-group"[^>]*>¿Tenés un estudio o vendés insumos\?<\/p>/);
    // Copy del Figma 797:269 intacto.
    assert.match(html, /¡Bienvenido!<br>¿Cómo querés usar We Ötzi\?/);
    assert.match(html, /Podrás cambiar esta experiencia en cualquier momento desde la configuración de tu cuenta\./);
    const css = read('public/shared/css/bienvenida-ds.css');
    assert.match(css, /\.bnv-cards-group\{grid-column:1\/-1;/);
    assert.match(css, /\.bnv-card--compact \.bnv-card-body\{/);
});

test('bienvenida: ?rol= acepta los alias de estudio y supplies; localStorage recuerda los 4 roles', () => {
    assert.equal(bienvenida({ search: '?rol=estudio' }).api.roleFromQuery(), 'studio');
    assert.equal(bienvenida({ search: '?role=supplies' }).api.roleFromQuery(), 'supplies');
    assert.equal(bienvenida({ search: '?rol=insumos' }).api.roleFromQuery(), 'supplies');
    assert.equal(bienvenida({ search: '?rol=tatuador' }).api.roleFromQuery(), 'artist');
    assert.equal(bienvenida({ search: '?rol=cliente' }).api.roleFromQuery(), 'client');
    assert.equal(bienvenida({ search: '?rol=admin' }).api.roleFromQuery(), null);
    assert.equal(bienvenida({ search: '?rol=constructor' }).api.roleFromQuery(), null);
    assert.equal(bienvenida({ storage: { 'wo-role-choice': 'supplies' } }).api.readStoredRole(), 'supplies');
    assert.equal(bienvenida({ storage: { 'wo-role-choice': 'hacker' } }).api.readStoredRole(), null);
});

test('bienvenida: Estudio va a /studio/register y Supplies a /supplies/register (con prefijo /beta)', async () => {
    const studio = bienvenida({ checked: 'studio' });
    await studio.api.proceed();
    assert.equal(studio.window.location.href, '/studio/register');
    assert.equal(studio.storage.get('wo-role-choice'), 'studio');
    assert.equal(studio.sessionCalls(), 0, 'el registro resuelve la sesión');

    const supplies = bienvenida({ checked: 'supplies', pathname: '/beta/bienvenida' });
    await supplies.api.proceed();
    assert.equal(supplies.window.location.href, '/beta/supplies/register');

    const client = bienvenida({ checked: 'client' });
    await client.api.proceed();
    assert.equal(client.window.location.href, '/client/register');
    assert.equal(client.sessionCalls(), 1);
});

// ---------------------------------------------------------------
// /studio-spots
// ---------------------------------------------------------------
const SPOTS_EXPOSE = 'metaLine, detailCells, termsHtml, benefitsHtml, benefitsLine, conditionsText, fixedShortText, showsSplit, ' +
    'itinerantLine, rosterCountText, safeHref, cssEscape, buildDetailMain, enrichSpotTerms, ' +
    'setCurrent(s) { currentSpot = s; }';

function spotsDirectory(options = {}) {
    const document = options.document || fakeDocument();
    const data = options.data || {};
    const window = { _supabase: {}, WeotziData: data, location: { search: '' } };
    const api = runIife('public/shared/js/studio-spots-directory.js', SPOTS_EXPOSE, {
        window, document, WeotziData: data, supabase: { createClient() { throw new Error('no debería crear cliente'); } }
    });
    return { api, document };
}

const BASE_SPOT = { id: 'sp1', kind: 'resident', weeks_minimum: 12, weeks_maximum: 24, studios: { name: 'Tinta' }, location: { city: 'Rosario' } };

test('spots: sin columnas de M2 la línea de la tarjeta queda como siempre', () => {
    const { api } = spotsDirectory();
    const legacy = Object.assign({}, BASE_SPOT, { revenue_split_pct: 60, stipend_amount: 1000, stipend_currency: 'EUR' });
    assert.equal(api.metaLine(legacy), '3 a 6 meses · Split 60% · Stipend 1.000 EUR');
    assert.equal(api.benefitsLine(legacy), '');
    assert.equal(api.conditionsText(legacy), '60% para el artista · Stipend 1.000 EUR');
    assert.deepEqual(Array.from(api.detailCells(legacy), ([k]) => k), ['Duración', 'Split / comisión', 'Stipend']);
});

test('spots: modalidad fija muestra el monto y quién paga, y oculta el split legacy', () => {
    const { api } = spotsDirectory();
    const fixed = Object.assign({}, BASE_SPOT, {
        revenue_split_pct: 60, compensation_model: 'fixed',
        fixed_amount: 150000, fixed_currency: 'ARS', fixed_period: 'monthly', fixed_payer: 'artist_to_studio'
    });
    assert.equal(api.showsSplit(fixed), false);
    assert.equal(api.metaLine(fixed), '3 a 6 meses · Alquiler 150.000 ARS por mes');
    const cells = api.detailCells(fixed);
    assert.deepEqual(Array.from(cells.slice(1), c => Array.from(c)), [
        ['Modalidad', 'Pago fijo'],
        ['Pago fijo', '150.000 ARS por mes'],
        ['Quién paga', 'Alquiler de puesto: el artista paga al estudio']
    ]);
    assert.match(api.termsHtml(fixed), /Detalles de la oportunidad[\s\S]*Quién paga/);
});

test('spots: modalidad mixta suma split y pago al artista; porcentaje no muestra fijo', () => {
    const { api } = spotsDirectory();
    const mixed = Object.assign({}, BASE_SPOT, {
        revenue_split_pct: 50, compensation_model: 'mixed',
        fixed_amount: 200000, fixed_currency: 'ARS', fixed_period: 'weekly', fixed_payer: 'studio_to_artist'
    });
    assert.equal(api.metaLine(mixed), '3 a 6 meses · Split 50% · Pago al artista 200.000 ARS por semana');
    assert.equal(api.conditionsText(mixed), '50% para el artista · Pago al artista 200.000 ARS por semana');
    assert.ok(api.detailCells(mixed).some(([k, v]) => k === 'Quién paga' && v === 'Pago al artista: el estudio paga'));

    const pct = Object.assign({}, BASE_SPOT, { revenue_split_pct: 70, compensation_model: 'percentage', fixed_amount: 10, fixed_currency: 'USD' });
    assert.equal(api.fixedShortText(pct), '');
    assert.deepEqual(Array.from(api.detailCells(pct).find(([k]) => k === 'Modalidad')), ['Modalidad', 'Porcentaje']);

    const itinerant = Object.assign({}, mixed, { kind: 'itinerant', location: { city: 'Córdoba' } });
    assert.match(api.itinerantLine(itinerant), /split 50%, pago al artista 200\.000 ARS por semana/);
});

test('spots: beneficios (hasta 6) en la tarjeta y el detalle, escapados', () => {
    const { api } = spotsDirectory();
    const spot = Object.assign({}, BASE_SPOT, { benefit_tags: ['Hospedaje', 'Insumos', '<img src=x>', 'Prensa', 'Merch', 'Fotos', 'Séptimo'] });
    assert.equal(api.benefitsLine(spot), 'Beneficios: Hospedaje · Insumos · <img src=x> · +3');
    const html = api.benefitsHtml(spot);
    assert.match(html, /<span class="sps-label">Beneficios<\/span>/);
    assert.equal((html.match(/class="sps-tag"/g) || []).length, 6);
    assert.match(html, /&lt;img src=x&gt;/);
    assert.doesNotMatch(html, /Séptimo/);
    assert.equal(api.benefitsHtml(BASE_SPOT), '');
    // El detalle reserva los contenedores que completa enrichSpotTerms.
    const detail = api.buildDetailMain(spot);
    assert.match(detail, /<div id="spot-terms">/);
    assert.match(detail, /<div id="spot-benefits">[\s\S]*Beneficios/);
});

test('spots: el link del sitio del estudio y las imágenes de fondo no aceptan URLs peligrosas', () => {
    const { api } = spotsDirectory();
    assert.equal(api.safeHref('javascript:alert(1)'), '');
    assert.equal(api.safeHref('data:text/html,hi'), '');
    assert.equal(api.safeHref('tintanorte.com'), 'https://tintanorte.com/');
    assert.equal(api.safeHref('https://tinta.com/a'), 'https://tinta.com/a');
    const detail = api.buildDetailMain(Object.assign({}, BASE_SPOT, { studios: { name: 'Tinta', website: 'javascript:alert(1)' } }));
    assert.doesNotMatch(detail, /javascript:/);
    const escaped = api.cssEscape(`https://x.com/a.jpg') ; x" onmouseover="alert(1)`);
    assert.doesNotMatch(escaped, /["']/);
    assert.match(escaped, /%27/);
    assert.equal(api.cssEscape('/shared/assets/figma/opportunities/spots-studio-01.png'), '/shared/assets/figma/opportunities/spots-studio-01.png');
});

test('spots: el detalle completa modalidad y beneficios con la fila del spot (una sola vez)', async () => {
    const calls = [];
    const data = {
        StudioSpots: {
            getById: async (id) => {
                calls.push(id);
                return { data: { id, compensation_model: 'fixed', fixed_amount: 90000, fixed_currency: 'ARS', fixed_period: 'monthly', fixed_payer: 'artist_to_studio', benefit_tags: ['Hospedaje'] }, error: null };
            }
        }
    };
    const { api, document } = spotsDirectory({ data });
    const spot = Object.assign({}, BASE_SPOT);
    api.setCurrent(spot);
    await api.enrichSpotTerms(spot);
    await api.enrichSpotTerms(spot);
    assert.deepEqual(calls, ['sp1']);
    assert.equal(spot.fixed_payer, 'artist_to_studio');
    assert.match(document.getElementById('spot-terms').innerHTML, /Alquiler de puesto: el artista paga al estudio/);
    assert.match(document.getElementById('spot-benefits').innerHTML, /Hospedaje/);

    // Si el select ya trae las columnas de M2, no hay lectura extra.
    const full = Object.assign({}, BASE_SPOT, { id: 'sp2', benefit_tags: [], compensation_model: null, fixed_amount: null, fixed_currency: null, fixed_period: null, fixed_payer: null });
    await api.enrichSpotTerms(full);
    assert.deepEqual(calls, ['sp1']);

    // Sin la migración, getById no trae las columnas: no se toca el detalle.
    const legacyData = { StudioSpots: { getById: async (id) => ({ data: { id, title: 'x' }, error: null }) } };
    const legacy = spotsDirectory({ data: legacyData });
    const legacySpot = Object.assign({}, BASE_SPOT, { id: 'sp3' });
    legacy.api.setCurrent(legacySpot);
    await legacy.api.enrichSpotTerms(legacySpot);
    assert.equal(legacy.document.getElementById('spot-terms').innerHTML, '');
    assert.equal(Object.prototype.hasOwnProperty.call(legacySpot, 'compensation_model'), false);
});

test('spots: el conteo del roster separa residentes de guests e itinerantes', () => {
    const { api } = spotsDirectory();
    assert.equal(api.rosterCountText([{ role: 'resident' }, { role: 'manager' }, { role: 'guest' }]), '2 artistas residentes · 1 guest e itinerante');
    assert.equal(api.rosterCountText([{ role: 'resident' }]), '1 artista residente');
    assert.equal(api.rosterCountText([{ role: 'itinerant' }, { role: 'guest' }]), '2 guests e itinerantes');
});
