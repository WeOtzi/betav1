'use strict';

// Plataforma de estudios + Supplies (servidor): repos con nombre sobre la capa
// PostgREST (fetch mockeado), eventos de email internos, y contratos
// estaticos de server.js (endpoints de aviso, backoffice, catalogo admin).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon-key';

const {
    StudiosRepo, pgErrorCode, isMissingSchemaError, OPEN_MEMBERSHIP_STATUSES
} = require('../lib/repos/studios');
const { SuppliesRepo } = require('../lib/repos/supplies');
const { EVENTS, resolveRecipients, buildAttribs } = require('../services/email-event-mapping');
const { resolveEmailContext, INTERNAL_ONLY_EVENTS } = require('../services/email-request-context');

// Normalizado a LF: el checkout en Windows (autocrlf) deja CRLF.
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').split('\r\n').join('\n');

const STUDIO_ID = '33333333-3333-4333-8333-333333333333';
const OWNER_ID = '66666666-6666-4666-8666-666666666666';
const ARTIST_ID = '22222222-2222-4222-8222-222222222222';
const VENDOR_ID = '77777777-7777-4777-8777-777777777777';

// Router de fetch: cada handler recibe (url, opts) y devuelve { status, body }.
function mockFetch(routes) {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
        calls.push({ url: String(url), opts });
        const route = routes.find(r => r.match.test(String(url)));
        const { status = 200, body = [] } = route ? route.reply(String(url), opts) : { status: 404, body: { message: 'not mocked' } };
        const text = typeof body === 'string' ? body : JSON.stringify(body);
        return {
            ok: status >= 200 && status < 300,
            status,
            headers: { get: () => null },
            text: async () => text,
            json: async () => JSON.parse(text),
        };
    };
    return calls;
}

function serverSlice(startMarker, endMarker) {
    const start = serverSource.indexOf(startMarker);
    assert.notEqual(start, -1, `${startMarker} must exist`);
    const end = serverSource.indexOf(endMarker, start + startMarker.length);
    return serverSource.slice(start, end === -1 ? undefined : end);
}

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

test('getStudioOwnerContact uses the auth.users email of studios.user_id, never studios.email', async () => {
    const calls = mockFetch([
        { match: /\/rest\/v1\/studios\?/, reply: () => ({ body: [{ id: STUDIO_ID, name: 'Claroscuro', slug: 'claroscuro', user_id: OWNER_ID, email: 'public@studio.com' }] }) },
        { match: /\/auth\/v1\/admin\/users\//, reply: () => ({ body: { id: OWNER_ID, email: 'Owner@Login.com', user_metadata: { full_name: 'Dueña' } } }) },
    ]);
    const contact = await StudiosRepo.getStudioOwnerContact(STUDIO_ID);
    assert.equal(contact.email, 'owner@login.com');
    assert.equal(contact.user_id, OWNER_ID);
    assert.match(calls[0].url, /select=id%2Cname%2Cslug%2Cuser_id/);
    assert.doesNotMatch(calls[0].url, /email/, 'studios.email is not even selected');
    assert.match(calls[1].url, new RegExp(`/auth/v1/admin/users/${OWNER_ID}$`));
    assert.equal(calls[1].opts.headers.apikey, 'service-key');
});

test('getStudioOwnerContact returns null (and skips Auth) when the studio has no owner', async () => {
    const calls = mockFetch([
        { match: /\/rest\/v1\/studios\?/, reply: () => ({ body: [{ id: STUDIO_ID, name: 'Sin dueño', slug: 's', user_id: null }] }) },
    ]);
    assert.equal(await StudiosRepo.getStudioOwnerContact(STUDIO_ID), null);
    assert.equal(calls.length, 1);
    assert.equal(await StudiosRepo.getStudioOwnerContact('not-a-uuid'), null);
});

test('getArtistContact takes the email from auth.users and the name from artists_db', async () => {
    mockFetch([
        { match: /\/auth\/v1\/admin\/users\//, reply: () => ({ body: { id: ARTIST_ID, email: 'artist@login.com' } }) },
        { match: /\/rest\/v1\/artists_db\?/, reply: () => ({ body: [{ user_id: ARTIST_ID, name: 'Ana', username: 'ana.wo', email: 'stale@profile.com' }] }) },
    ]);
    const contact = await StudiosRepo.getArtistContact(ARTIST_ID);
    assert.deepEqual(contact, { user_id: ARTIST_ID, email: 'artist@login.com', name: 'Ana', username: 'ana.wo' });
});

test('getArtistContact returns null when Auth has no user', async () => {
    mockFetch([{ match: /\/auth\/v1\/admin\/users\//, reply: () => ({ status: 404, body: {} }) }]);
    assert.equal(await StudiosRepo.getArtistContact(ARTIST_ID), null);
});

test('party loaders embed the studio owner and the artist name', async () => {
    const calls = mockFetch([{ match: /\/rest\/v1\//, reply: () => ({ body: [{ id: 'x' }] }) }]);
    await StudiosRepo.getMembershipWithParties('m1');
    await StudiosRepo.getContractWithParties('c1');
    await StudiosRepo.getBookingWithParties('b1');
    const decoded = calls.map(c => decodeURIComponent(c.url));
    assert.match(decoded[0], /studio_artist_memberships\?select=\*,studios\(id,name,slug,user_id\),artists_db\(user_id,name,username\)&id=eq\.m1/);
    assert.match(decoded[1], /studio_contracts\?select=\*,studios\(id,name,slug,user_id\),artists_db\(user_id,name,username\)&id=eq\.c1/);
    assert.match(decoded[2], /studio_bookings\?select=\*,studios\(id,name,slug,user_id\),artists_db\(user_id,name,username\),studio_locations\(/);
    for (const url of decoded) assert.doesNotMatch(url, /client_email|contact_email/);
});

test('findOpenMembership filters the open statuses of the pair', async () => {
    const calls = mockFetch([{ match: /\/rest\/v1\//, reply: () => ({ body: [] }) }]);
    assert.equal(await StudiosRepo.findOpenMembership(STUDIO_ID, ARTIST_ID), null);
    const url = decodeURIComponent(calls[0].url);
    assert.match(url, new RegExp(`studio_id=eq\\.${STUDIO_ID}`));
    assert.match(url, new RegExp(`artist_user_id=eq\\.${ARTIST_ID}`));
    assert.match(url, /status=in\.\("requested","pending_invite","pending_acceptance","active","paused"\)/);
    assert.deepEqual(OPEN_MEMBERSHIP_STATUSES, ['requested', 'pending_invite', 'pending_acceptance', 'active', 'paused']);
});

test('insertMembership is a plain POST without on_conflict', async () => {
    const calls = mockFetch([{ match: /\/rest\/v1\/studio_artist_memberships/, reply: () => ({ status: 201, body: [{ id: 'm1', status: 'requested' }] }) }]);
    const row = await StudiosRepo.insertMembership({ studio_id: STUDIO_ID, artist_user_id: ARTIST_ID, status: 'requested' });
    assert.equal(row.id, 'm1');
    assert.equal(calls[0].opts.method, 'POST');
    assert.doesNotMatch(calls[0].url, /on_conflict/);
    assert.doesNotMatch(calls[0].opts.headers.Prefer, /merge-duplicates/);
});

test('pgErrorCode and isMissingSchemaError read the PostgREST body', () => {
    const missing = new Error('PostgREST GET studio_contracts failed (404): {"code":"PGRST205","message":"Could not find the table"}');
    assert.equal(pgErrorCode(missing), 'PGRST205');
    assert.equal(isMissingSchemaError(missing), true);
    const check = new Error('PostgREST POST studio_artist_memberships failed (400): {"code":"23514","message":"violates check constraint"}');
    assert.equal(pgErrorCode(check), '23514');
    assert.equal(isMissingSchemaError(check), false);
    for (const code of ['PGRST200', 'PGRST202', 'PGRST204', '42703', '42883', '42P01']) {
        assert.equal(isMissingSchemaError(new Error(`x: {"code":"${code}"}`)), true, code);
    }
});

test('decideClaimAsCaller calls the RPC with the caller JWT, not the service-role key', async () => {
    const calls = mockFetch([{ match: /\/rest\/v1\/rpc\/decide_studio_claim$/, reply: () => ({ body: { claim_id: 'k1', status: 'approved' } }) }]);
    const out = await StudiosRepo.decideClaimAsCaller('k1', 'approve', '  ', 'user-jwt');
    assert.deepEqual(out, { claim_id: 'k1', status: 'approved' });
    assert.equal(calls[0].opts.method, 'POST');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer user-jwt');
    assert.equal(calls[0].opts.headers.apikey, 'anon-key');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { p_claim_id: 'k1', p_decision: 'approve', p_note: '  ' });
    await assert.rejects(() => StudiosRepo.decideClaimAsCaller('k1', 'approve', null, null), err => err.status === 401);
});

test('RPC failures keep the database errcode and message', async () => {
    mockFetch([{ match: /\/rpc\//, reply: () => ({ status: 403, body: { code: '42501', message: 'Solo soporte puede decidir reclamos.' } }) }]);
    await assert.rejects(
        () => StudiosRepo.decideSpotApplicationAsCaller('a1', 'accepted', 'jwt'),
        err => pgErrorCode(err) === '42501' && err.dbMessage === 'Solo soporte puede decidir reclamos.'
    );
});

test('listPendingClaims enriches each claim with the auth.users contact', async () => {
    const calls = mockFetch([
        { match: /\/rest\/v1\/studio_claim_requests\?/, reply: () => ({ body: [{ id: 'k1', user_id: OWNER_ID, status: 'pending', studios: { name: 'Claroscuro' } }] }) },
        { match: /\/auth\/v1\/admin\/users\//, reply: () => ({ body: { id: OWNER_ID, email: 'claimer@login.com' } }) },
    ]);
    const claims = await StudiosRepo.listPendingClaims();
    assert.equal(claims[0].user.email, 'claimer@login.com');
    assert.match(decodeURIComponent(calls[0].url), /status=eq\.pending/);
});

test('getVendorOwnerContact uses auth.users, never supply_vendors.contact_email', async () => {
    const calls = mockFetch([
        { match: /\/rest\/v1\/supply_vendors\?/, reply: () => ({ body: [{ id: VENDOR_ID, name: 'Tintas SA', slug: 'tintas', user_id: OWNER_ID, contact_email: 'ventas@tintas.com' }] }) },
        { match: /\/auth\/v1\/admin\/users\//, reply: () => ({ body: { id: OWNER_ID, email: 'login@tintas.com' } }) },
    ]);
    const contact = await SuppliesRepo.getVendorOwnerContact(VENDOR_ID);
    assert.equal(contact.email, 'login@tintas.com');
    assert.doesNotMatch(decodeURIComponent(calls[0].url), /contact_email/);
});

test('getOrderWithParties embeds studio, vendor, sede and items', async () => {
    const calls = mockFetch([{ match: /\/rest\/v1\/supply_orders\?/, reply: () => ({ body: [{ id: 'o1' }] }) }]);
    await SuppliesRepo.getOrderWithParties('o1');
    const url = decodeURIComponent(calls[0].url);
    assert.match(url, /studios\(id,name,slug,user_id\)/);
    assert.match(url, /supply_vendors\(id,name,slug,user_id,currency\)/);
    assert.match(url, /supply_order_items\(/);
    assert.match(url, /id=eq\.o1/);
});

test('vendor login lookup is by the lowercase login email', async () => {
    const calls = mockFetch([{ match: /\/rest\/v1\/supply_vendors\?/, reply: () => ({ body: [] }) }]);
    await SuppliesRepo.listVendorsByLoginEmail('  Ventas@Tintas.COM ');
    assert.match(decodeURIComponent(calls[0].url), /email=eq\.ventas@tintas\.com/);
});

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

const NEW_EVENTS = [
    'studio_membership_request_created', 'studio_membership_request_decision',
    'studio_contract_issued', 'studio_contract_signed', 'studio_contract_declined', 'studio_contract_terminated',
    'studio_booking_created', 'studio_booking_cancelled', 'supply_order_submitted', 'supply_order_status'
];

test('new studio platform events use the studio-notification template and the resolved recipient', () => {
    for (const id of NEW_EVENTS) {
        assert.ok(EVENTS[id], `${id} must be mapped`);
        assert.equal(EVENTS[id].templateHint, 'studio-notification');
        assert.deepEqual(resolveRecipients(id, { recipient_email: 'owner@login.com', client_email: 'client@x.com' }), ['owner@login.com']);
        const attribs = buildAttribs(id, { recipient_name: 'Ana', studio_name: 'Claroscuro', subject: 'S', body_text: 'B', dashboard_url: 'https://x/y', meta: { a: 1 } });
        assert.deepEqual(Object.keys(attribs).sort(), ['body_text', 'dashboard_url', 'recipient_name', 'studio_name', 'subject']);
    }
});

test('studio and supply events are internal-only: POST /api/email/:eventId answers 403', async () => {
    const deps = { resolveUser: async () => ({ id: OWNER_ID, email: 'owner@login.com' }), read: async () => null,
        verifyAdmin: async () => ({ ok: true, userId: 'admin' }) };
    const request = { headers: { host: 'weotzi.com' }, weotziBasePath: '/beta' };
    for (const id of [...NEW_EVENTS, 'studio_roster_invite', 'studio_spot_decision', 'studio_claim_decision']) {
        assert.ok(INTERNAL_ONLY_EVENTS.has(id), `${id} must be internal-only`);
        const context = await resolveEmailContext(request, id, { to: 'victim@example.com' }, deps);
        assert.equal(context.ok, false);
        assert.equal(context.status, 403, id);
    }
});

// ---------------------------------------------------------------------------
// server.js (contratos estaticos)
// ---------------------------------------------------------------------------

test('the three notify endpoints share the per-user limiter and require a Bearer user', () => {
    for (const route of ["app.post('/api/studio/notify'", "app.post('/api/artist/studio-notify'", "app.post('/api/supplies/notify'"]) {
        assert.ok(serverSource.includes(`${route}, studioNotifyLimiter, async`), `${route} uses studioNotifyLimiter`);
        const body = serverSlice(route, '\n});');
        assert.match(body, /const authUser = await _getAuthUserFromBearer\(req\);/);
        assert.match(body, /return res\.status\(401\)/);
    }
    const limiter = serverSlice('const studioNotifyLimiter = rateLimit({', '});');
    assert.match(limiter, /max: 60/);
    assert.match(limiter, /windowMs: 15 \* 60 \* 1000/);
});

test('artist studio notify only lets the artist of the row notify the studio owner', () => {
    const route = serverSlice("app.post('/api/artist/studio-notify'", '\n});');
    assert.match(route, /String\(m\.artist_user_id \|\| ''\) !== String\(authUser\.id\)/);
    assert.match(route, /String\(c\.artist_user_id \|\| ''\) !== String\(authUser\.id\)/);
    assert.match(route, /m\.status !== 'requested'/);
    assert.match(route, /StudiosRepo\.getStudioOwnerContact\(c\.studio_id\)/);
    assert.match(route, /_notifyNoRecipient\(res, 'studio_without_owner'/);
    assert.match(route, /String\(c\.terminated_by \|\| ''\) === String\(authUser\.id\)/);
    assert.doesNotMatch(route, /client_email|contact_email|studio\.email/);

    const helper = serverSlice('async function _notifyMembershipRequestCreated(', '\n}\n');
    assert.match(helper, /idempotencyKey: `membership_request_created:\$\{membership\.studio_id\}:\$\{membership\.artist_user_id\}:\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\}`/);
    assert.match(helper, /if \(!owner\) return \{ skipped: true/);
});

test('supplies notify routes each kind to the counterparty and checks the persisted order status', () => {
    const route = serverSlice("app.post('/api/supplies/notify'", '\n});');
    assert.match(route, /order\.status !== SUPPLY_NOTIFY_STATUS\[kind\]/);
    assert.match(route, /SuppliesRepo\.getVendorOwnerContact\(order\.vendor_id\)/);
    assert.match(route, /StudiosRepo\.getStudioOwnerContact\(order\.studio_id\)/);
    assert.match(route, /idempotencyKey: `\$\{kind\}:\$\{order\.id\}:\$\{order\.status\}`/);
    assert.doesNotMatch(route, /contact_email|client_email|vendor\.email|studio\.email/);

    const statusMap = serverSlice('const SUPPLY_NOTIFY_STATUS = {', '};');
    for (const [kind, status] of Object.entries({
        order_submitted: 'submitted', order_cancelled: 'cancelled', order_received: 'received',
        order_confirmed: 'confirmed', order_rejected: 'rejected', order_shipped: 'shipped', order_delivered: 'delivered'
    })) {
        assert.match(statusMap, new RegExp(`${kind}: '${status}'`));
    }
    assert.match(serverSource, /SUPPLY_STUDIO_SIDE_KINDS = new Set\(\['order_submitted', 'order_cancelled', 'order_received'\]\)/);
});

test('_detectUserRole recognizes studio owners and Supplies vendors', () => {
    const fn = serverSlice('async function _detectUserRole(', '\nasync function ');
    assert.match(fn, /StudiosRepo\.getOwnedStudioByUserId\(userId\)/);
    assert.match(fn, /role: 'studio'/);
    assert.match(fn, /SuppliesRepo\.getVendorByUserId\(userId\)/);
    assert.match(fn, /role: 'supplies'/);
});

test('reset-temp-password accepts supplies via the login email and a matching auth user', () => {
    const route = serverSlice("app.post('/api/auth/reset-temp-password'", '\n});');
    assert.match(route, /\['artist', 'client', 'studio', 'supplies'\]\.includes\(userType\)/);
    assert.match(route, /SuppliesRepo\.listVendorsByLoginEmail\(email\)/);
    assert.match(route, /StudiosRepo\.getAuthUserContact\(vendor\.user_id\)/);
    assert.match(route, /authUser\.email === String\(email\)\.trim\(\)\.toLowerCase\(\)/);
});

test('backoffice claim and vendor endpoints require superadmin or an active support agent', () => {
    const routes = [
        "app.get('/api/admin/studio-claims'",
        "app.post('/api/admin/studio-claims/:id/decide'",
        "app.get('/api/admin/supply-vendors'",
        "app.patch('/api/admin/supply-vendors/:id'",
        "app.post('/api/admin/studio-spot-applications/:id/decide'"
    ];
    for (const route of routes) {
        const body = serverSlice(route, '\n});');
        assert.match(body, /const auth = await _verifyBackofficeOrSupport\(req\);\s*if \(!auth\.ok\)/, `${route} authorizes first`);
    }
    const verify = serverSlice('async function _verifyBackofficeOrSupport(', '\n}\n');
    assert.match(verify, /appSettings\.verifyAdminCaller\(req\)/);
    assert.match(verify, /_getActiveSupportAgent\(req\)/);

    const decide = serverSlice("app.post('/api/admin/studio-claims/:id/decide'", '\n});');
    assert.match(decide, /\['approve', 'reject'\]\.includes\(decision\)/);
    assert.match(decide, /StudiosRepo\.decideClaimAsCaller\(id, decision, cleanNote, bearerToken\(req\)\)/);

    const patch = serverSlice("app.patch('/api/admin/supply-vendors/:id'", '\n});');
    assert.match(patch, /for \(const key of \['is_verified', 'is_active'\]\)/);
    assert.match(patch, /typeof body\[key\] !== 'boolean'/);
});

test('admin database catalog adds the platform tables and keeps RPC-only tables read-only', () => {
    const literal = serverSlice('const ADMIN_DATABASE_TABLES = [', '\n];') + '\n];';
    const tables = vm.runInNewContext(`${literal.replace('const ADMIN_DATABASE_TABLES =', 'ADMIN_DATABASE_TABLES =')}; ADMIN_DATABASE_TABLES`, {});
    const byName = new Map(tables.map(t => [t.name, t]));

    for (const name of ['studio_bookings', 'supply_vendors', 'supply_products', 'supply_discount_tiers', 'supply_vendor_private']) {
        assert.ok(byName.has(name), `${name} must be in the catalog`);
        assert.ok(!byName.get(name).readonly && byName.get(name).kind !== 'view', `${name} stays writable`);
    }
    for (const name of ['studio_contracts', 'studio_membership_request_details', 'studio_finance_entries',
        'supply_orders', 'supply_order_items', 'supply_order_events', 'studio_claim_requests']) {
        assert.equal(byName.get(name)?.readonly, true, `${name} must be readonly`);
    }
    for (const name of ['studio_monthly_metrics_by_currency', 'studio_artist_metrics_by_currency', 'studio_inventory_health_by_currency',
        'studio_public_roster', 'studio_artist_material_balance', 'studio_material_assignment_monthly',
        'studio_finance_monthly_by_category', 'supply_vendor_sales_monthly', 'supply_vendor_customers']) {
        assert.equal(byName.get(name)?.kind, 'view', `${name} must be a read-only view`);
    }

    assert.match(serverSource, /ADMIN_DATABASE_TABLES\.filter\(table => !\(table\.kind === 'view' \|\| table\.readonly\)\)/);
    const writable = tables.filter(t => !(t.kind === 'view' || t.readonly)).map(t => t.name);
    assert.ok(!writable.includes('studio_contracts'));
    assert.ok(!writable.includes('supply_orders'));
    assert.ok(writable.includes('studio_bookings'));
});
