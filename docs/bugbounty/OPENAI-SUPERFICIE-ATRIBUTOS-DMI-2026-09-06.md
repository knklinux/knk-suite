# Superficie de atributos y punto de inyección CSS/DMI — chatgpt.com

**Fecha:** 2026-09-06 · **Método:** estático (bundles descargados) + empírico (share SSR real) · **Scope:** chatgpt.com / cdn.oaistatic.com (en scope, programa Bugcrowd de OpenAI)

Complementa `OPENAI-CSP-SANITIZER-CSS-EXFIL-2026-09-06.md` (CSP inexistente en páginas autenticadas + sanitizer `skipHtml`/allowlist) con el **mapa completo de sinks de atributos y de dónde aterriza el contenido de usuario** en el DOM y en el SSR.

---

## 1. Inventario de sinks que BYPASEAN el escaping de React

En el SPA, TODO atributo renderizado por JSX es escapado por React en runtime (`&<>"'`). Los únicos sinks que inyectan HTML crudo son:

| Sink | Bundle | ¿Datos de usuario? | Veredicto |
|---|---|---|---|
| `<style dangerouslySetInnerHTML={{__html:Ior}}>` (voice-floating-orb) | `8b34dbc2-…` | **NO** — CSS estática con template literal que interpola solo constantes internas (`og`, `Zg`, `Gw.duration`, `H7.duration`, `Dor`) | Seguro |
| `StringToSVG` (`dangerouslySetInnerHTML: s`) — renderizador de iconos SVG | `conversation-small-…` (uso) | **NO** — lookup por nombre de icono conocido; `children` es fallback | Seguro |
| `dangerouslySetInnerHTML` en meta/scripts de hydration | `entry.client-…`, `root-…` | **NO** — `JSON.stringify` de estado interno (hydration data), no contenido de usuario | Seguro |
| Renderer de mensajes de chat (`N3t`) | `conversation-small-…` | Usa `skipHtml: !0` + `allowedElements:[p,a,strong,em,br]` + `urlTransform` allowlist (`^(https?|ircs?|mailto|xmpp)$`) + `target='_new'`/`rel='noopener noreferrer'` | **Sin superficie** — el HTML crudo de los mensajes nunca llega al DOM |

**Búsqueda de bindings de atributos con datos de usuario** (`alt:`, `title:`, `aria-label:`, `href:` con interpolación): **cero coincidencias** de interpolación de cadena sin escapar en todos los bundles. Todo pasa por JSX → escape de React.

---

## 2. Campos de usuario que se renderizan en atributos — SPA

| Campo | Aterriza en | Contexto | Escaping |
|---|---|---|---|
| Título de conversación (`Zt ?? 'ChatGPT'`) | `document.title` | Texto (DOM API) | Seguro — no es atributo |
| Título de conversación / GPT / share | `<title>`, `og:title`, `og:description`, `twitter:*` (builder `jRe` con `seoFields?.openGraphTitle` etc.) | Atributo/texto vía React | Escapado por React (SSR y CSR) |
| Nombres/descripciones de GPT, workspace, archivos | Elementos de texto y atributos JSX | Atributo/texto vía React | Escapado por React |
| `alt` de imágenes subidas | `alt` JSX | Atributo vía React | Escapado por React |

**Conclusión SPA:** no hay ningún campo de usuario que llegue a un atributo sin pasar por el escape de React.

---

## 3. Superficie SSR — páginas de share (la única renderizada por servidor)

Verificación empírica sobre `GET https://chatgpt.com/share/67bfc390-23cc-800f-8700-8408a813cde7` (share público, sin autenticar, UA de sesión):

- **200, 590 KB.** El share usa **React Router data-router con streaming**: la conversación completa se sirve como **JSON** en `window.__REACT_QUERY_CACHE__` + chunks `streamController.enqueue(...)` (loaderData: `pageTitle`, `ogTitle`, `serverResponse` con los mensajes completos).
- **El contenido de la conversación NO se renderiza como HTML en el servidor.** No hay `<div>` de mensajes en el HTML visible: los 65 KB de "stream" son JSON serializado, no HTML. El contenido se hidrata en cliente con el renderer `N3t` (`skipHtml` + allowlist).
- Lo único renderizado como HTML real por el servidor: `<title>ChatGPT - {título}</title>`, `<meta property="og:title" content="ChatGPT - {título}">`, og:description, twitter:title/description, og:image (con `alt` estático de OpenAI). Todo vía React SSR → **texto/atributo escapado**.
- **Sin breakout `</script>`:** dentro de los payloads JSON no hay `<` crudo (primer `<` del script en posición 0), ni `\u003c`, ni `<\/` — el serializador no deja escapar el cierre del script.
- **Tokens en la página pública: NINGUNO.** `csrf|accessToken|__Host-*|oai-did`: 0 coincidencias. Una página share pública no expone ningún secreto en atributos.

Evidencia guardada: `evidencia-poc/http/share-ssr-ejemplo-publico.html` (590 KB, HTML crudo) y `share-ssr-streamed-html.txt` (JSON de loaderData decodificado).

---

## 4. ¿Qué secretos hay en atributos seleccionables por CSS (`[attr^=…]`)?

| Secreto | Dónde vive | ¿Atributo del DOM seleccionable? |
|---|---|---|
| `accessToken` (Bearer) | En memoria del SPA + `/api/auth/session` (JSON de red) | **No** — nunca en un atributo DOM |
| `__Host-next-auth.csrf-token` | Cookie HttpOnly | **No** — no accesible al CSS |
| `csrfToken` de sesión | JSON de hydration (`/api/auth/session` body) | **No** — dentro de un `<script>` JSON, no atributo |
| `__Secure-next-auth.session-token` | Cookie HttpOnly | **No** |
| Página share pública | — | **Ningún secreto presente** (verificado) |

La precondición del exfil CSS por atributos (secreto en `value`/`href`/`data-*`/`meta content` seleccionable) **no se cumple en ninguna superficie** del target.

---

## 5. Veredicto de reportabilidad (umbral de la guía §3/§8)

- **Hoy: no reportable.** No hay punto de inyección (ni en mensajes, ni en títulos/nombres, ni en sinks raw) y no hay secreto en atributo seleccionable. Un informe sería N/A.
- **Dónde viviría un futuro hallazgo** (en orden de probabilidad): una superficie renderizada por servidor o por raw-HTML que tome metadatos de usuario sin sanitizar — metadatos de share alternativos (elogios del `hasStoredOgCopy`/`hasConversationShareOgImageTemplate` sugieren variantes de og en desarrollo), descripciones de GPT en páginas de tienda/listing SSR, o cualquier nuevo punto con `allowDangerousHtml` activo fuera de `N3t`.
- **Umbral si aparece:** (1) punto de inyección real en contexto de atributo dentro de scope, (2) secreto PROPIO capturable (csrf/session propio, nunca de terceros), (3) PoC end-to-end con el laboratorio verificado `lab/css-exfil/` (canal `background-image` sin restricción `img-src` — la CSP no defiende), (4) 2 reproducciones limpias sin enumeración y respetando rate limit. Severidad propuesta: Low–Medium (Medium+ si encadena a takeover).

---

## 6. Cómo re-ejecutar la verificación

```bash
# 1) Refetchear cualquier share público y re-analizar
node backend/tmp-ssr-analyze.js        # extrae y decodifica los chunks SSR
node backend/tmp-ssr-escape-check.js   # comprueba escapes JSON/título/meta
# 2) Re-escaneo estático de sinks (sobre ~/.knk-suite/evidencia/*.js)
#    dangerouslySetInnerHTML | StringToSVG | skipHtml | allowedElements | seoFields
```

**Estado:** superficie mapeada y verificada empíricamente. Sin hallazgo reportable en este vector; se mantiene el canal CSS-exfil como plantilla lista (`lab/css-exfil/`) para cuando (y si) aparezca un punto de inyección.