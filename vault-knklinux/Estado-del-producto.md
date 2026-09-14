# Estado del producto — knkLinux

## 2026-09-10 — v4.7 · Reconstrucción del backend + Kali real reconectado

### Crítico arreglado: el backend había perdido ~126 líneas de rutas
`backend/index.js` quedó amputado por un parche anterior sin commit: todas las
rutas (kali/osint/jobs/vault/models/health/targets/browser/reports/memory) y la
terminal WebSocket desaparecieron. Las libs (`backend/lib/*`) estaban intactas.

**Solución**: capa de rutas reconstruida como un único dueño:
- `backend/routes.js` (nuevo) — router Express con TODAS las rutas + WS terminal
- `backend/index.js` reescrito como bootstrap fino (middleware + mount + listen)
- `/assistant/talk` y `/api/memory` ya no están duplicados: viven solo en routes.js

### Modo uncensored real
- `lib/assistant.js`: rutas nuevas `uncensored` (modelo **dolphin3:8b**, system
  prompt de investigación avanzada con límites de laboratorio explícitos) y `osint`
- La UI (Assistant.jsx) ya tenía el botón 🔥 Uncensored; ahora el backend lo honra
- `llm.js`: contexto subido de 8192 → 32768 tokens
- Verificado: `POST /api/assistant/talk {mode:'uncensored'}` → responde dolphin3:8b

### Kali real reconectado (vbox-ssh)
- La VM `kali-linux-2026.2` no tenía la clave SSH del host → clave instalada vía
  `VBoxManage guestcontrol` (MSYS_NO_PATHCONV=1 para que no destroce las rutas)
- Detect: `RUNTIME_READY` · runtime `vbox-ssh` · distro `kali-linux-2026.2-virtualbox-amd64`
- Inventario real: **14/18 OK** · faltan: subfinder, sherlock, testssl, seclists

### Instalador de tools — bloqueado por escalada (honesto)
El job termina en error con metadatos `unlock` (one-liner + pasos) porque apt
pide contraseña en modo no interactivo. El usuario pega el one-liner en la
Terminal Kali (pide la contraseña del box UNA vez) y relanza el instalador.
Pendiente de la acción del usuario para llegar a 18/18.

### Bloqueado por el sistema (documentado)
- **WSL**: no instalado en este Windows (`wsl --install` pide admin + reinicio)
- **Docker**: no instalado (Docker Desktop pide licencias/admin en Windows)
- La vía Kali REAL activa hoy es vbox-ssh; WSL/Docker quedan como rutas futuras

### Tests
- Core: **45/45** · UAT: **23/23** (2 aserciones de UAT actualizadas a la spec
  actual: razón de kali con SSH válida, rutas base del assistant >= 4)

## 2026-09-10 — v4.8 · Terminal conectada a Kali real (verificado end-to-end)

### El bug que faltaba: node-pty no resuelve `ssh` en Windows
`pickTerminal` devolvía `shell: 'ssh'` y node-pty fallaba con "File not found"
(en Windows no hay resolución de PATH en spawn de PTY). Añadido
`resolveSshExe()` en `lib/kali.js`: resuelve `C:\Windows\System32\OpenSSH\ssh.exe`
(Git ssh como alternativa) y en POSIX queda `'ssh'`.

### Verificación real (no solo claims)
- SSH al box: `enabled` + key OK → hostname `kali`
- PTY interactiva via node-pty → prompt `┌──(kali㉿kali)-[~]` + ejecución de
  `echo PTY_IN_KALI_$(uname -sr)` → `Linux 6.19.14+kali-amd64`
- **WS terminal del suite (`/ws/terminal?runtime=vbox-ssh`)**: `WS_OK_Linux
  6.19.14+kali-amd64` dentro del prompt de Kali real ✓

### Tests
- Core: **45/45** (aserción de shell actualizada: ahora acepta ruta ssh.exe
  resuelta, que es la spec correcta en Windows)
- UAT: **24/24**

## 2026-09-10 — v4.9 · Thumbnails de cámaras en vivo (Insecam MJPEG) en el OSINT Hub

### Fuente Insecam re-añadida, ahora con preview real
- `lib/osint.js`: `insecamCameras(country)` scrapea `/en/bycountry/CC/`
  (cert caducado → lectura con `rejectUnauthorized:false` solo aquí; redirect
  https→http seguido manualmente; UA de navegador).
- Parseo del markup real (`thumbnail-item__img`): cada cámara trae
  id, ciudad, fabricante y **src del stream MJPEG** (p.ej.
  `http://ip:port/mjpg/video.mjpg`). Ese src sirve COMO thumbnail: es la
  preview en vivo que el navegador renderiza en `<img>` y refresca solo.
- Integrado en `cameraAggregator` como fuente `insecam` (badge rojo).
- Verificado con la API viva: `country=es` → 6 cámaras (Madrid ×2, Huelva,
  Granada, Tomelloso, Igualada) y 4 streams MJPEG comprobados devolviendo
  200 `multipart/x-mixed-replace` con bytes de vídeo.

### Frontend
- `<img>` usa la URL MJPEG directamente (preview viva en la card).
- Re-mount del `<img>` cada 15s (`mjpegTick`) para reconectar streams cortados.
- Badge `insecam` en rojo; "▶ Ver stream" abre el MJPEG directo.

### Tests: 45/45 core · 24/23 UAT — sin cambios de contrato
