#!/usr/bin/env bash
# ============================================================================
# secuencia-post-enfriamiento.sh — Cola del día siguiente tras el enfriamiento
# de la cuenta A (política E16: >=24 h sin tocar /conversation).
#
#   bash backend/secuencia-post-enfriamiento.sh
#
# Qué hace, en orden estricto, parando en el primer bloqueo:
#   0) Compuerta de salud A/B (4 peticiones rate-limited)
#   1) SONDA de anti-abuso: 1 única petición a /conversation con A
#      - 200/4xx-no-403 → enfriamiento pasado, continuar
#      - 403 "Unusual activity" → PARAR sin más peticiones (exit 4)
#   2) E16 — Safety BB escenario 1 (inyección indirecta, N=5 variantes)
#      requiere colector en :8203 (lo arranca el driver si falta)
#   3) E17 — Re-test SSRF (V-ssrf-1 con sesión A + canario; requiere túnel)
#   4) E18 — V8 revocación de share (flujo A/B completo vs baseline de B)
#   5) HUECOS OWASP — 3 huecos de la guía OWASP LLM (H1 IDOR de conversation,
#      H2 metadatos RAG, H3 model swap): 6 peticiones exactas, auto-salteo si
#      el flag reaparece. Detalle: backend/ab-huecos-owasp.js
#
# Reglas de la cola: cada driver ya trae compuerta + backoff automático
# (15s/30s/60s + exit 4). Entre drivers: pausa >= 60 s para que la actividad
# parezca manual. Nada re-intenta un bloqueo. Todo queda en evidencia-poc/http/.
# ============================================================================
set -u
cd "$(dirname "$0")/.."   # raíz de knk-suite

PAUSA_ENTRE_DRIVERS=60
SALIDA="evidencia-poc/http/secuencia-post-enfriamiento.log"
: > "$SALIDA"
log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$SALIDA"; }

log "═══ SECUENCIA POST-ENFRIAMIENTO ═══"

# ── 0) Compuerta de salud ──────────────────────────────────────────────────
log "[0] compuerta de salud A/B..."
if node backend/ab-salud-sesiones.js --quiet >> "$SALIDA" 2>&1; then
  log "    ✅ salud OK"
else
  log "    ⛔ salud FALLÓ (exit $?) — sesiones caducadas: re-login A/B antes de relanzar. PARADA."
  exit 2
fi

# ── 1) SONDA anti-abuso (integrada en la compuerta: check 5) ────────────────
# Ahora la sonda vive DENTRO del health gate (--con-ant-abuso, check 5):
# mismas 4 peticiones de siempre + 1 sonda a /conversation sin reintentos.
log "[1] sonda anti-abuso vía compuerta de salud (--con-ant-abuso)..."
node backend/ab-salud-sesiones.js --con-ant-abuso >> "$SALIDA" 2>&1
EC=$?
case $EC in
  0) log "    ✅ salud OK y /conversation LIBRE — lanzando cola" ;;
  4) log "    🚩 sesiones sanas pero flag anti-abuso ACTIVO en /conversation (exit 4)."
     log "       Política E16: nada se lanza hoy. Esperar >=24 h más y relanzar."
     exit 4 ;;
  *) log "    ⛔ salud FALLÓ (exit $EC) — sesiones caducadas: re-login A/B antes de relanzar. PARADA."
     exit 2 ;;
esac

# ── 2) E16 — Safety BB escenario 1 ─────────────────────────────────────────
log "[2] E16: Safety BB escenario 1 (inyección indirecta, N=5)..."
node backend/ab-safetybb-injection.js >> "$SALIDA" 2>&1
RC16=$?
log "    exit=$RC16 ($([ $RC16 -eq 0 ] && echo 'completado' || echo 'ver evidencia-poc/http/safetybb-esc1-resultado.json'))"
[ $RC16 -eq 4 ] && { log "    ⛔ flag activo de nuevo — PARADA total de la cola."; exit 4; }
log "    pausa ${PAUSA_ENTRE_DRIVERS}s antes del siguiente driver..."
sleep $PAUSA_ENTRE_DRIVERS

# ── 3) E17 — Re-test SSRF (solo si hay túnel de canario) ───────────────────
log "[3] E17: re-test SSRF con canario..."
TUNEL=$(grep -oE "https://[a-z-]+\.trycloudflare\.com" evidencia-poc/http/canario-ssrf-log.txt 2>/dev/null | tail -1)
if [ -z "$TUNEL" ]; then
  log "    no hay túnel vivo — remontando quick tunnel de cloudflared..."
  (./tools/cloudflared.exe tunnel --url http://127.0.0.1:8210 --no-autoupdate >> evidencia-poc/http/canario-ssrf-log.txt 2>&1 &) 
  sleep 12
  TUNEL=$(grep -oE "https://[a-z-]+\.trycloudflare\.com" evidencia-poc/http/canario-ssrf-log.txt 2>/dev/null | tail -1)
fi
if [ -n "$TUNEL" ]; then
  log "    túnel: $TUNEL"
  CANARIO_BASE="$TUNEL" node backend/retest-ssrf-302.js >> "$SALIDA" 2>&1
  RC17=$?
else
  log "    ⚠️ sin túnel — lanzando solo la parte API (V-ssrf-3, sin canario)"
  node backend/retest-ssrf-302.js >> "$SALIDA" 2>&1
  RC17=$?
fi
log "    exit=$RC17"
[ $RC17 -eq 4 ] && { log "    ⛔ flag activo de nuevo — PARADA total de la cola."; exit 4; }
log "    pausa ${PAUSA_ENTRE_DRIVERS}s antes del siguiente driver..."
sleep $PAUSA_ENTRE_DRIVERS

# ── 4) E18 — V8 revocación de share (flujo A/B completo) ───────────────────
log "[4] E18: V8 revocación de share (A crea → revoca → B re-accede vs baseline)..."
node backend/ab-v8-revocacion-share.js >> "$SALIDA" 2>&1
RC18=$?
log "    exit=$RC18"


# ── 5) HUECOS OWASP — paquete de 6 peticiones (IDOR conv + RAG metadata + model swap) ──
log "    pausa ${PAUSA_ENTRE_DRIVERS}s antes de los huecos OWASP..."
sleep $PAUSA_ENTRE_DRIVERS
log "[5] huecos OWASP (H1 IDOR conversation / H2 RAG metadata / H3 model swap)..."
node backend/ab-huecos-owasp.js >> "$SALIDA" 2>&1
RCH=$?
log "    exit=$RCH ($([ $RCH -eq 0 ] && echo 'ejecutado — ver huecos-owasp-resultado.json' || ([ $RCH -eq 4 ] && echo 'flag activo — auto-salteado' || echo 'error')))"

# ── Resumen (actualizado) ──────────────────────────────────────────────────
log "═══ RESUMEN DE LA COLA ═══"
log "  E16 (safetybb): exit $RC16"
log "  E17 (ssrf):     exit $RC17"
log "  E18 (v8 share): exit $RC18"
log "  Huecos OWASP:   exit $RCH"
log "Evidencia: evidencia-poc/http/{safetybb-esc1-resultado.json, ssrf-retest-resultado.json, v8-revocacion-resultado.json, huecos-owasp-resultado.json}"
