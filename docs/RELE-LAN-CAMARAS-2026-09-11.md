# Relé de cámaras de la LAN — 2026-09-11

Estado: **implementado y verificado** (backend + frontend + tests + bundle de escritorio).

## El problema

El Escáner Local (`/api/camera/scan-local`) y la Auditoría IP (`/api/camera/audit`) ya
devolvían los streams de cada cámara:

```json
{ "type": "mjpeg", "url": "http://192.168.1.64:8080/ISAPI/Streaming/channels/101/httpPreview" }
{ "type": "rtsp",  "url": "rtsp://192.168.1.64:554/Streaming/Channels/101" }
```

El componente pintaba `<img src={url}>`. Funcionaba en un navegador normal y **no** en la
app de escritorio, porque el CSP de Tauri es `img-src 'self' data: http://127.0.0.1:8086`:
el WebView bloquea la imagen **en silencio** (sin error de red visible) y la UI acaba
mostrando "no se pudo conectar al stream" con la cámara perfectamente operativa.

## La solución

El backend hace de **proxy same-origin** y el renderer solo habla con `127.0.0.1`:

```
<img src="/api/cameras/local/stream?url=http%3A%2F%2F192.168.1.64%3A8080%2F...">
        │
        └─ backend ──► cámara de la LAN
```

No hay que abrir el CSP, ni tocar CORS, ni pelear con contenido mixto.

## Rutas nuevas

| Ruta | Qué hace |
|---|---|
| `GET /api/cameras/local/stream?url=` | Reenvía el stream en cuanto llegan las cabeceras del origen: sirve tanto `multipart/x-mixed-replace` (MJPEG en directo) como un `image/*` suelto. |
| `GET /api/cameras/local/relay?url=` | Un único fotograma completo (buffered). Es el que usa el modo 📷 del reproductor. |
| `GET /api/cameras/local/check?url=` | Diagnóstico: `{ ok, relayable, reason }` con el motivo en lenguaje humano. |

`stream` no puede usar buffer: un MJPEG nunca termina el cuerpo y esperar el final daría
timeout. Se hace `pipe` y se resuelve al empezar a fluir. El fotograma buffered se
implementa dentro del propio relé (`lan-relay.js`) y no delegando en el proxy de fuentes
públicas, para poder aceptar también cámaras **HTTPS con certificado autofirmado**
(típicas en `:8443`), que el proxy público rechaza por diseño.

## Barreras de seguridad (backend/lib/lan-relay.js)

* solo **IPv4 privada RFC1918** (10/8, 172.16/12, 192.168/16);
* solo **puertos HTTP de cámara** (80, 443, 8000, 8080, 8443) — que son justo los que
  descubre el escáner (`CAMERA_PORTS`), así que no se pierde ningún hallazgo;
* **nunca** loopback, link-local ni `169.254.169.254` (metadata cloud);
* **sin credenciales** embebidas en la URL y **sin seguir redirecciones** (seguir una
  permitiría saltar la allowlist);
* la respuesta debe ser `image/*` o `multipart/x-mixed-replace`. Un panel de
  administración que devuelva HTML **se corta con 502**, de modo que el relé no sirve
  para leer la interfaz de administración del router o de la cámara;
* `https://` se acepta con certificado autofirmado, **solo** para IPv4 privada ya
  validada;
* el visor manda `close` → se destruye la conexión contra la cámara (no quedan sockets
  colgados al cambiar de pantalla). Con 15 s sin bytes, se corta;
* tope de 6 MB por fotograma buffered.

## Qué cambió en la UI

* Nuevo `frontend/src/components/LanCameraFeed.jsx`: reproductor con dos modos
  (🎞️ MJPEG en directo / 📷 fotograma cada 3 s), cambio automático a fotograma si la
  cámara no sirve MJPEG, **fallback a la URL de snapshot** de la misma cámara si la
  principal falla, botón de reintento, copiar URL, panel ⓘ con origen/relé/modo y
  explicación del motivo cuando la URL no es relayable.
* `OSINT.jsx` usa ese reproductor en **Escáner Local** y en **Auditoría IP** (mismo
  `StreamPreview`), y avisa cuando un host tiene puerto HTTP abierto pero el escáner no
  conoce ruta de stream para esa marca.
* Las cámaras **externas** (IP pública encontrada en Shodan/FOFA) no se pueden relayar
  —el relé es solo para LAN— y ahora lo dice explícitamente en vez de mostrar un
  reproductor roto.

## Verificación (2026-09-11)

Cámaras de prueba en `192.168.1.18` (stub local que imita a una Hikvision, HTTP en
`:8080` y HTTPS autofirmado en `:8443`):

| Comprobación | Resultado |
|---|---|
| `stream` de un MJPEG (HTTP) | `200` `multipart/x-mixed-replace` + `X-Cam-Relay: private-lan-live`, ~1.751 bytes en 2 s |
| `stream` de una foto (HTTP) | `200` `image/jpeg` + `X-Cam-Relay: private-lan-snapshot` |
| `stream` de un MJPEG (HTTPS autofirmado, `:8443`) | `200` `multipart/x-mixed-replace`, 1.380 bytes en 2 s |
| `relay` de una foto (HTTPS autofirmado, `:8443`) | `200` `image/gif`, 34 bytes |
| `stream` de una página HTML | `502` `la cámara no devolvió imagen ni MJPEG (text/html)` |
| cámara caída | `502` `connect ECONNREFUSED 192.168.1.18:8080` |
| loopback (`127.0.0.1`) | `400` `solo IPv4 privada RFC1918` |
| puerto raro (`:8081`) | `400` `puerto no permitido: 8081` |
| RTSP | `400` + motivo «ábrelo en VLC» |
| sockets tras abortar el visor | ninguno `ESTABLISHED` contra la cámara |
| Escáner Local en la SPA | 3 cámaras, 2 reproductores cargando imagen real por el relé, 0 errores |
| Auditoría IP en la SPA | marca Hikvision, reproductores por el relé, RTSP como fila VLC |

Tests sin red: `npm run test:cameras` (incluye `backend/lan-relay.test.js`).

## Lo que falta de tu parte

El `.exe` de escritorio ejecuta una copia del backend en
`src-tauri/target/release/backend/`, así que hay que refrescarla:

```bash
cd knk-suite
bash scripts/sync-desktop-bundle.sh   # backend + frontend/dist al bundle
```

y después **cerrar y reabrir `knklinux-desktop.exe`**. Matar solo el `node` de `:8086`
deja la app sin backend.
