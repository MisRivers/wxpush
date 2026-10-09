import { getDB } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { AppError } from './error.js';

/**
 * 双层限流：
 * - 分钟级内存桶：令牌桶（重启清零，性能高）
 * - 天级 SQLite 计数器：防重启清零（仅 @all + 登录失败这类关键路径落库）
 *
 * 分钟桶实现：每 token 维护 { tokens, lastRefillAt }，按 token.rate_limit_per_min 配额
 */

const buckets = new Map(); // Map<tokenValue, { tokens, lastRefillAt, capacity }>

/**
 * 令牌桶限流（分钟级）
 * - capacity = token.rate_limit_per_min
 * - 每秒补充 capacity/60 个令牌
 * - 请求消耗 1 个令牌
 *
 * @param {object} token { token, rate_limit_per_min }
 * @returns {boolean} true=允许，false=拒绝
 */
export function checkMinuteBucket(token) {
  const cap = token.rate_limit_per_min || 0;
  if (cap <= 0) return true; // 0 = 不限

  const now = Date.now();
  let bucket = buckets.get(token.token);
  if (!bucket) {
    bucket = { tokens: cap, lastRefillAt: now, capacity: cap };
    buckets.set(token.token, bucket);
  }

  // 补充令牌（按时间）
  const elapsedSec = (now - bucket.lastRefillAt) / 1000;
  const refill = (cap / 60) * elapsedSec;
  bucket.tokens = Math.min(cap, bucket.tokens + refill);
  bucket.lastRefillAt = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }
  return false;
}

export function minuteBucketsInfo() {
  return { count: buckets.size };
}

/**
 * 天级配额计数器（持久化在 SQLite rate_counters 表）
 *
 * - 用例 1: @all 推送限制（key=`atall:{app_id}`）
 * - 用例 2: 登录失败计数（key=`login_fail:{ip}`）
 *
 * @param {string} key 如 'atall:5'
 * @param {number} limit 配额上限
 * @returns {{allowed: boolean, current: number, limit: number, retryAfterSec?: number}}
 */
export function checkDailyQuota(key, limit) {
  const day = getTodayShanghai();
  const db = getDB();
  const row = db.prepare('SELECT count FROM rate_counters WHERE key=? AND day=?').get(key, day);
  const current = row ? row.count : 0;

  if (current >= limit) {
    // 计算距离明日 0 点的剩余秒数（Asia/Shanghai 日界）
    const retryAfterSec = secondsUntilNextShanghaiDay();
    return { allowed: false, current, limit, retryAfterSec };
  }
  return { allowed: true, current, limit };
}

/**
 * 增加天级计数器
 */
export function bumpDailyQuota(key, increment = 1) {
  const day = getTodayShanghai();
  const db = getDB();
  db.prepare(`
    INSERT INTO rate_counters(key, day, count, updated_at) VALUES(?, ?, ?, unixepoch())
    ON CONFLICT(key, day) DO UPDATE SET count=count+?, updated_at=unixepoch()
  `).run(key, day, increment, increment);
}

/**
 * 重置天级计数器（某 key 当日清零）
 */
export function resetDailyQuota(key) {
  const day = getTodayShanghai();
  const db = getDB();
  db.prepare('UPDATE rate_counters SET count=0, updated_at=unixepoch() WHERE key=? AND day=?').run(key, day);
}

/**
 * 限制装饰器：在 preHandler hook 中按 token 做分钟级限流
 * 调用方式：fastify.addHook('preHandler', makeTokenRateLimiter((req)=>req.token))
 */
export function makeTokenRateLimiter(getTokenFn) {
  return async function (req, reply) {
    const token = getTokenFn(req);
    if (!token) return;
    if (!checkMinuteBucket(token)) {
      reply.code(429);
      reply.header('cache-control', 'no-store');
      reply.header('retry-after', '60');
      throw new AppError(42901, 'rate limited (per minute)', { statusCode: 429, headers: { 'retry-after': '60' } });
    }
  };
}

// ---- 时间工具：Asia/Shanghai 日界 ----
function getTodayShanghai() {
  // 把当前 UTC 时间格式化为 Shanghai YYYY-MM-DD
  const now = new Date();
  const sh = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return sh; // 'YYYY-MM-DD'
}

function secondsUntilNextShanghaiDay() {
  // 简化实现：返回到本地次日凌晨 0 点的剩余秒数（用 Asia/Shanghai 时区计算）
  const now = new Date();
  const nextMidnight = new Date(now);
  // 假定容器/服务器是 UTC，用 Shanghai 时区；这里用近似实现
  nextMidnight.setUTCHours(16, 0, 0, 0); // Shanghai 0:00 UTC = 16:00 前一天
  if (nextMidnight.getTime() <= now.getTime()) {
    nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  }
  return Math.max(1, Math.ceil((nextMidnight.getTime() - now.getTime()) / 1000));
}

export default {
  checkMinuteBucket,
  checkDailyQuota,
  bumpDailyQuota,
  resetDailyQuota,
  makeTokenRateLimiter,
  minuteBucketsInfo,
};
