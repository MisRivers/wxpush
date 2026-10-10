-- WxPush 数据库 Schema v1
-- 引擎：better-sqlite3 + WAL 模式
-- 字段加密：corp_secret / webhook_key / webhook_sign_secret / access_token 用 AES-256-GCM；
--          secret_iv 字段存 base64(nonce[12] + tag[16])

PRAGMA foreign_keys = ON;

-- ============================================================
-- 1. users：管理员账号（预留 role 字段以便未来扩展）
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,                 -- bcrypt(cost=12)
  role          TEXT    NOT NULL DEFAULT 'admin',  -- admin（预留）
  pw_algo       TEXT    NOT NULL DEFAULT 'v1',      -- v1=bcrypt(plaintext) v2=bcrypt(sha256(plaintext))
  session_version INTEGER NOT NULL DEFAULT 0,       -- 单设备登录：每次登录递增，旧 JWT 失效
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============================================================
-- 2. apps：企业微信应用消息渠道
-- ============================================================
CREATE TABLE IF NOT EXISTS apps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,                  -- 备注名（用户可见）
  corp_id       TEXT    NOT NULL,
  agent_id      INTEGER NOT NULL,
  corp_secret_enc TEXT  NOT NULL,                  -- AES-256-GCM 密文 base64
  secret_iv     TEXT    NOT NULL,                  -- base64(nonce[12]+tag[16])
  -- 是否允许「@所有人」（@all）推送；若为 0，token 不可指定 touser='@all'
  allow_at_all  INTEGER NOT NULL DEFAULT 1,
  -- @all 天级配额上限（默认 5/天），仅在 allow_at_all=1 时生效
  at_all_daily_limit INTEGER NOT NULL DEFAULT 5,
  -- 企业微信验证：可信域名验证文件
  verify_file_name    TEXT,                        -- 如 WW_verify_xxxx.txt
  verify_file_content TEXT,                        -- 文件内容（纯文本）
  -- 企业微信验证：接收消息服务器回调配置
  callback_token      TEXT,                        -- 回调 Token（明文，用于签名验证）
  callback_aes_key_enc TEXT,                       -- AES-256-GCM 加密的 EncodingAESKey
  callback_aes_key_iv  TEXT,                        -- base64(nonce[12]+tag[16])
  note          TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_apps_corp_id ON apps(corp_id);

-- ============================================================
-- 3. webhooks：群机器人渠道
-- ============================================================
CREATE TABLE IF NOT EXISTS webhooks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  webhook_key_enc TEXT    NOT NULL,                -- AES-256-GCM 密文 base64
  secret_iv       TEXT    NOT NULL,
  -- 安全模式：none | keyword | sign
  security_mode   TEXT    NOT NULL DEFAULT 'none' CHECK (security_mode IN ('none','keyword','sign')),
  -- 自定义关键词（security_mode='keyword' 时必填）
  keyword         TEXT,
  -- 加签密钥（security_mode='sign' 时必填，AES-256-GCM 密文 base64）
  sign_secret_enc TEXT,
  sign_secret_iv  TEXT,
  note            TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_webhooks_created ON webhooks(created_at DESC);

-- ============================================================
-- 4. tokens：sendkey（核心表）
-- ============================================================
CREATE TABLE IF NOT EXISTS tokens (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  token           TEXT    NOT NULL UNIQUE,         -- base64url 32 字符
  name            TEXT    NOT NULL,                 -- 备注名
  -- 渠道类型：app（应用消息） | webhook（群机器人）
  channel_type    TEXT    NOT NULL CHECK (channel_type IN ('app','webhook')),
  -- 二选一：app 模式 → app_id；webhook 模式 → webhook_id
  app_id          INTEGER,
  webhook_id      INTEGER,
  -- 允许的消息类型集合（JSON array: ["text","markdown","textcard","image","news"]）
  allowed_msg_types TEXT NOT NULL DEFAULT '["text","markdown","textcard","image","news"]',
  -- 限流配额：每分钟最大请求数；0 表示不限
  rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
  -- IP 白名单：CIDR 列表 JSON 数组（["1.2.3.0/24","5.6.7.8"]）；NULL 表示不限
  ip_whitelist TEXT,
  -- 过期时间（Unix 秒，NULL = 永不过期）
  expires_at      INTEGER,
  -- 是否启用
  enabled         INTEGER NOT NULL DEFAULT 1,
  note            TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  -- CHECK 约束：app 与 webhook 二选一
  CHECK (
    (channel_type = 'app'    AND app_id     IS NOT NULL AND webhook_id IS NULL) OR
    (channel_type = 'webhook' AND webhook_id IS NOT NULL AND app_id     IS NULL)
  ),
  FOREIGN KEY (app_id)     REFERENCES apps(id)     ON DELETE RESTRICT,
  FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_tokens_channel ON tokens(channel_type);
CREATE INDEX IF NOT EXISTS idx_tokens_enabled ON tokens(enabled);

-- ============================================================
-- 5. token_recipients：token 静态绑定的接收人（应用消息专用）
-- ============================================================
CREATE TABLE IF NOT EXISTS token_recipients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id    INTEGER NOT NULL,
  -- 接收人类型：user | department | tag
  recv_type   TEXT    NOT NULL CHECK (recv_type IN ('user','department','tag')),
  -- 接收人 ID（用户 = userid 字符串；部门 = 数字 ID；标签 = 数字 ID）
  recv_value  TEXT    NOT NULL,
  -- 冗余：@all 标记（recv_type='user' 且 recv_value='@all'）
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(token_id, recv_type, recv_value),
  FOREIGN KEY (token_id) REFERENCES tokens(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recipients_token ON token_recipients(token_id);

-- ============================================================
-- 6. access_tokens：企业微信 access_token 缓存（密文存储）
-- ============================================================
CREATE TABLE IF NOT EXISTS access_tokens (
  app_id          INTEGER PRIMARY KEY,
  token_enc       TEXT    NOT NULL,                -- AES-256-GCM 密文 base64
  secret_iv       TEXT    NOT NULL,
  -- 过期 Unix 秒
  expires_at      INTEGER NOT NULL,
  -- 最近一次刷新是否失败（连续失败次数，用于告警）
  refresh_fail_count INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);

-- ============================================================
-- 7. logs：推送日志
-- ============================================================
CREATE TABLE IF NOT EXISTS logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 冗余存 token 值，避免 join 便于审计
  token_value   TEXT    NOT NULL,
  token_id      INTEGER,
  -- 渠道快照：app / webhook
  channel_type  TEXT    NOT NULL,
  -- 应用 ID 或 webhook ID（与 channel_type 对应）
  channel_id    INTEGER,
  -- 消息类型：text / markdown / textcard / image / news
  msg_type      TEXT    NOT NULL,
  -- 推送请求体（脱敏后的 JSON 字符串）
  request_body  TEXT,
  -- 上游响应体（JSON 字符串）
  response_body TEXT,
  -- 本地处理状态：success | failed | rate_limited | invalid_token | error
  status        TEXT    NOT NULL,
  -- 错误码（status=success 时为 0；上游错误时为 WeCom errcode；本地错误为自定义 code）
  error_code    INTEGER,
  error_message TEXT,
  -- 调用方 IP
  client_ip     TEXT,
  -- 请求 ID（贯穿日志）
  request_id    TEXT,
  -- 处理耗时（毫秒）
  duration_ms   INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (token_id) REFERENCES tokens(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_token_created ON logs(token_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_status_created ON logs(status, created_at DESC);

-- ============================================================
-- 8. stats_daily：日聚合统计（幂等 upsert）
-- ============================================================
CREATE TABLE IF NOT EXISTS stats_daily (
  date          TEXT    NOT NULL,                  -- YYYY-MM-DD（Asia/Shanghai 日界）
  token_id      INTEGER,
  total_count   INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count  INTEGER NOT NULL DEFAULT 0,
  -- NULL token_id 表示「全 token 汇总」行
  PRIMARY KEY (date, token_id),
  -- token_id = NULL 表示全局汇总；非 NULL 时必须存在对应 token
  -- 注意 SQLite 不允许跨表外键在 PRIMARY KEY 上，因此不在 DDL 加 FK
  CHECK (total_count = success_count + failed_count)
);

CREATE INDEX IF NOT EXISTS idx_stats_date ON stats_daily(date DESC);

-- ============================================================
-- 9. audit_logs：管理后台操作审计
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 操作者用户名（可能为 'system' 或 'init'）
  actor       TEXT    NOT NULL,
  -- 操作类型：create_app / update_app / delete_app / create_webhook / ... / login / etc.
  action      TEXT    NOT NULL,
  -- 目标资源类型 + ID（JSON 字符串）
  target      TEXT,
  -- 详情（JSON 字符串，脱敏后）
  detail      TEXT,
  -- 调用方 IP
  client_ip   TEXT,
  request_id  TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor);

-- ============================================================
-- 10. settings：K-V 系统设置
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 默认插入初始化标记（init_completed=0 表示未初始化）
INSERT OR IGNORE INTO settings(key, value) VALUES('init_completed', '0');
INSERT OR IGNORE INTO settings(key, value) VALUES('default_rate_limit', '60');
INSERT OR IGNORE INTO settings(key, value) VALUES('log_retention_days', '30');
INSERT OR IGNORE INTO settings(key, value) VALUES('version', '1');

-- ============================================================
-- 11. rate_counters：天级配额持久化（防重启清零）
-- ============================================================
CREATE TABLE IF NOT EXISTS rate_counters (
  -- key 形如 'atall:{app_id}' / 'login_fail:{ip}' / 'token:{token_id}'
  key   TEXT NOT NULL,
  -- day 形如 'YYYY-MM-DD'（Asia/Shanghai 日界）
  day   TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  -- 上次重置时间（用于判断是否需要跨日清零）
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (key, day)
);
