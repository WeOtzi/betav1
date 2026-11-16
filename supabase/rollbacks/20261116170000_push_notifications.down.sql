-- Reversa de 20261116170000_push_notifications.sql.
-- Quita los avisos in-app y las suscripciones Web Push. Los navegadores ya
-- suscriptos dejan de recibir avisos (el servidor no tiene a quién enviar) y
-- la app sigue funcionando sin toasts en tiempo real.

begin;

do $$
begin
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'user_notifications'
  ) then
    alter publication supabase_realtime drop table public.user_notifications;
  end if;
end
$$;

drop function if exists public.push_recipient_user_id(text, text);
drop table if exists public.user_notifications;
drop table if exists public.push_subscriptions;

commit;
