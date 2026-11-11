const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function controller() {
    const context = { document: { addEventListener() {}, getElementById() { return null; } }, window: {}, console, URLSearchParams, Set, Map };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/shared/js/job-board-feed.js'), 'utf8'), context);
    return context;
}

test('feed has an actionable see-all control even when the curated rail contains exactly five requests', () => {
    const context = controller();
    vm.runInContext(`
        var railsMount = { innerHTML: '' };
        document.getElementById = id => id === 'job-board-rails' ? railsMount : null;
        allRequests = filteredRequests = Array.from({length:5}, (_, i) => ({id:'job-'+i, feed_rank:i+1, title:'Idea '+i, _parsedStyles:[]}));
        renderFeed();
    `, context);
    assert.match(context.railsMount.innerHTML, /onclick="showAllOf\(null\)"/);
});

test('feed budget keeps non-USD currency explicit but presents USD like the Figma labels', () => {
    const context = controller();
    assert.equal(vm.runInContext('formatFeedBudgetRange(200, 400, "USD")', context), '$200 – $400');
    assert.equal(vm.runInContext('formatFeedBudgetRange(200, 400, "EUR")', context), '$200 – $400 EUR');
    assert.equal(vm.runInContext('formatBudgetRange(200, 400, "USD")', context), '$200 – $400 USD', 'detail format is unchanged');
});

test('screen 15 samples are preview-only and never mutate the shared fixture records', () => {
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/shared/js/job-board-screen15-preview.js'), 'utf8'), context);
    const original = [{ id: 'original', request_code: 'JB-DEMO1', tattoo_style: ['Blackwork'] }];
    assert.equal(context.window.WoJobBoardScreen15Preview.build(original), null);
    context.window.WEOTZI_PREVIEW = true;
    const preview = context.window.WoJobBoardScreen15Preview.build(original);
    assert.equal(preview.requests[0].display_code, 'JB-59407');
    assert.equal(preview.requests[0].id, 'original');
    assert.equal(preview.featured.studio_name, 'Aurora Ink Collective');
    assert.equal(original.length, 1);
    assert.equal(original[0].request_code, 'JB-DEMO1');
    assert.equal(original[0].tattoo_style[0], 'Blackwork');
});

test('screen-local preview saves persist locally without writing into other screens shared fixtures', async () => {
    const context = controller();
    const storage = new Map();
    context.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
    vm.runInContext(`
        screen15Preview = {};
        currentUser = {id:'preview-artist'}; isArtist = true; artistData = {user_id:'preview-artist'};
        applyFilters = () => {};
        showToast = () => {};
        window.WeotziData = {JobBoard:{SavedRequests:{toggle(){throw new Error('must not write shared fixtures')}}}};
    `, context);
    await context.toggleSavedRequest('sample-1');
    assert.equal(storage.get('weotzi.job-board.saved.preview-artist:screen15'), '["sample-1"]');
    await context.loadSavedRequests();
    assert.equal(vm.runInContext('savedRequestIds.has("sample-1")', context), true);
});
