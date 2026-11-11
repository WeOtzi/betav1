-- Reversa de supabase/migrations/20261030150000_store_core.sql
-- (Store del artista: catálogo, pedidos, pagos, licencias y buckets).
-- Orden inverso: policies de Storage, buckets (solo si están vacíos), funciones
-- con firma, triggers y tablas. Los helpers que usan las policies de las
-- tablas se borran al final, cuando las tablas (y sus policies) ya no existen.
-- No toca tablas preexistentes: los movimientos del wallet con
-- metadata_json.source = 'store' quedan en artist_wallet_movements.
-- Los archivos quedan en los buckets hasta que se vacíen a mano (Storage no
-- permite borrar un bucket con objetos).
-- Las claves store_* sembradas en app_settings (privadas, valores neutros)
-- quedan: puede que soporte ya las haya configurado.

begin;

-- ===================== Storage =====================
drop policy if exists "store_previews_owner_select" on storage.objects;
drop policy if exists "store_previews_owner_insert" on storage.objects;
drop policy if exists "store_previews_owner_delete" on storage.objects;
drop policy if exists "store_design_files_owner_select" on storage.objects;
drop policy if exists "store_design_files_owner_insert" on storage.objects;
drop policy if exists "store_design_files_owner_delete" on storage.objects;

delete from storage.buckets
 where id = 'store-previews'
   and not exists (select 1 from storage.objects o where o.bucket_id = 'store-previews');
delete from storage.buckets
 where id = 'store-design-files'
   and not exists (select 1 from storage.objects o where o.bucket_id = 'store-design-files');

-- ===================== RPC =====================
drop function if exists public.confirm_store_order_payment_as_provider(uuid, text, text, numeric, text);
drop function if exists public.run_store_maintenance();
drop function if exists public.release_store_order_funds(uuid);
drop function if exists public.verify_store_license(text);
drop function if exists public.get_public_store_product(uuid);
drop function if exists public.get_public_storefront(text, text);
drop function if exists public.resolve_store_order_flag(uuid, text);
drop function if exists public.set_store_order_funds_hold(uuid, boolean, text);
drop function if exists public.get_store_sales_report(text, uuid, date, date);
drop function if exists public.adjust_store_variant_stock(uuid, integer, integer);
drop function if exists public.refund_store_order(uuid, text);
drop function if exists public.update_store_order_fulfillment(uuid, text, text, text, text, text);
drop function if exists public.confirm_store_order_payment(uuid, text, text, text);
drop function if exists public.store_apply_order_payment(uuid, text, text, text, text, numeric, text, uuid, boolean);
drop function if exists public.cancel_store_order(uuid, text);
drop function if exists public.mark_store_license_used(uuid, text);
drop function if exists public.confirm_store_order_received(uuid);
drop function if exists public.report_store_payment(uuid, text);
drop function if exists public.create_store_order(uuid, uuid, integer, text, text, text, jsonb, text, text, text);

-- ===================== helpers internos =====================
drop function if exists public.store_public_seller_bundle(text, uuid);
drop function if exists public.store_public_product_json(public.store_products);
drop function if exists public.store_finish_delivery(uuid, text);
drop function if exists public.store_wallet_upsert_payment(public.store_orders);
drop function if exists public.store_wallet_insert(public.store_orders, text, numeric, text, text);
drop function if exists public.store_close_unpaid_order(uuid, text, text);
drop function if exists public.store_try_lock_order(uuid);
drop function if exists public.store_lock_order(uuid);
drop function if exists public.store_new_license_code();
drop function if exists public.store_new_order_number();
drop function if exists public.store_platform_fee_pct();
drop function if exists public.store_app_setting(text);
drop function if exists public.store_order_lapsed(public.store_orders);
drop function if exists public.store_order_uses_wallet(public.store_orders);

-- ===================== triggers =====================
drop trigger if exists trg_store_seller_settings_guard on public.store_seller_settings;
drop trigger if exists trg_store_design_assets_guard on public.store_design_assets;
drop trigger if exists trg_store_product_variants_guard on public.store_product_variants;
drop trigger if exists trg_store_products_guard on public.store_products;
drop trigger if exists trg_store_orders_updated_at on public.store_orders;

drop function if exists public.store_seller_settings_guard();
drop function if exists public.store_design_assets_guard();
drop function if exists public.store_product_variants_guard();
drop function if exists public.store_products_guard();

-- ===================== tablas =====================
drop table if exists public.store_order_support_notes;
drop table if exists public.store_download_events;
drop table if exists public.store_licenses;
drop table if exists public.store_payments;
drop table if exists public.store_order_items;
alter table if exists public.store_products drop constraint if exists store_products_reserved_order_fkey;
drop table if exists public.store_orders;
drop table if exists public.store_design_assets;
drop table if exists public.store_product_variants;
drop table if exists public.store_seller_settings;
drop table if exists public.store_products;

-- ===================== helpers de las policies =====================
drop function if exists public.store_current_terms_version();
drop function if exists public.store_can_manage_storage_folder(text);
drop function if exists public.store_can_manage_seller(text, uuid);
drop function if exists public.store_seller_ready_artist(uuid);

notify pgrst, 'reload schema';

commit;
