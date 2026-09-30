-- Travel Figma demo for @isainazartattoo.wo.
-- Marker: [PRUEBA][TRAVEL-FIGMA-20260830]
--
-- APPLY
--   Run this complete file once in the Supabase SQL editor (or with psql and
--   ON_ERROR_STOP=1) after migration 20260830013000. It is idempotent.
--
-- SAFE LEGACY TRANSITION
--   Five rows from 20260829_isainaz_dashboard_demo.sql already exist remotely
--   with source_type NULL. They are reused only when UUID + artist + the full
--   old fixture fingerprint match. Any mismatch aborts the transaction. Three
--   new rows use fixed UUIDs. No trip is selected, changed or deleted by city
--   alone.
--   Tattoo Passport rows follow the same fixed ID + source UUID rule.
--
-- ROLLBACK
--   The exact restoration script is documented at the end of this file. It
--   deletes only the three new UUID/source UUID pairs and restores the five
--   known legacy UUIDs when their demo source UUID still matches, then recreates
--   the exact automatic invitation graph retired during APPLY.

begin;

-- Keep every fingerprint and its subsequent replacement in one stable graph.
-- The seed is a short-lived, operator-run fixture transition; blocking writes
-- here is preferable to silently deleting a row created between check and DML.
lock table
  public.artists_db,
  public.studios,
  public.artist_trips,
  public.artist_travel_passport_stamps,
  public.inbox_threads,
  public.inbox_thread_participants,
  public.inbox_messages,
  public.inbox_thread_activity,
  public.trip_checklist_items,
  public.trip_documents,
  public.trip_events,
  public.trip_studio_links,
  public.trip_studio_link_audit
in share row exclusive mode;

do $$
declare
  v_artist_user_id uuid;
  v_legacy_count integer := 0;
  v_demo_count integer := 0;
  v_deleted_count integer := 0;
  v_mode text;
  r record;
begin
  select a.user_id into v_artist_user_id
  from public.artists_db a
  where lower(a.username) = 'isainazartattoo.wo';

  if v_artist_user_id is null then
    raise exception 'Demo artist isainazartattoo.wo does not exist';
  end if;

  -- The transition is all-or-nothing. The five known parents must all exist as
  -- the exact live legacy fixture, or all eight rows must already equal this
  -- seed's complete demo state. Mixed, missing or edited states abort.
  with expected(
    id, city, country, region, start_date, end_date, trip_type, status,
    studio_name_hint, event_name, agreed_conditions, personal_notes,
    share_slug, share_enabled
  ) as (values
    ('9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid, 'Barcelona', 'España', 'Europa'::text, date '2026-09-22', date '2026-10-06', 'guest_spot', 'confirmado', 'Zorro Rojo Tattoo', null::text, 'Split 70/30 · el estudio pone insumos'::text, 'Llevar máquinas de línea y cartuchos 3RL', 'br-zorro-rojo-sep26', true),
    ('9c7d45da-ef3e-4f0c-85cc-061ec5af166c'::uuid, 'Madrid', 'España', 'Europa', date '2026-10-08', date '2026-10-15', 'guest_spot', 'pendiente', 'La Nave Tattoo', null, null, 'Confirmar fechas con el estudio', null, false),
    ('494464fd-9f32-4577-bb52-955c4872480c'::uuid, 'Ciudad de México', 'México', 'América', date '2026-11-12', date '2026-11-19', 'convencion', 'planificado', null, 'Convención Internacional de Tatuaje CDMX', null, 'Sacar pasajes con anticipación', null, false),
    ('23fb65d1-9479-4455-8908-b664f7b70819'::uuid, 'Montevideo', 'Uruguay', 'América', date '2026-07-15', date '2026-07-22', 'guest_spot', 'finalizado', 'Ink Society', null, 'Split 60/40', 'Buena respuesta, repetir el año que viene', null, false),
    ('a2b43cea-e81f-4ae4-b407-78c0e1c44436'::uuid, 'Lima', 'Perú', 'América', date '2026-05-25', date '2026-06-01', 'guest_spot', 'finalizado', 'Costa Ink Collective', null, 'Split 65/35', null, null, false)
  )
  select count(*) into v_legacy_count
  from expected e
  join public.artist_trips t on t.id = e.id
  where t.artist_user_id = v_artist_user_id
    and t.source_type is null and t.source_id is null
    and t.city = e.city and t.country = e.country
    and t.region is not distinct from e.region
    and t.start_date = e.start_date and t.end_date = e.end_date
    and t.trip_type = e.trip_type and t.status = e.status and t.origin = 'manual'
    and t.studio_name_hint is not distinct from e.studio_name_hint
    and t.event_name is not distinct from e.event_name
    and t.agreed_conditions is not distinct from e.agreed_conditions
    and t.personal_notes is not distinct from e.personal_notes
    and t.share_slug is not distinct from e.share_slug
    and t.share_enabled = e.share_enabled
    and t.interested_people_count = 0 and t.climate_celsius is null
    and t.cancelled_at is null;

  with expected(
    id, source_id, city, country, region, start_date, end_date, trip_type,
    status, studio_name_hint, event_name, agreed_conditions, personal_notes,
    share_slug, share_enabled, interested_people_count, climate_celsius
  ) as (values
    ('9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid, '83000000-0000-4000-a000-000000000001'::uuid, 'Barcelona', 'España', 'europa', date '2026-08-15', date '2026-08-22', 'guest_spot', 'confirmado', 'Zorro Rojo Tattoo', null::text, 'Split 65% para el artista. Agenda garantizada de 5 días, materiales incluidos.', '[PRUEBA][TRAVEL-FIGMA-20260830] Llevar flash sheets nuevos y stencils impresos — la impresora del estudio es lenta.', 'br-zorro-rojo-ago26', true, 12, 28.0::numeric),
    ('83000000-0000-4000-8000-000000000002'::uuid, '83000000-0000-4000-a000-000000000002'::uuid, 'Berlín', 'Alemania', 'europa', date '2026-09-03', date '2026-09-05', 'convencion', 'confirmado', 'Bauhaus Ink Fest', 'Bauhaus Ink Fest', 'Residencia invitada · estación equipada · agenda compartida.', '[PRUEBA][TRAVEL-FIGMA-20260830] Confirmar alojamiento en Kreuzberg.', null, false, 9, 18.0::numeric),
    ('494464fd-9f32-4577-bb52-955c4872480c'::uuid, '83000000-0000-4000-a000-000000000003'::uuid, 'Ciudad de México', 'México', 'norteamerica', date '2026-09-20', date '2026-09-27', 'estudio_invitado', 'pendiente', 'Estudio Cactus', null, 'Pendiente de confirmación del espacio y horarios.', '[PRUEBA][TRAVEL-FIGMA-20260830] Sacar pasajes con anticipación.', null, false, 21, 23.0::numeric),
    ('9c7d45da-ef3e-4f0c-85cc-061ec5af166c'::uuid, '83000000-0000-4000-a000-000000000004'::uuid, 'Madrid', 'España', 'europa', date '2026-10-10', date '2026-10-14', 'guest_spot', 'pendiente', 'Madrid Ink Studio', null, 'Pendiente de confirmación final del estudio.', '[PRUEBA][TRAVEL-FIGMA-20260830] Confirmar fechas con el estudio.', null, false, 8, 25.0::numeric),
    ('83000000-0000-4000-8000-000000000005'::uuid, '83000000-0000-4000-a000-000000000005'::uuid, 'Santiago', 'Chile', 'sudamerica', date '2026-11-02', date '2026-11-04', 'convencion', 'pendiente', 'Congreso Sudamericano de Tatuaje', 'Congreso Sudamericano de Tatuaje', 'Solicitud enviada · esperando confirmación del estudio.', '[PRUEBA][TRAVEL-FIGMA-20260830] Coordinar agenda de diseños geométricos.', null, false, 6, 20.0::numeric),
    ('23fb65d1-9479-4455-8908-b664f7b70819'::uuid, '83000000-0000-4000-a000-000000000006'::uuid, 'Montevideo', 'Uruguay', 'sudamerica', date '2026-06-20', date '2026-06-22', 'guest_spot', 'finalizado', 'Ink Society', null, 'Guest spot completado · liquidación cerrada.', '[PRUEBA][TRAVEL-FIGMA-20260830] Buena respuesta, repetir el año que viene.', null, false, 11, 17.0::numeric),
    ('a2b43cea-e81f-4ae4-b407-78c0e1c44436'::uuid, '83000000-0000-4000-a000-000000000007'::uuid, 'Lima', 'Perú', 'sudamerica', date '2026-06-05', date '2026-06-07', 'guest_spot', 'finalizado', 'Lima Tinta Studio', null, 'Guest spot completado · documentación archivada.', '[PRUEBA][TRAVEL-FIGMA-20260830] Viaje finalizado y conciliado.', null, false, 7, 22.0::numeric),
    ('83000000-0000-4000-8000-000000000008'::uuid, '83000000-0000-4000-a000-000000000008'::uuid, 'Barcelona', 'España', 'europa', date '2025-12-05', date '2025-12-07', 'convencion', 'finalizado', 'Barcelona Tattoo Expo', 'Barcelona Tattoo Expo', 'Convención finalizada · contactos archivados.', '[PRUEBA][TRAVEL-FIGMA-20260830] Seguimiento comercial terminado.', null, false, 15, 18.0::numeric)
  )
  select count(*) into v_demo_count
  from expected e
  join public.artist_trips t on t.id = e.id
  where t.artist_user_id = v_artist_user_id
    and t.source_type = 'demo' and t.source_id = e.source_id
    and t.city = e.city and t.country = e.country and t.region = e.region
    and t.start_date = e.start_date and t.end_date = e.end_date
    and t.trip_type = e.trip_type and t.status = e.status and t.origin = 'manual'
    and t.studio_name_hint is not distinct from e.studio_name_hint
    and t.event_name is not distinct from e.event_name
    and t.agreed_conditions is not distinct from e.agreed_conditions
    and t.personal_notes is not distinct from e.personal_notes
    and t.share_slug is not distinct from e.share_slug
    and t.share_enabled = e.share_enabled
    and t.interested_people_count = e.interested_people_count
    and t.climate_celsius is not distinct from e.climate_celsius
    and t.cancelled_at is null;

  if v_legacy_count = 5 and v_demo_count = 0
     and (select count(*) from public.artist_trips t
          where t.artist_user_id=v_artist_user_id) = 6
     and not exists (
    select 1 from public.artist_trips t
    where t.id in (
      '83000000-0000-4000-8000-000000000002'::uuid,
      '83000000-0000-4000-8000-000000000005'::uuid,
      '83000000-0000-4000-8000-000000000008'::uuid
    )
  ) then
    v_mode := 'legacy';
  elsif v_legacy_count = 0 and v_demo_count = 8
        and (select count(*) from public.artist_trips t
             where t.artist_user_id=v_artist_user_id) = 8 then
    v_mode := 'demo';
  else
    raise exception 'Travel fixture parents are missing, mixed or edited; aborting safely (legacy %, demo %)', v_legacy_count, v_demo_count;
  end if;

  -- A fixed source UUID cannot silently point at a different row.
  if exists (
    select 1
    from public.artist_trips t
    join (values
      ('9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid, '83000000-0000-4000-a000-000000000001'::uuid),
      ('83000000-0000-4000-8000-000000000002'::uuid, '83000000-0000-4000-a000-000000000002'::uuid),
      ('494464fd-9f32-4577-bb52-955c4872480c'::uuid, '83000000-0000-4000-a000-000000000003'::uuid),
      ('9c7d45da-ef3e-4f0c-85cc-061ec5af166c'::uuid, '83000000-0000-4000-a000-000000000004'::uuid),
      ('83000000-0000-4000-8000-000000000005'::uuid, '83000000-0000-4000-a000-000000000005'::uuid),
      ('23fb65d1-9479-4455-8908-b664f7b70819'::uuid, '83000000-0000-4000-a000-000000000006'::uuid),
      ('a2b43cea-e81f-4ae4-b407-78c0e1c44436'::uuid, '83000000-0000-4000-a000-000000000007'::uuid),
      ('83000000-0000-4000-8000-000000000008'::uuid, '83000000-0000-4000-a000-000000000008'::uuid)
    ) expected(id, source_id)
      on expected.source_id = t.source_id
    where t.source_type = 'demo' and t.id <> expected.id
  ) then
    raise exception 'A Travel demo source UUID is already bound to a different row';
  end if;

  -- The studio-link upsert is keyed by (source_type, source_id). Guard every
  -- reserved source UUID before any DML so it cannot repoint an unrelated row
  -- whose source key happens to collide with this fixture.
  if exists (
    select 1
    from public.trip_studio_links l
    join (values
      ('a6d1a848-7ec6-4dd2-9ea6-15592ed262ad'::uuid, '83400000-0000-4000-a000-000000000001'::uuid),
      ('83400000-0000-4000-8000-000000000009'::uuid, '83400000-0000-4000-a000-000000000009'::uuid),
      ('83400000-0000-4000-8000-000000000002'::uuid, '83400000-0000-4000-a000-000000000002'::uuid),
      ('83400000-0000-4000-8000-000000000003'::uuid, '83400000-0000-4000-a000-000000000003'::uuid),
      ('24f2516b-e655-4b8d-8974-0db2b68c8c24'::uuid, '83400000-0000-4000-a000-000000000004'::uuid),
      ('83400000-0000-4000-8000-000000000005'::uuid, '83400000-0000-4000-a000-000000000005'::uuid),
      ('c9ab6c10-0cf9-4f7e-8538-22e3a04a9b83'::uuid, '83400000-0000-4000-a000-000000000006'::uuid),
      ('c96c06e7-ccd7-4de0-a157-530c4cff187f'::uuid, '83400000-0000-4000-a000-000000000007'::uuid),
      ('83400000-0000-4000-8000-000000000008'::uuid, '83400000-0000-4000-a000-000000000008'::uuid)
    ) expected(id, source_id)
      on l.source_type = 'demo' and l.source_id = expected.source_id
    where l.id <> expected.id
  ) then
    raise exception 'Reserved Travel studio-link demo source UUID is already bound to a different fixed row';
  end if;

  -- Retiring the automatic invitation trip must also retire the exact Inbox
  -- graph emitted by trg_inbox_from_trip_studio_link. Accept either the intact
  -- four-row graph (legacy mode, or a rerun repairing the earlier orphan) or no
  -- graph at all on a clean demo rerun. Any partial or repointed identity aborts.
  if exists (
    select 1 from public.inbox_threads t
    where t.id = '1c12be0d-86ef-4a76-8dca-cb5ee1242107'::uuid
       or (t.context_type = 'trip_studio_link'
           and t.context_id = '51648221-a3a6-4e09-8860-492f9777ff88'::uuid)
       or t.context ->> 'trip_id' = '4bc33e15-b315-4908-a0c0-fe47cbde32f5'
    union all
    select 1 from public.inbox_messages m
    where m.id = '1948b9ee-149f-477d-9cf0-f4837b5f9e01'::uuid
    union all
    select 1 from public.inbox_thread_activity a
    where a.id = '99af2d82-524d-462a-a8ae-668959b0de71'::uuid
  ) then
    if not exists (
      select 1 from public.inbox_threads t
      where t.id = '1c12be0d-86ef-4a76-8dca-cb5ee1242107'::uuid
        and t.artist_user_id = v_artist_user_id
        and t.category = 'trips'
        and t.context_type = 'trip_studio_link'
        and t.context_id = '51648221-a3a6-4e09-8860-492f9777ff88'::uuid
        and t.counterparty_user_id is null
        and t.counterparty_name = 'Zorro Rojo Tattoo'
        and t.counterparty_initials = 'ZO'
        and t.subject = 'Viaje a Barcelona'
        and t.context = jsonb_build_object(
          'trip_id', '4bc33e15-b315-4908-a0c0-fe47cbde32f5'::uuid,
          'city', 'Barcelona', 'country', 'España',
          'start_date', date '2026-08-01', 'end_date', date '2026-08-07',
          'studio_id', '32bfbe77-09fc-4c50-a5b6-68d4edceb90d'::uuid,
          'studio_name', 'Zorro Rojo Tattoo', 'link_status', 'confirmada'
        )
        and t.status = 'open' and t.is_priority = false
        and t.last_message = 'El estudio confirmó la vinculación. El viaje ya puede aparecer en tu perfil público.'
        and t.last_message_at = timestamptz '2026-08-30 07:21:29.706329+00'
        and t.last_sender_user_id is null
        and t.created_at = timestamptz '2026-08-30 07:21:29.706329+00'
        and t.updated_at = timestamptz '2026-08-30 07:21:29.706329+00'
        and (select count(*) from public.inbox_thread_participants p where p.thread_id = t.id) = 1
        and exists (
          select 1 from public.inbox_thread_participants p
          where p.thread_id = t.id and p.user_id = v_artist_user_id
            and p.participant_role = 'artist'
            and p.last_read_at = timestamptz '2026-08-30 07:21:29.706329+00'
            and p.is_favorite = false and p.is_archived = false
            and p.joined_at = timestamptz '2026-08-30 07:21:29.706329+00'
        )
        and (select count(*) from public.inbox_messages m where m.thread_id = t.id) = 1
        and exists (
          select 1 from public.inbox_messages m
          where m.id = '1948b9ee-149f-477d-9cf0-f4837b5f9e01'::uuid
            and m.thread_id = t.id and m.sender_user_id is null
            and m.sender_role = 'system'
            and m.body = 'El estudio confirmó la vinculación. El viaje ya puede aparecer en tu perfil público.'
            and m.message_kind = 'system'
            and m.attachment_path is null and m.attachment_name is null
            and m.attachment_mime is null and m.attachment_size is null
            and m.client_nonce is null
            and m.created_at = timestamptz '2026-08-30 07:21:29.706329+00'
        )
        and (select count(*) from public.inbox_thread_activity a where a.thread_id = t.id) = 1
        and exists (
          select 1 from public.inbox_thread_activity a
          where a.id = '99af2d82-524d-462a-a8ae-668959b0de71'::uuid
            and a.thread_id = t.id and a.actor_user_id is null
            and a.event_type = 'message_sent'
            and a.metadata = jsonb_build_object(
              'kind', 'system',
              'message_id', '1948b9ee-149f-477d-9cf0-f4837b5f9e01'::uuid
            )
            and a.created_at = timestamptz '2026-08-30 07:21:29.706329+00'
        )
    ) then
      raise exception 'Automatic invitation Inbox graph differs from the exact thread';
    end if;
  elsif v_mode = 'legacy' then
    raise exception 'Automatic invitation Inbox graph differs from the exact thread';
  end if;

  if v_mode = 'legacy' then
    -- Live preflight captured 2026-08-30. Checklist/event row UUIDs and creation
    -- timestamps are ignored; stable link IDs and their reversible fields are exact.
    if exists (
      with expected(label, is_done, is_custom, sort_order) as (values
        ('Estudio confirmado'::text, true, false, 0),
        ('Pasajes comprados', true, false, 1),
        ('Alojamiento reservado', true, false, 2),
        ('Insumos y máquinas', false, false, 3),
        ('Agenda publicada', false, false, 4),
        ('Anticipos cobrados', false, false, 5),
        ('Seguro de viaje', false, false, 6),
        ('Documentación al día', false, false, 7),
        ('Cambio de moneda', false, false, 8),
        ('Contenido para redes', false, false, 9),
        ('Comprar pasajes', true, false, 1),
        ('Confirmar estudio', true, false, 2),
        ('Preparar insumos', false, false, 3),
        ('Publicar agenda del viaje', false, true, 4)
      )
      select 1 from expected e
      where (
        select count(*) from public.trip_checklist_items i
        where i.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
          and i.label = e.label and i.is_done = e.is_done
          and i.is_custom = e.is_custom and i.sort_order = e.sort_order
      ) <> 1
      union all
      select 1 from public.trip_checklist_items i
      where i.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
        and not exists (
          select 1 from expected e
          where e.label = i.label and e.is_done = i.is_done
            and e.is_custom = i.is_custom and e.sort_order = i.sort_order
        )
    ) then
      raise exception 'Legacy Barcelona checklist differs from the exact 14-row live fixture';
    end if;

    if exists (
      with expected(event_type, detail, event_date) as (values
        ('creado'::text, 'Viaje agregado al itinerario'::text, date '2026-08-09'),
        ('estudio_confirmado', 'El estudio confirmó las fechas', date '2026-08-17'),
        ('creado', 'Viaje demo creado', date '2026-08-20'),
        ('estudio_confirmado', 'Zorro Rojo Tattoo confirmó el guest spot', date '2026-08-24'),
        ('nota', 'Agenda de Barcelona abierta', date '2026-08-28')
      )
      select 1 from expected e
      where (
        select count(*) from public.trip_events x
        where x.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
          and x.event_type = e.event_type and x.detail is not distinct from e.detail
          and x.event_date = e.event_date
      ) <> 1
      union all
      select 1 from public.trip_events x
      where x.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
        and not exists (
          select 1 from expected e
          where e.event_type = x.event_type and e.detail is not distinct from x.detail
            and e.event_date = x.event_date
        )
    ) then
      raise exception 'Legacy Barcelona events differ from the exact five-row live fixture';
    end if;

    if exists (
      select 1 from public.trip_documents d
      where d.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
    ) then
      raise exception 'Legacy Barcelona unexpectedly has documents; aborting before replacement';
    end if;

    if exists (
      with expected(
        id, trip_id, studio_id, studio_name, studio_city, status,
        requested_at, resolved_at
      ) as (values
        ('a0d9a6fa-004b-4344-b20e-43f31c33a143'::uuid, '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid, 'e3aa7f17-42f8-469a-a41c-edd9ef1e8999'::uuid, 'Sang Bleu London'::text, 'London'::text, 'confirmada'::text, timestamptz '2026-08-19 03:40:13.985252+00', timestamptz '2026-08-23 03:40:13.985252+00'),
        ('a6d1a848-7ec6-4dd2-9ea6-15592ed262ad'::uuid, '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid, null, 'Zorro Rojo Tattoo', 'Barcelona', 'confirmada', timestamptz '2026-08-29 02:50:21.915353+00', timestamptz '2026-08-24 02:50:21.915353+00'),
        ('24f2516b-e655-4b8d-8974-0db2b68c8c24'::uuid, '9c7d45da-ef3e-4f0c-85cc-061ec5af166c'::uuid, null, 'La Nave Tattoo', 'Madrid', 'esperando_confirmacion', timestamptz '2026-08-29 02:50:21.915353+00', null),
        ('c9ab6c10-0cf9-4f7e-8538-22e3a04a9b83'::uuid, '23fb65d1-9479-4455-8908-b664f7b70819'::uuid, null, 'Ink Society', 'Montevideo', 'confirmada', timestamptz '2026-08-29 02:50:21.915353+00', timestamptz '2026-08-24 02:50:21.915353+00'),
        ('c96c06e7-ccd7-4de0-a157-530c4cff187f'::uuid, 'a2b43cea-e81f-4ae4-b407-78c0e1c44436'::uuid, null, 'Costa Ink Collective', 'Lima', 'confirmada', timestamptz '2026-08-29 02:50:21.915353+00', timestamptz '2026-08-24 02:50:21.915353+00')
      )
      select 1 from expected e
      where (
        select count(*) from public.trip_studio_links l
        where l.id = e.id and l.trip_id = e.trip_id
          and l.studio_id is not distinct from e.studio_id
          and l.studio_name = e.studio_name and l.studio_city = e.studio_city
          and l.status = e.status and l.requested_at = e.requested_at
          and l.resolved_at is not distinct from e.resolved_at
          and l.requested_by_user_id = 'e5e3be81-784d-469c-bb86-13952f2a0c08'::uuid
          and l.resolved_by_user_id is null
          and l.source_type is null and l.source_id is null
          and l.contact_name is null and l.contact_details is null
          and l.address_snapshot is null
      ) <> 1
      union all
      select 1 from public.trip_studio_links l
      where l.trip_id in (
        '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid,
        '9c7d45da-ef3e-4f0c-85cc-061ec5af166c'::uuid,
        '494464fd-9f32-4577-bb52-955c4872480c'::uuid,
        '23fb65d1-9479-4455-8908-b664f7b70819'::uuid,
        'a2b43cea-e81f-4ae4-b407-78c0e1c44436'::uuid
      ) and not exists (
        select 1 from expected e
          where e.id = l.id and e.trip_id = l.trip_id
      )
    ) then
      raise exception 'Legacy Travel links differ from the exact five-row live fixture';
    end if;

    -- The migration backfill created one automatic Zorro Rojo trip. Retire it
    -- only when its complete post-migration graph is byte-for-byte recognizable;
    -- rollback below restores the same fixed IDs and timestamps.
    if not exists (
      select 1 from public.artist_trips t
      where t.id = '4bc33e15-b315-4908-a0c0-fe47cbde32f5'::uuid
        and t.artist_user_id = v_artist_user_id
        and t.city = 'Barcelona' and t.country = 'España' and t.region is null
        and t.start_date = date '2026-08-01' and t.end_date = date '2026-08-07'
        and t.trip_type = 'estudio_invitado' and t.status = 'confirmado'
        and t.origin = 'automatico' and t.studio_name_hint = 'Zorro Rojo Tattoo'
        and t.event_name is null
        and t.agreed_conditions = 'Split 65.00% para el artista.'
        and t.personal_notes is null and t.share_slug is null
        and t.share_enabled = false and t.cancelled_at is null
        and t.interested_people_count = 0 and t.climate_celsius is null
        and t.source_type = 'studio_invitation'
        and t.source_id = '5df457e1-f3f4-42ef-98da-6168e742d7c5'::uuid
        and t.created_at = timestamptz '2026-08-30 07:21:29.706329+00'
        and t.updated_at = timestamptz '2026-08-30 07:21:29.706329+00'
    ) then
      raise exception 'Automatic invitation trip differs from the exact post-migration parent';
    end if;

    if exists (
      with expected(id,label,is_done,sort_order) as (values
        ('332a3cb5-dcae-4b54-ade9-ac34b419e95b'::uuid,'Pasajes comprados'::text,false,0),
        ('53e949f7-83aa-4e42-93c4-c6fcc8694b88'::uuid,'Hospedaje reservado',false,1),
        ('3bdf2685-def7-448f-afcb-d8e92da5a0b8'::uuid,'Estudio confirmado',true,2),
        ('b7e3247d-088d-40ed-a780-bf694fe98c4d'::uuid,'Contacté al estudio',true,3),
        ('666771e6-d23b-469f-b012-e41f45c33aed'::uuid,'Agenda recibida',false,4),
        ('cd500197-5388-4f96-a515-dcefdd32c8ed'::uuid,'Equipos preparados',false,5),
        ('a13cf27d-01a6-47f2-85a9-553c239514b2'::uuid,'Materiales de trabajo listos',false,6),
        ('02022f35-70f1-45dd-af2f-1289a0d638bb'::uuid,'Documentación preparada',false,7),
        ('a0334331-fd54-43cf-a286-f26da561d55e'::uuid,'Seguro de viaje',false,8),
        ('2c598eca-1cae-4e2e-8c85-b91da2aa9b4c'::uuid,'Equipaje listo',false,9)
      )
      select 1 from expected x where not exists (
        select 1 from public.trip_checklist_items i
        where i.id=x.id and i.trip_id='4bc33e15-b315-4908-a0c0-fe47cbde32f5'::uuid
          and i.label=x.label and i.is_done=x.is_done and i.is_custom=false
          and i.sort_order=x.sort_order and i.source_type is null and i.source_id is null
          and i.created_at=timestamptz '2026-08-30 07:21:29.706329+00'
      )
      union all
      select 1 from public.trip_checklist_items i
      where i.trip_id='4bc33e15-b315-4908-a0c0-fe47cbde32f5'::uuid
        and not exists (select 1 from expected x where x.id=i.id)
    ) then
      raise exception 'Automatic invitation checklist differs from the exact ten-row graph';
    end if;

    if exists (
      with expected(id,event_type,detail) as (values
        ('e93caafd-4671-4595-96f0-cab95ab4226d'::uuid,'creado'::text,'Viaje creado desde una invitación aceptada'::text),
        ('65ab0217-9612-4849-b26e-e13c6e7ab978'::uuid,'estudio_confirmado','Zorro Rojo Tattoo')
      )
      select 1 from expected x where not exists (
        select 1 from public.trip_events e
        where e.id=x.id and e.trip_id='4bc33e15-b315-4908-a0c0-fe47cbde32f5'::uuid
          and e.event_type=x.event_type and e.detail=x.detail
          and e.event_date=date '2026-08-30'
          and e.created_at=timestamptz '2026-08-30 07:21:29.706329+00'
          and e.source_type is null and e.source_id is null
      )
      union all
      select 1 from public.trip_events e
      where e.trip_id='4bc33e15-b315-4908-a0c0-fe47cbde32f5'::uuid
        and not exists (select 1 from expected x where x.id=e.id)
    ) then
      raise exception 'Automatic invitation events differ from the exact two-row graph';
    end if;

    if exists (
      select 1 from public.trip_documents d
      where d.trip_id='4bc33e15-b315-4908-a0c0-fe47cbde32f5'::uuid
    ) then
      raise exception 'Automatic invitation trip unexpectedly has documents';
    end if;

    if not exists (
      select 1 from public.trip_studio_links l
      where l.id='51648221-a3a6-4e09-8860-492f9777ff88'::uuid
        and l.trip_id='4bc33e15-b315-4908-a0c0-fe47cbde32f5'::uuid
        and l.studio_id='32bfbe77-09fc-4c50-a5b6-68d4edceb90d'::uuid
        and l.studio_name='Zorro Rojo Tattoo' and l.studio_city='Barcelona'
        and l.status='confirmada'
        and l.requested_at=timestamptz '2026-08-30 07:21:29.706329+00'
        and l.resolved_at=timestamptz '2026-08-30 07:21:29.706329+00'
        and l.requested_by_user_id='e5e3be81-784d-469c-bb86-13952f2a0c08'::uuid
        and l.resolved_by_user_id is null
        and l.source_type='studio_invitation'
        and l.source_id='5df457e1-f3f4-42ef-98da-6168e742d7c5'::uuid
        and l.updated_at=timestamptz '2026-08-30 07:21:29.706329+00'
        and l.contact_name is null and l.contact_details is null
        and l.address_snapshot is null
        and not exists (
          select 1 from public.trip_studio_links other
          where other.trip_id=l.trip_id and other.id<>l.id
        )
    ) then
      raise exception 'Automatic invitation studio link differs from the exact graph';
    end if;

    if not exists (
      select 1 from public.trip_studio_link_audit a
      where a.id='5b2a8aa4-896a-4bec-913f-e589f06d4c3b'::uuid
        and a.link_id='51648221-a3a6-4e09-8860-492f9777ff88'::uuid
        and a.trip_id='4bc33e15-b315-4908-a0c0-fe47cbde32f5'::uuid
        and a.actor_user_id is null and a.old_status is null
        and a.new_status='confirmada' and a.source='studio_invitation'
        and a.created_at=timestamptz '2026-08-30 07:21:29.706329+00'
        and not exists (
          select 1 from public.trip_studio_link_audit other
          where other.link_id=a.link_id and other.id<>a.id
        )
    ) then
      raise exception 'Automatic invitation link audit differs from the exact graph';
    end if;

    delete from public.inbox_threads t
    where t.id = '1c12be0d-86ef-4a76-8dca-cb5ee1242107'::uuid;
    get diagnostics v_deleted_count = row_count;
    if v_deleted_count <> 1 then
      raise exception 'Automatic invitation Inbox thread was not retired exactly once';
    end if;

    delete from public.artist_trips t
    where t.id='4bc33e15-b315-4908-a0c0-fe47cbde32f5'::uuid
      and t.source_type='studio_invitation'
      and t.source_id='5df457e1-f3f4-42ef-98da-6168e742d7c5'::uuid;
    get diagnostics v_deleted_count = row_count;
    if v_deleted_count <> 1 then
      raise exception 'Automatic invitation trip was not retired exactly once';
    end if;

    delete from public.trip_checklist_items i
    where i.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid;
    delete from public.trip_events e
    where e.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid;
    -- Reuse the four visible legacy links in place so their stable IDs and audit
    -- history survive. The bulk source-key upsert below supplies the demo fields.
    update public.trip_studio_links l
    set source_type = 'demo', source_id = x.source_id
    from (values
      ('a6d1a848-7ec6-4dd2-9ea6-15592ed262ad'::uuid, '83400000-0000-4000-a000-000000000001'::uuid),
      ('24f2516b-e655-4b8d-8974-0db2b68c8c24'::uuid, '83400000-0000-4000-a000-000000000004'::uuid),
      ('c9ab6c10-0cf9-4f7e-8538-22e3a04a9b83'::uuid, '83400000-0000-4000-a000-000000000006'::uuid),
      ('c96c06e7-ccd7-4de0-a157-530c4cff187f'::uuid, '83400000-0000-4000-a000-000000000007'::uuid)
    ) x(id, source_id)
    where l.id = x.id;

    -- Sang Bleu remains as an unmarked archived row instead of being deleted.
    update public.trip_studio_links l
    set status = 'rechazada'
    where l.id = 'a0d9a6fa-004b-4344-b20e-43f31c33a143'::uuid;
  else
    -- Reruns accept only the exact demo-owned Barcelona detail graph and link
    -- identities. Any manual/unrecognized child aborts instead of being erased.
    if exists (
      select 1 from public.artist_trips t
      where t.id='4bc33e15-b315-4908-a0c0-fe47cbde32f5'::uuid
         or (t.source_type='studio_invitation'
             and t.source_id='5df457e1-f3f4-42ef-98da-6168e742d7c5'::uuid)
    ) then
      raise exception 'Automatic invitation trip unexpectedly exists in demo rerun state';
    end if;

    -- A prior version retired the automatic Travel graph but left its Inbox
    -- thread behind. The exact-graph preflight above makes this repair safe and
    -- keeps subsequent reruns idempotent.
    delete from public.inbox_threads t
    where t.id = '1c12be0d-86ef-4a76-8dca-cb5ee1242107'::uuid;

    if exists (
      with expected(id, source_id, label, is_done, sort_order) as (values
        ('83100000-0000-4000-8000-000000000001'::uuid, '83100000-0000-4000-a000-000000000001'::uuid, 'Pasajes comprados'::text, true, 0),
        ('83100000-0000-4000-8000-000000000002'::uuid, '83100000-0000-4000-a000-000000000002'::uuid, 'Hospedaje reservado', true, 1),
        ('83100000-0000-4000-8000-000000000003'::uuid, '83100000-0000-4000-a000-000000000003'::uuid, 'Estudio confirmado', false, 2),
        ('83100000-0000-4000-8000-000000000004'::uuid, '83100000-0000-4000-a000-000000000004'::uuid, 'Contacté al estudio', true, 3),
        ('83100000-0000-4000-8000-000000000005'::uuid, '83100000-0000-4000-a000-000000000005'::uuid, 'Agenda recibida', false, 4),
        ('83100000-0000-4000-8000-000000000006'::uuid, '83100000-0000-4000-a000-000000000006'::uuid, 'Equipos preparados', false, 5),
        ('83100000-0000-4000-8000-000000000007'::uuid, '83100000-0000-4000-a000-000000000007'::uuid, 'Materiales de trabajo listos', false, 6),
        ('83100000-0000-4000-8000-000000000008'::uuid, '83100000-0000-4000-a000-000000000008'::uuid, 'Documentación preparada', false, 7),
        ('83100000-0000-4000-8000-000000000009'::uuid, '83100000-0000-4000-a000-000000000009'::uuid, 'Seguro de viaje', false, 8),
        ('83100000-0000-4000-8000-000000000010'::uuid, '83100000-0000-4000-a000-000000000010'::uuid, 'Equipaje listo', false, 9)
      )
      select 1 from expected x
      where not exists (
        select 1 from public.trip_checklist_items i
        where i.id = x.id and i.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
          and i.source_type = 'demo' and i.source_id = x.source_id
          and i.label = x.label and i.is_done = x.is_done and i.is_custom = false
          and i.sort_order = x.sort_order
      )
      union all
      select 1 from public.trip_checklist_items i
      where i.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
        and not exists (select 1 from expected x where x.id = i.id and x.source_id = i.source_id)
    ) then
      raise exception 'Demo Barcelona checklist contains missing, edited or unrecognized rows';
    end if;

    if exists (
      with expected(id, source_id) as (values
        ('83200000-0000-4000-8000-000000000001'::uuid, '83200000-0000-4000-a000-000000000001'::uuid),
        ('83200000-0000-4000-8000-000000000002'::uuid, '83200000-0000-4000-a000-000000000002'::uuid),
        ('83200000-0000-4000-8000-000000000003'::uuid, '83200000-0000-4000-a000-000000000003'::uuid)
      )
      select 1 from expected x where not exists (
        select 1 from public.trip_documents d
        where d.id = x.id and d.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
          and d.source_type = 'demo' and d.source_id = x.source_id
      )
      union all
      select 1 from public.trip_documents d
      where d.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
        and not exists (select 1 from expected x where x.id = d.id and x.source_id = d.source_id)
    ) then
      raise exception 'Demo Barcelona documents contain missing or unrecognized rows';
    end if;

    if exists (
      with expected(id, source_id) as (values
        ('83300000-0000-4000-8000-000000000001'::uuid, '83300000-0000-4000-a000-000000000001'::uuid),
        ('83300000-0000-4000-8000-000000000002'::uuid, '83300000-0000-4000-a000-000000000002'::uuid),
        ('83300000-0000-4000-8000-000000000003'::uuid, '83300000-0000-4000-a000-000000000003'::uuid),
        ('83300000-0000-4000-8000-000000000004'::uuid, '83300000-0000-4000-a000-000000000004'::uuid),
        ('83300000-0000-4000-8000-000000000005'::uuid, '83300000-0000-4000-a000-000000000005'::uuid)
      )
      select 1 from expected x where not exists (
        select 1 from public.trip_events e
        where e.id = x.id and e.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
          and e.source_type = 'demo' and e.source_id = x.source_id
      )
      union all
      select 1 from public.trip_events e
      where e.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
        and not exists (select 1 from expected x where x.id = e.id and x.source_id = e.source_id)
    ) then
      raise exception 'Demo Barcelona events contain missing or unrecognized rows';
    end if;

    if exists (
      with expected(id, source_type, source_id, trip_id, studio_name, status) as (values
        ('a6d1a848-7ec6-4dd2-9ea6-15592ed262ad'::uuid, 'demo'::text, '83400000-0000-4000-a000-000000000001'::uuid, '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid, 'Zorro Rojo Tattoo'::text, 'esperando_confirmacion'::text),
        ('83400000-0000-4000-8000-000000000009'::uuid, 'demo', '83400000-0000-4000-a000-000000000009'::uuid, '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid, 'Marea Negra Barcelona', 'confirmada'),
        ('83400000-0000-4000-8000-000000000002'::uuid, 'demo', '83400000-0000-4000-a000-000000000002'::uuid, '83000000-0000-4000-8000-000000000002'::uuid, 'Bauhaus Ink Fest', 'confirmada'),
        ('83400000-0000-4000-8000-000000000003'::uuid, 'demo', '83400000-0000-4000-a000-000000000003'::uuid, '494464fd-9f32-4577-bb52-955c4872480c'::uuid, 'Estudio Cactus', 'esperando_confirmacion'),
        ('24f2516b-e655-4b8d-8974-0db2b68c8c24'::uuid, 'demo', '83400000-0000-4000-a000-000000000004'::uuid, '9c7d45da-ef3e-4f0c-85cc-061ec5af166c'::uuid, 'Madrid Ink Studio', 'esperando_confirmacion'),
        ('83400000-0000-4000-8000-000000000005'::uuid, 'demo', '83400000-0000-4000-a000-000000000005'::uuid, '83000000-0000-4000-8000-000000000005'::uuid, 'Congreso Sudamericano de Tatuaje', 'esperando_confirmacion'),
        ('c9ab6c10-0cf9-4f7e-8538-22e3a04a9b83'::uuid, 'demo', '83400000-0000-4000-a000-000000000006'::uuid, '23fb65d1-9479-4455-8908-b664f7b70819'::uuid, 'Ink Society', 'confirmada'),
        ('c96c06e7-ccd7-4de0-a157-530c4cff187f'::uuid, 'demo', '83400000-0000-4000-a000-000000000007'::uuid, 'a2b43cea-e81f-4ae4-b407-78c0e1c44436'::uuid, 'Lima Tinta Studio', 'confirmada'),
        ('83400000-0000-4000-8000-000000000008'::uuid, 'demo', '83400000-0000-4000-a000-000000000008'::uuid, '83000000-0000-4000-8000-000000000008'::uuid, 'Barcelona Tattoo Expo', 'confirmada'),
        ('a0d9a6fa-004b-4344-b20e-43f31c33a143'::uuid, null, null::uuid, '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid, 'Sang Bleu London', 'rechazada')
      )
      select 1 from expected x where not exists (
        select 1 from public.trip_studio_links l
        where l.id = x.id and l.source_type is not distinct from x.source_type
          and l.source_id is not distinct from x.source_id and l.trip_id = x.trip_id
          and l.studio_name = x.studio_name and l.status = x.status
      )
      union all
      select 1 from public.trip_studio_links l
      where l.trip_id in (
        '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid,
        '83000000-0000-4000-8000-000000000002'::uuid,
        '494464fd-9f32-4577-bb52-955c4872480c'::uuid,
        '9c7d45da-ef3e-4f0c-85cc-061ec5af166c'::uuid,
        '83000000-0000-4000-8000-000000000005'::uuid,
        '23fb65d1-9479-4455-8908-b664f7b70819'::uuid,
        'a2b43cea-e81f-4ae4-b407-78c0e1c44436'::uuid,
        '83000000-0000-4000-8000-000000000008'::uuid
      ) and not exists (
        select 1 from expected x where x.id = l.id
      )
    ) then
      raise exception 'Demo Travel links contain missing or unrecognized rows';
    end if;

    delete from public.trip_checklist_items i
    where i.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
      and i.source_type = 'demo'
      and i.source_id in (
        '83100000-0000-4000-a000-000000000001'::uuid,
        '83100000-0000-4000-a000-000000000002'::uuid,
        '83100000-0000-4000-a000-000000000003'::uuid,
        '83100000-0000-4000-a000-000000000004'::uuid,
        '83100000-0000-4000-a000-000000000005'::uuid,
        '83100000-0000-4000-a000-000000000006'::uuid,
        '83100000-0000-4000-a000-000000000007'::uuid,
        '83100000-0000-4000-a000-000000000008'::uuid,
        '83100000-0000-4000-a000-000000000009'::uuid,
        '83100000-0000-4000-a000-000000000010'::uuid
      );
    delete from public.trip_documents d
    where d.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
      and d.source_type = 'demo'
      and d.source_id in (
        '83200000-0000-4000-a000-000000000001'::uuid,
        '83200000-0000-4000-a000-000000000002'::uuid,
        '83200000-0000-4000-a000-000000000003'::uuid
      );
    delete from public.trip_events e
    where e.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
      and e.source_type = 'demo'
      and e.source_id in (
        '83300000-0000-4000-a000-000000000001'::uuid,
        '83300000-0000-4000-a000-000000000002'::uuid,
        '83300000-0000-4000-a000-000000000003'::uuid,
        '83300000-0000-4000-a000-000000000004'::uuid,
        '83300000-0000-4000-a000-000000000005'::uuid
      );
  end if;

  -- Passport IDs are reserved just as strictly as trip IDs. A collision never
  -- becomes an upsert against an unrelated historical stamp.
  for r in
    select * from (values
      ('83500000-0000-4000-8000-000000000001'::uuid, '83500000-0000-4000-a000-000000000001'::uuid),
      ('83500000-0000-4000-8000-000000000002'::uuid, '83500000-0000-4000-a000-000000000002'::uuid),
      ('83500000-0000-4000-8000-000000000003'::uuid, '83500000-0000-4000-a000-000000000003'::uuid)
    ) as stamp(id, source_id)
  loop
    if exists (
      select 1
      from public.artist_travel_passport_stamps p
      where p.id = r.id
        and not (
          p.artist_user_id = v_artist_user_id
          and p.source_type = 'demo'
          and p.source_id = r.source_id
        )
    ) then
      raise exception 'Reserved Travel Passport demo UUID % is already in use', r.id;
    end if;
  end loop;

  if exists (
    select 1
    from public.artist_travel_passport_stamps p
    join (values
      ('83500000-0000-4000-8000-000000000001'::uuid, '83500000-0000-4000-a000-000000000001'::uuid),
      ('83500000-0000-4000-8000-000000000002'::uuid, '83500000-0000-4000-a000-000000000002'::uuid),
      ('83500000-0000-4000-8000-000000000003'::uuid, '83500000-0000-4000-a000-000000000003'::uuid)
    ) expected(id, source_id) on expected.source_id = p.source_id
    where p.source_type = 'demo' and p.id <> expected.id
  ) then
    raise exception 'A Travel Passport demo source UUID is already bound to a different row';
  end if;
end;
$$;

with target as (
  select a.user_id
  from public.artists_db a
  where lower(a.username) = 'isainazartattoo.wo'
), seed(
  id, source_id, city, country, region, start_date, end_date, trip_type,
  status, studio_name_hint, event_name, agreed_conditions, personal_notes,
  share_slug, share_enabled, interested_people_count, climate_celsius
) as (
  values
    (
      '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid,
      '83000000-0000-4000-a000-000000000001'::uuid,
      'Barcelona', 'España', 'europa', date '2026-08-15', date '2026-08-22',
      'guest_spot', 'confirmado', 'Zorro Rojo Tattoo', null,
      'Split 65% para el artista. Agenda garantizada de 5 días, materiales incluidos.',
      '[PRUEBA][TRAVEL-FIGMA-20260830] Llevar flash sheets nuevos y stencils impresos — la impresora del estudio es lenta.',
      'br-zorro-rojo-ago26', true, 12, 28.0::numeric
    ),
    (
      '83000000-0000-4000-8000-000000000002'::uuid,
      '83000000-0000-4000-a000-000000000002'::uuid,
      'Berlín', 'Alemania', 'europa', date '2026-09-03', date '2026-09-05',
      'convencion', 'confirmado', 'Bauhaus Ink Fest', 'Bauhaus Ink Fest',
      'Residencia invitada · estación equipada · agenda compartida.',
      '[PRUEBA][TRAVEL-FIGMA-20260830] Confirmar alojamiento en Kreuzberg.',
      null, false, 9, 18.0::numeric
    ),
    (
      '494464fd-9f32-4577-bb52-955c4872480c'::uuid,
      '83000000-0000-4000-a000-000000000003'::uuid,
      'Ciudad de México', 'México', 'norteamerica', date '2026-09-20', date '2026-09-27',
      'estudio_invitado', 'pendiente', 'Estudio Cactus', null,
      'Pendiente de confirmación del espacio y horarios.',
      '[PRUEBA][TRAVEL-FIGMA-20260830] Sacar pasajes con anticipación.',
      null, false, 21, 23.0::numeric
    ),
    (
      '9c7d45da-ef3e-4f0c-85cc-061ec5af166c'::uuid,
      '83000000-0000-4000-a000-000000000004'::uuid,
      'Madrid', 'España', 'europa', date '2026-10-10', date '2026-10-14',
      'guest_spot', 'pendiente', 'Madrid Ink Studio', null,
      'Pendiente de confirmación final del estudio.',
      '[PRUEBA][TRAVEL-FIGMA-20260830] Confirmar fechas con el estudio.',
      null, false, 8, 25.0::numeric
    ),
    (
      '83000000-0000-4000-8000-000000000005'::uuid,
      '83000000-0000-4000-a000-000000000005'::uuid,
      'Santiago', 'Chile', 'sudamerica', date '2026-11-02', date '2026-11-04',
      'convencion', 'pendiente', 'Congreso Sudamericano de Tatuaje', 'Congreso Sudamericano de Tatuaje',
      'Solicitud enviada · esperando confirmación del estudio.',
      '[PRUEBA][TRAVEL-FIGMA-20260830] Coordinar agenda de diseños geométricos.',
      null, false, 6, 20.0::numeric
    ),
    (
      '23fb65d1-9479-4455-8908-b664f7b70819'::uuid,
      '83000000-0000-4000-a000-000000000006'::uuid,
      'Montevideo', 'Uruguay', 'sudamerica', date '2026-06-20', date '2026-06-22',
      'guest_spot', 'finalizado', 'Ink Society', null,
      'Guest spot completado · liquidación cerrada.',
      '[PRUEBA][TRAVEL-FIGMA-20260830] Buena respuesta, repetir el año que viene.',
      null, false, 11, 17.0::numeric
    ),
    (
      'a2b43cea-e81f-4ae4-b407-78c0e1c44436'::uuid,
      '83000000-0000-4000-a000-000000000007'::uuid,
      'Lima', 'Perú', 'sudamerica', date '2026-06-05', date '2026-06-07',
      'guest_spot', 'finalizado', 'Lima Tinta Studio', null,
      'Guest spot completado · documentación archivada.',
      '[PRUEBA][TRAVEL-FIGMA-20260830] Viaje finalizado y conciliado.',
      null, false, 7, 22.0::numeric
    ),
    (
      '83000000-0000-4000-8000-000000000008'::uuid,
      '83000000-0000-4000-a000-000000000008'::uuid,
      'Barcelona', 'España', 'europa', date '2025-12-05', date '2025-12-07',
      'convencion', 'finalizado', 'Barcelona Tattoo Expo', 'Barcelona Tattoo Expo',
      'Convención finalizada · contactos archivados.',
      '[PRUEBA][TRAVEL-FIGMA-20260830] Seguimiento comercial terminado.',
      null, false, 15, 18.0::numeric
    )
)
insert into public.artist_trips (
  id, artist_user_id, city, country, region, start_date, end_date,
  trip_type, status, origin, studio_name_hint, event_name,
  agreed_conditions, personal_notes, share_slug, share_enabled,
  interested_people_count, climate_celsius, cancelled_at,
  source_type, source_id, updated_at
)
select
  s.id, t.user_id, s.city, s.country, s.region, s.start_date, s.end_date,
  s.trip_type, s.status, 'manual', s.studio_name_hint, s.event_name,
  s.agreed_conditions, s.personal_notes, s.share_slug, s.share_enabled,
  s.interested_people_count, s.climate_celsius, null,
  'demo', s.source_id, now()
from seed s
cross join target t
on conflict (id) do update set
  artist_user_id = excluded.artist_user_id,
  city = excluded.city,
  country = excluded.country,
  region = excluded.region,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  trip_type = excluded.trip_type,
  status = excluded.status,
  origin = excluded.origin,
  studio_name_hint = excluded.studio_name_hint,
  event_name = excluded.event_name,
  agreed_conditions = excluded.agreed_conditions,
  personal_notes = excluded.personal_notes,
  share_slug = excluded.share_slug,
  share_enabled = excluded.share_enabled,
  interested_people_count = excluded.interested_people_count,
  climate_celsius = excluded.climate_celsius,
  cancelled_at = excluded.cancelled_at,
  source_type = excluded.source_type,
  source_id = excluded.source_id,
  updated_at = now();

-- Tattoo Passport is independent historical data: these are completed tattoo
-- visits, not a lossy aggregation of the eight 2026 trip cards.
with target as (
  select a.user_id
  from public.artists_db a
  where lower(a.username) = 'isainazartattoo.wo'
), stamps(
  id, source_id, city, country, year, tattoo_count, studio_count
) as (
  values
    (
      '83500000-0000-4000-8000-000000000001'::uuid,
      '83500000-0000-4000-a000-000000000001'::uuid,
      'Buenos Aires', 'Argentina', 2025::smallint, 3, 2
    ),
    (
      '83500000-0000-4000-8000-000000000002'::uuid,
      '83500000-0000-4000-a000-000000000002'::uuid,
      'São Paulo', 'Brasil', 2024::smallint, 1, 1
    ),
    (
      '83500000-0000-4000-8000-000000000003'::uuid,
      '83500000-0000-4000-a000-000000000003'::uuid,
      'Bogotá', 'Colombia', 2023::smallint, 2, 2
    )
)
insert into public.artist_travel_passport_stamps (
  id, artist_user_id, city, country, year, tattoo_count, studio_count,
  source_type, source_id, updated_at
)
select
  s.id, t.user_id, s.city, s.country, s.year, s.tattoo_count, s.studio_count,
  'demo', s.source_id, now()
from stamps s
cross join target t
on conflict (id) do update set
  artist_user_id = excluded.artist_user_id,
  city = excluded.city,
  country = excluded.country,
  year = excluded.year,
  tattoo_count = excluded.tattoo_count,
  studio_count = excluded.studio_count,
  source_type = excluded.source_type,
  source_id = excluded.source_id,
  updated_at = now();

-- The preflight above replaced only Barcelona's validated visual children.
-- Studio links are reused/upserted below; none are deleted during APPLY.

-- One coherent studio link per trip, plus the second Barcelona studio required
-- by the hero metric. Contact/address snapshots stay party-private and are
-- intentionally absent from both public Travel projections.
with links(
  id, trip_source_id, link_source_id, studio_slug, studio_name, studio_city,
  status, requested_at, resolved_at, contact_name, contact_details,
  address_snapshot
) as (
  values
    (
      '83400000-0000-4000-8000-000000000001'::uuid,
      '83000000-0000-4000-a000-000000000001'::uuid,
      '83400000-0000-4000-a000-000000000001'::uuid,
      'zorro-rojo-tattoo', 'Zorro Rojo Tattoo', 'Barcelona', 'esperando_confirmacion',
      timestamptz '2026-07-02 10:00:00+00', null,
      'Marc Solé', '+34 611 222 333 · WhatsApp',
      'Carrer del Rec 45, Barcelona'
    ),
    (
      '83400000-0000-4000-8000-000000000009'::uuid,
      '83000000-0000-4000-a000-000000000001'::uuid,
      '83400000-0000-4000-a000-000000000009'::uuid,
      null, 'Marea Negra Barcelona', 'Barcelona', 'confirmada',
      timestamptz '2026-07-03 10:00:00+00', timestamptz '2026-07-10 16:30:00+00',
      'Nuria Vidal', 'nuria@mareanegra.example',
      'Barcelona, España'
    ),
    (
      '83400000-0000-4000-8000-000000000002'::uuid,
      '83000000-0000-4000-a000-000000000002'::uuid,
      '83400000-0000-4000-a000-000000000002'::uuid,
      null, 'Bauhaus Ink Fest', 'Berlín', 'confirmada',
      timestamptz '2026-07-10 09:00:00+00', timestamptz '2026-07-14 12:00:00+00',
      'Lena Vogel', 'lena@bauhausink.example', null
    ),
    (
      '83400000-0000-4000-8000-000000000003'::uuid,
      '83000000-0000-4000-a000-000000000003'::uuid,
      '83400000-0000-4000-a000-000000000003'::uuid,
      'estudio-cactus', 'Estudio Cactus', 'Ciudad de México', 'esperando_confirmacion',
      timestamptz '2026-08-26 14:00:00+00', null, 'Rocío Méndez', 'rocio@estudiocactus.example', null
    ),
    (
      '83400000-0000-4000-8000-000000000004'::uuid,
      '83000000-0000-4000-a000-000000000004'::uuid,
      '83400000-0000-4000-a000-000000000004'::uuid,
      null, 'Madrid Ink Studio', 'Madrid', 'esperando_confirmacion',
      timestamptz '2026-08-27 11:00:00+00', null, 'Alba Martín', 'alba@madridink.example', null
    ),
    (
      '83400000-0000-4000-8000-000000000005'::uuid,
      '83000000-0000-4000-a000-000000000005'::uuid,
      '83400000-0000-4000-a000-000000000005'::uuid,
      null, 'Congreso Sudamericano de Tatuaje', 'Santiago', 'esperando_confirmacion',
      timestamptz '2026-08-28 18:00:00+00', null, 'Tomás Rivas', 'tomas@tierrafirme.example', null
    ),
    (
      '83400000-0000-4000-8000-000000000006'::uuid,
      '83000000-0000-4000-a000-000000000006'::uuid,
      '83400000-0000-4000-a000-000000000006'::uuid,
      null, 'Ink Society', 'Montevideo', 'confirmada',
      timestamptz '2026-05-20 10:00:00+00', timestamptz '2026-05-23 13:00:00+00',
      'Lucía Pereira', 'lucia@inksociety.example', null
    ),
    (
      '83400000-0000-4000-8000-000000000007'::uuid,
      '83000000-0000-4000-a000-000000000007'::uuid,
      '83400000-0000-4000-a000-000000000007'::uuid,
      null, 'Lima Tinta Studio', 'Lima', 'confirmada',
      timestamptz '2026-03-18 10:00:00+00', timestamptz '2026-03-20 15:00:00+00',
      'Diego Salazar', 'diego@limatinta.example', null
    ),
    (
      '83400000-0000-4000-8000-000000000008'::uuid,
      '83000000-0000-4000-a000-000000000008'::uuid,
      '83400000-0000-4000-a000-000000000008'::uuid,
      null, 'Barcelona Tattoo Expo', 'Barcelona', 'confirmada',
      timestamptz '2025-10-20 10:00:00+00', timestamptz '2025-10-22 16:00:00+00',
      'Marina Costa', 'marina@barcelonatattooexpo.example', null
    )
), target as (
  select a.user_id
  from public.artists_db a
  where lower(a.username) = 'isainazartattoo.wo'
)
insert into public.trip_studio_links as existing_link (
  id, trip_id, studio_id, studio_name, studio_city, status,
  requested_at, resolved_at, requested_by_user_id, resolved_by_user_id,
  source_type, source_id, contact_name, contact_details, address_snapshot
)
select
  l.id,
  t.id,
  s.id,
  l.studio_name,
  l.studio_city,
  l.status,
  l.requested_at,
  l.resolved_at,
  a.user_id,
  case when l.status = 'confirmada' then s.user_id else null end,
  'demo',
  l.link_source_id,
  l.contact_name,
  l.contact_details,
  l.address_snapshot
from links l
join public.artist_trips t
  on t.source_type = 'demo' and t.source_id = l.trip_source_id
cross join target a
left join public.studios s on s.slug = l.studio_slug
on conflict (source_type, source_id)
  where source_type is not null and source_id is not null
do update set
  trip_id = excluded.trip_id,
  studio_id = case when existing_link.id in (
    'a6d1a848-7ec6-4dd2-9ea6-15592ed262ad'::uuid,
    '24f2516b-e655-4b8d-8974-0db2b68c8c24'::uuid,
    'c9ab6c10-0cf9-4f7e-8538-22e3a04a9b83'::uuid,
    'c96c06e7-ccd7-4de0-a157-530c4cff187f'::uuid
  ) then existing_link.studio_id else excluded.studio_id end,
  studio_name = excluded.studio_name,
  studio_city = excluded.studio_city,
  status = excluded.status,
  requested_at = case when existing_link.id in (
    'a6d1a848-7ec6-4dd2-9ea6-15592ed262ad'::uuid,
    '24f2516b-e655-4b8d-8974-0db2b68c8c24'::uuid,
    'c9ab6c10-0cf9-4f7e-8538-22e3a04a9b83'::uuid,
    'c96c06e7-ccd7-4de0-a157-530c4cff187f'::uuid
  ) then existing_link.requested_at else excluded.requested_at end,
  resolved_at = case when existing_link.id in (
    'a6d1a848-7ec6-4dd2-9ea6-15592ed262ad'::uuid,
    '24f2516b-e655-4b8d-8974-0db2b68c8c24'::uuid,
    'c9ab6c10-0cf9-4f7e-8538-22e3a04a9b83'::uuid,
    'c96c06e7-ccd7-4de0-a157-530c4cff187f'::uuid
  ) then existing_link.resolved_at else excluded.resolved_at end,
  requested_by_user_id = case when existing_link.id in (
    'a6d1a848-7ec6-4dd2-9ea6-15592ed262ad'::uuid,
    '24f2516b-e655-4b8d-8974-0db2b68c8c24'::uuid,
    'c9ab6c10-0cf9-4f7e-8538-22e3a04a9b83'::uuid,
    'c96c06e7-ccd7-4de0-a157-530c4cff187f'::uuid
  ) then existing_link.requested_by_user_id else excluded.requested_by_user_id end,
  resolved_by_user_id = case when existing_link.id in (
    'a6d1a848-7ec6-4dd2-9ea6-15592ed262ad'::uuid,
    '24f2516b-e655-4b8d-8974-0db2b68c8c24'::uuid,
    'c9ab6c10-0cf9-4f7e-8538-22e3a04a9b83'::uuid,
    'c96c06e7-ccd7-4de0-a157-530c4cff187f'::uuid
  ) then existing_link.resolved_by_user_id else excluded.resolved_by_user_id end,
  contact_name = excluded.contact_name,
  contact_details = excluded.contact_details,
  address_snapshot = excluded.address_snapshot;

-- Barcelona exact detail: ten checklist rows, exactly three complete.
with items(id, source_id, label, is_done, sort_order) as (
  values
    ('83100000-0000-4000-8000-000000000001'::uuid, '83100000-0000-4000-a000-000000000001'::uuid, 'Pasajes comprados', true, 0),
    ('83100000-0000-4000-8000-000000000002'::uuid, '83100000-0000-4000-a000-000000000002'::uuid, 'Hospedaje reservado', true, 1),
    ('83100000-0000-4000-8000-000000000003'::uuid, '83100000-0000-4000-a000-000000000003'::uuid, 'Estudio confirmado', false, 2),
    ('83100000-0000-4000-8000-000000000004'::uuid, '83100000-0000-4000-a000-000000000004'::uuid, 'Contacté al estudio', true, 3),
    ('83100000-0000-4000-8000-000000000005'::uuid, '83100000-0000-4000-a000-000000000005'::uuid, 'Agenda recibida', false, 4),
    ('83100000-0000-4000-8000-000000000006'::uuid, '83100000-0000-4000-a000-000000000006'::uuid, 'Equipos preparados', false, 5),
    ('83100000-0000-4000-8000-000000000007'::uuid, '83100000-0000-4000-a000-000000000007'::uuid, 'Materiales de trabajo listos', false, 6),
    ('83100000-0000-4000-8000-000000000008'::uuid, '83100000-0000-4000-a000-000000000008'::uuid, 'Documentación preparada', false, 7),
    ('83100000-0000-4000-8000-000000000009'::uuid, '83100000-0000-4000-a000-000000000009'::uuid, 'Seguro de viaje', false, 8),
    ('83100000-0000-4000-8000-000000000010'::uuid, '83100000-0000-4000-a000-000000000010'::uuid, 'Equipaje listo', false, 9)
)
insert into public.trip_checklist_items (
  id, trip_id, label, is_done, is_custom, sort_order, source_type, source_id
)
select i.id, t.id, i.label, i.is_done, false, i.sort_order, 'demo', i.source_id
from items i
join public.artist_trips t
  on t.source_type = 'demo'
 and t.source_id = '83000000-0000-4000-a000-000000000001'::uuid;

-- Barcelona exact detail: three private document records.
with docs(id, source_id, category, file_name, relative_path, created_at) as (
  values
    (
      '83200000-0000-4000-8000-000000000001'::uuid,
      '83200000-0000-4000-a000-000000000001'::uuid,
      'pasaje', 'Pasaje_ida_vuelta.pdf', 'travel-figma-20260830/Pasaje_ida_vuelta.pdf',
      timestamptz '2026-06-20 12:00:00+00'
    ),
    (
      '83200000-0000-4000-8000-000000000002'::uuid,
      '83200000-0000-4000-a000-000000000002'::uuid,
      'reserva_hotel', 'Reserva_hotel_barcelona.pdf', 'travel-figma-20260830/Reserva_hotel_barcelona.pdf',
      timestamptz '2026-06-25 12:00:00+00'
    ),
    (
      '83200000-0000-4000-8000-000000000003'::uuid,
      '83200000-0000-4000-a000-000000000003'::uuid,
      'contrato', 'Acuerdo_costa_ink.pdf', 'travel-figma-20260830/Acuerdo_costa_ink.pdf',
      timestamptz '2026-07-02 12:00:00+00'
    )
), target as (
  select a.user_id
  from public.artists_db a
  where lower(a.username) = 'isainazartattoo.wo'
)
insert into public.trip_documents (
  id, trip_id, category, file_name, storage_path, created_at, source_type, source_id
)
select d.id, t.id, d.category, d.file_name,
       a.user_id::text || '/' || d.relative_path, d.created_at, 'demo', d.source_id
from docs d
cross join target a
cross join public.artist_trips t
where t.source_type = 'demo'
  and t.source_id = '83000000-0000-4000-a000-000000000001'::uuid;

-- Barcelona exact detail: five persisted timeline events.
with events(id, source_id, event_type, detail, event_date, created_at) as (
  values
    (
      '83300000-0000-4000-8000-000000000001'::uuid,
      '83300000-0000-4000-a000-000000000001'::uuid,
      'creado', 'Viaje demo creado', date '2026-07-02', timestamptz '2026-07-02 10:00:00+00'
    ),
    (
      '83300000-0000-4000-8000-000000000002'::uuid,
      '83300000-0000-4000-a000-000000000002'::uuid,
      'estudio_confirmado', 'Zorro Rojo Tattoo confirmó el guest spot',
      date '2026-07-10', timestamptz '2026-07-10 16:30:00+00'
    ),
    (
      '83300000-0000-4000-8000-000000000003'::uuid,
      '83300000-0000-4000-a000-000000000003'::uuid,
      'pasajes_agregados', 'Pasajes a Barcelona guardados',
      date '2026-07-18', timestamptz '2026-07-18 12:00:00+00'
    ),
    (
      '83300000-0000-4000-8000-000000000004'::uuid,
      '83300000-0000-4000-a000-000000000004'::uuid,
      'inicio', 'Inicio del guest spot en Zorro Rojo',
      date '2026-08-15', timestamptz '2026-08-15 09:00:00+00'
    ),
    (
      '83300000-0000-4000-8000-000000000005'::uuid,
      '83300000-0000-4000-a000-000000000005'::uuid,
      'fin', 'Fin del guest spot en Zorro Rojo',
      date '2026-08-22', timestamptz '2026-08-22 19:00:00+00'
    )
)
insert into public.trip_events (
  id, trip_id, event_type, detail, event_date, created_at, source_type, source_id
)
select e.id, t.id, e.event_type, e.detail, e.event_date, e.created_at, 'demo', e.source_id
from events e
join public.artist_trips t
  on t.source_type = 'demo'
 and t.source_id = '83000000-0000-4000-a000-000000000001'::uuid;

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK / RESTORE (run manually as one transaction)
-- ---------------------------------------------------------------------------
-- begin;
--
-- -- Prevent concurrent owner or trigger DML from changing the graph between
-- -- the fail-closed fingerprint and the restore mutations. This manual
-- -- rollback is short-lived and intentionally locks every relation it reads
-- -- and mutates as part of the Travel fixture boundary.
-- lock table
--   public.artists_db,
--   public.studios,
--   public.artist_trips,
--   public.artist_travel_passport_stamps,
--   public.inbox_threads,
--   public.inbox_thread_participants,
--   public.inbox_messages,
--   public.inbox_thread_activity,
--   public.trip_checklist_items,
--   public.trip_documents,
--   public.trip_events,
--   public.trip_studio_links,
--   public.trip_studio_link_audit
-- in share row exclusive mode;
--
-- -- Fail closed before the first mutation. The rollback is safe only while the
-- -- eight parent fingerprints and every row it owns or would cascade-delete
-- -- still equal the post-seed graph. User-created rows on the five reused
-- -- parents remain outside this fixture boundary and are preserved.
-- do $$
-- declare
--   v_artist_user_id uuid;
-- begin
--   select a.user_id into v_artist_user_id
--   from public.artists_db a
--   where lower(a.username) = 'isainazartattoo.wo';
--
--   if v_artist_user_id is null then
--     raise exception 'Demo artist isainazartattoo.wo does not exist';
--   end if;
--
--   if exists (
--     with expected_parents(
--       id, source_id, city, country, region, start_date, end_date, trip_type,
--       status, studio_name_hint, event_name, agreed_conditions, personal_notes,
--       share_slug, share_enabled, interested_people_count, climate_celsius
--     ) as (values
--       ('9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid, '83000000-0000-4000-a000-000000000001'::uuid, 'Barcelona', 'España', 'europa'::text, date '2026-08-15', date '2026-08-22', 'guest_spot', 'confirmado', 'Zorro Rojo Tattoo', null::text, 'Split 65% para el artista. Agenda garantizada de 5 días, materiales incluidos.', '[PRUEBA][TRAVEL-FIGMA-20260830] Llevar flash sheets nuevos y stencils impresos — la impresora del estudio es lenta.', 'br-zorro-rojo-ago26', true, 12, 28.0::numeric),
--       ('83000000-0000-4000-8000-000000000002'::uuid, '83000000-0000-4000-a000-000000000002'::uuid, 'Berlín', 'Alemania', 'europa', date '2026-09-03', date '2026-09-05', 'convencion', 'confirmado', 'Bauhaus Ink Fest', 'Bauhaus Ink Fest', 'Residencia invitada · estación equipada · agenda compartida.', '[PRUEBA][TRAVEL-FIGMA-20260830] Confirmar alojamiento en Kreuzberg.', null, false, 9, 18.0::numeric),
--       ('494464fd-9f32-4577-bb52-955c4872480c'::uuid, '83000000-0000-4000-a000-000000000003'::uuid, 'Ciudad de México', 'México', 'norteamerica', date '2026-09-20', date '2026-09-27', 'estudio_invitado', 'pendiente', 'Estudio Cactus', null, 'Pendiente de confirmación del espacio y horarios.', '[PRUEBA][TRAVEL-FIGMA-20260830] Sacar pasajes con anticipación.', null, false, 21, 23.0::numeric),
--       ('9c7d45da-ef3e-4f0c-85cc-061ec5af166c'::uuid, '83000000-0000-4000-a000-000000000004'::uuid, 'Madrid', 'España', 'europa', date '2026-10-10', date '2026-10-14', 'guest_spot', 'pendiente', 'Madrid Ink Studio', null, 'Pendiente de confirmación final del estudio.', '[PRUEBA][TRAVEL-FIGMA-20260830] Confirmar fechas con el estudio.', null, false, 8, 25.0::numeric),
--       ('83000000-0000-4000-8000-000000000005'::uuid, '83000000-0000-4000-a000-000000000005'::uuid, 'Santiago', 'Chile', 'sudamerica', date '2026-11-02', date '2026-11-04', 'convencion', 'pendiente', 'Congreso Sudamericano de Tatuaje', 'Congreso Sudamericano de Tatuaje', 'Solicitud enviada · esperando confirmación del estudio.', '[PRUEBA][TRAVEL-FIGMA-20260830] Coordinar agenda de diseños geométricos.', null, false, 6, 20.0::numeric),
--       ('23fb65d1-9479-4455-8908-b664f7b70819'::uuid, '83000000-0000-4000-a000-000000000006'::uuid, 'Montevideo', 'Uruguay', 'sudamerica', date '2026-06-20', date '2026-06-22', 'guest_spot', 'finalizado', 'Ink Society', null, 'Guest spot completado · liquidación cerrada.', '[PRUEBA][TRAVEL-FIGMA-20260830] Buena respuesta, repetir el año que viene.', null, false, 11, 17.0::numeric),
--       ('a2b43cea-e81f-4ae4-b407-78c0e1c44436'::uuid, '83000000-0000-4000-a000-000000000007'::uuid, 'Lima', 'Perú', 'sudamerica', date '2026-06-05', date '2026-06-07', 'guest_spot', 'finalizado', 'Lima Tinta Studio', null, 'Guest spot completado · documentación archivada.', '[PRUEBA][TRAVEL-FIGMA-20260830] Viaje finalizado y conciliado.', null, false, 7, 22.0::numeric),
--       ('83000000-0000-4000-8000-000000000008'::uuid, '83000000-0000-4000-a000-000000000008'::uuid, 'Barcelona', 'España', 'europa', date '2025-12-05', date '2025-12-07', 'convencion', 'finalizado', 'Barcelona Tattoo Expo', 'Barcelona Tattoo Expo', 'Convención finalizada · contactos archivados.', '[PRUEBA][TRAVEL-FIGMA-20260830] Seguimiento comercial terminado.', null, false, 15, 18.0::numeric)
--     )
--     select 1 from expected_parents e
--     where not exists (
--       select 1 from public.artist_trips t
--       where t.id = e.id and t.artist_user_id = v_artist_user_id
--         and t.source_type = 'demo' and t.source_id = e.source_id
--         and t.city = e.city and t.country = e.country and t.region = e.region
--         and t.start_date = e.start_date and t.end_date = e.end_date
--         and t.trip_type = e.trip_type and t.status = e.status
--         and t.origin = 'manual'
--         and t.studio_name_hint is not distinct from e.studio_name_hint
--         and t.event_name is not distinct from e.event_name
--         and t.agreed_conditions is not distinct from e.agreed_conditions
--         and t.personal_notes is not distinct from e.personal_notes
--         and t.share_slug is not distinct from e.share_slug
--         and t.share_enabled = e.share_enabled
--         and t.interested_people_count = e.interested_people_count
--         and t.climate_celsius is not distinct from e.climate_celsius
--         and t.cancelled_at is null
--     )
--   ) then
--     raise exception 'Rollback aborted: Travel demo parents drifted';
--   end if;
--
--   if exists (
--     with expected_passport(
--       id, source_id, city, country, year, tattoo_count, studio_count
--     ) as (values
--       ('83500000-0000-4000-8000-000000000001'::uuid, '83500000-0000-4000-a000-000000000001'::uuid, 'Buenos Aires', 'Argentina', 2025::smallint, 3, 2),
--       ('83500000-0000-4000-8000-000000000002'::uuid, '83500000-0000-4000-a000-000000000002'::uuid, 'São Paulo', 'Brasil', 2024::smallint, 1, 1),
--       ('83500000-0000-4000-8000-000000000003'::uuid, '83500000-0000-4000-a000-000000000003'::uuid, 'Bogotá', 'Colombia', 2023::smallint, 2, 2)
--     )
--     select 1 from expected_passport e
--     where not exists (
--       select 1 from public.artist_travel_passport_stamps p
--       where p.id = e.id and p.artist_user_id = v_artist_user_id
--         and p.source_type = 'demo' and p.source_id = e.source_id
--         and p.city = e.city and p.country = e.country and p.year = e.year
--         and p.tattoo_count = e.tattoo_count and p.studio_count = e.studio_count
--     )
--   ) then
--     raise exception 'Rollback aborted: Travel demo-owned child graph drifted';
--   end if;
--
--   if exists (
--     with expected_checklist(
--       id, source_id, label, is_done, is_custom, sort_order
--     ) as (values
--       ('83100000-0000-4000-8000-000000000001'::uuid, '83100000-0000-4000-a000-000000000001'::uuid, 'Pasajes comprados'::text, true, false, 0),
--       ('83100000-0000-4000-8000-000000000002'::uuid, '83100000-0000-4000-a000-000000000002'::uuid, 'Hospedaje reservado', true, false, 1),
--       ('83100000-0000-4000-8000-000000000003'::uuid, '83100000-0000-4000-a000-000000000003'::uuid, 'Estudio confirmado', false, false, 2),
--       ('83100000-0000-4000-8000-000000000004'::uuid, '83100000-0000-4000-a000-000000000004'::uuid, 'Contacté al estudio', true, false, 3),
--       ('83100000-0000-4000-8000-000000000005'::uuid, '83100000-0000-4000-a000-000000000005'::uuid, 'Agenda recibida', false, false, 4),
--       ('83100000-0000-4000-8000-000000000006'::uuid, '83100000-0000-4000-a000-000000000006'::uuid, 'Equipos preparados', false, false, 5),
--       ('83100000-0000-4000-8000-000000000007'::uuid, '83100000-0000-4000-a000-000000000007'::uuid, 'Materiales de trabajo listos', false, false, 6),
--       ('83100000-0000-4000-8000-000000000008'::uuid, '83100000-0000-4000-a000-000000000008'::uuid, 'Documentación preparada', false, false, 7),
--       ('83100000-0000-4000-8000-000000000009'::uuid, '83100000-0000-4000-a000-000000000009'::uuid, 'Seguro de viaje', false, false, 8),
--       ('83100000-0000-4000-8000-000000000010'::uuid, '83100000-0000-4000-a000-000000000010'::uuid, 'Equipaje listo', false, false, 9)
--     )
--     select 1 from expected_checklist e
--     where not exists (
--       select 1 from public.trip_checklist_items i
--       where i.id = e.id
--         and i.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
--         and i.source_type = 'demo' and i.source_id = e.source_id
--         and i.label = e.label and i.is_done = e.is_done
--         and i.is_custom = e.is_custom and i.sort_order = e.sort_order
--     )
--     union all
--     select 1 from public.trip_checklist_items i
--     where i.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
--       and i.source_type = 'demo'
--       and not exists (select 1 from expected_checklist e where e.id = i.id and e.source_id = i.source_id)
--   ) then
--     raise exception 'Rollback aborted: Travel demo-owned child graph drifted';
--   end if;
--
--   if exists (
--     with expected_documents(
--       id, source_id, category, file_name, storage_path, created_at
--     ) as (values
--       ('83200000-0000-4000-8000-000000000001'::uuid, '83200000-0000-4000-a000-000000000001'::uuid, 'pasaje'::text, 'Pasaje_ida_vuelta.pdf'::text, v_artist_user_id::text || '/travel-figma-20260830/Pasaje_ida_vuelta.pdf', timestamptz '2026-06-20 12:00:00+00'),
--       ('83200000-0000-4000-8000-000000000002'::uuid, '83200000-0000-4000-a000-000000000002'::uuid, 'reserva_hotel', 'Reserva_hotel_barcelona.pdf', v_artist_user_id::text || '/travel-figma-20260830/Reserva_hotel_barcelona.pdf', timestamptz '2026-06-25 12:00:00+00'),
--       ('83200000-0000-4000-8000-000000000003'::uuid, '83200000-0000-4000-a000-000000000003'::uuid, 'contrato', 'Acuerdo_costa_ink.pdf', v_artist_user_id::text || '/travel-figma-20260830/Acuerdo_costa_ink.pdf', timestamptz '2026-07-02 12:00:00+00')
--     )
--     select 1 from expected_documents e
--     where not exists (
--       select 1 from public.trip_documents d
--       where d.id = e.id
--         and d.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
--         and d.source_type = 'demo' and d.source_id = e.source_id
--         and d.category = e.category and d.file_name = e.file_name
--         and d.storage_path = e.storage_path and d.created_at = e.created_at
--     )
--     union all
--     select 1 from public.trip_documents d
--     where d.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
--       and d.source_type = 'demo'
--       and not exists (select 1 from expected_documents e where e.id = d.id and e.source_id = d.source_id)
--   ) then
--     raise exception 'Rollback aborted: Travel demo-owned child graph drifted';
--   end if;
--
--   if exists (
--     with expected_events(
--       id, source_id, event_type, detail, event_date, created_at
--     ) as (values
--       ('83300000-0000-4000-8000-000000000001'::uuid, '83300000-0000-4000-a000-000000000001'::uuid, 'creado'::text, 'Viaje demo creado'::text, date '2026-07-02', timestamptz '2026-07-02 10:00:00+00'),
--       ('83300000-0000-4000-8000-000000000002'::uuid, '83300000-0000-4000-a000-000000000002'::uuid, 'estudio_confirmado', 'Zorro Rojo Tattoo confirmó el guest spot', date '2026-07-10', timestamptz '2026-07-10 16:30:00+00'),
--       ('83300000-0000-4000-8000-000000000003'::uuid, '83300000-0000-4000-a000-000000000003'::uuid, 'pasajes_agregados', 'Pasajes a Barcelona guardados', date '2026-07-18', timestamptz '2026-07-18 12:00:00+00'),
--       ('83300000-0000-4000-8000-000000000004'::uuid, '83300000-0000-4000-a000-000000000004'::uuid, 'inicio', 'Inicio del guest spot en Zorro Rojo', date '2026-08-15', timestamptz '2026-08-15 09:00:00+00'),
--       ('83300000-0000-4000-8000-000000000005'::uuid, '83300000-0000-4000-a000-000000000005'::uuid, 'fin', 'Fin del guest spot en Zorro Rojo', date '2026-08-22', timestamptz '2026-08-22 19:00:00+00')
--     )
--     select 1 from expected_events e
--     where not exists (
--       select 1 from public.trip_events x
--       where x.id = e.id
--         and x.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
--         and x.source_type = 'demo' and x.source_id = e.source_id
--         and x.event_type = e.event_type and x.detail is not distinct from e.detail
--         and x.event_date = e.event_date and x.created_at = e.created_at
--     )
--     union all
--     select 1 from public.trip_events x
--     where x.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
--       and x.source_type = 'demo'
--       and not exists (select 1 from expected_events e where e.id = x.id and e.source_id = x.source_id)
--   ) then
--     raise exception 'Rollback aborted: Travel demo-owned child graph drifted';
--   end if;
--
--   if exists (
--     with expected_links(
--       id, source_id, trip_id, studio_id, studio_name, studio_city, status,
--       requested_at, resolved_at, requested_by_user_id, resolved_by_user_id,
--       contact_name, contact_details, address_snapshot
--     ) as (values
--       ('a6d1a848-7ec6-4dd2-9ea6-15592ed262ad'::uuid, '83400000-0000-4000-a000-000000000001'::uuid, '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid, null::uuid, 'Zorro Rojo Tattoo'::text, 'Barcelona'::text, 'esperando_confirmacion'::text, timestamptz '2026-08-29 02:50:21.915353+00', timestamptz '2026-08-24 02:50:21.915353+00', v_artist_user_id, null::uuid, 'Marc Solé'::text, '+34 611 222 333 · WhatsApp'::text, 'Carrer del Rec 45, Barcelona'::text),
--       ('83400000-0000-4000-8000-000000000009'::uuid, '83400000-0000-4000-a000-000000000009'::uuid, '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid, null, 'Marea Negra Barcelona', 'Barcelona', 'confirmada', timestamptz '2026-07-03 10:00:00+00', timestamptz '2026-07-10 16:30:00+00', v_artist_user_id, null, 'Nuria Vidal', 'nuria@mareanegra.example', 'Barcelona, España'),
--       ('83400000-0000-4000-8000-000000000002'::uuid, '83400000-0000-4000-a000-000000000002'::uuid, '83000000-0000-4000-8000-000000000002'::uuid, null, 'Bauhaus Ink Fest', 'Berlín', 'confirmada', timestamptz '2026-07-10 09:00:00+00', timestamptz '2026-07-14 12:00:00+00', v_artist_user_id, null, 'Lena Vogel', 'lena@bauhausink.example', null),
--       ('83400000-0000-4000-8000-000000000003'::uuid, '83400000-0000-4000-a000-000000000003'::uuid, '494464fd-9f32-4577-bb52-955c4872480c'::uuid, (select s.id from public.studios s where s.slug = 'estudio-cactus' limit 1), 'Estudio Cactus', 'Ciudad de México', 'esperando_confirmacion', timestamptz '2026-08-26 14:00:00+00', null, v_artist_user_id, null, 'Rocío Méndez', 'rocio@estudiocactus.example', null),
--       ('24f2516b-e655-4b8d-8974-0db2b68c8c24'::uuid, '83400000-0000-4000-a000-000000000004'::uuid, '9c7d45da-ef3e-4f0c-85cc-061ec5af166c'::uuid, null, 'Madrid Ink Studio', 'Madrid', 'esperando_confirmacion', timestamptz '2026-08-29 02:50:21.915353+00', null, v_artist_user_id, null, 'Alba Martín', 'alba@madridink.example', null),
--       ('83400000-0000-4000-8000-000000000005'::uuid, '83400000-0000-4000-a000-000000000005'::uuid, '83000000-0000-4000-8000-000000000005'::uuid, null, 'Congreso Sudamericano de Tatuaje', 'Santiago', 'esperando_confirmacion', timestamptz '2026-08-28 18:00:00+00', null, v_artist_user_id, null, 'Tomás Rivas', 'tomas@tierrafirme.example', null),
--       ('c9ab6c10-0cf9-4f7e-8538-22e3a04a9b83'::uuid, '83400000-0000-4000-a000-000000000006'::uuid, '23fb65d1-9479-4455-8908-b664f7b70819'::uuid, null, 'Ink Society', 'Montevideo', 'confirmada', timestamptz '2026-08-29 02:50:21.915353+00', timestamptz '2026-08-24 02:50:21.915353+00', v_artist_user_id, null, 'Lucía Pereira', 'lucia@inksociety.example', null),
--       ('c96c06e7-ccd7-4de0-a157-530c4cff187f'::uuid, '83400000-0000-4000-a000-000000000007'::uuid, 'a2b43cea-e81f-4ae4-b407-78c0e1c44436'::uuid, null, 'Lima Tinta Studio', 'Lima', 'confirmada', timestamptz '2026-08-29 02:50:21.915353+00', timestamptz '2026-08-24 02:50:21.915353+00', v_artist_user_id, null, 'Diego Salazar', 'diego@limatinta.example', null),
--       ('83400000-0000-4000-8000-000000000008'::uuid, '83400000-0000-4000-a000-000000000008'::uuid, '83000000-0000-4000-8000-000000000008'::uuid, null, 'Barcelona Tattoo Expo', 'Barcelona', 'confirmada', timestamptz '2025-10-20 10:00:00+00', timestamptz '2025-10-22 16:00:00+00', v_artist_user_id, null, 'Marina Costa', 'marina@barcelonatattooexpo.example', null)
--     )
--     select 1 from expected_links e
--     where not exists (
--       select 1 from public.trip_studio_links l
--       where l.id = e.id and l.trip_id = e.trip_id
--         and l.source_type = 'demo' and l.source_id = e.source_id
--         and l.studio_id is not distinct from e.studio_id
--         and l.studio_name = e.studio_name and l.studio_city = e.studio_city
--         and l.status = e.status and l.requested_at = e.requested_at
--         and l.resolved_at is not distinct from e.resolved_at
--         and l.requested_by_user_id = e.requested_by_user_id
--         and l.resolved_by_user_id is not distinct from e.resolved_by_user_id
--         and l.contact_name is not distinct from e.contact_name
--         and l.contact_details is not distinct from e.contact_details
--         and l.address_snapshot is not distinct from e.address_snapshot
--     )
--     union all
--     select 1 from public.trip_studio_links l
--     where l.source_type = 'demo'
--       and l.trip_id in (
--         '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid,
--         '83000000-0000-4000-8000-000000000002'::uuid,
--         '494464fd-9f32-4577-bb52-955c4872480c'::uuid,
--         '9c7d45da-ef3e-4f0c-85cc-061ec5af166c'::uuid,
--         '83000000-0000-4000-8000-000000000005'::uuid,
--         '23fb65d1-9479-4455-8908-b664f7b70819'::uuid,
--         'a2b43cea-e81f-4ae4-b407-78c0e1c44436'::uuid,
--         '83000000-0000-4000-8000-000000000008'::uuid
--       ) and not exists (select 1 from expected_links e where e.id = l.id and e.source_id = l.source_id)
--   ) then
--     raise exception 'Rollback aborted: Travel demo-owned child graph drifted';
--   end if;
--
--   if not exists (
--     select 1 from public.trip_studio_links l
--     where l.id = 'a0d9a6fa-004b-4344-b20e-43f31c33a143'::uuid
--       and l.trip_id = '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
--       and l.studio_id = 'e3aa7f17-42f8-469a-a41c-edd9ef1e8999'::uuid
--       and l.studio_name = 'Sang Bleu London' and l.studio_city = 'London'
--       and l.status = 'rechazada'
--       and l.requested_at = timestamptz '2026-08-19 03:40:13.985252+00'
--       and l.resolved_at = timestamptz '2026-08-23 03:40:13.985252+00'
--       and l.requested_by_user_id = v_artist_user_id
--       and l.resolved_by_user_id is null
--       and l.source_type is null and l.source_id is null
--       and l.contact_name is null and l.contact_details is null
--       and l.address_snapshot is null
--   ) then
--     raise exception 'Rollback aborted: Travel demo-owned child graph drifted';
--   end if;
--
--   if exists (
--     with expected_link_audits(link_id, trip_id, new_status) as (values
--       ('83400000-0000-4000-8000-000000000009'::uuid, '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid, 'confirmada'::text),
--       ('83400000-0000-4000-8000-000000000002'::uuid, '83000000-0000-4000-8000-000000000002'::uuid, 'confirmada'),
--       ('83400000-0000-4000-8000-000000000003'::uuid, '494464fd-9f32-4577-bb52-955c4872480c'::uuid, 'esperando_confirmacion'),
--       ('83400000-0000-4000-8000-000000000005'::uuid, '83000000-0000-4000-8000-000000000005'::uuid, 'esperando_confirmacion'),
--       ('83400000-0000-4000-8000-000000000008'::uuid, '83000000-0000-4000-8000-000000000008'::uuid, 'confirmada')
--     )
--     select 1 from expected_link_audits e
--     where (
--       select count(*) from public.trip_studio_link_audit a
--       where a.link_id = e.link_id and a.trip_id = e.trip_id
--         and a.actor_user_id is null and a.old_status is null
--         and a.new_status = e.new_status and a.source = 'seed'
--     ) <> 1
--     union all
--     select 1 from public.trip_studio_link_audit a
--     where a.link_id in (
--       '83400000-0000-4000-8000-000000000009'::uuid,
--       '83400000-0000-4000-8000-000000000002'::uuid,
--       '83400000-0000-4000-8000-000000000003'::uuid,
--       '83400000-0000-4000-8000-000000000005'::uuid,
--       '83400000-0000-4000-8000-000000000008'::uuid
--     ) and not exists (
--       select 1 from expected_link_audits e
--       where e.link_id = a.link_id and e.trip_id = a.trip_id
--         and a.actor_user_id is null and a.old_status is null
--         and a.new_status = e.new_status and a.source = 'seed'
--     )
--   ) then
--     raise exception 'Rollback aborted: Travel demo-owned child graph drifted';
--   end if;
--
--   if exists (
--     select 1 from public.trip_checklist_items i
--     where i.trip_id in (
--       '83000000-0000-4000-8000-000000000002'::uuid,
--       '83000000-0000-4000-8000-000000000005'::uuid,
--       '83000000-0000-4000-8000-000000000008'::uuid
--     )
--     union all
--     select 1 from public.trip_documents d
--     where d.trip_id in (
--       '83000000-0000-4000-8000-000000000002'::uuid,
--       '83000000-0000-4000-8000-000000000005'::uuid,
--       '83000000-0000-4000-8000-000000000008'::uuid
--     )
--     union all
--     select 1 from public.trip_events e
--     where e.trip_id in (
--       '83000000-0000-4000-8000-000000000002'::uuid,
--       '83000000-0000-4000-8000-000000000005'::uuid,
--       '83000000-0000-4000-8000-000000000008'::uuid
--     )
--     union all
--     select 1 from public.trip_studio_links l
--     where l.trip_id in (
--       '83000000-0000-4000-8000-000000000002'::uuid,
--       '83000000-0000-4000-8000-000000000005'::uuid,
--       '83000000-0000-4000-8000-000000000008'::uuid
--     ) and l.id not in (
--       '83400000-0000-4000-8000-000000000002'::uuid,
--       '83400000-0000-4000-8000-000000000005'::uuid,
--       '83400000-0000-4000-8000-000000000008'::uuid
--     )
--   ) then
--     raise exception 'Rollback aborted: inserted Travel parents have unowned children';
--   end if;
--
--   if exists (
--     select 1 from public.artist_trips t
--     where t.id = '4bc33e15-b315-4908-a0c0-fe47cbde32f5'::uuid
--        or (t.source_type = 'studio_invitation'
--            and t.source_id = '5df457e1-f3f4-42ef-98da-6168e742d7c5'::uuid)
--     union all
--     select 1 from public.trip_checklist_items i
--     where i.id in (
--       '332a3cb5-dcae-4b54-ade9-ac34b419e95b'::uuid,
--       '53e949f7-83aa-4e42-93c4-c6fcc8694b88'::uuid,
--       '3bdf2685-def7-448f-afcb-d8e92da5a0b8'::uuid,
--       'b7e3247d-088d-40ed-a780-bf694fe98c4d'::uuid,
--       '666771e6-d23b-469f-b012-e41f45c33aed'::uuid,
--       'cd500197-5388-4f96-a515-dcefdd32c8ed'::uuid,
--       'a13cf27d-01a6-47f2-85a9-553c239514b2'::uuid,
--       '02022f35-70f1-45dd-af2f-1289a0d638bb'::uuid,
--       'a0334331-fd54-43cf-a286-f26da561d55e'::uuid,
--       '2c598eca-1cae-4e2e-8c85-b91da2aa9b4c'::uuid
--     )
--     union all
--     select 1 from public.trip_events e
--     where e.id in (
--       'e93caafd-4671-4595-96f0-cab95ab4226d'::uuid,
--       '65ab0217-9612-4849-b26e-e13c6e7ab978'::uuid
--     )
--     union all
--     select 1 from public.trip_studio_links l
--     where l.id = '51648221-a3a6-4e09-8860-492f9777ff88'::uuid
--        or (l.source_type = 'studio_invitation'
--            and l.source_id = '5df457e1-f3f4-42ef-98da-6168e742d7c5'::uuid)
--     union all
--     select 1 from public.trip_studio_link_audit a
--     where a.id = '5b2a8aa4-896a-4bec-913f-e589f06d4c3b'::uuid
--   ) then
--     raise exception 'Rollback aborted: automatic invitation restore IDs are occupied';
--   end if;
--
--   if exists (
--     select 1 from public.inbox_threads t
--     where t.id = '1c12be0d-86ef-4a76-8dca-cb5ee1242107'::uuid
--        or (t.context_type = 'trip_studio_link'
--            and t.context_id = '51648221-a3a6-4e09-8860-492f9777ff88'::uuid)
--        or t.context ->> 'trip_id' = '4bc33e15-b315-4908-a0c0-fe47cbde32f5'
--     union all
--     select 1 from public.inbox_messages m
--     where m.id = '1948b9ee-149f-477d-9cf0-f4837b5f9e01'::uuid
--     union all
--     select 1 from public.inbox_thread_activity a
--     where a.id = '99af2d82-524d-462a-a8ae-668959b0de71'::uuid
--   ) then
--     raise exception 'Rollback aborted: automatic invitation Inbox restore IDs are occupied';
--   end if;
-- end;
-- $$;
--
-- -- Delete only the three Passport rows introduced by this seed.
-- delete from public.artist_travel_passport_stamps p
-- where p.artist_user_id = (
--     select a.user_id from public.artists_db a
--     where lower(a.username) = 'isainazartattoo.wo'
--   )
--   and p.source_type = 'demo'
--   and (p.id, p.source_id) in (
--     ('83500000-0000-4000-8000-000000000001'::uuid, '83500000-0000-4000-a000-000000000001'::uuid),
--     ('83500000-0000-4000-8000-000000000002'::uuid, '83500000-0000-4000-a000-000000000002'::uuid),
--     ('83500000-0000-4000-8000-000000000003'::uuid, '83500000-0000-4000-a000-000000000003'::uuid)
--   );
--
-- -- Remove only child rows owned by this fixture. Parent-trip membership is not
-- -- used as the deletion boundary, so user rows added after apply are preserved.
-- delete from public.trip_documents d
-- where d.source_type='demo' and d.source_id in (
--   '83200000-0000-4000-a000-000000000001'::uuid,
--   '83200000-0000-4000-a000-000000000002'::uuid,
--   '83200000-0000-4000-a000-000000000003'::uuid
-- );
-- delete from public.trip_checklist_items i
-- where i.source_type='demo' and i.source_id in (
--   '83100000-0000-4000-a000-000000000001'::uuid,
--   '83100000-0000-4000-a000-000000000002'::uuid,
--   '83100000-0000-4000-a000-000000000003'::uuid,
--   '83100000-0000-4000-a000-000000000004'::uuid,
--   '83100000-0000-4000-a000-000000000005'::uuid,
--   '83100000-0000-4000-a000-000000000006'::uuid,
--   '83100000-0000-4000-a000-000000000007'::uuid,
--   '83100000-0000-4000-a000-000000000008'::uuid,
--   '83100000-0000-4000-a000-000000000009'::uuid,
--   '83100000-0000-4000-a000-000000000010'::uuid
-- );
-- delete from public.trip_events e
-- where e.source_type='demo' and e.source_id in (
--   '83300000-0000-4000-a000-000000000001'::uuid,
--   '83300000-0000-4000-a000-000000000002'::uuid,
--   '83300000-0000-4000-a000-000000000003'::uuid,
--   '83300000-0000-4000-a000-000000000004'::uuid,
--   '83300000-0000-4000-a000-000000000005'::uuid
-- );
-- delete from public.trip_studio_links l
-- where l.source_type='demo' and (l.id,l.source_id) in (
--   ('83400000-0000-4000-8000-000000000009'::uuid,'83400000-0000-4000-a000-000000000009'::uuid),
--   ('83400000-0000-4000-8000-000000000002'::uuid,'83400000-0000-4000-a000-000000000002'::uuid),
--   ('83400000-0000-4000-8000-000000000003'::uuid,'83400000-0000-4000-a000-000000000003'::uuid),
--   ('83400000-0000-4000-8000-000000000005'::uuid,'83400000-0000-4000-a000-000000000005'::uuid),
--   ('83400000-0000-4000-8000-000000000008'::uuid,'83400000-0000-4000-a000-000000000008'::uuid)
-- );
--
-- -- Delete only the three parent rows introduced by this seed. Exact ID +
-- -- artist + source UUID must all match.
-- delete from public.artist_trips t
-- where t.artist_user_id = (
--     select a.user_id from public.artists_db a
--     where lower(a.username) = 'isainazartattoo.wo'
--   )
--   and t.source_type = 'demo'
--   and (t.id, t.source_id) in (
--     ('83000000-0000-4000-8000-000000000002'::uuid, '83000000-0000-4000-a000-000000000002'::uuid),
--     ('83000000-0000-4000-8000-000000000005'::uuid, '83000000-0000-4000-a000-000000000005'::uuid),
--     ('83000000-0000-4000-8000-000000000008'::uuid, '83000000-0000-4000-a000-000000000008'::uuid)
--   );
--
-- -- Restore exactly the five legacy fixture rows and remove the demo marker.
-- update public.artist_trips set
--   city='Barcelona', country='España', region='Europa',
--   start_date=date '2026-09-22', end_date=date '2026-10-06',
--   trip_type='guest_spot', status='confirmado', origin='manual',
--   studio_name_hint='Zorro Rojo Tattoo', event_name=null,
--   agreed_conditions='Split 70/30 · el estudio pone insumos', personal_notes='Llevar máquinas de línea y cartuchos 3RL',
--   share_slug='br-zorro-rojo-sep26', share_enabled=true,
--   interested_people_count=0, climate_celsius=null,
--   source_type=null, source_id=null, updated_at=now()
-- where id='9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid
--   and source_type='demo' and source_id='83000000-0000-4000-a000-000000000001'::uuid;
-- update public.artist_trips set
--   city='Madrid', country='España', region='Europa',
--   start_date=date '2026-10-08', end_date=date '2026-10-15',
--   trip_type='guest_spot', status='pendiente', origin='manual',
--   studio_name_hint='La Nave Tattoo', event_name=null,
--   agreed_conditions=null, personal_notes='Confirmar fechas con el estudio',
--   share_slug=null, share_enabled=false,
--   interested_people_count=0, climate_celsius=null,
--   source_type=null, source_id=null, updated_at=now()
-- where id='9c7d45da-ef3e-4f0c-85cc-061ec5af166c'::uuid
--   and source_type='demo' and source_id='83000000-0000-4000-a000-000000000004'::uuid;
-- update public.artist_trips set
--   city='Ciudad de México', country='México', region='América',
--   start_date=date '2026-11-12', end_date=date '2026-11-19',
--   trip_type='convencion', status='planificado', origin='manual',
--   studio_name_hint=null, event_name='Convención Internacional de Tatuaje CDMX',
--   agreed_conditions=null, personal_notes='Sacar pasajes con anticipación',
--   share_slug=null, share_enabled=false,
--   interested_people_count=0, climate_celsius=null,
--   source_type=null, source_id=null, updated_at=now()
-- where id='494464fd-9f32-4577-bb52-955c4872480c'::uuid
--   and source_type='demo' and source_id='83000000-0000-4000-a000-000000000003'::uuid;
-- update public.artist_trips set
--   city='Montevideo', country='Uruguay', region='América',
--   start_date=date '2026-07-15', end_date=date '2026-07-22',
--   trip_type='guest_spot', status='finalizado', origin='manual',
--   studio_name_hint='Ink Society', event_name=null,
--   agreed_conditions='Split 60/40', personal_notes='Buena respuesta, repetir el año que viene',
--   share_slug=null, share_enabled=false,
--   interested_people_count=0, climate_celsius=null,
--   source_type=null, source_id=null, updated_at=now()
-- where id='23fb65d1-9479-4455-8908-b664f7b70819'::uuid
--   and source_type='demo' and source_id='83000000-0000-4000-a000-000000000006'::uuid;
-- update public.artist_trips set
--   city='Lima', country='Perú', region='América',
--   start_date=date '2026-05-25', end_date=date '2026-06-01',
--   trip_type='guest_spot', status='finalizado', origin='manual',
--   studio_name_hint='Costa Ink Collective', event_name=null,
--   agreed_conditions='Split 65/35', personal_notes=null,
--   share_slug=null, share_enabled=false,
--   interested_people_count=0, climate_celsius=null,
--   source_type=null, source_id=null, updated_at=now()
-- where id='a2b43cea-e81f-4ae4-b407-78c0e1c44436'::uuid
--   and source_type='demo' and source_id='83000000-0000-4000-a000-000000000007'::uuid;
--
-- -- Restore the exact semantic snapshot captured immediately before apply:
-- -- Barcelona's 14 checklist rows, five dated events and all five legacy links.
-- insert into public.trip_checklist_items (trip_id,label,is_done,is_custom,sort_order)
-- select '9a70aa11-4232-4615-9dc6-04d0aedd63e2'::uuid,v.label,v.done,v.custom,v.sort_order
-- from (values
--   ('Estudio confirmado',true,false,0),
--   ('Pasajes comprados',true,false,1),
--   ('Alojamiento reservado',true,false,2),
--   ('Insumos y máquinas',false,false,3),
--   ('Agenda publicada',false,false,4),
--   ('Anticipos cobrados',false,false,5),
--   ('Seguro de viaje',false,false,6),
--   ('Documentación al día',false,false,7),
--   ('Cambio de moneda',false,false,8),
--   ('Contenido para redes',false,false,9),
--   ('Comprar pasajes',true,false,1),
--   ('Confirmar estudio',true,false,2),
--   ('Preparar insumos',false,false,3),
--   ('Publicar agenda del viaje',false,true,4)
-- ) v(label,done,custom,sort_order);
-- insert into public.trip_events (trip_id,event_type,detail,event_date) values
--   ('9a70aa11-4232-4615-9dc6-04d0aedd63e2','creado','Viaje agregado al itinerario',date '2026-08-09'),
--   ('9a70aa11-4232-4615-9dc6-04d0aedd63e2','estudio_confirmado','El estudio confirmó las fechas',date '2026-08-17'),
--   ('9a70aa11-4232-4615-9dc6-04d0aedd63e2','creado','Viaje demo creado',date '2026-08-20'),
--   ('9a70aa11-4232-4615-9dc6-04d0aedd63e2','estudio_confirmado','Zorro Rojo Tattoo confirmó el guest spot',date '2026-08-24'),
--   ('9a70aa11-4232-4615-9dc6-04d0aedd63e2','nota','Agenda de Barcelona abierta',date '2026-08-28');
-- update public.trip_studio_links l
-- set studio_id=v.studio_id, studio_name=v.studio_name,
--     studio_city=v.studio_city, status=v.status,
--     requested_at=v.requested_at, resolved_at=v.resolved_at,
--     requested_by_user_id='e5e3be81-784d-469c-bb86-13952f2a0c08'::uuid,
--     resolved_by_user_id=null,
--     source_type=null, source_id=null, contact_name=null,
--     contact_details=null, address_snapshot=null
-- from (values
--   ('a6d1a848-7ec6-4dd2-9ea6-15592ed262ad'::uuid,'83400000-0000-4000-a000-000000000001'::uuid,null::uuid,'Zorro Rojo Tattoo'::text,'Barcelona'::text,'confirmada'::text,timestamptz '2026-08-29 02:50:21.915353+00',timestamptz '2026-08-24 02:50:21.915353+00'),
--   ('24f2516b-e655-4b8d-8974-0db2b68c8c24'::uuid,'83400000-0000-4000-a000-000000000004'::uuid,null,'La Nave Tattoo','Madrid','esperando_confirmacion',timestamptz '2026-08-29 02:50:21.915353+00',null),
--   ('c9ab6c10-0cf9-4f7e-8538-22e3a04a9b83'::uuid,'83400000-0000-4000-a000-000000000006'::uuid,null,'Ink Society','Montevideo','confirmada',timestamptz '2026-08-29 02:50:21.915353+00',timestamptz '2026-08-24 02:50:21.915353+00'),
--   ('c96c06e7-ccd7-4de0-a157-530c4cff187f'::uuid,'83400000-0000-4000-a000-000000000007'::uuid,null,'Costa Ink Collective','Lima','confirmada',timestamptz '2026-08-29 02:50:21.915353+00',timestamptz '2026-08-24 02:50:21.915353+00')
-- ) v(id,source_id,studio_id,studio_name,studio_city,status,requested_at,resolved_at)
-- where l.id=v.id and l.source_type='demo' and l.source_id=v.source_id;
-- update public.trip_studio_links
-- set studio_id='e3aa7f17-42f8-469a-a41c-edd9ef1e8999'::uuid,
--     studio_name='Sang Bleu London', studio_city='London', status='confirmada',
--     requested_at=timestamptz '2026-08-19 03:40:13.985252+00',
--     resolved_at=timestamptz '2026-08-23 03:40:13.985252+00',
--     requested_by_user_id='e5e3be81-784d-469c-bb86-13952f2a0c08'::uuid,
--     resolved_by_user_id=null, source_type=null, source_id=null,
--     contact_name=null, contact_details=null, address_snapshot=null
-- where id='a0d9a6fa-004b-4344-b20e-43f31c33a143'::uuid
--   and studio_name='Sang Bleu London' and status='rechazada'
--   and source_type is null and source_id is null;
--
-- -- Restore the exact automatic invitation graph created by the migration
-- -- backfill and retired by APPLY.
-- insert into public.artist_trips (
--   id,artist_user_id,city,country,region,start_date,end_date,trip_type,status,
--   origin,studio_name_hint,event_name,agreed_conditions,personal_notes,
--   share_slug,share_enabled,cancelled_at,created_at,updated_at,
--   source_type,source_id,interested_people_count,climate_celsius
-- ) values (
--   '4bc33e15-b315-4908-a0c0-fe47cbde32f5'::uuid,
--   'e5e3be81-784d-469c-bb86-13952f2a0c08'::uuid,
--   'Barcelona','España',null,date '2026-08-01',date '2026-08-07',
--   'estudio_invitado','confirmado','automatico','Zorro Rojo Tattoo',null,
--   'Split 65.00% para el artista.',null,null,false,null,
--   timestamptz '2026-08-30 07:21:29.706329+00',
--   timestamptz '2026-08-30 07:21:29.706329+00',
--   'studio_invitation','5df457e1-f3f4-42ef-98da-6168e742d7c5'::uuid,0,null
-- );
-- insert into public.trip_checklist_items (
--   id,trip_id,label,is_done,is_custom,sort_order,created_at,source_type,source_id
-- ) values
--   ('332a3cb5-dcae-4b54-ade9-ac34b419e95b','4bc33e15-b315-4908-a0c0-fe47cbde32f5','Pasajes comprados',false,false,0,'2026-08-30 07:21:29.706329+00',null,null),
--   ('53e949f7-83aa-4e42-93c4-c6fcc8694b88','4bc33e15-b315-4908-a0c0-fe47cbde32f5','Hospedaje reservado',false,false,1,'2026-08-30 07:21:29.706329+00',null,null),
--   ('3bdf2685-def7-448f-afcb-d8e92da5a0b8','4bc33e15-b315-4908-a0c0-fe47cbde32f5','Estudio confirmado',true,false,2,'2026-08-30 07:21:29.706329+00',null,null),
--   ('b7e3247d-088d-40ed-a780-bf694fe98c4d','4bc33e15-b315-4908-a0c0-fe47cbde32f5','Contacté al estudio',true,false,3,'2026-08-30 07:21:29.706329+00',null,null),
--   ('666771e6-d23b-469f-b012-e41f45c33aed','4bc33e15-b315-4908-a0c0-fe47cbde32f5','Agenda recibida',false,false,4,'2026-08-30 07:21:29.706329+00',null,null),
--   ('cd500197-5388-4f96-a515-dcefdd32c8ed','4bc33e15-b315-4908-a0c0-fe47cbde32f5','Equipos preparados',false,false,5,'2026-08-30 07:21:29.706329+00',null,null),
--   ('a13cf27d-01a6-47f2-85a9-553c239514b2','4bc33e15-b315-4908-a0c0-fe47cbde32f5','Materiales de trabajo listos',false,false,6,'2026-08-30 07:21:29.706329+00',null,null),
--   ('02022f35-70f1-45dd-af2f-1289a0d638bb','4bc33e15-b315-4908-a0c0-fe47cbde32f5','Documentación preparada',false,false,7,'2026-08-30 07:21:29.706329+00',null,null),
--   ('a0334331-fd54-43cf-a286-f26da561d55e','4bc33e15-b315-4908-a0c0-fe47cbde32f5','Seguro de viaje',false,false,8,'2026-08-30 07:21:29.706329+00',null,null),
--   ('2c598eca-1cae-4e2e-8c85-b91da2aa9b4c','4bc33e15-b315-4908-a0c0-fe47cbde32f5','Equipaje listo',false,false,9,'2026-08-30 07:21:29.706329+00',null,null);
-- insert into public.trip_events (
--   id,trip_id,event_type,detail,event_date,created_at,source_type,source_id
-- ) values
--   ('e93caafd-4671-4595-96f0-cab95ab4226d','4bc33e15-b315-4908-a0c0-fe47cbde32f5','creado','Viaje creado desde una invitación aceptada',date '2026-08-30','2026-08-30 07:21:29.706329+00',null,null),
--   ('65ab0217-9612-4849-b26e-e13c6e7ab978','4bc33e15-b315-4908-a0c0-fe47cbde32f5','estudio_confirmado','Zorro Rojo Tattoo',date '2026-08-30','2026-08-30 07:21:29.706329+00',null,null);
-- alter table public.trip_studio_links disable trigger trg_guard_trip_studio_link_transition;
-- alter table public.trip_studio_links disable trigger trg_audit_trip_studio_link_transition;
-- alter table public.trip_studio_links disable trigger trg_inbox_from_trip_studio_link;
-- insert into public.trip_studio_links (
--   id,trip_id,studio_id,studio_name,studio_city,status,requested_at,resolved_at,
--   requested_by_user_id,resolved_by_user_id,source_type,source_id,updated_at,
--   contact_name,contact_details,address_snapshot
-- ) values (
--   '51648221-a3a6-4e09-8860-492f9777ff88',
--   '4bc33e15-b315-4908-a0c0-fe47cbde32f5','32bfbe77-09fc-4c50-a5b6-68d4edceb90d',
--   'Zorro Rojo Tattoo','Barcelona','confirmada',
--   '2026-08-30 07:21:29.706329+00','2026-08-30 07:21:29.706329+00',
--   'e5e3be81-784d-469c-bb86-13952f2a0c08',null,
--   'studio_invitation','5df457e1-f3f4-42ef-98da-6168e742d7c5',
--   '2026-08-30 07:21:29.706329+00',null,null,null
-- );
-- alter table public.trip_studio_links enable trigger trg_inbox_from_trip_studio_link;
-- alter table public.trip_studio_links enable trigger trg_audit_trip_studio_link_transition;
-- alter table public.trip_studio_links enable trigger trg_guard_trip_studio_link_transition;
-- insert into public.trip_studio_link_audit (
--   id,link_id,trip_id,actor_user_id,old_status,new_status,source,created_at
-- ) values (
--   '5b2a8aa4-896a-4bec-913f-e589f06d4c3b',
--   '51648221-a3a6-4e09-8860-492f9777ff88',
--   '4bc33e15-b315-4908-a0c0-fe47cbde32f5',null,null,'confirmada',
--   'studio_invitation','2026-08-30 07:21:29.706329+00'
-- );
--
-- -- Restore the Inbox projection without firing its message/link generators;
-- -- the four fixed rows below are the exact pre-seed graph.
-- insert into public.inbox_threads (
--   id,artist_user_id,category,context_type,context_id,counterparty_user_id,
--   counterparty_name,counterparty_initials,subject,context,status,is_priority,
--   last_message,last_message_at,last_sender_user_id,created_at,updated_at
-- ) values (
--   '1c12be0d-86ef-4a76-8dca-cb5ee1242107'::uuid,
--   'e5e3be81-784d-469c-bb86-13952f2a0c08'::uuid,
--   'trips','trip_studio_link','51648221-a3a6-4e09-8860-492f9777ff88'::uuid,
--   null,'Zorro Rojo Tattoo','ZO','Viaje a Barcelona',
--   jsonb_build_object(
--     'trip_id','4bc33e15-b315-4908-a0c0-fe47cbde32f5'::uuid,
--     'city','Barcelona','country','España',
--     'start_date',date '2026-08-01','end_date',date '2026-08-07',
--     'studio_id','32bfbe77-09fc-4c50-a5b6-68d4edceb90d'::uuid,
--     'studio_name','Zorro Rojo Tattoo','link_status','confirmada'
--   ),
--   'open',false,
--   'El estudio confirmó la vinculación. El viaje ya puede aparecer en tu perfil público.',
--   timestamptz '2026-08-30 07:21:29.706329+00',null,
--   timestamptz '2026-08-30 07:21:29.706329+00',
--   timestamptz '2026-08-30 07:21:29.706329+00'
-- );
-- insert into public.inbox_thread_participants (
--   thread_id,user_id,participant_role,last_read_at,is_favorite,is_archived,joined_at
-- ) values (
--   '1c12be0d-86ef-4a76-8dca-cb5ee1242107'::uuid,
--   'e5e3be81-784d-469c-bb86-13952f2a0c08'::uuid,
--   'artist',timestamptz '2026-08-30 07:21:29.706329+00',false,false,
--   timestamptz '2026-08-30 07:21:29.706329+00'
-- );
-- alter table public.inbox_messages disable trigger trg_touch_inbox_message_thread;
-- insert into public.inbox_messages (
--   id,thread_id,sender_user_id,sender_role,body,message_kind,
--   attachment_path,attachment_name,attachment_mime,attachment_size,
--   client_nonce,created_at
-- ) values (
--   '1948b9ee-149f-477d-9cf0-f4837b5f9e01'::uuid,
--   '1c12be0d-86ef-4a76-8dca-cb5ee1242107'::uuid,null,'system',
--   'El estudio confirmó la vinculación. El viaje ya puede aparecer en tu perfil público.',
--   'system',null,null,null,null,null,
--   timestamptz '2026-08-30 07:21:29.706329+00'
-- );
-- alter table public.inbox_messages enable trigger trg_touch_inbox_message_thread;
-- insert into public.inbox_thread_activity (
--   id,thread_id,actor_user_id,event_type,metadata,created_at
-- ) values (
--   '99af2d82-524d-462a-a8ae-668959b0de71'::uuid,
--   '1c12be0d-86ef-4a76-8dca-cb5ee1242107'::uuid,null,'message_sent',
--   jsonb_build_object(
--     'kind','system',
--     'message_id','1948b9ee-149f-477d-9cf0-f4837b5f9e01'::uuid
--   ),
--   timestamptz '2026-08-30 07:21:29.706329+00'
-- );
--
-- commit;
