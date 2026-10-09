import { getDB } from '../../db/index.js';
import { AppError } from '../../middleware/error.js';
import { encryptField } from '../../utils/crypto.js';
import {
  isValidAppName, isValidCorpId, isValidAgentId, isValidCorpSecret,
} from '../../utils/validator.js';
import { adminAuthRequired } from '../../middleware/auth.js';
import { audit } from './utils.js';
import { syncVerifyFiles } from '../wx-callback.js';

const auth = { preHandler: [adminAuthRequired] };

/**
 * 应用消息渠道 CRUD
 */
export function registerAppRoutes(app) {
  app.get('/api/admin/apps', { ...auth }, listApps);
  app.post('/api/admin/apps', { ...auth }, createApp);
  app.get('/api/admin/apps/:id', { ...auth }, getApp);
  app.put('/api/admin/apps/:id', { ...auth }, updateApp);
  app.delete('/api/admin/apps/:id', { ...auth }, deleteApp);
  app.post('/api/admin/apps/:id/test', { ...auth }, testApp);
}

async function listApps(req, reply) {
  const db = getDB();
  const rows = db.prepare(`
    SELECT a.id, a.name, a.corp_id, a.agent_id, a.allow_at_all, a.at_all_daily_limit, a.note,
           a.verify_file_name, a.callback_token,
           CASE WHEN a.callback_aes_key_enc IS NOT NULL THEN 1 ELSE 0 END AS callback_configured,
           a.created_at, a.updated_at,
           (SELECT COUNT(*) FROM tokens t WHERE t.app_id=a.id) AS token_count
    FROM apps a ORDER BY a.id DESC
  `).all();
  reply.send({ code: 0, data: rows });
}

async function createApp(req, reply) {
  const db = getDB();
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const corpId = String(b.corp_id || '').trim();
  const agentId = Number(b.agent_id);
  const corpSecret = String(b.corp_secret || '');
  const allowAtAll = b.allow_at_all === undefined ? 1 : (b.allow_at_all ? 1 : 0);
  const atAllDailyLimit = Number(b.at_all_daily_limit ?? 5);
  const note = b.note ? String(b.note) : null;

  if (!isValidAppName(name)) throw new AppError(40001, 'name 格式不合法', { statusCode: 400 });
  if (!isValidCorpId(corpId)) throw new AppError(40001, 'corp_id 格式不合法', { statusCode: 400 });
  if (!isValidAgentId(agentId)) throw new AppError(40001, 'agent_id 格式不合法', { statusCode: 400 });
  if (!isValidCorpSecret(corpSecret)) throw new AppError(40001, 'corp_secret 格式不合法', { statusCode: 400 });
  if (atAllDailyLimit < 0 || atAllDailyLimit > 1000) throw new AppError(40001, 'at_all_daily_limit 范围 0-1000', { statusCode: 400 });

  const { field_enc, secret_iv } = encryptField(corpSecret);

  // 企业微信验证配置（可选）
  const verifyFileName = b.verify_file_name ? String(b.verify_file_name).trim() : null;
  const verifyFileContent = b.verify_file_content ? String(b.verify_file_content) : null;
  const callbackToken = b.callback_token ? String(b.callback_token).trim() : null;
  let cbAesKeyEnc = null, cbAesKeyIv = null;
  if (b.callback_aes_key) {
    const aes = String(b.callback_aes_key).trim();
    const enc = encryptField(aes);
    cbAesKeyEnc = enc.field_enc;
    cbAesKeyIv = enc.secret_iv;
  }

  const result = db.prepare(`
    INSERT INTO apps(name, corp_id, agent_id, corp_secret_enc, secret_iv, allow_at_all, at_all_daily_limit,
      verify_file_name, verify_file_content, callback_token, callback_aes_key_enc, callback_aes_key_iv, note)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, corpId, agentId, field_enc, secret_iv, allowAtAll, atAllDailyLimit,
      verifyFileName, verifyFileContent, callbackToken, cbAesKeyEnc, cbAesKeyIv, note);

  audit(db, { actor: req.adminUser.username, action: 'create_app', targetType: 'app', targetId: result.lastInsertRowid, clientIp: req.ip, requestId: req.id });
  syncVerifyFiles();
  reply.code(201).send({ code: 0, id: result.lastInsertRowid });
}

async function getApp(req, reply) {
  const db = getDB();
  const id = Number(req.params.id);
  const row = db.prepare(`
    SELECT id, name, corp_id, agent_id, allow_at_all, at_all_daily_limit, note,
           verify_file_name, callback_token,
           CASE WHEN callback_aes_key_enc IS NOT NULL THEN 1 ELSE 0 END AS callback_configured,
           created_at, updated_at
    FROM apps WHERE id=?
  `).get(id);
  if (!row) throw new AppError(40401, 'app not found', { statusCode: 404 });
  const at = db.prepare('SELECT expires_at, refresh_fail_count, updated_at FROM access_tokens WHERE app_id=?').get(id);
  reply.send({ code: 0, data: { ...row, access_token: at || null } });
}

async function updateApp(req, reply) {
  const db = getDB();
  const id = Number(req.params.id);
  const b = req.body || {};
  const row = db.prepare('SELECT id FROM apps WHERE id=?').get(id);
  if (!row) throw new AppError(40401, 'app not found', { statusCode: 404 });

  const updates = [];
  const vals = [];
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!isValidAppName(name)) throw new AppError(40001, 'name 格式不合法', { statusCode: 400 });
    updates.push('name=?'); vals.push(name);
  }
  if (b.corp_id !== undefined) {
    const corpId = String(b.corp_id).trim();
    if (!isValidCorpId(corpId)) throw new AppError(40001, 'corp_id 格式不合法', { statusCode: 400 });
    updates.push('corp_id=?'); vals.push(corpId);
  }
  if (b.agent_id !== undefined) {
    const agentId = Number(b.agent_id);
    if (!isValidAgentId(agentId)) throw new AppError(40001, 'agent_id 格式不合法', { statusCode: 400 });
    updates.push('agent_id=?'); vals.push(agentId);
  }
  if (b.corp_secret !== undefined) {
    const corpSecret = String(b.corp_secret);
    if (!isValidCorpSecret(corpSecret)) throw new AppError(40001, 'corp_secret 格式不合法', { statusCode: 400 });
    const { field_enc, secret_iv } = encryptField(corpSecret);
    updates.push('corp_secret_enc=?', 'secret_iv=?'); vals.push(field_enc, secret_iv);
    db.prepare('DELETE FROM access_tokens WHERE app_id=?').run(id);
  }
  if (b.allow_at_all !== undefined) { updates.push('allow_at_all=?'); vals.push(b.allow_at_all ? 1 : 0); }
  if (b.at_all_daily_limit !== undefined) {
    const n = Number(b.at_all_daily_limit);
    if (n < 0 || n > 1000) throw new AppError(40001, 'at_all_daily_limit 范围 0-1000', { statusCode: 400 });
    updates.push('at_all_daily_limit=?'); vals.push(n);
  }
  if (b.note !== undefined) { updates.push('note=?'); vals.push(b.note ? String(b.note) : null); }

  // 企业微信验证配置（可选，传 null 清除）
  if (b.verify_file_name !== undefined) {
    updates.push('verify_file_name=?');
    vals.push(b.verify_file_name ? String(b.verify_file_name).trim() : null);
  }
  if (b.verify_file_content !== undefined) {
    updates.push('verify_file_content=?');
    vals.push(b.verify_file_content ? String(b.verify_file_content) : null);
  }
  if (b.callback_token !== undefined) {
    updates.push('callback_token=?');
    vals.push(b.callback_token ? String(b.callback_token).trim() : null);
  }
  if (b.callback_aes_key !== undefined) {
    if (b.callback_aes_key) {
      const enc = encryptField(String(b.callback_aes_key).trim());
      updates.push('callback_aes_key_enc=?', 'callback_aes_key_iv=?');
      vals.push(enc.field_enc, enc.secret_iv);
    } else {
      updates.push('callback_aes_key_enc=?', 'callback_aes_key_iv=?');
      vals.push(null, null);
    }
  }

  if (updates.length === 0) throw new AppError(40001, 'no fields to update', { statusCode: 400 });
  updates.push('updated_at=unixepoch()');
  vals.push(id);
  db.prepare(`UPDATE apps SET ${updates.join(', ')} WHERE id=?`).run(...vals);

  audit(db, { actor: req.adminUser.username, action: 'update_app', targetType: 'app', targetId: id, clientIp: req.ip, requestId: req.id });
  syncVerifyFiles();
  reply.send({ code: 0, message: 'updated' });
}

async function deleteApp(req, reply) {
  const db = getDB();
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id FROM apps WHERE id=?').get(id);
  if (!row) throw new AppError(40401, 'app not found', { statusCode: 404 });

  const tokenCount = db.prepare('SELECT COUNT(*) AS c FROM tokens WHERE app_id=?').get(id);
  if (tokenCount.c > 0) {
    throw new AppError(40901, `cannot delete: ${tokenCount.c} token(s) still bound to this app`, { statusCode: 409 });
  }

  db.prepare('DELETE FROM apps WHERE id=?').run(id);
  db.prepare('DELETE FROM access_tokens WHERE app_id=?').run(id);
  audit(db, { actor: req.adminUser.username, action: 'delete_app', targetType: 'app', targetId: id, clientIp: req.ip, requestId: req.id });
  syncVerifyFiles();
  reply.send({ code: 0, message: 'deleted' });
}

/**
 * 测试发送：强制刷新 access_token 验证应用配置
 */
async function testApp(req, reply) {
  const id = Number(req.params.id);
  const { loadAppForToken, getAccessToken } = await import('../../services/access-token.js');
  const app = await loadAppForToken(id);
  if (!app) throw new AppError(40401, 'app not found', { statusCode: 404 });

  try {
    const r = await getAccessToken(app, { forceRefresh: true });
    reply.send({ code: 0, message: 'access_token refreshed successfully', expires_at: r.expiresAt });
  } catch (e) {
    reply.code(502).send({ code: 50001, message: `access_token refresh failed: ${e.message}` });
  }
}

export default { registerAppRoutes };
