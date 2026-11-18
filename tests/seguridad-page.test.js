'use strict';
// 2.7.0 · Identidad, suplantación y plagio (T5): página pública /seguridad y
// textos legales Términos v1.1 + Privacidad v1.2 (código 2026-11-18).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const LEGAL_CODE = '2026-11-18';
const PAGES = {
    seguridad: 'public/seguridad/index.html',
    terms: 'public/legal/terms/index.html',
    privacy: 'public/legal/privacy/index.html'
};

// Voseo rioplatense que no puede aparecer en el producto (regla 10 del DS).
const VOSEO = /(?<!\p{L})(podés|querés|tenés|sabés|escribí|elegí|subí|contá|hacé|mirá|fijate|acordate|decí|poné|vení|ingresá|probá|cargá|tocá|revisá|aceptá|confirmá|denunciá|registrate|vos)(?!\p{L})/iu;
// «seña» como palabra (no «señal», «diseña» ni «contraseña»).
const SENA = /(?<!\p{L})señas?(?!\p{L})/iu;

function anchorsResolve(html, label) {
    const ids = [...html.matchAll(/href="#([a-z0-9-]+)"/g)].map((m) => m[1]);
    assert.ok(ids.length > 0, `${label}: tiene enlaces internos`);
    for (const id of ids) assert.ok(html.includes(`id="${id}"`), `${label}: falta #${id}`);
}

test('/seguridad existe, con título, h1, DS y enlaces a Términos, Privacidad y el buscador', () => {
    const html = read(PAGES.seguridad);
    assert.match(html, /<html lang="es">/);
    assert.match(html, /<title>We Ötzi · Suplantación y plagio<\/title>/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1\.0">/);
    assert.match(html, /<meta name="description" content="[^"]{40,}">/);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'un solo h1');
    assert.match(html, /<h1 class="sg-title" id="sg-titulo">Suplantación y plagio<\/h1>/);
    assert.match(html, /href="\/shared\/css\/ds\/tokens\.css"/);
    assert.match(html, /href="\/shared\/css\/ds\/components\.css"/);
    assert.match(html, /href="\/shared\/css\/seguridad\.css\?v=[^"]+"/);
    assert.match(html, /<script src="\/shared\/js\/wo-consent\.js" defer><\/script>/);
    assert.match(html, /data-wo-cookie-settings/);
    assert.match(html, /<body class="wo-app sg-page">/);
    assert.match(html, /href="\/legal\/terms(#[a-z-]+)?"/);
    assert.match(html, /href="\/legal\/privacy(#[a-z-]+)?"/);
    assert.match(html, /href="\/buscar-diseno"/);
    assert.match(html, /href="mailto:artistas@weotzi\.com"/);
    assert.match(html, /class="sg-skip" href="#contenido"/);
    anchorsResolve(html, 'seguridad');
    // Sin framework: como mucho un script inline chico (prefijo /beta).
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(inline.length <= 1 && inline.every((js) => js.length < 1200), 'JS inline mínimo');
    assert.doesNotMatch(html, /<script src="https?:/, 'sin librerías externas');
});

test('/seguridad cubre suplantación, plagio, insignia, denuncias, proceso, sanciones, buscador y mala fe', () => {
    const html = read(PAGES.seguridad);
    for (const id of ['suplantacion', 'plagio', 'insignia', 'denunciar', 'despues', 'sanciones', 'buscador', 'mala-fe', 'ayuda']) {
        assert.match(html, new RegExp(`<section class="sg-section[^"]*" id="${id}" aria-labelledby="h-${id}">`), `sección #${id}`);
        assert.match(html, new RegExp(`<h2 class="sg-h2" id="h-${id}">`), `título accesible de #${id}`);
    }
    const must = [
        'una sola cuenta de artista',
        'Es plagio', 'No es plagio', 'Que dos diseños se parezcan no prueba un plagio',
        'Documentos aprobados', 'Instagram validado con el código', 'la insignia se oculta hasta que valides el nuevo',
        'Cualquier persona con cuenta puede denunciar', 'Toca «Denunciar»', '«Soy la persona suplantada»',
        'cada trabajo del portafolio',
        '5 días hábiles', 'dos personas de soporte', 'una sola vez, dentro de 30 días', 'no intervino',
        'Advertencia', 'Suspensión', 'Cierre permanente', 'se bloquea para volver a registrarse',
        'cierre permanente de la cuenta', 'huellas cifradas',
        'Las cotizaciones abiertas se cancelan', 'quedan retenidos', 'Los retiros quedan bloqueados',
        'Todavía no encuentra', 'Tu foto no se guarda', 'salvo que hagas una denuncia',
        'también se sanciona'
    ];
    for (const text of must) assert.ok(html.includes(text), `/seguridad dice «${text}»`);
});

test('seguridad.css usa solo tokens del DS y funciona a 375px', () => {
    const css = read('public/shared/css/seguridad.css');
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'sin colores hex sueltos');
    assert.doesNotMatch(css, /rgba?\(/, 'sin colores rgb sueltos');
    assert.doesNotMatch(css, /border-radius:(?!\s*var\()/, 'radius solo por token');
    assert.doesNotMatch(css, /box-shadow:\s*0 \d/, 'sin sombras en reposo');
    assert.doesNotMatch(css, /linear-gradient|backdrop-filter|blur\(/, 'sin gradientes ni blur');
    assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/, 'una columna por defecto (móvil)');
    assert.match(css, /@media \(min-width: 768px\)/, 'más columnas desde tablet');
    assert.match(css, /overflow-wrap: anywhere/, 'textos largos no desbordan a 375px');
});

test('Términos v1.1 y Privacidad v1.2 muestran el código 2026-11-18 y su historial', () => {
    const { TERMS_VERSION } = require('../lib/terms-acceptance');
    assert.equal(TERMS_VERSION, LEGAL_CODE, 'contrato: el código que se guarda al aceptar');
    const terms = read(PAGES.terms);
    assert.ok(terms.includes(`<dt>Versión</dt><dd>1.1 (<code>${LEGAL_CODE}</code>)</dd>`));
    assert.ok(terms.includes(`<time datetime="${LEGAL_CODE}">18 de noviembre de 2026</time>`));
    assert.match(terms, /Términos v1\.1 · 18\/11\/2026/);
    assert.match(terms, /<h3>Historial de versiones<\/h3>/);
    assert.match(terms, /<strong>Versión 1\.1 \(18 de noviembre de 2026, código <code>2026-11-18<\/code>\)\.<\/strong>/);
    assert.match(terms, /<strong>Versión 1\.0 \(13 de noviembre de 2026\)\.<\/strong>/);
    // Tabla de códigos: quien aceptó una versión anterior puede ver qué par de textos aceptó.
    for (const code of ['2026-11-18', '2026-11-16', '2026-11-13']) {
        assert.ok(terms.includes(`<th scope="row"><code>${code}</code></th>`), `código ${code} en la tabla`);
    }
    const privacy = read(PAGES.privacy);
    assert.ok(privacy.includes(`<dt>Versión</dt><dd>1.2 (<code>${LEGAL_CODE}</code>)</dd>`));
    assert.ok(privacy.includes(`<time datetime="${LEGAL_CODE}">18 de noviembre de 2026</time>`));
    assert.match(privacy, /Privacidad v1\.2 · 18\/11\/2026/);
    assert.match(privacy, /<strong>Versión 1\.2 \(18 de noviembre de 2026, código <code>2026-11-18<\/code>\)\.<\/strong>/);
    assert.match(privacy, /<strong>Versión 1\.1 \(16 de noviembre de 2026\)\.<\/strong>/, 'se conserva la entrada anterior');
    assert.match(privacy, /la versión vigente es la 1\.2\./);
});

test('Términos v1.1: identidad, obra, denuncias, sanciones, efectos del cierre, apelación, mala fe y re-aceptación', () => {
    const terms = read(PAGES.terms);
    for (const id of ['identidad', 'obra', 'denuncias', 'sanciones', 'efectos-cierre', 'apelacion', 'mala-fe', 'baja']) {
        assert.match(terms, new RegExp(`<li><a href="#${id}">`), `índice → #${id}`);
        assert.match(terms, new RegExp(`<h2 id="${id}">\\d+\\. `), `sección #${id}`);
    }
    const must = [
        // identidad
        'cada persona puede tener una sola cuenta de artista', 'tienen que ser verdaderos y tuyos', 'no puedes hacerte pasar por otra persona, artista o estudio',
        // obra
        'solo puedes publicar trabajos que hiciste tú, o trabajos de otra persona si tienes el permiso de su autor', 'El plagio de diseños está prohibido',
        // denuncias
        'cualquier usuario con cuenta', 'Cómo evalúa soporte', '<strong>5 días hábiles</strong>',
        // sanciones
        '<strong>Advertencia:</strong>', '<strong>Suspensión:</strong>', '<strong>Cierre permanente:</strong>',
        'La suplantación de identidad se sanciona con el cierre permanente de la cuenta y el bloqueo para volver a registrarse.',
        'decisiones de cierre permanente las confirman dos personas de soporte',
        // efectos del cierre
        '<strong>Perfil oculto:</strong>', '<strong>Cotizaciones abiertas canceladas:</strong>', '<strong>Anticipos retenidos:</strong>',
        'soporte gestiona la devolución', '<strong>Retiros bloqueados:</strong>',
        // apelación
        '<strong>una sola vez</strong>', '<strong>30 días</strong>', '<strong>no intervino</strong>',
        // mala fe
        '<strong>se sanciona</strong>',
        // re-aceptación
        'Para seguir usando tu cuenta tienes que aceptar la versión vigente.'
    ];
    for (const text of must) assert.ok(terms.includes(text), `Términos dicen «${text}»`);
    assert.match(terms, /href="\/seguridad"/, 'enlaza la página de seguridad');
    assert.doesNotMatch(terms, /de por vida|para siempre/i, 'sin promesas técnicas de «de por vida»');
});

test('Privacidad v1.2: huellas de cuentas sancionadas, denuncias, huellas de imágenes y buscador', () => {
    const privacy = read(PAGES.privacy);
    assert.match(privacy, /<li><a href="#suplantacion-plagio">/);
    assert.match(privacy, /<h2 id="suplantacion-plagio">11\. Denuncias, sanciones y huellas de imágenes<\/h2>/);
    for (const row of ['Denuncias', 'Sanciones', 'Huellas de imágenes']) {
        assert.match(privacy, new RegExp(`<tr><th scope="row">${row}</th>`), `fila «${row}» en Qué datos tratamos`);
    }
    const must = [
        // cuentas sancionadas
        '<strong>huellas cifradas</strong>', 'HMAC-SHA256', 'clave secreta que vive solo en nuestro servidor', '<strong>no esos datos en claro</strong>',
        'Es irreversible', 'impedir el reingreso', 'se conservan mientras dure la sanción',
        // denuncias
        '<strong>expediente</strong>', '<strong>evidencia</strong>', '<strong>Solo accede el equipo de soporte</strong>',
        // imágenes
        '<strong>hash perceptual</strong>', '<strong>fecha de primera publicación</strong>', '<strong>conservamos su huella y su fecha, sin la imagen</strong>', 'prueba de antigüedad',
        // buscador
        '<strong>se procesa en memoria</strong>', '<strong>no la guardamos, salvo que hagas una denuncia</strong>',
        // base legal / finalidad
        'interés legítimo', '<strong>Prevenir la suplantación y el plagio</strong>'
    ];
    for (const text of must) assert.ok(privacy.includes(text), `Privacidad dice «${text}»`);
    // Lo que ya pedían otras pruebas sigue en pie.
    assert.match(privacy, /id="baja-de-cuenta"/);
    assert.match(privacy, /<h2 id="cookies">/);
    assert.doesNotMatch(privacy, /de por vida|para siempre/i);
});

test('índices anclados y enlaces internos válidos en las tres páginas', () => {
    for (const [label, file] of Object.entries(PAGES)) anchorsResolve(read(file), label);
});

test('copy: sin voseo, sin «seña» y sin promesas de «de por vida»', () => {
    for (const [label, file] of Object.entries(PAGES)) {
        const html = read(file);
        const vos = html.match(VOSEO);
        assert.equal(vos, null, `${label}: voseo «${vos && vos[0]}»`);
        const sena = html.match(SENA);
        assert.equal(sena, null, `${label}: usa «anticipo», no «${sena && sena[0]}»`);
    }
    assert.doesNotMatch(read(PAGES.seguridad), /de por vida|para siempre/i);
    // Las expresiones de control detectan lo que tienen que detectar.
    assert.match('Si querés, escribí a soporte', VOSEO);
    assert.match('Pagá la seña', SENA);
    assert.doesNotMatch('Global Privacy Control envía una señal; tu contraseña; el artista diseña', SENA);
});
