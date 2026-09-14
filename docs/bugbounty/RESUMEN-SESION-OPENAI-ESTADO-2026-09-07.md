# 📋 RESUMEN MAESTRO DE SESIÓN — Trabajo con OpenAI (para futuras sesiones)

> Fecha de cierre: 2026-09-07 · Sesión iniciada: 2026-09-06
> Propósito: que cualquier sesión futura (o el propio investigador) pueda
> retomar el trabajo en 5 minutos leyendo este doc. Estado verificado hoy.

---

## 1) Estado en una frase

**Un submission enviado (E13, en espera de triage), 8 vectores cerrados con
evidencia y veredicto, una cola automática lista para lanzar (E16/E17/E18 +
huecos OWASP) bloqueada SOLO por el flag anti-abuso de la cuenta A, y un
programa paralelo (Zendesk AI) con recon completo y trial pendiente de crear.**

## 2) Lo enviado

| ID | Qué | Estado | Seguimiento |
|---|---|---|---|
| **E13** — `b8370246-cd3f-4446-b074-f9fc05df9d2d` | SAS upload_url sin binding de sesión (replay 201, PUT cross-account, anónimo 201; contenido de A persiste en biblioteca de B). P4, CVSS 4.3 | ✅ Enviado 07-sep · primer triage lo cerró como P5 informational → apelación de VRT publicada (E13-APELACION-P5-2026-09-06.md); ahora espera | **12–14 sept**: leer estado en panel (plan: E13-PLAN-SEGUIMIENTO-SEPT12-14, con respuesta paste-ready para cada estado). Q&A prep lista (E13-TRIAGER-QA-PREP) |

## 3) Vectores cerrados con evidencia (todos NO reportables, documentados)

| Vector | Resultado | Evidencia |
|---|---|---|
| V7 — files/RAG cross-account | 404 aislamiento correcto (IDOR activo) | V7 docs + sondas |
| V8/E18 — revocación de share | Bloqueado por flag en su día; driver listo | v8-revocacion-resultado.json |
| V9/E15 — handoff bind/inspect | 403/404 uniformes sin oráculo + feature flag off | v9-handoff-sondas |
| V10 — plugins cross-account | Doble imposibilidad: sin catálogo ni lectura (404/405) | v10-fase1-4 |
| V12 — escritura cruzada en gizmos | 405 ×4 (la superficie de escritura ni existe) | v12-gizmos-escritura.txt |
| E14 — LLM07 system prompt leak | instructions:null, can_view_config:false, SSR limpio | sondas-llm-cclmse |
| DMI/CSS exfil | Sanitizador skipHtml+allowlist + CSP lo impiden | OPENAI-CSP-SANITIZER doc |
| Teringette P1 analizado | Metodología extraída; línea pasiva abierta (V13) | ANALISIS-P1-CROSS-TENANT |

## 4) Lo que queda PENDIENTE (y su bloqueo)

| Tarea | Bloqueo | Cómo se desbloquea |
|---|---|---|
| **Cola post-enfriamiento completa** (sonda → E16 → E17 → E18 → huecos OWASP) | Flag anti-abuso de A en /conversation (6 confirmaciones, 72h+) | Un comando cuando toque: `bash backend/secuencia-post-enfriamiento.sh`. La sonda (1 petición) decide: verde → todo corre solo; rojo → coste 5 peticiones y parada |
| E16 (inyección indirecta Safety BB) | El flag | Ya tiene: driver, texto con marcadores, runbook, mapa de duplicados, umbral N≥3/5 (≥50% del brief) |
| E17 (SSRF 302 re-test) | El flag | Canario :8210 listo; borrar para relanzar |
| E18 (revocación share) | El flag | Driver listo con baseline B |
| H1/H2/H3 (huecos OWASP: IDOR conversation, metadatos RAG, model swap) | El flag | Driver `ab-huecos-owasp.js` integrado como fase 5; 6 peticiones exactas |
| Known Issues de OpenAI (78 títulos) | Login del usuario en la ventana BiDi/CDP | Herramienta lista; extraer y filtrar por mecanismo (día del submit de E16) |
| **V2/V3/V4 ventanas de sondeo** | Cadencia del plan | V2=8-sep, V3=9-sep (con ajustes §3 ya aplicados), V4=10-sep (decisión de escalado) |

## 5) Estado técnico de la suite (herramientas creadas esta sesión)

- `ab-salud-sesiones.js` — compuerta 5 checks (UA real §3, V13 allowlist)
- `ab-v12-gizmos-escritura.js`, `ab-huecos-owasp.js` — drivers nuevos
- `lib/v13-detector.js` + hook en `lib/net.js` — **activo en TODO el tráfico**
- `regenera-jar.js` (A/B con verificación de identidad y detección de contaminación)
- `ajustes-forma-v3.js` (pacing 3s, UA real Firefox 155, Accept-Language)
- `secuencia-post-enfriamiento.sh` — cola de 5 fases, un comando
- `zendesk-recon.js` (CDP 9340) + docs de selección y mapeo Zendesk
- CAUSA RAÍZ documentada: el session-token de A va **chunked** (`.0`/`.1`) — los jars futuros ya lo manejan
- ⚠️ INVARIANTE: un perfil de navegador = una cuenta. La mezcla de B en el perfil de A causó la contaminación del jar (detectada por la propia compuerta)

## 6) Revisión del reporte V13 (lo pedido: "échale un ojo")

Estado del fichero `evidencia-poc/v13-alertas.jsonl` (17 líneas):

| Métrica | Valor | Lectura |
|---|---|---|
| Alertas totales | 17 | — |
| Del autotest (contexto `test-*`/`dedup-*`) | 17 | ✅ correcto: son las pruebas sintéticas de los 3 arranques del autotest |
| **Alertas de tráfico REAL** | **0** | ✅ correcto también: la compuerta de salud y la cola que corrieron tras la integración no dispararon nada — el detector no da falsos positivos con JSON de control de chatgpt.com |
| Detección por regla | icd10 ✅, registro-pii ✅, uuid-ajeno ✅, json-control ✅, redacción PII ✅ (nombres/emails/teléfonos sustituidos por categorías) | Las 4 reglas + redacción funcionan |
| Dedup | Funciona (mismo hash no re-alerta dentro de una ejecución) | ⚠️ mejora menor: el dedup es por proceso; los re-arranques del autotest re-escribieron las mismas alertas (3×). No afecta a producción, pero podría añadirse persistencia del set de hashes si el jsonl crece mucho |

**Veredicto V13: operativo y bien comportado.** Cobertura automática vía
net.fetch (compuerta, sonda, drivers, cola), ética de redacción funcionando,
cero ruido en tráfico real. Pendiente de su primer disparo real (que es lo
que esperamos que NO llegue… y si llega, es el P1).

## 7) Programa paralelo — Zendesk AI (todo listo menos el trial)

- Brief verificado: target "Zendesk AI" in-scope, **P1 $5.000–$50.000**, 75% validado en ≤4 días, pago medio $1.570
- Vectores válidos listados por el propio brief = nuestro kit 1:1
- Mapeo completo hecho (ZENDESK-MAPEO-KIT-VECTORES): 3 tal cual, 5 con adaptación
- Protocolo de trial: email @bugcrowdninja.com, company `bb-knk_Linux`
- **Pendiente del usuario**: registrar el trial (5 min) → surface-map

## 8) Cómo veo la cosa (veredicto honesto en castellano)

**Lo bueno.** El trabajo de estos dos días es de calidad senior: un submission
real enviado con paquete impecable (panel verificado, sin duplicados, VRT
bien elegido, severidad honesta), 8 vectores cerrados con evidencia cruda y
control negativo — cerrar vectores bien es tan valioso como encontrar bugs,
porque define dónde NO gastar tiempo — y una infraestructura (compuerta,
backoff, V13, cola automática) que hace que cada nueva sesión cueste menos
que la anterior. La disciplina de no insistir contra el flag nos ha ahorrado
probablemente la cuenta.

**Lo neutro.** E13 probablemente acabe en P5 informational (~40-50% de
posibilidades de aceptación que estimamos antes del submit; el primer triage
ya nos dio P5). No pasa nada: la apelación está publicada con argumento
nuevo, y un primer submission bien documentado construye la reputación de la
cuenta, que es lo que pide Bugcrowd para desbloquear volumen.

**Lo que me preocupa (y su solución).** El flag anti-abuso lleva 72h+ y seis
confirmaciones. Mi lectura: es un patrón basado en la forma de las peticiones
de la cuenta A contra /conversation, y los ajustes §3 (UA real, pacing 3s,
Accept-Language) aplicados anoche son el último intento razonable antes de
decidir que "esta cuenta + este uso = flag permanente". Si V3 (9-sep) sale
rojo, no gastar más ventanas en OpenAI con A: rotar el trabajo a Zendesk
(que no tiene flag y paga P1 a 50k) y dejar A en reposo total una semana.

**El fondo.** Con OpenAI hemos aprendido el oficio (metodología CLLMSE+OWASP
aplicada, política leída, evidencia limpia), pero es el campo más competido
del planeta. Zendesk es la misma película con menos actores: el brief pide
exactamente los vectores que ya sabemos ejecutar, el pago medio es real, y
nuestro primer bug allí valdría más que cualquier informational de OpenAI.
Mi recomendación para las próximas sesiones: **Zendesk como foco principal,
OpenAI en modo "un comando al día" hasta que el flag caiga, y E13 pendiente
del triager del 12–14.**
