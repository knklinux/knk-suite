# 📋 Plantilla exacta — Submit al programa **Safety BB** (Bugcrowd)

> Fecha: 2026-09-06 · Programa: `bugcrowd.com/engagements/openai-safety`
> Fuente: formulario real guardado (`Enviar un informe a Safety Bug Bounty - Bugcrowd.htm`)
> El formulario crea el submission en `POST /engagements/openai-safety/submissions`.

---

## 1) Campos del formulario real (exactos, en este orden)

| # | Campo del formulario | Qué va | Regla de la guía |
|---|---|---|---|
| 1 | **Title** (`caption`) | Título del hallazgo | Fórmula §2: `[Tipo] + [Ubicación exacta] + [Impacto concreto]` |
| 2 | **Target** (`target_id`) | Desplegable con SOLO 4 opciones | Elegir el asset real donde vive el bug |
| 3 | **VRT** (`original_vrt_id`) | Árbol VRT del programa (ver §2 abajo) | Elegir la hoja (variant) más precisa, nunca la categoría |
| 4 | **Bug URL** (`bug_url`) | URL pública donde se reproduce | Una URL, la del endpoint/ruta afectada |
| 5 | **Description** (`description`) | El informe completo (markdown) | Estructura de la §11 de la guía — ver plantilla §3 |
| 6 | **HTTP request** (`http_request`) | Petición cruda del PoC | Copiable, con nota de qué sustituir (cookie/token) |
| 7 | **Extra info** (`extra_info`) | Impacto extendido, limitaciones, referencias | Lo que no quepa en Description sin ensuciarla |

⚠️ Diferencia clave con el programa principal (openai): **aquí `http_request` y
`extra_info` son campos separados** — no los metas dentro de Description.

### Targets disponibles (los 4 del desplegable)

| Target | Cuándo usarlo |
|---|---|
| `openai.com` | Superficie web principal de openai.com |
| `Agentic Tools` | **GPTs, conectores, tool-calling, agentic behaviors** — es donde encaja el E16 (inyección indirecta vía share) |
| `*.openai.com` | Cualquier subdominio de openai.com |
| `Other` | Solo si nada de lo anterior encaja (evitarlo: los triagers lo penalizan) |

---

## 2) VRT del programa Safety (árbol relevante, con prioridad P1-P5)

El Safety BB usa un VRT propio. Las hojas más probables para nuestros vectores:

### `AI Application Security` (categoría principal de IA)

| Subcategoría | Variantes | Prio |
|---|---|---|
| **Prompt Injection** | System Prompt Leakage; (más variantes direct/indirect en el árbol completo) | P2+ |
| **Improper Output Handling** | Cross-Site Scripting (XSS); Markdown/HTML Injection | P3/P4 |
| **Sensitive Information Disclosure** | Cross-Tenant PII Leakage/Exposure; Key Leak | **P1** |
| **Model Extraction** | API Query-Based Model Reconstruction | **P1** |
| **Training Data Poisoning** | Backdoor Injection / Bias Manipulation | **P1** |
| **Remote Code Execution** | Full System Compromise; Sandboxed Container Code Execution | P1/P2 |
| **Denial-of-Service (DoS)** | Application-Wide (P2); Tenant-Scoped (P4) | P2/P4 |
| **Insufficient Rate Limiting** | Query Flooding / API Token Abuse | P4 |
| **Vector and Embedding Weaknesses** | Embedding Exfiltration / Model Extraction (P2); Semantic Indexing (P3) | P2/P3 |
| **Improper Input Handling** | ANSI Escape Codes; RTL Overrides; Unicode Confusables | P5 |
| **Adversarial Example Injection** | AI Misclassification Attacks | P4 |
| **AI Safety** | Misinformation / Wrong Factual Data | P4 |

### Mapeo de NUESTROS vectores al VRT Safety

| Nuestro vector | VRT Safety a elegir |
|---|---|
| **E16 — inyección indirecta vía prompt-share** (exfil de datos del agente) | `AI Application Security > Prompt Injection` (variante indirect si aparece en el desplegable) |
| Si el payload exfiltra PII de otro tenant | subir a `Sensitive Information Disclosure > Cross-Tenant PII Leakage/Exposure` (P1) |
| Si solo inyecta contenido/markdown renderizado | `Improper Output Handling > Markdown/HTML Injection` (P4) |
| CSS/DMI exfiltration (si llegara a ser real) | `Improper Output Handling > Cross-Site Scripting (XSS)` |

**Regla:** la severidad la decide el triager a partir del VRT + impacto; propón
la hoja que describa la TÉCNICA y demuestra el IMPACTO en Description.

---

## 3) Plantilla de Description (copiar, rellenar, pegar)

```markdown
## Summary
[3-5 líneas: qué falla, dónde, y qué consigue el atacante. Sin teoría.]

## Environment
- Program: OpenAI Safety BB
- Affected surface: [producto/feature exacta, p.ej. ChatGPT shared prompts]
- Accounts used: two self-owned test accounts (A = attacker, B = victim)
- Date of testing: [fecha]
- Test data: 100% synthetic (markers SB1-*/CONFIRM-SYNTH-*); no real user data touched

## Steps to Reproduce
1. [Estado limpio: sesión/cuenta de A, URL exacta]
2. [Acción exacta con endpoint/payload copiable]
3. [Acción en la cuenta B, víctima]
4. [Paso mágico — el que dispara el bug, en negrita]
5. **[Resultado observado: señal objetiva = el bug]** (reproducibilidad N/X)

## Evidence
- Raw HTTP request/response: [adjunto en el campo HTTP request]
- Canary/callback log: [colector propio, marcas de tiempo]
- Screenshots: [anotadas, datos tapados]

## Impact
[Peor caso REALISTA para ESTE producto: qué datos/acciones/agente queda
expuesto, a qué escala, con qué vector de entrega. Si hay PII cross-tenant,
decirlo explícitamente — es P1 en este VRT.]

## Severity justification
[VRT elegido + por qué. CVSS solo si aplica a superficie web clásica; en
Safety BB pesa más el relato de abuso del agente que el CVSS.]

## Remediation suggestion
[2-4 líneas: cómo cerraría tú el bug — aislamiento de canal de instrucciones,
allowlist de herramientas, validación de output, rate limit…]
```

## 4) Plantilla de HTTP request (campo separado)

```
POST /backend-api/conversation HTTP/1.1
Host: chatgpt.com
User-Agent: [UA de la sesión]
Authorization: Bearer <TOKEN_A — sustituir>
Content-Type: application/json

<body del PoC — pegar el JSON exacto>
```

Y debajo, la respuesta clave (la que demuestra el bug):

```
HTTP/2 200
<cabeceras relevantes>

<fragmento de la respuesta con el marcador CONFIRM-SYNTH-* visible>
```

## 5) Plantilla de Extra info (campo separado)

```
- Reproducibility: N de 5 intentos idénticos tuvieron éxito (umbral del programa: ≥50%)
- Attack prerequisites: [lo que necesita el atacante: cuenta gratuita, share público, etc.]
- Limitations: [lo que NO se probó y por qué — honestidad = credibilidad]
- Duplicate check: [qué se buscó en Known Issues / disclosures y cuándo]
- Cleanup: [evidencia de que se borraron los recursos sintéticos creados]
- Related public research: [referencias, si las hay — nunca como excusa, como contexto]
```

---

## 6) Borrador E16 pre-rellenado (Safety BB Escenario 1 — inyección indirecta vía share)

> Estado: **el PoC está bloqueado por el flag anti-abuso de la cuenta A** (E16).
> Rellenar los huecos `[...]` con los resultados reales cuando el enfriamiento
> (≥24 h sin `/conversation`) permita ejecutar `node backend/ab-safetybb-injection.js`.

- **Title:**
```
Indirect prompt injection via shared prompt executes attacker instructions in victim's agent session — exfiltrates context to attacker-controlled endpoint
```
- **Target:** `Agentic Tools`
- **VRT:** `AI Application Security > Prompt Injection` (subir a Cross-Tenant PII si hay fuga de datos de terceros)
- **Bug URL:** `https://chatgpt.com/share/p/<SHARE_ID>`
- **Description:** plantilla §3 con: payload de A en el share (kind:prompt), marcador sintético plantado por B (`CONFIRM-SYNTH-*`), consumo del share por B, y hit del canario `SB1-*` en el colector propio como prueba objetiva.
- **HTTP request:** body de creación del share + respuesta 200 con `post.permalink`.
- **Extra info:** reproducibilidad N/5 (umbral ≥50% del programa), duplicados chequeados en panel, cleanup del share y la conversación.

### Checklist pre-submit específico de Safety BB

- [ ] Target = `Agentic Tools` (no `Other`)
- [ ] VRT = hoja exacta del árbol Safety, no categoría
- [ ] Repro N/5 documentado (el programa exige ≥50%)
- [ ] Canario/colector propio (nunca infra ajena)
- [ ] Cleanup ejecutado y dicho en Extra info
- [ ] Sin hostname interno ni datos de terceros en ningún campo
- [ ] Duplicados revisados en el panel el MISMO día del submit
