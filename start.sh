#!/usr/bin/env bash
set -euo pipefail

# Script chạy nhanh server trên Ubuntu/Linux khi không dùng systemd.
cd "$(dirname "$0")"
exec python3 -m uvicorn main:app --host 0.0.0.0 --port 8000
