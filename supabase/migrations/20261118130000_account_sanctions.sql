-- ============================================================================
-- Sanciones de cuenta (2.7.0, fase 1 del plan de identidad y suplantación)
-- ============================================================================
-- Plan: docs/plans/2026-11-18-kyc-antisuplantacion.md §1.4
-- Contrato: docs/plans/2026-11-18-kyc-sprints.md («Columnas y tablas nuevas»)
--
-- Qué agrega:
--   1. Tablas account_sanctions, banned_identifiers y security_alerts, con RLS:
--      soporte (public.is_support_user()) lee todo; el usuario lee sus propias
--      sanciones activas o apeladas; solo service_role escribe.
--   2. Columnas artists_db.sanction_state / sanction_id, studios.sanction_state
--      / sanction_id y quotations_db.support_closed_reason, protegidas por
--      triggers nuevos (no se tocan guard_artist_privileged_fields ni
--      private.guard_studio_protected_columns). El dueño de un estudio
--      sancionado no puede volver a activarlo (is_active).
--   3. public.artist_is_public(registration_status, sanction_state): el único
--      predicado de «artista visible». Lo usan las dos políticas públicas de
--      artists_db, las vistas artists_with_location y public_artist_trips y
--      las funciones SECURITY DEFINER que filtraban 'incompleto'.
--   4. request_artist_wallet_withdrawal rechaza retiros con una suspensión o un
--      baneo activo o apelado.
--   5. private.revoke_user_sessions(uuid) (+ envoltorio público para rpc):
--      borra las sesiones de Auth del usuario (los refresh tokens caen en
--      cascada). Solo service_role.
--   6. quotation_payments_wallet_feed: «Seña recibida» → «Anticipo recibido».
--   7. public.studio_is_public(is_active, sanction_state): el único predicado
--      de «estudio visible». La sanción de un dueño apaga is_active y fija
--      sanction_state; con el predicado, la tienda pública (get_public_storefront,
--      store_public_seller_bundle y, por ella, get_public_store_product),
--      create_store_order (no se compra a un estudio oculto), el directorio de
--      spots (política spots_public_select_open, vía private.studio_is_listed)
--      y el estudio de artists_with_location dejan fuera al estudio sancionado.
--      anon no lee studios.sanction_state (privilegios por columna): el
--      navegador se apoya en is_active y las superficies con dueño
--      privilegiado usan el predicado.
--
-- Vistas y funciones se redefinen desde su definición VIVA (pg_get_viewdef /
-- pg_get_functiondef) con replace(): así no se pisan cambios de otras
-- migraciones. Las funciones de visibilidad se saltan con un aviso si no tienen
-- el filtro esperado; el retiro y la etiqueta del anticipo fallan si no lo
-- encuentran. Se puede volver a correr.
--
-- Reversa: supabase/rollbacks/20261118130000_account_sanctions.down.sql
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Predicado de visibilidad pública del artista
-- ---------------------------------------------------------------------------
create or replace function public.artist_is_public(registration_status text, sanction_state text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select registration_status is distinct from 'incompleto'
     and coalesce(sanction_state, 'none') = 'none';
$fn$;

comment on function public.artist_is_public(text, text) is
  'Artista visible en superficies públicas: registro terminado y sin sanción (sanction_state = none).';

grant execute on function public.artist_is_public(text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Columnas nuevas
-- ---------------------------------------------------------------------------
alter table public.artists_db
  add column if not exists sanction_state text not null default 'none',
  add column if not exists sanction_id uuid null;

alter table public.artists_db drop constraint if exists artists_db_sanction_state_check;
alter table public.artists_db
  add constraint artists_db_sanction_state_check
  check (sanction_state in ('none', 'suspended', 'banned'));

comment on column public.artists_db.sanction_state is
  'none | suspended | banned. Lo escribe solo el servidor (sanciones). Distinto de none oculta al artista de todo lo público.';
comment on column public.artists_db.sanction_id is
  'Sanción (account_sanctions.id) que fijó sanction_state.';

alter table public.studios
  add column if not exists sanction_state text not null default 'none',
  add column if not exists sanction_id uuid null;

alter table public.studios drop constraint if exists studios_sanction_state_check;
alter table public.studios
  add constraint studios_sanction_state_check
  check (sanction_state in ('none', 'suspended', 'banned'));

comment on column public.studios.sanction_state is
  'none | suspended | banned. Lo escribe solo el servidor. Mientras no sea none, el dueño no puede cambiar is_active.';
comment on column public.studios.sanction_id is
  'Sanción (account_sanctions.id) que fijó sanction_state.';

alter table public.quotations_db
  add column if not exists support_closed_reason text null;

alter table public.quotations_db drop constraint if exists quotations_db_support_closed_reason_check;
alter table public.quotations_db
  add constraint quotations_db_support_closed_reason_check
  check (support_closed_reason is null or char_length(support_closed_reason) between 1 and 300);

comment on column public.quotations_db.support_closed_reason is
  'Motivo cuando soporte cancela la cotización (por ejemplo, el perfil fue dado de baja). Con valor, la cotización se muestra como «Cancelada por soporte».';

-- ---------------------------------------------------------------------------
-- 3. Tablas nuevas
-- ---------------------------------------------------------------------------
create table if not exists public.account_sanctions (
  id uuid primary key default gen_random_uuid(),
  -- Sin FK a auth.users: la sanción (y sus huellas) sobrevive a la baja de la cuenta.
  user_id uuid not null,
  kind text not null,
  reason_code text not null,
  summary text null,
  ticket_id uuid null references public.support_tickets(id) on delete set null,
  -- null = la propuso el sistema (por ejemplo, un reingreso bloqueado).
  proposed_by uuid null,
  confirmed_by uuid null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz null,
  status text not null default 'proposed',
  appeal_text text null,
  appeal_submitted_at timestamptz null,
  appeal_decided_by uuid null,
  appeal_decided_at timestamptz null,
  appeal_outcome text null,
  side_effects jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_sanctions_kind_check
    check (kind in ('warning', 'suspension', 'ban')),
  constraint account_sanctions_status_check
    check (status in ('proposed', 'active', 'appealed', 'lifted', 'rejected')),
  constraint account_sanctions_reason_code_check
    check (reason_code ~ '^[a-z][a-z0-9_]{1,59}$'),
  constraint account_sanctions_summary_check
    check (summary is null or char_length(summary) <= 2000),
  constraint account_sanctions_appeal_text_check
    check (appeal_text is null or char_length(appeal_text) <= 4000),
  constraint account_sanctions_appeal_outcome_check
    check (appeal_outcome is null or appeal_outcome in ('accepted', 'rejected')),
  constraint account_sanctions_dates_check
    check (ends_at is null or ends_at > starts_at),
  constraint account_sanctions_side_effects_check
    check (jsonb_typeof(side_effects) = 'object'),
  -- Dos agentes: quien propone un baneo no puede confirmarlo.
  constraint account_sanctions_ban_two_agents_check
    check (kind <> 'ban' or confirmed_by is null or confirmed_by <> proposed_by),
  -- La apelación la decide un agente que no intervino.
  constraint account_sanctions_appeal_reviewer_check
    check (
      appeal_decided_by is null
      or (appeal_decided_by is distinct from proposed_by
          and appeal_decided_by is distinct from confirmed_by)
    )
);

comment on table public.account_sanctions is
  'Sanciones de cuenta (advertencia, suspensión, baneo) y su apelación. Escribe solo el servidor; side_effects registra lo que tocó la sanción para poder revertir exactamente eso.';

create index if not exists account_sanctions_user_idx
  on public.account_sanctions (user_id, status);
create index if not exists account_sanctions_status_idx
  on public.account_sanctions (status, created_at desc);
create index if not exists account_sanctions_ticket_idx
  on public.account_sanctions (ticket_id) where ticket_id is not null;

drop trigger if exists trg_account_sanctions_updated_at on public.account_sanctions;
create trigger trg_account_sanctions_updated_at
  before update on public.account_sanctions
  for each row execute function public.set_updated_at();

create table if not exists public.banned_identifiers (
  id uuid primary key default gen_random_uuid(),
  sanction_id uuid not null references public.account_sanctions(id) on delete cascade,
  kind text not null,
  -- HMAC-SHA256 en hex con BAN_HMAC_KEY (servidor). Nunca el valor en claro.
  value_hmac text not null,
  created_at timestamptz not null default now(),
  constraint banned_identifiers_kind_check
    check (kind in ('email', 'phone', 'instagram', 'document', 'face')),
  constraint banned_identifiers_value_hmac_check
    check (value_hmac ~ '^[0-9a-f]{64}$'),
  constraint banned_identifiers_kind_value_key unique (kind, value_hmac)
);

comment on table public.banned_identifiers is
  'Huellas HMAC de correo, teléfono e Instagram (fase 3: documento y cara) de cuentas baneadas, para bloquear el reingreso. Sin la clave del servidor no dicen nada.';

create index if not exists banned_identifiers_sanction_idx
  on public.banned_identifiers (sanction_id);

create table if not exists public.security_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  status text not null default 'open',
  subject_user_id uuid null,
  related_user_id uuid null,
  payload jsonb not null default '{}'::jsonb,
  resolution text null,
  handled_by uuid null,
  handled_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint security_alerts_kind_check
    check (kind in ('reentry_blocked', 'image_duplicate', 'refund_needed')),
  constraint security_alerts_status_check
    check (status in ('open', 'handled', 'dismissed')),
  constraint security_alerts_payload_check
    check (jsonb_typeof(payload) = 'object'),
  constraint security_alerts_resolution_check
    check (resolution is null or char_length(resolution) <= 2000)
);

comment on table public.security_alerts is
  'Alertas para soporte: reingreso bloqueado, imagen duplicada (fase 2), devolución de anticipo pendiente. El payload no lleva identificadores en claro.';

create index if not exists security_alerts_status_idx
  on public.security_alerts (status, created_at desc);
create index if not exists security_alerts_subject_idx
  on public.security_alerts (subject_user_id) where subject_user_id is not null;

-- RLS y permisos: solo service_role escribe; soporte lee todo; el usuario lee
-- sus propias sanciones activas o apeladas.
alter table public.account_sanctions enable row level security;
alter table public.banned_identifiers enable row level security;
alter table public.security_alerts enable row level security;

revoke all on table public.account_sanctions from anon, authenticated;
revoke all on table public.banned_identifiers from anon, authenticated;
revoke all on table public.security_alerts from anon, authenticated;

-- account_sanctions: con el JWT solo se leen columnas sin datos internos. Los
-- agentes que actuaron (proposed_by, confirmed_by, appeal_decided_by), el
-- ticket, el resumen interno (puede nombrar a quien denunció), el texto de la
-- apelación y side_effects quedan para el servidor (service_role). El panel de
-- soporte lee la fila completa por /api/support/sanctions.
grant select (id, user_id, kind, reason_code, status, starts_at, ends_at,
              appeal_submitted_at, appeal_outcome, created_at, updated_at)
  on table public.account_sanctions to authenticated;
grant select on table public.banned_identifiers to authenticated;
grant select on table public.security_alerts to authenticated;

grant all on table public.account_sanctions to service_role;
grant all on table public.banned_identifiers to service_role;
grant all on table public.security_alerts to service_role;

drop policy if exists account_sanctions_support_select on public.account_sanctions;
create policy account_sanctions_support_select
  on public.account_sanctions for select to authenticated
  using (public.is_support_user());

drop policy if exists account_sanctions_own_select on public.account_sanctions;
create policy account_sanctions_own_select
  on public.account_sanctions for select to authenticated
  using (user_id = (select auth.uid()) and status in ('active', 'appealed'));

drop policy if exists banned_identifiers_support_select on public.banned_identifiers;
create policy banned_identifiers_support_select
  on public.banned_identifiers for select to authenticated
  using (public.is_support_user());

drop policy if exists security_alerts_support_select on public.security_alerts;
create policy security_alerts_support_select
  on public.security_alerts for select to authenticated
  using (public.is_support_user());

-- ---------------------------------------------------------------------------
-- 4. Guardas de las columnas de sanción
-- ---------------------------------------------------------------------------
-- Una función por tabla para no depender de columnas que la otra no tiene.
create or replace function private.guard_artist_sanction_columns()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if public.wo_is_privileged_writer() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.sanction_state := 'none';
    new.sanction_id := null;
    return new;
  end if;
  if new.sanction_state is distinct from old.sanction_state
     or new.sanction_id is distinct from old.sanction_id then
    raise exception 'El estado de sanción de la cuenta lo gestiona soporte de We Ötzi.' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

create or replace function private.guard_studio_sanction_columns()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if public.wo_is_privileged_writer() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.sanction_state := 'none';
    new.sanction_id := null;
    return new;
  end if;
  if new.sanction_state is distinct from old.sanction_state
     or new.sanction_id is distinct from old.sanction_id then
    raise exception 'El estado de sanción del estudio lo gestiona soporte de We Ötzi.' using errcode = '42501';
  end if;
  if old.sanction_state <> 'none' and new.is_active is distinct from old.is_active then
    raise exception 'Este estudio tiene una sanción activa: no puedes activarlo ni desactivarlo. Escribe a soporte.' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

create or replace function private.guard_quotation_support_closed_reason()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if public.wo_is_privileged_writer() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.support_closed_reason := null;
    return new;
  end if;
  if new.support_closed_reason is distinct from old.support_closed_reason then
    raise exception 'El motivo de cierre por soporte lo escribe solo soporte de We Ötzi.' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

revoke all on function private.guard_artist_sanction_columns() from public, anon, authenticated;
revoke all on function private.guard_studio_sanction_columns() from public, anon, authenticated;
revoke all on function private.guard_quotation_support_closed_reason() from public, anon, authenticated;

drop trigger if exists trg_guard_artist_sanction_columns on public.artists_db;
create trigger trg_guard_artist_sanction_columns
  before insert or update on public.artists_db
  for each row execute function private.guard_artist_sanction_columns();

drop trigger if exists trg_guard_studio_sanction_columns on public.studios;
create trigger trg_guard_studio_sanction_columns
  before insert or update on public.studios
  for each row execute function private.guard_studio_sanction_columns();

drop trigger if exists trg_guard_quotation_support_closed_reason on public.quotations_db;
create trigger trg_guard_quotation_support_closed_reason
  before insert or update on public.quotations_db
  for each row execute function private.guard_quotation_support_closed_reason();

-- ---------------------------------------------------------------------------
-- 5. Políticas públicas de artists_db: se suma sanction_state = 'none'
-- ---------------------------------------------------------------------------
drop policy if exists "Public can view artists for marketplace" on public.artists_db;
create policy "Public can view artists for marketplace"
  on public.artists_db for select
  using ((registration_status is distinct from 'incompleto'::text) and (sanction_state = 'none'::text));

drop policy if exists "Authenticated can view all artists for marketplace" on public.artists_db;
create policy "Authenticated can view all artists for marketplace"
  on public.artists_db for select
  using ((registration_status is distinct from 'incompleto'::text) and (sanction_state = 'none'::text));

-- ---------------------------------------------------------------------------
-- 6. Vistas con dueño privilegiado: el filtro 'incompleto' pasa a ser el
--    predicado. Se conservan columnas, security_barrier, grants y comentario
--    (create or replace view no los toca; security_barrier se repite).
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_view text;
  v_def text;
  v_old constant text := $q$a.registration_status IS DISTINCT FROM 'incompleto'::text$q$;
  v_new constant text := $q$public.artist_is_public(a.registration_status, a.sanction_state)$q$;
begin
  foreach v_view in array array['artists_with_location', 'public_artist_trips'] loop
    v_def := pg_get_viewdef(format('public.%I', v_view)::regclass, true);
    if position('artist_is_public' in v_def) > 0 then
      raise notice '%: ya usa artist_is_public, nada que hacer', v_view;
      continue;
    end if;
    if position(v_old in v_def) = 0 then
      raise exception '%: no tiene el filtro esperado (%): revisar la definición viva antes de aplicar', v_view, v_old;
    end if;
    v_def := rtrim(replace(v_def, v_old, v_new), E'; \n');
    execute format('create or replace view public.%I with (security_barrier = true) as %s', v_view, v_def);
  end loop;
end
$mig$;

-- ---------------------------------------------------------------------------
-- 7. Funciones SECURITY DEFINER que filtraban 'incompleto'
--    (get_artist_public_profile_preferences es de otro equipo: no se toca).
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_fn text;
  v_def text;
  v_old constant text := $q$a.registration_status is distinct from 'incompleto'$q$;
  v_new constant text := $q$public.artist_is_public(a.registration_status, a.sanction_state)$q$;
begin
  foreach v_fn in array array[
    'public.get_artist_public_badges(uuid)',
    'public.get_public_storefront(text,text)',
    'public.create_store_order(uuid,uuid,integer,text,text,text,jsonb,text,text,text)',
    'public.store_public_seller_bundle(text,uuid)',
    'public.store_seller_ready_artist(uuid)',
    'public.recalculate_most_wanted(integer,integer)'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise notice '%: no existe, se salta', v_fn;
      continue;
    end if;
    v_def := pg_get_functiondef(to_regprocedure(v_fn));
    if position('artist_is_public' in v_def) > 0 then
      raise notice '%: ya usa artist_is_public, nada que hacer', v_fn;
      continue;
    end if;
    if position(v_old in v_def) = 0 then
      raise warning '%: no tiene el filtro esperado, se salta (revisar a mano)', v_fn;
      continue;
    end if;
    execute replace(v_def, v_old, v_new);
  end loop;
end
$mig$;

-- ---------------------------------------------------------------------------
-- 7b. Estudios inactivos o sancionados fuera de lo público
--     La sanción del dueño (lib/sanciones-service.js, paso profile) fija
--     studios.sanction_state y apaga is_active; el predicado exige las dos
--     cosas por si una se restaurara sin la otra.
-- ---------------------------------------------------------------------------
create or replace function public.studio_is_public(is_active boolean, sanction_state text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select coalesce(is_active, false)
     and coalesce(sanction_state, 'none') = 'none';
$fn$;

comment on function public.studio_is_public(boolean, text) is
  'Estudio visible en superficies públicas: activo (is_active) y sin sanción (sanction_state = none).';

grant execute on function public.studio_is_public(boolean, text) to anon, authenticated, service_role;

-- Para políticas: anon no tiene privilegio sobre studios.sanction_state, así
-- que la política no puede leer la columna directamente.
create or replace function private.studio_is_listed(p_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from public.studios s
     where s.id = p_studio_id
       and public.studio_is_public(s.is_active, s.sanction_state)
  );
$fn$;

revoke all on function private.studio_is_listed(uuid) from public;
grant execute on function private.studio_is_listed(uuid) to anon, authenticated, service_role;

comment on function private.studio_is_listed(uuid) is
  'true si el estudio es público (studio_is_public). Para políticas RLS que no pueden leer sanction_state.';

-- Directorio de spots: los spots abiertos de un estudio oculto dejan de ser
-- públicos (el dueño y soporte los siguen viendo con spots_owner_full; quien
-- se postuló, con su propia política).
drop policy if exists spots_public_select_open on public.studio_spots;
create policy spots_public_select_open
  on public.studio_spots for select
  using ((status = 'open'::text) and private.studio_is_listed(studio_id));

-- Tienda pública: get_public_storefront y store_public_seller_bundle (de la
-- que depende get_public_store_product) pasan de «s.is_active» al predicado.
do $mig$
declare
  v_fn text;
  v_def text;
  v_count integer;
  v_old constant text := $q$and s.is_active$q$;
  v_new constant text := $q$and public.studio_is_public(s.is_active, s.sanction_state)$q$;
begin
  foreach v_fn in array array[
    'public.get_public_storefront(text,text)',
    'public.store_public_seller_bundle(text,uuid)'
  ] loop
    v_def := pg_get_functiondef(to_regprocedure(v_fn));
    if position('studio_is_public' in v_def) > 0 then
      raise notice '%: ya usa studio_is_public, nada que hacer', v_fn;
      continue;
    end if;
    v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    if v_count <> 1 then
      raise exception '%: se esperaba un único «%» (hay %): revisar la definición viva antes de aplicar', v_fn, v_old, v_count;
    end if;
    execute replace(v_def, v_old, v_new);
  end loop;
end
$mig$;

-- Compra: no se crea un pedido a un estudio oculto (el enlace al producto
-- puede haber quedado abierto). Mismo error que un vendedor sin configurar.
do $mig$
declare
  v_def text;
  v_anchor constant text := $q$(v_product.seller_type = 'artist' and not public.store_seller_ready_artist(v_product.seller_id)) then$q$;
  v_new constant text := $q$(v_product.seller_type = 'artist' and not public.store_seller_ready_artist(v_product.seller_id))
     or (v_product.seller_type = 'studio' and not private.studio_is_listed(v_product.seller_id)) then$q$;
begin
  v_def := pg_get_functiondef('public.create_store_order(uuid,uuid,integer,text,text,text,jsonb,text,text,text)'::regprocedure);
  if position('studio_is_listed' in v_def) > 0 then
    raise notice 'create_store_order ya revisa el estudio: nada que hacer';
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'create_store_order no tiene la validación de vendedor esperada: revisar la definición viva antes de aplicar';
  end if;
  execute replace(v_def, v_anchor, v_new);
end
$mig$;

-- artists_with_location: el estudio (nombre, enlace, dirección y teléfono)
-- solo se une si es público; si no, el artista queda con su propia ubicación.
do $mig$
declare
  v_def text;
  v_old constant text := $q$LEFT JOIN studios s ON a.studio_id = s.id AND (a.work_type = ANY (ARRAY['studio'::text, 'both'::text]))$q$;
  v_new constant text := $q$LEFT JOIN studios s ON a.studio_id = s.id AND (a.work_type = ANY (ARRAY['studio'::text, 'both'::text])) AND public.studio_is_public(s.is_active, s.sanction_state)$q$;
begin
  v_def := pg_get_viewdef('public.artists_with_location'::regclass, true);
  if position('studio_is_public' in v_def) > 0 then
    raise notice 'artists_with_location: ya usa studio_is_public, nada que hacer';
    return;
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'artists_with_location: no tiene la unión con studios esperada: revisar la definición viva antes de aplicar';
  end if;
  v_def := rtrim(replace(v_def, v_old, v_new), E'; \n');
  execute format('create or replace view public.artists_with_location with (security_barrier = true) as %s', v_def);
end
$mig$;

-- ---------------------------------------------------------------------------
-- 8. Retiros: bloqueados con una suspensión o un baneo activo o apelado
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_def text;
  v_anchor constant text := E'  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then\n';
  v_guard constant text := E'  -- Sanción activa (suspensión o baneo): sin retiros hasta que soporte la levante.\n'
    || E'  if exists (\n'
    || E'    select 1 from public.account_sanctions s\n'
    || E'     where s.user_id = v_user_id\n'
    || E'       and s.kind in (''suspension'', ''ban'')\n'
    || E'       and s.status in (''active'', ''appealed'')\n'
    || E'  ) then\n'
    || E'    raise exception ''Tu cuenta tiene una sanción activa: no puedes solicitar retiros por ahora.'' using errcode = ''42501'';\n'
    || E'  end if;\n';
begin
  v_def := pg_get_functiondef('public.request_artist_wallet_withdrawal(uuid,numeric,text)'::regprocedure);
  if position('account_sanctions' in v_def) > 0 then
    raise notice 'request_artist_wallet_withdrawal ya revisa sanciones: nada que hacer';
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'request_artist_wallet_withdrawal no tiene la validación de monto esperada: revisar la definición viva antes de aplicar';
  end if;
  execute replace(v_def, v_anchor, v_guard || v_anchor);
end
$mig$;

-- ---------------------------------------------------------------------------
-- 9. Revocar sesiones de Auth (solo service_role)
-- ---------------------------------------------------------------------------
create or replace function private.revoke_user_sessions(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_count integer := 0;
begin
  if p_user is null then
    return 0;
  end if;
  -- Los refresh tokens de esas sesiones caen en cascada.
  delete from auth.sessions where user_id = p_user;
  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

revoke all on function private.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function private.revoke_user_sessions(uuid) to service_role;

comment on function private.revoke_user_sessions(uuid) is
  'Borra las sesiones de Auth del usuario (sanciones). Solo service_role.';

create or replace function public.revoke_user_sessions(p_user uuid)
returns integer
language sql
security definer
set search_path = ''
as $fn$
  select private.revoke_user_sessions(p_user);
$fn$;

revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

comment on function public.revoke_user_sessions(uuid) is
  'Envoltorio rpc de private.revoke_user_sessions. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 10. Etiqueta del anticipo en la billetera
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_def text;
  v_old constant text := $q$when 'deposit' then 'Seña recibida'$q$;
  v_new constant text := $q$when 'deposit' then 'Anticipo recibido'$q$;
begin
  v_def := pg_get_functiondef('public.quotation_payments_wallet_feed()'::regprocedure);
  if position(v_new in v_def) > 0 then
    raise notice 'quotation_payments_wallet_feed ya dice «Anticipo recibido»: nada que hacer';
    return;
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'quotation_payments_wallet_feed no tiene la etiqueta esperada: revisar la definición viva antes de aplicar';
  end if;
  execute replace(v_def, v_old, v_new);
end
$mig$;

commit;
