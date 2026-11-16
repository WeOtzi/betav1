const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

test('session log beacon declares JSON so the Express endpoint can parse it', () => {
    const source = fs.readFileSync(path.join(ROOT, 'public/shared/js/logging-service.js'), 'utf8');
    assert.match(source, /new Blob\(\[payload\],\s*\{\s*type:\s*['"]application\/json['"]\s*\}\)/);
    assert.match(source, /sendBeacon\(['"]\/api\/session-log['"],\s*beaconBody\)/);
    assert.doesNotMatch(source, /sendBeacon\(['"]\/api\/session-log['"],\s*payload\)/);
});

// ------------------------------------------------------------ SEG-03 · URL sin query ni hash

function loadLoggingService() {
    const vm = require('node:vm');
    const source = fs.readFileSync(path.join(ROOT, 'public/shared/js/logging-service.js'), 'utf8');
    const noop = () => {};
    const win = { location: { href: 'https://beta.weotzi.com/client/login?returnTo=/cotizacion/abc#access_token=1', origin: 'https://beta.weotzi.com' }, addEventListener: noop };
    // readyState 'loading': el servicio queda cargado sin iniciarse.
    const doc = { readyState: 'loading', addEventListener: noop, referrer: '' };
    const context = vm.createContext({ window: win, document: doc, navigator: { userAgent: 'test', language: 'es' }, console, URL, setInterval: noop, clearInterval: noop, setTimeout: noop, clearTimeout: noop });
    vm.runInContext(source, context);
    return win.LoggingService;
}

test('SEG-03: scrubUrl deja solo origen y ruta (sin tokens de sesión, returnTo ni datos personales)', () => {
    const { scrubUrl } = loadLoggingService();
    assert.equal(scrubUrl('https://x/a?returnTo=/cotizacion/abc#access_token=1'), 'https://x/a');
    assert.equal(scrubUrl('https://beta.weotzi.com/register-artist/#access_token=aaa&refresh_token=bbb&provider_token=ccc'), 'https://beta.weotzi.com/register-artist/');
    assert.equal(scrubUrl('https://beta.weotzi.com/register-artist?email=lucia%40example.com&draft=1'), 'https://beta.weotzi.com/register-artist');
    // Relativas: se resuelven contra el origen de la página.
    assert.equal(scrubUrl('/client/login?returnTo=%2Fcotizacion%2Fabc'), 'https://beta.weotzi.com/client/login');
    // El token del enlace público también viaja en la ruta.
    assert.equal(scrubUrl('https://beta.weotzi.com/cotizacion/' + 'a'.repeat(43)), 'https://beta.weotzi.com/cotizacion/[enlace]');
    assert.equal(scrubUrl('/api/cot-detalle/public/' + 'Ab1_-'.repeat(9) + '/claim'), 'https://beta.weotzi.com/api/cot-detalle/public/[token]/claim');
    // Un uuid en la ruta se conserva (sirve para diagnosticar y no es una llave).
    assert.equal(scrubUrl('https://x.supabase.co/storage/v1/object/a/3f0e7c1a-1b2c-4d5e-8f90-1234567890ab/f.png?token=zzz'), 'https://x.supabase.co/storage/v1/object/a/3f0e7c1a-1b2c-4d5e-8f90-1234567890ab/f.png');
    // Lo que no es http(s) queda en su esquema: ni correos ni teléfonos.
    assert.equal(scrubUrl('mailto:lucia@example.com?subject=x'), 'mailto:');
    assert.equal(scrubUrl('tel:+5491100000000'), 'tel:');
    assert.equal(scrubUrl(''), null);
    assert.equal(scrubUrl(null), null);
    assert.equal(scrubUrl('http://['), null);
});

test('SEG-03: el registro de sesión no guarda ninguna URL sin pasarla por scrubUrl', () => {
    const source = fs.readFileSync(path.join(ROOT, 'public/shared/js/logging-service.js'), 'utf8');
    assert.match(source, /pageUrl:\s*scrubUrl\(window\.location\.href\)/);
    assert.match(source, /referrer:\s*scrubUrl\(document\.referrer\)/);
    assert.match(source, /url:\s*scrubUrl\(window\.location\.href\)/, 'popstate');
    assert.match(source, /oldURL:\s*scrubUrl\(e\.oldURL\)/);
    assert.match(source, /newURL:\s*scrubUrl\(e\.newURL\)/);
    assert.match(source, /href:[^\n]*scrubUrl\(target\.href\)/, 'clics');
    assert.match(source, /const url = scrubUrl\(rawUrl\)/, 'interceptor de fetch');
    // Ninguna lectura cruda de la dirección fuera de scrubUrl(…).
    const raw = source.replace(/scrubUrl\((window\.location\.href|document\.referrer|e\.oldURL|e\.newURL|target\.href|form\.action|rawUrl)\)/g, '');
    assert.doesNotMatch(raw, /window\.location\.href|document\.referrer|e\.oldURL|e\.newURL|:\s*target\.href|:\s*form\.action/);
    // El cargador sirve la versión nueva.
    const loader = fs.readFileSync(path.join(ROOT, 'public/shared/js/logging-loader.js'), 'utf8');
    assert.match(loader, /logging-service\.js\?v=20261116-r2b/);
});

test('SEG-03: la limpieza de session_logs vacía los registros con tokens y recorta todas las direcciones', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261116230000_session_logs_sin_tokens_en_url.sql'), 'utf8');
    const wipe = sql.indexOf("set log_data = ''");
    const trim = sql.indexOf("set page_url = split_part(split_part(page_url, '#', 1), '?', 1)");
    assert.ok(wipe > 0 && trim > wipe, 'primero se vacían los registros (el filtro usa la dirección completa), después se recorta');
    assert.match(sql, /access_token\|refresh_token\|provider_token\|provider_refresh_token/);
    assert.match(sql, /returnTo=\.\*cotizacion/i);
    assert.match(sql, /where page_url ~ '\[#\?\]'/);
    assert.ok(fs.existsSync(path.join(ROOT, 'supabase/rollbacks/20261116230000_session_logs_sin_tokens_en_url.down.sql')));
});
