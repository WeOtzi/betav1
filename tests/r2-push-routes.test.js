'use strict';

// Ronda 2 · frente push · lib/routes/push.js, lib/repos/push.js y la migración
// 20261116170000_push_notifications.sql (contrato; la validación real corrió
// en vivo dentro de begin…rollback).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const webPush = require('../lib/web-push');
const pushDispatch = require('../lib/push-dispatch');
const routes = require('../lib/routes/push');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'lucia.cliente@example.com' };
const P256DH = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
const AUTH = 'BTBZMqHH6r4Tts7J_aSIgg';
const SUBSCRIPTION = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', expirationTime: null, keys: { p256dh: P256DH, auth: AUTH } };

function fakeRes() {
    return {
        statusCode: 200, headers: {}, body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        set(key, value) { this.headers[key] = value; return this; }
    };
}

function setup(overrides = {}) {
    const keys = webPush.generateVapidKeys();
    const calls = { upsert: [], deleted: [], trimmed: [], replaced: [], notified: [] };
    const repo = {
        MAX_SUBSCRIPTIONS_PER_USER: 12,
        count: 1,
        async upsertSubscription(row) { calls.upsert.push(row); return { id: 's1' }; },
        async countSubscriptions() { return repo.count; },
        async deleteOldestSubscriptions(userId, keep) { calls.trimmed.push([userId, keep]); return 1; },
        async deleteByEndpoint(endpoint, userId) { calls.deleted.push([endpoint, userId]); return [{ id: 's1' }]; },
        async replaceEndpoint(oldEndpoint, oldAuth, next) { calls.replaced.push([oldEndpoint, oldAuth, next]); return { id: 's1' }; }
    };
    const deps = {
        repo,
        log: () => {},
        resolveUser: async (req) => (req.headers && req.headers.authorization ? USER : null),
        vapid: () => webPush.loadVapidConfig({ ...keys, subject: 'mailto:soporte@example.com' }),
        notifyUser: async (input) => { calls.notified.push(input); return { ok: true, stored: true, push: { attempted: 2, sent: 1, removed: 1 } }; },
        ...overrides
    };
    return { handlers: routes.createHandlers(deps), calls, repo, keys };
}

const authed = (body) => ({ headers: { authorization: 'Bearer token', 'user-agent': 'Mozilla/5.0 Test' }, body });

test('GET /api/push/config: clave pública si hay VAPID; apagado en silencio si no', () => {
    const on = setup();
    const res = fakeRes();
    on.handlers.config({}, res);
    assert.deepEqual(res.body, { success: true, enabled: true, publicKey: on.keys.publicKey });
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.doesNotMatch(JSON.stringify(res.body), new RegExp(on.keys.privateKey), 'la privada nunca sale del servidor');

    const off = setup({ vapid: () => webPush.loadVapidConfig({}) });
    const res2 = fakeRes();
    off.handlers.config({}, res2);
    assert.deepEqual(res2.body, { success: true, enabled: false, publicKey: null });
});

test('POST /api/push/subscribe: pide sesión, VAPID y una suscripción de un servicio push real', async () => {
    const { handlers, calls, repo } = setup();
    let res = fakeRes();
    await handlers.subscribe({ headers: {}, body: { subscription: SUBSCRIPTION } }, res);
    assert.equal(res.statusCode, 401);

    for (const bad of [
        {}, { subscription: null }, { subscription: { ...SUBSCRIPTION, endpoint: 'https://evil.example/hook' } },
        { subscription: { ...SUBSCRIPTION, endpoint: 'http://localhost:4545/api/admin' } },
        { subscription: { ...SUBSCRIPTION, keys: { p256dh: 'x', auth: AUTH } } }
    ]) {
        res = fakeRes();
        await handlers.subscribe(authed(bad), res);
        assert.equal(res.statusCode, 400, JSON.stringify(bad).slice(0, 60));
    }
    assert.equal(calls.upsert.length, 0, 'nada inválido llega a la base');

    res = fakeRes();
    await handlers.subscribe(authed({ subscription: SUBSCRIPTION }), res);
    assert.deepEqual(res.body, { success: true });
    assert.deepEqual(calls.upsert[0], {
        userId: USER.id, endpoint: SUBSCRIPTION.endpoint, p256dh: P256DH, auth: AUTH, userAgent: 'Mozilla/5.0 Test'
    });
    assert.deepEqual(calls.trimmed, []);

    // Demasiados navegadores: se quedan los 12 más recientes.
    repo.count = 13;
    res = fakeRes();
    await handlers.subscribe({ headers: { authorization: 'Bearer t', 'user-agent': 'x'.repeat(900) }, body: { subscription: SUBSCRIPTION } }, res);
    assert.deepEqual(calls.trimmed, [[USER.id, 12]]);
    assert.equal(calls.upsert[1].userAgent.length, 400);

    const off = setup({ vapid: () => webPush.loadVapidConfig({}) });
    res = fakeRes();
    await off.handlers.subscribe(authed({ subscription: SUBSCRIPTION }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'push_disabled');
    assert.equal(off.calls.upsert.length, 0);
});

test('POST /api/push/unsubscribe (por endpoint) y /refresh (exige el secreto auth anterior)', async () => {
    const { handlers, calls } = setup();
    let res = fakeRes();
    await handlers.unsubscribe({ headers: {}, body: {} }, res);
    assert.equal(res.statusCode, 400);
    res = fakeRes();
    await handlers.unsubscribe({ headers: {}, body: { endpoint: 'ftp://x' } }, res);
    assert.equal(res.statusCode, 400);
    res = fakeRes();
    await handlers.unsubscribe({ headers: {}, body: { endpoint: SUBSCRIPTION.endpoint } }, res);
    assert.deepEqual(res.body, { success: true, removed: 1 });
    assert.deepEqual(calls.deleted, [[SUBSCRIPTION.endpoint, null]]);

    const next = { ...SUBSCRIPTION, endpoint: 'https://fcm.googleapis.com/fcm/send/nuevo' };
    const OLD_AUTH = 'AAECAwQFBgcICQoLDA0ODw'; // 16 bytes: secreto de la suscripción anterior
    res = fakeRes();
    await handlers.refresh({ headers: {}, body: { old_endpoint: SUBSCRIPTION.endpoint, old_auth: OLD_AUTH, subscription: { ...SUBSCRIPTION, endpoint: 'https://evil.example/x' } } }, res);
    assert.equal(res.statusCode, 400, 'la suscripción nueva también se valida');
    // Conocer el endpoint no alcanza para quedarse con los avisos de otro navegador.
    for (const body of [{ old_endpoint: SUBSCRIPTION.endpoint, subscription: next }, { old_endpoint: SUBSCRIPTION.endpoint, old_auth: 'corto', subscription: next }]) {
        res = fakeRes();
        await handlers.refresh({ headers: {}, body }, res);
        assert.equal(res.statusCode, 400);
    }
    assert.equal(calls.replaced.length, 0);

    res = fakeRes();
    await handlers.refresh({ headers: {}, body: { old_endpoint: SUBSCRIPTION.endpoint, old_auth: OLD_AUTH, subscription: next } }, res);
    assert.deepEqual(res.body, { success: true, updated: true });
    assert.deepEqual(calls.replaced[0], [SUBSCRIPTION.endpoint, OLD_AUTH, { endpoint: next.endpoint, p256dh: P256DH, auth: AUTH }]);
    assert.match(read('lib', 'repos', 'push.js'), /\.eq\('endpoint', oldEndpoint\)\.eq\('auth', oldAuth\)\.patch\(/);

    // El endpoint nuevo ya existía (409): no es un error y no se borra nada.
    const conflict = setup();
    conflict.repo.replaceEndpoint = async () => { const err = new Error('duplicate key'); err.status = 409; throw err; };
    res = fakeRes();
    await conflict.handlers.refresh({ headers: {}, body: { old_endpoint: SUBSCRIPTION.endpoint, old_auth: OLD_AUTH, subscription: next } }, res);
    assert.deepEqual(res.body, { success: true, updated: false });
    assert.deepEqual(conflict.calls.deleted, []);
});

test('POST /api/push/test: aviso de prueba al propio usuario, con destino interno según el rol', async () => {
    const { handlers, calls } = setup();
    let res = fakeRes();
    await handlers.test({ headers: {}, body: {} }, res);
    assert.equal(res.statusCode, 401);

    res = fakeRes();
    await handlers.test(authed({ role: 'artist' }), res);
    assert.deepEqual(res.body, { success: true, stored: true, push_enabled: true, devices: 2, delivered: 1 });
    assert.equal(calls.notified[0].userId, USER.id, 'siempre al usuario de la sesión, nunca a otro');
    assert.equal(calls.notified[0].url, '/artist/account#notificaciones');
    assert.equal(calls.notified[0].dedupeKey, undefined, 'la prueba se puede repetir');

    res = fakeRes();
    await handlers.test(authed({ role: 'admin', userId: 'otro', url: 'https://evil.example' }), res);
    assert.equal(calls.notified[1].role, 'client');
    assert.equal(calls.notified[1].url, '/client/profile#notificaciones');
    assert.equal(calls.notified[1].userId, USER.id);
    for (const url of Object.values(routes.TEST_URL)) assert.ok(pushDispatch.isInternalPath(url));
});

test('register(): cinco rutas con límite propio y el enganche del correo habilitado', () => {
    const registered = [];
    const app = {
        get(route, ...handlers) { registered.push(['GET', route, handlers.length]); },
        post(route, ...handlers) { registered.push(['POST', route, handlers.length]); }
    };
    const limiter = (req, res, next) => next();
    pushDispatch.disable();
    try {
        routes.register(app, { limiter, testLimiter: limiter, log: () => {} });
        assert.deepEqual(registered, [
            ['GET', '/api/push/config', 1],
            ['POST', '/api/push/subscribe', 2],
            ['POST', '/api/push/unsubscribe', 2],
            ['POST', '/api/push/refresh', 2],
            ['POST', '/api/push/test', 2]
        ]);
        assert.equal(pushDispatch.isEnabled(), true);
        pushDispatch.disable();
        routes.register({ get() {}, post() {} }, { limiter, testLimiter: limiter, enableDispatch: false, log: () => {} });
        assert.equal(pushDispatch.isEnabled(), false);
    } finally {
        pushDispatch.disable();
    }
});

test('acceso a datos del frente por la capa PostgREST (sin fetch a /rest/v1 suelto)', () => {
    for (const file of [['lib', 'repos', 'push.js'], ['lib', 'push-dispatch.js'], ['lib', 'routes', 'push.js']]) {
        const src = read(...file);
        assert.doesNotMatch(src, /\/rest\/v1\//, file.join('/'));
    }
    const repo = read('lib', 'repos', 'push.js');
    assert.match(repo, /require\('\.\.\/postgrest'\)/);
    assert.match(repo, /pgrest\('push_subscriptions'\)/);
    assert.match(repo, /pgrest\('user_notifications'\)/);
    assert.match(repo, /onConflict: 'endpoint'/, 'un endpoint pertenece a un solo usuario');
    const front = read('public', 'shared', 'js', 'data', 'notifications-repo.js');
    assert.match(front, /D\.Notifications = Notifications/);
    assert.match(front, /D\.run\('notifications\.listRecent'/);
    assert.doesNotMatch(front, /\/rest\/v1\//);
});

// ---------------------------------------------------------------- migración
test('migración: push_subscriptions y user_notifications con RLS de dueño y sin escritura desde el navegador', () => {
    const name = '20261116170000_push_notifications';
    const sql = read('supabase', 'migrations', `${name}.sql`);
    const down = read('supabase', 'rollbacks', `${name}.down.sql`);
    const stamp = Number(name.slice(0, 14));
    assert.ok(stamp >= 20261116170000 && stamp <= 20261116170999, 'dentro del rango del frente');
    assert.match(sql, /^begin;$/m);
    assert.match(sql, /^commit;$/m);

    for (const table of ['push_subscriptions', 'user_notifications']) {
        assert.match(sql, new RegExp(`create table if not exists public\\.${table} \\(`));
        assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
        assert.match(sql, new RegExp(`revoke all on table public\\.${table} from anon, authenticated;`));
        assert.match(sql, new RegExp(`user_id uuid not null references auth\\.users\\(id\\) on delete cascade`));
        assert.match(down, new RegExp(`drop table if exists public\\.${table};`));
        assert.doesNotMatch(sql, new RegExp(`grant (insert|all)[^;]*on table public\\.${table} to (anon|authenticated)`));
    }
    // Idempotente: políticas con drop previo, índices y tablas con "if not exists".
    const policies = [...sql.matchAll(/create policy (\w+) on public\.(\w+)/g)].map(m => m[1]);
    assert.deepEqual(policies.sort(), ['push_subscriptions_owner_delete', 'push_subscriptions_owner_select', 'user_notifications_owner_select', 'user_notifications_owner_update']);
    for (const policy of policies) assert.match(sql, new RegExp(`drop policy if exists ${policy} on public\\.`));
    assert.equal((sql.match(/\(select auth\.uid\(\)\) = user_id/g) || []).length, 5, 'todas las políticas son de dueño');
    assert.doesNotMatch(sql, /create (unique )?index (?!if not exists)/);

    // Las claves de la suscripción no se exponen a la API del navegador.
    const grant = /grant select \(([^)]+)\)\s+on table public\.push_subscriptions to authenticated;/.exec(sql);
    assert.ok(grant);
    assert.doesNotMatch(grant[1], /p256dh|auth\b/);
    assert.match(sql, /grant delete on table public\.push_subscriptions to authenticated;/);
    assert.match(sql, /constraint push_subscriptions_endpoint_key unique \(endpoint\)/);
    assert.match(sql, /endpoint ~ '\^https:\/\/'/);

    // Avisos: el dueño solo lee y marca read_at; un mismo aviso no se repite.
    assert.match(sql, /grant select on table public\.user_notifications to authenticated;/);
    assert.match(sql, /grant update \(read_at\) on table public\.user_notifications to authenticated;/);
    assert.match(sql, /create unique index if not exists user_notifications_dedupe_idx\s+on public\.user_notifications \(user_id, dedupe_key\)\s+where dedupe_key is not null;/);
    assert.match(sql, /constraint user_notifications_url_internal/);
    assert.match(sql, /constraint user_notifications_role_check check \(role in \('artist', 'client', 'studio'\)\)/);

    // Realtime: alta idempotente en la publicación, y baja en la reversa.
    assert.match(sql, /alter publication supabase_realtime add table public\.user_notifications;/);
    assert.match(sql, /from pg_publication_tables[\s\S]*tablename = 'user_notifications'/);
    assert.match(down, /alter publication supabase_realtime drop table public\.user_notifications;/);
    assert.match(down, /^begin;$/m);
    assert.match(down, /^commit;$/m);
});

test('las columnas que usa el servidor existen en la migración', () => {
    const sql = read('supabase', 'migrations', '20261116170000_push_notifications.sql');
    const block = (table) => new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)[1];
    const subs = block('push_subscriptions');
    for (const column of ['id', 'user_id', 'endpoint', 'p256dh', 'auth', 'user_agent', 'updated_at', 'last_success_at', 'failure_count']) {
        assert.match(subs, new RegExp(`^\\s+${column} `, 'm'), `push_subscriptions.${column}`);
    }
    const notifications = block('user_notifications');
    for (const column of ['id', 'user_id', 'role', 'kind', 'event_id', 'title', 'body', 'url', 'tag', 'dedupe_key', 'created_at', 'read_at']) {
        assert.match(notifications, new RegExp(`^\\s+${column} `, 'm'), `user_notifications.${column}`);
    }
    // Lo que escribe lib/push-dispatch.js y lo que lee el navegador.
    const dispatchSrc = read('lib', 'push-dispatch.js');
    const inserted = /R\.insertNotification\(\{([\s\S]*?)\}\);/.exec(dispatchSrc)[1];
    for (const column of [...inserted.matchAll(/^\s+(\w+):/gm)].map(m => m[1])) {
        assert.match(notifications, new RegExp(`^\\s+${column} `, 'm'), `insert → ${column}`);
    }
    const frontColumns = /const COLUMNS = '([^']+)'/.exec(read('public', 'shared', 'js', 'data', 'notifications-repo.js'))[1].split(',').map(c => c.trim());
    for (const column of frontColumns) assert.match(notifications, new RegExp(`^\\s+${column} `, 'm'), `select → ${column}`);
});

test('documentación: claves VAPID en .env.example y DEPLOY.md, con el comando para generarlas', () => {
    const env = read('.env.example');
    for (const name of ['VAPID_PUBLIC_KEY=', 'VAPID_PRIVATE_KEY=', 'VAPID_SUBJECT=']) assert.ok(env.includes(`\n${name}\n`), name);
    assert.match(env, /node scripts\/generate-vapid-keys\.js/);
    const deploy = read('deployments', 'DEPLOY.md');
    for (const name of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) assert.ok(deploy.includes(`\`${name}\``), name);
    assert.match(deploy, /node scripts\/generate-vapid-keys\.js/);
    assert.match(deploy, /apagado en silencio/);
    // Ningún secreto real quedó escrito en el repo.
    assert.doesNotMatch(env, /VAPID_PRIVATE_KEY=\S/);
    const script = read('scripts', 'generate-vapid-keys.js');
    assert.match(script, /generateVapidKeys/);
    assert.doesNotMatch(script, /writeFile/, 'la clave privada no se guarda en ningún archivo');
});

test('los textos nuevos del servidor van en español neutro (sin voseo)', () => {
    const voseo = /\b(tenés|querés|podés|sabés|hacé|probá|activá|iniciá|ingresá|revisá|respondé|elegí|mirá|volvé|permití|agregá|intentá|esperá|contanos|escribinos|avisanos)\b/i;
    for (const file of [['lib', 'routes', 'push.js'], ['lib', 'push-dispatch.js'], ['lib', 'web-push.js'], ['lib', 'repos', 'push.js'], ['scripts', 'generate-vapid-keys.js']]) {
        const strings = [...read(...file).matchAll(/'([^'\n]{12,})'|`([^`\n]{12,})`/g)].map(m => m[1] || m[2]).join('\n');
        assert.doesNotMatch(strings, voseo, file.join('/'));
    }
});

// ---------------------------------------------------------------- SEG-05 · destinatario por email verificado
test('SEG-05: el destinatario por email se resuelve con la RPC (email verificado de Auth), nunca con la tabla del rol', async () => {
    const { pgrest } = require('../lib/postgrest');
    const { PushRepo } = require('../lib/repos/push');
    const original = pgrest.raw;
    const calls = [];
    let answer = null;
    pgrest.raw = async (target, opts) => {
        calls.push([target, opts]);
        if (answer instanceof Error) throw answer;
        return answer;
    };
    const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    try {
        answer = USER;
        assert.equal(await PushRepo.findUserIdByEmail('client', '  Lucia@Example.com '), USER);
        assert.deepEqual(calls[0], ['rpc/push_recipient_user_id', { method: 'POST', body: { p_role: 'client', p_email: 'lucia@example.com' } }]);
        // PostgREST puede devolver el escalar suelto o en una lista.
        answer = [USER];
        assert.equal(await PushRepo.findUserIdByEmail('artist', 'mateo@example.com'), USER);
        // Sin cuenta verificada con ese correo: nadie.
        answer = null;
        assert.equal(await PushRepo.findUserIdByEmail('client', 'invitado@example.com'), null);
        answer = 'no-es-un-uuid';
        assert.equal(await PushRepo.findUserIdByEmail('client', 'x@example.com'), null);
        // Rol desconocido o email vacío: ni siquiera consulta.
        const before = calls.length;
        assert.equal(await PushRepo.findUserIdByEmail('admin', 'x@example.com'), null);
        assert.equal(await PushRepo.findUserIdByEmail('client', '   '), null);
        assert.equal(calls.length, before);
        // Migración pendiente (la función no existe): sin aviso antes que aviso mal dirigido.
        answer = Object.assign(new Error('PostgREST POST rpc/push_recipient_user_id failed (404): {"code":"PGRST202"}'), { status: 404 });
        assert.equal(await PushRepo.findUserIdByEmail('client', 'lucia@example.com'), null);
        // Otro error se propaga: el despacho lo registra y no avisa (ver "un fallo del aviso nunca rompe…").
        answer = Object.assign(new Error('PostgREST POST rpc/push_recipient_user_id failed (500): boom'), { status: 500 });
        await assert.rejects(() => PushRepo.findUserIdByEmail('client', 'lucia@example.com'), /500/);
    } finally {
        pgrest.raw = original;
    }

    const repo = read('lib', 'repos', 'push.js');
    assert.doesNotMatch(repo, /pgrest\('(clients_db|artists_db|studios)'\)|ilike\(/, 'la columna email del perfil la edita el usuario: no decide a quién se avisa');
});

test('SEG-05: push_recipient_user_id compara contra auth.users, exige email confirmado y solo la ejecuta service_role', () => {
    const sql = read('supabase', 'migrations', '20261116170000_push_notifications.sql');
    const down = read('supabase', 'rollbacks', '20261116170000_push_notifications.down.sql');
    const fn = /create or replace function public\.push_recipient_user_id\(p_role text, p_email text\)[\s\S]*?\$\$;/.exec(sql);
    assert.ok(fn, 'la función está en la migración del frente');
    const body = fn[0];
    assert.match(body, /returns uuid\s+language sql\s+stable\s+security definer\s+set search_path = ''/);
    assert.match(body, /from auth\.users u/);
    assert.match(body, /lower\(pg_catalog\.btrim\(u\.email\)\) = pg_catalog\.lower\(pg_catalog\.btrim\(p_email\)\)/);
    assert.match(body, /u\.email_confirmed_at is not null/);
    assert.match(body, /u\.deleted_at is null/);
    assert.match(body, /raw_app_meta_data->>'qa_unverified_email'/);
    assert.match(body, /raw_user_meta_data->>'qa_unverified_email'/);
    // La tabla del rol solo confirma que la cuenta tiene ese rol (por user_id), no aporta el email.
    for (const [role, table] of [['client', 'clients_db'], ['artist', 'artists_db'], ['studio', 'studios']]) {
        assert.match(body, new RegExp(`when '${role}' then exists \\(select 1 from public\\.${table} \\w where \\w\\.user_id = u\\.id\\)`));
    }
    assert.doesNotMatch(body, /\b[cas]\.email\b/);
    assert.match(body, /else false/);
    assert.match(body, /order by u\.created_at\s+limit 1/, 'resultado determinista');
    assert.match(sql, /revoke all on function public\.push_recipient_user_id\(text, text\) from public, anon, authenticated;/);
    assert.match(sql, /grant execute on function public\.push_recipient_user_id\(text, text\) to service_role;/);
    assert.doesNotMatch(sql, /grant execute on function public\.push_recipient_user_id[^;]*to (anon|authenticated)/);
    assert.match(down, /drop function if exists public\.push_recipient_user_id\(text, text\);/);
});
