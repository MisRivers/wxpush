import { dispatch } from './channels/index.js';
import { getDB } from '../db/index.js';
import { logger } from '../utils/logger.js';
import config from '../config.js';

// 批量日志队列（每 200ms 或满 50 条 flush）
let logQueue = [];
let flushTimer = null;

/**
 * 推送调度核心
 *
 * @param {object} args
 *   token: { id, token, channel_type, app_id, webhook_id, allowed_msg_types, recipients }
 *   msgType: text|markdown|textcard|image|news
 *   content: { text, desp, title, description, btntxt, url, ... }
 *   clientIp
 *   requestId
 * @returns {Promise<{success, msgid, errorCode?, errorMessage?}>}
 */
export async function pushMessage({ token, msgType, content, clientIp, requestId }) {
  const startTime = Date.now();
  let status = 'success';
  let errorCode = 0;
  let errorMessage = null;
  let upstreamResponse = {};

  try {
    const result = await dispatch({ token, msgType, content, recipients: token.recipients || [] });
    upstreamResponse = result.upstreamResponse || {};
    if (result.success) {
      return {
        success: true,
        msgid: result.msgid || '',
      };
    }
    status = 'failed';
    errorCode = result.errorCode || 0;
    errorMessage = result.errorMessage || 'unknown error';
    return {
      success: false,
      msgid: result.msgid || '',
      errorCode,
      errorMessage,
    };
  } catch (e) {
    status = 'error';
    errorCode = 50000;
    errorMessage = e.message;
    logger.error({ err: e.message, stack: e.stack, requestId, tokenId: token.id }, 'push failed');
    return {
      success: false,
      msgid: '',
      errorCode,
      errorMessage,
    };
  } finally {
    const durationMs = Date.now() - startTime;
    queueLog({
      tokenValue: token.token,
      tokenId: token.id,
      channelType: token.channel_type,
      channelId: token.app_id || token.webhook_id,
      msgType,
      requestBody: serializeRequest({ msgType, content }),
      responseBody: JSON.stringify(upstreamResponse),
      status,
      errorCode,
      errorMessage,
      clientIp,
      requestId,
      durationMs,
    });
  }
}

function serializeRequest({ msgType, content }) {
  try {
    return JSON.stringify({ msgType, content });
  } catch {
    return String(content);
  }
}

/**
 * 加入批量日志队列（不阻塞推送主流程）
 */
function queueLog(entry) {
  logQueue.push(entry);
  if (logQueue.length >= config.LOG_FLUSHER_BATCH_SIZE) {
    // 同步 flush（达到阈值）
    flushLogs();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushLogs();
    }, config.LOG_FLUSHER_INTERVAL_MS);
  }
}

/**
 * 批量 flush 日志到 DB
 */
export function flushLogs() {
  if (logQueue.length === 0) return;
  const batch = logQueue;
  logQueue = [];
  try {
    const db = getDB();
    const stmt = db.prepare(`
      INSERT INTO logs(token_value, token_id, channel_type, channel_id, msg_type,
                       request_body, response_body, status, error_code, error_message,
                       client_ip, request_id, duration_ms, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `);
    const tx = db.transaction((rows) => {
      for (const r of rows) {
        stmt.run(
          r.tokenValue, r.tokenId, r.channelType, r.channelId, r.msgType,
          r.requestBody, r.responseBody, r.status, r.errorCode, r.errorMessage,
          r.clientIp, r.requestId, r.durationMs
        );
      }
    });
    tx(batch);
    logger.debug({ count: batch.length }, 'logs flushed to db');
  } catch (e) {
    logger.error({ err: e.message, count: batch.length }, 'failed to flush logs to db');
    // 失败时丢弃，避免阻塞内存（生产环境可考虑落盘兜底）
  }
}

/**
 * 进程退出前 flush 残留日志
 */
export async function flushLogsOnShutdown() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushLogs();
}

export default { pushMessage, flushLogs, flushLogsOnShutdown };
