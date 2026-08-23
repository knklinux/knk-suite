#!/bin/bash
# ============================================================================
# 🐉 KNK Suite — Vault Setup
# Almacenamiento cifrado para tokens y credenciales
# ============================================================================

VAULT_DIR="$HOME/.knk-suite/vault"

echo ""
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║  🔐 Vault Setup — Credenciales cifradas      ║"
echo "  ╚══════════════════════════════════════════════╝"
echo ""

# Create vault directory
mkdir -p "$VAULT_DIR"
chmod 700 "$VAULT_DIR"

# ── 1. GitHub Token ────────────────────────────────
echo "🔑 GitHub Token:"
if [ -f "$VAULT_DIR/github.gpg" ]; then
  echo "  ✅ Ya existe (usa gpg -d para ver)"
else
  read -p "  Token de GitHub (deja vacío para saltar): " GITHUB_TOKEN
  if [ -n "$GITHUB_TOKEN" ]; then
    echo "$GITHUB_TOKEN" | gpg -c > "$VAULT_DIR/github.gpg"
    echo "  ✅ Token guardado cifrado"
    # Clear history
    unset GITHUB_TOKEN
  else
    echo "  ⏭️  Saltado"
  fi
fi

# ── 2. API Keys ────────────────────────────────────
echo ""
echo "🔑 API Keys:"
echo "  Guarda cualquier API key que necesites:"
echo "  - Shodan API key"
echo "  - Censys API key"
echo "  - VirusTotal API key"
echo ""
read -p "  Nombre del servicio (vacío para saltar): " SERVICE
if [ -n "$SERVICE" ]; then
  read -s -p "  API Key: " API_KEY
  echo ""
  if [ -n "$API_KEY" ]; then
    echo "$API_KEY" | gpg -c > "$VAULT_DIR/${SERVICE}.gpg"
    echo "  ✅ $SERVICE API key guardada"
    unset API_KEY
  fi
fi

# ── 3. SSH Keys ────────────────────────────────────
echo ""
echo "🔑 SSH Keys:"
if [ -f "$HOME/.ssh/id_rsa" ] || [ -f "$HOME/.ssh/id_ed25519" ]; then
  echo "  ✅ SSH keys detectadas"
else
  echo "  ⚠️  No hay SSH keys"
  read -p "  ¿Generar SSH key? (s/n): " GEN_SSH
  if [ "$GEN_SSH" = "s" ]; then
    ssh-keygen -t ed25519 -f "$HOME/.ssh/id_ed25519" -N ""
    echo "  ✅ SSH key generada"
  fi
fi

# ── 4. Verificar vault ─────────────────────────────
echo ""
echo "📁 Vault contents:"
ls -la "$VAULT_DIR" 2>/dev/null | grep -v "^total\|^d"
echo ""

echo "  📖 Para usar el vault:"
echo "    Ver token GitHub:  gpg -d $VAULT_DIR/github.gpg"
echo "    Ver API key:       gpg -d $VAULT_DIR/SERVICE.gpg"
echo "    Añadir nuevo:      echo 'KEY' | gpg -c > $VAULT_DIR/NEW.gpg"
echo ""