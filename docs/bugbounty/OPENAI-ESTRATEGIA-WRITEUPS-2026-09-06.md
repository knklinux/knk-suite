# 🧭 Estrategia de caza — basada en writeups de otros hunters — 2026-09-06

> Fuentes analizadas:
> 1. **"When GPTs Call Home: Exploiting SSRF in ChatGPT's Custom Actions"** — SirLeeroyJenkins (Open Security), infosecwriteups, 10-nov-2025. SSRF en custom GPT Actions → IMDS de Azure → token de gestión de Azure. OpenAI lo valoró **HIGH** y lo parcheó.
> 2. **Salt Labs (2024)** — "Security Flaws within ChatGPT Ecosystem": (a) instalación de plugins maliciosos sin aprobación del usuario, (b) account takeover vía OAuth en docenas de plugins, (c) 0-click en GitHub/Google Drive vía plugins.
> 3. **OpenAI Safety Bug Bounty (anuncio oficial 25-mar-2026)** — programa separado que paga por agentic risks (prompt injection + exfiltración, reproducible ≥50 %), MCP, info propietaria OpenAI, integridad de cuenta/plataforma.

---

## 1) Qué demuestran los writeups (lecciones directas)

### Writeup SSRF en custom GPT Actions (HIGH, patched nov-2025)
- Superficie: **"Add Actions" de custom GPT** → el modelo recibe una URL controlable y el servidor la fetcha. Acepta **solo HTTPS** en el schema… pero **sigue redirecciones 302** → SSRF bypass a `http://169.254.169.254`.
- Bypass del header `Metadata: True` de Azure IMDS → se mete un **API key custom llamada `Metadata` con valor `True`** en la auth de la acción.
- Resultado: token de Azure Management API → acceso directo a la nube de OpenAI.
- **Moraleja:** el fetch server-side de URLs controladas por el modelo es superficie real y pagada. El parche de nov-2025 cerró el vector exacto; **variantes** (otras herramientas con fetch: browsing, DALL·E image gen, connectors, ingestion de URLs, `estuary/content`) pueden seguir vivas.

### Salt Labs 2024 (ecosistema plugins/GPTs)
- Hallazgo 1: **instalación de plugin sin aprobación** (directo en ChatGPT).
- Hallazgo 2: **account takeover vía OAuth** en decenas de plugins (manejo del state/token por los desarrolladores de terceros; 0-click en GitHub/Drive).
- Moraleja: el flujo **OAuth de conectores/plugins** y la **instalación cross-account** (nuestro V10 con `install_attempt_id`/`account_id`) son la versión moderna de este research. OpenAI "arregló mucho" con GPTs Actions, pero la clase sigue siendo la misma.

### Programa Safety BB (2026) — el giro estratégico
- Nuestros vectores cerrados como "model issues → fuera de scope en Bugcrowd" **sí son elegibles aquí**:
  - Inyección indirecta → exfiltración vía ChatGPT Agent/Browser (≥50 % reproducible).
  - Riesgos **MCP** (¡nuestra superficie gated de connectors!).
  - Fuga de información propietaria (razonamiento, config interna).
  - Integridad de cuenta (anti-automatización, trust signals).

---

## 2) Plan de caza por pista

### Pista A — Bugcrowd Security (lo que ya tenemos)
1. **E13 (SAS upload_url)** → revisar panel Bugcrowd (Known Issues, duplicados, scope
   `*.oaiusercontent.com`) y, si pasa, enviar el informe EN final. Es nuestro único
   candidato LOW con informe listo.
2. **V9 handoff** (`/api/auth/handoff/bind|inspect`) → A/B con sesiones vivas; takeover
   lógico, riesgo de duplicado bajo. Ejecutable ya.
3. **V10 plugins** (`install_attempt_id`/`account_id` cross-account) → la versión moderna
   de Salt Labs 2024. Cuidado con rate limit; no instalar plugins de terceros reales.

### Pista B — Safety Bug Bounty (nuevo, alta prioridad estratégica)
Los 5 escenarios del lab CLLMSE se convierten en candidatos reales aquí:

| Escenario lab CLLMSE | Traducción al programa Safety | Cómo probarlo (solo cuentas propias) |
|---|---|---|
| **1. Inyección indirecta** | Texto de atacante que secuestra un agente de la víctima → exfiltración ≥50 % | B publica/crea un share o GPT con instrucciones maliciosas (`SYNTHETIC-*`) que ordenen al agente enviar el resumen del chat a una URL del investigador; A abre el share → medir exfiltración reproducible |
| **2. Envenenamiento RAG** | Archivos/URLs que envenenan el contexto → el agente actúa según contenido ajeno | Archivo de biblioteca compartido con instrucciones ocultas; verificar si el agente de A las obedece en ≥50 % de intentos |
| **3. SSRF vía URL generada por LLM** | Variantes del parche de nov-2025 | Re-test con nuestras cuentas: ¿el fetch de Actions/browsing sigue redirecciones 302 a IPs internas? ¿Headers custom siguen permitidos vía API key? (solo si se habilita GPT con Actions) |
| **4. Agencia excesiva** | El agente hace algo dañino "no listado" con impacto material plausible | GPT con Actions que llama a endpoints con efectos (siempre recursos sintéticos propios) |
| **5. Rug-pull MCP** | Cadena de suministro MCP | Si alguna cuenta consigue `upload_with_custom_mcp_servers`: registrar un MCP server controlado y comprobar qué tokens/permisos recibe (cumpliendo ToS de terceros) |

**Regla del programa Safety:** reproducible ≥50 % → cada PoC debe incluir N intentos
(≥5) y el conteo de éxitos, no un único caso.

### Pista C — Integridad de cuenta/plataforma (Safety o Security)
- Anti-automatización: ¿se puede manipular una señal de confianza de cuenta (flag,
  score, dispositivo) vía un campo de la API?
- Evasión de restricciones: ¿una cuenta sancionada puede re-registrarse o re-activar
  con un campo manipulable?
- Cuidado extremo: esto roza anti-abuso; solo con cuentas propias y recursos sintéticos.

---

## 3) Prioridad recomendada para las próximas horas

| # | Acción | Riesgo | Esfuerzo |
|---|---|---|---|
| 1 | Revisar panel Bugcrowd para E13 (Known Issues/duplicados/scope) + decisión envío | — | 10 min (requiere login del investigador) |
| 2 | Ejecutar **V9 handoff** A/B (sesiones vivas) | Bajo | 30 min |
| 3 | Leer el brief del **Safety BB** (forms/detalles) y preparar PoC del escenario 1 (inyección indirecta ≥50 %) con cuentas propias | Bajo-medio (solo cuentas propias + recursos sintéticos) | 1-2 h |
| 4 | Re-test SSRF vía fetch de URLs (variante nov-2025) si se habilita Actions | Medio (duplicado alto si sigue parcheado) | 1 h |

## 4) Cumplimiento recordado (igual que siempre)

- Solo `chatgpt.com` (+ `cdn.oaistatic.com` assets); `pay.openai.com` y
  `community.openai.com` fuera; sin datos de terceros reales; sin compras;
  sin enumeración; rate 2,2 s; UA de investigación; PoC solo con recursos
  `SYNTHETIC-*` propios.
- En el Safety BB: respetar el ToS de terceros en cualquier test MCP; detenerse ante
  cualquier PII ajena; jailbreaks genéricos siguen fuera.