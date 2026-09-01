================================================================================
  KNK SUITE v2.1
  Bug bounty + threat hunting pipeline — todo en uno
================================================================================

  URL → OPPLAN → RECON → SCAN → FUZZ → EXPLOIT → REPORTE → VERIFICAR
  + módulos defensivos: CTI, runbooks, assets, purple team, engagement

KnkSuite es una plataforma local que orquesta un pipeline completo de bug
bounty y caza de amenazas: recon pasivo, escaneo, lógica de negocio, playbook
de explotación manual, compuertas de validación y generación de informes —
todo con un modelo de autorización estricto (fail-closed) y sin telemetría.

  - Backend : Node.js + Express + SQLite (better-sqlite3)
  - Frontend: React (dashboard, pipeline, terminal embebida, OPPLAN)
  - Kali    : contenedor Docker Kali con 24 herramientas de la metodología
  - LLM     : mentor local vía Ollama con fallback a API remota opcional
  - Datos   : 100% locales (SQLite + archivos de evidencia), nada sale de tu
              máquina salvo el tráfico autorizado contra tu objetivo.

--------------------------------------------------------------------------------
1. CARACTERÍSTICAS
--------------------------------------------------------------------------------

  RECON / SUPERFICIE
    - Subdominios (subfinder vía Kali + crt.sh de respaldo)
    - URLs históricas (Wayback), tecnologías y stack detectado
    - Dorks, emails y footprint de activos

  ESCANEO
    - Headers de seguridad, CORS, CVEs (NVD)
    - Nuclei y ffuf disponibles en el contenedor Kali

  EXPLOTACIÓN GUIADA
    - Playbook de explotación manual en 6 fases (SURFACE → HUNT → BIZLOGIC
      → SECRETS → CAMERAS → EVIDENCE) basado en las metodologías públicas
      de bug bounty (recon + API + GraphQL + JS analysis)
    - Módulo de lógica de negocio: 8 categorías (~35 tests concretos):
      precio/valor, race conditions, saltos de flujo, cupones/referidos,
      auth/privilegios, estado de objetos, tiers y uploads
    - Cámaras IP (RTSP/ONVIF) solo si están en scope del programa
    - Vault de cuentas de prueba A/B (cifrado local)

  VALIDACIÓN (COMPUERTAS)
    - Cadenas de verificación por tipo de hallazgo (CORS, IDOR, SSRF, XSS,
      subdomain, bizlogic, cámaras) antes de permitir el reporte

  REPORTE
    - Borrador estructurado por programa, checklist de triage, exportación
      HTML/PDF, diff de versiones y verificación "como triager"

  DEFENSIVO / THREAT HUNTING
    - Análisis de logs: IoCs, anomalías, fuerza bruta, MITRE ATT&CK
    - Ingesta CTI (texto, CSV, STIX), runbooks de respuesta a incidentes
    - Inventario de assets (CMDB local) y purple team (hallazgo → Sigma)
    - Informe de engagement profesional (deliverable de pentest)

--------------------------------------------------------------------------------
2. SEGURIDAD POR DISEÑO
--------------------------------------------------------------------------------

  - AUTORIZACIÓN OBLIGATORIA: el OPPLAN (Operation Plan) es un requisito
    previo. Sin plan aprobado + autorización escrita + target dentro del
    scope, el pipeline NO ejecuta nada (fail-closed).
  - SCOPE ESTRICTO: toda petición se valida contra el scope configurado.
    Wildcards (*.dominio) solo cubren subdominios; hosts exactos solo el
    host. Fuera de scope = bloqueado.
  - PROTECCIÓN SSRF: los servicios de confianza (parser de programas, recon
    pasivo) están en allowlist y siempre pasan por validación de IP pública.
    Direcciones privadas (127.0.0.0/8, 169.254.169.254, metadata cloud...)
    bloqueadas siempre.
  - RATE LIMIT Y STEALTH: retardos mínimos configurables, modo stealth por
    defecto, fuzz masivo desactivado salvo autorización explícita.
  - SERVICIOS LOCALES: servidor y puentes escuchan solo en 127.0.0.1.
  - CLAVES: variables de entorno o archivo local con permisos restringidos;
    nunca se suben al repositorio (.gitignore cubre .env y *.db).

--------------------------------------------------------------------------------
3. REQUISITOS
--------------------------------------------------------------------------------

  - Node.js 18+ (probado en 22)
  - Python 3 (opcional: puente/módulos auxiliares)
  - Docker (opcional: contenedor Kali con las herramientas de la metodología)
  - Ollama (opcional: mentor local; modelos 3B-4B recomendados en portátiles)

--------------------------------------------------------------------------------
4. INSTALACIÓN Y ARRANQUE
--------------------------------------------------------------------------------

  git clone <repo> && cd knk-suite
  npm install          # compila better-sqlite3 + descarga Chromium (puppeteer)
  npm test             # suite de tests unitarios
  npm run smoke        # smoke del servidor
  npm run build        # compila el frontend React
  npm start            # http://127.0.0.1:8086

  Kali embebido (opcional):
  docker build -f docker/kali.Dockerfile -t knk-kali .
  docker run -d --name knk-kali knk-kali

--------------------------------------------------------------------------------
5. FLUJO DE USO
--------------------------------------------------------------------------------

  1. Configura tu programa:
       node backend/onboard.js --name "Programa" \
         --target app.example.com --scope-file scope.txt
     (o pega el scope desde el Dashboard / autoscope de YesWeHack)

  2. Revisa el scope parseado contra la página del programa y marca la
     autorización en la pestaña OPPLAN (tras leer la política).

  3. Valida en seco:
       node backend/headless.js --check

  4. Ejecuta el pipeline desde la UI (o por API):
       POST /api/pipeline/full

     Las fases FUZZ/EXPLOIT requieren revisión humana: el pipeline entrega
     el playbook y la guía de lógica de negocio; la explotación es tuya.

  5. Valida el hallazgo con las compuertas, genera el reporte y verifícalo
     antes de enviarlo al programa.

--------------------------------------------------------------------------------
6. ESTRUCTURA
--------------------------------------------------------------------------------

  backend/
    index.js            Servidor Express + WebSocket + API completa
    db.js               SQLite (sesión, hallazgos, reportes, evidencia)
    headless.js         Modo CI/CD: --check | --dry-run | --export-report
    onboard.js          Configuración de programa (scope, OPPLAN)
    lib/
      net.js            Núcleo: scope, SSRF, rate limit, allowlist
      pipeline.js       Orquestador de 7 fases
      opplan.js         Operation Plan (autorización)
      recon.js scanner.js fuzzer.js dorks.js   Colectores
      bizlogic.js       Lógica de negocio (metodología de writeups)
      playbook.js       Playbook de explotación manual
      cameras.js        Cámaras IP (RTSP/ONVIF, solo in-scope)
      gates.js          Compuertas de validación por tipo
      report.js verifier.js hackerone.js       Reporte y checklist
      hunt.js           Threat hunting (IoCs, anomalías, MITRE)
      cti.js runbooks.js assets.js purpleteam.js engagement.js  Roadmap
      llm.js            Mentor LLM (Ollama + fallback remoto)
      docker.js         Ejecución de herramientas en Kali (allowlist)
      accounts.js       Vault de cuentas A/B
  frontend/             React (Dashboard, OPPLAN, Pipeline, Terminal, Hunt)
  docker/               Dockerfile Kali + herramientas de la metodología
  data/                 Directorio curado de programas candidatos

--------------------------------------------------------------------------------
7. TESTS
--------------------------------------------------------------------------------

  npm test              # unitarios (scope, compuertas, parsers, módulos)
  npm run smoke         # smoke del servidor + endpoints
  node backend/test-live.js   # verificación en vivo módulo por módulo
                              # (servicios públicos, tráfico inofensivo)

--------------------------------------------------------------------------------
8. CONTRIBUIR
--------------------------------------------------------------------------------

  Issues y PRs bienvenidos. Antes de enviar un PR:
    - npm test y npm run build en verde
    - sin secretos: ejecuta el escaneo de patrones (ghp_, sk-*, AKIA, ...)
    - documenta el cambio en el CHANGELOG si aplica

--------------------------------------------------------------------------------
9. AVISO LEGAL / USO ÉTICO
--------------------------------------------------------------------------------

  KnkSuite solo debe usarse contra objetivos que te AUTORIZAN expresamente
  (programas de bug bounty, engagement de pentest, laboratorios propios).
  El modelo fail-closed existe para eso: la herramienta bloquea lo que no
  está autorizado, pero la responsabilidad final de respetar el scope, las
  reglas de participación (RoE) y la legislación aplicable es del operador.
  Sin autorización escrita: no ejecutes.

--------------------------------------------------------------------------------
10. LICENCIA
--------------------------------------------------------------------------------

  MIT (consulta el archivo LICENSE del repositorio).
  Uso educativo y de investigación responsable.
================================================================================
