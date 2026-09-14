#!/usr/bin/env bash
# manana-9-sep.sh — Plan de mañana 9-sep: canario + V5 + Zendesk agent check
# Uso: bash backend/manana-9-sep.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "═══════════════════════════════════════════════════"
echo "  PLAN MAÑANA 9-SEP — $(date)"
echo "═══════════════════════════════════════════════════"

# ── 1. Relanzar canario local ─────────────────────────
echo ""
echo "▸ [1/5] Iniciando canario local :8210..."
if curl -s -m 3 http://127.0.0.1:8210/hit -o /dev/null -w "%{http_code}" 2>/dev/null | grep -q "204\|200"; then
  echo "  ✅ Canario ya vivo"
else
  node backend/canario-ssrf.js &
  CANARIO_PID=$!
  sleep 2
  if curl -s -m 3 http://127.0.0.1:8210/hit -o /dev/null -w "%{http_code}" 2>/dev/null | grep -q "204\|200"; then
    echo "  ✅ Canario arrancado (PID $CANARIO_PID)"
  else
    echo "  ❌ Canario no arrancó — revisa manualmente"
  fi
fi

# ── 2. Relanzar túnel cloudflared ─────────────────────
echo ""
echo "▸ [2/5] Verificando túnel cloudflared..."
TUNNEL_URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" backend/zendesk-e16-completo.js | head -1)
if curl -s -m 8 "$TUNNEL_URL" -o /dev/null -w "%{http_code}" 2>/dev/null | grep -q "200\|204"; then
  echo "  ✅ Túnel vivo: $TUNNEL_URL"
else
  echo "  ⚠️  Túnel caído — relanzar manualmente:"
  echo "     tools/cloudflared.exe tunnel --url http://127.0.0.1:8210"
  echo "     (Actualizar URL en zendesk-e16-completo.js después)"
fi

# ── 3. V5 probe OpenAI ───────────────────────────────
echo ""
echo "▸ [3/5] V5 probe OpenAI..."
bash backend/secuencia-post-enfriamiento.sh 2>&1 | tail -20
V5_EXIT=${PIPESTATUS[0]:-0}

# ── 4. Verificar Firefox / BiDi ──────────────────────
echo ""
echo "▸ [4/5] Verificando Firefox + BiDi..."
FF_COUNT=$(tasklist 2>/dev/null | grep -c "firefox" || echo 0)
BDI_PORT=$(netstat -ano 2>/dev/null | grep ":9344" | grep LISTENING | head -1)
if [ "$FF_COUNT" -gt 0 ] && [ -n "$BDI_PORT" ]; then
  echo "  ✅ Firefox ($FF_COUNT procs) + BiDi vivo"
elif [ "$FF_COUNT" -gt 0 ]; then
  echo "  ⚠️  Firefox abierto pero BiDi no — relanzar con:"
  echo "     bash backend/lanza-bidi.sh"
else
  echo "  ❌ Firefox apagado — abrirlo y loguear en Zendesk"
fi

# ── 5. Resumen ───────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  RESUMEN"
echo "═══════════════════════════════════════════════════"
echo "  V5 OpenAI:     ver arriba"
echo "  Canario:       ver paso 1-2"
echo "  Zendesk agent: verificar manualmente en Firefox"
echo "  E16-Z:         node backend/zendesk-e16-completo.js"
echo "  Cola OpenAI:   bash backend/secuencia-post-enfriamiento.sh"
echo "═══════════════════════════════════════════════════"
