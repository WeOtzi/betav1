'use strict';

// Ronda 3c · grupo "privacidad": banner de cookies, configuración del
// backoffice e IP privada.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const priv = require('../lib/privacidad-cookies');
const consent = require('../public/shared/js/wo-consent.js');

function htmlPages(dir = path.join(root, 'public')) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'Backend We Otzi') out.push(...htmlPages(p)); }
        else if (e.name.endsWith('.html')) out.push(p);
    }
    return out;
}

/* ------------------------- configuración (servidor) ------------------------- */

test('sanitizeConfig: valores por defecto completos y válidos', () => {
    const { config, errors } = priv.sanitizeConfig({});
    assert.deepEqual(errors, []);
    assert.equal(config.enabled, true);
    assert.match(config.version, /^[A-Za-z0-9._-]+$/);
    assert.equal(config.policy_url, '/legal/privacy#cookies');
    assert.deepEqual(config.categories.map((c) => c.id), ['necessary', 'analytics', 'marketing']);
    assert.equal(config.categories.find((c) => c.id === 'marketing').enabled, false, 'no hay marketing hoy');
    assert.equal(config.scripts[0].type, 'clarity');
    assert.deepEqual(config.scripts[0].exclude_paths, ['/backoffice', '/support']);
});

test('sanitizeConfig: necesarias siempre activas, versión y tipos validados, textos sin etiquetas', () => {
    const { config, errors } = priv.sanitizeConfig({
        version: 'v 2!',
        renew_days: 5,
        policy_url: 'https://evil.example/x',
        texts: { title: '<b>Hola</b>', body: '' },
        categories: [{ id: 'necessary', enabled: false }, { id: 'analytics', enabled: false }, { id: 'raro', enabled: true }],
        scripts: [{ type: 'pixel', id: 'fb' }, { type: 'clarity', project_id: 'abc' }]
    });
    assert.equal(errors.length, 4, errors.join(' | '));
    assert.equal(config.version, priv.CONSENT_VERSION_DEFAULT);
    assert.equal(config.renew_days, 365);
    assert.equal(config.policy_url, '/legal/privacy#cookies');
    assert.equal(config.texts.title, 'bHola/b');
    assert.equal(config.texts.body, priv.DEFAULT_CONFIG.texts.body);
    assert.equal(config.categories.find((c) => c.id === 'necessary').enabled, true);
    assert.equal(config.categories.find((c) => c.id === 'analytics').enabled, false);
    assert.equal(config.categories.length, 3);
    assert.equal(config.scripts.length, 1);
    assert.equal(config.scripts[0].project_id, '');
});

test('toPublicConfig: sin ID no hay script; ID del entorno como respaldo; categoría apagada lo excluye', () => {
    const base = priv.sanitizeConfig({}).config;
    assert.deepEqual(priv.toPublicConfig(base, {}).scripts, []);
    const withEnv = priv.toPublicConfig(base, { CLARITY_PROJECT_ID: 'abcd1234ef' });
    assert.equal(withEnv.scripts.length, 1);
    assert.equal(withEnv.scripts[0].project_id, 'abcd1234ef');
    assert.deepEqual(withEnv.categories.find((c) => c.id === 'analytics').providers, ['Microsoft Clarity']);
    assert.equal(withEnv.categories.some((c) => c.id === 'marketing'), false);
    assert.deepEqual(priv.toPublicConfig(base, { CLARITY_PROJECT_ID: 'CLARITY_TRACKING_ID' }).scripts, []);
    const off = priv.sanitizeConfig({ categories: [{ id: 'analytics', enabled: false }], scripts: [{ type: 'clarity', project_id: 'abcd1234ef' }] }).config;
    assert.deepEqual(priv.toPublicConfig(off, {}).scripts, []);
    const stored = priv.parseStoredConfig(JSON.stringify({ version: '2027-01-01' }));
    assert.equal(stored.version, '2027-01-01');
    assert.equal(priv.parseStoredConfig('{basura').version, priv.CONSENT_VERSION_DEFAULT);
});

test('normalizeConsentPayload: solo booleanos de categorías conocidas', () => {
    assert.equal(priv.normalizeConsentPayload({ version: 'x y', categories: {} }).ok, false);
    assert.equal(priv.normalizeConsentPayload({ version: 'v1' }).ok, false);
    const r = priv.normalizeConsentPayload({ version: 'v1', categories: { analytics: 'true', marketing: true, otra: true, necessary: false }, source: 'hack', gpc: 1 }, new Date('2026-11-13T00:00:00Z'));
    assert.equal(r.ok, true);
    assert.deepEqual(r.consent.categories, { necessary: true, analytics: false, marketing: true });
    assert.equal(r.consent.source, 'banner');
    assert.equal(r.consent.gpc, false);
    assert.equal(r.consent.decided_at, '2026-11-13T00:00:00.000Z');
});

/* ------------------------------------ IP ------------------------------------ */

test('anonymizeIp: IPv4 /24, IPv6 /48, mapeada y basura', () => {
    assert.equal(priv.anonymizeIp('190.12.34.56'), '190.12.34.0');
    assert.equal(priv.anonymizeIp('190.12.34.56, 10.0.0.1'), '190.12.34.0');
    assert.equal(priv.anonymizeIp('::ffff:200.1.2.3'), '200.1.2.0');
    assert.equal(priv.anonymizeIp('2800:810:4a3:1b2::5'), '2800:810:4a3::');
    assert.equal(priv.anonymizeIp('2800:810:4a3:1b2:aa:bb:cc:dd'), '2800:810:4a3::');
    assert.equal(priv.anonymizeIp('999.1.1.1'), null);
    assert.equal(priv.anonymizeIp('unknown'), null);
    assert.equal(priv.anonymizeIp(undefined), null);
});

test('countryFromHints: zona horaria primero, idioma como respaldo, nunca ciudad', () => {
    assert.equal(priv.countryFromHints({ tz: 'America/Argentina/Buenos_Aires' }), 'Argentina');
    assert.equal(priv.countryFromHints({ tz: 'Europe/Madrid', lang: 'es-AR' }), 'Spain');
    assert.equal(priv.countryFromHints({ tz: 'Etc/UTC', lang: 'es-MX' }), 'Mexico');
    assert.equal(priv.countryFromHints({ tz: 'America/Indiana/Indianapolis' }), 'United States');
    assert.equal(priv.countryFromHints({ lang: 'es' }), null);
    assert.equal(priv.countryFromHints(null), null);
});

test('nadie manda la IP a geolocalizadores externos', () => {
    const server = read('server.js');
    assert.doesNotMatch(server, /fetch\([^)]*ip-api\.com/);
    assert.doesNotMatch(server, /http:\/\/ip-api/);
    assert.match(server, /privacidadCookies\.anonymizeIp\(ip\)/, '/api/client-info devuelve la IP anonimizada');
    assert.match(server, /privacidadCookies\.countryFromHints\(req\.body && req\.body\.geo_hint\)/);
    for (const rel of ['public/shared/js/dashboard.js', 'public/shared/js/register.js']) {
        assert.doesNotMatch(read(rel), /fetch\(['"`]https?:\/\/ipapi\.co/, rel);
    }
    assert.match(read('public/shared/js/logging-service.js'), /geo_hint: geoHint\(\)/);
});

/* --------------------------- banner (lógica pura) --------------------------- */

const CFG = consent.normalizeConfig({ version: 'v2', renew_days: 365, scripts: [
    { id: 'clarity', type: 'clarity', category: 'analytics', project_id: 'abcd1234ef', exclude_paths: ['/backoffice'] }
] });
const NOW = new Date('2026-11-13T12:00:00Z');

test('decide: sin elección muestra el banner y no habilita nada', () => {
    const d = consent.decide({ config: CFG, stored: null, gpc: false, now: NOW });
    assert.equal(d.showBanner, true);
    assert.deepEqual(d.categories, { necessary: true, analytics: false, marketing: false });
});

test('decide: GPC sin elección = todo lo no esencial apagado y sin banner', () => {
    const d = consent.decide({ config: CFG, stored: null, gpc: true, now: NOW });
    assert.equal(d.showBanner, false);
    assert.equal(d.gpcApplied, true);
    assert.equal(d.categories.analytics, false);
});

test('decide: respeta la elección vigente; GPC la apaga salvo activación explícita con GPC', () => {
    const acc = consent.buildRecord({ analytics: true }, CFG, 'banner', false, NOW);
    assert.equal(consent.decide({ config: CFG, stored: acc, gpc: false, now: NOW }).categories.analytics, true);
    assert.equal(consent.decide({ config: CFG, stored: acc, gpc: true, now: NOW }).categories.analytics, false);
    const override = consent.buildRecord({ analytics: true }, CFG, 'settings', true, NOW);
    assert.equal(override.gpc_override, true);
    assert.equal(consent.decide({ config: CFG, stored: override, gpc: true, now: NOW }).categories.analytics, true);
});

test('decide: cambiar la versión o vencer el plazo vuelve a pedir el consentimiento', () => {
    const acc = consent.buildRecord({ analytics: true }, CFG, 'banner', false, NOW);
    const v3 = consent.normalizeConfig({ version: 'v3' });
    assert.equal(consent.decide({ config: v3, stored: acc, now: NOW }).showBanner, true);
    assert.equal(consent.decide({ config: v3, stored: acc, now: NOW }).categories.analytics, false);
    const later = new Date(NOW.getTime() + 366 * 86400000);
    assert.equal(consent.decide({ config: CFG, stored: acc, now: later }).showBanner, true);
});

test('decide: banner desactivado no equivale a consentir', () => {
    const off = consent.normalizeConfig({ enabled: false, version: 'v2' });
    const d = consent.decide({ config: off, stored: null, now: NOW });
    assert.equal(d.showBanner, false);
    assert.equal(d.categories.analytics, false);
});

test('registro: localStorage y cookie con versión y fecha, ida y vuelta', () => {
    const rec = consent.buildRecord({ analytics: true, marketing: false, necessary: false }, CFG, 'banner', false, NOW);
    assert.deepEqual(rec.categories, { necessary: true, analytics: true, marketing: false });
    assert.equal(rec.version, 'v2');
    assert.equal(rec.decided_at, NOW.toISOString());
    assert.deepEqual(consent.parseStored(JSON.stringify(rec)).categories, rec.categories);
    assert.equal(consent.parseStored('{"version":"v2"}'), null);
    const cookie = consent.cookieString(rec, { renewDays: 365, secure: true });
    assert.match(cookie, /^wo_consent=v2~a1m0~\d+; Max-Age=31536000; Path=\/; SameSite=Lax; Secure$/);
    const back = consent.parseCookieValue(consent.cookieValue(rec));
    assert.equal(back.version, 'v2');
    assert.equal(back.categories.analytics, true);
    assert.equal(consent.isCurrent(back, CFG, NOW), true);
});

test('scriptsToLoad: solo con consentimiento de la categoría y fuera de rutas excluidas', () => {
    const on = { necessary: true, analytics: true, marketing: false };
    assert.equal(consent.scriptsToLoad(CFG, { necessary: true, analytics: false }, '/explore/', '').length, 0);
    assert.equal(consent.scriptsToLoad(CFG, on, '/explore/', '').length, 1);
    assert.equal(consent.scriptsToLoad(CFG, on, '/backoffice/', '').length, 0);
    assert.equal(consent.scriptsToLoad(CFG, on, '/beta/backoffice', '/beta').length, 0);
    const bad = consent.normalizeConfig({ scripts: [{ id: 'x', type: 'clarity', category: 'analytics', project_id: '"><script>' }] });
    assert.equal(consent.scriptsToLoad(bad, on, '/', '').length, 0);
});

/* --------------------------------- cableado --------------------------------- */

test('todas las páginas cargan wo-consent.js y ninguna carga Clarity por su cuenta', () => {
    const pages = htmlPages();
    assert.ok(pages.length >= 50, 'se recorrieron las páginas de public/');
    for (const p of pages) {
        const html = fs.readFileSync(p, 'utf8');
        const rel = path.relative(root, p);
        assert.equal((html.match(/\/shared\/js\/wo-consent\.js/g) || []).length, 1, rel + ' incluye wo-consent.js una vez');
        assert.ok(html.indexOf('/shared/js/wo-consent.js') < html.search(/<\/head>/i), rel + ' lo incluye en el <head>');
        assert.doesNotMatch(html, /clarity\.ms|CLARITY_PROJECT_ID/, rel + ' no carga Clarity sin consentimiento');
    }
    const js = read('public/shared/js/wo-consent.js');
    assert.match(js, /https:\/\/www\.clarity\.ms\/tag\//);
    assert.match(js, /globalPrivacyControl/);
    assert.match(js, /\/api\/privacy\/cookie-config/);
});

test('el pie de página y la política permiten reabrir la configuración (#cookies existe)', () => {
    assert.match(read('public/shared/js/ds/organisms.js'), /data-wo-cookie-settings>Configuración de cookies/);
    const policy = read('public/legal/privacy/index.html');
    assert.match(policy, /<h2 id="cookies">/);
    assert.match(policy, /data-wo-cookie-settings/);
    assert.match(policy, /Global Privacy Control/);
    assert.doesNotMatch(policy, /ip-api\.com/);
    assert.match(read('public/shared/js/wo-consent.js'), /policy_url: '\/legal\/privacy#cookies'/);
});

test('backoffice: sección Cookies y privacidad y endpoints protegidos', () => {
    const bo = read('public/backoffice/index.html');
    assert.match(bo, /data-section="privacy"/);
    assert.match(bo, /id="section-privacy"/);
    assert.match(bo, /\/shared\/js\/backoffice-privacy\.js/);
    assert.match(read('public/shared/js/admin.js'), /sectionId === 'privacy'/);
    const server = read('server.js');
    assert.match(server, /app\.get\('\/api\/privacy\/cookie-config'/);
    for (const route of ["app.get('/api/admin/privacy/cookie-config'", "app.put('/api/admin/privacy/cookie-config'"]) {
        const i = server.indexOf(route);
        assert.ok(i > 0, route);
        assert.match(server.slice(i, i + 300), /verifyAdminCaller\(req\)/, route + ' exige superadmin');
    }
    const post = server.indexOf("app.post('/api/privacy/cookie-consent'");
    assert.match(server.slice(post, post + 300), /resolveBearerUser\(req\)/);
});

test('migración aditiva con RLS, RPC solo service_role y reversa', () => {
    const sql = read('supabase/migrations/20261113105000_privacidad_cookie_consent.sql');
    assert.match(sql, /create table if not exists public\.cookie_consent_log/);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /security definer/);
    assert.match(sql, /revoke all on function public\.record_cookie_consent\(uuid, jsonb\) from public, anon, authenticated/);
    assert.match(sql, /grant execute on function public\.record_cookie_consent\(uuid, jsonb\) to service_role/);
    assert.doesNotMatch(sql, /\bdrop table\b|\balter table [a-z_.]+ drop\b/i);
    const down = read('supabase/rollbacks/20261113105000_privacidad_cookie_consent.down.sql');
    assert.match(down, /drop function if exists public\.record_cookie_consent/);
    assert.match(down, /drop table if exists public\.cookie_consent_log/);
});
