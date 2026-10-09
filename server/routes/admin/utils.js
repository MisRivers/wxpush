import { getDB } from '../../db/index.js';
import { logger } from '../../utils/logger.js';

/**
 * 审计日志写入
 */
export function audit(db, { actor, action, targetType, targetId, detail, clientIp, requestId }) {
  try {
    const target = targetType ? JSON.stringify({ type: targetType, id: targetId }) : null;
    db.prepare('INSERT INTO audit_logs(actor, action, target, detail, client_ip, request_id) VALUES(?, ?, ?, ?, ?, ?)')
      .run(actor, action, target, detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null, clientIp || null, requestId || null);
  } catch (e) {
    logger.warn({ err: e.message, action }, 'audit log write failed');
  }
}

export default { audit };
