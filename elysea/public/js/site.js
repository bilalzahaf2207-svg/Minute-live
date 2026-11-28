/**
 * ELYSÉA — interactions communes à toutes les pages.
 */
import { cart, quote, money, t, esc, thumb } from './cart.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const E = window.ELYSEA;

/* ---------------- En-tête ---------------- */
const header = $('[data-header]');
let lastY = 0;
function onScroll() {
  const y = scrollY;
  header.classList.toggle('is-scrolled', y > 40);
  header.classList.toggle('is-hidden', y > 400 && y > lastY + 4 && !document.body.classList.contains('menu-open'));
  if (y < lastY - 4 || y < 400) header.classList.remove('is-hidden');
  lastY = y;
}
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---------------- Menu mobile ---------------- */
const menu = $('[data-menu]');
const openBtn = $('[data-menu-open]');
function setMenu(open) {
  menu.hidden = !open;
  openBtn.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('menu-open', open);
  document.body.style.overflow = open ? 'hidden' : '';
  if (open) $('[data-menu-close]').focus(); else openBtn.focus();
}
openBtn?.addEventListener('click', () => setMenu(true));
$('[data-menu-close]')?.addEventListener('click', () => setMenu(false));
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) setMenu(false); });

/* ---------------- Apparitions ---------------- */
const io = new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
}, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
$$('.reveal').forEach((el) => (reduced ? el.classList.add('is-in') : io.observe(el)));

/* ---------------- Parallaxe subtile ---------------- */
const para = reduced ? [] : $$('[data-parallax]');
if (para.length) {
  let ticking = false;
  const update = () => {
    ticking = false;
    const vh = innerHeight;
    for (const el of para) {
      const r = el.getBoundingClientRect();
      if (r.bottom < -200 || r.top > vh + 200) continue;
      const k = parseFloat(el.dataset.parallax);
      const center = r.top + r.height / 2 - vh / 2;
      el.style.transform = `translate3d(0, ${(-center * k).toFixed(1)}px, 0)`;
    }
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}

/* ---------------- Loupe matière ---------------- */
$$('[data-zoom]').forEach((el) => {
  const move = (x, y) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--zx', `${((x - r.left) / r.width) * 100}%`);
    el.style.setProperty('--zy', `${((y - r.top) / r.height) * 100}%`);
  };
  el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { el.classList.add('is-zooming'); move(e.clientX, e.clientY); } });
  el.addEventListener('pointermove', (e) => { if (el.classList.contains('is-zooming')) move(e.clientX, e.clientY); });
  el.addEventListener('pointerleave', () => el.classList.remove('is-zooming'));
  el.addEventListener('click', (e) => { el.classList.toggle('is-zooming'); move(e.clientX, e.clientY); });
});

/* ---------------- Rail (glisser à la souris) ---------------- */
$$('[data-rail]').forEach((rail) => {
  let down = false, sx = 0, sl = 0, moved = false;
  rail.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') return; down = true; moved = false; sx = e.clientX; sl = rail.scrollLeft; });
  addEventListener('pointerup', () => { down = false; rail.classList.remove('is-dragging'); });
  rail.addEventListener('pointermove', (e) => { if (!down) return; const dx = e.clientX - sx; if (Math.abs(dx) > 4) { moved = true; rail.classList.add('is-dragging'); } rail.scrollLeft = sl - dx; });
  rail.addEventListener('click', (e) => { if (moved) { e.preventDefault(); moved = false; } }, true);
});

/* ---------------- Toast ---------------- */
const toastEl = $('[data-toast]');
let toastTimer;
export function toast(html, ms = 3200) {
  toastEl.innerHTML = html;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
}

/* ---------------- Tiroir panier ---------------- */
const drawer = $('[data-drawer]');
const panel = $('.drawer-panel', drawer);
let lastFocus = null;
function openDrawer() {
  lastFocus = document.activeElement;
  drawer.hidden = false; drawer.classList.remove('is-closing');
  document.body.style.overflow = 'hidden';
  renderDrawer();
  requestAnimationFrame(() => panel.focus());
}
function closeDrawer() {
  drawer.classList.add('is-closing');
  setTimeout(() => { drawer.hidden = true; drawer.classList.remove('is-closing'); document.body.style.overflow = ''; lastFocus?.focus?.(); }, reduced ? 0 : 380);
}
$$('[data-drawer-close]').forEach((b) => b.addEventListener('click', closeDrawer));
drawer.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
  if (e.key === 'Tab') { // piège de focus
    const f = $$('a[href], button:not([disabled]), input', panel).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
});
$('[data-cart-open]')?.addEventListener('click', (e) => {
  if (document.body.classList.contains('page-cart') || document.body.classList.contains('page-checkout')) return;
  e.preventDefault(); openDrawer();
});

function lineHtml(l) {
  return `<div class="cart-line" data-line="${esc(l.variantId)}">
    <img src="${thumb(l.image)}" alt="" width="84" height="105" loading="lazy">
    <div><h3>${esc(l.name)}</h3><p class="variant">${esc(l.variantName)}</p>
      <div class="line-actions">
        <div class="qty"><button type="button" class="icon-btn" data-dec aria-label="−"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5 12h14"/></svg></button><input type="number" min="1" max="10" value="${l.qty}" aria-label="${esc(t('cart.qty'))}" data-qty-input><button type="button" class="icon-btn" data-inc aria-label="+"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 5v14M5 12h14"/></svg></button></div>
        <button type="button" class="remove-btn" data-remove>${esc(t('cart.remove'))}</button>
      </div></div>
    <div class="line-price">${money(l.total)}${l.compareAt ? `<s>${money(l.compareAt * l.qty)}</s>` : ''}</div>
  </div>`;
}
function totalsHtml(q, withShipping) {
  return `<ul class="totals">
    <li><span>${esc(t('cart.subtotal'))}</span><span>${money(q.subtotal)}</span></li>
    ${q.savings > 0 ? `<li><span>${esc(t('cart.discount'))}</span><span>−${money(q.savings)}</span></li>` : ''}
    <li><span>${esc(t('cart.shipping'))}</span><span class="muted">${withShipping && q.shipping != null ? (q.shipping ? money(q.shipping) : esc(t('cart.free'))) : esc(t('cart.shippingTbd'))}</span></li>
    <li class="total"><span>${esc(t('cart.total'))}</span><span>${money(q.total)}</span></li>
  </ul>`;
}
function bindLines(root) {
  $$('[data-line]', root).forEach((row) => {
    const id = row.dataset.line;
    const input = $('[data-qty-input]', row);
    $('[data-dec]', row).onclick = () => cart.set(id, +input.value - 1);
    $('[data-inc]', row).onclick = () => cart.set(id, +input.value + 1);
    input.onchange = () => cart.set(id, Math.max(1, +input.value || 1));
    $('[data-remove]', row).onclick = () => cart.set(id, 0);
  });
}
async function syncQuote() {
  const q = await quote();
  // aligne le panier local sur le stock réel
  if (q.issues?.some((i) => i.type === 'stock' || i.type === 'unavailable')) {
    cart.replace(q.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })));
    toast(esc(t('cart.stockLimited')));
  }
  return q;
}
async function renderDrawer() {
  const body = $('[data-cart-lines]'); const foot = $('[data-cart-foot]');
  if (!cart.count()) {
    body.innerHTML = `<div class="cart-empty"><p>${esc(t('cart.empty'))}</p><a class="btn btn-dark" href="${E.routes.product}">${esc(t('cart.emptyCta'))}</a></div>`;
    foot.innerHTML = ''; return;
  }
  try {
    const q = await syncQuote();
    body.innerHTML = q.lines.map(lineHtml).join('');
    foot.innerHTML = `${totalsHtml(q, false)}<a class="btn btn-dark" href="${E.routes.checkout}">${esc(t('cart.checkout'))}</a><a class="btn btn-outline" href="${E.routes.cart}">${esc(t('cart.viewCart'))}</a>`;
    bindLines(body);
  } catch (_) { body.innerHTML = `<p class="muted">${esc(t('checkout.error'))}</p>`; }
}

/* page Panier */
async function renderCartPage() {
  const root = $('[data-cart-page]');
  if (!root) return;
  if (!cart.count()) {
    root.innerHTML = `<div class="cart-empty" style="grid-column:1/-1"><p>${esc(t('cart.empty'))}</p><a class="btn btn-dark" href="${E.routes.product}">${esc(t('cart.emptyCta'))}</a></div>`;
    return;
  }
  const q = await syncQuote();
  root.innerHTML = `<div>${q.lines.map(lineHtml).join('')}<p class="fineprint">${esc(t('cart.taxNote'))}</p></div>
    <aside class="card">${totalsHtml(q, false)}<a class="btn btn-dark btn-block" style="margin-top:20px" href="${E.routes.checkout}">${esc(t('cart.checkout'))}</a><a class="link-arrow" style="margin-top:20px" href="${E.routes.product}">${esc(t('cart.continue'))}</a></aside>`;
  bindLines(root);
}

/* compteur */
const countEl = $('[data-cart-count]');
function updateCount() {
  const n = cart.count();
  countEl.textContent = n;
  countEl.hidden = n === 0;
}
cart.onChange(() => {
  updateCount();
  if (!drawer.hidden) renderDrawer();
  renderCartPage();
});
updateCount();
renderCartPage();

/* ajout rapide (accueil) */
async function firstVariant() {
  const r = await fetch(`/api/product?lang=${E.lang}`);
  const p = await r.json();
  return p.variants.find((v) => v.stock > 0);
}
$$('[data-quick-add]').forEach((btn) => btn.addEventListener('click', async () => {
  const v = await firstVariant();
  if (!v) { location.href = E.routes.product; return; }
  addToCart(v.id, 1);
}));

export function addToCart(variantId, qty) {
  cart.add(variantId, qty);
  const b = $('[data-cart-open]');
  b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
  openDrawer();
}

window.ELYSEA_SITE = { addToCart, toast, openDrawer };
document.documentElement.classList.remove('no-js');
