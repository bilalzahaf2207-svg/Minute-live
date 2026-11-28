'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, CUSTOMER } = require('./helpers');

let s;
test.before(async () => { s = await startServer(); });
test.after(async () => { await s.stop(); });

test('accès protégé : 401 sans session, 403 sans en-tête anti-CSRF, mauvais mot de passe refusé', async () => {
  assert.equal((await s.admin('GET', 'dashboard')).status, 401);
  assert.equal((await s.req('POST', '/admin/api/login', { password: 'test-pass' })).status, 403);
  assert.equal((await s.admin('POST', 'login', { password: 'nope' })).status, 401);
  const ok = await s.admin('POST', 'login', { password: 'test-pass' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await s.admin('GET', 'dashboard')).status, 200);
  assert.equal((await s.req('GET', '/admin')).headers.get('x-robots-tag'), 'noindex');
});

test('tableau de bord : signale les éléments non configurés', async () => {
  const d = (await s.admin('GET', 'dashboard')).json;
  assert.ok(d.warnings.some((w) => /Stripe/.test(w.text)));
  assert.ok(d.warnings.some((w) => /livraison/i.test(w.text)));
});

test('prix et promotion modifiés dans l’admin → répercutés sur le site et le devis', async () => {
  const p = (await s.admin('GET', 'product')).json;
  p.price = 64900;
  p.promotion = { active: true, type: 'percent', value: 10, label: { fr: 'Offre de lancement', en: 'Launch offer' }, endsAt: null };
  p.name = { fr: 'Coiffeuse ELYSÉA Signature', en: 'ELYSÉA Signature Vanity' };
  const r = await s.admin('PUT', 'product', p);
  assert.equal(r.status, 200);
  const page = await s.req('GET', '/fr/coiffeuse-elysea');
  assert.match(page.text, /Coiffeuse ELYSÉA Signature/);
  assert.match(page.text, /584,10\s€/); // 649 − 10 %
  assert.match(page.text, /649\s€/);
  assert.match(page.text, /Offre de lancement/);
  const q = await s.req('POST', '/api/cart/quote', { items: [{ variantId: 'rayures-beige-cafe', qty: 1 }] });
  assert.equal(q.json.subtotal, 58410);
  assert.equal(q.json.savings, 6490);
});

test('promotion expirée : prix normal', async () => {
  const p = (await s.admin('GET', 'product')).json;
  p.promotion.endsAt = '2000-01-01T00:00:00Z';
  await s.admin('PUT', 'product', p);
  const q = await s.req('POST', '/api/cart/quote', { items: [{ variantId: 'rayures-beige-cafe', qty: 1 }] });
  assert.equal(q.json.subtotal, 64900);
});

test('ajout d’une variante (nouveau coloris) disponible à la vente', async () => {
  const p = (await s.admin('GET', 'product')).json;
  p.variants.push({ id: 'Rayures Noir/Ivoire', sku: 'ELY-VAN-01-NI', name: { fr: 'Rayures noir & ivoire', en: 'Black & ivory stripes' }, swatch: ['#f1ebe0', '#1c1612'], priceDelta: 5000, stock: 3, active: true, image: '' });
  const saved = (await s.admin('PUT', 'product', p)).json;
  assert.equal(saved.variants[1].id, 'rayures-noir-ivoire', 'identifiant normalisé');
  const api = (await s.req('GET', '/api/product?lang=en')).json;
  assert.equal(api.variants.length, 2);
  assert.equal(api.variants[1].name, 'Black & ivory stripes');
  assert.equal(api.variants[1].price, 64900 + 5000);
  const page = await s.req('GET', '/fr/coiffeuse-elysea');
  assert.match(page.text, /Rayures noir &amp; ivoire/);
});

test('validation : variantes obligatoires, champs assainis', async () => {
  const p = (await s.admin('GET', 'product')).json;
  assert.equal((await s.admin('PUT', 'product', { ...p, variants: [] })).status, 422);
  const bad = { ...p, gallery: [...p.gallery, { id: 'x', src: 'javascript:alert(1)', widths: [100], formats: ['jpg'] }] };
  const r = await s.admin('PUT', 'product', bad);
  assert.ok(!r.json.gallery.find((g) => g.id === 'x'), 'source d’image invalide rejetée');
});

test('textes : une surcharge admin remplace le texte par défaut', async () => {
  await s.admin('PUT', 'texts', { fr: { 'home.hero.slogan': 'Un nouveau slogan d’essai.' }, en: {} });
  assert.match((await s.req('GET', '/fr/')).text, /Un nouveau slogan d’essai\./);
  await s.admin('PUT', 'texts', { fr: {}, en: {} });
  assert.match((await s.req('GET', '/fr/')).text, /L&#39;élégance rencontre l&#39;intelligence de l&#39;espace\./);
});

test('conditions commerciales et FAQ configurables', async () => {
  const st = (await s.admin('GET', 'settings')).json;
  st.policies.returns = { fr: 'Retours acceptés sous conditions décrites dans nos CGV.', en: 'Returns accepted as described in our terms.' };
  st.shipping.configured = true;
  await s.admin('PUT', 'settings', st);
  const page = (await s.req('GET', '/fr/contact')).text;
  assert.match(page, /Retours acceptés sous conditions décrites dans nos CGV\./);
  assert.match(page, /France métropolitaine/);
  const faq = (await s.admin('GET', 'faq')).json;
  faq.push({ category: 'product', q: { fr: 'Question test ?', en: 'Test question?' }, a: { fr: 'Réponse test.', en: 'Test answer.' } });
  await s.admin('PUT', 'faq', faq);
  assert.match((await s.req('GET', '/en/contact')).text, /Test question\?/);
});

test('témoignages : section affichée uniquement si publiés', async () => {
  assert.doesNotMatch((await s.req('GET', '/fr/')).text, /Ils ont choisi ELYSÉA/);
  await s.admin('PUT', 'testimonials', [{ author: 'Claire', city: 'Lyon', text: { fr: 'Superbe.', en: 'Superb.' }, published: true }]);
  assert.match((await s.req('GET', '/fr/')).text, /Ils ont choisi ELYSÉA/);
});

test('commandes : changement de statut, suivi et e-mail d’expédition', async () => {
  const co = await s.req('POST', '/api/checkout', { items: [{ variantId: 'rayures-beige-cafe', qty: 1 }], ...CUSTOMER, lang: 'fr' });
  await s.req('POST', '/api/checkout/demo-pay', { orderId: co.json.orderId, token: co.json.token });
  const list = (await s.admin('GET', 'orders')).json;
  assert.equal(list[0].id, co.json.orderId);
  const r = await s.admin('PATCH', `orders/${co.json.orderId}`, { status: 'shipped', tracking: { carrier: 'Transporteur', number: 'ABC123', url: 'https://suivi.example/ABC123' }, sendShippedEmail: true });
  assert.equal(r.json.status, 'shipped');
  assert.equal(r.json.tracking.number, 'ABC123');
  assert.ok(s.outbox().find((m) => m.tag === 'order-shipped' && /ABC123/.test(m.html)));
  assert.equal((await s.admin('PATCH', `orders/${co.json.orderId}`, { status: 'teleported' })).status, 400);
});

test('téléversement : signature de fichier vérifiée', async () => {
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(16)]);
  const ok = await s.req('POST', '/admin/api/upload?base=test&w=640&ext=webp', webp, { 'x-requested-with': 'elysea-admin', 'content-type': 'image/webp' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.path, '/uploads/test-640.webp');
  assert.equal((await s.req('GET', '/uploads/test-640.webp')).status, 200);
  const fake = await s.req('POST', '/admin/api/upload?base=evil&ext=webp', Buffer.from('<script>'), { 'x-requested-with': 'elysea-admin', 'content-type': 'image/webp' });
  assert.equal(fake.status, 415);
  const html = await s.req('POST', '/admin/api/upload?ext=html', Buffer.from('<html>'), { 'x-requested-with': 'elysea-admin', 'content-type': 'text/html' });
  assert.equal(html.status, 415);
});

test('déconnexion', async () => {
  await s.admin('POST', 'logout', {});
  assert.equal((await s.admin('GET', 'dashboard')).status, 401);
});
