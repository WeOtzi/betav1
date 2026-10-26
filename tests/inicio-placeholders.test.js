const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

test('role cards select one option with blue feedback without navigating', () => {
    assert.equal((page.match(/type="radio" name="inicio-role"/g) || []).length, 2);
    assert.match(page, /\.inicio-card:has\(\.inicio-choice:checked\)\{[^}]*border-color:var\(--blue-400\);[^}]*background:var\(--info-bg\)/);
    assert.match(page, /\.inicio-card:has\(\.inicio-choice:checked\) \.inicio-check\{[^}]*color:var\(--blue-400\)/);
    assert.equal((page.match(/class="inicio-check"[^>]*>\s*<i data-wo-icon="check"/g) || []).length, 2);
    assert.match(page, /\.inicio-check i:empty::after\{[^}]*border-right:[^;]+;border-bottom:[^;]+;[^}]*transform:rotate\(45deg\)/);
    assert.doesNotMatch(page, /class="wo-card wo-card--media wo-card--hover inicio-card" href=/);
});

test('continuar stays disabled until selection and follows the chosen existing route', () => {
    assert.match(page, /id="inicio-continue"[^>]*disabled/);
    const script = page.match(/<script id="inicio-role-selection">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script, 'selection script should be present');

    const handlers = {};
    const inputs = ['client', 'artist'].map(value => ({
        value, checked: false,
        addEventListener(event, callback) { handlers[`${value}:${event}`] = callback; }
    }));
    const button = {
        disabled: true,
        addEventListener(event, callback) { handlers[`button:${event}`] = callback; }
    };
    const location = { href: '/preview/preview-local-safe/inicio/' };
    vm.runInNewContext(script, {
        document: {
            querySelectorAll: () => inputs,
            querySelector: () => inputs.find(input => input.checked) || null,
            getElementById: () => button
        },
        window: { location }
    });

    handlers['button:click']();
    assert.equal(location.href, '/preview/preview-local-safe/inicio/');
    inputs[0].checked = true;
    handlers['client:change']();
    assert.equal(button.disabled, false);
    handlers['button:click']();
    assert.equal(location.href, '../marketplace/');

    inputs[0].checked = false;
    inputs[1].checked = true;
    handlers['artist:change']();
    assert.equal(button.disabled, false);
    handlers['button:click']();
    assert.equal(location.href, '../landing-tatuador/');
});
