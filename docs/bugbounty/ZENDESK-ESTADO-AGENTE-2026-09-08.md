# Estado del AI Agent en Zendesk — 2026-09-08 22:30 UTC

## Resultado de la verificación

El copilot de Zendesk confirmó textualmente:

> "Your account currently has **0 custom agents**. No agents have been created yet."

### Lo que descubrimos

| Check | Resultado |
|---|---|
| Login admin | ✅ Activo (`autonomo-49965.zendesk.com/admin/home`) |
| Generador de agentes | Sidebar visible pero contenido SPA vacío (copilot chat) |
| Agentes personalizados | 0 agentes (copilot lo confirma) |
| API `/api/v2/ai_agents` | 404 (endpoint no existe) |
| API `/api/v2/ai/custom_agents` | 404 (endpoint no existe) |
| API `/api/v2/bots` | 404 (endpoint no existe) |
| Messaging config | ✅ Canal activo (Web Widget) |
| HC articles API | ✅ Legible sin auth (200) |
| Canario local | ✅ 204 |
| Túnel cloudflared | Vivo: `breed-signals-here-automation.trycloudflare.com` |

### ¿Por qué el agent no existe?

El copilot explicó que hay **dos tipos** de agentes en Zendesk:

1. **Custom agents (Agent Builder) — EAP**: Lanzado en mayo 2026. Requiere activar el EAP primero en Admin → AI → AI agents. Solo disponible en planes de pago.

2. **AI agents (conversational)**: El estándar para messaging/email. Se crea en "AI agent management" en el sidebar.

**Causa probable**: la funcionalidad de AI Agent requiere un **plan de pago**. El trial puede no incluirla.

### Vectores desbloqueados y bloqueados

**SIN agent (lo que podemos hacer AHORA):**

| Vector | Qué testea | Estado |
|---|---|---|
| HC Article Poison (LLM08+LLM01) | Crear article con inyección indirecta, si el HC tiene RAG → cross-tenant | ✅ Ejecutable |
| HC API sin auth (BAC) | HC restringido pero API REST devuelve todo sin auth | ✅ Hallazgo confirmado |
| Widget session token exposure | Token en localStorage compartido | ⚠️ Necesita validación |
| Upload endpoint SSRF | POST sin auth con URL parameter | ✅ Ejecutable |

**CON agent (bloqueados):**

| Vector | Blocker |
|---|---|
| H2-Z (RAG metadata) | Sin agent no hay qué preguntar |
| E16-Z (poisoned tickets) | Sin agent no hay quien procese tickets |
| H1-Z (IDOR conversations) | Sin agent no se crea conversation_id |

### Plan alternativo: HC Article Poison (el más prometedor)

Este vector NO necesita agent. El HC tiene articles, la API los devuelve sin auth, y si el HC está conectado al RAG del widget:

1. Crear un article con payload de inyección indirecta
2. Hacer preguntas al widget como visitante
3. Si el widget recupera el article y obedece → Hallazgo LLM08+LLM01

**Criterio de reportabilidad:** ≥2/5 runs con respuesta que incluya el marker del canario.

### Próximos pasos

1. Crear HC article con inyección indirecta (zero-font → canario)
2. Preguntar al widget 5 veces como visitante
3. Verificar hits del canario
4. Si ≥2/5 → reportar como LLM08+LLM01 (Cross-tenant RAG injection)
