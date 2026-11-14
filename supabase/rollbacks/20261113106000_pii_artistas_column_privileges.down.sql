-- Reversa de 20261113106000_pii_artistas_column_privileges.sql.
-- ATENCIÓN: vuelve a exponer TODAS las columnas de artists_db (email, fecha de
-- nacimiento, WhatsApp, dirección y coordenadas exactas) a anon y authenticated.
-- Solo para volver atrás si la migración rompe algo en producción.

-- 1) Privilegios: SELECT de tabla otra vez (los grants por columna quedan
--    subsumidos; se revocan para dejar el catálogo limpio).
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'artists_db';
  if v_cols is not null then
    execute format('revoke select (%s) on public.artists_db from anon, authenticated', v_cols);
  end if;
end;
$$;
grant select on table public.artists_db to anon, authenticated;

-- 2) RPCs
drop function if exists public.get_my_artist_profile();
drop function if exists public.support_list_artists(uuid[]);
-- El código nuevo (artists-repo upsertProfile) llama a esta RPC: revertir el
-- código junto con esta reversa.
drop function if exists public.upsert_my_artist_profile(jsonb);

-- 2b) Funciones convertidas a SECURITY DEFINER: vuelven a invoker y EXECUTE
--     abierto (estado previo por defecto).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('calculate_artist_index', 'calculate_profile_completeness',
                         'validate_studio_booking', 'sync_artists_db_studio_id_from_membership',
                         'check_artist_availability', 'check_style_match',
                         'recalculate_all_artist_indexes')
  loop
    if r.proname in ('calculate_artist_index', 'calculate_profile_completeness') then
      execute format('alter function %s security invoker', r.fn);
      execute format('alter function %s reset search_path', r.fn);
    elsif r.proname = 'validate_studio_booking' then
      -- 20260921212819 la crea con SET search_path = ''.
      execute format('alter function %s security invoker', r.fn);
      execute format('alter function %s set search_path = %L', r.fn, '');
    end if;
    if r.proname not in ('validate_studio_booking') then
      execute format('grant execute on function %s to public', r.fn);
    end if;
  end loop;
end;
$$;

-- 3) Vista v2 original (20260430000003)
drop view if exists public.artists_with_location;
create view public.artists_with_location as
select
  a.id, a.user_id, a.username, a.name, a.profile_picture, a.styles_array,
  a.session_price, a.years_experience, a.languages, a.bio_description,
  a.is_recommended, a.work_type, a.studio_id,
  case when a.studio_id is not null and s.id is not null then 'studio' else 'independent' end as location_source,
  s.name as studio_name,
  s.slug as studio_slug,
  coalesce(sl.country,           a.country)         as country,
  coalesce(sl.country_code,      a.country_code)    as country_code,
  coalesce(sl.state_province,    a.state_province)  as state_province,
  coalesce(sl.city,              a.city)            as city,
  coalesce(sl.locality,          a.locality)        as locality,
  coalesce(sl.street,            a.street)          as street,
  coalesce(sl.street_number,     a.street_number)   as street_number,
  coalesce(sl.unit,              a.unit)            as unit,
  coalesce(sl.postal_code,       a.postal_code)     as postal_code,
  coalesce(sl.formatted_address, a.formatted_address, a.ubicacion) as formatted_address,
  coalesce(sl.latitude,          a.latitude)        as latitude,
  coalesce(sl.longitude,         a.longitude)       as longitude,
  coalesce(sl.google_place_id,   a.google_place_id) as google_place_id,
  s.contact_phone                                   as studio_phone,
  s.instagram                                       as studio_instagram,
  coalesce(sl.geocoded_at,       a.geocoded_at)     as geocoded_at
from public.artists_db a
left join public.studios s
  on  a.studio_id = s.id
  and a.work_type in ('studio', 'both')
left join public.studio_locations sl
  on sl.id = s.primary_location_id;
grant select on public.artists_with_location to anon, authenticated, service_role;

notify pgrst, 'reload schema';
