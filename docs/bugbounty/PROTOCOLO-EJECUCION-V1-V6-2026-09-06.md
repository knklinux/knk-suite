# 🎯 PROTOCOLO DE EJECUCIÓN V1, V2, V3, V5, V6 — una pasada (pagos y suscripciones)

> Estado del tiro: V7 ✅ cerrado (no hallazgo) · V4 ✅ cerrado (no hallazgo) ·
> V11 ⛔ no testeable (feature gate "saved places"). Quedan V1, V2, V3, V5, V6.
> Este documento es el plan de **una pasada** con payloads exactos (bundles),
> guardas duras de no-comprar y no-OOS, y el driver ejecutable listo:
> **`backend/ab-pagos-una-pasada.js`** (ritmo ≥2,2 s, compuerta A≠B, auto-refresh
> de tokens, evidencia cruda por paso).
> Sesiones: A=`knklinux@gmail.com` · B=`ninja.bughunter99@gmail.com` · Scope: `chatgpt.com`
> · OOS: `pay.openai.com`, `community.openai.com`, `auth.openai.com` · OPPLAN aprobado.

---

## 0) Límites DUROS (no negociables)

| 🚫 | Regla |
|---|---|
| NO COMPRAR | **`/payments/checkout/confirm` NUNCA se llama** (cargo real). V1 solo crea/lee la sesión de checkout. V3 **nunca** `auto_top_up_enabled: true` con datos reales; solo `update` con parámetros inválidos y revert posterior. V6 solo `GET`, nunca canjea. |
| NO OOS | Si una respuesta contiene URL a `pay.openai.com` / `community.openai.com` / `auth.openai.com` se registra y **NO se sigue**. El driver detecta `oos` por paso. |
| NO ABUSO | V5: **máximo 2 llamadas** a `consume` (doble gasto del mismo `redeem_request_id`), solo cuenta propia. Sin enumeración de ids ajenos. |
| RITMO | ≥2,2 s entre peticiones (aplicado por el driver). Ante 429/CAPTCHA → parar 60 s y ritmo ≥5 s. |
| DATOS | Solo `SYNTHETIC-*`; prohibido id/email real ajeno. |

## 1) Orden de una pasada y payloads exactos (extraídos de los bundles)

### V1 — IDOR checkout (cross-read de `checkout_session_id`)
Shape bundle: `POST /payments/checkout` body:
```json
{"entry_point":"probe","checkout_plan_type":"plus","checkout_ui_mode":"custom",
 "device":"desktop","latency_improvements_group":"probe","prefetch_checkout_group":"probe",
 "checkout_session_prefetch_start_surface":"probe"}
```
```
1. BASELINE B: POST /payments/checkout  → 200 {checkout_session_id, processor_entity}
2. CRUZADA A→B: GET /payments/checkout/{processor_entity}/{checkout_session_id_de_B} → esperado 403/404
3. CRUZADA A→B: POST /payments/checkout/snapshot {snapshot:{billing_address:{name:null,address:{}}}} → esperado 403/404
```
**Hallazgo si:** A ve estado/plan/importe del checkout de B. **Nunca** `confirm`.
**OOS:** si la respuesta trae URL `pay.openai.com`, registrar y parar V1.

### V2 — Workspace self-serve cross-account
```
1. BASELINE B: GET /subscriptions/workspaces/{account_id_B}/self_serve_business
2. CRUZADA A→B: mismo GET con account_id de B → esperado 403/404
3. REPRO 2ª: repetir
```
**Hallazgo si:** A recibe miembros/plan/billing del workspace de B.

### V3 — auto_top_up (parámetros inválidos, sin cargo)
```
1. BASELINE B: GET /subscriptions/auto_top_up/settings?include_payment_method=false (guardar estado)
2. PRUEBA A: POST /subscriptions/auto_top_up/update con:
     {recharge_threshold:0, recharge_target:5}
     {recharge_threshold:-5, recharge_target:-10}
     {recharge_threshold:NaN, recharge_target:NaN}
   → esperado 422/400 por validación
3. REVERT: POST /subscriptions/auto_top_up/update {auto_top_up_enabled:false} (nunca true)
```
**Hallazgo si:** el backend acepta umbrales/importes inválidos que permitan gasto no deseado.

### V5 — rate-limit-reset-credits (doble gasto, máx 2 llamadas)
```
1. BASELINE A: GET /wham/rate-limit-reset-credits (saldo propio)
2. PRUEBA A: POST /wham/rate-limit-reset-credits/consume
     {credit_id, redeem_request_id:'SYNTHETIC-REDEEM-001'}  (intento 1)
3. PRUEBA A: MISMO redeem_request_id (intento 2) → hallazgo SI ambos 200 (doble gasto)
```
**Límite:** 2 llamadas totales, cuenta propia, nunca tocar saldo de B.

### V6 — discount-offer (reutilización)
```
1. GET /subscriptions/credits/discount-offer (1ª lectura)
2. GET /subscriptions/credits/discount-offer (2ª lectura) → ¿mismo offer token?
```
**Hallazgo si:** la misma oferta se puede canjear N veces (no canjear de verdad).

## 2) Evidencia por vector (el driver la guarda solo)

- `evidencia-poc/http/pagos-AB-resultado.json` — pasos, códigos, OOS detectados, paradas
- `evidencia-poc/http/pagos-raw.txt` — request/response crudos por paso
- Matriz tras el tiro:

| # | Baseline B | Cruzada A→B (1ª) | Reproducción (2ª) | Veredicto | Severidad candidata |
|---|---|---|---|---|---|
| V1 | | | | | |
| V2 | | | | | |
| V3 | | | | | |
| V5 | | | | | |
| V6 | | | | | |

## 3) Cómo lanzar

```bash
cd knk-suite && node backend/ab-pagos-una-pasada.js
```

El driver: comprueba la compuerta A≠B → ejecuta V1→V2→V3→V5→V6 en orden →
guarda evidencia → veredicto. Paradas automáticas: token revocado (renueva),
respuesta OOS (registra y continúa marcado), parámetro inválido aceptado
(⚠️ marca posible hallazgo).

## 4) After-action

- [ ] Rellenar matriz con códigos reales.
- [ ] Check de duplicados en el panel Bugcrowd ANTES de redactar.
- [ ] Si hallazgo: borrador con plantilla guía §11 + CVSS justificado; verificar
      impacto real (no basta el 200: hay que demostrar dato/mutación ajenos).
- [ ] Revisar en el log que ninguna petición salió a host OOS.

> Complementa `CHECKLIST-BURP-AB-2026-09-06.md` (§V1–V6). Referencias:
> `OPENAI-SURFACE-MAP-2026-09-06.md`, `OPENAI-AUTH-MODELO-BEARER-COOKIES-2026-09-06.md`,
> triaje `OPENAI-TRIAGE-HALLAZGOS-2026-09-06.md`.