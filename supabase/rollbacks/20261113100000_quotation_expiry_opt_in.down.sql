-- Reversa de 20261113100000_quotation_expiry_opt_in.sql
-- Vuelve a la regla de 20261112160000 (expire_stale_quotations con firma
-- (integer, integer, integer)). OJO: esa regla vence TODAS las respuestas a
-- los 14 días; si el job del servidor está prendido, apagalo
-- (QUOTATION_EXPIRY_JOB=off) antes de correr esta reversa.
-- Las cotizaciones que ya pasaron a 'expired' quedan así (historial en
-- quotation_status_history). Se pierden quote_expiry_enabled/quote_expiry_days.

revoke all on function public.expire_stale_quotations(integer, boolean) from service_role;
drop function if exists public.expire_stale_quotations(integer, boolean);

drop trigger if exists trg_quotation_expiry_settings on public.quotations_db;
drop function if exists public.quotation_expiry_settings();
drop index if exists public.quotations_db_expiry_due_idx;
alter table public.quotations_db
  drop constraint if exists quotations_db_quote_expiry_days_check;
alter table public.quotations_db
  drop column if exists quote_expiry_days,
  drop column if exists quote_expiry_enabled;

comment on column public.quotations_db.quote_expires_at is
  'Vigencia de la respuesta del artista. Null = artist_responded_at + vigencia por defecto (14 días o validity_days de la cotización manual).';

-- expire_stale_quotations tal como la dejó 20261112160000:
create or replace function public.expire_stale_quotations(
  p_default_days integer default 14,
  p_pending_days integer default null,
  p_limit integer default 500
)
returns table (
  id integer,
  quote_id text,
  old_status text,
  artist_id uuid,
  client_user_id uuid,
  client_email text,
  client_full_name text,
  artist_name text,
  expired_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '5s'
as $$
#variable_conflict use_column
declare
  v_days integer := greatest(1, least(coalesce(p_default_days, 14), 365));
  v_pending integer := case when p_pending_days is null then null
                            else greatest(1, least(p_pending_days, 365)) end;
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 2000));
begin
  return query
  with due as (
    select q.id as due_id, q.quote_status::text as due_old_status
    from public.quotations_db q
    left join lateral (
      select m.validity_days
      from public.artist_manual_quotes m
      where m.quote_id = q.quote_id::text
        and m.status = 'sent'
      order by m.sent_at desc nulls last
      limit 1
    ) manual on true
    where (
        q.quote_status = 'responded'
        and coalesce(
              q.quote_expires_at,
              coalesce(q.artist_responded_at, q.updated_at, q.created_at)
                + make_interval(days => coalesce(nullif(manual.validity_days, 0), v_days))
            ) <= now()
      )
      or (
        v_pending is not null
        and q.quote_status = 'pending'
        and q.sent_to_artist_at is not null
        and q.sent_to_artist_at + make_interval(days => v_pending) <= now()
      )
    order by q.id
    limit v_limit
    for update of q skip locked
  ),
  upd as (
    update public.quotations_db q
       set quote_status = 'expired'
      from due
     where q.id = due.due_id
       and q.quote_status::text = due.due_old_status
    returning q.id, q.quote_id::text, due.due_old_status, q.artist_id, q.client_user_id,
              q.client_email::text, q.client_full_name::text, q.artist_name::text, q.updated_at
  )
  select * from upd;
end;
$$;

revoke all on function public.expire_stale_quotations(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.expire_stale_quotations(integer, integer, integer) to service_role;
