#!/usr/bin/env bash
set -e

# Load nvm so Vite/Node 20+ is available even in non-login shells
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

# DISPLAY/XAUTHORITY 자동 감지: gnome-shell 프로세스 환경에서 추출
if [ -z "$DISPLAY" ] && [ -z "$WAYLAND_DISPLAY" ]; then
  GNOME_PID=$(pgrep -u "$USER" gnome-shell 2>/dev/null | head -1)
  if [ -n "$GNOME_PID" ]; then
    GNOME_ENV=$(cat /proc/"$GNOME_PID"/environ 2>/dev/null | tr '\0' '\n')
    D=$(echo "$GNOME_ENV" | grep '^DISPLAY=' | cut -d= -f2-)
    W=$(echo "$GNOME_ENV" | grep '^WAYLAND_DISPLAY=' | cut -d= -f2-)
    XA=$(echo "$GNOME_ENV" | grep '^XAUTHORITY=' | cut -d= -f2-)
    [ -n "$D" ]  && export DISPLAY="$D"
    [ -n "$W" ]  && export WAYLAND_DISPLAY="$W"
    [ -n "$XA" ] && export XAUTHORITY="$XA"
    echo "[PageNode] Display env from gnome-shell: DISPLAY=$DISPLAY WAYLAND_DISPLAY=$WAYLAND_DISPLAY"
  fi
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
VENV="$BACKEND/.venv/bin/python"

TMPOUT=$(mktemp)

echo "[PageNode] Starting backend (auto port)..."

# stdout을 임시 파일로 리다이렉트 — PORT= 줄이 쓰이길 기다림
# setsid: 독립 세션으로 실행 → npm/tauri 시그널이 백엔드를 죽이지 않도록
setsid "$VENV" "$BACKEND/main.py" >> "$TMPOUT" 2>&1 &
BACKEND_PID=$!

cleanup() {
  echo "[PageNode] Shutting down..."
  kill "$MONITOR_PID" 2>/dev/null || true
  kill "$BACKEND_PID" 2>/dev/null || true
  rm -f "$TMPOUT"
  rm -f "$ROOT/.env.development.local"
}
trap cleanup EXIT INT TERM

# PORT= 줄이 나타날 때까지 폴링 (최대 10초)
BACKEND_PORT=""
for i in $(seq 1 20); do
  BACKEND_PORT=$(grep -oP '(?<=PORT=)\d+' "$TMPOUT" 2>/dev/null | head -n1)
  if [ -n "$BACKEND_PORT" ]; then
    break
  fi
  sleep 0.5
done

if [ -z "$BACKEND_PORT" ]; then
  echo "[PageNode] ERROR: Backend failed to start. Log:"
  cat "$TMPOUT"
  exit 1
fi

echo "[PageNode] Backend detected port $BACKEND_PORT (PID $BACKEND_PID)"

# 백엔드가 실제로 응답하는지 확인 (최대 5초)
echo "[PageNode] Verifying backend health..."
HEALTH_OK=""
for i in $(seq 1 10); do
  if curl -sf "http://127.0.0.1:$BACKEND_PORT/health" > /dev/null 2>&1; then
    HEALTH_OK="1"
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "[PageNode] ERROR: Backend process died! Log:"
    cat "$TMPOUT"
    exit 1
  fi
  sleep 0.5
done

if [ -z "$HEALTH_OK" ]; then
  echo "[PageNode] ERROR: Backend not responding on port $BACKEND_PORT. Log:"
  cat "$TMPOUT"
  exit 1
fi

echo "[PageNode] Backend health verified on port $BACKEND_PORT"

# 백엔드 생존 모니터 (백그라운드)
(
  while sleep 3; do
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
      echo ""
      echo "[PageNode] *** WARNING: Backend (PID $BACKEND_PID) died! ***"
      echo "[PageNode] Backend log:"
      cat "$TMPOUT" 2>/dev/null
      break
    fi
  done
) &
MONITOR_PID=$!

# Vite가 읽을 .env 파일에 포트 기록 (가장 확실한 방법)
ENV_FILE="$ROOT/.env.development.local"
echo "VITE_BACKEND_PORT=$BACKEND_PORT" > "$ENV_FILE"
echo "[PageNode] Wrote VITE_BACKEND_PORT=$BACKEND_PORT to $ENV_FILE"

# 혹시 이전 Vite가 1420에서 돌고 있으면 종료
lsof -ti:1420 2>/dev/null | xargs kill -9 2>/dev/null || true

echo "[PageNode] Starting Tauri dev..."
cd "$ROOT"
export PAGENODE_BACKEND_PORT="$BACKEND_PORT"
export VITE_BACKEND_PORT="$BACKEND_PORT"
npm run tauri dev
