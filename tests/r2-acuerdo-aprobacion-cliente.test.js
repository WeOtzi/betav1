// REQ-13 (parte B, decisión del dueño 16 nov 2026): si la cotización tiene una cuenta de cliente
// vinculada (client_user_id), el acuerdo lo aprueba el cliente en la app. El artista ya no lo
// registra por su cuenta ("Confirmar acuerdo y agendar" o el estado "Aprobada") sobre una
// cotización respondida. Sin cuenta vinculada (de invitado, o manual cuyo correo no es de un
// cliente registrado) sigue igual. Una manual creada con el correo de un cliente registrado
// nace vinculada y también espera al cliente.
//   - regla en la base: supabase/migrations/20261117100000 (negociacion_quotation_guard)
//   - pantalla: quotations-view-model.js, quote-status-priority.js, quotations-summary.js,
//     quotation-detail-model.js y quotation-detail-figma.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const VM = require('../public/shared/js/quotations-view-model.js');
const DM = require('../public/shared/js/quotation-detail-model.js');
const RM = require('../public/shared/js/quote-respond-model.js');

const CLIENTE = 'c0ffee00-0000-4000-8000-000000000001';
const CON_CUENTA = { id: 7, quote_id: 'WO-7', quote_status: 'responded', client_user_id: CLIENTE };
const SIN_CUENTA = { id: 8, quote_id: 'WO-8', quote_status: 'responded', client_user_id: null };
// Manual o "Nueva cita" creada con el correo de un cliente registrado: nace vinculada.
const MANUAL_CON_CUENTA = { id: 9, quote_id: 'COT-AB12', quote_status: 'responded', source: 'manual', quotation_medium: 'manual', client_user_id: CLIENTE };

test('modelo: solo una respondida con cliente con cuenta espera la aprobación del cliente', () => {
    assert.equal(VM.needsClientApproval(CON_CUENTA), true);
    assert.equal(VM.needsClientApproval(SIN_CUENTA), false, 'sin cuenta, el artista registra el acuerdo');
    assert.equal(VM.needsClientApproval({ ...CON_CUENTA, quote_status: 'pending' }), false);
    assert.equal(VM.needsClientApproval({ ...CON_CUENTA, quote_status: 'client_approved' }), false, 'ya aprobada: agenda como siempre');
    assert.equal(VM.needsClientApproval({ ...CON_CUENTA, client_user_id: '' }), false);
    assert.equal(VM.needsClientApproval(null), false);
    assert.match(VM.CLIENT_APPROVAL_MESSAGE, /^El cliente tiene cuenta en We Ötzi: el acuerdo queda aprobado cuando acepta tu propuesta en la app\./);
});

test('alcance: la regla mira la cuenta vinculada, no el origen (una manual con cuenta también espera)', () => {
    assert.equal(DM.isManualQuote(MANUAL_CON_CUENTA), true, 'es una cotización manual');
    assert.equal(VM.needsClientApproval(MANUAL_CON_CUENTA), true);
    assert.deepEqual(VM.statusOptionsFor(MANUAL_CON_CUENTA).map((o) => o.value), ['responded', 'cancelled']);
    assert.deepEqual(DM.commandActions('responded', MANUAL_CON_CUENTA), ['contact']);
    // Manual cuyo correo no es de un cliente registrado: sin vínculo, como siempre.
    const manualSinCuenta = { ...MANUAL_CON_CUENTA, client_user_id: null };
    assert.equal(VM.needsClientApproval(manualSinCuenta), false);
    assert.deepEqual(DM.commandActions('responded', manualSinCuenta), ['schedule', 'contact']);
    // La base decide igual: mira client_user_id y no el origen.
    const sql = read('supabase/migrations/20261117100000_acuerdo_requiere_aprobacion_del_cliente.sql');
    assert.match(sql, /if old\.client_user_id is not null then\s+raise exception 'El cliente tiene cuenta/);
    assert.doesNotMatch(sql.split('\n').filter((line) => !/^\s*--/.test(line)).join('\n'), /quotation_medium|source\s*=/);
});

test('modelo: el selector de estado no ofrece "aprobada" con cliente con cuenta y canTransitionFor la niega', () => {
    const values = (list) => list.map((o) => o.value);
    assert.deepEqual(values(VM.statusOptionsFor(CON_CUENTA)), ['responded', 'cancelled']);
    assert.deepEqual(values(VM.statusOptionsFor(SIN_CUENTA)), ['responded', 'client_approved', 'cancelled']);
    assert.deepEqual(values(VM.statusOptionsFor({ ...CON_CUENTA, quote_status: 'client_approved' })), values(VM.statusOptions('client_approved')));
    assert.equal(VM.canTransitionFor(CON_CUENTA, 'client_approved'), false);
    assert.equal(VM.canTransitionFor(CON_CUENTA, 'cancelled'), true, 'retirar la propuesta sigue permitido');
    assert.equal(VM.canTransitionFor(SIN_CUENTA, 'client_approved'), true);
    assert.equal(VM.canTransitionFor(null, 'client_approved'), false);
    // La tabla general no cambia: sigue igual a lo que la base acepta (r3-cotizaciones lo compara).
    assert.equal(VM.canTransition('responded', 'client_approved'), true);
});

test('expediente: sin "Agendar" en la barra de una respondida con cliente con cuenta', () => {
    assert.deepEqual(DM.commandActions('responded', CON_CUENTA), ['contact']);
    assert.deepEqual(DM.commandActions('responded', SIN_CUENTA), ['schedule', 'contact']);
    assert.deepEqual(DM.commandActions('responded'), ['schedule', 'contact'], 'sin cotización, como antes');
    // Los demás estados no miran la cuenta: aprobada y en progreso agendan sesiones.
    assert.deepEqual(DM.commandActions('approved', CON_CUENTA), ['schedule', 'contact']);
    assert.deepEqual(DM.commandActions('in_progress', CON_CUENTA), ['schedule', 'contact']);
    assert.deepEqual(DM.commandActions('pending', CON_CUENTA), ['accept', 'reject', 'schedule', 'contact']);
    const detail = read('public/shared/js/quotation-detail-figma.js');
    assert.match(detail, /const actions = M\.commandActions\(v\.stage, quote\);/);
    // Ya aprobada, «Agendar» abre «Agendar sesión N de M», no «Confirmar acuerdo y agendar».
    assert.match(detail, /if \(v\.stage === 'responded'\) \{ openAgreementDialog\(false\); return; \}\n\s+openScheduleDialog\(null\);/);
});

test('franja de estado: opciones y nota según tenga cuenta el cliente', () => {
    const window = { WoQuotationsViewModel: VM, WoQuoteRespondModel: RM, addEventListener() {}, WoQuotationDetailActions: null };
    const document = { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, readyState: 'loading' };
    vm.runInNewContext(read('public/shared/js/quote-status-priority.js'), { window, document, console, CustomEvent: function () {} });
    const strip = window.WoQuoteStatusPriority;
    assert.ok(strip, 'el módulo expone statusOptions y noteFor');
    const values = (q) => strip.statusOptions(q).map((o) => o.value);
    assert.deepEqual(values(CON_CUENTA), ['responded', 'cancelled']);
    assert.deepEqual(values(SIN_CUENTA), ['responded', 'client_approved', 'cancelled']);
    const con = strip.noteFor({ quote: CON_CUENTA, stage: 'responded' });
    assert.match(con, /se activan cuando el cliente la acepta en la app/);
    assert.doesNotMatch(con, /registra el acuerdo/);
    const sin = strip.noteFor({ quote: SIN_CUENTA, stage: 'responded' });
    assert.match(sin, /El cliente no tiene cuenta: cuando cierren el trato, registra el acuerdo con «Agendar»/);
});

// ---------------------------------------------------------------------------
// El bloque real del expediente (de clientApprovalRequired a showAgreementDialog)
// ejecutado con dobles: lo que se prueba es el comportamiento, no el texto.
// ---------------------------------------------------------------------------
const DETAIL = read('public/shared/js/quotation-detail-figma.js');
const AGREEMENT_BLOCK = DETAIL.slice(DETAIL.indexOf('    function clientApprovalRequired(q) {'), DETAIL.indexOf('    function syncAgreementExtras()'));
const userError = (message) => Object.assign(new Error(message), { userMessage: message });
// Así arma el error la capa de datos (postgrest-client.js, run()).
const dbError = (code, message) => Object.assign(new Error(`[quotationDetail.updateQuote] ${message}`), { code, cause: { code, message } });

function mountAgreement({ quote, fresh, counter = false, vmodel = VM, held = '2026-12-01T15:00:00.000Z', updateError = null, renderError = null }) {
    const calls = [];
    const state = { quote, sessions: [], user: { id: 'artista-1' } };
    const box = { fresh };
    const overlay = { querySelector: () => null };
    let submit = null;
    const deps = {
        state,
        M: DM,
        VM: () => vmodel,
        D: () => ({ QuotationDetail: { createSession: async () => { calls.push(['createSession']); return { id: 's2', session_number: 1 }; } } }),
        window: {
            WoSlotHold: {
                confirmedSessionId: () => null,
                pendingStart: () => held,
                labelFor: () => '',
                confirmFor: async (q, opts) => { calls.push(['confirmFor', opts.from_agreement]); return { session_id: 's1', session_number: 1 }; },
            },
        },
        document: { querySelector: () => null, getElementById: (id) => (id === 'qd-dialog-root' ? { children: [overlay] } : null) },
        guardWrite: () => true,
        clientCounterPending: async () => counter,
        COUNTER_PENDING_MESSAGE: 'CONTRA',
        showToast: (message, opts) => calls.push(['toast', message, !!(opts && opts.error)]),
        buildScenario: () => calls.push(['buildScenario']),
        render: () => { calls.push(['render']); if (renderError) throw renderError; },
        sessionFlow: () => null,
        openDialog: (options) => { calls.push(['dialog', options.title]); submit = options.onSubmit; return overlay; },
        field: () => '', currencySelect: () => '', currencyOf: () => 'USD', depositField: () => '', durationFields: () => '',
        esc: (value) => String(value == null ? '' : value), localInputValue: () => '',
        readAmount: (value) => Number(value), readMinutes: () => 120, readDateTime: (value) => value, readDeposit: () => ({}),
        userError,
        findQuote: async () => {
            calls.push(['findQuote']);
            if (box.fresh instanceof Error) throw box.fresh;
            return box.fresh === undefined ? state.quote : box.fresh;
        },
        updateQuote: async (patch) => { calls.push(['updateQuote', patch.quote_status || null]); if (updateError) throw updateError; },
        syncAgreementExtras: () => {},
        noticeAgreement: () => calls.push(['notice']),
        reloadAll: async () => { calls.push(['reloadAll']); },
        calendarUrl: () => '/calendar',
    };
    const names = Object.keys(deps);
    // eslint-disable-next-line no-new-func
    const api = new Function(...names, `${AGREEMENT_BLOCK}\n return { openAgreementDialog, showAgreementDialog };`)(...names.map((name) => deps[name]));
    const data = { amount: '280', currency: 'USD', sessions: '2', first: '2026-12-01T15:00', comment: '' };
    return {
        api, calls, state, overlay,
        setFresh: (value) => { box.fresh = value; },
        names: () => calls.map((c) => c[0]),
        submit: () => submit({}, data),
        settle: () => new Promise((resolve) => setImmediate(resolve)),
    };
}

test('expediente: "Confirmar acuerdo" no abre con cliente con cuenta y avisa por qué', async () => {
    assert.ok(AGREEMENT_BLOCK.length > 2000, 'el bloque del acuerdo se extrae del expediente');
    const open = async (opts) => {
        const m = mountAgreement(opts);
        m.api.openAgreementDialog(false);
        await m.settle();
        return m.calls;
    };
    // Cliente con cuenta: no abre y explica.
    assert.deepEqual(await open({ quote: CON_CUENTA }), [['toast', VM.CLIENT_APPROVAL_MESSAGE, true]]);
    // Con cambios del cliente pendientes gana ese aviso (dice qué hacer ahora).
    assert.deepEqual(await open({ quote: CON_CUENTA, counter: true }), [['toast', 'CONTRA', true]]);
    // Sin cuenta vinculada: el artista registra el acuerdo como siempre.
    assert.deepEqual(await open({ quote: SIN_CUENTA }), [['dialog', 'Confirmar acuerdo y agendar']]);
    // Ya aprobada: la regla no aplica (solo frena las respondidas). En pantalla esa etapa agenda
    // con openScheduleDialog; a este diálogo solo se llega con ?modal=acuerdo.
    assert.deepEqual(await open({ quote: { ...CON_CUENTA, quote_status: 'client_approved' } }), [['dialog', 'Confirmar acuerdo y agendar']]);
    // Sin el modelo de vista (carga parcial) decide la base: no se bloquea a ciegas.
    assert.deepEqual(await open({ quote: CON_CUENTA, vmodel: null }), [['dialog', 'Confirmar acuerdo y agendar']]);
    // Todas las entradas pasan por openAgreementDialog (la URL ?modal=acuerdo y el módulo satélite).
    assert.match(DETAIL, /\n\s+acuerdo: \(\) => openAgreementDialog\(false\),\n/);
    assert.match(DETAIL, /\n\s+agreement: \(\) => openAgreementDialog\(false\),\n/);
    assert.equal(DETAIL.split('showAgreementDialog(').length - 1, 3, 'solo openAgreementDialog abre showAgreementDialog (dos llamadas y la definición)');
    assert.equal(AGREEMENT_BLOCK.split('showAgreementDialog(').length - 1, 3, 'y esas tres están en el bloque que se ejecuta aquí');
    // El selector de estado tampoco lo saltea.
    assert.match(DETAIL, /if \(next === 'client_approved' && clientApprovalRequired\(state\.quote\)\) \{\n\s+showToast\(clientApprovalMessage\(\), \{ error: true \}\);\n\s+return false;/);
});

test('expediente: al confirmar se relee la cotización antes de reservar el turno', async () => {
    // Página vieja: el expediente cargó sin cuenta y el cliente la vinculó después.
    const stale = mountAgreement({ quote: SIN_CUENTA, fresh: { ...SIN_CUENTA, client_user_id: CLIENTE } });
    stale.api.showAgreementDialog(false);
    await assert.rejects(stale.submit(), (error) => error.userMessage === VM.CLIENT_APPROVAL_MESSAGE);
    assert.deepEqual(stale.names(), ['dialog', 'findQuote', 'buildScenario', 'render'], 'corta sin reservar el turno ni guardar');
    assert.equal(stale.state.quote.client_user_id, CLIENTE, 'el expediente queda con la fila recién leída');
    assert.equal(stale.overlay._repainted, true, 'el diálogo abierto recuerda que el fondo se re-pintó');
    // Segundo clic sin red: vale lo que ya se sabe de esta cotización, no la fila de la apertura.
    stale.setFresh(new Error('sin red'));
    await assert.rejects(stale.submit(), (error) => error.userMessage === VM.CLIENT_APPROVAL_MESSAGE);
    assert.deepEqual(stale.names(), ['dialog', 'findQuote', 'buildScenario', 'render', 'findQuote'], 'tampoco reserva el turno en el segundo intento');
    // Si el expediente de fondo no se puede volver a pintar, el corte y su motivo siguen en pie.
    const broken = mountAgreement({ quote: SIN_CUENTA, fresh: { ...SIN_CUENTA, client_user_id: CLIENTE }, renderError: new Error('pintado') });
    broken.api.showAgreementDialog(false);
    await assert.rejects(broken.submit(), (error) => error.userMessage === VM.CLIENT_APPROVAL_MESSAGE);
    assert.ok(!broken.names().includes('confirmFor') && !broken.names().includes('updateQuote'));

    // Control: la fila sigue sin cuenta → se reserva el turno y después se guarda el acuerdo.
    const ok = mountAgreement({ quote: SIN_CUENTA });
    ok.api.showAgreementDialog(false);
    await ok.submit();
    assert.deepEqual(ok.calls.slice(0, 5), [['dialog', 'Confirmar acuerdo y agendar'], ['findQuote'], ['confirmFor', true], ['updateQuote', 'client_approved'], ['notice']]);
    assert.equal(ok.overlay._repainted, undefined, 'sin corte, el diálogo cierra como cualquier otro');

    // Sin ?id= la relectura puede devolver otra cotización: no decide sobre esta.
    const other = mountAgreement({ quote: SIN_CUENTA, fresh: { ...CON_CUENTA } });
    other.api.showAgreementDialog(false);
    await other.submit();
    assert.deepEqual(other.names().slice(1, 4), ['findQuote', 'confirmFor', 'updateQuote']);
    assert.equal(other.state.quote, SIN_CUENTA);

    // Si la relectura falla, no se bloquea a ciegas: decide la base.
    const offline = mountAgreement({ quote: SIN_CUENTA, fresh: new Error('sin red') });
    offline.api.showAgreementDialog(false);
    await offline.submit();
    assert.deepEqual(offline.names().slice(1, 4), ['findQuote', 'confirmFor', 'updateQuote']);

    // Editar un acuerdo ya aprobado no relee ni cambia el estado.
    const edit = mountAgreement({ quote: { ...CON_CUENTA, quote_status: 'client_approved' } });
    edit.api.showAgreementDialog(true);
    await edit.submit();
    assert.deepEqual(edit.calls.slice(0, 2), [['dialog', 'Editar acuerdo'], ['updateQuote', null]]);
});

test('expediente: si la base rechaza el acuerdo por esta regla, el diálogo dice el motivo', async () => {
    const message = VM.CLIENT_APPROVAL_MESSAGE;
    // La base como última defensa: el modelo de vista no cargó y la regla se aplica igual.
    const rejected = mountAgreement({ quote: CON_CUENTA, vmodel: null, held: null, updateError: dbError('42501', message) });
    rejected.api.showAgreementDialog(false);
    await assert.rejects(rejected.submit(), (error) => typeof error.userMessage === 'string' && error.userMessage.length > 20 && !/^\[/.test(error.userMessage));
    // Con el modelo cargado, el texto es el mismo que el de la base.
    const same = mountAgreement({ quote: SIN_CUENTA, held: null, updateError: dbError('42501', message) });
    same.api.showAgreementDialog(false);
    await assert.rejects(same.submit(), (error) => error.userMessage === message);
    assert.ok(!same.names().includes('notice'), 'sin acuerdo guardado no hay aviso al cliente');
    // El mismo texto con otro código no es esta regla: no se convierte.
    const otherCode = mountAgreement({ quote: SIN_CUENTA, held: null, updateError: dbError('P0001', message) });
    otherCode.api.showAgreementDialog(false);
    await assert.rejects(otherCode.submit(), (error) => error.userMessage === undefined);
    // Otros 42501 (RLS, permisos) no se muestran: siguen al mensaje genérico del diálogo.
    const rls = mountAgreement({ quote: SIN_CUENTA, held: null, updateError: dbError('42501', 'new row violates row-level security policy') });
    rls.api.showAgreementDialog(false);
    await assert.rejects(rls.submit(), (error) => error.userMessage === undefined && /^\[quotationDetail\.updateQuote\]/.test(error.message));
    // Y la regla de la contrapropuesta pendiente conserva su camino.
    const counter = mountAgreement({ quote: SIN_CUENTA, counter: true });
    counter.api.showAgreementDialog(false);
    await assert.rejects(counter.submit(), (error) => error.userMessage === 'CONTRA');
    assert.deepEqual(counter.names(), ['dialog'], 'ni relee ni reserva: corta antes');
});

test('resumen de la lista: mismo selector, nota visible y mismo aviso', () => {
    const summary = read('public/shared/js/quotations-summary.js');
    assert.match(summary, /VM\.statusOptionsFor \? VM\.statusOptionsFor\(quote\) : VM\.statusOptions\(quote\.quote_status\)/);
    // La opción no está en el selector, así que la lista lo explica con una nota junto al estado.
    const block = /    function approvalNote\(quote\) \{\n[\s\S]*?\n    \}\n/.exec(summary);
    assert.ok(block, 'la nota vive junto al selector');
    // eslint-disable-next-line no-new-func
    const note = new Function('VM', `${block[0]}; return approvalNote;`)(VM);
    assert.match(note(CON_CUENTA), /^<p class="qs-muted qs-approval-note" id="qs-status-note">El cliente tiene cuenta: el acuerdo queda aprobado cuando acepta tu propuesta en la app\.<\/p>$/);
    assert.match(note(MANUAL_CON_CUENTA), /qs-approval-note/);
    assert.equal(note(SIN_CUENTA), '');
    assert.equal(note({ ...CON_CUENTA, is_archived: true }), '');
    assert.equal(note({ ...CON_CUENTA, quote_status: 'client_approved' }), '');
    assert.match(summary, /\$\{prioritySelect\(quote\)\}\n\s+<\/div>\n\s+\$\{approvalNote\(quote\)\}/, 'se pinta debajo de los selectores');
    // El selector anuncia la nota solo cuando existe.
    const selectBlock = /    function statusSelect\(quote\) \{\n[\s\S]*?\n    \}\n/.exec(summary);
    assert.ok(selectBlock);
    // eslint-disable-next-line no-new-func
    const select = new Function('VM', 'esc', `${block[0]}\n${selectBlock[0]}; return statusSelect;`)(VM, (value) => String(value));
    assert.match(select(CON_CUENTA), /aria-label="Estado de la cotización" aria-describedby="qs-status-note">/);
    assert.doesNotMatch(select(SIN_CUENTA), /aria-describedby/);
    assert.doesNotMatch(select(CON_CUENTA), /value="client_approved"/);
    assert.match(select(SIN_CUENTA), /value="client_approved"/);
    // La nota se lee: mismo tono que la del expediente (.qsp-note), no el gris tenue de .qs-muted.
    assert.match(read('public/shared/css/quotations.css'), /\.qs-controls \.qs-approval-note \{ margin-top: var\(--space-2\); color: var\(--text-muted\); \}/);
});

test('resumen de la lista: si igual llega el cambio a "aprobada", avisa y no abre el acuerdo', async () => {
    const summary = read('public/shared/js/quotations-summary.js');
    const changeBlock = /    async function onStatusChange\(value\) \{\n[\s\S]*?\n    \}\n/.exec(summary);
    assert.ok(changeBlock);
    const change = async (quote, value) => {
        const calls = [];
        const window = { location: { href: '' }, QuotationClientNotices: null, confirm: () => true };
        // eslint-disable-next-line no-new-func
        const run = new Function('current', 'VM', 'page', 'render', 'goRespond', 'window', 'responsePatch', 'patchQuote', 'noticeClient',
            `${changeBlock[0]}; return onStatusChange;`)(
            quote, VM,
            () => ({ toast: (message, tone) => calls.push(['toast', message, tone]), appUrl: (url) => url }),
            (loading) => { calls.push(['render', loading]); },
            () => calls.push(['goRespond']), window, () => ({}),
            async (patch) => { calls.push(['patch', patch.quote_status]); return true; }, () => {});
        await run(value);
        return { calls, href: window.location.href };
    };
    const blocked = await change(CON_CUENTA, 'client_approved');
    assert.deepEqual(blocked.calls, [['toast', VM.CLIENT_APPROVAL_MESSAGE, 'error'], ['render', false]]);
    assert.equal(blocked.href, '', 'no navega a ?modal=acuerdo');
    const allowed = await change(SIN_CUENTA, 'client_approved');
    assert.deepEqual(allowed.calls, []);
    assert.equal(allowed.href, VM.agreementUrl(SIN_CUENTA), 'sin cuenta vinculada va al diálogo del acuerdo');
    const withdrawn = await change(CON_CUENTA, 'cancelled');
    assert.deepEqual(withdrawn.calls, [['patch', 'cancelled']], 'retirar la propuesta sigue funcionando');
});

test('expediente: el foco al cerrar un diálogo solo cambia si adoptQuote re-pintó el fondo', () => {
    const block = /    function closeDialog\(overlay\) \{\n[\s\S]*?\n    \}\n/.exec(DETAIL);
    assert.ok(block);
    const el = (id, { visible = true, disabled = false, connected = true } = {}) => ({
        id, disabled, isConnected: connected, focused: 0,
        getClientRects() { return visible ? [{}] : []; },
        focus() { this.focused += 1; },
    });
    const close = (opener, nodes, repainted) => {
        const document = { removeEventListener() {}, getElementById: (id) => nodes[id] || null };
        // eslint-disable-next-line no-new-func
        const fn = new Function('document', `${block[0]}; return closeDialog;`)(document);
        const overlay = { remove() {}, _onKey: null, _returnFocus: opener };
        if (repainted) overlay._repainted = true;
        fn(overlay);
    };
    const focused = (...list) => list.map((node) => node.focused);

    // Cualquier diálogo, como en la 2.5.0: se le pide el foco al control que lo abrió y a nadie más.
    // Si ese control fue reemplazado al guardar (botón de una fila de sesión), está oculto o está
    // ocupado (el selector «Estado» mientras confirma), el navegador no mueve el foco: no se salta
    // al inicio del expediente ni a un enlace ajeno.
    for (const opts of [{}, { connected: false }, { visible: false }, { disabled: true }]) {
        const opener = el('qd-row-button', opts);
        const status = el('qsp-status');
        const contact = el('qd-contact');
        close(opener, { 'qsp-status': status, 'qd-contact': contact }, false);
        assert.deepEqual(focused(opener, status, contact), [1, 0, 0], JSON.stringify(opts));
    }
    assert.doesNotThrow(() => close(null, {}, false));

    // Diálogo del acuerdo que adoptQuote re-pintó: «Agendar» quedó oculto → al selector de estado.
    const hidden = el('qd-schedule', { visible: false });
    const status = el('qsp-status');
    close(hidden, { 'qsp-status': status, 'qd-contact': el('qd-contact') }, true);
    assert.deepEqual(focused(hidden, status), [0, 1]);
    // Se abrió desde el selector de estado, que el re-pintado reemplazó → al selector nuevo.
    const oldStatus = el('qsp-status', { connected: false });
    const newStatus = el('qsp-status');
    close(oldStatus, { 'qsp-status': newStatus }, true);
    assert.deepEqual(focused(oldStatus, newStatus), [0, 1]);
    // Estado deshabilitado (solo lectura) → al contacto.
    const contact = el('qd-contact');
    close(el('qd-schedule', { visible: false }), { 'qsp-status': el('qsp-status', { disabled: true }), 'qd-contact': contact }, true);
    assert.equal(contact.focused, 1);
    // El control que lo abrió sigue a la vista → vuelve a él aunque el fondo se haya re-pintado.
    const visible = el('qd-schedule');
    const status2 = el('qsp-status');
    close(visible, { 'qsp-status': status2 }, true);
    assert.deepEqual(focused(visible, status2), [1, 0]);
    // Nada a la vista → como siempre.
    const lone = el('qd-schedule', { visible: false });
    close(lone, {}, true);
    assert.equal(lone.focused, 1);
    assert.doesNotThrow(() => close(null, {}, true));
});

test('base: el guardia rechaza responded → client_approved del artista si el cliente tiene cuenta', () => {
    const name = '20261117100000_acuerdo_requiere_aprobacion_del_cliente';
    const sql = read(`supabase/migrations/${name}.sql`);
    const down = read(`supabase/rollbacks/${name}.down.sql`);
    const base = read('supabase/migrations/20261116140000_negociacion_propuestas.sql');
    const fnOf = (text) => {
        const start = text.indexOf('create or replace function public.negociacion_quotation_guard()');
        return text.slice(start, text.indexOf('$$;', start) + 3);
    };
    // La regla va dentro del bloque del artista, después de la de la contrapropuesta pendiente.
    const rule = /if v_restricted\s+and old\.quote_status = 'responded'\s+and new\.quote_status = 'client_approved' then\s+if \(select auth\.uid\(\)\) = old\.artist_id then\s+if exists \([\s\S]*?p\.kind = 'counter' and p\.status = 'pending'[\s\S]*?end if;[\s\S]*?if old\.client_user_id is not null then\s+raise exception 'El cliente tiene cuenta en We Ötzi: el acuerdo queda aprobado cuando acepta tu propuesta en la app\. Pídele que la acepte desde su panel\.'\s+using errcode = '42501';\s+end if;\s+end if;\s+end if;/;
    assert.match(fnOf(sql), rule);
    assert.doesNotMatch(fnOf(down), /El cliente tiene cuenta en We Ötzi/, 'la reversa vuelve a la función anterior');
    // Es la función ya aplicada con esa única regla (y un comentario): nada más cambia.
    assert.equal(fnOf(down), fnOf(base), 'la reversa es byte por byte la función de 20261116140000');
    const strip = (text) => text.split('\n').filter((line) => !/^\s*--/.test(line)).join('\n');
    const added = strip(fnOf(sql)).replace(/\s+if old\.client_user_id is not null then\s+raise exception 'El cliente tiene cuenta en We Ötzi[^\n]*\n\s+using errcode = '42501';\s+end if;/, '');
    assert.equal(added.replace(/\s+/g, ' '), strip(fnOf(base)).replace(/\s+/g, ' '), 'sin la regla nueva, el cuerpo coincide con el aplicado');
    // El guardia sigue distinguiendo al usuario final: el servidor (aceptación del cliente) y soporte no pasan por la regla.
    assert.match(fnOf(sql), /v_restricted boolean := current_user in \('anon', 'authenticated'\)\s+and not coalesce\(public\.is_support_user\(\), false\);/);
    assert.match(sql, /revoke all on function public\.negociacion_quotation_guard\(\) from public, anon, authenticated;/);
    // Mismo texto en la base y en la pantalla, y es el que reconoce el diálogo del acuerdo.
    const raised = /raise exception '(El cliente tiene cuenta en We Ötzi[^\n]*)'\n\s+using errcode = '42501';/.exec(sql);
    assert.ok(raised, 'la regla nueva levanta su mensaje');
    assert.equal(raised[1].replace(/''/g, "'"), VM.CLIENT_APPROVAL_MESSAGE, 'mismo texto, completo, en la base y en la pantalla');
    assert.ok(VM.CLIENT_APPROVAL_MESSAGE.startsWith('El cliente tiene cuenta en We Ötzi'));
    assert.match(DETAIL, /text\.indexOf\('El cliente tiene cuenta en We Ötzi'\) !== -1/);
});

test('documentación: dice lo que pasa en pantalla y el orden de la vuelta atrás', () => {
    const deploy = read('deployments/DEPLOY.md');
    const section = deploy.slice(deploy.indexOf('### El acuerdo necesita la aprobación del cliente con cuenta'), deploy.indexOf('### Limpieza de `session_logs`'));
    assert.match(section, /No pudimos guardar\. Prueba\s+nuevamente\./, 'con la 2.5.0 sirviendo el artista ve el genérico');
    assert.doesNotMatch(section, /vería el mensaje de la base/);
    assert.match(section, /Para volver atrás, al revés/);
    const changelog = read('docs/CHANGELOG.md');
    const entry = changelog.slice(changelog.indexOf('## [2.5.1]'), changelog.indexOf('## [2.5.0]'));
    assert.match(entry, /Rollback: primero supabase\/rollbacks\/20261117100000_acuerdo_requiere_aprobacion_del_cliente\.down\.sql y después el controlador/);
    assert.match(entry, /"Nueva cita" creadas con el correo de un cliente registrado/);
    assert.doesNotMatch(entry, /__VALIDACION__/);
    const doc = read('docs/NEGOCIACION_COTIZACION.md');
    assert.match(doc, /La regla mira `client_user_id`, no el\s+origen/);
    assert.doesNotMatch(doc, /con el mismo diálogo, como siempre/);
    assert.match(read('docs/COT_RESPUESTA.md'), /WoQuotationsViewModel\.statusOptionsFor\(quote\)/);
});
