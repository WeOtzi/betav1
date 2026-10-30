-- Store del artista · merch y diseños con licencia de uso (/artist/store,
-- /store/*). Contrato: docs/plans/2026-10-30-store-artista.md (§2, §4, §5, §6).
--
-- NO APLICADA. Aditiva e idempotente. Requiere antes, en la base viva,
-- public.is_support_user() y public.set_updated_at() (existen en el proyecto
-- vivo, no en el repo). El wallet (20261028150000_artist_wallet.sql) es
-- opcional: todo acceso a artist_wallet_movements es dinámico y condicionado.
--
-- Reversa:
--   supabase/rollbacks/20261030150000_store_core.down.sql
--
-- Modelo:
--   store_products          producto del vendedor: merch (variantes con stock)
--                           o diseño (3 niveles de licencia con precio).
--   store_product_variants  talles/colores del merch, con stock opcional.
--   store_design_assets     archivos privados del diseño (original y stencil)
--                           en el bucket store-design-files.
--   store_seller_settings   ajustes del vendedor: contacto, instrucciones de
--                           pago, políticas, retiro (privado) y autoría.
--   store_orders            pedido (v1: un ítem). Lo crea create_store_order.
--   store_order_items       ítem con snapshots de título, precio y términos.
--   store_payments          confirmaciones, duplicados y reembolsos.
--   store_licenses          licencia emitida por ítem de diseño (WOL-XXXX-XXXX).
--   store_download_events   descargas firmadas por el servidor (service role).
--   store_order_support_notes  notas internas de soporte por pedido (retención,
--                           reembolso, reapertura, marca resuelta, error del
--                           mantenimiento). Solo las lee soporte: metadata_json
--                           del pedido lo ven comprador y vendedor.
--   Buckets store-previews (público, previews con marca de agua) y
--   store-design-files (privado; el comprador baja con URL firmada).
--
-- Seguridad:
--   - Escritura directa (PostgREST) solo en catálogo y ajustes, con RLS por
--     store_can_manage_seller y guard triggers security invoker. Los guards
--     se saltean solo para postgres/supabase_admin/service_role: las RPC
--     security definer (owner postgres) no los atraviesan.
--   - Pedidos, ítems, pagos, licencias y descargas: authenticated solo lee;
--     todo cambio pasa por RPC con locks producto → pedido y re-chequeo.
--   - store_payments expone a authenticated solo columnas no sensibles.
--   - Las funciones de servicio validan auth.role() = 'service_role' (o una
--     sesión directa postgres/supabase_admin) además del grant.
--   - artists_db acepta autoinsert y no tiene username único: el nivel
--     'artist' y la condición de vendedor no son una frontera fuerte hasta
--     endurecerla (pendiente §9).
--
-- Cobro (§2) · expected_collector se fija al crear el pedido:
--   seller    (default) el comprador le paga directo al vendedor según sus
--             instrucciones. Confirman vendedor o soporte. NO toca el wallet
--             (la plataforma nunca tuvo los fondos) y la comisión es 0.
--   platform  solo si app_settings.store_manual_collector = 'platform' y
--             store_platform_payment_instructions no está vacío. Solo soporte
--             confirma. Acredita el wallet: payment retenido → release + fee.
--   provider  app_settings.store_payment_provider <> 'manual'. Confirma el
--             webhook (service role). Acredita el wallet igual que platform.
--   Los vendedores studio siempre usan seller (no hay ledger de estudios).
--   Predicado único: store_order_uses_wallet(o) = seller_type 'artist' y
--   payment_collected_by in ('platform','provider'). Con la configuración por
--   defecto las ventas NO acreditan el wallet.
--   Las claves store_* de app_settings se siembran privadas (is_public=false)
--   con valores neutros. store_payment_provider se cambia solo cuando el
--   adaptador está registrado en el servidor.
--
-- Pago informado (report_store_payment): el pedido sigue pendiente 7 días
-- más. Al vencer, el mantenimiento lo marca needs_support; el vendedor que
-- cobra directo ya puede cancelarlo («no recibí el pago»). Si nadie lo
-- resuelve en otros 7 días, se vence: restituye stock y libera la reserva
-- (store_order_lapsed). Soporte puede reabrir un vencido.
--
-- Aplicar en una ventana de poco tráfico: crea policies sobre storage.objects
-- y FKs a auth.users y currencies. Con lock_timeout corto, si hay espera por
-- locks falla (y se reintenta) en lugar de bloquear a producción.

begin;

set local lock_timeout = '5s';

-- ===================== productos =====================
create table if not exists public.store_products (
  id uuid primary key default gen_random_uuid(),
  seller_type text not null,
  seller_id uuid not null,
  kind text not null,
  status text not null default 'draft',
  title text not null,
  description text,
  category text,
  tags text[] not null default '{}'::text[],
  currency text not null default 'USD',
  -- Base del merch. Los diseños usan los precios por nivel (null = no ofrecido).
  price_amount numeric(12,2),
  license_personal_price numeric(12,2),
  license_artist_price numeric(12,2),
  license_exclusive_price numeric(12,2),
  design_width_cm numeric(5,1),
  design_height_cm numeric(5,1),
  design_style text,
  placement_suggestion text,
  -- [{ "path": "<seller_id>/<product_id>/<ts>-<n>.webp", "alt": "…" }] · sin url
  images jsonb not null default '[]'::jsonb,
  shipping_price_amount numeric(12,2),
  ships_to_countries text[] not null default '{}'::text[],
  ships_to_note text,
  pickup_available boolean not null default false,
  -- Pública: zona y horario. La dirección vive en store_seller_settings.
  pickup_note text,
  -- Campos del servidor (el guard los conserva en escrituras directas).
  sales_count integer not null default 0,
  licenses_issued integer not null default 0,
  reserved_order_id uuid,
  reserved_until timestamptz,
  exclusive_sold_at timestamptz,
  published_at timestamptz,
  retired_at timestamptz,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_products_seller_type_check check (seller_type in ('artist', 'studio')),
  constraint store_products_kind_check check (kind in ('merch', 'design')),
  constraint store_products_status_check check (status in ('draft', 'active', 'paused', 'retired')),
  constraint store_products_title_check check (char_length(btrim(title)) between 2 and 120),
  constraint store_products_description_check check (description is null or char_length(description) <= 4000),
  constraint store_products_category_check check (category is null or char_length(category) <= 40),
  constraint store_products_tags_check check (cardinality(tags) <= 12),
  constraint store_products_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint store_products_price_amount_check
    check (price_amount is null or (price_amount > 0 and price_amount = round(price_amount, 2))),
  constraint store_products_license_personal_price_check
    check (license_personal_price is null or (license_personal_price > 0 and license_personal_price = round(license_personal_price, 2))),
  constraint store_products_license_artist_price_check
    check (license_artist_price is null or (license_artist_price > 0 and license_artist_price = round(license_artist_price, 2))),
  constraint store_products_license_exclusive_price_check
    check (license_exclusive_price is null or (license_exclusive_price > 0 and license_exclusive_price = round(license_exclusive_price, 2))),
  constraint store_products_shipping_price_check
    check (shipping_price_amount is null or (shipping_price_amount >= 0 and shipping_price_amount = round(shipping_price_amount, 2))),
  constraint store_products_design_width_check check (design_width_cm is null or design_width_cm between 1 and 200),
  constraint store_products_design_height_check check (design_height_cm is null or design_height_cm between 1 and 200),
  constraint store_products_design_style_check check (design_style is null or char_length(design_style) <= 60),
  constraint store_products_placement_check check (placement_suggestion is null or char_length(placement_suggestion) <= 120),
  constraint store_products_images_check check (jsonb_typeof(images) = 'array' and jsonb_array_length(images) <= 8),
  constraint store_products_ships_to_countries_check
    check (cardinality(ships_to_countries) <= 250
      and array_to_string(ships_to_countries, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'),
  constraint store_products_ships_to_note_check check (ships_to_note is null or char_length(ships_to_note) <= 200),
  constraint store_products_pickup_note_check check (pickup_note is null or char_length(pickup_note) <= 300),
  constraint store_products_counters_check check (sales_count >= 0 and licenses_issued >= 0),
  constraint store_products_reservation_pair_check check ((reserved_order_id is null) = (reserved_until is null)),
  constraint store_products_metadata_check check (jsonb_typeof(metadata_json) = 'object'),
  -- Un diseño no tiene precio base, envío ni retiro.
  constraint store_products_design_shape_check check (
    kind <> 'design' or (
      price_amount is null and shipping_price_amount is null
      and not pickup_available and cardinality(ships_to_countries) = 0
    )
  ),
  -- Un merch no tiene precios de licencia ni exclusividad.
  constraint store_products_merch_shape_check check (
    kind <> 'merch' or (
      license_personal_price is null and license_artist_price is null and license_exclusive_price is null
      and reserved_order_id is null and exclusive_sold_at is null
    )
  )
);

create index if not exists store_products_seller_idx
  on public.store_products (seller_type, seller_id, status, created_at desc);
create index if not exists store_products_active_idx
  on public.store_products (seller_type, seller_id, published_at desc)
  where status = 'active';
create index if not exists store_products_reserved_idx
  on public.store_products (reserved_order_id)
  where reserved_order_id is not null;

-- Moneda: FK a currencies(code) solo si code es único en la base viva.
do $currency$
begin
  if to_regclass('public.currencies') is not null
     and exists (
       select 1
         from pg_catalog.pg_index i
         join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
        where i.indrelid = to_regclass('public.currencies')
          and i.indisunique and i.indnkeyatts = 1 and i.indpred is null
          and a.attname = 'code'
     )
     and not exists (
       select 1 from pg_catalog.pg_constraint c
        where c.conname = 'store_products_currency_fkey'
          and c.conrelid = to_regclass('public.store_products')
     ) then
    alter table public.store_products
      add constraint store_products_currency_fkey
      foreign key (currency) references public.currencies (code);
  end if;
end
$currency$;

-- ===================== variantes (solo merch) =====================
create table if not exists public.store_product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.store_products (id) on delete cascade,
  label text not null,
  size text,
  color text,
  sku text,
  -- Override del precio base del producto.
  price_amount numeric(12,2),
  -- null = sin límite.
  stock integer,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_product_variants_label_check check (char_length(btrim(label)) between 1 and 60),
  constraint store_product_variants_size_check check (size is null or char_length(size) <= 20),
  constraint store_product_variants_color_check check (color is null or char_length(color) <= 30),
  constraint store_product_variants_sku_check check (sku is null or char_length(sku) <= 40),
  constraint store_product_variants_price_check
    check (price_amount is null or (price_amount > 0 and price_amount = round(price_amount, 2))),
  constraint store_product_variants_stock_check check (stock is null or stock >= 0)
);

create index if not exists store_product_variants_product_idx
  on public.store_product_variants (product_id, sort_order);

-- ===================== archivos del diseño =====================
create table if not exists public.store_design_assets (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.store_products (id) on delete cascade,
  kind text not null,
  -- <seller_id>/<product_id>/<original|stencil>/<ts>-<nombre> en store-design-files
  storage_path text not null,
  file_name text not null,
  -- El trigger los sobrescribe con los metadatos del objeto en Storage.
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  constraint store_design_assets_storage_path_key unique (storage_path),
  constraint store_design_assets_kind_check check (kind in ('original', 'stencil')),
  constraint store_design_assets_storage_path_check check (char_length(storage_path) <= 512),
  constraint store_design_assets_file_name_check check (char_length(btrim(file_name)) between 1 and 200),
  constraint store_design_assets_size_check check (size_bytes is null or size_bytes >= 0),
  constraint store_design_assets_stencil_mime_check check (
    kind <> 'stencil' or (mime_type is not null and mime_type in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf'))
  )
);

create index if not exists store_design_assets_product_idx
  on public.store_design_assets (product_id, kind);

-- ===================== ajustes del vendedor =====================
create table if not exists public.store_seller_settings (
  seller_type text not null,
  seller_id uuid not null,
  store_tagline text,
  -- p. ej. «WhatsApp +54 9 11…» o «@usuario en Instagram»
  contact_channel text,
  payment_instructions text,
  shipping_policy text,
  return_policy text,
  -- Privada: se copia a store_orders.pickup_details al confirmar el pago.
  pickup_address text,
  authorship_attested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_seller_settings_pkey primary key (seller_type, seller_id),
  constraint store_seller_settings_seller_type_check check (seller_type in ('artist', 'studio')),
  constraint store_seller_settings_tagline_check check (store_tagline is null or char_length(store_tagline) <= 160),
  constraint store_seller_settings_contact_check check (contact_channel is null or char_length(contact_channel) <= 200),
  constraint store_seller_settings_payment_check check (payment_instructions is null or char_length(payment_instructions) <= 2000),
  constraint store_seller_settings_shipping_policy_check check (shipping_policy is null or char_length(shipping_policy) <= 2000),
  constraint store_seller_settings_return_policy_check check (return_policy is null or char_length(return_policy) <= 2000),
  constraint store_seller_settings_pickup_address_check check (pickup_address is null or char_length(pickup_address) <= 300)
);

-- ===================== pedidos =====================
create table if not exists public.store_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null
    default ('ST-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  seller_type text not null,
  seller_id uuid not null,
  channel text not null default 'online',
  buyer_user_id uuid references auth.users (id) on delete set null,
  buyer_role text not null,
  buyer_name text not null,
  buyer_email text,
  buyer_phone text,
  status text not null default 'pending_payment',
  fulfillment_method text not null,
  fulfillment_status text not null default 'unfulfilled',
  -- {recipient, line1, line2, city, region, postal_code, country (ISO-2), phone}
  shipping_address jsonb,
  pickup_details text,
  tracking_carrier text,
  tracking_code text,
  tracking_url text,
  currency text not null,
  subtotal_amount numeric(12,2) not null,
  shipping_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null,
  platform_fee_pct numeric(5,2) not null default 0,
  platform_fee_amount numeric(12,2) not null default 0,
  payment_provider text not null default 'manual',
  expected_collector text not null default 'seller',
  -- Snapshots al crear el pedido (instrucciones del vendedor o de la plataforma).
  payment_instructions text,
  seller_contact text,
  buyer_payment_reference text,
  buyer_payment_reported_at timestamptz,
  paid_at timestamptz,
  payment_collected_by text,
  payment_confirmed_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz,
  shipped_at timestamptz,
  ready_at timestamptz,
  delivered_at timestamptz,
  delivered_by text,
  cancelled_at timestamptz,
  cancel_reason text,
  refunded_at timestamptz,
  funds_release_at timestamptz,
  funds_released_at timestamptz,
  funds_hold boolean not null default false,
  buyer_note text,
  -- Visible para el comprador (no hay notas privadas en v1).
  seller_message text,
  idempotency_key text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_orders_order_number_key unique (order_number),
  constraint store_orders_order_number_check check (order_number ~ '^ST-[A-Z0-9]{8}$'),
  constraint store_orders_seller_type_check check (seller_type in ('artist', 'studio')),
  constraint store_orders_channel_check check (channel in ('online', 'pos')),
  constraint store_orders_buyer_role_check check (buyer_role in ('client', 'artist', 'guest')),
  constraint store_orders_buyer_name_check check (char_length(btrim(buyer_name)) between 1 and 120),
  constraint store_orders_buyer_email_check check (buyer_email is null or char_length(buyer_email) <= 254),
  constraint store_orders_buyer_phone_check check (buyer_phone is null or char_length(buyer_phone) <= 40),
  constraint store_orders_status_check
    check (status in ('pending_payment', 'paid', 'fulfilled', 'cancelled', 'refunded', 'expired')),
  constraint store_orders_fulfillment_method_check check (fulfillment_method in ('digital', 'shipping', 'pickup')),
  constraint store_orders_fulfillment_status_check
    check (fulfillment_status in ('unfulfilled', 'preparing', 'shipped', 'ready_for_pickup', 'delivered')),
  constraint store_orders_pickup_details_check check (pickup_details is null or char_length(pickup_details) <= 300),
  constraint store_orders_tracking_carrier_check check (tracking_carrier is null or char_length(tracking_carrier) <= 60),
  constraint store_orders_tracking_code_check check (tracking_code is null or char_length(tracking_code) <= 80),
  constraint store_orders_tracking_url_check
    check (tracking_url is null or (tracking_url ~ '^https://' and char_length(tracking_url) <= 500)),
  constraint store_orders_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint store_orders_subtotal_check check (subtotal_amount >= 0 and subtotal_amount = round(subtotal_amount, 2)),
  constraint store_orders_shipping_amount_check check (shipping_amount >= 0 and shipping_amount = round(shipping_amount, 2)),
  constraint store_orders_total_check
    check (total_amount > 0 and total_amount = round(total_amount, 2) and total_amount = subtotal_amount + shipping_amount),
  constraint store_orders_fee_pct_check check (platform_fee_pct between 0 and 50),
  constraint store_orders_fee_amount_check
    check (platform_fee_amount >= 0 and platform_fee_amount = round(platform_fee_amount, 2) and platform_fee_amount <= total_amount),
  constraint store_orders_payment_provider_check check (payment_provider in ('manual', 'stripe', 'mercado_pago')),
  constraint store_orders_expected_collector_check check (expected_collector in ('seller', 'platform', 'provider')),
  constraint store_orders_payment_instructions_check check (payment_instructions is null or char_length(payment_instructions) <= 4000),
  constraint store_orders_seller_contact_check check (seller_contact is null or char_length(seller_contact) <= 200),
  constraint store_orders_buyer_reference_check check (buyer_payment_reference is null or char_length(buyer_payment_reference) <= 200),
  constraint store_orders_collected_by_check
    check (payment_collected_by is null or payment_collected_by in ('seller', 'platform', 'provider')),
  constraint store_orders_delivered_by_check
    check (delivered_by is null or delivered_by in ('buyer', 'seller', 'support', 'auto')),
  constraint store_orders_cancel_reason_check check (cancel_reason is null or char_length(cancel_reason) <= 300),
  constraint store_orders_buyer_note_check check (buyer_note is null or char_length(buyer_note) <= 1000),
  constraint store_orders_seller_message_check check (seller_message is null or char_length(seller_message) <= 1000),
  constraint store_orders_idempotency_key_check check (idempotency_key is null or char_length(idempotency_key) <= 80),
  constraint store_orders_metadata_check check (jsonb_typeof(metadata_json) = 'object'),
  constraint store_orders_shipping_address_check
    check (fulfillment_method <> 'shipping' or (shipping_address is not null and jsonb_typeof(shipping_address) = 'object')),
  constraint store_orders_unpaid_shape_check
    check (status not in ('pending_payment', 'cancelled', 'expired') or (fulfillment_status = 'unfulfilled' and paid_at is null)),
  constraint store_orders_fulfilled_check check (status <> 'fulfilled' or fulfillment_status = 'delivered'),
  constraint store_orders_digital_check
    check (fulfillment_method <> 'digital' or fulfillment_status in ('unfulfilled', 'delivered')),
  constraint store_orders_method_status_check check (
    (fulfillment_method <> 'shipping' or fulfillment_status <> 'ready_for_pickup')
    and (fulfillment_method <> 'pickup' or fulfillment_status <> 'shipped')
  ),
  constraint store_orders_funds_check check (funds_released_at is null or funds_release_at is not null),
  constraint store_orders_pos_collector_check check (channel <> 'pos' or expected_collector = 'seller'),
  -- Una sola dirección: un pedido online cuyo comprador borró la cuenta queda
  -- con buyer_user_id null y no viola el check.
  constraint store_orders_guest_check check (buyer_role <> 'guest' or (buyer_user_id is null and channel = 'pos'))
);

create unique index if not exists store_orders_online_idempotency_idx
  on public.store_orders (buyer_user_id, idempotency_key)
  where channel = 'online';
create unique index if not exists store_orders_pos_idempotency_idx
  on public.store_orders (seller_type, seller_id, idempotency_key)
  where channel = 'pos';
create index if not exists store_orders_buyer_idx
  on public.store_orders (buyer_user_id, created_at desc)
  where buyer_user_id is not null;
create index if not exists store_orders_seller_idx
  on public.store_orders (seller_type, seller_id, status, created_at desc);
create index if not exists store_orders_pending_idx
  on public.store_orders (expires_at)
  where status = 'pending_payment';
create index if not exists store_orders_paid_idx
  on public.store_orders (fulfillment_status, shipped_at, ready_at)
  where status = 'paid';
create index if not exists store_orders_release_idx
  on public.store_orders (funds_release_at)
  where funds_release_at is not null and funds_released_at is null;

drop trigger if exists trg_store_orders_updated_at on public.store_orders;
create trigger trg_store_orders_updated_at
  before update on public.store_orders
  for each row execute function public.set_updated_at();

-- Reserva del exclusivo → pedido que la tiene (circular: se agrega después).
do $reserved$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint c
     where c.conname = 'store_products_reserved_order_fkey'
       and c.conrelid = to_regclass('public.store_products')
  ) then
    alter table public.store_products
      add constraint store_products_reserved_order_fkey
      foreign key (reserved_order_id) references public.store_orders (id) on delete set null;
  end if;
end
$reserved$;

-- ===================== ítems (v1: uno por pedido) =====================
create table if not exists public.store_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.store_orders (id) on delete cascade,
  product_id uuid references public.store_products (id) on delete set null,
  variant_id uuid references public.store_product_variants (id) on delete restrict,
  kind text not null,
  title text not null,
  variant_label text,
  image_path text,
  license_tier text,
  license_holder_name text,
  terms_version text,
  terms_accepted_at timestamptz,
  unit_price numeric(12,2) not null,
  quantity integer not null,
  line_total numeric(12,2) not null,
  created_at timestamptz not null default now(),
  constraint store_order_items_kind_check check (kind in ('merch', 'design')),
  constraint store_order_items_title_check check (char_length(btrim(title)) between 1 and 120),
  constraint store_order_items_variant_label_check check (variant_label is null or char_length(variant_label) <= 60),
  constraint store_order_items_image_path_check check (image_path is null or char_length(image_path) <= 512),
  constraint store_order_items_tier_check check (license_tier is null or license_tier in ('personal', 'artist', 'exclusive')),
  constraint store_order_items_holder_check check (license_holder_name is null or char_length(license_holder_name) <= 120),
  constraint store_order_items_terms_check check (terms_version is null or char_length(terms_version) <= 20),
  constraint store_order_items_unit_price_check check (unit_price > 0 and unit_price = round(unit_price, 2)),
  constraint store_order_items_quantity_check check (quantity between 1 and 20),
  constraint store_order_items_line_total_check check (line_total > 0 and line_total = round(line_total, 2)),
  constraint store_order_items_design_check
    check (kind <> 'design' or (license_tier is not null and quantity = 1)),
  constraint store_order_items_merch_check check (kind <> 'merch' or license_tier is null)
);

-- v1 sin carrito: un ítem por pedido (el carrito lo reemplaza por un índice común).
create unique index if not exists store_order_items_one_per_order
  on public.store_order_items (order_id);
create index if not exists store_order_items_product_idx
  on public.store_order_items (product_id)
  where product_id is not null;
create index if not exists store_order_items_variant_idx
  on public.store_order_items (variant_id)
  where variant_id is not null;

-- ===================== pagos =====================
create table if not exists public.store_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.store_orders (id) on delete cascade,
  provider text not null,
  status text not null,
  amount numeric(12,2) not null,
  currency text not null,
  collected_by text,
  reference text,
  note text,
  confirmed_by uuid references auth.users (id) on delete set null,
  provider_payload jsonb,
  created_at timestamptz not null default now(),
  constraint store_payments_provider_check check (provider in ('manual', 'stripe', 'mercado_pago')),
  constraint store_payments_status_check check (status in ('pending', 'succeeded', 'failed', 'refunded', 'duplicate')),
  constraint store_payments_amount_check check (amount > 0 and amount = round(amount, 2)),
  constraint store_payments_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint store_payments_collected_by_check
    check (collected_by is null or collected_by in ('seller', 'platform', 'provider')),
  constraint store_payments_reference_check check (reference is null or char_length(reference) <= 200),
  constraint store_payments_note_check check (note is null or char_length(note) <= 500)
);

create unique index if not exists store_payments_provider_reference_idx
  on public.store_payments (provider, reference)
  where reference is not null and provider <> 'manual';
create index if not exists store_payments_order_idx
  on public.store_payments (order_id, created_at);

-- ===================== licencias =====================
create table if not exists public.store_licenses (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.store_orders (id) on delete cascade,
  order_item_id uuid not null references public.store_order_items (id) on delete cascade,
  product_id uuid references public.store_products (id) on delete set null,
  tier text not null,
  holder_user_id uuid references auth.users (id) on delete set null,
  holder_name text not null,
  seller_type text not null,
  seller_id uuid not null,
  seller_display_name text,
  seller_username text,
  design_title text not null,
  terms_version text not null,
  verification_code text not null,
  used_at timestamptz,
  used_note text,
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint store_licenses_order_item_id_key unique (order_item_id),
  constraint store_licenses_verification_code_key unique (verification_code),
  constraint store_licenses_tier_check check (tier in ('personal', 'artist', 'exclusive')),
  constraint store_licenses_holder_name_check check (char_length(btrim(holder_name)) between 1 and 120),
  constraint store_licenses_seller_type_check check (seller_type in ('artist', 'studio')),
  constraint store_licenses_design_title_check check (char_length(btrim(design_title)) between 1 and 120),
  constraint store_licenses_terms_check check (char_length(terms_version) between 1 and 20),
  constraint store_licenses_code_check check (verification_code ~ '^WOL-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  constraint store_licenses_used_note_check check (used_note is null or char_length(used_note) <= 160),
  constraint store_licenses_revoke_reason_check check (revoke_reason is null or char_length(revoke_reason) <= 300),
  constraint store_licenses_metadata_check check (jsonb_typeof(metadata_json) = 'object')
);

create index if not exists store_licenses_holder_idx
  on public.store_licenses (holder_user_id, issued_at desc)
  where holder_user_id is not null;
create index if not exists store_licenses_product_idx
  on public.store_licenses (product_id)
  where product_id is not null;
create index if not exists store_licenses_order_idx
  on public.store_licenses (order_id);
create index if not exists store_licenses_seller_idx
  on public.store_licenses (seller_type, seller_id, issued_at desc);

-- ===================== descargas =====================
create table if not exists public.store_download_events (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.store_licenses (id) on delete cascade,
  asset_id uuid references public.store_design_assets (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists store_download_events_license_idx
  on public.store_download_events (license_id, created_at desc);

-- ===================== notas internas de soporte =====================
-- Lo que no tiene que ver el comprador ni el vendedor (metadata_json del
-- pedido sí lo ven): nota y autor de la retención, autor del reembolso y de
-- la reapertura, marca resuelta y el error crudo del mantenimiento. Las
-- escriben solo las RPC; lee soporte.
create table if not exists public.store_order_support_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.store_orders (id) on delete cascade,
  kind text not null,
  note text,
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint store_order_support_notes_kind_check
    check (kind in ('funds_hold', 'funds_release', 'refund', 'reopen', 'flag_resolved', 'maintenance_error')),
  constraint store_order_support_notes_note_check check (note is null or char_length(note) <= 500)
);

create index if not exists store_order_support_notes_order_idx
  on public.store_order_support_notes (order_id, created_at desc);

-- ===================== helpers (policies) =====================
-- Artista con registro completo (condición de vendedor y del nivel 'artist').
create or replace function public.store_seller_ready_artist(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1
      from public.artists_db a
     where a.user_id = p_user
       and a.registration_status is distinct from 'incompleto'
  );
$$;

revoke all on function public.store_seller_ready_artist(uuid) from public, anon, authenticated, service_role;

-- ¿La sesión maneja este vendedor? La sesión de estudios puede extender la
-- rama studio con create or replace (p. ej. para staff).
create or replace function public.store_can_manage_seller(p_seller_type text, p_seller_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_seller_id is null or (select auth.uid()) is null then false
    when p_seller_type = 'artist' then
      p_seller_id = (select auth.uid()) and public.store_seller_ready_artist(p_seller_id)
    when p_seller_type = 'studio' then exists (
      select 1 from public.studios s
       where s.id = p_seller_id and s.user_id = (select auth.uid())
    )
    else false
  end;
$$;

revoke all on function public.store_can_manage_seller(text, uuid) from public, anon, authenticated;
grant execute on function public.store_can_manage_seller(text, uuid) to authenticated;

-- Misma lógica para la carpeta raíz de Storage. Compara como texto: nunca
-- castea el path a uuid.
create or replace function public.store_can_manage_storage_folder(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_folder is null or (select auth.uid()) is null then false
    else (
      p_folder = (select auth.uid())::text
      and public.store_seller_ready_artist((select auth.uid()))
    ) or exists (
      select 1 from public.studios s
       where s.id::text = p_folder and s.user_id = (select auth.uid())
    )
  end;
$$;

revoke all on function public.store_can_manage_storage_folder(text) from public, anon, authenticated;
grant execute on function public.store_can_manage_storage_folder(text) to authenticated;

-- Versión vigente de los términos (TERMS['2026-10'] en store-model.js).
create or replace function public.store_current_terms_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select '2026-10'::text;
$$;

revoke all on function public.store_current_terms_version() from public, anon, authenticated, service_role;

-- ===================== helpers internos (sin grants) =====================
-- Predicado único del wallet (§2).
create or replace function public.store_order_uses_wallet(p_order public.store_orders)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_order.seller_type = 'artist'
      and p_order.payment_collected_by in ('platform', 'provider'),
    false
  );
$$;

revoke all on function public.store_order_uses_wallet(public.store_orders) from public, anon, authenticated, service_role;

-- Pendiente que ya se puede cerrar como vencido: sin pago informado, al pasar
-- expires_at; con pago informado, 7 días después (en ese plazo soporte lo ve
-- marcado needs_support y el vendedor que cobra directo lo puede cancelar).
-- Lo usan el mantenimiento y create_store_order (toma de reserva vencida).
create or replace function public.store_order_lapsed(p_order public.store_orders)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    p_order.status = 'pending_payment'
      and p_order.expires_at < now()
      and (p_order.buyer_payment_reported_at is null or p_order.expires_at < now() - interval '7 days'),
    false
  );
$$;

revoke all on function public.store_order_lapsed(public.store_orders) from public, anon, authenticated, service_role;

create or replace function public.store_app_setting(p_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(btrim(s.setting_value), '')
    from public.app_settings s
   where s.setting_key = p_key
   limit 1;
$$;

revoke all on function public.store_app_setting(text) from public, anon, authenticated, service_role;

-- Comisión de plataforma con cast seguro, acotada a [0, 50].
create or replace function public.store_platform_fee_pct()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when btrim(s.setting_value) ~ '^\d+(\.\d+)?$'
        then least(greatest(btrim(s.setting_value)::numeric, 0), 50)
      else 0
    end
      from public.app_settings s
     where s.setting_key = 'store_platform_fee_pct'
     limit 1
  ), 0);
$$;

revoke all on function public.store_platform_fee_pct() from public, anon, authenticated, service_role;

-- ST- + 8 caracteres de gen_random_uuid(), reintentando si ya existe.
create or replace function public.store_new_order_number()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_number text;
  v_try integer := 0;
begin
  loop
    v_number := 'ST-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.store_orders o where o.order_number = v_number);
    v_try := v_try + 1;
    if v_try >= 20 then
      raise exception using errcode = 'P0001', message = 'store:invalid_status';
    end if;
  end loop;
  return v_number;
end;
$$;

revoke all on function public.store_new_order_number() from public, anon, authenticated, service_role;

-- WOL-XXXX-XXXX desde gen_random_uuid() (sin random() ni pgcrypto).
create or replace function public.store_new_license_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hex text;
  v_code text;
  v_try integer := 0;
begin
  loop
    v_hex := upper(replace(gen_random_uuid()::text, '-', ''));
    v_code := 'WOL-' || substr(v_hex, 1, 4) || '-' || substr(v_hex, 5, 4);
    exit when not exists (select 1 from public.store_licenses l where l.verification_code = v_code);
    v_try := v_try + 1;
    if v_try >= 20 then
      raise exception using errcode = 'P0001', message = 'store:invalid_status';
    end if;
  end loop;
  return v_code;
end;
$$;

revoke all on function public.store_new_license_code() from public, anon, authenticated, service_role;

-- Locks en orden producto → pedido: lee el product_id del ítem sin lock,
-- lockea el producto y después el pedido. Devuelve el pedido (id null si no existe).
create or replace function public.store_lock_order(p_order_id uuid)
returns public.store_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_order public.store_orders;
begin
  select i.product_id into v_product_id
    from public.store_order_items i
   where i.order_id = p_order_id
   order by i.created_at
   limit 1;
  if v_product_id is not null then
    perform 1 from public.store_products p where p.id = v_product_id for update;
  end if;
  select * into v_order from public.store_orders o where o.id = p_order_id for update;
  return v_order;
end;
$$;

revoke all on function public.store_lock_order(uuid) from public, anon, authenticated, service_role;

-- Variante para el mantenimiento: mismo orden, pero con skip locked (nunca
-- espera). Devuelve false si el producto o el pedido están tomados.
create or replace function public.store_try_lock_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
begin
  select i.product_id into v_product_id
    from public.store_order_items i
   where i.order_id = p_order_id
   order by i.created_at
   limit 1;
  if v_product_id is not null then
    perform 1 from public.store_products p where p.id = v_product_id for update skip locked;
    if not found and exists (select 1 from public.store_products p where p.id = v_product_id) then
      return false;
    end if;
  end if;
  perform 1 from public.store_orders o where o.id = p_order_id for update skip locked;
  return found;
end;
$$;

revoke all on function public.store_try_lock_order(uuid) from public, anon, authenticated, service_role;

-- Cierra un pedido impago (cancelled | expired), restituye el stock y libera
-- la reserva condicionada a este pedido. El llamador ya tiene los locks.
-- Un vencido con pago informado queda marcado needs_support: soporte decide
-- si lo reabre (el comprador dice que pagó).
create or replace function public.store_close_unpaid_order(p_order_id uuid, p_status text, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('cancelled', 'expired') then
    raise exception using errcode = 'P0001', message = 'store:invalid_status';
  end if;

  update public.store_orders
     set status = p_status,
         cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
         cancel_reason = case
           when p_status = 'cancelled' then nullif(left(btrim(coalesce(p_reason, '')), 300), '')
           else cancel_reason
         end,
         metadata_json = case
           when p_status = 'expired' and buyer_payment_reported_at is not null
                and coalesce(metadata_json ->> 'needs_support', '') <> 'true'
             then metadata_json || jsonb_build_object(
               'needs_support', true, 'needs_support_reason', 'payment_reported_expired', 'needs_support_at', now())
           else metadata_json
         end
   where id = p_order_id
     and status = 'pending_payment';
  if not found then
    return false;
  end if;

  update public.store_product_variants v
     set stock = v.stock + s.qty
    from (
      select i.variant_id, sum(i.quantity)::integer as qty
        from public.store_order_items i
       where i.order_id = p_order_id and i.variant_id is not null
       group by i.variant_id
    ) s
   where v.id = s.variant_id
     and v.stock is not null;

  update public.store_products p
     set reserved_order_id = null,
         reserved_until = null
   where p.id in (select i.product_id from public.store_order_items i where i.order_id = p_order_id)
     and p.reserved_order_id = p_order_id;

  return true;
end;
$$;

revoke all on function public.store_close_unpaid_order(uuid, text, text) from public, anon, authenticated, service_role;

-- Wallet · inserta un movimiento 'completed' idempotente (store:<id>:<sufijo>).
create or replace function public.store_wallet_insert(
  p_order public.store_orders,
  p_kind text,
  p_amount numeric,
  p_suffix text,
  p_title text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_amount is null or p_amount <= 0 then
    return;
  end if;
  if to_regclass('public.artist_wallet_movements') is not null then
    execute format($q$
      insert into public.artist_wallet_movements
        (artist_user_id, kind, status, amount, currency, title, counterparty_name,
         booking_reference, occurred_at, external_reference, metadata_json)
      values ($1, $2, 'completed', $3, $4, $5, $6, $7, now(), $8, $9)
      on conflict (artist_user_id, external_reference) do nothing
    $q$)
    using p_order.seller_id, p_kind, round(p_amount, 2), p_order.currency, left(p_title, 160),
          left(p_order.buyer_name, 120), p_order.order_number,
          'store:' || p_order.id::text || ':' || p_suffix,
          jsonb_build_object('source', 'store', 'order_id', p_order.id, 'order_number', p_order.order_number);
  end if;
end;
$$;

revoke all on function public.store_wallet_insert(public.store_orders, text, numeric, text, text) from public, anon, authenticated, service_role;

-- Wallet · crea (o reconstruye) el 'payment' retenido del pedido. Si ya
-- existe no lo toca (on conflict do nothing).
create or replace function public.store_wallet_upsert_payment(p_order public.store_orders)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_release_at timestamptz;
  v_title text;
begin
  if not public.store_order_uses_wallet(p_order) then
    return;
  end if;
  if p_order.fulfillment_status = 'delivered' then
    v_status := 'awaiting_release';
    v_release_at := coalesce(p_order.funds_release_at, now() + interval '72 hours');
  else
    v_status := 'pending_service';
    v_release_at := null;
  end if;
  select left('Venta en Store · ' || i.title, 160) into v_title
    from public.store_order_items i
   where i.order_id = p_order.id
   order by i.created_at
   limit 1;
  v_title := coalesce(v_title, 'Venta en Store · Pedido #' || p_order.order_number);

  if to_regclass('public.artist_wallet_movements') is not null then
    execute format($q$
      insert into public.artist_wallet_movements
        (artist_user_id, kind, status, amount, currency, title, counterparty_name,
         booking_reference, release_at, occurred_at, external_reference, metadata_json)
      values ($1, 'payment', $2, $3, $4, $5, $6, $7, $8, now(), $9, $10)
      on conflict (artist_user_id, external_reference) do nothing
    $q$)
    using p_order.seller_id, v_status, p_order.total_amount, p_order.currency, v_title,
          left(p_order.buyer_name, 120), p_order.order_number, v_release_at,
          'store:' || p_order.id::text || ':payment',
          jsonb_build_object('source', 'store', 'order_id', p_order.id, 'order_number', p_order.order_number);
  end if;
end;
$$;

revoke all on function public.store_wallet_upsert_payment(public.store_orders) from public, anon, authenticated, service_role;

-- Entrega del merch (comprador, soporte, vendedor sin wallet o automática).
-- Si usa wallet: funds_release_at = now() + 72 h y el payment pasa a
-- awaiting_release. Si está retenido (blocked por funds_hold) sigue blocked,
-- pero con su release_at, para que al levantar la retención no quede sin
-- fecha. El llamador ya tiene los locks y validó el estado.
create or replace function public.store_finish_delivery(p_order_id uuid, p_by text)
returns public.store_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.store_orders;
begin
  update public.store_orders
     set status = 'fulfilled',
         fulfillment_status = 'delivered',
         delivered_at = now(),
         delivered_by = p_by
   where id = p_order_id
     and status = 'paid'
     and fulfillment_method in ('shipping', 'pickup')
  returning * into v_order;
  if not found then
    raise exception using errcode = 'P0001', message = 'store:invalid_status';
  end if;

  if public.store_order_uses_wallet(v_order) then
    update public.store_orders
       set funds_release_at = now() + interval '72 hours'
     where id = v_order.id
    returning * into v_order;
    if to_regclass('public.artist_wallet_movements') is not null then
      perform public.store_wallet_upsert_payment(v_order);
      execute format($q$
        update public.artist_wallet_movements
           set status = case when status = 'pending_service' then 'awaiting_release' else status end,
               release_at = $3
         where artist_user_id = $1 and external_reference = $2 and status in ('pending_service', 'blocked')
      $q$)
      using v_order.seller_id, 'store:' || v_order.id::text || ':payment', v_order.funds_release_at;
    end if;
  end if;

  return v_order;
end;
$$;

revoke all on function public.store_finish_delivery(uuid, text) from public, anon, authenticated, service_role;

-- Proyección pública de un producto (sin campos del servidor sensibles).
create or replace function public.store_public_product_json(p_product public.store_products)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_product.id,
    'kind', p_product.kind,
    'title', p_product.title,
    'description', p_product.description,
    'category', p_product.category,
    'tags', to_jsonb(p_product.tags),
    'currency', p_product.currency,
    'price_amount', p_product.price_amount,
    'price_from', case
      when p_product.kind = 'design' then least(
        p_product.license_personal_price, p_product.license_artist_price, p_product.license_exclusive_price
      )
      else coalesce((
        select min(coalesce(v.price_amount, p_product.price_amount))
          from public.store_product_variants v
         where v.product_id = p_product.id and v.active
      ), p_product.price_amount)
    end,
    'license_personal_price', p_product.license_personal_price,
    'license_artist_price', p_product.license_artist_price,
    'license_exclusive_price', p_product.license_exclusive_price,
    'exclusive_available', (
      p_product.kind = 'design'
      and p_product.license_exclusive_price is not null
      and p_product.reserved_order_id is null
      and p_product.licenses_issued = 0
      and p_product.exclusive_sold_at is null
      and not exists (
        select 1
          from public.store_order_items i
          join public.store_orders o on o.id = i.order_id
         where i.product_id = p_product.id and o.status = 'pending_payment'
      )
    ),
    -- Misma condición que frena la compra (create_store_order → product_reserved):
    -- la reserva se libera al cerrar o confirmar el pedido, no al pasar
    -- reserved_until (un pago informado la extiende).
    'reserved', p_product.reserved_order_id is not null,
    'licenses_issued', p_product.licenses_issued,
    'design_width_cm', p_product.design_width_cm,
    'design_height_cm', p_product.design_height_cm,
    'design_style', p_product.design_style,
    'placement_suggestion', p_product.placement_suggestion,
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('path', x.e ->> 'path', 'alt', x.e ->> 'alt') order by x.ord)
        from jsonb_array_elements(p_product.images) with ordinality as x(e, ord)
    ), '[]'::jsonb),
    'shipping_price_amount', p_product.shipping_price_amount,
    'ships_to_countries', to_jsonb(p_product.ships_to_countries),
    'ships_to_note', p_product.ships_to_note,
    -- Retiro solo si el vendedor cargó la dirección (create_store_order la exige).
    'pickup_available', p_product.pickup_available and exists (
      select 1
        from public.store_seller_settings s
       where s.seller_type = p_product.seller_type
         and s.seller_id = p_product.seller_id
         and nullif(btrim(coalesce(s.pickup_address, '')), '') is not null
    ),
    'pickup_note', p_product.pickup_note,
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id,
               'label', v.label,
               'size', v.size,
               'color', v.color,
               'price_amount', v.price_amount,
               'in_stock', v.stock is null or v.stock > 0,
               'low_stock', case when v.stock is not null and v.stock <= 5 then v.stock end
             ) order by v.sort_order, v.created_at)
        from public.store_product_variants v
       where v.product_id = p_product.id and v.active
    ), '[]'::jsonb),
    'published_at', p_product.published_at
  );
$$;

revoke all on function public.store_public_product_json(public.store_products) from public, anon, authenticated, service_role;

-- {seller, settings, allow_search_indexing} del vendedor, o null.
create or replace function public.store_public_seller_bundle(p_seller_type text, p_seller_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seller jsonb;
  v_index boolean := false;
  v_settings public.store_seller_settings;
begin
  if p_seller_type = 'artist' then
    select jsonb_build_object(
             'type', 'artist',
             'id', a.user_id,
             'handle', a.username,
             'name', a.name,
             'avatar_url', a.profile_picture,
             'city', case when coalesce(up.privacy ->> 'show_city', '') = 'false' then null::text else a.city end,
             'country', a.country
           ),
           coalesce(up.privacy ->> 'allow_search_indexing', '') = 'true'
      into v_seller, v_index
      from public.artists_db a
      left join public.user_preferences up on up.user_id = a.user_id
     where a.user_id = p_seller_id
       and a.registration_status is distinct from 'incompleto'
     limit 1;
    if not found then
      return null;
    end if;
  elsif p_seller_type = 'studio' then
    select jsonb_build_object(
             'type', 'studio',
             'id', s.id,
             'handle', null::text,
             'name', s.name,
             'avatar_url', null::text,
             'city', null::text,
             'country', null::text
           )
      into v_seller
      from public.studios s
     where s.id = p_seller_id
     limit 1;
    if not found then
      return null;
    end if;
    v_index := false;
  else
    return null;
  end if;

  select * into v_settings
    from public.store_seller_settings ss
   where ss.seller_type = p_seller_type and ss.seller_id = p_seller_id;

  return jsonb_build_object(
    'seller', v_seller,
    'allow_search_indexing', coalesce(v_index, false),
    'settings', jsonb_build_object(
      'tagline', v_settings.store_tagline,
      'shipping_policy', v_settings.shipping_policy,
      'return_policy', v_settings.return_policy
    )
  );
end;
$$;

revoke all on function public.store_public_seller_bundle(text, uuid) from public, anon, authenticated, service_role;

-- ===================== guard triggers (security invoker) =====================
-- Solo se aplican a las escrituras directas (PostgREST con authenticated).
create or replace function public.store_products_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_bypass boolean := current_user in ('postgres', 'supabase_admin', 'service_role')
    or coalesce((select auth.role()), '') = 'service_role';
  v_check_images boolean;
  v_entering_active boolean;
  v_item jsonb;
  v_path text;
  v_alt text;
  v_clean jsonb := '[]'::jsonb;
  v_settings public.store_seller_settings;
  v_ok boolean;
begin
  if tg_op = 'DELETE' then
    if v_bypass then
      return old;
    end if;
    -- Solo borradores sin pedidos (si no, se retira o se pausa).
    if old.status <> 'draft'
       or exists (select 1 from public.store_order_items i where i.product_id = old.id) then
      raise exception using errcode = 'P0001', message = 'store:invalid_status';
    end if;
    return old;
  end if;

  new.updated_at := now();
  if v_bypass then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.sales_count := 0;
    new.licenses_issued := 0;
    new.reserved_order_id := null;
    new.reserved_until := null;
    new.exclusive_sold_at := null;
    new.published_at := null;
    new.retired_at := null;
    new.created_at := now();
    v_check_images := true;
    v_entering_active := false;
  else
    if new.id is distinct from old.id
       or new.seller_type is distinct from old.seller_type
       or new.seller_id is distinct from old.seller_id
       or new.kind is distinct from old.kind then
      raise exception using errcode = 'P0001', message = 'store:forbidden';
    end if;
    if old.status = 'retired' and new.status is distinct from 'retired' then
      raise exception using errcode = 'P0001', message = 'store:invalid_status';
    end if;
    new.sales_count := old.sales_count;
    new.licenses_issued := old.licenses_issued;
    new.reserved_order_id := old.reserved_order_id;
    new.reserved_until := old.reserved_until;
    new.exclusive_sold_at := old.exclusive_sold_at;
    new.published_at := old.published_at;
    new.retired_at := old.retired_at;
    new.created_at := old.created_at;
    v_check_images := new.images is distinct from old.images;
    v_entering_active := new.status = 'active' and old.status is distinct from 'active';
  end if;

  -- Tags y países normalizados.
  new.tags := array(
    select left(btrim(x.t), 40)
      from unnest(coalesce(new.tags, '{}'::text[])) with ordinality as x(t, ord)
     where nullif(btrim(x.t), '') is not null
     order by x.ord
  );
  new.ships_to_countries := array(
    select distinct upper(btrim(x.c))
      from unnest(coalesce(new.ships_to_countries, '{}'::text[])) as x(c)
     where nullif(btrim(x.c), '') is not null
     order by 1
  );

  -- Imágenes: {path, alt} con path propio, existente en store-previews y alt ≤200.
  if v_check_images then
    if new.images is null or jsonb_typeof(new.images) <> 'array' or jsonb_array_length(new.images) > 8 then
      raise exception using errcode = 'P0001', message = 'store:invalid_image_path';
    end if;
    for v_item in select x.e from jsonb_array_elements(new.images) as x(e) loop
      if jsonb_typeof(v_item) <> 'object' then
        raise exception using errcode = 'P0001', message = 'store:invalid_image_path';
      end if;
      v_path := v_item ->> 'path';
      v_alt := btrim(coalesce(v_item ->> 'alt', ''));
      if v_path is null
         or v_path !~ ('^' || new.seller_id::text || '/' || new.id::text || '/[0-9]+-[0-9]+\.(jpe?g|webp|png)$')
         or char_length(v_alt) > 200
         or not exists (
           select 1 from storage.objects o
            where o.bucket_id = 'store-previews' and o.name = v_path
         ) then
        raise exception using errcode = 'P0001', message = 'store:invalid_image_path';
      end if;
      v_clean := v_clean || jsonb_build_array(jsonb_build_object('path', v_path, 'alt', v_alt));
    end loop;
    new.images := v_clean;
  end if;

  -- Publicado: checklist (espejo de WeotziStoreModel.publishChecklist).
  if new.status = 'active' then
    if new.kind = 'design' then
      v_ok := coalesce(new.license_personal_price, new.license_artist_price, new.license_exclusive_price) is not null
        and jsonb_array_length(new.images) >= 1;
    else
      v_ok := new.price_amount is not null and jsonb_array_length(new.images) >= 1;
    end if;
    if v_ok and v_entering_active then
      select * into v_settings
        from public.store_seller_settings s
       where s.seller_type = new.seller_type and s.seller_id = new.seller_id;
      v_ok := nullif(btrim(coalesce(v_settings.payment_instructions, '')), '') is not null
        and nullif(btrim(coalesce(v_settings.contact_channel, '')), '') is not null;
      if v_ok and new.kind = 'design' then
        v_ok := v_settings.authorship_attested_at is not null
          and exists (select 1 from public.store_design_assets a where a.product_id = new.id and a.kind = 'original')
          and exists (select 1 from public.store_design_assets a where a.product_id = new.id and a.kind = 'stencil');
      elsif v_ok then
        v_ok := exists (select 1 from public.store_product_variants v where v.product_id = new.id and v.active);
      end if;
    end if;
    if not coalesce(v_ok, false) then
      raise exception using errcode = 'P0001', message = 'store:checklist_incomplete';
    end if;
    new.published_at := coalesce(new.published_at, now());
  end if;

  if new.status = 'retired' then
    new.retired_at := coalesce(new.retired_at, now());
  end if;

  return new;
end;
$$;

revoke all on function public.store_products_guard() from public, anon, authenticated, service_role;

drop trigger if exists trg_store_products_guard on public.store_products;
create trigger trg_store_products_guard
  before insert or update or delete on public.store_products
  for each row execute function public.store_products_guard();

create or replace function public.store_product_variants_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_bypass boolean := current_user in ('postgres', 'supabase_admin', 'service_role')
    or coalesce((select auth.role()), '') = 'service_role';
  v_product public.store_products;
  v_found boolean;
  v_product_id uuid;
begin
  if tg_op = 'DELETE' then
    if v_bypass then
      return old;
    end if;
    v_product_id := old.product_id;
  else
    new.updated_at := now();
    if v_bypass then
      return new;
    end if;
    v_product_id := new.product_id;
  end if;

  select * into v_product from public.store_products p where p.id = v_product_id;
  v_found := found;

  if tg_op = 'INSERT' then
    if not v_found or v_product.kind <> 'merch' then
      raise exception using errcode = 'P0001', message = 'store:forbidden';
    end if;
    new.created_at := now();
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.product_id is distinct from old.product_id then
      raise exception using errcode = 'P0001', message = 'store:forbidden';
    end if;
    -- El stock cambia solo por adjust_store_variant_stock.
    new.stock := old.stock;
    new.created_at := old.created_at;
    if old.active and not new.active and v_found and v_product.status = 'active'
       and not exists (
         select 1 from public.store_product_variants v
          where v.product_id = old.product_id and v.active and v.id <> old.id
       ) then
      raise exception using errcode = 'P0001', message = 'store:checklist_incomplete';
    end if;
    return new;
  end if;

  -- DELETE: con pedidos se desactiva (la FK es restrict).
  if exists (select 1 from public.store_order_items i where i.variant_id = old.id) then
    raise exception using errcode = 'P0001', message = 'store:invalid_status';
  end if;
  if old.active and v_found and v_product.status = 'active'
     and not exists (
       select 1 from public.store_product_variants v
        where v.product_id = old.product_id and v.active and v.id <> old.id
     ) then
    raise exception using errcode = 'P0001', message = 'store:checklist_incomplete';
  end if;
  return old;
end;
$$;

revoke all on function public.store_product_variants_guard() from public, anon, authenticated, service_role;

drop trigger if exists trg_store_product_variants_guard on public.store_product_variants;
create trigger trg_store_product_variants_guard
  before insert or update or delete on public.store_product_variants
  for each row execute function public.store_product_variants_guard();

create or replace function public.store_design_assets_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_bypass boolean := current_user in ('postgres', 'supabase_admin', 'service_role')
    or coalesce((select auth.role()), '') = 'service_role';
  v_product public.store_products;
  v_found boolean;
  v_meta jsonb;
  v_exts text[];
  v_name text;
  v_ext text;
begin
  if tg_op = 'UPDATE' then
    if v_bypass then
      return new;
    end if;
    raise exception using errcode = 'P0001', message = 'store:forbidden';
  end if;

  if tg_op = 'DELETE' then
    if v_bypass then
      return old;
    end if;
    if exists (
      select 1 from public.store_licenses l
       where l.product_id = old.product_id and l.revoked_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'store:asset_licensed';
    end if;
    select * into v_product from public.store_products p where p.id = old.product_id;
    v_found := found;
    if v_found and v_product.status = 'active'
       and not exists (
         select 1 from public.store_design_assets a
          where a.product_id = old.product_id and a.kind = old.kind and a.id <> old.id
       ) then
      raise exception using errcode = 'P0001', message = 'store:checklist_incomplete';
    end if;
    return old;
  end if;

  -- INSERT
  if v_bypass then
    return new;
  end if;
  select * into v_product from public.store_products p where p.id = new.product_id;
  if not found or v_product.kind <> 'design' then
    raise exception using errcode = 'P0001', message = 'store:forbidden';
  end if;
  if new.kind is null or new.kind not in ('original', 'stencil')
     or new.storage_path is null
     or new.storage_path like '%..%'
     or new.storage_path !~ ('^' || v_product.seller_id::text || '/' || v_product.id::text || '/' || new.kind || '/[^/]+$') then
    raise exception using errcode = 'P0001', message = 'store:invalid_image_path';
  end if;

  select o.metadata into v_meta
    from storage.objects o
   where o.bucket_id = 'store-design-files' and o.name = new.storage_path;
  if not found then
    raise exception using errcode = 'P0001', message = 'store:asset_missing';
  end if;

  -- Los metadatos del objeto mandan sobre lo que declara el cliente.
  new.mime_type := nullif(v_meta ->> 'mimetype', '');
  new.size_bytes := case when (v_meta ->> 'size') ~ '^[0-9]+$' then (v_meta ->> 'size')::bigint else null end;
  if new.kind = 'stencil'
     and coalesce(new.mime_type, '') not in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf') then
    raise exception using errcode = 'P0001', message = 'store:invalid_image_path';
  end if;

  -- Nombre de descarga (el servidor firma con download = file_name): sin
  -- barras, comillas ni caracteres de control o de dirección, y terminado en
  -- una extensión del MIME real (EXTENSION_MIME de store-model). Si no
  -- coincide, se le agrega la correcta: «x.png.exe» → «x.png.exe.png».
  v_exts := case new.mime_type
    when 'image/png' then array['png']
    when 'image/jpeg' then array['jpg', 'jpeg', 'jfif']
    when 'image/webp' then array['webp']
    when 'image/tiff' then array['tiff', 'tif']
    when 'application/pdf' then array['pdf']
    when 'image/vnd.adobe.photoshop' then array['psd', 'psb']
    when 'application/postscript' then array['eps', 'ai', 'ps']
    when 'application/zip' then array['zip', 'procreate']
  end;
  if v_exts is null then
    raise exception using errcode = 'P0001', message = 'store:invalid_image_path';
  end if;
  v_name := regexp_replace(coalesce(new.file_name, ''), '[[:cntrl:]/\\"‎‏‪-‮⁦-⁩]+', '-', 'g');
  v_name := regexp_replace(btrim(v_name), '^[.[:space:]-]+', '');
  if v_name = '' then
    v_name := new.kind;
  end if;
  v_ext := lower(coalesce(substring(v_name from '\.([A-Za-z0-9]+)$'), ''));
  if v_ext = any (v_exts) then
    v_name := left(left(v_name, char_length(v_name) - char_length(v_ext) - 1), 199 - char_length(v_ext)) || '.' || v_ext;
  else
    v_name := left(v_name, 199 - char_length(v_exts[1])) || '.' || v_exts[1];
  end if;
  new.file_name := v_name;
  new.created_at := now();
  return new;
end;
$$;

revoke all on function public.store_design_assets_guard() from public, anon, authenticated, service_role;

drop trigger if exists trg_store_design_assets_guard on public.store_design_assets;
create trigger trg_store_design_assets_guard
  before insert or update or delete on public.store_design_assets
  for each row execute function public.store_design_assets_guard();

create or replace function public.store_seller_settings_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_bypass boolean := current_user in ('postgres', 'supabase_admin', 'service_role')
    or coalesce((select auth.role()), '') = 'service_role';
begin
  new.updated_at := now();
  if v_bypass then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    -- La declaración de autoría se fecha en el servidor.
    if new.authorship_attested_at is not null then
      new.authorship_attested_at := now();
    end if;
  else
    if new.seller_type is distinct from old.seller_type or new.seller_id is distinct from old.seller_id then
      raise exception using errcode = 'P0001', message = 'store:forbidden';
    end if;
    new.created_at := old.created_at;
    if new.authorship_attested_at is not null then
      new.authorship_attested_at := coalesce(old.authorship_attested_at, now());
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.store_seller_settings_guard() from public, anon, authenticated, service_role;

drop trigger if exists trg_store_seller_settings_guard on public.store_seller_settings;
create trigger trg_store_seller_settings_guard
  before insert or update on public.store_seller_settings
  for each row execute function public.store_seller_settings_guard();

-- ===================== RPC del comprador =====================
create or replace function public.create_store_order(
  p_product_id uuid,
  p_variant_id uuid,
  p_quantity int,
  p_license_tier text,
  p_license_holder_name text,
  p_fulfillment_method text,
  p_shipping_address jsonb,
  p_buyer_note text,
  p_terms_version text,
  p_idempotency_key text
)
returns public.store_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_key text := nullif(left(btrim(coalesce(p_idempotency_key, '')), 80), '');
  v_order public.store_orders;
  v_old public.store_orders;
  v_product public.store_products;
  v_variant public.store_product_variants;
  v_settings public.store_seller_settings;
  v_email text;
  v_email_confirmed_at timestamptz;
  v_meta jsonb;
  v_is_artist boolean := false;
  v_artist_name text;
  v_client_name text;
  v_buyer_name text;
  v_buyer_role text;
  v_tier text;
  v_holder text;
  v_method text;
  v_qty integer;
  v_unit numeric(12,2);
  v_shipping numeric(12,2) := 0;
  v_subtotal numeric(12,2);
  v_total numeric(12,2);
  v_provider text;
  v_collector text;
  v_instructions text;
  v_fee_pct numeric := 0;
  v_fee numeric(12,2) := 0;
  v_expires timestamptz := now() + interval '24 hours';
  v_address jsonb;
  v_country text;
  v_pending_units integer;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'store:not_authenticated';
  end if;

  -- Serializa las compras del mismo comprador (idempotencia y límites).
  perform pg_advisory_xact_lock(hashtext('store_buyer'), hashtext(v_uid::text));

  -- 1. Idempotencia.
  if v_key is not null then
    select * into v_order
      from public.store_orders o
     where o.buyer_user_id = v_uid and o.idempotency_key = v_key and o.channel = 'online';
    if found then
      return v_order;
    end if;
  end if;

  -- 2. Comprador: email confirmado y términos vigentes.
  select u.email, u.email_confirmed_at, u.raw_user_meta_data
    into v_email, v_email_confirmed_at, v_meta
    from auth.users u
   where u.id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'store:not_authenticated';
  end if;
  if v_email_confirmed_at is null then
    raise exception using errcode = 'P0001', message = 'store:email_unconfirmed';
  end if;
  if p_terms_version is distinct from public.store_current_terms_version() then
    raise exception using errcode = 'P0001', message = 'store:terms_version_mismatch';
  end if;

  -- 3. Producto con lock.
  select * into v_product from public.store_products p where p.id = p_product_id for update;
  if not found or v_product.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'store:product_unavailable';
  end if;

  -- Reserva exclusiva vencida: se vence en esta transacción el pedido que la
  -- tenía (sin pago informado, o con el aviso vencido hace más de 7 días),
  -- con stock y reserva condicionados a su id.
  if v_product.reserved_order_id is not null and v_product.reserved_until < now() then
    select * into v_old from public.store_orders o where o.id = v_product.reserved_order_id for update;
    if not found or v_old.status <> 'pending_payment' then
      update public.store_products
         set reserved_order_id = null, reserved_until = null
       where id = v_product.id and reserved_order_id = v_product.reserved_order_id;
    elsif public.store_order_lapsed(v_old) then
      perform public.store_close_unpaid_order(v_old.id, 'expired', null);
    end if;
    select * into v_product from public.store_products p where p.id = p_product_id;
  end if;

  -- 4. Vendedor.
  if (v_product.seller_type = 'artist' and v_product.seller_id = v_uid)
     or (v_product.seller_type = 'studio' and exists (
       select 1 from public.studios s where s.id = v_product.seller_id and s.user_id = v_uid
     )) then
    raise exception using errcode = 'P0001', message = 'store:own_product';
  end if;

  -- Cobro (§2): proveedor y cobrador esperado.
  v_provider := coalesce(public.store_app_setting('store_payment_provider'), 'manual');
  if v_provider not in ('manual', 'stripe', 'mercado_pago') then
    v_provider := 'manual';
  end if;
  if v_product.seller_type = 'studio' then
    v_provider := 'manual';
    v_collector := 'seller';
  elsif v_provider <> 'manual' then
    v_collector := 'provider';
  elsif public.store_app_setting('store_manual_collector') = 'platform'
        and public.store_app_setting('store_platform_payment_instructions') is not null then
    v_collector := 'platform';
  else
    v_collector := 'seller';
  end if;

  select * into v_settings
    from public.store_seller_settings s
   where s.seller_type = v_product.seller_type and s.seller_id = v_product.seller_id;
  if not found
     or nullif(btrim(coalesce(v_settings.contact_channel, '')), '') is null
     or (v_collector = 'seller' and nullif(btrim(coalesce(v_settings.payment_instructions, '')), '') is null)
     or (v_product.seller_type = 'artist' and not public.store_seller_ready_artist(v_product.seller_id)) then
    raise exception using errcode = 'P0001', message = 'store:seller_not_ready';
  end if;

  -- 5. Límites anti-acaparamiento.
  if exists (
    select 1
      from public.store_orders o
      join public.store_order_items i on i.order_id = o.id
     where o.buyer_user_id = v_uid and o.status = 'pending_payment' and i.product_id = v_product.id
  ) then
    raise exception using errcode = 'P0001', message = 'store:pending_order_exists';
  end if;
  if (
    select count(*)
      from public.store_orders o
     where o.buyer_user_id = v_uid
       and o.status = 'pending_payment'
       and o.created_at > now() - interval '24 hours'
  ) >= 5 then
    raise exception using errcode = 'P0001', message = 'store:too_many_pending';
  end if;

  v_tier := nullif(lower(btrim(coalesce(p_license_tier, ''))), '');
  if v_product.kind = 'design' and v_tier = 'exclusive' then
    -- 1 reserva exclusiva activa por comprador.
    if exists (
      select 1
        from public.store_products p
        join public.store_orders o on o.id = p.reserved_order_id
       where o.buyer_user_id = v_uid and o.status = 'pending_payment'
    ) then
      raise exception using errcode = 'P0001', message = 'store:too_many_pending';
    end if;
    -- Cooldown de 7 días después de dejarlo vencer o cancelarlo.
    if exists (
      select 1
        from public.store_orders o
        join public.store_order_items i on i.order_id = o.id
       where o.buyer_user_id = v_uid
         and i.product_id = v_product.id
         and i.license_tier = 'exclusive'
         and o.status in ('expired', 'cancelled')
         and coalesce(o.cancelled_at, o.expires_at, o.updated_at) > now() - interval '7 days'
    ) then
      raise exception using errcode = 'P0001', message = 'store:exclusive_cooldown';
    end if;
  end if;

  -- Comprador: rol y nombre desde la base.
  select nullif(btrim(coalesce(a.name, a.username, '')), '') into v_artist_name
    from public.artists_db a
   where a.user_id = v_uid and a.registration_status is distinct from 'incompleto'
   limit 1;
  v_is_artist := found;
  select nullif(btrim(coalesce(c.full_name, '')), '') into v_client_name
    from public.clients_db c
   where c.user_id = v_uid
   limit 1;
  v_buyer_role := case when v_is_artist then 'artist' else 'client' end;
  v_buyer_name := left(coalesce(
    case when v_is_artist then v_artist_name end,
    v_client_name,
    nullif(btrim(coalesce(v_meta ->> 'full_name', '')), ''),
    nullif(btrim(coalesce(v_meta ->> 'name', '')), ''),
    nullif(split_part(coalesce(v_email, ''), '@', 1), ''),
    'Comprador'
  ), 120);

  if v_product.kind = 'design' then
    -- 6. Diseño.
    if v_tier is null or v_tier not in ('personal', 'artist', 'exclusive') then
      raise exception using errcode = 'P0001', message = 'store:tier_unavailable';
    end if;
    v_unit := case v_tier
      when 'personal' then v_product.license_personal_price
      when 'artist' then v_product.license_artist_price
      else v_product.license_exclusive_price
    end;
    if v_unit is null then
      raise exception using errcode = 'P0001', message = 'store:tier_unavailable';
    end if;
    if v_tier = 'artist' and not v_is_artist then
      raise exception using errcode = 'P0001', message = 'store:artist_tier_requires_artist';
    end if;
    if v_product.exclusive_sold_at is not null then
      raise exception using errcode = 'P0001', message = 'store:design_no_longer_available';
    end if;
    if v_product.reserved_order_id is not null then
      raise exception using errcode = 'P0001', message = 'store:product_reserved';
    end if;
    if v_tier = 'exclusive' and (
      v_product.licenses_issued > 0
      or exists (
        select 1
          from public.store_orders o
          join public.store_order_items i on i.order_id = o.id
         where i.product_id = v_product.id and o.status = 'pending_payment'
      )
    ) then
      raise exception using errcode = 'P0001', message = 'store:exclusive_unavailable';
    end if;
    if p_variant_id is not null then
      raise exception using errcode = 'P0001', message = 'store:variant_unavailable';
    end if;
    if coalesce(p_quantity, 1) <> 1 then
      raise exception using errcode = 'P0001', message = 'store:invalid_quantity';
    end if;
    v_qty := 1;
    v_method := 'digital';

    -- 7. Titular: 'artist' usa el nombre de artists_db; el resto, el indicado
    -- o el del comprador.
    if v_tier = 'artist' then
      v_holder := coalesce(v_artist_name, v_buyer_name);
    else
      v_holder := coalesce(nullif(btrim(coalesce(p_license_holder_name, '')), ''), v_buyer_name);
    end if;
    v_holder := left(v_holder, 120);
  else
    -- 8. Merch.
    if v_tier is not null then
      raise exception using errcode = 'P0001', message = 'store:tier_unavailable';
    end if;
    if p_variant_id is null then
      raise exception using errcode = 'P0001', message = 'store:variant_required';
    end if;
    select * into v_variant
      from public.store_product_variants v
     where v.id = p_variant_id and v.product_id = v_product.id
       for update;
    if not found or not v_variant.active then
      raise exception using errcode = 'P0001', message = 'store:variant_unavailable';
    end if;
    v_qty := coalesce(p_quantity, 1);
    if v_qty < 1 or v_qty > 20 then
      raise exception using errcode = 'P0001', message = 'store:invalid_quantity';
    end if;
    select coalesce(sum(i.quantity), 0)::integer into v_pending_units
      from public.store_order_items i
      join public.store_orders o on o.id = i.order_id
     where o.buyer_user_id = v_uid and o.status = 'pending_payment' and i.variant_id = v_variant.id;
    if v_pending_units + v_qty > 20 then
      raise exception using errcode = 'P0001', message = 'store:invalid_quantity';
    end if;
    if v_variant.stock is not null and v_variant.stock < v_qty then
      raise exception using errcode = 'P0001', message = 'store:out_of_stock';
    end if;

    v_method := lower(btrim(coalesce(p_fulfillment_method, '')));
    if v_method = 'pickup' then
      -- Sin dirección cargada no hay retiro: el pedido pagado quedaría sin
      -- pickup_details.
      if not v_product.pickup_available
         or nullif(btrim(coalesce(v_settings.pickup_address, '')), '') is null then
        raise exception using errcode = 'P0001', message = 'store:pickup_unavailable';
      end if;
    elsif v_method = 'shipping' then
      if p_shipping_address is null or jsonb_typeof(p_shipping_address) <> 'object' then
        raise exception using errcode = 'P0001', message = 'store:shipping_address_invalid';
      end if;
      v_country := upper(btrim(coalesce(p_shipping_address ->> 'country', '')));
      if nullif(btrim(coalesce(p_shipping_address ->> 'recipient', '')), '') is null
         or nullif(btrim(coalesce(p_shipping_address ->> 'line1', '')), '') is null
         or nullif(btrim(coalesce(p_shipping_address ->> 'city', '')), '') is null
         or v_country !~ '^[A-Z]{2}$' then
        raise exception using errcode = 'P0001', message = 'store:shipping_address_invalid';
      end if;
      -- Sin precio de envío el producto no se despacha (solo retiro).
      if v_product.shipping_price_amount is null
         or (cardinality(v_product.ships_to_countries) > 0 and not (v_country = any (v_product.ships_to_countries))) then
        raise exception using errcode = 'P0001', message = 'store:ships_to_unsupported';
      end if;
      v_address := jsonb_build_object(
        'recipient', left(btrim(p_shipping_address ->> 'recipient'), 120),
        'line1', left(btrim(p_shipping_address ->> 'line1'), 200),
        'line2', nullif(left(btrim(coalesce(p_shipping_address ->> 'line2', '')), 200), ''),
        'city', left(btrim(p_shipping_address ->> 'city'), 120),
        'region', nullif(left(btrim(coalesce(p_shipping_address ->> 'region', '')), 120), ''),
        'postal_code', nullif(left(btrim(coalesce(p_shipping_address ->> 'postal_code', '')), 20), ''),
        'country', v_country,
        'phone', nullif(left(btrim(coalesce(p_shipping_address ->> 'phone', '')), 40), '')
      );
      v_shipping := v_product.shipping_price_amount;
    else
      raise exception using errcode = 'P0001', message = 'store:shipping_address_invalid';
    end if;

    v_unit := coalesce(v_variant.price_amount, v_product.price_amount);
    if v_unit is null then
      raise exception using errcode = 'P0001', message = 'store:product_unavailable';
    end if;

    -- El stock se descuenta acá (se restituye al cancelar o vencer).
    if v_variant.stock is not null then
      update public.store_product_variants
         set stock = stock - v_qty
       where id = v_variant.id and stock >= v_qty;
      if not found then
        raise exception using errcode = 'P0001', message = 'store:out_of_stock';
      end if;
    end if;
  end if;

  -- 9. Precios desde la base.
  v_subtotal := round(v_unit * v_qty, 2);
  v_total := v_subtotal + v_shipping;

  -- 10. Cobro: instrucciones, contacto y comisión (0 si cobra el vendedor).
  v_instructions := case v_collector
    when 'seller' then v_settings.payment_instructions
    when 'platform' then public.store_app_setting('store_platform_payment_instructions')
    else null
  end;
  if v_collector <> 'seller' then
    v_fee_pct := public.store_platform_fee_pct();
  end if;
  v_fee := round(v_total * v_fee_pct / 100, 2);

  -- 11. Pedido con vencimiento a 24 h.
  insert into public.store_orders (
    order_number, seller_type, seller_id, channel,
    buyer_user_id, buyer_role, buyer_name, buyer_email,
    status, fulfillment_method, fulfillment_status, shipping_address,
    currency, subtotal_amount, shipping_amount, total_amount,
    platform_fee_pct, platform_fee_amount,
    payment_provider, expected_collector, payment_instructions, seller_contact,
    expires_at, buyer_note, idempotency_key
  ) values (
    public.store_new_order_number(), v_product.seller_type, v_product.seller_id, 'online',
    v_uid, v_buyer_role, v_buyer_name, v_email,
    'pending_payment', v_method, 'unfulfilled', v_address,
    v_product.currency, v_subtotal, v_shipping, v_total,
    v_fee_pct, v_fee,
    v_provider, v_collector, left(v_instructions, 4000), left(v_settings.contact_channel, 200),
    v_expires, nullif(left(btrim(coalesce(p_buyer_note, '')), 1000), ''), v_key
  )
  returning * into v_order;

  insert into public.store_order_items (
    order_id, product_id, variant_id, kind, title, variant_label, image_path,
    license_tier, license_holder_name, terms_version, terms_accepted_at,
    unit_price, quantity, line_total
  ) values (
    v_order.id, v_product.id, v_variant.id, v_product.kind, left(v_product.title, 120), v_variant.label,
    v_product.images -> 0 ->> 'path',
    v_tier, v_holder, p_terms_version, now(),
    v_unit, v_qty, v_subtotal
  );

  if v_tier = 'exclusive' then
    update public.store_products
       set reserved_order_id = v_order.id,
           reserved_until = v_expires
     where id = v_product.id and reserved_order_id is null;
    if not found then
      raise exception using errcode = 'P0001', message = 'store:product_reserved';
    end if;
  end if;

  return v_order;
end;
$$;

revoke all on function public.create_store_order(uuid, uuid, integer, text, text, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.create_store_order(uuid, uuid, integer, text, text, text, jsonb, text, text, text) to authenticated;

-- El comprador informa el pago: extiende el vencimiento (y la reserva) a 7 días
-- una sola vez.
create or replace function public.report_store_payment(p_order_id uuid, p_reference text)
returns public.store_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.store_orders;
  v_ref text := nullif(left(btrim(coalesce(p_reference, '')), 200), '');
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'store:not_authenticated';
  end if;
  v_order := public.store_lock_order(p_order_id);
  if v_order.id is null or v_order.buyer_user_id is distinct from v_uid then
    raise exception using errcode = 'P0001', message = 'store:not_found';
  end if;
  if v_order.expected_collector = 'provider' then
    raise exception using errcode = 'P0001', message = 'store:collector_mismatch';
  end if;
  if v_order.status <> 'pending_payment' or v_order.expires_at < now() then
    raise exception using errcode = 'P0001', message = 'store:order_not_payable';
  end if;

  update public.store_orders
     set buyer_payment_reference = coalesce(v_ref, buyer_payment_reference),
         buyer_payment_reported_at = coalesce(buyer_payment_reported_at, now()),
         expires_at = case
           when buyer_payment_reported_at is null then greatest(expires_at, now() + interval '7 days')
           else expires_at
         end
   where id = v_order.id
     and status = 'pending_payment'
  returning * into v_order;
  if not found then
    raise exception using errcode = 'P0001', message = 'store:invalid_status';
  end if;

  update public.store_products p
     set reserved_until = v_order.expires_at
   where p.id in (select i.product_id from public.store_order_items i where i.order_id = v_order.id)
     and p.reserved_order_id = v_order.id;

  return v_order;
end;
$$;

revoke all on function public.report_store_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.report_store_payment(uuid, text) to authenticated;

-- Merch enviado o listo para retirar → entregado por el comprador.
create or replace function public.confirm_store_order_received(p_order_id uuid)
returns public.store_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.store_orders;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'store:not_authenticated';
  end if;
  v_order := public.store_lock_order(p_order_id);
  if v_order.id is null or v_order.buyer_user_id is distinct from v_uid then
    raise exception using errcode = 'P0001', message = 'store:not_found';
  end if;
  if v_order.status <> 'paid'
     or v_order.fulfillment_method not in ('shipping', 'pickup')
     or v_order.fulfillment_status not in ('shipped', 'ready_for_pickup') then
    raise exception using errcode = 'P0001', message = 'store:invalid_status';
  end if;
  return public.store_finish_delivery(v_order.id, 'buyer');
end;
$$;

revoke all on function public.confirm_store_order_received(uuid) from public, anon, authenticated;
grant execute on function public.confirm_store_order_received(uuid) to authenticated;

-- Uso único controlado: solo el titular, sin uso previo y no revocada.
create or replace function public.mark_store_license_used(p_license_id uuid, p_note text)
returns public.store_licenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_license public.store_licenses;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'store:not_authenticated';
  end if;
  select * into v_license from public.store_licenses l where l.id = p_license_id for update;
  if not found or v_license.holder_user_id is distinct from v_uid then
    raise exception using errcode = 'P0001', message = 'store:not_found';
  end if;
  if v_license.revoked_at is not null then
    raise exception using errcode = 'P0001', message = 'store:license_revoked';
  end if;
  if v_license.used_at is not null then
    raise exception using errcode = 'P0001', message = 'store:license_used';
  end if;

  update public.store_licenses
     set used_at = now(),
         used_note = nullif(left(btrim(coalesce(p_note, '')), 160), '')
   where id = v_license.id
     and used_at is null
     and revoked_at is null
  returning * into v_license;
  if not found then
    raise exception using errcode = 'P0001', message = 'store:license_used';
  end if;
  return v_license;
end;
$$;

revoke all on function public.mark_store_license_used(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_store_license_used(uuid, text) to authenticated;

-- ===================== comprador, vendedor o soporte =====================
create or replace function public.cancel_store_order(p_order_id uuid, p_reason text)
returns public.store_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_support boolean;
  v_seller boolean;
  v_order public.store_orders;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'store:not_authenticated';
  end if;
  v_order := public.store_lock_order(p_order_id);
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'store:not_found';
  end if;
  v_support := coalesce(public.is_support_user(), false);
  v_seller := coalesce(public.store_can_manage_seller(v_order.seller_type, v_order.seller_id), false);
  if not (v_order.buyer_user_id is not distinct from v_uid or v_seller or v_support) then
    raise exception using errcode = 'P0001', message = 'store:not_found';
  end if;
  if v_order.status <> 'pending_payment' then
    raise exception using errcode = 'P0001', message = 'store:invalid_status';
  end if;
  -- Con un pago informado cancela soporte. También el vendedor que cobra
  -- directo, cuando venció el plazo del aviso sin recibir el pago: si no, un
  -- aviso falso retiene la exclusiva o el stock hasta que intervenga soporte.
  if v_order.buyer_payment_reported_at is not null and not v_support
     and not (v_seller and v_order.expected_collector = 'seller' and v_order.expires_at < now()) then
    raise exception using errcode = 'P0001', message = 'store:payment_reported';
  end if;
  if not public.store_close_unpaid_order(v_order.id, 'cancelled', p_reason) then
    raise exception using errcode = 'P0001', message = 'store:invalid_status';
  end if;
  -- El cierre resuelve la marca de soporte (pago informado y vencido).
  update public.store_orders
     set metadata_json = (metadata_json - 'needs_support') || jsonb_build_object('needs_support_resolved_at', now())
   where id = v_order.id
     and metadata_json ? 'needs_support';
  select * into v_order from public.store_orders o where o.id = p_order_id;
  return v_order;
end;
$$;

revoke all on function public.cancel_store_order(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_store_order(uuid, text) to authenticated;

-- ===================== confirmación de pago (helper interno) =====================
-- Lo comparten confirm_store_order_payment (vendedor/soporte) y
-- confirm_store_order_payment_as_provider (webhook). Sin grants.
create or replace function public.store_apply_order_payment(
  p_order_id uuid,
  p_collected_by text,
  p_provider text,
  p_reference text,
  p_note text,
  p_amount numeric,
  p_currency text,
  p_actor uuid,
  p_is_support boolean
)
returns public.store_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.store_orders;
  v_item public.store_order_items;
  v_product public.store_products;
  v_settings public.store_seller_settings;
  v_ref text := nullif(left(btrim(coalesce(p_reference, '')), 200), '');
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  v_other uuid;
  v_seller_name text;
  v_seller_username text;
begin
  -- Locks producto → pedido y re-chequeo del estado.
  v_order := public.store_lock_order(p_order_id);
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'store:not_found';
  end if;
  if p_collected_by is distinct from v_order.expected_collector then
    raise exception using errcode = 'P0001', message = 'store:collector_mismatch';
  end if;

  select * into v_item
    from public.store_order_items i
   where i.order_id = v_order.id
   order by i.created_at
   limit 1;
  if not found then
    raise exception using errcode = 'P0001', message = 'store:not_found';
  end if;
  if v_item.product_id is not null then
    select * into v_product from public.store_products p where p.id = v_item.product_id;
  end if;

  -- Ya pagado: misma referencia → sin cambios; otra → duplicado para soporte.
  if v_order.paid_at is not null then
    if exists (
      select 1 from public.store_payments sp
       where sp.order_id = v_order.id
         and sp.status in ('succeeded', 'duplicate')
         and sp.reference is not distinct from v_ref
    ) then
      return v_order;
    end if;
    if v_ref is not null and p_provider <> 'manual' and exists (
      select 1 from public.store_payments sp where sp.provider = p_provider and sp.reference = v_ref
    ) then
      return v_order;
    end if;
    insert into public.store_payments (order_id, provider, status, amount, currency, collected_by, reference, note, confirmed_by)
    values (v_order.id, p_provider, 'duplicate', coalesce(p_amount, v_order.total_amount),
            coalesce(upper(p_currency), v_order.currency), p_collected_by, v_ref, v_note, p_actor);
    update public.store_orders
       set metadata_json = metadata_json || jsonb_build_object(
             'needs_support', true, 'needs_support_reason', 'duplicate_payment', 'needs_support_at', now())
     where id = v_order.id
    returning * into v_order;
    return v_order;
  end if;

  if v_order.status = 'pending_payment' then
    -- Vencido sin pago informado: no se acepta (el proveedor sí: el cobro es real).
    if v_order.expires_at < now() and v_order.buyer_payment_reported_at is null and p_collected_by <> 'provider' then
      raise exception using errcode = 'P0001', message = 'store:order_not_payable';
    end if;
  elsif v_order.status = 'expired' then
    -- Soporte reabre si recupera stock y reserva con lock. El proveedor
    -- también: un webhook tardío trae un cobro real (si no se puede reabrir,
    -- cannot_reopen y el servidor tiene que avisar a soporte).
    if not (coalesce(p_is_support, false) or p_collected_by = 'provider') then
      raise exception using errcode = 'P0001', message = 'store:order_not_payable';
    end if;
    if v_item.kind = 'merch' then
      if v_item.variant_id is null then
        raise exception using errcode = 'P0001', message = 'store:cannot_reopen';
      end if;
      update public.store_product_variants v
         set stock = v.stock - v_item.quantity
       where v.id = v_item.variant_id
         and (v.stock is null or v.stock >= v_item.quantity);
      if not found then
        raise exception using errcode = 'P0001', message = 'store:cannot_reopen';
      end if;
    else
      if v_product.id is null
         or v_product.exclusive_sold_at is not null
         or (v_product.reserved_order_id is not null and v_product.reserved_order_id <> v_order.id) then
        raise exception using errcode = 'P0001', message = 'store:cannot_reopen';
      end if;
      if v_item.license_tier = 'exclusive' then
        if v_product.licenses_issued > 0 or exists (
          select 1
            from public.store_orders o
            join public.store_order_items i on i.order_id = o.id
           where i.product_id = v_product.id and o.status = 'pending_payment' and o.id <> v_order.id
        ) then
          raise exception using errcode = 'P0001', message = 'store:cannot_reopen';
        end if;
        update public.store_products
           set reserved_order_id = v_order.id,
               reserved_until = now() + interval '24 hours'
         where id = v_product.id
           and (reserved_order_id is null or reserved_order_id = v_order.id);
        if not found then
          raise exception using errcode = 'P0001', message = 'store:cannot_reopen';
        end if;
        select * into v_product from public.store_products p where p.id = v_item.product_id;
      end if;
    end if;
    update public.store_orders
       set status = 'pending_payment',
           metadata_json = metadata_json || jsonb_build_object('reopened_at', now())
     where id = v_order.id and status = 'expired'
    returning * into v_order;
    if not found then
      raise exception using errcode = 'P0001', message = 'store:invalid_status';
    end if;
    -- Quién reabrió queda para soporte (metadata_json lo ven comprador y vendedor).
    insert into public.store_order_support_notes (order_id, kind, note, actor_id)
    values (v_order.id, 'reopen', case when p_collected_by = 'provider' then 'Webhook de ' || p_provider end, p_actor);
  else
    raise exception using errcode = 'P0001', message = 'store:order_not_payable';
  end if;

  -- Diseño: el exclusivo exige su reserva; el resto, que no se haya vendido la exclusiva.
  if v_item.kind = 'design' then
    if v_product.id is null then
      raise exception using errcode = 'P0001', message = 'store:design_no_longer_available';
    end if;
    if v_item.license_tier = 'exclusive' then
      if v_product.reserved_order_id is distinct from v_order.id
         or v_product.exclusive_sold_at is not null
         or v_product.licenses_issued > 0 then
        raise exception using errcode = 'P0001', message = 'store:design_no_longer_available';
      end if;
    elsif v_product.exclusive_sold_at is not null then
      raise exception using errcode = 'P0001', message = 'store:design_no_longer_available';
    end if;
  end if;

  insert into public.store_payments (order_id, provider, status, amount, currency, collected_by, reference, note, confirmed_by)
  values (v_order.id, p_provider, 'succeeded', coalesce(p_amount, v_order.total_amount), v_order.currency,
          p_collected_by, v_ref, v_note, p_actor);

  if v_item.kind = 'design' then
    if v_order.seller_type = 'artist' then
      select a.name, a.username into v_seller_name, v_seller_username
        from public.artists_db a
       where a.user_id = v_order.seller_id
       limit 1;
    else
      select s.name into v_seller_name from public.studios s where s.id = v_order.seller_id limit 1;
    end if;

    insert into public.store_licenses (
      order_id, order_item_id, product_id, tier, holder_user_id, holder_name,
      seller_type, seller_id, seller_display_name, seller_username,
      design_title, terms_version, verification_code
    ) values (
      v_order.id, v_item.id, v_product.id, v_item.license_tier, v_order.buyer_user_id,
      left(coalesce(nullif(btrim(coalesce(v_item.license_holder_name, '')), ''), v_order.buyer_name), 120),
      v_order.seller_type, v_order.seller_id,
      left(coalesce(nullif(btrim(coalesce(v_seller_name, '')), ''), v_seller_username), 120), v_seller_username,
      v_item.title, coalesce(v_item.terms_version, public.store_current_terms_version()),
      public.store_new_license_code()
    );

    update public.store_products
       set licenses_issued = licenses_issued + 1,
           sales_count = sales_count + v_item.quantity
     where id = v_product.id;

    if v_item.license_tier = 'exclusive' then
      update public.store_products
         set status = 'retired',
             retired_at = coalesce(retired_at, now()),
             exclusive_sold_at = now(),
             reserved_order_id = null,
             reserved_until = null
       where id = v_product.id
         and reserved_order_id = v_order.id;
      if not found then
        raise exception using errcode = 'P0001', message = 'store:design_no_longer_available';
      end if;
      -- Los demás pendientes del producto se cancelan restituyendo stock.
      for v_other in
        select o.id
          from public.store_orders o
          join public.store_order_items i on i.order_id = o.id
         where i.product_id = v_product.id
           and o.status = 'pending_payment'
           and o.id <> v_order.id
           for update of o
      loop
        perform public.store_close_unpaid_order(v_other, 'cancelled', 'exclusive_sold');
      end loop;
    end if;

    -- Digital: se completa en el acto. Confirmar resuelve la marca de soporte
    -- (pago informado y vencido).
    update public.store_orders
       set status = 'fulfilled',
           fulfillment_status = 'delivered',
           delivered_at = now(),
           delivered_by = 'auto',
           paid_at = now(),
           payment_collected_by = p_collected_by,
           payment_confirmed_by = p_actor,
           metadata_json = case
             when metadata_json ? 'needs_support'
               then (metadata_json - 'needs_support') || jsonb_build_object('needs_support_resolved_at', now())
             else metadata_json
           end
     where id = v_order.id
       and status = 'pending_payment'
    returning * into v_order;
    if not found then
      raise exception using errcode = 'P0001', message = 'store:invalid_status';
    end if;
    if public.store_order_uses_wallet(v_order) then
      update public.store_orders
         set funds_release_at = now() + interval '72 hours'
       where id = v_order.id
      returning * into v_order;
    end if;
  else
    if v_item.product_id is not null then
      update public.store_products
         set sales_count = sales_count + v_item.quantity
       where id = v_item.product_id;
    end if;
    select * into v_settings
      from public.store_seller_settings s
     where s.seller_type = v_order.seller_type and s.seller_id = v_order.seller_id;
    -- Merch: pagado; los fondos esperan a la entrega (funds_release_at null).
    update public.store_orders
       set status = 'paid',
           paid_at = now(),
           payment_collected_by = p_collected_by,
           payment_confirmed_by = p_actor,
           pickup_details = case
             when fulfillment_method = 'pickup'
               then nullif(left(btrim(coalesce(v_settings.pickup_address, '')), 300), '')
             else pickup_details
           end,
           metadata_json = case
             when metadata_json ? 'needs_support'
               then (metadata_json - 'needs_support') || jsonb_build_object('needs_support_resolved_at', now())
             else metadata_json
           end
     where id = v_order.id
       and status = 'pending_payment'
    returning * into v_order;
    if not found then
      raise exception using errcode = 'P0001', message = 'store:invalid_status';
    end if;
  end if;

  -- Wallet (solo con el predicado): payment retenido, awaiting_release
  -- (digital, release_at = +72 h) o pending_service (merch).
  if public.store_order_uses_wallet(v_order) then
    if to_regclass('public.artist_wallet_movements') is not null then
      perform public.store_wallet_upsert_payment(v_order);
    end if;
  end if;

  return v_order;
end;
$$;

revoke all on function public.store_apply_order_payment(uuid, text, text, text, text, numeric, text, uuid, boolean) from public, anon, authenticated, service_role;

-- ===================== vendedor o soporte =====================
create or replace function public.confirm_store_order_payment(
  p_order_id uuid,
  p_collected_by text,
  p_reference text,
  p_note text
)
returns public.store_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_support boolean;
  v_seller boolean;
  v_order public.store_orders;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'store:not_authenticated';
  end if;
  select * into v_order from public.store_orders o where o.id = p_order_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'store:not_found';
  end if;
  v_support := coalesce(public.is_support_user(), false);
  v_seller := coalesce(public.store_can_manage_seller(v_order.seller_type, v_order.seller_id), false);
  if not (v_seller or v_support) then
    raise exception using errcode = 'P0001', message = 'store:forbidden';
  end if;
  if p_collected_by is distinct from v_order.expected_collector then
    raise exception using errcode = 'P0001', message = 'store:collector_mismatch';
  end if;
  -- seller: vendedor o soporte · platform: solo soporte · provider: solo el webhook.
  if p_collected_by = 'provider' or (p_collected_by = 'platform' and not v_support) then
    raise exception using errcode = 'P0001', message = 'store:forbidden';
  end if;
  return public.store_apply_order_payment(
    p_order_id, p_collected_by, v_order.payment_provider, p_reference, p_note,
    null, null, v_uid, v_support
  );
end;
$$;

revoke all on function public.confirm_store_order_payment(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.confirm_store_order_payment(uuid, text, text, text) to authenticated;

-- Envío del merch, siempre hacia adelante. delivered: comprador, soporte o
-- mantenimiento; el vendedor solo si el pedido no usa wallet.
create or replace function public.update_store_order_fulfillment(
  p_order_id uuid,
  p_status text,
  p_tracking_carrier text,
  p_tracking_code text,
  p_tracking_url text,
  p_seller_message text
)
returns public.store_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_support boolean;
  v_seller boolean;
  v_wallet boolean;
  v_order public.store_orders;
  v_from text;
  v_to text := lower(btrim(coalesce(p_status, '')));
  v_rank_from integer;
  v_rank_to integer;
  v_carrier text := nullif(left(btrim(coalesce(p_tracking_carrier, '')), 60), '');
  v_code text := nullif(left(btrim(coalesce(p_tracking_code, '')), 80), '');
  v_url text := nullif(btrim(coalesce(p_tracking_url, '')), '');
  v_message text := nullif(left(btrim(coalesce(p_seller_message, '')), 1000), '');
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'store:not_authenticated';
  end if;
  v_order := public.store_lock_order(p_order_id);
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'store:not_found';
  end if;
  v_support := coalesce(public.is_support_user(), false);
  v_seller := coalesce(public.store_can_manage_seller(v_order.seller_type, v_order.seller_id), false);
  if not (v_seller or v_support) then
    raise exception using errcode = 'P0001', message = 'store:forbidden';
  end if;
  if v_order.status <> 'paid' or v_order.fulfillment_method = 'digital' then
    raise exception using errcode = 'P0001', message = 'store:invalid_status';
  end if;
  if v_url is not null and (v_url !~ '^https://\S+$' or char_length(v_url) > 500) then
    raise exception using errcode = 'P0001', message = 'store:invalid_tracking_url';
  end if;

  v_from := v_order.fulfillment_status;
  v_rank_from := case v_from
    when 'unfulfilled' then 0 when 'preparing' then 1
    when 'shipped' then 2 when 'ready_for_pickup' then 2 when 'delivered' then 3
  end;
  v_rank_to := case v_to
    when 'unfulfilled' then 0 when 'preparing' then 1
    when 'shipped' then 2 when 'ready_for_pickup' then 2 when 'delivered' then 3
  end;
  if v_rank_to is null or v_rank_from is null or v_from = 'delivered'
     or v_rank_to < v_rank_from
     or (v_rank_to = v_rank_from and v_to <> v_from)
     or (v_to = v_from and v_to = 'unfulfilled')
     or (v_order.fulfillment_method = 'shipping' and v_to = 'ready_for_pickup')
     or (v_order.fulfillment_method = 'pickup' and v_to = 'shipped') then
    raise exception using errcode = 'P0001', message = 'store:invalid_status';
  end if;

  v_wallet := public.store_order_uses_wallet(v_order);
  if v_to = 'delivered' and v_wallet and not v_support then
    raise exception using errcode = 'P0001', message = 'store:forbidden';
  end if;
  if v_to = 'shipped' and v_wallet
     and coalesce(v_code, v_order.tracking_code, v_url, v_order.tracking_url) is null then
    raise exception using errcode = 'P0001', message = 'store:tracking_required';
  end if;

  update public.store_orders
     set fulfillment_status = case when v_to = 'delivered' then fulfillment_status else v_to end,
         tracking_carrier = coalesce(v_carrier, tracking_carrier),
         tracking_code = coalesce(v_code, tracking_code),
         tracking_url = coalesce(v_url, tracking_url),
         seller_message = coalesce(v_message, seller_message),
         shipped_at = case when v_to = 'shipped' then coalesce(shipped_at, now()) else shipped_at end,
         ready_at = case when v_to = 'ready_for_pickup' then coalesce(ready_at, now()) else ready_at end
   where id = v_order.id
     and status = 'paid'
     and fulfillment_status = v_from
  returning * into v_order;
  if not found then
    raise exception using errcode = 'P0001', message = 'store:invalid_status';
  end if;

  if v_to = 'delivered' then
    v_order := public.store_finish_delivery(
      v_order.id,
      case when v_seller and not v_wallet then 'seller' else 'support' end
    );
  end if;

  return v_order;
end;
$$;

revoke all on function public.update_store_order_fulfillment(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.update_store_order_fulfillment(uuid, text, text, text, text, text) to authenticated;

-- Reembolso: soporte siempre; el vendedor solo si cobró él y no despachó.
create or replace function public.refund_store_order(p_order_id uuid, p_reason text)
returns public.store_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_support boolean;
  v_seller boolean;
  v_wallet boolean;
  v_dispatched boolean;
  v_order public.store_orders;
  v_item public.store_order_items;
  v_product public.store_products;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 300), '');
  v_release_amount numeric;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'store:not_authenticated';
  end if;
  v_order := public.store_lock_order(p_order_id);
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'store:not_found';
  end if;
  v_support := coalesce(public.is_support_user(), false);
  v_seller := coalesce(public.store_can_manage_seller(v_order.seller_type, v_order.seller_id), false);
  if not (v_seller or v_support) then
    raise exception using errcode = 'P0001', message = 'store:forbidden';
  end if;
  if v_order.status not in ('paid', 'fulfilled') then
    raise exception using errcode = 'P0001', message = 'store:invalid_status';
  end if;
  if not v_support then
    if v_order.payment_collected_by is distinct from 'seller' then
      raise exception using errcode = 'P0001', message = 'store:forbidden';
    end if;
    if v_order.fulfillment_method <> 'digital' and v_order.fulfillment_status not in ('unfulfilled', 'preparing') then
      raise exception using errcode = 'P0001', message = 'store:invalid_status';
    end if;
  end if;

  select * into v_item
    from public.store_order_items i
   where i.order_id = v_order.id
   order by i.created_at
   limit 1;
  v_dispatched := v_order.fulfillment_method <> 'digital'
    and v_order.fulfillment_status in ('shipped', 'delivered');
  v_wallet := public.store_order_uses_wallet(v_order);

  -- El motivo lo ven comprador y vendedor (también va en revoke_reason); quién
  -- reembolsó queda en las notas de soporte. Si reembolsa soporte, resuelve la
  -- marca needs_support; si reembolsa el vendedor, la marca (pago duplicado)
  -- sigue a la vista de soporte.
  update public.store_orders
     set status = 'refunded',
         refunded_at = now(),
         metadata_json = case
           when v_support and metadata_json ? 'needs_support'
             then (metadata_json - 'needs_support')
               || jsonb_build_object('refund_reason', v_reason, 'needs_support_resolved_at', now())
           else metadata_json || jsonb_build_object('refund_reason', v_reason)
         end
   where id = v_order.id
     and status in ('paid', 'fulfilled')
  returning * into v_order;
  if not found then
    raise exception using errcode = 'P0001', message = 'store:invalid_status';
  end if;
  insert into public.store_order_support_notes (order_id, kind, note, actor_id)
  values (v_order.id, 'refund', v_reason, v_uid);

  update public.store_licenses
     set revoked_at = now(),
         revoke_reason = coalesce(v_reason, 'Reembolso')
   where order_id = v_order.id
     and revoked_at is null;

  if v_item.product_id is not null then
    select * into v_product from public.store_products p where p.id = v_item.product_id;
    update public.store_products
       set sales_count = greatest(sales_count - v_item.quantity, 0)
     where id = v_item.product_id;
    if v_item.kind = 'merch' and not v_dispatched and v_item.variant_id is not null then
      update public.store_product_variants
         set stock = stock + v_item.quantity
       where id = v_item.variant_id
         and stock is not null;
    end if;
    if v_item.kind = 'design' then
      update public.store_products p
         set licenses_issued = (
           select count(*)::integer from public.store_licenses l
            where l.product_id = p.id and l.revoked_at is null
         )
       where p.id = v_item.product_id;
      -- Exclusivo reembolsado: vuelve a estar disponible, pausado.
      if v_item.license_tier = 'exclusive' and v_product.exclusive_sold_at is not null then
        update public.store_products
           set exclusive_sold_at = null,
               status = 'paused',
               retired_at = null
         where id = v_item.product_id;
      end if;
    end if;
  end if;

  -- Wallet (solo con el predicado).
  if v_wallet then
    if to_regclass('public.artist_wallet_movements') is not null then
      if v_order.funds_released_at is null then
        execute format($q$
          update public.artist_wallet_movements
             set status = 'cancelled'
           where artist_user_id = $1 and external_reference = $2
             and status in ('pending_service', 'awaiting_release', 'blocked')
        $q$)
        using v_order.seller_id, 'store:' || v_order.id::text || ':payment';
      else
        execute format($q$
          select amount from public.artist_wallet_movements
           where artist_user_id = $1 and external_reference = $2
        $q$)
        into v_release_amount
        using v_order.seller_id, 'store:' || v_order.id::text || ':release';
        perform public.store_wallet_insert(
          v_order, 'refund', coalesce(v_release_amount, v_order.total_amount), 'refund',
          'Reembolso · Pedido #' || v_order.order_number
        );
        if v_order.platform_fee_amount > 0 then
          perform public.store_wallet_insert(
            v_order, 'adjustment', v_order.platform_fee_amount, 'fee_reversal',
            'Reverso de comisión · Pedido #' || v_order.order_number
          );
        end if;
      end if;
    end if;
  end if;

  insert into public.store_payments (order_id, provider, status, amount, currency, collected_by, reference, note, confirmed_by)
  values (v_order.id, v_order.payment_provider, 'refunded', v_order.total_amount, v_order.currency,
          v_order.payment_collected_by, null, v_reason, v_uid);

  return v_order;
end;
$$;

revoke all on function public.refund_store_order(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_store_order(uuid, text) to authenticated;

-- Stock con concurrencia optimista (lockea el producto).
create or replace function public.adjust_store_variant_stock(
  p_variant_id uuid,
  p_new_stock int,
  p_expected_stock int
)
returns public.store_product_variants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_product_id uuid;
  v_product public.store_products;
  v_variant public.store_product_variants;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'store:not_authenticated';
  end if;
  select v.product_id into v_product_id from public.store_product_variants v where v.id = p_variant_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'store:not_found';
  end if;
  select * into v_product from public.store_products p where p.id = v_product_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'store:not_found';
  end if;
  if not (
    coalesce(public.store_can_manage_seller(v_product.seller_type, v_product.seller_id), false)
    or coalesce(public.is_support_user(), false)
  ) then
    raise exception using errcode = 'P0001', message = 'store:forbidden';
  end if;
  select * into v_variant from public.store_product_variants v where v.id = p_variant_id for update;
  if v_variant.stock is distinct from p_expected_stock then
    raise exception using errcode = 'P0001', message = 'store:stock_changed';
  end if;
  if p_new_stock is not null and p_new_stock < 0 then
    raise exception using errcode = 'P0001', message = 'store:invalid_quantity';
  end if;
  update public.store_product_variants
     set stock = p_new_stock
   where id = v_variant.id
     and stock is not distinct from p_expected_stock
  returning * into v_variant;
  if not found then
    raise exception using errcode = 'P0001', message = 'store:stock_changed';
  end if;
  return v_variant;
end;
$$;

revoke all on function public.adjust_store_variant_stock(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.adjust_store_variant_stock(uuid, integer, integer) to authenticated;

-- Ventas por producto, mes y moneda (solo pedidos paid o fulfilled).
create or replace function public.get_store_sales_report(
  p_seller_type text,
  p_seller_id uuid,
  p_from date,
  p_to date
)
returns table (
  product_id uuid,
  title text,
  kind text,
  month date,
  currency text,
  units bigint,
  gross_amount numeric,
  orders bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'store:not_authenticated';
  end if;
  if not (
    coalesce(public.store_can_manage_seller(p_seller_type, p_seller_id), false)
    or coalesce(public.is_support_user(), false)
  ) then
    raise exception using errcode = 'P0001', message = 'store:forbidden';
  end if;

  return query
  select i.product_id,
         (array_agg(i.title order by o.paid_at desc))[1],
         (array_agg(i.kind order by o.paid_at desc))[1],
         date_trunc('month', o.paid_at)::date,
         o.currency,
         sum(i.quantity)::bigint,
         sum(i.line_total)::numeric,
         count(distinct o.id)::bigint
    from public.store_orders o
    join public.store_order_items i on i.order_id = o.id
   where o.seller_type = p_seller_type
     and o.seller_id = p_seller_id
     and o.status in ('paid', 'fulfilled')
     and o.paid_at is not null
     and (p_from is null or o.paid_at >= p_from::timestamptz)
     and (p_to is null or o.paid_at < (p_to + 1)::timestamptz)
   group by 1, 4, 5
   order by 4 desc, 7 desc;
end;
$$;

revoke all on function public.get_store_sales_report(text, uuid, date, date) from public, anon, authenticated;
grant execute on function public.get_store_sales_report(text, uuid, date, date) to authenticated;

-- ===================== soporte =====================
create or replace function public.set_store_order_funds_hold(p_order_id uuid, p_hold boolean, p_note text)
returns public.store_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.store_orders;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'store:not_authenticated';
  end if;
  if not coalesce(public.is_support_user(), false) then
    raise exception using errcode = 'P0001', message = 'store:forbidden';
  end if;
  v_order := public.store_lock_order(p_order_id);
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'store:not_found';
  end if;

  -- La nota y el autor son internos: van a store_order_support_notes. En el
  -- pedido (lo ven comprador y vendedor) queda solo la fecha.
  update public.store_orders
     set funds_hold = coalesce(p_hold, false),
         metadata_json = metadata_json || jsonb_build_object('funds_hold_at', now())
   where id = v_order.id
  returning * into v_order;
  insert into public.store_order_support_notes (order_id, kind, note, actor_id)
  values (v_order.id, case when v_order.funds_hold then 'funds_hold' else 'funds_release' end,
          nullif(left(btrim(coalesce(p_note, '')), 500), ''), v_uid);

  -- El payment retenido refleja la retención en el wallet del artista.
  if public.store_order_uses_wallet(v_order) and v_order.funds_released_at is null then
    if to_regclass('public.artist_wallet_movements') is not null then
      if v_order.funds_hold then
        execute format($q$
          update public.artist_wallet_movements
             set status = 'blocked',
                 metadata_json = metadata_json || jsonb_build_object('store_hold', true)
           where artist_user_id = $1 and external_reference = $2
             and status in ('pending_service', 'awaiting_release')
        $q$)
        using v_order.seller_id, 'store:' || v_order.id::text || ':payment';
      else
        execute format($q$
          update public.artist_wallet_movements
             set status = $3,
                 metadata_json = metadata_json - 'store_hold'
           where artist_user_id = $1 and external_reference = $2
             and status = 'blocked' and metadata_json ->> 'store_hold' = 'true'
        $q$)
        using v_order.seller_id, 'store:' || v_order.id::text || ':payment',
              case when v_order.fulfillment_status = 'delivered' then 'awaiting_release' else 'pending_service' end;
      end if;
    end if;
  end if;

  return v_order;
end;
$$;

revoke all on function public.set_store_order_funds_hold(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.set_store_order_funds_hold(uuid, boolean, text) to authenticated;

-- Soporte da por revisada la marca needs_support (pago duplicado, o informado
-- y vencido) y el pedido sale de la cola. Idempotente: sin marca, devuelve el
-- pedido sin cambios. La nota va a store_order_support_notes.
create or replace function public.resolve_store_order_flag(p_order_id uuid, p_note text)
returns public.store_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.store_orders;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'store:not_authenticated';
  end if;
  if not coalesce(public.is_support_user(), false) then
    raise exception using errcode = 'P0001', message = 'store:forbidden';
  end if;
  v_order := public.store_lock_order(p_order_id);
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'store:not_found';
  end if;
  if coalesce(v_order.metadata_json ->> 'needs_support', '') <> 'true' then
    return v_order;
  end if;

  update public.store_orders
     set metadata_json = (metadata_json - 'needs_support') || jsonb_build_object('needs_support_resolved_at', now())
   where id = v_order.id
  returning * into v_order;
  insert into public.store_order_support_notes (order_id, kind, note, actor_id)
  values (v_order.id, 'flag_resolved', nullif(left(btrim(coalesce(p_note, '')), 500), ''), v_uid);
  return v_order;
end;
$$;

revoke all on function public.resolve_store_order_flag(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_store_order_flag(uuid, text) to authenticated;

-- ===================== públicas =====================
-- Vitrina del vendedor. Rama artist: username exacto (lower) y registro
-- completo; con 0 o más de 1 fila devuelve null. La rama studio devuelve null
-- (la extiende la sesión de estudios).
create or replace function public.get_public_storefront(p_seller_type text, p_handle text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_handle text := lower(btrim(coalesce(p_handle, '')));
  v_count integer;
  v_user uuid;
  v_bundle jsonb;
  v_products jsonb;
begin
  if p_seller_type is distinct from 'artist' or v_handle = '' then
    return null;
  end if;
  select count(*)::integer, (array_agg(a.user_id))[1]
    into v_count, v_user
    from public.artists_db a
   where lower(a.username) = v_handle
     and a.registration_status is distinct from 'incompleto';
  if v_count <> 1 or v_user is null then
    return null;
  end if;
  v_bundle := public.store_public_seller_bundle('artist', v_user);
  if v_bundle is null then
    return null;
  end if;
  select coalesce(jsonb_agg(public.store_public_product_json(p) order by p.published_at desc nulls last, p.created_at desc), '[]'::jsonb)
    into v_products
    from public.store_products p
   where p.seller_type = 'artist'
     and p.seller_id = v_user
     and p.status = 'active';
  return v_bundle || jsonb_build_object('products', v_products);
end;
$$;

revoke all on function public.get_public_storefront(text, text) from public, anon, authenticated;
grant execute on function public.get_public_storefront(text, text) to anon, authenticated;

create or replace function public.get_public_store_product(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_product public.store_products;
  v_bundle jsonb;
begin
  select * into v_product
    from public.store_products p
   where p.id = p_product_id
     and p.status = 'active';
  if not found then
    return null;
  end if;
  v_bundle := public.store_public_seller_bundle(v_product.seller_type, v_product.seller_id);
  if v_bundle is null then
    return null;
  end if;
  return v_bundle || jsonb_build_object('product', public.store_public_product_json(v_product));
end;
$$;

revoke all on function public.get_public_store_product(uuid) from public, anon, authenticated;
grant execute on function public.get_public_store_product(uuid) to anon, authenticated;

-- Verificación pública. Datos personales mínimos: solo iniciales del titular.
create or replace function public.verify_store_license(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_license public.store_licenses;
  v_initials text;
begin
  if v_code !~ '^WOL-[A-Z0-9]{4}-[A-Z0-9]{4}$' then
    return jsonb_build_object('valid', false, 'found', false);
  end if;
  select * into v_license from public.store_licenses l where l.verification_code = v_code;
  if not found then
    return jsonb_build_object('valid', false, 'found', false);
  end if;
  select string_agg(upper(left(w.part, 1)) || '.', ' ' order by w.ord)
    into v_initials
    from regexp_split_to_table(btrim(v_license.holder_name), '\s+') with ordinality as w(part, ord)
   where w.part <> '' and w.ord <= 3;
  return jsonb_build_object(
    'found', true,
    'valid', v_license.revoked_at is null,
    'revoked', v_license.revoked_at is not null,
    'used', v_license.used_at is not null,
    'used_at', v_license.used_at,
    'tier', v_license.tier,
    'design_title', v_license.design_title,
    'seller_id', v_license.seller_id,
    'seller_display_name', v_license.seller_display_name,
    'seller_username', v_license.seller_username,
    'holder_initials', v_initials,
    'issued_at', v_license.issued_at,
    'terms_version', v_license.terms_version
  );
end;
$$;

revoke all on function public.verify_store_license(text) from public, anon, authenticated;
grant execute on function public.verify_store_license(text) to anon, authenticated;

-- ===================== servicio (service role) =====================
-- Nota: dentro de una función security definer current_user es siempre el
-- owner (postgres), así que el chequeo usa session_user para distinguir una
-- sesión directa (SQL editor, cron) de una llamada vía PostgREST.
create or replace function public.release_store_order_funds(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.store_orders;
  v_mov_id uuid;
  v_mov_amount numeric;
  v_mov_status text;
  v_rows integer := 0;
begin
  if coalesce((select auth.role()), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception using errcode = '42501', message = 'store:forbidden';
  end if;

  v_order := public.store_lock_order(p_order_id);
  if v_order.id is null then
    return false;
  end if;
  if not public.store_order_uses_wallet(v_order)
     or v_order.status <> 'fulfilled'
     or v_order.funds_hold
     or v_order.funds_release_at is null
     or v_order.funds_release_at > now()
     or v_order.funds_released_at is not null then
    return false;
  end if;

  -- Sin wallet aplicado no se marca funds_released_at: el mantenimiento reintenta.
  if to_regclass('public.artist_wallet_movements') is not null then
    perform public.store_wallet_upsert_payment(v_order);
    execute format($q$
      select id, amount, status
        from public.artist_wallet_movements
       where artist_user_id = $1 and external_reference = $2
       for update
    $q$)
    into v_mov_id, v_mov_amount, v_mov_status
    using v_order.seller_id, 'store:' || v_order.id::text || ':payment';
    if v_mov_id is null then
      return false;
    end if;
    if v_mov_status in ('awaiting_release', 'pending_service') then
      execute format($q$
        update public.artist_wallet_movements
           set status = 'completed'
         where id = $1 and status in ('awaiting_release', 'pending_service')
      $q$)
      using v_mov_id;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        return false;
      end if;
    elsif v_mov_status <> 'completed' then
      -- blocked (disputa o retención), cancelled, failed: no se libera.
      return false;
    end if;
    perform public.store_wallet_insert(
      v_order, 'release', v_mov_amount, 'release',
      'Fondos liberados · Pedido #' || v_order.order_number
    );
    if v_order.platform_fee_amount > 0 then
      perform public.store_wallet_insert(
        v_order, 'fee', v_order.platform_fee_amount, 'fee',
        'Comisión We Ötzi · Pedido #' || v_order.order_number
      );
    end if;
    update public.store_orders
       set funds_released_at = now()
     where id = v_order.id
       and funds_released_at is null;
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.release_store_order_funds(uuid) from public, anon, authenticated;
grant execute on function public.release_store_order_funds(uuid) to service_role;

-- Job horario (n8n → POST /api/store/maintenance). Cada pedido se procesa en
-- su propio bloque: un error se registra (texto crudo en
-- store_order_support_notes, solo la fecha en metadata_json.maintenance_error_at)
-- y el resto sigue. Los locks son skip locked (nunca espera a una RPC).
create or replace function public.run_store_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_order public.store_orders;
  v_expired integer := 0;
  v_flagged integer := 0;
  v_delivered integer := 0;
  v_released integer := 0;
  v_failed jsonb := '[]'::jsonb;
  v_error text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception using errcode = '42501', message = 'store:forbidden';
  end if;

  perform set_config('lock_timeout', '5s', true);

  -- (a) Vencidos (store_order_lapsed): sin pago informado, o con el aviso
  -- vencido hace más de 7 días sin que nadie lo confirme ni lo cancele.
  -- Restituye stock y libera la reserva; el informado queda needs_support.
  for v_id in
    select o.id
      from public.store_orders o
     where o.status = 'pending_payment'
       and o.expires_at < now()
       and public.store_order_lapsed(o)
     order by o.expires_at
     limit 500
  loop
    begin
      if not public.store_try_lock_order(v_id) then
        continue;
      end if;
      select * into v_order from public.store_orders o where o.id = v_id;
      if public.store_order_lapsed(v_order) then
        if public.store_close_unpaid_order(v_id, 'expired', null) then
          v_expired := v_expired + 1;
        end if;
      end if;
    exception when others then
      v_error := left(sqlstate || ' ' || sqlerrm, 500);
      v_failed := v_failed || jsonb_build_array(v_id);
      begin
        update public.store_orders
           set metadata_json = metadata_json || jsonb_build_object('maintenance_error_at', now())
         where id = v_id;
        insert into public.store_order_support_notes (order_id, kind, note)
        values (v_id, 'maintenance_error', v_error);
      exception when others then
        null;
      end;
    end;
  end loop;

  -- (b) Vencidos con pago informado: se marcan para soporte, una sola vez
  -- (7 días después, si siguen así, los vence el paso (a)).
  for v_id in
    select o.id
      from public.store_orders o
     where o.status = 'pending_payment'
       and o.expires_at < now()
       and o.buyer_payment_reported_at is not null
       and coalesce(o.metadata_json ->> 'needs_support', '') <> 'true'
     order by o.expires_at
     limit 500
  loop
    begin
      if not public.store_try_lock_order(v_id) then
        continue;
      end if;
      update public.store_orders
         set metadata_json = metadata_json || jsonb_build_object(
               'needs_support', true,
               'needs_support_reason', 'payment_reported_expired',
               'needs_support_at', now())
       where id = v_id
         and status = 'pending_payment'
         and expires_at < now()
         and buyer_payment_reported_at is not null
         and coalesce(metadata_json ->> 'needs_support', '') <> 'true';
      if found then
        v_flagged := v_flagged + 1;
      end if;
    exception when others then
      v_error := left(sqlstate || ' ' || sqlerrm, 500);
      v_failed := v_failed || jsonb_build_array(v_id);
      begin
        update public.store_orders
           set metadata_json = metadata_json || jsonb_build_object('maintenance_error_at', now())
         where id = v_id;
        insert into public.store_order_support_notes (order_id, kind, note)
        values (v_id, 'maintenance_error', v_error);
      exception when others then
        null;
      end;
    end;
  end loop;

  -- (c) Entrega automática: enviados hace 14 días y listos para retirar hace 7.
  for v_id in
    select o.id
      from public.store_orders o
     where o.status = 'paid'
       and (
         (o.fulfillment_status = 'shipped' and o.shipped_at < now() - interval '14 days')
         or (o.fulfillment_status = 'ready_for_pickup' and o.ready_at < now() - interval '7 days')
       )
     order by o.created_at
     limit 500
  loop
    begin
      if not public.store_try_lock_order(v_id) then
        continue;
      end if;
      select * into v_order from public.store_orders o where o.id = v_id;
      if v_order.status = 'paid' and (
           (v_order.fulfillment_status = 'shipped' and v_order.shipped_at < now() - interval '14 days')
           or (v_order.fulfillment_status = 'ready_for_pickup' and v_order.ready_at < now() - interval '7 days')
         ) then
        perform public.store_finish_delivery(v_id, 'auto');
        v_delivered := v_delivered + 1;
      end if;
    exception when others then
      v_error := left(sqlstate || ' ' || sqlerrm, 500);
      v_failed := v_failed || jsonb_build_array(v_id);
      begin
        update public.store_orders
           set metadata_json = metadata_json || jsonb_build_object('maintenance_error_at', now())
         where id = v_id;
        insert into public.store_order_support_notes (order_id, kind, note)
        values (v_id, 'maintenance_error', v_error);
      exception when others then
        null;
      end;
    end;
  end loop;

  -- (d) Liberación de fondos vencidos (solo pedidos con el predicado del wallet).
  for v_id in
    select o.id
      from public.store_orders o
     where o.status = 'fulfilled'
       and not o.funds_hold
       and o.funds_released_at is null
       and o.funds_release_at <= now()
       and o.seller_type = 'artist'
       and o.payment_collected_by in ('platform', 'provider')
     order by o.funds_release_at
     limit 500
  loop
    begin
      if not public.store_try_lock_order(v_id) then
        continue;
      end if;
      if public.release_store_order_funds(v_id) then
        v_released := v_released + 1;
      end if;
    exception when others then
      v_error := left(sqlstate || ' ' || sqlerrm, 500);
      v_failed := v_failed || jsonb_build_array(v_id);
      begin
        update public.store_orders
           set metadata_json = metadata_json || jsonb_build_object('maintenance_error_at', now())
         where id = v_id;
        insert into public.store_order_support_notes (order_id, kind, note)
        values (v_id, 'maintenance_error', v_error);
      exception when others then
        null;
      end;
    end;
  end loop;

  return jsonb_build_object(
    'expired', v_expired,
    'flagged', v_flagged,
    'delivered', v_delivered,
    'released', v_released,
    'failed', v_failed
  );
end;
$$;

revoke all on function public.run_store_maintenance() from public, anon, authenticated;
grant execute on function public.run_store_maintenance() to service_role;

-- Webhook del proveedor: monto y moneda tienen que coincidir.
create or replace function public.confirm_store_order_payment_as_provider(
  p_order_id uuid,
  p_provider text,
  p_reference text,
  p_amount numeric,
  p_currency text
)
returns public.store_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.store_orders;
begin
  if coalesce((select auth.role()), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception using errcode = '42501', message = 'store:forbidden';
  end if;

  select * into v_order from public.store_orders o where o.id = p_order_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'store:not_found';
  end if;
  if p_provider is null or p_provider not in ('stripe', 'mercado_pago')
     or v_order.expected_collector <> 'provider'
     or v_order.payment_provider is distinct from p_provider then
    raise exception using errcode = 'P0001', message = 'store:collector_mismatch';
  end if;
  if nullif(btrim(coalesce(p_reference, '')), '') is null
     or p_amount is null or p_currency is null
     or p_amount <> v_order.total_amount
     or upper(btrim(p_currency)) <> v_order.currency then
    raise exception using errcode = 'P0001', message = 'store:order_not_payable';
  end if;
  return public.store_apply_order_payment(
    p_order_id, 'provider', p_provider, p_reference, null,
    p_amount, upper(btrim(p_currency)), null, false
  );
end;
$$;

revoke all on function public.confirm_store_order_payment_as_provider(uuid, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.confirm_store_order_payment_as_provider(uuid, text, text, numeric, text) to service_role;

-- ===================== RLS =====================
alter table public.store_products enable row level security;
alter table public.store_product_variants enable row level security;
alter table public.store_design_assets enable row level security;
alter table public.store_seller_settings enable row level security;
alter table public.store_orders enable row level security;
alter table public.store_order_items enable row level security;
alter table public.store_payments enable row level security;
alter table public.store_licenses enable row level security;
alter table public.store_download_events enable row level security;
alter table public.store_order_support_notes enable row level security;

-- Productos
drop policy if exists store_products_owner_select on public.store_products;
create policy store_products_owner_select on public.store_products
  for select to authenticated
  using (public.store_can_manage_seller(seller_type, seller_id));
drop policy if exists store_products_owner_insert on public.store_products;
create policy store_products_owner_insert on public.store_products
  for insert to authenticated
  with check (public.store_can_manage_seller(seller_type, seller_id));
drop policy if exists store_products_owner_update on public.store_products;
create policy store_products_owner_update on public.store_products
  for update to authenticated
  using (public.store_can_manage_seller(seller_type, seller_id))
  with check (public.store_can_manage_seller(seller_type, seller_id));
drop policy if exists store_products_owner_delete on public.store_products;
create policy store_products_owner_delete on public.store_products
  for delete to authenticated
  using (public.store_can_manage_seller(seller_type, seller_id));
drop policy if exists store_products_support_all on public.store_products;
create policy store_products_support_all on public.store_products
  for all to authenticated
  using (public.is_support_user())
  with check (public.is_support_user());

-- Variantes
drop policy if exists store_product_variants_owner_select on public.store_product_variants;
create policy store_product_variants_owner_select on public.store_product_variants
  for select to authenticated
  using (exists (
    select 1 from public.store_products p
     where p.id = store_product_variants.product_id
       and public.store_can_manage_seller(p.seller_type, p.seller_id)
  ));
drop policy if exists store_product_variants_owner_insert on public.store_product_variants;
create policy store_product_variants_owner_insert on public.store_product_variants
  for insert to authenticated
  with check (exists (
    select 1 from public.store_products p
     where p.id = store_product_variants.product_id
       and public.store_can_manage_seller(p.seller_type, p.seller_id)
  ));
drop policy if exists store_product_variants_owner_update on public.store_product_variants;
create policy store_product_variants_owner_update on public.store_product_variants
  for update to authenticated
  using (exists (
    select 1 from public.store_products p
     where p.id = store_product_variants.product_id
       and public.store_can_manage_seller(p.seller_type, p.seller_id)
  ))
  with check (exists (
    select 1 from public.store_products p
     where p.id = store_product_variants.product_id
       and public.store_can_manage_seller(p.seller_type, p.seller_id)
  ));
drop policy if exists store_product_variants_owner_delete on public.store_product_variants;
create policy store_product_variants_owner_delete on public.store_product_variants
  for delete to authenticated
  using (exists (
    select 1 from public.store_products p
     where p.id = store_product_variants.product_id
       and public.store_can_manage_seller(p.seller_type, p.seller_id)
  ));
drop policy if exists store_product_variants_support_all on public.store_product_variants;
create policy store_product_variants_support_all on public.store_product_variants
  for all to authenticated
  using (public.is_support_user())
  with check (public.is_support_user());

-- Archivos del diseño (sin update)
drop policy if exists store_design_assets_owner_select on public.store_design_assets;
create policy store_design_assets_owner_select on public.store_design_assets
  for select to authenticated
  using (exists (
    select 1 from public.store_products p
     where p.id = store_design_assets.product_id
       and public.store_can_manage_seller(p.seller_type, p.seller_id)
  ));
drop policy if exists store_design_assets_owner_insert on public.store_design_assets;
create policy store_design_assets_owner_insert on public.store_design_assets
  for insert to authenticated
  with check (exists (
    select 1 from public.store_products p
     where p.id = store_design_assets.product_id
       and public.store_can_manage_seller(p.seller_type, p.seller_id)
  ));
drop policy if exists store_design_assets_owner_delete on public.store_design_assets;
create policy store_design_assets_owner_delete on public.store_design_assets
  for delete to authenticated
  using (exists (
    select 1 from public.store_products p
     where p.id = store_design_assets.product_id
       and public.store_can_manage_seller(p.seller_type, p.seller_id)
  ));
-- El titular de una licencia vigente lista la metadata; descarga por el servidor.
drop policy if exists store_design_assets_licensee_read on public.store_design_assets;
create policy store_design_assets_licensee_read on public.store_design_assets
  for select to authenticated
  using (exists (
    select 1 from public.store_licenses l
     where l.product_id = store_design_assets.product_id
       and l.revoked_at is null
       and l.holder_user_id = (select auth.uid())
  ));
drop policy if exists store_design_assets_support_all on public.store_design_assets;
create policy store_design_assets_support_all on public.store_design_assets
  for all to authenticated
  using (public.is_support_user())
  with check (public.is_support_user());

-- Ajustes del vendedor
drop policy if exists store_seller_settings_owner_select on public.store_seller_settings;
create policy store_seller_settings_owner_select on public.store_seller_settings
  for select to authenticated
  using (public.store_can_manage_seller(seller_type, seller_id));
drop policy if exists store_seller_settings_owner_insert on public.store_seller_settings;
create policy store_seller_settings_owner_insert on public.store_seller_settings
  for insert to authenticated
  with check (public.store_can_manage_seller(seller_type, seller_id));
drop policy if exists store_seller_settings_owner_update on public.store_seller_settings;
create policy store_seller_settings_owner_update on public.store_seller_settings
  for update to authenticated
  using (public.store_can_manage_seller(seller_type, seller_id))
  with check (public.store_can_manage_seller(seller_type, seller_id));
drop policy if exists store_seller_settings_support_all on public.store_seller_settings;
create policy store_seller_settings_support_all on public.store_seller_settings
  for all to authenticated
  using (public.is_support_user())
  with check (public.is_support_user());

-- Pedidos (solo lectura)
drop policy if exists store_orders_buyer_read on public.store_orders;
create policy store_orders_buyer_read on public.store_orders
  for select to authenticated
  using (buyer_user_id = (select auth.uid()));
drop policy if exists store_orders_seller_read on public.store_orders;
create policy store_orders_seller_read on public.store_orders
  for select to authenticated
  using (public.store_can_manage_seller(seller_type, seller_id));
drop policy if exists store_orders_support_read on public.store_orders;
create policy store_orders_support_read on public.store_orders
  for select to authenticated
  using (public.is_support_user());

-- Ítems (solo lectura)
drop policy if exists store_order_items_buyer_read on public.store_order_items;
create policy store_order_items_buyer_read on public.store_order_items
  for select to authenticated
  using (exists (
    select 1 from public.store_orders o
     where o.id = store_order_items.order_id
       and o.buyer_user_id = (select auth.uid())
  ));
drop policy if exists store_order_items_seller_read on public.store_order_items;
create policy store_order_items_seller_read on public.store_order_items
  for select to authenticated
  using (exists (
    select 1 from public.store_orders o
     where o.id = store_order_items.order_id
       and public.store_can_manage_seller(o.seller_type, o.seller_id)
  ));
drop policy if exists store_order_items_support_read on public.store_order_items;
create policy store_order_items_support_read on public.store_order_items
  for select to authenticated
  using (public.is_support_user());

-- Pagos (solo lectura, columnas acotadas)
drop policy if exists store_payments_buyer_read on public.store_payments;
create policy store_payments_buyer_read on public.store_payments
  for select to authenticated
  using (exists (
    select 1 from public.store_orders o
     where o.id = store_payments.order_id
       and o.buyer_user_id = (select auth.uid())
  ));
drop policy if exists store_payments_seller_read on public.store_payments;
create policy store_payments_seller_read on public.store_payments
  for select to authenticated
  using (exists (
    select 1 from public.store_orders o
     where o.id = store_payments.order_id
       and public.store_can_manage_seller(o.seller_type, o.seller_id)
  ));
drop policy if exists store_payments_support_read on public.store_payments;
create policy store_payments_support_read on public.store_payments
  for select to authenticated
  using (public.is_support_user());

-- Licencias (solo lectura)
drop policy if exists store_licenses_holder_read on public.store_licenses;
create policy store_licenses_holder_read on public.store_licenses
  for select to authenticated
  using (holder_user_id = (select auth.uid()));
drop policy if exists store_licenses_buyer_read on public.store_licenses;
create policy store_licenses_buyer_read on public.store_licenses
  for select to authenticated
  using (exists (
    select 1 from public.store_orders o
     where o.id = store_licenses.order_id
       and o.buyer_user_id = (select auth.uid())
  ));
drop policy if exists store_licenses_seller_read on public.store_licenses;
create policy store_licenses_seller_read on public.store_licenses
  for select to authenticated
  using (public.store_can_manage_seller(seller_type, seller_id));
drop policy if exists store_licenses_support_read on public.store_licenses;
create policy store_licenses_support_read on public.store_licenses
  for select to authenticated
  using (public.is_support_user());

-- Descargas (escribe el servidor; leen vendedor y soporte)
drop policy if exists store_download_events_seller_read on public.store_download_events;
create policy store_download_events_seller_read on public.store_download_events
  for select to authenticated
  using (exists (
    select 1 from public.store_licenses l
     where l.id = store_download_events.license_id
       and public.store_can_manage_seller(l.seller_type, l.seller_id)
  ));
drop policy if exists store_download_events_support_read on public.store_download_events;
create policy store_download_events_support_read on public.store_download_events
  for select to authenticated
  using (public.is_support_user());

-- Notas internas (escriben las RPC; lee solo soporte)
drop policy if exists store_order_support_notes_support_read on public.store_order_support_notes;
create policy store_order_support_notes_support_read on public.store_order_support_notes
  for select to authenticated
  using (public.is_support_user());

-- ===================== grants de tablas =====================
-- Sin grants a anon. authenticated: solo el DML que usa la UI (nunca
-- truncate, trigger ni references). El resto va por RPC.
revoke all on table public.store_products from public, anon, authenticated;
revoke all on table public.store_product_variants from public, anon, authenticated;
revoke all on table public.store_design_assets from public, anon, authenticated;
revoke all on table public.store_seller_settings from public, anon, authenticated;
revoke all on table public.store_orders from public, anon, authenticated;
revoke all on table public.store_order_items from public, anon, authenticated;
revoke all on table public.store_payments from public, anon, authenticated;
revoke all on table public.store_licenses from public, anon, authenticated;
revoke all on table public.store_download_events from public, anon, authenticated;
revoke all on table public.store_order_support_notes from public, anon, authenticated;

grant select, insert, update, delete on table public.store_products to authenticated;
grant select, insert, update, delete on table public.store_product_variants to authenticated;
grant select, insert, delete on table public.store_design_assets to authenticated;
grant select, insert, update on table public.store_seller_settings to authenticated;
grant select on table public.store_orders to authenticated;
grant select on table public.store_order_items to authenticated;
grant select (id, order_id, provider, status, amount, currency, collected_by, reference, created_at)
  on table public.store_payments to authenticated;
grant select on table public.store_licenses to authenticated;
grant select on table public.store_download_events to authenticated;
grant select on table public.store_order_support_notes to authenticated;

-- Servidor (lib/repos/store.js con service role).
grant select, insert, update, delete on table public.store_products to service_role;
grant select, insert, update, delete on table public.store_product_variants to service_role;
grant select, insert, update, delete on table public.store_design_assets to service_role;
grant select, insert, update, delete on table public.store_seller_settings to service_role;
grant select, insert, update, delete on table public.store_orders to service_role;
grant select, insert, update, delete on table public.store_order_items to service_role;
grant select, insert, update, delete on table public.store_payments to service_role;
grant select, insert, update, delete on table public.store_licenses to service_role;
grant select, insert, update, delete on table public.store_download_events to service_role;
grant select, insert, update, delete on table public.store_order_support_notes to service_role;

-- ===================== app_settings de la Store (privadas) =====================
-- app_settings.is_public tiene default true y anon lee las públicas. Estas
-- claves se siembran con valores neutros (equivalen a no tenerlas) y siempre
-- privadas: si ya existen, solo se vuelven privadas, sin pisar el valor.
insert into public.app_settings (setting_key, setting_value, setting_type, description, is_public) values
  ('store_payment_provider', 'manual', 'text',
   'Store: proveedor de pagos (manual, stripe o mercado_pago). Cambiarlo solo cuando el adaptador esté registrado en el servidor.', false),
  ('store_manual_collector', 'seller', 'text',
   'Store: quién cobra en modo manual (seller o platform).', false),
  ('store_platform_payment_instructions', null, 'text',
   'Store: instrucciones de pago de We Ötzi cuando cobra la plataforma.', false),
  ('store_platform_fee_pct', '0', 'text',
   'Store: comisión de plataforma en porcentaje (0 a 50).', false)
on conflict (setting_key) do update set is_public = false;

-- ===================== Storage =====================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'store-previews',
  'store-previews',
  true,
  3145728,
  array['image/jpeg', 'image/webp', 'image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'store-design-files',
  'store-design-files',
  false,
  52428800,
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/tiff', 'application/pdf',
    'image/vnd.adobe.photoshop', 'application/postscript', 'application/zip'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- store-previews: bucket público (URL directa); select solo de la carpeta
-- propia (anti-listado) y soporte. Carpeta raíz = seller_id.
drop policy if exists "store_previews_owner_select" on storage.objects;
create policy "store_previews_owner_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'store-previews' and (
    public.store_can_manage_storage_folder((storage.foldername(name))[1])
    or public.is_support_user()
  ));

drop policy if exists "store_previews_owner_insert" on storage.objects;
create policy "store_previews_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'store-previews'
    and public.store_can_manage_storage_folder((storage.foldername(name))[1]));

drop policy if exists "store_previews_owner_delete" on storage.objects;
create policy "store_previews_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'store-previews'
    and public.store_can_manage_storage_folder((storage.foldername(name))[1]));

-- store-design-files: los compradores no tienen policy (URL firmada por el
-- servidor). Sin update.
drop policy if exists "store_design_files_owner_select" on storage.objects;
create policy "store_design_files_owner_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'store-design-files' and (
    public.store_can_manage_storage_folder((storage.foldername(name))[1])
    or public.is_support_user()
  ));

drop policy if exists "store_design_files_owner_insert" on storage.objects;
create policy "store_design_files_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'store-design-files'
    and public.store_can_manage_storage_folder((storage.foldername(name))[1]));

drop policy if exists "store_design_files_owner_delete" on storage.objects;
create policy "store_design_files_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'store-design-files'
    and public.store_can_manage_storage_folder((storage.foldername(name))[1])
    and not exists (
      select 1
        from public.store_design_assets a
        join public.store_licenses l on l.product_id = a.product_id
       where a.storage_path = objects.name
         and l.revoked_at is null
    ));

notify pgrst, 'reload schema';

commit;
