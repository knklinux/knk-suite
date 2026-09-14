# Checklist Burp Suite — Revocación A/B

## Alcance

Esta checklist sirve únicamente para una prueba autorizada con dos cuentas propias o de test y un archivo o conversación sintética. No autoriza por sí misma el tráfico contra OpenAI.

## 0. Preflight obligatorio

- [ ] Brief vigente de OpenAI/Bugcrowd releído en la sesión.
- [ ] Identidad de Bugcrowd verificada y autorización aplicable confirmada.
- [ ] Asset exacto en scope cargado en KNK Suite.
- [ ] OPPLAN aprobado y con autorización escrita.
- [ ] Cuenta A y cuenta B controladas/autorizadas.
- [ ] Recurso sintético, sin PII, secretos, datos de terceros ni transacciones.
- [ ] Burp escuchando solo en `127.0.0.1`.
- [ ] Proxy configurado únicamente para los perfiles de prueba.
- [ ] Interceptación, Scanner e Intruder desactivados salvo una acción manual concreta.
- [ ] Rate limit de KNK y del Brief anotado.

Si falla cualquier punto, no se inicia la prueba.

## 1. Preparar Burp y los perfiles A/B

1. Arranca Burp Suite con un proyecto temporal local.
2. Configura el proxy en loopback, por ejemplo `127.0.0.1:8080`.
3. Instala el certificado de Burp solo en los perfiles de prueba; no lo instales globalmente.
4. Abre el perfil CDP de A y confirma que el tráfico pasa por Burp.
5. Abre el perfil CDP de B con un perfil separado y confirma que sus cookies no se mezclan con A.
6. En Burp, crea dos etiquetas: `A-owner` y `B-shared`.
7. Activa el historial HTTP y desactiva cualquier repetición automática.

No copies cookies, tokens ni cabeceras de autorización a chat, tickets o documentación sin redactar.

## 2. Crear y compartir el recurso

1. En el perfil A, crea un archivo o conversación con contenido como `SYNTHETIC-openai-ab-001`.
2. Captura la petición legítima de creación y guarda solo el identificador necesario.
3. Comparte el recurso con B usando el flujo normal de la aplicación.
4. Captura la respuesta de compartición y el estado visible desde A.
5. En el perfil B, abre el mismo recurso mediante el enlace o flujo normal.
6. Marca la respuesta de B como **baseline autorizado**.
7. Guarda en Burp una copia saneada de la petición y respuesta.

## 3. Revocar el acceso

1. Vuelve al perfil A.
2. Revoca el permiso de B o desactiva el enlace desde la interfaz normal.
3. Captura la petición de revocación y su respuesta.
4. Confirma desde A que el estado canónico indica revocado.
5. No borres el recurso si la comprobación requiere conservarlo; no realices acciones irreversibles.

## 4. Comprobación posterior desde B

1. En el perfil B, repite **solo la misma petición de lectura** del recurso ya conocido.
2. No cambies identificadores, no enumeres recursos y no uses Intruder.
3. Registra código HTTP, tamaño de respuesta y si aparece el contenido sintético.
4. Si existe una modificación reversible, repite únicamente esa acción mínima sobre el recurso sintético.
5. Espera el intervalo configurado por el rate limit antes de repetir.
6. Repite la lectura post-revocación una segunda vez.
7. Detente ante PII, secreto, dato de tercero, CAPTCHA, `429`, bloqueo o degradación.

## 5. Interpretación

### Resultado esperado

- Antes de revocar: B obtiene `200` y el contenido sintético.
- Después de revocar: B obtiene `401`, `403`, `404` o una respuesta sin contenido privado.

### Candidato de seguridad

Solo existe un candidato si, tras una revocación confirmada, B obtiene de forma reproducible:

- contenido privado sintético con respuesta satisfactoria; o
- capacidad de modificación no autorizada y reversible.

Un `200` vacío, una caché local, una pantalla antigua o una diferencia visual no demuestra una vulnerabilidad.

## 6. Saneamiento de evidencias

Antes de importar evidencias a KNK Suite:

- [ ] Eliminar `Cookie`, `Set-Cookie`, `Authorization`, `X-API-Key`, tokens CSRF y URLs con credenciales.
- [ ] Sustituir identificadores sensibles por `RESOURCE_A_SYNTHETIC`.
- [ ] Mantener método, ruta, código HTTP, cabeceras relevantes y cuerpo mínimo.
- [ ] Redactar nombres, correos, PII y contenido no necesario.
- [ ] Guardar archivos solo bajo el directorio de evidencias de KNK.
- [ ] Registrar timestamp, cuenta A/B y acción sin incluir secretos.

## 7. Cierre en KNK Suite

- [ ] Abrir **Revocación A/B**.
- [ ] Elegir `Archivo` o `Conversación`.
- [ ] Preparar el protocolo y confirmar `externalRequests: 0`.
- [ ] Marcar únicamente hechos observados.
- [ ] Introducir los códigos HTTP reales.
- [ ] Ejecutar el análisis offline.
- [ ] Si pasa, revisar manualmente Brief, duplicados, impacto, severidad y evidencia.
- [ ] No abrir triage automáticamente: requiere revisión humana final.
