# 📝 REPORTE V7 — IDOR biblioteca de archivos (ChatGPT) — CERRADO: NO HALLAZGO

> **ESTADO: CERRADO (no_reportable).** El flujo A/B autenticado se ejecutó completo
> (2026-09-06, noche) con dos cuentas reales y grants OAuth vivos, y **A recibió 404
> sobre el archivo de B en todos los puntos, con 2 reproducciones idénticas**.
> El aislamiento por tenant está correctamente aplicado. **Este borrador NO se envía.**
> Programa: OpenAI (Bugcrowd) · Scope: `chatgpt.com` · OPPLAN aprobado 2026-09-06T02:49Z.

---

## Título (formato guía §2)

**IDOR en `POST /backend-api/files/library/files` — una cuenta autenticada puede operar sobre los archivos de la biblioteca de otra cuenta mediante `file_id`/`directory_id` conocidos sin verificación de propiedad**

> Nota de borrador: el título refleja el hallazgo *si* la ejecución A/B confirma
> acceso indebido reproducible. Si A recibe 403 en todos los puntos, el vector se
> cierra y este borrador se descarta (no se envía).

## Severidad propuesta (guía §3)

**HIGH — CVSS 3.1: 8.1** (`AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N`)

Justificación:
- Confidencialidad ALTA: la biblioteca de archivos (feature "artifacts", nueva)
  almacena documentos subidos por el usuario (PDF, hojas de cálculo, datos
  personales) → PII → RGPD Art. 5/32 si se confirma.
- PR:L — cualquier cuenta gratuita bastaría.
- Sin interacción de víctima (UI:N).
- Explotación puntual de 1 recurso conocido (sin enumeración) ya demuestra el
  control de acceso roto.

## Descripción (guía §1, 3-5 líneas)

La biblioteca de archivos de ChatGPT (`/backend-api/files/library/*`) resuelve los
recursos por identificador (`file_id`, `directory_id`) que el cliente envía en el
cuerpo de la petición. El backend **no valida que el `parent_directory_id`/`file_id`
pertenezca al usuario de la sesión** en los endpoints de creación, listado y
materialización de Google Drive. Un atacante autenticado que conozca (o reciba) el
identificador de un archivo de otra cuenta podría listar, referenciar o materializar
contenido ajeno. El feature es reciente ("artifacts") y los IDs virtuales
(`external-gdrive:account:*`, `external-gdrive:file:*`) se manejan como strings
opacos por el cliente, sin capa de ownership visible.

## Pasos de reproducción (guía §4)

**Estado limpio:** dos cuentas de test propias (A y B), navegadores/perfiles
separados, sesiones aisladas. Recurso sintético `SYNTHETIC-*`, sin PII ni datos
de terceros. Ritmo ≥2 s entre peticiones.

1. `[REAL]` Confirmar que los endpoints exigen token (baseline sin auth):
   - `GET /backend-api/files/library/directories/path?directory_id=SYNTHETIC-dir`
     → `[REAL]` **401** `{"detail":{"message":"Unauthorized - Access token is missing"}}`
   - `POST /backend-api/files/library/files` (body `SYNTHETIC-test.txt`, `file_id: synthetic-1`)
     → `[REAL]` **401** (mismo mensaje)
   - Evidencia: `evidencia-poc/http/vector7-sondas-noauth.json`
2. `[PENDIENTE]` En la sesión de **B**, crear un archivo sintético:
   `POST /backend-api/files/library/files` con `{"parent_directory_id":"SYNTHETIC-B-dir","file_id":"SYNTHETIC-B-FILE-001","file_name":"SYNTHETIC-B-FILE-001.txt","mime_type":"text/plain"}` → **esperado 200** (baseline legítimo de B).
3. `[PENDIENTE]` Desde la sesión de **A**, repetir la MISMA petición del paso 2
   (con el `file_id`/`parent_directory_id` de B) → **esperado 403**;
   **hallazgo si 200/204**.
4. `[PENDIENTE]` Variante listado: `GET /backend-api/files/library/directories/path?directory_id=SYNTHETIC-B-dir` desde A → **esperado 403/404**; hallazgo si 200 con contenido de B.
5. `[PENDIENTE]` Variante materialización: `POST /backend-api/files/library/google-drive/materialize` con `file_id` virtual de B (`external-gdrive:file:SYNTHETIC-B-*`) → esperado 403.
6. `[PENDIENTE]` **Repetir P3 una segunda vez** (guía §4: 2 reproducciones) y guardar request/response crudo + pantallazo del navegador real de A mostrando contenido de B (datos ajenos tapados si los hubiera).
7. `[PENDIENTE]` Detenerse inmediatamente ante PII real, 429, CAPTCHA o bloqueo.

## Petición HTTP completa (copiable) — guía §4

```http
# [REAL] Baseline sin auth (ya ejecutado, 401 — evidencia de auth correcta en capa API)
POST /backend-api/files/library/files HTTP/1.1
Host: chatgpt.com
User-Agent: knk-suite-researcher/2.0 bug-bounty-knk_linux
Content-Type: application/json

{"parent_directory_id":"SYNTHETIC-dir","file_id":"synthetic-1","file_name":"SYNTHETIC-test.txt","mime_type":"text/plain"}

# [PENDIENTE] Petición cruzada A→B (sustituir {TOKEN_A} por el de la cuenta A de test)
POST /backend-api/files/library/files HTTP/1.1
Host: chatgpt.com
Authorization: Bearer {TOKEN_A}
Content-Type: application/json

{"parent_directory_id":"SYNTHETIC-B-dir","file_id":"SYNTHETIC-B-FILE-001","file_name":"SYNTHETIC-B-FILE-001.txt","mime_type":"text/plain"}

# [PENDIENTE] Variante listado A→B
GET /backend-api/files/library/directories/path?directory_id=SYNTHETIC-B-dir HTTP/1.1
Host: chatgpt.com
Authorization: Bearer {TOKEN_A}
```

## Evidencia (guía §5)

- `[REAL]` `evidencia-poc/http/vector7-sondas-noauth.json` — 401 en ambos endpoints.
- `[REAL]` `evidencia-poc/pantallas/poc-vector7-loggedout-context.png` — contexto logged-out.
- `[PENDIENTE]` Baseline 200 de B (petición + respuesta cruda saneada).
- `[PENDIENTE]` Petición cruzada A→B (cruda) + pantallazo del navegador real de A.
- `[PENDIENTE]` Segunda reproducción (cruda + pantallazo).
- Regla guía §5: tapar toda PII ajena; guardar original sin censura para canal privado.

## Impacto (guía §6)

- Un atacante autenticado con cuenta gratuita podría **leer/operar sobre la
  biblioteca de archivos de otra cuenta** (documentos subidos: contratos, hojas
  de cálculo, datos personales y profesionales).
- **RGPD Art. 5/32**: exposición de PII a escala potencial (si además se confirma
  enumeración por IDs secuenciales/virtuales conocidos, la escala sube a HIGH-CRITICAL).
- El feature es nuevo → impacto en la confianza del producto si se confirma.

## Remediación sugerida (guía §1)

1. **Autorización a nivel de objeto en backend**: resolver `file_id`/`directory_id`
   contra el `account_id`/`conversation_owner` de la sesión antes de crear/listar/materializar
   (scoping en la query, nunca confiar en IDs de entrada del cliente).
2. Usar IDs no predecibles (UUID v4) para `file_id`/`directory_id` y validar los
   `external-gdrive:*` contra el binding real de la cuenta OAuth.
3. Añadir tests de integración A/B (ownership negativo) a la CI del feature.

---

## Veredicto final (2026-09-06, noche) — ejecución A/B autenticada completa

**✅ SIN HALLAZGO — comportamiento correcto (aislamiento por tenant).** El flujo
completo se ejecutó con dos cuentas reales y access tokens vivos:

| Paso | Quién | Qué | Resultado |
|---|---|---|---|
| Compuerta | A+B | `/api/auth/session` → user.id distintos | ✅ A=`user-hDI8xdVTY6zahW36WXAsVD8e` (knklinux@gmail.com) · B=`user-i5BbE1RcOASut3ys0nx5Ory7` (ninja.bughunter99@gmail.com) |
| 1a | B | `GET files/library/directories/path` (raíz) | 200 → `libdir_6cd9c65376188191b554a676565d1416` |
| 1b | B | `POST files/upload_reservations` (`my_files`) | 200 → `file_00000000a3d082469bb5e656c5cf8ab1` + upload_url |
| 1c | B | PUT contenido sintético `SYNTHETIC-*` al upload_url | 201 |
| 1d | B | `POST upload_reservations/{id}/claim_and_finish` | 200 → `file.processing.completed` |
| 1e | B | `GET files/library/nodes` (baseline control) | 200 → su archivo visible: `libfile_8bafe5aeb94c8191a98c41d3408c93b7` (state ready) |
| 2a | **A** | `GET files/library/files/{libfile_de_B}` | **404** `Not Found` |
| 2b | **A** | `GET files/library/files/{libfile_de_B}/content_url` | **404** `File not found` |
| 2c | **A** | `GET files/library/nodes` (¿fuga de B?) | 200 → **solo sus propios archivos**; libfile de B NO aparece |
| 3a | **A** | `GET files/library/files/{libfile_de_B}` (2ª reproducción) | **404** `Not Found` |

Evidencia: `evidencia-poc/http/vector7-AB-resultado.json`,
`evidencia-poc/http/vector7-cruzada-a-b-resultado.txt`,
`evidencia-poc/http/vector7-baseline-b-log.txt`, pantallazo
`evidencia-poc/pantallas/vector7-sesion-b-edge-9336.png` (navegador real, sesión B).

**Conclusión:** el backend resuelve `library_file_id`/`file_id` contra el tenant
de la sesión; A no puede leer ni listar los recursos de B (404 reproducible 2×).
Cerrar vector V7 como no reportable. No se envía nada.

## Checklist pre-submit (guía §11) — estado final

- [x] Bug en scope de la policy (✅ scope verificado)
- [x] No duplicado (búsqueda pública hecha: sin disclosures del feature)
- [x] Replicado 2× desde estado limpio (**✅ ejecutado: 404 reproducible 2×**) —
      **pero el resultado es la AUSENCIA de vulnerabilidad**
- [x] Título tipo + ubicación + impacto (redactado; descartado con el veredicto)
- [x] Pasos copiables sin suposiciones (✅ ejecutados en el driver)
- [x] HTTP crudo adjunto (✅ `vector7-AB-resultado.json` + logs)
- [x] Capturas anotadas (✅ pantallazo navegador real sesión B; datos propios/sintéticos)
- [x] Impacto de negocio (redactado; sin aplicación por veredicto negativo)
- [x] Severidad justificada CVSS (redactada; sin aplicación)
- [x] Sin output de scanner (✅)

> Referencias: checklist operativa `CHECKLIST-BURP-AB-2026-09-06.md` (§V7),
> triaje completo `OPENAI-TRIAGE-HALLAZGOS-2026-09-06.md`,
> superficie `OPENAI-SURFACE-MAP-2026-09-06.md`, anexo scope `OPENAI-OPPLAN-ANEXO-SCOPE-308-2026-09-06.md`.