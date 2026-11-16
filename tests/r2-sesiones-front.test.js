'use strict';

// Ronda 2 · frente "sesiones" (P28, P27-sesión) — navegador.
// Los módulos nuevos se cargan en un contexto aislado (vm) con un window falso;
// el resto son contratos de HTML/JS leyendo archivos, como el resto de la suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const Model = require('../public/shared/js/wo-session-model.js');

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const iso = (days) => new Date(NOW + days * DAY).toISOString();
const ATTACK = '"><img src=x onerror=alert(1)><script>alert(2)</script>';
const FULL_ADDRESS = 'Estudio X - Av. Corrientes 2151, Buenos Aires, Argentina';

/** Contexto de navegador mínimo con los módulos pedidos ya cargados. */
function browser(files, extra = {}) {
    const listeners = {};
    const document = {
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        querySelector: () => null,
        getElementById: () => null,
        createElement: () => ({ setAttribute() {}, appendChild() {}, classList: { toggle() {}, add() {}, remove() {} } }),
        body: { appendChild() {} },
        head: { appendChild() {} },
    };
    const window = Object.assign({
        WoSessionModel: Model,
        WeotziData: {},
        location: { pathname: '/my-quotations/detail', search: '', origin: 'https://beta.weotzi.com' },
        setTimeout, clearTimeout,
    }, extra.window || {});
    window.window = window;
    window.document = document;
    const context = vm.createContext({ window, document, console, URLSearchParams, setTimeout, clearTimeout, fetch: extra.fetch });
    for (const file of files) vm.runInContext(read(file), context, { filename: file });
    return { window, document, listeners };
}

const UI_FILES = ['public/shared/js/wo-session-ui.js'];

function serverView(extra) {
    return Object.assign({
        id: 's-1', quotation_id: 9, session_number: 1, session_date: iso(10), duration_hours: 3, status: 'scheduled', phase: 'upcoming',
        location: FULL_ADDRESS, maps_url: Model.mapsUrl(FULL_ADDRESS), client_confirmation: 'pending',
        badge: { key: 'pending', label: 'Espera confirmación', tone: 'warning' },
        request: null, last_request: null, feedback: { mine: null, other: null }, dispute: null,
        can: { confirm: false, request_change: false, edit_direct: true, respond: false, withdraw: false, dispute: false, rate: false },
        locked: null,
    }, extra || {});
}

// ───────────────────────────────────────────────────────────── selector de ubicación
test('P27: selector de ubicación — opciones agrupadas, valor guardado, dirección libre y escape', () => {
    const { window } = browser(UI_FILES);
    const UI = window.WoSessionUI;
    const options = [
        { key: 'client:1', kind: 'client', ref: 'a2222222-2222-4222-8222-222222222222', location: 'Estudio X · Centro - Av. Corrientes 2151, Buenos Aires, Argentina', place_id: 'ChIJ_centro_place', group: 'Elegida por el cliente' },
        { key: 'studio:2', kind: 'studio', ref: 'b2222222-2222-4222-8222-222222222222', location: `Sede ${ATTACK}`, group: 'Mis estudios' },
    ];
    // Turno nuevo: arranca con la primera opción (la que eligió el cliente).
    const fresh = UI.locationFieldHtml({ id: 'loc', options });
    assert.match(fresh, /<optgroup label="Elegida por el cliente"><option value="client:1"[^>]* selected>/);
    assert.match(fresh, /data-kind="client" data-ref="a2222222-2222-4222-8222-222222222222" data-place="ChIJ_centro_place"/);
    assert.match(fresh, /<option value="__custom">Otra dirección…<\/option>/);
    assert.match(fresh, /<label class="wo-label" for="loc">Ubicación<\/label>/);
    assert.match(fresh, /<label class="wo-label" for="loc-custom">Dirección<\/label>/);
    assert.match(fresh, /data-ws-loc-custom hidden/);
    assert.match(fresh, /data-ws-loc-preview aria-live="polite">Estudio X · Centro - Av\. Corrientes 2151/);
    assert.doesNotMatch(fresh, /<img src=x|<script>alert/, 'el nombre de una sede sale escapado');
    assert.match(fresh, /Sede &quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/);

    // Sesión con dirección guardada que es una de sus sedes → esa opción.
    const saved = UI.locationFieldHtml({ options, value: { location: 'estudio x · centro - av. corrientes 2151, buenos aires, argentina' } });
    assert.match(saved, /<option value="client:1"[^>]* selected>/);
    // Dirección guardada que no es una sede → "Otra dirección" con el texto (escapado).
    const custom = UI.locationFieldHtml({ options, value: { location: `Calle 9 ${ATTACK}`, location_place_id: 'ChIJ_guardado_1' } });
    assert.match(custom, /<option value="__custom" selected>/);
    assert.match(custom, /data-ws-loc-custom>/);
    assert.match(custom, /value="Calle 9 &quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;&lt;script&gt;alert\(2\)&lt;\/script&gt;" data-ws-loc-input/);
    assert.match(custom, /data-initial-place="ChIJ_guardado_1"/);
    // Editar una sesión sin lugar: no se le inventa uno.
    const empty = UI.locationFieldHtml({ options, allowEmpty: true, preferEmpty: true });
    assert.match(empty, /<option value="" selected>Sin definir todavía<\/option>/);
    assert.doesNotMatch(empty, /<option value="client:1"[^>]* selected>/);
    // Sin ubicaciones cargadas queda el campo libre con autocompletar.
    const none = UI.locationFieldHtml({ options: [] });
    assert.match(none, /<option value="__custom" selected>/);
    assert.match(none, /maxlength="300" autocomplete="off"/);
});

test('interfaz: insignia, línea de lugar y resumen escapan todo dato de usuario', () => {
    const { window } = browser(UI_FILES);
    const UI = window.WoSessionUI;
    assert.equal(UI.esc(ATTACK), '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;alert(2)&lt;/script&gt;');
    assert.equal(UI.badgeHtml({ label: 'Por confirmar', tone: 'warning' }), '<span class="ws-badge ws-badge--warning">Por confirmar</span>');
    assert.equal(UI.badgeHtml(null), '');
    const line = UI.locationLineHtml({ location: `Av. 1 ${ATTACK}`, maps_url: Model.mapsUrl(`Av. 1 ${ATTACK}`) });
    assert.doesNotMatch(line, /<img|<script/);
    assert.match(line, /<a href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=[^"]+" target="_blank" rel="noopener noreferrer">Ver en Google Maps<\/a>/);
    assert.match(UI.locationLineHtml({ location: '' }), /Lugar por definir/);
    const summary = UI.sessionSummaryHtml({ session_date: iso(5), duration_hours: 2.5, location: `<b>${FULL_ADDRESS}</b>` });
    assert.match(summary, /<dt>Duración<\/dt><dd>2 h 30 min<\/dd>/);
    assert.match(summary, /&lt;b&gt;Estudio X/);
    assert.doesNotMatch(UI.feedbackBlockHtml('Registro', { rating: 4, note: ATTACK }), /<img|<script/);
    assert.equal(UI.feedbackBlockHtml('Registro', null), '');
    assert.equal(typeof UI.changeDialog, 'function');
    assert.equal(typeof UI.respondDialog, 'function');
    assert.equal(typeof UI.feedbackDialog, 'function');
    assert.equal(typeof UI.disputeDialog, 'function');
});

// ───────────────────────────────────────────────────────────── expediente del artista
async function flowWith(sessions, { hasClient = true, fail = null } = {}) {
    const calls = [];
    const repo = {
        isUnavailable: (error) => !!error && error.code === 'sessions_unavailable',
        forQuote: async (quoteId) => {
            calls.push(quoteId);
            if (fail) throw fail;
            return { role: 'artist', quote: { quote_id: quoteId, has_client_account: hasClient, counterpart_name: 'Lucía Fernández' }, sessions };
        },
    };
    const env = browser(['public/shared/js/wo-session-ui.js', 'public/shared/js/wo-session-flow.js'], { window: { WeotziData: { SessionFlow: repo } } });
    const flow = env.window.WoSessionFlow;
    let painted = 0;
    const rows = sessions.map((s) => ({ id: s.id, status: s.status, session_date: s.session_date, updated_at: 'u1', client_confirmation: s.client_confirmation }));
    flow.ensure({ quote_id: 'QN1' }, rows, () => { painted += 1; });
    flow.ensure({ quote_id: 'QN1' }, rows, () => { painted += 1; }); // misma firma: no vuelve a pedir
    await new Promise((resolve) => setImmediate(resolve));
    return { flow, calls, painted: () => painted, rows, env };
}

test('P28: la fila del expediente muestra el estado frente al cliente y las acciones que corresponden', async () => {
    const pending = serverView();
    const confirmed = serverView({ id: 's-2', client_confirmation: 'confirmed', badge: { key: 'confirmed', label: 'Confirmada', tone: 'success' }, can: { request_change: true, dispute: true } });
    const asked = serverView({
        id: 's-3', client_confirmation: 'change_requested', badge: { key: 'change_requested', label: 'El cliente pidió un cambio', tone: 'warning' },
        request: { id: 'r-1', mine: false, requested_by_role: 'client', proposed_date: iso(12), note: ATTACK },
        can: { edit_direct: true, respond: true, dispute: true },
    });
    const locked = serverView({ id: 's-4', client_confirmation: 'confirmed', session_date: iso(2), badge: { key: 'confirmed', label: 'Confirmada', tone: 'success' }, can: { dispute: true }, locked: 'window' });
    const past = serverView({
        id: 's-5', phase: 'done', status: 'completed', client_confirmation: 'confirmed', session_date: iso(-3), locked: 'past',
        can: { rate: true, dispute: true }, feedback: { mine: null, other: { rating: 5, note: 'Genial' } },
    });
    const { flow, calls, painted } = await flowWith([pending, confirmed, asked, locked, past]);
    assert.deepEqual(calls, ['QN1'], 'una sola consulta por cambio de estado');
    assert.equal(painted(), 1, 'se repinta la sección cuando llega el estado');
    assert.equal(flow.available(), true);

    const a = flow.rowExtras({ id: 's-1' }, { hasReschedule: false });
    assert.match(a.badgeHtml, /ws-badge--warning">Espera confirmación</);
    assert.match(a.actionsHtml, /data-action="session-reschedule" data-session-id="s-1">Editar propuesta</);
    assert.equal(a.hideReschedule, false);
    assert.match(a.placeHtml, /Estudio X - Av\. Corrientes 2151, Buenos Aires, Argentina/);
    assert.doesNotMatch(flow.rowExtras({ id: 's-1' }, { hasReschedule: true }).actionsHtml, /Editar propuesta/, 'sin duplicar "Reprogramar"');

    const b = flow.rowExtras({ id: 's-2' }, { hasReschedule: true });
    assert.equal(b.hideReschedule, true, 'confirmada: la fecha no se cambia directo');
    assert.match(b.actionsHtml, /data-ws-action="change" data-ws-id="s-2">Pedir cambio</);
    assert.doesNotMatch(b.actionsHtml, /Pedir disputa/, 'sin ruido mientras se puede acordar');

    const c = flow.rowExtras({ id: 's-3' }, {});
    assert.match(c.actionsHtml, /data-ws-action="respond" data-ws-id="s-3">Responder pedido</);
    assert.match(c.notesHtml, /<strong>Lucía Fernández pidió:<\/strong> Nueva fecha: /);
    assert.doesNotMatch(c.notesHtml, /<img|<script/, 'el motivo del cliente sale escapado');

    const d = flow.rowExtras({ id: 's-4' }, { hasReschedule: true });
    assert.equal(d.hideReschedule, true);
    assert.match(d.notesHtml, /Faltan menos de 3 días/);
    assert.match(d.actionsHtml, /data-ws-action="dispute" data-ws-id="s-4">Pedir disputa</);
    assert.doesNotMatch(d.actionsHtml, /Pedir cambio/);

    const e = flow.rowExtras({ id: 's-5' }, {});
    assert.match(e.actionsHtml, /data-ws-action="rate" data-ws-id="s-5">Calificar y registrar</);
    assert.match(e.actionsHtml, /Pedir disputa/);
    assert.match(e.notesHtml, /Lucía Fernández: ★★★★★/);
    assert.equal(e.badgeHtml, '', 'una sesión realizada conserva solo su insignia del Figma');
    assert.equal(e.hideReschedule, true, 'pasada: no se reprograma');

    assert.equal(flow.rowExtras({ id: 'desconocida' }, {}), null);
    assert.equal(flow.rowExtras(null, {}), null);
});

test('compatibilidad: sin cuenta de cliente o sin rutas de sesiones el expediente queda como antes', async () => {
    const manual = await flowWith([serverView({ can: { edit_direct: true } })], { hasClient: false });
    const extras = manual.flow.rowExtras({ id: 's-1' }, { hasReschedule: false });
    assert.equal(extras.badgeHtml, '');
    assert.equal(extras.hideReschedule, false);
    assert.doesNotMatch(extras.actionsHtml, /Editar propuesta|Pedir cambio/);

    const old = await flowWith([serverView()], { fail: Object.assign(new Error('503'), { code: 'sessions_unavailable', status: 503 }) });
    assert.equal(old.flow.available(), false);
    assert.equal(old.flow.rowExtras({ id: 's-1' }, {}), null);
    old.flow.ensure({ quote_id: 'QN1' }, old.rows.concat([{ id: 'otra' }]), () => {});
    assert.deepEqual(old.calls, ['QN1'], 'no insiste contra un servidor sin la función');
});

test('reglas de la base explicadas en el front y columnas de ubicación', async () => {
    const { flow } = await flowWith([serverView()]);
    const dbError = (code, message) => Object.assign(new Error(`[sessions.update] ${message}`), { code, cause: { code, message } });
    assert.equal(flow.needsAgreement(dbError('WOS01', 'SESSION_NEEDS_AGREEMENT')), true);
    assert.equal(flow.needsAgreement(dbError('23P01', 'CALENDAR_OVERLAP')), false);
    assert.match(flow.explain(dbError('WOS01', 'SESSION_NEEDS_AGREEMENT')), /ya confirmó esta sesión/);
    assert.match(flow.explain(dbError('WOS02', 'SESSION_PAST')), /ya pasó/);
    assert.match(flow.explain(dbError('WOS03', 'SESSION_DELETE_BLOCKED')), /no se borra/);
    assert.equal(flow.explain(dbError('23P01', 'CALENDAR_OVERLAP')), '');
    assert.equal(flow.explain(Object.assign(new Error('x'), { userMessage: 'Faltan menos de 3 días.' })), 'Faltan menos de 3 días.');
    assert.deepEqual({ ...flow.locationPatch({ location: ` ${FULL_ADDRESS} `, location_kind: 'studio', location_ref: 'b2222222-2222-4222-8222-222222222222' }) },
        { location: FULL_ADDRESS, location_kind: 'studio', location_ref: 'b2222222-2222-4222-8222-222222222222', location_place_id: null });
    assert.deepEqual({ ...flow.locationPatch(null) }, {});
    assert.deepEqual({ ...flow.locationPatch({ location: '   ' }) }, {});
    // El editor del calendario conserva #event-location (el resto del editor no cambia).
    const html = flow.calendarLocationHtml();
    assert.match(html, /<select id="event-location" name="event-location" data-ws-cal-select>/);
    assert.match(html, /<option value="__custom">Otra dirección…<\/option>/);
    assert.match(html, /<input id="event-location-custom" type="text" maxlength="300" autocomplete="off"\s+aria-label="Dirección de la sesión"/);
    assert.equal(flow.readCalendarLocation(), null, 'sin el editor en pantalla no inventa una ubicación');
});

test('alta de sesión con ubicación: guarda el origen y degrada si la base no tiene las columnas', async () => {
    const created = [];
    let failFirst = true;
    const detail = {
        createSession: async (row) => {
            created.push(row);
            if (failFirst && 'location_kind' in row) {
                failFirst = false;
                throw Object.assign(new Error("[sessions.create] Could not find the 'location_kind' column of 'quotation_sessions' in the schema cache"), { code: 'PGRST204' });
            }
            return Object.assign({ id: 'nueva' }, row);
        },
    };
    const env = browser(['public/shared/js/wo-session-ui.js', 'public/shared/js/wo-session-flow.js'], { window: { WeotziData: { QuotationDetail: detail } } });
    const flow = env.window.WoSessionFlow;
    const row = { quotation_id: 9, session_date: iso(8), status: 'scheduled' };
    const long = `${FULL_ADDRESS} `.repeat(4).trim();
    const first = await flow.createSession(row, { location: long, location_kind: 'studio', location_ref: 'b2222222-2222-4222-8222-222222222222' });
    assert.equal(first.id, 'nueva');
    assert.equal(created[0].location_kind, 'studio');
    assert.deepEqual(Object.keys(created[1]).sort(), ['location', 'quotation_id', 'session_date', 'status']);
    assert.equal(created[1].location.length, 120, 'sin la migración respeta el límite anterior');
    const second = await flow.createSession(row, { location: FULL_ADDRESS, location_kind: 'custom', location_place_id: 'ChIJ_place_0001' });
    assert.equal(second.location, FULL_ADDRESS);
    assert.equal(second.location_place_id, 'ChIJ_place_0001');
    const bare = await flow.createSession(row, null);
    assert.equal('location' in bare, false, 'sin lugar elegido no escribe columnas de ubicación');
});

// ───────────────────────────────────────────────────────────── panel del cliente
test('P28: tarjeta del panel "Mis sesiones" del cliente según el estado', () => {
    const { window } = browser(['public/shared/js/wo-session-ui.js', 'public/shared/js/client-sessions.js']);
    const card = window.WoClientSessions._cardHtml;
    const quote = { quote_id: 'QN1', counterpart_name: 'Mateo Rivas', tattoo_body_part: 'Antebrazo' };

    const pending = card(serverView({ quote, badge: { label: 'Por confirmar', tone: 'warning' }, can: { confirm: true, request_change: true } }));
    assert.match(pending, /<article class="ws-card is-action" data-ws-session="s-1" tabindex="-1">/);
    assert.match(pending, /ws-badge--warning">Por confirmar</);
    assert.match(pending, /<button class="wo-btn wo-btn--s wo-btn--accent" type="button" data-ws-action="confirm" data-ws-id="s-1">Confirmar sesión<\/button>/);
    assert.match(pending, /data-ws-action="change" data-ws-id="s-1">Pedir otra fecha</);
    assert.match(pending, /Con Mateo Rivas · 3 h/);
    assert.match(pending, /Estudio X - Av\. Corrientes 2151, Buenos Aires, Argentina · <a href="https:\/\/www\.google\.com\/maps\//);
    assert.match(pending, /data-ws-action="quote" data-ws-id="s-1">Ver cotización</);
    assert.doesNotMatch(pending, /Pedir disputa/);

    const confirmed = card(serverView({ quote, client_confirmation: 'confirmed', badge: { label: 'Confirmada', tone: 'success' }, can: { request_change: true, dispute: true } }));
    assert.match(confirmed, /<article class="ws-card" /);
    assert.match(confirmed, /data-ws-action="change" data-ws-id="s-1">Pedir cambio</);
    assert.doesNotMatch(confirmed, /Confirmar sesión/);

    const asked = card(serverView({
        quote, client_confirmation: 'confirmed', badge: { label: 'Te pidieron un cambio', tone: 'warning' }, can: { respond: true, dispute: true },
        request: { id: 'r-1', mine: false, requested_by_role: 'artist', proposed_date: iso(12), proposed_location: `Otro ${ATTACK}`, note: 'Convención' },
    }));
    assert.match(asked, /data-ws-action="respond" data-ws-id="s-1">Responder pedido</);
    assert.match(asked, /<strong>Mateo Rivas pidió un cambio<\/strong>/);
    assert.doesNotMatch(asked, /<img|<script/);
    assert.doesNotMatch(asked, /data-ws-action="change"/);

    const mine = card(serverView({ quote, client_confirmation: 'change_requested', can: { confirm: true, withdraw: true, request_change: true }, request: { id: 'r-2', mine: true, requested_by_role: 'client', proposed_date: iso(12) } }));
    assert.match(mine, /Esperando la respuesta de Mateo Rivas\./);
    assert.match(mine, /data-ws-action="withdraw"/);

    const locked = card(serverView({ quote, client_confirmation: 'confirmed', session_date: iso(2), locked: 'window', can: { dispute: true }, badge: { label: 'Confirmada', tone: 'success' } }));
    assert.match(locked, /Faltan menos de 3 días/);
    assert.match(locked, /data-ws-action="dispute" data-ws-id="s-1">Pedir disputa a soporte</);

    const rejected = card(serverView({ quote, client_confirmation: 'confirmed', can: { request_change: true, dispute: true }, last_request: { status: 'rejected', mine: true, response_note: 'Ese día no atiendo' } }));
    assert.match(rejected, /Mateo Rivas no aceptó tu pedido de cambio\. “Ese día no atiendo”/);
    assert.match(rejected, /Pedir disputa a soporte/);

    const past = card(serverView({ quote, phase: 'done', status: 'completed', locked: 'past', can: { rate: true, dispute: true }, badge: { label: 'Realizada', tone: 'success' }, feedback: { mine: { rating: 4 }, other: null } }));
    assert.match(past, /data-ws-action="rate" data-ws-id="s-1">Ver mi registro</);
    assert.match(past, /Tu registro: ★★★★☆/);
    assert.doesNotMatch(past, /Faltan menos de 3 días/);

    const disputed = card(serverView({ quote, phase: 'done', status: 'completed', can: { rate: true }, dispute: { active: true, ticket_number: 12 } }));
    assert.match(disputed, /Disputa abierta · ticket N\.º 12/);
    assert.doesNotMatch(disputed, /data-ws-action="dispute"/);
});

// ───────────────────────────────────────────────────────────── repositorio
test('repositorio: todo pasa por el servidor con el Bearer del usuario', async () => {
    const calls = [];
    const fetch = async (url, options) => {
        calls.push({ url, options });
        return { ok: true, status: 200, json: async () => ({ success: true, sessions: [], options: [{ key: 'own:1' }], default_key: 'own:1' }) };
    };
    const env = browser(['public/shared/js/data/sessions-flow-repo.js'], {
        fetch,
        window: { WeotziData: { getClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'tok-1' } } }) } }) }, location: { pathname: '/beta/client/dashboard', search: '' } },
    });
    const repo = env.window.WeotziData.SessionFlow;
    await repo.mine();
    await repo.forQuote('QN 1/2');
    const locations = await repo.locations('QN1');
    await repo.confirm('s-1');
    await repo.requestChange('s-1', { proposed_date: iso(5) });
    await repo.respond('r-1', { decision: 'accept' });
    await repo.withdraw('r-1');
    await repo.feedback('s-1', { rating: 5 });
    await repo.dispute('s-1', { reason: 'otro', description: 'Texto suficiente.' });
    assert.deepEqual(calls.map((c) => `${c.options.method} ${c.url}`), [
        'GET /beta/api/sesiones/mine',
        'GET /beta/api/sesiones/quotations/QN%201%2F2',
        'GET /beta/api/sesiones/locations?quote=QN1',
        'POST /beta/api/sesiones/s-1/confirm',
        'POST /beta/api/sesiones/s-1/change-requests',
        'POST /beta/api/sesiones/change-requests/r-1/respond',
        'POST /beta/api/sesiones/change-requests/r-1/withdraw',
        'POST /beta/api/sesiones/s-1/feedback',
        'POST /beta/api/sesiones/s-1/dispute',
    ]);
    assert.ok(calls.every((c) => c.options.headers.Authorization === 'Bearer tok-1' && c.options.cache === 'no-store'));
    assert.equal(JSON.parse(calls[4].options.body).proposed_date, iso(5));
    assert.equal(locations.defaultKey, 'own:1');
    assert.equal(repo.isUnavailable({ status: 503 }), true);
    assert.equal(repo.isUnavailable({ code: 'sessions_unavailable', status: 400 }), true);
    assert.equal(repo.isUnavailable({ status: 404 }), true, 'servidor viejo sin las rutas');
    assert.equal(repo.isUnavailable({ status: 404, code: 'not_found' }), false);
    assert.equal(repo.isUnavailable({ status: 409, code: 'edit_window_closed' }), false);

    // El mensaje del servidor llega tal cual al usuario; sin sesión no se llama.
    const failing = browser(['public/shared/js/data/sessions-flow-repo.js'], {
        fetch: async () => ({ ok: false, status: 409, json: async () => ({ success: false, code: 'edit_window_closed', error: 'Faltan menos de 3 días.' }) }),
        window: { WeotziData: { getClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } }) } },
    });
    await assert.rejects(() => failing.window.WeotziData.SessionFlow.confirm('s-1'), (e) => e.userMessage === 'Faltan menos de 3 días.' && e.code === 'edit_window_closed' && e.status === 409);
    let fetched = 0;
    const anon = browser(['public/shared/js/data/sessions-flow-repo.js'], {
        fetch: async () => { fetched += 1; return { ok: true, status: 200, json: async () => ({ success: true }) }; },
        window: { WeotziData: { getClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) } },
    });
    await assert.rejects(() => anon.window.WeotziData.SessionFlow.mine(), (e) => e.status === 401);
    assert.equal(fetched, 0);
    // Vista previa (demo): sin servidor, se comporta como "no disponible".
    const preview = browser(['public/shared/js/data/sessions-flow-repo.js'], { fetch: async () => { fetched += 1; }, window: { WEOTZI_PREVIEW: true } });
    await assert.rejects(() => preview.window.WeotziData.SessionFlow.mine(), (e) => preview.window.WeotziData.SessionFlow.isUnavailable(e));
    assert.equal(fetched, 0);
});

// ───────────────────────────────────────────────────────────── contratos de página
function order(html, ...needles) {
    let last = -1;
    for (const needle of needles) {
        const at = html.indexOf(needle);
        assert.ok(at !== -1, `falta ${needle}`);
        assert.ok(at > last, `${needle} fuera de orden`);
        last = at;
    }
}

test('páginas: los módulos de sesiones se cargan antes del script que los usa', () => {
    const detail = read('public/my-quotations/detail/index.html');
    order(detail, '/shared/js/data/quotation-detail-repo.js', '/shared/js/wo-session-model.js', '/shared/js/data/sessions-flow-repo.js',
        '/shared/js/wo-session-ui.js', '/shared/js/wo-session-flow.js', '/shared/js/quotation-detail-figma.js');
    assert.match(detail, /<link rel="stylesheet" href="\/shared\/css\/wo-sessions\.css/);

    const calendar = read('public/calendar/index.html');
    order(calendar, '/shared/js/data/calendar-repo.js', '/shared/js/wo-session-model.js', '/shared/js/data/sessions-flow-repo.js',
        '/shared/js/wo-session-ui.js', '/shared/js/wo-session-flow.js', '/shared/js/calendar.js');
    assert.match(calendar, /<link rel="stylesheet" href="\/shared\/css\/wo-sessions\.css/);

    const client = read('public/client/dashboard/index.html');
    order(client, '/shared/js/data/postgrest-client.js', '/shared/js/wo-session-model.js', '/shared/js/data/sessions-flow-repo.js',
        '/shared/js/wo-session-ui.js', '/shared/js/client-sessions.js', '/shared/js/client-dashboard.js');
    assert.match(client, /<section class="client-sessions" id="mis-sesiones" aria-labelledby="ws-panel-title" hidden><\/section>/);
    assert.match(client, /<link rel="stylesheet" href="\/shared\/css\/wo-sessions\.css/);
    // El panel se monta con una línea y sin romper la página si el módulo falta.
    const dashboard = read('public/shared/js/client-dashboard.js');
    assert.equal((dashboard.match(/WoClientSessions/g) || []).length, 2);
    assert.match(dashboard, /if \(window\.WoClientSessions\) window\.WoClientSessions\.mount\(\{ onOpenQuote: viewQuotationDetail \}\);/);
});

test('expediente: diálogos de sesión con lugar, propuesta al cliente y avisos', () => {
    const js = read('public/shared/js/quotation-detail-figma.js');
    // Agendar: selector de lugar + alta con ubicación; sin el módulo, el alta de antes.
    assert.match(js, /\$\{flow \? '<div class="is-wide" data-ws-location-slot><\/div>' : ''\}/);
    assert.match(js, /\? await flow\.createSession\(row, place \? place\.read\(\) : null\)\s*\n\s*: await D\(\)\.QuotationDetail\.createSession\(row\);/);
    assert.match(js, /place = flow\.mountLocation\(overlay\.querySelector\('\[data-ws-location-slot\]'\), \{ quoteId: q\.quote_id \}\);/);
    assert.match(js, /como "por confirmar"\. El cliente recibe la propuesta y la confirma o te pide otra fecha\./);
    // Reprogramar: edición directa con las reglas explicadas; aviso al cliente.
    assert.match(js, /await flow\.updateSession\(session\.id, patch, placeChanged \? chosen : null\);/);
    assert.match(js, /noticeSession\('session_rescheduled', session\.id\);/);
    // Ausencia: ahora avisa al cliente (puede disputarla).
    assert.match(js, /updateSession\(session\.id, \{ status: 'no_show' \}\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*noticeSession\('session_no_show', session\.id\);/);
    // Fila: estado frente al cliente, dirección completa y acciones nuevas.
    assert.match(js, /const extra = flow && s \? flow\.rowExtras\(s, \{ hasReschedule: rowActions\.includes\('reschedule'\) \}\) : null;/);
    assert.match(js, /data-ws-session="\$\{esc\(s\.id\)\}"/);
    assert.match(js, /\$\{extra && extra\.placeHtml \? extra\.placeHtml : esc\(\(s && s\.location\) \|\| placeOf\(q\)\)\}/);
    assert.match(js, /if \(flow\) flow\.ensure\(q, v\.sessions, refreshSessionsSection\);/);
    // Sin el módulo (o en la vista simulada) todo sigue como antes.
    assert.match(js, /return flow && !state\.scenario && state\.quote \? flow : null;/);
    assert.match(read('public/shared/js/quotation-client-notices.js'), /'session_completed', 'session_no_show'\]/);
});

test('REQ-05 (P27): "Confirmar acuerdo y agendar" pide el lugar y la primera sesión nace con él', () => {
    const js = read('public/shared/js/quotation-detail-figma.js');
    const dialog = js.slice(js.indexOf('function showAgreementDialog(edit)'), js.indexOf('function syncAgreementExtras()'));
    assert.ok(dialog.length > 500, 'el diálogo del acuerdo');
    // El selector se pide solo al registrar el acuerdo (no al editarlo) y si el turno reservado no creó ya la sesión.
    assert.match(dialog, /const flow = sessionFlow\(\);\s*\n\s*const askPlace = !!flow && !edit && !holdSession;/);
    assert.match(dialog, /\$\{askPlace \? '<div class="is-wide" data-ws-location-slot><\/div>' : ''\}/);
    // Va entre "Primera sesión" y el comentario del acuerdo.
    const slot = dialog.indexOf('data-ws-location-slot></div>');
    assert.ok(dialog.indexOf("field('Primera sesión'") < slot && slot < dialog.indexOf("field('Comentario del acuerdo (opcional)'"));
    // Mismo selector que "Agendar": la opción por defecto es la sede que eligió el cliente.
    assert.match(dialog, /if \(askPlace\) place = flow\.mountLocation\(overlay\.querySelector\('\[data-ws-location-slot\]'\), \{ quoteId: q\.quote_id \}\);/);
    assert.match(dialog, /const chosen = askPlace && place \? place\.read\(\) : null;/);
    // La sesión se crea con location / location_kind (flow.createSession, probado arriba); sin el módulo, como antes.
    assert.match(dialog, /created = flow\s*\n\s*\? await flow\.createSession\(row, chosen\)\s*\n\s*: await D\(\)\.QuotationDetail\.createSession\(row\);/);
    assert.doesNotMatch(dialog, /createSession\(\{\s*\n\s*quotation_id: q\.id/, 'ya no hay un alta directa sin lugar');
    // Turno apartado: la sesión ya existe; el lugar se le suma ANTES del aviso y un rechazo no rompe el acuerdo.
    const update = dialog.indexOf('await flow.updateSession(slotBooking.session_id, {}, chosen);');
    assert.ok(update > 0);
    assert.ok(update > dialog.indexOf('await updateQuote(patch);'), 'después de guardar el acuerdo');
    assert.ok(update < dialog.indexOf('noticeAgreement();'), 'antes del aviso al cliente');
    assert.match(dialog, /try \{ await flow\.updateSession\(slotBooking\.session_id, \{\}, chosen\); \} catch \(error\) \{[\s\S]*?placePending = true;/);
    assert.match(dialog, /No pudimos guardar el lugar: elígelo desde la sesión\./);
});

test('calendario: la ubicación sale de las sedes reales y viaja con su origen', () => {
    const cal = read('public/shared/js/calendar.js');
    assert.match(cal, /if \(flow && typeof flow\.calendarLocationHtml === 'function'\) return flow\.calendarLocationHtml\(\);/);
    assert.match(cal, /<option value="Estudio propio">Estudio propio<\/option>/, 'sin el módulo queda la lista de antes');
    assert.match(cal, /location: locationChoice \? \(locationChoice\.location \|\| null\) : null,/);
    assert.match(cal, /location_meta: locationChoice && locationChoice\.location_kind \? locationChoice : null,/);
    assert.match(cal, /mountLocationOptions\(state\.editingEvent\?\.sourceType === 'quotation_session'\s*\n\s*\? \(state\.editingEvent\.raw\?\.session\?\.location \|\| ''\)/);
    assert.match(cal, /mountLocationOptions\(\); \/\/ ── sesiones ──/);
    // Sesión confirmada editada desde el calendario: se le pide el cambio al cliente.
    assert.match(cal, /if \(!flow \|\| typeof flow\.needsAgreement !== 'function' \|\| !flow\.needsAgreement\(error\)\) throw error;\s*\n\s*return flow\.requestCalendarChange\(event, payload\);/);
    assert.match(cal, /outcome && outcome\.requested/);
    assert.match(cal, /window\.WoSessionFlow\.explain\(error\)/);

    const repo = read('public/shared/js/data/calendar-repo.js');
    assert.match(repo, /if \(payload\.location && meta && meta\.location_kind\) \{\s*\n\s*patch\.location_kind = meta\.location_kind;\s*\n\s*patch\.location_ref = meta\.location_ref \|\| null;\s*\n\s*patch\.location_place_id = meta\.location_place_id \|\| null;/);
    assert.match(repo, /const SESSION_LOCATION_META = \['location_kind', 'location_ref', 'location_place_id'\];/);
    // Reusa el cargador de Google Maps del registro (address-picker + geocoder), sin clave propia.
    const ui = read('public/shared/js/wo-session-ui.js');
    assert.match(ui, /loadScript\('\/shared\/js\/geocoder\.js'\)/);
    assert.match(ui, /loadScript\('\/shared\/js\/address-picker\.js'\)/);
    assert.doesNotMatch(ui + read('public/shared/js/wo-session-flow.js'), /maps\.googleapis\.com|AIza/);
});

// EP-05: para la base, cambiar el lugar o la duración es una propuesta nueva (el cliente
// la vuelve a confirmar y su pedido de cambio pendiente queda reemplazado). El calendario
// solo avisaba cuando cambiaba el inicio.
test('calendario: cambiar solo el lugar o la duración de una sesión también le avisa al cliente', async () => {
    const cal = read('public/shared/js/calendar.js');
    const slice = (from, to) => {
        const start = cal.indexOf(from);
        const end = cal.indexOf(to, start);
        assert.ok(start >= 0 && end > start, `no encontré el bloque ${from.trim()}`);
        return cal.slice(start, end);
    };
    // El código real de guardado del calendario, con sus dependencias reemplazadas por dobles.
    const code = [
        slice('    function asDate(value) {', '    function formatMonthYear('),
        slice('    function sessionQuoteRef(event, payload) {', '    async function persistRemove('),
    ].join('\n');

    const START = '2026-12-01T15:00:00.000Z';
    const END = '2026-12-01T18:00:00.000Z';
    const event = (extra) => Object.assign({
        baseId: 's-1', sourceType: 'quotation_session', start: START, end: END, location: 'Estudio Norte - Oroño 500, Rosario',
        sessionStatus: 'scheduled', raw: { quotation: { quote_id: 'QN1' }, session: { id: 's-1' } },
    }, extra);
    const payload = (extra) => Object.assign({ starts_at: START, ends_at: END, location: 'Estudio Norte - Oroño 500, Rosario', notes: '' }, extra);

    async function save(ev, body, { updateError = null } = {}) {
        const out = { notices: [], updates: [], requested: [] };
        const window = {
            WeotziData: { Calendar: {
                updateQuoteSession: async (id, data, opts) => { if (updateError) throw updateError; out.updates.push([id, { rescheduled: opts.rescheduled }]); return { id }; },
                update: async () => ({}),
            } },
            QuotationClientNotices: { notifySession: async (quote, eventId, sessionId) => { out.notices.push([quote.quote_id, eventId, sessionId]); return { ok: true }; } },
            WoSessionFlow: {
                needsAgreement: (error) => !!error && error.code === 'needs_agreement',
                requestCalendarChange: async (e) => { out.requested.push(e.baseId); return { requested: true }; },
            },
        };
        const sandbox = { window, state: { user: { id: 'artista' } }, showToast() {} };
        vm.runInNewContext(code, sandbox);
        out.result = await sandbox.persistUpdate('session', ev, body);
        await new Promise((resolve) => setImmediate(resolve));
        return out;
    }

    // Solo el lugar → aviso con el estado que ya tiene la sesión (el servidor exige que coincidan).
    const place = await save(event(), payload({ location: 'Sede Centro - Córdoba 1200, Rosario' }));
    assert.deepEqual(place.notices, [['QN1', 'session_scheduled', 's-1']]);
    assert.deepEqual(place.updates, [['s-1', { rescheduled: false }]], 'la sesión no pasa a "reprogramada" si la fecha no cambió');
    // Solo la duración, en una sesión ya reprogramada.
    const longer = await save(event({ sessionStatus: 'rescheduled' }), payload({ ends_at: '2026-12-01T19:00:00.000Z' }));
    assert.deepEqual(longer.notices, [['QN1', 'session_rescheduled', 's-1']]);
    // Cambió el inicio (con o sin otro lugar): un solo aviso, el de siempre.
    const moved = await save(event(), payload({ starts_at: '2026-12-02T15:00:00.000Z', ends_at: '2026-12-02T18:00:00.000Z', location: 'Sede Centro' }));
    assert.deepEqual(moved.notices, [['QN1', 'session_rescheduled', 's-1']]);
    assert.deepEqual(moved.updates, [['s-1', { rescheduled: true }]]);

    // Sin cambios para el cliente: no se avisa.
    assert.deepEqual((await save(event(), payload({ notes: 'Traer referencia impresa' }))).notices, [], 'solo las notas privadas');
    assert.deepEqual((await save(event(), payload({ location: '  estudio norte - oroño 500, rosario ' }))).notices, [], 'el mismo lugar escrito distinto');
    assert.deepEqual((await save(event(), payload({ location: null }))).notices, [], 'sin lugar en el formulario no se cambia el guardado');
    assert.deepEqual((await save(event(), payload({ ends_at: undefined }))).notices, [], 'una fecha de fin ilegible no cuenta como cambio');
    assert.deepEqual((await save(event(), payload({ ends_at: null }))).notices, []);
    // Una sesión ya realizada (o ausente) conserva su estado y no avisa.
    for (const sessionStatus of ['completed', 'no_show', 'cancelled']) {
        assert.deepEqual((await save(event({ sessionStatus }), payload({ location: 'Sede Centro' }))).notices, [], sessionStatus);
    }
    // Sesión confirmada: la base pide acuerdo → sale el pedido de cambio, no este aviso.
    const agreed = await save(event(), payload({ location: 'Sede Centro' }), { updateError: Object.assign(new Error('P28'), { code: 'needs_agreement' }) });
    assert.deepEqual([agreed.notices, agreed.requested, agreed.result], [[], ['s-1'], { requested: true }]);
    await assert.rejects(() => save(event(), payload({ location: 'Sede Centro' }), { updateError: new Error('otro error') }), /otro error/);

    // La página carga la versión nueva del script.
    assert.match(read('public/calendar/index.html'), /\/shared\/js\/calendar\.js\?v=20261116-r2b"/);
});

// REQ-17 (P28): una sesión que el cliente todavía no confirmó no es un "turno confirmado".
// El correo al artista promete que "aparece como 'por confirmar' en tu calendario".
test('calendario: la sesión sin confirmar por el cliente se muestra y se cuenta "por confirmar"', () => {
    // 1) El repo marca la sesión con la misma regla que Google Calendar (lib/gcal-sync.js).
    const sandbox = { console: { error() {}, warn() {}, log() {} }, Date, Map, Set, Promise, Number, String, Object, RegExp, encodeURIComponent };
    sandbox.window = sandbox;
    sandbox.WeotziData = { run: async () => ({ data: [] }) };
    vm.runInNewContext(read('public/shared/js/data/calendar-repo.js'), sandbox, { filename: 'calendar-repo.js' });
    const { normalizeSession } = sandbox.WeotziData.Calendar._internal;
    const quotation = { id: 9, quote_id: 'QN1', client_full_name: 'Ana Ruiz' };
    const session = (extra) => Object.assign({ id: 's-1', quotation_id: 9, session_date: '2026-12-10T15:00:00.000Z', duration_hours: 2, status: 'scheduled' }, extra);

    const pending = normalizeSession(session({ client_confirmation: 'pending' }), quotation);
    assert.equal(pending.awaitingClient, true);
    assert.equal(pending.title, 'Sesión (por confirmar) — Ana Ruiz');
    assert.equal(pending.type, 'confirmed_session', 'el tipo no cambia: el editor depende de él');
    const changing = normalizeSession(session({ client_confirmation: 'change_requested', status: 'rescheduled' }), quotation);
    assert.equal(changing.awaitingClient, true);
    const confirmed = normalizeSession(session({ client_confirmation: 'confirmed' }), quotation);
    assert.deepEqual([confirmed.awaitingClient, confirmed.title], [false, 'Sesión — Ana Ruiz']);
    // Sin la migración 20261116150000 la columna no existe: queda como hasta ahora.
    const legacy = normalizeSession(session(), quotation);
    assert.deepEqual([legacy.awaitingClient, legacy.title], [false, 'Sesión — Ana Ruiz']);
    // Una sesión cerrada no espera a nadie.
    for (const status of ['completed', 'cancelled', 'no_show']) {
        assert.equal(normalizeSession(session({ client_confirmation: 'pending', status }), quotation).awaitingClient, false, status);
    }
    assert.match(read('lib/gcal-sync.js'), /\['pending', 'change_requested'\]\.includes\(String\(session\.client_confirmation \|\| ''\)\)/, 'misma regla que Google Calendar');

    // 2) El calendario: contadores, encabezado y etiqueta del tipo (código real, con dobles).
    const cal = read('public/shared/js/calendar.js');
    const slice = (from, to) => {
        const start = cal.indexOf(from);
        const end = cal.indexOf(to, start);
        assert.ok(start >= 0 && end > start, `no encontré el bloque ${from.trim()}`);
        return cal.slice(start, end);
    };
    const code = [
        slice('    function pad(value) {', '    function eventClass(type) {'),
        slice('    function monthCounters() {', "    document.addEventListener('wo:booking-summary'"),
        'this.api = { monthCounters, typeLabel, updateHeaderSummary };',
    ].join('\n');
    const el = { 'calendar-summary': { textContent: '' } };
    const events = [pending, changing, confirmed, legacy,
        { type: 'confirmed_session', sourceType: 'manual', start: '2026-12-12T15:00:00.000Z', end: '2026-12-12T16:00:00.000Z' },
        { type: 'pending_request', start: '2026-12-14T15:00:00.000Z', end: '2026-12-14T16:00:00.000Z' }];
    const calSandbox = {
        window: {}, el, MONTHS: [], MONTH_VISIBLE_EVENTS: 3,
        TYPE_META: { confirmed_session: { label: 'Turno confirmado' }, pending_request: { label: 'Solicitud pendiente' } },
        state: { currentDate: new Date(2026, 11, 15), events },
    };
    vm.runInNewContext(code, calSandbox);
    const counters = calSandbox.api.monthCounters();
    assert.deepEqual([counters.confirmed, counters.awaiting, counters.pending], [3, 2, 1]);
    calSandbox.api.updateHeaderSummary();
    assert.match(el['calendar-summary'].textContent, /^3 turnos confirmados, 2 sesiones por confirmar, 1 solicitud esperando respuesta y 0 días bloqueados este mes\.$/);
    assert.equal(calSandbox.api.typeLabel(pending), 'Por confirmar');
    assert.equal(calSandbox.api.typeLabel(confirmed), 'Turno confirmado');
    assert.equal(calSandbox.api.typeLabel(events[5]), 'Solicitud pendiente');
    // Sin sesiones por confirmar el encabezado queda como antes.
    calSandbox.state.events = [confirmed];
    calSandbox.api.updateHeaderSummary();
    assert.equal(el['calendar-summary'].textContent, '1 turno confirmado, 0 solicitudes esperando respuesta y 0 días bloqueados este mes.');
    // La etiqueta del evento (vista día y agenda) sale de typeLabel, no del tipo a secas.
    assert.match(cal, /const eventType = typeLabel\(event\) \|\| 'Evento';/);
    assert.match(cal, /const context = \[typeLabel\(event\), event\.location, event\.quoteCode\]/);
    assert.match(cal, /turnos confirmados'\)\} en total\$\{awaitingPhrase\(awaiting, ' · '\)\}\./);
    // Las páginas cargan la versión nueva del repo.
    for (const page of ['public/calendar/index.html', 'public/artist/dashboard/index.html']) {
        assert.match(read(page), /\/shared\/js\/data\/calendar-repo\.js\?v=20261116-r2b"/, page);
    }
});

test('archivos nuevos: español neutro (tuteo), sin CRUD ad-hoc y con estilos del DS', () => {
    const files = [
        'public/shared/js/wo-session-model.js', 'public/shared/js/wo-session-ui.js', 'public/shared/js/wo-session-flow.js',
        'public/shared/js/client-sessions.js', 'public/shared/js/data/sessions-flow-repo.js',
        'lib/sesiones.js', 'lib/routes/sesiones.js', 'lib/repos/sesiones.js', 'services/email-events/sesiones.js',
    ];
    const VOSEO = /\b(querés|podés|tenés|sabés|necesitás|confirmá|confirmala|pedí|pedile|revisá|elegí|contanos|contale|escribile|guardá|mirá|respondé|respondelo|aceptá|rechazá|dejá|abrí|entrá|ingresá|iniciá|probá|agregá|cambiá|editá|editala|cancelá|registrá|calificá|proponé|fijate|vos)\b/i;
    for (const file of files) {
        const source = read(file);
        const hit = source.match(VOSEO);
        assert.equal(hit, null, `${file}: voseo "${hit && hit[0]}"`);
    }
    const front = files.filter((f) => f.startsWith('public/')).map(read).join('\n');
    assert.doesNotMatch(front, /\/rest\/v1\/|\.from\('quotation_session|_supabase\.from\(|createClient\(/, 'el navegador no escribe las tablas de sesiones');
    assert.doesNotMatch(front, /localStorage|document\.write|eval\(/);

    const css = read('public/shared/css/wo-sessions.css');
    assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-fA-F]{3,8}\b/, 'solo tokens del DS, sin hex sueltos');
    const radii = [...css.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim());
    assert.ok(radii.length > 0 && radii.every((value) => value === '0' || value === 'var(--radius-none)'), 'Bauhaus: sin esquinas redondeadas');
    assert.match(css, /@media \(max-width: 600px\)/);
    assert.match(css, /@media \(min-width: 768px\)/);
    assert.match(css, /@media \(min-width: 1200px\)/);
    assert.match(css, /\.pac-container \{ z-index: 1400 !important;/);
    assert.match(css, /overflow-wrap: anywhere/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /focus-visible/);
    assert.match(css, /\.ws-modal \{[^}]*max-height: min\(92vh, 688px\)/, 'los diálogos entran en 720 px de alto');
});
