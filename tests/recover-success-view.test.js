const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('artist recovery success keeps the Figma wording and a self-contained check', () => {
    const html = fs.readFileSync('public/recover/index.html', 'utf8');
    const view = html.match(/<section id="rc-view-success"[\s\S]*?<\/section>/)?.[0];
    assert.ok(view, 'success view exists');
    assert.match(view, /<svg[^>]*class="rc-success-check"[^>]*>[\s\S]*?<path[^>]*d="M[^\"]+"[^>]*><\/path>[\s\S]*?<\/svg>/);
    assert.match(view, /¡Contraseña actualizada!/);
    assert.match(view, /Ya podés iniciar sesión con tu nueva contraseña\./);
    assert.match(view, /id="rc-success-cta"[\s\S]*?Iniciar sesión[\s\S]*?artist-login\/arrow-right\.svg/);
});

test('success layout uses the 72px Figma icon and 44px CTA without a stepper', () => {
    const css = fs.readFileSync('public/shared/css/recover-ds.css', 'utf8');
    assert.match(css, /\.rc-success-icon\{[^}]*width:72px;height:72px/);
    assert.match(css, /#rc-success-cta\{[^}]*height:var\(--control-h-md\)/);
    const js = fs.readFileSync('public/shared/js/recover.js', 'utf8');
    assert.match(js, /\$\('rc-steps'\)\.hidden = step > 3/);
    assert.match(js, /\$\('rc-view-success'\)\.hidden = step !== 4/);
});
