#!/bin/bash
# ============================================================================
# 🐉 KNK Suite — Lab Setup Script
# Entornos vulnerables legales para aprender pentesting
# ============================================================================

set -e

LAB_DIR="$HOME/.knk-suite/labs"
mkdir -p "$LAB_DIR"

echo ""
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║  🐉 KNK Suite — Lab Setup                    ║"
echo "  ║  Entornos vulnerables legales para aprender   ║"
echo "  ╚══════════════════════════════════════════════╝"
echo ""

# ── 1. DVWA (Damn Vulnerable Web Application) ──────
setup_dvwa() {
  echo "📦 Instalando DVWA..."
  if [ ! -d "$LAB_DIR/dvwa" ]; then
    git clone https://github.com/digininja/DVWA.git "$LAB_DIR/dvwa" 2>/dev/null
  fi
  echo "  ✅ DVWA instalado en $LAB_DIR/dvwa"
  echo "  📖 Acceso: http://localhost/dvwa/login.php"
  echo "  🔑 User: admin | Pass: password"
  echo ""
}

# ── 2. WebGoat ─────────────────────────────────────
setup_webgoat() {
  echo "📦 Instalando WebGoat..."
  if [ ! -f "$LAB_DIR/webgoat.jar" ]; then
    cd "$LAB_DIR"
    wget -q "https://github.com/WebGoat/WebGoat/releases/download/v8.2.2/webgoat-server-8.2.2.jar" -O webgoat.jar 2>/dev/null
  fi
  echo "  ✅ WebGoat descargado en $LAB_DIR/webgoat.jar"
  echo "  🚀 Ejecuta: java -jar $LAB_DIR/webgoat.jar"
  echo "  📖 Acceso: http://localhost:8080/WebGoat"
  echo ""
}

# ── 3. Juice Shop ──────────────────────────────────
setup_juiceshop() {
  echo "📦 Instalando OWASP Juice Shop..."
  if [ ! -d "$LAB_DIR/juice-shop" ]; then
    git clone https://github.com/juice-shop/juice-shop.git "$LAB_DIR/juice-shop" 2>/dev/null
    cd "$LAB_DIR/juice-shop" && npm install 2>/dev/null
  fi
  echo "  ✅ Juice Shop instalado en $LAB_DIR/juice-shop"
  echo "  🚀 Ejecuta: cd $LAB_DIR/juice-shop && npm start"
  echo "  📖 Acceso: http://localhost:3000"
  echo ""
}

# ── 4. Metasploitable ──────────────────────────────
setup_metasploitable() {
  echo "📦 Metasploitable (requiere Docker)..."
  echo "  📖 Descarga la VM desde: https://sourceforge.net/projects/metasploitable/"
  echo "  📖 O usa la versión Docker:"
  echo "     docker pull metasploitable2/metasploitable2"
  echo "     docker run -d --name metasploitable -p 80:80 -p 21:21 -p 23:23 -p 445:445 metasploitable2/metasploitable2"
  echo ""
}

# ── 5. PentesterLab ────────────────────────────────
setup_pentesterlab() {
  echo "📦 Recursos gratuitos de práctica..."
  echo "  🌐 HackTheBox: https://www.hackthebox.com"
  echo "  🌐 TryHackMe: https://tryhackme.com"
  echo "  🌐 PentesterLab: https://pentesterlab.com"
  echo "  🌐 PortSwigger WebSecurity Academy: https://portswigger.net/web-security"
  echo "  🌐 OWASP WebGoat: https://owasp.org/www-project-webgoat/"
  echo "  🌐 VulnHub: https://www.vulnhub.com"
  echo ""
}

# ── 6. Nmap Practice ───────────────────────────────
setup_nmap_lab() {
  echo "📦 Configurando Nmap practice..."
  mkdir -p "$LAB_DIR/nmap-practice"
  cat > "$LAB_DIR/nmap-practice/README.md" << 'EOF'
# Nmap Practice Lab

## Targets locales (seguros para practice)

### Escaneo básico
```bash
nmap localhost
nmap -sV localhost
nmap -sC localhost
nmap -p- localhost
```

### Escaneo de servicios
```bash
nmap -sV -sC -p 21,22,80,443 localhost
nmap --script http-enum localhost
nmap --script ssl-enum-ciphers -p 443 localhost
```

### Practice con Metasploitable
```bash
nmap -sV -sC metasploitable
nmap -p- --min-rate=1000 metasploitable
nmap --script vuln metasploitable
```
EOF
  echo "  ✅ Guías de práctica en $LAB_DIR/nmap-practice/"
  echo ""
}

# ── Main Menu ───────────────────────────────────────
echo "¿Qué quieres instalar?"
echo ""
echo "  1) DVWA (Damn Vulnerable Web Application)"
echo "  2) WebGoat (OWASP)"
echo "  3) Juice Shop (OWASP)"
echo "  4) Metasploitable (VM)"
echo "  5) Guías de práctica (Nmap, etc.)"
echo "  6) Todo"
echo "  0) Cancelar"
echo ""
read -p "Selección: " choice

case $choice in
  1) setup_dvwa ;;
  2) setup_webgoat ;;
  3) setup_juiceshop ;;
  4) setup_metasploitable ;;
  5) setup_nmap_lab ;;
  6)
    setup_dvwa
    setup_webgoat
    setup_juiceshop
    setup_metasploitable
    setup_nmap_lab
    ;;
  *) echo "Cancelado." ;;
esac

echo ""
echo "  📁 Labs instalados en: $LAB_DIR"
echo "  📖 Documentación: https://owasp.org/www-project-webgoat/"
echo "  🌐 Practice online: https://tryhackme.com"
echo ""
echo "  ⚠️  IMPORTANTE: Solo usa estos entornos en tu propia red"
echo "  ⚠️  o en entornos autorizados para práctica."
echo ""