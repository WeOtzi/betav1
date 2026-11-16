'use strict';

// Ronda 2 · frente push · lib/web-push.js
// Web Push sin dependencias: cifrado aes128gcm (RFC 8291, vector del apéndice A),
// VAPID (RFC 8292, JWT ES256) y envío al endpoint con lista blanca de hosts.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const webPush = require('../lib/web-push');

// ---------------------------------------------------------------- RFC 8291 · apéndice A
const RFC8291 = {
    plaintext: 'When I grow up, I want to be a watermelon',
    asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
    ecdhSecret: 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs',
    ikm: 'S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg',
    cek: 'oIhVW04MRdy2XN9CiKLxTg',
    nonce: '4h_95klXJ5E_qnoN',
    header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
    // Cuerpo completo del ejemplo de la sección 5 (cabecera + texto cifrado).
    body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
};
const b = (value) => webPush.fromB64url(value);

test('RFC 8291 apéndice A: valores intermedios (ECDH, IKM, CEK y NONCE)', () => {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(b(RFC8291.asPrivate));
    assert.equal(webPush.b64url(ecdh.getPublicKey()), RFC8291.asPublic);
    const secret = ecdh.computeSecret(b(RFC8291.uaPublic));
    assert.equal(webPush.b64url(secret), RFC8291.ecdhSecret);

    const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'ascii'), b(RFC8291.uaPublic), b(RFC8291.asPublic)]);
    const ikm = webPush.hkdf(b(RFC8291.authSecret), secret, keyInfo, 32);
    assert.equal(webPush.b64url(ikm), RFC8291.ikm);
    assert.equal(webPush.b64url(webPush.hkdf(b(RFC8291.salt), ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'ascii'), 16)), RFC8291.cek);
    assert.equal(webPush.b64url(webPush.hkdf(b(RFC8291.salt), ikm, Buffer.from('Content-Encoding: nonce\0', 'ascii'), 12)), RFC8291.nonce);
});

test('RFC 8291 apéndice A: el cuerpo cifrado se reproduce byte a byte', () => {
    const out = webPush.encryptPayload(
        { p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret },
        RFC8291.plaintext,
        { salt: b(RFC8291.salt), localPrivateKey: b(RFC8291.asPrivate) }
    );
    assert.equal(out.body.length, 144, '86 de cabecera + 42 de texto con relleno + 16 de etiqueta');
    assert.equal(webPush.b64url(out.body.subarray(0, 86)), RFC8291.header);
    assert.equal(webPush.b64url(out.body.subarray(86)), RFC8291.ciphertext);
    assert.equal(webPush.b64url(out.body), RFC8291.body);
    // Cabecera: salt (16) + rs=4096 (4) + idlen=65 (1) + clave pública del servidor.
    assert.equal(out.body.readUInt32BE(16), 4096);
    assert.equal(out.body.readUInt8(20), 65);
    assert.equal(webPush.b64url(out.localPublicKey), RFC8291.asPublic);
});

test('el navegador (clave privada del apéndice A) descifra el vector y un mensaje nuevo', () => {
    const fromRfc = webPush.decryptPayload({ privateKey: RFC8291.uaPrivate, auth: RFC8291.authSecret }, b(RFC8291.body));
    assert.equal(fromRfc.toString('utf8'), RFC8291.plaintext);

    const payload = JSON.stringify({ title: 'Mateo te escribió', body: 'Tienes un mensaje nuevo · ñ á ü', url: '/client/chats?quote=WO-1' });
    const first = webPush.encryptPayload({ p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret }, payload);
    const second = webPush.encryptPayload({ p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret }, payload);
    assert.equal(webPush.decryptPayload({ privateKey: RFC8291.uaPrivate, auth: RFC8291.authSecret }, first.body).toString('utf8'), payload);
    // Salt y clave efímera nuevos en cada mensaje: nunca dos cuerpos iguales.
    assert.notEqual(webPush.b64url(first.body), webPush.b64url(second.body));
    assert.notEqual(webPush.b64url(first.salt), webPush.b64url(second.salt));
    assert.notEqual(webPush.b64url(first.localPublicKey), webPush.b64url(second.localPublicKey));
});

test('cifrado: rechaza claves de suscripción inválidas y cuerpos que no entran en un registro', () => {
    assert.throws(() => webPush.encryptPayload({ p256dh: 'AAAA', auth: RFC8291.authSecret }, 'x'), /p256dh/);
    assert.throws(() => webPush.encryptPayload({ p256dh: RFC8291.uaPublic, auth: 'AAAA' }, 'x'), /auth/);
    assert.equal(webPush.MAX_PLAINTEXT, 4096 - 86 - 16 - 1);
    assert.throws(() => webPush.encryptPayload({ p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret }, 'x'.repeat(webPush.MAX_PLAINTEXT + 1)), /máximo/);
    const max = webPush.encryptPayload({ p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret }, 'x'.repeat(webPush.MAX_PLAINTEXT));
    assert.equal(max.body.length, 4096, 'los servicios push aceptan hasta 4096 bytes');
});

// ---------------------------------------------------------------- RFC 8292 · VAPID
const RFC8292 = {
    token: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJodHRwczovL3B1c2guZXhhbXBsZS5uZXQiLCJleHAiOjE0NTM1MjM3NjgsInN1YiI6Im1haWx0bzpwdXNoQGV4YW1wbGUuY29tIn0.i3CYb7t4xfxCDquptFOepC9GAu_HLGkMlMuCGSK2rpiUfnK9ojFwDXb1JrErtmysazNjjvW2L9OkSSHzvoD1oA',
    publicKey: 'BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs'
};

test('RFC 8292 §2.4: el JWT de ejemplo verifica con su clave pública (firma r||s de JOSE)', () => {
    const result = webPush.verifyVapidJwt(RFC8292.token, RFC8292.publicKey);
    assert.equal(result.ok, true);
    assert.deepEqual(result.header, { typ: 'JWT', alg: 'ES256' });
    assert.deepEqual(result.claims, { aud: 'https://push.example.net', exp: 1453523768, sub: 'mailto:push@example.com' });
    // Un byte cambiado en los claims o en la firma ya no verifica.
    const [h, c, s] = RFC8292.token.split('.');
    const forged = webPush.b64url(JSON.stringify({ aud: 'https://evil.example', exp: 1453523768, sub: 'mailto:push@example.com' }));
    assert.equal(webPush.verifyVapidJwt(`${h}.${forged}.${s}`, RFC8292.publicKey).ok, false);
    assert.equal(webPush.verifyVapidJwt(`${h}.${c}.${s.slice(0, -2)}AA`, RFC8292.publicKey).ok, false);
    assert.equal(webPush.verifyVapidJwt(RFC8292.token, RFC8291.asPublic).ok, false, 'otra clave pública no verifica');
});

test('VAPID: el JWT propio es ES256, con aud = origen del endpoint, exp ≤ 24 h y sub de contacto', () => {
    const keys = webPush.generateVapidKeys();
    assert.equal(webPush.fromB64url(keys.publicKey).length, 65);
    assert.equal(webPush.fromB64url(keys.privateKey).length, 32);
    const vapid = webPush.loadVapidConfig({ publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:soporte@example.com' });
    assert.equal(vapid.ok, true);

    const token = webPush.createVapidJwt({ audience: 'https://fcm.googleapis.com', subject: vapid.subject, signingKey: vapid.signingKey });
    const [header, , signature] = token.split('.');
    assert.equal(header, 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9', 'misma cabecera que el ejemplo del RFC');
    assert.equal(webPush.fromB64url(signature).length, 64, 'firma cruda r||s, no DER');
    const verified = webPush.verifyVapidJwt(token, keys.publicKey);
    assert.equal(verified.ok, true);
    assert.equal(verified.claims.aud, 'https://fcm.googleapis.com');
    assert.equal(verified.claims.sub, 'mailto:soporte@example.com');
    const now = Math.floor(Date.now() / 1000);
    assert.ok(verified.claims.exp > now && verified.claims.exp <= now + 24 * 60 * 60, 'RFC 8292: exp a no más de 24 h');
    assert.equal(webPush.verifyVapidJwt(token, webPush.generateVapidKeys().publicKey).ok, false);

    const auth = webPush.vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid);
    assert.match(auth, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/);
    assert.ok(auth.endsWith(`k=${keys.publicKey}`));
    assert.equal(webPush.vapidAuthorization('https://fcm.googleapis.com/fcm/send/otro', vapid), auth, 'el JWT se reutiliza por origen');
});

test('VAPID: sin claves queda apagado; claves incompletas, cruzadas o contacto inválido no pasan', () => {
    const keys = webPush.generateVapidKeys();
    const other = webPush.generateVapidKeys();
    assert.deepEqual(webPush.loadVapidConfig({}), { ok: false, reason: 'missing_keys' });
    assert.equal(webPush.loadVapidConfig({ publicKey: keys.publicKey }).reason, 'incomplete_keys');
    assert.equal(webPush.loadVapidConfig({ publicKey: 'abc', privateKey: keys.privateKey, subject: 'mailto:a@b.co' }).reason, 'invalid_public_key');
    assert.equal(webPush.loadVapidConfig({ publicKey: keys.publicKey, privateKey: 'abc', subject: 'mailto:a@b.co' }).reason, 'invalid_private_key');
    assert.equal(webPush.loadVapidConfig({ publicKey: keys.publicKey, privateKey: other.privateKey, subject: 'mailto:a@b.co' }).reason, 'key_mismatch');
    assert.equal(webPush.loadVapidConfig({ ...keys, subject: 'soporte' }).reason, 'invalid_subject');
    assert.equal(webPush.loadVapidConfig({ ...keys, subject: 'http://inseguro.example' }).reason, 'invalid_subject');
    assert.equal(webPush.loadVapidConfig({ ...keys, subject: 'https://beta.weotzi.com' }).ok, true);

    assert.equal(webPush.isConfigured({}), false);
    assert.equal(webPush.isConfigured({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }), true, 'el contacto cae a PUBLIC_APP_URL / beta');
    assert.equal(webPush.vapidFromEnv({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, SUPPORT_EMAIL: 'ayuda@example.com' }).subject, 'mailto:ayuda@example.com');
});

// ---------------------------------------------------------------- endpoint (anti SSRF)
test('solo se envía a servicios push conocidos, por https y sin credenciales', () => {
    for (const ok of [
        'https://fcm.googleapis.com/fcm/send/abc123',
        'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
        'https://wns2-par02p.notify.windows.com/w/?token=abc',
        'https://web.push.apple.com/QGk9'
    ]) assert.equal(webPush.isAllowedEndpoint(ok, {}), true, ok);
    for (const bad of [
        'http://fcm.googleapis.com/fcm/send/abc',
        'https://fcm.googleapis.com.evil.example/fcm/send/abc',
        'https://evilfcm.googleapis.com.example/x',
        'https://user:pass@fcm.googleapis.com/fcm/send/abc',
        'https://fcm.googleapis.com:8443/fcm/send/abc',
        'https://localhost/x', 'https://169.254.169.254/latest/meta-data', 'https://10.0.0.5/x',
        'file:///etc/passwd', 'javascript:alert(1)', '', null, 42, `https://fcm.googleapis.com/${'a'.repeat(2100)}`
    ]) assert.equal(webPush.isAllowedEndpoint(bad, {}), false, String(bad).slice(0, 60));
    assert.equal(webPush.isAllowedEndpoint('https://push.vivaldi.example/x', {}), false);
    assert.equal(webPush.isAllowedEndpoint('https://push.vivaldi.example/x', { PUSH_ALLOWED_HOSTS: 'vivaldi.example, otro.example' }), true);
});

test('normalizeSubscription exige endpoint permitido y claves con la forma del navegador', () => {
    const good = { endpoint: ' https://fcm.googleapis.com/fcm/send/abc ', keys: { p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret } };
    assert.deepEqual(webPush.normalizeSubscription(good, {}), {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret
    });
    // base64 clásico (con + / =) se normaliza a base64url sin relleno.
    const classic = Buffer.from(b(RFC8291.uaPublic)).toString('base64');
    assert.equal(webPush.normalizeSubscription({ ...good, keys: { p256dh: classic, auth: `${RFC8291.authSecret}==` } }, {}).p256dh, RFC8291.uaPublic);
    assert.equal(webPush.normalizeSubscription({ ...good, endpoint: 'https://evil.example/x' }, {}), null);
    assert.equal(webPush.normalizeSubscription({ ...good, keys: { p256dh: 'corta', auth: RFC8291.authSecret } }, {}), null);
    assert.equal(webPush.normalizeSubscription({ ...good, keys: { p256dh: RFC8291.uaPublic, auth: 'x' } }, {}), null);
    assert.equal(webPush.normalizeSubscription(null, {}), null);
    assert.equal(webPush.normalizeSubscription({ endpoint: good.endpoint }, {}), null);
});

// ---------------------------------------------------------------- envío
function vapidPair() {
    const keys = webPush.generateVapidKeys();
    return { keys, vapid: webPush.loadVapidConfig({ ...keys, subject: 'mailto:soporte@example.com' }) };
}
const SUBSCRIPTION = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret };

test('sendNotification: POST cifrado con VAPID, TTL, Urgency y Topic; el navegador lo descifra', async () => {
    const { keys, vapid } = vapidPair();
    const calls = [];
    const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { status: 201 }; };
    const payload = { id: 'n1', title: 'Nueva solicitud', body: 'Lucía pidió una cotización', url: '/my-quotations/detail?id=WO-1', tag: 'quote:WO-1' };
    const result = await webPush.sendNotification(SUBSCRIPTION, payload, { vapid, fetchImpl, ttl: 3600, urgency: 'high', topic: 'quote:WO-1' });
    assert.deepEqual(result, { ok: true, status: 201, gone: false });
    assert.equal(calls.length, 1);
    const { url, opts } = calls[0];
    assert.equal(url, SUBSCRIPTION.endpoint);
    assert.equal(opts.method, 'POST');
    assert.equal(opts.redirect, 'error', 'un servicio push nunca redirige: no se sigue a otro host');
    assert.equal(opts.headers['Content-Encoding'], 'aes128gcm');
    assert.equal(opts.headers.TTL, '3600');
    assert.equal(opts.headers.Urgency, 'high');
    assert.match(opts.headers.Topic, /^[A-Za-z0-9_-]{1,32}$/);
    assert.equal(opts.headers['Content-Type'], 'application/octet-stream');
    assert.ok(Buffer.isBuffer(opts.body) && opts.body.length > 86 + 16);
    const match = /^vapid t=([\w.-]+), k=([\w-]+)$/.exec(opts.headers.Authorization);
    assert.ok(match);
    assert.equal(match[2], keys.publicKey);
    const jwt = webPush.verifyVapidJwt(match[1], keys.publicKey);
    assert.equal(jwt.ok, true);
    assert.equal(jwt.claims.aud, 'https://fcm.googleapis.com');
    const plain = webPush.decryptPayload({ privateKey: RFC8291.uaPrivate, auth: RFC8291.authSecret }, opts.body);
    assert.deepEqual(JSON.parse(plain.toString('utf8')), payload);
});

test('sendNotification: 404/410 marcan la suscripción como vencida; 5xx y red no la borran', async () => {
    const { vapid } = vapidPair();
    const send = (status) => webPush.sendNotification(SUBSCRIPTION, { title: 'x' }, { vapid, fetchImpl: async () => ({ status }) });
    assert.deepEqual(await send(410), { ok: false, status: 410, gone: true });
    assert.deepEqual(await send(404), { ok: false, status: 404, gone: true });
    assert.deepEqual(await send(500), { ok: false, status: 500, gone: false });
    assert.deepEqual(await send(429), { ok: false, status: 429, gone: false });
    const offline = await webPush.sendNotification(SUBSCRIPTION, { title: 'x' }, { vapid, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
    assert.deepEqual(offline, { ok: false, status: 0, gone: false, error: 'network_error' });
});

test('sendNotification: sin VAPID o con un endpoint fuera de la lista no toca la red', async () => {
    const { vapid } = vapidPair();
    let called = 0;
    const fetchImpl = async () => { called += 1; return { status: 201 }; };
    const off = await webPush.sendNotification(SUBSCRIPTION, { title: 'x' }, { vapid: { ok: false, reason: 'missing_keys' }, fetchImpl });
    assert.equal(off.ok, false);
    assert.equal(off.error, 'push_not_configured');
    const ssrf = await webPush.sendNotification({ ...SUBSCRIPTION, endpoint: 'https://169.254.169.254/latest' }, { title: 'x' }, { vapid, fetchImpl });
    assert.deepEqual(ssrf, { ok: false, status: 0, gone: true, error: 'endpoint_not_allowed' });
    const broken = await webPush.sendNotification({ ...SUBSCRIPTION, p256dh: 'AAAA' }, { title: 'x' }, { vapid, fetchImpl });
    assert.equal(broken.ok, false);
    assert.equal(broken.gone, true, 'claves corruptas: la suscripción no sirve más');
    assert.equal(called, 0);
});

test('lib/web-push.js no agrega dependencias: solo node:crypto', () => {
    const src = require('node:fs').readFileSync(require.resolve('../lib/web-push'), 'utf8');
    const requires = [...src.matchAll(/require\('([^']+)'\)/g)].map(m => m[1]);
    assert.deepEqual([...new Set(requires)], ['node:crypto']);
    const pkg = require('../package.json');
    assert.equal(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some(name => /web-?push/i.test(name)), false);
});
