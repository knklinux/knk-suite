# Zendesk — Resultados de sesión 2026-09-08

## Resumen ejecutivo

**Hallazgos confirmados:** 2  
**Vectores no ejecutables:** 3 (AI agent no existe en trial)  
**Reporte inmediato:** 0 (ninguno alcanza severidad bounty)  

---

## Hallazgos confirmados

### 1. HC API sin autenticación (BAC potencial)

```
GET https://autonomo-49965.zendesk.com/api/v2/help_center/es/articles.json → 200
GET https://autonomo-49965.zendesk.com/api/v2/help_center/es/articles/30133851884188.json → 200
```

- **Estado:** El Help Center está en estado "restricted" (requiere login en browser), pero la API REST devuelve el contenido completo sin autenticación.
- **Impacto:** Cualquier visitante puede leer el HC completo vía API.
- **Severidad estimada:** LOW-MEDIUM (depende del contenido del HC; en un HC con datos sensibles sería HIGH).
- **Reportabilidad:** ⚠️ Marginal — el HC solo tiene 1 artículo de muestra. En producción con datos reales sería reportable.
- **Evidencia:** `evidencia-poc/http/zendesk-agent-check-session.json`

### 2. Widget config endpoint devuelve 404

```
GET https://ekr.zdassets.com/compose/df3d609f-14a9-4a77-b441-73602a4aaab2 → 404 "No product configs exist"
```

- **Estado:** El endpoint de configuración del widget (ekr) devuelve 404 para nuestra cuenta.
- **Impacto:** El widget se carga pero sin configuración de producto — funciona como chat básico sin AI/RAG.
- **Severidad:** INFO (config issue, no vulnerability).
- **Evidencia:** curl output arriba.

---

## Vectores no ejecutables (AI agent no existe)

### AI Agent: 0 agentes (copilot confirmó)

> "Your account currently has **0 custom agents**. No agents have been created yet."

**Causa:** El trial de Zendesk (Suite Team, 12 días restantes) no incluye la funcionalidad de AI Agent Builder. Los endpoints de API devuelven 404:
- `/api/v2/ai_agents` → 404
- `/api/v2/ai/custom_agents` → 404
- `/api/v2/bots` → 404

### Vectores bloqueados

| Vector | Blocker | Desbloqueable |
|---|---|---|
| H2-Z (RAG metadata) | Sin agent no hay qué preguntar | No (necesita plan pago) |
| E16-Z (poisoned tickets → canario) | Sin agent no procesa tickets | No (necesita plan pago) |
| H1-Z (IDOR conversations) | Sin agent no se crea conversation_id | No (necesita plan pago) |
| HC Article Poison (RAG injection) | Widget no tiene AI/RAG config | No (necesita plan pago) |

---

## Lo que SÍ funciona en la instancia

| Componente | Estado |
|---|---|
| Admin login | ✅ Activo |
| Messaging channel (Web Widget) | ✅ Activo, canal "autonomo" conected |
| HC articles (1 de muestra) | ✅ Legible sin auth |
| Visitor session (sessionToken) | ✅ Creado vía widget |
| Canary tunnel | ✅ `breed-signals-here-automation.trycloudflare.com` |
| Copilot admin | ✅ Funcional, responde preguntas |

---

## Decisión: ¿reportar o no?

**No reportar todavía.** Razones:
1. HC API sin auth es un hallazgo real pero el HC solo tiene 1 artículo de muestra — no hay impacto demostrable.
2. Los vectores de AI agent no son ejecutables en el trial.
3. El widget sin configuración no tiene superficie de ataque IA.

**Opciones:**
- **(a)** Esperar a que el trial se upgrade a un plan con AI agent (si lo hay).
- **(b)** Buscar otro target con AI agent funcional.
- **(c)** Reportar el HC API sin auth como Informational/Low si el HC contiene datos sensibles en producción.

---

## Kit Zendesk (archivos creados hoy)

```
backend/zendesk-session-all.js     — Sesión completa: login + agent check
backend/zendesk-find-agent.js      — Búsqueda profunda de agentes
backend/zendesk-agent-deep.js      — DOM analysis del agent builder
backend/zendesk-iframe-copilot.js  — Análisis de iframes + copilot
backend/zendesk-agent-status.js    — Status completo vía API + copilot
backend/zendesk-widget-test.js     — Test del widget como visitante
backend/zendesk-widget-v2.js       — Widget con context handling corregido
backend/zendesk-hc-poison.js       — E16 article poison (403 en API)
backend/zendesk-hc-poison-v2.js    — E16 v2 con fetch desde admin
backend/zendesk-e16-final.js       — E16 completo (0 hits, sin AI)
backend/zendesk-gen-agent.js       — Búsqueda Generador de agentes
backend/zendesk-ai-agents-workspace.js — URL mapping de AI agents
```

## Próximos pasos sugeridos

1. **OpenAI V5** (10-sep): siguiente ventana de prueba del flag.
2. **E13 follow-up** (12-14 sep): comprobar estado en Bugcrowd panel.
3. **Zendesk**: decidir si buscar otro target con AI agent funcional o esperar.
