# knkLinux — Product Charter

**Estado:** propuesta base para el desarrollo iterativo  
**Fecha:** 2026-09-09  
**Propietario:** proyecto privado knkLinux

## 1. Visión

knkLinux será una **aplicación de escritorio completa para Windows**, orientada a pentesting autorizado, laboratorios y estudio de seguridad. No será un conjunto de pestañas web ni una terminal decorada: será un centro de trabajo local en el que el usuario pueda investigar, ejecutar tareas aprobadas, analizar resultados, escribir código, preparar informes y conversar con un asistente de IA contextual.

La futura versión para Linux será un **CLI/terminal companion** con la misma identidad visual y el mismo modelo de workspace. El escritorio y el CLI compartirán contratos, almacenamiento exportable y políticas, pero no dependerán de una interfaz web abierta en `localhost` como producto final.

## 2. Frase de producto

> **knkLinux — tu centro de operaciones privado para aprender, investigar y probar seguridad de forma controlada.**

## 3. Qué debe sentirse al usarlo

- Moderno y vivo, inspirado en un centro de operaciones técnico: negro profundo, azul eléctrico, cian y violeta; rojo reservado para alertas, bloqueos y acciones de riesgo.
- Rápido y directo: la información importante aparece en el workspace, no escondida en menús planos.
- Personal: el asistente tiene presencia visual, voz configurable y una personalidad profesional, cálida y natural.
- Controlable: la IA propone; el usuario aprueba las acciones que pueden tocar red, archivos, credenciales o datos.
- Honesto: ningún estado se presenta como activo si no se ha comprobado realmente.
- Privado por defecto: modelos locales y datos locales siempre que sea posible.

## 4. Límites no negociables

1. Solo se probarán objetivos propios, laboratorios o engagements con autorización explícita.
2. El sistema no saltará bloqueos, controles antiabuso, autenticación ni restricciones de terceros.
3. No habrá ejecución autónoma ilimitada contra Internet.
4. Toda acción activa requiere un scope aprobado y, cuando proceda, confirmación humana.
5. Los secretos no se enviarán al modelo ni se guardarán en evidencias sin redacción.
6. La IA no podrá ocultar comandos, peticiones, resultados ni cambios de estado.
7. El modo laboratorio y el modo engagement estarán separados.
8. El usuario podrá detener la ejecución y desactivar voz, avatar y herramientas inmediatamente.

## 5. Experiencia principal

### 5.1 Hub

El hub será una sala de operaciones visual, no un menú lateral estático. Mostrará:

- workspace actual;
- autorización y scope;
- salud del runtime Kali;
- trabajos activos y recientes;
- hallazgos pendientes de revisión;
- actividad del asistente;
- alertas y bloqueos;
- accesos rápidos a módulos.

Cada módulo se presentará como una estación con icono, estado, actividad y contexto. La imagen de referencia del centro de operaciones se usará como inspiración ambiental, con overlays para conservar legibilidad y accesibilidad.

### 5.2 Asistente

El asistente será omnipresente, pero no intrusivo:

- panel lateral persistente;
- ventana flotante invocable desde cualquier módulo;
- atajo global configurable;
- entrada de texto y push-to-talk;
- transcripción visible;
- avatar con estados: listo, escuchando, pensando, preparando, esperando aprobación, ejecutando y alerta;
- lectura contextual limitada al workspace actual;
- historial y memoria editables por el usuario.

Podrá conversar de forma natural, explicar conceptos, ayudarte a estudiar, escribir y revisar código, resumir terminales, convertir notas en informes y preparar planes de prueba autorizados. No fingirá haber ejecutado algo: diferenciará siempre entre **propuesta**, **ejecución** y **resultado verificado**.

### 5.3 Terminal

La terminal visible será xterm.js o equivalente, pero el proceso se ejecutará en un runtime aislado de Kali mediante un adaptador explícito. El host de Windows no será el fallback silencioso.

Estados mínimos:

- `RUNTIME_NOT_INSTALLED`;
- `RUNTIME_STARTING`;
- `RUNTIME_READY`;
- `RUNTIME_DEGRADED`;
- `RUNTIME_STOPPED`.

La terminal deberá mostrar el runtime, distribución, workspace, usuario y política activa antes de ejecutar comandos.

## 6. Módulos del producto

1. **Hub:** visión general y actividad.
2. **Workspaces:** proyectos, contexto, configuración y backups.
3. **Targets:** objetivos, autorización, alcance y exclusiones.
4. **Recon:** inventario y observación pasiva/activa controlada.
5. **Pipeline:** trabajos asíncronos, progreso, cancelación y aprobaciones.
6. **Terminal:** Kali aislado y sesiones persistentes.
7. **Evidence:** capturas, requests, respuestas, hashes y timeline.
8. **Findings:** triage, deduplicación, severidad y estado.
9. **Reports:** informes reproducibles en Markdown/HTML/PDF.
10. **Assistant:** conversación, código, estudio y acciones propuestas.
11. **Study:** CLLMSE, OWASP, notas y laboratorios offline.
12. **Compliance:** scope gate, privacidad, retención y auditoría.
13. **Settings:** modelos, voz, permisos, runtime y apariencia.

## 7. Criterios de producto terminado

knkLinux no se considerará producto completo hasta que:

- se instale y desinstale como aplicación de escritorio;
- arranque sin terminal CMD visible;
- tenga una única fuente de verdad para estados y trabajos;
- muestre health checks reales del backend, runtime e IA;
- ejecute trabajos asíncronos cancelables;
- mantenga un workspace aislado por proyecto;
- bloquee objetivos fuera de scope antes de generar tráfico;
- registre acciones y decisiones del asistente;
- requiera aprobación humana para acciones activas o destructivas;
- permita exportar y borrar datos del proyecto;
- funcione sin nube usando un modelo local compatible;
- tenga un camino documentado para el CLI Linux;
- pase tests unitarios, integración, smoke y una revisión manual de UI.

## 8. Orden de construcción

### Fase 0 — Consolidación

- inventario de módulos;
- eliminación de scripts muertos;
- unificación de contratos y estados;
- separación de código de producto y scripts históricos;
- documentación de decisiones.

### Fase 1 — Núcleo de escritorio

- shell Tauri;
- backend local gestionado por la aplicación;
- almacenamiento y workspaces;
- autenticación local y permisos;
- health checks y logging estructurado.

### Fase 2 — Runtime Kali

- adaptador WSL2 primero;
- soporte Docker como alternativa;
- detección de herramientas;
- terminal persistente;
- aislamiento y política de comandos.

### Fase 3 — Asistente contextual

- router de modelos;
- contexto por workspace;
- memoria local con redacción;
- tool registry con schemas;
- aprobación humana y auditoría.

### Fase 4 — Voz y presencia

- STT local;
- TTS local;
- ventana flotante;
- hotkey y push-to-talk;
- avatar y estados de actividad.

### Fase 5 — CLI Linux

- comandos equivalentes a workspaces, jobs, evidence y assistant;
- salida terminal con estética knkLinux;
- configuración compartida exportable;
- operación íntegra sin GUI.

## 9. Regla de trabajo para futuras sesiones

Antes de tocar código, se releerá este charter y se responderá:

1. ¿Qué problema de producto resolvemos?
2. ¿A qué módulo pertenece?
3. ¿Qué estado real debe mostrar?
4. ¿Qué autorización necesita?
5. ¿Cómo se prueba sin tráfico o cambios innecesarios?
6. ¿Qué queda fuera de esta iteración?

Si una tarea no mejora la experiencia, la fiabilidad, la privacidad o la seguridad del workbench, se aparca.
