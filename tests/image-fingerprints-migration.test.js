'use strict';
// Migración de huellas de imágenes (20261118140000_image_fingerprints.sql) y
// su reversa. No hay Postgres local: se revisa el texto SQL. La migración se
// validó en el proyecto vivo dentro de begin … rollback.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = 'supabase/migrations/20261118140000_image_fingerprints.sql';
const ROLLBACK = 'supabase/rollbacks/20261118140000_image_fingerprints.down.sql';
const sql = read(MIGRATION);
const down = read(ROLLBACK);

// Sin comentarios de línea, para no aprobar un test con texto comentado.
const code = (text) => text.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const sqlCode = code(sql);
const downCode = code(down);

function tableBlock(name) {
    const start = sqlCode.indexOf(`create table if not exists public.${name} (`);
    assert.ok(start >= 0, `falta la tabla ${name}`);
    const end = sqlCode.indexOf('\n);', start);
    assert.ok(end > start, `tabla sin cerrar: ${name}`);
    return sqlCode.slice(start, end);
}

function functionBlock(signatureStart) {
    const start = sqlCode.indexOf(`create or replace function ${signatureStart}`);
    assert.ok(start >= 0, `falta la función ${signatureStart}`);
    const end = sqlCode.indexOf('$fn$;', start);
    return sqlCode.slice(start, end);
}

function triggerBlock(name) {
    const start = sqlCode.indexOf(`create trigger ${name}`);
    assert.ok(start >= 0, `falta el trigger ${name}`);
    const end = sqlCode.indexOf(';', start);
    return sqlCode.slice(start, end);
}

test('la migración es una transacción, corre después de las sanciones y tiene reversa', () => {
    assert.match(sqlCode, /^\s*begin;/m);
    assert.match(sqlCode, /^\s*commit;\s*$/m);
    assert.match(downCode, /^\s*begin;/m);
    assert.match(downCode, /^\s*commit;\s*$/m);
    assert.ok(sql.includes(ROLLBACK), 'la migración nombra su reversa');
    assert.ok(sql.includes('20261118130000_account_sanctions'), 'declara que depende de las sanciones');
    const files = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((f) => f.startsWith('20261118'));
    assert.equal(files.sort().at(-1), '20261118140000_image_fingerprints.sql');
});

test('image_fingerprints: columnas, CHECKs y único (source_kind, item_key)', () => {
    const t = tableBlock('image_fingerprints');
    for (const col of ['id uuid primary key', 'source_kind text not null', 'artist_id uuid', 'studio_id uuid', 'owner_user_id uuid',
        'item_key text not null', 'image_url text', 'storage_bucket text', 'storage_path text', 'sha256 text',
        'phash bit(64)', 'phash_mirror bit(64)', 'dhash bit(64)', 'width integer', 'height integer',
        "status text not null default 'ok'", 'is_public boolean not null default false',
        'first_seen_at timestamptz not null default now()', 'claimed_at timestamptz', 'removed_at timestamptz',
        'created_at timestamptz', 'updated_at timestamptz']) {
        assert.ok(t.includes(col), `columna: ${col}`);
    }
    assert.match(t, /source_kind in \('artist_gallery', 'flash', 'studio_feed', 'store_preview', 'store_design'\)/);
    assert.match(t, /status in \('ok', 'decode_failed', 'skipped_external', 'fetch_failed'\)/);
    assert.match(t, /unique \(source_kind, item_key\)/);
    assert.match(t, /artist_id is not null or studio_id is not null/);
    assert.match(t, /status <> 'ok' or \(sha256 is not null and phash is not null/);
    assert.match(sqlCode, /trg_image_fingerprints_updated_at[\s\S]*?execute function public\.set_updated_at\(\)/);
});

test('cola por dueño y registro de búsquedas', () => {
    const q = tableBlock('image_fingerprint_queue');
    for (const col of ['source_table text not null', 'owner_id uuid not null', 'dirty_at timestamptz', 'attempts integer', 'last_error text']) {
        assert.ok(q.includes(col), col);
    }
    assert.match(q, /primary key \(source_table, owner_id\)/);
    assert.match(q, /source_table in \('artists_db', 'studios', 'store_products'\)/);

    const l = tableBlock('design_search_log');
    for (const col of ['id uuid primary key', 'user_id uuid not null', 'result_count integer', 'created_at timestamptz']) {
        assert.ok(l.includes(col), col);
    }
    assert.match(sqlCode, /create index if not exists design_search_log_user_idx\s+on public\.design_search_log \(user_id, created_at desc\)/);
});

test('RLS: soporte lee; anon y authenticated sin otro acceso; escribe service_role', () => {
    for (const t of ['image_fingerprints', 'image_fingerprint_queue', 'design_search_log']) {
        assert.match(sqlCode, new RegExp(`alter table public\\.${t} enable row level security;`), `RLS ${t}`);
        assert.match(sqlCode, new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated;`), `revoke ${t}`);
        assert.match(sqlCode, new RegExp(`grant select on table public\\.${t} to authenticated;`), `select ${t}`);
        assert.match(sqlCode, new RegExp(`grant all on table public\\.${t} to service_role;`), `service_role ${t}`);
        assert.match(sqlCode, new RegExp(`create policy ${t}_support_select\\s+on public\\.${t} for select to authenticated\\s+using \\(public\\.is_support_user\\(\\)\\);`), `política ${t}`);
        assert.doesNotMatch(sqlCode, new RegExp(`grant (insert|update|delete|all)[^;]*on table public\\.${t} to (anon|authenticated)`), `escritura ${t}`);
        assert.doesNotMatch(sqlCode, new RegExp(`on public\\.${t} for (insert|update|delete|all)`), `política de escritura ${t}`);
    }
});

test('marca de sucio: SECURITY DEFINER, search_path vacío, upsert por dueño', () => {
    const fn = functionBlock('private.image_fp_mark_dirty()');
    assert.match(fn, /returns trigger/);
    assert.match(fn, /security definer/);
    assert.match(fn, /set search_path = ''/);
    assert.match(fn, /insert into public\.image_fingerprint_queue/);
    assert.match(fn, /on conflict \(source_table, owner_id\) do update/);
    assert.match(fn, /store_products p/);
    assert.match(sqlCode, /revoke all on function private\.image_fp_mark_dirty\(\) from public, anon, authenticated;/);
});

test('triggers AFTER en las cuatro tablas, los de UPDATE con guarda WHEN', () => {
    const updates = {
        trg_image_fp_dirty_artists_upd: ['public.artists_db', 'old.gallery_feed_items is distinct from new.gallery_feed_items', "('artists_db', 'user_id', 'direct')"],
        trg_image_fp_dirty_studios_upd: ['public.studios', 'old.photo_feed_items is distinct from new.photo_feed_items', "('studios', 'id', 'direct')"],
        trg_image_fp_dirty_store_products_upd: ['public.store_products', 'old.images is distinct from new.images', "('store_products', 'seller_id', 'direct')"]
    };
    for (const [name, [table, guard, args]] of Object.entries(updates)) {
        const t = triggerBlock(name);
        assert.match(t, new RegExp(`after update on ${table.replace('.', '\\.')}`), name);
        assert.match(t, /for each row\s+when \(/, `${name} con WHEN`);
        assert.ok(t.includes(guard), `${name}: ${guard}`);
        assert.ok(t.includes(`private.image_fp_mark_dirty${args}`), `${name}: argumentos`);
    }
    for (const name of ['trg_image_fp_dirty_artists_ins_del', 'trg_image_fp_dirty_studios_ins_del', 'trg_image_fp_dirty_store_products_ins_del']) {
        assert.match(triggerBlock(name), /after insert or delete on public\./, name);
    }
    const assets = triggerBlock('trg_image_fp_dirty_store_design_assets');
    assert.match(assets, /after insert or delete on public\.store_design_assets/);
    assert.ok(assets.includes("('store_products', 'product_id', 'product')"));
    // La guarda de artistas también mira la visibilidad (Instagram, alta, sanción).
    const artists = triggerBlock('trg_image_fp_dirty_artists_upd');
    for (const col of ['instagram_verified_at', 'instagram_verified_handle', 'registration_status', 'sanction_state']) {
        assert.ok(artists.includes(`old.${col} is distinct from new.${col}`), col);
    }
});

test('RPC del buscador: firma, distancia con espejo, filtros y solo service_role', () => {
    const fn = functionBlock('public.search_image_fingerprints(');
    assert.match(fn, /p_phash bit\(64\),\s+p_phash_mirror bit\(64\),\s+p_max integer default 12,\s+p_threshold integer default 12/);
    for (const col of ['id uuid', 'source_kind text', 'artist_id uuid', 'studio_id uuid', 'owner_user_id uuid', 'item_key text', 'image_url text', 'first_seen_at timestamptz', 'distance integer']) {
        assert.ok(fn.includes(col), col);
    }
    assert.match(fn, /security definer/);
    assert.match(fn, /set search_path = ''/);
    assert.match(fn, /bit_count\(f\.phash # p_phash\)/);
    assert.match(fn, /bit_count\(f\.phash_mirror # p_phash\)/);
    assert.match(fn, /bit_count\(f\.phash # coalesce\(p_phash_mirror, p_phash\)\)/);
    assert.match(fn, /f\.status = 'ok'/);
    assert.match(fn, /f\.removed_at is null/);
    assert.match(fn, /f\.is_public/);
    assert.match(fn, /public\.artist_is_public\(a\.registration_status, a\.sanction_state\)/);
    assert.match(fn, /s\.is_active\s+and s\.sanction_state = 'none'/);
    assert.match(fn, /order by d\.distance, f\.first_seen_at/);
});

test('RPC del trabajo, de Storage y de alertas: solo service_role', () => {
    const cand = functionBlock('public.image_fp_candidates(');
    assert.match(cand, /p_exclude_owner uuid default null/);
    assert.match(cand, /f\.owner_user_id is distinct from p_exclude_owner/);
    assert.doesNotMatch(cand, /and f\.is_public/, 'incluye las no públicas (prueba de antigüedad)');
    assert.doesNotMatch(cand, /removed_at is null/, 'incluye las borradas');

    const storage = functionBlock('private.image_fp_storage_created_at(');
    assert.match(storage, /from storage\.objects o/);
    assert.match(storage, /p_bucket in \('artist-gallery', 'studio-photos', 'store-previews', 'store-design-files'\)/);

    const alert = functionBlock('public.image_fp_record_alert(');
    assert.match(alert, /on conflict \(\(payload ->> 'pair_key'\)\) where kind = 'image_duplicate' do nothing/);
    assert.match(alert, /'image_duplicate', 'open'/);

    const signatures = [
        'public.search_image_fingerprints(bit, bit, integer, integer)',
        'public.image_fp_candidates(bit, bit, integer, uuid)',
        'private.image_fp_storage_created_at(text, text[])',
        'public.image_fp_storage_created_at(text, text[])',
        'public.image_fp_record_alert(uuid, uuid, jsonb)'
    ];
    for (const sig of signatures) {
        const esc = sig.replace(/[.()[\]]/g, '\\$&');
        assert.match(sqlCode, new RegExp(`revoke all on function ${esc} from public, anon, authenticated;`), `revoke ${sig}`);
        assert.match(sqlCode, new RegExp(`grant execute on function ${esc} to service_role;`), `grant ${sig}`);
        assert.doesNotMatch(sqlCode, new RegExp(`grant execute on function ${esc} to [^;]*(anon|authenticated)`), `sin anon ${sig}`);
    }
});

test('una alerta por par: índice único parcial en security_alerts', () => {
    assert.match(sqlCode, /create unique index if not exists security_alerts_image_pair_key\s+on public\.security_alerts \(\(payload ->> 'pair_key'\)\)\s+where kind = 'image_duplicate';/);
});

test('nada en la migración oculta ni modifica ítems de usuarios', () => {
    assert.doesNotMatch(sqlCode, /update public\.(artists_db|studios|store_products|store_design_assets)/);
    assert.doesNotMatch(sqlCode, /delete from public\.(artists_db|studios|store_products|store_design_assets)/);
});

test('la reversa borra triggers, funciones, índice y tablas', () => {
    for (const name of ['trg_image_fp_dirty_artists_upd', 'trg_image_fp_dirty_artists_ins_del', 'trg_image_fp_dirty_studios_upd',
        'trg_image_fp_dirty_studios_ins_del', 'trg_image_fp_dirty_store_products_upd', 'trg_image_fp_dirty_store_products_ins_del',
        'trg_image_fp_dirty_store_design_assets']) {
        assert.match(downCode, new RegExp(`drop trigger if exists ${name} on public\\.`), name);
    }
    for (const fn of ['public.image_fp_record_alert(uuid, uuid, jsonb)', 'public.image_fp_storage_created_at(text, text[])',
        'private.image_fp_storage_created_at(text, text[])', 'public.image_fp_candidates(bit, bit, integer, uuid)',
        'public.search_image_fingerprints(bit, bit, integer, integer)', 'private.image_fp_mark_dirty()']) {
        assert.ok(downCode.includes(`drop function if exists ${fn};`), fn);
    }
    assert.match(downCode, /drop index if exists public\.security_alerts_image_pair_key;/);
    for (const t of ['design_search_log', 'image_fingerprint_queue', 'image_fingerprints']) {
        assert.match(downCode, new RegExp(`drop table if exists public\\.${t};`), t);
    }
    // Los triggers se borran antes que la función que ejecutan.
    assert.ok(downCode.indexOf('drop trigger') < downCode.indexOf('drop function if exists private.image_fp_mark_dirty()'));
    // No toca security_alerts (es de la migración de sanciones).
    assert.doesNotMatch(downCode, /drop table if exists public\.security_alerts/);
});

test('versión del contenido y búsqueda pendiente: columnas y datos de Storage', () => {
    const t = tableBlock('image_fingerprints');
    assert.ok(t.includes('content_version text null'));
    assert.ok(t.includes('match_checked_at timestamptz null'));
    assert.match(t, /content_version is null or char_length\(content_version\) <= 300/);
    const storage = functionBlock('private.image_fp_storage_created_at(');
    assert.match(storage, /returns table \(path text, created_at timestamptz, updated_at timestamptz, version text\)/);
    assert.match(storage, /concat_ws\('\|', o\.id::text, o\.version, o\.metadata ->> 'eTag'\)/);
    const wrapper = functionBlock('public.image_fp_storage_created_at(');
    assert.match(wrapper, /returns table \(path text, created_at timestamptz, updated_at timestamptz, version text\)/);
});
