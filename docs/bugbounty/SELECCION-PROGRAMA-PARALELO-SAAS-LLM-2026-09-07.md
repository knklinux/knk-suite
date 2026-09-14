# 🎯 Selección de programa paralelo: SaaS con chatbot/LLM en scope — 2026-09-07

> Objetivo: aplicar la metodología OWASP LLM ya entrenada (guía §15, checklist
> 7/11) en un programa con **menos competencia** que OpenAI mientras el flag
> anti-abuso se enfría. Criterios de la guía §14: superficie LLM real en scope
> explícito, triage competente, duplicados bajos, alcance desde cuentas free.

## 1) Panorama general (fuente: análisis wraith.sh "State of LLM Bug Bounties 2026")

Datos clave del estudio sectorial 2026:
- La "cola larga" de SaaS con IA bolted-on en H1/BC = **menos competencia y
  bugs novel**, pero triage variable (el mismo bug puede pagarse un día y
  cerrarse como informational al siguiente → el framing del reporte lo decide).
- Clases que pagan de verdad: tool-abuse→SSRF, cross-tenant exfil, secretos en
  system prompt, inyección indirecta vía contenido de terceros, **paid-feature
  bypass** (lógica de negocio).
- Mediana real: $500–$2.500 (los titulares de $15-50k son casos críticos de infra).

## 2) Los 3 finalistas evaluados

### 🥇 1. Zendesk (Bugcrowd — `bugcrowd.com/engagements/zendesk`) — RECOMENDADO

| Criterio | Evaluación |
|---|---|
| **LLM en scope** | ✅ **"Zendesk AI — In scope"** EXPLÍCITO en la tabla de targets (verificado en la página del engagement). Es el agente IA de soporte (Fin + Agentes IA + Copilot de agentes) con acceso a tickets reales de clientes → superficie LLM01/02/06 exacta |
| **Impacto potencial** | Alto: el agente lee contenido de terceros (emails de clientes, macros, artículos) = playground de inyección indirecta; acceso a datos de tickets de otros customers = cross-tenant |
| **Pago** | P1 $5.000–…, Managed Engagement (triage de Bugcrowd profesional) |
| **Competencia** | Media-baja: el programa es conocido por web clásica, pero la parte "Zendesk AI" es reciente y poca gente la trabaja con metodología LLM específica |
| **Accesibilidad** | Trial free del producto con agente IA activable — testeable sin pagar |
| **Fit con nuestra kit** | Perfecto: todo nuestro armamento (A/B de cuentas, canario de exfil, detección de IDOR, V13) es aplicable; el checklist §15 de la guía calca su superficie |

### 🥈 2. Brave Software (HackerOne — `hackerone.com/brave`)

| Criterio | Evaluación |
|---|---|
| **LLM en scope** | ✅ Sección explícita "**LLM and AI Agent Security**" en su policy: "Only LLM vulnerabilities with **direct, verifiable security impact** are in scope" — Leo (asistente del navegador) + agente de página |
| **Impacto potencial** | Alto y novedoso: browser-wide prompt injection vía contenido de páginas (ya demostrado públicamente en Comet por otros researchers — Brave Leo tiene superficie análoga menos auditada) |
| **Pago** | Tabla estándar de Brave; los LLM con impacto directo pagan bien |
| **Competencia** | Baja-media: poca gente lee la policy entera; la sección LLM es nueva |
| **Accesibilidad** | Navegador gratis, Leo activable — coste cero |
| **Fit** | Muy bueno para LLM01 indirecto (nuestro E16 entrena exactamente esto), aunque el A/B cross-account es menos natural que en SaaS multitenant |

### 🥉 3. Proton (directo — `proton.me/security/bug-bounty`, email security@proton.me)

| Criterio | Evaluación |
|---|---|
| **LLM en scope** | 🟡 Implícito: Lumo (su asistente IA privacy-first) está en el ecosistema de productos; la policy paga "confidentiality or integrity of user data" en general (hasta $100k critical) pero **no lista IA explícitamente** como categoría |
| **Impacto potencial** | Alto (privacidad = su marca; un bleed en Lumo sería crítico para ellos) |
| **Pago** | El más alto de los tres si aterriza: High $2.500–$25.000 |
| **Competencia** | Baja — poco conocida la vía de reporte, y casi nadie ha trabajado Lumo |
| **Riesgo** | Sin VRT/plataforma: adjudicación a panel propio, sin safe-harbor de plataforma estándar → más riesgo de cierre subjetivo; requiere pregunta previa por email ("¿Lumo está en scope?") antes de tocar |

## 3) Recomendación

**Zendesk como objetivo principal**, Brave como segundo hilo en paralelo,
Proton solo si la consulta previa por email confirma Lumo in-scope por escrito.

Razón decisiva: es el único de los tres con **IA explícita en la tabla de
targets de la plataforma** (sin ambigüedad de policy), triage profesional de
Bugcrowd, y una superficie que ya sabemos atacar con nuestro kit completo
(multi-tenant de tickets = nuestro flujo A/B natural; agente con lectura de
contenido de terceros = inyección indirecta tipo E16;paid-feature gates = VRT
de lógica de negocio).

## 4) Plan de arranque cuando el usuario lo apruebe

1. **Cuenta de prueba**: registro trial Zendesk + activar agente IA/Fin si el
   trial lo permite (si requiere pago → decidir; nunca comprar sin confirmar).
2. **Recon (1 sesión)**: surface-map del agente IA (endpoints del chat,
   conversation_id, tools del agente, RAG de artículos) con el mismo método
   bundle+CDP que en OpenAI. Burp al proxy como siempre.
3. **Checklist de la guía §15** sobre el agente: LLM01 directa → 07 → IDOR de
   conversation → metadatos → indirecta con canario propio → paid-bypass.
4. **Anti-duplicados día 1**: known-issues del programa (Zendesk AI, Fin,
   copilot, agent) ANTES del primer test activo, como manda nuestra guía §8.
5. **Reglas heredadas**: rate limit 3 s, V13 activo en todo el tráfico,
   canario propio, cuentas propias, nada de DoS, nada de terceros reales.

Nota de cumplimiento: este doc es solo selección de objetivo — no se ha
enviado ninguna petición a ningún target nuevo todavía.
