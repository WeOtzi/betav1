-- Rollback de 20261116110200_cot_form_r2_vinculo_contacto.sql
-- Quita el agrupado por contacto. Las cotizaciones ya vinculadas a una cuenta
-- (client_user_id) quedan vinculadas: es el mismo vínculo que hace el claim.

begin;

drop function if exists public.quotation_same_contact(text);
drop function if exists public.link_quotation_contact(text);
drop function if exists public.quotation_contact_phone_key(text);
drop table if exists public.quotation_contact_links;

commit;
