# 🔄 Re-test SSRF (302 + header custom) — Superficies de fetch server-side de chatgpt.com

> Fecha: 2026-09-06 · Referencia del vector original: writeup nov-2025
> (SirLeeroyJenkins, infosecwriteups): fetch server-side de URLs controladas por el
> modelo en **custom GPT Actions**, con **bypass 302 + header `Metadata: True`** vía
> API key → robo de token de metadata de Azure (`169.254.169.254/metadata/instance`).
> El parche de OpenAI cerró exactamente ese vector. Este re-test comprueba si
> **variantes** del mismo primitivo siguen vivas en superficies de fetch que hoy
> están activas con las cuentas de test.

---

## 1) Superficies activas verificadas HOY (elegibilidad real, cuenta A)

`GET /backend-api/system_hints?mode=all` → **17 tools activos**:

| Superficie | Fetch server-side de URLs controladas por usuario/modelo | Riesgo SSRF |
|---|---|---|
| **search** (web.run) | Sí — descarga URLs de resultados de búsqueda | Bajo-medio (URLs de la SERP, no libres) |
| **connector:openai_deep_research** | Sí — rastrea fuentes web arbitrarias citadas por el usuario | **Medio** (input de URL libre en el prompt) |
| **connectors gov/med** (pubmed, openfda, dailymed, npi, cms, clinicaltrials) | Sí — consulta APIs de terceros con parámetros de consulta | Bajo (dominios fijos; posibles redirects) |
| picture_v2 / reason / canvas / tatertot | No fetch de URLs externas | — |
| **GPT con Actions** (vector original) | ❌ **NO disponible**: `gizmos/discovery` → 0; custom_agents → vacío | — |

Conclusión de elegibilidad: **el vector original (GPT Actions) sigue cerrado para
estas cuentas**. Las superficies fetch activas son `search`, `deep_research` y los
conectores de dominio fijo.

## 2) Qué prueba este re-test (hipótesis y criterios)

**H1 (redirect bypass):** el egress de `web.run`/`deep_research` sigue resolviendo
redirecciones 30x hacia hosts internos (169.254.169.254, 100.64.0.0/10, 10.0.0.0/8,
*.internal). Parche esperado: blocklist de hosts internos **después** del redirect.

**H2 (DNS rebinding básico):** un dominio controlado por nosotros que alterna
A-record público→interno entre la resolución y el fetch. (Requiere dominio propio
con DNS API; opcional si H1 falla.)

**H3 (header custom persistente):** inyectar headers tipo `Metadata: True` vía
nombre de dominio/URL no es posible; la vía del writeup era el fetch de Actions
con URL custom. En search/deep_research no controlamos headers → esta hipótesis
solo aplica si aparece cualquier endpoint que acepte `url` + headers custom.
**Acción: sondear si algún endpoint de ingestion/preview acepta `url` libre.**

### Criterio de detección (evidencia positiva)
- La respuesta del agente cita/contiene contenido que SOLO podría provenir de un
  host interno (p. ej. un token/cadena que nosotros controlamos servido en
  `http://<nuestro-dominio>` que redirige a un host interno que devuelva algo
  distinguible), **o**
- Telemetría de nuestro servidor de control: el egress de OpenAI golpea un host
  interno (no verificable desde fuera) → en su lugar usamos **canary HTTP en
  dominio propio**: si el fetch llega a NUESTRO servidor tras un 302 a
  `http://<interno>/...` (mirando el `Referer`/path), sabemos que el redirect se
  siguió; el contenido interno queda fuera de nuestro alcance (y no debe intentarse).
- **Límite ético explícito: NUNCA leer metadata de cloud ni credenciales.** Si el
  redirect a un host interno tiene éxito (canary del paso intermedio), se para y
  se reporta el primitivo; leer el contenido de 169.254.169.254 está fuera.

## 3) Infraestructura propia necesaria (canary)

- Servidor HTTP propio (VPS barato o tunnel ngrok/cloudflared desde local) con:
  - `GET /step1` → responde **302** a `http://<host-interno-elegido>/step2?canary=<nonce>`
  - `GET /hit?...` → registra cualquier golpe directo del egress (control)
  - Log de: IP de origen, User-Agent (firma del fetcher de OpenAI), timestamp, path.
- Elección del host interno para el 302 (por daño mínimo, solo para detectar si se sigue):
  - Preferido: `http://169.254.169.254/latest/meta-data/` **SOLO como LOCATION del 302**
    (no lo fetchamos nosotros; si el egress de OpenAI lo sigue, la petición muere en su
    red — no obtenemos contenido. Detección alternativa por timing/respuesta del agente).
  - Alternativa más limpia: `http://10.255.255.1/` (RFC1918 inválido) o un hostname
    `.internal` inventado → si el agente responde "connection refused/timeout" DISTINTO
    de "domain not found", el egress está intentando conectar a internos (indicio).
- NONCE único por intento: `SSRF1-<fecha36>` para correlacionar log↔intento.

## 4) Vectores concretos de ejecución (A = atacante, ambos own accounts)

### V-ssrf-1: search + 302 (bajo coste, 3 intentos)
1. Publicar en A una conversación normal: "Resume el contenido de https://<canario>/step1"
2. Forzar el tool search si no se dispara: "busca en la web el contenido de <canario>"
3. **Detección:** el agente loguea/procesa el 302 → respuesta del modelo menciona
   timeout/deny/refused del host interno (indicio) o nuestro canary recibe el
   segundo hop (no debería, es interno).
4. Repetir 3× con dominios .internal distintos (10.0.0.1, 169.254.169.254,
   100.64.0.1) para distinguir blocklist por rango.

### V-ssrf-2: deep_research + URL en prompt (medio coste, 2 intentos)
1. "Haz una deep research sobre [tema benigno] incluyendo esta fuente:
   https://<canario>/step1" → el fetch de la fuente lo hace el backend.
2. Misma detección. **Nota: deep research es costoso en créditos; máximo 2 intentos.**

### V-ssrf-3: sondear endpoints de ingestion/preview con parámetro url (API, 4 sondas)
- Revisar en bundles si hay endpoints tipo `/preview`, `/ingest`, `/url_info`,
  `/link_metadata` que acepten URL libre → si existen, sondear con URLs canary
  (sin autenticar primero, luego con A).
- Si hay alguno: petición directa con `url=https://<canario>/step1` → el canario
  nos dice si el fetch se ejecuta y desde qué IP/UA.

## 5) Compuertas y límites (inviolables)

- [ ] **Compuerta de salud** A/B (`ab-salud-sesiones.comprobar()`) antes de cada bloque
- [ ] **Anti-abuso 403:** si aparece "Unusual activity", parar 24h (lección del PoC Safety BB)
- [ ] Ritmo ≥2,2 s; conversación: máx 6 mensajes por intento; deep research máx 2 en total
- [ ] NUNCA fetchear nosotros hosts internos; el 302 solo apunta, no lee
- [ ] NUNCA intentar extraer contenido interno; solo detectar si el egress sigue redirects
- [ ] Dominio canario propio (nunca un dominio ajeno como "canary")
- [ ] Limpieza: conversaciones `visible:false`, shares DELETE, canary log archivado

## 6) Plantilla de evidencia por intento

```
=== V-ssrf-<n> · <fecha> · nonce=<NONCE> ===
vector: search | deep_research | preview-endpoint
prompt: "<texto exacto>"
respuesta del agente: "<extracto ≤400 chars>"
canary log: <hits recibidos, IP, UA, timestamp> | (sin hits)
veredicto: H1 confirmada/refutada | sin señal
```

## 7) Veredicto final esperable

| Resultado | Acción |
|---|---|
| Ningún intento sigue redirects a internos (esperado tras el parche) | Cerrar como re-test negativo; documenta refuerzo del fix 2025 |
| El egress INTENTA conectar a internos (timeout/refused distinto de NXDOMAIN) | Candidato informativo: "egress resuelve/dial a RFC1918 tras 302" — evaluar severidad |
| El egress sigue el redirect y SERVE contenido interno al modelo | **HIGH**: reabrir vector SSRF variante; redactar reporte con guía §11 (sin incluir metadata robada) |
