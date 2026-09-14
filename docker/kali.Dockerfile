FROM kalilinux/kali-rolling

# Evita prompts durante la instalación de paquetes
ENV DEBIAN_FRONTEND=noninteractive

# ─────────────────────────────────────────────────────────────
# HERRAMIENTAS DE LA TERMINAL EMBEBIDA (knk-suite → pestaña Terminal)
# Todas vienen del repositorio de Kali (apt), incluido nuclei y ffuf:
# el anterior intento con `go install` fallaba en silencio porque la
# imagen base no trae Go — por eso la terminal no tenía herramientas.
# ─────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    # ── Recon ────────────────────────────────────────────────
    amass \
    subfinder \
    theharvester \
    dnsrecon \
    whois \
    dnsutils \
    # ── Red ──────────────────────────────────────────────────
    nmap \
    masscan \
    netcat-openbsd \
    socat \
    arp-scan \
    traceroute \
    # ── Web ──────────────────────────────────────────────────
    whatweb \
    nikto \
    dirb \
    gobuster \
    wfuzz \
    ffuf \
    nuclei \
    wpscan \
    feroxbuster \
    httpx-toolkit \
    # SQLi no se instala: la suite la limita a una compuerta manual y basada en evidencia.
    # ── Credenciales ─────────────────────────────────────────
    hydra \
    john \
    hashcat \
    # ── Forense ──────────────────────────────────────────────
    binwalk \
    foremost \
    steghide \
    libimage-exiftool-perl \
    binutils \
    file \
    # ── Explotación / auxiliares ─────────────────────────────
    exploitdb \
    # ── Utilidades base ──────────────────────────────────────
    curl \
    wget \
    git \
    vim \
    nano \
    jq \
    python3 \
    python3-pip \
    openssl \
    ca-certificates \
    unzip \
    # ── Wordlists ────────────────────────────────────────────
    # Provee /usr/share/wordlists/dirb/common.txt y
    # /usr/share/wordlists/rockyou.txt.gz (rutas de la terminal)
    wordlists \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# rockyou viene comprimido: descomprímelo para que hydra/john lo usen directo
RUN gunzip -k /usr/share/wordlists/rockyou.txt.gz || true

# Opcional (añade ~2 GB a la imagen): Metasploit para los presets
# msfconsole / msfvenom del Laboratorio.
# RUN apt-get install -y --no-install-recommends metasploit-framework && apt-get clean

# Verificación en tiempo de build: si falta algo, la imagen NO se construye
RUN for t in nmap ffuf nuclei subfinder amass whatweb dirb gobuster nikto hydra john curl git jq; do \
      command -v "$t" >/dev/null 2>&1 || { echo "❌ FALTA HERRAMIENTA: $t"; exit 1; }; \
    done \
    && echo "✅ Todas las herramientas verificadas en el build" \
    && test -f /usr/share/wordlists/dirb/common.txt \
    && test -f /usr/share/wordlists/rockyou.txt \
    && echo "✅ Wordlists presentes (/usr/share/wordlists/)"

# Script de verificación re-ejecutable dentro del contenedor:
#   docker exec knk-kali tools-check
COPY tools-check.sh /usr/local/bin/tools-check
RUN chmod +x /usr/local/bin/tools-check

# Usuario no root para la terminal
RUN useradd -m -s /bin/bash hacker
WORKDIR /home/hacker

# Perfil de bash
RUN echo 'export PS1="\[\033[01;32m\]\u@kali\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ "' >> /home/hacker/.bashrc
RUN echo 'alias ll="ls -la"' >> /home/hacker/.bashrc
RUN echo 'alias la="ls -a"' >> /home/hacker/.bashrc

CMD ["/bin/bash"]