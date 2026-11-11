'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function dashboard(sessions) {
    const nodes = new Map([['next-appointment', { innerHTML: '', hidden: true }]]);
    const context = vm.createContext({
        console, Date, Intl,
        window: { _supabase: { auth: { async getSession() { return { data: { session: null } }; } } }, location: { search: '' } },
        document: { addEventListener() {}, getElementById: id => nodes.get(id) },
        WeotziData: { channel() { return { on() { return this; }, subscribe() { return this; } }; }, Sessions: { async listByQuotationIds(ids) {
            assert.deepEqual(Array.from(ids), [42, 43]);
            return sessions;
        } } }
    });
    vm.runInContext(fs.readFileSync(require.resolve('../public/shared/js/client-dashboard.js'), 'utf8'), context);
    vm.runInContext(`currentQuotations = [
        { id: 42, quote_id: 'QUOTE-42', artist_name: '<Lauu>', studio_name: 'Bauhaus Ink' },
        { id: 43, quote_id: 'QUOTE-43', artist_name: 'Otro artista' }
    ];`, context);
    return { context, node: nodes.get('next-appointment') };
}

test('next appointment chooses the nearest future non-cancelled session using numeric quotation IDs', async () => {
    const { context, node } = dashboard([
        { quotation_id: 42, session_date: '2099-08-14T15:30:00', status: 'scheduled' },
        { quotation_id: 43, session_date: '2099-08-13T15:30:00', status: 'cancelled' },
        { quotation_id: 43, session_date: '2099-08-15T15:30:00', status: 'scheduled' },
        { quotation_id: 43, session_date: '2020-08-14T15:30:00', status: 'scheduled' },
        { quotation_id: 999, session_date: '2099-08-12T15:30:00', status: 'scheduled' }
    ]);
    await vm.runInContext('loadNextAppointment()', context);
    assert.equal(node.hidden, false);
    assert.match(node.innerHTML, /&lt;Lauu&gt;/);
    assert.doesNotMatch(node.innerHTML, /<Lauu>|Otro artista/);
    assert.match(node.innerHTML, /data-quote-id="QUOTE-42"/);
    assert.match(node.innerHTML, /15:30/);
});

test('next appointment hides a stale card when no future session remains', async () => {
    const { context, node } = dashboard([]);
    node.hidden = false;
    node.innerHTML = 'stale';
    await vm.runInContext('loadNextAppointment()', context);
    assert.equal(node.hidden, true);
    assert.equal(node.innerHTML, '');
});

test('an appointment query failure leaves no fabricated appointment visible', async () => {
    const { context, node } = dashboard([]);
    context.WeotziData.Sessions.listByQuotationIds = async () => { throw new Error('offline'); };
    context.console = { error() {} };
    await vm.runInContext('loadNextAppointment()', context);
    assert.equal(node.hidden, true);
});

test('Figma presentation fixtures are unavailable outside the isolated preview runtime', () => {
    const reference = fs.readFileSync(require.resolve('../public/shared/js/client-dashboard-reference.js'), 'utf8');
    for (const window of [{}, { WEOTZI_PREVIEW: true }, { WEOTZI_PREVIEW: false, WeotziPreview: { isSimulated: true } }]) {
        vm.runInNewContext(reference, { window });
        assert.equal(window.ClientDashboardReference, undefined);
    }
    const window = { WEOTZI_PREVIEW: true, WeotziPreview: { isSimulated: true } };
    vm.runInNewContext(reference, { window });
    assert.equal(window.ClientDashboardReference.artists.length, 3);
});

test('a session-less client does not query appointments belonging to other clients', async () => {
    const { context, node } = dashboard([]);
    let called = false;
    context.WeotziData.Sessions.listByQuotationIds = async () => { called = true; return []; };
    vm.runInContext('currentQuotations = []', context);
    await vm.runInContext('loadNextAppointment()', context);
    assert.equal(called, false);
    assert.equal(node.hidden, true);
});
