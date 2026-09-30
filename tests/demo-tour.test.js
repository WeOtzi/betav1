const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Modo demo + recorrido guiado del artista (sept 2026): emulador PostgREST en
// memoria, fixtures relativas a "hoy", cableado de páginas y guion del tour.

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const Postgrest = require(path.join(root, 'public/shared/js/wo-demo-postgrest.js'));
const Fixtures = require(path.join(root, 'public/shared/js/wo-demo-fixtures.js'));

const IDENTITY = { userId: '11111111-1111-4111-8111-111111111111', username: 'demo.wo', name: 'Demo Artist', email: 'demo@weotzi.test' };
const enc = encodeURIComponent;

function makeStore() {
    const fx = Fixtures.build(IDENTITY);
    return { fx, store: Postgrest.createStore({ tables: fx.tables, relations: fx.relations, rpcs: fx.rpcs, views: fx.views }) };
}
function call(store, method, p, search, headers, body) {
    const res = store.handle({ method, path: p, search: search || '', headers: headers || {}, body: body || null, ctx: { userId: IDENTITY.userId } });
    return { status: res.status, headers: res.headers, body: res.body == null ? null : JSON.parse(res.body) };
}

const ARTIST_PAGES = [
    'public/artist/dashboard/index.html', 'public/artist/account/index.html', 'public/artist/applications/index.html',
    'public/artist/inbox/index.html', 'public/artist/invitations/index.html', 'public/artist/profile/index.html',
    'public/artist/profile/details/index.html', 'public/artist/travel/index.html', 'public/artist/visitors/index.html',
    'public/calendar/index.html', 'public/job-board/index.html', 'public/my-quotations/index.html',
    'public/my-quotations/detail/index.html', 'public/my-quotations/statistics/index.html', 'public/studio-spots/index.html',
    'public/archive/index.html',
];

/* ------------------------------ emulador ------------------------------ */

test('parseSelect entiende alias, hints, casts y recursos anidados como postgrest-js', () => {
    const nodes = Postgrest.parseSelect('*, attachments:studio_spot_attachments ( id, file_url ), studios:studio_id!inner(name), total::text');
    assert.equal(nodes[0].name, '*');
    assert.deepEqual({ name: nodes[1].name, alias: nodes[1].alias, children: nodes[1].children.map((n) => n.name) }, { name: 'studio_spot_attachments', alias: 'attachments', children: ['id', 'file_url'] });
    assert.deepEqual({ name: nodes[2].name, alias: nodes[2].alias, hint: nodes[2].hint }, { name: 'studio_id', alias: 'studios', hint: 'inner' });
    assert.equal(nodes[3].name, 'total');
});

test('los filtros PostgREST (eq/neq/in/ilike/is/or/not/gte) y el orden con nulls se evalúan como en el backend', () => {
    const store = Postgrest.createStore({
        tables: { t: [
            { id: 1, name: 'Ana', status: 'open', rank: null, created_at: '2026-09-01T10:00:00.000Z', email: 'ana@x.com' },
            { id: 2, name: 'Bruno', status: 'closed', rank: 2, created_at: '2026-09-02T10:00:00.000Z', email: 'bruno@x.com' },
            { id: 3, name: 'Carla', status: 'open', rank: 1, created_at: '2026-09-03T10:00:00.000Z', email: 'carla@x.com' },
        ] },
    });
    const ids = (search, headers) => call(store, 'GET', 't', search, headers).body.map((r) => r.id);
    assert.deepEqual(ids('?select=id&status=eq.open&order=created_at.desc'), [3, 1]);
    assert.deepEqual(ids('?select=id&status=neq.open'), [2]);
    assert.deepEqual(ids(`?select=id&id=in.${enc('(1,3)')}`), [1, 3]);
    assert.deepEqual(ids(`?select=id&name=ilike.${enc('*ar*')}`), [3]);
    assert.deepEqual(ids('?select=id&rank=is.null'), [1]);
    assert.deepEqual(ids('?select=id&rank=not.is.null&order=rank.asc'), [3, 2]);
    assert.deepEqual(ids(`?select=id&or=${enc('(id.eq.2,email.ilike."ana@x.com")')}`), [1, 2]);
    assert.deepEqual(ids(`?select=id&created_at=gte.${enc('2026-09-02T00:00:00+00:00')}&order=created_at.asc`), [2, 3]);
    assert.deepEqual(ids('?select=id&order=rank.asc.nullslast'), [3, 2, 1]);
    assert.deepEqual(ids('?select=id&order=rank.desc'), [1, 2, 3]);
    assert.deepEqual(ids('?select=id&order=id.asc&limit=1&offset=1'), [2]);
});

test('single/maybeSingle, count=exact y HEAD responden con el contrato que espera supabase-js', () => {
    const store = Postgrest.createStore({ tables: { t: [{ id: 1 }, { id: 2 }] } });
    const one = call(store, 'GET', 't', '?select=*&id=eq.1', { accept: 'application/vnd.pgrst.object+json' });
    assert.equal(one.status, 200);
    assert.deepEqual(one.body, { id: 1 });
    const none = call(store, 'GET', 't', '?select=*&id=eq.9', { accept: 'application/vnd.pgrst.object+json' });
    assert.equal(none.status, 406);
    assert.equal(none.body.code, 'PGRST116');
    const many = call(store, 'GET', 't', '?select=*', { accept: 'application/vnd.pgrst.object+json' });
    assert.equal(many.status, 406);
    const head = call(store, 'HEAD', 't', '?select=*', { prefer: 'count=exact' });
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-range'], '0-1/2');
    assert.equal(head.body, null);
    const counted = call(store, 'GET', 't', '?select=*&limit=1', { prefer: 'count=exact' });
    assert.equal(counted.headers['content-range'], '0-0/2');
});

test('insert, upsert, update y delete mutan el store y respetan return=representation', () => {
    const store = Postgrest.createStore({ tables: { t: [{ id: 1, user_id: 'u1', v: 1 }] } });
    const ins = call(store, 'POST', 't', '?select=*', { prefer: 'return=representation', accept: 'application/vnd.pgrst.object+json' }, JSON.stringify([{ user_id: 'u2', v: 5 }]));
    assert.equal(ins.status, 201);
    assert.equal(ins.body.id, 2);
    assert.ok(ins.body.created_at);
    const up = call(store, 'POST', 't', '?on_conflict=user_id&select=*', { prefer: 'resolution=merge-duplicates,return=representation' }, JSON.stringify([{ user_id: 'u1', v: 9 }]));
    assert.equal(up.status, 201);
    assert.equal(store.rows('t').length, 2, 'el upsert no duplica la fila');
    assert.equal(store.rows('t')[0].v, 9);
    const patch = call(store, 'PATCH', 't', '?id=eq.2', {}, JSON.stringify({ v: 7 }));
    assert.equal(patch.status, 204);
    assert.equal(store.rows('t')[1].v, 7);
    const del = call(store, 'DELETE', 't', '?id=eq.2&select=*', { prefer: 'return=representation' });
    assert.equal(del.status, 200);
    assert.equal(del.body.length, 1);
    assert.equal(store.rows('t').length, 1);
    // Tablas ajenas al demo: la escritura se ignora pero no rompe al llamador.
    const foreign = call(store, 'POST', 'session_logs', '', { prefer: 'return=minimal' }, JSON.stringify([{ a: 1 }]));
    assert.equal(foreign.status, 201);
    assert.equal(store.has('session_logs'), false);
});

/* ------------------------------ fixtures ------------------------------ */

test('las fixtures cubren todas las tablas declaradas, pertenecen al artista logueado y son serializables', () => {
    const { fx, store } = makeStore();
    assert.deepEqual(Fixtures.TABLES.filter((t) => !fx.tables[t]), [], 'toda tabla declarada tiene fixture');
    assert.deepEqual(Object.keys(fx.tables).filter((t) => !Fixtures.TABLES.includes(t)), [], 'toda fixture está declarada');
    for (const table of ['quotations_db', 'artist_trips', 'artist_calendar_events', 'artist_profile_visits', 'studio_spot_applications', 'job_board_applications']) {
        const owner = table === 'quotations_db' ? 'artist_id' : table === 'job_board_applications' ? 'artist_id' : table === 'artist_profile_visits' ? 'artist_id' : 'artist_user_id';
        assert.ok(fx.tables[table].length > 0, table + ' no está vacía');
        assert.ok(fx.tables[table].every((r) => r[owner] === IDENTITY.userId), table + ' pertenece al artista');
    }
    for (const table of Object.keys(fx.tables)) {
        const ids = fx.tables[table].map((r) => r.id).filter((v) => v != null);
        assert.equal(new Set(ids).size, ids.length, table + ' sin ids duplicados');
    }
    const dump = JSON.stringify(store.dump());
    assert.ok(dump.length < 400 * 1024, 'el dump entra cómodo en sessionStorage');
});

test('la agenda demo tiene cuatro turnos hoy y las cotizaciones reproducen los contadores 3 pendientes / 5 aprobadas / 1 rechazada', () => {
    const { fx } = makeStore();
    const today = new Date();
    const sameDay = (iso) => { const d = new Date(iso); return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate(); };
    const todays = fx.tables.quotation_sessions.filter((s) => sameDay(s.session_date) && s.status !== 'cancelled');
    assert.equal(todays.length, 4);
    const count = (st) => fx.tables.quotations_db.filter((q) => q.quote_status === st).length;
    assert.equal(count('pending'), 3);
    assert.equal(count('client_approved') + count('completed'), 8);
    assert.equal(count('client_rejected'), 1);
    assert.ok(fx.tables.quotations_attachments.every((a) => a.google_drive_url.startsWith(Fixtures.ASSETS)), 'las referencias apuntan a los SVG locales del demo');
});

test('las queries reales de las páginas resuelven con embeds, alias, vistas y RPCs', () => {
    const { fx, store } = makeStore();
    const uid = IDENTITY.userId;
    const sessions = call(store, 'GET', 'quotation_sessions', `?select=${enc('id,session_date,status,quotation_id,quotations_db(quote_id,client_full_name,tattoo_style,tattoo_body_part)')}&session_date=gte.${enc(new Date(new Date().setHours(0, 0, 0, 0)).toISOString())}&order=session_date.asc&limit=30`);
    assert.ok(sessions.body.length >= 4);
    assert.ok(sessions.body[0].quotations_db.client_full_name, 'el embed quotations_db se resolvió');

    const spots = call(store, 'GET', 'studio_spots', `?select=${enc('id,title,attachments:studio_spot_attachments(id,file_url),studios:studio_id(id,name),location:location_id(city)')}&status=eq.open&order=${enc('directory_rank.asc.nullslast,created_at.desc')}`);
    assert.equal(spots.body.length, fx.tables.studio_spots.length);
    assert.ok(spots.body[0].studios.name && spots.body[0].location.city && spots.body[0].attachments.length === 1);

    const inv = call(store, 'GET', 'studio_artist_memberships', `?select=${enc('id,status,studios:studio_id(name),invitation_details:studio_membership_invitation_details(contact_name)')}&artist_user_id=eq.${uid}&status=in.${enc('("pending_invite","pending_acceptance")')}`);
    assert.equal(inv.body.length, 1);
    assert.equal(inv.body[0].invitation_details.contact_name, 'Marina Paz');

    const threads = call(store, 'GET', 'chat_threads', `?select=*&artist_id=eq.${uid}&order=last_message_at.desc`);
    assert.ok(threads.body.length >= 3);
    assert.ok(threads.body.some((t) => t.unread_for_artist > 0));

    const inbox = call(store, 'POST', 'rpc/list_artist_inbox_threads', '', {}, '{}');
    const allowed = ['clients', 'quotations', 'support', 'invitations', 'spots', 'job_board', 'studios', 'trips'];
    assert.ok(inbox.body.length >= 5);
    assert.ok(inbox.body.every((t) => allowed.includes(t.category)), 'categorías válidas del check constraint');

    const daily = call(store, 'GET', 'artist_profile_visits_daily', `?select=*&artist_id=eq.${uid}&order=day.desc&limit=1000`);
    assert.ok(daily.body.length > 5 && daily.body[0].visits_count >= 1);

    const summary = call(store, 'GET', 'public_review_summary', `?select=${enc('average_rating,review_count')}&reviewee_type=eq.artist&reviewee_user_id=eq.${uid}`);
    assert.equal(summary.body[0].review_count, 3);

    const completed = call(store, 'HEAD', 'quotations_db', `?select=*&artist_id=eq.${uid}&quote_status=eq.completed`, { prefer: 'count=exact' });
    assert.equal(completed.headers['content-range'], '0-3/4');

    const sent = call(store, 'POST', 'rpc/send_inbox_message', '', {}, JSON.stringify({ p_thread_id: fx.tables.inbox_threads[0].id, p_body: 'Llego el lunes.' }));
    assert.equal(sent.body.body, 'Llego el lunes.');
    assert.equal(store.rows('inbox_threads')[0].last_message, 'Llego el lunes.');
});

/* ------------------------------ cableado ------------------------------ */

test('todas las páginas del artista cargan wo-demo.js antes de supabase-js y config-manager.js', () => {
    for (const page of ARTIST_PAGES) {
        const html = read(page);
        const demo = html.indexOf('/shared/js/wo-demo.js');
        const supabase = html.indexOf('@supabase/supabase-js');
        const config = html.indexOf('/shared/js/config-manager.js');
        const firstScript = html.search(/<script[\s>]/);
        assert.notEqual(demo, -1, page + ' incluye wo-demo.js');
        assert.ok(demo < config, page + ': wo-demo.js precede a config-manager.js');
        assert.ok(supabase === -1 || demo < supabase, page + ': wo-demo.js precede al CDN de supabase-js');
        assert.ok(html.slice(firstScript, firstScript + 200).includes('wo-demo.js') || html.slice(0, demo).indexOf('<script') === html.slice(0, demo).lastIndexOf('<script', demo) || html.slice(0, demo).match(/<script[\s>]/g).length <= 1, page + ': wo-demo.js es el primer script externo o lo precede solo el snippet inline de Clarity');
        assert.equal((html.match(/\/shared\/js\/wo-demo\.js/g) || []).length, 1, page + ': un solo include');
    }
});

test('el bootstrap del demo parchea fetch antes de que exista el cliente y bloquea escrituras reales', () => {
    const js = read('public/shared/js/wo-demo.js');
    assert.match(js, /var nativeFetch = window\.fetch;/);
    assert.match(js, /window\.fetch = function \(input, init\)/);
    assert.ok(js.includes('rest\\/v1'), 'intercepta /rest/v1/');
    assert.ok(js.includes('storage\\/v1\\/object'), 'bloquea subidas a /storage/v1/object/');
    assert.match(js, /Escritura ignorada en modo demo/);
    assert.match(js, /sb-\.\+-auth-token/);
    assert.doesNotMatch(js, /createClient\(/, 'el bootstrap no crea clientes propios');
    const menu = read('public/shared/js/wo-artist-menu.js');
    assert.match(menu, /Recorrido guiado · modo demo/);
    assert.match(menu, /\/artist\/dashboard\?demo=1&amp;tour=1/);
});

test('el CSS del recorrido usa solo tokens del DS (sin hex sueltos ni [hidden] con display)', () => {
    const css = read('public/shared/css/wo-tour.css').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'sin colores hex literales');
    assert.doesNotMatch(css, /\[hidden\][^{]*\{[^}]*display\s*:\s*(flex|grid|block)/);
    assert.match(css, /\.wo-tour-dim\{[^}]*rgba\(36,33,29,var\(--opacity-subtle\)\)/, 'mismo velo que .wo-overlay del DS');
    assert.match(css, /prefers-reduced-motion/);
});

/* ------------------------------- guion ------------------------------- */

function loadSteps() {
    const src = read('public/shared/js/wo-tour-steps.js');
    const sandbox = { window: {}, document: { querySelector: () => null } };
    const fn = new Function('window', 'document', src + '\nreturn window.WoTourSteps;');
    return fn(sandbox.window, sandbox.document);
}

test('el guion del recorrido cubre las trece páginas del artista en orden y cada paso tiene texto', () => {
    const steps = loadSteps();
    const ids = steps.chapters.map((c) => c.id);
    assert.deepEqual(ids, ['dashboard', 'quotations', 'detail', 'calendar', 'jobboard', 'spots', 'invitations', 'applications', 'statistics', 'travel', 'inbox', 'account', 'profile']);
    let total = 0;
    for (const ch of steps.chapters) {
        assert.ok(ch.title && ch.path && Array.isArray(ch.steps) && ch.steps.length >= 4, ch.id + ' bien formado');
        for (const st of ch.steps) {
            total += 1;
            const text = Array.isArray(st.text) ? st.text.join(' ') : st.text;
            assert.ok(st.id && st.title && text && text.length > 40, ch.id + '/' + st.id + ' tiene título y texto');
            assert.doesNotMatch(text, /[!¡]/, ch.id + '/' + st.id + ': sin signos de exclamación (regla 10 del DS)');
        }
        assert.equal(ch.steps[ch.steps.length - 1].target, null, ch.id + ': el último paso es la transición (sin objetivo)');
    }
    assert.ok(total >= 80, 'al menos 80 pasos narrados, hay ' + total);
    const first = steps.chapters[0].steps[0];
    assert.match(first.title, /centro de control de We Ötzi/);
    assert.match(first.text[0], /primer paso para impulsar tu carrera/);
    const agenda = steps.chapters[0].steps.find((s) => s.id === 'agenda');
    assert.match(agenda.text, /Abrir calendario/);
});

test('cada selector del guion existe en el markup o en el script que lo pinta', () => {
    const steps = loadSteps();
    const pageOf = {
        dashboard: 'public/artist/dashboard/index.html', quotations: 'public/my-quotations/index.html', detail: 'public/my-quotations/detail/index.html',
        calendar: 'public/calendar/index.html', jobboard: 'public/job-board/index.html', spots: 'public/studio-spots/index.html',
        invitations: 'public/artist/invitations/index.html', applications: 'public/artist/applications/index.html',
        statistics: 'public/my-quotations/statistics/index.html', travel: 'public/artist/travel/index.html', inbox: 'public/artist/inbox/index.html',
        account: 'public/artist/account/index.html', profile: 'public/artist/profile/index.html',
    };
    const jsDir = path.join(root, 'public/shared/js');
    const haystack = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js')).map((f) => read('public/shared/js/' + f)).join('\n');
    for (const ch of steps.chapters) {
        const html = read(pageOf[ch.id]);
        for (const st of ch.steps) {
            const targets = Array.isArray(st.target) ? st.target : st.target ? [st.target] : [];
            if (!targets.length) continue;
            const found = targets.some((sel) => {
                const tokens = sel.match(/[#.][A-Za-z0-9_-]+|\[aria-label="[^"]+"\]|\[aria-labelledby="[^"]+"\]/g) || [];
                return tokens.length > 0 && tokens.every((tok) => {
                    const needle = tok[0] === '#' ? 'id="' + tok.slice(1) + '"' : tok[0] === '.' ? tok.slice(1) : tok.slice(1, -1);
                    return html.includes(needle) || haystack.includes(needle);
                });
            });
            assert.ok(found, ch.id + '/' + st.id + ': ningún selector resuelve (' + targets.join(' | ') + ')');
        }
    }
});
