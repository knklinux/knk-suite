# 🔐 Check de panel Bugcrowd para E13 — guía paso a paso (login del usuario)

> Fecha: 2026-09-06 · Programa: `bugcrowd.com/engagements/openai`
> Estado actual: **sin sesión** en el navegador de evidencias (verificado por
> `backend/check-panel-bugcrowd.js`, exit 2). El navegador Edge ya está abierto
> en la página del programa, perfil `openai-poc`, puerto CDP 9336.

## Qué está listo
- ✅ Navegador de evidencias abierto en `https://bugcrowd.com/engagements/openai`
- ✅ Script de lectura automática creado: `backend/check-panel-bugcrowd.js`
  (paso 1: detecta login; paso 2: extrae known-issues JSON + targets/scope + E13)
- ⏳ **Tu acción única: hacer login como Hacker**

---

## PASO 1 — Tu login (2 min, en la ventana Edge abierta)

1. Ve a la ventana de **Edge que acabo de abrir** (título "Bug Bounty: OpenAI - Bugcrowd").
2. Arriba a la derecha pulsa **"Hacker Login"** (NO "Customer Login").
3. Introduce tus credenciales de Bugcrowd. Si tienes 2FA, complétala.
4. Cuando el dashboard cargue (verás tu avatar/nombre arriba), **dime "ya"**.

> Alternativa: si prefieres login en tu navegador normal, abre tú la página y
> sáltate el paso 3 — pero entonces el check de known-issues lo haremos a mano.

## PASO 2 — Me dices "ya" y yo ejecuto (30 s)

Reejecuto `backend/check-panel-bugcrowd.js`, que con tu sesión extraerá:
- **Targets**: tabla completa de in-scope/out-of-scope → confirmar si
  `*.oaiusercontent.com` (host del SAS del E13) está en scope, o si hay que
  argumentar el scope desde el lado `chatgpt.com` (la API que emite la capability).
- **Known Issues JSON** (`engagement_known_issues.json`, requiere login): búsqueda
  de `upload`, `SAS`, `signed URL`, `reservations`, `files` → descartar duplicado.
- Sondas del historial de submissions.

Evidencia que quedará guardada:
- `evidencia-poc/http/bugcrowd-panel-estado.json`
- `evidencia-poc/http/bugcrowd-panel-scope.txt`

## PASO 3 — Decisión de envío del E13 (con los datos)

| Resultado del check | Decisión |
|---|---|
| `*.oaiusercontent.com` in-scope + known-issues sin duplicado | **Enviar** el informe final EN (`OPENAI-REPORTE-E13-EN-FINAL-2026-09-06.md`) |
| `*.oaiusercontent.com` out-of-scope, pero la API que emite la SAS (`chatgpt.com/backend-api/files/upload_reservations`) in-scope | **Enviar** con el párrafo de scope del Anexo B (vulnerabilidad en el diseño de la API de chatgpt.com; el host de storage es solo donde la capability ejecuta) |
| Duplicado en known-issues | **No enviar**; cerrar E13 como duplicado con la referencia y pasar al siguiente vector |

## Notas de cumplimiento
- Todo lo que leo con tu sesión es **lectura pasiva del panel** (nada de submits,
  nada de comentarios, nada de cambios de estado).
- El login permanece en tu perfil local `openai-poc`; no se exporta ni comparte.
- Si prefieres revisar known-issues a mano, los filtros exactos están en el PASO 2.
