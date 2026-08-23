FROM kalilinux/kali-rolling

ENV DEBIAN_FRONTEND=noninteractive

# Core tools only - what actually works in Kali apt
RUN apt-get update && apt-get install -y --no-install-recommends \
    nmap \
    ffuf \
    nuclei \
    subfinder \
    amass \
    whatweb \
    httpx-toolkit \
    sqlmap \
    dirb \
    dnsx \
    curl \
    wget \
    ca-certificates \
    dnsutils \
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

# Nuclei templates
RUN nuclei -update-templates 2>/dev/null || true
RUN nuclei -ut 2>/dev/null || true

WORKDIR /data
ENTRYPOINT ["/bin/bash", "-c"]
CMD ["echo '🐉 Kali listo | nmap ffuf nuclei subfinder amass whatweb httpx sqlmap dirb dnsx'; sleep infinity"]