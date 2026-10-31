// W-TEAM: pestañas Solicitudes (studio-dashboard-requests.js) y Contratos
// (studio-dashboard-contracts.js + window.WeOtziStudioContracts). Corre cada
// módulo en una VM con WeotziData, el kit (real, con la UI reemplazada) y el
// registro WeOtziStudioAdmin falsos, y expone sus funciones internas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const kitReal = require('../public/shared/js/studio-admin-kit.js');
const contractsSource = read('public/shared/js/studio-dashboard-contracts.js');
const requestsSource = read('public/shared/js/studio-dashboard-requests.js');
const css = read('public/shared/css/studio-contracts.css');
const plain = s => String(s).replace(/ /g, ' ');
// Los objetos creados en la VM tienen otros prototipos: se comparan por JSON.
const same = (actual, expected, msg) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), msg);

const CONTRACTS_EXPOSED = [
    'termsOf', 'compensationSummary', 'compensationShort', 'validityText', 'contractDocumentHtml', 'validateDraft',
    'draftPayload', 'newVersionPayload', 'documentActionsFor', 'issueContract', 'createNewVersion', 'openEditor',
    'openFromApplication', 'openForMembership', 'injectRosterButtons', 'rosterEligible', 'visibleContracts',
    'filterIdFor', 'contractsTableHtml', 'editorHtml', 'endOfDayIso', 'addDaysYmd', 'idFrom', 'state', 'tabModule',
    'statusCellHtml'
];
const REQUESTS_EXPOSED = [
    'requestCardHtml', 'changeCardHtml', 'counterCardHtml', 'pendingCount', 'approveRequest', 'rejectRequest',
    'approveFormHtml', 'respondChangeWithContract', 'closeChange', 'acceptCounterOffer', 'rejectCounterOffer',
    'normalizeSub', 'panelHtml', 'membershipFromRequest', 'membershipFromChange', 'state', 'tabModule', 'runAction'
];

const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(cond, label) {
    for (let i = 0; i < 50; i++) {
        if (cond()) return;
        await tick();
    }
    assert.fail('timeout esperando: ' + label);
}

// Kit real (formato, etiquetas, escapes) con la UI reemplazada por dobles
// controlables: los drawers quedan abiertos hasta que el test los cierra o
// hace click en una acción, como el kit real.
function fakeKit(options = {}) {
    const log = { toasts: [], drawers: [], modals: [], prompts: [], confirms: [] };
    const answers = {
        prompt: options.prompt !== undefined ? options.prompt : null,
        confirm: options.confirm !== undefined ? options.confirm : true,
        modal: options.modal !== undefined ? options.modal : null
    };
    const kit = Object.assign({}, kitReal, {
        toast(msg, tone) { log.toasts.push([plain(msg), tone]); return { el: null, close() {} }; },
        promptDialog(opts) { log.prompts.push(opts); return Promise.resolve(typeof answers.prompt === 'function' ? answers.prompt(opts) : answers.prompt); },
        confirmDialog(opts) { log.confirms.push(opts); return Promise.resolve(answers.confirm); },
        openModal(opts) {
            log.modals.push(opts);
            const value = typeof answers.modal === 'function' ? answers.modal(opts) : answers.modal;
            return { el: null, body: null, closed: Promise.resolve(value), close() {}, setError() {} };
        },
        openDrawer(opts) {
            let resolve;
            const closed = new Promise(r => { resolve = r; });
            const drawer = {
                opts, closed, el: null, body: typeof options.drawerBody === 'function' ? options.drawerBody(opts) : null, errors: [],
                close(v) { resolve(v === undefined ? null : v); },
                setError(msg) { drawer.errors.push(msg); },
                setBusy() {},
                labels: () => (opts.actions || []).map(a => a.label),
                async click(labelText) {
                    const action = (opts.actions || []).find(a => a.label === labelText);
                    assert.ok(action, 'falta la acción ' + labelText);
                    let res;
                    try {
                        res = await action.onClick(drawer);
                    } catch (err) {
                        drawer.errors.push(kitReal.friendlyError(err));
                        return { error: err };
                    }
                    if (res === false || action.close === false) return res;
                    drawer.close(action.value !== undefined ? action.value : (res === undefined ? null : res));
                    return res;
                }
            };
            log.drawers.push(drawer);
            return drawer;
        },
        guarded(btn, fn) { return Promise.resolve().then(fn).catch(err => { log.toasts.push([kitReal.friendlyError(err), 'danger']); }); }
    });
    return { kit, log };
}

function fakeRegistry(ctx) {
    const registry = {
        registered: {},
        rosterListeners: [],
        register(tab, def) { registry.registered[tab] = def; return true; },
        getContext: async () => ctx,
        onRosterRender(cb) { registry.rosterListeners.push(cb); return () => {}; }
    };
    return registry;
}

function fakeCtx(overrides = {}) {
    const ctx = {
        studio: { id: 'st', name: 'Tinta Sur', slug: 'tinta-sur', user_id: 'owner' },
        studioId: 'st',
        userId: 'owner',
        notified: [],
        badges: [],
        refreshed: 0,
        navigate() {},
        setBadge(tab, n) { ctx.badges.push([tab, n]); },
        notify: async payload => { ctx.notified.push(payload); return { ok: true, data: {}, error: null }; },
        refresh: async () => { ctx.refreshed++; }
    };
    return Object.assign(ctx, overrides);
}

function load(source, names, { data = {}, kit, ctx, extraWindow = {} } = {}) {
    const registry = fakeRegistry(ctx);
    const window = Object.assign({ WeotziData: data, WeOtziStudioKit: kit, WeOtziStudioAdmin: registry, print() {} }, extraWindow);
    const exposed = source.replace(/\}\)\(\);\s*$/, 'globalThis.__t = { ' + names.join(', ') + ' }; })();');
    assert.notEqual(exposed, source, 'el archivo debe terminar en })();');
    const context = { window, console: { warn() {}, error() {}, log() {} } };
    vm.runInNewContext(exposed, context);
    return { api: context.__t, window, registry };
}

const ARTIST = { user_id: 'ar1', name: 'Ana Pérez', username: 'anap', profile_picture: null };

function signedContract(extra = {}) {
    return Object.assign({
        id: 'c1', studio_id: 'st', artist_user_id: 'ar1', membership_id: 'm1', origin: 'spot_application',
        application_id: 'app1', spot_id: 'sp1', contract_number: 'C-2026-0001', version: 1, status: 'signed',
        role: 'guest', location_id: 'loc1', compensation_model: 'mixed', artist_percentage: 60,
        fixed_amount: 150000, fixed_currency: 'ARS', fixed_period: 'monthly', fixed_payer: 'artist_to_studio',
        start_date: '2026-11-01', end_date: '2026-12-31', cancellation_notice_days: 15,
        includes: ['Camilla', 'Luz'], perks: ['Difusión'], artist_obligations: ['Higiene'],
        house_rules: 'Puntualidad', terms: 'Cláusula <script>alert(1)</script>',
        terms_hash: 'a1b2c3d4e5', studio_signer_name: 'Dueña Uno', studio_signed_at: '2026-10-30T12:00:00Z',
        artist_signer_name: 'Ana Pérez', artist_signed_at: '2026-10-31T12:00:00Z', sent_at: '2026-10-30T12:00:00Z',
        artists_db: ARTIST,
        studios: { id: 'st', name: 'Tinta Sur', slug: 'tinta-sur' },
        studio_spots: { id: 'sp1', title: 'Guest de verano', kind: 'guest_spot' },
        studio_locations: { id: 'loc1', label: 'Palermo', city: 'CABA', country: 'AR' }
    }, extra);
}

function draftContract(extra = {}) {
    return Object.assign(signedContract(), {
        id: 'c9', status: 'draft', terms_hash: null, terms_snapshot: null, studio_signer_name: null,
        studio_signed_at: null, artist_signer_name: null, artist_signed_at: null, sent_at: null
    }, extra);
}

function contractsRepo(calls, overrides = {}) {
    return Object.assign({
        get: async id => { calls.push(['get', id]); return { data: draftContract({ id }), error: null }; },
        listForStudio: async (studioId, opts) => { calls.push(['listForStudio', studioId, opts]); return { data: [], error: null }; },
        expireOverdue: async studioId => { calls.push(['expireOverdue', studioId]); return { data: 0, error: null }; },
        getCurrentForMembership: async id => { calls.push(['getCurrentForMembership', id]); return { data: null, error: null }; },
        prepareForMembership: async id => { calls.push(['prepareForMembership', id]); return { data: 'c9', error: null }; },
        prepareFromApplication: async id => { calls.push(['prepareFromApplication', id]); return { data: 'c9', error: null }; },
        saveDraft: async obj => { calls.push(['saveDraft', obj]); return { data: obj.id || 'c2', error: null }; },
        issue: async (id, name, exp) => { calls.push(['issue', id, name, exp]); return { data: { id, status: 'sent' }, error: null }; },
        cancel: async (id, reason) => { calls.push(['cancel', id, reason]); return { data: { id, status: 'cancelled' }, error: null }; },
        terminate: async (id, reason, end) => { calls.push(['terminate', id, reason, end]); return { data: { id, status: 'terminated' }, error: null }; }
    }, overrides);
}

function contractsHarness({ repo = {}, kitOptions = {}, data = {}, ctx } = {}) {
    const calls = [];
    const { kit, log } = fakeKit(kitOptions);
    const context = ctx || fakeCtx();
    const D = Object.assign({
        StudioContracts: contractsRepo(calls, repo),
        StudioSpots: { decideApplicationRpc: async (id, st) => { calls.push(['decideApplicationRpc', id, st]); return { data: { id, status: 'shortlisted' }, error: null }; } },
        StudioLocations: { listActiveByStudio: async () => ({ data: [{ id: 'loc1', label: 'Palermo', is_primary: true }], error: null }) },
        StudioMemberships: {}
    }, data);
    const loaded = load(contractsSource, CONTRACTS_EXPOSED, { data: D, kit, ctx: context });
    return Object.assign(loaded, { calls, log, ctx: context, data: D, kit });
}

// ---------------------------------------------------------------
// Registro y API global
// ---------------------------------------------------------------
test('contratos registra la pestaña, el listener del roster y la API global', () => {
    const h = contractsHarness();
    const def = h.registry.registered.contratos;
    assert.equal(typeof def.mount, 'function');
    assert.equal(typeof def.show, 'function');
    assert.equal(h.registry.rosterListeners.length, 1);
    const api = h.window.WeOtziStudioContracts;
    same(Object.keys(api).sort(), ['openEditor', 'openForMembership', 'openFromApplication']);
});

test('solicitudes registra su pestaña', () => {
    const { kit } = fakeKit();
    const { registry } = load(requestsSource, REQUESTS_EXPOSED, { kit, ctx: fakeCtx() });
    assert.equal(typeof registry.registered.solicitudes.mount, 'function');
    assert.equal(typeof registry.registered.solicitudes.show, 'function');
});

// ---------------------------------------------------------------
// openFromApplication / openForMembership / openEditor
// ---------------------------------------------------------------
test('openFromApplication prepara el borrador, preselecciona, avisa y abre el editor', async () => {
    const h = contractsHarness();
    const pending = h.window.WeOtziStudioContracts.openFromApplication({ id: 'app1', artist_user_id: 'ar1' }, { id: 'sp1', title: 'Guest', kind: 'guest_spot' });
    await until(() => h.log.drawers.length === 1, 'drawer del editor');
    const drawer = h.log.drawers[0];
    assert.match(drawer.opts.title, /Borrador C-2026-0001 · v1/);
    same(drawer.labels(), ['Descartar borrador', 'Vista previa', 'Guardar borrador', 'Emitir y firmar']);
    drawer.close(null);
    const outcome = await pending;
    same({ ...outcome }, { contractId: 'c9', issued: false });
    same(h.calls.map(c => c[0]), ['prepareFromApplication', 'decideApplicationRpc', 'get']);
    same(h.calls[1], ['decideApplicationRpc', 'app1', 'accepted']);
    same(h.ctx.notified, [{ kind: 'spot_decision', application_id: 'app1', decision: 'accepted' }]);
});

test('openFromApplication sin la RPC rechaza con el código y no decide nada (el shell cae al flujo viejo)', async () => {
    for (const code of ['42883', 'PGRST202']) {
        const h = contractsHarness({ repo: { prepareFromApplication: async () => ({ data: null, error: { code, message: 'function not found' } }) } });
        await assert.rejects(h.window.WeOtziStudioContracts.openFromApplication({ id: 'app1' }, {}), err => err.code === code);
        assert.ok(!h.calls.some(c => c[0] === 'decideApplicationRpc'));
        assert.equal(h.ctx.notified.length, 0);
    }
    const noRepo = contractsHarness({ data: { StudioContracts: undefined } });
    await assert.rejects(noRepo.window.WeOtziStudioContracts.openFromApplication({ id: 'app1' }, {}), err => err.code === '42883');
});

test('openFromApplication propaga los errores reales con su mensaje', async () => {
    const h = contractsHarness({ repo: { prepareFromApplication: async () => ({ data: null, error: { code: '23514', message: 'La postulación fue rechazada o retirada.' } }) } });
    await assert.rejects(h.window.WeOtziStudioContracts.openFromApplication({ id: 'app1' }, {}), /rechazada o retirada/);
});

test('openForMembership abre el contrato vigente sin preparar otro', async () => {
    const h = contractsHarness({
        repo: {
            getCurrentForMembership: async id => ({ data: { id: 'c1', status: 'signed', membership_id: id }, error: null }),
            get: async id => ({ data: signedContract({ id }), error: null })
        }
    });
    const pending = h.window.WeOtziStudioContracts.openForMembership({ id: 'm1' });
    await until(() => h.log.drawers.length === 1, 'documento');
    assert.match(h.log.drawers[0].opts.title, /Contrato C-2026-0001 · v1/);
    h.log.drawers[0].close(null);
    same({ ...(await pending) }, { contractId: 'c1', issued: false });
    assert.ok(!h.calls.some(c => c[0] === 'prepareForMembership'));
});

test('openForMembership sin contrato vigente prepara el borrador; sin migración rechaza con 42883', async () => {
    const h = contractsHarness();
    const pending = h.window.WeOtziStudioContracts.openForMembership({ id: 'm7', role: 'resident', status: 'requested' });
    await until(() => h.log.drawers.length === 1, 'editor');
    h.log.drawers[0].close(null);
    await pending;
    same(h.calls.filter(c => c[0] !== 'get').map(c => c.slice(0, 2)), [['getCurrentForMembership', 'm7'], ['prepareForMembership', 'm7']]);

    const missing = contractsHarness({ repo: { getCurrentForMembership: async () => ({ data: null, error: null, unavailable: true }) } });
    await assert.rejects(missing.window.WeOtziStudioContracts.openForMembership({ id: 'm7' }), err => err.code === '42883');
});

// ---------------------------------------------------------------
// Borrador: validación y payload
// ---------------------------------------------------------------
test('validateDraft revisa rangos y, para emitir, la modalidad completa y el inicio', () => {
    const { api } = contractsHarness();
    assert.equal(api.validateDraft({ role: 'resident' }), null);
    assert.match(api.validateDraft({ role: 'manager' }), /rol válido/);
    assert.match(api.validateDraft({ compensation_model: 'percentage', artist_percentage: 120 }), /0 a 100/);
    assert.match(api.validateDraft({ compensation_model: 'fixed', fixed_amount: -1 }), /monto fijo/);
    assert.match(api.validateDraft({ compensation_model: 'fixed', fixed_currency: 'PESOS' }), /ISO de 3 letras/);
    assert.match(api.validateDraft({ start_date: '2026-11-10', end_date: '2026-11-01' }), /anterior al inicio/);
    assert.match(api.validateDraft({ cancellation_notice_days: 400 }), /0 a 365/);
    assert.match(api.validateDraft({ terms: 'x'.repeat(20001) }), /20000/);
    assert.match(api.validateDraft({ role: 'resident' }, { forIssue: true }), /Completá la modalidad de pago/);
    assert.match(api.validateDraft({ role: 'resident', compensation_model: 'percentage' }, { forIssue: true }), /porcentaje/);
    assert.match(api.validateDraft({ role: 'resident', compensation_model: 'mixed', artist_percentage: 50, fixed_amount: 10, fixed_currency: 'USD' }, { forIssue: true }), /periodicidad/);
    assert.match(api.validateDraft({ role: 'guest', compensation_model: 'percentage', artist_percentage: 50 }, { forIssue: true }), /fecha de inicio/);
    assert.match(api.validateDraft({ role: 'guest', compensation_model: 'percentage', artist_percentage: 50, start_date: '2026-11-01', expires_on: '2026-10-01' }, { forIssue: true, now: new Date(2026, 9, 30) }), /fecha futura/);
    assert.equal(api.validateDraft({
        role: 'guest', compensation_model: 'fixed', fixed_amount: '1500,50', fixed_currency: 'ars', fixed_period: 'monthly',
        fixed_payer: 'studio_to_artist', start_date: '2026-11-01', expires_on: '2026-11-13'
    }, { forIssue: true, now: new Date(2026, 9, 30) }), null);
});

test('draftPayload limpia lo que la modalidad no usa y normaliza listas, moneda y números', () => {
    const { api } = contractsHarness();
    const pct = api.draftPayload({ id: 'c9' }, {
        role: 'guest', location_id: '', compensation_model: 'percentage', artist_percentage: '62,5',
        fixed_amount: 100, fixed_currency: 'usd', fixed_period: 'monthly', fixed_payer: 'artist_to_studio',
        start_date: '2026-11-01', end_date: '', cancellation_notice_days: '15',
        includes: ['  Camilla  ', 'camilla', '', 'Luz'], perks: [], artist_obligations: ['x'.repeat(250)],
        house_rules: '  ', terms: ' Cláusula '
    });
    same(JSON.parse(JSON.stringify(pct)), {
        id: 'c9', role: 'guest', location_id: null, compensation_model: 'percentage', artist_percentage: 62.5,
        fixed_amount: null, fixed_currency: null, fixed_period: null, fixed_payer: null,
        start_date: '2026-11-01', end_date: null, cancellation_notice_days: 15,
        includes: ['Camilla', 'Luz'], perks: [], artist_obligations: ['x'.repeat(200)], house_rules: null, terms: 'Cláusula'
    });
    const fixed = api.draftPayload({ id: 'c9' }, { role: 'nope', compensation_model: 'fixed', artist_percentage: 50, fixed_amount: '200', fixed_currency: ' usd ', fixed_period: 'weekly', fixed_payer: 'studio_to_artist' });
    assert.equal(fixed.role, undefined, 'un rol inválido no se manda (se conserva el guardado)');
    assert.equal(fixed.artist_percentage, null);
    assert.equal(fixed.fixed_amount, 200);
    assert.equal(fixed.fixed_currency, 'USD');
    const mixed = api.draftPayload({}, { compensation_model: 'mixed', artist_percentage: 40, fixed_amount: 10 });
    assert.equal(mixed.id, undefined);
    assert.equal(mixed.artist_percentage, 40);
    assert.equal(mixed.fixed_amount, 10);
});

test('nueva versión: un firmado se reemplaza como manual sobre la membresía; un rechazado conserva origen y postulación', () => {
    const { api } = contractsHarness();
    const fromSigned = api.newVersionPayload(signedContract());
    assert.equal(fromSigned.supersedes_contract_id, 'c1');
    assert.equal(fromSigned.origin, 'manual');
    assert.equal(fromSigned.application_id, null);
    assert.equal(fromSigned.membership_id, 'm1');
    assert.equal(fromSigned.studio_id, 'st');
    assert.equal(fromSigned.artist_user_id, 'ar1');
    assert.equal(fromSigned.artist_percentage, 60);
    same([...fromSigned.includes], ['Camilla', 'Luz']);
    const fromDeclined = api.newVersionPayload(signedContract({ status: 'declined', membership_id: null }));
    assert.equal(fromDeclined.origin, 'spot_application');
    assert.equal(fromDeclined.application_id, 'app1');
    assert.equal(fromDeclined.membership_id, null);
});

test('acciones del documento según el estado', () => {
    const { api } = contractsHarness();
    same([...api.documentActionsFor({ status: 'sent' })], ['print', 'cancel']);
    same([...api.documentActionsFor({ status: 'signed' })], ['print', 'terminate', 'new_version']);
    for (const status of ['declined', 'cancelled', 'expired']) same([...api.documentActionsFor({ status })], ['print', 'new_version']);
    same([...api.documentActionsFor({ status: 'terminated' })], ['print']);
});

// ---------------------------------------------------------------
// Emitir y firmar
// ---------------------------------------------------------------
test('emitir pide el nombre del firmante, emite con el vencimiento y avisa contract_issued', async () => {
    const h = contractsHarness({ kitOptions: { prompt: 'Dueña Uno' } });
    const res = await h.api.issueContract(h.ctx, draftContract(), { expires_on: '2026-11-20' });
    assert.equal(res.status, 'sent');
    same(h.calls, [['issue', 'c9', 'Dueña Uno', new Date(2026, 10, 20, 23, 59, 59).toISOString()]]);
    same(h.ctx.notified, [{ kind: 'contract_issued', contract_id: 'c9' }]);
    const prompt = h.log.prompts[0];
    assert.equal(prompt.required, true);
    assert.equal(prompt.minLength, 3);
    assert.match(prompt.body, /Tinta Sur/);
    assert.match(prompt.body, /20\/11\/2026/);
    assert.equal(h.log.toasts[0][1], 'success');
});

test('emitir: cancelar el prompt no emite; sin vencimiento usa 14 días; si falla el email avisa sin revertir', async () => {
    const cancelled = contractsHarness({ kitOptions: { prompt: null } });
    assert.equal(await cancelled.api.issueContract(cancelled.ctx, draftContract(), {}), null);
    assert.equal(cancelled.calls.length, 0);

    const noMail = contractsHarness({ kitOptions: { prompt: 'Dueña Uno' }, ctx: fakeCtx({ notify: async () => ({ ok: false, error: new Error('smtp') }) }) });
    const now = new Date(2026, 9, 30, 10, 0);
    await noMail.api.issueContract(noMail.ctx, draftContract(), {}, { now });
    assert.equal(noMail.calls[0][3], noMail.api.endOfDayIso(noMail.api.addDaysYmd(14, now)));
    assert.equal(noMail.api.addDaysYmd(14, now), '2026-11-13');
    assert.equal(noMail.log.toasts[0][1], 'warning');
    assert.match(noMail.log.toasts[0][0], /No pudimos enviarle el email/);
});

test('un error de la RPC de emisión sube con su mensaje (el drawer lo muestra)', async () => {
    const h = contractsHarness({
        kitOptions: { prompt: 'Dueña Uno' },
        repo: { issue: async () => ({ data: null, error: { code: '42501', message: 'Solo el dueño del estudio puede emitir y firmar el contrato.' } }) }
    });
    await assert.rejects(h.api.issueContract(h.ctx, draftContract(), {}), /Solo el dueño/);
    assert.equal(h.ctx.notified.length, 0);
});

// Formulario falso del editor: readForm del kit real lee `elements` (selects,
// números, fechas, textareas y los radios de modalidad y de quién paga).
function fakeEditorForm(initial) {
    const values = Object.assign({}, initial);
    const TYPES = {
        role: 'select-one', location_id: 'select-one', artist_percentage: 'number', fixed_amount: 'number',
        fixed_currency: 'select-one', fixed_period: 'select-one', start_date: 'date', end_date: 'date',
        cancellation_notice_days: 'number', house_rules: 'textarea', terms: 'textarea', expires_on: 'date'
    };
    const RADIOS = { compensation_model: ['percentage', 'fixed', 'mixed'], fixed_payer: ['artist_to_studio', 'studio_to_artist'] };
    const field = (name, type, value, checked) => ({
        name, type, value: value == null ? '' : String(value), checked: !!checked, disabled: false,
        tagName: type.startsWith('select') ? 'SELECT' : type === 'textarea' ? 'TEXTAREA' : 'INPUT', getAttribute: () => null
    });
    return {
        set(name, value) { values[name] = value; },
        get elements() {
            const out = Object.keys(TYPES).map(name => field(name, TYPES[name], values[name]));
            Object.keys(RADIOS).forEach(name => RADIOS[name].forEach(v => out.push(field(name, 'radio', v, values[name] === v))));
            return out;
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {}
    };
}

test('editor: emitir valida en el drawer; guardar manda la lista blanca; emitir guarda, emite, avisa y refresca', async () => {
    let h;
    const form = fakeEditorForm({ role: 'guest', location_id: 'loc1', start_date: '2026-11-01', house_rules: ' Puntualidad ', terms: '' });
    h = contractsHarness({
        kitOptions: { prompt: 'Dueña Uno', drawerBody: () => ({ querySelector: sel => (sel === '[data-stc-editor]' ? form : null) }) },
        repo: { get: async id => ({ data: draftContract({ id, compensation_model: null, artist_percentage: null }), error: null }) }
    });
    const pending = h.window.WeOtziStudioContracts.openEditor('c9');
    await until(() => h.log.drawers.length === 1, 'editor');
    const drawer = h.log.drawers[0];

    // Sin modalidad no se emite: el error queda en el drawer y no se toca nada.
    await drawer.click('Emitir y firmar');
    assert.match(drawer.errors[0], /Completá la modalidad de pago/);
    assert.ok(!h.calls.some(c => c[0] === 'saveDraft' || c[0] === 'issue'));

    form.set('compensation_model', 'percentage');
    form.set('artist_percentage', '65');
    form.set('fixed_amount', '999');
    form.set('expires_on', h.api.addDaysYmd(10));
    await drawer.click('Guardar borrador');
    const saved = h.calls.find(c => c[0] === 'saveDraft')[1];
    same(saved, {
        id: 'c9', role: 'guest', location_id: 'loc1', compensation_model: 'percentage', artist_percentage: 65,
        fixed_amount: null, fixed_currency: null, fixed_period: null, fixed_payer: null,
        start_date: '2026-11-01', end_date: null, cancellation_notice_days: null,
        includes: ['Camilla', 'Luz'], perks: ['Difusión'], artist_obligations: ['Higiene'], house_rules: 'Puntualidad', terms: null
    });
    assert.ok(!('expires_on' in saved), 'el vencimiento no viaja en el borrador');
    assert.equal(h.log.toasts.at(-1)[0], 'Borrador guardado.');

    await drawer.click('Emitir y firmar');
    same(await pending, { contractId: 'c9', issued: true });
    same(h.calls.filter(c => c[0] === 'issue'), [['issue', 'c9', 'Dueña Uno', h.api.endOfDayIso(h.api.addDaysYmd(10))]]);
    same(h.ctx.notified, [{ kind: 'contract_issued', contract_id: 'c9' }]);
    assert.equal(h.calls.filter(c => c[0] === 'saveDraft').length, 2, 'emitir guarda antes lo último del formulario');
    await tick();
    assert.equal(h.ctx.refreshed, 1);
});

test('editor: cancelar el nombre del firmante deja el drawer abierto y el borrador guardado', async () => {
    const form = fakeEditorForm({ role: 'resident', compensation_model: 'fixed', fixed_amount: '120000', fixed_currency: 'ARS', fixed_period: 'monthly', fixed_payer: 'artist_to_studio', start_date: '2026-11-01' });
    const h = contractsHarness({
        kitOptions: { prompt: null, drawerBody: () => ({ querySelector: sel => (sel === '[data-stc-editor]' ? form : null) }) }
    });
    const pending = h.window.WeOtziStudioContracts.openEditor('c9');
    await until(() => h.log.drawers.length === 1, 'editor');
    const res = await h.log.drawers[0].click('Emitir y firmar');
    assert.equal(res, false);
    const saved = h.calls.find(c => c[0] === 'saveDraft')[1];
    assert.equal(saved.fixed_payer, 'artist_to_studio');
    assert.equal(saved.artist_percentage, null);
    assert.ok(!h.calls.some(c => c[0] === 'issue'));
    h.log.drawers[0].close(null);
    same(await pending, { contractId: 'c9', issued: false });
    assert.equal(h.ctx.notified.length, 0);
});

// ---------------------------------------------------------------
// Documento: cancelar, rescindir, nueva versión
// ---------------------------------------------------------------
test('documento firmado: rescindir pide motivo, rescinde y avisa contract_terminated', async () => {
    const h = contractsHarness({
        kitOptions: { modal: { reason: 'Cierre del local', endMembership: false } },
        repo: { get: async id => ({ data: signedContract({ id }), error: null }) }
    });
    const pending = h.window.WeOtziStudioContracts.openEditor('c1');
    await until(() => h.log.drawers.length === 1, 'documento');
    const doc = h.log.drawers[0];
    same(doc.labels(), ['Rescindir', 'Imprimir', 'Nueva versión']);
    await doc.click('Rescindir');
    same(await pending, { contractId: 'c1', issued: false });
    same(h.calls.find(c => c[0] === 'terminate'), ['terminate', 'c1', 'Cierre del local', false]);
    same(h.ctx.notified, [{ kind: 'contract_terminated', contract_id: 'c1' }]);
    await tick();
    assert.equal(h.ctx.refreshed, 1);
});

test('documento enviado: cancelar con motivo vacío manda null', async () => {
    const h = contractsHarness({
        kitOptions: { prompt: '' },
        repo: { get: async id => ({ data: signedContract({ id, status: 'sent', artist_signer_name: null, artist_signed_at: null, expires_at: '2026-11-13T23:59:59Z' }), error: null }) }
    });
    const pending = h.window.WeOtziStudioContracts.openEditor('c1');
    await until(() => h.log.drawers.length === 1, 'documento');
    same(h.log.drawers[0].labels(), ['Cancelar contrato', 'Imprimir']);
    await h.log.drawers[0].click('Cancelar contrato');
    await pending;
    same(h.calls.find(c => c[0] === 'cancel'), ['cancel', 'c1', null]);
    assert.equal(h.log.prompts[0].tone, 'danger');
});

test('nueva versión crea el borrador con supersedes_contract_id y abre el editor', async () => {
    const h = contractsHarness({
        repo: {
            get: async id => ({ data: id === 'c1' ? signedContract() : draftContract({ id, version: 2, supersedes_contract_id: 'c1' }), error: null }),
            saveDraft: async obj => { h.calls.push(['saveDraft', obj]); return { data: 'c2', error: null }; }
        }
    });
    const pending = h.window.WeOtziStudioContracts.openEditor('c1');
    await until(() => h.log.drawers.length === 1, 'documento');
    await h.log.drawers[0].click('Nueva versión');
    await until(() => h.log.drawers.length === 2, 'editor de la nueva versión');
    assert.match(h.log.drawers[1].opts.title, /Borrador C-2026-0001 · v2/);
    h.log.drawers[1].close(null);
    same(await pending, { contractId: 'c2', issued: false });
    const saved = h.calls.find(c => c[0] === 'saveDraft')[1];
    assert.equal(saved.supersedes_contract_id, 'c1');
    assert.equal(saved.origin, 'manual');
    assert.ok(!('id' in saved), 'la nueva versión es un alta');
});

test('nueva versión reusa un borrador que ya reemplaza al contrato', async () => {
    const h = contractsHarness({
        repo: {
            listForStudio: async (studioId, opts) => ({ data: opts && opts.status === 'draft' ? [{ id: 'c3', status: 'draft', supersedes_contract_id: 'c1' }] : [], error: null })
        }
    });
    const id = await h.api.createNewVersion(h.ctx, signedContract());
    assert.equal(id, 'c3');
    assert.ok(!h.calls.some(c => c[0] === 'saveDraft'));
});

// ---------------------------------------------------------------
// HTML del documento y del listado
// ---------------------------------------------------------------
test('el documento emitido usa el snapshot congelado, muestra firmas y hash y escapa todo', () => {
    const { api } = contractsHarness();
    const contract = signedContract({
        artist_percentage: 99,
        artists_db: { name: '<img src=x onerror=alert(1)>', username: 'anap' },
        terms_snapshot: {
            contract_number: 'C-2026-0001', version: 1, origin: 'spot_application', role: 'guest',
            studio: { name: 'Tinta Sur', slug: 'tinta-sur' }, artist: { name: 'Ana Pérez', username: 'anap', email: 'ana@example.com' },
            location: { label: 'Palermo', city: 'CABA', country: 'AR' }, spot: { title: 'Guest de verano', kind: 'guest_spot' },
            compensation: { model: 'mixed', artist_percentage: 55, fixed_amount: 150000, fixed_currency: 'ARS', fixed_period: 'monthly', fixed_payer: 'artist_to_studio' },
            start_date: '2026-11-01', end_date: '2026-12-31', cancellation_notice_days: 15,
            includes: ['Camilla'], perks: [], artist_obligations: ['Higiene'], house_rules: null, terms: 'Cláusula <script>alert(1)</script>',
            studio_signer_name: 'Dueña Uno', issued_at: '2026-10-30T12:00:00Z'
        }
    });
    const html = plain(api.contractDocumentHtml(contract, { studio: { name: 'Otro' } }));
    assert.match(html, /class="sk-print-doc stc-doc"/);
    assert.match(html, /55 %/);
    assert.doesNotMatch(html, /99 %/);
    assert.ok(html.includes(plain(kitReal.fmtMoney(150000, 'ARS'))));
    assert.match(html, /Alquiler de puesto: el artista paga al estudio/);
    assert.match(html, /por mes/);
    assert.match(html, /ana@example\.com/);
    assert.match(html, /Firmado/);
    assert.doesNotMatch(html, />signed</);
    assert.match(html, /a1b2c3d4e5/);
    assert.match(html, /Dueña Uno/);
    assert.match(html, /Del 01\/11\/2026 al 31\/12\/2026/);
    assert.match(html, /Guest spot/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<img/);
});

test('el borrador (y la vista previa) usan las columnas y avisan que no tienen validez', () => {
    const { api } = contractsHarness();
    const html = plain(api.contractDocumentHtml(draftContract({ compensation_model: 'percentage', artist_percentage: 70 }), { preview: true }));
    assert.match(html, /Vista previa del borrador/);
    assert.match(html, /70 %/);
    assert.match(html, /30 %/);
    assert.match(html, /La huella se genera al emitir/);
    assert.match(html, /Borrador/);
});

test('resúmenes de modalidad: porcentaje, fijo y mixto, siempre con la moneda', () => {
    const { api } = contractsHarness();
    assert.equal(plain(api.compensationSummary({ model: 'percentage', artistPercentage: 60 })), 'El artista se queda con el 60 % de cada tatuaje y el estudio con el 40 %.');
    assert.equal(plain(api.compensationSummary({ model: 'fixed', fixedAmount: 200, fixedCurrency: 'USD', fixedPeriod: 'weekly', fixedPayer: 'studio_to_artist' })),
        'Pago al artista: el estudio le paga ' + plain(kitReal.fmtMoney(200, 'USD')) + ' por semana.');
    assert.equal(plain(api.compensationShort({ model: 'mixed', artistPercentage: 50, fixedAmount: 1000, fixedCurrency: 'ARS', fixedPeriod: 'monthly', fixedPayer: 'artist_to_studio' })),
        '50 % artista + Alquiler de puesto ' + plain(kitReal.fmtMoney(1000, 'ARS')) + '/mes');
    assert.equal(api.compensationSummary({ model: null }), 'Modalidad de pago sin definir.');
    assert.equal(api.compensationShort({}), '—');
});

test('el editor arma el formulario con modalidad, listas, sede y vencimiento por defecto, escapando datos', () => {
    const { api } = contractsHarness();
    const html = api.editorHtml(draftContract({ house_rules: '</textarea><script>x</script>', artists_db: { name: 'Ana "La" Pérez', username: 'anap' } }), {
        studio: { name: 'Tinta Sur' }, locations: [{ id: 'loc1', label: 'Palermo', is_primary: true }, { id: 'loc2', label: '<b>Centro</b>' }]
    });
    for (const name of ['role', 'location_id', 'compensation_model', 'artist_percentage', 'fixed_amount', 'fixed_currency', 'fixed_period', 'fixed_payer', 'start_date', 'end_date', 'cancellation_notice_days', 'house_rules', 'terms', 'expires_on']) {
        assert.match(html, new RegExp('name="' + name + '"'), 'falta el campo ' + name);
    }
    for (const key of ['includes', 'perks', 'artist_obligations']) assert.match(html, new RegExp('data-list="' + key + '"'));
    assert.match(html, /value="mixed" checked/);
    assert.match(html, /value="loc1" selected/);
    assert.match(html, /Alquiler de puesto: el artista paga al estudio/);
    assert.match(html, /Pago al artista: el estudio paga/);
    assert.match(html, /name="expires_on"[^>]*value="\d{4}-\d{2}-\d{2}"/);
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, /<b>Centro/);
    assert.match(html, /Ana &quot;La&quot; Pérez/);
    assert.doesNotMatch(html, /value="manager"/);
});

test('listado: filtros por estado, búsqueda y tabla con estado en español', () => {
    const { api } = contractsHarness();
    const rows = [
        signedContract(),
        signedContract({ id: 'c2', contract_number: 'C-2026-0002', status: 'sent', artists_db: { name: 'Bruno', username: 'bru' } }),
        signedContract({ id: 'c3', contract_number: 'C-2026-0003', status: 'expired', artists_db: { name: 'Caro', username: 'caro' } })
    ];
    same(api.visibleContracts(rows, 'sent', '').map(c => c.id), ['c2']);
    same(api.visibleContracts(rows, 'closed', '').map(c => c.id), ['c3']);
    same(api.visibleContracts(rows, 'all', '@caro').map(c => c.id), ['c3']);
    same(api.visibleContracts(rows, 'all', '0002').map(c => c.id), ['c2']);
    assert.equal(api.filterIdFor('expired'), 'closed');
    assert.equal(api.filterIdFor('sent'), 'sent');
    assert.equal(api.filterIdFor('bogus'), 'all');
    const html = plain(api.contractsTableHtml(rows));
    assert.match(html, /data-stc-open="c2"/);
    assert.match(html, /Pendiente de firma/);
    assert.match(html, /Vencido/);
    assert.doesNotMatch(html, />expired</);
});

test('estado de un enviado: avisa si vence pronto y marca el plazo pasado sin decir "vence hoy"', () => {
    const { api } = contractsHarness();
    const at = days => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(12, 0, 0, 0); return d.toISOString(); };
    const cell = days => plain(api.statusCellHtml({ status: 'sent', expires_at: at(days) }));
    assert.match(cell(-2), /Plazo vencido/);
    assert.doesNotMatch(cell(-2), /Vence hoy/);
    assert.match(cell(0), /Vence hoy/);
    assert.match(cell(2), /Vence en 2 días/);
    assert.doesNotMatch(cell(10), /stc-expiring/);
    assert.doesNotMatch(plain(api.statusCellHtml({ status: 'signed', expires_at: at(-2) })), /stc-expiring/);
    assert.match(cell(10), /Pendiente de firma/);
});

function fakeRoot() {
    const nodes = {};
    return {
        innerHTML: '',
        listeners: {},
        nodes,
        addEventListener(type, fn) { this.listeners[type] = fn; },
        querySelector(sel) {
            if (!nodes[sel]) nodes[sel] = { innerHTML: '', value: '', addEventListener() {} };
            return nodes[sel];
        }
    };
}

test('la pestaña vence los atrasados antes de listar, pinta y actualiza el badge', async () => {
    const h = contractsHarness({
        repo: {
            listForStudio: async (studioId, opts) => { h.calls.push(['listForStudio', studioId, opts]); return { data: [signedContract(), signedContract({ id: 'c2', status: 'sent' })], error: null }; }
        }
    });
    const root = fakeRoot();
    const def = h.registry.registered.contratos;
    def.mount(root, h.ctx);
    assert.match(root.innerHTML, /data-stc-list/);
    await def.show(root, h.ctx, {});
    same(h.calls.map(c => c[0]), ['expireOverdue', 'listForStudio']);
    assert.match(root.nodes['[data-stc-list]'].innerHTML, /C-2026-0001/);
    assert.match(root.nodes['[data-stc-filters]'].innerHTML, /Pendientes de firma/);
    same(h.ctx.badges, [['contratos', 1]]);
});

test('sin la migración la pestaña queda vacía con el aviso y sin badge', async () => {
    const h = contractsHarness({ repo: { listForStudio: async () => ({ data: [], error: null, unavailable: true }) } });
    const root = fakeRoot();
    h.registry.registered.contratos.mount(root, h.ctx);
    await h.registry.registered.contratos.show(root, h.ctx, {});
    assert.match(root.nodes['[data-stc-list]'].innerHTML, /falta aplicar una migración/);
    same(h.ctx.badges, []);
});

// ---------------------------------------------------------------
// Roster
// ---------------------------------------------------------------
function fakeRosterTable(rows) {
    const doc = {
        createElement(tag) {
            return {
                tagName: tag.toUpperCase(), attrs: {}, listeners: {},
                setAttribute(k, v) { this.attrs[k] = String(v); },
                getAttribute(k) { return this.attrs[k]; },
                addEventListener(type, fn) { this.listeners[type] = fn; }
            };
        }
    };
    const trs = rows.map(attrs => {
        const cell = {
            children: [],
            appendChild(child) { this.children.push(child); return child; },
            querySelector(sel) { return sel === 'button[data-contract-for]' ? (this.children.find(c => c.attrs['data-contract-for']) || null) : null; }
        };
        return {
            cell,
            getAttribute: k => (attrs[k] === undefined ? null : attrs[k]),
            querySelector: sel => (sel === '.studio-roster-actions' ? cell : null),
            lastElementChild: cell
        };
    });
    return { ownerDocument: doc, trs, querySelectorAll: sel => (sel === 'tr[data-membership-id]' ? trs : []) };
}

test('el roster suma "Contrato" en filas activas o pendientes que no son manager, sin duplicar', async () => {
    const h = contractsHarness();
    const members = [
        { id: 'm1', status: 'active', role: 'resident', current_contract_id: 'c1', artists_db: { name: 'Ana' } },
        { id: 'm2', status: 'pending_acceptance', role: 'guest', artists_db: { name: 'Bruno' } },
        { id: 'm3', status: 'active', role: 'manager', artists_db: { name: 'Caro' } },
        { id: 'm4', status: 'paused', role: 'itinerant', artists_db: { name: 'Dani' } }
    ];
    const table = fakeRosterTable(members.map(m => ({ 'data-membership-id': m.id, 'data-status': m.status, 'data-role': m.role })));
    h.registry.rosterListeners[0](table, members);
    h.registry.rosterListeners[0](table, members);
    const buttons = table.trs.map(tr => tr.cell.children.map(b => b.attrs['data-contract-for']));
    same(buttons, [['m1'], ['m2'], [], ['m4']]);
    const btn = table.trs[0].cell.children[0];
    assert.equal(btn.textContent, 'Contrato');
    assert.equal(btn.type, 'button');
    assert.match(btn.attrs['aria-label'], /Ver el contrato de Ana/);
    assert.equal(h.api.injectRosterButtons(null, members), 0);

    // El click abre el contrato vigente o prepara uno.
    btn.listeners.click();
    await until(() => h.log.drawers.length === 1, 'contrato desde el roster');
    same(h.calls[0], ['getCurrentForMembership', 'm1']);
    h.log.drawers[0].close(null);
});

// ---------------------------------------------------------------
// Solicitudes
// ---------------------------------------------------------------
function requestsHarness({ data = {}, kitOptions = {}, ctx, contractsApi } = {}) {
    const calls = [];
    const { kit, log } = fakeKit(kitOptions);
    const context = ctx || fakeCtx();
    const D = Object.assign({
        StudioMemberships: {
            listRequestsForStudio: async () => ({ data: [requestRow()], error: null }),
            listChangeRequestsForStudio: async () => ({ data: [changeRow()], error: null }),
            decideRequest: async (id, decision, opts) => { calls.push(['decideRequest', id, decision, opts]); return { data: { membership_id: id, status: decision === 'accept' ? 'active' : 'rejected' }, error: null }; },
            closeChangeRequest: async id => { calls.push(['closeChangeRequest', id]); return { data: [{ id, status: 'declined' }], error: null }; }
        },
        StudioSpots: {
            listArtistCounterOffersForStudio: async () => ({ data: [counterRow()], error: null }),
            respondCounterOffer: async (id, decision) => { calls.push(['respondCounterOffer', id, decision]); return { data: { id }, error: null }; }
        },
        StudioContracts: {
            prepareFromApplication: async id => { calls.push(['prepareFromApplication', id]); return { data: 'c5', error: null }; }
        },
        StudioLocations: { listActiveByStudio: async () => ({ data: [{ id: 'loc1', label: 'Palermo', is_primary: true }, { id: 'loc2', label: 'Centro' }], error: null }) }
    }, data);
    const api = contractsApi || {
        openForMembership: async m => { calls.push(['openForMembership', m]); return { contractId: 'c7', issued: true }; },
        openEditor: async id => { calls.push(['openEditor', id]); return { contractId: id, issued: false }; },
        openFromApplication: async () => ({ contractId: null, issued: false })
    };
    const loaded = load(requestsSource, REQUESTS_EXPOSED, { data: D, kit, ctx: context, extraWindow: { WeOtziStudioContracts: api } });
    return Object.assign(loaded, { calls, log, ctx: context, data: D });
}

function requestRow(extra = {}) {
    return Object.assign({
        id: 'm1', studio_id: 'st', artist_user_id: 'ar1', role: 'guest', status: 'requested', location_id: null,
        invited_at: '2026-10-28T10:00:00Z', initiated_by: 'artist',
        studio_membership_request_details: { message: 'Hola <b>equipo</b>', portfolio_url: 'https://ana.example/portfolio', proposed_start_date: '2026-11-15', styles: ['Blackwork', 'Fineline'] },
        artists_db: { user_id: 'ar1', name: 'Ana Pérez', username: 'anap', profile_picture: 'https://cdn.example/ana.jpg', styles: ['Otro'] }
    }, extra);
}
function changeRow(extra = {}) {
    return Object.assign({
        id: 'cr1', membership_id: 'm2', artist_user_id: 'ar2', message: 'Quiero 70 %', status: 'pending', created_at: '2026-10-29T10:00:00Z',
        studio_artist_memberships: { id: 'm2', studio_id: 'st', role: 'resident', status: 'pending_acceptance', location_id: 'loc1', revenue_split_pct: 60 },
        artists_db: { user_id: 'ar2', name: 'Bruno', username: 'bru' }
    }, extra);
}
function counterRow(extra = {}) {
    return Object.assign({
        id: 'o1', application_id: 'app1', author_role: 'artist', split_pct: 70, proposed_start_date: '2026-12-01', proposed_end_date: '2026-12-20',
        note: 'Puedo en diciembre', status: 'pending', created_at: '2026-10-29T10:00:00Z',
        studio_spot_applications: {
            id: 'app1', status: 'shortlisted', spot_id: 'sp1', artist_user_id: 'ar3',
            studio_spots: { id: 'sp1', title: 'Guest de verano', kind: 'guest_spot', studio_id: 'st' },
            artists_db: { user_id: 'ar3', name: 'Caro', username: 'caro' }
        }
    }, extra);
}

test('tarjeta de alta: datos del artista, estilos, mensaje y portfolio seguro, todo escapado', () => {
    const { api } = requestsHarness();
    const html = plain(api.requestCardHtml(requestRow()));
    assert.match(html, /Ana Pérez/);
    assert.match(html, /@anap/);
    assert.match(html, /Guest/);
    assert.match(html, /15\/11\/2026/);
    assert.match(html, /Blackwork/);
    assert.doesNotMatch(html, />Otro</, 'los estilos de la solicitud ganan a los del perfil');
    assert.match(html, /Hola &lt;b&gt;equipo&lt;\/b&gt;/);
    assert.match(html, /href="https:\/\/ana\.example\/portfolio" target="_blank" rel="noopener noreferrer"/);
    assert.match(html, /src="https:\/\/cdn\.example\/ana\.jpg"/);
    for (const action of ['approve', 'approve-contract', 'reject']) assert.match(html, new RegExp('data-sreq-action="' + action + '" data-id="m1"'));

    const hostile = plain(api.requestCardHtml(requestRow({
        artists_db: { name: '<img src=x onerror=alert(1)>', username: 'x', profile_picture: 'javascript:alert(1)' },
        studio_membership_request_details: { portfolio_url: 'javascript:alert(1)', message: null, styles: [] }
    })));
    assert.doesNotMatch(hostile, /<img src=x/);
    assert.doesNotMatch(hostile, /javascript:/);
    assert.doesNotMatch(hostile, /Ver portfolio/);
    assert.match(hostile, /sreq-avatar--initials/);
    assert.match(hostile, /No dejó mensaje/);
});

test('tarjetas de cambios y contraofertas muestran membresía, spot y propuesta en español', () => {
    const { api } = requestsHarness();
    const change = plain(api.changeCardHtml(changeRow()));
    assert.match(change, /Residente · Esperando aceptación/);
    assert.match(change, /60 % para el artista/);
    assert.match(change, /Quiero 70 %/);
    assert.match(change, /data-sreq-action="change-contract"/);
    assert.match(change, /data-sreq-action="change-close"/);
    const counter = plain(api.counterCardHtml(counterRow()));
    assert.match(counter, /Guest de verano · Guest spot/);
    assert.match(counter, /70 % para el artista/);
    assert.match(counter, /Del 01\/12\/2026 al 20\/12\/2026/);
    assert.match(counter, /Caro/);
    assert.match(counter, /data-sreq-action="counter-accept" data-id="o1"/);
});

test('aprobar decide con rol y sede y avisa membership_request_decision', async () => {
    const h = requestsHarness();
    const result = await h.api.approveRequest(h.ctx, requestRow(), { role: 'resident', locationId: 'loc2' });
    same(h.calls, [['decideRequest', 'm1', 'accept', { role: 'resident', locationId: 'loc2' }]]);
    same(h.ctx.notified, [{ kind: 'membership_request_decision', membership_id: 'm1' }]);
    assert.equal(result.notified, true);

    const failing = requestsHarness({ data: { StudioMemberships: { decideRequest: async () => ({ data: null, error: { code: '23514', message: 'Esta solicitud ya fue resuelta.' } }) } } });
    await assert.rejects(failing.api.approveRequest(failing.ctx, requestRow(), {}), /ya fue resuelta/);
    assert.equal(failing.ctx.notified.length, 0);
});

test('el modal de aprobación ofrece solo roles con contrato y preselecciona la sede principal', () => {
    const { api } = requestsHarness();
    const html = api.approveFormHtml(requestRow({ role: 'guest' }), [{ id: 'loc1', label: 'Palermo', is_primary: true }, { id: 'loc2', label: 'Centro' }], 'u1');
    assert.match(html, /value="guest" selected/);
    assert.doesNotMatch(html, /value="manager"/);
    assert.match(html, /value="loc1" selected/);
    const withLoc = api.approveFormHtml(requestRow({ location_id: 'loc2' }), [{ id: 'loc1', label: 'Palermo', is_primary: true }, { id: 'loc2', label: 'Centro' }], 'u2');
    assert.match(withLoc, /value="loc2" selected/);
});

test('rechazar pide confirmación (con el nombre escapado) y avisa', async () => {
    const no = requestsHarness({ kitOptions: { confirm: false } });
    assert.equal(await no.api.rejectRequest(no.ctx, requestRow()), null);
    assert.equal(no.calls.length, 0);

    const yes = requestsHarness();
    await yes.api.rejectRequest(yes.ctx, requestRow({ artists_db: { name: '<script>x</script>' } }));
    same(yes.calls.map(c => c.slice(0, 3)), [['decideRequest', 'm1', 'reject']]);
    same(yes.ctx.notified, [{ kind: 'membership_request_decision', membership_id: 'm1' }]);
    assert.equal(yes.log.confirms[0].tone, 'danger');
    assert.doesNotMatch(yes.log.confirms[0].body, /<script>/);
});

test('responder un cambio con contrato abre la membresía y cierra el pedido al emitir', async () => {
    const h = requestsHarness();
    const outcome = await h.api.respondChangeWithContract(h.ctx, changeRow());
    assert.equal(outcome.issued, true);
    const opened = h.calls.find(c => c[0] === 'openForMembership')[1];
    assert.equal(opened.id, 'm2');
    assert.equal(opened.status, 'pending_acceptance');
    assert.equal(opened.artists_db.name, 'Bruno');
    same(h.calls.find(c => c[0] === 'closeChangeRequest'), ['closeChangeRequest', 'cr1']);

    const notIssued = requestsHarness({ contractsApi: { openForMembership: async () => ({ contractId: 'c7', issued: false }) } });
    await notIssued.api.respondChangeWithContract(notIssued.ctx, changeRow());
    assert.ok(!notIssued.calls.some(c => c[0] === 'closeChangeRequest'));
});

test('cerrar un pedido de cambios usa closeChangeRequest y detecta si ya estaba cerrado', async () => {
    const h = requestsHarness();
    same(await h.api.closeChange(changeRow()), { closed: true });
    const already = requestsHarness({ data: { StudioMemberships: { closeChangeRequest: async () => ({ data: [], error: null }) } } });
    same(await already.api.closeChange(changeRow()), { closed: false });
});

test('aceptar una contraoferta responde, prepara el contrato y abre el editor', async () => {
    const h = requestsHarness();
    const result = await h.api.acceptCounterOffer(h.ctx, counterRow());
    same(h.calls, [['respondCounterOffer', 'o1', 'accept'], ['prepareFromApplication', 'app1'], ['openEditor', 'c5']]);
    same(result, { accepted: true, contractId: 'c5', issued: false });

    const missing = requestsHarness({ data: { StudioContracts: { prepareFromApplication: async () => ({ data: null, error: { code: '42883', message: 'nope' } }) } } });
    const res = await missing.api.acceptCounterOffer(missing.ctx, counterRow());
    same(res, { accepted: true, contractId: null, issued: false });
    assert.equal(missing.log.toasts.length, 0, 'sin la migración no hay aviso de error');

    const rejected = requestsHarness();
    await rejected.api.rejectCounterOffer(rejected.ctx, counterRow());
    same(rejected.calls, [['respondCounterOffer', 'o1', 'reject']]);
});

test('la pestaña carga las tres listas, pinta y deja el badge con el total pendiente', async () => {
    const h = requestsHarness();
    const root = fakeRoot();
    const def = h.registry.registered.solicitudes;
    def.mount(root, h.ctx);
    await def.show(root, h.ctx, {});
    const body = root.nodes['[data-sreq-body]'].innerHTML;
    assert.match(body, /role="tablist"/);
    assert.match(body, /aria-selected="true"[^>]*data-sreq-sub="altas"/);
    assert.match(body, /data-sreq-kind="alta"/);
    same(h.ctx.badges, [['solicitudes', 3]]);

    await def.show(root, h.ctx, { sub: 'contraofertas' });
    assert.match(root.nodes['[data-sreq-body]'].innerHTML, /data-sreq-kind="contraoferta"/);
});

test('sin la migración cada sub-pestaña queda vacía con el aviso; abre la primera con pendientes', async () => {
    const h = requestsHarness({
        data: {
            StudioMemberships: {
                listRequestsForStudio: async () => ({ data: [], error: null, unavailable: true }),
                listChangeRequestsForStudio: async () => ({ data: null, error: { code: 'PGRST205', message: 'missing' } })
            }
        }
    });
    const root = fakeRoot();
    const def = h.registry.registered.solicitudes;
    def.mount(root, h.ctx);
    await def.show(root, h.ctx, {});
    assert.equal(h.api.state.sub, 'contraofertas');
    same(h.ctx.badges, [['solicitudes', 1]]);
    assert.match(h.api.panelHtml('altas', h.api.state.lists.altas), /falta aplicar una migración/);
    assert.match(h.api.panelHtml('cambios', h.api.state.lists.cambios), /falta aplicar una migración/);
    assert.equal(h.api.normalizeSub('counters'), 'contraofertas');
    assert.equal(h.api.normalizeSub('changes'), 'cambios');
    assert.equal(h.api.normalizeSub('x'), null);
    assert.equal(h.api.pendingCount({ altas: { rows: [{ status: 'requested' }, { status: 'active' }] }, cambios: { rows: [] }, contraofertas: { rows: [{ status: 'pending' }] } }), 2);
});

test('acción "Aprobar": el modal lee rol y sede, decide, avisa, recarga las listas y refresca el shell', async () => {
    let listed = 0;
    const h = requestsHarness({
        kitOptions: {
            // Simula el click en "Aprobar" del modal con otro rol y otra sede.
            modal: opts => {
                const approve = opts.actions.find(a => a.label === 'Aprobar');
                const fields = { '[data-sreq-role]': { value: 'itinerant' }, '[data-sreq-location]': { value: 'loc2' } };
                return approve.onClick({ body: { querySelector: sel => fields[sel] || null } });
            }
        }
    });
    const base = h.data.StudioMemberships.listRequestsForStudio;
    h.data.StudioMemberships.listRequestsForStudio = async id => { listed++; return base(id); };
    const root = fakeRoot();
    const def = h.registry.registered.solicitudes;
    def.mount(root, h.ctx);
    await def.show(root, h.ctx, {});
    assert.equal(listed, 1);
    assert.equal(h.log.modals.length, 0);

    await h.api.runAction(h.ctx, 'approve', 'm1');
    assert.match(h.log.modals[0].body, /value="guest" selected/, 'el modal arranca con el rol pedido');
    same(h.calls, [['decideRequest', 'm1', 'accept', { role: 'itinerant', locationId: 'loc2' }]]);
    same(h.ctx.notified, [{ kind: 'membership_request_decision', membership_id: 'm1' }]);
    same(h.log.toasts.at(-1), ['Solicitud aprobada: Ana Pérez ya está en tu roster.', 'success']);
    assert.equal(listed, 2, 'recarga las listas después de decidir');
    await tick();
    assert.equal(h.ctx.refreshed, 1);

    // Cancelar el modal no decide nada.
    const cancelled = requestsHarness({ kitOptions: { modal: null } });
    cancelled.registry.registered.solicitudes.mount(fakeRoot(), cancelled.ctx);
    await cancelled.registry.registered.solicitudes.show(fakeRoot(), cancelled.ctx, {});
    await cancelled.api.runAction(cancelled.ctx, 'approve', 'm1');
    assert.equal(cancelled.calls.length, 0);
    assert.equal(cancelled.ctx.notified.length, 0);
});

test('acciones con contrato: sin el módulo de contratos fallan con el aviso de migración y no deciden nada', async () => {
    const h = requestsHarness({ contractsApi: {} });
    h.registry.registered.solicitudes.mount(fakeRoot(), h.ctx);
    await h.registry.registered.solicitudes.show(fakeRoot(), h.ctx, {});
    await assert.rejects(h.api.runAction(h.ctx, 'approve-contract', 'm1'), /falta aplicar una migración/);
    await assert.rejects(h.api.runAction(h.ctx, 'change-contract', 'cr1'), /falta aplicar una migración/);
    assert.equal(h.calls.length, 0);

    // Con el módulo: "Aprobar con contrato" abre la membresía de la solicitud.
    const ok = requestsHarness();
    ok.registry.registered.solicitudes.mount(fakeRoot(), ok.ctx);
    await ok.registry.registered.solicitudes.show(fakeRoot(), ok.ctx, {});
    await ok.api.runAction(ok.ctx, 'approve-contract', 'm1');
    const opened = ok.calls.find(c => c[0] === 'openForMembership')[1];
    same({ id: opened.id, status: opened.status, initiated_by: opened.initiated_by, role: opened.role }, { id: 'm1', status: 'requested', initiated_by: 'artist', role: 'guest' });
    assert.ok(!ok.calls.some(c => c[0] === 'decideRequest'), 'la solicitud se aprueba recién cuando el artista firma');
    assert.match(ok.log.toasts.at(-1)[0], /queda aprobada cuando Ana Pérez lo firme/);
});

test('contraoferta aceptada: si el editor falla, se avisa una sola vez y la lista se recarga igual', async () => {
    const h = requestsHarness({
        contractsApi: { openEditor: async () => { throw new Error('No encontramos el contrato. Puede que se haya cancelado.'); } }
    });
    h.registry.registered.solicitudes.mount(fakeRoot(), h.ctx);
    await h.registry.registered.solicitudes.show(fakeRoot(), h.ctx, {});
    const result = await h.api.acceptCounterOffer(h.ctx, counterRow());
    assert.equal(result.accepted, true);
    assert.equal(result.contractId, 'c5');
    assert.match(result.warning, /no pudimos abrir el contrato \(No encontramos el contrato/);

    const run = requestsHarness({
        contractsApi: { openEditor: async () => { throw new Error('boom'); } }
    });
    run.registry.registered.solicitudes.mount(fakeRoot(), run.ctx);
    await run.registry.registered.solicitudes.show(fakeRoot(), run.ctx, {});
    await run.api.runAction(run.ctx, 'counter-accept', 'o1');
    same(run.log.toasts.map(t => t[1]), ['warning']);
    assert.match(run.log.toasts[0][0], /Lo encontrás en Contratos/);
    await tick();
    assert.equal(run.ctx.refreshed, 1);

    // Un error real al preparar el contrato también es un único warning.
    const prep = requestsHarness({ data: { StudioContracts: { prepareFromApplication: async () => ({ data: null, error: { code: '23514', message: 'La postulación fue retirada.' } }) } } });
    prep.registry.registered.solicitudes.mount(fakeRoot(), prep.ctx);
    await prep.registry.registered.solicitudes.show(fakeRoot(), prep.ctx, {});
    await prep.api.runAction(prep.ctx, 'counter-accept', 'o1');
    same(prep.log.toasts, [['Contraoferta aceptada, pero no pudimos preparar el contrato: La postulación fue retirada.', 'warning']]);
});

// ---------------------------------------------------------------
// Fuente y CSS
// ---------------------------------------------------------------
test('los módulos usan solo los repos (sin CRUD ad-hoc) y terminan en })();', () => {
    for (const source of [contractsSource, requestsSource]) {
        assert.doesNotMatch(source, /_supabase\.from|fetch\(\s*['"`][^'"`]*\/rest\/v1|\.rpc\(\s*['"]/);
        assert.match(source, /\}\)\(\);\s*$/);
    }
    assert.match(requestsSource, /safeUrl\(d\.portfolio_url\)/);
    assert.match(requestsSource, /safeUrl\(a\.profile_picture\)/);
    assert.match(contractsSource, /kind: 'contract_issued', contract_id/);
    assert.match(contractsSource, /kind: 'contract_terminated', contract_id/);
    assert.match(requestsSource, /kind: 'membership_request_decision', membership_id/);
});

test('studio-contracts.css: prefijos propios, impresión y responsive', () => {
    assert.match(css, /@media print/);
    assert.match(css, /@media \(max-width: 600px\)/);
    assert.match(css, /prefers-reduced-motion/);
    assert.doesNotMatch(css, /\.sc-[a-z]/, 'sc- es del chat de soporte');
    assert.doesNotMatch(css, /border-radius:\s*[1-9]/);
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const heads = [...body.matchAll(/([^{};]+)\{/g)].map(m => m[1].trim()).filter(h => h && !h.startsWith('@') && !/^(from|to|\d+%)$/.test(h));
    for (const head of heads) {
        for (const selector of head.split(',').map(s => s.trim()).filter(Boolean)) {
            assert.match(selector, /\.(stc|sreq)-/, 'selector sin prefijo propio: ' + selector);
        }
    }
});
