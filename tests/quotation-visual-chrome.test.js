const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const quotationHtml = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'quotation', 'index.html'),
    'utf8'
);
const sharedCss = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'shared', 'css', 'styles.css'),
    'utf8'
);

test('quotation keeps client controls inside a registration-style Bauhaus header', () => {
    assert.match(quotationHtml, /<body class="quotation-page">/);
    assert.match(quotationHtml, /<header class="app-header quotation-client-header" role="banner">/);
    assert.match(quotationHtml, /id="back-btn" class="nav-btn q-client-back hidden"/);
    assert.match(quotationHtml, /class="q-client-brand-marks"/);
    assert.match(quotationHtml, /COTIZADOR CLIENTE/);
    assert.match(quotationHtml, /id="header-login-btn" class="nav-btn nav-btn-login q-client-login"/);
    assert.match(quotationHtml, /id="header-user-btn" class="nav-btn nav-btn-logged q-client-user hidden"/);
    assert.match(quotationHtml, /id="theme-toggle" class="nav-btn q-client-theme"/);
    assert.match(quotationHtml, /<footer class="bauhaus-footer quotation-client-footer" data-bauhaus-footer/);
});

test('quotation visual chrome is scoped and mirrors the registration Bauhaus constraints', () => {
    assert.match(sharedCss, /body\.quotation-page\s*\{/);
    assert.match(sharedCss, /body\.quotation-page \.quotation-client-header[\s\S]*grid-template-columns:\s*auto 1fr auto/);
    assert.match(sharedCss, /body\.quotation-page \.q-client-brand-marks \.sq[\s\S]*background:\s*var\(--red\)/);
    assert.match(sharedCss, /body\.quotation-page \.q-client-tag[\s\S]*border-left:\s*1\.5px solid var\(--ink\)/);
    assert.match(sharedCss, /body\.quotation-page > \.app-container > \.quotation-client-footer\.bauhaus-footer\.bauhaus-footer-component/);
    assert.match(sharedCss, /@media \(max-width:\s*600px\)[\s\S]*body\.quotation-page \.q-client-tag[\s\S]*display:\s*none/);
});
