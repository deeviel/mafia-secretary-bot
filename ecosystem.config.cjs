module.exports = {
  apps: [
    {
      name: "discord-scheduler-bot",
      script: "dist/server.cjs",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      node_args: "--max-old-space-size=1024 --gc-interval=100",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        UV_THREADPOOL_SIZE: 16
      }
    }
  ]
};
