import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import config from '../config.js';

const KEY = config.MASTER_KEY; // 32 字节
const ALGO = 'aes-256-gcm';
const NONCE_LEN = 12;
const TAG_LEN = 16;

/**
 * AES-256-GCM 加密
 * - 每次随机生成 nonce（GCM 严禁复用 nonce = 密钥破）
 * - 返回 { ciphertext: Buffer, iv: Buffer }，其中 iv = nonce(12) + tag(16)
 * @param {string|Buffer} plaintext
 * @returns {{ ciphertext: string (base64), iv: string (base64) }}
 */
export function encrypt(plaintext) {
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv(ALGO, KEY, nonce);
  const data = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: Buffer.concat([nonce, tag]).toString('base64'),
  };
}

/**
 * AES-256-GCM 解密
 * @param {string} ciphertextB64 base64 密文
 * @param {string} ivB64 base64 编码的 nonce(12) + tag(16)
 * @returns {string} plaintext utf8
 */
export function decrypt(ciphertextB64, ivB64) {
  const ivBuf = Buffer.from(ivB64, 'base64');
  if (ivBuf.length !== NONCE_LEN + TAG_LEN) {
    throw new Error(`invalid iv length: ${ivBuf.length}, expected ${NONCE_LEN + TAG_LEN}`);
  }
  const nonce = ivBuf.subarray(0, NONCE_LEN);
  const tag = ivBuf.subarray(NONCE_LEN);
  const decipher = createDecipheriv(ALGO, KEY, nonce);
  decipher.setAuthTag(tag);
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}

/**
 * 对一个明文字符串执行 encrypt，并返回适合直接写入 DB 的对象
 * { field_enc, secret_iv }
 */
export function encryptField(plain) {
  const { ciphertext, iv } = encrypt(plain);
  return { field_enc: ciphertext, secret_iv: iv };
}

export default { encrypt, decrypt, encryptField };
