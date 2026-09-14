# 🔎 E16 (Safety BB Esc. 1) — Check de panel: términos anti-duplicado + mapa VRT

> Fecha: 2026-09-06 · Programa: `bugcrowd.com/engagements/openai-safety` (ojo: el
> panel de known-issues es **por programa** — buscar en Safety, y de refrendo en el
> principal `openai`). Objetivo: tener el check listo para ejecutarse el MISMO día
> en que el PoC produzca resultados (el flag anti-abuso impide ejecutar E16 hoy).
> Método: manual (tu login) — 10–15 minutos. Aplica la regla de la guía §8:
> buscar ANTES de redactar/enviar.

---

## 1) Términos anti-duplicado (buscar en este orden, anotar hits)

Dónde: **Known Issues** del engagement Safety (si lo expone) + búsqueda general
del panel + filtro de submissions públicos. Un hit solo bloquea si describe
NUESTRO mecanismo exacto (ver §2), no si solo menciona la palabra.

| # | Término | Qué descartamos que ya exista | Veredicto si hay hit |
|---|---|---|---|
| 1 | `indirect prompt injection` | Inyección vía contenido de terceros en ChatGPT (familia completa) | Comparar mecanismo: ¿vía **share/prompt**? |
| 2 | `shared prompt` | Cualquier issue con prompts compartidos (`share/p/{id}`) | Hit con mecanismo share = bloqueo probable |
| 3 | `prompt share` / `shared conversation` | Variante de redacción de la 2 (cubrir ambas) | Igual que 2 |
| 4 | `agent data exfiltration` | Exfil de contexto del agente a endpoint externo | Hit con canario/exfil = bloqueo probable |
| 5 | `cross-account injection` | Payload de A ejecutándose en sesión de B | Hit con A→B vía share = bloqueo probable |
| 6 | `agentic tools` / `connector exfiltration` | Abuso de tools del agente para filtrar | Solo bloquea si es vía share (nuestro vector) |
| 7 | `markdown injection` / `dangling markup` | Si nuestro payload usara render markdown | Solo aplica si el PoC confirma render |

**Regla de decisión (guía §8):** un hit bloquea solo si coincide el
**mecanismo** (entrega vía share de prompt + ejecución en sesión víctima +
exfil a endpoint del atacante). Un hit de "inyección directa por el usuario"
o "exfil vía connector con OAuth" NO bloquea — nuestro vector es la entrega
por contenido compartido, distinta de ambas.

**Refrendo en el programa principal (`openai`):** repetir términos 1–5 — un
duplicado entre programas cuenta igual y quema reputación.

### Investigación pública conocida (contexto, no necesariamente bloqueo)

| Referencia | Qué cubre | ¿Bloquea el E16? |
|---|---|---|
| Salt Security (2024) — plugin install sin aprobación | Instalación cross-account de plugins | No — vector distinto (y V10 ya cerrado) |
| PromptArmor (2024) — exfil vía GitHub connector / Le Chat MFA | Exfil con connector OAuth del usuario | No — requiere connector; el nuestro no |
| Rehberger (embracethered) — serie ChatGPT exfil | Exfil vía varias superficies (citas, images, tools) | Depende: si hay writeup de **shared prompt → sesión del consumidor**, citarlo y comparar mecanismo exacto |
| OpenAI docs — "shared links son contenido de usuario" | Postura de diseño | No bloquea, pero anticipa la defensa "intended behavior" — prepárate en Impact |

Si la investigación pública describe exactamente nuestro mecanismo, NO es
duplicado per se (Bugcrowd duplica por submissions, no por blogs), pero hay
que citarla en Extra info como contexto y calibrar expectativa de severidad.

---

## 2) Mapa VRT según el RESULTADO del PoC (decisión al aterrizar los datos)

El VRT se elige con el resultado real, no con el diseño. Tabla de decisión:

| Resultado del PoC (lo que demuestra `safetybb-esc1-resultado.json`) | VRT a elegir (hoja exacta) | Severidad esperada |
|---|---|---|
| **Exfil confirmado**: canario `SB1-*` recibe datos del contexto de B (≥3/5 intentos) | `AI Application Security > Prompt Injection` (variante indirect si el desplegable la ofrece) | P2–P3 |
| Exfil + incluye datos personales/tenant de B en el canario | `AI Application Security > Sensitive Information Disclosure > Cross-Tenant PII Leakage/Exposure` | **P1** — no lo subas sin dato real en el canario |
| **Solo inyección**: instrucciones de A se ejecutan en la sesión de B (respuesta alterada, `CONFIRM-SYNTH-*` visible) SIN exfil a endpoint externo | `AI Application Security > Prompt Injection` (mismo nodo, impacto menor en Description) | P3–P4 |
| Solo contenido/markdown renderizado de A en la sesión de B, sin comportamiento | `AI Application Security > Improper Output Handling > Markdown/HTML Injection` | P4 |
| CSS/DMI exfil real (muy improbable por CSP de chatgpt.com) | `AI Application Security > Improper Output Handling > Cross-Site Scripting (XSS)` | P3 |
| **< 50% de reproducibilidad** (menos de 3/5) | **NO ENVIAR** — el programa exige ≥50% explícito para agentic risks | — |
| 0/5 o canario sin golpes | **NO REPORTABLE** — cerrar como vector probado y negativo, evidencia al libro de bugs | — |

### Fijos, sea cual sea el resultado

- **Target:** `Agentic Tools` (nunca `Other`)
- **Bug URL:** `https://chatgpt.com/share/p/<SHARE_ID>` — el permalink REAL del PoC
- **Repro:** N/5 en Extra info; umbral ≥50% citado del programa
- **Cleanup:** DELETE del share + conversación `visible:false` — evidencia en Extra info
- **Nunca en ningún campo:** hostnames internos, tokens, cookies, datos de terceros

---

## 3) Checklist del día del submit (cuando el PoC ya tiene resultados)

- [ ] Ejecutar búsquedas §1 en Safety **y** en el programa principal (mismo día)
- [ ] Aplicar tabla §2 → VRT fijado por el resultado real (no por el diseño)
- [ ] Repro ≥50% (N≥3/5) confirmado en `safetybb-esc1-resultado.json`
- [ ] Plantilla cumplimentada: `SAFETY-BB-PLANTILLA-SUBMIT-2026-09-06.md` §6
- [ ] Description / HTTP request / Extra info en sus campos separados (¡no todo en Description!)
- [ ] Duplicados citados o descartados con mecanismo en Extra info
- [ ] Captura del aviso del formulario al elegir VRT (lección E13: registrar dónde aparece cada texto)
- [ ] Copiar el **submission ID** tras el Submit y pasarlo al triaje

### Recordatorio del bloqueo actual

E16 sigue ⏸️ BLOQUEADO por el flag anti-abuso de la cuenta A (veredicto 2026-09-07,
exit 4). Este check se ejecuta **después** de que `secuencia-post-enfriamiento.sh`
lande con la sonda en verde y el driver produzca `safetybb-esc1-resultado.json`.
No abrir el formulario ni seleccionar VRTs hasta entonces: cada selección errónea
queda en el historial de la cuenta (lección E13).
