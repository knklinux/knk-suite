# Cloudflare — Guía de cuenta + recon

> Fecha: 2026-09-09
> Target: Cloudflare (HackerOne)
> Superficie: AI Playground, Workers AI, AI Gateway, MCP Servers
> Bounty: Hasta $20,000+

---

## 1. Crear cuenta (tú, manual)

1. Abre Firefox (donde ya tienes BiDi activo)
2. Ve a **https://dash.cloudflare.com/sign-up**
3. Regístrate con un email real (puedes usar el mismo de Zendesk/OpenAI)
4. Completa verificación de email
5. En el onboarding, selecciona **"I'm building something"** / **"For work"**
6. **NO compres ningún plan** — el tier gratuito incluye Workers AI (10K requests/día)
7. Cuando estés en el dashboard, dime **"listo"**

## 2. Activar Workers AI (gratis)

En el dashboard:
1. Left sidebar → **AI** → **Workers AI**
2. Si pide activar, click **"Enable Workers AI"** (gratis, sin tarjeta)
3. Ve a **AI** → **Playground** — prueba un prompt para verificar que funciona
4. Ve a **AI** → **Gateway** — verify que carga (puede estar vacío, eso es OK)

## 3. Lanzar recon

Cuando estés logueado y en el dashboard, ejecuto yo:

```bash
cd knk-suite && node backend/cloudflare-recon.js
```

**Qué hace automáticamente:**
1. Verifica login (si no estás, te avisa y para)
2. Extrae account_id + email + zonas
3. Navega a AI Playground, AI Gateway, Workers, MCP
4. Captura screenshots + HTML de cada sección
5. Mapea endpoints AI del JS del dashboard
6. Guarda todo en `evidencia-poc/http/cloudflare-recon/`

## 4. Después del recon

Con los datos del recon, adapto:
- **E16** (inyección indirecta) → AI Playground
- **E17** (SSRF) → Workers AI API
- **V13** (cross-tenant) → AI Gateway
- **H1** (IDOR) → API tokens / account boundaries

---

## NOTA: Por qué Cloudflare sobre Zendesk

| Aspecto | Zendesk | Cloudflare |
|---|---|---|
| AI Agent funcional | ❌ Trial sin agent | ✅ Workers AI + Gateway gratis |
| Scope IA explícito | ❌ Genérico | ✅ "AI Agent, MCP, Prompt Injection" |
| Bounty potencial | Desconocido | Hasta $20,000+ |
| Competencia | N/A | Media (técnico, no saturado) |
| Superficie OWASP | Limitada | LLM01, LLM02, LLM05, LLM06, LLM08 |
