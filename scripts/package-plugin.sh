#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/release"
STAGING_DIR="$OUT_DIR/16x10-fixes"
ZIP_PATH="$OUT_DIR/16x10-fixes.zip"

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR/defaults"

cp -R "$ROOT_DIR/dist" "$STAGING_DIR/dist"
cp "$ROOT_DIR/main.py" "$STAGING_DIR/main.py"
cp "$ROOT_DIR/package.json" "$STAGING_DIR/package.json"
cp "$ROOT_DIR/plugin.json" "$STAGING_DIR/plugin.json"
cp "$ROOT_DIR/README.md" "$STAGING_DIR/README.md"
cp "$ROOT_DIR/defaults/catalog.json" "$STAGING_DIR/defaults/catalog.json"

rm -f "$ZIP_PATH"
(
  cd "$OUT_DIR"
  zip -qr "$(basename "$ZIP_PATH")" "$(basename "$STAGING_DIR")"
)

printf 'Created %s\n' "$ZIP_PATH"
