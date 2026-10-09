import { getDB } from '../../db/index.js';
import { AppError } from '../../middleware/error.js';
import { adminAuthRequired } from '../../middleware/auth.js';
import { pushMessage } from '../../services/push.js';
import { audit } from './utils.js';

const auth = { preHandler: [adminAuthRequired] };

const VALID_MSG_TYPES = new Set(['text', 'markdown', 'textcard', 'image', 'news']);

/**
 * 调试发送：选择 token + 消息类型 + 内容，实时发送并返回完整请求/响应
 * - POST /api/admin/debug/send
 *
 * body: { token_id, msg_type, content: { text, desp, title, description, url, btntxt } }
 */
export function registerDebugRoutes(app) {
  app.post('/api/admin/debug/send', { ...auth }, debugSend);
}

async function debugSend(req, reply) {
  const db = getDB();
  const b = req.body || {};
  const tokenId = Number(b.token_id);
  const msgType = String(b.msg_type || 'text');
  const content = b.content || {};

  if (!tokenId) throw new AppError(40001, 'token_id required', { statusCode: 400 });
  if (!VALID_MSG_TYPES.has(msgType)) throw new AppError(40001, `invalid msg_type: ${msgType}`, { statusCode: 400 });

  // 加载 token 配置
  const tokenRow = db.prepare(`
    SELECT id, token, name, channel_type, app_id, webhook_id, allowed_msg_types
    FROM tokens WHERE id=?
  `).get(tokenId);
  if (!tokenRow) throw new AppError(40401, 'token not found', { statusCode: 404 });

  // 加载 recipients（仅 app 渠道）
  let recipients = [];
  if (tokenRow.channel_type === 'app') {
    recipients = db.prepare('SELECT recv_type, recv_value FROM token_recipients WHERE token_id=? ORDER BY id').all(tokenId)
      .map(r => ({ recvType: r.recv_type, recvValue: r.recv_value }));
  }

  // 构造完整请求体快照
  const requestBody = { msg_type: msgType, content, token_id: tokenId, token_name: tokenRow.name };

  const result = await pushMessage({
    token: {
      id: tokenRow.id,
      token: tokenRow.token,
      channel_type: tokenRow.channel_type,
      app_id: tokenRow.app_id,
      webhook_id: tokenRow.webhook_id,
      allowed_msg_types: tokenRow.allowed_msg_types,
      recipients,
    },
    msgType,
    content,
    clientIp: req.ip,
    requestId: req.id,
  });

  audit(db, {
    actor: req.adminUser.username,
    action: 'debug_send',
    targetType: 'token',
    targetId: tokenId,
    detail: { msg_type: msgType, success: result.success },
    clientIp: req.ip,
    requestId: req.id,
  });

  reply.send({
    code: result.success ? 0 : (result.errorCode || 50000),
    message: result.success ? 'ok' : (result.errorMessage || 'failed'),
    msgid: result.msgid || '',
    request: requestBody,
    success: result.success,
  });
}

export default { registerDebugRoutes };
