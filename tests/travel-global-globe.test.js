'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const componentPath = path.join(root, 'public', 'shared', 'js', 'weotzi-travel-globe.js');
const component = fs.existsSync(componentPath) ? require(componentPath) : {};

test('the COBE experience is exposed as a reusable global web component', () => {
    assert.equal(typeof component.WeotziTravelGlobe, 'function');
    assert.equal(typeof component.defineTravelGlobeElement, 'function');
    assert.equal(component.tagName, 'weotzi-travel-globe');
});

test('the global globe works without a Travel-page-only class and restores accessible controls', () => {
    const styles = fs.readFileSync(path.join(root, 'public', 'shared', 'css', 'weotzi-travel-globe.css'), 'utf8');
    const source = fs.readFileSync(componentPath, 'utf8');
    assert.match(styles, /weotzi-travel-globe\{display:block/);
    assert.doesNotMatch(styles, /weotzi-travel-globe\.tvl-globe\[data-globe-mode/);
    assert.match(source, /querySelectorAll\('\.tvl-cobe-step\[data-globe-stop\]'\)/);
    assert.match(source, /WoIcons\?\.hydrate\?\.\(this\)/);
});

test('the destination information panel always expands instead of creating internal scrollbars', () => {
    const globe = new component.WeotziTravelGlobe();
    const panel = { innerHTML: '', style: {} };
    const count = { textContent: '' };
    globe.querySelector = (selector) => selector === '.tvl-cobe-info' ? panel : selector === '.tvl-cobe-count' ? count : null;
    globe.querySelectorAll = () => [];
    globe._navigator = { selectedIndex: 0 };
    globe._route = { stops: [{ id: 'trip-berlin' }] };

    globe._renderInfo({
        id: 'trip-berlin',
        city: 'Berlín',
        country: 'Alemania',
        status: 'confirmado',
        startDate: '2026-09-03',
        endDate: '2026-09-05',
        studioName: 'Bauhaus Ink Fest',
        address: 'Berlín, Alemania',
        summary: 'Confirmar alojamiento en Kreuzberg.',
        trip: { trip_type: 'convencion' },
    });

    assert.equal(panel.style.maxHeight, 'none');
    assert.equal(panel.style.overflow, 'visible');
});

test('canonical Travel loads the global component and does not gate it behind globe=cobe', () => {
    const html = fs.readFileSync(path.join(root, 'public', 'artist', 'travel', 'index.html'), 'utf8');
    const integration = fs.readFileSync(path.join(root, 'public', 'shared', 'js', 'artist-travel.js'), 'utf8');
    assert.match(html, /<weotzi-travel-globe\b[^>]*id="tv-globe"/);
    assert.match(html, /\/shared\/js\/weotzi-travel-globe\.js/);
    assert.match(html, /\/shared\/css\/weotzi-travel-globe\.css/);
    assert.doesNotMatch(integration, /isCobeGlobeMode/);
    assert.doesNotMatch(integration, /params\.set\('globe',\s*'cobe'\)/);
});

test('the page delegates route rendering to the global component contract', () => {
    const integration = fs.readFileSync(path.join(root, 'public', 'shared', 'js', 'artist-travel.js'), 'utf8');
    assert.match(integration, /setTravelData\s*\(/);
    assert.match(integration, /buildUpcomingDestinations\s*\(/);
    assert.match(integration, /travel-stop-select/);
    assert.doesNotMatch(integration, /import\('\/shared\/vendor\/cobe\/index\.esm\.js'\)/);
});

test('Travel uses one accessible focus model for studio suggestions and announces the full hero update', () => {
    const html = fs.readFileSync(path.join(root, 'public', 'artist', 'travel', 'index.html'), 'utf8');
    const integration = fs.readFileSync(path.join(root, 'public', 'shared', 'js', 'artist-travel.js'), 'utf8');
    assert.match(html, /class="tvl-hero-inner"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
    assert.match(integration, /role="option"\s+tabindex="-1"/);
    assert.match(integration, /if \(event\.key === 'Enter'\) \{\s*options\[Math\.max\(0, current\)\]\.click\(\);/);
    assert.match(integration, /input\.removeAttribute\('aria-controls'\)/);
});
