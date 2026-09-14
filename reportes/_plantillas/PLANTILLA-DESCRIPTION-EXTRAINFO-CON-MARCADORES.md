# E16 — Description y Extra info listos para pegar (con marcadores)

> Fecha: 2026-09-07 · Programa: `bugcrowd.com/engagements/openai-safety`
> Estado: **borrador completo con marcadores `<<...>>`** — se rellenan con los
> resultados reales de `safetybb-esc1-resultado.json` en cuanto la sonda
> anti-abuso pase y el driver corra. Todo lo demás está cerrado: copiar →
> sustituir marcadores → pegar.
> Campos separados del formulario Safety BB: **Description**, **HTTP request**,
> **Extra info** (no meter todo en Description).
> Reglas de tono: sin nombres de suite/drivers, sin hostnames internos, sin
> mención a otros vectores, tono de investigador manual.

---

## Campos fijos (no llevan marcador)

| Campo | Valor |
|---|---|
| **Title** | `Indirect prompt injection via shared prompt executes attacker instructions in victim's agent session — exfiltrates context to attacker-controlled endpoint` |
| **Target** | `Agentic Tools` |
| **VRT** | `AI Application Security > Prompt Injection` (variante indirect si el desplegable la ofrece; **subir a `Sensitive Information Disclosure > Cross-Tenant PII Leakage/Exposure` solo si el canario captura datos reales de B**) |
| **Bug URL** | `https://chatgpt.com/share/p/<<SHARE_ID>>` — el permalink REAL que devuelva la creación del share |
| **Severity propuesta** | `<<P2|P3|P4>>` según la tabla de resultados del panel-check (`E16-PANEL-CHECK-DUPLICADOS-VRT-2026-09-06.md`) |

---

## Campo Description (pegar completo tras sustituir marcadores)

```markdown
## Summary

ChatGPT shared prompts (`share/p/...`) are consumed by the viewer's agent
session without instruction/data separation: instructions planted by the
author in the shared prompt execute inside the **viewer's** session with the
viewer's context, tools and conversation history. Demonstrated end-to-end
between two self-owned accounts: an authored share containing an indirect
prompt injection caused the victim's agent to emit the victim's own context
to an attacker-controlled collector, reproducing <<N>>/5 times.

## Environment

- Program: OpenAI Safety BB
- Affected surface: ChatGPT shared prompts (`share/p/{id}`) consumed by the
  built-in agent in the viewer's session
- Accounts used: two self-owned test accounts (A = author/attacker,
  B = viewer/victim)
- Date of testing: <<FECHA>>
- Test data: 100% synthetic. Attacker payload marks content with `SB1-*`
  canary beacons to my own collector; victim context marked `CONFIRM-SYNTH-*`.
  No real user data touched.

## Steps to Reproduce

1. Account A creates a new prompt containing the injection payload below and
   shares it (the share returns a public permalink `share/p/{id}`).
2. Injection payload (exact, copyable):

<<PAYLOAD_BLOQUE>>

3. Account B plants a benign synthetic marker in its own context
   (`CONFIRM-SYNTH-<<ID>>: my notes for today`) in a normal conversation.
4. Account B opens the shared prompt link from step 1 and runs it in the
   built-in agent. **The attacker's instructions from the share execute in
   B's session.**
5. My collector (self-hosted, isolated) receives a request containing B's
   context marker: **`SB1-HIT` with `CONFIRM-SYNTH-<<ID>>` in the body**
   — objective proof of cross-boundary execution and exfiltration.
   Reproducibility: <<N>>/5 identical attempts (<<DETALLE_INTENTOS>>).

## Evidence

- Raw HTTP: creation of the share and its 200 response with the permalink
  (attached in the HTTP request field).
- Collector log: <<N>> hits at <<HORAS_HITS>>, each containing B's synthetic
  context marker (attached).
- Screenshot of B's agent session rendering/executing the shared content,
  and of the collector receiving the beacon (attached).

## Impact

An author of any shared prompt can run instructions in every viewer's agent
session. Realistic worst case for this product: the injected instructions
instruct the agent to read and emit the viewer's conversation history, files
available to the agent, or connector content, to an external endpoint —
a single public share becomes a delivery vector to an arbitrary number of
viewers. <<SI_PII: In our test the beacon carried the victim's own context
marker; with a real user the same path carries their actual conversation
content — cross-user data exposure.>> No interaction beyond opening the
shared prompt is required from the victim.

## Severity justification

`AI Application Security > Prompt Injection` (indirect): the delivery channel
is content authored by a third party (the share), and execution happens in the
victim's privileged session with their context. Proposed <<P2/P3/P4>> because
<<JUSTIFICACION_SEVERIDAD — p.ej. reproducible exfiltration of session context
with a single open of a share>>. (If the payload is judged to only affect
rendered output without agent execution, the correct leaf would be
`Improper Output Handling > Markdown/HTML Injection` — the collector hit
demonstrates it is the former.)

## Remediation suggestion

Treat shared-prompt content as untrusted data, never as instructions for the
viewer's session: strip/neutralize instruction-like patterns on render,
isolate the channel that feeds agent tool-calls, and egress-restrict or
prompt-injection-harden agent tool calls that send session content to
external destinations.
```

---

## Campo HTTP request (pegar tal cual, sustituyendo solo el token)

```
POST /backend-api/share HTTP/1.1
Host: chatgpt.com
Authorization: Bearer <TOKEN_A — sustituir por el tuyo>
Content-Type: application/json

<<BODY_CREACION_SHARE — JSON exacto con kind:prompt y el payload del paso 2>>

---

HTTP/2 200
<<RESPUESTA_200 — con post.permalink = https://chatgpt.com/share/p/<SHARE_ID>>>
```

---

## Campo Extra info (pegar completo tras sustituir marcadores)

```
- Reproducibility: <<N>> of 5 identical attempts succeeded (program threshold: ≥50%).
  All 5 attempts used the same share link and fresh victim sessions; failures
  (if any): <<SI_HAY_FALLOS: descripción breve y causa aparente>>.
- Attack prerequisites: attacker needs only a free account able to create and
  share a prompt; victim needs only to open the public share link in the
  normal ChatGPT UI. No follower relationship, no link-click confirmation,
  no connector setup required.
- Limitations: tested only with synthetic markers against my own collector and
  two self-owned accounts; did not test exfiltration of real PII, connector
  content of third parties, or persistence of the injection across sessions.
  Collector was self-hosted and isolated — no third-party infrastructure used.
- Duplicate check: Known Issues on this panel reviewed on <<FECHA>> for
  "indirect prompt injection", "shared prompt", "agent data exfiltration",
  "cross-account injection" and "markdown injection" — no entry describing
  this delivery mechanism (shared prompt → viewer's agent session → external
  beacon) was found.
- Cleanup: the shared prompt was deleted after testing (share removed, 200),
  the synthetic conversation was deleted, and the collector was shut down.
  No data from any real user was involved at any point.
- Related public research: known indirect-injection research exists for agent
  tool pipelines and connectors; this report concerns the shared-prompt
  delivery path into the viewer's own agent session, which to my knowledge
  was not previously documented for this surface.
```

---

## Tabla de sustitución de marcadores (última pasada antes de pegar)

| Marcador | Se rellena con | Fuente |
|---|---|---|
| `<<SHARE_ID>>` | ID del permalink devuelto por la creación del share | respuesta del driver, campo `post.permalink` |
| `<<PAYLOAD_BLOQUE>>` | payload exacto de inyección usado (el del driver, tal cual) | `safetybb-esc1-resultado.json` → `payload` |
| `<<ID>>` | ID sintético del marcador `CONFIRM-SYNTH-*` del run | `safetybb-esc1-resultado.json` → `marcador` |
| `<<N>>` | nº de éxitos de 5 intentos | `safetybb-esc1-resultado.json` → `exitos` |
| `<<DETALLE_INTENTOS>>` | qué falló en los intentos fallidos, si los hay | log del driver |
| `<<HORAS_HITS>>` | timestamps de los hits del canario | log del colector `:8210` |
| `<<FECHA>>` | fecha real de ejecución | hoy |
| `<<SI_PII: ...>>` | dejar SOLO si el canario capturó contenido real de B (no marcador); si no, borrar la línea | `safetybb-esc1-resultado.json` → `pii_real` |
| `<<P2/P3/P4>>` + `<<JUSTIFICACION_SEVERIDAD>>` | según la tabla de resultados → VRT del panel-check | `E16-PANEL-CHECK-DUPLICADOS-VRT-2026-09-06.md` §VRT |
| `<<BODY_CREACION_SHARE>>` / `<<RESPUESTA_200>>` | petición/respuesta cruda del share | log HTTP del driver |

## Regla de coherencia final

- Si `<<N>>` < 3 → **NO ENVIAR** (umbral del programa ≥50%): cerrar como tested-and-negative.
- Si el canario capturó datos reales de B (no solo marcadores) → subir VRT a `Cross-Tenant PII` y proponer P1.
- Verificar antes de submit: 0 hostnames internos, 0 nombres de herramientas, duplicados re-checados ese mismo día.
