'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LEGACY_ARTIST_ROUTES, legacyRedirectFor } = require('../lib/legacy-routes');

function tempPublic(existing) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-legacy-'));
    for (const route of existing) {
        fs.mkdirSync(path.join(dir, route), { recursive: true });
        fs.writeFileSync(path.join(dir, route, 'index.html'), '<!doctype html>');
    }
    return dir;
}

test('una ruta retirada redirige a su reemplazo cuando su carpeta ya no existe', () => {
    const dir = tempPublic([]);
    assert.equal(legacyRedirectFor('/artist/visitors', dir), '/my-quotations/statistics');
    assert.equal(legacyRedirectFor('/artist/visitors/', dir), '/my-quotations/statistics');
    assert.equal(legacyRedirectFor('/artist/profile/gallery/index.html', dir), '/artist/profile');
});

test('si la carpeta vuelve a existir (git restore) la página original se sirve sin redirección', () => {
    const dir = tempPublic(['artist/visitors']);
    assert.equal(legacyRedirectFor('/artist/visitors', dir), null);
});

test('las rutas que no están en el mapa nunca redirigen', () => {
    const dir = tempPublic([]);
    assert.equal(legacyRedirectFor('/artist/dashboard', dir), null);
    assert.equal(legacyRedirectFor('/', dir), null);
});

test('todos los destinos son rutas internas absolutas', () => {
    for (const [from, to] of Object.entries(LEGACY_ARTIST_ROUTES)) {
        assert.match(from, /^\/[a-z-/]+$/);
        assert.match(to, /^\/[a-z-/]+(#[a-z]+)?$/);
    }
});
