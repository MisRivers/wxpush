import Fastify from 'fastify';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import config from './config.js';
import { logger } from './utils/logger.js';
import { migrate, closeDB, getDB } from './db/index.js';
import { registerErrorHandler, AppError } from './middleware/error.js';
import { registerRequestId } from './middleware/request-id.js';
import { adminAuthRequired } from './middleware/auth.js';
import healthHandler from './routes/health.js';
import { registerAPIRoutes } from './routes/api.js';
import { registerPushRoutes } from './routes/push.js';
import { registerAuthRoutes, meHandler } from './routes/admin/auth.js';
import { registerAppRoutes } from './routes/admin/apps.js';
import { registerWebhookRoutes } from './routes/admin/webhooks.js';
import { registerTokenRoutes } from './routes/admin/tokens.js';
import { registerLogRoutes } from './routes/admin/logs.js';
import { registerStatsRoutes } from './routes/admin/stats.js';
import { registerSettingsRoutes } from './routes/admin/settings.js';
import { registerDebugRoutes } from './routes/admin/debug.js';
import { registerWxCallbackRoutes } from './routes/wx-callback.js';
import { startAccessTokenRefresher, stopAccessTokenRefresher } from './jobs/access-token-refresher.js';
import { startLogRotator, stopLogRotator } from './jobs/log-rotator.js';
import { startStatsAggregator, stopStatsAggregator } from './jobs/stats-aggregator.js';
import { startLogFlusher, stopLogFlusher } from './jobs/log-flusher.js';
import { flushLogsOnShutdown } from './services/push.js';

/**
 * Fastify 实例装配
 * - bodyLimit 20MB（兼容 base64 图片）
 * - trustProxy：让 req.ip 拿到真实客户端 IP（nginx X-Forwarded-For）
 * - 支持 JSON 与 application/x-www-form-urlencoded（Server 酱老客户端兼容）
 */
export function buildApp() {
  const app = Fastify({
    bodyLimit: config.BODY_LIMIT,
    trustProxy: true,
    logger: false,
    disableRequestLogging: true,
    genReqId: (req) => req.headers['x-request-id'] || randomBytes(16).toString('hex'),
  });

  // Form-urlencoded 支持（Server 酱老客户端）
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
    try {
      const params = new URLSearchParams(body);
      const obj = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      done(null, obj);
    } catch (e) {
      done(e);
    }
  });

  // XML 支持（企业微信回调 POST 消息体为 XML）
  app.addContentTypeParser('text/xml', { parseAs: 'string' }, (req, body, done) => {
    done(null, body);
  });

  // 中间件
  registerRequestId(app);
  registerErrorHandler(app);

  // 健康探针（不鉴权）
  app.get('/healthz', healthHandler);

  // 企业微信验证路由（可信域名文件 + 消息回调，不鉴权）
  registerWxCallbackRoutes(app);

  // 管理后台路由（init/login 不需要鉴权，me 需要鉴权）
  registerAuthRoutes(app);
  app.get('/api/admin/auth/me', { preHandler: [adminAuthRequired] }, meHandler);
  registerAppRoutes(app);
  registerWebhookRoutes(app);
  registerTokenRoutes(app);
  registerLogRoutes(app);
  registerStatsRoutes(app);
  registerSettingsRoutes(app);
  registerDebugRoutes(app);

  // Header 风格 API（鉴权靠 X-API-Key，独立路径不与 push 路由冲突）
  registerAPIRoutes(app);

  // URL 风格 push 路由必须最后注册（避免吃掉 /login 等）
  registerPushRoutes(app);

  // 静态文件服务（前端 SPA + 资源文件）
  // 让后端直接服务 web/dist，Nginx 只需一行 proxy_pass 即可
  const staticDir = resolve(config.STATIC_DIR);
  if (existsSync(staticDir)) {
    app.register(fastifyStatic, {
      root: staticDir,
      prefix: '/',
      wildcard: false, // 不注册通配符路由，手动控制 fallback
      cacheControl: true,
      maxAge: '7d',
      lastModified: true,
    });

    // SPA 回退：非 API/非 .send 的未匹配路由返回 index.html
    app.setNotFoundHandler((req, reply) => {
      const url = req.url.split('?')[0];
      // API 和推送路由的 404 返回 JSON
      if (url.startsWith('/api/') || url.endsWith('.send')) {
        return reply.code(404).send({ code: 40400, message: 'not found' });
      }
      // WW_verify 文件的 404 返回纯文本
      if (url.startsWith('/WW_verify_')) {
        return reply.code(404).send('Not Found');
      }
      // 其余返回 index.html（Vue Router 接管前端路由）
      return reply.sendFile('index.html');
    });

    logger.info({ dir: staticDir }, 'static file serving enabled');
  } else {
    logger.warn({ dir: staticDir }, 'static dir not found, SPA serving disabled');
    app.setNotFoundHandler((req, reply) => {
      reply.code(404).headers({ 'cache-control': 'no-store' }).send({ code: 40400, message: 'not found' });
    });
  }

  return app;
}

/**
 * 启动后台定时任务
 */
export function startJobs() {
  startAccessTokenRefresher();
  startLogRotator();
  startStatsAggregator();
  startLogFlusher();
  logger.info('all background jobs started');
}

/**
 * 停止后台定时任务
 */
export function stopJobs() {
  stopAccessTokenRefresher();
  stopLogRotator();
  stopStatsAggregator();
  stopLogFlusher();
}

/**
 * 进程退出前 flush 日志队列
 */
export async function flushLogs() {
  await flushLogsOnShutdown();
}

export default buildApp;
