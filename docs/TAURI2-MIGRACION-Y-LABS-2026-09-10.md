# Tauri 2 + Laboratorios — estado de migración

**Fecha:** 2026-09-10  
**Producto:** knkLinux Security Workbench 4.0  
**Alcance:** migrar el shell Electron existente a Tauri 2 manteniendo backend Node/Express, contratos `/api`, autenticación loopback y WebSocket de terminal.

## Decisión

Se elige **Tauri 2** como shell objetivo. El backend no se reescribe en Rust en esta fase: continúa siendo el proceso local Node que ya contiene SQLite, Ollama, Kali, OSINT, autenticación y la terminal WebSocket. Tauri administra el ciclo de vida desktop y sirve el `frontend/dist` generado por Vite.

El shell Electron queda como referencia histórica hasta que el binario Tauri se compile y se pruebe en una máquina limpia. No se declara completada la distribución final mientras el entorno de build no tenga Rust/Cargo, WebView2 y las dependencias nativas recompiladas.

> La configuración actual usa el backend loopback como origen de la ventana en runtime (`http://127.0.0.1:8086`) para conservar exactamente la cookie HttpOnly y el WebSocket ya existentes. En la prueba de `tauri dev` hay que confirmar que el capability remoto loopback y el CSP funcionan correctamente; si Tauri exige un esquema local para el IPC, se pasará a un bridge local mínimo sin abrir permisos de filesystem.

## Qué se ha ejecutado

- Creado `src-tauri/Cargo.toml`, `build.rs`, `src/main.rs`, `tauri.conf.json` y `capabilities/default.json`.
- Tauri arranca el backend en `127.0.0.1:8086`, espera el puerto y mantiene parada limpia del proceso.
- La UI Tauri usa el mismo `frontend/dist`; en desarrollo conserva `npm --prefix frontend run dev`.
- Se mantiene el contrato de token local del backend y el almacenamiento de datos en `~/.knk-suite`.
- Se añade adaptador `frontend/src/desktop-api.js`: invocación Tauri 2 en desktop y fallback web en desarrollo.
- Se añade botón para abrir la ventana flotante del asistente; el hash `#assistant` mantiene la misma experiencia y memoria local.
- Se crea `backend/lib/vm-labs.js` con catálogo, detección de VirtualBox/libvirt/WSL2, inventario y arranque/parada únicamente de máquinas detectadas.
- Se crean rutas autenticadas: `GET /api/labs/catalog`, `GET /api/labs/inventory`, `POST /api/labs/start`, `POST /api/labs/stop`.
- Se añade módulo visual `Labs.jsx` al menú tipo torreta.
- Se añade `backend/vm-labs.test.js` sin tráfico de red ni cambios en VMs para validar las barreras.
- Se instala en el workspace `@tauri-apps/cli` 2.11.4 y se sincronizan los lockfiles.
- `npx tauri info` confirma WebView2 y MSVC disponibles, pero Rust/Cargo ausentes.
- `npx tauri build --debug` llega a la fase de toolchain y queda bloqueado únicamente por `cargo metadata: program not found`.

## Contratos de seguridad preservados

1. Backend escucha en loopback salvo configuración explícita.
2. `/api/*` exige cookie/token local y origen/socket loopback.
3. WebSocket de terminal exige la misma autorización.
4. El renderer Tauri no tiene `nodeIntegration` ni acceso directo a filesystem.
5. Las capabilities Tauri no conceden permisos de filesystem; solo core y apertura externa.
6. El módulo de VMs no acepta comandos libres: solo nombres que aparecen en el inventario local y usa listas cerradas de proveedor/acción.
7. El módulo de cámaras sigue separado: fuentes públicas/indexadas no son vulnerabilidades; auditoría activa solo en red privada autorizada.

## Procedimiento ejecutado y resultado

| Paso | Resultado |
|---|---|
| `npm install --ignore-scripts` | OK |
| `npm --prefix frontend install --ignore-scripts` | OK |
| `npm test` | 45 pasaron, 0 fallaron |
| tests cámara/índice | OK |
| `node backend/vm-labs.test.js` | OK |
| `npm --prefix frontend run build` | OK; warning de chunk >500 kB |
| `npx tauri --version` | OK — 2.11.4 |
| `npx tauri info` | WebView2/MSVC OK; Rust/Cargo ausentes |
| `npx tauri build --debug` | Bloqueado en `cargo metadata` por falta de Cargo |

## Instalación pendiente para cerrar el binario

En Windows, instalar Rust mediante rustup (acción de máquina, no ejecutada automáticamente desde el proyecto), abrir una terminal nueva y comprobar:

```powershell
rustup default stable
rustc --version
cargo --version
npx tauri info
npm run tauri:dev
npm run tauri:build
```

Durante `tauri dev` se debe comprobar específicamente: cookie `knk_token`, `GET /api/health`, WebSocket de terminal, capabilities remotas loopback, CSP, apertura del asistente y cierre del proceso Node.

## Pendientes bloqueados o deliberadamente no automatizados

- Instalar Rust/Cargo en este entorno: `cargo` no está disponible aquí y requiere modificar el entorno del usuario.
- Generar y probar el instalador firmado: requiere toolchain y máquina limpia.
- Descargar imágenes de Metasploitable/DVWA/OWASP BWA: requiere decisión del usuario, espacio y verificación de procedencia.
- Arrancar una VM real: requiere que el usuario confirme proveedor, nombre exacto y aislamiento de red.
- Descargar automáticamente Qwen: no se hace sin revisar RAM/VRAM y espacio local.
- Cambiar definitivamente el nombre/versión del shell Electron o borrarlo: se conserva hasta la aceptación del binario Tauri.

## Lista de tareas de producto

### P0 — cierre de migración

- [x] Estructura Tauri 2 y CLI local.
- [ ] Instalar Rust + CLI Tauri 2 en la máquina de build.
- [ ] Ejecutar `npm run tauri:dev` y verificar backend, cookie, API, WebSocket y capabilities.
- [ ] Ejecutar `npm run tauri:build` en Windows y Linux objetivo.
- [ ] Probar instalador en máquina limpia y registrar hashes.
- [ ] Recompilar/probar `better-sqlite3` y `node-pty` para el runtime distribuido.

### P1 — laboratorios

- [x] Catálogo y detección de proveedores.
- [x] Inventario local de VMs.
- [x] Arranque/parada de máquinas conocidas.
- [ ] Asistente de importación con checksum y licencia.
- [ ] Perfil de red: host-only/NAT/aislada, visible antes de arrancar.
- [ ] Snapshots y reset seguro por proveedor.
- [ ] Fixtures locales para probar inventario sin tocar VMs reales.

### P1 — asistente/IA

- [x] Assistant y Chat comparten historial local.
- [x] Rutas de modelo se basan en modelos instalados.
- [x] Qwen queda en catálogo, no se descarga por sorpresa.
- [ ] Streaming/cancelación de respuestas.
- [ ] Benchmark de modelos con hardware real.
- [ ] STT/TTS local completo con licencia validada.

### P1 — OSINT/cámaras

- [x] Estado real de Shodan sin exponer la clave.
- [x] Separación de observación pública/indexada y red autorizada.
- [x] Auditoría local limitada y con confirmación.
- [ ] Confirmar `SHODAN_API_KEY` vigente mediante `/api/osint/status`.
- [ ] Añadir caché/presupuesto de consultas y evidencia persistente.

### P2 — producto

- [ ] Persistencia de jobs/eventos en SQLite.
- [ ] Auditoría hashada de evidencias y OPPLAN.
- [ ] Export PDF/SARIF/diff.
- [ ] Layout torreta configurable y accesibilidad completa.
- [ ] CLI Linux reutilizando contratos.
