const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Invitaciones loads its isolated Figma layer after the shared spots styles', () => {
    const html = read('public/artist/invitations/index.html');
    const js = read('public/shared/js/artist-invitations.js');
    const sharedIndex = html.indexOf('/shared/css/studio-spots-ds.css');
    const figmaIndex = html.indexOf('/shared/css/artist-invitations-figma.css');

    assert.ok(sharedIndex > -1, 'shared studio/spots stylesheet must remain loaded');
    assert.ok(figmaIndex > sharedIndex, 'the invitations Figma layer must win the cascade');
    assert.match(html, /<weotzi-product-nav[\s\S]*active="quotations"/);
    assert.match(html, /id="inv-preferences"/);
    assert.match(html, /logout-id="auth-logout"/);
    assert.match(html, /logout-class="inv-logout hidden"/);
    assert.match(js, /document\.getElementById\('auth-logout'\)/);
    assert.doesNotMatch(js, /querySelectorAll\('\[data-inv-logout\]'\)/);
});

test('Invitaciones consumes the embedded offer contract and renders all Figma feed states', () => {
    const js = read('public/shared/js/artist-invitations.js');

    assert.match(js, /invitation_details/);
    assert.match(js, /invitation-bang-bang\.jpeg/);
    assert.match(js, /Invitación del mes/);
    assert.match(js, /Miembro del roster/);
    assert.match(js, /function renderRejected/);
    assert.match(js, /countEl\.textContent\s*=\s*String\(items\.length\)/);
    assert.match(js, /studio_provides/);
    assert.match(js, /artist_expectations/);
    assert.match(js, /acceptance_steps/);
    assert.match(js, /response_due_at/);
    assert.match(js, /proposed_start_date/);
    assert.match(js, /class="inv-detail-header"/);
    assert.match(js, /inv-detail-header[\s\S]*stepperHtml\(membership\._state\)/);
});

test('Invitaciones implements the accepted, change-request and rejected Figma drawers', () => {
    const js = read('public/shared/js/artist-invitations.js');

    assert.match(js, /Invitación aceptada/);
    assert.match(js, /¡Bienvenido al equipo!/);
    assert.match(js, /Solicitar cambios/);
    assert.match(js, /Tu propuesta de cambios/);
    assert.match(js, /StudioMemberships\.requestChanges\(membershipId,\s*userId,\s*message\)/);
    assert.match(js, /Invitación rechazada/);
    assert.match(js, /Ver otras invitaciones/);
    assert.match(js, /aria-modal="true"/);
});

test('Invitaciones Figma layer preserves the 380px hard-shadow drawer and responsive layouts', () => {
    const css = read('public/shared/css/artist-invitations-figma.css');

    assert.match(css, /\.inv-drawer\s*\{[\s\S]*width:\s*min\(380px,\s*calc\(100vw\s*-\s*32px\)\)/);
    assert.match(css, /box-shadow:\s*5px\s+5px\s+0\s+#24211d/);
    assert.match(css, /\.inv-detail\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+380px/);
    assert.match(css, /@media\s*\(min-width:\s*64\.0625rem\)/);
    assert.match(css, /\.inv-feature\s*\{[\s\S]*container-type:\s*inline-size/);
    assert.match(css, /#inv-feed-view \*[\s\S]*box-sizing:\s*border-box/);
    assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+364px/);
    assert.match(css, /max-width:\s*1440px/);
    assert.match(css, /width:\s*min\(1184px,\s*calc\(100%\s*-\s*72px\)\)/);
    assert.match(css, /\.inv-head\s*\{[\s\S]*?max-width:\s*100%[\s\S]*?min-width:\s*0/);
    assert.match(css, /\.inv-index\s*\{[\s\S]*?max-width:\s*100%[\s\S]*?overflow:\s*hidden/);
    assert.match(css, /\.inv-index-item\s*\{[\s\S]*?width:\s*100%[\s\S]*?overflow:\s*hidden/);
    assert.match(css, /\.inv-index-name\s*>\s*span\s*\{[\s\S]*?min-width:\s*0[\s\S]*?text-overflow:\s*ellipsis[\s\S]*?white-space:\s*nowrap/);
    assert.match(css, /@media\s*\(max-width:\s*48rem\)[\s\S]*\.inv-head\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.match(css, /\.inv-stepper\s*\{[\s\S]*flex-wrap:\s*nowrap/);
});
