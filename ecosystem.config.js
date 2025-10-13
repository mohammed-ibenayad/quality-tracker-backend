module.exports = {
  apps: [
    {
      name: 'quality-tracker-webhook',
      script: 'webhook-server.js',
      cwd: '/home/asal/quality-tracker-backend',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        HOST: '0.0.0.0'
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      error_file: '/home/asal/quality-tracker-backend/logs/webhook-err.log',
      out_file: '/home/asal/quality-tracker-backend/logs/webhook-out.log',
      log_file: '/home/asal/quality-tracker-backend/logs/webhook-combined.log',
      time: true
    },
    {
      name: 'quality-tracker-api',
      script: 'api-server.js',
      cwd: '/home/asal/quality-tracker-backend',
      env: {
        NODE_ENV: 'production',
        API_PORT: 3002,
        HOST: '0.0.0.0'
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      error_file: '/home/asal/quality-tracker-backend/logs/api-err.log',
      out_file: '/home/asal/quality-tracker-backend/logs/api-out.log',
      log_file: '/home/asal/quality-tracker-backend/logs/api-combined.log',
      time: true
    }
  ]
};
