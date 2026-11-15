'use strict';
// Ronda 2 · frente "negociacion": modelo compartido, HTML del panel y
// contratos del front (P23 contrapropuesta del cliente · P25 cambios al
// acuerdo · P4-saldo "aprobada por ambas partes").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const M = require('../public/shared/js/quotation-negotiation.js');
const UI = require('../public/shared/js/client-quote-proposal.js');

const NOW = Date.parse('2026-11-16T12:00:00Z');
const CLIENT = '11111111-1111-4111-8111-111111111111';
const ARTIST = '22222222-2222-4222-8222-222222222222';
const quote = (over = {}) => ({
    id: 7, quote_id: 'WO-7', quote_status: 'responded', client_user_id: CLIENT, artist_id: ARTIST,
    client_full_name: 'Lucía Fernández', artist_name: 'Mateo Rivas',
    artist_budget_amount: '2000', artist_budget_currency: 'USD', tattoo_estimated_sessions: '3',
    tattoo_body_part: 'Antebrazo', tattoo_size: 'Mediano · 8 a 15 cm', tattoo_style: ['Realismo'],
    tattoo_color_type: 'Negro y gris', tattoo_idea_description: 'Un león realista mirando de frente.',
    quote_expires_at: null, dispute_status: 'none', agreement_approved_at: null, agreement_version: 0, ...over,
});
const agreed = (over = {}) => quote({
    quote_status: 'client_approved', final_budget_amount: '2000', final_budget_currency: 'USD', final_sessions: '3',
    agreement_approved_at: '2026-11-15T10:00:00Z', agreement_version: 1, ...over,
});
const proposal = (over = {}) => ({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', quotation_id: 7, kind: 'counter', proposed_by: 'client', status: 'pending',
    currency: 'USD', note: 'Me alcanza hasta 1800', response_note: '', created_at: '2026-11-16T09:00:00Z',
    changes: {
        artist_budget_amount: { from: '2000', to: '1800' },
        tattoo_size: { from: 'Mediano · 8 a 15 cm', to: 'Grande · 15 a 30 cm' },
    }, ...over,
});

// ---------------------------------------------------------------- permisos
test('P23: solo el cliente contrapropone, sobre una propuesta vigente y sin reclamo', () => {
    assert.deepEqual(M.can(quote(), 'client', NOW), { counter: true, amend: false, reason: '' });
    assert.equal(M.can(quote(), 'artist', NOW).counter, false);
    assert.equal(M.can(quote({ quote_expires_at: '2026-11-15T00:00:00Z' }), 'client', NOW).counter, false);
    assert.equal(M.can(quote({ dispute_status: 'open' }), 'client', NOW).counter, false);
    for (const status of ['pending', 'client_rejected', 'cancelled', 'expired', 'completed']) {
        const p = M.can(quote({ quote_status: status }), 'client', NOW);
        assert.equal(p.counter, false, status);
        assert.equal(p.amend, false, status);
    }
});

test('P25: cualquiera de las dos partes propone cambios, solo con el acuerdo aprobado por ambas', () => {
    for (const role of ['client', 'artist']) {
        for (const status of ['client_approved', 'in_progress', 'en_progreso', 'artist_completed']) {
            assert.equal(M.can(agreed({ quote_status: status }), role, NOW).amend, true, `${role} ${status}`);
        }
        assert.equal(M.can(agreed({ quote_status: 'completed' }), role, NOW).amend, false);
        assert.equal(M.can(agreed({ dispute_status: 'open' }), role, NOW).amend, false);
        assert.equal(M.can(agreed({ agreement_approved_at: null }), role, NOW).amend, false);
    }
    assert.equal(M.can(agreed(), null, NOW).amend, false);
    // Sin cuenta del cliente no hay quién apruebe: el artista edita el acuerdo como siempre.
    const guest = M.can(agreed({ client_user_id: null }), 'artist', NOW);
    assert.equal(guest.amend, false);
    assert.match(guest.reason, /todavía no tiene cuenta/);
    const html = M.panelHtml({ available: true, role: 'artist', quote_id: 'WO-7', quote_status: 'client_approved', names: {}, agreement: M.agreementOf(agreed()), can: { counter: false, amend: false }, reason: guest.reason, proposals: [], pending: null }, {});
    assert.match(html, /Acuerdo aprobado por ambas partes/);
    assert.match(html, /todavía no tiene cuenta en We Ötzi para aprobar cambios/);
    assert.doesNotMatch(html, /data-wqn-act="open-amend"/);
});

test('P4-saldo: "aprobada por ambas partes" sale de agreement_approved_at (y no de un borrador)', () => {
    assert.equal(M.isAgreed(agreed()), true);
    assert.equal(M.isAgreed(quote()), false);
    assert.equal(M.isAgreed(agreed({ quote_status: 'cancelled' })), false);
    assert.equal(M.isAgreed(agreed({ agreement_approved_at: null })), false);
    // Fila leída sin la columna (select viejo): se deduce del estado, salvo el borrador del cotizador.
    assert.equal(M.isAgreed({ quote_status: 'client_approved' }), true);
    assert.equal(M.isAgreed({ quote_status: 'in_progress' }), false);
    assert.equal(M.isAgreed({ quote_status: 'in_progress', final_budget_amount: '100' }), true);
    assert.deepEqual(M.agreementOf(agreed({ agreement_version: 3 })), { approved: true, approved_at: '2026-11-15T10:00:00Z', version: 3 });
    assert.deepEqual(M.agreementOf(quote()), { approved: false, approved_at: null, version: 0 });
});

test('rol del usuario en la cotización (y desempate de la autocotización)', () => {
    assert.equal(M.roleOf(quote(), CLIENT), 'client');
    assert.equal(M.roleOf(quote(), ARTIST), 'artist');
    assert.equal(M.roleOf(quote(), 'otro'), null);
    assert.equal(M.roleOf(quote({ artist_id: CLIENT }), CLIENT), 'client');
    assert.equal(M.roleOf(quote({ artist_id: CLIENT }), CLIENT, 'artist'), 'artist');
    assert.equal(M.roleOf(quote({ client_user_id: null }), null), null);
});

// ---------------------------------------------------------------- validación
test('contrapropuesta: se guarda solo lo que cambia, normalizado', () => {
    const current = M.currentValues('counter', quote());
    const out = M.normalizeChanges('counter', {
        artist_budget_amount: '1.800,00', tattoo_body_part: '  Antebrazo ', tattoo_size: 'Grande · 15 a 30 cm',
        tattoo_style: 'realismo', tattoo_color_type: 'Negro y gris', tattoo_idea_description: 'Un león realista mirando de frente.',
    }, current);
    assert.equal(out.ok, true);
    assert.deepEqual(out.changes, { artist_budget_amount: '1800', tattoo_size: 'Grande · 15 a 30 cm' });

    const styles = M.normalizeChanges('counter', { tattoo_style: ' Blackwork ,  fine line, blackwork ' }, current);
    assert.deepEqual(styles.changes, { tattoo_style: ['Blackwork', 'fine line'] });

    const same = M.normalizeChanges('counter', { artist_budget_amount: '2000', tattoo_size: 'Mediano · 8 a 15 cm' }, current);
    assert.deepEqual([same.ok, same.code], [false, 'no_changes']);
    assert.match(same.error, /Cambia al menos un dato/);
});

test('contrapropuesta: valores inválidos y campos ajenos se rechazan con el campo', () => {
    const current = M.currentValues('counter', quote());
    const cases = [
        [{ artist_budget_amount: '0' }, 'artist_budget_amount', /mayor a cero/],
        [{ artist_budget_amount: 'gratis' }, 'artist_budget_amount', /mayor a cero/],
        [{ tattoo_idea_description: 'corta' }, 'tattoo_idea_description', /al menos 10/],
        [{ tattoo_style: 'a, b, c, d' }, 'tattoo_style', /hasta 3 estilos/],
        [{ tattoo_style: '' }, 'tattoo_style', /al menos un estilo/],
        [{ tattoo_color_type: 'x'.repeat(51) }, 'tattoo_color_type', /color/],
        [{ tattoo_body_part: '' }, 'tattoo_body_part', /zona del cuerpo/],
        [{ quote_status: 'completed' }, 'quote_status', /no se puede cambiar/],
        [{ final_budget_amount: '10' }, 'final_budget_amount', /no se puede cambiar/],
    ];
    for (const [input, field, re] of cases) {
        const out = M.normalizeChanges('counter', input, current);
        assert.equal(out.ok, false, JSON.stringify(input));
        assert.equal(out.field, field);
        assert.match(out.error, re);
    }
    assert.equal(M.normalizeChanges('otro', {}, current).ok, false);
    assert.equal(M.normalizeChanges('counter', null, current).ok, false);
});

test('enmienda: precio, sesiones, seña y condiciones; nunca por debajo de lo pagado o agendado', () => {
    const q = agreed({ artist_deposit_pct: 10, final_comment: 'Traer ropa cómoda' });
    const current = M.currentValues('amendment', q);
    assert.deepEqual(current, { final_budget_amount: '2000', final_sessions: '3', artist_deposit_pct: 10, final_comment: 'Traer ropa cómoda' });

    const out = M.normalizeChanges('amendment', { final_budget_amount: '2.500', final_sessions: '4', artist_deposit_pct: '20 %', final_comment: 'Traer ropa cómoda' }, current);
    assert.deepEqual(out.changes, { final_budget_amount: '2500', final_sessions: '4', artist_deposit_pct: 20 });

    assert.deepEqual(M.normalizeChanges('amendment', { artist_deposit_pct: '', final_comment: '' }, current).changes, { artist_deposit_pct: null, final_comment: null });

    const paid = M.normalizeChanges('amendment', { final_budget_amount: '400' }, current, { paid: 500, currency: 'USD' });
    assert.deepEqual([paid.ok, paid.code, paid.field], [false, 'below_paid', 'final_budget_amount']);
    assert.match(paid.error, /500 USD/);
    assert.equal(M.normalizeChanges('amendment', { final_budget_amount: '500' }, current, { paid: 500 }).ok, true);

    const sessions = M.normalizeChanges('amendment', { final_sessions: '1' }, current, { sessionsUsed: 2 });
    assert.deepEqual([sessions.ok, sessions.code], [false, 'below_sessions']);
    assert.match(sessions.error, /2 sesiones agendadas o realizadas/);
    for (const bad of ['0', '31', '2.5', 'dos']) assert.equal(M.normalizeChanges('amendment', { final_sessions: bad }, current).ok, false, bad);
    for (const bad of ['101', '-1', 'mucho']) assert.equal(M.normalizeChanges('amendment', { artist_deposit_pct: bad }, current).ok, false, bad);
    assert.equal(M.normalizeChanges('amendment', { final_comment: 'x'.repeat(601) }, current).ok, false);
    // La seña de la cotización manual es la vigente si quotations_db no tiene una propia.
    assert.equal(M.currentValues('amendment', agreed(), { manualDepositPct: 30 }).artist_deposit_pct, 30);
});

test('formulario: lo que estaba vacío y sigue vacío no es un cambio ni un error', () => {
    const current = M.currentValues('counter', quote({ tattoo_color_type: null, tattoo_size: '' }));
    const input = M.formInput({
        artist_budget_amount: '2000', tattoo_body_part: 'Antebrazo', tattoo_size: '', tattoo_style: 'Realismo',
        tattoo_color_type: '', tattoo_idea_description: 'Un león realista mirando de frente.',
    }, 'counter', current);
    assert.equal('tattoo_color_type' in input, false);
    assert.equal('tattoo_size' in input, false);
    assert.equal(M.normalizeChanges('counter', input, current).code, 'no_changes');
    // Vaciar un dato que tenía valor sí se valida.
    const cleared = M.formInput({ tattoo_body_part: '' }, 'counter', current);
    assert.equal(M.normalizeChanges('counter', cleared, current).field, 'tattoo_body_part');
    // En una enmienda, vaciar la seña o las condiciones es un cambio válido.
    const amend = M.formInput({ final_budget_amount: '', artist_deposit_pct: '', final_comment: '' }, 'amendment', { final_budget_amount: '', artist_deposit_pct: 10, final_comment: 'x' });
    assert.deepEqual(amend, { artist_deposit_pct: '', final_comment: '' });
});

test('estilos históricos (texto, lista, objeto, { styles }) se leen igual', () => {
    assert.deepEqual(M.styleNames('["Blackwork"]'), ['Blackwork']);
    assert.deepEqual(M.styleNames({ style_name: 'Realismo', substyle_name: null }), ['Realismo']);
    assert.deepEqual(M.styleNames({ styles: [{ style_name: 'Tradicional' }, { style_name: 'Neo-Tradicional' }] }), ['Tradicional', 'Neo-Tradicional']);
    assert.deepEqual(M.styleNames('"Realismo"'), ['Realismo']);
    assert.deepEqual(M.styleNames(null), []);
    assert.equal(M.styleText(['Realismo', 'Black & Grey']), 'Realismo, Black & Grey');
});

// ---------------------------------------------------------------- antes → después
test('antes → después en orden fijo, con montos, sesiones y seña legibles', () => {
    const rows = M.diffRows(proposal({
        kind: 'amendment',
        changes: {
            final_comment: { from: null, to: 'Incluye retoque' },
            artist_deposit_pct: { from: null, to: 20 },
            final_sessions: { from: '3', to: '1' },
            final_budget_amount: { from: '2000', to: '2500.5' },
        },
    }));
    assert.deepEqual(rows.map((r) => r.key), ['final_budget_amount', 'final_sessions', 'artist_deposit_pct', 'final_comment']);
    assert.deepEqual(rows.map((r) => [r.label, r.from, r.to]), [
        ['Precio total', '2.000 USD', '2.500,5 USD'],
        ['Sesiones', '3 sesiones', '1 sesión'],
        ['Seña', 'Sin seña', '20 %'],
        ['Condiciones', 'Sin condiciones', 'Incluye retoque'],
    ]);
    assert.equal(M.summaryLine(proposal()), 'Presupuesto: 2.000 USD → 1.800 USD · Tamaño: Mediano · 8 a 15 cm → Grande · 15 a 30 cm');
    assert.equal(M.displayValue('tattoo_style', { style_name: 'Realismo' }), 'Realismo');
    assert.deepEqual(M.diffRows(null), []);
});

test('resolución: aprueba o rechaza la contraparte, retira quien propuso, y es idempotente', () => {
    const q = quote();
    const ok = (role, action, p = proposal()) => M.evaluateResolve({ proposal: p, quotation: q, role, action });
    assert.equal(ok('artist', 'accept').ok, true);
    assert.equal(ok('artist', 'reject').ok, true);
    assert.equal(ok('client', 'withdraw').ok, true);
    assert.deepEqual([ok('client', 'accept').status, ok('client', 'accept').code], [403, 'own_proposal']);
    assert.deepEqual([ok('artist', 'withdraw').status, ok('artist', 'withdraw').code], [403, 'not_proposer']);
    assert.equal(ok(null, 'accept').status, 403);
    assert.equal(ok('artist', 'borrar').status, 400);
    assert.equal(ok('artist', 'accept', proposal({ quotation_id: 99 })).status, 404);
    assert.equal(ok('artist', 'accept', proposal({ status: 'accepted' })).already, true);
    assert.equal(ok('artist', 'accept', proposal({ status: 'superseded' })).status, 409);
    // Aceptar revalida el estado de la cotización.
    assert.equal(M.evaluateResolve({ proposal: proposal(), quotation: quote({ quote_status: 'expired' }), role: 'artist', action: 'accept' }).code, 'status');
    assert.equal(M.evaluateResolve({ proposal: proposal(), quotation: quote({ dispute_status: 'open' }), role: 'artist', action: 'accept' }).code, 'dispute');
    const amendment = proposal({ kind: 'amendment', proposed_by: 'artist' });
    assert.equal(M.evaluateResolve({ proposal: amendment, quotation: agreed(), role: 'client', action: 'accept' }).ok, true);
    assert.equal(M.evaluateResolve({ proposal: amendment, quotation: agreed({ quote_status: 'completed' }), role: 'client', action: 'accept' }).code, 'status');
    assert.equal(M.evaluateResolve({ proposal: amendment, quotation: agreed({ artist_id: null }), role: 'client', action: 'accept' }).code, 'status');
    // Rechazar o retirar no depende del estado.
    assert.equal(M.evaluateResolve({ proposal: amendment, quotation: agreed({ quote_status: 'completed' }), role: 'client', action: 'reject' }).ok, true);
});

// ---------------------------------------------------------------- panel
const state = (over = {}) => ({
    available: true, role: 'artist', quote_id: 'WO-7', quote_status: 'responded',
    names: { client: 'Lucía Fernández', artist: 'Mateo Rivas' },
    agreement: { approved: false, approved_at: null, version: 0 },
    can: { counter: false, amend: false },
    currency: { counter: 'USD', amendment: 'USD' },
    current: { counter: M.currentValues('counter', quote()), amendment: M.currentValues('amendment', agreed()) },
    limits: { paid: 0, sessions_used: 0 },
    pending: proposal(), proposals: [proposal()], ...over,
});

test('artista: panel "El cliente propone cambios" con el antes → después y las dos salidas', () => {
    const html = M.panelHtml(state(), {});
    assert.match(html, /El cliente propone cambios/);
    assert.match(html, /Lucía revisó tu propuesta/);
    assert.match(html, /<th scope="row">Presupuesto<\/th><td class="wqn-from" data-label="Antes">2\.000 USD<\/td><td class="wqn-to" data-label="Después">1\.800 USD<\/td>/);
    assert.match(html, /<th scope="row">Tamaño<\/th>/);
    assert.match(html, /Mensaje del cliente<\/span>Me alcanza hasta 1800/);
    assert.match(html, /data-wqn-act="accept">Aceptar cambios<\/button>/);
    assert.match(html, /data-wqn-act="requote">Hacer otra propuesta<\/button>/);
    assert.match(html, /queda aprobada por ambas partes/);
    assert.doesNotMatch(html, /data-wqn-act="withdraw"/);
    assert.doesNotMatch(html, /undefined|null|NaN/);

    const confirm = M.panelHtml(state(), { confirm: 'accept' });
    assert.match(confirm, /aprobada por ambas partes por 1\.800 USD/);
    assert.match(confirm, /data-wqn-act="confirm-accept"/);
    assert.match(confirm, /data-wqn-act="cancel-confirm"/);
    assert.doesNotMatch(confirm, /data-wqn-act="requote"/);
});

test('cliente: ve su contrapropuesta en espera y puede retirarla', () => {
    const html = M.panelHtml(state({ role: 'client', can: { counter: true, amend: false } }), {});
    assert.match(html, /Esperando la respuesta del artista/);
    assert.match(html, /data-wqn-act="withdraw">Retirar mis cambios<\/button>/);
    assert.doesNotMatch(html, /data-wqn-act="accept"|data-wqn-act="requote"/);
    assert.match(html, /Tu mensaje<\/span>/);
});

test('enmienda: la contraparte aprueba o rechaza; quien propuso espera; el acuerdo se identifica', () => {
    const pending = proposal({ kind: 'amendment', proposed_by: 'artist', note: 'Sumamos una sesión', changes: { final_sessions: { from: '3', to: '4' } } });
    const base = { quote_status: 'client_approved', agreement: { approved: true, approved_at: '2026-11-15T10:00:00Z', version: 2 }, can: { counter: false, amend: true }, pending, proposals: [pending] };
    const client = M.panelHtml(state({ role: 'client', ...base }), {});
    assert.match(client, /Tu artista propone cambiar el acuerdo/);
    assert.match(client, /El acuerdo actual sigue vigente hasta que los apruebes/);
    assert.match(client, /data-wqn-act="accept">Aprobar cambios<\/button>/);
    assert.match(client, /data-wqn-act="reject">Rechazar<\/button>/);
    assert.match(client, /Acuerdo aprobado por ambas partes · 15 de noviembre de 2026 · versión 2/);
    assert.match(client, /data-wqn-act="open-amend">Proponer otro cambio<\/button>/);

    const artist = M.panelHtml(state({ role: 'artist', ...base }), {});
    assert.match(artist, /Esperando la aprobación de tu cliente/);
    assert.match(artist, /data-wqn-act="withdraw">Retirar propuesta<\/button>/);
    assert.doesNotMatch(artist, /data-wqn-act="accept"/);

    const reject = M.panelHtml(state({ role: 'client', ...base }), { confirm: 'reject' });
    assert.match(reject, /El acuerdo queda como está/);
    assert.match(reject, /<label class="wo-label" for="wqn-reason-[^"]+">Motivo \(opcional\)<\/label>/);

    const idle = M.panelHtml(state({ role: 'client', ...base, pending: null, proposals: [] }), {});
    assert.match(idle, /Proponer un cambio al acuerdo/);
    assert.match(idle, /el cambio rige cuando la otra parte lo aprueba/);
});

test('formularios: cada dato pedido por el dueño tiene su campo con etiqueta', () => {
    const counter = M.panelHtml(state({ role: 'client', can: { counter: true, amend: false }, pending: null, proposals: [] }), { form: 'counter' });
    for (const [label, name] of [['Presupuesto \\(USD\\)', 'artist_budget_amount'], ['Zona del cuerpo', 'tattoo_body_part'], ['Tamaño', 'tattoo_size'], ['Estilo', 'tattoo_style'], ['Color', 'tattoo_color_type'], ['Descripción de la idea', 'tattoo_idea_description']]) {
        const m = new RegExp(`<label class="wo-label" for="([^"]+)">${label}</label>`).exec(counter);
        assert.ok(m, label);
        assert.match(counter, new RegExp(`id="${m[1]}" name="${name}"`), name);
    }
    assert.match(counter, /value="2000"/);
    assert.match(counter, /<option value="Mediano · 8 a 15 cm" selected>/);
    assert.match(counter, /Propuesta del artista: 2\.000 USD/);
    assert.match(counter, /<form class="wqn-form" data-wqn-form="counter" novalidate/);
    assert.match(counter, /type="submit"[^>]*>Enviar cambios<\/button>/);
    // Sin permiso, el formulario no se pinta.
    assert.doesNotMatch(M.panelHtml(state({ role: 'artist', pending: null, proposals: [] }), { form: 'counter' }), /data-wqn-form/);

    const amend = M.panelHtml(state({ role: 'artist', quote_status: 'in_progress', agreement: { approved: true, approved_at: null, version: 1 }, can: { counter: false, amend: true }, pending: null, proposals: [], limits: { paid: 500, sessions_used: 2 } }), { form: 'amendment' });
    for (const name of ['final_budget_amount', 'final_sessions', 'artist_deposit_pct', 'final_comment', 'note']) assert.match(amend, new RegExp(`name="${name}"`), name);
    assert.match(amend, /El cambio rige solo cuando tu cliente lo apruebe/);
    assert.match(amend, /Ya hay 500 USD registrados como pagados/);
    assert.match(amend, /min="2" max="30"/);
    assert.match(amend, /Ya hay 2 sesiones agendadas o realizadas\./);
});

test('historial y estados sin nada que mostrar', () => {
    const done = [proposal({ status: 'rejected', response_note: 'Prefiero mi propuesta' }), proposal({ id: 'b', status: 'superseded', proposed_by: 'client' })];
    const html = M.panelHtml(state({ pending: null, proposals: done }), {});
    assert.match(html, /<summary>Historial de cambios \(2\)<\/summary>/);
    assert.match(html, /wqn-chip--rejected">Rechazada/);
    assert.match(html, /El cliente propuso cambios/);
    assert.match(html, /Respuesta: Prefiero mi propuesta/);
    assert.equal(M.panelHtml(state({ pending: null, proposals: [] }), {}), '');
    assert.equal(M.panelHtml({ available: false }, {}), '');
    assert.equal(M.panelHtml(null, {}), '');
    assert.match(M.panelHtml(state({ pending: null, proposals: [] }), { flash: 'Listo' }), /class="wqn-flash" role="status"/);
    assert.match(M.panelHtml(state({ pending: null, proposals: [] }), { flash: 'Cambió', flashTone: 'warn' }), /class="wqn-flash wqn-flash--warn" role="alert"/);
});

test('todo dato de usuario sale escapado en el panel y en los formularios', () => {
    const evil = '"><img src=x onerror=alert(1)><script>x</script>';
    const p = proposal({ id: evil, note: evil, changes: { tattoo_body_part: { from: evil, to: evil }, tattoo_style: { from: [evil], to: [evil] } } });
    const html = M.panelHtml(state({ quote_id: evil, names: { client: evil, artist: evil }, pending: p, proposals: [p, { ...p, status: 'rejected', response_note: evil }] }), {})
        + M.panelHtml(state({ role: 'client', quote_id: evil, can: { counter: true, amend: false }, pending: null, proposals: [], current: { counter: { artist_budget_amount: evil, tattoo_body_part: evil, tattoo_size: evil, tattoo_style: [evil], tattoo_color_type: evil, tattoo_idea_description: evil }, amendment: {} }, currency: { counter: evil, amendment: evil } }), { form: 'counter' });
    assert.doesNotMatch(html, /<img src=x|<script>x|onerror=alert\(1\)>/);
    assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
});

// ---------------------------------------------------------------- bloque del cliente
test('P23: el cliente ve Aceptar, Rechazar y Modificar; Modificar lo habilita el módulo', () => {
    const q = { id: 7, quote_id: 'WO-7', quote_status: 'responded', artist_responded_at: '2026-11-10T00:00:00Z', artist_budget_amount: '2000', artist_budget_currency: 'USD', dispute_status: 'none' };
    const html = UI.renderProposal(q, { now: NOW });
    assert.match(html, /data-proposal-action="approve"[^>]*>Aceptar<\/button>/);
    assert.match(html, /data-proposal-action="reject"[^>]*>Rechazar<\/button>/);
    assert.match(html, /<button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-wqn-open="counter" data-quote-id="WO-7" data-role="client" hidden>Modificar<\/button>/);
    assert.match(html, /<div data-wqn-mount data-quote-id="WO-7" data-role="client" data-status="responded" hidden><\/div>/);
    assert.ok(html.indexOf('data-wqn-mount') < html.indexOf('cqp-decision'), 'el panel va antes de los botones');
});

test('P23: rechazar muestra la advertencia textual del dueño', () => {
    const confirm = UI.confirmHtml('reject', 'WO-7');
    assert.match(confirm, /<p class="cqp-warning" role="alert">Esto dará por finalizada la cotización y tendrás que iniciar una nueva\.<\/p>/);
    assert.equal(UI.REJECT_WARNING, 'Esto dará por finalizada la cotización y tendrás que iniciar una nueva.');
    assert.ok(confirm.indexOf('cqp-warning') < confirm.indexOf('confirm-reject'));
    assert.match(UI.renderProposal({ quote_id: 'WO-9', quote_status: 'client_rejected', artist_responded_at: 'x', artist_budget_amount: '10', artist_budget_currency: 'USD' }, { now: NOW }), /la cotización quedó finalizada/);
    assert.match(read('public/shared/css/client-quote-proposal.css'), /\.cqp-decision \.wo-btn\[hidden\]\{display:none\}/);
    assert.match(read('public/shared/css/client-quote-proposal.css'), /\.cqp-warning\{/);
});

test('el punto de montaje aparece donde puede haber negociación o historial', () => {
    const base = { quote_id: 'WO-7', artist_responded_at: 'x', artist_budget_amount: '10', artist_budget_currency: 'USD', final_budget_amount: '10', final_budget_currency: 'USD' };
    for (const status of ['client_approved', 'in_progress', 'artist_completed', 'completed', 'client_rejected', 'cancelled']) {
        assert.match(UI.renderProposal({ ...base, quote_status: status }, { now: NOW }), /data-wqn-mount/, status);
    }
    assert.doesNotMatch(UI.renderProposal({ quote_id: 'WO-1', quote_status: 'pending' }, { now: NOW }), /data-wqn-mount/);
    assert.doesNotMatch(UI.renderProposal({ quote_id: 'WO-2', quote_status: 'in_progress' }, { now: NOW }), /data-wqn-mount/);
    assert.equal(UI.negotiationMountHtml({ quote_id: 'WO-"><x>' }, 'responded').includes('"><x>'), false);
});

test('acuerdo cambiado: el desglose manual queda como referencia de la propuesta original', () => {
    const manual = { status: 'sent', currency: 'USD', line_items: [{ name: 'Sesión', qty: 2, price: 1000 }], subtotal: 2000, total: 2000, deposit_pct: 10, deposit_amount: 185 };
    const amended = UI.renderProposal({ quote_id: 'WO-7', quote_status: 'client_approved', artist_responded_at: 'x', artist_budget_amount: '1850', artist_budget_currency: 'USD', final_budget_amount: '1850', final_budget_currency: 'USD' }, { now: NOW, manual });
    assert.match(amended, /Total acordado<\/dt><dd>1\.850 USD/);
    assert.match(amended, /Desglose de la propuesta original/);
    assert.match(amended, /<dt>Total original<\/dt><dd>2\.000 USD/);
    const same = UI.renderProposal({ quote_id: 'WO-7', quote_status: 'client_approved', artist_responded_at: 'x', artist_budget_amount: '2000', artist_budget_currency: 'USD', final_budget_amount: '2000', final_budget_currency: 'USD' }, { now: NOW, manual });
    assert.doesNotMatch(same, /propuesta original|Total original/);
});

// ---------------------------------------------------------------- contratos del front
test('se monta con una línea en el expediente del artista y en el panel del cliente', () => {
    const detail = read('public/my-quotations/detail/index.html');
    assert.equal((detail.match(/quotation-negotiation\.js/g) || []).length, 1);
    assert.ok(detail.indexOf('quotation-negotiation.js') < detail.indexOf('quotation-detail-figma.js'), 'antes del expediente: escucha su primer render');
    const dash = read('public/client/dashboard/index.html');
    assert.equal((dash.match(/quotation-negotiation\.js/g) || []).length, 1);
    assert.ok(dash.indexOf('client-quote-proposal.js') < dash.indexOf('quotation-negotiation.js'));
    assert.ok(fs.existsSync(path.join(ROOT, 'public/shared/css/quotation-negotiation.css')));
    const figma = read('public/shared/js/quotation-detail-figma.js');
    assert.doesNotMatch(figma, /WoQuoteNegotiation|quotation-negotiation/, 'el expediente no se edita: el módulo es satélite');
    assert.match(figma, /wo:quotation-detail-rendered/);
});

test('contratos entre frentes: wo:quote-respond, wo:negotiation-changed y el aviso push', () => {
    const js = read('public/shared/js/quotation-negotiation.js');
    assert.match(js, /new env\.root\.CustomEvent\('wo:quote-respond', \{ detail: detail, cancelable: true \}\)/);
    assert.match(js, /var detail = \{ quoteId: ctx\.quoteId, prefill: respondPrefill\(ctx\.state, pending\), handled: false \}/);
    assert.match(js, /\/my-quotations\/detail\?id=/);
    assert.match(js, /'&modal=responder'/);
    assert.match(js, /'wo:negotiation-changed'/);
    assert.match(js, /addEventListener\('wo:quotation-detail-rendered', onArtistDetailRendered\)/);
    assert.match(js, /WoNotify/);
    assert.match(js, /\[data-action="edit-agreement"\]/);
    const prefill = M.respondPrefill(state(), proposal());
    assert.deepEqual(prefill, {
        source: 'client_counter', proposalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', amount: '1800', currency: 'USD',
        note: 'Me alcanza hasta 1800',
        changes: { artist_budget_amount: '1800', tattoo_size: 'Grande · 15 a 30 cm' },
        summary: 'Presupuesto: 2.000 USD → 1.800 USD · Tamaño: Mediano · 8 a 15 cm → Grande · 15 a 30 cm',
    });
    // Sin cambio de presupuesto, el prefill lleva el presupuesto vigente del artista.
    assert.equal(M.respondPrefill(state(), proposal({ changes: { tattoo_size: { from: 'a', to: 'b' } } })).amount, '2000');
});

test('navegador: registra WeotziData.Negotiation y llama al servidor con el token', async () => {
    const calls = [];
    const listeners = [];
    const document = {
        readyState: 'complete', head: { appendChild() {} }, body: {}, visibilityState: 'visible',
        addEventListener(type, fn, capture) { listeners.push([type, !!capture]); },
        querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; },
        createElement() { return { setAttribute() {} }; }, contains() { return true; },
    };
    const window = {
        document, location: { pathname: '/client/dashboard', href: 'https://beta.weotzi.com/client/dashboard' },
        _supabase: { auth: { async getSession() { return { data: { session: { access_token: 'tok' } } }; } } },
        MutationObserver: class { observe() {} }, setTimeout, addEventListener() {},
        fetch: async (url, opts) => {
            calls.push({ url, opts });
            if (/\/reject$/.test(url)) return { ok: false, status: 409, json: async () => ({ success: false, code: 'not_pending', error: 'Ya no está pendiente.' }) };
            return { ok: true, status: 200, json: async () => ({ success: true, available: true }) };
        },
    };
    window.self = window;
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/shared/js/quotation-negotiation.js'), 'utf8'), vm.createContext({ self: window, window, console, Intl, Date }));
    assert.equal(typeof window.WoQuoteNegotiation.panelHtml, 'function');
    const types = listeners.map((l) => l[0]);
    for (const type of ['wo:quotation-detail-rendered', 'click', 'submit', 'visibilitychange']) assert.ok(types.includes(type), type);
    assert.ok(listeners.some((l) => l[0] === 'click' && l[1] === true), 'intercepta "editá el acuerdo" en captura');

    const repo = window.WeotziData.Negotiation;
    await repo.state('WO 7', 'client');
    assert.equal(calls[0].url, '/api/negociacion/quotations/WO%207?as=client');
    assert.equal(calls[0].opts.method, 'GET');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok');
    await repo.propose('WO 7', 'client', 'counter', { artist_budget_amount: '1800' }, 'nota');
    assert.equal(calls[1].url, '/api/negociacion/quotations/WO%207/proposals');
    assert.deepEqual(JSON.parse(calls[1].opts.body), { as: 'client', kind: 'counter', changes: { artist_budget_amount: '1800' }, note: 'nota' });
    assert.equal(calls[1].opts.headers['Content-Type'], 'application/json');
    await repo.resolve('WO 7', 'artist', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'accept', '');
    assert.equal(calls[2].url, '/api/negociacion/quotations/WO%207/proposals/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/accept');
    await assert.rejects(() => repo.resolve('WO 7', 'artist', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'reject', ''), (err) => err.status === 409 && err.code === 'not_pending' && /pendiente/.test(err.message));
});

test('textos nuevos en español neutro con tuteo (sin voseo)', () => {
    // Formas propias del voseo (las de tuteo no llevan esa tilde: "cambia", "revisa", "puedes").
    const VOSEO = /(?<![\wáéíóúñ])(querés|podés|tenés|sabés|necesitás|aceptás|rechazás|contanos|contale|escribile|avisale|mandale|elegí|hacé|proponé|mirá|ingresá|indicá|revisá|probá|actualizá|iniciá|confirmá|enviá|cambiá|dejalo|dejálo|vos)(?![\wáéíóúñ])/i;
    const strings = (src) => (src.match(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) || []).join('\n');
    for (const rel of ['public/shared/js/quotation-negotiation.js', 'lib/negociacion.js', 'lib/routes/negociacion.js', 'services/email-events/negociacion.js']) {
        const hit = VOSEO.exec(strings(read(rel)));
        assert.equal(hit, null, `${rel}: "${hit && hit[0]}"`);
    }
});
