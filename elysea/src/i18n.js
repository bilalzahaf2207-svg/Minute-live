'use strict';
/**
 * Internationalisation. Ajouter une langue :
 *  1. ajouter son code dans LANGS ;
 *  2. ajouter ses slugs dans ROUTES ;
 *  3. ajouter son dictionnaire dans content/texts.json (l'admin peut ensuite le compléter).
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const store = require('./store');

const LANGS = ['fr', 'en'];
const DEFAULT_LANG = 'fr';
const LOCALES = { fr: 'fr_FR', en: 'en_GB' };
const INTL = { fr: 'fr-FR', en: 'en-GB' };

const ROUTES = {
  home:         { fr: '/fr/', en: '/en/' },
  product:      { fr: '/fr/coiffeuse-elysea', en: '/en/elysea-vanity' },
  design:       { fr: '/fr/conception', en: '/en/design' },
  materials:    { fr: '/fr/matieres-et-finitions', en: '/en/materials-and-finishes' },
  inspiration:  { fr: '/fr/inspiration', en: '/en/inspiration' },
  contact:      { fr: '/fr/contact', en: '/en/contact' },
  cart:         { fr: '/fr/panier', en: '/en/bag' },
  checkout:     { fr: '/fr/commande', en: '/en/checkout' },
  confirmation: { fr: '/fr/commande/confirmation', en: '/en/checkout/confirmation' },
  legalNotice:  { fr: '/fr/mentions-legales', en: '/en/legal-notice' },
  terms:        { fr: '/fr/conditions-generales-de-vente', en: '/en/terms-of-sale' },
  privacy:      { fr: '/fr/confidentialite', en: '/en/privacy' }
};
// pages indexables (sitemap)
const INDEXABLE = ['home', 'product', 'design', 'materials', 'inspiration', 'contact', 'legalNotice', 'terms', 'privacy'];

const BY_PATH = new Map();
for (const [page, m] of Object.entries(ROUTES)) for (const [lang, p] of Object.entries(m)) BY_PATH.set(p, { page, lang });

let base = null;
function baseTexts() {
  if (!base) base = JSON.parse(fs.readFileSync(path.join(config.contentDir, 'texts.json'), 'utf8'));
  return base;
}

/** Texte traduit : surcharges admin > dictionnaire par défaut > clé. */
function t(lang, key, vars) {
  const over = store.get('texts');
  let s = (over[lang] && over[lang][key]) ?? baseTexts()[lang]?.[key] ?? baseTexts()[DEFAULT_LANG]?.[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
  return s;
}

/** Valeur localisée d'un champ { fr, en }. */
function L(obj, lang) {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  return obj[lang] || obj[DEFAULT_LANG] || '';
}

function url(page, lang, query) {
  const p = (ROUTES[page] || ROUTES.home)[lang];
  return query ? `${p}?${new URLSearchParams(query)}` : p;
}

function match(pathname) {
  const p = pathname.length > 1 && pathname.endsWith('/') && !/^\/\w\w\/$/.test(pathname) ? pathname.slice(0, -1) : pathname;
  return BY_PATH.get(p) || BY_PATH.get(p + '/') || null;
}

function detect(req) {
  const al = (req.headers['accept-language'] || '').toLowerCase();
  for (const part of al.split(',')) {
    const code = part.trim().slice(0, 2);
    if (LANGS.includes(code)) return code;
  }
  return DEFAULT_LANG;
}

function allKeys() {
  const keys = new Set();
  for (const l of LANGS) Object.keys(baseTexts()[l] || {}).forEach((k) => keys.add(k));
  return [...keys];
}

module.exports = { LANGS, DEFAULT_LANG, LOCALES, INTL, ROUTES, INDEXABLE, t, L, url, match, detect, baseTexts, allKeys };
