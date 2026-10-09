import { getDB } from '../../db/index.js';
import { AppError } from '../../middleware/error.js';
import { generateToken } from '../../utils/token-gen.js';
import { isValidAppName, isValidCIDR, isValidRecipient } from '../../utils/validator.js';
import { adminAuthRequired } from '../../middleware/auth.js';
import { audit } from './utils.js';

const auth = { preHandler: [adminAuthRequired] };

const VALID_MSG_TYPES = new Set(['text', 'markdown', 'textcard', 'image', 'news']);

/**
 * Token CRUD + recipients 子资源
 *
 * 创建采用两步流，但在 API 层合并为单个 POST（前端分两步填表）：
 *  body.channel_type + channel_id + recipients[] + 限流/白名单/过期/消息类型
 */
export function registerTokenRoutes(app) {
  app.get('/api/admin/tokens', { ...auth }, listTokens);
  app.post('/api/admin/tokens', { ...auth }, createToken);
  app.get('/api/admin/tokens/:id', { ...auth }, getToken);
  app.put('/api/admin/tokens/:id', { ...auth }, updateToken);
  app.delete('/api/admin/tokens/:id', { ...auth }, deleteToken);

  // recipients 子资源
  app.get('/api/admin/tokens/:id/recipients', { ...auth }, listRecipients);
  app.post('/api/admin/tokens/:id/recipients', { ...auth }, addRecipient);
  app.delete('/api/admin/tokens/:id/recipients/:recipientId', { ...auth }, deleteRecipient);

  // 重新生成 token 值（保留 id 和配置）
  app.post('/api/admin/tokens/:id/regenerate', { ...auth }, regenerateToken);
}

async function listTokens(req, reply) {
  const db = getDB();
  const rows = db.prepare(`
    SELECT t.id, t.token, t.name, t.channel_type, t.app_id, t.webhook_id,
           t.allowed_msg_types, t.rate_limit_per_min, t.ip_whitelist,
           t.expires_at, t.enabled, t.note, t.created_at, t.updated_at,
           CASE WHEN t.channel_type='app' THEN a.name ELSE w.name END AS channel_name
    FROM tokens t
    LEFT JOIN apps a ON t.app_id=a.id
    LEFT JOIN webhooks w ON t.webhook_id=w.id
    ORDER BY t.id DESC
  `).all();
  // 附带 recipients 计数
  const data = rows.map(r => ({
    ...r,
    allowed_msg_types: safeParse(r.allowed_msg_types, []),
    ip_whitelist: safeParse(r.ip_whitelist, null),
    recipient_count: r.channel_type === 'app'
      ? (db.prepare('SELECT COUNT(*) AS c FROM token_recipients WHERE token_id=?').get(r.id)?.c || 0)
      : 0,
  }));
  reply.send({ code: 0, data });
}

async function createToken(req, reply) {
  const db = getDB();
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const channelType = String(b.channel_type || '');
  const appId = b.app_id ? Number(b.app_id) : null;
  const webhookId = b.webhook_id ? Number(b.webhook_id) : null;
  const allowedMsgTypes = Array.isArray(b.allowed_msg_types) ? b.allowed_msg_types : ['text', 'markdown', 'textcard', 'image', 'news'];
  const rateLimitPerMin = Number(b.rate_limit_per_min ?? 60);
  const ipWhitelist = Array.isArray(b.ip_whitelist) ? b.ip_whitelist : null;
  const expiresAt = b.expires_at ? Number(b.expires_at) : null;
  const enabled = b.enabled === undefined ? 1 : (b.enabled ? 1 : 0);
  const note = b.note ? String(b.note) : null;
  const recipients = Array.isArray(b.recipients) ? b.recipients : [];

  if (!isValidAppName(name)) throw new AppError(40001, 'name 格式不合法', { statusCode: 400 });
  if (channelType !== 'app' && channelType !== 'webhook') throw new AppError(40001, 'channel_type 必须 app 或 webhook', { statusCode: 400 });
  if (channelType === 'app' && !appId) throw new AppError(40001, 'app 渠道必须提供 app_id', { statusCode: 400 });
  if (channelType === 'webhook' && !webhookId) throw new AppError(40001, 'webhook 渠道必须提供 webhook_id', { statusCode: 400 });

  // 校验渠道存在
  if (channelType === 'app') {
    const app = db.prepare('SELECT id FROM apps WHERE id=?').get(appId);
    if (!app) throw new AppError(40401, 'app not found', { statusCode: 404 });
  } else {
    const wh = db.prepare('SELECT id FROM webhooks WHERE id=?').get(webhookId);
    if (!wh) throw new AppError(40401, 'webhook not found', { statusCode: 404 });
  }

  // 校验消息类型
  if (!allowedMsgTypes.every(t => VALID_MSG_TYPES.has(t))) {
    throw new AppError(40001, `allowed_msg_types 包含非法值，合法值: ${[...VALID_MSG_TYPES].join('/')}`, { statusCode: 400 });
  }
  if (rateLimitPerMin < 0 || rateLimitPerMin > 10000) throw new AppError(40001, 'rate_limit_per_min 范围 0-10000', { statusCode: 400 });

  // 校验 IP 白名单
  if (ipWhitelist) {
    if (!ipWhitelist.every(cidr => isValidCIDR(cidr))) {
      throw new AppError(40001, 'ip_whitelist 包含非法 CIDR', { statusCode: 400 });
    }
  }

  // 校验 recipients
  if (channelType === 'app') {
    for (const r of recipients) {
      if (!isValidRecipient(r.recv_type, r.recv_value)) {
        throw new AppError(40001, `recipient 不合法: ${JSON.stringify(r)}`, { statusCode: 400 });
      }
    }
  }

  const tokenValue = generateToken();
  const ipWhitelistJson = ipWhitelist ? JSON.stringify(ipWhitelist) : null;

  const result = db.prepare(`
    INSERT INTO tokens(token, name, channel_type, app_id, webhook_id,
                       allowed_msg_types, rate_limit_per_min, ip_whitelist,
                       expires_at, enabled, note)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tokenValue, name, channelType, channelType === 'app' ? appId : null, channelType === 'webhook' ? webhookId : null,
    JSON.stringify(allowedMsgTypes), rateLimitPerMin, ipWhitelistJson, expiresAt, enabled, note
  );

  const tokenId = result.lastInsertRowid;

  // 插入 recipients（仅 app 渠道）
  if (channelType === 'app' && recipients.length > 0) {
    const stmt = db.prepare('INSERT OR IGNORE INTO token_recipients(token_id, recv_type, recv_value) VALUES(?, ?, ?)');
    const tx = db.transaction((rs) => {
      for (const r of rs) stmt.run(tokenId, r.recv_type, r.recv_value);
    });
    tx(recipients);
  }

  audit(db, { actor: req.adminUser.username, action: 'create_token', targetType: 'token', targetId: tokenId, clientIp: req.ip, requestId: req.id });
  reply.code(201).send({ code: 0, id: tokenId, token: tokenValue });
}

async function getToken(req, reply) {
  const db = getDB();
  const id = Number(req.params.id);
  const row = db.prepare(`
    SELECT t.id, t.token, t.name, t.channel_type, t.app_id, t.webhook_id,
           t.allowed_msg_types, t.rate_limit_per_min, t.ip_whitelist,
           t.expires_at, t.enabled, t.note, t.created_at, t.updated_at,
           CASE WHEN t.channel_type='app' THEN a.name ELSE w.name END AS channel_name
    FROM tokens t
    LEFT JOIN apps a ON t.app_id=a.id
    LEFT JOIN webhooks w ON t.webhook_id=w.id
    WHERE t.id=?
  `).get(id);
  if (!row) throw new AppError(40401, 'token not found', { statusCode: 404 });

  const recipients = db.prepare('SELECT id, recv_type, recv_value, created_at FROM token_recipients WHERE token_id=? ORDER BY id').all(id);
  reply.send({
    code: 0,
    data: {
      ...row,
      allowed_msg_types: safeParse(row.allowed_msg_types, []),
      ip_whitelist: safeParse(row.ip_whitelist, null),
      recipients,
    },
  });
}

async function updateToken(req, reply) {
  const db = getDB();
  const id = Number(req.params.id);
  const b = req.body || {};
  const row = db.prepare('SELECT id, channel_type FROM tokens WHERE id=?').get(id);
  if (!row) throw new AppError(40401, 'token not found', { statusCode: 404 });

  const updates = [];
  const vals = [];
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!isValidAppName(name)) throw new AppError(40001, 'name 格式不合法', { statusCode: 400 });
    updates.push('name=?'); vals.push(name);
  }
  if (b.allowed_msg_types !== undefined) {
    if (!Array.isArray(b.allowed_msg_types) || !b.allowed_msg_types.every(t => VALID_MSG_TYPES.has(t))) {
      throw new AppError(40001, 'allowed_msg_types 不合法', { statusCode: 400 });
    }
    updates.push('allowed_msg_types=?'); vals.push(JSON.stringify(b.allowed_msg_types));
  }
  if (b.rate_limit_per_min !== undefined) {
    const n = Number(b.rate_limit_per_min);
    if (n < 0 || n > 10000) throw new AppError(40001, 'rate_limit_per_min 范围 0-10000', { statusCode: 400 });
    updates.push('rate_limit_per_min=?'); vals.push(n);
  }
  if (b.ip_whitelist !== undefined) {
    const ipWhitelist = Array.isArray(b.ip_whitelist) ? b.ip_whitelist : null;
    if (ipWhitelist && !ipWhitelist.every(cidr => isValidCIDR(cidr))) {
      throw new AppError(40001, 'ip_whitelist 包含非法 CIDR', { statusCode: 400 });
    }
    updates.push('ip_whitelist=?'); vals.push(ipWhitelist ? JSON.stringify(ipWhitelist) : null);
  }
  if (b.expires_at !== undefined) {
    updates.push('expires_at=?'); vals.push(b.expires_at ? Number(b.expires_at) : null);
  }
  if (b.enabled !== undefined) { updates.push('enabled=?'); vals.push(b.enabled ? 1 : 0); }
  if (b.note !== undefined) { updates.push('note=?'); vals.push(b.note ? String(b.note) : null); }

  if (updates.length === 0) throw new AppError(40001, 'no fields to update', { statusCode: 400 });
  updates.push('updated_at=unixepoch()');
  vals.push(id);
  db.prepare(`UPDATE tokens SET ${updates.join(', ')} WHERE id=?`).run(...vals);

  audit(db, { actor: req.adminUser.username, action: 'update_token', targetType: 'token', targetId: id, clientIp: req.ip, requestId: req.id });
  reply.send({ code: 0, message: 'updated' });
}

async function deleteToken(req, reply) {
  const db = getDB();
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id FROM tokens WHERE id=?').get(id);
  if (!row) throw new AppError(40401, 'token not found', { statusCode: 404 });

  // recipients 通过 ON DELETE CASCADE 自动删除
  db.prepare('DELETE FROM tokens WHERE id=?').run(id);
  audit(db, { actor: req.adminUser.username, action: 'delete_token', targetType: 'token', targetId: id, clientIp: req.ip, requestId: req.id });
  reply.send({ code: 0, message: 'deleted' });
}

async function listRecipients(req, reply) {
  const db = getDB();
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id FROM tokens WHERE id=?').get(id);
  if (!row) throw new AppError(40401, 'token not found', { statusCode: 404 });
  const recipients = db.prepare('SELECT id, recv_type, recv_value, created_at FROM token_recipients WHERE token_id=? ORDER BY id').all(id);
  reply.send({ code: 0, data: recipients });
}

async function addRecipient(req, reply) {
  const db = getDB();
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id, channel_type FROM tokens WHERE id=?').get(id);
  if (!row) throw new AppError(40401, 'token not found', { statusCode: 404 });
  if (row.channel_type !== 'app') throw new AppError(40001, 'only app channel supports recipients', { statusCode: 400 });

  const b = req.body || {};
  const recvType = String(b.recv_type || '');
  const recvValue = String(b.recv_value || '');
  if (!isValidRecipient(recvType, recvValue)) {
    throw new AppError(40001, 'recipient 不合法', { statusCode: 400 });
  }

  const result = db.prepare('INSERT OR IGNORE INTO token_recipients(token_id, recv_type, recv_value) VALUES(?, ?, ?)').run(id, recvType, recvValue);
  if (result.changes === 0) throw new AppError(40901, 'recipient already exists', { statusCode: 409 });

  audit(db, { actor: req.adminUser.username, action: 'add_recipient', targetType: 'token', targetId: id, detail: { recv_type: recvType, recv_value: recvValue }, clientIp: req.ip, requestId: req.id });
  reply.code(201).send({ code: 0, id: result.lastInsertRowid });
}

async function deleteRecipient(req, reply) {
  const db = getDB();
  const tokenId = Number(req.params.id);
  const recipientId = Number(req.params.recipientId);
  const result = db.prepare('DELETE FROM token_recipients WHERE id=? AND token_id=?').run(recipientId, tokenId);
  if (result.changes === 0) throw new AppError(40401, 'recipient not found', { statusCode: 404 });
  audit(db, { actor: req.adminUser.username, action: 'delete_recipient', targetType: 'token', targetId: tokenId, detail: { recipient_id: recipientId }, clientIp: req.ip, requestId: req.id });
  reply.send({ code: 0, message: 'deleted' });
}

async function regenerateToken(req, reply) {
  const db = getDB();
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id FROM tokens WHERE id=?').get(id);
  if (!row) throw new AppError(40401, 'token not found', { statusCode: 404 });

  const newToken = generateToken();
  db.prepare('UPDATE tokens SET token=?, updated_at=unixepoch() WHERE id=?').run(newToken, id);
  audit(db, { actor: req.adminUser.username, action: 'regenerate_token', targetType: 'token', targetId: id, clientIp: req.ip, requestId: req.id });
  reply.send({ code: 0, token: newToken });
}

function safeParse(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

export default { registerTokenRoutes };
