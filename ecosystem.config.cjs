// PM2 进程配置：WxPush 服务
// 使用：pm2 start ecosystem.config.cjs --env production
// 重载：pm2 reload wxpush
// 日志：pm2 logs wxpush

module.exports = {
  apps: [
    {
      name: 'wxpush',
      script: './server/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      kill_timeout: 10000,        // 给优雅关闭 10s
      wait_ready: false,         // Fastify 没暴露 ready 信号，靠 healthz
      min_uptime: 5000,
      env: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
      },
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
      // 日志路径（按需调整）
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
