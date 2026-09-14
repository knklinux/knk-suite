# knkLinux — Referencias para IA local y pentest

## Referencias revisadas

### Pentest Copilot

Repositorio: `bugbasesecurity/pentest-copilot`  
Licencia indicada por el proyecto: MIT.

Ideas útiles para estudiar:

- conexión con una máquina Kali;
- registro de herramientas;
- integración con Burp y navegador;
- workspaces;
- proveedores de modelos intercambiables;
- consentimiento para comandos peligrosos;
- modo Docker y modo developer.

No se adopta automáticamente su ejecución autónoma. En knkLinux, la autorización y el scope deben ser requisitos previos a cualquier actividad activa.

### whisper.cpp

Repositorio mantenido bajo `ggml-org/whisper.cpp`.

Aporta una implementación local de Whisper en C/C++ con soporte de CPU, GPU y Windows, además de VAD. Es una opción adecuada para una primera capa STT offline si la latencia y el tamaño del modelo son aceptables en el equipo del usuario.

### Piper

El repositorio original de Rhasspy indica que el desarrollo se ha trasladado a `OHF-Voice/piper1-gpl`. Debemos revisar licencia, voces disponibles y redistribución antes de incluir binarios o voces en un instalador.

### Ollama

Se utilizará inicialmente como runtime local y endpoint compatible para desacoplar el asistente del frontend. Los modelos se seleccionarán después de medir el hardware real, no por nombre o benchmark aislado.

## Criterios de selección

1. privacidad y funcionamiento local;
2. licencia compatible con uso privado y futura redistribución;
3. calidad en español;
4. tool calling estable;
5. consumo de RAM/VRAM;
6. latencia interactiva;
7. posibilidad de cambiar de modelo sin cambiar la UX;
8. facilidad para borrar y exportar datos.

## Decisión provisional

- Runtime LLM: Ollama.
- Modelo conversacional inicial: Qwen3 en un tamaño ajustado al hardware.
- Modelo de código: Qwen3-Coder o alternativa comparable tras benchmark local.
- Embeddings: nomic-embed-text o BGE-M3.
- STT: whisper.cpp como primera opción.
- TTS: Piper mantenido por OHF-Voice, sujeto a revisión de licencia.
- Desktop: Tauri 2.
- Runtime de seguridad: WSL2/Kali.

## Qué no se hará todavía

- descargar modelos pesados sin conocer RAM/VRAM;
- instalar herramientas globalmente en el host;
- habilitar micrófono permanente;
- conectar el modelo directamente al shell;
- ejecutar pentesting autónomo contra objetivos reales;
- distribuir binarios o voces sin revisar sus licencias.
