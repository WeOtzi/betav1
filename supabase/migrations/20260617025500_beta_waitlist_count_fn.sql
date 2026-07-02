-- Contador honesto de cupos por tipo de usuario, sin exponer PII.
-- Aplicada al proyecto vivo flbgmlvfiejfttlawnfu (2026-06-17).

create or replace function public.beta_waitlist_count(p_user_type text)
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(*)::bigint from public.beta_waitlist where user_type = p_user_type;
$$;

revoke all on function public.beta_waitlist_count(text) from public;
grant execute on function public.beta_waitlist_count(text) to anon, authenticated;

comment on function public.beta_waitlist_count(text) is 'Devuelve solo el conteo de inscritos por tipo de usuario (sin PII). Usado por el contador de cupos en las landing pages.';
