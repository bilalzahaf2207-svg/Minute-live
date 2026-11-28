'use strict';
/** Parcours Stripe complet contre un faux serveur Stripe local. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const { startServer, CUSTOMER } = require('./helpers');
const stripeLib = require('../src/stripe');

const SECRET = 'whsec_test_123';
let s, mock, sessions = {}, lastBody = '';

test.before(async () => {
  mock = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      if (req.headers.authorization !== 'Bearer sk_test_fake') { res.writeHead(401); return res.end('{}'); }
      if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
        lastBody = decodeURIComponent(body);
        const id = `cs_test_${Object.keys(sessions).length + 1}`;
        const orderId = new URLSearchParams(body).get('client_reference_id');
        sessions[id] = { id, url: `https://checkout.stripe.test/${id}`, payment_status: 'unpaid', status: 'open', client_reference_id: orderId, metadata: { order_id: orderId } };
        res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(sessions[id]));
      }
      const m = req.url.match(/^\/v1\/checkout\/sessions\/(\w+)$/);
      if (req.method === 'GET' && m && sessions[m[1]]) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(sessions[m[1]])); }
      res.writeHead(404); res.end('{}');
    });
  });
  await new Promise((r) => mock.listen(0, r));
  s = await startServer({ STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_API_BASE: `http://127.0.0.1:${mock.address().port}` });
});
test.after(async () => { await s.stop(); mock.close(); });

function sign(payload, secret = SECRET, t = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${sig}`;
}

test('vérification de signature : valide, falsifiée, expirée', () => {
  const body = '{"a":1}';
  assert.equal(stripeLib.verifySignature(body, sign(body), SECRET), true);
  assert.equal(stripeLib.verifySignature(body, sign(body, 'autre'), SECRET), false);
  assert.equal(stripeLib.verifySignature(body + ' ', sign(body), SECRET), false);
  assert.equal(stripeLib.verifySignature(body, sign(body, SECRET, Math.floor(Date.now() / 1000) - 3600), SECRET), false);
  assert.equal(stripeLib.verifySignature(body, undefined, SECRET), false);
});

test('encodage des paramètres imbriqués façon Stripe', () => {
  assert.equal(stripeLib.encode({ a: { 0: { b: 1 } }, c: 'x y' }), 'a%5B0%5D%5Bb%5D=1&c=x%20y');
});

test('checkout Stripe → webhook signé → commande payée (idempotent)', async () => {
  const stock0 = (await s.req('GET', '/api/product')).json.variants[0].stock;
  const co = await s.req('POST', '/api/checkout', { items: [{ variantId: 'rayures-beige-cafe', qty: 1 }], ...CUSTOMER, lang: 'en' });
  assert.equal(co.status, 200);
  assert.match(co.json.redirectUrl, /^https:\/\/checkout\.stripe\.test\/cs_test_/);
  assert.match(lastBody, /line_items\[0\]\[price_data\]\[unit_amount\]=59000/);
  assert.match(lastBody, /shipping_options\[0\]\[shipping_rate_data\]\[fixed_amount\]\[amount\]=4900/);
  assert.match(lastBody, /locale=en/);
  assert.match(lastBody, /success_url=http:\/\/[^&]+\/en\/checkout\/confirmation\?order=ELY-[^&]+&t=\w+&session_id=\{CHECKOUT_SESSION_ID\}/);
  const order = s.readData('orders')[0];
  assert.equal(order.payment.provider, 'stripe');
  assert.equal(order.status, 'pending_payment');
  // la démonstration est désactivée quand Stripe est actif
  assert.equal((await s.req('POST', '/api/checkout/demo-pay', { orderId: order.id, token: order.token })).status, 403);

  const evt = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: order.payment.sessionId, payment_status: 'paid', payment_intent: 'pi_1', client_reference_id: order.id, metadata: { order_id: order.id } } } });
  assert.equal((await s.req('POST', '/api/stripe/webhook', evt, { 'content-type': 'application/json', 'stripe-signature': sign(evt, 'mauvais') })).status, 400);
  for (let i = 0; i < 2; i++) {
    const w = await s.req('POST', '/api/stripe/webhook', evt, { 'content-type': 'application/json', 'stripe-signature': sign(evt) });
    assert.equal(w.status, 200);
  }
  const paid = s.readData('orders')[0];
  assert.equal(paid.status, 'paid');
  assert.equal(paid.payment.paymentIntent, 'pi_1');
  assert.equal((await s.req('GET', '/api/product')).json.variants[0].stock, stock0 - 1, 'stock décrémenté une seule fois');
  assert.equal(s.outbox().filter((m) => m.tag === 'order-confirmation').length, 1);
});

test('retour de paiement sans webhook : la page de confirmation vérifie la session auprès de Stripe', async () => {
  const co = await s.req('POST', '/api/checkout', { items: [{ variantId: 'rayures-beige-cafe', qty: 1 }], ...CUSTOMER, lang: 'fr' });
  const order = s.readData('orders')[0];
  sessions[order.payment.sessionId].payment_status = 'paid';
  const st = await s.req('GET', `/api/order?id=${order.id}&t=${order.token}`);
  assert.equal(st.json.paid, true);
  assert.ok(co.json.redirectUrl);
});

test('session expirée → paiement échoué', async () => {
  await s.req('POST', '/api/checkout', { items: [{ variantId: 'rayures-beige-cafe', qty: 1 }], ...CUSTOMER, lang: 'fr' });
  const order = s.readData('orders')[0];
  const evt = JSON.stringify({ type: 'checkout.session.expired', data: { object: { id: order.payment.sessionId, client_reference_id: order.id, metadata: { order_id: order.id } } } });
  await s.req('POST', '/api/stripe/webhook', evt, { 'content-type': 'application/json', 'stripe-signature': sign(evt) });
  assert.equal(s.readData('orders')[0].status, 'payment_failed');
});
