-- Cotizaciones · transiciones del artista (15 nov 2026, beta cerrada).
--
-- COT-A-07: el artista puede RETIRAR una propuesta ya respondida
-- (responded → cancelled). Antes el resumen la marcaba "rechazada por el
-- cliente" (client_rejected) sin avisarle; ahora queda cancelled y sale el
-- aviso artist_rejected_quotation, que exige ese estado.
-- COT-A-08: una cotización vencida deja de ser terminal: el artista puede
-- volver a cotizarla (expired → responded) o cerrarla (expired → cancelled).
-- Al responder cambia artist_responded_at y el trigger
-- quotation_expiry_settings recalcula quote_expires_at si el vencimiento
-- está activo.
--
-- Copia literal de la función viva (leída con pg_get_functiondef el
-- 15 nov 2026) con esos dos cambios. El resto de las transiciones no cambia.
--
-- Idempotente (create or replace). Reversa:
-- supabase/rollbacks/20261115120100_quotation_transitions_artist.down.sql

begin;

create or replace function public.fn_quotation_status_change()
 returns trigger
 language plpgsql
 set search_path to 'public', 'extensions'
as $function$
DECLARE
    valid_transitions JSONB := '{
        "pending": ["responded", "expired", "cancelled"],
        "responded": ["client_approved", "client_rejected", "expired", "cancelled"],
        "client_approved": ["in_progress", "cancelled"],
        "in_progress": ["pending", "artist_completed", "cancelled"],
        "artist_completed": ["in_progress", "completed", "cancelled"],
        "en_progreso": ["artist_completed", "cancelled"],
        "client_rejected": ["responded"],
        "completed": [],
        "expired": ["responded", "cancelled"],
        "cancelled": []
    }'::JSONB;
    allowed JSONB;
BEGIN
    IF OLD.quote_status IS DISTINCT FROM NEW.quote_status THEN
        IF OLD.quote_status IS NOT NULL AND valid_transitions ? OLD.quote_status THEN
            allowed := valid_transitions -> OLD.quote_status;
            IF NOT allowed @> to_jsonb(NEW.quote_status) THEN
                RAISE EXCEPTION 'Invalid status transition: % -> %. Allowed: %',
                    OLD.quote_status, NEW.quote_status, allowed;
            END IF;
        END IF;

        IF NEW.quote_status = 'artist_completed' THEN
            NEW.artist_completed_at := COALESCE(NEW.artist_completed_at, timezone('utc', now()));
        END IF;

        IF NEW.quote_status = 'completed' THEN
            NEW.client_completed_at := COALESCE(NEW.client_completed_at, timezone('utc', now()));
        END IF;

        INSERT INTO quotation_status_history (quotation_id, quote_id, old_status, new_status, changed_by)
        VALUES (NEW.id, NEW.quote_id, OLD.quote_status, NEW.quote_status,
                current_setting('request.jwt.claims', true)::json->>'sub');

        NEW.updated_at := NOW();
    END IF;

    RETURN NEW;
END;
$function$;

commit;
