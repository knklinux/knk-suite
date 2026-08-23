#!/bin/bash
# ============================================================================
# 🐉 KNK Suite — Firewall Setup (Kill Switch)
# Protege tu máquina de hacking/bounty
# ============================================================================

set -e

echo ""
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║  🔒 Firewall Setup — Kill Switch              ║"
echo "  ║  Corta Internet si la VPN cae                ║"
echo "  ╚══════════════════════════════════════════════╝"
echo ""

# ── 1. Backup de reglas actuales ────────────────────
echo "📋 Guardando reglas actuales..."
sudo iptables-save > /tmp/iptables-backup.rules 2>/dev/null || true
sudo ip6tables-save > /tmp/ip6tables-backup.rules 2>/dev/null || true

# ── 2. Limpiar reglas existentes ────────────────────
echo "🧹 Limpiando reglas..."
sudo iptables -F
sudo iptables -X
sudo iptables -t nat -F
sudo iptables -t nat -X
sudo iptables -t mangle -F
sudo iptables -t mangle -X

# ── 3. Reglas base ─────────────────────────────────
echo "⚙️  Configurando reglas base..."

# Permitir loopback
sudo iptables -A INPUT -i lo -j ACCEPT
sudo iptables -A OUTPUT -o lo -j ACCEPT

# Permitir conexiones establecidas
sudo iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
sudo iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# ── 4. Permitir tráfico local (192.168.x.x) ────────
echo "🏠 Permitiendo red local..."
sudo iptables -A INPUT -s 192.168.0.0/16 -j ACCEPT
sudo iptables -A OUTPUT -d 192.168.0.0/16 -j ACCEPT

# ── 5. Permitir VPN (WireGuard) ────────────────────
echo "🔐 Configurando VPN (WireGuard)..."
# Detectar interfaz VPN
VPN_IF=$(ip route | grep -oP 'wg\d+' | head -1)
if [ -z "$VPN_IF" ]; then
  VPN_IF="wg0"
fi
sudo iptables -A INPUT -i $VPN_IF -j ACCEPT
sudo iptables -A OUTPUT -o $VPN_IF -j ACCEPT

# ── 6. Permitir Docker interno ──────────────────────
echo "🐳 Permitiendo Docker interno..."
sudo iptables -A INPUT -i docker0 -j ACCEPT
sudo iptables -A OUTPUT -o docker0 -j ACCEPT

# ── 7. Permitir DNS (necesario para VPN) ────────────
echo "🌐 Permitiendo DNS..."
sudo iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
sudo iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# ── 8. Permitir DHCP ───────────────────────────────
echo "📡 Permitiendo DHCP..."
sudo iptables -A OUTPUT -p udp --dport 67:68 -j ACCEPT
sudo iptables -A INPUT -p udp --sport 67:68 -j ACCEPT

# ── 9. KILL SWITCH: Bloquear todo lo demás ─────────
echo "🚫 Activando KILL SWITCH..."
sudo iptables -A OUTPUT -j DROP
sudo iptables -A INPUT -j DROP

# ── 10. IPv6 ────────────────────────────────────────
echo "🔒 Configurando IPv6..."
sudo ip6tables -F
sudo ip6tables -X
sudo ip6tables -A INPUT -i lo -j ACCEPT
sudo ip6tables -A OUTPUT -o lo -j ACCEPT
sudo ip6tables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
sudo ip6tables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
sudo ip6tables -A INPUT -i $VPN_IF -j ACCEPT
sudo ip6tables -A OUTPUT -o $VPN_IF -j ACCEPT
sudo ip6tables -A OUTPUT -j DROP
sudo ip6tables -A INPUT -j DROP

# ── 11. Persistir reglas ────────────────────────────
echo "💾 Guardando reglas..."
sudo iptables-save | sudo tee /etc/iptables/rules.v4 > /dev/null
sudo ip6tables-save | sudo tee /etc/iptables/rules.v6 > /dev/null

echo ""
echo "  ✅ Firewall configurado"
echo "  🔒 Kill switch activo"
echo "  📋 Backup en /tmp/iptables-backup.rules"
echo ""
echo "  ⚠️  SI LA VPN CAE, SE CORTA INTERNET"
echo ""
echo "  Para desactivar temporalmente:"
echo "    sudo iptables -F"
echo "    sudo ip6tables -F"
echo ""
echo "  Para restaurar backup:"
echo "    sudo iptables-restore < /tmp/iptables-backup.rules"
echo ""