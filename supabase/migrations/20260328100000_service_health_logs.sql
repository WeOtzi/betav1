-- ============================================
-- SERVICE HEALTH LOGS TABLE
-- Stores historical health check results for all integrated services
-- Sprint 1.4 — Health checks reales
-- ============================================

CREATE TABLE IF NOT EXISTS service_health_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    service_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'down', 'unconfigured')),
    latency_ms INTEGER,
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    checked_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    checked_by TEXT DEFAULT 'system' NOT NULL
);

-- Index for querying latest checks per service
CREATE INDEX idx_health_logs_service_time
    ON service_health_logs(service_name, checked_at DESC);

-- Index for filtering by status
CREATE INDEX idx_health_logs_status
    ON service_health_logs(status, checked_at DESC);

-- Enable RLS
ALTER TABLE service_health_logs ENABLE ROW LEVEL SECURITY;

-- Policy: allow authenticated users to read health logs
CREATE POLICY "Allow authenticated read" ON service_health_logs
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy: allow service role to insert health logs
CREATE POLICY "Allow service insert" ON service_health_logs
    FOR INSERT
    TO service_role
    WITH CHECK (true);

-- Policy: allow anon read for dashboard display
CREATE POLICY "Allow anon read" ON service_health_logs
    FOR SELECT
    TO anon
    USING (true);

-- Policy: allow anon insert for health checks from frontend
CREATE POLICY "Allow anon insert" ON service_health_logs
    FOR INSERT
    TO anon
    WITH CHECK (true);

-- Auto-cleanup: keep only last 30 days of logs
-- (This can be run as a cron job via pg_cron or manually)
COMMENT ON TABLE service_health_logs IS 'Health check history for integrated services. Auto-cleanup recommended: DELETE FROM service_health_logs WHERE checked_at < now() - interval ''30 days''';
