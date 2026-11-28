/**
 * Tunnel de commande : devis serveur à chaque changement de pays,
 * validation, création de commande, redirection Stripe (ou paiement simulé).
 */
import { cart, quote, money, t, esc, thumb } from './cart.js';
const $ = (s, r = document) => r.querySelector(s);
const E = window.ELYSEA;
const form = $('[data-checkout-form]');
const summary = $('[data-summary-lines]');
const payBtn = $('[data-pay]');
const status = $('[data-form-status]');
let lastQuote = null;

const SAVE = 'elysea.checkout.v1';
const fields = ['email', 'phone', 'firstName', 'lastName', 'line1', 'line2', 'postalCode', 'city', 'country', 'notes'];
try { const saved = JSON.parse(sessionStorage.getItem(SAVE) || '{}'); fields.forEach((f) => { if (saved[f] && form.elements[f]) form.elements[f].value = saved[f]; }); } catch (_) {}
form.addEventListener('input', () => { try { sessionStorage.setItem(SAVE, JSON.stringify(Object.fromEntries(fields.map((f) => [f, form.elements[f]?.value || ''])))); } catch (_) {} });

async function refresh() {
  if (!cart.count()) { location.href = E.routes.cart; return; }
  try {
    const q = await quote(form.elements.country.value);
    lastQuote = q;
    if (q.issues?.length) cart.replace(q.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })));
    summary.innerHTML = `<ul class="summary-lines">${q.lines.map((l) => `<li><img src="${thumb(l.image)}" alt="" width="64" height="80"><span>${esc(l.name)}<small>${esc(l.variantName)} × ${l.qty}</small></span><span>${money(l.total)}</span></li>`).join('')}</ul>
      <ul class="summary-totals" style="margin-top:14px">
        <li><span>${esc(t('cart.subtotal'))}</span><span>${money(q.subtotal)}</span></li>
        ${q.savings > 0 ? `<li><span>${esc(t('cart.discount'))}</span><span>−${money(q.savings)}</span></li>` : ''}
        <li><span>${esc(t('cart.shipping'))}${q.shippingZone?.delay ? ` <small class="muted">(${esc(q.shippingZone.delay)})</small>` : ''}</span><span>${q.shipping == null ? '—' : q.shipping ? money(q.shipping) : esc(t('cart.free'))}</span></li>
        <li class="total"><span>${esc(t('cart.total'))}</span><span>${money(q.total)}</span></li>
      </ul>${q.shippable === false ? `<p class="notice notice-warn" style="margin-top:14px">${esc(t('checkout.noShipping'))}</p>` : ''}`;
    const label = form.dataset.mode === 'demo' ? 'checkout.payDemo' : 'checkout.pay';
    payBtn.textContent = t(label, { amount: money(q.total) });
    if (form.dataset.mode !== 'none') payBtn.disabled = q.shippable === false || !q.lines.length;
  } catch (_) { summary.innerHTML = `<p class="muted">${esc(t('checkout.error'))}</p>`; }
}
form.elements.country.addEventListener('change', refresh);
refresh();

function markErrors(errs) {
  form.querySelectorAll('.has-error').forEach((el) => el.classList.remove('has-error'));
  for (const k of Object.keys(errs || {})) {
    const el = form.elements[k === 'line1' ? 'line1' : k];
    (el?.closest('.field') || el?.closest('.check'))?.classList.add('has-error');
  }
  const first = form.querySelector('.has-error input, .has-error select');
  first?.focus();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  status.textContent = ''; status.className = 'form-status';
  const f = form.elements;
  // validation locale (le serveur revalide systématiquement)
  const missing = {};
  form.querySelectorAll('[required]').forEach((el) => { if (el.type === 'checkbox' ? !el.checked : !el.checkValidity()) missing[el.name] = 'required'; });
  if (Object.keys(missing).length) { markErrors(missing); status.textContent = t('checkout.error'); status.classList.add('err'); return; }
  const body = {
    lang: E.lang, items: cart.items(), acceptTerms: f.acceptTerms.checked,
    customer: { email: f.email.value, phone: f.phone.value },
    address: { firstName: f.firstName.value, lastName: f.lastName.value, line1: f.line1.value, line2: f.line2.value, postalCode: f.postalCode.value, city: f.city.value, country: f.country.value, notes: f.notes.value }
  };
  const prev = payBtn.textContent;
  payBtn.disabled = true; payBtn.textContent = t('checkout.processing');
  try {
    const r = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) {
      if (data.fields) markErrors(data.fields);
      if (data.error === 'stock') { await refresh(); }
      throw new Error(data.error);
    }
    if (data.demo) {
      const p = await fetch('/api/checkout/demo-pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: data.orderId, token: data.token }) });
      if (!p.ok) throw new Error('demo');
    }
    cart.clear();
    try { sessionStorage.removeItem(SAVE); } catch (_) {}
    location.href = data.redirectUrl;
  } catch (err) {
    status.textContent = t('checkout.error'); status.classList.add('err');
    payBtn.disabled = false; payBtn.textContent = prev;
  }
});
