import { getDB } from '../db/index.js';
import { logger } from '../utils/logger.js';

/**
 * GET /healthz — 不鉴权，供 nginx/PM2 探活
 * 返回 { status: 'ok', db: 'ok'|'error', uptime_s: N }
 */
export default async function healthHandler(req, reply) {
  let dbStatus = 'ok';
  try {
    getDB().prepare('SELECT 1').get();
  } catch (e) {
    dbStatus = 'error';
    logger.error({ err: e.message }, 'healthz db check failed');
  }
  const uptimeSec = Math.floor(process.uptime());
  reply.code(200).send({ status: 'ok', db: dbStatus, uptime_s: uptimeSec });
}
