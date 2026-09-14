# Instalar Kali en WSL2 para knkLinux

Estado detectado en tu equipo: Windows 11 25H2, virtualización activa (HypervisorPresent=True), **WSL aún no instalado**. Con esto queda todo listo para que la pestaña 🖥️ Terminal use Kali real.

## Paso 1 — Instalar WSL2 + Kali (PowerShell como ADMINISTRADOR)

```powershell
wsl --install -d kali-linux --no-launch
```

- Activa "Subsistema de Windows para Linux" y "Plataforma de máquina virtual".
- Descarga Kali (~400 MB).
- `--no-launch` evita abrir la consola de primer arranque todavía.
- **Reinicia Windows cuando termine** (obligatorio la primera vez).

Si `wsl --install` da error de características:

```powershell
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
# reiniciar, y luego:
wsl --set-default-version 2
wsl --install -d kali-linux
```

## Paso 2 — Primer arranque (crear usuario, sin admin)

Abre "Kali GNU/Linux" desde el menú Inicio o ejecuta `wsl -d kali-linux`.
Pedirá crear **usuario y contraseña de Kali** (no tiene por qué ser tu usuario Windows).

## Paso 3 — Cargar las herramientas del lab

Dentro de Kali (WSL):

```bash
sudo apt update
sudo apt install -y nmap sqlmap whatweb dirb nikto hydra john hashcat gobuster seclists
# opcionales según uso:
sudo apt install -y ffuf nuclei subfinder wpscan amass
```

Nota: `nuclei`/`subfinder`/`ffuf` a veces van mejor por binarios de Go; con apt basta para empezar.

## Paso 4 — Verificar en knkLinux

Arranca knkLinux y comprueba:

1. Sidebar: `● Kali: READY` (verde).
2. Pestaña 🖥️ Terminal: banner `── Kali WSL2 [kali-linux] ──` y prueba `uname -a`.
3. Inventario de herramientas debajo: cada una ✓ o ✗ según lo instalado en el Paso 3.

Por API:

```bash
curl http://127.0.0.1:8086/api/kali/status   # RUNTIME_READY, distro kali-linux
curl http://127.0.0.1:8086/api/kali/tools    # inventario real
curl -X POST http://127.0.0.1:8086/api/kali/exec \
  -H 'Content-Type: application/json' -d '{"command":"nmap --version"}'
```

## Qué cambia en knkLinux cuando Kali está READY

- La Terminal arranca un PTY dentro de Kali (`wsl -d kali-linux`) en vez del shell del host.
- `GET /api/kali/status` pasa a `RUNTIME_READY` con `user` y `distro` reales.
- El inventario (`/api/kali/tools`) se llena con las herramientas detectadas.
- Los jobs de comandos pueden usar `wsl` cuando aplique (los scripts existentes siguen igual).

## Estados honestos que verás

| Estado | Significado |
|---|---|
| `RUNTIME_NOT_INSTALLED` | No hay WSL con distro (hoy) |
| `RUNTIME_DEGRADED` | Distro instalada pero no responde (p. ej. primer arranque sin terminar) |
| `RUNTIME_READY` | Kali operativo: terminal e inventario activos |
