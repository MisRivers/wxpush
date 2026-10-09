/**
 * 字段校验工具
 * - 用户名：3-32 字符，字母数字下划线开头，允许 -_.
 * - 密码：≥ 8 字符，必须包含字母+数字（管理员密码）
 * - webhook URL：https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
 * - IP 白名单 CIDR：IPv4 + IPv6
 */

export function isValidUsername(name) {
  if (typeof name !== 'string' || name.length < 3 || name.length > 32) return false;
  return /^[A-Za-z][A-Za-z0-9._-]{2,31}$/.test(name);
}

export function isValidPassword(pwd) {
  if (typeof pwd !== 'string' || pwd.length < 8 || pwd.length > 128) return false;
  if (!/[A-Za-z]/.test(pwd)) return false;
  if (!/\d/.test(pwd)) return false;
  return true;
}

/**
 * 校验客户端 SHA-256 哈希后的密码（64 位十六进制字符串）
 */
export function isValidPasswordHash(hash) {
  return typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash);
}

const WEBHOOK_URL_RE = /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[A-Za-z0-9-]{36}$/;

export function isValidWebhookUrl(url) {
  return typeof url === 'string' && WEBHOOK_URL_RE.test(url);
}

const APP_NAME_RE = /^[\w\u4e00-\u9fff][\w\u4e00-\u9fff\-. ]{0,63}$/;

export function isValidAppName(name) {
  return typeof name === 'string' && name.length >= 1 && name.length <= 64 && APP_NAME_RE.test(name);
}

/**
 * 校验 corp_id：企业 ID，长度 1-64，字母数字 + 减号
 */
export function isValidCorpId(corpId) {
  return typeof corpId === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(corpId);
}

/**
 * 校验 agent_id：4-32 位数字
 */
export function isValidAgentId(agentId) {
  const n = Number(agentId);
  return Number.isInteger(n) && n > 0 && n < 1e10;
}

/**
 * 校验 corp_secret：长度 1-256，可见 ASCII
 */
export function isValidCorpSecret(s) {
  if (typeof s !== 'string' || s.length < 1 || s.length > 256) return false;
  return /^[\x20-\x7e]+$/.test(s);
}

/**
 * 校验 IPv4 CIDR
 */
function isValidIPv4CIDR(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/(\d{1,2}))?$/.exec(s);
  if (!m) return false;
  const parts = [m[1], m[2], m[3], m[4]].map(Number);
  if (parts.some(p => p > 255)) return false;
  const prefix = m[6] !== undefined ? Number(m[6]) : 32;
  return prefix >= 0 && prefix <= 32;
}

/**
 * 校验 IPv6 CIDR（简化版：要求冒号分隔 2-8 段）
 */
function isValidIPv6CIDR(s) {
  const slashIdx = s.indexOf('/');
  const addr = slashIdx >= 0 ? s.slice(0, slashIdx) : s;
  const prefix = slashIdx >= 0 ? Number(s.slice(slashIdx + 1)) : 128;
  if (prefix < 0 || prefix > 128) return false;
  // 必须包含至少两个冒号或为完整 8 段
  const parts = addr.split(':');
  if (parts.length < 2 || parts.length > 8) return false;
  // 每段 1-4 个十六进制字符
  return parts.every(p => /^[0-9a-fA-F]{0,4}$/.test(p));
}

export function isValidCIDR(s) {
  return typeof s === 'string' && (isValidIPv4CIDR(s) || isValidIPv6CIDR(s));
}

/**
 * 校验接收人值
 * - user：1-64 字符（userid 或 '@all'）
 * - department：正整数
 * - tag：正整数
 */
export function isValidRecipient(recvType, recvValue) {
  if (recvType === 'user') {
    return recvValue === '@all' || (typeof recvValue === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(recvValue));
  }
  if (recvType === 'department' || recvType === 'tag') {
    return /^\d{1,10}$/.test(recvValue) && Number(recvValue) > 0;
  }
  return false;
}

export default {
  isValidUsername,
  isValidPassword,
  isValidPasswordHash,
  isValidWebhookUrl,
  isValidAppName,
  isValidCorpId,
  isValidAgentId,
  isValidCorpSecret,
  isValidCIDR,
  isValidRecipient,
};
