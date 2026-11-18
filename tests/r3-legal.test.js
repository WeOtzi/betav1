'use strict';
// Ronda 3: los links legales del footer y del registro apuntan a páginas que
// existen, y el mapa de Invitaciones usa la geografía vendorizada.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('las rutas /legal/terms y /legal/privacy existen como páginas', () => {
    for (const slug of ['terms', 'privacy']) {
        const html = read(`public/legal/${slug}/index.html`);
        assert.match(html, /<html lang="es">/);
        assert.match(html, /\/shared\/css\/legal-ds\.css/);
        assert.match(html, /href="\/legal\/terms"/);
        assert.match(html, /href="\/legal\/privacy"/);
    }
});

test('el footer de artista y el registro enlazan a las páginas legales', () => {
    const organisms = read('public/shared/js/ds/organisms.js');
    assert.match(organisms, /href="\/legal\/terms"/);
    assert.match(organisms, /href="\/legal\/privacy"/);
});

test('el mapa de Invitaciones carga Natural Earth 1:110m vendorizado', () => {
    const html = read('public/artist/invitations/index.html');
    assert.match(html, /id="ism-stage" data-geography="\/shared\/geo\/countries-110m\.json"/);
    const topo = JSON.parse(read('public/shared/geo/countries-110m.json'));
    assert.equal(topo.type, 'Topology');
    assert.ok(topo.objects.countries && topo.objects.land);
    assert.ok(fs.existsSync(path.join(root, 'public/shared/geo/LICENSE-world-atlas.txt')));
});

test('términos v1.1 y privacidad v1.2: aviso de revisión, versión, índice anclado y marcadores', () => {
    const { TERMS_VERSION } = require('../lib/terms-acceptance');
    // Un solo código para el par de textos: la fecha del último que cambió.
    // 2.7.0 (18 nov 2026): cambian los dos textos a la vez (suplantación, plagio y sanciones).
    assert.equal(TERMS_VERSION, '2026-11-18');
    const OWN = { terms: { label: '1.1', date: '2026-11-18' }, privacy: { label: '1.2', date: '2026-11-18' } };
    for (const slug of ['terms', 'privacy']) {
        const html = read(`public/legal/${slug}/index.html`);
        const own = OWN[slug];
        assert.ok(html.includes(`Versión ${own.label} · pendiente de revisión legal`), `${slug}: aviso de revisión con su versión`);
        assert.ok(html.includes(`<dt>Versión</dt><dd>${own.label} (<code>${own.date}</code>)</dd>`), `${slug}: versión propia`);
        assert.ok(html.includes(`<code>${TERMS_VERSION}</code>`), `${slug}: muestra el código que se guarda al aceptar (${TERMS_VERSION})`);
        assert.ok(html.includes(`<time datetime="${own.date}">`), `${slug}: fecha de vigencia propia`);
        assert.match(html, /class="legal-toc"/);
        // Cada link del índice apunta a un id que existe en la página.
        const anchors = [...html.matchAll(/<li><a href="#([a-z0-9-]+)">/g)].map((m) => m[1]);
        assert.ok(anchors.length >= 10, `${slug}: índice con secciones`);
        for (const id of anchors) assert.ok(html.includes(`id="${id}"`), `${slug}: falta #${id}`);
        // Datos societarios como marcadores visibles, nunca inventados.
        assert.match(html, /\[A COMPLETAR: razón social\]/);
        assert.match(html, /mailto:artistas@weotzi\.com/);
    }
    const privacy = read('public/legal/privacy/index.html');
    assert.match(privacy, /href="https:\/\/weotzi\.com\/privacy-policy\/"/);
    // 1.1: la fila de OpenAI declara el asistente del chat de soporte y la sección de cambios lo registra
    // (se conserva en 1.2; la entrada 1.2 se prueba en tests/seguridad-page.test.js).
    assert.match(privacy, /<th scope="row">OpenAI<\/th><td>[^<]*Asistente automático del chat de soporte, solo cuando escribes en ese chat\.<\/td>/);
    assert.match(privacy, /En el chat de soporte: los mensajes que escribes ahí, tu nombre de perfil, tu tipo de cuenta, la página en la que estás/);
    assert.match(privacy, /<strong>Versión 1\.1 \(16 de noviembre de 2026\)\.<\/strong> Sumamos a los usos de OpenAI el asistente automático del chat de soporte/);
    assert.match(privacy, /Privacidad v1\.2 · 18\/11\/2026/);
    const terms = read('public/legal/terms/index.html');
    assert.match(terms, /Términos v1\.1 · 18\/11\/2026/);
    // El aviso dentro de la plataforma que promete la sección «Cambios en esta política».
    const updates = JSON.parse(read('public/shared/platform-updates.json'));
    const notice = updates.find((u) => u.id === '2026-11-privacidad-1-1');
    assert.ok(notice && /Política de privacidad/.test(notice.title) && /1\.1/.test(notice.body), 'aviso de la versión 1.1 en las novedades');
});
