'use strict';

// Español neutro · el pago para reservar se llama "anticipo". La palabra
// anterior ("seña") solo queda donde hace falta para no romper nada guardado
// ni dejar a nadie sin respuesta:
//   - como alias de la variable {{anticipo}} de las respuestas rápidas
//     (cubierto en r2-cot-respuesta*.test.js);
//   - como palabra de búsqueda de la FAQ de soporte;
// y nunca como etiqueta visible (fila "Anticipo" del correo de acuerdo).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const SENA = /\bse[ñn]as?\b/i;

test('FAQ de soporte: "anticipo" es palabra de búsqueda y "seña" se conserva', () => {
    const faq = JSON.parse(read('public/shared/js/support-faq.json'));
    const pagos = faq.find((item) => item.question === '¿Cómo funcionan los pagos?');
    assert.ok(pagos, 'la respuesta sobre pagos existe');
    assert.ok(pagos.tags.includes('anticipo'), 'tag nuevo');
    assert.ok(pagos.tags.includes('seña'), 'quien busca la palabra anterior también llega');
    assert.ok(pagos.tags.indexOf('anticipo') < pagos.tags.indexOf('seña'), 'la palabra canónica va primero');

    // Misma búsqueda que la herramienta get_faq del chat de soporte (server.js).
    const search = (topic) => faq.filter((item) => [item.question, item.answer, ...(item.tags || [])].join(' ').toLowerCase().includes(topic.toLowerCase()));
    assert.ok(search('anticipo').includes(pagos));
    assert.ok(search('seña').includes(pagos));
    assert.ok(search('Seña').includes(pagos));

    // Lo que se le lee al usuario (pregunta y respuesta) ya no nombra la seña.
    for (const item of faq) {
        assert.doesNotMatch(item.question + ' ' + item.answer, SENA, item.question);
    }
});

test('correo de acuerdo: la fila de deposit_text se titula "Anticipo" en el generador y en lo generado', () => {
    const { buildEmailHtml, minify, manifest } = require('../scripts/redesign-email-templates.js');
    const name = 'quotation-agreement-client';
    assert.ok(manifest[name].variables.includes('deposit_text'), 'la variable del payload no cambia de nombre');

    // Etiqueta de la fila + su valor, en la tabla de datos del correo.
    const row = />Anticipo<\/p>\s*<\/td>\s*<td[^>]*>\s*<p[^>]*>\{\{deposit_text\}\}<\/p>/;
    const html = buildEmailHtml(name, { mode: 'local' });
    const sources = {
        'generador': html,
        'generador (min)': minify(html),
        // Regenerar no revierte lo versionado: las plantillas dicen lo mismo.
        [`templates/email/${name}.html`]: read(`templates/email/${name}.html`),
        [`templates/email/${name}.min.html`]: read(`templates/email/${name}.min.html`),
        [`templates/email/billionmail/${name}.html`]: read(`templates/email/billionmail/${name}.html`),
    };
    for (const [where, text] of Object.entries(sources)) {
        assert.match(text, row, `${where}: la fila se titula Anticipo`);
        assert.doesNotMatch(text, SENA, `${where}: sin "Seña"`);
    }
});
