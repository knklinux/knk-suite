# 📜 Revisión de políticas y briefs — OpenAI + OpenAI Safety en Bugcrowd (2026-09-07)

> Fuentes: OpenAI bug bounty page (openai.com), OpenAI Safety BB announcement
> (marzo 2026), brief del programa Safety (formulario + VRT ya capturados en
> SAFETY-BB-PLANTILLA-SUBMIT-2026-09-06.md), anexo 308 de scope del OPPLAN,
> y análisis sectorial wraith.sh. Esta revisión CRUZA las reglas con lo que
> estamos haciendo y señala cualquier punto de incumplimiento o riesgo.

---

## 1) Los dos programas OpenAI en Bugcrowd — mapa

| | **Security BB** (`/engagements/openai`) | **Safety BB** (`/engagements/openai-safety`) |
|---|---|---|
| Qué paga | Vulnerabilidades de seguridad convencionales (auth, AuthZ, aislamiento de datos, XSS…) | Riesgos de abuso/safety que NO llegan a vuln de seguridad: inyección indirecta agéntica, exfil agéntica, integridad de plataforma |
| Nuestros targets | E13 (enviado), V7/V8/V10/V12, huecos H1/H2 | E16 (preparado), E17 |
| Triage | Equipo de Security | Equipo de Safety + Security; **pueden redirigir entre programas según ownership** |
| VRT | VRT estándar Bugcrowd (BAC, MFLAC…) | VRT propio AI Application Security (Prompt Injection, Cross-Tenant PII P1…) |
| Targets del formulario | chatgpt.com (verificado in-scope), openai.com, *.openai.com | openai.com, Agentic Tools, *.openai.com, Other |

**Regla de enrutado (importante):** un hallazgo de acceso no autorizado a
features/datos (AuthZ) va al Security BB aunque se descubra vía agente; la
inyección agéntica con exfil va al Safety BB. Si dudamos, el propio programa
redirige — no es motivo de cierre si el contenido es sólido.

## 2) Reglas del Security BB (con fuente)

| Regla | Fuente | Nuestro estado |
|---|---|---|
| Recompensas $200 (low) → $100.000 (top, ampliado 2025); mediana real $500–$3.000 | openai.com/bug-bounty + hackread 2025 | ✅ expectativa calibrada (E13: P4 ≈ $200–500 si aceptan) |
| Model issues / jailbreaks / alucinaciones / content policy = **out of scope** | brief + Safety page | ✅ nunca testeado ni enviado (LLM09/10 cerrados por policy) |
| Lo que SÍ paga: prompt injection con impacto concreto (exfil, escalada, cross-user) | brief | ✅ exactamente nuestro diseño E16/H1 |
| Out of scope declarado: `pay.openai.com`, `community.openai.com` | OPPLAN anexo 308 | ✅ excluidos en el gate de la suite |
| In scope: `chatgpt.com` (SPA real, verificado 308 desde chat.openai.com), `*.oaiusercontent.com` solo como ejecutor de la capacidad (nota de scope del E13) | brief + anexo 308 | ✅ gate activo: nada sale del scope |
| Rate limit mínimo del programa | brief (capturado en OPPLAN: 2000 ms) | ✅ suite a 3000 ms (§3), anti-abuso backoff ≥15 s |
| Solo cuentas propias, datos sintéticos, no terceros | ética del programa + nuestra guía §8 | ✅ A/B propias, SYNTHETIC-*, canario propio |
| P5/informational no paga | VRT estándar Bugcrowd | ⚠️ visto en E13 (P5 → cerrado/apelación); riesgo documentado |

## 3) Reglas del Safety BB (con fuente)

| Regla | Fuente | Nuestro estado |
|---|---|---|
| **Inyección indirecta + exfil agéntica: reproducible ≥50% de las veces** | Safety announcement (punto 1 de Agentic Risks) | ✅ E16 diseñado con N=5 variantes y umbral N≥3 (60%) — cumplo de sobra; el umbral N≥3 del runbook es coherente con esta regla |
| "Performs a disallowed action at scale" / "harmful action with material harm" | Safety announcement | E17/E18 encajan si hay señal; si no, descarte documentado |
| MCP testing: cumplir ToS de terceros | Safety announcement | ✅ MCP gated en nuestras cuentas, sin tests |
| Integridad de plataforma: **evitar/bypassar anti-automation ES IN-SCOPE aquí** (punto 3) | Safety announcement | 🚨 MATIZ CRÍTICO NUEVO: el flag anti-abuso que nos bloquea es un "account integrity signal". **ByPASARLO no está permitido** (sería lo contrario de lo que queremos), pero un hallazgo de que el flag persiste indefinidamente sin razón NO es reportable como bug (es intended). Nada que hacer — solo no "evadir" |
| jailbreaks out of scope | Safety announcement | ✅ fuera de nuestro kit |
| Información propietaria (reasoning) in-scope | Safety announcement | No testeable con cuentas free — dejar pasar |
| VRT propio: Cross-Tenant PII = P1, Prompt Injection = P2+ | formulario capturado | ✅ mapeo E16 ya preparado |
| Los campos HTTP request y Extra info van SEPARADOS | formulario | ✅ plantilla ya lo respeta |

## 4) Puntos de riesgo/incumplimiento detectados (y su corrección)

| # | Riesgo detectado | Gravedad | Acción |
|---|---|---|---|
| 1 | **Umbral 50% del Safety BB vs nuestro N≥3/5**: si el PoC ejecuta 3/5 (60%) pasa, pero 2/5 no es enviable. Nuestro runbook ya lo decía; ahora queda atado a la regla oficial | Baja | ✅ ya alineado — recordarlo al rellenar marcadores |
| 2 | **La sonda anti-abuso repetida**: el punto 3 del Safety BB lista "bypassing anti-automation controls" como in-scope de *reporte*, no como técnica de test. Sondear /conversation cada 24 h es señalar, no evadir — **cumple**, pero si algún día el flag no cae NUNCA, no reportarlo como bug (es intended behavior del anti-abuso) | Media (conceptual) | ✅ anotado: el flag persistente = comportamiento previsto, no hallazgo |
| 3 | **E13 scope-note**: la apelación P5 citó el endpoint en chatgpt.com vs storage host fuera de scope. La regla del brief: el asset vulnerable manda. Ya cubierto en el paquete | Baja | ✅ sin acción |
| 4 | **Redirección entre programas**: si el triager de Safety reenvía E16 al Security (o viceversa), no es cierre — dejar que el contenido hable | Baja | ✅ solo monitorizar |
| 5 | **H3 (model swap)**: encuadre correcto es "lógica de negocio / features beyond authorized permissions" → Security BB, NO Safety (que lo listaría como abuso). Ya así está el driver | Baja | ✅ coherente |
| 6 | **Datos de terceros**: ninguna de las reglas lo permite; nuestro kit es 100% cuentas propias y SYNTHETIC — y V13 redacta PII automáticamente | Baja | ✅ |
| 7 | **Disclosure público**: el caso Teringette recuerda que OpenAI exige aprobación escrita para publicar. Nuestros submissions E13/E16: nada público hasta "resolved + aprobado" | Media | ✅ regla ya adoptada |

## 5) Conclusión de la revisión

**Nuestra operación cumple las dos políticas.** Los 7 puntos revisados están
en verde o con la corrección anotada. Las reglas que más afectan al trabajo
en curso:

1. **E16 debe demostrar ≥50%** de reproducibilidad para el Safety BB (N≥3/5).
2. **El flag anti-abuso persistente NO es reportable** — es intended; no gastar
   más ventanas en documentarlo como hallazgo.
3. **Nada público sin aprobación escrita** del vendor, aunque resuelvan.
4. El resto de la cola (H1/H2/H3, E17/E18) está alineada con scope, ritmo y
   ética del programa.

Fuentes clave: `openai.com/index/safety-bug-bounty/` (leído íntegro),
`openai.com/index/bug-bounty-program/`, formulario Safety capturado,
anexo 308 del OPPLAN, análisis wraith.sh 2026.
