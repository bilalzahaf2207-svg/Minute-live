'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let s;
test.before(async () => { s = await startServer(); });
test.after(async () => { await s.stop(); });

const PAGES = {
  fr: ['/fr/', '/fr/coiffeuse-elysea', '/fr/conception', '/fr/matieres-et-finitions', '/fr/inspiration', '/fr/contact', '/fr/panier', '/fr/commande', '/fr/mentions-legales', '/fr/conditions-generales-de-vente', '/fr/confidentialite'],
  en: ['/en/', '/en/elysea-vanity', '/en/design', '/en/materials-and-finishes', '/en/inspiration', '/en/contact', '/en/bag', '/en/checkout', '/en/legal-notice', '/en/terms-of-sale', '/en/privacy']
};

test('toutes les pages répondent 200 en FR et EN, avec lang, title, description et CSP', async () => {
  for (const [lang, list] of Object.entries(PAGES)) {
    for (const p of list) {
      const r = await s.req('GET', p);
      assert.equal(r.status, 200, p);
      assert.match(r.text, new RegExp(`<html lang="${lang}">`), p);
      assert.match(r.text, /<title>[^<]{10,}<\/title>/, p);
      assert.match(r.text, /<meta name="description" content="[^"]+"/, p);
      assert.match(r.headers.get('content-security-policy') || '', /script-src 'self' 'nonce-/, p);
      const html = r.text.replace(/window\.ELYSEA=.*?;<\/script>/s, ''); // dictionnaire client : gabarits volontaires
      assert.doesNotMatch(html, /\{\w+\}|undefined|\[object Object\]/, `${p} contient un gabarit non résolu`);
    }
  }
});

test('la racine redirige selon Accept-Language', async () => {
  assert.equal((await s.req('GET', '/', undefined, { 'accept-language': 'en-GB,en;q=0.9' })).headers.get('location'), '/en/');
  assert.equal((await s.req('GET', '/', undefined, { 'accept-language': 'fr-FR' })).headers.get('location'), '/fr/');
});

test('SEO : canonical, hreflang, Open Graph et données structurées Product', async () => {
  const r = await s.req('GET', '/fr/coiffeuse-elysea');
  assert.match(r.text, /<link rel="canonical" href="http:\/\/[^"]+\/fr\/coiffeuse-elysea">/);
  assert.match(r.text, /hreflang="en" href="[^"]+\/en\/elysea-vanity"/);
  assert.match(r.text, /hreflang="x-default"/);
  assert.match(r.text, /<meta property="og:image"/);
  const blocks = [...r.text.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const product = blocks.find((b) => b['@type'] === 'Product');
  assert.ok(product, 'JSON-LD Product présent');
  assert.equal(product.offers.price, '590.00');
  assert.equal(product.offers.priceCurrency, 'EUR');
  assert.equal(product.width.value, 65);
  assert.ok(blocks.find((b) => b['@type'] === 'BreadcrumbList'));
  const contact = await s.req('GET', '/fr/contact');
  assert.match(contact.text, /"@type":"FAQPage"/);
});

test('pages privées en noindex, sitemap et robots', async () => {
  assert.match((await s.req('GET', '/fr/panier')).text, /noindex/);
  assert.match((await s.req('GET', '/fr/commande')).text, /noindex/);
  const sm = await s.req('GET', '/sitemap.xml');
  assert.match(sm.text, /<loc>[^<]+\/en\/elysea-vanity<\/loc>/);
  assert.doesNotMatch(sm.text, /panier|checkout/);
  const rb = await s.req('GET', '/robots.txt');
  assert.match(rb.text, /Disallow: \/admin/);
  assert.match(rb.text, /Sitemap: /);
});

test('404 localisée et protection contre la traversée de répertoires', async () => {
  const r = await s.req('GET', '/en/nowhere');
  assert.equal(r.status, 404);
  assert.match(r.text, /Page not found/);
  for (const p of ['/vendor/three/../package.json', '/vendor/three/package.json', '/uploads/..%2f..%2fpackage.json', '/css/..%2f..%2fserver.js']) {
    const x = await s.req('GET', p);
    assert.notEqual(x.status, 200, p);
  }
});

test('ressources statiques : compression et cache immuable pour les ressources versionnées', async () => {
  const r = await s.req('GET', '/css/site.css?v=1', undefined, { 'accept-encoding': 'br' });
  assert.equal(r.headers.get('content-encoding'), 'br');
  assert.match(r.headers.get('cache-control'), /immutable/);
  const img = await s.req('HEAD', '/img/renders/hero-1400.avif');
  assert.equal(img.headers.get('content-type'), 'image/avif');
});

test('FAQ : aucune condition commerciale inventée quand rien n’est configuré', async () => {
  const r = await s.req('GET', '/fr/contact');
  assert.match(r.text, /Cette information sera précisée très prochainement/);
});
