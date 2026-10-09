import crypto from 'node:crypto';

/**
 * 企业微信消息加解密工具
 * 参考企业微信开放文档：https://developer.work.weixin.qq.com/document/path/90930
 */

/**
 * SHA1 签名（参数排序后拼接）
 * @param  {...string} args
 */
function sha1(...args) {
  return crypto.createHash('sha1').update(args.sort().join('')).digest('hex');
}

/**
 * 验证回调签名（URL 验证场景，含 echostr）
 * @param {string} token       回调 Token
 * @param {string} timestamp    时间戳
 * @param {string} nonce        随机数
 * @param {string} echostr     加密的 echostr
 * @param {string} msgSignature 微信传来的签名
 */
export function verifySignature(token, timestamp, nonce, echostr, msgSignature) {
  const calculated = sha1(token, timestamp, nonce, echostr);
  return calculated === msgSignature;
}

/**
 * 验证回调签名（消息接收场景，不含 echostr）
 */
export function verifyMsgSignature(token, timestamp, nonce, msgSignature) {
  const calculated = sha1(token, timestamp, nonce);
  return calculated === msgSignature;
}

/**
 * 解密企业微信消息（AES-256-CBC）
 * @param {string} encrypted    base64 编码的密文
 * @param {string} encodingAESKey 43 字符的 EncodingAESKey
 * @returns {string} 解密后的明文（XML 或 echostr）
 */
export function decrypt(encrypted, encodingAESKey) {
  // EncodingAESKey 43 字符 base64，补 '=' 后解码为 32 字节
  const key = Buffer.from(encodingAESKey + '=', 'base64');
  const iv = key.subarray(0, 16);

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = Buffer.concat([
    decipher.update(encrypted, 'base64'),
    decipher.final(),
  ]);

  // 去 PKCS7 padding
  const pad = decrypted[decrypted.length - 1];
  decrypted = decrypted.subarray(0, decrypted.length - pad);

  // 格式：random[16] + msg_len[4] + msg_content + appid
  const msgLen = decrypted.readUInt32BE(16);
  return decrypted.subarray(20, 20 + msgLen).toString('utf8');
}

/**
 * 生成随机 Token（32 字符 hex）
 */
export function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * 生成随机 EncodingAESKey（43 字符 base64 无填充）
 */
export function generateAESKey() {
  return crypto.randomBytes(32).toString('base64').slice(0, 43);
}
