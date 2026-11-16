-- Negociación de la cotización · contrapropuestas y enmiendas del acuerdo
-- (ronda 2 · frente "negociacion" · 16 nov 2026).
--
-- P23. Sobre una propuesta recibida el cliente puede Aceptar, Rechazar o
--   MODIFICAR: propone otro presupuesto y/o cambios del pedido (zona, tamaño,
--   estilo, color, idea). El artista ve el antes → después y acepta los cambios
--   (la cotización queda aprobada por ambas partes) o manda otra propuesta.
--   Rechazar es definitivo: el artista ya no puede reabrir la cotización ni
--   escribirle al cliente por el chat.
-- P25. Con el acuerdo aprobado, cualquiera de las dos partes propone cambios
--   de precio, sesiones, seña o condiciones. No rigen hasta que la otra parte
--   los aprueba: recién ahí se aplican, de forma atómica, y queda el historial.
-- P4-saldo. "Aprobada por ambas partes" queda inequívoco en la base:
--   quotations_db.agreement_approved_at IS NOT NULL (y agreement_version ≥ 1).
--
-- Qué crea:
--   1. quotations_db.agreement_approved_at / agreement_version (+ backfill).
--   2. public.quotation_proposals: quién propone, campos antes → después,
--      estado pending | accepted | rejected | superseded | withdrawn. Una sola
--      propuesta pendiente por cotización. Solo lectura para las partes (RLS);
--      las escrituras pasan por las funciones de abajo (service_role).
--   3. Triggers en quotations_db:
--        trg_quotation_zy_negociacion_guard  sello del acuerdo, rechazo
--            definitivo (tampoco lo reabre el servidor con service_role) y
--            bloqueo de edición directa del acuerdo aprobado, incluida la
--            vuelta a pending / responded para reescribirlo (solo si el
--            cliente tiene cuenta: sin contraparte en la plataforma, el
--            artista sigue editando el acuerdo como antes). El vínculo con el
--            cliente lo protege 20261116220000 (fn_quotations_client_column_guard).
--        trg_quotation_zz_negociacion_sync   cierra las propuestas pendientes
--            cuando la cotización cambia de estado y, si el artista manda una
--            propuesta nueva sobre una contrapropuesta, la reemplaza y deja el
--            pedido con los cambios que pidió el cliente.
--   4. Policy restrictiva en chat_messages: el artista de una cotización
--      client_rejected no puede insertar mensajes (chat cerrado).
--   5. negociacion_propose / negociacion_resolve: alta y resolución atómicas
--      (bloquean la cotización, revalidan estado, pagos y sesiones).
--
-- No toca fn_quotation_status_change, fn_quotations_client_column_guard ni
-- chat_messages_before_insert (otros frentes los pueden cambiar): todo va en
-- funciones y triggers propios, que corren DESPUÉS por orden alfabético.
--
-- Idempotente. Reversa:
-- supabase/rollbacks/20261116140000_negociacion_propuestas.down.sql

begin;

-- ====================================================================
-- 1. Acuerdo aprobado por ambas partes
-- ====================================================================
alter table public.quotations_db
  add column if not exists agreement_approved_at timestamptz,
  add column if not exists agreement_version integer not null default 0;

alter table public.quotations_db
  drop constraint if exists quotations_db_agreement_version_check;
alter table public.quotations_db
  add constraint quotations_db_agreement_version_check
  check (agreement_version >= 0);

comment on column public.quotations_db.agreement_approved_at is
  'Momento en que la cotización quedó aprobada por ambas partes (cliente y artista). NULL = todavía no hay acuerdo. Lo sella el trigger trg_quotation_zy_negociacion_guard al pasar a client_approved; vuelve a NULL si la cotización regresa a pending/responded.';
comment on column public.quotations_db.agreement_version is
  'Versión del acuerdo: 0 sin acuerdo, 1 al aprobarse y +1 por cada enmienda aprobada por ambas partes (quotation_proposals.kind = ''amendment'').';

-- Backfill: lo que ya estaba aprobado antes de esta migración. Sin tocar
-- updated_at (se desactiva solo el trigger de timestamp durante el update).
do $$
begin
  if exists (select 1 from pg_trigger where tgrelid = 'public.quotations_db'::regclass and tgname = 'quotations_updated') then
    alter table public.quotations_db disable trigger quotations_updated;
  end if;
end;
$$;

update public.quotations_db q
   set agreement_approved_at = coalesce(
         (select max(h.changed_at)
            from public.quotation_status_history h
           where h.quotation_id = q.id and h.new_status = 'client_approved'),
         q.updated_at, q.created_at, now()),
       agreement_version = greatest(q.agreement_version, 1)
 where q.agreement_approved_at is null
   and (
     q.quote_status in ('client_approved', 'artist_completed', 'completed')
     or (
       q.quote_status in ('in_progress', 'en_progreso')
       -- in_progress también es el borrador del cotizador del cliente.
       and not (
         q.artist_responded_at is null
         and nullif(btrim(coalesce(q.final_budget_amount, '')), '') is null
         and nullif(btrim(coalesce(q.final_sessions, '')), '') is null
       )
     )
   );

do $$
begin
  if exists (select 1 from pg_trigger where tgrelid = 'public.quotations_db'::regclass and tgname = 'quotations_updated') then
    alter table public.quotations_db enable trigger quotations_updated;
  end if;
end;
$$;

-- ====================================================================
-- 2. Propuestas y contrapropuestas
-- ====================================================================
create table if not exists public.quotation_proposals (
  id uuid primary key default gen_random_uuid(),
  quotation_id integer not null references public.quotations_db(id) on delete cascade,
  quote_id text not null,
  kind text not null,
  proposed_by text not null,
  proposer_user_id uuid not null,
  status text not null default 'pending',
  changes jsonb not null,
  currency text,
  note text,
  response_note text,
  resolved_by uuid,
  resolved_at timestamptz,
  base_agreement_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quotation_proposals_kind_check check (kind in ('counter', 'amendment')),
  constraint quotation_proposals_proposed_by_check check (proposed_by in ('client', 'artist')),
  constraint quotation_proposals_status_check
    check (status in ('pending', 'accepted', 'rejected', 'superseded', 'withdrawn')),
  constraint quotation_proposals_changes_check
    check (jsonb_typeof(changes) = 'object' and changes <> '{}'::jsonb),
  constraint quotation_proposals_note_check check (note is null or char_length(note) <= 600),
  constraint quotation_proposals_response_note_check
    check (response_note is null or char_length(response_note) <= 600),
  constraint quotation_proposals_resolved_check check ((status = 'pending') = (resolved_at is null))
);

comment on table public.quotation_proposals is
  'Negociación de una cotización. kind=counter: el cliente propone cambios sobre la propuesta del artista (antes del acuerdo). kind=amendment: cualquiera de las partes propone cambiar el acuerdo ya aprobado. changes = { "<columna>": { "from": …, "to": … } }. Solo una fila pending por cotización. Se escribe con negociacion_propose / negociacion_resolve.';
comment on column public.quotation_proposals.changes is
  'Campos cambiados antes → después. counter: artist_budget_amount, tattoo_body_part, tattoo_size, tattoo_style, tattoo_color_type, tattoo_idea_description. amendment: final_budget_amount, final_sessions, artist_deposit_pct, final_comment.';

create unique index if not exists quotation_proposals_one_pending_idx
  on public.quotation_proposals (quotation_id) where status = 'pending';
create index if not exists quotation_proposals_quotation_idx
  on public.quotation_proposals (quotation_id, created_at desc);
create index if not exists quotation_proposals_quote_id_idx
  on public.quotation_proposals (quote_id);

alter table public.quotation_proposals enable row level security;

drop policy if exists quotation_proposals_party_select on public.quotation_proposals;
create policy quotation_proposals_party_select
  on public.quotation_proposals
  for select
  to authenticated
  using (
    exists (
      select 1 from public.quotations_db q
       where q.id = quotation_proposals.quotation_id
         and (q.client_user_id = (select auth.uid()) or q.artist_id = (select auth.uid()))
    )
    or public.is_support_user()
  );

revoke all on table public.quotation_proposals from public, anon, authenticated;
grant select on table public.quotation_proposals to authenticated;
grant all on table public.quotation_proposals to service_role;

-- ====================================================================
-- 3. Triggers de quotations_db
-- ====================================================================

-- 3a. Guardia (derechos del que llama: usa current_user como los otros
-- guardias de la tabla). Corre después de trg_quotation_status_change.
create or replace function public.negociacion_quotation_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_restricted boolean := current_user in ('anon', 'authenticated')
                          and not coalesce(public.is_support_user(), false);
begin
  -- El sello del acuerdo no lo escribe el usuario final.
  if v_restricted then
    new.agreement_approved_at := old.agreement_approved_at;
    new.agreement_version := old.agreement_version;
  end if;

  if new.quote_status is distinct from old.quote_status then
    -- Rechazo del cliente = cotización finalizada: el artista no la reabre.
    -- También frena a service_role: el servidor guarda la propuesta del
    -- artista con service-role (lib/repos/cot-respuesta.js) y no debe poder
    -- reabrirla en su nombre. Soporte (is_support_user) y postgres sí pueden.
    if old.quote_status = 'client_rejected'
       and current_user in ('anon', 'authenticated', 'service_role')
       and not coalesce(public.is_support_user(), false) then
      raise exception 'El cliente rechazó esta cotización y quedó finalizada. Para retomarla, el cliente tiene que iniciar una nueva.'
        using errcode = '42501';
    end if;

    -- Acuerdo aprobado con contraparte: el usuario final no lo devuelve a
    -- negociación. Si no, el artista podía pasar in_progress → pending (ahí se
    -- borra el sello), reescribir el precio, y volver a responded →
    -- client_approved para sellarlo de nuevo sin el cliente. El envío del
    -- borrador del cotizador (in_progress → pending) lo hace el servidor con
    -- service_role y un borrador nunca tiene el acuerdo sellado.
    if v_restricted
       and old.agreement_approved_at is not null
       and old.client_user_id is not null
       and new.quote_status in ('pending', 'responded') then
      raise exception 'El acuerdo ya está aprobado por ambas partes: propón el cambio y regirá cuando la otra parte lo apruebe.'
        using errcode = '42501';
    end if;

    if new.quote_status = 'client_approved' then
      -- Aprobada por ambas partes (acepta el cliente, el artista acepta la
      -- contrapropuesta o el artista registra el acuerdo).
      new.agreement_approved_at := coalesce(new.agreement_approved_at, now());
      new.agreement_version := greatest(coalesce(new.agreement_version, 0), 1);
    elsif new.quote_status in ('pending', 'responded') then
      -- Vuelve a negociación: ya no hay acuerdo vigente.
      new.agreement_approved_at := null;
      new.agreement_version := 0;
    end if;
  end if;

  -- Acuerdo aprobado: precio, sesiones, seña y condiciones no se editan
  -- directo; se proponen (quotation_proposals) y rigen al aprobarlos. Solo
  -- cuando hay contraparte que pueda aprobar: si el cliente no tiene cuenta
  -- (cotización manual o de invitado), el artista edita como siempre.
  if v_restricted
     and old.agreement_approved_at is not null
     and old.client_user_id is not null
     and (
       new.final_budget_amount is distinct from old.final_budget_amount
       or new.final_budget_currency is distinct from old.final_budget_currency
       or new.final_sessions is distinct from old.final_sessions
       or new.final_comment is distinct from old.final_comment
       or new.artist_deposit_pct is distinct from old.artist_deposit_pct
       or new.artist_deposit_amount is distinct from old.artist_deposit_amount
     ) then
    raise exception 'El acuerdo ya está aprobado por ambas partes: propón el cambio y regirá cuando la otra parte lo apruebe.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.negociacion_quotation_guard() from public, anon, authenticated;

drop trigger if exists trg_quotation_zy_negociacion_guard on public.quotations_db;
create trigger trg_quotation_zy_negociacion_guard
  before update on public.quotations_db
  for each row execute function public.negociacion_quotation_guard();

-- 3b. Sincronización con quotation_proposals (security definer: el artista
-- no tiene permisos de escritura sobre la tabla de propuestas).
create or replace function public.negociacion_quotation_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.quotation_proposals;
begin
  -- El artista manda una propuesta nueva mientras hay una contrapropuesta
  -- del cliente pendiente: la reemplaza. El pedido queda con los cambios que
  -- pidió el cliente (zona, tamaño, estilo, color, idea): la propuesta nueva
  -- responde a ese pedido. El presupuesto es el que manda el artista.
  if new.quote_status = 'responded'
     and (
       new.artist_responded_at is distinct from old.artist_responded_at
       or new.artist_budget_amount is distinct from old.artist_budget_amount
       or new.artist_budget_currency is distinct from old.artist_budget_currency
     ) then
    select * into v_p
      from public.quotation_proposals p
     where p.quotation_id = new.id and p.status = 'pending' and p.kind = 'counter'
     for update;
    if found then
      if v_p.changes ? 'tattoo_body_part' and new.tattoo_body_part is not distinct from old.tattoo_body_part then
        new.tattoo_body_part := v_p.changes #>> '{tattoo_body_part,to}';
      end if;
      if v_p.changes ? 'tattoo_size' and new.tattoo_size is not distinct from old.tattoo_size then
        new.tattoo_size := v_p.changes #>> '{tattoo_size,to}';
      end if;
      if v_p.changes ? 'tattoo_color_type' and new.tattoo_color_type is not distinct from old.tattoo_color_type then
        new.tattoo_color_type := v_p.changes #>> '{tattoo_color_type,to}';
      end if;
      if v_p.changes ? 'tattoo_idea_description'
         and new.tattoo_idea_description is not distinct from old.tattoo_idea_description then
        new.tattoo_idea_description := v_p.changes #>> '{tattoo_idea_description,to}';
      end if;
      if v_p.changes ? 'tattoo_style' and new.tattoo_style is not distinct from old.tattoo_style then
        new.tattoo_style := v_p.changes #> '{tattoo_style,to}';
      end if;
      update public.quotation_proposals
         set status = 'superseded', resolved_at = now(), resolved_by = auth.uid(), updated_at = now(),
             response_note = 'El artista envió una propuesta nueva.'
       where id = v_p.id;
    end if;
  end if;

  -- La cotización cambia de estado: las propuestas pendientes dejan de tener
  -- sentido (una contrapropuesta solo vive en responded; una enmienda muere
  -- si la cotización se cierra).
  if new.quote_status is distinct from old.quote_status then
    update public.quotation_proposals
       set status = 'superseded', resolved_at = now(), updated_at = now(),
           response_note = coalesce(response_note, 'La cotización cambió de estado.')
     where quotation_id = new.id
       and status = 'pending'
       and (kind = 'counter' or new.quote_status in ('completed', 'cancelled', 'client_rejected', 'expired'));
  end if;

  return new;
end;
$$;

revoke all on function public.negociacion_quotation_sync() from public, anon, authenticated;

drop trigger if exists trg_quotation_zz_negociacion_sync on public.quotations_db;
create trigger trg_quotation_zz_negociacion_sync
  before update on public.quotations_db
  for each row execute function public.negociacion_quotation_sync();

-- ====================================================================
-- 4. Chat cerrado tras el rechazo del cliente
-- ====================================================================
-- Restrictiva: se suma (AND) a artists_insert_chat / clients_insert_chat. El
-- artista de una cotización client_rejected no puede insertar mensajes, sea
-- cual sea el sender_type que declare. service_role (avisos del servidor) no
-- pasa por RLS.
drop policy if exists chat_closed_after_client_rejection on public.chat_messages;
create policy chat_closed_after_client_rejection
  on public.chat_messages
  as restrictive
  for insert
  to public
  with check (
    not exists (
      select 1 from public.quotations_db q
       where q.quote_id::text = chat_messages.quotation_id
         and q.quote_status = 'client_rejected'
         and q.artist_id = (select auth.uid())
    )
  );

-- ====================================================================
-- 5. Alta y resolución atómicas (solo service_role)
-- ====================================================================

-- Seña vigente de una cotización: la de quotations_db o, si viene de una
-- cotización manual enviada, la de esa fila. NULL = sin seña.
create or replace function public.negociacion_deposit_pct(p_quote public.quotations_db)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nullif(coalesce(
    p_quote.artist_deposit_pct,
    (select m.deposit_pct
       from public.artist_manual_quotes m
      where m.quote_id = p_quote.quote_id::text and m.status = 'sent' and m.deposit_amount > 0
      limit 1)
  ), 0);
$$;

revoke all on function public.negociacion_deposit_pct(public.quotations_db) from public, anon, authenticated;
grant execute on function public.negociacion_deposit_pct(public.quotations_db) to service_role;

create or replace function public.negociacion_propose(
  p_quotation_id integer,
  p_actor uuid,
  p_role text,
  p_kind text,
  p_changes jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_q public.quotations_db;
  v_row public.quotation_proposals;
  v_changes jsonb := '{}'::jsonb;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 600);
  v_allowed text[];
  v_currency text;
  v_key text;
  v_to jsonb;
  v_text text;
  v_from text;
  v_num numeric;
  v_from_num numeric;
  v_int integer;
  v_paid numeric;
  v_count integer;
  v_json jsonb;
  v_min integer;
  v_max integer;
begin
  if p_actor is null
     or p_role is null or p_role not in ('client', 'artist')
     or p_kind is null or p_kind not in ('counter', 'amendment')
     or p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'NEG_BAD_REQUEST' using errcode = '22023';
  end if;

  select * into v_q from public.quotations_db where id = p_quotation_id for update;
  if not found then
    raise exception 'NEG_NOT_FOUND' using errcode = 'P0002';
  end if;

  if (p_role = 'client' and v_q.client_user_id is distinct from p_actor)
     or (p_role = 'artist' and v_q.artist_id is distinct from p_actor) then
    raise exception 'NEG_FORBIDDEN' using errcode = '42501';
  end if;
  if coalesce(v_q.dispute_status, 'none') = 'open' then
    raise exception 'NEG_DISPUTE' using errcode = '22023';
  end if;

  if p_kind = 'counter' then
    -- Solo el cliente contrapropone; la "otra propuesta" del artista es su
    -- respuesta (quotations_db), no una fila de esta tabla.
    if p_role <> 'client' then
      raise exception 'NEG_FORBIDDEN' using errcode = '42501';
    end if;
    if v_q.quote_status is distinct from 'responded' then
      raise exception 'NEG_STATUS' using errcode = '22023', detail = coalesce(v_q.quote_status, '');
    end if;
    if v_q.quote_expires_at is not null and v_q.quote_expires_at <= now() then
      raise exception 'NEG_EXPIRED' using errcode = '22023';
    end if;
    v_allowed := array['artist_budget_amount', 'tattoo_body_part', 'tattoo_size', 'tattoo_style',
                       'tattoo_color_type', 'tattoo_idea_description'];
    v_currency := upper(btrim(coalesce(v_q.artist_budget_currency, '')));
  else
    if v_q.agreement_approved_at is null
       or v_q.quote_status not in ('client_approved', 'in_progress', 'en_progreso', 'artist_completed') then
      raise exception 'NEG_STATUS' using errcode = '22023', detail = coalesce(v_q.quote_status, '');
    end if;
    -- Sin contraparte con cuenta nadie podría aprobar el cambio.
    if v_q.client_user_id is null or v_q.artist_id is null then
      raise exception 'NEG_NO_COUNTERPARTY' using errcode = '22023';
    end if;
    v_allowed := array['final_budget_amount', 'final_sessions', 'artist_deposit_pct', 'final_comment'];
    v_currency := upper(btrim(coalesce(
      nullif(btrim(coalesce(v_q.final_budget_currency, '')), ''), v_q.artist_budget_currency, '')));
  end if;

  for v_key, v_to in select e.key, e.value from jsonb_each(p_changes) e loop
    if not (v_key = any (v_allowed)) then
      raise exception 'NEG_FIELD' using errcode = '22023', detail = v_key;
    end if;

    if v_key in ('artist_budget_amount', 'final_budget_amount') then
      v_text := btrim(coalesce(v_to #>> '{}', ''));
      if jsonb_typeof(v_to) not in ('number', 'string') or v_text !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then
        raise exception 'NEG_VALUE' using errcode = '22023', detail = v_key;
      end if;
      v_num := v_text::numeric;
      if v_num <= 0 then
        raise exception 'NEG_VALUE' using errcode = '22023', detail = v_key;
      end if;
      if v_currency !~ '^[A-Z]{3}$' then
        raise exception 'NEG_CURRENCY' using errcode = '22023';
      end if;
      v_from := nullif(btrim(coalesce(v_q.artist_budget_amount, '')), '');
      if v_key = 'final_budget_amount' then
        v_from := coalesce(nullif(btrim(coalesce(v_q.final_budget_amount, '')), ''), v_from);
      end if;
      v_from_num := case when v_from ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then v_from::numeric end;
      if v_from_num is not distinct from v_num then
        continue;
      end if;
      if v_key = 'final_budget_amount' then
        select coalesce(sum(p.amount), 0) into v_paid
          from public.quotation_payments p
         where p.quotation_id = v_q.id and upper(p.currency) = v_currency;
        if v_num < v_paid then
          raise exception 'NEG_BELOW_PAID' using errcode = '22023', detail = trim_scale(v_paid)::text;
        end if;
      end if;
      v_changes := v_changes || jsonb_build_object(v_key,
        jsonb_build_object('from', v_from, 'to', trim_scale(v_num)::text));

    elsif v_key = 'final_sessions' then
      v_text := btrim(coalesce(v_to #>> '{}', ''));
      if jsonb_typeof(v_to) not in ('number', 'string') or v_text !~ '^[0-9]{1,2}$' then
        raise exception 'NEG_VALUE' using errcode = '22023', detail = v_key;
      end if;
      v_int := v_text::integer;
      if v_int < 1 or v_int > 30 then
        raise exception 'NEG_VALUE' using errcode = '22023', detail = v_key;
      end if;
      v_from := coalesce(
        nullif(btrim(coalesce(v_q.final_sessions, '')), ''),
        nullif(btrim(coalesce(v_q.tattoo_estimated_sessions, '')), ''));
      if v_from ~ '^[0-9]{1,3}$' and v_from::integer = v_int then
        continue;
      end if;
      select count(*) into v_count
        from public.quotation_sessions s
       where s.quotation_id = v_q.id
         and lower(coalesce(s.status, '')) not in ('cancelled', 'canceled', 'no_show');
      if v_int < v_count then
        raise exception 'NEG_BELOW_SESSIONS' using errcode = '22023', detail = v_count::text;
      end if;
      v_changes := v_changes || jsonb_build_object(v_key,
        jsonb_build_object('from', v_from, 'to', v_int::text));

    elsif v_key = 'artist_deposit_pct' then
      if jsonb_typeof(v_to) = 'null' or btrim(coalesce(v_to #>> '{}', '')) = '' then
        v_num := null;
      else
        v_text := btrim(v_to #>> '{}');
        if jsonb_typeof(v_to) not in ('number', 'string') or v_text !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' then
          raise exception 'NEG_VALUE' using errcode = '22023', detail = v_key;
        end if;
        v_num := nullif(v_text::numeric, 0);
        if v_num > 100 then
          raise exception 'NEG_VALUE' using errcode = '22023', detail = v_key;
        end if;
      end if;
      v_from_num := public.negociacion_deposit_pct(v_q);
      if v_from_num is not distinct from v_num then
        continue;
      end if;
      v_changes := v_changes || jsonb_build_object(v_key,
        jsonb_build_object('from', trim_scale(v_from_num), 'to', trim_scale(v_num)));

    elsif v_key = 'final_comment' then
      if jsonb_typeof(v_to) not in ('string', 'null') then
        raise exception 'NEG_VALUE' using errcode = '22023', detail = v_key;
      end if;
      v_text := nullif(btrim(coalesce(v_to #>> '{}', '')), '');
      if char_length(coalesce(v_text, '')) > 600 then
        raise exception 'NEG_VALUE' using errcode = '22023', detail = v_key;
      end if;
      v_from := nullif(btrim(coalesce(v_q.final_comment, '')), '');
      if v_from is not distinct from v_text then
        continue;
      end if;
      v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('from', v_from, 'to', v_text));

    elsif v_key = 'tattoo_style' then
      if jsonb_typeof(v_to) <> 'array' or jsonb_array_length(v_to) not between 1 and 3
         or exists (
           select 1 from jsonb_array_elements(v_to) e
            where jsonb_typeof(e.value) <> 'string'
               or char_length(btrim(e.value #>> '{}')) not between 1 and 60
         ) then
        raise exception 'NEG_VALUE' using errcode = '22023', detail = v_key;
      end if;
      select jsonb_agg(btrim(e.value #>> '{}') order by e.ordinality) into v_json
        from jsonb_array_elements(v_to) with ordinality e;
      if v_q.tattoo_style is not distinct from v_json then
        continue;
      end if;
      v_changes := v_changes || jsonb_build_object(v_key,
        jsonb_build_object('from', v_q.tattoo_style, 'to', v_json));

    else
      -- Texto del pedido: zona, tamaño, color e idea.
      if jsonb_typeof(v_to) <> 'string' then
        raise exception 'NEG_VALUE' using errcode = '22023', detail = v_key;
      end if;
      v_text := btrim(v_to #>> '{}');
      v_min := case v_key when 'tattoo_idea_description' then 10 when 'tattoo_body_part' then 2 else 1 end;
      v_max := case v_key
        when 'tattoo_idea_description' then 2000
        when 'tattoo_body_part' then 200
        when 'tattoo_size' then 80
        else 50 end;
      if char_length(v_text) < v_min or char_length(v_text) > v_max then
        raise exception 'NEG_VALUE' using errcode = '22023', detail = v_key;
      end if;
      v_from := nullif(btrim(coalesce(to_jsonb(v_q) ->> v_key, '')), '');
      if v_from is not distinct from v_text then
        continue;
      end if;
      v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('from', v_from, 'to', v_text));
    end if;
  end loop;

  if v_changes = '{}'::jsonb then
    raise exception 'NEG_NO_CHANGES' using errcode = '22023';
  end if;

  select count(*) into v_count from public.quotation_proposals p where p.quotation_id = v_q.id;
  if v_count >= 60 then
    raise exception 'NEG_LIMIT' using errcode = '22023';
  end if;

  -- Una sola propuesta pendiente: la nueva reemplaza a la anterior.
  update public.quotation_proposals
     set status = 'superseded', resolved_at = now(), resolved_by = p_actor, updated_at = now(),
         response_note = coalesce(response_note, 'Reemplazada por una propuesta nueva.')
   where quotation_id = v_q.id and status = 'pending';

  insert into public.quotation_proposals (
    quotation_id, quote_id, kind, proposed_by, proposer_user_id, changes, currency, note, base_agreement_version
  ) values (
    v_q.id, v_q.quote_id, p_kind, p_role, p_actor, v_changes, nullif(v_currency, ''), v_note,
    coalesce(v_q.agreement_version, 0)
  )
  returning * into v_row;

  -- El cliente respondió a tiempo: el vencimiento opcional se corre para que
  -- el artista tenga el plazo completo para contestar la contrapropuesta.
  if p_kind = 'counter' and v_q.quote_expiry_enabled and v_q.quote_expiry_days between 1 and 365 then
    update public.quotations_db
       set quote_expires_at = greatest(coalesce(quote_expires_at, now()),
                                       now() + make_interval(days => v_q.quote_expiry_days))
     where id = v_q.id;
  end if;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.negociacion_resolve(
  p_proposal_id uuid,
  p_actor uuid,
  p_action text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.quotation_proposals;
  v_q public.quotations_db;
  v_quotation_id integer;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 600);
  v_budget text;
  v_currency text;
  v_paid numeric;
  v_count integer;
  v_pct numeric;
  v_total numeric;
  v_deposit numeric;
  v_touch_deposit boolean := false;
  v_raw text;
begin
  if p_actor is null or p_proposal_id is null
     or p_action is null or p_action not in ('accept', 'reject', 'withdraw') then
    raise exception 'NEG_BAD_REQUEST' using errcode = '22023';
  end if;

  select p.quotation_id into v_quotation_id from public.quotation_proposals p where p.id = p_proposal_id;
  if not found then
    raise exception 'NEG_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Mismo orden de bloqueo que negociacion_propose: cotización → propuesta.
  select * into v_q from public.quotations_db where id = v_quotation_id for update;
  select * into v_p from public.quotation_proposals where id = p_proposal_id for update;

  if p_action = 'withdraw' then
    if v_p.proposer_user_id is distinct from p_actor then
      raise exception 'NEG_FORBIDDEN' using errcode = '42501';
    end if;
  elsif (v_p.proposed_by = 'client' and v_q.artist_id is distinct from p_actor)
     or (v_p.proposed_by = 'artist' and v_q.client_user_id is distinct from p_actor) then
    -- Aprueba o rechaza solo la contraparte.
    raise exception 'NEG_FORBIDDEN' using errcode = '42501';
  end if;

  if v_p.status <> 'pending' then
    if (p_action = 'accept' and v_p.status = 'accepted')
       or (p_action = 'reject' and v_p.status = 'rejected')
       or (p_action = 'withdraw' and v_p.status = 'withdrawn') then
      return jsonb_build_object('already', true, 'proposal', to_jsonb(v_p));
    end if;
    raise exception 'NEG_NOT_PENDING' using errcode = '22023', detail = v_p.status;
  end if;

  -- Rechazar o retirar no cambia nada de la cotización.
  if p_action in ('reject', 'withdraw') then
    update public.quotation_proposals
       set status = case when p_action = 'reject' then 'rejected' else 'withdrawn' end,
           resolved_by = p_actor, resolved_at = now(), updated_at = now(), response_note = v_note
     where id = v_p.id
    returning * into v_p;
    return jsonb_build_object('already', false, 'proposal', to_jsonb(v_p));
  end if;

  if coalesce(v_q.dispute_status, 'none') = 'open' then
    raise exception 'NEG_DISPUTE' using errcode = '22023';
  end if;

  if v_p.kind = 'counter' then
    if v_q.quote_status is distinct from 'responded' then
      raise exception 'NEG_STATUS' using errcode = '22023', detail = coalesce(v_q.quote_status, '');
    end if;

    -- Primero se cierra la propuesta: el trigger de sincronización ya no la
    -- ve pendiente cuando cambia la cotización.
    update public.quotation_proposals
       set status = 'accepted', resolved_by = p_actor, resolved_at = now(), updated_at = now(),
           response_note = v_note
     where id = v_p.id
    returning * into v_p;

    v_budget := v_p.changes #>> '{artist_budget_amount,to}';

    -- Si cambia el presupuesto, la seña pedida (de la respuesta o de la
    -- cotización manual) se recalcula sobre el total nuevo.
    v_pct := public.negociacion_deposit_pct(v_q);
    v_touch_deposit := v_budget is not null and v_pct is not null;
    if v_touch_deposit then
      v_deposit := round(v_budget::numeric * v_pct / 100, 2);
    end if;

    -- Los cambios del cliente pasan a la cotización y la propuesta aceptada
    -- es el acuerdo (final_*): aprobada por ambas partes.
    update public.quotations_db q
       set artist_budget_amount = coalesce(v_budget, q.artist_budget_amount),
           tattoo_body_part = case when v_p.changes ? 'tattoo_body_part'
             then v_p.changes #>> '{tattoo_body_part,to}' else q.tattoo_body_part end,
           tattoo_size = case when v_p.changes ? 'tattoo_size'
             then v_p.changes #>> '{tattoo_size,to}' else q.tattoo_size end,
           tattoo_color_type = case when v_p.changes ? 'tattoo_color_type'
             then v_p.changes #>> '{tattoo_color_type,to}' else q.tattoo_color_type end,
           tattoo_idea_description = case when v_p.changes ? 'tattoo_idea_description'
             then v_p.changes #>> '{tattoo_idea_description,to}' else q.tattoo_idea_description end,
           tattoo_style = case when v_p.changes ? 'tattoo_style'
             then v_p.changes #> '{tattoo_style,to}' else q.tattoo_style end,
           final_budget_amount = coalesce(
             v_budget,
             nullif(btrim(coalesce(q.final_budget_amount, '')), ''),
             nullif(btrim(coalesce(q.artist_budget_amount, '')), '')),
           final_budget_currency = case
             when v_budget is not null then coalesce(nullif(btrim(coalesce(q.artist_budget_currency, '')), ''), v_p.currency)
             else coalesce(nullif(btrim(coalesce(q.final_budget_currency, '')), ''), q.artist_budget_currency) end,
           final_sessions = coalesce(
             nullif(btrim(coalesce(q.final_sessions, '')), ''),
             case when btrim(coalesce(q.tattoo_estimated_sessions, '')) ~ '^[1-9][0-9]?$'
                  then btrim(q.tattoo_estimated_sessions) end),
           artist_deposit_pct = case when v_touch_deposit then v_pct else q.artist_deposit_pct end,
           artist_deposit_amount = case when v_touch_deposit then v_deposit else q.artist_deposit_amount end,
           quote_status = 'client_approved'
     where q.id = v_q.id;

    if v_touch_deposit then
      update public.artist_manual_quotes m
         set deposit_pct = v_pct, deposit_amount = v_deposit, updated_at = timezone('utc', now())
       where m.quote_id = v_q.quote_id::text and m.status = 'sent';
    end if;

    -- fn_quotation_status_change deja changed_by en NULL con service_role.
    update public.quotation_status_history h
       set changed_by = p_actor::text,
           notes = 'El artista aceptó los cambios propuestos por el cliente.'
     where h.quotation_id = v_q.id
       and h.new_status = 'client_approved'
       and h.changed_by is null
       and h.changed_at = now();

  else
    if v_q.agreement_approved_at is null
       or v_q.quote_status not in ('client_approved', 'in_progress', 'en_progreso', 'artist_completed') then
      raise exception 'NEG_STATUS' using errcode = '22023', detail = coalesce(v_q.quote_status, '');
    end if;

    v_budget := v_p.changes #>> '{final_budget_amount,to}';
    v_currency := upper(btrim(coalesce(
      nullif(btrim(coalesce(v_q.final_budget_currency, '')), ''), v_q.artist_budget_currency, '')));

    -- Revalida contra lo que pasó desde que se propuso: no se acuerda menos
    -- de lo ya cobrado ni menos sesiones de las ya agendadas.
    if v_budget is not null then
      select coalesce(sum(p.amount), 0) into v_paid
        from public.quotation_payments p
       where p.quotation_id = v_q.id and upper(p.currency) = v_currency;
      if v_budget::numeric < v_paid then
        raise exception 'NEG_BELOW_PAID' using errcode = '22023', detail = trim_scale(v_paid)::text;
      end if;
    end if;
    if v_p.changes ? 'final_sessions' then
      select count(*) into v_count
        from public.quotation_sessions s
       where s.quotation_id = v_q.id
         and lower(coalesce(s.status, '')) not in ('cancelled', 'canceled', 'no_show');
      if (v_p.changes #>> '{final_sessions,to}')::integer < v_count then
        raise exception 'NEG_BELOW_SESSIONS' using errcode = '22023', detail = v_count::text;
      end if;
    end if;

    -- Seña: cambia si se propuso otro porcentaje o si cambia el total sobre
    -- el que se calcula (la seña acordada sigue al presupuesto final).
    if v_p.changes ? 'artist_deposit_pct' then
      v_pct := nullif((v_p.changes #>> '{artist_deposit_pct,to}')::numeric, 0);
      v_touch_deposit := true;
    else
      v_pct := public.negociacion_deposit_pct(v_q);
      v_touch_deposit := v_budget is not null and v_pct is not null;
    end if;
    if v_touch_deposit then
      v_raw := coalesce(v_budget,
        nullif(btrim(coalesce(v_q.final_budget_amount, '')), ''),
        nullif(btrim(coalesce(v_q.artist_budget_amount, '')), ''));
      v_total := case when v_raw ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then v_raw::numeric end;
      v_deposit := case
        when v_pct is null then null
        when v_total is null then v_q.artist_deposit_amount
        else round(v_total * v_pct / 100, 2) end;
    end if;

    update public.quotation_proposals
       set status = 'accepted', resolved_by = p_actor, resolved_at = now(), updated_at = now(),
           response_note = v_note
     where id = v_p.id
    returning * into v_p;

    update public.quotations_db q
       set final_budget_amount = coalesce(v_budget, q.final_budget_amount),
           final_budget_currency = case
             when v_budget is not null
               then coalesce(nullif(btrim(coalesce(q.final_budget_currency, '')), ''), q.artist_budget_currency)
             else q.final_budget_currency end,
           final_sessions = coalesce(v_p.changes #>> '{final_sessions,to}', q.final_sessions),
           final_comment = case when v_p.changes ? 'final_comment'
             then v_p.changes #>> '{final_comment,to}' else q.final_comment end,
           artist_deposit_pct = case when v_touch_deposit then v_pct else q.artist_deposit_pct end,
           artist_deposit_amount = case when v_touch_deposit then v_deposit else q.artist_deposit_amount end,
           agreement_version = greatest(coalesce(q.agreement_version, 0), 1) + 1
     where q.id = v_q.id;

    -- La cotización manual enviada guarda su propia seña y el panel de pagos
    -- la prefiere: se mantiene alineada con el acuerdo.
    if v_touch_deposit then
      update public.artist_manual_quotes m
         set deposit_pct = coalesce(v_pct, 0),
             deposit_amount = coalesce(v_deposit, 0),
             updated_at = timezone('utc', now())
       where m.quote_id = v_q.quote_id::text and m.status = 'sent';
    end if;
  end if;

  return jsonb_build_object('already', false, 'proposal', to_jsonb(v_p));
end;
$$;

revoke all on function public.negociacion_propose(integer, uuid, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.negociacion_resolve(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.negociacion_propose(integer, uuid, text, text, jsonb, text) to service_role;
grant execute on function public.negociacion_resolve(uuid, uuid, text, text) to service_role;

commit;
