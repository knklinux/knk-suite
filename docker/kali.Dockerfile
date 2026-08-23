FROM kalilinux/kali-rolling

# Avoid prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Update and install essential tools
RUN apt-get update && apt-get install -y \
    # Network scanning
    nmap netcat-openbsd socat \
    # Web testing
    sqlmap nikto \
    # Reconnaissance
    amass subfinder httpx-toolkit \
    # Password cracking
    hydra john \
    # Forensics
    binwalk foremost steghide \
    # Utilities
    curl wget git vim nano \
    # Cleanup
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install nuclei and ffuf from GitHub releases
RUN go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest 2>/dev/null || true
RUN go install -v github.com/ffuf/ffuf/v2@latest 2>/dev/null || true

# Create non-root user
RUN useradd -m -s /bin/bash hacker
WORKDIR /home/hacker

# Set up bash profile
RUN echo 'export PS1="\[\033[01;32m\]\u@kali\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ "' >> /home/hacker/.bashrc
RUN echo 'alias ll="ls -la"' >> /home/hacker/.bashrc
RUN echo 'alias la="ls -a"' >> /home/hacker/.bashrc

CMD ["/bin/bash"]