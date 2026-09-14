#!/usr/bin/env bash
# ============================================================================
# cloudflare-e16-run.sh — Lanzador E16 para Cloudflare AI Playground
#
#   bash backend/cloudflare-e16-run.sh
#
# Flujo:
#   0) Pre-flight: canario (:8210), BiDi (:9344), login check
#   1) E16 driver (N=5 variantes, canary check, ≥50%)
#   2) Resumen de resultados
# ============================================================================
set -u
cd "$(dirname "$0")/.."

SALIDA="evidencia-poc/http/cloudflare-e16/run.log"
mkdir -p "$(dirname "$SALIDA")"
: > "$SALIDA"
log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$SALIDA"; }

log "═══ E16 CLOUDFLARE AI PLAYGROUND ═══"

# ── 0) Pre-flight ──────────────────────────────────────────────────────────
log "[0] Pre-flight..."

# Canary
CANARY_OK=false
if curl -s -m 3 http://127.0.0.1:8210/health >/dev/null 2>&1; then
  log "    ✅ Canary :8210 alive"
  CANARY_OK=true
else
  log "    ⚠️  Canary :8210 down — starting..."
  powershell -NoProfile -Command "Start-Process node -ArgumentList 'backend/canario-ssrf.js' -WindowStyle Hidden" 2>/dev/null
  sleep 3
  if curl -s -m 3 http://127.0.0.1:8210/health >/dev/null 2>&1; then
    log "    ✅ Canary started"
    CANARY_OK=true
  else
    log "    ⛔ Canary failed to start. Aborting."
    exit 2
  fi
fi

# BiDi
BIDI_OK=false
if netstat -ano 2>/dev/null | grep -q ":9344.*LISTENING"; then
  log "    ✅ BiDi :9344 alive"
  BIDI_OK=true
else
  log "    ⚠️  BiDi :9344 down — Firefox needs restart with BiDi"
  log "    Run: firefox -no-remote -profile <profile> -start-debugger-server 9344"
  exit 3
fi

# Firefox
FF_COUNT=$(tasklist 2>/dev/null | grep -c firefox || echo 0)
if [ "$FF_COUNT" -gt 0 ]; then
  log "    ✅ Firefox running ($FF_COUNT processes)"
else
  log "    ⚠️  Firefox not running"
  exit 3
fi

log "    Pre-flight OK. Launching E16 driver..."

# ── 1) E16 Driver ──────────────────────────────────────────────────────────
log "[1] Running E16 driver (N=5)..."
node backend/cloudflare-e16-playground.js 2>&1 | tee -a "$SALIDA"
EC=$?

case $EC in
  0) log "    🎯 HALLAZGO CONFIRMADO (exit 0)" ;;
  1) log "    ❌ Sin hallazgo (exit 1)" ;;
  3) log "    🚨 Señal cross-tenant detectada (exit 3) — CONGELAR" ;;
  20) log "    ⚠️  Login requerido — haz login en Cloudflare y re-lanza" ;;
  21) log "    ⚠️  Account ID no encontrado" ;;
  22) log "    ⚠️  AI Playground no accesible — activa Workers AI primero" ;;
  *) log "    ⛔ Error inesperado (exit $EC)" ;;
esac

# ── 2) Resumen ─────────────────────────────────────────────────────────────
log ""
log "═══ RESUMEN ═══"

RESULT_FILE="evidencia-poc/http/cloudflare-e16/e16-result.json"
if [ -f "$RESULT_FILE" ]; then
  EXITOS=$(node -e "const r=require('./$RESULT_FILE'); console.log(r.exitos||0)")
  TOTAL=$(node -e "const r=require('./$RESULT_FILE'); console.log(r.variantes?.length||0)")
  VEREDICTO=$(node -e "const r=require('./$RESULT_FILE'); console.log(r.veredicto||'unknown')")
  CANARY=$(node -e "const r=require('./$RESULT_FILE'); console.log(r.canarioHits||0)")

  log "    Éxitos: $EXITOS/$TOTAL"
  log "    Canary hits: $CANARY"
  log "    Veredicto: $VEREDICTO"
  log "    Resultados: $RESULT_FILE"
else
  log "    No se encontró archivo de resultados"
fi

log ""
log "═══ FIN ═══"
exit $EC
