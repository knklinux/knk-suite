# 🧱 ChatGPT — CSP y sanitizador de markdown: viabilidad de exfiltración CSS / DMI

> Verificado el 2026-09-06 (noche) contra producción y los bundles del SPA
> (`~/.knk-suite/evidencia/*_surface-*.js`). Pregunta: ¿es viable la exfiltración
> solo con CSS (attribute selectors + background-image) o DMI (dangling markup)
> en el contenido de chat renderizado? Respuesta corta: **no hoy** — el
> sanitizador lo impide — y el CSP **no** es la defensa (no existe prácticamente).

---

## 1) CSP real de chatgpt.com (medido con peticiones reales)

| Página | Header `Content-Security-Policy` | Meta CSP |
|---|---|---|
| `GET /` sin sesión | `base-uri 'none'; object-src 'none'; frame-ancestors 'self'` | ninguna |
| `GET /` con sesión (SPA shell, 573 KB) | **ausente** | ninguna |
| `GET /c/{id}` con sesión (chat) | **ausente** | ninguna |
| `GET https://cdn.oaistatic.com/` (scope) | **ausente** (404 de raíz, sin CSP) | ninguna |

**Conclusiones CSP:**
- No hay `default-src`, `img-src`, `style-src`, `connect-src`, `script-src` en
  ninguna página autenticada. La CSP solo cubre `base-uri`, `object-src` y
  `frame-ancestors`.
- **La exfiltración vía `background-image`/`<img src=attacker>` NO está bloqueada
  por CSP** (no hay `img-src`). Un canal de exfiltración CSS, de existir un punto
  de inyección, funcionaría sin cortapisas de CSP.
- Otros headers defensivos presentes: `x-content-type-options: nosniff`,
  `referrer-policy: strict-origin-when-cross-origin`,
  `cross-origin-opener-policy: same-origin-allow-popups`, HSTS.

## 2) Sanitizador de markdown en contenido de chat (código de los bundles)

El renderizado de mensajes usa **react-markdown** (componente `N3t`) con:

```js
<N3t
  allowedElements={P3t}        // P3t = ['p','a','strong','em','br']
  skipHtml={!0}                // ← el HTML crudo de los mensajes NO se renderiza
  unwrapDisallowed={!0}        // los tags no permitidos se convierten en texto
  urlTransform={F3t}           // allowlist de esquemas ^(https?|ircs?|mailto|xmpp)$
  rehypePlugins={[[h3e,{target:'_new', rel:'noopener noreferrer'}]]}
/>
```

Hallazgos clave del bundle:

1. **`skipHtml: true`** en el componente del mensaje: aunque el pipeline de
   `rehype-raw` define `allowDangerousHtml: !0` (función `aze` → nodo `raw`),
   el componente que renderiza el chat pasa `skipHtml: true`, así que el HTML
   crudo incluido en un mensaje **se descarta/convierte en texto**, nunca llega
   al DOM como HTML vivo.
2. **Allowlist estricta**: `P3t = ['p','a','strong','em','br']`. Un `<style>`,
   `<img>`, `<form>`, `<input>`… ni siquiera entran en el árbol permitido.
3. **`urlTransform`**: solo `https?|ircs?|mailto|xmpp` — no `javascript:`, no
   `data:`, no esquemas raros. Links a `target='_new'` + `rel='noopener noreferrer'`.
4. `marked` (26 usos) aparece como librería, pero el camino del mensaje es el de
   arriba (react-markdown + rehype con skipHtml).

**Consecuencia:** inyectar `<style>` con selectores de atributos (exfil CSS) o
un tag abierto `<a href='//attacker/?` (DMI) dentro del contenido de un mensaje
**no funciona** — el HTML crudo no se materializa en el DOM del chat.

## 3) Viabilidad por técnica

| Técnica | ¿Viable en contenido de chat? | Motivo |
|---|---|---|
| **CSS exfiltration** (attribute selectors + bg-image) | ❌ No | Sin inyección de `<style>` (skipHtml + allowlist `p,a,strong,em,br`) |
| **DMI** (tag sin cerrar que captura el resto del doc) | ❌ No | El HTML crudo se descarta; no hay atributo reflejado tras el punto de inyección |
| **CSS font-exfil** (`@font-face` unicode-range) | ❌ No | Requiere inyección de CSS, bloqueada igualmente |
| **Canal de salida** (bg-image → attacker) | ✅ Permitido por CSP | No hay `img-src` — pero sin inyección no hay exfil |

## 4) Umbral de reporte (aplicando GUIA_INFORMES_BUGBOUNTY)

Para que CSS-exfil/DMI fuera reportable haría falta **un punto de inyección en
scope** que materialice HTML/CSS controlado en el DOM de una página autenticada.
Superficies candidatas (todas pendientes de verificar, ninguna encontrada aún):

- **Contexto de atributo sin escapar** en campos renderizados por el servidor o
  la SPA: título de conversación compartida, nombre de GPT/share, metadatos de
  enlaces compartidos (`/share/...`), descripciones de workspace/custom GPT.
- **Bypass del sanitizador**: cualquier ruta de render que NO pase por `N3t`
  (vista previa de share, render de attachments/artifacts, mensajes de sistema).
- Las `dangerouslySetInnerHTML` (72 en bundles) no tocan contenido de usuario
  en el camino del mensaje (filtrado por content/message/text: 0 coincidencias).

**Umbral (guía §3/§8):**
- CSS injection → exfiltración de un **token real propio** (CSRF, session-adjacent):
  **Low–Medium** si el PoC demuestra la captura en tu propio endpoint.
- DMI que captura CSRF/session-token: **Medium**; chained a takeover: High.
- Solo teoría sin token capturado o sin punto de inyección: **Informative/N/A**
  — no enviar (quemaría reputación).

## 5) Conclusión operativa

1. El contenido de chat renderizado **no es superficie** para CSS-exfil/DMI hoy
   (sanitizador sólido: skipHtml + allowlist + urlTransform).
2. El CSP **no es la defensa** (ausente en páginas autenticadas): si mañana se
   encuentra un punto de inyección en atributo (títulos, shares, GPT metadata),
   el canal de exfiltración está abierto de fábrica.
3. Siguiente paso lógico: auditar render de `/share/` y metadatos de títulos
   (vector V8) en busca del punto de inyección en atributo; si aparece, el
   umbral Low/Medium aplica con PoC de token propio.

## Referencias

- Bundles: `~/.knk-suite/evidencia/1788663053455_surface-bundle-8b34dbc2-kjj15hg4y6iyx13p.js.js` (react-markdown `N3t`/`PVe`/`aze`/`P3t`)
- Sondas CSP: peticiones reales GET `/`, `/c/{id}`, `cdn.oaistatic.com` (sesión propia)
- Guía de informes: `GUIA_INFORMES_BUGBOUNTY.html` §3 (severidad) y §8 (motivos de rechazo)