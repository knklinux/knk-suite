# Portable — mantenimiento y rebuild (`scripts/build-portable.sh`)

**Fecha:** 2026-09-15 · **Alcance:** edición portable Windows (`knkLinux-portable-<versión>-win64.zip`)

## El problema que resuelve

Hasta la v4.2.0 el portable se ensamblaba a mano (cirugía de ZIP con
`python` ad-hoc en el Escritorio). Eso provocó el incidente de la release:
**el ZIP publicado se cortó ~15 minutos ANTES del fix `/bootstrap` y del
módulo Repeater**, y salió a distribución sin ninguna de las dos cosas. La
verificación de entonces fue manual y el proceso no era repetible.

`scripts/build-portable.sh` convierte ese proceso en un comando determinista,
con verificación de integridad y marcadores SIEMPRE activa y boot test
opcional del propio ZIP.

## Uso

```sh
# completo: prune + boot test (recomendado para release)
scripts/build-portable.sh "$HOME/Desktop/knkLinux-portable-<versión>-win64.zip" --prune --boot-test

# sin prune (node_modules íntegro, como la v4.2.0 original)
scripts/build-portable.sh "$HOME/Desktop/knkLinux-portable-<versión>-win64.zip"

# re-build rápido: toma el ZIP portable más reciente del Escritorio como esqueleto
scripts/build-portable.sh --boot-test
```

Requisitos previos:

1. `npm run build` (el `frontend/dist/` fresco es obligatorio — el script
   se niega a arrancar sin él; el incidente v4.2.0 fue exactamente un dist
   viejo dentro del ZIP).
2. El shell Tauri en `src-tauri/target/release/knklinux-desktop.exe`
   (`npm run tauri:build`). Debe ser la MISMA build que el NSIS/MSI de la
   release (el script verifica el hash contra el zip).
3. `python` 3 y `node` en PATH.

Salida: `dist-portable/knkLinux-portable-<versión>-win64.zip` (no toca el
esqueleto ni nada del Escritorio) + el SHA-256 impreso.

## Qué hace, por fases

| Fase | Qué | Fallo → |
|---|---|---|
| 1. Ensamblado | Copia del esqueleto todo lo que NO se refresca (`node_modules/`, `runtime/`, `data/`, `assets/`, `config.json`), superpone `backend/` completo (sin logs ni `evidencia-poc/`), `frontend/dist/`, el exe del shell y el `LEEME.txt` (con cabecera "Novedades del build" idempotente). Tolerante a entradas ilegibles del esqueleto (las cuenta y avisa). | exit 1 |
| 2. Verificación | `testzip` (integridad de TODAS las entradas) + marcadores: ruta `/bootstrap` en el backend, módulo Repeater, bundle del dist referenciado y presente (y "Repeater" dentro del bundle), `runtime/node.exe`, node_modules ≥ 1.500 ficheros. | exit 1 |
| 3. `--boot-test` | Extrae el contenido necesario del ZIP resultante y arranca su backend con **su propio node embebido** en un puerto libre: `/api/health` → 200, `/bootstrap` → 200 + `Set-Cookie: knk_token=…`, `/api/findings` → 401 (gate). Limpia el temp. | exit 1 |

## El prune (`--prune`): qué se quita y por qué

Footprint medido sobre el portable v4.2.0 (node_modules = 201 MB
descomprimidos, 155 paquetes top-level, 4.916 ficheros):

| Objetivo | Peso descomprimido | Por qué sobra en producción |
|---|---|---|
| `@tauri-apps/cli-win32-x64-msvc` | 15,2 MB | Binario del CLI de Tauri para CONSTRUIR el shell; el exe ya viene compilado |
| `@tauri-apps/cli` | 0,4 MB | Ídem (JS wrapper) |
| `concurrently` | 0,4 MB | devDependency (npm run dev) |
| `@xterm/xterm` + `@xterm/addon-fit` | 5,9 MB | Terminal del FRONTEND: ya va minificada dentro de `frontend/dist` |
| `rxjs` | 4,5 MB (2.277 ficheros) | Dependencia en profundidad de @xterm |
| `better-sqlite3/src/`, `better-sqlite3/deps/` | (~55 MB del paquete) | Fuentes C/C++ y amalgamation SQLite para COMPILAR; el binario `build/Release/better_sqlite3.node` se conserva |
| `node-pty/src/`, `node-pty/deps/`, `node-pty/scripts/` | (~65 MB del paquete) | Ídem para el binario del pty |

Total esperado: ~25 MB de ZIP y ~7.500 ficheros menos.

### Qué NO se prune (decisión deliberada)

`whisper-node`, `serialport`, `@serialport/parser-readline`, `puppeteer` y
`uuid` tienen `require()` **lazy con try/catch** (voice.js, flipper.js,
liligo*.js, screenshot.js, routes.js): la suite degrada con elegancia si
faltan, pero mientras estén declarados como dependencias del backend se
quedan — un portable "que funciona menos" sin decirlo es una regresión
peor que unos MB más. Si algún día se decide recortarlos, es una línea en
`PRUNE_PKGS` de `scripts/build-portable.sh` + una prueba de que los módulos
afectados responden bien al fallback.

## Notas de diseño

- **Prune determinista**: el recorrido del esqueleto conserva el orden
  original y el filtro es una lista fija → el diff del ZIP entre builds es
  estable (relevante para el secret-check del pre-commit y gitleaks en CI).
- **El esqueleto nunca se modifica**: todo sale a `dist-portable/`.
- La copia del `LEEME.txt` prueba utf-8 → cp1252 → latin-1 (el del ZIP
  v4.2.0 está en cp1252) y añade la cabecera de novedades solo si no existe.
- El boot test reutiliza la batería de comprobaciones del arranque limpio
  documentada en `docs/BOOTSTRAP-COOKIE-KNK-TOKEN-2026-09-14.md`
  (`/bootstrap` es la ruta que planta la cookie `knk_token` en el primer
  arranque sin datos previos).

## Checklist para la próxima release

```sh
npm run build            # dist fresco
npm run tauri:build      # shell + NSIS/MSI
scripts/build-portable.sh --prune --boot-test
# → subir dist-portable/knkLinux-portable-<versión>-win64.zip como asset
#   y anotar su SHA-256 en las notas de la release
```
