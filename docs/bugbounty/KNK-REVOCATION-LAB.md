# Laboratorio local de revocación A/B

Este laboratorio no contacta OpenAI ni ningún proveedor externo. Escucha solo en `127.0.0.1` y utiliza cuentas sintéticas A/B.

## Arranque

Desde `knk-suite/`:

```bash
npm run lab:revocation
```

Por defecto queda en `http://127.0.0.1:8099`.

Para reproducir intencionadamente una implementación vulnerable, solo en local:

```bash
REVOCATION_LAB_BUG=1 npm run lab:revocation
```

Ese modo permite que B conserve lectura y escritura después de revocar para comprobar que Burp y KNK detectan la diferencia. Nunca debe usarse contra un servicio externo.

## Flujo manual con Burp

Usa `X-Lab-Account: A` y `X-Lab-Account: B` para separar las dos identidades.

### Crear desde A

```http
POST /api/resources HTTP/1.1
Host: 127.0.0.1:8099
X-Lab-Account: A
Content-Type: application/json

{"type":"file","content":"SYNTHETIC-local-file-001"}
```

Guarda el `id` devuelto.

### Compartir desde A

```http
POST /api/resources/synthetic-1/share HTTP/1.1
Host: 127.0.0.1:8099
X-Lab-Account: A
Content-Type: application/json

{"target":"B"}
```

### Baseline desde B

```http
GET /api/resources/synthetic-1 HTTP/1.1
Host: 127.0.0.1:8099
X-Lab-Account: B
```

Debe devolver `200` y contenido sintético.

### Revocar desde A

```http
POST /api/resources/synthetic-1/revoke HTTP/1.1
Host: 127.0.0.1:8099
X-Lab-Account: A
```

### Comprobar desde B

Repite exactamente el `GET` anterior dos veces. En modo seguro debe devolver `403` en ambas ocasiones. En modo vulnerable debe devolver `200`; esa diferencia reproduce el patrón que se analizaría con la compuerta de revocación.

## Reglas del laboratorio

- Solo contenido que empiece por `SYNTHETIC-`.
- Solo cuentas `A` y `B`.
- Sin cookies reales, tokens reales, PII ni Internet.
- No usar Intruder, Scanner ni enumeración: el objetivo es entender el flujo A/B.
- El endpoint `/api/audit` muestra el registro local de acciones.
