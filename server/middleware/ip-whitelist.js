import { AppError } from './error.js';

/**
 * IP 白名单校验（CIDR）
 *
 * @param {string} ip 客户端 IP
 * @param {string[]} cidrs CIDR 列表（IPv4 或 IPv6）
 * @returns {boolean} true=允许；空 cidrs 表示不限
 */
export function isIPAllowed(ip, cidrs) {
  if (!Array.isArray(cidrs) || cidrs.length === 0) return true;
  for (const cidr of cidrs) {
    if (ipInCIDR(ip, cidr)) return true;
  }
  return false;
}

export function checkIPWhitelist(ip, cidrJson) {
  let cidrs = [];
  if (cidrJson) {
    try {
      cidrs = JSON.parse(cidrJson);
    } catch {
      // 解析失败时视为不限
      return true;
    }
  }
  if (!isIPAllowed(ip, cidrs)) {
    throw new AppError(40302, `ip not allowed: ${ip}`, { statusCode: 403 });
  }
}

// CIDR 匹配（IPv4 + IPv6）
function ipInCIDR(ip, cidr) {
  if (ip.includes(':')) {
    return ipInCIDRv6(ip, cidr);
  }
  return ipInCIDRv4(ip, cidr);
}

function ipInCIDRv4(ip, cidr) {
  const slashIdx = cidr.indexOf('/');
  const cidrAddr = slashIdx >= 0 ? cidr.slice(0, slashIdx) : cidr;
  const prefix = slashIdx >= 0 ? parseInt(cidr.slice(slashIdx + 1), 10) : 32;

  const ipInt = ipv4ToInt(ip);
  const cidrInt = ipv4ToInt(cidrAddr);
  if (ipInt === null || cidrInt === null) return false;
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (cidrInt & mask);
}

function ipv4ToInt(str) {
  const parts = str.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (let i = 0; i < 4; i++) {
    const n = parseInt(parts[i], 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    result = (result * 256) + n;
  }
  return result >>> 0;
}

function ipInCIDRv6(ip, cidr) {
  // 简化版 IPv6 CIDR 匹配：仅支持完整 8 段或 :: 全零压缩；不做严格校验
  const slashIdx = cidr.indexOf('/');
  const cidrAddr = slashIdx >= 0 ? cidr.slice(0, slashIdx) : cidr;
  const prefix = slashIdx >= 0 ? parseInt(cidr.slice(slashIdx + 1), 10) : 128;

  const ipBuf = ipv6ToBuf(ip);
  const cidrBuf = ipv6ToBuf(cidrAddr);
  if (!ipBuf || !cidrBuf) return false;

  const fullBytes = Math.floor(prefix / 8);
  const leftoverBits = prefix % 8;
  if (fullBytes > 0) {
    for (let i = 0; i < fullBytes; i++) {
      if (ipBuf[i] !== cidrBuf[i]) return false;
    }
  }
  if (leftoverBits > 0 && fullBytes < 16) {
    const mask = (0xFF << (8 - leftoverBits)) & 0xFF;
    if ((ipBuf[fullBytes] & mask) !== (cidrBuf[fullBytes] & mask)) return false;
  }
  return true;
}

function ipv6ToBuf(str) {
  // 把 IPv6 字符串转换为 16 字节 Uint8Array
  // 简化实现：仅支持完整 8 段形式，:: 必须展开
  let addr = str;
  if (addr.includes('::')) {
    const idx = addr.indexOf('::');
    const head = addr.slice(0, idx).split(':').filter(s => s !== '');
    const tail = addr.slice(idx + 2).split(':').filter(s => s !== '');
    const missing = 8 - head.length - tail.length;
    addr = [...head, ...Array(missing).fill('0'), ...tail].join(':');
  }
  const parts = addr.split(':');
  if (parts.length !== 8) return null;
  const buf = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const n = parseInt(parts[i], 16);
    if (isNaN(n)) return null;
    buf[i * 2] = (n >> 8) & 0xFF;
    buf[i * 2 + 1] = n & 0xFF;
  }
  return buf;
}

export default { isIPAllowed, checkIPWhitelist };
