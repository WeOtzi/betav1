const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const registerArtistHtml = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'register-artist', 'index.html'),
    'utf8'
);
const registerJs = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'shared', 'js', 'register.js'),
    'utf8'
);
const registerCss = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'shared', 'css', 'register.css'),
    'utf8'
);

function cssBetween(startMarker, endMarker) {
    const start = registerArtistHtml.indexOf(startMarker);
    assert.notEqual(start, -1, `missing CSS marker: ${startMarker}`);
    const end = registerArtistHtml.indexOf(endMarker, start);
    assert.notEqual(end, -1, `missing CSS marker: ${endMarker}`);
    return registerArtistHtml.slice(start, end);
}

test('artist registration removes the standalone artist city step', () => {
    assert.doesNotMatch(registerArtistHtml, /id="city"/);
    assert.doesNotMatch(registerArtistHtml, /Step 4: City\/Location/);
    assert.doesNotMatch(registerArtistHtml, /PASO 04 DE 12[\s\S]*UBICACI/);
    assert.doesNotMatch(registerArtistHtml, /wo-step04/);
    assert.match(registerArtistHtml, /<section class="form-step wo-bauhaus-step wo-step05" data-step="4">[\s\S]*PASO 04 DE 11[\s\S]*ESTILOS/);
    assert.match(registerJs, /totalSteps:\s*11/);
    assert.doesNotMatch(registerJs, /case 4:\s*const city/);
    assert.match(registerJs, /if \(!Array\.isArray\(d\.styles\) \|\| d\.styles\.length === 0\) return 4/);
});

test('artist registration keeps dense option steps scrollable at tablet width', () => {
    assert.match(registerArtistHtml, /form-step\.wo-step05 \.wo-form-col[\s\S]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\) auto/);
    assert.match(registerArtistHtml, /form-step\.wo-step05 \.styles-grid[\s\S]*max-height:\s*min\(34vh,\s*360px\)/);
    assert.match(registerArtistHtml, /form-step\.wo-step05 \.styles-grid[\s\S]*overflow-y:\s*auto/);
});

test('artist registration styles step mobile scrolls the whole step so the poster moves away', () => {
    const sharedBlock = cssBetween('/* -------- Shared Bauhaus', '</style>');

    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step05\.active[\s\S]*overflow-y:\s*auto[\s\S]*-webkit-overflow-scrolling:\s*touch/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step05 \.wo-form-col[\s\S]*display:\s*flex[\s\S]*overflow:\s*visible/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step05 \.styles-grid[\s\S]*max-height:\s*none[\s\S]*overflow:\s*visible/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step05 \.wo-step01-actions[\s\S]*position:\s*static/);
});

test('artist registration constrains long form controls on tablet and phone', () => {
    assert.match(registerArtistHtml, /form-step\.wo-step10 #studio_name,[\s\S]*form-step\.wo-step10 #address_search[\s\S]*font-size:\s*28px !important/);
    assert.match(registerArtistHtml, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-bauhaus-step \.wo-form-col[\s\S]*overflow-y:\s*auto/);
    assert.match(registerArtistHtml, /wo-step01-actions[\s\S]*flex-shrink:\s*0/);
    assert.match(registerArtistHtml, /step-indicator\[hidden\][\s\S]*display:\s*none !important/);
});

test('artist registration mobile shell stays anchored to the viewport', () => {
    const tabletBlock = cssBetween('/* -------- Tablet', '/* -------- Mobile');
    assert.doesNotMatch(
        registerArtistHtml,
        /#sc-fab,\s*[\r\n]+\s*\/\*\s*-------- Tablet/,
        'a dangling support selector before the tablet media block makes the browser discard responsive rules'
    );
    assert.match(tabletBlock, /body\.register-page > main\.register-container[\s\S]*position:\s*fixed !important[\s\S]*left:\s*0 !important[\s\S]*right:\s*0 !important[\s\S]*width:\s*100% !important[\s\S]*transform:\s*none !important/);
    assert.match(tabletBlock, /wo-nav-links[\s\S]*display:\s*none/);
    assert.match(tabletBlock, /form-step\[data-step="1"\]\.wo-step01[\s\S]*grid-template-columns:\s*1fr[\s\S]*grid-template-rows:\s*auto 1fr/);
    assert.match(tabletBlock, /body\.register-page > main\.register-container[\s\S]*height:\s*calc\(100dvh - var\(--wo-header-h\) - var\(--wo-progress-h\) - var\(--register-global-footer-height,\s*44px\)\) !important/);

    assert.match(registerArtistHtml, /@media \(max-width:\s*600px\)[\s\S]*body\.register-page > main\.register-container[\s\S]*left:\s*0 !important[\s\S]*right:\s*0 !important[\s\S]*width:\s*100% !important[\s\S]*transform:\s*none !important/);
    assert.match(registerArtistHtml, /@media \(max-width:\s*600px\)[\s\S]*body\.register-page > main\.register-container[\s\S]*overflow-x:\s*hidden !important/);
});

test('artist registration mobile keeps bottom CTA above the visible footer', () => {
    const mobileBlock = cssBetween('/* -------- Mobile', '/* -------- Shared Bauhaus');
    assert.match(mobileBlock, /--register-global-footer-height:\s*calc\(48px \+ env\(safe-area-inset-bottom,\s*0px\)\)/);
    assert.doesNotMatch(mobileBlock, /--register-global-footer-height:\s*0px/);
    assert.match(mobileBlock, /body\.register-page > main\.register-container[\s\S]*height:\s*calc\(100dvh - var\(--wo-header-h\) - var\(--wo-progress-h\) - var\(--register-global-footer-height\)\) !important/);
    assert.match(mobileBlock, /body\.register-page > main\.register-container[\s\S]*min-height:\s*calc\(100dvh - var\(--wo-header-h\) - var\(--wo-progress-h\) - var\(--register-global-footer-height\)\) !important/);
    assert.match(mobileBlock, /wo-step01-actions[\s\S]*bottom:\s*8px/);
    assert.match(mobileBlock, /html body\.register-page > footer\.bauhaus-footer\.bauhaus-footer-component[\s\S]*display:\s*block !important/);
    assert.doesNotMatch(mobileBlock, /body\.register-page \.bauhaus-footer\s*\{[\s\S]*display:\s*none !important/);
});

test('artist registration mobile uses compact iPhone-scale controls and one-row footer', () => {
    const mobileBlock = cssBetween('/* -------- Mobile', '/* -------- Shared Bauhaus');
    assert.match(mobileBlock, /--wo-header-h:\s*46px/);
    assert.match(mobileBlock, /--wo-progress-h:\s*18px/);
    assert.match(mobileBlock, /wo-poster-col[\s\S]*height:\s*98px/);
    assert.match(mobileBlock, /wo-poster-col[\s\S]*padding:\s*16px 16px 16px/);
    assert.match(mobileBlock, /wo-form-col[\s\S]*min-height:\s*calc\(100dvh - var\(--wo-header-h\) - var\(--wo-progress-h\) - var\(--register-global-footer-height\) - 98px\)/);
    assert.match(mobileBlock, /question-title[\s\S]*font-size:\s*clamp\(32px,\s*9\.8vw,\s*37px\) !important/);
    assert.match(mobileBlock, /form-step\[data-step="1"\]\.wo-step01 \.input-wrapper[\s\S]*margin-top:\s*30px !important/);
    assert.match(mobileBlock, /form-step\[data-step="1"\]\.wo-step01 \.form-input[\s\S]*font-size:\s*20px !important/);
    assert.match(mobileBlock, /wo-step01-actions[\s\S]*grid-template-areas:[\s\S]*"back next"[\s\S]*"terms terms"/);
    assert.match(mobileBlock, /wo-step01-actions[\s\S]*padding-top:\s*20px/);
    assert.match(mobileBlock, /wo-step01-actions \.wo-next-btn[\s\S]*grid-area:\s*next[\s\S]*min-height:\s*48px/);
    assert.match(mobileBlock, /wo-step01-actions \.wo-back-btn[\s\S]*grid-area:\s*back[\s\S]*width:\s*100%[\s\S]*min-height:\s*48px/);
    assert.match(mobileBlock, /wo-step01-actions \.keyhint[\s\S]*grid-area:\s*terms[\s\S]*text-align:\s*center[\s\S]*justify-self:\s*center[\s\S]*padding:\s*10px 0[\s\S]*width:\s*100%/);
    assert.match(mobileBlock, /form-step\[data-step="1"\]\.wo-step01 \.wo-hint-row[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto[\s\S]*gap:\s*6px 12px/);
    assert.match(mobileBlock, /form-step\[data-step="1"\]\.wo-step01 \.wo-hint[\s\S]*font-family:\s*var\(--mono\)/);
    assert.match(mobileBlock, /form-step\[data-step="1"\]\.wo-step01 \.wo-username-preview[\s\S]*font-family:\s*var\(--mono\) !important[\s\S]*margin-top:\s*12px/);
    assert.match(mobileBlock, /form-step\[data-step="1"\]\.wo-step01 \.wo-username-preview span,[\s\S]*form-step\[data-step="1"\]\.wo-step01 \.wo-username-preview strong[\s\S]*font-family:\s*var\(--mono\) !important/);
    assert.match(mobileBlock, /footer\.bauhaus-footer\.bauhaus-footer-component \.footer-content[\s\S]*flex-direction:\s*row !important/);
    assert.match(mobileBlock, /footer\.bauhaus-footer\.bauhaus-footer-component \.footer-content[\s\S]*max-width:\s*max-content !important/);
    assert.match(mobileBlock, /footer\.bauhaus-footer\.bauhaus-footer-component \.footer-text[\s\S]*display:\s*none !important/);
    assert.match(mobileBlock, /footer\.bauhaus-footer\.bauhaus-footer-component \.footer-copyright::after[\s\S]*© 2025 WE ÖTZI/);
});

test('artist registration mobile propagates step 1 visual system to every artist step', () => {
    const sharedBlock = cssBetween('/* -------- Shared Bauhaus', '</style>');
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-bauhaus-step \.wo-poster-col[\s\S]*height:\s*98px[\s\S]*min-height:\s*98px[\s\S]*padding:\s*16px 16px 16px/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-bauhaus-step \.wo-manifesto-type[\s\S]*font-size:\s*clamp\(34px,\s*10\.5cqw,\s*38px\)[\s\S]*line-height:\s*0\.86/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-bauhaus-step \.wo-form-col[\s\S]*padding:\s*12px 16px 8px[\s\S]*gap:\s*10px[\s\S]*min-height:\s*calc\(100dvh - var\(--wo-header-h\) - var\(--wo-progress-h\) - var\(--register-global-footer-height\) - 98px\)/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-bauhaus-step \.question-title[\s\S]*font-size:\s*clamp\(32px,\s*9\.8vw,\s*37px\) !important[\s\S]*line-height:\s*0\.9 !important/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-bauhaus-step \.ig-preauth-only \.password-create-copy[\s\S]*font-size:\s*22px !important[\s\S]*font-weight:\s*900 !important/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-bauhaus-step \.form-input[\s\S]*font-size:\s*20px !important/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-bauhaus-step \.ig-preauth-only \.form-input[\s\S]*font-size:\s*20px !important/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step10 #studio_name,[\s\S]*form-step\.wo-step10 #address_search[\s\S]*font-size:\s*20px !important/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-bauhaus-step \.wo-form-col > \.input-wrapper,[\s\S]*form-step\.wo-bauhaus-step \.wo-form-col > div:has\(> \.summary-card\)[\s\S]*margin-top:\s*30px !important/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-bauhaus-step \.wo-username-preview strong,[\s\S]*form-step\.wo-bauhaus-step \.wo-plain-preview strong[\s\S]*font-family:\s*var\(--mono\) !important/);
});

test('artist registration success screen is left aligned on mobile without confirmation square', () => {
    const sharedBlock = cssBetween('/* -------- Shared Bauhaus', '</style>');

    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step-success \.success-animation[\s\S]*display:\s*none !important/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step-success \.question-title,[\s\S]*form-step\.wo-step-success \.question-subtitle,[\s\S]*form-step\.wo-step-success \.wo-step-indicator[\s\S]*text-align:\s*left !important/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step-success \.wo-step01-actions[\s\S]*grid-template-areas:[\s\S]*"next"[\s\S]*"terms"[\s\S]*justify-items:\s*start/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step-success \.wo-step01-actions \.wo-next-btn[\s\S]*width:\s*min\(100%,\s*330px\)[\s\S]*justify-self:\s*start/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step-success \.wo-step01-actions \.keyhint[\s\S]*justify-self:\s*center[\s\S]*text-align:\s*center/);
});

test('artist registration step question titles use Source Serif 4', () => {
    assert.match(registerArtistHtml, /family=Source\+Serif\+4:opsz,wght@8\.\.60,500;8\.\.60,600;8\.\.60,700;8\.\.60,800;8\.\.60,900/);
    assert.match(registerArtistHtml, /--question-serif:\s*"Source Serif 4"/);
    assert.match(registerArtistHtml, /form-step\[data-step="1"\]\.wo-step01 \.question-title[\s\S]*font-family:\s*var\(--question-serif\) !important/);
    assert.match(registerArtistHtml, /form-step\.wo-bauhaus-step \.question-title[\s\S]*font-family:\s*var\(--question-serif\) !important/);
});

test('artist registration review step uses a scrollable mobile modal without losing editing hooks', () => {
    assert.match(registerArtistHtml, /id="summary-mobile-open"[\s\S]*class="summary-mobile-open"[\s\S]*aria-controls="summary-review-modal"/);
    assert.match(registerArtistHtml, /id="summary-review-modal"[\s\S]*class="summary-review-modal"[\s\S]*aria-hidden="true"/);
    assert.match(registerArtistHtml, /id="summary-review-close"[\s\S]*class="summary-review-close"/);
    assert.match(registerArtistHtml, /class="summary-review-scroll"[\s\S]*id="summary-card"/);
    assert.match(registerArtistHtml, /form-step\.wo-step-summary \.wo-form-col[\s\S]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\) auto/);
    assert.match(registerArtistHtml, /form-step\.wo-step-summary \.summary-card[\s\S]*max-height:\s*min\(42vh,\s*420px\)/);
    assert.match(registerArtistHtml, /form-step\.wo-step-summary \.summary-card[\s\S]*overflow-y:\s*auto/);
    assert.match(registerArtistHtml, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step-summary \.wo-poster-col[\s\S]*height:\s*70px/);
    assert.match(registerArtistHtml, /@media \(max-width:\s*600px\)[\s\S]*summary-mobile-open[\s\S]*display:\s*flex/);
    assert.match(registerArtistHtml, /@media \(max-width:\s*600px\)[\s\S]*summary-review-modal\.is-open[\s\S]*position:\s*fixed[\s\S]*inset:\s*0[\s\S]*display:\s*grid/);
    assert.match(registerArtistHtml, /@media \(max-width:\s*600px\)[\s\S]*summary-review-panel[\s\S]*max-height:\s*calc\(100dvh - 16px\)[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)/);
    assert.match(registerArtistHtml, /@media \(max-width:\s*600px\)[\s\S]*summary-review-scroll[\s\S]*overflow-y:\s*auto/);
    assert.match(registerArtistHtml, /@media \(max-width:\s*600px\)[\s\S]*summary-review-modal\.is-open \.summary-card[\s\S]*max-height:\s*none[\s\S]*overflow:\s*visible/);
    assert.match(registerJs, /function setupSummaryReviewModal\(\)/);
    assert.match(registerJs, /summaryOpen\.addEventListener\('click',\s*openSummaryReviewModal\)/);
    assert.match(registerJs, /const cell = e\.target\.closest\('\.summary-editable'\)/);
});

test('artist registration review step can edit Instagram from the modal summary', () => {
    assert.match(registerJs, /const portfolioSummary = resolvePortfolioLinks\(usernamePreview\)/);
    assert.match(registerJs, /portfolioEditableHtml = editable\([\s\S]*'edit-field': 'instagram_handle'[\s\S]*'edit-type': 'instagram'/);
    assert.match(registerJs, /let valueToStore = newValue/);
    assert.match(registerJs, /if \(field === 'instagram_handle'\)[\s\S]*replace\(\/\^@\+\/,\s*''\)[\s\S]*formState\.data\.portfolio_source = 'instagram'/);
    assert.match(registerJs, /wizardInput\.value = valueToStore/);
    assert.match(registerJs, /summary-edit-save/);
    assert.match(registerJs, /summary-edit-cancel/);
});

test('artist registration review complex rows expose visible edit buttons', () => {
    assert.match(registerJs, /function jumpToStep\(label,\s*step\)[\s\S]*\$\{editChip\}/);
    assert.match(registerJs, /<div class="summary-label">Estilos<\/div>[\s\S]*\$\{jumpToStep\(stylesHtml,\s*4\)\}/);
    assert.match(registerJs, /<div class="summary-label">Modalidad<\/div>[\s\S]*\$\{jumpToStep\(escapeHtmlSummary\(workTypeDisplay\),\s*9\)\}/);
    assert.match(registerJs, /<div class="summary-label">Fecha de nacimiento<\/div>[\s\S]*\$\{jumpToStep\(birthDateDisplay,\s*10\)\}/);
    assert.match(registerJs, /<div class="summary-label">Newsletter<\/div>[\s\S]*\$\{jumpToStep\(newsletterDisplay,\s*11\)\}/);
    assert.match(registerJs, /summary-media-edit[\s\S]*data-summary-media-edit[\s\S]*Editar/);
    assert.match(registerCss, /summary-jump:hover \.summary-edit-action/);
    assert.match(registerCss, /summary-media-edit[\s\S]*display:\s*inline-flex/);
});

test('artist registration autosave does not let stale draft responses drop selected styles', () => {
    assert.match(registerJs, /let registrationDraftSyncPending = false/);
    assert.match(registerJs, /let registrationDraftLocalVersion = 0/);
    assert.match(registerJs, /function persistRegistrationDraft\(\)[\s\S]*registrationDraftLocalVersion \+= 1/);
    assert.match(registerJs, /if \(registrationDraftSyncInFlight && !options\.force\)[\s\S]*registrationDraftSyncPending = true/);
    assert.match(registerJs, /const syncVersion = registrationDraftLocalVersion/);
    assert.match(registerJs, /const hasNewerLocalChanges = registrationDraftLocalVersion !== syncVersion/);
    assert.match(registerJs, /if \(payload\.artist && !hasNewerLocalChanges\)[\s\S]*applyArtistDraftFromServer\(payload\.artist\)/);
    assert.match(registerJs, /registrationDraftSyncPending \|\| registrationDraftLocalVersion !== syncVersion/);
});

test('artist registration draft resume loads safely before saving session price', () => {
    assert.match(registerJs, /function normalizeSessionPriceAmount\(value\)/);
    assert.match(registerJs, /function extractSessionPriceCurrency\(value\)/);
    assert.match(registerJs, /const serverSessionPrice = normalizeSessionPriceAmount\(artist\.session_price_amount \?\? artist\.session_price\)/);
    assert.match(registerJs, /async function loadRegistrationDraftFromServer\(\)/);
    assert.match(registerJs, /fetch\(apiUrl\(`\/api\/register\/artist-draft\?\$\{params\.toString\(\)\}`\)\)/);
    assert.match(registerJs, /restoredDraftStep = restoreRegistrationDraft\(\)/);
    assert.match(registerJs, /loadedRemoteDraft = await loadRegistrationDraftFromServer\(\)/);
    assert.match(registerJs, /if \(!registrationDraftId \|\| restoredDraftStep \|\| !loadedRemoteDraft\)[\s\S]*saveRegistrationDraftToServer\(\{ force: true \}\)/);
    assert.match(registerJs, /const summarySessionPrice = normalizeSessionPriceAmount\(data\.session_price\)/);
    assert.match(registerJs, /sessionCurrencySelect\.value = data\.session_currency/);
});

test('artist registration review main mobile view is compact for a 393 by 745 useful viewport', () => {
    const sharedBlock = cssBetween('/* -------- Shared Bauhaus', '</style>');

    assert.match(sharedBlock, /form-step\.wo-step-summary \.wo-poster-col[\s\S]*height:\s*70px[\s\S]*min-height:\s*70px[\s\S]*padding:\s*8px 14px 7px/);
    assert.match(sharedBlock, /form-step\.wo-step-summary \.wo-form-col[\s\S]*gap:\s*5px/);
    assert.match(sharedBlock, /form-step\.wo-step-summary \.wo-form-col[\s\S]*padding:\s*7px 14px 5px/);
    assert.match(sharedBlock, /form-step\.wo-step-summary \.wo-form-col[\s\S]*min-height:\s*calc\(100dvh - var\(--wo-header-h\) - var\(--wo-progress-h\) - var\(--register-global-footer-height\) - 70px\)/);
    assert.match(sharedBlock, /form-step\.wo-step-summary \.question-title[\s\S]*font-size:\s*clamp\(26px,\s*7\.7vw,\s*29px\) !important[\s\S]*line-height:\s*0\.86 !important/);
    assert.match(sharedBlock, /form-step\.wo-step-summary \.summary-mobile-open[\s\S]*min-height:\s*50px[\s\S]*padding:\s*7px 9px/);
    assert.match(sharedBlock, /form-step\.wo-step-summary \.terms-container[\s\S]*padding:\s*6px 8px[\s\S]*border:\s*0[\s\S]*background:\s*transparent/);
    assert.match(sharedBlock, /form-step\.wo-step-summary \.terms-checkmark[\s\S]*width:\s*22px[\s\S]*height:\s*22px/);
    assert.match(sharedBlock, /form-step\.wo-step-summary \.wo-step01-actions \.wo-next-btn[\s\S]*min-height:\s*40px/);
    assert.match(sharedBlock, /form-step\.wo-step-summary \.wo-step01-actions \.wo-back-btn[\s\S]*min-height:\s*40px/);
});

test('artist registration review terms align to the copy column on compact mobile', () => {
    const sharedBlock = cssBetween('/* -------- Shared Bauhaus', '</style>');

    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step-summary \.wo-form-col > div:has\(> \.summary-review\)[\s\S]*margin-top:\s*5px !important/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step-summary \.wo-poster-col[\s\S]*height:\s*70px[\s\S]*min-height:\s*70px/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step-summary \.wo-form-col[\s\S]*padding:\s*7px 14px 5px[\s\S]*min-height:\s*calc\(100dvh - var\(--wo-header-h\) - var\(--wo-progress-h\) - var\(--register-global-footer-height\) - 70px\)/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step-summary \.summary-mobile-open[\s\S]*min-height:\s*50px[\s\S]*padding:\s*7px 9px/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step-summary \.terms-checkbox-wrapper[\s\S]*display:\s*grid[\s\S]*grid-template-columns:\s*22px minmax\(0,\s*1fr\)[\s\S]*margin-bottom:\s*0/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step-summary \.terms-checkmark[\s\S]*width:\s*22px[\s\S]*height:\s*22px/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step-summary \.terms-text[\s\S]*display:\s*block[\s\S]*text-align:\s*left[\s\S]*font-size:\s*9\.8px/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step-summary \.terms-info[\s\S]*margin:\s*6px 0 0 30px[\s\S]*padding-left:\s*0[\s\S]*font-size:\s*8\.5px/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step-summary \.wo-step01-actions \.wo-back-btn,[\s\S]*form-step\.wo-step-summary \.wo-step01-actions \.wo-next-btn[\s\S]*min-height:\s*40px/);
});

test('artist registration step 9 opens the bio editor as a fixed-height mobile modal', () => {
    const mobileBlock = cssBetween('/* -------- Mobile', '/* -------- Shared Bauhaus');

    assert.match(registerArtistHtml, /id="bio-mobile-open"[\s\S]*class="bio-mobile-open"/);
    assert.match(registerArtistHtml, /id="bio-mobile-preview"[\s\S]*class="bio-mobile-preview"/);
    assert.match(registerArtistHtml, /id="bio-modal-close"[\s\S]*class="bio-modal-close"/);
    assert.match(registerArtistHtml, /class="bio-modal-head"/);

    assert.match(mobileBlock, /form-step\.wo-step09 \.wo-form-col[\s\S]*display:\s*grid[\s\S]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\) auto[\s\S]*overflow:\s*hidden/);
    assert.match(mobileBlock, /form-step\.wo-step09 \.bio-step-body[\s\S]*min-height:\s*0[\s\S]*display:\s*grid[\s\S]*grid-template-rows:\s*minmax\(0,\s*1fr\) auto/);
    assert.match(mobileBlock, /form-step\.wo-step09 \.bio-editor-wrapper[\s\S]*display:\s*none/);
    assert.match(mobileBlock, /form-step\.wo-step09 \.bio-editor-wrapper\.bio-modal-open[\s\S]*position:\s*fixed[\s\S]*inset:\s*0[\s\S]*height:\s*100dvh[\s\S]*display:\s*grid[\s\S]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\)/);
    assert.match(mobileBlock, /form-step\.wo-step09 \.bio-editor-wrapper\.bio-modal-open \.bio-editor[\s\S]*min-height:\s*0[\s\S]*max-height:\s*none[\s\S]*overflow-y:\s*auto/);
});

test('artist registration step 10 mobile is compact for a 393 by 745 useful viewport', () => {
    const sharedBlock = cssBetween('/* -------- Shared Bauhaus', '</style>');

    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step10 \.wo-poster-col[\s\S]*height:\s*86px[\s\S]*min-height:\s*86px[\s\S]*padding:\s*12px 16px 10px/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step10 \.wo-form-col[\s\S]*gap:\s*7px[\s\S]*padding:\s*9px 16px 6px[\s\S]*min-height:\s*calc\(100dvh - var\(--wo-header-h\) - var\(--wo-progress-h\) - var\(--register-global-footer-height\) - 86px\)/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step10 \.question-title[\s\S]*font-size:\s*clamp\(29px,\s*8\.8vw,\s*33px\) !important/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step10 \.wo-form-col > div:has\(> \.work-type-options\)[\s\S]*margin-top:\s*10px !important/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step10 \.work-type-options[\s\S]*max-height:\s*none[\s\S]*gap:\s*6px/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step10 \.work-type-option[\s\S]*min-height:\s*42px[\s\S]*padding:\s*8px 9px[\s\S]*gap:\s*8px/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step10 \.work-type-label[\s\S]*font-size:\s*14px/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step10 \.work-type-desc[\s\S]*font-size:\s*9px/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step10 \.studio-name-wrapper,[\s\S]*form-step\.wo-step10 \.address-picker-wrapper[\s\S]*margin-top:\s*8px !important[\s\S]*padding-top:\s*8px !important/);
});

test('artist registration step 10 scrolls mobile to the follow-up field after work type selection', () => {
    assert.match(registerJs, /function scrollWorkTypeFollowupIntoView\(workType\)/);
    assert.match(registerJs, /window\.matchMedia\('\(max-width: 600px\)'\)\.matches/);
    assert.match(registerJs, /const target = isStudioWork[\s\S]*studio-name-wrapper[\s\S]*address-picker-wrapper/);
    assert.match(registerJs, /scroller\.scrollTo\(\{[\s\S]*top:[\s\S]*behavior: reduceMotion \? 'auto' : 'smooth'[\s\S]*\}\)/);
    assert.match(registerJs, /function selectWorkTypeOption\(btn\)[\s\S]*applyAddressPickerVisibility\(btn\.dataset\.type\)[\s\S]*scrollWorkTypeFollowupIntoView\(btn\.dataset\.type\)/);
});

test('artist registration step 11 mobile keeps the newsletter invite compact and left aligned', () => {
    const sharedBlock = cssBetween('/* -------- Shared Bauhaus', '</style>');

    assert.match(registerArtistHtml, /class="newsletter-invite-block"[\s\S]*class="newsletter-invite"/);
    assert.doesNotMatch(registerArtistHtml, /class="newsletter-invite-block"[\s\S]*class="newsletter-icon"/);
    assert.match(registerArtistHtml, /Radar de artistas We Otzi/);
    assert.match(registerArtistHtml, /Recibe lanzamientos, mejoras del perfil, oportunidades y avisos importantes para crecer con menos ruido\./);
    assert.doesNotMatch(registerArtistHtml, /Te enviaremos novedades utiles sobre lanzamientos, mejoras del perfil, oportunidades con estudios, convocatorias/);
    assert.match(sharedBlock, /form-step\.wo-step12 \.newsletter-invite-block[\s\S]*justify-items:\s*start[\s\S]*gap:\s*0[\s\S]*margin-bottom:\s*14px/);
    assert.match(sharedBlock, /form-step\.wo-step12 \.newsletter-invite[\s\S]*display:\s*block[\s\S]*text-align:\s*left[\s\S]*box-sizing:\s*border-box/);
    assert.match(sharedBlock, /form-step\.wo-step12 \.newsletter-options[\s\S]*flex-direction:\s*row[\s\S]*width:\s*100%[\s\S]*max-width:\s*none[\s\S]*box-sizing:\s*border-box/);
    assert.match(sharedBlock, /form-step\.wo-step12 \.newsletter-option[\s\S]*flex:\s*1 1 0[\s\S]*max-width:\s*calc\(50% - 4px\)[\s\S]*box-sizing:\s*border-box/);
    assert.match(sharedBlock, /form-step\.wo-step12 \.newsletter-option\[data-subscribe="true"\][\s\S]*background:\s*var\(--yellow\)/);
    assert.match(sharedBlock, /form-step\.wo-step12 \.newsletter-option\[data-subscribe="false"\][\s\S]*background:\s*var\(--ink\)/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step12 \.wo-form-col > div:has\(> \.newsletter-invite-block\)[\s\S]*margin-top:\s*12px !important/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step12 \.newsletter-invite[\s\S]*padding:\s*10px 12px/);
    assert.match(sharedBlock, /@media \(max-width:\s*600px\)[\s\S]*form-step\.wo-step12 \.newsletter-icon[\s\S]*width:\s*36px[\s\S]*height:\s*36px/);
});

test('artist registration step 11 starts without a newsletter default and blocks review until selection', () => {
    assert.match(registerJs, /subscribed_newsletter:\s*null/);
    assert.match(registerJs, /formState\.data\.subscribed_newsletter = null/);
    assert.match(registerJs, /typeof data\.subscribed_newsletter === 'boolean'/);
    assert.match(registerJs, /typeof formState\.data\.subscribed_newsletter !== 'boolean'/);
    assert.match(registerJs, /function setNewsletterSelectionError\(show\)/);
    assert.match(registerArtistHtml, /id="newsletter-options"[\s\S]*aria-describedby="newsletter-error"/);
    assert.match(registerArtistHtml, /id="newsletter-error"[\s\S]*Elige una opcion para continuar/);
});

test('artist registration bio editor exposes requested rich text controls', () => {
    assert.match(registerArtistHtml, /data-command="bold"/);
    assert.match(registerArtistHtml, /data-command="italic"/);
    assert.match(registerArtistHtml, /data-command="underline"/);
    assert.match(registerArtistHtml, /data-command="strikeThrough"/);
    assert.match(registerArtistHtml, /data-command="undo"/);
    assert.match(registerArtistHtml, /data-command="redo"/);
    assert.match(registerArtistHtml, /id="text-color-picker"[\s\S]*type="color"/);
    assert.match(registerArtistHtml, /data-command="createLink"/);
    assert.match(registerArtistHtml, /id="emoji-trigger"[\s\S]*class="[^"]*emoji-btn/);
    assert.match(registerArtistHtml, /id="emoji-picker"[\s\S]*class="emoji-picker"[\s\S]*class="emoji-item"/);
});

test('artist registration mobile bio toolbar preserves touch activation and selection', () => {
    const editorBlockStart = registerJs.indexOf('function initRichTextEditor()');
    const editorBlockEnd = registerJs.indexOf('// Insert text at current caret position', editorBlockStart);
    assert.notEqual(editorBlockStart, -1, 'missing rich text editor initializer');
    assert.notEqual(editorBlockEnd, -1, 'missing rich text editor insertion marker');

    const editorBlock = registerJs.slice(editorBlockStart, editorBlockEnd);
    assert.doesNotMatch(
        editorBlock,
        /toolbar\.addEventListener\('touchstart'[\s\S]*?e\.preventDefault\(\)/,
        'touchstart preventDefault can suppress synthetic clicks on iPhone Chrome/Safari'
    );
    assert.match(editorBlock, /function saveSelectionFromEditor\(\)/);
    assert.match(editorBlock, /function restoreSelection\(\)[\s\S]*bioEditor\.focus\(\)[\s\S]*sel\.addRange\(savedSelection\)/);
    assert.match(editorBlock, /insertTextAtCaret\(emojiBtn\.textContent\);\s*syncBioContent/);
});

test('artist registration bio toolbar uses selection wrapping for mobile-safe inline formatting', () => {
    const editorBlockStart = registerJs.indexOf('function initRichTextEditor()');
    const editorBlockEnd = registerJs.indexOf('// Insert text at current caret position', editorBlockStart);
    const editorBlock = registerJs.slice(editorBlockStart, editorBlockEnd);

    assert.match(editorBlock, /function wrapSelectionWithElement\(tagName,\s*options = \{\}\)/);
    assert.match(editorBlock, /case 'bold':[\s\S]*wrapSelectionWithElement\('strong'\)/);
    assert.match(editorBlock, /case 'italic':[\s\S]*wrapSelectionWithElement\('em'\)/);
    assert.match(editorBlock, /case 'underline':[\s\S]*wrapSelectionWithElement\('u'\)/);
    assert.match(editorBlock, /case 'strikeThrough':[\s\S]*wrapSelectionWithElement\('s'\)/);
    assert.match(editorBlock, /case 'createLink':[\s\S]*wrapSelectionWithElement\('a',\s*\{[\s\S]*href/);
    assert.doesNotMatch(editorBlock, /document\.execCommand\(command/);
});

test('artist registration bio toolbar applies active inline formats to newly typed mobile text', () => {
    const editorBlockStart = registerJs.indexOf('function initRichTextEditor()');
    const editorBlockEnd = registerJs.indexOf('// Insert text at current caret position', editorBlockStart);
    const editorBlock = registerJs.slice(editorBlockStart, editorBlockEnd);

    assert.match(editorBlock, /const activeInlineFormats = \{/);
    assert.match(editorBlock, /function insertFormattedTextAtCaret\(text\)/);
    assert.match(editorBlock, /bioEditor\.addEventListener\('beforeinput'[\s\S]*e\.inputType === 'insertText'[\s\S]*insertFormattedTextAtCaret\(e\.data\)/);
    assert.match(editorBlock, /bioEditor\.addEventListener\('keydown'[\s\S]*e\.key\.length === 1[\s\S]*insertFormattedTextAtCaret\(e\.key\)/);
    assert.match(editorBlock, /function toggleInlineFormat\(formatName\)/);
});

test('artist registration bio toolbar can deactivate inline formats for following text', () => {
    const editorBlockStart = registerJs.indexOf('function initRichTextEditor()');
    const editorBlockEnd = registerJs.indexOf('// Insert text at current caret position', editorBlockStart);
    const editorBlock = registerJs.slice(editorBlockStart, editorBlockEnd);

    assert.match(editorBlock, /function moveCaretOutsideFormat\(formatName\)/);
    assert.match(editorBlock, /function setInlineFormat\(formatName,\s*enabled\)/);
    assert.match(editorBlock, /const currentlyEnabled = activeInlineFormats\[formatName\] \|\| Boolean\(findFormatAncestor\(formatName\)\)/);
    assert.match(editorBlock, /setInlineFormat\(formatName,\s*!currentlyEnabled\)/);
    assert.match(editorBlock, /if \(!enabled\) moveCaretOutsideFormat\(formatName\)/);
});

test('artist registration bio toolbar supports undo and redo history', () => {
    const editorBlockStart = registerJs.indexOf('function initRichTextEditor()');
    const editorBlockEnd = registerJs.indexOf('// Insert text at current caret position', editorBlockStart);
    const editorBlock = registerJs.slice(editorBlockStart, editorBlockEnd);

    assert.match(editorBlock, /const editorHistory = \{/);
    assert.match(editorBlock, /function recordEditorHistory\(/);
    assert.match(editorBlock, /function restoreEditorHistory\(/);
    assert.match(editorBlock, /case 'undo':[\s\S]*restoreEditorHistory\('undo'\)/);
    assert.match(editorBlock, /case 'redo':[\s\S]*restoreEditorHistory\('redo'\)/);
});
