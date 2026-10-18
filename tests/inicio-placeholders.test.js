const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '../public/inicio/index.html'), 'utf8');

test('role cards show neutral image placeholders without unfinished copy or colored artwork', () => {
    const media = [...page.matchAll(/<div class="inicio-media" aria-hidden="true">([\s\S]*?)<\/div>/g)];
    assert.equal(media.length, 2, 'both cards need a placeholder');
    for (const [, content] of media) {
        assert.doesNotMatch(content, /<[^>]+>|im-circle|im-square|im-triangle|Ilustración editorial|pendiente/i);
    }
    assert.doesNotMatch(page, /\.im-circle|\.im-square|\.im-triangle/);
    assert.match(page, /\.inicio-media\{[^}]*background:var\(--surface-media\)/);
});

test('role card destinations stay unchanged', () => {
    assert.match(page, /class="wo-card wo-card--media wo-card--hover inicio-card" href="\/marketplace"/);
    assert.match(page, /class="wo-card wo-card--media wo-card--hover inicio-card" href="\/artist\/login"/);
});
