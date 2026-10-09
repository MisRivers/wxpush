import { createHmac, createHash } from 'node:crypto';
import { httpRequest } from '../http-client.js';
import { fetchImage, ImageFetchError } from '../image-fetcher.js';
import config from '../../config.js';
import { logger } from '../../utils/logger.js';

// 企业微信群机器人图片上限：2MB（base64 传输），支持 JPG/PNG
const WEBHOOK_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
// news 图文限制
const NEWS_TITLE_MAX_BYTES = 128;
const NEWS_DESC_MAX_BYTES = 512;
const NEWS_MAX_ARTICLES = 8;

/**
 * 企业微信群机器人渠道
 *
 * API: POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=KEY
 *
 * 支持的消息类型：text / markdown / image / news / file / template_card
 * 注意：群机器人不支持 textcard —— 自动转换为 news 图文卡片
 *
 * 三种安全模式：
 * - none:  仅传 key
 * - keyword: 必须在内容中包含该关键词
 * - sign: 计算 timestamp + key 的 HMAC-SHA256，作为 sign 参数附加在 URL 上
 *
 * @param {object} args
 * @param {object} webhook { webhookKeyPlain, security_mode, keyword, signSecretPlain }
 * @returns {Promise<{success, upstreamResponse, msgid}>}
 */
export async function sendWebhookMessage({ msgType, content, webhook }) {
  let url = `${config.WECOM_API_BASE}/webhook/send?key=${encodeURIComponent(webhook.webhookKeyPlain)}`;

  // 加签模式：附加 timestamp + sign
  if (webhook.security_mode === 'sign') {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sign = computeSign(webhook.signSecretPlain, timestamp, webhook.webhookKeyPlain);
    url += `&timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;
  }

  // 构造请求体（image 类型会自动下载图片转 base64，可能抛业务错误）
  let body;
  try {
    body = await buildWebhookBody({ msgType, content });
  } catch (e) {
    if (e instanceof ImageFetchError) {
      return {
        success: false,
        upstreamResponse: {},
        msgid: '',
        errorCode: 40010,
        errorMessage: `图片获取失败: ${e.message}`,
      };
    }
    if (e.code) {
      return {
        success: false,
        upstreamResponse: {},
        msgid: '',
        errorCode: e.code,
        errorMessage: e.message,
      };
    }
    throw e;
  }

  // 关键词模式：内容中必须包含 keyword（基于最终请求体检查）
  if (webhook.security_mode === 'keyword' && webhook.keyword) {
    const bodyText = JSON.stringify(body);
    if (!bodyText.includes(webhook.keyword)) {
      return {
        success: false,
        upstreamResponse: {},
        msgid: '',
        errorCode: 41001,
        errorMessage: `keyword not found in content; required: ${webhook.keyword}`,
      };
    }
  }

  const res = await httpRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const resp = res.body || {};
  logger.debug({ msgType, statusCode: res.statusCode, errcode: resp.errcode }, 'webhook sent');

  if (resp.errcode === 0) {
    return { success: true, upstreamResponse: resp, msgid: '' }; // 群机器人不返回 msgid
  }
  return {
    success: false,
    upstreamResponse: resp,
    msgid: '',
    errorCode: resp.errcode,
    errorMessage: resp.errmsg,
  };
}

/**
 * 计算加签：HMAC-SHA256(timestamp + "\n" + key) base64
 * 实际企业微信是 hmac-sha256(key + "\n" + timestamp)——这里需以官方文档为准
 * 官方文档：「签名校验」：sign = HMAC-SHA256(key, timestamp + "\n" + key)
 */
function computeSign(signSecret, timestamp, webhookKey) {
  const hmac = createHmac('sha256', signSecret);
  hmac.update(`${timestamp}\n${webhookKey}`);
  return hmac.digest('base64');
}

/**
 * 构造 webhook 请求体
 *
 * msgType: text | markdown | textcard | image | news
 * - textcard: 群机器人不支持，自动转换为 news 单图文
 * - image:    支持 url（自动下载）/ base64 / image_base64 字段，自动计算 md5
 * - news:     支持 articles 数组或扁平字段（title/description/url/picurl）
 */
export async function buildWebhookBody({ msgType, content }) {
  switch (msgType) {
    case 'text':
      return { msgtype: 'text', text: { content: content.text || content.desp || '' } };
    case 'markdown':
      return { msgtype: 'markdown', markdown: { content: content.desp || content.text || '' } };
    case 'textcard':
      // 群机器人 API 不支持 textcard（企业微信返回 40008），自动转换为 news
      return { msgtype: 'news', news: { articles: [buildArticle(content)] } };
    case 'image': {
      const { base64, md5 } = await resolveImageBase64(content);
      return { msgtype: 'image', image: { base64, md5 } };
    }
    case 'news':
      return { msgtype: 'news', news: { articles: normalizeArticles(content) } };
    default:
      throw new Error(`unsupported msgType: ${msgType}`);
  }
}

/**
 * 解析图片数据：优先 base64 字段，否则从 URL 下载
 * 兼容字段：base64 / image_base64 / url
 * 若 base64 字段值本身是 http(s) 链接，也按 URL 处理
 */
async function resolveImageBase64(content) {
  const b64 = content.base64 || content.image_base64 || '';
  const isUrl = (s) => /^https?:\/\//i.test(s || '');

  // 纯 base64 数据
  if (b64 && !isUrl(b64)) {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0) throw bizError(40001, 'image base64 数据非法');
    if (buf.length > WEBHOOK_IMAGE_MAX_BYTES) {
      throw bizError(40009, `图片超过群机器人 2MB 上限（当前 ${(buf.length / 1024 / 1024).toFixed(2)}MB），请压缩后重试`);
    }
    const md5 = createHash('md5').update(buf).digest('hex');
    return { base64: buf.toString('base64'), md5 };
  }

  // URL 下载
  const url = isUrl(content.url) ? content.url : (isUrl(b64) ? b64 : null);
  if (!url) {
    throw bizError(40001, '缺少图片数据：请提供 url 或 base64 字段');
  }
  const { buffer, md5 } = await fetchImage(url, { allowHttp: true, maxBytes: WEBHOOK_IMAGE_MAX_BYTES });
  return { base64: buffer.toString('base64'), md5 };
}

/**
 * 归一化 news articles：
 * - 有 content.articles 数组 → 校验后使用（最多 8 条）
 * - 否则从扁平字段构造单条 article
 */
function normalizeArticles(content) {
  let list = Array.isArray(content.articles) && content.articles.length > 0
    ? content.articles
    : [buildArticle(content)];

  if (list.length > NEWS_MAX_ARTICLES) {
    list = list.slice(0, NEWS_MAX_ARTICLES);
  }

  const normalized = list.map((a, i) => {
    const article = buildArticle(a);
    if (!article.title) throw bizError(40001, `news 第 ${i + 1} 条缺少 title`);
    if (!article.url) throw bizError(40001, `news 第 ${i + 1} 条缺少 url（图文卡片必须有点击跳转链接）`);
    return article;
  });

  return normalized;
}

/**
 * 从任意对象提取 news article 字段（忽略多余字段，避免 45008 尺寸超限）
 */
function buildArticle(obj = {}) {
  const article = {
    title: String(obj.title || obj.text || '').slice(0, NEWS_TITLE_MAX_BYTES),
    url: String(obj.url || ''),
    picurl: String(obj.picurl || obj.image || ''),
  };
  const desc = String(obj.description || obj.desp || '');
  if (desc) {
    article.description = desc.slice(0, NEWS_DESC_MAX_BYTES);
  }
  if (obj.btntxt) article.btntxt = String(obj.btntxt).slice(0, 20);

  // 字节级校验（中文按 UTF-8 3 字节计）
  if (Buffer.byteLength(article.title, 'utf8') > NEWS_TITLE_MAX_BYTES * 3) {
    throw bizError(45008, `news 标题过长（${Buffer.byteLength(article.title, 'utf8')} 字节，上限 128 字节 UTF-8）`);
  }
  return article;
}

/**
 * 业务错误（带 errorCode，由 sendWebhookMessage 转为结构化失败）
 */
function bizError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * 加载 webhook 配置（解密密钥）
 */
export async function loadWebhook(webhookId) {
  const { getDB } = await import('../../db/index.js');
  const { decrypt } = await import('../../utils/crypto.js');
  const db = getDB();
  const row = db.prepare(`
    SELECT id, name, webhook_key_enc, secret_iv, security_mode, keyword,
           sign_secret_enc, sign_secret_iv
    FROM webhooks WHERE id=?
  `).get(webhookId);
  if (!row) return null;
  const webhookKeyPlain = decrypt(row.webhook_key_enc, row.secret_iv);
  let signSecretPlain = null;
  if (row.sign_secret_enc) {
    signSecretPlain = decrypt(row.sign_secret_enc, row.sign_secret_iv);
  }
  return {
    id: row.id,
    name: row.name,
    webhookKeyPlain,
    security_mode: row.security_mode,
    keyword: row.keyword,
    signSecretPlain,
  };
}

export default { sendWebhookMessage, loadWebhook };
