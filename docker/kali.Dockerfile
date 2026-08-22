FROM kalilinux/kali-rolling

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    nmap \
    ffuf \
    nuclei \
    subfinder \
    amass \
    whatweb \
    katana \
    httpx-toolkit \
    sqlmap \
    dirb \
    dnsx \
    gau \
    waybackurls \
    curl \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Nuclei templates iniciales
RUN nuclei -update-templates 2>/dev/null || true

WORKDIR /data
ENTRYPOINT ["/bin/bash", "-c"]
CMD ["echo '🐉 Kali container ready'; sleep infinity"]