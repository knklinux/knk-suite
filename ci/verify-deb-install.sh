#!/usr/bin/env bash
# ============================================================================
# ci/verify-deb-install.sh — verificación post-instalación del .deb en Ubuntu
#
# Replica las aserciones del job smoke-deb del CI sobre TU instalación real:
#   1. layout instalado correcto (binario, backend, runtime node embebido)
#   2. runtime Node >= 22 (los deb con Node 20 embebido NO arrancan:
#      satellite.js 7.1.0 → ERR_PACKAGE_PATH_NOT_EXPORTED — fix 0eb0152)
#   3. backend arranca con el node embebido (puerto libre + BD aislada en /tmp,
#      nunca toca tu ~/.knk-suite real)
#   4. GET  /api/health  → 200 {"ok":true,...}
#   5. GET  /bootstrap   → 200 + Set-Cookie: knk_token=…   (primer arranque)
#   6. POST /api/targets con cookie → 200 con "id"         (regresión CRUD)
#   7. GET  /api/findings sin cookie → 401                (gate de auth)
#
# Uso (en la VM/ThinkPad con el .deb ya instalado):
#   bash ci/verify-deb-install.sh
#   KNK_INSTALL_ROOT="/ruta/custom" bash ci/verify-deb-install.sh
# ============================================================================
set -u

PASS=0; FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "── 1. Layout instalado ──────────────────────────────────────────────"
BIN=/usr/bin/knklinux-desktop
ROOT="${KNK_INSTALL_ROOT:-/usr/lib/knkLinux Security Workbench}"
if [ -x "$BIN" ]; then ok "binario: $BIN"; else bad "falta $BIN (¿se instaló el deb? dpkg -l | grep knklinux)"; fi
if [ -d "$ROOT" ]; then ok "recursos: $ROOT"; else bad "falta $ROOT"; fi

NODE="$ROOT/runtime/node"
if [ -x "$NODE" ]; then
  ok "node embebido presente"
  NV="$("$NODE" -v 2>/dev/null || echo '?')"
  case "$NV" in
    v2[2-9]*|v3*) ok "runtime node $NV (>= 22, satellite.js OK)" ;;
    *) bad "runtime node $NV — DEMASIADO VIEJO: satellite.js 7.1.0 no carga en Node < 22 y el backend morirá al arranque (ERR_PACKAGE_PATH_NOT_EXPORTED). Usa un .deb de CI run >= dbb8a15 (v4.2.1)" ;;
  esac
else
  bad "no hay runtime embebido en $ROOT/runtime/node"
  NODE="$(command -v node || true)"
  [ -z "$NODE" ] && { echo "sin node para continuar"; exit 1; }
  echo "  (fallback: node del sistema $("$NODE" -v))"
fi

command -v curl >/dev/null || { echo "necesitas curl: sudo apt install curl"; exit 1; }

echo "── 2. Arranque del backend (puerto libre + BD aislada) ──────────────"
TMPD="$(mktemp -d /tmp/knk-verify.XXXXXX)"
PORT="$("$NODE" -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})')"
LOG="$TMPD/backend.log"
echo "  puerto: $PORT · BD: $TMPD/verify.db · log: $LOG"

( cd "$ROOT" && KNK_PORT="$PORT" KNK_DB="$TMPD/verify.db" \
    "$NODE" backend/index.js >"$LOG" 2>&1 & echo $! > "$TMPD/pid" )
BACK_PID="$(cat "$TMPD/pid")"

trap 'kill "$BACK_PID" 2>/dev/null; rm -rf "$TMPD"' EXIT

HEALTH=""
for i in $(seq 1 30); do
  sleep 1
  HEALTH="$(curl -s --noproxy '*' -m 2 "http://127.0.0.1:$PORT/api/health" || true)"
  case "$HEALTH" in *'"ok":true'*) break ;; esac
done

if [ -n "$HEALTH" ]; then
  echo "── 3. Aserciones HTTP ───────────────────────────────────────────────"
  case "$HEALTH" in *'"ok":true'*) ok "/api/health → 200 ok:true" ;;
    *) bad "/api/health respondió sin ok:true: $(echo "$HEALTH" | head -c 120)" ;; esac

  HDRS="$TMPD/headers.txt"; JAR="$TMPD/cookies.txt"
  CODE_BOOT="$(curl -s --noproxy '*' -m 5 -o "$TMPD/boot.html" -D "$HDRS" -c "$JAR" -w '%{http_code}' "http://127.0.0.1:$PORT/bootstrap" || true)"
  if [ "$CODE_BOOT" = "200" ] && grep -qi 'set-cookie: knk_token=' "$HDRS"; then
    ok "/bootstrap → 200 + Set-Cookie knk_token (primer arranque OK)"
  else
    bad "/bootstrap → código $CODE_BOOT; cookie knk_token: $(grep -ci 'knk_token' "$HDRS" 2>/dev/null || echo 0) (¿deb antiguo sin la ruta?)"
  fi

  TARGETS="$(curl -s --noproxy '*' -m 5 -b "$JAR" -X POST -H 'Content-Type: application/json' \
    -d '{"name":"verificacion","url":"https://example.com"}' "http://127.0.0.1:$PORT/api/targets" || true)"
  case "$TARGETS" in *'"id"'*) ok "POST /api/targets → 200 con id (CRUD multi-target OK)" ;;
    *) bad "POST /api/targets → $(echo "$TARGETS" | head -c 120)" ;; esac

  CODE_GATE="$(curl -s --noproxy '*' -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/findings" || true)"
  if [ "$CODE_GATE" = "401" ]; then ok "/api/findings sin cookie → 401 (gate de auth OK)"
  else bad "/api/findings sin cookie → $CODE_GATE (¡debería ser 401!)"; fi
else
  echo "── 3. Aserciones HTTP ───────────────────────────────────────────────"
  bad "el backend NO arrancó en 30 s"
  echo
  echo "  Últimas líneas del log del backend:"
  tail -15 "$LOG" 2>/dev/null | sed 's/^/    /'
  echo
  echo "  Causas típicas:"
  echo "   * ERR_PACKAGE_PATH_NOT_EXPORTED / satellite.js → deb con Node 20 embebido (muerto por diseño); usa el deb v4.2.1+ del CI"
  echo "   * Cannot find module / node_modules vacío → instalación incompleta; reinstala el deb"
  echo "   * EADDRINUSE → otro backend tuyo sigue vivo: matar con el PID del netstat"
fi

echo
echo "═════════════════════════════════════════════════════════════════════"
echo "  Resultado: $PASS ✓ · $FAIL ✗"
[ "$FAIL" -eq 0 ] || exit 1
