const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.resolve(__dirname, '..', 'public');

test('artist login poster carries the closed-beta invitation from registration', () => {
    const login = fs.readFileSync(path.join(publicDir, 'artist/login/index.html'), 'utf8');
    const registration = fs.readFileSync(path.join(publicDir, 'registerclosedbeta/index.html'), 'utf8');
    const poster = login.match(/<aside class="wo-auth-poster"[\s\S]*?<\/aside>/)?.[0];

    assert.ok(poster, 'artist login has a poster');
    for (const message of [
        '[ Acceso anticipado · beta cerrada ]',
        'El artista merece más apoyo y menos complicaciones. Crecer y conectar — gratis para siempre.'
    ]) {
        assert.ok(registration.includes(message), `registration contains ${message}`);
        assert.ok(poster.includes(message), `login poster contains ${message}`);
    }
});
