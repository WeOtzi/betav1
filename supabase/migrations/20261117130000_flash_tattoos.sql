-- ============================================================================
-- Flash Tattoos: flashes con precio fijo y reserva (17 nov 2026).
--
-- Un flash es un ítem de artists_db.gallery_feed_items con category 'flash' y
-- sus datos de venta dentro del mismo ítem (clave "flash": precio, moneda,
-- tamaño, zonas, available, mode 'unique' | 'repeat'; ver
-- public/shared/js/flash-model.js). El CHECK artists_db_gallery_feed_items_
-- shape_check no valida claves extra, y ni trigger_sync_artist_gallery_feed_items
-- ni artists_db_gallery_caption_guard las quitan: la galería no cambia aquí.
--
-- El cliente reserva un flash en /flash; el servidor (POST /api/flash/request,
-- lib/routes/flash.js) crea la cotización por el camino del cotizador web.
-- Esta migración:
--   1. agrega 'flash' a quotations_db_source_check (última definición:
--      20261115120000_quotation_source_manual_prequote.sql);
--   2. agrega quotations_db.flash_snapshot (jsonb): la instantánea del flash
--      que armó el servidor (id, título, precio, moneda, tamaño, imagen…);
--   3. guarda: un usuario final (anon / authenticated, artista dueño incluido)
--      no crea cotizaciones de flash ni cambia la instantánea. El servidor
--      (service_role) y las funciones security definer sí;
--   4. disponibilidad del flash único: cuando la cotización pasa a
--      'client_approved' el ítem queda available = false ("Reservado") en la
--      galería del artista; si una cotización ya aprobada se cancela (o vence,
--      o el cliente la rechaza) vuelve a available = true, salvo que otra
--      cotización del mismo flash siga aprobada. Antes de aprobarse, cancelar o
--      rechazar no cambia nada. Solo se edita ESE ítem del jsonb (por id);
--   5. una sola reserva por flash único: ninguna cotización pasa a
--      'client_approved' si otra del mismo artista y flash ya está aprobada o en
--      curso (para todos los roles, service_role incluido; candado por flash);
--   6. save_web_quotation guarda flash_snapshot en el mismo insert/upsert (sin
--      un PATCH posterior que pueda fallar en silencio). Se edita la definición
--      VIVA con pg_get_functiondef + replace(), no se copia la del repo;
--   7. una pestaña del artista con datos viejos no vuelve "disponible" un flash
--      único que ya tiene una cotización aprobada o en curso.
--
-- Idempotente. Reversa: supabase/rollbacks/20261117130000_flash_tattoos.down.sql
-- ============================================================================

begin;

-- 1. Origen 'flash' ------------------------------------------------------------
alter table public.quotations_db
  drop constraint if exists quotations_db_source_check;
alter table public.quotations_db
  add constraint quotations_db_source_check
  check (source is null or source = any (array[
    'direct'::text, 'job_board'::text, 'recommendation'::text, 'web_chat'::text,
    'manual'::text, 'prequote'::text, 'flash'::text
  ])) not valid;
alter table public.quotations_db
  validate constraint quotations_db_source_check;

-- 2. Instantánea del flash -------------------------------------------------------
alter table public.quotations_db
  add column if not exists flash_snapshot jsonb;

alter table public.quotations_db
  drop constraint if exists quotations_db_flash_snapshot_check;
alter table public.quotations_db
  add constraint quotations_db_flash_snapshot_check
  check (flash_snapshot is null or (
    jsonb_typeof(flash_snapshot) = 'object'
    and coalesce(btrim(flash_snapshot ->> 'id'), '') <> ''
  )) not valid;
alter table public.quotations_db
  validate constraint quotations_db_flash_snapshot_check;

comment on column public.quotations_db.flash_snapshot is
  'Flash Tattoos: instantánea del flash reservado (id del ítem de gallery_feed_items, title, price, currency, size, mode, image, slot_minutes). La escribe solo el servidor; source = ''flash''.';

-- Búsqueda de "¿ya hay una solicitud aprobada de este flash?".
create index if not exists quotations_db_flash_item_idx
  on public.quotations_db (artist_id, (flash_snapshot ->> 'id'))
  where flash_snapshot is not null;

-- 3. Guarda de la instantánea y del origen 'flash' ------------------------------
create or replace function public.fn_quotations_flash_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.flash_snapshot is not null or new.source = 'flash' then
      raise exception 'Las solicitudes de flash se crean desde la página del flash.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.flash_snapshot is distinct from old.flash_snapshot then
    raise exception 'Los datos del flash de la cotización no se pueden modificar.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.fn_quotations_flash_guard() is
  'Flash Tattoos: BEFORE INSERT/UPDATE de quotations_db. anon/authenticated no crean cotizaciones de flash ni cambian flash_snapshot (tampoco el artista dueño).';

revoke all on function public.fn_quotations_flash_guard() from public, anon, authenticated;

drop trigger if exists trg_quotations_flash_guard on public.quotations_db;
create trigger trg_quotations_flash_guard
  before insert or update on public.quotations_db
  for each row execute function public.fn_quotations_flash_guard();

-- 4. Disponibilidad del flash único ------------------------------------------------
-- Cambia available SOLO en el ítem con ese id (y category 'flash') del feed
-- del artista. No toca nada si el ítem ya tiene ese valor.
create or replace function public.fn_flash_set_available(p_artist uuid, p_flash_id text, p_available boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_artist is null or coalesce(btrim(p_flash_id), '') = '' or p_available is null then
    return;
  end if;
  update public.artists_db a
     set gallery_feed_items = (
       select coalesce(jsonb_agg(
                case
                  when jsonb_typeof(feed.item) = 'object'
                       and feed.item ->> 'id' = p_flash_id
                       and feed.item ->> 'category' = 'flash'
                    then jsonb_set(
                           feed.item,
                           '{flash}',
                           (case when jsonb_typeof(feed.item -> 'flash') = 'object'
                                 then feed.item -> 'flash' else '{}'::jsonb end)
                             || jsonb_build_object('available', p_available),
                           true)
                  else feed.item
                end
                order by feed.ord), '[]'::jsonb)
         from jsonb_array_elements(a.gallery_feed_items) with ordinality as feed(item, ord)
     )
   where a.user_id = p_artist
     and jsonb_typeof(a.gallery_feed_items) = 'array'
     and exists (
       select 1
         from jsonb_array_elements(a.gallery_feed_items) as cur(item)
        where jsonb_typeof(cur.item) = 'object'
          and cur.item ->> 'id' = p_flash_id
          and cur.item ->> 'category' = 'flash'
          and (cur.item #> '{flash,available}') is distinct from to_jsonb(p_available)
     );
end;
$$;

comment on function public.fn_flash_set_available(uuid, text, boolean) is
  'Flash Tattoos: marca disponible / reservado un flash de la galería del artista (solo ese ítem, por id). La llama el trigger trg_quotations_flash_availability.';

revoke all on function public.fn_flash_set_available(uuid, text, boolean) from public, anon, authenticated;

create or replace function public.fn_quotations_flash_availability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_flash_id text;
  v_reserved constant text[] := array['client_approved', 'in_progress', 'en_progreso', 'artist_completed', 'completed'];
begin
  if new.source is distinct from 'flash' or new.flash_snapshot is null or new.artist_id is null then
    return null;
  end if;
  -- Solo el flash único ("se tatúa una sola vez") se reserva.
  if coalesce(new.flash_snapshot ->> 'mode', 'unique') <> 'unique' then
    return null;
  end if;
  v_flash_id := nullif(btrim(new.flash_snapshot ->> 'id'), '');
  if v_flash_id is null then
    return null;
  end if;

  if new.quote_status = 'client_approved' and old.quote_status is distinct from 'client_approved' then
    perform public.fn_flash_set_available(new.artist_id, v_flash_id, false);
  elsif new.quote_status in ('cancelled', 'client_rejected', 'expired')
        and old.quote_status = any (v_reserved) then
    -- Cancelada después de aprobada: vuelve a estar disponible, salvo que otra
    -- cotización del mismo flash siga aprobada o en curso.
    if not exists (
      select 1
        from public.quotations_db other
       where other.id <> new.id
         and other.artist_id = new.artist_id
         and other.source = 'flash'
         and other.flash_snapshot ->> 'id' = v_flash_id
         and other.quote_status = any (v_reserved)
    ) then
      perform public.fn_flash_set_available(new.artist_id, v_flash_id, true);
    end if;
  end if;
  return null;
end;
$$;

comment on function public.fn_quotations_flash_availability() is
  'Flash Tattoos: AFTER UPDATE OF quote_status de quotations_db. Aprobada (client_approved) → el flash único queda Reservado; cancelada después de aprobada → Disponible otra vez.';

revoke all on function public.fn_quotations_flash_availability() from public, anon, authenticated;

drop trigger if exists trg_quotations_flash_availability on public.quotations_db;
create trigger trg_quotations_flash_availability
  after update of quote_status on public.quotations_db
  for each row
  when (old.quote_status is distinct from new.quote_status)
  execute function public.fn_quotations_flash_availability();

-- 5. Una sola reserva por flash único ---------------------------------------------
-- La disponibilidad (4) solo marca "Reservado"; esto impide que dos solicitudes
-- del mismo flash único queden aprobadas. El candado por artista + flash
-- serializa dos aprobaciones simultáneas: la segunda espera, vuelve a mirar
-- (cada consulta de plpgsql toma una instantánea nueva) y falla.
create or replace function public.fn_quotations_flash_unique_reservation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_flash_id text;
  v_reserved constant text[] := array['client_approved', 'in_progress', 'en_progreso', 'artist_completed', 'completed'];
begin
  if new.quote_status is distinct from 'client_approved'
     or old.quote_status is not distinct from 'client_approved' then
    return new;
  end if;
  if new.source is distinct from 'flash' or new.flash_snapshot is null or new.artist_id is null then
    return new;
  end if;
  if coalesce(new.flash_snapshot ->> 'mode', 'unique') <> 'unique' then
    return new;
  end if;
  v_flash_id := nullif(btrim(new.flash_snapshot ->> 'id'), '');
  if v_flash_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.artist_id::text || ':' || v_flash_id));

  if exists (
    select 1
      from public.quotations_db other
     where other.id <> new.id
       and other.artist_id = new.artist_id
       and other.source = 'flash'
       and other.flash_snapshot is not null
       and other.flash_snapshot ->> 'id' = v_flash_id
       and other.quote_status = any (v_reserved)
  ) then
    raise exception 'Este flash ya se reservó con otra solicitud. Escríbele al artista para elegir otro diseño.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function public.fn_quotations_flash_unique_reservation() is
  'Flash Tattoos: BEFORE UPDATE OF quote_status de quotations_db. Un flash único no pasa a client_approved si otra cotización del mismo artista y flash ya está aprobada o en curso (todos los roles).';

revoke all on function public.fn_quotations_flash_unique_reservation() from public, anon, authenticated;

drop trigger if exists trg_quotations_flash_unique_reservation on public.quotations_db;
create trigger trg_quotations_flash_unique_reservation
  before update of quote_status on public.quotations_db
  for each row
  when (new.quote_status = 'client_approved' and old.quote_status is distinct from new.quote_status)
  execute function public.fn_quotations_flash_unique_reservation();

-- 6. La instantánea viaja en el mismo guardado ------------------------------------
-- save_web_quotation (la llama el servidor y también save_web_quotation_with_slot)
-- guarda flash_snapshot en el insert y la conserva en el upsert. Se parte de la
-- definición VIVA (puede diferir del repo) y cada reemplazo tiene que encontrar
-- exactamente una ocurrencia; si no, la migración falla sin tocar nada.
do $migration$
declare
  v_def text;
  v_slot_def text;
  v_from text[] := array[
    E'artist_studio_name, artist_session_cost_amount, quotation_medium, source\n  )',
    E'q.artist_studio_name, q.artist_session_cost_amount, q.quotation_medium, q.source\n  )',
    E'    source = excluded.source,\n    updated_at = now()'
  ];
  v_to text[] := array[
    E'artist_studio_name, artist_session_cost_amount, quotation_medium, source, flash_snapshot\n  )',
    E'q.artist_studio_name, q.artist_session_cost_amount, q.quotation_medium, q.source, q.flash_snapshot\n  )',
    E'    source = excluded.source,\n    flash_snapshot = coalesce(excluded.flash_snapshot, quotations_db.flash_snapshot),\n    updated_at = now()'
  ];
  v_count integer;
  i integer;
begin
  -- save_web_quotation_with_slot no debe tener su propio insert: delega en
  -- save_web_quotation. Si algún día lo duplica, hay que aplicarle lo mismo.
  if to_regprocedure('public.save_web_quotation_with_slot(jsonb, jsonb, jsonb)') is not null then
    v_slot_def := pg_get_functiondef('public.save_web_quotation_with_slot(jsonb, jsonb, jsonb)'::regprocedure);
    if position('public.save_web_quotation(' in v_slot_def) = 0
       or v_slot_def ~* 'insert\s+into\s+public\.quotations_db' then
      raise exception 'save_web_quotation_with_slot ya no delega en save_web_quotation: revisa la migración de Flash Tattoos.';
    end if;
  end if;

  v_def := pg_get_functiondef('public.save_web_quotation(jsonb, jsonb)'::regprocedure);
  if position('flash_snapshot' in v_def) > 0 then
    raise notice 'save_web_quotation ya guarda flash_snapshot: sin cambios.';
    return;
  end if;
  for i in 1 .. array_length(v_from, 1) loop
    v_count := (length(v_def) - length(replace(v_def, v_from[i], ''))) / length(v_from[i]);
    if v_count <> 1 then
      raise exception 'save_web_quotation: el reemplazo % encontró % ocurrencias (se esperaba 1).', i, v_count;
    end if;
    v_def := replace(v_def, v_from[i], v_to[i]);
  end loop;
  execute v_def;
end;
$migration$;

-- 7. La galería no vuelve "disponible" un flash ya reservado ------------------------
-- El panel guarda el arreglo entero: una pestaña con datos viejos traería
-- available = true de un flash que ya se reservó. Solo se toca flash.available
-- de esos ítems (la forma del ítem no cambia: el CHECK de la galería sigue igual).
create or replace function public.fn_artists_flash_keep_reserved()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reserved constant text[] := array['client_approved', 'in_progress', 'en_progreso', 'artist_completed', 'completed'];
begin
  if new.user_id is null or jsonb_typeof(new.gallery_feed_items) is distinct from 'array' then
    return new;
  end if;
  if not exists (
    select 1
      from jsonb_array_elements(new.gallery_feed_items) as feed(item)
     where jsonb_typeof(feed.item) = 'object'
       and feed.item ->> 'category' = 'flash'
       and jsonb_typeof(feed.item -> 'flash') = 'object'
       and coalesce(feed.item #>> '{flash,mode}', 'unique') = 'unique'
       and (feed.item #> '{flash,available}') = 'true'::jsonb
       and exists (
         select 1
           from public.quotations_db q
          where q.artist_id = new.user_id
            and q.source = 'flash'
            and q.flash_snapshot is not null
            and q.flash_snapshot ->> 'id' = feed.item ->> 'id'
            and q.quote_status = any (v_reserved)
       )
  ) then
    return new;
  end if;

  new.gallery_feed_items := (
    select coalesce(jsonb_agg(
             case
               when jsonb_typeof(feed.item) = 'object'
                    and feed.item ->> 'category' = 'flash'
                    and jsonb_typeof(feed.item -> 'flash') = 'object'
                    and coalesce(feed.item #>> '{flash,mode}', 'unique') = 'unique'
                    and (feed.item #> '{flash,available}') = 'true'::jsonb
                    and exists (
                      select 1
                        from public.quotations_db q
                       where q.artist_id = new.user_id
                         and q.source = 'flash'
                         and q.flash_snapshot is not null
                         and q.flash_snapshot ->> 'id' = feed.item ->> 'id'
                         and q.quote_status = any (v_reserved)
                    )
                 then jsonb_set(feed.item, '{flash,available}', 'false'::jsonb, true)
               else feed.item
             end
             order by feed.ord), '[]'::jsonb)
      from jsonb_array_elements(new.gallery_feed_items) with ordinality as feed(item, ord)
  );
  return new;
end;
$$;

comment on function public.fn_artists_flash_keep_reserved() is
  'Flash Tattoos: BEFORE UPDATE OF gallery_feed_items de artists_db. Un flash único con una cotización aprobada o en curso queda available = false aunque la pestaña que guarda traiga true.';

revoke all on function public.fn_artists_flash_keep_reserved() from public, anon, authenticated;

drop trigger if exists trg_artists_flash_keep_reserved on public.artists_db;
create trigger trg_artists_flash_keep_reserved
  before update of gallery_feed_items on public.artists_db
  for each row
  execute function public.fn_artists_flash_keep_reserved();

notify pgrst, 'reload schema';

commit;
