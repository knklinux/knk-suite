'use strict';

// ============================================================================
// KNK SUITE v2.1 — Threat Intelligence (CTI)
// Ingiere feeds de IoCs que el operador proporciona (texto, CSV o STIX JSON)
// y los normaliza para usarlos con el módulo de hunt. Sin scraping externo.
// ============================================================================

const hunt = require('./hunt');

const SOURCE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Detecta el formato del feed.
 */
function detectFormat(text) {
  const t = String(text || '').trim();
  if (t.startsWith('{') || t.startsWith('[')) return 'stix';
  if (/\n[,;]/i.test(t) || /^[^,]+,[^,]+,/i.test(t.split('\n')[0] || '')) return 'csv';
  return 'ioc';
}

/**
 * Extrae tipo de objeto STIX (indicator, ipv4-addr, domain-name, file, url).
 */
function stixTypeOf(obj) {
  return obj?.type || obj?.pattern?.split('[')[0]?.trim() || 'indicator';
}

/**
 * Parsea un feed y devuelve IoCs normalizados.
 * @param {string} text
 * @param {string} [format] - 'ioc' | 'csv' | 'stix' (auto si no se indica)
 */
function parseFeed(text, format) {
  const source = String(text || '').slice(0, SOURCE_MAX_BYTES);
  if (!source.trim()) throw new Error('feed vacío');
  const fmt = format || detectFormat(source);
  const iocs = { ips: [], domains: [], hashes: [], emails: [], urls: [], patterns: [] };
  const add = (list, value) => { const v = String(value || '').trim().toLowerCase(); if (v && !list.includes(v)) list.push(v); };

  if (fmt === 'stix') {
    const doc = JSON.parse(source);
    const objects = Array.isArray(doc) ? doc : (doc.objects || []);
    for (const obj of objects) {
      const t = stixTypeOf(obj);
      if (t === 'ipv4-addr' && obj.value) add(iocs.ips, obj.value);
      else if (t === 'domain-name' && obj.value) add(iocs.domains, obj.value);
      else if (t === 'url' && obj.value) add(iocs.urls, obj.value);
      else if (t === 'file' && obj.hashes) {
        for (const h of Object.values(obj.hashes)) add(iocs.hashes, h);
      } else if (obj.pattern) {
        // pattern STIX: [ipv4-addr:value = '1.2.3.4']
        const m = obj.pattern.match(/'([^']+)'/g) || [];
        for (const mm of m) {
          const val = mm.replace(/'/g, '');
          const tmp = hunt.parseIocs(val);
          iocs.ips.push(...tmp.ips); iocs.domains.push(...tmp.domains); iocs.hashes.push(...tmp.hashes); iocs.urls.push(...tmp.urls);
        }
        add(iocs.patterns, obj.pattern);
      }
    }
  } else if (fmt === 'csv') {
    for (const line of source.split(/\r?\n/)) {
      if (!line.trim() || line.startsWith('#')) continue;
      const cols = line.split(/[,;]/);
      // Buscar en todas las columnas tipos reconocibles
      const tmp = hunt.parseIocs(cols.join(' '));
      iocs.ips.push(...tmp.ips); iocs.domains.push(...tmp.domains); iocs.hashes.push(...tmp.hashes); iocs.urls.push(...tmp.urls); iocs.emails.push(...tmp.emails);
    }
  } else {
    const tmp = hunt.parseIocs(source);
    for (const k of ['ips', 'domains', 'hashes', 'emails', 'urls']) iocs[k] = tmp[k] || [];
  }

  // Deduplicar (solo campos de listas, nunca total)
  for (const k of ['ips', 'domains', 'hashes', 'emails', 'urls', 'patterns']) iocs[k] = [...new Set(iocs[k])];
  iocs.total = iocs.ips.length + iocs.domains.length + iocs.hashes.length + iocs.emails.length + iocs.urls.length + iocs.patterns.length;
  return { format: fmt, iocs, ingestedAt: new Date().toISOString() };
}

/**
 * Integra un feed con hunt: escanea un log con los IoCs del feed.
 */
function scanWithFeed(logText, feedResult) {
  return hunt.huntIocs(logText, feedResult?.iocs || {});
}

module.exports = { parseFeed, detectFormat, scanWithFeed, SOURCE_MAX_BYTES };
