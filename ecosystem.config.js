module.exports = {
  apps: [
    {
      name: 'academy-backend',
      script: 'src/index.js',
      cwd: '/home/ubuntu/academy/backend',
      instances: 1,
      autorestart: true,
      watch: false,
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
    },
  ],
}
