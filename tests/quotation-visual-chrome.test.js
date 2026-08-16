const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const quotationHtml = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'quotation', 'index.html'),
    'utf8'
);
const quotationCss = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'shared', 'css', 'quotation-ds.css'),
    'utf8'
);

test('quotation usa el chrome del design system Bauhaus (wo-topbar + DS)', () => {
    assert.match(quotationHtml, /<body class="wo-app quotation-page">/);
    assert.match(quotationHtml, /<header class="wo-topbar[^"]*"[^>]*role="banner">/);
    assert.match(quotationHtml, /class="wo-topbar-brand"/);
    assert.match(quotationHtml, /Cotizador · Cliente/);
    assert.match(quotationHtml, /id="header-login-btn" class="wo-iconbtn/);
    assert.match(quotationHtml, /id="header-user-btn" class="wo-iconbtn[^"]*hidden"/);
    assert.match(quotationHtml, /id="back-btn" class="wo-btn wo-btn--ghost hidden"/);
    // Tokens y componentes del DS cargados; styles.css ya no se usa en esta página.
    assert.match(quotationHtml, /href="\/shared\/css\/ds\/tokens\.css"/);
    assert.match(quotationHtml, /href="\/shared\/css\/ds\/components\.css"/);
    assert.match(quotationHtml, /href="\/shared\/css\/quotation-ds\.css"/);
    assert.doesNotMatch(quotationHtml, /shared\/css\/styles\.css/);
    // Sin modo oscuro en el DS: el toggle de tema no existe más.
    assert.doesNotMatch(quotationHtml, /id="theme-toggle"/);
});

test('quotation-ds.css respeta las reglas del DS (solo tokens, sin hex sueltos)', () => {
    // Ningún color hex fuera de data-URIs (los SVG inline embebidos pueden llevar %23).
    const withoutDataUris = quotationCss.replace(/url\("data:[^"]*"\)/g, '');
    assert.doesNotMatch(withoutDataUris, /#[0-9a-fA-F]{3,8}\b/);
    // La página se apoya en los tokens del DS.
    assert.match(quotationCss, /var\(--surface-page\)|var\(--neutral-100\)/);
    assert.match(quotationCss, /var\(--font-display\)/);
});
