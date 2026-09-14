import React, { useState } from 'react';

/**
 * CheatSheet — 🎯 Guía manual, condensada a fichas operativas.
 * Fuente de verdad: docs/GUIA-BUG-BOUNTY-MANUAL.md (esto es la vista operativa).
 * Los comandos se copian al portapapeles y, si App pasa onSendToTerminal,
 * se insertan directamente en la terminal Kali de la pestaña Terminal.
 */

const SECTIONS = [
  {
    id: 'reglas',
    emoji: '🛡️',
    title: 'Reglas de oro',
    source: 'GUIA-BUG-BOUNTY-MANUAL.md §2',
    intro: 'Sin esto no se empieza. Un dominio fuera de scope = reporte cerrado + posible ban.',
    checklist: [
      'Scope in/out copiado de la plataforma — no de memoria',
      'Cuenta de test A y B (casi todo lo que paga necesita dos identidades)',
      'IP limpia verificada: recon pasivo por Tor, activo por tu IP real',
      'Rate limit humano + UA del programa en cada petición',
      'Nada de datos reales de terceros en el PoC',
      'Sin fuzz masivo ni escáneres pesados sin autorización explícita',
    ],
  },
  {
    id: 'flujo',
    emoji: '🧭',
    title: 'El flujo manual',
    source: 'GUIA-BUG-BOUNTY-MANUAL.md §3',
    intro: 'APERTURA → RECON MANUAL → MAPEO DE SUPERFICIE → TESTEO → VERIFICACIÓN → REPORTE',
    phases: [
      {
        num: 'F0',
        title: 'Apertura (15-20 min, una vez)',
        done: 'Terminado cuando: petición legítima al target sin dudar de la autorización',
        steps: [
          'Scope in/out copiado de la plataforma',
          'UA del programa anotado (p. ej. MiAlias-Bugbounty)',
          'Cuenta de test A creada; B si el programa lo permite',
          'IP limpia verificada',
          'Programa registrado en la suite con scope y UA',
        ],
      },
      {
        num: 'F1',
        title: 'Recon manual (pasivo → activo)',
        done: 'Terminado cuando: subdominios, stack y endpoints API anotados',
        steps: [
          'Pasivo primero (no toca el target): crt.sh, wayback, dorks',
          'Activo ya con autorización: fingerprint, puertos, headers',
        ],
        cmds: [
          { label: 'subfinder (subdominios)', cmd: 'subfinder -d TARGET -silent' },
          { label: 'amass pasivo', cmd: 'amass enum -passive -d TARGET' },
          { label: 'crt.sh (certs → subdominios)', cmd: 'curl -s "https://crt.sh/?q=%.TARGET&output=json" | jq -r ".[].name_value" | sort -u' },
          { label: 'wayback (histórico de URLs)', cmd: 'curl -s "https://web.archive.org/cdx/search/cdx?url=TARGET/*&output=json&fl=original&collapse=urlkey&filter=statuscode:200" | head -100' },
          { label: 'whatweb (fingerprint)', cmd: 'whatweb https://TARGET' },
          { label: 'nmap top ports', cmd: 'nmap -sV -sC -p 80,443,8080 TARGET' },
          { label: 'curl CORS (headers)', cmd: 'curl -sI -H "Origin: https://evil.example" https://TARGET' },
        ],
      },
      {
        num: 'F2',
        title: 'Mapeo de superficie (la parte que casi nadie hace)',
        done: 'Terminado cuando: 10-20 vectores con su petición exacta, y UNO elegido',
        steps: [
          'Descarga y LEE los JS del SPA (bundles) — la mina de endpoints',
          'Clic en toda la app con dos cuentas + MITM; las mutaciones son el objetivo',
          'Busca identificadores (id, uuid, ownerId, price, role) — cada uno un vector',
          'Mapea el flujo de pago/checkout aunque no compres nada',
        ],
        cmds: [
          { label: 'lista JS de la página', cmd: 'curl -s https://TARGET/ | grep -oE \'src="[^"]+\\.js"\' | sort -u' },
          { label: 'endpoints dentro de un bundle', cmd: 'curl -s https://TARGET/assets/app.js | grep -oE \'"/[a-z0-9/_-]{3,}"\' | sort -u' },
        ],
      },
      {
        num: 'F3',
        title: 'Testeo manual por clase de bug',
        done: 'Terminado cuando: la clase elegida tiene compuerta en verde o bloqueo documentado',
        steps: [
          '1. Lógica de negocio (8 clases: precio, cupón, reembolso, reward, acceso, transfer, race, registro)',
          '2. IDOR / acceso a objetos (cruce A/B + sanity)',
          '3. Auth y sesión (regeneración, JWT, recuperación)',
          '4. CORS / SSRF / XSS solo con superficie real',
          '5. GraphQL (mutaciones del bundle, no del schema)',
        ],
      },
    ],
  },
  {
    id: 'bizlogic',
    emoji: '💰',
    title: 'Lógica de negocio — 8 clases',
    source: 'metodologia-logica-negocio.md · compuerta biz',
    intro: 'El servidor confía en valores del cliente. Orden de rentabilidad. Compuerta: /api/gates/validate type=biz',
    table: {
      headers: ['#', 'Clase', 'Qué probar'],
      rows: [
        ['1', 'Precio', 'Cambiar price/amount/total en el checkout'],
        ['2', 'Cupón', 'Reusar cupones, cupón de otra cuenta, discount=0, % negativo'],
        ['3', 'Reembolso', 'Reembolsar más de lo pagado, reembolsar dos veces'],
        ['4', 'Reward', 'Acumular sin acción, canjear repetido'],
        ['5', 'Acceso', 'Cambiar role/plan/isPremium en perfil o petición'],
        ['6', 'Transfer', 'Enviar dinero/items y que tu cuenta no pierda nada'],
        ['7', 'Race (TOCTOU)', 'Ronda acotada y espaciada, con confirmación y limiter global'],
        ['8', 'Registro', 'Registro duplicado, referidos, exploits del alta'],
      ],
    },
    playbook: [
      'Flujo real — haz la operación legítima una vez y captura la petición',
      'Baseline — repítela: ¿qué cambia? (idempotente o no)',
      'Campo confiado — identifica qué valor decide el resultado',
      '¿El servidor acepta? — modifícalo y mira si valida o lo traga',
      'Impacto real — ¿alguien ajeno pierde dinero/datos? (datos propios NO reportables, regla nr-*)',
      'Reproducible — 2 veces, sin transacción real de cobro',
    ],
  },
  {
    id: 'testeo',
    emoji: '🧪',
    title: 'IDOR · Auth · CORS/SSRF/XSS · GraphQL',
    source: 'GUIA-BUG-BOUNTY-MANUAL.md §3 · GUIA-IDOR.md · GUIA-SSRF-LOGICA.md',
    intro: 'Señales y trampas por clase. Compuerta correspondiente (idor / cors / ssrf / xss) antes de abrir a triage.',
    groups: [
      {
        title: 'IDOR / acceso a objetos',
        items: [
          'Objeto tuyo → id de cuenta B (o id+1). Sanity: mismo objeto con B legitimada',
          'Falso positivo del 404: distingue 403 (denegado) de 404 (oculto)',
          'Prueba el mismo id en todas las rutas (perfil, API, descarga)',
          'Compuerta idorChain: contenido idéntico A/B + sanity + impacto',
        ],
        cmds: [
          { label: 'sanity: objeto con cookies de B', cmd: 'curl -s -b "session=COOKIES_B" https://TARGET/api/cart/ID_AJENO' },
        ],
      },
      {
        title: 'Autenticación y sesión',
        items: [
          '¿La cookie/sesión se regenera al hacer login?',
          '¿Remember-me con token predecible o sin expiración?',
          '¿Recuperación de contraseña revela si el email existe?',
          '¿JWT manipulable (alg none, firma débil)? ¿Admin sin comprobar sesión?',
        ],
      },
      {
        title: 'CORS · SSRF · XSS',
        items: [
          'CORS bug = ACAO reflejado + ACAC:true JUNTAS; sin ambas, no hay bug',
          'SSRF: parámetros url= callback= next= webhook= image= → prueba 127.0.0.1 y observa diferencias',
          'XSS: solo con impacto demostrable; alert() en tu sesión no es reportable',
        ],
        cmds: [
          { label: 'CORS reflejado', cmd: 'curl -sI -H "Origin: https://evil.example" https://TARGET/api/endpoint' },
        ],
      },
      {
        title: 'GraphQL',
        items: [
          '{__typename} → si responde, introspección posible; si __schema da 400, no fuerces (lección #6)',
          'Enumera mutaciones del BUNDLE del cliente, no del schema',
          'IDs ajenos en queries con sesión (IDOR en GraphQL)',
          'Batching/alias que evite rate limits',
        ],
        cmds: [
          { label: 'introspección', cmd: 'curl -s https://TARGET/graphql -H "Content-Type: application/json" -d \'{"query":"{__typename}"}\'' },
        ],
      },
    ],
  },
  {
    id: 'verificacion',
    emoji: '✅',
    title: 'Verificación (compuerta de evidencia)',
    source: 'GUIA-BUG-BOUNTY-MANUAL.md §3 Fase 4 · CHECKLIST-PRE-ENTREGA.md',
    intro: 'Antes de escribir el reporte: 7 SÍ obligatorios. La suite bloquea abrir a triage sin ellos.',
    table: {
      headers: ['#', 'Pregunta', 'Evidencia'],
      rows: [
        ['1', '¿Lo reproduje 2 veces?', 'Registro de fechas'],
        ['2', '¿Tengo el curl/petición exacta?', 'Request raw'],
        ['3', '¿Captura del exploit?', 'Captura'],
        ['4', '¿Captura del impacto?', 'Captura'],
        ['5', '¿Impacto real y ajeno (no datos propios)?', 'Descripción'],
        ['6', '¿En scope y sin descalificadores?', 'Scope copiado'],
        ['7', '¿Pasó la compuerta de la suite?', 'Veredicto /api/gates/validate'],
      ],
    },
  },
  {
    id: 'reporte',
    emoji: '📝',
    title: 'Reporte',
    source: 'GUIA-BUG-BOUNTY-MANUAL.md §3 Fase 5 · CHECKLIST-REPORTE-CALIDAD.md',
    intro: 'Título específico, pasos numerados y severidad honesta son lo que pasa triage.',
    checklist: [
      'Título: TipoDeBug en endpoint (Programa) — específico',
      'Pasos: 3+ numerados, con auth y headers exactos',
      'Request/Response: curl o raw HTTP copiable',
      'Impacto: qué pierde el negocio, con la demostración detrás',
      'Severidad honesta — un CVSS bajo con "critical" es rechazo directo',
      'Saneado: sin fases/suite/agente, sin tokens ni emails de terceros',
    ],
  },
  {
    id: 'errores',
    emoji: '⚠️',
    title: 'Errores que cuestan el reporte',
    source: 'GUIA-BUG-BOUNTY-MANUAL.md §5',
    intro: 'La lista que separa un reporte aceptado de un duplicado/insuficiente.',
    table: {
      headers: ['Error', 'Consecuencia'],
      rows: [
        ['Enviar sin reproducir 2 veces', 'Duplicado/insuficiente'],
        ['404 de objeto ajeno como prueba de IDOR', 'Falso positivo'],
        ['Impacto sobre tus propios datos', 'No reportable'],
        ['Severidad inflada', 'Pierdes credibilidad'],
        ['Fuzz masivo sin permiso', 'Ban de IP y del programa'],
        ['Sin UA/scope/headers documentados', 'El triager no puede reproducir'],
        ['Enviar con tokens/emails reales', 'Descartado + riesgo legal'],
      ],
    },
  },
  {
    id: 'kali',
    emoji: '🐳',
    title: 'Comandos esenciales Kali',
    source: 'GUIA-BUG-BOUNTY-MANUAL.md §4 · terminal Kali de la suite',
    intro: 'Uso responsable: preferir el pipeline manual-paced; en la terminal, herramientas activas solo para laboratorio local.',
    cmds: [
      { label: 'entrar a la terminal', cmd: 'docker exec -it knk-kali bash' },
      { label: 'verificar herramientas', cmd: 'tools-check' },
      { label: 'subfinder', cmd: 'subfinder -d TARGET -silent' },
      { label: 'whatweb', cmd: 'whatweb https://TARGET' },
      { label: 'ffuf dirs (t1, wordlist ligera)', cmd: 'ffuf -u https://TARGET/FUZZ -w /usr/share/wordlists/dirb/common.txt -mc 200,301,302,403 -t 1' },
      { label: 'ffuf vhosts', cmd: 'ffuf -u https://TARGET -H "Host: FUZZ.TARGET" -w /usr/share/wordlists/dirb/common.txt -mc 200' },
      { label: 'nuclei misconfig', cmd: 'nuclei -u https://TARGET -t http/misconfiguration -silent -timeout 5' },
      { label: 'SQLi — compuerta segura', cmd: 'echo "SQLi: validar solo con /api/gates/validate type=sqli"' },
    ],
  },
];

function CmdRow({ cmd, onSend }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd.cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API no disponible (p. ej. sin contexto seguro) — los otros botones siguen
    }
  };

  return (
    <div className="cs-cmd">
      <div className="cs-cmd-head">
        <span className="cs-cmd-label">{cmd.label}</span>
        <span className="cs-cmd-actions">
          {onSend && (
            <button
              className="btn btn-sm btn-outline"
              style={{ padding: '2px 8px', fontSize: 10 }}
              title="Insertar en la terminal Kali"
              onClick={() => onSend(cmd.cmd)}
            >
              ▶
            </button>
          )}
          <button
            className="btn btn-sm btn-outline"
            style={{ padding: '2px 8px', fontSize: 10 }}
            title="Copiar al portapapeles"
            onClick={copy}
          >
            {copied ? '✓' : '📋'}
          </button>
        </span>
      </div>
      <code className="cs-cmd-code">{cmd.cmd}</code>
    </div>
  );
}

export default function CheatSheet({ onSendToTerminal, onGoToTerminal }) {
  const [active, setActive] = useState(SECTIONS[0].id);
  const section = SECTIONS.find(s => s.id === active) || SECTIONS[0];

  const copyAll = () => {
    let text = `# ${section.emoji} ${section.title}\n(Fuente: ${section.source})\n\n${section.intro}\n`;
    if (section.checklist) text += '\n' + section.checklist.map(c => `- [ ] ${c}`).join('\n');
    if (section.phases) text += '\n' + section.phases.map(p =>
      `\n## ${p.num} — ${p.title}\n${p.done}\n`
      + (p.steps && p.steps.length ? p.steps.map(s => `- ${s}`).join('\n') + '\n' : '')
      + (p.cmds && p.cmds.length ? p.cmds.map(c => c.cmd).join('\n') : '')
    ).join('\n');
    if (section.table) text += '\n' + [section.table.headers.join(' | '), ...section.table.rows.map(r => r.join(' | '))].join('\n');
    if (section.playbook) text += '\n' + section.playbook.map((p, i) => `${i + 1}. ${p}`).join('\n');
    if (section.groups) text += '\n' + section.groups.map(g =>
      `\n## ${g.title}\n`
      + (g.items && g.items.length ? g.items.map(i => `- ${i}`).join('\n') + '\n' : '')
      + (g.cmds && g.cmds.length ? g.cmds.map(c => c.cmd).join('\n') : '')
    ).join('\n');
    if (section.cmds) text += '\n' + section.cmds.map(c => c.cmd).join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const renderCmds = (cmds) => cmds.map((c, i) => <CmdRow key={i} cmd={c} onSend={onSendToTerminal} />);

  return (
    <div>
      <h2>🎯 Guía manual — chuleta</h2>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* Nav de secciones */}
        <div style={{ width: 210, flexShrink: 0 }}>
          <div className="card">
            <h3>📖 Secciones</h3>
            {SECTIONS.map(s => (
              <button
                key={s.id}
                className={`btn btn-sm ${active === s.id ? '' : 'btn-outline'}`}
                style={{ width: '100%', marginBottom: 3, fontSize: 11, textAlign: 'left' }}
                onClick={() => setActive(s.id)}
              >
                {s.emoji} {s.title}
              </button>
            ))}
          </div>

          <div className="card" style={{ marginTop: 8 }}>
            <h3>🔗 Fuente de verdad</h3>
            <p className="muted" style={{ fontSize: 10 }}>
              La guía completa vive en <code>docs/GUIA-BUG-BOUNTY-MANUAL.md</code>,
              con ejemplos y contexto. Esta ficha es la vista operativa para
              tener al lado de la terminal.
            </p>
          </div>

          <div className="card" style={{ marginTop: 8 }}>
            <h3>🐳 Terminal Kali</h3>
            <p className="muted" style={{ fontSize: 10 }}>
              {onSendToTerminal
                ? 'Los botones ▶ insertan el comando en la terminal Kali de la pestaña Terminal.'
                : 'Cambia a la pestaña Terminal Kali para lanzar comandos desde ahí.'}
            </p>
            {onGoToTerminal && (
              <button
                className="btn btn-sm btn-outline"
                style={{ width: '100%', marginTop: 4 }}
                onClick={onGoToTerminal}
              >
                ▶ Ir a la Terminal
              </button>
            )}
          </div>
        </div>

        {/* Contenido de la sección */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>{section.emoji} {section.title}</h3>
              <button className="btn btn-sm btn-outline" onClick={copyAll}>📋 Copiar sección</button>
            </div>
            <p className="muted">{section.intro}</p>
            <p className="muted" style={{ fontSize: 10, marginTop: 4 }}>Fuente: <code>{section.source}</code></p>

            {section.checklist && (
              <ul className="cs-list">
                {section.checklist.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            )}

            {section.phases && section.phases.map(p => (
              <div key={p.num} className="cs-phase">
                <div className="cs-phase-head">
                  <span className="badge badge-ok">{p.num}</span>
                  <strong style={{ fontSize: 12 }}>{p.title}</strong>
                </div>
                {p.steps && (
                  <ul className="cs-list">
                    {p.steps.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                )}
                {p.cmds && renderCmds(p.cmds)}
                <p className="muted" style={{ fontSize: 10, marginTop: 4 }}>✓ {p.done}</p>
              </div>
            ))}

            {section.table && (
              <table className="cs-table">
                <thead>
                  <tr>{section.table.headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {section.table.rows.map((row, i) => (
                    <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            )}

            {section.playbook && (
              <ol className="cs-playbook">
                {section.playbook.map((p, i) => <li key={i}>{p}</li>)}
              </ol>
            )}

            {section.groups && section.groups.map(g => (
              <div key={g.title} className="cs-phase">
                <strong style={{ fontSize: 12 }}>{g.title}</strong>
                {g.items && (
                  <ul className="cs-list">
                    {g.items.map((it, i) => <li key={i}>{it}</li>)}
                  </ul>
                )}
                {g.cmds && renderCmds(g.cmds)}
              </div>
            ))}

            {section.cmds && renderCmds(section.cmds)}
          </div>
        </div>
      </div>
    </div>
  );
}
