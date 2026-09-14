# OpenAI/Bugcrowd — Validación IDOR horizontal A/B

## Estado

Este procedimiento prepara y analiza una prueba autorizada. No autoriza por sí mismo tráfico contra OpenAI y el laboratorio local es la única ejecución automática incluida.

## Precondiciones

- Brief vigente y asset exacto confirmado en scope.
- Identidad y autorización aplicables confirmadas.
- OPPLAN aprobado después de cargar el scope definitivo.
- Dos cuentas propias o explícitamente autorizadas: A y B.
- Un único recurso privado sintético creado por B.
- Burp y navegador real con perfiles separados, sin mezclar cookies.
- User-Agent y rate limit documentados.

## Secuencia mínima

1. B crea un archivo o conversación con contenido sintético, por ejemplo `SYNTHETIC-openai-idor-001`.
2. B lee el recurso por el flujo normal y se captura el baseline `200`.
3. A intenta leer únicamente el mismo identificador conocido; no se enumeran IDs.
4. Si existe una acción reversible, A intenta una única modificación mínima sobre el mismo recurso sintético.
5. Se repite la lectura una segunda vez, respetando el intervalo configurado.
6. Se detiene la prueba inmediatamente ante PII, secretos, datos de terceros, CAPTCHA, bloqueo, `429` o degradación.

## Interpretación

Resultado esperado:

- B obtiene `200` con su contenido sintético.
- A obtiene `401`, `403` o `404`.
- A no puede modificar el recurso.

Solo se considera candidato si A obtiene de forma reproducible contenido privado de B o realiza una modificación no autorizada, usando un identificador ya conocido y sin enumeración.

Un `200` vacío, una respuesta de interfaz, una caché local o un identificador adivinado sin contenido privado no demuestra IDOR.

## Compuerta KNK

La cadena exige:

- scope exacto;
- dos cuentas propias/autorizadas;
- recurso privado de B;
- baseline legítimo de B;
- lectura privada por A;
- recurso único conocido;
- segunda reproducción;
- elegibilidad del programa.

La suite bloquea la apertura del informe si falta cualquiera de estos hechos. Las capturas deben proceder del navegador real y las peticiones/respuestas deben estar saneadas, sin cookies, tokens, PII ni secretos.

## Laboratorio local

```bash
npm test
REVOCATION_LAB_BUG=1 npm run lab:revocation
```

El escenario vulnerable es exclusivamente sintético y local; no debe extrapolarse a OpenAI sin evidencia real y autorización vigente.
