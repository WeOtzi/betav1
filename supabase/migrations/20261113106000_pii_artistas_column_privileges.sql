-- Ronda 3c · Grupo "pii-artistas": datos personales de artists_db.
--
-- Problema: las policies SELECT "Public can view artists for marketplace" y
-- "Authenticated can view all artists for marketplace" (20260513000000) dejan
-- leer a anon y a CUALQUIER usuario con sesión TODAS las columnas de los
-- artistas con registro completo: email, fecha de nacimiento, WhatsApp,
-- dirección exacta, coordenadas exactas, datos internos del registro, etc.
-- Además la vista public.artists_with_location (v2, 20260430000003) es
-- SECURITY DEFINER sin filtro: devolvía calle/número/CP/lat-lng exactos de los
-- artistas independientes y también las filas 'incompleto'.
--
-- Qué hace (idempotente; no toca datos):
--   1. Privilegios por columna en artists_db: se revoca el SELECT de tabla a
--      anon y authenticated y se otorga SELECT solo sobre las columnas públicas
--      (lista blanca, intersectada con las columnas que existen de verdad).
--      Las sensibles quedan fuera. RLS sigue decidiendo QUÉ filas.
--      INSERT/UPDATE/DELETE no cambian (siguen gobernados por RLS + guards).
--   2. public.get_my_artist_profile(): security definer, devuelve la fila
--      COMPLETA del propio artista (auth.uid()). El panel, la cuenta, el
--      registro y el login la leen así (PostgREST permite select= y filtros
--      sobre el resultado: rpc/get_my_artist_profile?select=email,...).
--   3. public.support_list_artists(p_user_ids uuid[]): security definer, filas
--      completas solo para soporte/superadmin (public.is_support_user()).
--   4. public.artists_with_location: se recrea SIN datos exactos del artista
--      independiente (sin calle/número/unidad/CP/place_id; lat/lng redondeadas
--      a 2 decimales ≈ 1 km; dirección = ciudad/ubicación declarada). La
--      dirección y coordenadas de la SEDE del estudio siguen exactas (son
--      públicas por diseño). Filtra 'incompleto' igual que la RLS. Suma
--      studio_website, que el explorador pide y la v2 había perdido.
--   5. public.upsert_my_artist_profile(p_profile jsonb): security definer.
--      El upsert del registro desde el navegador (PostgREST upsert on_conflict
--      user_id) ya no funciona con privilegios por columna: `ON CONFLICT DO
--      UPDATE SET birth_date = excluded.birth_date` exige SELECT sobre
--      birth_date (42501, probado en vivo). La RPC fuerza user_id =
--      auth.uid() y solo escribe una lista blanca de columnas editables por el
--      artista (las que manda register.js). Nunca verification_state,
--      is_recommended, embajador, nivel, artist_index, terms_*, instagram_verified_*
--      ni los registration_* que maneja el servidor.
--   6. Funciones SECURITY INVOKER que leen columnas privadas de artists_db y
--      corren con el usuario (trigger update_artist_index → calculate_*,
--      trigger validate_studio_booking → queda invoker): pasan a SECURITY DEFINER con
--      search_path fijo, por ALTER (sin redefinir el cuerpo vivo). Las que no
--      están en el repo y nadie llama (check_artist_availability,
--      check_style_match, recalculate_all_artist_indexes) NO se convierten:
--      solo se les quita EXECUTE a anon (y a authenticated la de recálculo).
--
-- Columnas que se agreguen a artists_db en el futuro NO quedan legibles por
-- anon/authenticated hasta que una migración las otorgue explícitamente
-- (grant select (col) on public.artists_db to anon, authenticated).
--
-- Reversa: supabase/rollbacks/20261113106000_pii_artistas_column_privileges.down.sql

-- (sin begin/commit propios: el runner de migraciones ya la envuelve en una transacción
-- y el script de validación la pega dentro de begin … rollback)

-- 1) Privilegios por columna ---------------------------------------------------

revoke select on table public.artists_db from anon, authenticated;

do $$
declare
  -- Lista blanca: lo que necesitan explore, marketplace, perfil público,
  -- cotizador, job board, spots, estudios y el lado cliente.
  v_public text[] := array[
    'id', 'user_id', 'username', 'name',
    'instagram', 'portafolio', 'profile_links', 'instagram_verified_at',
    'ubicacion', 'city', 'country', 'country_code', 'state_province', 'locality',
    'estudios', 'studio_id', 'work_type',
    'estilo', 'styles_array',
    'session_price', 'session_price_amount', 'session_price_currency',
    'session_price_amount_usd', 'session_price_amount_eur',
    'preferred_display_currency',
    'years_experience', 'bio_description',
    'profile_picture', 'gallery_images', 'gallery_feed_items',
    'languages', 'vacation_start', 'vacation_end',
    'embajador', 'nivel', 'is_recommended', 'verification_state',
    'artist_index', 'idx', 'profile_completeness', 'index_updated_at',
    'registration_status'
  ];
  -- Lista negra explícita (documentación + chequeo): nunca se otorgan.
  v_private text[] := array[
    'email', 'email_confirmed', 'whatsapp_number', 'whatsapp_url', 'birth_date',
    'street', 'street_number', 'unit', 'postal_code', 'formatted_address',
    'google_place_id', 'latitude', 'longitude', 'geocoded_at', 'geocoded_address',
    'subscribed_newsletter', 'newsletter_topics',
    'registration_draft_id', 'registration_source', 'registration_step',
    'registration_started_at', 'registration_last_saved_at', 'registration_submitted_at',
    'terms_accepted_at', 'terms_version', 'instagram_verified_handle',
    'dashboard_config', 'custom_canvas_labels',
    'ms_profile_complete', 'ms_first_quote_received', 'ms_whatsapp_shared',
    'ms_profile_shared', 'ms_first_quote_completed', 'password'
  ];
  v_cols text;
begin
  if v_public && v_private then
    raise exception 'pii-artistas: una columna está en las dos listas';
  end if;

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = 'artists_db'
     and c.column_name = any (v_public);

  if v_cols is null then
    raise exception 'pii-artistas: no se encontró ninguna columna pública en artists_db';
  end if;

  execute format('grant select (%s) on public.artists_db to anon, authenticated', v_cols);
end;
$$;

grant all on table public.artists_db to service_role;

-- 2) Fila completa del propio artista ------------------------------------------

create or replace function public.get_my_artist_profile()
returns setof public.artists_db
language sql
stable
security definer
set search_path = ''
as $$
  select a.*
    from public.artists_db a
   where (select auth.uid()) is not null
     and a.user_id = (select auth.uid());
$$;

comment on function public.get_my_artist_profile() is
  'pii-artistas: fila completa (incluye email, fecha de nacimiento, WhatsApp, dirección exacta) SOLO del artista con sesión. Admite select= y filtros de PostgREST.';

revoke all on function public.get_my_artist_profile() from public, anon;
grant execute on function public.get_my_artist_profile() to authenticated, service_role;

-- 3) Filas completas para soporte ----------------------------------------------

create or replace function public.support_list_artists(p_user_ids uuid[] default null)
returns setof public.artists_db
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_support_user(), false) then
    raise exception 'Solo soporte puede ver los datos completos de los artistas.'
      using errcode = '42501';
  end if;
  return query
    select a.*
      from public.artists_db a
     where p_user_ids is null
        or a.user_id = any (p_user_ids);
end;
$$;

comment on function public.support_list_artists(uuid[]) is
  'pii-artistas: filas completas de artists_db solo para soporte/superadmin (is_support_user()). Admite select=, filtros y order de PostgREST.';

revoke all on function public.support_list_artists(uuid[]) from public, anon;
grant execute on function public.support_list_artists(uuid[]) to authenticated, service_role;

-- 4) Vista pública de ubicación sin datos exactos del artista ---------------

drop view if exists public.artists_with_location;

create view public.artists_with_location
with (security_barrier = true)
as
select
  a.id,
  a.user_id,
  a.username,
  a.name,
  a.profile_picture,
  a.styles_array,
  a.session_price,
  a.years_experience,
  a.languages,
  a.bio_description,
  a.is_recommended,
  a.work_type,
  a.studio_id,
  case when s.id is not null then 'studio' else 'independent' end as location_source,
  s.name                                            as studio_name,
  s.slug                                            as studio_slug,
  coalesce(sl.country,        a.country)            as country,
  coalesce(sl.country_code,   a.country_code)       as country_code,
  coalesce(sl.state_province, a.state_province)     as state_province,
  coalesce(sl.city,           a.city)               as city,
  coalesce(sl.locality,       a.locality)           as locality,
  -- Datos exactos: solo los de la sede del estudio (públicos por diseño).
  sl.street                                         as street,
  sl.street_number                                  as street_number,
  sl.unit                                           as unit,
  sl.postal_code                                    as postal_code,
  case
    when sl.id is not null then coalesce(sl.formatted_address, sl.city)
    else coalesce(
      nullif(btrim(a.ubicacion), ''),
      nullif(concat_ws(', ', nullif(btrim(a.city), ''), nullif(btrim(a.country), '')), '')
    )
  end                                               as formatted_address,
  case
    when sl.id is not null then sl.latitude
    else round(a.latitude::numeric, 2)::double precision
  end                                               as latitude,
  case
    when sl.id is not null then sl.longitude
    else round(a.longitude::numeric, 2)::double precision
  end                                               as longitude,
  sl.google_place_id                                as google_place_id,
  s.contact_phone                                   as studio_phone,
  s.instagram                                       as studio_instagram,
  s.website                                         as studio_website,
  sl.geocoded_at                                    as geocoded_at,
  (sl.id is null and a.latitude is not null)        as location_is_approximate
from public.artists_db a
left join public.studios s
  on  a.studio_id = s.id
  and a.work_type in ('studio', 'both')
left join public.studio_locations sl
  on sl.id = s.primary_location_id
where a.registration_status is distinct from 'incompleto';

comment on view public.artists_with_location is
  'pii-artistas (20261113106000): ubicación pública por artista. Sede del estudio exacta; artista independiente solo ciudad y coordenadas redondeadas a 2 decimales. Sin filas incompleto. SECURITY DEFINER a propósito: lee latitude/longitude (privadas) solo para redondearlas.';

revoke all on public.artists_with_location from public;
grant select on public.artists_with_location to anon, authenticated, service_role;

-- 5) Upsert del perfil propio (registro) -------------------------------------
--
-- Corre como el dueño de la tabla: RLS y los guards (guard_artist_privileged_fields,
-- guard_artist_terms_acceptance, enforce_artist_instagram_verification_fields)
-- lo tratan como escritor privilegiado. Por eso la seguridad está ACÁ:
--   - user_id sale de auth.uid(), nunca del payload (el on conflict solo puede
--     tocar la fila propia);
--   - solo se escriben columnas de v_editable que vengan en el payload y existan;
--     el resto de las claves se ignora (verification_state, is_recommended,
--     embajador, nivel, artist_index, terms_*, registration_draft_id/source/
--     started_at/last_saved_at, instagram_verified_*, dashboard_config, ms_*…);
--   - registration_status: solo 'pendiente de validacion' (lo que manda el envío
--     final del wizard); registration_submitted_at: lo pone el servidor (now()).
-- Un username repetido sigue devolviendo 23505 (register.js lo muestra).

create or replace function public.upsert_my_artist_profile(p_profile jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  -- Lo que hoy manda register.js (envío final del wizard), menos lo que maneja
  -- el servidor.
  v_editable constant text[] := array[
    'name', 'username', 'email',
    'ubicacion', 'city', 'country', 'country_code', 'state_province', 'locality',
    'street', 'street_number', 'unit', 'postal_code', 'formatted_address',
    'google_place_id', 'latitude', 'longitude', 'geocoded_at',
    'styles_array', 'estilo', 'portafolio', 'instagram', 'bio_description',
    'estudios', 'studio_id', 'work_type',
    'session_price', 'session_price_amount', 'session_price_currency',
    'birth_date', 'subscribed_newsletter', 'years_experience',
    'registration_step'
  ];
  v_payload jsonb;
  v_cols text;
  v_vals text;
  v_sets text;
  v_out jsonb;
begin
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión para guardar tu perfil.' using errcode = '42501';
  end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'Perfil inválido.' using errcode = '22023';
  end if;

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    into v_payload
    from jsonb_each(p_profile) e
   where e.key = any (v_editable);

  if p_profile ? 'registration_status' then
    if p_profile ->> 'registration_status' is distinct from 'pendiente de validacion' then
      raise exception 'Estado de registro no permitido.' using errcode = '42501';
    end if;
    v_payload := v_payload || jsonb_build_object('registration_status', 'pendiente de validacion');
  end if;
  if p_profile ? 'registration_submitted_at' then
    v_payload := v_payload || jsonb_build_object('registration_submitted_at', now());
  end if;

  -- Solo columnas que existen de verdad (algunas viven sin migración en el repo).
  select string_agg(quote_ident(att.attname), ', ' order by att.attnum),
         string_agg('r.' || quote_ident(att.attname), ', ' order by att.attnum),
         string_agg(format('%1$I = excluded.%1$I', att.attname), ', ' order by att.attnum)
    into v_cols, v_vals, v_sets
    from pg_attribute att
   where att.attrelid = 'public.artists_db'::regclass
     and att.attnum > 0
     and not att.attisdropped
     and att.attname <> 'user_id'
     and v_payload ? att.attname::text;

  execute format(
    'insert into public.artists_db as a (user_id%1$s)
     select $1%2$s from jsonb_populate_record(null::public.artists_db, $2) r
     on conflict (user_id) do update set %3$s
     returning jsonb_build_object(''id'', a.id, ''user_id'', a.user_id, ''username'', a.username,
                                  ''name'', a.name, ''registration_status'', a.registration_status)',
    case when v_cols is null then '' else ', ' || v_cols end,
    case when v_vals is null then '' else ', ' || v_vals end,
    coalesce(v_sets, 'user_id = excluded.user_id'))
    using v_uid, v_payload
    into v_out;

  return v_out;
end;
$$;

comment on function public.upsert_my_artist_profile(jsonb) is
  'pii-artistas: crea/actualiza la fila propia (user_id = auth.uid()) con una lista blanca de columnas editables por el artista. Reemplaza el upsert on_conflict=user_id del navegador, que falla con privilegios por columna.';

revoke all on function public.upsert_my_artist_profile(jsonb) from public, anon;
grant execute on function public.upsert_my_artist_profile(jsonb) to authenticated, service_role;

-- 6) Funciones que leen columnas privadas de artists_db ------------------------
--
-- Con privilegios por columna, una función SECURITY INVOKER que lee email,
-- whatsapp_number, etc. falla para anon/authenticated. Se convierten por ALTER
-- (no se redefine el cuerpo: la versión viva puede diferir del repo) y se
-- recorren todas las sobrecargas por nombre (si una no existe, no pasa nada).
--   - calculate_artist_index / calculate_profile_completeness: reciben la fila
--     como argumento y devuelven un puntaje (columnas artist_index y
--     profile_completeness, ya públicas). No devuelven datos de terceros. Las
--     llama el trigger update_artist_index en cada insert/update de artists_db.
--   - validate_studio_booking: función de trigger (studio_bookings); no se
--     puede llamar directo. Su EXECUTE ya estaba revocado a authenticated.
--   - sync_artists_db_studio_id_from_membership: trigger; en el repo no lee
--     columnas privadas (solo user_id/studio_id). Se deja invoker: como definer
--     cambiaría studio_id de artistas ajenos saltando RLS.
--   - check_artist_availability, check_style_match, recalculate_all_artist_indexes:
--     no están en el repo ni las llama el código; no se convierten (no se puede
--     revisar que no devuelvan datos de terceros). Solo se cierra EXECUTE.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('calculate_artist_index', 'calculate_profile_completeness',
                         'validate_studio_booking', 'sync_artists_db_studio_id_from_membership',
                         'check_artist_availability', 'check_style_match',
                         'recalculate_all_artist_indexes')
  loop
    if r.proname in ('calculate_artist_index', 'calculate_profile_completeness') then
      execute format('alter function %s security definer', r.fn);
      execute format('alter function %s set search_path = public, pg_temp', r.fn);
      execute format('revoke all on function %s from public, anon', r.fn);
      execute format('grant execute on function %s to authenticated, service_role', r.fn);
    elsif r.proname = 'validate_studio_booking' then
      -- trigger: solo lee artists_db.name (pública) y el email del cliente de la
      -- propia reserva; queda invoker. EXECUTE solo se mira al crear el trigger.
      execute format('revoke all on function %s from public, anon, authenticated', r.fn);
    elsif r.proname = 'sync_artists_db_studio_id_from_membership' then
      -- trigger: EXECUTE solo se mira al crear el trigger.
      execute format('revoke all on function %s from public, anon, authenticated', r.fn);
    elsif r.proname = 'recalculate_all_artist_indexes' then
      execute format('revoke all on function %s from public, anon, authenticated', r.fn);
      execute format('grant execute on function %s to service_role', r.fn);
    else
      execute format('revoke all on function %s from public, anon', r.fn);
      execute format('grant execute on function %s to authenticated, service_role', r.fn);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';

