# AGENTS.md — knkLinux (este repositorio: knk-suite)

## Regla principal del proyecto

**Antes de hacer cualquier cambio, lee:**

1. `docs/MASTER-PLAN-KNKLINUX.md` — visión consolidada, mejoras por área, fases.
2. `docs/KNKLINUX-PRODUCT-CHARTER.md` — visión, límites no negociables, criterios de "producto terminado".
3. `docs/HOJA-RUTA-DESKTOP-KNKLINUX.md` — fase actual y antipatrones prohibidos.
4. `docs/ARQUITECTURA-ASISTENTE-KNKLINUX.md` — diseño del asistente, consentimiento, voz.

## Qué es knkLinux

Una **aplicación de escritorio completa** (objetivo: Tauri 2) para pentesting autorizado,
laboratorios y estudio, con:

- asistente IA local omnipresente (panel + ventana flotante + voz + avatar), no una pestaña suelta;
- terminal con Kali real aislado (WSL2 primero), nunca fallback silencioso al host;
- hub visual azul/cian/violeta con estética de terminal (rojo solo para alertas);
- workspaces, scope, evidencias con hash, findings y reports como núcleo;
- CLI Linux como fase posterior reutilizando los mismos contratos.

## No hacer (antipatrones registrados)

- Crear scripts duplicados para el mismo flujo; extiende el módulo existente.
- Derivar estados de documentos históricos; los estados vienen de health checks.
- Ejecutar jobs largos dentro de una request HTTP síncrona.
- CORS `*` o backend sin autenticación local.
- Declarar Kali/herramientas disponibles sin verificación real.
- Acciones del modelo sin scope válido + aprobación humana + registro.
- Tocar targets de terceros sin autorización explícita; nada de automatizar paneles ajenos.
- Añadir funciones nuevas sin cerrar primero la deuda que bloquea su verificación.

## Antes de cada tarea, responde

1. ¿Qué problema de producto resuelve?
2. ¿A qué módulo y fase pertenece?
3. ¿Qué estado real debe mostrar?
4. ¿Qué autorización necesita?
5. ¿Cómo se prueba sin efectos innecesarios?
6. ¿Qué queda fuera de esta iteración?

## Estado operativo heredado

- Los scripts de `backend/` raíz incluyen operación histórica de bug bounty (OpenAI,
  Zendesk, Cloudflare). Ese código es material de origen: no borrar sin inventario, pero
  el producto nuevo vive en módulos, no en scripts sueltos.
- OpenAI: flag anti-abuso activo; V6 preparada (`backend/v6-sep10.sh`).
- E13 (Bugcrowd b8370246): seguimiento 12–14 sep.
- Docker no disponible; WSL2 disponible; Ollama instalado.
