# E13 — Kit de réplica al triager (2026-09-21)

Submission `b8370246-cd3f-4446-b074-f9fc05df9d2d` (pendiente). Si preguntan o lo cierran
mal, responder copiando el bloque correspondiente. Nada que no esté ya evidenciado.

## P0. Carrera real (nuevo 21-sep, entre cuentas propias A/B)

R1 (B reserva, B PUT primero, A PUT último, B claim) y R2 espejo: PUTs 201/201,
claim 200, size final = bytes del ÚLTIMO escritor en ambos órdenes. El atacante
con la capability gana sistemáticamente escribiendo último. Limpieza DELETE tras
cada ronda (residuos por UI si el DELETE 500ea: RACE*.txt/TYPE*.txt).

> The Sept 21 race rounds (both orders, self-owned accounts A/B) confirm
> last-writer-wins symmetrically: PUT victim-first 201, PUT attacker-last 201,
> claim 200, final size = attacker's bytes. Whoever writes last before the
> claim decides the bytes.

## P1. Tamaño único (corrige 33/34 del draft)

34 bytes incl. trailing newline (33 + `\n`), verificado en
`evidencia-poc/http/sas-round3-contenido.txt` (34 B, termina `20-41-0A`) y log
`file_size=34` en claim. El draft ya dice 34 en pasos + adjuntos.

## P2. Alcance de la afirmación (ya en Impact del draft)

Probado: cualquiera con la `upload_url` (válida ~5 min) sustituye el blob pendiente,
cross-account y anónimo, y el claim de la víctima materializa esos bytes.
NO afirmado: vía remota para obtener la URL de otra víctima (sin enumeración,
sin predicción de IDs, sin lectura cruzada — todo 404). Severidad P4/CVSS 4.3
conservador a propósito.

## P3. Si dicen "necesita otro compromiso" (extensiones/proxies/logs)

Esos canales son secundarios en el reporte. El núcleo no depende de ellos:
el servidor emite una capability de escritura no ligada al contexto solicitante
y el storage la honra sin autenticación ni identidad. Eso es el bug.

## P4. Si piden "¿y el claim cruzado / lectura?"

Ya probado y declarado: claim cruzado 200 eco idempotente sin transferencia
(`user_mismatch` al reclamar ajeno), lectura cruzada 404, ownership intacto.
Impacto = integridad de contenido, no confidencialidad ni ATO.

## P5. Remediación (orden)

1. Bind SAS al principal/sesión (verificar `scid` en el PUT, no solo en claim).
2. Single-use (mitiga replays, pero el atacante que escribe último igual gana).
3. Expiración corta (ya ~5 min; no es control de acceso).

## Estado de evidencias

- `sas-round3-contenido.txt` (34 B decisivos) + `sas-round3-resultado.json` + log.
- `sas-upload-raw.txt` (sondeo), `sas-ip-binding-analisis.txt` (sin `sip`/`sipr`).
- `e13-descarga-B.png` (captura navegador, sesión B).
- Draft corregido: `docs/bugbounty/E13-PAQUETE-SUBMIT-BUGCROWD-2026-09-06.md`.
