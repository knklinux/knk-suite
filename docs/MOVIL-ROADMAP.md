# Móvil — roadmap hacia la oferta (Metrica: Android+iOS, APIs, informes)

Estado: cero tooling móvil (ni en Windows ni verificado en Kali). Ruta por fases.

## Fase 0 — Fundamento estático (esta semana, ~4h)

1. **Kali viva**: arrancar la existente; instalar `apktool`, `jadx`, `adb`, `frida-tools`
   (`pip install frida-tools objection`), `MobSF` vía docker
   (`docker run -p 8000:8000 opensecurity/mobile-security-framework-msf`).
2. **Checklist OWASP MASVS**: volcarla a `docs/` como guía (categorías V1-V8).
3. Primer APK objetivo: app propia de un programa con mobile-scope (Adobe:
   Acrobat Reader/Scan tienen plan de pruebas VIP — leerlo primero).

## Fase 1 — Dinámico (siguiente)

- Frida: bypass SSL-pinning en APK propia + hooks de crypto/storage.
- `adb backup` + análisis de almacenamiento (tokens, PII en claro).
- Deep links / exported activities (`drozer` o `adb dumpsys package`).

## Fase 2 — Suite (cuando haya flujo)

- Módulo `mobile-hub`: subir APK → cola de análisis (MobSF API) → hallazgos
  como findings con `origin: mobfs` + checklist MASVS por app.
- Plantilla de informe móvil (permisos, superficie, hallazgos, retest).

## Reglas

- Solo APKs propias o con autorización del programa (nunca apps de terceros).
- Sin root/jailbreak para reportes (OOS en casi todos los programas).
- Secretos OAuth móviles sin impacto = OOS (aprenderlo de memoria).
