-- M5 · Supplies marketplace. Correr como postgres después de M1→M5.
-- Las identidades y filas son fixtures "QA ROLLBACK"; todo se revierte al final.
-- Cubre: registro Supplies (email confirmado, idempotencia, lista blanca),
-- handle_new_user con user_type 'supplies', guard del vendor, RLS de vendors,
-- productos y pedidos, importes (plataforma + tier, tope 60, resto de
-- redondeo), validaciones cruzadas (sede, ítem de inventario, estudio ajeno),
-- máquina de estados del pedido, stock al confirmar/cancelar, recepción
-- parcial e idempotente con pack_size, moneda distinta, gasto en finanzas,
-- vistas del vendor y el helper de storage.
begin;
reset role;
do $$
declare
  owner_a uuid := gen_random_uuid(); owner_b uuid := gen_random_uuid();
  vendor1_user uuid := gen_random_uuid(); vendor2_user uuid := gen_random_uuid();
  unconfirmed_user uuid := gen_random_uuid(); support_user uuid := gen_random_uuid();
  sid_a uuid; sid_b uuid; loc_a uuid; loc_a_off uuid; loc_b uuid;
  item_a uuid; item_a_usd uuid; item_b uuid;
begin
  insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (owner_a, 'authenticated', 'authenticated', 'qa-sup-owner-a-' || owner_a || '@example.invalid', now(), '{}'::jsonb, '{"user_type":"studio"}'::jsonb, now(), now()),
         (owner_b, 'authenticated', 'authenticated', 'qa-sup-owner-b-' || owner_b || '@example.invalid', now(), '{}'::jsonb, '{"user_type":"studio"}'::jsonb, now(), now()),
         (vendor1_user, 'authenticated', 'authenticated', 'qa-sup-vendor1-' || vendor1_user || '@example.invalid', now(), '{}'::jsonb, '{"user_type":"supplies"}'::jsonb, now(), now()),
         (vendor2_user, 'authenticated', 'authenticated', 'qa-sup-vendor2-' || vendor2_user || '@example.invalid', now(), '{}'::jsonb, '{"user_type":"supplies"}'::jsonb, now(), now()),
         (unconfirmed_user, 'authenticated', 'authenticated', 'qa-sup-unconfirmed-' || unconfirmed_user || '@example.invalid', null, '{}'::jsonb, '{"user_type":"supplies"}'::jsonb, now(), now()),
         (support_user, 'authenticated', 'authenticated', 'qa-sup-support-' || support_user || '@example.invalid', now(), '{}'::jsonb, '{"user_type":"studio"}'::jsonb, now(), now());

  -- handle_new_user: un alta Supplies no crea perfil de artista.
  if exists (select 1 from public.artists_db where user_id in (vendor1_user, vendor2_user, unconfirmed_user)) then
    raise exception 'FAIL: handle_new_user created an artists_db row for a supplies signup';
  end if;

  insert into public.support_users_db(user_id, email, full_name)
  values (support_user, 'qa-sup-support-' || support_user || '@example.invalid', 'QA ROLLBACK support');

  insert into public.studios(user_id, name, normalized_name, slug, is_active)
  values (owner_a, 'QA ROLLBACK supplies studio A', 'qa-sup-a-' || owner_a, 'qa-sup-a-' || owner_a, true) returning id into sid_a;
  insert into public.studios(user_id, name, normalized_name, slug, is_active)
  values (owner_b, 'QA ROLLBACK supplies studio B', 'qa-sup-b-' || owner_b, 'qa-sup-b-' || owner_b, true) returning id into sid_b;

  insert into public.studio_locations(studio_id, label, city, country_code, is_active)
  values (sid_a, 'QA ROLLBACK sede A', 'Buenos Aires', 'AR', true) returning id into loc_a;
  insert into public.studio_locations(studio_id, label, city, country_code, is_active)
  values (sid_a, 'QA ROLLBACK sede A cerrada', 'Rosario', 'AR', false) returning id into loc_a_off;
  insert into public.studio_locations(studio_id, label, city, country_code, is_active)
  values (sid_b, 'QA ROLLBACK sede B', 'Córdoba', 'AR', true) returning id into loc_b;

  insert into public.studio_inventory_items(studio_id, name, unit, quantity_on_hand, cost_per_unit, currency)
  values (sid_a, 'QA ROLLBACK tinta negra en stock', 'frasco', 2, 80, 'ARS') returning id into item_a;
  insert into public.studio_inventory_items(studio_id, name, unit, quantity_on_hand, cost_per_unit, currency)
  values (sid_a, 'QA ROLLBACK tinta importada', 'frasco', 0, 7.77, 'USD') returning id into item_a_usd;
  insert into public.studio_inventory_items(studio_id, name, quantity_on_hand, cost_per_unit, currency)
  values (sid_b, 'QA ROLLBACK foreign inventory', 5, 1, 'ARS') returning id into item_b;

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('test.owner_a', owner_a::text, true);
  perform set_config('test.owner_b', owner_b::text, true);
  perform set_config('test.vendor1_user', vendor1_user::text, true);
  perform set_config('test.vendor2_user', vendor2_user::text, true);
  perform set_config('test.unconfirmed_user', unconfirmed_user::text, true);
  perform set_config('test.support_user', support_user::text, true);
  perform set_config('test.studio_a', sid_a::text, true);
  perform set_config('test.studio_b', sid_b::text, true);
  perform set_config('test.loc_a', loc_a::text, true);
  perform set_config('test.loc_a_off', loc_a_off::text, true);
  perform set_config('test.loc_b', loc_b::text, true);
  perform set_config('test.item_a', item_a::text, true);
  perform set_config('test.item_a_usd', item_a_usd::text, true);
  perform set_config('test.item_b', item_b::text, true);
END $$;

-- ---------------------------------------------------------------------
-- Registro, guard del vendor, catálogo y RLS antes de la verificación
-- ---------------------------------------------------------------------
set local role authenticated;
do $$
declare
  v1u uuid := current_setting('test.vendor1_user')::uuid;
  v2u uuid := current_setting('test.vendor2_user')::uuid;
  uu uuid := current_setting('test.unconfirmed_user')::uuid;
  oa uuid := current_setting('test.owner_a')::uuid;
  sid_a uuid := current_setting('test.studio_a')::uuid;
  loc_a uuid := current_setting('test.loc_a')::uuid;
  vend public.supply_vendors; vend_again public.supply_vendors; vend2 public.supply_vendors;
  ok boolean; n integer;
  p_a uuid; p_b uuid; p_c uuid; p_ink uuid; p_gloves uuid; p_off uuid; q_x uuid;
  ink_sku text := 'QA-INK-' || left(md5(random()::text), 8);
  glv_sku text := 'QA-GLV-' || left(md5(random()::text), 8);
begin
  -- Email sin confirmar: no hay cuenta.
  perform set_config('request.jwt.claim.sub', uu::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', uu, 'role', 'authenticated')::text, true);
  ok := false;
  begin
    perform public.complete_supply_vendor_registration('{"name":"QA ROLLBACK sin confirmar"}'::jsonb);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL: unconfirmed email created a Supplies account'; end if;

  -- Vendor 1: lista blanca (is_verified/user_id/slug del cliente se ignoran).
  perform set_config('request.jwt.claim.sub', v1u::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', v1u, 'role', 'authenticated')::text, true);
  vend := public.complete_supply_vendor_registration(jsonb_build_object(
    'name', 'QA ROLLBACK Tintas Uno',
    'currency', 'ARS',
    'platform_discount_pct', 10,
    'free_shipping_threshold', 500,
    'benefits', jsonb_build_array('Envío en 24 h', '   '),
    'ships_to_countries', jsonb_build_array('ar', 'UY'),
    'is_verified', true, 'user_id', oa, 'slug', 'slug-robado', 'email', 'otro@example.invalid',
    'private', jsonb_build_object('legal_name', 'QA ROLLBACK Tintas SRL', 'tax_id', '30-00000000-0')
  ));
  if vend.user_id is distinct from v1u or vend.is_verified or not vend.is_active or vend.profile_complete
     or vend.email is distinct from 'qa-sup-vendor1-' || v1u || '@example.invalid'
     or vend.slug is distinct from 'qa-rollback-tintas-uno-' || left(replace(v1u::text, '-', ''), 8)
     or vend.platform_discount_pct is distinct from 10 or vend.currency is distinct from 'ARS'
     or vend.benefits is distinct from array['Envío en 24 h']
     or not (vend.ships_to_countries @> array['AR', 'UY'] and cardinality(vend.ships_to_countries) = 2) then
    raise exception 'FAIL: registration row mismatch %', to_jsonb(vend);
  end if;
  vend_again := public.complete_supply_vendor_registration('{"name":"QA ROLLBACK otro nombre"}'::jsonb);
  if vend_again.id is distinct from vend.id or vend_again.name is distinct from 'QA ROLLBACK Tintas Uno' then
    raise exception 'FAIL: registration is not idempotent';
  end if;
  if (select legal_name from public.supply_vendor_private where vendor_id = vend.id) is distinct from 'QA ROLLBACK Tintas SRL' then
    raise exception 'FAIL: supply_vendor_private row missing';
  end if;
  ok := false;
  begin perform 1 from public.supply_vendor_counters; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: clients can read supply_vendor_counters'; end if;

  -- Guard: el dueño no toca verificación, email de login ni slug.
  ok := false;
  begin update public.supply_vendors set is_verified = true where id = vend.id; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: vendor owner self-verified'; end if;
  ok := false;
  begin update public.supply_vendors set slug = 'qa-otro-slug' where id = vend.id; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: vendor owner changed slug'; end if;
  ok := false;
  begin update public.supply_vendors set email = 'qa-otro@example.invalid' where id = vend.id; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: vendor owner changed login email'; end if;
  update public.supply_vendors set description = 'QA ROLLBACK descripción' where id = vend.id;
  get diagnostics n = row_count;
  if n is distinct from 1 then raise exception 'FAIL: vendor owner cannot edit own profile'; end if;

  -- Catálogo del vendor 1 (moneda completada por el trigger).
  insert into public.supply_products(vendor_id, name, category, price) values (vend.id, 'QA ROLLBACK aguja A', 'needles_cartridges', 0.05) returning id into p_a;
  insert into public.supply_products(vendor_id, name, category, price) values (vend.id, 'QA ROLLBACK aguja B', 'needles_cartridges', 0.15) returning id into p_b;
  insert into public.supply_products(vendor_id, name, category, price) values (vend.id, 'QA ROLLBACK aguja C', 'needles_cartridges', 0.25) returning id into p_c;
  insert into public.supply_products(vendor_id, name, category, price, stock_quantity, unit_label, sku)
  values (vend.id, 'QA ROLLBACK tinta negra', 'inks', 100, 10, 'frasco', ink_sku) returning id into p_ink;
  insert into public.supply_products(vendor_id, name, category, price, stock_quantity, unit_label, pack_size, min_order_qty, sku)
  values (vend.id, 'QA ROLLBACK guantes', 'gloves', 50, 5, 'caja', 100, 2, glv_sku) returning id into p_gloves;
  insert into public.supply_products(vendor_id, name, category, price, is_active)
  values (vend.id, 'QA ROLLBACK archivado', 'other', 1, false) returning id into p_off;
  if (select currency from public.supply_products where id = p_ink) is distinct from 'ARS' then raise exception 'FAIL: product currency not defaulted to vendor currency'; end if;
  update public.supply_products set images = '["https://cdn.example.invalid/a.webp", {"url": "https://cdn.example.invalid/b.webp"}]'::jsonb where id = p_a;

  ok := false;
  begin insert into public.supply_products(vendor_id, name, category, price, currency) values (vend.id, 'QA ROLLBACK USD', 'other', 1, 'USD');
  exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception 'FAIL: product accepted a currency different from the vendor'; end if;
  ok := false;
  begin insert into public.supply_products(vendor_id, name, category, price, image_url) values (vend.id, 'QA ROLLBACK js', 'other', 1, 'javascript:alert(1)');
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL: product accepted a non-http image_url'; end if;
  ok := false;
  begin insert into public.supply_products(vendor_id, name, category, price, images) values (vend.id, 'QA ROLLBACK ftp', 'other', 1, '["ftp://x/y.png"]'::jsonb);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL: product accepted a non-http gallery URL'; end if;

  insert into public.supply_discount_tiers(vendor_id, min_subtotal, discount_pct, label) values (vend.id, 100, 5, 'QA Bronce');
  insert into public.supply_discount_tiers(vendor_id, min_subtotal, discount_pct, label) values (vend.id, 1000, 15, 'QA Oro');
  ok := false;
  begin insert into public.supply_discount_tiers(vendor_id, min_subtotal, discount_pct) values (vend.id, 5000, 70);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL: tier above 60%% accepted'; end if;

  -- Vendor 2.
  perform set_config('request.jwt.claim.sub', v2u::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', v2u, 'role', 'authenticated')::text, true);
  ok := false;
  begin perform public.complete_supply_vendor_registration('{"name":"QA ROLLBACK Insumos Dos","logo_image":"javascript:alert(1)"}'::jsonb);
  exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception 'FAIL: registration accepted a non-http logo'; end if;
  vend2 := public.complete_supply_vendor_registration(jsonb_build_object(
    'name', 'QA ROLLBACK Insumos Dos', 'currency', 'ARS', 'platform_discount_pct', 50, 'min_order_amount', 50));
  insert into public.supply_products(vendor_id, name, category, price) values (vend2.id, 'QA ROLLBACK guantes dos', 'gloves', 40) returning id into q_x;
  insert into public.supply_discount_tiers(vendor_id, min_subtotal, discount_pct) values (vend2.id, 0, 20);
  if exists (select 1 from public.supply_vendors where id = vend.id) then raise exception 'FAIL: unverified vendor visible to another vendor'; end if;
  ok := false;
  begin insert into public.supply_products(vendor_id, name, category, price) values (vend.id, 'QA ROLLBACK intruso', 'other', 1);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: vendor wrote products of another vendor'; end if;
  update public.supply_vendors set description = 'QA ROLLBACK hackeado' where id = vend.id;
  get diagnostics n = row_count;
  if n is distinct from 0 then raise exception 'FAIL: vendor updated another vendor'; end if;

  -- Estudio antes de la verificación: no ve vendors ni catálogo y no puede pedir.
  perform set_config('request.jwt.claim.sub', oa::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', oa, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.supply_vendors where id in (vend.id, vend2.id)) then raise exception 'FAIL: unverified vendors visible to studio'; end if;
  if exists (select 1 from public.supply_products where vendor_id = vend.id) then raise exception 'FAIL: unverified catalog visible to studio'; end if;
  ok := false;
  begin perform public.submit_supply_order(sid_a, vend.id, loc_a, jsonb_build_array(jsonb_build_object('product_id', p_ink, 'quantity', 1)));
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL: order accepted for an unverified vendor'; end if;
  ok := false;
  begin insert into public.supply_products(vendor_id, name, category, price) values (vend.id, 'QA ROLLBACK estudio intruso', 'other', 1);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: studio wrote vendor products'; end if;

  perform set_config('test.vendor1', vend.id::text, true);
  perform set_config('test.vendor2', vend2.id::text, true);
  perform set_config('test.p_a', p_a::text, true);
  perform set_config('test.p_b', p_b::text, true);
  perform set_config('test.p_c', p_c::text, true);
  perform set_config('test.p_ink', p_ink::text, true);
  perform set_config('test.p_gloves', p_gloves::text, true);
  perform set_config('test.p_off', p_off::text, true);
  perform set_config('test.q_x', q_x::text, true);
  perform set_config('test.glv_sku', glv_sku, true);
end $$;

-- Anónimo antes de la verificación.
set local role anon;
do $$
declare ok boolean;
begin
  perform set_config('request.jwt.claim.sub', '', true),
          set_config('request.jwt.claims', '{"role":"anon"}', true),
          set_config('request.jwt.claim.role', 'anon', true);
  -- supply_vendors expone email de login y user_id: sin lectura anónima.
  ok := false;
  begin perform 1 from public.supply_vendors limit 1; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: anon can read supply_vendors'; end if;
  ok := false;
  begin perform 1 from public.supply_products limit 1; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: anon can read supply_products'; end if;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end $$;

-- ---------------------------------------------------------------------
-- Verificación por soporte, importes y validaciones del pedido
-- ---------------------------------------------------------------------
set local role authenticated;
do $$
declare
  su uuid := current_setting('test.support_user')::uuid;
  oa uuid := current_setting('test.owner_a')::uuid;
  sid_a uuid := current_setting('test.studio_a')::uuid;
  sid_b uuid := current_setting('test.studio_b')::uuid;
  loc_a uuid := current_setting('test.loc_a')::uuid;
  loc_a_off uuid := current_setting('test.loc_a_off')::uuid;
  loc_b uuid := current_setting('test.loc_b')::uuid;
  item_a uuid := current_setting('test.item_a')::uuid;
  item_a_usd uuid := current_setting('test.item_a_usd')::uuid;
  item_b uuid := current_setting('test.item_b')::uuid;
  v1 uuid := current_setting('test.vendor1')::uuid;
  v2 uuid := current_setting('test.vendor2')::uuid;
  p_a uuid := current_setting('test.p_a')::uuid;
  p_b uuid := current_setting('test.p_b')::uuid;
  p_c uuid := current_setting('test.p_c')::uuid;
  p_ink uuid := current_setting('test.p_ink')::uuid;
  p_gloves uuid := current_setting('test.p_gloves')::uuid;
  p_off uuid := current_setting('test.p_off')::uuid;
  q_x uuid := current_setting('test.q_x')::uuid;
  o1 jsonb; o2 jsonb; o3 jsonb; o4 jsonb; o5 jsonb; o6 jsonb; o7 jsonb;
  ok boolean; n integer;
begin
  -- Soporte verifica (bypass del guard).
  perform set_config('request.jwt.claim.sub', su::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', su, 'role', 'authenticated')::text, true);
  update public.supply_vendors set is_verified = true, profile_complete = true where id in (v1, v2);
  get diagnostics n = row_count;
  if n is distinct from 2 then raise exception 'FAIL: support could not verify vendors (%)', n; end if;

  perform set_config('request.jwt.claim.sub', oa::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', oa, 'role', 'authenticated')::text, true);
  if (select count(*) from public.supply_vendors where id in (v1, v2)) is distinct from 2 then raise exception 'FAIL: verified vendors not visible to studio'; end if;
  if (select count(*) from public.supply_products where vendor_id = v1) is distinct from 5 or exists (select 1 from public.supply_products where id = p_off) then
    raise exception 'FAIL: studio catalog visibility (active only) broken';
  end if;
  update public.supply_vendors set name = 'QA ROLLBACK hackeado' where id = v1;
  get diagnostics n = row_count;
  if n is distinct from 0 then raise exception 'FAIL: studio updated a vendor'; end if;

  -- Pedido 1: resto de redondeo (10%%: 0.01 + 0.02 + 0.03 = 0.06 vs round(0.045) = 0.05).
  o1 := public.submit_supply_order(sid_a, v1, loc_a, jsonb_build_array(
    jsonb_build_object('product_id', p_a, 'quantity', 1),
    jsonb_build_object('product_id', p_b, 'quantity', 1),
    jsonb_build_object('product_id', p_c, 'quantity', 1)));
  if o1->>'status' is distinct from 'submitted' or (o1->>'subtotal')::numeric is distinct from 0.45 or (o1->>'discount_amount')::numeric is distinct from 0.05
     or (o1->>'total')::numeric is distinct from 0.40 or (o1->>'platform_discount_pct')::numeric is distinct from 10 or (o1->>'tier_discount_pct')::numeric is distinct from 0
     or (o1->>'shipping_amount')::numeric is distinct from 0 or o1->>'order_id' is distinct from o1->>'id' then
    raise exception 'FAIL: rounding order totals %', o1;
  end if;
  if o1->>'order_number' is distinct from 'P-' || to_char(timezone('utc', now()), 'YYYY') || '-00001' then
    raise exception 'FAIL: order number %', o1->>'order_number';
  end if;
  if (select line_discount from public.supply_order_items where order_id = (o1->>'id')::uuid and product_id = p_a) is distinct from 0.01
     or (select line_discount from public.supply_order_items where order_id = (o1->>'id')::uuid and product_id = p_b) is distinct from 0.02
     or (select line_discount from public.supply_order_items where order_id = (o1->>'id')::uuid and product_id = p_c) is distinct from 0.02
     or (select sum(line_discount) from public.supply_order_items where order_id = (o1->>'id')::uuid) is distinct from 0.05
     or (select sum(line_total) from public.supply_order_items where order_id = (o1->>'id')::uuid) is distinct from 0.40 then
    raise exception 'FAIL: rounding remainder not absorbed by the largest line';
  end if;

  -- Pedido 2: plataforma 10 + mejor tier aplicable (5; el de 1000 no aplica).
  o2 := public.submit_supply_order(sid_a, v1, loc_a, jsonb_build_array(
    jsonb_build_object('product_id', p_ink, 'quantity', 3, 'inventory_item_id', item_a),
    jsonb_build_object('product_id', p_gloves, 'quantity', 4)), 'QA ROLLBACK nota');
  if (o2->>'subtotal')::numeric is distinct from 500 or (o2->>'platform_discount_pct')::numeric is distinct from 10 or (o2->>'tier_discount_pct')::numeric is distinct from 5
     or (o2->>'discount_amount')::numeric is distinct from 75 or (o2->>'total')::numeric is distinct from 425 or o2->>'notes' is distinct from 'QA ROLLBACK nota'
     or o2->>'order_number' is distinct from 'P-' || to_char(timezone('utc', now()), 'YYYY') || '-00002'
     or jsonb_array_length(o2->'items') is distinct from 2 then
    raise exception 'FAIL: tier order totals %', o2;
  end if;
  if (select line_total from public.supply_order_items where order_id = (o2->>'id')::uuid and product_id = p_ink) is distinct from 255
     or (select line_total from public.supply_order_items where order_id = (o2->>'id')::uuid and product_id = p_gloves) is distinct from 170
     or (select pack_size from public.supply_order_items where order_id = (o2->>'id')::uuid and product_id = p_gloves) is distinct from 100 then
    raise exception 'FAIL: tier order lines';
  end if;

  -- Pedido 3: 50 + 20 recortado al tope de 60.
  o3 := public.submit_supply_order(sid_a, v2, loc_a, jsonb_build_array(jsonb_build_object('product_id', q_x, 'quantity', 2)));
  if (o3->>'subtotal')::numeric is distinct from 80 or (o3->>'platform_discount_pct')::numeric is distinct from 50 or (o3->>'tier_discount_pct')::numeric is distinct from 10
     or (o3->>'discount_amount')::numeric is distinct from 48 or (o3->>'total')::numeric is distinct from 32 then
    raise exception 'FAIL: 60%% cap %', o3;
  end if;

  -- Rechazos de submit.
  ok := false;
  begin perform public.submit_supply_order(sid_a, v2, loc_a, jsonb_build_array(jsonb_build_object('product_id', q_x, 'quantity', 1)));
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL: order below vendor minimum accepted'; end if;
  ok := false;
  begin perform public.submit_supply_order(sid_a, v1, loc_a, jsonb_build_array(jsonb_build_object('product_id', p_off, 'quantity', 1)));
  exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception 'FAIL: archived product ordered'; end if;
  ok := false;
  begin perform public.submit_supply_order(sid_a, v1, loc_a, jsonb_build_array(jsonb_build_object('product_id', p_gloves, 'quantity', 1)));
  exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception 'FAIL: quantity below min_order_qty accepted'; end if;
  ok := false;
  begin perform public.submit_supply_order(sid_a, v1, loc_a, jsonb_build_array(jsonb_build_object('product_id', p_ink, 'quantity', 11)));
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL: soft stock check missing'; end if;
  ok := false;
  begin perform public.submit_supply_order(sid_a, v1, loc_a, jsonb_build_array(jsonb_build_object('product_id', p_ink, 'quantity', 1, 'inventory_item_id', item_b)));
  exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception 'FAIL: cross-tenant inventory_item_id accepted'; end if;
  ok := false;
  begin perform public.submit_supply_order(sid_a, v1, loc_b, jsonb_build_array(jsonb_build_object('product_id', p_ink, 'quantity', 1)));
  exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception 'FAIL: cross-tenant location accepted'; end if;
  ok := false;
  begin perform public.submit_supply_order(sid_a, v1, loc_a_off, jsonb_build_array(jsonb_build_object('product_id', p_ink, 'quantity', 1)));
  exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception 'FAIL: inactive location accepted'; end if;
  ok := false;
  begin perform public.submit_supply_order(sid_b, v1, loc_b, jsonb_build_array(jsonb_build_object('product_id', p_ink, 'quantity', 1)));
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: order placed for a foreign studio'; end if;
  ok := false;
  begin perform public.submit_supply_order(sid_a, v1, loc_a, jsonb_build_array(jsonb_build_object('product_id', q_x, 'quantity', 2)));
  exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception 'FAIL: product of another vendor accepted'; end if;
  ok := false;
  begin perform public.submit_supply_order(sid_a, v1, loc_a, '[]'::jsonb);
  exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception 'FAIL: empty order accepted'; end if;
  ok := false;
  begin perform public.submit_supply_order(sid_a, v1, loc_a, jsonb_build_array(
    jsonb_build_object('product_id', p_ink, 'quantity', 1), jsonb_build_object('product_id', p_ink, 'quantity', 2)));
  exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception 'FAIL: duplicated product accepted'; end if;

  -- El estudio no escribe pedidos directamente.
  ok := false;
  begin insert into public.supply_orders(order_number, studio_id, vendor_id, currency) values ('P-2026-99999', sid_a, v1, 'ARS');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: studio inserted an order directly'; end if;
  ok := false;
  begin update public.supply_orders set total = 0 where id = (o2->>'id')::uuid;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: studio updated an order directly'; end if;
  ok := false;
  begin insert into public.supply_order_items(order_id, product_name, unit_label, quantity, unit_price, line_subtotal, line_total)
        values ((o2->>'id')::uuid, 'QA ROLLBACK', 'u', 1, 0, 0, 0);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: studio inserted order items directly'; end if;
  ok := false;
  begin delete from public.supply_order_events where order_id = (o2->>'id')::uuid;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: studio deleted order events'; end if;
  if (select count(*) from public.supply_order_items where order_id = (o2->>'id')::uuid) is distinct from 2
     or (select count(*) from public.supply_order_events where order_id = (o2->>'id')::uuid and to_status = 'submitted' and actor_role = 'studio') is distinct from 1 then
    raise exception 'FAIL: studio cannot read its own order lines/events';
  end if;

  -- Pedidos para la máquina de estados (el stock se reserva recién al confirmar).
  o4 := public.submit_supply_order(sid_a, v1, loc_a, jsonb_build_array(jsonb_build_object('product_id', p_ink, 'quantity', 8)));
  o5 := public.submit_supply_order(sid_a, v1, loc_a, jsonb_build_array(jsonb_build_object('product_id', p_ink, 'quantity', 6)));
  o6 := public.submit_supply_order(sid_a, v1, loc_a, jsonb_build_array(jsonb_build_object('product_id', p_ink, 'quantity', 1)));
  o7 := public.submit_supply_order(sid_a, v1, loc_a, jsonb_build_array(jsonb_build_object('product_id', p_ink, 'quantity', 1, 'inventory_item_id', item_a_usd)));
  if (o6->>'total')::numeric is distinct from 85 or (o5->>'total')::numeric is distinct from 510 then raise exception 'FAIL: tier boundary (min_subtotal <= subtotal)'; end if;

  perform set_config('test.o1', o1->>'id', true);
  perform set_config('test.o2', o2->>'id', true);
  perform set_config('test.o3', o3->>'id', true);
  perform set_config('test.o4', o4->>'id', true);
  perform set_config('test.o5', o5->>'id', true);
  perform set_config('test.o6', o6->>'id', true);
  perform set_config('test.o7', o7->>'id', true);
end $$;

-- ---------------------------------------------------------------------
-- Aislamiento entre vendors y estudios
-- ---------------------------------------------------------------------
do $$
declare
  v2u uuid := current_setting('test.vendor2_user')::uuid;
  ob uuid := current_setting('test.owner_b')::uuid;
  su uuid := current_setting('test.support_user')::uuid;
  o2 uuid := current_setting('test.o2')::uuid;
  o3 uuid := current_setting('test.o3')::uuid;
  ok boolean;
begin
  perform set_config('request.jwt.claim.sub', v2u::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', v2u, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.supply_orders where id = o2)
     or exists (select 1 from public.supply_order_items where order_id = o2)
     or exists (select 1 from public.supply_order_events where order_id = o2) then
    raise exception 'FAIL: vendor reads another vendor orders';
  end if;
  if not exists (select 1 from public.supply_orders where id = o3) then raise exception 'FAIL: vendor cannot read its own order'; end if;
  ok := false;
  begin perform public.vendor_update_supply_order(o2, 'confirm'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: vendor confirmed another vendor order'; end if;

  perform set_config('request.jwt.claim.sub', ob::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', ob, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.supply_orders where id = o2) or exists (select 1 from public.supply_order_items where order_id = o2) then
    raise exception 'FAIL: foreign studio reads the order';
  end if;
  ok := false;
  begin perform public.cancel_supply_order(o2); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: foreign studio cancelled the order'; end if;
  ok := false;
  begin perform public.receive_supply_order(o2); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: foreign studio received the order'; end if;

  perform set_config('request.jwt.claim.sub', su::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', su, 'role', 'authenticated')::text, true);
  if (select count(*) from public.supply_orders where id in (o2, o3)) is distinct from 2 then raise exception 'FAIL: support cannot read all orders'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Máquina de estados, stock del vendor y cancelaciones
-- ---------------------------------------------------------------------
do $$
declare
  v1u uuid := current_setting('test.vendor1_user')::uuid;
  oa uuid := current_setting('test.owner_a')::uuid;
  p_ink uuid := current_setting('test.p_ink')::uuid;
  p_gloves uuid := current_setting('test.p_gloves')::uuid;
  o1 uuid := current_setting('test.o1')::uuid;
  o2 uuid := current_setting('test.o2')::uuid;
  o4 uuid := current_setting('test.o4')::uuid;
  o5 uuid := current_setting('test.o5')::uuid;
  o6 uuid := current_setting('test.o6')::uuid;
  o7 uuid := current_setting('test.o7')::uuid;
  res jsonb; ok boolean;
begin
  perform set_config('request.jwt.claim.sub', v1u::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', v1u, 'role', 'authenticated')::text, true);
  if (select count(*) from public.supply_orders where id in (o1, o2)) is distinct from 2 then raise exception 'FAIL: vendor cannot read its orders'; end if;
  ok := false;
  begin perform public.vendor_update_supply_order(o2, 'teleport'); exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception 'FAIL: invalid action accepted'; end if;
  ok := false;
  begin perform public.vendor_update_supply_order(o4, 'deliver'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL: submitted order delivered'; end if;

  -- Confirmar: descuenta stock y cobra envío (425 < umbral 500).
  res := public.vendor_update_supply_order(o2, 'confirm', 25, null, current_date + 3, 'QA ROLLBACK confirmado');
  if res->>'status' is distinct from 'confirmed' or (res->>'shipping_amount')::numeric is distinct from 25 or (res->>'total')::numeric is distinct from 450
     or (res->>'estimated_delivery')::date is distinct from current_date + 3 or res->>'vendor_note' is distinct from 'QA ROLLBACK confirmado' then
    raise exception 'FAIL: confirm %', res;
  end if;
  if (select stock_quantity from public.supply_products where id = p_ink) is distinct from 7
     or (select stock_quantity from public.supply_products where id = p_gloves) is distinct from 1
     or (select stock_decremented from public.supply_order_items where order_id = o2 and product_id = p_gloves) is distinct from 4 then
    raise exception 'FAIL: confirm did not reserve vendor stock';
  end if;
  ok := false;
  begin perform public.vendor_update_supply_order(o2, 'reject'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL: confirmed order rejected'; end if;

  -- Stock insuficiente al confirmar (7 < 8): nada cambia.
  ok := false;
  begin perform public.vendor_update_supply_order(o4, 'confirm');
  exception when check_violation then ok := sqlerrm like 'Stock insuficiente para %'; end;
  if not ok then raise exception 'FAIL: confirm without stock accepted'; end if;
  if (select stock_quantity from public.supply_products where id = p_ink) is distinct from 7
     or (select status from public.supply_orders where id = o4) is distinct from 'submitted' then
    raise exception 'FAIL: failed confirm left side effects';
  end if;

  -- Envío gratis: subtotal − descuento = 510 ≥ 500 ignora el envío pedido.
  res := public.vendor_update_supply_order(o5, 'confirm', 99);
  if (res->>'shipping_amount')::numeric is distinct from 0 or (res->>'total')::numeric is distinct from 510
     or (select stock_quantity from public.supply_products where id = p_ink) is distinct from 1 then
    raise exception 'FAIL: free shipping threshold %', res;
  end if;

  -- El estudio cancela: desde confirmed devuelve stock_decremented; desde submitted no toca stock.
  perform set_config('request.jwt.claim.sub', oa::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', oa, 'role', 'authenticated')::text, true);
  res := public.cancel_supply_order(o5, 'QA ROLLBACK ya no lo necesito');
  if res->>'status' is distinct from 'cancelled' or res->>'cancelled_at' is null
     or (select stock_quantity from public.supply_products where id = p_ink) is distinct from 7
     or (select stock_decremented from public.supply_order_items where order_id = o5) is distinct from 0 then
    raise exception 'FAIL: studio cancel did not restore stock';
  end if;
  res := public.cancel_supply_order(o4);
  if res->>'status' is distinct from 'cancelled' or (select stock_quantity from public.supply_products where id = p_ink) is distinct from 7 then
    raise exception 'FAIL: cancel from submitted';
  end if;
  ok := false;
  begin perform public.cancel_supply_order(o4); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL: cancelled order cancelled twice'; end if;
  ok := false;
  begin perform public.receive_supply_order(o2); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL: confirmed (not shipped) order received'; end if;

  -- El vendor cancela un confirmado: devuelve el stock.
  perform set_config('request.jwt.claim.sub', v1u::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', v1u, 'role', 'authenticated')::text, true);
  res := public.vendor_update_supply_order(o6, 'confirm', 10);
  if (res->>'total')::numeric is distinct from 95 or (select stock_quantity from public.supply_products where id = p_ink) is distinct from 6 then
    raise exception 'FAIL: confirm o6 %', res;
  end if;
  res := public.vendor_update_supply_order(o6, 'cancel', null, null, null, 'QA ROLLBACK sin stock real');
  if res->>'status' is distinct from 'cancelled' or (select stock_quantity from public.supply_products where id = p_ink) is distinct from 7 then
    raise exception 'FAIL: vendor cancel did not restore stock';
  end if;

  res := public.vendor_update_supply_order(o7, 'confirm', 10);
  if (select stock_quantity from public.supply_products where id = p_ink) is distinct from 6 then raise exception 'FAIL: confirm o7'; end if;
  res := public.vendor_update_supply_order(o2, 'ship', null, 'QA-TRACK-1');
  if res->>'status' is distinct from 'shipped' or res->>'tracking_code' is distinct from 'QA-TRACK-1' or res->>'shipped_at' is null then
    raise exception 'FAIL: ship %', res;
  end if;
  perform public.vendor_update_supply_order(o7, 'ship');
  res := public.vendor_update_supply_order(o7, 'deliver');
  if res->>'status' is distinct from 'delivered' then raise exception 'FAIL: deliver'; end if;
  if (select count(*) from public.supply_order_events where order_id = o2 and actor_role = 'vendor') is distinct from 2 then
    raise exception 'FAIL: vendor transitions not logged';
  end if;

  perform set_config('request.jwt.claim.sub', oa::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', oa, 'role', 'authenticated')::text, true);
  ok := false;
  begin perform public.cancel_supply_order(o2); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL: shipped order cancelled by studio'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Recepción: parcial con pack_size, idempotente, moneda distinta y gasto
-- ---------------------------------------------------------------------
do $$
declare
  oa uuid := current_setting('test.owner_a')::uuid;
  ob uuid := current_setting('test.owner_b')::uuid;
  sid_a uuid := current_setting('test.studio_a')::uuid;
  item_a uuid := current_setting('test.item_a')::uuid;
  item_a_usd uuid := current_setting('test.item_a_usd')::uuid;
  v1 uuid := current_setting('test.vendor1')::uuid;
  p_ink uuid := current_setting('test.p_ink')::uuid;
  p_gloves uuid := current_setting('test.p_gloves')::uuid;
  o2 uuid := current_setting('test.o2')::uuid;
  o7 uuid := current_setting('test.o7')::uuid;
  ink_line uuid; gloves_line uuid; gloves_item public.studio_inventory_items; supplier uuid;
  r2 jsonb; r2_again jsonb; r7 jsonb; ok boolean; movements_before integer;
begin
  perform set_config('request.jwt.claim.sub', oa::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', oa, 'role', 'authenticated')::text, true);
  select id into ink_line from public.supply_order_items where order_id = o2 and product_id = p_ink;
  select id into gloves_line from public.supply_order_items where order_id = o2 and product_id = p_gloves;

  ok := false;
  begin perform public.receive_supply_order(o7, jsonb_build_array(jsonb_build_object('item_id', ink_line, 'received_quantity', 1)));
  exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception 'FAIL: receive accepted a line of another order'; end if;
  ok := false;
  begin perform public.receive_supply_order(o2, jsonb_build_array(jsonb_build_object('item_id', ink_line, 'received_quantity', 4)));
  exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception 'FAIL: received more than ordered'; end if;
  ok := false;
  begin perform public.receive_supply_order(o2, jsonb_build_array(jsonb_build_object('item_id', ink_line, 'received_quantity', -1)));
  exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception 'FAIL: negative received quantity accepted'; end if;

  -- Parcial: tinta 3/3 al ítem vinculado, guantes 2/4 cajas de 100 → ítem nuevo.
  r2 := public.receive_supply_order(o2, jsonb_build_array(
    jsonb_build_object('item_id', ink_line, 'received_quantity', 3),
    jsonb_build_object('item_id', gloves_line, 'received_quantity', 2)));
  if (r2->>'partial')::boolean is not true or jsonb_array_length(r2->'shortages') is distinct from 1
     or (r2->'shortages'->0->>'missing')::numeric is distinct from 2 or jsonb_array_length(r2->'movements') is distinct from 2
     or jsonb_array_length(r2->'currency_mismatches') is distinct from 0 or (r2->'expense'->>'amount')::numeric is distinct from 365 then
    raise exception 'FAIL: partial receive result %', r2;
  end if;
  if (select quantity_on_hand from public.studio_inventory_items where id = item_a) is distinct from 5
     or (select supply_product_id from public.studio_inventory_items where id = item_a) is distinct from p_ink then
    raise exception 'FAIL: linked inventory item not restocked';
  end if;
  if not exists (select 1 from public.studio_inventory_movements where item_id = item_a and kind = 'restock' and quantity = 3 and unit_cost = 85) then
    raise exception 'FAIL: restock movement for linked item (unit_cost = line_total / qty)';
  end if;
  select * into gloves_item from public.studio_inventory_items where studio_id = sid_a and supply_product_id = p_gloves;
  if gloves_item.id is null or gloves_item.quantity_on_hand is distinct from 200 or gloves_item.unit is distinct from 'unidad'
     or gloves_item.cost_per_unit is distinct from 0.425 or gloves_item.currency is distinct from 'ARS'
     or gloves_item.sku is distinct from current_setting('test.glv_sku') then
    raise exception 'FAIL: created inventory item from pack_size %', to_jsonb(gloves_item);
  end if;
  if not exists (select 1 from public.studio_inventory_movements where item_id = gloves_item.id and kind = 'restock' and quantity = 200 and unit_cost = 0.425) then
    raise exception 'FAIL: pack_size restock movement';
  end if;
  select id into supplier from public.studio_suppliers where studio_id = sid_a and vendor_id = v1;
  if supplier is null or gloves_item.supplier_id is distinct from supplier then raise exception 'FAIL: studio_suppliers link to the vendor'; end if;
  if (select count(*) from public.studio_finance_entries where supply_order_id = o2) is distinct from 1
     or not exists (
       select 1 from public.studio_finance_entries
       where supply_order_id = o2 and entry_type = 'expense' and category = 'inventory_purchase' and status = 'recorded'
         and amount = 365 and currency = 'ARS' and counterparty = 'QA ROLLBACK Tintas Uno' and supplier_id = supplier
     ) then
    raise exception 'FAIL: partial receipt expense (255 + 85 + envío 25)';
  end if;
  if (select status from public.supply_orders where id = o2) is distinct from 'received'
     or (select received_quantity from public.supply_order_items where id = gloves_line) is distinct from 2
     or not exists (select 1 from public.supply_order_events where order_id = o2 and to_status = 'received' and note = 'Recepción parcial') then
    raise exception 'FAIL: received state / partial event';
  end if;

  -- Idempotente: misma respuesta, sin stock, movimientos ni gastos nuevos.
  select count(*) into movements_before from public.studio_inventory_movements where item_id in (item_a, gloves_item.id);
  r2_again := public.receive_supply_order(o2, jsonb_build_array(jsonb_build_object('item_id', ink_line, 'received_quantity', 1)));
  if r2_again is distinct from r2
     or (select quantity_on_hand from public.studio_inventory_items where id = item_a) is distinct from 5
     or (select quantity_on_hand from public.studio_inventory_items where id = gloves_item.id) is distinct from 200
     or (select count(*) from public.studio_inventory_movements where item_id in (item_a, gloves_item.id)) is distinct from movements_before
     or (select count(*) from public.studio_finance_entries where supply_order_id = o2) is distinct from 1 then
    raise exception 'FAIL: receive is not idempotent';
  end if;

  perform set_config('request.jwt.claim.sub', ob::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', ob, 'role', 'authenticated')::text, true);
  ok := false;
  begin perform public.receive_supply_order(o7); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: foreign studio received o7'; end if;

  -- Moneda distinta: el ítem USD recibe stock pero no el costo ARS.
  perform set_config('request.jwt.claim.sub', oa::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', oa, 'role', 'authenticated')::text, true);
  r7 := public.receive_supply_order(o7);
  if (r7->>'partial')::boolean or jsonb_array_length(r7->'currency_mismatches') is distinct from 1
     or (r7->'items'->0->>'currency_mismatch')::boolean is not true or (r7->'expense'->>'amount')::numeric is distinct from 95 then
    raise exception 'FAIL: currency mismatch receive %', r7;
  end if;
  if (select quantity_on_hand from public.studio_inventory_items where id = item_a_usd) is distinct from 1
     or (select supply_product_id from public.studio_inventory_items where id = item_a_usd) is not null
     or (select cost_per_unit from public.studio_inventory_items where id = item_a_usd) is distinct from 7.77
     or not exists (select 1 from public.studio_inventory_movements where item_id = item_a_usd and kind = 'restock' and quantity = 1 and unit_cost is null)
     or exists (select 1 from public.studio_inventory_movements where item_id = item_a_usd and unit_cost is not null) then
    raise exception 'FAIL: currency mismatch leaked the order cost into the USD item (restock unit_cost must stay null)';
  end if;
  if not exists (select 1 from public.supply_order_events where order_id = o7 and to_status = 'received' and note = 'Pedido recibido') then
    raise exception 'FAIL: full receipt event';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Reportes del vendor, privilegios y helper de storage
-- ---------------------------------------------------------------------
do $$
declare
  v1u uuid := current_setting('test.vendor1_user')::uuid;
  v2u uuid := current_setting('test.vendor2_user')::uuid;
  ob uuid := current_setting('test.owner_b')::uuid;
  oa uuid := current_setting('test.owner_a')::uuid;
  su uuid := current_setting('test.support_user')::uuid;
  sid_a uuid := current_setting('test.studio_a')::uuid;
  v1 uuid := current_setting('test.vendor1')::uuid;
  v2 uuid := current_setting('test.vendor2')::uuid;
  rec record;
begin
  perform set_config('request.jwt.claim.sub', v1u::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', v1u, 'role', 'authenticated')::text, true);
  select orders, total, studio_name into rec from public.supply_vendor_customers where vendor_id = v1 and studio_id = sid_a;
  if rec.orders is distinct from 2 or rec.total is distinct from 545 or rec.studio_name is distinct from 'QA ROLLBACK supplies studio A' then
    raise exception 'FAIL: supply_vendor_customers %', to_jsonb(rec);
  end if;
  select sum(orders) as orders, sum(gross) as gross, sum(discounts) as discounts, sum(shipping) as shipping, sum(net) as net, sum(units) as units
    into rec from public.supply_vendor_sales_monthly where vendor_id = v1;
  if rec.orders is distinct from 2 or rec.gross is distinct from 600 or rec.discounts is distinct from 90 or rec.shipping is distinct from 35 or rec.net is distinct from 545 or rec.units is distinct from 8 then
    raise exception 'FAIL: supply_vendor_sales_monthly %', to_jsonb(rec);
  end if;
  if not private.can_manage_supply_storage_path(v1::text || '/products/qa.webp')
     or private.can_manage_supply_storage_path(v2::text || '/products/qa.webp')
     or private.can_manage_supply_storage_path('qa.webp') then
    raise exception 'FAIL: storage helper for vendor owner';
  end if;

  perform set_config('request.jwt.claim.sub', v2u::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', v2u, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.supply_vendor_sales_monthly where vendor_id = v1)
     or exists (select 1 from public.supply_vendor_customers where vendor_id = v1) then
    raise exception 'FAIL: vendor reports leak across vendors';
  end if;

  perform set_config('request.jwt.claim.sub', ob::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', ob, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.supply_vendor_customers where studio_id = sid_a) then raise exception 'FAIL: vendor customers leak to other studios'; end if;

  perform set_config('request.jwt.claim.sub', oa::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', oa, 'role', 'authenticated')::text, true);
  if private.can_manage_supply_storage_path(v1::text || '/products/qa.webp') then raise exception 'FAIL: studio can manage vendor photos'; end if;

  perform set_config('request.jwt.claim.sub', su::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', su, 'role', 'authenticated')::text, true);
  if not private.can_manage_supply_storage_path(v2::text || '/products/qa.webp') then raise exception 'FAIL: support cannot manage vendor photos'; end if;

  if has_table_privilege('anon', 'public.supply_orders', 'SELECT')
     or has_table_privilege('anon', 'public.supply_vendor_sales_monthly', 'SELECT')
     or has_table_privilege('anon', 'public.supply_vendor_customers', 'SELECT')
     or has_table_privilege('authenticated', 'public.supply_orders', 'INSERT')
     or has_table_privilege('authenticated', 'public.supply_vendor_counters', 'SELECT')
     or has_function_privilege('anon', 'public.submit_supply_order(uuid,uuid,uuid,jsonb,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.receive_supply_order(uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_supply_vendor_registration(jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.vendor_update_supply_order(uuid,text,numeric,text,date,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.cancel_supply_order(uuid,text)', 'EXECUTE') then
    raise exception 'FAIL: grants on supplies tables / RPCs';
  end if;
end $$;

-- Anónimo después de la verificación: ve los vendors verificados, no pedidos.
set local role anon;
do $$
declare ok boolean;
begin
  perform set_config('request.jwt.claim.sub', '', true),
          set_config('request.jwt.claims', '{"role":"anon"}', true),
          set_config('request.jwt.claim.role', 'anon', true);
  if (select count(*) from public.supply_vendors where id in (current_setting('test.vendor1')::uuid, current_setting('test.vendor2')::uuid)) is distinct from 2 then
    raise exception 'FAIL: anon cannot read verified vendors';
  end if;
  ok := false;
  begin perform 1 from public.supply_orders limit 1; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: anon can read supply_orders'; end if;
end $$;

reset role;
do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'supply-photos' and public and file_size_limit = 10485760
      and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']
      and cardinality(allowed_mime_types) = 3
  ) then
    raise exception 'FAIL: supply-photos bucket config';
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('supply_photos_owner_insert', 'supply_photos_owner_update', 'supply_photos_owner_delete')
        and coalesce(qual, '') || coalesce(with_check, '') like '%can_manage_supply_storage_path%') is distinct from 3 then
    raise exception 'FAIL: supply-photos write policies';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
        and coalesce(qual, '') || coalesce(with_check, '') like '%supply-photos%'
        and (roles @> array['anon']::name[] or roles @> array['public']::name[])) then
    raise exception 'FAIL: supply-photos exposes a policy to anon/public';
  end if;
  if (select order_seq from public.supply_vendor_counters where vendor_id = current_setting('test.vendor1')::uuid) is distinct from 6 then
    raise exception 'FAIL: order numbering consumed numbers on rejected orders';
  end if;
  if (select stock_quantity from public.supply_products where id = current_setting('test.p_ink')::uuid) is distinct from 6
     or (select stock_quantity from public.supply_products where id = current_setting('test.p_gloves')::uuid) is distinct from 1 then
    raise exception 'FAIL: final vendor stock';
  end if;
end $$;
SELECT 'PASS: supplies registration/guard, RLS, pricing (tier, 60 cap, rounding), cross-tenant guards, order state machine, stock, partial/idempotent receipt, currency mismatch, finance expense, vendor reports and storage' AS result;
rollback;
