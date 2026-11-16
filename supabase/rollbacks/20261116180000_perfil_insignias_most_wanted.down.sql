-- Reversa de 20261116180000_perfil_insignias_most_wanted.sql
-- Quita el recálculo diario, las insignias públicas, los compartidos, la
-- tarjeta Open Graph y el control de la columna embajador. No borra archivos
-- del bucket profile-pictures (las tarjetas og-card-*.jpg quedan huérfanas y
-- se pueden limpiar a mano).

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'recalculate-most-wanted') then
    perform cron.unschedule('recalculate-most-wanted');
  end if;
end;
$$;

drop function if exists public.get_artist_public_badges(uuid);
drop function if exists public.recalculate_most_wanted(integer, integer);

drop table if exists public.artist_share_cards;
drop function if exists public.touch_artist_share_card();

drop table if exists public.artist_most_wanted;
drop table if exists public.artist_trend_scores;
drop function if exists private.wo_zone_norm(text);

drop table if exists public.artist_profile_shares;

drop trigger if exists trg_guard_artist_embajador on public.artists_db;
drop function if exists public.guard_artist_embajador();
