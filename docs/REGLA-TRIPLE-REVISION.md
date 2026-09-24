# REGLA DE CIERRE DE CAZA — triple revisión obligatoria

Propuesta por el operador (2026-09-24). Toda caza se cierra con 3 pasadas
documentadas en el hallazgo de cierre. Sin las 3, la caza NO está cerrada.

## Pasada 1 — Cobertura (¿probamos todo lo que dijimos?)

- [ ] Cada vector listado en el plan tiene veredicto (positivo/negativo/error).
- [ ] Los errores (timeout, 502, scope-block) se reintentaron o se explican.
- [ ] Lo aparcado queda con motivo + condición de reapertura.

## Pasada 2 — Módulos (¿cada módulo hizo sus comprobaciones?)

Ejecutar `node backend/hunt-verify.js` (salida OK/FAIL por módulo):

- [ ] dashboard/stats responde con actividad.
- [ ] presets listan y el scope de sesión es el declarado.
- [ ] recon: doh/crtsh/wayback/securitytxt/spfdmarc responden (o fallback con fuente).
- [ ] repeater/send llega al target (scope-gate verificado: OOS bloquea, in-scope pasa).
- [ ] params/hunt + wordlists accesibles.
- [ ] intruder acepta runs (o se documenta por qué no).
- [ ] proxy status legible; findings/triage escriben y leen.
- [ ] cookie-jar: inventario sin valores; import-firefox documentado si se usó.
- [ ] assistant/stream responde con datos reales (spot-check).

## Pasada 3 — Huecos (¿qué NO miramos?)

- [ ] Superficie vista en tráfico real (DevTools) no cubierta por la suite.
- [ ] Endpoints descubiertos a medias (paths adivinados 404 =/= verificados).
- [ ] Cuentas/sesiones usadas y su estado (¿siguen vivas? ¿se limpió?).
- [ ] Residuos en cuentas ajenas/propias (ficheros, shares, jobs) y su limpieza.
- [ ] Egresos: ¿algún WAF nos marcó? (timeouts/403 repentinos = parar, no insistir).

## Registro

El hallazgo de cierre lleva `pasadas: 3` en details + lista de pendientes con
dueño (suite/operador) y condición de reapertura.
