/**
 * Fiche produit : galerie, visionneuse plein écran, achat, barre mobile, 3D.
 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const E = window.ELYSEA;
const t = (k, v) => { let s = E.i18n[k] || k; if (v) s = s.replace(/\{(\w+)\}/g, (_, x) => v[x] ?? ''); return s; };
const money = (c) => new Intl.NumberFormat(E.intl, { style: 'currency', currency: E.currency, minimumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);

/* ---------------- Galerie ---------------- */
const slides = $$('[data-slide]');
const thumbs = $$('[data-thumb]');
const label = $('[data-gallery-label]');
let index = 0;
function show(i, focusThumb = false) {
  index = (i + slides.length) % slides.length;
  slides.forEach((s, k) => { s.classList.toggle('is-active', k === index); s.setAttribute('aria-hidden', String(k !== index)); });
  thumbs.forEach((b, k) => { b.classList.toggle('is-active', k === index); b.setAttribute('aria-selected', String(k === index)); });
  if (label) label.textContent = thumbs[index]?.getAttribute('aria-label') || '';
  thumbs[index]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  if (focusThumb) thumbs[index]?.focus();
}
thumbs.forEach((b, k) => b.addEventListener('click', () => show(k)));
$('[data-gallery-prev]')?.addEventListener('click', () => show(index - 1));
$('[data-gallery-next]')?.addEventListener('click', () => show(index + 1));
$('.gallery-thumbs')?.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1, true); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1, true); }
});
// balayage tactile
const stage = $('[data-gallery-stage]');
let sx = null;
stage?.addEventListener('pointerdown', (e) => { sx = e.clientX; });
stage?.addEventListener('pointerup', (e) => { if (sx == null) return; const dx = e.clientX - sx; if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1)); sx = null; });

/* ---------------- Visionneuse plein écran ---------------- */
const lb = $('[data-lightbox-root]');
const lbStage = $('[data-lightbox-stage]');
let lbIndex = 0, lbLast = null;
function lbShow(i) {
  lbIndex = (i + slides.length) % slides.length;
  const pic = slides[lbIndex].querySelector('picture').cloneNode(true);
  const img = pic.querySelector('img');
  img.sizes = '100vw'; img.loading = 'eager';
  img.addEventListener('click', () => img.classList.toggle('is-zoomed'));
  lbStage.replaceChildren(pic);
}
function lbOpen(i) { lbLast = document.activeElement; lb.hidden = false; document.body.style.overflow = 'hidden'; lbShow(i); $('[data-lightbox-close]').focus(); }
function lbClose() { lb.hidden = true; document.body.style.overflow = ''; lbLast?.focus(); }
$$('[data-lightbox]').forEach((b) => b.addEventListener('click', (e) => { if (Math.abs((e.clientX || 0) - (sx ?? e.clientX)) > 10) return; lbOpen(+b.dataset.lightbox); }));
$('[data-lightbox-close]')?.addEventListener('click', lbClose);
$('[data-lightbox-prev]')?.addEventListener('click', () => lbShow(lbIndex - 1));
$('[data-lightbox-next]')?.addEventListener('click', () => lbShow(lbIndex + 1));
lb?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') lbClose();
  if (e.key === 'ArrowRight') lbShow(lbIndex + 1);
  if (e.key === 'ArrowLeft') lbShow(lbIndex - 1);
});
lb?.addEventListener('click', (e) => { if (e.target === lb) lbClose(); });

/* ---------------- Achat ---------------- */
const form = $('[data-buy-form]');
if (form) {
  const variants = JSON.parse(form.dataset.variants);
  const low = +form.dataset.low;
  const qty = form.querySelector('input[name=qty]');
  const addBtn = $('[data-add]', form);
  const current = () => variants.find((v) => v.id === form.querySelector('input[name=variant]:checked')?.value) || variants[0];
  const stockHtml = (v) => v.stock <= 0 ? `<span class="stock out">${t('product.outOfStock')}</span>` : low >= 0 && v.stock <= low ? `<span class="stock low">${t('product.lowStock', { n: v.stock })}</span>` : `<span class="stock in">${t('product.inStock')}</span>`;
  function refresh() {
    const v = current();
    $('[data-variant-name]').textContent = form.querySelector('input[name=variant]:checked')?.dataset.name || '';
    $('[data-stock]').innerHTML = stockHtml(v);
    qty.max = Math.max(1, Math.min(10, v.stock));
    if (+qty.value > +qty.max) qty.value = qty.max;
    addBtn.disabled = v.stock <= 0;
    const st = $('[data-sticky-add]'); if (st) st.disabled = v.stock <= 0;
    $$('[data-price-now]').forEach((el) => (el.textContent = money(v.price)));
    $$('[data-price-was]').forEach((el) => (el.textContent = v.compareAt ? money(v.compareAt) : ''));
    const sp = $('[data-sticky-price]'); if (sp) sp.textContent = money(v.price);
    if (v.image) { const k = slides.findIndex((s) => s.querySelector('img')?.src.includes(`/${v.image}-`)); if (k >= 0) show(k); }
  }
  form.addEventListener('change', (e) => { if (e.target.name === 'variant') refresh(); });
  $('[data-qty-dec]', form).addEventListener('click', () => { qty.value = Math.max(1, +qty.value - 1); });
  $('[data-qty-inc]', form).addEventListener('click', () => { qty.value = Math.min(+qty.max, +qty.value + 1); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = current();
    if (v.stock <= 0) return;
    window.ELYSEA_SITE.addToCart(v.id, Math.max(1, Math.min(+qty.max, +qty.value || 1)));
  });
  $('[data-sticky-add]')?.addEventListener('click', () => { const v = current(); if (v.stock > 0) window.ELYSEA_SITE.addToCart(v.id, 1); });

  // barre d'achat mobile : visible quand le bouton principal sort de l'écran
  const sticky = $('[data-sticky-buy]');
  if (sticky) {
    sticky.hidden = false;
    new IntersectionObserver(([en]) => sticky.classList.toggle('is-visible', !en.isIntersecting && en.boundingClientRect.top < 0)).observe(addBtn);
  }
}

/* ---------------- Viewer 3D ---------------- */
const root = $('[data-viewer]');
if (root) {
  let api = null, loading = false;
  const startBtn = $('[data-viewer-start]', root);
  const labels = {
    mirror: (s) => t(s.mirror ? 'product.viewer.mirrorClose' : 'product.viewer.mirror'),
    pouf: (s) => t(s.pouf ? 'product.viewer.poufIn' : 'product.viewer.pouf'),
    rotate: (s) => t(s.rotate ? 'product.viewer.stop' : 'product.viewer.rotate')
  };
  function onState(s) {
    $$('[data-act]', root).forEach((b) => {
      const k = b.dataset.act;
      if (k in s) b.setAttribute('aria-pressed', String(!!s[k]));
      if (labels[k]) { const span = b.querySelector('span'); if (span) span.textContent = labels[k](s); b.setAttribute('aria-label', labels[k](s)); }
    });
  }
  async function start() {
    if (api || loading) return;
    loading = true;
    const { webglAvailable, mountViewer } = await import('./3d/viewer.js');
    if (!webglAvailable()) { $('[data-viewer-fallback]', root).hidden = false; startBtn.hidden = true; return; }
    root.classList.add('is-loading'); $('[data-viewer-loading]', root).hidden = false;
    try {
      api = await mountViewer(root, { onState });
      window.__elyseaViewer = api;
      root.classList.add('is-live');
    } catch (err) {
      console.error(err);
      $('[data-viewer-fallback]', root).hidden = false;
    } finally {
      root.classList.remove('is-loading'); $('[data-viewer-loading]', root).hidden = true; loading = false;
    }
  }
  startBtn.addEventListener('click', start);
  $$('[data-act]', root).forEach((b) => b.addEventListener('click', () => {
    if (!api) return;
    const s = api.state;
    ({ mirror: () => api.setMirror(!s.mirror), pouf: () => api.setPouf(!s.pouf), rotate: () => api.setRotate(!s.rotate), fabric: () => api.setFabric(!s.fabric), reset: () => api.reset() })[b.dataset.act]();
  }));
  // démarrage automatique sur ordinateur, à l'approche de la section
  const saveData = navigator.connection?.saveData;
  if (matchMedia('(pointer: fine) and (min-width: 901px)').matches && !saveData) {
    const io = new IntersectionObserver(([en]) => { if (en.isIntersecting) { io.disconnect(); start(); } }, { rootMargin: '300px' });
    io.observe(root);
  }
}
