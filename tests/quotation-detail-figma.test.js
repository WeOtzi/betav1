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
    // El listado (área cotizaciones) usa la ruta canónica ?id=; el detalle
    // acepta además el alias legacy ?quote= (links viejos, emails, tour).
    const listVm = read('public', 'shared', 'js', 'quotations-view-model.js');
    assert.match(listJs + listVm, /\/my-quotations\/detail\?(id|quote)=/);
    assert.doesNotMatch(listJs, /class="q-card-cta" onclick="inspectQuote/);
    assert.match(js, /params\.get\('id'\) \|\| params\.get\('quote'\)/);
});

test('detail loads persisted status history and supports all Figma actions', () => {
    assert.match(repo, /const StatusHistory =/);
    assert.match(repo, /from\('quotation_status_history'\)/);
    assert.match(js, /StatusHistory\.listForQuotation/);
    assert.match(js, /quote_status: 'responded'/);
    assert.match(js, /quote_status: 'in_progress'/);
    assert.match(js, /quote_status: 'cancelled'/);
    assert.match(js, /quote_status\s*[:=]\s*'client_approved'/);
    assert.match(js, /quote_status: 'artist_completed'/);
    assert.match(js, /Chat\.sendMessage/);
    // Figma: flechas del detalle al Calendario (?date=) y al Inbox (?quote=).
    assert.match(js, /\/calendar\?date=/);
    assert.match(js, /\/artist\/inbox\?quote=/);
});

test('detail changes disposition at desktop, tablet and mobile without horizontal overflow', () => {
    assert.match(css, /overflow-x:\s*clip/);
    assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
    assert.match(css, /@media \(max-width: 1100px\)/);
    assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.qd-dossier\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
    assert.match(css, /@media \(max-width: 480px\)[\s\S]*\.qd-reference-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
});
