# 🔒 Cross-check CLLMSE ↔ Operación Zendesk/OpenAI (2026-09-08)

> Fuente: `CLLMSE_Manual_ES.txt` (Ética y Uso Responsable; Dominios 1, 2.6, 4, 5, 7, 9;
> Apéndice C). Objeto: verificar que la fase 1 de Zendesk y el plan H1/H2/E16-remarco
> cumplen el manual y las políticas del programa antes de seguir.

## 1. Reglas de ética del manual ↔ nuestra operación

| Regla del manual | Nuestra operación | Veredicto |
|---|---|---|
| "Solo sistemas tuyos o con autorización escrita explícita" | La autorización escrita ES el brief del programa Bugcrowd (target: `https://{subdominio}.zendesk.com/`); todo el test va contra **nuestra instancia propia** `autonomo-49965` | ✅ |
| "Reporta por canales adecuados, no explotación pública" | Único canal: submissions Bugcrowd. Nada público sin aprobación escrita del vendor (lección Teringette ya adoptada como restricción permanente) | ✅ |
| "Bug bounty = crowdsourcing continuo sobre superficie grande y estable" (§2.6) | Exactamente la actividad que hacemos — es el canal legítimo previsto para esto, no un parche | ✅ |
| Inyección indirecta (§1.2): "el usuario víctima no hizo nada malo" | En nuestro PoC la "víctima" es **nuestra propia cuenta** en **nuestro propio agente**; el ticket envenenado lo escribimos nosotros desde nuestra segunda instancia | ✅ |
| Envenenamiento (§1.7 / OWASP guía): "si afecta a otros usuarios, permiso explícito primero" | El contenido envenenado vive SOLO en la knowledge base de nuestro tenant; cero efecto sobre otros tenants de Zendesk | ✅ |
| LLM10/ataques de disponibilidad (§1.6): no tocarlos | Ningún vector nuestro fuerza consumo o volumen; ~33 peticiones planeadas totales, pacing 3s | ✅ |
| Anti-abuso: no evadir controles | Documentado desde el primer día (OpenAI flag); el manual tampoco lo contempla como técnica legítima | ✅ |
| RGPD/PII (§4.4-4.5): datos personales de terceros | Cero PII de terceros: todo sintético (`SYNTHETIC-*`, tickets propios). V13 redacta cualquier PII incidental antes de escribirla a logs (§5.5 cumplido por diseño) | ✅ |

## 2. Checklist de bolsillo Apéndice C aplicado a NOSOTROS como researchers

| Ítem | Estado |
|---|---|
| Uso previsto y fuera de alcance documentado (Mapear) | ✅ `ZENDESK-RECON-BRIEF` + `ZENDESK-MAPEO-KIT-VECTORES` + fase 0/1 |
| Cadena payload → respuesta → impacto en cada vector | ✅ plantilla de informe + criterios pre-committed por carpeta `reportes/` |
| Dominio de pruebas propio para exfil (canary) | ✅ canario local `:8210` — el "token canario" del Dominio 5.4 aplicado a nuestro propio PoC |
| Baselineado conductual / monitorización pasiva | ✅ V13 escanea todo el tráfico y la evidencia capturada (verificado limpio hoy) |
| PII redactada antes de logs | ✅ redactor integrado en v13-detector |
| Tokens/credenciales: solo propias | ✅ sesiones A/B y cookies del trial son nuestras; ningún credencial de terceros |
| Riesgo residual documentado | ✅ triaje como registro vivo; bloqueadores con propietario y siguiente paso |

## 3. Riesgos de cumplimiento que SÍ exigen vigilancia (verde con condiciones)

1. **Infraestructura compartida**: nuestra instancia corre en producción de Zendesk.
   El manual prohíbe DoS; el programa limita volumen. Condición: mantener el
   volumen mínimo (los ~6 req del handshake, N=5 del E16) y pacing ≥3s — ya así.
2. **CDN `*.zdassets.com` fuera del scope explícito**: el manual (y la política
   del programa) exigen no tocar lo no autorizado. Condición YA activa: cero
   peticiones dirigidas a la CDN; solo la carga natural de assets del widget en
   una visita real. La pregunta de scope al panel sigue pendiente de publicar.
3. **Segunda instancia trial (A/B)**: registrada con el mismo email ninja y
   datos sintéticos — sin datos reales de clientes en ninguna instancia.
4. **Widget en localhost**: la página visitante es nuestra, con nuestra key —
   no es evasión de ningún control (la restricción de dominio del widget, si
   existiera, se respetaría como hallazgo, no como obstáculo).

## 4. Lo que el manual añade y no habíamos registrado

- **§2.5(4) "No ejecutarlo una sola vez"**: cadencia recurrente — nuestro plan de
  ventanas V2/V3/V4 y el bucle cola→informe ya lo implementa para OpenAI;
  replicarlo en Zendesk cuando arranque el test activo (re-run tras fixes del vendor).
- **§7.4 aislamiento de canal**: nuestra plantilla de informe del E16-remarco
  pedirá explícitamente la separación estructural instrucciones↔datos como
  remediación — coincidencia directa con la solución esperada por el vendor.
- **§5.6 respuesta a incidentes**: si V13 dispara en Zendesk (bleed cross-tenant),
  el protocolo ya está: congelar, capturar raw+screenshots, cero reintentos —
  idéntico al aprendido del caso Teringette.

## Veredicto global

**EN SCOPE Y EN POLÍTICA** — 8/8 reglas de ética del manual cumplidas, checklist
Apéndice C verde, 4 condiciones de vigilancia ya implementadas (volumen, CDN,
datos sintéticos, sin evasión). Ningún ajuste necesario para continuar con la
fase 1: completar el wizard de Messaging y relanzar el handshake.
