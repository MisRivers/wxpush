import { getDB } from '../db/index.js';
import { AppError } from '../middleware/error.js';
import { checkMinuteBucket, checkDailyQuota, bumpDailyQuota } from '../middleware/rate-limit.js';
import { checkIPWhitelist } from '../middleware/ip-whitelist.js';
import { pushMessage } from '../services/push.js';
import { logger } from '../utils/logger.js';

/**
 * URL 风格推送路由：GET/POST /:token.send
 * 兼容 Server 酱协议：text + desp + type + url + title + description + btntxt
 *
 * 这个路由必须最后注册（在所有管理路由之后），避免吃掉 /login 等
 *
 * 路由参数约束：token 必须 base64url 32~64 字符
 */

const TOKEN_PATTERN = /^([A-Za-z0-9_-]{32,64})\.send$/;

/**
 * 加载 token 配置（含 recipients）
 */
export function loadToken(tokenValue) {
  const db = getDB();
  const row = db.prepare(`
    SELECT id, token, name, channel_type, app_id, webhook_id,
           allowed_msg_types, rate_limit_per_min, ip_whitelist,
           expires_at, enabled
    FROM tokens WHERE token=?
  `).get(tokenValue);
  if (!row) return null;
  if (!row.enabled) return { ...row, disabled: true };
  if (row.expires_at && row.expires_at * 1000 < Date.now()) {
    return { ...row, expired: true };
  }
  // 加载接收人（仅 app 渠道）
  let recipients = [];
  if (row.channel_type === 'app') {
    recipients = db.prepare(`
      SELECT recv_type, recv_value FROM token_recipients WHERE token_id=? ORDER BY id
    `).all(row.id).map(r => ({ recvType: r.recv_type, recvValue: r.recv_value }));
  }
  return { ...row, recipients };
}

/**
 * 注册 push 路由（最后调用）
 */
export function registerPushRoutes(app) {
  // 必须最后注册——在所有 /login /api /healthz 之后
  app.route({
    method: ['GET', 'POST'],
    url: '/:token.send',
    config: { cacheControl: 'no-store' },
    handler: pushHandler,
  });
}

async function pushHandler(req, reply) {
  // 响应一律 Cache-Control: no-store
  reply.header('cache-control', 'no-store');

  const path = req.url.split('?')[0];
  const match = TOKEN_PATTERN.exec(path.slice(1)); // 去掉前缀 /
  if (!match) {
    reply.code(404).send({ code: 40400, message: 'not found' });
    return;
  }
  const tokenValue = match[1];

  // 1. 加载 token
  const token = loadToken(tokenValue);
  if (!token) {
    reply.code(404).send({ code: 40101, message: 'token not found' });
    return;
  }
  if (token.disabled) {
    reply.code(403).send({ code: 40302, message: 'token disabled' });
    return;
  }
  if (token.expired) {
    reply.code(403).send({ code: 40303, message: 'token expired' });
    return;
  }

  // 2. IP 白名单
  const clientIp = req.ip;
  try {
    checkIPWhitelist(clientIp, token.ip_whitelist);
  } catch (e) {
    reply.code(e.statusCode).send({ code: e.code, message: e.message });
    return;
  }

  // 3. 分钟限流
  if (!checkMinuteBucket(token)) {
    reply.header('retry-after', '60');
    reply.code(429).send({ code: 42901, message: 'rate limited' });
    return;
  }

  // 4. 解析请求参数
  let params;
  try {
    params = parsePushRequest(req);
  } catch (e) {
    reply.code(e.statusCode || 400).send({ code: e.code || 40001, message: e.message });
    return;
  }

  // 5. GET 长度限制（≤ 8KB）
  if (req.method === 'GET') {
    const totalLen = Buffer.byteLength(req.url, 'utf8');
    if (totalLen > 8192) {
      reply.code(413).send({ code: 41301, message: 'payload too large, use POST' });
      return;
    }
  }

  // 6. @all 配额检查（仅 app 渠道 + 含 @all 接收人）
  if (token.channel_type === 'app' && token.recipients) {
    const hasAtAll = token.recipients.some(r => r.recvType === 'user' && r.recvValue === '@all');
    if (hasAtAll) {
      // 加载 app 的 @all 配额
      const app = getDB().prepare('SELECT allow_at_all, at_all_daily_limit FROM apps WHERE id=?').get(token.app_id);
      if (!app || !app.allow_at_all) {
        reply.code(403).send({ code: 40304, message: '@all not allowed for this app' });
        return;
      }
      const quota = checkDailyQuota(`atall:${token.app_id}`, app.at_all_daily_limit);
      if (!quota.allowed) {
        reply.header('retry-after', String(quota.retryAfterSec || 3600));
        reply.code(429).send({ code: 42902, message: `@all daily limit reached (${quota.current}/${quota.limit})` });
        return;
      }
      // 占用一次（推送成功后再 bump；这里先预占避免并发）
      bumpDailyQuota(`atall:${token.app_id}`);
    }
  }

  // 7. 构造消息内容
  const content = buildContent(params);

  // 8. 调用推送服务
  const result = await pushMessage({
    token: { ...token, token: tokenValue },
    msgType: params.msgType,
    content,
    clientIp,
    requestId: req.id,
  });

  // 9. 响应：上游错误统一 HTTP 200 + body.code（不让客户端自动重试）
  const statusCode = result.success ? 200
    : (result.errorCode && isNetworkError(result.errorCode) ? 502 : 200);
  reply.code(statusCode);
  reply.send({
    code: result.success ? 0 : (result.errorCode || 50000),
    message: result.success ? 'ok' : (result.errorMessage || 'failed'),
    msgid: result.msgid || '',
    timestamp: Math.floor(Date.now() / 1000),
  });
}

function parsePushRequest(req) {
  // GET：query string；POST：JSON 或 form-urlencoded
  let q;
  if (req.method === 'GET') {
    q = req.query;
  } else {
    q = req.body || {};
  }

  // 兼容 Server 酱 / serverchan-sdk / 简化 GET 三种风格：
  //   Server酱:    ?title=标题&desp=描述
  //   简化 GET:    ?title=标题&content=内容
  //   本系统原样:  ?text=内容&desp=描述&type=markdown
  // 消息正文优先级: text > content > desp > title
  const text = (q.text || q.content || q.desp || q.title || '').trim();
  if (!text) {
    throw new AppError(40001, 'text/content/desp/title 不能全为空', { statusCode: 400 });
  }

  // desp：markdown 正文（如果有），否则与 text 一致
  const desp = (q.desp || q.content || '').trim();

  // type 默认 text，除非用户显式传 type=markdown
  let msgType = (q.type || 'text').trim();
  const allowed = ['text', 'markdown', 'textcard', 'image', 'news'];
  if (!allowed.includes(msgType)) {
    throw new AppError(40002, `invalid type: ${msgType}`, { statusCode: 400 });
  }

  return {
    text,
    desp,
    msgType,
    url: q.url || '',
    title: q.title || '',
    description: q.description || '',
    btntxt: q.btntxt || '详情',
    // serverchan-sdk 兼容参数（透传到 content）
    tags: q.tags || '',
    short: q.short || '',
    noip: q.noip || '',
    channel: q.channel || '',
    openid: q.openid || '',
    // news 图文
    picurl: q.picurl || '',
  };
}

function buildContent(params) {
  switch (params.msgType) {
    case 'text':
      // 有标题时合并：【标题】\n内容
      if (params.title && params.title !== params.text) {
        return { text: `【${params.title}】\n${params.text}` };
      }
      return { text: params.text };
    case 'markdown':
      // markdown 正文：有标题时合并 【标题】\n + desp
      {
        const mdBody = params.desp || params.text;
        const mdText = (params.title && params.title !== mdBody) ? `【${params.title}】\n${mdBody}` : mdBody;
        return { text: params.text, desp: mdText };
      }
    case 'textcard':
      return {
        title: params.title || params.text,
        description: params.short || params.description || params.desp || '',
        url: params.url || '',
        btntxt: params.btntxt || '详情',
      };
    case 'image':
      return { url: params.url }; // push.js 会调 image-fetcher 下载
    case 'news':
      // news 需要结构化 body；URL 风格下提供 url 字段，构造单条 article
      return {
        articles: [
          {
            title: params.title || params.text,
            description: params.description || params.desp || '',
            url: params.url || '',
            picurl: params.picurl || '',
          },
        ],
      };
    default:
      return { text: params.text };
  }
}

function isNetworkError(errcode) {
  // 50001 ~ 50999 表示网络层错误（502）
  return errcode >= 50000 && errcode < 51000;
}

export default { registerPushRoutes, loadToken };
