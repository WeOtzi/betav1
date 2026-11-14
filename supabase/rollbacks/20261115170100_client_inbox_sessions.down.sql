-- Reversa de 20261115170100_client_inbox_sessions.sql: quita las dos RPC del
-- lado del cliente. No toca datos.

begin;

drop function if exists public.list_client_inbox_threads();
drop function if exists public.list_client_quotation_sessions(integer[]);

commit;
