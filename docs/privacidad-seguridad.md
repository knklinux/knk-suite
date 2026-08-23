# 🔒 Guía de Privacidad y Seguridad para Bug Bounty

## ⚠️ Tu IP actual está expuesta
```
IP pública: 90.173.225.104
```
Esto significa que cada petición que haces a un target puede ser rastreada hasta tu router/doméstica.

---

## 🛡️ Estrategia de Protección (3 capas)

### Capa 1: VPN (obligatorio)

**Opciones recomendadas para bug bounty:**

| VPN | Precio | Por qué |
|-----|--------|---------|
| **Mullvad** | €5/mes | Sin logs, pagable con crypto, WireGuard |
| **ProtonVPN** | Gratis/Premium | Swiss privacy, sin logs, Secure Core |
| **IVPN** | $6/mes | Sin logs, multi-hop, WireGuard |

**Configuración con WireGuard (recomendado):**
```bash
# Instalar WireGuard
sudo apt install wireguard

# Configurar con tu VPN (ejemplo Mullvad)
# Descarga config de la web de tu VPN
sudo wg-quick up mullvad

# Verificar
curl https://ifconfig.me  # Debe mostrar IP diferente

# Auto-conectar al inicio
sudo systemctl enable wg-quick@mullvad
```

### Capa 2: Red Aislada (recomendado)

**Crear una VLAN separada para tu máquina de bounty:**

```
Router
├── VLAN 1 (Casa)     → 192.168.1.0/24  (dispositivos normales)
├── VLAN 2 (Bounty)   → 192.168.2.0/24  (tu máquina de hacking)
└── VLAN 3 (IoT)      → 192.168.3.0/24  (cámaras, smart home)
```

**En tu router:**
1. Crea una VLAN nueva (si tu router lo soporta)
2. Asigna tu PC de bounty a esa VLAN
3. Bloquea tráfico entre VLANs (excepto lo que necesites)

**Si tu router no soporta VLANs:**
- Usa una segunda router (barato) conectado al primero
- Tu PC de bounty se conecta al segundo router
- El segundo router tiene firewall agresivo

### Capa 3: Firewall local

```bash
# Bloquear todo tráfico saliente excepto VPN
sudo iptables -P OUTPUT DROP
sudo iptables -A OUTPUT -o lo -j ACCEPT
sudo iptables -A OUTPUT -o wg0 -j ACCEPT      # WireGuard VPN
sudo iptables -A OUTPUT -d 192.168.1.0/24 -j ACCEPT  # Red local (si necesitas)

# Si la VPN cae, se corta Internet (kill switch)
```

---

## 🚫 Qué NO hacer

| Acción | Riesgo |
|--------|--------|
| Hacer bounty sin VPN | Tu IP queda en logs de los targets |
| Usar Tor para scanning | Te banean de programas |
| Conectar directamente a WiFi público | Man-in-the-middle |
| Dejar Docker expuesto | Alguien puede usar tu Kali |
| Compartir tu máquina | Responsabilidad legal |

---

## ✅ Checklist de Seguridad

### Antes de empezar:
- [ ] VPN activa (WireGuard/OpenVPN)
- [ ] IP pública cambiada (verificar con curl ifconfig.me)
- [ ] Firewall configurado (kill switch)
- [ ] Docker solo accesible localmente
- [ ] Ollama solo en localhost
- [ ] KnkSuite solo en localhost

### Durante la sesión:
- [ ] Verificar VPN antes de cada target
- [ ] No hacer fuzz a targets reales sin autorización
- [ ] Respetar rate limits de cada programa
- [ ] No escanear IPs fuera de scope

### Después:
- [ ] Desconectar VPN
- [ ] Limpiar logs de terminal
- [ ] Guardar evidencia en vault cifrado

---

## 🔐 Almacenamiento seguro de credenciales

```bash
# Crear vault cifrado para tokens, passwords, etc.
mkdir -p ~/.knk-suite/vault
chmod 700 ~/.knk-suite/vault

# Guardar token de GitHub cifrado
echo "ghp_tu_token" | gpg -c > ~/.knk-suite/vault/github.gpg

# Para recuperar
gpg -d ~/.knk-suite/vault/github.gpg
```

---

## 🌐 DNS seguro

```bash
# Usar DNS cifrado (no tu ISP)
# Añadir a /etc/resolv.conf:
nameserver 1.1.1.1    # Cloudflare
nameserver 9.9.9.9    # Quad9
nameserver 8.8.8.8    # Google (respaldo)

# O mejor: DNS over TLS
sudo apt install stubby
```

---

## 📋 Resumen rápido

| Capa | Solución | Coste |
|------|----------|-------|
| **IP oculta** | Mullvad/ProtonVPN (WireGuard) | €5/mes |
| **Red aislada** | VLAN o segundo router | €0-30 |
| **Firewall** | iptables kill switch | €0 |
| **DNS seguro** | Cloudflare/Quad9 | €0 |
| **Credenciales** | GPG vault | €0 |

---

*Generado por knkSuite v2.1 — 2026-08-23*