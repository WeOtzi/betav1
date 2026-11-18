'use strict';

// Huellas de identificadores baneados (lib/ban-identifiers.js, 2.7.0):
// normalización de correo, teléfono e Instagram, HMAC con clave y falla abierta.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const B = require('../lib/ban-identifiers');

const KEY = crypto.randomBytes(32).toString('base64');
const OTHER_KEY = crypto.randomBytes(32).toString('base64');
const ENV = { BAN_HMAC_KEY: KEY };

function quiet(fn) {
    const warn = console.warn;
    const calls = [];
    console.warn = (...args) => calls.push(args.join(' '));
    try { return { result: fn(), calls }; } finally { console.warn = warn; }
}

test('correo: minúsculas, sin +etiqueta y sin puntos en gmail/googlemail', () => {
    assert.equal(B.normalizeEmail('  Mateo.Rivas+tattoo@Gmail.com '), 'mateorivas@gmail.com');
    assert.equal(B.normalizeEmail('m.a.t.e.o@googlemail.com'), 'mateo@gmail.com', 'googlemail es el mismo buzón');
    assert.equal(B.normalizeEmail('Lucia.F+promo@Example.COM'), 'lucia.f@example.com', 'fuera de gmail los puntos cuentan');
    assert.equal(B.normalizeEmail('hola@estudio.com.ar'), 'hola@estudio.com.ar');
    for (const bad of ['', null, undefined, 'sin-arroba', '@example.com', 'a@b', '+tag@gmail.com', 'a b@c.com']) {
        assert.equal(B.normalizeEmail(bad), null, String(bad));
    }
});

test('teléfono Argentina: 54 + 9 de celular, sin 0 ni 15', () => {
    const canonical = '+5491122223333';
    for (const raw of ['011 15 2222-3333', '01115 2222 3333', '11 2222 3333', '9 11 2222 3333', '54 9 11 2222 3333', '5411 2222 3333', '(011) 2222-3333']) {
        assert.equal(B.normalizePhone(raw, 'AR'), canonical, raw);
    }
    assert.equal(B.normalizePhone('0351 15 123-4567', 'AR'), '+5493511234567', 'Córdoba: área de 3 dígitos');
    assert.equal(B.normalizePhone('02944 15 123456', 'AR'), '+5492944123456', 'Bariloche: área de 4 dígitos');
    assert.equal(B.normalizePhone('11 2222 3333', 'Argentina'), canonical, 'acepta el nombre del país del perfil');
    assert.equal(B.normalizePhone('+54 9 11 2222-3333'), canonical, 'con + no necesita país');
    assert.equal(B.normalizePhone('+54 11 2222 3333'), canonical, '+54 sin el 9 de celular se normaliza igual');
    assert.equal(B.normalizePhone('0054 9 11 2222 3333'), canonical, '00 equivale a +');
    assert.equal(B.normalizePhone('123', 'AR'), null);
    assert.equal(B.normalizePhone('011 99 2222 3333', 'AR'), null, '12 dígitos sin 15 no cierra');
});

test('teléfono España y Estados Unidos; desconocido → null', () => {
    assert.equal(B.normalizePhone('612 345 678', 'ES'), '+34612345678');
    assert.equal(B.normalizePhone('34 612345678', 'España'), '+34612345678');
    assert.equal(B.normalizePhone('512 345 678', 'ES'), null, 'en España empieza por 6-9');
    assert.equal(B.normalizePhone('(415) 555-0123', 'US'), '+14155550123');
    assert.equal(B.normalizePhone('1 415 555 0123', 'United States'), '+14155550123');
    assert.equal(B.normalizePhone('415 555 0123', 'Estados Unidos'), '+14155550123');
    assert.equal(B.normalizePhone('415 555 0123', 'MX'), null, 'sin + y país sin regla → no se compara');
    assert.equal(B.normalizePhone('415 555 0123'), null);
    assert.equal(B.normalizePhone('+52 55 1234 5678'), '+525512345678', 'con + vale cualquier país');
    assert.equal(B.normalizePhone('+12 34'), null, '+ fuera de /^\\+\\d{8,15}$/');
    assert.equal(B.normalizePhone('+1234567890123456'), null);
    assert.equal(B.normalizePhone('+54 abc'), null);
});

test('Instagram: sin @, sin URL y en minúsculas', () => {
    assert.equal(B.normalizeInstagram('@Mateo.Ink'), 'mateo.ink');
    assert.equal(B.normalizeInstagram('https://www.instagram.com/Mateo.Ink/'), 'mateo.ink');
    assert.equal(B.normalizeInstagram('instagram.com/mateo_ink?igsh=abc'), 'mateo_ink');
    assert.equal(B.normalizeInstagram('http://instagr.am/mateo.ink'), 'mateo.ink');
    assert.equal(B.normalizeInstagram('https://instagram.com/p/C0abc/'), null, 'un post no es un perfil');
    assert.equal(B.normalizeInstagram('https://evil.example/mateo'), null);
    assert.equal(B.normalizeInstagram('mateo ink'), null);
    assert.equal(B.normalizeInstagram('a'.repeat(31)), null);
    assert.equal(B.normalizeInstagram(''), null);
});

test('HMAC: estable, depende de la clave y del tipo; hex de 64', () => {
    const a = B.hmacIdentifier('email', 'mateorivas@gmail.com', ENV);
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(B.hmacIdentifier('email', 'mateorivas@gmail.com', ENV), a, 'estable');
    assert.notEqual(B.hmacIdentifier('email', 'mateorivas@gmail.com', { BAN_HMAC_KEY: OTHER_KEY }), a, 'otra clave, otra huella');
    assert.notEqual(B.hmacIdentifier('instagram', 'mateorivas@gmail.com', ENV), a, 'el tipo entra en el HMAC');
    const expected = crypto.createHmac('sha256', Buffer.from(KEY, 'base64')).update('email:mateorivas@gmail.com').digest('hex');
    assert.equal(a, expected, 'HMAC-SHA256 de kind:normalizado');
    assert.equal(B.hmacIdentifier('pasaporte', 'x', ENV), null, 'tipo desconocido');
    assert.equal(B.hmacIdentifier('email', '', ENV), null);
});

test('identifiersFor: normaliza, deduplica y omite lo que no se puede normalizar', () => {
    const list = B.identifiersFor({
        email: 'Mateo.Rivas+x@gmail.com',
        phone: ['011 15 2222-3333', '+54 9 11 2222 3333', 'basura'],
        instagram: ['@mateo.ink', 'https://instagram.com/mateo.ink/', 'https://instagram.com/estudio.norte'],
        country: 'AR'
    }, ENV);
    assert.deepEqual(list.map((i) => i.kind), ['email', 'phone', 'instagram', 'instagram']);
    assert.ok(list.every((i) => /^[0-9a-f]{64}$/.test(i.value_hmac)));
    assert.equal(list[0].value_hmac, B.hmacIdentifier('email', 'mateorivas@gmail.com', ENV));
    // Escrito distinto, misma huella.
    const again = B.identifiersFor({ email: 'mateorivas@googlemail.com', phone: '1122223333', instagram: 'MATEO.INK', country: 'Argentina' }, ENV);
    assert.deepEqual(again.map((i) => i.value_hmac), [list[0].value_hmac, list[1].value_hmac, list[2].value_hmac]);
    assert.ok(!JSON.stringify(list).includes('mateo'), 'sin valores en claro');
});

test('falla abierta: sin clave (o inválida) no hay huellas y avisa una sola vez', () => {
    B._internal.resetWarning();
    for (const env of [{}, { BAN_HMAC_KEY: '' }, { BAN_HMAC_KEY: 'corta' }, { BAN_HMAC_KEY: crypto.randomBytes(16).toString('base64') }]) {
        assert.equal(B.isConfigured(env), false);
    }
    const { result, calls } = quiet(() => [
        B.identifiersFor({ email: 'a@b.com' }, {}),
        B.hmacIdentifier('email', 'a@b.com', {}),
        B.identifiersFor({ email: 'a@b.com' }, { BAN_HMAC_KEY: 'corta' })
    ]);
    assert.deepEqual(result, [[], null, []]);
    assert.equal(calls.length, 1, 'un solo aviso en el log');
    assert.doesNotMatch(calls[0], /a@b\.com|corta/, 'el aviso no lleva valores');
    assert.equal(B.isConfigured(ENV), true);
    assert.equal(B.isConfigured({ BAN_HMAC_KEY: KEY.replace(/\+/g, '-').replace(/\//g, '_') }), true, 'acepta base64 url-safe');
    assert.equal(B.deriveKey('appeal', {}), null);
    assert.equal(B.deriveKey('appeal', ENV).length, 32);
    assert.notDeepEqual(B.deriveKey('appeal', ENV), B.deriveKey('otro', ENV));
});
