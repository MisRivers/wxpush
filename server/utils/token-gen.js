import { randomBytes } from 'node:crypto';

/**
 * 生成 sendkey：24 字节随机 → base64url（32 字符）
 * 正则匹配：^[A-Za-z0-9_-]{32,64}$（兼容 32~64 字符的 base64url 串）
 */
export function generateToken() {
  return randomBytes(24).toString('base64url');
}

/**
 * 校验 token 字符串格式
 */
export function isValidTokenFormat(token) {
  if (typeof token !== 'string') return false;
  return /^[A-Za-z0-9_-]{32,64}$/.test(token);
}

export default { generateToken, isValidTokenFormat };
