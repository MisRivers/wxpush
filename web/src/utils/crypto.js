/**
 * 客户端密码 SHA-256 哈希
 * 传输前对密码进行哈希，避免明文传输
 * 后端收到哈希后再 bcrypt 二次哈希存储
 */
export async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = [...new Uint8Array(hashBuffer)];
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
