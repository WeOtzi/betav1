-- Emails · configuración de envío privada (15 nov 2026, beta cerrada).
--
-- app_settings.n8n_events tenía is_public = true: la política "Allow public
-- read for public settings" le daba a anon las URLs de los 37 webhooks de
-- email (EM-N5 / CC-19). El panel de backoffice además lo volvía a guardar
-- como público. El frontend ya no llama a los webhooks (todo pasa por
-- /api/email con service role), así que:
--   1) n8n_events, email_routing y email_relay_url (URL del relé genérico)
--      quedan privados;
--   2) un trigger fuerza is_public = false en esas claves aunque un cliente
--      viejo intente publicarlas de nuevo.
-- Soporte sigue leyendo/escribiendo n8n_events con su sesión
-- (política app_settings_support_write, que no depende de is_public).
--
-- Idempotente. Reversa: supabase/rollbacks/20261115180000_emails_settings_privados.down.sql

begin;

update public.app_settings
   set is_public = false,
       updated_at = now()
 where setting_key in ('n8n_events', 'email_routing', 'email_relay_url', 'n8n_webhook_secret')
   and is_public is distinct from false;

create or replace function public.app_settings_force_private_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.setting_key in ('n8n_events', 'email_routing', 'email_relay_url', 'n8n_webhook_secret') then
    new.is_public := false;
  end if;
  return new;
end;
$$;

comment on function public.app_settings_force_private_email() is
  'Emails (beta cerrada): las URLs de webhooks y el ruteo de email nunca son públicos.';

drop trigger if exists app_settings_force_private_email on public.app_settings;
create trigger app_settings_force_private_email
  before insert or update of is_public, setting_key on public.app_settings
  for each row execute function public.app_settings_force_private_email();

commit;
