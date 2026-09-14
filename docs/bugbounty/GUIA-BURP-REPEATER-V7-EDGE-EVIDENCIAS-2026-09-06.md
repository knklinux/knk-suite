# 🔀 Guía: interceptar Edge de evidencias con Burp y repetir la cruzada V7 en Repeater

> Fecha: 2026-09-06 · Todo verificado contra tu entorno real: Burp vivo en
> `127.0.0.1:8080` (PID 5504, `BurpSuite.exe`), CA exportada en
> `evidencia-poc/burp-ca.pem`, túnel CONNECT a chatgpt.com validado (200),
> jars de sesión A/B en `evidencia-poc/http/sesion-cuenta-*-cookies.txt`.

---

## 0) Lo que ya está verificado en tu máquina (ground truth de hoy)

- Burp Suite **corriendo** en `127.0.0.1:8080` (PID 5504)
- **CA de Burp ya exportada** a `evidencia-poc/burp-ca.pem` — el túnel CONNECT
  funciona y la validación con esa CA pasa (verificado con curl + `--cacert`)
- El proxy **pasa tráfico a chatgpt.com**: respuesta 403 con curl sin sesión =
  normal (Cloudflare); con cookie de sesión real y UA del navegador pasa
- Jars de sesión host-strict: A = 28 cookies, B = 27 (incluye `__Secure-next-auth.session-token`)
- `file_id` sintético de B del último V7: `file_00000000f4288246bd54438317b65e53`

⚠️ Recordatorio del hallazgo previo: el **tráfico automatizado de la suite vía
Burp recibía `cf-mitigated: challenge`** (fingerprint TLS de Burp → challenge de
Cloudflare). En **Repeater manual el problema es distinto y menor**: envías
peticiones una a una, y el contexto del navegador conectado a Burp resuelve los
challenges humanamente. Por eso este flujo manual sí es viable.

---

## 1) Conectar el Edge de evidencias al proxy de Burp (2 min)

Cierra la ventana de evidencias actual (el perfil persiste en disco) y relánzala
añadiendo el proxy a los flags de siempre:

```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9336 --user-data-dir="%USERPROFILE%\.knk-suite\browser-profile\openai-poc" --proxy-server="http=127.0.0.1:8080;https=127.0.0.1:8080" --no-first-run
```

| Flag | Qué hace |
|---|---|
| `--user-data-dir=...openai-poc` | Usa el MISMO perfil de evidencias (sesiones y cookies de chatgpt.com persisten ahí) |
| `--proxy-server=http=127.0.0.1:8080;https=127.0.0.1:8080` | Todo el HTTP/HTTPS de ESA ventana pasa por Burp (tu Edge normal no se toca) |

Verificación: abre `https://chatgpt.com` en esa ventana → en Burp,
**Proxy → HTTP history** debe aparecer la petición (aunque con error de
certificado hasta el paso 2).

## 2) Instalar la CA de Burp en el perfil de evidencias (1 vez, 3 min)

Sin esto, Edge avisará en cada HTTPS.

1. En el Edge de evidencias (con proxy), navega a `http://burpsuite` → **"CA Certificate"** → descarga `cacert.der`
2. Edge → Configuración → Privacidad → Seguridad → **Administrar certificados** → Importar → `cacert.der` → almacén **"Entidades de certificación raíz de confianza"**
3. Reinicia la ventana. Abre `https://chatgpt.com`: debe cargar **sin aviso** y la petición aparece limpia en HTTP history

> Alternativa: el `.pem` ya exportado es la misma CA; lo que falta es la
> confianza del **perfil Edge de evidencias**, y eso solo se hace importando.

## 3) Configurar Burp para la cruzada (2 min)

1. **Proxy → Intercept**: OFF (navegas sin fricción; capturas en history)
2. **Target → Scope**: Include `chatgpt.com`; Exclude `pay.openai.com` (fuera de scope del programa). Añade `^.*\.oaiusercontent\.com$` solo si vas a tocar content_urls
3. **Proxy → HTTP history**: filtro por "files" para localizar el tráfico V7 rápido

## 4) Capturar las peticiones V7 desde el navegador real (5 min)

Con la ventana de evidencias logueada en **cuenta B** (si el perfil perdió la
sesión, re-login ahí — verás el login pasar por Burp):

1. Ve a la biblioteca de archivos de B y navega dentro de ella
2. En **Proxy → HTTP history**, clic derecho → **Send to Repeater** sobre:
   - `GET /backend-api/files/library/nodes` (o `.../directories/path`) → renombra la pestaña: `B-baseline-nodes`
   - `GET /backend-api/files/library/files/{libfile}/content_url` (si B descarga algo) → `B-baseline-content`
3. El `libfile` de B para la cruzada: del último V7 es
   `file_00000000f4288246bd54438317b65e53`. Para uno fresco: sube un archivo
   cualquiera a la biblioteca de B desde la ventana y captura su id en history

## 5) La cruzada A→B en Repeater (el corazón del test, 5 min)

Necesitas **cookies + Bearer de A**: están en
`evidencia-poc/http/sesion-cuenta-A-cookies.txt` (host⇥nombre⇥valor). Todas las
filas `chatgpt.com`/`.chatgpt.com` van en la cabecera `Cookie:` de una sola
línea separadas por `; `.

En la pestaña `B-baseline-nodes` del Repeater:

1. **Sustituye la cabecera `Cookie:`** completa por la de A
2. **Sustituye/añade `Authorization: Bearer <TOKEN_A>`**
3. Cambia la ruta a:
   ```
   GET /backend-api/files/library/files/file_00000000f4288246bd54438317b65e53 HTTP/1.1
   ```
4. **Send** y lee:
   - **404** (esperado: 3 ejecuciones automatizadas lo confirmaron) = aislamiento correcto, V7 sigue cerrado
   - **200 con datos de B** = IDOR confirmado → pantallazo inmediato + petición cruda a fichero: hallazgo real
5. Si hay 200, repite con la ruta `content_url` del response
6. **Control negativo**: el mismo request con cookies+Bearer de **B** → debe ser **200** (es suyo). Sin este control, el 404 de A no prueba nada

## 6) Evidencia a capturar (para que el test valga como documentación)

| Evidencia | Cómo |
|---|---|
| Request A→B crudo (el del 404) | Repeater → copiar el panel request entero a `v7-burp-repeater-request-A-B.txt` |
| Response 404 crudo | Panel response íntegro → `v7-burp-repeater-response-A-B.txt` |
| Control 200 con B | Segunda petición Repeater (cookies de B) → mismo formato |
| Pantallazo Burp | Pestaña Repeater visible con request+response del 404 |
| Pantallazo navegador | Ventana de evidencias mostrando la biblioteca de B |

Déjalos en `evidencia-poc/http/` y los normalizo/integro en el triaje cuando los tengas.

## 7) Ritmo y límites (política E16, igual que la suite)

- Repeater **manual** = ritmo humano: sin riesgo de rate limit ni anti-abuso
- **Intruder PROHIBIDO** contra chatgpt.com (bombardeo = flag anti-abuso = riesgo para A/B y para la sesión del panel)
- Máximo ~10-15 peticiones manuales; no insistas más
- Nada fuera del scope configurado en el paso 3

---

## Resumen de un vistazo

1. Edge de evidencias con `--proxy-server=127.0.0.1:8080` + CA importada
2. Burp: Intercept OFF · scope `chatgpt.com` · exclude `pay.openai.com`
3. History: `GET /files/library/nodes` y `content_url` de B → Repeater
4. Repeater: Cookie/Bearer → los de A + ruta con el `file_id` de B → Send
5. **404 = cerrado (esperado) · 200 con datos de B = hallazgo real**
6. Control con B → 200 (valida el test)
