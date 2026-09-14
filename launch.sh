#!/bin/bash
cd "$(dirname "$0")"
# M-4: solo matar una instancia previa de la propia suite, no procesos ajenos
PORT=${KNK_PORT:-8086}
if command -v lsof &>/dev/null; then
  for pid in $(lsof -t -i :$PORT -sTCP:LISTEN 2>/dev/null); do
    if [ -r "/proc/$pid/cmdline" ] && tr '\0' ' ' < "/proc/$pid/cmdline" | grep -qE "backend/index\.js|knk-suite"; then
      echo "[~] Cerrando instancia anterior de la suite (PID $pid)"
      kill "$pid" 2>/dev/null
    else
      echo "[!] Puerto $PORT ocupado por otro proceso (PID $pid) — no se toca"
    fi
  done
else
  fuser -k $PORT/tcp 2>/dev/null || true
fi
sleep 1
exec node backend/index.js