// Panel del estudio · Sedes (E-LOC-01/02/03) y cola de reclamos del backoffice.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const plain = value => JSON.parse(JSON.stringify(value));
const sedes = require('../public/shared/js/studio-dashboard-sedes.js');
const claims = require('../public/shared/js/backoffice-studio-claims.js');

const locs = [
    { id: 'a', label: 'Norte', is_primary: false, is_active: false, city: 'Rosario', formatted_address: 'Calle 1', latitude: null, longitude: null },
    { id: 'b', label: 'Madrid Centro', is_primary: true, is_active: true, city: 'Madrid', formatted_address: 'Gran Vía 1', latitude: 40.42, longitude: -3.70 },
    { id: 'c', label: 'Ámbar', is_primary: false, is_active: true, city: 'Madrid', formatted_address: 'Atocha 2', latitude: 40.41, longitude: -3.69 }
];

test('conteo de artistas activos por sede', () => {
    assert.deepEqual(plain(sedes.artistCounts([
        { status: 'active', location_id: 'b' }, { status: 'active', location_id: 'b' },
        { status: 'paused', location_id: 'b' }, { status: 'active', location_id: null }, null
    ])), { b: 2 });
});

test('lista: principal primero, filtro activas/archivadas y búsqueda sin acentos', () => {
    assert.deepEqual(sedes.filterLocations(locs).map(l => l.id), ['b', 'c']);
    assert.deepEqual(sedes.filterLocations(locs, { status: 'archived' }).map(l => l.id), ['a']);
    assert.deepEqual(sedes.filterLocations(locs, { status: 'all' }).map(l => l.id), ['b', 'c', 'a']);
    assert.deepEqual(sedes.filterLocations(locs, { query: 'ambar' }).map(l => l.id), ['c']);
    assert.deepEqual(sedes.filterLocations(locs, { query: 'rosario', status: 'all' }).map(l => l.id), ['a']);
});

test('metadatos de la fila como E-LOC-01 (Principal · Activa · 2 artistas)', () => {
    assert.equal(sedes.locationMeta(locs[1], 2), 'Principal · Activa · 2 artistas');
    assert.equal(sedes.locationMeta(locs[0], 1), 'Adicional · Archivada · 1 artista · Pin pendiente');
});

test('payload: la principal siempre activa, coordenadas en par y textos recortados', () => {
    const payload = sedes.buildPayload({
        label: '  Sede  ', isPrimary: true, isActive: false, phone: ' 123 ', hours: { open: 1 }, hoursText: ' L a V ',
        address: { formatted_address: ' Gran Vía 1 ', city: 'Madrid', latitude: '40.42', longitude: null, google_place_id: '' }
    });
    assert.equal(payload.is_active, true);
    assert.equal(payload.is_primary, true);
    assert.equal(payload.label, 'Sede');
    assert.equal(payload.phone, '123');
    assert.equal(payload.latitude, null, 'sin longitud no hay latitud');
    assert.equal(payload.longitude, null);
    assert.equal(payload.formatted_address, 'Gran Vía 1');
    assert.equal(payload.google_place_id, null);
    assert.deepEqual(plain(payload.hours_json), { open: 1, description: 'L a V' });
    assert.equal('geocoded_at' in payload, false, 'geocoded_at lo decide la RPC');
    const archived = sedes.buildPayload({ isPrimary: false, isActive: false, address: { formatted_address: 'X', latitude: 1, longitude: 2 } });
    assert.equal(archived.is_active, false);
    assert.equal(archived.latitude, 1);
});

test('validación del editor: dirección elegida y principal activa', () => {
    assert.match(sedes.validateDraft({ address: {} }, '').message, /Buscá la dirección/);
    assert.equal(sedes.validateDraft({ address: { formatted_address: 'Gran Vía 1' } }, 'Gran Via').field, 'address');
    assert.equal(sedes.validateDraft({ address: { formatted_address: 'Gran Vía 1' }, isPrimary: true, isActive: false }, 'Gran Vía 1').field, 'active');
    assert.equal(sedes.validateDraft({ address: { formatted_address: 'Gran Vía 1' }, isPrimary: false }, 'Gran Vía 1'), null);
});

test('impacto de quitar: la última activa no se quita y la principal pasa a otra', () => {
    const only = sedes.removalImpact(locs[1], [locs[0], locs[1]], 2);
    assert.equal(only.blocked, true);
    assert.match(only.blockedReason, /única sede activa/);
    const primary = sedes.removalImpact(locs[1], locs, 2);
    assert.equal(primary.blocked, false);
    assert.equal(primary.nextPrimary.id, 'c');
    assert.equal(primary.artists, 2);
    // La siguiente principal sale por sort_order y luego por fecha de alta,
    // no por el orden en que llegó la lista.
    const main = { id: 'p', is_primary: true, is_active: true, sort_order: 0 };
    const pick = (list) => sedes.removalImpact(main, list, 0).nextPrimary.id;
    assert.equal(pick([main, { id: 'z', sort_order: 5 }, { id: 'y', sort_order: 2 }, { id: 'x', is_active: false, sort_order: 1 }]), 'y');
    assert.equal(pick([main, { id: 'late', sort_order: 1, created_at: '2026-11-02T00:00:00Z' }, { id: 'early', sort_order: 1, created_at: '2026-11-01T00:00:00Z' }]), 'early');
    assert.equal(pick([main, { id: 'none' }, { id: 'ordered', sort_order: 3 }]), 'ordered');
});

test('el módulo escapa los datos de la sede y el panel lo monta en lugar del formulario viejo', () => {
    const source = read('public/shared/js/studio-dashboard-sedes.js');
    assert.match(source, /<strong>' \+ name \+ '<\/strong>'/);
    assert.match(source, /const name = esc\(loc\.label \|\| 'Sede sin nombre'\);/);
    assert.match(source, /D\.StudioLocations\.save\(studio\.id, draft\.id, buildPayload\(draft\)\)/);
    assert.match(source, /D\.StudioLocations\.remove\(studio\.id, loc\.id\)/);
    assert.match(source, /root\.WeOtziLocationMap\.attach\(q\('\[data-map\]'\)/);
    assert.match(source, /dialog\.className = 'wo-modal studio-sede-dialog'/);
    assert.doesNotMatch(source, /\bconfirm\(/, 'sin confirm() nativo');
    const dash = read('public/shared/js/studio-dashboard.js');
    assert.match(dash, /window\.WeOtziStudioSedes\.mount\(\{/);
    assert.doesNotMatch(dash, /is_active:\s+true,/, 'ya no fuerza is_active=true al guardar');
    const html = read('public/studio/dashboard/index.html');
    assert.ok(html.indexOf('studio-dashboard-sedes.js') < html.indexOf('/shared/js/studio-dashboard.js'));
    assert.ok(html.indexOf('studio-location-map.js') < html.indexOf('studio-dashboard-sedes.js'));
    assert.match(html, /studio-dashboard-sedes\.css/);
    assert.match(html, /Tus <span class="accent">sedes<\/span>/);
});

test('backoffice: reclamos con su sección, menú y script', () => {
    const html = read('public/backoffice/index.html');
    assert.match(html, /data-section="studio-claims"/);
    assert.match(html, /<section id="section-studio-claims" class="content-section" data-title="Reclamos de estudios">\s*<div id="bo-studio-claims-root"><\/div>/);
    assert.match(html, /backoffice-studio-claims\.js/);
    assert.equal(claims.ENDPOINT, '/api/admin/studio-claims');
});

test('backoffice: filas escapadas, aprobar bloqueado si la ficha ya tiene dueño y términos visibles', () => {
    const row = claims.claimRowHtml(claims.claimView({
        id: '22222222-2222-4222-8222-222222222222', studio_id: 's', evidence: 'Mirá <script>alert(1)</script> https://instagram.com/x',
        contact_name: '<b>Ana</b>', terms_accepted_at: '2026-11-15T00:00:00Z', terms_version: '2026-11-13',
        studios: { name: 'Black <Ink>', user_id: 'owner' }, user: { email: 'ana@example.test', email_confirmed_at: null }
    }));
    assert.doesNotMatch(row, /<script>|<b>Ana/);
    assert.match(row, /Black &lt;Ink&gt;/);
    assert.match(row, /data-claim-action="approve"[^>]* disabled/);
    assert.match(row, /Aceptó términos · 2026-11-13/);
    assert.match(row, /Email sin confirmar/);
    assert.match(row, /<a href="https:\/\/instagram\.com\/x" target="_blank" rel="noopener noreferrer nofollow">/);
    assert.throws(() => claims.buildDecideRequest('22222222-2222-4222-8222-222222222222', 'reject', ' '), /motivo/);
    const req = claims.buildDecideRequest('22222222-2222-4222-8222-222222222222', 'approve', '');
    assert.equal(req.url, '/api/admin/studio-claims/22222222-2222-4222-8222-222222222222/decide');
    assert.deepEqual(JSON.parse(req.options.body), { decision: 'approve', note: null });
    assert.match(claims.successMessage({ studioName: 'X' }, 'approve', { email: { sent: false } }), /No pudimos enviar el aviso/);
    assert.doesNotMatch(claims.successMessage({ studioName: 'X' }, 'approve', { email: { sent: true } }), /No pudimos/);
});
