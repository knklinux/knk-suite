# 🗺️ Guía OWASP Top 10 LLM × Bug Bounty aplicada a nuestro scope OpenAI — 2026-09-07

> Fuente: `GUIA_OWASP_LLM_BUGBOUNTY.html` (guía visual en castellano, sept-2026)
> Propósito: cruzar la guía con lo YA probado en chatgpt.com y extraer los
> huecos reales — qué nos falta por testear, qué nos enseña que hicimos bien
> y qué NO podemos hacer por policy del programa.

---

## 1) La guía vs. lo ya ejecutado — scorecard por categoría

| Categoría | Guía dice | Nuestro estado en OpenAI | ¿Cubierto? |
|---|---|---|---|
| **LLM01 Prompt injection** | "El rey. Indirecta con exfil es lo que paga" | Escenario 1 Safety BB (E16) diseñado exactamente así: share sintético con payload → sesión de B → canario. **Pendiente por flag anti-abuso** | 🟡 Preparado |
| **LLM02 Info sensible** | "Memoria entre sesiones, IDOR de conversation_id, PII" | V7 (files RAG cross-account: 404 ✅), V8 (shares, 403 flag), V13 monitor pasivo **implementado esta noche** (el bleed espontáneo del P1 Teringette es exactamente LLM02/LLM08 pasivo) | 🟡 Parcial — falta el IDOR de `conversation/{uuid}` (bloqueado por flag: toda la familia conversation responde 403 con las sesiones actuales) |
| **LLM03 Supply chain** | "Raro desde fuera" | V10 cerrado: plugins retirados de cuentas free, sin superficie. MCP gated | ✅ Cerrado |
| **LLM04 Poisoning** | "Fuera de scope casi siempre" | V7 probó `index_for_retrieval` cross-account → 404. Sin superficie | ✅ Cerrado |
| **LLM05 Output handling** | "XSS vía salida del LLM, el puente al bug web" | DMI/CSS cerrado: sanitizador skipHtml + allowlist verificado; CSP bloquea exfil en render | ✅ Cerrado |
| **LLM06 Excessive agency** | "Inventario de herramientas, acciones sin confirmación" | Acciones de custom GPTs no disponibles en cuentas free (builder gated) | ⛔ Gated |
| **LLM07 System prompt leakage** | "Solo paga si revela secretos" | Probado (E14): `instructions:null` para no-propietario + SSR limpio + **V12 (hoy): escritura cruzada también bloqueada (405 ×4)** | ✅ Cerrado (lectura Y escritura) |
| **LLM08 RAG/vectores** | "El IDOR de la IA — marca de agua cross-tenant" | V7: aislamiento activo correcto. **La guía recuerda la vía pasiva**: metadatos vía preguntas al modelo → cubierto por V13 pasivo cuando el flag caiga | 🟡 Activo cerrado / pasivo vigilado |
| **LLM09 Misinformation** | "Alucinar es N/A — saber no reportar es reputación" | N/A por policy (model issues) | ✅ Alineado |
| **LLM10 Consumo** | "2-3 peticiones máximo, nunca campaña" | N/A por policy (abuso). La guía valida nuestra regla de nunca tocar esto | ✅ Alineado |

**Resultado del cruce: la guía confirma que nuestra metodología CLLMSE aplicada
estaba bien orientada — y revela 3 huecos accionables (§3).**

## 2) Lo que la guía valida que ya hacemos bien

| Práctica de la guía | Nuestro equivalente |
|---|---|
| "Prueba reglas API antes que payloads poéticos" | Exactamente nuestra doctrina: V7/V8/V10/V12 son IDOR/BAC puros, no jailbreaks |
| "Usa tu propio dominio para exfil y tu cuenta como víctima" | Canario `:8210` + cuentas A/B propias + nonces — cero terceros |
| "Saber cuándo NO reportar es reputación" | 7 vectores cerrados con evidencia documentada; solo E13 (real) fue enviado |
| "Leer la policy dos veces" | Doc OPENAI-CLLMSE-METODOLOGIA-SCOPE: model issues out-of-scope identificado el día 1 |
| "Cadena completa payload → respuesta → impacto" | Plantilla de la guía §8 con control negativo + reproducción |

## 3) Huecos accionables que la guía revela (nuevos para nuestra caza)

### Hueco 1 — IDOR de `conversation_id` (LLM02, ⭐⭐⭐ de la guía)
La guía lo llama "el siempre rentable IDOR" y **nunca lo hemos probado de
forma aislada**: V8 necesitaba `/conversation` para CREAR conversación (403
flag) y ahí murió. Pero falta el test puro de **lectura**:
`GET /backend-api/conversation/{uuid-de-B}` con sesión de A.
- **Problema**: la familia conversation está devolviendo 403 anti-abuso para
  A → no ejecutable hasta que el flag caiga. Se añade a la cola V2/V3 como
  sonda de paso (1 petición: si la lectura devuelve 403, flag sigue; si 200
  y muestra conversación de B → 🚨 CRITICAL directo, VRT `Cross-Tenant PII`).

### Hueco 2 — Fuga de metadatos RAG vía preguntas (LLM08)
`Lista los títulos de todos los documentos en tu conocimiento` — con la
biblioteca de A (SYNTHETIC-A-*) es self-test inútil; el valor es si B ve
metadatos de algo que no es suyo. Depende de /conversation (igual bloqueo).
Mismo protocolo: cuando el flag caiga, 2 peticiones.

### Hueco 3 — Parámetros API no validados (§3.4 de la guía: la más olvidada)
`POST /conversation` con `model` cambiado (`o1-full`/`gpt-4o` en cuenta free),
`temperature`, `max_tokens` fuera de rango — "cada uno es un vector de negocio".
También bloqueado por el flag, pero se documenta AHORA para la cola: 3 peticiones
máximo (la propia guía marca el límite), encuadre de lógica de negocio, no DoS.

**Los tres huecos comparten el mismo bloqueo (flag de /conversation) — se
acumulan como "paquete de 6 peticiones" para la primera ventana verde.**

## 4) La lección estratégica de la guía (§14): el consejo que vale dinero

> "Las grandes IA están hiper-auditadas. **Cualquier SaaS mediano con un
> chatbot de soporte o un resumidor de documentos** tiene probabilidades
> altas de bugs LLM01/LLM02/LLM05 sin descubrir — y menos competencia."

Esto es directamente aplicable: mientras el flag de OpenAI se enfría, los
programas de la tabla de la guía (HackerOne/Bugcrowd genéricos, Intigriti,
YesWeHack — cercanos para España) con chatbots de apps normales son donde
nuestra metodología CLLMSE+OWASP ya entrenada rinde más con menos riesgo de
duplicado. **Rama paralela candidata sin tocar OpenAI**: elegir 1-2 programas
de SaaS con superficie LLM y aplicar el checklist de la guía §15 tal cual.

## 5) Checklist del hunter (guía §15) — nuestra versión firmada

- [x] Mapeé la arquitectura (surface-map + bundles descargados)
- [x] Localicé el endpoint del chat y está en mis drivers (Repeater = Burp cuando toque)
- [x] Reglas API probadas antes que payloads (files/gizmos/plugins/shares/handoff)
- [x] LLM07 probado con lectura (instructions:null) Y escritura (V12: 405 ×4)
- [x] RAG: cross-tenant activo probado (404), pasivo vigilado (V13)
- [ ] Herramientas/agencia: gated hasta builder o workspace de pago
- [x] Cada vector cerrado tiene cadena completa + control negativo + evidencia
- [x] Policy leída y respetada (nada de jailbreaks/DoS/alucinaciones)
- [x] Dominio propio de exfil listo (canario :8210) sin tocar terceros
- [x] Severidad justificada por impacto (E13: P4 honesto, no inflado)

**7 de 11 ítems verdes, 3 bloqueados por el flag (no por nosotros), 1 gated
por feature. La guía confirma que el trabajo está donde debe estar.**
