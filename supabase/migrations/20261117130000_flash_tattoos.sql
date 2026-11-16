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
--      rechazar no cambia nada. Solo se edita ESE ítem del jsonb (por id).
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

notify pgrst, 'reload schema';

commit;
