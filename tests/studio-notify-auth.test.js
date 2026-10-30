const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const serverPath = path.join(repoRoot, 'server.js');
// Normalizado a LF: el checkout en Windows (autocrlf) deja CRLF.
const source = fs.readFileSync(serverPath, 'utf8').split('\r\n').join('\n');

function studioNotifyRoute() {
    const start = source.indexOf("app.post('/api/studio/notify'");
    assert.notEqual(start, -1, 'studio notify route must exist');
    const end = source.indexOf('function roleFromKind', start);
    assert.notEqual(end, -1, 'roleFromKind should follow the studio notify route');
    return source.slice(start, end);
}

// Cada rama `if (kind === ...)` de la ruta, hasta la siguiente.
function kindBranches(route) {
    const marker = /\n {8}if \(kind === '/g;
    const starts = [];
    let match;
    while ((match = marker.exec(route))) starts.push(match.index);
    return starts.map((start, i) => route.slice(start, starts[i + 1] ?? route.indexOf('const result = await _sendStudioPlatformEmail(payload);')));
}

const STUDIO_KINDS = [
    'spot_decision', 'roster_invite', 'membership_request_decision',
    'contract_issued', 'contract_terminated', 'booking_created', 'booking_cancelled'
];

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

test('studio notify accepts exactly the contract kinds', () => {
    const match = source.match(/const STUDIO_NOTIFY_KINDS = \[([\s\S]*?)\];/);
    assert.ok(match, 'STUDIO_NOTIFY_KINDS must be declared');
    const declared = [...match[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
    assert.deepEqual(declared.sort(), [...STUDIO_KINDS].sort());
    assert.match(studioNotifyRoute(), /!STUDIO_NOTIFY_KINDS\.includes\(kind\)/);
});

test('studio notify checks studio ownership for each notification kind', () => {
    const route = studioNotifyRoute();
    const branches = kindBranches(route);

    const covered = new Set();
    for (const branch of branches) {
        const kinds = [...branch.matchAll(/kind === '([a-z_]+)'/g)].map(m => m[1]);
        assert.match(branch, /const access = await _verifyStudioNotifyAccess\(req, studio, authUser\)/,
            `branch for ${kinds.join('/')} must verify studio ownership`);
        const accessIndex = branch.indexOf('_verifyStudioNotifyAccess(');
        const recipientIndex = branch.indexOf('StudiosRepo.getArtistContact(');
        assert.ok(recipientIndex === -1 || accessIndex < recipientIndex, 'ownership is checked before resolving recipients');
        kinds.forEach(k => covered.add(k));
    }
    for (const kind of STUDIO_KINDS) assert.ok(covered.has(kind), `${kind} must have a verified branch`);

    assert.match(source, /async function _verifyStudioNotifyAccess\(req, studio, authUser\)/);
    assert.match(source, /ownerUserId && authUser\?\.id && ownerUserId === String\(authUser\.id\)/);
    assert.match(source, /Studio ownership required/);
});

test('studio notify verifies the persisted state of every kind before sending', () => {
    const route = studioNotifyRoute();
    const checks = route.match(/return res\.status\(409\)/g) || [];
    assert.ok(checks.length >= 6, 'every branch rejects a stale state with 409');
    assert.match(route, /\['pending_invite', 'pending_acceptance'\]\.includes\(m\.status\)/);
    assert.match(route, /\(m\.initiated_by \|\| 'studio'\) !== 'artist'/);
    assert.match(route, /\['active', 'rejected'\]\.includes\(m\.status\)/);
    assert.match(route, /c\.status === 'sent'/);
    assert.match(route, /c\.status === 'terminated'/);
    assert.match(route, /b\.status !== \(created \? 'confirmed' : 'cancelled'\)/);
});

test('studio notify resolves every recipient server-side from auth.users, never stored contact emails', () => {
    const route = studioNotifyRoute();
    assert.doesNotMatch(route, /client_email|contact_email|studio\.email|studios\.email|artist\.email|req\.body\.to\b/);
    const recipients = route.match(/StudiosRepo\.getArtistContact\(/g) || [];
    assert.ok(recipients.length >= 5, 'artist recipients come from StudiosRepo.getArtistContact');
});

test('studio notify keys idempotency by kind, row id and persisted state', () => {
    const route = studioNotifyRoute();
    assert.match(route, /idempotencyKey: `spot_decision:\$\{app\.id\}:\$\{app\.status\}`/);
    assert.match(route, /idempotencyKey: `roster_invite:\$\{m\.id\}:\$\{m\.status\}`/);
    assert.match(route, /idempotencyKey: `membership_request_decision:\$\{m\.id\}:\$\{m\.status\}`/);
    assert.match(route, /idempotencyKey: `\$\{kind\}:\$\{c\.id\}:\$\{c\.status\}`/);
    assert.match(route, /idempotencyKey: `\$\{kind\}:\$\{b\.id\}:\$\{b\.status\}`/);
});

test('accepted spot decision email points to the contract that the studio will send', () => {
    const route = studioNotifyRoute();
    assert.match(route, /Tu postulación avanzó; el estudio te va a enviar el contrato para firmar en \$\{invitationsUrl\}/);
    assert.doesNotMatch(route, /Ya formás parte del roster/);
});

test('studio notify is rate limited per authenticated user', () => {
    assert.match(source, /app\.post\('\/api\/studio\/notify', studioNotifyLimiter, async/);
    assert.match(source, /keyGenerator: _studioNotifyRateLimitKey/);
    assert.match(source, /return `user:\$\{authUser\.id\}`;/);
    assert.match(source, /rateLimit\.ipKeyGenerator\(req\.ip \|\| ''\)/);
});
