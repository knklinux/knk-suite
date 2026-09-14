#!/usr/bin/env bash
# ============================================================================
# sync-desktop-bundle.sh — refresca el bundle de la app de escritorio
#
# La app de escritorio (knklinux-desktop.exe) no ejecuta el backend del repo:
# arranca una COPIA que Tauri deja en src-tauri/target/release/backend/ y sirve
# src-tauri/target/release/frontend/dist/. Por eso un cambio en backend/ o en el
# frontend no aparece en la app hasta recompilar (npm run tauri:build) o hasta
# copiar los artefactos con este script.
#
# Uso:
#   bash scripts/sync-desktop-bundle.sh
#   (después, cierra y vuelve a abrir la app de escritorio)
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/src-tauri/target/release"

if [ ! -d "$DEST" ]; then
  echo "[!] No existe $DEST"
  echo "    Compila primero:  npm run tauri:build"
  exit 1
fi

if [ ! -f "$ROOT/frontend/dist/index.html" ]; then
  echo "[!] Falta el build del frontend. Ejecuta:  npm run build"
  exit 1
fi

echo "[1/2] backend/  →  ${DEST#$ROOT/}/backend/"
mkdir -p "$DEST/backend"
cp -R "$ROOT/backend/." "$DEST/backend/"
# los logs locales no forman parte del bundle
find "$DEST/backend" -maxdepth 1 -name '*.log' -delete 2>/dev/null || true

echo "[2/2] frontend/dist/  →  ${DEST#$ROOT/}/frontend/dist/"
rm -rf "$DEST/frontend/dist"
mkdir -p "$DEST/frontend/dist"
cp -R "$ROOT/frontend/dist/." "$DEST/frontend/dist/"

echo ""
echo "✅ Bundle sincronizado."
echo "   Cierra y vuelve a abrir la app de escritorio (o mata el node de :8086 y"
echo "   lanza el .exe) para que arranque el backend nuevo."
