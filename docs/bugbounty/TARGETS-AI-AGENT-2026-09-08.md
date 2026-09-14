# Targets con AI Agent en scope — Análisis 2026-09-08

## Resumen ejecutivo

| Rank | Target | Plataforma | Scope AI | Bounty max | Competencia | Kit OWASP mapea |
|---|---|---|---|---|---|---|
| 🥇 | **Cloudflare** | HackerOne | AI Agent + MCP + Prompt Injection | $20,000+ | Media | ✅ E16/E17/V13 |
| 🥈 | **0din (Mozilla)** | 0din.ai | OWASP LLM Top 10 completo | $15,000 | Baja | ✅ Todo el kit |
| 🥉 | **GitLab** | HackerOne | AI Duo agent + code generation | $10,000+ | Baja-Media | ✅ LLM01/05/06 |

## Detalle por target

### 1. Cloudflare (🥇 recomendado)

**Programa:** https://hackerone.com/cloudflare
**Scope AI explícito:** "AI Agent, MCP, and Prompt Injection Reports. Reports involving AI agents, MCP (Model Context Protocol) servers, AI-powered automation, or LLM-based tools."

**Superficie:**
- AI Playground (playground.cloudflare.com) — ya tiene CVE disclosed (CVE-2026-1721, XSS en OAuth)
- Workers AI — modelo de inferencia serverless
- AI Gateway — proxy de modelos con cache, logging, rate limiting
- MCP servers — Model Context Protocol integrations

**Vectores OWASP aplicables:**
- LLM01: Inyección indirecta vía contenido procesado por AI Playground
- LLM02: Fuga de datos cross-tenant en Workers AI
- LLM05: XSS/SSRF vía salida del LLM (ya hay CVEs de esta clase)
- LLM06: Agencia excesiva en MCP servers
- LLM08: RAG weaknesses en AI Gateway

**Por qué es el mejor:**
- Scope claro y explícito para AI agent + MCP
- Superficie rica con SSRF real (Workers AI)
- Bounty competitivo sin bar imposible
- Competencia manejable (técnico pero no saturado)

### 2. 0din / Mozilla (🥈 mejor para OWASP LLM puro)

**Programa:** https://0din.ai
**Scope:** "Prompt injection, guardrail jailbreaks, training data leakage, denial of service, OWASP LLM Top 10 categories."

**Proceso:** Abstract primero → 0din responde en 3 días con scope + payout estimado → PoC completo.

**Por qué:**
- El scope dice textualmente "OWASP LLM Top 10"
- Proceso de abstract = bajo riesgo de quemar tiempo
- $500-$15,000 por hallazgo
- Programa relativamente nuevo = menos competencia

### 3. GitLab (🥉 mejor para AI agent real)

**Programa:** https://hackerone.com/gitlab
**Scope:** AI-related vulnerabilities aceptados
**Reports disclosed:** Context Boundary Failure, TOCTOU + Prompt Injection en Duo

**Superficie:**
- GitLab Duo (AI agent para código)
- Issue-to-MR flow (prompt injection via issues → agent crea MR malicioso)
- Code suggestions (prompt injection via código fuente)
- CI/CD pipelines (agencia excesiva)

**Por qué:**
- AI agent con herramientas reales (crear MRs, ejecutar pipelines)
- Reports previos muestran que la superficie es vulnerable
- $10,000+ bounty potencial

## Targets descartados

| Target | Razón |
|---|---|
| Google AI VRP | Excluye prompt injection y jailbreaks explícitamente |
| Anthropic | Bar altísimo (universal jailbreak), $15K max |
| xAI/Grok | Scope poco claro, pagos no documentados |
| Superhuman/Grammarly | Prompt injection in scope pero surface pequeña |

## Plan de ataque para Cloudflare

1. **Recon (1-2 días):**
   - Crear cuenta Cloudflare (gratis, Workers AI tier gratuito)
   - Mapear AI Playground, AI Gateway, MCP endpoints
   - Identificar superficie de ataque con Burp

2. **Test (2-3 días):**
   - Aplicar kit: canario + V13 + drivers E16/E17
   - LLM01: inyección indirecta via contenido procesado
   - LLM05: XSS/SSRF via salida del LLM
   - LLM08: RAG weaknesses

3. **Reporte (1 día):**
   - Plantilla OWASP LLM (ya tenemos la plantilla del E13)
   - Cadena completa: payload → respuesta → impacto
   - Evidencia: screenshots + logs + canary hits

## Referencias

- Wraith: "The State of LLM Bug Bounties in 2026" — wraith.sh/learn/state-of-llm-bug-bounties-2026
- Wraith: "AI Bug Bounty Programs 2026" — wraith.sh/learn/ai-bug-bounty-programs
- Cloudflare disclosed report: CVE-2026-1721 (AI Playground XSS)
- GitLab AI issue: #457798 (unsanitized content in AI features)
