'use strict';
// ============================================================================
// barrido-multi.js — Sesión de barrido genérico MULTI-PROGRAMA.
//
//   node backend/barrido-multi.js <lote.json>              # plan combinado (seco)
//   node backend/barrido-multi.js <lote.json> --ejecutar   # fases encadenadas
//   node backend/barrido-multi.js --plantilla              # esqueleto de lote
//
// El lote JSON declara los programas; cada fase usa SU rate_limit_ms y el
// limiter global de lib/net.js es UNO: `barrer` (barrido-generico) lo fija al
// empezar cada fase — el ritmo entre programas se comparte sin duplicar nada.
//   { "programas": ["data/barridos/kiteworks.json", "data/barridos/dyson.json"] }
// Cada referencia se resuelve relativa al fichero de lote; si apunta a un
// DIRECTORIO se leen sus *.json en orden alfabético (excluyendo subdirs).
// REGLA DE COSTE: seco por defecto. Evidencia única por sesión en evidencia-poc/http/.
// ============================================================================

const fs = require('fs');
const path = require('path');
const G = require('./barrido-generico');

const RAIZ = path.join(__dirname, '..');
const EVID_HTTP = process.env.KNK_EVID_HTTP || path.join(RAIZ, 'evidencia-poc', 'http');

/** El ritmo del lote es el MÁS LENTO de sus fases (se anuncia, no se impone:
 *  cada fase fija su propio valor en el limiter al empezar, vía barrer). */
function ritmoGlobal(fases) {
  return Math.max(...fases.map((f) => f.rate_limit_ms || 3000));
}

/** Errores del lote (referencias). La validación fina por config va aparte. */
function validarLote(refs) {
  if (!Array.isArray(refs)) return ['"programas" debe ser una lista de rutas a configs JSON'];
  if (!refs.length) return ['"programas" está vacío'];
  const errores = [];
  refs.forEach((ref, i) => {
    if (typeof ref !== 'string' || !ref.trim()) errores.push(`programas[${i}]: referencia no válida`);
  });
  return errores;
}

/** Lee un config; devuelve { cfg } o { error } sin lanzar (fallo legible). */
function leerConfig(fichero) {
  let raw;
  try { raw = fs.readFileSync(fichero, 'utf8'); } catch { return { error: `no se encontró el fichero: ${fichero}` }; }
  try { return { cfg: JSON.parse(raw) }; } catch (e) { return { error: `JSON inválido (${fichero}): ${e.message}` }; }
}

/** Fase sintetizada: nombre/ritmo + sondas YA EXPANDIDAS (crudas). */
function sintetizarFase(cfg) {
  return {
    nombre: String(cfg.programa || 'sin-nombre'),
    scope: cfg.scope,
    base: cfg.base,
    rate_limit_ms: cfg.rate_limit_ms || 3000,
    sondas: G.expandir(cfg),
    cfg,
  };
}

/** Resuelve una referencia a lista de ficheros: fichero suelto o directorio. */
function resolverReferencia(ref, dirLote) {
  const ruta = path.isAbsolute(ref) ? ref : path.join(dirLote, ref);
  if (!fs.existsSync(ruta)) return { error: `no existe: ${ref}` };
  if (fs.statSync(ruta).isDirectory()) {
    const ficheros = fs.readdirSync(ruta).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(ruta, f));
    if (!ficheros.length) return { error: `el directorio ${ref} no contiene *.json` };
    return { ficheros };
  }
  return { ficheros: [ruta] };
}

/**
 * Corre el lote. Seco: plan combinado, 0 peticiones, 0 efectos en el limiter.
 * Ejecutar: fases encadenadas con barrer() (scope+ritmo por fase, guardia de
 * muestras heredada); un fallo de una fase NO tumba la sesión.
 */
async function correr(fases, { ejecutar = false, lote = null } = {}) {
  const sesion = {
    driver: 'barrido-multi.js',
    fecha: new Date().toISOString(),
    ejecutar,
    lote: lote || undefined,
    ritmo_global_ms: ritmoGlobal(fases),
    programas: [],
    fases: [],
    peticiones: 0,
    sospechosos: [],
    inconclusos: [],
    errores: [],
  };

  if (!ejecutar) {
    for (const f of fases) {
      sesion.fases.push({ programa: f.nombre, scope: f.scope, base: f.base, plan: f.sondas.map((s) => `${s.metodo || 'GET'} ${s.ruta} [${s.id}]`) });
    }
    sesion.plan_total = sesion.fases.reduce((a, f) => a + f.plan.length, 0);
    return sesion;
  }

  for (const [i, f] of fases.entries()) {
    console.log(`\n═══ Fase ${i + 1}/${fases.length}: ${f.nombre} (${f.sondas.length} sondas) ═══`);
    const r = await G.barrer(f.cfg, { seco: false });
    if (!r.ok) {
      sesion.errores.push({ programa: f.nombre, errores: r.errores });
      console.log('  ✗ fase inválida:', r.errores.join(' · '));
      continue;
    }
    sesion.programas.push(r.programa);
    sesion.fases.push({
      programa: r.programa, scope: r.scope,
      veredictos: r.resultados.map((v) => ({ id: v.id, tipo: v.tipo, veredicto: v.veredicto, status: v.status, nMuestras: v.nMuestras })),
    });
    sesion.peticiones += r.peticiones;
    sesion.sospechosos.push(...r.sospechosos.map((s) => ({ programa: r.programa, ...s })));
    sesion.inconclusos.push(...r.inconclusos.map((s) => ({ programa: r.programa, ...s })));
  }

  const out = path.join(EVID_HTTP, `barrido-multi-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.mkdirSync(EVID_HTTP, { recursive: true });
  fs.writeFileSync(out, JSON.stringify(sesion, null, 2) + '\n');
  sesion.evidencia = path.relative(RAIZ, out);
  return sesion;
}

function plantillaLote() {
  return {
    _nota: 'Lista de configs de barrido (data/barridos/*.json). Referencias relativas al lote; un directorio expande a todos sus *.json. El ritmo por fase es su rate_limit_ms; entre fases manda el máximo.',
    programas: ['data/barridos/kiteworks.json', 'data/barridos/dyson.json'],
  };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--plantilla')) { console.log(JSON.stringify(plantillaLote(), null, 2)); return; }
  const fichero = argv.find((a) => !a.startsWith('--'));
  if (!fichero || !fs.existsSync(fichero)) {
    console.error('Uso: node backend/barrido-multi.js <lote.json> [--ejecutar]  |  --plantilla');
    process.exit(1);
  }
  let lote;
  try { lote = JSON.parse(fs.readFileSync(fichero, 'utf8')); } catch (e) { console.error('JSON inválido:', e.message); process.exit(1); }

  const refs = Array.isArray(lote) ? lote : lote.programas;
  const errs = validarLote(refs);
  if (errs.length) { console.error('LOTE INVÁLIDO:'); errs.forEach((e) => console.error(' ✗', e)); process.exit(2); }

  // Resolver referencias → ficheros → configs validadas. Fail fast: si algo
  // está mal NADA se ejecuta (el seco existe precisamente para revisar antes).
  const dirLote = path.dirname(path.resolve(fichero));
  const ficheros = [];
  for (const [i, ref] of refs.entries()) {
    const r = resolverReferencia(ref, dirLote);
    if (r.error) { console.error(`LOTE INVÁLIDO: programas[${i}]: ${r.error}`); process.exit(2); }
    ficheros.push(...r.ficheros);
  }
  const fases = [];
  for (const [i, fich] of ficheros.entries()) {
    const res = leerConfig(fich);
    if (res.error) { console.error(`CONFIG INVÁLIDA: programas[${i}]: ${res.error}`); process.exit(2); }
    const errsCfg = G.validarConfig(res.cfg);
    if (errsCfg.length) {
      console.error(`CONFIG INVÁLIDA: programas[${i}] (${res.cfg.programa || '?'}):`);
      errsCfg.forEach((e) => console.error('   ✗', e));
      process.exit(2);
    }
    fases.push(sintetizarFase(res.cfg));
  }

  const ejecutar = argv.includes('--ejecutar');
  const sesion = await correr(fases, { ejecutar, lote: fichero });

  if (!ejecutar) {
    console.log(`── Multi-programa: ${fases.length} fase(s) · plan total ${sesion.plan_total} sondas · ritmo global ${sesion.ritmo_global_ms} ms (SECO — 0 peticiones) ──`);
    for (const f of sesion.fases) {
      console.log(`\n═══ ${f.programa} · ${f.scope} ═══`);
      f.plan.forEach((p) => console.log('   ·', p));
    }
    console.log('\nNada lanzado. Revisa el plan y añade --ejecutar.');
    return;
  }

  console.log(`\nSesión: ${sesion.peticiones} peticiones · ${sesion.sospechosos.length} SOSPECHOSO(s) · ${sesion.inconclusos.length} inconcluso(s)`);
  sesion.sospechosos.forEach((s) => console.log(`  ⚠️ [${s.programa}] ${s.id}`));
  console.log(`Evidencia: ${sesion.evidencia}`);
}

if (require.main === module) main().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
module.exports = { ritmoGlobal, validarLote, leerConfig, sintetizarFase, resolverReferencia, correr, plantillaLote };
