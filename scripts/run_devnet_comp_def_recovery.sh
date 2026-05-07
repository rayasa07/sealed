#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

: "${RPC_URL:=https://devnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY}"
: "${UPLOAD_BATCH_SIZE:=1}"
: "${MAX_SEND_ATTEMPTS:=10}"
: "${RESTART_DELAY_SECS:=5}"

attempt=1

while true; do
  echo
  echo "=== Recovery attempt ${attempt} @ $(date -Iseconds) ==="
  echo "RPC_URL=${RPC_URL}"
  echo "UPLOAD_BATCH_SIZE=${UPLOAD_BATCH_SIZE}"
  echo "MAX_SEND_ATTEMPTS=${MAX_SEND_ATTEMPTS}"

  if RPC_URL="${RPC_URL}" \
    UPLOAD_BATCH_SIZE="${UPLOAD_BATCH_SIZE}" \
    MAX_SEND_ATTEMPTS="${MAX_SEND_ATTEMPTS}" \
    ./node_modules/.bin/ts-node --transpile-only scripts/init_devnet_comp_def.ts; then
    echo "Recovery completed successfully."
    exit 0
  fi

  echo "Recovery attempt ${attempt} failed. Sleeping ${RESTART_DELAY_SECS}s before resume..."
  sleep "${RESTART_DELAY_SECS}"
  attempt=$((attempt + 1))
done
