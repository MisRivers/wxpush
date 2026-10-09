import cron from 'node-cron';
import { getDB } from '../db/index.js';
import { logger } from '../utils/logger.js';

let task = null;

/**
 * 统计聚合任务
 *
 * 每天 00:05（Asia/Shanghai 00:05 = UTC 16:05 前一天）聚合前一天的推送数据到 stats_daily。
 * 幂等 upsert：UNIQUE(date, token_id) 保证重复执行不会重复计数。
 *
 * cron: 5 16 * * *（UTC 16:05 = Shanghai 00:05）
 */
export function startStatsAggregator() {
  if (task) return;
  task = cron.schedule('5 16 * * *', async () => {
    await aggregate();
  });
  logger.info('stats-aggregator started (5 16 * * * UTC = 00:05 Shanghai)');
}

async function aggregate() {
  const db = getDB();
  // 获取昨天的 Asia/Shanghai 日期范围
  const { dateStr, startTs, endTs } = getYesterdayShanghaiRange();

  // 全局聚合
  const global = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN status='failed' OR status='error' THEN 1 ELSE 0 END) AS failed
    FROM logs WHERE created_at >= ? AND created_at < ?
  `).get(startTs, endTs);

  db.prepare(`
    INSERT INTO stats_daily(date, token_id, total_count, success_count, failed_count)
    VALUES(?, NULL, ?, ?, ?)
    ON CONFLICT(date, token_id) DO UPDATE SET
      total_count=excluded.total_count,
      success_count=excluded.success_count,
      failed_count=excluded.failed_count
  `).run(dateStr, global.total || 0, global.success || 0, global.failed || 0);

  // 按 token 聚合
  const perToken = db.prepare(`
    SELECT
      token_id,
      COUNT(*) AS total,
      SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN status='failed' OR status='error' THEN 1 ELSE 0 END) AS failed
    FROM logs
    WHERE created_at >= ? AND created_at < ? AND token_id IS NOT NULL
    GROUP BY token_id
  `).all(startTs, endTs);

  const stmt = db.prepare(`
    INSERT INTO stats_daily(date, token_id, total_count, success_count, failed_count)
    VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(date, token_id) DO UPDATE SET
      total_count=excluded.total_count,
      success_count=excluded.success_count,
      failed_count=excluded.failed_count
  `);
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      stmt.run(dateStr, r.token_id, r.total, r.success, r.failed);
    }
  });
  tx(perToken);

  logger.info({ date: dateStr, globalTotal: global.total, tokenCount: perToken.length }, 'stats aggregated');
}

/**
 * 获取 Asia/Shanghai 昨天的日期范围
 */
function getYesterdayShanghaiRange() {
  const now = new Date();
  const shToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const [y, m, d] = shToday.split('-').map(Number);
  // Shanghai 今天 00:00 的 UTC 时间
  const todayStart = new Date(Date.UTC(y, m - 1, d) - 8 * 3600 * 1000);
  // 昨天 00:00 ~ 今天 00:00
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);

  return {
    dateStr: shToday, // 昨天的日期需要从 yesterdayStart 计算
    startTs: Math.floor(yesterdayStart.getTime() / 1000),
    endTs: Math.floor(todayStart.getTime() / 1000),
  };
}

export function stopStatsAggregator() {
  if (task) {
    task.stop();
    task = null;
  }
}

export default { startStatsAggregator, stopStatsAggregator };
