# KnkSuite v2 — TODO / Roadmap
# ======================

## ✅ Done (v2.0)
- [x] Backend Express 1 puerto (:8086)
- [x] Pipeline 7 fases: PLAN → RECON → SCAN → FUZZ → EXPLOIT → REPORTE → VERIFICAR
- [x] GUI web SPA (dashboard, OPPLAN, pipeline, compuertas, reportes, chat LLM)
- [x] Docker Kali con herramientas de pentest
- [x] Ollama integrado (hermes3 + fallback)
- [x] User-Agent personalizable por programa
- [x] Scope enforcement en todas las peticiones
- [x] Rate limit configurable por programa
- [x] Reportes con requisitos estrictos de evidencia (screenshots + curl + PoC)
- [x] Verificador triager con checks reales
- [x] Acceso directo .desktop
- [x] Evidencia guardada en ~/.knk-suite/evidencia/

## ✅ Done (v2.1 — auditoría de seguridad)
- [x] Scope estricto: sin scope no hay tráfico; wildcards corregidos; out-of-scope con prioridad
- [x] SSRF: bloqueo de loopback, redes privadas, link-local, IPv6 local, metadata y DNS rebinding
- [x] Redirects fuera de scope bloqueados; protocolos restringidos a http/https
- [x] Rate limit con jitter y tope de ráfagas
- [x] Evidencias con SHA-256 y límite de tamaño
- [x] API key (KNK_API_KEY) para HTTP y WebSocket
- [x] Docker exec: solo herramientas allowlist, argumentos tokenizados sin shell
- [x] OPPLAN obligatorio: aprobado + autorización escrita + target en scope
- [x] Dry-run y revisión humana obligatoria en EXPLOIT/REPORTE
- [x] Reportes sin flags ficticios (evidencia/explotación reales)
- [x] Servidor solo en 127.0.0.1; CORS restringido
- [x] server.js marcado DEPRECATED (código muerto)
- [x] Persistencia de reportes por sesión (slug único por sesión)
- [x] Smoke tests: 12 unitarios + smoke del servidor con autenticación

## ✅ Done (v2.1 — mejoras)
- [x] Screenshots automáticos con Puppeteer (validación de scope/SSRF, hash) — requiere `npm install`
- [x] Integración HackerOne segura: parser de scope por texto + borrador H1 + checklist
- [x] Exportación a HTML imprimible a PDF
- [x] Diff entre versiones de reporte
- [x] Modo headless (CI/CD): `npm run headless -- --check | --dry-run | --export-report FILE`
- [x] Workflow GitHub Actions (test + build + smoke)
- [x] Threat Hunting: IoCs, escaneo de logs, anomalías y mapeo MITRE ATT&CK (tab UI + API)
- [x] Vite/esbuild actualizados — 0 vulnerabilidades

## 🔜 Futuro (opcional)
- [ ] Envío automático a HackerOne vía API oficial (requiere credenciales seguras y revisión humana)
- [ ] Notificaciones desktop en hallazgos críticos
- [ ] Múltiples sesiones simultáneas
- [ ] Dashboards de métricas de caza (tiempo por hallazgo, tasa de duplicados)
