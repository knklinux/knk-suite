# 🎯 Zendesk — Recon del brief y protocolo de cuenta trial (2026-09-07)

> Fuente: página pública del engagement leída íntegra vía CDP 9340
> (`evidencia-poc/http/zendesk-engagement-publico.txt`, 17.602 chars — la
> lectura del brief NO requiere login en Bugcrowd). Estado del recon: brief
> ✅ completo · cuenta trial ⏳ pendiente de registro (acción del usuario) ·
> surface-map del agente IA ⏳ tras el trial.

---

## 1) Veredicto del recon: el programa es REAL y mejor de lo esperado

| Dato del panel | Valor |
|---|---|
| Métrica de validación | **75% de submissions aceptadas/rechazadas en ≤4 días** (últimos 3 meses) |
| Pago medio (3 meses) | **$1.569,64** |
| Vulnerabilities rewarded | 61 |
| Targets in-scope | 2 de 4 (rating) |
| **Zendesk AI** | ✅ **In scope — target propio con tabla de recompensas dedicada** |

### Tabla de recompensas del target **Zendesk AI** (el que nos interesa)

| Prioridad | Recompensa |
|---|---|
| P1 | **$5.000 – $50.000** |
| P2 | $2.000 – $4.000 |
| P3 | $750 – $1.500 |
| P4 | $500 |

(Comparar: P1 de OpenAI Security es hasta $20k… y aquí $50k para el AI target.
La media del programa con 61 rewards pagadas valida que no es un cementerio.)

## 2) Superficie AI IN-SCOPE (textual del brief)

- **AI Agents & Advanced AI Agents** (el agente autónomo de soporte)
- **AI Agent Builder**
- **Copilot** (el copiloto del agente humano)
- **App Builder**

## 3) Fuera de scope (muy explícito — respetar al pie de letra)

- ⛔ **AI Ticket Summary y AI Intelligence Triage** (features "low-agency"):
  completamente out para prompt injection/jailbreak/alignment.
- ⛔ Pure alignment quirks: personas no autorizadas, saltarse filtros de
  estilo, "sin secondary system exploit" → N/A.
- ⛔ UI/UX: solo texto incorrecto en la propia pantalla del researcher → N/A.
- ⛔ Zendesk Front End: self-XSS, HTML injection vía `<a>`, headers ausentes
  (HSTS/CSP), malware attachments.

## 4) Vectores válidos que el brief lista (¡nos validan la metodología!)

El brief pide explícitamente — casi literalmente nuestro kit:
1. **Indirect & exploitable prompt injection** (nested, Base64, HTML, datos de terceros → acciones no permitidas, borrar datos, revelar secretos del backend)
2. **Action & automation abuse** (macros en background, actualizar tickets no autorizados, webhooks no autenticados, chain de prompts para escalar)
3. **Cross-Tenant Data Leakage & multitenancy flaws** ← nuestro flujo A/B natural
4. **Privilege escalation & broken auth vía la interfaz AI** (el agente ejecuta un tool/API que el token de sesión no debería alcanzar)
5. **RAG poisoning vía conectores externos** (persistente, afectando a otros)
6. **Response data leakage** (API keys/credenciales internas en el output) ← V13 detecta esto
7. Data pipeline/training exploits (membership inference, etc.)

**Conclusión: los 3 huecos OWASP + E16 + V13 trasladan 1:1 a este target.**

## 5) Reglas de acceso — protocolo EXACTO de cuenta trial (del brief)

> "All research must be conducted using your own Zendesk instance… When asked
> for an email, provide your **@bugcrowdninja.com** email. When asked for your
> company name, use **bb-\<bugcrowd-username\>**."

| Campo | Valor a usar |
|---|---|
| Email | **knklinux@bugcrowdninja.com** (el alias ninja del panel; confirmar en settings del perfil) |
| Company name | **bb-knk_Linux** |
| Instancia resultante | `bb-knk-linux.zendesk.com` (o como lo normalice Zendesk) |
| Instancias extra | `bb-knk_Linux-01`, `-02`… (para el flujo A/B multi-tenant) |

⚠️ Regla crítica del brief: **todo el testing dentro de TU instancia propia.**
El cross-tenant se demuestra entre TU instancia y recursos públicos/otros
targets del programa, nunca atacando instancias de terceros reales.

## 6) Plan de surface-map del agente IA (tras crear el trial)

1. **Login al admin center** de `bb-knk-*.zendesk.com` → activar AI Agents /
   Copilot si el trial lo incluye (si alguna feature requiere pago →
   documentarlo y testear solo lo disponible en trial; no comprar).
2. **Recon de bundles** (mismo método que OpenAI): descargar los JS del admin
   y del widget público, extraer rutas `/api/…`, `conversation_id`,
   `session_key`, nombres de tools del agente.
3. **Superficie esperada a mapear**:
   - Endpoint del chat del AI Agent (widget público `*.zendesk.com` + SDK web)
   - Endpoints de admin del Agent Builder (cambios de instrucciones = nuestro
     "gizmo" equivalente)
   - API del Copilot (contexto que lee de tickets → inyección indirecta vía
     ticket del "cliente" = nuestro E16)
4. **Primeros tests pasivos** (0 riesgo): estructura de tokens, ids de sesión
   del widget, permisos de API sin auth, V13 activo en toda respuesta.
5. **Anti-duplicados día 1**: known-issues del target Zendesk AI (requiere
   login — el usuario ya tiene la pestaña; leerla en la misma sesión del panel).

## 7) Pendientes inmediatos

| # | Acción | Quién |
|---|---|---|
| 1 | Registrar trial en zendesk.com con email ninja + company `bb-knk_Linux` | Usuario (5 min) — el registro pide verificación de email |
| 2 | Decir "listo" con la instancia creada | Usuario |
| 3 | Lanzar surface-map (bundles admin + widget) vía CDP 9340 | Suite |
| 4 | Leer known-issues del target Zendesk AI con la sesión del panel | Suite (con login ya en la ventana) |

## 8) Estado real del trial (2026-09-07 noche) — ACCIÓN DEL USUARIO PENDIENTE

Verificado por CDP 9340:
- `bb-knk-linux.zendesk.com` y `bb-knkl-linux.zendesk.com` → "Centro de
  ayuda cerrado" (el subdominio normalizado NO coincide con ninguna instancia
  viva; el dashboard de signup también redirige geográficamente a zendesk.es)
- El formulario de registro real está en `zendesk.com/register` con campos:
  owner.email, FirstName, LastName, account.name (company), address.phone

Posibles causas: (a) el trial se registró con un subdominio distinto al
esperado (Zendesk normaliza bb-knk_Linux de formas no obvias), (b) el registro
se inició pero no se completó la verificación de email, (c) aún no se registró.

**Lo que necesito del usuario:** el nombre EXACTO del subdominio de la
instancia (aparece en el email de bienvenida de Zendesk y en la URL del admin
al entrar — formato `https://{subdominio}.zendesk.com/agent/`). Con ese dato
el surface-map arranca en 2 minutos.

## 9) Estado del trial (respuesta del usuario): PENDIENTE DE VERIFICAR EMAIL

El usuario confirmó que Zendesk pidió verificación de email antes de dar
acceso. Al verificarla, Zendesk normalmente pide crear/confirmar el subdominio
en ese paso — anotar el EXACTO que aparezca.

Flujo pendiente:
1. Usuario: abrir el email de Zendesk → click en verificar → completar el
   paso de subdominio si lo pide (usar `bbknklinux` o el que sugiera)
2. Usuario: pegar el subdominio exacto
3. Suite: surface-map (bundles admin + widget) vía CDP 9340, login de sesión
   del navegador de evidencias, sin peticiones autenticadas hasta mapear

## 10) Known-issues del target Zendesk AI — BLOQUEADO POR LOGIN (2026-09-07 noche)

Verificado por CDP: la sesión de Bugcrowd NO persistió en el perfil
zendesk-recon (la ventana está en la página de login de
login.hackers.bugcrowd.com). Sin sesión, la página del engagement solo
expone 2 links (política de divulgación de Zendesk + términos estándar de
Bugcrowd) — el listado de Known Issues del target Zendesk AI vive detrás
del login (igual que en OpenAI).

Pendiente del usuario (dijo "más tarde"): loguearse en la ventana CDP 9340
(perfil zendesk-recon) → relanzar zendesk-recon.js → sección 3 del informe
extraerá el listado. Recordatorio de la guía §8: este check es OBLIGATORIO
antes del primer test activo contra la instancia, y también es el momento
de leer las public disclosures del programa para el anti-duplicado.
