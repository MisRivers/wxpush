#!/usr/bin/env bash
# WxPush GitHub 发布脚本（唯一发布入口）
#
# 用法：
#   bash scripts/release.sh          # 发布当前 VERSION 对应的版本
#   bash scripts/release.sh --dry    # 演练模式：只构建打包，不 commit/tag/push/release
#
# 发布规则（详见 RELEASE.md）：
#   1. 前置检查：gh token、工作区干净、VERSION 格式合法
#   2. 运行 scripts/pack.sh：构建前端 + 打包 dist/wxpush-{VER}.tar.gz + VERSION 自动递增
#   3. 提交所有变更（含递增后的 VERSION）
#   4. 打 tag {VER}（指向本次发布提交）
#   5. 推送 main 分支 + tag
#   6. gh release create：以 tar.gz 为附件创建 GitHub Release
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

# ---- 颜色 ----
if [[ -t 1 ]]; then
  C_RED='\033[0;31m'; C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_BLUE='\033[0;34m'; C_NC='\033[0m'
else
  C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_NC=''
fi
info()  { echo -e "${C_BLUE}[release]${C_NC} $*"; }
ok()    { echo -e "${C_GREEN}[release]${C_NC} $*"; }
warn()  { echo -e "${C_YELLOW}[release]${C_NC} $*"; }
err()   { echo -e "${C_RED}[release]${C_NC} $*" >&2; }

DRY=0
[[ "${1:-}" == "--dry" ]] && DRY=1

# ---- 1. 前置检查 ----
command -v git >/dev/null || { err "git 未安装"; exit 1; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { err "当前目录不是 git 仓库"; exit 1; }

REMOTE_URL="$(git remote get-url origin 2>/dev/null || true)"
if [[ -z "${REMOTE_URL}" ]]; then
  err "未配置 origin 远程仓库。先执行: git remote add origin git@github.com:USER/wxpush.git"
  exit 1
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
  warn "GH_TOKEN 未设置，GitHub Release 步骤将跳过（push 仍会进行，需本机已有 git 凭据）"
fi

if [[ ! -f VERSION ]]; then
  err "VERSION 文件不存在"
  exit 1
fi
CUR_VERSION="$(tr -d '[:space:]' < VERSION)"
if [[ ! "${CUR_VERSION}" =~ ^V[0-9]+\.[0-9]+\.[0-9]{3}$ ]]; then
  err "VERSION 格式非法: ${CUR_VERSION}"
  exit 1
fi
info "当前版本: ${CUR_VERSION}（本次发布 ${CUR_VERSION}，打包后自动递增）"

# 工作区检查（发布前应提交或暂存所有改动）
if ! git diff --quiet || ! git diff --cached --quiet; then
  WARN_DIRTY=1
  warn "工作区有未提交改动 —— 将统一纳入本次发布提交"
fi

# ---- 2. 构建 + 打包（pack.sh 会把 VERSION 递增为下一版本）----
bash "${SCRIPT_DIR}/pack.sh"

# 打包产物版本 = pack.sh 递增前的 VERSION
RELEASE_VERSION="${CUR_VERSION}"
TARBALL="${ROOT_DIR}/dist/wxpush-${RELEASE_VERSION}.tar.gz"
if [[ ! -f "${TARBALL}" ]]; then
  err "打包产物缺失: ${TARBALL}"
  exit 1
fi

# tag 已存在则终止（防重复发布）
if git rev-parse "refs/tags/${RELEASE_VERSION}" >/dev/null 2>&1; then
  err "tag ${RELEASE_VERSION} 已存在，请检查 VERSION 是否忘记递增"
  exit 1
fi

if [[ ${DRY} -eq 1 ]]; then
  ok "[dry] 构建打包完成，演练结束（未 commit/tag/push/release）"
  exit 0
fi

# ---- 3. 提交 ----
BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || echo main)"
info "提交发布变更到 ${BRANCH} ..."
git add -A
if git diff --cached --quiet; then
  info "无新的变更需要提交（仅 VERSION 递增也视为变更）"
else
  git commit -m "$(cat <<EOF
release: ${RELEASE_VERSION}

- 构建产物: dist/wxpush-${RELEASE_VERSION}.tar.gz
- VERSION 已递增至下一版本
EOF
)"
fi

# ---- 4. 打 tag ----
info "打 tag ${RELEASE_VERSION} ..."
git tag -a "${RELEASE_VERSION}" -m "WxPush ${RELEASE_VERSION}"

# ---- 5. 推送 ----
info "推送 ${BRANCH} + tags 到 origin ..."
git push origin "${BRANCH}"
git push origin "${RELEASE_VERSION}"

# ---- 6. GitHub Release ----
if [[ -n "${GH_TOKEN:-}" ]] && command -v gh >/dev/null 2>&1; then
  info "创建 GitHub Release ${RELEASE_VERSION} ..."
  gh release create "${RELEASE_VERSION}" "${TARBALL}" \
    --title "WxPush ${RELEASE_VERSION}" \
    --notes "下载附件 wxpush-${RELEASE_VERSION}.tar.gz，上传服务器后执行 ./go.sh upgrade 完成升级。详见 README.md。"
  ok "GitHub Release 已创建"
elif [[ -n "${GH_TOKEN:-}" ]]; then
  # 无 gh CLI 时用 REST API 创建 Release
  info "使用 API 创建 GitHub Release ${RELEASE_VERSION} ..."
  UPLOAD_URL="$(curl -s -H "Authorization: Bearer ${GH_TOKEN}" "https://api.github.com/repos/${GITHUB_REPO}/releases" \
    -X POST -d "{\"tag_name\":\"${RELEASE_VERSION}\",\"name\":\"WxPush ${RELEASE_VERSION}\",\"body\":\"下载附件完成部署/升级。\"}" \
    | grep -o '"upload_url": *"[^"]*"' | head -1 | sed 's/.*"https/&/; s/"$//' | sed 's/{.*}//')"
  if [[ -n "${UPLOAD_URL}" ]]; then
    curl -s -H "Authorization: Bearer ${GH_TOKEN}" \
      -H "Content-Type: application/gzip" \
      --data-binary @"${TARBALL}" \
      "${UPLOAD_URL}?name=wxpush-${RELEASE_VERSION}.tar.gz" >/dev/null
    ok "GitHub Release 已创建（API）"
  else
    warn "GitHub Release 创建失败，请手动上传 ${TARBALL}"
  fi
fi

echo ""
echo "==============================================="
ok "发布完成 ${RELEASE_VERSION}"
echo "  仓库:   ${REMOTE_URL}"
echo "  tag:    ${RELEASE_VERSION}"
echo "  产物:   ${TARBALL}"
echo "==============================================="
