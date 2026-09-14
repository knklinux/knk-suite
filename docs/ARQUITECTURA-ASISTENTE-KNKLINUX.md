# knkLinux — Arquitectura del asistente IA

**Estado:** diseño técnico inicial  
**Fecha:** 2026-09-09

## 1. Objetivo

Construir un asistente privado y contextual para pentesting autorizado, programación y estudio. La referencia de experiencia es un asistente moderno con presencia —similar en espíritu a un copiloto de escritorio—, pero adaptado a seguridad: transparente, verificable y con consentimiento.

No se busca un agente que ataque objetivos por sí mismo. Se busca un **copiloto técnico con herramientas limitadas**, capaz de preparar trabajo de alta calidad y ejecutar únicamente lo que el scope y el usuario permitan.

## 2. Arquitectura por capas

```text
┌────────────────────────────────────────────────────────┐
│ knkLinux Desktop / ventana flotante / CLI futuro       │
├────────────────────────────────────────────────────────┤
│ Assistant UX: chat, voz, avatar, streaming, approvals  │
├────────────────────────────────────────────────────────┤
│ Context broker: workspace, scope, terminal, evidence   │
├────────────────────────────────────────────────────────┤
│ Policy engine: autorización, allowlist, redacción      │
├────────────────────────────────────────────────────────┤
│ Tool registry: read-only, prepare, active               │
├────────────────────────────────────────────────────────┤
│ Model router: local primary + optional explicit backup  │
├────────────────────────────────────────────────────────┤
│ Runtime adapters: Ollama, WSL2/Kali, filesystem, voice │
└────────────────────────────────────────────────────────┘
```

Cada capa tendrá una responsabilidad única. El modelo no accederá directamente al shell, al filesystem o a la red: solicitará una herramienta y el motor de políticas decidirá si se puede ejecutar.

## 3. Roles de modelos

No se debe elegir un modelo “mágico” para todas las tareas.

| Rol | Candidato inicial | Función |
|---|---|---|
| Conversación y razonamiento | Qwen3 8B/14B, según hardware | diálogo, explicación, planificación |
| Código | Qwen3-Coder o equivalente local | escribir, revisar y refactorizar |
| Tareas rápidas | modelo pequeño compatible con Ollama | clasificación, routing, extracción |
| Embeddings | nomic-embed-text o BGE-M3 | memoria y búsqueda local |
| Visión futura | modelo vision local compatible | capturas, diagramas y UI |

La lista es una hipótesis inicial. Antes de fijar un modelo se medirá latencia, RAM/VRAM, calidad en español, tool calling, licencia y estabilidad con el equipo real.

### Proveedores

1. **Primario:** Ollama local, sin coste por petición y sin enviar datos fuera del equipo.
2. **Opcional:** endpoint OpenAI-compatible elegido por el usuario, desactivado por defecto.
3. **Nunca implícito:** la aplicación debe indicar qué modelo y proveedor procesará cada contexto.

## 4. Contexto por workspace

El asistente solo recibirá el contexto necesario:

- nombre y descripción del workspace;
- autorización y scope vigente;
- exclusiones;
- archivos seleccionados;
- salida seleccionada de terminal;
- evidencias seleccionadas;
- documentación activa;
- estado de los jobs.

No se enviará automáticamente todo el disco, todo el historial ni todas las credenciales. Cada elemento contextual tendrá origen visible y opción de quitarlo.

## 5. Memoria

La memoria se divide en:

- **sesión:** conversación actual;
- **workspace:** decisiones, notas y contexto del proyecto;
- **estudio:** apuntes y preferencias de aprendizaje;
- **global mínima:** preferencias de UI y voz.

La memoria debe ser:

- local;
- consultable;
- editable;
- exportable;
- borrable;
- separada por workspace;
- redactada antes de indexarse.

## 6. Herramientas y niveles de consentimiento

### Nivel A — lectura segura

No modifica sistemas ni genera tráfico activo:

- leer archivo seleccionado;
- explicar una salida;
- buscar en documentación local;
- resumir una evidencia;
- revisar código.

### Nivel B — preparación

Genera artefactos locales, pero no actúa contra un objetivo:

- crear un script en un workspace;
- preparar una request en modo draft;
- generar un informe;
- construir un plan de pruebas;
- preparar comandos para revisión.

### Nivel C — ejecución controlada

Puede tocar runtime, red o datos autorizados:

- ejecutar una herramienta en Kali;
- realizar una petición activa;
- lanzar un job;
- guardar o modificar datos del engagement.

Siempre exige:

- scope válido;
- política compatible;
- previsualización de la acción;
- confirmación humana;
- registro de usuario, timestamp, herramienta y resultado;
- cancelación disponible cuando sea posible.

### Nivel D — prohibido por defecto

- saltarse autenticación o bloqueos;
- ocultar tráfico;
- atacar objetivos no autorizados;
- exfiltrar datos;
- ejecutar acciones destructivas sin procedimiento explícito;
- usar credenciales fuera del workspace aprobado.

## 7. Personalidad y presencia

La personalidad debe ser natural sin fingir conciencia ni inventar resultados:

- tono claro, directo y colaborativo;
- español como idioma preferido, inglés técnico cuando ayude;
- explica por qué propone una acción;
- reconoce incertidumbre;
- separa hechos, hipótesis y recomendaciones;
- no usa entusiasmo artificial en incidentes graves;
- puede tener nombre configurable, pero la marca del producto será **knkLinux Assistant**.

Estados del avatar:

```text
IDLE → LISTENING → THINKING → PREPARING → WAITING_APPROVAL
                                      ↓
                                  EXECUTING → DONE / ALERT
```

## 8. Voz local

### Primera implementación

- captura push-to-talk desde la aplicación;
- STT local con `whisper.cpp` o `faster-whisper`;
- texto visible antes de enviarlo al modelo;
- TTS local con la continuación mantenida de Piper (`OHF-Voice/piper1-gpl`);
- botón de interrupción inmediata;
- opción “solo texto”.

No se habilitará escucha permanente en la primera versión. La privacidad y el control deben preceder al efecto “Jarvis”.

## 9. Referencias de diseño

Se pueden estudiar proyectos como Pentest Copilot por sus ideas de:

- integración con un attack box;
- registro de herramientas;
- workspaces;
- browser/Burp adapters;
- consentimiento y comandos peligrosos;
- proveedores de modelos intercambiables.

knkLinux no debe copiar su modelo de ejecución autónoma sin adaptarlo a nuestro principio de scope explícito, modo local-first y aprobación humana.

## 10. Contrato de una acción

Toda herramienta deberá recibir y devolver un objeto estructurado similar a:

```json
{
  "tool": "terminal.exec",
  "workspaceId": "ws_demo",
  "authorizationId": "auth_demo",
  "mode": "dry-run",
  "command": "nmap --version",
  "targets": [],
  "reason": "verificar disponibilidad local",
  "requiresApproval": false
}
```

La respuesta debe distinguir:

```json
{
  "status": "completed",
  "executed": true,
  "stdout": "...",
  "stderr": "",
  "evidenceIds": [],
  "auditEventId": "evt_demo"
}
```

Nunca se debe representar como `completed` una acción que solamente fue propuesta o bloqueada.

## 11. Métricas de calidad

- tiempo hasta primera respuesta;
- tiempo hasta transcripción;
- porcentaje de tool calls correctamente clasificados;
- bloqueos correctos fuera de scope;
- falsos estados de ejecución: objetivo cero;
- porcentaje de acciones con evidencia y audit event;
- tasa de alucinación en respuestas de estudio y código;
- satisfacción del usuario tras tareas reales;
- consumo de RAM/VRAM y latencia local.

## 12. Roadmap de implementación

1. **Contrato y simulador:** tipos de contexto, tools, approval y audit event; sin red real.
2. **Asistente de lectura:** chat local con contexto seleccionado y memoria editable.
3. **Preparación:** generación de código, comandos y reportes en sandbox.
4. **Runtime:** conexión con WSL2/Kali mediante adaptador y health checks.
5. **Ejecución aprobada:** jobs cancelables con scope gate.
6. **Voz y avatar:** STT/TTS local y estados visuales.
7. **Desktop shell:** Tauri, instalador, hotkey y ventana flotante.
8. **CLI Linux:** reutilización de contratos y almacenamiento exportable.

## 13. Criterio de no desviación

Si una implementación hace que el modelo pueda ejecutar más cosas pero reduce trazabilidad, scope enforcement o capacidad de detenerlo, no es una mejora para knkLinux.
