'use strict';
/**
 * Pages publiques (rendu serveur : HTML complet dès le premier octet, idéal SEO).
 */
const store = require('../store');
const { t, L, url, INTL } = require('../i18n');
const { escapeHtml: e } = require('../http');
const { formatMoney, variantPricing, allowedCountries, getOrder } = require('../commerce');
const { page, picture, render, icon, priceBlock, reassurance, origin } = require('./layout');

const tx = (lang) => (k, v) => e(t(lang, k, v));

function countryName(code, lang) {
  try { return new Intl.DisplayNames([INTL[lang]], { type: 'region' }).of(code); } catch (_) { return code; }
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */
function faqAnswer(item, lang) {
  const s = store.get('settings');
  if (item.policy === 'zones') {
    if (!s.shipping?.configured) return t(lang, 'faq.pending');
    return s.shipping.zones.map((z) => `${L(z.name, lang)} : ${z.countries.map((c) => countryName(c, lang)).join(', ')}`).join(' · ');
  }
  if (item.policy) {
    const v = L(s.policies?.[item.policy], lang);
    if (v) return v;
    if (item.policy === 'delivery' && s.shipping?.configured) {
      return s.shipping.zones.map((z) => `${L(z.name, lang)} — ${z.rate ? formatMoney(z.rate, lang) : t(lang, 'cart.free')}${z.freeOver ? ` (${t(lang, 'cart.free').toLowerCase()} ≥ ${formatMoney(z.freeOver, lang)})` : ''}${L(z.delay, lang) ? `, ${L(z.delay, lang)}` : ''}`).join(' · ');
    }
    return t(lang, 'faq.pending');
  }
  return L(item.a, lang) || t(lang, 'faq.pending');
}

function faqList(lang, items, { grouped = false } = {}) {
  const one = (f) => `<details class="faq-item"><summary><span>${e(L(f.q, lang))}</span>${icon('plus', 'faq-icon')}</summary><div class="faq-answer"><p>${e(faqAnswer(f, lang))}</p></div></details>`;
  if (!grouped) return `<div class="faq">${items.map(one).join('')}</div>`;
  const cats = [...new Set(items.map((f) => f.category))];
  return cats.map((c) => `<div class="faq-group"><h3 class="faq-cat">${e(t(lang, `faq.category.${c}`))}</h3><div class="faq">${items.filter((f) => f.category === c).map(one).join('')}</div></div>`).join('');
}

function faqJsonLd(lang, items) {
  return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items.map((f) => ({ '@type': 'Question', name: L(f.q, lang), acceptedAnswer: { '@type': 'Answer', text: faqAnswer(f, lang) } })) };
}

/* ------------------------------------------------------------------ */
/* Données structurées produit                                         */
/* ------------------------------------------------------------------ */
function productJsonLd(req, lang) {
  const p = store.get('product');
  const o = origin(req);
  const offers = p.variants.filter((v) => v.active !== false).map((v) => {
    const pr = variantPricing(p, v);
    return {
      '@type': 'Offer', sku: v.sku, price: (pr.price / 100).toFixed(2), priceCurrency: p.currency || 'EUR',
      availability: v.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `${o}${url('product', lang)}`, itemCondition: 'https://schema.org/NewCondition',
      ...(pr.promo && p.promotion.endsAt ? { priceValidUntil: String(p.promotion.endsAt).slice(0, 10) } : {})
    };
  });
  return {
    '@context': 'https://schema.org', '@type': 'Product',
    name: L(p.name, lang), sku: p.sku, brand: { '@type': 'Brand', name: 'ELYSÉA' },
    description: t(lang, 'product.description'),
    image: p.gallery.slice(0, 6).map((g) => `${o}${g.src}-${g.widths[g.widths.length - 1]}.jpg`),
    color: p.variants.map((v) => L(v.name, lang)).join(', '),
    material: [t(lang, 'product.materials.structureValue'), t(lang, 'product.materials.fabricValue'), t(lang, 'product.materials.paddingValue')].join(', '),
    width: { '@type': 'QuantitativeValue', value: p.dimensions.width, unitCode: 'CMT' },
    depth: { '@type': 'QuantitativeValue', value: p.dimensions.depth, unitCode: 'CMT' },
    height: { '@type': 'QuantitativeValue', value: p.dimensions.height, unitCode: 'CMT' },
    offers: offers.length === 1 ? offers[0] : { '@type': 'AggregateOffer', offers, lowPrice: Math.min(...offers.map((x) => +x.price)), highPrice: Math.max(...offers.map((x) => +x.price)), priceCurrency: p.currency || 'EUR' }
  };
}

function breadcrumb(req, lang, trail) {
  const o = origin(req);
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: trail.map(([name, pg], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${o}${url(pg, lang)}` })) };
}

/* ------------------------------------------------------------------ */
/* ACCUEIL                                                             */
/* ------------------------------------------------------------------ */
function home(ctx) {
  const { lang } = ctx; const T = tx(lang);
  const testimonials = store.get('testimonials').filter((x) => x.published !== false && L(x.text, lang));
  const heroSrc = (id, ws, fmt) => ws.map((w) => `/img/renders/${id}-${w}.${fmt} ${w}w`).join(', ');
  const hero = `<section class="hero" data-hero>
  <div class="hero-media" data-parallax="0.18">
    <picture>
      <source media="(max-width: 720px)" type="image/avif" srcset="${heroSrc('hero-portrait', [500, 750, 1000], 'avif')}" sizes="100vw">
      <source media="(max-width: 720px)" type="image/webp" srcset="${heroSrc('hero-portrait', [500, 750, 1000], 'webp')}" sizes="100vw">
      <source media="(max-width: 720px)" srcset="${heroSrc('hero-portrait', [500, 750, 1000], 'jpg')}" sizes="100vw">
      <source type="image/avif" srcset="${heroSrc('hero', [800, 1400, 2400], 'avif')}" sizes="100vw">
      <source type="image/webp" srcset="${heroSrc('hero', [800, 1400, 2400], 'webp')}" sizes="100vw">
      <img src="/img/renders/hero-1400.jpg" srcset="${heroSrc('hero', [800, 1400, 2400], 'jpg')}" sizes="100vw" width="2400" height="1350" alt="${e(lang === 'fr' ? 'Coiffeuse ELYSÉA miroir ouvert dans une chambre contemporaine aux boiseries claires' : 'ELYSÉA vanity with the mirror open in a contemporary bedroom with pale panelling')}" fetchpriority="high" decoding="async">
    </picture>
  </div>
  <div class="hero-veil"></div>
  <div class="hero-content container">
    <p class="eyebrow reveal">${T('home.hero.eyebrow')}</p>
    <h1 class="hero-title reveal" style="--d:.08s">${T('home.hero.title')}</h1>
    <p class="hero-slogan reveal" style="--d:.16s">${T('home.hero.slogan')}</p>
    <div class="hero-ctas reveal" style="--d:.24s">
      <a class="btn btn-light" href="${url('product', lang)}">${T('home.hero.ctaDiscover')}</a>
      <a class="btn btn-ghost-light" href="${url('product', lang)}#buy">${T('home.hero.ctaBuy')}</a>
    </div>
  </div>
  <a class="hero-scroll" href="#concept" aria-label="${T('home.hero.scroll')}"><span>${T('home.hero.scroll')}</span><i></i></a>
</section>`;

  const concept = `<section class="section concept" id="concept">
  <div class="container split">
    <div class="split-text">
      <p class="eyebrow reveal">${T('home.concept.eyebrow')}</p>
      <h2 class="display reveal">${T('home.concept.title')}</h2>
      <p class="lead reveal">${T('home.concept.text')}</p>
      <a class="link-arrow reveal" href="${url('design', lang)}">${T('home.concept.link')} ${icon('arrow')}</a>
    </div>
    <div class="split-media">
      <figure class="frame frame-tall reveal" data-parallax="-0.06">${render('studio-threequarter', lang, { sizes: '(max-width: 900px) 100vw, 45vw' })}</figure>
      <figure class="frame frame-float reveal" style="--d:.12s">${render('studio-open-all', lang, { sizes: '(max-width: 900px) 50vw, 20vw', alt: lang === 'fr' ? 'Miroir relevé et pouf sorti' : 'Mirror raised and stool out' })}</figure>
    </div>
  </div>
</section>`;

  const benefitIcons = ['mirror', 'drawer', 'seat', 'compact'];
  const benefits = `<section class="section benefits">
  <div class="container">
    <div class="section-head">
      <p class="eyebrow reveal">${T('home.benefits.eyebrow')}</p>
      <h2 class="display reveal">${T('home.benefits.title')}</h2>
    </div>
    <ol class="benefit-grid">${[1, 2, 3, 4].map((i) => `<li class="benefit reveal" style="--d:${(i - 1) * 0.08}s"><span class="benefit-icon">${icon(benefitIcons[i - 1])}</span><h3>${T(`home.benefits.${i}.title`)}</h3><p>${T(`home.benefits.${i}.text`)}</p></li>`).join('')}</ol>
  </div>
</section>`;

  const steps = [['step-open', 1], ['step-organize', 2], ['step-close', 3]];
  const how = `<section class="section how">
  <div class="container">
    <div class="section-head section-head-row">
      <div><p class="eyebrow reveal">${T('home.how.eyebrow')}</p><h2 class="display reveal">${T('home.how.title')}</h2></div>
      <div><p class="lead reveal">${T('home.how.text')}</p><a class="link-arrow reveal" href="${url('design', lang)}">${T('home.how.link')} ${icon('arrow')}</a></div>
    </div>
    <ol class="steps">${steps.map(([img, n], i) => `<li class="step reveal" style="--d:${i * 0.1}s">
      <figure class="frame">${render(img, lang, { sizes: '(max-width: 900px) 100vw, 33vw', alt: t(lang, `design.step${n}.title`) })}</figure>
      <div class="step-meta"><span class="step-num">${T(`design.step${n}.number`)}</span><span class="step-label">${T(`design.step${n}.label`)}</span></div>
      <h3>${T(`design.step${n}.title`)}</h3><p>${T(`design.step${n}.text`)}</p></li>`).join('')}</ol>
  </div>
</section>`;

  const materials = `<section class="section materials-teaser">
  <div class="container split split-reverse">
    <div class="split-media">
      <figure class="frame frame-square zoomable reveal" data-zoom>${render('macro-fabric', lang, { sizes: '(max-width: 900px) 100vw, 50vw' })}</figure>
    </div>
    <div class="split-text">
      <p class="eyebrow reveal">${T('home.materials.eyebrow')}</p>
      <h2 class="display reveal">${T('home.materials.title')}</h2>
      <p class="lead reveal">${T('home.materials.text')}</p>
      <ul class="spec-list reveal">
        <li><span>${T('product.materials.fabric')}</span><span>${T('product.materials.fabricValue')}</span></li>
        <li><span>${T('product.materials.structure')}</span><span>${T('product.materials.structureValue')}</span></li>
        <li><span>${T('product.materials.padding')}</span><span>${T('product.materials.paddingValue')}</span></li>
      </ul>
      <a class="link-arrow reveal" href="${url('materials', lang)}">${T('home.materials.link')} ${icon('arrow')}</a>
    </div>
  </div>
</section>`;

  const interiors = ['bedroom', 'suite', 'apartment', 'dressing', 'minimal'];
  const inspiration = `<section class="section inspiration-teaser">
  <div class="container section-head section-head-row">
    <div><p class="eyebrow reveal">${T('home.inspiration.eyebrow')}</p><h2 class="display reveal">${T('home.inspiration.title')}</h2></div>
    <a class="link-arrow reveal" href="${url('inspiration', lang)}">${T('home.inspiration.link')} ${icon('arrow')}</a>
  </div>
  <div class="rail" data-rail tabindex="0" aria-label="${T('home.inspiration.title')}">
    ${interiors.map((k) => `<a class="rail-card" href="${url('inspiration', lang)}#${k}"><figure class="frame frame-wide">${render(`interior-${k}`, lang, { sizes: '(max-width: 900px) 85vw, 60vw', alt: t(lang, `inspiration.${k}.title`) })}</figure><span class="rail-caption">${T(`inspiration.${k}.title`)}</span></a>`).join('')}
  </div>
</section>`;

  const testi = testimonials.length ? `<section class="section testimonials"><div class="container">
  <p class="eyebrow reveal">${T('home.testimonials.eyebrow')}</p>
  <div class="testimonial-grid">${testimonials.map((x) => `<figure class="testimonial reveal"><blockquote>${e(L(x.text, lang))}</blockquote><figcaption>${e(x.author || '')}${x.city ? ` · ${e(x.city)}` : ''}</figcaption></figure>`).join('')}</div>
</div></section>` : '';

  const cta = `<section class="section cta-final">
  <div class="container cta-grid">
    <figure class="frame frame-tall reveal">${render('studio-mirror', lang, { sizes: '(max-width: 900px) 100vw, 40vw' })}</figure>
    <div class="cta-text">
      <p class="eyebrow reveal">${T('home.cta.eyebrow')}</p>
      <h2 class="display reveal">${T('home.cta.title')}</h2>
      <p class="lead reveal">${T('home.cta.text')}</p>
      <div class="reveal">${priceBlock(lang, { size: 'price-lg' })}</div>
      <div class="cta-buttons reveal">
        <button class="btn btn-dark" type="button" data-quick-add>${T('home.cta.button')}</button>
        <a class="btn btn-outline" href="${url('product', lang)}#viewer">${icon('cube')} ${T('home.cta.view3d')}</a>
      </div>
    </div>
  </div>
  <div class="container">${reassurance(lang)}</div>
</section>`;

  return page({
    ...ctx, page: 'home', title: t(lang, 'meta.home.title'), description: t(lang, 'meta.home.description'),
    transparentHeader: true, bodyClass: 'page-home',
    preload: `<link rel="preload" as="image" type="image/avif" imagesrcset="${heroSrc('hero', [800, 1400, 2400], 'avif')}" imagesizes="100vw" media="(min-width: 721px)"><link rel="preload" as="image" type="image/avif" imagesrcset="${heroSrc('hero-portrait', [500, 750, 1000], 'avif')}" imagesizes="100vw" media="(max-width: 720px)">`,
    jsonld: [productJsonLd(ctx.req, lang)],
    body: hero + concept + benefits + how + materials + inspiration + testi + cta
  });
}

/* ------------------------------------------------------------------ */
/* PRODUIT                                                             */
/* ------------------------------------------------------------------ */
function product(ctx) {
  const { lang } = ctx; const T = tx(lang);
  const p = store.get('product');
  const s = store.get('settings');
  const variants = p.variants.filter((v) => v.active !== false);
  const v0 = variants[0];
  const pr = variantPricing(p, v0);
  const gallery = p.gallery;
  const faq = store.get('faq').slice(0, 5);

  const galleryHtml = `<div class="gallery" data-gallery>
  <div class="gallery-stage" data-gallery-stage>
    ${gallery.map((g, i) => `<figure class="gallery-slide${i === 0 ? ' is-active' : ''}" data-slide="${i}" ${i ? 'aria-hidden="true"' : ''}>
      <button class="gallery-zoom" type="button" data-lightbox="${i}" aria-label="${T('product.zoom')} — ${e(L(g.label, lang))}">${picture(g, lang, { sizes: '(max-width: 900px) 100vw, 58vw', eager: i === 0 })}</button>
    </figure>`).join('')}
    <button class="gallery-nav prev icon-btn" type="button" data-gallery-prev aria-label="${T('product.prev')}">${icon('arrowLeft')}</button>
    <button class="gallery-nav next icon-btn" type="button" data-gallery-next aria-label="${T('product.next')}">${icon('arrow')}</button>
    <span class="gallery-label" data-gallery-label>${e(L(gallery[0]?.label, lang))}</span>
    <a class="gallery-3d" href="#viewer">${icon('cube')} ${T('product.view3d')}</a>
  </div>
  <div class="gallery-thumbs" role="tablist" aria-label="${T('product.gallery')}">
    ${gallery.map((g, i) => `<button class="thumb${i === 0 ? ' is-active' : ''}" type="button" role="tab" aria-selected="${i === 0}" data-thumb="${i}" aria-label="${e(L(g.label, lang))}">${picture({ ...g, widths: [g.widths[0]] }, lang, { sizes: '96px', alt: '' })}</button>`).join('')}
  </div>
</div>`;

  const stockMsg = (v) => v.stock <= 0 ? `<span class="stock out">${T('product.outOfStock')}</span>`
    : s.showLowStock && v.stock <= s.lowStockThreshold ? `<span class="stock low">${T('product.lowStock', { n: v.stock })}</span>`
    : `<span class="stock in">${T('product.inStock')}</span>`;

  const variantData = variants.map((v) => { const x = variantPricing(p, v); return { id: v.id, stock: v.stock, price: x.price, compareAt: x.compareAt, image: v.image }; });

  const buybox = `<div class="buybox" id="buy">
  <nav class="crumbs" aria-label="Fil d'Ariane"><a href="${url('home', lang)}">${T('nav.home')}</a><span>/</span><span aria-current="page">${T('product.breadcrumb')}</span></nav>
  <p class="eyebrow">${T('product.eyebrow')}</p>
  <h1 class="product-title">${e(L(p.name, lang))}</h1>
  <p class="product-tagline">${e(L(p.tagline, lang))}</p>
  <div class="buy-price">${priceBlock(lang, { size: 'price-lg' })}<span class="tax-note">${T('product.taxIncluded')} · ${T('product.shippingCalculated')}</span></div>
  <form class="buy-form" data-buy-form data-variants='${e(JSON.stringify(variantData))}' data-low="${s.showLowStock ? s.lowStockThreshold : -1}">
    <fieldset class="variant-picker">
      <legend>${T('product.variant')} <span data-variant-name>${e(L(v0.name, lang))}</span></legend>
      <div class="swatches">${variants.map((v, i) => `<label class="swatch" title="${e(L(v.name, lang))}"><input type="radio" name="variant" value="${e(v.id)}" data-name="${e(L(v.name, lang))}" ${i === 0 ? 'checked' : ''}><span style="--a:${e(v.swatch?.[0] || '#ccc')};--b:${e(v.swatch?.[1] || v.swatch?.[0] || '#999')}"></span><span class="sr-only">${e(L(v.name, lang))}</span></label>`).join('')}</div>
    </fieldset>
    <div class="buy-row">
      <div class="qty" data-qty><button type="button" class="icon-btn" data-qty-dec aria-label="−">${icon('minus')}</button><input type="number" name="qty" value="1" min="1" max="${Math.max(1, Math.min(10, v0.stock))}" inputmode="numeric" aria-label="${T('product.quantity')}"><button type="button" class="icon-btn" data-qty-inc aria-label="+">${icon('plus')}</button></div>
      <button class="btn btn-dark btn-block" type="submit" data-add ${v0.stock <= 0 ? 'disabled' : ''}>${T('product.addToCart')}</button>
    </div>
    <p class="stock-line" data-stock>${stockMsg(v0)}</p>
    ${v0.stock <= 0 ? `<a class="link-arrow" href="${url('contact', lang)}">${T('product.notifyMe')} ${icon('arrow')}</a>` : ''}
  </form>
  ${reassurance(lang, 'reassurance-compact')}
  <div class="accordions">
    <details open><summary>${T('product.acc.description')}${icon('plus', 'faq-icon')}</summary><div><p>${T('product.description')}</p></div></details>
    <details><summary>${T('product.acc.specs')}${icon('plus', 'faq-icon')}</summary><div>
      <ul class="spec-list">
        <li><span>${T('product.dimensions')}</span><span>${T('product.dimensionsValue', { w: p.dimensions.width, d: p.dimensions.depth, h: p.dimensions.height })}</span></li>
        <li><span>${T('product.specs.diameter')}</span><span>${p.dimensions.width} cm</span></li>
        <li><span>${T('product.specs.height')}</span><span>${p.dimensions.height} cm</span></li>
        <li><span>${T('product.specs.parcels')}</span><span>${T('product.specs.parcelsValue')}</span></li>
        <li><span>${T('product.specs.volume')}</span><span>${e(L(p.logistics.volume, lang))}</span></li>
        <li><span>${T('product.specs.weight')}</span><span>${e(L(p.logistics.grossWeight, lang))}</span></li>
      </ul><p class="fineprint">${T('product.specs.source')}</p></div></details>
    <details><summary>${T('product.acc.materials')}${icon('plus', 'faq-icon')}</summary><div>
      <ul class="spec-list">
        ${['structure', 'padding', 'fabric', 'mirror'].map((k) => `<li><span>${T(`product.materials.${k}`)}</span><span>${T(`product.materials.${k}Value`)}</span></li>`).join('')}
      </ul><p class="fineprint">${T('materials.note')}</p></div></details>
    <details><summary>${T('product.acc.delivery')}${icon('plus', 'faq-icon')}</summary><div>
      <p>${e(faqAnswer({ policy: 'delivery' }, lang))}</p><p>${e(faqAnswer({ policy: 'returns' }, lang))}</p></div></details>
    <details><summary>${T('product.acc.care')}${icon('plus', 'faq-icon')}</summary><div><p>${e(faqAnswer({ policy: 'care' }, lang))}</p></div></details>
  </div>
</div>`;

  const viewer = `<section class="section viewer-section" id="viewer">
  <div class="container section-head section-head-row">
    <div><p class="eyebrow reveal">${T('product.viewer.eyebrow')}</p><h2 class="display reveal">${T('product.viewer.title')}</h2></div>
    <p class="lead reveal">${T('product.viewer.text')}</p>
  </div>
  <div class="container">
    <div class="viewer" data-viewer data-model="${e(p.model3d || '')}">
      <div class="viewer-poster">${render('studio-threequarter', lang, { sizes: '(max-width: 900px) 100vw, 80vw', alt: '' })}</div>
      <canvas class="viewer-canvas" aria-label="${e(L(p.name, lang))} — 3D"></canvas>
      <div class="viewer-loading" data-viewer-loading hidden><span class="spinner"></span>${T('product.viewer.loading')}</div>
      <button class="btn btn-light viewer-start" type="button" data-viewer-start>${icon('cube')} ${T('product.viewer.load')}</button>
      <div class="viewer-controls glass" role="toolbar" aria-label="3D">
        <button type="button" class="chip" data-act="mirror" aria-pressed="false">${icon('mirror')}<span>${T('product.viewer.mirror')}</span></button>
        <button type="button" class="chip" data-act="pouf" aria-pressed="false">${icon('seat')}<span>${T('product.viewer.pouf')}</span></button>
        <button type="button" class="chip" data-act="rotate" aria-pressed="false">${icon('rotate')}<span>${T('product.viewer.rotate')}</span></button>
        <button type="button" class="chip" data-act="fabric" aria-pressed="false">${icon('zoom')}<span>${T('product.viewer.fabric')}</span></button>
        <button type="button" class="chip chip-icon" data-act="reset" aria-label="${T('product.viewer.reset')}">${icon('reset')}</button>
      </div>
      <p class="viewer-hint">${T('product.viewer.hint')}</p>
      <p class="viewer-fallback" data-viewer-fallback hidden>${T('product.viewer.fallback')}</p>
    </div>
    <p class="fineprint center">${T('product.viewer.disclaimer')}</p>
  </div>
</section>`;

  const featImgs = ['studio-mirror', 'studio-storage', 'studio-pouf-out', 'studio-top', 'macro-fabric'];
  const features = `<section class="section features">
  <div class="container section-head"><p class="eyebrow reveal">${T('product.features.eyebrow')}</p><h2 class="display reveal">${T('product.features.title')}</h2></div>
  <div class="container feature-list">${[1, 2, 3, 4, 5].map((i) => `<article class="feature${i % 2 === 0 ? ' feature-reverse' : ''}">
    <figure class="frame ${featImgs[i - 1].startsWith('macro') || featImgs[i - 1] === 'studio-top' ? 'frame-square' : 'frame-tall'} reveal">${render(featImgs[i - 1], lang, { sizes: '(max-width: 900px) 100vw, 45vw' })}</figure>
    <div class="feature-text"><span class="feature-num reveal">0${i}</span><h3 class="title reveal">${T(`product.features.${i}.title`)}</h3><p class="lead reveal">${T(`product.features.${i}.text`)}</p></div>
  </article>`).join('')}</div>
</section>`;

  const faqHtml = `<section class="section product-faq"><div class="container narrow">
  <h2 class="display center reveal">${T('product.faq.title')}</h2>
  ${faqList(lang, faq)}
  <p class="center"><a class="link-arrow" href="${url('contact', lang)}#faq">${T('product.faq.more')} ${icon('arrow')}</a></p>
</div></section>`;

  const sticky = `<div class="sticky-buy" data-sticky-buy hidden>
  <div class="sticky-info"><strong>${e(L(p.name, lang))}</strong><span data-sticky-price>${formatMoney(pr.price, lang)}</span></div>
  <button class="btn btn-dark" type="button" data-sticky-add ${v0.stock <= 0 ? 'disabled' : ''}>${T('product.sticky.buy')}</button>
</div>
<div class="lightbox" data-lightbox-root hidden role="dialog" aria-modal="true" aria-label="${T('product.gallery')}">
  <button class="icon-btn lightbox-close" type="button" data-lightbox-close aria-label="${T('common.close')}">${icon('close')}</button>
  <button class="icon-btn lightbox-prev" type="button" data-lightbox-prev aria-label="${T('product.prev')}">${icon('arrowLeft')}</button>
  <div class="lightbox-stage" data-lightbox-stage></div>
  <button class="icon-btn lightbox-next" type="button" data-lightbox-next aria-label="${T('product.next')}">${icon('arrow')}</button>
</div>`;

  return page({
    ...ctx, page: 'product', title: t(lang, 'meta.product.title'), description: t(lang, 'meta.product.description'),
    bodyClass: 'page-product', image: `${gallery[0]?.src}-1000.jpg`,
    jsonld: [productJsonLd(ctx.req, lang), breadcrumb(ctx.req, lang, [[t(lang, 'nav.home'), 'home'], [L(p.name, lang), 'product']]), faqJsonLd(lang, faq)],
    scripts: ['/js/product.js'],
    body: `<section class="product-hero"><div class="container product-grid">${galleryHtml}${buybox}</div></section>${viewer}${features}${faqHtml}${sticky}`
  });
}

/* ------------------------------------------------------------------ */
/* CONCEPTION                                                          */
/* ------------------------------------------------------------------ */
function design(ctx) {
  const { lang } = ctx; const T = tx(lang);
  const p = store.get('product');
  const steps = [1, 2, 3];
  const stepImgs = ['step-open', 'step-organize', 'step-close'];
  const body = `<section class="page-hero page-hero-center">
  <div class="container narrow">
    <p class="eyebrow reveal">${T('design.hero.eyebrow')}</p>
    <h1 class="display-xl reveal">${T('design.hero.title')}</h1>
    <p class="lead reveal">${T('design.hero.text')}</p>
  </div>
</section>
<section class="scrolly" data-scrolly>
  <div class="scrolly-sticky">
    <div class="scrolly-stage">
      <canvas class="scrolly-canvas" data-scrolly-canvas aria-hidden="true"></canvas>
      <div class="scrolly-fallback">${stepImgs.map((img, i) => `<div class="scrolly-img${i === 0 ? ' is-active' : ''}" data-step-img="${i}">${render(img, lang, { sizes: '(max-width: 900px) 100vw, 55vw', alt: t(lang, `design.step${i + 1}.title`) })}</div>`).join('')}</div>
      <div class="scrolly-progress" aria-hidden="true">${steps.map((n) => `<span data-dot="${n - 1}">${T(`design.step${n}.number`)}</span>`).join('')}</div>
    </div>
  </div>
  <div class="scrolly-steps">${steps.map((n) => `<article class="scrolly-step" data-step="${n - 1}">
    <div class="glass step-card">
      <div class="step-meta"><span class="step-num">${T(`design.step${n}.number`)}</span><span class="step-label">${T(`design.step${n}.label`)}</span></div>
      <h2 class="title">${T(`design.step${n}.title`)}</h2>
      <p>${T(`design.step${n}.text`)}</p>
    </div>
  </article>`).join('')}</div>
</section>
<section class="section footprint">
  <div class="container split">
    <div class="split-text">
      <p class="eyebrow reveal">${T('design.footprint.eyebrow')}</p>
      <h2 class="display reveal">${T('design.footprint.title')}</h2>
      <p class="lead reveal">${T('design.footprint.text')}</p>
      <ul class="spec-list reveal">
        <li><span>${T('product.specs.diameter')}</span><span>${p.dimensions.width} cm</span></li>
        <li><span>${T('product.specs.height')}</span><span>${p.dimensions.height} cm</span></li>
      </ul>
      <a class="btn btn-dark reveal" href="${url('product', lang)}">${T('design.cta')}</a>
    </div>
    <figure class="footprint-diagram reveal" aria-label="${T('design.footprint.title')}">
      <svg viewBox="0 0 400 420" role="img"><title>${T('design.footprint.title')}</title>
        <defs><pattern id="stripes" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="var(--sand)"/><rect width="3.6" height="10" fill="var(--coffee)"/></pattern></defs>
        <circle cx="200" cy="170" r="130" fill="url(#stripes)" opacity=".9"/>
        <circle cx="200" cy="170" r="130" fill="none" stroke="var(--ink)" stroke-width="1"/>
        <path d="M70 170 A130 130 0 0 0 330 170 Z" fill="none" stroke="var(--ink)" stroke-dasharray="4 5" transform="translate(0 115)" opacity=".55"/>
        <line x1="70" y1="20" x2="330" y2="20" stroke="var(--ink)"/><line x1="70" y1="14" x2="70" y2="26" stroke="var(--ink)"/><line x1="330" y1="14" x2="330" y2="26" stroke="var(--ink)"/>
        <text x="200" y="12" text-anchor="middle" class="svg-label">${p.dimensions.width} cm</text>
        <text x="200" y="400" text-anchor="middle" class="svg-label svg-muted">${lang === 'fr' ? 'pouf sorti' : 'stool out'}</text>
      </svg>
    </figure>
  </div>
</section>`;
  return page({ ...ctx, page: 'design', title: t(lang, 'meta.design.title'), description: t(lang, 'meta.design.description'), bodyClass: 'page-design', image: '/img/renders/step-open-1000.jpg', scripts: ['/js/design.js'], body });
}

/* ------------------------------------------------------------------ */
/* MATIÈRES                                                            */
/* ------------------------------------------------------------------ */
function materials(ctx) {
  const { lang } = ctx; const T = tx(lang);
  const items = [['fabric', 'macro-fabric'], ['wood', 'macro-wood'], ['padding', 'macro-seat'], ['mirror', 'macro-mirror'], ['hinge', 'macro-hinge']];
  const body = `<section class="page-hero page-hero-split">
  <div class="container split">
    <div class="split-text"><p class="eyebrow reveal">${T('materials.hero.eyebrow')}</p><h1 class="display-xl reveal">${T('materials.hero.title')}</h1><p class="lead reveal">${T('materials.hero.text')}</p></div>
    <figure class="frame frame-square reveal zoomable" data-zoom>${render('macro-fabric', lang, { sizes: '(max-width: 900px) 100vw, 50vw', eager: true })}</figure>
  </div>
</section>
<section class="section material-list"><div class="container">
  ${items.map(([k, img], i) => `<article class="material${i % 2 ? ' material-reverse' : ''}" id="${k}">
    <figure class="frame frame-square zoomable reveal" data-zoom>${render(img, lang, { sizes: '(max-width: 900px) 100vw, 50vw', alt: t(lang, `materials.${k}.title`) })}<figcaption class="zoom-hint">${icon('zoom')} ${T('materials.zoomHint')}</figcaption></figure>
    <div class="material-text"><span class="feature-num reveal">0${i + 1}</span><h2 class="title reveal">${T(`materials.${k}.title`)}</h2><p class="lead reveal">${T(`materials.${k}.text`)}</p></div>
  </article>`).join('')}
  <p class="fineprint center">${T('materials.note')}</p>
</div></section>
<section class="section cta-band"><div class="container center">
  <h2 class="display reveal">${T('home.cta.title')}</h2>
  <div class="reveal">${priceBlock(lang, { size: 'price-lg center' })}</div>
  <a class="btn btn-dark reveal" href="${url('product', lang)}">${T('design.cta')}</a>
</div></section>`;
  return page({ ...ctx, page: 'materials', title: t(lang, 'meta.materials.title'), description: t(lang, 'meta.materials.description'), bodyClass: 'page-materials', image: '/img/renders/macro-fabric-1000.jpg', body });
}

/* ------------------------------------------------------------------ */
/* INSPIRATION                                                         */
/* ------------------------------------------------------------------ */
function inspiration(ctx) {
  const { lang } = ctx; const T = tx(lang);
  const items = ['bedroom', 'suite', 'apartment', 'dressing', 'minimal'];
  const body = `<section class="page-hero page-hero-center"><div class="container narrow">
  <p class="eyebrow reveal">${T('inspiration.hero.eyebrow')}</p><h1 class="display-xl reveal">${T('inspiration.hero.title')}</h1><p class="lead reveal">${T('inspiration.hero.text')}</p>
</div></section>
<section class="inspo-list">
  ${items.map((k, i) => `<article class="inspo" id="${k}">
    <figure class="inspo-media" data-parallax="0.08">${render(`interior-${k}`, lang, { sizes: '100vw', eager: i === 0, alt: t(lang, `inspiration.${k}.title`) })}</figure>
    <div class="container"><div class="inspo-card glass reveal"><span class="feature-num">0${i + 1}</span><h2 class="title">${T(`inspiration.${k}.title`)}</h2><p>${T(`inspiration.${k}.text`)}</p></div></div>
  </article>`).join('')}
</section>
<section class="section cta-band"><div class="container center">
  <h2 class="display reveal">${T('inspiration.cta')}</h2>
  <div class="reveal">${priceBlock(lang, { size: 'price-lg center' })}</div>
  <a class="btn btn-dark reveal" href="${url('product', lang)}">${T('design.cta')}</a>
  <p class="fineprint">${T('inspiration.note')}</p>
</div></section>`;
  return page({ ...ctx, page: 'inspiration', title: t(lang, 'meta.inspiration.title'), description: t(lang, 'meta.inspiration.description'), bodyClass: 'page-inspiration', image: '/img/renders/interior-suite-1400.jpg', body });
}

/* ------------------------------------------------------------------ */
/* CONTACT & FAQ                                                       */
/* ------------------------------------------------------------------ */
function contact(ctx) {
  const { lang } = ctx; const T = tx(lang);
  const s = store.get('settings');
  const faq = store.get('faq');
  const subjects = ['product', 'order', 'delivery', 'after', 'pro', 'other'];
  const info = [s.contactEmail && [T('contact.info.email'), `<a href="mailto:${e(s.contactEmail)}">${e(s.contactEmail)}</a>`], s.phone && [T('contact.info.phone'), `<a href="tel:${e(s.phone.replace(/\s/g, ''))}">${e(s.phone)}</a>`], s.address && [T('contact.info.address'), e(s.address).replace(/\n/g, '<br>')]].filter(Boolean);
  const body = `<section class="page-hero page-hero-center"><div class="container narrow">
  <p class="eyebrow reveal">${T('contact.hero.eyebrow')}</p><h1 class="display-xl reveal">${T('contact.hero.title')}</h1><p class="lead reveal">${T('contact.hero.text')}</p>
</div></section>
<section class="section contact-section"><div class="container contact-grid">
  <form class="form card" data-contact-form novalidate>
    <h2 class="title">${T('contact.form.title')}</h2>
    <div class="field-row">
      <label class="field"><span>${T('contact.form.name')}</span><input name="name" autocomplete="name" required maxlength="120"></label>
      <label class="field"><span>${T('contact.form.email')}</span><input name="email" type="email" autocomplete="email" required maxlength="160"></label>
    </div>
    <div class="field-row">
      <label class="field"><span>${T('contact.form.subject')}</span><select name="subject">${subjects.map((k) => `<option value="${k}">${T(`contact.form.subject.${k}`)}</option>`).join('')}</select></label>
      <label class="field"><span>${T('contact.form.order')}</span><input name="order" maxlength="40"></label>
    </div>
    <label class="field"><span>${T('contact.form.message')}</span><textarea name="message" rows="6" required maxlength="4000"></textarea></label>
    <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
    <label class="check"><input type="checkbox" name="consent" required><span>${T('contact.form.consent')}</span></label>
    <button class="btn btn-dark" type="submit">${T('contact.form.submit')}</button>
    <p class="form-status" data-form-status role="status" aria-live="polite"></p>
  </form>
  <aside class="contact-aside">
    <div class="card">
      <h2 class="title-sm">${T('contact.info.title')}</h2>
      ${info.length ? `<dl class="info-list">${info.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : `<p class="muted">${T('contact.info.pending')}</p>`}
    </div>
    <div class="card">
      <h2 class="title-sm">${T('contact.dimensions.title')}</h2>
      <dl class="info-list">
        <div><dt>${T('contact.dimensions.closed')}</dt><dd>${T('contact.dimensions.closedValue')}</dd></div>
        <div><dt>${T('contact.dimensions.parcel')}</dt><dd>${T('contact.dimensions.parcelValue')}</dd></div>
      </dl>
      <p class="fineprint">${T('contact.dimensions.tip')}</p>
    </div>
    <figure class="frame frame-tall">${render('studio-front', lang, { sizes: '(max-width: 900px) 100vw, 30vw' })}</figure>
  </aside>
</div></section>
<section class="section faq-section" id="faq"><div class="container narrow">
  <h2 class="display center reveal">${T('faq.title')}</h2>
  ${faqList(lang, faq, { grouped: true })}
</div></section>`;
  return page({ ...ctx, page: 'contact', title: t(lang, 'meta.contact.title'), description: t(lang, 'meta.contact.description'), bodyClass: 'page-contact', jsonld: [faqJsonLd(lang, faq)], scripts: ['/js/contact.js'], body });
}

/* ------------------------------------------------------------------ */
/* PANIER / COMMANDE / CONFIRMATION                                    */
/* ------------------------------------------------------------------ */
function cart(ctx) {
  const { lang } = ctx; const T = tx(lang);
  const body = `<section class="section page-top"><div class="container">
  <h1 class="display">${T('cart.title')}</h1>
  <div class="cart-page" data-cart-page><p class="muted">${T('common.loading')}</p></div>
</div></section>`;
  return page({ ...ctx, page: 'cart', title: t(lang, 'meta.cart.title'), noindex: true, bodyClass: 'page-cart', body });
}

function checkout(ctx) {
  const { lang } = ctx; const T = tx(lang);
  const mode = require('../payments').paymentMode();
  const payable = mode !== 'none';
  const countries = allowedCountries().map((c) => [c, countryName(c, lang)]).sort((a, b) => a[1].localeCompare(b[1]));
  const f = (name, label, attrs = '') => `<label class="field"><span>${T(label)}</span><input name="${name}" ${attrs}></label>`;
  const body = `<section class="section page-top"><div class="container checkout-grid">
  <form class="form checkout-form" data-checkout-form data-mode="${mode}" novalidate>
    <a class="link-back" href="${url('cart', lang)}">${icon('arrowLeft')} ${T('checkout.back')}</a>
    <h1 class="display">${T('checkout.title')}</h1>
    ${!payable ? `<p class="notice notice-warn">${T('checkout.unavailable')}</p>` : ''}
    ${mode === 'demo' ? `<p class="notice">${T('checkout.demoNotice')}</p>` : ''}
    <fieldset><legend class="title-sm">${T('checkout.contact')}</legend>
      <div class="field-row">${f('email', 'checkout.email', 'type="email" autocomplete="email" required')}${f('phone', 'checkout.phone', 'type="tel" autocomplete="tel" required')}</div>
    </fieldset>
    <fieldset><legend class="title-sm">${T('checkout.shippingAddress')}</legend>
      <div class="field-row">${f('firstName', 'checkout.firstName', 'autocomplete="given-name" required')}${f('lastName', 'checkout.lastName', 'autocomplete="family-name" required')}</div>
      ${f('line1', 'checkout.address1', 'autocomplete="address-line1" required')}
      ${f('line2', 'checkout.address2', 'autocomplete="address-line2"')}
      <div class="field-row field-row-3">${f('postalCode', 'checkout.postalCode', 'autocomplete="postal-code" required')}${f('city', 'checkout.city', 'autocomplete="address-level2" required')}
        <label class="field"><span>${T('checkout.country')}</span><select name="country" autocomplete="country" required>${countries.map(([c, n]) => `<option value="${c}"${c === 'FR' ? ' selected' : ''}>${e(n)}</option>`).join('')}</select></label></div>
      <label class="field"><span>${T('checkout.notes')}</span><textarea name="notes" rows="2" maxlength="500"></textarea></label>
    </fieldset>
    <label class="check"><input type="checkbox" name="acceptTerms" required><span>${T('checkout.acceptTerms')} <a href="${url('terms', lang)}" target="_blank" rel="noopener">${T('footer.terms')}</a></span></label>
    <button class="btn btn-dark btn-block btn-pay" type="submit" data-pay ${payable ? '' : 'disabled'}>${T('checkout.processing')}</button>
    <p class="secure-note">${icon('lock')} ${mode === 'stripe' ? T('checkout.secure') : mode === 'demo' ? T('checkout.demoNotice') : T('checkout.unavailable')}</p>
    <p class="form-status" data-form-status role="alert"></p>
  </form>
  <aside class="checkout-summary card" data-checkout-summary aria-label="${T('checkout.summary')}">
    <h2 class="title-sm">${T('checkout.summary')}</h2>
    <div data-summary-lines><p class="muted">${T('common.loading')}</p></div>
  </aside>
</div></section>`;
  return page({ ...ctx, page: 'checkout', title: t(lang, 'meta.checkout.title'), noindex: true, bodyClass: 'page-checkout', scripts: ['/js/checkout.js'], body });
}

function confirmation(ctx, order) {
  const { lang } = ctx; const T = tx(lang);
  let inner;
  if (!order) inner = `<h1 class="display">${T('confirmation.notFound')}</h1><a class="btn btn-dark" href="${url('home', lang)}">${T('confirmation.back')}</a>`;
  else {
    const paid = order.payment.status === 'paid';
    const failed = order.status === 'payment_failed' || order.status === 'cancelled';
    inner = `<span class="confirm-icon ${paid ? 'ok' : ''}">${icon(paid ? 'check' : 'lock')}</span>
<h1 class="display">${T('confirmation.title')}</h1>
<p class="lead" data-confirm-status data-paid="${paid}" data-order="${e(order.id)}" data-token="${e(order.token)}">${T(paid ? 'confirmation.paid' : failed ? 'confirmation.failed' : 'confirmation.pending')}</p>
<div class="card confirm-card">
  <p class="eyebrow">${T('confirmation.order')} ${e(order.id)}</p>
  <ul class="summary-lines">${order.items.map((i) => `<li><span>${e(i.name)} <small>${e(i.variantName)} × ${i.qty}</small></span><span>${formatMoney(i.total, lang, order.currency)}</span></li>`).join('')}</ul>
  <ul class="summary-totals">
    <li><span>${T('cart.subtotal')}</span><span>${formatMoney(order.subtotal, lang, order.currency)}</span></li>
    <li><span>${T('cart.shipping')}</span><span>${order.shipping ? formatMoney(order.shipping, lang, order.currency) : T('cart.free')}</span></li>
    <li class="total"><span>${T('cart.total')}</span><span>${formatMoney(order.total, lang, order.currency)}</span></li>
  </ul>
</div>
${paid ? `<h2 class="title-sm">${T('confirmation.next')}</h2><p>${T('confirmation.nextText')}</p>` : ''}
<a class="btn btn-outline" href="${url('home', lang)}">${T('confirmation.back')}</a>`;
  }
  return page({ ...ctx, page: 'confirmation', title: t(lang, 'meta.confirmation.title'), noindex: true, bodyClass: 'page-confirmation', scripts: ['/js/confirmation.js'], body: `<section class="section page-top"><div class="container narrow center confirm">${inner}</div></section>` });
}

/* ------------------------------------------------------------------ */
function legal(ctx, kind) {
  const { lang } = ctx; const T = tx(lang);
  const s = store.get('settings');
  const content = L(s.legal?.[kind], lang);
  const paras = content ? content.split(/\n{2,}/).map((p) => `<p>${e(p).replace(/\n/g, '<br>')}</p>`).join('') : `<p class="muted">${T('legal.pending')}</p><p><a class="link-arrow" href="${url('contact', lang)}">${T('nav.contact')} ${icon('arrow')}</a></p>`;
  return page({ ...ctx, page: kind, title: `${t(lang, `legal.${kind}`)} | ELYSÉA`, description: t(lang, `legal.${kind}`), noindex: !content, bodyClass: 'page-legal', body: `<section class="section page-top"><div class="container narrow prose"><h1 class="display">${T(`legal.${kind}`)}</h1>${paras}</div></section>` });
}

function notFound(ctx) {
  const { lang } = ctx; const T = tx(lang);
  return page({ ...ctx, page: 'notfound', title: `${t(lang, 'notFound.title')} | ELYSÉA`, noindex: true, body: `<section class="section page-top"><div class="container narrow center"><p class="eyebrow">404</p><h1 class="display">${T('notFound.title')}</h1><p class="lead">${T('notFound.text')}</p><a class="btn btn-dark" href="${url('home', lang)}">${T('notFound.cta')}</a></div></section>` });
}

module.exports = { home, product, design, materials, inspiration, contact, cart, checkout, confirmation, legal, notFound, faqAnswer, getOrder };
