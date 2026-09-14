'use strict';

// Laboratorio completamente local: no usa red, cuentas reales, cookies ni
// proveedores externos. Sirve para practicar el flujo A/B antes de usar Burp
// con un programa autorizado.

const RESOURCE_TYPES = new Set(['file', 'conversation']);
const SECRET_RE = /\b(?:sk-[A-Za-z0-9_-]{20,}|sess-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/;

function assertAccount(account) {
  if (!['A', 'B'].includes(account)) throw new Error('Cuenta sintética no válida');
}

function assertType(type) {
  if (!RESOURCE_TYPES.has(type)) throw new Error('Tipo de recurso no válido');
}

function assertSynthetic(content) {
  const text = String(content || '');
  if (!text.startsWith('SYNTHETIC-')) throw new Error('El laboratorio solo acepta contenido sintético');
  if (SECRET_RE.test(text)) throw new Error('El contenido parece contener un secreto');
  return text;
}

class RevocationLab {
  constructor({ enforceRevocation = true } = {}) {
    this.enforceRevocation = enforceRevocation;
    this.nextId = 1;
    this.resources = new Map();
    this.audit = [];
  }

  _event(action, details = {}) {
    this.audit.push({ at: new Date().toISOString(), action, ...details });
  }

  create(account, type, content) {
    assertAccount(account);
    assertType(type);
    const resource = {
      id: `synthetic-${this.nextId++}`,
      owner: account,
      type,
      content: assertSynthetic(content),
      sharedWith: new Set(),
      revoked: false,
    };
    this.resources.set(resource.id, resource);
    this._event('create', { account, resourceId: resource.id, type });
    return { id: resource.id, type, owner: account };
  }

  share(account, resourceId, target) {
    assertAccount(account);
    assertAccount(target);
    const resource = this.resources.get(resourceId);
    if (!resource) return { status: 404, error: 'Recurso no encontrado' };
    if (resource.owner !== account) return { status: 403, error: 'Solo el propietario puede compartir' };
    if (resource.revoked) return { status: 409, error: 'Recurso ya revocado' };
    resource.sharedWith.add(target);
    this._event('share', { account, target, resourceId });
    return { status: 204 };
  }

  revoke(account, resourceId) {
    assertAccount(account);
    const resource = this.resources.get(resourceId);
    if (!resource) return { status: 404, error: 'Recurso no encontrado' };
    if (resource.owner !== account) return { status: 403, error: 'Solo el propietario puede revocar' };
    resource.revoked = true;
    resource.sharedWith.clear();
    this._event('revoke', { account, resourceId });
    return { status: 204 };
  }

  read(account, resourceId) {
    assertAccount(account);
    const resource = this.resources.get(resourceId);
    if (!resource) return { status: 404, body: null };
    const allowed = resource.owner === account || resource.sharedWith.has(account);
    // Esta opción permite reproducir en local un fallo de implementación para
    // comprobar que el análisis lo detecta; nunca se conecta a un servicio real.
    const authorizationBugAllowed = !this.enforceRevocation && account !== resource.owner && !resource.sharedWith.has(account);
    const revokedAllowed = resource.revoked && !this.enforceRevocation && account !== resource.owner;
    if (!allowed && !authorizationBugAllowed && !revokedAllowed) return { status: 403, body: null };
    return { status: 200, body: { id: resource.id, type: resource.type, content: resource.content } };
  }

  update(account, resourceId, content) {
    assertAccount(account);
    const resource = this.resources.get(resourceId);
    if (!resource) return { status: 404 };
    const allowed = resource.owner === account || resource.sharedWith.has(account);
    const authorizationBugAllowed = !this.enforceRevocation && account !== resource.owner && !resource.sharedWith.has(account);
    const revokedAllowed = resource.revoked && !this.enforceRevocation && account !== resource.owner;
    if ((!allowed && !authorizationBugAllowed && !revokedAllowed) || (resource.revoked && this.enforceRevocation)) return { status: 403 };
    resource.content = assertSynthetic(content);
    this._event('update', { account, resourceId });
    return { status: 204 };
  }

  runIdorScenario(type = 'file') {
    assertType(type);
    const created = this.create('B', type, `SYNTHETIC-${type}-private-b-only`);
    const baseline = this.read('B', created.id);
    const readWithA = this.read('A', created.id);
    const readWithAAgain = this.read('A', created.id);
    const writeWithA = this.update('A', created.id, `SYNTHETIC-${type}-unauthorized-change`);
    return {
      resource: created,
      baseline,
      readWithA,
      readWithAAgain,
      writeWithA,
      reproducible: readWithA.status === readWithAAgain.status,
      secure: baseline.status === 200 && readWithA.status === 403 && readWithAAgain.status === 403 && writeWithA.status === 403,
      vulnerable: baseline.status === 200 && readWithA.status === 200 && writeWithA.status === 204,
      audit: this.audit.slice(),
    };
  }

  runScenario(type = 'file') {
    assertType(type);
    const created = this.create('A', type, `SYNTHETIC-${type}-private-content`);
    const shared = this.share('A', created.id, 'B');
    const baseline = this.read('B', created.id);
    const revoked = this.revoke('A', created.id);
    const afterRead = this.read('B', created.id);
    const afterReadAgain = this.read('B', created.id);
    const afterWrite = this.update('B', created.id, `SYNTHETIC-${type}-modified-content`);
    return {
      resource: created,
      shared,
      baseline,
      revoked,
      afterRead,
      afterReadAgain,
      afterWrite,
      reproducible: afterRead.status === afterReadAgain.status,
      secure: baseline.status === 200 && afterRead.status === 403 && afterReadAgain.status === 403 && afterWrite.status === 403,
      audit: this.audit.slice(),
    };
  }
}

module.exports = { RevocationLab, RESOURCE_TYPES, assertSynthetic };
