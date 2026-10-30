'use strict';
// Store del artista · contrato del esquema SQL (migración NO aplicada).
// Lee supabase/migrations/20261030150000_store_core.sql y su reversa con regex
// y fija: RLS y grants por tabla, grant por función según el contrato
// (docs/plans/2026-10-30-store-artista.md §4-§6), search_path vacío, wallet
// dinámico y condicionado, buckets y policies de Storage.
//
// Exporta el contrato de buckets leído del SQL (readStoreBucketContract) para
// que tests/store-model.test.js compare FILES contra la migración.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
// En Windows con core.autocrlf=true el checkout deja CRLF: las regex del test asumen \n.
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = 'supabase/migrations/20261030150000_store_core.sql';
const ROLLBACK = 'supabase/rollbacks/20261030150000_store_core.down.sql';
const MODEL = 'public/shared/js/store-model.js';

const STORE_TABLES = [
    'store_products',
    'store_product_variants',
    'store_design_assets',
    'store_seller_settings',
    'store_orders',
    'store_order_items',
    'store_payments',
    'store_licenses',
    'store_download_events',
    'store_order_support_notes',
];

// Grant esperado por función (contrato §4): usuario → authenticated,
// públicas → anon + authenticated, servicio → service_role, el resto ninguno.
const GRANTS = {
    // comprador
    create_store_order: 'authenticated',
    report_store_payment: 'authenticated',
    confirm_store_order_received: 'authenticated',
    mark_store_license_used: 'authenticated',
    // comprador, vendedor o soporte
    cancel_store_order: 'authenticated',
    // vendedor o soporte
    confirm_store_order_payment: 'authenticated',
    update_store_order_fulfillment: 'authenticated',
    refund_store_order: 'authenticated',
    adjust_store_variant_stock: 'authenticated',
    get_store_sales_report: 'authenticated',
    // soporte
    set_store_order_funds_hold: 'authenticated',
    resolve_store_order_flag: 'authenticated',
    // helpers que usan las policies
    store_can_manage_seller: 'authenticated',
    store_can_manage_storage_folder: 'authenticated',
    // públicas
    get_public_storefront: 'anon, authenticated',
    get_public_store_product: 'anon, authenticated',
    verify_store_license: 'anon, authenticated',
    // servicio
    release_store_order_funds: 'service_role',
    run_store_maintenance: 'service_role',
    confirm_store_order_payment_as_provider: 'service_role',
};
const INTERNAL = [
    'store_seller_ready_artist',
    'store_current_terms_version',
    'store_order_uses_wallet',
    'store_order_lapsed',
    'store_app_setting',
    'store_platform_fee_pct',
    'store_new_order_number',
    'store_new_license_code',
    'store_lock_order',
    'store_try_lock_order',
    'store_close_unpaid_order',
    'store_wallet_insert',
    'store_wallet_upsert_payment',
    'store_finish_delivery',
    'store_public_product_json',
    'store_public_seller_bundle',
    'store_apply_order_payment',
    'store_products_guard',
    'store_product_variants_guard',
    'store_design_assets_guard',
    'store_seller_settings_guard',
];
const SERVICE = ['release_store_order_funds', 'run_store_maintenance', 'confirm_store_order_payment_as_provider'];
const GUARDS = ['store_products_guard', 'store_product_variants_guard', 'store_design_assets_guard', 'store_seller_settings_guard'];

// Firmas (nombres de parámetros) que usa PostgREST: no se pueden renombrar.
const RPC_PARAMS = {
    create_store_order: ['p_product_id', 'p_variant_id', 'p_quantity', 'p_license_tier', 'p_license_holder_name',
        'p_fulfillment_method', 'p_shipping_address', 'p_buyer_note', 'p_terms_version', 'p_idempotency_key'],
    report_store_payment: ['p_order_id', 'p_reference'],
    confirm_store_order_received: ['p_order_id'],
    mark_store_license_used: ['p_license_id', 'p_note'],
    cancel_store_order: ['p_order_id', 'p_reason'],
    confirm_store_order_payment: ['p_order_id', 'p_collected_by', 'p_reference', 'p_note'],
    update_store_order_fulfillment: ['p_order_id', 'p_status', 'p_tracking_carrier', 'p_tracking_code', 'p_tracking_url', 'p_seller_message'],
    refund_store_order: ['p_order_id', 'p_reason'],
    adjust_store_variant_stock: ['p_variant_id', 'p_new_stock', 'p_expected_stock'],
    get_store_sales_report: ['p_seller_type', 'p_seller_id', 'p_from', 'p_to'],
    set_store_order_funds_hold: ['p_order_id', 'p_hold', 'p_note'],
    resolve_store_order_flag: ['p_order_id', 'p_note'],
    get_public_storefront: ['p_seller_type', 'p_handle'],
    get_public_store_product: ['p_product_id'],
    verify_store_license: ['p_code'],
    release_store_order_funds: ['p_order_id'],
    run_store_maintenance: [],
    confirm_store_order_payment_as_provider: ['p_order_id', 'p_provider', 'p_reference', 'p_amount', 'p_currency'],
    store_seller_ready_artist: ['p_user'],
    store_can_manage_seller: ['p_seller_type', 'p_seller_id'],
    store_can_manage_storage_folder: ['p_folder'],
};

// Códigos store:* del contrato (§4). download_limit lo emite el servidor (429).
const ERROR_CODES = [
    'not_authenticated', 'forbidden', 'not_found',
    'product_unavailable', 'product_reserved', 'exclusive_unavailable', 'tier_unavailable',
    'artist_tier_requires_artist', 'own_product', 'design_no_longer_available',
    'email_unconfirmed', 'too_many_pending', 'pending_order_exists', 'exclusive_cooldown',
    'variant_required', 'variant_unavailable', 'out_of_stock', 'invalid_quantity', 'pickup_unavailable',
    'shipping_address_invalid', 'ships_to_unsupported',
    'seller_not_ready', 'terms_version_mismatch',
    'invalid_status', 'order_not_payable', 'collector_mismatch', 'payment_reported', 'cannot_reopen',
    'tracking_required', 'invalid_tracking_url',
    'stock_changed', 'checklist_incomplete', 'asset_licensed', 'asset_missing', 'invalid_image_path',
    'download_limit', 'license_revoked', 'license_used',
];
const SERVER_ONLY_CODES = ['download_limit'];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripComments = (sql) => sql.replace(/--[^\n]*/g, '');

function readStoreMigration() {
    return read(MIGRATION);
}

// Funciones creadas: nombre, argumentos, encabezado (returns … language …) y cuerpo.
function parseFunctions(sql) {
    const out = [];
    const re = /create or replace function public\.([a-z_]+)\(([\s\S]*?)\)\s*(returns[\s\S]*?)as \$\$([\s\S]*?)\$\$;/g;
    let m;
    while ((m = re.exec(sql))) {
        const params = m[2].split(',').map((p) => p.trim()).filter(Boolean).map((p) => p.split(/\s+/)[0]);
        out.push({ name: m[1], args: m[2], params, header: m[3], body: m[4] });
    }
    return out;
}

// Firma de la función según su revoke (la misma que usa el rollback).
function revokeSignature(sql, name) {
    const m = sql.match(new RegExp(`revoke all on function public\\.${name}\\(([^)]*)\\)\\s+from\\s+([^;]+);`, 'i'));
    return m ? { sig: m[1].trim(), from: m[2].trim() } : null;
}

// Contrato de buckets leído del SQL: { id: { public, fileSizeLimit, mime[] } }.
function readStoreBucketContract(sql = readStoreMigration()) {
    const buckets = {};
    const re = /insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)\s*values \(\s*'([^']+)',\s*'[^']+',\s*(true|false),\s*(\d+),\s*array\[([^\]]*)\]\s*\)/gi;
    let m;
    while ((m = re.exec(sql))) {
        buckets[m[1]] = {
            public: m[2] === 'true',
            fileSizeLimit: Number(m[3]),
            mime: [...m[4].matchAll(/'([^']+)'/g)].map((x) => x[1]),
        };
    }
    return buckets;
}

// MIME del stencil (constraint de store_design_assets, igual al guard).
function readStencilMime(sql = readStoreMigration()) {
    const m = sql.match(/constraint store_design_assets_stencil_mime_check check \(\s*kind <> 'stencil' or \(mime_type is not null and mime_type in \(([^)]*)\)\)/);
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
}

module.exports = { readStoreMigration, readStoreBucketContract, readStencilMime, STORE_TABLES };

test('Store schema: un único archivo store_core, transaccional, idempotente y que recarga PostgREST', () => {
    const files = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((f) => f.includes('store_core'));
    assert.deepEqual(files, ['20261030150000_store_core.sql']);
    const sql = readStoreMigration();
    const active = stripComments(sql).trim();
    assert.match(sql, /NO APLICADA/);
    assert.match(sql, /Reversa:[\s\S]*20261030150000_store_core\.down\.sql/);
    assert.match(active, /^begin\s*;/i);
    assert.match(active, /notify pgrst, 'reload schema';\s*commit\s*;\s*$/i);

    for (const table of STORE_TABLES) {
        assert.match(sql, new RegExp(`create table if not exists public\\.${table} \\(`), table);
    }
    assert.doesNotMatch(active, /create table (?!if not exists)/i);
    assert.doesNotMatch(active, /create (unique )?index (?!if not exists)/i);
    for (const m of active.matchAll(/create policy ("?[a-z_]+"?) on ([a-z_.]+)/g)) {
        assert.match(active, new RegExp(`drop policy if exists ${escape(m[1])} on ${escape(m[2])};\\s*create policy ${escape(m[1])} on`), m[1]);
    }
    for (const m of active.matchAll(/create trigger ([a-z_]+)/g)) {
        assert.match(active, new RegExp(`drop trigger if exists ${m[1]} on`), m[1]);
    }
    assert.equal((active.match(/insert into storage\.buckets/g) || []).length, 2);
    assert.equal((active.match(/on conflict \(id\) do update set/g) || []).length, 2);
});

test('Store schema: RLS en las tablas de la Store, sin grants a anon y DML mínimo para authenticated', () => {
    const sql = readStoreMigration();
    const statements = stripComments(sql).split(';').map((s) => s.trim());
    for (const table of STORE_TABLES) {
        assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`), table);
        assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated;`), table);
    }
    const tableGrants = statements.filter((s) => /^grant\b/i.test(s) && /\bon table\b/i.test(s));
    assert.ok(tableGrants.length > 0);
    for (const g of tableGrants) {
        assert.doesNotMatch(g, /\bto\b[^;]*\banon\b/i, `sin grants de tablas a anon: ${g}`);
        assert.doesNotMatch(g, /\b(truncate|trigger|references|all)\b/i, `sin truncate/trigger/references/all: ${g}`);
    }
    // Pedidos, ítems, pagos, licencias, descargas y wallet: authenticated solo lee.
    for (const table of ['store_orders', 'store_order_items', 'store_payments', 'store_licenses', 'store_download_events',
        'store_order_support_notes', 'artist_wallet_movements']) {
        const writes = statements.filter((s) => /^grant\b/i.test(s)
            && new RegExp(`\\bon table public\\.${table}\\b`, 'i').test(s)
            && /\bto\s+[^;]*\bauthenticated\b/i.test(s)
            && /\b(insert|update|delete)\b/i.test(s.split(/\bon table\b/i)[0]));
        assert.deepEqual(writes, [], `sin insert/update/delete de authenticated sobre ${table}`);
    }
    assert.doesNotMatch(sql, /grant[^;]*artist_wallet_movements[^;]*to[^;]*authenticated/i);

    const expected = {
        store_products: 'select, insert, update, delete',
        store_product_variants: 'select, insert, update, delete',
        store_design_assets: 'select, insert, delete',
        store_seller_settings: 'select, insert, update',
        store_orders: 'select',
        store_order_items: 'select',
        store_licenses: 'select',
        store_download_events: 'select',
        store_order_support_notes: 'select',
    };
    for (const [table, privs] of Object.entries(expected)) {
        assert.match(sql, new RegExp(`grant ${privs} on table public\\.${table} to authenticated;`), table);
    }
    // store_payments: grant de columnas, sin note, provider_payload ni confirmed_by.
    const pay = sql.match(/grant select \(([^)]*)\)\s+on table public\.store_payments to authenticated;/);
    assert.ok(pay, 'grant de columnas en store_payments');
    assert.deepEqual(pay[1].split(',').map((c) => c.trim()),
        ['id', 'order_id', 'provider', 'status', 'amount', 'currency', 'collected_by', 'reference', 'created_at']);
    assert.doesNotMatch(sql, /grant select on table public\.store_payments to authenticated/);
});

test('Store schema: policies con los nombres del contrato y (select auth.uid())', () => {
    const sql = readStoreMigration();
    const policies = [
        'store_products_owner_select', 'store_products_owner_insert', 'store_products_owner_update',
        'store_products_owner_delete', 'store_products_support_all',
        'store_product_variants_owner_select', 'store_product_variants_owner_insert',
        'store_product_variants_owner_update', 'store_product_variants_owner_delete', 'store_product_variants_support_all',
        'store_design_assets_owner_select', 'store_design_assets_owner_insert', 'store_design_assets_owner_delete',
        'store_design_assets_licensee_read', 'store_design_assets_support_all',
        'store_seller_settings_owner_select', 'store_seller_settings_owner_insert', 'store_seller_settings_owner_update',
        'store_seller_settings_support_all',
        'store_orders_buyer_read', 'store_orders_seller_read', 'store_orders_support_read',
        'store_order_items_buyer_read', 'store_order_items_seller_read', 'store_order_items_support_read',
        'store_payments_buyer_read', 'store_payments_seller_read', 'store_payments_support_read',
        'store_licenses_holder_read', 'store_licenses_buyer_read', 'store_licenses_seller_read', 'store_licenses_support_read',
        'store_download_events_seller_read', 'store_download_events_support_read',
        'store_order_support_notes_support_read',
    ];
    for (const p of policies) assert.match(sql, new RegExp(`create policy ${p} on public\\.`), p);
    // Sin update en assets; pedidos, ítems, pagos, licencias y descargas solo select.
    assert.doesNotMatch(sql, /create policy store_design_assets_owner_update/);
    for (const m of sql.matchAll(/create policy (store_(?:orders|order_items|payments|licenses|download_events|order_support_notes)_[a-z_]+) on public\.[a-z_]+\s+for (\w+)/g)) {
        assert.equal(m[2], 'select', m[1]);
    }
    assert.match(sql, /store_design_assets_licensee_read[\s\S]*?l\.revoked_at is null[\s\S]*?l\.holder_user_id = \(select auth\.uid\(\)\)/);
    assert.match(sql, /store_orders_buyer_read[\s\S]*?using \(buyer_user_id = \(select auth\.uid\(\)\)\)/);
    assert.match(sql, /store_products_support_all[\s\S]*?using \(public\.is_support_user\(\)\)/);
    assert.doesNotMatch(sql, /using \([^;]*\bauth\.uid\(\) =/, 'las policies usan (select auth.uid())');
    // Notas internas: solo soporte, sin policy para comprador ni vendedor.
    const notePolicies = [...sql.matchAll(/create policy ([a-z_]+) on public\.store_order_support_notes\s+for (\w+) to (\w+)\s+using \(([^;]*)\);/g)];
    assert.deepEqual(notePolicies.map((m) => [m[1], m[2], m[3], m[4]]),
        [['store_order_support_notes_support_read', 'select', 'authenticated', 'public.is_support_user()']]);
});

test('Store schema: cada función revoca a public, anon y authenticated y lleva el grant del contrato', () => {
    const sql = readStoreMigration();
    const fns = parseFunctions(sql);
    const names = fns.map((f) => f.name);
    assert.equal(new Set(names).size, names.length, 'sin funciones duplicadas');
    assert.deepEqual([...names].sort(), [...Object.keys(GRANTS), ...INTERNAL].sort(), 'toda función nueva se clasifica en el test');

    for (const fn of fns) {
        const revoke = revokeSignature(sql, fn.name);
        assert.ok(revoke, `revoke all on function public.${fn.name}(`);
        // Las internas también se le revocan a service_role (default ACL de Supabase).
        const expectedFrom = INTERNAL.includes(fn.name) ? 'public, anon, authenticated, service_role' : 'public, anon, authenticated';
        assert.equal(revoke.from, expectedFrom, fn.name);
        const grants = [...sql.matchAll(new RegExp(`grant execute on function public\\.${fn.name}\\(([^)]*)\\) to ([^;]+);`, 'g'))];
        if (GRANTS[fn.name]) {
            assert.equal(grants.length, 1, `un único grant para ${fn.name}`);
            assert.equal(grants[0][1].trim(), revoke.sig, `firma del grant de ${fn.name}`);
            assert.equal(grants[0][2].trim(), GRANTS[fn.name], fn.name);
        } else {
            assert.equal(grants.length, 0, `${fn.name} es interna: sin grants`);
        }
    }
    for (const [name, params] of Object.entries(RPC_PARAMS)) {
        const fn = fns.find((f) => f.name === name);
        assert.ok(fn, name);
        assert.deepEqual(fn.params, params, `parámetros de ${name}`);
    }
    assert.equal(revokeSignature(sql, 'create_store_order').sig, 'uuid, uuid, integer, text, text, text, jsonb, text, text, text');
    assert.equal(revokeSignature(sql, 'confirm_store_order_payment_as_provider').sig, 'uuid, text, text, numeric, text');
    assert.equal(revokeSignature(sql, 'get_store_sales_report').sig, 'text, uuid, date, date');
    assert.match(sql, /returns table \(\s*product_id uuid,\s*title text,\s*kind text,\s*month date,\s*currency text,\s*units bigint,\s*gross_amount numeric,\s*orders bigint\s*\)/);
    for (const name of ['create_store_order', 'report_store_payment', 'confirm_store_order_received', 'cancel_store_order',
        'confirm_store_order_payment', 'update_store_order_fulfillment', 'refund_store_order', 'set_store_order_funds_hold',
        'confirm_store_order_payment_as_provider', 'store_apply_order_payment', 'resolve_store_order_flag']) {
        assert.match(fns.find((f) => f.name === name).header, /^returns public\.store_orders\b/, name);
    }
});

test('Store schema: definer con search_path vacío, guards invoker y chequeo de servicio', () => {
    const sql = readStoreMigration();
    const fns = parseFunctions(sql);
    for (const fn of fns) {
        assert.match(fn.header, /set search_path = ''/, `${fn.name} con search_path vacío`);
        if (/security definer/.test(fn.header)) {
            assert.match(fn.header, /security definer\s+set search_path = ''/, `${fn.name}: definer sin search_path vacío`);
        }
        // Nombres calificados: nada de tablas sin esquema en FROM/JOIN/UPDATE/INSERT.
        const body = stripComments(fn.body).replace(/\$q\$[\s\S]*?\$q\$/g, '');
        assert.doesNotMatch(body, /(?<!for\s)(?<!distinct\s)\b(?:from|join|update|insert into)\s+(?!public\.|auth\.|storage\.|pg_catalog\.|unnest\(|jsonb_array_elements\(|regexp_split_to_table\(|\()[a-z_]+\b/i, `${fn.name}: nombres calificados`);
    }
    for (const name of GUARDS) {
        const fn = fns.find((f) => f.name === name);
        assert.match(fn.header, /returns trigger\s+language plpgsql\s+security invoker/, name);
        assert.match(fn.body, /current_user in \('postgres', 'supabase_admin', 'service_role'\)\s+or coalesce\(\(select auth\.role\(\)\), ''\) = 'service_role'/, name);
    }
    for (const name of SERVICE) {
        const fn = fns.find((f) => f.name === name);
        assert.match(fn.header, /security definer/, name);
        const first = fn.body.replace(/^[\s\S]*?\bbegin\b/, '').trim();
        assert.match(first, /^if coalesce\(\(select auth\.role\(\)\), ''\) <> 'service_role' and session_user not in \('postgres', 'supabase_admin'\) then\s+raise exception using errcode = '42501', message = 'store:forbidden';\s+end if;/, name);
    }
    // Las de usuario exigen sesión.
    for (const [name, grant] of Object.entries(GRANTS)) {
        if (grant !== 'authenticated' || name.startsWith('store_can_manage')) continue;
        assert.match(fns.find((f) => f.name === name).body, /store:not_authenticated/, name);
    }
    for (const name of ['store_can_manage_seller', 'store_can_manage_storage_folder', 'store_seller_ready_artist', 'store_current_terms_version']) {
        assert.match(fns.find((f) => f.name === name).header, /stable\s+security definer/, name);
    }
    assert.match(sql, /s\.id::text = p_folder/, 'la carpeta se compara como texto');
    assert.doesNotMatch(sql, /p_folder::uuid|foldername\(name\)\)\[1\]::uuid/);
    assert.match(sql, /select '2026-10'::text;/);
    // Ids y códigos desde gen_random_uuid(): sin random() ni pgcrypto.
    assert.doesNotMatch(stripComments(sql), /\brandom\(\)|gen_random_bytes|pgcrypto|\bcrypt\(/i);
    assert.match(sql, /'ST-' \|\| upper\(substr\(replace\(gen_random_uuid\(\)::text, '-', ''\), 1, 8\)\)/);
    assert.match(sql, /'WOL-' \|\| substr\(v_hex, 1, 4\) \|\| '-' \|\| substr\(v_hex, 5, 4\)/);
});

test('Store schema: errores store:<código> del contrato con errcode P0001', () => {
    const sql = readStoreMigration();
    const used = new Set([...sql.matchAll(/'store:([a-z_]+)'/g)].map((m) => m[1]));
    for (const code of used) assert.ok(ERROR_CODES.includes(code), `código fuera del contrato: ${code}`);
    for (const code of ERROR_CODES) {
        if (SERVER_ONLY_CODES.includes(code)) continue;
        assert.ok(used.has(code), `código sin usar: ${code}`);
    }
    for (const m of sql.matchAll(/raise exception using ([^;]*);/g)) {
        assert.match(m[1], /^errcode = '(P0001|42501)', message = 'store:[a-z_]+'$/, m[0]);
    }
    assert.doesNotMatch(stripComments(sql), /raise exception '/, 'sin mensajes libres');
});

test('Store schema: wallet siempre dinámico, condicionado a to_regclass y sin %rowtype', () => {
    const sql = readStoreMigration();
    const fns = parseFunctions(sql);
    assert.doesNotMatch(sql, /%rowtype/i);
    assert.doesNotMatch(sql, /\b\w+\s+public\.artist_(wallet_movements|payout_destinations)\s*;/, 'sin variables de tablas del wallet');
    let walletFns = 0;
    for (const fn of fns) {
        const stripped = fn.body
            .replace(/\$q\$[\s\S]*?\$q\$/g, '')
            .replace(/to_regclass\('public\.artist_wallet_movements'\)/g, '');
        assert.doesNotMatch(stripped, /artist_wallet_movements/, `${fn.name}: wallet solo con execute format(...)`);
        const dynamic = [...fn.body.matchAll(/execute format\(\$q\$([\s\S]*?)\$q\$\)/g)];
        if (dynamic.some((d) => /artist_wallet_movements/.test(d[1]))) {
            walletFns += 1;
            assert.match(fn.body, /if to_regclass\('public\.artist_wallet_movements'\) is not null then[\s\S]*execute format\(\$q\$/, fn.name);
            assert.match(fn.body, /\busing\b/, fn.name);
        }
    }
    assert.ok(walletFns >= 5, 'payment, release/fee, entrega, reembolso y retención');
    assert.match(sql, /on conflict \(artist_user_id, external_reference\) do nothing/);
    for (const suffix of [':payment', "':' \\|\\| p_suffix"]) assert.match(sql, new RegExp(suffix));
    for (const [kind, suffix] of [['release', 'release'], ['fee', 'fee'], ['refund', 'refund'], ['adjustment', 'fee_reversal']]) {
        assert.match(sql, new RegExp(`store_wallet_insert\\(\\s*v_order, '${kind}', [^;]*'${suffix}'`), kind);
    }
    assert.match(sql, /jsonb_build_object\('source', 'store', 'order_id', p_order\.id, 'order_number', p_order\.order_number\)/);
    // Predicado único del wallet.
    assert.match(sql, /p_order\.seller_type = 'artist'\s+and p_order\.payment_collected_by in \('platform', 'provider'\)/);
    const release = fns.find((f) => f.name === 'release_store_order_funds').body;
    assert.match(release, /status in \('awaiting_release', 'pending_service'\)[\s\S]*get diagnostics v_rows = row_count/);
    assert.match(release, /perform public\.store_wallet_upsert_payment\(v_order\)/, 'reconstruye el payment si falta');
    assert.match(release, /set funds_released_at = now\(\)/);
    // La entrega fija release_at también si el payment está retenido (blocked por
    // funds_hold): al levantar la retención no queda awaiting_release sin fecha.
    const delivery = fns.find((f) => f.name === 'store_finish_delivery').body;
    assert.match(delivery, /release_at = \$3\s+where artist_user_id = \$1 and external_reference = \$2 and status in \('pending_service', 'blocked'\)/);
    assert.match(delivery, /status = case when status = 'pending_service' then 'awaiting_release' else status end/);
});

test('Store schema: locks producto → pedido, re-chequeo de estado y mantenimiento con skip locked', () => {
    const sql = readStoreMigration();
    const fns = parseFunctions(sql);
    const body = (name) => fns.find((f) => f.name === name).body;
    const lock = body('store_lock_order');
    assert.ok(lock.indexOf('from public.store_order_items') < lock.indexOf('from public.store_products p where p.id = v_product_id for update'));
    assert.ok(lock.indexOf('store_products p where p.id = v_product_id for update') < lock.indexOf('store_orders o where o.id = p_order_id for update'));
    for (const name of ['report_store_payment', 'confirm_store_order_received', 'cancel_store_order', 'update_store_order_fulfillment',
        'refund_store_order', 'set_store_order_funds_hold', 'resolve_store_order_flag', 'store_apply_order_payment',
        'release_store_order_funds']) {
        assert.match(body(name), /public\.store_lock_order\(p_order_id\)/, name);
    }
    assert.match(body('create_store_order'), /from public\.store_products p where p\.id = p_product_id for update/);
    assert.match(body('adjust_store_variant_stock'), /store_products p where p\.id = v_product_id for update[\s\S]*store_product_variants v where v\.id = p_variant_id for update/);
    // Liberación de reservas condicionada al pedido.
    assert.match(body('store_close_unpaid_order'), /p\.reserved_order_id = p_order_id/);
    assert.match(body('store_close_unpaid_order'), /where id = p_order_id\s+and status = 'pending_payment';\s+if not found then/);
    assert.match(body('store_close_unpaid_order'), /set stock = v\.stock \+ s\.qty/);

    const maint = body('run_store_maintenance');
    assert.match(body('store_try_lock_order'), /for update skip locked[\s\S]*for update skip locked/);
    assert.equal((maint.match(/public\.store_try_lock_order\(v_id\)/g) || []).length, 4);
    assert.equal((maint.match(/exception when others then/g) || []).length >= 4, true);
    // El error crudo va a las notas de soporte; en metadata_json, solo la fecha.
    assert.equal((maint.match(/insert into public\.store_order_support_notes \(order_id, kind, note\)\s+values \(v_id, 'maintenance_error', v_error\);/g) || []).length, 4);
    assert.doesNotMatch(maint, /jsonb_build_object\('maintenance_error', v_error/);
    assert.match(maint, /jsonb_build_object\('maintenance_error_at', now\(\)\)/);
    assert.match(maint, /'expired', v_expired,\s*'flagged', v_flagged,\s*'delivered', v_delivered,\s*'released', v_released,\s*'failed', v_failed/);
    assert.match(maint, /shipped_at < now\(\) - interval '14 days'/);
    assert.match(maint, /ready_at < now\(\) - interval '7 days'/);
    assert.match(maint, /coalesce\(o\.metadata_json ->> 'needs_support', ''\) <> 'true'/);

    // Creación: idempotencia primero, comprador, producto, límites, 24 h de vencimiento.
    const create = body('create_store_order');
    const order = ['idempotency_key = v_key', 'email_confirmed_at is null', "store:terms_version_mismatch", 'for update;',
        'store:own_product', 'store:seller_not_ready', 'store:pending_order_exists', 'store:too_many_pending', 'store:exclusive_cooldown',
        'store:tier_unavailable', 'store:artist_tier_requires_artist', 'store:product_reserved', 'store:exclusive_unavailable',
        'store:variant_required', 'store:out_of_stock', 'store:pickup_unavailable', 'store:ships_to_unsupported'];
    let last = -1;
    for (const marker of order) {
        const at = create.indexOf(marker, last + 1);
        assert.ok(at > last, `orden de validación: ${marker}`);
        last = at;
    }
    assert.match(create, /v_expires timestamptz := now\(\) \+ interval '24 hours'/);
    assert.match(create, /set stock = stock - v_qty\s+where id = v_variant\.id and stock >= v_qty/);
    assert.match(body('report_store_payment'), /greatest\(expires_at, now\(\) \+ interval '7 days'\)/);
});

test('Store schema: dinero en numeric(12,2) redondeado y checks de forma del pedido', () => {
    const sql = readStoreMigration();
    assert.doesNotMatch(stripComments(sql), /\bnumeric\(14,2\)|\breal\b|double precision|\bmoney\b/);
    for (const col of ['price_amount', 'license_personal_price', 'license_artist_price', 'license_exclusive_price', 'shipping_price_amount']) {
        assert.match(sql, new RegExp(`${col} numeric\\(12,2\\)`), col);
        assert.match(sql, new RegExp(`${col} = round\\(${col}, 2\\)`), col);
    }
    for (const c of ['store_orders_shipping_address_check', 'store_orders_unpaid_shape_check', 'store_orders_fulfilled_check',
        'store_orders_digital_check', 'store_orders_method_status_check', 'store_orders_funds_check',
        'store_orders_pos_collector_check', 'store_orders_guest_check', 'store_order_items_design_check',
        'store_order_items_merch_check', 'store_products_design_shape_check', 'store_products_merch_shape_check']) {
        assert.match(sql, new RegExp(`constraint ${c}\\s+check`), c);
    }
    assert.match(sql, /buyer_role <> 'guest' or \(buyer_user_id is null and channel = 'pos'\)/);
    assert.match(sql, /on public\.store_orders \(buyer_user_id, idempotency_key\)\s+where channel = 'online'/);
    assert.match(sql, /on public\.store_orders \(seller_type, seller_id, idempotency_key\)\s+where channel = 'pos'/);
    assert.match(sql, /on public\.store_payments \(provider, reference\)\s+where reference is not null and provider <> 'manual'/);
    assert.match(sql, /variant_id uuid references public\.store_product_variants \(id\) on delete restrict/);
    assert.match(sql, /buyer_user_id uuid references auth\.users \(id\) on delete set null/);
    assert.match(sql, /when btrim\(s\.setting_value\) ~ '\^\\d\+\(\\\.\\d\+\)\?\$'\s+then least\(greatest\(btrim\(s\.setting_value\)::numeric, 0\), 50\)/);
    assert.match(sql, /v_fee := round\(v_total \* v_fee_pct \/ 100, 2\)/);
});

test('Store schema: buckets, MIME y policies de Storage (sin SVG, sin update en archivos de diseño)', () => {
    const sql = readStoreMigration();
    const buckets = readStoreBucketContract(sql);
    assert.deepEqual(Object.keys(buckets).sort(), ['store-design-files', 'store-previews']);
    assert.deepEqual(buckets['store-previews'], { public: true, fileSizeLimit: 3145728, mime: ['image/jpeg', 'image/webp', 'image/png'] });
    assert.equal(buckets['store-design-files'].public, false);
    assert.equal(buckets['store-design-files'].fileSizeLimit, 52428800);
    assert.deepEqual([...buckets['store-design-files'].mime].sort(), [
        'application/pdf', 'application/postscript', 'application/zip', 'image/jpeg',
        'image/png', 'image/tiff', 'image/vnd.adobe.photoshop', 'image/webp',
    ]);
    assert.doesNotMatch(sql, /svg/i, 'sin SVG en ningún bucket');
    assert.deepEqual(readStencilMime(sql).sort(), ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

    const storagePolicies = [...sql.matchAll(/create policy "([^"]+)" on storage\.objects\s+for (\w+) to (\w+)\s+(using|with check) \(([\s\S]*?)\);\n/g)]
        .map((m) => ({ name: m[1], cmd: m[2], role: m[3], expr: m[5] }));
    assert.deepEqual(storagePolicies.map((p) => `${p.name}:${p.cmd}`).sort(), [
        'store_design_files_owner_delete:delete', 'store_design_files_owner_insert:insert', 'store_design_files_owner_select:select',
        'store_previews_owner_delete:delete', 'store_previews_owner_insert:insert', 'store_previews_owner_select:select',
    ]);
    for (const p of storagePolicies) {
        assert.equal(p.role, 'authenticated', p.name);
        assert.notEqual(p.cmd, 'update', p.name);
        assert.notEqual(p.cmd, 'all', p.name);
        assert.match(p.expr, /store_can_manage_storage_folder\(\(storage\.foldername\(name\)\)\[1\]\)/, p.name);
    }
    assert.doesNotMatch(sql, /on storage\.objects\s+for (update|all)[\s\S]{0,200}store-(design-files|previews)/);
    const del = storagePolicies.find((p) => p.name === 'store_design_files_owner_delete');
    assert.match(del.expr, /not exists[\s\S]*store_design_assets a[\s\S]*store_licenses l[\s\S]*a\.storage_path = objects\.name/);
    // Los compradores no tienen policy sobre los archivos: descargan con URL firmada.
    assert.doesNotMatch(storagePolicies.find((p) => p.name === 'store_design_files_owner_select').expr, /store_licenses|holder_user_id/);
    // Guards: imágenes y assets validados contra storage.objects y metadatos del objeto.
    assert.match(sql, /'\/\[0-9\]\+-\[0-9\]\+\\\.\(jpe\?g\|webp\|png\)\$'/);
    assert.match(sql, /o\.bucket_id = 'store-previews' and o\.name = v_path/);
    assert.match(sql, /o\.bucket_id = 'store-design-files' and o\.name = new\.storage_path/);
    assert.match(sql, /new\.mime_type := nullif\(v_meta ->> 'mimetype', ''\)/);
    assert.match(sql, /\(v_meta ->> 'size'\)::bigint/);
});

test('Store schema: el rollback dropea policies, buckets vacíos, cada función con su firma, triggers y las tablas', () => {
    const sql = readStoreMigration();
    const down = read(ROLLBACK);
    const active = stripComments(down).trim();
    assert.match(active, /^begin\s*;/i);
    assert.match(active, /notify pgrst, 'reload schema';\s*commit\s*;\s*$/i);
    for (const table of STORE_TABLES) {
        assert.match(down, new RegExp(`drop table if exists public\\.${table};`), table);
    }
    for (const fn of parseFunctions(sql)) {
        const { sig } = revokeSignature(sql, fn.name);
        assert.match(down, new RegExp(`drop function if exists public\\.${fn.name}\\(${escape(sig)}\\);`), fn.name);
    }
    for (const m of sql.matchAll(/create policy ("[^"]+") on storage\.objects/g)) {
        assert.match(down, new RegExp(`drop policy if exists ${escape(m[1])} on storage\\.objects;`), m[1]);
    }
    for (const bucket of ['store-previews', 'store-design-files']) {
        assert.match(down, new RegExp(`delete from storage\\.buckets\\s+where id = '${bucket}'\\s+and not exists \\(select 1 from storage\\.objects o where o\\.bucket_id = '${bucket}'\\)`), bucket);
    }
    for (const m of sql.matchAll(/create trigger ([a-z_]+)/g)) {
        assert.match(down, new RegExp(`drop trigger if exists ${m[1]} on`), m[1]);
    }
    // Orden inverso: Storage → funciones → triggers → tablas → helpers de policies.
    const at = (s) => down.indexOf(s);
    assert.ok(at('drop policy if exists "store_previews_owner_select"') < at('delete from storage.buckets'));
    assert.ok(at('delete from storage.buckets') < at('drop function if exists public.create_store_order('));
    assert.ok(at('drop function if exists public.store_order_uses_wallet(') < at('drop trigger if exists trg_store_products_guard'));
    assert.ok(at('drop trigger if exists trg_store_products_guard') < at('drop table if exists public.store_download_events;'));
    assert.ok(at('drop table if exists public.store_download_events;') < at('drop table if exists public.store_orders;'));
    assert.ok(at('drop table if exists public.store_products;') < at('drop function if exists public.store_can_manage_seller('));
    assert.doesNotMatch(active, /artist_wallet_movements|drop table if exists public\.(artists_db|studios|app_settings)/);
});

test('Store schema: MIME y límites de la migración iguales a WeotziStoreModel.FILES', (t) => {
    const modelPath = path.join(root, MODEL);
    if (!fs.existsSync(modelPath)) {
        t.skip('public/shared/js/store-model.js todavía no existe');
        return;
    }
    const M = require(modelPath);
    const F = M && M.FILES;
    if (!F || !Array.isArray(F.PREVIEW_MIME) || !Array.isArray(F.ORIGINAL_MIME)) {
        t.skip('store-model.js todavía no expone FILES');
        return;
    }
    const buckets = readStoreBucketContract();
    assert.equal(F.PREVIEW_MAX_BYTES, buckets['store-previews'].fileSizeLimit);
    assert.equal(F.ORIGINAL_MAX_BYTES, buckets['store-design-files'].fileSizeLimit);
    assert.deepEqual([...F.PREVIEW_MIME].sort(), [...buckets['store-previews'].mime].sort());
    assert.deepEqual([...F.ORIGINAL_MIME].sort(), [...buckets['store-design-files'].mime].sort());
    if (Array.isArray(F.STENCIL_MIME)) {
        assert.deepEqual([...F.STENCIL_MIME].sort(), readStencilMime().sort());
    }
});

test('Store schema: un pago informado falso no retiene la exclusiva ni el stock para siempre', () => {
    const sql = readStoreMigration();
    const fns = parseFunctions(sql);
    const body = (name) => fns.find((f) => f.name === name).body;
    // Vencible: sin aviso al pasar expires_at; con aviso, 7 días después.
    const lapsed = fns.find((f) => f.name === 'store_order_lapsed');
    assert.match(lapsed.header, /^returns boolean\s+language sql\s+stable\s+set search_path = ''/);
    assert.match(lapsed.body, /p_order\.status = 'pending_payment'\s+and p_order\.expires_at < now\(\)\s+and \(p_order\.buyer_payment_reported_at is null or p_order\.expires_at < now\(\) - interval '7 days'\)/);
    // El mantenimiento (a) y la toma de reserva de create_store_order usan el mismo predicado.
    const maint = body('run_store_maintenance');
    assert.match(maint, /and o\.expires_at < now\(\)\s+and public\.store_order_lapsed\(o\)/);
    assert.match(maint, /if public\.store_order_lapsed\(v_order\) then\s+if public\.store_close_unpaid_order\(v_id, 'expired', null\)/);
    assert.match(body('create_store_order'), /elsif public\.store_order_lapsed\(v_old\) then\s+perform public\.store_close_unpaid_order\(v_old\.id, 'expired', null\)/);
    // Al vencer un pedido con aviso, queda marcado para soporte.
    assert.match(body('store_close_unpaid_order'), /when p_status = 'expired' and buyer_payment_reported_at is not null[\s\S]*'needs_support_reason', 'payment_reported_expired'/);
    // Cancelación: soporte siempre; el vendedor que cobra directo, con el plazo del aviso vencido.
    assert.match(body('cancel_store_order'), /if v_order\.buyer_payment_reported_at is not null and not v_support\s+and not \(v_seller and v_order\.expected_collector = 'seller' and v_order\.expires_at < now\(\)\) then\s+raise exception using errcode = 'P0001', message = 'store:payment_reported';/);
});

test('Store schema: needs_support se resuelve al confirmar, cancelar, reembolsar (soporte) o con resolve_store_order_flag', () => {
    const sql = readStoreMigration();
    const fns = parseFunctions(sql);
    const body = (name) => fns.find((f) => f.name === name).body;
    const clear = /\(metadata_json - 'needs_support'\) \|\| jsonb_build_object\('needs_support_resolved_at', now\(\)\)/;
    const apply = body('store_apply_order_payment');
    // Las dos ramas de éxito (digital → fulfilled, merch → paid) limpian la marca.
    assert.equal((apply.match(/when metadata_json \? 'needs_support'\s+then \(metadata_json - 'needs_support'\) \|\| jsonb_build_object\('needs_support_resolved_at', now\(\)\)/g) || []).length, 2);
    assert.match(body('cancel_store_order'), clear);
    // Reembolso: limpia solo soporte (si reembolsa el vendedor, el duplicado sigue a la vista).
    assert.match(body('refund_store_order'), /when v_support and metadata_json \? 'needs_support'\s+then \(metadata_json - 'needs_support'\)/);
    const resolve = body('resolve_store_order_flag');
    assert.match(resolve, /if not coalesce\(public\.is_support_user\(\), false\) then\s+raise exception using errcode = 'P0001', message = 'store:forbidden';/);
    assert.match(resolve, clear);
    assert.match(resolve, /'flag_resolved'/);
    // El duplicado sigue marcando para soporte.
    assert.match(apply, /'needs_support', true, 'needs_support_reason', 'duplicate_payment'/);
});

test('Store schema: las notas internas de soporte no van a metadata_json (lo leen comprador y vendedor)', () => {
    const sql = readStoreMigration();
    const fns = parseFunctions(sql);
    const body = (name) => fns.find((f) => f.name === name).body;
    assert.match(sql, /create table if not exists public\.store_order_support_notes \(/);
    assert.match(sql, /check \(kind in \('funds_hold', 'funds_release', 'refund', 'reopen', 'flag_resolved', 'maintenance_error'\)\)/);
    for (const key of ['funds_hold_note', 'funds_hold_by', 'refunded_by', 'reopened_by']) {
        assert.doesNotMatch(stripComments(sql), new RegExp(`'${key}'`), `${key} fuera de metadata_json`);
    }
    const writers = [
        ['set_store_order_funds_hold', "case when v_order\\.funds_hold then 'funds_hold' else 'funds_release' end"],
        ['refund_store_order', "'refund'"],
        ['store_apply_order_payment', "'reopen'"],
        ['resolve_store_order_flag', "'flag_resolved'"],
    ];
    for (const [name, kind] of writers) {
        assert.match(body(name), new RegExp(`insert into public\\.store_order_support_notes \\(order_id, kind, note, actor_id\\)\\s+values \\(v_order\\.id, ${kind}`), name);
    }
    assert.match(body('set_store_order_funds_hold'), /metadata_json = metadata_json \|\| jsonb_build_object\('funds_hold_at', now\(\)\)/);
    const down = read(ROLLBACK);
    assert.ok(down.indexOf('drop table if exists public.store_order_support_notes;') > -1);
    assert.ok(down.indexOf('drop table if exists public.store_order_support_notes;') < down.indexOf('drop table if exists public.store_orders;'));
});

test('Store schema: el nombre de descarga del archivo licenciado se sanea y termina en la extensión del MIME real', () => {
    const sql = readStoreMigration();
    const guard = parseFunctions(sql).find((f) => f.name === 'store_design_assets_guard').body;
    const map = {};
    for (const m of guard.matchAll(/when '([a-z/.+-]+)' then array\[([^\]]+)\]/g)) {
        map[m[1]] = [...m[2].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
    }
    // Cubre cada MIME del bucket de archivos de diseño.
    assert.deepEqual(Object.keys(map).sort(), [...readStoreBucketContract(sql)['store-design-files'].mime].sort());
    // Mismo mapeo que WeotziStoreModel.FILES.EXTENSION_MIME (si existe).
    const modelPath = path.join(root, MODEL);
    if (fs.existsSync(modelPath)) {
        const F = require(modelPath).FILES;
        if (F && F.EXTENSION_MIME) {
            for (const [mime, exts] of Object.entries(map)) {
                const fromModel = Object.keys(F.EXTENSION_MIME).filter((e) => F.EXTENSION_MIME[e] === mime).sort();
                assert.deepEqual([...exts].sort(), fromModel, mime);
            }
        }
    }
    assert.match(guard, /if v_exts is null then\s+raise exception using errcode = 'P0001', message = 'store:invalid_image_path';/);
    assert.ok(guard.includes(`regexp_replace(coalesce(new.file_name, ''), '[[:cntrl:]/\\\\"`), 'saca barras, comillas y caracteres de control');
    // Controles bidi como escapes del regex, nunca literales invisibles en el fuente.
    assert.ok(guard.includes(String.raw`\x200E\x200F\x202A-\x202E\x2066-\x2069]+', '-', 'g')`), 'controles bidi escapados');
    assert.doesNotMatch(sql, /[\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/u, 'sin controles bidi literales en la migración');
    assert.match(guard, /if v_ext = any \(v_exts\) then[\s\S]*else\s+v_name := left\(v_name, 199 - char_length\(v_exts\[1\]\)\) \|\| '\.' \|\| v_exts\[1\];/);
    assert.match(guard, /new\.file_name := v_name;/);
    // Se normaliza después de tomar el MIME del objeto en Storage.
    assert.ok(guard.indexOf("new.mime_type := nullif(v_meta ->> 'mimetype', '')") < guard.indexOf('v_exts := case new.mime_type'));
});

test('Store schema: la ficha pública refleja lo que acepta create_store_order (reserva y retiro)', () => {
    const fns = parseFunctions(readStoreMigration());
    const pub = fns.find((f) => f.name === 'store_public_product_json').body;
    assert.match(pub, /'reserved', p_product\.reserved_order_id is not null,/);
    assert.doesNotMatch(pub, /reserved_until > now\(\)/);
    assert.match(pub, /'pickup_available', p_product\.pickup_available and exists \([\s\S]*?nullif\(btrim\(coalesce\(s\.pickup_address, ''\)\), ''\) is not null\s+\)/);
    // Retiro sin dirección → pickup_unavailable.
    assert.match(fns.find((f) => f.name === 'create_store_order').body,
        /if not v_product\.pickup_available\s+or nullif\(btrim\(coalesce\(v_settings\.pickup_address, ''\)\), ''\) is null then\s+raise exception using errcode = 'P0001', message = 'store:pickup_unavailable';/);
});

test('Store schema: un webhook tardío del proveedor reabre el pedido vencido (cobro real)', () => {
    const apply = parseFunctions(readStoreMigration()).find((f) => f.name === 'store_apply_order_payment').body;
    assert.match(apply, /elsif v_order\.status = 'expired' then[\s\S]*?if not \(coalesce\(p_is_support, false\) or p_collected_by = 'provider'\) then\s+raise exception using errcode = 'P0001', message = 'store:order_not_payable';/);
});

test('Store schema: app_settings de la Store privados y migración con lock_timeout corto', () => {
    const sql = readStoreMigration();
    const active = stripComments(sql).trim();
    assert.match(active, /^begin\s*;\s*set local lock_timeout = '5s';/i);
    const seed = active.match(/insert into public\.app_settings \(setting_key, setting_value, setting_type, description, is_public\) values([\s\S]*?)on conflict \(setting_key\) do update set is_public = false;/);
    assert.ok(seed, 'siembra con on conflict que solo vuelve privadas las claves');
    const rows = [...seed[1].matchAll(/\('(store_[a-z_]+)', (null|'[^']*'), 'text',\s*'[^']*', (true|false)\)/g)]
        .map((m) => [m[1], m[2], m[3]]);
    assert.deepEqual(rows, [
        ['store_payment_provider', "'manual'", 'false'],
        ['store_manual_collector', "'seller'", 'false'],
        ['store_platform_payment_instructions', 'null', 'false'],
        ['store_platform_fee_pct', "'0'", 'false'],
    ]);
    // Las claves que lee la migración son exactamente las sembradas.
    const keys = new Set([...sql.matchAll(/store_app_setting\('(store_[a-z_]+)'\)/g)].map((m) => m[1]));
    keys.add('store_platform_fee_pct');
    assert.deepEqual([...keys].sort(), rows.map((r) => r[0]).sort());
    // El rollback no toca app_settings (soporte pudo configurarlas).
    assert.doesNotMatch(stripComments(read(ROLLBACK)), /app_settings/);
});

test('Store schema: la licencia guarda las medidas del diseño para imprimir a escala aunque el producto ya no esté activo', () => {
    const apply = parseFunctions(readStoreMigration()).find((f) => f.name === 'store_apply_order_payment').body;
    const insert = apply.match(/insert into public\.store_licenses \(([\s\S]*?)\) values \(([\s\S]*?)\n\s*\);/);
    assert.ok(insert, 'insert de la licencia en store_apply_order_payment');
    const cols = insert[1].split(',').map((c) => c.trim());
    assert.equal(cols[cols.length - 1], 'metadata_json', 'metadata_json es la última columna del insert');
    // Solo las medidas que no son null (jsonb_strip_nulls), tomadas del producto al emitir.
    assert.match(insert[2], /jsonb_strip_nulls\(jsonb_build_object\(\s*'design_width_cm', v_product\.design_width_cm,\s*'design_height_cm', v_product\.design_height_cm\s*\)\)\s*$/);
});
