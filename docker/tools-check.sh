#!/bin/bash
# ============================================================================
# 🐉 KNK Suite — Verificador de herramientas del contenedor Kali
# Comprueba que todo lo que usa la terminal embebida está instalado.
#
# Uso (dentro del contenedor):
#   docker exec knk-kali tools-check
#   # o, si estás dentro del contenedor:
#   tools-check
# ============================================================================

# Herramientas obligatorias (presets de la terminal + pipeline).
# Formato: binario | alias1|alias2  → vale si existe el binario o cualquiera
# de sus alias (p. ej. netcat-openbsd instala `nc`, y elHarvester cambia de
# mayúsculas entre versiones de Kali).
OBLIGATORIAS="nmap nc|netcat socat whatweb dirb gobuster wfuzz ffuf nuclei nikto amass subfinder theHarvester|theharvester dnsrecon whois dig hydra john hashcat binwalk foremost steghide exiftool strings file curl wget git vim nano jq python3 openssl unzip searchsploit"

# Herramientas opcionales (solo avisan si faltan)
OPCIONALES="masscan arp-scan traceroute wpscan feroxbuster httpx-toolkit msfconsole msfvenom"

have() {
  local bin="$1"
  command -v "$bin" >/dev/null 2>&1
}

MISSING=""
for spec in $OBLIGATORIAS; do
  bin="${spec%%|*}"
  alts=""
  case "$spec" in *"|"*) alts="${spec#*|}" ;; esac

  ok=0
  if have "$bin"; then
    ok=1
  else
    if [ -n "$alts" ]; then
      IFS='|' read -ra ALT_LIST <<< "$alts"
      for a in "${ALT_LIST[@]}"; do
        if have "$a"; then ok=1; break; fi
      done
    fi
  fi

  if [ "$ok" = "0" ]; then
    MISSING="$MISSING $bin"
    echo "  ❌ $bin"
  fi
done

echo ""
if [ -n "$MISSING" ]; then
  echo "  ⛔ FALTAN herramientas obligatorias:$MISSING"
  echo "     Reconstruye la imagen:  cd knk-suite/docker && docker compose up -d --build"
  exit 1
fi
echo "  ✅ Todas las herramientas obligatorias están instaladas"

# Wordlists
for wl in /usr/share/wordlists/dirb/common.txt /usr/share/wordlists/rockyou.txt; do
  if [ ! -f "$wl" ]; then
    echo "  ⚠️  Falta wordlist: $wl"
  fi
done

# Opcionales (aviso no bloqueante)
for t in $OPCIONALES; do
  if ! command -v "$t" >/dev/null 2>&1; then
    echo "  ℹ️  Opcional no instalado: $t"
  fi
done

echo ""
echo "  🐉 Kali listo para la caza."
exit 0
