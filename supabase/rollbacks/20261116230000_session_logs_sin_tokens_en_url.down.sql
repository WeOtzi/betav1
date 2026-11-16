-- ============================================================================
-- Reversa de 20261116230000_session_logs_sin_tokens_en_url.sql
-- ============================================================================
-- No hay nada que revertir, a propósito: la migración borra de session_logs
-- los tokens de sesión, los enlaces de cotización y los datos personales que
-- habían quedado en las direcciones (page_url) y vacía el detalle (log_data)
-- de los registros que los traían. Esos datos no se guardan en ningún otro
-- lado y no deben volver.
--
-- No cambia el esquema: volver a la versión anterior del código no necesita
-- ningún paso en la base.
-- ============================================================================

select 1;
