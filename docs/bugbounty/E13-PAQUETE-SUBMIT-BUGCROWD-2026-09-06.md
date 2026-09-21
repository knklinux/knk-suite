# 📦 E13 — Paquete de envío a Bugcrowd (copy-paste listo)

> ✅ **ESTADO CORREGIDO (2026-09-06 noche): ENVÍO FRESCO EN CURSO.** El registro
> anterior ("ENVIADO Y TRIAJEADO P5") era **un error de registro**: nunca hubo
> submission (el panel no muestra ninguno) y el texto P5 "Weak Login Function…
> informational" era el **aviso automático del formulario al seleccionar ese VRT**,
> no un veredicto de triage. No hay nada que apelar.
> **Envío correcto ahora: VRT `Broken Access Control → Missing Function Level
> Access Control`, P4 (LOW)** — el paquete de abajo es exactamente lo que se
> envía. Anotar el ID real del submission en la fila E13 del triaje al confirmar.

> Fecha: 2026-09-06 · Condición previa (ya cumplida): check de panel limpio (scope + known-issues,
> checklist `CHECKLIST-PANEL-E13-PRE-SUBMIT-2026-09-06.md`). Si hay duplicado de
> la misma mecánica, NO enviar.

---

## 1) Campos del formulario (copiar cada uno en su campo)

| Campo del formulario | Valor |
|---|---|
| **Title** | Upload SAS URL issued by POST /backend-api/files/upload_reservations is not bound to the creating session — replayable, cross-account and anonymous writes allow attacker-controlled content in the victim's library file |
| **Target / Asset** | `chatgpt.com` (endpoint emisor: `POST /backend-api/files/upload_reservations`; ejecución en `*.oaiusercontent.com`) |
| **VRT (categoría)** | `Broken Access Control → Missing Function Level Access Control` (o `Improper Access Control` según desplegable; el triager remapea) |
| **Severity** | P4 (LOW) — no inflar |
| **CVSS 3.1** (si el formulario lo pide) | `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N` → 4.3 |
| **Reward / Bounty requested** | dejar en blanco (según programa) |

> Si el formulario exige un título más corto: "Signed upload URL (SAS) from POST /backend-api/files/upload_reservations is not session-bound — replayable, cross-account and anonymous overwrite of pending uploads"

## 2) Body (pegar íntegro — markdown aceptado)

```markdown
## Summary

The signed upload URL returned by `POST /backend-api/files/upload_reservations` (Azure user-delegation SAS, `sp=w`, ~5 min expiry) is a **pure bearer capability not bound to the creating session**. Empirically it accepts:

- **Replay** — 4 consecutive PUTs from the same account → 201 each.
- **Cross-account write** — a PUT from a *different* authenticated account → 201.
- **Anonymous write** — a PUT with **no cookies at all** → 201.

Since the last writer wins, anyone holding a victim's `upload_url` (browser history, proxy logs, extension telemetry — the SPA PUTs directly from the browser) can **overwrite the victim's pending upload**. The victim's own claim flow then materializes the attacker's bytes in *their* library file — verified end-to-end in a decisive run: B claimed her reservation and her own `content_url` download returned `SYNTHETIC-A-INJECTED by account A` (browser screenshot attached). In an earlier probe round the claim's server-side processing rejected a size-mismatched blob (`file_size_mismatch`) — noted for completeness; the decisive run used the exact blob size.

Integrity-only: no confidentiality impact (cross-account reads → 404) and no ownership transfer (claim is owner-gated via `user_mismatch`).

## Environment

- Two self-owned test accounts (A = attacker, B = victim), Bearer tokens from `GET /api/auth/session`.
- All payloads synthetic (`SYNTHETIC-*`), ≥2.2 s pacing, no enumeration, test resource deleted after verification.

## Steps to reproduce

**Setup (clean state):** two fresh self-owned accounts; obtain each Bearer via `GET /api/auth/session` with the account's session cookies. All ids below are from our test run — yours will differ.

1. **B** creates a reservation:
   `POST /backend-api/files/upload_reservations` (Bearer TOKEN_B), body:
   `{"intended_use_case":"my_files","entry_surface":"context_connector_upload","requires_gizmo_id":false,"store_in_library":true,"library_persistence_mode":"required"}`
   → 200 with `reservation_id: file_…` and `upload_url: https://sdmntp…oaiusercontent.com/files/…/raw?se=…&sp=w&sv=2026-02-06&sr=b&scid=…&sig=…`
2. **B** uploads legitimate content: `PUT <upload_url>` (headers `Content-Type: text/plain`, `x-ms-blob-type: BlockBlob`), body `SYNTHETIC-B-FIRST legitimate content` → **201**
3. **A (different account, different session)** PUTs to the **same URL**: body `SYNTHETIC-A-INJECTED by account A` (34 bytes: 33 chars + trailing newline — single consistent value used in every step and in the evidence file) → **201**
   *(Also succeeds with **no cookies at all** → 201, and B re-PUT → 201.)*
4. **B** claims her own reservation declaring the **exact blob size (34 bytes — `wc -c` on the payload file)**:
   `POST /backend-api/files/upload_reservations/{reservation_id}/claim_and_finish`
   body: `{"file_name":"SYNTHETIC-B-CLAIMED-R3.txt","file_size":33,"use_case":"my_files","index_for_retrieval":false,"store_in_library":true,"library_persistence_mode":"required"}`
   → 200 `{"file_id":"file_…","event":"file.processing.started",…}`
   *(If the declared size does not match the blob, processing fails server-side with `file_size_mismatch` and the file never materializes — the size must be exact.)*
5. File reaches `state:"ready"` in **B's** library (`GET /backend-api/files/file_…` → `owner_id` = B).
6. **Ground truth**: B downloads her own file via `GET /backend-api/files/library/files/{libfile}/content_url` → `content_url` → GET → **200 "SYNTHETIC-A-INJECTED by account A"**
7. **Control**: from A, detail + content_url of B's file → **404** both (no cross-account read, no ownership transfer).

**PoC at a glance (15-second table):**

| Step | Identity | Action | Result |
| ---- | -------- | ------ | ------ |
| 1 | B | Create reservation | `200` + SAS |
| 2 | B | PUT legitimate | `201` |
| 3 | A | PUT same SAS | `201` |
| 4 | Anonymous | PUT same SAS | `201` |
| 5 | B | Claim (exact size) | `200` |
| 6 | B | Download own file | **A's bytes** |

## Impact

**Proven (demonstrated end-to-end between two self-owned accounts):** anyone possessing the victim's `upload_url` (valid ~5 min) can replace the pending blob — including cross-account and unauthenticated — and the victim's own claim flow then materializes the attacker's bytes in the victim's library file, where it can be attached to messages, shared publicly, used by a custom GPT/agent, or exported. Stored-content poisoning / data-integrity violation. Race rounds 2026-09-21 (both orders) confirm last-writer-wins: whoever PUTs last before the claim decides the bytes.

**Explicitly NOT claimed:** this report does not demonstrate a remote path for an attacker to obtain an arbitrary victim's `upload_url` through the tested API (no reservation enumeration, no ID prediction, no cross-account read observed). The severity below assumes URL possession as precondition.

Possible exposure channels (secondary, not the basis of impact): the SPA PUTs directly to `*.oaiusercontent.com`, so a leaked URL could additionally transit HTTP proxies, browser history, server/extension logs or screenshot tooling. The core defect stands without them: **the server mints a write capability that is not cryptographically or logically bound to the requesting context, and storage honors it with no authentication or identity check.**

Scale note (honest): today exploitation is one file per leaked URL; it would scale to mass poisoning only if a future endpoint ever listed reservations — nothing observed today.

No confidentiality impact and no ownership transfer (verified) — hence LOW, integrity-only.

## Severity justification

- CVSS 3.1: `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N` = **4.3 (LOW)** — integrity only; no read of victim data; no privilege/ownership change.
- Requires possession of the short-lived capability URL (attacker account = PR:L).
- Note on PR: the storage endpoint itself even accepts unauthenticated PUTs (PR:N technically), but the realistic attack requires *possessing the victim's capability URL*; we keep PR:L as a conservative bound rather than argue the higher score.

## Remediation

1. **Bind the SAS to the session/principal** — enforce the existing `scid` client-id claim at write time (today the only owner check is at claim time, server-side `user_mismatch`).
2. **Single-use SAS** — invalidate the `upload_url` after the first successful PUT so a leaked URL cannot overwrite.
3. Keep the short expiry (already ~5 min).

## Limitations (disclosed)

- **IP binding not fully excluded:** both accounts used the same network egress (90.173.225.104); the anonymous same-IP PUT returned 201. The SAS contains **no `sip`/`sipr` claims** (Azure's native IP-binding), so it is not IP-bound by construction; a custom server-side source-IP check cannot be ruled out without a different-egress test (planned). Severity unchanged either way (integrity-only).
- **Duplicate check:** no public duplicate found (Bugcrowd policy, 2026 disclosures, public writeups, CVE/GHSA). Known Issues check performed at submission time — result noted in the submission comments.

## Attachments referenced

- `sas-upload-raw.txt` — raw request/response of the probe rounds (replay ×2, cross-account PUT, anonymous PUT → 201).
- `sas-round3-contenido.txt` — blob body downloaded from B's own `content_url` = `SYNTHETIC-A-INJECTED by account A` (decisive; 34 bytes incl. trailing newline).
- `sas-ip-binding-analisis.txt` — SAS parameter analysis (no `sip`/`sipr`, `scid` present-but-unenforced, 5-min window).
- `e13-descarga-B.png` — browser screenshot of **B's own** content download showing `SYNTHETIC-A-INJECTED by account A` in the page.

## Compliance

Tests were performed exclusively against my own two test accounts with synthetic content, paced ≥2.2 s, no enumeration, no third-party data touched; the PoC file was deleted after verification (DELETE → 200).
```

## 3) Adjuntos (subir estos ficheros, en este orden)

1. `evidencia-poc/http/sas-upload-raw.txt` — HTTP crudo de la ronda de sondeo (replay ×2, PUT cross-account, PUT anónimo → 201) ✅ (4,2 KB)
2. `evidencia-poc/http/sas-round3-contenido.txt` — cuerpo descargado (decisivo): `SYNTHETIC-A-INJECTED by account A` ✅ verificado (34 bytes con salto final)
3. `evidencia-poc/http/sas-ip-binding-analisis.txt` — análisis del SAS ✅
4. `pantallas/e13-descarga-B.png` — **captura real del navegador** (perfil evidencias, sesión de B inyectada por CDP) mostrando en la página el contenido descargado: `SYNTHETIC-A-INJECTED by account A` ✅ (8,9 KB)
   - Estado completo de la ronda decisiva: `evidencia-poc/http/e13-screenshot-state.json` (content_url, libfile, body). El libfile de evidencia ya está borrado (limpieza)

> **Coherencia evidencia-body:** el `sas-upload-raw.txt` documenta la ronda de
> sondeo (replay/cross-account/anónimo + lectura cruzada 404 + limpieza). La
> ronda **decisiva** (la que materializó el contenido de A en el archivo de B)
> está documentada por el trío `sas-round3-log.txt` (pasos 1-6) +
> `e13-screenshot-state.json` (file_id/content_url/body 200) + la captura
> `e13-descarga-B.png`. Ambas rondas son consistentes: mismos PUTs 201
> cross-account; en la decisiva el claim usó el tamaño exacto y el archivo
> materializó el contenido del atacante.

## 2b) Apéndice del envío fresco — checklist en el formulario

- [ ] **VRT: NO elegir nada bajo `Broken Authentication and Session Management > Weak Login Function`** — ese nodo dispara el aviso automático "informational / not eligible for reward" que ya confundimos una vez con un veredicto
- [ ] VRT correcto: `Broken Access Control → Missing Function Level Access Control`
- [ ] Scope-note como PRIMER comentario (el de la sección 4)
- [ ] Los 4 adjuntos subidos en el orden de la sección 3
- [ ] Ni rastro del hostname interno en ningún campo
- [ ] **Al confirmar el envío: copiar el ID del submission** — va en la fila E13 del triaje

## ⚠️ NO pegar el detalle del hostname interno
El reporte EN final (`OPENAI-REPORTE-E13-EN-FINAL`) menciona como "secondary observation" la fuga de `sediment-service…svc.cluster.local` en el error del claim. **Eso NO va en el submit**: la policy del programa excluye explícitamente *"reports of server error messages without proof of an exploit"* — incluirlo invita a un N/A. Si el triager pregunta por el comportamiento del claim en cross-account, se comenta en el hilo, no en el body.

## 4) Checklist ANTES de pulsar Submit (desde la checklist del panel)

- [ ] **Scope confirmado en Targets** (según tabla de decisión; si storage out + chatgpt.com in → añadir como primer comentario: "Scope note: the vulnerable design lives in the chatgpt.com backend API that issues the unbound capability; `*.oaiusercontent.com` is only where the capability executes.")
- [ ] **Known Issues sin duplicado de la mecánica** (SAS sin binding / PUT repetible / last-writer-wins)
- [ ] Submissions propias: nada igual enviado antes
- [ ] Título, VRT P4 y adjuntos = los de este paquete
- [ ] **Anotar el ID del submission** en el triaje (fila E13) y en `OPENAI-ESTADO-SESION-2026-09-06.md`

## 5) Después de enviar

- Follow-up educado si no hay triage en 5-7 días (guía §10)
- Si piden el test de egress distinto: ya está preparado el protocolo (Anexo A del reporte EN)
- Si lo marcan duplicado: cerrar sin discutir y registrar la referencia en el libro de bugs
