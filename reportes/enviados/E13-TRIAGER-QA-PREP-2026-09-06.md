# E13 — Triager Q&A prep (paste-ready answers)

> Program: OpenAI (Bugcrowd) · Submission: E13 — SAS `upload_url` not session-bound
> Use: reply in the submission thread, one answer per question, no edits to the original report.
> Rule: answer with evidence that is already attached; offer to re-run only if asked.

---

## Q1 — "Why is this more than intended behavior? The upload URL is short-lived (~5 min)."

**Answer:**
Short expiry limits the window but doesn't change the design flaw: the SAS is a bearer capability with **no binding to the creating session, principal, or IP** (no `sip`/`sipr` claim — see `sas-ip-binding-analisis.txt`). Within its validity it can be replayed by the same account (4× → 201), used by a different authenticated account (→ 201), and used with no credentials at all (→ 201). The URL transits browser history, proxy logs, and extension telemetry because the SPA PUTs directly from the browser. Expiry would be a fine mitigation *on top of* binding; on its own it doesn't prevent the overwrite during the window in which the victim will legitimately claim the reservation.

## Q2 — "How would an attacker realistically obtain the victim's upload_url?"

**Answer:**
Any passive capture point on the PUT request, which originates in the victim's browser: a malicious or logging browser extension, a corporate/cloud proxy, shared machine browser history, screen-share or screenshot tooling, referer/telemetry leaks, or client-side JS. No active attack against OpenAI infrastructure is required — the capability is fully usable by anyone who sees it once. We deliberately did not demonstrate a delivery chain against third parties (out of scope for our testing); the primitive itself is fully reproduced with two self-owned accounts.

## Q3 — "The claim endpoint returns `user_mismatch` for other users — isn't ownership enforced?"

**Answer:**
Ownership is enforced **only at claim time, after the content has already been overwritten**. The write path (PUT to the SAS) accepts anyone during the reservation window; the victim then claims their own reservation and materializes the attacker's bytes. That is exactly the integrity gap: the ownership check happens on the wrong side of the write. Step 3–6 of the report show the full sequence; `user_mismatch` is what makes the cross-account *claim* impossible while leaving the cross-account *write* open.

## Q4 — "Cross-account reads return 404 — why is this LOW and not informational?"

**Answer:**
Confidentiality is intact (verified, step 7: detail + content_url from another account → 404 both). What breaks is **integrity of user content**: attacker-chosen bytes land in the victim's library file, which the victim may then attach to conversations, publish via share links, feed to a custom GPT/connector, or export. Stored-content poisoning of a user's file library is a recognized integrity impact — P4 under VRT (Modify/View Sensitive Information is not applicable; this maps to missing function-level access control on the write path). Severity CVSS 4.3 (`AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N`) reflects integrity-only honestly.

## Q5 — "Did you test from a different IP/egress?"

**Answer:**
Not fully — both test accounts shared one egress, disclosed in the report's Limitations. By construction the SAS carries no `sip`/`sipr` claim (`sas-ip-binding-analisis.txt`), so Azure-level IP binding is absent; we cannot exclude a custom server-side source-IP check. Note the anonymous PUT also succeeded from the same egress. We're happy to re-test from a second egress on request — the result wouldn't change the replay finding (same account, same IP, 4× 201), only the cross-account/anonymous variants.

## Q6 — "Can this be scaled / mass-exploited?"

**Answer:**
Not today. Each `upload_url` is single-reservation and short-lived; we found no endpoint that lists other users' reservations, so exploitation is one poisoned file per leaked URL. We noted this honestly in the Impact section ("would scale to mass poisoning only if a future endpoint ever listed reservations"). The severity already accounts for this.

## Q7 — "Your file_size mismatch note says earlier rounds failed — is the PoC reliable?"

**Answer:**
Yes. The `file_size_mismatch` rejection was a **declared-size** check: the claim body must state the exact blob size (33 bytes for our payload). Once declared correctly, the claim succeeded and the file materialized with the attacker's content — reproduced end-to-end in the final round, with the victim's own `content_url` download returning `SYNTHETIC-A-INJECTED by account A` (`sas-round3-contenido.txt`, screenshot `e13-descarga-B.png`).

## Q8 — "Please provide the exact raw requests."

**Answer:**
Attached: `sas-upload-raw-CLEAN.txt` contains the full request/response flow (reservation POST, four PUT variants → 201, claim flow with `user_mismatch` and success paths). Signed token values are redacted (they belong to our own test accounts and have expired), but the structure needed to reproduce — endpoint, headers, SAS parameter shape, blob sizes — is complete. We can provide an unredacted live capture privately if triage requires it.

---

### Escalation-friendly follow-ups to offer (only if asked)

- Re-run from a second egress (Q5)
- Live unredacted capture via private disclosure (Q8)
- Video capture of the full A→B flow if visual proof helps

### Do NOT volunteer

- Suite/tooling names, driver filenames, pacing scripts
- Internal hostnames (none appear anywhere — keep it that way)
- Details of other vectors (V1–V11) — out of scope for this thread
