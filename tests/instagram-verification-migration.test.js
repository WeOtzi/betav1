'use strict';
// Migración (NO aplicada) de la validación de Instagram del artista:
// tabla solo servidor, guardián de las columnas de artists_db, regla de
// visibilidad espejada de public/shared/js/gallery-visibility.js, trigger de
// gallery_images, backfill de importaciones existentes, RPC pública y reversa.
// No hay Postgres local: se valida el texto SQL y la regla se contrasta con el
// módulo JS sobre una matriz de casos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = 'supabase/migrations/20261030120000_instagram_verification.sql';
const ROLLBACK = 'supabase/rollbacks/20261030120000_instagram_verification.down.sql';
const sql = read(MIGRATION);
const down = read(ROLLBACK);
const feedMigration = read('supabase/migrations/20260329000000_artist_gallery_feed_items.sql');
const prefsMigration = read('supabase/migrations/20260829103500_artist_public_profile_preferences.sql');
const visibilityJs = read('public/shared/js/gallery-visibility.js');
const Visibility = require('../public/shared/js/gallery-visibility.js');

// Sentencia `create or replace function public.<name>(` completa, hasta el
// cierre de su cuerpo con dollar quote.
function fnBlock(text, name) {
    const start = text.search(new RegExp(`create or replace function public\\.${name}\\(`, 'i'));
    assert.ok(start >= 0, `falta la función ${name}`);
    const rest = text.slice(start);
    const open = /\bas\s+(\$\w*\$)/i.exec(rest);
    assert.ok(open, `función sin cuerpo: ${name}`);
    const close = rest.indexOf(open[1], open.index + open[0].length);
    assert.ok(close > 0, `cuerpo sin cerrar: ${name}`);
    return rest.slice(0, close + open[1].length);
}

// Lexer mínimo: separa comentarios, literales y cuerpos con dollar quote para
// poder revisar paréntesis y sentencias sin un parser de Postgres.
function lex(text) {
    let skeleton = '';
    const bodies = [];
    let i = 0;
    while (i < text.length) {
        if (text.startsWith('--', i)) {
            const nl = text.indexOf('\n', i);
            i = nl < 0 ? text.length : nl;
            continue;
        }
        if (text[i] === "'") {
            const escaped = /[eE]/.test(text[i - 1] || '') && !/\w/.test(text[i - 2] || '');
            let j = i + 1;
            for (;;) {
                assert.ok(j < text.length, 'literal sin cerrar');
                if (escaped && text[j] === '\\') { j += 2; continue; }
                if (text[j] === "'" && text[j + 1] === "'") { j += 2; continue; }
                if (text[j] === "'") break;
                j += 1;
            }
            skeleton += "''";
            i = j + 1;
            continue;
        }
        if (text[i] === '$') {
            const tag = /^\$\w*\$/.exec(text.slice(i));
            if (tag) {
                const end = text.indexOf(tag[0], i + tag[0].length);
                assert.ok(end > 0, `dollar quote ${tag[0]} sin cerrar`);
                bodies.push(text.slice(i + tag[0].length, end));
                skeleton += ' $body$ ';
                i = end + tag[0].length;
                continue;
            }
        }
        skeleton += text[i];
        i += 1;
    }
    return { skeleton, bodies };
}

function parenBalance(text) {
    let depth = 0;
    for (const ch of text) {
        if (ch === '(') depth += 1;
        if (ch === ')') depth -= 1;
        assert.ok(depth >= 0, 'paréntesis de cierre de más');
    }
    return depth;
}

// Marcadores de Instagram tal como los escribe la función SQL.
function sqlMarkers() {
    const fn = fnBlock(sql, 'artist_gallery_item_is_instagram');
    const source = /lower\(coalesce\(item ->> 'source', ''\)\) = '([^']+)'/.exec(fn);
    const permalink = /coalesce\(item ->> 'permalink', ''\) ilike '%([^'%]+)%'/.exec(fn);
    const url = /coalesce\(item ->> 'url', ''\) like '%([^'%]+)%'/.exec(fn);
    const categories = /lower\(coalesce\(item ->> 'category', ''\)\) in \(([^)]+)\)/.exec(fn);
    assert.ok(source && permalink && url && categories, 'la función SQL perdió algún marcador');
    return {
        fields: [...new Set([...fn.matchAll(/item ->> '(\w+)'/g)].map((m) => m[1]))].sort(),
        source: source[1],
        permalink: permalink[1],
        url: url[1],
        categories: [...categories[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
    };
}

// Port literal de artist_gallery_item_is_instagram / _is_public (enforced).
// `->>` devuelve el texto del valor; los valores no textuales no se usan acá.
function sqlText(value) {
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
}
function sqlNormalizeHandle(value) {
    return sqlText(value).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '').replace(/^@+/, '').toLowerCase();
}
function makeSqlRule(markers) {
    function isInstagram(item) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        return sqlText(item.source).toLowerCase() === markers.source
            || sqlText(item.permalink).toLowerCase().includes(markers.permalink.toLowerCase())
            || sqlText(item.url).includes(markers.url)
            || markers.categories.includes(sqlText(item.category).toLowerCase());
    }
    function isPublic(item, verifiedAt, verifiedHandle) {
        if (!isInstagram(item)) return true;
        if (item.ig_legacy === true) return true;
        if (verifiedAt === null) return false;
        const itemHandle = sqlNormalizeHandle(item.ig_handle);
        if (itemHandle === '') return true;
        return itemHandle === sqlNormalizeHandle(verifiedHandle);
    }
    return { isInstagram, isPublic };
}

test('migración y reversa: cabecera, una transacción y estructura SQL sana', () => {
    assert.match(sql, /Aditiva e idempotente\. APLICADA en flbgmlvfiejfttlawnfu el 2026-10-30/);
    assert.match(sql, /versión remota 20261030131202/);
    assert.match(sql, /-- Reversa:\n--   supabase\/rollbacks\/20261030120000_instagram_verification\.down\.sql/);
    assert.match(down, /^-- Reversa de supabase\/migrations\/20261030120000_instagram_verification\.sql/);
    assert.match(down, /claves "ig_legacy" que el backfill agregó a gallery_feed_items quedan/, 'la reversa explica que ig_legacy queda en su lugar');

    for (const [name, text] of [['migración', sql], ['reversa', down]]) {
        const { skeleton, bodies } = lex(text);
        const statements = skeleton.split(';').map((s) => s.trim()).filter(Boolean);
        assert.match(statements[0], /^begin$/i, `${name}: empieza con begin`);
        assert.match(statements[statements.length - 1], /^commit$/i, `${name}: termina con commit`);
        const STATEMENT = /^(begin|commit|select|create|alter|drop|revoke|grant|comment|update|notify)\b/i;
        for (const statement of statements) {
            assert.match(statement, STATEMENT, `${name}: sentencia inesperada (¿falta un punto y coma?): ${statement.slice(0, 80)}`);
            // Las sentencias empiezan en la columna 0 y sus continuaciones van indentadas
            // o con otra palabra (returns, set, where, ...): una sentencia nueva en la
            // columna 0 dentro de otra es un punto y coma que falta.
            for (const line of statement.split('\n').slice(1)) {
                assert.doesNotMatch(line, STATEMENT, `${name}: falta un punto y coma antes de: ${line}`);
            }
            const clauses = statement.split(/\b(?:add|drop) (?:column|constraint)\b/i);
            for (let k = 1; k < clauses.length - 1; k += 1) {
                assert.match(clauses[k].trimEnd(), /,$/, `${name}: falta una coma entre cláusulas de alter table`);
            }
        }
        assert.equal(parenBalance(skeleton), 0, `${name}: paréntesis balanceados`);
        assert.ok(bodies.length > 0);
        for (const body of bodies) {
            assert.equal(parenBalance(lex(body).skeleton), 0, `${name}: paréntesis balanceados en un cuerpo`);
            if (!/^\s*(declare|begin)\b/i.test(body)) continue;
            const ifs = (body.match(/\bif\b/gi) || []).length;
            const endIfs = (body.match(/\bend\s+if\b/gi) || []).length;
            assert.equal(ifs - endIfs, endIfs, `${name}: cada if tiene su end if`);
            assert.doesNotMatch(body, /\bend\s+(if|loop)\b(?!\s*;)/i, `${name}: end if / end loop sin punto y coma`);
            assert.equal((body.match(/\bbegin\b/gi) || []).length, (body.match(/\bend\s*;/gi) || []).length,
                `${name}: cada begin tiene su end`);
            for (const line of body.split('\n')) {
                if (/:=/.test(line) || /^\s*return\b/i.test(line)) {
                    assert.match(line.trimEnd(), /;$/, `${name}: falta un punto y coma en: ${line.trim()}`);
                }
            }
        }
    }

    const files = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((f) => f.endsWith('_instagram_verification.sql'));
    assert.deepEqual(files, ['20261030120000_instagram_verification.sql']);
});

test('tabla artist_instagram_verifications: columnas y checks del contrato, solo service_role', () => {
    const table = /create table if not exists public\.artist_instagram_verifications \(([\s\S]*?)\n\);/.exec(sql);
    assert.ok(table, 'falta la tabla');
    const columns = table[1];
    for (const re of [
        /id uuid primary key default gen_random_uuid\(\)/,
        /artist_user_id uuid not null references auth\.users \(id\) on delete cascade/,
        /ig_handle text not null/,
        /code_hash text not null/,
        /status text not null default 'pending'\s+check \(status in \('pending', 'verified', 'expired', 'cancelled', 'rejected'\)\)/,
        /email_sent_to text,/,
        /email_sent boolean not null default false/,
        /attempts integer not null default 0/,
        /created_at timestamptz not null default now\(\)/,
        /expires_at timestamptz not null/,
        /\bverified_at timestamptz,/,
        /verified_via text\s+check \(verified_via is null or verified_via in \('dm_webhook', 'support'\)\)/,
        /verified_by uuid/,
        /dm_sender_handle text/,
        /note text/
    ]) {
        assert.match(columns, re);
    }
    assert.doesNotMatch(columns, /\bcode text/, 'nunca se guarda el código en claro');

    assert.match(sql, /on public\.artist_instagram_verifications \(artist_user_id, created_at desc\)/);
    assert.match(sql, /on public\.artist_instagram_verifications \(code_hash\)\s+where status = 'pending'/);
    assert.match(sql, /alter table public\.artist_instagram_verifications enable row level security/);
    assert.match(sql, /revoke all on table public\.artist_instagram_verifications from public, anon, authenticated/);
    assert.match(sql, /grant all on table public\.artist_instagram_verifications to service_role/);
    assert.doesNotMatch(sql, /create policy[^;]*artist_instagram_verifications/i, 'sin políticas: solo el servidor');
    assert.doesNotMatch(sql, /grant [^;]*artist_instagram_verifications to [^;]*\b(anon|authenticated)\b/i);
});

test('artists_db: columnas de validación que solo el servidor puede escribir', () => {
    assert.match(sql, /add column if not exists instagram_verified_at timestamptz/);
    assert.match(sql, /add column if not exists instagram_verified_handle text/);

    const guard = fnBlock(sql, 'enforce_artist_instagram_verification_fields');
    assert.match(guard, /returns trigger/);
    assert.match(guard, /current_user in \('postgres', 'supabase_admin', 'service_role'\)/);
    assert.match(guard, /coalesce\(auth\.role\(\), ''\) = 'service_role'/);
    assert.doesNotMatch(guard, /is_support_user/, 'soporte valida desde el servidor, no por PostgREST');
    assert.match(guard, /tg_op = 'INSERT'[\s\S]*new\.instagram_verified_at is not null[\s\S]*new\.instagram_verified_handle is not null/);
    assert.match(guard, /row\(new\.instagram_verified_at, new\.instagram_verified_handle\)\s+is distinct from\s+row\(old\.instagram_verified_at, old\.instagram_verified_handle\)/);
    assert.equal((guard.match(/errcode = '42501'/g) || []).length, 2);

    assert.match(sql, /create trigger artists_db_protect_instagram_verification_fields\s+before insert or update on public\.artists_db\s+for each row execute function public\.enforce_artist_instagram_verification_fields\(\);/);
    assert.match(sql, /revoke all on function public\.enforce_artist_instagram_verification_fields\(\) from public, anon, authenticated;/);
});

test('la regla SQL y gallery-visibility.js usan los mismos marcadores de Instagram', () => {
    const markers = sqlMarkers();

    const jsBody = /function isInstagramItem\(item\) \{([\s\S]*?)\n    \}/.exec(visibilityJs);
    assert.ok(jsBody, 'isInstagramItem cambió de forma');
    const jsFields = [...new Set([...jsBody[1].matchAll(/item\.(\w+)/g)].map((m) => m[1]))].sort();
    assert.deepEqual(markers.fields, jsFields);
    assert.deepEqual(markers.fields, ['category', 'permalink', 'source', 'url']);

    const jsCategories = /IG_CATEGORIES = \{([^}]*)\}/.exec(visibilityJs);
    assert.ok(jsCategories);
    assert.deepEqual(markers.categories, [...jsCategories[1].matchAll(/'?([\w-]+)'?\s*:/g)].map((m) => m[1]).sort());

    assert.equal(markers.source, 'instagram');
    assert.match(jsBody[1], /=== 'instagram'/);
    assert.equal(markers.permalink, 'instagram.com/');
    assert.match(jsBody[1], /\/instagram\\\.com\\\/\/i/);
    assert.equal(markers.url, '/instagram-import/');
    assert.match(jsBody[1], /indexOf\('\/instagram-import\/'\)/);
    // Igual que indexOf, la url distingue mayúsculas (like, no ilike).
    assert.match(fnBlock(sql, 'artist_gallery_item_is_instagram'), /'url', ''\) like '/);

    // Cada marcador que la función SQL reconoce también lo reconoce el módulo JS.
    const igItems = [
        { url: 'https://cdn.example.com/a.jpg', category: 'realizados', source: markers.source.toUpperCase() },
        { url: 'https://cdn.example.com/b.jpg', category: 'realizados', permalink: 'https://www.' + markers.permalink.toUpperCase() + 'p/abc/' },
        { url: 'https://x.supabase.co/storage/v1/object/public/artist-gallery' + markers.url + 'uid/abc.jpg', category: 'realizados' }
    ].concat(markers.categories.map((category) => ({ url: 'https://cdn.example.com/c.jpg', category: category.toUpperCase() })));
    const rule = makeSqlRule(markers);
    for (const item of igItems) {
        assert.equal(rule.isInstagram(item), true, JSON.stringify(item));
        assert.equal(Visibility.isInstagramItem(item), true, JSON.stringify(item));
    }
});

test('artist_gallery_item_is_public: misma decisión que isPubliclyVisible con la validación activa', () => {
    const fn = fnBlock(sql, 'artist_gallery_item_is_public');
    assert.match(fn, /\(\s*item jsonb,\s*verified_at timestamptz,\s*verified_handle text\s*\)\s*returns boolean/);
    assert.match(fn, /\bimmutable\b/);
    // Pasos en el mismo orden que el JS.
    const steps = [
        /if not public\.artist_gallery_item_is_instagram\(item\) then\s+return true;/,
        /if \(item -> 'ig_legacy'\) = 'true'::jsonb then\s+return true;/,
        /if verified_at is null then\s+return false;/,
        /item_handle := lower\(ltrim\(btrim\(coalesce\(item ->> 'ig_handle', ''\), E' \\t\\r\\n'\), '@'\)\);/,
        /if item_handle = '' then\s+return true;/,
        /return item_handle = lower\(ltrim\(btrim\(coalesce\(verified_handle, ''\), E' \\t\\r\\n'\), '@'\)\);/
    ];
    let last = -1;
    for (const step of steps) {
        const at = fn.search(step);
        assert.ok(at > last, `paso fuera de orden o ausente: ${step}`);
        last = at;
    }

    const rule = makeSqlRule(sqlMarkers());
    const bases = [
        { url: 'https://cdn.example.com/p.jpg', category: 'realizados', permalink: 'https://example.com/instagram' },
        { url: 'https://cdn.example.com/INSTAGRAM-IMPORT/p.jpg', category: 'flash' },
        { url: 'https://cdn.example.com/p.jpg', category: 'instagramx', source: 'instagram-ish' },
        { url: 'https://cdn.example.com/a.jpg', category: 'realizados', source: 'instagram' },
        { url: 'https://cdn.example.com/b.jpg', category: 'realizados', permalink: 'https://www.instagram.com/p/abc/' },
        { url: 'https://x.supabase.co/storage/v1/object/public/artist-gallery/instagram-import/uid/abc.jpg', category: 'realizados' },
        { url: 'https://cdn.example.com/c.jpg', category: 'instagram' },
        { url: 'https://cdn.example.com/d.mp4', category: 'instagram-reel', kind: 'video' }
    ];
    const legacyVariants = [undefined, true, false, 'true'];
    const handleVariants = [undefined, 'laura.tattoo', ' @Laura.Tattoo ', 'otra.cuenta', '@', ''];
    const states = [
        { verifiedAt: null, handle: null },
        { verifiedAt: null, handle: 'laura.tattoo' },
        { verifiedAt: '2026-10-30T12:00:00Z', handle: 'laura.tattoo' },
        { verifiedAt: '2026-10-30T12:00:00Z', handle: '@LAURA.TATTOO' },
        { verifiedAt: '2026-10-30T12:00:00Z', handle: null },
        { verifiedAt: '2026-10-30T12:00:00Z', handle: '  ' }
    ];
    const items = [null, 'https://cdn.example.com/legacy-string.jpg'];
    for (const base of bases) {
        for (const legacy of legacyVariants) {
            for (const handle of handleVariants) {
                const item = Object.assign({}, base);
                if (legacy !== undefined) item.ig_legacy = legacy;
                if (handle !== undefined) item.ig_handle = handle;
                items.push(item);
            }
        }
    }
    let hidden = 0;
    for (const item of items) {
        for (const state of states) {
            // Lo que devuelve la RPC: { enforced: true, verified, handle: nullif(btrim(handle), '') }.
            const rpc = {
                enforced: true,
                verified: state.verifiedAt !== null,
                handle: state.handle === null ? null : (state.handle.trim() || null)
            };
            const expected = Visibility.isPubliclyVisible(item, Visibility.stateFrom(rpc));
            const actual = rule.isPublic(item, state.verifiedAt, state.handle);
            assert.equal(actual, expected, JSON.stringify({ item, state }));
            if (!actual) hidden += 1;
        }
    }
    assert.ok(hidden > 0, 'la matriz cubre ítems ocultos');
});

test('gallery_images se deriva solo de ítems públicos y el trigger escucha las columnas de validación', () => {
    const sync = fnBlock(sql, 'sync_artist_gallery_feed_items');
    assert.match(sync, /returns trigger/);
    assert.match(sync, /new\.gallery_feed_items := public\.artist_gallery_feed_items_from_legacy_images\(new\.gallery_images\);/,
        'sin feed se reconstruye desde la columna legacy, como antes');
    assert.match(sync, /where public\.artist_gallery_item_is_public\(feed\.item, new\.instagram_verified_at, new\.instagram_verified_handle\)/);
    assert.match(sync, /new\.gallery_images := public\.artist_gallery_feed_items_to_legacy_images\(visible_items\);/);
    assert.equal((sync.match(/artist_gallery_feed_items_to_legacy_images\(/g) || []).length, 1,
        'una sola salida: la copia legacy siempre pasa por el filtro');
    assert.match(sync, /order by feed\.ord/, 'se conserva el orden del feed');
    // ig_legacy se conserva por url en los UPDATE (clientes con estado viejo).
    assert.match(sync, /if tg_op = 'UPDATE' then[\s\S]*\(feed\.item -> 'ig_legacy'\) is null[\s\S]*jsonb_array_elements\(old\.gallery_feed_items\) as prev\(item\)[\s\S]*\(prev\.item -> 'ig_legacy'\) = 'true'::jsonb[\s\S]*\(prev\.item ->> 'url'\) = \(feed\.item ->> 'url'\)[\s\S]*then feed\.item \|\| '\{"ig_legacy": true\}'::jsonb/);

    const trigger = /create trigger trigger_sync_artist_gallery_feed_items\s+before insert or update of ([^\n]+)\n\s+on public\.artists_db\s+for each row\s+execute function public\.sync_artist_gallery_feed_items\(\);/.exec(sql);
    assert.ok(trigger, 'falta el trigger de sincronización');
    assert.deepEqual(trigger[1].split(',').map((c) => c.trim()),
        ['gallery_images', 'gallery_feed_items', 'instagram_verified_at', 'instagram_verified_handle']);
    assert.match(sql, /drop trigger if exists trigger_sync_artist_gallery_feed_items on public\.artists_db;/);
    assert.ok(sql.indexOf('add column if not exists instagram_verified_at') < sql.indexOf('create trigger trigger_sync_artist_gallery_feed_items'));

    for (const signature of ['artist_gallery_item_is_instagram(jsonb)', 'artist_gallery_item_is_public(jsonb, timestamptz, text)']) {
        const escaped = signature.replace(/[()]/g, '\\$&');
        assert.match(sql, new RegExp(`grant execute on function public\\.${escaped} to anon, authenticated, service_role;`), signature);
    }
});

test('backfill: marca ig_legacy en las importaciones existentes, una sola vez y solo donde falta', () => {
    const update = /update public\.artists_db as artist\n([\s\S]*?);\n/.exec(sql);
    assert.ok(update, 'falta el backfill');
    const body = update[1];
    assert.match(body, /set gallery_feed_items = coalesce\(/);
    assert.match(body, /when public\.artist_gallery_item_is_instagram\(feed\.item\)\s+then feed\.item \|\| '\{"ig_legacy": true\}'::jsonb\s+else feed\.item/);
    assert.match(body, /order by feed\.ord/);
    // Solo filas con algún ítem de IG sin marcar: volver a correrlo no toca nada.
    assert.match(body, /and exists \([\s\S]*where public\.artist_gallery_item_is_instagram\(pending\.item\)\s+and \(pending\.item -> 'ig_legacy'\) is distinct from 'true'::jsonb/);
    // Solo en la primera aplicación: una re-aplicación no "legaliza" importaciones
    // nuevas. La señal es que artist_gallery_item_is_public todavía no exista, por
    // eso el backfill va antes de crearla (y después de artist_gallery_item_is_instagram).
    const firstRun = /where to_regprocedure\('public\.artist_gallery_item_is_public\(([^)]*)\)'\) is null\n/.exec(body);
    assert.ok(firstRun, 'falta la condición de primera aplicación');
    const created = /create or replace function public\.artist_gallery_item_is_public\(\s*item (\w+),\s*verified_at (\w+),\s*verified_handle (\w+)\s*\)/.exec(sql);
    assert.deepEqual(firstRun[1].split(',').map((t) => t.trim()), created.slice(1, 4), 'la condición usa la firma real');
    assert.ok(sql.indexOf('create or replace function public.artist_gallery_item_is_instagram') < update.index);
    assert.ok(update.index < created.index, 'el backfill corre antes de crear artist_gallery_item_is_public');
    assert.doesNotMatch(sql, /set_config|current_setting/, 'sin estado de sesión: no depende de cómo se ejecute la transacción');
});

test('RPC pública: mismo cuerpo de 20260829103500 más instagram_validation', () => {
    const original = fnBlock(prefsMigration, 'get_artist_public_profile_preferences');
    const rpc = fnBlock(sql, 'get_artist_public_profile_preferences');
    assert.match(rpc, /'instagram_validation', jsonb_build_object\(\s*'enforced', true,\s*'verified', artist\.instagram_verified_at is not null,\s*'handle', nullif\(btrim\(artist\.instagram_verified_handle\), ''\)\s*\)/);
    const withoutInstagram = rpc.replace(/,\n    'instagram_validation', jsonb_build_object\([\s\S]*?\n    \)\n/, '\n');
    assert.equal(withoutInstagram, original, 'conserva cada clave y atributo de la RPC original');
    assert.match(sql, /revoke all on function public\.get_artist_public_profile_preferences\(uuid\) from public;/);
    assert.match(sql, /grant execute on function public\.get_artist_public_profile_preferences\(uuid\) to anon, authenticated;/);
    assert.match(sql, /comment on function public\.get_artist_public_profile_preferences\(uuid\) is\n\s+'[^']*Instagram validation[^']*';/);
    assert.ok(sql.indexOf('add column if not exists instagram_verified_handle') < sql.indexOf('create or replace function public.get_artist_public_profile_preferences'));

    // La forma de la RPC es la que entiende WoGalleryVisibility.stateFrom.
    assert.deepEqual(Visibility.stateFrom({ enforced: true, verified: true, handle: 'Laura.Tattoo' }),
        { enforced: true, verified: true, handle: 'laura.tattoo' });
    assert.deepEqual(Visibility.stateFrom({ enforced: true, verified: false, handle: null }),
        { enforced: true, verified: false, handle: null });
});

test('reversa: borra lo nuevo y restaura literalmente los cuerpos originales', () => {
    const originalSync = fnBlock(feedMigration, 'sync_artist_gallery_feed_items');
    const originalTrigger = /DROP TRIGGER IF EXISTS trigger_sync_artist_gallery_feed_items[\s\S]*?EXECUTE FUNCTION public\.sync_artist_gallery_feed_items\(\);/.exec(feedMigration);
    assert.ok(originalTrigger);
    const originalRpc = prefsMigration.slice(prefsMigration.indexOf('create or replace function')).trim();

    assert.ok(down.includes(originalSync), 'restaura sync_artist_gallery_feed_items de 20260329000000');
    assert.ok(down.includes(originalTrigger[0]), 'restaura el trigger con su lista de columnas original');
    assert.ok(down.includes(originalRpc), 'restaura la RPC, sus grants y su comentario de 20260829103500');

    for (const re of [
        /drop trigger if exists artists_db_protect_instagram_verification_fields on public\.artists_db;/,
        /drop function if exists public\.enforce_artist_instagram_verification_fields\(\);/,
        /drop function if exists public\.artist_gallery_item_is_public\(jsonb, timestamptz, text\);/,
        /drop function if exists public\.artist_gallery_item_is_instagram\(jsonb\);/,
        /drop column if exists instagram_verified_handle/,
        /drop column if exists instagram_verified_at/,
        /drop table if exists public\.artist_instagram_verifications;/
    ]) {
        assert.match(down, re);
    }
    // gallery_images vuelve a tener todas las fotos del feed.
    assert.match(down, /update public\.artists_db\nset gallery_images = public\.artist_gallery_feed_items_to_legacy_images\(gallery_feed_items\)/);

    // Orden: nada que siga vivo puede depender de lo que se borra.
    const dropColumns = down.indexOf('drop column if exists instagram_verified_at');
    assert.ok(down.indexOf(originalTrigger[0]) < dropColumns, 'el trigger deja de listar las columnas antes de borrarlas');
    assert.ok(down.indexOf(originalRpc) < dropColumns, 'la RPC deja de leer las columnas antes de borrarlas');
    assert.ok(down.indexOf(originalSync) < down.indexOf('drop function if exists public.artist_gallery_item_is_public'));
    assert.ok(down.indexOf('drop function if exists public.enforce_artist_instagram_verification_fields') < dropColumns);
    const live = lex(down).skeleton;
    assert.equal((live.match(/instagram_verified_at/g) || []).length, 1, 'fuera de comentarios solo aparece en el drop column');
    assert.doesNotMatch(live, /ig_legacy/, 'las claves ig_legacy no se tocan');
});

test('la reversa devuelve el search_path que la función de sincronización tiene en producción', () => {
    // 20260610220000_fix_function_search_paths fijó search_path = public, extensions con
    // ALTER FUNCTION; el CREATE OR REPLACE original lo borra, así que la reversa lo repone.
    const create = down.indexOf('CREATE OR REPLACE FUNCTION public.sync_artist_gallery_feed_items()');
    const alter = down.indexOf('ALTER FUNCTION public.sync_artist_gallery_feed_items() SET search_path = public, extensions;');
    assert.ok(create !== -1, 'la reversa recrea la función');
    assert.ok(alter > create, 'el ALTER va después del CREATE OR REPLACE');
});
