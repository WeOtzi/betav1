-- Reversa de 20261102130000_studio_matches_unowned_fix.sql: vuelve a la
-- definición de 20261102120000 (que excluye las fichas sin dueño para visitas
-- anónimas; solo para volver atrás de forma exacta).
begin;

create or replace function private.studio_matches(p_name text, p_instagram text default null)
returns table (studio_id uuid, match_kind text)
language sql
stable
security definer
set search_path to ''
as $$
  with q as (
    select private.studio_instagram_key(p_instagram) as ig
  ), scored as (
    select s.id,
           private.studio_name_match(p_name, s.name) as by_name,
           case when q.ig is not null and private.studio_instagram_key(s.instagram) = q.ig then 'instagram' end as by_ig
    from public.studios s, q
    where s.user_id is distinct from auth.uid()
  )
  select id, coalesce(by_name, by_ig)
  from scored
  where by_name is not null or by_ig is not null
  order by case coalesce(by_name, by_ig) when 'exact' then 0 when 'instagram' then 1 else 2 end, id
  limit 8;
$$;

revoke all on function private.studio_matches(text, text) from public, anon, authenticated;

commit;
