import Fastify from 'fastify';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
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
    // 预读 index.html 到内存（所有 SPA 返回都用这个版本，避免磁盘文件被替换时不一致）
    const indexPath = join(staticDir, 'index.html');
    let indexHtml = null;
    try {
      indexHtml = readFileSync(indexPath, 'utf-8');
    } catch {
      logger.warn({ path: indexPath }, 'index.html not found in static dir');
    }

    // 显式注册 GET / → 返回内存中的 index.html（不依赖 fastifyStatic 目录索引）
    // 同时禁用 fastifyStatic 的 index: false，让它不处理 GET /
    if (indexHtml) {
      app.get('/', (req, reply) => {
        reply.header('content-type', 'text/html; charset=utf-8');
        reply.header('cache-control', 'no-cache');
        reply.send(indexHtml);
      });
    }

    // fastifyStatic 只负责处理 /assets/*、/logo.png 等真实的静态文件
    // 不处理 GET /（已显式注册），不做 SPA fallback（由 setNotFoundHandler 负责）
    app.register(fastifyStatic, {
      root: staticDir,
      prefix: '/',
      wildcard: true,
      index: false, // 禁止自动把 / 映射到 index.html，由显式 GET / handler 处理
      cacheControl: true,
      maxAge: '7d',
      lastModified: true,
    });

    // SPA 回退：仅对 HTML 路由返回 index.html（内存版本，无缓存）
    // 静态文件（js/css/png等）必须返回 404，避免把 index.html 当成 JS/CSS 返回
    const STATIC_EXTS = /\.(js|mjs|cjs|css|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|otf|mp4|webm|ogg|mp3|wav|pdf|json|xml|txt|map|wasm)$/i;
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
      // 静态资源文件 → 返回 404，不能回退到 index.html（会导致 MIME type 错误）
      if (STATIC_EXTS.test(url)) {
        return reply.code(404).send({ code: 40400, message: 'static file not found' });
      }
      // 其余返回内存中的 index.html（Vue Router 接管前端路由）
      // 不使用 sendFile('index.html')，避免磁盘文件被替换时版本不一致
      if (indexHtml) {
        reply.header('content-type', 'text/html; charset=utf-8');
        reply.header('cache-control', 'no-cache');
        return reply.send(indexHtml);
      }
      reply.code(404).send({ code: 40400, message: 'index.html not available' });
    });

    logger.info({ dir: staticDir, hasIndex: !!indexHtml }, 'static file serving enabled');
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
