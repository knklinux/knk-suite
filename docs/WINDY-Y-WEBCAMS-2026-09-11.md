# Windy + webcams del mundo — 11/09/2026

Petición: «el tema de windy y webcams no salen».

## Diagnóstico

**Windy no sale porque no tiene clave y la clave no se puede evitar.** La API v3
de Windy Webcams devuelve `401 Unauthorized` con cualquier clave vacía o
inválida, y el plan gratuito exige registro propio en
<https://api.windy.com/webcams/docs>. No existe fuente equivalente que sea
«mundo + cualquier temática» y sin clave: lo que sí hay son **más DOTs
oficiales con catálogo abierto**, y esas sí se pueden añadir de verdad.

Verificado en vivo durante el diagnóstico:
- `https://api.windy.com/webcams/api/v3/webcams` → `{"error":"Unauthorized","statusCode":401}`.
- El panel ya lo trataba bien (fuente «sin clave», sin tumbar la vista), pero el
  aviso solo se veía al abrir el selector, y el contador decía «6 fuentes» clavado.

## Lo añadido (todo keyless y verificado en vivo)

| Fuente | Región | Cámaras | Imagen |
|---|---|---|---|
| `caltrans` | California, EE. UU. | **858** en servicio (de 7 distritos con JSON estable) | JPEG estático cada ~5 s |
| `ny511` | Estado de Nueva York | **1.860** activas | PNG vía visor público de 511NY |

Con las 8 fuentes activas, `source=all` sirve **8.587 cámaras** (antes 5.869).
La fuente `ny511` marca además `video` (HLS) en 1.555 cámaras: el listado de
511NY publica la URL de la playlist de vídeo; el chip «▶ HLS» en la tarjeta lo
señala.

Detalles de implementación:
- **Caltrans**: el catálogo son 11 JSON de distrito (`cwwp2.dot.ca.gov/data/dN/cctv/…`);
  los que devuelven 500 de forma estable se ignoran sin tumbar la fuente. Del
  JSON solo se extrae el *basename* de la imagen (validado por patrón) y el
  distrito: la URL final se reconstruye con la base constante, nunca con la
  cadena remota.
- **511NY**: `https://511ny.org/api/getcameras` es pública; el snapshot se sirve
  del visor `/map/Cctv/<índice>` con el índice validado por formato. Las URLs de
  vídeo se pasan como metadato (no se proxean).
- Ambos hosts entraron en `LIST_HOSTS` y `SNAPSHOT_HOSTS`; el resto de barreras
  (sin redirecciones, sin credenciales, solo `image/*`, límites de tamaño)
  se aplican igual.

## Ajustes de UI

- «🌍 Todas las fuentes» muestra el número real de fuentes.
- Si hay fuentes pendientes de clave, un chip amarillo junto al selector lo dice
  sin abrir nada: `🔑 windy: clave gratuita pendiente (config.json)`, con el
  detalle en el tooltip. Windy sigue apareciendo deshabilitada en el selector.

## Cómo activar Windy (única fuente que lo necesita)

1. Crea una cuenta en <https://api.windy.com/webcams/docs> (plan **FREE**).
2. Copia la clave en `knk-suite/config.json`:
   ```json
   { "windyApiKey": "TU_CLAVE" }
   ```
   (o arranca con la variable de entorno `WINDY_API_KEY`).
3. Reinicia el backend; la fuente pasa a «configurada» y entra en `source=all`.

## Verificación

- `npm run test:cameras` → 6 suites verdes, incluidos los parsers nuevos y sus
  barreras (hosts ajenos, cámaras fuera de servicio, ids con inyección).
- En vivo: `source=all` → 8.587 cámaras, 7 fuentes ok + Windy avisando;
  snapshots reales por el proxy: Caltrans 19.265 B (JPEG) y 511NY 119.996 B
  (PNG); `id=../../etc/passwd` sigue rechazado.
- Bundle del escritorio resincronizado y verificado (backend + SPA).

## Pendiente de ti

**Cerrar y reabrir `knklinux-desktop.exe`** para que arranque el backend nuevo,
y poner tu clave gratuita de Windy si quieres el catálogo mundial.
