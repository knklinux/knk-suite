# 🎓 Metodología CLLMSE aplicada al scope OpenAI/Bugcrowd — 2026-09-06

> Propósito: traducir el manual CLLMSE (ataques a LLM: inyección directa/indirecta,
> jailbreaks, OWASP Top 10 LLM, SSRF vía URL generada por el LLM, agencia excesiva,
> cadena de suministro MCP/plugins, RAG/vectores) a la superficie REALMENTE en scope
> del programa OpenAI/Bugcrowd, con veredicto de testabilidad y de reportabilidad.
> Fuente del manual: `CLLMSE_Handbook-1.pdf` (apéndice B: red-team prompt & payload kit;
> laboratorio con 5 escenarios: inyección indirecta, envenenamiento RAG, SSRF vía URL
> no validada generada por LLM, agencia excesiva en agente tool-calling, rug-pull de
> cadena de suministro MCP).

---

## 0) Regla de oro antes de nada

El programa OpenAI/Bugcrowd (policy extraída el 2026-09-06) deja **fuera de scope**
los problemas de **comportamiento del modelo**: jailbreaks, "model issues" y
ejecución de código en sandbox. Traducción a la metodología CLLMSE:

- La **inyección de prompt como comportamiento del modelo** (jailbreak, DAN,
  Crescendo, PAIR, sufijos adversarios) **NO es reportable** en este programa.
- La metodología CLLMSE se vuelve útil aquí solo donde el ataque aterriza en la
  **capa de aplicación/plataforma**: control de acceso a objetos LLM (GPTs,
  plugins, MCP, archivos RAG), flujos OAuth de conectores, límites de agencia de
  herramientas, fuga de instrucciones/secretos, y cadena de suministro.

---

## 1) Mapa manual CLLMSE → superficie en scope

| # | Dominio CLLMSE | Superficie en chatgpt.com | ¿Testeable con A/B hoy? | Veredicto |
|---|---|---|---|---|
| 1.1 | LLM attack surface (entrada del atacante) | Tools del SPA: browsing, DALL·E, code interpreter, plugins, GPTs, files | Parcial (files/gizmos sí; browsing/code sandbox out-of-scope) | Solo capa app |
| 1.2 | Prompt injection directa/indirecta | Chats, GPTs con instrucciones, archivos RAG | Indirecta vía contenido ajeno = comportamiento de modelo | ⛔ Out of scope (model issues) |
| 1.3 | Jailbreak families (DAN, Crescendo, Skeleton Key…) | El propio modelo | Sí técnicamente | ⛔ Out of scope (model issues) |
| 1.4 | Filter evasion / token smuggling | El propio modelo | — | ⛔ Out of scope |
| 1.5 | Privacy/IP: extraction, membership, inversion | API/entrenamiento | No (sin acceso API en scope) | ⛔ No testeable |
| 1.6 | Availability: sponge/DoS | Chats | Sí, pero = abuso/DoS | ⛔ Out of scope |
| 1.7 | Data/model poisoning (training-time) | — | No | ⛔ No testeable |
| 2.2 | OWASP LLM01 Prompt Injection | igual 1.2 | — | ⛔ (salvo impacto app) |
| 2.2 | OWASP LLM02 Sensitive Info Disclosure | Shares, GPTs, biblioteca | Parcial (V7/V8 cerrados sin hallazgo) | ❌ Cerrado |
| 2.2 | OWASP LLM03 Supply Chain | GPT Store, plugins, **MCP connectors** | Ruta API MCP no expuesta con estas cuentas | ⛔ Gated (pendiente re-test) |
| 2.2 | OWASP LLM04 Data/Model Poisoning | RAG: files `index_for_retrieval` | V7: aislamiento cross-account 404 ✅ | ❌ Cerrado |
| 2.2 | OWASP LLM05 Improper Output Handling | Render markdown/atributos | DMI/CSS: sanitizador skipHtml+allowlist | ❌ Cerrado |
| 2.2 | OWASP LLM06 Excessive Agency | **Actions de custom GPTs**, plugins OAuth | El GPT de la cuenta no tiene Actions; crear GPT con Actions no habilitado | ⛔ Gated · riesgo duplicado alto (Tenable 2025) |
| 2.2 | OWASP LLM07 System Prompt Leakage | GPTs compartidos por enlace | **PROBADO HOY**: instructions=null para no-propietario; can_view_config:false; SSR sin payload | ✅ Verificado correcto — sin hallazgo |
| 2.2 | OWASP LLM08 Vector/Embedding | RAG biblioteca | = LLM04 | ❌ Cerrado |
| 2.2 | OWASP LLM09 Misinformation | — | No aplica | ⛔ |
| 2.2 | OWASP LLM10 Unbounded Consumption | Rate limits | Sí, pero abuso | ⛔ |
| 6.3 | Capability tokens / secrets | `/api/auth/session` access token, cookies | A/B verificados vivos, tenant-scoped | ✅ Correcto |
| 6.4 | OAuth/OIDC delegado | **connector-platform-oauth-redirect**, plugin connect | V10 pendiente (install_attempt_id cross-account) | ⏳ Riesgo medio |
| 7.2 | Sandboxing / circuit breakers | Code interpreter | Out of scope (sandboxed code exec) | ⛔ |
| 7.6 | MCP security architecture | `chatgpt.workspace.connector.mcp.create`, `upload_with_custom_mcp_servers`, CodexMCPElicitation | Rutas 404 en /backend-api con estas cuentas | ⛔ Gated |
| 7.7 | Secure RAG pipeline | Files `index_for_retrieval:true` (google-drive/materialize) | V7 cerrado (404 cross-account) | ❌ Cerrado |
| 9.4 | Plugin/MCP marketplace vetting; rug-pull | GPT Store / plugins / MCP | Depende de workspace de pago | ⛔ Gated |
| Lab | SSRF vía URL no validada generada por LLM | Actions de GPTs (server-side fetch) | Sin GPT con Actions; duplicado alto (Tenable 2025) | ⛔ |
| Lab | Agencia excesiva (tool-calling) | Actions/plugins | Ídem | ⛔ |
| Lab | Rug-pull MCP | MCP connectors | Gated | ⛔ |

---

## 2) Lo probado HOY (evidencia)

Fichero: `evidencia-poc/http/sondas-llm-cclmse-2026-09-06.txt`

1. **Sesiones A/B vivas y distintas** (gate A≠B ✅) — /backend-api/me 200 en ambas.
2. **AIP ledger (finanzas personales, OAuth/Plaid)** → `health:false, finances:false`:
   feature gated, sin superficie. Cierre limpio.
3. **Custom GPTs**: `gizmos/bootstrap` 200 (hay GPT en la cuenta).
4. **LLM07 — system prompt leakage del GPT compartido por enlace**:
   - B (no propietaria) → `GET /gizmos/{gid}` → **200 con `instructions:null`**:
     la API filtra las instrucciones para no-propietarios. ✅
   - A (propietaria) → `current_user_permission = {can_read:true, can_view_config:false,
     can_write:false, can_delete:false, can_export:false, can_share:false}`.
   - SSR público `/g/{short_url}` (1,1 MB) → el payload del GPT NO viaja en el HTML
     (solo hreflang/link alternates). ✅
5. **MCP/workspace connectors**: los routeKeys existen en el SPA
   (`chatgpt.workspace.connector.mcp.create`, `upload_with_custom_mcp_servers`,
   `CodexMCPElicitation`) pero sus endpoints no están expuestos en `/backend-api`
   con esas rutas (404) con estas cuentas → feature de workspace de pago. Gated.

**Conclusión de la pasada:** 0 hallazgos; el control de acceso a nivel de objeto de
los custom GPTs está correcto (es el vector LLM más probable de fallar y no falla).

---

## 3) Qué queda VIVO con la metodología CLLMSE (decisiones para el investigador)

| Vector | Dominio CLLMSE | Acción | Riesgo duplicado |
|---|---|---|---|
| **V9 handoff** (`/api/auth/handoff/bind\|inspect`) | 6.4 delegación OAuth / takeover lógico | Ejecutar A/B con las sesiones vivas | Bajo |
| **V10 plugin install cross-account** (`install_attempt_id`, `account_id`) | 9.4 supply chain / 6.3 capability tokens | A reutiliza install_attempt_id de B | Medio-alto (research público plugins/SSRF GPTs) |
| **MCP connectors** (crear connector con servidor MCP propio) | 7.6 MCP security / 9.4 rug-pull | Re-test solo si una cuenta consigue workspace con `upload_with_custom_mcp_servers` | Bajo (superficie nueva) |
| **Custom GPTs con Actions (SSRF)** | Lab escenario 3 / LLM06 | Requiere cuenta con builder GPT+Actions habilitado | Alto (Tenable 2025 ya publicó SSRF via custom GPTs) |

---

## 4) Reglas de ejecución (igual que siempre)

- Solo `chatgpt.com` (+ `cdn.oaistatic.com` para assets); `pay.openai.com` y
  `community.openai.com` fuera.
- Dos cuentas de test propias, recursos `SYNTHETIC-*`, sin enumeración, sin
  compras, sin tocar datos de terceros reales.
- Rate limit 2,2 s; UA de investigación; captura navegador real + raw HTTP.
- Nada de jailbreaks: son comportamiento del modelo y fuera de policy.