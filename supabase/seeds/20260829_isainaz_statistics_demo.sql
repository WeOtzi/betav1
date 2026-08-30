-- Figma Estadisticas demo events for @isainazartattoo.wo (122:12196).
-- Idempotent: only rows carrying this exact referrer marker are replaced.

begin;

do $$
begin
  if not exists (select 1 from public.artists_db where lower(username) = 'isainazartattoo.wo') then
    raise exception 'Statistics seed target artist isainazartattoo.wo was not found';
  end if;
  if not exists (
    select 1 from public.clients_db
    where lower(email) in ('demo-client1@weotzi.test','demo-client2@weotzi.test','demo-client3@weotzi.test')
  ) then
    raise exception 'Statistics seed requires the dashboard demo clients first';
  end if;
end;
$$;

delete from public.artist_profile_visits v
using public.artists_db a
where a.user_id = v.artist_id
  and lower(a.username) = 'isainazartattoo.wo'
  and v.referrer = '[PRUEBA][STATS-ISAINAZ-20260829]';

with target as (
  select user_id, username from public.artists_db
  where lower(username) = 'isainazartattoo.wo'
), visitors as (
  select row_number() over (order by c.email)::integer as n,
         c.user_id, c.full_name, c.city_residence,
         array[case (row_number() over (order by c.email)) % 4
           when 0 then 'Blackwork' when 1 then 'Realismo'
           when 2 then 'Fine line' else 'Dotwork' end]::text[] as interests
  from public.clients_db c
  where lower(c.email) in (
    'demo-client1@weotzi.test',
    'demo-client2@weotzi.test',
    'demo-client3@weotzi.test',
    'demo-newclient3@weotzi.test',
    'demo-newclient33@weotzi.test'
  )
), events as (
  select g as n,
         case when g <= 16 then 'profile_view'
              when g <= 26 then 'portfolio_view'
              else 'artwork_view' end as event_kind,
         case (g - 27) % 3
           when 0 then 'jaguar-blackwork'
           when 1 then 'retrato-realista-brazo'
           else 'line-art-minimalista' end as artwork_key,
         case (g - 27) % 3
           when 0 then 'Jaguar en blackwork'
           when 1 then 'Retrato realista — brazo'
           else 'Line art minimalista' end as artwork_title
  from generate_series(1, 34) g
)
insert into public.artist_profile_visits (
  artist_id, artist_username, event_kind,
  visitor_user_id, visitor_display_name, visitor_type, visitor_city,
  visitor_interests, requested_quote, artwork_key, artwork_title,
  city, country, device_type, os, browser, device_fingerprint,
  referrer, is_authenticated, created_at
)
select t.user_id, t.username, e.event_kind,
       v.user_id, v.full_name, 'client', coalesce(v.city_residence, 'Buenos Aires'),
       v.interests, e.n % 4 = 0,
       case when e.event_kind = 'artwork_view' then e.artwork_key end,
       case when e.event_kind = 'artwork_view' then e.artwork_title end,
       coalesce(v.city_residence, 'Buenos Aires'), 'Argentina',
       case when e.n % 3 = 0 then 'mobile' else 'desktop' end,
       case when e.n % 3 = 0 then 'iOS' else 'Windows' end,
       case when e.n % 2 = 0 then 'Chrome' else 'Safari' end,
       'demo-stats-' || e.n,
       '[PRUEBA][STATS-ISAINAZ-20260829]', true,
       now() - make_interval(hours => e.n * 17)
from events e
cross join target t
join visitors v on v.n = ((e.n - 1) % (select count(*) from visitors)) + 1;

commit;

-- Rollback only this statistics dataset:
-- delete from public.artist_profile_visits
-- where referrer = '[PRUEBA][STATS-ISAINAZ-20260829]';
