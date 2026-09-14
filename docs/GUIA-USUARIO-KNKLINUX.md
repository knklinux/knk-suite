# knkLinux — Guía de usuario

## Arrancar

```bash
# Aplicación de escritorio (recomendado)
cd knk-suite/desktop && npm start

# Solo web local
cd knk-suite && npm start        → http://127.0.0.1:8086
```

## Módulos

| Módulo | Qué hace |
|---|---|
| 📊 Panel | Resumen: target, OPPLAN, hallazgos, conectividad |
| 🎯 Targets | Fijar objetivo, scope, User-Agent, límite de ritmo |
| 📋 OPPLAN | Plan de la sesión y aprobación |
| 🚀 Pipeline | Fases PLAN→RECON→SCAN→FUZZ→EXPLOIT→REPORTE→VERIFICAR |
| ⚙️ Trabajos | Lanzar scripts/comandos async, ver salida, cancelar |
| 🖥️ Terminal | xterm real. Kali WSL2 si está instalado; si no, shell del host (aviso honesto) |
| ✅ Compuertas | Validación de cadenas CORS/IDOR/SSRF/XSS antes de enviar nada |
| 📝 Reportes | Informes de la sesión |
| 📜 Cumplimiento | Políticas y checklist |
| 🤖 KNK Assistant | El copiloto: chat, código, pentest, estudio, voz, memoria |
| 💬 Chat LLM | Chat simple sin router |
| 📚 Bóveda | Buscar y mantener el cerebro de conocimiento |
| 🔁 Revocación A/B | Laboratorio de revocación |

## KNK Assistant

- **Modos:** Auto (clasifica solo), 💬 Chat, ⌨️ Código, 🎯 Pentest, 🎓 Estudio.
- **Cerebro:** activado por defecto; busca en tu bóveda y cita fuentes `📚 [1]…`.
- **Voz:** botón 🔊 (TTS del navegador). ⏹ para parar.
- **Memoria:** 🧠 recordar guarda la última respuesta como nota del proyecto; el asistente la usa en futuras conversaciones.
- **Política pentest:** solo laboratorios/objetivos autorizados; no genera evasión ni automatización contra terceros.

## Gestionar modelos (Ollama)

```bash
curl http://127.0.0.1:8086/api/models/installed      # instalados
curl http://127.0.0.1:8086/api/models/catalog        # catálogo recomendado
curl -X POST http://127.0.0.1:8086/api/models/pull \
     -H 'Content-Type: application/json' \
     -d '{"model":"qwen2.5-coder:7b"}'               # descarga con progreso
curl http://127.0.0.1:8086/api/models/pulls          # ver progreso
curl -X POST http://127.0.0.1:8086/api/models/routes \
     -H 'Content-Type: application/json' \
     -d '{"code":"qwen2.5-coder:7b","chat":"hermes3:latest"}'
```

## Alimentar el cerebro

Añade notas `.md` a `vault-knklinux/` (o a tu bóveda de Downloads — ambas se indexan).
El índice se refresca solo (~15 s) o pulsa ↻ Reindexar en la pestaña Bóveda.
Regla: nada de secretos ni tokens en las notas.

## Verificación rápida

```bash
npm test                # 41 tests del núcleo
node backend/test-uat.js # 17 pruebas de aceptación end-to-end
curl http://127.0.0.1:8086/api/health
```

## Problemas frecuentes

| Síntoma | Solución |
|---|---|
| Terminal dice "Shell local del host" | Kali no instalado: `wsl --install -d kali-linux` y reinicia |
| Asistente "Ollama no responde" | Arranca Ollama / `ollama serve` |
| Bóveda vacía en búsqueda | Espera 15 s o pulsa Reindexar |
| Puerto 8086 ocupado | `KNK_PORT=8087 npm start` |
