#!/usr/bin/env bash
# WxPush 一键部署脚本
# 用法：
#   ./go.sh install             首次部署
#   ./go.sh upgrade [pkg]       升级（默认，可指定压缩包路径）
#   ./go.sh reset-password      交互式重置管理员密码
#   ./go.sh rollback [ver]      回撤到指定备份（默认最近一次）
#   ./go.sh status               查看运行状态
#   ./go.sh --help               帮助
#
# 升级流程：备份（DB/.env/代码） -> 替换代码 -> 依赖 -> 迁移 -> 重启 -> 健康检查
# 失败自动回撤；rollback 命令可手动回撤到任意历史备份。

set -euo pipefail

APP_NAME="wxpush"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${APP_DIR}"
mkdir -p logs

# ---- 颜色 ----
if [[ -t 1 ]]; then
  C_RED='\033[0;31m'; C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_BLUE='\033[0;34m'; C_NC='\033[0m'
else
  C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_NC=''
fi
info()  { echo -e "${C_BLUE}[go]${C_NC} $*"; }
ok()    { echo -e "${C_GREEN}[go]${C_NC} $*"; }
warn()  { echo -e "${C_YELLOW}[go]${C_NC} $*"; }
err()   { echo -e "${C_RED}[go]${C_NC} $*" >&2; }

usage() {
  cat <<EOF
WxPush 一键部署脚本

用法: ./go.sh <command> [args]

命令:
  install              首次部署（检查环境 + 安装依赖 + 构建前端 + 建表 + 启动）
  upgrade [pkg]        升级到当前包版本（备份 + 替换 + 迁移 + 重启；失败自动回撤）
                       pkg 可选，指定 wxpush-*.tar.gz 路径；未指定时自动搜索
  reset-password       交互式重置管理员密码
  rollback [ver]       回撤到指定备份（默认最近一次；ver 为版本号或时间戳片段）
  status               查看运行状态
  --help, help         显示本帮助

默认（无参数）：upgrade

版本号规则：V{major}.{minor}.{patch}，patch 三位 001-999，溢出进位
升级前会自动备份 data/push.db、.env、VERSION 及当前代码到 backups/pre-upgrade-*/
EOF
}

# ---- 生成随机密钥 ----
gen_secret() {
  local bytes=${1:-32}
  node -e "console.log(require('crypto').randomBytes(${bytes}).toString('base64'))"
}

# ---- 加载 .env ----
load_env() {
  if [[ -f .env ]]; then
    set -a
    # shellcheck disable=SC1091
    . .env
    set +a
  fi
}

# ---- 环境检查 ----
check_env() {
  info "环境检查..."
  local missing=()
  command -v node >/dev/null 2>&1 || missing+=("node")
  command -v npm  >/dev/null 2>&1 || missing+=("npm")
  if [[ ${#missing[@]} -gt 0 ]]; then
    err "缺少依赖: ${missing[*]}"
    err "请先安装 Node.js >= 18 (https://nodejs.org/)"
    exit 1
  fi

  local node_major
  node_major=$(node -v | sed 's/v//' | cut -d. -f1)
  if [[ ${node_major} -lt 18 ]]; then
    err "Node 版本过低（需 >=18，当前 $(node -v)）"
    exit 1
  fi

  if ! command -v pm2 >/dev/null 2>&1; then
    warn "未检测到 pm2，尝试全局安装..."
    npm i -g pm2 || { err "pm2 安装失败，请手动执行: npm i -g pm2"; exit 1; }
  fi

  if ! command -v nginx >/dev/null 2>&1; then
    warn "未检测到 nginx（可选，仅用于前端反代）"
  fi

  ok "环境就绪 (node $(node -v), npm $(npm -v), pm2 $(pm2 -v 2>/dev/null))"
}

# ---- 初始化 .env ----
init_env() {
  if [[ -f .env ]]; then
    info ".env 已存在，跳过"
    return 0
  fi
  if [[ ! -f .env.example ]]; then
    err ".env.example 不存在，无法生成 .env"
    exit 1
  fi
  local mk js
  mk=$(gen_secret 32)
  js=$(gen_secret 48)
  sed -e "s|^MASTER_KEY=.*|MASTER_KEY=${mk}|" \
      -e "s|^JWT_SECRET=.*|JWT_SECRET=${js}|" \
      .env.example > .env
  chmod 600 .env
  ok ".env 已生成（MASTER_KEY / JWT_SECRET 已随机填充）"
  warn "请妥善备份 .env（含主密钥，丢失将无法解密已存储的敏感数据）"
}

# ---- 健康检查 ----
# 参数: 最大等待秒数
health_check() {
  local max=${1:-30}
  load_env
  local host="${HOST:-127.0.0.1}"
  local port="${PORT:-8401}"
  local url="http://${host}:${port}/healthz"
  info "健康检查 ${url}（最长等待 ${max}s）"
  local i=0
  while [[ ${i} -lt ${max} ]]; do
    if curl -sf -m 2 "${url}" >/dev/null 2>&1; then
      ok "健康检查通过"
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  err "健康检查超时（${max}s）"
  return 1
}

# ---- 停止服务 ----
stop_app() {
  pm2 stop "${APP_NAME}" 2>/dev/null || true
}

# ---- 重载/启动服务 ----
reload_app() {
  pm2 reload ecosystem.config.cjs --env production 2>/dev/null \
    || pm2 start ecosystem.config.cjs --env production
  pm2 save 2>/dev/null || true
}

# ---- install ----
do_install() {
  info "===== 首次部署 install ====="
  check_env
  init_env

  info "安装后端依赖..."
  npm install --omit=dev || { err "后端依赖安装失败"; exit 1; }

  info "构建前端..."
  if [[ ! -d web/node_modules ]]; then
    (cd web && npm install) || { err "前端依赖安装失败"; exit 1; }
  fi
  (cd web && npm run build) || { err "前端构建失败"; exit 1; }

  info "数据库建表..."
  npm run migrate || { err "建表失败"; exit 1; }

  info "启动 PM2..."
  pm2 start ecosystem.config.cjs --env production || { err "PM2 启动失败"; exit 1; }
  pm2 save

  if ! health_check 30; then
    err "启动后健康检查失败，请查看日志: pm2 logs ${APP_NAME}"
    exit 1
  fi

  echo ""
  ok "===== 部署成功 ====="
  echo ""
  load_env
  local host="${HOST:-127.0.0.1}" port="${PORT:-8401}"
  echo "  服务地址:   http://${host}:${port}/"
  echo "  管理后台:   http://${host}:${port}/admin/  (或 /#/login)"
  echo "  健康检查:   http://${host}:${port}/healthz"
  echo "  PM2 状态:   pm2 status"
  echo "  PM2 日志:   pm2 logs ${APP_NAME}"
  echo ""
  # 检查数据库是否已初始化
  local db_initialized="no"
  if [[ -f data/push.db ]]; then
    local init_val
    init_val=$(node -e "
      const db = require('better-sqlite3')('data/push.db', { readonly: true });
      try { console.log(db.prepare(\"SELECT value FROM settings WHERE key='init_completed'\").get()?.value || '0'); }
      catch { console.log('0'); }
      db.close();
    " 2>/dev/null || echo "0")
    if [[ "${init_val}" == "1" ]]; then
      db_initialized="yes"
    fi
  fi
  if [[ "${db_initialized}" == "yes" ]]; then
    ok "数据库已初始化，可直接登录管理后台"
  else
    echo "首次使用请初始化管理员账号："
    echo "  方式1: 浏览器访问 /#/init"
    echo "  方式2: 运行 ./go.sh reset-password"
  fi
  echo ""
  echo "nginx 配置参考: deploy/nginx.conf.example"
}

# ---- 查找新版本压缩包 ----
find_package() {
  local pkg=$1
  if [[ -n ${pkg} ]]; then
    if [[ ! -f ${pkg} ]]; then
      err "压缩包不存在: ${pkg}"
      exit 1
    fi
    echo "${pkg}"
    return 0
  fi
  # 自动搜索当前目录、/tmp、父目录
  local candidates=()
  for f in ./wxpush-*.tar.gz /tmp/wxpush-*.tar.gz ../wxpush-*.tar.gz; do
    [[ -f ${f} ]] && candidates+=("${f}")
  done
  if [[ ${#candidates[@]} -eq 0 ]]; then
    return 1
  fi
  # 取最新的
  local best="" best_mtime=0
  for f in "${candidates[@]}"; do
    local m
    m=$(stat -c %Y "${f}" 2>/dev/null || stat -f %m "${f}" 2>/dev/null || echo 0)
    if [[ ${m} -gt ${best_mtime} ]]; then
      best=${f}
      best_mtime=${m}
    fi
  done
  echo "${best}"
}

# ---- upgrade ----
# 参数: 可选压缩包路径
do_upgrade() {
  local pkg
  pkg=$(find_package "${1:-}") || {
    err "未找到新版本压缩包 wxpush-*.tar.gz"
    err "请上传压缩包后重试，或指定路径: ./go.sh upgrade /path/to/wxpush-*.tar.gz"
    exit 1
  }
  info "使用新版本包: ${pkg}"

  info "===== 升级 upgrade ====="
  check_env

  local ts version backup_dir
  ts=$(date +%Y%m%d-%H%M%S)
  version=$(cat VERSION 2>/dev/null || echo "unknown")
  backup_dir="backups/pre-upgrade-${ts}-${version}"
  mkdir -p "${backup_dir}"

  # ===== 1. 备份阶段 =====
  info "备份阶段 -> ${backup_dir}"

  # 数据库
  if [[ -f data/push.db ]]; then
    cp -a data/push.db "${backup_dir}/push.db"
    [[ -f data/push.db-wal ]] && cp -a data/push.db-wal "${backup_dir}/" || true
    [[ -f data/push.db-shm ]] && cp -a data/push.db-shm "${backup_dir}/" || true
    ok "已备份数据库"
  else
    warn "未发现 data/push.db（首次升级可忽略）"
  fi

  # .env
  if [[ -f .env ]]; then
    cp -a .env "${backup_dir}/.env"
    ok "已备份 .env"
  fi

  # VERSION
  cp -a VERSION "${backup_dir}/VERSION" 2>/dev/null || true

  # 代码（server + web/dist + ecosystem + package.json + package-lock）
  if tar czf "${backup_dir}/code.tar.gz" \
      server web/dist ecosystem.config.cjs package.json package-lock.json \
      2>/dev/null; then
    ok "已备份代码"
  else
    warn "代码备份部分失败（继续）"
  fi

  ok "备份完成"

  # ===== 2. 替换阶段 =====
  info "替换阶段..."

  stop_app

  local extract_dir="/tmp/wxpush-extract-${ts}"
  rm -rf "${extract_dir}"
  mkdir -p "${extract_dir}"
  info "解压新版本: ${pkg} -> ${extract_dir}"
  if ! tar xzf "${pkg}" -C "${extract_dir}"; then
    err "解压失败，触发回撤"
    do_rollback_internal "${backup_dir}"
    exit 1
  fi

  # 解压后顶层目录可能是 wxpush/ 或直接是文件
  local new_dir="${extract_dir}/wxpush"
  if [[ ! -d ${new_dir} ]]; then
    new_dir="${extract_dir}"
  fi

  info "覆盖代码（保留 .env / data / logs / backups）..."
  # 用 cp -a 替代 rsync（rsync 可能未安装）
  # 先把需要保留的文件临时备份到 /tmp，cp 完再恢复
  local tmp_preserve="/tmp/wxpush-preserve-${ts}"
  rm -rf "${tmp_preserve}"
  mkdir -p "${tmp_preserve}"
  [[ -f .env ]] && cp -a .env "${tmp_preserve}/.env"
  [[ -d data ]] && cp -a data "${tmp_preserve}/data"
  [[ -d logs ]] && cp -a logs "${tmp_preserve}/logs"
  # 用新代码覆盖
  cp -a "${new_dir}/"* . 2>/dev/null || true
  cp -a "${new_dir}/".[!.]* . 2>/dev/null || true
  # 恢复保留的文件
  [[ -f "${tmp_preserve}/.env" ]] && cp -a "${tmp_preserve}/.env" .env
  [[ -d "${tmp_preserve}/data" ]] && rm -rf data && cp -a "${tmp_preserve}/data" data
  [[ -d "${tmp_preserve}/logs" ]] && rm -rf logs && cp -a "${tmp_preserve}/logs" logs
  ok "代码已替换"
  rm -rf "${extract_dir}" "${tmp_preserve}"

  # ===== 3. 依赖 =====
  info "安装/更新后端依赖..."
  if ! npm install --omit=dev; then
    err "依赖安装失败，触发回撤"
    do_rollback_internal "${backup_dir}"
    exit 1
  fi

  # ===== 4. 数据库迁移 =====
  info "数据库迁移..."
  if ! npm run migrate; then
    err "迁移失败，触发回撤"
    do_rollback_internal "${backup_dir}"
    exit 1
  fi

  # ===== 5. 重启 + 健康检查 =====
  info "重启服务..."
  reload_app

  if ! health_check 30; then
    err "升级后健康检查失败，触发回撤"
    do_rollback_internal "${backup_dir}"
    exit 1
  fi

  ok "===== 升级成功 ($(cat VERSION 2>/dev/null)) ====="

  # 清理旧备份
  cleanup_old_backups
}

# ---- 内部回撤（upgrade 失败时调用，或 rollback 复用） ----
# 参数: 备份目录路径
do_rollback_internal() {
  local backup_dir=$1
  err "===== 开始回撤: ${backup_dir} ====="

  # 恢复 .env
  if [[ -f ${backup_dir}/.env ]]; then
    cp -a "${backup_dir}/.env" ./.env
    ok "已恢复 .env"
  fi

  # 恢复数据库
  if [[ -f ${backup_dir}/push.db ]]; then
    mkdir -p data
    cp -a "${backup_dir}/push.db" data/push.db
    [[ -f ${backup_dir}/push.db-wal ]] && cp -a "${backup_dir}/push.db-wal" data/ || true
    [[ -f ${backup_dir}/push.db-shm ]] && cp -a "${backup_dir}/push.db-shm" data/ || true
    ok "已恢复数据库"
  fi

  # 恢复 VERSION
  if [[ -f ${backup_dir}/VERSION ]]; then
    cp -a "${backup_dir}/VERSION" ./VERSION
    ok "已恢复 VERSION"
  fi

  # 恢复代码
  if [[ -f ${backup_dir}/code.tar.gz ]]; then
    info "恢复旧代码..."
    rm -rf server web/dist
    tar xzf "${backup_dir}/code.tar.gz"
    ok "已恢复旧代码"
  fi

  # 重启旧版本
  info "重启服务..."
  reload_app

  if health_check 30; then
    ok "回撤完成，服务已恢复到旧版本"
  else
    err "回撤后健康检查仍失败，请手动检查: pm2 logs ${APP_NAME}"
    err "备份目录: ${backup_dir}"
  fi
}

# ---- rollback（用户主动调用）----
# 参数: 可选版本/时间戳片段
do_rollback() {
  local target="${1:-}"
  info "===== 回撤 rollback ====="

  if [[ ! -d backups ]]; then
    err "无备份目录 backups/"
    exit 1
  fi

  local backups_list=()
  while IFS= read -r line; do
    backups_list+=("${line}")
  done < <(ls -dt backups/pre-upgrade-* 2>/dev/null || true)

  if [[ ${#backups_list[@]} -eq 0 ]]; then
    err "未找到任何升级前备份"
    exit 1
  fi

  local pick=""
  if [[ -z ${target} ]]; then
    pick="${backups_list[0]}"
    info "未指定版本，默认使用最近一次: ${pick}"
  else
    for b in "${backups_list[@]}"; do
      if [[ ${b} == *${target}* ]]; then
        pick=${b}
        break
      fi
    done
    if [[ -z ${pick} ]]; then
      err "未匹配到备份: ${target}"
      info "可用备份:"
      printf '  %s\n' "${backups_list[@]}"
      exit 1
    fi
  fi

  echo "即将回撤到: ${pick}"
  read -r -p "确认继续？(y/N) " ans
  if [[ ! ${ans} =~ ^[Yy]$ ]]; then
    warn "已取消"
    exit 0
  fi

  stop_app
  do_rollback_internal "${pick}"
}

# ---- reset-password ----
do_reset_password() {
  info "===== 重置管理员密码 ====="

  if [[ ! -f server/scripts/reset-admin.js ]]; then
    err "未找到重置脚本 server/scripts/reset-admin.js"
    exit 1
  fi

  # 从数据库检测已有管理员用户名
  local default_user="admin"
  if [[ -f data/push.db ]]; then
    local existing_user
    existing_user=$(node -e "
      const db = require('better-sqlite3')('data/push.db', { readonly: true });
      try {
        const row = db.prepare('SELECT username FROM users ORDER BY id LIMIT 1').get();
        if (row) console.log(row.username);
      } catch {}
      db.close();
    " 2>/dev/null || true)
    if [[ -n "${existing_user}" ]]; then
      default_user="${existing_user}"
    fi
  fi

  local user pass
  read -r -p "用户名（默认 ${default_user}）: " user
  user=${user:-${default_user}}

  while true; do
    read -r -s -p "新密码（≥8 字符，字母+数字）: " pass
    echo ""
    if [[ ${#pass} -lt 8 ]]; then
      warn "密码至少 8 字符"; continue
    fi
    if ! [[ ${pass} =~ [A-Za-z] ]] || ! [[ ${pass} =~ [0-9] ]]; then
      warn "密码必须同时包含字母和数字"; continue
    fi
    local pass2
    read -r -s -p "再次输入: " pass2
    echo ""
    if [[ ${pass} != ${pass2} ]]; then
      warn "两次输入不一致"; continue
    fi
    break
  done

  if npm run reset-admin -- --username="${user}" --password="${pass}"; then
    ok "管理员 ${user} 密码已重置"
  else
    err "重置失败"
    exit 1
  fi
}

# ---- status ----
do_status() {
  info "===== 运行状态 ====="

  echo "--- 版本 ---"
  cat VERSION 2>/dev/null || echo "未知"

  echo ""
  echo "--- PM2 ---"
  if ! pm2 describe "${APP_NAME}" 2>/dev/null; then
    warn "PM2 未运行 ${APP_NAME}"
  fi

  echo ""
  echo "--- 健康检查 ---"
  load_env
  local host="${HOST:-127.0.0.1}" port="${PORT:-8401}"
  local url="http://${host}:${port}/healthz"
  if curl -sf -m 3 "${url}"; then
    echo ""
    ok "服务正常"
  else
    err "健康检查失败 ${url}"
  fi

  echo ""
  echo "--- 备份列表 ---"
  if [[ -d backups ]]; then
    ls -1dt backups/pre-upgrade-* 2>/dev/null | head -10 || echo "无"
  else
    echo "无备份"
  fi
}

# ---- 清理旧备份 ----
cleanup_old_backups() {
  if [[ ! -d backups ]]; then
    return 0
  fi
  find backups -type d -name "pre-upgrade-*" -mtime +30 -exec rm -rf {} + 2>/dev/null || true
  find backups -type d -name "extract-*"      -mtime +7  -exec rm -rf {} + 2>/dev/null || true
  info "已清理 30 天前的升级备份"
}

# ---- 主入口 ----
main() {
  local cmd=${1:-upgrade}
  case "${cmd}" in
    install)         shift; do_install "$@";;
    upgrade)         shift; do_upgrade "$@";;
    reset-password)  do_reset_password;;
    rollback)        shift; do_rollback "$@";;
    status)          do_status;;
    --help|help|-h)  usage;;
    *)
      err "未知命令: ${cmd}"
      echo
      usage
      exit 1
      ;;
  esac
}

main "$@"
