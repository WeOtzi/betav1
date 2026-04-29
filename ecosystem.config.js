// ============================================
// WE ÖTZI - PM2 Ecosystem Configuration
// ============================================

module.exports = {
  apps: [{
    name: 'weotzi-beta',
    script: 'server.js',
    
    // Environment variables
    env: {
      PORT: 4545,
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://flbgmlvfiejfttlawnfu.supabase.co',
      SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888',
      // SUPABASE_SERVICE_ROLE_KEY: '' // Set from Supabase Dashboard > Settings > API > service_role key

      // BillionMail (self-hosted mail server). See docs/plans/2026-04-28-billionmail-migration.md
      BILLIONMAIL_API_URL: 'https://bm.weotzi.com',
      // BILLIONMAIL_API_KEY: '' // Generated from BillionMail panel -> Settings -> API
      BILLIONMAIL_DEFAULT_SENDER: 'noreply@weotzi.com',
      BILLIONMAIL_TIMEOUT_MS: '15000'
    },
    
    // Restart behavior - MORE RESILIENT
    autorestart: true,
    max_restarts: 50,              // Allow many more restarts before giving up
    min_uptime: '5s',              // Consider app "started" after 5s
    restart_delay: 3000,           // Wait 3s between restarts
    exp_backoff_restart_delay: 100, // Exponential backoff starting at 100ms
    
    // Memory management - restart if memory exceeds limit
    max_memory_restart: '300M',    // Restart if memory exceeds 300MB
    
    // Logging configuration - use default .pm2 directory
    error_file: '/home/u795331143/.pm2/logs/weotzi-beta-error.log',
    out_file: '/home/u795331143/.pm2/logs/weotzi-beta-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Watch (disabled for production stability)
    watch: false,
    
    // Instance settings
    instances: 1,
    exec_mode: 'fork',
    
    // Kill timeout - wait longer before force kill
    kill_timeout: 5000,
    
    // Listen timeout
    listen_timeout: 10000
  }]
};
