# KNK Suite — TODO / Roadmap

> Canónico desde v4.2.2. El histórico de la era v2 quedó en git (commit `1c3d009`).

## ✅ Estado actual (v4.2.2)

- Backend Express :8086 + React/Vite + shell Tauri 2 (NSIS/MSI/AppImage/deb + portable)
- Auth por token con cookie `knk_token` + `/bootstrap` de primer arranque
- Cámaras: públicas (keyless), expuestas (auditoría), relay LAN, HLS con proxy same-origin
- Repeater (HTTP manual) + Intruder (fuzzing pequeño, caps duros, payloads del usuario)
- Guardianes: secret-check (pre-commit+CI), gitleaks, repo-hygiene, smoke-deb, boot-test del portable
- CI con tests de módulos (cámaras, tor, auth-gate, intruder)

## 🔜 Próximo

- [ ] Instaladores generados por CI (job Windows portable + adjuntar a release)
- [ ] Unificar runtime Node (24 Windows / 22 Linux → 22 LTS en ambos)
- [ ] Serialport/puppeteer: instalar de verdad o quitar los requires lazy de flipper/screenshot
- [ ] Sincronizar versión en src-tauri/Cargo.toml (sigue en 4.0.0; no afecta builds)
- [ ] Fase fuzz del pipeline: integrarla con el Intruder (caps compartidos)
- [ ] Informes: export DOCX/PDF del engagement

## 🧹 Limpiezas hechas

- [x] 2026-09-15: 12 módulos huérfanos de la era v2.1 eliminados (1.411 líneas)
- [x] 2026-09-15: `lab:revocation` roto eliminado de scripts
- [x] 2026-09-15: IP real redactada de docs/privacidad-seguridad.md
