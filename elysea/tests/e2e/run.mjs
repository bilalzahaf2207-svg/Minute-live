#!/usr/bin/env node
/**
 * Tests de bout en bout (Playwright / Chromium). Lance un serveur isolé.
 *   npm run test:e2e
 */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const { startServer } = require('../helpers.js');

const s = await startServer();
const browser = await chromium.launch();
let failures = 0;
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); console.log(`✓ ${name} (${Date.now() - t0} ms)`); }
  catch (err) { failures++; console.error(`✗ ${name}\n  ${err.stack?.split('\n').slice(0, 4).join('\n  ')}`); }
}
function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

const PAGES = ['/fr/', '/fr/coiffeuse-elysea', '/fr/conception', '/fr/matieres-et-finitions', '/fr/inspiration', '/fr/contact', '/fr/panier', '/en/', '/en/elysea-vanity'];

await step('pages : aucune erreur console, un seul h1, images avec alt, boutons nommés', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = watch(page);
  for (const p of PAGES) {
    await page.goto(s.base + p, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('h1').count(), 1, `${p} : un seul h1`);
    const noAlt = await page.$$eval('img', (imgs) => imgs.filter((i) => !i.hasAttribute('alt')).length);
    assert.equal(noAlt, 0, `${p} : images sans alt`);
    const unnamed = await page.$$eval('button, a[href]', (els) => els.filter((e) => e.offsetParent !== null && !(e.getAttribute('aria-label') || e.textContent.trim() || e.querySelector('img[alt]:not([alt=""])'))).map((e) => e.outerHTML.slice(0, 80)));
    assert.deepEqual(unnamed, [], `${p} : contrôles sans nom accessible`);
  }
  assert.deepEqual(errors, []);
  await page.close();
});

await step('accueil : le visuel hero (LCP) est chargé en priorité', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(s.base + '/fr/', { waitUntil: 'load' });
  const hero = await page.$eval('.hero img', (i) => ({ ok: i.complete && i.naturalWidth > 0, prio: i.getAttribute('fetchpriority'), src: i.currentSrc }));
  assert.ok(hero.ok); assert.equal(hero.prio, 'high'); assert.match(hero.src, /\.avif$/);
  await page.close();
});

await step('parcours d’achat complet (démonstration) : fiche → panier → commande → confirmation', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto(s.base + '/fr/coiffeuse-elysea', { waitUntil: 'networkidle' });
  await page.click('[data-thumb="3"]');
  assert.equal(await page.getAttribute('[data-slide="3"]', 'aria-hidden'), 'false');
  await page.click('[data-qty-inc]');
  await page.click('[data-add]');
  await page.waitForSelector('[data-drawer]:not([hidden]) .cart-line');
  assert.equal(await page.textContent('[data-cart-count]'), '2');
  assert.match(await page.textContent('[data-cart-lines]'), /Coiffeuse ELYSÉA/);
  assert.match(await page.textContent('[data-cart-foot]'), /1\s180\s€/);
  await page.click('[data-drawer] [data-dec]');
  await page.waitForFunction(() => document.querySelector('[data-cart-count]').textContent === '1');
  await page.click('[data-drawer] a[href="/fr/commande"]');
  await page.waitForSelector('[data-summary-lines] .summary-lines');
  assert.match(await page.textContent('[data-pay]'), /Simuler le paiement \(639\s€\)/);
  // soumission vide : erreurs signalées
  await page.click('[data-pay]');
  await page.waitForSelector('.field.has-error');
  await page.fill('[name=email]', 'e2e@example.com'); await page.fill('[name=phone]', '0611223344');
  await page.fill('[name=firstName]', 'Léa'); await page.fill('[name=lastName]', 'Durand');
  await page.fill('[name=line1]', '12 avenue Montaigne'); await page.fill('[name=postalCode]', '75008'); await page.fill('[name=city]', 'Paris');
  await page.selectOption('[name=country]', 'BE');
  await page.waitForFunction(() => /679/.test(document.querySelector('[data-pay]').textContent));
  await page.selectOption('[name=country]', 'FR');
  await page.waitForFunction(() => /639/.test(document.querySelector('[data-pay]').textContent));
  await page.check('[name=acceptTerms]');
  await Promise.all([page.waitForURL(/\/fr\/commande\/confirmation\?order=ELY-/), page.click('[data-pay]')]);
  assert.match(await page.textContent('main'), /Votre paiement est confirmé/);
  assert.equal(await page.isHidden('[data-cart-count]'), true, 'panier vidé');
  const order = s.readData('orders')[0];
  assert.equal(order.customer.firstName, 'Léa');
  assert.equal(order.status, 'paid');
  assert.equal(order.total, 63900);
  assert.deepEqual(errors, [], JSON.stringify(errors));
  await ctx.close();
});

await step('accueil : « Acheter maintenant » (bloc final) ajoute au panier', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(s.base + '/en/', { waitUntil: 'networkidle' });
  await page.click('[data-quick-add]');
  await page.waitForSelector('[data-drawer]:not([hidden]) .cart-line');
  assert.match(await page.textContent('#drawer-title'), /Your bag/);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-drawer]', { state: 'hidden' });
  await page.close();
});

await step('contact : envoi du formulaire', async () => {
  const page = await browser.newPage();
  await page.goto(s.base + '/fr/contact', { waitUntil: 'networkidle' });
  await page.click('[data-contact-form] button[type=submit]');
  assert.match(await page.textContent('[data-form-status]'), /n'a pas pu être envoyé/);
  await page.fill('[name=name]', 'Inès'); await page.fill('[name=email]', 'ines@example.com');
  await page.fill('[name=message]', 'Le pouf est-il amovible ?'); await page.check('[name=consent]');
  await page.click('[data-contact-form] button[type=submit]');
  await page.waitForFunction(() => /Merci/.test(document.querySelector('[data-form-status]').textContent));
  assert.equal(s.readData('messages')[0].name, 'Inès');
  await page.close();
});

await step('admin : connexion, modification du prix, répercussion sur la fiche produit', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = watch(page);
  await page.goto(s.base + '/admin', { waitUntil: 'networkidle' });
  await page.fill('[name=password]', 'mauvais'); await page.click('button[type=submit]');
  await page.waitForFunction(() => /incorrect/.test(document.getElementById('login-err').textContent));
  await page.fill('[name=password]', 'test-pass'); await page.click('button[type=submit]');
  await page.waitForSelector('.kpis');
  assert.match(await page.textContent('.kpis'), /639/);
  for (const v of ['orders', 'gallery', 'shipping', 'texts', 'faq', 'testimonials', 'messages', 'emails', 'settings']) {
    await page.goto(`${s.base}/admin#${v}`); await page.waitForSelector('.a-head h1');
  }
  await page.goto(s.base + '/admin#product'); await page.waitForSelector('#pf');
  await page.fill('[name=price]', '720'); await page.click('#save');
  await page.waitForSelector('.a-toast');
  const prod = await browser.newPage();
  await prod.goto(s.base + '/fr/coiffeuse-elysea');
  assert.match(await prod.textContent('[data-price-now]'), /720\s€/);
  await prod.close();
  await page.goto(s.base + '/admin#orders'); await page.waitForSelector('tr.click');
  await page.click('tr.click'); await page.waitForSelector('#of');
  await page.selectOption('[name=status]', 'preparing'); await page.click('#of button.primary');
  await page.waitForSelector('.a-toast');
  assert.equal(s.readData('orders')[0].status, 'preparing');
  assert.deepEqual(errors.filter((e) => !/401/.test(e)), []);
  await page.close();
});

await step('mobile : pas de débordement horizontal, menu, barre d’achat', async () => {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  for (const p of PAGES.concat(['/fr/commande'])) {
    await page.goto(s.base + p, { waitUntil: 'networkidle' });
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert.ok(sw <= iw, `${p} : débordement ${sw} > ${iw}`);
  }
  await page.goto(s.base + '/fr/', { waitUntil: 'networkidle' });
  await page.click('[data-menu-open]');
  await page.waitForSelector('[data-menu]:not([hidden])');
  await page.click('[data-menu-close]');
  await page.waitForSelector('[data-menu]', { state: 'hidden' });
  await page.goto(s.base + '/fr/coiffeuse-elysea', { waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => document.querySelector('[data-sticky-buy]').classList.contains('is-visible')), false);
  await page.evaluate(() => scrollTo(0, 2600)); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.querySelector('[data-sticky-buy]').classList.contains('is-visible')), true);
  await ctx.close();
});

await step('changement de langue : FR → EN sur la page équivalente', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(s.base + '/fr/matieres-et-finitions');
  await Promise.all([page.waitForURL('**/en/materials-and-finishes'), page.click('.header-actions a[hreflang=en]')]);
  assert.match(await page.textContent('h1'), /What you don't see, you feel\./);
  await page.close();
});

await browser.close();
await s.stop();
console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests e2e passent.');
process.exit(failures ? 1 : 0);
