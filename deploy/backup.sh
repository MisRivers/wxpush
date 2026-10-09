#!/usr/bin/env bash
# WxPush 数据库与配置备份脚本
# 用法：
#   ./deploy/backup.sh [output_dir]
# 推荐 crontab：每天凌晨 3 点备份
#   0 3 * * * /path/to/WxPush/deploy/backup.sh /var/backups/wxpush >> /var/log/wxpush-backup.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-${SCRIPT_DIR}/data/backups}"
DB_PATH="${DB_PATH:-${SCRIPT_DIR}/data/push.db}"
ENV_FILE="${SCRIPT_DIR}/.env"
RETAIN_DAYS=14

mkdir -p "${OUT_DIR}"
TS=$(date +%Y%m%d-%H%M%S)
OUT_FILE="${OUT_DIR}/push-${TS}.db"

if [[ ! -f "${DB_PATH}" ]]; then
  echo "[error] db not found: ${DB_PATH}" >&2
  exit 1
fi

# 使用 sqlite3 CLI 备份（无需停止服务，WAL 模式下安全）
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "${DB_PATH}" ".backup '${OUT_FILE}'"
else
  # 退化为 cp（要求 WAL 已 checkpoint，否则可能丢未刷盘数据）
  cp "${DB_PATH}" "${OUT_FILE}"
fi

# 同时备份 .env（含 MASTER_KEY，权限收紧）
if [[ -f "${ENV_FILE}" ]]; then
  cp "${ENV_FILE}" "${OUT_DIR}/.env-${TS}"
  chmod 600 "${OUT_DIR}/.env-${TS}"
fi

# 压缩
gzip -f "${OUT_FILE}"
[[ -f "${OUT_DIR}/.env-${TS}" ]] && gzip -f "${OUT_DIR}/.env-${TS}"

# 清理旧备份
find "${OUT_DIR}" -type f \( -name "push-*.db.gz" -o -name ".env-*" \) -mtime "+${RETAIN_DAYS}" -delete

echo "[ok] backup: ${OUT_FILE}.gz"
