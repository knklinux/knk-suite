#!/bin/bash
# ============================================================================
# 🐉 KNK Suite — Security Check
# Verifica que todo esté configurado correctamente
# ============================================================================

echo ""
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║  🔒 Security Check                           ║"
echo "  ╚══════════════════════════════════════════════╝"
echo ""

PASS=0
FAIL=0
WARN=0

check() {
  local status=$1
  local msg=$2
  if [ "$status" = "pass" ]; then
    echo "  ✅ $msg"
    ((PASS++))
  elif [ "$status" = "fail" ]; then
    echo "  ❌ $msg"
    ((FAIL++))
  else
    echo "  ⚠️  $msg"
    ((WARN++))
  fi
}

# ── 1. IP Pública ──────────────────────────────────
echo "📡 IP Pública:"
PUBLIC_IP=$(curl -s --max-time 5 https://ifconfig.me 2>/dev/null)
if [ -n "$PUBLIC_IP" ]; then
  check warn "IP: $PUBLIC_IP (¿está oculta por VPN?)"
else
  check fail "No se pudo obtener IP pública"
fi

# ── 2. VPN ─────────────────────────────────────────
echo ""
echo "🔐 VPN:"
VPN_IF=$(ip route | grep -oP 'wg\d+' | head -1)
if [ -n "$VPN_IF" ]; then
  check pass "WireGuard activo en $VPN_IF"
else
  check warn "WireGuard no detectado — tu IP real está expuesta"
fi

# ── 3. Firewall ────────────────────────────────────
echo ""
echo "🛡️ Firewall:"
IPTABLES_RULES=$(sudo iptables -L OUTPUT -n 2>/dev/null | grep -c DROP)
if [ "$IPTABLES_RULES" -gt 0 ]; then
  check pass "iptables DROP configurado (kill switch)"
else
  check warn "iptables sin kill switch — ejecuta docker/firewall-setup.sh"
fi

# ── 4. DNS ─────────────────────────────────────────
echo ""
echo "🌐 DNS:"
DNS_SERVER=$(resolvectl status 2>/dev/null | grep "Current DNS Server" | awk '{print $NF}')
if echo "$DNS_SERVER" | grep -qE "1\.1\.1\.1|9\.9\.9\.9|8\.8\.8\.8"; then
  check pass "DNS seguro: $DNS_SERVER"
else
  check warn "DNS: $DNS_SERVER — considera usar Cloudflare/Quad9"
fi

# ── 5. Docker ──────────────────────────────────────
echo ""
echo "🐳 Docker:"
if sg docker -c "docker ps" &>/dev/null; then
  check pass "Docker Kali activo"
  # Check if Docker is exposed externally
  DOCKER_EXPOSED=$(ss -tlnp 2>/dev/null | grep -c "0.0.0.0:2375\|0.0.0.0:2376")
  if [ "$DOCKER_EXPOSED" -gt 0 ]; then
    check fail "Docker API expuesto externamente — peligroso"
  else
    check pass "Docker solo accesible localmente"
  fi
else
  check warn "Docker no disponible"
fi

# ── 6. Servicios expuestos ─────────────────────────
echo ""
echo "🔌 Servicios expuestos:"
EXPOSED=$(ss -tlnp 2>/dev/null | grep -v "127.0.0.1\|::1\|\[::1\]" | grep -v "127.0.0" | head -5)
if [ -n "$EXPOSED" ]; then
  check warn "Servicios escuchando en 0.0.0.0:"
  echo "$EXPOSED" | sed 's/^/    /'
else
  check pass "Solo servicios locales activos"
fi

# ── 7. Ollama ──────────────────────────────────────
echo ""
echo "🤖 Ollama:"
OLLAMA_EXPOSED=$(ss -tlnp 2>/dev/null | grep 11434 | grep -v "127.0.0.1")
if [ -n "$OLLAMA_EXPOSED" ]; then
  check fail "Ollama expuesto externamente"
else
  check pass "Ollama solo en localhost"
fi

# ── 8. KnkSuite ────────────────────────────────────
echo ""
echo "🐉 KnkSuite:"
KNKSUITE_EXPOSED=$(ss -tlnp 2>/dev/null | grep 8086 | grep -v "127.0.0.1")
if [ -n "$KNKSUITE_EXPOSED" ]; then
  check warn "KnkSuite escuchando en 0.0.0.0:8086"
else
  check pass "KnkSuite solo en localhost"
fi

# ── 9. SSH ─────────────────────────────────────────
echo ""
echo "🔑 SSH:"
SSH_STATUS=$(systemctl is-active ssh 2>/dev/null || echo "inactive")
if [ "$SSH_STATUS" = "active" ]; then
  check warn "SSH activo — verifica que solo acepte key auth"
else
  check pass "SSH no activo"
fi

# ── Resumen ────────────────────────────────────────
echo ""
echo "  ═══════════════════════════════════════════════"
echo "  ✅ Pass: $PASS  |  ⚠️  Warn: $WARN  |  ❌ Fail: $FAIL"
echo "  ═══════════════════════════════════════════════"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "  🚨 HAY PROBLEMAS CRÍTICOS — arregla antes de hacer bounty"
elif [ "$WARN" -gt 0 ]; then
  echo "  ⚠️  Hay advertencias — considera arreglarlas"
else
  echo "  ✅ Todo configurado correctamente"
fi
echo ""