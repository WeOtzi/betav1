const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const expectedWhatsapp = '+541127015926';
const staleWhatsapp = '+541162079567';

function read(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('we otzi whatsapp number is updated across config and frontend fallbacks', () => {
    const appConfig = JSON.parse(read(path.join('public', 'shared', 'js', 'app-config.json')));
    assert.equal(appConfig.weOtzi.whatsapp, expectedWhatsapp);

    const filesToCheck = [
        path.join('public', 'shared', 'js', 'config-manager.js'),
        path.join('public', 'shared', 'js', 'main.js'),
        path.join('public', 'shared', 'js', 'dashboard.js'),
        path.join('public', 'shared', 'js', 'artist-profile.js')
    ];

    for (const relativePath of filesToCheck) {
        const source = read(relativePath);
        assert.ok(
            source.includes(expectedWhatsapp),
            `${relativePath} should reference the updated WhatsApp number`
        );
        assert.equal(
            source.includes(staleWhatsapp),
            false,
            `${relativePath} should not reference the stale WhatsApp number`
        );
    }
});
