const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Travel and Inbox declare mobile viewports and mobile-first breakpoints', () => {
    const pages = ['public/artist/travel/index.html', 'public/artist/inbox/index.html'];
    for (const page of pages) {
        assert.match(read(page), /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1(?:\.0)?"/i, page);
    }
    for (const cssFile of ['public/shared/css/artist-travel-ds.css', 'public/shared/css/artist-inbox-ds.css']) {
        const css = read(cssFile);
        assert.doesNotMatch(css, /@media\s*\(\s*max-width/i, cssFile);
        assert.match(css, /@media\s*\(min-width:\s*769px\s*\)/i, cssFile);
        assert.match(css, /min-width:\s*0/i, cssFile);
    }
});

test('Travel changes layout at mobile, tablet and desktop without page overflow', () => {
    const css = read('public/shared/css/artist-travel-ds.css');
    const page = read('public/artist/travel/index.html');

    assert.match(css, /\.tvl-shell,\.tvd-shell,\.tvs\{[^}]*overflow-x:clip/i);
    assert.match(css, /\.tvl-passport\{grid-template-columns:minmax\(0,1fr\)\}/i);
    assert.match(css, /@media\s*\(min-width:\s*769px\s*\)[\s\S]*\.tvl-passport\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/i);
    assert.match(css, /@media\s*\(min-width:\s*1025px\s*\)[\s\S]*\.tvl-passport\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}/i);
    assert.match(css, /\.tvd-grid\{grid-template-columns:minmax\(0,1fr\)/i);
    assert.match(css, /@media\s*\(min-width:\s*1025px\s*\)[\s\S]*\.tvd-grid\{grid-template-columns:2fr 1fr/i);
    assert.match(page, /id="tvl-city"/);
    assert.match(page, /id="tvl-country"/);
    assert.match(page, /id="tvl-specialty"/);
    assert.doesNotMatch(page, /tvl-external|El estudio no está en We Ötzi/i);
});

test('Inbox switches from mobile list/thread to tablet and four-zone desktop', () => {
    const css = read('public/shared/css/artist-inbox-ds.css');
    const page = read('public/artist/inbox/index.html');

    assert.match(css, /\.ai-shell\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/i);
    assert.match(css, /\.ai-shell\.is-thread-open \.ai-threadcol\s*\{\s*display:\s*flex/i);
    assert.match(css, /@media\s*\(min-width:\s*769px\s*\)[\s\S]*grid-template-columns:\s*minmax\(280px,\s*\.85fr\)\s+minmax\(0,\s*1\.5fr\)/i);
    assert.match(css, /@media\s*\(min-width:\s*1281px\s*\)[\s\S]*grid-template-columns:\s*280px 380px minmax\(0,\s*1fr\) 280px/i);
    assert.match(css, /\.ai-side-list\s*\{[\s\S]*?overflow-x:\s*auto/i);
    assert.match(page, /id="ai-file"[^>]*accept="image\/jpeg,image\/png,image\/webp,image\/gif,application\/pdf,text\/plain"/i);
    assert.match(page, /id="ai-attach"[\s\S]*id="ai-image"[\s\S]*id="ai-emoji"/i);
    assert.match(page, /id="ai-attachment-preview"/i);
});
