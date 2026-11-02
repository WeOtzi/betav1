-- =====================================================================
-- M4 · Finanzas del estudio y arreglo de storage (Plataforma de Estudios v2)
-- Contrato: docs/plans/2026-10-30-estudios-plataforma.md, sección M4.
--
-- 1) Tabla public.studio_finance_entries: libro de gastos e ingresos del
--    estudio, por moneda. Categorías cruzadas con el tipo (CHECK). Anular es
--    un UPDATE a 'voided' con motivo; no hay DELETE.
--    'artist_payout' es solo para pagos fijos studio_to_artist: el porcentaje
--    ya va neteado en studio_jobs_log.
-- 2) Guard private.guard_finance_entry_write() (bypass estándar): pertenencia
--    cruzada de sede, proveedor y membresía; comprobante dentro de
--    <studio_id>/finance/; supply_order_id lo escriben solo las RPC de M5.
-- 3) Vista public.studio_finance_monthly_by_category (security_invoker).
-- 4) Storage: las policies vivas de studio-documents, studio-photos y
--    studio-spot-attachments comparan storage.foldername(s.name) (el nombre
--    del ESTUDIO, no el del objeto), así que hoy solo soporte puede subir.
--    Se recrean con private.can_manage_studio_storage_path(objects.name).
--    Las lecturas studio_photos_authenticated_read y
--    studio_spot_atts_authenticated_read quedan como están.
--
-- Estado: NO APLICADA. Aplicarla es decisión del usuario.
-- Depende de (se aplican juntas y en orden): 20261030200000 (M1),
-- 20261030201000 (M2) y 20261030202000 (M3). La FK de supply_order_id hacia
-- public.supply_orders la agrega 20261030204000 (M5).
-- Rollback: supabase/rollbacks/20261030203000_studio_finance.down.sql
-- (restaura las 10 policies vivas de storage tal como estaban).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Libro de finanzas
-- ---------------------------------------------------------------------
create table if not exists public.studio_finance_entries (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  location_id uuid null references public.studio_locations(id) on delete set null,
  entry_type text not null,
  category text not null,
  description text not null,
  amount numeric(12,2) not null,
  currency text not null,
  occurred_on date not null default current_date,
  payment_method text null,
  counterparty text null,
  supplier_id uuid null references public.studio_suppliers(id) on delete set null,
  supply_order_id uuid null,
  membership_id uuid null references public.studio_artist_memberships(id) on delete set null,
  artist_user_id uuid null,
  receipt_storage_path text null,
  status text not null default 'recorded',
  voided_at timestamptz null,
  void_reason text null,
  created_by_user_id uuid default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint studio_finance_entries_entry_type_check check (entry_type in ('expense', 'income')),
  constraint studio_finance_entries_category_check check (
    (entry_type = 'expense' and category in (
      'rent', 'supplies', 'inventory_purchase', 'salaries', 'artist_payout', 'utilities',
      'marketing', 'equipment', 'maintenance', 'taxes', 'fees', 'software', 'other'))
    or (entry_type = 'income' and category in (
      'chair_rent', 'merch_manual', 'service_other', 'sponsorship', 'other_income'))
  ),
  constraint studio_finance_entries_description_len check (char_length(btrim(description)) between 1 and 300),
  constraint studio_finance_entries_amount_check check (amount > 0),
  constraint studio_finance_entries_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint studio_finance_entries_payment_method_check check (
    payment_method is null or payment_method in ('cash', 'card', 'transfer', 'other')),
  constraint studio_finance_entries_counterparty_len check (counterparty is null or char_length(counterparty) <= 160),
  constraint studio_finance_entries_receipt_path_len check (
    receipt_storage_path is null or char_length(receipt_storage_path) <= 500),
  constraint studio_finance_entries_status_check check (status in ('recorded', 'voided')),
  constraint studio_finance_entries_void_reason_len check (void_reason is null or char_length(void_reason) <= 500),
  constraint studio_finance_entries_voided_fields check (
    status <> 'voided' or (voided_at is not null and nullif(btrim(void_reason), '') is not null))
);

comment on table public.studio_finance_entries is
  'Gastos e ingresos del estudio por moneda. Anular = UPDATE a voided con void_reason; sin DELETE. artist_payout solo para pagos fijos studio_to_artist.';
comment on column public.studio_finance_entries.supply_order_id is
  'Pedido de reposición que originó el gasto (lo escribe receive_supply_order, M5). FK agregada en M5.';
comment on column public.studio_finance_entries.receipt_storage_path is
  'Objeto del bucket studio-documents bajo <studio_id>/finance/.';

create index if not exists studio_finance_entries_studio_occurred
  on public.studio_finance_entries (studio_id, occurred_on desc);
create index if not exists studio_finance_entries_membership
  on public.studio_finance_entries (membership_id) where membership_id is not null;
create index if not exists studio_finance_entries_supplier
  on public.studio_finance_entries (supplier_id) where supplier_id is not null;
create index if not exists studio_finance_entries_location
  on public.studio_finance_entries (location_id) where location_id is not null;
create unique index if not exists studio_finance_entries_supply_order_unique
  on public.studio_finance_entries (supply_order_id)
  where supply_order_id is not null and status = 'recorded';

create or replace function public.set_studio_finance_entries_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

revoke all on function public.set_studio_finance_entries_updated_at() from public, anon, authenticated;

drop trigger if exists trigger_studio_finance_entries_updated_at on public.studio_finance_entries;
create trigger trigger_studio_finance_entries_updated_at
  before update on public.studio_finance_entries
  for each row execute function public.set_studio_finance_entries_updated_at();

-- ---------------------------------------------------------------------
-- 2) Guard de escritura (INVOKER, bypass estándar)
-- ---------------------------------------------------------------------
create or replace function private.guard_finance_entry_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_member_artist uuid;
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(auth.role(), '') = 'service_role'
     or public.is_support_user() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.supply_order_id is not null then
      raise exception 'Los gastos de reposición se registran al recibir el pedido' using errcode = '42501';
    end if;
    if new.status <> 'recorded' or new.voided_at is not null or new.void_reason is not null then
      raise exception 'Registrá el movimiento antes de anularlo' using errcode = '23514';
    end if;
    new.created_by_user_id := auth.uid();
  else
    if old.status = 'voided' then
      raise exception 'Un movimiento anulado no se puede editar' using errcode = '23514';
    end if;
    if new.studio_id is distinct from old.studio_id then
      raise exception 'No podés mover un movimiento a otro estudio' using errcode = '42501';
    end if;
    if new.supply_order_id is distinct from old.supply_order_id then
      raise exception 'El pedido de reposición de un gasto no se puede cambiar' using errcode = '42501';
    end if;
    new.created_by_user_id := old.created_by_user_id;
    new.created_at := old.created_at;
    if new.status = 'voided' then
      -- Anular: solo cambia el estado y el motivo; la fecha la pone la base.
      if nullif(btrim(new.void_reason), '') is null then
        raise exception 'Indicá el motivo de la anulación' using errcode = '22023';
      end if;
      if (to_jsonb(new) - array['status', 'void_reason', 'voided_at', 'updated_at'])
         is distinct from (to_jsonb(old) - array['status', 'void_reason', 'voided_at', 'updated_at']) then
        raise exception 'Al anular solo se registra el motivo; editá el movimiento por separado' using errcode = '23514';
      end if;
      new.void_reason := btrim(new.void_reason);
      new.voided_at := timezone('utc', now());
      return new;
    end if;
    new.voided_at := null;
    new.void_reason := null;
  end if;

  if new.location_id is not null and not exists (
    select 1 from public.studio_locations l where l.id = new.location_id and l.studio_id = new.studio_id
  ) then
    raise exception 'La sede no pertenece a este estudio' using errcode = '22023';
  end if;
  if new.supplier_id is not null and not exists (
    select 1 from public.studio_suppliers sp where sp.id = new.supplier_id and sp.studio_id = new.studio_id
  ) then
    raise exception 'El proveedor no pertenece a este estudio' using errcode = '22023';
  end if;
  if new.membership_id is not null then
    select m.artist_user_id into v_member_artist
    from public.studio_artist_memberships m
    where m.id = new.membership_id and m.studio_id = new.studio_id;
    if not found then
      raise exception 'La membresía no pertenece a este estudio' using errcode = '22023';
    end if;
    if new.artist_user_id is null then
      new.artist_user_id := v_member_artist;
    elsif new.artist_user_id is distinct from v_member_artist then
      raise exception 'El artista no coincide con la membresía' using errcode = '22023';
    end if;
  elsif new.artist_user_id is not null and not exists (
    select 1 from public.studio_artist_memberships m
    where m.studio_id = new.studio_id and m.artist_user_id = new.artist_user_id
  ) then
    raise exception 'Ese artista no forma parte del estudio' using errcode = '22023';
  end if;
  if new.receipt_storage_path is not null
     and (new.receipt_storage_path not like new.studio_id::text || '/finance/%'
          or position('..' in new.receipt_storage_path) > 0) then
    raise exception 'El comprobante tiene que estar en la carpeta de finanzas del estudio' using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_finance_entry_write() from public, anon, authenticated;

drop trigger if exists studio_finance_entries_guard on public.studio_finance_entries;
create trigger studio_finance_entries_guard
  before insert or update on public.studio_finance_entries
  for each row execute function private.guard_finance_entry_write();

-- ---------------------------------------------------------------------
-- RLS: dueño y soporte pueden leer, crear y editar. DELETE revocado.
-- ---------------------------------------------------------------------
alter table public.studio_finance_entries enable row level security;

drop policy if exists studio_finance_entries_select on public.studio_finance_entries;
create policy studio_finance_entries_select on public.studio_finance_entries
  for select to authenticated
  using (
    exists (select 1 from public.studios s where s.id = studio_finance_entries.studio_id and s.user_id = (select auth.uid()))
    or (select public.is_support_user())
  );

drop policy if exists studio_finance_entries_insert on public.studio_finance_entries;
create policy studio_finance_entries_insert on public.studio_finance_entries
  for insert to authenticated
  with check (
    exists (select 1 from public.studios s where s.id = studio_finance_entries.studio_id and s.user_id = (select auth.uid()))
    or (select public.is_support_user())
  );

drop policy if exists studio_finance_entries_update on public.studio_finance_entries;
create policy studio_finance_entries_update on public.studio_finance_entries
  for update to authenticated
  using (
    exists (select 1 from public.studios s where s.id = studio_finance_entries.studio_id and s.user_id = (select auth.uid()))
    or (select public.is_support_user())
  )
  with check (
    exists (select 1 from public.studios s where s.id = studio_finance_entries.studio_id and s.user_id = (select auth.uid()))
    or (select public.is_support_user())
  );

revoke all on table public.studio_finance_entries from public, anon, authenticated;
grant select, insert, update on table public.studio_finance_entries to authenticated;
grant all on table public.studio_finance_entries to service_role;

-- ---------------------------------------------------------------------
-- 3) Resumen mensual por categoría (solo filas 'recorded')
-- ---------------------------------------------------------------------
create or replace view public.studio_finance_monthly_by_category
with (security_invoker = true) as
select
  f.studio_id,
  date_trunc('month', f.occurred_on::timestamp)::date as month,
  f.currency,
  f.entry_type,
  f.category,
  sum(f.amount) as total,
  count(*)::integer as entries
from public.studio_finance_entries f
where f.status = 'recorded'
group by f.studio_id, date_trunc('month', f.occurred_on::timestamp)::date, f.currency, f.entry_type, f.category;

revoke all on public.studio_finance_monthly_by_category from public, anon, authenticated;
grant select on public.studio_finance_monthly_by_category to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4) Storage de estudios
-- ---------------------------------------------------------------------
-- Primera carpeta del objeto = id de un estudio del caller, o soporte.
create or replace function private.can_manage_studio_storage_path(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      public.is_support_user()
      or exists (
        select 1
        from public.studios s
        where s.id::text = (storage.foldername(p_object_name))[1]
          and s.user_id = (select auth.uid())
      )
    );
$$;

revoke all on function private.can_manage_studio_storage_path(text) from public, anon;
grant execute on function private.can_manage_studio_storage_path(text) to authenticated, service_role;

-- studio-documents (privado): dueño o soporte leen, suben, reemplazan y borran.
drop policy if exists studio_documents_owner_write on storage.objects;
create policy studio_documents_owner_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'studio-documents' and private.can_manage_studio_storage_path(objects.name));

drop policy if exists studio_documents_owner_read on storage.objects;
create policy studio_documents_owner_read on storage.objects
  for select to authenticated
  using (bucket_id = 'studio-documents' and private.can_manage_studio_storage_path(objects.name));

drop policy if exists studio_documents_owner_update on storage.objects;
create policy studio_documents_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'studio-documents' and private.can_manage_studio_storage_path(objects.name))
  with check (bucket_id = 'studio-documents' and private.can_manage_studio_storage_path(objects.name));

drop policy if exists studio_documents_owner_delete on storage.objects;
create policy studio_documents_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'studio-documents' and private.can_manage_studio_storage_path(objects.name));

-- studio-photos (público): la lectura sigue en studio_photos_authenticated_read.
drop policy if exists studio_photos_owner_write on storage.objects;
create policy studio_photos_owner_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'studio-photos' and private.can_manage_studio_storage_path(objects.name));

drop policy if exists studio_photos_owner_update on storage.objects;
create policy studio_photos_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'studio-photos' and private.can_manage_studio_storage_path(objects.name))
  with check (bucket_id = 'studio-photos' and private.can_manage_studio_storage_path(objects.name));

drop policy if exists studio_photos_owner_delete on storage.objects;
create policy studio_photos_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'studio-photos' and private.can_manage_studio_storage_path(objects.name));

-- studio-spot-attachments (público): la lectura sigue en studio_spot_atts_authenticated_read.
drop policy if exists studio_spot_atts_owner_write on storage.objects;
create policy studio_spot_atts_owner_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'studio-spot-attachments' and private.can_manage_studio_storage_path(objects.name));

drop policy if exists studio_spot_atts_owner_update on storage.objects;
create policy studio_spot_atts_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'studio-spot-attachments' and private.can_manage_studio_storage_path(objects.name))
  with check (bucket_id = 'studio-spot-attachments' and private.can_manage_studio_storage_path(objects.name));

drop policy if exists studio_spot_atts_owner_delete on storage.objects;
create policy studio_spot_atts_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'studio-spot-attachments' and private.can_manage_studio_storage_path(objects.name));

notify pgrst, 'reload schema';
commit;
