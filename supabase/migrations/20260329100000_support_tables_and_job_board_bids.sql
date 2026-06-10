-- ============================================
-- SUPPORT TABLES + JOB BOARD BIDDING
-- Sprint 5 — Soporte centralizado + Bidding
-- ============================================

-- 1. Ticket Assignments
CREATE TABLE IF NOT EXISTS ticket_assignments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ticket_id UUID NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
    assigned_to TEXT NOT NULL,
    assigned_by TEXT,
    assigned_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE ticket_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on ticket_assignments" ON ticket_assignments
    FOR SELECT TO public USING (true);
CREATE POLICY "Allow authenticated insert on ticket_assignments" ON ticket_assignments
    FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow anon insert on ticket_assignments" ON ticket_assignments
    FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow authenticated update on ticket_assignments" ON ticket_assignments
    FOR UPDATE TO authenticated USING (true);

CREATE INDEX idx_ticket_assignments_ticket_id ON ticket_assignments(ticket_id);
CREATE INDEX idx_ticket_assignments_assigned_to ON ticket_assignments(assigned_to);

-- 2. Ticket Comments
CREATE TABLE IF NOT EXISTS ticket_comments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ticket_id UUID NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    content TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE ticket_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on ticket_comments" ON ticket_comments
    FOR SELECT TO public USING (true);
CREATE POLICY "Allow authenticated insert on ticket_comments" ON ticket_comments
    FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow anon insert on ticket_comments" ON ticket_comments
    FOR INSERT TO anon WITH CHECK (true);

CREATE INDEX idx_ticket_comments_ticket_id ON ticket_comments(ticket_id);
CREATE INDEX idx_ticket_comments_created_at ON ticket_comments(created_at DESC);

-- Note: job_board_applications already exists and serves as the bidding table.
-- Columns: id, request_id, artist_id, message, estimated_price, estimated_sessions,
-- availability_note, portfolio_links, status, created_at, updated_at, decided_at
