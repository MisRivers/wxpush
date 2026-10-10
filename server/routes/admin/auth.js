import bcrypt from 'bcryptjs';
import { getDB } from '../../db/index.js';
import { AppError } from '../../middleware/error.js';
import { signAdminJWT } from '../../middleware/auth.js';
import { checkDailyQuota, bumpDailyQuota, resetDailyQuota } from '../../middleware/rate-limit.js';
import { isValidUsername, isValidPasswordHash } from '../../utils/validator.js';
import config from '../../config.js';
import { logger } from '../../utils/logger.js';

/**
 * 管理后台鉴权路由
 * - GET  /api/admin/auth/status  系统初始化状态 + Turnstile 配置（公开）
 * - POST /api/admin/auth/init    首次初始化（二次保护：settings.init_completed=0 才允许）
 * - POST /api/admin/auth/login  登录（per-IP 限流：10/min，失败 5 次锁 15 分钟）
 * - GET  /api/admin/auth/me     当前用户信息（需鉴权）
 * - POST /api/admin/auth/logout 注销（前端丢弃 JWT 即可，后端无状态）
 *
 * 密码安全：客户端 SHA-256 哈希后传输，后端 bcrypt 二次哈希存储
 * 登录失败计数器落 rate_counters（key=`login_fail:{ip}`），重启不丢失。
 */
export function registerAuthRoutes(app) {
  app.get('/api/admin/auth/status', statusHandler);
  app.post('/api/admin/auth/init', initHandler);
  app.post('/api/admin/auth/login', loginHandler);
  // me 路由需要鉴权，由调用方在 app.js 中统一挂 preHandler
}

/**
 * 获取 Turnstile 配置（优先 settings 表，其次 env）
 * 返回 { site_key, enabled }
 */
function getTurnstileConfig(db) {
  const siteRow = db.prepare("SELECT value FROM settings WHERE key='turnstile_site_key'").get();
  const siteKey = (siteRow && siteRow.value) || config.TURNSTILE_SITE_KEY || '';
  return { siteKey, enabled: !!siteKey };
}

/**
 * 获取 Turnstile secret key（优先 settings 表，其次 env）
 */
function getTurnstileSecret(db) {
  const secretRow = db.prepare("SELECT value FROM settings WHERE key='turnstile_secret_key'").get();
  return (secretRow && secretRow.value) || config.TURNSTILE_SECRET_KEY || '';
}

/**
 * 调用 Cloudflare siteverify 验证 Turnstile token
 */
async function verifyTurnstile(token, ip) {
  const db = getDB();
  const secret = getTurnstileSecret(db);
  if (!secret) return true; // 未配置 secret 则跳过

  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret,
        response: token,
        ...(ip ? { remoteip: ip } : {}),
      }),
    });
    const data = await resp.json();
    if (!data.success) {
      logger.warn({ errors: data['error-codes'] }, 'turnstile verification failed');
      return false;
    }
    return true;
  } catch (e) {
    logger.error({ err: e.message }, 'turnstile verify request failed');
    return false;
  }
}

/**
 * 公开接口：返回系统是否已初始化 + Turnstile 配置
 * 前端路由守卫据此决定跳 /init 还是 /login
 */
async function statusHandler(req, reply) {
  reply.header('cache-control', 'no-store');
  const db = getDB();
  const row = db.prepare("SELECT value FROM settings WHERE key='init_completed'").get();
  const initialized = !!(row && row.value === '1');
  const turnstile = getTurnstileConfig(db);
  reply.send({ code: 0, data: { initialized, turnstile_site_key: turnstile.siteKey } });
}

/**
 * 初始化：创建管理员账号 + 标记 init_completed=1
 * 密码为客户端 SHA-256 哈希值，后端 bcrypt 二次哈希存储
 * 可选：同时配置 Turnstile site_key / secret_key
 */
async function initHandler(req, reply) {
  reply.header('cache-control', 'no-store');
  const db = getDB();

  // 二次保护：已初始化则 409
  const row = db.prepare("SELECT value FROM settings WHERE key='init_completed'").get();
  if (row && row.value === '1') {
    throw new AppError(40901, 'system already initialized', { statusCode: 409 });
  }

  const body = req.body || {};
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (!isValidUsername(username)) {
    throw new AppError(40001, 'username 格式不合法（3-32 字符，字母开头）', { statusCode: 400 });
  }
  if (!isValidPasswordHash(password)) {
    throw new AppError(40001, 'password 哈希格式不合法（应为 64 位十六进制 SHA-256）', { statusCode: 400 });
  }

  // 用户名唯一性
  const exist = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if (exist) {
    throw new AppError(40902, `username '${username}' already taken`, { statusCode: 409 });
  }

  // 可选：Turnstile 配置
  const turnstileSiteKey = String(body.turnstile_site_key || '').trim();
  const turnstileSecretKey = String(body.turnstile_secret_key || '').trim();
  if (turnstileSiteKey) {
    db.prepare("INSERT INTO settings(key, value) VALUES('turnstile_site_key', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(turnstileSiteKey);
  }
  if (turnstileSecretKey) {
    db.prepare("INSERT INTO settings(key, value) VALUES('turnstile_secret_key', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(turnstileSecretKey);
  }

  const hash = await bcrypt.hash(password, config.BCRYPT_COST);
  const result = db.prepare('INSERT INTO users(username, password_hash, role, pw_algo) VALUES(?, ?, ?, ?)').run(username, hash, 'admin', 'v2');
  db.prepare("UPDATE settings SET value='1' WHERE key='init_completed'").run();

  // 审计
  audit(db, { actor: username, action: 'init', target: JSON.stringify({ user_id: result.lastInsertRowid }), clientIp: req.ip, requestId: req.id });

  const jwt = signAdminJWT({ id: result.lastInsertRowid, username, role: 'admin', session_version: 0 });
  logger.info({ userId: result.lastInsertRowid, username, ip: req.ip }, 'admin initialized');

  reply.code(201).send({
    code: 0,
    message: 'initialized',
    token: jwt,
    user: { id: result.lastInsertRowid, username, role: 'admin' },
  });
}

/**
 * 登录：per-IP 限流 + 失败 5 次锁 15 分钟
 * 密码为客户端 SHA-256 哈希值
 * 若 Turnstile 已配置，需验证 turnstile_token
 */
async function loginHandler(req, reply) {
  reply.header('cache-control', 'no-store');
  const ip = req.ip;
  const lockKey = `login_fail:${ip}`;

  // 1. 检查锁定状态（天级计数器：失败 >= 5 次即锁当日剩余时间，最多 15 分钟）
  const lockCheck = checkDailyQuota(lockKey, 5);
  if (!lockCheck.allowed) {
    const retryAfter = Math.min(lockCheck.retryAfterSec || 900, 900);
    reply.header('retry-after', String(retryAfter));
    throw new AppError(42902, `too many failed attempts, locked. retry after ${retryAfter}s`, {
      statusCode: 429,
      headers: { 'retry-after': String(retryAfter) },
    });
  }

  // 分钟级限流：10/min（用内存桶近似，登录路径用简单计数）
  if (!checkLoginMinuteRate(ip)) {
    throw new AppError(42901, 'rate limited (per minute)', { statusCode: 429, headers: { 'retry-after': '60' } });
  }

  const db = getDB();

  // 2. Turnstile 验证（若已配置）
  const turnstile = getTurnstileConfig(db);
  if (turnstile.enabled) {
    const turnstileToken = String(req.body?.turnstile_token || '');
    if (!turnstileToken) {
      throw new AppError(40002, '请完成人机验证', { statusCode: 400 });
    }
    const ok = await verifyTurnstile(turnstileToken, ip);
    if (!ok) {
      throw new AppError(40003, '人机验证未通过，请重试', { statusCode: 400 });
    }
  }

  const body = req.body || {};
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (!username || !password) {
    throw new AppError(40001, 'username and password required', { statusCode: 400 });
  }

  const user = db.prepare('SELECT id, username, password_hash, role, pw_algo FROM users WHERE username=?').get(username);

  if (!user) {
    bumpDailyQuota(lockKey);
    audit(db, { actor: username, action: 'login_fail', target: JSON.stringify({ reason: 'user_not_found' }), clientIp: ip, requestId: req.id });
    throw new AppError(40101, 'invalid credentials', { statusCode: 401 });
  }

  // 密码算法版本检查
  if (user.pw_algo === 'v1') {
    // 旧格式（bcrypt(plaintext)），无法用 SHA-256 哈希验证
    throw new AppError(41001, '密码安全策略已升级，请通过 ./go.sh reset-password 重置密码', { statusCode: 410 });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    bumpDailyQuota(lockKey);
    audit(db, { actor: username, action: 'login_fail', target: JSON.stringify({ reason: 'wrong_password' }), clientIp: ip, requestId: req.id });
    throw new AppError(40101, 'invalid credentials', { statusCode: 401 });
  }

  // 登录成功：重置该 IP 当日失败计数
  resetDailyQuota(lockKey);

  // 单设备登录：递增 session_version，使旧设备的 JWT 失效
  db.prepare('UPDATE users SET session_version=session_version+1, updated_at=unixepoch() WHERE id=?').run(user.id);
  // 重新读取递增后的 session_version
  const updated = db.prepare('SELECT session_version FROM users WHERE id=?').get(user.id);

  const jwt = signAdminJWT({ id: user.id, username: user.username, role: user.role, session_version: updated.session_version });
  audit(db, { actor: user.username, action: 'login', target: null, clientIp: ip, requestId: req.id });
  logger.info({ userId: user.id, username: user.username, ip, sv: updated.session_version }, 'admin login (new session, old devices kicked)');

  reply.send({
    code: 0,
    message: 'ok',
    token: jwt,
    user: { id: user.id, username: user.username, role: user.role },
  });
}

// 简单分钟级登录限流：10/min per IP
const loginMinute = new Map(); // Map<ip, {count, windowStart}>
function checkLoginMinuteRate(ip) {
  const now = Date.now();
  let entry = loginMinute.get(ip);
  if (!entry || now - entry.windowStart > 60_000) {
    entry = { count: 0, windowStart: now };
    loginMinute.set(ip, entry);
  }
  entry.count++;
  return entry.count <= 10;
}

/**
 * 当前用户信息（需鉴权，preHandler 由 app.js 统一挂）
 */
export async function meHandler(req, reply) {
  reply.header('cache-control', 'no-store');
  reply.send({
    code: 0,
    user: {
      id: req.adminUser.id,
      username: req.adminUser.username,
      role: req.adminUser.role,
    },
  });
}

/**
 * 审计日志写入
 */
function audit(db, { actor, action, target, clientIp, requestId }) {
  try {
    db.prepare('INSERT INTO audit_logs(actor, action, target, detail, client_ip, request_id) VALUES(?, ?, ?, ?, ?, ?)')
      .run(actor, action, target, null, clientIp || null, requestId || null);
  } catch (e) {
    logger.warn({ err: e.message, action }, 'audit log write failed');
  }
}

export default { registerAuthRoutes, meHandler };
