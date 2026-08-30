const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Mis postulaciones loads the isolated Figma layer last and keeps the requested artist navigation', () => {
    const html = read('public/artist/applications/index.html');
    const sharedIndex = html.indexOf('/shared/css/artist-applications-ds.css');
    const figmaIndex = html.indexOf('/shared/css/opportunity-applications-figma.css');

    assert.ok(sharedIndex > -1, 'shared applications stylesheet must remain loaded');
    assert.ok(figmaIndex > sharedIndex, 'the applications Figma layer must win the cascade');
    assert.match(html, /<weotzi-product-nav[\s\S]*active="quotations"/);
    assert.match(html, /Buscar por proyecto, estudio o cliente\.\.\./);
    assert.match(html, /data\/clients-repo\.js/);
});

test('Job Board consumes persistent sponsor and saved-request contracts without replacing the organic feed', () => {
    const html = read('public/job-board/index.html');
    const js = read('public/shared/js/job-board-feed.js');
    const css = read('public/shared/css/job-board-feed.css');

    assert.match(html, /id="job-board-featured"/);
    assert.match(html, /data-quick="saved"/);
    assert.match(js, /JobBoard\?\.Featured/);
    assert.match(js, /Featured;[\s\S]*getActive/);
    assert.match(js, /JobBoard\?\.SavedRequests/);
    assert.match(js, /api\.toggle\(requestId, artistData\.user_id, nextSaved\)/);
    assert.match(js, /request\.display_title/);
    assert.match(js, /function requestDisplayCode\(request\)/);
    assert.match(js, /request\?\.display_code \|\| request\?\.request_code/);
    assert.match(js, /\.order\('feed_rank', \{ ascending: true, nullsFirst: false \}\)/);
    assert.match(js, /jbf-card--feed-\$\{feedRank\}/);
    assert.match(js, /rank >= 1 && rank <= 5/);
    assert.match(js, /const countsSource = curatedOrganic\.length > 0 \? curatedOrganic : organicRequests/);
    assert.match(js, /const items = countsSource\.filter\(r =>/);
    assert.match(js, /currentFilters\.quick === 'newest'/);
    assert.match(js, /class="jbf-sponsor"/);
    assert.match(js, /class="jbf-card-save/);
    assert.match(css, /\.jbf-sponsor\s*\{[\s\S]*background:\s*var\(--yellow-100\)/);
    assert.match(css, /@media\s*\(min-width:\s*48\.0625rem\)[\s\S]*grid-template-columns:\s*minmax\(280px,\s*32%\)/);
});

test('Job Board conserva las formas y colores del set curado de Figma', () => {
    const css = read('public/shared/css/job-board-feed.css');
    assert.match(css, /\.jbf-card--feed-1 \.jbf-card-media\.no-image::after[\s\S]*border-radius: 50%/);
    assert.match(css, /\.jbf-card--feed-4 \.jbf-card-media\.no-image::after[\s\S]*background: var\(--blue-400\)/);
    assert.match(css, /\.jbf-card--feed-8 \.jbf-card-media\.no-image::after[\s\S]*background: var\(--red-300\)/);
    assert.match(css, /\.jbf-card--feed-9 \.jbf-card-media\.no-image::after[\s\S]*background: var\(--yellow-300\)/);
    assert.match(css, /\.jbf-card--feed-13 \.jbf-card-media\.no-image::after/);
});

test('Job Board detail and success preserve the four-reference, duration and real-client Figma states', () => {
    const js = read('public/shared/js/job-board-feed.js');
    const css = read('public/shared/css/job-board-feed.css');

    assert.match(js, /function referenceSlotsHtml\(attachments, count = 4\)/);
    assert.match(js, /Array\.from\(\{ length: count \}/);
    assert.match(js, /id="app-duration" name="estimated_duration"/);
    assert.match(js, /estimated_duration:\s*estimatedDuration/);
    assert.match(js, /function clientCardHtml/);
    assert.match(js, /client_display_name/);
    assert.match(js, /href="\/artist\/applications\?tab=jobboard"/);
    assert.match(css, /\.jbf-ref\s*\{[\s\S]*aspect-ratio:\s*3\s*\/\s*2/);
    assert.match(css, /\.jbf-sent\s*\{[\s\S]*width:\s*min\(100%,\s*576px\)/);
    assert.match(css, /\.jbf-sent-actions\s*\{[\s\S]*width:\s*min\(100%,\s*340px\)/);
    assert.match(css, /body\.wo-app\.jbf-is-sent #sc-fab\s*\{\s*display:\s*none\s*!important/);
});

test('Applications list and details use real client media plus persistent Spot counteroffers', () => {
    const js = read('public/shared/js/artist-applications.js');

    assert.match(js, /job_board_attachments/);
    assert.match(js, /clientProfileOf\(request\)/);
    assert.match(js, /it\.clientName/);
    assert.match(js, /Ver solicitud →/);
    assert.match(js, /Ver conversación/);
    assert.match(js, /gallerySlotsHtml\(photos, 'Foto del estudio'\)/);
    assert.match(js, /Array\.from\(\{ length: 4 \}/);
    assert.match(js, /studio_includes/);
    assert.match(js, /minimum_requirements/);
    assert.match(js, /response_sla_label/);
    assert.match(js, /contact_name/);
    assert.match(js, /StudioSpots\.listCounterOffers\(app\.id\)/);
    assert.match(js, /StudioSpots\.createCounterOffer\(\{/);
    assert.match(js, /StudioSpots\.decideCounterOffer\(offer\.id, status\)/);
});

test('Applications Figma layer encodes the exact 1144px desktop row and responsive reflows', () => {
    const css = read('public/shared/css/opportunity-applications-figma.css');

    assert.match(css, /#apx-list-view\s*\{[\s\S]*1144px/);
    assert.match(css, /\.apx-search\s*\{\s*width:\s*382px/);
    assert.match(css, /@media\s*\(min-width:\s*64\.0625rem\)[\s\S]*grid-template-columns:\s*120px\s+174px\s+110px\s+150px\s+200px\s+300px/);
    assert.match(css, /\.apx-detail-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*756px\)\s+380px;\s*gap:\s*48px/);
    assert.match(css, /@media\s*\(min-width:\s*48\.0625rem\)/);
    assert.match(css, /@media\s*\(max-width:\s*48rem\)[\s\S]*\.apx-search\s*\{\s*width:\s*100%/);
    assert.match(css, /\.apx-row-actions\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});
