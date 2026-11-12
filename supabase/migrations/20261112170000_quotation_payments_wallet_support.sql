-- Pagos de clientes por cotización + Wallet informativo + revisión de soporte
-- Ronda 3 · grupo "pagos" (12 nov 2026). Figma w3JA83CcP5ISKjyOu87mx1:
--   24:1425  dashboard · acción rápida REGISTRAR PAGO, actividad «Pago recibido»,
--            «Saldo pend.»
--   801:556  cotización manual · seña requerida (artist_manual_quotes.deposit_*)
--   801:580–583 detalle · saldo pendiente y pagos del proyecto
--   801:568  Cuenta #cobros · Wallet (artist_wallet_movements)
--   801:568/569/573 soporte · verificar destinos de retiro y documentos
--
-- NO APLICADA. Validada con begin … rollback en flbgmlvfiejfttlawnfu.
-- Aditiva e idempotente. Reversa:
--   supabase/rollbacks/20261112170000_quotation_payments_wallet_support.down.sql
--
-- DECISIÓN (custodia): los pagos que registra el artista a mano los cobró él,
-- fuera de We Ötzi (efectivo, transferencia directa…). We Ötzi no custodia
-- ese dinero, así que NO puede sumar al saldo retirable. Cada pago se refleja
-- en artist_wallet_movements como kind = 'payment', status = 'completed' con
-- metadata_json.off_platform = true: artist_wallet_available_balance() solo
-- suma release/adjustment, y wallet-model.js tampoco cuenta 'payment'
-- completados, así que el movimiento es solo informativo («Cobrado por fuera»).
-- Lo mismo para la cotización completada: un movimiento informativo con el
-- total acordado («Acuerdo cerrado»), que tampoco suma al saldo.
--
-- Contenido:
--   1. public.quotation_payments (+ RLS: el artista dueño y el cliente de la
--      cotización leen; soporte lee todo; nadie escribe directo).
--   2. Bucket privado quotation-payment-receipts (comprobantes opcionales).
--   3. RPC record_quotation_payment / void_quotation_payment (security definer:
--      ownership, estado de la cotización, monto > 0, moneda de las 24 de
--      CurrencyUtils.COUNTRY_CURRENCIES, fecha no futura, comprobante propio).
--   4. Triggers que alimentan artist_wallet_movements (pago registrado/anulado
--      y cotización completada). Nunca bloquean la escritura de origen.
--   5. RPC de soporte (is_support_user()): verificar/rechazar destinos de
--      retiro, aprobar/rechazar documentos de verificación con nota y fijar el
--      estado general de verificación del artista.

begin;

-- ============================ 1 · pagos ============================
create table if not exists public.quotation_payments (
  id uuid primary key default gen_random_uuid(),
  quotation_id integer not null references public.quotations_db (id) on delete cascade,
  quote_id text not null,
  artist_user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('deposit', 'session', 'balance', 'other')),
  method text not null check (method in ('cash', 'transfer', 'other')),
  amount numeric(14,2) not null check (amount > 0 and amount <= 1000000000),
  currency text not null check (currency in (
    'USD', 'CAD', 'MXN', 'CRC', 'COP', 'VES', 'PEN', 'BRL', 'ARS', 'CLP', 'UYU',
    'EUR', 'GBP', 'CHF', 'DKK', 'NOK', 'SEK', 'PLN',
    'KRW', 'THB', 'IDR', 'JPY', 'AUD', 'NZD')),
  paid_on date not null default current_date check (paid_on >= date '2015-01-01'),
  note text check (note is null or char_length(note) <= 500),
  client_name text check (client_name is null or char_length(client_name) <= 160),
  receipt_path text check (receipt_path is null or char_length(receipt_path) <= 300),
  receipt_name text check (receipt_name is null or char_length(receipt_name) <= 180),
  receipt_mime text check (receipt_mime is null or receipt_mime in
    ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf')),
  receipt_size integer check (receipt_size is null or receipt_size between 1 and 10485760),
  created_at timestamptz not null default now()
);

create index if not exists quotation_payments_quotation_idx
  on public.quotation_payments (quotation_id, paid_on);
create index if not exists quotation_payments_artist_idx
  on public.quotation_payments (artist_user_id, paid_on desc, created_at desc);

alter table public.quotation_payments enable row level security;

drop policy if exists quotation_payments_artist_select on public.quotation_payments;
create policy quotation_payments_artist_select on public.quotation_payments
  for select to authenticated
  using ((select auth.uid()) = artist_user_id);

drop policy if exists quotation_payments_client_select on public.quotation_payments;
create policy quotation_payments_client_select on public.quotation_payments
  for select to authenticated
  using (exists (
    select 1 from public.quotations_db q
    where q.id = quotation_payments.quotation_id
      and q.client_user_id = (select auth.uid())
  ));

drop policy if exists quotation_payments_support_select on public.quotation_payments;
create policy quotation_payments_support_select on public.quotation_payments
  for select to authenticated
  using (public.is_support_user());

-- Solo lectura por PostgREST: altas y bajas pasan por las RPC de abajo.
revoke all on table public.quotation_payments from anon;
revoke all on table public.quotation_payments from authenticated;
grant select on table public.quotation_payments to authenticated;

-- ======================= 2 · comprobantes =======================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'quotation-payment-receipts',
  'quotation-payment-receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Ruta: <artist_user_id>/<quotation_id>/<archivo>. El artista sube, ve y
-- borra lo suyo; soporte solo lee.
drop policy if exists quotation_payment_receipts_owner_select on storage.objects;
create policy quotation_payment_receipts_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'quotation-payment-receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists quotation_payment_receipts_owner_insert on storage.objects;
create policy quotation_payment_receipts_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'quotation-payment-receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists quotation_payment_receipts_owner_delete on storage.objects;
create policy quotation_payment_receipts_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'quotation-payment-receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists quotation_payment_receipts_support_select on storage.objects;
create policy quotation_payment_receipts_support_select on storage.objects
  for select to authenticated
  using (bucket_id = 'quotation-payment-receipts' and public.is_support_user());

-- ======================= 3 · RPC del artista =======================
create or replace function public.record_quotation_payment(
  p_quotation_id integer,
  p_kind text,
  p_method text,
  p_amount numeric,
  p_currency text,
  p_paid_on date default null,
  p_note text default null,
  p_receipt_path text default null,
  p_receipt_name text default null,
  p_receipt_mime text default null,
  p_receipt_size integer default null
)
returns public.quotation_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_q public.quotations_db;
  v_row public.quotation_payments;
  v_paid_on date := coalesce(p_paid_on, current_date);
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_path text := nullif(btrim(coalesce(p_receipt_path, '')), '');
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Iniciá sesión para registrar pagos.' using errcode = '42501';
  end if;

  select * into v_q from public.quotations_db where id = p_quotation_id;
  if not found or v_q.artist_id is distinct from v_uid then
    raise exception 'No encontramos esa cotización en tu cuenta.' using errcode = '42501';
  end if;

  -- Respondida (seña de la cotización manual) o con acuerdo. El in_progress sin
  -- respuesta ni acuerdo es el borrador del cotizador del cliente.
  if v_q.quote_status not in ('responded', 'client_approved', 'in_progress', 'en_progreso', 'artist_completed', 'completed')
     or (v_q.quote_status in ('in_progress', 'en_progreso')
         and v_q.artist_responded_at is null
         and nullif(btrim(coalesce(v_q.final_budget_amount, '')), '') is null
         and nullif(btrim(coalesce(v_q.final_sessions, '')), '') is null) then
    raise exception 'Solo podés registrar pagos de cotizaciones respondidas o con acuerdo.' using errcode = '22023';
  end if;

  if p_kind is null or p_kind not in ('deposit', 'session', 'balance', 'other') then
    raise exception 'Elegí el tipo de pago.' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('cash', 'transfer', 'other') then
    raise exception 'Elegí el medio de pago.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 or p_amount <> round(p_amount, 2) then
    raise exception 'Ingresá un monto mayor a cero, con hasta 2 decimales.' using errcode = '22023';
  end if;
  if v_currency not in (
    'USD', 'CAD', 'MXN', 'CRC', 'COP', 'VES', 'PEN', 'BRL', 'ARS', 'CLP', 'UYU',
    'EUR', 'GBP', 'CHF', 'DKK', 'NOK', 'SEK', 'PLN',
    'KRW', 'THB', 'IDR', 'JPY', 'AUD', 'NZD') then
    raise exception 'Elegí una moneda de la lista.' using errcode = '22023';
  end if;
  -- Un día de margen por husos horarios.
  if v_paid_on > current_date + 1 or v_paid_on < date '2015-01-01' then
    raise exception 'La fecha del pago no puede ser futura.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'La nota puede tener hasta 500 caracteres.' using errcode = '22023';
  end if;

  if v_path is not null then
    if split_part(v_path, '/', 1) <> v_uid::text or split_part(v_path, '/', 2) <> p_quotation_id::text then
      raise exception 'El comprobante no corresponde a esta cotización.' using errcode = '42501';
    end if;
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'quotation-payment-receipts' and o.name = v_path
    ) then
      raise exception 'No encontramos el comprobante. Subilo de nuevo.' using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('quotation_payments:' || p_quotation_id::text));
  select count(*) into v_count from public.quotation_payments where quotation_id = p_quotation_id;
  if v_count >= 100 then
    raise exception 'Esta cotización ya tiene demasiados pagos registrados.' using errcode = '22023';
  end if;

  insert into public.quotation_payments (
    quotation_id, quote_id, artist_user_id, kind, method, amount, currency, paid_on, note,
    client_name, receipt_path, receipt_name, receipt_mime, receipt_size
  ) values (
    v_q.id, v_q.quote_id, v_uid, p_kind, p_method, p_amount, v_currency, v_paid_on, v_note,
    left(nullif(btrim(coalesce(v_q.client_full_name, '')), ''), 160),
    v_path,
    case when v_path is null then null else left(nullif(btrim(coalesce(p_receipt_name, '')), ''), 180) end,
    case when v_path is null then null else p_receipt_mime end,
    case when v_path is null then null else p_receipt_size end
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.record_quotation_payment(integer, text, text, numeric, text, date, text, text, text, text, integer) from public, anon;
grant execute on function public.record_quotation_payment(integer, text, text, numeric, text, date, text, text, text, text, integer) to authenticated;

-- Anula (borra) un pago propio. Devuelve la ruta del comprobante para que el
-- navegador lo borre del bucket (Storage no se limpia desde SQL).
create or replace function public.void_quotation_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.quotation_payments;
begin
  if v_uid is null then
    raise exception 'Iniciá sesión para anular pagos.' using errcode = '42501';
  end if;
  delete from public.quotation_payments
   where id = p_payment_id and artist_user_id = v_uid
  returning * into v_row;
  if not found then
    raise exception 'No encontramos ese pago en tu cuenta.' using errcode = '42501';
  end if;
  return jsonb_build_object('id', v_row.id, 'quotation_id', v_row.quotation_id, 'receipt_path', v_row.receipt_path);
end;
$$;

revoke all on function public.void_quotation_payment(uuid) from public, anon;
grant execute on function public.void_quotation_payment(uuid) to authenticated;

-- ===================== 4 · alimentación del Wallet =====================
-- Movimiento informativo por pago registrado (kind 'payment', status
-- 'completed', off_platform): no suma al saldo disponible. Al anular el pago,
-- el movimiento queda 'cancelled' (rastro auditable).
create or replace function public.quotation_payments_wallet_feed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_label text;
begin
  begin
    if tg_op = 'INSERT' then
      v_label := case new.kind
        when 'deposit' then 'Seña recibida'
        when 'balance' then 'Saldo recibido'
        when 'session' then 'Pago de sesión recibido'
        else 'Pago recibido' end;
      insert into public.artist_wallet_movements (
        artist_user_id, kind, status, amount, currency, title, counterparty_name,
        booking_reference, quote_id, service_date, occurred_at, external_reference, metadata_json
      ) values (
        new.artist_user_id, 'payment', 'completed', new.amount, new.currency,
        left(v_label || coalesce(' — ' || new.client_name, ''), 160),
        left(new.client_name, 120), new.quote_id, new.quote_id, new.paid_on,
        case when new.paid_on >= current_date then now()
             else (new.paid_on + time '12:00') at time zone 'UTC' end,
        'quotation_payment:' || new.id::text,
        jsonb_build_object(
          'source', 'manual_payment', 'off_platform', true, 'informational', true,
          'payment_id', new.id, 'payment_kind', new.kind, 'method', new.method,
          'quotation_id', new.quotation_id)
      )
      on conflict (artist_user_id, external_reference) do nothing;
    elsif tg_op = 'DELETE' then
      update public.artist_wallet_movements
         set status = 'cancelled',
             metadata_json = metadata_json || jsonb_build_object('voided_at', now())
       where artist_user_id = old.artist_user_id
         and external_reference = 'quotation_payment:' || old.id::text;
    end if;
  exception when others then
    -- El Wallet es un reflejo: nunca bloquea el registro del pago.
    raise warning 'quotation_payments_wallet_feed: %', sqlerrm;
  end;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.quotation_payments_wallet_feed() from public, anon, authenticated;

drop trigger if exists trg_quotation_payments_wallet_feed on public.quotation_payments;
create trigger trg_quotation_payments_wallet_feed
  after insert or delete on public.quotation_payments
  for each row execute function public.quotation_payments_wallet_feed();

-- Cotización completada → movimiento informativo con el total acordado
-- («Acuerdo cerrado»), con lo registrado y el saldo en metadata. Solo montos
-- en formato numérico simple (1240 · 1240.50); si no, no se inventa nada.
create or replace function public.quotation_completed_wallet_feed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_raw text;
  v_amount numeric;
  v_currency text;
  v_paid numeric;
begin
  begin
    v_raw := btrim(coalesce(nullif(btrim(coalesce(new.final_budget_amount, '')), ''), new.artist_budget_amount, ''));
    v_currency := upper(btrim(coalesce(nullif(btrim(coalesce(new.final_budget_currency, '')), ''), new.artist_budget_currency, '')));
    if new.artist_id is not null and v_raw ~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' and v_currency ~ '^[A-Z]{3}$' then
      v_amount := round(v_raw::numeric, 2);
      if v_amount > 0 then
        select coalesce(sum(p.amount), 0) into v_paid
          from public.quotation_payments p
         where p.quotation_id = new.id and p.currency = v_currency;
        insert into public.artist_wallet_movements (
          artist_user_id, kind, status, amount, currency, title, counterparty_name,
          booking_reference, quote_id, occurred_at, external_reference, metadata_json
        ) values (
          new.artist_id, 'payment', 'completed', v_amount, v_currency,
          left('Trabajo completado — ' || coalesce(nullif(btrim(coalesce(new.client_full_name, '')), ''), 'Cliente'), 160),
          left(nullif(btrim(coalesce(new.client_full_name, '')), ''), 120),
          new.quote_id, new.quote_id, now(),
          'quotation:' || new.id::text || ':completed',
          jsonb_build_object(
            'source', 'quotation', 'off_platform', true, 'informational', true,
            'quotation_id', new.id, 'agreed_total', v_amount,
            'registered_paid', v_paid, 'balance', greatest(v_amount - v_paid, 0))
        )
        on conflict (artist_user_id, external_reference) do nothing;
      end if;
    end if;
  exception when others then
    raise warning 'quotation_completed_wallet_feed: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.quotation_completed_wallet_feed() from public, anon, authenticated;

drop trigger if exists trg_quotation_completed_wallet_feed on public.quotations_db;
create trigger trg_quotation_completed_wallet_feed
  after update of quote_status on public.quotations_db
  for each row
  when (new.quote_status = 'completed' and old.quote_status is distinct from 'completed')
  execute function public.quotation_completed_wallet_feed();

-- ====================== 5 · RPC de soporte ======================
-- Verificar / rechazar un destino de retiro. El trigger
-- guard_artist_payout_destination deja pasar el cambio porque
-- is_support_user() es verdadero con el JWT de soporte.
create or replace function public.support_review_payout_destination(
  p_destination_id uuid,
  p_decision text,
  p_note text default null
)
returns public.artist_payout_destinations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row public.artist_payout_destinations;
begin
  if not coalesce(public.is_support_user(), false) then
    raise exception 'Solo soporte puede verificar destinos de retiro.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('verified', 'rejected') then
    raise exception 'Decisión inválida.' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and (v_note is null or char_length(v_note) < 5) then
    raise exception 'Escribí el motivo del rechazo (mínimo 5 caracteres).' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'La nota puede tener hasta 500 caracteres.' using errcode = '22023';
  end if;

  update public.artist_payout_destinations
     set verification_status = p_decision,
         verified_at = case when p_decision = 'verified' then now() else null end,
         metadata_json = coalesce(metadata_json, '{}'::jsonb) || jsonb_build_object(
           'review', jsonb_build_object('decision', p_decision, 'note', v_note, 'reviewed_at', now()))
   where id = p_destination_id and active
  returning * into v_row;
  if not found then
    raise exception 'No encontramos ese destino (o fue dado de baja).' using errcode = '22023';
  end if;
  return v_row;
end;
$$;

revoke all on function public.support_review_payout_destination(uuid, text, text) from public, anon;
grant execute on function public.support_review_payout_destination(uuid, text, text) to authenticated;

-- Aprobar / rechazar un documento de verificación con nota (la nota la ve el
-- artista en Cuenta · Verificación).
create or replace function public.support_review_verification_document(
  p_document_id uuid,
  p_decision text,
  p_note text default null
)
returns public.artist_verification_documents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row public.artist_verification_documents;
begin
  if not coalesce(public.is_support_user(), false) then
    raise exception 'Solo soporte puede revisar documentos.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('verificado', 'rechazado') then
    raise exception 'Decisión inválida.' using errcode = '22023';
  end if;
  if p_decision = 'rechazado' and (v_note is null or char_length(v_note) < 5) then
    raise exception 'Escribí el motivo del rechazo (mínimo 5 caracteres).' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'La nota puede tener hasta 500 caracteres.' using errcode = '22023';
  end if;

  update public.artist_verification_documents
     set status = p_decision,
         reviewed_at = now(),
         reviewer_notes = v_note
   where id = p_document_id
  returning * into v_row;
  if not found then
    raise exception 'No encontramos ese documento.' using errcode = '22023';
  end if;
  return v_row;
end;
$$;

revoke all on function public.support_review_verification_document(uuid, text, text) from public, anon;
grant execute on function public.support_review_verification_document(uuid, text, text) to authenticated;

-- Estado general de verificación del artista desde la misma pestaña.
create or replace function public.support_set_artist_verification_state(
  p_artist_user_id uuid,
  p_state text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state text;
begin
  if not coalesce(public.is_support_user(), false) then
    raise exception 'Solo soporte puede cambiar la verificación.' using errcode = '42501';
  end if;
  if p_state is null or p_state not in ('Yes', 'Denied', 'Requested', 'No') then
    raise exception 'Estado de verificación inválido.' using errcode = '22023';
  end if;
  update public.artists_db
     set verification_state = p_state
   where user_id = p_artist_user_id
  returning verification_state into v_state;
  if not found then
    raise exception 'No encontramos ese artista.' using errcode = '22023';
  end if;
  return v_state;
end;
$$;

revoke all on function public.support_set_artist_verification_state(uuid, text) from public, anon;
grant execute on function public.support_set_artist_verification_state(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
