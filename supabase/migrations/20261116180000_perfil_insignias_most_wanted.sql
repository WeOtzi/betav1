-- ============================================================================
-- Ronda 2 · frente "perfil" · Insignias públicas, compartidos y tarjeta OG
-- (nota P21 de la guía de pruebas + mejora general del perfil público).
--
-- 1) EMBAJADOR. La insignia sale de artists_db.embajador = 'si' (la marca
--    soporte desde el backoffice y el support dashboard; la columna ya es de
--    lectura pública). Como ahora se muestra en el perfil público, se cierra
--    el hueco que dejaba al artista escribírsela a sí mismo por API:
--    trg_guard_artist_embajador solo deja cambiarla a soporte / service-role.
--
-- 2) COMPARTIDOS. public.artist_profile_shares registra cada vez que alguien
--    comparte un perfil (canal, día, hash de IP). Solo la toca el servidor
--    (POST /api/artist/profile-share y el recálculo, service-role): ni el
--    artista ni soporte la leen desde el navegador, porque cada fila trae
--    quién compartió (sharer_user_id) y el hash de su IP.
--
-- 3) MOST WANTED. Perfiles en tendencia por zona, ventana de 30 días.
--      puntaje = 1·visitas (tope 300) + 6·cotizaciones + 4·favoritos
--              + 3·compartidos (tope 40) + 8·trabajos completados
--    - visitas: visitantes únicos por día de artist_profile_visits
--      (event_kind 'profile_view', sin contar al propio artista).
--    - cotizaciones: personas distintas que le pidieron cotización
--      (quotations_db con artist_id, sin borradores 'in_progress'): clientes
--      con cuenta, más hasta 3 correos de solicitudes de invitado. Las
--      cotizaciones manuales (las carga el artista) no cuentan sin un cliente
--      vinculado.
--    - favoritos: client_favorites + (si existe) la función puente
--      public.wo_favorites_artist_counts(timestamptz) -> (artist_user_id uuid,
--      favorites bigint) que el frente "favoritos" puede definir sobre su
--      tabla nueva. Si no existe, no pasa nada.
--    - compartidos: personas distintas por día de artist_profile_shares, sin
--      los del propio artista (is_owner o su sesión).
--    - completados: cotizaciones 'completed' que el cliente cerró desde su
--      cuenta en la ventana ('artist_completed' lo marca el artista solo).
--    Zona: la ciudad del artista si en esa ciudad hay 3 o más perfiles
--    públicos; si no, su país ("resto del país"). Sin ciudad ni país no
--    participa. Ganan los primeros N de cada zona (N = 1 hasta 4 perfiles,
--    2 hasta 8, 3 desde 9; tope p_top_n) que además cumplan el mínimo de
--    actividad: puntaje >= 12, al menos 2 señales distintas y al menos una
--    que el artista no puede generar solo (cotización de un cliente con
--    cuenta, favorito o trabajo cerrado por el cliente). La misma lógica está
--    en lib/most-wanted.js (función pura con tests).
--
--    Materialización:
--      public.artist_trend_scores  conteos y puntaje (PRIVADO: el artista lee
--                                  su fila, soporte todas; anon nada).
--      public.artist_most_wanted   ganadores. anon/authenticated solo leen
--                                  artist_user_id, rank, zone_level,
--                                  awarded_at y computed_at (sin conteos, sin
--                                  la zona: la ciudad puede ser privada).
--    Campo público (documentado en docs/PERFIL_INSIGNIAS.md):
--      rpc get_artist_public_badges(p_artist_user_id) -> jsonb
--        { ambassador, most_wanted, most_wanted_rank, most_wanted_zone,
--          most_wanted_zone_level, most_wanted_since }
--      La zona respeta la privacidad show_city del artista.
--    Recalcula: public.recalculate_most_wanted() (security definer, solo
--    service-role), a diario con pg_cron y por POST
--    /api/perfil/most-wanted/recalculate con X-Cron-Token.
--
-- 4) TARJETA OPEN GRAPH. public.artist_share_cards guarda la ruta de la
--    tarjeta 1200x630 que el navegador del artista compone y sube al bucket
--    público existente profile-pictures (carpeta <user_id>/, políticas de
--    dueño que ya existen). lib/routes/perfil.js la usa como og:image.
--
-- Idempotente. No abre transacción propia.
-- Reversa: supabase/rollbacks/20261116180000_perfil_insignias_most_wanted.down.sql
-- ============================================================================

-- 1) Embajador: solo soporte / service-role ----------------------------------

create or replace function public.guard_artist_embajador()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.wo_is_privileged_writer() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if lower(btrim(coalesce(new.embajador, ''))) not in ('', 'no') then
      raise exception 'El programa de embajadores lo gestiona We Ötzi.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.embajador is distinct from old.embajador then
    raise exception 'El programa de embajadores lo gestiona We Ötzi.' using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_artist_embajador() is
  'artists_db.embajador (insignia pública de embajador) solo la cambian soporte o el servidor.';

revoke execute on function public.guard_artist_embajador() from public, anon, authenticated;

drop trigger if exists trg_guard_artist_embajador on public.artists_db;
create trigger trg_guard_artist_embajador
  before insert or update of embajador on public.artists_db
  for each row execute function public.guard_artist_embajador();

-- 2) Compartidos del perfil ---------------------------------------------------

create table if not exists public.artist_profile_shares (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists_db (user_id) on delete cascade,
  channel text not null default 'other',
  sharer_user_id uuid references auth.users (id) on delete set null,
  is_owner boolean not null default false,
  ip_hash text,
  created_at timestamptz not null default now(),
  constraint artist_profile_shares_channel_check
    check (channel in ('copy', 'native', 'whatsapp', 'instagram', 'story', 'facebook', 'x', 'qr', 'other'))
);

comment on table public.artist_profile_shares is
  'Veces que se compartió un perfil de artista (canal y día). Solo la lee y la escribe el servidor (service_role); alimenta Most Wanted.';

create index if not exists artist_profile_shares_artist_created_idx
  on public.artist_profile_shares (artist_id, created_at desc);
create index if not exists artist_profile_shares_dedupe_idx
  on public.artist_profile_shares (artist_id, ip_hash, channel, created_at desc);
create index if not exists artist_profile_shares_sharer_idx
  on public.artist_profile_shares (sharer_user_id) where sharer_user_id is not null;

alter table public.artist_profile_shares enable row level security;

-- RLS encendido y sin policies: solo service_role. Ninguna pantalla lee esta
-- tabla, y cada fila trae sharer_user_id e ip_hash de quien compartió. Si el
-- panel llega a mostrar "veces compartido", que sea un conteo agregado por RPC
-- o un select acotado a (id, artist_id, channel, created_at).
revoke all on table public.artist_profile_shares from public, anon, authenticated;
grant all on table public.artist_profile_shares to service_role;

-- 3) Most Wanted --------------------------------------------------------------

-- Clave de zona: minúsculas, sin acentos y con espacios colapsados.
create or replace function private.wo_zone_norm(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      translate(lower(btrim(coalesce(p_text, ''))),
                'áéíóúüñàèìòùâêîôûäëïöãõç',
                'aeiouunaeiouaeiouaeioaoc'),
      '\s+', ' ', 'g'),
    '');
$$;

comment on function private.wo_zone_norm(text) is
  'Normaliza ciudad/país para agrupar zonas de Most Wanted (minúsculas, sin acentos).';

create table if not exists public.artist_trend_scores (
  artist_user_id uuid primary key references public.artists_db (user_id) on delete cascade,
  zone_key text,
  zone_label text,
  zone_level text,
  zone_country text,
  zone_size integer not null default 0,
  window_days integer not null default 30,
  visits integer not null default 0,
  quotes integer not null default 0,
  -- De esas, las de clientes con cuenta (las que habilitan la insignia).
  quotes_account integer not null default 0,
  favorites integer not null default 0,
  shares integer not null default 0,
  completed integer not null default 0,
  signals integer not null default 0,
  score numeric(10, 2) not null default 0,
  zone_rank integer,
  most_wanted boolean not null default false,
  computed_at timestamptz not null default now(),
  constraint artist_trend_scores_zone_level_check
    check (zone_level is null or zone_level in ('city', 'country'))
);

comment on table public.artist_trend_scores is
  'Puntaje de tendencia por artista (ventana móvil). PRIVADO: conteos de visitas, cotizaciones, favoritos, compartidos y trabajos.';

alter table public.artist_trend_scores enable row level security;

revoke all on table public.artist_trend_scores from public, anon, authenticated;
grant select on table public.artist_trend_scores to authenticated;
grant all on table public.artist_trend_scores to service_role;

drop policy if exists artist_trend_scores_owner_read on public.artist_trend_scores;
create policy artist_trend_scores_owner_read on public.artist_trend_scores
  for select to authenticated
  using (artist_user_id = (select auth.uid()) or (select public.is_support_user()));

create table if not exists public.artist_most_wanted (
  artist_user_id uuid primary key references public.artists_db (user_id) on delete cascade,
  zone_key text not null,
  zone_label text not null,
  zone_level text not null,
  zone_country text,
  rank smallint not null,
  awarded_at timestamptz not null default now(),
  computed_at timestamptz not null default now(),
  notified_at timestamptz,
  constraint artist_most_wanted_zone_level_check check (zone_level in ('city', 'country')),
  constraint artist_most_wanted_rank_check check (rank between 1 and 10)
);

comment on table public.artist_most_wanted is
  'Artistas con la insignia Most Wanted (top de su zona). Lectura pública solo de artist_user_id, rank, zone_level, awarded_at y computed_at.';

create index if not exists artist_most_wanted_pending_notice_idx
  on public.artist_most_wanted (awarded_at) where notified_at is null;

alter table public.artist_most_wanted enable row level security;

revoke all on table public.artist_most_wanted from public, anon, authenticated;
-- Privilegios por columna: la zona (ciudad) y el aviso no son públicos.
grant select (artist_user_id, rank, zone_level, awarded_at, computed_at)
  on table public.artist_most_wanted to anon, authenticated;
grant all on table public.artist_most_wanted to service_role;

drop policy if exists artist_most_wanted_public_read on public.artist_most_wanted;
create policy artist_most_wanted_public_read on public.artist_most_wanted
  for select to anon, authenticated
  using (true);

create or replace function public.recalculate_most_wanted(
  p_window_days integer default 30,
  p_top_n integer default 3
)
returns table (scored_count integer, zone_count integer, winner_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_window_days, 30), 7), 90);
  v_top integer := least(greatest(coalesce(p_top_n, 3), 1), 10);
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_window_days, 30), 7), 90));
  v_extra jsonb := '{}'::jsonb;
  v_scored integer := 0;
  v_zones integer := 0;
  v_winners integer := 0;
begin
  -- Un recálculo a la vez (cron de la base + job del servidor).
  perform pg_advisory_xact_lock(hashtext('wo_recalculate_most_wanted'));

  -- Puente opcional con la tabla nueva del frente "favoritos".
  if to_regprocedure('public.wo_favorites_artist_counts(timestamp with time zone)') is not null then
    begin
      execute
        'select coalesce(jsonb_object_agg(s.artist_user_id::text, s.favorites), ''{}''::jsonb)
           from (select f.artist_user_id, least(sum(f.favorites), 100000)::bigint as favorites
                   from public.wo_favorites_artist_counts($1) f
                  where f.artist_user_id is not null
                  group by f.artist_user_id) s'
        into v_extra using v_since;
    exception when others then
      raise warning 'recalculate_most_wanted: wo_favorites_artist_counts falló (%).', sqlerrm;
      v_extra := '{}'::jsonb;
    end;
  end if;

  delete from public.artist_trend_scores where true;

  with base as (
    select a.user_id,
           nullif(btrim(a.city), '') as city,
           nullif(btrim(a.country), '') as country,
           nullif(private.wo_zone_norm(a.city), 'sin ciudad') as city_key,
           private.wo_zone_norm(a.country) as country_key
      from public.artists_db a
     where a.user_id is not null
       and a.registration_status is distinct from 'incompleto'
  ),
  city_sizes as (
    select b.city_key, coalesce(b.country_key, '') as country_key, count(*) as n
      from base b
     where b.city_key is not null
     group by 1, 2
  ),
  zoned as (
    select b.user_id,
           b.country as zone_country,
           case
             when b.city_key is not null and (cs.n >= 3 or b.country_key is null) then 'city'
             when b.country_key is not null then 'country'
           end as zone_level,
           case
             when b.city_key is not null and (cs.n >= 3 or b.country_key is null)
               then 'city:' || b.city_key || '|' || coalesce(b.country_key, '')
             when b.country_key is not null then 'country:' || b.country_key
           end as zone_key,
           case
             when b.city_key is not null and (cs.n >= 3 or b.country_key is null) then b.city
             when b.country_key is not null then b.country
           end as zone_label
      from base b
      left join city_sizes cs
        on cs.city_key = b.city_key and cs.country_key = coalesce(b.country_key, '')
  ),
  zone_sizes as (
    select z.zone_key, count(*)::integer as n
      from zoned z
     where z.zone_key is not null
     group by 1
  ),
  v as (
    select pv.artist_id as user_id,
           count(distinct (coalesce(pv.ip_hash, pv.device_fingerprint, pv.visitor_user_id::text, pv.id::text),
                           (pv.created_at at time zone 'utc')::date))::integer as n
      from public.artist_profile_visits pv
     where pv.created_at >= v_since
       and pv.event_kind = 'profile_view'
       and (pv.visitor_user_id is null or pv.visitor_user_id <> pv.artist_id)
     group by 1
  ),
  -- Cotizaciones: personas distintas que le pidieron una.
  --   n_account: clientes con cuenta (sin tope).
  --   n_guest:   correos distintos de solicitudes sin cuenta, tope 3. Las
  --              manuales las carga el propio artista: sin un cliente
  --              vinculado no cuentan.
  q as (
    select qd.artist_id as user_id,
           (count(distinct qd.client_user_id)
              filter (where qd.client_user_id is not null))::integer as n_account,
           least(count(distinct nullif(lower(btrim(qd.client_email)), ''))
                   filter (where qd.client_user_id is null
                             and coalesce(qd.source, '') <> 'manual'
                             and coalesce(qd.quotation_medium, '') <> 'manual'), 3)::integer as n_guest
      from public.quotations_db qd
     where qd.artist_id is not null
       and coalesce(qd.sent_to_artist_at, qd.created_at) >= v_since
       and coalesce(qd.quote_status, '') not in ('in_progress', 'en_progreso')
       and (qd.client_user_id is null or qd.client_user_id <> qd.artist_id)
     group by 1
  ),
  -- Trabajos completados: solo los que cerró el cliente desde su cuenta.
  -- 'artist_completed' lo marca el artista solo y no suma.
  d as (
    select qd.artist_id as user_id, count(*)::integer as n
      from public.quotations_db qd
     where qd.artist_id is not null
       and qd.quote_status = 'completed'
       and qd.client_completed_at >= v_since
       and qd.client_user_id is not null
       and qd.client_user_id <> qd.artist_id
     group by 1
  ),
  f as (
    select cf.artist_user_id as user_id, count(*)::integer as n
      from public.client_favorites cf
     where cf.created_at >= v_since
       and cf.client_user_id <> cf.artist_user_id
     group by 1
  ),
  -- Compartidos: los del propio artista (desde su panel o con su sesión) no suman.
  s as (
    select sh.artist_id as user_id,
           count(distinct (coalesce(sh.ip_hash, sh.sharer_user_id::text, sh.id::text),
                           (sh.created_at at time zone 'utc')::date))::integer as n
      from public.artist_profile_shares sh
     where sh.created_at >= v_since
       and not sh.is_owner
       and (sh.sharer_user_id is null or sh.sharer_user_id <> sh.artist_id)
     group by 1
  ),
  agg as (
    select z.user_id, z.zone_key, z.zone_label, z.zone_level, z.zone_country,
           coalesce(zs.n, 0) as zone_size,
           coalesce(v.n, 0) as visits,
           coalesce(q.n_account, 0) + coalesce(q.n_guest, 0) as quotes,
           coalesce(q.n_account, 0) as quotes_account,
           coalesce(f.n, 0) + least(coalesce((v_extra ->> z.user_id::text)::bigint, 0), 100000)::integer as favorites,
           coalesce(s.n, 0) as shares,
           coalesce(d.n, 0) as completed
      from zoned z
      left join zone_sizes zs on zs.zone_key = z.zone_key
      left join v on v.user_id = z.user_id
      left join q on q.user_id = z.user_id
      left join d on d.user_id = z.user_id
      left join f on f.user_id = z.user_id
      left join s on s.user_id = z.user_id
  ),
  scored as (
    select g.*,
           (least(g.visits, 300) * 1 + g.quotes * 6 + g.favorites * 4
              + least(g.shares, 40) * 3 + g.completed * 8)::numeric(10, 2) as score,
           ((g.visits > 0)::integer + (g.quotes > 0)::integer + (g.favorites > 0)::integer
              + (g.shares > 0)::integer + (g.completed > 0)::integer) as signals
      from agg g
  ),
  -- Mínimo de actividad: puntaje, dos señales y al menos una que el artista
  -- no puede generar solo (un cliente con cuenta que le cotizó, un favorito o
  -- un trabajo que cerró el cliente). Visitas sin sesión, compartidos y
  -- solicitudes de invitado no alcanzan por sí solos.
  ranked as (
    select sc.*,
           (sc.zone_key is not null and sc.score >= 12 and sc.signals >= 2
              and (sc.quotes_account > 0 or sc.favorites > 0 or sc.completed > 0)) as eligible,
           row_number() over (
             partition by sc.zone_key,
                          (sc.zone_key is not null and sc.score >= 12 and sc.signals >= 2
                             and (sc.quotes_account > 0 or sc.favorites > 0 or sc.completed > 0))
             order by sc.score desc, sc.completed desc, sc.quotes desc, sc.user_id
           )::integer as pos
      from scored sc
  )
  insert into public.artist_trend_scores (
    artist_user_id, zone_key, zone_label, zone_level, zone_country, zone_size, window_days,
    visits, quotes, quotes_account, favorites, shares, completed, signals, score, zone_rank, most_wanted, computed_at
  )
  select r.user_id, r.zone_key, r.zone_label, r.zone_level, r.zone_country, r.zone_size, v_days,
         r.visits, r.quotes, r.quotes_account, r.favorites, r.shares, r.completed, r.signals, r.score,
         case when r.eligible then r.pos end,
         r.eligible and r.pos <= least(v_top, greatest(1, ceil(r.zone_size * 0.25)::integer)),
         now()
    from ranked r
   where r.score > 0;

  select count(*)::integer into v_scored from public.artist_trend_scores;
  select count(distinct t.zone_key)::integer into v_zones
    from public.artist_trend_scores t where t.most_wanted;

  insert into public.artist_most_wanted as m (
    artist_user_id, zone_key, zone_label, zone_level, zone_country, rank, awarded_at, computed_at
  )
  select t.artist_user_id, t.zone_key, t.zone_label, t.zone_level, t.zone_country,
         t.zone_rank::smallint, now(), now()
    from public.artist_trend_scores t
   where t.most_wanted
  on conflict (artist_user_id) do update
    set zone_key = excluded.zone_key,
        zone_label = excluded.zone_label,
        zone_level = excluded.zone_level,
        zone_country = excluded.zone_country,
        rank = excluded.rank,
        computed_at = excluded.computed_at;

  -- Quien sale del top pierde la insignia (y el aviso se vuelve a mandar si regresa).
  delete from public.artist_most_wanted mw
   where not exists (
     select 1 from public.artist_trend_scores t
      where t.artist_user_id = mw.artist_user_id and t.most_wanted
   );

  select count(*)::integer into v_winners from public.artist_most_wanted;

  return query select v_scored, v_zones, v_winners;
end;
$$;

comment on function public.recalculate_most_wanted(integer, integer) is
  'Recalcula el puntaje de tendencia (ventana móvil) y la insignia Most Wanted por zona. Solo service-role / cron.';

revoke execute on function public.recalculate_most_wanted(integer, integer) from public, anon, authenticated;
grant execute on function public.recalculate_most_wanted(integer, integer) to service_role;

-- Insignias públicas de un artista (sin conteos; la zona respeta show_city).
create or replace function public.get_artist_public_badges(p_artist_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ambassador', lower(btrim(coalesce(a.embajador, ''))) in ('si', 'sí', 'yes', 'true'),
    'most_wanted', mw.artist_user_id is not null,
    'most_wanted_rank', mw.rank,
    'most_wanted_zone', case
      when mw.artist_user_id is null then null
      when mw.zone_level = 'city' and lower(coalesce(p.privacy ->> 'show_city', 'true')) = 'false'
        then nullif(btrim(coalesce(mw.zone_country, '')), '')
      else mw.zone_label
    end,
    'most_wanted_zone_level', case
      when mw.artist_user_id is null then null
      when mw.zone_level = 'city' and lower(coalesce(p.privacy ->> 'show_city', 'true')) = 'false' then 'country'
      else mw.zone_level
    end,
    'most_wanted_since', mw.awarded_at
  )
  from public.artists_db a
  left join public.artist_most_wanted mw on mw.artist_user_id = a.user_id
  left join public.user_preferences p on p.user_id = a.user_id
  where a.user_id = p_artist_user_id
    and a.registration_status is distinct from 'incompleto'
  limit 1;
$$;

comment on function public.get_artist_public_badges(uuid) is
  'Insignias públicas del artista: ambassador (embajador We Ötzi) y most_wanted (+ rank y zona). Nunca expone conteos.';

revoke execute on function public.get_artist_public_badges(uuid) from public;
grant execute on function public.get_artist_public_badges(uuid) to anon, authenticated, service_role;

-- 4) Tarjeta Open Graph -------------------------------------------------------

create table if not exists public.artist_share_cards (
  artist_user_id uuid primary key references public.artists_db (user_id) on delete cascade,
  og_path text not null,
  signature text,
  width integer not null default 1200,
  height integer not null default 630,
  updated_at timestamptz not null default now(),
  constraint artist_share_cards_og_path_check
    check (og_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/og-card(-[0-9]{10,14})?\.(jpg|png|webp)$'),
  constraint artist_share_cards_own_folder_check
    check (split_part(og_path, '/', 1) = artist_user_id::text),
  constraint artist_share_cards_size_check
    check (width between 600 and 2400 and height between 315 and 1260),
  constraint artist_share_cards_signature_check
    check (signature is null or char_length(signature) <= 64)
);

comment on table public.artist_share_cards is
  'Tarjeta Open Graph 1200x630 del perfil (ruta dentro del bucket público profile-pictures, carpeta del artista).';

create or replace function public.touch_artist_share_card()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.touch_artist_share_card() from public, anon, authenticated;

drop trigger if exists trg_touch_artist_share_card on public.artist_share_cards;
create trigger trg_touch_artist_share_card
  before insert or update on public.artist_share_cards
  for each row execute function public.touch_artist_share_card();

alter table public.artist_share_cards enable row level security;

revoke all on table public.artist_share_cards from public, anon, authenticated;
grant select on table public.artist_share_cards to anon, authenticated;
grant insert, update, delete on table public.artist_share_cards to authenticated;
grant all on table public.artist_share_cards to service_role;

drop policy if exists artist_share_cards_public_read on public.artist_share_cards;
create policy artist_share_cards_public_read on public.artist_share_cards
  for select to anon, authenticated
  using (true);

drop policy if exists artist_share_cards_owner_insert on public.artist_share_cards;
create policy artist_share_cards_owner_insert on public.artist_share_cards
  for insert to authenticated
  with check (artist_user_id = (select auth.uid()));

drop policy if exists artist_share_cards_owner_update on public.artist_share_cards;
create policy artist_share_cards_owner_update on public.artist_share_cards
  for update to authenticated
  using (artist_user_id = (select auth.uid()))
  with check (artist_user_id = (select auth.uid()));

drop policy if exists artist_share_cards_owner_delete on public.artist_share_cards;
create policy artist_share_cards_owner_delete on public.artist_share_cards
  for delete to authenticated
  using (artist_user_id = (select auth.uid()));

-- 5) Recalculo diario y primer cálculo ---------------------------------------

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('recalculate-most-wanted', '40 3 * * *', 'select public.recalculate_most_wanted();');
  end if;
end;
$$;

select public.recalculate_most_wanted();
