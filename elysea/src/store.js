'use strict';
/**
 * Stockage JSON sur disque.
 *  - content/  : valeurs par défaut versionnées (seed)
 *  - data/     : état vivant (modifié par l'admin, commandes, messages)
 * Écritures atomiques (fichier temporaire + rename) et sérialisées par fichier.
 * L'interface (get/set/update) permet de migrer vers une base SQL sans
 * toucher au reste de l'application.
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'outbox'), { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true });

const SEEDED = new Set(['product', 'settings', 'faq', 'testimonials']);
const cache = new Map();
const queues = new Map();

function file(name) { return path.join(config.dataDir, `${name}.json`); }

function readJSON(f, fallback) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return fallback; }
}

function get(name) {
  if (cache.has(name)) return cache.get(name);
  let v = readJSON(file(name), undefined);
  if (v === undefined) {
    if (SEEDED.has(name)) v = readJSON(path.join(config.contentDir, `${name}.json`), null);
    else if (name === 'texts') v = { fr: {}, en: {} };
    else v = [];
  }
  cache.set(name, v);
  return v;
}

function writeAtomic(f, data) {
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, f);
}

function set(name, value) {
  cache.set(name, value);
  writeAtomic(file(name), value);
  return value;
}

/** Mise à jour sérialisée : fn(current) → nouvelle valeur (ou mutation en place). */
function update(name, fn) {
  const prev = queues.get(name) || Promise.resolve();
  const next = prev.then(() => {
    const cur = get(name);
    const res = fn(cur);
    return set(name, res === undefined ? cur : res);
  });
  queues.set(name, next.catch(() => {}));
  return next;
}

function reset(name) { cache.delete(name); }

module.exports = { get, set, update, reset, file };
