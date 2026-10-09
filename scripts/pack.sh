#!/usr/bin/env bash
# WxPush 本地一键打包脚本
# 用法：bash scripts/pack.sh
# 产出：dist/wxpush-{VERSION}.tar.gz
# 说明：
#   1. 读取 VERSION 文件作为本次打包版本
#   2. 本地构建前端（web/dist）
#   3. 打包（排除 node_modules / 数据库 / 日志 / .env 等）
#   4. 打包完成后自动递增 VERSION（V1.0.001 -> V1.0.002，patch 999 进位）
#   5. 压缩包顶层目录统一为 wxpush/，内含 go.sh，解压即可部署

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
info()  { echo -e "${C_BLUE}[pack]${C_NC} $*"; }
ok()    { echo -e "${C_GREEN}[pack]${C_NC} $*"; }
warn()  { echo -e "${C_YELLOW}[pack]${C_NC} $*"; }
err()   { echo -e "${C_RED}[pack]${C_NC} $*" >&2; }

# ---- 读取版本号 ----
if [[ ! -f VERSION ]]; then
  err "VERSION 文件不存在"
  exit 1
fi
VERSION="$(tr -d '[:space:]' < VERSION)"
if [[ ! "${VERSION}" =~ ^V[0-9]+\.[0-9]+\.[0-9]{3}$ ]]; then
  err "VERSION 格式非法: ${VERSION}（期望 V*.*.<三位>，例如 V1.0.001）"
  exit 1
fi
info "当前版本: ${VERSION}"

# ---- 构建前端 ----
if [[ ! -d web ]]; then
  err "web/ 目录不存在"
  exit 1
fi
info "构建前端..."
if [[ ! -d web/node_modules ]]; then
  (cd web && npm install --silent) || { err "web 依赖安装失败"; exit 1; }
fi
(cd web && npm run build) || { err "前端构建失败"; exit 1; }
if [[ ! -d web/dist ]]; then
  err "web/dist 不存在（构建失败？）"
  exit 1
fi
ok "前端构建完成"

# ---- 准备打包 ----
mkdir -p "${ROOT_DIR}/dist"

STAGE="$(mktemp -d)"
PKG="${STAGE}/wxpush"
mkdir -p "${PKG}"
trap 'rm -rf "${STAGE}"' EXIT

# ---- rsync 复制（排除大文件 / 敏感数据 / 构建产物） ----
info "暂存文件到 ${PKG}"
rsync -a \
  --exclude='node_modules' \
  --exclude='web/node_modules' \
  --exclude='data/*.db' \
  --exclude='data/*.db-*' \
  --exclude='data/backups' \
  --exclude='logs' \
  --exclude='.git' \
  --exclude='.DS_Store' \
  --exclude='.trae' \
  --exclude='*.log' \
  --exclude='/dist' \
  --exclude='backups' \
  --exclude='.env' \
  "${ROOT_DIR}/" "${PKG}/"

# 确保关键文件存在
miss=0
for f in go.sh VERSION package.json ecosystem.config.cjs server web/dist; do
  if [[ ! -e "${PKG}/${f}" ]]; then
    err "打包缺失: ${f}"
    miss=1
  fi
done
[[ ${miss} -eq 1 ]] && exit 1

# ---- 打包 ----
OUT="${ROOT_DIR}/dist/wxpush-${VERSION}.tar.gz"
info "压缩 -> ${OUT}"
# COPYFILE_DISABLE=1 避免 macOS xattr 元数据被打入压缩包
# 打包前清除 xattr，防止 Linux 解压时 LIBARCHIVE 警告
xattr -cr "${STAGE}/wxpush" 2>/dev/null || true
COPYFILE_DISABLE=1 tar czf "${OUT}" -C "${STAGE}" wxpush

# ---- 递增版本号 ----
NUM="${VERSION#V}"
MAJOR="${NUM%%.*}"
REST="${NUM#*.}"
MINOR="${REST%%.*}"
PATCH="${REST##*.}"
MAJOR=$((10#${MAJOR}))
MINOR=$((10#${MINOR}))
PATCH=$((10#${PATCH}))
PATCH=$((PATCH + 1))
if [[ ${PATCH} -gt 999 ]]; then
  PATCH=0
  MINOR=$((MINOR + 1))
  if [[ ${MINOR} -gt 999 ]]; then
    MINOR=0
    MAJOR=$((MAJOR + 1))
  fi
fi
NEW_VERSION="V${MAJOR}.${MINOR}.$(printf '%03d' "${PATCH}")"
echo "${NEW_VERSION}" > VERSION

# ---- 结果 ----
SIZE=$(du -h "${OUT}" | cut -f1)
echo ""
echo "==============================================="
ok "打包成功"
echo "  版本:     ${VERSION}"
echo "  压缩包:   ${OUT}"
echo "  大小:     ${SIZE}"
echo "  下一版本: ${NEW_VERSION}（VERSION 已更新）"
echo "==============================================="
echo ""
echo "部署步骤："
echo "  1. 上传 ${OUT} 到服务器"
echo "  2. 服务器解压: tar xzf wxpush-${VERSION}.tar.gz"
echo "  3. 进入目录:   cd wxpush"
echo "  4. 首次部署:   ./go.sh install"
echo "  5. 后续升级:   上传新包到服务器，在安装目录运行 ./go.sh upgrade"
