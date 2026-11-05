const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function controller() {
    const classes = new Set();
    const context = {
        document: { addEventListener() {}, getElementById() { return null; }, body: { classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name); } } } },
        window: { scrollTo() {} }, console, URLSearchParams, Set, Map
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/shared/js/job-board-feed.js'), 'utf8'), context);
    return { context, classes };
}

test('detail styling is removed on return to feed or proposal confirmation', () => {
    const { context, classes } = controller();
    context.showView('detail');
    assert.equal(classes.has('jbf-is-detail'), true);
    context.showView('sent');
    assert.equal(classes.has('jbf-is-detail'), false);
    context.showView('feed');
    assert.equal(classes.has('jbf-is-detail'), false);
});

test('client references retain their real images and never offer upload of another person’s references', () => {
    const { context } = controller();
    const html = context.referenceSlotsHtml([{ file_url: 'https://example.invalid/reference.jpg', file_name: '<portrait>', sort_order: 0 }]);
    assert.match(html, /href="https:\/\/example.invalid\/reference.jpg"/);
    assert.match(html, /alt="&lt;portrait&gt;"/);
    assert.equal((html.match(/class="jbf-ref /g) || []).length, 3);
    assert.match(html, /job-board-screen16\/image.svg/);
    assert.doesNotMatch(html, /type="file"|onclick=".*upload/);
});

test('detail utility row precedes both columns and preserves the selected request identity', () => {
    const { context } = controller();
    const mount = { innerHTML: '', classList: { toggle() {} } };
    context.mount = mount;
    vm.runInContext(`
        document.getElementById = id => id === 'jbf-detail-view' ? mount : null;
        syncDetailUrl = () => {};
        buildDetailMain = request => request.id;
        buildProposalAside = () => '';
        openRequestDetail({id:'real-request', request_code:'JB-42'});
    `, context);
    assert.ok(mount.innerHTML.includes('jbf-detail-utility'));
    assert.ok(mount.innerHTML.indexOf('jbf-detail-utility') < mount.innerHTML.indexOf('jbf-detail-main'));
    assert.equal(vm.runInContext('selectedRequest.id', context), 'real-request');
});

test('screen 16 sample changes only the detail of its matching preview request', () => {
    const file = path.join(__dirname, '../public/shared/js/job-board-screen16-preview.js');
    assert.ok(fs.existsSync(file), 'screen-local sample adapter must exist');
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context);
    const source = { id: 'keep-id', display_code: 'JB-24872', tattoo_idea_description: 'Original' };
    const adapter = context.window.WoJobBoardScreen16Preview;
    assert.equal(adapter.build(source), null);
    context.window.WEOTZI_PREVIEW = true;
    assert.equal(adapter.build({ id: 'other', display_code: 'JB-OTHER' }), null);
    const sample = adapter.build(source);
    assert.equal(sample.request.id, 'keep-id');
    assert.match(sample.request.tattoo_idea_description, /foto de los años\s70/);
    assert.equal(sample.artist.username, 'Lauumarth.wo');
    assert.equal(source.tattoo_idea_description, 'Original');
});
