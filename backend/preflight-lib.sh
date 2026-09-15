#!/usr/bin/env bash
# ============================================================================
# preflight-lib.sh — funciones compartidas del pre-flight auto-reparador
#
# Contrato con el script llamador (v7-sep12.sh, watchdog-infra.sh):
#   * definir ANTES del source:  log()  OUT_DIR  CANARY_LOG
#     (log() escribe con tee -a en el log propio de cada lanzador)
#   * hacer cd a la RAÍZ del repo antes del source
#
# Define: resolve_via_dns, CURL_TLS (array), tunnel_hit, ensure_canary,
# ensure_tunnel. El prefijo de nonce se deriva del nombre del script
# llamador (trazabilidad: cada intervención queda marcada con su origen).
#
# Fallos de red documentados que estas funciones esquivan:
#   * NXDOMAIN negativo cacheado en Windows para hostnames trycloudflare
#     recién creados  → fallback 1.1.1.1 + --resolve;
#   * CRYPT_E_REVOCATION_OFFLINE del schannel de Windows (CRL/OCSP
#     inalcanzables matan TODO curl https) → --ssl-no-revoke (solo existe
#     en builds schannel; se detecta una vez).
#
# NOTA DE MANTENIMIENTO: v6-sep10.sh (congelado) conserva copias inline de
# estas funciones; cualquier corrección nueva va AQUÍ y se propaga a los
# lanzadores que hacen source de esta librería.
# ============================================================================

# Prefijo de nonce del llamador: v7-sep12 → "V7-SEP12-", watchdog-infra → "WATCHDOG-INFRA-"
NONCE_PREFIX=$(basename "${BASH_SOURCE[1]:-$0}" .sh | tr '[:lower:]' '[:upper:]' | tr -c 'A-Z0-9-' '-')

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
# ensure_canary — el canary SIEMPRE termina vivo (o devuelve error)
# Patrón (cmd &) heredado de V6: node queda huérfano del script y sobrevive.
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
# ensure_tunnel — el túnel cloudflared SIEMPRE termina vivo (o devuelve error)
# Verificación de la URL registrada, muerte SOLO de instancias cloudflared
# cuyo comando apunta a :8210 (nunca un cloudflared ajeno), relanzamiento,
# registro de la URL nueva en el log del canary y verificación E2E.
# ----------------------------------------------------------------------------
ensure_tunnel() {
  local TUNEL code
  TUNEL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$CANARY_LOG" 2>/dev/null | tail -1)
  if [ -n "$TUNEL" ]; then
    code=$(tunnel_hit "$TUNEL" "${NONCE_PREFIX}TUNNEL-CHECK")
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
    code=$(tunnel_hit "$NEW_URL" "${NONCE_PREFIX}TUNNEL-RELAUNCH")
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
