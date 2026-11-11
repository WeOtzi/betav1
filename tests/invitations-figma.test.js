const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Invitaciones · Figma final del flujo de artista (oct 2026):
// 801:540 listado · 801:541 detalle · 801:1101/1102/1103 drawers ·
// 2007:5792/5793 mapa · 2007:5794 estudio · 2007:5795 escribir al estudio.

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Invitaciones carga su propia capa Figma sin las reglas .inv-* heredadas de Spots', () => {
    const html = read('public/artist/invitations/index.html');
    const js = read('public/shared/js/artist-invitations.js');
    const figmaIndex = html.indexOf('/shared/css/artist-invitations-figma.css');
    const studiosIndex = html.indexOf('/shared/css/invitations-studios.css');

    assert.ok(figmaIndex > -1, 'la capa del listado/detalle tiene que cargarse');
    assert.ok(studiosIndex > figmaIndex, 'la capa del mapa/estudio va después');
    assert.doesNotMatch(html, /studio-spots-ds\.css/, 'las reglas .inv-* del diseño anterior pisaban el Figma final');
    assert.match(html, /<weotzi-product-nav[\s\S]*active="invitations"/);
    assert.match(html, /logout-id="auth-logout"/);
    assert.match(html, /logout-class="inv-logout hidden"/);
    assert.match(html, /id="inv-preferences"[^>]*|href="\/artist\/account#notificaciones"/);
    assert.match(js, /document\.getElementById\('auth-logout'\)/);

    // Las reglas de topbar que antes venían de studio-spots-ds.css viven en la capa propia.
    const css = read('public/shared/css/artist-invitations-figma.css');
    assert.match(css, /\.inv-page \.hidden\s*\{\s*display:\s*none !important/);
    assert.match(css, /\.inv-mobile-menu\s*\{/);
    assert.match(css, /\.inv-o-tile\s*\{/);
});

test('Invitaciones respeta el orden de carga de la capa de datos y no crea clientes propios', () => {
    const html = read('public/artist/invitations/index.html');
    const order = ['config-manager.js', 'data/postgrest-client.js', 'data/studios-repo.js', 'data/invitations-repo.js',
        'invitations-model.js', 'invitations-map.js', 'invitations-studio.js', 'artist-invitations.js'];
    let last = -1;
    order.forEach((file) => {
        const index = html.indexOf(`/shared/js/${file}`);
        assert.ok(index > last, `${file} fuera de orden`);
        last = index;
    });
    ['artist-invitations.js', 'invitations-map.js', 'invitations-studio.js'].forEach((file) => {
        const js = read(`public/shared/js/${file}`);
        assert.doesNotMatch(js, /createClient\(/, `${file} no debe crear un cliente Supabase`);
        assert.doesNotMatch(js, /\/rest\/v1\//, `${file} no debe hacer fetch REST inline`);
        assert.doesNotMatch(js, /\.from\('/, `${file} debe usar repos con nombre`);
    });
});

test('El listado consume invitation_details y pinta todos los estados del Figma 801:540', () => {
    const js = read('public/shared/js/artist-invitations.js');

    assert.match(js, /invitation_details/);
    assert.match(js, /Invitación del mes/);
    assert.match(js, /Miembro del roster/);
    assert.match(js, /function renderRow/);
    assert.match(js, /function renderRejected/);
    assert.match(js, /String\(state\.items\.length\)\.padStart\(2, '0'\)/);
    assert.match(js, /inv-quote-mark/);
    assert.match(js, /navigate\(\{ vista: 'mapa' \}\)/, 'el botón Mapa de estudios abre la vista interna');
    // Ningún dato de ejemplo del mockup se inyecta como fallback en producción.
    assert.doesNotMatch(js, /Fierro Negro|Nico Ferro|fierronegro/i);
});

test('El detalle 801:541 tiene stepper, pestañas funcionales y resumen lateral', () => {
    const js = read('public/shared/js/artist-invitations.js');
    assert.match(js, /class="inv-detail-header"[\s\S]*stepperHtml\(membership\._state\)/);
    assert.match(js, /data-detail-tab="roster"/);
    assert.match(js, /data-detail-tab="details"/);
    assert.match(js, /function offerPanel/);
    assert.match(js, /function infoPanel/);
    ['studio_provides', 'artist_expectations', 'acceptance_steps', 'response_due_at', 'proposed_start_date'].forEach((key) => {
        assert.match(js, new RegExp(key));
    });
    assert.match(js, /Contactar al estudio/);
    assert.match(js, /WoInvitationsStudio\.openContact/);
});

test('Los drawers 801:1101/1102/1103 conservan copy, foco y RPC de cambios', () => {
    const js = read('public/shared/js/artist-invitations.js');

    assert.match(js, /Invitación aceptada/);
    assert.match(js, /¡Bienvenido al equipo!/);
    assert.match(js, /Solicitar cambios/);
    assert.match(js, /Tu propuesta de cambios/);
    assert.match(js, /StudioMemberships\.requestChanges\(membership\.id,\s*state\.userId,\s*message\)/);
    assert.match(js, /Invitación rechazada/);
    assert.match(js, /Ver otras invitaciones/);
    assert.match(js, /aria-modal="true"/);
    assert.match(js, /drawer === 'cambios'/);
});

test('La capa CSS conserva el drawer de 380px con sombra dura y los cortes responsive', () => {
    const css = read('public/shared/css/artist-invitations-figma.css');

    assert.match(css, /\.inv-drawer\s*\{[\s\S]*width:\s*min\(380px,\s*calc\(100vw\s*-\s*32px\)\)/);
    assert.match(css, /box-shadow:\s*5px\s+5px\s+0\s+#24211d/);
    assert.match(css, /\.inv-detail\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+380px/);
    assert.match(css, /\.inv-feature\s*\{[\s\S]*container-type:\s*inline-size/);
    assert.match(css, /\.inv-shell\s*\{\s*box-sizing:\s*border-box;[\s\S]*?max-width:\s*1440px/);
    assert.match(css, /width:\s*min\(1184px,\s*calc\(100%\s*-\s*72px\)\)/);
    assert.match(css, /\.inv-index-name\s*>\s*span\s*\{[\s\S]*?min-width:\s*0[\s\S]*?text-overflow:\s*ellipsis[\s\S]*?white-space:\s*nowrap/);
    assert.match(css, /@media\s*\(max-width:\s*48rem\)[\s\S]*\.inv-head\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.match(css, /\.inv-stepper\s*\{[\s\S]*flex-wrap:\s*nowrap/);
    assert.doesNotMatch(css, /border-radius:\s*(?!0|var\(--radius-pill\))[1-9]/, 'radius 0 salvo dots');
});
