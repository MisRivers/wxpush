<div align="center">

# WxPush

**企业微信推送服务 — Server 酱风格调用 + 可视化管理后台**

[![Node](https://img.shields.io/badge/Node-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify)](https://www.fastify.io/)
[![Vue](https://img.shields.io/badge/Vue-3-42b883?logo=vue.js)](https://vuejs.org/)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite)](https://www.sqlite.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](#license)

一个轻量、快速、自托管的企业微信推送网关，支持「应用消息」和「群机器人」两种渠道，兼容 Server 酱协议，提供完整的管理后台。

</div>

---

## ✨ 功能特性

### 推送能力
- **双渠道**：企业微信「应用消息」（指定用户/部门/标签）+「群机器人」Webhook
- **三种接口风格**：URL 风格（Server 酱兼容）、API v1（结构化 JSON）、API v2（企业微信 OpenAPI 兼容）
- **五种消息类型**：text / markdown / textcard / image / news
- **安全模式**：群机器人支持 none / keyword / sign 三种安全模式
- **@all 配额**：应用消息支持 @所有人，可配置每日上限
- **企业微信验证**：支持可信域名验证（上传 WW_verify_*.txt）和接收消息服务器（自动生成回调 URL + Token + EncodingAESKey）

### 管理后台
- **Token 管理**：生成/编辑/轮换/停用 Token，绑定接收人
- **限流控制**：每个 Token 独立的每分钟限流配置
- **IP 白名单**：按 CIDR 限制调用来源
- **推送日志**：完整的请求/响应记录，支持筛选、导出 CSV
- **调试发送**：后台直接测试推送
- **数据统计**：仪表盘展示今日推送、成功率、趋势图

### 安全
- **密码安全**：客户端 SHA-256 哈希传输 + 服务端 bcrypt 存储
- **人机验证**：可选 Cloudflare Turnstile 防暴力登录
- **密钥加密**：corp_secret / webhook_key / access_token 等敏感字段 AES-256-GCM 加密存储
- **登录限流**：IP 级失败锁定机制
- **JWT 鉴权**：管理后台操作全程鉴权 + 审计日志

### 工程化
- **一键部署**：`go.sh` 脚本支持 install / upgrade / rollback / reset-password
- **自动备份**：升级前自动备份数据库、配置和代码
- **数据库迁移**：启动自动建表 + 增量迁移
- **日志轮转**：按天归档，自动清理过期日志
- **健康检查**：`/healthz` 探活接口

---

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js ≥ 18、Fastify 5、better-sqlite3、bcryptjs、jsonwebtoken、pino |
| 前端 | Vue 3、Vite 5、Element Plus、Pinia、Vue Router 4、ECharts、Axios |
| 加密 | AES-256-GCM（敏感字段）、bcrypt（密码）、SHA-256（传输哈希）、HMAC-SHA256（webhook 加签） |
| 部署 | PM2、Nginx、bash 脚本 |

---

## 📦 快速开始

### 环境要求

- Node.js ≥ 18
- npm ≥ 9
- Linux / macOS（生产推荐 Linux）

### 1. 克隆项目

```bash
git clone https://github.com/your-username/wxpush.git
cd wxpush
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，至少填写以下两个密钥：

```bash
# 生成 MASTER_KEY（32 字节 base64）
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 生成 JWT_SECRET（48 字节 base64）
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

> ⚠️ `MASTER_KEY` 和 `JWT_SECRET` 务必妥善保存。丢失后无法解密数据库中的加密字段。

### 3. 一键部署

```bash
./go.sh install
```

该命令会自动完成：
- 环境检查
- 安装后端依赖
- 构建前端
- 初始化数据库
- 生成 PM2 配置并启动

### 4. 初始化管理员

浏览器访问 `http://your-server:8401`（或 Nginx 反代后的域名），首次访问会跳转初始化页面，创建管理员账号。

### 5. 配置推送

1. 登录管理后台
2. 在「应用管理」或「群机器人」中添加推送渠道
3. 在「Token 管理」中生成 Token 并绑定渠道和接收人
4. 使用 Token 调用推送接口

### 6. 企业微信验证配置（可选）

在企业微信后台配置应用时，可能需要域名验证。在「应用管理」→ 编辑应用 → 验证配置中二选一：

- **可信域名验证**：从企业微信后台下载 `WW_verify_*.txt` 文件，上传到本系统，即可完成域名验证
- **接收消息服务器**：系统自动生成回调 URL，配置 Token 和 EncodingAESKey，复制到企业微信后台即可完成验证

> 详细操作步骤请参考管理后台「使用帮助」页面。

---

## 🚀 部署

### 一键升级

```bash
# 在项目目录执行
./go.sh upgrade

# 或指定压缩包
./go.sh upgrade /path/to/wxpush-V1.0.010.tar.gz
```

升级流程：备份 → 替换代码 → 安装依赖 → 数据库迁移 → 重启 → 健康检查，失败自动回撤。

### 其他命令

```bash
./go.sh status                  # 查看运行状态
./go.sh reset-password          # 重置管理员密码（新版需指定参数）
./go.sh rollback [ver]          # 回撤到指定备份
./go.sh --help                  # 查看帮助
```

### Nginx 反代（极简配置）

后端内置静态文件服务（`@fastify/static`），自动处理 SPA 路由、API、推送接口和企业微信验证文件。Nginx 只需一行 `proxy_pass`：

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 所有请求反代到后端
    location / {
        proxy_pass http://127.0.0.1:8401;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

无需配置 `try_files`、正则匹配 `.send`、静态资源规则等——后端全权处理。

> 完整 Nginx 配置（含限流、安全头）见 [deploy/nginx.conf.example](deploy/nginx.conf.example)。

### 本地打包

```bash
bash scripts/pack.sh
```

产出 `dist/wxpush-{VERSION}.tar.gz`，版本号自动递增。

---

## 📡 推送接口

### 方式一：URL 风格（Server 酱兼容）

```bash
# GET
curl "https://your-domain.com/{token}.send?type=markdown&title=标题&desp=**加粗内容**"

# POST
curl -X POST "https://your-domain.com/{token}.send" \
  -H "Content-Type: application/json" \
  -d '{"type":"text","text":"hello"}'
```

### 方式二：API v1（结构化 JSON）

```bash
curl -X POST "https://your-domain.com/api/v1/push" \
  -H "X-API-Key: {token}" \
  -H "Content-Type: application/json" \
  -d '{"msgType":"markdown","content":"# 标题"}'
```

### 方式三：API v2（企业微信 OpenAPI 兼容）

```bash
curl -X POST "https://your-domain.com/api/v2/openapi/messages/send" \
  -H "X-API-Key: {token}" \
  -H "Content-Type: application/json" \
  -d '{"msgType":"text","content":"hello","toUser":"userid1|userid2"}'
```

### 消息类型

| 类型 | 说明 | 关键字段 |
|------|------|----------|
| `text` | 纯文本 | `content` / `text` |
| `markdown` | Markdown | `content` / `desp` |
| `textcard` | 文本卡片 | `title`, `description`, `url`, `btntxt` |
| `image` | 图片 | `url` |
| `news` | 图文 | `articles` 数组 |

### 响应格式

```json
{
  "code": 0,
  "message": "ok",
  "msgid": "xxxx",
  "timestamp": 1234567890
}
```

> 完整接口文档请登录管理后台 →「使用帮助」查看。

---

## 📁 项目结构

```
wxpush/
├── server/                 # 后端
│   ├── app.js              # Fastify 应用
│   ├── config.js           # 配置
│   ├── routes/             # 路由
│   │   ├── push.js         # URL 风格推送
│   │   ├── api.js          # API v1/v2
│   │   ├── health.js       # 健康检查
│   │   └── admin/          # 管理后台 API
│   ├── services/           # 业务逻辑
│   │   ├── push.js         # 推送调度
│   │   └── channels/       # 渠道实现（app-message / webhook）
│   ├── middleware/         # 中间件（鉴权/限流/IP白名单）
│   ├── db/                 # 数据库（schema + migration）
│   ├── jobs/               # 定时任务
│   ├── utils/              # 工具函数
│   └── scripts/            # 脚本（重置密码等）
├── web/                    # 前端
│   ├── src/
│   │   ├── views/          # 页面组件
│   │   ├── layouts/        # 布局
│   │   ├── stores/         # Pinia 状态
│   │   ├── router/         # 路由
│   │   ├── api/            # API 封装
│   │   └── utils/          # 工具
│   └── index.html
├── deploy/                 # 部署配置（nginx 示例、备份脚本）
├── scripts/pack.sh         # 本地打包脚本
├── go.sh                   # 一键部署脚本
├── ecosystem.config.cjs    # PM2 配置
└── .env.example            # 环境变量模板
```

---

## ⚙️ 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `MASTER_KEY` | 是 | 数据库敏感字段加密主密钥（base64, 32 字节） |
| `JWT_SECRET` | 是 | JWT 签名密钥（base64, ≥32 字节） |
| `PORT` | 否 | 服务端口，默认 `8401` |
| `HOST` | 否 | 监听地址，默认 `127.0.0.1` |
| `DB_PATH` | 否 | 数据库路径，默认 `./data/push.db` |
| `BODY_LIMIT` | 否 | 请求体上限，默认 `20MB` |
| `LOG_LEVEL` | 否 | 日志级别，默认 `info` |
| `TURNSTILE_SITE_KEY` | 否 | Cloudflare Turnstile Site Key |
| `TURNSTILE_SECRET_KEY` | 否 | Cloudflare Turnstile Secret Key |
| `STATIC_DIR` | 否 | 前端静态文件目录，默认 `./web/dist`，用于写入企业微信验证文件 |

---

## 🔐 安全说明

1. **密码**：浏览器端 SHA-256 哈希 → HTTPS 传输 → 服务端 bcrypt(cost=12) 存储
2. **敏感字段**：`corp_secret`、`webhook_key`、`access_token` 等使用 AES-256-GCM 加密存储
3. **鉴权**：管理后台 JWT Token，推送接口 Token + IP 白名单
4. **限流**：登录 IP 级失败锁定 + 每个 Token 独立分钟级限流 + @all 天级配额
5. **审计**：所有管理后台操作写入 `audit_logs`

---

## 📄 License

MIT © WxPush

---

## 🤝 贡献

欢迎提交 Issue 和 PR！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交改动 (`git commit -m 'Add some feature'`)
4. 推送分支 (`git push origin feature/amazing-feature`)
5. 提交 Pull Request
