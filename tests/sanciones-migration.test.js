'use strict';
// Migración de sanciones de cuenta (20261118130000_account_sanctions.sql) y
// su reversa. No hay Postgres local: se revisa el texto SQL. La migración se
// validó en el proyecto vivo dentro de begin … rollback (incluida la reversa).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = 'supabase/migrations/20261118130000_account_sanctions.sql';
const ROLLBACK = 'supabase/rollbacks/20261118130000_account_sanctions.down.sql';
const sql = read(MIGRATION);
const down = read(ROLLBACK);

// Sin comentarios de línea, para no aprobar un test con texto comentado.
const code = (text) => text.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const sqlCode = code(sql);
const downCode = code(down);

// Bloque `create table if not exists public.<name> ( … );`
function tableBlock(name) {
    const start = sqlCode.indexOf(`create table if not exists public.${name} (`);
    assert.ok(start >= 0, `falta la tabla ${name}`);
    const end = sqlCode.indexOf('\n);', start);
    assert.ok(end > start, `tabla sin cerrar: ${name}`);
    return sqlCode.slice(start, end);
}

test('la migración es una transacción y tiene reversa', () => {
    assert.match(sqlCode, /^\s*begin;/m);
    assert.match(sqlCode, /^\s*commit;\s*$/m);
    assert.match(downCode, /^\s*begin;/m);
    assert.match(downCode, /^\s*commit;\s*$/m);
    assert.ok(sql.includes(ROLLBACK), 'la migración nombra su reversa');
});

test('account_sanctions: columnas y CHECKs del contrato', () => {
    const t = tableBlock('account_sanctions');
    for (const col of ['id', 'user_id', 'kind', 'reason_code', 'summary', 'ticket_id', 'proposed_by', 'confirmed_by',
        'starts_at', 'ends_at', 'status', 'appeal_text', 'appeal_submitted_at', 'appeal_decided_by',
        'appeal_decided_at', 'appeal_outcome', 'side_effects', 'created_at', 'updated_at']) {
        assert.match(t, new RegExp(`^\\s+${col}\\s`, 'm'), `falta ${col}`);
    }
    assert.match(t, /check \(kind in \('warning', 'suspension', 'ban'\)\)/);
    assert.match(t, /check \(status in \('proposed', 'active', 'appealed', 'lifted', 'rejected'\)\)/);
    assert.match(t, /side_effects jsonb not null default '\{\}'::jsonb/);
});

test('account_sanctions: dos agentes para el baneo y revisor de apelación distinto', () => {
    const t = tableBlock('account_sanctions');
    assert.match(t, /check \(kind <> 'ban' or confirmed_by is null or confirmed_by <> proposed_by\)/);
    assert.match(t, /appeal_decided_by is distinct from proposed_by/);
    assert.match(t, /appeal_decided_by is distinct from confirmed_by/);
});

test('banned_identifiers: tipos, HMAC en hex y único (kind, value_hmac)', () => {
    const t = tableBlock('banned_identifiers');
    assert.match(t, /check \(kind in \('email', 'phone', 'instagram', 'document', 'face'\)\)/);
    assert.match(t, /value_hmac ~ '\^\[0-9a-f\]\{64\}\$'/);
    assert.match(t, /unique \(kind, value_hmac\)/);
    assert.match(t, /references public\.account_sanctions\(id\) on delete cascade/);
});

test('security_alerts: tipos y estados del contrato', () => {
    const t = tableBlock('security_alerts');
    assert.match(t, /check \(kind in \('reentry_blocked', 'image_duplicate', 'refund_needed'\)\)/);
    assert.match(t, /check \(status in \('open', 'handled', 'dismissed'\)\)/);
    for (const col of ['subject_user_id', 'related_user_id', 'payload', 'resolution', 'handled_by', 'handled_at']) {
        assert.match(t, new RegExp(`^\\s+${col}\\s`, 'm'), `falta ${col}`);
    }
});

test('columnas nuevas en artists_db, studios y quotations_db', () => {
    for (const table of ['artists_db', 'studios']) {
        const re = new RegExp(`alter table public\\.${table}\\s+add column if not exists sanction_state text not null default 'none',\\s+add column if not exists sanction_id uuid null;`);
        assert.match(sqlCode, re, `${table}.sanction_state / sanction_id`);
        assert.match(sqlCode, new RegExp(`add constraint ${table === 'artists_db' ? 'artists_db' : 'studios'}_sanction_state_check\\s+check \\(sanction_state in \\('none', 'suspended', 'banned'\\)\\)`));
    }
    assert.match(sqlCode, /add column if not exists support_closed_reason text null/);
    assert.match(sqlCode, /char_length\(support_closed_reason\) between 1 and 300/);
});

test('RLS activa en las 3 tablas; solo service_role escribe; soporte lee', () => {
    for (const t of ['account_sanctions', 'banned_identifiers', 'security_alerts']) {
        assert.match(sqlCode, new RegExp(`alter table public\\.${t} enable row level security;`));
        assert.match(sqlCode, new RegExp(`revoke all on table public\\.${t} from anon, authenticated;`));
        if (t !== 'account_sanctions') assert.match(sqlCode, new RegExp(`grant select on table public\\.${t} to authenticated;`));
        assert.match(sqlCode, new RegExp(`grant all on table public\\.${t} to service_role;`));
        assert.match(sqlCode, new RegExp(`create policy ${t}_support_select\\s+on public\\.${t} for select to authenticated\\s+using \\(public\\.is_support_user\\(\\)\\);`));
        // Ninguna política de escritura para anon/authenticated.
        assert.doesNotMatch(sqlCode, new RegExp(`on public\\.${t} for (insert|update|delete|all)`));
    }
    assert.doesNotMatch(sqlCode, /grant (insert|update|delete|all)[^;]*to (anon|authenticated)/);
    // El usuario ve solo sus sanciones activas o apeladas.
    assert.match(sqlCode, /create policy account_sanctions_own_select[\s\S]*?using \(user_id = \(select auth\.uid\(\)\) and status in \('active', 'appealed'\)\);/);
    // ...y solo columnas sin datos internos (agentes, ticket, resumen, side_effects).
    assert.doesNotMatch(sqlCode, /grant select on table public\.account_sanctions to authenticated/);
    const colGrant = sqlCode.match(/grant select \(([^)]*)\)\s+on table public\.account_sanctions to authenticated;/);
    assert.ok(colGrant, 'grant por columnas en account_sanctions');
    const cols = colGrant[1].split(',').map((c) => c.trim());
    for (const c of ['id', 'user_id', 'kind', 'reason_code', 'status', 'starts_at', 'ends_at']) assert.ok(cols.includes(c), c);
    for (const c of ['proposed_by', 'confirmed_by', 'appeal_decided_by', 'ticket_id', 'summary', 'side_effects', 'appeal_text']) {
        assert.ok(!cols.includes(c), `no expone ${c}`);
    }
});

test('predicado artist_is_public inmutable, con la firma del contrato', () => {
    assert.match(sqlCode, /create or replace function public\.artist_is_public\(registration_status text, sanction_state text\)\s+returns boolean\s+language sql\s+immutable/);
    assert.match(sqlCode, /registration_status is distinct from 'incompleto'\s+and coalesce\(sanction_state, 'none'\) = 'none'/);
});

test('las dos políticas públicas de artists_db exigen sanction_state = none', () => {
    for (const name of ['Public can view artists for marketplace', 'Authenticated can view all artists for marketplace']) {
        const re = new RegExp(`create policy "${name}"\\s+on public\\.artists_db for select\\s+using \\(\\(registration_status is distinct from 'incompleto'::text\\) and \\(sanction_state = 'none'::text\\)\\);`);
        assert.match(sqlCode, re, name);
        assert.match(sqlCode, new RegExp(`drop policy if exists "${name}" on public\\.artists_db;`));
    }
});

test('vistas y funciones públicas se redefinen desde la definición viva', () => {
    assert.match(sqlCode, /pg_get_viewdef/);
    for (const v of ['artists_with_location', 'public_artist_trips']) assert.ok(sqlCode.includes(`'${v}'`), v);
    assert.match(sqlCode, /with \(security_barrier = true\)/);
    assert.match(sqlCode, /pg_get_functiondef/);
    for (const fn of ['get_artist_public_badges', 'get_public_storefront', 'create_store_order',
        'store_public_seller_bundle', 'store_seller_ready_artist', 'recalculate_most_wanted']) {
        assert.ok(sqlCode.includes(`'public.${fn}(`), fn);
    }
    // Lo de otro equipo no se toca.
    assert.doesNotMatch(sqlCode, /get_artist_public_profile_preferences/);
    assert.doesNotMatch(sqlCode, /guard_artist_privileged_fields/);
    assert.doesNotMatch(sqlCode, /private\.guard_studio_protected_columns/);
});

test('estudios inactivos o sancionados fuera de la tienda, los spots y artists_with_location', () => {
    assert.match(sqlCode, /create or replace function public\.studio_is_public\(is_active boolean, sanction_state text\)[\s\S]*?immutable[\s\S]*?select coalesce\(is_active, false\)\s+and coalesce\(sanction_state, 'none'\) = 'none';/);
    assert.match(sqlCode, /grant execute on function public\.studio_is_public\(boolean, text\) to anon, authenticated, service_role;/);
    // La política no puede leer sanction_state (sin grant para anon): definer.
    assert.match(sqlCode, /create or replace function private\.studio_is_listed\(p_studio_id uuid\)[\s\S]*?security definer[\s\S]*?public\.studio_is_public\(s\.is_active, s\.sanction_state\)/);
    assert.match(sqlCode, /revoke all on function private\.studio_is_listed\(uuid\) from public;/);
    assert.match(sqlCode, /grant execute on function private\.studio_is_listed\(uuid\) to anon, authenticated, service_role;/);
    assert.match(sqlCode, /drop policy if exists spots_public_select_open on public\.studio_spots;\s*create policy spots_public_select_open\s+on public\.studio_spots for select\s+using \(\(status = 'open'::text\) and private\.studio_is_listed\(studio_id\)\);/);
    // Tienda: el único «and s.is_active» de cada función pasa al predicado.
    assert.match(sqlCode, /v_old constant text := \$q\$and s\.is_active\$q\$;/);
    assert.match(sqlCode, /v_new constant text := \$q\$and public\.studio_is_public\(s\.is_active, s\.sanction_state\)\$q\$;/);
    assert.match(sqlCode, /if v_count <> 1 then/);
    // Compra: estudio oculto = store:seller_not_ready.
    assert.match(sqlCode, /or \(v_product\.seller_type = 'studio' and not private\.studio_is_listed\(v_product\.seller_id\)\) then\$q\$;/);
    assert.match(sqlCode, /LEFT JOIN studios s ON a\.studio_id = s\.id AND \(a\.work_type = ANY \(ARRAY\['studio'::text, 'both'::text\]\)\) AND public\.studio_is_public\(s\.is_active, s\.sanction_state\)/);
    // Va después de que existan las columnas y antes del commit.
    assert.ok(sqlCode.indexOf('add column if not exists sanction_state') < sqlCode.indexOf('create or replace function public.studio_is_public'));
    // La reversa restaura todo lo anterior y borra los predicados de estudio.
    assert.match(downCode, /create policy spots_public_select_open\s+on public\.studio_spots for select\s+using \(status = 'open'::text\);/);
    assert.ok(downCode.includes('drop function if exists private.studio_is_listed(uuid);'));
    assert.ok(downCode.includes('drop function if exists public.studio_is_public(boolean, text);'));
    assert.match(downCode, /v_cond_a constant text := \$q\$ AND public\.studio_is_public\(s\.is_active, s\.sanction_state\)\$q\$;/);
    assert.match(downCode, /v_cond_b constant text := \$q\$ AND studio_is_public\(s\.is_active, s\.sanction_state\)\$q\$;/);
    // Antes de los pasos que fallan si queda sanction_state con otro texto.
    assert.ok(downCode.indexOf('drop function if exists public.studio_is_public') < downCode.indexOf("'public.get_artist_public_badges(uuid)'"));
    assert.ok(downCode.indexOf('drop function if exists public.studio_is_public') < downCode.indexOf('drop column if exists sanction_state'));
});

test('guardas nuevas de sanction_state / sanction_id y de is_active del estudio', () => {
    assert.match(sqlCode, /create trigger trg_guard_artist_sanction_columns\s+before insert or update on public\.artists_db/);
    assert.match(sqlCode, /create trigger trg_guard_studio_sanction_columns\s+before insert or update on public\.studios/);
    assert.match(sqlCode, /create trigger trg_guard_quotation_support_closed_reason\s+before insert or update on public\.quotations_db/);
    assert.match(sqlCode, /public\.wo_is_privileged_writer\(\)/);
    assert.match(sqlCode, /old\.sanction_state <> 'none' and new\.is_active is distinct from old\.is_active/);
    assert.match(sqlCode, /errcode = '42501'/);
});

test('retiros bloqueados con una sanción activa o apelada', () => {
    assert.ok(sql.includes('Tu cuenta tiene una sanción activa: no puedes solicitar retiros por ahora.'));
    assert.match(sqlCode, /s\.kind in \(''suspension'', ''ban''\)/);
    assert.match(sqlCode, /s\.status in \(''active'', ''appealed''\)/);
    assert.match(sqlCode, /request_artist_wallet_withdrawal\(uuid,numeric,text\)/);
});

test('revoke_user_sessions: definer, solo service_role, con envoltorio público', () => {
    assert.match(sqlCode, /create or replace function private\.revoke_user_sessions\(p_user uuid\)[\s\S]*?security definer[\s\S]*?delete from auth\.sessions where user_id = p_user;/);
    assert.match(sqlCode, /create or replace function public\.revoke_user_sessions\(p_user uuid\)[\s\S]*?security definer/);
    for (const schema of ['private', 'public']) {
        assert.match(sqlCode, new RegExp(`revoke all on function ${schema}\\.revoke_user_sessions\\(uuid\\) from public, anon, authenticated;`));
        assert.match(sqlCode, new RegExp(`grant execute on function ${schema}\\.revoke_user_sessions\\(uuid\\) to service_role;`));
    }
});

test('la billetera dice «Anticipo recibido», no «Seña»', () => {
    assert.match(sqlCode, /when 'deposit' then 'Anticipo recibido'/);
});

test('la reversa borra todo lo nuevo y restaura lo redefinido', () => {
    for (const t of ['account_sanctions', 'banned_identifiers', 'security_alerts']) {
        assert.match(downCode, new RegExp(`drop table if exists public\\.${t};`), t);
    }
    for (const fn of ['public.revoke_user_sessions(uuid)', 'private.revoke_user_sessions(uuid)',
        'private.guard_artist_sanction_columns()', 'private.guard_studio_sanction_columns()',
        'private.guard_quotation_support_closed_reason()', 'public.artist_is_public(text, text)']) {
        assert.ok(downCode.includes(`drop function if exists ${fn};`), fn);
    }
    for (const [table, col] of [['artists_db', 'sanction_state'], ['artists_db', 'sanction_id'], ['studios', 'sanction_state'],
        ['studios', 'sanction_id'], ['quotations_db', 'support_closed_reason']]) {
        assert.match(downCode, new RegExp(`alter table public\\.${table} drop column if exists ${col};`), `${table}.${col}`);
    }
    for (const trg of ['trg_guard_artist_sanction_columns', 'trg_guard_studio_sanction_columns', 'trg_guard_quotation_support_closed_reason']) {
        assert.ok(downCode.includes(`drop trigger if exists ${trg}`), trg);
    }
    // Políticas con su filtro previo (sin sanction_state).
    for (const name of ['Public can view artists for marketplace', 'Authenticated can view all artists for marketplace']) {
        assert.match(downCode, new RegExp(`create policy "${name}"\\s+on public\\.artists_db for select\\s+using \\(registration_status is distinct from 'incompleto'::text\\);`));
    }
    assert.match(downCode, /when 'deposit' then 'Seña recibida'/);
    assert.match(downCode, /a\.registration_status IS DISTINCT FROM 'incompleto'::text/);
    assert.match(downCode, /a\.registration_status is distinct from 'incompleto'/);
    // Primero se restauran vistas y funciones, después se borra el predicado y las columnas.
    assert.ok(downCode.indexOf('pg_get_viewdef') < downCode.indexOf('drop function if exists public.artist_is_public'));
    assert.ok(downCode.indexOf('pg_get_functiondef') < downCode.indexOf('drop column if exists sanction_state'));
});
