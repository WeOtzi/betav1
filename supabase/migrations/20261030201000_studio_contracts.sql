-- =====================================================================
-- M2 · Plataforma de Estudios: contratos registrados
-- Contrato: docs/plans/2026-10-30-estudios-plataforma.md (sección M2).
--
-- Estado: NO APLICADA. Se valida contra la base viva dentro de
-- BEGIN … ROLLBACK junto con M1 y M3–M5 (se aplican juntas y en orden).
-- Dependencias: 20261030200000_studio_affiliations.sql (M1). Usa sus
--   helpers private.lock_studio_artist_pair y reemplaza sus puentes:
--   private.close_open_studio_contracts (ahora cierra contratos de verdad),
--   decide_studio_spot_application (versión final: aceptar = preseleccionar
--   + borrador de contrato) y la vista studio_public_roster (ends_on desde
--   el contrato firmado). El guard de membresías de M1 ya lee
--   current_contract_id vía to_jsonb, así que no se reemplaza.
-- Reversa: supabase/rollbacks/20261030201000_studio_contracts.down.sql
--   (deja la base en el estado de M1).
--
-- Contenido:
--   1. Tabla studio_contracts (número C-YYYY-NNNN, versión, snapshot y
--      hash de términos, firmas) con RLS de solo lectura.
--   2. Columnas nuevas: studio_artist_memberships.current_contract_id y
--      studio_spots.benefit_tags/compensation_model/fixed_*.
--   3. Helpers privados (numeración, listas, snapshot, cierre).
--   4. Guard de postulaciones y cancelación al retirar una postulación.
--   5. RPCs de contratos: borrador, preparación desde postulación o
--      membresía, emisión, firma, rechazo, cancelación, rescisión y
--      vencimientos.
--   6. Parches sobre definiciones vivas: decide_studio_spot_application,
--      respond_to_studio_spot_counter_offer, respond_to_studio_invitation y
--      end_studio_membership.
--   7. Vista studio_public_roster con ends_on.
--   8. Inbox del artista por cada cambio de estado del contrato.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Tabla studio_contracts
-- ---------------------------------------------------------------------

create table if not exists public.studio_contracts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  contract_number text not null,
  version integer not null default 1,
  supersedes_contract_id uuid references public.studio_contracts(id) on delete set null,
  artist_user_id uuid references public.artists_db(user_id) on delete set null,
  membership_id uuid references public.studio_artist_memberships(id) on delete set null,
  spot_id uuid references public.studio_spots(id) on delete set null,
  application_id uuid references public.studio_spot_applications(id) on delete set null,
  origin text not null,
  role text not null,
  location_id uuid references public.studio_locations(id) on delete set null,
  compensation_model text,
  artist_percentage numeric(5,2),
  fixed_amount numeric(12,2),
  fixed_currency text,
  fixed_period text,
  fixed_payer text,
  start_date date,
  end_date date,
  cancellation_notice_days integer,
  includes text[] not null default '{}',
  perks text[] not null default '{}',
  artist_obligations text[] not null default '{}',
  house_rules text,
  terms text,
  status text not null default 'draft',
  sent_at timestamptz,
  expires_at timestamptz,
  studio_signer_name text,
  studio_signed_by uuid,
  studio_signed_at timestamptz,
  artist_signer_name text,
  artist_signed_at timestamptz,
  declined_at timestamptz,
  decline_reason text,
  cancelled_at timestamptz,
  cancel_reason text,
  terminated_at timestamptz,
  terminated_by uuid,
  termination_reason text,
  terms_snapshot jsonb,
  terms_hash text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint studio_contracts_number_version_key unique (studio_id, contract_number, version),
  constraint studio_contracts_number_format check (contract_number ~ '^C-[0-9]{4}-[0-9]{4,}$'),
  constraint studio_contracts_version_check check (version >= 1),
  constraint studio_contracts_origin_check check (origin in ('spot_application', 'invitation', 'request', 'manual')),
  constraint studio_contracts_role_check check (role in ('resident', 'guest', 'itinerant')),
  constraint studio_contracts_compensation_model_check check (compensation_model is null or compensation_model in ('percentage', 'fixed', 'mixed')),
  constraint studio_contracts_artist_percentage_check check (artist_percentage is null or (artist_percentage >= 0 and artist_percentage <= 100)),
  constraint studio_contracts_fixed_amount_check check (fixed_amount is null or fixed_amount >= 0),
  constraint studio_contracts_fixed_currency_check check (fixed_currency is null or fixed_currency ~ '^[A-Z]{3}$'),
  constraint studio_contracts_fixed_period_check check (fixed_period is null or fixed_period in ('per_session', 'daily', 'weekly', 'monthly', 'one_time')),
  constraint studio_contracts_fixed_payer_check check (fixed_payer is null or fixed_payer in ('artist_to_studio', 'studio_to_artist')),
  constraint studio_contracts_notice_days_check check (cancellation_notice_days is null or (cancellation_notice_days >= 0 and cancellation_notice_days <= 365)),
  constraint studio_contracts_house_rules_len check (house_rules is null or char_length(house_rules) <= 5000),
  constraint studio_contracts_terms_len check (terms is null or char_length(terms) <= 20000),
  constraint studio_contracts_reasons_len check (
    (decline_reason is null or char_length(decline_reason) <= 1000)
    and (cancel_reason is null or char_length(cancel_reason) <= 1000)
    and (termination_reason is null or char_length(termination_reason) <= 1000)
  ),
  constraint studio_contracts_signer_names_len check (
    (studio_signer_name is null or char_length(studio_signer_name) <= 160)
    and (artist_signer_name is null or char_length(artist_signer_name) <= 160)
  ),
  constraint studio_contracts_status_check check (status in ('draft', 'sent', 'signed', 'declined', 'cancelled', 'terminated', 'expired')),
  constraint studio_contracts_date_order_check check (end_date is null or start_date is null or end_date >= start_date),
  -- Relajados para borradores (y para borradores cancelados, que nunca se
  -- completaron): todo contrato emitido tiene inicio y modalidad completa.
  constraint studio_contracts_dates_required check (
    status in ('draft', 'cancelled')
    or (start_date is not null and (end_date is null or end_date >= start_date))
  ),
  constraint studio_contracts_compensation_complete check (
    status in ('draft', 'cancelled')
    or (
      compensation_model is not null
      and (compensation_model = 'fixed' or artist_percentage is not null)
      and (compensation_model = 'percentage'
           or (fixed_amount is not null and fixed_currency is not null
               and fixed_period is not null and fixed_payer is not null))
    )
  )
);

comment on table public.studio_contracts is
  'Contratos registrados estudio↔artista. Solo lectura para clientes; toda escritura pasa por RPC. terms_snapshot + terms_hash congelan lo emitido.';
comment on column public.studio_contracts.artist_percentage is
  'Porcentaje de cada tatuaje que se queda el artista.';
comment on column public.studio_contracts.fixed_payer is
  'artist_to_studio = alquiler de puesto; studio_to_artist = sueldo o stipend.';

create unique index if not exists studio_contracts_one_sent_per_pair
  on public.studio_contracts (studio_id, artist_user_id) where status = 'sent';
create unique index if not exists studio_contracts_one_signed_per_membership
  on public.studio_contracts (membership_id) where status = 'signed' and membership_id is not null;
create unique index if not exists studio_contracts_one_open_per_application
  on public.studio_contracts (application_id) where status in ('draft', 'sent') and application_id is not null;
create index if not exists studio_contracts_studio_status_idx
  on public.studio_contracts (studio_id, status, created_at desc);
create index if not exists studio_contracts_artist_status_idx
  on public.studio_contracts (artist_user_id, status);
create index if not exists studio_contracts_membership_idx
  on public.studio_contracts (membership_id) where membership_id is not null;

create or replace function public.set_studio_contracts_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

revoke all on function public.set_studio_contracts_updated_at() from public, anon, authenticated;

drop trigger if exists trigger_studio_contracts_updated_at on public.studio_contracts;
create trigger trigger_studio_contracts_updated_at
  before update on public.studio_contracts
  for each row execute function public.set_studio_contracts_updated_at();

alter table public.studio_contracts enable row level security;
revoke all on public.studio_contracts from anon, authenticated;
grant select on public.studio_contracts to authenticated;

drop policy if exists studio_contracts_owner_select on public.studio_contracts;
create policy studio_contracts_owner_select on public.studio_contracts
  for select to authenticated
  using (
    public.is_support_user()
    or exists (
      select 1 from public.studios s
      where s.id = studio_contracts.studio_id and s.user_id = (select auth.uid())
    )
  );

-- El artista nunca ve los borradores.
drop policy if exists studio_contracts_artist_select on public.studio_contracts;
create policy studio_contracts_artist_select on public.studio_contracts
  for select to authenticated
  using (artist_user_id = (select auth.uid()) and sent_at is not null);

-- ---------------------------------------------------------------------
-- 2. Columnas nuevas en tablas existentes
-- ---------------------------------------------------------------------

alter table public.studio_artist_memberships
  add column if not exists current_contract_id uuid references public.studio_contracts(id) on delete set null;

comment on column public.studio_artist_memberships.current_contract_id is
  'Contrato firmado vigente. Mientras no sea nulo, rol y reparto solo cambian con una nueva versión.';

-- benefit_tags con la misma definición que 20261028170000 (idempotente si
-- esa migración ya corrió o corre después).
alter table public.studio_spots
  add column if not exists benefit_tags text[] not null default array[]::text[],
  add column if not exists compensation_model text,
  add column if not exists fixed_amount numeric(12,2),
  add column if not exists fixed_currency text,
  add column if not exists fixed_period text,
  add column if not exists fixed_payer text;

do $$
declare
  r record;
begin
  for r in
    select v.conname, v.def
    from (values
      ('studio_spots_benefit_tags_len', 'check (cardinality(benefit_tags) <= 6)'),
      ('studio_spots_compensation_model_check', 'check (compensation_model is null or compensation_model in (''percentage'', ''fixed'', ''mixed''))'),
      ('studio_spots_fixed_amount_check', 'check (fixed_amount is null or fixed_amount >= 0)'),
      ('studio_spots_fixed_currency_check', 'check (fixed_currency is null or fixed_currency ~ ''^[A-Z]{3}$'')'),
      ('studio_spots_fixed_period_check', 'check (fixed_period is null or fixed_period in (''per_session'', ''daily'', ''weekly'', ''monthly'', ''one_time''))'),
      ('studio_spots_fixed_payer_check', 'check (fixed_payer is null or fixed_payer in (''artist_to_studio'', ''studio_to_artist''))')
    ) as v(conname, def)
  loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.studio_spots'::regclass and conname = r.conname
    ) then
      execute format('alter table public.studio_spots add constraint %I %s', r.conname, r.def);
    end if;
  end loop;
end;
$$;

comment on column public.studio_spots.benefit_tags is
  'Etiquetas cortas de beneficios del spot (máx. 6). Seguimiento de la postulación del artista.';
comment on column public.studio_spots.compensation_model is
  'Modalidad propia del spot (percentage/fixed/mixed). Si es nula, el contrato se arma con el split y el stipend.';

-- ---------------------------------------------------------------------
-- 3. Helpers privados
-- ---------------------------------------------------------------------

-- C-YYYY-NNNN por estudio y año, asignado al crear el borrador. El FOR
-- UPDATE de la fila del estudio serializa la numeración.
create or replace function private.next_studio_contract_number(p_studio_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_year text := to_char(timezone('utc', now()), 'YYYY');
  v_next integer;
begin
  perform 1 from public.studios s where s.id = p_studio_id for update;
  if not found then
    raise exception 'Estudio no encontrado.' using errcode = '22023';
  end if;

  select coalesce(max((pg_catalog.regexp_match(c.contract_number, '^C-[0-9]{4}-([0-9]+)$'))[1]::integer), 0) + 1
    into v_next
  from public.studio_contracts c
  where c.studio_id = p_studio_id
    and c.contract_number like 'C-' || v_year || '-%';

  return 'C-' || v_year || '-' || case when v_next < 10000 then lpad(v_next::text, 4, '0') else v_next::text end;
end;
$$;

revoke all on function private.next_studio_contract_number(uuid) from public, anon, authenticated;

-- Lista editable estricta (borradores): hasta 20 ítems de hasta 200
-- caracteres, sin vacíos.
create or replace function private.contract_text_array(p_value jsonb, p_label text)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_text text;
  v_out text[] := array[]::text[];
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return v_out;
  end if;
  if jsonb_typeof(p_value) <> 'array' then
    raise exception '"%" tiene que ser una lista.', p_label using errcode = '22023';
  end if;
  if jsonb_array_length(p_value) > 20 then
    raise exception '"%" admite hasta 20 ítems.', p_label using errcode = '22023';
  end if;
  for v_item in select e.value from jsonb_array_elements(p_value) as e(value) loop
    if jsonb_typeof(v_item) <> 'string' then
      raise exception '"%" solo admite textos.', p_label using errcode = '22023';
    end if;
    v_text := btrim(v_item #>> '{}');
    if v_text = '' then
      raise exception '"%" no admite ítems vacíos.', p_label using errcode = '22023';
    end if;
    if char_length(v_text) > 200 then
      raise exception 'Cada ítem de "%" admite hasta 200 caracteres.', p_label using errcode = '22023';
    end if;
    v_out := array_append(v_out, v_text);
  end loop;
  return v_out;
end;
$$;

revoke all on function private.contract_text_array(jsonb, text) from public, anon, authenticated;

-- Versión tolerante para los borradores preparados desde spots o
-- invitaciones: nunca falla, recorta a 20 ítems de 200 caracteres.
create or replace function private.clean_contract_text_array(p_items text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(x.item order by x.ord), array[]::text[])
  from (
    select left(btrim(t.item), 200) as item, t.ord
    from unnest(coalesce(p_items, array[]::text[])) with ordinality as t(item, ord)
    where nullif(btrim(t.item), '') is not null
    order by t.ord
    limit 20
  ) x;
$$;

revoke all on function private.clean_contract_text_array(text[]) from public, anon, authenticated;

-- Términos congelados al emitir. jsonb normaliza el orden de las claves, así
-- que el texto es estable para el hash.
create or replace function private.build_studio_contract_snapshot(p_contract_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  c public.studio_contracts%rowtype;
  v_studio public.studios%rowtype;
  v_artist public.artists_db%rowtype;
  v_location public.studio_locations%rowtype;
  v_spot public.studio_spots%rowtype;
  v_email text;
begin
  select * into c from public.studio_contracts x where x.id = p_contract_id;
  select * into v_studio from public.studios s where s.id = c.studio_id;
  select * into v_artist from public.artists_db a where a.user_id = c.artist_user_id;
  select u.email into v_email from auth.users u where u.id = c.artist_user_id;
  if c.location_id is not null then
    select * into v_location from public.studio_locations l where l.id = c.location_id;
  end if;
  if c.spot_id is not null then
    select * into v_spot from public.studio_spots sp where sp.id = c.spot_id;
  end if;

  return jsonb_build_object(
    'contract_number', c.contract_number,
    'version', c.version,
    'supersedes_contract_id', c.supersedes_contract_id,
    'origin', c.origin,
    'studio', jsonb_build_object('id', v_studio.id, 'name', v_studio.name, 'slug', v_studio.slug),
    'artist', jsonb_build_object(
      'user_id', c.artist_user_id,
      'name', v_artist.name,
      'username', v_artist.username,
      'email', coalesce(v_email, v_artist.email)
    ),
    'role', c.role,
    'location', case when v_location.id is null then null else jsonb_build_object(
      'id', v_location.id, 'label', v_location.label,
      'formatted_address', v_location.formatted_address,
      'city', v_location.city, 'country', v_location.country
    ) end,
    'spot', case when v_spot.id is null then null else jsonb_build_object(
      'id', v_spot.id, 'title', v_spot.title, 'kind', v_spot.kind
    ) end,
    'compensation', jsonb_build_object(
      'model', c.compensation_model,
      'artist_percentage', c.artist_percentage,
      'fixed_amount', c.fixed_amount,
      'fixed_currency', c.fixed_currency,
      'fixed_period', c.fixed_period,
      'fixed_payer', c.fixed_payer
    ),
    'start_date', c.start_date,
    'end_date', c.end_date,
    'cancellation_notice_days', c.cancellation_notice_days,
    'includes', to_jsonb(c.includes),
    'perks', to_jsonb(c.perks),
    'artist_obligations', to_jsonb(c.artist_obligations),
    'house_rules', c.house_rules,
    'terms', c.terms
  );
end;
$$;

revoke all on function private.build_studio_contract_snapshot(uuid) from public, anon, authenticated;

-- Reemplaza el stub de M1: cierra los contratos abiertos de una membresía o
-- de una postulación. Con p_to_status='declined' los 'sent' pasan a
-- 'declined' (el artista los vio) y los borradores a 'cancelled'.
create or replace function private.close_open_studio_contracts(
  p_membership_id uuid,
  p_application_id uuid,
  p_to_status text,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 1000);
  v_count integer;
begin
  if p_to_status is null or p_to_status not in ('cancelled', 'declined') then
    raise exception 'Estado de cierre de contrato inválido.' using errcode = '22023';
  end if;
  if p_membership_id is null and p_application_id is null then
    return 0;
  end if;

  update public.studio_contracts c
  set status = case when p_to_status = 'declined' and c.status = 'sent' then 'declined' else 'cancelled' end,
      declined_at = case when p_to_status = 'declined' and c.status = 'sent' then v_now else c.declined_at end,
      decline_reason = case when p_to_status = 'declined' and c.status = 'sent' then v_reason else c.decline_reason end,
      cancelled_at = case when p_to_status = 'declined' and c.status = 'sent' then c.cancelled_at else v_now end,
      cancel_reason = case when p_to_status = 'declined' and c.status = 'sent' then c.cancel_reason else v_reason end
  where c.status in ('draft', 'sent')
    and ((p_membership_id is not null and c.membership_id = p_membership_id)
      or (p_application_id is not null and c.application_id = p_application_id));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.close_open_studio_contracts(uuid, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Postulaciones: guard y cancelación al retirar
-- ---------------------------------------------------------------------

-- 'accepted' solo lo pone sign_studio_contract. El artista solo retira; el
-- dueño solo marca vista, preselecciona o rechaza. Las postulaciones nuevas
-- entran siempre como 'pending'.
create or replace function private.guard_spot_application_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean;
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(auth.role(), '') = 'service_role'
     or public.is_support_user() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'pending'
       or new.decided_at is not null
       or new.decided_by_user_id is not null then
      raise exception 'Las postulaciones nuevas quedan pendientes hasta que el estudio las revise.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.spot_id is distinct from old.spot_id
     or new.artist_user_id is distinct from old.artist_user_id then
    raise exception 'No podés cambiar el spot ni el artista de una postulación.' using errcode = '42501';
  end if;

  if v_uid is not null and v_uid = old.artist_user_id then
    if new.decided_by_user_id is distinct from old.decided_by_user_id then
      raise exception 'La decisión de la postulación la registra el estudio.' using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      if not (old.status in ('pending', 'viewed', 'shortlisted') and new.status = 'withdrawn') then
        raise exception 'Solo podés retirar una postulación que sigue abierta.' using errcode = '23514';
      end if;
      new.decided_at := timezone('utc', now());
    elsif new.decided_at is distinct from old.decided_at then
      raise exception 'La decisión de la postulación la registra el estudio.' using errcode = '42501';
    end if;
    if row(new.message, new.portfolio_url, new.requested_dates)
         is distinct from row(old.message, old.portfolio_url, old.requested_dates)
       and old.status not in ('pending', 'viewed', 'shortlisted') then
      raise exception 'La postulación ya está cerrada.' using errcode = '23514';
    end if;
    return new;
  end if;

  select exists (
    select 1
    from public.studio_spots sp
    join public.studios s on s.id = sp.studio_id
    where sp.id = old.spot_id and s.user_id = v_uid
  ) into v_is_owner;
  if v_uid is null or not coalesce(v_is_owner, false) then
    raise exception 'No tenés permiso para editar esta postulación.' using errcode = '42501';
  end if;

  if row(new.message, new.portfolio_url, new.requested_dates)
       is distinct from row(old.message, old.portfolio_url, old.requested_dates) then
    raise exception 'El mensaje, el portfolio y las fechas de la postulación los edita el artista.' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'accepted' then
      raise exception 'La postulación queda aceptada cuando el artista firma el contrato.' using errcode = '23514';
    end if;
    if not (old.status in ('pending', 'viewed', 'shortlisted')
            and new.status in ('viewed', 'shortlisted', 'rejected')) then
      raise exception 'Ese cambio de estado de la postulación no está permitido.' using errcode = '23514';
    end if;
    if new.status = 'rejected' then
      new.decided_at := coalesce(new.decided_at, timezone('utc', now()));
    end if;
  end if;
  if new.decided_by_user_id is distinct from old.decided_by_user_id
     or (new.status is distinct from old.status and new.status = 'rejected') then
    new.decided_by_user_id := v_uid;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_spot_application_write() from public, anon, authenticated;

drop trigger if exists trg_guard_spot_application_write on public.studio_spot_applications;
create trigger trg_guard_spot_application_write
  before insert or update on public.studio_spot_applications
  for each row execute function private.guard_spot_application_write();

-- Si el artista retira la postulación, o el estudio la rechaza por escritura
-- directa (el guard lo permite), sus contratos abiertos se cancelan: un
-- contrato ya enviado no puede firmarse sobre una postulación cerrada.
create or replace function private.cancel_contracts_on_application_withdrawn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'withdrawn' and old.status is distinct from 'withdrawn' then
    perform private.close_open_studio_contracts(null, new.id, 'cancelled', 'El artista retiró la postulación');
  elsif new.status = 'rejected' and old.status is distinct from 'rejected' then
    perform private.close_open_studio_contracts(null, new.id, 'cancelled', 'La postulación fue rechazada');
  end if;
  return null;
end;
$$;

revoke all on function private.cancel_contracts_on_application_withdrawn() from public, anon, authenticated;

drop trigger if exists trg_spot_application_withdrawn_contracts on public.studio_spot_applications;
create trigger trg_spot_application_withdrawn_contracts
  after update of status on public.studio_spot_applications
  for each row execute function private.cancel_contracts_on_application_withdrawn();

-- ---------------------------------------------------------------------
-- 5. RPCs de contratos
-- ---------------------------------------------------------------------

-- Crea o edita un borrador. Lista blanca de claves; el resto se ignora.
create or replace function public.save_studio_contract_draft(p_contract jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_is_update boolean;
  v_existing public.studio_contracts%rowtype;
  v_superseded public.studio_contracts%rowtype;
  v_membership public.studio_artist_memberships%rowtype;
  v_application public.studio_spot_applications%rowtype;
  v_studio_id uuid;
  v_artist uuid;
  v_origin text;
  v_membership_id uuid;
  v_spot_id uuid;
  v_application_id uuid;
  v_role text;
  v_location_id uuid;
  v_model text;
  v_pct numeric;
  v_fixed_amount numeric;
  v_fixed_currency text;
  v_fixed_period text;
  v_fixed_payer text;
  v_start date;
  v_end date;
  v_notice integer;
  v_includes text[];
  v_perks text[];
  v_obligations text[];
  v_house_rules text;
  v_terms text;
  v_supersedes uuid;
  v_number text;
  v_version integer;
begin
  if v_uid is null then
    raise exception 'Iniciá sesión.' using errcode = '42501';
  end if;
  if p_contract is null or jsonb_typeof(p_contract) <> 'object' then
    raise exception 'Faltan los datos del contrato.' using errcode = '22023';
  end if;

  v_id := nullif(btrim(coalesce(p_contract->>'id', '')), '')::uuid;
  v_is_update := v_id is not null;

  if v_is_update then
    select * into v_existing from public.studio_contracts c where c.id = v_id;
    if not found then
      raise exception 'Contrato no encontrado.' using errcode = '22023';
    end if;
    v_studio_id := v_existing.studio_id;
    v_artist := v_existing.artist_user_id;
    if p_contract ? 'studio_id'
       and nullif(p_contract->>'studio_id', '')::uuid is distinct from v_studio_id then
      raise exception 'El estudio de un contrato no se puede cambiar.' using errcode = '22023';
    end if;
    if p_contract ? 'artist_user_id'
       and nullif(p_contract->>'artist_user_id', '')::uuid is distinct from v_artist then
      raise exception 'El artista de un contrato no se puede cambiar.' using errcode = '22023';
    end if;
    if p_contract ? 'origin' and (p_contract->>'origin') is distinct from v_existing.origin then
      raise exception 'El origen de un contrato no se puede cambiar.' using errcode = '22023';
    end if;
    if p_contract ? 'supersedes_contract_id'
       and nullif(p_contract->>'supersedes_contract_id', '')::uuid is distinct from v_existing.supersedes_contract_id then
      raise exception 'El contrato que se reemplaza se fija al crear la nueva versión.' using errcode = '22023';
    end if;
  else
    v_studio_id := nullif(p_contract->>'studio_id', '')::uuid;
    v_artist := nullif(p_contract->>'artist_user_id', '')::uuid;
    if v_studio_id is null then
      raise exception 'Indicá el estudio del contrato.' using errcode = '22023';
    end if;
    if v_artist is null then
      raise exception 'Indicá el artista del contrato.' using errcode = '22023';
    end if;
  end if;

  if not (
    exists (select 1 from public.studios s where s.id = v_studio_id and s.user_id = v_uid)
    or public.is_support_user()
  ) then
    raise exception 'No tenés permiso para editar contratos de este estudio.' using errcode = '42501';
  end if;
  if v_artist is null then
    raise exception 'El artista de este contrato ya no está en We Ötzi.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.artists_db a where a.user_id = v_artist) then
    raise exception 'El artista no existe.' using errcode = '22023';
  end if;

  perform private.lock_studio_artist_pair(v_studio_id, v_artist);

  if v_is_update then
    select * into v_existing from public.studio_contracts c where c.id = v_id for update;
    if v_existing.status <> 'draft' then
      raise exception 'Solo se editan borradores: para cambiar un contrato emitido, creá una nueva versión.' using errcode = '23514';
    end if;
  end if;

  -- Valores finales: clave presente (aunque sea null) = se escribe; ausente =
  -- se conserva lo que había (en alta, los campos de v_existing son nulos).
  v_supersedes := case when v_is_update then v_existing.supersedes_contract_id
                       else nullif(p_contract->>'supersedes_contract_id', '')::uuid end;
  if v_supersedes is not null then
    select * into v_superseded from public.studio_contracts c where c.id = v_supersedes;
    if not found or v_superseded.studio_id <> v_studio_id
       or v_superseded.artist_user_id is distinct from v_artist then
      raise exception 'El contrato anterior no corresponde a este estudio y artista.' using errcode = '22023';
    end if;
  end if;

  v_origin := case when v_is_update then v_existing.origin
                   else coalesce(nullif(btrim(coalesce(p_contract->>'origin', '')), ''), 'manual') end;
  v_membership_id := case when p_contract ? 'membership_id' then nullif(p_contract->>'membership_id', '')::uuid
                          when v_is_update then v_existing.membership_id
                          else v_superseded.membership_id end;
  v_spot_id := case when p_contract ? 'spot_id' then nullif(p_contract->>'spot_id', '')::uuid
                    else v_existing.spot_id end;
  v_application_id := case when p_contract ? 'application_id' then nullif(p_contract->>'application_id', '')::uuid
                           else v_existing.application_id end;
  v_role := case when p_contract ? 'role' then nullif(btrim(coalesce(p_contract->>'role', '')), '')
                 when v_is_update then v_existing.role
                 else v_superseded.role end;
  v_location_id := case when p_contract ? 'location_id' then nullif(p_contract->>'location_id', '')::uuid
                        when v_is_update then v_existing.location_id
                        else v_superseded.location_id end;
  v_model := case when p_contract ? 'compensation_model' then nullif(btrim(coalesce(p_contract->>'compensation_model', '')), '')
                  else v_existing.compensation_model end;
  v_pct := case when p_contract ? 'artist_percentage' then nullif(btrim(coalesce(p_contract->>'artist_percentage', '')), '')::numeric
                else v_existing.artist_percentage end;
  v_fixed_amount := case when p_contract ? 'fixed_amount' then nullif(btrim(coalesce(p_contract->>'fixed_amount', '')), '')::numeric
                         else v_existing.fixed_amount end;
  v_fixed_currency := case when p_contract ? 'fixed_currency' then upper(nullif(btrim(coalesce(p_contract->>'fixed_currency', '')), ''))
                           else v_existing.fixed_currency end;
  v_fixed_period := case when p_contract ? 'fixed_period' then nullif(btrim(coalesce(p_contract->>'fixed_period', '')), '')
                         else v_existing.fixed_period end;
  v_fixed_payer := case when p_contract ? 'fixed_payer' then nullif(btrim(coalesce(p_contract->>'fixed_payer', '')), '')
                        else v_existing.fixed_payer end;
  v_start := case when p_contract ? 'start_date' then nullif(btrim(coalesce(p_contract->>'start_date', '')), '')::date
                  else v_existing.start_date end;
  v_end := case when p_contract ? 'end_date' then nullif(btrim(coalesce(p_contract->>'end_date', '')), '')::date
                else v_existing.end_date end;
  v_notice := case when p_contract ? 'cancellation_notice_days' then nullif(btrim(coalesce(p_contract->>'cancellation_notice_days', '')), '')::integer
                   else v_existing.cancellation_notice_days end;
  v_includes := case when p_contract ? 'includes' then private.contract_text_array(p_contract->'includes', 'Qué incluye')
                     else coalesce(v_existing.includes, array[]::text[]) end;
  v_perks := case when p_contract ? 'perks' then private.contract_text_array(p_contract->'perks', 'Beneficios')
                  else coalesce(v_existing.perks, array[]::text[]) end;
  v_obligations := case when p_contract ? 'artist_obligations' then private.contract_text_array(p_contract->'artist_obligations', 'Obligaciones del artista')
                        else coalesce(v_existing.artist_obligations, array[]::text[]) end;
  v_house_rules := case when p_contract ? 'house_rules' then nullif(btrim(coalesce(p_contract->>'house_rules', '')), '')
                        else v_existing.house_rules end;
  v_terms := case when p_contract ? 'terms' then nullif(btrim(coalesce(p_contract->>'terms', '')), '')
                  else v_existing.terms end;

  -- Pertenencia cruzada: todo id tiene que ser de este estudio y artista.
  if v_membership_id is not null then
    select * into v_membership from public.studio_artist_memberships m where m.id = v_membership_id;
    if not found or v_membership.studio_id <> v_studio_id or v_membership.artist_user_id <> v_artist then
      raise exception 'La membresía no corresponde a este estudio y artista.' using errcode = '22023';
    end if;
    if v_membership.role = 'manager' then
      raise exception 'Los managers no llevan contrato de spot.' using errcode = '22023';
    end if;
  end if;
  if v_application_id is not null then
    select * into v_application from public.studio_spot_applications a where a.id = v_application_id;
    if not found or v_application.artist_user_id <> v_artist or not exists (
      select 1 from public.studio_spots sp
      where sp.id = v_application.spot_id and sp.studio_id = v_studio_id
    ) then
      raise exception 'La postulación no corresponde a este estudio y artista.' using errcode = '22023';
    end if;
    if v_spot_id is null then
      v_spot_id := v_application.spot_id;
    elsif v_spot_id <> v_application.spot_id then
      raise exception 'La postulación no corresponde a ese spot.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.studio_contracts c
      where c.application_id = v_application_id
        and c.status in ('draft', 'sent')
        and c.id is distinct from v_id
    ) then
      raise exception 'Ya hay un borrador o un contrato enviado para esta postulación.' using errcode = '23514';
    end if;
  end if;
  if v_spot_id is not null and not exists (
    select 1 from public.studio_spots sp where sp.id = v_spot_id and sp.studio_id = v_studio_id
  ) then
    raise exception 'El spot no pertenece a este estudio.' using errcode = '22023';
  end if;
  if v_location_id is not null and not exists (
    select 1 from public.studio_locations l where l.id = v_location_id and l.studio_id = v_studio_id
  ) then
    raise exception 'La sede no pertenece a este estudio.' using errcode = '22023';
  end if;

  if v_role is null and not v_is_update then
    v_role := case
      when v_membership.role in ('resident', 'guest', 'itinerant') then v_membership.role
      when v_spot_id is not null then (
        select case sp.kind when 'guest_spot' then 'guest' when 'itinerant' then 'itinerant' else 'resident' end
        from public.studio_spots sp where sp.id = v_spot_id
      )
      else 'resident'
    end;
  end if;

  -- Validación de valores.
  if v_origin not in ('spot_application', 'invitation', 'request', 'manual') then
    raise exception 'Origen de contrato inválido.' using errcode = '22023';
  end if;
  if v_origin = 'spot_application' and v_application_id is null then
    raise exception 'Un contrato de postulación necesita la postulación.' using errcode = '22023';
  end if;
  if v_role is null or v_role not in ('resident', 'guest', 'itinerant') then
    raise exception 'Elegí un rol válido para el contrato: residente, guest o itinerante.' using errcode = '22023';
  end if;
  if v_model is not null and v_model not in ('percentage', 'fixed', 'mixed') then
    raise exception 'Modalidad de pago inválida.' using errcode = '22023';
  end if;
  if v_pct is not null and (v_pct < 0 or v_pct > 100) then
    raise exception 'El porcentaje del artista va de 0 a 100.' using errcode = '22023';
  end if;
  if v_fixed_amount is not null and (v_fixed_amount < 0 or v_fixed_amount >= 10000000000) then
    raise exception 'Revisá el monto fijo.' using errcode = '22023';
  end if;
  if v_fixed_currency is not null and v_fixed_currency !~ '^[A-Z]{3}$' then
    raise exception 'La moneda tiene que ser un código ISO de 3 letras.' using errcode = '22023';
  end if;
  if v_fixed_period is not null and v_fixed_period not in ('per_session', 'daily', 'weekly', 'monthly', 'one_time') then
    raise exception 'Periodicidad del monto fijo inválida.' using errcode = '22023';
  end if;
  if v_fixed_payer is not null and v_fixed_payer not in ('artist_to_studio', 'studio_to_artist') then
    raise exception 'Indicá quién paga el monto fijo.' using errcode = '22023';
  end if;
  if v_start is not null and v_end is not null and v_end < v_start then
    raise exception 'La fecha de fin no puede ser anterior al inicio.' using errcode = '22023';
  end if;
  if v_notice is not null and (v_notice < 0 or v_notice > 365) then
    raise exception 'El preaviso va de 0 a 365 días.' using errcode = '22023';
  end if;
  if v_house_rules is not null and char_length(v_house_rules) > 5000 then
    raise exception 'Las normas del estudio admiten hasta 5000 caracteres.' using errcode = '22023';
  end if;
  if v_terms is not null and char_length(v_terms) > 20000 then
    raise exception 'Las cláusulas admiten hasta 20000 caracteres.' using errcode = '22023';
  end if;

  if v_is_update then
    update public.studio_contracts c
    set membership_id = v_membership_id,
        spot_id = v_spot_id,
        application_id = v_application_id,
        role = v_role,
        location_id = v_location_id,
        compensation_model = v_model,
        artist_percentage = v_pct,
        fixed_amount = v_fixed_amount,
        fixed_currency = v_fixed_currency,
        fixed_period = v_fixed_period,
        fixed_payer = v_fixed_payer,
        start_date = v_start,
        end_date = v_end,
        cancellation_notice_days = v_notice,
        includes = v_includes,
        perks = v_perks,
        artist_obligations = v_obligations,
        house_rules = v_house_rules,
        terms = v_terms
    where c.id = v_id;
    return v_id;
  end if;

  if v_supersedes is not null then
    -- Nueva versión: conserva el número y suma una versión.
    perform 1 from public.studios s where s.id = v_studio_id for update;
    v_number := v_superseded.contract_number;
    select coalesce(max(c.version), 0) + 1 into v_version
    from public.studio_contracts c
    where c.studio_id = v_studio_id and c.contract_number = v_number;
  else
    v_number := private.next_studio_contract_number(v_studio_id);
    v_version := 1;
  end if;

  insert into public.studio_contracts (
    studio_id, contract_number, version, supersedes_contract_id, artist_user_id,
    membership_id, spot_id, application_id, origin, role, location_id,
    compensation_model, artist_percentage, fixed_amount, fixed_currency, fixed_period, fixed_payer,
    start_date, end_date, cancellation_notice_days, includes, perks, artist_obligations,
    house_rules, terms, status, created_by
  ) values (
    v_studio_id, v_number, v_version, v_supersedes, v_artist,
    v_membership_id, v_spot_id, v_application_id, v_origin, v_role, v_location_id,
    v_model, v_pct, v_fixed_amount, v_fixed_currency, v_fixed_period, v_fixed_payer,
    v_start, v_end, v_notice, v_includes, v_perks, v_obligations,
    v_house_rules, v_terms, 'draft', v_uid
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.save_studio_contract_draft(jsonb) from public, anon;
grant execute on function public.save_studio_contract_draft(jsonb) to authenticated;

-- Borrador a partir de una postulación a un spot. Nunca falla por falta de
-- términos: lo que no se puede deducir queda vacío para completar en el editor.
create or replace function public.prepare_contract_from_application(p_application_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_app public.studio_spot_applications%rowtype;
  v_spot public.studio_spots%rowtype;
  v_id uuid;
  v_role text;
  v_model text;
  v_split numeric;
  v_pct numeric;
  v_has_stipend boolean := false;
  v_fixed_amount numeric;
  v_fixed_currency text;
  v_fixed_period text;
  v_fixed_payer text;
  v_includes text[];
  v_start date;
  v_end date;
begin
  if v_uid is null then
    raise exception 'Iniciá sesión.' using errcode = '42501';
  end if;

  select * into v_app from public.studio_spot_applications a where a.id = p_application_id;
  if not found then
    raise exception 'Postulación no encontrada.' using errcode = '22023';
  end if;
  select * into v_spot from public.studio_spots sp where sp.id = v_app.spot_id;
  if not (
    exists (select 1 from public.studios s where s.id = v_spot.studio_id and s.user_id = v_uid)
    or public.is_support_user()
  ) then
    raise exception 'No tenés permiso para preparar contratos de este estudio.' using errcode = '42501';
  end if;

  perform private.lock_studio_artist_pair(v_spot.studio_id, v_app.artist_user_id);
  select * into v_app from public.studio_spot_applications a where a.id = p_application_id for update;

  if v_app.status in ('rejected', 'withdrawn') then
    raise exception 'La postulación fue rechazada o retirada.' using errcode = '23514';
  end if;

  select c.id into v_id
  from public.studio_contracts c
  where c.application_id = p_application_id and c.status in ('draft', 'sent')
  order by c.created_at desc
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  v_role := case v_spot.kind when 'guest_spot' then 'guest' when 'itinerant' then 'itinerant' else 'resident' end;

  -- Split: contraoferta aceptada más reciente o, en su defecto, el del spot.
  select o.split_pct into v_split
  from public.studio_spot_counter_offers o
  where o.application_id = p_application_id
    and o.status = 'accepted'
    and o.split_pct is not null
  order by o.decided_at desc nulls last, o.created_at desc
  limit 1;
  v_pct := coalesce(v_split, v_spot.revenue_split_pct);

  if v_spot.compensation_model is not null then
    v_model := v_spot.compensation_model;
    v_fixed_amount := v_spot.fixed_amount;
    v_fixed_currency := v_spot.fixed_currency;
    v_fixed_period := v_spot.fixed_period;
    v_fixed_payer := v_spot.fixed_payer;
    if v_model = 'fixed' then
      v_pct := null;
    end if;
  else
    v_has_stipend := coalesce(v_spot.stipend_amount, 0) > 0 and v_spot.stipend_amount < 10000000000;
    if v_has_stipend then
      v_fixed_amount := v_spot.stipend_amount;
      v_fixed_currency := case when upper(btrim(coalesce(v_spot.stipend_currency, ''))) ~ '^[A-Z]{3}$'
                               then upper(btrim(v_spot.stipend_currency)) end;
      v_fixed_period := coalesce(v_spot.stipend_frequency, 'monthly');
      v_fixed_payer := 'studio_to_artist';
    end if;
    v_model := case
      when v_pct is not null and v_has_stipend then 'mixed'
      when v_pct is not null then 'percentage'
      when v_has_stipend then 'fixed'
    end;
  end if;

  v_includes := private.clean_contract_text_array(
    coalesce(v_spot.studio_includes, array[]::text[])
    || case when v_spot.includes_housing
              and not ('Hospedaje' = any (coalesce(v_spot.studio_includes, array[]::text[])))
            then array['Hospedaje']::text[] else array[]::text[] end
  );

  v_start := coalesce(v_spot.start_date, lower(v_app.requested_dates));
  v_end := coalesce(v_spot.end_date, upper(v_app.requested_dates) - 1);
  if v_start is not null and v_end is not null and v_end < v_start then
    v_end := null;
  end if;

  insert into public.studio_contracts (
    studio_id, contract_number, version, artist_user_id, spot_id, application_id,
    origin, role, location_id, compensation_model, artist_percentage,
    fixed_amount, fixed_currency, fixed_period, fixed_payer,
    start_date, end_date, includes, perks, artist_obligations, status, created_by
  ) values (
    v_spot.studio_id, private.next_studio_contract_number(v_spot.studio_id), 1, v_app.artist_user_id, v_spot.id, v_app.id,
    'spot_application', v_role, v_spot.location_id, v_model, v_pct,
    v_fixed_amount, v_fixed_currency, v_fixed_period, v_fixed_payer,
    v_start, v_end, v_includes,
    private.clean_contract_text_array(v_spot.benefit_tags),
    private.clean_contract_text_array(v_spot.artist_expectations),
    'draft', v_uid
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.prepare_contract_from_application(uuid) from public, anon;
grant execute on function public.prepare_contract_from_application(uuid) to authenticated;

-- Borrador para una invitación, una solicitud o un vínculo activo. Si el
-- vínculo ya tiene contrato vigente, arma la nueva versión desde ese contrato.
create or replace function public.prepare_contract_for_membership(p_membership_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_membership public.studio_artist_memberships%rowtype;
  v_detail public.studio_membership_invitation_details%rowtype;
  v_request public.studio_membership_request_details%rowtype;
  v_prev public.studio_contracts%rowtype;
  v_id uuid;
  v_number text;
  v_version integer := 1;
begin
  if v_uid is null then
    raise exception 'Iniciá sesión.' using errcode = '42501';
  end if;

  select * into v_membership from public.studio_artist_memberships m where m.id = p_membership_id;
  if not found then
    raise exception 'Vínculo no encontrado.' using errcode = '22023';
  end if;
  if not (
    exists (select 1 from public.studios s where s.id = v_membership.studio_id and s.user_id = v_uid)
    or public.is_support_user()
  ) then
    raise exception 'No tenés permiso para preparar contratos de este estudio.' using errcode = '42501';
  end if;

  perform private.lock_studio_artist_pair(v_membership.studio_id, v_membership.artist_user_id);
  select * into v_membership from public.studio_artist_memberships m where m.id = p_membership_id for update;

  if v_membership.status not in ('requested', 'pending_invite', 'pending_acceptance', 'active', 'paused') then
    raise exception 'La solicitud o invitación ya fue cerrada.' using errcode = '23514';
  end if;
  if v_membership.role = 'manager' then
    raise exception 'Los managers no llevan contrato de spot.' using errcode = '22023';
  end if;

  select c.id into v_id
  from public.studio_contracts c
  where c.membership_id = p_membership_id and c.status in ('draft', 'sent')
  order by c.version desc, c.created_at desc
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  if v_membership.current_contract_id is not null then
    select * into v_prev from public.studio_contracts c where c.id = v_membership.current_contract_id;
  end if;

  if v_prev.id is not null then
    perform 1 from public.studios s where s.id = v_membership.studio_id for update;
    v_number := v_prev.contract_number;
    select coalesce(max(c.version), 0) + 1 into v_version
    from public.studio_contracts c
    where c.studio_id = v_membership.studio_id and c.contract_number = v_number;

    insert into public.studio_contracts (
      studio_id, contract_number, version, supersedes_contract_id, artist_user_id, membership_id,
      spot_id, application_id, origin, role, location_id,
      compensation_model, artist_percentage, fixed_amount, fixed_currency, fixed_period, fixed_payer,
      start_date, end_date, cancellation_notice_days, includes, perks, artist_obligations,
      house_rules, terms, status, created_by
    ) values (
      v_membership.studio_id, v_number, v_version, v_prev.id, v_membership.artist_user_id, v_membership.id,
      v_prev.spot_id, null, 'manual', v_membership.role, coalesce(v_membership.location_id, v_prev.location_id),
      v_prev.compensation_model, v_prev.artist_percentage, v_prev.fixed_amount, v_prev.fixed_currency,
      v_prev.fixed_period, v_prev.fixed_payer,
      v_prev.start_date, v_prev.end_date, v_prev.cancellation_notice_days,
      v_prev.includes, v_prev.perks, v_prev.artist_obligations,
      v_prev.house_rules, v_prev.terms, 'draft', v_uid
    )
    returning id into v_id;
    return v_id;
  end if;

  select * into v_detail from public.studio_membership_invitation_details d where d.membership_id = p_membership_id;
  select * into v_request from public.studio_membership_request_details r where r.membership_id = p_membership_id;

  insert into public.studio_contracts (
    studio_id, contract_number, version, artist_user_id, membership_id, origin, role, location_id,
    compensation_model, artist_percentage, start_date, end_date,
    includes, perks, artist_obligations, status, created_by
  ) values (
    v_membership.studio_id, private.next_studio_contract_number(v_membership.studio_id), 1,
    v_membership.artist_user_id, v_membership.id,
    case when v_membership.initiated_by = 'studio' then 'invitation' else 'request' end,
    v_membership.role, v_membership.location_id,
    case when v_membership.revenue_split_pct is not null then 'percentage' end,
    v_membership.revenue_split_pct,
    coalesce(v_detail.proposed_start_date, v_request.proposed_start_date),
    case when v_detail.proposed_end_date is not null
              and v_detail.proposed_end_date >= coalesce(v_detail.proposed_start_date, v_request.proposed_start_date, v_detail.proposed_end_date)
         then v_detail.proposed_end_date end,
    private.clean_contract_text_array(v_detail.studio_provides),
    private.clean_contract_text_array(v_detail.benefits),
    private.clean_contract_text_array(v_detail.artist_expectations),
    'draft', v_uid
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.prepare_contract_for_membership(uuid) from public, anon;
grant execute on function public.prepare_contract_for_membership(uuid) to authenticated;

-- Contrato enviado o firmado de mayor versión de una membresía.
create or replace function public.get_current_contract_for_membership(p_membership_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_membership public.studio_artist_memberships%rowtype;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Iniciá sesión.' using errcode = '42501';
  end if;
  select * into v_membership from public.studio_artist_memberships m where m.id = p_membership_id;
  if not found then
    raise exception 'Vínculo no encontrado.' using errcode = '22023';
  end if;
  if not (
    v_membership.artist_user_id = v_uid
    or exists (select 1 from public.studios s where s.id = v_membership.studio_id and s.user_id = v_uid)
    or public.is_support_user()
  ) then
    raise exception 'No tenés permiso para ver este contrato.' using errcode = '42501';
  end if;

  select to_jsonb(c) into v_result
  from public.studio_contracts c
  where c.membership_id = p_membership_id and c.status in ('sent', 'signed')
  order by c.version desc, c.created_at desc
  limit 1;

  return v_result;
end;
$$;

revoke all on function public.get_current_contract_for_membership(uuid) from public, anon;
grant execute on function public.get_current_contract_for_membership(uuid) to authenticated;

-- El dueño del estudio emite: congela snapshot + hash y firma por el estudio.
-- Soporte no emite en nombre del estudio.
create or replace function public.issue_studio_contract(
  p_contract_id uuid,
  p_signer_name text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c public.studio_contracts%rowtype;
  v_membership public.studio_artist_memberships%rowtype;
  v_app_status text;
  v_name text := btrim(coalesce(p_signer_name, ''));
  v_now timestamptz := timezone('utc', now());
  v_expires timestamptz;
  v_snapshot jsonb;
begin
  if v_uid is null then
    raise exception 'Iniciá sesión.' using errcode = '42501';
  end if;

  select * into c from public.studio_contracts x where x.id = p_contract_id;
  if not found then
    raise exception 'Contrato no encontrado.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.studios s where s.id = c.studio_id and s.user_id = v_uid) then
    raise exception 'Solo el dueño del estudio puede emitir y firmar el contrato.' using errcode = '42501';
  end if;
  if c.artist_user_id is null then
    raise exception 'El artista de este contrato ya no está en We Ötzi.' using errcode = '23514';
  end if;

  perform private.lock_studio_artist_pair(c.studio_id, c.artist_user_id);
  select * into c from public.studio_contracts x where x.id = p_contract_id for update;

  if c.status <> 'draft' then
    raise exception 'Solo se emiten borradores.' using errcode = '23514';
  end if;
  if char_length(v_name) < 3 or char_length(v_name) > 160 then
    raise exception 'Escribí tu nombre completo para firmar.' using errcode = '22023';
  end if;
  if c.compensation_model is null
     or (c.compensation_model in ('percentage', 'mixed') and c.artist_percentage is null)
     or (c.compensation_model in ('fixed', 'mixed')
         and (c.fixed_amount is null or c.fixed_currency is null or c.fixed_period is null or c.fixed_payer is null)) then
    raise exception 'Completá la modalidad de pago.' using errcode = '22023';
  end if;
  if c.start_date is null then
    raise exception 'Completá la fecha de inicio.' using errcode = '22023';
  end if;
  if c.end_date is not null and c.end_date < c.start_date then
    raise exception 'La fecha de fin no puede ser anterior al inicio.' using errcode = '22023';
  end if;

  -- Revalida la pertenencia y que el origen siga abierto.
  if c.membership_id is not null then
    select * into v_membership from public.studio_artist_memberships m where m.id = c.membership_id;
    if not found or v_membership.studio_id <> c.studio_id or v_membership.artist_user_id <> c.artist_user_id then
      raise exception 'La membresía no corresponde a este contrato.' using errcode = '22023';
    end if;
    if v_membership.role = 'manager' then
      raise exception 'Los managers no llevan contrato de spot.' using errcode = '22023';
    end if;
    if v_membership.status not in ('requested', 'pending_invite', 'pending_acceptance', 'active', 'paused') then
      raise exception 'La solicitud o invitación ya fue cerrada.' using errcode = '23514';
    end if;
  end if;
  if c.application_id is not null then
    select a.status into v_app_status
    from public.studio_spot_applications a
    join public.studio_spots sp on sp.id = a.spot_id
    where a.id = c.application_id
      and a.artist_user_id = c.artist_user_id
      and sp.studio_id = c.studio_id;
    if not found then
      raise exception 'La postulación no corresponde a este contrato.' using errcode = '22023';
    end if;
    if v_app_status in ('withdrawn', 'rejected') then
      raise exception 'La postulación fue retirada o rechazada.' using errcode = '23514';
    end if;
  end if;
  if c.spot_id is not null and not exists (
    select 1 from public.studio_spots sp where sp.id = c.spot_id and sp.studio_id = c.studio_id
  ) then
    raise exception 'El spot no pertenece a este estudio.' using errcode = '22023';
  end if;
  if c.location_id is not null and not exists (
    select 1 from public.studio_locations l where l.id = c.location_id and l.studio_id = c.studio_id
  ) then
    raise exception 'La sede no pertenece a este estudio.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.studio_contracts x
    where x.studio_id = c.studio_id and x.artist_user_id = c.artist_user_id
      and x.status = 'sent' and x.id <> c.id
  ) then
    raise exception 'Ya hay otro contrato enviado a este artista: cancelalo o esperá su respuesta.' using errcode = '23514';
  end if;

  v_expires := coalesce(p_expires_at, v_now + interval '14 days');
  if v_expires <= v_now then
    raise exception 'El vencimiento tiene que ser una fecha futura.' using errcode = '22023';
  end if;

  v_snapshot := private.build_studio_contract_snapshot(c.id)
    || jsonb_build_object(
      'studio_signer_name', v_name,
      'studio_signed_by', v_uid,
      'issued_at', v_now,
      'expires_at', v_expires
    );

  update public.studio_contracts x
  set status = 'sent',
      sent_at = v_now,
      expires_at = v_expires,
      studio_signer_name = v_name,
      studio_signed_by = v_uid,
      studio_signed_at = v_now,
      terms_snapshot = v_snapshot,
      terms_hash = encode(extensions.digest(v_snapshot::text, 'sha256'), 'hex')
  where x.id = c.id
  returning * into c;

  return to_jsonb(c);
end;
$$;

revoke all on function public.issue_studio_contract(uuid, text, timestamptz) from public, anon;
grant execute on function public.issue_studio_contract(uuid, text, timestamptz) to authenticated;

-- El artista firma. Pasos en el orden del contrato (1–7).
create or replace function public.sign_studio_contract(
  p_contract_id uuid,
  p_signer_name text,
  p_accept_terms boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c public.studio_contracts%rowtype;
  m public.studio_artist_memberships%rowtype;
  v_name text := btrim(coalesce(p_signer_name, ''));
  v_now timestamptz := timezone('utc', now());
  v_label text;
begin
  if v_uid is null then
    raise exception 'Iniciá sesión.' using errcode = '42501';
  end if;

  select * into c from public.studio_contracts x where x.id = p_contract_id;
  if not found or c.artist_user_id is distinct from v_uid then
    raise exception 'Contrato no encontrado.' using errcode = '42501';
  end if;
  if char_length(v_name) < 3 or char_length(v_name) > 160 then
    raise exception 'Escribí tu nombre completo para firmar.' using errcode = '22023';
  end if;
  if p_accept_terms is not true then
    raise exception 'Para firmar tenés que aceptar los términos.' using errcode = '22023';
  end if;

  -- 1. Lock del par y FOR UPDATE del contrato.
  perform private.lock_studio_artist_pair(c.studio_id, v_uid);
  select * into c from public.studio_contracts x where x.id = p_contract_id for update;

  if c.status <> 'sent' then
    raise exception 'Este contrato ya no está disponible para firmar.' using errcode = '23514';
  end if;
  -- El paso a 'expired' lo persiste expire_studio_contracts: acá el error
  -- revertiría cualquier escritura.
  if c.expires_at is not null and c.expires_at <= v_now then
    raise exception 'Este contrato venció: pedile al estudio una nueva versión.' using errcode = '23514';
  end if;

  -- 2. Membresía destino.
  if c.membership_id is not null then
    select * into m from public.studio_artist_memberships x where x.id = c.membership_id for update;
    if not found
       or m.studio_id <> c.studio_id
       or m.artist_user_id <> v_uid
       or m.status not in ('requested', 'pending_invite', 'pending_acceptance', 'active', 'paused') then
      raise exception 'La solicitud o invitación ya fue cerrada.' using errcode = '23514';
    end if;
  else
    select * into m
    from public.studio_artist_memberships x
    where x.studio_id = c.studio_id
      and x.artist_user_id = v_uid
      and x.role = c.role
      and x.status in ('requested', 'pending_invite', 'pending_acceptance', 'active', 'paused')
    order by x.created_at desc
    limit 1
    for update;
    if not found then
      if c.origin = 'request' then
        raise exception 'La solicitud ya no está abierta.' using errcode = '23514';
      end if;
      insert into public.studio_artist_memberships (
        studio_id, artist_user_id, location_id, role, status, initiated_by,
        invited_at, invited_by_user_id, started_at
      ) values (
        c.studio_id, v_uid, c.location_id, c.role, 'active', 'studio',
        v_now, c.studio_signed_by, v_now
      )
      returning * into m;
    end if;
  end if;

  if m.role = 'manager' then
    raise exception 'Los managers no llevan contrato de spot.' using errcode = '22023';
  end if;
  if m.role <> c.role and exists (
    select 1 from public.studio_artist_memberships x
    where x.studio_id = c.studio_id
      and x.artist_user_id = v_uid
      and x.role = c.role
      and x.id <> m.id
      and x.status in ('requested', 'pending_invite', 'pending_acceptance', 'active', 'paused')
  ) then
    raise exception 'Ya tenés otro vínculo abierto con ese rol en este estudio.' using errcode = '23514';
  end if;

  -- 3. Los otros contratos firmados de esa membresía quedan reemplazados.
  v_label := c.contract_number || case when c.version > 1 then ' v' || c.version::text else '' end;
  update public.studio_contracts x
  set status = 'terminated',
      terminated_at = v_now,
      terminated_by = v_uid,
      termination_reason = 'Reemplazado por ' || v_label
  where x.membership_id = m.id
    and x.status = 'signed'
    and x.id <> c.id;

  -- 4. Un único UPDATE del contrato.
  update public.studio_contracts x
  set status = 'signed',
      membership_id = m.id,
      artist_signer_name = v_name,
      artist_signed_at = v_now
  where x.id = c.id
  returning * into c;

  -- 5. Guest/itinerante fuera de un spot: fechas para el viaje automático.
  if c.role in ('guest', 'itinerant') and c.origin <> 'spot_application' and c.start_date is not null then
    insert into public.studio_membership_invitation_details (membership_id, proposed_start_date, proposed_end_date)
    values (m.id, c.start_date, c.end_date)
    on conflict (membership_id) do update
      set proposed_start_date = excluded.proposed_start_date,
          proposed_end_date = excluded.proposed_end_date,
          updated_at = v_now;
  end if;

  -- 6. Un único UPDATE de la membresía.
  update public.studio_artist_memberships x
  set status = 'active',
      started_at = coalesce(x.started_at, v_now),
      ended_at = null,
      role = c.role,
      location_id = coalesce(c.location_id, x.location_id),
      revenue_split_pct = case when c.compensation_model in ('percentage', 'mixed')
                               then c.artist_percentage else x.revenue_split_pct end,
      current_contract_id = c.id,
      updated_at = v_now
  where x.id = m.id;

  update public.studio_invitation_change_requests r
  set status = 'superseded', resolved_at = v_now
  where r.membership_id = m.id and r.status = 'pending';

  -- 7. La postulación recién ahora queda aceptada (dispara viaje e inbox).
  if c.origin = 'spot_application' and c.application_id is not null then
    update public.studio_spot_applications a
    set status = 'accepted',
        decided_at = v_now,
        decided_by_user_id = coalesce(c.studio_signed_by, a.decided_by_user_id)
    where a.id = c.application_id and a.status <> 'accepted';
  end if;

  return jsonb_build_object('contract_id', c.id, 'membership_id', m.id);
end;
$$;

revoke all on function public.sign_studio_contract(uuid, text, boolean) from public, anon;
grant execute on function public.sign_studio_contract(uuid, text, boolean) to authenticated;

-- El artista rechaza un contrato enviado. Una postulación de origen queda
-- preseleccionada (no se toca).
create or replace function public.decline_studio_contract(p_contract_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c public.studio_contracts%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then
    raise exception 'Iniciá sesión.' using errcode = '42501';
  end if;
  select * into c from public.studio_contracts x where x.id = p_contract_id;
  if not found or c.artist_user_id is distinct from v_uid then
    raise exception 'Contrato no encontrado.' using errcode = '42501';
  end if;
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'El motivo admite hasta 1000 caracteres.' using errcode = '22023';
  end if;

  perform private.lock_studio_artist_pair(c.studio_id, v_uid);
  select * into c from public.studio_contracts x where x.id = p_contract_id for update;
  if c.status <> 'sent' then
    raise exception 'Este contrato ya no está pendiente de firma.' using errcode = '23514';
  end if;

  update public.studio_contracts x
  set status = 'declined', declined_at = timezone('utc', now()), decline_reason = v_reason
  where x.id = c.id
  returning * into c;

  return to_jsonb(c);
end;
$$;

revoke all on function public.decline_studio_contract(uuid, text) from public, anon;
grant execute on function public.decline_studio_contract(uuid, text) to authenticated;

-- El estudio (o soporte) cancela un borrador o un contrato enviado.
create or replace function public.cancel_studio_contract(p_contract_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c public.studio_contracts%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then
    raise exception 'Iniciá sesión.' using errcode = '42501';
  end if;
  select * into c from public.studio_contracts x where x.id = p_contract_id;
  if not found then
    raise exception 'Contrato no encontrado.' using errcode = '22023';
  end if;
  if not (
    exists (select 1 from public.studios s where s.id = c.studio_id and s.user_id = v_uid)
    or public.is_support_user()
  ) then
    raise exception 'No tenés permiso para cancelar este contrato.' using errcode = '42501';
  end if;
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'El motivo admite hasta 1000 caracteres.' using errcode = '22023';
  end if;

  if c.artist_user_id is not null then
    perform private.lock_studio_artist_pair(c.studio_id, c.artist_user_id);
  end if;
  select * into c from public.studio_contracts x where x.id = p_contract_id for update;
  if c.status not in ('draft', 'sent') then
    raise exception 'Solo se cancelan borradores o contratos enviados sin firmar.' using errcode = '23514';
  end if;

  update public.studio_contracts x
  set status = 'cancelled', cancelled_at = timezone('utc', now()), cancel_reason = v_reason
  where x.id = c.id
  returning * into c;

  return to_jsonb(c);
end;
$$;

revoke all on function public.cancel_studio_contract(uuid, text) from public, anon;
grant execute on function public.cancel_studio_contract(uuid, text) to authenticated;

-- Rescisión de un contrato firmado por cualquiera de las partes o soporte.
create or replace function public.terminate_studio_contract(
  p_contract_id uuid,
  p_reason text,
  p_end_membership boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c public.studio_contracts%rowtype;
  m public.studio_artist_memberships%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_now timestamptz := timezone('utc', now());
begin
  if v_uid is null then
    raise exception 'Iniciá sesión.' using errcode = '42501';
  end if;
  select * into c from public.studio_contracts x where x.id = p_contract_id;
  if not found then
    raise exception 'Contrato no encontrado.' using errcode = '22023';
  end if;
  if not (
    c.artist_user_id = v_uid
    or exists (select 1 from public.studios s where s.id = c.studio_id and s.user_id = v_uid)
    or public.is_support_user()
  ) then
    raise exception 'No tenés permiso para rescindir este contrato.' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Contanos el motivo de la rescisión.' using errcode = '22023';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'El motivo admite hasta 1000 caracteres.' using errcode = '22023';
  end if;

  if c.artist_user_id is not null then
    perform private.lock_studio_artist_pair(c.studio_id, c.artist_user_id);
  end if;
  select * into c from public.studio_contracts x where x.id = p_contract_id for update;
  if c.status <> 'signed' then
    raise exception 'Solo se rescinden contratos firmados.' using errcode = '23514';
  end if;

  update public.studio_contracts x
  set status = 'terminated', terminated_at = v_now, terminated_by = v_uid, termination_reason = v_reason
  where x.id = c.id
  returning * into c;

  if c.membership_id is not null then
    select * into m from public.studio_artist_memberships x where x.id = c.membership_id for update;
    if found then
      if coalesce(p_end_membership, true) and m.status in ('active', 'paused') then
        perform private.close_open_studio_contracts(m.id, null, 'cancelled', 'Vínculo finalizado');
        update public.studio_artist_memberships x
        set status = 'ended', ended_at = v_now, current_contract_id = null, updated_at = v_now
        where x.id = m.id;
        update public.studio_invitation_change_requests r
        set status = 'superseded', resolved_at = v_now
        where r.membership_id = m.id and r.status = 'pending';
      elsif m.current_contract_id = c.id then
        update public.studio_artist_memberships x
        set current_contract_id = null, updated_at = v_now
        where x.id = m.id;
      end if;
    end if;
  end if;

  return to_jsonb(c);
end;
$$;

revoke all on function public.terminate_studio_contract(uuid, text, boolean) from public, anon;
grant execute on function public.terminate_studio_contract(uuid, text, boolean) to authenticated;

-- Vencimientos. Toca solo los contratos del caller: su estudio, los suyos
-- como artista o todos si es soporte. Se llama al listar contratos y al
-- cargar el roster.
create or replace function public.expire_studio_contracts(p_studio_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_support boolean := public.is_support_user();
  v_now timestamptz := timezone('utc', now());
  v_count integer := 0;
  r record;
begin
  if v_uid is null then
    raise exception 'Iniciá sesión.' using errcode = '42501';
  end if;
  if p_studio_id is not null and not v_is_support and not exists (
    select 1 from public.studios s where s.id = p_studio_id and s.user_id = v_uid
  ) then
    raise exception 'No tenés permiso para revisar los contratos de este estudio.' using errcode = '42501';
  end if;

  for r in
    select c.id, c.studio_id, c.artist_user_id, c.status, c.membership_id
    from public.studio_contracts c
    where ((c.status = 'sent' and c.expires_at is not null and c.expires_at <= v_now)
        or (c.status = 'signed' and c.end_date is not null and c.end_date < current_date))
      and (
        (p_studio_id is not null and c.studio_id = p_studio_id)
        or (p_studio_id is null and (
              v_is_support
              or c.artist_user_id = v_uid
              or exists (select 1 from public.studios s where s.id = c.studio_id and s.user_id = v_uid)
            ))
      )
    order by c.studio_id, c.artist_user_id, c.id
  loop
    if r.artist_user_id is not null then
      perform private.lock_studio_artist_pair(r.studio_id, r.artist_user_id);
    end if;

    if r.status = 'sent' then
      update public.studio_contracts x
      set status = 'expired'
      where x.id = r.id and x.status = 'sent' and x.expires_at <= v_now;
      if found then
        v_count := v_count + 1;
      end if;
    else
      update public.studio_contracts x
      set status = 'terminated', terminated_at = v_now, termination_reason = 'Fin de vigencia'
      where x.id = r.id and x.status = 'signed' and x.end_date < current_date;
      if found then
        v_count := v_count + 1;
        update public.studio_artist_memberships m
        set status = 'ended', ended_at = v_now, current_contract_id = null, updated_at = v_now
        where m.id = r.membership_id
          and m.current_contract_id = r.id
          and m.status in ('active', 'paused');
      end if;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.expire_studio_contracts(uuid) from public, anon;
grant execute on function public.expire_studio_contracts(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Parches sobre funciones existentes
-- ---------------------------------------------------------------------

-- decide_studio_spot_application, versión final (reemplaza el puente de M1).
-- Aceptar ya no crea membresía: preselecciona la postulación y asegura el
-- borrador del contrato. 'accepted' lo pone sign_studio_contract. Pasa a
-- search_path '' y suma soporte (Reglas transversales §2).
create or replace function public.decide_studio_spot_application(p_application_id uuid, p_status text)
returns public.studio_spot_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_application public.studio_spot_applications;
  v_spot public.studio_spots;
  v_now timestamptz := timezone('utc', now());
begin
  if v_uid is null then
    raise exception 'Iniciá sesión.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('accepted', 'rejected') then
    raise exception 'Decisión inválida: usá accepted o rejected.' using errcode = '22023';
  end if;

  select * into v_application from public.studio_spot_applications a where a.id = p_application_id;
  if not found then
    raise exception 'Postulación no encontrada.' using errcode = '22023';
  end if;
  select * into v_spot from public.studio_spots sp where sp.id = v_application.spot_id;
  if not (
    exists (select 1 from public.studios s where s.id = v_spot.studio_id and s.user_id = v_uid)
    or public.is_support_user()
  ) then
    raise exception 'No tenés permiso para decidir esta postulación.' using errcode = '42501';
  end if;

  perform private.lock_studio_artist_pair(v_spot.studio_id, v_application.artist_user_id);
  select * into v_application from public.studio_spot_applications a where a.id = p_application_id for update;
  select * into v_spot from public.studio_spots sp where sp.id = v_application.spot_id for update;

  if p_status = 'accepted' then
    if v_application.status = 'accepted' then
      return v_application;
    end if;
    if v_application.status not in ('pending', 'viewed', 'shortlisted') then
      raise exception 'Esta postulación ya fue resuelta o retirada.' using errcode = '23514';
    end if;
    if v_spot.status not in ('open', 'filled') then
      raise exception 'Abrí el spot antes de aceptar postulaciones.' using errcode = '23514';
    end if;
    if v_application.status <> 'shortlisted' then
      update public.studio_spot_applications a
      set status = 'shortlisted', decided_by_user_id = v_uid
      where a.id = p_application_id;
    end if;
    perform public.prepare_contract_from_application(p_application_id);
  else
    if v_application.status = 'rejected' then
      return v_application;
    end if;
    if v_application.status not in ('pending', 'viewed', 'shortlisted') then
      raise exception 'Esta postulación ya fue resuelta o retirada.' using errcode = '23514';
    end if;
    update public.studio_spot_applications a
    set status = 'rejected', decided_at = v_now, decided_by_user_id = v_uid
    where a.id = p_application_id;
    perform private.close_open_studio_contracts(null, p_application_id, 'cancelled', 'La postulación fue rechazada');
  end if;

  select * into v_application from public.studio_spot_applications a where a.id = p_application_id;
  return v_application;
end;
$$;

revoke all on function public.decide_studio_spot_application(uuid, text) from public, anon;
grant execute on function public.decide_studio_spot_application(uuid, text) to authenticated;

-- respond_to_studio_spot_counter_offer (definición viva): aceptar la
-- contraoferta deja la postulación 'shortlisted' en lugar de 'accepted'.
CREATE OR REPLACE FUNCTION public.respond_to_studio_spot_counter_offer(p_offer_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_offer record;
  v_now timestamptz := timezone('utc', now());
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_action not in ('accept', 'reject') then
    raise exception 'invalid counter-offer action' using errcode = '22023';
  end if;

  select o.*, a.artist_user_id as applicant_artist_id, s.user_id as studio_owner_id
    into v_offer
  from public.studio_spot_counter_offers o
  join public.studio_spot_applications a on a.id = o.application_id
  join public.studio_spots sp on sp.id = a.spot_id
  join public.studios s on s.id = sp.studio_id
  where o.id = p_offer_id
  for update of o;

  if not found or v_offer.status <> 'pending' then
    raise exception 'pending counter-offer not found' using errcode = '23514';
  end if;
  if v_offer.author_role = 'studio' and v_offer.applicant_artist_id <> auth.uid() then
    raise exception 'counter-offer not found' using errcode = '42501';
  end if;
  if v_offer.author_role = 'artist'
     and v_offer.studio_owner_id is distinct from auth.uid()
     and not public.is_support_user() then
    raise exception 'counter-offer not found' using errcode = '42501';
  end if;

  update public.studio_spot_counter_offers
  set status = case when p_action = 'accept' then 'accepted' else 'rejected' end,
      decided_at = v_now
  where id = p_offer_id;

  if p_action = 'accept' then
    update public.studio_spot_counter_offers
    set status = 'superseded', decided_at = v_now
    where application_id = v_offer.application_id
      and id <> p_offer_id
      and status = 'pending';

    -- Estudios M2: la postulación queda preseleccionada; se acepta recién
    -- cuando el artista firma el contrato.
    update public.studio_spot_applications
    set status = 'shortlisted'
    where id = v_offer.application_id
      and status in ('pending', 'viewed', 'shortlisted');
  end if;

  return jsonb_build_object(
    'offer_id', p_offer_id,
    'application_id', v_offer.application_id,
    'status', case when p_action = 'accept' then 'accepted' else 'rejected' end,
    'decided_at', v_now
  );
end;
$function$;

revoke all on function public.respond_to_studio_spot_counter_offer(uuid, text) from public, anon;
grant execute on function public.respond_to_studio_spot_counter_offer(uuid, text) to authenticated;

-- respond_to_studio_invitation (definición viva): rechaza las solicitudes
-- del artista, no acepta si hay un contrato para firmar y al rechazar pasa
-- esos contratos a 'declined'. Toma el lock del par antes del FOR UPDATE.
CREATE OR REPLACE FUNCTION public.respond_to_studio_invitation(p_membership_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_membership public.studio_artist_memberships%rowtype;
  v_now timestamptz := timezone('utc', now());
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_action not in ('accept', 'reject') then
    raise exception 'invalid invitation action' using errcode = '22023';
  end if;

  select * into v_membership
  from public.studio_artist_memberships
  where id = p_membership_id;

  if not found or v_membership.artist_user_id <> auth.uid() then
    raise exception 'invitation not found' using errcode = '42501';
  end if;

  perform private.lock_studio_artist_pair(v_membership.studio_id, v_membership.artist_user_id);

  select * into v_membership
  from public.studio_artist_memberships
  where id = p_membership_id
  for update;

  if v_membership.initiated_by = 'artist' then
    raise exception 'Esta es una solicitud tuya: la aprueba el estudio.' using errcode = '23514';
  end if;
  if v_membership.status not in ('pending_invite', 'pending_acceptance') then
    raise exception 'invitation already answered' using errcode = '23514';
  end if;
  if p_action = 'accept' and exists (
    select 1 from public.studio_contracts c
    where c.membership_id = p_membership_id and c.status = 'sent'
  ) then
    raise exception 'Esta invitación tiene un contrato para firmar.' using errcode = '23514';
  end if;

  update public.studio_artist_memberships
  set status = case when p_action = 'accept' then 'active' else 'rejected' end,
      started_at = case when p_action = 'accept' then coalesce(started_at, v_now) else started_at end,
      ended_at = case when p_action = 'reject' then v_now else null end,
      updated_at = v_now
  where id = p_membership_id;

  update public.studio_invitation_change_requests
  set status = 'superseded', resolved_at = v_now
  where membership_id = p_membership_id
    and status = 'pending';

  if p_action = 'reject' then
    perform private.close_open_studio_contracts(p_membership_id, null, 'declined', 'Invitación rechazada');
  end if;

  return jsonb_build_object(
    'membership_id', p_membership_id,
    'status', case when p_action = 'accept' then 'active' else 'rejected' end,
    'responded_at', v_now
  );
end;
$function$;

revoke all on function public.respond_to_studio_invitation(uuid, text) from public, anon;
grant execute on function public.respond_to_studio_invitation(uuid, text) to authenticated;

-- end_studio_membership (definición viva): el contrato firmado vigente pasa a
-- 'terminated' ("Vínculo finalizado"), se limpia current_contract_id y los
-- borradores o enviados se cancelan. Toma el lock del par.
CREATE OR REPLACE FUNCTION public.end_studio_membership(p_membership_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_membership public.studio_artist_memberships%rowtype;
  v_is_studio_owner boolean := false;
  v_now timestamptz := timezone('utc', now());
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_membership
  from public.studio_artist_memberships
  where id = p_membership_id;

  if not found then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from public.studios s
    where s.id = v_membership.studio_id and s.user_id = auth.uid()
  ) into v_is_studio_owner;

  if v_membership.artist_user_id <> auth.uid()
     and not v_is_studio_owner
     and not public.is_support_user() then
    raise exception 'membership not found' using errcode = '42501';
  end if;

  perform private.lock_studio_artist_pair(v_membership.studio_id, v_membership.artist_user_id);

  select * into v_membership
  from public.studio_artist_memberships
  where id = p_membership_id
  for update;

  if v_membership.status <> 'active' then
    raise exception 'only an active membership can be ended' using errcode = '23514';
  end if;

  update public.studio_contracts
  set status = 'terminated',
      terminated_at = v_now,
      terminated_by = auth.uid(),
      termination_reason = 'Vínculo finalizado'
  where membership_id = p_membership_id
    and status = 'signed';

  perform private.close_open_studio_contracts(p_membership_id, null, 'cancelled', 'Vínculo finalizado');

  update public.studio_artist_memberships
  set status = 'ended', ended_at = v_now, updated_at = v_now, current_contract_id = null
  where id = p_membership_id;

  update public.studio_invitation_change_requests
  set status = 'superseded', resolved_at = v_now
  where membership_id = p_membership_id
    and status = 'pending';

  return jsonb_build_object(
    'membership_id', p_membership_id,
    'status', 'ended',
    'ended_at', v_now
  );
end;
$function$;

revoke all on function public.end_studio_membership(uuid) from public, anon;
grant execute on function public.end_studio_membership(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Roster público con vigencia
-- ---------------------------------------------------------------------

create or replace view public.studio_public_roster
with (security_invoker = false)
as
select
  m.id as membership_id,
  m.studio_id,
  m.artist_user_id,
  m.location_id,
  m.role,
  m.started_at,
  c.end_date as ends_on
from public.studio_artist_memberships m
left join public.studio_contracts c
  on c.id = m.current_contract_id and c.status = 'signed'
where m.status = 'active';

alter view public.studio_public_roster owner to postgres;
revoke all on public.studio_public_roster from public, anon, authenticated;
grant select on public.studio_public_roster to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Inbox del artista por contrato
-- ---------------------------------------------------------------------

-- Mismo patrón que inbox_from_studio_invitation: un hilo por contrato en la
-- categoría 'invitations' con deeplink a /artist/invitations?contrato=<id>.
create or replace function public.inbox_from_studio_contract()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_studio public.studios%rowtype;
  v_message text;
  v_name text;
  v_label text;
begin
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;
  if new.artist_user_id is null then return new; end if;
  if new.status not in ('sent', 'signed', 'declined', 'cancelled', 'terminated', 'expired') then return new; end if;
  -- El artista nunca vio un borrador: cancelarlo no le avisa nada.
  if new.status = 'cancelled' and (tg_op = 'INSERT' or old.status is distinct from 'sent') then return new; end if;

  select * into v_studio from public.studios where id = new.studio_id;
  v_name := coalesce(nullif(btrim(v_studio.name), ''), 'el estudio');
  v_label := new.contract_number || case when new.version > 1 then ' v' || new.version::text else '' end;
  v_message := case new.status
    when 'sent' then v_name || ' te envió el contrato ' || v_label || ' para firmar.'
    when 'signed' then 'Firmaste el contrato ' || v_label || ' con ' || v_name || '.'
    when 'declined' then 'Rechazaste el contrato ' || v_label || '.'
    when 'cancelled' then v_name || ' canceló el contrato ' || v_label || '.'
    when 'terminated' then case
      when new.termination_reason = 'Fin de vigencia' then 'El contrato ' || v_label || ' llegó al fin de su vigencia.'
      when new.termination_reason like 'Reemplazado por %' then 'El contrato ' || v_label || ' quedó reemplazado por una nueva versión.'
      else 'El contrato ' || v_label || ' con ' || v_name || ' quedó rescindido.'
    end
    when 'expired' then 'El contrato ' || v_label || ' venció sin firmarse.'
  end;

  perform public.ensure_domain_inbox_thread(
    new.artist_user_id, 'invitations', 'studio_contract', new.id,
    v_studio.user_id, v_studio.name, 'Contrato ' || v_label,
    jsonb_build_object(
      'contract_id', new.id, 'contract_number', new.contract_number, 'version', new.version,
      'studio_id', new.studio_id, 'studio_name', v_studio.name,
      'membership_id', new.membership_id, 'application_id', new.application_id,
      'role', new.role, 'contract_status', new.status, 'expires_at', new.expires_at,
      'deeplink', '/artist/invitations?contrato=' || new.id::text
    ), v_message
  );
  return new;
end;
$function$;

revoke execute on function public.inbox_from_studio_contract() from public, anon, authenticated;

drop trigger if exists trg_inbox_from_studio_contract on public.studio_contracts;
create trigger trg_inbox_from_studio_contract
  after insert or update of status on public.studio_contracts
  for each row execute function public.inbox_from_studio_contract();

notify pgrst, 'reload schema';
commit;
