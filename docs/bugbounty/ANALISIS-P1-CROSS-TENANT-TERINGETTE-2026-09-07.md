# 🎓 Análisis del P1 divulgado (Teringette-adamuzonyi) — Lecciones metodológicas para nuestra caza

> Fecha: 2026-09-07 · Fuente: disclosure público en Bugcrowd (19-ago-2026, $2.000, P1, Resolved)
> "Cross-User PHI/PII Leakage — Cross-Tenant Context Isolation Failure in ChatGPT"
> Autor: Adam Uzonyi · Caso NO adversarial (hallazgo pasivo, sin payload)

---

## 1) Qué demuestra el caso (hechos del disclosure)

| Hecho | Implicación para nosotros |
|---|---|
| El bleed cross-tenant fue **espontáneo**: uso normal, sin payload, bajo carga de producción | Existe una clase de bug que **no se puede buscar activamente** — solo detectarse pasivamente mientras se usa la plataforma |
| La fuga incluía datos estructurados de **fichero subido** (HIP Hypothesis B: RAG namespace sin enforcement a nivel data-layer) | Coherente con lo que NO vimos en V7: nuestro test fue **IDOR activo** (petición directa al file_id ajeno → 404). El fallo real estaba en la **capa de recuperación del modelo**, no en la API de files |
| Cerrado primero como "Not reproducible" · reabierto tras revisión interna · P1 | Un "no reproduzco" NO mata un hallazgo de privacidad: la validación es un **cross-check de autenticidad en logs del backend**, no la reproducción del prompt |
| La etiqueta "prompt injection" del reporte fue un error de clasificación del propio researcher | El caso real es **LLM08/BAC (isolation failure)** — mapear VRT bien desde el minuto uno |
| OpenAI NO ha aprobado la divulgación técnica pública; el researcher solo puede decir "envié y cobré" | Restricción de disclosure que **debemos respetar** al referenciar el caso |

## 2) Corrección a nuestra metodología CLLMSE (¡importante!)

Nuestro doc `OPENAI-CLLMSE-METODOLOGIA-SCOPE-2026-09-06.md` marca LLM04/08
(vector/embedding cross-account) como **"❌ Cerrado"** porque V7 probó que el
acceso directo cross-account a files RAG da 404.

**Ese veredicto era correcto para el vector que probamos, pero incompleto:**
el P1 divulgado demuestra que la clase de fallo existe en producción por una
ruta distinta (recuperación semántica / cache, condiciones estrechas, sin
acción del atacante). Veredicto actualizado:

| Vector | Antes | Ahora |
|---|---|---|
| LLM04/08 activo (IDOR a objetos RAG ajenos) | ❌ Cerrado | ❌ Sigue cerrado (V7: 404 aislamiento correcto) |
| LLM04/08 **pasivo** (contenido ajeno apareciendo en output del modelo) | (no existía como línea) | 🟢 **ABIERTO — solo detectable observacionalmente** |

## 3) Nuevo vector operativo: V13 — monitor pasivo de contexto ajeno

**Diseño (sin gastar peticiones extra):** toda respuesta de modelo que ya
recibimos en drivers y sonda se escanea antes de descartarse.

1. **Detector**: regex + heurística sobre cada output de modelo (respuestas de
   `/conversation`, análisis de ficheros, resúmenes) buscando contenido que NO
   provenga de nuestros recursos `SYNTHETIC-*`: nombres propios + marcadores de
   documento (fechas, códigos diagnósticos-like, estructuras de fichero ajeno,
   metadatos con UUIDs que no sean los nuestros).
2. **Si dispara**: congelar todo (cero reintentos — la condición es estrecha y
   un retry puede invalidar la evidencia), capturar raw + pantallazo + timestamp
   + session ids + request exacto, y redactar siguiendo la plantilla del §4.
3. **Manejo ético**: si el contenido parece real de un tercero → redactar
   identificadores inmediatamente, guardar lo mínimo imprescindible para la
   validación del vendor, no circularlo jamás. (El paper mismo marca esta
   exclusión como restricción permanente — la adoptamos.)

**Por qué es valioso:** es el único vector del handbook que puede producir P1
en este programa y que no depende ni del flag anti-abuso ni de features de
pago. Su coste es cero peticiones adicionales (escanea lo que ya llega).

## 4) Plantilla de redacción si alguna vez dispara (lecciones del caso)

| Lección del caso | Nuestra regla |
|---|---|
| "Not reproducible" inicial por condiciones estrechas | El reporte NO pide reproducibilidad del prompt: pide **verificación de autenticidad** de los datos expuestos (es lo que acabó validándolo) |
| Especificidad estructurada = señal, no ruido | Listar explícitamente los elementos internamente coherentes (fechas, códigos, metadatos) como evidencia de autenticidad, no como curiosidad |
| Mal etiquetado VRT ("prompt injection") | VRT correcto: `AI Application Security → Sensitive Information Disclosure → Cross-Tenant PII Leakage/Exposure` (P1) o `BAC` según el aterrizaje |
| El researcher tuvo que reabrir 3 veces | Nuestro protocolo: 1 submission limpia + 1 apelación con argumento nuevo; el cross-check del vendor es el que decide |
| Redacción del tercero | Datos del afectado a nivel de categoría, cero identificadores, siempre |

## 5) Duplicados — actualización de términos

Añadir a la lista de check de panel antes de cualquier submit de esta clase:
`cross-tenant`, `context isolation`, `KV-cache`, `prompt cache`, `RAG namespace`,
`vector store leakage`, `PHI`, y vigilancia de nuevos disclosures del handle
`Teringette-adamuzonyi` (autor activo en esta clase de fallos).

Nota: este disclosure público NO bloquea un futuro hallazgo propio (es otra
ruta y el bug está fixeado), pero cualquier reporte nuestro de esta clase debe
diferenciarse explícitamente de él.
