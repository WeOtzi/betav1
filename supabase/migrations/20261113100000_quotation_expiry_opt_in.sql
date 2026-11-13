-- Cotizaciones · vencimiento por cotización, opcional (13 nov 2026).
-- Grupo "vencimiento" (output/figma-v3/reports/r3b-vencimiento.md).
--
-- Decisión del dueño: el artista activa o desactiva el vencimiento en CADA
-- cotización y pone la duración en días. Nada vence por defecto.
-- Reemplaza la regla de 20261112160000 (todas las 'responded' vencían a los
-- 14 días o a la validity_days de la cotización manual).
--
--   - quotations_db.quote_expiry_enabled boolean not null default false
--   - quotations_db.quote_expiry_days integer (1–365; null si está apagado)
--   - quote_expires_at (de 20261112160000) pasa a ser derivado: lo calcula el
--     trigger al activar el vencimiento, al cambiar los días o al responder
--     (ahora + días). Al apagarlo queda en null. Si está apagado no cuenta.
--   - Guard (trigger): solo el artista dueño, soporte o service_role cambian
--     quote_expiry_enabled / quote_expiry_days. En un INSERT de otro usuario
--     (el cliente que pide la cotización) se fuerzan los valores por defecto.
--   - expire_stale_quotations: firma nueva (p_limit, p_opt_in_only). Solo
--     vence 'responded' con quote_expiry_enabled. Se BORRA la firma vieja
--     (integer, integer, integer) para que un servidor viejo no pueda seguir
--     venciendo todo, y para que el servidor nuevo contra una base sin esta
--     migración falle cerrado (PGRST202) en vez de usar la regla vieja.
--
-- Aditiva sobre datos (no toca filas existentes: todas quedan con el
-- vencimiento apagado). Idempotente.
-- Reversa: supabase/rollbacks/20261113100000_quotation_expiry_opt_in.down.sql

alter table public.quotations_db
  add column if not exists quote_expiry_enabled boolean not null default false,
  add column if not exists quote_expiry_days integer;

comment on column public.quotations_db.quote_expiry_enabled is
  'El artista activó el vencimiento de esta cotización. Apagado = nunca vence.';
comment on column public.quotations_db.quote_expiry_days is
  'Días de vigencia que eligió el artista (1–365). Null si el vencimiento está apagado.';
comment on column public.quotations_db.quote_expires_at is
  'Vencimiento derivado (trigger trg_quotation_expiry_settings): ahora + quote_expiry_days al activar, cambiar los días o responder. Solo cuenta si quote_expiry_enabled.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quotations_db_quote_expiry_days_check'
      and conrelid = 'public.quotations_db'::regclass
  ) then
    alter table public.quotations_db
      add constraint quotations_db_quote_expiry_days_check check (
        (not quote_expiry_enabled and quote_expiry_days is null)
        or (quote_expiry_enabled and quote_expiry_days between 1 and 365)
      );
  end if;
end;
$$;

create index if not exists quotations_db_expiry_due_idx
  on public.quotations_db (quote_expires_at)
  where quote_expiry_enabled and quote_status = 'responded';

-- Guard + cálculo del vencimiento ------------------------------------------
create or replace function public.quotation_expiry_settings()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_priv boolean := current_user in ('postgres', 'supabase_admin', 'service_role')
                    or coalesce(auth.role(), '') = 'service_role'
                    or coalesce(public.is_support_user(), false);
  v_owner uuid := case when tg_op = 'UPDATE' then old.artist_id else new.artist_id end;
  v_is_owner boolean := auth.uid() is not null and auth.uid() = v_owner;
begin
  if tg_op = 'INSERT' then
    if not v_priv and not v_is_owner then
      new.quote_expiry_enabled := false;
      new.quote_expiry_days := null;
    end if;
  elsif (new.quote_expiry_enabled is distinct from old.quote_expiry_enabled
         or new.quote_expiry_days is distinct from old.quote_expiry_days)
        and not v_priv and not v_is_owner then
    raise exception 'quotation:expiry_forbidden' using errcode = '42501';
  end if;

  if not coalesce(new.quote_expiry_enabled, false) then
    new.quote_expiry_enabled := false;
    new.quote_expiry_days := null;
    if tg_op = 'UPDATE' and old.quote_expiry_enabled then
      new.quote_expires_at := null;
    end if;
    return new;
  end if;

  if new.quote_expiry_days is null or new.quote_expiry_days not between 1 and 365 then
    raise exception 'quotation:expiry_days_invalid' using errcode = '22023';
  end if;

  if tg_op = 'INSERT'
     or not old.quote_expiry_enabled
     or new.quote_expiry_days is distinct from old.quote_expiry_days
     or new.artist_responded_at is distinct from old.artist_responded_at then
    new.quote_expires_at := now() + make_interval(days => new.quote_expiry_days);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_quotation_expiry_settings on public.quotations_db;
create trigger trg_quotation_expiry_settings
  before insert or update of quote_expiry_enabled, quote_expiry_days, artist_responded_at
  on public.quotations_db
  for each row execute function public.quotation_expiry_settings();

-- RPC del job: solo las que tienen el vencimiento activado ------------------
drop function if exists public.expire_stale_quotations(integer, integer, integer);

create or replace function public.expire_stale_quotations(
  p_limit integer default 500,
  p_opt_in_only boolean default true
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
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 2000));
begin
  -- Contrato: nunca hay vencimiento por defecto. El parámetro existe para que
  -- la firma sea distinta de la de 20261112160000 y no se pueda pedir otra cosa.
  if p_opt_in_only is distinct from true then
    raise exception 'quotation:expiry_opt_in_only' using errcode = '22023';
  end if;

  return query
  with due as (
    select q.id as due_id, q.quote_status::text as due_old_status
    from public.quotations_db q
    where q.quote_status = 'responded'
      and q.quote_expiry_enabled
      and q.quote_expiry_days between 1 and 365
      and coalesce(
            q.quote_expires_at,
            coalesce(q.artist_responded_at, q.updated_at, q.created_at)
              + make_interval(days => q.quote_expiry_days)
          ) <= now()
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
       and q.quote_expiry_enabled
    returning q.id, q.quote_id::text, due.due_old_status, q.artist_id, q.client_user_id,
              q.client_email::text, q.client_full_name::text, q.artist_name::text, q.updated_at
  )
  select * from upd;
end;
$$;

revoke all on function public.expire_stale_quotations(integer, boolean) from public, anon, authenticated;
grant execute on function public.expire_stale_quotations(integer, boolean) to service_role;
