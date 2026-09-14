# Identidad visual — knkLinux

## Nombre de producto

- Nombre visible: **knkLinux**
- Descriptor: **Security Workbench**
- Mensaje: Linux, privacidad, libertad, aprendizaje y seguridad autorizada.

## Referencia visual

La imagen de referencia está incorporada como hero del hub en:

- `frontend/public/knklinux-hub.png`

La imagen se usa como ambientación del centro de operaciones, con una capa oscura para conservar contraste y legibilidad. No se utiliza como fondo global de todas las pantallas.

## Paleta

- Azul profundo: fondo y paneles.
- Cian eléctrico: acciones principales, terminal, estados activos.
- Violeta neón: marca, avatar y acentos.
- Verde: estado correcto/activo.
- Rojo: alertas, bloqueos y acciones peligrosas.

## Componentes de marca

- `frontend/public/knk-suite-icon.svg`: favicon.
- `assets/knklinux.ico`: icono nativo del acceso directo de Windows.
- `frontend/src/components/Dashboard.jsx`: hero visual y tarjeta del asistente.
- `frontend/src/index.css`: sistema visual neon cyberpunk.
- `frontend/index.html`: título y metadatos del producto.

## Próxima evolución del asistente

El avatar mostrado en el hub es actualmente una representación de estado, no un agente autónomo. La evolución prevista es:

1. memoria contextual por proyecto;
2. panel persistente del asistente;
3. confirmación humana antes de herramientas;
4. push-to-talk;
5. STT/TTS local;
6. avatar con estados idle/listening/thinking/speaking/blocked.

La estética puede ser intensa y hacker, pero la suite debe seguir mostrando autorización, scope, rate limit y trazabilidad de cada acción.
