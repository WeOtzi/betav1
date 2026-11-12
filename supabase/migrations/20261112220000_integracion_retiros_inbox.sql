-- Integración entre grupos · ronda 3 (12 nov 2026) · grupo "integracion"
--
--   1. Soporte liquida retiros del Wallet: support_settle_artist_withdrawal
--      marca un retiro 'processing' como 'completed' (pagado, con referencia
--      de la transferencia) o 'failed' (fallido, con nota para el artista).
--   2. list_artist_inbox_threads deja de listar los hilos en los que el usuario
--      participa como 'studio' (dueño de estudio que además es artista: esos
--      hilos son del inbox del estudio, 20261112210000).
--
-- NO APLICADA. Validada con begin … rollback en flbgmlvfiejfttlawnfu.
-- Aditiva e idempotente (create or replace). Reversa:
--   supabase/rollbacks/20261112220000_integracion_retiros_inbox.down.sql
--
-- Consistencia con request_artist_wallet_withdrawal (20261028150000):
--   - El retiro nace 'processing' y ya descuenta del saldo disponible
--     (artist_wallet_available_balance resta withdrawal processing/completed).
--   - 'completed' lo sigue descontando; 'failed' deja de descontarlo, así que el
--     monto vuelve solo al disponible, sin movimiento compensatorio.
--   - Mismo advisory lock por artista que la RPC de retiro, para que un retiro
--     nuevo no lea el saldo a mitad de una liquidación.
--   - Solo se liquida una vez: un retiro que ya no está 'processing' se rechaza.
--   - La referencia y la nota quedan en metadata_json.settlement (el artista
--     lee su movimiento por RLS; external_reference no se usa para no chocar con
--     el unique (artist_user_id, external_reference) del proveedor de pagos).

begin;

-- ==================== 1 · liquidar retiros (soporte) ====================
create or replace function public.support_settle_artist_withdrawal(
  p_movement_id uuid,
  p_outcome text,
  p_reference text default null,
  p_note text default null
)
returns public.artist_wallet_movements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reference text := nullif(btrim(coalesce(p_reference, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row public.artist_wallet_movements;
begin
  if not coalesce(public.is_support_user(), false) then
    raise exception 'Solo soporte puede liquidar retiros.' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('completed', 'failed') then
    raise exception 'Resultado inválido.' using errcode = '22023';
  end if;
  if p_outcome = 'completed' and (v_reference is null or char_length(v_reference) < 3) then
    raise exception 'Escribí la referencia de la transferencia (mínimo 3 caracteres).' using errcode = '22023';
  end if;
  if p_outcome = 'failed' and (v_note is null or char_length(v_note) < 5) then
    raise exception 'Escribí el motivo del fallo (mínimo 5 caracteres). Lo ve el artista.' using errcode = '22023';
  end if;
  if v_reference is not null and char_length(v_reference) > 120 then
    raise exception 'La referencia puede tener hasta 120 caracteres.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'La nota puede tener hasta 500 caracteres.' using errcode = '22023';
  end if;

  select * into v_row
    from public.artist_wallet_movements
   where id = p_movement_id and kind = 'withdrawal';
  if not found then
    raise exception 'No encontramos ese retiro.' using errcode = '22023';
  end if;

  -- Mismo lock que request_artist_wallet_withdrawal y relectura bloqueada.
  perform pg_advisory_xact_lock(hashtext('artist_wallet_withdrawal:' || v_row.artist_user_id::text));
  select * into v_row
    from public.artist_wallet_movements
   where id = p_movement_id and kind = 'withdrawal'
   for update;
  if v_row.status <> 'processing' then
    raise exception 'Ese retiro ya fue resuelto (estado: %).', v_row.status using errcode = '22023';
  end if;

  update public.artist_wallet_movements
     set status = p_outcome,
         metadata_json = coalesce(metadata_json, '{}'::jsonb) || jsonb_build_object(
           'settlement', jsonb_build_object(
             'outcome', p_outcome,
             'reference', v_reference,
             'note', v_note,
             'settled_at', now(),
             'settled_by', auth.uid()))
   where id = p_movement_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.support_settle_artist_withdrawal(uuid, text, text, text) from public, anon;
grant execute on function public.support_settle_artist_withdrawal(uuid, text, text, text) to authenticated;

-- ============ 2 · inbox del artista sin los hilos del estudio ============
-- Misma firma y salida que 20260829153500; solo agrega el filtro de rol.
create or replace function public.list_artist_inbox_threads()
returns table (
  id uuid,
  category text,
  context_type text,
  context_id uuid,
  counterparty_name text,
  counterparty_initials text,
  subject text,
  context jsonb,
  status text,
  is_priority boolean,
  last_message text,
  last_message_at timestamptz,
  last_sender_user_id uuid,
  is_favorite boolean,
  is_archived boolean,
  unread_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    t.id, t.category, t.context_type, t.context_id,
    t.counterparty_name, t.counterparty_initials, t.subject, t.context,
    t.status, t.is_priority, t.last_message, t.last_message_at,
    t.last_sender_user_id, p.is_favorite, p.is_archived,
    (
      select count(*)
      from public.inbox_messages m
      where m.thread_id = t.id
        and m.created_at > coalesce(p.last_read_at, p.joined_at)
        and m.sender_user_id is distinct from auth.uid()
    )::bigint as unread_count
  from public.inbox_threads t
  join public.inbox_thread_participants p
    on p.thread_id = t.id and p.user_id = auth.uid()
  where auth.uid() is not null
    and p.participant_role <> 'studio'
  order by coalesce(t.last_message_at, t.created_at) desc, t.id;
$$;

revoke all on function public.list_artist_inbox_threads() from public, anon;
grant execute on function public.list_artist_inbox_threads() to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
