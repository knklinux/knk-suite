#!/usr/bin/env bash
# ============================================================================
# v6-sep10.sh — Lanzador V6 para el 10 de septiembre 2026
#
#   bash backend/v6-sep10.sh
#
# Qué hace:
#   1) Verifica la fecha (debe ser >= 10-sep)
#   2) ASEGURA infraestructura (relanza lo que esté muerto):
#        - canary local (:8210)      → node backend/canario-ssrf.js
#        - tunnel cloudflared        → tools/cloudflared.exe tunnel
#          (la URL nueva se registra en evidencia-poc/http/canario-ssrf-log.txt,
#           el registro que leen el resto de fases y los relanzamientos)
#   3) Verifica Firefox + BiDi (:9344) — solo aviso (es opcional e interactivo)
#   4) AVISO de enfriamiento E16: si la última sonda dio 403 y hace <24 h,
#      lo dice ANTES de gastar otra sonda en la compuerta de la cola
#   5) Lanza la cola completa: sonda → E16 → E17 → E18 → H1-H3
#   6) Guarda todo en evidencia-poc/http/v6-sep10/
#
# Requisitos:
#   - Node en PATH (para el canary)
#   - tools/cloudflared.exe presente
#   - Firefox + BiDi en :9344 (opcional, para drivers que lo necesiten)
#   - Sesiones OpenAI A/B con tokens vivos
# ============================================================================
set -u
cd "$(dirname "$0")/.."

OUT_DIR="evidencia-poc/http/v6-sep10"
CANARY_LOG="evidencia-poc/http/canario-ssrf-log.txt"
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

# ----------------------------------------------------------------------------
# DNS: el router local (Livebox 192.168.1.1) ha dado NXDOMAIN/timeout con
# hostnames trycloudflare recién creados aunque el registro ya existe en el
# DNS autoritativo de Cloudflare (verificado contra 1.1.1.1). resolve_via_dns
# consulta un servidor concreto y tunnel_hit hace fallback con --resolve.
# ----------------------------------------------------------------------------
resolve_via_dns() {  # $1=host  $2=servidor DNS  → imprime la 1ª IPv4 ajena al server
  nslookup "$1" "$2" 2>/dev/null \
    | grep -oE "([0-9]{1,3}\.){3}[0-9]{1,3}" \
    | grep -v "$2" \
    | head -1
}

# TLS: el schannel de Windows comprueba revocación (CRL/OCSP) y si esos
# servidores no alcanzan, TODO curl https muere con exit 35 aunque la red
# esté bien. --ssl-no-revoke lo desactiva (existe solo en builds schannel:
# se detecta una vez; en otros builds queda vacío y no molesta).
CURL_TLS=()
if curl --help all 2>/dev/null | grep -q -- "--ssl-no-revoke"; then
  CURL_TLS=(--ssl-no-revoke)
fi

tunnel_hit() {  # $1=url base  $2=nonce  → imprime http_code (0000 si no hay manera)
  local url="$1" nonce="$2" code host ip
  code=$(curl -s -m 8 "${CURL_TLS[@]}" "$url/hit?nonce=$nonce" -o /dev/null -w "%{http_code}" 2>/dev/null || echo "0")
  [ "$code" = "204" ] && { echo "$code"; return 0; }
  # fallback: el caché DNS de Windows guarda el NXDOMAIN de hostnames
  # trycloudflare recién creados (curl/node ENOTFOUND aunque nslookup
  # resuelva) → resolvemos vía 1.1.1.1 y fijamos la IP con --resolve,
  # que esquiva el caché del SO por completo.
  host=$(printf '%s' "$url" | sed -E 's#https://([^/]+)/.*#\1#')
  ip=$(resolve_via_dns "$host" "1.1.1.1")
  if [ -n "$ip" ]; then
    log "    (DNS local no resuelve $host — fallback 1.1.1.1 → $ip)"
    code=$(curl -s -m 8 "${CURL_TLS[@]}" --resolve "$host:443:$ip" "$url/hit?nonce=$nonce" -o /dev/null -w "%{http_code}" 2>/dev/null || echo "0")
  fi
  echo "$code"
}

# ----------------------------------------------------------------------------
# ensure_canary — el canary SIEMPRE termina vivo (o aborta el lanzamiento)
#
#   vivo  → ✅ y fuera
#   muerto → se relanza en background con el patrón (cmd &) — el subshell
#   muere y node queda huérfano del script, vivo tras la salida (mismo
#   patrón con el que se arrancó a mano el 14-sep y sobrevivió al cierre).
# ----------------------------------------------------------------------------
ensure_canary() {
  local code
  code=$(curl -s -m 4 http://127.0.0.1:8210/hit -o /dev/null -w "%{http_code}" 2>/dev/null || echo "0")
  if [ "$code" = "204" ]; then
    log "✅ Canary local: vivo (204)"
    return 0
  fi
  log "⚠️  Canary local muerto ($code) — RELANZANDO..."
  log "    cmd: node backend/canario-ssrf.js"
  ( node backend/canario-ssrf.js > "$OUT_DIR/canario-relaunch-stdout.log" 2>&1 & )
  local i=0
  while [ $i -lt 20 ]; do   # hasta ~10 s
    sleep 1
    i=$((i+1))
    code=$(curl -s -m 2 http://127.0.0.1:8210/hit -o /dev/null -w "%{http_code}" 2>/dev/null || echo "0")
    if [ "$code" = "204" ]; then
      log "✅ Canary relanzado y vivo (204) tras ${i}s"
      return 0
    fi
  done
  log "❌ Canary no levantó tras el relanzamiento — ver $OUT_DIR/canario-relaunch-stdout.log"
  return 1
}

# ----------------------------------------------------------------------------
# ensure_tunnel — el túnel cloudflared SIEMPRE termina vivo (o aborta)
#
#   1) Si la URL registrada responde 204 → ✅ fuera.
#   2) Si no: se matan SOLO las instancias cloudflared cuyo comando apunta a
#      nuestro :8210 (nunca un cloudflared ajeno), se relanza un quick tunnel
#      y se espera la URL nueva (los quick tunnels tardan ~5-20 s).
#   3) La URL nueva se AÑADE al log del canary (registro histórico y fuente
#      de la URL vigente) y se verifica E2E con reintentos: el quick tunnel
#      se anuncia antes de terminar de conectar, y el DNS local puede tardar
#      más que el edge (tunnel_hit usa fallback 1.1.1.1 + --resolve).
# ----------------------------------------------------------------------------
ensure_tunnel() {
  local TUNEL code
  TUNEL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$CANARY_LOG" 2>/dev/null | tail -1)
  if [ -n "$TUNEL" ]; then
    code=$(tunnel_hit "$TUNEL" "V6-TUNNEL-CHECK")
    if [ "$code" = "204" ]; then
      log "✅ Túnel: $TUNEL (204)"
      return 0
    fi
    log "⚠️  Túnel $TUNEL no responde ($code) — RELANZANDO cloudflared..."
  else
    log "⚠️  Sin URL de túnel registrada — RELANZANDO cloudflared..."
  fi

  if [ ! -x "tools/cloudflared.exe" ]; then
    log "❌ tools/cloudflared.exe no existe o no es ejecutable"
    return 1
  fi

  # matar solo NUESTRAS instancias (CommandLine con 8210 = el target del canary)
  powershell -NoProfile -NonInteractive -Command \
    "Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | Where-Object { \$_.CommandLine -match '8210' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force; Write-Output ('killed ' + \$_.ProcessId) }" \
    > "$OUT_DIR/cloudflared-kill.log" 2>&1
  if [ -s "$OUT_DIR/cloudflared-kill.log" ]; then
    log "    instancias viejas terminadas: $(tr '\n' ' ' < "$OUT_DIR/cloudflared-kill.log")"
  fi

  log "    cmd: tools/cloudflared.exe tunnel --url http://127.0.0.1:8210 --no-autoupdate"
  ( tools/cloudflared.exe tunnel --url http://127.0.0.1:8210 --no-autoupdate \
      > "$OUT_DIR/cloudflared-relaunch-stdout.log" 2>&1 & )

  local NEW_URL="" i=0
  while [ $i -lt 45 ]; do   # hasta ~45 s (quick tunnel estable ~5-20 s)
    sleep 1
    i=$((i+1))
    NEW_URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" \
      "$OUT_DIR/cloudflared-relaunch-stdout.log" 2>/dev/null | head -1)
    [ -n "$NEW_URL" ] && break
  done
  if [ -z "$NEW_URL" ]; then
    log "❌ cloudflared no dio URL en 45 s — ver $OUT_DIR/cloudflared-relaunch-stdout.log"
    return 1
  fi

  # registro: línea de URL pelada al final del log del canary (convención
  # que ya leen las demás fases y los relanzamientos futuros)
  printf '%s\n' "$NEW_URL" >> "$CANARY_LOG"
  log "    URL nueva registrada en $CANARY_LOG: $NEW_URL"

  # verificación E2E con reintentos (~40 s): el golpe entra por el borde de
  # Cloudflare, baja al canary y éste lo registra (evidencia en su log)
  i=0
  while [ $i -lt 8 ]; do
    sleep 5
    i=$((i+1))
    code=$(tunnel_hit "$NEW_URL" "V6-TUNNEL-RELAUNCH")
    if [ "$code" = "204" ]; then
      log "✅ Túnel relanzado y verificado E2E: $NEW_URL (204, intento $i)"
      return 0
    fi
  done
  log "❌ Túnel $NEW_URL sin respuesta en 40 s de reintentos (último: $code)"
  log "    cola del log de cloudflared:"
  tail -5 "$OUT_DIR/cloudflared-relaunch-stdout.log" | while IFS= read -r l; do log "    | $l"; done
  return 1
}

ensure_canary || exit 1
ensure_tunnel || exit 1

# Firefox + BiDi — OPCIONAL: es una app GUI interactiva, no se relanza sola
BIEDI=$(netstat -ano 2>/dev/null | grep ":9344" | grep LISTEN | head -1)
if [ -n "$BIEDI" ]; then
  log "✅ BiDi: vivo (:9344)"
else
  log "⚠️  BiDi no detectado — algunos drivers pueden fallar"
  log "    Relanzar a mano: firefox -no-remote -P default-release -remote-debugging-port 9344"
fi

# ── 1) Enfriamiento E16: >=24 h desde el último 403 anti-abuso ───────────
# La última sonda real deja ts + antiAbusoActivo en salud-sesiones-informe.json.
# FLAG activo y <24 h → AVISO (no bloquea): la compuerta de la cola repetirá
# la sonda y auto-salteará (exit 4) si el flag sigue activo; este aviso evita
# gastar esa petición cuando por reloj ya se sabe que toca esperar.
HEALTH_JSON="evidencia-poc/http/salud-sesiones-informe.json"
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
      if [ "$VALOR" -lt 1440 ]; then
        REST=$((1440 - VALOR))
        log "⚠️  ENFRIAMIENTO INCOMPLETO (política E16): último 403 hace $((VALOR/60))h$((VALOR%60))m — faltan ~$((REST/60))h$((REST%60))m para las 24h"
        log "    Si se lanza igual, la compuerta gastará la sonda y auto-salteará la cola (exit 4)"
      else
        log "✅ Enfriamiento E16 cumplido: $((VALOR/60))h desde el último 403 (>=24h)"
      fi ;;
    *)
      log "⚠️  Informe de salud ilegible — enfriamiento no verificable (la compuerta de la cola decidirá)" ;;
  esac
else
  log "⚠️  Sin $HEALTH_JSON — enfriamiento no verificable (la compuerta de la cola decidirá)"
fi

# ── 2) Ejecutar la cola ───────────────────────────────────────────────────
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
