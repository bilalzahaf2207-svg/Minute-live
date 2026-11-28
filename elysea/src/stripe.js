'use strict';
/**
 * Stripe Checkout via l'API REST (sans SDK) + vérification de signature des webhooks.
 * Docs : https://docs.stripe.com/api/checkout/sessions · https://docs.stripe.com/webhooks#verify-manually
 */
const crypto = require('crypto');
const config = require('./config');

function enabled() { return !!config.stripe.secretKey; }

/** Encodage application/x-www-form-urlencoded avec clés imbriquées à la Stripe. */
function encode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') encode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.join('&');
}

async function api(method, path, params) {
  const r = await fetch(`${config.stripe.apiBase}/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.stripe.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' },
    body: params ? encode(params) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error?.message || `Stripe ${r.status}`), { status: 502 });
  return data;
}

async function createCheckoutSession(order, { successUrl, cancelUrl, imageBase }) {
  const line_items = {};
  order.items.forEach((it, i) => {
    line_items[i] = {
      quantity: it.qty,
      price_data: {
        currency: order.currency.toLowerCase(),
        unit_amount: it.unitPrice,
        product_data: { name: `${it.name} — ${it.variantName}`, ...(imageBase && /^\/img\/renders\//.test(it.image) ? { images: { 0: `${imageBase}${it.image.replace(/-\d+\.\w+$/, '')}-1000.jpg` } } : {}) }
      }
    };
  });
  const params = {
    mode: 'payment',
    client_reference_id: order.id,
    customer_email: order.customer.email,
    locale: order.lang === 'en' ? 'en' : 'fr',
    line_items,
    metadata: { order_id: order.id },
    payment_intent_data: { metadata: { order_id: order.id } },
    success_url: successUrl,
    cancel_url: cancelUrl
  };
  if (order.shipping > 0) {
    params.shipping_options = { 0: { shipping_rate_data: { type: 'fixed_amount', display_name: order.shippingZone?.name || 'Livraison', fixed_amount: { amount: order.shipping, currency: order.currency.toLowerCase() } } } };
  }
  return api('POST', '/checkout/sessions', params);
}

function retrieveSession(id) { return api('GET', `/checkout/sessions/${encodeURIComponent(id)}`); }

/** Vérifie l'en-tête Stripe-Signature (HMAC-SHA256, tolérance 5 min). */
function verifySignature(rawBody, header, secret = config.stripe.webhookSecret, toleranceSec = 300, now = Math.floor(Date.now() / 1000)) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v]));
  const ts = Number(parts.t);
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!ts || !sigs.length || Math.abs(now - ts) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

module.exports = { enabled, createCheckoutSession, retrieveSession, verifySignature, encode };
