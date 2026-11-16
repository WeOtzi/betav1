-- Reversa de 20261116130000_quotation_share_links.sql.
-- Borra los enlaces públicos de cotización: todos los /cotizacion/<token>
-- compartidos dejan de abrir. Las cotizaciones y los vínculos cliente ↔
-- cotización ya hechos (quotations_db.client_user_id) no se tocan.

begin;

drop function if exists public.touch_quotation_share_link(text);
drop table if exists public.quotation_share_links;

commit;
