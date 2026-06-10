-- Allow the quotation wizard autosave row to become a submitted quote.
-- /quotation upserts drafts with quote_status = 'in_progress', then final
-- submit updates the same quote_id to 'pending' for artist review.
CREATE OR REPLACE FUNCTION fn_quotation_status_change()
RETURNS TRIGGER AS $$
DECLARE
    valid_transitions JSONB := '{
        "pending": ["responded", "expired", "cancelled"],
        "responded": ["client_approved", "client_rejected", "expired"],
        "client_approved": ["in_progress", "cancelled"],
        "in_progress": ["pending", "completed", "cancelled"],
        "en_progreso": ["completed", "cancelled"],
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

        INSERT INTO quotation_status_history (quotation_id, quote_id, old_status, new_status, changed_by)
        VALUES (NEW.id, NEW.quote_id, OLD.quote_status, NEW.quote_status,
                current_setting('request.jwt.claims', true)::json->>'sub');

        NEW.updated_at := NOW();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
