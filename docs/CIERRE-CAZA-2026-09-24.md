# Cierre de caza 2026-09-24 — todas las líneas, veredicto y reapertura

Regla triple aplicada: cobertura + módulos (hunt-verify 11/11) + huecos.

## E13 (Bugcrowd, P4 enviado b8370246) — VIVO, en espera de triage

Kit de réplica listo (`E13-RESPUESTA-TRIAGER-2026-09-21.md`). Reapertura: respuesta
del triager. Vigilar panel 2×/semana.

## OpenAI Bugcrowd — CERRADO sin reportable

Takeovers (12+11+1) verificados vivos/no-reclamables; IDOR convs/shares/files
fail-closed A↔B; XSS anon+auth sin reflejo real; uploads defendidos
(attachment+CSP); SVG sin callback; redirects/CSRF cerrados; DMARC sin PoC;
token boundaries sin fuga; Sora sunset; platform aparcado (sesión en memoria,
cuenta $0); sentinel aparcado. Evidencia: #112, #114-120, #122, #125, #126, #128, #133, #136.

## Adobe Intigriti — CERRADO hasta cuota/login

Anon + sesión: stock/IMS/authorize/account sin hallazgo; Firefly N1 bloqueado
por `taste_exhausted` (cuota diaria); image-v5 pendiente de bodies; commerce
graphql pendiente de URL exacta; Behance IDOR cerrado (fail-closed, enum OOS);
Sora N/A. Reapertura: cuota fresca + bodies generate-async. E#137, #138, #147, #148, #158.

## Marriott H1 — CANDIDATO (sin control demo)

`29hqwahr8wryun2g` → WP Engine sin mapear (#142 confirmado). Falta reclamo
(control demo) — bloqueado: exige tarjeta. Resto cerrado (takeovers vivos,
allianzwidget limpio, UAT muertos).

## Crypto.com H1 — pendiente de login

Sin login mapeado (tickets app 340KB, muertos sin dangling, js/Pay vivos,
Superlogic vivo). Valor: lógica tickets con cuenta. #122, #132, #155.

## Tesla / 1Password (Bugcrowd) — baselines, falta login

Auth surfaces vivas (Tesla Auth 200, my/start 200). Ficha Tesla real aplicada
(12 scopes + 11 OOS). #123, #124, #149.

## Cloudflare / Atlassian / Epic / Rockstar / PlayStation / Payoneer / Infomaniak /
## MercadoLibre / Dyson / Kiteworks — barridos sin login cerrados

Sin takeover ni reflejos. Dyson + ML + Marriott-www vallados por IP (tethering
para reintentar). Kiteworks: OAuth descubierto, falta client_id/cuenta test.
Evidencia: #113, #121, #123-124, #129-130, #134, #140-146, #149, #154, #157.

## Infra de caza — operativa

Fail-closed restaurado al arrancar (bug real cazado por hunt-verify).
Proxy modo estricto. Cookie-jar + import Firefox. HPP + grep-match. 17 presets.
Fallbacks crt.sh/wayback. Engagements + ciclo retest. Panel: 0 medium abiertos.

## Deuda / aparcados

- PDF export (falta binario headless), smoke `elapsedMs` (mock a medias ajeno),
  site-map Target, import OpenAPI/cURL, match&replace proxy, talk ya con auto-datos.
- GitHub: retention 7d aplicado; borrar artefactos viejos (UI) + ver job que falla.
- Limpieza UI testigos en cuentas (operador). E13/blog/Dyson/marriott-WP: vigilancia.
