# Estado de la operación OpenAI V6 — 2026-09-15

**Alcance:** chatgpt.com (programa Bugcrowd) · OPPLAN aprobado · Sesiones A/B
**Veredicto en una línea:** infraestructura **100 % operativa y auto-reparable**;
compuerta de salud **OK**; flag anti-abuso E16 **ACTIVO desde ~2026-09-05/06**
(≥9 días) → la cola de vectores que tocan `/conversation` sigue auto-salteándose
(exit 4). Nada se lanza por política — y con un flag que no decae en 9 días,
el siguiente movimiento es revisar estrategia, no esperar otra ventana.

---

## 1) TL;DR

| Componente | Estado | Evidencia |
|---|---|---|
| Canary SSRF local (`:8210`) | ✅ vivo (PID 14292) | `evidencia-poc/http/canario-ssrf-log.txt` |
| Túnel cloudflared (quick) | ✅ E2E 204 | URL vigente: `https://pearl-destinations-athens-aside.trycloudflare.com` |
| Auto-reparación de infra | ✅ nueva (commit `82414ee`) | 2 cold-starts verificados: kill de ambos → recuperación automática |
| Sesiones A/B | ✅ sanas (20:44 UTC 14-sep) | `salud-sesiones-informe.txt`: user.id distintos, Bearer vivo en ambos |
| Compuerta anti-abuso (`/conversation`) | 🚩 **FLAG ACTIVO** — 403 | `secuencia-post-enfriamiento.log` del 14-sep 20:44 |
| Cola V6 (E16→E17→E18, H1-H3) | ⛸️ auto-salteada (exit 4) | Política E16 inviolable |
| BiDi Firefox (`:9344`) | ⚠️ opcional, no crítico | Solo drivers que lo necesitan |

---

## 2) Infraestructura

### Canary SSRF (`backend/canario-ssrf.js`)

Receptor HTTP en `127.0.0.1:8210` que registra cada golpe con timestamp, UA y
nonce en `evidencia-poc/http/canario-ssrf-log.txt` (y `.json`). Un golpe en el
canary con un nonce del test = fetch server-side confirmado desde el objetivo.
Todos los golpes registrados a fecha de hoy son **controles nuestros** (curl
directo o vía túnel); **cero golpes externos** — coherente con el cierre de
V-ssrf-3 (ver §4).

### Túnel cloudflared (quick tunnel)

Expone el canary a internet con una URL pública efímera. Ciclo de vida
documentado (aprendido a la mala el 14-sep):

1. **La URL muere con el proceso.** Cada relanzamiento = URL nueva; las viejas
   devuelven 530 (túnel muerto) o 0000 (DNS muerto).
2. **La URL se anuncia antes de conectar.** El hostname aparece en el log de
   cloudflared ~7 s tras el arranque, pero el edge puede tardar unos segundos
   más en aceptar tráfico → el verificador reintenta ~40 s.
3. **El DNS local va por detrás del autoritativo.** El router (Livebox) llegó
   a devolver NXDOMAIN para un hostname que 1.1.1.1 ya resolvía. El helper
   `tunnel_hit` de `v6-sep10.sh` hace fallback: resuelve vía 1.1.1.1 y fija la
   IP con `curl --resolve`.

URLs generadas el 14-sep (registro histórico en el log del canary):
`personal-richard-salad-scheme` → `tribune-saints-stored-seen` →
`having-shanghai-rings-reducing` → `mortgage-gba-theorem-posted` →
`pearl-destinations-athens-aside` (**vigente**, verificada 204).

### Auto-reparación (nuevo, commit `82414ee` — 14-sep)

`bash backend/v6-sep10.sh` ya no aborta si la infra está muerta: el pre-flight
**garantiza** canary y túnel antes de la cola.

- `ensure_canary`: relanza el node desacoplado (`(cmd &)`), espera 204 (≤10 s).
- `ensure_tunnel`: mata SOLO las instancias cloudflared cuyo comando apunta a
  `:8210` (jamás un cloudflared ajeno), relanza, espera la URL nueva (≤45 s),
  la registra en el log del canary y verifica E2E con reintentos.
- Verificado con dos cold-starts reales: `taskkill /F` a ambos procesos →
  pre-flight los restaura; 204 en el intento 1 en ambas ejecuciones.
- BiDi sigue siendo solo aviso: es una GUI interactiva y no se auto-arranca.

---

## 3) Compuerta anti-abuso (estado del flag)

Última sonda completa: **2026-09-14 20:44 UTC** (`secuencia-post-enfriamiento.sh`).

```
[1] A: /api/auth/session 200 con user.id y accessToken → OK
[2] B: /api/auth/session 200 con user.id y accessToken → OK
[3] Compuerta A≠B (user.id distintos) → OK
[4] Bearer vivo en /backend-api/me (A y B) → OK A=200 B=200
[5] Sonda /conversation (A, 1 petición sin reintentos) → FLAG ACTIVO 403
    {"detail":"Unusual activity has been detected from your device.
     Try again later. (6a23151d-70c3-4cfc-9e41-8dddf6f9d04e)"}
Veredicto: SESIONES SANAS · FLAG ANTI-ABUSO ACTIVO (exit 4)
```

**Lectura clave:** las cuentas están perfectamente sanas (login, sesión,
Bearer, dos user.id distintos). El 403 es el flag de anti-abuso del *device*,
no un problema de credenciales. Por eso la compuerta distingue: salud OK
permite vectores que NO tocan `/conversation`; el flag activo obliga a
auto-saltear los que sí lo tocan.

### Historial del flag

| Fecha | Evento | Resultado |
|---|---|---|
| ~2026-09-05/06 | Primer 403 anti-abuso detectado | Flag activo |
| 2026-09-06 15:48 | V8 revocación, ciclo 1 | 403 en `a_convA` → BLOQUEADO (`v8-revocacion-resultado.json`) |
| 2026-09-06 15:56 | Safety BB escenario 1 | 403 en intento 1 → abortado (`safetybb-esc1-resultado.json`) |
| 2026-09-06 16:31 | V-ssrf-1 (retest SSRF/302) | 403 en 1ª petición; backoff 15/30/60 s agotado (`ssrf-retest-resultado.json`) |
| 2026-09-06 16:37 | V-ssrf-3 (superficie URL libre) | Sin endpoint activo que acepte URL → cerrado sin fetch |
| 2026-09-07 (V2) | Sonda tras +24 h | 403 — flag no decae |
| 2026-09-09 (V3) | Sonda tras +48 h | 403 — flag no decae |
| 2026-09-14 20:44 | V6, sonda tras ~8 días | **403 — el flag sigue activo** |
| 2026-09-14 22:12 | Pre-flight V6 con auto-reparación | Infra restaurada y verificada; la cola no se lanzó (no procedía) |

**Duración acumulada: ≥9 días** — muy por encima de las ventanas de 24-72 h
que contemplaba `PLAN-ENFRIAMIENTO-48-72H-A-2026-09-07.md`. El supuesto de
que el flag decae con enfriamiento pasivo está **refutado empíricamente**.

---

## 4) Qué puede y qué no puede ejecutarse hoy

| Vector | Estado | Motivo |
|---|---|---|
| V-ssrf-1 (search/deep_research → 302 → canary) | ⛸️ bloqueado | Toca `/conversation` (flag E16) |
| V-ssrf-3 (endpoints con `url=` libre) | ✅ cerrado (sin superficie) | Ningún endpoint activo acepta URL libre — evidencia del 6-sep; el canary quedó operativo y **reutilizable** cuando aparezca superficie |
| H1-H3 (variantes con headers custom) | ⛸️ bloqueados | Dependen de la misma superficie cerrada |
| E16/E17/E18 (cola principal) | ⛸️ auto-salteados | Política: flag activo → exit 4 |
| V8 (revocación de sesión) | ⛸️ bloqueado | Primer paso toca `/conversation` |
| Escaneos que NO tocan `/conversation` | ✅ permitidos por compuerta | Con salud A/B OK y sin sonda extra |

---

## 5) Decisión pendiente — recomendación

El plan de enfriamiento (§3) ya anticipaba este escenario: *"el flag que no
decae en 48 h sugiere que algo en la forma de las peticiones mantiene el
patrón detectado"*. A las **≥9 días**, esperar más ventanas pasivas ya no es
estrategia, es procrastinación con gasto de sondas. Opciones ordenadas por
coste:

1. **Revisar la forma de la petición** (sin gastar peticiones): fingerprint
   del driver (headers, orden, TLS/JA3 del cliente HTTP) puede ser el
   detonante del patrón — comparar con tráfico de navegador real.
2. **Cambiar el plano de red**: flag ligado al *device* — otra IP de salida
   (móvil/VPN residual) y/o navegador real en lugar de cliente HTTP puede
   resetear la huella. Cuidado: los cambios de identidad tienen su propia
   política en el programa; revisar antes.
3. **Pivotar de programa** mientras tanto: el canary/túnel son genéricos y
   reutilizables (ya se usaron en Zendesk); la operación OpenAI queda en
   pausa *controlada* — sesiones sanas, evidencia conservada, relanzamiento
   de una sola línea.

Lo que **no** se hace por política: forzar la cola con el flag activo, rotar
agresivamente sesiones, o automatizar evasión del flag. La compuerta existe
precisamente para que la operación sea sostenible y defendible.

---

## 6) Cómo relanzar (una línea)

```bash
bash backend/v6-sep10.sh
```

El pre-flight repara lo que esté muerto (canary, túnel), valida la compuerta
de salud A/B, lanza la sonda anti-abuso y **solo** si sale limpia ejecuta la
cola E16→E17→E18→H1-H3. Evidencia nueva en `evidencia-poc/http/v6-sep10/`.

---

## 7) Índice de evidencia

| Fichero | Contenido |
|---|---|
| `evidencia-poc/http/v6-sep10/v6-sep10.log` | Log del lanzador V6 (última ejecución 14-sep) |
| `evidencia-poc/http/v6-sep10/secuencia-post-enfriamiento.log` | Compuerta A/B + sonda anti-abuso (403 del 14-sep 20:44) |
| `evidencia-poc/http/salud-sesiones-informe.txt` | Informe de salud de sesiones (mismo run) |
| `evidencia-poc/http/canario-ssrf-log.txt` / `.json` | Registro del canary (golpes de control + URLs de túnel) |
| `evidencia-poc/http/v6-sep10/ssrf-retest-resultado.json` | V-ssrf-1 bloqueado + V-ssrf-3 cerrado (6-sep) |
| `evidencia-poc/http/v6-sep10/v8-revocacion-resultado.json` | V8 bloqueado (6-sep) |
| `evidencia-poc/http/v6-sep10/safetybb-esc1-resultado.json` | Safety BB esc-1 bloqueado (6-sep) |
| `evidencia-poc/http/v6-sep10/cloudflared-relaunch-stdout.log` | Boot del túnel (prechecks PASS, QUIC, registro en mad06) |
| `docs/bugbounty/RETEST-SSRF-302-PROTOCOLO-2026-09-06.md` | Protocolo V1-V6 |
| `docs/bugbounty/PLAN-ENFRIAMIENTO-48-72H-A-2026-09-07.md` | Plan de ventanas y su §3 (revisión de estrategia) |
| `docs/bugbounty/PROTOCOLO-EJECUCION-V1-V6-2026-09-06.md` | Cadena de ejecución y paradas automáticas |

*Documento generado el 2026-09-15 a partir de la evidencia en disco; sin
secretos (tokens/sesiones viven en el almacén local, no en el repo).*
