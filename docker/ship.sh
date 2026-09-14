#!/bin/bash
# ============================================================================
# 🐳 KNK Suite — ship.sh: exportar la imagen knk-kali lista para desplegar
#
# Empaqueta la imagen CON las herramientas ya instaladas para que la caja
# de destino NO tenga que reconstruir (ahorra el apt update/install completo
# y evita el fallo clásico de "imagen construida pero sin herramientas").
#
# Uso:
#   bash ship.sh                 # modo por defecto: exporta a ./knk-kali-latest.tar
#   bash ship.sh --tar           # igual que el default
#   bash ship.sh --tar -o /ruta/knk-kali.tar
#   bash ship.sh --push --tag v2.1-fixed   # publica en registry (Docker Hub / GHCR / local)
#
# Requisitos: docker disponible (directo o vía `sg docker`).
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")"

IMAGE="knk-kali"
TAG="${KNK_KALI_TAG:-latest}"
OUT_TAR="knk-kali-${TAG}.tar"

# ── Docker con o sin `sg docker` (el usuario no está en el grupo docker) ──
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

MODE="tar"
PUSH_TAG=""
OUT_OVERRIDE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tar)  MODE="tar"; shift ;;
    --push) MODE="push"; shift ;;
    --tag)  PUSH_TAG="$2"; shift 2 ;;
    -o)     OUT_OVERRIDE="$2"; shift 2 ;;
    *)      echo "Uso: bash ship.sh [--tar] [--push] [--tag TAG] [-o RUTA.tar]" >&2; exit 1 ;;
  esac
done

[ -n "$PUSH_TAG" ] && TAG="$PUSH_TAG"

echo "════════════════════════════════════════════════════════"
echo " 🐳 Empaquetando knk-kali:$TAG"
echo "════════════════════════════════════════════════════════"

# ── 1) Build (o reetiquetar una imagen ya reconstruida) ──
echo "[1/4] Build de la imagen (usa caché si no cambió el Dockerfile)…"
$DCMD build -t "${IMAGE}:${TAG}" -f kali.Dockerfile .

# ── 2) Compuerta de calidad: tools-check DENTRO de la imagen ──
echo "[2/4] Verificando herramientas dentro de la imagen…"
if ! $DCMD run --rm "${IMAGE}:${TAG}" tools-check; then
  echo "[✗] tools-check FALLÓ en knk-kali:$TAG — no se exporta nada." >&2
  echo "    Revisa el Dockerfile: la imagen no está lista para distribuir." >&2
  exit 1
fi

# ── 3) Informe de la imagen ──
SIZE=$($DCMD image inspect "${IMAGE}:${TAG}" --format '{{.Size}}')
echo "[3/4] Imagen lista: knk-kali:$TAG ($(awk "BEGIN{printf \"%.1f\", ${SIZE}/1024/1024/1024}") GB)"

# ── 4) Exportar o publicar ──
if [ "$MODE" = "push" ]; then
  echo "[4/4] Publicando knk-kali:$TAG en el registry configurado…"
  $DCMD push "${IMAGE}:${TAG}"
  echo "[✓] Publicada. En la caja de destino:"
  echo "    docker pull knk-kali:${TAG}"
  echo "    (o con registry:  docker tag knk-kali:${TAG} <registry>/<user>/knk-kali:${TAG} && docker push <registry>/<user>/knk-kali:${TAG})"
else
  [ -n "$OUT_OVERRIDE" ] && OUT_TAR="$OUT_OVERRIDE"
  echo "[4/4] Exportando a $OUT_TAR (comprimido con gzip)…"
  $DCMD save "${IMAGE}:${TAG}" | gzip > "$OUT_TAR"
  FINAL_SIZE=$(du -h "$OUT_TAR" | cut -f1)
  echo "[✓] Exportada: $OUT_TAR ($FINAL_SIZE)"
  echo ""
  echo "    Para desplegar en la caja de destino:"
  echo "      bash load.sh $OUT_TAR"
  echo "    (o a mano: gunzip -c $OUT_TAR | $DCMD load && bash ../start.sh)"
fi
