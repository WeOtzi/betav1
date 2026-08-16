// Tests del registro de artistas (public/register-artist/index.html).
// Diseño actual: acordeón de 7 grupos en una sola página, según los frames de
// Figma del flujo "Registro" (nodos 72:12357 … 72:12993 + guardado/éxito).
// NO es un wizard paso-a-paso: cada grupo completado colapsa a una fila resumen
// con su valor y un link EDITAR, y solo el grupo activo muestra sus campos.
// CSS de página: public/shared/css/register-artist-ds.css (solo var(--token)).
// Lógica: public/shared/js/register.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'register-artist', 'index.html'),
    'utf8'
);
const registerJs = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'shared', 'js', 'register.js'),
    'utf8'
);
const dsCss = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'shared', 'css', 'register-artist-ds.css'),
    'utf8'
);

const GROUPS = ['quien', 'acceso', 'oficio', 'presencia', 'trabajo', 'novedades', 'revision'];

function mediaBlock(width) {
    const marker = `@media (max-width:${width}px){`;
    const start = dsCss.indexOf(marker);
    assert.notEqual(start, -1, `falta el bloque responsive: ${marker}`);
    const next = dsCss.indexOf('@media', start + marker.length);
    return next === -1 ? dsCss.slice(start) : dsCss.slice(start, next);
}

// ---------------------------------------------------------------- estructura

test('el registro es un acordeón de 7 grupos, en el orden del Figma', () => {
    const found = [...html.matchAll(/<section class="ra-group[^"]*" data-group="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((id) => id !== 'ig');
    assert.deepEqual(found, GROUPS);
    // Cada grupo trae su fila resumen (colapsado) y su panel (activo), salvo
    // revisión, que nunca se colapsa porque es el cierre del flujo.
    for (const id of GROUPS.filter((g) => g !== 'revision')) {
        const section = html.split(`data-group="${id}"`)[1].split('</section>')[0];
        assert.match(section, /<div class="ra-row" hidden>/, `${id}: falta la fila resumen`);
        assert.match(section, /data-row-value/, `${id}: falta el valor del resumen`);
        assert.match(section, new RegExp(`data-edit-group="${id}"`), `${id}: falta EDITAR`);
        assert.match(section, /<div class="ra-panel" hidden>/, `${id}: falta el panel`);
        assert.match(section, new RegExp(`data-continue="${id}"`), `${id}: falta CONTINUAR`);
    }
});

test('la nav superior lista los 7 grupos y no muestra contador de pasos', () => {
    const navGroups = [...html.matchAll(/data-nav-group="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(navGroups, GROUPS);
    // El Figma no tiene "PASO 01 · 11" ni botón INGRESÁ en el topbar.
    assert.doesNotMatch(html, /PASO\s*0?1\s*·/i);
    assert.doesNotMatch(html, /ra-progress-copy/);
});

test('la cabecera usa los textos exactos del Figma', () => {
    assert.match(html, /Registro de artistas/i);
    assert.match(html, /Armemos tu perfil\./);
    assert.match(
        html,
        /Todo en una sola página — completá cada grupo y avanzá\. Podés volver a editar cualquiera antes de confirmar\./
    );
});

test('cada grupo tiene el título y los campos que muestra el Figma', () => {
    // 01 · Quién sos — nombre artístico + nombre real + fecha de nacimiento
    assert.match(html, /01 · Quién sos/);
    assert.match(html, /Tu nombre, real y artístico\./);
    assert.match(html, /id="artistic_name"[^>]*placeholder="Como te conocen tus clientes"/);
    assert.match(html, /id="full_name"[^>]*placeholder="Tu nombre completo"/);
    assert.match(html, /id="birth_date"[^>]*type="date"|type="date" id="birth_date"/);
    // 02 · Tu acceso
    assert.match(html, /02 · Tu acceso/);
    assert.match(html, /Email y contraseña\./);
    assert.match(html, /id="email"/);
    assert.match(html, /id="signup_password"/);
    assert.match(html, /id="signup_password_confirm"/);
    // 03 · Tu oficio
    assert.match(html, /03 · Tu oficio/);
    assert.match(html, /¿Qué estilos trabajás\?/);
    assert.match(html, /Elegí todos los que representen tu trabajo\./);
    assert.match(html, /¿Hace cuánto tatuás\?/);
    assert.match(html, /id="session_price"/);
    assert.match(html, /id="session_currency"/);
    // 04 · Tu presencia
    assert.match(html, /04 · Tu presencia/);
    assert.match(html, /Contanos quién sos\./);
    assert.match(html, /¿Dónde mostrás tu trabajo\?/);
    assert.match(html, /id="instagram_handle"/);
    assert.match(html, /id="portfolio_url"/);
    // 05 · Cómo trabajás
    assert.match(html, /05 · Cómo trabajás/);
    assert.match(html, /¿Estudio o independiente\?/);
    assert.match(html, /id="address_search"/);
    // 06 · Novedades (eyebrow "Mantenete al tanto") — 4 temas del Figma
    assert.match(html, /06 · Mantenete al tanto/);
    assert.match(html, /¿Qué querés recibir\?/);
    for (const topic of ['oportunidades', 'herramientas', 'avisos', 'recursos']) {
        assert.match(html, new RegExp(`data-topic="${topic}"`), `falta el tema ${topic}`);
    }
    // 07 · Revisión
    assert.match(html, /07 · Revisá y confirmá/);
    assert.match(html, /Revisá tus datos\./);
    assert.match(html, /id="terms-checkbox"/);
    assert.match(html, /Confirmar y crear perfil/);
});

test('existen las pantallas de guardado y de éxito del Figma', () => {
    assert.match(html, /id="ra-saving"[^>]*hidden/);
    assert.match(html, /id="ra-success"[^>]*hidden/);
    assert.match(html, /Organizando tu agenda/i);
});

// ------------------------------------------------------------- diseño viejo

test('no quedan restos visibles del wizard paso-a-paso anterior', () => {
    for (const stale of [
        /class="form-step/,
        /wo-step\d/,
        /data-step="\d/,
        /presioná/i,
        /Usuario We Ötzi:/,
    ]) {
        assert.doesNotMatch(html, stale, `resto del diseño viejo: ${stale}`);
    }
    // Los hooks que register.js todavía escribe (barra de progreso, navegación
    // vieja) pueden sobrevivir, pero solo dentro de contenedores ocultos.
    for (const legacy of ['ra-legacy-progress', 'ra-legacy']) {
        const idx = html.indexOf(`class="${legacy}"`);
        assert.notEqual(idx, -1, `falta el contenedor legacy ${legacy}`);
        const openTag = html.slice(idx, html.indexOf('>', idx));
        assert.match(openTag, /hidden/, `${legacy} debe estar oculto`);
    }
});

// ------------------------------------------------------------- comportamiento

test('register.js define los 7 grupos y controla el gate de cada uno', () => {
    assert.match(registerJs, /const REGISTRATION_GROUPS\s*=/);
    for (const id of GROUPS) {
        assert.match(registerJs, new RegExp(`id:\\s*'${id}'`), `register.js no define el grupo ${id}`);
    }
    // CONTINUAR arranca deshabilitado y se habilita al validar el grupo.
    assert.match(registerJs, /function refreshGroupGate/);
    assert.match(html, /data-continue="quien"[^>]*disabled/);
    // Colapso con valor y reapertura por EDITAR.
    assert.match(registerJs, /function groupSummaryValue/);
    assert.match(registerJs, /data-edit-group|\[data-edit-group\]/);
});

test('el borrador se sigue guardando y restaurando', () => {
    assert.match(registerJs, /REGISTRATION_DRAFT|weotzi_artist_registration_draft|saveDraft/i);
    assert.match(registerJs, /subscribed_newsletter/);
});

test('la creación de cuenta y el envío final siguen intactos', () => {
    assert.match(registerJs, /supabase|_supabase/i);
    assert.match(registerJs, /terms-checkbox/);
});

// ------------------------------------------------------------- CSS / tokens

test('el atributo [hidden] gana sobre el display propio del acordeón', () => {
    // Regresión: `.ra-group{display:block}` pisaba el [hidden] del user-agent y
    // se veían todos los grupos a la vez (y el bloque de Instagram oculto).
    assert.match(dsCss, /\.ra-group\[hidden\][^{]*\{[^}]*display:\s*none/);
    assert.match(dsCss, /\.ra-row\[hidden\]|\.ra-panel\[hidden\]/);
});

test('el CSS del registro usa solo tokens del design system', () => {
    const withoutDataUris = dsCss.replace(/url\((["']?)data:[^)]*\1\)/g, '');
    const hexes = withoutDataUris.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    assert.deepEqual(hexes, [], `hex sueltos en register-artist-ds.css: ${hexes.join(', ')}`);
    assert.match(dsCss, /var\(--font-display\)/);
    assert.match(dsCss, /var\(--surface-page\)|var\(--neutral-100\)/);
});

test('el radio es 0 salvo las excepciones cerradas del sistema', () => {
    const radii = [...dsCss.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim());
    const allowed = new Set(['0', '2px', '999px', '50%', 'var(--radius-none)', 'var(--radius-sm)', 'var(--radius-pill)', 'var(--radius-circle)']);
    const offenders = radii.filter((r) => !allowed.has(r));
    assert.deepEqual(offenders, [], `border-radius fuera de la escala: ${offenders.join(', ')}`);
});

test('el acordeón es responsive en los breakpoints del sistema', () => {
    for (const width of [1024, 768, 480]) {
        const block = mediaBlock(width);
        assert.ok(block.length > 0, `bloque responsive vacío en ${width}px`);
    }
    // En mobile los campos de dos columnas se apilan.
    assert.match(mediaBlock(768) + mediaBlock(480), /\.ra-fields--2col\{[^}]*grid-template-columns:\s*1fr/);
});
