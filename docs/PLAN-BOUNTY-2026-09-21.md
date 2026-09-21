# PLAN BOUNTY — roadmap de la suite (2026-09-21)

Estado: P0 hecho y desplegado. P1 = caza inmediata, P2 = potencia, P3 = higiene.

## P0 — HECHO hoy (desplegado en portable, commits 3354afb/bbed56e/+)
- Dashboard: UNION con FROM (actividad 0→10) + migración defensiva (`backend/lib/dashboard.js`, `backend/db.js`).
- Hallazgos: `GET /findings?scope=all`, columnas `program`+`status` + backfill, `POST /findings/:id/triage`, panel con scope/programa/estado/triaje (`FindingsPanel.jsx`).
- Presets: openai/cloudflare/atlassian + `intigriti-generico` (`lib/presets.js`, `GET/POST /presets*`).
- Recon: `/recon/crtsh|wayback|doh|takeover|securitytxt|spfdmarc|investigate` (`lib/recon-hub.js`, anti-SSRF sin scope-gate, `resolvesInternal` exportado en `net.js`).
- Hub BB: `/hub/guide|decode` (`lib/bb-hub.js`, `lib/pause-brief.js` para takeover).
- Seguridad: docker start/stop con `execFileSync` + allowlist (CMDI).
- Cámaras: LiveCams recableado en `CamerasHub.jsx`.
- Asistente: chat unificado en `Assistant.jsx` (`Chat.jsx` eliminado), snapshot con programa/scope/triaje, auto-datos por palabra clave, 3 acciones rápidas (`lib/assistant-tools.js`).
- Modo BOUNTY/LAB: `LAB_MODULES` + `visibleGroups()` en `nav.js`, toggle en sidebar, paleta filtrada.

## P1 — Caza inmediata (orden sugerido)
1. **Verificar #62** (11 takeovers openai): aplicar preset `openai-bugcrowd`, HTTP a los 11 (blog→cloudfront primero), triar. ~30 min.
2. **Login helper + cookie-jar**: cuenta propia en dash/atlassian → sesión reutilizable por proxy/Repeater (`lib/net.js` jar + UI `Targets.jsx` "pegar cookies/sesión"). Sin esto casi todo es "sin login". Esfuerzo M.
3. **Programa visible**: topbar con programa+scope activos + preset a 1 clic; findings con programa real por defecto (no backfill de sesión). S.
4. **Plantillas de reporte** por plataforma (Bugcrowd/H1/Intigriti markdown) + duplicate-check contra enviados (`lib/report.js`, `Reportes.jsx`). M.
5. **parse-program Intigriti**: extraer scope/reglas de la ficha (`lib/program-parser.js`). S.

## P2 — Potencia Burp-parity
6. **Site-map Target**: árbol navegable de lo visto por proxy+wayback (`surface-map` ya genera datos; falta UI). M.
7. **Import OpenAPI/cURL/Burp-XML** → Repeater/Intruder. M.
8. **Intruder grep-match/extract + pitchfork** (hoy sniper básico). M.
9. **Proxy**: búsqueda/filtros en historial + match&replace + scope por fila. M.
10. **E13**: retomar con el flujo verificado (DoH+HTTP+cert). —

## P3 — Higiene y deuda
- Export PDF, terminal `?tab=`, VBoxManage absoluto, auto-datos también en `/assistant/talk` (fallback), unificar fork de prompts (`assistant.js` vs `system-prompts.js`), revisar modelos/caps (`num_predict`, top vault), arreglar `smoke-assistant-stream` (elapsedMs, roto en refactor a medias del otro agente).
- GitHub: `retention-days: 7` en `upload-artifact` (linux-desktop.yml, windows-portable.yml), borrar artefactos viejos y assets de releases antiguas (conservar última). Revisar job que falla con su log.
- Tests: `npm run test:modules` en CI tras cada fusión; no desplegar sin `fusion.test.js` en verde.

## Notas de fusión
- Commits mezclan trabajo pendiente del otro agente (sin commitear) + fusión: contenido a salvo, atribución mezclada. No hacer push sin revisar `git log`.
- No desplegar backend copiando carpetas con `Copy-Item` (anida): usar `robocopy src dst /E`.
