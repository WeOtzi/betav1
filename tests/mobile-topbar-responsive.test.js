const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('the shared artist topbar compacts every control at phone widths', () => {
    const css = read('public', 'shared', 'css', 'ds', 'components.css');
    const organismsCss = read('public', 'shared', 'css', 'ds', 'organisms.css');

    assert.match(css, /@media\s*\(max-width:30rem\)[\s\S]*?\.wo-app \.wo-topbar\.wo-topbar--artist\s*\{[\s\S]*?min-height:56px/);
    assert.match(css, /\.wo-app \.wo-topbar--artist \.wo-topbar-brand\s*\{[\s\S]*?padding-inline:var\(--space-2\)[\s\S]*?font-size:16px/);
    assert.match(css, /\.wo-app \.wo-topbar--artist \.wo-topbar-right\s*\{[\s\S]*?min-width:0[\s\S]*?padding-inline:var\(--space-2\)/);
    assert.match(css, /\.wo-app \.wo-topbar--artist \.wo-topbar-right \.wo-o-tile\s*\{[\s\S]*?width:44px[\s\S]*?height:44px/);
    assert.match(css, /\.wo-app \.wo-topbar--artist \.wo-topbar-right \.wo-btn\s*\{[\s\S]*?min-height:44px[\s\S]*?font-size:10px/);
    assert.match(css, /\.wo-app \.wo-topbar--artist \.wo-topbar-menu-toggle\s*\{[\s\S]*?min-width:44px[\s\S]*?min-height:44px/);
    assert.match(organismsCss, /@media\s*\(max-width:480px\)[\s\S]*?\.wo-app \.wo-topbar\.wo-org-product-nav\{height:56px;min-height:56px/);
    assert.match(organismsCss, /\.wo-org-product-nav__links\{[^}]*flex:1 1 1019\.806px[^}]*min-width:830px/);
    assert.match(organismsCss, /@media\s*\(max-width:1279px\)[\s\S]*?\.wo-org-product-nav__links\{display:none\}[\s\S]*?\.wo-app \.wo-topbar\.wo-org-product-nav \.wo-org-product-nav__menu\{display:inline-flex\}/);
    assert.match(organismsCss, /\.wo-app \.wo-org-product-navigation \.wo-org-product-nav__mobile:not\(\[hidden\]\)\{display:flex\}/);
});

test('the account center preserves global navigation through an accessible mobile menu', () => {
    const html = read('public', 'artist', 'account', 'index.html');
    const js = read('public', 'shared', 'js', 'artist-account.js');

    assert.match(html, /<weotzi-product-nav[\s\S]*menu-toggle-id="aac-mobile-menu-toggle"[\s\S]*menu-id="aac-mobile-menu"/);
    assert.match(html, /profile-current/);
    assert.match(js, /function wireChrome\(\)[\s\S]*?const closeMobileMenu/);
    assert.match(js, /menuToggle\.setAttribute\('aria-expanded', String\(open\)\)/);
    assert.match(js, /event\.key !== 'Escape'/);
});

test('all authenticated artist surfaces mount the same product-navigation component', () => {
    const pages = [
        { parts: ['public', 'artist', 'dashboard', 'index.html'], active: 'quotations', menu: 'dashboard-mobile-menu' },
        { parts: ['public', 'artist', 'account', 'index.html'], active: 'account', menu: 'aac-mobile-menu' },
        { parts: ['public', 'artist', 'profile', 'details', 'index.html'], active: 'account', menu: 'dashboard-mobile-menu' },
        { parts: ['public', 'artist', 'visitors', 'index.html'], active: 'visitors', menu: 'dashboard-mobile-menu' },
        { parts: ['public', 'calendar', 'index.html'], active: 'calendar', menu: 'admin-mobile-menu' },
        { parts: ['public', 'my-quotations', 'statistics', 'index.html'], active: 'statistics', menu: 'admin-mobile-menu' },
        { parts: ['public', 'artist', 'travel', 'index.html'], active: 'travel', menu: 'tv-mobile-menu' },
        { parts: ['public', 'artist', 'inbox', 'index.html'], active: 'inbox', menu: 'ai-mobile-menu' },
        { parts: ['public', 'job-board', 'index.html'], active: 'job-board', menu: 'dashboard-mobile-menu' },
        { parts: ['public', 'studio-spots', 'index.html'], active: 'spots', menu: 'spots-mobile-menu' },
        { parts: ['public', 'artist', 'applications', 'index.html'], active: 'quotations', menu: 'apx-mobile-menu' },
        { parts: ['public', 'artist', 'invitations', 'index.html'], active: 'quotations', menu: 'inv-mobile-menu' },
        { parts: ['public', 'my-quotations', 'index.html'], active: 'quotations', menu: 'admin-mobile-menu' },
        { parts: ['public', 'my-quotations', 'detail', 'index.html'], active: 'quotations', menu: 'admin-mobile-menu' },
    ];

    pages.forEach(({ parts, active, menu }) => {
        const html = read(...parts);
        const label = parts.join('/');
        assert.match(html, /\/shared\/css\/ds\/organisms\.css/, label);
        assert.match(html, /\/shared\/js\/ds\/organisms\.js/, label);
        assert.match(html, new RegExp(`<weotzi-product-nav[^>]*active="${active}"[^>]*>`), label);
        assert.match(html, new RegExp(`menu-id="${menu}"`), label);
        assert.equal((html.match(/<weotzi-product-nav\b/g) || []).length, 1, label);
        assert.doesNotMatch(html, /<header class="[^"]*wo-topbar--artist/, label);
    });
});

test('calendar keeps a single navigation mode throughout tablet widths', () => {
    const css = read('public', 'shared', 'css', 'ds', 'components.css');

    assert.match(css, /\.wo-app \.wo-topbar\.wo-topbar--artist \.wo-topbar-nav\s*\{display:none/);
    assert.match(css, /\.wo-app \.wo-topbar\.wo-topbar--artist \.wo-topbar-menu-toggle\s*\{display:inline-flex/);
    assert.match(css, /@media\s*\(min-width:72rem\)[\s\S]*?\.wo-topbar-nav\s*\{display:flex[\s\S]*?\.wo-topbar-menu-toggle\s*\{display:none/);
});
