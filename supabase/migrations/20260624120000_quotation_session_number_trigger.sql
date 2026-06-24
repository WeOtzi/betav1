-- quotation_sessions.session_number asignado en el servidor (atomico).
--
-- Antes: el cliente calculaba `currentQuoteSessions.length + 1` en
-- shared-drawer.js, con riesgo de colision (dos sesiones con el mismo numero si
-- el estado del cliente estaba desincronizado o por inserts concurrentes).
--
-- Ahora: un trigger BEFORE INSERT calcula MAX(session_number)+1 por cotizacion.
-- Backward-compatible: solo completa cuando session_number viene NULL o <= 0, de
-- modo que un cliente que envie un numero explicito (>0) sigue funcionando igual
-- (el cliente nuevo enviara NULL para delegar la numeracion al servidor).
-- Concurrencia: toma un lock sobre la fila padre de quotations_db para serializar
-- inserts de la MISMA cotizacion y garantizar numeros consecutivos sin duplicar.

CREATE OR REPLACE FUNCTION public.set_quotation_session_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.session_number IS NULL OR NEW.session_number <= 0 THEN
        -- Serializa inserts concurrentes de la misma cotizacion.
        PERFORM 1 FROM public.quotations_db WHERE id = NEW.quotation_id FOR UPDATE;

        SELECT COALESCE(MAX(session_number), 0) + 1
          INTO NEW.session_number
          FROM public.quotation_sessions
         WHERE quotation_id = NEW.quotation_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_quotation_session_number ON public.quotation_sessions;
CREATE TRIGGER trg_set_quotation_session_number
    BEFORE INSERT ON public.quotation_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.set_quotation_session_number();
