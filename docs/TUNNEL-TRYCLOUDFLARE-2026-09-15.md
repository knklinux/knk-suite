# Túnel trycloudflare — ciclo de vida, DNS y rescate

**Fecha:** 2026-09-15 · **Alcance:** canary SSRF expuesto al exterior (OpenAI V6/V7) · **Estado:** vigente

Este documento condensa lo aprendido a base de incidentes (14–15 sep 2026) sobre los
**quick tunnels** de `trycloudflare.com`. Objetivo: que ninguna sesión futura vuelva a
redescubrir esto a base de `curl` fallando.

---

## 1. Las tres reglas de oro

1. **La URL muere con el proceso.** Un quick tunnel no tiene cuenta ni configuración:
   `cloudflared` pide un subdominio aleatorio (`<palabra-palabra-palabra>.trycloudflare.com`)
   que **solo existe mientras ese proceso esté vivo**. Matarlo, que se cuelgue o que
   Windows limpie al cierre de sesión = URL muerta **para siempre** (el edge responde
   `530` a quien la pida). Un relanzamiento genera una URL **nueva y distinta**.
2. **La URL se anuncia antes de estar servida.** cloudflared imprime la URL en su
   stdout en cuanto el edge la registra, pero la conexión c2a (edge→origen) puede
   tardar unos segundos más. Golpearla inmediatamente da error aunque el túnel esté
   naciendo bien → **verificar con reintentos** (~40 s).
3. **El DNS local puede mentir.** El router (Livebox) llega a devolver NXDOMAIN para
   hostnames recién creados **que ya existen en el DNS autoritativo de Cloudflare**, y
   Windows cachea el resultado negativo. Rescate: resolver vía `1.1.1.1` y fijar la IP
   con `curl --resolve`, que esquiva el caché del SO por completo.

---

## 2. Ciclo de vida de un quick tunnel

```
cloudflared tunnel --url http://127.0.0.1:8210 --no-autoupdate
        │
        ├─ ~2-5 s: edge registra el hostname → URL en stdout   ← se puede leer YA
        ├─ ~5-20 s: conexión c2a establecida → 204 en /hit      ← sirve DESDE aquí
        │
        ├─ (proceso vivo: la URL funciona indefinidamente)
        │
        └─ proceso muere (kill, crash, logout, cierre de sesión)
              └─ la URL queda MUERTA: edge → 530, para siempre
```

Implicaciones operativas:

- **Nunca reutilizar una URL tras un relanzamiento**: la convención del repo es
  añadir la URL nueva **como línea pelada al final** de
  `evidencia-poc/http/canario-ssrf-log.txt`. La URL vigente es la ÚLTIMA LÍNEA-URL
  del fichero: `grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" <log> | tail -1`
  (NO `tail -1` pelado: el canario también escribe líneas de golpe /hit con
  timestamp, y el vigilante las genera cada 15 min). Las URL anteriores son
  historial muerto.
- El relanzamiento no es "reanudar": es **nacimiento de un recurso distinto**.
  Cualquier cosa que apuntara a la URL vieja (nonces ya enviados, prompts guardados
  con la URL incrustada) queda huérfano; los nonces de la plantilla V-ssrf-1 siguen
  siendo válidos porque el canario correlaciona por nonce, no por URL.

## 3. Diagnóstico rápido: síntoma → causa → remedio

| Síntoma | Causa | Remedio |
|---|---|---|
| `curl` al túnel → **530** | El edge no alcanza el origen: proceso muerto o aún conectando | Si estaba vivo hace poco, reintentar ~40 s; si no, `ensure_tunnel` (relanzamiento) |
| `curl` → **000 / exit 6 (ENOTFOUND)** con `nslookup` OK | Caché DNS negativa de Windows (el NXDOMAIN del primer minuto quedó clavado) | Fallback: `nslookup <host> 1.1.1.1` + `curl --resolve <host>:443:<IP>` |
| `curl` → **exit 35** y NO solo al túnel: también GitHub, Google, etc. | `CRYPT_E_REVOCATION_OFFLINE`: el schannel de Windows no alcanza los servidores CRL/OCSP (degradación de red del Livebox vista el 15-sep) | `--ssl-no-revoke` (solo existe en builds schannel; Node/OpenSSL no comprueba revocación y sigue funcionando) |
| `node` fetch al túnel falla y `curl` tampoco, pero `nslookup 1.1.1.1` resuelve | Mismo caché negativo (node también lo sufre) | El fix es del lado del cliente que resuelve: usar `--resolve` (curl) o esperar a que expire el caché (~minutos) |

Comandos de diagnóstico (una línea cada uno):

```sh
# ¿El proceso vive? (solo NUESTRAS instancias: CommandLine apunta a :8210)
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | Where-Object { $_.CommandLine -match '8210' } | Select ProcessId, CommandLine"

# ¿Qué dice el DNS autoritativo? (bypass del router y del caché del SO)
TUNEL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" evidencia-poc/http/canario-ssrf-log.txt | tail -1) && nslookup "$(printf '%s' "$TUNEL" | sed -E 's#https://([^/]+)/.*#\1#')" 1.1.1.1

# Golpe de verificación E2E (204 = canario alcanzado desde Internet)
TUNEL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" evidencia-poc/http/canario-ssrf-log.txt | tail -1) && curl -s -m 8 --ssl-no-revoke "$TUNEL/hit?nonce=MANUAL" -o /dev/null -w "%{http_code}\n"
```

## 4. El rescate DNS en detalle (1.1.1.1 + --resolve)

Secuencia real del 15-sep:

1. `ensure_tunnel` relanza cloudflared → URL nueva registrada.
2. `curl` a la URL nueva: `exit 6` (ENOTFOUND) pese a que el edge ya la servía.
3. `nslookup <host>` con el DNS del router: NXDOMAIN. `nslookup <host> 1.1.1.1`:
   **IP correcta** — el registro existía; el fallo era del resolver local + caché.
4. `curl --resolve <host>:443:<IP-de-1.1.1.1> https://<host>/hit?...` → **204**.

`--resolve` funciona porque curl ni pregunta al sistema: fija la IP a nivel de
librería. Por eso es inmune tanto al caché negativo como al router. Es el mecanismo
que `tunnel_hit()` aplica automáticamente como segundo intento.

## 5. Mecánica de rescate ya automatizada (no reinventar)

Las funciones viven en **`backend/preflight-lib.sh`** y las comparten:

| Consumidor | Cuándo corre |
|---|---|
| `backend/v7-sep12.sh` (pre-flight) | Al lanzar la cola V7 |
| `backend/watchdog-infra.sh` (vigilante) | Cada 15 min, en background (`.watchdog-knk.cmd` oculto de PowerShell) |

`ensure_canary`: sondeo `:8210/hit` → si muerto, relanza `node backend/canario-ssrf.js`
con el patrón `( cmd & )` (node queda huérfano y **sobrevive** al cierre del script).

`ensure_tunnel`: verifica la URL vigente (última línea-URL del log del canario) con
`tunnel_hit()` (que ya incorpora el fallback 1.1.1.1 + `--resolve` y `--ssl-no-revoke`);
si no responde: mata **solo** las instancias cloudflared cuyo `CommandLine` apunta a
`:8210` (jamás un cloudflared ajeno), relanza, espera la URL nueva en stdout (hasta 45 s),
la registra en el log del canario y **verifica E2E con reintentos** (hasta 40 s) por la
carrera anuncio/conexión de la regla 2.

Historial de intervenciones del vigilante:
`evidencia-poc/http/watchdog-infra/watchdog-infra.log` (los nonces de sus golpes
llevan prefijo `WATCHDOG-INFRA-`, los de V7 `V7-SEP12-`, los manuales el que pongas).

## 6. Incidentes que motivan este documento

| Fecha | Qué pasó | Lección |
|---|---|---|
| 14-sep | El pre-flight V6 relanzó el túnel; `curl` daba 0000 pese a tunnel vivo | Primera identificación del caché DNS negativo → nace el fallback 1.1.1.1 |
| 15-sep (tarde) | TODO curl https empezó a fallar en la máquina (exit 35), incluido GitHub | `CRYPT_E_REVOCATION_OFFLINE` del Livebox; `--ssl-no-revoke` en `tunnel_hit` |
| 15-sep (noche) | Watchdog doble resurrección: canary muerto → 204 en 1 s; cloudflared muerto → URL nueva verificada al 1er intento | Las `ensure_*` con la lib compartida funcionan sin intervención humana |

## 7. Qué NO hacer

- **No** registres la URL nueva en otro sitio que no sea el log del canario (rompe la
  convención grep -oE | tail -1).
- **No** mates cloudflared sin filtrar por `CommandLine -match '8210'`.
- **No** des por muerto un túnel por un 0000 inmediato tras el relanzamiento: aplica
  el fallback y reintenta antes de concluir.
- **No** pegues la URL del túnel en prompts de OpenAI como dato permanente: muere con
  el proceso; los prompts de la plantilla V-ssrf-1 se regeneran con la URL vigente
  extrayendo la última línea-URL del log del canario (grep -oE | tail -1).
