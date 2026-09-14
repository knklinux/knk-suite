#!/usr/bin/env bash
# lanza-bidi.sh — Firefox con WebDriver BiDi en 9344 usando el perfil real (Perfil 1).
# Claves descubiertas:
#   - La flag correcta para BiDi es --remote-debugging-port (NO -start-debugger-server,
#     que arranca el protocolo RDP antiguo y rompe el WebSocket).
#   - El perfil debe tener en user.js: devtools.debugger.remote-enabled,
#     devtools.chrome.enabled, devtools.debugger.prompt-connection=false.
#   - PowerShell Start-Process con -ArgumentList separado para que no bloquee el shell.
powershell -NoProfile -Command "Start-Process 'C:\Program Files\Mozilla Firefox\firefox.exe' -ArgumentList '-no-remote','-profile','\"C:\Users\knkli\AppData\Roaming\Mozilla\Firefox\Profiles\gyHn9kye.Perfil 1\"','--remote-debugging-port','9344','--remote-allow-origins=*','about:blank' -WindowStyle Minimized"
