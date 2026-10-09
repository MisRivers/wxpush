import { sendAppMessage } from './app-message.js';
import { sendWebhookMessage, loadWebhook } from './webhook.js';
import { getAccessToken, loadAppForToken } from '../access-token.js';
import { logger } from '../../utils/logger.js';

/**
 * 渠道分发器：根据 token.channel_type 分发到 app 或 webhook 渠道
 *
 * @param {object} args
 *   token: { id, channel_type, app_id, webhook_id, allowed_msg_types, ... }
 *   msgType: text|markdown|textcard|image|news
 *   content: { text, desp, title, description, btntxt, url, base64, md5, articles, mediaId }
 *   recipients: [{ recvType, recvValue }]（仅 app 渠道使用）
 * @returns {Promise<{success, upstreamResponse, msgid, errorCode?, errorMessage?}>}
 */
export async function dispatch({ token, msgType, content, recipients }) {
  // 校验消息类型在允许集合内
  if (!isMsgTypeAllowed(msgType, token.allowed_msg_types)) {
    return {
      success: false,
      upstreamResponse: {},
      msgid: '',
      errorCode: 40302,
      errorMessage: `msg type not allowed: ${msgType}`,
    };
  }

  if (token.channel_type === 'app') {
    return dispatchApp({ token, msgType, content, recipients });
  }
  if (token.channel_type === 'webhook') {
    return dispatchWebhook({ token, msgType, content });
  }
  throw new Error(`unknown channel_type: ${token.channel_type}`);
}

async function dispatchApp({ token, msgType, content, recipients }) {
  const app = await loadAppForToken(token.app_id);
  if (!app) {
    return { success: false, upstreamResponse: {}, msgid: '', errorCode: 40401, errorMessage: 'app not found' };
  }

  // 前置校验：app 渠道必须有接收人，否则企业微信会报 82001
  if (!recipients || recipients.length === 0) {
    return {
      success: false,
      upstreamResponse: {},
      msgid: '',
      errorCode: 40003,
      errorMessage: 'token 未绑定接收人（touser/toparty/totag），请在管理后台编辑 Token 添加接收人',
    };
  }

  // 获取 access_token
  let accessToken;
  try {
    const r = await getAccessToken(app);
    accessToken = r.token;
  } catch (e) {
    logger.error({ appId: app.id, err: e.message }, 'failed to get access_token');
    return {
      success: false,
      upstreamResponse: {},
      msgid: '',
      errorCode: 50001,
      errorMessage: `access_token fetch failed: ${e.message}`,
    };
  }

  // 调用 message/send
  const result = await sendAppMessage({
    recipients,
    msgType,
    content,
    agentId: app.agent_id,
    accessToken,
  });

  // access_token 失效（42001 / 40014）→ 重试一次
  if (!result.success && (result.errorCode === 42001 || result.errorCode === 40014)) {
    logger.warn({ appId: app.id, errcode: result.errorCode }, 'access_token expired, refreshing and retrying');
    try {
      const fresh = await getAccessToken(app, { forceRefresh: true });
      accessToken = fresh.token;
    } catch (e) {
      logger.error({ appId: app.id, err: e.message }, 'refresh access_token failed on retry');
    }
    const retryResult = await sendAppMessage({
      recipients,
      msgType,
      content,
      agentId: app.agent_id,
      accessToken,
    });
    return retryResult;
  }

  return result;
}

async function dispatchWebhook({ token, msgType, content }) {
  const webhook = await loadWebhook(token.webhook_id);
  if (!webhook) {
    return { success: false, upstreamResponse: {}, msgid: '', errorCode: 40401, errorMessage: 'webhook not found' };
  }
  return sendWebhookMessage({ msgType, content, webhook });
}

function isMsgTypeAllowed(msgType, allowedJson) {
  try {
    const arr = typeof allowedJson === 'string' ? JSON.parse(allowedJson) : allowedJson;
    return Array.isArray(arr) && arr.includes(msgType);
  } catch {
    return false;
  }
}

export default { dispatch };
