-- Beta cerrada · integración: las funciones de trigger SECURITY DEFINER de turnos
-- (20261115160000) quedaron ejecutables como RPC por anon/authenticated (advisor
-- de Supabase). Postgres no deja invocarlas fuera de un trigger, pero se les
-- quita el EXECUTE para cerrar la superficie. Los triggers siguen funcionando.
-- Reversa: supabase/rollbacks/20261115235900_integracion_revoke_trigger_fns.down.sql
revoke execute on function public.prevent_quotation_session_overlap() from public, anon, authenticated;
revoke execute on function public.release_hold_on_session_cancel() from public, anon, authenticated;
revoke execute on function public.release_holds_on_quote_close() from public, anon, authenticated;
