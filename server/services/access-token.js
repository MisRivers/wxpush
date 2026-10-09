import { getDB } from '../db/index.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { httpRequest } from './http-client.js';
import config from '../config.js';
import { logger } from '../utils/logger.js';

// inflight Promise 复用：Map<app_id, Promise<{token, expiresAt}>>
// 防止并发触发 N 次刷新请求被企业微信侧 45009 拒绝
const inflight = new Map();

/**
 * 获取某 app 的 access_token（缓存 + inflight 复用 + 失效重试）
 *
 * @param {object} app { id, corp_id, corp_secret_enc, secret_iv }
 * @param {object} opts { forceRefresh=false }
 * @returns {Promise<{token: string, expiresAt: number}>}
 */
export async function getAccessToken(app, opts = {}) {
  const appId = app.id;

  // inflight 复用：同一 app 并发请求只会触发一次上游刷新
  if (inflight.has(appId) && !opts.forceRefresh) {
    return inflight.get(appId);
  }

  const p = (async () => {
    // 1. 查缓存
    if (!opts.forceRefresh) {
      const cached = readFromCache(appId);
      if (cached && cached.expiresAt > Date.now() + 60_000) {
        // 提前 60 秒视为过期（避免边界情况下推送时刚过期）
        return cached;
      }
    }

    // 2. 拉取上游
    let attempt = 0;
    while (attempt < 2) {
      try {
        const fresh = await fetchFromWeCom(app);
        writeToCache(appId, fresh);
        return fresh;
      } catch (e) {
        attempt++;
        if (attempt >= 2) {
          // 记录刷新失败次数
          bumpFailCount(appId);
          throw e;
        }
        // 失败后等 1s 重试一次
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  })();

  inflight.set(appId, p);
  try {
    return await p;
  } finally {
    inflight.delete(appId);
  }
}

/**
 * 从缓存表读取 access_token（密文解密）
 */
function readFromCache(appId) {
  const db = getDB();
  const row = db.prepare('SELECT token_enc, secret_iv, expires_at FROM access_tokens WHERE app_id=?').get(appId);
  if (!row) return null;
  try {
    const token = decrypt(row.token_enc, row.secret_iv);
    return { token, expiresAt: row.expires_at * 1000 };
  } catch (e) {
    logger.error({ appId, err: e.message }, 'decrypt cached access_token failed, treating as expired');
    return null;
  }
}

/**
 * 从企业微信上游拉取 access_token
 * API: https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=xxx&corpsecret=yyy
 */
async function fetchFromWeCom(app) {
  // app.corp_secret_enc 是密文；但调用方应该已解密成明文传入
  // 这里假设 app.corpSecret 是已解密的明文
  const corpId = app.corp_id;
  const corpSecret = app.corpSecret; // 解密后由调用方注入
  if (!corpId || !corpSecret) {
    throw new Error('missing corp_id or corp_secret');
  }

  const url = `${config.WECOM_API_BASE}/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(corpSecret)}`;
  const res = await httpRequest(url, { method: 'GET' });

  const body = res.body;
  if (!body || typeof body.errcode !== 'undefined') {
    if (body.errcode === 0) {
      const token = body.access_token;
      const expiresIn = body.expires_in; // 通常 7200 秒
      const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
      logger.info({ appId: app.id, expiresIn, expiresAt }, 'access_token fetched');
      return { token, expiresAt };
    }
    // 42001 access_token expired / 40014 invalid
    const err = new Error(`wecom gettoken failed: ${body.errcode} ${body.errmsg}`);
    err.code = body.errcode;
    err.wecomErrmsg = body.errmsg;
    throw err;
  }
  throw new Error(`wecom gettoken unexpected response: ${JSON.stringify(body)}`);
}

/**
 * 写入缓存表（加密）
 */
function writeToCache(appId, { token, expiresAt }) {
  const db = getDB();
  const { ciphertext, iv } = encrypt(token);
  db.prepare(`
    INSERT INTO access_tokens(app_id, token_enc, secret_iv, expires_at, refresh_fail_count, updated_at)
    VALUES(?, ?, ?, ?, 0, unixepoch())
    ON CONFLICT(app_id) DO UPDATE SET
      token_enc=excluded.token_enc,
      secret_iv=excluded.secret_iv,
      expires_at=excluded.expires_at,
      refresh_fail_count=0,
      updated_at=excluded.updated_at
  `).run(appId, ciphertext, iv, expiresAt);
}

function bumpFailCount(appId) {
  const db = getDB();
  db.prepare('UPDATE access_tokens SET refresh_fail_count=refresh_fail_count+1, updated_at=unixepoch() WHERE app_id=?')
    .run(appId);
}

/**
 * 主动刷新（定时任务调用）
 */
export async function refreshAccessToken(app) {
  return getAccessToken(app, { forceRefresh: true });
}

/**
 * 加载所有 app 配置（包括解密后的 corp_secret）
 */
export async function loadAppForToken(appId) {
  const db = getDB();
  const row = db.prepare('SELECT id, name, corp_id, agent_id, corp_secret_enc, secret_iv, allow_at_all, at_all_daily_limit FROM apps WHERE id=?').get(appId);
  if (!row) return null;
  const corpSecret = decrypt(row.corp_secret_enc, row.secret_iv);
  return {
    id: row.id,
    name: row.name,
    corp_id: row.corp_id,
    agent_id: row.agent_id,
    corpSecret,
    allow_at_all: !!row.allow_at_all,
    at_all_daily_limit: row.at_all_daily_limit,
  };
}

export default { getAccessToken, refreshAccessToken, loadAppForToken };
