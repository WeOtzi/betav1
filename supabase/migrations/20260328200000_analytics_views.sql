-- ============================================
-- ANALYTICS VIEWS FOR SESSION_LOGS
-- Sprint 2.4 — Parseo de session_logs para métricas
-- ============================================

-- View: Device/OS/Browser breakdown from user_agent
-- Includes environment column for consistency with analytics_user_sessions
DROP VIEW IF EXISTS analytics_devices;
CREATE VIEW analytics_devices AS
SELECT
  id,
  session_id,
  device_fingerprint,
  CASE
    WHEN user_agent LIKE '%iPhone%' THEN 'iOS'
    WHEN user_agent LIKE '%iPad%' THEN 'iPadOS'
    WHEN user_agent LIKE '%Android%' THEN 'Android'
    WHEN user_agent LIKE '%Macintosh%' THEN 'macOS'
    WHEN user_agent LIKE '%Windows%' THEN 'Windows'
    WHEN user_agent LIKE '%Linux%' AND user_agent NOT LIKE '%Android%' THEN 'Linux'
    WHEN user_agent LIKE '%CrOS%' THEN 'ChromeOS'
    ELSE 'Other'
  END as os,
  CASE
    WHEN user_agent LIKE '%Mobile%' OR user_agent LIKE '%iPhone%' OR user_agent LIKE '%Android%Mobile%' THEN 'Mobile'
    WHEN user_agent LIKE '%iPad%' OR user_agent LIKE '%Tablet%' THEN 'Tablet'
    ELSE 'Desktop'
  END as device_type,
  CASE
    WHEN user_agent LIKE '%CriOS/%' THEN 'Chrome iOS'
    WHEN user_agent LIKE '%FxiOS/%' THEN 'Firefox iOS'
    WHEN user_agent LIKE '%Edg/%' THEN 'Edge'
    WHEN user_agent LIKE '%OPR/%' THEN 'Opera'
    WHEN user_agent LIKE '%Chrome/%' AND user_agent NOT LIKE '%Edg/%' AND user_agent NOT LIKE '%OPR/%' THEN 'Chrome'
    WHEN user_agent LIKE '%Firefox/%' THEN 'Firefox'
    WHEN user_agent LIKE '%Safari/%' AND user_agent NOT LIKE '%Chrome/%' THEN 'Safari'
    ELSE 'Other'
  END as browser,
  CASE
    WHEN page_url LIKE '%localhost%' OR page_url LIKE '%127.0.0.1%' THEN 'development'
    ELSE 'production'
  END as environment,
  created_at
FROM session_logs
WHERE user_agent IS NOT NULL;

-- Geolocation columns on session_logs (resolved at insert time via ip-api.com)
ALTER TABLE session_logs ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE session_logs ADD COLUMN IF NOT EXISTS city TEXT;

-- View: User type classification (artist, client, anonymous)
-- Includes country/city from geo-resolved session_logs
DROP VIEW IF EXISTS analytics_user_sessions;
CREATE VIEW analytics_user_sessions AS
SELECT
  sl.id,
  sl.session_id,
  sl.user_id,
  sl.user_email,
  sl.device_fingerprint,
  sl.page_url,
  sl.user_ip,
  sl.has_errors,
  sl.error_count,
  sl.started_at,
  sl.ended_at,
  sl.created_at,
  CASE
    WHEN sl.user_id IS NULL THEN 'anonymous'
    WHEN a.user_id IS NOT NULL THEN 'artist'
    WHEN c.user_id IS NOT NULL THEN 'client'
    ELSE 'authenticated_other'
  END as user_type,
  CASE
    WHEN sl.page_url LIKE '%localhost%' OR sl.page_url LIKE '%127.0.0.1%' THEN 'development'
    ELSE 'production'
  END as environment,
  -- Normalize page path (remove host and query params)
  CASE
    WHEN sl.page_url LIKE '%/artist/dashboard%' THEN '/artist/dashboard'
    WHEN sl.page_url LIKE '%/artist/profile%' THEN '/artist/profile'
    WHEN sl.page_url LIKE '%/registerclosedbeta%' THEN '/registerclosedbeta'
    WHEN sl.page_url LIKE '%/register-artist%' THEN '/register-artist'
    WHEN sl.page_url LIKE '%/quotation%' THEN '/quotation'
    WHEN sl.page_url LIKE '%/marketplace%' THEN '/marketplace'
    WHEN sl.page_url LIKE '%/job-board/request%' THEN '/job-board/request'
    WHEN sl.page_url LIKE '%/job-board%' THEN '/job-board'
    WHEN sl.page_url LIKE '%/my-quotations%' THEN '/my-quotations'
    WHEN sl.page_url LIKE '%/backoffice%' THEN '/backoffice'
    WHEN sl.page_url LIKE '%/client/dashboard%' THEN '/client/dashboard'
    WHEN sl.page_url LIKE '%/client/login%' THEN '/client/login'
    WHEN sl.page_url LIKE '%/client/register%' THEN '/client/register'
    WHEN sl.page_url LIKE '%/support%' THEN '/support'
    WHEN sl.page_url LIKE '%/calendar%' THEN '/calendar'
    WHEN sl.page_url LIKE '%/archive%' THEN '/archive'
    WHEN sl.page_url LIKE '%/tutorial%' THEN '/tutorial'
    ELSE regexp_replace(sl.page_url, '^https?://[^/]+', '')
  END as page_path,
  sl.country,
  sl.city
FROM session_logs sl
LEFT JOIN artists_db a ON sl.user_id = a.user_id
LEFT JOIN clients_db c ON sl.user_id = c.user_id;

-- Indexes for faster analytics queries
CREATE INDEX IF NOT EXISTS idx_session_logs_created_at ON session_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_logs_has_errors ON session_logs(has_errors) WHERE has_errors = true;
CREATE INDEX IF NOT EXISTS idx_session_logs_user_id ON session_logs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_session_logs_fingerprint ON session_logs(device_fingerprint);
