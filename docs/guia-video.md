# 🐉 Guía para grabar video — KnkSuite v2

## Preparación (antes de grabar)

1. **Abrir la suite**: Doble clic en `~/Escritorio/knk-suite.desktop`
2. **Verificar Ollama**: En el sidebar debe salir "LLM: hermes3" en verde
3. **Tener listo**: una URL de programa de bug bounty (ej: Deezer)

---

## Escena 1: Arrancar y configurar (1 min)

### Qué mostrar:
1. Doble clic en el acceso directo del escritorio
2. Se abre la terminal con el banner de KnkSuite v2
3. Abrir `http://127.0.0.1:8086` en el navegador
4. Mostrar el dashboard limpio

### Qué decir:
> "Esta es KnkSuite v2, una suite de bug bounty con pipeline de 7 fases y controles visibles. Vamos a configurar un target autorizado."

---

## Escena 2: Auto-rellenar desde URL (2 min)

### Qué mostrar:
1. Ir a **YesWeHack** → buscar programa (ej: Deezer)
2. Copiar la URL del programa
3. Pegar en el campo "URL del programa" en el dashboard
4. Click **"🔍 Auto-rellenar desde URL"**
5. Verificar que se rellenan: scope, out-of-scope, UA, rate limit

### Qué decir:
> "Pegamos la URL del programa y la suite extrae automáticamente el scope, los dominios fuera de scope, el User-Agent requerido y el rate limit. Todo según la política del programa."

### Verificar en video:
- [ ] Scope aparece con los dominios correctos
- [ ] Out-of-scope aparece (ej: developers.deezer.com)
- [ ] User-Agent tiene formato `bug-bounty-HunterName`

---

## Escena 3: Fijar objetivo + OPPLAN (2 min)

### Qué mostrar:
1. Click **"Fijar objetivo"**
2. Verificar que se abre el OPPLAN pre-rellenado
3. Verificar: nombre, scope, out-of-scope heredados
4. Click **"💾 Guardar OPPLAN"**
5. Click **"✅ Aprobar OPPLAN"**

### Qué decir:
> "Al fijar el objetivo, el OPPLAN se rellena automáticamente con el scope que ya hemos documentado. El OPPLAN es nuestro plan de operación: qué vamos a auditar, qué NO vamos a tocar, y bajo qué autorización."

### Verificar en video:
- [ ] OPPLAN tiene el nombre correcto
- [ ] Scope coincide con lo que pusimos
- [ ] Out-of-scope aparece en "NO TOCAR"
- [ ] Checkbox de autorización marcado

---

## Escena 4: Compliance (1 min)

### Qué mostrar:
1. Ir a la pestaña **"📜 Compliance"**
2. Mostrar la tabla de qué hace la suite vs qué permiten las políticas
3. Mostrar la advertencia sobre fuzz automático
4. Mostrar el checklist pre-envío

### Qué decir:
> "Esta pestaña nos dice qué podemos y qué NO podemos hacer. La suite cumple con User-Agent, scope enforcement, rate limiting, y coordinated disclosure. Pero OJO: el fuzz automático está prohibido en la mayoría de programas. Lo usamos solo con autorización explícita."

### Verificar en video:
- [ ] Tabla visible con ✅ y ⚠️
- [ ] Advertencia roja sobre fuzz
- [ ] Checklist con checkboxes

---

## Escena 5: Ejecutar pipeline (2 min)

### Qué mostrar:
1. Ir a la pestaña **"🚀 Pipeline"**
2. Click **"🚀 Ejecutar pipeline completo"**
3. Ver el progreso en tiempo real (cada fase aparece con ✓)
4. Ver el resumen final con hallazgos

### Qué decir:
> "Un solo click ejecuta las 7 fases: PLAN, RECON, SCAN, FUZZ, EXPLOIT, REPORTE, VERIFICAR. Cada fase muestra resultados en tiempo real."

### Qué mostrar durante la ejecución:
- RECON: "421 subdominios, 50 URLs, tech: Apache, React"
- SCAN: "6 headers ausentes, CORS: ok"
- FUZZ: "manual-paced (15 rutas, limitador global, parada ante rate-limit)"
- REPORTE: "borrador generado"
- VERIFICAR: "REVISAR (65/100)"

### Verificar en video:
- [ ] Las 7 fases completan (todas con ✓)
- [ ] Hallazgos aparecen en el resumen
- [ ] Reporte borrador se muestra
- [ ] Verificación muestra veredicto

---

## Escena 6: Editar reporte + evidencia (3 min)

### Qué mostrar:
1. En el panel post-pipeline, editar el reporte:
   - Título: "CORS en api.deezer.com"
   - Asset: "api.deezer.com/v1/user"
   - Tipo: "CORS"
   - CWE: "CWE-942"
   - CVSS: "6.5"
   - Severidad: "medium"
   - Impacto: descripción real
   - Pasos: al menos 3 pasos con `|`
2. Subir screenshot (upload)
3. Pegar curl reproducible

### Qué decir:
> "Ahora rellenamos el reporte con los datos reales del hallazgo. Los screenshots son OBLIGATORIOS — sin ellos el triager rechaza el reporte. El curl debe ser copiable y pegable."

### Qué mostrar:
- Screenshot del exploit (captura del navegador)
- Curl desde DevTools → Network → Copy as cURL
- Pegar en el textarea de "Request/Response"

### Verificar en video:
- [ ] Todos los campos rellenados
- [ ] Screenshot subido
- [ ] Curl pegado
- [ ] Click "💾 Guardar borrador"

---

## Escena 7: Compuertas (2 min)

### Qué mostrar:
1. Click en el botón de la compuerta correspondiente (ej: "🔓 CORS")
2. Rellenar los campos de la compuerta:
   - Origin reflejado: Sí
   - Status: 200
   - Auth: cookie
   - Dato sensible: Sí
   - Lectura cross-origin: Sí
   - Exfiltración: Sí
3. Click **"Validar CORS"**
4. Verificar que la cadena está completa (✅ en todas)

### Qué decir:
> "Las compuertas son filtros de calidad. Cada vulnerabilidad tiene una cadena de verificación. Si algún paso falla, no enviamos el reporte — mejor esperar a tener evidencia sólida."

### Verificar en video:
- [ ] Todos los campos de la compuerta marcados con ✅
- [ ] Mensaje "CADENA CORS COMPLETA"
- [ ] Toast "✅ Reportable!"

---

## Escena 8: Chat LLM (1 min)

### Qué mostrar:
1. Ir a la pestaña **"💬 Chat LLM"**
2. Preguntar: "¿Qué headers de seguridad faltan en mi target?"
3. Esperar respuesta de Ollama
4. Preguntar: "¿Cómo podría explotar un CORS mal configurado?"

### Qué decir:
> "El chat usa Ollama local — nada de datos saliendo de nuestra máquina. Podemos preguntarle sobre técnicas de explotación, remediarion, o cualquier duda de seguridad."

---

## Escena 9: Cerrar y verificar (30 seg)

### Qué mostrar:
1. Ir a la pestaña **"📝 Reportes"**
2. Verificar que el reporte aparece guardado
3. Cerrar el navegador
4. La terminal sigue abierta (la suite se puede reabrir)

### Qué decir:
> "El reporte queda guardado. La suite mantiene la sesión entre ejecuciones. Podemos continuar en cualquier momento."

---

## Checklist final del video

- [ ] Video dura 10-15 minutos
- [ ] Se ve el dashboard completo al menos una vez
- [ ] Se muestra el auto-rellenar desde URL
- [ ] Se ejecuta el pipeline completo (las 7 fases)
- [ ] Se edita el reporte con datos reales
- [ ] Se sube al menos un screenshot
- [ ] Se pega un curl reproducible
- [ ] Se valida con una compuerta
- [ ] Se muestra la pestaña de compliance
- [ ] Se muestra el chat LLM funcionando
- [ ] El audio explica qué hace cada paso

---

## Errores comunes en video

| Error | Solución |
|---|---|
| "Fijar objetivo" no funciona | F5 en el navegador, verificar que el scope no está vacío |
| Pipeline se cuelga en SCAN | Verificar que el target responde (ej: example.com) |
| Chat no responde | Verificar que Ollama está corriendo (`ollama list`) |
| Screenshot no sube | Verificar que es imagen (png/jpg), no pdf |
| Compuerta falla | Rellenar TODOS los campos, incluir screenshots |

---

## Programas recomendados para el video

| Programa | URL | Por qué |
|---|---|---|
| **Deezer** | `https://yeswehack.com/programs/deezer-bug-bounty-program-2019` | 10 dominios, rewards €100-€2,500, activo |
| **Infomaniak** | `https://yeswehack.com/programs/infomaniak-bug-bounty` | Hosting suizo, buen scope web |
| **Le Bon Coin** | `https://yeswehack.com/programs/leboncoin-bug-bounty-program` | Marketplace francés, alto volumen |

---

*Generado por knkSuite v2 — 2026-08-23*