# WxPush 发布规则说明

本文档定义 WxPush 的标准发布流程。**所有版本发布一律通过 `scripts/release.sh` 完成**，禁止手动绕过。

---

## 一、发布规则总览

| 规则 | 说明 |
|------|------|
| 版本号格式 | `V主版本.次版本.三位补丁`，如 `V1.0.020` |
| 版本号递增 | `pack.sh` 打包成功后**自动递增**补丁位（999 进位到次版本） |
| 版本号唯一 | Git tag 与 VERSION 一一对应，重复 tag 会被脚本拒绝 |
| 发布入口 | `bash scripts/release.sh`（唯一入口） |
| 发布产物 | `dist/wxpush-{VER}.tar.gz` + Git tag + GitHub Release |
| 敏感文件 | `.env`、`data/*.db`、`logs/`、备份等由 `.gitignore` 强制排除，**永不入库** |

## 二、发布前检查

```bash
# 1. 确认版本状态
cat VERSION

# 2. 演练：只构建打包，不 commit / tag / push / release
bash scripts/release.sh --dry

# 3. 确认产物
ls -la dist/
```

## 三、正式发布

```bash
bash scripts/release.sh
```

脚本自动执行：

1. **前置检查** — git 仓库、origin 远程、VERSION 格式、tag 冲突
2. **构建打包** — 调用 `scripts/pack.sh`：构建前端 → 打包 tar.gz → VERSION 自动递增
3. **提交** — `git add -A && git commit`（含递增后的 VERSION）
4. **打 tag** — `git tag -a {VER}`
5. **推送** — `git push origin main` + `git push origin {VER}`
6. **GitHub Release** — 创建 Release 并上传 tar.gz 附件（需 `GH_TOKEN`）

## 四、服务器升级

```bash
# 上传 tar.gz 后，在安装目录执行
./go.sh upgrade /path/to/wxpush-{VER}.tar.gz
```

升级流程自动：备份数据库/.env/代码 → 替换代码 → 安装依赖 → 数据库迁移 → 重启 → 健康检查，失败自动回撤。

## 五、紧急修复（跳过打包的服务器热修）

仅限紧急场景，事后必须补一次正式发布：

```bash
# 服务器上直接解包覆盖核心文件后
pm2 restart wxpush
```

## 六、回滚

```bash
# 本地回滚版本（VERSION 回退后需手动修正）
git tag -d {VER} && git push origin :refs/tags/{VER}

# 服务器回滚到上一备份
./go.sh rollback [备份版本号]
```

## 七、凭据说明

| 凭据 | 用途 | 存放 |
|------|------|------|
| `GH_TOKEN` | push / 创建 Release | 环境变量（勿写入任何文件） |
| `MASTER_KEY` | 数据库字段加密 | 服务器 `.env` |
| `JWT_SECRET` | 登录态签名 | 服务器 `.env` |

> ⚠️ 任何密钥/Token 一旦泄露，立即在 GitHub → Settings → Developer settings 中吊销重发。
