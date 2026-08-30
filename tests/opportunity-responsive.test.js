const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Job Board card footer keeps long four-figure budgets inside every card', () => {
    const js = read('public/shared/js/job-board-feed.js');
    const css = read('public/shared/css/job-board-feed.css');

    assert.match(js, /class="jbf-card-pricebox"/);
    assert.match(css, /\.jbf-card\s*\{[\s\S]*container-type:\s*inline-size/);
    assert.match(css, /\.jbf-card-foot\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
    assert.match(css, /@container\s+jbf-card\s*\(min-width:/);
    assert.match(css, /\.jbf-card-pricebox\s*\{[\s\S]*min-width:\s*0/);
});

test('Job Board completion routes to the dedicated Job Board applications tab', () => {
    const js = read('public/shared/js/job-board-feed.js');
    assert.match(js, /href="\/artist\/applications\?tab=jobboard"/);
    assert.doesNotMatch(js, /href="\/my-quotations\?tab=applications"/);
});

test('opportunity surfaces keep their navigation, actions and long content responsive', () => {
    const shared = read('public/shared/css/ds/components.css');
    const applications = read('public/shared/css/artist-applications-ds.css');
    const spots = read('public/shared/css/studio-spots-ds.css');

    assert.match(shared, /\.wo-tabs\s*\{[\s\S]*overflow-x:\s*auto/);
    assert.match(shared, /\.wo-modal-actions\s*\{[\s\S]*flex-wrap:\s*wrap/);
    assert.match(applications, /\.apx-chips\s*\{[\s\S]*overflow-x:\s*auto/);
    assert.match(applications, /\.apx-row-actions\s+\.wo-btn\s*\{[\s\S]*min-width:\s*0/);
    assert.match(spots, /:is\(\.sps-title,[\s\S]*overflow-wrap:\s*anywhere/);
    assert.match(spots, /\.inv-row-actions\s+\.wo-btn\s*\{[\s\S]*min-width:\s*0/);
});

test('all requested opportunity entry points declare a mobile viewport', () => {
    const pages = [
        'public/job-board/index.html',
        'public/artist/applications/index.html',
        'public/studio-spots/index.html',
        'public/artist/invitations/index.html'
    ];

    for (const page of pages) {
        assert.match(read(page), /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1(?:\.0)?"/i, page);
    }
});
