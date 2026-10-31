-- Tienda del estudio sobre el modelo compartido store_* (feature/store-artista).
--
-- Estado: NO APLICADA.
-- Depende de: 20261030150000_store_core.sql (store_*), 20261030200000..204000.
-- Rollback: supabase/rollbacks/20261030205000_studio_store.down.sql
--
-- 1. store_public_seller_bundle: la rama studio expone handle (slug), logo,
--    ciudad y país, solo para estudios activos.
-- 2. get_public_storefront: rama 'studio' con handle = studios.slug.
-- 3. create_store_pos_order: venta en mostrador del estudio. Un ítem por
--    pedido (índice store_order_items_one_per_order), canal pos, comprador
--    invitado, cobrada por el estudio; nace pagada y entregada, sin wallet ni
--    liberación de fondos. Idempotente por (seller, idempotency_key).

begin;

set local lock_timeout = '5s';

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
             'handle', s.slug,
             'name', s.name,
             'avatar_url', s.logo_image,
             'city', s.city,
             'country', s.country
           )
      into v_seller
      from public.studios s
     where s.id = p_seller_id
       and s.is_active
     limit 1;
    if not found then
      return null;
    end if;
    v_index := true;
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
  v_seller uuid;
  v_bundle jsonb;
  v_products jsonb;
begin
  if p_seller_type not in ('artist', 'studio') or v_handle = '' then
    return null;
  end if;
  if p_seller_type = 'artist' then
    select count(*)::integer, (array_agg(a.user_id))[1]
      into v_count, v_seller
      from public.artists_db a
     where lower(a.username) = v_handle
       and a.registration_status is distinct from 'incompleto';
  else
    select count(*)::integer, (array_agg(s.id))[1]
      into v_count, v_seller
      from public.studios s
     where lower(s.slug) = v_handle
       and s.is_active;
  end if;
  if v_count <> 1 or v_seller is null then
    return null;
  end if;
  v_bundle := public.store_public_seller_bundle(p_seller_type, v_seller);
  if v_bundle is null then
    return null;
  end if;
  select coalesce(jsonb_agg(public.store_public_product_json(p) order by p.published_at desc nulls last, p.created_at desc), '[]'::jsonb)
    into v_products
    from public.store_products p
   where p.seller_type = p_seller_type
     and p.seller_id = v_seller
     and p.status = 'active';
  return v_bundle || jsonb_build_object('products', v_products);
end;
$$;

revoke all on function public.get_public_storefront(text, text) from public, anon, authenticated;
grant execute on function public.get_public_storefront(text, text) to anon, authenticated;

create or replace function public.create_store_pos_order(
  p_studio_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_quantity integer,
  p_payment_method text,
  p_buyer_name text default null,
  p_buyer_email text default null,
  p_buyer_phone text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_key text := nullif(left(btrim(coalesce(p_idempotency_key, '')), 80), '');
  v_method text := lower(btrim(coalesce(p_payment_method, '')));
  v_qty integer := coalesce(p_quantity, 0);
  v_existing public.store_orders;
  v_product public.store_products;
  v_variant public.store_product_variants;
  v_unit numeric(12,2);
  v_total numeric(12,2);
  v_order public.store_orders;
begin
  if v_uid is null then
    raise exception 'Iniciá sesión para registrar la venta.' using errcode = '42501';
  end if;
  if p_studio_id is null
     or not (public.store_can_manage_seller('studio', p_studio_id) or public.is_support_user()) then
    raise exception 'No podés vender en nombre de este estudio.' using errcode = '42501';
  end if;
  if v_method not in ('cash', 'card', 'transfer', 'other') then
    raise exception 'Elegí cómo cobraste la venta.' using errcode = '22023';
  end if;
  if v_qty < 1 or v_qty > 20 then
    raise exception 'La cantidad tiene que estar entre 1 y 20.' using errcode = '22023';
  end if;

  -- Serializa las ventas de mostrador del estudio (idempotencia y stock).
  perform pg_advisory_xact_lock(hashtextextended('store_pos:' || p_studio_id::text, 0));

  if v_key is not null then
    select * into v_existing
      from public.store_orders o
     where o.seller_type = 'studio' and o.seller_id = p_studio_id
       and o.channel = 'pos' and o.idempotency_key = v_key;
    if found then
      return jsonb_build_object('order_id', v_existing.id, 'order_number', v_existing.order_number,
        'total', v_existing.total_amount, 'currency', v_existing.currency, 'replayed', true);
    end if;
  end if;

  select * into v_product
    from public.store_products p
   where p.id = p_product_id
   for update;
  if not found or v_product.seller_type <> 'studio' or v_product.seller_id <> p_studio_id then
    raise exception 'El producto no es de este estudio.' using errcode = '22023';
  end if;
  if v_product.kind <> 'merch' then
    raise exception 'En mostrador solo se venden productos físicos.' using errcode = '22023';
  end if;
  if v_product.status not in ('active', 'paused') then
    raise exception 'Publicá o pausá el producto antes de venderlo.' using errcode = '23514';
  end if;

  if p_variant_id is not null then
    select * into v_variant
      from public.store_product_variants v
     where v.id = p_variant_id
     for update;
    if not found or v_variant.product_id <> v_product.id or not v_variant.active then
      raise exception 'Elegí una variante activa del producto.' using errcode = '22023';
    end if;
  elsif exists (select 1 from public.store_product_variants v where v.product_id = v_product.id and v.active) then
    raise exception 'Elegí la variante (talle, color) que vendiste.' using errcode = '22023';
  end if;

  v_unit := coalesce(v_variant.price_amount, v_product.price_amount);
  if v_unit is null or v_unit <= 0 then
    raise exception 'El producto no tiene precio.' using errcode = '23514';
  end if;
  v_total := round(v_unit * v_qty, 2);

  if v_variant.id is not null and v_variant.stock is not null then
    if v_variant.stock < v_qty then
      raise exception 'No hay stock suficiente de %.', v_product.title using errcode = '23514';
    end if;
    update public.store_product_variants
       set stock = stock - v_qty
     where id = v_variant.id;
  end if;

  insert into public.store_orders (
    order_number, seller_type, seller_id, channel, buyer_user_id, buyer_role,
    buyer_name, buyer_email, buyer_phone, status, fulfillment_method, fulfillment_status,
    currency, subtotal_amount, shipping_amount, total_amount, platform_fee_pct, platform_fee_amount,
    payment_provider, expected_collector, paid_at, payment_collected_by, payment_confirmed_by,
    delivered_at, delivered_by, funds_release_at, idempotency_key, metadata_json
  ) values (
    public.store_new_order_number(), 'studio', p_studio_id, 'pos', null, 'guest',
    coalesce(nullif(left(btrim(coalesce(p_buyer_name, '')), 120), ''), 'Cliente en mostrador'),
    nullif(left(btrim(coalesce(p_buyer_email, '')), 254), ''),
    nullif(left(btrim(coalesce(p_buyer_phone, '')), 40), ''),
    'fulfilled', 'pickup', 'delivered',
    v_product.currency, v_total, 0, v_total, 0, 0,
    'manual', 'seller', now(), 'seller', v_uid,
    now(), 'seller', null, v_key, jsonb_build_object('pos_payment_method', v_method)
  )
  returning * into v_order;

  insert into public.store_order_items (
    order_id, product_id, variant_id, kind, title, variant_label, image_path,
    unit_price, quantity, line_total
  ) values (
    v_order.id, v_product.id, v_variant.id, 'merch', left(v_product.title, 120), v_variant.label,
    v_product.images -> 0 ->> 'path', v_unit, v_qty, v_total
  );

  insert into public.store_payments (order_id, provider, status, amount, currency, collected_by, note, confirmed_by)
  values (v_order.id, 'manual', 'succeeded', v_total, v_order.currency, 'seller', 'Mostrador: ' || v_method, v_uid);

  update public.store_products
     set sales_count = sales_count + v_qty
   where id = v_product.id;

  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
    'total', v_order.total_amount, 'currency', v_order.currency, 'replayed', false);
end;
$$;

revoke all on function public.create_store_pos_order(uuid, uuid, uuid, integer, text, text, text, text, text) from public, anon;
grant execute on function public.create_store_pos_order(uuid, uuid, uuid, integer, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
