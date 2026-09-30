create or replace function public.registration_auth_lookup(p_email text)
returns table(id uuid,email text,user_metadata jsonb)
language sql stable security definer set search_path=pg_catalog,pg_temp
as $$ select u.id,u.email::text,u.raw_user_meta_data from auth.users u where lower(u.email)=lower(trim(p_email)) limit 1 $$;
revoke all on function public.registration_auth_lookup(text) from public,anon,authenticated;
grant execute on function public.registration_auth_lookup(text) to service_role;
