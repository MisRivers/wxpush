import { request, Agent } from 'undici';
import config from '../config.js';
import { logger } from '../utils/logger.js';

// 全局 agent：5s 超时 + keepalive
const agent = new Agent({
  headersTimeout: config.HTTP_TIMEOUT_MS,
  bodyTimeout: config.HTTP_TIMEOUT_MS,
  connect: {
    timeout: config.HTTP_TIMEOUT_MS,
  },
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
});

/**
 * 带超时 + 退避重试的 HTTP POST/GET 封装
 *
 * 重试策略：
 * - 仅在网络层错误（DNS/超时/连接拒绝）时重试
 * - HTTP 业务错误（4xx/5xx）不重试，由调用方处理
 * - 最多 3 次重试，间隔 1s / 2s / 4s（指数退避 + jitter）
 * - 总上限约 7s+5s = 12s
 *
 * @param {string} url
 * @param {object} opts { method, headers, body, responseType='json'|'text'|'buffer' }
 * @returns {Promise<{statusCode, headers, body}>}
 */
export async function httpRequest(url, opts = {}) {
  const maxRetries = opts.retries ?? config.HTTP_MAX_RETRIES;
  let lastErr;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await request(url, {
        method: opts.method || 'GET',
        headers: opts.headers || {},
        body: opts.body,
        dispatcher: agent,
      });

      let body;
      if (opts.responseType === 'buffer') {
        body = await res.body.arrayBuffer();
      } else if (opts.responseType === 'text') {
        body = await res.body.text();
      } else {
        // 默认 json
        const text = await res.body.text();
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = text;
        }
      }

      return {
        statusCode: res.statusCode,
        headers: res.headers,
        body,
      };
    } catch (e) {
      lastErr = e;
      // 网络层错误才重试
      if (e.code === 'ECONNRESET' || e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT' || e.code === 'EAI_AGAIN' || e.name === 'HeadersTimeoutError' || e.name === 'BodyTimeoutError' || e.code === 'UND_ERR_SOCKET' || e.code === 'UND_ERR_CONNECT_TIMEOUT') {
        if (attempt < maxRetries) {
          const baseDelay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          const jitter = Math.random() * 300;
          const delay = baseDelay + jitter;
          logger.warn({ url, attempt: attempt + 1, code: e.code, delayMs: Math.round(delay) }, 'http retry after error');
          await sleep(delay);
          continue;
        }
      }
      // 非重试型错误，直接抛
      throw e;
    }
  }
  // 所有重试都失败
  throw lastErr;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default { httpRequest };
