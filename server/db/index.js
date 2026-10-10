import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { dirname as pathDirname } from 'node:path';
import config from '../config.js';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, 'schema.sql');

let db = null;

/**
 * 打开数据库连接（若已打开则复用）
 * - 启用 WAL 模式
 * - 启用外键
 * - synchronous=NORMAL（WAL 下安全，性能更好）
 */
export function getDB() {
  if (db) return db;

  // 确保 data 目录存在
  const dbPath = config.DB_PATH;
  const dataDir = pathDirname(dbPath);
  try {
    mkdirSync(dataDir, { recursive: true });
  } catch {
    // dataDir 已存在
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('wal_autocheckpoint = 1000'); // 1000 页后 checkpoint
  db.pragma('busy_timeout = 5000');

  logger.info({ dbPath: dbPath }, 'database opened (WAL mode)');
  return db;
}

/**
 * 执行 schema 迁移（幂等）
 * CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS，重复执行安全
 */
export function migrate() {
  const conn = getDB();
  const sql = readFileSync(SCHEMA_PATH, 'utf8');
  conn.exec(sql);

  // ---- 增量迁移：users 表增加 pw_algo 列 ----
  // v1 = bcrypt(plaintext)  v2 = bcrypt(sha256(plaintext))
  try {
    conn.exec("ALTER TABLE users ADD COLUMN pw_algo TEXT NOT NULL DEFAULT 'v1'");
    logger.info('migration: users.pw_algo column added');
  } catch (e) {
    // 列已存在时 SQLite 抛错，忽略即可
  }

  // ---- 增量迁移：users 表增加 session_version 列（单设备登录） ----
  try {
    conn.exec("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0");
    logger.info('migration: users.session_version column added');
  } catch {
    // 列已存在
  }

  // ---- 增量迁移：apps 表增加企业微信验证字段 ----
  for (const col of [
    'verify_file_name TEXT',
    'verify_file_content TEXT',
    'callback_token TEXT',
    'callback_aes_key_enc TEXT',
    'callback_aes_key_iv TEXT',
  ]) {
    try {
      conn.exec(`ALTER TABLE apps ADD COLUMN ${col}`);
      logger.info(`migration: apps.${col.split(' ')[0]} column added`);
    } catch {
      // 列已存在
    }
  }

  logger.info('database schema migrated (all tables + indexes ready)');

  // 校验表清单
  const tables = conn.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map(r => r.name);
  logger.info({ tables }, 'database tables verified');
  return tables;
}

/**
 * 关闭数据库（graceful shutdown 时调用）
 */
export function closeDB() {
  if (db) {
    try {
      db.close();
      logger.info('database closed');
    } catch (e) {
      logger.error({ err: e.message }, 'failed to close db');
    }
    db = null;
  }
}

/**
 * 备份数据库到目标路径（WAL 模式下 .backup 提供一致性快照）
 */
export function backupDB(targetPath) {
  const conn = getDB();
  conn.backup(targetPath);
  logger.info({ target: targetPath }, 'database backup done');
}

export default { getDB, migrate, closeDB, backupDB };
