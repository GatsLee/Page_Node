#!/usr/bin/env bash
# Full production build: Python backend → Tauri bundle.
#
# Usage:
#   bash scripts/build.sh
#
# Output (Linux):
#   src-tauri/target/release/bundle/deb/pagenode_*.deb
#   src-tauri/target/release/bundle/appimage/pagenode_*.AppImage
set -e

# Load nvm so Node 20+ is available
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "[build] ============================================"
echo "[build] PageNode — Production Build"
echo "[build] ============================================"

# Step 1: Build Python backend binary
echo "[build] Step 1/2: Building backend sidecar..."
bash "$ROOT/scripts/build_backend.sh"

# Step 2: Tauri bundle (builds frontend + Rust + packages)
echo "[build] Step 2/2: Running cargo tauri build..."
cd "$ROOT"
npm run tauri build

echo "[build] ============================================"
echo "[build] Build complete."
echo "[build] Bundles are in: src-tauri/target/release/bundle/"
echo "[build] ============================================"
