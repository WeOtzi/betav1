-- ============================================================================
-- 20261112200000 · Cuenta / Travel: KPI "Personas interesadas" (Figma 801:1076)
-- ----------------------------------------------------------------------------
-- artist_trips.interested_people_count no tiene escritor (siempre 0). Esta RPC
-- lo calcula al vuelo, sin persistir nada:
--   clientes DISTINTOS (client_user_id o, si falta, email) que le pidieron una
--   cotización a ESTE artista en los últimos 12 meses y quieren tatuarse en la
--   ciudad del viaje (client_city_tattoo_preference) o viven ahí
--   (client_city_residence). Se excluyen las cotizaciones rechazadas.
-- La comparación de ciudad ignora mayúsculas y tildes y busca la ciudad del
-- viaje dentro del texto libre ("Madrid, España" cuenta para "Madrid").
-- Solo el dueño del viaje la puede consultar (auth.uid()); para otro viaje
-- devuelve null. Aditiva e idempotente. Reversa:
-- supabase/rollbacks/20261112200000_cuenta_travel_interest.down.sql
-- ============================================================================

begin;

create or replace function public.count_trip_interested_people(p_trip_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_artist uuid;
  v_city text;
  v_count integer;
begin
  select t.artist_user_id,
         translate(lower(btrim(coalesce(t.city, ''))), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')
    into v_artist, v_city
    from public.artist_trips t
   where t.id = p_trip_id;

  if v_artist is null or auth.uid() is null or v_artist <> auth.uid() then
    return null;
  end if;
  if length(v_city) < 3 then
    return 0;
  end if;

  select count(distinct coalesce(q.client_user_id::text, lower(btrim(q.client_email))))::integer
    into v_count
    from public.quotations_db q
   where q.artist_id = v_artist
     and q.created_at >= now() - interval '12 months'
     and coalesce(q.quote_status, '') not in ('client_rejected', 'rejected', 'cancelled', 'canceled')
     and coalesce(q.client_user_id::text, nullif(btrim(q.client_email), '')) is not null
     and (
       position(v_city in translate(lower(coalesce(q.client_city_tattoo_preference, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')) > 0
       or position(v_city in translate(lower(coalesce(q.client_city_residence, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')) > 0
     );

  return coalesce(v_count, 0);
end;
$$;

comment on function public.count_trip_interested_people(uuid) is
  'Travel 801:1076: clientes distintos que cotizaron con el artista (12 meses) para tatuarse o que viven en la ciudad del viaje. Solo el dueño del viaje; null para otros.';

revoke all on function public.count_trip_interested_people(uuid) from public, anon;
grant execute on function public.count_trip_interested_people(uuid) to authenticated, service_role;

commit;
