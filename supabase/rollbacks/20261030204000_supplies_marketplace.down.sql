-- Reversa de supabase/migrations/20261030204000_supplies_marketplace.sql
-- (M5: cuentas Supplies, catálogo, pedidos de reposición y bucket supply-photos).
--
-- Deshace en orden inverso:
--   1. Policies y bucket supply-photos (el bucket solo se borra si está vacío:
--      Storage no permite borrar un bucket con objetos; vacialo antes desde la API).
--   2. Vistas y RPC de pedidos y registro.
--   3. public.handle_new_user vuelve a la definición viva previa a M5 (replace inverso).
--   4. FK studio_finance_entries.supply_order_id y columnas vendor_id /
--      supply_product_id. Los gastos ya registrados se conservan: su
--      supply_order_id queda como referencia histórica sin FK. Los proveedores
--      e ítems de inventario creados al recibir pedidos también se conservan.
--   5. Tablas supply_* y funciones auxiliares.
-- Se corre antes de las reversas de M4…M1.

begin;

-- 1. Storage
drop policy if exists "supply_photos_owner_select" on storage.objects;
drop policy if exists "supply_photos_owner_insert" on storage.objects;
drop policy if exists "supply_photos_owner_update" on storage.objects;
drop policy if exists "supply_photos_owner_delete" on storage.objects;

do $$
begin
  if not exists (select 1 from storage.objects o where o.bucket_id = 'supply-photos') then
    -- storage.protect_delete exige esta marca para borrar filas de storage.buckets.
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.buckets where id = 'supply-photos';
    perform set_config('storage.allow_delete_query', 'false', true);
  else
    raise notice 'supply-photos tiene objetos: el bucket queda hasta vaciarlo desde la API de Storage.';
  end if;
end $$;

drop function if exists private.can_manage_supply_storage_path(text);

-- 2. Vistas y RPC
drop view if exists public.supply_vendor_customers;
drop view if exists public.supply_vendor_sales_monthly;

drop function if exists public.receive_supply_order(uuid, jsonb);
drop function if exists public.vendor_update_supply_order(uuid, text, numeric, text, date, text);
drop function if exists public.cancel_supply_order(uuid, text);
drop function if exists public.submit_supply_order(uuid, uuid, uuid, jsonb, text);
drop function if exists private.restore_supply_order_stock(uuid);
drop function if exists private.supply_order_json(uuid);
drop function if exists private.supply_order_status_label(text);

-- 3. handle_new_user: se revierte exactamente el replace de M5 sobre la
--    definición viva (pg_get_functiondef), así no se pisa un cambio posterior.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.handle_new_user()'::regprocedure) into v_definition;
  if position($q$NOT IN ('client', 'studio', 'supplies')$q$ in v_definition) = 0 then
    return;
  end if;
  v_definition := replace(v_definition, $q$NOT IN ('client', 'studio', 'supplies')$q$, $q$NOT IN ('client', 'studio')$q$);
  execute v_definition;
end
$$;

drop function if exists public.complete_supply_vendor_registration(jsonb);
drop function if exists private.complete_supply_vendor_registration(jsonb);
drop function if exists private.supply_jsonb_text_array(jsonb);

-- 4. Vínculos en tablas existentes
do $$
begin
  if to_regclass('public.studio_finance_entries') is not null then
    alter table public.studio_finance_entries
      drop constraint if exists studio_finance_entries_supply_order_id_fkey;
  end if;
end $$;

drop index if exists public.idx_inv_items_supply_product;
alter table public.studio_inventory_items drop column if exists supply_product_id;
drop index if exists public.studio_suppliers_studio_vendor_key;
alter table public.studio_suppliers drop column if exists vendor_id;

-- 5. Tablas y funciones auxiliares
drop table if exists public.supply_order_events;
drop table if exists public.supply_order_items;
drop table if exists public.supply_orders;
drop table if exists public.supply_discount_tiers;
drop table if exists public.supply_products;
drop table if exists public.supply_vendor_counters;
drop table if exists public.supply_vendor_private;
drop table if exists public.supply_vendors;

drop function if exists private.guard_supply_vendor_write();
drop function if exists private.enforce_supply_vendor_currency();
drop function if exists private.is_supply_vendor_owner(uuid);
drop function if exists public.set_supply_updated_at();
drop function if exists private.supply_image_list_ok(jsonb);
drop function if exists private.supply_iso2_list_ok(text[]);
drop function if exists private.supply_text_items_ok(text[], integer, integer);

notify pgrst, 'reload schema';
commit;
