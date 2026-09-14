#!/bin/bash
# ============================================================================
# 🐳 KNK Suite — load.sh: desplegar la imagen knk-kali empaquetada
#
# En la CAJA DE DESTINO (no necesita reconstruir nada):
#   bash load.sh knk-kali-latest.tar
#   bash load.sh knk-kali-v2.1-fixed.tar.gz    # .tar o .tar.gz, ambos valen
#
# Qué hace:
#   1. Carga la imagen con docker load
#   2. Comprueba las herramientas con tools-check (compuerta, no consejo)
#   3. Para y recrea el contenedor knk-kali con los volúmenes de la suite
#   4. Verificación final + recordatorio de reiniciar la suite
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")"

CONTAINER="knk-kali"

# ── Docker con o sin `sg docker` ──
DCMD="docker"
if ! docker info >/dev/null 2>&1; then
  if command -v sg >/dev/null 2>&1 && sg docker -c 'docker info >/dev/null 2>&1'; then
    DCMD="sg docker -c docker"
    echo "[*] Docker vía sg (grupo docker)"
  else
    echo "[✗] Docker no disponible ni directo ni vía sg docker" >&2
    exit 1
  fi
fi

TAR_FILE="${1:-}"
[ -z "$TAR_FILE" ] && { echo "Uso: bash load.sh <knk-kali-*.tar[.gz]>" >&2; exit 1; }
[ -f "$TAR_FILE" ] || { echo "[✗] No existe $TAR_FILE" >&2; exit 1; }

echo "════════════════════════════════════════════════════════"
echo " 🐳 Desplegando knk-kali desde $TAR_FILE"
echo "════════════════════════════════════════════════════════"

# ── 1) Cargar la imagen ──
echo "[1/4] Cargando imagen (puede tardar un minuto)…"
case "$TAR_FILE" in
  *.gz) gunzip -c "$TAR_FILE" | $DCMD load ;;
  *)    $DCMD load -i "$TAR_FILE" ;;
esac

# ── 2) Compuerta: las herramientas tienen que estar ──
echo "[2/4] Verificando herramientas dentro de la imagen cargada…"
if ! $DCMD run --rm knk-kali:latest tools-check; then
  echo "[✗] El .tar cargado NO tiene las herramientas completas." >&2
  echo "    No se toca el contenedor actual. Regenera el .tar con ship.sh." >&2
  exit 1
fi

# ── 3) Recrear el contenedor con los volúmenes de la suite ──
echo "[3/4] Recreando el contenedor $CONTAINER…"
$DCMD rm -f "$CONTAINER" >/dev/null 2>&1 || true
$DCMD run -d --name "$CONTAINER" --hostname "$CONTAINER" \
  -v "$(cd .. && pwd)/data:/data" \
  -v "$(cd .. && pwd)/workspace:/workspace" \
  --restart unless-stopped \
  knk-kali:latest \
  /bin/bash -c "echo 'Kali listo. Herramientas:'; which nmap ffuf nuclei subfinder amass whatweb dirb; sleep infinity"

# ── 4) Verificación final en el contenedor real ──
echo "[4/4] Verificación final…"
$DCMD exec "$CONTAINER" tools-check || true

echo ""
echo "[✓] knk-kali desplegado y verificado. Reinicia la suite para conectar la terminal:"
echo "      bash ../start.sh    (o bash ../../start.sh según dónde esté)"
