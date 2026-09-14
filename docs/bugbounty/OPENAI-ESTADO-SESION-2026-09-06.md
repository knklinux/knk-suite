# 💾 Guardado de sesión — OpenAI/Bugcrowd + Safety BB — 2026-09-06 (tarde/noche)

> Snapshot para retomar sin perder contexto. Generado el 2026-09-06 al final de la
> pasada CLLMSE + análisis de writeups de otros hunters.

## 1) Estado de sesiones y acceso

| Ítem | Valor |
|---|---|
| Target sesión KNK | `chatgpt.com` (308 verificado desde `chat.openai.com`) |
| Scope sesión | `["chatgpt.com","cdn.oaistatic.com"]` |
| Out of scope | `pay.openai.com`, `community.openai.com` |
| OPPLAN | aprobado (2026-09-06T02:49Z) · tasa 2,2 s · UA `knk-suite-researcher/2.0 bug-bounty-research` |
| Cuenta A | Edge · `user-hDI8xdVTY6zahW36WXAsVD8e` · jar `evidencia-poc/http/sesion-cuenta-A-cookies.txt` |
| Cuenta B | Firefox/Edge · `user-i5BbE1RcOASut3ys0nx5Ory7` (jar B `sesion-cuenta-B-cookies.txt`) |
| Compuerta A≠B | ✅ verificada 2026-09-06 tarde (`/backend-api/me` 200, ids distintos) |

**Para retomar:** los jars están en `evidencia-poc/http/`; renovar tokens vía
`/api/auth/session` (accessToken Bearer para `/files/*`, `/payments/*`, `/gizmos/*`).

## 2) Resumen de hallazgos (todas las pasadas OpenAI)

### 🟢 REPORTABLES / candidatos
| ID | Vector | Severidad | Estado |
|---|---|---|---|
| **E13** | SAS `upload_url` de `/files/upload_reservations` NO ligada a sesión/IP: replay (201), PUT cross-account A (201×2), PUT anónimo (201) → contenido de A persiste en la biblioteca de B (ground truth: B descarga su content_url → `SYNTHETIC-A-INJECTED by account A`) | LOW (CVSS 4.3) | 🔁 **REABIERTO 2026-09-07 — ground truth del panel: el submission NUNCA se envió.** Check de panel limpio (chatgpt.com IN, storage OUT, Known Issues sin match de mecanismo) → enviar fresco con el paquete listo (VRT: BAC → MFLAC, P4). Lecciones de §6 siguen vigentes; la apelación NO aplica (no hay veredicto) |

### 🟡 INFORMATIVOS (no enviar sin confirmar criterios)
| ID | Vector | Detalle |
|---|---|---|
| E12 | `POST /subscriptions/auto_top_up/update` con `recharge_threshold:"NaN"` → **500 reproducible 2×** (0/negativo/vacío → 422 correcto) | Fuga de hostname interno `billing-manager.openai.internal` + org id en error de disable. P5-informativo; OpenAI suele exigir impacto → no quemar reputación |

### 🔴 NO REPORTABLES (cerrados con evidencia)
| ID | Vector | Motivo |
|---|---|---|
| E8/V7 | IDOR biblioteca de archivos A/B | 404 reproducible 2× — tenant-scoping correcto |
| E9/V4 | Claim cross-account de upload_reservations | 200 eco idempotente, sin transferencia de ownership |
| E14 | Pasada CLLMSE: GPTs (LLM07) | `instructions:null` para no-propietario; `can_view_config:false`; SSR sin payload — ACL correcta |
| E1-E7, E10, E11, F-1…F-18 | 308 redirect, CORS, bundles, pagos, saved-entities, crypto.com/newegg (sesión anterior) | Sin impacto demostrable / gates de feature / no testeable |

## 3) Pendientes vivos (con sesiones A/B activas)

| Vector | Superficie | Riesgo duplicado | Nota |
|---|---|---|---|
| ~~V9 handoff~~ | `/api/auth/handoff/{bind,inspect}` | — | ❌ **CERRADO**: sin token real no hay reproducción; endpoint blindado y flag desactivado (teórico, §8) |
| ~~V10 plugin install~~ | `install_attempt_id`, `account_id` | — | ❌ **CERRADO** (sondeo 4 fases): catálogo vacío + rutas de lectura retiradas (404 uniformes) — superficie eliminada por OpenAI; re-test solo con workspace de pago con conectores |
| MCP connectors | `chatgpt.workspace.connector.mcp.create`, `upload_with_custom_mcp_servers` | Bajo | Gated (404 en /backend-api con estas cuentas); re-test si se consigue workspace |

## 4) NUEVO — OpenAI Safety Bug Bounty (anunciado 2026-03-25)

Programa SEPARADO del Security BB de Bugcrowd. Paga por (texto del anuncio oficial):
- **Agentic risks incl. MCP**: prompt injection de terceros + exfiltración de datos — si el texto de un atacante secuestra un agente de la víctima (Browser, ChatGPT Agent) para una acción dañina o filtrar info sensible, **reproducible ≥50% de las veces**.
- **Propietario OpenAI**: generaciones que devuelven info propietaria de razonamiento / info propietaria interna.
- **Account/Platform integrity**: bypass de controles anti-automatización, manipulación de señales de confianza, evasión de restricciones/bans.
- Jailbreaks genéricos → fuera; campañas privadas periódicas (biorisk, etc.).

**Consecuencia estratégica:** varios vectores que cerramos como "model issues fuera de
scope" en Bugcrowd (inyección indirecta vía contenido, exfiltración vía agente, riesgos
MCP) son EXACTAMENTE lo que paga el programa Safety. La metodología CLLMSE encaja mejor
ahí que en Bugcrowd. Ver `OPENAI-ESTRATEGIA-WRITEUPS-2026-09-06.md`.

## 5) Evidencias de la sesión

- `evidencia-poc/http/sondas-llm-cclmse-2026-09-06.txt` (pasada CLLMSE de hoy)
- `docs/bugbounty/OPENAI-CLLMSE-METODOLOGIA-SCOPE-2026-09-06.md` (mapa manual→scope)
- `docs/bugbounty/OPENAI-TRIAGE-HALLAZGOS-2026-09-06.md` (E1-E14 + F1-F18)
- `docs/bugbounty/OPENAI-REPORTE-E13-EN-FINAL-2026-09-06.md` (informe EN listo para pegar)
## 6) Cierre del día (2026-09-06 noche) — E13 cerrado + lecciones aprendidas

**Veredicto final E13:** P5 informativo **aceptado** por el investigador. No hay apelación
(la plantilla queda archivada en `E13-APELACION-P5-2026-09-06.md`, marcado OBSOLETO, por si
una re-categorización futura real la necesita).

### Lecciones aprendidas (para el próximo programa)

1. **El VRT es parte del exploit.** Un nodo mal elegido (`Weak Login Function`) auto-degrada
   el reporte a informativo sin que ningún triager lo lea. Antes de submitir: recorrer el
   árbol VRT entero y justificar el nodo elegido (aquí: BAC → MFLAC).
2. **Artefacto de UI ≠ veredicto de triage.** El aviso automático del formulario de Bugcrowd
   ("VRT suggests informational…") se registró como veredicto sobre un envío que nunca existió,
   y nos llevó a no enviar. Regla nueva: capturar DÓNDE aparece cada texto (URL, sección del
   formulario) antes de registrarlo como hecho.
3. **Estándar de evidencia para envíos futuros:** dos rondas reproducibles + pantallazo con
   identidad verificada en navegador (ronda 19:04 + ronda 20:21 +
   `e13-captura-descarga-B.js` con el email de B confirmado en página).
4. **Impacto honesto y conservador no garantiza la severidad pedida.** La SAS sin binding de
   sesión es una debilidad de diseño real, pero puede valorarse como comportamiento previsto.
   Enviar estaba justificado (coste bajo, evidencia sólida); apelar, no.
5. **La infraestructura es el activo reutilizable:** compuerta de salud (4 checks) + sonda
   anti-abuso (check 5, exit 4) + backoff exponencial + auto-salteo en drivers. Sirve para
   cualquier programa, no solo OpenAI.
6. **Estrategia de programa:** los vectores de agente / inyección indirecta / exfiltración
   encajan mejor en Safety BB que en Security BB de Bugcrowd — la metodología CLLMSE tiene
   allí su sitio natural.

### Estado al cierre del día

- **Sesiones A/B:** vivas y con compuerta en verde (última verificación 20:18, exit 0).
- **Flag anti-abuso en /conversation:** activo al cierre (sonda del check 5, 403).
- **Mañana (una sola orden):** `cd knk-suite && bash backend/secuencia-post-enfriamiento.sh`
  → sonda primero; si el flag cayó, E16 → E17 → E18 con ritmo lento y auto-salteo.
- **E12:** sigue como informativo — no enviar salvo criterio confirmado de impacto.
- **Sin nada pendiente de envío:** el bug book queda limpio; los próximos envíos saldrán de
  la cola de mañana (E16/E17/E18) o de Safety BB.
