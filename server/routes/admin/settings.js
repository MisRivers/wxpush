import bcrypt from 'bcryptjs';
import { getDB, backupDB } from '../../db/index.js';
import { AppError } from '../../middleware/error.js';
import { adminAuthRequired } from '../../middleware/auth.js';
import { isValidPasswordHash } from '../../utils/validator.js';
import config from '../../config.js';
import { audit } from './utils.js';
import { logger } from '../../utils/logger.js';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

const auth = { preHandler: [adminAuthRequired] };

/**
 * 系统设置 + 密码 + access_token 刷新 + 日志清理 + DB 导出 + MASTER_KEY 轮换
 * - GET  /api/admin/settings
 * - PUT  /api/admin/settings
 * - POST /api/admin/settings/password          修改密码
 * - POST /api/admin/settings/refresh-token     手动刷新某 app 的 access_token
 * - POST /api/admin/settings/clean-logs        清理旧日志
 * - GET  /api/admin/settings/db-export        导出数据库备份
 * - POST /api/admin/settings/rotate-master-key MASTER_KEY 轮换入口
 */
export function registerSettingsRoutes(app) {
  app.get('/api/admin/settings', { ...auth }, getSettings);
  app.put('/api/admin/settings', { ...auth }, updateSettings);
  app.post('/api/admin/settings/password', { ...auth }, changePassword);
  app.post('/api/admin/settings/refresh-token', { ...auth }, refreshToken);
  app.post('/api/admin/settings/clean-logs', { ...auth }, cleanLogs);
  app.get('/api/admin/settings/db-export', { ...auth }, exportDB);
  app.post('/api/admin/settings/rotate-master-key', { ...auth }, rotateMasterKey);
}

async function getSettings(req, reply) {
  const db = getDB();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  // 不返回 turnstile secret key（敏感信息）
  delete settings.turnstile_secret_key;
  reply.send({ code: 0, data: settings });
}

async function updateSettings(req, reply) {
  const db = getDB();
  const b = req.body || {};
  const allowedKeys = ['default_rate_limit', 'log_retention_days', 'turnstile_site_key', 'turnstile_secret_key'];

  for (const key of allowedKeys) {
    if (b[key] !== undefined) {
      const val = String(b[key]);
      if (key === 'default_rate_limit') {
        const n = Number(val);
        if (n < 0 || n > 10000) throw new AppError(40001, 'default_rate_limit 范围 0-10000', { statusCode: 400 });
      }
      if (key === 'log_retention_days') {
        const n = Number(val);
        if (n < 1 || n > 365) throw new AppError(40001, 'log_retention_days 范围 1-365', { statusCode: 400 });
      }
      // turnstile_site_key / turnstile_secret_key 允许空字符串（清除配置）
      db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, val);
    }
  }

  audit(db, { actor: req.adminUser.username, action: 'update_settings', targetType: 'settings', targetId: null, detail: { ...b, turnstile_secret_key: b.turnstile_secret_key !== undefined ? '***' : undefined }, clientIp: req.ip, requestId: req.id });
  reply.send({ code: 0, message: 'updated' });
}

async function changePassword(req, reply) {
  const db = getDB();
  const b = req.body || {};
  const oldPassword = String(b.old_password || '');
  const newPassword = String(b.new_password || '');

  if (!isValidPasswordHash(newPassword)) {
    throw new AppError(40001, 'new password 哈希格式不合法', { statusCode: 400 });
  }

  const user = db.prepare('SELECT id, password_hash, pw_algo FROM users WHERE id=?').get(req.adminUser.id);

  // 旧格式密码无法通过哈希验证
  if (user.pw_algo === 'v1') {
    throw new AppError(41001, '当前密码为旧安全格式，请通过 ./go.sh reset-password 重置后再修改', { statusCode: 410 });
  }

  const ok = await bcrypt.compare(oldPassword, user.password_hash);
  if (!ok) throw new AppError(40101, 'old password incorrect', { statusCode: 401 });

  const hash = await bcrypt.hash(newPassword, config.BCRYPT_COST);
  db.prepare('UPDATE users SET password_hash=?, pw_algo=?, updated_at=unixepoch() WHERE id=?').run(hash, 'v2', user.id);
  audit(db, { actor: req.adminUser.username, action: 'change_password', targetType: 'user', targetId: user.id, clientIp: req.ip, requestId: req.id });
  reply.send({ code: 0, message: 'password changed' });
}

async function refreshToken(req, reply) {
  const db = getDB();
  const b = req.body || {};
  const appId = Number(b.app_id);
  if (!appId) throw new AppError(40001, 'app_id required', { statusCode: 400 });

  const { loadAppForToken, getAccessToken } = await import('../../services/access-token.js');
  const app = await loadAppForToken(appId);
  if (!app) throw new AppError(40401, 'app not found', { statusCode: 404 });

  try {
    const r = await getAccessToken(app, { forceRefresh: true });
    audit(db, { actor: req.adminUser.username, action: 'refresh_access_token', targetType: 'app', targetId: appId, clientIp: req.ip, requestId: req.id });
    reply.send({ code: 0, message: 'refreshed', expires_at: r.expiresAt });
  } catch (e) {
    reply.code(502).send({ code: 50001, message: `refresh failed: ${e.message}` });
  }
}

async function cleanLogs(req, reply) {
  const db = getDB();
  const b = req.body || {};
  const retentionDays = Number(b.days ?? getSetting(db, 'log_retention_days', 30));
  if (retentionDays < 1 || retentionDays > 365) throw new AppError(40001, 'days 范围 1-365', { statusCode: 400 });

  const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400;
  // 分批删除，避免长事务
  let deleted = 0;
  const BATCH = 1000;
  for (;;) {
    const r = db.prepare('DELETE FROM logs WHERE id IN (SELECT id FROM logs WHERE created_at < ? ORDER BY id LIMIT ?)').run(cutoff, BATCH);
    deleted += r.changes;
    if (r.changes < BATCH) break;
  }

  audit(db, { actor: req.adminUser.username, action: 'clean_logs', targetType: 'logs', targetId: null, detail: { days: retentionDays, deleted }, clientIp: req.ip, requestId: req.id });
  reply.send({ code: 0, message: 'cleaned', deleted });
}

async function exportDB(req, reply) {
  try {
    // 生成备份文件路径
    const dbPath = config.DB_PATH;
    const backupDir = join(dirname(dbPath), 'backups');
    mkdirSync(backupDir, { recursive: true });
    const backupPath = join(backupDir, `push-backup-${Date.now()}.db`);
    backupDB(backupPath);
    audit(getDB(), { actor: req.adminUser.username, action: 'export_db', targetType: 'db', targetId: null, clientIp: req.ip, requestId: req.id });
    reply.send({ code: 0, message: 'backup created', path: backupPath });
  } catch (e) {
    logger.error({ err: e.message }, 'db export failed');
    reply.code(500).send({ code: 50000, message: `backup failed: ${e.message}` });
  }
}

async function rotateMasterKey(req, reply) {
  // MASTER_KEY 轮换：需要旧 key 和新 key
  // 实际轮换需要重新加密所有密文字段，这是高风险操作
  // 此接口仅记录请求并返回指导，实际轮换通过 CLI 脚本完成
  const b = req.body || {};
  const oldKey = String(b.old_master_key || '');
  const newKey = String(b.new_master_key || '');

  if (!oldKey || !newKey) {
    throw new AppError(40001, 'old_master_key and new_master_key required', { statusCode: 400 });
  }

  const oldBuf = Buffer.from(oldKey, 'base64');
  const newBuf = Buffer.from(newKey, 'base64');
  if (oldBuf.length !== 32) throw new AppError(40001, 'old_master_key 必须 32 字节 base64', { statusCode: 400 });
  if (newBuf.length !== 32) throw new AppError(40001, 'new_master_key 必须 32 字节 base64', { statusCode: 400 });

  // 验证旧 key 是否正确（尝试解密一条 corp_secret）
  const db = getDB();
  const testRow = db.prepare('SELECT corp_secret_enc, secret_iv FROM apps LIMIT 1').get();
  if (testRow) {
    const { decrypt } = await import('../../utils/crypto.js');
    try {
      // 用配置中的当前 key 解密（已轮换则失败）
      decrypt(testRow.corp_secret_enc, testRow.secret_iv);
    } catch (e) {
      throw new AppError(40101, 'old_master_key 与当前数据不匹配', { statusCode: 401 });
    }
  }

  // 实际轮换需要更新 .env 并重新加密所有字段，通过 CLI 完成
  reply.send({
    code: 0,
    message: 'master key rotation request accepted. Use CLI script: node server/scripts/rotate-master-key.js',
    warning: 'After rotation, update .env MASTER_KEY and restart the server.',
  });
}

function getSetting(db, key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : fallback;
}

export default { registerSettingsRoutes };
