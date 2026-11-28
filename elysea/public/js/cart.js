/**
 * Panier client : uniquement { variantId, qty } en localStorage.
 * Les montants affichés proviennent TOUJOURS du devis serveur (/api/cart/quote).
 */
const KEY = 'elysea.cart.v1';
const listeners = new Set();

function read() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; }
}
function write(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (_) { /* navigation privée */ }
  listeners.forEach((fn) => fn(items));
  window.dispatchEvent(new CustomEvent('cart:change', { detail: items }));
}

export const cart = {
  items: read,
  count: () => read().reduce((s, i) => s + i.qty, 0),
  add(variantId, qty = 1) {
    const items = read();
    const it = items.find((i) => i.variantId === variantId);
    if (it) it.qty = Math.min(10, it.qty + qty); else items.push({ variantId, qty: Math.min(10, qty) });
    write(items);
  },
  set(variantId, qty) {
    let items = read();
    if (qty <= 0) items = items.filter((i) => i.variantId !== variantId);
    else { const it = items.find((i) => i.variantId === variantId); if (it) it.qty = Math.min(10, qty); }
    write(items);
  },
  replace(items) { write(items); },
  clear() { write([]); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
};

window.addEventListener('storage', (e) => { if (e.key === KEY) write(read()); });

export async function quote(country) {
  const r = await fetch('/api/cart/quote', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: cart.items(), country, lang: window.ELYSEA.lang })
  });
  if (!r.ok) throw new Error('quote');
  return r.json();
}

export function money(cents) {
  const E = window.ELYSEA;
  return new Intl.NumberFormat(E.intl, { style: 'currency', currency: E.currency, minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}
export const t = (k, vars) => {
  let s = window.ELYSEA.i18n[k] || k;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, x) => vars[x] ?? `{${x}}`);
  return s;
};
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const thumb = (src) => src || '/img/favicon.svg';
