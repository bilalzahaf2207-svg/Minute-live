'use strict';
/** API publique : devis panier, commande, paiement, webhook Stripe, contact. */
const store = require('./store');
const commerce = require('./commerce');
const stripe = require('./stripe');
const mail = require('./mail');
const { paymentMode } = require('./payments');
const { json, readJSON, readBody, rateLimit, clientIp } = require('./http');
const { url, LANGS, L } = require('./i18n');
const { origin } = require('./views/layout');

const lang = (x) => (LANGS.includes(x) ? x : 'fr');

async function sendOrderEmails(order) {
  const o = commerce.getOrder(order.id);
  if (!o || o.emails.confirmation) return;
  await commerce.patchOrder(o.id, (x) => { x.emails.confirmation = new Date().toISOString(); });
  await mail.orderConfirmation(o);
  await mail.orderAdminNotification(o);
}

/** Vérifie auprès de Stripe une session (si le webhook n'est pas encore arrivé). */
async function syncStripe(order) {
  if (!order || order.payment.provider !== 'stripe' || order.payment.status === 'paid' || !order.payment.sessionId || !stripe.enabled()) return order;
  try {
    const s = await stripe.retrieveSession(order.payment.sessionId);
    if (s.payment_status === 'paid') {
      const o = await commerce.markPaid(order.id, { paymentIntent: s.payment_intent || null });
      await sendOrderEmails(o);
      return commerce.getOrder(order.id);
    }
    if (s.status === 'expired') await commerce.setStatus(order.id, 'payment_failed', 'session expirée');
  } catch (_) { /* on réessaiera */ }
  return commerce.getOrder(order.id);
}

function publicOrder(o) {
  return { id: o.id, status: o.status, paid: o.payment.status === 'paid', total: o.total, currency: o.currency, items: o.items.map(({ name, variantName, qty, total }) => ({ name, variantName, qty, total })) };
}

async function handle(req, res, pathname, query) {
  const ip = clientIp(req);

  // Catalogue (pour le JS client)
  if (pathname === '/api/product' && req.method === 'GET') {
    const p = store.get('product'); const lg = lang(query.get('lang'));
    const s = store.get('settings');
    return json(req, res, 200, {
      id: p.id, name: L(p.name, lg), currency: p.currency,
      variants: p.variants.filter((v) => v.active !== false).map((v) => ({ id: v.id, name: L(v.name, lg), stock: v.stock, image: v.image, swatch: v.swatch, ...commerce.variantPricing(p, v) })),
      lowStock: s.showLowStock ? s.lowStockThreshold : -1
    });
  }

  // Devis : lignes recalculées côté serveur
  if (pathname === '/api/cart/quote' && req.method === 'POST') {
    const body = await readJSON(req, 2e4);
    const q = commerce.quote(body.items, body.country, lang(body.lang));
    return json(req, res, 200, { ...q, paymentMode: paymentMode() });
  }

  // Création de commande + paiement
  if (pathname === '/api/checkout' && req.method === 'POST') {
    if (!rateLimit(`co:${ip}`, 20, 10 * 60e3)) return json(req, res, 429, { error: 'rate_limited' });
    const body = await readJSON(req, 5e4);
    const lg = lang(body.lang);
    const mode = paymentMode();
    if (mode === 'none') return json(req, res, 503, { error: 'payments_disabled' });
    const v = commerce.validateCheckout(body);
    if (!v.ok) return json(req, res, 422, { error: 'validation', fields: v.errors });
    let order;
    try { order = await commerce.createOrder({ items: body.items, customer: v.customer, address: v.address, lang: lg, provider: mode }); }
    catch (err) { return json(req, res, err.status || 400, { error: err.code || 'order', issues: err.issues }); }
    const o = origin(req);
    const confirmUrl = `${o}${url('confirmation', lg, { order: order.id, t: order.token })}`;
    if (mode === 'stripe') {
      try {
        const session = await stripe.createCheckoutSession(order, {
          successUrl: `${confirmUrl}&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${o}${url('checkout', lg)}?cancelled=${order.id}`,
          imageBase: /^https:/.test(o) ? o : null
        });
        await commerce.patchOrder(order.id, (x) => { x.payment.sessionId = session.id; });
        return json(req, res, 200, { orderId: order.id, redirectUrl: session.url });
      } catch (err) {
        await commerce.setStatus(order.id, 'payment_failed', err.message);
        return json(req, res, 502, { error: 'stripe' });
      }
    }
    // mode démonstration : renvoie un jeton de paiement simulé
    return json(req, res, 200, { orderId: order.id, demo: true, token: order.token, redirectUrl: confirmUrl });
  }

  // Paiement simulé (démonstration uniquement)
  if (pathname === '/api/checkout/demo-pay' && req.method === 'POST') {
    if (paymentMode() !== 'demo') return json(req, res, 403, { error: 'demo_disabled' });
    const body = await readJSON(req, 2e3);
    const o = commerce.getOrder(body.orderId);
    if (!o || o.token !== body.token || o.payment.provider !== 'demo') return json(req, res, 404, { error: 'not_found' });
    const paid = await commerce.markPaid(o.id, { demo: true });
    await sendOrderEmails(paid);
    return json(req, res, 200, { ok: true, order: publicOrder(commerce.getOrder(o.id)) });
  }

  // Statut de commande (page de confirmation)
  if (pathname === '/api/order' && req.method === 'GET') {
    let o = commerce.getOrder(query.get('id') || '');
    if (!o || o.token !== query.get('t')) return json(req, res, 404, { error: 'not_found' });
    o = await syncStripe(o);
    return json(req, res, 200, publicOrder(o));
  }

  // Webhook Stripe (corps brut obligatoire pour la signature)
  if (pathname === '/api/stripe/webhook' && req.method === 'POST') {
    const raw = (await readBody(req, 1e6)).toString('utf8');
    if (!stripe.verifySignature(raw, req.headers['stripe-signature'])) return json(req, res, 400, { error: 'signature' });
    let evt; try { evt = JSON.parse(raw); } catch (_) { return json(req, res, 400, { error: 'json' }); }
    const obj = evt.data?.object || {};
    const orderId = obj.metadata?.order_id || obj.client_reference_id;
    if (orderId && commerce.getOrder(orderId)) {
      if ((evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') && obj.payment_status === 'paid') {
        const o = await commerce.markPaid(orderId, { paymentIntent: obj.payment_intent || null, sessionId: obj.id });
        await sendOrderEmails(o);
      } else if (evt.type === 'checkout.session.expired' || evt.type === 'checkout.session.async_payment_failed') {
        const o = commerce.getOrder(orderId);
        if (o.payment.status !== 'paid') await commerce.setStatus(orderId, 'payment_failed', evt.type);
      }
    }
    return json(req, res, 200, { received: true });
  }

  // Formulaire de contact
  if (pathname === '/api/contact' && req.method === 'POST') {
    if (!rateLimit(`ct:${ip}`, 5, 10 * 60e3)) return json(req, res, 429, { error: 'rate_limited' });
    const b = await readJSON(req, 2e4);
    if (b.website) return json(req, res, 200, { ok: true }); // pot de miel
    const msg = {
      id: `MSG-${Date.now().toString(36).toUpperCase()}`, at: new Date().toISOString(), lang: lang(b.lang),
      name: commerce.clean(b.name, 120), email: commerce.clean(b.email, 160).toLowerCase(), subject: commerce.clean(b.subject, 60),
      order: commerce.clean(b.order, 40), message: commerce.clean(b.message, 4000).replace(/ {2,}/g, ' '), read: false
    };
    msg.message = String(b.message || '').slice(0, 4000).replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
    if (!msg.name || !commerce.EMAIL_RE.test(msg.email) || msg.message.trim().length < 5 || !b.consent) return json(req, res, 422, { error: 'validation' });
    await store.update('messages', (list) => { list.unshift(msg); });
    mail.contactMessage(msg).catch(() => {});
    return json(req, res, 200, { ok: true });
  }

  return json(req, res, 404, { error: 'not_found' });
}

module.exports = { handle, syncStripe, sendOrderEmails };
