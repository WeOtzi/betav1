const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function confirmation() {
    const mount = { innerHTML: '', classList: { toggle() {} } };
    const classes = new Set();
    const context = {
        document: { addEventListener() {}, getElementById(id) { return id === 'jbf-sent-view' ? mount : null; }, body: { classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name); } } } },
        window: { scrollTo() {} }, console, URLSearchParams, Set, Map
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/shared/js/job-board-feed.js'), 'utf8'), context);
    return { context, mount, classes };
}

test('confirmation uses original Figma icons and keeps submitted values escaped and dynamic', () => {
    const { context, mount, classes } = confirmation();
    context.renderProposalSent({ title: 'Proyecto <real>', client_display_name: 'Ana <R.>' }, { price: 725, currency: 'EUR', sentAt: '2026-07-25T12:00:00Z' });
    assert.match(mount.innerHTML, /job-board-screen17\/check.svg/);
    assert.match(mount.innerHTML, /job-board-screen17\/arrow-right.svg/);
    assert.match(mount.innerHTML, /Proyecto &lt;real&gt;/);
    assert.match(mount.innerHTML, /Ana &lt;R\.&gt;/);
    assert.match(mount.innerHTML, /\$725 EUR/);
    assert.match(mount.innerHTML, /25 de julio, 2026/);
    assert.match(mount.innerHTML, /href="\/artist\/applications\?tab=jobboard"/);
    assert.match(mount.innerHTML, /onclick="backToFeed\(\)"/);
    assert.equal(classes.has('jbf-is-sent'), true);
    context.showView('feed');
    assert.equal(classes.has('jbf-is-sent'), false);
});
