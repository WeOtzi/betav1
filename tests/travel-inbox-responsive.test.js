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

    const compactDesktopStart = css.indexOf('@media (min-width:1025px)');
    const exactDesktopStart = css.indexOf('@media (min-width:1280px)');
    assert.ok(compactDesktopStart >= 0, 'expected the compact desktop breakpoint');
    assert.ok(exactDesktopStart > compactDesktopStart, 'expected an exact-width desktop breakpoint after compact desktop');
    const compactDesktopCss = css.slice(compactDesktopStart, exactDesktopStart);
    const exactDesktopCss = css.slice(exactDesktopStart);

    assert.match(css, /\.tvl-shell,\.tvd-shell,\.tvs\{[^}]*overflow-x:clip/i);
    assert.match(css, /\.tvl-passport\{grid-template-columns:minmax\(0,1fr\)\}/i);
    assert.match(css, /@media\s*\(min-width:\s*769px\s*\)[\s\S]*\.tvl-passport\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/i);
    assert.doesNotMatch(compactDesktopCss, /repeat\(3,minmax\(0,21\.71875%\)\)/i);
    assert.match(exactDesktopCss, /\.tvl-passport\{grid-template-columns:repeat\(3,minmax\(0,21\.71875%\)\) minmax\(0,18\.125%\);gap:1\.5625%\}/i);
    assert.match(compactDesktopCss, /\.tvl-globegrid\{grid-template-columns:minmax\(0,3fr\) minmax\(0,1fr\);gap:0;height:auto;aspect-ratio:1280\/988/i);
    assert.match(css, /\.tvd-grid\{grid-template-columns:minmax\(0,1fr\)/i);
    assert.doesNotMatch(compactDesktopCss, /minmax\(0,776px\) minmax\(0,360px\)/i);
    assert.match(exactDesktopCss, /\.tvd-grid\{grid-template-columns:minmax\(0,776px\) minmax\(0,360px\)/i);
    assert.match(page, /id="tvl-city"/);
    assert.match(page, /id="tvl-country"/);
    assert.match(page, /id="tvl-specialty"/);
    assert.doesNotMatch(page, /tvl-external|El estudio no está en We Ötzi/i);
});

test('Inbox switches from mobile list/thread to tablet and four-zone desktop', () => {
    const css = read('public/shared/css/artist-inbox-ds.css');
    const page = read('public/artist/inbox/index.html');
    const script = read('public/shared/js/artist-inbox.js');

    assert.match(css, /\.ai-shell\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/i);
    assert.match(css, /\.ai-shell\.is-thread-open \.ai-threadcol\s*\{\s*display:\s*flex/i);
    assert.match(css, /@media\s*\(min-width:\s*769px\s*\)[\s\S]*grid-template-columns:\s*minmax\(280px,\s*\.85fr\)\s+minmax\(0,\s*1\.5fr\)/i);
    assert.match(css, /@media\s*\(min-width:\s*1281px\s*\)[\s\S]*grid-template-columns:\s*297px 392px minmax\(0,\s*1fr\) 269px/i);
    assert.match(css, /\.ai-side-list\s*\{[\s\S]*?overflow-x:\s*auto/i);
    assert.match(page, /id="ai-file"[^>]*accept="image\/jpeg,image\/png,image\/webp,image\/gif,application\/pdf,text\/plain"[^>]*multiple/i);
    assert.match(page, /id="ai-attach"[\s\S]*id="ai-image"[\s\S]*id="ai-emoji"/i);
    assert.match(page, /id="ai-attachment-preview"/i);
    assert.match(css, /\.ai-composer\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto/i);
    assert.match(css, /\.ai-attachment-preview\s*\{[^}]*grid-column:\s*1\s*\/\s*-1[^}]*grid-auto-flow:\s*column[^}]*overflow-x:\s*auto/i);
    assert.match(css, /grid-auto-columns:\s*calc\(\(100% - \(var\(--ai-attachment-slots\) - 1\)/i);
    assert.match(css, /\.ai-attachment-preview::-webkit-scrollbar\s*\{\s*display:\s*none/i);
    assert.match(css, /\.ai-composer-input,\s*\.ai-send,\s*\.ai-composer-tools \.ai-attach\s*\{[^}]*height:\s*var\(--ai-composer-control-h\)/i);
    assert.match(css, /\.ai-composer-tools\s*\{[^}]*grid-column:\s*1[^}]*grid-row:\s*2/i);
    assert.match(css, /\.ai-composer-input\s*\{[^}]*grid-column:\s*2[^}]*grid-row:\s*2/i);
    assert.match(css, /\.ai-send\s*\{[^}]*grid-column:\s*3[^}]*grid-row:\s*2/i);
    assert.match(css, /\.ai-thread-tools \.wo-iconbtn\s*\{[^}]*width:\s*var\(--control-h-sm\)[^}]*height:\s*var\(--control-h-sm\)/i);
    assert.match(script, /pendingFiles:\s*\[\]/i);
    assert.match(script, /Math\.min\(state\.pendingFiles\.length,\s*MAX_VISIBLE_ATTACHMENTS\)/i);
    assert.match(script, /addEventListener\('pointerdown',[\s\S]*addEventListener\('pointermove',[\s\S]*addEventListener\('pointerup'/i);
    assert.match(script, /for \(let index = 0; index < files\.length; index \+= 1\)[\s\S]*uploadAttachment\([\s\S]*body: index === 0 \? body : null/i);
    assert.match(script, /state\.pendingFiles = state\.pendingFiles\.filter/i);
});

test('Inbox preserves the Figma conversation hierarchy and explicit demo states', () => {
    const css = read('public/shared/css/artist-inbox-ds.css');
    const page = read('public/artist/inbox/index.html');
    const script = read('public/shared/js/artist-inbox.js');
    const seed = read('supabase/seeds/20260829_travel_inbox_figma_demo.sql');

    assert.match(css, /\.ai-row\s*\{[^}]*min-height:\s*107\.5px[^}]*border-radius:\s*var\(--ai-radius-card\)/i);
    assert.match(css, /\.ai-msg--out \.ai-bubble\s*\{[^}]*background:\s*var\(--ai-blue\)/i);
    assert.match(css, /\.ai-msg--in \.ai-bubble\s*\{[^}]*background:\s*var\(--figma-sand\)/i);
    assert.match(css, /\.ai-ctx-status\s*\{[^}]*background:\s*var\(--success-bg\)/i);
    assert.match(page, /class="ai-summary-row ai-summary-filter" data-filter="favorites"/i);
    assert.match(script, /function responseState\(row\)[\s\S]*context\.reply_status[\s\S]*Esperando respuesta/i);
    assert.match(script, /Postulación aceptada/i);
    assert.match(seed, /"reply_status":"waiting"/i);
    assert.match(seed, /"reply_status":"replied"/i);
});

test('Inbox expands proportionally on 2XL screens and renders the shared footer after the shell', () => {
    const css = read('public/shared/css/artist-inbox-ds.css');
    const page = read('public/artist/inbox/index.html');

    assert.match(page, /<weotzi-product-footer><\/weotzi-product-footer>/i);
    assert.match(css, /body\.ai-page\s*\{[^}]*height:\s*auto[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/i);
    assert.match(css, /body\.ai-page\s*>\s*weotzi-product-footer\s*\{[^}]*display:\s*block/i);
    assert.doesNotMatch(css, /body\.ai-page\s*>\s*weotzi-product-footer\s*\{[^}]*display:\s*none/i);

    const wideStart = css.indexOf('@media (min-width: 1536px)');
    assert.ok(wideStart >= 0, 'expected a dedicated 2XL breakpoint');
    const wide = css.slice(wideStart);
    assert.match(wide, /\.ai-shell\s*\{[^}]*width:\s*100%[^}]*height:\s*calc\(100vw \* 836 \/ 1440\)/i);
    assert.match(wide, /grid-template-columns:\s*20\.625% 27\.222222% minmax\(0,\s*33\.472222%\) 18\.680556%/i);
    assert.match(wide, /\.ai-side,[\s\S]*\.ai-listcol,[\s\S]*\.ai-context\s*\{\s*height:\s*100%/i);
});
