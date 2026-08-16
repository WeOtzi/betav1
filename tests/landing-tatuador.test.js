const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const pageDir = path.join(rootDir, 'public', 'landing-tatuador');
const html = fs.readFileSync(path.join(pageDir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(pageDir, 'styles.css'), 'utf8');
const script = fs.readFileSync(path.join(pageDir, 'script.js'), 'utf8');

test('artist landing contains every Figma content section in the intended order', () => {
    const sectionMarkers = [
        'id="inicio"',
        'id="ventajas"',
        'id="como-funciona"',
        'id="testimonios"',
        'id="faq"',
        'class="final-cta"'
    ];

    let previousIndex = -1;
    for (const marker of sectionMarkers) {
        const currentIndex = html.indexOf(marker);
        assert.ok(currentIndex > previousIndex, `${marker} should appear after the previous section`);
        previousIndex = currentIndex;
    }

    assert.match(html, /Haz crecer tu creatividad con We Ötzi/);
    assert.match(html, /Beneficios destacados/);
    assert.match(html, /Todo lo que necesitás saber/);
    assert.match(html, /Empezá a tatuar con más oportunidades/);
});

test('artist landing uses local Figma exports and base-path-safe navigation', () => {
    assert.doesNotMatch(html, /figma\.com\/api\/mcp\/asset/);
    assert.doesNotMatch(css, /figma\.com\/api\/mcp\/asset/);
    assert.match(html, /href="\.\.\/register-artist"/);
    assert.match(html, /href="\.\.\/artist\/login"/);

    const assetMatches = [...html.matchAll(/(?:src)="\.\/assets\/([^"]+)"/g)];
    assert.ok(assetMatches.length >= 29, 'the page should render the complete exported icon set');

    for (const [, assetName] of assetMatches) {
        assert.ok(fs.existsSync(path.join(pageDir, 'assets', assetName)), `${assetName} should exist locally`);
    }
});

test('artist landing includes responsive navigation and reduced-motion support', () => {
    assert.match(css, /@media \(max-width: 960px\)/);
    assert.match(css, /@media \(max-width: 700px\)/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(script, /aria-expanded/);
    assert.match(script, /Escape/);
    assert.match(html, /aria-controls="mobile-menu"/);
});
