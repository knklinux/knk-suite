#!/bin/bash
# ============================================================================
# KNK SUITE v2 — launcher todo-en-uno
#   1. Ollama (si está instalado)
#   2. Docker Kali (si existe docker-compose)
#   3. Dashboard en http://127.0.0.1:8086
# ============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "══════════════════════════════════════════════════════"
echo "  🐉 KNK SUITE v2 — Bug Bounty Pipeline"
echo "══════════════════════════════════════════════════════"
echo ""

# ── 0. Limpiar proceso anterior ──────────────────────
if fuser 8086/tcp &>/dev/null 2>&1; then
  echo "⚠️ Puerto 8086 ocupado — matando proceso anterior..."
  fuser -k 8086/tcp 2>/dev/null || true
  sleep 1
fi

# ── 1. Ollama ────────────────────────────────────────
if curl -s -m 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "✅ Ollama ya corriendo"
elif [ -x "$HOME/bin/ollama" ]; then
  echo "▶ Arrancando Ollama..."
  setsid "$HOME/bin/ollama" serve > /tmp/ollama-suite.log 2>&1 < /dev/null &
  sleep 3
  curl -s -m 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && echo "✅ Ollama arriba" || echo "⚠️ Ollama no responde"
else
  echo "ℹ️  Ollama no instalado (funciona sin LLM)"
fi

# ── 2. Docker Kali ────────────────────────────────────
if command -v docker &>/dev/null; then
  if docker ps --format '{{.Names}}' | grep -q 'knk-kali'; then
    echo "✅ Docker Kali ya corriendo (knk-kali)"
  elif [ -f "$SCRIPT_DIR/docker/docker-compose.yml" ]; then
    echo "▶ Arrancando contenedor Kali..."
    (cd "$SCRIPT_DIR/docker" && docker compose up -d 2>/dev/null || docker-compose up -d 2>/dev/null) && \
      echo "✅ Contenedor knk-kali listo" || echo "⚠️ No se pudo arrancar Kali (normal si no tienes docker compose)"
  fi
else
  echo "ℹ️  Docker no instalado (modo nativo sin herramientas Kali)"
fi

# ── 3. Dashboard ──────────────────────────────────────
echo ""
echo "▶ Arrancando KnkSuite..."
echo ""
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║       🐉 KNK SUITE v2 — Bug Bounty         ║"
echo "  ║                                              ║"
echo "  ║  Dashboard → http://127.0.0.1:8086           ║"
echo "  ║  API       → http://127.0.0.1:8086/api       ║"
echo "  ║                                              ║"
echo "  ║  Ctrl+C para salir                           ║"
echo "  ╚══════════════════════════════════════════════╝"
echo ""

exec node backend/server.js