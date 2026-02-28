#!/usr/bin/env bash
# Build the PageNode Python backend into a standalone binary using PyInstaller.
# The binary is placed in src-tauri/binaries/ with the Tauri target-triple suffix.
#
# Usage:
#   bash scripts/build_backend.sh
#
# Output:
#   src-tauri/binaries/pagenode-backend-<rust-target>[.exe]
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
BINARIES="$ROOT/src-tauri/binaries"

# ---- Resolve Rust target triple ----
if ! command -v rustc &>/dev/null; then
  echo "[build_backend] ERROR: rustc not found. Install Rust via rustup."
  exit 1
fi
RUST_TARGET=$(rustc -Vv | grep '^host:' | cut -d' ' -f2)
EXT=""
[[ "$RUST_TARGET" == *"windows"* ]] && EXT=".exe"

echo "[build_backend] Platform target: $RUST_TARGET"
mkdir -p "$BINARIES"

# ---- Build venv ----
VENV="$BACKEND/.build_venv"
echo "[build_backend] Creating build venv at $VENV ..."
python3 -m venv "$VENV"

if [[ "$RUST_TARGET" == *"windows"* ]]; then
  PIP="$VENV/Scripts/pip"
  PYINSTALLER="$VENV/Scripts/pyinstaller"
else
  PIP="$VENV/bin/pip"
  PYINSTALLER="$VENV/bin/pyinstaller"
fi

"$PIP" install --upgrade pip pyinstaller --quiet

echo "[build_backend] Installing dependencies ..."
"$PIP" install -r "$BACKEND/requirements-bundle.txt" --quiet

# ---- Run PyInstaller ----
echo "[build_backend] Running PyInstaller ..."
"$PYINSTALLER" \
  "$BACKEND/pagenode.spec" \
  --distpath "$BACKEND/dist" \
  --workpath "$BACKEND/build_tmp" \
  --noconfirm

# ---- Copy with target-triple name ----
SRC="$BACKEND/dist/pagenode-backend${EXT}"
DST="$BINARIES/pagenode-backend-${RUST_TARGET}${EXT}"

if [ ! -f "$SRC" ]; then
  echo "[build_backend] ERROR: PyInstaller output not found at $SRC"
  exit 1
fi

cp "$SRC" "$DST"
chmod +x "$DST"

SIZE=$(du -sh "$DST" | cut -f1)
echo "[build_backend] Done → $DST ($SIZE)"
