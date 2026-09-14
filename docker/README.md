# 🐉 Contenedor Kali de KNK Suite

Imagen Docker que alimenta la **terminal embebida** de la suite (pestaña
Terminal → WebSocket → `docker exec knk-kali bash`).

## ¿Por qué la terminal no tenía herramientas?

La versión anterior del `kali.Dockerfile` instalaba `nuclei` y `ffuf`
con `go install`, pero la imagen base `kalilinux/kali-rolling` **no trae
Go**, y el fallo se tragaba con `|| true`. Resultado: imagen construida
"con éxito" pero sin las herramientas que la terminal anuncia.

**Solución:** todo se instala ahora por `apt` (nuclei, ffuf, whatweb,
dirb, gobuster, etc. están en el repositorio de Kali), se incluyen las
wordlists (`/usr/share/wordlists/dirb/common.txt` y `rockyou.txt`) que
usan los presets, y el build **falla si falta algo** (verificación en
`RUN`).

## Reconstruir la imagen (una vez)

```bash
cd knk-suite/docker
docker compose up -d --build   # reconstruye y reinicia el contenedor
```

O sin compose:

```bash
cd knk-suite/docker
docker build -t knk-kali:latest .
docker rm -f knk-kali 2>/dev/null; docker run -d --name knk-kali \
  -v "$(pwd)/../data:/data" -v "$(pwd)/../workspace:/workspace" \
  --restart unless-stopped knk-kali:latest
```

Después reinicia la suite (`bash start.sh` o `bash launch.sh`) para que
reconecte al contenedor.

## Verificar que las herramientas están

```bash
docker exec knk-kali tools-check
```

Debe terminar con `✅ Todas las herramientas obligatorias están instaladas`.

## Empaquetar y desplegar sin reconstruir (ship / load)

La imagen reconstruida se puede **exportar con las herramientas ya
instaladas**, para que otra caja (portátil, OVA nueva, puesto de reserva)
no tenga que repetir el `apt install` completo — ni arriesgarse al fallo
de build del mirror de Kali.

**En la caja con la imagen ya reconstruida (origen):**

```bash
cd knk-suite/docker
bash ship.sh                  # → ./knk-kali-latest.tar.gz (exporta y comprime)
bash ship.sh -o /ruta/knk-kali.tar   # ruta alternativa
bash ship.sh --push --tag v2.1-fixed # alternativa: publicar en un registry
```

`ship.sh` siempre pasa la compuerta `tools-check` **dentro de la imagen**
antes de exportar: si falta algo, no genera el .tar.

**En la caja de destino:**

```bash
cd knk-suite/docker
bash load.sh knk-kali-latest.tar.gz
bash ../start.sh              # reconecta la terminal de la suite
```

`load.sh` carga la imagen, verifica las herramientas con `tools-check`,
recrea el contenedor `knk-kali` con los volúmenes `data/` y `workspace/`
de la suite, y deja la terminal lista. Si el .tar viniera incompleto,
**no toca** el contenedor existente.

> Los dos scripts detectan solos si docker va directo o vía `sg docker`.
> Las dos cajas necesitan Docker instalado, pero solo el origen necesita
> construir la imagen.

## Herramientas instaladas

- **Recon:** amass, subfinder, theHarvester, dnsrecon, whois, dig
- **Red:** nmap, masscan, netcat, socat, arp-scan, traceroute
- **Web:** whatweb, nikto, dirb, gobuster, wfuzz, ffuf, nuclei, wpscan,
  feroxbuster, httpx-toolkit (SQLi automatizada no se instala: KNK exige compuerta manual y basada en evidencia)
- **Credenciales:** hydra, john, hashcat
- **Forense:** binwalk, foremost, steghide, exiftool
- **Auxiliares:** searchsploit, curl, wget, git, vim, nano, jq, python3,
  openssl, unzip
- **Wordlists:** `/usr/share/wordlists/dirb/common.txt`,
  `/usr/share/wordlists/rockyou.txt`

> **Metasploit** (msfconsole/msfvenom, +2 GB) viene desactivado por
> defecto para mantener la imagen ligera. Actívalo descomentando la
> línea correspondiente en `kali.Dockerfile` y reconstruyendo.