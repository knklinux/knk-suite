# INFORME DE ENGAGEMENT — RED TEAM

**Referencia:** `RT-{{YYYY}}-{{MM}}-{{DD}}-{{SEQ}}` · **Cliente:** knk-suite / programa HackerOne({{PROGRAMA}})
**Encuadre:** {{EVALUACIÓN}} · **Estado:** {{ESTADO}} · **Fecha:** {{FECHA}}

> Documento de equipo (planificador → recon → exploit → verificador) para reproducción interna y
> auditoría de decisiones. **Ningún dato inventado**: cada hallazgo deriva de evidencia capturada
> (JSONL MITM, respuestas HTTP, CT/DNS, bundles). Llenar SOLO con datos reales del engagement.

---

## 1. Alcance y reglas de enfrentamiento (RoE)

| Ítem | Decisión |
|---|---|
| Programa(s) y scope | {{PROGRAMAS}} |
| Tier válidos | {{TIERS — solo Eligible; marcar Not Eligible como marginados}} |
| Superficie/activos (lista corta) | {{ASSETS}} |
| Clases objetivo | {{CLASES: biz-precio, biz-cupon, biz-transfer, biz-race, biz-moneda, biz-envio, biz-idflujo, ...}} |
| Reglas duras (RoE) | No completar transacciones reales · no tocar fondos/datos de terceros · no fuzzing masivo · sin DoS · sin actividad fuera de scope · sin evadir controles (WAF/CAPTCHA) |
| Egreso | Solo peticiones ligeras vía box (Kali/Tor) o el tráfico real del navegador a través de MITM |
| Autorización / Safe Harbor | {{SÍ/NO — pegar referencia a la policy del programa}} |

> RoE obligatorio: si un alto exige KYC, forzar contra Cloudflare, o tocar datos ajenos → **no se hace**.
> Se marca `bloqueadoPor{{X}}` y se pasa a otro objetivo.

## 2. Decisión de encuadre (filtro anti-rechazo)

Aplicar `NO_REPORTABLES` (knk-suite) a TODO candidato **antes** de redactar:
**"¿impacto en plataforma / otra cuenta / dinero?"** Si no, se archiva, no se reporta.

Checklist de encuadre:
- [ ] Tier del asset es Eligible/reward (leído del scope, no de memoria).
- [ ] El endpoint sirve el RECURSO real (no 5xx, login-gated, ni WAF 403).
- [ ] No es dashboard/monitoring interno (Kibana/Sentry/Grafana) sin acceso real.
- [ ] El flujo se mapeó (no se adivinaron rutas/payloads).

## 3. Fase de recon (pasivo: CT + DNS + bundles servidos)

### {{ASSET 1}}
- {{HALLAZGOS/DESCARTES con evidencia}}

### {{ASSET 2}}
- {{...}}

**Conclusión de recon:** {{accesible/no accesible unauthenticated — y por qué (login, WAF, SPA-embebible, tier)}}

## 4. Fase de exploit — matriz de hipótesis y resultado

| Hipótesis | Target | Técnica | Resultado (evidencia capturada) |
|---|---|---|---|
| {{H1}} | {{endpoint}} | {{técnica}} | {{resultado + evidencia concreta + gate que falla (biz-g3/g4, cors-g0b...)}} |
| {{H2}} | {{endpoint}} | {{técnica}} | {{resultado}} |
| ... | | | |

**Decisión por fila:** cerró cadena / archivable como observación / no aplicable / bloqueadoPor{{KYC|CF|scope}}.

Veredicto de fase: {{¿alguna hipótesis cerró la compuerta? Si no, por qué — guest incompleto, falta cuenta, WAF...}}

## 5. Verificación / postura de integridad

- {{Equipo validado (MITM/túnel/addon, flujos descifrados), estados restaurados (carrito/sesiones)}}
- {{Nada completado ni tocado fuera de RoE; no se violó política.}}

## 6. Recomendaciones (equipo)

1. {{siguiente paso concreto — p.ej. conseguir cuenta/partner sin KYC para cerrar gates}}
2. {{...}}
3. {{re-aplicar catálogo + NO_REPORTABLES antes de triage}}

## 7. Veredicto ejecutivo

{{¿hubo vuln reportable? Qué SÍ dejó el engagement (infra, superficie mapeada, vectores descartados con evidencia, decisión honesta de no inflar hallazgos)}}

*Firmado: equipo red team knk — recon, exploit, verificador.*

---

## Cómo usar esta plantilla

1. Copia a `docs/bugbounty/ENGAGEMENT-<target>-<fecha>.md` y reemplaza `{{...}}`.
2. **RoE (sec 1)**: pega la referencia de la policy del programa. Si no hay autorización escrita, no se ejecuta.
3. **Matriz (sec 4)**: una fila por hipótesis; el Resultado SIEMPRE lleva el gate de la compuerta que cae
   (`biz-g3`/`biz-g4`, `cors-g0b`, `idor-g3`) — es lo que evita un reporte de "sondeo sin impacto".
4. **Veredicto (sec 7)**: honesto. "No hubo hallazgo pero la infra quedó lista" es un resultado válido.
5. Registra el engagement en la suite (nota + ficha JSON si se usa automatización).