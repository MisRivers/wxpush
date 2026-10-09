import { flushLogs } from '../services/push.js';
import { logger } from '../utils/logger.js';

let timer = null;

/**
 * 日志批量 flush 定时器
 *
 * push.js 的 queueLog 已经有 200ms / 50 条的 flush 触发，
 * 但如果队列不满且不触发阈值，日志可能滞留在内存。
 * 此定时器作为兜底，每 5 秒强制 flush 一次。
 */
export function startLogFlusher() {
  if (timer) return;
  timer = setInterval(() => {
    try {
      flushLogs();
    } catch (e) {
      logger.error({ err: e.message }, 'log flusher tick failed');
    }
  }, 5000);
  logger.info('log-flusher started (every 5s)');
}

export function stopLogFlusher() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export default { startLogFlusher, stopLogFlusher };
