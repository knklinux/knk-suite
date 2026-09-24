'use strict';
// ============================================================================
// net-config.test.js — lo que el llamante pide y lo que la suite hace de verdad.
//
// Contexto (docs/bugbounty/AUDITORIA-OPCIONES-SILENCIADAS-2026-09-16.md): el
// patrón encontrado en la auditoría es "el llamante pide algo y se descarta en
// silencio". Aquí se fijan dos invariantes:
//
//   1. UNA CLAVE QUE NADIE LEE SE AVISA (`lib/opciones.js`). Un nombre mal
//      escrito (`puerto` en vez de `port`) dejaba de configurar en silencio.
//   2. UN CONTROL DE PERMISOS NO SE ENSANCHA POR ERROR DE TIPO. `setScope()` con
//      algo que no es array conserva el scope anterior en vez de vaciarlo, porque
//      `[]` significa "sin filtro" y no "nada permitido".
//
// Hermético: sin red, sin navegador, sin BD. Los avisos se capturan sustituyendo
// console.warn, así que ningún test escribe nada.
// ============================================================================

const assert = require('assert');

const opciones = require('./lib/opciones');
const net = require('./lib/net');

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ok — ${name}`); }
  catch (e) { console.error(`  FALLO — ${name}: ${e.message}`); process.exitCode = 1; }
}

/** Captura los avisos emitidos durante `fn`. */
function capturarAvisos(fn) {
  const real = console.warn;
  const dichos = [];
  console.warn = (...a) => { dichos.push(a.join(' ')); };
  try { fn(); } finally { console.warn = real; }
  return dichos;
}

console.log('net-config.test.js');

// ── lib/opciones.js (puro) ───────────────────────────────────────────────────
ok('detecta la clave que el llamante pidió y nadie lee', () => {
  assert.deepStrictEqual(opciones.clavesDesconocidas({ port: 9336, puerto: 9336 }, ['port', 'perfil']), ['puerto']);
});

ok('sin claves desconocidas no hay nada que decir', () => {
  assert.deepStrictEqual(opciones.clavesDesconocidas({ port: 1 }, ['port', 'perfil']), []);
  assert.deepStrictEqual(opciones.clavesDesconocidas(null, ['port']), []);
  assert.deepStrictEqual(opciones.clavesDesconocidas({ a: 1 }, []), ['a']);
});

ok('el aviso nombra la clave ignorada y la que sí vale', () => {
  opciones.reiniciarAvisos();
  const dichos = capturarAvisos(() => opciones.revisarOpciones({ puerto: 9336 }, ['port'], 'abrirCanal'));
  assert.strictEqual(dichos.length, 1, 'debe avisar exactamente una vez');
  assert.ok(dichos[0].includes('puerto'), `debe nombrar la clave ignorada: ${dichos[0]}`);
  assert.ok(dichos[0].includes('abrirCanal'), 'debe decir el contexto');
  assert.ok(dichos[0].includes('port'), 'debe listar las claves que sí se leen');
});

ok('sugiere la clave parecida cuando la hay', () => {
  opciones.reiniciarAvisos();
  const dichos = capturarAvisos(() => opciones.revisarOpciones({ urls: 'x' }, ['url'], 'demo'));
  assert.ok(dichos[0].includes('¿querías «url»?'), `debe sugerir url: ${dichos[0]}`);
});

ok('avisa UNA vez por contexto+clave (no inunda el log)', () => {
  opciones.reiniciarAvisos();
  const dichos = capturarAvisos(() => {
    for (let i = 0; i < 5; i++) opciones.revisarOpciones({ puerto: i }, ['port'], 'repetido');
    opciones.revisarOpciones({ puerto: 1, otro: 2 }, ['port'], 'repetido');
  });
  assert.strictEqual(dichos.length, 2, `una por clave, no una por llamada: ${dichos.length}`);
});

ok('silenciar() no esconde el diagnóstico: sigue devolviendo las claves', () => {
  opciones.reiniciarAvisos();
  const dichos = capturarAvisos(() => {
    const r = opciones.revisarOpciones({ mal: 1 }, ['bien'], 'demo', { silenciar: true });
    assert.deepStrictEqual(r, ['mal']);
  });
  assert.strictEqual(dichos.length, 0, 'silenciar no debe escribir');
});

ok('merge() hace ganar SIEMPRE al llamante', () => {
  const r = opciones.merge({ method: 'POST', headers: { a: '1' } }, { method: 'GET', headers: {}, body: null });
  assert.strictEqual(r.method, 'POST');
  assert.deepStrictEqual(r.headers, { a: '1' });
  assert.strictEqual(r.body, null, 'lo no pedido conserva el defecto');
});

ok('merge() no deja que un undefined explícito borre el defecto', () => {
  const r = opciones.merge({ headers: undefined }, { headers: { 'Accept': '*/*' } });
  assert.deepStrictEqual(r.headers, { 'Accept': '*/*' });
});

// ── net.js: controles que NO pueden ensancharse por accidente ────────────────
net._reiniciarAvisosConfig();
net.setScope([]);

ok('setScope() aplica un array y devuelve true', () => {
  assert.strictEqual(net.setScope(['api.example.com', '*.example.com']), true);
  assert.deepStrictEqual(net.getScope(), ['api.example.com', '*.example.com']);
});

ok('sin scope, inScope() deja pasar CUALQUIER host (por eso vaciarlo es peligroso)', () => {
  const previo = net.getScope();
  net.setScope([]);
  assert.strictEqual(net.inScope('evil.example.net'), true, 'sin scope no hay filtro');
  net.setScope(previo);
  assert.strictEqual(net.inScope('evil.example.net'), false, 'con scope, fuera de la lista');
});

ok('setScope() RECHAZA el string y conserva el scope anterior', () => {
  net.setScope(['api.example.com']);
  const dichos = capturarAvisos(() => {
    assert.strictEqual(net.setScope('api.example.com'), false, 'un string no puede aplicarse');
  });
  assert.deepStrictEqual(net.getScope(), ['api.example.com'], 'el scope anterior sigue en pie');
  assert.strictEqual(net.inScope('evil.example.net'), false, 'y sigue filtrando: NO se ensanchó');
  assert.strictEqual(dichos.length, 1, 'debe avisar del rechazo');
  assert.ok(dichos[0].includes('RECHAZADO'), `el aviso debe ser inequívoco: ${dichos[0]}`);
});

ok('setScope() rechaza también undefined, null, número y objeto', () => {
  net.setScope(['api.example.com']);
  for (const malo of [undefined, null, 42, { a: 1 }]) {
    net._reiniciarAvisosConfig();
    capturarAvisos(() => assert.strictEqual(net.setScope(malo), false, `debe rechazar ${String(malo)}`));
    assert.deepStrictEqual(net.getScope(), ['api.example.com']);
  }
});

ok('getScope() devuelve una copia: nadie cambia el filtro por referencia', () => {
  net.setScope(['api.example.com']);
  const copia = net.getScope();
  copia.push('evil.example.net');
  assert.deepStrictEqual(net.getScope(), ['api.example.com']);
});

ok('setOutOfScope() también falla segura (vaciar la lista también ENSANCHA)', () => {
  assert.strictEqual(net.setOutOfScope(['blog.example.com']), true);
  const dichos = capturarAvisos(() => assert.strictEqual(net.setOutOfScope('blog.example.com'), false));
  assert.deepStrictEqual(net.getOutOfScope(), ['blog.example.com']);
  assert.strictEqual(dichos.length, 1);
  assert.strictEqual(net.setOutOfScope([]), true, 'vaciarla a propósito sí se puede');
  assert.deepStrictEqual(net.getOutOfScope(), []);
});

ok('bloquea IPv4-mapped IPv6 comprimido', () => {
  assert.strictEqual(net.isInternalIPv6('::ffff:7f00:1'), true);
  assert.strictEqual(net.isInternalHost('::ffff:7f00:1'), true);
  assert.strictEqual(net.isInternalHost('fc00::1'), true);
  assert.strictEqual(net.isInternalHost('2001:4860:4860::8888'), false);
});

// ── net.js: setters que antes tragaban en silencio ───────────────────────────
ok('setRateLimit() avisa cuando ELEVA el ritmo pedido al suelo anti-DoS', () => {
  net._reiniciarAvisosConfig();
  const dichos = capturarAvisos(() => {
    assert.strictEqual(net.setRateLimit(100), net.SUELO_MS, 'se respeta el suelo');
  });
  assert.strictEqual(dichos.length, 1);
  assert.ok(dichos[0].includes('ELEVADO'), `debe decir que lo subió: ${dichos[0]}`);
});

ok('setRateLimit() avisa si lo que llega no es un número y no toca el ritmo', () => {
  net.setRateLimit(2000);
  net._reiniciarAvisosConfig();
  const dichos = capturarAvisos(() => assert.strictEqual(net.setRateLimit('2s'), 2000));
  assert.strictEqual(net.getRateLimit(), 2000);
  assert.strictEqual(dichos.length, 1);
  assert.ok(dichos[0].includes('no es un número'));
});

ok('setRateLimit() con un valor válido no dice nada', () => {
  net._reiniciarAvisosConfig();
  const dichos = capturarAvisos(() => net.setRateLimit(1500));
  assert.strictEqual(dichos.length, 0, `no debe avisar de lo que sí aplica: ${dichos.join(' | ')}`);
});

ok('setUA() avisa cuando la identidad está FIJADA y no aplica la petición', () => {
  net._reiniciarAvisosConfig();
  net.setUA('UA-de-sesion/1.0');
  net.lockUA();
  const dichos = capturarAvisos(() => net.setUA('otro-ua/2.0'));
  assert.strictEqual(net.getUA(), 'UA-de-sesion/1.0', 'la identidad fijada no se sustituye');
  assert.strictEqual(dichos.length, 1);
  assert.ok(dichos[0].includes('FIJADA'));
  net.unlockUA();
});

ok('setUA() avisa de un UA inválido en vez de tragárselo', () => {
  net._reiniciarAvisosConfig();
  net.setUA('UA-valido/1.0');
  const dichos = capturarAvisos(() => {
    net.setUA('');
    net.setUA('x'.repeat(300));
    net.setUA('ua\r\nInyectado: si');
  });
  assert.strictEqual(net.getUA(), 'UA-valido/1.0');
  assert.ok(dichos.length >= 1, 'debe avisar al menos del UA vacío');
  assert.ok(dichos.some((d) => d.includes('ignorado')), `avisos: ${dichos.join(' | ')}`);
});

ok('setUA() con valor válido aplica y no avisa', () => {
  net._reiniciarAvisosConfig();
  const dichos = capturarAvisos(() => net.setUA('navegador-de-prueba/1.0'));
  assert.strictEqual(net.getUA(), 'navegador-de-prueba/1.0');
  assert.strictEqual(dichos.length, 0);
  net.setUA(net.DEFAULT_UA);
});

// ── net.fetch: opciones que no se leen ───────────────────────────────────────
ok('net.fetch avisa de una opción que ignora (p. ej. signal)', async () => {
  // La comprobación es síncrona: el aviso sale antes de tocar la red.
  const dichos = capturarAvisos(() => {
    const p = net.fetch('http://127.0.0.1:1/descartable', { method: 'GET', signal: null });
    p.catch(() => {});
  });
  assert.ok(dichos.some((d) => d.includes('signal')), `debe avisar de signal: ${dichos.join(' | ')}`);
});

ok('net.fetch no avisa de las claves que sí lee', () => {
  const dichos = capturarAvisos(() => {
    net.fetch('http://127.0.0.1:1/descartable', { method: 'POST', headers: { Accept: 'text/event-stream' }, body: '{}', timeoutMs: 100, maxRedirects: 0 }).catch(() => {});
  });
  assert.strictEqual(dichos.filter((d) => d.includes('IGNORAN')).length, 0, `no debe avisar: ${dichos.join(' | ')}`);
});

net._reiniciarAvisosConfig();
net.setScope([]);
net.setOutOfScope([]);
net.setRateLimit(2000);

console.log(`net-config: ${passed} ok`);
if (process.exitCode) process.exit(process.exitCode);
setTimeout(() => process.exit(process.exitCode || 0), 50);
