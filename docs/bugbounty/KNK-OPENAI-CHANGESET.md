# Conjunto de cambios enfocado — KNK/OpenAI

Este archivo documenta la separación lógica del trabajo. No se han hecho `git add`, `stash`, `reset` ni commits porque el árbol ya contenía modificaciones de varias tareas y no es seguro asumir propiedad sobre todos los archivos.

## Cambios enfocados de esta línea de trabajo

- `backend/lib/revocation.js` — análisis y protocolo de revocación A/B.
- `backend/lib/revocation-lab.js` — laboratorio sintético en memoria.
- `backend/local-revocation-lab.js` — servidor local para practicar con Burp.
- `backend/lib/gates.js` — compuerta de revocación y dispatch por tipo.
- `backend/index.js` — endpoints de plan/análisis y gate `revocation`.
- `backend/lib/pipeline.js` — exposición del flujo de revocación en EXPLOIT.
- `backend/test.js` — regresiones del flujo de revocación y SQLi existente.
- `frontend/src/components/Revocation.jsx` — interfaz de análisis offline.
- `frontend/src/App.jsx` — navegación a Revocación A/B.
- `docs/bugbounty/OPENAI-REVOCACION-AB.md` — procedimiento autorizado.
- `docs/bugbounty/OPENAI-BURP-REVOCACION-AB.md` — checklist Burp paso a paso.
- `docs/bugbounty/KNK-OPENAI-CHANGESET.md` — esta delimitación.

## Archivos relacionados preexistentes

El estado inicial ya incluía cambios amplios de seguridad, Docker, frontend, documentación y artefactos de recon. Permanecen sin clasificar y no se deben mezclar automáticamente con este conjunto.

## Política de separación

Antes de un commit, revisar cada fichero y cada hunk manualmente. Solo incluir los cambios directamente relacionados con el flujo OpenAI/Bugcrowd, la revocación A/B, la checklist Burp y el laboratorio local. No incluir credenciales, cookies, tokens, capturas sin redacción ni artefactos de terceros.
