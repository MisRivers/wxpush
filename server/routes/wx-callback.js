import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getDB } from '../db/index.js';
import { decrypt as decryptField } from '../utils/crypto.js';
import { verifySignature, verifyMsgSignature, decrypt as wxDecrypt } from '../utils/wx-crypto.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

const STATIC_DIR = resolve(config.STATIC_DIR);

/**
 * 企业微信验证路由：
 * 1. 可信域名验证文件 — GET /WW_verify_xxx.txt（备份路由，主路径由 Nginx 静态文件服务）
 * 2. 接收消息服务器回调 — GET/POST /api/wx/callback/:appId
 */
export function registerWxCallbackRoutes(app) {
  // 1. 可信域名验证文件（备份路由，Nginx 未配置静态服务时可走此路由）
  app.get('/WW_verify_:filename', serveVerifyFile);

  // 2. 接收消息服务器 — URL 验证（GET）
  app.get('/api/wx/callback/:appId', wxCallbackVerify);

  // 3. 接收消息服务器 — 接收消息（POST）
  app.post('/api/wx/callback/:appId', wxCallbackReceive);
}

/**
 * 将数据库中所有 WW_verify_*.txt 验证文件同步写入静态目录
 * Nginx 的 try_files 会自动找到并返回这些文件，无需额外 Nginx 配置
 * 调用时机：服务启动 + 应用创建/更新后
 */
export function syncVerifyFiles() {
  try {
    if (!existsSync(STATIC_DIR)) {
      mkdirSync(STATIC_DIR, { recursive: true });
    }

    const db = getDB();
    const rows = db.prepare(`
      SELECT verify_file_name, verify_file_content
      FROM apps WHERE verify_file_name IS NOT NULL AND verify_file_content IS NOT NULL
    `).all();

    // 先清理旧的 WW_verify_*.txt 文件
    const oldFiles = readdirSync(STATIC_DIR).filter(f => f.startsWith('WW_verify_') && f.endsWith('.txt'));
    const validNames = new Set(rows.map(r => r.verify_file_name));
    for (const f of oldFiles) {
      if (!validNames.has(f)) {
        unlinkSync(join(STATIC_DIR, f));
      }
    }

    // 写入当前所有验证文件
    let count = 0;
    for (const row of rows) {
      const filePath = join(STATIC_DIR, row.verify_file_name);
      writeFileSync(filePath, row.verify_file_content, 'utf8');
      count++;
    }

    if (count > 0) {
      logger.info({ count, dir: STATIC_DIR }, 'verify files synced to static dir');
    }
  } catch (e) {
    logger.warn({ err: e.message, dir: STATIC_DIR }, 'failed to sync verify files (non-fatal)');
  }
}

/**
 * 提供可信域名验证文件（备份路由）
 * URL: https://your-domain.com/WW_verify_xxxx.txt
 * 主路径：Nginx 直接从静态目录服务，此路由仅在未配置 Nginx 静态服务时使用
 */
async function serveVerifyFile(req, reply) {
  const filename = `WW_verify_${req.params.filename}`;
  const db = getDB();
  const row = db.prepare('SELECT verify_file_content FROM apps WHERE verify_file_name=?').get(filename);
  if (!row || !row.verify_file_content) {
    reply.code(404).send('Not Found');
    return;
  }
  reply.header('content-type', 'text/plain; charset=utf-8');
  reply.send(row.verify_file_content);
}

/**
 * 查询应用的回调配置
 */
function getAppCallbackConfig(appId) {
  const db = getDB();
  const row = db.prepare(`
    SELECT id, callback_token, callback_aes_key_enc, callback_aes_key_iv
    FROM apps WHERE id=?
  `).get(appId);
  if (!row) return null;
  if (!row.callback_token || !row.callback_aes_key_enc) return { configured: false };
  const aesKey = decryptField(row.callback_aes_key_enc, row.callback_aes_key_iv);
  return { configured: true, token: row.callback_token, aesKey };
}

/**
 * URL 验证（GET）：企业微信发送 msg_signature + timestamp + nonce + echostr
 * 验证签名后解密 echostr，返回明文
 */
async function wxCallbackVerify(req, reply) {
  const appId = Number(req.params.appId);
  const q = req.query || {};
  const { msg_signature, timestamp, nonce, echostr } = q;

  if (!msg_signature || !timestamp || !nonce || !echostr) {
    reply.code(400).send('missing parameters');
    return;
  }

  const cfg = getAppCallbackConfig(appId);
  if (!cfg) {
    logger.warn({ appId, ip: req.ip }, 'wx callback: app not found');
    reply.code(404).send('app not found');
    return;
  }
  if (!cfg.configured) {
    logger.warn({ appId, ip: req.ip }, 'wx callback: callback not configured (token or aes_key missing)');
    reply.code(400).send('callback not configured for this app');
    return;
  }

  // 验证签名
  const sigOk = verifySignature(cfg.token, timestamp, nonce, echostr, msg_signature);
  if (!sigOk) {
    logger.warn({ appId, ip: req.ip, token: cfg.token.slice(0, 8) + '...', msg_signature, timestamp, nonce, echostr: echostr.slice(0, 16) + '...' }, 'wx callback signature verification failed');
    reply.code(403).send('signature verification failed');
    return;
  }

  // 解密 echostr
  try {
    const plain = wxDecrypt(echostr, cfg.aesKey);
    logger.info({ appId, plain: plain.slice(0, 20) }, 'wx callback verify success');
    reply.header('content-type', 'text/plain');
    reply.send(plain);
  } catch (e) {
    logger.error({ err: e.message, appId, aesKeyLen: cfg.aesKey?.length }, 'wx callback echostr decrypt failed');
    reply.code(500).send('decrypt failed');
  }
}

/**
 * 接收消息（POST）：企业微信推送加密消息
 */
async function wxCallbackReceive(req, reply) {
  const appId = Number(req.params.appId);
  const q = req.query || {};
  const { msg_signature, timestamp, nonce } = q;

  if (!msg_signature || !timestamp || !nonce) {
    reply.code(400).send('missing parameters');
    return;
  }

  const cfg = getAppCallbackConfig(appId);
  if (!cfg) {
    reply.code(404).send('app not found');
    return;
  }
  if (!cfg.configured) {
    reply.code(400).send('callback not configured');
    return;
  }

  // 验证签名
  if (!verifyMsgSignature(cfg.token, timestamp, nonce, msg_signature)) {
    logger.warn({ appId, ip: req.ip }, 'wx callback message signature verification failed');
    reply.code(403).send('signature verification failed');
    return;
  }

  // 解密消息
  try {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    // 企业微信 POST 的 body 是 XML，提取 <Encrypt> 节点
    const encMatch = body.match(/<Encrypt><!\[CDATA\[(.+?)\]\]><\/Encrypt>/);
    if (!encMatch) {
      reply.send('success');
      return;
    }
    const plain = wxDecrypt(encMatch[1], cfg.aesKey);
    logger.info({ appId, plain: plain.slice(0, 200) }, 'wx callback message received');
    // TODO: 按需处理消息内容
    reply.send('success');
  } catch (e) {
    logger.error({ err: e.message, appId }, 'wx callback message decrypt failed');
    reply.code(500).send('decrypt failed');
  }
}

export default { registerWxCallbackRoutes };
