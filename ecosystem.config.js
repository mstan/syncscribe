module.exports = {
  apps: [
    {
      name: 'syncscribe-web',
      script: 'app.js',
      // Cluster mode (single instance) matches the deployed setup and allows
      // `pm2 reload` for zero-downtime restarts. Do NOT raise instances on the
      // 1GB droplet: each instance runs its own pg-boss worker (teamSize 2 x
      // teamConcurrency 4) and would multiply memory use.
      exec_mode: 'cluster',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // Keep operational debug logs but drop the high-frequency :trace lines
        // (e.g. per-request "Fetching job"). morgan already skips poll/SSE reads.
        DEBUG: 'SubtitleGenerator:*,-SubtitleGenerator:*:trace'
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000,
        DEBUG: 'SubtitleGenerator:*'
      },
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      log_file: 'logs/combined.log',
      time: true
    }
  ]
};
