-- Validación de Instagram del artista (modo asistido · paso "portafolio").
-- Las fotos importadas desde Instagram quedan ocultas para los clientes hasta
-- que el artista valida su cuenta: pide un código WO-XXXXXX (le llega por
-- email) y lo manda por mensaje directo a @weotzi. La automatización de DMs o
-- soporte confirman el código en el servidor (services/instagram-verification.js).
--
-- Aditiva e idempotente. APLICADA en flbgmlvfiejfttlawnfu el 2026-10-30 como
-- versión remota 20261030131202 (instagram_verification): 45 fotos de
-- Instagram en 4 artistas quedaron con ig_legacy y gallery_images no cambió.
--
-- Reversa:
--   supabase/rollbacks/20261030120000_instagram_verification.down.sql
--
-- Modelo:
--   artist_instagram_verifications  solicitudes de validación (solo service_role:
--                                   guarda el hash del código, nunca el código).
--   artists_db.instagram_verified_at / instagram_verified_handle
--                                   estado validado. Solo el servidor
--                                   (service_role) o postgres pueden escribirlo;
--                                   un trigger guardián lo impide al artista.
--
-- Visibilidad (misma regla que public/shared/js/gallery-visibility.js):
--   ítem de IG = source 'instagram', permalink con 'instagram.com/', url con
--   '/instagram-import/' o category 'instagram' / 'instagram-reel'.
--   Es público si no es de IG, si tiene ig_legacy = true, o si el artista está
--   validado y el ítem no dice de qué cuenta vino o vino de la cuenta validada.
--   En SQL la validación siempre está "enforced": que esta migración esté
--   aplicada es justamente lo que la activa.
--   gallery_images (la copia que leen job board, solicitudes y previews) pasa a
--   derivarse solo de los ítems públicos. gallery_feed_items no se filtra: el
--   perfil público lo filtra con gallery-visibility.js y el artista ve todo.
--
-- Backfill: cada ítem de IG ya existente recibe "ig_legacy": true y sigue
-- público; la regla aplica a importaciones nuevas. Corre solo en la primera
-- aplicación (si ya existía artist_gallery_item_is_public, no vuelve a marcar
-- importaciones posteriores) y solo toca filas con algún ítem de IG sin marcar.
--
-- RPC get_artist_public_profile_preferences: agrega
--   "instagram_validation": { "enforced": true, "verified": bool, "handle": text|null }.

begin;

-- ===================== solicitudes de validación =====================
create table if not exists public.artist_instagram_verifications (
  id uuid primary key default gen_random_uuid(),
  artist_user_id uuid not null references auth.users (id) on delete cascade,
  ig_handle text not null,
  code_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'expired', 'cancelled', 'rejected')),
  email_sent_to text,
  email_sent boolean not null default false,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verified_at timestamptz,
  verified_via text
    check (verified_via is null or verified_via in ('dm_webhook', 'support')),
  verified_by uuid,
  dm_sender_handle text,
  note text
);

create index if not exists artist_instagram_verifications_artist_idx
  on public.artist_instagram_verifications (artist_user_id, created_at desc);
create index if not exists artist_instagram_verifications_pending_code_idx
  on public.artist_instagram_verifications (code_hash)
  where status = 'pending';

-- Solo el servidor: sin políticas, RLS activa y sin grants para anon/authenticated.
alter table public.artist_instagram_verifications enable row level security;
revoke all on table public.artist_instagram_verifications from public, anon, authenticated;
grant all on table public.artist_instagram_verifications to service_role;

comment on table public.artist_instagram_verifications is
  'Solicitudes de validación de Instagram del artista (código por email + DM a @weotzi). Solo service_role.';
comment on column public.artist_instagram_verifications.code_hash is
  'Hash del código WO-XXXXXX. El código en claro nunca se guarda.';
comment on column public.artist_instagram_verifications.verified_via is
  'dm_webhook (automatización de mensajes directos) o support (confirmación manual).';

-- ===================== estado validado en artists_db =====================
alter table public.artists_db
  add column if not exists instagram_verified_at timestamptz,
  add column if not exists instagram_verified_handle text;

comment on column public.artists_db.instagram_verified_at is
  'Momento en que el artista validó su cuenta de Instagram. Solo lo escribe el servidor.';
comment on column public.artists_db.instagram_verified_handle is
  'Cuenta de Instagram validada (sin @, en minúsculas). Solo la escribe el servidor.';

-- El artista puede editar su fila por PostgREST: sin este guardián podría
-- marcarse como validado. Patrón de enforce_studio_spot_curated_fields
-- (20260829064000), sin la excepción de soporte: soporte confirma desde el
-- servidor, que escribe con service_role.
create or replace function public.enforce_artist_instagram_verification_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(auth.role(), '') = 'service_role'
  then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.instagram_verified_at is not null
       or new.instagram_verified_handle is not null
    then
      raise exception 'Instagram validation is managed by We Otzi.'
        using errcode = '42501';
    end if;
  elsif row(new.instagram_verified_at, new.instagram_verified_handle)
        is distinct from
        row(old.instagram_verified_at, old.instagram_verified_handle)
  then
    raise exception 'Instagram validation is managed by We Otzi.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists artists_db_protect_instagram_verification_fields
  on public.artists_db;
create trigger artists_db_protect_instagram_verification_fields
before insert or update on public.artists_db
for each row execute function public.enforce_artist_instagram_verification_fields();

revoke all on function public.enforce_artist_instagram_verification_fields() from public, anon, authenticated;

comment on function public.enforce_artist_instagram_verification_fields() is
  'Prevents artists from setting or changing their own Instagram validation; only the server (service_role) or postgres can.';

-- ===================== regla de visibilidad =====================
-- Espejo de WoGalleryVisibility.isInstagramItem.
create or replace function public.artist_gallery_item_is_instagram(item jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_typeof(item) = 'object', false)
    and (
      lower(coalesce(item ->> 'source', '')) = 'instagram'
      or coalesce(item ->> 'permalink', '') ilike '%instagram.com/%'
      or coalesce(item ->> 'url', '') like '%/instagram-import/%'
      or lower(coalesce(item ->> 'category', '')) in ('instagram', 'instagram-reel')
    );
$$;

grant execute on function public.artist_gallery_item_is_instagram(jsonb) to anon, authenticated, service_role;

comment on function public.artist_gallery_item_is_instagram(jsonb) is
  'True when a gallery feed item came from the Instagram import (mirror of WoGalleryVisibility.isInstagramItem).';

-- ===================== backfill: importaciones existentes =====================
-- Marca ig_legacy en los ítems de IG que todavía no lo tienen.
-- Corre antes de crear artist_gallery_item_is_public a propósito: si esa
-- función ya existe, la migración ya se aplicó y una re-aplicación no debe
-- "legalizar" importaciones hechas después. El trigger de sincronización
-- vigente recalcula gallery_images en la misma escritura (con todo marcado,
-- la regla vieja y la nueva dan lo mismo).
update public.artists_db as artist
set gallery_feed_items = coalesce((
  select jsonb_agg(
           case
             when public.artist_gallery_item_is_instagram(feed.item)
               then feed.item || '{"ig_legacy": true}'::jsonb
             else feed.item
           end
           order by feed.ord
         )
  from jsonb_array_elements(artist.gallery_feed_items) with ordinality as feed(item, ord)
), artist.gallery_feed_items)
where to_regprocedure('public.artist_gallery_item_is_public(jsonb, timestamptz, text)') is null
  and jsonb_typeof(artist.gallery_feed_items) = 'array'
  and exists (
    select 1
    from jsonb_array_elements(artist.gallery_feed_items) as pending(item)
    where public.artist_gallery_item_is_instagram(pending.item)
      and (pending.item -> 'ig_legacy') is distinct from 'true'::jsonb
  );

-- Espejo de WoGalleryVisibility.isPubliclyVisible con enforced = true.
-- Los handles se normalizan igual que normalizeHandle: trim, sin @ inicial y
-- en minúsculas.
create or replace function public.artist_gallery_item_is_public(
  item jsonb,
  verified_at timestamptz,
  verified_handle text
)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  item_handle text;
begin
  if not public.artist_gallery_item_is_instagram(item) then
    return true;
  end if;

  if (item -> 'ig_legacy') = 'true'::jsonb then
    return true;
  end if;

  if verified_at is null then
    return false;
  end if;

  item_handle := lower(ltrim(btrim(coalesce(item ->> 'ig_handle', ''), E' \t\r\n'), '@'));
  if item_handle = '' then
    return true;
  end if;

  return item_handle = lower(ltrim(btrim(coalesce(verified_handle, ''), E' \t\r\n'), '@'));
end;
$$;

-- El trigger de sincronización corre con el rol de quien escribe la fila
-- (artista, servidor o soporte): todos necesitan ejecutar la regla.
grant execute on function public.artist_gallery_item_is_public(jsonb, timestamptz, text) to anon, authenticated, service_role;

comment on function public.artist_gallery_item_is_public(jsonb, timestamptz, text) is
  'True when a gallery feed item can be shown to other people (mirror of WoGalleryVisibility.isPubliclyVisible, enforced).';

-- ===================== gallery_images solo con ítems públicos =====================
-- Igual que 20260329000000 (el feed manda; sin feed se reconstruye desde la
-- columna legacy), pero la copia legacy lleva solo los ítems públicos.
-- Además, en un UPDATE, ig_legacy se conserva por url: una pestaña abierta
-- antes de esta migración (o un cliente que descarta claves desconocidas) no
-- vuelve a ocultar fotos importadas antes de la validación. Quien quiera
-- quitarlo a propósito escribe "ig_legacy": false.
create or replace function public.sync_artist_gallery_feed_items()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  carried_items jsonb;
  visible_items jsonb;
begin
  if new.gallery_images is null or jsonb_typeof(new.gallery_images) <> 'array' then
    new.gallery_images := '[]'::jsonb;
  end if;

  if new.gallery_feed_items is null then
    new.gallery_feed_items := '[]'::jsonb;
  end if;

  if not (jsonb_typeof(new.gallery_feed_items) = 'array' and jsonb_array_length(new.gallery_feed_items) > 0) then
    if jsonb_array_length(new.gallery_images) = 0 then
      return new;
    end if;
    new.gallery_feed_items := public.artist_gallery_feed_items_from_legacy_images(new.gallery_images);
  end if;

  if tg_op = 'UPDATE' then
    if jsonb_typeof(old.gallery_feed_items) = 'array' then
      select coalesce(jsonb_agg(
               case
                 when jsonb_typeof(feed.item) = 'object'
                      and (feed.item -> 'ig_legacy') is null
                      and exists (
                        select 1
                        from jsonb_array_elements(old.gallery_feed_items) as prev(item)
                        where (prev.item -> 'ig_legacy') = 'true'::jsonb
                          and (prev.item ->> 'url') = (feed.item ->> 'url')
                      )
                   then feed.item || '{"ig_legacy": true}'::jsonb
                 else feed.item
               end
               order by feed.ord
             ), '[]'::jsonb)
        into carried_items
        from jsonb_array_elements(new.gallery_feed_items) with ordinality as feed(item, ord);
      new.gallery_feed_items := carried_items;
    end if;
  end if;

  select coalesce(jsonb_agg(feed.item order by feed.ord), '[]'::jsonb)
    into visible_items
    from jsonb_array_elements(new.gallery_feed_items) with ordinality as feed(item, ord)
   where public.artist_gallery_item_is_public(feed.item, new.instagram_verified_at, new.instagram_verified_handle);

  new.gallery_images := public.artist_gallery_feed_items_to_legacy_images(visible_items);
  return new;
end;
$function$;

-- Al validar (o cambiar la cuenta validada) gallery_images se recalcula aunque
-- el feed no cambie.
drop trigger if exists trigger_sync_artist_gallery_feed_items on public.artists_db;
create trigger trigger_sync_artist_gallery_feed_items
  before insert or update of gallery_images, gallery_feed_items, instagram_verified_at, instagram_verified_handle
  on public.artists_db
  for each row
  execute function public.sync_artist_gallery_feed_items();

-- ===================== RPC pública del perfil =====================
-- Mismo cuerpo que 20260829103500 más el estado de la validación de Instagram.
create or replace function public.get_artist_public_profile_preferences(p_artist_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'privacy', jsonb_build_object(
      'show_city', coalesce((prefs.privacy ->> 'show_city')::boolean, true),
      'show_rating', coalesce((prefs.privacy ->> 'show_rating')::boolean, true),
      'show_socials', coalesce((prefs.privacy ->> 'show_socials')::boolean, true),
      'allow_search_indexing', coalesce((prefs.privacy ->> 'allow_search_indexing')::boolean, false)
    ),
    'profile', jsonb_build_object(
      'full_name', nullif(btrim(prefs.app_settings #>> '{profile,full_name}'), ''),
      'tiktok', nullif(btrim(prefs.app_settings #>> '{profile,tiktok}'), ''),
      'banner_url', nullif(btrim(prefs.app_settings #>> '{profile,banner_url}'), '')
    ),
    'availability', coalesce(prefs.app_settings -> 'availability', '{}'::jsonb),
    'instagram_validation', jsonb_build_object(
      'enforced', true,
      'verified', artist.instagram_verified_at is not null,
      'handle', nullif(btrim(artist.instagram_verified_handle), '')
    )
  )
  from public.artists_db artist
  left join public.user_preferences prefs on prefs.user_id = artist.user_id
  where artist.user_id = p_artist_user_id
  limit 1;
$$;

revoke all on function public.get_artist_public_profile_preferences(uuid) from public;
grant execute on function public.get_artist_public_profile_preferences(uuid) to anon, authenticated;

comment on function public.get_artist_public_profile_preferences(uuid) is
  'Safe public projection for artist profile privacy, public profile extras, weekly availability and Instagram validation state.';

notify pgrst, 'reload schema';

commit;
