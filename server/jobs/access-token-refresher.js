import cron from 'node-cron';
import { getDB } from '../db/index.js';
import { loadAppForToken, refreshAccessToken } from '../services/access-token.js';
import { logger } from '../utils/logger.js';

let task = null;

/**
 * access_token 主动刷新任务
 *
 * 企业微信 access_token 有效期 7200 秒（2 小时）。
 * 每 5 分钟检查一次，对即将过期（剩余 < 30 分钟）的 token 主动刷新。
 *
 * cron: 每 5 分钟一次
 */
export function startAccessTokenRefresher() {
  if (task) return;
  task = cron.schedule('*/5 * * * *', async () => {
    await refreshAll();
  });
  logger.info('access-token-refresher started (*/5 * * * *)');
}

async function refreshAll() {
  const db = getDB();
  const apps = db.prepare('SELECT id FROM apps').all();
  const now = Date.now();
  const THRESHOLD = 30 * 60 * 1000; // 30 分钟

  for (const { id } of apps) {
    try {
      // 检查缓存是否即将过期
      const cached = db.prepare('SELECT expires_at FROM access_tokens WHERE app_id=?').get(id);
      const expiresAt = cached ? cached.expires_at * 1000 : 0;
      if (expiresAt && expiresAt - now > THRESHOLD) {
        continue; // 还没到刷新时间
      }

      const app = await loadAppForToken(id);
      if (!app) continue;

      await refreshAccessToken(app);
      logger.info({ appId: id }, 'access_token proactively refreshed');
    } catch (e) {
      logger.error({ appId: id, err: e.message }, 'access_token proactive refresh failed');
    }
  }
}

export function stopAccessTokenRefresher() {
  if (task) {
    task.stop();
    task = null;
  }
}

export default { startAccessTokenRefresher, stopAccessTokenRefresher };
