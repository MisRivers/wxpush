import { getDB } from '../../db/index.js';
import { AppError } from '../../middleware/error.js';
import { encryptField } from '../../utils/crypto.js';
import { isValidWebhookUrl, isValidAppName } from '../../utils/validator.js';
import { adminAuthRequired } from '../../middleware/auth.js';
import { audit } from './utils.js';

const auth = { preHandler: [adminAuthRequired] };

const SECURITY_MODES = new Set(['none', 'keyword', 'sign']);

/**
 * 群机器人渠道 CRUD
 * - 安全模式：none / keyword / sign
 * - webhook URL 解析后只存 key（加密）
 * - sign 模式额外存 sign_secret（加密）
 */
export function registerWebhookRoutes(app) {
  app.get('/api/admin/webhooks', { ...auth }, listWebhooks);
  app.post('/api/admin/webhooks', { ...auth }, createWebhook);
  app.get('/api/admin/webhooks/:id', { ...auth }, getWebhook);
  app.put('/api/admin/webhooks/:id', { ...auth }, updateWebhook);
  app.delete('/api/admin/webhooks/:id', { ...auth }, deleteWebhook);
}

async function listWebhooks(req, reply) {
  const db = getDB();
  const rows = db.prepare(`
    SELECT id, name, security_mode, keyword, note, created_at, updated_at,
           (SELECT COUNT(*) FROM tokens t WHERE t.webhook_id=webhooks.id) AS token_count
    FROM webhooks ORDER BY id DESC
  `).all();
  reply.send({ code: 0, data: rows });
}

async function createWebhook(req, reply) {
  const db = getDB();
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const webhookUrl = String(b.webhook_url || '').trim();
  const securityMode = String(b.security_mode || 'none');
  const keyword = b.keyword ? String(b.keyword) : null;
  const signSecret = b.sign_secret ? String(b.sign_secret) : null;
  const note = b.note ? String(b.note) : null;

  if (!isValidAppName(name)) throw new AppError(40001, 'name 格式不合法', { statusCode: 400 });
  if (!isValidWebhookUrl(webhookUrl)) throw new AppError(40001, 'webhook_url 格式不合法', { statusCode: 400 });
  if (!SECURITY_MODES.has(securityMode)) throw new AppError(40001, 'security_mode 必须是 none/keyword/sign', { statusCode: 400 });
  if (securityMode === 'keyword' && !keyword) throw new AppError(40001, 'keyword 模式必须提供 keyword', { statusCode: 400 });
  if (securityMode === 'sign' && !signSecret) throw new AppError(40001, 'sign 模式必须提供 sign_secret', { statusCode: 400 });

  const webhookKey = extractKey(webhookUrl);
  const { field_enc: keyEnc, secret_iv: keyIv } = encryptField(webhookKey);

  let signEnc = null, signIv = null;
  if (securityMode === 'sign' && signSecret) {
    const enc = encryptField(signSecret);
    signEnc = enc.field_enc;
    signIv = enc.secret_iv;
  }

  const result = db.prepare(`
    INSERT INTO webhooks(name, webhook_key_enc, secret_iv, security_mode, keyword, sign_secret_enc, sign_secret_iv, note)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, keyEnc, keyIv, securityMode, keyword, signEnc, signIv, note);

  audit(db, { actor: req.adminUser.username, action: 'create_webhook', targetType: 'webhook', targetId: result.lastInsertRowid, clientIp: req.ip, requestId: req.id });
  reply.code(201).send({ code: 0, id: result.lastInsertRowid });
}

async function getWebhook(req, reply) {
  const db = getDB();
  const id = Number(req.params.id);
  const row = db.prepare(`
    SELECT id, name, security_mode, keyword, note, created_at, updated_at
    FROM webhooks WHERE id=?
  `).get(id);
  if (!row) throw new AppError(40401, 'webhook not found', { statusCode: 404 });
  // 不返回密钥明文
  reply.send({ code: 0, data: { ...row, has_sign_secret: !!row.sign_secret_enc } });
}

async function updateWebhook(req, reply) {
  const db = getDB();
  const id = Number(req.params.id);
  const b = req.body || {};
  const row = db.prepare('SELECT id FROM webhooks WHERE id=?').get(id);
  if (!row) throw new AppError(40401, 'webhook not found', { statusCode: 404 });

  const updates = [];
  const vals = [];
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!isValidAppName(name)) throw new AppError(40001, 'name 格式不合法', { statusCode: 400 });
    updates.push('name=?'); vals.push(name);
  }
  if (b.webhook_url !== undefined) {
    const webhookUrl = String(b.webhook_url).trim();
    if (!isValidWebhookUrl(webhookUrl)) throw new AppError(40001, 'webhook_url 格式不合法', { statusCode: 400 });
    const webhookKey = extractKey(webhookUrl);
    const { field_enc, secret_iv } = encryptField(webhookKey);
    updates.push('webhook_key_enc=?', 'secret_iv=?'); vals.push(field_enc, secret_iv);
  }
  if (b.security_mode !== undefined) {
    const mode = String(b.security_mode);
    if (!SECURITY_MODES.has(mode)) throw new AppError(40001, 'security_mode 必须是 none/keyword/sign', { statusCode: 400 });
    updates.push('security_mode=?'); vals.push(mode);
    // 切换模式时清空相关字段
    if (mode === 'none') {
      updates.push('keyword=?', 'sign_secret_enc=?', 'sign_secret_iv=?'); vals.push(null, null, null);
    } else if (mode === 'keyword') {
      updates.push('sign_secret_enc=?', 'sign_secret_iv=?'); vals.push(null, null);
    }
  }
  if (b.keyword !== undefined) {
    updates.push('keyword=?'); vals.push(b.keyword ? String(b.keyword) : null);
  }
  if (b.sign_secret !== undefined && b.sign_secret) {
    const enc = encryptField(String(b.sign_secret));
    updates.push('sign_secret_enc=?', 'sign_secret_iv=?'); vals.push(enc.field_enc, enc.secret_iv);
  }
  if (b.note !== undefined) { updates.push('note=?'); vals.push(b.note ? String(b.note) : null); }

  if (updates.length === 0) throw new AppError(40001, 'no fields to update', { statusCode: 400 });
  updates.push('updated_at=unixepoch()');
  vals.push(id);
  db.prepare(`UPDATE webhooks SET ${updates.join(', ')} WHERE id=?`).run(...vals);

  audit(db, { actor: req.adminUser.username, action: 'update_webhook', targetType: 'webhook', targetId: id, clientIp: req.ip, requestId: req.id });
  reply.send({ code: 0, message: 'updated' });
}

async function deleteWebhook(req, reply) {
  const db = getDB();
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id FROM webhooks WHERE id=?').get(id);
  if (!row) throw new AppError(40401, 'webhook not found', { statusCode: 404 });

  const tokenCount = db.prepare('SELECT COUNT(*) AS c FROM tokens WHERE webhook_id=?').get(id);
  if (tokenCount.c > 0) {
    throw new AppError(40901, `cannot delete: ${tokenCount.c} token(s) still bound to this webhook`, { statusCode: 409 });
  }

  db.prepare('DELETE FROM webhooks WHERE id=?').run(id);
  audit(db, { actor: req.adminUser.username, action: 'delete_webhook', targetType: 'webhook', targetId: id, clientIp: req.ip, requestId: req.id });
  reply.send({ code: 0, message: 'deleted' });
}

/**
 * 从 webhook URL 中提取 key 参数
 * https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx → xxx
 */
function extractKey(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get('key') || '';
  } catch {
    return '';
  }
}

export default { registerWebhookRoutes };
