const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const stripSqlComments = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\r\n]*/g, '');

const migrationPath = 'supabase/migrations/20260830013000_secure_travel_data_contract.sql';
const seedPath = 'supabase/seeds/20260830_isainaz_travel_figma_demo.sql';

function sqlFunction(source, schema, name) {
    const lower = source.toLowerCase();
    const start = lower.indexOf(`create or replace function ${schema}.${name}(`);
    assert.notEqual(start, -1, `missing SQL function ${schema}.${name}`);
    const end = source.indexOf('$$;', start);
    assert.notEqual(end, -1, `unterminated SQL function ${schema}.${name}`);
    return source.slice(start, end + 3);
}

test('Travel adds bounded Figma fields and keeps contacts party-private', () => {
    const sql = stripSqlComments(read(migrationPath));

    assert.match(sql, /add column if not exists interested_people_count integer default 0/i);
    assert.match(sql, /interested_people_count between 0 and 1000000/i);
    assert.match(sql, /add column if not exists climate_celsius numeric\(4,1\)/i);
    assert.match(sql, /climate_celsius between -90\.0 and 60\.0/i);
    assert.match(sql, /add column if not exists contact_name text/i);
    assert.match(sql, /char_length\(btrim\(contact_name\)\) between 1 and 120/i);
    assert.match(sql, /add column if not exists contact_details text/i);
    assert.match(sql, /char_length\(btrim\(contact_details\)\) between 1 and 500/i);
    assert.match(sql, /add column if not exists address_snapshot text/i);
    assert.match(sql, /char_length\(btrim\(address_snapshot\)\) between 1 and 240/i);
    for (const table of ['trip_checklist_items', 'trip_documents', 'trip_events']) {
        assert.match(sql, new RegExp(`alter table public\\.${table}[\\s\\S]*?add column if not exists source_type text,[\\s\\S]*?add column if not exists source_id uuid`, 'i'));
        assert.match(sql, new RegExp(`uq_${table}_source`, 'i'));
    }
});

test('anonymous Travel reads use a strict definer wrapper and no private-schema grant', () => {
    const sql = stripSqlComments(read(migrationPath));
    const helper = sqlFunction(sql, 'private', 'get_public_travel_share');
    const endpoint = sqlFunction(sql, 'public', 'get_public_travel_share');

    assert.match(sql, /drop policy if exists artist_trips_public_shared on public\.artist_trips/i);
    assert.match(sql, /revoke all privileges on table public\.artist_trips from anon/i);
    assert.doesNotMatch(sql, /grant usage on schema private to (?:anon|authenticated)/i);
    assert.match(endpoint, /security definer/i);
    assert.match(endpoint, /set search_path = ''/i);
    assert.match(endpoint, /private\.get_public_travel_share\(p_share_slug\)/i);
    assert.match(sql, /grant execute on function public\.get_public_travel_share\(text\)[\s\S]*to anon, authenticated, service_role/i);
    assert.doesNotMatch(sql, /grant execute on function private\.get_public_travel_share/i);

    for (const field of [
        'city', 'country', 'region', 'start_date', 'end_date', 'trip_type',
        'status', 'event_name', 'share_slug', 'interested_people_count',
        'climate_celsius', 'artist_name', 'artist_username',
    ]) assert.match(helper, new RegExp(`\\b${field}\\b`, 'i'), field);

    assert.doesNotMatch(helper, /personal_notes|agreed_conditions|storage_path|contact_name|contact_details|address_snapshot|requested_by_user_id|resolved_by_user_id/i);
    assert.match(helper, /t\.share_enabled = true/i);
    assert.match(helper, /t\.status <> 'cancelado'/i);
    assert.match(helper, /t\.cancelled_at is null/i);
});

test('studio pending list bypasses only the broken embed after party authorization', () => {
    const sql = stripSqlComments(read(migrationPath));
    const helper = sqlFunction(sql, 'private', 'list_pending_trip_studio_links');
    const repo = read('public/shared/js/data/travel-repo.js');

    assert.match(helper, /s\.id = p_studio_id and s\.user_id = v_actor/i);
    assert.match(helper, /not public\.is_support_user\(\)/i);
    assert.match(helper, /l\.status = 'esperando_confirmacion'/i);
    assert.match(helper, /t\.status <> 'cancelado'/i);
    assert.match(helper, /l\.address_snapshot/i);
    assert.match(repo, /rpc\('list_pending_trip_studio_links'/i);
    assert.doesNotMatch(repo, /artist_trips!inner/i);
    assert.match(repo, /artist_trips:\s*artistTrip/i);
    assert.match(repo, /contact_details, address_snapshot/i);
});

test('Tattoo Passport is persisted with owner-only RLS and a dedicated repo read', () => {
    const raw = read(migrationPath);
    const sql = stripSqlComments(raw);
    const repo = read('public/shared/js/data/travel-repo.js');
    const seed = read(seedPath);

    assert.match(sql, /create table if not exists public\.artist_travel_passport_stamps/i);
    assert.match(sql, /artist_user_id uuid not null references public\.artists_db \(user_id\) on delete cascade/i);
    assert.match(sql, /tattoo_count integer not null default 0/i);
    assert.match(sql, /studio_count integer not null default 0/i);
    assert.match(sql, /alter table public\.artist_travel_passport_stamps enable row level security/i);
    assert.match(sql, /create policy artist_travel_passport_owner_all[\s\S]*for all to authenticated[\s\S]*auth\.uid\(\)\) = artist_user_id/i);
    assert.match(sql, /revoke all privileges on table public\.artist_travel_passport_stamps[\s\S]*from public, anon, authenticated/i);
    assert.doesNotMatch(sql, /artist_travel_passport_support/i);

    assert.match(repo, /async listPassport\(artistUserId\)/i);
    assert.match(repo, /from\('artist_travel_passport_stamps'\)/i);
    assert.match(repo, /select\('id, artist_user_id, city, country, year, tattoo_count, studio_count'\)/i);

    assert.match(seed, /'Buenos Aires', 'Argentina', 2025::smallint, 3, 2/i);
    assert.match(seed, /'São Paulo', 'Brasil', 2024::smallint, 1, 1/i);
    assert.match(seed, /'Bogotá', 'Colombia', 2023::smallint, 2, 2/i);
    assert.match(seed, /delete from public\.artist_travel_passport_stamps p[\s\S]*\(p\.id, p\.source_id\) in/i);
});

test('Travel lifecycle RPCs are atomic and cancelled trips cannot be resolved', () => {
    const sql = stripSqlComments(read(migrationPath));
    const create = sqlFunction(sql, 'private', 'create_artist_trip');
    const dates = sqlFunction(sql, 'private', 'update_artist_trip_dates');
    const cancel = sqlFunction(sql, 'private', 'cancel_artist_trip');
    const reactivate = sqlFunction(sql, 'private', 'reactivate_artist_trip');
    const resolve = sqlFunction(sql, 'private', 'resolve_trip_studio_link');
    const repo = read('public/shared/js/data/travel-repo.js');

    assert.match(create, /insert into public\.artist_trips/i);
    assert.match(create, /insert into public\.trip_checklist_items/i);
    assert.equal((create.match(/\('(?:Pasajes comprados|Hospedaje reservado|Estudio confirmado|Contacté al estudio|Agenda recibida|Equipos preparados|Materiales de trabajo listos|Documentación preparada|Seguro de viaje|Equipaje listo)'/g) || []).length, 10);
    assert.match(create, /insert into public\.trip_events[\s\S]*'creado'/i);

    assert.match(dates, /for update/i);
    assert.match(dates, /set start_date = p_start_date,[\s\S]*end_date = p_end_date/i);
    assert.match(dates, /insert into public\.trip_events[\s\S]*'Fechas actualizadas/i);

    assert.match(cancel, /for update/i);
    assert.match(cancel, /update public\.trip_studio_links[\s\S]*status = 'cancelada'/i);
    assert.match(cancel, /l\.status = 'esperando_confirmacion'/i);
    assert.match(cancel, /share_enabled = false/i);
    assert.match(cancel, /insert into public\.trip_events[\s\S]*'cancelado'/i);
    assert.match(cancel, /where not exists/i);

    assert.match(reactivate, /when v_trip\.end_date < current_date then 'finalizado'/i);
    assert.match(reactivate, /insert into public\.trip_events[\s\S]*'Viaje reactivado'/i);
    assert.match(reactivate, /where not exists/i);
    assert.match(resolve, /v_trip\.status = 'cancelado' or v_trip\.cancelled_at is not null/i);
    assert.match(resolve, /cancelled trips cannot resolve studio links/i);

    assert.match(repo, /rpc\('create_artist_trip'/i);
    assert.match(repo, /rpc\('update_artist_trip_dates'/i);
    assert.match(repo, /rpc\('cancel_artist_trip'/i);
    assert.match(repo, /rpc\('reactivate_artist_trip'/i);
    assert.doesNotMatch(repo, /update\(\{ status: 'cancelado'/i);
});

test('accepted invitations create checklist and timeline state idempotently', () => {
    const raw = read(migrationPath);
    const sql = stripSqlComments(raw);
    const initializer = sqlFunction(sql, 'private', 'initialize_trip_from_accepted_invitation');
    const membershipTrigger = sqlFunction(sql, 'public', 'create_trip_from_accepted_invitation');
    const detailTrigger = sqlFunction(sql, 'public', 'create_trip_from_invitation_detail');

    assert.match(initializer, /insert into public\.trip_checklist_items/i);
    assert.equal((initializer.match(/\('(?:Pasajes comprados|Hospedaje reservado|Estudio confirmado|Contacté al estudio|Agenda recibida|Equipos preparados|Materiales de trabajo listos|Documentación preparada|Seguro de viaje|Equipaje listo)'/g) || []).length, 10);
    assert.match(initializer, /\('creado', 'Viaje creado desde una invitación aceptada'\)/i);
    assert.match(initializer, /\('estudio_confirmado', v_studio\.name\)/i);
    assert.match(initializer, /where not exists/i);
    assert.match(membershipTrigger, /private\.initialize_trip_from_accepted_invitation\(new\.id\)/i);
    assert.match(detailTrigger, /private\.initialize_trip_from_accepted_invitation\(new\.membership_id\)/i);
    assert.match(raw, /create trigger trg_create_trip_from_invitation_detail[\s\S]*on public\.studio_membership_invitation_details/i);
    assert.match(raw, /repair both missing trips[\s\S]*perform private\.initialize_trip_from_accepted_invitation\(r\.id\)/i);
    assert.doesNotMatch(raw, /grant execute on function private\.initialize_trip_from_accepted_invitation/i);
});

test('Travel seed rejects reserved studio-link source UUID collisions before DML', () => {
    const sql = stripSqlComments(read(seedPath));
    const apply = sql.slice(0, sql.indexOf('commit;') + 'commit;'.length);
    const preflightAt = apply.search(/\bdo\s+\$\$/i);
    const preflightEnd = apply.indexOf('$$;', preflightAt);
    const preflight = apply.slice(preflightAt, preflightEnd + 3);
    const collisionGuard = preflight.search(/Reserved Travel studio-link demo source UUID is already bound to a different fixed row/i);
    const firstDml = preflight.search(/\b(?:delete\s+from|update|insert\s+into)\b/i);

    assert.ok(preflightAt >= 0 && preflightEnd > preflightAt, 'apply preflight block');
    assert.ok(collisionGuard >= 0, 'reserved studio-link collision guard');
    assert.ok(firstDml > collisionGuard, 'collision guard runs before any apply DML');
    assert.match(preflight, /from public\.trip_studio_links l/i);
    assert.match(preflight, /l\.source_type = 'demo'/i);
    assert.match(preflight, /l\.source_id = expected\.source_id/i);
    assert.match(preflight, /l\.id <> expected\.id/i);

    for (const [id, sourceId] of [
        ['a6d1a848-7ec6-4dd2-9ea6-15592ed262ad', '83400000-0000-4000-a000-000000000001'],
        ['83400000-0000-4000-8000-000000000009', '83400000-0000-4000-a000-000000000009'],
        ['83400000-0000-4000-8000-000000000002', '83400000-0000-4000-a000-000000000002'],
        ['83400000-0000-4000-8000-000000000003', '83400000-0000-4000-a000-000000000003'],
        ['24f2516b-e655-4b8d-8974-0db2b68c8c24', '83400000-0000-4000-a000-000000000004'],
        ['83400000-0000-4000-8000-000000000005', '83400000-0000-4000-a000-000000000005'],
        ['c9ab6c10-0cf9-4f7e-8538-22e3a04a9b83', '83400000-0000-4000-a000-000000000006'],
        ['c96c06e7-ccd7-4de0-a157-530c4cff187f', '83400000-0000-4000-a000-000000000007'],
        ['83400000-0000-4000-8000-000000000008', '83400000-0000-4000-a000-000000000008'],
    ]) assert.match(preflight, new RegExp(`${id}[\\s\\S]{0,120}${sourceId}`, 'i'));
});

test('ISAINAZ Travel seed converges to the exact eight-trip Figma dataset', () => {
    const raw = read(seedPath);
    const sql = stripSqlComments(raw);
    const applyBegin = sql.search(/\bbegin\s*;/i);
    const applyLock = sql.search(/\block\s+table\b/i);
    const applyDo = sql.search(/\bdo\s+\$\$/i);
    assert.ok(applyBegin !== -1 && applyLock > applyBegin && applyDo > applyLock, 'APPLY locks its complete graph before preflight');
    const applyLockClause = sql.slice(applyLock, applyDo);
    for (const table of [
        'artists_db', 'studios', 'artist_trips', 'artist_travel_passport_stamps',
        'inbox_threads', 'inbox_thread_participants', 'inbox_messages',
        'inbox_thread_activity', 'trip_checklist_items', 'trip_documents',
        'trip_events', 'trip_studio_links', 'trip_studio_link_audit',
    ]) assert.match(applyLockClause, new RegExp(`public\\.${table}\\b`, 'i'), table);
    const match = sql.match(/with target as \([\s\S]*?\), seed\([\s\S]*?\) as \(\s*values([\s\S]*?)\n\)\s*insert into public\.artist_trips/i);
    assert.ok(match, 'main eight-trip seed block');
    const trips = match[1];

    for (const city of [
        'Barcelona', 'Berlín', 'Ciudad de México', 'Madrid',
        'Santiago', 'Montevideo', 'Lima',
    ]) assert.match(trips, new RegExp(`'${city}'`, 'i'), city);

    assert.match(trips, /'Barcelona'[\s\S]*date '2026-08-15', date '2026-08-22'/i);
    assert.match(trips, /'Berlín'[\s\S]*date '2026-09-03', date '2026-09-05'/i);
    assert.match(trips, /'Ciudad de México'[\s\S]*date '2026-09-20', date '2026-09-27'/i);
    assert.match(trips, /'Madrid'[\s\S]*date '2026-10-10', date '2026-10-14'/i);
    assert.match(trips, /'Santiago'[\s\S]*date '2026-11-02', date '2026-11-04'/i);
    assert.match(trips, /'Montevideo'[\s\S]*date '2026-06-20', date '2026-06-22'/i);
    assert.match(trips, /'Lima'[\s\S]*date '2026-06-05', date '2026-06-07'/i);
    assert.match(trips, /'Barcelona'[\s\S]*date '2025-12-05', date '2025-12-07'[\s\S]*'convencion', 'finalizado'/i);
    assert.doesNotMatch(trips, /'São Paulo'[\s\S]*date '2026-03-10'/i);
    assert.match(trips, /'Zorro Rojo Tattoo'/i);
    assert.match(trips, /'Berlín'[\s\S]*'convencion', 'confirmado', 'Bauhaus Ink Fest', 'Bauhaus Ink Fest'/i);
    assert.match(trips, /'Ciudad de México'[\s\S]*'estudio_invitado', 'pendiente', 'Estudio Cactus', null/i);
    assert.match(trips, /'Santiago'[\s\S]*'convencion', 'pendiente', 'Congreso Sudamericano de Tatuaje', 'Congreso Sudamericano de Tatuaje'/i);
    assert.match(trips, /'Split 65% para el artista\. Agenda garantizada de 5 días, materiales incluidos\.'/i);
    assert.match(trips, /'br-zorro-rojo-ago26', true, 12, 28\.0::numeric/i);
    assert.equal((trips.match(/,\s*'confirmado',/gi) || []).length, 2);
    assert.equal((trips.match(/,\s*'pendiente',/gi) || []).length, 3);
    assert.equal((trips.match(/,\s*'finalizado',/gi) || []).length, 3);
    assert.match(sql, /'demo', s\.source_id/i);

    const activeSeed = sql.slice(0, sql.lastIndexOf('commit;') + 'commit;'.length);
    const activeTripDeletes = activeSeed.match(/delete from public\.artist_trips[\s\S]*?;/gi) || [];
    assert.equal(activeTripDeletes.length, 1);
    assert.match(activeTripDeletes[0], /t\.id='4bc33e15-b315-4908-a0c0-fe47cbde32f5'::uuid[\s\S]*t\.source_type='studio_invitation'[\s\S]*t\.source_id='5df457e1-f3f4-42ef-98da-6168e742d7c5'::uuid/i);
    assert.doesNotMatch(activeSeed, /delete from public\.trip_studio_links/i);
    assert.doesNotMatch(activeSeed, /(?:insert into|update|delete from) public\.trip_studio_link_audit/i);
    for (const id of [
        '9a70aa11-4232-4615-9dc6-04d0aedd63e2',
        '9c7d45da-ef3e-4f0c-85cc-061ec5af166c',
        '494464fd-9f32-4577-bb52-955c4872480c',
        '23fb65d1-9479-4455-8908-b664f7b70819',
        'a2b43cea-e81f-4ae4-b407-78c0e1c44436',
    ]) assert.match(raw, new RegExp(id, 'i'), id);

    assert.match(raw, /v_legacy_count = 5[\s\S]*v_demo_count = 0/i);
    assert.match(raw, /v_legacy_count = 0[\s\S]*v_demo_count = 8/i);
    assert.match(activeSeed, /v_legacy_count = 5[\s\S]*artist_user_id=v_artist_user_id\) = 6/i);
    assert.match(activeSeed, /v_demo_count = 8[\s\S]*artist_user_id=v_artist_user_id\) = 8/i);
    assert.match(raw, /Travel fixture parents are missing, mixed or edited/i);
    assert.match(raw, /'Barcelona', 'España', 'Europa'::text[\s\S]*'Split 70\/30 · el estudio pone insumos'/i);
    assert.match(raw, /'Ciudad de México', 'México', 'América'[\s\S]*'Convención Internacional de Tatuaje CDMX'/i);
    assert.match(raw, /'Montevideo', 'Uruguay', 'América'[\s\S]*'Split 60\/40'/i);
    assert.match(raw, /'Lima', 'Perú', 'América'[\s\S]*'Split 65\/35'/i);
    assert.match(trips, /'Madrid'[\s\S]*'Madrid Ink Studio'/i);
    assert.match(raw, /'24f2516b-e655-4b8d-8974-0db2b68c8c24'::uuid,[\s\S]{0,220}'La Nave Tattoo',[\s\S]{0,80}'esperando_confirmacion'/i);
    assert.match(raw, /\[PRUEBA\]\[TRAVEL-FIGMA-20260830\]/);
    assert.match(raw, /Marc Solé/);
    assert.match(raw, /\+34 611 222 333 · WhatsApp/);
    assert.match(raw, /Llevar flash sheets nuevos y stencils impresos — la impresora del estudio es lenta\./);
    assert.match(raw, /'Zorro Rojo Tattoo', 'Barcelona', 'esperando_confirmacion'/i);
    assert.match(raw, /'Marea Negra Barcelona', 'Barcelona', 'confirmada'/i);
    assert.match(raw, /Carrer del Rec 45, Barcelona/i);
    for (const fileName of [
        'Pasaje_ida_vuelta.pdf',
        'Reserva_hotel_barcelona.pdf',
        'Acuerdo_costa_ink.pdf',
    ]) assert.match(raw, new RegExp(fileName, 'i'), fileName);
    for (const event of [
        /'creado'[\s\S]*date '2026-07-02'/i,
        /'estudio_confirmado'[\s\S]*date '2026-07-10'/i,
        /'pasajes_agregados'[\s\S]*date '2026-07-18'/i,
        /'inicio'[\s\S]*date '2026-08-15'/i,
        /'fin'[\s\S]*date '2026-08-22'/i,
    ]) assert.match(raw, event);
    const checklistInsert = sql.match(/with items\(id, source_id, label, is_done, sort_order\) as \([\s\S]*?insert into public\.trip_checklist_items[\s\S]*?from items i/i)?.[0] || '';
    const documentInsert = sql.match(/with docs\(id, source_id, category, file_name, relative_path, created_at\) as \([\s\S]*?insert into public\.trip_documents[\s\S]*?from docs d/i)?.[0] || '';
    const eventInsert = sql.match(/with events\(id, source_id, event_type, detail, event_date, created_at\) as \([\s\S]*?insert into public\.trip_events[\s\S]*?from events e/i)?.[0] || '';
    assert.equal((checklistInsert.match(/'83100000-0000-4000-8000-0000000000(?:0[1-9]|10)'::uuid/g) || []).length, 10);
    assert.equal((checklistInsert.match(/, true,/g) || []).length, 3);
    assert.match(checklistInsert, /'Pasajes comprados', true, 0/i);
    assert.match(checklistInsert, /'Hospedaje reservado', true, 1/i);
    assert.match(checklistInsert, /'Estudio confirmado', false, 2/i);
    assert.match(checklistInsert, /'Contacté al estudio', true, 3/i);
    assert.equal((documentInsert.match(/'83200000-0000-4000-8000-00000000000[1-3]'::uuid/g) || []).length, 3);
    assert.equal((eventInsert.match(/'83300000-0000-4000-8000-00000000000[1-5]'::uuid/g) || []).length, 5);
    assert.doesNotMatch(activeSeed, /with demo_trips[\s\S]*delete from public\.trip_(?:documents|checklist_items|events|studio_links)/i);
    assert.match(raw, /Legacy Barcelona checklist differs from the exact 14-row live fixture/i);
    assert.match(raw, /'Insumos y máquinas', false, false, 3/i);
    assert.match(raw, /'Contenido para redes', false, false, 9/i);
    assert.match(raw, /'Comprar pasajes', true, false, 1/i);
    assert.match(raw, /'Publicar agenda del viaje', false, true, 4/i);
    assert.match(raw, /Legacy Barcelona events differ from the exact five-row live fixture/i);
    assert.match(raw, /Legacy Travel links differ from the exact five-row live fixture/i);
    for (const id of [
        '4bc33e15-b315-4908-a0c0-fe47cbde32f5',
        '51648221-a3a6-4e09-8860-492f9777ff88',
        '5b2a8aa4-896a-4bec-913f-e589f06d4c3b',
        '1c12be0d-86ef-4a76-8dca-cb5ee1242107',
        '1948b9ee-149f-477d-9cf0-f4837b5f9e01',
        '99af2d82-524d-462a-a8ae-668959b0de71',
        '332a3cb5-dcae-4b54-ade9-ac34b419e95b',
        '2c598eca-1cae-4e2e-8c85-b91da2aa9b4c',
        'e93caafd-4671-4595-96f0-cab95ab4226d',
        '65ab0217-9612-4849-b26e-e13c6e7ab978',
    ]) assert.match(activeSeed, new RegExp(id, 'i'));
    assert.match(activeSeed, /Automatic invitation trip differs from the exact post-migration parent/i);
    assert.match(activeSeed, /Automatic invitation checklist differs from the exact ten-row graph/i);
    assert.match(activeSeed, /Automatic invitation events differ from the exact two-row graph/i);
    assert.match(activeSeed, /Automatic invitation link audit differs from the exact graph/i);
    assert.match(activeSeed, /Automatic invitation Inbox graph differs from the exact thread/i);
    assert.doesNotMatch(raw, /51648221-a3a6-4e09-860f-492f9777ff88/i);
    assert.match(activeSeed, /delete from public\.inbox_threads[\s\S]*?1c12be0d-86ef-4a76-8dca-cb5ee1242107[\s\S]*?delete from public\.artist_trips/i);
    assert.match(activeSeed, /Automatic invitation trip unexpectedly exists in demo rerun state/i);
    for (const [id, sourceId] of [
        ['a6d1a848-7ec6-4dd2-9ea6-15592ed262ad', '83400000-0000-4000-a000-000000000001'],
        ['24f2516b-e655-4b8d-8974-0db2b68c8c24', '83400000-0000-4000-a000-000000000004'],
        ['c9ab6c10-0cf9-4f7e-8538-22e3a04a9b83', '83400000-0000-4000-a000-000000000006'],
        ['c96c06e7-ccd7-4de0-a157-530c4cff187f', '83400000-0000-4000-a000-000000000007'],
    ]) assert.match(activeSeed, new RegExp(`${id.replaceAll('-', '\\-')}[\\s\\S]{0,180}${sourceId.replaceAll('-', '\\-')}`, 'i'));
    assert.match(activeSeed, /a0d9a6fa-004b-4344-b20e-43f31c33a143[\s\S]*set status = 'rechazada'|set status = 'rechazada'[\s\S]*a0d9a6fa-004b-4344-b20e-43f31c33a143/i);
    assert.match(activeSeed, /on conflict \(source_type, source_id\)[\s\S]*where source_type is not null and source_id is not null[\s\S]*do update set/i);
    assert.match(raw, /Demo Barcelona checklist contains missing, edited or unrecognized rows/i);
    assert.match(raw, /ROLLBACK \/ RESTORE/i);
    assert.match(raw, /\(t\.id, t\.source_id\) in/i);

    const rollback = raw.slice(raw.lastIndexOf('-- ROLLBACK / RESTORE')).replace(/^-- ?/gm, '');
    const rollbackLinkInserts = rollback.match(/insert into public\.trip_studio_links\s*\(/gi) || [];
    assert.equal(rollbackLinkInserts.length, 1);
    assert.match(rollback, /insert into public\.trip_studio_links[\s\S]*51648221-a3a6-4e09-8860-492f9777ff88/i);
    assert.match(rollback, /disable trigger trg_guard_trip_studio_link_transition[\s\S]*disable trigger trg_audit_trip_studio_link_transition[\s\S]*insert into public\.trip_studio_links[\s\S]*enable trigger trg_audit_trip_studio_link_transition[\s\S]*enable trigger trg_guard_trip_studio_link_transition/i);
    assert.match(rollback, /delete from public\.trip_studio_links[\s\S]*\(l\.id,l\.source_id\) in/i);
    const rollbackLinkDelete = rollback.match(/delete from public\.trip_studio_links[\s\S]*?;\s*/i)?.[0] || '';
    assert.equal((rollbackLinkDelete.match(/\('83400000-0000-4000-8000-00000000000[23589]'::uuid,'83400000-0000-4000-a000-00000000000[23589]'::uuid\)/gi) || []).length, 5);
    assert.doesNotMatch(rollbackLinkDelete, /a6d1a848|24f2516b|c9ab6c10|c96c06e7|a0d9a6fa/i);
    for (const id of [
        'a6d1a848-7ec6-4dd2-9ea6-15592ed262ad',
        '24f2516b-e655-4b8d-8974-0db2b68c8c24',
        'c9ab6c10-0cf9-4f7e-8538-22e3a04a9b83',
        'c96c06e7-ccd7-4de0-a157-530c4cff187f',
        'a0d9a6fa-004b-4344-b20e-43f31c33a143',
    ]) assert.match(rollback, new RegExp(id, 'i'));
    assert.match(rollback, /contact_name=null,[\s\S]*contact_details=null, address_snapshot=null/i);
    assert.match(rollback, /2026-08-19 03:40:13\.985252\+00[\s\S]*2026-08-23 03:40:13\.985252\+00/i);
    assert.match(rollback, /e5e3be81-784d-469c-bb86-13952f2a0c08/i);
    assert.match(rollback, /insert into public\.artist_trips[\s\S]*4bc33e15-b315-4908-a0c0-fe47cbde32f5[\s\S]*studio_invitation[\s\S]*5df457e1-f3f4-42ef-98da-6168e742d7c5/i);
    assert.match(rollback, /insert into public\.trip_studio_link_audit[\s\S]*5b2a8aa4-896a-4bec-913f-e589f06d4c3b/i);
    assert.match(rollback, /insert into public\.inbox_threads[\s\S]*1c12be0d-86ef-4a76-8dca-cb5ee1242107/i);
    assert.match(rollback, /insert into public\.inbox_thread_participants[\s\S]*1c12be0d-86ef-4a76-8dca-cb5ee1242107/i);
    assert.match(rollback, /disable trigger trg_touch_inbox_message_thread[\s\S]*insert into public\.inbox_messages[\s\S]*1948b9ee-149f-477d-9cf0-f4837b5f9e01[\s\S]*enable trigger trg_touch_inbox_message_thread/i);
    assert.match(rollback, /insert into public\.inbox_thread_activity[\s\S]*99af2d82-524d-462a-a8ae-668959b0de71/i);
    assert.doesNotMatch(rollback, /(?:delete from|update) public\.trip_studio_link_audit/i);
});

test('manual Travel rollback fails closed before mutating a drifted demo graph', () => {
    const raw = read(seedPath);
    const rollback = raw.slice(raw.lastIndexOf('-- ROLLBACK / RESTORE')).replace(/^-- ?/gm, '');
    const sql = stripSqlComments(rollback);
    const beginAt = sql.search(/\bbegin\s*;/i);
    const lockAt = sql.search(/\block\s+table\b/i);
    const preflightAt = sql.search(/\bdo\s+\$\$/i);
    const preflightEnd = sql.indexOf('$$;', preflightAt);
    const firstMutation = sql.search(/\b(?:delete\s+from|update|insert\s+into|alter\s+table)\b/i);

    assert.notEqual(beginAt, -1, 'rollback transaction');
    assert.ok(lockAt > beginAt && lockAt < preflightAt, 'rollback locks every mutable relation before preflight');
    assert.ok(preflightAt > beginAt, 'rollback preflight follows BEGIN');
    assert.ok(preflightEnd > preflightAt, 'rollback preflight is complete');
    assert.ok(firstMutation > preflightEnd, 'rollback preflight finishes before every mutation');

    const preflight = sql.slice(preflightAt, preflightEnd + 3);
    assert.match(preflight, /Demo artist isainazartattoo\.wo does not exist/i);
    assert.match(preflight, /Rollback aborted: Travel demo parents drifted/i);
    assert.match(preflight, /Rollback aborted: Travel demo-owned child graph drifted/i);
    assert.match(preflight, /Rollback aborted: inserted Travel parents have unowned children/i);
    assert.match(preflight, /Rollback aborted: automatic invitation restore IDs are occupied/i);
    assert.match(preflight, /Rollback aborted: automatic invitation Inbox restore IDs are occupied/i);

    for (const [id, sourceId] of [
        ['9a70aa11-4232-4615-9dc6-04d0aedd63e2', '83000000-0000-4000-a000-000000000001'],
        ['83000000-0000-4000-8000-000000000002', '83000000-0000-4000-a000-000000000002'],
        ['494464fd-9f32-4577-bb52-955c4872480c', '83000000-0000-4000-a000-000000000003'],
        ['9c7d45da-ef3e-4f0c-85cc-061ec5af166c', '83000000-0000-4000-a000-000000000004'],
        ['83000000-0000-4000-8000-000000000005', '83000000-0000-4000-a000-000000000005'],
        ['23fb65d1-9479-4455-8908-b664f7b70819', '83000000-0000-4000-a000-000000000006'],
        ['a2b43cea-e81f-4ae4-b407-78c0e1c44436', '83000000-0000-4000-a000-000000000007'],
        ['83000000-0000-4000-8000-000000000008', '83000000-0000-4000-a000-000000000008'],
    ]) assert.match(preflight, new RegExp(`${id}[\\s\\S]{0,180}${sourceId}`, 'i'));

    assert.match(preflight, /with expected_parents\([\s\S]*?interested_people_count, climate_celsius/i);
    assert.match(preflight, /with expected_passport\([\s\S]*?tattoo_count, studio_count/i);
    assert.match(preflight, /with expected_checklist\([\s\S]*?label, is_done, is_custom, sort_order/i);
    assert.match(preflight, /with expected_documents\([\s\S]*?category, file_name, storage_path, created_at/i);
    assert.match(preflight, /with expected_events\([\s\S]*?event_type, detail, event_date, created_at/i);
    assert.match(preflight, /with expected_links\([\s\S]*?contact_name, contact_details, address_snapshot/i);
    assert.match(preflight, /source_type = 'demo'[\s\S]*source_id = e\.source_id/i);
    assert.match(preflight, /83000000-0000-4000-8000-000000000002[\s\S]*83000000-0000-4000-8000-000000000005[\s\S]*83000000-0000-4000-8000-000000000008/i);
    assert.match(preflight, /332a3cb5-dcae-4b54-ade9-ac34b419e95b/i);
    assert.match(preflight, /65ab0217-9612-4849-b26e-e13c6e7ab978/i);
    assert.match(preflight, /51648221-a3a6-4e09-8860-492f9777ff88/i);
    assert.match(preflight, /5b2a8aa4-896a-4bec-913f-e589f06d4c3b/i);

    const lockClause = sql.slice(lockAt, preflightAt);
    for (const table of [
        'artists_db',
        'studios',
        'artist_trips',
        'artist_travel_passport_stamps',
        'trip_checklist_items',
        'trip_documents',
        'trip_events',
        'trip_studio_links',
        'trip_studio_link_audit',
        'inbox_threads',
        'inbox_thread_participants',
        'inbox_messages',
        'inbox_thread_activity',
    ]) assert.match(lockClause, new RegExp(`public\\.${table}\\b`, 'i'), table);
    assert.match(lockClause, /in\s+share\s+row\s+exclusive\s+mode/i);
});

test('public share consumes only the secure RPC and supports canonical path slugs', () => {
    const repo = read('public/shared/js/data/travel-repo.js');
    const share = read('public/shared/js/travel-share.js');
    const page = read('public/travel/share/index.html');

    const getBySlug = repo.slice(repo.indexOf('async getBySlug'), repo.indexOf('// Crea viaje'));
    assert.match(getBySlug, /rpc\('get_public_travel_share'/i);
    assert.doesNotMatch(getBySlug, /from\('artist_trips'\)/i);
    assert.match(share, /location\.pathname[\s\S]*?\/\\\/travel\\\/t\\\//i);
    assert.match(share, /new URLSearchParams\(location\.search\)\.get\('slug'\)/i);
    assert.match(share, /trip\.artist_name \|\| trip\.artist_username/i);
    assert.match(share, /function\s+today\(\)[\s\S]*?getFullYear\(\)[\s\S]*?getMonth\(\)[\s\S]*?getDate\(\)/i);
    assert.match(share, /pd\(trip\.end_date\)\s*<\s*today\(\)/i);
    assert.doesNotMatch(share, /D\.Artists\.getByUserId/i);
    assert.doesNotMatch(page, /artists-repo\.js/i);
});
