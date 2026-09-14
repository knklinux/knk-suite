# E17 + E18 — Description y Extra info listos para pegar (con marcadores)

> Fecha: 2026-09-07 · Mismo formato que `E16-DESCRIPTION-EXTRAINFO-BORRADOR-2026-09-07.md`.
> Estado: **borradores completos con marcadores `<<...>>`** — se rellenan con los
> resultados reales de cada driver. Copiar → sustituir → pegar.
> Ambos vectores van al programa **openai** principal (no Safety), target `ChatGPT`.
> Reglas de tono idénticas: sin nombres de suite/drivers, sin hostnames internos,
> sin mencionar otros vectores, tono de investigador manual.

---

# E17 — Re-test SSRF (302 + header) en superficies de fetch de chatgpt.com

## Campos fijos

| Campo | Valor |
|---|---|
| **Title** | `Server-side fetch of model-controlled URLs follows redirects to attacker-controlled hosts — internal-network probing detection via redirect chain (re-test)` |
| **Target** | `ChatGPT` |
| **VRT** | `Server Security Misconfiguration > SSRF` (hoja exacta según resultado; si es solo "internal port scan" → `Internal Port Scan Only` P4) |
| **Bug URL** | `<<URL_AFECTADA>>` (la superficie de fetch donde se reproduzca: browse/search tool o endpoint de ingestion) |
| **Severity propuesta** | `<<P3|P4>>` según lo que demuestre el canario |

## Description (pegar tras sustituir)

```markdown
## Summary

ChatGPT's server-side fetch capabilities (<<SUPERFICIE: web browse/search tool
or ingestion endpoint>>) follow attacker-controlled URLs. Re-testing the
redirect-based technique against the current build, a fetch of an
attacker-hosted URL that answers with a 302 redirect <<RESULTADO_TITULAR: is
followed server-side and the second-hop request reaches the attacker's host /
is NOT followed; the egress refuses to follow redirects>>. Response timing and
error differentials between invented internal hostnames and public domains
indicate <<CONCLUSION_EGRESS: the egress resolves/does not resolve internal
DNS>>. Everything was tested with a self-hosted canary and self-owned
accounts; no internal content was ever read or exfiltrated.

## Environment

- Program: OpenAI (main)
- Affected surface: <<SUPERFICIE_EXACTA>>
- Accounts: self-owned test account; all payloads synthetic, nonce-marked
  (`SSRF1-<run-id>`)
- Canary: self-hosted HTTP collector logging method, path, headers, source IP
- Date of testing: <<FECHA>>

## Steps to Reproduce

1. Host a redirector on my own canary: `GET /step1` → `302 Location:
   http://<INTERNAL_TARGET_MARKER>/x` (targets chosen from documented internal
   ranges — never fetched by me directly; the redirect only *points*).
2. From the test account, prompt the fetch capability: "Summarize the content
   of https://<CANARY>/step1".
3. Observe: (a) my canary logs the initial fetch (source IP + user agent of
   the server-side egress), and <<OBSERVACION_302>>.
4. Differential test: repeat with `10.0.0.1`, `169.254.169.254`,
   `100.64.0.1` and an invented `.internal` hostname — the model's error
   wording (connection refused vs DNS not found) distinguishes whether the
   egress attempts internal connections: <<RESULTADO_DIFERENCIAL>>.
5. Reproducibility: <<N_INTENTOS>> attempts, <<DETALLE_INTENTOS>>.

## Evidence

- Canary log: timestamped entries per attempt with source IP/UA
  (`<<LOG_CANARIO>>`).
- Raw model responses per attempt (attached).
- No screenshot of internal systems exists or is claimed — detection only.

## Impact

If the egress follows redirects to internal ranges, an attacker can use the
model's fetch as an internal-network probing primitive (port/host discovery
via error differentials), and in the worst case reach metadata endpoints —
although this re-test <<ALCANCE_REAL: did/did not>> demonstrate reachability
beyond DNS resolution behavior. Even probe-only capability violates the
isolation expected between user-controlled fetches and internal networks.

## Severity justification

`Server Security Misconfiguration > SSRF` — proposed `<<P3|P4>>` because
<<JUSTIFICACION: detection of redirect-following into internal ranges without
content readout is P4 (Internal Port Scan Only); evidence of reaching any
internal service response would raise it to P3>>.

## Remediation suggestion

Do not follow cross-origin redirects for user-supplied fetches (or resolve
the redirect client-side and re-apply egress rules), block link-local/private
ranges at the egress layer by IP, and normalize fetch errors to prevent
internal vs external DNS differentials.
```

## Extra info (pegar tras sustituir)

```
- Reproducibility: <<N>>/<<TOTAL>> identical attempts; nonce-marked runs
  (SSRF1-*) correlated with canary log entries.
- Attack prerequisites: standard account; the fetch capability must process a
  user-supplied URL; attacker hosts the initial redirect target on their own
  infrastructure.
- Limitations: detection-only testing — I never fetched internal hosts
  myself, never attempted to read internal content, and cannot fully rule out
  client-side-only fetch behavior without further instrumentation. Deep
  research variant limited to <<N_DR>> runs (credit cost). The redirect
  technique targets ranges documented as internal; no hostname of any real
  internal service was used.
- Duplicate check: Known Issues and public disclosures reviewed on <<FECHA>>;
  the 2025 public writeup about custom-GPT Actions SSRF (302 + metadata
  header) describes a different surface and payload path — this re-test
  targets the <<SUPERFICIE>> fetch with current build behavior. No duplicate
  found for this surface/mechanism.
- Cleanup: conversations set to not-visible, canary logs archived, no
  third-party infrastructure used.
- Related public research: SirLeeroyJenkins (infosecwriteups, Nov 2025) —
  documented for context; different surface, different bypass, patched at the
  time of that report.
```

### Marcadores E17

| Marcador | Fuente |
|---|---|
| `<<SUPERFICIE>>` / `<<URL_AFECTADA>>` | resultado real del driver (`retest-ssrf-302.js`): qué superficie ejecutó el fetch |
| `<<RESULTADO_TITULAR>>` / `<<OBSERVACION_302>>` | ¿el egress siguió el 302? → log del canario (`evidencia-poc/http/canario-ssrf.log`) |
| `<<RESULTADO_DIFERENCIAL>>` | respuestas del modelo por rango (V-ssrf-1: 10.0.0.1 / 169.254.169.254 / 100.64.0.1 / .internal) |
| `<<N_INTENTOS>>` / `<<DETALLE_INTENTOS>>` / `<<N_DR>>` | log del driver (V-ssrf-1: máx 3 · V-ssrf-2: máx 2 · V-ssrf-3: 4 sondas) |
| `<<CONCLUSION_EGRESS>>` / `<<ALCANCE_REAL>>` | síntesis honesta del canario + diferenciales |
| `<<P3|P4>>` + `<<JUSTIFICACION>>` | regla: detección-only → P4; respuesta real de servicio interno → P3 |
| `<<FECHA>>` / `<<CANARY>>` / `<<LOG_CANARIO>>` | log del canario (IP/UA del egress) |

**Regla de coherencia E17:** si el canario NO registra el segundo hop y los
diferenciales de error no distinguen DNS interno → **NO REPORTABLE** (cerrar
como tested-and-negative, ya se documentó el parche del writeup de 2025).

---

# E18 — Revocación de share deja el contenido accesible (V8)

## Campos fijos

| Campo | Valor |
|---|---|
| **Title** | `Deleted/revoked shared prompt remains accessible via its public permalink after revocation` |
| **Target** | `ChatGPT` |
| **VRT** | `Broken Access Control > IDOR > View Sensitive Information` (o `Failure to Invalidate Session/Data on Logout-analog` si el árbol lo ofrece — decidir con el resultado) |
| **Bug URL** | `https://chatgpt.com/share/p/<<SHARE_ID>>` (el permalink real del PoC) |
| **Severity propuesta** | `<<P3|P4>>` según sensibilidad del contenido residual y persistencia |

## Description (pegar tras sustituir)

```markdown
## Summary

Revoking a shared prompt (<<METODO_REVOCACION: DELETE /share/post/{id} from
the owner's account>>) does not fully invalidate its public permalink
(`share/p/{id}`): <<RESULTADO_TITULAR: the content remains retrievable
without authentication / remains retrievable from caches / becomes
unavailable>> after revocation. Verified end-to-end between self-owned
accounts: owner creates a share → viewer confirms access (baseline) → owner
revokes → viewer re-attempts <<METODOS_REACCESO>> → <<RESULTADO_REACCESO>>.

## Environment

- Program: OpenAI (main)
- Accounts: two self-owned test accounts (A = owner, B = viewer)
- Content: 100% synthetic (nonce-marked `V8-<run-id>`)
- Date of testing: <<FECHA>>

## Steps to Reproduce

1. A creates a shared prompt via `POST /share/post` (body:
   `{post_text: "...", attachments_to_create: [{kind: "prompt", ...}]}`) →
   200 with `post.id` and `post.permalink` (`share/p/{id}`).
2. B opens the permalink → **200 with the full shared content** (baseline
   confirmed).
3. A revokes: `DELETE /share/post/{post_id}` → <<RESPUESTA_REVOCACION>>.
4. B re-attempts access: fresh browser (no cache), anonymous request, and
   cache-busted URL ×3: **<<RESULTADO_REACCESO — p.ej. still 200 with full
   content / 404 as expected>>**.
5. Second cycle with a fresh share to rule out flakiness: <<CICLO_2>>.
6. Reproducibility: <<N/5>> attempts.

## Evidence

- Raw HTTP of every step (create → baseline → revoke → re-access ×3 ×2
  cycles) attached.
- Screenshot of the re-access showing the revoked content (if accessible).

## Impact

A user who deletes a shared item reasonably expects it to stop being
publicly accessible. If the permalink keeps serving content after revocation
(<<CAUSA: cache layer / soft-delete / async invalidation>>), any third party
who saved the URL retains permanent access to content the owner believes is
deleted — privacy impact for shared conversations containing personal
context, and a general trust problem for the share/delete flow.

## Severity justification

`<<P3|P4>>` — <<JUSTIFICACION: if revoked content stays fully readable
indefinitely → P3 (content remains exposed despite explicit user deletion
action); if it persists only in caches with limited TTL → P4>>.

## Remediation suggestion

Propagate revocation to the permalink-serving layer synchronously (or make
the permalink check the share's live status on each request), and purge CDN/
cache entries for the revoked resource.
```

## Extra info (pegar tras sustituir)

```
- Reproducibility: <<N>>/5 attempts across 2 independent share cycles.
- Attack prerequisites: attacker only needs the permalink URL (obtainable
  before revocation — e.g. previously shared, logged, or scraped). The
  vulnerability is the failure to invalidate, not the access itself.
- Limitations: re-access tested via HTTP requests and fresh browser profiles;
  did not test other distribution surfaces (email previews, embeds). Cache
  TTL, if involved, was estimated from observed behavior, not measured
  precisely.
- Duplicate check: Known Issues reviewed on <<FECHA>> for "share revocation",
  "deleted share", "permalink still accessible", "cache invalidation" — no
  duplicate found.
- Cleanup: both test shares deleted, test conversations hidden, no third-party
  data involved.
```

### Marcadores E18

| Marcador | Fuente |
|---|---|
| `<<SHARE_ID>>` | `v8-revocacion-resultado.json` → permalink del ciclo |
| `<<METODO_REVOCACION>>` / `<<RESPUESTA_REVOCACION>>` | log del driver: `DELETE /share/post/{id}` y su respuesta |
| `<<RESULTADO_TITULAR>>` / `<<RESULTADO_REACCESO>>` | re-accesos ×3 (cookies/anónimo/cache-buster) vs **baseline 404 server-side** ya documentada (`v8-baseline-lectura-B.json`) |
| `<<METODOS_REACCESO>>` / `<<CICLO_2>>` / `<<N/5>>` | log del driver (2 ciclos completos) |
| `<<CAUSA>>` | 200-live vs cache-TTL, según patrón de los re-accesos |
| `<<P3|P4>>` + `<<JUSTIFICACION>>` | regla: permanente → P3 · solo cache con TTL → P4 |
| `<<FECHA>>` | fecha real de ejecución |

**Regla de coherencia E18:** si los re-accesos devuelven **404 contra la
baseline** (comportamiento correcto) → **NO REPORTABLE** — cerrar el vector
como tested-and-negative con la evidencia de los 2 ciclos. Solo se redacta
el submit si hay acceso residual real.

---

## Orden de ejecución cuando el flag caiga (cola ya definida)

1. **E16** (driver N=5) → rellenar sus marcadores → submit (runbook de 40 min ya creado)
2. **60 s de pausa** → **E17** (V-ssrf-1 ×3 + V-ssrf-3 ×4; V-ssrf-2 solo si hay señales) → rellenar o descartar
3. **60 s de pausa** → **E18** (2 ciclos completos) → rellenar o descartar
4. Cada vector: su propio panel check el mismo día antes de submitir (E17/E18 usan los términos de búsqueda de sus tablas de marcadores)
