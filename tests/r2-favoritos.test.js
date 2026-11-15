// Ronda 2 · frente "favoritos" (P22): listas de favoritos del cliente.
// Modelo puro (wo-favorites-model.js), contrato de la migración
// 20261116190000_favoritos_listas.sql, coherencia modelo ↔ base y el repo de
// servidor de los contadores (lib/repos/favoritos.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

const Model = require('../public/shared/js/wo-favorites-model.js');
const { createFavoritosRepo, cleanArtistIds, cleanTargetIds, isMissingFunction, KINDS } = require('../lib/repos/favoritos');

const MIGRATION = 'supabase/migrations/20261116190000_favoritos_listas.sql';
const ROLLBACK = 'supabase/rollbacks/20261116190000_favoritos_listas.down.sql';
const sql = read(MIGRATION);
const down = read(ROLLBACK);

const ARTIST = '002c10bc-45a6-4406-bd7f-2db50a76a368';
const CTX = { origin: 'https://beta.weotzi.com', basePath: '/beta', pagePath: '/marketplace?modo=estudios' };

/* ------------------------------- modelo ------------------------------- */

test('modelo: normalizeItem limpia lo que trae un botón data-wo-favorite', () => {
    const item = Model.normalizeItem({
        kind: ' Artist ', id: ' ' + ARTIST.toUpperCase() + ' ', label: '  Mara\n  Ink\t', image: 'HTTPS://cdn.test/a.jpg',
        url: 'https://beta.weotzi.com/beta/artist/profile?artist=mara'
    }, CTX);
    assert.deepEqual(item, {
        kind: 'artist', id: ARTIST, label: 'Mara Ink', image: 'https://cdn.test/a.jpg',
        url: '/artist/profile?artist=mara', artistId: ARTIST
    });
    // Sin kind válido o sin id no hay nada que guardar.
    assert.equal(Model.normalizeItem({ kind: 'usuario', id: 'x' }, CTX), null);
    assert.equal(Model.normalizeItem({ kind: 'design', id: '   ' }, CTX), null);
    assert.equal(Model.normalizeItem({ kind: 'design', id: 'x'.repeat(201) }, CTX), null);
    assert.equal(Model.normalizeItem(null, CTX), null);
    // El id de un diseño conserva mayúsculas (no es un uuid de artista).
    assert.equal(Model.normalizeItem({ kind: 'design', id: 'Foto-ABC' }, CTX).id, 'Foto-ABC');
    assert.equal(Model.normalizeItem({ kind: 'design', id: 'a', label: 'x'.repeat(400) }, CTX).label.length, Model.LIMITS.LABEL);
});

test('modelo: destino por defecto según el tipo y la página donde se guardó', () => {
    assert.equal(Model.normalizeItem({ kind: 'artist', id: ARTIST }, CTX).url, '/artist/profile?id=' + ARTIST);
    assert.equal(Model.normalizeItem({ kind: 'studio', id: 'st 1' }, CTX).url, '/studio/profile?studio=st%201');
    // Diseño o merch sin data-url: la página actual (sin base path).
    assert.equal(Model.normalizeItem({ kind: 'design', id: 'd1' }, CTX).url, '/marketplace?modo=estudios');
    assert.equal(Model.normalizeItem({ kind: 'merch', id: 'm1' }, { pagePath: '/beta/store/?artist=x', basePath: '/beta' }).url, '/store/?artist=x');
    // Un artista con id que no es uuid no tiene perfil por id: cae a la página.
    assert.equal(Model.normalizeItem({ kind: 'artist', id: 'mara' }, CTX).url, '/marketplace?modo=estudios');
});

test('modelo: autor del diseño/merch solo si es un uuid; el estudio nunca lleva autor', () => {
    assert.equal(Model.normalizeItem({ kind: 'design', id: 'd1', artistId: ARTIST.toUpperCase() }, CTX).artistId, ARTIST);
    assert.equal(Model.normalizeItem({ kind: 'merch', id: 'm1', artistId: 'mara' }, CTX).artistId, '');
    assert.equal(Model.normalizeItem({ kind: 'studio', id: 's1', artistId: ARTIST }, CTX).artistId, '');
    assert.equal(Model.normalizeItem({ kind: 'artist', id: 'no-uuid' }, CTX).artistId, '');
});

test('modelo: safePath solo deja rutas del mismo sitio', () => {
    const ok = [['/', '/'], ['/store/item/?id=1#x', '/store/item/?id=1#x'], ['/artist/profile?artist=jos%C3%A9', '/artist/profile?artist=jos%C3%A9']];
    for (const [input, expected] of ok) assert.equal(Model.safePath(input), expected, input);
    const bad = ['', '//evil.test/x', '/\\evil.test', 'https://evil.test/x', 'javascript:alert(1)', 'data:text/html,x', 'store/item', '/con espacio',
        '/tab\tulado', '/linea\nnueva', '/' + 'a'.repeat(600)];
    for (const input of bad) assert.equal(Model.safePath(input), '', JSON.stringify(input));
    // Absoluta del mismo origen: se queda con la ruta y pierde el base path.
    assert.equal(Model.safePath('https://beta.weotzi.com/beta/store/?artist=x', CTX), '/store/?artist=x');
    assert.equal(Model.safePath('https://beta.weotzi.com.evil.test/store/', CTX), '');
    assert.equal(Model.safePath('/beta', { basePath: '/beta' }), '/');
    assert.equal(Model.safePath('/betamax/x', { basePath: '/beta' }), '/betamax/x');
    assert.equal(Model.safePath('/beta//evil.test', { basePath: '/beta' }), '');
});

test('modelo: safeImageUrl acepta https o ruta local y nada más', () => {
    assert.equal(Model.safeImageUrl('https://cdn.test/a.webp?x=1'), 'https://cdn.test/a.webp?x=1');
    assert.equal(Model.safeImageUrl('/shared/assets/demo/a.svg'), '/shared/assets/demo/a.svg');
    for (const bad of ['', 'http://cdn.test/a.png', '//cdn.test/a.png', '/\\cdn.test/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA',
        'blob:https://x/y', 'https://', 'https://cdn.test/a b.png', '/', 'https://cdn.test/' + 'a'.repeat(1000)]) {
        assert.equal(Model.safeImageUrl(bad), '', JSON.stringify(bad));
    }
});

test('modelo: lo que deja pasar cumple las mismas reglas que los CHECK de la base', () => {
    // Las expresiones de la migración, pasadas a JS (POSIX [:space:] → \s).
    const urlRe = /^\/([^/\\\s][^\s]*)?$/;
    const imageRe = /^(https:\/\/[^\s]+|\/[^/\\\s][^\s]*)$/;
    assert.ok(sql.includes(String.raw`url ~ '^/([^/\\[:space:]][^[:space:]]*)?$'`));
    assert.ok(sql.includes(String.raw`image_url ~ '^(https://[^[:space:]]+|/[^/\\[:space:]][^[:space:]]*)$'`));
    const urls = ['/', '/a', '/store/item/?id=1', 'https://beta.weotzi.com/beta/x', '//evil', '/\\evil', 'javascript:x', '/a b', '', '/artist/profile?id=' + ARTIST];
    for (const u of urls) {
        const safe = Model.safePath(u, CTX);
        if (safe) assert.match(safe, urlRe, u);
    }
    const images = ['https://cdn.test/a.png', 'HTTPS://CDN.test/a.png', '/shared/a.webp', '//evil/a.png', 'data:image/png;base64,AA', 'http://x/a.png', '/'];
    for (const i of images) {
        const safe = Model.safeImageUrl(i);
        if (safe) assert.match(safe, imageRe, i);
    }
});

test('modelo: filas de la base → listas e ítems de la UI', () => {
    const lists = Model.sortLists([
        Model.rowToList({ id: 'b', name: 'Brazo', is_default: false, sort_order: 2, created_at: '2026-11-02' }),
        Model.rowToList({ id: 'a', name: 'Ideas', is_default: false, sort_order: 1, created_at: '2026-11-03' }),
        Model.rowToList({ id: 'd', name: 'Favoritos', is_default: true, sort_order: 0, created_at: '2026-11-04' })
    ]);
    assert.deepEqual(lists.map((l) => l.id), ['d', 'a', 'b'], 'la de defecto primero, después por orden');
    assert.equal(Model.nextSortOrder(lists), 3);
    assert.equal(Model.rowToList({ id: 'x', name: '   ' }).name, 'Favoritos');

    const items = [
        { id: 'i1', list_id: 'd', kind: 'artist', target_id: ARTIST, label: 'Mara', image_url: 'https://cdn.test/a.png', url: '/artist/profile?artist=mara', artist_user_id: ARTIST, created_at: '2026-11-05T10:00:00Z' },
        { id: 'i2', list_id: 'a', kind: 'artist', target_id: ARTIST, label: 'Mara', created_at: '2026-11-06T10:00:00Z' },
        { id: 'i3', list_id: 'a', kind: 'design', target_id: 'p1', label: '<b>Flor</b>', image_url: 'javascript:alert(1)', url: 'https://evil.test', created_at: '2026-11-07T10:00:00Z' },
        { id: 'i4', list_id: 'a', kind: 'otro', target_id: 'zz' }
    ].map(Model.rowToItem);
    assert.deepEqual(items[0], {
        itemId: 'i1', listId: 'd', kind: 'artist', id: ARTIST, label: 'Mara', image: 'https://cdn.test/a.png',
        url: '/artist/profile?artist=mara', artistId: ARTIST, createdAt: '2026-11-05T10:00:00Z'
    });
    assert.equal(items[2].image, '', 'imagen peligrosa descartada al leer');
    assert.equal(items[2].url, '', 'destino externo descartado al leer');
    assert.equal(items[2].label, '<b>Flor</b>', 'el texto se conserva: lo escapa quien lo pinta');
    assert.equal(items[3].kind, '');

    const index = Model.buildIndex(items);
    assert.deepEqual(index[Model.itemKey('artist', ARTIST)], ['d', 'a']);
    assert.deepEqual(index[Model.itemKey('design', 'p1')], ['a']);
    assert.equal(Object.keys(index).length, 2, 'sin kind válido no entra al índice');

    assert.deepEqual(Model.kindCounts(items), { all: 3, artist: 2, design: 1, merch: 0, studio: 0 });
    assert.deepEqual(Model.filterItems(items, { listId: 'a' }).map((i) => i.itemId), ['i3', 'i2', 'i4'], 'más recientes primero');
    assert.deepEqual(Model.filterItems(items, { listId: 'a', kind: 'artist' }).map((i) => i.itemId), ['i2']);
});

test('modelo: nombres de lista', () => {
    const lists = [{ id: 'd', name: 'Favoritos' }, { id: 'a', name: 'Ideas para el brazo' }];
    assert.deepEqual(Model.validateListName('  Espalda   completa ', lists), { ok: true, value: 'Espalda completa', error: '' });
    assert.equal(Model.validateListName('   ', lists).error, 'Escribe un nombre para la lista.');
    assert.equal(Model.validateListName('FAVORITOS', lists).error, 'Ya tienes una lista con ese nombre.');
    assert.equal(Model.validateListName('ideas para el brazo', lists, 'a').ok, true, 'renombrar a su propio nombre');
    assert.equal(Model.validateListName('x'.repeat(61), lists).error, 'El nombre puede tener hasta 60 caracteres.');
    assert.equal(Model.validateListName('x'.repeat(60), lists).ok, true);
    assert.equal(Model.canCreateList(new Array(49).fill({})), true);
    assert.equal(Model.canCreateList(new Array(50).fill({})), false);
});

test('modelo: textos en español neutro (tuteo, sin voseo)', () => {
    assert.equal(Model.buttonLabel({ kind: 'artist', label: 'Mara Ink' }, false), 'Guardar a Mara Ink en favoritos');
    assert.equal(Model.buttonLabel({ kind: 'artist', label: 'Mara Ink' }, true), 'Quitar a Mara Ink de favoritos');
    assert.equal(Model.buttonLabel({ kind: 'design', label: 'Flor' }, false), 'Guardar «Flor» en favoritos');
    assert.equal(Model.buttonLabel({ kind: 'studio' }, true), 'Quitar de favoritos');
    assert.equal(Model.savedMessage('Ideas'), 'Guardado en «Ideas»');
    assert.equal(Model.savedMessage(''), 'Guardado en «Favoritos»');
    assert.equal(Model.countLabel(0), 'Sin guardados');
    assert.equal(Model.countLabel(1), '1 guardado');
    assert.equal(Model.countLabel(12), '12 guardados');
    assert.equal(Model.kindLabel('design', true), 'Diseños');
    assert.equal(Model.kindLabel('studio'), 'Estudio');
    assert.equal(Model.kindLabel('x'), '');
    const source = read('public/shared/js/wo-favorites-model.js');
    for (const file of ['public/shared/js/wo-favorites-model.js', 'public/shared/js/wo-favorites.js', 'public/shared/js/client-favorites.js', 'public/client/favorites/index.html']) {
        const text = read(file);
        assert.doesNotMatch(text, /\b(querés|podés|tenés|elegí|contanos|iniciá|ingresá|creá|guardá|revisá|probá|tocá|volvé|recargá|mirá|explorá|escribí|borrá)\b/i, file + ' sin voseo');
    }
    assert.ok(source.includes('Inicia sesión'));
});

test('modelo: intención de guardar antes de iniciar sesión', () => {
    const item = { kind: 'studio', id: 's1', label: 'Casa Koi', image: 'https://cdn.test/s.png' };
    const intent = Model.buildIntent(item, { returnTo: '/studio/profile?studio=casa-koi', now: 1000 });
    assert.deepEqual(intent, {
        v: 1,
        item: { kind: 'studio', id: 's1', label: 'Casa Koi', image: 'https://cdn.test/s.png', url: '/studio/profile?studio=s1', artistId: '' },
        returnTo: '/studio/profile?studio=casa-koi',
        at: 1000
    });
    const raw = JSON.stringify(intent);
    assert.deepEqual(Model.parseIntent(raw, 2000), intent);
    assert.equal(Model.parseIntent(raw, 1000 + Model.INTENT_TTL_MS + 1), null, 'vence a las 24 h');
    assert.equal(Model.parseIntent(raw, 1000 - 120000), null, 'fecha futura');
    assert.equal(Model.parseIntent('{no json', 2000), null);
    assert.equal(Model.parseIntent(JSON.stringify({ v: 2, item, at: 1000 }), 2000), null);
    assert.equal(Model.buildIntent({ kind: 'x', id: '1' }, {}), null);
    // Almacenamiento manipulado: se vuelve a validar todo al leer.
    const tampered = Model.parseIntent(JSON.stringify({
        v: 1, at: 1000, returnTo: 'https://evil.test/phish',
        item: { kind: 'design', id: 'd1', label: '<img src=x onerror=alert(1)>', image: 'javascript:alert(1)', url: '//evil.test' }
    }), 2000);
    assert.equal(tampered.returnTo, '');
    assert.equal(tampered.item.image, '');
    assert.equal(tampered.item.url, '');
    assert.equal(Model.parseIntent(JSON.stringify({ v: 1, at: 1000, item: { kind: 'hack', id: '1' } }), 2000), null);
    assert.equal(Model.INTENT_KEY, 'wo_fav_intent');
});

test('modelo: enlaces de ingreso — returnTo solo bajo /store/ (lo que acepta client-auth.js)', () => {
    assert.deepEqual(Model.authLinks('/store/item/?id=1'), {
        login: '/client/login?returnTo=%2Fstore%2Fitem%2F%3Fid%3D1',
        register: '/client/register?returnTo=%2Fstore%2Fitem%2F%3Fid%3D1'
    });
    assert.deepEqual(Model.authLinks('/marketplace'), { login: '/client/login', register: '/client/register' });
    assert.deepEqual(Model.authLinks('https://evil.test/store/'), { login: '/client/login', register: '/client/register' });
    assert.ok(read('public/shared/js/client-auth.js').includes("const RETURN_TO_PREFIX = '/store/';"));
});

test('modelo: mensajes de error', () => {
    assert.match(Model.errorMessage({ message: '[favoriteLists.createList] favorites:list_limit' }), /máximo de 50 listas/);
    assert.match(Model.errorMessage({ message: 'x', cause: { message: 'favorites:item_limit' } }), /500 guardados/);
    assert.equal(Model.errorMessage({ code: '23505' }, 'list'), 'Ya tienes una lista con ese nombre.');
    assert.match(Model.errorMessage({ message: 'favorites:auth_required' }), /Inicia sesión de nuevo/);
    assert.match(Model.errorMessage({ message: 'TypeError: Failed to fetch' }), /Revisa tu conexión/);
    assert.match(Model.errorMessage(null), /Inténtalo de nuevo/);
    assert.equal(Model.isMissingSchemaError({ code: 'PGRST205' }), true);
    assert.equal(Model.isMissingSchemaError({ cause: { code: '42P01' } }), true);
    assert.equal(Model.isMissingSchemaError({ message: 'Could not find the function public.favorites_save(p_kind) in the schema cache' }), true);
    assert.equal(Model.isMissingSchemaError({ message: 'relation "public.favorite_items" does not exist' }), true);
    assert.equal(Model.isMissingSchemaError({ code: '23505', message: 'duplicate key' }), false);
    assert.match(Model.errorMessage({ code: 'PGRST202' }), /todavía no están disponibles/);
});

/* ------------------------------ migración ------------------------------ */

test('migración: nombre dentro del rango del frente y con reversa', () => {
    const files = fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((f) => /favorit/i.test(f));
    assert.deepEqual(files, ['20261116190000_favoritos_listas.sql']);
    const stamp = Number(files[0].slice(0, 14));
    assert.ok(stamp >= 20261116190000 && stamp <= 20261116190999);
    assert.ok(fs.existsSync(path.join(root, ROLLBACK)));
    assert.match(sql, /^BEGIN;$/m);
    assert.match(sql, /^COMMIT;$/m);
    assert.ok(sql.includes('supabase/rollbacks/20261116190000_favoritos_listas.down.sql'));
});

test('migración: tablas, claves y restricciones', () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.favorite_lists \(/);
    assert.match(sql, /owner_user_id uuid NOT NULL DEFAULT auth\.uid\(\) REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS favorite_lists_one_default_idx\s+ON public\.favorite_lists \(owner_user_id\) WHERE is_default;/);
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS favorite_lists_owner_name_idx\s+ON public\.favorite_lists \(owner_user_id, lower\(name\)\);/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.favorite_items \(/);
    // La FK compuesta impide guardar en la lista de otra persona.
    assert.match(sql, /FOREIGN KEY \(list_id, owner_user_id\)\s+REFERENCES public\.favorite_lists \(id, owner_user_id\) ON DELETE CASCADE/);
    assert.match(sql, /CONSTRAINT favorite_lists_id_owner_key UNIQUE \(id, owner_user_id\)/);
    assert.match(sql, /CONSTRAINT favorite_items_kind_check CHECK \(kind IN \('artist', 'design', 'merch', 'studio'\)\)/);
    assert.match(sql, /CONSTRAINT favorite_items_unique_target UNIQUE \(list_id, kind, target_id\)/);
    assert.match(sql, /CREATE INDEX IF NOT EXISTS favorite_items_artist_idx/);
});

test('migración: RLS de dueño, soporte solo lectura y anon sin acceso', () => {
    assert.match(sql, /ALTER TABLE public\.favorite_lists ENABLE ROW LEVEL SECURITY;/);
    assert.match(sql, /ALTER TABLE public\.favorite_items ENABLE ROW LEVEL SECURITY;/);
    const policies = [...sql.matchAll(/CREATE POLICY (\w+) ON public\.(favorite_\w+)\s+FOR (\w+) TO (\w+)/g)].map((m) => m.slice(1).join('|'));
    assert.deepEqual(policies, [
        'favorite_lists_owner_select|favorite_lists|SELECT|authenticated',
        'favorite_lists_owner_insert|favorite_lists|INSERT|authenticated',
        'favorite_lists_owner_update|favorite_lists|UPDATE|authenticated',
        'favorite_lists_owner_delete|favorite_lists|DELETE|authenticated',
        'favorite_lists_support_read|favorite_lists|SELECT|authenticated',
        'favorite_items_owner_all|favorite_items|ALL|authenticated',
        'favorite_items_support_read|favorite_items|SELECT|authenticated'
    ]);
    // select 1 + insert 1 + update 2 + delete 1 (listas) + using/check (ítems).
    assert.equal((sql.match(/\(SELECT auth\.uid\(\)\) = owner_user_id/g) || []).length, 7, 'toda política de dueño compara con auth.uid()');
    // La lista por defecto no se puede borrar desde el navegador.
    assert.match(sql, /FOR DELETE TO authenticated\s+USING \(\(SELECT auth\.uid\(\)\) = owner_user_id AND NOT is_default\);/);
    assert.match(sql, /REVOKE ALL ON public\.favorite_lists FROM PUBLIC, anon, authenticated;/);
    assert.match(sql, /REVOKE ALL ON public\.favorite_items FROM PUBLIC, anon, authenticated;/);
    assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON public\.favorite_items TO authenticated;/);
    assert.doesNotMatch(sql, /GRANT[^;]*ON public\.favorite_(lists|items)[^;]*TO[^;]*anon/i);
});

test('migración: RPC del dueño pasan por RLS; contadores públicos solo agregados', () => {
    for (const fn of ['favorites_default_list_id', 'favorites_save']) {
        const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.' + fn + '(');
        assert.ok(start > -1, fn);
        const body = sql.slice(start, sql.indexOf('$$;', start));
        assert.match(body, /SECURITY INVOKER/, fn + ' corre con los permisos de quien llama');
        assert.match(body, /SET search_path = ''/);
        assert.match(body, /favorites:auth_required/);
    }
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.favorites_save\(text, text, text, text, text, uuid, uuid\) FROM PUBLIC, anon;/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.favorites_save\(text, text, text, text, text, uuid, uuid\) TO authenticated, service_role;/);

    for (const fn of ['favorite_artist_save_counts', 'favorite_target_save_counts']) {
        const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.' + fn + '(');
        assert.ok(start > -1, fn);
        const body = sql.slice(start, sql.indexOf('$$;', start));
        assert.match(body, /SECURITY DEFINER/);
        assert.match(body, /SET search_path = ''/);
        assert.match(body, /\[1:200\]/, fn + ' con tope de ids por llamada');
        assert.match(body, /count\(/);
        // Devuelven cantidades, nunca quién guardó.
        assert.doesNotMatch(body.slice(0, body.indexOf('AS $$')), /owner_user_id/);
    }
    assert.match(sql, /RETURNS TABLE \(artist_user_id uuid, saved_count integer, items_saved_count integer\)/);
    assert.match(sql, /fi\.owner_user_id <> ids\.id/, 'guardarse a uno mismo no cuenta');
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.favorite_artist_save_counts\(uuid\[\]\) TO anon, authenticated, service_role;/);
});

test('migración: compatibilidad con client_favorites (copia + espejo en los dos sentidos, sin borrarla)', () => {
    assert.doesNotMatch(sql, /DROP TABLE[^;]*client_favorites/i);
    assert.doesNotMatch(sql, /(DELETE FROM|TRUNCATE)\s+public\.client_favorites\s*;/i);
    assert.match(sql, /INSERT INTO public\.favorite_lists \(owner_user_id, name, is_default, sort_order\)\s+SELECT DISTINCT cf\.client_user_id, 'Favoritos', true, 0\s+FROM public\.client_favorites cf/);
    assert.match(sql, /SELECT l\.id, cf\.client_user_id, 'artist', cf\.artist_user_id::text, s\.label, s\.image_url, s\.url, cf\.created_at\s+FROM public\.client_favorites cf/);
    assert.match(sql, /CREATE TRIGGER trg_favorite_items_sync_legacy\s+AFTER INSERT OR DELETE ON public\.favorite_items/);
    assert.match(sql, /CREATE TRIGGER trg_client_favorites_sync_lists\s+AFTER INSERT OR DELETE ON public\.client_favorites/);
    // El espejo nunca hace fallar la escritura del código anterior.
    assert.match(sql, /EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING 'favorites: no se pudo reflejar client_favorites/);
    // Las funciones de trigger no quedan expuestas como RPC.
    for (const fn of ['favorite_lists_guard()', 'favorite_items_guard()', 'favorite_items_sync_legacy()', 'client_favorites_sync_lists()', 'favorite_artist_snapshot(uuid)']) {
        assert.ok(sql.includes(`REVOKE ALL ON FUNCTION private.${fn} FROM PUBLIC, anon, authenticated;`), fn);
    }
});

test('migración: idempotente (se puede volver a correr)', () => {
    assert.doesNotMatch(sql, /CREATE TABLE (?!IF NOT EXISTS)/);
    assert.doesNotMatch(sql, /CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
    assert.doesNotMatch(sql, /CREATE FUNCTION /, 'siempre CREATE OR REPLACE');
    const created = [...sql.matchAll(/CREATE (POLICY|TRIGGER) (\w+)/g)].map((m) => m[1] + ' ' + m[2]);
    assert.ok(created.length >= 12);
    for (const item of created) {
        assert.ok(sql.includes('DROP ' + item.replace(' ', ' IF EXISTS ')), 'falta DROP IF EXISTS de ' + item);
    }
    assert.match(sql, /ON CONFLICT \(list_id, kind, target_id\) DO NOTHING;/);
});

test('reversa: borra lo nuevo en orden y deja client_favorites', () => {
    const statements = down.split('\n').filter((line) => !/^\s*--/.test(line)).join('\n');
    assert.doesNotMatch(statements, /drop table[^;]*client_favorites/i);
    assert.doesNotMatch(statements, /(delete from|truncate)[^;]*client_favorites/i);
    const order = ['drop trigger if exists trg_client_favorites_sync_lists', 'drop function if exists public.favorites_save(',
        'drop table if exists public.favorite_items;', 'drop table if exists public.favorite_lists;', 'drop function if exists private.favorite_items_guard();'];
    let last = -1;
    for (const marker of order) {
        const at = down.indexOf(marker);
        assert.ok(at > last, 'orden de la reversa: ' + marker);
        last = at;
    }
    for (const fn of [...sql.matchAll(/CREATE OR REPLACE FUNCTION ((?:public|private)\.\w+)\(/g)].map((m) => m[1])) {
        assert.ok(down.includes('drop function if exists ' + fn + '('), 'la reversa borra ' + fn);
    }
});

/* ------------------------ coherencia modelo ↔ base ------------------------ */

test('los límites y tipos del modelo son los de la base', () => {
    assert.deepEqual(Model.KINDS, ['artist', 'design', 'merch', 'studio']);
    assert.deepEqual([...KINDS], Model.KINDS);
    assert.ok(sql.includes(`char_length(name) BETWEEN 1 AND ${Model.LIMITS.LIST_NAME}`));
    assert.ok(sql.includes(`char_length(label) BETWEEN 1 AND ${Model.LIMITS.LABEL}`));
    assert.ok(sql.includes(`char_length(target_id) BETWEEN 1 AND ${Model.LIMITS.TARGET}`));
    assert.ok(sql.includes(`char_length(url) <= ${Model.LIMITS.URL}`));
    assert.ok(sql.includes(`char_length(image_url) <= ${Model.LIMITS.IMAGE}`));
    assert.ok(sql.includes(`>= ${Model.LIMITS.LISTS} THEN\n    RAISE EXCEPTION 'favorites:list_limit'`));
    assert.ok(sql.includes(`>= ${Model.LIMITS.ITEMS_PER_LIST}\n`));
    assert.ok(sql.includes(`VALUES (v_uid, '${Model.DEFAULT_LIST_NAME}', true, 0)`));
    assert.ok(sql.includes(`lower(l.name) = '${Model.DEFAULT_LIST_NAME.toLowerCase()}'`));
});

/* ------------------------- repo de servidor (lib) ------------------------- */

test('lib/repos/favoritos: limpia ids y pide los contadores a las RPC', async () => {
    assert.deepEqual(cleanArtistIds([ARTIST.toUpperCase(), ARTIST, 'no-uuid', null, '']), [ARTIST]);
    assert.equal(cleanArtistIds(new Array(500).fill(0).map((_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)).length, 200);
    assert.deepEqual(cleanTargetIds('design', [' p1 ', 'p1', '', null, 'P2']), ['p1', 'P2']);
    assert.deepEqual(cleanTargetIds('artist', [ARTIST.toUpperCase()]), [ARTIST]);

    const calls = [];
    const repo = createFavoritosRepo({
        rpc: async (name, body) => {
            calls.push([name, body]);
            if (name === 'favorite_artist_save_counts') return [{ artist_user_id: ARTIST, saved_count: 7, items_saved_count: '3' }, { artist_user_id: 'otro', saved_count: 99 }];
            return [{ target_id: 'p1', saved_count: 4 }, { target_id: 'desconocido', saved_count: 9 }];
        }
    });
    const other = '11111111-1111-4111-8111-111111111111';
    const counts = await repo.artistSaveCounts([ARTIST.toUpperCase(), other, 'basura']);
    assert.deepEqual(calls[0], ['favorite_artist_save_counts', { p_artist_user_ids: [ARTIST, other] }]);
    assert.deepEqual(counts.get(ARTIST), { saved: 7, items: 3, total: 10 });
    assert.deepEqual(counts.get(other), { saved: 0, items: 0, total: 0 }, 'todo id pedido vuelve, aunque sea en cero');
    assert.equal(counts.size, 2);
    assert.deepEqual(await repo.artistSaveCount(ARTIST), { saved: 7, items: 3, total: 10 });

    const targets = await repo.targetSaveCounts('Design', ['p1', 'p2']);
    assert.deepEqual(calls[calls.length - 1], ['favorite_target_save_counts', { p_kind: 'design', p_target_ids: ['p1', 'p2'] }]);
    assert.deepEqual([...targets], [['p1', 4], ['p2', 0]]);

    const before = calls.length;
    assert.equal((await repo.artistSaveCounts([])).size, 0);
    assert.equal((await repo.targetSaveCounts('usuario', ['x'])).size, 0);
    assert.equal(calls.length, before, 'sin ids o con kind inválido no se llama a la base');
});

test('lib/repos/favoritos: sin la migración devuelve ceros; otros errores suben', async () => {
    const missing = Object.assign(new Error('PostgREST POST rpc/favorite_artist_save_counts failed (404): {"code":"PGRST202"}'), { status: 404 });
    assert.equal(isMissingFunction(missing), true);
    assert.equal(isMissingFunction(new Error('PostgREST POST x failed (500): boom')), false);
    const repo = createFavoritosRepo({ rpc: async () => { throw missing; } });
    assert.deepEqual((await repo.artistSaveCounts([ARTIST])).get(ARTIST), { saved: 0, items: 0, total: 0 });
    assert.deepEqual([...(await repo.targetSaveCounts('studio', ['s1']))], [['s1', 0]]);
    const broken = createFavoritosRepo({ rpc: async () => { throw Object.assign(new Error('failed (500)'), { status: 500 }); } });
    await assert.rejects(() => broken.artistSaveCounts([ARTIST]), /500/);
});

test('lib/repos/favoritos: acceso solo por la capa PostgREST y registrado en el backoffice', () => {
    const repoSource = read('lib/repos/favoritos.js');
    assert.ok(repoSource.includes("require('../postgrest')"));
    assert.ok(repoSource.includes('pgrest.raw(`rpc/${name}`'));
    assert.doesNotMatch(repoSource, /fetch\(/);
    const server = read('server.js');
    assert.ok(server.includes("{ name: 'favorite_lists', description: 'Listas de favoritos de clientes' }"));
    assert.ok(server.includes("{ name: 'favorite_items', description: 'Favoritos guardados en listas' }"));
    assert.ok(server.includes("{ name: 'client_favorites', description: 'Favoritos de clientes' }"), 'la tabla anterior sigue en el catálogo');
});

test('assets de la ronda: el frente no necesita imágenes generadas', () => {
    assert.deepEqual(JSON.parse(read('docs/plans/ronda2-assets/favoritos.json')), []);
});
