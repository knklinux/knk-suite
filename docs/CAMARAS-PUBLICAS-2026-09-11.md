# Cámaras públicas en directo — diagnóstico y módulo nuevo

**Fecha:** 2026-09-11
**Ámbito:** `knk-suite` (repo) + bundle de la app de escritorio (`src-tauri/target/release`).

## 1. Por qué el módulo de cámaras no mostraba stream

Se revisaron los cuatro caminos que existían. Ninguno podía pintar vídeo público:

| Ruta / sección | Qué devolvía | Por qué no se veía nada |
|---|---|---|
| `GET /api/osint/cameras` (`camera-index.js`) | Observaciones indexadas (Shodan/Insecam/Windy) | **Por diseño** no devuelve ninguna URL de reproducción. Es un catálogo pasivo. |
| `OSINT → Cámaras Externas` (`/api/camera/external-search`) | Lista de buscadores (Shodan, FOFA, Censys…) + dorks | Devuelve **enlaces a webs de terceros**, ni un solo stream. La UI no tiene reproductor para esta sección. |
| `OSINT → Escáner Local` (`/api/camera/scan-local`) | Cámaras de la LAN con URLs MJPEG/RTSP | Requiere `nmap` en el host; además las URLs son `http://192.168.x.x/...`, que **el CSP del escritorio bloquea**. |
| `OSINT → Auditoría IP` (`/api/camera/audit`) | Puertos, marca y streams de una IP concreta | Igual: MJPEG de host remoto bloqueado por CSP; RTSP no se reproduce en un navegador. |

Tres causas reales, por orden de importancia:

1. **No existía ninguna fuente pública que devolviera un stream reproducible.** Todo lo "de cámaras" era
   indexación o enlaces de búsqueda. Sin URL de imagen, no hay reproductor posible.
2. **El CSP del workbench de escritorio bloquea medios de terceros.** En `src-tauri/tauri.conf.json`:
   `img-src 'self' data: http://127.0.0.1:8086`. Cualquier `<img src="http://192.168…">` o de un host
   externo se bloquea en silencio (no aparece ni el error de red).
3. **La app de escritorio no ejecuta el backend del repo.** El `.exe` arranca una **copia**:
   `src-tauri/target/release/backend/index.js`, y sirve `src-tauri/target/release/frontend/dist/`.
   Es decir, tocar `backend/` y reconstruir el frontend **no cambia nada** en la app abierta.

## 2. Catálogo: todas las cámaras abiertas, no solo tráfico

`backend/lib/public-webcams.js` agrega **fuentes públicas oficiales** con snapshot real, sin claves de pago:

| Fuente | Categoría | Región | Cámaras | Origen |
|---|---|---|---|---|
| `dgt` | Tráfico | España | ~1.858 | DGT etraffic (JSON ofuscado base64+XOR) |
| `madrid` | Tráfico | Madrid | ~357 | Ayuntamiento de Madrid, KML `CCTV.kml` |
| `tfl` | Tráfico | Londres | ~890 | TfL JamCams Open Data |
| `digitraffic` | Meteorología | Finlandia | ~2.264 | Fintraffic/Digitraffic `weathercam v1` (requiere gzip) |
| `vegagerdin` | Meteorología | Islandia | ~500 | Vegagerðin (carretera, glaciares, volcanes, puertos) |
| `windy` | Webcams | Mundo | — | Windy Webcams API (clave gratuita propia) |

**Total sin clave: ~5.869 cámaras.** Con la clave de Windy se añade cobertura mundial de cualquier temática.

Cada fuente declara `kind` (`traffic` | `weather` | `webcam`), `region`, `country` y su atribución.
Añadir una fuente nueva es un objeto en `SOURCES` + su función de listado + su patrón de id.

### Vista "todas las fuentes"

`GET /api/cameras/public?source=all` mezcla todas las fuentes activas:

- **entrelaza** los resultados por fuente, para que la rejilla no enseñe 48 cámaras de la misma red seguidas;
- una fuente que falla se reporta en `sources` **sin tumbar la vista** (p. ej. Windy sin clave);
- acepta `kind=traffic|weather|webcam` para filtrar por categoría;
- devuelve `sources` con el recuento por fuente, que la UI muestra como tira de estado.

## 3. Rutas

- `GET /api/cameras/public/sources` — catálogo, `kindLabels` y estado de configuración.
- `GET /api/cameras/public?source=&lat=&lon=&radius=&q=&kind=&limit=&page=` — listado (proxy-friendly).
- `GET /api/cameras/public/snapshot?source=&id=` — snapshot JPEG same-origin; **reintenta una vez** si la
  fuente devuelve el fichero vacío (habitual en DGT mientras regenera la imagen).
- `GET /api/cameras/local/relay?url=` — relay de tu propia LAN (ver §5).

Montado en `backend/index.js` bajo `/api`, después de `auth.requireToken`.

### Por qué el proxy resuelve el problema

La UI **nunca** apunta a la URL remota: pide `/api/cameras/public/snapshot?...` al backend, y el backend
trae la imagen. Consecuencias:

- el CSP del escritorio no hay que tocarlo (sigue siendo `'self'`, no se abre a terceros);
- no hay CORS ni contenido mixto (todo es `http://127.0.0.1:8086`);
- el renderer no conoce ningún host externo.

## 4. Contrato de seguridad del módulo

1. **Dos allowlists estrictas.** `LIST_HOSTS` (JSON/KML de listado) y `SNAPSHOT_HOSTS` (bytes de imagen).
   Cualquier otro host se rechaza antes de abrir el socket.
2. **Identificadores validados por formato** por fuente: `dgt` 3-10 dígitos, `tfl` `\d{5}\.\d{5}`,
   `madrid` 5 dígitos, `digitraffic` 6-12 alfanuméricos en mayúsculas, `vegagerdin` `[a-z0-9_-]`, `windy` dígitos.
3. **Bases de imagen constantes.** La URL remota se construye con una base fija + el id ya validado; nunca
   se deriva del HTML o del JSON de la fuente. En Islandia se exige además que la URL del listado empiece
   por `https://www.vegagerdin.is/vgdata/vefmyndavelar/` (un host ajeno se descarta).
4. **Sin redirecciones**: si el origen responde 3xx, se rechaza en lugar de seguirlo.
5. **Límites**: 6 MB por imagen, `Content-Type` obligatorio `image/*`, timeouts de 12-25 s.
6. **Solo fuentes que publican abiertamente.** No se conecta a cámaras privadas, expuestas ni indexadas
   por terceros, y una observación nunca se etiqueta como vulnerabilidad.
7. Caché de listados con TTL de 10 min para no martillear a la fuente pública.

## 5. Relay de red privada (`/api/cameras/local/relay`)

Para poder ver también las cámaras de **tu** red autorizada dentro del escritorio sin abrir el CSP a la LAN,
el backend sirve el snapshot como `http://127.0.0.1:8086/...`. Validación deliberadamente estrecha:

- solo IPv4 privada RFC1918 (`10/8`, `172.16/12`, `192.168/16`);
- **nunca** loopback (`127/8`) ni link-local/metadata (`169.254/16`) ni CGNAT;
- solo puertos HTTP de cámara (`80`, `443`, `8000`, `8080`, `8443`);
- sin credenciales embebidas en la URL, sin caracteres de control, sin seguir redirecciones;
- sigue exigiendo el token/cookie local de `/api`.

## 6. Interfaz

`frontend/src/components/PublicCameras.jsx` (módulo 🎥 en `INTELIGENCIA`, `frontend/src/App.jsx`):

- selector de fuente agrupado con `<optgroup>` por categoría + **🌍 Todas las fuentes** (por defecto);
- chips de categoría (Tráfico / Meteorología / Webcams) cuando la fuente es «todas»;
- búsqueda por carretera, ciudad, región o fuente;
- **📍 Mi ubicación** (geolocalización) y entrada manual de coordenadas (por si el WebView la bloquea);
- radio 10 / 25 / 50 / 100 / 250 / 1000 km y rejilla en vivo con **refresco automático** (5/10/30 s / off);
- mapa SVG sin dependencias: vista mundo o **zoom a la caja del radio** con anillo de distancia, puntos
  coloreados por categoría;
- visor ampliado, distancia desde tu posición, atribución de la fuente y tira de estado con el recuento por fuente.

## 7. La app de escritorio: hay que sincronizar el bundle

**Este es el motivo por el que un desarrollo reciente "no aparece" en la app.**

```
src-tauri/target/release/
├── backend/            ← copia del backend que ejecuta el .exe
├── frontend/dist/      ← copia de la SPA que sirve
└── knklinux-desktop.exe
```

Tras cambiar el backend o el frontend, refresca el bundle sin necesidad de toolchain Rust:

```bash
npm run build                        # reconstruye frontend/dist
bash scripts/sync-desktop-bundle.sh  # copia backend/ y frontend/dist al bundle
```

Después **cierra y vuelve a abrir** `knklinux-desktop.exe` (o mata el `node` de `:8086` para que el .exe
lo relance). Con Rust instalado, `npm run tauri:build` hace lo mismo de forma completa.

## 8. Verificado en vivo (2026-09-11)

| Prueba | Resultado |
|---|---|
| `npm run test:cameras` | OK (`camera-index`, `camera-audit`, `public-webcams`) |
| `npm test` | 1 fallo **preexistente y ajeno** (`kali.runtimes` devuelve `local-tools` y `backend/test.js` espera 3 runtimes; ambos son ficheros nuevos sin commitear de otro cambio en curso) |
| `npm --prefix frontend run build` | OK (aviso de chunk > 500 kB) |
| `GET /api/cameras/public/sources` | 6 fuentes con categoría; `windy` marcada como sin clave |
| `source=dgt` / `madrid` / `tfl` | 1.858 / 357 / 890 cámaras |
| `source=digitraffic` / `vegagerdin` | 2.264 / 500 cámaras |
| `source=all` | **5.869 cámaras**, entrelazadas por fuente, con recuento por fuente y error de Windy aislado |
| `source=all&kind=weather` | 2.764 cámaras (digitraffic + vegagerdin) |
| `source=all&lat=36.7213&lon=-4.4213&radius=50` | 104 cámaras de tráfico; la más cercana a 2,9 km (MA-20) |
| `snapshot` de las 5 fuentes activas | `image/jpeg` en todas; 20/20 OK en DGT tras el reintento |
| `snapshot` con `id=../../etc/passwd` | rechazado (502, identificador inválido) |
| `relay` con `http://127.0.0.1:8086/api/status` | rechazado (502, solo RFC1918) |
| Bundle de escritorio (`target/release`) | mismas rutas OK + SPA nueva servida |

Comprobación en el navegador (DOM del preview): vista por defecto en «todas las fuentes», 48 tarjetas con
snapshot real, chips de categoría presentes y selector con las 6 fuentes agrupadas.

## 9. Pendiente / siguientes pasos

- **Windy (mundo)**: sin clave el catálogo sin clave se limita a España, Reino Unido, Finlandia e Islandia.
  Con la clave gratuita de Windy el selector cubre webcams de todo el mundo y de cualquier temática.
- **Vídeo real, no solo snapshot**: HLS (`.m3u8`) requiere `hls.js` en el frontend; el proxy ya está
  preparado para servirlo, falta el reproductor.
- **Más fuentes oficiales**: ayuntamientos y agregadores estatales con snapshot JPEG encajan en el mismo
  contrato (un objeto en `SOURCES` + parser + patrón de id).
- **Local MJPEG por el relay**: `OSINT → Escáner Local` sigue mostrando las URLs directas de la LAN y el
  CSP las bloquea en el escritorio. Conectar esa sección al relay cierra el caso por completo.
- **Arreglar el test de `kali.runtimes`** para que la expectativa incluya `local-tools`.
