#!/usr/bin/env bash
set -euo pipefail

# Backup SQLite an toàn bằng API sqlite3.backup(), sau đó nén gzip và xóa file quá hạn.
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="${APP_DIR}/data/mes.db"
BACKUP_DIR="${APP_DIR}/backups"
KEEP_DAYS="${KEEP_DAYS:-30}"

mkdir -p "${BACKUP_DIR}"

if [[ ! -f "${DB_PATH}" ]]; then
  echo "Khong tim thay database: ${DB_PATH}"
  exit 1
fi

STAMP="$(date +%Y%m%d_%H%M%S)"
OUT_PATH="${BACKUP_DIR}/mes_${STAMP}.db"

DB_PATH="${DB_PATH}" OUT_PATH="${OUT_PATH}" python3 - <<'PY'
import os
import sqlite3

src_path = os.environ["DB_PATH"]
out_path = os.environ["OUT_PATH"]

src = sqlite3.connect(src_path)
dst = sqlite3.connect(out_path)
try:
    src.backup(dst)
finally:
    dst.close()
    src.close()
PY

gzip -f "${OUT_PATH}"
find "${BACKUP_DIR}" -name "mes_*.db.gz" -type f -mtime +"${KEEP_DAYS}" -delete

echo "Da backup: ${OUT_PATH}.gz"
