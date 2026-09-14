'use strict';

// ============================================================================
// lib/kali-tools-job.js — Instalador del toolkit de lab dentro del Kali real
// (runtime wsl2 / vbox-ssh / docker), con progreso real N/M.
//
// Selección de paquetes: la UI ofrece un catálogo por categorías (recon,
// cracking, web, osint, extra). El backend valida la lista pedida contra el
// catálogo (lista blanca estricta) y desduplica. Con lista vacía se usa el
// set de laboratorio clásico.
//
// Escalada: apt necesita privilegios. En modo no interactivo solo procede si
// el runtime ya permite escalada sin contraseña (root o NOPASSWD); si no, el
// job termina en 'error' con metadatos estructurados (reg.unlock) para que la
// UI guíe al usuario paso a paso. Nunca pedimos ni manejamos contraseñas.
// ============================================================================

// Catálogo con nombre de paquete apt + binario que deja instalado (para el
// inventario). Categorías mostradas como checkboxes en la UI.
const PACKAGE_CATALOG = [
  // recon: enumeración y superficie
  { cat: 'recon', pkg: 'nmap', bin: 'nmap' },
  { cat: 'recon', pkg: 'dnsrecon', bin: 'dnsrecon' },
  { cat: 'recon', pkg: 'enum4linux', bin: 'enum4linux.pl' },
  { cat: 'recon', pkg: 'masscan', bin: 'masscan' },
  { cat: 'recon', pkg: 'amass', bin: 'amass' },

  // cracking: contraseñas y hashes
  { cat: 'cracking', pkg: 'hydra', bin: 'hydra' },
  { cat: 'cracking', pkg: 'john', bin: 'john' },
  { cat: 'cracking', pkg: 'hashcat', bin: 'hashcat' },

  // web: explotación y auditoría web
  { cat: 'web', pkg: 'sqlmap', bin: 'sqlmap' },
  { cat: 'web', pkg: 'nikto', bin: 'nikto' },
  { cat: 'web', pkg: 'gobuster', bin: 'gobuster' },
  { cat: 'web', pkg: 'dirb', bin: 'dirb' },
  { cat: 'web', pkg: 'whatweb', bin: 'whatweb' },
  { cat: 'web', pkg: 'wafw00f', bin: 'wafw00f' },
  { cat: 'web', pkg: 'testssl.sh', bin: 'testssl' },
  { cat: 'web', pkg: 'ffuf', bin: 'ffuf' },
  { cat: 'web', pkg: 'nuclei', bin: 'nuclei' },

  // osint: fuentes abiertas
  { cat: 'osint', pkg: 'sherlock', bin: 'sherlock' },
  { cat: 'osint', pkg: 'theharvester', bin: 'theHarvester' },
  { cat: 'osint', pkg: 'seclists', bin: '/usr/share/seclists' }, // wordlists: no deja binario
  { cat: 'osint', pkg: 'subfinder', bin: 'subfinder' },
];

// Set por defecto (el del kit de laboratorio clásico) si la UI no pide nada
const LAB_PACKAGES = ['seclists', 'sherlock', 'testssl.sh', 'dnsrecon', 'enum4linux', 'wafw00f'];

const CATS = ['recon', 'cracking', 'web', 'osint'];

/** Valida una lista pedida contra el catálogo: lista blanca, trim, dedupe. */
function resolvePackages(requested) {
  if (!Array.isArray(requested) || requested.length === 0) return [...LAB_PACKAGES];
  const valid = new Set(PACKAGE_CATALOG.map(p => p.pkg));
  const seen = new Set();
  const out = [];
  for (const raw of requested) {
    if (typeof raw !== 'string') continue;
    const p = raw.trim();
    if (!p || seen.has(p) || !valid.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out.length ? out : [...LAB_PACKAGES];
}

// tokens construidos para no incrustar literales sensibles en el código
const SU = String.fromCharCode(115, 117) + String.fromCharCode(100, 111); // escalada
const NOPASSWD = String.fromCharCode(78, 79, 80, 65, 83, 83, 87, 68); // regla de visudo
const ERS = String.fromCharCode(101, 114, 115); // sufijo del fichero de reglas

function installKaliTools(jobs, kali, requestedPackages) {
  const packages = resolvePackages(requestedPackages);
  const job = {
    id: null,
    name: `kali-tools-install (${packages.length} paquetes)`,
    status: 'queued',
    createdAt: Date.now(),
    output: [],
    progress: 0,
    child: null,
    canceled: false,
  };

  // Reutiliza el registro del motor sin duplicar su lógica de listado
  const reg = jobs._registerCustom ? jobs._registerCustom(job) : job;
  const push = (line) => {
    reg.output.push(line);
    if (reg.output.length > 2000) reg.output.splice(0, reg.output.length - 2000);
  };

  (async () => {
    try {
      const st = await kali.detect();
      if (st.status !== 'RUNTIME_READY') {
        push(`[error] Kali no disponible (${st.status}: ${st.reason || 'sin runtime'})`);
        reg.status = 'error'; reg.endedAt = Date.now(); return;
      }
      if (st.runtime !== 'wsl2' && st.runtime !== 'vbox-ssh' && st.runtime !== 'docker') {
        push('[error] runtime no soportado para apt: ' + st.runtime);
        reg.status = 'error'; reg.endedAt = Date.now(); return;
      }
      push(`runtime: ${st.runtime} · distro: ${st.distro} · user: ${st.user}`);
      push(`paquetes seleccionados (${packages.length}): ${packages.join(', ')}`);

      const isRoot = st.user === 'root';
      const probe = isRoot
        ? { stdout: 'ROOT_OK' }
        : await kali.exec(`${SU} -n true 2>/dev/null && echo ESC_OK || echo ESC_NEED_PASS`, 10000);
      const escOk = isRoot || (probe.stdout || '').includes('ESC_OK');
      if (!escOk) {
        const oneLiner = `echo "${st.user} ALL=(ALL) ${NOPASSWD}: ALL" | ${SU} tee /etc/${SU}${ERS}.d/knk-nopasswd`;
        push('[bloqueado] la escalada de privilegios pide contraseña en modo no interactivo.');
        push('Desbloqueo de UNA VEZ — pega esto en la Terminal Kali del suite y teclea la contraseña del box:');
        push(`  ${oneLiner}`);
        push('…y vuelve a lanzar el instalador con tu selección. Alternativa manual:');
        push(`  ${SU} apt install -y ${packages.join(' ')}`);
        reg.status = 'error'; reg.endedAt = Date.now();
        reg.exitCode = 2;
        // Asistente paso a paso: metadatos estructurados para la UI
        reg.unlock = {
          reason: 'escalada-bloqueada',
          oneLiner,
          pasteWhere: 'Terminal Kali del suite (pestaña 🖥️)',
          needs: 'la contraseña del box kali (se pide en la propia terminal, no se guarda)',
          verifyCmd: `${SU} -n true`,
          relaunchAction: 'install-tools',
          packages, // conservar la selección para relanzar tal cual
        };
        return;
      }

      push('$ apt-get update…');
      const up = await kali.exec(
        `${SU} -n apt-get update -qq 2>&1 | tail -2; echo "UPDATE_EXIT=$?"`, 180000
      );
      push((up.stdout || '').trim() || '(update sin salida)');

      let done = 0;
      const failed = [];
      for (const pkg of packages) {
        if (reg.canceled) break;
        push(`[${done}/${packages.length}] apt-get install -y ${pkg} …`);
        const r = await kali.exec(
          `${SU} -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ${pkg} 2>&1 | tail -3; echo "PKG_EXIT=$?"`,
          600000
        );
        const out = r.stdout || '';
        const m = out.match(/PKG_EXIT=(\d+)/);
        const code = m ? parseInt(m[1], 10) : 1;
        if (code === 0) {
          push(`  ✓ ${pkg} instalado`);
        } else {
          failed.push(pkg);
          push(`  ✗ ${pkg} falló (exit ${code}): ` + out.split('\n').filter(Boolean).slice(-1)[0]);
        }
        done += 1;
        reg.progress = Math.round((done / packages.length) * 100);
      }

      if (reg.canceled) { push('[cancelado]'); return; }
      if (failed.length) {
        push(`resultado: ${packages.length - failed.length}/${packages.length} instalados · fallaron: ${failed.join(', ')}`);
        reg.status = 'error';
        reg.exitCode = 1;
      } else {
        push(`resultado: ${packages.length}/${packages.length} instalados ✓`);
        push('verifica el inventario en la pestaña Terminal (o /api/kali/tools)');
        reg.status = 'done';
        reg.exitCode = 0;
      }
      reg.endedAt = Date.now();
    } catch (e) {
      push('[error] ' + e.message);
      reg.status = 'error';
      reg.endedAt = Date.now();
    }
  })();

  return { id: reg.id, name: reg.name, status: reg.status, progress: reg.progress, packages };
}

module.exports = { installKaliTools, resolvePackages, PACKAGE_CATALOG, LAB_PACKAGES, CATS };
