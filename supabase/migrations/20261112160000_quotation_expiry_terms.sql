-- Cotizaciones · vencimiento + aceptación de términos (ronda 3, 12 nov 2026).
-- Grupo "cotizaciones" (output/figma-v3/reports/impl-cotizaciones.md).
--
-- P10 · Vencimiento de cotizaciones (Figma 801:556 "Vigencia de la cotización
--       14 días", chip VENCIDA, notificación "Cotización vencida" 801:558).
--   - quotations_db.quote_expires_at: vigencia que eligió el artista al
--     responder (null = respuesta + vigencia por defecto).
--   - expire_stale_quotations(): pasa a 'expired' las respuestas ('responded')
--     cuya vigencia venció. Vigencia = quote_expires_at, o la validity_days de
--     la cotización manual enviada (artist_manual_quotes), o p_default_days
--     (14). Opcional: solicitudes 'pending' sin respuesta tras p_pending_days
--     (null = no se tocan; decisión de producto pendiente). Ambas transiciones
--     las permite fn_quotation_status_change; el trigger registra el
--     historial. No borra datos. Solo service_role (el servidor la llama desde
--     POST /api/quotations/maintenance/expire o el job interno).
--   - Guard: solo el artista dueño (o service_role / soporte) cambia
--     quote_expires_at; el cliente no puede extender la vigencia.
--
-- P3  · Aceptación de términos del registro.
--   - artists_db.terms_accepted_at / terms_version: los escribe el servidor
--     en /api/register/artist-draft (Crear cuenta) y artist-finalize
--     (Revisá y confirmá). El artista no puede reescribirlos desde el cliente.
--
-- Aditiva e idempotente. Reversa: supabase/rollbacks/20261112160000_quotation_expiry_terms.down.sql

-- P10 -----------------------------------------------------------------------
alter table public.quotations_db
  add column if not exists quote_expires_at timestamptz;

comment on column public.quotations_db.quote_expires_at is
  'Vigencia de la respuesta del artista. Null = artist_responded_at + vigencia por defecto (14 días o validity_days de la cotización manual).';

create index if not exists quotations_db_open_status_idx
  on public.quotations_db (quote_status, artist_responded_at)
  where quote_status in ('pending', 'responded');

create or replace function public.guard_quotation_expires_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.quote_expires_at is not distinct from old.quote_expires_at then
    return new;
  end if;
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(auth.role(), '') = 'service_role'
     or coalesce(public.is_support_user(), false)
     or (auth.uid() is not null and auth.uid() = old.artist_id) then
    return new;
  end if;
  raise exception 'quotation:expires_at_forbidden' using errcode = '42501';
end;
$$;

drop trigger if exists trg_guard_quotation_expires_at on public.quotations_db;
create trigger trg_guard_quotation_expires_at
  before update of quote_expires_at on public.quotations_db
  for each row execute function public.guard_quotation_expires_at();

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

-- P3 ------------------------------------------------------------------------
alter table public.artists_db
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;

comment on column public.artists_db.terms_accepted_at is
  'Fecha en que aceptó los Términos y la Política de Privacidad en el registro (lo escribe el servidor).';
comment on column public.artists_db.terms_version is
  'Versión de los términos aceptados (lib/terms-acceptance.js TERMS_VERSION).';

create or replace function public.guard_artist_terms_acceptance()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(auth.role(), '') = 'service_role'
     or coalesce(public.is_support_user(), false) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.terms_accepted_at := null;
    new.terms_version := null;
    return new;
  end if;
  new.terms_accepted_at := old.terms_accepted_at;
  new.terms_version := old.terms_version;
  return new;
end;
$$;

drop trigger if exists trg_guard_artist_terms_acceptance on public.artists_db;
create trigger trg_guard_artist_terms_acceptance
  before insert or update on public.artists_db
  for each row execute function public.guard_artist_terms_acceptance();
