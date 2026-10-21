'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function shareHarness(setShare = async () => {}) {
    const source = read('public/shared/js/artist-travel.js');
    const fragment = source.slice(source.indexOf('    function shareUrl(slug) {'), source.indexOf('    // ---------- Modal adjuntar archivo ----------'));
    const elements = new Map();
    const $ = (id) => {
        if (!elements.has(id)) elements.set(id, { value: '', disabled: false, hidden: true, href: '#', textContent: '', addEventListener() {}, select() {} });
        return elements.get(id);
    };
    const calls = { modal: [], copied: [] };
    const trip = { id: 'trip-1', city: 'Barcelona', share_slug: null, share_enabled: false };
    const context = {
        $, currentTrip: trip, pendingShareSlug: null, pendingShareTripId: null,
        makeSlug: () => 'barcelona-ago26',
        openModal: (id) => calls.modal.push(id),
        D: { Travel: { setShare } },
        navigator: { clipboard: { writeText: async (url) => calls.copied.push(url) } },
        document: {}, console: { error() {} },
        setTimeout,
        window: { open() {} },
    };
    vm.runInNewContext(`${fragment}\nthis.openShare = openShare; this.copyEnabledShareUrl = copyEnabledShareUrl;`, context);
    return { context, trip, calls, $ };
}

test('Travel opens with a working public URL and copies it on the first click', async () => {
    const writes = [];
    const { context, trip, calls, $ } = shareHarness(async (id, data) => writes.push([id, data]));
    await context.openShare();
    assert.equal(writes[0][0], 'trip-1');
    assert.equal(writes[0][1].slug, 'barcelona-ago26');
    assert.equal(writes[0][1].enabled, true);
    assert.equal(trip.share_enabled, true);
    assert.equal($('tvs-url').value, 'https://weotzi.com/travel/t/barcelona-ago26');
    assert.equal($('tvs-url').disabled, false);
    assert.deepEqual(calls.modal, ['tv-modal-share']);
    assert.equal(await context.copyEnabledShareUrl(), true);
    assert.deepEqual(calls.copied, ['https://weotzi.com/travel/t/barcelona-ago26']);
});

test('Travel does not show or copy an inactive link when publishing fails', async () => {
    const { context, trip, calls, $ } = shareHarness(async () => { throw new Error('unavailable'); });
    await context.openShare();
    assert.equal(trip.share_enabled, false);
    assert.deepEqual(calls.modal, []);
    assert.notEqual($('tvs-url').value, 'https://weotzi.com/travel/t/barcelona-ago26');
    assert.deepEqual(calls.copied, []);
});

test('Travel shows an already published URL when reopening the dialog', async () => {
    const { context, trip, calls, $ } = shareHarness(async () => { throw new Error('unnecessary write'); });
    trip.share_slug = 'barcelona-existing';
    trip.share_enabled = true;
    await context.openShare();
    assert.deepEqual(calls.modal, ['tv-modal-share']);
    assert.equal($('tvs-url').value, 'https://weotzi.com/travel/t/barcelona-existing');
    assert.equal($('tvs-url').disabled, false);
});

test('Job Board sent summary names the tattoo, not a spot search headline', () => {
    const sent = { innerHTML: '', classList: { toggle() {} } };
    const document = {
        addEventListener() {},
        getElementById: (id) => id === 'jbf-sent-view' ? sent : null,
        body: { classList: { toggle() {} } },
    };
    const window = { location: { href: 'https://weotzi.com/job-board/' }, scrollTo() {} };
    const context = { document, window, URL };
    vm.runInNewContext(read('public/shared/js/job-board-feed.js'), context);
    context.renderProposalSent({
        id: 'request-1', client_display_name: 'Camila R.',
        display_title: 'Buscamos artistas residentes para nueva sede en Ciudad de México',
        tattoo_idea_description: 'Retrato realista de abuela en blanco y negro. Brazo derecho.',
    }, { price: 450, currency: 'USD', sentAt: '2026-07-25T12:00:00Z' });
    assert.match(sent.innerHTML, /<span class="jbf-summary-key">Proyecto<\/span>\s*<span class="jbf-summary-val">Retrato realista de abuela en blanco y negro<\/span>/);
    assert.doesNotMatch(sent.innerHTML, /Buscamos artistas residentes/);
});
