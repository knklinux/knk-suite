# OpenAI/Bugcrowd — Validación de revocación A/B

## Objetivo

Comprobar, usando únicamente dos cuentas propias o de test autorizadas y un recurso sintético, si la cuenta B conserva acceso a un archivo o conversación después de que A revoque el permiso o desactive el enlace.

La suite **no crea cuentas, no obtiene cookies, no enumera identificadores y no ejecuta tráfico por sí misma** en este flujo. Solo prepara el protocolo y analiza evidencia capturada mediante el navegador CDP autenticado y dentro del Brief vigente.

## Requisitos previos

- Identidad de Bugcrowd verificada y Brief vigente releído en la sesión.
- Programa configurado como OpenAI/Bugcrowd.
- Scope exacto cargado en KNK Suite y OPPLAN aprobado con autorización escrita.
- Dos cuentas propias o de test autorizadas, A y B.
- Recurso sintético sin PII, secretos, contenido confidencial ni datos de terceros.
- Rate limit de la sesión respetado; detenerse ante 429, CAPTCHA, bloqueo o degradación.

## Secuencia mínima

1. A crea el archivo o conversación sintética y guarda el identificador/URL sin tokens.
2. A comparte el recurso con B usando la función normal del producto.
3. B accede una vez y se captura el baseline legítimo.
4. A revoca el acceso o desactiva el enlace desde el flujo normal.
5. Se confirma la revocación desde A y, si existe, se comprueba el estado canónico.
6. B repite **una lectura del mismo recurso**, sin cambiar IDs ni enumerar.
7. Solo si el producto ofrece una acción reversible, B prueba una modificación mínima del recurso sintético.
8. Repetir la comprobación post-revocación una segunda vez y guardar request/response mínimo, estado HTTP y capturas redactadas.

## Resultado reportable

La compuerta solo puede pasar si se demuestra de forma reproducible que, después de revocar:

- B recibe el contenido privado sintético con respuesta satisfactoria; o
- B puede modificar el recurso con respuesta satisfactoria.

Un `401/403/404`, una página vacía, una caché local o un cambio solo visual **no** es un hallazgo. Si aparece PII o información de terceros, detenerse, no copiarla y documentar el incidente por el canal permitido.

## Uso en KNK Suite

1. Abrir **Revocación A/B**.
2. Elegir `Archivo` o `Conversación`.
3. Pulsar **Preparar protocolo**: debe mostrar `externalRequests: 0`.
4. Ejecutar manualmente la secuencia autorizada en los perfiles CDP A/B.
5. Marcar únicamente hechos observados y añadir los códigos HTTP reales.
6. Pulsar **Analizar sin tráfico externo**.
7. Si pasa todas las compuertas, revisar manualmente el Brief, duplicados, severidad, evidencia y mínimo acceso antes de crear el borrador.

La pantalla de revocación es una herramienta de validación; no constituye autorización ni envía un reporte automáticamente.
