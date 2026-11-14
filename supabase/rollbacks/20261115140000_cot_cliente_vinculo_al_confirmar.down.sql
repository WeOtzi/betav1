-- Reversa de 20261115140000_cot_cliente_vinculo_al_confirmar.sql.
-- Quita el trigger y sus funciones. No deshace los vínculos que ya se hicieron
-- (client_user_id / clients_db.email_verified): son datos correctos del dueño
-- verificado de cada email y desvincularlos dejaría cotizaciones huérfanas.

begin;

drop trigger if exists on_email_confirmed_link_client_quotations on auth.users;
drop function if exists public.link_client_quotations_on_email_confirm();
drop function if exists public.cot_cliente_is_wizard_draft(text, timestamptz, text, text);

commit;
