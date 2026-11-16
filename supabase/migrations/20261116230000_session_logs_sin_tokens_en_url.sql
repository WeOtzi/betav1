-- ============================================================================
-- session_logs sin tokens ni datos personales en las direcciones (SEG-03)
-- ============================================================================
-- El registro de sesión del navegador guardaba window.location.href entero en
-- page_url y dentro de log_data ("Session started", clics, navegación). Con el
-- flujo implícito de Auth, la vuelta del correo o de Google trae
-- #access_token=…&refresh_token=…: quedaron sesiones completas de usuarios
-- reales a la vista de soporte (policy session_logs_support_read). También
-- quedaron ?email=… y, desde la ronda 2, puede entrar el token del enlace
-- público de una cotización por ?returnTo=/cotizacion/<token>.
--
-- El código nuevo (public/shared/js/logging-service.js → scrubUrl) ya guarda
-- solo origen + ruta. Esta migración limpia lo que quedó guardado.
--
-- APLICAR DESPUÉS DE DESPLEGAR EL CÓDIGO: si no, las pestañas con la versión
-- anterior siguen escribiendo direcciones completas. Es idempotente: se puede
-- volver a correr más tarde para limpiar lo que hayan dejado pestañas viejas.
--
-- Paso operativo aparte (no lo hace esta migración): cerrar las sesiones de
-- los usuarios cuyos tokens quedaron guardados. Ver deployments/DEPLOY.md.
--
-- Reversa: no existe. Lo que se borra acá no se recupera, y es la intención.
-- ============================================================================

-- 1) Registros con tokens de sesión o con el enlace de una cotización en la
--    dirección: se vacía el detalle. log_data va comprimido (gzip + base64) y
--    no se puede recortar por dentro; la primera entrada repite la dirección
--    completa. El visor de soporte y LoggingService.decompress tratan el
--    valor vacío como "sin entradas". Tiene que ir ANTES del paso 2: el
--    filtro usa la dirección completa.
update public.session_logs
   set log_data = '',
       log_entries_count = 0
 where page_url ~* '(access_token|refresh_token|provider_token|provider_refresh_token)='
    or page_url ~* 'returnTo=.*cotizacion';

-- 2) Todas las direcciones quedan en origen + ruta (sin query ni hash).
update public.session_logs
   set page_url = split_part(split_part(page_url, '#', 1), '?', 1)
 where page_url ~ '[#?]';
