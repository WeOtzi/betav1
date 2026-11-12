'use strict';
// Ronda 3: los links legales del footer y del registro apuntan a páginas que
// existen, y el mapa de Invitaciones usa la geografía vendorizada.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('las rutas /legal/terms y /legal/privacy existen como páginas', () => {
    for (const slug of ['terms', 'privacy']) {
        const html = read(`public/legal/${slug}/index.html`);
        assert.match(html, /<html lang="es">/);
        assert.match(html, /\/shared\/css\/legal-ds\.css/);
        assert.match(html, /href="\/legal\/terms"/);
        assert.match(html, /href="\/legal\/privacy"/);
    }
});

test('el footer de artista y el registro enlazan a las páginas legales', () => {
    const organisms = read('public/shared/js/ds/organisms.js');
    assert.match(organisms, /href="\/legal\/terms"/);
    assert.match(organisms, /href="\/legal\/privacy"/);
});

test('el mapa de Invitaciones carga Natural Earth 1:110m vendorizado', () => {
    const html = read('public/artist/invitations/index.html');
    assert.match(html, /id="ism-stage" data-geography="\/shared\/geo\/countries-110m\.json"/);
    const topo = JSON.parse(read('public/shared/geo/countries-110m.json'));
    assert.equal(topo.type, 'Topology');
    assert.ok(topo.objects.countries && topo.objects.land);
    assert.ok(fs.existsSync(path.join(root, 'public/shared/geo/LICENSE-world-atlas.txt')));
});
