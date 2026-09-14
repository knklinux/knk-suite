#!/usr/bin/env bash
# ============================================================================
# v6-sep10.sh — Lanzador V6 para el 10 de septiembre 2026
#
#   bash backend/v6-sep10.sh
#
# Qué hace:
#   1) Verifica la fecha (debe ser >= 10-sep)
#   2) Verifica canario local (:8210) + tunnel cloudflared
#   3) Verifica Firefox + BiDi (:9344)
#   4) Lanza la cola completa: sonda → E16 → E17 → E18 → H1-H3
#   5) Guarda todo en evidencia-poc/http/v6-sep10/
#
# Requisitos:
#   - Canary local corriendo en :8210
#   - Cloudflared tunnel vivo (URL en canario-ssrf-log.txt)
#   - Firefox con BiDi en :9344 (para drivers que lo necesiten)
#   - Sesiones OpenAI A/B con tokens vivos
# ============================================================================
set -u
cd "$(dirname "$0")/.."

OUT_DIR="evidencia-poc/http/v6-sep10"
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/v6-sep10.log"
: > "$LOG"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG"; }

log "═══════════════════════════════════════════════════"
log "  V6 — Cola post-enfriamiento 10-sep-2026"
log "═══════════════════════════════════════════════════"

# ── 0) Pre-flight checks ──────────────────────────────────────────────────
log ""
log "=== PRE-FLIGHT ==="

# Date check
DAY=$(date -u +%d)
MONTH=$(date -u +%m)
log "Fecha actual: $(date -u +%Y-%m-%d) (día $DAY, mes $MONTH)"
if [ "$MONTH" -lt 9 ] || { [ "$MONTH" -eq 9 ] && [ "$DAY" -lt 10 ]; }; then
  log "⚠️  Hoy es antes del 10-sep. ¿Quieres ejecutar de todas formas? (Ctrl+C para abortar)"
  sleep 5
fi

# Canary local
CANARY_CODE=$(curl -s -m 4 http://127.0.0.1:8210/hit -o /dev/null -w "%{http_code}" 2>/dev/null || echo "0")
if [ "$CANARY_CODE" = "204" ]; then
  log "✅ Canary local: vivo (204)"
else
  log "❌ Canary local: muerto ($CANARY_CODE) — relanzar: node backend/canario-ssrf.js"
  exit 1
fi

# Tunnel
TUNEL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" evidencia-poc/http/canario-ssrf-log.txt 2>/dev/null | tail -1)
if [ -n "$TUNEL" ]; then
  TUNEL_CODE=$(curl -s -m 8 "$TUNEL/hit" -o /dev/null -w "%{http_code}" 2>/dev/null || echo "0")
  if [ "$TUNEL_CODE" = "204" ]; then
    log "✅ Túnel: $TUNEL (204)"
  else
    log "⚠️  Túnel URL existe pero no responde ($TUNEL_CODE) — puede haber muerto"
    log "    Relanzar: tools/cloudflared.exe tunnel --url http://127.0.0.1:8210 --no-autoupdate"
  fi
else
  log "❌ Sin túnel — relanzar cloudflared"
  log "    tools/cloudflared.exe tunnel --url http://127.0.0.1:8210 --no-autoupdate"
  exit 1
fi

# Firefox + BiDi
BIEDI=$(netstat -ano 2>/dev/null | grep ":9344" | grep LISTEN | head -1)
if [ -n "$BIEDI" ]; then
  log "✅ BiDi: vivo (:9344)"
else
  log "⚠️  BiDi no detectado — algunos drivers pueden fallar"
  log "    Relanzar: firefox -no-remote -P default-release -remote-debugging-port 9344"
fi

# ── 1) Ejecutar la cola ───────────────────────────────────────────────────
log ""
log "=== LANZANDO COLA ==="
log "Copiando resultado de la secuencia..."

# Run the existing secuencia script
bash backend/secuencia-post-enfriamiento.sh 2>&1 | tee -a "$LOG"
RC=$?

log ""
log "=== RESUMEN V6 ==="
log "Exit code de la cola: $RC"
case $RC in
  0) log "✅ Cola completada — revisar evidencia en evidencia-poc/http/" ;;
  4) log "🚩 Flag anti-abuso activo — cola auto-saltada. Reintentar en 48h (V7 = 12-sep)" ;;
  2) log "⛔ Sesiones caducadas — re-login A/B necesario" ;;
  *) log "⚠️  Exit inesperado: $RC" ;;
esac

# Copy results to v6 directory
cp evidencia-poc/http/secuencia-post-enfriamiento.log "$OUT_DIR/" 2>/dev/null
cp evidencia-poc/http/safetybb-esc1-resultado.json "$OUT_DIR/" 2>/dev/null
cp evidencia-poc/http/ssrf-retest-resultado.json "$OUT_DIR/" 2>/dev/null
cp evidencia-poc/http/v8-revocacion-resultado.json "$OUT_DIR/" 2>/dev/null
cp evidencia-poc/http/huecos-owasp-resultado.json "$OUT_DIR/" 2>/dev/null

log "Evidencia copiada a $OUT_DIR/"
log "═══ V6 COMPLETADO ═══"
