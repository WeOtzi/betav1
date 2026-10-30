-- =====================================================================
-- M5 · Supplies: cuentas de proveedores de insumos y reposición del estudio
-- Plataforma de Estudios + Supplies (docs/plans/2026-10-30-estudios-plataforma.md, M5).
--
-- Estado: NO APLICADA. Se valida contra la base viva dentro de BEGIN … ROLLBACK
-- junto con M1→M4 y los tests de supabase/tests/supplies_marketplace.sql.
--
-- Dependencias (se aplican juntas y en orden M1 → M2 → M3 → M4 → M5):
--   20261030202000_studio_agenda_inventory.sql  (M3): trigger BEFORE INSERT
--     studio_inventory_movements_prepare (mismo studio_id, completa unit_cost)
--     y apply_inventory_movement con los kinds nuevos. Acá solo se insertan
--     movimientos 'restock'.
--   20261030203000_studio_finance.sql (M4): public.studio_finance_entries.
--     Esta migración le agrega la FK supply_order_id → supply_orders(id) y
--     receive_supply_order registra ahí el gasto 'inventory_purchase'.
--
-- Reversa: supabase/rollbacks/20261030204000_supplies_marketplace.down.sql
--   (restaura la definición viva previa de public.handle_new_user).
--
-- Modelo:
--   supply_vendors          cuenta Supplies (columnas aptas para lectura pública).
--   supply_vendor_private   datos fiscales: solo dueño y soporte.
--   supply_vendor_counters  numerador de pedidos (solo RPC).
--   supply_products         catálogo; moneda = la del vendor (trigger).
--   supply_discount_tiers   descuento por escala de subtotal.
--   supply_orders / _items / _events  pedidos del estudio; sin escritura directa.
--
-- Reglas de importes (submit_supply_order; supplies-repo.estimateOrder replica):
--   line_subtotal = round(unit_price·qty, 2); subtotal = Σ line_subtotal
--   pct = least(60, platform_discount_pct + mejor tier con min_subtotal ≤ subtotal)
--     → se guarda platform_discount_pct del vendor y tier_discount_pct = pct − platform
--       (el tier aplicado ya recortado por el tope de 60).
--   discount_amount = round(subtotal·pct/100, 2)
--   line_discount = round(line_subtotal·pct/100, 2); la diferencia de redondeo la
--     absorbe la línea de mayor subtotal.
--   total = subtotal − discount_amount (+ envío al confirmar).
--   El mínimo de compra se compara contra el subtotal (antes del descuento).
--
-- Stock del vendor: chequeo blando al enviar; al confirmar se bloquean los
-- productos (FOR UPDATE por id), se descuenta y se guarda en stock_decremented.
-- Cancelar desde 'confirmed' devuelve exactamente stock_decremented.
-- =====================================================================

begin;

do $$
begin
  if to_regclass('public.studio_finance_entries') is null then
    raise exception 'M5 necesita M4 (20261030203000_studio_finance.sql): falta public.studio_finance_entries';
  end if;
end $$;

-- =====================================================================
-- Helpers puros (CHECKs) y updated_at
-- =====================================================================
create or replace function private.supply_text_items_ok(p_items text[], p_max_items integer, p_max_len integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(p_items), 0) <= p_max_items
     and not exists (
       select 1 from unnest(p_items) as x(item)
       where x.item is null or char_length(btrim(x.item)) = 0 or char_length(x.item) > p_max_len
     );
$$;

create or replace function private.supply_iso2_list_ok(p_items text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(p_items), 0) <= 250
     and not exists (
       select 1 from unnest(p_items) as x(item)
       where x.item is null or x.item !~ '^[A-Z]{2}$'
     );
$$;

-- Galería del producto: array (≤12) de URLs http(s), como string o {url, ...}.
create or replace function private.supply_image_list_ok(p_images jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_images is null or jsonb_typeof(p_images) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_images) > 12 then
    return false;
  end if;
  return not exists (
    select 1
    from jsonb_array_elements(p_images) as e(value)
    where not case jsonb_typeof(e.value)
      when 'string' then (e.value #>> '{}') ~* '^https?://'
      when 'object' then coalesce(e.value->>'url', '') ~* '^https?://'
      else false
    end
  );
end;
$$;

revoke all on function private.supply_text_items_ok(text[], integer, integer) from public;
revoke all on function private.supply_iso2_list_ok(text[]) from public;
revoke all on function private.supply_image_list_ok(jsonb) from public;
grant execute on function private.supply_text_items_ok(text[], integer, integer) to anon, authenticated, service_role;
grant execute on function private.supply_iso2_list_ok(text[]) to anon, authenticated, service_role;
grant execute on function private.supply_image_list_ok(jsonb) to anon, authenticated, service_role;

create or replace function public.set_supply_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

-- =====================================================================
-- supply_vendors
-- =====================================================================
create table if not exists public.supply_vendors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,
  email text check (email is null or char_length(email) <= 254),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  slug text not null unique check (char_length(slug) <= 200 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text check (description is null or char_length(description) <= 2000),
  logo_image text check (logo_image is null or logo_image ~* '^https?://'),
  cover_image text check (cover_image is null or cover_image ~* '^https?://'),
  contact_email text check (contact_email is null or char_length(contact_email) <= 254),
  phone text check (phone is null or char_length(phone) <= 40),
  whatsapp text check (whatsapp is null or char_length(whatsapp) <= 40),
  website text check (website is null or website ~* '^https?://'),
  instagram text check (instagram is null or char_length(instagram) <= 120),
  country text check (country is null or char_length(country) <= 120),
  city text check (city is null or char_length(city) <= 120),
  ships_to_countries text[] not null default array[]::text[]
    check (private.supply_iso2_list_ok(ships_to_countries)),
  lead_time_days integer check (lead_time_days is null or lead_time_days between 0 and 365),
  currency text not null default 'ARS' check (currency ~ '^[A-Z]{3}$'),
  min_order_amount numeric(12,2) check (min_order_amount is null or min_order_amount >= 0),
  platform_discount_pct numeric(5,2) not null default 0 check (platform_discount_pct between 0 and 60),
  free_shipping_threshold numeric(12,2) check (free_shipping_threshold is null or free_shipping_threshold >= 0),
  benefits text[] not null default array[]::text[]
    check (private.supply_text_items_ok(benefits, 10, 160)),
  is_verified boolean not null default false,
  is_active boolean not null default true,
  profile_complete boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Email de login: único sin distinguir mayúsculas (reset-temp-password lo usa).
create unique index if not exists supply_vendors_email_lower_key
  on public.supply_vendors (lower(email)) where email is not null;
create index if not exists supply_vendors_public_idx
  on public.supply_vendors (is_active, is_verified);

drop trigger if exists trigger_supply_vendors_updated_at on public.supply_vendors;
create trigger trigger_supply_vendors_updated_at
  before update on public.supply_vendors
  for each row execute function public.set_supply_updated_at();

-- Guard: el dueño no cambia verificación, cuenta, email de login ni slug.
create or replace function private.guard_supply_vendor_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(auth.role(), '') = 'service_role'
     or public.is_support_user() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Las cuentas de Supplies se crean desde el registro.' using errcode = '42501';
  end if;

  if new.is_verified is distinct from old.is_verified then
    raise exception 'La verificación de la cuenta la gestiona el equipo de We Ötzi.' using errcode = '42501';
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'La activación de la cuenta la gestiona el equipo de We Ötzi.' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id or new.email is distinct from old.email then
    raise exception 'El email de acceso solo lo puede cambiar soporte.' using errcode = '42501';
  end if;
  if new.slug is distinct from old.slug then
    raise exception 'El enlace de tu cuenta no se puede cambiar.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trigger_guard_supply_vendor_write on public.supply_vendors;
create trigger trigger_guard_supply_vendor_write
  before insert or update on public.supply_vendors
  for each row execute function private.guard_supply_vendor_write();

-- Dueño del vendor (SD para no recursar en la RLS de supply_vendors).
create or replace function private.is_supply_vendor_owner(p_vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1 from public.supply_vendors v
       where v.id = p_vendor_id and v.user_id = (select auth.uid())
     );
$$;

revoke all on function private.is_supply_vendor_owner(uuid) from public, anon;
grant execute on function private.is_supply_vendor_owner(uuid) to authenticated, service_role;

-- =====================================================================
-- supply_vendor_private / supply_vendor_counters
-- =====================================================================
create table if not exists public.supply_vendor_private (
  vendor_id uuid primary key references public.supply_vendors (id) on delete cascade,
  legal_name text check (legal_name is null or char_length(legal_name) <= 200),
  tax_id text check (tax_id is null or char_length(tax_id) <= 60),
  fiscal_address text check (fiscal_address is null or char_length(fiscal_address) <= 500),
  billing_email text check (billing_email is null or char_length(billing_email) <= 254),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists trigger_supply_vendor_private_updated_at on public.supply_vendor_private;
create trigger trigger_supply_vendor_private_updated_at
  before update on public.supply_vendor_private
  for each row execute function public.set_supply_updated_at();

create table if not exists public.supply_vendor_counters (
  vendor_id uuid primary key references public.supply_vendors (id) on delete cascade,
  order_seq integer not null default 0 check (order_seq >= 0)
);

-- =====================================================================
-- supply_products / supply_discount_tiers
-- =====================================================================
create table if not exists public.supply_products (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.supply_vendors (id) on delete cascade,
  sku text check (sku is null or char_length(btrim(sku)) between 1 and 80),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  brand text check (brand is null or char_length(brand) <= 120),
  description text check (description is null or char_length(description) <= 2000),
  category text not null check (category in (
    'inks', 'needles_cartridges', 'gloves', 'paper_film', 'hygiene', 'aftercare',
    'machines', 'power_supplies', 'furniture', 'piercing', 'other'
  )),
  unit_label text not null default 'unidad' check (char_length(btrim(unit_label)) between 1 and 40),
  pack_size numeric(12,2) check (pack_size is null or pack_size > 0),
  price numeric(12,2) not null check (price >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  compare_at_price numeric(12,2) check (compare_at_price is null or compare_at_price >= 0),
  stock_quantity numeric(12,2) check (stock_quantity is null or stock_quantity >= 0),
  min_order_qty numeric(12,2) not null default 1 check (min_order_qty > 0),
  image_url text check (image_url is null or image_url ~* '^https?://'),
  images jsonb not null default '[]'::jsonb check (private.supply_image_list_ok(images)),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists supply_products_vendor_sku_key
  on public.supply_products (vendor_id, sku) where sku is not null;
create index if not exists supply_products_vendor_idx
  on public.supply_products (vendor_id, is_active);
create index if not exists supply_products_category_idx
  on public.supply_products (category) where is_active;

drop trigger if exists trigger_supply_products_updated_at on public.supply_products;
create trigger trigger_supply_products_updated_at
  before update on public.supply_products
  for each row execute function public.set_supply_updated_at();

create table if not exists public.supply_discount_tiers (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.supply_vendors (id) on delete cascade,
  min_subtotal numeric(12,2) not null check (min_subtotal >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  discount_pct numeric(5,2) not null check (discount_pct > 0 and discount_pct <= 60),
  label text check (label is null or char_length(label) <= 120),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint supply_discount_tiers_vendor_currency_min_key unique (vendor_id, currency, min_subtotal)
);

drop trigger if exists trigger_supply_discount_tiers_updated_at on public.supply_discount_tiers;
create trigger trigger_supply_discount_tiers_updated_at
  before update on public.supply_discount_tiers
  for each row execute function public.set_supply_updated_at();

-- Producto y tier: moneda = la del vendor (si viene vacía, se completa).
-- SD solo para leer la moneda aunque el vendor no sea visible al caller: así
-- una escritura ajena llega a la RLS (42501) en vez de fallar acá.
create or replace function private.enforce_supply_vendor_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_currency text;
begin
  select v.currency into v_currency from public.supply_vendors v where v.id = new.vendor_id;
  if v_currency is null then
    raise exception 'El proveedor no existe.' using errcode = '22023';
  end if;
  new.currency := coalesce(nullif(upper(btrim(new.currency)), ''), v_currency);
  if new.currency <> v_currency then
    raise exception 'La moneda tiene que ser la del proveedor (%).', v_currency using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trigger_supply_products_currency on public.supply_products;
create trigger trigger_supply_products_currency
  before insert or update of vendor_id, currency on public.supply_products
  for each row execute function private.enforce_supply_vendor_currency();

drop trigger if exists trigger_supply_discount_tiers_currency on public.supply_discount_tiers;
create trigger trigger_supply_discount_tiers_currency
  before insert or update of vendor_id, currency on public.supply_discount_tiers
  for each row execute function private.enforce_supply_vendor_currency();

-- =====================================================================
-- supply_orders / supply_order_items / supply_order_events
-- =====================================================================
create table if not exists public.supply_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null check (order_number ~ '^P-[0-9]{4}-[0-9]{5,}$'),
  studio_id uuid not null references public.studios (id) on delete restrict,
  vendor_id uuid not null references public.supply_vendors (id) on delete restrict,
  location_id uuid references public.studio_locations (id) on delete set null,
  status text not null default 'submitted' check (status in (
    'submitted', 'confirmed', 'rejected', 'shipped', 'delivered', 'received', 'cancelled'
  )),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  platform_discount_pct numeric(5,2) not null default 0 check (platform_discount_pct between 0 and 60),
  tier_discount_pct numeric(5,2) not null default 0 check (tier_discount_pct between 0 and 60),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  shipping_amount numeric(12,2) not null default 0 check (shipping_amount >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  notes text check (notes is null or char_length(notes) <= 1000),
  vendor_note text check (vendor_note is null or char_length(vendor_note) <= 1000),
  tracking_code text check (tracking_code is null or char_length(tracking_code) <= 120),
  estimated_delivery date,
  submitted_at timestamptz not null default timezone('utc', now()),
  confirmed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  rejected_at timestamptz,
  receive_result jsonb,
  created_by_user_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint supply_orders_vendor_number_key unique (vendor_id, order_number),
  constraint supply_orders_pct_cap check (platform_discount_pct + tier_discount_pct <= 60),
  constraint supply_orders_discount_le_subtotal check (discount_amount <= subtotal)
);

create index if not exists supply_orders_studio_idx
  on public.supply_orders (studio_id, submitted_at desc);
create index if not exists supply_orders_vendor_idx
  on public.supply_orders (vendor_id, status, submitted_at desc);

drop trigger if exists trigger_supply_orders_updated_at on public.supply_orders;
create trigger trigger_supply_orders_updated_at
  before update on public.supply_orders
  for each row execute function public.set_supply_updated_at();

create table if not exists public.supply_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.supply_orders (id) on delete cascade,
  product_id uuid references public.supply_products (id) on delete set null,
  inventory_item_id uuid references public.studio_inventory_items (id) on delete set null,
  -- Snapshot del producto al enviar.
  product_name text not null,
  sku text,
  unit_label text not null,
  pack_size numeric(12,2) check (pack_size is null or pack_size > 0),
  category text,
  quantity numeric(12,2) not null check (quantity > 0),
  received_quantity numeric(12,2) check (received_quantity is null or (received_quantity >= 0 and received_quantity <= quantity)),
  stock_decremented numeric(12,2) not null default 0 check (stock_decremented >= 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_subtotal numeric(12,2) not null check (line_subtotal >= 0),
  line_discount numeric(12,2) not null default 0 check (line_discount >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists supply_order_items_order_idx
  on public.supply_order_items (order_id, sort_order);
create index if not exists supply_order_items_product_idx
  on public.supply_order_items (product_id) where product_id is not null;

create table if not exists public.supply_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.supply_orders (id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_user_id uuid,
  actor_role text check (actor_role in ('studio', 'vendor', 'support')),
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists supply_order_events_order_idx
  on public.supply_order_events (order_id, created_at);

-- =====================================================================
-- Columnas nuevas en tablas existentes
-- =====================================================================
alter table public.studio_suppliers
  add column if not exists vendor_id uuid references public.supply_vendors (id) on delete set null;
create unique index if not exists studio_suppliers_studio_vendor_key
  on public.studio_suppliers (studio_id, vendor_id) where vendor_id is not null;

alter table public.studio_inventory_items
  add column if not exists supply_product_id uuid references public.supply_products (id) on delete set null;
create index if not exists idx_inv_items_supply_product
  on public.studio_inventory_items (studio_id, supply_product_id) where supply_product_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.studio_finance_entries'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.supply_orders'::regclass
  ) then
    alter table public.studio_finance_entries
      add constraint studio_finance_entries_supply_order_id_fkey
      foreign key (supply_order_id) references public.supply_orders (id) on delete set null;
  end if;
end $$;

-- =====================================================================
-- RLS y privilegios
-- =====================================================================
alter table public.supply_vendors enable row level security;
alter table public.supply_vendor_private enable row level security;
alter table public.supply_vendor_counters enable row level security;
alter table public.supply_products enable row level security;
alter table public.supply_discount_tiers enable row level security;
alter table public.supply_orders enable row level security;
alter table public.supply_order_items enable row level security;
alter table public.supply_order_events enable row level security;

revoke all on table public.supply_vendors, public.supply_vendor_private, public.supply_vendor_counters,
  public.supply_products, public.supply_discount_tiers, public.supply_orders,
  public.supply_order_items, public.supply_order_events
  from public, anon, authenticated;
grant all on table public.supply_vendors, public.supply_vendor_private, public.supply_vendor_counters,
  public.supply_products, public.supply_discount_tiers, public.supply_orders,
  public.supply_order_items, public.supply_order_events
  to service_role;

-- Sin lectura anónima: la fila incluye el email de login y el user_id.
grant select on table public.supply_vendors to authenticated;
grant update on table public.supply_vendors to authenticated;
grant select, insert, update on table public.supply_vendor_private to authenticated;
grant select, insert, update, delete on table public.supply_products to authenticated;
grant select, insert, update, delete on table public.supply_discount_tiers to authenticated;
grant select on table public.supply_orders, public.supply_order_items, public.supply_order_events to authenticated;
-- supply_vendor_counters: sin acceso de clientes (solo las RPC).

-- supply_vendors
drop policy if exists "supply_vendors_public_select" on public.supply_vendors;
create policy "supply_vendors_public_select" on public.supply_vendors
  for select to anon, authenticated
  using (is_active and is_verified);

drop policy if exists "supply_vendors_owner_select" on public.supply_vendors;
create policy "supply_vendors_owner_select" on public.supply_vendors
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "supply_vendors_support_select" on public.supply_vendors;
create policy "supply_vendors_support_select" on public.supply_vendors
  for select to authenticated
  using (public.is_support_user());

drop policy if exists "supply_vendors_owner_update" on public.supply_vendors;
create policy "supply_vendors_owner_update" on public.supply_vendors
  for update to authenticated
  using (user_id = (select auth.uid()) or public.is_support_user())
  with check (user_id = (select auth.uid()) or public.is_support_user());

-- supply_vendor_private
drop policy if exists "supply_vendor_private_select" on public.supply_vendor_private;
create policy "supply_vendor_private_select" on public.supply_vendor_private
  for select to authenticated
  using (private.is_supply_vendor_owner(vendor_id) or public.is_support_user());

drop policy if exists "supply_vendor_private_insert" on public.supply_vendor_private;
create policy "supply_vendor_private_insert" on public.supply_vendor_private
  for insert to authenticated
  with check (private.is_supply_vendor_owner(vendor_id) or public.is_support_user());

drop policy if exists "supply_vendor_private_update" on public.supply_vendor_private;
create policy "supply_vendor_private_update" on public.supply_vendor_private
  for update to authenticated
  using (private.is_supply_vendor_owner(vendor_id) or public.is_support_user())
  with check (private.is_supply_vendor_owner(vendor_id) or public.is_support_user());

-- supply_products
drop policy if exists "supply_products_select" on public.supply_products;
create policy "supply_products_select" on public.supply_products
  for select to authenticated
  using (
    (is_active and exists (
      select 1 from public.supply_vendors v
      where v.id = supply_products.vendor_id and v.is_active and v.is_verified
    ))
    or private.is_supply_vendor_owner(vendor_id)
    or public.is_support_user()
  );

drop policy if exists "supply_products_insert" on public.supply_products;
create policy "supply_products_insert" on public.supply_products
  for insert to authenticated
  with check (private.is_supply_vendor_owner(vendor_id) or public.is_support_user());

drop policy if exists "supply_products_update" on public.supply_products;
create policy "supply_products_update" on public.supply_products
  for update to authenticated
  using (private.is_supply_vendor_owner(vendor_id) or public.is_support_user())
  with check (private.is_supply_vendor_owner(vendor_id) or public.is_support_user());

drop policy if exists "supply_products_delete" on public.supply_products;
create policy "supply_products_delete" on public.supply_products
  for delete to authenticated
  using (private.is_supply_vendor_owner(vendor_id) or public.is_support_user());

-- supply_discount_tiers
drop policy if exists "supply_discount_tiers_select" on public.supply_discount_tiers;
create policy "supply_discount_tiers_select" on public.supply_discount_tiers
  for select to authenticated
  using (
    exists (
      select 1 from public.supply_vendors v
      where v.id = supply_discount_tiers.vendor_id and v.is_active and v.is_verified
    )
    or private.is_supply_vendor_owner(vendor_id)
    or public.is_support_user()
  );

drop policy if exists "supply_discount_tiers_insert" on public.supply_discount_tiers;
create policy "supply_discount_tiers_insert" on public.supply_discount_tiers
  for insert to authenticated
  with check (private.is_supply_vendor_owner(vendor_id) or public.is_support_user());

drop policy if exists "supply_discount_tiers_update" on public.supply_discount_tiers;
create policy "supply_discount_tiers_update" on public.supply_discount_tiers
  for update to authenticated
  using (private.is_supply_vendor_owner(vendor_id) or public.is_support_user())
  with check (private.is_supply_vendor_owner(vendor_id) or public.is_support_user());

drop policy if exists "supply_discount_tiers_delete" on public.supply_discount_tiers;
create policy "supply_discount_tiers_delete" on public.supply_discount_tiers
  for delete to authenticated
  using (private.is_supply_vendor_owner(vendor_id) or public.is_support_user());

-- supply_orders y satélites: solo lectura de las partes.
drop policy if exists "supply_orders_parties_select" on public.supply_orders;
create policy "supply_orders_parties_select" on public.supply_orders
  for select to authenticated
  using (
    exists (
      select 1 from public.studios s
      where s.id = supply_orders.studio_id and s.user_id = (select auth.uid())
    )
    or private.is_supply_vendor_owner(vendor_id)
    or public.is_support_user()
  );

drop policy if exists "supply_order_items_parties_select" on public.supply_order_items;
create policy "supply_order_items_parties_select" on public.supply_order_items
  for select to authenticated
  using (exists (select 1 from public.supply_orders o where o.id = supply_order_items.order_id));

drop policy if exists "supply_order_events_parties_select" on public.supply_order_events;
create policy "supply_order_events_parties_select" on public.supply_order_events
  for select to authenticated
  using (exists (select 1 from public.supply_orders o where o.id = supply_order_events.order_id));

-- =====================================================================
-- Registro de la cuenta Supplies
-- =====================================================================
create or replace function private.supply_jsonb_text_array(p_value jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return array[]::text[];
  end if;
  if jsonb_typeof(p_value) <> 'array' then
    raise exception 'Revisá las listas del perfil.' using errcode = '22023';
  end if;
  return array(
    select btrim(x.item)
    from jsonb_array_elements_text(p_value) with ordinality as x(item, ord)
    where nullif(btrim(x.item), '') is not null
    order by x.ord
  );
end;
$$;

revoke all on function private.supply_jsonb_text_array(jsonb) from public, anon, authenticated;

create or replace function private.complete_supply_vendor_registration(p_profile jsonb)
returns public.supply_vendors
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_vendor public.supply_vendors;
  v_email text;
  v_name text;
  v_slug text;
  v_private jsonb;
  v_currency text;
  v_benefits text[];
  v_ships text[];
  v_platform numeric;
begin
  if v_uid is null then
    raise exception 'Confirmá tu correo e iniciá sesión para completar el registro.' using errcode = '42501';
  end if;
  -- Serializa reintentos desde varias pestañas (misma clave que el registro de estudios).
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  select * into v_vendor from public.supply_vendors v where v.user_id = v_uid;
  if found then
    return v_vendor;
  end if;

  select u.email into v_email
  from auth.users u
  where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then
    raise exception 'Confirmá tu correo antes de crear la cuenta de Supplies.' using errcode = '42501';
  end if;

  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'Completá los datos del negocio.' using errcode = '22023';
  end if;

  v_name := nullif(btrim(p_profile->>'name'), '');
  if v_name is null or char_length(v_name) not between 2 and 160 then
    raise exception 'El nombre debe tener entre 2 y 160 caracteres.' using errcode = '22023';
  end if;

  if exists (select 1 from public.supply_vendors v where lower(v.email) = lower(v_email)) then
    raise exception 'Ya hay una cuenta de Supplies con este email. Escribinos a soporte.' using errcode = '23514';
  end if;

  if (nullif(btrim(p_profile->>'logo_image'), '') is not null and btrim(p_profile->>'logo_image') !~* '^https?://')
     or (nullif(btrim(p_profile->>'cover_image'), '') is not null and btrim(p_profile->>'cover_image') !~* '^https?://')
     or (nullif(btrim(p_profile->>'website'), '') is not null and btrim(p_profile->>'website') !~* '^https?://') then
    raise exception 'Usá enlaces que empiecen con http:// o https://.' using errcode = '22023';
  end if;

  v_currency := coalesce(nullif(upper(btrim(p_profile->>'currency')), ''), 'ARS');
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'La moneda tiene que ser un código ISO de 3 letras (por ejemplo ARS).' using errcode = '22023';
  end if;

  v_platform := coalesce(nullif(btrim(p_profile->>'platform_discount_pct'), '')::numeric, 0);
  if v_platform < 0 or v_platform > 60 then
    raise exception 'El descuento We Ötzi tiene que estar entre 0 y 60%%.' using errcode = '22023';
  end if;

  v_benefits := private.supply_jsonb_text_array(p_profile->'benefits');
  if not private.supply_text_items_ok(v_benefits, 10, 160) then
    raise exception 'Podés cargar hasta 10 beneficios de hasta 160 caracteres.' using errcode = '22023';
  end if;

  v_ships := array(
    select distinct upper(x.item)
    from unnest(private.supply_jsonb_text_array(p_profile->'ships_to_countries')) as x(item)
  );
  if not private.supply_iso2_list_ok(v_ships) then
    raise exception 'Los países de envío van con código ISO de 2 letras (por ejemplo AR).' using errcode = '22023';
  end if;

  v_slug := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from left(v_slug, 60));
  v_slug := coalesce(nullif(v_slug, ''), 'supplies') || '-' || left(replace(v_uid::text, '-', ''), 8);

  insert into public.supply_vendors (
    user_id, email, name, slug, description, logo_image, cover_image,
    contact_email, phone, whatsapp, website, instagram, country, city,
    ships_to_countries, lead_time_days, currency, min_order_amount,
    platform_discount_pct, free_shipping_threshold, benefits,
    is_verified, is_active, profile_complete
  ) values (
    v_uid, v_email, v_name, v_slug,
    nullif(btrim(p_profile->>'description'), ''),
    nullif(btrim(p_profile->>'logo_image'), ''),
    nullif(btrim(p_profile->>'cover_image'), ''),
    nullif(btrim(p_profile->>'contact_email'), ''),
    nullif(btrim(p_profile->>'phone'), ''),
    nullif(btrim(p_profile->>'whatsapp'), ''),
    nullif(btrim(p_profile->>'website'), ''),
    nullif(btrim(p_profile->>'instagram'), ''),
    nullif(btrim(p_profile->>'country'), ''),
    nullif(btrim(p_profile->>'city'), ''),
    v_ships,
    nullif(btrim(p_profile->>'lead_time_days'), '')::integer,
    v_currency,
    nullif(btrim(p_profile->>'min_order_amount'), '')::numeric,
    v_platform,
    nullif(btrim(p_profile->>'free_shipping_threshold'), '')::numeric,
    v_benefits,
    false, true, false
  )
  returning * into v_vendor;

  -- Datos fiscales: anidados en "private" o como claves de primer nivel.
  v_private := case when jsonb_typeof(p_profile->'private') = 'object' then p_profile->'private' else '{}'::jsonb end;
  insert into public.supply_vendor_private (vendor_id, legal_name, tax_id, fiscal_address, billing_email, notes)
  values (
    v_vendor.id,
    nullif(btrim(coalesce(v_private->>'legal_name', p_profile->>'legal_name')), ''),
    nullif(btrim(coalesce(v_private->>'tax_id', p_profile->>'tax_id')), ''),
    nullif(btrim(coalesce(v_private->>'fiscal_address', p_profile->>'fiscal_address')), ''),
    nullif(btrim(coalesce(v_private->>'billing_email', p_profile->>'billing_email')), ''),
    nullif(btrim(coalesce(v_private->>'notes', p_profile->>'notes')), '')
  )
  on conflict (vendor_id) do nothing;

  insert into public.supply_vendor_counters (vendor_id)
  values (v_vendor.id)
  on conflict (vendor_id) do nothing;

  return v_vendor;
end;
$$;

create or replace function public.complete_supply_vendor_registration(p_profile jsonb)
returns public.supply_vendors
language sql
set search_path = ''
as $$
  select private.complete_supply_vendor_registration(p_profile);
$$;

revoke all on function private.complete_supply_vendor_registration(jsonb) from public, anon;
grant execute on function private.complete_supply_vendor_registration(jsonb) to authenticated, service_role;
revoke all on function public.complete_supply_vendor_registration(jsonb) from public, anon;
grant execute on function public.complete_supply_vendor_registration(jsonb) to authenticated, service_role;

-- handle_new_user: el alta con user_type 'supplies' no crea fila en artists_db.
-- Patrón de 20260922012500: definición viva + replace + execute.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.handle_new_user()'::regprocedure) into v_definition;
  if position($q$NOT IN ('client', 'studio', 'supplies')$q$ in v_definition) > 0 then
    return; -- ya parcheada
  end if;
  if position($q$NOT IN ('client', 'studio')$q$ in v_definition) = 0 then
    raise exception 'handle_new_user cambió: no aparece NOT IN (''client'', ''studio''). Revisá la definición viva antes de aplicar M5.';
  end if;
  v_definition := replace(v_definition, $q$NOT IN ('client', 'studio')$q$, $q$NOT IN ('client', 'studio', 'supplies')$q$);
  execute v_definition;
end $$;

-- =====================================================================
-- Pedidos: helpers internos
-- =====================================================================
create or replace function private.supply_order_status_label(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'submitted' then 'enviado'
    when 'confirmed' then 'confirmado'
    when 'rejected' then 'rechazado'
    when 'shipped' then 'despachado'
    when 'delivered' then 'entregado'
    when 'received' then 'recibido'
    when 'cancelled' then 'cancelado'
    else coalesce(p_status, 'desconocido')
  end;
$$;

create or replace function private.supply_order_json(p_order_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select to_jsonb(o)
      || jsonb_build_object(
           'order_id', o.id,
           'items', coalesce((
             select jsonb_agg(to_jsonb(i) order by i.sort_order, i.id)
             from public.supply_order_items i
             where i.order_id = o.id
           ), '[]'::jsonb)
         )
  from public.supply_orders o
  where o.id = p_order_id;
$$;

-- Devuelve exactamente stock_decremented a los productos que existen y
-- controlan stock, y deja las líneas en 0. Lo llaman las RPC de cancelación.
create or replace function private.restore_supply_order_stock(p_order_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1
  from public.supply_products p
  where p.id in (
    select i.product_id from public.supply_order_items i
    where i.order_id = p_order_id and i.product_id is not null and i.stock_decremented > 0
  )
  order by p.id
  for update of p;

  update public.supply_products p
     set stock_quantity = p.stock_quantity + i.stock_decremented
    from public.supply_order_items i
   where i.order_id = p_order_id
     and i.product_id = p.id
     and i.stock_decremented > 0
     and p.stock_quantity is not null;

  update public.supply_order_items i
     set stock_decremented = 0
   where i.order_id = p_order_id
     and i.stock_decremented > 0;
end;
$$;

revoke all on function private.supply_order_status_label(text) from public, anon, authenticated;
revoke all on function private.supply_order_json(uuid) from public, anon, authenticated;
revoke all on function private.restore_supply_order_stock(uuid) from public, anon, authenticated;

-- =====================================================================
-- submit_supply_order
-- =====================================================================
create or replace function public.submit_supply_order(
  p_studio_id uuid,
  p_vendor_id uuid,
  p_location_id uuid,
  p_items jsonb,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_support boolean := public.is_support_user();
  v_studio public.studios%rowtype;
  v_vendor public.supply_vendors%rowtype;
  v_product public.supply_products%rowtype;
  v_order_id uuid;
  v_order_number text;
  v_seq integer;
  v_entry jsonb;
  v_ord bigint;
  v_product_id uuid;
  v_qty numeric;
  v_inventory_id uuid;
  v_seen uuid[] := array[]::uuid[];
  v_subtotal numeric(12,2);
  v_tier numeric(5,2);
  v_pct numeric(5,2);
  v_discount numeric(12,2);
  v_diff numeric(12,2);
  v_adj numeric(12,2);
  r record;
begin
  if v_uid is null then
    raise exception 'Iniciá sesión para continuar.' using errcode = '42501';
  end if;

  select * into v_studio from public.studios s where s.id = p_studio_id;
  if not found or (v_studio.user_id is distinct from v_uid and not v_is_support) then
    raise exception 'No tenés permiso para pedir en nombre de este estudio.' using errcode = '42501';
  end if;

  if p_location_id is not null and not exists (
    select 1 from public.studio_locations l
    where l.id = p_location_id and l.studio_id = p_studio_id and l.is_active
  ) then
    raise exception 'La sede de entrega no pertenece a este estudio.' using errcode = '22023';
  end if;

  if p_notes is not null and char_length(p_notes) > 1000 then
    raise exception 'Las notas pueden tener hasta 1000 caracteres.' using errcode = '22023';
  end if;

  select * into v_vendor from public.supply_vendors v where v.id = p_vendor_id for share;
  if not found then
    raise exception 'El proveedor no existe.' using errcode = '22023';
  end if;
  if not v_vendor.is_active or not v_vendor.is_verified then
    raise exception 'Este proveedor todavía no recibe pedidos.' using errcode = '23514';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Agregá al menos un producto al pedido.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un producto al pedido.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'Un pedido puede tener hasta 100 productos.' using errcode = '22023';
  end if;

  -- Número del pedido: FOR UPDATE del numerador del vendor.
  insert into public.supply_vendor_counters (vendor_id) values (v_vendor.id)
  on conflict (vendor_id) do nothing;
  select c.order_seq + 1 into v_seq
  from public.supply_vendor_counters c
  where c.vendor_id = v_vendor.id
  for update;
  update public.supply_vendor_counters c set order_seq = v_seq where c.vendor_id = v_vendor.id;
  v_order_number := 'P-' || to_char(timezone('utc', now()), 'YYYY') || '-'
    || lpad(v_seq::text, greatest(5, char_length(v_seq::text)), '0');

  insert into public.supply_orders (
    order_number, studio_id, vendor_id, location_id, status, currency,
    notes, submitted_at, created_by_user_id
  ) values (
    v_order_number, p_studio_id, v_vendor.id, p_location_id, 'submitted', v_vendor.currency,
    nullif(btrim(p_notes), ''), timezone('utc', now()), v_uid
  )
  returning id into v_order_id;

  for v_entry, v_ord in
    select x.value, x.ord from jsonb_array_elements(p_items) with ordinality as x(value, ord)
  loop
    if jsonb_typeof(v_entry) <> 'object' then
      raise exception 'Revisá los productos del pedido.' using errcode = '22023';
    end if;
    begin
      v_product_id := nullif(v_entry->>'product_id', '')::uuid;
      v_qty := round(nullif(v_entry->>'quantity', '')::numeric, 2);
      v_inventory_id := nullif(v_entry->>'inventory_item_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Revisá los productos y cantidades del pedido.' using errcode = '22023';
    end;

    if v_product_id is null then
      raise exception 'Hay una línea sin producto.' using errcode = '22023';
    end if;
    if v_product_id = any (v_seen) then
      raise exception 'Cada producto puede aparecer una sola vez en el pedido.' using errcode = '22023';
    end if;
    v_seen := v_seen || v_product_id;

    select * into v_product
    from public.supply_products p
    where p.id = v_product_id and p.vendor_id = v_vendor.id;
    if not found or not v_product.is_active then
      raise exception 'Hay un producto que no está disponible en este proveedor.' using errcode = '22023';
    end if;
    if v_product.currency <> v_vendor.currency then
      raise exception '% no está en la moneda del proveedor.', v_product.name using errcode = '22023';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'La cantidad de % tiene que ser mayor a 0.', v_product.name using errcode = '22023';
    end if;
    if v_qty < v_product.min_order_qty then
      raise exception 'El mínimo para % es % %.', v_product.name, v_product.min_order_qty, v_product.unit_label
        using errcode = '22023';
    end if;
    -- Chequeo blando: el stock real se reserva al confirmar.
    if v_product.stock_quantity is not null and v_qty > v_product.stock_quantity then
      raise exception 'Stock insuficiente para %.', v_product.name using errcode = '23514';
    end if;
    if v_inventory_id is not null and not exists (
      select 1 from public.studio_inventory_items ii
      where ii.id = v_inventory_id and ii.studio_id = p_studio_id
    ) then
      raise exception 'El ítem de inventario no pertenece a este estudio.' using errcode = '22023';
    end if;

    insert into public.supply_order_items (
      order_id, product_id, inventory_item_id, product_name, sku, unit_label, pack_size, category,
      quantity, unit_price, line_subtotal, line_discount, line_total, sort_order
    ) values (
      v_order_id, v_product.id, v_inventory_id, v_product.name, v_product.sku, v_product.unit_label,
      v_product.pack_size, v_product.category, v_qty, v_product.price,
      round(v_product.price * v_qty, 2), 0, round(v_product.price * v_qty, 2), v_ord::integer
    );
  end loop;

  select coalesce(sum(i.line_subtotal), 0) into v_subtotal
  from public.supply_order_items i where i.order_id = v_order_id;

  if v_vendor.min_order_amount is not null and v_subtotal < v_vendor.min_order_amount then
    raise exception 'El pedido mínimo de % es % %.', v_vendor.name, v_vendor.min_order_amount, v_vendor.currency
      using errcode = '23514';
  end if;

  select coalesce(max(t.discount_pct), 0) into v_tier
  from public.supply_discount_tiers t
  where t.vendor_id = v_vendor.id
    and t.currency = v_vendor.currency
    and t.min_subtotal <= v_subtotal;

  v_pct := least(60, v_vendor.platform_discount_pct + v_tier);
  v_discount := round(v_subtotal * v_pct / 100, 2);

  update public.supply_order_items i
     set line_discount = round(i.line_subtotal * v_pct / 100, 2)
   where i.order_id = v_order_id;

  -- Diferencia de redondeo: la absorbe la línea de mayor subtotal (si con
  -- muchas líneas de centavos no entra en ella, sigue por la siguiente).
  select v_discount - coalesce(sum(i.line_discount), 0) into v_diff
  from public.supply_order_items i where i.order_id = v_order_id;
  if v_diff <> 0 then
    for r in
      select i.id, i.line_subtotal, i.line_discount
      from public.supply_order_items i
      where i.order_id = v_order_id
      order by i.line_subtotal desc, i.sort_order, i.id
    loop
      exit when v_diff = 0;
      v_adj := greatest(-r.line_discount, least(r.line_subtotal - r.line_discount, v_diff));
      if v_adj <> 0 then
        update public.supply_order_items i set line_discount = i.line_discount + v_adj where i.id = r.id;
        v_diff := v_diff - v_adj;
      end if;
    end loop;
  end if;

  update public.supply_order_items i
     set line_total = i.line_subtotal - i.line_discount
   where i.order_id = v_order_id;

  update public.supply_orders o
     set subtotal = v_subtotal,
         platform_discount_pct = v_vendor.platform_discount_pct,
         tier_discount_pct = v_pct - v_vendor.platform_discount_pct,
         discount_amount = v_discount,
         shipping_amount = 0,
         total = v_subtotal - v_discount
   where o.id = v_order_id;

  insert into public.supply_order_events (order_id, from_status, to_status, actor_user_id, actor_role, note)
  values (
    v_order_id, null, 'submitted', v_uid,
    case when v_studio.user_id = v_uid then 'studio' else 'support' end,
    'Pedido enviado'
  );

  return private.supply_order_json(v_order_id);
end;
$$;

-- =====================================================================
-- cancel_supply_order (estudio)
-- =====================================================================
create or replace function public.cancel_supply_order(p_order_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_support boolean := public.is_support_user();
  v_order public.supply_orders%rowtype;
  v_owner uuid;
begin
  if v_uid is null then
    raise exception 'Iniciá sesión para continuar.' using errcode = '42501';
  end if;
  if p_note is not null and char_length(p_note) > 1000 then
    raise exception 'La nota puede tener hasta 1000 caracteres.' using errcode = '22023';
  end if;

  select * into v_order from public.supply_orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe.' using errcode = '22023';
  end if;
  select s.user_id into v_owner from public.studios s where s.id = v_order.studio_id;
  if v_owner is distinct from v_uid and not v_is_support then
    raise exception 'No tenés permiso para cancelar este pedido.' using errcode = '42501';
  end if;
  if v_order.status not in ('submitted', 'confirmed') then
    raise exception 'Este pedido ya no se puede cancelar (está %).', private.supply_order_status_label(v_order.status)
      using errcode = '23514';
  end if;

  if v_order.status = 'confirmed' then
    perform private.restore_supply_order_stock(v_order.id);
  end if;

  update public.supply_orders o
     set status = 'cancelled',
         cancelled_at = timezone('utc', now())
   where o.id = v_order.id;

  insert into public.supply_order_events (order_id, from_status, to_status, actor_user_id, actor_role, note)
  values (
    v_order.id, v_order.status, 'cancelled', v_uid,
    case when v_owner = v_uid then 'studio' else 'support' end,
    coalesce(nullif(btrim(p_note), ''), 'Pedido cancelado por el estudio')
  );

  return private.supply_order_json(v_order.id);
end;
$$;

-- =====================================================================
-- vendor_update_supply_order (vendor)
-- =====================================================================
create or replace function public.vendor_update_supply_order(
  p_order_id uuid,
  p_action text,
  p_shipping_amount numeric default null,
  p_tracking_code text default null,
  p_estimated_delivery date default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_support boolean := public.is_support_user();
  v_order public.supply_orders%rowtype;
  v_vendor public.supply_vendors%rowtype;
  v_from text;
  v_to text;
  v_note text := nullif(btrim(p_note), '');
  v_short text;
  v_shipping numeric(12,2);
begin
  if v_uid is null then
    raise exception 'Iniciá sesión para continuar.' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('confirm', 'reject', 'ship', 'deliver', 'cancel') then
    raise exception 'Acción inválida.' using errcode = '22023';
  end if;
  if p_note is not null and char_length(p_note) > 1000 then
    raise exception 'La nota puede tener hasta 1000 caracteres.' using errcode = '22023';
  end if;
  if p_tracking_code is not null and char_length(btrim(p_tracking_code)) > 120 then
    raise exception 'El código de seguimiento puede tener hasta 120 caracteres.' using errcode = '22023';
  end if;
  if p_shipping_amount is not null and p_shipping_amount < 0 then
    raise exception 'El envío no puede ser negativo.' using errcode = '22023';
  end if;

  select * into v_order from public.supply_orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe.' using errcode = '22023';
  end if;
  select * into v_vendor from public.supply_vendors v where v.id = v_order.vendor_id;
  if v_vendor.user_id is distinct from v_uid and not v_is_support then
    raise exception 'No tenés permiso para gestionar este pedido.' using errcode = '42501';
  end if;

  v_from := v_order.status;
  v_to := case p_action
    when 'confirm' then 'confirmed'
    when 'reject' then 'rejected'
    when 'ship' then 'shipped'
    when 'deliver' then 'delivered'
    when 'cancel' then 'cancelled'
  end;

  if (p_action in ('confirm', 'reject') and v_from <> 'submitted')
     or (p_action in ('ship', 'cancel') and v_from <> 'confirmed')
     or (p_action = 'deliver' and v_from <> 'shipped') then
    raise exception 'No se puede pasar el pedido de % a %.',
      private.supply_order_status_label(v_from), private.supply_order_status_label(v_to)
      using errcode = '23514';
  end if;

  if p_action = 'confirm' then
    perform 1
    from public.supply_products p
    where p.id in (
      select i.product_id from public.supply_order_items i
      where i.order_id = v_order.id and i.product_id is not null
    )
    order by p.id
    for update of p;

    select i.product_name into v_short
    from public.supply_order_items i
    join public.supply_products p on p.id = i.product_id
    where i.order_id = v_order.id
      and p.stock_quantity is not null
      and p.stock_quantity < i.quantity
    order by p.id
    limit 1;
    if v_short is not null then
      raise exception 'Stock insuficiente para %.', v_short using errcode = '23514';
    end if;

    update public.supply_order_items i
       set stock_decremented = i.quantity
      from public.supply_products p
     where i.order_id = v_order.id
       and p.id = i.product_id
       and p.stock_quantity is not null;

    update public.supply_products p
       set stock_quantity = p.stock_quantity - i.stock_decremented
      from public.supply_order_items i
     where i.order_id = v_order.id
       and i.product_id = p.id
       and i.stock_decremented > 0;

    if v_vendor.free_shipping_threshold is not null
       and (v_order.subtotal - v_order.discount_amount) >= v_vendor.free_shipping_threshold then
      v_shipping := 0;
    else
      v_shipping := round(coalesce(p_shipping_amount, 0), 2);
    end if;

    update public.supply_orders o
       set status = 'confirmed',
           confirmed_at = timezone('utc', now()),
           shipping_amount = v_shipping,
           total = o.subtotal - o.discount_amount + v_shipping,
           estimated_delivery = coalesce(p_estimated_delivery, o.estimated_delivery),
           vendor_note = coalesce(v_note, o.vendor_note)
     where o.id = v_order.id;

  elsif p_action = 'reject' then
    update public.supply_orders o
       set status = 'rejected',
           rejected_at = timezone('utc', now()),
           vendor_note = coalesce(v_note, o.vendor_note)
     where o.id = v_order.id;

  elsif p_action = 'ship' then
    update public.supply_orders o
       set status = 'shipped',
           shipped_at = timezone('utc', now()),
           tracking_code = coalesce(nullif(btrim(p_tracking_code), ''), o.tracking_code),
           estimated_delivery = coalesce(p_estimated_delivery, o.estimated_delivery),
           vendor_note = coalesce(v_note, o.vendor_note)
     where o.id = v_order.id;

  elsif p_action = 'deliver' then
    update public.supply_orders o
       set status = 'delivered',
           delivered_at = timezone('utc', now()),
           vendor_note = coalesce(v_note, o.vendor_note)
     where o.id = v_order.id;

  else -- cancel
    perform private.restore_supply_order_stock(v_order.id);
    update public.supply_orders o
       set status = 'cancelled',
           cancelled_at = timezone('utc', now()),
           vendor_note = coalesce(v_note, o.vendor_note)
     where o.id = v_order.id;
  end if;

  insert into public.supply_order_events (order_id, from_status, to_status, actor_user_id, actor_role, note)
  values (
    v_order.id, v_from, v_to, v_uid,
    case when v_vendor.user_id = v_uid then 'vendor' else 'support' end,
    v_note
  );

  return private.supply_order_json(v_order.id);
end;
$$;

-- =====================================================================
-- receive_supply_order (estudio): repone inventario y registra el gasto
-- =====================================================================
create or replace function public.receive_supply_order(p_order_id uuid, p_lines jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_support boolean := public.is_support_user();
  v_order public.supply_orders%rowtype;
  v_owner uuid;
  v_vendor public.supply_vendors%rowtype;
  v_supplier_id uuid;
  v_line jsonb;
  v_line_item_id uuid;
  v_line_qty numeric;
  v_line_ordered numeric;
  v_received jsonb := '{}'::jsonb;
  r record;
  v_qty_received numeric(12,2);
  v_inv public.studio_inventory_items%rowtype;
  v_inv_id uuid;
  v_created boolean;
  v_mismatch boolean;
  v_units numeric;
  v_unit_cost numeric;
  v_movement_id uuid;
  v_expense numeric(12,2) := 0;
  v_entry_id uuid;
  v_items jsonb := '[]'::jsonb;
  v_movements jsonb := '[]'::jsonb;
  v_shortages jsonb := '[]'::jsonb;
  v_mismatches jsonb := '[]'::jsonb;
  v_partial boolean;
  v_now timestamptz := timezone('utc', now());
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Iniciá sesión para continuar.' using errcode = '42501';
  end if;

  select * into v_order from public.supply_orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe.' using errcode = '22023';
  end if;
  select s.user_id into v_owner from public.studios s where s.id = v_order.studio_id;
  if v_owner is distinct from v_uid and not v_is_support then
    raise exception 'No tenés permiso para recibir este pedido.' using errcode = '42501';
  end if;

  -- Idempotente: una segunda llamada devuelve el mismo resultado.
  if v_order.status = 'received' then
    return coalesce(v_order.receive_result, jsonb_build_object('order_id', v_order.id));
  end if;
  if v_order.status not in ('shipped', 'delivered') then
    raise exception 'Solo podés recibir un pedido despachado o entregado (este está %).',
      private.supply_order_status_label(v_order.status)
      using errcode = '23514';
  end if;

  -- Cantidades recibidas: null = todo lo pedido; si viene la lista, lo que no
  -- figura cuenta como 0 recibido.
  if p_lines is not null then
    if jsonb_typeof(p_lines) <> 'array' then
      raise exception 'Las cantidades recibidas tienen que venir como lista.' using errcode = '22023';
    end if;
    for v_line in select x.value from jsonb_array_elements(p_lines) as x(value) loop
      if jsonb_typeof(v_line) <> 'object' then
        raise exception 'Revisá las cantidades recibidas.' using errcode = '22023';
      end if;
      begin
        v_line_item_id := nullif(v_line->>'item_id', '')::uuid;
        v_line_qty := round(nullif(v_line->>'received_quantity', '')::numeric, 2);
      exception when invalid_text_representation then
        raise exception 'Revisá las cantidades recibidas.' using errcode = '22023';
      end;
      if v_line_item_id is null or v_line_qty is null then
        raise exception 'Cada línea necesita item_id y received_quantity.' using errcode = '22023';
      end if;
      select i.quantity into v_line_ordered
      from public.supply_order_items i
      where i.id = v_line_item_id and i.order_id = v_order.id;
      if not found then
        raise exception 'Hay una línea que no pertenece a este pedido.' using errcode = '22023';
      end if;
      if v_received ? v_line_item_id::text then
        raise exception 'Hay líneas repetidas en la recepción.' using errcode = '22023';
      end if;
      if v_line_qty < 0 or v_line_qty > v_line_ordered then
        raise exception 'La cantidad recibida tiene que estar entre 0 y lo pedido.' using errcode = '22023';
      end if;
      v_received := v_received || jsonb_build_object(v_line_item_id::text, v_line_qty);
    end loop;
  end if;

  select * into v_vendor from public.supply_vendors v where v.id = v_order.vendor_id;

  -- Proveedor en la libreta del estudio, vinculado a la cuenta Supplies.
  insert into public.studio_suppliers (studio_id, name, contact_email, contact_phone, website, vendor_id)
  values (v_order.studio_id, v_vendor.name, v_vendor.contact_email, v_vendor.phone, v_vendor.website, v_vendor.id)
  on conflict (studio_id, vendor_id) where vendor_id is not null do nothing;
  select ss.id into v_supplier_id
  from public.studio_suppliers ss
  where ss.studio_id = v_order.studio_id and ss.vendor_id = v_order.vendor_id;

  for r in
    select i.*
    from public.supply_order_items i
    where i.order_id = v_order.id
    order by i.sort_order, i.id
  loop
    v_qty_received := case
      when p_lines is null then r.quantity
      else coalesce((v_received->>r.id::text)::numeric, 0)
    end;
    v_inv_id := null;
    v_created := false;
    v_mismatch := false;
    v_units := 0;
    v_unit_cost := null;
    v_movement_id := null;

    if v_qty_received < r.quantity then
      v_shortages := v_shortages || jsonb_build_array(jsonb_build_object(
        'order_item_id', r.id,
        'product_name', r.product_name,
        'quantity', r.quantity,
        'received_quantity', v_qty_received,
        'missing', r.quantity - v_qty_received
      ));
    end if;

    if v_qty_received > 0 then
      -- Costo efectivo por unidad (con descuento, sin envío).
      v_unit_cost := round(r.line_total / (r.quantity * coalesce(r.pack_size, 1)), 6);

      -- 1. Ítem destino: vínculo explícito → producto Supplies → SKU → nuevo.
      if r.inventory_item_id is not null then
        select ii.id into v_inv_id
        from public.studio_inventory_items ii
        where ii.id = r.inventory_item_id and ii.studio_id = v_order.studio_id;
      end if;
      if v_inv_id is null and r.product_id is not null then
        select ii.id into v_inv_id
        from public.studio_inventory_items ii
        where ii.studio_id = v_order.studio_id and ii.supply_product_id = r.product_id
        order by ii.is_active desc, ii.created_at, ii.id
        limit 1;
      end if;
      if v_inv_id is null and nullif(btrim(r.sku), '') is not null then
        select ii.id into v_inv_id
        from public.studio_inventory_items ii
        where ii.studio_id = v_order.studio_id and ii.sku = r.sku
        limit 1;
      end if;
      if v_inv_id is null then
        insert into public.studio_inventory_items (
          studio_id, supplier_id, name, sku, category, unit, quantity_on_hand,
          cost_per_unit, currency, supply_product_id
        ) values (
          v_order.studio_id, v_supplier_id, r.product_name,
          case
            when nullif(btrim(r.sku), '') is not null and not exists (
              select 1 from public.studio_inventory_items x
              where x.studio_id = v_order.studio_id and x.sku = r.sku
            ) then r.sku
          end,
          r.category,
          case when r.pack_size is not null then 'unidad' else r.unit_label end,
          0, v_unit_cost, v_order.currency, r.product_id
        )
        returning id into v_inv_id;
        v_created := true;
      end if;

      select * into v_inv from public.studio_inventory_items ii where ii.id = v_inv_id for update;
      v_mismatch := v_inv.currency is distinct from v_order.currency;
      v_units := v_qty_received * coalesce(r.pack_size, 1);

      if v_mismatch then
        v_mismatches := v_mismatches || jsonb_build_array(jsonb_build_object(
          'order_item_id', r.id,
          'inventory_item_id', v_inv_id,
          'inventory_item_name', v_inv.name,
          'item_currency', v_inv.currency,
          'order_currency', v_order.currency
        ));
      elsif not v_created and v_inv.supply_product_id is null and r.product_id is not null then
        -- El ítem vinculado queda asociado al producto para la próxima reposición.
        update public.studio_inventory_items ii set supply_product_id = r.product_id where ii.id = v_inv_id;
      end if;

      -- 2./3. Movimiento de reposición (unit_cost null si la moneda no coincide).
      insert into public.studio_inventory_movements (
        item_id, studio_id, kind, quantity, unit_cost, performed_at, notes, created_by_user_id
      ) values (
        v_inv_id, v_order.studio_id, 'restock', v_units,
        case when v_mismatch then null else v_unit_cost end,
        v_now,
        left('Pedido ' || v_order.order_number || ' · ' || v_vendor.name, 500),
        v_uid
      )
      returning id into v_movement_id;
      v_movements := v_movements || jsonb_build_array(v_movement_id);

      v_expense := v_expense + round(r.line_total * v_qty_received / r.quantity, 2);
    end if;

    update public.supply_order_items i
       set received_quantity = v_qty_received,
           inventory_item_id = coalesce(v_inv_id, i.inventory_item_id)
     where i.id = r.id;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'order_item_id', r.id,
      'product_id', r.product_id,
      'product_name', r.product_name,
      'quantity', r.quantity,
      'received_quantity', v_qty_received,
      'inventory_item_id', v_inv_id,
      'inventory_item_name', case when v_inv_id is not null then v_inv.name end,
      'created_item', v_created,
      'units_added', v_units,
      'unit_cost', case when v_mismatch then null else v_unit_cost end,
      'currency_mismatch', v_mismatch,
      'movement_id', v_movement_id
    ));
  end loop;

  -- Gasto: lo recibido de cada línea (a su total con descuento) + envío.
  v_expense := v_expense + coalesce(v_order.shipping_amount, 0);
  if v_expense > 0 and not exists (
    select 1 from public.studio_finance_entries fe
    where fe.supply_order_id = v_order.id and fe.status = 'recorded'
  ) then
    insert into public.studio_finance_entries (
      studio_id, location_id, entry_type, category, description, amount, currency,
      occurred_on, counterparty, supplier_id, supply_order_id, created_by_user_id
    ) values (
      v_order.studio_id, v_order.location_id, 'expense', 'inventory_purchase',
      left('Pedido ' || v_order.order_number || ' · ' || v_vendor.name, 300),
      v_expense, v_order.currency, current_date, left(v_vendor.name, 160),
      v_supplier_id, v_order.id, v_uid
    )
    returning id into v_entry_id;
  end if;

  v_partial := jsonb_array_length(v_shortages) > 0;
  v_result := jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'received_at', v_now,
    'received_by', v_uid,
    'partial', v_partial,
    'items', v_items,
    'movements', v_movements,
    'expense', case when v_entry_id is null then null
      else jsonb_build_object('entry_id', v_entry_id, 'amount', v_expense, 'currency', v_order.currency) end,
    'shortages', v_shortages,
    'currency_mismatches', v_mismatches
  );

  update public.supply_orders o
     set status = 'received',
         received_at = v_now,
         receive_result = v_result
   where o.id = v_order.id;

  insert into public.supply_order_events (order_id, from_status, to_status, actor_user_id, actor_role, note)
  values (
    v_order.id, v_order.status, 'received', v_uid,
    case when v_owner = v_uid then 'studio' else 'support' end,
    case when v_partial then 'Recepción parcial' else 'Pedido recibido' end
  );

  return v_result;
end;
$$;

revoke all on function public.submit_supply_order(uuid, uuid, uuid, jsonb, text) from public, anon;
revoke all on function public.cancel_supply_order(uuid, text) from public, anon;
revoke all on function public.vendor_update_supply_order(uuid, text, numeric, text, date, text) from public, anon;
revoke all on function public.receive_supply_order(uuid, jsonb) from public, anon;
grant execute on function public.submit_supply_order(uuid, uuid, uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.cancel_supply_order(uuid, text) to authenticated, service_role;
grant execute on function public.vendor_update_supply_order(uuid, text, numeric, text, date, text) to authenticated, service_role;
grant execute on function public.receive_supply_order(uuid, jsonb) to authenticated, service_role;

-- =====================================================================
-- Vistas de reportes del vendor (security_invoker: aplica la RLS de pedidos)
-- =====================================================================
create or replace view public.supply_vendor_sales_monthly
with (security_invoker = true) as
select
  o.vendor_id,
  date_trunc('month', coalesce(o.confirmed_at, o.submitted_at))::date as month,
  o.currency,
  count(*)::integer as orders,
  sum(o.subtotal) as gross,
  sum(o.discount_amount) as discounts,
  sum(o.shipping_amount) as shipping,
  sum(o.total) as net,
  coalesce(sum(u.units), 0) as units
from public.supply_orders o
left join lateral (
  select sum(i.quantity) as units
  from public.supply_order_items i
  where i.order_id = o.id
) u on true
where o.status in ('confirmed', 'shipped', 'delivered', 'received')
group by o.vendor_id, date_trunc('month', coalesce(o.confirmed_at, o.submitted_at))::date, o.currency;

create or replace view public.supply_vendor_customers
with (security_invoker = true) as
select
  o.vendor_id,
  o.studio_id,
  s.name as studio_name,
  count(*)::integer as orders,
  max(o.submitted_at) as last_order_at,
  o.currency,
  sum(o.total) as total
from public.supply_orders o
left join public.studios s on s.id = o.studio_id
where o.status in ('confirmed', 'shipped', 'delivered', 'received')
group by o.vendor_id, o.studio_id, s.name, o.currency;

revoke all on table public.supply_vendor_sales_monthly, public.supply_vendor_customers from public, anon, authenticated;
grant select on table public.supply_vendor_sales_monthly, public.supply_vendor_customers to authenticated, service_role;

-- =====================================================================
-- Storage: bucket público supply-photos (carpeta raíz = supply_vendors.id)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('supply-photos', 'supply-photos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.can_manage_supply_storage_path(p_object_name text)
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
         select 1 from public.supply_vendors v
         where v.user_id = (select auth.uid())
           and v.id::text = (storage.foldername(p_object_name))[1]
       )
     );
$$;

revoke all on function private.can_manage_supply_storage_path(text) from public, anon;
grant execute on function private.can_manage_supply_storage_path(text) to authenticated, service_role;

-- Sin SELECT amplio (las URLs públicas no lo necesitan). La lectura acotada
-- a la carpeta propia es la que Storage exige para borrar o reemplazar.
drop policy if exists "supply_photos_owner_select" on storage.objects;
create policy "supply_photos_owner_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'supply-photos' and private.can_manage_supply_storage_path(objects.name));

drop policy if exists "supply_photos_owner_insert" on storage.objects;
create policy "supply_photos_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'supply-photos' and private.can_manage_supply_storage_path(objects.name));

drop policy if exists "supply_photos_owner_update" on storage.objects;
create policy "supply_photos_owner_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'supply-photos' and private.can_manage_supply_storage_path(objects.name))
  with check (bucket_id = 'supply-photos' and private.can_manage_supply_storage_path(objects.name));

drop policy if exists "supply_photos_owner_delete" on storage.objects;
create policy "supply_photos_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'supply-photos' and private.can_manage_supply_storage_path(objects.name));

notify pgrst, 'reload schema';
commit;
