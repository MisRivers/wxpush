import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';

// 加载 .env（若存在），缺失也不报错——生产环境可由 systemd 注入 env
try {
  dotenv.config();
} catch {
  // .env 文件不存在时静默
}

const PORT = parseInt(process.env.PORT || '8401', 10);
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH || './data/push.db';
const BODY_LIMIT = parseInt(process.env.BODY_LIMIT || '20971520', 10);
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const NODE_ENV = process.env.NODE_ENV || 'development';

// ---- MASTER_KEY：必须 32 字节 base64（解码后 32 字节）----
const MASTER_KEY_RAW = process.env.MASTER_KEY;
if (!MASTER_KEY_RAW) {
  throw new Error('[config] MASTER_KEY 未设置。生成命令：node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
}
let MASTER_KEY;
try {
  MASTER_KEY = Buffer.from(MASTER_KEY_RAW, 'base64');
} catch (e) {
  throw new Error('[config] MASTER_KEY 不是合法 base64');
}
if (MASTER_KEY.length !== 32) {
  throw new Error(`[config] MASTER_KEY 解码后必须 32 字节，实际 ${MASTER_KEY.length}。请用 randomBytes(32).toString('base64') 生成`);
}

// ---- JWT_SECRET：必须 ≥ 32 字节随机字符串 ----
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('[config] JWT_SECRET 未设置。生成命令：node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"');
}
if (Buffer.byteLength(JWT_SECRET, 'utf8') < 32) {
  throw new Error(`[config] JWT_SECRET 必须 ≥ 32 字节，当前 ${Buffer.byteLength(JWT_SECRET, 'utf8')} 字节`);
}

// ---- 日校验：禁止在 production 模式下用默认弱密钥 ----
if (NODE_ENV === 'production') {
  if (MASTER_KEY_RAW === 'change-me' || JWT_SECRET === 'change-me') {
    throw new Error('[config] production 模式禁止使用占位密钥');
  }
}

export const config = {
  PORT,
  HOST,
  DB_PATH,
  BODY_LIMIT,
  LOG_LEVEL,
  NODE_ENV,
  MASTER_KEY,
  JWT_SECRET,
  // 派生配置
  JWT_EXPIRES_IN: '7d',
  BCRYPT_COST: 12,
  ACCESS_TOKEN_REFRESH_INTERVAL_MS: 5 * 60 * 1000, // 5 分钟主动刷新
  LOG_RETENTION_DAYS: 30,
  RATE_LIMIT_DEFAULT_PER_MIN: 60,
  // 企业微信上游 API
  WECOM_API_BASE: 'https://qyapi.weixin.qq.com/cgi-bin',
  HTTP_TIMEOUT_MS: 5000,
  HTTP_MAX_RETRIES: 3,
  // 批量日志写入
  LOG_FLUSHER_INTERVAL_MS: 200,
  LOG_FLUSHER_BATCH_SIZE: 50,
  // 图片下载上限
  IMAGE_MAX_BYTES: 10 * 1024 * 1024, // 10MB
  // Cloudflare Turnstile（可选，留空表示不启用）
  TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY || '',
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY || '',
  // 前端静态文件目录（用于写入 WW_verify_*.txt 等文件，Nginx try_files 自动服务）
  STATIC_DIR: process.env.STATIC_DIR || './web/dist',
};

export default config;
