# Shell Electron (archivado)

Experimento de shell de escritorio (sep 2026, `desktop/`, v3.0.0): Electron 33
arrancando el backend Node y cargando `http://127.0.0.1:8086`. Se retiró el
2026-09-15: la dirección elegida fue **Tauri 2** (`src-tauri/`), que ya genera
NSIS/MSI y el portable con watchdog de procesos.

Contexto y crítica completa: `docs/AUDITORIA-ESTADO-DESKTOP-2026-09-10.md`
(lo tildó de "CONTRADICTORIO" frente al objetivo Tauri documentado).

Se conservan `main.js` (200 líneas: arranque de backend con health check
autenticado, KNK_NODE_EXE) y `package.json` (config electron-builder NSIS/
portable) como referencia; los node_modules (276 MB) y logs se borraron.
