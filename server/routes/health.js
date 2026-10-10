import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDB } from '../db/index.js';
import { logger } from '../utils/logger.js';

// 读取 VERSION 文件（位于项目根目录）
let version = 'unknown';
try {
  version = readFileSync(join(process.cwd(), 'VERSION'), 'utf8').trim();
} catch {
  // 忽略
}

/**
 * GET /healthz — 不鉴权，供 nginx/PM2 探活
 * 返回 { status, db, uptime_s, version }
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
  reply.code(200).send({ status: 'ok', db: dbStatus, uptime_s: uptimeSec, version });
}
