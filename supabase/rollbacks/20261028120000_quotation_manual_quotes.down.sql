-- Reversa de supabase/migrations/20261028120000_quotation_manual_quotes.sql
-- Quita la creación de cotizaciones manuales, los borradores/desgloses y la
-- libreta de clientes del artista. Las filas de quotations_db ya creadas con
-- source = 'manual' NO se borran (siguen siendo cotizaciones válidas; solo se
-- pierde su desglose económico). El frontend degrada solo: /my-quotations/new
-- guarda el borrador en el navegador y avisa que falta la migración.

begin;

drop function if exists public.create_manual_quotation(jsonb, jsonb);

drop policy if exists artist_manual_quotes_client_select on public.artist_manual_quotes;
drop policy if exists artist_manual_quotes_owner_delete on public.artist_manual_quotes;
drop policy if exists artist_manual_quotes_owner_update on public.artist_manual_quotes;
drop policy if exists artist_manual_quotes_owner_insert on public.artist_manual_quotes;
drop policy if exists artist_manual_quotes_owner_select on public.artist_manual_quotes;
drop table if exists public.artist_manual_quotes;

drop policy if exists artist_clients_owner_delete on public.artist_clients;
drop policy if exists artist_clients_owner_update on public.artist_clients;
drop policy if exists artist_clients_owner_insert on public.artist_clients;
drop policy if exists artist_clients_owner_select on public.artist_clients;
drop table if exists public.artist_clients;

commit;
