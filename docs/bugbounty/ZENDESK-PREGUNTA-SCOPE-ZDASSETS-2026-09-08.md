# ❓ Borrador de pregunta al panel Zendesk — ¿Está *.zdassets.com en scope? (2026-09-08)

> Propósito: aclarar por escrito si la CDN de assets de Zendesk
> (`zdassets.com`, incluido su entorno `static-staging`) está dentro del scope
> del programa, ANTES de cualquier contacto con ella. Publicar desde la cuenta
> del usuario en el hilo del engagement (`bugcrowd.com/engagements/zendesk`),
> sección de comentarios/preguntas. Texto final en inglés, listo para pegar.

---

## Contexto (para el usuario, no para el post)

- El brief lista como target `https://{subdomain}.zendesk.com/` — la CDN no
  aparece ni como in-scope ni en exclusiones explícitas.
- El bundle público del messaging widget (`z2-messaging-widget.js`) referencia
  `static-staging.zdassets.com` (además de producción).
- Razón para preguntar: los entornos de staging de CDNs compartidas suelen
  tener sourcemaps/flags de debug — valioso SI y SOLO SI el programa lo
  autoriza. Tocarlo sin permiso = "out of scope" + daño de reputación.

## Texto para pegar en el panel (EN — tono cooperativo, pregunta concreta)

```markdown
Hi team,

Quick scope clarification before we do any testing: the browser widgets that
power the Zendesk AI agent (messaging widget, Help Center end-user assets)
load from `static.zdassets.com`, and the widget bundle also references
`static-staging.zdassets.com`.

The brief lists `https://{subdomain}.zendesk.com/` as the in-scope target,
but the CDN hosts that serve the product's own JavaScript and per-tenant
configuration are not mentioned either way.

Could you confirm:

1. Is `*.zdassets.com` (production CDN) in scope when the vulnerability is
   reachable through an in-scope `{subdomain}.zendesk.com` page or widget?
2. Is `static-staging.zdassets.com` in scope, or should it be considered
   strictly off-limits?

No testing has been performed against either host — asking first to make
sure we stay within the program's boundaries.

Thanks!
```

## Por qué este texto funciona (reglas de la guía)

- **Pregunta cerrada y binaria** — fácil de responder sí/no, no invita a un
  "it depends" que deje todo igual
- **Demuestra buena fe explícita** ("No testing has been performed") — los
  triagers lo valoran y suele acelerar la respuesta
- **No filtra el interés concreto** (no menciona staging/sourcemaps como
  objetivo de ataque) — solo pide el mapa, no regala la técnica
- **En inglés**, como el resto del programa
- Sin nombres de herramientas, sin hostnames internos, sin técnica

## Qué hacer con cada respuesta

| Respuesta | Acción |
|---|---|
| "Sí, *.zdassets.com in scope" | Recon pasivo de staging (sourcemaps, debug flags) — sin requests activos hasta nueva aclaración; guardar la respuesta como autorización |
| "Solo prod, staging off-limits" | Registrar; prod CDN solo si la vuln es alcanzable desde el widget in-scope |
| "Todo fuera de scope salvo {subdomain}.zendesk.com" | Registrar; la superficie CDN queda cerrada — enfocar 100% en la instancia propia |
| Sin respuesta en 7 días | 1 follow-up educado en el mismo hilo; mientras tanto, trabajar solo con la instancia propia |

## Antes de publicar (checklist del usuario)

- [ ] Login de Bugcrowd en la ventana CDP 9340
- [ ] Ir al hilo del engagement Zendesk → campo de comentarios/pregunta
- [ ] Pegar el texto EN tal cual
- [ ] Guardar screenshot + URL del comentario en `evidencia-poc/pantallas/`
- [ ] Anotar la fecha — si en 7 días no hay respuesta, follow-up
