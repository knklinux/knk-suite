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
resolve_via_dns() {  # $1=host  $2=servidor DNS  → 1ª IPv4 ajena al server
  nslookup "$1" "$2" 2>/dev/null \
    | grep -oE "([0-9]{1,3}\.){3}[0-9]{1,3}" \
    | grep -v "$2" \
    | head -1
}

CURL_TLS=()
if curl --help all 2>/dev/null | grep -q -- "--ssl-no-revoke"; then
  CURL_TLS=(--ssl-no-revoke)
fi

tunnel_hit() {  # $1=url base  $2=nonce  → imprime http_code (0 si no hay manera)
  local url="$1" nonce="$2" code host ip
  code=$(curl -s -m 8 "${CURL_TLS[@]}" "$url/hit?nonce=$nonce" -o /dev/null -w "%{http_code}" 2>/dev/null || echo "0")
  [ "$code" = "204" ] && { echo "$code"; return 0; }
  # fallback: el caché DNS de Windows guarda el NXDOMAIN de hostnames
  # trycloudflare recién creados → resolvemos vía 1.1.1.1 y fijamos la IP
  # con --resolve, que esquiva el caché del SO por completo.
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
# Patrón (cmd &) idéntico a V6: node queda huérfano del script y sobrevive.
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
# Igual que V6: verificación de la URL registrada, muerte SOLO de instancias
# cloudflared cuyo comando apunta a :8210, relanzamiento, registro de la URL
# nueva en el log del canary y verificación E2E con reintentos.
# ----------------------------------------------------------------------------
ensure_tunnel() {
  local TUNEL code
  TUNEL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$CANARY_LOG" 2>/dev/null | tail -1)
  if [ -n "$TUNEL" ]; then
    code=$(tunnel_hit "$TUNEL" "V7-TUNNEL-CHECK")
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

  # matar solo NUESTRAS instancias (CommandLine con 8210 = target del canary)
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

  # verificación E2E con reintentos (~40 s)
  i=0
  while [ $i -lt 8 ]; do
    sleep 5
    i=$((i+1))
    code=$(tunnel_hit "$NEW_URL" "V7-TUNNEL-RELAUNCH")
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
