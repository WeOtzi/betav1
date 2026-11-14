-- Reversa de 20261115120100_quotation_transitions_artist.sql. Restaura las
-- transiciones anteriores: responded no admite cancelled y expired es terminal.

begin;

create or replace function public.fn_quotation_status_change()
 returns trigger
 language plpgsql
 set search_path to 'public', 'extensions'
as $function$
DECLARE
    valid_transitions JSONB := '{
        "pending": ["responded", "expired", "cancelled"],
        "responded": ["client_approved", "client_rejected", "expired"],
        "client_approved": ["in_progress", "cancelled"],
        "in_progress": ["pending", "artist_completed", "cancelled"],
        "artist_completed": ["in_progress", "completed", "cancelled"],
        "en_progreso": ["artist_completed", "cancelled"],
        "client_rejected": ["responded"],
        "completed": [],
        "expired": [],
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
