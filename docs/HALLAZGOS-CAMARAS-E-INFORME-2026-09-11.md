# Cámaras Expuestas → hallazgos de la misión con evidencia (2026-09-11)

Qué se ha construido: los objetivos analizados en **🛰️ Cámaras Expuestas** (IPs,
puertos, CPEs y **CVEs** del índice) se convierten en **hallazgos de la sesión**
(`findings`) con su **evidencia en disco**, y esos hallazgos salen ya redactados
en el **informe Markdown/HTML**.

Antes de esto el módulo era un callejón sin salida: analizabas, leías la lista y
la perdías al cambiar de pantalla (el informe no se podía generar: ver «Fallos
corregidos»).

---

## 1 · Flujo

```
Cámaras Expuestas            /api/cameras/exposed/search      (índices públicos)
        │                    └─ metadatos InternetDB, sin tocar los objetivos
        ▼
selección + opciones         /api/cameras/exposed/findings/preview
        │                    └─ plan exacto: qué se crearía, qué es duplicado,
        │                       qué se descarta y por qué (no escribe nada)
        ▼
convertir                    /api/cameras/exposed/findings
        │                    └─ hallazgo + evidencia .txt + fila en `evidence`
        ▼
misión                       GET /api/findings · /api/findings/export/{json,csv}
        ▼
informe                      GET /api/reports/<id|slug>/export/{md,html}
                             └─ Findings + Apéndice A (exposición en índices)
```

En la UI: cada objetivo tiene casilla, la barra superior resume
«se crearían N · N medium · N ya en la misión · N descartados · evidencia en
~/.knk-suite/evidencia» y los ya registrados aparecen con `✅ hallazgo #id`
(incluido un botón 🗑 para deshacer, que borra también la evidencia).

---

## 2 · Forma del hallazgo

Tabla `findings` (sin cambios de esquema): `type='camera-exposed'`, `summary`
legible, `severity` y `details` (JSON) con:

| Campo | Contenido |
|---|---|
| `asset` / `ip` | objetivo (IPv4 pública) |
| `score`, `confidence`, `isLikelyCamera` | puntuación 0-100 y confianza |
| `ports`, `cameraPorts`, `hostnames`, `cpes`, `tags`, `vulns` | lo observado en el índice |
| `reasons` | por qué el motor lo marcó |
| `links` | InternetDB y Shodan del activo |
| `verification` | `candidato-no-verificado` |
| `semantics` | `public-index-metadata` |
| `evidence` | rutas de los ficheros de evidencia |
| `reproduce` | comandos `curl`/URL para reproducir la consulta |
| `recommendation` | qué hacer con la exposición |
| `scopeNote`, `nextSteps` | límites de alcance y siguientes pasos |

### Severidad (razonada, no adivinada)

| Situación | Severidad |
|---|---|
| CVEs en el índice **y** el host parece cámara | `high` |
| CVEs en el índice sin señal de cámara | `medium` |
| Parece cámara sin CVEs | `medium` |
| Señales débiles (puntuación ≥ 20) | `low` |
| Sin señales | `info` (no se registra salvo «incluir dudosos») |

Se queda en `medium` cuando hay CVEs porque el índice los asocia **por CPE**, no
porque haya probado el fallo. El umbral de la UI («severidad ≥ low/medium/high»)
puede elevarlo, nunca bajarlo a escondidas.

### Qué no se convierte

Cada descarte se explica en la respuesta (`invalid`, `filtered`, `duplicates`,
`skipped`), nunca en silencio:

- **redes privadas** → `red privada: no se registra desde índices públicos`;
- ya registrado → `duplicates` con el `id` del hallazgo existente (dedup por activo);
- por debajo de `minScore`, sin CVEs (si el filtro está activo) o nivel `info`.

---

## 3 · Evidencia

Un fichero de texto por objetivo en `~/.knk-suite/evidencia/`
(`cam-exp-<ip>-<fecha>.txt`) y su fila en la tabla `evidence`. Contiene:

- objetivo, puntuación, fecha, fuente y sesión;
- puertos (y los de cámara), marca/CPE, hostnames, tags y **CVEs**;
- los motivos por los que el motor lo marcó;
- **cómo reproducirlo** (`curl -s https://internetdb.shodan.io/<ip> | jq .`);
- el registro saneado del índice en JSON;
- el aviso de que **KNK no ha contactado con el objetivo**.

Borrar el hallazgo (`DELETE /api/findings/:id`) borra su evidencia, pero **solo**
si el fichero está dentro de `~/.knk-suite/evidencia`: una ruta externa nunca se
toca (verificado en vivo: `deletedFiles: []` con un fichero fuera del directorio).

---

## 4 · Informe

`backend/lib/report-export.js` traduce las filas de la BD (que traen
`type/summary/severity/details`) a algo legible en vez de imprimir un JSON crudo:

- descripción por bloque (asset, origen, confianza, verificación, puertos, CPEs,
  CVEs, motivos, enlaces) + `Recommendation` + `<details>Evidence</details>` con
  rutas y comandos;
- contador de hallazgos con evidencia en el resumen ejecutivo;
- **Apéndice A — Public-index exposure (cameras)**: tabla `Asset | Severity |
  Score | Camera ports | CVEs in index | Evidence`, referencia cruzada de CVEs y
  los `curl` para reproducir, con el aviso de que son **candidatos, no
  vulnerabilidades confirmadas**;
- el apéndice solo aparece si hay hallazgos de índices públicos.

Rutas: `/api/reports/:id/export/md` y `/html`, donde `:id` puede ser **id de
sesión, id de reporte o slug** (la UI enlaza por slug).

También se arregló la exportación de hallazgos: `/api/findings/export/json`
devuelve `{target, exportedAt, count, findings[]}` con `asset`, `cves` y
`evidence`, y `/api/findings/export/csv` sus columnas equivalentes.

---

## 5 · Fallos corregidos por el camino

1. **El pipeline tiraba los `details`**: `ctx.addFinding` guardaba
   `type/summary/severity` y descartaba el resto, así que los hallazgos de las
   fases llegaban al informe vacíos.
2. **`/api/findings/export/{json,csv}` leía `sessions.findings`**, una columna
   que no existe: la exportación salía siempre `[]`.
3. **`DELETE /findings` hacía `UPDATE sessions SET findings = ...`** sobre esa
   misma columna inexistente: lanzaba error de SQL.
4. **El export del informe devolvía 500 siempre**: la ruta pasaba la fila cruda
   de SQLite y `scope` es el string `'[]'`; como `'[]'.length === 2`, entraba en
   la rama del array y reventaba con `forEach is not a function`. Se normaliza la
   sesión en la ruta (`parseSessionRow`) y el generador tolera array, string JSON
   o lista separada por comas.
5. **El HTML del informe salía sin encabezados ni tablas**: `toHTML` partía los
   párrafos antes de convertir los títulos, así que todo título precedido de una
   línea en blanco quedaba dentro de un `<p>`. Se reordenan los reemplazos
   (específicos primero, párrafos al final) y se escapa el contenido de
   `<pre>/<code>`.

---

## 6 · Límites de seguridad (deliberados)

- El análisis **no contacta** con los objetivos: solo lee índices públicos.
- El servidor **no confía en el cliente**: valida la IPv4, descarta redes
  privadas, comprueba el formato de cada puerto/CPE/tag/CVE (máx. 24 puertos,
  25 CVEs…) y **re-puntúa con el mismo motor** (`scoreCamera`), así que un
  navegador manipulado no puede inflar una severidad.
- 32 objetivos por tanda, con concurrencia y timeouts.
- El coste de la evidencia en disco es de un `.txt` por objetivo (≤ 256 KB).

---

## 7 · Verificado

- `npm run test:cameras` → **verde** (6 suites): `camera-index`, `camera-audit`,
  `public-webcams`, `lan-relay`, `exposed-cameras` y la nueva
  `camera-findings` (saneado y re-puntuación, severidad, dedup, filtros y
  descartes explicados, evidencia en disco en un temporal, barrera de rutas
  externas, render del informe con sesión cruda y apéndice).
- En vivo (backend en `:8101` con BD temporal, ya apagado):
  - conversión de 4 objetivos → **3 hallazgos** (`medium` con CVE + 2 `info`) y
    `10.0.0.7` rechazada por red privada;
  - segundo intento → **0 creados, 3 duplicados** con su `id`;
  - informe Markdown con Apéndice A (tabla, CVEs, evidencia y `curl`) y HTML con
    `<h1>`/`<h2>` y 3 tablas;
  - `findings.json` (count 3, con `asset`/`cves`/`evidence`) y `findings.csv`;
  - borrado del hallazgo #3 → fichero de evidencia eliminado y 2 hallazgos
    restantes; un hallazgo con evidencia **fuera** del directorio no borró nada.
- En la SPA (`:8099`): 2 objetivos analizados → 1 casilla marcada por defecto,
  barra con «➕ Convertir en hallazgos (1)» y previsualización del servidor
  («se crearían 1 · 1 medium · evidencia en ~/.knk-suite/evidencia»), 0 errores
  de consola. **No se ha convertido nada desde la UI para no escribir en la base
  de datos real.**

---

## 8 · Pendiente / conocido

- **Cerrar y reabrir `knklinux-desktop.exe`**: el `.exe` ejecuta su copia del
  backend; el bundle ya está resincronizado
  (`scripts/sync-desktop-bundle.sh`).
- **`npm test`** sigue fallando en `backend/test.js:690` (`kali.runtimes()`
  devuelve `local-tools` y el test espera 3 runtimes): es previo y ajeno a este
  cambio.
- La tabla §5 de `PLANTILLA-INFORME-SESION.md` tiene **5 columnas** y las filas
  generadas por `close-mission` emiten 6 (los datos van bien, la última columna
  «Regla / bloqueo» añade `cand-idx`, CVEs y evidencia). Ajustar la plantilla o
  las filas es una decisión de producto, no un bug de este cambio.

- Observado una vez al arrancar el backend sobre la base de datos compartida:
  `SQL query error: no such column: slug` en la consulta de actividad reciente del
  panel. Es una carrera de lectura mientras la app de escritorio reescribe
  `~/.knk-suite/suite.db`; el error está capturado (la lista sale vacía) y la
  consulta funciona con la base de datos ya cargada (`SELECT * FROM reports`
  muestra `slug`). Endurecerlo (comprobar el esquema antes de la consulta, o migrar
  columnas que falten) queda como mejora aparte.
