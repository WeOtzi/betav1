-- Reversa de 20261113105000_privacidad_cookie_consent.sql
-- Borra el historial de consentimientos (cookie_consent_log) y la RPC.
-- NO toca user_preferences.privacy.cookie_consent (es una clave dentro de un
-- jsonb existente; si hiciera falta limpiarla:
--   update public.user_preferences set privacy = privacy - 'cookie_consent';
-- ) ni la fila app_settings 'cookie_consent_config'.

drop function if exists public.record_cookie_consent(uuid, jsonb);
drop table if exists public.cookie_consent_log;
