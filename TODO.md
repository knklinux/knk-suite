# KnkSuite v2 — TODO / Roadmap
# ======================

## ✅ Done (v2.0)
- [x] Backend Express 1 puerto (:8086)
- [x] Pipeline 7 fases: PLAN → RECON → SCAN → FUZZ → EXPLOIT → REPORTE → VERIFICAR
- [x] GUI web SPA (dashboard, OPPLAN, pipeline, compuertas, reportes, chat LLM)
- [x] Docker Kali con herramientas de pentest
- [x] Ollama integrado (hermes3 + fallback)
- [x] User-Agent personalizable por programa
- [x] Scope enforcement en todas las peticiones
- [x] Rate limit configurable por programa
- [x] Reportes con requisitos estrictos de evidencia (screenshots + curl + PoC)
- [x] Verificador triager con checks reales
- [x] Acceso directo .desktop
- [x] Evidencia guardada en ~/.knk-suite/evidencia/

## ✅ Done (v2.1 — Metodología de lógica de negocio, 30/8)
- [x] `backend/lib/bizlogic.js` — metodología: 8 clases de bugs (precio, cupón, reembolso, reward, acceso, transfer, race, registro) + playbook de 6 pasos + `claseParaSuperficie()`
- [x] `backend/lib/bizrace.js` — helper de race conditions (ronda acotada/espaciada, `analizarRonda` doble-aplicación vs dedup, `probarRace`)
- [x] Compuerta `bizChain` (8 gates: flujo real → baseline → campo confiado → servidor acepta → impacto → sin transacción real → reproducible → scope)
- [x] Regla automática por tipo en `exigirPorTipo` (gates.js): bugType de negocio → exige biz-g3 (servidor aceptó) + biz-g4 (impacto) o BLOQUEA en open-triage
- [x] Endpoint `POST /api/biz/race` (index.js) — exige confirmación humana, scope/OPPLAN y logea finding BIZ-RACE si detecta doble-aplicación
- [x] Frontend Reportes.jsx — campos biz (flujoMapeado/baseline/campoConfiado/servidorAcepta/impacto/sinTransaccionReal) con progreso en la checklist
- [x] Frontend Gates.jsx — tarjeta 🧮 Lógica de negocio
- [x] Fase EXPLOIT del pipeline devuelve metodología (playbook + 8 clases + bizRace)
- [x] `docs/metodologia-logica-negocio.md` — metodología completa documentada
- [x] Guardrail del LLM para borradores (`/api/reports/draft-llm`): si el tipo es de negocio inyecta `GUARDRAIL_BORRADOR` (bizlogic) — el borrador nace con la cadena bizChain marcada y NO genera reporte sin impacto demostrable
- [x] Verificado: smoke test compuerta (pasante/fallante), race mock (doble-aplicación vs idempotente), E2E open-triage bloquea sin impacto, draft-llm con guardrail biz (borrador honesto, sin inventar)

## ✅ Done (v2.1 — Checklist del alta de cuenta de test, 30/8)
- [x] `backend/lib/alta.js` — checklist del alta con decisión automatizada por barrera KYC/IP-cap: `decision()` bloquea si `exigeKYC`, `ipCaptured`, falta `emailTest` o `evadirControles`; `altaChain()` añade los gates del ciclo completo (email de test → login → `/account` 200 → dos cuentas A/B → vía real del target)
- [x] Expuesto en `gates.js` (`altaChain`/`altaDecision`/`altaFases`) y en `POST /api/gates/validate` con `type=alta` (server.js + index.js)
- [x] Verificado en vivo: KYC/IP-cap/falta-email/evadir-controles → `sendable:false` bloqueado por barrera; alta completa con email test + login + account200 + dos cuentas → `sendable:true`

## ✅ Done (v2.1 — Fase A NFT + harness de lógica de negocio, 1/9)
- [x] Fase A de `crypto.com/nft` (MITM): superficie real sin login = `crypto.com/nft-api/graphql` (GraphQL del marketplace). 12 operaciones anónimas capturadas (37 requests), todas 200, catálogo público por diseño. Introspection deshabilitada (sin schema leak). Filtros `ownerId/creatorId/assetOwnerId` probados → **ignorados** en el resolver público (conjuntos idénticos al baseline, sin enumeración de datos ajenos). **Sin hallazgo → cerrado como `CERRADO-NOREPORTABLE`** (F-17 en sesión, evidencia en `docs/bugbounty/NFT-FASE-A-2026-09-01.md` + `evidencia-nft/`)
- [x] **Harness NFT** `docs/moneybox-sesion/probar-nft-biz.mjs` — estado **listo, pendiente de cuenta**: 9 mutaciones reales del bundle (`createCheckout`, `createShoppingCartCheckout`, `createListing`, `createAuctionListing`, `placeBid`, `createOffer`, `acceptOffer`, `cancelListing`, `cancelOffer`), Fase 0.5 de verificación de sesión con 7 queries de cuenta reales (`getMyWallets`, `accountBalanceQuery`, `GetUserPrivateAssetsTotal`, `GetMyCollectedAssets`, `GetUserOwnedCollections`, `GetUserTransfers`, `GetMyLikedAssets` — verificadas: sin sesión → `UNAUTHORIZED`), cortafuegos de cobro activo (bloquea `CreateAndCaptureAccountPayment` y 5 más, verificado en vivo)
- [x] Lección #6 en `docs/metodologia-logica-negocio.md`: **los enums GraphQL del bundle son strings de UI, NO el schema real** — `kind=BUY_NOW` → `400 BAD_USER_INPUT` (no existe en `CheckoutKind`); la introspection está deshabilitada; capturar el valor real con sesión, no fiarse del bundle. Regla **`nr-6`** automatizada en `noReportables()` (bizlogic.js): 400 de enum sin aceptación fuera de contrato **no abre compuerta**
- [x] Fix de persistencia de sesión: `save(file, session)` se llamaba sin la sesión → TypeError silencioso → false (perdía cierres/notas en `~/.knk-suite/session.json`). Corregido `registrar-cierres.cjs` + blindado `lib/session.js` (ahora LANZA error si falta la sesión; logs el error de escritura). Reconciliados los 4 cierres en JSON (F-14..F-17)
- [x] Fase A de `price-api.crypto.com` (crypto.com/price): bundle del SPA mapeado (50 chunks, 13 endpoints públicos + detalle `meta/v1/token/{id}` con 33 campos). 3 vectores probados sin hallazgo — (1) slug-enum en `token-price/{slug}`: lookup estricto case-sensitive, id numérico no resuelve; (2) `all-coin-launches`: solo name/symbol/id/icon, sin info no publicada; (3) `meta/v2/all-tokens` (30.632 tokens) + detalle por id: sin visibility oculta, sin datos diferenciales. Autenticado bien protegido (401). **Sin hallazgo → cerrado** (F-18, `PRICE-API-FASE-A-2026-09-01.md`). **→ la superficie sin login del programa crypto.com queda AGOTADA**
- [x] Decisión de targets (og.com / web.crypto.com → Not Eligible, cerrados; crypto.com/price → mapeado F-18). Documentado en `docs/bugbounty/DECISION-TARGETS-2026-09-01.md`
- [x] Limpieza: 44 temporales de sondeos cerrados (Newegg/onramp) eliminados; 18 `_*` vivos conservados + 6 activos críticos
- [x] **Informe de sesión completo del 1/9**: `docs/bugbounty/INFORME-SESION-2026-09-01.md` (8 secciones: circuito, Fase A NFT, harness, lección #6/nr-6, fix persistencia, decisión targets, limpieza, hallazgos) — referencia del día

## 🔜 TODO

### OpenAI / Bugcrowd (revisión 2026-09-05)
- [ ] Verificar identidad de Bugcrowd y confirmar que el botón de envío está habilitado.
- [ ] Confirmar cuenta propia de test y login operativo; guardar solo evidencia mínima y saneada.
- [ ] Releer el Brief y announcements en la sesión actual; no confiar solo en el resumen local.
- [x] Aparcar el recon `blog.openai.com` como observación DNS: no es takeover reportable sin claimability/impacto demostrados.
- [x] Auditar reportabilidad OpenAI: no hay hallazgos enviables; vector 1 queda como observación DNS y vector 2 no tiene evidencia de modelo (`docs/bugbounty/OPENAI-HALLAZGOS-REPORTABILIDAD-2026-09-05.md`).
- [x] Revisar recon y priorizar lógica de negocio: authz A/B, modelos privados, invitaciones/roles, recursos compartidos, pagos y Codex (`docs/bugbounty/OPENAI-RECON-VECTORES-LOGICA-2026-09-05.md`).
- [ ] No crear ni enviar un reporte OpenAI hasta tener duplicados, política aplicable, PoC reproducible e impacto real.

### Crypto.com / cuentas de test
- [ ] Capturar sesión en experiences.crypto.com → ejecutar `probar-checkout-manipulacion.mjs` (ya listo: Fase A GET-only + Fase B 2 rondas con PERMITIR_MUTACIONES=1; cortafuegos de cobro siempre activos; genera evidencia-lineitems/ con raw HTTP y evidencia.json con la cadena biz marcada) para cerrar biz-g1/g3/g4/g6
- [ ] Sesión de cuenta en crypto.com/nft → ejecutar `probar-nft-biz.mjs` (**estado: listo, pendiente de cuenta**): `PERMITIR_MUTACIONES=1 NFT_CFG=docs/moneybox-sesion/nft-checkout-cfg.json node docs/moneybox-sesion/probar-nft-biz.mjs` — detecta sesión (Fase 0.5), corrige el `kind` real del enum `CheckoutKind` (lección #6), y monta escenarios biz (biz-precio createCheckout quantity, biz-subasta placeBid bajo mínimo, biz-oferta amountDecimal=0, biz-listing priceDecimal, biz-transfer) sin tocar nunca el cobro
- [ ] Sesión para `coin-price-sse-auth.crypto.com/api/*` (charts SSE en tiempo real) — única vía biz restante de crypto.com/price (biz-acceso sobre streams), pendiente de cuenta
- [x] **Superficie sin login del programa crypto.com AGOTADA** (experiences→login, travel/tax/tickets/merchant/js/nft/price→mapeados, mona/nadex/og/web→descartados, exchange→mapeado). Siguiente paso operativo: desbloquear cuenta de test o redirigir el circuito MITM a otro programa con guest flow.
- [ ] Integración con HackerOne/Bugcrowd API (subir reporte tras pasar la compuerta)

- [x] Soporte para capturas automáticas mediante navegador real/CDP; no se añadió Puppeteer/Playwright.
- [ ] Export a PDF del reporte
- [ ] Modo headless para CI/CD
- [ ] Notificaciones desktop en hallazgos críticos
- [ ] Múltiples sesiones simultáneas
- [ ] Dashboards de métricas de caza (tiempo por hallazgo, tasa de duplicados)
