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

# Kill old instances
fuser -k 8086/tcp 2>/dev/null
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

# Start server
PORT=${KNK_PORT:-8086}
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