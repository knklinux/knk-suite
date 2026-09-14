# Bootstrap de la app de escritorio y la cookie `knk_token`

**Fecha:** 2026-09-14 · **Estado:** investigación completa, causa raíz reproducida en vivo.

Este documento explica cómo arranca `knklinux-desktop.exe`, cómo se supone que
el webview recibe la cookie de sesión `knk_token`, y por qué **un primer
arranque limpio se queda en pantalla en blanco** desde el endurecimiento del
gate (`7bf0f61`, "v4.7 — Tor real…", 2026-09-14 15:55).

---

## 1. Cómo arranca la app (secuencia real)

1. **`tauri.conf.json` declara dos ventanas** con URL estática:
   - `main` → `http://127.0.0.1:8086`
   - `assistant` (oculta) → `http://127.0.0.1:8086/#assistant`
2. **El runtime de Tauri crea AMBAS ventanas ANTES de ejecutar `setup()`** —
   o sea, antes de que exista backend. Ambas navegaciones iniciales reciben
   `ECONNREFUSED` y Chromium agenda su recarga automática.
3. `setup()` corre: `sweep_orphans()` → `start_backend()` (spawn de node +
   `wait_for_backend(20)`, que sondea el puerto TCP) →
   `main.navigate("http://127.0.0.1:8086")` (SOLO la ventana `main`; la
   `assistant` nunca se re-navega).
4. El watchdog cada 10 s comprueba `health_ready()` (conexión TCP al 8086) y
   re-spawnea el backend si murió. **No re-navega ninguna ventana.**

## 2. Cómo se autentica el webview

`backend/lib/auth.js`:

- Token: `KNK_API_TOKEN` (env) o aleatorio persistido en
  `~/.knk-suite/api-token` (0600).
- `auth.cors` — el PRIMER middleware, montado antes del estático y de las
  rutas — llama `setTokenCookie(res)` en **TODAS** las respuestas, incluidas
  las 401 y las del HTML. La cookie es
  `knk_token=<token>; HttpOnly; SameSite=Strict; Path=/` **sin `Expires` ni
  `Max-Age` ⇒ cookie de SESIÓN**: Chromium la guarda en memoria y solo la
  vuelca al disco al cierre limpio del navegador (y con la app viva el
  fichero ni siquiera es legible: está bloqueado).
- `auth.requireToken` — solo para `/api/*` y el fallback SPA — exige la
  cookie (o `X-KNK-Token`).

La primera respuesta HTTP que recibe el webview ya lleva el `Set-Cookie`.
**En teoría basta con recargar la página. En la práctica no ocurre** (§3).

## 3. Causa raíz del primer arranque en blanco (reproducida)

Con perfil limpio (`WEBVIEW2_USER_DATA_FOLDER` temporal, 2 ejecuciones):

| Evidencia | Valor medido |
|---|---|
| `GET /` sin cookie | **401 JSON** + `Set-Cookie: knk_token=…` |
| `GET /assets/*` sin cookie | 200 (el estático no pasa por el gate) |
| History del perfil limpio | `8086/` con **título vacío** (el HTML nunca renderizó) y **1 sola visita** |
| Navegación adicional de `main.navigate()` | ninguna: la visita de 20:05:57 ES esa única visita |
| Cookie jar tras 2 arranques + taskkill | **0 cookies** |

Mecanismo completo:

1. El HTML de la app está detrás del gate (`app.get('*')` envuelve
   `res.sendFile` en `auth.requireToken`).
2. La ÚNICA re-navegación (`main.navigate`) coincide con la recarga
   automática de Chromium que ya disparó la conexión rechazada: la segunda
   petición es absorbeda por el deduplicador de navegaciones y **no llega a
   salir al cable**. El webview se queda mostrando la respuesta que tiene:
   el cuerpo JSON del 401 (pantalla en blanco).
3. Aunque la petición saliera, llegaría la 401 **con** `Set-Cookie`; el
   navegador almacenaría la cookie… pero no reintentaría por sí solo.
4. No hay ningún mecanismo que vuelva a navegar después: ni el watchdog
   (solo mira el puerto TCP), ni el frontend (para cargar, necesita el HTML
   que no tiene).

**Por qué "funciona" en tu máquina:** el perfil WebView2 real ya acumula la
cookie de sesiones anteriores. El fallo solo se manifiesta con perfil
nuevo/borrado, tras cambiar el token (el jar guarda uno viejo e inválido:
401 hasta borrar cookies), o en una instalación limpia.

**No es una regresión del gate de hoy:** antes de `7bf0f61` el fallback SPA
servía `index.html` SIN token (así el primer arranque siempre funcionaba) y
`setTokenCookie` ni existía. El endurecimiento cambió el orden de arranque
de facto: primero se exige la credencial y luego hay forma de entregarla.

## 4. El bootstrap correcto (recomendación)

La entrega de la credencial debe ser explícita y no depender de recargas.
Diseño propuesto (sin tocar la CSP):

1. **Ruta de bootstrap sin token**, p. ej. `GET /bootstrap` exenta del gate
   (como `/health`): responde `index.html` + `Set-Cookie`. Solo sirve HTML,
   nunca datos — el riesgo es idéntico al del estático.
2. **En `setup()`, navegar AMBAS ventanas a `/bootstrap`** una vez
   `wait_for_backend` retorna (la `assistant` incluida: hoy arranca contra
   un backend muerto y su recarga automática también cae en 401).
3. Opcional, defensa extra: si `main` detecta un 401 en el documento,
   re-navega a `/bootstrap` desde JS (`window.location.replace`).

Con (1)+(2) el primer arranque limpio renderiza a la primera: la petición
trae la cookie plantada y `/api/*` autentica sola.

## 5. Verificación rápida (comandos)

```bash
# 401 con Set-Cookie (así se ve el arranque limpio en el cable):
curl -si http://127.0.0.1:8086/ | head -8

# Perfil limpio para reproducir:
WEBVIEW2_USER_DATA_FOLDER="%TEMP%\knk-clean" knklinux-desktop.exe
# History esperado: 8086/ con título vacío, jar de cookies vacío.
```

## 6. Estado

- Causa raíz: **documentada y reproducida** (2 perfiles limpios).
- Fix: **pendiente** — la recomendación de §4 está lista para implementar.
- Ficheros implicados: `backend/index.js` (fallback), `backend/lib/auth.js`
  (cookie de sesión), `src-tauri/src/main.rs` (setup/navigate),
  `src-tauri/tauri.conf.json` (ventanas).
