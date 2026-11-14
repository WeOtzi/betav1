'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const { listRegisteredRoutes } = require('../lib/registered-routes');
const perfil = require('../lib/routes/perfil');

test('listRegisteredRoutes expande rutas-array e ignora RegExp sin tirar excepción', () => {
    const app = express();
    app.get(['/api/a', '/api/b', '/artist/x'], (req, res) => res.end());
    app.get(/^\/api\/regex/, (req, res) => res.end());
    app.post('/api/c', (req, res) => res.end());
    app.get('/shared/js/x.js', (req, res) => res.end());
    app.get('/explore', (req, res) => res.end());
    const routes = listRegisteredRoutes(app._router.stack);
    assert.deepEqual(routes, [
        { methods: 'GET', path: '/api/a' },
        { methods: 'GET', path: '/api/b' },
        { methods: 'POST', path: '/api/c' },
        { methods: 'GET', path: '/shared/js/x.js' }
    ]);
});

test('listRegisteredRoutes tolera un stack vacío o inválido', () => {
    assert.deepEqual(listRegisteredRoutes(undefined), []);
    assert.deepEqual(listRegisteredRoutes([{}, { route: null }]), []);
});

test('perfil.register no registra rutas con path-array', () => {
    const app = express();
    perfil.register(app, { fetchArtist: async () => null, readTemplate: async () => '<html></html>' });
    const paths = app._router.stack.filter(l => l.route).map(l => l.route.path);
    assert.ok(paths.length >= 4);
    for (const p of paths) assert.equal(typeof p === 'string' || p instanceof RegExp, true);
    assert.ok(paths.includes('/artist/profile'));
    assert.ok(paths.includes('/artist/profile/'));
    assert.ok(paths.includes('/artist/profile/index.html'));
    assert.doesNotThrow(() => listRegisteredRoutes(app._router.stack));
});

test('server.js arma el banner con listRegisteredRoutes', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(src, /require\('\.\/lib\/registered-routes'\)\.listRegisteredRoutes\(app\._router\.stack\)/);
});
