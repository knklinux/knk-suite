# 📅 E13 — Plan de seguimiento Sept 12–14 (post-submit)

> Submission: `b8370246-cd3f-4446-b074-f9fc05df9d2d` (enviado 2026-09-07)
> Programa: OpenAI (Bugcrowd) · VRT: BAC → MFLAC, P4 (LOW), CVSS 4.3
> Fuente: guía §10 (seguimiento 5–7 días; apelar solo con argumento nuevo, una vez; aceptar con elegancia)
> Lectura del panel: `node backend/e13-estado-panel.js` (BiDi, requiere login) o lectura manual
> Evidencia: guardar captura + JSON en `evidencia-poc/http/e13-panel-estado.json` cada revisión

---

## 0) Qué comprobar en el panel (checklist de lectura, 2 min)

1. **Estado del submission** (`b8370246-…`): New / Triaged / Resolved / Closed / Informative…
2. **Si hay comentario del triager**: copiarlo EXACTO (literal, sin parafrasear) para decidir
3. **Si hay cambio de VRT o severidad**: anotar qué cambió
4. **Si hay award/puntos**: anotar cantidad
5. **Fecha del último movimiento** (para saber si está activo o dormido)

Guardar siempre: pantallazo (`e13-panel-estado-<fecha>.png`) + JSON + nota en el triaje.

---

## 1) Tabla de decisión por estado

### 🆕 New (sin movimiento)
- **Acción: NADA.** No comentar, no preguntar, no "refresh del interés".
- El SLA del programa es 10 días de validación (media observada); el día 10 sin movimiento → primer follow-up educado:
  ```
  Hi team, just checking in on this submission — happy to provide any additional evidence or re-test anything that helps triage. Thanks!
  ```
- **Nunca antes del día 10.**

### 🔍 Triaged (asignado, en revisión activa)
- **Acción: esperar.** Triaged significa que ya está en cola de evaluación seria.
- Si el triager hizo PREGUNTAS → responder desde `E13-TRIAGER-QA-PREP-2026-09-06.md` (8 respuestas listas: intended behavior, obtención del URL, user_mismatch, por qué no informational, egress, escalado, fiabilidad PoC, raw requests). Una respuesta por mensaje, citar la pregunta, evidencia adjuntada, nada nuevo inventado.
- Si el triager CAMBIÓ el VRT (p. ej. a Weak Login Function o similar informational): responder UNA vez con el argumento de mecanismo (no es login ni acceso público; es falta de control de acceso a nivel de objeto/función sobre endpoint autenticado; la única comprobación de propiedad ocurre DESPUÉS de la escritura). Si mantienen la posición → aceptar y cerrar (ver §3).
- Si el triager pide re-test con segundo egress → ofrecerlo como acción inmediata (es la limitación declarada en el informe) y ejecutarlo antes de responder.

### ✅ Resolved (aceptado)
- **Acción: agradecer y documentar.**
  ```
  Thank you for the confirmation and the bounty — glad it was useful. I'll keep an eye on the fix rollout.
  ```
- Registrar en triaje: puntos, VRT final, fecha de resolución.
- Verificar si hay bounty pendiente de claim en Payments; si el pago no llega en 7 días → soporte de Bugcrowd (no reclamar en el hilo).
- **Lección operativa:** anotar qué del paquete funcionó (título, repro paso a paso, negative control) para replicar la calidad en E16.

### ❌ Closed as Intended Behavior (el escenario que anticipamos)
- **Acción: apelar UNA vez, SOLO si hay argumento nuevo** — no repetir el informe.
- El único argumento nuevo real que tenemos: **la ausencia de cualquier binding del SAS es defect de diseño, no decisión documentada** — la SAS lleva el claim `scid` (client-id) pero nunca se valida en el PUT; si fuera "por diseño", el claim sobraría. Redactar la apelación en torno a ese punto (2–3 líneas, tono cooperativo):
  ```
  Thanks for the review. One point I'd ask you to reconsider: the SAS already carries a scid (client-id) claim that is never enforced at write time — if unbound writes were intended, that claim would be unnecessary. Enforcing it would be a one-line validation, which suggests the current behavior is an oversight rather than a design decision. Happy to provide more evidence if useful; either way I'll respect the final assessment.
  ```
- **Si cierran de nuevo tras la apelación → aceptar en seco:**
  ```
  Understood — thanks for taking a second look. Closing on my side.
  ```
  Y registrar en el triaje: "apelado 1× con argumento scid, mantenido → aceptado".
- **Prohibido:** segunda apelación, tono defensivo, amenaza de divulgación, comparaciones con otros hunters.

### ❌ Closed as Duplicate
- Si citan el reporte que nos duplica → leerlo, aprender el mecanismo documentado, anotar en triaje. No hay apelación posible contra duplicados.
- Si NO citan el duplicado → preguntar amablemente UNA vez si pueden compartir la referencia para aprender de ella.

### ❌ Closed as Out of Scope / Not Applicable
- Revisar su argumento contra nuestra scope-note (el endpoint vulnerable vive en chatgpt.com; solo la escritura ejecuta en storage). Si el cierre es por `*.oaiusercontent.com` → responder UNA vez recordando la scope-note con la URL del endpoint. Si es por otra lectura → aceptar.

### ⚠️ Closed as Informative (P5)
- La apelación VRT (misma que "Closed as Intended") es válida UNA vez si el mecanismo fue mal leído. Si mantienen → aceptar; un informative bien argumentado sigue contando para reputación.

---

## 2) Calendario de revisión

| Fecha | Acción |
|---|---|
| **2026-09-12** | Primera revisión del panel (día 5). Leer estado; si New sin movimiento → nada. Registrar |
| **2026-09-14** | Segunda revisión (día 7). Si sigue New → anotar; el follow-up real va el día 10 (17-09) |
| **2026-09-17** | Día 10: si sigue New sin comentarios → primer follow-up educado |
| **2026-09-19+** | Cadencia semanal hasta veredicto; cada revisión deja pantallazo+JSON+nota en triaje |

## 3) Regla transversal

**Una sola apelación por motivo, siempre con evidencia o argumento nuevo, siempre aceptando la última palabra del triager.** La reputación del `knk_Linux` vale más que este P4 — el objetivo del primer submission del programa es construir historial de calidad, no ganar el debate.

## 4) Estado actual registrado

- Última revisión del panel: 2026-09-07 (noche) — el estado en vivo no llegó a leerse (login de Bugcrowd no estaba activo en la ventana BiDi al momento de la consulta; pendiente de primera lectura real).
- La primera lectura del estado real del submission queda pendiente para la ventana del 2026-09-12 (o antes, si el usuario abre el panel manualmente y pega lo que ve → aplico esta tabla al instante).
