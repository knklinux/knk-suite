# Guía de bug bounty con KNK Suite — metodología y fuzzing manual (2026-09-15)

> Para quién: tú, dentro de 6 meses, o cualquier investigador que arranque KNK.
> Filosofía de la suite: **tú decides cada petición; KNK la ejecuta de forma
> conservadora, registrada y con evidencia**. Nada automático agresivo.

---

## 0) La regla de oro (léela cada vez que sientas frustración)

Si un bounty te bloquea (403/429, anti-bot, flag de "unusual activity"), la
respuesta **nunca** es más peticiones más rápido. Es: (1) entender qué ve el
edge, (2) reducir el ritmo, (3) hacer el trabajo a mano con el Repeater, y
(4) si nada, cambiar de superficie. La suite está construida para que sea
imposible convertirla en un escáner agresivo — eso es una feature.

---

## 1) El flujo completo en KNK

```
Targets → OPPLAN → [Pipeline: recon → scan → FUZZ] → Repeater → Hallazgos → Reportes
   │         │              │                            │            │          │
 scope    autorización   fases automáticas          trabajo fino   evidencia  export
```

1. **Targets**: define scope y out-of-scope (pégalo del programa: Bugcrowd/
   HackerOne lo dan en texto). Sin scope no hay peticiones — por diseño.
2. **OPPLAN**: escribe la autorización y apruébala. Sin OPPLAN aprobado, fuzz
   y explotación están bloqueados (fail-closed).
3. **Pipeline**: recon y scan automáticos conservadores. El **fuzz es la fase
   que se pausa** — ver §2 por qué y §3 cómo trabajar con eso.
4. **Repeater**: el trabajo manual real — peticiones crudas, comparación,
   iteración. Es donde se encuentran la mayoría de bugs de negocio.
5. **Hallazgos**: todo lo que encuentres entra con evidencia (el Repeater
   tiene botón "Crear hallazgo"; el resto va desde cada módulo).
6. **Reportes**: exportación con checklist de triage.

---

## 2) Por qué el fuzz "detiene el pipeline" (y qué se arregló)

El fuzzer de KNK es **deliberadamente conservador**: máximo 15 rutas, 1
conexión, ritmo del limiter global. Y se **pausa** a la mínima:

| Antes (comportamiento que frustraba) | Ahora |
|---|---|
| 2 respuestas 403 seguidas → fuzz parado (`repeated-forbidden`) | **3** 403 seguidos → pausa clara (`paused-403-storm`) con diagnóstico; UA de navegador aplicado automáticamente (los edges 403ean sondas sin pinta de navegador) |
| Rate-limit/503 → parado y al relanzar el pipeline **empezaba de cero** | **Checkpoint reanudable**: lo sondeado queda en `evidencia-poc/fuzz/` y al relanzar salta lo ya probado (`skippedAlreadyProbed`) |
| Sin información de por qué paró | `diagnostics` en cada resultado + `stoppedReason` preciso |

**Cómo usarlo bien**: deja que el fuzz automático haga su pase conservador
(15 rutas). Lo interesante casi nunca está ahí — está en lo que TÚ decidas
probar. Para eso está el Repeater.

---

## 3) Fuzzing manual con el Repeater (el método)

El fuzzing manual no es "muchas peticiones a mano". Es **pensar una hipótesis
por petición**. Ejemplo real de flujo:

### Paso 1 — Consigue rutas candidatas (sin fuzzing)
- Del recon del pipeline (endpoints, JS files, sitemap, robots.txt).
- Del JS del frontend del objetivo: abre el bundle y busca `fetch("/api/…")`,
  rutas, parámetros. Los bundles de React/Angular filtran el mapa entero.
- De writeups públicos del programa (si los hay) y del propio scopes.

### Paso 2 — Construye la petición cruda en el Repeater

```
GET /api/v2/users/42 HTTP/1.1
Host: target.del-programa.com
Accept: application/json
Cookie: session=TU-COOKIE-REAL
```

⚠️ Cookies/credentials: SOLO de TU cuenta registrada en el programa (el mismo
criterio que la suite aplica en todo el pipeline).

### Paso 3 — Envía y COMPARA (aquí está el bug)
- El historial del Repeater muestra **diff** entre envíos: status, longitud,
  location, set-cookie. Un bug suele ser una diferencia de 1 en un número:
  `/users/42` 200 (tuyo) vs `/users/43` 200 con datos de OTRO usuario = IDOR.
- Prueba una variable por envío: cambia el id, quita el parámetro, cambia el
  método (`GET`→`POST`), añade cabeceras (`X-Original-URL: /admin`,
  `X-Forwarded-For: 127.0.0.1`), cambia el content-type.

### Paso 4 — el "403 bypass" básico (cuando el fuzz automático se pausa)
Con el Repeater, un 403 en `/admin` se investiga con hipótesis concretas:
1. `GET /admin/` con trailing slash, `/./admin`, `//admin`, `/%2f/admin`
2. Cabeceras: `X-Original-URL: /admin`, `X-Rewrite-URL`, `X-Forwarded-Host`
3. Método: `POST /admin` o `GET /admin?x=..;/admin`
4. Otro user-agent real + tu cookie de sesión válida (sin cookie muchos edges
   403ean ANTES de llegar a la app).

Cada una es UN envío y una comparación. Con 4-6 envíos sabes si el 403 es del
edge o de la app — información que el fuzz automático no te da.

### Paso 5 — Documenta en el momento
Botón **➕ Crear hallazgo** del Repeater: guarda petición (recortada),
respuesta, diff y tu nota. El reporte final se construye de ahí. Si esperas
a "acordarte luego", pierdes el detalle que el triager pide.

---

## 4) Fuzzing pesado — solo desde la terminal Kali, con política

Cuando de verdad necesitas un wordlist grande (diccionario de endpoints,
params brutos), KNK trae la **Terminal Kali** con las tools. Reglas:

- **Ritmo**: `ffuf -rate 20` o `-p 0.3` (20 req/s máx; mejor menos). Un 429
  significa que ya fuiste demasiado rápido.
- **Volumen**: wordlists pequeñas y con intención (` raft-small-words`,
  `api-endpoints`), nunca `seclists/all` contra producción.
- **Scope**: SOLO hosts del scope (mismo criterio que Targets).
- **Horario**: algunos programas piden ventanas; revisa la policy.

La Terminal Kali de KNK deja evidencia de sesión — úsala como el resto: todo
lo que haces queda registrado y defendible.

---

## 5) Del hallazgo al reporte

1. **Reproduce 2 veces** (la 2ª con la evidencia guardada). Si no reproduce,
   anota condiciones exactas (hora, cookie, IP).
2. Clasifica impacto REAL (qué puede hacer un atacante), no técnica (SSRF
   que no llega a nada = informativo).
3. Exporta desde **Reportes**; para Bugcrowd Safety usa
   `SAFETY-BB-PLANTILLA-SUBMIT-2026-09-06.md` (http_request y extra_info van
   en campos separados).
4. Título con la fórmula: `[Tipo] + [ubicación exacta] + [impacto concreto]`.

---

## 6) Checklist anti-desastres (lo que cierra cuentas)

- [ ] ¿El scope que tengo en Targets es EXACTAMENTE el del programa?
- [ ] ¿Mi OPPLAN tiene la autorización escrita y verdadera?
- [ ] ¿Estoy probando SOLO con mi cuenta?
- [ ] ¿Respaldé cada envío fuera de lo trivial en un hallazgo?
- [ ] ¿Si vi 429/403, bajé el ritmo en vez de insistir?
- [ ] ¿Revisé la policy del programa esta semana (cambian)?

---

*Guía viva: cuando descubras una técnica nueva en el Repeater, añádela a §3
con un ejemplo real (sin datos de programas privados).*
