import cron from 'node-cron';
import { getDB } from '../db/index.js';
import { logger } from '../utils/logger.js';

let task = null;

/**
 * 日志清理任务
 *
 * 每天 03:00（低峰期）清理超过保留天数的日志。
 * 分批 DELETE 每次 1000 行，避免长事务锁库。
 *
 * cron: 0 3 * * *（每天 03:00）
 */
export function startLogRotator() {
  if (task) return;
  task = cron.schedule('0 3 * * *', async () => {
    await rotate();
  });
  logger.info('log-rotator started (0 3 * * *)');
}

async function rotate() {
  const db = getDB();
  const row = db.prepare("SELECT value FROM settings WHERE key='log_retention_days'").get();
  const retentionDays = row ? Number(row.value) : 30;
  if (retentionDays <= 0) return;

  const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400;
  let totalDeleted = 0;
  const BATCH = 1000;

  for (;;) {
    const r = db.prepare('DELETE FROM logs WHERE id IN (SELECT id FROM logs WHERE created_at < ? ORDER BY id LIMIT ?)').run(cutoff, BATCH);
    totalDeleted += r.changes;
    if (r.changes < BATCH) break;
    // 每批之间让出事件循环
    await new Promise(resolve => setImmediate(resolve));
  }

  logger.info({ retentionDays, totalDeleted }, 'log rotation completed');
}

export function stopLogRotator() {
  if (task) {
    task.stop();
    task = null;
  }
}

export default { startLogRotator, stopLogRotator };
