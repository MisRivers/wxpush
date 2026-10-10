import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getDB } from '../db/index.js';
import { decrypt as decryptField } from '../utils/crypto.js';
import { verifySignature, verifyMsgSignature, decrypt as wxDecrypt, sha1 } from '../utils/wx-crypto.js';
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

  // 2.1 诊断路由（不鉴权，仅返回配置状态，不泄露密钥）
  app.get('/api/wx/callback/:appId/diagnose', wxCallbackDiagnose);

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
 * 诊断路由（GET）：返回回调配置状态（不鉴权，仅返回配置是否存在，不泄露密钥）
 * 用法：curl https://your-domain.com/api/wx/callback/:appId/diagnose
 */
async function wxCallbackDiagnose(req, reply) {
  const appId = Number(req.params.appId);
  const cfg = getAppCallbackConfig(appId);
  if (!cfg) {
    reply.send({ appId, configured: false, error: 'app not found' });
    return;
  }
  if (!cfg.configured) {
    reply.send({ appId, configured: false, error: 'callback_token or callback_aes_key not set' });
    return;
  }
  reply.send({
    appId,
    configured: true,
    tokenLen: cfg.token?.length,
    tokenPreview: cfg.token?.slice(0, 4) + '****' + cfg.token?.slice(-4),
    aesKeyLen: cfg.aesKey?.length,
    aesKeyPreview: cfg.aesKey ? cfg.aesKey.slice(0, 4) + '****' + cfg.aesKey.slice(-4) : null,
    callbackUrl: `/api/wx/callback/${appId}`,
  });
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
  let { msg_signature, timestamp, nonce, echostr } = q;

  // 关键修复：企业微信的 echostr 是 base64 编码，可能包含 '+'。
  // URL querystring 中 '+' 会被解析为空格，导致签名验证和解密失败。
  // 这里将空格还原为 '+'（base64 中不会有合法空格，所以安全）。
  if (echostr) echostr = echostr.replace(/ /g, '+');

  logger.info({
    appId, ip: req.ip,
    msg_signature: msg_signature ? msg_signature.slice(0, 20) + '...' : '(missing)',
    timestamp, nonce,
    echostr: echostr ? echostr.slice(0, 20) + `...(len=${echostr.length})` : '(missing)',
  }, 'wx callback verify request received');

  if (!msg_signature || !timestamp || !nonce || !echostr) {
    logger.warn({ appId, q }, 'wx callback: missing parameters');
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

  logger.info({
    appId,
    tokenLen: cfg.token?.length,
    tokenPreview: cfg.token?.slice(0, 8) + '...',
    aesKeyLen: cfg.aesKey?.length,
    aesKeyPreview: cfg.aesKey ? cfg.aesKey.slice(0, 8) + '...' : '(null)',
  }, 'wx callback: callback config loaded');

  // 验证签名（三种模式：明文/兼容/安全，签名公式相同）
  const sigOk = verifySignature(cfg.token, timestamp, nonce, echostr, msg_signature);
  if (!sigOk) {
    // 诊断：计算期望签名与实际签名对比
    const expected = sha1(cfg.token, timestamp, nonce, echostr);
    logger.warn({
      appId, ip: req.ip,
      token: cfg.token,
      timestamp, nonce,
      echostr: echostr.slice(0, 32) + '...',
      expectedSig: expected.slice(0, 20) + '...',
      receivedSig: msg_signature.slice(0, 20) + '...',
      sigMatch: expected === msg_signature,
    }, 'wx callback signature verification FAILED');
    reply.code(403).send('signature verification failed');
    return;
  }

  // 尝试 AES 解密 echostr
  // 企业微信支持三种加密模式：
  //   - 明文模式：echostr 本身就是明文，直接返回
  //   - 兼容模式/安全模式：echostr 是 AES 加密的，需要解密后返回明文
  let responseBody;
  try {
    responseBody = wxDecrypt(echostr, cfg.aesKey);
    logger.info({ appId, mode: 'safe', plainLen: responseBody.length }, 'wx callback verify SUCCESS (safe mode)');
  } catch (e) {
    // 解密失败 → 可能是明文模式，直接返回原始 echostr
    logger.info({
      appId, ip: req.ip,
      reason: e.message,
      echostrLen: echostr.length,
    }, 'wx callback decrypt failed, falling back to plain mode (returning raw echostr)');
    responseBody = echostr;
  }

  reply.header('content-type', 'text/plain');
  reply.send(responseBody);
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

  // 解密消息（兼容明文/兼容/安全三种模式）
  try {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    // 安全模式：企业微信 POST 的 body 是 XML，提取 <Encrypt> 节点解密
    const encMatch = body.match(/<Encrypt><!\[CDATA\[(.+?)\]\]><\/Encrypt>/);
    if (encMatch) {
      // 有 <Encrypt> 标签 → 安全/兼容模式，需要解密
      const plain = wxDecrypt(encMatch[1], cfg.aesKey);
      logger.info({ appId, mode: 'safe', plain: plain.slice(0, 200) }, 'wx callback message received (safe mode)');
      // TODO: 按需处理消息内容
    } else {
      // 无 <Encrypt> 标签 → 明文模式，直接记录原始 XML
      logger.info({ appId, mode: 'plain', bodyPreview: body.slice(0, 200) }, 'wx callback message received (plain mode)');
      // TODO: 按需处理消息内容
    }
    reply.send('success');
  } catch (e) {
    logger.error({ err: e.message, appId }, 'wx callback message decrypt failed');
    reply.code(500).send('decrypt failed');
  }
}

export default { registerWxCallbackRoutes };
