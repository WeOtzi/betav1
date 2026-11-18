-- ============================================================================
-- Huellas de imágenes (2.8.0, fase 2 del plan de identidad y suplantación)
-- ============================================================================
-- Plan: docs/plans/2026-11-18-kyc-antisuplantacion.md §2.1–2.2
-- Contrato: docs/plans/2026-11-18-kyc-sprints.md («Sprint 2 · Contratos»)
-- Requiere: 20261118130000_account_sanctions.sql (security_alerts,
-- artists_db.sanction_state, studios.sanction_state, artist_is_public).
--
-- Qué agrega:
--   1. image_fingerprints: una fila por imagen publicada (galería, flash, feed
--      del estudio, vistas previas y archivos de diseño de la tienda) con
--      sha256, pHash, pHash espejado y dHash (bit(64)). Al desaparecer la
--      imagen la fila queda con removed_at: es la prueba de antigüedad.
--   2. image_fingerprint_queue: dueños «sucios» (uno por fila). La llenan los
--      triggers de private.image_fp_mark_dirty() y la vacía el trabajo del
--      servidor (lib/image-fingerprint-job.js) cada minuto.
--   3. design_search_log: búsquedas del buscador «¿Dónde está este diseño?»
--      (límite de 20 por usuario cada 24 h). No guarda la foto.
--   4. RPC solo para service_role:
--        search_image_fingerprints  → buscador (solo públicas, sin sanción)
--        image_fp_candidates        → el trabajo: coincidencias de OTROS
--                                     dueños, incluidas las no públicas y las
--                                     borradas (prueba de antigüedad)
--        image_fp_storage_created_at → fechas y versión que fijó Storage
--        image_fp_record_alert      → alerta image_duplicate, una por par
--   5. Índice único parcial en security_alerts sobre payload->>'pair_key'
--      (kind = 'image_duplicate'): una sola alerta por par, aunque soporte la
--      descarte.
--
-- Decisión del dueño: las coincidencias solo avisan a soporte. Nada de esta
-- migración oculta ni modifica los ítems de nadie.
--
-- RLS: soporte (public.is_support_user()) lee; anon y authenticated no tienen
-- otro acceso; escribe solo service_role.
--
-- Reversa: supabase/rollbacks/20261118140000_image_fingerprints.down.sql
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------
create table if not exists public.image_fingerprints (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null,
  -- Dueño. artist_id es el user_id del artista (como quotations_db.artist_id);
  -- studio_id es studios.id. owner_user_id es la cuenta que subió la imagen
  -- (el artista, o el dueño del estudio).
  artist_id uuid null,
  studio_id uuid null,
  owner_user_id uuid null,
  -- Clave estable del ítem dentro del dueño (lib/image-sources.js):
  --   '<artist|studio>:<owner_id>|<bucket>/<path>' · '…|id:<flash_id>' · '…|url:<url>'
  item_key text not null,
  image_url text null,
  storage_bucket text null,
  storage_path text null,
  sha256 text null,
  phash bit(64) null,
  phash_mirror bit(64) null,
  dhash bit(64) null,
  width integer null,
  height integer null,
  status text not null default 'ok',
  -- El ítem se ve en una superficie pública (galería visible, producto activo,
  -- perfil publicado y sin sanción al momento de calcularse). El buscador
  -- además revisa en vivo el estado del dueño.
  is_public boolean not null default false,
  -- Fecha de subida que fijó Storage (storage.objects.created_at); si no hay
  -- objeto, el momento en que el servidor vio la imagen por primera vez.
  first_seen_at timestamptz not null default now(),
  -- Fecha que trae el ítem (created_at/imported_at): la escribe el cliente,
  -- es solo informativa.
  claimed_at timestamptz null,
  removed_at timestamptz null,
  -- Versión del contenido que se huelleó: para objetos de Storage,
  -- '<objects.id>|<objects.version>|<eTag>'. Si cambia (se pisó el archivo o
  -- se borró y se volvió a subir en la misma ruta) el trabajo recalcula.
  content_version text null,
  -- Cuándo terminó sin errores la búsqueda de copias de esta huella. null =
  -- pendiente: el trabajo la vuelve a intentar en el próximo ciclo del dueño.
  match_checked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint image_fingerprints_source_kind_check
    check (source_kind in ('artist_gallery', 'flash', 'studio_feed', 'store_preview', 'store_design')),
  constraint image_fingerprints_status_check
    check (status in ('ok', 'decode_failed', 'skipped_external', 'fetch_failed')),
  constraint image_fingerprints_owner_check
    check (artist_id is not null or studio_id is not null),
  constraint image_fingerprints_item_key_check
    check (char_length(item_key) between 1 and 1200),
  constraint image_fingerprints_image_url_check
    check (image_url is null or char_length(image_url) <= 2048),
  constraint image_fingerprints_storage_check
    check ((storage_bucket is null) = (storage_path is null)
           and (storage_path is null or char_length(storage_path) <= 1024)),
  constraint image_fingerprints_sha256_check
    check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint image_fingerprints_content_version_check
    check (content_version is null or char_length(content_version) <= 300),
  constraint image_fingerprints_size_check
    check ((width is null or width > 0) and (height is null or height > 0)),
  -- Una huella 'ok' tiene todos los hashes.
  constraint image_fingerprints_ok_hashes_check
    check (status <> 'ok' or (sha256 is not null and phash is not null
                              and phash_mirror is not null and dhash is not null)),
  constraint image_fingerprints_source_item_key unique (source_kind, item_key)
);

comment on table public.image_fingerprints is
  'Huellas (sha256, pHash, pHash espejado, dHash) de las imágenes del portfolio, el feed del estudio y la tienda. Las calcula el servidor; al borrarse la imagen queda removed_at como prueba de antigüedad. Solo avisan a soporte: nada se oculta automáticamente.';

create index if not exists image_fingerprints_artist_idx
  on public.image_fingerprints (artist_id, source_kind) where artist_id is not null;
create index if not exists image_fingerprints_studio_idx
  on public.image_fingerprints (studio_id, source_kind) where studio_id is not null;
create index if not exists image_fingerprints_sha_idx
  on public.image_fingerprints (sha256) where sha256 is not null;

drop trigger if exists trg_image_fingerprints_updated_at on public.image_fingerprints;
create trigger trg_image_fingerprints_updated_at
  before update on public.image_fingerprints
  for each row execute function public.set_updated_at();

create table if not exists public.image_fingerprint_queue (
  -- Tabla de origen del dueño: artists_db (owner_id = user_id del artista),
  -- studios (owner_id = studios.id) o store_products (owner_id = seller_id;
  -- cubre también store_design_assets).
  source_table text not null,
  owner_id uuid not null,
  dirty_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text null,
  constraint image_fingerprint_queue_pkey primary key (source_table, owner_id),
  constraint image_fingerprint_queue_source_table_check
    check (source_table in ('artists_db', 'studios', 'store_products')),
  constraint image_fingerprint_queue_attempts_check check (attempts >= 0),
  constraint image_fingerprint_queue_last_error_check
    check (last_error is null or char_length(last_error) <= 500)
);

comment on table public.image_fingerprint_queue is
  'Dueños con imágenes por (re)calcular. La llenan los triggers private.image_fp_mark_dirty y la vacía lib/image-fingerprint-job.js.';

create index if not exists image_fingerprint_queue_dirty_idx
  on public.image_fingerprint_queue (dirty_at);

create table if not exists public.design_search_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  result_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint design_search_log_result_count_check check (result_count between 0 and 100)
);

comment on table public.design_search_log is
  'Búsquedas del buscador de diseños (sin la foto): sirve para el límite de 20 por usuario cada 24 h.';

create index if not exists design_search_log_user_idx
  on public.design_search_log (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. RLS y permisos
-- ---------------------------------------------------------------------------
alter table public.image_fingerprints enable row level security;
alter table public.image_fingerprint_queue enable row level security;
alter table public.design_search_log enable row level security;

revoke all on table public.image_fingerprints from public, anon, authenticated;
revoke all on table public.image_fingerprint_queue from public, anon, authenticated;
revoke all on table public.design_search_log from public, anon, authenticated;

grant select on table public.image_fingerprints to authenticated;
grant select on table public.image_fingerprint_queue to authenticated;
grant select on table public.design_search_log to authenticated;

grant all on table public.image_fingerprints to service_role;
grant all on table public.image_fingerprint_queue to service_role;
grant all on table public.design_search_log to service_role;

drop policy if exists image_fingerprints_support_select on public.image_fingerprints;
create policy image_fingerprints_support_select
  on public.image_fingerprints for select to authenticated
  using (public.is_support_user());

drop policy if exists image_fingerprint_queue_support_select on public.image_fingerprint_queue;
create policy image_fingerprint_queue_support_select
  on public.image_fingerprint_queue for select to authenticated
  using (public.is_support_user());

drop policy if exists design_search_log_support_select on public.design_search_log;
create policy design_search_log_support_select
  on public.design_search_log for select to authenticated
  using (public.is_support_user());

-- ---------------------------------------------------------------------------
-- 3. Marca de «sucio» (patrón de private.gcal_mark_dirty)
-- ---------------------------------------------------------------------------
-- tg_argv[0]: source_table de la cola.
-- tg_argv[1]: columna con el dueño (uuid) o con el producto.
-- tg_argv[2]: 'direct' (uuid del dueño) | 'product' (store_products.id → seller_id).
-- Solo escribe en la cola: nunca toca la fila que disparó.
create or replace function private.image_fp_mark_dirty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_source text := tg_argv[0];
  v_col text := tg_argv[1];
  v_mode text := coalesce(nullif(tg_argv[2], ''), 'direct');
  v_vals text[] := array[]::text[];
  v_owners uuid[];
begin
  if tg_op <> 'DELETE' then
    v_vals := v_vals || (to_jsonb(new) ->> v_col);
  end if;
  if tg_op <> 'INSERT' then
    v_vals := v_vals || (to_jsonb(old) ->> v_col);
  end if;

  if v_mode = 'product' then
    select coalesce(array_agg(distinct p.seller_id), array[]::uuid[])
      into v_owners
      from public.store_products p
     where p.id in (
       select v::uuid from unnest(v_vals) v
        where v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     );
  else
    select coalesce(array_agg(distinct v::uuid), array[]::uuid[])
      into v_owners
      from unnest(v_vals) v
     where v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  end if;

  if coalesce(array_length(v_owners, 1), 0) = 0 then
    return null;
  end if;

  insert into public.image_fingerprint_queue (source_table, owner_id, dirty_at, attempts, last_error)
  select v_source, o, now(), 0, null
    from unnest(v_owners) o
  on conflict (source_table, owner_id) do update
     set dirty_at = excluded.dirty_at,
         attempts = 0,
         last_error = null;
  return null;
end;
$fn$;

revoke all on function private.image_fp_mark_dirty() from public, anon, authenticated;

comment on function private.image_fp_mark_dirty() is
  'Trigger: encola al dueño (artista, estudio o vendedor de la tienda) para que el servidor recalcule las huellas de sus imágenes.';

-- Sin lista de columnas en «after update of …» a propósito: el trigger BEFORE
-- sync_artist_gallery_feed_items reconstruye gallery_feed_items cuando solo
-- se escribe gallery_images, y un «update of gallery_feed_items» no lo vería.
-- La guarda WHEN compara el valor final.

-- artists_db: el feed, la validación de Instagram (cambia qué ítems son
-- públicos) y el estado de alta o sanción.
drop trigger if exists trg_image_fp_dirty_artists_upd on public.artists_db;
create trigger trg_image_fp_dirty_artists_upd
  after update on public.artists_db
  for each row
  when (old.gallery_feed_items is distinct from new.gallery_feed_items
        or old.instagram_verified_at is distinct from new.instagram_verified_at
        or old.instagram_verified_handle is distinct from new.instagram_verified_handle
        or old.registration_status is distinct from new.registration_status
        or old.sanction_state is distinct from new.sanction_state
        or old.user_id is distinct from new.user_id)
  execute function private.image_fp_mark_dirty('artists_db', 'user_id', 'direct');

drop trigger if exists trg_image_fp_dirty_artists_ins_del on public.artists_db;
create trigger trg_image_fp_dirty_artists_ins_del
  after insert or delete on public.artists_db
  for each row
  execute function private.image_fp_mark_dirty('artists_db', 'user_id', 'direct');

-- studios: el feed de fotos, la activación y la sanción.
drop trigger if exists trg_image_fp_dirty_studios_upd on public.studios;
create trigger trg_image_fp_dirty_studios_upd
  after update on public.studios
  for each row
  when (old.photo_feed_items is distinct from new.photo_feed_items
        or old.is_active is distinct from new.is_active
        or old.sanction_state is distinct from new.sanction_state
        or old.user_id is distinct from new.user_id)
  execute function private.image_fp_mark_dirty('studios', 'id', 'direct');

drop trigger if exists trg_image_fp_dirty_studios_ins_del on public.studios;
create trigger trg_image_fp_dirty_studios_ins_del
  after insert or delete on public.studios
  for each row
  execute function private.image_fp_mark_dirty('studios', 'id', 'direct');

-- store_products: las vistas previas y el estado (activo = público).
drop trigger if exists trg_image_fp_dirty_store_products_upd on public.store_products;
create trigger trg_image_fp_dirty_store_products_upd
  after update on public.store_products
  for each row
  when (old.images is distinct from new.images
        or old.status is distinct from new.status
        or old.seller_id is distinct from new.seller_id)
  execute function private.image_fp_mark_dirty('store_products', 'seller_id', 'direct');

drop trigger if exists trg_image_fp_dirty_store_products_ins_del on public.store_products;
create trigger trg_image_fp_dirty_store_products_ins_del
  after insert or delete on public.store_products
  for each row
  execute function private.image_fp_mark_dirty('store_products', 'seller_id', 'direct');

-- store_design_assets: solo admite INSERT y DELETE (store_design_assets_guard).
drop trigger if exists trg_image_fp_dirty_store_design_assets on public.store_design_assets;
create trigger trg_image_fp_dirty_store_design_assets
  after insert or delete on public.store_design_assets
  for each row
  execute function private.image_fp_mark_dirty('store_products', 'product_id', 'product');

-- ---------------------------------------------------------------------------
-- 4. Una sola alerta image_duplicate por par de huellas
-- ---------------------------------------------------------------------------
create unique index if not exists security_alerts_image_pair_key
  on public.security_alerts ((payload ->> 'pair_key'))
  where kind = 'image_duplicate';

-- ---------------------------------------------------------------------------
-- 5. RPC (solo service_role)
-- ---------------------------------------------------------------------------
-- Buscador: solo huellas públicas, no borradas, de perfiles visibles y sin
-- sanción. Distancia de Hamming con el espejo en los dos sentidos.
create or replace function public.search_image_fingerprints(
  p_phash bit(64),
  p_phash_mirror bit(64),
  p_max integer default 12,
  p_threshold integer default 12
)
returns table (
  id uuid,
  source_kind text,
  artist_id uuid,
  studio_id uuid,
  owner_user_id uuid,
  item_key text,
  image_url text,
  first_seen_at timestamptz,
  distance integer
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select f.id, f.source_kind, f.artist_id, f.studio_id, f.owner_user_id,
         f.item_key, f.image_url, f.first_seen_at, d.distance
    from public.image_fingerprints f
    cross join lateral (
      select least(
               bit_count(f.phash # p_phash),
               bit_count(f.phash_mirror # p_phash),
               bit_count(f.phash # coalesce(p_phash_mirror, p_phash))
             )::integer as distance
    ) d
   where f.status = 'ok'
     and f.removed_at is null
     and f.is_public
     and d.distance <= least(greatest(coalesce(p_threshold, 12), 0), 64)
     and (f.artist_id is null or exists (
           select 1 from public.artists_db a
            where a.user_id = f.artist_id
              and public.artist_is_public(a.registration_status, a.sanction_state)))
     and (f.studio_id is null or exists (
           select 1 from public.studios s
            where s.id = f.studio_id
              and s.is_active
              and s.sanction_state = 'none'))
   order by d.distance, f.first_seen_at, f.id
   limit least(greatest(coalesce(p_max, 12), 1), 50);
$fn$;

revoke all on function public.search_image_fingerprints(bit, bit, integer, integer) from public, anon, authenticated;
grant execute on function public.search_image_fingerprints(bit, bit, integer, integer) to service_role;

comment on function public.search_image_fingerprints(bit, bit, integer, integer) is
  'Buscador de diseños: huellas públicas parecidas (pHash y espejo, distancia ≤ p_threshold). Solo service_role (lo llama /api/disenos/buscar).';

-- Trabajo del servidor: coincidencias de OTROS dueños (también no públicas y
-- borradas: sirven como prueba de antigüedad). p_exclude_owner es la cuenta
-- (owner_user_id) o el id del dueño que subió la imagen nueva.
create or replace function public.image_fp_candidates(
  p_phash bit(64),
  p_phash_mirror bit(64),
  p_threshold integer default 8,
  p_exclude_owner uuid default null
)
returns table (
  id uuid,
  source_kind text,
  artist_id uuid,
  studio_id uuid,
  owner_user_id uuid,
  item_key text,
  image_url text,
  sha256 text,
  is_public boolean,
  first_seen_at timestamptz,
  removed_at timestamptz,
  distance integer
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select f.id, f.source_kind, f.artist_id, f.studio_id, f.owner_user_id,
         f.item_key, f.image_url, f.sha256, f.is_public, f.first_seen_at,
         f.removed_at, d.distance
    from public.image_fingerprints f
    cross join lateral (
      select least(
               bit_count(f.phash # p_phash),
               bit_count(f.phash_mirror # p_phash),
               bit_count(f.phash # coalesce(p_phash_mirror, p_phash))
             )::integer as distance
    ) d
   where f.status = 'ok'
     and d.distance <= least(greatest(coalesce(p_threshold, 8), 0), 64)
     and (p_exclude_owner is null or (
           f.owner_user_id is distinct from p_exclude_owner
           and f.artist_id is distinct from p_exclude_owner
           and f.studio_id is distinct from p_exclude_owner))
   order by d.distance, f.first_seen_at, f.id
   limit 20;
$fn$;

revoke all on function public.image_fp_candidates(bit, bit, integer, uuid) from public, anon, authenticated;
grant execute on function public.image_fp_candidates(bit, bit, integer, uuid) to service_role;

comment on function public.image_fp_candidates(bit, bit, integer, uuid) is
  'Coincidencias de otros dueños para el aviso de copia (incluye no públicas y borradas). Solo service_role.';

-- Fechas y versión que fijó Storage (no las puede escribir el cliente):
-- created_at (subida), updated_at (última vez que se pisó) y version
-- ('<id>|<version>|<eTag>'), que cambia si el archivo se reemplaza en la misma
-- ruta.
create or replace function private.image_fp_storage_created_at(p_bucket text, p_paths text[])
returns table (path text, created_at timestamptz, updated_at timestamptz, version text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select o.name, o.created_at, o.updated_at,
         left(concat_ws('|', o.id::text, o.version, o.metadata ->> 'eTag'), 300)
    from storage.objects o
   where p_bucket in ('artist-gallery', 'studio-photos', 'store-previews', 'store-design-files')
     and coalesce(cardinality(p_paths), 0) between 1 and 200
     and o.bucket_id = p_bucket
     and o.name = any (p_paths);
$fn$;

revoke all on function private.image_fp_storage_created_at(text, text[]) from public, anon, authenticated;
grant execute on function private.image_fp_storage_created_at(text, text[]) to service_role;

create or replace function public.image_fp_storage_created_at(p_bucket text, p_paths text[])
returns table (path text, created_at timestamptz, updated_at timestamptz, version text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select s.path, s.created_at, s.updated_at, s.version
    from private.image_fp_storage_created_at(p_bucket, p_paths) s;
$fn$;

revoke all on function public.image_fp_storage_created_at(text, text[]) from public, anon, authenticated;
grant execute on function public.image_fp_storage_created_at(text, text[]) to service_role;

comment on function public.image_fp_storage_created_at(text, text[]) is
  'Envoltorio rpc: created_at, updated_at y versión (storage.objects) de hasta 200 rutas de un bucket de imágenes. Solo service_role.';

-- Alerta image_duplicate idempotente: devuelve la fila nueva o nada si el par
-- ya tenía alerta (abierta, atendida o descartada).
create or replace function public.image_fp_record_alert(
  p_subject_user_id uuid,
  p_related_user_id uuid,
  p_payload jsonb
)
returns setof public.security_alerts
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or coalesce(p_payload ->> 'pair_key', '') = '' then
    raise exception 'image_fp_record_alert: falta payload.pair_key' using errcode = '22023';
  end if;
  return query
    insert into public.security_alerts (kind, status, subject_user_id, related_user_id, payload)
    values ('image_duplicate', 'open', p_subject_user_id, p_related_user_id, p_payload)
    on conflict ((payload ->> 'pair_key')) where kind = 'image_duplicate' do nothing
    returning *;
end;
$fn$;

revoke all on function public.image_fp_record_alert(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.image_fp_record_alert(uuid, uuid, jsonb) to service_role;

comment on function public.image_fp_record_alert(uuid, uuid, jsonb) is
  'Crea la alerta image_duplicate de un par de huellas (payload.pair_key) una sola vez. Solo service_role.';

commit;
