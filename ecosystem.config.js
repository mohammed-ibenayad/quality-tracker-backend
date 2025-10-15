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
      time: true
    }
  ]
};
