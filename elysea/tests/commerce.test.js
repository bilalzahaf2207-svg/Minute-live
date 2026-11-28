'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, CUSTOMER } = require('./helpers');

let s;
test.before(async () => { s = await startServer(); });
test.after(async () => { await s.stop(); });
const V = 'rayures-beige-cafe';

test('devis : le serveur recalcule les prix et ignore tout prix envoyé par le client', async () => {
  const r = await s.req('POST', '/api/cart/quote', { items: [{ variantId: V, qty: 2, price: 1 }], country: 'FR', lang: 'fr' });
  assert.equal(r.status, 200);
  assert.equal(r.json.lines[0].unitPrice, 59000);
  assert.equal(r.json.subtotal, 118000);
  assert.equal(r.json.shipping, 4900 + 2500);
  assert.equal(r.json.total, 118000 + 7400);
});

test('devis : variante inconnue signalée, quantité plafonnée au stock, pays non desservi', async () => {
  const r = await s.req('POST', '/api/cart/quote', { items: [{ variantId: 'nope', qty: 1 }, { variantId: V, qty: 50 }], country: 'US' });
  assert.equal(r.json.lines[0].qty, 10); // plafond par ligne
  assert.ok(r.json.issues.find((i) => i.type === 'unavailable'));
  assert.equal(r.json.shippable, false);
  assert.equal(r.json.shipping, null);
});

test('commande : validation des champs', async () => {
  const r = await s.req('POST', '/api/checkout', { items: [{ variantId: V, qty: 1 }], customer: { email: 'x' }, address: { country: 'US' }, lang: 'fr' });
  assert.equal(r.status, 422);
  for (const f of ['email', 'firstName', 'line1', 'country', 'acceptTerms']) assert.ok(r.json.fields[f], f);
});

test('commande : panier vide refusé', async () => {
  const r = await s.req('POST', '/api/checkout', { items: [], ...CUSTOMER, lang: 'fr' });
  assert.equal(r.status, 400);
});

test('parcours démonstration : commande → paiement simulé → payée, stock décrémenté, e-mails émis', async () => {
  const before = (await s.req('GET', '/api/product')).json.variants[0].stock;
  const co = await s.req('POST', '/api/checkout', { items: [{ variantId: V, qty: 2 }], ...CUSTOMER, lang: 'fr' });
  assert.equal(co.status, 200);
  assert.equal(co.json.demo, true);
  assert.match(co.json.redirectUrl, /\/fr\/commande\/confirmation\?order=ELY-/);
  // le jeton est obligatoire
  assert.equal((await s.req('POST', '/api/checkout/demo-pay', { orderId: co.json.orderId, token: 'bad' })).status, 404);
  const pay = await s.req('POST', '/api/checkout/demo-pay', { orderId: co.json.orderId, token: co.json.token });
  assert.equal(pay.status, 200);
  assert.equal(pay.json.order.paid, true);
  // idempotent
  await s.req('POST', '/api/checkout/demo-pay', { orderId: co.json.orderId, token: co.json.token });
  const after = (await s.req('GET', '/api/product')).json.variants[0].stock;
  assert.equal(after, before - 2);
  const mails = s.outbox();
  assert.equal(mails.filter((m) => m.tag === 'order-confirmation').length, 1);
  assert.ok(mails.find((m) => m.tag === 'order-confirmation' && m.to === 'client@example.com' && /ELY-/.test(m.subject)));
  // page de confirmation : jeton requis
  const url = new URL(co.json.redirectUrl);
  assert.match((await s.req('GET', url.pathname + url.search)).text, /Votre paiement est confirmé/);
  assert.match((await s.req('GET', `${url.pathname}?order=${co.json.orderId}&t=wrong`)).text, /Commande introuvable/);
  // statut public
  const st = await s.req('GET', `/api/order?id=${co.json.orderId}&t=${co.json.token}`);
  assert.equal(st.json.paid, true);
  assert.equal(st.json.items[0].qty, 2);
  assert.equal(st.json.customer, undefined, 'pas de données personnelles exposées');
});

test('stock insuffisant : la commande est refusée (409)', async () => {
  await s.admin('POST', 'login', { password: 'test-pass' });
  const p = (await s.admin('GET', 'product')).json;
  p.variants[0].stock = 1;
  await s.admin('PUT', 'product', p);
  const q = await s.req('POST', '/api/cart/quote', { items: [{ variantId: V, qty: 3 }] });
  assert.equal(q.json.lines[0].qty, 1);
  assert.ok(q.json.issues.find((i) => i.type === 'stock'));
  const co = await s.req('POST', '/api/checkout', { items: [{ variantId: V, qty: 3 }], ...CUSTOMER, lang: 'fr' });
  assert.equal(co.status, 409);
});

test('formulaire de contact : validation, pot de miel, enregistrement et accusé de réception', async () => {
  assert.equal((await s.req('POST', '/api/contact', { name: '', email: 'bad', message: '', consent: true })).status, 422);
  assert.equal((await s.req('POST', '/api/contact', { name: 'Bot', email: 'b@b.co', message: 'spam spam', consent: true, website: 'x' })).status, 200);
  const ok = await s.req('POST', '/api/contact', { lang: 'en', name: 'Alex', email: 'alex@example.com', subject: 'Delivery', message: 'Do you ship to Belgium?', consent: true });
  assert.equal(ok.status, 200);
  const msgs = s.readData('messages');
  assert.equal(msgs.length, 1, 'le robot du pot de miel n’est pas enregistré');
  assert.equal(msgs[0].email, 'alex@example.com');
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(s.outbox().find((m) => m.tag === 'contact-ack' && m.to === 'alex@example.com'));
});

test('l’API refuse un corps non JSON', async () => {
  const r = await s.req('POST', '/api/cart/quote', 'items=1', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(r.status, 415);
});
