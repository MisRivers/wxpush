import 'dotenv/config';
import { buildApp, startJobs, stopJobs, flushLogs } from './app.js';
import { migrate, closeDB } from './db/index.js';
import { logger } from './utils/logger.js';
import config from './config.js';
import { syncVerifyFiles } from './routes/wx-callback.js';

// 全局未捕获异常兜底
process.on('uncaughtException', (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'uncaughtException');
  shutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'unhandledRejection');
});

let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'graceful shutdown begin');

  // 停止后台定时任务
  stopJobs();

  // flush 残留日志
  try {
    await flushLogs();
  } catch (e) {
    logger.error({ err: e.message }, 'flush logs on shutdown failed');
  }

  // 关闭 Fastify（停止接收新请求，等待在途请求完成）
  if (app) {
    try {
      await app.close();
      logger.info('fastify closed');
    } catch (e) {
      logger.error({ err: e.message }, 'failed to close fastify');
    }
  }

  // 关闭数据库（flush WAL）
  closeDB();

  logger.info({ signal }, 'graceful shutdown done');
  process.exit(exitCode);
}

let app;

(async () => {
  try {
    migrate();
    syncVerifyFiles();
    app = buildApp();
    await app.listen({ port: config.PORT, host: config.HOST });
    startJobs();
    logger.info(
      { port: config.PORT, host: config.HOST, env: config.NODE_ENV },
      'wxpush server listening'
    );
  } catch (e) {
    logger.fatal({ err: e.message, stack: e.stack }, 'failed to start server');
    process.exit(1);
  }
})();

['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach((sig) => {
  process.on(sig, () => shutdown(sig, 0));
});
