const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const registerJs = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'shared', 'js', 'register.js'),
    'utf8'
);
const emailClientJs = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'shared', 'js', 'email-client.js'),
    'utf8'
);
const instagramImportJs = fs.readFileSync(
    path.resolve(__dirname, '..', 'lib', 'instagram-import.js'),
    'utf8'
);

test('artist registration loader waits ten seconds without blocking on transactional email dispatch', () => {
    assert.match(registerJs, /const MIN_REGISTRATION_WAIT_MS = 10000;/);
    assert.match(registerJs, /function sendArtistRegistrationCompletedEvent\(payload\)/);
    assert.match(registerJs, /window\.EmailClient\.sendEmail\(eventId,\s*payload,\s*\{[\s\S]*keepalive:\s*true/);
    assert.doesNotMatch(
        registerJs,
        /await\s+window\.ConfigManager\.sendN8NEvent\('artist_registration_completed'/,
        'artist registration completed email must stay off the loader critical path'
    );
});

test('email client supports unload-safe background dispatch', () => {
    assert.match(emailClientJs, /const requestBody = JSON\.stringify\(\{ data: payload \|\| \{\} \}\);/);
    assert.match(emailClientJs, /const useKeepalive = !!opts\.keepalive && requestBody\.length <= 60000;/);
    assert.match(emailClientJs, /keepalive:\s*useKeepalive/);
});

test('instagram media commit caps slow CDN and storage calls', () => {
    assert.match(instagramImportJs, /const IG_MEDIA_DOWNLOAD_TIMEOUT_MS = envPositiveInt\('IG_MEDIA_DOWNLOAD_TIMEOUT_MS',\s*10000\);/);
    assert.match(instagramImportJs, /const IG_STORAGE_UPLOAD_TIMEOUT_MS = envPositiveInt\('IG_STORAGE_UPLOAD_TIMEOUT_MS',\s*10000\);/);
    assert.match(instagramImportJs, /MEDIA_DOWNLOAD_TIMEOUT/);
    assert.match(instagramImportJs, /STORAGE_UPLOAD_TIMEOUT/);
});
