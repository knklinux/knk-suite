# Cámaras expuestas + filtros — 2026-09-11

Estado: **implementado y verificado** (backend + frontend + tests + bundle de escritorio).

Dos frentes:

1. **Cámaras Expuestas** (`cam-external`) pasó de ser una lista de enlaces a un módulo
   con filtros de verdad, plan de consultas por buscador y análisis de objetivos.
2. **Filtros de Cámaras Públicas**: orden, país, ocultar las que fallan y paginación.

Módulos relacionados: [`RELE-LAN-CAMARAS-2026-09-11.md`](./RELE-LAN-CAMARAS-2026-09-11.md)
(streams de la LAN por relé same-origin) y
[`CAMARAS-PUBLICAS-2026-09-11.md`](./CAMARAS-PUBLICAS-2026-09-11.md) (catálogo oficial).

---

## 1. Cámaras Expuestas

Antes: `/api/camera/external-search` devolvía seis enlaces a Shodan/FOFA/ZoomEye y unos
dorks; el único filtro (`country`) existía en el estado del componente pero **no tenía
control en la interfaz**.

Ahora hay un motor propio: `backend/lib/exposed-cameras.js`.

### Filtros

| Filtro | Qué hace | Dónde se aplica |
|---|---|---|
| `targets` | IPs, lista o CIDR (p. ej. `93.184.216.0/24`) | InternetDB, máx. **32** por tanda |
| `country` | 40 países frecuentes | consulta a cada buscador |
| `service` | 9 servicios: RTSP 554/8554, MJPEG 80, HTTP 8080, Hikvision 8000, HTTPS 8443, ONVIF, DVR Dahua 37777, Xiongmai 34567 | consulta a cada buscador |
| `brand` | 7 marcas con su CPE y su dork propio | consulta + marcado `brandMatch` |
| `preset` | 5 consultas cocinadas (webcams con captura, MJPEG abiertos, NVR/DVR, tráfico, con CVEs) | consulta a cada buscador |
| `port` | puerto abierto en **tus objetivos** | filtro local |
| `hasScreenshot` | `has_screenshot:true` | consulta (se avisa de que no aplica a InternetDB) |
| `vulnsOnly` | solo hosts con CVEs | filtro local + `vulns:` en la consulta |
| `minScore` | umbral de «parece una cámara» | filtro local |
| `sort` | probabilidad, puertos, CVEs o IP | orden local |
| `limit` | 25/50/100/200 | recorte local |

### ⚠️ Servicio ≠ puerto

`service` acota **la consulta que se pega en el buscador**. `port` filtra **tus
objetivos analizados**. Al implementarlo se confundieron y elegir `service: rtsp` vaciaba
la lista (3 objetivos analizados → 0 mostrados) porque se aplicaba el puerto 554 como
filtro local. Ahora van separados (`port` solo si se pide a mano), el resumen lo explica
en `notes` y hay un **test de regresión** que exige `filteredOut === 0` al elegir un
servicio.

### Plan de consultas

Cada filtro se traduce a la sintaxis de **Shodan, FOFA (base64), ZoomEye, Netlas, Censys
y GreyNoise**, con botón de copiar y de abrir. Se añaden dorks y comandos listos para
pegar (`nmap -iL objetivos.txt`, `curl internetdb.shodan.io/<IP> | jq`, `ffmpeg` de un
fotograma), todos con el recordatorio de alcance autorizado. Los términos repetidos se
deduplican por contención: preset + servicio no repiten `port:554`.

### Análisis de objetivos (Shodan InternetDB, gratis y sin clave)

Metadatos de un escaneo ya hecho: puertos, hostnames, CPEs, etiquetas y CVEs. Cada host
recibe una **puntuación 0-100 con motivos legibles** (554 → +40, CPE de marca → +35,
«cam/cctv» en el hostname → +20, CVEs → +20…), ordenable y filtrable. El resumen muestra
pedidos/analizados/probables/con CVEs/mostrados/filtrados/sin datos y el recuento por puerto.

### Barreras

* **Nunca** se contacta con los objetivos: no hay peticiones a ellos, ni streams, ni
  credenciales, ni explotación. Solo índices públicos.
* Las **redes privadas se rechazan** con motivo (loopback, 10/8, 172.16/12, 192.168/16,
  169.254/169.254) y no generan ni una consulta.
* Límite de 32 objetivos y 4 peticiones simultáneas, con timeouts de 8 s.
* El retorno lo declara: `semantics: 'public-index-metadata'` y un `warning` visible.

### Rutas y UI

```
GET  /api/cameras/exposed/options    catálogo de filtros (países, servicios, presets…)
POST /api/cameras/exposed/search     plan de consultas + análisis de objetivos
```

UI en `frontend/src/components/ExposedCameras.jsx`, integrada en el OSINT Hub como
sección **🛰️ Cámaras Expuestas** (la antigua «Cámaras Externas» y su componente
`ExternalCamResults` se retiraron en vez de dejarlos como código muerto).

---

## 2. Filtros de Cámaras Públicas

Los filtros de servidor ya existían (fuente, categoría, texto, centro+radio). Ahora:

| Nuevo | Detalle |
|---|---|
| **Orden** | relevancia, distancia, nombre, fuente o categoría (cliente, sobre lo cargado) |
| **País** | solo los códigos presentes en la selección cargada (sin listas inventadas) |
| **🙈 Ocultar las que fallan** | el reproductor avisa al padre cuando un snapshot falla; el chip indica cuántas y hay «↻ reintentar fallidas» |
| **⬇️ Cargar más** | paginación real de 48 en 48 sobre el catálogo completo (el backend ya soportaba `page`) |
| **Resumen de filtros** | «filtros: país: ES · orden: Distancia a mí» + botón «✕ limpiar filtros» |
| **Contador honesto** | «mostrando 20 de 5869 cámaras · 96 cargadas» |
| **Aviso de coherencia** | ordenar por distancia sin centro avisa en lugar de ordenar al azar; cada tarjeta muestra ahora también su ciudad |

---

## Verificación (2026-09-11)

Tests sin red: `npm run test:cameras` → `camera-index · camera-audit · public-webcams ·
lan-relay · exposed-cameras` OK, y también desde el bundle del `.exe`.

Backend en vivo (`:8099`, token real):

| Comprobación | Resultado |
|---|---|
| `/cameras/exposed/options` | 9 servicios · 7 marcas · 5 presets · 40 países · 4 órdenes |
| `search` con 3 IPs reales y preset + servicio | 3 pedidos, **3 analizados, 3 mostrados, 0 filtrados** |
| Consulta Shodan resultante | `port:554 has_screenshot:true country:ES` (sin `port:554` duplicado) |
| Datos InternetDB reales | puertos 22/80/123/31337 y 53/80/443/8443/8880 + 1 host con CVEs |
| Red privada como objetivo | 0 consultas, motivo en `notes` |
| CIDR `/24` | recortado a 32 con nota; `/30`, `/31`, `/32` correctos (red y broadcast fuera) |

En la SPA (preview `:8099`):

* **Cámaras Expuestas**: filtros país/servicio/marca/puerto/puntuación/orden, presets y
  chips visibles; una búsqueda real pintó el plan (Shodan, FOFA, ZoomEye, Netlas, Censys,
  GreyNoise), 7 dorks, los comandos CLI, 3 objetivos con barra de puntuación y el resumen
  «3 pedidos · 3/3 mostrados · 0 filtrados · 0 sin datos».
* **Cámaras Públicas**: 48 tarjetas y «mostrando 48 de 5869 · 48 cargadas»; país = ES
  → 20 tarjetas; «cargar 48 más» → 96 cargadas y 39 visibles con el filtro de país activo;
  orden por distancia avisando de que falta el centro.

## Lo que falta de tu parte

El `.exe` ejecuta una copia del backend y su propio `dist/`, así que hay que refrescar el
bundle y reabrir la app:

```bash
cd knk-suite
bash scripts/sync-desktop-bundle.sh
```
