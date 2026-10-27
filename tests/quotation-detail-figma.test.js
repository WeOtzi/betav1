const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const html = read('public', 'my-quotations', 'detail', 'index.html');
const js = read('public', 'shared', 'js', 'quotation-detail-figma.js');
const css = read('public', 'shared', 'css', 'quotation-detail-figma.css');
const listJs = read('public', 'shared', 'js', 'quotations.js');
const repo = read('public', 'shared', 'js', 'data', 'quotations-repo.js');

function timelineFor(quote, history = []) {
    const context = {
        window: {},
        document: { getElementById: () => null, addEventListener: () => {} },
    };
    vm.runInNewContext(js.replace(/}\(\)\);\s*$/, 'window.timelineForTest = (quote, history) => { state.quote = quote; state.history = history; return timelineModel(); }; }());'), context);
    return JSON.parse(JSON.stringify(context.window.timelineForTest(quote, history)));
}

test('timeline dates use the compact day and month shown beside the milestones', () => {
    const context = { window: {}, document: { getElementById: () => null, addEventListener: () => {} } };
    vm.runInNewContext(js.replace(/}\(\)\);\s*$/, 'window.timelineDateForTest = timelineDate; }());'), context);
    assert.equal(context.window.timelineDateForTest('2026-10-20T12:00:00Z'), '20 OCT');
    assert.equal(context.window.timelineDateForTest(null), '—');
});

test('timeline follows the six quotation states with only the active state highlighted', () => {
    const labels = ['Pendiente', 'Respondida', 'Aprobada', 'En progreso', 'Lista para cliente', 'Completada'];
    const statuses = ['pending', 'responded', 'client_approved', 'in_progress', 'artist_completed', 'completed'];
    for (const [index, status] of statuses.entries()) {
        const steps = timelineFor({ quote_status: status, created_at: '2026-09-24T12:00:00Z', updated_at: '2026-09-25T12:00:00Z' });
        assert.deepEqual(steps.map((step) => step.label), labels);
        assert.deepEqual(steps.map((step) => step.current), labels.map((_, stepIndex) => stepIndex === index));
        assert.deepEqual(steps.map((step) => step.complete), labels.map((_, stepIndex) => stepIndex < index));
    }
});

test('timeline leaves rejection outside the six positive stages', () => {
    for (const [status, completedStages] of [['cancelled', 1], ['client_rejected', 2], ['expired', 1]]) {
        const steps = timelineFor({ quote_status: status, created_at: '2026-09-24T12:00:00Z' });
        assert.equal(steps.length, 6);
        assert.equal(steps.some((step) => step.current), false);
        assert.equal(steps.filter((step) => step.complete).length, completedStages);
    }
});

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
