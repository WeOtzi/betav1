// Repos de frontend de la plataforma de estudios + Supplies
// (docs/plans/2026-10-30-estudios-plataforma.md, "Repos de frontend").
// Carga postgrest-client.js y los cuatro repos en una VM con un cliente
// supabase-js falso que registra tabla/RPC, select, filtros, orden y paginas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const DATA_DIR = 'public/shared/js/data/';
const REPO_FILES = ['postgrest-client.js', 'studios-repo.js', 'studio-contracts-repo.js', 'studio-finance-repo.js', 'supplies-repo.js'];
// Los objetos creados dentro de la VM tienen otro Object.prototype.
const plain = (value) => JSON.parse(JSON.stringify(value));

function rowsFor(range, count) {
    const [start, end] = range;
    const n = Math.max(0, Math.min(end + 1, count) - start);
    return Array.from({ length: n }, (_, i) => ({ id: String(start + i) }));
}

// respond(query) -> { data, error }. Por defecto: paginas de `count` filas,
// un objeto para single/maybeSingle y [] para el resto.
function load({ respond, count = 0, session = { user: { id: 'user-me' } }, withClient = true } = {}) {
    const calls = [];
    const errors = [];
    const reply = respond || ((query) => {
        if (query.range) return { data: rowsFor(query.range, count), error: null };
        if (query.single || query.maybeSingle) return { data: { id: 'row' }, error: null };
        return { data: [], error: null };
    });
    function builder(query) {
        const b = {};
        const chain = (name, fn) => { b[name] = (...args) => { fn(...args); return b; }; };
        chain('select', (value) => { query.select = value; });
        chain('insert', (value) => { query.insert = value; });
        chain('update', (value) => { query.update = value; });
        chain('delete', () => { query.delete = true; });
        for (const op of ['eq', 'neq', 'in', 'gte', 'lte', 'lt', 'gt', 'ilike', 'not']) {
            chain(op, (key, ...value) => query.filters.push([op, key, ...value]));
        }
        chain('or', (value) => query.filters.push(['or', value]));
        chain('order', (key, opts) => query.ordering.push([key, opts || {}]));
        chain('limit', (n) => { query.limit = n; });
        chain('range', (start, end) => { query.range = [start, end]; });
        chain('single', () => { query.single = true; });
        chain('maybeSingle', () => { query.maybeSingle = true; });
        b.then = (ok, fail) => Promise.resolve().then(() => reply(query)).then(ok, fail);
        return b;
    }
    const client = {
        from(table) { const query = { table, filters: [], ordering: [] }; calls.push(query); return builder(query); },
        rpc(name, args) { const query = { rpc: name, args, filters: [], ordering: [] }; calls.push(query); return builder(query); },
        auth: { getSession: async () => ({ data: { session } }) },
    };
    const window = { _supabase: withClient ? client : null };
    const quiet = { error: (...args) => errors.push(args), warn() {}, log() {}, info() {} };
    // Solo window/console/Date/Promise en el nivel superior (contrato de studios-repo.js).
    const context = vm.createContext({ window, console: quiet, Date, Promise });
    for (const file of REPO_FILES) vm.runInContext(read(DATA_DIR + file), context, { filename: file });
    return { D: window.WeotziData, calls, errors };
}

const has = (query, op, key, value) => query.filters.some((f) => f[0] === op && f[1] === key && (value === undefined || JSON.stringify(f[2]) === JSON.stringify(value)));
const orderKeys = (query) => query.ordering.map(([key]) => key);
const fail = (code, message = 'boom') => ({ data: null, error: { code, message } });

// ============================================================
// Carga y superficie
// ============================================================

test('los repos cargan solo con window/console/Date/Promise y exponen los metodos del contrato', () => {
    const { D, errors } = load();
    assert.deepEqual(errors, []);
    const surface = {
        Studios: ['listUnownedStudios', 'requestClaim', 'getMyClaim'],
        StudioMemberships: ['listRequestsForStudio', 'requestMembership', 'decideRequest', 'withdrawRequest', 'listRequestsForArtist',
            'listChangeRequestsForStudio', 'closeChangeRequest', 'listActiveRosterWithArtists', 'listForArtistV2', 'listRosterV2'],
        StudioSpots: ['decideApplicationRpc', 'listOpenByStudio', 'listArtistCounterOffersForStudio', 'respondCounterOffer'],
        StudioOps: ['listBookingsRange', 'checkBookingAvailability', 'listArtistBusyBlocks', 'listBookingsForArtist', 'listMaterialBalance',
            'listMaterialAssignmentsMonthly', 'listMyMaterialAssignments', 'listMonthlyMetrics', 'listRestockCandidates', 'listInventoryMovements'],
        StudioContracts: ['listForStudio', 'listForArtist', 'get', 'getCurrentForMembership', 'saveDraft', 'prepareFromApplication',
            'prepareForMembership', 'issue', 'sign', 'decline', 'cancel', 'terminate', 'expireOverdue'],
        StudioFinance: ['listEntries', 'saveEntry', 'voidEntry', 'monthlyByCategory'],
        Supplies: ['getVendorByUserId', 'getVendor', 'getVendorBySlug', 'listVendors', 'updateVendor', 'getVendorPrivate', 'saveVendorPrivate',
            'completeRegistration', 'listProducts', 'searchCatalog', 'saveProduct', 'archiveProduct', 'listTiers', 'saveTier', 'deleteTier',
            'listOrdersForStudio', 'listOrdersForVendor', 'getOrder', 'submitOrder', 'cancelOrder', 'receiveOrder', 'vendorUpdateOrder',
            'vendorSalesMonthly', 'vendorCustomers', 'estimateOrder'],
    };
    for (const [namespace, methods] of Object.entries(surface)) {
        for (const method of methods) assert.equal(typeof D[namespace][method], 'function', `${namespace}.${method}`);
    }
});

test('studios-repo.js no usa globals del navegador fuera de window/console/Date/Promise', () => {
    const source = read(DATA_DIR + 'studios-repo.js');
    assert.doesNotMatch(source, /\b(document|fetch|localStorage|sessionStorage|setTimeout|setInterval|module|require)\b\s*[.(]/);
    assert.doesNotMatch(source, /_supabase\.from|\/rest\/v1/);
});

test('los metodos nuevos no lanzan sin cliente: resuelven { data, error }', async () => {
    const { D, errors } = load({ withClient: false });
    const invocations = [
        () => D.StudioMemberships.listRequestsForStudio('s'), () => D.StudioMemberships.requestMembership({ studioId: 's' }),
        () => D.StudioMemberships.decideRequest('m', 'accept'), () => D.StudioMemberships.withdrawRequest('m'),
        () => D.StudioMemberships.listRequestsForArtist('a'), () => D.StudioMemberships.listChangeRequestsForStudio('s'),
        () => D.StudioMemberships.closeChangeRequest('c'), () => D.StudioMemberships.listActiveRosterWithArtists('s'),
        () => D.StudioMemberships.listForArtistV2('a'), () => D.StudioMemberships.listRosterV2('s'),
        () => D.StudioSpots.decideApplicationRpc('x', 'accepted'), () => D.StudioSpots.listOpenByStudio('s'),
        () => D.StudioSpots.listArtistCounterOffersForStudio('s'), () => D.StudioSpots.respondCounterOffer('o', 'accept'),
        () => D.StudioOps.listBookingsRange('s', 'a', 'b'), () => D.StudioOps.checkBookingAvailability('s', 'a', 'x', 'y'),
        () => D.StudioOps.listArtistBusyBlocks('s', 'a', 'b'), () => D.StudioOps.listBookingsForArtist('a', 'x', 'y'),
        () => D.StudioOps.listMaterialBalance('s'), () => D.StudioOps.listMaterialAssignmentsMonthly('s'),
        () => D.StudioOps.listMyMaterialAssignments(), () => D.StudioOps.listMonthlyMetrics('s'), () => D.StudioOps.listRestockCandidates('s'),
        () => D.Studios.listUnownedStudios('tinta'), () => D.Studios.requestClaim('s', 'evidencia'), () => D.Studios.getMyClaim(),
        () => D.StudioContracts.listForStudio('s'), () => D.StudioContracts.get('c'), () => D.StudioContracts.sign('c', 'Ana', true),
        () => D.StudioContracts.expireOverdue('s'), () => D.StudioFinance.listEntries('s'), () => D.StudioFinance.saveEntry({ studio_id: 's' }),
        () => D.StudioFinance.voidEntry('e', 'x'), () => D.Supplies.searchCatalog(), () => D.Supplies.getOrder('o'),
        () => D.Supplies.submitOrder({ studioId: 's', vendorId: 'v' }), () => D.Supplies.saveVendorPrivate('v', {}),
    ];
    for (const invoke of invocations) {
        let result;
        assert.doesNotThrow(() => { result = invoke(); });
        const settled = await result;
        assert.ok(settled && 'data' in settled, String(invoke));
        assert.ok(settled.error, String(invoke));
    }
    assert.ok(errors.length > 0, 'postgrest-client informa la falta de cliente');
});

// ============================================================
// StudioMemberships
// ============================================================

test('listRequestsForStudio lee solicitudes requested del estudio con detalles y artista, paginadas', async () => {
    const { D, calls } = load({
        respond: (q) => ({ data: q.range[0] === 0 ? [{ id: 'm1', artists_db: { user_id: 'a', styles_array: ['blackwork'] } }] : [], error: null }),
    });
    const result = await D.StudioMemberships.listRequestsForStudio('studio');
    assert.equal(result.error, null);
    const q = calls[0];
    assert.equal(q.table, 'studio_artist_memberships');
    assert.ok(has(q, 'eq', 'studio_id', 'studio'));
    assert.ok(has(q, 'eq', 'status', 'requested'));
    assert.match(q.select, /studio_membership_request_details \( message, portfolio_url, proposed_start_date, styles, created_at \)/);
    assert.match(q.select, /artists_db \( user_id, name, username, profile_picture, styles_array \)/);
    assert.match(q.select, /initiated_by/);
    assert.ok(orderKeys(q).includes('id'));
    assert.deepEqual(q.range, [0, 499]);
    assert.deepEqual(plain(result.data[0].artists_db.styles), ['blackwork']);
});

test('los listados de carga tragan la migracion pendiente pero no otros errores', async () => {
    for (const code of ['42703', 'PGRST200', 'PGRST204', 'PGRST205', '42P01']) {
        const { D } = load({ respond: () => fail(code) });
        const result = await D.StudioMemberships.listRequestsForStudio('studio');
        assert.deepEqual(plain(result), { data: [], error: null, unavailable: true }, code);
    }
    const { D } = load({ respond: () => fail('42501', 'permission denied') });
    const denied = await D.StudioMemberships.listRequestsForStudio('studio');
    assert.equal(denied.data, null);
    assert.equal(denied.error.message, 'permission denied');
    assert.equal(denied.unavailable, undefined);
});

test('requestMembership, decideRequest y withdrawRequest llaman a sus RPCs con los argumentos del contrato', async () => {
    const { D, calls } = load();
    await D.StudioMemberships.requestMembership({ studioId: 's', message: 'Hola', portfolioUrl: 'https://x.test', proposedStartDate: '2026-11-01' });
    await D.StudioMemberships.decideRequest('m', 'accept', { role: 'guest', locationId: 'loc' });
    await D.StudioMemberships.decideRequest('m', 'reject');
    await D.StudioMemberships.withdrawRequest('m');
    assert.deepEqual(plain(calls.map((c) => [c.rpc, c.args])), [
        ['request_studio_membership', { p_studio_id: 's', p_role: 'resident', p_location_id: null, p_message: 'Hola', p_portfolio_url: 'https://x.test', p_proposed_start_date: '2026-11-01' }],
        ['decide_studio_membership_request', { p_membership_id: 'm', p_decision: 'accept', p_role: 'guest', p_location_id: 'loc' }],
        ['decide_studio_membership_request', { p_membership_id: 'm', p_decision: 'reject', p_role: null, p_location_id: null }],
        ['withdraw_studio_membership_request', { p_membership_id: 'm' }],
    ]);
});

test('listRequestsForArtist embebe el estudio con user_id y marca si tiene dueno', async () => {
    const { D, calls } = load({
        respond: () => ({ data: [{ id: 'm1', studios: { id: 's1', user_id: 'owner' } }, { id: 'm2', studios: { id: 's2', user_id: null } }], error: null }),
    });
    const result = await D.StudioMemberships.listRequestsForArtist('artist');
    const q = calls[0];
    assert.equal(q.table, 'studio_artist_memberships');
    assert.ok(has(q, 'eq', 'artist_user_id', 'artist'));
    assert.ok(has(q, 'eq', 'status', 'requested'));
    assert.match(q.select, /studios:studio_id \([^)]*\buser_id\b[^)]*\)/);
    assert.deepEqual(result.data.map((row) => row.studio_has_owner), [true, false]);
});

test('listChangeRequestsForStudio filtra por el estudio de la membresia embebida y status pending', async () => {
    const { D, calls } = load({ count: 2 });
    const result = await D.StudioMemberships.listChangeRequestsForStudio('studio');
    assert.equal(result.data.length, 2);
    const q = calls[0];
    assert.equal(q.table, 'studio_invitation_change_requests');
    assert.match(q.select, /studio_artist_memberships!inner \(/);
    assert.match(q.select, /artists_db \(/);
    assert.ok(has(q, 'eq', 'studio_artist_memberships.studio_id', 'studio'));
    assert.ok(has(q, 'eq', 'status', 'pending'));
    assert.ok(orderKeys(q).includes('id'));
});

test('closeChangeRequest declina solo pedidos pending', async () => {
    const { D, calls } = load();
    await D.StudioMemberships.closeChangeRequest('change');
    const q = calls[0];
    assert.equal(q.table, 'studio_invitation_change_requests');
    assert.equal(q.update.status, 'declined');
    assert.ok(q.update.resolved_at);
    assert.ok(has(q, 'eq', 'id', 'change'));
    assert.ok(has(q, 'eq', 'status', 'pending'));
});

test('listActiveRosterWithArtists lee la vista publica y normaliza las filas', async () => {
    const { D, calls } = load({
        respond: () => ({ data: [{ membership_id: 'm1', artist_user_id: 'a1', role: 'guest', ends_on: '2026-12-01', artists_db: { user_id: 'a1' } }], error: null }),
    });
    const result = await D.StudioMemberships.listActiveRosterWithArtists('studio');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].table, 'studio_public_roster');
    assert.ok(has(calls[0], 'eq', 'studio_id', 'studio'));
    assert.doesNotMatch(calls[0].select, /revenue_split_pct|notes/);
    assert.match(calls[0].select, /ends_on/);
    assert.match(calls[0].select, /artists_db \( user_id, username, name, profile_picture, styles_array, session_price \)/);
    assert.deepEqual(plain(result.data[0]), { membership_id: 'm1', artist_user_id: 'a1', role: 'guest', ends_on: '2026-12-01', artists_db: { user_id: 'a1' }, id: 'm1', status: 'active' });
});

for (const code of ['42P01', 'PGRST205']) {
    test(`listActiveRosterWithArtists cae a la tabla si la vista no existe (${code})`, async () => {
        const { D, calls } = load({
            respond: (q) => q.table === 'studio_public_roster' ? fail(code)
                : { data: [{ id: 'm1', role: 'resident', status: 'active', artists_db: { user_id: 'a1' } }], error: null },
        });
        const result = await D.StudioMemberships.listActiveRosterWithArtists('studio');
        assert.deepEqual(calls.map((c) => c.table), ['studio_public_roster', 'studio_artist_memberships']);
        assert.ok(has(calls[1], 'eq', 'status', 'active'));
        assert.ok(has(calls[1], 'eq', 'studio_id', 'studio'));
        assert.match(calls[1].select, /artists_db \(/);
        assert.equal(result.error, null);
        assert.equal(result.data[0].membership_id, 'm1');
        assert.equal(result.data[0].ends_on, null);
        assert.equal(result.data[0].artists_db.user_id, 'a1');
    });
}

test('listActiveRosterWithArtists resuelve artistas aparte si la vista no admite el embed (PGRST200)', async () => {
    const { D, calls } = load({
        respond: (q) => {
            if (q.table === 'studio_public_roster' && /artists_db/.test(q.select)) return fail('PGRST200');
            if (q.table === 'studio_public_roster') return { data: [{ membership_id: 'm1', artist_user_id: 'a1' }, { membership_id: 'm2', artist_user_id: 'a2' }, { membership_id: 'm3', artist_user_id: 'a1' }], error: null };
            return { data: [{ user_id: 'a1', name: 'Ana' }], error: null };
        },
    });
    const result = await D.StudioMemberships.listActiveRosterWithArtists('studio');
    assert.deepEqual(calls.map((c) => c.table), ['studio_public_roster', 'studio_public_roster', 'artists_db']);
    assert.deepEqual(plain(calls[2].filters), [['in', 'user_id', ['a1', 'a2']]]);
    assert.deepEqual(plain(result.data.map((row) => row.artists_db && row.artists_db.name)), ['Ana', null, 'Ana']);
    assert.equal(result.data[1].status, 'active');
});

test('listActiveRosterWithArtists devuelve otros errores de la vista sin caer a la tabla', async () => {
    const { D, calls } = load({ respond: () => fail('42501', 'permission denied') });
    const result = await D.StudioMemberships.listActiveRosterWithArtists('studio');
    assert.equal(calls.length, 1);
    assert.equal(result.error.code, '42501');
});

test('listForArtistV2 pide initiated_by y current_contract_id y reintenta con INVITE_COLS', async () => {
    const { D, calls } = load({
        respond: (q) => /initiated_by/.test(q.select) ? fail('42703', 'column initiated_by does not exist')
            : { data: [{ id: 'm1', status: 'pending_acceptance' }], error: null },
    });
    const result = await D.StudioMemberships.listForArtistV2('artist', { status: ['requested', 'pending_acceptance'] });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].select, `${D.StudioMemberships.INVITE_COLS}, initiated_by, current_contract_id`);
    assert.equal(calls[1].select, D.StudioMemberships.INVITE_COLS);
    for (const q of calls) {
        assert.ok(has(q, 'eq', 'artist_user_id', 'artist'));
        assert.ok(has(q, 'in', 'status', ['requested', 'pending_acceptance']));
    }
    assert.equal(result.legacy, true);
    assert.deepEqual(plain(result.data), [{ id: 'm1', status: 'pending_acceptance', initiated_by: 'studio', current_contract_id: null }]);
});

test('listForArtistV2 no reintenta ante errores que no son de columna', async () => {
    const { D, calls } = load({ respond: () => fail('42501') });
    const result = await D.StudioMemberships.listForArtistV2('artist');
    assert.equal(calls.length, 1);
    assert.equal(result.error.code, '42501');
    assert.ok(!calls[0].filters.some((f) => f[1] === 'status'), 'sin status no filtra');
});

test('listRosterV2 usa el filtro de listRoster y cae a listRoster sin las columnas nuevas', async () => {
    const { D, calls } = load({
        respond: (q) => /current_contract_id/.test(q.select) ? fail('PGRST204') : { data: [{ id: 'm1', initiated_by: undefined }], error: null },
    });
    const result = await D.StudioMemberships.listRosterV2('studio');
    assert.equal(calls.length, 2);
    assert.match(calls[0].select, /initiated_by, current_contract_id/);
    for (const q of calls) assert.ok(has(q, 'in', 'status', ['active', 'pending_acceptance', 'paused']));
    // El fallback es listRoster tal cual (su select no cambio).
    const reference = load();
    reference.D.StudioMemberships.listRoster('studio');
    assert.equal(calls[1].select, reference.calls[0].select);
    assert.equal(result.legacy, true);
    assert.equal(result.data[0].initiated_by, 'studio');
    assert.equal(result.data[0].current_contract_id, null);
});

// ============================================================
// StudioSpots
// ============================================================

test('decideApplicationRpc y respondCounterOffer usan las RPCs existentes', async () => {
    const { D, calls } = load();
    await D.StudioSpots.decideApplicationRpc('app', 'accepted');
    await D.StudioSpots.respondCounterOffer('offer', 'accepted');
    await D.StudioSpots.respondCounterOffer('offer', 'reject');
    let result;
    assert.doesNotThrow(() => { result = D.StudioSpots.respondCounterOffer('offer', 'otra'); });
    await result;
    assert.deepEqual(plain(calls.map((c) => [c.rpc, c.args])), [
        ['decide_studio_spot_application', { p_application_id: 'app', p_status: 'accepted' }],
        ['respond_to_studio_spot_counter_offer', { p_offer_id: 'offer', p_action: 'accept' }],
        ['respond_to_studio_spot_counter_offer', { p_offer_id: 'offer', p_action: 'reject' }],
        ['respond_to_studio_spot_counter_offer', { p_offer_id: 'offer', p_action: 'otra' }],
    ]);
});

test('listOpenByStudio pide benefit_tags y reintenta sin la columna', async () => {
    const { D, calls } = load({
        respond: (q) => /benefit_tags/.test(q.select) ? fail('42703') : { data: [{ id: 'spot' }], error: null },
    });
    const result = await D.StudioSpots.listOpenByStudio('studio');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].select, 'id, title, kind, start_date, end_date, application_count, benefit_tags');
    assert.equal(calls[1].select, 'id, title, kind, start_date, end_date, application_count');
    for (const q of calls) {
        assert.equal(q.table, 'studio_spots');
        assert.ok(has(q, 'eq', 'studio_id', 'studio'));
        assert.ok(has(q, 'eq', 'status', 'open'));
    }
    assert.deepEqual(plain(result.data), [{ id: 'spot', benefit_tags: [] }]);
    assert.equal(result.legacy, true);
});

test('listArtistCounterOffersForStudio trae contraofertas pending de artistas a spots del estudio', async () => {
    const { D, calls } = load({ count: 1 });
    await D.StudioSpots.listArtistCounterOffersForStudio('studio');
    const q = calls[0];
    assert.equal(q.table, 'studio_spot_counter_offers');
    assert.match(q.select, /studio_spot_applications!inner \(.*studio_spots!inner \( id, title, kind, studio_id \).*artists_db \(/);
    assert.ok(has(q, 'eq', 'studio_spot_applications.studio_spots.studio_id', 'studio'));
    assert.ok(has(q, 'eq', 'author_role', 'artist'));
    assert.ok(has(q, 'eq', 'status', 'pending'));
});

// ============================================================
// StudioOps
// ============================================================

test('listBookingsRange trae las citas superpuestas al rango en todas las paginas', async () => {
    const { D, calls } = load({ count: 1201 });
    const result = await D.StudioOps.listBookingsRange('studio', '2026-11-01T00:00:00Z', '2026-11-08T00:00:00Z');
    assert.equal(result.data.length, 1201);
    assert.deepEqual(calls.map((c) => c.range), [[0, 499], [500, 999], [1000, 1499]]);
    for (const q of calls) {
        assert.equal(q.table, 'studio_bookings');
        assert.ok(has(q, 'eq', 'studio_id', 'studio'));
        assert.ok(has(q, 'lt', 'starts_at', '2026-11-08T00:00:00Z'));
        assert.ok(has(q, 'gt', 'ends_at', '2026-11-01T00:00:00Z'));
        assert.deepEqual(orderKeys(q), ['starts_at', 'id']);
    }
});

test('checkBookingAvailability y listArtistBusyBlocks llaman a las RPCs de agenda', async () => {
    const { D, calls } = load({ count: 3 });
    await D.StudioOps.checkBookingAvailability('studio', 'artist', '2026-11-01T10:00:00Z', '2026-11-01T12:00:00Z');
    const busy = await D.StudioOps.listArtistBusyBlocks('studio', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z');
    assert.deepEqual(plain(calls[0].args), { p_studio_id: 'studio', p_artist_user_id: 'artist', p_starts: '2026-11-01T10:00:00Z', p_ends: '2026-11-01T12:00:00Z', p_exclude_booking: null });
    assert.equal(calls[0].rpc, 'check_studio_booking_availability');
    assert.equal(calls[1].rpc, 'list_studio_artist_busy_blocks');
    assert.deepEqual(plain(calls[1].args), { p_studio_id: 'studio', p_from: '2026-11-01T00:00:00Z', p_to: '2026-12-01T00:00:00Z' });
    assert.deepEqual(orderKeys(calls[1]), ['artist_user_id', 'starts_at', 'ends_at', 'source']);
    assert.deepEqual(calls[1].range, [0, 499]);
    assert.equal(busy.data.length, 3);
});

test('listArtistBusyBlocks y los materiales quedan vacios sin la migracion', async () => {
    const { D } = load({ respond: () => fail('PGRST202') });
    for (const result of await Promise.all([
        D.StudioOps.listArtistBusyBlocks('s', 'a', 'b'),
        D.StudioOps.listMaterialBalance('s'),
        D.StudioOps.listMaterialAssignmentsMonthly('s', '2026-01-15', '2026-10-31'),
        D.StudioOps.listMyMaterialAssignments(),
        D.StudioOps.listBookingsForArtist('a', 'x', 'y'),
    ])) {
        assert.deepEqual(plain(result), { data: [], error: null, unavailable: true });
    }
});

test('listBookingsForArtist embebe el estudio y filtra por artista', async () => {
    const { D, calls } = load({ count: 2 });
    await D.StudioOps.listBookingsForArtist('artist', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z');
    const q = calls[0];
    assert.equal(q.table, 'studio_bookings');
    assert.match(q.select, /studios\(name, slug\)/);
    assert.ok(has(q, 'eq', 'artist_user_id', 'artist'));
    assert.ok(has(q, 'lt', 'starts_at', '2026-12-01T00:00:00Z'));
    assert.ok(has(q, 'gt', 'ends_at', '2026-11-01T00:00:00Z'));
});

test('materiales y metricas leen sus vistas con el mes normalizado al dia 1', async () => {
    const { D, calls } = load({ count: 1 });
    await D.StudioOps.listMaterialBalance('studio');
    await D.StudioOps.listMaterialAssignmentsMonthly('studio', '2026-03-15', '2026-10-31');
    await D.StudioOps.listMyMaterialAssignments();
    await D.StudioOps.listMonthlyMetrics('studio', '2026-01-20', '2026-06-30');
    assert.equal(calls[0].table, 'studio_artist_material_balance');
    assert.deepEqual(orderKeys(calls[0]), ['artist_user_id', 'item_id']);
    assert.equal(calls[1].table, 'studio_material_assignment_monthly');
    assert.ok(has(calls[1], 'gte', 'month', '2026-03-01'));
    assert.ok(has(calls[1], 'lte', 'month', '2026-10-31'));
    assert.equal(calls[2].rpc, 'list_my_studio_material_assignments');
    assert.equal(calls[3].table, 'studio_monthly_metrics_by_currency');
    assert.ok(has(calls[3], 'eq', 'studio_id', 'studio'));
    assert.ok(has(calls[3], 'gte', 'month', '2026-01-01'));
    assert.ok(has(calls[3], 'lte', 'month', '2026-06-30'));
    assert.deepEqual(orderKeys(calls[3]), ['month', 'currency']);
});

test('listRestockCandidates embebe el producto Supplies y cae a las columnas de listInventoryItems', async () => {
    const { D, calls } = load({
        respond: (q) => /supply_products/.test(q.select) ? fail('PGRST200') : { data: [{ id: 'item' }], error: null },
    });
    const result = await D.StudioOps.listRestockCandidates('studio');
    assert.equal(calls.length, 2);
    assert.match(calls[0].select, /supply_product_id, supply_products!supply_product_id \( id, name, price, currency, vendor_id, unit_label, pack_size \)/);
    const reference = load({ count: 0 });
    await reference.D.StudioOps.listInventoryItems('studio');
    assert.equal(calls[1].select, reference.calls[0].select);
    for (const q of calls) {
        assert.ok(has(q, 'eq', 'studio_id', 'studio'));
        assert.ok(has(q, 'eq', 'is_active', true));
        assert.ok(orderKeys(q).includes('id'));
    }
    assert.deepEqual(plain(result.data), [{ id: 'item', supply_product_id: null, supply_products: null }]);
    assert.equal(result.legacy, true);
});

test('listInventoryMovements suma unit_cost y related_artist_user_id', async () => {
    const { D, calls } = load();
    await D.StudioOps.listInventoryMovements('item');
    assert.equal(calls[0].select, 'id,kind,quantity,performed_at,notes,unit_cost,related_artist_user_id');
    assert.ok(has(calls[0], 'eq', 'item_id', 'item'));
    assert.equal(calls[0].limit, 100);
});

// ============================================================
// Studios (reclamo)
// ============================================================

test('listUnownedStudios no consulta con menos de 2 caracteres y traga la RPC ausente', async () => {
    const empty = load();
    assert.deepEqual(plain(await empty.D.Studios.listUnownedStudios(' a ')), { data: [], error: null });
    assert.equal(empty.calls.length, 0);
    await empty.D.Studios.listUnownedStudios('  Tinta  ');
    assert.deepEqual(plain(empty.calls[0]), { rpc: 'list_unowned_studios', args: { p_query: 'Tinta' }, filters: [], ordering: [] });
    const missing = load({ respond: () => fail('42883') });
    assert.deepEqual(plain(await missing.D.Studios.listUnownedStudios('tinta')), { data: [], error: null, unavailable: true });
});

test('requestClaim y getMyClaim usan studio_claim_requests del usuario de la sesion', async () => {
    const { D, calls } = load({ respond: (q) => q.rpc ? { data: 'claim', error: null } : { data: { id: 'claim', status: 'pending' }, error: null } });
    await D.Studios.requestClaim('studio', 'Soy el dueno', 'Ana');
    const claim = await D.Studios.getMyClaim();
    assert.deepEqual(plain(calls[0].args), { p_studio_id: 'studio', p_evidence: 'Soy el dueno', p_contact_name: 'Ana', p_contact_phone: null });
    assert.equal(calls[0].rpc, 'request_studio_claim');
    assert.equal(calls[1].table, 'studio_claim_requests');
    assert.ok(has(calls[1], 'eq', 'user_id', 'user-me'));
    assert.match(calls[1].select, /decision_note/);
    assert.match(calls[1].select, /studios:studio_id \(/);
    assert.equal(calls[1].limit, 1);
    assert.equal(calls[1].maybeSingle, true);
    assert.equal(claim.data.status, 'pending');
    const missing = load({ respond: () => fail('42P01') });
    assert.deepEqual(plain(await missing.D.Studios.getMyClaim()), { data: null, error: null, unavailable: true });
});

// ============================================================
// StudioContracts
// ============================================================

test('StudioContracts lista por estudio y por artista con embeds y filtro de status', async () => {
    const { D, calls } = load({ count: 501 });
    const studio = await D.StudioContracts.listForStudio('studio', { status: ['sent', 'signed'] });
    await D.StudioContracts.listForArtist('artist', { status: 'sent' });
    assert.equal(studio.data.length, 501);
    const [first, second, artist] = calls;
    assert.equal(first.table, 'studio_contracts');
    assert.match(first.select, /artists_db \(/);
    assert.match(first.select, /studio_spots \( id, title, kind \)/);
    assert.ok(has(first, 'eq', 'studio_id', 'studio'));
    assert.ok(has(first, 'in', 'status', ['sent', 'signed']));
    assert.ok(has(second, 'in', 'status', ['sent', 'signed']), 'el filtro se conserva en todas las paginas');
    assert.ok(orderKeys(first).includes('id'));
    assert.match(artist.select, /studios \(/);
    assert.ok(has(artist, 'eq', 'artist_user_id', 'artist'));
    assert.ok(has(artist, 'eq', 'status', 'sent'));
});

test('StudioContracts traga la migracion pendiente en listados, contrato vigente y vencimientos', async () => {
    const { D } = load({ respond: () => fail('42P01') });
    assert.deepEqual(plain(await D.StudioContracts.listForStudio('s')), { data: [], error: null, unavailable: true });
    assert.deepEqual(plain(await D.StudioContracts.listForArtist('a')), { data: [], error: null, unavailable: true });
    const rpcMissing = load({ respond: () => fail('PGRST202') });
    assert.deepEqual(plain(await rpcMissing.D.StudioContracts.getCurrentForMembership('m')), { data: null, error: null, unavailable: true });
    assert.deepEqual(plain(await rpcMissing.D.StudioContracts.expireOverdue('s')), { data: 0, error: null, unavailable: true });
    // Las acciones si devuelven el error para que la UI lo muestre.
    const sign = await rpcMissing.D.StudioContracts.sign('c', 'Ana Perez', true);
    assert.equal(sign.error.code, 'PGRST202');
});

test('StudioContracts llama a cada RPC del ciclo de vida con sus argumentos', async () => {
    const { D, calls } = load();
    const draft = { id: 'c', compensation_model: 'percentage', artist_percentage: 70 };
    await D.StudioContracts.get('c');
    await D.StudioContracts.getCurrentForMembership('m');
    await D.StudioContracts.saveDraft(draft);
    await D.StudioContracts.prepareFromApplication('app');
    await D.StudioContracts.prepareForMembership('m');
    await D.StudioContracts.issue('c', 'Estudio Dueno');
    await D.StudioContracts.issue('c', 'Estudio Dueno', '2026-11-15T00:00:00Z');
    await D.StudioContracts.sign('c', 'Ana Perez', 'true');
    await D.StudioContracts.sign('c', 'Ana Perez', true);
    await D.StudioContracts.decline('c');
    await D.StudioContracts.cancel('c', 'Error');
    await D.StudioContracts.terminate('c', 'Fin');
    await D.StudioContracts.terminate('c', 'Fin', false);
    await D.StudioContracts.expireOverdue();
    assert.equal(calls[0].table, 'studio_contracts');
    assert.ok(has(calls[0], 'eq', 'id', 'c'));
    assert.equal(calls[0].maybeSingle, true);
    assert.deepEqual(plain(calls.slice(1).map((c) => [c.rpc, c.args])), [
        ['get_current_contract_for_membership', { p_membership_id: 'm' }],
        ['save_studio_contract_draft', { p_contract: draft }],
        ['prepare_contract_from_application', { p_application_id: 'app' }],
        ['prepare_contract_for_membership', { p_membership_id: 'm' }],
        ['issue_studio_contract', { p_contract_id: 'c', p_signer_name: 'Estudio Dueno', p_expires_at: null }],
        ['issue_studio_contract', { p_contract_id: 'c', p_signer_name: 'Estudio Dueno', p_expires_at: '2026-11-15T00:00:00Z' }],
        ['sign_studio_contract', { p_contract_id: 'c', p_signer_name: 'Ana Perez', p_accept_terms: false }],
        ['sign_studio_contract', { p_contract_id: 'c', p_signer_name: 'Ana Perez', p_accept_terms: true }],
        ['decline_studio_contract', { p_contract_id: 'c', p_reason: null }],
        ['cancel_studio_contract', { p_contract_id: 'c', p_reason: 'Error' }],
        ['terminate_studio_contract', { p_contract_id: 'c', p_reason: 'Fin', p_end_membership: true }],
        ['terminate_studio_contract', { p_contract_id: 'c', p_reason: 'Fin', p_end_membership: false }],
        ['expire_studio_contracts', { p_studio_id: null }],
    ]);
});

// ============================================================
// StudioFinance
// ============================================================

test('listEntries aplica periodo, tipo, categoria y excluye anulados por defecto en todas las paginas', async () => {
    const { D, calls } = load({ count: 1201 });
    const result = await D.StudioFinance.listEntries('studio', { from: '2026-10-01', to: '2026-10-31', type: 'expense', category: ['rent', 'supplies'] });
    assert.equal(result.data.length, 1201);
    assert.equal(new Set(result.data.map((row) => row.id)).size, 1201);
    assert.equal(calls.length, 3);
    for (const q of calls) {
        assert.equal(q.table, 'studio_finance_entries');
        assert.ok(has(q, 'eq', 'studio_id', 'studio'));
        assert.ok(has(q, 'gte', 'occurred_on', '2026-10-01'));
        assert.ok(has(q, 'lte', 'occurred_on', '2026-10-31'));
        assert.ok(has(q, 'eq', 'entry_type', 'expense'));
        assert.ok(has(q, 'in', 'category', ['rent', 'supplies']));
        assert.ok(has(q, 'eq', 'status', 'recorded'));
        assert.ok(orderKeys(q).includes('id'));
    }
    const voided = load();
    await voided.D.StudioFinance.listEntries('studio', { includeVoided: true });
    assert.ok(!voided.calls[0].filters.some((f) => f[1] === 'status'));
    const missing = load({ respond: () => fail('42P01') });
    assert.deepEqual(plain(await missing.D.StudioFinance.listEntries('studio')), { data: [], error: null, unavailable: true });
});

test('saveEntry solo envia columnas editables y voidEntry anula filas registradas', async () => {
    const { D, calls } = load();
    const entry = { studio_id: 'studio', entry_type: 'expense', category: 'rent', description: 'Alquiler', amount: 1000, currency: 'ARS', occurred_on: '2026-10-01',
        status: 'voided', supply_order_id: 'order', created_by_user_id: 'x', studio_suppliers: { name: 'P' }, inventado: 1 };
    await D.StudioFinance.saveEntry(entry);
    await D.StudioFinance.saveEntry({ ...entry, id: 'entry', amount: 1200 });
    await D.StudioFinance.voidEntry('entry', 'Duplicado');
    const [insert, update, voidCall] = calls;
    assert.deepEqual(plain(insert.insert), { studio_id: 'studio', entry_type: 'expense', category: 'rent', description: 'Alquiler', amount: 1000, currency: 'ARS', occurred_on: '2026-10-01' });
    assert.equal(insert.single, true);
    assert.deepEqual(plain(update.update), { entry_type: 'expense', category: 'rent', description: 'Alquiler', amount: 1200, currency: 'ARS', occurred_on: '2026-10-01' });
    assert.ok(has(update, 'eq', 'id', 'entry'));
    assert.equal(voidCall.update.status, 'voided');
    assert.equal(voidCall.update.void_reason, 'Duplicado');
    assert.ok(voidCall.update.voided_at);
    assert.ok(has(voidCall, 'eq', 'status', 'recorded'));
});

test('monthlyByCategory lee la vista mensual con el inicio llevado al dia 1', async () => {
    const { D, calls } = load({ count: 2 });
    await D.StudioFinance.monthlyByCategory('studio', '2026-05-17', '2026-10-31');
    assert.equal(calls[0].table, 'studio_finance_monthly_by_category');
    assert.ok(has(calls[0], 'gte', 'month', '2026-05-01'));
    assert.ok(has(calls[0], 'lte', 'month', '2026-10-31'));
    assert.deepEqual(orderKeys(calls[0]), ['month', 'currency', 'entry_type', 'category']);
});

// ============================================================
// Supplies: estimateOrder (pura)
// ============================================================

const { estimateOrder } = require('../public/shared/js/data/supplies-repo.js');

test('estimateOrder suma lineas en centavos enteros sin errores de coma flotante', () => {
    const result = estimateOrder({ currency: 'ARS', platform_discount_pct: 0 }, [], [
        { unit_price: 0.1, quantity: 3 },
        { unit_price: '0.2', quantity: 1 },
        { price: 1234.56, quantity: 1.5 },
        { product: { price: 0.33 }, qty: 1.5 },
    ]);
    assert.deepEqual(result.lines.map((line) => line.line_subtotal), [0.3, 0.2, 1851.84, 0.5]);
    assert.equal(result.subtotal, 1852.84);
    assert.equal(result.discount, 0);
    assert.equal(result.total, 1852.84);
    assert.equal(result.currency, 'ARS');
});

test('estimateOrder: la linea de mayor subtotal absorbe la diferencia de redondeo del descuento', () => {
    const result = estimateOrder({ currency: 'ARS', platform_discount_pct: 10 }, [], [
        { unit_price: 0.05, quantity: 1 },
        { unit_price: 0.15, quantity: 1 },
        { unit_price: 0.05, quantity: 1 },
    ]);
    // Por linea: round(0.005)=0.01, round(0.015)=0.02, round(0.005)=0.01 -> 0.04;
    // sobre el subtotal: round(0.025)=0.03. La linea de 0.15 absorbe -0.01.
    assert.equal(result.subtotal, 0.25);
    assert.equal(result.pct, 10);
    assert.equal(result.discount, 0.03);
    assert.equal(result.total, 0.22);
    assert.deepEqual(result.lines.map((line) => line.line_discount), [0.01, 0.01, 0.01]);
    assert.deepEqual(result.lines.map((line) => line.line_total), [0.04, 0.14, 0.04]);
    const discountCents = result.lines.reduce((sum, line) => sum + Math.round(line.line_discount * 100), 0);
    assert.equal(discountCents, Math.round(result.discount * 100));
});

test('estimateOrder reparte el redondeo sin dejar descuentos negativos cuando no entra en una sola linea', () => {
    // 4 lineas de 0.01 al 50%: cada una redondea a 0.01 (0.04) pero el
    // descuento total es round(0.02)=0.02. Como en el servidor, la primera
    // linea absorbe -0.01 (hasta 0) y la segunda el resto.
    const result = estimateOrder({ currency: 'ARS', platform_discount_pct: 50 }, [], Array.from({ length: 4 }, () => ({ unit_price: 0.01, quantity: 1 })));
    assert.equal(result.discount, 0.02);
    assert.deepEqual(result.lines.map((line) => line.line_discount), [0, 0, 0.01, 0.01]);
    assert.ok(result.lines.every((line) => line.line_discount >= 0 && line.line_total >= 0));
});

test('estimateOrder suma el mejor tier alcanzado de la moneda del vendor con tope de 60%', () => {
    const tiers = [
        { min_subtotal: 100, discount_pct: 5, currency: 'ARS' },
        { min_subtotal: 500, discount_pct: 10, currency: 'ARS' },
        { min_subtotal: 1000, discount_pct: 15, currency: 'ARS' },
        { min_subtotal: 0, discount_pct: 40, currency: 'USD' },
    ];
    const result = estimateOrder({ currency: 'ARS', platform_discount_pct: 8.5 }, tiers, [{ unit_price: 200, quantity: 3 }]);
    assert.equal(result.subtotal, 600);
    assert.equal(result.tierPct, 10);
    assert.equal(result.pct, 18.5);
    assert.equal(result.discount, 111);
    assert.equal(result.total, 489);
    const capped = estimateOrder({ currency: 'ARS', platform_discount_pct: 50 }, [{ min_subtotal: 0, discount_pct: 20, currency: 'ARS' }], [{ unit_price: 100, quantity: 1 }]);
    assert.equal(capped.pct, 60);
    assert.equal(capped.total, 40);
});

test('estimateOrder marca envio gratis sobre el total con descuento y el minimo sobre el subtotal', () => {
    const vendor = { currency: 'ARS', platform_discount_pct: 10, free_shipping_threshold: 900, min_order_amount: 1000.01 };
    const below = estimateOrder(vendor, [], [{ unit_price: 1000, quantity: 1 }]);
    assert.equal(below.total, 900);
    assert.equal(below.freeShipping, true, 'el umbral es inclusivo');
    assert.equal(below.belowMinimum, true);
    assert.equal(below.missingForMinimum, 0.01);
    const short = estimateOrder({ ...vendor, free_shipping_threshold: 900.01 }, [], [{ unit_price: 1000, quantity: 1 }]);
    assert.equal(short.freeShipping, false);
    assert.equal(short.missingForFreeShipping, 0.01);
    const none = estimateOrder({ currency: 'ARS' }, null, [{ unit_price: 10, quantity: 1 }]);
    assert.equal(none.freeShipping, false);
    assert.equal(none.freeShippingThreshold, null);
    assert.equal(none.belowMinimum, false);
});

test('estimateOrder ignora lineas invalidas y no les asigna el redondeo', () => {
    const result = estimateOrder({ currency: 'ARS', platform_discount_pct: 10 }, [], [
        { unit_price: 999, quantity: 0 },
        { quantity: 2 },
        { unit_price: 0.05, quantity: 1 },
        { unit_price: 0.05, quantity: 2 },
    ]);
    assert.deepEqual(result.lines.map((line) => line.valid), [false, false, true, true]);
    assert.equal(result.subtotal, 0.15);
    assert.equal(result.discount, 0.02);
    assert.deepEqual(result.lines.map((line) => line.line_discount), [0, 0, 0.01, 0.01]);
    assert.deepEqual(plain(estimateOrder(null, null, null)).subtotal, 0);
});

test('WeotziData.Supplies.estimateOrder es la misma funcion que exporta Node', () => {
    const { D } = load();
    const args = [{ currency: 'USD', platform_discount_pct: 7, free_shipping_threshold: 50 }, [{ min_subtotal: 20, discount_pct: 3, currency: 'USD' }], [{ unit_price: 12.34, quantity: 3 }]];
    assert.deepEqual(plain(D.Supplies.estimateOrder(...args)), plain(estimateOrder(...args)));
});

// ============================================================
// Supplies: repositorio
// ============================================================

test('searchCatalog filtra productos activos de vendors verificados y busca por nombre, marca o SKU', async () => {
    const { D, calls } = load({ count: 3 });
    await D.Supplies.searchCatalog({ search: 'tinta, negra', category: 'inks', vendorId: 'vendor', limit: 24 });
    await D.Supplies.searchCatalog();
    const [limited, paged] = calls;
    assert.equal(limited.table, 'supply_products');
    assert.match(limited.select, /supply_vendors!inner \( id, name, slug, logo_image, currency, platform_discount_pct, benefits, free_shipping_threshold, min_order_amount, ships_to_countries, is_verified/);
    assert.ok(has(limited, 'eq', 'is_active', true));
    assert.ok(has(limited, 'eq', 'supply_vendors.is_verified', true));
    assert.ok(has(limited, 'eq', 'supply_vendors.is_active', true));
    assert.ok(has(limited, 'eq', 'category', 'inks'));
    assert.ok(has(limited, 'eq', 'vendor_id', 'vendor'));
    assert.ok(has(limited, 'or', 'name.ilike."%tinta, negra%",brand.ilike."%tinta, negra%",sku.ilike."%tinta, negra%"'));
    assert.equal(limited.limit, 24);
    assert.equal(limited.range, undefined);
    assert.deepEqual(paged.range, [0, 499]);
    assert.ok(orderKeys(paged).includes('id'));
});

test('listVendors y getVendor no exponen user_id ni el email de login', async () => {
    const { D, calls } = load({ count: 1 });
    await D.Supplies.listVendors({ search: 'ink' });
    await D.Supplies.getVendor('v');
    await D.Supplies.getVendorBySlug('ink-house');
    await D.Supplies.getVendorByUserId('uid');
    assert.ok(has(calls[0], 'eq', 'is_verified', true));
    assert.ok(has(calls[0], 'eq', 'is_active', true));
    assert.ok(has(calls[0], 'ilike', 'name', '%ink%'));
    for (const q of calls.slice(0, 3)) assert.doesNotMatch(q.select, /\buser_id\b|(^|[ ,])email\b/);
    assert.ok(has(calls[2], 'eq', 'slug', 'ink-house'));
    assert.equal(calls[3].select, '*');
    assert.ok(has(calls[3], 'eq', 'user_id', 'uid'));
    const missing = load({ respond: () => fail('42P01') });
    assert.deepEqual(plain(await missing.D.Supplies.getVendorByUserId('uid')), { data: null, error: null, unavailable: true });
});

test('updateVendor, saveProduct y saveTier descartan columnas protegidas', async () => {
    const { D, calls } = load();
    await D.Supplies.updateVendor('v', { name: 'Ink', slug: 'otro', email: 'x@y.z', is_verified: true, user_id: 'u', benefits: ['Envio'] });
    await D.Supplies.saveProduct({ vendor_id: 'v', name: 'Tinta', category: 'inks', price: 10, currency: 'ARS', supply_vendors: {} });
    await D.Supplies.saveProduct({ id: 'p', vendor_id: 'v', price: 12 });
    await D.Supplies.archiveProduct('p');
    await D.Supplies.saveTier({ vendor_id: 'v', min_subtotal: 100, discount_pct: 5, currency: 'ARS' });
    await D.Supplies.deleteTier('t');
    assert.deepEqual(plain(calls[0].update), { name: 'Ink', benefits: ['Envio'] });
    assert.deepEqual(plain(calls[1].insert), { name: 'Tinta', category: 'inks', price: 10, currency: 'ARS', vendor_id: 'v' });
    assert.deepEqual(plain(calls[2].update), { price: 12 });
    assert.ok(has(calls[2], 'eq', 'id', 'p'));
    assert.deepEqual(plain(calls[3].update), { is_active: false });
    assert.equal(calls[4].table, 'supply_discount_tiers');
    assert.deepEqual(plain(calls[4].insert), { min_subtotal: 100, currency: 'ARS', discount_pct: 5, vendor_id: 'v' });
    assert.equal(calls[5].delete, true);
});

test('saveVendorPrivate actualiza y, si la fila no existe, la crea', async () => {
    const { D, calls } = load({ respond: (q) => ({ data: q.update ? null : { vendor_id: 'v' }, error: null }) });
    const result = await D.Supplies.saveVendorPrivate('v', { legal_name: 'Ink SRL', otra: 1 });
    assert.equal(calls.length, 2);
    assert.deepEqual(plain(calls[0].update), { legal_name: 'Ink SRL' });
    assert.ok(has(calls[0], 'eq', 'vendor_id', 'v'));
    assert.deepEqual(plain(calls[1].insert), { legal_name: 'Ink SRL', vendor_id: 'v' });
    assert.equal(result.data.vendor_id, 'v');
});

test('submitOrder, cancelOrder, receiveOrder y vendorUpdateOrder normalizan sus argumentos', async () => {
    const { D, calls } = load();
    await D.Supplies.completeRegistration({ name: 'Ink' });
    await D.Supplies.submitOrder({ studioId: 's', vendorId: 'v', locationId: 'loc', items: [{ productId: 'p1', quantity: '2', inventoryItemId: 'i1' }, { product_id: 'p2', quantity: 1 }] });
    await D.Supplies.cancelOrder('o');
    await D.Supplies.receiveOrder('o', [{ itemId: 'l1', receivedQuantity: '3' }, { item_id: 'l2', received_quantity: 0 }]);
    await D.Supplies.receiveOrder('o');
    await D.Supplies.vendorUpdateOrder('o', 'confirm', { shippingAmount: 0 });
    await D.Supplies.vendorUpdateOrder('o', 'ship', { trackingCode: 'AR123', estimatedDelivery: '2026-11-10', note: 'Sale hoy' });
    assert.deepEqual(plain(calls.map((c) => [c.rpc, c.args])), [
        ['complete_supply_vendor_registration', { p_profile: { name: 'Ink' } }],
        ['submit_supply_order', { p_studio_id: 's', p_vendor_id: 'v', p_location_id: 'loc', p_items: [{ product_id: 'p1', quantity: 2, inventory_item_id: 'i1' }, { product_id: 'p2', quantity: 1 }], p_notes: null }],
        ['cancel_supply_order', { p_order_id: 'o', p_note: null }],
        ['receive_supply_order', { p_order_id: 'o', p_lines: [{ item_id: 'l1', received_quantity: 3 }, { item_id: 'l2', received_quantity: 0 }] }],
        ['receive_supply_order', { p_order_id: 'o', p_lines: null }],
        ['vendor_update_supply_order', { p_order_id: 'o', p_action: 'confirm', p_shipping_amount: 0, p_tracking_code: null, p_estimated_delivery: null, p_note: null }],
        ['vendor_update_supply_order', { p_order_id: 'o', p_action: 'ship', p_shipping_amount: null, p_tracking_code: 'AR123', p_estimated_delivery: '2026-11-10', p_note: 'Sale hoy' }],
    ]);
});

test('pedidos: listados por estudio/vendor y detalle con items (sort_order) y eventos ordenados', async () => {
    const { D, calls } = load({
        respond: (q) => q.maybeSingle ? { data: {
            id: 'o',
            supply_order_items: [{ id: '1', product_name: 'Guantes', sort_order: 2 }, { id: '2', product_name: 'Agujas', sort_order: 1 }],
            supply_order_events: [{ id: 'b', created_at: '2026-10-30T12:00:00Z' }, { id: 'a', created_at: '2026-10-30T10:00:00Z' }],
        }, error: null } : { data: [], error: null },
    });
    await D.Supplies.listOrdersForStudio('studio', { status: ['shipped', 'delivered'] });
    await D.Supplies.listOrdersForVendor('vendor', { status: 'submitted' });
    const order = await D.Supplies.getOrder('o');
    assert.equal(calls[0].table, 'supply_orders');
    assert.ok(has(calls[0], 'eq', 'studio_id', 'studio'));
    assert.ok(has(calls[0], 'in', 'status', ['shipped', 'delivered']));
    assert.match(calls[0].select, /supply_vendors \(/);
    assert.ok(orderKeys(calls[0]).includes('id'));
    assert.ok(has(calls[1], 'eq', 'vendor_id', 'vendor'));
    assert.ok(has(calls[1], 'eq', 'status', 'submitted'));
    assert.match(calls[1].select, /studios \(/);
    assert.match(calls[2].select, /supply_order_items \( \* \), supply_order_events \( \* \), studios \(.*studio_locations \(.*supply_vendors \(/);
    assert.deepEqual(order.data.supply_order_items.map((item) => item.product_name), ['Agujas', 'Guantes']);
    assert.deepEqual(order.data.supply_order_events.map((event) => event.id), ['a', 'b']);
});

test('reportes del vendor leen sus vistas y quedan vacios sin la migracion', async () => {
    const { D, calls } = load({ count: 1 });
    await D.Supplies.vendorSalesMonthly('vendor', '2026-04-09', '2026-10-31');
    await D.Supplies.vendorCustomers('vendor');
    await D.Supplies.listTiers('vendor');
    await D.Supplies.listProducts('vendor', { includeInactive: true });
    assert.equal(calls[0].table, 'supply_vendor_sales_monthly');
    assert.ok(has(calls[0], 'gte', 'month', '2026-04-01'));
    assert.equal(calls[1].table, 'supply_vendor_customers');
    assert.ok(has(calls[1], 'eq', 'vendor_id', 'vendor'));
    assert.equal(calls[2].table, 'supply_discount_tiers');
    assert.ok(!calls[3].filters.some((f) => f[1] === 'is_active'));
    const missing = load({ respond: () => fail('42P01') });
    for (const result of await Promise.all([
        missing.D.Supplies.vendorSalesMonthly('v'), missing.D.Supplies.vendorCustomers('v'), missing.D.Supplies.listTiers('v'),
        missing.D.Supplies.listProducts('v'), missing.D.Supplies.listOrdersForStudio('s'), missing.D.Supplies.searchCatalog({ search: 'x' }),
    ])) {
        assert.deepEqual(plain(result), { data: [], error: null, unavailable: true });
    }
});
