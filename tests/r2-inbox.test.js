'use strict';

// Ronda 2 · frente Inbox: mensajes de voz [P8], mensajes rápidos y respuestas
// automáticas [P9] y conversación cerrada cuando el cliente rechaza la
// cotización. Lógica pura de inbox-extras-model.js, el repo de mensajes
// rápidos / automáticos contra un cliente PostgREST de prueba y los contratos
// de SQL, HTML, CSS y JS por lectura (tolerando \r\n).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const X = require(path.join(root, 'public', 'shared', 'js', 'inbox-extras-model.js'));

const MIGRATION_VOICE = 'supabase/migrations/20261116160000_inbox_mensajes_de_voz.sql';
const MIGRATION_QUICK = 'supabase/migrations/20261116160100_inbox_mensajes_rapidos.sql';
const MIGRATION_AUTO = 'supabase/migrations/20261116160200_inbox_respuestas_automaticas.sql';
const NEW_FRONT_FILES = [
    'public/shared/js/inbox-extras-model.js',
    'public/shared/js/data/inbox-extras-repo.js',
    'public/shared/js/wo-voice.js',
    'public/shared/js/wo-quick-replies.js',
    'public/shared/js/artist-inbox-automations.js',
];

/* ------------------------------ voz: modelo ------------------------------ */

test('P8 voz: formatos admitidos y elección del formato de grabación', () => {
    assert.deepEqual(X.VOICE_MIMES, ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg']);
    assert.equal(X.baseMime('Audio/WebM;codecs=opus'), 'audio/webm');
    assert.equal(X.isVoiceMime('audio/webm;codecs=opus'), true);
    assert.equal(X.isVoiceMime('audio/flac'), false);
    assert.equal(X.isVoiceMime('image/png'), false);
    assert.equal(X.isAudioAttachment('audio/x-m4a'), true);
    assert.equal(X.isAudioAttachment('application/pdf'), false);
    assert.equal(X.isAudioAttachment(null), false);

    // Prefiere MP4/AAC (se reproduce en todos lados); si no, WebM/Opus; si no, OGG.
    assert.equal(X.pickRecorderMime(() => true), 'audio/mp4;codecs=mp4a.40.2');
    assert.equal(X.pickRecorderMime((t) => t.startsWith('audio/webm')), 'audio/webm;codecs=opus');
    assert.equal(X.pickRecorderMime((t) => t === 'audio/ogg'), 'audio/ogg');
    assert.equal(X.pickRecorderMime(() => false), '');
    assert.equal(X.pickRecorderMime(() => { throw new Error('boom'); }), '');
    assert.equal(X.pickRecorderMime(null), '');
    // Todo lo que se ofrece grabar es un formato que la base acepta.
    X.VOICE_RECORDER_TYPES.forEach((type) => assert.ok(X.isVoiceMime(type), type));
});

test('P8 voz: validación de duración y tamaño (mismos topes que la base)', () => {
    assert.equal(X.VOICE_MAX_MS, 180000);
    assert.equal(X.VOICE_MAX_BYTES, 6 * 1024 * 1024);
    const ok = { type: 'audio/webm;codecs=opus', size: 40000, durationMs: 5000 };
    assert.deepEqual(X.validateVoice(ok), { ok: true, error: null });
    assert.equal(X.validateVoice(null).ok, false);
    assert.equal(X.validateVoice({ ...ok, type: 'audio/wav' }).ok, false);
    assert.equal(X.validateVoice({ ...ok, size: 0 }).ok, false);
    assert.equal(X.validateVoice({ ...ok, size: X.VOICE_MAX_BYTES + 1 }).ok, false);
    assert.match(X.validateVoice({ ...ok, durationMs: 400 }).error, /muy corta/);
    assert.equal(X.validateVoice({ ...ok, durationMs: X.VOICE_MAX_MS }).ok, true);
    assert.match(X.validateVoice({ ...ok, durationMs: X.VOICE_MAX_MS + 1 }).error, /3 minutos/);
    assert.equal(X.clampVoiceDuration(999999), 180000);
    assert.equal(X.clampVoiceDuration(1234.6), 1235);
    assert.equal(X.clampVoiceDuration(-5), 0);
    assert.equal(X.clampVoiceDuration('x'), 0);
});

test('P8 voz: nombre de archivo, duración legible y errores del micrófono', () => {
    assert.equal(X.voiceFileName('audio/mp4', 1700000000000), 'voz-1700000000000.m4a');
    assert.equal(X.voiceFileName('audio/webm;codecs=opus', 5), 'voz-5.webm');
    assert.equal(X.voiceFileName('audio/ogg', 5), 'voz-5.ogg');
    assert.equal(X.voiceFileName('audio/mpeg', 5), 'voz-5.mp3');
    assert.equal(X.formatDuration(0), '0:00');
    assert.equal(X.formatDuration(83000), '1:23');
    assert.equal(X.formatDuration(180000), '3:00');
    assert.equal(X.formatDuration(undefined), '0:00');
    assert.equal(X.spokenDuration(83000), '1 minuto y 23 segundos');
    assert.equal(X.spokenDuration(1000), '1 segundo');
    assert.equal(X.spokenDuration(120000), '2 minutos');
    assert.match(X.recorderErrorMessage({ name: 'NotAllowedError' }), /permiso para usar tu micrófono/);
    assert.match(X.recorderErrorMessage({ name: 'NotFoundError' }), /No encontramos un micrófono/);
    assert.match(X.recorderErrorMessage({ name: 'NotReadableError' }), /Otra aplicación/);
    assert.equal(X.recorderErrorMessage({ name: 'NotSupportedError' }), X.VOICE_UNSUPPORTED);
    assert.match(X.recorderErrorMessage(null), /No pudimos empezar a grabar/);
});

/* ------------------------- mensajes rápidos: modelo ------------------------- */

test('P9 rápidos: validación, una sola línea y límites', () => {
    assert.deepEqual(X.quickSource('artist'), { table: 'artist_message_templates', kind: 'chat' });
    assert.deepEqual(X.quickSource('client'), { table: 'client_message_templates', kind: null });
    const ok = X.normalizeQuickReply({ title: '  Cuidados  ', body: 'Lava con agua tibia.\n\nNo te rasques.  ' });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.value, { title: 'Cuidados', body: 'Lava con agua tibia. No te rasques.' });
    assert.equal(X.normalizeQuickReply({ title: '', body: 'x' }).ok, false);
    assert.equal(X.normalizeQuickReply({ title: 'x', body: '   ' }).ok, false);
    assert.equal(X.normalizeQuickReply({ title: 'a'.repeat(61), body: 'x' }).ok, false);
    assert.equal(X.normalizeQuickReply({ title: 'a'.repeat(60), body: 'b'.repeat(1000) }).ok, true);
    assert.equal(X.normalizeQuickReply({ title: 'a', body: 'b'.repeat(1001) }).ok, false);
    assert.equal(X.normalizeQuickReply(null).ok, false);
    assert.match(X.quickRepliesError(new Error('[x] quick_replies_limit: máximo 30')), /máximo de 30/);
    assert.match(X.quickRepliesError(new Error('otra cosa')), /No pudimos guardar/);
});

test('P9 rápidos: orden, reordenamiento mínimo e inserción en el campo', () => {
    const list = [
        { id: 'c', title: 'C', sort: 2, created_at: '2026-11-03' },
        { id: 'a', title: 'A', sort: 0, created_at: '2026-11-01' },
        { id: 'b', title: 'B', sort: 0, created_at: '2026-11-02' },
    ];
    assert.deepEqual(X.sortQuickReplies(list).map((i) => i.id), ['a', 'b', 'c']);
    assert.equal(X.nextQuickSort(list), 3);
    assert.equal(X.nextQuickSort([]), 0);

    const down = X.moveQuickReply(list, 'a', 'down');
    assert.equal(down.moved, true);
    assert.deepEqual(down.list.map((i) => i.id), ['b', 'a', 'c']);
    assert.deepEqual(down.list.map((i) => i.sort), [0, 1, 2]);
    // Solo se guardan las filas cuyo sort cambió ('b' ya estaba en 0, 'c' en 2).
    assert.deepEqual(down.changes, [{ id: 'a', sort: 1 }]);
    const up = X.moveQuickReply(down.list, 'c', 'up');
    assert.deepEqual(up.list.map((i) => i.id), ['b', 'c', 'a']);
    assert.deepEqual(up.changes, [{ id: 'c', sort: 1 }, { id: 'a', sort: 2 }]);
    // Extremos y ids desconocidos no mueven nada.
    assert.equal(X.moveQuickReply(list, 'a', 'up').moved, false);
    assert.equal(X.moveQuickReply(list, 'c', 'down').moved, false);
    assert.equal(X.moveQuickReply(list, 'zzz', 'up').moved, false);
    // No muta la lista original.
    assert.deepEqual(list.map((i) => i.id), ['c', 'a', 'b']);

    assert.equal(X.insertQuickReply('', 'Hola', 2000), 'Hola');
    assert.equal(X.insertQuickReply('Buen día.  ', 'Te confirmo\nel turno', 2000), 'Buen día. Te confirmo el turno');
    assert.equal(X.insertQuickReply('abc', '', 2000), 'abc');
    assert.equal(X.insertQuickReply('', 'x'.repeat(50), 10).length, 10);
});

/* --------------------------- automáticos: modelo --------------------------- */

test('P9 automáticos: valores del formulario y validación', () => {
    const blank = X.automationsFromRow(null);
    assert.equal(blank.greeting_enabled, false);
    assert.equal(blank.away_enabled, false);
    assert.equal(blank.away_off_hours, true);
    assert.equal(blank.away_vacation, true);
    assert.ok(blank.greeting_body.length > 10 && blank.away_body.length > 10);
    const saved = X.automationsFromRow({ greeting_enabled: true, greeting_body: ' Hola ', away_enabled: true, away_off_hours: false, away_body: '', away_vacation_body: 'Vuelvo el lunes' });
    assert.equal(saved.greeting_enabled, true);
    assert.equal(saved.greeting_body, 'Hola');
    assert.equal(saved.away_off_hours, false);
    assert.equal(saved.away_body, blank.away_body, 'un texto vacío vuelve a sugerir el predeterminado');
    assert.equal(saved.away_vacation_body, 'Vuelvo el lunes');

    assert.equal(X.normalizeAutomations(blank).ok, true);
    const noGreeting = X.normalizeAutomations({ ...blank, greeting_enabled: true, greeting_body: '   ' });
    assert.equal(noGreeting.ok, false);
    assert.ok(noGreeting.errors.greeting_body);
    const noAway = X.normalizeAutomations({ ...blank, away_enabled: true, away_body: '' });
    assert.ok(noAway.errors.away_body);
    const noScope = X.normalizeAutomations({ ...blank, away_enabled: true, away_off_hours: false, away_vacation: false });
    assert.ok(noScope.errors.away_scope);
    const long = X.normalizeAutomations({ ...blank, greeting_body: 'x'.repeat(601), away_vacation_body: 'y'.repeat(601) });
    assert.ok(long.errors.greeting_body && long.errors.away_vacation_body);
    // Apagado y con texto vacío es válido (se puede guardar sin activar).
    assert.equal(X.normalizeAutomations({ greeting_enabled: false, greeting_body: '', away_enabled: false, away_body: '' }).ok, true);
    const multi = X.normalizeAutomations({ ...blank, greeting_body: 'Hola\r\n\r\n\r\n\r\nTe respondo pronto ' });
    assert.equal(multi.value.greeting_body, 'Hola\n\nTe respondo pronto');
    assert.equal(X.AUTO_LABEL, 'Mensaje automático');
});

test('P9 automáticos: estado actual legible (get_inbox_automation_status)', () => {
    assert.deepEqual(X.awayStatus({ away: true, reason: 'vacation', vacation_end: '2026-11-18' }),
        { tone: 'away', text: 'Ahora: de vacaciones hasta el 18 de noviembre.' });
    assert.deepEqual(X.awayStatus({ away: false, reason: 'open', open_until: '19:00' }),
        { tone: 'open', text: 'Ahora: dentro de tu horario (hasta las 19:00).' });
    const off = X.awayStatus({ away: true, reason: 'off_hours', next_open: '2026-11-16T13:00:00+00:00', timezone: 'America/Argentina/Buenos_Aires' });
    assert.equal(off.tone, 'away');
    assert.match(off.text, /^Ahora: fuera de tu horario \(vuelves el lunes,? 10:00\)\.$/);
    assert.equal(X.awayStatus({ away: true, reason: 'off_hours' }).text, 'Ahora: fuera de tu horario.');
    assert.match(X.awayStatus({ away: false, reason: 'no_schedule' }).text, /solo se enviará durante tus vacaciones/);
    assert.deepEqual(X.awayStatus(null), { tone: 'info', text: '' });
});

test('P9 automáticos: un automático como último mensaje no cuenta como respuesta del artista', () => {
    const index = X.autoTailIndex([
        { quotation_id: 'Q-1', created_at: '2026-11-15T12:00:00.500+00:00' },
        { quotation_id: 'Q-1', created_at: '2026-11-15T10:00:00+00:00' },
        { quotation_id: 'Q-2', created_at: '2026-11-14T09:00:00+00:00' },
        { quotation_id: null, created_at: '2026-11-14T09:00:00+00:00' },
        { quotation_id: 'Q-3', created_at: 'no es fecha' },
        null,
    ], 'quotation_id');
    assert.equal(index.size, 2);
    assert.equal(X.isAutoTail(index, 'Q-1', '2026-11-15T12:00:00.5Z'), true);
    assert.equal(X.isAutoTail(index, 'Q-1', '2026-11-15T12:05:00Z'), false, 'después hubo otro mensaje');
    assert.equal(X.isAutoTail(index, 'Q-2', '2026-11-14T09:00:00Z'), true);
    assert.equal(X.isAutoTail(index, 'Q-9', '2026-11-14T09:00:00Z'), false);
    assert.equal(X.isAutoTail(index, 'Q-1', null), false);
    assert.equal(X.isAutoTail(null, 'Q-1', '2026-11-15T12:00:00.5Z'), false);

    // Con el estado de respuesta del inbox: sin remitente propio = "Esperando respuesta".
    const State = require(path.join(root, 'public', 'shared', 'js', 'inbox-response-state.js'));
    assert.equal(State.responseState({ lastSenderUserId: null, lastSenderRole: 'auto', context: {} }, 'artist-1').key, 'waiting');
    assert.equal(State.responseState({ lastSenderUserId: 'artist-1', context: {} }, 'artist-1').key, 'replied');
});

/* ------------------------------ chat cerrado ------------------------------ */

test('[Chat cerrado] motivo visible según el estado de la cotización', () => {
    assert.equal(X.closedReason('client_rejected'), 'El cliente rechazó la cotización: la conversación está cerrada.');
    assert.equal(X.closedReason('CLIENT_REJECTED'), X.CLIENT_REJECTED_REASON);
    assert.match(X.closedReason('expired'), /venció/);
    assert.match(X.closedReason('completed'), /se completó/);
    assert.equal(X.closedReason(''), 'Esta conversación está cerrada.');
    assert.equal(X.closedReason(undefined), 'Esta conversación está cerrada.');
});

// CF-05: el rechazo cierra la conversación para los dos. Se ejecutan las
// funciones reales de client-chats.js (fila del hilo + redactor) sobre un DOM mínimo.
function loadClientChatClosure() {
    const js = read('public/shared/js/client-chats.js');
    const between = (from, to) => {
        const a = js.indexOf(from);
        const b = js.indexOf(to, a + from.length);
        assert.ok(a > -1 && b > a, 'client-chats.js: ' + from);
        return js.slice(a, b);
    };
    const nodes = {};
    const node = (id) => ({ id, disabled: false, placeholder: '', hidden: false, textContent: '', className: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
    ['cch-input', 'cch-attach', 'cch-reference', 'cch-voice', 'cch-quick'].forEach((id) => { nodes[id] = node(id); });
    const inserted = [];
    nodes['cch-composer'] = { id: 'cch-composer', parentNode: { insertBefore(n, ref) { inserted.push([n, ref.id]); nodes[n.id] = n; } } };
    const sandbox = { nodes, node, out: null };
    vm.runInNewContext(`
        const $ = (id) => nodes[id] || null;
        const el = (tag, className) => Object.assign(node(''), { tag, className });
        let synced = 0;
        const syncSend = () => { synced += 1; };
        ${between('    const REJECTED_CLOSED_REASON', '    const APPLICATION_TAGS')}
        ${between('    function quoteRow(t) {', '    function inboxRow(t) {')}
        ${between('    function setComposerEnabled(enabled, reason) {', '    // Al cambiar de hilo:')}
        out = { quoteRow, setComposerEnabled, REJECTED_CLOSED_REASON, CLOSED_FALLBACK_REASON, synced: () => synced };
    `, sandbox);
    return Object.assign(sandbox.out, { nodes, inserted });
}

test('[Chat cerrado] CF-05: el cliente tampoco escribe en el chat de la cotización que rechazó', () => {
    const page = loadClientChatClosure();
    const thread = (status) => page.quoteRow({ quote_id: 'QN1', artist_name: 'Lau', quote_status: status, unread_for_client: 0 });

    const rejected = thread('client_rejected');
    assert.equal(rejected.closed, true);
    assert.equal(rejected.closedReason, page.REJECTED_CLOSED_REASON);
    assert.equal(page.REJECTED_CLOSED_REASON, 'Rechazaste esta propuesta y la conversación quedó cerrada. Si quieres retomar la idea, inicia una cotización nueva.');
    // El motivo es el del cliente: el del artista habla de "el cliente rechazó".
    assert.notEqual(rejected.closedReason, X.closedReason('client_rejected'));
    assert.equal(thread('CLIENT_REJECTED').closed, true);
    for (const status of ['pending', 'responded', 'client_approved', 'in_progress', 'artist_completed', undefined, null]) {
        const row = thread(status);
        assert.equal(row.closed, false, String(status));
        assert.equal(row.closedReason, '', String(status));
    }

    // Abrir el hilo rechazado: todo el redactor deshabilitado y el motivo a la vista.
    page.setComposerEnabled(!rejected.closed, rejected.closedReason);
    for (const id of ['cch-input', 'cch-attach', 'cch-reference', 'cch-voice', 'cch-quick']) assert.equal(page.nodes[id].disabled, true, id);
    assert.equal(page.nodes['cch-input'].placeholder, page.CLOSED_FALLBACK_REASON);
    assert.equal(page.inserted.length, 1);
    assert.equal(page.inserted[0][1], 'cch-composer', 'el aviso va justo antes del redactor');
    const note = page.nodes['cch-closed-note'];
    assert.equal(note.className, 'cch-closed-note');
    assert.equal(note.attrs.role, 'status');
    assert.equal(note.textContent, page.REJECTED_CLOSED_REASON);
    assert.equal(note.hidden, false);
    assert.equal(page.synced(), 1, 'el botón Enviar se recalcula');

    // Pasar a un hilo abierto: se habilita y el aviso se oculta (no se duplica).
    page.setComposerEnabled(true, '');
    for (const id of ['cch-input', 'cch-attach', 'cch-reference', 'cch-voice', 'cch-quick']) assert.equal(page.nodes[id].disabled, false, id);
    assert.equal(note.hidden, true);
    assert.equal(note.textContent, '');
    assert.equal(page.inserted.length, 1);
    // Un hilo del inbox cerrado sin motivo propio usa el texto genérico.
    page.setComposerEnabled(false);
    assert.equal(note.textContent, page.CLOSED_FALLBACK_REASON);
    assert.equal(note.hidden, false);

    // El resto del módulo ya obedece a row.closed: enviar, voz, rápidos y el botón.
    const js = read('public/shared/js/client-chats.js');
    assert.match(js, /setComposerEnabled\(!row\.closed, row\.closedReason\);/);
    assert.match(js, /if \(!row \|\| row\.closed \|\| sending \|\| \(!text && !files\.length\)\) return;/);
    assert.match(js, /if \(!row \|\| row\.closed \|\| sending\) throw new Error\('conversación no disponible'\);/);
    assert.match(js, /\$\('cch-send'\)\.disabled = sending \|\| !row \|\| row\.closed \|\| !hasContent;/);
    assert.match(read('public/shared/css/client-chats-ds.css'), /\.cch-closed-note\{[^}]*color:var\(--text-muted\)/);
});

/* ------------------------------ repo (PostgREST de prueba) ------------------------------ */

function loadExtrasRepo() {
    const calls = [];
    function builder(table) {
        const call = { table, ops: [] };
        calls.push(call);
        const chain = {};
        ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'order', 'limit', 'maybeSingle'].forEach((op) => {
            // Copia JSON: los argumentos nacen en el contexto del vm (otros prototipos).
            chain[op] = (...args) => { call.ops.push(JSON.parse(JSON.stringify([op, ...args]))); return chain; };
        });
        chain.then = (resolve) => resolve({ data: [{ id: 'row-1' }], error: null });
        return chain;
    }
    const client = {
        from: builder,
        rpc: (name, args) => { calls.push({ rpc: name, args }); return Promise.resolve({ data: { away: false, reason: 'open' }, error: null }); },
    };
    const window = {
        WeotziInboxExtras: X,
        WeotziData: {
            run: async (_label, fn) => { const res = await fn(client); return { data: res.data || null }; },
        },
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'public/shared/js/data/inbox-extras-repo.js'), 'utf8'), { window, console });
    return { D: window.WeotziData, calls };
}

test('P9 rápidos: el artista usa artist_message_templates kind=chat y el cliente su propia tabla', async () => {
    const { D, calls } = loadExtrasRepo();
    await D.QuickReplies.list('artist', 'u-1');
    assert.equal(calls[0].table, 'artist_message_templates');
    assert.deepEqual(calls[0].ops.filter((op) => op[0] === 'eq').map((op) => op.slice(1)), [['user_id', 'u-1'], ['kind', 'chat']]);

    await D.QuickReplies.create('artist', 'u-1', { title: 'T', body: 'B', sort: 4 });
    assert.deepEqual(calls[1].ops[0], ['insert', { user_id: 'u-1', title: 'T', body: 'B', sort: 4, kind: 'chat' }]);

    await D.QuickReplies.update('artist', 'u-1', 'id-9', { title: 'T2', body: 'B2' });
    assert.deepEqual(calls[2].ops[0], ['update', { title: 'T2', body: 'B2' }]);
    // Nunca toca plantillas de cotización (kind = 'quote') ni filas de otro usuario.
    assert.deepEqual(calls[2].ops.filter((op) => op[0] === 'eq').map((op) => op.slice(1)), [['id', 'id-9'], ['user_id', 'u-1'], ['kind', 'chat']]);

    await D.QuickReplies.remove('artist', 'u-1', 'id-9');
    assert.equal(calls[3].ops[0][0], 'delete');
    assert.deepEqual(calls[3].ops.filter((op) => op[0] === 'eq').map((op) => op.slice(1)), [['id', 'id-9'], ['user_id', 'u-1'], ['kind', 'chat']]);

    await D.QuickReplies.reorder('artist', 'u-1', [{ id: 'a', sort: 1 }, { id: 'b', sort: 0 }]);
    assert.deepEqual(calls.slice(4, 6).map((c) => c.ops[0]), [['update', { sort: 1 }], ['update', { sort: 0 }]]);

    await D.QuickReplies.list('client', 'c-1');
    assert.equal(calls[6].table, 'client_message_templates');
    assert.deepEqual(calls[6].ops.filter((op) => op[0] === 'eq').map((op) => op.slice(1)), [['user_id', 'c-1']]);
    await D.QuickReplies.create('client', 'c-1', { title: 'T', body: 'B' });
    assert.deepEqual(calls[7].ops[0], ['insert', { user_id: 'c-1', title: 'T', body: 'B', sort: 0 }]);
});

test('P9 automáticos: el repo guarda una fila por artista y consulta el estado en la base', async () => {
    const { D, calls } = loadExtrasRepo();
    await D.InboxAutomations.get('u-1');
    assert.equal(calls[0].table, 'artist_inbox_automations');
    assert.deepEqual(calls[0].ops.find((op) => op[0] === 'eq'), ['eq', 'user_id', 'u-1']);
    await D.InboxAutomations.save('u-1', { greeting_enabled: true, greeting_body: 'Hola' });
    assert.deepEqual(calls[1].ops[0], ['upsert', { greeting_enabled: true, greeting_body: 'Hola', user_id: 'u-1' }, { onConflict: 'user_id' }]);
    const status = await D.InboxAutomations.status();
    assert.equal(calls[2].rpc, 'get_inbox_automation_status');
    assert.equal(status.reason, 'open');
});

/* ------------------------------ SQL ------------------------------ */

test('P8 migración de voz: buckets, columnas, topes, trigger y RPC', () => {
    const sql = read(MIGRATION_VOICE).toLowerCase();
    assert.match(sql, /add column if not exists attachment_duration_ms integer/);
    assert.match(sql, /chat_messages_voice_duration_check[\s\S]*attachment_duration_ms between 500 and 180000/);
    assert.match(sql, /inbox_messages_voice_size_check[\s\S]*attachment_size between 1 and 6291456/);
    // Suma los MIME de audio a los que ya tenga cada bucket (no los pisa).
    assert.match(sql, /update storage\.buckets b[\s\S]*unnest\(b\.allowed_mime_types \|\| array\['audio\/webm', 'audio\/ogg', 'audio\/mp4', 'audio\/mpeg'\]\)/);
    assert.match(sql, /where b\.id in \('chat-attachments', 'inbox-attachments'\)/);
    assert.doesNotMatch(sql, /insert into storage\.buckets/);
    // Tamaño y MIME salen del objeto real en Storage.
    assert.match(sql, /from storage\.objects o[\s\S]*o\.bucket_id = p_bucket[\s\S]*o\.name = p_path/);
    assert.match(sql, /el audio adjunto no existe/);
    assert.match(sql, /new\.attachment_name := 'mensaje de voz'/);
    assert.match(sql, /create trigger trg_chat_messages_voice\s+before insert on public\.chat_messages[\s\S]*\('chat-attachments'\)/);
    assert.match(sql, /create trigger trg_inbox_messages_voice\s+before insert on public\.inbox_messages[\s\S]*\('inbox-attachments'\)/);
    assert.match(sql, /create or replace function public\.send_inbox_voice_message\(/);
    assert.match(sql, /revoke all on function public\.send_inbox_voice_message\(uuid, text, text, integer, uuid\) from public, anon/);
    assert.match(sql, /grant execute on function public\.send_inbox_voice_message\(uuid, text, text, integer, uuid\) to authenticated/);
    // No pisa objetos de otros frentes.
    assert.doesNotMatch(sql, /create or replace function public\.chat_messages_before_insert/);
    assert.doesNotMatch(sql, /create or replace function public\.send_inbox_message\(/);
    assert.doesNotMatch(sql, /create or replace view/);
    assert.doesNotMatch(sql, /message_kind_check/);
    assert.ok(fs.existsSync(path.join(root, 'supabase/rollbacks/20261116160000_inbox_mensajes_de_voz.down.sql')));
});

test('P9 migración de mensajes rápidos: tabla compartida, RLS de dueño y reglas solo para kind=chat', () => {
    const sql = read(MIGRATION_QUICK).toLowerCase();
    const table = sql.slice(sql.indexOf('create table if not exists public.artist_message_templates'), sql.indexOf('create index if not exists artist_message_templates_user_kind_idx'));
    for (const column of ['id uuid primary key', 'user_id uuid not null', "kind text not null check (kind in ('quote', 'chat'))", 'title text not null', 'body text not null', 'sort integer not null default 0', 'created_at timestamptz', 'updated_at timestamptz']) {
        assert.ok(table.includes(column), column);
    }
    assert.match(sql, /artist_message_templates_chat_limits\s+check \(\s*kind <> 'chat'/);
    assert.match(sql, /alter table public\.artist_message_templates enable row level security/);
    for (const action of ['select', 'insert', 'update', 'delete']) {
        assert.match(sql, new RegExp(`create policy artist_message_templates_owner_${action}[\\s\\S]*?user_id = \\(select auth\\.uid\\(\\)\\)`));
        assert.match(sql, new RegExp(`create policy client_message_templates_owner_${action}[\\s\\S]*?user_id = \\(select auth\\.uid\\(\\)\\)`));
    }
    assert.match(sql, /revoke all on table public\.artist_message_templates from anon/);
    assert.match(sql, /revoke all on table public\.client_message_templates from anon/);
    assert.match(sql, /if new\.kind is distinct from 'chat' then\s+return new;/);
    assert.match(sql, /quick_replies_limit/);
    assert.doesNotMatch(sql, /drop table/);
    // La reversa no borra la tabla compartida con cot-respuesta.
    const down = read('supabase/rollbacks/20261116160100_inbox_mensajes_rapidos.down.sql').toLowerCase();
    assert.doesNotMatch(down, /drop table if exists public\.artist_message_templates/);
    assert.match(down, /delete from public\.artist_message_templates where kind = 'chat'/);
    assert.match(down, /drop table if exists public\.client_message_templates/);
});

test('P9 migración de automáticos: en la base, una vez por hilo/ventana, marcados y sin bucles', () => {
    const sql = read(MIGRATION_AUTO).toLowerCase();
    assert.match(sql, /create table if not exists public\.artist_inbox_automations/);
    assert.match(sql, /alter table public\.artist_inbox_automations enable row level security/);
    assert.match(sql, /add column if not exists auto_kind text/);
    assert.match(sql, /auto_kind is null or auto_kind in \('greeting', 'away'\)/);
    // El usuario final no puede marcar un mensaje como automático.
    assert.match(sql, /pg_trigger_depth\(\) > 1\s+and coalesce\(current_setting\('weotzi\.inbox_auto', true\), ''\) = '1'[\s\S]*?else\s+new\.auto_kind := null;/);
    // Triggers AFTER INSERT solo para mensajes de clientes que no son automáticos.
    assert.match(sql, /create trigger trg_chat_messages_zz_auto_reply\s+after insert on public\.chat_messages\s+for each row\s+when \(new\.sender_type = 'client' and new\.auto_kind is null\)/);
    assert.match(sql, /create trigger trg_zz_inbox_messages_auto_reply\s+after insert on public\.inbox_messages\s+for each row\s+when \(new\.sender_role = 'client' and new\.sender_user_id is not null and new\.auto_kind is null\)/);
    // Una sola vez: lock por hilo + saludo ya enviado + última ausencia vs. inicio de la ventana.
    assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('weotzi:inbox-auto:chat:' \|\| new\.quotation_id, 0\)\)/);
    assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('weotzi:inbox-auto:inbox:' \|\| new\.thread_id::text, 0\)\)/);
    assert.match(sql, /p_last_away_at is null or p_last_away_at < \(v_state ->> 'window_start'\)::timestamptz/);
    assert.match(sql, /not coalesce\(p_greeting_sent, false\)/);
    // Si el artista escribió a mano en la última hora (está presente) no hay automáticos.
    assert.match(sql, /if coalesce\(p_artist_wrote_recently, false\) then\s+return;/);
    assert.match(sql, /m\.auto_kind is null and m\.created_at > now\(\) - interval '60 minutes'/);
    // Sin automáticos en cotizaciones cerradas (incluye la rechazada por el cliente).
    assert.match(sql, /v_status in \('client_rejected', 'completed', 'expired', 'cancelled', 'canceled', 'rejected'\)/);
    // Un error del automático no rompe el mensaje del cliente.
    assert.equal((sql.match(/exception when others then/g) || []).length, 2);
    // Horario y vacaciones del artista.
    assert.match(sql, /app_settings/);
    assert.match(sql, /a\.vacation_start, a\.vacation_end/);
    assert.match(sql, /pg_timezone_names/);
    // Funciones privadas sin acceso por API; el estado solo para usuarios con sesión.
    for (const fn of ['inbox_artist_away_state(uuid, timestamptz)', 'inbox_auto_reply_pick(uuid, boolean, boolean, timestamptz, boolean)', 'chat_messages_auto_reply()', 'inbox_messages_auto_reply()']) {
        assert.ok(sql.includes(`revoke all on function private.${fn} from public, anon, authenticated`), fn);
    }
    assert.match(sql, /revoke all on function public\.get_inbox_automation_status\(\) from public, anon/);
    // No pisa objetos de otros frentes.
    assert.doesNotMatch(sql, /create or replace function public\.chat_messages_before_insert/);
    assert.doesNotMatch(sql, /create or replace function public\.touch_inbox_message_thread/);
    assert.doesNotMatch(sql, /create or replace view/);
    assert.ok(fs.existsSync(path.join(root, 'supabase/rollbacks/20261116160200_inbox_respuestas_automaticas.down.sql')));
});

test('migraciones del frente: dentro del rango asignado, con begin/commit y reversa', () => {
    const mine = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((name) => /inbox_(mensajes_de_voz|mensajes_rapidos|respuestas_automaticas)\.sql$/.test(name));
    assert.equal(mine.length, 3);
    for (const name of mine) {
        const stamp = Number(name.slice(0, 14));
        assert.ok(stamp >= 20261116160000 && stamp <= 20261116160999, name);
        const sql = read('supabase/migrations/' + name);
        assert.equal((sql.match(/^begin;$/gm) || []).length, 1, name);
        assert.equal((sql.match(/^commit;$/gm) || []).length, 1, name);
        assert.ok(fs.existsSync(path.join(root, 'supabase/rollbacks', name.replace(/\.sql$/, '.down.sql'))), name);
    }
});

/* ------------------------------ repos existentes ------------------------------ */

test('repos de chat e inbox: voz, automáticos recientes y limpieza de adjuntos', () => {
    const chat = read('public/shared/js/data/quotations-repo.js');
    assert.match(chat, /row\.attachment_duration_ms = Math\.round\(Number\(attachment\.durationMs\) \|\| 0\)/);
    assert.match(chat, /extras\.isVoiceMime\(file\.type\) && file\.size <= extras\.VOICE_MAX_BYTES/);
    assert.match(chat, /async listRecentAuto\(limit = 200\)[\s\S]*c\.from\('chat_messages'\)\.select\('quotation_id,created_at,auto_kind'\)\.not\('auto_kind', 'is', null\)/);
    assert.match(chat, /async removeAttachment\(path\)[\s\S]*storage\.from\('chat-attachments'\)\.remove\(\[path\]\)/);

    const inbox = read('public/shared/js/data/inbox-repo.js');
    assert.match(inbox, /c\.rpc\('send_inbox_voice_message', \{\s*p_thread_id: threadId,\s*p_attachment_path: attachment\?\.path \|\| null,\s*p_attachment_mime: attachment\?\.type \|\| null,\s*p_duration_ms:/);
    assert.match(inbox, /async listRecentAuto\(limit = 200\)[\s\S]*\.select\('thread_id,created_at,auto_kind'\)\s*\.not\('auto_kind', 'is', null\)/);
    // '*' trae las columnas nuevas sin romper si la migración todavía no corrió.
    assert.match(inbox, /c\.from\('inbox_messages'\)\s*\.select\('\*'\)\s*\.eq\('thread_id', threadId\)/);
    // El aviso por email sigue siendo uno solo por mensaje (también para la voz).
    assert.equal((inbox.match(/sendN8NEvent\('inbox_message_received'/g) || []).length, 1);
    assert.equal((inbox.match(/notifyRecipient\(\(saved && saved\.thread_id\) \|\| threadId, data\)/g) || []).length, 2);
});

/* ------------------------------ páginas ------------------------------ */

test('inbox del artista: botones, aviso de cierre y orden de scripts', () => {
    const html = read('public/artist/inbox/index.html');
    assert.match(html, /<link rel="stylesheet" href="\/shared\/css\/wo-inbox-extras\.css">/);
    assert.ok(html.indexOf('/shared/css/artist-inbox-ds.css') < html.indexOf('/shared/css/wo-inbox-extras.css'));
    assert.match(html, /<button type="button"[^>]*id="ai-voice"[^>]*aria-label="Grabar mensaje de voz"/);
    assert.match(html, /<button type="button"[^>]*id="ai-quick"[^>]*aria-label="Mensajes rápidos"/);
    assert.match(html, /<button type="button"[^>]*id="ai-auto-open"[^>]*>[\s\S]*?Respuestas automáticas<\/button>/);
    assert.match(html, /<p class="wo-inbox-closed" id="ai-closed-note" role="note" hidden><\/p>\s*<form class="ai-composer"/);
    const order = ['inbox-chat-model.js', 'inbox-extras-model.js', 'data/inbox-extras-repo.js', 'wo-voice.js', 'wo-quick-replies.js', 'artist-inbox-automations.js', 'artist-inbox.js']
        .map((name) => html.indexOf('/shared/js/' + name + '"'));
    order.forEach((at, i) => assert.ok(at > 0 && (i === 0 || at > order[i - 1]), 'orden de scripts #' + i));
});

test('inbox del artista: voz, rápidos, automáticos, marca y hilo en solo lectura', () => {
    const js = read('public/shared/js/artist-inbox.js');
    // [Chat cerrado]
    assert.match(js, /const CLOSED_QUOTE_STATUSES = \['completed', 'client_rejected', 'expired'\]/);
    assert.match(js, /closedReason: X && CLOSED_QUOTE_STATUSES\.includes\(status\) \? X\.closedReason\(status\) : ''/);
    assert.match(js, /function applyThreadAccess\(row\)[\s\S]*note\.hidden = !closed;[\s\S]*el\('ai-composer'\)\.hidden = closed;/);
    assert.match(js, /closed: item\.status === 'closed' \|\| rejected/);
    assert.match(js, /subscribeQuotationUpdates\('artist-inbox-quotes-' \+ state\.userId/);
    // Voz
    assert.match(js, /window\.WoVoice\.attachRecorder\(\{[\s\S]*onSend: sendVoiceMessage/);
    assert.match(js, /async function sendVoiceMessage\(voice\)[\s\S]*repo\.uploadAttachment\(row\.id, state\.userId, voice\.file\)[\s\S]*D\.Inbox\.sendVoiceMessage\(\{ threadId: row\.id, attachment: uploaded, durationMs: voice\.durationMs \}\)/);
    assert.match(js, /data-wo-voice-path="' \+ esc\(message\.attachmentPath\)/);
    assert.match(js, /window\.WoVoice\.hydrate\(host, signedUrlFor\)/);
    // Rápidos y automáticos
    assert.match(js, /window\.WoQuickReplies\.attach\(\{\s*role: 'artist'/);
    assert.match(js, /window\.WoInboxAutomations\.open\(\{/);
    // Marca y estado de respuesta
    assert.match(js, /message\.autoKind \? '<span class="wo-auto-tag">'/);
    assert.match(js, /lastSenderUserId: item\.last_message_sender === 'artist' && !auto \? state\.userId : null/);
    assert.match(js, /auto \? \{ lastSenderUserId: null, lastSenderRole: 'auto' \} : null/);
    // Al cambiar de hilo se corta la grabación y el audio.
    assert.match(js, /function resetThreadExtras\(\)[\s\S]*state\.voice\.reset\(\)[\s\S]*window\.WoVoice\.resetPlayers\(\)/);
});

// CF-10: wo-notify.js reconoce la conversación en pantalla por ?quote= / ?thread=.
test('inbox del artista: la dirección sigue al hilo abierto', () => {
    const links = require(path.join(root, 'public', 'shared', 'js', 'inbox-deeplink.js'));
    const at = 'https://beta.weotzi.com/artist/inbox';
    // Chat de cotización → ?quote=<quote_id>; el resto → ?thread=<id>.
    assert.equal(links.threadLocation({ source: 'quote', id: 'WO-1' }, at), '/artist/inbox?quote=WO-1');
    assert.equal(links.threadLocation({ source: 'unified', id: 'th-1' }, at), '/artist/inbox?thread=th-1');
    assert.equal(links.threadLocation({ source: 'support', id: 12 }, at), '/artist/inbox?thread=12');
    // Cambiar de hilo reemplaza el del enlace de llegada; el filtro y el hash se conservan.
    assert.equal(
        links.threadLocation({ source: 'unified', id: 'th-2' }, `${at}?quote=WO-1&opportunity=spot&application=7&trip=t1&filter=clients#x`),
        '/artist/inbox?filter=clients&thread=th-2#x');
    assert.equal(links.threadLocation({ source: 'quote', id: 'WO-2' }, `${at}?thread=th-1`), '/artist/inbox?quote=WO-2');
    // Cerrar el hilo (o la fila "Soporte" sin conversación todavía) no deja ninguno.
    assert.equal(links.threadLocation(null, `${at}?quote=WO-1&filter=clients`), '/artist/inbox?filter=clients');
    assert.equal(links.threadLocation({ source: 'support', id: null }, `${at}?thread=th-1`), '/artist/inbox');
    assert.equal(links.threadLocation({ source: 'quote', id: 'WO-1' }, ''), null, 'sin dirección no hay nada que escribir');
    // Lo que escribe es lo que después resuelve el enlace profundo.
    const rows = [{ key: 'quote:WO-1', source: 'quote', id: 'WO-1' }, { key: 'unified:th-1', source: 'unified', id: 'th-1' }];
    for (const row of rows) {
        const search = new URL(links.threadLocation(row, at), at).searchParams;
        assert.equal(links.resolveDeepLink(rows, search).key, row.key);
    }

    const js = read('public/shared/js/artist-inbox.js');
    assert.match(js, /function syncThreadUrl\(row\)[\s\S]*?threadLocation\(row, window\.location\.href\)[\s\S]*?history\.replaceState\(/);
    assert.match(js, /async function openThread\(key\) \{[\s\S]*?state\.activeKey = key;\s*syncThreadUrl\(row\);/);
    assert.match(js, /function closeThread\(\) \{\s*state\.activeKey = null;\s*syncThreadUrl\(null\);/);
    // En móvil volver a la lista saca el hilo de la pantalla; en escritorio sigue a la vista.
    assert.match(js, /function closeMobileThread\(\) \{[\s\S]*?min-width: 769px[\s\S]*?if \(!wide\) syncThreadUrl\(null\);/);
    const html = read('public/artist/inbox/index.html');
    assert.ok(html.indexOf('/shared/js/inbox-deeplink.js') < html.indexOf('/shared/js/artist-inbox.js'), 'el módulo de enlaces carga antes');
});

test('inbox del cliente: voz, rápidos y marca de automático sin innerHTML', () => {
    const html = read('public/client/chats/index.html');
    assert.match(html, /id="cch-voice"[^>]*aria-label="Grabar mensaje de voz"/);
    assert.match(html, /id="cch-quick">[\s\S]*?Mensajes rápidos\s*<\/button>/);
    assert.match(html, /<link rel="stylesheet" href="\/shared\/css\/wo-inbox-extras\.css">/);
    const order = ['inbox-chat-model.js', 'inbox-extras-model.js', 'data/inbox-extras-repo.js', 'wo-voice.js', 'wo-quick-replies.js', 'client-chats.js']
        .map((name) => html.indexOf('/shared/js/' + name + '"'));
    order.forEach((at, i) => assert.ok(at > 0 && (i === 0 || at > order[i - 1]), 'orden de scripts #' + i));
    // El cliente no configura automáticos (son del artista).
    assert.doesNotMatch(html, /artist-inbox-automations\.js/);

    const js = read('public/shared/js/client-chats.js');
    assert.doesNotMatch(js, /\.innerHTML\s*=/);
    assert.match(js, /window\.WoVoice\.attachRecorder\(\{/);
    assert.match(js, /window\.WoQuickReplies\.attach\(\{\s*role: 'client'/);
    assert.match(js, /window\.WoVoice\.player\(a\.source \+ ':' \+ a\.path/);
    assert.match(js, /if \(m\.auto\) wrap\.appendChild\(el\('span', 'wo-auto-tag cch-auto-tag'/);
    assert.match(js, /D\.Inbox\.sendVoiceMessage\(\{ threadId: row\.id, attachment: uploaded, durationMs: voice\.durationMs \}\)/);
    // Un automático del artista no deja el hilo en "Esperando tu respuesta".
    assert.match(js, /function turnPending\(r\)[\s\S]*!last\.mine && !last\.system && !last\.auto/);
    assert.match(js, /toggleTurnTag\(!message\.auto\)/);
});

test('otras vistas del chat de cotización muestran la marca de mensaje automático', () => {
    assert.match(read('public/shared/js/client-dashboard.js'), /if \(msg\.auto_kind\) time\.appendChild\(document\.createTextNode\(' · Mensaje automático'\)\)/);
    assert.match(read('public/shared/js/quotation-detail-figma.js'), /artist \? \(message\.auto_kind \? 'Mensaje automático' : 'Vos'\)/);
    assert.match(read('public/shared/js/quotations-summary.js'), /mine \? \(m\.auto_kind \? 'Mensaje automático' : 'Vos'\) : 'Cliente'/);
});

/* ------------------------------ módulos nuevos ------------------------------ */

test('P8 grabador y reproductor: MediaRecorder, mantener o pulsar, vista previa y fallbacks', () => {
    const js = read('public/shared/js/wo-voice.js');
    assert.match(js, /navigator\.mediaDevices\.getUserMedia\(\{/);
    assert.match(js, /new window\.MediaRecorder\(stream, \{ mimeType: preferred, audioBitsPerSecond: 48000 \}\)/);
    // Mantener (pointerdown + soltar) o pulsar (click con teclado).
    assert.match(js, /button\.addEventListener\('pointerdown'/);
    assert.match(js, /performance\.now\(\) - pressAt >= HOLD_MS && state === 'recording'\) stop\(false\)/);
    assert.match(js, /start\(\); \/\/ teclado o lectores de pantalla/);
    // Tope de duración, vista previa y cancelar/enviar.
    assert.match(js, /window\.setTimeout\(function \(\) \{ stop\(true\); \}, X\.VOICE_MAX_MS\)/);
    assert.match(js, /X\.validateVoice\(\{ type: mime, size: blob\.size, durationMs: durationMs \}\)/);
    assert.match(js, /createPlayer\(\{ durationMs: durationMs, src: clip\.url/);
    assert.match(js, /'Descartar mensaje de voz'/);
    assert.match(js, /'Enviar mensaje de voz'/);
    // Fallbacks: sin soporte o sin permiso.
    assert.match(js, /fail\(X\.VOICE_UNSUPPORTED\)/);
    assert.match(js, /fail\(X\.recorderErrorMessage\(error\)\)/);
    // Libera el micrófono y solo reproduce URLs https: o blob: locales.
    assert.match(js, /track\.stop\(\)/);
    assert.match(js, /\/\^\(https:\|blob:\)\/i\.test/);
    // Reproductor accesible.
    assert.match(js, /'Reproducir mensaje de voz'/);
    assert.match(js, /'Pausar mensaje de voz'/);
    assert.match(js, /seek\.type = 'range'/);
    assert.match(js, /aria-valuetext/);
    assert.match(js, /No se pudo reproducir en este navegador\./);
    assert.doesNotMatch(js, /\.innerHTML/);
});

test('P9 módulos de mensajes rápidos y automáticos: gestión completa y diálogos accesibles', () => {
    const quick = read('public/shared/js/wo-quick-replies.js');
    for (const call of ['api.list(role, uid)', 'api.create(role, uid', 'api.update(role, uid, editingId', 'api.remove(role, uid, item.id)', 'api.reorder(role, uid, result.changes)']) {
        assert.ok(quick.includes(call), call);
    }
    assert.match(quick, /X\.insertQuickReply\(input\.value, item\.body, max\)/);
    assert.match(quick, /input\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/);
    assert.match(quick, /dialog\.setAttribute\('aria-modal', 'true'\)/);
    assert.match(quick, /event\.key === 'Escape'/);
    assert.doesNotMatch(quick, /\.innerHTML/);

    const auto = read('public/shared/js/artist-inbox-automations.js');
    assert.match(auto, /X\.normalizeAutomations\(read\(\)\)/);
    assert.match(auto, /await api\.save\(uid, result\.value\)/);
    assert.match(auto, /api\.status\(\)/);
    assert.match(auto, /input\.setAttribute\('role', 'switch'\)/);
    assert.match(auto, /dialog\.setAttribute\('aria-modal', 'true'\)/);
    assert.doesNotMatch(auto, /\.innerHTML/);
    // Los automáticos los envía la base: el navegador no manda mensajes desde acá.
    assert.doesNotMatch(auto, /sendMessage|send_inbox_message/);
});

test('CSS de la ronda 2: mobile first, composer por container query y sin hex sueltos', () => {
    const css = read('public/shared/css/wo-inbox-extras.css');
    assert.doesNotMatch(css, /@media\s*\(\s*max-width/i);
    assert.match(css, /\.ai-thread \{ container-type: inline-size; container-name: wo-inbox-thread; \}/);
    assert.match(css, /@container wo-inbox-thread \(min-width: 520px\)/);
    assert.match(css, /\.ai-composer\.is-voice > :not\(\.wo-voice-bar\):not\(\.wo-qr-panel\)/);
    assert.match(css, /\.wo-inbox-closed \{/);
    assert.match(css, /\.wo-auto-tag \{/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /:focus-visible/);
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'solo tokens del DS');
});

test('idioma: los textos nuevos van en español neutro (sin voseo)', () => {
    // Formas voseantes y regionalismos típicos ("Guardá", "podés", "acá", "vos").
    // \b no sirve con tildes: los límites se marcan con letras Unicode.
    const voseo = /(?<!\p{L})(querés|podés|tenés|sabés|elegí|escribí|contanos|escribinos|avisanos|hacé|usá|probá|revisá|activá|guardá|grabá|mantené|volvé|cerrá|borrá|creá|mirá|tocá|pulsá|fijate|acá|vos)(?!\p{L})/u;
    assert.ok(voseo.test('guardá los cambios') && voseo.test('si querés') && !voseo.test('guarda los cambios, usa tu voz'));
    for (const file of NEW_FRONT_FILES) {
        // Solo literales de texto (los comentarios técnicos no son interfaz).
        const strings = read(file).match(/'(?:[^'\\\n]|\\.)*'/g) || [];
        assert.ok(strings.length > 5, file);
        strings.forEach((literal) => {
            assert.doesNotMatch(literal.toLowerCase().normalize('NFC'), voseo, `${file}: ${literal}`);
        });
    }
});

test('activos de imagen: el frente no necesita imágenes nuevas', () => {
    assert.deepEqual(JSON.parse(read('docs/plans/ronda2-assets/inbox.json')), []);
});
