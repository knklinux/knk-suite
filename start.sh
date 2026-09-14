#!/bin/bash
# ============================================================================
# 🐉 KNK SUITE v2.1 — Bug Bounty Suite
# ============================================================================

cd "$(dirname "$0")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${CYAN}  ╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║      🐉 KNK SUITE v2.1 — Bug Bounty         ║${NC}"
echo -e "${CYAN}  ║  Express + SQLite + React + Docker Kali      ║${NC}"
echo -e "${CYAN}  ╚══════════════════════════════════════════════╝${NC}"
echo ""

# ── Limpieza selectiva del puerto ──
# Solo se detiene una instancia ANTERIOR de la propia suite (backend/index.js);
# nunca se toca un proceso ajeno que use el puerto 8086 (M-4 de la auditoría).
PORT=${KNK_PORT:-8086}
if command -v lsof &>/dev/null; then
  for pid in $(lsof -t -i :$PORT -sTCP:LISTEN 2>/dev/null); do
    if [ -r "/proc/$pid/cmdline" ] && tr '\0' ' ' < "/proc/$pid/cmdline" | grep -qE "backend/index\.js|knk-suite"; then
      echo -e "${CYAN}  [~] Cerrando instancia anterior de la suite (PID $pid)${NC}"
      kill "$pid" 2>/dev/null
    else
      echo -e "${YELLOW}  [!] Puerto $PORT ocupado por otro proceso (PID $pid) — no se toca${NC}"
    fi
  done
else
  # Fallback sin lsof: fuser solo si está disponible, con aviso
  fuser -k $PORT/tcp 2>/dev/null || true
fi
sleep 1

# Check Docker
if command -v docker &>/dev/null; then
  echo -e "${GREEN}  [✓] Docker encontrado${NC}"
  # Ensure Kali container is running
  if sg docker -c "docker ps" &>/dev/null; then
    echo -e "${GREEN}  [✓] Docker Kali disponible${NC}"
    if ! sg docker -c "docker inspect -f '{{.State.Running}}' knk-kali" 2>/dev/null | grep -q true; then
      echo -e "${YELLOW}  [!] Arrancando contenedor Kali...${NC}"
      sg docker -c "docker start knk-kali" 2>/dev/null
    fi

    # ── Verificación de herramientas del contenedor Kali ──
    # Usa el verificador canónico tools-check (copiado en la imagen).
    # Si la imagen es antigua y no lo trae, avisa de que hay que
    # reconstruirla. No bloquea el arranque: la suite puede seguir
    # aunque la terminal esté incompleta.
    echo -e "${CYAN}  [~] Verificando herramientas en el contenedor Kali...${NC}"
    if sg docker -c "docker exec knk-kali test -x /usr/local/bin/tools-check" 2>/dev/null; then
      TOOLS_LOG=$(sg docker -c "docker exec knk-kali tools-check" 2>&1)
      if [ $? -eq 0 ]; then
        echo -e "${GREEN}  [✓] Herramientas del contenedor Kali verificadas (tools-check)${NC}"
      else
        echo -e "${RED}  [✗] Faltan herramientas en el contenedor Kali:${NC}"
        echo "$TOOLS_LOG" | sed 's/^/      /'
        echo -e "${YELLOW}      Reconstruye la imagen (una vez):${NC}"
        echo -e "${YELLOW}        cd knk-suite/docker && docker compose up -d --build${NC}"
      fi
    else
      echo -e "${RED}  [✗] Contenedor con imagen ANTIGUA — sin tools-check ni herramientas de la terminal${NC}"
      echo -e "${YELLOW}      Reconstruye la imagen (una vez):${NC}"
      echo -e "${YELLOW}        cd knk-suite/docker && docker compose up -d --build${NC}"
    fi
  fi
else
  echo -e "${RED}  [✗] Docker no encontrado — instala con: sudo apt install docker.io${NC}"
fi

# Check Ollama
if curl -s http://127.0.0.1:11434/api/tags &>/dev/null; then
  echo -e "${GREEN}  [✓] Ollama activo${NC}"
else
  echo -e "${YELLOW}  [!] Ollama no detectado — sin LLM local${NC}"
fi

# Install deps if needed
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}  [!] Instalando dependencias...${NC}"
  npm install --production 2>/dev/null
fi

if [ ! -d "frontend/node_modules" ]; then
  echo -e "${YELLOW}  [!] Instalando frontend...${NC}"
  cd frontend && npm install && npx vite build 2>/dev/null && cd ..
fi

# Build frontend if dist doesn't exist
if [ ! -d "frontend/dist" ]; then
  echo -e "${YELLOW}  [!] Construyendo frontend...${NC}"
  cd frontend && npx vite build 2>/dev/null && cd ..
fi

# Token API (seguridad Fase 1): se genera al primer arranque
if [ -z "$KNK_API_TOKEN" ] && [ -f "$HOME/.knk-suite/api-token" ]; then
  echo -e "${CYAN}  🔑 Token API: $HOME/.knk-suite/api-token${NC}"
elif [ -n "$KNK_API_TOKEN" ]; then
  echo -e "${CYAN}  🔑 Token API: KNK_API_TOKEN (env)${NC}"
else
  echo -e "${YELLOW}  🔑 Token API: se generará al primer arranque (~/.knk-suite/api-token)${NC}"
fi

# Start server
echo ""
echo -e "${GREEN}  Arrancando en http://127.0.0.1:${PORT}${NC}"
echo -e "${CYAN}  Terminal Kali → ws://127.0.0.1:${PORT}/ws/terminal${NC}"
echo ""

# Open browser if possible
if command -v xdg-open &>/dev/null; then
  (sleep 2 && xdg-open "http://127.0.0.1:${PORT}") &
elif command -v open &>/dev/null; then
  (sleep 2 && open "http://127.0.0.1:${PORT}") &
fi

exec node backend/index.js