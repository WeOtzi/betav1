// Marketplace MK-01 / MK-19: ConfigManager se publica en window ANTES de
// terminar de leer app-config.json. Toda espera "waitForConfigManager" de las
// páginas tiene que esperar también ConfigManager.ready(); si no, consultan con
// la config por defecto (sin URL de Supabase, modo demo) y /explore, el globo
// y /job-board/request quedan vacíos o "Servicio no disponible".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const jsDir = path.join(root, 'public', 'shared', 'js');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// Cuerpo de una función por balanceo de llaves desde su declaración.
function functionBody(source, startIndex) {
    // La llave del cuerpo es la que sigue al ")" de los parámetros (un default
    // `options = {}` no cuenta).
    const head = /\)\s*\{/g;
    head.lastIndex = startIndex;
    const m = head.exec(source);
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(startIndex, i + 1);
        }
    }
    throw new Error('función sin cierre');
}

test('toda función waitForConfigManager de public/shared/js espera ConfigManager.ready()', () => {
    const offenders = [];
    let found = 0;
    for (const file of fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'))) {
        const source = fs.readFileSync(path.join(jsDir, file), 'utf8');
        const re = /function\s+waitForConfigManager\s*\(/g;
        let match;
        while ((match = re.exec(source))) {
            found++;
            const body = functionBody(source, match.index);
            if (!/\.ready\s*\(\s*\)/.test(body)) offenders.push(file);
        }
    }
    assert.ok(found >= 8, 'se esperaban las esperas de explore, globo, job board, pre-cotizador, marketplace…');
    assert.deepEqual(offenders, []);
});

test('el globo (/explore/globe) espera ready() antes de pedir sesión y directorio', () => {
    const source = read('public/shared/js/tattoo-globe-page.js');
    const start = source.indexOf('async function loadSessionAndDirectory');
    const body = functionBody(source, start);
    const readyAt = body.indexOf('.ready()');
    const clientAt = body.indexOf('getSupabaseClient');
    assert.ok(readyAt > -1 && clientAt > readyAt, 'ready() antes de getSupabaseClient()');
});

test('explore-map no consulta hasta que ConfigManager.ready() resuelve', async () => {
    const source = read('public/shared/js/explore-map.js');
    const start = source.indexOf('async function waitForConfigManager');
    const fn = functionBody(source, start);
    let resolveReady;
    let resolved = false;
    const ready = new Promise((r) => { resolveReady = () => { resolved = true; r(); }; });
    const context = vm.createContext({ setTimeout, Date, window: { ConfigManager: { ready: () => ready } } });
    vm.runInContext(fn, context);
    let done = false;
    const pending = context.waitForConfigManager().then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(done, false, 'no debe resolver antes de ready()');
    resolveReady();
    await pending;
    assert.equal(resolved && done, true);
});

test('job-board-request espera ready() antes de crear el cliente (Publicar idea)', async () => {
    const source = read('public/shared/js/job-board-request.js');
    const start = source.indexOf('async function waitForConfigManager');
    const fn = functionBody(source, start);
    let resolveReady;
    const ready = new Promise((r) => { resolveReady = r; });
    const context = vm.createContext({ setTimeout, Date, console, window: { ConfigManager: { ready: () => ready } } });
    vm.runInContext(fn, context);
    let done = false;
    const pending = context.waitForConfigManager().then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(done, false);
    resolveReady();
    await pending;
    assert.equal(done, true);
});
