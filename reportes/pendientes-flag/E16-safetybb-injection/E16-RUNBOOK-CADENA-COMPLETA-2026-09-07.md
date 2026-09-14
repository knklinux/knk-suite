# 🏃 Runbook E16 — cadena completa en una página

> `secuencia → driver → panel check → submit` · Programa: `openai-safety` (Bugcrowd)
> Precondiciones: sesiones A/B sanas · canario/colector en `:8210` · flag anti-abuso de A **caído**.
> Documentos ya listos: borrador de texto (`E16-DESCRIPTION-EXTRAINFO-BORRADOR-2026-09-07.md`),
> mapa VRT/duplicados (`E16-PANEL-CHECK-DUPLICADOS-VRT-2026-09-06.md`), plantilla del formulario
> (`SAFETY-BB-PLANTILLA-SUBMIT-2026-09-06.md`).

---

## Fase 0 — Verificación pre-vuelo · ⏱️ 3 min

| # | Acción | Comando / cómo | OK si... |
|---|---|---|---|
| 0.1 | Compuerta de salud A/B (checks 1–4) | `node backend/ab-salud-sesiones.js` | `Veredicto: ✅ SESIONES SANAS` |
| 0.2 | Sonda anti-abuso (1 petición, sin reintentos) | `node backend/ab-salud-sesiones.js --con-ant-abuso` | Check 5 → **sin FLAG** (si sale flag: PARAR, reintentar en ≥24 h) |
| 0.3 | Canario vivo | `curl -s -m 5 http://127.0.0.1:8210/hit -o /dev/null -w "%{http_code}"` | `204` (si caído: `node backend/canario-ssrf.js &`) |

**⚠️ Puerta dura:** flag activo en 0.2 → no se ejecuta nada más hoy. Coste total: 5 peticiones.

---

## Fase 1 — Ejecución del PoC (driver) · ⏱️ 12–18 min

```bash
node backend/ab-safetybb-injection.js 2>&1 | tee evidencia-poc/http/safetybb-esc1-consola.log
```

Qué hace solo (sin intervención): 5 variantes de payload × flujo A→B, ritmo ≥2,2 s,
colector local, resultado en `evidencia-poc/http/safetybb-esc1-resultado.json`,
limpieza (DELETE shares + conversaciones ocultas) al terminar.

**Al terminar, extraer del JSON** (para los marcadores del borrador):

| Dato | Campo del JSON |
|---|---|
| `SHARE_ID` | permalink del share creado |
| `NONCE` / `CONFIRM-SYNTH-*` | `nonce` / `marcador` del run |
| N de 5 éxitos | contar `exito:true` |
| timestamps de hits | log del colector / campo `canario` |

**Decisión inmediata:**

- N ≥ 3 → continuar a Fase 2 ✅
- N < 3 → **NO ENVIAR** (umbral ≥50% del programa). Documentar como tested-and-negative y pasar a E17.

⏱️ Si el driver falla a mitad: revisar la consola; los reintentos manuales solo tras 10 min de pausa
(no meter más tráfico en A el mismo día si hubo 403).

---

## Fase 2 — Rellenar borrador con números reales · ⏱️ 5 min

Abrir `E16-DESCRIPTION-EXTRAINFO-BORRADOR-2026-09-07.md` y sustituir los ~10 marcadores
`<<...>>` con la tabla de sustitución del propio documento (Fase 1 ya extrajo los datos).

Checklist de sustitución:
- [ ] `<<SHARE_ID>>`, `<<PAYLOAD_BLOQUE>>`, `<<ID>>`, `<<N>>`, `<<DETALLE_INTENTOS>>`
- [ ] `<<HORAS_HITS>>`, `<<FECHA>>`, `<<BODY_CREACION_SHARE>>`, `<<RESPUESTA_200>>`
- [ ] Severidad: `<<P2/P3/P4>>` + `<<JUSTIFICACION_SEVERIDAD>>` según la tabla de resultados del panel-check
- [ ] Si el canario capturó PII real → VRT sube a `Cross-Tenant PII` y se propone P1
- [ ] 0 hostnames internos · 0 nombres de herramientas · 0 menciones a otros vectores

---

## Fase 3 — Panel check (mismo día del submit) · ⏱️ 5–8 min

En `bugcrowd.com/engagements/openai-safety`, con el checklist de
`E16-PANEL-CHECK-DUPLICADOS-VRT-2026-09-06.md` (7 términos en orden):

| Término | Bloquea si el hit comparte el mecanismo: share → sesión de la víctima → exfil a endpoint externo |
|---|---|
| `indirect prompt injection` | sí |
| `shared prompt` | sí |
| `prompt share` / `shared conversation` | sí |
| `agent data exfiltration` | sí |
| `cross-account injection` | sí |
| `agentic tools` / `connector exfiltration` | comparar mecanismo |
| `markdown injection` / `dangling markup` | solo si no hay ejecución de agente |

Cross-check en el programa principal `openai` (los duplicados cross-programa cuentan igual).

**Veredictos:**
- Hit con mismo mecanismo → **DUPLICADO: no enviar**, anotar referencia en el triaje.
- Hits genéricos / mecanismo distinto → continuar.

---

## Fase 4 — Submit · ⏱️ 8–10 min

Formulario de `openai-safety` (campos separados Description / HTTP request / Extra info):

| Campo | Contenido |
|---|---|
| Title | fijo del borrador |
| Target | `Agentic Tools` (nunca `Other`) |
| VRT | hoja exacta elegida en Fase 2 (capturar pantallazo si aparece aviso al seleccionar) |
| Bug URL | `https://chatgpt.com/share/p/<SHARE_ID>` real |
| Description | texto del borrador ya rellenado |
| HTTP request | creación del share + 200 con permalink |
| Extra info | repro N/5, prerrequisitos, limitaciones, duplicate check de HOY, cleanup, research |
| Adjuntos | log del colector, pantallazo de la sesión de B, pantallazo del collector hit |

Pulsar **Report vulnerability** → copiar submission ID → anotarlo en triaje + matriz de evidencia.

---

## Fase 5 — Cierre · ⏱️ 3 min

1. Submission ID → `OPENAI-TRIAGE-HALLAZGOS-2026-09-06.md` + `evidencia-poc/README.md`
2. Cadencia de seguimiento: +5–7 días (revisar estado; follow-up educado si no hay respuesta)
3. Q&A prep: crear respuestas probables del triager (mismo formato que `E13-TRIAGER-QA-PREP-2026-09-06.md`)

---

## ⏱️ Total estimado

| Escenario | Tiempo |
|---|---|
| Todo limpio, N ≥ 3/5, panel sin duplicados | **~35–45 min** |
| Con re-verificación de flag + panel lento | ~50 min |
| N < 3 / duplicado → abortar tras Fase 1 o 3 | ~20 min |

## Reglas duras (no negociables)

1. Nunca ejecutar Fases 1–4 con flag activo (Fase 0.2 manda).
2. Nunca enviar con N < 3/5.
3. Duplicados: check el MISMO día del submit.
4. Sin hostnames internos ni nombres de herramientas en NINGÚN campo.
5. El click final del submit siempre lo da el usuario.
