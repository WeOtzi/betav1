-- Figma Estadisticas demo graph for @isainazartattoo.wo (node 122:12196).
-- Idempotent: only rows carrying this exact referrer marker are replaced.

begin;

do $$
begin
  if not exists (select 1 from public.artists_db where lower(username) = 'isainazartattoo.wo') then
    raise exception 'Statistics seed target artist isainazartattoo.wo was not found';
  end if;
end;
$$;

delete from public.artist_profile_visits v
using public.artists_db a
where a.user_id = v.artist_id
  and lower(a.username) = 'isainazartattoo.wo'
  and v.referrer = '[PRUEBA][STATS-ISAINAZ-20260829]';

-- Twelve identity snapshots reproduce the visible visitor directory. Repeated
-- rows reproduce each person's visit count without inventing auth accounts.
with target as (
  select user_id, username from public.artists_db
  where lower(username) = 'isainazartattoo.wo'
), visitors(name, visitor_type, city, interests, requested, visit_count, last_seen_days) as (
  values
    ('Valentina Cruz',       'client', 'Buenos Aires',  array['Blackwork','Realismo']::text[],       false, 3, 1),
    ('Estudio Tinta Madre',  'studio', 'Montevideo',    array['Fine line']::text[],                   false, 1, 2),
    ('Rodrigo Farías',       'client', 'Rosario',       array['Dotwork']::text[],                     true,  5, 2),
    ('Sofía Lemos',          'client', 'Madrid',        array['Ornamental','Blackwork']::text[],      false, 2, 3),
    ('Estudio Cactus',       'studio', 'Ciudad de México', array['Old school']::text[],                false, 1, 4),
    ('Nicolás Duarte',       'client', 'Santiago',      array['Realismo']::text[],                    false, 1, 5),
    ('Martina Ibáñez',       'client', 'Buenos Aires',  array['Fine line']::text[],                   true,  4, 5),
    ('Estudio Zorro Rojo',   'studio', 'Barcelona',     array['Realismo']::text[],                    false, 2, 6),
    ('Bruno Aquino',         'client', 'Córdoba',       array['Dotwork','Geométrico']::text[],        true,  1, 6),
    ('Camila Ortiz',         'client', 'Buenos Aires',  array['Realismo']::text[],                    true,  1, 7),
    ('Estudio Fierro Negro', 'studio', 'Buenos Aires',  array['Blackwork']::text[],                   false, 1, 8),
    ('Diego Palma',          'client', 'Lima',          array['Old school']::text[],                  false, 2, 9)
), named_events as (
  select v.*, row_number() over ()::integer as identity_n, repeat_n
  from visitors v
  cross join lateral generate_series(1, v.visit_count) repeat_n
)
insert into public.artist_profile_visits (
  artist_id, artist_username, event_kind,
  visitor_user_id, visitor_display_name, visitor_type, visitor_city,
  visitor_interests, requested_quote, city, country,
  device_type, os, browser, device_fingerprint,
  referrer, is_authenticated, created_at
)
select t.user_id, t.username, 'profile_view',
       null, e.name, e.visitor_type, e.city,
       e.interests, e.requested, e.city,
       case when e.city = 'Montevideo' then 'Uruguay'
            when e.city in ('Madrid','Barcelona') then 'España'
            when e.city = 'Ciudad de México' then 'México'
            when e.city = 'Santiago' then 'Chile'
            when e.city = 'Lima' then 'Perú' else 'Argentina' end,
       case when e.identity_n % 3 = 0 then 'mobile' else 'desktop' end,
       case when e.identity_n % 3 = 0 then 'iOS' else 'Windows' end,
       case when e.identity_n % 2 = 0 then 'Chrome' else 'Safari' end,
       'demo-stats-visitor-' || e.identity_n || '-' || e.repeat_n,
       '[PRUEBA][STATS-ISAINAZ-20260829]', false,
       timestamp with time zone '2026-07-31 18:00:00+00'
         - make_interval(days => e.last_seen_days, hours => e.repeat_n - 1)
from named_events e
cross join target t;

-- Anonymous rollup volume completes the exact graph totals without exposing
-- invented identities: 4,820 profile views and 1,340 portfolio visits.
with target as (
  select user_id, username from public.artists_db
  where lower(username) = 'isainazartattoo.wo'
), profile_months(month_start, visits) as (
  values
    (date '2026-02-01', 600), (date '2026-03-01', 720),
    (date '2026-04-01', 800), (date '2026-05-01', 850),
    (date '2026-06-01', 900), (date '2026-07-01', 926)
), portfolio_months(month_start, visits) as (
  values
    (date '2026-02-01', 140), (date '2026-03-01', 180),
    (date '2026-04-01', 210), (date '2026-05-01', 230),
    (date '2026-06-01', 270), (date '2026-07-01', 310)
), generated as (
  select 'profile_view'::text as event_kind, p.month_start, n
  from profile_months p cross join lateral generate_series(1, p.visits) n
  union all
  select 'portfolio_view', p.month_start, n
  from portfolio_months p cross join lateral generate_series(1, p.visits) n
)
insert into public.artist_profile_visits (
  artist_id, artist_username, event_kind, country, device_type,
  device_fingerprint, referrer, is_authenticated, created_at
)
select t.user_id, t.username, g.event_kind, 'Argentina',
       case when g.n % 3 = 0 then 'mobile' else 'desktop' end,
       'demo-stats-' || g.event_kind || '-' || g.month_start || '-' || g.n,
       '[PRUEBA][STATS-ISAINAZ-20260829]', false,
       (g.month_start + ((g.n - 1) % 27) * interval '1 day' + ((g.n - 1) % 14 + 9) * interval '1 hour')::timestamptz
from generated g cross join target t;

-- Top works in the exact order and volume shown by the reference.
with target as (
  select user_id, username from public.artists_db
  where lower(username) = 'isainazartattoo.wo'
), works(artwork_key, artwork_title, views) as (
  values
    ('jaguar-blackwork', 'Jaguar en blackwork', 2340),
    ('retrato-realista-brazo', 'Retrato realista — brazo', 1860),
    ('line-art-minimalista', 'Line art minimalista', 1120)
), generated as (
  select w.*, n from works w cross join lateral generate_series(1, w.views) n
)
insert into public.artist_profile_visits (
  artist_id, artist_username, event_kind, artwork_key, artwork_title,
  country, device_type, device_fingerprint, referrer, is_authenticated, created_at
)
select t.user_id, t.username, 'artwork_view', g.artwork_key, g.artwork_title,
       'Argentina', case when g.n % 3 = 0 then 'mobile' else 'desktop' end,
       'demo-stats-artwork-' || g.artwork_key || '-' || g.n,
       '[PRUEBA][STATS-ISAINAZ-20260829]', false,
       (date '2026-02-01' + ((g.n - 1) % 176) * interval '1 day')::timestamptz
from generated g cross join target t;

commit;

-- Rollback only this statistics dataset:
-- delete from public.artist_profile_visits
-- where referrer = '[PRUEBA][STATS-ISAINAZ-20260829]';
