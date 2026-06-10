-- ============================================
-- VERIFICATION HISTORY + QUOTATION STATUS HISTORY
-- Sprint 4 — Verificaciones + Flujo de estados
-- ============================================

-- 1. Verification History table
CREATE TABLE IF NOT EXISTS verification_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    artist_id UUID NOT NULL REFERENCES artists_db(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('approved', 'rejected', 'pending_review', 'revoked')),
    notes TEXT,
    reviewed_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE verification_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read on verification_history" ON verification_history
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow anon read on verification_history" ON verification_history
    FOR SELECT TO anon USING (true);
CREATE POLICY "Allow authenticated insert on verification_history" ON verification_history
    FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow anon insert on verification_history" ON verification_history
    FOR INSERT TO anon WITH CHECK (true);

CREATE INDEX idx_verification_history_artist_id ON verification_history(artist_id);
CREATE INDEX idx_verification_history_created_at ON verification_history(created_at DESC);
CREATE INDEX idx_verification_history_action ON verification_history(action);

-- 2. Quotation Status History table (for timeline visual)
CREATE TABLE IF NOT EXISTS quotation_status_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    quotation_id INTEGER NOT NULL REFERENCES quotations_db(id) ON DELETE CASCADE,
    quote_id VARCHAR,
    old_status VARCHAR,
    new_status VARCHAR NOT NULL,
    changed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    changed_by TEXT,
    notes TEXT
);

ALTER TABLE quotation_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on status history" ON quotation_status_history
    FOR SELECT TO public USING (true);
CREATE POLICY "Allow anon insert on status history" ON quotation_status_history
    FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow authenticated insert on status history" ON quotation_status_history
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX idx_status_history_quotation_id ON quotation_status_history(quotation_id);
CREATE INDEX idx_status_history_changed_at ON quotation_status_history(changed_at DESC);
CREATE INDEX idx_status_history_new_status ON quotation_status_history(new_status);

-- 3. Trigger for automatic status history logging + validation
CREATE OR REPLACE FUNCTION fn_quotation_status_change()
RETURNS TRIGGER AS $$
DECLARE
    valid_transitions JSONB := '{
        "pending": ["responded", "expired", "cancelled"],
        "responded": ["client_approved", "client_rejected", "expired"],
        "client_approved": ["in_progress", "cancelled"],
        "in_progress": ["completed", "cancelled"],
        "en_progreso": ["completed", "cancelled"],
        "client_rejected": ["responded"],
        "completed": [],
        "expired": [],
        "cancelled": []
    }'::JSONB;
    allowed JSONB;
BEGIN
    IF OLD.quote_status IS DISTINCT FROM NEW.quote_status THEN
        -- Validate transition
        IF OLD.quote_status IS NOT NULL AND valid_transitions ? OLD.quote_status THEN
            allowed := valid_transitions -> OLD.quote_status;
            IF NOT allowed @> to_jsonb(NEW.quote_status) THEN
                RAISE EXCEPTION 'Invalid status transition: % -> %. Allowed: %',
                    OLD.quote_status, NEW.quote_status, allowed;
            END IF;
        END IF;

        -- Log the transition
        INSERT INTO quotation_status_history (quotation_id, quote_id, old_status, new_status, changed_by)
        VALUES (NEW.id, NEW.quote_id, OLD.quote_status, NEW.quote_status,
                current_setting('request.jwt.claims', true)::json->>'sub');

        NEW.updated_at := NOW();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quotation_status_change ON quotations_db;
CREATE TRIGGER trg_quotation_status_change
    BEFORE UPDATE ON quotations_db
    FOR EACH ROW
    EXECUTE FUNCTION fn_quotation_status_change();
