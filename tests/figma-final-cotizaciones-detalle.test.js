const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Figma final del flujo de artista (oct 2026) · área "cotizaciones-detalle".
// Expediente /my-quotations/detail?id=<quote_id> (frames 801:576–584), notas de
// trabajo (801:578/579) y plantillas (801:1111–1115).

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const M = require(path.join(root, 'public/shared/js/quotation-detail-model.js'));

const NOW = new Date(2026, 9, 28, 12, 0, 0);
const iso = (days, h = 12) => new Date(2026, 9, 28 + days, h, 0, 0).toISOString();

function quote(extra) {
    return Object.assign({
        id: 51, quote_id: 'COT-051', quote_status: 'pending', created_at: iso(-10), client_full_name: 'Bruno Aquino',
        tattoo_style: ['Dotwork'], tattoo_body_part: 'Espalda completa', tattoo_estimated_sessions: 3,
        artist_session_minutes: 150, artist_budget_amount: 410000, artist_budget_currency: 'CLP',
        client_budget_amount: 400000, client_budget_currency: 'CLP',
    }, extra || {});
}
function session(n, status, days, extra) {
    return Object.assign({ id: 900 + n, quotation_id: 51, session_number: n, status, session_date: days == null ? null : iso(days, 15), duration_hours: 2.5, photo_urls: [] }, extra || {});
}

/* ------------------------------- formatos ------------------------------- */
test('formatos del Figma: montos, duraciones, fechas y horas', () => {
    assert.equal(M.money(410000, 'CLP'), '$410.000');
    assert.equal(M.money('350.000'), '$350.000');
    assert.equal(M.money(null), 'A definir');
    assert.equal(M.moneyRange(350000, 450000, 'CLP'), '$350.000 – $450.000');
    assert.equal(M.durationLong(150), '2hrs 30min');
    assert.equal(M.durationShort(160), '2h 40m');
    assert.equal(M.durationShort(180), '3h');
    assert.equal(M.hoursLabel(480), '8 horas');
    assert.equal(M.dayMonth(new Date(2026, 6, 5)), '05 JUL');
    assert.equal(M.dateTime(new Date(2026, 7, 12, 15, 0)), '12 AGO 2026 · 15:00');
    assert.equal(M.sessionsLabel(1), '1 sesión');
    assert.equal(M.sessionsLabel(3), '3 sesiones');
    assert.equal(M.initials('Bruno Aquino'), 'BA');
    assert.equal(M.preferredDateLabel({ client_preferred_date: '2026-07-08', client_flexible_dates: 'Sí' }), '08 JUL 2026 · flexible');
    assert.equal(M.numberFrom('1.240,50'), 1240.5);
});

/* -------------------------------- estados -------------------------------- */
test('el estado del expediente se deriva de la cotización, sus sesiones y la disputa', () => {
    assert.equal(M.deriveStage(quote(), [], []), 'pending');
    assert.equal(M.deriveStage(quote({ quote_status: 'responded' }), [], []), 'responded');
    assert.equal(M.deriveStage(quote({ quote_status: 'client_approved', final_sessions: 3 }), [], []), 'approved');
    const working = quote({ quote_status: 'in_progress', final_sessions: 3, artist_responded_at: iso(-8) });
    assert.equal(M.deriveStage(working, [session(1, 'completed', -5), session(2, 'scheduled', 5)], []), 'in_progress');
    assert.equal(M.deriveStage(working, [session(1, 'completed', -9), session(2, 'completed', -5), session(3, 'completed', -1)], []), 'ready');
    assert.equal(M.deriveStage(quote({ quote_status: 'artist_completed' }), [], []), 'delivered');
    assert.equal(M.deriveStage(quote({ quote_status: 'completed' }), [], []), 'completed');
    assert.equal(M.deriveStage(quote({ quote_status: 'artist_completed' }), [], [{ status: 'open' }]), 'dispute');
    assert.equal(M.deriveStage(quote({ quote_status: 'artist_completed', dispute_status: 'open' }), [], []), 'dispute');
    // in_progress sin respuesta del artista = borrador del cotizador del cliente.
    assert.equal(M.deriveStage(quote({ quote_status: 'in_progress', artist_responded_at: null, tattoo_estimated_sessions: null }), [], []), 'draft');
    assert.equal(M.deriveStage(quote({ quote_status: 'cancelled' }), [], []), 'cancelled');
});

test('la barra de comandos replica los botones de cada frame', () => {
    assert.deepEqual(M.commandActions('pending'), ['accept', 'reject', 'schedule', 'contact']);
    assert.deepEqual(M.commandActions('responded'), ['schedule', 'contact']);
    assert.deepEqual(M.commandActions('approved'), ['schedule', 'contact']);
    assert.deepEqual(M.commandActions('in_progress'), ['schedule', 'contact']);
    assert.deepEqual(M.commandActions('ready'), ['markReady', 'contact']);
    assert.deepEqual(M.commandActions('completed'), ['contact']);
    assert.deepEqual(M.commandActions('dispute'), ['dispute', 'contact']);
    assert.deepEqual(M.stageMeta('dispute'), { tag: 'En disputa', tone: 'dispute' });
});

test('las sesiones acordadas se completan con filas "sin fecha asignada" y acciones por fila', () => {
    const q = quote({ quote_status: 'in_progress', final_sessions: 3, artist_responded_at: iso(-8) });
    const slots = M.sessionSlots(q, [session(1, 'completed', -5), session(2, 'scheduled', 5)]);
    assert.deepEqual(slots.map((s) => s.state), ['done', 'scheduled', 'unscheduled']);
    assert.deepEqual(M.slotCounts(slots), { done: 1, scheduled: 1, pending: 1, total: 3, percent: 33 });
    assert.deepEqual(M.sessionRowActions('in_progress', slots[0], NOW), ['view']);
    assert.deepEqual(M.sessionRowActions('in_progress', slots[1], NOW), ['view', 'reschedule', 'complete']);
    assert.deepEqual(M.sessionRowActions('in_progress', slots[2], NOW), ['schedule']);
    // Acuerdo aprobado (801:580): solo "Ver sesión" hasta que llega la fecha.
    assert.deepEqual(M.sessionRowActions('approved', slots[1], NOW), ['view']);
    assert.deepEqual(M.sessionRowActions('approved', Object.assign({}, slots[1], { session: session(2, 'scheduled', 0) }), NOW), ['view', 'reschedule', 'complete']);
    assert.deepEqual(M.sessionRowActions('approved', slots[2], NOW), ['plan']);
    // Las canceladas no ocupan lugar.
    assert.equal(M.sessionSlots(q, [session(1, 'cancelled', 3)]).filter((s) => s.session).length, 0);
});

test('timeline de 6 pasos con el actual resaltado (rojo en disputa)', () => {
    const steps = M.timeline(quote({ quote_status: 'responded', artist_responded_at: iso(-3) }), [], 'responded', []);
    assert.deepEqual(steps.map((s) => s.label), ['Pendiente', 'Respondida', 'Aprobada', 'En progreso', 'Lista para cliente', 'Completada']);
    assert.deepEqual(steps.map((s) => s.state), ['done', 'current', 'future', 'future', 'future', 'future']);
    assert.equal(steps[2].date, '—');
    const dispute = M.timeline(quote({ quote_status: 'artist_completed' }), [], 'dispute', []);
    assert.equal(dispute[4].state, 'current');
    assert.equal(dispute[4].alert, true);
});

test('historial de cambios con el copy del Figma', () => {
    const q = quote({ quote_status: 'in_progress', artist_viewed_at: iso(-9), priority: 'high', artist_responded_at: iso(-8), final_sessions: 3, final_budget_amount: 410000 });
    const history = [
        { new_status: 'pending', changed_at: iso(-10) },
        { new_status: 'responded', changed_at: iso(-8) },
        { new_status: 'client_approved', changed_at: iso(-6) },
        { new_status: 'in_progress', changed_at: iso(-4) },
    ];
    const events = M.historyEvents(q, history, [session(1, 'completed', -4, { duration_hours: 2.6667, photo_urls: ['a', 'b', 'c'] })], []);
    const texts = events.map((e) => e.text);
    assert.equal(texts[0], 'Solicitud creada por el cliente desde el cotizador.');
    assert.equal(texts[1], 'Vista por vos. Prioridad asignada: alta.');
    assert.equal(texts[2], 'Respuesta enviada: $410.000 · 3 sesiones · 2h 30m.');
    assert.match(texts[3], /^Acuerdo confirmado: \$410\.000 · 3 sesiones · primera \d{2} [A-Z]{3} 2026\.$/);
    assert.equal(texts[4], 'Trabajo iniciado. Gestión de sesiones habilitada.');
    assert.equal(texts[5], 'Sesión 1 registrada como realizada · 2h 40m · 3 fotos.');
    const disputeEvents = M.historyEvents(quote({ quote_status: 'artist_completed', artist_completed_at: iso(-3) }), [], [], [{ id: 1, status: 'open', created_at: iso(-2) }]);
    assert.deepEqual(disputeEvents.slice(-2).map((e) => e.text), ['Entrega enviada al cliente para su aprobación.', 'Cliente inició una disputa. Entrega retenida.']);
});

test('?estado= arma en memoria cada frame (solo preview) con acciones deshabilitadas', () => {
    const base = quote({ quote_status: 'pending' });
    const expected = { pendiente: 'pending', respondida: 'responded', aprobada: 'approved', 'en-progreso': 'in_progress', listo: 'ready', completada: 'completed', disputa: 'dispute' };
    Object.keys(expected).forEach((key) => {
        const sc = M.previewScenario(key, base, [], NOW, ['/a.svg', '/b.svg', '/c.svg']);
        assert.equal(sc.readOnly, true, key);
        assert.equal(M.deriveStage(sc.quote, sc.sessions, sc.disputes), expected[key], key);
    });
    const approved = M.previewScenario('aprobada', base, [], NOW, []);
    assert.deepEqual(M.sessionSlots(approved.quote, approved.sessions).map((s) => s.state), ['scheduled', 'unscheduled', 'unscheduled']);
    const progress = M.previewScenario('en-progreso', base, [], NOW, ['/a.svg', '/b.svg', '/c.svg']);
    assert.deepEqual(M.sessionSlots(progress.quote, progress.sessions).map((s) => s.state), ['done', 'scheduled', 'unscheduled']);
    assert.equal(progress.sessions[0].photo_urls.length, 3);
    const dispute = M.previewScenario('disputa', base, [], NOW, []);
    assert.equal(dispute.disputes[0].title, 'El relleno del sector lumbar quedó incompleto');
    assert.equal(M.previewScenario('desconocido', base, [], NOW, []), null);
});

/* ------------------------- correcciones (ronda 1) ------------------------- */
test('historial: "Trabajo iniciado" va antes que la sesión del mismo día (801:581) y la entrega después', () => {
    const q = quote({ quote_status: 'artist_completed', artist_responded_at: iso(-8), final_sessions: 1, artist_completed_at: iso(0, 18) });
    // La sesión se fecha a las 10:00; el cambio de estado (sin trigger) a las 14:00 del mismo día.
    const history = [{ new_status: 'in_progress', changed_at: iso(0, 14) }];
    const sessions = [session(1, 'completed', 0, { session_date: new Date(2026, 9, 28, 10, 0).toISOString() })];
    const texts = M.historyEvents(q, history, sessions, []).map((e) => e.text);
    const started = texts.indexOf('Trabajo iniciado. Gestión de sesiones habilitada.');
    const done = texts.findIndex((t) => /^Sesión 1 registrada/.test(t));
    const delivered = texts.indexOf('Entrega enviada al cliente para su aprobación.');
    assert.ok(started >= 0 && done > started, texts.join(' | '));
    assert.ok(delivered > done, texts.join(' | '));
});

test('en disputa la sesión de corrección agendada se puede reprogramar y marcar realizada', () => {
    const q = quote({ quote_status: 'artist_completed', final_sessions: 2, dispute_status: 'open' });
    const slots = M.sessionSlots(q, [session(1, 'completed', -9), session(2, 'completed', -5), session(3, 'scheduled', 5, { notes: 'Sesión de corrección' })]);
    assert.equal(M.deriveStage(q, [], []), 'dispute');
    assert.deepEqual(M.sessionRowActions('dispute', slots[0], NOW), ['view']);
    assert.deepEqual(M.sessionRowActions('dispute', slots[2], NOW), ['view', 'reschedule', 'complete']);
    assert.deepEqual(M.commandActions('delivered'), ['contact']);
});

test('fixtures: DEMO-C01, DEMO-D03 y DEMO-D01 tienen solicitud, respuesta y acuerdo antes de la primera sesión', () => {
    global.self = global;
    delete require.cache[require.resolve(path.join(root, 'public/shared/js/demo-fixtures/cotizaciones-detalle.js'))];
    require(path.join(root, 'public/shared/js/demo-fixtures/cotizaciones-detalle.js'));
    const Fixtures = require(path.join(root, 'public/shared/js/wo-demo-fixtures.js'));
    const fx = Fixtures.build({ userId: '11111111-1111-4111-8111-111111111111', username: 'demo.wo', name: 'Demo', email: 'demo@weotzi.test' });
    ['DEMO-C01', 'DEMO-D03', 'DEMO-D01'].forEach((id) => {
        const q = fx.tables.quotations_db.find((row) => row.quote_id === id);
        const sessions = fx.tables.quotation_sessions.filter((s) => s.quotation_id === q.id);
        const history = fx.tables.quotation_status_history.filter((h) => h.quotation_id === q.id);
        const first = Math.min(...sessions.map((s) => new Date(s.session_date).getTime()));
        assert.ok(new Date(q.created_at).getTime() < first, `${id}: created_at antes de la primera sesión`);
        const approved = history.find((h) => h.new_status === 'client_approved');
        assert.ok(approved && new Date(approved.changed_at).getTime() < first, `${id}: acuerdo antes de la primera sesión`);
        const events = M.historyEvents(q, history, sessions, fx.tables.quotation_disputes.filter((d) => d.quotation_id === q.id));
        assert.equal(events[0].text, 'Solicitud creada por el cliente desde el cotizador.', id);
        const disputes = fx.tables.quotation_disputes.filter((d) => d.quotation_id === q.id);
        const steps = M.timeline(q, history, M.deriveStage(q, sessions, disputes), sessions)
            .filter((s) => s.state !== 'future').map((s) => stepAt(q, history, sessions, s.status));
        steps.reduce((prev, at) => { assert.ok(at >= prev, `${id}: timeline en orden`); return at; }, 0);
    });
});
function stepAt(q, history, sessions, status) {
    const row = history.filter((h) => h.new_status === status).sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at))[0];
    if (row) return new Date(row.changed_at).getTime();
    if (status === 'pending') return new Date(q.created_at).getTime();
    if (status === 'in_progress') return Math.min(...sessions.filter((s) => s.status === 'completed').map((s) => new Date(s.session_date).getTime()));
    const map = { responded: q.artist_responded_at, artist_completed: q.artist_completed_at, completed: q.client_completed_at };
    return new Date(map[status]).getTime();
}

/* ------------------------- correcciones (ronda 2) ------------------------- */
const STARTED = 'Trabajo iniciado. Gestión de sesiones habilitada.';
function d01Like(status, extra) {
    // Acuerdo aprobado con la sesión 1 realizada antes de pasar a in_progress
    // (emulador del preview: sin fila in_progress en el historial).
    return quote(Object.assign({ quote_status: status, final_sessions: 3, final_budget_amount: 410000, artist_responded_at: iso(-12),
        created_at: iso(-13), updated_at: iso(0, 11) }, extra || {}));
}
const d01History = [
    { new_status: 'pending', changed_at: iso(-13) },
    { new_status: 'responded', changed_at: iso(-12) },
    { new_status: 'client_approved', changed_at: iso(-11) },
];

test('801:581: "Trabajo iniciado" y el paso "En progreso" comparten fecha y siguen el orden del ciclo', () => {
    const sessions = [session(1, 'completed', -10, { updated_at: iso(-1) }), session(2, 'completed', 0, { session_date: iso(0, 10), updated_at: iso(0, 11) }), session(3, 'scheduled', 12)];
    const q = d01Like('in_progress');
    const stage = M.deriveStage(q, sessions, []);
    assert.equal(stage, 'in_progress');
    const steps = M.timeline(q, d01History, stage, sessions, NOW);
    assert.deepEqual(steps.slice(0, 4).map((s) => s.date), [M.dayMonth(iso(-13)), M.dayMonth(iso(-12)), M.dayMonth(iso(-11)), M.dayMonth(iso(-10))]);
    const events = M.historyEvents(q, d01History, sessions, [], NOW);
    const texts = events.map((e) => e.text);
    assert.equal(texts[0], 'Solicitud creada por el cliente desde el cotizador.');
    const started = texts.indexOf(STARTED);
    assert.ok(started > texts.findIndex((t) => /^Acuerdo confirmado/.test(t)), texts.join(' | '));
    assert.equal(events[started].date, steps[3].date, 'misma fecha en historial y timeline');
    assert.match(texts[started + 1], /^Sesión 1 registrada/);
    assert.match(texts[started + 2], /^Sesión 2 registrada/);
    // Las fechas del historial nunca retroceden.
    events.reduce((prev, e) => { assert.ok(M.isoDay(e.at) >= prev, texts.join(' | ')); return M.isoDay(e.at); }, '');
});

test('"Trabajo iniciado" sigue en el historial después de "Marcar listo" y en completada/disputa', () => {
    const sessions = [session(1, 'completed', -10), session(2, 'completed', -5), session(3, 'completed', -1)];
    ['artist_completed', 'completed'].forEach((status) => {
        const q = d01Like(status, { artist_completed_at: iso(0, 13), client_completed_at: status === 'completed' ? iso(0, 15) : null });
        const disputes = status === 'artist_completed' ? [{ id: 1, status: 'open', created_at: iso(0, 14) }] : [];
        const events = M.historyEvents(q, d01History, sessions, disputes, NOW);
        const hit = events.find((e) => e.text === STARTED);
        assert.ok(hit, status);
        assert.equal(hit.date, M.dayMonth(iso(-10)), status);
        const stage = M.deriveStage(q, sessions, disputes);
        assert.equal(M.timeline(q, d01History, stage, sessions, NOW)[3].date, hit.date, status);
    });
    // Sin sesiones realizadas ni fila: in_progress se fecha con updated_at, una sola vez.
    const bare = M.historyEvents(d01Like('in_progress'), d01History, [], [], NOW).filter((e) => e.text === STARTED);
    assert.equal(bare.length, 1);
    // Con fila in_progress manda el historial (backend real con trigger).
    const withRow = d01History.concat([{ new_status: 'in_progress', changed_at: iso(0, 9) }]);
    const real = M.historyEvents(d01Like('in_progress'), withRow, [session(1, 'completed', -10)], [], NOW);
    assert.deepEqual(real.filter((e) => e.text === STARTED).map((e) => e.date), [M.dayMonth(iso(0))]);
    // Antes del acuerdo no hay "Trabajo iniciado".
    assert.ok(!M.historyEvents(d01Like('client_approved'), d01History, [session(1, 'completed', -10)], [], NOW).some((e) => e.text === STARTED));
});

test('801:584: una sesión registrada antes de su fecha no queda con fecha futura', () => {
    const tomorrow = session(3, 'completed', 1, { notes: 'Sesión de corrección' });
    assert.equal(M.sessionDoneAt(tomorrow, NOW), NOW.toISOString());
    assert.equal(M.sessionDoneAt(session(1, 'completed', -3), NOW), iso(-3, 15));
    // Modificada antes de su fecha (fixtures): se usa la última modificación.
    assert.equal(M.sessionDoneAt(session(2, 'completed', 0, { updated_at: iso(-1) }), NOW), iso(-1));
    const q = quote({ quote_status: 'artist_completed', dispute_status: 'open', final_sessions: 2, artist_completed_at: iso(-3) });
    const events = M.historyEvents(q, [], [session(1, 'completed', -9), session(2, 'completed', -5), tomorrow], [{ id: 1, status: 'open', created_at: iso(-2) }], NOW);
    const correction = events.find((e) => /^Sesión 3 registrada/.test(e.text));
    assert.equal(correction.date, M.dayMonth(NOW));
    assert.ok(events.every((e) => new Date(e.at) <= NOW), events.map((e) => `${e.date} ${e.text}`).join(' | '));
    // La página guarda la fecha y hora actuales al registrar una sesión agendada
    // para más adelante (otro día o más tarde el mismo día).
    const page = read('public/shared/js/quotation-detail-figma.js');
    assert.match(page, /const ahead = new Date\(session\.session_date\)\.getTime\(\) > Date\.now\(\);/);
    assert.match(page, /if \(ahead\) sessionPatch\.session_date = nowIso\(\);/);
    // El inicio del trabajo se guarda antes que la sesión.
    assert.ok(page.indexOf("updateQuote({ quote_status: 'in_progress' })") < page.indexOf('updateSession(session.id, sessionPatch)'));
});

test('enlaces del expediente: calendario con ?quote= / ?event=, inbox con ?quote= y logout a /artist/login', () => {
    const page = read('public/shared/js/quotation-detail-figma.js');
    assert.match(page, /query\.set\('event', `session:\$\{session\}`\)/);
    assert.match(page, /query\.set\('quote', String\(quote\)\)/);
    assert.match(page, /calendarUrl\(s && s\.session_date, \{ session: s && s\.id, quote: true \}\)/);
    assert.match(page, /calendarUrl\(v\.quote\.client_preferred_date \|\| new Date\(\), \{ quote: true \}\)/);
    // Todos los enlaces al calendario llevan la cotización (?quote=), salvo el del
    // acuerdo completo: con ?quote= el calendario abriría un turno nuevo (4.ª sesión).
    assert.match(page, /link: \{ href: calendarUrl\(last \|\| null\), label: 'Abrir calendario →' \}/);
    const calendarCalls = page.split('\n').filter((line) => line.includes('calendarUrl(') && !line.includes('function calendarUrl') && !line.includes('calendarUrl(last || null)'));
    assert.ok(calendarCalls.length >= 5);
    calendarCalls.forEach((line) => assert.match(line, /calendarUrl\([^\n]*quote: true \}\)/, line.trim()));
    assert.match(page, /\/artist\/inbox\?quote=\$\{encodeURIComponent\(quote\.quote_id \|\| quote\.id\)\}/);
    assert.match(page, /appUrl\('\/artist\/login'\)/);
    assert.doesNotMatch(page, /registerclosedbeta/);
    // Sin UI fuera del Figma: ni panel "Lista para cliente · enviada" ni recuadro de vista previa.
    assert.doesNotMatch(page, /qd-delivered|qd-preview-note/);
    // Miniatura sin URL firmada → deja de ser enlace.
    assert.doesNotMatch(page, /qd-photo-tile has-image" href="#"/);
    assert.match(page, /tile\.replaceWith\(placeholder\)/);
    const notes = read('public/shared/js/work-notes-drawer.js');
    assert.match(notes, /applyTemplate\(st\.opts\.template, false\)/);
    const css = read('public/shared/css/quotation-detail-figma.css');
    assert.match(css, /\.qd-closeout-grid \{[^}]*repeat\(5, minmax\(160px, max-content\)\)/);
    // Una sola regla base (la otra es el reset de white-space en móvil).
    assert.equal((css.match(/\.qd-closeout-grid \.qd-label \{ color:/g) || []).length, 1);
    assert.doesNotMatch(css, /\.qd-agreement-grid \.qd-label,\s*\.qd-closeout-grid \.qd-label/);
    assert.match(css, /\.qd-private-status:empty \{ display: none; \}/);
    assert.match(css, /min-height: 123px;\s*resize: none;/);
    const notesCss = read('public/shared/css/work-notes-drawer.css');
    assert.match(notesCss, /color-mix\(in srgb, var\(--neutral-500\) 46%, transparent\)/);
});

/* ---------------------------- notas de trabajo ---------------------------- */
test('plantillas de notas (801:1111–1115) y bloques compatibles con EditorJS', () => {
    assert.deepEqual(M.NOTE_TEMPLATES.map((t) => t.label), ['Brief del proyecto', 'Preparación de sesión', 'Seguimiento', 'Cuidados', 'Pendientes']);
    const brief = M.templateByKey('brief').build(quote({ project_description: 'Mandala dotwork' }));
    assert.deepEqual(brief.map((b) => b.type), ['title', 'text', 'list', 'list']);
    assert.equal(brief[1].text, 'Mandala dotwork, espalda completa.');
    assert.deepEqual(M.templateByKey('preparacion').build().map((b) => b.text), ['Preparación de sesión', 'Imprimir stencil', 'Agujas 11RL y 7RS', 'Confirmar anestesia']);
    assert.deepEqual(M.templateByKey('cuidados').build().map((b) => b.type), ['title', 'list', 'list']);
    assert.deepEqual(M.templateByKey('pendientes').build().map((b) => b.type), ['title', 'checklist', 'checklist']);

    const blocks = [M.block('title', 'Preparación'), M.block('text', 'a < b & c'), M.block('checklist', 'Stencil', { checked: true }),
        M.block('list', 'Ref'), M.block('quote', 'Cita'), M.block('separator'), M.block('image', 'Foto', { url: 'https://x/y.png' })];
    const content = M.contentFromBlocks(blocks, ['mandala', 'espalda'], 'brief');
    assert.deepEqual(content.blocks.map((b) => b.type), ['header', 'paragraph', 'checklist', 'list', 'quote', 'delimiter', 'image']);
    assert.equal(content.blocks[1].data.text, 'a &lt; b &amp; c');
    const back = M.blocksFromContent(content);
    assert.deepEqual(back.map((b) => [b.type, b.text, b.checked]), blocks.map((b) => [b.type, b.text, b.checked]));
    assert.deepEqual(M.tagsFromContent(content), ['mandala', 'espalda']);
    assert.equal(M.countBlocks(content), 7);
    // Contenido legacy del drawer viejo (EditorJS con listas multi-ítem).
    assert.equal(M.countBlocks({ blocks: [{ type: 'list', data: { items: ['a', 'b'] } }, { type: 'paragraph', data: { text: 'x<br>y' } }] }), 3);
    assert.equal(M.blocksLabel(1), '1 bloque');
    assert.equal(M.isEmptyNote([M.block('text')], [], 'Nueva nota'), true);
    assert.equal(M.isEmptyNote([M.block('text', 'hola')], [], 'Nueva nota'), false);
    assert.equal(M.noteDateLabel(NOW, NOW), 'HOY');
    assert.match(M.noteToMarkdown({ title: 'Brief', note_date: NOW, content }), /## Brief[\s\S]*- \[x\] Stencil[\s\S]*Etiquetas: mandala, espalda/);
});

/* ------------------------------ capa de datos ------------------------------ */
const plain = (value) => JSON.parse(JSON.stringify(value)); // objetos de otro realm (vm)
function loadRepo(runImpl, extra) {
    const calls = [];
    const window = { WeotziData: Object.assign({ run: async (label, builder) => { calls.push(label); return runImpl(label, builder); }, getClient: () => null }, extra || {}) };
    vm.runInNewContext(read('public/shared/js/data/quotation-detail-repo.js'), { window, console });
    return { repo: window.WeotziData.QuotationDetail, calls };
}

test('el repo degrada sin la migración: reintenta sin columnas nuevas y lista disputas como no disponibles', async () => {
    const patches = [];
    const builderClient = { from: () => ({ update: (p) => { patches.push(p); return { eq: () => ({}) }; } }) };
    const { repo } = loadRepo(async (label, builder) => {
        builder(builderClient);
        if (label === 'quotationDetail.updateQuote') {
            throw Object.assign(new Error("[x] Could not find the 'artist_session_minutes' column"), { code: 'PGRST204' });
        }
        return { data: null };
    });
    const result = await repo.updateQuote(51, { quote_status: 'responded', artist_session_minutes: 150 });
    assert.deepEqual(plain(result.dropped), ['artist_session_minutes']);
    assert.deepEqual(plain(patches[1]), { quote_status: 'responded' });

    const missing = loadRepo(async () => { throw Object.assign(new Error('[x] relation "quotation_disputes" does not exist'), { code: '42P01' }); }).repo;
    assert.deepEqual(plain(await missing.listDisputes(51)), { available: false, rows: [] });

    const failing = loadRepo(async () => { throw Object.assign(new Error('[x] permission denied'), { code: '42501' }); }).repo;
    await assert.rejects(() => failing.updateQuote(51, { notes: 'x' }));
    assert.equal(await failing.photoUrl('/shared/assets/demo/ref-01.svg'), '/shared/assets/demo/ref-01.svg');
});

test('sin CRUD ad-hoc: el expediente y las notas pasan por WeotziData', () => {
    const files = ['public/shared/js/quotation-detail-figma.js', 'public/shared/js/work-notes-drawer.js', 'public/shared/js/quotation-detail-model.js'];
    files.forEach((file) => {
        const src = read(file);
        assert.doesNotMatch(src, /\/rest\/v1\//, file);
        assert.doesNotMatch(src, /_supabase\.from\(|\.from\('quotation/, file);
    });
    const page = read('public/shared/js/quotation-detail-figma.js');
    ['QuotationDetail.updateQuote', 'QuotationDetail.createSession', 'QuotationDetail.updateSession', 'QuotationDetail.respondDispute',
        'QuotationDetail.uploadSessionPhoto', 'Quotations.setArchivedById', 'Chat.sendMessage', 'StatusHistory.listForQuotation']
        .forEach((call) => assert.ok(page.includes(call.split('.').pop()), call));
    const notes = read('public/shared/js/work-notes-drawer.js');
    ['Notes.listForQuote', 'Notes.update', 'Notes.delete', 'createNote'].forEach((call) => assert.ok(notes.includes(call), call));
});

test('la página carga repos y módulos en orden y expone los estados del Figma', () => {
    const html = read('public/my-quotations/detail/index.html');
    const order = ['config-manager.js', 'postgrest-client.js', 'quotations-repo.js', 'quotation-detail-repo.js', 'quotation-detail-model.js', 'work-notes-drawer.js', 'quotation-detail-figma.js'];
    let last = -1;
    order.forEach((name) => {
        const at = html.indexOf(name);
        assert.ok(at > last, `${name} fuera de orden`);
        last = at;
    });
    ['qd-accept', 'qd-reject', 'qd-schedule', 'qd-mark-ready', 'qd-dispute-toggle', 'qd-contact'].forEach((id) => assert.match(html, new RegExp(`id="${id}"`)));
    assert.match(html, /Marcar listo para cliente/);
    assert.match(html, /Ver disputa/);
    const css = read('public/shared/css/quotation-detail-figma.css');
    ['.qd-agreement', '.qd-sessions', '.qd-closeout', '.qd-dispute', '.qd-timeline-step.is-alert'].forEach((sel) => assert.ok(css.includes(sel), sel));
    const notesCss = read('public/shared/css/work-notes-drawer.css');
    assert.match(notesCss, /width: min\(620px, 100%\)/);
    assert.ok(fs.existsSync(path.join(root, 'public/shared/assets/quotation-detail-quote-mark.svg')));
});

test('migración nueva no aplicada con rollback, RLS y fixtures de preview', () => {
    const migration = read('supabase/migrations/20261028130000_quotation_detail_figma.sql');
    const rollback = read('supabase/rollbacks/20261028130000_quotation_detail_figma.down.sql');
    assert.match(migration, /add column if not exists artist_session_minutes/);
    assert.match(migration, /add column if not exists artist_viewed_at/);
    assert.match(migration, /add column if not exists photo_urls text\[\]/);
    assert.match(migration, /create table if not exists public\.quotation_disputes/);
    assert.match(migration, /alter table public\.quotation_disputes enable row level security/);
    assert.match(migration, /'quotation-session-photos'/);
    assert.match(rollback, /drop table if exists public\.quotation_disputes/);
    assert.match(rollback, /drop column if exists artist_session_minutes/);
    assert.match(rollback, /drop column if exists photo_urls/);

    // La extensión de fixtures se registra en self.WoDemoFixtureExtensions.
    global.self = global;
    delete require.cache[require.resolve(path.join(root, 'public/shared/js/demo-fixtures/cotizaciones-detalle.js'))];
    require(path.join(root, 'public/shared/js/demo-fixtures/cotizaciones-detalle.js'));
    const Fixtures = require(path.join(root, 'public/shared/js/wo-demo-fixtures.js'));
    const fx = Fixtures.build({ userId: '11111111-1111-4111-8111-111111111111', username: 'demo.wo', name: 'Demo', email: 'demo@weotzi.test' });
    assert.ok(Fixtures.TABLES.includes('quotation_disputes'));
    const d03 = fx.tables.quotations_db.find((q) => q.quote_id === 'DEMO-D03');
    assert.equal(fx.tables.quotation_disputes[0].quotation_id, d03.id);
    assert.equal(M.deriveStage(d03, fx.tables.quotation_sessions.filter((s) => s.quotation_id === d03.id), fx.tables.quotation_disputes), 'dispute');
    const s01 = fx.tables.quotations_db.find((q) => q.quote_id === 'DEMO-S01');
    const notes = fx.tables.quotation_notes.filter((n) => n.quotation_id === s01.id);
    assert.deepEqual(notes.map((n) => n.title), ['Brief y preparación', 'Consulta inicial · llamada', 'Ideas de composición']);
    assert.equal(M.countBlocks(notes[0].content), 5);
    // No mueve estados ni montos de otras áreas.
    assert.equal(s01.quote_status, 'responded');
    assert.equal(d03.quote_status, 'artist_completed');
});
