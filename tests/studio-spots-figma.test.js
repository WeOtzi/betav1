const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Spots directory consumes persistent featured ranks and preserves the Figma editorial slots', () => {
    const html = read('public/studio-spots/index.html');
    const js = read('public/shared/js/studio-spots-directory.js');
    const css = read('public/shared/css/studio-spots-figma.css');

    assert.match(html, /studio-spots-ds\.css[\s\S]*studio-spots-figma\.css/);
    assert.match(js, /const MOSAIC_SLOTS = 9/);
    assert.match(js, /is_featured/);
    assert.match(js, /featured_rank/);
    assert.match(js, /function partitionSpotsForLayout/);
    assert.match(js, /const featuredBadge = isFeatured\(s\)/);
    assert.match(js, /sps-sponsored-badge/);
    assert.match(js, /sps-tile--promoted/);
    assert.match(css, /\.sps-tile--promoted\s*\{[\s\S]*grid-column:\s*5\s*\/\s*span\s*2[\s\S]*grid-row:\s*2\s*\/\s*span\s*3/);
});

test('Spots Figma layer keeps the hero split at 882 and 1024 pixels and reflows below tablet', () => {
    const css = read('public/shared/css/studio-spots-figma.css');

    assert.match(css, /\.sps-feature\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.match(css, /@media\s*\(min-width:\s*55\.125rem\)[\s\S]*\.sps-feature\s*\{[\s\S]*grid-template-columns:\s*23\.75rem\s+minmax\(0,\s*1fr\)/);
    assert.match(css, /@media\s*\(min-width:\s*55\.125rem\)[\s\S]*\.sps-mosaic\s*\{[\s\S]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/);
});

test('Spot detail renders four media slots and the three persisted editorial lists from Figma', () => {
    const js = read('public/shared/js/studio-spots-directory.js');

    assert.match(js, /function renderPhotoSlot/);
    assert.match(js, /Array\.from\(\{ length: 4 \}/);
    assert.match(js, /studio_includes/);
    assert.match(js, /artist_expectations/);
    assert.match(js, /minimum_requirements/);
    assert.match(js, /Qué espera del artista/);
});

test('Spot confirmation preserves the exact applications route and Figma summary states', () => {
    const js = read('public/shared/js/studio-spots-directory.js');

    assert.match(js, /Spots \/ Solicitud enviada/);
    assert.match(js, /En revisión/);
    assert.match(js, /href="\/artist\/applications\?tab=spots"/);
    assert.match(js, /Seguir explorando spots/);
    assert.ok(fs.existsSync(path.join(root, 'public/shared/assets/figma/opportunities/spots-studio-01.png')));
});
