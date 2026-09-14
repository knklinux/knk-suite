# 📎 Anexo OPPLAN — Redirección 308 y cambio de scope chat.openai.com → chatgpt.com

> Documento de trazabilidad generado el 2026-09-06. Anexo verificable del OPPLAN
> "OpenAI — superficie SPA ChatGPT (chatgpt.com) + A/B aislamiento/revocación".

## 1) Hecho técnico verificado

`chat.openai.com` (host listado para ChatGPT en el Brief 19-ago-2026) responde
**HTTP 308 Permanent Redirect** con `Location: https://chatgpt.com/`. El SPA real de
ChatGPT se sirve en `chatgpt.com`; los bundles JS en `chatgpt.com/cdn/assets/*.js` (200 directo).

### Evidencia cruda (cabeceras completas)

- Fichero: `evidencia-poc/http/anexo-308-cabeceras-completas.txt`
- Captura: 2026-09-06T03:08:29Z · HEAD https://chat.openai.com/ · UA de sesión

```http
HTTP/1.1 308 Permanent Redirect
Date: Sun, 06 Sep 2026 03:08:29 GMT
Content-Type: text/html; charset=UTF-8
Location: https://chatgpt.com/
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Server: cloudflare
CF-RAY: a36a44fd8f140361-MAD
```

Verificado además con HEAD en dos ocasiones previas esta sesión (mismo 308).

## 2) Transición de scope (diff)

| Campo | Antes (sesión previa) | Después (sesión activa) | Justificación |
|---|---|---|---|
| Target | `chat.openai.com` | `chatgpt.com` | El host del Brief redirige 308 al SPA real |
| Scope | `["chat.openai.com"]` | `["chatgpt.com","cdn.oaistatic.com"]` | Host del producto + CDN estático de OpenAI que sirve los assets del SPA |
| Out of scope | `pay.openai.com`, `community.openai.com` | sin cambios | Se mantienen las exclusiones |
| Rate limit | 2000 ms | 2000 ms | Mínimo obligatorio OpenAI |
| UA | knk-suite-researcher/2.0 bug-bounty-knk_linux | sin cambios | Identidad de investigación |

### Cobertura del cambio

- `chat.openai.com` **NO** queda en el scope de sesión: el gate de KNK lo bloquea
  incluso en el navegador real (evidencia: `evidencia-poc/pantallas/poc-1-scope-block-chat-openai.png`).
- `cdn.oaistatic.com` se usa exclusivamente para descargar assets estáticos del SPA
  (bundles JS), sin sesión y sin mutaciones.

## 3) Trazabilidad de aprobación

- Confirmación explícita del investigador (2026-09-06): opción
  "Mover objetivo/scope a chatgpt.com (Recommended)" aceptada en la suite.
- OPPLAN re-aprobado vía `/api/opplan/approve`:
  - nombre: OpenAI — aislamiento de archivos y conversaciones
  - status: aprobado
  - autorizado: true
  - aprobadoEn: 2026-09-06T02:49:07.692Z
  - scope OPPLAN: ["chatgpt.com","cdn.oaistatic.com"]
- Sesión activa:
  - target: chatgpt.com
  - scope: ["chatgpt.com","cdn.oaistatic.com"]
  - out_of_scope: ["pay.openai.com","community.openai.com"]

## 4) Límites vigentes para el scope ampliado

1. Solo assets estáticos de `chatgpt.com`/`cdn.oaistatic.com` sin autenticación (ya ejecutado).
2. Vectores autenticados: SOLO con dos cuentas propias de test, recursos `SYNTHETIC-*`,
   sin enumeración, sin compras, parando ante PII/429/CAPTCHA.
3. `pay.openai.com` y cualquier redirección a hosts de terceros quedan fuera de alcance
   (el gate de KNK las corta; no se siguen manualmente).

---
*Anexo generado por KNK Suite v2.1 con la evidencia cruda y el estado persistido de la sesión.*
