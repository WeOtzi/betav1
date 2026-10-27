const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('password step uses the supplied lock and arrow artwork in its controls', () => {
    const html = fs.readFileSync('public/recover/index.html', 'utf8');
    const view = html.match(/<section id="rc-view-password"[\s\S]*?<\/section>/)?.[0];
    assert.ok(view, 'password view exists');
    assert.equal((view.match(/src="\/shared\/assets\/figma\/artist-login\/lock\.svg"/g) || []).length, 2);
    assert.match(view, /id="rc-password-submit"[^>]*disabled[\s\S]*?src="\/shared\/assets\/figma\/artist-login\/arrow-right\.svg"/);
});

test('recovery poster has a filled red triangle rather than an outlined box', () => {
    const css = fs.readFileSync('public/shared/css/recover-ds.css', 'utf8');
    const decoration = css.match(/\.rc-poster::after\{([^}]*)\}/)?.[1];
    assert.ok(decoration, 'poster decoration exists');
    assert.match(decoration, /border-left:44px solid transparent/);
    assert.match(decoration, /border-right:44px solid transparent/);
    assert.match(decoration, /border-bottom:80px solid var\(--bauhaus-square\)/);
});

test('password controls retain the compact Figma field and action heights', () => {
    const css = fs.readFileSync('public/shared/css/recover-ds.css', 'utf8');
    assert.match(css, /#rc-view-password \.wo-input\{[^}]*height:46px;min-height:46px/);
    assert.match(css, /#rc-password-submit\{[^}]*height:var\(--control-h-md\);min-height:var\(--control-h-md\)/);
    assert.match(css, /#rc-view-password \.rc-reqs \+ \.wo-field\{margin-top:var\(--space-1\)\}/);
});

test('password requirements and reveal controls have an offline icon fallback', () => {
    const css = fs.readFileSync('public/shared/css/recover-ds.css', 'utf8');
    assert.match(css, /#rc-view-password \.rc-req \[data-wo-icon\]:empty::after\{/);
    assert.match(css, /#rc-view-password \.rc-eye \[data-wo-icon\]:empty::before\{/);
});
