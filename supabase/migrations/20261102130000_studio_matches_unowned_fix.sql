-- Corrige private.studio_matches (20261102120000_studio_verification): el
-- filtro "excluir el estudio de quien pregunta" usaba
-- `s.user_id is distinct from auth.uid()`, que para una visita anónima
-- (auth.uid() null) también descartaba todas las fichas sin dueño (null no es
-- distinto de null). El registro no avisaba de fichas del catálogo parecidas
-- ni de su Instagram. Ahora solo se excluye el estudio propio cuando hay sesión.
--
-- Reversa: supabase/rollbacks/20261102130000_studio_matches_unowned_fix.down.sql

begin;

create or replace function private.studio_matches(p_name text, p_instagram text default null)
returns table (studio_id uuid, match_kind text)
language sql
stable
security definer
set search_path to ''
as $$
  with q as (
    select private.studio_instagram_key(p_instagram) as ig, auth.uid() as uid
  ), scored as (
    select s.id,
           private.studio_name_match(p_name, s.name) as by_name,
           case when q.ig is not null and private.studio_instagram_key(s.instagram) = q.ig then 'instagram' end as by_ig
    from public.studios s, q
    where q.uid is null or s.user_id is null or s.user_id <> q.uid
  )
  select id, coalesce(by_name, by_ig)
  from scored
  where by_name is not null or by_ig is not null
  order by case coalesce(by_name, by_ig) when 'exact' then 0 when 'instagram' then 1 else 2 end, id
  limit 8;
$$;

revoke all on function private.studio_matches(text, text) from public, anon, authenticated;

commit;
