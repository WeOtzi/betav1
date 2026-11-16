'use strict';

// Ronda 2 · integración · guardas de quotations_db y de la vista chat_threads
// (hallazgos SEG-04 y SEG-01). Contratos de las migraciones por lectura: las
// dos se validaron en la base viva dentro de begin … rollback.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const GUARD = 'supabase/migrations/20261116220000_quotations_guardas_vinculo_y_origen.sql';
const GUARD_DOWN = 'supabase/rollbacks/20261116220000_quotations_guardas_vinculo_y_origen.down.sql';
const THREADS = 'supabase/migrations/20261116220100_chat_threads_sin_client_email.sql';
const THREADS_DOWN = 'supabase/rollbacks/20261116220100_chat_threads_sin_client_email.down.sql';

test('migraciones de integración: después de las de los frentes, transaccionales y con reversa', () => {
    const round = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((name) => /^20261116\d{6}_/.test(name)).sort();
    for (const file of [GUARD, THREADS]) {
        const name = path.basename(file);
        assert.ok(round.includes(name), name);
        assert.ok(round.indexOf(name) > round.indexOf('20261116210000_support_ticket_reports.sql'), `${name} corre después de los frentes`);
        const sql = read(file);
        assert.match(sql, /^begin;$/m);
        assert.match(sql, /^commit;$/m);
        const down = `supabase/rollbacks/${name.replace(/\.sql$/, '.down.sql')}`;
        assert.ok(exists(down), `${name} sin reversa`);
        assert.ok(sql.includes(down), 'la migración nombra su reversa');
        assert.match(read(down), /^begin;$/m);
        assert.match(read(down), /^commit;$/m);
    }
    // La guarda del vínculo corre antes que la vista: no dependen entre sí, pero el orden queda fijo.
    assert.ok(path.basename(GUARD) < path.basename(THREADS));
});

test('SEG-04: el artista dueño no reescribe el vínculo con el cliente ni el origen de la cotización', () => {
    const sql = read(GUARD);
    const fn = sql.slice(sql.indexOf('create or replace function public.fn_quotations_client_column_guard()'), sql.indexOf('comment on function'));
    assert.ok(fn.length > 500);
    assert.match(fn, /language plpgsql\nset search_path = public, pg_temp/);
    assert.doesNotMatch(fn, /security definer/, 'current_user tiene que ser el rol que escribe');

    const at = (text) => { const i = fn.indexOf(text); assert.ok(i > -1, text); return i; };
    const server = at("if current_user not in ('anon', 'authenticated') then\n    return new;");
    const support = at('if public.is_support_user() then\n    return new;');
    const link = at('if new.client_user_id is distinct from old.client_user_id');
    const origin = at('if new.source is distinct from old.source\n     or new.quotation_medium is distinct from old.quotation_medium then');
    const owner = at('if v_uid is not null and old.artist_id is not null and old.artist_id = v_uid then\n    return new;');
    const clientColumns = at("and n.key not in ('client_user_id', 'client_deleted_at', 'updated_at')");
    // El servidor y soporte pasan; las dos reglas valen para todos y van ANTES del atajo del artista dueño.
    assert.ok(server < support && support < link && link < origin && origin < owner && owner < clientColumns);

    // client_user_id: solo NULL → la propia cuenta, y nunca la del artista de la cotización.
    assert.match(fn, /and not \(\s+old\.client_user_id is null\s+and v_uid is not null\s+and new\.client_user_id = v_uid\s+and old\.artist_id is distinct from v_uid\s+\) then\s+raise exception 'Solo puedes vincular la cotización a tu propia cuenta de cliente\.'\s+using errcode = '42501';/);
    assert.match(fn, /raise exception 'El origen de la cotización no se puede modificar\.'\s+using errcode = '42501';/);
    assert.match(fn, /raise exception 'No puedes modificar estos datos de la cotización: %'/);
    // No toca el trigger ni otras funciones de la tabla.
    assert.doesNotMatch(sql, /create trigger|drop trigger|create or replace function public\.(?!fn_quotations_client_column_guard)/);

    // Reversa: la definición anterior (20261115130000), con el atajo del artista primero.
    const down = read(GUARD_DOWN);
    const previous = read('supabase/migrations/20261115130000_cot_form_rls_cierre.sql');
    const body = (text) => {
        const start = text.indexOf('create or replace function public.fn_quotations_client_column_guard()');
        return text.slice(start, text.indexOf('$$;', start) + 3);
    };
    assert.equal(body(down), body(previous), 'la reversa restaura la función tal como estaba');
    assert.match(down, /comment on function public\.fn_quotations_client_column_guard\(\) is null;/);
});

test('SEG-04: las guardas de la negociación y de las sesiones dependen de client_user_id (por eso se protege)', () => {
    const negociacion = read('supabase/migrations/20261116140000_negociacion_propuestas.sql');
    assert.match(negociacion, /and old\.agreement_approved_at is not null\s+and old\.client_user_id is not null/);
    assert.match(negociacion, /El vínculo con el\n--            cliente lo protege 20261116220000/);
    const sesiones = read('supabase/migrations/20261116150000_sesiones_confirmacion_ubicacion.sql');
    assert.match(sesiones, /client_user_id/);
});

test('SEG-01: chat_threads ya no entrega el email del cliente', () => {
    const sql = read(THREADS);
    assert.match(sql, /drop view if exists public\.chat_threads;\n\ncreate view public\.chat_threads\nwith \(security_invoker = on\) as/);
    const view = sql.slice(sql.indexOf('create view public.chat_threads'), sql.indexOf('comment on view'));
    assert.doesNotMatch(view, /client_email|client_whatsapp|client_instagram|client_contact_preference/);
    // Mismas columnas que la vista vigente (20261115170000) menos client_email.
    const columnsOf = (text) => text.slice(text.indexOf('select q.quote_id'), text.indexOf('from public.quotations_db q'))
        .replace(/^select /, '').split(',\n').map((line) => line.trim()).filter(Boolean);
    const current = read('supabase/migrations/20261115170000_chat_messages_hardening_adjuntos.sql');
    const before = columnsOf(current.slice(current.indexOf('create or replace view public.chat_threads')));
    assert.equal(before.length, 20);
    assert.deepEqual(columnsOf(view), before.filter((column) => column !== 'q.client_email'));
    assert.match(view, /where q\.client_user_id is not null;/);
    assert.match(view, /case when m\.message_kind = 'image' then 'Imagen adjunta'/, 'conserva el extracto de los adjuntos');
    // Privilegios explícitos: lectura para authenticated (con su RLS) y nada para anon.
    assert.match(sql, /revoke all on table public\.chat_threads from public, anon, authenticated;\ngrant select on table public\.chat_threads to authenticated;\ngrant select on table public\.chat_threads to service_role;/);
    assert.doesNotMatch(sql, /grant[^;]*chat_threads to (anon|public)/);
    assert.match(sql, /notify pgrst, 'reload schema';/);

    const down = read(THREADS_DOWN);
    assert.match(down, /drop view if exists public\.chat_threads;/);
    assert.deepEqual(columnsOf(down.slice(down.indexOf('create view public.chat_threads'))), before, 'la reversa vuelve a la vista anterior');
    assert.match(down, /revoke all on table public\.chat_threads from anon;/);

    // Nadie usa esa columna de la vista: los hilos se pintan con el nombre del cliente.
    for (const file of ['artist-inbox.js', 'client-chats.js', 'inbox-chat-model.js', 'inbox-extras-model.js', 'wo-artist-menu.js']) {
        assert.doesNotMatch(read(`public/shared/js/${file}`), /client_email/, file);
    }
    // La demo refleja la vista real.
    const fixtures = read('public/shared/js/wo-demo-fixtures.js');
    const demoView = fixtures.slice(fixtures.indexOf('chat_threads: function (store) {'), fixtures.indexOf('public_review_summary: function (store) {'));
    assert.ok(demoView.length > 200);
    assert.doesNotMatch(demoView, /client_email/);
});

// DB-02: con beta 2.4.0 sirviendo, las migraciones de negociación y de sesiones
// rompen "Editar acuerdo" y reprogramar o borrar sesiones. El orden queda escrito.
test('DB-02: la guía de despliegue fija el orden de la ronda 2 (primero el código, después las migraciones)', () => {
    const doc = read('deployments/DEPLOY.md');
    const at = doc.indexOf('## Ronda 2 · orden de despliegue y migraciones');
    assert.ok(at > -1, 'sección de la ronda 2');
    const section = doc.slice(at, doc.indexOf('\n## ', at + 10));
    const step = (n) => section.indexOf('\n' + n + '. **');
    assert.ok(step(1) > -1 && step(1) < step(2) && step(2) < step(3) && step(3) < step(4), 'cuatro pasos en orden');
    assert.match(section.slice(step(1), step(2)), /Primero el código/);
    assert.match(section.slice(step(2), step(3)), /las migraciones[\s\S]*20261116\*\.sql[\s\S]*en orden de nombre/);
    assert.match(section.slice(step(3), step(4)), /No aplicar `20261116140000` ni `20261116150000` mientras 2\.4\.0 esté sirviendo/);
    // Volver a 2.4.0: primero las reversas, la de sesiones antes que la de negociación.
    const back = section.slice(step(4));
    const downs = ['supabase/rollbacks/20261116150000_sesiones_confirmacion_ubicacion.down.sql', 'supabase/rollbacks/20261116140000_negociacion_propuestas.down.sql'];
    for (const file of downs) {
        assert.ok(back.includes(file), file);
        assert.ok(exists(file), file + ' no existe');
    }
    assert.ok(back.indexOf(downs[0]) < back.indexOf(downs[1]), 'orden inverso al de aplicación');
    for (const file of ['supabase/migrations/20261116140000_negociacion_propuestas.sql', 'supabase/migrations/20261116150000_sesiones_confirmacion_ubicacion.sql']) {
        assert.ok(exists(file), file);
        assert.ok(section.includes(path.basename(file)), path.basename(file));
    }
    // El checklist general ya no manda aplicar estas migraciones antes del deploy.
    assert.match(doc.slice(0, at), /Excepción, ronda 2:[^\n]*\n[^\n]*#ronda-2--orden-de-despliegue-y-migraciones/);

    // Lo que la guía promete del código nuevo sin migraciones sigue siendo cierto.
    assert.match(read('lib/routes/negociacion.js'), /isMissingSchema\(err\)\) return res\.json\(\{ success: true, available: false \}\)/);
    assert.match(read('lib/sesiones.js'), /'sessions_unavailable'/);
    // Y lo que rompe a 2.4.0 sigue en las migraciones que nombra.
    const sessions = read('supabase/migrations/20261116150000_sesiones_confirmacion_ubicacion.sql');
    for (const code of ['WOS01', 'WOS03']) assert.ok(sessions.includes(`errcode = '${code}'`), code);
    assert.match(read('supabase/migrations/20261116140000_negociacion_propuestas.sql'), /El acuerdo ya está aprobado por ambas partes/);
});

test('SEG-01: el riesgo residual por REST queda documentado', () => {
    const doc = read('docs/TECHNICAL.md');
    assert.match(doc, /### 7\.1 Contacto del cliente en las cotizaciones/);
    assert.match(doc, /Riesgo residual \(abierto\)/);
    assert.match(doc, /GET \/api\/cot-detalle\/client-contacts/);
    assert.match(doc, /revoke select/);
});
