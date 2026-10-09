import { httpRequest } from '../http-client.js';
import { fetchImage, ImageFetchError } from '../image-fetcher.js';
import config from '../../config.js';
import { logger } from '../../utils/logger.js';

// news 图文限制
const NEWS_TITLE_MAX_BYTES = 128;
const NEWS_DESC_MAX_BYTES = 512;
const NEWS_MAX_ARTICLES = 8;

/**
 * 企业微信应用消息渠道
 *
 * API: POST https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=ACCESS_TOKEN
 * Body:
 * {
 *   "touser": "ZhangSan|LiSi",
 *   "toparty": "1|2",
 *   "totag": "1|2",
 *   "msgtype": "text",
 *   "agentid": 1000002,
 *   "text": { "content": "hello" },
 *   "markdown": { "content": "# title\n**bold**" },
 *   "textcard": { "title":"...", "description":"...", "url":"...", "btntxt":"..." },
 *   "image": { "media_id": "..." },
 *   "news": { "articles": [{...}] }
 * }
 *
 * 返回：{ errcode: 0, errmsg: 'ok', msgid: 'xxx', invaliduser: '...' }
 *
 * @param {object} args
 * @param {object} app { agent_id }
 * @param {string} accessToken
 * @returns {Promise<{success: boolean, upstreamResponse: object, msgid?: string}>}
 */
export async function sendAppMessage({ recipients, msgType, content, agentId, accessToken }) {
  let body;
  try {
    body = await buildBody({ recipients, msgType, content, agentId, accessToken });
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

  const url = `${config.WECOM_API_BASE}/message/send?access_token=${encodeURIComponent(accessToken)}`;
  const res = await httpRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const resp = res.body || {};
  logger.debug({ msgType, agentId, statusCode: res.statusCode, errcode: resp.errcode }, 'app-message sent');

  // errcode=0 表示成功；其他为失败
  if (resp.errcode === 0) {
    return {
      success: true,
      upstreamResponse: resp,
      msgid: resp.msgid || '',
    };
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
 * 构造 message/send 请求体
 *
 * recipients: [{ recvType: 'user'|'department'|'tag', recvValue: 'xxx' }]
 * msgType: text | markdown | textcard | image | news
 * content: { text, desp, title, description, btntxt, url, mediaId, base64, image_base64, articles, picurl }
 */
export async function buildBody({ recipients, msgType, content, agentId, accessToken }) {
  const body = {
    agentid: agentId,
    msgtype: msgType,
  };

  // touser/toparty/totag 用 '|' 拼接
  const touser = recipients.filter(r => r.recvType === 'user').map(r => r.recvValue).join('|');
  const toparty = recipients.filter(r => r.recvType === 'department').map(r => r.recvValue).join('|');
  const totag = recipients.filter(r => r.recvType === 'tag').map(r => r.recvValue).join('|');

  if (touser) body.touser = touser;
  if (toparty) body.toparty = toparty;
  if (totag) body.totag = totag;

  // 消息体
  switch (msgType) {
    case 'text':
      body.text = { content: content.text || content.desp || '' };
      break;
    case 'markdown':
      body.markdown = { content: content.desp || content.text || '' };
      break;
    case 'textcard':
      body.textcard = {
        title: content.title,
        description: content.description || '',
        url: content.url || '',
        btntxt: content.btntxt || '详情',
      };
      break;
    case 'image': {
      // 应用消息 image 需要 media_id：
      // 1. 调用方直接提供 mediaId → 直接使用
      // 2. 提供 url / base64 → 下载后上传临时素材接口换取 media_id
      const mediaId = await resolveImageMediaId(content, accessToken);
      body.image = { media_id: mediaId };
      break;
    }
    case 'news':
      body.news = { articles: normalizeArticles(content) };
      break;
    default:
      throw new Error(`unsupported msgType: ${msgType}`);
  }

  return body;
}

/**
 * 解析图片 media_id：
 * - content.mediaId 存在 → 直接返回
 * - content.base64 / image_base64（非 URL）→ 解码后上传
 * - content.url（或 base64 字段值为 URL）→ 下载后上传
 */
async function resolveImageMediaId(content, accessToken) {
  if (content.mediaId) return content.mediaId;

  const b64 = content.base64 || content.image_base64 || '';
  const isUrl = (s) => /^https?:\/\//i.test(s || '');
  let buffer;
  let contentType = 'image/jpeg';

  if (b64 && !isUrl(b64)) {
    buffer = Buffer.from(b64, 'base64');
    if (buffer.length === 0) throw bizError(40001, 'image base64 数据非法');
  } else {
    const url = isUrl(content.url) ? content.url : (isUrl(b64) ? b64 : null);
    if (!url) {
      throw bizError(40001, '缺少图片数据：请提供 mediaId、url 或 base64 字段');
    }
    const r = await fetchImage(url, { allowHttp: true });
    buffer = r.buffer;
    contentType = r.contentType;
  }

  return uploadImageMedia({ buffer, contentType, accessToken });
}

/**
 * 上传临时素材（图片）换取 media_id
 * API: POST /cgi-bin/media/upload?access_token=TOKEN&type=image
 * 返回: { errcode: 0, type: 'image', media_id: 'xxx', created_at: '...' }
 */
async function uploadImageMedia({ buffer, contentType, accessToken }) {
  const url = `${config.WECOM_API_BASE}/media/upload?access_token=${encodeURIComponent(accessToken)}&type=image`;
  const ext = contentType.includes('png') ? 'png' : 'jpg';

  // Node 18+ 全局 FormData / Blob
  const form = new FormData();
  form.append('media', new Blob([buffer], { type: contentType }), `image.${ext}`);

  let resp;
  try {
    const res = await fetch(url, { method: 'POST', body: form });
    resp = await res.json();
  } catch (e) {
    throw bizError(50001, `图片上传临时素材失败: ${e.message}`);
  }

  if (resp.errcode && resp.errcode !== 0) {
    throw bizError(resp.errcode, `图片上传临时素材失败: ${resp.errmsg}`);
  }
  if (!resp.media_id) {
    throw bizError(50001, '图片上传临时素材失败: 未返回 media_id');
  }

  logger.info({ mediaId: resp.media_id, size: buffer.length }, 'image media uploaded');
  return resp.media_id;
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
 * 从任意对象提取 news article 字段（忽略多余字段）
 * 应用消息 article: { title, description, url, picurl, btntxt }
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
  return article;
}

/**
 * 业务错误（带 errorCode，由 sendAppMessage 转为结构化失败）
 */
function bizError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

export default { sendAppMessage };
