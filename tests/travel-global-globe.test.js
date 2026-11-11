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

test('the global globe works without a Travel-page-only class and keeps only the Figma overlays', () => {
    const styles = fs.readFileSync(path.join(root, 'public', 'shared', 'css', 'weotzi-travel-globe.css'), 'utf8');
    const source = fs.readFileSync(componentPath, 'utf8');
    assert.match(styles, /weotzi-travel-globe\{display:block/);
    assert.doesNotMatch(styles, /weotzi-travel-globe\.tvl-globe\[data-globe-mode/);
    assert.match(source, /WoIcons\?\.hydrate\?\.\(this\)/);
    // Figma final 801:1076: ruta, paradas, base y leyenda. Sin tarjeta de destino,
    // sin flechas 01/03, sin "Reiniciar vista" ni la tira de paradas.
    assert.match(source, /class="tvl-cobe-hotspot/);
    assert.match(source, /class="tvl-cobe-base"/);
    assert.match(source, /class="tvl-cobe-legend"/);
    assert.doesNotMatch(source, /class="tvl-cobe-info"|class="tvl-cobe-stepper"|class="tvl-cobe-controls"|data-globe-act="reset"/);
    // La pausa (WCAG 2.2.2) sigue disponible por teclado y se hace visible con foco.
    assert.match(source, /data-globe-act="pause"/);
    assert.match(styles, /\.tvl-cobe-playback\{[^}]*clip-path:inset\(50%\)/);
    assert.match(styles, /\.tvl-cobe-playback:focus-visible\{[^}]*clip-path:none/);
});

test('selecting a stop marks the hotspot as current and clicking it opens the trip', () => {
    const globe = new component.WeotziTravelGlobe();
    const attrs = (initial) => {
        const map = new Map(Object.entries(initial));
        const classes = new Set();
        return {
            getAttribute: (name) => (map.has(name) ? map.get(name) : null),
            setAttribute: (name, value) => map.set(name, String(value)),
            removeAttribute: (name) => map.delete(name),
            classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)), contains: (name) => classes.has(name) },
        };
    };
    const berlin = attrs({ 'data-globe-stop': 'trip-berlin' });
    const madrid = attrs({ 'data-globe-stop': 'trip-madrid' });
    globe.querySelectorAll = () => [berlin, madrid];
    globe._renderInfo({ id: 'trip-berlin' });
    assert.equal(berlin.getAttribute('aria-current'), 'true');
    assert.equal(berlin.classList.contains('is-selected'), true);
    assert.equal(madrid.getAttribute('aria-current'), null);

    const emitted = [];
    globe.selectTrip = (id) => ({ id });
    globe._emit = (name, detail) => emitted.push({ name, detail });
    globe._onClick({ target: { closest: (selector) => (selector === '[data-globe-stop]' ? madrid : null) } });
    assert.deepEqual(emitted.map((event) => [event.name, event.detail.id]), [['travel-view-trip', 'trip-madrid']]);
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
