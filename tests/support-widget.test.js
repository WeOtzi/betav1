const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const registerClosedBetaHtml = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'registerclosedbeta', 'index.html'),
    'utf8'
);
const supportChatJs = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'shared', 'js', 'support-chat.js'),
    'utf8'
);
const supportChatCss = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'shared', 'css', 'support-chat.css'),
    'utf8'
);
const publicDir = path.resolve(__dirname, '..', 'public');
const scriptJs = fs.readFileSync(
    path.resolve(publicDir, 'shared', 'js', 'script.js'),
    'utf8'
);
const appConfigJson = fs.readFileSync(
    path.resolve(publicDir, 'shared', 'js', 'app-config.json'),
    'utf8'
);

function listFiles(dir, predicate, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            listFiles(fullPath, predicate, out);
        } else if (predicate(fullPath)) {
            out.push(fullPath);
        }
    }
    return out;
}

function cssRule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = supportChatCss.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
    assert.ok(match, `missing CSS rule: ${selector}`);
    return match[1];
}

test('closed beta registration shows only the support widget, not feedback', () => {
    assert.match(registerClosedBetaHtml, /\/shared\/js\/support-loader\.js/);
    assert.doesNotMatch(registerClosedBetaHtml, /\/shared\/css\/feedback\.css/);
    assert.doesNotMatch(registerClosedBetaHtml, /\/shared\/js\/feedback\.js/);
    assert.doesNotMatch(registerClosedBetaHtml, /id="feedback-trigger"/);
    assert.doesNotMatch(registerClosedBetaHtml, /id="feedback-modal"/);
    assert.doesNotMatch(registerClosedBetaHtml, /registerclosedbeta-page \.sc-fab[\s\S]*display:\s*none !important/);
});

test('public pages do not load the legacy feedback or quotation survey assets', () => {
    const htmlFiles = listFiles(publicDir, file => file.endsWith('.html'));
    const forbiddenPatterns = [
        /\/shared\/css\/feedback\.css/,
        /\/shared\/js\/feedback\.js/,
        /\/shared\/css\/quotation-survey\.css/,
        /\/shared\/js\/quotation-survey\.js/,
        /id="feedback-trigger"/,
        /id="feedback-modal"/,
        /id="feedback-form"/
    ];

    for (const file of htmlFiles) {
        const html = fs.readFileSync(file, 'utf8');
        for (const pattern of forbiddenPatterns) {
            assert.doesNotMatch(html, pattern, path.relative(publicDir, file));
        }
    }
});

test('quotation flow no longer invokes post-submit survey feedback', () => {
    assert.doesNotMatch(scriptJs, /QuotationSurvey/);
    assert.doesNotMatch(scriptJs, /quotation_surveys/);
    assert.doesNotMatch(appConfigJson, /client_survey_/);
    assert.doesNotMatch(appConfigJson, /admin_new_feedback/);
});

test('support widget exposes an icon-only circular support button', () => {
    assert.match(supportChatJs, /aria-label',\s*'Abrir soporte We Otzi'/);
    assert.doesNotMatch(supportChatJs, /sc-fab-label/);
    assert.doesNotMatch(supportChatJs, /SOPORTE WE OTZI/);
    assert.match(supportChatCss, /--sc-fab-size:\s*60px/);
    assert.match(supportChatCss, /\.sc-fab[\s\S]*width:\s*var\(--sc-fab-size\)[\s\S]*height:\s*var\(--sc-fab-size\)[\s\S]*border-radius:\s*50%/);
    assert.doesNotMatch(cssRule('.sc-fab'), /box-shadow:/);
    assert.doesNotMatch(cssRule('.sc-fab:hover'), /box-shadow:/);
    assert.doesNotMatch(cssRule('.sc-fab:active'), /box-shadow:/);
    assert.doesNotMatch(supportChatCss, /sc-fab-label/);
    assert.match(supportChatCss, /@media \(max-width:\s*768px\)[\s\S]*--sc-fab-size:\s*58px/);
    assert.match(supportChatCss, /@media \(max-width:\s*480px\)[\s\S]*--sc-fab-size:\s*56px/);
});
