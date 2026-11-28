'use strict';
/**
 * Règles commerciales : prix, promotions, livraison, commandes, stock.
 * Le serveur recalcule TOUJOURS les montants : le panier client n'est
 * qu'une liste { variantId, qty }.
 */
const crypto = require('crypto');
const store = require('./store');
const { INTL, L } = require('./i18n');

const STATUSES = ['pending_payment', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled', 'refunded', 'payment_failed'];

function formatMoney(cents, lang = 'fr', currency) {
  const cur = currency || store.get('settings').currency || 'EUR';
  return new Intl.NumberFormat(INTL[lang] || 'fr-FR', { style: 'currency', currency: cur, minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}

function promotionActive(product, now = Date.now()) {
  const p = product.promotion;
  if (!p || !p.active || !(p.value > 0)) return false;
  if (p.endsAt && new Date(p.endsAt).getTime() < now) return false;
  return true;
}

/** Prix d'une variante : { price, compareAt, promo } en centimes. */
function variantPricing(product, variant) {
  const base = product.price + (variant?.priceDelta || 0);
  let price = base;
  let compareAt = product.compareAtPrice ? product.compareAtPrice + (variant?.priceDelta || 0) : null;
  let promo = null;
  if (promotionActive(product)) {
    const p = product.promotion;
    price = p.type === 'amount' ? Math.max(0, base - Math.round(p.value)) : Math.round(base * (1 - p.value / 100));
    compareAt = Math.max(compareAt || 0, base);
    promo = { label: p.label, endsAt: p.endsAt || null };
  }
  if (compareAt && compareAt <= price) compareAt = null;
  return { price, compareAt, promo };
}

/** URL de la plus petite déclinaison d'une image de galerie (miniature panier/commande). */
function imageSrc(product, id) {
  const g = product.gallery.find((x) => x.id === id) || product.gallery[0];
  if (!g) return '';
  const fmt = g.formats.includes('webp') ? 'webp' : g.formats[0];
  return `${g.src}-${g.widths[0]}.${fmt}`;
}

function findVariant(product, id) {
  return product.variants.find((v) => v.id === id && v.active !== false) || null;
}

function shippingZone(country) {
  const zones = store.get('settings').shipping?.zones || [];
  return zones.find((z) => (z.countries || []).includes(String(country || '').toUpperCase())) || null;
}

function shippingCost(zone, itemsCount, subtotal) {
  if (!zone) return null;
  if (zone.freeOver && subtotal >= zone.freeOver) return 0;
  if (itemsCount <= 0) return 0;
  return zone.rate + Math.max(0, itemsCount - 1) * (zone.perAdditionalItem || 0);
}

function allowedCountries() {
  const zones = store.get('settings').shipping?.zones || [];
  return [...new Set(zones.flatMap((z) => z.countries || []))];
}

/**
 * Devis d'un panier. items: [{ variantId, qty }]. country facultatif.
 * Retourne lignes, sous-total, livraison, total, et erreurs de stock.
 */
function quote(items, country, lang = 'fr') {
  const product = store.get('product');
  const lines = [];
  const issues = [];
  for (const it of Array.isArray(items) ? items.slice(0, 20) : []) {
    const v = findVariant(product, it && it.variantId);
    let qty = Math.max(0, Math.min(10, parseInt(it && it.qty, 10) || 0));
    if (!v || qty === 0) { if (it && it.variantId) issues.push({ variantId: it.variantId, type: 'unavailable' }); continue; }
    if (qty > v.stock) { issues.push({ variantId: v.id, type: 'stock', available: v.stock }); qty = Math.max(0, v.stock); }
    if (qty === 0) continue;
    const pr = variantPricing(product, v);
    const existing = lines.find((l) => l.variantId === v.id);
    if (existing) { existing.qty = Math.min(v.stock, existing.qty + qty); existing.total = existing.qty * existing.unitPrice; continue; }
    lines.push({
      productId: product.id, variantId: v.id, sku: v.sku,
      name: L(product.name, lang), variantName: L(v.name, lang),
      image: imageSrc(product, v.image || product.gallery[0]?.id), unitPrice: pr.price, compareAt: pr.compareAt, qty, total: pr.price * qty
    });
  }
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const compareTotal = lines.reduce((s, l) => s + (l.compareAt || l.unitPrice) * l.qty, 0);
  const itemsCount = lines.reduce((s, l) => s + l.qty, 0);
  const zone = country ? shippingZone(country) : null;
  const shipping = country ? shippingCost(zone, itemsCount, subtotal) : null;
  return {
    lines, itemsCount, subtotal,
    savings: compareTotal - subtotal,
    shipping, shippingZone: zone ? { id: zone.id, name: L(zone.name, lang), delay: L(zone.delay, lang) } : null,
    shippable: country ? !!zone : null,
    total: subtotal + (shipping || 0),
    currency: store.get('settings').currency || 'EUR',
    issues
  };
}

function newOrderId() {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `ELY-${ymd}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

const clean = (s, n = 200) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Valide les données client du tunnel ; renvoie { ok, errors, customer, address }. */
function validateCheckout(body) {
  const errors = {};
  const c = body.customer || {}; const a = body.address || {};
  const customer = { email: clean(c.email, 160).toLowerCase(), phone: clean(c.phone, 40), firstName: clean(a.firstName, 80), lastName: clean(a.lastName, 80) };
  const address = { line1: clean(a.line1), line2: clean(a.line2), postalCode: clean(a.postalCode, 20), city: clean(a.city, 100), country: clean(a.country, 2).toUpperCase(), notes: clean(a.notes, 500) };
  if (!EMAIL_RE.test(customer.email)) errors.email = 'invalid';
  if (!customer.firstName) errors.firstName = 'required';
  if (!customer.lastName) errors.lastName = 'required';
  if (!customer.phone) errors.phone = 'required';
  if (!address.line1) errors.line1 = 'required';
  if (!address.postalCode) errors.postalCode = 'required';
  if (!address.city) errors.city = 'required';
  if (!allowedCountries().includes(address.country)) errors.country = 'unsupported';
  if (!body.acceptTerms) errors.acceptTerms = 'required';
  return { ok: Object.keys(errors).length === 0, errors, customer, address };
}

async function createOrder({ items, customer, address, lang, provider }) {
  const q = quote(items, address.country, lang);
  if (!q.lines.length) throw Object.assign(new Error('Panier vide'), { status: 400, code: 'empty' });
  if (q.issues.length) throw Object.assign(new Error('Stock insuffisant'), { status: 409, code: 'stock', issues: q.issues });
  if (q.shipping === null) throw Object.assign(new Error('Destination non desservie'), { status: 400, code: 'shipping' });
  const now = new Date().toISOString();
  const order = {
    id: newOrderId(),
    token: crypto.randomBytes(16).toString('hex'),
    createdAt: now, updatedAt: now,
    status: 'pending_payment',
    lang, customer, shippingAddress: address,
    items: q.lines.map(({ compareAt, ...l }) => l),
    subtotal: q.subtotal, savings: q.savings, shipping: q.shipping, total: q.total, currency: q.currency,
    shippingZone: q.shippingZone,
    payment: { provider, status: 'pending', sessionId: null },
    tracking: { carrier: '', number: '', url: '' },
    stockApplied: false,
    emails: {},
    history: [{ at: now, status: 'pending_payment', note: '' }]
  };
  await store.update('orders', (orders) => { orders.unshift(order); });
  return order;
}

function getOrder(id) { return store.get('orders').find((o) => o.id === id) || null; }

async function patchOrder(id, fn) {
  let out = null;
  await store.update('orders', (orders) => {
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    fn(o);
    o.updatedAt = new Date().toISOString();
    out = o;
  });
  return out;
}

/** Décrémente le stock une seule fois par commande. Renvoie les ruptures éventuelles. */
async function applyStock(order) {
  if (order.stockApplied) return [];
  const shortages = [];
  await store.update('product', (p) => {
    for (const it of order.items) {
      const v = p.variants.find((x) => x.id === it.variantId);
      if (!v) continue;
      if (v.stock < it.qty) shortages.push({ variantId: v.id, missing: it.qty - v.stock });
      v.stock = Math.max(0, v.stock - it.qty);
    }
  });
  await patchOrder(order.id, (o) => { o.stockApplied = true; if (shortages.length) o.stockShortage = shortages; });
  return shortages;
}

async function setStatus(id, status, note = '') {
  if (!STATUSES.includes(status)) throw Object.assign(new Error('Statut inconnu'), { status: 400 });
  return patchOrder(id, (o) => {
    if (o.status === status) return;
    o.status = status;
    o.history.push({ at: new Date().toISOString(), status, note: clean(note, 300) });
  });
}

/** Paiement confirmé (Stripe webhook / vérification / démo). Idempotent. */
async function markPaid(id, paymentInfo = {}) {
  const o = getOrder(id);
  if (!o) return null;
  if (o.payment.status === 'paid') return o;
  await patchOrder(id, (x) => {
    x.payment = { ...x.payment, ...paymentInfo, status: 'paid', paidAt: new Date().toISOString() };
    x.status = 'paid';
    x.history.push({ at: new Date().toISOString(), status: 'paid', note: x.payment.provider });
  });
  await applyStock(getOrder(id));
  return getOrder(id);
}

module.exports = { STATUSES, formatMoney, variantPricing, findVariant, promotionActive, quote, shippingZone, allowedCountries, validateCheckout, createOrder, getOrder, patchOrder, setStatus, markPaid, applyStock, EMAIL_RE, clean };
