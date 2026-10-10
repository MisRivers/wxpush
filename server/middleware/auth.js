import jwt from 'jsonwebtoken';
import config from '../config.js';
import { getDB } from '../db/index.js';
import { AppError } from './error.js';

/**
 * 管理后台 JWT 校验中间件
 * - 从 Authorization: Bearer <token> 头解码 JWT
 * - 校验签名 + 用户存在
 * - 失败返回 401
 *
 * 用法：app.addHook('preHandler', adminAuthRequired)
 */
export async function adminAuthRequired(req) {
  const auth = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) {
    throw new AppError(40101, 'missing or invalid Authorization header', { statusCode: 401 });
  }
  const token = m[1];

  let payload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET);
  } catch (e) {
    throw new AppError(40102, `token invalid: ${e.message}`, { statusCode: 401 });
  }
  if (payload.type !== 'admin') {
    throw new AppError(40103, 'token type not admin', { statusCode: 401 });
  }

  // 用户必须存在
  const db = getDB();
  const user = db.prepare('SELECT id, username, role, session_version FROM users WHERE id=?').get(payload.uid);
  if (!user) {
    throw new AppError(40104, 'user not found', { statusCode: 401 });
  }

  // 单设备登录：JWT 中的 sv 必须与数据库一致
  // sv 不匹配 = 已有新设备登录，旧 token 失效
  if (payload.sv !== undefined && payload.sv !== user.session_version) {
    throw new AppError(40105, 'session expired: another device logged in', { statusCode: 401 });
  }

  req.adminUser = user;
}

/**
 * 生成管理后台 JWT（7 天有效期）
 * 包含 session_version，用于单设备登录校验
 */
export function signAdminJWT(user) {
  return jwt.sign(
    { uid: user.id, username: user.username, type: 'admin', sv: user.session_version ?? 0 },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN }
  );
}

export default { adminAuthRequired, signAdminJWT };
