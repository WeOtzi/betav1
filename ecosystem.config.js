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
      NODE_ENV: 'production'
    },
    
    // Restart behavior
    autorestart: true,
    max_restarts: 3,           // Max 3 restarts before stopping
    min_uptime: '10s',         // Consider app "started" after 10s
    restart_delay: 5000,       // Wait 5s between restarts
    
    // Logging configuration
    error_file: '/home/u795331143/.pm2-beta/logs/weotzi-beta-error.log',
    out_file: '/home/u795331143/.pm2-beta/logs/weotzi-beta-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Watch (disabled for production stability)
    watch: false,
    
    // Instance settings
    instances: 1,
    exec_mode: 'fork'
  }]
};
