const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function repository({ count = 0, failPage = -1 } = {}) {
    const calls = [];
    const client = { rpc: async (name, args) => { calls.push({ rpc: name, args }); return { data: { id: 'saved' }, error: null }; } };
    const data = { getClient: () => client, from(table) {
        const query = { table, filters: [], ordering: [] }; calls.push(query);
        const builder = {
            select(value) { query.select = value; return this; },
            eq(key, value) { query.filters.push([key, value]); return this; },
            in(key, value) { query.filters.push([key, value]); return this; },
            gte(key, value) { query.filters.push([key, 'gte', value]); return this; },
            lt(key, value) { query.filters.push([key, 'lt', value]); return this; },
            order(key) { query.ordering.push(key); return this; },
            update(value) { query.update = value; return this; },
            single() { return Promise.resolve({ data: { id: 'item' }, error: null }); },
            range(start, end) {
                query.range = [start, end];
                if (start / 500 === failPage) return Promise.resolve({ data: null, error: { message: 'permission denied' } });
                return Promise.resolve({ data: Array.from({ length: Math.max(0, Math.min(end + 1, count) - start) }, (_, i) => ({ id: String(start + i) })), error: null });
            }
        };
        return builder;
    } };
    vm.runInNewContext(read('public/shared/js/data/studios-repo.js'), { window: { WeotziData: data }, console, Date });
    return { data, calls };
}

function operations(document = { getElementById: () => null }, data = {}) {
    const source = read('public/shared/js/studio-dashboard-ops.js').replace(/\}\)\(\);\s*$/, 'globalThis.exposed = { sumCurrencies, localDateTime, documentStoragePath, validUrl, guardedAction, requireResult, fmtMoney, fmtDate, calendarDate, persistDocument, wireAnalyticsPanel, openSponsorEditor }; })();');
    const context = { window: {}, document, WeotziData: data, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, Date, Intl, URL, console };
    vm.runInNewContext(source, context);
    return context.exposed;
}

test('SQL calendar dates retain their day and month in Argentina', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'America/Argentina/Buenos_Aires';
    try {
        assert.equal(operations().fmtDate('2026-09-21'), '21/9/2026');
        assert.equal(operations().calendarDate('2026-09-01').getMonth(), 8);
    } finally {
        if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
    }
});

test('invoice saves header and lines in a single authenticated RPC', async () => {
    const { data, calls } = repository();
    const header = { studio_id: 's', invoice_number: 'INV-1' }, items = [{ description: 'Session', quantity: 1, unit_price: 500 }];
    await data.StudioOps.saveInvoice(null, header, items);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].rpc, 'save_studio_invoice');
    assert.equal(calls[0].args.p_invoice_id, null);
    assert.equal(calls[0].args.p_items, items);
});

test('existing invitation and counteroffer RPCs resolve the configured client', async () => {
    const { data, calls } = repository();
    await data.StudioMemberships.respondToInvitation('membership', 'artist', 'accept');
    await data.StudioSpots.decideCounterOffer('offer', 'accepted');
    assert.deepEqual(calls.map(call => call.rpc), ['respond_to_studio_invitation', 'respond_to_studio_spot_counter_offer']);
});

for (const method of ['listInvoices', 'listDocuments', 'listInventoryItems', 'listInventoryHealth', 'listSuppliers', 'listSupplierOptions', 'listSponsors', 'listJobsForClientAggregation']) {
    test(`${method} reads beyond the PostgREST 1000-row limit`, async () => {
        const { data, calls } = repository({ count: 1201 });
        const result = await data.StudioOps[method]('studio');
        assert.equal(result.error, null);
        assert.equal(result.data.length, 1201);
        assert.equal(new Set(result.data.map(row => row.id)).size, 1201);
        assert.deepEqual(calls.map(call => call.range), [[0, 499], [500, 999], [1000, 1499]]);
        assert.ok(calls.every(call => call.ordering.includes('id')), 'pagination has a stable ID tiebreak');
    });
}

test('failed later page reports failure instead of presenting an incomplete ledger', async () => {
    const { data } = repository({ count: 1201, failPage: 1 });
    const result = await data.StudioOps.listInvoices('studio');
    assert.equal(result.data, null);
    assert.equal(result.error.message, 'permission denied');
});

test('bookings preserve studio and date filters on all pages', async () => {
    const { data, calls } = repository({ count: 501 });
    const result = await data.StudioOps.listBookings('studio', '2026-09-01', '2026-10-01');
    assert.equal(result.data.length, 501);
    assert.ok(calls.every(call => call.filters.some(filter => filter[0] === 'studio_id' && filter[1] === 'studio')));
    assert.ok(calls.every(call => call.filters.some(filter => filter[0] === 'starts_at' && filter[1] === 'lt')));
});

test('inventory removal archives its item and preserves movement history', async () => {
    const { data, calls } = repository();
    await data.StudioOps.deleteInventoryItem('item');
    assert.equal(calls[0].table, 'studio_inventory_items');
    assert.equal(calls[0].update.is_active, false);
});

test('money totals keep currencies separate and escape invalid stored currency', () => {
    const ui = operations();
    const text = ui.sumCurrencies([{ currency: 'ARS', amount: 100 }, { currency: 'USD', amount: 10 }, { currency: 'ars', amount: 50 }], 'amount');
    assert.equal(text, `${ui.fmtMoney(150, 'ARS')} · ${ui.fmtMoney(10, 'USD')}`);
    assert.ok(!ui.fmtMoney(3, '<img src=x>').includes('<img'));
});

test('analytics renders empty, populated and failed data without depending on sponsor variables', async () => {
    const nodes = Object.fromEntries(['analytics-summary', 'analytics-monthly', 'analytics-artist'].map(id => [id, { innerHTML: '' }]));
    let months = [], artists = [], error = null;
    const ui = operations({ getElementById: id => nodes[id] }, { StudioOps: {
        getDashboardMetrics: async () => ({ data: months, error }), getArtistPerformance: async () => ({ data: artists, error: null })
    } });
    await ui.wireAnalyticsPanel({}, { id: 'studio' });
    assert.match(nodes['analytics-monthly'].innerHTML, /Sin datos suficientes/);
    months = [{ month: '2026-09-01', currency: 'ARS', jobs_count: 2, unique_clients: 1, gross_amount: 50000, studio_net: 10000, paid_to_artists: 40000, avg_ticket: 25000 }];
    artists = [{ name: 'Ana', currency: 'ARS', jobs_count: 2, gross_billed: 50000, avg_ticket: 25000, supplies_consumed_cost: 0, days_since_last_job: 1 }];
    await ui.wireAnalyticsPanel({}, { id: 'studio' });
    assert.ok(nodes['analytics-summary'].innerHTML.includes(ui.fmtMoney(50000, 'ARS')));
    assert.match(nodes['analytics-artist'].innerHTML, /Ana/);
    error = { message: 'Database unavailable' };
    await ui.wireAnalyticsPanel({}, { id: 'studio' });
    assert.match(nodes['analytics-summary'].innerHTML, /Database unavailable/);
    assert.equal(nodes['analytics-monthly'].innerHTML, '');
});

test('sponsor editor renders loaded artists and existing assignments', async () => {
    const nodes = new Map();
    const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, { innerHTML: '', addEventListener() {} }); return nodes.get(id); } };
    const ui = operations(document, {
        StudioMemberships: { listActiveArtists: async () => ({ data: [{ artist_user_id: 'artist', artists_db: { user_id: 'artist', name: 'Ana' } }], error: null }) },
        StudioOps: { listSponsorArtistIds: async () => ({ data: [{ artist_user_id: 'artist' }], error: null }) }
    });
    await ui.openSponsorEditor({}, { id: 'studio' }, { id: 'sponsor', name: 'Sponsor' });
    assert.match(nodes.get('sponsor-editor').innerHTML, /value="artist" checked/);
    assert.match(nodes.get('sponsor-editor').innerHTML, /Ana/);
});

test('private files use stored path or recover legacy public URLs without persisting signed tokens', () => {
    const ui = operations();
    assert.equal(ui.documentStoragePath({ storage_path: 'studio/a.pdf' }), 'studio/a.pdf');
    assert.equal(ui.documentStoragePath({ file_url: 'https://storage.example/storage/v1/object/public/studio-documents/studio/a%20b.pdf' }), 'studio/a b.pdf');
    assert.equal(ui.documentStoragePath({ file_url: 'https://storage.example/storage/v1/object/sign/studio-documents/studio/a.pdf?token=secret' }), 'studio/a.pdf');
    assert.equal(ui.validUrl('javascript:alert(1)'), null);
    assert.equal(ui.validUrl('https://example.com/file.pdf'), 'https://example.com/file.pdf');
});

test('date editor preserves local date and time rather than showing UTC as local time', () => {
    const ui = operations();
    const value = new Date(2026, 8, 21, 15, 42);
    assert.equal(ui.localDateTime(value), '2026-09-21T15:42');
});

test('document metadata failure removes only the newly uploaded private object', async () => {
    const removed = [];
    const ui = operations(undefined, { StudioOps: { createDocument: async () => ({ error: new Error('RLS rejected metadata') }) } });
    const storage = { storage: { from(bucket) { assert.equal(bucket, 'studio-documents'); return { remove: async paths => { removed.push(...paths); return { error: null }; } }; } } };
    await assert.rejects(ui.persistDocument(storage, null, { title: 'Contract' }, 'studio/new.pdf'), /RLS rejected metadata/);
    assert.deepEqual(removed, ['studio/new.pdf']);
});

test('successful document persistence keeps the private file and returns its saved row', async () => {
    const ui = operations(undefined, { StudioOps: { updateDocument: async (id, payload) => ({ data: { id, ...payload }, error: null }) } });
    const row = await ui.persistDocument({}, { id: 'doc' }, { storage_path: 'studio/new.pdf' }, 'studio/new.pdf');
    assert.equal(row.id, 'doc');
    assert.equal(row.storage_path, 'studio/new.pdf');
});

test('async mutation guard prevents double submission and restores the control after failure', async () => {
    const node = {};
    const ui = operations({ getElementById: () => node });
    const button = { disabled: false, closest: () => ({ dataset: { panel: 'ops' } }) };
    let reject, count = 0;
    const handler = ui.guardedAction(async () => { count++; await new Promise((resolve, fail) => { reject = fail; }); });
    const pending = handler({ currentTarget: button });
    await handler({ currentTarget: button });
    assert.equal(count, 1);
    reject(new Error('Save failed'));
    await pending;
    assert.equal(button.disabled, false);
    assert.equal(node.textContent, 'Save failed');
});
