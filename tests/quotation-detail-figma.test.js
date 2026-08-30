const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const html = read('public', 'my-quotations', 'detail', 'index.html');
const js = read('public', 'shared', 'js', 'quotation-detail-figma.js');
const css = read('public', 'shared', 'css', 'quotation-detail-figma.css');
const listJs = read('public', 'shared', 'js', 'quotations.js');
const repo = read('public', 'shared', 'js', 'data', 'quotations-repo.js');

test('quotation detail reproduces the Figma command bar and complete dossier', () => {
    for (const id of [
        'qd-reference', 'qd-status', 'qd-accept', 'qd-reject',
        'qd-schedule', 'qd-contact', 'quotation-detail-root'
    ]) {
        assert.match(html, new RegExp(`id=["']${id}["']`));
    }
    for (const literal of [
        'Volver al listado', 'Aceptar', 'Rechazar', 'Agendar', 'Contactar cliente',
        'La propuesta', 'Tu evaluación', 'Timeline de la cotización',
        'Historial de cambios', 'Mensajes con el cliente'
    ]) {
        assert.match(html + js, new RegExp(literal, 'i'));
    }
});

test('quotation cards navigate to the durable full-page detail route', () => {
    assert.match(listJs, /\/my-quotations\/detail\?quote=/);
    assert.doesNotMatch(listJs, /class="q-card-cta" onclick="inspectQuote/);
});

test('detail loads persisted status history and supports all Figma actions', () => {
    assert.match(repo, /const StatusHistory =/);
    assert.match(repo, /from\('quotation_status_history'\)/);
    assert.match(js, /StatusHistory\.listForQuotation/);
    assert.match(js, /quote_status: 'responded'/);
    assert.match(js, /quote_status: 'in_progress'/);
    assert.match(js, /quote_status: nextStatus/);
    assert.match(js, /Chat\.sendMessage/);
    assert.match(js, /\/calendar\?quote=/);
    assert.match(js, /\/artist\/inbox\?quote=/);
});

test('detail changes disposition at desktop, tablet and mobile without horizontal overflow', () => {
    assert.match(css, /overflow-x:\s*clip/);
    assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
    assert.match(css, /@media \(max-width: 1100px\)/);
    assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.qd-dossier\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
    assert.match(css, /@media \(max-width: 480px\)[\s\S]*\.qd-reference-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
});
