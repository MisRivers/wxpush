import { request } from 'undici';
import { lookup } from 'node:dns/promises';
import { networkInterfaces } from 'node:os';
import config from '../config.js';
import { logger } from '../utils/logger.js';

// 私网 IPv4 段（RFC 1918 / loopback / link-local / multicast）
const PRIVATE_IPV4 = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^0\./,
  /^224\./, // multicast
  /^240\./, // reserved
  // IPv6 私网
  /^::1$/,
  /^fc00:/i, // unique local
  /^fe80:/i, // link-local
  /^fd/i,
  /^ff/i, // multicast
  // IPv4-mapped IPv6 ::ffff:127.0.0.1 等
  /^::ffff:0:0/,
  /^::ffff:127\./,
  /^::ffff:10\./,
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./,
  /^::ffff:192\.168\./,
  /^::ffff:169\.254\./,
];

/**
 * 下载图片：SSRF 防护 + 大小限制 + Content-Type 校验
 *
 * 防护维度：
 * 1. 协议白名单：仅 http/https（默认 https，http 可选关闭）
 * 2. DNS 解析后比对私网/环回/链路本地
 * 3. 最多 3 次重定向
 * 4. 大小限制：10MB
 * 5. Content-Type 必须为 image/*
 * 6. 魔数校验（前几字节）
 *
 * @param {string} url
 * @param {object} opts { allowHttp=false, maxBytes=IMAGE_MAX_BYTES, maxRedirects=3 }
 * @returns {Promise<{buffer: Buffer, contentType: string, md5: string}>}
 */
export async function fetchImage(url, opts = {}) {
  const allowHttp = opts.allowHttp === true;
  const maxBytes = opts.maxBytes || config.IMAGE_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? 3;

  // 协议白名单
  const u = new URL(url);
  if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) {
    throw new ImageFetchError('protocol not allowed', 403);
  }

  // DNS 解析 + 私网检查
  const hostname = u.hostname;
  let resolved;
  try {
    resolved = await lookup(hostname, { all: true });
  } catch (e) {
    throw new ImageFetchError(`dns lookup failed: ${e.message}`, 502);
  }
  if (resolved.length === 0) {
    throw new ImageFetchError('dns resolved no addresses', 502);
  }
  for (const { address } of resolved) {
    if (isPrivateIP(address)) {
      throw new ImageFetchError(`dns resolves to private address: ${address}`, 403);
    }
  }

  // 拉取
  const result = await fetchWithRedirect(u, { maxRedirects, maxBytes, depth: 0 });
  return result;
}

async function fetchWithRedirect(urlObj, { maxRedirects, maxBytes, depth }) {
  if (depth > maxRedirects) {
    throw new ImageFetchError('too many redirects', 502);
  }

  const res = await request(urlObj.toString(), {
    method: 'GET',
    headersTimeout: config.HTTP_TIMEOUT_MS,
    bodyTimeout: config.HTTP_TIMEOUT_MS,
    maxRedirections: 0, // 我们手动处理重定向，避免 SSRF
  });

  // 处理重定向
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers['location']) {
    const loc = res.headers['location'];
    res.body.dump(); // 释放
    let newUrl;
    try {
      newUrl = new URL(loc, urlObj);
    } catch {
      throw new ImageFetchError(`invalid redirect location: ${loc}`, 502);
    }
    // 协议白名单 + DNS 检查再次生效
    if (newUrl.protocol !== 'https:' && newUrl.protocol !== 'http:') {
      throw new ImageFetchError('redirect protocol not allowed', 403);
    }
    const lookupResult = await lookup(newUrl.hostname, { all: true });
    for (const { address } of lookupResult) {
      if (isPrivateIP(address)) {
        throw new ImageFetchError(`redirect resolves to private: ${address}`, 403);
      }
    }
    return fetchWithRedirect(newUrl, { maxRedirects, maxBytes, depth: depth + 1 });
  }

  if (res.statusCode !== 200) {
    res.body.dump();
    throw new ImageFetchError(`upstream status ${res.statusCode}`, 502);
  }

  const contentType = (res.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('image/')) {
    res.body.dump();
    throw new ImageFetchError(`content-type not image: ${contentType}`, 415);
  }

  // 流式读取 + 大小限制
  const chunks = [];
  let totalLen = 0;
  for await (const chunk of res.body) {
    totalLen += chunk.length;
    if (totalLen > maxBytes) {
      throw new ImageFetchError(`image too large: >${maxBytes}B`, 413);
    }
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  // 魔数校验
  const magicOk = checkImageMagic(buffer);
  if (!magicOk.ok) {
    throw new ImageFetchError(`magic mismatch: ${magicOk.reason}`, 415);
  }

  // md5
  const { createHash } = await import('node:crypto');
  const md5 = createHash('md5').update(buffer).digest('hex');

  logger.info({ url: urlObj.toString(), size: totalLen, contentType, md5 }, 'image fetched');
  return { buffer, contentType, md5 };
}

function isPrivateIP(addr) {
  for (const re of PRIVATE_IPV4) {
    if (re.test(addr)) return true;
  }
  // ::ffff:a.b.c.d 形式
  const v4Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
  if (v4Mapped) {
    const ipv4 = v4Mapped[1];
    for (const re of PRIVATE_IPV4) {
      if (re.test(ipv4)) return true;
    }
  }
  return false;
}

// 图片魔数
function checkImageMagic(buf) {
  if (buf.length < 4) return { ok: false, reason: 'too small' };
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ok: true };
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ok: true };
  // GIF: 47 49 46 38 (GIF8)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return { ok: true };
  // WebP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50 (RIFF....WEBP)
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return { ok: true };
  return { ok: false, reason: 'unknown magic' };
}

export class ImageFetchError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ImageFetchError';
    this.code = code;
  }
}

export default { fetchImage, ImageFetchError };
