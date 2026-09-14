'use strict';

// ============================================================================
// KNK SUITE v2.1 — Inventario de activos (CMDB ligera)
// Registro de activos del programa con estado: in-scope, testing, vulnerable,
// reported, fixed, out-of-scope. Persistido en artifacts de la sesión.
// ============================================================================

const STATUSES = ['in-scope', 'out-of-scope', 'testing', 'vulnerable', 'reported', 'fixed', 'blocked'];

function listAssets(session) {
  return session?.artifacts?.assets || [];
}

function addAsset(session, asset) {
  if (!asset || (!asset.hostname && !asset.url && !asset.name)) throw new Error('hostname/url/name requerido');
  if (!session.artifacts) session.artifacts = {};
  if (!Array.isArray(session.artifacts.assets)) session.artifacts.assets = [];
  const assets = session.artifacts.assets;
  const entry = {
    id: `A-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
    hostname: asset.hostname || '',
    url: asset.url || '',
    name: asset.name || asset.hostname || asset.url || '',
    type: asset.type || 'web',
    status: STATUSES.includes(asset.status) ? asset.status : 'in-scope',
    notes: asset.notes || '',
    createdAt: new Date().toISOString(),
  };
  assets.push(entry);
  return entry;
}

function updateAsset(session, id, patch) {
  const assets = listAssets(session);
  const asset = assets.find(a => a.id === id);
  if (!asset) throw new Error('Activo no encontrado');
  if (patch.status && !STATUSES.includes(patch.status)) throw new Error(`status inválido: ${patch.status}`);
  Object.assign(asset, patch, { updatedAt: new Date().toISOString() });
  return asset;
}

function removeAsset(session, id) {
  const assets = listAssets(session);
  const idx = assets.findIndex(a => a.id === id);
  if (idx === -1) throw new Error('Activo no encontrado');
  assets.splice(idx, 1);
}

function summary(session) {
  const assets = listAssets(session);
  const byStatus = {};
  for (const a of assets) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
  return { total: assets.length, byStatus };
}

module.exports = { STATUSES, listAssets, addAsset, updateAsset, removeAsset, summary };
