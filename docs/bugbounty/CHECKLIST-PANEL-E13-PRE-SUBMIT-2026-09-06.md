# ✅ Checklist de panel Bugcrowd — pre-submit del E13 (SAS upload_url)

> Fecha: 2026-09-06 · Objetivo: revisar **Known Issues**, **duplicados** y **scope
> de `*.oaiusercontent.com`** antes de enviar `OPENAI-REPORTE-E13-EN-FINAL-2026-09-06.md`.
> Regla de la guía §8: buscar en el panel ANTES de escribir/enviar.
> Método: manual (tu login) o asistido (yo leo con CDP tras tu login — `check-panel-bugcrowd.js`).

---

## 0) Antes de empezar (2 min)

- [ ] Navegador de evidencias abierto en `https://bugcrowd.com/engagements/openai` (Edge, perfil `openai-poc`, CDP 9336)
- [ ] **Login como Hacker** (NO Customer Login) + 2FA si aplica
- [ ] Sesión visible: tu avatar/nombre arriba a la derecha
- [ ] Tener a mano el resumen del E13 (título del reporte abajo en §5) para las búsquedas

## 1) Targets — scope de `*.oaiusercontent.com` (decisivo, 5 min)

- [ ] Abrir pestaña **Targets** del programa
- [ ] Localizar la tabla **In scope** y buscar (Ctrl+F): `oaiusercontent`
- [ ] Anotar EXACTAMENTE cómo aparece el host (wildcard `*.oaiusercontent.com`,
      host específico `sdmntpr*.oaiusercontent.com`, o solo `files.oaiusercontent.com`)
- [ ] Buscar también: `chatgpt.com` → confirmar que sigue in-scope (es donde vive la API que emite la SAS)
- [ ] Revisar la tabla **Out of scope** completa: ¿excluye explícitamente storage/CDN
      (`oaiusercontent.com`, `oaistatic.com`, `azureedge.net`, `blob.core.windows.net`)?
- [ ] Si el out-of-scope excluye storage: buscar en la policy la frase sobre
      "vulnerabilities in the API design" vs "infrastructure" — el E13 se argumenta
      desde `chatgpt.com/backend-api/files/upload_reservations` (diseño de la API)
- [ ] **Anotar**: URL de la policy que respalda el argumento de scope elegido (por si hay apelación)

**Decisión scope:**
| Hallazgo en Targets | Resultado |
|---|---|
| `*.oaiusercontent.com` in-scope | ✅ E13 enviable tal cual |
| Storage out, `chatgpt.com` in | ✅ Enviable con párrafo de scope del Anexo B (vulnerabilidad en la emisión de la capability, no en el storage) |
| Ambos fuera (improbable) | ⛔ No enviar; archivar E13 |

## 2) Known Issues — duplicados conocidos del programa (10 min)

- [ ] Abrir la sección **Known Issues** del programa (visible tras login)
- [ ] Buscar por cada término y anotar coincidencias (título + fecha + VRT):
      `upload` → `upload reservation` → `SAS` → `signed URL` → `presigned` →
      `shared access signature` → `capability URL` → `files` → `library` → `content injection`
- [ ] Para cada hit: ¿la mecánica es la misma? (firma SAS sin binding de sesión/PUT
      repetible/último-escritor-gana). Un IDOR de lectura o un XSS con `upload` en el
      título NO es duplicado del E13
- [ ] Comprobar fechas: un known issue **activo** del mismo mecanismo = N/A seguro;
      uno **parcheado** hace >90 días podría re-testearse pero el E13 es diseño actual
- [ ] Revisar también **Announcements** y **Changelog** del brief (1 min): menciones a
      cambios recientes en files/storage
- [ ] **Anotar**: captura de cada known issue relevante (con fecha visible)

## 3) Duplicados — tus submissions y el histórico público (5 min)

- [ ] **Submissions** → filtrar las tuyas en este programa: ¿enviaste algo similar antes? (evitar self-duplicate)
- [ ] **Disclosures** (si el programa los muestra): buscar `upload`/`SAS`/`signed` —
      los disclosos públicos de OpenAI son raros pero existen
- [ ] Cross-check rápido con la búsqueda pública ya hecha (Anexo B del reporte):
      sin divulgaciones del mecanismo — si en el panel aparece algo nuevo, anotarlo
- [ ] **Anotar**: nº de submissions propias abiertas (para no chocar)

## 4) Checklist final pre-submit (guía §11 aplicada al E13)

- [ ] ¿En scope? → resuelto en §1, con URL de policy anotada
- [ ] ¿No duplicado? → resuelto en §2-§3
- [ ] ¿Replicado 2× desde estado limpio? → sí (rounds 1 y 3 del probe, own accounts)
- [ ] ¿Título tipo+ubicación+impacto? → el del reporte EN final
- [ ] ¿HTTP crudo copiable adjunto? → 14 bloques en el reporte
- [ ] ¿Datos sensibles tapados? → solo datos sintéticos SYNTHETIC-*, nada de terceros
- [ ] ¿Impacto de negocio + peor caso realista? → stored-content poisoning, sin exfil
- [ ] ¿Severidad justificada? → LOW, CVSS 4.3, sin hype
- [ ] ¿Limitación honesta incluida? → anexo A (IP-binding no excluido 100%: egress test pendiente)
- [ ] Remediación sugerida → session-bound SAS (scid), single-use
- [ ] **Punto de decisión del egress test**: si el test de red distinta sigue pendiente,
      decidir: enviar ya con la limitación declarada (honesto, LOW) o esperar al test.
      Recomendación: enviar ya — la severidad LOW ya no cambia con el resultado.

## 5) Envío (si todo pasa)

- [ ] Copiar el contenido de `docs/bugbounty/OPENAI-REPORTE-E13-EN-FINAL-2026-09-06.md`
- [ ] Título EXACTO: "Upload SAS URL issued by POST /backend-api/files/upload_reservations is not bound to the creating session — replayable, usable by another account and anonymously, allowing attacker-controlled content to persist in the victim's library file"
- [ ] Severidad: **LOW** (no inflar; el triager la mantendrá o subirá por integridad)
- [ ] Adjuntar: `sas-upload-raw.txt`, `sas-round3-contenido.txt`, captura de la descarga de B
- [ ] Enviar y anotar ID del submission en el triaje (fila E13)

---

## Atajos si uso el método asistido (CDP)

Tras tu login, dime "ya" y ejecuto `node backend/check-panel-bugcrowd.js`, que
extrae automáticamente: targets/scope, known-issues JSON (`engagement_known_issues.json`)
y guardo la evidencia en `evidencia-poc/http/bugcrowd-panel-*.json|txt`.
Tú solo revisarías los matices (§2: ¿la mecánica coincide?) y decidimos juntos.
