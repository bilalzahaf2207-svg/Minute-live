'use strict';
/**
 * Administration : authentification par mot de passe (ADMIN_PASSWORD),
 * session en cookie HttpOnly/SameSite=Strict, en-tête anti-CSRF obligatoire.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const store = require('./store');
const commerce = require('./commerce');
const mail = require('./mail');
const i18n = require('./i18n');
const { paymentMode } = require('./payments');
const { json, send, readJSON, readBody, parseCookies, rateLimit, clientIp, escapeHtml: e } = require('./http');
const { asset } = require('./views/layout');

const COOKIE = 'ely_admin';
const sessions = new Map();

function sha(s) { return crypto.createHash('sha256').update(String(s)).digest(); }
function checkPassword(pw) {
  if (!config.admin.password) return false;
  return crypto.timingSafeEqual(sha(pw), sha(config.admin.password));
}
function authed(req) {
  const tok = parseCookies(req)[COOKIE];
  const s = tok && sessions.get(tok);
  if (!s) return false;
  if (s.exp < Date.now()) { sessions.delete(tok); return false; }
  return true;
}
function cookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.isProd ? '; Secure' : ''}`;
}

/* ---------------------- validation légère --------------------------- */
const str = (v, n = 2000) => String(v ?? '').slice(0, n);
const loc = (v, n) => Object.fromEntries(i18n.LANGS.map((l) => [l, str(v?.[l], n)]));
const int = (v, min = 0, max = 1e9) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)));
const cents = (v) => int(v, 0, 1e8);

function sanitizeProduct(b, cur) {
  const out = { ...cur };
  out.name = loc(b.name, 120); out.tagline = loc(b.tagline, 300);
  out.sku = str(b.sku, 60) || cur.sku;
  out.price = cents(b.price);
  out.compareAtPrice = b.compareAtPrice ? cents(b.compareAtPrice) : null;
  const pr = b.promotion || {};
  out.promotion = { active: !!pr.active, type: pr.type === 'amount' ? 'amount' : 'percent', value: pr.type === 'amount' ? cents(pr.value) : int(pr.value, 0, 90), label: loc(pr.label, 60), endsAt: pr.endsAt ? str(pr.endsAt, 40) : null };
  out.variants = (Array.isArray(b.variants) ? b.variants : []).slice(0, 30).map((v) => ({
    id: str(v.id, 60).toLowerCase().replace(/[^a-z0-9-]/g, '-') || crypto.randomBytes(3).toString('hex'),
    sku: str(v.sku, 60), name: loc(v.name, 80),
    swatch: (Array.isArray(v.swatch) ? v.swatch : []).slice(0, 2).map((c) => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : '#cccccc')),
    priceDelta: int(v.priceDelta, -1e7, 1e7), stock: int(v.stock, 0, 1e6), active: v.active !== false, image: str(v.image, 80)
  }));
  if (!out.variants.length) throw Object.assign(new Error('Au moins une variante est requise'), { status: 422 });
  out.gallery = (Array.isArray(b.gallery) ? b.gallery : []).slice(0, 40).map((g) => ({
    id: str(g.id, 80), src: /^\/(img|uploads)\/[\w\-/]+$/.test(g.src) ? g.src : '', widths: (g.widths || []).map((w) => int(w, 1, 4000)).slice(0, 5),
    formats: (g.formats || []).filter((f) => ['avif', 'webp', 'jpg'].includes(f)), ratio: /^\d+\/\d+$/.test(g.ratio) ? g.ratio : '4/5', alt: loc(g.alt, 200), label: loc(g.label, 60)
  })).filter((g) => g.src && g.widths.length && g.formats.length);
  out.dimensions = { width: int(b.dimensions?.width, 1, 1000), depth: int(b.dimensions?.depth, 1, 1000), height: int(b.dimensions?.height, 1, 1000), unit: 'cm' };
  out.logistics = { volume: loc(b.logistics?.volume, 40), grossWeight: loc(b.logistics?.grossWeight, 40) };
  out.model3d = b.model3d && /^\/uploads\/[\w-]+\.glb$/.test(b.model3d) ? b.model3d : null;
  out.updatedAt = new Date().toISOString();
  return out;
}

function sanitizeSettings(b, cur) {
  const out = { ...cur };
  for (const k of ['storeName', 'siteUrl', 'legalName', 'contactEmail', 'orderNotificationEmail', 'phone', 'companyId', 'vatNumber']) out[k] = str(b[k], 200);
  out.address = str(b.address, 500);
  out.currency = /^[A-Z]{3}$/.test(b.currency) ? b.currency : 'EUR';
  out.showLowStock = !!b.showLowStock; out.lowStockThreshold = int(b.lowStockThreshold, 0, 100);
  out.payments = { demoMode: !!b.payments?.demoMode };
  out.shipping = {
    configured: !!b.shipping?.configured,
    zones: (b.shipping?.zones || []).slice(0, 30).map((z) => ({
      id: str(z.id, 40) || crypto.randomBytes(3).toString('hex'), name: loc(z.name, 80),
      countries: (z.countries || []).map((c) => str(c, 2).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)),
      rate: cents(z.rate), perAdditionalItem: cents(z.perAdditionalItem), freeOver: z.freeOver ? cents(z.freeOver) : null, delay: loc(z.delay, 120)
    }))
  };
  out.policies = Object.fromEntries(['delivery', 'returns', 'warranty', 'care'].map((k) => [k, loc(b.policies?.[k], 5000)]));
  out.legal = Object.fromEntries(['legalNotice', 'terms', 'privacy'].map((k) => [k, loc(b.legal?.[k], 60000)]));
  out.reassurance = (b.reassurance || []).slice(0, 6).map((r) => ({ icon: ['lock', 'truck', 'ruler', 'chat', 'check', 'layers'].includes(r.icon) ? r.icon : 'check', title: loc(r.title, 60), text: loc(r.text, 120) }));
  out.social = { instagram: /^https:\/\//.test(b.social?.instagram) ? str(b.social.instagram, 200) : '', pinterest: /^https:\/\//.test(b.social?.pinterest) ? str(b.social.pinterest, 200) : '' };
  return out;
}

function warnings() {
  const s = store.get('settings'); const p = store.get('product');
  const w = [];
  if (!config.stripe.secretKey) w.push({ level: 'warn', text: 'Stripe non configuré (STRIPE_SECRET_KEY) — paiement en mode ' + paymentMode() + '.' });
  else if (!config.stripe.webhookSecret) w.push({ level: 'warn', text: 'STRIPE_WEBHOOK_SECRET manquant : les paiements ne seront confirmés que par vérification à la page de retour.' });
  if (!s.shipping?.configured) w.push({ level: 'warn', text: 'Frais de livraison : valeurs d’exemple. Vérifiez-les puis cochez « Livraison configurée ».' });
  for (const [k, label] of [['delivery', 'de livraison'], ['returns', 'de retour'], ['warranty', 'de garantie']]) if (!s.policies?.[k]?.fr) w.push({ level: 'info', text: `Conditions ${label} non renseignées : la FAQ affiche un message d’attente.` });
  if (!s.contactEmail) w.push({ level: 'warn', text: 'Aucun e-mail de contact : les notifications de commande ne peuvent pas être envoyées.' });
  if (!s.legal?.legalNotice?.fr || !s.legal?.terms?.fr) w.push({ level: 'warn', text: 'Mentions légales / CGV à compléter avant l’ouverture.' });
  if (!p.updatedAt) w.push({ level: 'info', text: 'Le prix affiché est une valeur d’exemple : vérifiez-le dans Produit.' });
  if (config.mail.provider === 'outbox') w.push({ level: 'info', text: 'E-mails en mode « outbox » (non envoyés) : configurez RESEND_API_KEY pour l’envoi réel.' });
  for (const v of p.variants) if (v.stock <= (s.lowStockThreshold || 0)) w.push({ level: 'warn', text: `Stock faible : ${v.name.fr} (${v.stock}).` });
  return w;
}

function dashboard() {
  const orders = store.get('orders');
  const paid = orders.filter((o) => o.payment.status === 'paid' && o.status !== 'refunded' && o.status !== 'cancelled');
  const since = Date.now() - 30 * 864e5;
  return {
    orders: orders.length,
    toShip: orders.filter((o) => o.status === 'paid' || o.status === 'preparing').length,
    revenue30: paid.filter((o) => new Date(o.createdAt).getTime() > since).reduce((s, o) => s + o.total, 0),
    revenueAll: paid.reduce((s, o) => s + o.total, 0),
    unreadMessages: store.get('messages').filter((m) => !m.read).length,
    paymentMode: paymentMode(), mailProvider: config.mail.provider,
    stock: store.get('product').variants.map((v) => ({ id: v.id, name: v.name.fr, stock: v.stock })),
    recent: orders.slice(0, 6).map((o) => ({ id: o.id, at: o.createdAt, status: o.status, total: o.total, name: `${o.customer.firstName} ${o.customer.lastName}` })),
    warnings: warnings()
  };
}

/* ---------------------------- uploads ------------------------------- */
const SIG = {
  webp: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP',
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8,
  png: (b) => b.slice(1, 4).toString() === 'PNG',
  glb: (b) => b.slice(0, 4).toString() === 'glTF'
};
async function upload(req, query) {
  const ext = String(query.get('ext') || '');
  if (!SIG[ext]) throw Object.assign(new Error('Format non pris en charge'), { status: 415 });
  const buf = await readBody(req, ext === 'glb' ? 40e6 : 12e6);
  if (!SIG[ext](buf)) throw Object.assign(new Error('Fichier invalide'), { status: 415 });
  const base = String(query.get('base') || crypto.randomBytes(6).toString('hex')).replace(/[^\w-]/g, '').slice(0, 60);
  const w = query.get('w') ? `-${int(query.get('w'), 1, 4000)}` : '';
  const name = `${base}${w}.${ext}`;
  fs.writeFileSync(path.join(config.dataDir, 'uploads', name), buf);
  return { path: `/uploads/${name}`, base: `/uploads/${base}` };
}

/* ----------------------------- page --------------------------------- */
function adminPage(req, res) {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Administration — ELYSÉA</title><meta name="robots" content="noindex,nofollow"><link rel="icon" href="/img/favicon.svg">
<link rel="stylesheet" href="${asset('/css/admin.css')}"></head>
<body><div id="app" data-langs='${e(JSON.stringify(i18n.LANGS))}'><p class="boot">Chargement…</p></div>
<script type="module" src="${asset('/js/admin.js')}"></script></body></html>`;
  send(req, res, 200, html, 'text/html; charset=utf-8', { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
}

/* ----------------------------- routes ------------------------------- */
async function handle(req, res, pathname, query) {
  if (pathname === '/admin' || pathname === '/admin/') return adminPage(req, res);
  if (!pathname.startsWith('/admin/api/')) return json(req, res, 404, { error: 'not_found' });
  const route = pathname.slice('/admin/api/'.length);
  const method = req.method;

  if (method !== 'GET' && req.headers['x-requested-with'] !== 'elysea-admin') return json(req, res, 403, { error: 'csrf' });

  if (route === 'login' && method === 'POST') {
    if (!rateLimit(`login:${clientIp(req)}`, 10, 15 * 60e3)) return json(req, res, 429, { error: 'Trop de tentatives, réessayez plus tard.' });
    const b = await readJSON(req, 2e3);
    if (!config.admin.password) return json(req, res, 503, { error: 'ADMIN_PASSWORD n’est pas défini sur le serveur.' });
    if (!checkPassword(b.password || '')) return json(req, res, 401, { error: 'Mot de passe incorrect.' });
    const tok = crypto.randomBytes(32).toString('hex');
    const maxAge = config.admin.sessionHours * 3600;
    sessions.set(tok, { exp: Date.now() + maxAge * 1000 });
    return json(req, res, 200, { ok: true }, { 'Set-Cookie': cookie(tok, maxAge) });
  }
  if (route === 'logout' && method === 'POST') {
    sessions.delete(parseCookies(req)[COOKIE]);
    return json(req, res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  }
  if (route === 'me') return json(req, res, 200, { authenticated: authed(req), defaultPassword: !config.isProd && !process.env.ADMIN_PASSWORD });
  if (!authed(req)) return json(req, res, 401, { error: 'unauthorized' });

  if (route === 'dashboard') return json(req, res, 200, dashboard());

  if (route === 'product') {
    if (method === 'GET') return json(req, res, 200, store.get('product'));
    if (method === 'PUT') { const b = await readJSON(req, 5e5); const v = sanitizeProduct(b, store.get('product')); store.set('product', v); return json(req, res, 200, v); }
  }
  if (route === 'settings') {
    if (method === 'GET') return json(req, res, 200, store.get('settings'));
    if (method === 'PUT') { const b = await readJSON(req, 1e6); const v = sanitizeSettings(b, store.get('settings')); store.set('settings', v); return json(req, res, 200, v); }
  }
  if (route === 'faq') {
    if (method === 'GET') return json(req, res, 200, store.get('faq'));
    if (method === 'PUT') {
      const b = await readJSON(req, 5e5);
      const cats = ['product', 'dimensions', 'delivery', 'returns', 'warranty', 'care', 'order'];
      const v = (Array.isArray(b) ? b : []).slice(0, 100).map((f) => ({ id: str(f.id, 40) || `q-${crypto.randomBytes(3).toString('hex')}`, category: cats.includes(f.category) ? f.category : 'product', ...(f.policy ? { policy: str(f.policy, 20) } : {}), q: loc(f.q, 300), a: loc(f.a, 4000) }));
      store.set('faq', v); return json(req, res, 200, v);
    }
  }
  if (route === 'testimonials') {
    if (method === 'GET') return json(req, res, 200, store.get('testimonials'));
    if (method === 'PUT') {
      const b = await readJSON(req, 2e5);
      const v = (Array.isArray(b) ? b : []).slice(0, 50).map((x) => ({ id: str(x.id, 40) || crypto.randomBytes(3).toString('hex'), author: str(x.author, 80), city: str(x.city, 80), text: loc(x.text, 1000), published: x.published !== false }));
      store.set('testimonials', v); return json(req, res, 200, v);
    }
  }
  if (route === 'texts') {
    if (method === 'GET') return json(req, res, 200, { langs: i18n.LANGS, keys: i18n.allKeys(), base: i18n.baseTexts(), overrides: store.get('texts') });
    if (method === 'PUT') {
      const b = await readJSON(req, 1e6);
      const keys = new Set(i18n.allKeys());
      const base = i18n.baseTexts();
      const v = {};
      for (const l of i18n.LANGS) {
        v[l] = {};
        for (const [k, val] of Object.entries(b?.[l] || {})) if (keys.has(k) && typeof val === 'string' && val !== base[l]?.[k]) v[l][k] = val.slice(0, 5000);
      }
      store.set('texts', v); return json(req, res, 200, v);
    }
  }
  if (route === 'orders' && method === 'GET') {
    return json(req, res, 200, store.get('orders').map((o) => ({ id: o.id, createdAt: o.createdAt, status: o.status, paid: o.payment.status === 'paid', provider: o.payment.provider, total: o.total, currency: o.currency, customer: o.customer, items: o.items.reduce((s, i) => s + i.qty, 0) })));
  }
  const om = route.match(/^orders\/([\w-]+)$/);
  if (om) {
    const o = commerce.getOrder(om[1]);
    if (!o) return json(req, res, 404, { error: 'not_found' });
    if (method === 'GET') return json(req, res, 200, o);
    if (method === 'PATCH') {
      const b = await readJSON(req, 2e4);
      if (b.tracking) await commerce.patchOrder(o.id, (x) => { x.tracking = { carrier: str(b.tracking.carrier, 60), number: str(b.tracking.number, 80), url: /^https?:\/\//.test(b.tracking.url || '') ? str(b.tracking.url, 300) : '' }; });
      if (b.internalNote !== undefined) await commerce.patchOrder(o.id, (x) => { x.internalNote = str(b.internalNote, 2000); });
      if (b.status && b.status !== o.status) {
        await commerce.setStatus(o.id, b.status, b.note || 'admin');
        if (b.status === 'paid' && o.payment.status !== 'paid') await commerce.markPaid(o.id, { manual: true });
      }
      const updated = commerce.getOrder(o.id);
      if (b.sendShippedEmail && updated.status === 'shipped') { await mail.orderShipped(updated); await commerce.patchOrder(o.id, (x) => { x.emails.shipped = new Date().toISOString(); }); }
      return json(req, res, 200, commerce.getOrder(o.id));
    }
  }
  if (route === 'messages') {
    if (method === 'GET') return json(req, res, 200, store.get('messages'));
  }
  const mm = route.match(/^messages\/([\w-]+)$/);
  if (mm && method === 'PATCH') {
    const b = await readJSON(req, 1e3);
    await store.update('messages', (list) => { const m = list.find((x) => x.id === mm[1]); if (m) m.read = !!b.read; });
    return json(req, res, 200, { ok: true });
  }
  if (route === 'emails' && method === 'GET') return json(req, res, 200, mail.listOutbox(100));
  if (route === 'upload' && method === 'POST') return json(req, res, 200, await upload(req, query));

  return json(req, res, 404, { error: 'not_found' });
}

module.exports = { handle, sanitizeProduct, sanitizeSettings, _sessions: sessions };
