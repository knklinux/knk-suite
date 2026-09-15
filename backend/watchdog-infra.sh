#!/usr/bin/env bash
# ============================================================================
# watchdog-infra.sh — vigilante ligero del canary y el túnel (OpenAI V7)
#
#   bash backend/watchdog-infra.sh                 # bucle cada 15 min
#   bash backend/watchdog-infra.sh --once          # una pasada (tests/CI)
#   WATCHDOG_INTERVAL_MIN=5 bash backend/watchdog-infra.sh
#
# Cada ciclo EJECUTA LAS MISMAS ensure_* que el pre-flight de V7 (source de
# backend/preflight-lib.sh): sondeo barato → si algo está muerto, relanza con
# el mecanismo ya probado (patrón (cmd &) huérfano, muerte SOLO de instancias
# cloudflared propias, fallback DNS 1.1.1.1 + --resolve, --ssl-no-revoke).
#
# Cada intervención queda en el log propio:
#   evidencia-poc/http/watchdog-infra/watchdog-infra.log
#
# Salidas útiles para integración externa:
#   --once imprime "WATCHDOG-RESULT canary=OK|REVIVED|FAIL tunnel=OK|REVIVED|FAIL rc=0|1"
#
# En Windows (consola oculta propia, sobrevive al cierre de la terminal):
#   powershell -Command "Start-Process -FilePath $env:USERPROFILE.watchdog-knk.cmd -WindowStyle Hidden"
#   (el .cmd hace cd al repo y ejecuta bash backend/watchdog-infra.sh)
# Lanza el bucle en background desde una terminal propia o:
#   ( bash backend/watchdog-infra.sh > /dev/null 2>&1 & )
# ============================================================================
set -u
cd "$(dirname "$0")/.."

OUT_DIR="evidencia-poc/http/watchdog-infra"
CANARY_LOG="evidencia-poc/http/canario-ssrf-log.txt"
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/watchdog-infra.log"

INTERVAL_MIN="${WATCHDOG_INTERVAL_MIN:-15}"
case "${1:-}" in
  --once) ONCE=1 ;;
  "")     ONCE=0 ;;
  *) echo "uso: watchdog-infra.sh [--once]" >&2; exit 2 ;;
esac

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG"; }

# Contrato de preflight-lib.sh: log() + OUT_DIR + CANARY_LOG definidos antes
# del source; el prefijo de nonce se deriva del nombre de este script
# (las intervenciones del vigilante quedan marcadas como WATCHDOG-INFRA-*).
# shellcheck source=/dev/null
source "$(dirname "$0")/preflight-lib.sh"

# Ping barato (1 petición local, timeout 2 s) — distinto de ensure_*: el
# ensure hace relanzamiento, el ping solo diagnostica.
canary_alive() {
  local c
  c=$(curl -s -m 2 http://127.0.0.1:8210/hit -o /dev/null -w "%{http_code}" 2>/dev/null || echo "0")
  [ "$c" = "204" ]
}

tunnel_alive() {
  local url code
  url=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$CANARY_LOG" 2>/dev/null | tail -1)
  [ -n "$url" ] || return 1
  code=$(tunnel_hit "$url" "${NONCE_PREFIX}PING")
  [ "$code" = "204" ]
}

run_cycle() {
  log "── ciclo $(date -u +%H:%M:%SZ) ──"
  local C="OK" T="OK"

  if canary_alive; then
    log "canary: OK (sin intervención)"
  else
    log "canary: CAÍDO — invocando ensure_canary"
    if ensure_canary; then C="REVIVED"; else C="FAIL"; fi
  fi

  if tunnel_alive; then
    log "túnel:  OK (sin intervención)"
  else
    log "túnel:  CAÍDO — invocando ensure_tunnel"
    if ensure_tunnel; then T="REVIVED"; else T="FAIL"; fi
  fi

  log "ciclo terminado: canary=$C túnel=$T"
  echo "WATCHDOG-RESULT canary=$C tunnel=$T"
  [ "$C" != "FAIL" ] && [ "$T" != "FAIL" ]
}

if [ "$ONCE" = "1" ]; then
  run_cycle
  exit $?
fi

log "═══════════════════════════════════════════════════"
log "  Watchdog de infraestructura iniciado (cada ${INTERVAL_MIN} min)"
log "  Log: $LOG"
log "═══════════════════════════════════════════════════"
while true; do
  run_cycle || true
  sleep $((INTERVAL_MIN * 60))
done
