#!/bin/bash
# ============================================================================
# 🐉 KNK Suite — Setup de Seguridad Completo
# Ejecuta esto UNA VEZ con sudo
# ============================================================================

set -e

echo ""
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║  🔒 Setup de Seguridad Completo              ║"
echo "  ║  Ejecuta: sudo bash setup-seguridad.sh       ║"
echo "  ╚══════════════════════════════════════════════╝"
echo ""

# ── 1. DNS SEGURO ──────────────────────────────────
echo "📡 [1/4] Configurando DNS seguro..."
tee /etc/systemd/resolved.conf > /dev/null << 'EOF'
[Resolve]
DNS=1.1.1.1#cloudflare-dns.com 9.9.9.9#dns.quad9.net
FallbackDNS=8.8.8.8#dns.google
Cache=yes
DNSStubListener=yes
EOF
systemctl restart systemd-resolved 2>/dev/null
echo "  ✅ DNS: Cloudflare + Quad9"

# ── 2. FIREWALL (KILL SWITCH) ──────────────────────
echo ""
echo "🛡️  [2/4] Configurando firewall..."
iptables -F 2>/dev/null
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -s 192.168.0.0/16 -j ACCEPT
iptables -A OUTPUT -d 192.168.0.0/16 -j ACCEPT
iptables -A INPUT -i docker0 -j ACCEPT
iptables -A OUTPUT -o docker0 -j ACCEPT
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT
iptables -A OUTPUT -p udp --dport 67:68 -j ACCEPT
iptables -A INPUT -p udp --sport 67:68 -j ACCEPT
iptables -A OUTPUT -j DROP
iptables -A INPUT -j DROP
echo "  ✅ Kill switch activo"

# ── 3. WIREGUARD ───────────────────────────────────
echo ""
echo "🔐 [3/4] Instalando WireGuard..."
apt install -y -qq wireguard 2>/dev/null
echo "  ✅ WireGuard instalado"
echo "  ⚠️  Ahora necesitas configurar tu VPN:"
echo "     1. Crea cuenta en Mullvad (€5/mes) o ProtonVPN"
echo "     2. Descarga config WireGuard"
echo "     3. Copia a /etc/wireguard/wg0.conf"
echo "     4. Ejecuta: sudo wg-quick up wg0"

# ── 4. HARDENING ────────────────────────────────────
echo ""
echo "🔒 [4/4] Hardening del sistema..."

# Deshabilitar servicios innecesarios
systemctl disable cups 2>/dev/null || true
systemctl stop cups 2>/dev/null || true
echo "  ✅ CUPS deshabilitado"

# Configurar permisos del vault
mkdir -p ~/.knk-suite/vault
chmod 700 ~/.knk-suite/vault
echo "  ✅ Vault configurado"

# ── RESUMEN ─────────────────────────────────────────
echo ""
echo "  ═══════════════════════════════════════════════"
echo "  ✅ Setup completado"
echo "  ═══════════════════════════════════════════════"
echo ""
echo "  Próximos pasos:"
echo "  1. Configura tu VPN (Mullvad o ProtonVPN)"
echo "  2. Ejecuta: bash docker/security-check.sh"
echo "  3. Verifica que la IP cambió"
echo ""
echo "  Para desactivar firewall temporalmente:"
echo "    sudo iptables -F"
echo ""