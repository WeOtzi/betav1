'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../public/shared/js/client-dashboard.js'), 'utf8');

function dashboard() {
    const nodes = new Map();
    const channel = { on() { return this; }, subscribe() { return this; } };
    const sdk = { auth: { async getSession() { return { data: { session: null } }; } } };
    const context = vm.createContext({
        console, Date, URLSearchParams,
        window: { _supabase: sdk, location: { search: '' } },
        supabase: { createClient() { throw new Error('No real Supabase client during UI regression'); } },
        WeotziData: { channel() { return channel; } },
        document: {
            addEventListener() {}, body: { style: {} },
            getElementById(id) {
                if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', style: {}, classList: { add() {} } });
                return nodes.get(id);
            }
        }
    });
    vm.runInContext(source, context, { filename: 'client-dashboard.js' });
    vm.runInContext('loadChatMessages = async () => {}; subscribeToChatMessages = () => {};', context);
    return { context, nodes };
}

const cases = [
    ['Realismo', 'Realismo'],
    [['Fine line', 'Blackwork'], 'Fine line, Blackwork'],
    [{ style_name: 'Realismo' }, 'Realismo'],
    [[{ style_name: 'Realismo' }, { style_name: 'Fine line' }], 'Realismo, Fine line'],
    [[null, {}, '  Fine line  ', { style_name: null }], 'Fine line'],
    [null, '–'],
    [{ style_name: null, substyle_name: null }, '–'],
    [[], '–']
];

test('quotation cards render actual styles from strings, arrays and objects', () => {
    const { context } = dashboard();
    for (const [value, expected] of cases) {
        context.quotation = { quote_id: 'QA-STYLE', quote_status: 'pending', tattoo_style: value, created_at: '2026-09-30T12:00:00Z' };
        const html = vm.runInContext('renderQuotationCard(quotation)', context);
        assert.ok(html.includes(`<div class="detail-value">${expected}</div>`), `style card: ${JSON.stringify(value)}`);
        assert.doesNotMatch(html, /undefined|\[object Object\]/);
    }
});

test('quotation detail renders all style shapes and retains object substyles', async () => {
    const { context, nodes } = dashboard();
    for (const [value, expected] of [...cases, [{ style_name: 'Realismo', substyle_name: 'Retrato' }, 'Realismo - Retrato']]) {
        context.quotation = { quote_id: 'QA-STYLE', quote_status: 'pending', tattoo_style: value };
        vm.runInContext('currentQuotations = [quotation]', context);
        await vm.runInContext('viewQuotationDetail("QA-STYLE")', context);
        const html = nodes.get('quotation-detail-content').innerHTML;
        assert.ok(html.includes(`<span>${expected}</span>`), `style detail: ${JSON.stringify(value)}`);
        assert.doesNotMatch(html, /undefined|\[object Object\]/);
    }
});

test('style text is escaped in quotation cards and detail', async () => {
    const { context, nodes } = dashboard();
    context.quotation = { quote_id: 'QA-STYLE', quote_status: 'pending', tattoo_style: [{ style_name: '<b>Fine line</b>' }] };
    assert.match(vm.runInContext('renderQuotationCard(quotation)', context), /&lt;b&gt;Fine line&lt;\/b&gt;/);
    vm.runInContext('currentQuotations = [quotation]', context);
    await vm.runInContext('viewQuotationDetail("QA-STYLE")', context);
    assert.match(nodes.get('quotation-detail-content').innerHTML, /&lt;b&gt;Fine line&lt;\/b&gt;/);
    assert.doesNotMatch(nodes.get('quotation-detail-content').innerHTML, /<b>Fine line<\/b>/);
});
