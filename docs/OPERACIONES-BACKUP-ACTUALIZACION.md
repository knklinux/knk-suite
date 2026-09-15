# knkLinux — Operaciones: backup, actualización, despliegue

## Datos que importan

| Ruta | Contenido | Frecuencia de backup |
|---|---|---|
| `knk-suite/data/*.sqlite` | Sesiones, hallazgos, memoria, evidencias | semanal / antes de actualizar |
| `vault-knklinux/` + bóveda Downloads | Cerebro de conocimiento | semanal |
| `knk-suite/data/model-routes.json` | Asignación de modelos por ruta | con la config |
| `knk-suite/evidencia-poc/` | Evidencias de operaciones | por engagement |

## Backup

```bash
# Backup completo (desde la carpeta raíz del repo)
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p backups/$STAMP
cp knk-suite/data/*.sqlite backups/$STAMP/ 2>/dev/null
cp -r vault-knklinux backups/$STAMP/vault-producto
cp -r "$USERPROFILE/Downloads/conocimientoo" backups/$STAMP/vault-conocimiento 2>/dev/null
echo "backup en backups/$STAMP"
```

## Restaurar

1. Cierra knkLinux (ventana y procesos node).
2. Copia los `.sqlite` de vuelta a `knk-suite/data/`.
3. Restaura las carpetas de bóveda a sus rutas originales.
4. Arranca y verifica con `node backend/test-uat.js`.

## Actualizar dependencias

```bash
cd knk-suite
npm test                                  # estado verde antes de tocar nada
npm update                                # deps raíz con cuidado
npm --prefix frontend run build
node backend/test-uat.js                  # 17 checks deben pasar
```

Regla: si la UAT falla tras una actualización, se revierte antes de seguir desarrollando.

## Despliegue local (otro PC)

1. Instala Node ≥ 18 y Ollama.
2. Copia la carpeta del proyecto + backups.
3. `cd knk-suite && npm run setup` (instala deps frontend+raíz).
4. `npm --prefix frontend run build`.
5. `npm start` o `cd desktop && npm start` para la app de escritorio.
6. Descarga modelos: `ollama pull hermes3` (+ el coder que uses).
7. Verifica con `node backend/test-uat.js`.

## Instalador Windows

Resuelto con **Tauri 2** (`src-tauri/`): `npm run tauri:build` genera NSIS y MSI
(además del ZIP portable vía `scripts/build-portable.sh`). El antiguo shell de
Electron (`desktop/`) se retiró el 2026-09-15; su código queda archivado en
`docs/historical/electron-shell/`.

## Salud y monitorización

- `GET /api/health` — subsistemas con estados honestos (usar para vigilancia).
- `node backend/test-uat.js` — UAT completa contra un backend vivo.
- Logs del backend: consola del proceso (visible si no es `--windowStyle Hidden`).
