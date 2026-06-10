const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const serverPath = path.join(repoRoot, 'server.js');
const source = fs.readFileSync(serverPath, 'utf8');

function studioNotifyRoute() {
    const start = source.indexOf("app.post('/api/studio/notify'");
    assert.notEqual(start, -1, 'studio notify route must exist');
    const end = source.indexOf('function roleFromKind', start);
    assert.notEqual(end, -1, 'roleFromKind should follow the studio notify route');
    return source.slice(start, end);
}

test('studio notify requires a Supabase bearer user before building payloads', () => {
    const route = studioNotifyRoute();
    const authIndex = route.indexOf('const authUser = await _getAuthUserFromBearer(req);');
    const payloadIndex = route.indexOf('let payload = null;');

    assert.ok(authIndex > -1, 'route must resolve the caller from Authorization: Bearer');
    assert.ok(payloadIndex > -1, 'route must build server-side payloads');
    assert.ok(authIndex < payloadIndex, 'auth must happen before payload creation');
    assert.match(route, /return res\.status\(401\)\.json\(\{ success: false, error: 'Authentication required' \}\)/);
});

test('studio notify validates spot decision values', () => {
    const route = studioNotifyRoute();

    assert.match(route, /!\['accepted', 'rejected'\]\.includes\(decision\)/);
    assert.match(route, /decision invalida/);
});

test('studio notify checks studio ownership for each notification kind', () => {
    const route = studioNotifyRoute();
    const checks = route.match(/const access = await _verifyStudioNotifyAccess\(req, studio, authUser\)/g) || [];

    assert.equal(checks.length, 2, 'spot decisions and roster invites must both verify ownership');
    assert.match(source, /async function _verifyStudioNotifyAccess\(req, studio, authUser\)/);
    assert.match(source, /ownerUserId && authUser\?\.id && ownerUserId === String\(authUser\.id\)/);
    assert.match(source, /Studio ownership required/);
});
