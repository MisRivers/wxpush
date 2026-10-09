import { getDB } from '../db/index.js';
import { AppError } from '../middleware/error.js';
import { checkMinuteBucket, checkDailyQuota, bumpDailyQuota } from '../middleware/rate-limit.js';
import { checkIPWhitelist } from '../middleware/ip-whitelist.js';
import { pushMessage } from '../services/push.js';
import { loadToken } from './push.js';

/**
 * Header 风格 API：
 * - POST /api/v1/push          简化风格 { msgType, content, title }
 * - POST /api/v2/openapi/messages/send  WeCom 兼容 { toUser, msgType, content }
 *
 * 鉴权：X-API-Key 头携带 token
 * toUser 校验：传了 toUser 时必须是 token 绑定接收人集合的子集
 */
export function registerAPIRoutes(app) {
  app.post('/api/v1/push', apiV1Handler);
  app.post('/api/v2/openapi/messages/send', apiV2Handler);
}

/**
 * 通用前置：解析 token + 鉴权 + 限流 + IP 白名单
 * 失败时 throw AppError，由 setErrorHandler 转 HTTP 响应
 */
async function prepareToken(req) {
  const tokenValue = (req.headers['x-api-key'] || '').trim();
  if (!tokenValue) {
    throw new AppError(40101, 'missing X-API-Key', { statusCode: 401 });
  }
  const token = loadToken(tokenValue);
  if (!token) {
    throw new AppError(40101, 'token not found', { statusCode: 404 });
  }
  if (token.disabled) {
    throw new AppError(40302, 'token disabled', { statusCode: 403 });
  }
  if (token.expired) {
    throw new AppError(40303, 'token expired', { statusCode: 403 });
  }

  // IP 白名单
  checkIPWhitelist(req.ip, token.ip_whitelist);

  // 限流
  if (!checkMinuteBucket(token)) {
    throw new AppError(42901, 'rate limited', { statusCode: 429, headers: { 'retry-after': '60' } });
  }

  return token;
}

async function apiV1Handler(req, reply) {
  reply.header('cache-control', 'no-store');
  const token = await prepareToken(req);

  const body = req.body || {};
  const msgType = body.msgType || 'text';
  const text = (body.content || '').trim();
  if (!text) {
    throw new AppError(40001, 'content 不能为空', { statusCode: 400 });
  }
  const title = body.title || '';
  const description = body.description || '';
  const url = body.url || '';

  // 校验消息类型
  const allowed = ['text', 'markdown', 'textcard', 'image', 'news'];
  if (!allowed.includes(msgType)) {
    throw new AppError(40002, `invalid msgType: ${msgType}`, { statusCode: 400 });
  }

  // 构造内容
  const content = buildContentV1({ msgType, text, title, description, url });

  // @all 配额
  const atAllCheck = checkAtAll(token);
  if (atAllCheck) {
    const { allowed, current, limit, retryAfterSec } = atAllCheck;
    if (!allowed) {
      reply.header('retry-after', String(retryAfterSec || 3600));
      throw new AppError(42902, `@all daily limit reached (${current}/${limit})`, { statusCode: 429 });
    }
    bumpDailyQuota(`atall:${token.app_id}`);
  }

  const result = await pushMessage({
    token: { ...token, token: token.token },
    msgType,
    content,
    clientIp: req.ip,
    requestId: req.id,
  });

  const statusCode = result.success ? 200 : (isNetworkError(result.errorCode) ? 502 : 200);
  reply.code(statusCode).send({
    code: result.success ? 0 : (result.errorCode || 50000),
    message: result.success ? 'ok' : (result.errorMessage || 'failed'),
    msgid: result.msgid || '',
    timestamp: Math.floor(Date.now() / 1000),
  });
}

async function apiV2Handler(req, reply) {
  reply.header('cache-control', 'no-store');
  const token = await prepareToken(req);

  const body = req.body || {};
  const msgType = body.msgType || 'text';
  const content = (body.content || '').trim();
  if (!content) {
    throw new AppError(40001, 'content 不能为空', { statusCode: 400 });
  }

  // toUser 子集校验：传了 toUser 时必须是绑定集合的子集
  const toUserStr = body.toUser || '';
  if (toUserStr) {
    const requestedUsers = toUserStr.split('|').map(s => s.trim()).filter(Boolean);
    const boundUsers = (token.recipients || [])
      .filter(r => r.recvType === 'user')
      .map(r => r.recvValue);
    // 若绑定集合含 @all，允许任意 user 子集
    if (!boundUsers.includes('@all')) {
      const notBound = requestedUsers.filter(u => !boundUsers.includes(u));
      if (notBound.length > 0) {
        throw new AppError(40305, `toUser not in token binding: ${notBound.join(',')}`, { statusCode: 403 });
      }
    }
    // 子集校验通过，临时覆盖 recipients（仍只能在绑定集合内）
    token.recipients = requestedUsers.map(u => ({ recvType: 'user', recvValue: u }));
  }

  // 校验消息类型
  const allowed = ['text', 'markdown', 'textcard', 'image', 'news'];
  if (!allowed.includes(msgType)) {
    throw new AppError(40002, `invalid msgType: ${msgType}`, { statusCode: 400 });
  }

  const contentObj = buildContentV2({ msgType, content, body });

  const result = await pushMessage({
    token: { ...token, token: token.token },
    msgType,
    content: contentObj,
    clientIp: req.ip,
    requestId: req.id,
  });

  const statusCode = result.success ? 200 : (isNetworkError(result.errorCode) ? 502 : 200);
  reply.code(statusCode).send({
    errcode: result.success ? 0 : (result.errorCode || 50000),
    errmsg: result.success ? 'ok' : (result.errorMessage || 'failed'),
    msgid: result.msgid || '',
  });
}

function buildContentV1({ msgType, text, title, description, url }) {
  switch (msgType) {
    case 'text':
      return { text };
    case 'markdown':
      return { text, desp: text };
    case 'textcard':
      return { title: title || text, description, url, btntxt: '详情' };
    case 'image':
      return { url };
    case 'news':
      return { articles: [{ title: title || text, description, url }] };
  }
}

function buildContentV2({ msgType, content, body }) {
  switch (msgType) {
    case 'text':
      return { text: content };
    case 'markdown':
      return { text: content, desp: content };
    case 'textcard':
      return { title: body.title || content, description: body.description || '', url: body.url || '', btntxt: body.btntxt || '详情' };
    case 'image':
      return { url: body.url || content };
    case 'news':
      return { articles: body.articles || [{ title: content }] };
  }
}

function checkAtAll(token) {
  if (token.channel_type !== 'app') return null;
  const hasAtAll = (token.recipients || []).some(r => r.recvType === 'user' && r.recvValue === '@all');
  if (!hasAtAll) return null;
  const db = getDB();
  const app = db.prepare('SELECT allow_at_all, at_all_daily_limit FROM apps WHERE id=?').get(token.app_id);
  if (!app || !app.allow_at_all) {
    throw new AppError(40304, '@all not allowed for this app', { statusCode: 403 });
  }
  return checkDailyQuota(`atall:${token.app_id}`, app.at_all_daily_limit);
}

function isNetworkError(errcode) {
  return errcode >= 50000 && errcode < 51000;
}

export default { registerAPIRoutes };
