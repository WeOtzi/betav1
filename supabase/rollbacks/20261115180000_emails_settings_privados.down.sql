-- Reversa de 20261115180000_emails_settings_privados.sql. Quita el trigger y
-- deja n8n_events como estaba (público). email_routing, email_relay_url y
-- n8n_webhook_secret siguen privados (ya lo eran o son nuevos).

begin;

drop trigger if exists app_settings_force_private_email on public.app_settings;
drop function if exists public.app_settings_force_private_email();

update public.app_settings
   set is_public = true,
       updated_at = now()
 where setting_key = 'n8n_events';

commit;
