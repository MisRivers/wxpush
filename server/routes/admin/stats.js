import { getDB } from '../../db/index.js';
import { adminAuthRequired } from '../../middleware/auth.js';

const auth = { preHandler: [adminAuthRequired] };

/**
 * 仪表盘聚合统计
 * - GET /api/admin/stats/dashboard
 *
 * 返回：
 * - today: { total, success, failed, success_rate }
 * - trend_7d: [{ date, total, success, failed }]
 * - active_tokens: 活跃 token 数
 * - access_tokens: [{ app_id, app_name, expires_at, refresh_fail_count }]
 * - top_tokens: [{ token_id, name, total }]  Top10
 * - alerts: { access_token_failures, rate_limited_today }
 */
export function registerStatsRoutes(app) {
  app.get('/api/admin/stats/dashboard', { ...auth }, dashboard);
}

async function dashboard(req, reply) {
  const db = getDB();

  // 今日统计（Asia/Shanghai 日界）
  const { startTs, endTs, dateStr } = getTodayShanghaiRange();
  const todayRow = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN status='failed' OR status='error' THEN 1 ELSE 0 END) AS failed
    FROM logs WHERE created_at >= ? AND created_at < ?
  `).get(startTs, endTs);
  const todayTotal = todayRow?.total || 0;
  const todaySuccess = todayRow?.success || 0;
  const todayFailed = todayRow?.failed || 0;
  const successRate = todayTotal > 0 ? Math.round((todaySuccess / todayTotal) * 10000) / 100 : 0;

  // 7 天趋势（按 Asia/Shanghai 日界聚合，从 logs 直接算，不依赖 stats_daily）
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const { startTs: s, endTs: e } = getShanghaiDayRange(i);
    const row = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN status='failed' OR status='error' THEN 1 ELSE 0 END) AS failed
      FROM logs WHERE created_at >= ? AND created_at < ?
    `).get(s, e);
    trend.push({
      date: formatDateFromTs(s),
      total: row?.total || 0,
      success: row?.success || 0,
      failed: row?.failed || 0,
    });
  }

  // 活跃 token 数（今日有推送记录的）
  const activeTokens = db.prepare(`
    SELECT COUNT(DISTINCT token_id) AS c FROM logs WHERE created_at >= ? AND created_at < ? AND token_id IS NOT NULL
  `).get(startTs, endTs);

  // access_token 缓存状态
  const accessTokens = db.prepare(`
    SELECT at.app_id, a.name AS app_name, at.expires_at, at.refresh_fail_count, at.updated_at
    FROM access_tokens at
    LEFT JOIN apps a ON at.app_id=a.id
  `).all();

  // Top 10 token（今日）
  const topTokens = db.prepare(`
    SELECT t.id, t.name, COUNT(*) AS total,
           SUM(CASE WHEN l.status='success' THEN 1 ELSE 0 END) AS success
    FROM logs l
    LEFT JOIN tokens t ON l.token_id=t.id
    WHERE l.created_at >= ? AND l.created_at < ? AND l.token_id IS NOT NULL
    GROUP BY l.token_id
    ORDER BY total DESC
    LIMIT 10
  `).all(startTs, endTs);

  // 告警红点
  const alertFailures = db.prepare(`
    SELECT app_id, refresh_fail_count FROM access_tokens WHERE refresh_fail_count > 0
  `).all();
  const rateLimitedToday = db.prepare(`
    SELECT COUNT(*) AS c FROM logs WHERE status='rate_limited' AND created_at >= ? AND created_at < ?
  `).get(startTs, endTs);

  reply.send({
    code: 0,
    data: {
      today: {
        total: todayTotal,
        success: todaySuccess,
        failed: todayFailed,
        success_rate: successRate,
      },
      trend_7d: trend,
      active_tokens: activeTokens?.c || 0,
      access_tokens: accessTokens.map(at => ({
        app_id: at.app_id,
        app_name: at.app_name,
        expires_at: at.expires_at,
        refresh_fail_count: at.refresh_fail_count,
        is_expired: at.expires_at ? at.expires_at * 1000 < Date.now() : true,
        updated_at: at.updated_at,
      })),
      top_tokens: topTokens,
      alerts: {
        access_token_failures: alertFailures,
        rate_limited_today: rateLimitedToday?.c || 0,
      },
    },
  });
}

/**
 * Asia/Shanghai 时区的今日 0 点 ~ 次日 0 点的 Unix 时间戳范围
 */
function getTodayShanghaiRange() {
  return getShanghaiDayRange(0);
}

function getShanghaiDayRange(daysAgo) {
  // 用 Intl 获取 Shanghai 当前日期，然后推算
  const now = new Date();
  const shDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const [y, m, d] = shDate.split('-').map(Number);
  // Shanghai 0:00 = UTC 16:00 前一天
  // startTs = Shanghai YYYY-MM-DD 00:00:00 的 UTC 时间
  const start = new Date(Date.UTC(y, m - 1, d) - 8 * 3600 * 1000);
  start.setUTCDate(start.getUTCDate() - daysAgo);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    startTs: Math.floor(start.getTime() / 1000),
    endTs: Math.floor(end.getTime() / 1000),
    dateStr: shDate,
  };
}

function formatDateFromTs(ts) {
  const d = new Date(ts * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

export default { registerStatsRoutes };
