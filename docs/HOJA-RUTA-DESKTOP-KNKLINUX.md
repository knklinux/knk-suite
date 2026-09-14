# knkLinux — Hoja de ruta de producto

## Punto de partida real

La base actual es un workbench React + backend Node con módulos históricos de operación, evidencia, reportes, terminal, compliance y asistentes. Es una base útil para prototipar, pero no debe crecer añadiendo botones indefinidamente. El trabajo anterior mostró varios riesgos: estados derivados de documentos, runtime antiguo escuchando, scripts duplicados y dependencia de Docker no disponible.

## Decisiones de dirección

- El dashboard web local queda como **prototipo de transición**.
- El producto objetivo será **Tauri 2 + React**.
- El backend se convertirá en un servicio local gestionado por la app.
- WSL2/Kali será el primer runtime de terminal en Windows.
- Ollama será el primer proveedor local de modelos.
- La red y los jobs estarán detrás de scope gates y approvals.
- El CLI Linux reutilizará contratos y almacenamiento, no una copia visual improvisada.

## Fases

### Fase A — Baseline reproducible

**Salida:** cualquiera puede arrancar la versión actual y saber qué está funcionando.

- fijar una sola raíz de proyecto;
- un único comando de desarrollo;
- health endpoint real;
- estado de cada módulo desde una fuente de verdad;
- smoke tests de frontend/backend;
- inventario de deuda y scripts históricos.

### Fase B — Núcleo de aplicación

**Salida:** una aplicación local con workspaces y jobs fiables.

- `Workspace` como entidad principal;
- `Job` asíncrono, cancelable y persistente;
- `Evidence` con hash y origen;
- `Finding` con estado y trazabilidad;
- API local autenticada;
- logs estructurados;
- manejo correcto de errores.

### Fase C — Desktop shell

**Salida:** instalador Windows con icono, ventana y actualizaciones controladas.

- Tauri;
- arranque del backend gestionado;
- cierre limpio;
- deep links internos;
- bandeja del sistema opcional;
- ventana flotante del asistente;
- configuración local.

### Fase D — Kali runtime

**Salida:** terminal real, aislada y visible.

- detección WSL2;
- instalación guiada, nunca silenciosa;
- ejecución `wsl.exe` con distribución seleccionada;
- workspace montado explícitamente;
- inventario de herramientas;
- límites de proceso, tiempo y red;
- Docker/VirtualBox como adaptadores posteriores.

### Fase E — Assistant core

**Salida:** asistente útil incluso sin acciones activas.

- chat local;
- contexto por workspace;
- modelo router;
- revisión y escritura de código;
- memoria editable;
- generación de informes;
- tool registry y approvals.

### Fase F — Voz y presencia

**Salida:** asistente con voz, avatar y ventana persistente.

- push-to-talk;
- STT local;
- TTS local;
- interrupción;
- estados de avatar;
- preferencias de voz;
- accesibilidad y modo texto.

### Fase G — CLI Linux

**Salida:** companion profesional en terminal.

```text
knk workspace list
knk target scope show
knk job plan
knk evidence list
knk assistant ask
knk report build
```

El CLI debe reutilizar las mismas políticas y contratos. No tendrá una vía para evitar las protecciones de la aplicación de escritorio.

## Definition of Done por fase

Cada fase debe incluir:

- diseño breve antes del código;
- tests automatizados;
- prueba manual del flujo principal;
- documentación de instalación y recuperación;
- registro de riesgos pendientes;
- evidencia de qué se verificó realmente;
- no introducir credenciales ni datos reales en fixtures.

## Antipatrones que no repetiremos

- crear varios scripts para el mismo flujo;
- derivar estados de texto histórico;
- usar `CORS: *` en el servidor local;
- arrancar jobs largos dentro de una request HTTP síncrona;
- declarar Kali disponible si solo existe una terminal fallback;
- habilitar acciones del modelo sin aprobación;
- mezclar targets de bug bounty con laboratorios propios;
- perseguir estética antes de disponer de health checks fiables;
- copiar tokens de sesión o automatizar paneles de terceros;
- añadir funciones sin eliminar primero la deuda que bloquea su verificación.

## Primera entrega recomendada

La siguiente implementación debe ser pequeña y demostrable:

1. crear tipos/contratos para `Workspace`, `Scope`, `Job`, `Evidence` y `AssistantAction`;
2. añadir un runtime status real, sin fingir disponibilidad;
3. cambiar el hub para que muestre estados procedentes de esos contratos;
4. añadir un panel del asistente en modo lectura/preparación;
5. probar generación de código y reportes sin tráfico de red;
6. dejar WSL2 como integración explícita posterior.
