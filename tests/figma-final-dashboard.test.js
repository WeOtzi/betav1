// Figma final del flujo de artista (oct 2026) · área dashboard.
// Recordatorios (modelo + repo con respaldo), migración, fixtures del preview,
// acciones rápidas, compartir/QR, menú de cuenta e importación de Instagram.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const Model = require('../public/shared/js/data/reminders-repo.js');

/* ------------------------------- modelo ------------------------------- */
test('reminders model normalizes legacy app_settings items and new rows', () => {
    const legacy = Model.normalize({ text: 'Reponer tinta negra', type: 'stock', done: false }, 2);
    assert.equal(legacy.id, 'legacy-2');
    assert.equal(legacy.title, 'Reponer tinta negra');
    assert.equal(legacy.icon, 'droplet');
    assert.equal(legacy.priority, 'normal');
    assert.equal(legacy.is_important, true);
    assert.equal(legacy.completed_at, null);

    const row = Model.normalize({
        id: 'a1', title: 'Cobrar saldo · Mateo', icon: 'dollar-sign', due_date: '2026-07-04T00:00:00Z',
        priority: 'alta', is_important: false, attachments: [{ path: 'u/a.pdf', name: 'a.pdf', size: 10 }, { nope: 1 }]
    });
    assert.equal(row.due_date, '2026-07-04');
    assert.equal(row.priority, 'alta');
    assert.equal(row.is_important, false);
    assert.deepEqual(row.attachments, [{ name: 'a.pdf', path: 'u/a.pdf', size: 10, mime: null }]);
    assert.equal(Model.normalize({ title: 'x', icon: 'rocket', priority: 'maxima' }).icon, 'bell');
    assert.equal(Model.normalize({ title: 'x', priority: 'maxima' }).priority, 'normal');
});

test('reminders model keeps the Figma icon grid and the four priorities', () => {
    assert.equal(Model.ICONS.length, 18);
    assert.deepEqual(Model.ICONS.slice(0, 6), ['droplet', 'edit', 'message-circle', 'dollar-sign', 'calendar', 'clock']);
    assert.deepEqual(Model.PRIORITIES, ['urgente', 'alta', 'normal', 'baja']);
});

test('reminders model sorts open items by date and priority, done items last', () => {
    const list = [
        { id: 'a', title: 'a', due_date: '2026-07-04', priority: 'alta', completed_at: null, created_at: '1' },
        { id: 'b', title: 'b', due_date: '2026-07-01', priority: 'normal', completed_at: null, created_at: '2' },
        { id: 'c', title: 'c', due_date: '2026-07-01', priority: 'urgente', completed_at: null, created_at: '3' },
        { id: 'd', title: 'd', due_date: null, priority: 'urgente', completed_at: null, created_at: '4' },
        { id: 'e', title: 'e', due_date: '2026-06-01', priority: 'urgente', completed_at: '2026-06-02T00:00:00Z', created_at: '5' }
    ];
    assert.deepEqual(Model.sort(list).map((r) => r.id), ['c', 'b', 'a', 'd', 'e']);
});

test('reminders model validates form input with rioplatense messages', () => {
    assert.throws(() => Model.toRow({ title: '   ' }), /Escribí un título/);
    assert.throws(() => Model.toRow({ title: 'x'.repeat(141) }), /hasta 140/);
    assert.throws(() => Model.toRow({ title: 'ok', due_date: '2026-02-30' }), /fecha válida/);
    const row = Model.toRow({ title: '  Enviar   boceto ', priority: 'urgente', icon: 'edit', due_date: '2026-07-01', is_important: false });
    assert.deepEqual(row, {
        title: 'Enviar boceto', detail: null, icon: 'edit', due_date: '2026-07-01',
        priority: 'urgente', is_important: false, attachments: []
    });
    assert.deepEqual(Model.toRow({ priority: 'baja' }, true), { priority: 'baja' });
    assert.deepEqual(Model.toRow({ completed_at: null }, true), { completed_at: null });
});

test('reminders model formats Figma dates and finds reminders due soon', () => {
    assert.equal(Model.formatShortDate('2026-07-02'), '02 JUL');
    assert.equal(Model.formatLongDate('2026-07-02'), '2 de julio de 2026');
    assert.equal(Model.formatLongDate(null), 'Sin fecha');
    const now = new Date(2026, 6, 1, 10, 0, 0);
    const list = [
        { id: 'today', due_date: '2026-07-01', completed_at: null },
        { id: 'tomorrow', due_date: '2026-07-02', completed_at: null },
        { id: 'later', due_date: '2026-07-05', completed_at: null },
        { id: 'past', due_date: '2026-06-30', completed_at: null },
        { id: 'done', due_date: '2026-07-01', completed_at: '2026-07-01T09:00:00Z' }
    ];
    assert.deepEqual(Model.dueSoon(list, now, 1).map((r) => r.id), ['today', 'tomorrow']);
    assert.deepEqual(Model.overdue(list, now).map((r) => r.id), ['past']);
});

test('reminders model accepts only images or PDF up to 10 MB', () => {
    assert.ok(Model.validateFile({ name: 'boceto.png', type: 'image/png', size: 2000 }));
    assert.throws(() => Model.validateFile({ name: 'x.exe', type: 'application/octet-stream', size: 10 }), /Solo se aceptan/);
    assert.throws(() => Model.validateFile({ name: 'big.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 }), /10 MB/);
    assert.equal(Model.safeFileName('Señá cliente (final).PDF'), 'Sena-cliente-final-.PDF');
});

/* ------------------------- repositorio (navegador) ------------------------- */
function loadRepo({ tableAvailable, prefsRow }) {
    const calls = [];
    const store = { prefs: prefsRow || null };
    function chain(table) {
        const op = { table, steps: [] };
        calls.push(op);
        const proxy = new Proxy({}, {
            get(_, name) {
                return (...args) => { op.steps.push([name, args]); return proxy; };
            }
        });
        return proxy;
    }
    const client = { from: chain };
    const D = {
        getClient: () => client,
        async run(label, builder) {
            builder(client);
            if (label === 'reminders.probe' && !tableAvailable) {
                const err = new Error('[reminders.probe] relation does not exist');
                err.code = '42P01';
                throw err;
            }
            const last = calls[calls.length - 1];
            const insert = last.steps.find((s) => s[0] === 'insert');
            const update = last.steps.find((s) => s[0] === 'update');
            if (insert) return { data: Object.assign({ id: 'new-id', created_at: 'now' }, insert[1][0][0]) };
            if (update) return { data: Object.assign({ id: 'row-1', title: 'Existente' }, update[1][0]) };
            return { data: [] };
        },
        Prefs: {
            async get() { return store.prefs; },
            async saveSection(userId, section, value) {
                store.prefs = Object.assign({ user_id: userId }, store.prefs || {});
                store.prefs[section] = Object.assign({}, (store.prefs && store.prefs[section]) || {}, value);
                return store.prefs;
            }
        }
    };
    const sandbox = { window: { WeotziData: D, crypto: { randomUUID: () => 'uuid-1' } }, console };
    sandbox.window.window = sandbox.window;
    vm.runInNewContext(read('public/shared/js/data/reminders-repo.js'), sandbox);
    return { R: D.Reminders, calls, store };
}

test('reminders repo uses artist_reminders scoped by owner when the migration exists', async () => {
    const { R, calls } = loadRepo({ tableAvailable: true });
    assert.equal(await R.backend(), 'table');
    const created = await R.create('user-1', { title: 'Reponer tinta negra', priority: 'alta', icon: 'droplet', due_date: '2026-07-02' });
    assert.equal(created.title, 'Reponer tinta negra');
    const insert = calls.find((c) => c.steps.some((s) => s[0] === 'insert'));
    assert.equal(insert.table, 'artist_reminders');
    assert.equal(insert.steps.find((s) => s[0] === 'insert')[1][0][0].artist_user_id, 'user-1');

    await R.setCompleted('user-1', 'row-1', true);
    const update = calls.find((c) => c.steps.some((s) => s[0] === 'update'));
    assert.ok(update.steps.find((s) => s[0] === 'update')[1][0].completed_at);
    assert.deepEqual(update.steps.filter((s) => s[0] === 'eq').map((s) => s[1]), [['id', 'row-1'], ['artist_user_id', 'user-1']]);

    await R.remove('user-1', 'row-1', []);
    const del = calls.find((c) => c.steps.some((s) => s[0] === 'delete'));
    assert.deepEqual(del.steps.filter((s) => s[0] === 'eq').map((s) => s[1]), [['id', 'row-1'], ['artist_user_id', 'user-1']]);
});

test('reminders repo falls back to user_preferences until the migration is applied', async () => {
    const { R, store } = loadRepo({
        tableAvailable: false,
        prefsRow: { user_id: 'user-1', app_settings: { timezone: 'X', reminders: [{ text: 'Responder WhatsApp de Nico', type: 'message', done: false }] } }
    });
    assert.equal(await R.backend(), 'prefs');
    let list = await R.list('user-1');
    assert.equal(list.length, 1);
    assert.equal(list[0].icon, 'message-circle');

    const created = await R.create('user-1', { title: 'Enviar boceto a Camila', priority: 'urgente', icon: 'edit', due_date: '2026-07-01' });
    assert.equal(created.id, 'uuid-1');
    assert.equal(store.prefs.app_settings.timezone, 'X', 'keeps the rest of app_settings');
    assert.equal(store.prefs.app_settings.reminders.length, 2);

    await R.update('user-1', 'uuid-1', { priority: 'baja', title: 'Enviar boceto a Camila v2' });
    await R.setCompleted('user-1', 'legacy-0', true);
    list = await R.list('user-1');
    assert.equal(list.find((r) => r.id === 'uuid-1').priority, 'baja');
    assert.ok(list.find((r) => r.id === 'legacy-0').completed_at);
    assert.equal(list[list.length - 1].id, 'legacy-0', 'completed reminders sort last');

    await assert.rejects(R.uploadAttachment('user-1', { name: 'a.png', type: 'image/png', size: 5 }), /migración de recordatorios/);
    await R.remove('user-1', 'uuid-1');
    assert.equal((await R.list('user-1')).length, 1);
});

/* ------------------------------- migración ------------------------------- */
test('artist_reminders migration is additive, owner-scoped and ships a rollback', () => {
    const sql = read('supabase/migrations/20261028110000_artist_reminders.sql');
    const down = read('supabase/rollbacks/20261028110000_artist_reminders.down.sql');
    assert.match(sql, /create table if not exists public\.artist_reminders/);
    assert.match(sql, /priority in \('urgente', 'alta', 'normal', 'baja'\)/);
    assert.match(sql, /alter table public\.artist_reminders enable row level security/);
    for (const op of ['select', 'insert', 'update', 'delete']) {
        assert.match(sql, new RegExp('artist_reminders_owner_' + op));
    }
    assert.match(sql, /revoke all on table public\.artist_reminders from public, anon, authenticated/);
    assert.match(sql, /'artist-reminder-files'/);
    assert.match(sql, /\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/);
    assert.match(sql, /from public\.user_preferences up/);
    for (const icon of Model.ICONS) assert.ok(sql.includes("'" + icon + "'"), icon);
    assert.match(down, /drop table if exists public\.artist_reminders/);
    assert.match(down, /'reminders'/);
});

/* ------------------------------- fixtures ------------------------------- */
test('dashboard preview fixtures register artist_reminders and an Instagram sample', () => {
    const sandbox = { console };
    sandbox.self = sandbox;
    vm.runInNewContext(read('public/shared/js/demo-fixtures/dashboard.js'), sandbox);
    const ctx = { tables: {}, TABLES: ['quotations_db'], identity: { userId: 'artist-1' } };
    sandbox.WoDemoFixtureExtensions.dashboard(ctx);
    assert.ok(ctx.TABLES.includes('artist_reminders'));
    const rows = ctx.tables.artist_reminders;
    assert.equal(rows.length, 4);
    assert.ok(rows.every((r) => r.artist_user_id === 'artist-1' && /^\d{4}-\d{2}-\d{2}$/.test(r.due_date)));
    assert.deepEqual([...rows.map((r) => r.priority)].sort(), ['alta', 'alta', 'normal', 'urgente']);
    const media = sandbox.WoDemoIGImportSample.summary.media;
    assert.equal(media.length, 6);
    assert.ok(media.some((m) => m.kind === 'reel' && m.video_duration > 30), 'one video is blocked by duration');
});

/* ------------------------------ dashboard UI ------------------------------ */
test('dashboard rail follows Figma 24:1425: reminders CTA and five quick actions', () => {
    const html = read('public/artist/dashboard/index.html');
    assert.match(html, /id="wod-reminder-new"[^>]*>\+ NUEVO RECORDATORIO</);
    assert.match(html, /href="\/my-quotations\/new\?origen=cliente">\+&nbsp; NUEVO CLIENTE</);
    assert.match(html, /href="\/my-quotations\/new\?origen=cita"><i data-wo-icon="calendar"[^>]*><\/i>NUEVA CITA/);
    assert.match(html, /id="wod-register-payment" href="\/artist\/account#cobros"/);
    assert.match(html, /id="wod-share-profile"[^>]*>[\s\S]*?COMPARTIR MI PERFIL/);
    assert.match(html, /id="wod-qr-card"[^>]*>[\s\S]*?GENERAR TARJETA QR/);
    assert.doesNotMatch(html, /id="qr-modal"/, 'el modal QR legacy se reemplazó por el panel lateral');
    assert.doesNotMatch(html, /href="\/artist\/profile\/details"/, 'no enlaza rutas que se eliminan');
    const order = ['postgrest-client.js', 'account-repo.js', 'reminders-repo.js', 'dashboard.js', 'dashboard-redesign.js', 'dashboard-reminders.js', 'dashboard-share.js']
        .map((name) => html.indexOf('src="/shared/js/' + (name.endsWith('repo.js') || name === 'postgrest-client.js' ? 'data/' : '') + name));
    order.forEach((idx, i) => {
        assert.ok(idx > -1, 'script ' + i);
        if (i) assert.ok(idx > order[i - 1], 'orden de carga ' + i);
    });
    const redesign = read('public/shared/js/dashboard-redesign.js');
    assert.doesNotMatch(redesign, /\/quotation\?artist=/, 'Nuevo cliente ya no se reescribe al cotizador público');
});

test('reminder modals and share panels expose QA URL states', () => {
    const reminders = read('public/shared/js/dashboard-reminders.js');
    const share = read('public/shared/js/dashboard-share.js');
    assert.match(reminders, /'nuevo-recordatorio'/);
    assert.match(reminders, /'editar-recordatorio'/);
    assert.match(reminders, /get\('iconos'\) === '1'/);
    for (const copy of ['ICONO + TÍTULO', 'Título del recordatorio', 'Información adicional del recordatorio…', '+ ADJUNTAR ARCHIVOS', 'GUARDAR RECORDATORIO', 'GUARDAR CAMBIOS', 'ARCHIVOS ADJUNTOS · ', 'Sin archivos adjuntos.']) {
        assert.ok(reminders.includes(copy), copy);
    }
    assert.match(share, /panel !== 'compartir' && panel !== 'qr'/);
    assert.match(share, /\/artist\/profile\?artist=/);
    assert.match(share, /#block-gallery/);
    assert.doesNotMatch(share, /\/artist\/profile\/gallery/);
    for (const copy of ['QUÉ QUERÉS COMPARTIR', 'ENLACE PÚBLICO', 'COPIAR ENLACE', 'COMPARTIR EN', 'CÓDIGO QR', '↓ DESCARGAR PNG', '↓ DESCARGAR SVG', 'COPIAR URL']) {
        assert.ok(share.includes(copy), copy);
    }
    assert.match(share, /https:\/\/wa\.me\/\?text=/);
    assert.match(share, /mailto:\?subject=/);
});

test('artist topbar drops the client-mode switch while clients keep it', () => {
    const modes = read('public/shared/js/account-modes.js');
    assert.doesNotMatch(modes, /'\.wo-org-product-nav__account,/);
    assert.match(modes, /if \(document\.querySelector\('weotzi-product-nav, \.wo-org-product-nav'\)\) return;/);
    assert.match(modes, /\.client-topbar \.wo-topbar-right/);
    const organisms = read('public/shared/js/ds/organisms.js');
    assert.match(organisms, /\{ id: 'account', label: 'PERFIL', href: '\/artist\/account' \}/);
});

test('account menu and notifications follow Figma 801:559 / 801:558', () => {
    const menu = read('public/shared/js/wo-artist-menu.js');
    for (const copy of ['Actividad reciente', 'Mensajes sin leer', 'Invitaciones pendientes', "'Postulaciones'", 'Actualizaciones de la plataforma', 'Ir al Centro de Cuenta', 'Ver perfil público', 'Marcar todas como leídas', "'Reserva confirmada'", "'Recordatorio'"]) {
        assert.ok(menu.includes(copy), copy);
    }
    assert.match(menu, /get\('menu'\)/);
    assert.match(menu, /D\.Reminders\.model/);
    assert.match(menu, /\/shared\/js\/data\/reminders-repo\.js/);
});

test('Instagram import follows the three Figma steps and keeps signup compatibility', () => {
    const js = read('public/shared/js/instagram-import.js');
    for (const copy of ['01 · PERFIL', '02 · SELECCIÓN', '03 · IMPORTACIÓN', 'Importá tus trabajos de Instagram', 'Podés escribirlo con o sin @.', 'VAMOS A REVISAR', 'ESPACIOS LIBRES EN TU GALERÍA', 'Confirmo que esta cuenta es mía y autorizo la importación de su contenido.', 'BUSCAR PERFIL →', 'Elegí qué sumar', 'CAMBIAR CUENTA', 'VIDEOS EN GALERÍA', 'Tus trabajos ya están en la galería', 'VER EN LA GALERÍA']) {
        assert.ok(js.includes(copy), copy);
    }
    assert.match(js, /body\.allowed_permalinks = permalinks/);
    assert.match(js, /bio: isSignup && Boolean\(s\.bio_present\)/, 'el registro sigue recibiendo bio/enlace/ubicación');
    assert.match(js, /window\.IGImport = \{ mount, open \}/);
    assert.doesNotMatch(js, /fa-brands|fa-instagram/, 'sin Font Awesome');
    const css = read('public/shared/css/instagram-import.css');
    assert.match(css, /var\(--neutral-500, #24211D\)/, 'tokens con respaldo para /studio/register');
});

/* ------------------------- galería (Figma 2003:862) ------------------------- */
const Gallery = require('../public/shared/js/dashboard-gallery.js');

test('gallery helpers build the Figma counters, free slots and durations', () => {
    const feed = [
        { url: 'a.jpg', kind: 'image' }, { url: 'b.mp4', kind: 'video', duration: 24 },
        { url: 'c.jpg', kind: 'image' }, { url: 'd.jpg', kind: 'image' }
    ];
    assert.equal(Gallery.quotaLabel(feed, 12, 2), '4/12 ARCHIVOS · 1/2 VIDEOS');
    assert.equal(Gallery.freeLabel(4), '4 LIBRES');
    assert.equal(Gallery.freeLabel(1), '1 LIBRE');
    assert.equal(Gallery.counts(feed, 12, 2).free, 8);
    assert.equal(Gallery.formatDuration(24), '0:24');
    assert.equal(Gallery.formatDuration(75.4), '1:15');
    assert.equal(Gallery.formatDuration(0), '');
    assert.equal(Gallery.formatDuration('x'), '');
});

test('gallery titles prefer the artist name, then a clean IG caption', () => {
    assert.equal(Gallery.itemTitle({ title: '  Manga floral ' }), 'Manga floral');
    assert.equal(Gallery.itemTitle({ caption: 'Mandala dotwork\n#dotwork #tattoo' }), 'Mandala dotwork');
    assert.equal(Gallery.itemTitle({ caption: '#blackwork Sesión blackwork @estudio' }), 'Sesión blackwork');
    assert.equal(Gallery.itemTitle({ caption: '#solo #tags' }), '');
    const long = Gallery.captionTitle('Una pieza enorme de realismo en negro y gris que cubre toda la espalda alta');
    assert.ok(long.length <= 49 && long.endsWith('…'), long);
    assert.equal(Gallery.itemTitle({}), '');
});

test('NUEVO · IG marks only Instagram imports from the last 7 days', () => {
    const now = new Date('2026-10-28T12:00:00Z');
    const day = 24 * 60 * 60 * 1000;
    const fresh = { url: 'x', source: 'instagram', imported_at: new Date(now - day).toISOString() };
    assert.equal(Gallery.isNewImport(fresh, now), true);
    assert.equal(Gallery.isNewImport({ ...fresh, imported_at: new Date(now - 8 * day).toISOString() }, now), false);
    assert.equal(Gallery.isNewImport({ url: 'x', imported_at: fresh.imported_at }, now), false, 'subida manual');
    assert.equal(Gallery.isNewImport({ url: 'x', permalink: 'https://www.instagram.com/p/1/', imported_at: fresh.imported_at }, now), true);
    assert.equal(Gallery.isNewImport({ url: 'https://s/artist-gallery/instagram-import/u/a.jpg' }, now), false, 'sin fecha de importación');
    assert.equal(Gallery.isFromInstagram({ url: 'https://s/artist-gallery/instagram-import/u/a.jpg' }), true);
});

test('gallery reorder moves a work without mutating the feed and keeps extra fields', () => {
    const feed = [{ url: 'a' }, { url: 'b' }, { url: 'c' }, { url: 'd' }];
    assert.deepEqual(Gallery.moveItem(feed, 3, 0).map((i) => i.url), ['d', 'a', 'b', 'c']);
    assert.deepEqual(Gallery.moveItem(feed, 0, 2).map((i) => i.url), ['b', 'c', 'a', 'd']);
    assert.deepEqual(Gallery.moveItem(feed, 1, 9).map((i) => i.url), ['a', 'b', 'c', 'd']);
    assert.deepEqual(feed.map((i) => i.url), ['a', 'b', 'c', 'd']);
    const extras = Gallery.pickExtras({ title: ' Dragón ', caption: 'c', permalink: 'p', source: 'instagram', imported_at: 't', video_duration: 18.4, junk: 1 });
    assert.deepEqual(extras, { title: 'Dragón', caption: 'c', permalink: 'p', source: 'instagram', imported_at: 't', duration: 18 });
});

test('gallery cells follow Figma 2003:862: caption + trash, video and IG badges, featured flag', () => {
    const now = new Date('2026-10-28T12:00:00Z');
    const featured = Gallery.cellMarkup({ url: 'a.jpg', kind: 'image', title: 'Manga floral' }, 0, 3, now);
    assert.match(featured, /is-featured/);
    assert.match(featured, /Manga floral — destacado/);
    assert.match(featured, /class="wod-gal-flag"/);
    assert.match(featured, /data-gal-action="delete" aria-label="Eliminar Manga floral"/);
    assert.doesNotMatch(featured, /gallery-category-badge|REALIZADO/);
    const video = Gallery.cellMarkup({ url: 'b.mp4', kind: 'video', duration: 24, source: 'instagram', imported_at: now.toISOString() }, 2, 3, now);
    assert.match(video, /NUEVO · IG/);
    assert.match(video, /VIDEO · 0:24/);
    assert.match(video, /data-wo-icon="eye"/);
    assert.match(video, /data-gal-action="feature"/);
    assert.match(video, /Sin título/);
    const html = read('public/artist/dashboard/index.html');
    assert.doesNotMatch(html, /VISTA PREVIA/);
    assert.match(html, /id="wod-gallery-quota"/);
    assert.match(html, /▲<\/span> ARRASTRÁ PARA REORDENAR/);
    assert.ok(html.indexOf('dashboard-gallery.js') > -1 && html.indexOf('dashboard-gallery.js') < html.indexOf('src="/shared/js/dashboard.js'));
    const dashboard = read('public/shared/js/dashboard.js');
    assert.match(dashboard, /window\.WodGallery\.render\(grid, feedItems/);
    assert.match(dashboard, /window\.WodGallery\.pickExtras\(raw\)/);
    assert.match(dashboard, /imported_at: now/);
});

test('dashboard copy and rail fixes: Sesión N/T, NO ASISTIÓ, name without .wo, stage colors', () => {
    const redesign = read('public/shared/js/dashboard-redesign.js');
    assert.doesNotMatch(redesign, /'Sesion '|NO ASISTIO|enhanceGallery|wod-gal-acts/);
    assert.match(redesign, /'Sesión ' \+ n/);
    assert.match(redesign, /NO ASISTIÓ/);
    assert.match(redesign, /replace\(\/\\.wo\$\/i, ''\)/);
    assert.match(redesign, /is-boceto/);
    const css = read('public/shared/css/dashboard-figma-final.css');
    assert.match(css, /\.wo-dash-design-fill\.is-boceto \{ background: var\(--blue-400\); \}/);
    assert.match(css, /\.wo-dash-activitytxt \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/);
    assert.match(css, /body\.artist-dashboard-page \{ padding-bottom: calc\(64px/);
    const menu = read('public/shared/js/wo-artist-menu.js');
    assert.match(menu, /type: 'recordatorio', icon: 'calendar'/);
    const ig = read('public/shared/css/instagram-import.css');
    assert.match(ig, /\.igi-dialog \{\n    flex: none;\n    margin: auto;/);
});

/* ------------------- ronda 2 · subida, videos, agenda, topbar ------------------- */
// Bloque puro de dashboard.js (isUrlVideo … galleryUploadOutcomeMessage) en un
// sandbox: sin DOM real, con Storage y FileReader de prueba.
function loadUploadHelpers({ preview = false, uploadError = null } = {}) {
    const src = read('public/shared/js/dashboard.js');
    const start = src.indexOf('function isUrlVideo(url) {');
    const end = src.indexOf('function getVideoDuration(file) {');
    assert.ok(start > -1 && end > start, 'bloque de helpers de subida');
    const calls = [];
    class FileReaderStub {
        readAsDataURL(blob) { this.result = 'data:' + blob.type + ';base64,QUJD'; setImmediate(() => this.onload()); }
    }
    const ctx = {
        window: { WEOTZI_PREVIEW: preview },
        currentUser: { id: 'user-1' },
        FileReader: FileReaderStub,
        createImageBitmap: async () => { throw new Error('sin decodificador'); },
        URL: { createObjectURL: () => 'blob:http://localhost/abc' },
        document: {},
        _supabase: { storage: { from: (bucket) => ({
            upload: async (filePath, file, opts) => { calls.push({ bucket, filePath, opts }); return { error: uploadError }; },
            getPublicUrl: (filePath) => ({ data: { publicUrl: 'https://cdn.example/' + bucket + '/' + filePath } })
        }) } }
    };
    vm.createContext(ctx);
    vm.runInContext(src.slice(start, end) + '\nthis.api = { isUrlVideo, isFeedItemVideo, uploadDashboardGalleryFile, galleryUploadOutcomeMessage };', ctx);
    return { api: ctx.api, calls };
}

test('gallery upload counts videos like the N/2 VIDEOS counter (IG reels with thumbnails)', () => {
    const { api } = loadUploadHelpers();
    assert.equal(api.isFeedItemVideo({ url: 'https://ig/reel.jpg', kind: 'video' }), true);
    assert.equal(api.isFeedItemVideo({ url: 'https://ig/reel.jpg', media_type: 'video' }), true);
    assert.equal(api.isFeedItemVideo({ url: 'https://s/clip.MOV' }), true);
    assert.equal(api.isFeedItemVideo({ url: 'https://s/a.jpg', kind: 'image' }), false);
    assert.equal(api.isUrlVideo('data:video/mp4;base64,AAAA'), true);
    assert.equal(Gallery.counts([{ url: 'https://ig/reel.jpg', kind: 'video' }, { url: 'a.jpg', kind: 'image' }]).videos, 1);
    assert.equal(Gallery.isVideoUrl('data:video/mp4;base64,AAAA'), true);
    assert.equal(Gallery.isPlayable({ url: 'blob:http://x/1', kind: 'video' }), true);
    assert.equal(Gallery.isPlayable({ url: 'https://ig/reel.jpg', kind: 'video' }), false);
    const dashboard = read('public/shared/js/dashboard.js');
    assert.equal((dashboard.match(/currentFeedItems\.filter\(isFeedItemVideo\)\.length/g) || []).length, 2);
    assert.doesNotMatch(dashboard, /filter\(\(item\) => isUrlVideo\(item\.url\)\)/);
});

test('gallery upload goes to artist-gallery in production and reports failures', async () => {
    const ok = loadUploadHelpers();
    const res = await ok.api.uploadDashboardGalleryFile({ name: 'Foto.JPG', type: 'image/jpeg', size: 10 }, 'image');
    assert.equal(ok.calls.length, 1);
    assert.equal(ok.calls[0].bucket, 'artist-gallery');
    assert.match(ok.calls[0].filePath, /^user-1\/\d+_[a-z0-9]+\.jpg$/);
    assert.equal(res.url, 'https://cdn.example/artist-gallery/' + ok.calls[0].filePath);
    const failing = loadUploadHelpers({ uploadError: { message: 'denied' } });
    await assert.rejects(failing.api.uploadDashboardGalleryFile({ name: 'a.png', type: 'image/png', size: 1 }, 'image'), (err) => err.message === 'denied');
    assert.deepEqual({ ...ok.api.galleryUploadOutcomeMessage(0, 2) }, { text: 'No pudimos subir los archivos. Probá de nuevo en unos minutos.', type: 'error' });
    assert.equal(ok.api.galleryUploadOutcomeMessage(2, 2).type, 'success');
    assert.match(ok.api.galleryUploadOutcomeMessage(1, 2).text, /Uno no se pudo subir/);
    assert.match(ok.api.galleryUploadOutcomeMessage(1, 1, true).text, /hasta que recargues/);
});

test('gallery upload works in the local preview without Storage (data: / blob: URLs)', async () => {
    const { api, calls } = loadUploadHelpers({ preview: true });
    const img = await api.uploadDashboardGalleryFile({ name: 'a.svg', type: 'image/svg+xml', size: 10 }, 'image');
    assert.equal(img.url, 'data:image/svg+xml;base64,QUJD');
    assert.equal(img.preview, true);
    const smallVideo = await api.uploadDashboardGalleryFile({ name: 'c.mp4', type: 'video/mp4', size: 1024 }, 'video');
    assert.equal(smallVideo.url, 'data:video/mp4;base64,QUJD');
    const bigVideo = await api.uploadDashboardGalleryFile({ name: 'd.mp4', type: 'video/mp4', size: 20 * 1024 * 1024 }, 'video');
    assert.equal(bigVideo.url, 'blob:http://localhost/abc');
    assert.equal(bigVideo.ephemeral, true);
    assert.equal(calls.length, 0, 'el preview no llama a Storage');
});

test('main column spacing follows Figma 24:1425 at 1440 (round 2)', () => {
    const html = read('public/artist/dashboard/index.html');
    assert.match(html, /class="wo-dash-section wo-dash-section--agenda"/);
    assert.match(html, /class="wo-dash-section wo-dash-section--designs"/);
    const css = read('public/shared/css/dashboard-figma-final.css');
    assert.match(css, /\.wo-dash-agendarow \{[^}]*align-items: start;[^}]*padding: 22px 0 20px;/);
    assert.match(css, /\.wo-dash-agendarow:first-child \{ padding-top: 31px; \}/);
    assert.match(css, /\.wo-dash-section--agenda \{ padding-bottom: 45px; \}/);
    assert.match(css, /\.wo-dash-design-track \{ margin-top: 13px; height: 8px; \}/);
    assert.match(css, /\.wo-dash-row2 \{ grid-template-columns: minmax\(0, 1\.75fr\) minmax\(0, 1fr\); gap: 40px; \}/);
    assert.match(css, /\.wo-dash-activityrow \{ grid-template-columns: 14px minmax\(0, max-content\) auto; justify-content: start;/);
});

test('mobile topbar keeps the Ö badge inside the bar and away from LOG OUT', () => {
    const org = read('public/shared/js/ds/organisms.js');
    const block = org.slice(org.indexOf('var PRODUCT_NAV_FINAL_CSS'), org.indexOf('function ensureProductNavStyles'));
    assert.match(block, /@media \(max-width:480px\)\{' \+\s*'weotzi-product-nav \.wo-org-product-nav__account\{gap:8px\}'/);
    assert.match(block, /notification-badge\{top:-3px;right:-3px;[^}]*max-width:28px;/);
    const ig = read('public/shared/css/instagram-import.css');
    assert.match(ig, /box-sizing: border-box;\n    width: min\(685\.2px, 100%\);/);
    assert.match(ig, /z-index: 2147483000;/);
});
