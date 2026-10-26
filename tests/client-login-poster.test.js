const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.resolve(__dirname, '..', 'public');

test('client login dark poster shows the closed-beta label and free-forever line', () => {
    const login = fs.readFileSync(path.join(publicDir, 'client/login/index.html'), 'utf8');
    const poster = login.match(/<aside class="ca-hero"[\s\S]*?<\/aside>/)?.[0];

    assert.ok(poster, 'client login has a dark poster');
    assert.match(poster, /\[ Acceso anticipado · beta cerrada \]/);
    assert.match(poster, /gratis para siempre/);
});
