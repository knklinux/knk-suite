FROM kalilinux/kali-rolling

# Avoid prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Update and install essential tools
RUN apt-get update && apt-get install -y \
    # Network scanning
    nmap netcat-openbsd socat \
    # Web testing
    sqlmap nikto ffuf whatweb dirb wpscan \
    # Reconnaissance (apt packages)
    amass subfinder httpx-toolkit dnsx \
    # Password cracking
    hydra john \
    # Forensics
    binwalk foremost steghide \
    # Build de tools Go
    golang-go \
    # Utilities
    curl wget git vim nano \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Go toolchain: PATH para binarios de go install
ENV PATH="/root/go/bin:${PATH}" \
    GOFLAGS="-buildvcs=false"

# ProjectDiscovery suite (nuclei, katana, naabu, dnsx ya vía apt; actualizamos los demás)
RUN go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest \
 && go install -v github.com/projectdiscovery/katana/cmd/katana@latest \
 && go install -v github.com/projectdiscovery/naabu/v2/cmd/naabu@latest \
 && go install -v github.com/projectdiscovery/dnsx/cmd/dnsx@latest \
 && go install -v github.com/ffuf/ffuf/v2@latest

# Tools de recolecta de URLs y parámetros (tomnomnom + lc)
RUN go install -v github.com/tomnomnom/assetfinder@latest \
 && go install -v github.com/tomnomnom/anew@latest \
 && go install -v github.com/tomnomnom/qsreplace@latest \
 && go install -v github.com/tomnomnom/gf@latest \
 && go install -v github.com/lc/gau/v2/cmd/gau@latest \
 && go install -v github.com/jaeles-project/gospider@latest

# Hunting y evidencia
RUN go install -v github.com/hahwul/dalfox/v2@latest \
 && go install -v github.com/sensepost/gowitness@latest \
 && go install -v github.com/tomnomnom/waybackurls@latest

# jwt_tool (npm) — token testing
RUN npm install -g jwt-tool 2>/dev/null || true

# Create non-root user
RUN useradd -m -s /bin/bash hacker
WORKDIR /home/hacker

# Set up bash profile
RUN echo 'export PS1="\[\033[01;32m\]\u@kali\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ "' >> /home/hacker/.bashrc
RUN echo 'alias ll="ls -la"' >> /home/hacker/.bashrc
RUN echo 'alias la="ls -a"' >> /home/hacker/.bashrc

CMD ["/bin/bash"]
