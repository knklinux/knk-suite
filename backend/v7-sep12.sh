#!/usr/bin/env bash
# ============================================================================
# v7-sep12.sh — Lanzador V7 (sucesor de v6-sep10.sh)
#
#   bash backend/v7-sep12.sh
#
# Cambios respecto a V6:
#   * Directorio de evidencia PROPIO: evidencia-poc/http/v7-sep12/
#   * Enfriamiento E16 APLICADO (fail-closed): FLAG + <48 h desde el último
#     403 anti-abuso → exit 7 SIN tocar la cola ni gastar la sonda. El E16
#     pedía 24 h; V7 endurece el enfriamiento a 48 h porque el flag demostró
#     no decaer pasivamente (6-sep → 15-sep: ≥9 días con la sonda fallando).
#   * La cola se lanza SOLO con enfriamiento servido o sonda limpia.
#     Válvula de escape consciente: V7_OVERRIDE_COOLING=1 la desactiva.
#
# Se reutiliza íntegro el pre-flight auto-reparador de V6 (mismo orden):
#   1) canary local (:8210) relanzado si está muerto
#   2) túnel cloudflared re-verificado y relanzado si no responde 204
#      (fallback DNS 1.1.1.1 + --resolve, --ssl-no-revoke en schannel)
#   3) BiDi :9344 solo aviso
#   4) enfriamiento E16 (aquí APLICADO a 48 h)
#
# Requisitos (los mismos de V6):
#   - Node en PATH (canary y check de enfriamiento)
#   - tools/cloudflared.exe presente
#   - Firefox + BiDi en :9344 (opcional)
#   - Sesiones OpenAI A/B con tokens vivos
# ============================================================================
set -u
cd "$(dirname "$0")/.."

OUT_DIR="evidencia-poc/http/v7-sep12"
CANARY_LOG="evidencia-poc/http/canario-ssrf-log.txt"
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/v7-sep12.log"
: > "$LOG"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG"; }

log "═══════════════════════════════════════════════════"
log "  V7 — Cola con enfriamiento 48 h aplicado (fail-closed)"
log "═══════════════════════════════════════════════════"

# ── 0) Pre-flight auto-reparador (reutilizado de v6-sep10.sh) ────────────────
log ""
log "=== PRE-FLIGHT (auto-reparador, heredado de V6) ==="

# Date check (V7 pensado para el 12-sep; si se corre antes, solo avisa)
DAY=$(date -u +%d)
MONTH=$(date -u +%m)
log "Fecha actual: $(date -u +%Y-%m-%d) (día $DAY, mes $MONTH)"
if { [ "$MONTH" -lt 9 ] || { [ "$MONTH" -eq 9 ] && [ "$DAY" -lt 12 ]; }; }; then
  log "⚠️  Hoy es antes del 12-sep. Continuando (el enfriamiento de 48 h manda)."
  sleep 2
fi

# ----------------------------------------------------------------------------
# DNS/TLS helpers — idénticos a v6-sep10.sh (mismos fallos de red documentados:
# NXDOMAIN negativo cacheado en Windows y CRYPT_E_REVOCATION_OFFLINE en
# schannel). Cualquier cambio aquí debe hacerse en ambos lanzadores.
# ----------------------------------------------------------------------------
# ----------------------------------------------------------------------------
# Pre-flight auto-reparador: funciones compartidas (preflight-lib.sh), las
# MISMAS que usa el vigilante backend/watchdog-infra.sh. Contrato: log(),
# OUT_DIR y CANARY_LOG ya definidos + cd a la raíz del repo (hecho arriba).
# ----------------------------------------------------------------------------
# shellcheck source=/dev/null
source "$(dirname "$0")/preflight-lib.sh"

ensure_canary || exit 1
ensure_tunnel || exit 1

# Firefox + BiDi — OPCIONAL: app GUI interactiva, no se relanza sola
BIEDI=$(netstat -ano 2>/dev/null | grep ":9344" | grep LISTEN | head -1)
if [ -n "$BIEDI" ]; then
  log "✅ BiDi: vivo (:9344)"
else
  log "⚠️  BiDi no detectado — algunos drivers pueden fallar"
  log "    Relanzar a mano: firefox -no-remote -P default-release -remote-debugging-port 9344"
fi

# ── 1) Enfriamiento E16 APLICADO: >=48 h desde el último 403 anti-abuso ─────
# Fuente: evidencia-poc/http/salud-sesiones-informe.json (ts + antiAbusoActivo
# de la última sonda real). FLAG + <48 h → exit 7 ANTES de la cola: ni gasta
# la sonda de la compuerta ni lanza drivers. CLEAN o >=48 h → cola.
# Válvula de escape consciente: V7_OVERRIDE_COOLING=1 (decisiones de negocio
# tipo "hay ventana con el programa HOY"), queda registrado en el log.
HEALTH_JSON="evidencia-poc/http/salud-sesiones-informe.json"
COOLING_MIN=2880   # 48 h en minutos
OVERRIDE="${V7_OVERRIDE_COOLING:-0}"

log ""
log "=== ENFRIAMIENTO E16 (V7: 48 h, APLICADO) ==="

if [ "$OVERRIDE" = "1" ]; then
  log "🟠 V7_OVERRIDE_COOLING=1 — enfriamiento SALTADO por decisión explícita (queda en el log)"
else
  if [ -f "$HEALTH_JSON" ]; then
    read -r ESTADO VALOR <<< "$(node -e '
      const fs = require("fs");
      try {
        const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const mins = Math.round((Date.now() - Date.parse(j.ts)) / 6e4);
        if (!Number.isFinite(mins)) { console.log("BAD"); }
        else if (!j.antiAbusoActivo) { console.log("CLEAN " + j.ts); }
        else { console.log("FLAG " + mins); }
      } catch { console.log("BAD"); }
    ' "$HEALTH_JSON")"
    case "$ESTADO" in
      CLEAN)
        log "✅ Última sonda anti-abuso limpia ($VALOR) — sin enfriamiento pendiente" ;;
      FLAG)
        if [ "$VALOR" -lt "$COOLING_MIN" ]; then
          REST=$((COOLING_MIN - VALOR))
          log "🚩 Flag anti-abuso activo y último 403 hace $((VALOR/60))h$((VALOR%60))m — faltan ~$((REST/60))h$((REST%60))m para las 48 h"
          log "⛔ ENFRIAMIENTO NO SERVIDO (V7 fail-closed): NO se lanza la cola ni se gasta la sonda (exit 7)"
          log "    Evidencia: $HEALTH_JSON · Relanzar cuando VALOR >= $COOLING_MIN o con V7_OVERRIDE_COOLING=1"
          exit 7
        else
          log "✅ Enfriamiento V7 cumplido: $((VALOR/60))h desde el último 403 (>=48 h)"
        fi ;;
      *)
        log "⚠️  Informe de salud ilegible — enfriamiento no verificable"
        log "    V7 NO lanza la cola sin verificación (fail-closed). Ejecuta ab-salud-sesiones.js o usa V7_OVERRIDE_COOLING=1"
        exit 7 ;;
    esac
  else
    log "⚠️  Sin $HEALTH_JSON — enfriamiento no verificable"
    log "    V7 NO lanza la cola sin verificación (fail-closed). Ejecuta ab-salud-sesiones.js o usa V7_OVERRIDE_COOLING=1"
    exit 7
  fi
fi

# ── 2) Ejecutar la cola ──────────────────────────────────────────────────────
log ""
log "=== LANZANDO COLA ==="
log "Copiando resultado de la secuencia..."

bash backend/secuencia-post-enfriamiento.sh 2>&1 | tee -a "$LOG"
RC=$?

log ""
log "=== RESUMEN V7 ==="
log "Exit code de la cola: $RC"
case $RC in
  0) log "✅ Cola completada — revisar evidencia en evidencia-poc/http/ y $OUT_DIR/" ;;
  4) log "🚩 Flag anti-abuso activo — cola auto-saltada pese al pre-check (respetar las 48 h)" ;;
  2) log "⛔ Sesiones caducadas — re-login A/B necesario" ;;
  *) log "⚠️  Exit inesperado: $RC" ;;
esac

# Copia de resultados al directorio propio de V7
for f in secuencia-post-enfriamiento.log safetybb-esc1-resultado.json \
         ssrf-retest-resultado.json v8-revocacion-resultado.json \
         huecos-owasp-resultado.json; do
  cp "evidencia-poc/http/$f" "$OUT_DIR/" 2>/dev/null
done

log "Evidencia copiada a $OUT_DIR/"
log "═══ V7 COMPLETADO ═══"
