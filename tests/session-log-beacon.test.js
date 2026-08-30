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
