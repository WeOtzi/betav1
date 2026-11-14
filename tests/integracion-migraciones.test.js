'use strict';

// Correcciones de la revisión de integración sobre migraciones 20261115*
// (PII-STUDIOS-01, RLS-GCAL-HOLDS-01, RLS-TRG-DUP-02, RLS-SESS-OVERLAP-04).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

function functionHeader(sql, name) {
    const start = sql.indexOf(`create or replace function ${name}(`);
    assert.ok(start >= 0, `falta ${name}`);
    return sql.slice(start, sql.indexOf('as $function$', start));
}

test('PII-STUDIOS-01: save_studio_location sigue SECURITY DEFINER después de 200100', () => {
    const up = read('supabase/migrations/20261115210100_estudio_registro_sedes.sql');
    assert.match(functionHeader(up, 'public.save_studio_location'), /\nsecurity definer\n/);
    assert.match(up, /revoke all on function public\.save_studio_location\(uuid, uuid, jsonb\) from public, anon;/);
    assert.match(up, /grant execute on function public\.save_studio_location\(uuid, uuid, jsonb\) to authenticated, service_role;/);
    const down = read('supabase/rollbacks/20261115210100_estudio_registro_sedes.down.sql');
    assert.match(functionHeader(down, 'public.save_studio_location'), /\nsecurity definer\n/);
    // 200100 corre antes y también la deja definer.
    assert.ok('20261115200100' < '20261115210100');
    assert.match(read('supabase/migrations/20261115200100_pii_studios_column_privileges.sql'), /alter function %s security definer/);
});

test('RLS-GCAL-HOLDS-01: los apartados marcan la agenda de Google (migración posterior a turnos)', () => {
    const up = read('supabase/migrations/20261115160100_turnos_gcal_dirty.sql');
    assert.match(up, /select private\.gcal_attach_dirty_trigger\('public\.artist_booking_holds', 'artist_user_id', 'direct',\s*array\['artist_user_id', 'quotation_id', 'starts_at', 'ends_at', 'status', 'expires_at'\]\);/);
    assert.match(up, /^begin;$/m);
    assert.match(up, /^commit;$/m);
    const down = read('supabase/rollbacks/20261115160100_turnos_gcal_dirty.down.sql');
    assert.match(down, /drop trigger if exists trg_gcal_dirty on public\.artist_booking_holds/);
});

test('RLS-SESS-OVERLAP-04 / RLS-TRG-DUP-02: sesiones realizadas no chocan y el cierre usa >= now()', () => {
    const sql = read('supabase/migrations/20261115160000_turnos_reservas_online.sql');
    const overlap = sql.slice(sql.indexOf('create or replace function public.prevent_quotation_session_overlap'),
        sql.indexOf('drop trigger if exists trg_prevent_quotation_session_overlap'));
    assert.match(overlap, /if new\.status in \('cancelled', 'completed', 'no_show'\) then\s+return new;/);
    assert.match(overlap, /and old\.status not in \('cancelled', 'completed', 'no_show'\) then/);
    const close = sql.slice(sql.indexOf('create or replace function public.release_holds_on_quote_close'),
        sql.indexOf('drop trigger if exists trg_release_holds_on_quote_close'));
    assert.match(close, /and s\.session_date >= pg_catalog\.now\(\);/);
    assert.doesNotMatch(close, /s\.session_date > pg_catalog\.now\(\)/);
});
