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

## 🔜 TODO
- [ ] Soporte para screenshots automáticas (puppeteer/playwright)
- [ ] Export a PDF del reporte
- [ ] Integración con HackerOne/Bugcrowd API
- [ ] Modo headless para CI/CD
- [ ] Notificaciones desktop en hallazgos críticos
- [ ] Múltiples sesiones simultáneas
- [ ] Historial de reportes con diff