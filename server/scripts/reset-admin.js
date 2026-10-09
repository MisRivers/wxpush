/**
 * CLI: 重置管理员密码
 * 用法: npm run reset-admin -- --username=<username> --password=<newpassword>
 *
 * 密码安全：先 SHA-256 哈希明文密码，再 bcrypt 二次哈希存储（pw_algo='v2'）
 * 与前端登录流程一致：前端 SHA-256(明文) → 传输 → 后端 bcrypt(sha256_hash) → 存储
 */
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';

try { dotenv.config(); } catch {}

const config = (await import('../config.js')).default;

// 解析命令行参数 --username=xxx --password=xxx
const args = {};
for (const arg of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(arg);
  if (m) args[m[1]] = m[2];
}
const username = args.username;
const password = args.password;

if (!username || !password) {
  console.error('用法: npm run reset-admin -- --username=<username> --password=<newpassword>');
  process.exit(1);
}

if (!/^[A-Za-z][A-Za-z0-9._-]{2,31}$/.test(username)) {
  console.error('用户名格式不合法（3-32 字符，字母开头）');
  process.exit(1);
}
if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
  console.error('密码格式不合法（≥8 字符，必须含字母+数字）');
  process.exit(1);
}

// SHA-256 哈希明文密码（与前端 crypto.subtle.digest('SHA-256') 等价）
const sha256Hash = createHash('sha256').update(password).digest('hex');

const { migrate, getDB, closeDB } = await import('../db/index.js');
migrate();
const db = getDB();

const row = db.prepare('SELECT id FROM users WHERE username=?').get(username);
if (!row) {
  console.error(`用户 '${username}' 不存在`);
  closeDB();
  process.exit(1);
}

const hash = await bcrypt.hash(sha256Hash, config.BCRYPT_COST);
db.prepare('UPDATE users SET password_hash=?, pw_algo=?, updated_at=unixepoch() WHERE id=?').run(hash, 'v2', row.id);

try {
  db.prepare('INSERT INTO audit_logs(actor, action, target, detail, client_ip, request_id) VALUES(?, ?, ?, ?, ?, ?)')
    .run(username, 'reset_password', JSON.stringify({ type: 'user', id: row.id }), null, '127.0.0.1', null);
} catch {}

console.log(`✓ 用户 '${username}' 的密码已重置（SHA-256 + bcrypt, pw_algo=v2）`);
closeDB();
process.exit(0);
