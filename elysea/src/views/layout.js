'use strict';
/**
 * Gabarit commun : <head> SEO complet, en-tête, pied de page, composants partagés.
 */
const path = require('path');
const config = require('../config');
const store = require('../store');
const { t, L, url, LANGS, LOCALES, ROUTES } = require('../i18n');
const { escapeHtml: e, fileHash } = require('../http');
const { formatMoney, variantPricing } = require('../commerce');

/* Versionnage des ressources (cache immuable) */
const assetVersions = {};
function asset(p) {
  if (!assetVersions[p] || !config.isProd) assetVersions[p] = fileHash(path.join(config.publicDir, p));
  return `${p}?v=${assetVersions[p]}`;
}

function origin(req) {
  if (config.siteUrl) return config.siteUrl;
  const s = store.get('settings').siteUrl;
  if (s) return s.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers.host || `localhost:${config.port}`}`;
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */
const MIME = { avif: 'image/avif', webp: 'image/webp', jpg: 'image/jpeg' };
/**
 * <picture> responsive. img = entrée de galerie { src, widths, formats, ratio, alt }.
 * sizes : attribut sizes. eager : LCP (pas de lazy, fetchpriority haute).
 */
function picture(img, lang, { sizes = '100vw', eager = false, cls = '', alt, imgCls = '', attrs = '' } = {}) {
  if (!img) return '';
  const widths = img.widths || [1000];
  const formats = img.formats || ['jpg'];
  const fallbackFmt = formats.includes('jpg') ? 'jpg' : formats[formats.length - 1];
  const srcset = (fmt) => widths.map((w) => `${img.src}-${w}.${fmt} ${w}w`).join(', ');
  const [rw, rh] = String(img.ratio || '4/5').split('/').map(Number);
  const W = widths[widths.length - 1];
  const H = Math.round((W * rh) / rw);
  const sources = formats.filter((f) => f !== fallbackFmt).map((f) => `<source type="${MIME[f]}" srcset="${srcset(f)}" sizes="${sizes}">`).join('');
  return `<picture class="${cls}">${sources}<img class="${imgCls}" src="${img.src}-${widths[Math.min(1, widths.length - 1)]}.${fallbackFmt}" srcset="${srcset(fallbackFmt)}" sizes="${sizes}" width="${W}" height="${H}" alt="${e(alt ?? L(img.alt, lang))}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" ${attrs}></picture>`;
}

/** Visuel de rendu par identifiant (public/img/renders). */
function render(id, lang, opts = {}) {
  const fmt = id.startsWith('interior') || id === 'hero' ? { widths: [800, 1400, 2400], ratio: '16/9' }
    : id === 'hero-portrait' ? { widths: [500, 750, 1000], ratio: '1/2' }
    : id.startsWith('macro') || id === 'studio-top' ? { widths: [600, 1000, 1600], ratio: '1/1' }
    : { widths: [640, 1000, 1600], ratio: '4/5' };
  const gal = store.get('product').gallery.find((g) => g.id === id);
  return picture({ src: `/img/renders/${id}`, formats: ['avif', 'webp', 'jpg'], ...fmt, alt: gal?.alt || opts.alt || '' }, lang, opts);
}

/* ------------------------------------------------------------------ */
/* Icônes (traits fins, cohérentes)                                    */
/* ------------------------------------------------------------------ */
const ICONS = {
  bag: '<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  menu: '<path d="M4 8h16M4 16h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  truck: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>',
  ruler: '<circle cx="12" cy="12" r="8"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/>',
  chat: '<path d="M4 6h16v10H9l-5 4V6Z"/>',
  mirror: '<circle cx="12" cy="9" r="6"/><path d="M12 15v5M8 20h8"/>',
  drawer: '<rect x="4" y="6" width="16" height="12" rx="1"/><path d="M4 11h16M10 14h4"/>',
  seat: '<path d="M4 14a8 8 0 0 1 16 0v1H4z"/><path d="M6 15v4M18 15v4"/>',
  compact: '<circle cx="12" cy="12" r="8"/><path d="M8 12h8M12 8v8" opacity=".5"/>',
  layers: '<path d="m12 4 8 4-8 4-8-4 8-4Z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>',
  zoom: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5M11 8v6M8 11h6"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/>',
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M12 12v9M12 12l8-4.5M12 12 4 7.5"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  instagram: '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3.5"/><circle cx="17" cy="7" r=".6"/>',
  pinterest: '<circle cx="12" cy="12" r="8"/><path d="M11 9.5c0 4-1 6.5-2 9.5M10.5 14c3 1.5 6-1 5-4-.8-2.6-6-3-7 .5"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'
};
function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
}

/* ------------------------------------------------------------------ */
function priceBlock(lang, { size = '' } = {}) {
  const p = store.get('product');
  const v = p.variants.find((x) => x.active !== false) || p.variants[0];
  const pr = variantPricing(p, v);
  return `<div class="price ${size}" data-price>
    <span class="price-now" data-price-now>${formatMoney(pr.price, lang)}</span>
    ${pr.compareAt ? `<s class="price-was" data-price-was>${formatMoney(pr.compareAt, lang)}</s>` : ''}
    ${pr.promo ? `<span class="badge">${e(L(pr.promo.label, lang))}</span>` : ''}
  </div>`;
}

function reassurance(lang, cls = '') {
  const items = store.get('settings').reassurance || [];
  if (!items.length) return '';
  return `<ul class="reassurance ${cls}" aria-label="${e(t(lang, 'reassurance.title'))}">${items.map((r) => `<li>${icon(r.icon)}<div><strong>${e(L(r.title, lang))}</strong><span>${e(L(r.text, lang))}</span></div></li>`).join('')}</ul>`;
}

/* ------------------------------------------------------------------ */
function header(lang, page, { transparent = false } = {}) {
  const nav = [['product', 'nav.collection'], ['design', 'nav.design'], ['materials', 'nav.materials'], ['inspiration', 'nav.inspiration'], ['contact', 'nav.contact']];
  const links = nav.map(([p, k]) => `<a href="${url(p, lang)}"${p === page ? ' aria-current="page"' : ''}>${e(t(lang, k))}</a>`).join('');
  const langLinks = LANGS.map((l) => `<a href="${url(ROUTES[page] ? page : 'home', l)}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="true"' : ''}>${l.toUpperCase()}</a>`).join('<span aria-hidden="true">/</span>');
  return `<a class="skip" href="#main">${e(t(lang, 'nav.skip'))}</a>
<header class="site-header${transparent ? ' is-transparent' : ''}" data-header>
  <div class="header-inner">
    <button class="icon-btn menu-btn" type="button" data-menu-open aria-label="${e(t(lang, 'nav.menu'))}" aria-expanded="false" aria-controls="mobile-menu">${icon('menu')}</button>
    <a class="logo" href="${url('home', lang)}" aria-label="ELYSÉA — ${e(t(lang, 'nav.home'))}"><span>ELYSÉA</span></a>
    <nav class="main-nav" aria-label="Navigation">${links}</nav>
    <div class="header-actions">
      <div class="lang-switch" aria-label="${e(t(lang, 'nav.language'))}">${langLinks}</div>
      <a class="icon-btn cart-btn" href="${url('cart', lang)}" data-cart-open aria-label="${e(t(lang, 'nav.cart'))}">${icon('bag')}<span class="cart-count" data-cart-count hidden>0</span></a>
    </div>
  </div>
</header>
<div class="mobile-menu" id="mobile-menu" data-menu hidden>
  <div class="mobile-menu-inner">
    <button class="icon-btn" type="button" data-menu-close aria-label="${e(t(lang, 'nav.close'))}">${icon('close')}</button>
    <nav aria-label="Navigation mobile">${nav.map(([p, k], i) => `<a href="${url(p, lang)}" style="--i:${i}">${e(t(lang, k))}</a>`).join('')}</nav>
    <div class="lang-switch">${langLinks}</div>
  </div>
</div>`;
}

function footer(lang) {
  const s = store.get('settings');
  const social = [['instagram', s.social?.instagram], ['pinterest', s.social?.pinterest]].filter(([, v]) => v);
  return `<footer class="site-footer">
  <div class="container footer-grid">
    <div class="footer-brand">
      <a class="logo" href="${url('home', lang)}"><span>ELYSÉA</span></a>
      <p class="eyebrow">${e(t(lang, 'brand.collection'))}</p>
      <p>${e(t(lang, 'footer.tagline'))}</p>
      ${social.length ? `<div class="social">${social.map(([n, h]) => `<a href="${e(h)}" rel="noopener" target="_blank" aria-label="${n}">${icon(n)}</a>`).join('')}</div>` : ''}
    </div>
    <div><h2 class="footer-title">${e(t(lang, 'footer.shop'))}</h2><ul>
      <li><a href="${url('product', lang)}">${e(t(lang, 'nav.collection'))}</a></li>
      <li><a href="${url('design', lang)}">${e(t(lang, 'nav.design'))}</a></li>
      <li><a href="${url('materials', lang)}">${e(t(lang, 'nav.materials'))}</a></li>
      <li><a href="${url('inspiration', lang)}">${e(t(lang, 'nav.inspiration'))}</a></li></ul></div>
    <div><h2 class="footer-title">${e(t(lang, 'footer.help'))}</h2><ul>
      <li><a href="${url('contact', lang)}">${e(t(lang, 'nav.contact'))}</a></li>
      <li><a href="${url('contact', lang)}#faq">${e(t(lang, 'footer.faq'))}</a></li>
      <li><a href="${url('cart', lang)}">${e(t(lang, 'nav.cart'))}</a></li></ul></div>
    <div><h2 class="footer-title">${e(t(lang, 'footer.legal'))}</h2><ul>
      <li><a href="${url('legalNotice', lang)}">${e(t(lang, 'footer.legalNotice'))}</a></li>
      <li><a href="${url('terms', lang)}">${e(t(lang, 'footer.terms'))}</a></li>
      <li><a href="${url('privacy', lang)}">${e(t(lang, 'footer.privacy'))}</a></li></ul></div>
  </div>
  <div class="container footer-bottom">
    <span>© ${new Date().getFullYear()} ${e(s.legalName || s.storeName || 'ELYSÉA')}. ${e(t(lang, 'footer.rights'))}</span>
    <span>${e(t(lang, 'footer.renders'))}</span>
  </div>
</footer>`;
}

function cartDrawer(lang) {
  return `<div class="drawer" data-drawer hidden>
  <div class="drawer-backdrop" data-drawer-close></div>
  <aside class="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabindex="-1">
    <div class="drawer-head"><h2 id="drawer-title">${e(t(lang, 'cart.title'))}</h2><button class="icon-btn" type="button" data-drawer-close aria-label="${e(t(lang, 'common.close'))}">${icon('close')}</button></div>
    <div class="drawer-body" data-cart-lines></div>
    <div class="drawer-foot" data-cart-foot></div>
  </aside>
</div>
<div class="toast" data-toast role="status" aria-live="polite" hidden></div>`;
}

/** Dictionnaire minimal envoyé au JS client. */
function clientI18n(lang) {
  const keys = ['cart.empty', 'cart.emptyCta', 'cart.subtotal', 'cart.shipping', 'cart.shippingTbd', 'cart.free', 'cart.total', 'cart.checkout', 'cart.continue', 'cart.remove', 'cart.qty', 'cart.taxNote', 'cart.viewCart', 'cart.stockLimited', 'cart.discount',
    'product.added', 'product.inStock', 'product.lowStock', 'product.outOfStock', 'product.viewer.mirror', 'product.viewer.mirrorClose', 'product.viewer.pouf', 'product.viewer.poufIn', 'product.viewer.rotate', 'product.viewer.stop', 'product.viewer.fallback', 'product.zoom',
    'checkout.pay', 'checkout.payDemo', 'checkout.processing', 'checkout.noShipping', 'checkout.error', 'contact.form.success', 'contact.form.error', 'contact.form.sending', 'common.close'];
  return Object.fromEntries(keys.map((k) => [k, t(lang, k)]));
}

/* ------------------------------------------------------------------ */
/**
 * Page complète.
 * opts: { req, nonce, lang, page, title, description, body, jsonld[], noindex, image, bodyClass, transparentHeader, scripts[], altPaths }
 */
function page(opts) {
  const { req, nonce, lang, page: pg, title, description = t(opts.lang, 'meta.home.description'), body, jsonld = [], noindex = false, bodyClass = '', transparentHeader = false, scripts = [] } = opts;
  const o = origin(req);
  const canonicalPath = opts.canonical || (ROUTES[pg] ? url(pg, lang) : req.url.split('?')[0]);
  const ogImage = `${o}${opts.image || '/img/renders/hero-1400.jpg'}`;
  const alternates = ROUTES[pg] && !noindex
    ? LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${o}${url(pg, l)}">`).join('') + `<link rel="alternate" hreflang="x-default" href="${o}${url(pg, 'fr')}">`
    : '';
  const s = store.get('settings');
  const orgLd = { '@context': 'https://schema.org', '@type': 'Organization', name: s.storeName || 'ELYSÉA', url: o, logo: `${o}/img/logo.svg`, ...(s.contactEmail ? { email: s.contactEmail } : {}) };
  const site = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'ELYSÉA', url: o, inLanguage: lang };
  const ld = [orgLd, site, ...jsonld].map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${e(title)}</title>
<meta name="description" content="${e(description)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : '<meta name="robots" content="index, follow, max-image-preview:large">'}
<link rel="canonical" href="${o}${canonicalPath}">
${alternates}
<meta property="og:type" content="${pg === 'product' ? 'product' : 'website'}">
<meta property="og:site_name" content="ELYSÉA">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:url" content="${o}${canonicalPath}">
<meta property="og:image" content="${ogImage}">
<meta property="og:locale" content="${LOCALES[lang]}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#f3ede4">
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/site.webmanifest">
<link rel="preload" href="/fonts/cormorant-garamond-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
${opts.preload || ''}
<link rel="stylesheet" href="${asset('/css/site.css')}">
<script type="importmap" nonce="${nonce}">{"imports":{"three":"/vendor/three/build/three.module.min.js","three/addons/":"/vendor/three/examples/jsm/"}}</script>
${ld}
</head>
<body class="${bodyClass}" data-lang="${lang}">
${header(lang, pg, { transparent: transparentHeader })}
<main id="main" tabindex="-1">
${body}
</main>
${footer(lang)}
${cartDrawer(lang)}
<script nonce="${nonce}">window.ELYSEA=${JSON.stringify({ lang, routes: Object.fromEntries(Object.keys(ROUTES).map((k) => [k, url(k, lang)])), i18n: clientI18n(lang), currency: s.currency || 'EUR', intl: lang === 'fr' ? 'fr-FR' : 'en-GB' }).replace(/</g, '\\u003c')};</script>
<script type="module" src="${asset('/js/site.js')}"></script>
${scripts.map((sc) => `<script type="module" src="${asset(sc)}"></script>`).join('')}
</body>
</html>`;
}

module.exports = { page, picture, render, icon, priceBlock, reassurance, origin, asset };
