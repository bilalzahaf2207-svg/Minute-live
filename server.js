#!/usr/bin/env node
/**
 * MINUTE — serveur de données réelles
 * ----------------------------------------------------------------
 * Agrège trois sources ouvertes, en direct :
 *   1. OpenStreetMap / Overpass  → les magasins réels autour d'une position
 *      (Lidl, Carrefour City, Franprix… avec horaires et coordonnées)
 *   2. Open Prices (Open Food Facts) → des prix RELEVÉS en magasin, datés,
 *      rattachés à un magasin OSM précis. ~314 000 relevés, licence ODbL.
 *   3. Open Food Facts → fiche produit : nom, marque, photo, Nutri-Score,
 *      contenance, catégories. Des millions de références, licence ODbL.
 *
 * Aucune dépendance npm. Node 18+ (fetch natif). Lancer : node server.js
 * ----------------------------------------------------------------
 * OBLIGATIONS DE LICENCE (ODbL) — non négociables :
 *   · citer « Données : Open Food Facts / Open Prices / OpenStreetMap »
 *   · redistribuer en ODbL toute base dérivée que vous publiez
 *   · renseigner un User-Agent identifiable (MINUTE_UA ci-dessous)
 */

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8787);
const UA = process.env.MINUTE_UA || 'MinuteApp/1.0 (contact: changez-moi@example.com)';
const OVERPASS = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const OPEN_PRICES = 'https://prices.openfoodfacts.org/api/v1';
const OFF = 'https://world.openfoodfacts.org/api/v2';

/* ============================ CACHE ============================ */
const TTL = { stores: 24 * 3600e3, prices: 3600e3, product: 7 * 24 * 3600e3 };
const mem = new Map();
const DISK = path.join(__dirname, '.cache');
try { fs.mkdirSync(DISK, { recursive: true }); } catch (_) {}

function diskFile(k) { return path.join(DISK, Buffer.from(k).toString('base64url').slice(0, 180) + '.json'); }
async function cached(key, ttl, producer) {
  const now = Date.now();
  const hit = mem.get(key);
  if (hit && now - hit.t < ttl) return hit.v;
  const f = diskFile(key);
  try {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (now - raw.t < ttl) { mem.set(key, raw); return raw.v; }
  } catch (_) {}
  const v = await producer();
  const rec = { t: now, v };
  mem.set(key, rec);
  try { fs.writeFileSync(f, JSON.stringify(rec)); } catch (_) {}
  return v;
}

/* ============================ HTTP ============================ */
async function getJSON(url, opts = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), opts.timeout || 25000);
  try {
    const r = await fetch(url, {
      method: opts.method || 'GET',
      body: opts.body,
      signal: ctrl.signal,
      headers: Object.assign({ 'User-Agent': UA, 'Accept': 'application/json' }, opts.headers || {})
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
    return await r.json();
  } finally { clearTimeout(to); }
}

/* ===================== 1. MAGASINS (OSM) ====================== */
const SHOP_TYPES = 'supermarket|convenience|greengrocer|deli|bakery|butcher|organic';

async function fetchStores(lat, lon, radius) {
  const key = `stores:${lat.toFixed(3)}:${lon.toFixed(3)}:${radius}`;
  return cached(key, TTL.stores, async () => {
    const q = `[out:json][timeout:25];
(
  node["shop"~"^(${SHOP_TYPES})$"](around:${radius},${lat},${lon});
  way["shop"~"^(${SHOP_TYPES})$"](around:${radius},${lat},${lon});
);
out center tags 80;`;
    const data = await getJSON(OVERPASS, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(q),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return (data.elements || []).map(e => {
      const t = e.tags || {};
      const plat = e.lat != null ? e.lat : (e.center && e.center.lat);
      const plon = e.lon != null ? e.lon : (e.center && e.center.lon);
      if (plat == null) return null;
      return {
        id: String(e.id),
        osmType: (e.type || 'node').toUpperCase(),
        name: t.name || t.brand || t.operator || 'Commerce alimentaire',
        brand: t.brand || t['brand:wikidata'] ? (t.brand || null) : null,
        shop: t.shop || null,
        opening_hours: t.opening_hours || null,
        street: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || null,
        city: t['addr:city'] || null,
        lat: plat, lon: plon,
        dist: Math.round(haversine(lat, lon, plat, plon))
      };
    }).filter(Boolean).sort((a, b) => a.dist - b.dist);
  });
}
function haversine(a1, o1, a2, o2) {
  const R = 6371000, r = Math.PI / 180;
  const dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const x = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/* ============ 2. PRIX RELEVÉS (Open Prices) ============ */
/* Forme de réponse vérifiée en production le 19/09/2026 :
   { items:[ { price, currency, date, product_code,
               product:{product_name,image_url,brands,quantity,
                        product_quantity,product_quantity_unit,
                        nutriscore_grade,categories_tags},
               location:{osm_id,osm_name,osm_brand,...} } ],
     page, pages, size, total }                                     */
async function fetchStorePrices(osmId, osmType, size = 100) {
  const key = `prices:${osmType}:${osmId}:${size}`;
  return cached(key, TTL.prices, async () => {
    const url = `${OPEN_PRICES}/prices?location_osm_id=${encodeURIComponent(osmId)}`
      + `&location_osm_type=${encodeURIComponent(osmType)}&order_by=-date&size=${size}&page=1`;
    const d = await getJSON(url);
    return (d.items || []).filter(i => i.price != null && i.product_code);
  });
}
async function fetchProductPrices(code, size = 50) {
  const key = `pprices:${code}:${size}`;
  return cached(key, TTL.prices, async () => {
    const url = `${OPEN_PRICES}/prices?product_code=${encodeURIComponent(code)}&order_by=-date&size=${size}&page=1`;
    const d = await getJSON(url);
    return (d.items || []).filter(i => i.price != null);
  });
}

/* ============ 3. FICHE PRODUIT (Open Food Facts) ============ */
const OFF_FIELDS = 'code,product_name,product_name_fr,brands,quantity,product_quantity,' +
  'product_quantity_unit,categories_tags,nutriscore_grade,nova_group,image_front_small_url,image_front_url';

async function fetchProduct(code) {
  return cached(`off:${code}`, TTL.product, async () => {
    try {
      const d = await getJSON(`${OFF}/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
      return d && d.product ? d.product : null;
    } catch (_) { return null; }
  });
}
async function searchProducts(q, page = 1) {
  return cached(`offq:${q}:${page}`, TTL.product, async () => {
    const url = `${OFF}/search?search_terms=${encodeURIComponent(q)}&countries_tags_en=france`
      + `&fields=${OFF_FIELDS}&page_size=40&page=${page}`;
    try { const d = await getJSON(url); return d.products || []; } catch (_) { return []; }
  });
}

/* ==================== NORMALISATION ==================== */
/* Contenance → quantité dans une unité de base comparable.
   C'est ce qui permet de comparer un 250 g et un 1 kg honnêtement. */
function normQuantity(p) {
  const pq = Number(p && p.product_quantity);
  const u = (p && p.product_quantity_unit || '').toLowerCase();
  if (pq > 0) {
    if (u === 'g') return { qty: pq / 1000, unit: 'kg' };
    if (u === 'kg') return { qty: pq, unit: 'kg' };
    if (u === 'ml' || u === 'cl' || u === 'l') {
      const l = u === 'ml' ? pq / 1000 : u === 'cl' ? pq / 100 : pq;
      return { qty: l, unit: 'L' };
    }
  }
  const s = String((p && p.quantity) || '').toLowerCase().replace(',', '.');
  let m = s.match(/([\d.]+)\s*(kg|g|l|cl|ml)/);
  if (m) {
    const n = parseFloat(m[1]);
    if (m[2] === 'kg') return { qty: n, unit: 'kg' };
    if (m[2] === 'g') return { qty: n / 1000, unit: 'kg' };
    if (m[2] === 'l') return { qty: n, unit: 'L' };
    if (m[2] === 'cl') return { qty: n / 100, unit: 'L' };
    if (m[2] === 'ml') return { qty: n / 1000, unit: 'L' };
  }
  m = s.match(/x\s*(\d+)|(\d+)\s*(?:pi[eè]ces?|unit[ée]s?|sachets?)/);
  if (m) return { qty: parseInt(m[1] || m[2], 10), unit: 'unité' };
  return { qty: 1, unit: 'unité' };
}

/* Regroupement en « familles » : un besoin = une famille, plusieurs
   variantes interchangeables. On s'appuie sur la catégorie OFF la plus
   spécifique, sinon sur le nom nettoyé de sa marque. */
const STOP = /^(en|fr):/;
function familyKey(p) {
  const cats = (p && p.categories_tags) || [];
  if (cats.length) {
    const useful = cats.filter(c => !/^(en:)?(plant-based-foods|beverages|groceries|foods|dairies|meats|snacks)$/i.test(c.replace(STOP, '')));
    const pick = useful.length ? useful[useful.length - 1] : cats[cats.length - 1];
    return 'cat:' + pick.replace(STOP, '');
  }
  const brands = String((p && p.brands) || '').split(',')[0].trim().toLowerCase();
  let n = String((p && (p.product_name_fr || p.product_name)) || '').toLowerCase();
  if (brands) n = n.replace(brands, '');
  n = n.replace(/[^a-zà-ÿ ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join('-');
  return 'nom:' + (n || 'divers');
}
function familyLabel(key, sample) {
  if (key.startsWith('cat:')) {
    return key.slice(4).replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase());
  }
  return String((sample.product_name_fr || sample.product_name || 'Produit')).trim();
}
function catOf(p) {
  const c = ((p && p.categories_tags) || []).join(' ');
  if (/baby|infant|bebe|bébé|couche/i.test(c)) return 'bebe';
  if (/beverage|water|juice|soda|drink/i.test(c)) return 'boissons';
  if (/dairy|dairies|cheese|yogurt|milk|butter/i.test(c)) return 'frais';
  if (/frozen|surgel/i.test(c)) return 'surgele';
  if (/fruit|vegetable|legume/i.test(c)) return 'fruits';
  if (/snack|biscuit|chips|chocolate|confection/i.test(c)) return 'snack';
  if (/cleaning|hygiene|detergent|paper/i.test(c)) return 'hygiene';
  return 'epicerie';
}

/* ============ COMPOSITION DU CATALOGUE ============ */
async function buildCatalog(lat, lon, radius, maxStores) {
  const all = await fetchStores(lat, lon, radius);
  const stores = all.slice(0, maxStores);

  /* Les relevés de prix sont récupérés magasin par magasin, en parallèle
     mais par lots, pour rester poli avec l'API Open Prices. */
  const byStore = {};
  for (let i = 0; i < stores.length; i += 4) {
    const lot = stores.slice(i, i + 4);
    const res = await Promise.all(lot.map(s =>
      fetchStorePrices(s.id, s.osmType).catch(() => [])));
    lot.forEach((s, k) => { byStore[s.id] = res[k]; });
  }

  /* Un produit = un code-barres. On garde le relevé le plus récent
     par (magasin, produit). */
  const products = new Map();
  for (const s of stores) {
    for (const item of (byStore[s.id] || [])) {
      const code = item.product_code;
      if (!products.has(code)) products.set(code, { code, off: item.product || null, prices: {} });
      const e = products.get(code);
      const prev = e.prices[s.id];
      if (!prev || new Date(item.date) > new Date(prev.date)) {
        e.prices[s.id] = { value: item.price, date: item.date, currency: item.currency || 'EUR',
                           discounted: !!item.price_is_discounted };
      }
      if (!e.off || !e.off.product_name) e.off = item.product || e.off;
    }
  }

  /* Complétion des fiches incomplètes auprès d'Open Food Facts. */
  const incomplets = [...products.values()]
    .filter(p => !p.off || !p.off.product_name).slice(0, 60);
  for (let i = 0; i < incomplets.length; i += 6) {
    const lot = incomplets.slice(i, i + 6);
    const res = await Promise.all(lot.map(p => fetchProduct(p.code)));
    lot.forEach((p, k) => { if (res[k]) p.off = Object.assign({}, p.off, res[k]); });
  }

  /* Regroupement en familles comparables. */
  const fams = new Map();
  for (const p of products.values()) {
    const off = p.off || {};
    if (!off.product_name && !off.product_name_fr) continue;
    const key = familyKey(off);
    if (!fams.has(key)) {
      fams.set(key, { key, name: familyLabel(key, off), cat: catOf(off), unit: 'unité', variants: [] });
    }
    const f = fams.get(key);
    const nq = normQuantity(off);
    f.unit = nq.unit;
    f.variants.push({
      code: p.code,
      name: (off.product_name_fr || off.product_name || '').trim(),
      brand: String(off.brands || '').split(',')[0].trim() || null,
      size: off.quantity || null,
      qty: nq.qty, unit: nq.unit,
      nutri: (off.nutriscore_grade || '').toUpperCase().slice(0, 1) || null,
      nova: off.nova_group || null,
      image: off.image_front_small_url || off.image_front_url || null,
      prices: p.prices
    });
  }

  /* On ne garde que ce qui est réellement comparable : au moins deux
     variantes, ou au moins un prix relevé. */
  const families = [...fams.values()]
    .map(f => {
      f.variants.sort((a, b) => {
        const ua = cheapestUnit(a), ub = cheapestUnit(b);
        return (ua == null ? 1e9 : ua) - (ub == null ? 1e9 : ub);
      });
      return f;
    })
    .filter(f => f.variants.some(v => Object.keys(v.prices).length));

  return {
    generatedAt: new Date().toISOString(),
    query: { lat, lon, radius },
    stores, families,
    counts: { stores: stores.length, produits: products.size, familles: families.length },
    sources: [
      { nom: 'OpenStreetMap (Overpass)', usage: 'magasins, horaires, position', licence: 'ODbL' },
      { nom: 'Open Prices — Open Food Facts', usage: 'prix relevés en magasin, datés', licence: 'ODbL' },
      { nom: 'Open Food Facts', usage: 'nom, marque, photo, Nutri-Score, contenance', licence: 'ODbL' }
    ]
  };
}
function cheapestUnit(v) {
  const ps = Object.values(v.prices || {});
  if (!ps.length || !v.qty) return null;
  return Math.min(...ps.map(p => p.value)) / v.qty;
}

/* ========================= ROUTES ========================= */
const routes = {
  '/api/health': async () => ({ ok: true, ts: Date.now(), ua: UA }),

  '/api/stores': async q => {
    const lat = Number(q.get('lat')), lon = Number(q.get('lon'));
    if (!isFinite(lat) || !isFinite(lon)) throw httpErr(400, 'lat et lon requis');
    return { stores: await fetchStores(lat, lon, Number(q.get('radius') || 2500)) };
  },

  '/api/catalog': async q => {
    const lat = Number(q.get('lat')), lon = Number(q.get('lon'));
    if (!isFinite(lat) || !isFinite(lon)) throw httpErr(400, 'lat et lon requis');
    return buildCatalog(lat, lon, Number(q.get('radius') || 2500), Number(q.get('stores') || 12));
  },

  '/api/product': async q => {
    const code = q.get('code');
    if (!code) throw httpErr(400, 'code requis');
    const [off, prices] = await Promise.all([fetchProduct(code), fetchProductPrices(code)]);
    return { code, product: off, prices };
  },

  '/api/search': async q => {
    const s = q.get('q');
    if (!s) throw httpErr(400, 'q requis');
    return { products: await searchProducts(s, Number(q.get('page') || 1)) };
  },

  /* Le comparateur : le même produit, partout où il a été relevé. */
  '/api/compare': async q => {
    const code = q.get('code');
    if (!code) throw httpErr(400, 'code requis');
    const lat = Number(q.get('lat')), lon = Number(q.get('lon'));
    const prices = await fetchProductPrices(code, 100);
    const rows = prices.map(p => {
      const L = p.location || {};
      const d = (isFinite(lat) && L.osm_lat != null) ? Math.round(haversine(lat, lon, L.osm_lat, L.osm_lon)) : null;
      return {
        magasin: L.osm_brand || L.osm_name || 'Magasin', ville: L.osm_address_city || null,
        osmId: L.osm_id, prix: p.price, devise: p.currency || 'EUR',
        date: p.date, remise: !!p.price_is_discounted, distance: d
      };
    }).filter(r => r.distance == null || r.distance < 30000)
      .sort((a, b) => a.prix - b.prix);
    return { code, releves: rows.length, moinsCher: rows[0] || null, rows };
  }
};
function httpErr(code, msg) { const e = new Error(msg); e.code = code; return e; }

/* ======================== SERVEUR ======================== */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const route = routes[u.pathname];
  if (route) {
    const t0 = Date.now();
    try {
      const out = await route(u.searchParams);
      const body = JSON.stringify(out);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
      res.end(body);
      console.log(`200 ${u.pathname} ${Date.now() - t0}ms ${(body.length / 1024).toFixed(0)}ko`);
    } catch (e) {
      const code = e.code && e.code < 600 ? e.code : 502;
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
      console.error(`${code} ${u.pathname} — ${e.message}`);
    }
    return;
  }

  // Fichiers statiques
  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  const file = path.join(__dirname, 'public', path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  MINUTE — serveur de données réelles`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  User-Agent : ${UA}`);
  if (/changez-moi/.test(UA)) console.log(`  ⚠  Définissez MINUTE_UA avec un contact réel (exigé par Open Food Facts).`);
  console.log(`  Sources : OpenStreetMap · Open Prices · Open Food Facts (ODbL)\n`);
});
