/**
 * ELYSÉA — administration (application monopage, sans dépendance).
 */
const app = document.getElementById('app');
const LANGS = JSON.parse(app.dataset.langs || '["fr","en"]');

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (c) => (c == null ? '' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(c / 100));
const toCents = (v) => (v === '' || v == null ? null : Math.round(parseFloat(String(v).replace(',', '.')) * 100));
const fromCents = (c) => (c == null ? '' : (c / 100).toFixed(2).replace(/\.00$/, ''));
const date = (s) => (s ? new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const clone = (o) => JSON.parse(JSON.stringify(o));
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

async function api(method, path, body, raw) {
  const opt = { method, headers: { 'X-Requested-With': 'elysea-admin' }, credentials: 'same-origin' };
  if (raw) { opt.body = raw.body; opt.headers['Content-Type'] = raw.type; }
  else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(`/admin/api/${path}`, opt);
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== 'login') { renderLogin(); throw new Error('Session expirée'); }
  if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
  return data;
}

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `a-toast ${kind}`; el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 3200);
}

const STATUS = {
  pending_payment: ['En attente de paiement', 'muted'], paid: ['Payée', 'ok'], preparing: ['En préparation', 'info'],
  shipped: ['Expédiée', 'info'], delivered: ['Livrée', 'ok'], cancelled: ['Annulée', 'muted'], refunded: ['Remboursée', 'muted'], payment_failed: ['Paiement échoué', 'warn']
};
const badge = (s) => `<span class="pill ${STATUS[s]?.[1] || ''}">${esc(STATUS[s]?.[0] || s)}</span>`;

/** Champ localisé : un input/textarea par langue. */
function locField(name, label, value = {}, { area = false, rows = 3, hint = '' } = {}) {
  return `<div class="a-field loc"><span class="a-label">${esc(label)}</span>${hint ? `<small class="hint">${esc(hint)}</small>` : ''}
    <div class="loc-grid">${LANGS.map((l) => `<label><span class="lang-tag">${l.toUpperCase()}</span>${area ? `<textarea name="${name}.${l}" rows="${rows}">${esc(value?.[l] || '')}</textarea>` : `<input name="${name}.${l}" value="${esc(value?.[l] || '')}">`}</label>`).join('')}</div></div>`;
}
const field = (name, label, value = '', type = 'text', attrs = '') => `<label class="a-field"><span class="a-label">${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value ?? '')}" ${attrs}></label>`;
const check = (name, label, on) => `<label class="a-check"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span>${esc(label)}</span></label>`;
const readLoc = (form, name) => Object.fromEntries(LANGS.map((l) => [l, form.elements[`${name}.${l}`]?.value || '']));

/* ------------------------------------------------------------------ */
/* Connexion                                                           */
/* ------------------------------------------------------------------ */
async function renderLogin() {
  const me = await fetch('/admin/api/me').then((r) => r.json()).catch(() => ({}));
  app.innerHTML = `<div class="login"><form class="login-card" id="login">
    <div class="brand">ELYSÉA</div><p class="sub">Administration</p>
    <label class="a-field"><span class="a-label">Mot de passe</span><input type="password" name="password" autocomplete="current-password" required autofocus></label>
    <button class="a-btn primary" type="submit">Se connecter</button>
    <p class="err" id="login-err" role="alert"></p>
    ${me.defaultPassword ? '<p class="hint">Développement : mot de passe par défaut « elysea-admin ». Définissez ADMIN_PASSWORD en production.</p>' : ''}
  </form></div>`;
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', 'login', { password: e.target.password.value }); route(); }
    catch (err) { $('#login-err').textContent = err.message; }
  });
}

/* ------------------------------------------------------------------ */
/* Coquille                                                            */
/* ------------------------------------------------------------------ */
const NAV = [
  ['dashboard', 'Tableau de bord'], ['orders', 'Commandes'], ['product', 'Produit & stock'], ['gallery', 'Photos & 3D'],
  ['shipping', 'Livraison'], ['texts', 'Textes du site'], ['faq', 'FAQ'], ['testimonials', 'Témoignages'],
  ['messages', 'Messages'], ['emails', 'E-mails envoyés'], ['settings', 'Paramètres']
];
function shell(active, content) {
  app.innerHTML = `<div class="a-shell">
    <aside class="a-side"><div class="brand">ELYSÉA</div><p class="sub">Administration</p>
      <nav>${NAV.map(([k, l]) => `<a href="#${k}" class="${active === k ? 'active' : ''}">${esc(l)}</a>`).join('')}</nav>
      <div class="side-foot"><a href="/" target="_blank" rel="noopener">Voir la boutique ↗</a><button type="button" id="logout">Se déconnecter</button></div>
    </aside>
    <main class="a-main" id="main">${content}</main></div>`;
  $('#logout').onclick = async () => { await api('POST', 'logout', {}); renderLogin(); };
}
const head = (title, actions = '') => `<header class="a-head"><h1>${esc(title)}</h1><div class="a-actions">${actions}</div></header>`;

/* ------------------------------------------------------------------ */
/* Tableau de bord                                                     */
/* ------------------------------------------------------------------ */
async function viewDashboard() {
  const d = await api('GET', 'dashboard');
  shell('dashboard', `${head('Tableau de bord')}
  <section class="kpis">
    <div class="kpi"><span>Chiffre d'affaires 30 j</span><strong>${eur(d.revenue30)}</strong></div>
    <div class="kpi"><span>Commandes à expédier</span><strong>${d.toShip}</strong></div>
    <div class="kpi"><span>Commandes (total)</span><strong>${d.orders}</strong></div>
    <div class="kpi"><span>Messages non lus</span><strong>${d.unreadMessages}</strong></div>
  </section>
  <div class="cols">
    <section class="card"><h2>À vérifier avant l'ouverture</h2>
      ${d.warnings.length ? `<ul class="warns">${d.warnings.map((w) => `<li class="${w.level}">${esc(w.text)}</li>`).join('')}</ul>` : '<p class="muted">Tout est prêt.</p>'}
      <p class="muted small">Paiement : <strong>${esc(d.paymentMode)}</strong> · E-mails : <strong>${esc(d.mailProvider)}</strong></p></section>
    <section class="card"><h2>Stock</h2><table class="tbl">${d.stock.map((s) => `<tr><td>${esc(s.name)}</td><td class="num">${s.stock}</td></tr>`).join('')}</table><a class="a-link" href="#product">Gérer le stock →</a></section>
  </div>
  <section class="card"><h2>Dernières commandes</h2>${d.recent.length ? `<table class="tbl"><thead><tr><th>N°</th><th>Date</th><th>Client</th><th>Statut</th><th class="num">Total</th></tr></thead><tbody>${d.recent.map((o) => `<tr class="click" data-href="#orders/${o.id}"><td>${esc(o.id)}</td><td>${date(o.at)}</td><td>${esc(o.name)}</td><td>${badge(o.status)}</td><td class="num">${eur(o.total)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Aucune commande pour l’instant.</p>'}</section>`);
  bindRowLinks();
}
function bindRowLinks() { $$('tr[data-href]').forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.href))); }

/* ------------------------------------------------------------------ */
/* Commandes                                                           */
/* ------------------------------------------------------------------ */
async function viewOrders() {
  const orders = await api('GET', 'orders');
  const filter = sessionStorage.getItem('a.orders.filter') || '';
  const rows = orders.filter((o) => !filter || o.status === filter);
  shell('orders', `${head('Commandes', `<select id="f-status"><option value="">Tous les statuts</option>${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}" ${k === filter ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="a-btn" id="export">Exporter CSV</button>`)}
  <section class="card">${rows.length ? `<table class="tbl"><thead><tr><th>N°</th><th>Date</th><th>Client</th><th>Articles</th><th>Paiement</th><th>Statut</th><th class="num">Total</th></tr></thead><tbody>
  ${rows.map((o) => `<tr class="click" data-href="#orders/${o.id}"><td><strong>${esc(o.id)}</strong></td><td>${date(o.createdAt)}</td><td>${esc(o.customer.firstName)} ${esc(o.customer.lastName)}<br><small class="muted">${esc(o.customer.email)}</small></td><td>${o.items}</td><td>${esc(o.provider)}${o.paid ? ' ✓' : ''}</td><td>${badge(o.status)}</td><td class="num">${eur(o.total)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Aucune commande.</p>'}</section>`);
  $('#f-status').onchange = (e) => { sessionStorage.setItem('a.orders.filter', e.target.value); viewOrders(); };
  $('#export').onclick = () => {
    const lines = [['id', 'date', 'statut', 'client', 'email', 'articles', 'total_eur'].join(';'), ...rows.map((o) => [o.id, o.createdAt, o.status, `${o.customer.firstName} ${o.customer.lastName}`, o.customer.email, o.items, (o.total / 100).toFixed(2)].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'))];
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' })), download: `commandes-elysea-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
  };
  bindRowLinks();
}

async function viewOrder(id) {
  const o = await api('GET', `orders/${encodeURIComponent(id)}`);
  const a = o.shippingAddress;
  shell('orders', `${head(`Commande ${o.id}`, `<a class="a-btn" href="#orders">← Retour</a>`)}
  <div class="cols">
    <section class="card"><h2>Articles</h2><table class="tbl">${o.items.map((i) => `<tr><td>${esc(i.name)}<br><small class="muted">${esc(i.variantName)} · ${esc(i.sku)}</small></td><td class="num">${i.qty} × ${eur(i.unitPrice)}</td><td class="num">${eur(i.total)}</td></tr>`).join('')}
      <tr><td colspan="2">Sous-total</td><td class="num">${eur(o.subtotal)}</td></tr><tr><td colspan="2">Livraison (${esc(o.shippingZone?.name || '')})</td><td class="num">${eur(o.shipping)}</td></tr><tr class="strong"><td colspan="2">Total</td><td class="num">${eur(o.total)}</td></tr></table>
      ${o.stockShortage ? `<p class="warn-box">Stock insuffisant au moment du paiement : ${esc(JSON.stringify(o.stockShortage))}</p>` : ''}
      <h2>Historique</h2><ul class="history">${o.history.map((h) => `<li><span>${date(h.at)}</span> ${badge(h.status)} <small class="muted">${esc(h.note || '')}</small></li>`).join('')}</ul></section>
    <section class="card"><h2>Client</h2><p><strong>${esc(o.customer.firstName)} ${esc(o.customer.lastName)}</strong><br><a href="mailto:${esc(o.customer.email)}">${esc(o.customer.email)}</a><br>${esc(o.customer.phone)}</p>
      <h2>Livraison</h2><p>${esc(a.line1)}${a.line2 ? `<br>${esc(a.line2)}` : ''}<br>${esc(a.postalCode)} ${esc(a.city)}<br>${esc(a.country)}</p>${a.notes ? `<p class="muted"><em>${esc(a.notes)}</em></p>` : ''}
      <h2>Paiement</h2><p>${esc(o.payment.provider)} — ${esc(o.payment.status)}${o.payment.paidAt ? ` le ${date(o.payment.paidAt)}` : ''}${o.payment.sessionId ? `<br><small class="muted">${esc(o.payment.sessionId)}</small>` : ''}</p>
      <form id="of" class="stack">
        <label class="a-field"><span class="a-label">Statut</span><select name="status">${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${field('note', 'Note d’historique (facultatif)')}
        <div class="row3">${field('carrier', 'Transporteur', o.tracking?.carrier)}${field('number', 'N° de suivi', o.tracking?.number)}${field('url', 'Lien de suivi', o.tracking?.url, 'url')}</div>
        ${check('sendShippedEmail', 'Envoyer l’e-mail « commande expédiée » (si statut Expédiée)', false)}
        <label class="a-field"><span class="a-label">Note interne</span><textarea name="internalNote" rows="3">${esc(o.internalNote || '')}</textarea></label>
        <button class="a-btn primary">Enregistrer</button>
      </form></section>
  </div>`);
  $('#of').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target.elements;
    try {
      await api('PATCH', `orders/${encodeURIComponent(o.id)}`, { status: f.status.value, note: f.note.value, tracking: { carrier: f.carrier.value, number: f.number.value, url: f.url.value }, sendShippedEmail: f.sendShippedEmail.checked, internalNote: f.internalNote.value });
      toast('Commande mise à jour'); viewOrder(o.id);
    } catch (err) { toast(err.message, 'err'); }
  };
}

/* ------------------------------------------------------------------ */
/* Produit, prix, promotions, variantes, stock                         */
/* ------------------------------------------------------------------ */
let productDraft = null;
async function viewProduct() {
  const p = productDraft || await api('GET', 'product');
  productDraft = p;
  const pr = p.promotion || {};
  shell('product', `${head('Produit & stock', '<button class="a-btn primary" id="save">Enregistrer</button>')}
  <form id="pf" class="stack">
    <section class="card"><h2>Fiche</h2>
      ${locField('name', 'Nom du produit', p.name)}
      ${locField('tagline', 'Accroche', p.tagline)}
      <div class="row3">${field('sku', 'Référence (SKU)', p.sku)}${field('price', 'Prix de vente TTC (€)', fromCents(p.price), 'text', 'inputmode="decimal" required')}${field('compareAtPrice', 'Prix barré (€, facultatif)', fromCents(p.compareAtPrice), 'text', 'inputmode="decimal"')}</div>
      <p class="hint">Les textes longs (description, fonctionnalités) se modifient dans « Textes du site ».</p>
    </section>
    <section class="card"><h2>Promotion</h2>
      ${check('promo.active', 'Promotion active', pr.active)}
      <div class="row3"><label class="a-field"><span class="a-label">Type</span><select name="promo.type"><option value="percent" ${pr.type !== 'amount' ? 'selected' : ''}>Pourcentage</option><option value="amount" ${pr.type === 'amount' ? 'selected' : ''}>Montant fixe (€)</option></select></label>
      ${field('promo.value', 'Valeur', pr.type === 'amount' ? fromCents(pr.value) : pr.value, 'text', 'inputmode="decimal"')}
      ${field('promo.endsAt', 'Fin (facultatif)', pr.endsAt ? String(pr.endsAt).slice(0, 16) : '', 'datetime-local')}</div>
      ${locField('promo.label', 'Libellé affiché', pr.label)}
    </section>
    <section class="card"><h2>Variantes & stock</h2>
      <div id="variants">${p.variants.map((v, i) => variantRow(v, i, p.gallery)).join('')}</div>
      <button type="button" class="a-btn" id="add-variant">+ Ajouter une variante (coloris, modèle)</button>
    </section>
    <section class="card"><h2>Dimensions & logistique</h2>
      <div class="row3">${field('dim.width', 'Largeur (cm)', p.dimensions.width, 'number')}${field('dim.depth', 'Profondeur (cm)', p.dimensions.depth, 'number')}${field('dim.height', 'Hauteur (cm)', p.dimensions.height, 'number')}</div>
      ${locField('logistics.volume', 'Volume d’expédition', p.logistics?.volume)}
      ${locField('logistics.grossWeight', 'Poids brut annoncé', p.logistics?.grossWeight)}
    </section>
  </form>`);
  $('#add-variant').onclick = () => { collectProduct(); productDraft.variants.push({ id: `variante-${productDraft.variants.length + 1}`, sku: '', name: { fr: '', en: '' }, swatch: ['#d6c4aa', '#604432'], priceDelta: 0, stock: 0, active: true, image: '' }); viewProduct(); };
  $$('[data-del-variant]').forEach((b) => (b.onclick = () => { if (productDraft.variants.length < 2) return toast('Au moins une variante est requise', 'err'); collectProduct(); productDraft.variants.splice(+b.dataset.delVariant, 1); viewProduct(); }));
  $('#save').onclick = async () => {
    try { collectProduct(); productDraft = await api('PUT', 'product', productDraft); toast('Produit enregistré'); viewProduct(); }
    catch (err) { toast(err.message, 'err'); }
  };
}
function variantRow(v, i, gallery) {
  return `<fieldset class="variant" data-i="${i}"><legend>Variante ${i + 1}</legend>
    <div class="row4">${field(`v${i}.id`, 'Identifiant', v.id)}${field(`v${i}.sku`, 'SKU', v.sku)}${field(`v${i}.stock`, 'Stock', v.stock, 'number', 'min="0"')}${field(`v${i}.priceDelta`, 'Écart de prix (€)', fromCents(v.priceDelta), 'text', 'inputmode="decimal"')}</div>
    ${locField(`v${i}.name`, 'Nom du coloris', v.name)}
    <div class="row4"><label class="a-field"><span class="a-label">Couleur 1</span><input type="color" name="v${i}.c0" value="${esc(v.swatch?.[0] || '#d6c4aa')}"></label>
      <label class="a-field"><span class="a-label">Couleur 2</span><input type="color" name="v${i}.c1" value="${esc(v.swatch?.[1] || '#604432')}"></label>
      <label class="a-field"><span class="a-label">Photo principale</span><select name="v${i}.image"><option value="">—</option>${gallery.map((g) => `<option value="${esc(g.id)}" ${g.id === v.image ? 'selected' : ''}>${esc(g.label?.fr || g.id)}</option>`).join('')}</select></label>
      <div class="a-field">${check(`v${i}.active`, 'En vente', v.active !== false)}<button type="button" class="a-btn danger small" data-del-variant="${i}">Supprimer</button></div></div>
  </fieldset>`;
}
function collectProduct() {
  const f = $('#pf'); if (!f) return;
  const E = f.elements; const p = productDraft;
  p.name = readLoc(f, 'name'); p.tagline = readLoc(f, 'tagline');
  p.sku = E.sku.value; p.price = toCents(E.price.value) || 0; p.compareAtPrice = toCents(E.compareAtPrice.value);
  const type = E['promo.type'].value;
  p.promotion = { active: E['promo.active'].checked, type, value: type === 'amount' ? toCents(E['promo.value'].value) || 0 : parseFloat(E['promo.value'].value) || 0, label: readLoc(f, 'promo.label'), endsAt: E['promo.endsAt'].value ? new Date(E['promo.endsAt'].value).toISOString() : null };
  p.variants = p.variants.map((v, i) => ({ ...v, id: E[`v${i}.id`].value, sku: E[`v${i}.sku`].value, stock: parseInt(E[`v${i}.stock`].value, 10) || 0, priceDelta: toCents(E[`v${i}.priceDelta`].value) || 0, name: readLoc(f, `v${i}.name`), swatch: [E[`v${i}.c0`].value, E[`v${i}.c1`].value], image: E[`v${i}.image`].value, active: E[`v${i}.active`].checked }));
  p.dimensions = { width: +E['dim.width'].value, depth: +E['dim.depth'].value, height: +E['dim.height'].value, unit: 'cm' };
  p.logistics = { volume: readLoc(f, 'logistics.volume'), grossWeight: readLoc(f, 'logistics.grossWeight') };
}

/* ------------------------------------------------------------------ */
/* Photos & modèle 3D                                                  */
/* ------------------------------------------------------------------ */
async function toWebp(file, width) {
  const bmp = await createImageBitmap(file);
  const w = Math.min(width, bmp.width); const h = Math.round((bmp.height * w) / bmp.width);
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.86));
  return { blob, w, h, natural: [bmp.width, bmp.height] };
}
function gcd(a, b) { return b ? gcd(b, a % b) : a; }

async function viewGallery() {
  const p = await api('GET', 'product');
  shell('gallery', `${head('Photos & 3D', '<button class="a-btn primary" id="save">Enregistrer l’ordre et les légendes</button>')}
  <section class="card"><h2>Ajouter des photos</h2>
    <p class="hint">JPEG, PNG ou WebP. Les images sont redimensionnées et converties en WebP (640, 1000, 1600 px) dans votre navigateur avant l’envoi. Format conseillé : 4:5 ou carré, au moins 1600 px de large.</p>
    <input type="file" id="files" accept="image/jpeg,image/png,image/webp" multiple><p id="up-status" class="muted small"></p></section>
  <section class="card"><h2>Galerie (${p.gallery.length})</h2><div class="gallery-admin" id="gal">
    ${p.gallery.map((g, i) => `<div class="g-item" data-i="${i}"><img src="${esc(g.src)}-${g.widths[0]}.${g.formats.includes('webp') ? 'webp' : g.formats[0]}" alt="">
      <div class="g-fields">${locField(`g${i}.label`, 'Légende', g.label)}${locField(`g${i}.alt`, 'Texte alternatif (accessibilité, SEO)', g.alt)}</div>
      <div class="g-actions"><button type="button" class="a-btn small" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="a-btn small" data-down="${i}" ${i === p.gallery.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="a-btn small danger" data-del="${i}">Retirer</button></div></div>`).join('')}
  </div></section>
  <section class="card"><h2>Modèle 3D (facultatif)</h2>
    <p class="hint">Par défaut, le site affiche un prototype 3D réalisé d’après les caractéristiques du produit. Vous pouvez le remplacer par le modèle réel au format GLB (40 Mo max). Pour conserver les animations, nommez les nœuds « hinge » (charnière du plateau) et « pouf ».</p>
    <p>Modèle actuel : <strong>${p.model3d ? esc(p.model3d) : 'prototype procédural'}</strong></p>
    <input type="file" id="glb" accept=".glb,model/gltf-binary"> ${p.model3d ? '<button class="a-btn small danger" id="glb-del">Revenir au prototype</button>' : ''}
  </section>`);
  const collect = () => {
    $$('.g-item').forEach((el) => { const i = +el.dataset.i; const fake = { elements: Object.fromEntries($$('input,textarea', el).map((x) => [x.name, x])) }; p.gallery[i].label = readLoc(fake, `g${i}.label`); p.gallery[i].alt = readLoc(fake, `g${i}.alt`); });
  };
  const save = async (msg = 'Galerie enregistrée') => { collect(); await api('PUT', 'product', p); toast(msg); viewGallery(); };
  $('#save').onclick = () => save().catch((e) => toast(e.message, 'err'));
  $$('[data-up]').forEach((b) => (b.onclick = () => { collect(); const i = +b.dataset.up; [p.gallery[i - 1], p.gallery[i]] = [p.gallery[i], p.gallery[i - 1]]; save('Ordre mis à jour'); }));
  $$('[data-down]').forEach((b) => (b.onclick = () => { collect(); const i = +b.dataset.down; [p.gallery[i + 1], p.gallery[i]] = [p.gallery[i], p.gallery[i + 1]]; save('Ordre mis à jour'); }));
  $$('[data-del]').forEach((b) => (b.onclick = () => { if (!confirm('Retirer cette image de la galerie ?')) return; collect(); p.gallery.splice(+b.dataset.del, 1); save('Image retirée'); }));
  $('#files').onchange = async (e) => {
    const st = $('#up-status');
    try {
      collect();
      for (const file of e.target.files) {
        const base = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const widths = [];
        let ratio = '4/5';
        for (const W of [640, 1000, 1600]) {
          st.textContent = `Conversion de ${file.name} (${W} px)…`;
          const { blob, w, natural } = await toWebp(file, W);
          if (widths.includes(w)) continue;
          await api('POST', `upload?base=${base}&w=${w}&ext=webp`, undefined, { body: blob, type: 'image/webp' });
          widths.push(w);
          const g = gcd(natural[0], natural[1]); ratio = `${natural[0] / g}/${natural[1] / g}`;
        }
        const name = file.name.replace(/\.[^.]+$/, '');
        p.gallery.push({ id: base, src: `/uploads/${base}`, widths, formats: ['webp'], ratio, alt: { fr: name, en: name }, label: { fr: name, en: name } });
      }
      st.textContent = '';
      await save('Photos ajoutées');
    } catch (err) { st.textContent = ''; toast(err.message, 'err'); }
  };
  $('#glb').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const r = await api('POST', `upload?ext=glb`, undefined, { body: file, type: 'model/gltf-binary' });
      collect(); p.model3d = r.path; await save('Modèle 3D enregistré');
    } catch (err) { toast(err.message, 'err'); }
  };
  const del = $('#glb-del'); if (del) del.onclick = () => { collect(); p.model3d = null; save('Prototype rétabli'); };
}

/* ------------------------------------------------------------------ */
/* Livraison                                                           */
/* ------------------------------------------------------------------ */
async function viewShipping() {
  const s = await api('GET', 'settings');
  const zones = s.shipping.zones;
  const zoneRow = (z, i) => `<fieldset class="variant"><legend>Zone ${i + 1}</legend>
    ${locField(`z${i}.name`, 'Nom', z.name)}
    <div class="row4">${field(`z${i}.countries`, 'Pays (codes ISO, séparés par des virgules)', (z.countries || []).join(', '))}${field(`z${i}.rate`, 'Tarif 1er article (€)', fromCents(z.rate), 'text', 'inputmode="decimal"')}${field(`z${i}.per`, 'Par article suppl. (€)', fromCents(z.perAdditionalItem), 'text', 'inputmode="decimal"')}${field(`z${i}.free`, 'Offerte dès (€, facultatif)', fromCents(z.freeOver), 'text', 'inputmode="decimal"')}</div>
    ${locField(`z${i}.delay`, 'Délai indicatif affiché', z.delay)}
    <button type="button" class="a-btn small danger" data-delz="${i}">Supprimer la zone</button></fieldset>`;
  shell('shipping', `${head('Livraison', '<button class="a-btn primary" id="save">Enregistrer</button>')}
  <form id="sf" class="stack"><section class="card">
    <p class="hint">Le tunnel de commande ne propose que les pays listés ci-dessous. Les montants sont TTC.</p>
    ${check('configured', 'Livraison configurée (les tarifs sont vérifiés et peuvent être affichés dans la FAQ)', s.shipping.configured)}
    <div id="zones">${zones.map(zoneRow).join('')}</div>
    <button type="button" class="a-btn" id="addz">+ Ajouter une zone</button></section></form>`);
  const collect = () => {
    const f = $('#sf'); const E = f.elements;
    s.shipping = { configured: E.configured.checked, zones: zones.map((z, i) => ({ id: z.id, name: readLoc(f, `z${i}.name`), countries: E[`z${i}.countries`].value.split(/[,\s]+/).filter(Boolean).map((c) => c.toUpperCase()), rate: toCents(E[`z${i}.rate`].value) || 0, perAdditionalItem: toCents(E[`z${i}.per`].value) || 0, freeOver: toCents(E[`z${i}.free`].value), delay: readLoc(f, `z${i}.delay`) })) };
    zones.splice(0, zones.length, ...s.shipping.zones);
  };
  $('#addz').onclick = () => { collect(); zones.push({ id: `zone-${Date.now().toString(36)}`, name: { fr: '', en: '' }, countries: [], rate: 0, perAdditionalItem: 0, freeOver: null, delay: { fr: '', en: '' } }); $('#zones').innerHTML = zones.map(zoneRow).join(''); bindDel(); };
  const bindDel = () => $$('[data-delz]').forEach((b) => (b.onclick = () => { collect(); zones.splice(+b.dataset.delz, 1); $('#zones').innerHTML = zones.map(zoneRow).join(''); bindDel(); }));
  bindDel();
  $('#save').onclick = async () => { try { collect(); await api('PUT', 'settings', s); toast('Livraison enregistrée'); } catch (e) { toast(e.message, 'err'); } };
}

/* ------------------------------------------------------------------ */
/* Textes du site                                                      */
/* ------------------------------------------------------------------ */
async function viewTexts() {
  const d = await api('GET', 'texts');
  const groups = {};
  for (const k of d.keys) (groups[k.split('.')[0]] ||= []).push(k);
  const LABELS = { meta: 'SEO (titres et descriptions)', nav: 'Navigation', brand: 'Marque', home: 'Accueil', product: 'Fiche produit', design: 'Conception', materials: 'Matières', inspiration: 'Inspiration', contact: 'Contact', faq: 'FAQ (libellés)', cart: 'Panier', checkout: 'Commande', confirmation: 'Confirmation', footer: 'Pied de page', legal: 'Pages légales', notFound: 'Page 404', reassurance: 'Réassurance', common: 'Divers' };
  const active = sessionStorage.getItem('a.texts.group') || 'home';
  const val = (l, k) => d.overrides?.[l]?.[k] ?? d.base[l]?.[k] ?? '';
  shell('texts', `${head('Textes du site', '<input type="search" id="q" placeholder="Rechercher…"><button class="a-btn primary" id="save">Enregistrer</button>')}
  <div class="tabs">${Object.keys(groups).map((g) => `<button type="button" class="tab ${g === active ? 'active' : ''}" data-g="${g}">${esc(LABELS[g] || g)}</button>`).join('')}</div>
  <section class="card"><p class="hint">Les champs modifiés remplacent le texte par défaut. Videz un champ et enregistrez pour revenir au texte d’origine. Les éléments entre accolades ({n}, {amount}…) sont remplacés automatiquement.</p>
  <div id="rows">${d.keys.map((k) => `<div class="t-row" data-k="${esc(k)}" data-g="${k.split('.')[0]}" ${k.split('.')[0] !== active ? 'hidden' : ''}><code>${esc(k)}</code><div class="loc-grid">${d.langs.map((l) => { const v = val(l, k); const long = v.length > 70; return `<label><span class="lang-tag">${l.toUpperCase()}</span>${long ? `<textarea data-l="${l}" rows="${Math.min(6, Math.ceil(v.length / 70))}" placeholder="${esc(d.base[l]?.[k] || '')}">${esc(v)}</textarea>` : `<input data-l="${l}" value="${esc(v)}" placeholder="${esc(d.base[l]?.[k] || '')}">`}</label>`; }).join('')}</div></div>`).join('')}</div></section>`);
  $$('.tab').forEach((b) => (b.onclick = () => { sessionStorage.setItem('a.texts.group', b.dataset.g); $$('.tab').forEach((x) => x.classList.toggle('active', x === b)); $$('.t-row').forEach((r) => (r.hidden = r.dataset.g !== b.dataset.g)); }));
  $('#q').oninput = (e) => { const q = e.target.value.toLowerCase(); $$('.t-row').forEach((r) => (r.hidden = q ? !(r.dataset.k.toLowerCase().includes(q) || $$('input,textarea', r).some((x) => x.value.toLowerCase().includes(q))) : r.dataset.g !== (sessionStorage.getItem('a.texts.group') || 'home'))); };
  $('#save').onclick = async () => {
    const out = Object.fromEntries(d.langs.map((l) => [l, {}]));
    $$('.t-row').forEach((r) => $$('[data-l]', r).forEach((x) => { if (x.value.trim()) out[x.dataset.l][r.dataset.k] = x.value; }));
    try { await api('PUT', 'texts', out); toast('Textes enregistrés'); } catch (e) { toast(e.message, 'err'); }
  };
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */
const CATS = { product: 'Le produit', dimensions: 'Dimensions', delivery: 'Livraison', returns: 'Retours', warranty: 'Garantie', care: 'Entretien du tissu', order: 'Commande et paiement' };
const POLICY = { delivery: 'conditions de livraison', zones: 'zones de livraison', returns: 'conditions de retour', warranty: 'garantie', care: 'conseils d’entretien' };
async function viewFaq() {
  const list = await api('GET', 'faq');
  const row = (f, i) => `<fieldset class="variant"><legend>Question ${i + 1}</legend>
    <div class="row4"><label class="a-field"><span class="a-label">Catégorie</span><select name="f${i}.cat">${Object.entries(CATS).map(([k, l]) => `<option value="${k}" ${k === f.category ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="a-field"><button type="button" class="a-btn small" data-up="${i}">↑</button> <button type="button" class="a-btn small" data-down="${i}">↓</button> <button type="button" class="a-btn small danger" data-del="${i}">Supprimer</button></div></div>
    ${locField(`f${i}.q`, 'Question', f.q)}
    ${f.policy ? `<p class="hint">Réponse automatique : reprend les ${esc(POLICY[f.policy] || f.policy)} définies dans Paramètres / Livraison (message d’attente si vide).</p>` : locField(`f${i}.a`, 'Réponse', f.a, { area: true })}</fieldset>`;
  shell('faq', `${head('FAQ', '<button class="a-btn primary" id="save">Enregistrer</button>')}<form id="ff" class="stack"><section class="card"><div id="list">${list.map(row).join('')}</div><button type="button" class="a-btn" id="add">+ Ajouter une question</button></section></form>`);
  const collect = () => { const f = $('#ff'); list.forEach((x, i) => { x.category = f.elements[`f${i}.cat`].value; x.q = readLoc(f, `f${i}.q`); if (!x.policy) x.a = readLoc(f, `f${i}.a`); }); };
  const redraw = () => { $('#list').innerHTML = list.map(row).join(''); bind(); };
  const bind = () => {
    $$('[data-del]').forEach((b) => (b.onclick = () => { collect(); list.splice(+b.dataset.del, 1); redraw(); }));
    $$('[data-up]').forEach((b) => (b.onclick = () => { collect(); const i = +b.dataset.up; if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]]; redraw(); }));
    $$('[data-down]').forEach((b) => (b.onclick = () => { collect(); const i = +b.dataset.down; if (i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]]; redraw(); }));
  };
  bind();
  $('#add').onclick = () => { collect(); list.push({ id: '', category: 'product', q: { fr: '', en: '' }, a: { fr: '', en: '' } }); redraw(); };
  $('#save').onclick = async () => { try { collect(); await api('PUT', 'faq', list); toast('FAQ enregistrée'); } catch (e) { toast(e.message, 'err'); } };
}

/* ------------------------------------------------------------------ */
/* Témoignages                                                         */
/* ------------------------------------------------------------------ */
async function viewTestimonials() {
  const list = await api('GET', 'testimonials');
  const row = (x, i) => `<fieldset class="variant"><legend>Témoignage ${i + 1}</legend><div class="row4">${field(`t${i}.author`, 'Auteur', x.author)}${field(`t${i}.city`, 'Ville', x.city)}<div class="a-field">${check(`t${i}.pub`, 'Publié', x.published !== false)}</div><div class="a-field"><button type="button" class="a-btn small danger" data-del="${i}">Supprimer</button></div></div>${locField(`t${i}.text`, 'Texte', x.text, { area: true })}</fieldset>`;
  shell('testimonials', `${head('Témoignages', '<button class="a-btn primary" id="save">Enregistrer</button>')}
  <form id="tf"><section class="card"><p class="hint">N’ajoutez que des avis réels de clients, avec leur accord. La section n’apparaît sur l’accueil que si au moins un témoignage est publié.</p><div id="list">${list.map(row).join('')}</div><button type="button" class="a-btn" id="add">+ Ajouter</button></section></form>`);
  const collect = () => { const f = $('#tf'); list.forEach((x, i) => { x.author = f.elements[`t${i}.author`].value; x.city = f.elements[`t${i}.city`].value; x.published = f.elements[`t${i}.pub`].checked; x.text = readLoc(f, `t${i}.text`); }); };
  const bind = () => $$('[data-del]').forEach((b) => (b.onclick = () => { collect(); list.splice(+b.dataset.del, 1); $('#list').innerHTML = list.map(row).join(''); bind(); }));
  bind();
  $('#add').onclick = () => { collect(); list.push({ author: '', city: '', text: { fr: '', en: '' }, published: false }); $('#list').innerHTML = list.map(row).join(''); bind(); };
  $('#save').onclick = async () => { try { collect(); await api('PUT', 'testimonials', list); toast('Témoignages enregistrés'); } catch (e) { toast(e.message, 'err'); } };
}

/* ------------------------------------------------------------------ */
/* Messages & e-mails                                                  */
/* ------------------------------------------------------------------ */
async function viewMessages() {
  const list = await api('GET', 'messages');
  shell('messages', `${head('Messages')}<section class="card">${list.length ? list.map((m) => `<article class="msg ${m.read ? '' : 'unread'}"><header><strong>${esc(m.name)}</strong> &lt;<a href="mailto:${esc(m.email)}?subject=${encodeURIComponent('Re: ' + m.subject)}">${esc(m.email)}</a>&gt; · ${esc(m.subject)}${m.order ? ` · ${esc(m.order)}` : ''}<span class="muted small">${date(m.at)} · ${esc(m.lang)}</span></header><p>${esc(m.message).replace(/\n/g, '<br>')}</p><button class="a-btn small" data-id="${esc(m.id)}" data-read="${m.read ? 0 : 1}">${m.read ? 'Marquer non lu' : 'Marquer lu'}</button></article>`).join('') : '<p class="muted">Aucun message.</p>'}</section>`);
  $$('[data-id]').forEach((b) => (b.onclick = async () => { await api('PATCH', `messages/${b.dataset.id}`, { read: b.dataset.read === '1' }); viewMessages(); }));
}
async function viewEmails() {
  const list = await api('GET', 'emails');
  shell('emails', `${head('E-mails envoyés')}<section class="card"><p class="hint">Journal des e-mails transactionnels. En mode « outbox », ils ne sont pas envoyés : configurez RESEND_API_KEY.</p>
  ${list.length ? `<table class="tbl"><thead><tr><th>Date</th><th>Destinataire</th><th>Objet</th><th>Type</th><th>État</th></tr></thead><tbody>${list.map((m, i) => `<tr class="click" data-i="${i}"><td>${date(m.at)}</td><td>${esc(m.to || '—')}</td><td>${esc(m.subject)}</td><td>${esc(m.tag)}</td><td>${m.error ? `<span class="pill warn">erreur</span>` : m.skipped ? '<span class="pill muted">sans destinataire</span>' : `<span class="pill ok">${esc(m.provider)}</span>`}</td></tr>`).join('')}</tbody></table><iframe id="preview" sandbox="" title="Aperçu"></iframe>` : '<p class="muted">Aucun e-mail.</p>'}</section>`);
  $$('tr[data-i]').forEach((tr) => (tr.onclick = () => { $('#preview').srcdoc = list[+tr.dataset.i].html; $('#preview').scrollIntoView({ behavior: 'smooth' }); }));
}

/* ------------------------------------------------------------------ */
/* Paramètres                                                          */
/* ------------------------------------------------------------------ */
async function viewSettings() {
  const s = await api('GET', 'settings');
  shell('settings', `${head('Paramètres', '<button class="a-btn primary" id="save">Enregistrer</button>')}
  <form id="sf" class="stack">
    <section class="card"><h2>Boutique</h2>
      <div class="row3">${field('storeName', 'Nom de la boutique', s.storeName)}${field('legalName', 'Raison sociale', s.legalName)}${field('siteUrl', 'Adresse du site (https://…)', s.siteUrl, 'url')}</div>
      <div class="row3">${field('contactEmail', 'E-mail de contact', s.contactEmail, 'email')}${field('orderNotificationEmail', 'E-mail de notification des commandes', s.orderNotificationEmail, 'email')}${field('phone', 'Téléphone', s.phone)}</div>
      <div class="row3">${field('companyId', 'SIRET / immatriculation', s.companyId)}${field('vatNumber', 'N° de TVA', s.vatNumber)}${field('currency', 'Devise (ISO)', s.currency)}</div>
      <label class="a-field"><span class="a-label">Adresse postale</span><textarea name="address" rows="3">${esc(s.address)}</textarea></label>
      <div class="row3">${field('social.instagram', 'Instagram (URL)', s.social?.instagram, 'url')}${field('social.pinterest', 'Pinterest (URL)', s.social?.pinterest, 'url')}</div>
    </section>
    <section class="card"><h2>Stock & paiement</h2>
      ${check('showLowStock', 'Afficher « Plus que N pièces » quand le stock est faible', s.showLowStock)}
      ${field('lowStockThreshold', 'Seuil de stock faible', s.lowStockThreshold, 'number', 'min="0"')}
      ${check('demoMode', 'Autoriser le paiement de démonstration quand Stripe n’est pas configuré (jamais en production sans ALLOW_DEMO_PAYMENTS=1)', s.payments?.demoMode)}
    </section>
    <section class="card"><h2>Conditions commerciales</h2><p class="hint">Affichées dans la FAQ et la fiche produit. Laissées vides, un message d’attente invite à vous contacter — rien n’est inventé.</p>
      ${locField('pol.delivery', 'Livraison (délais, modalités)', s.policies?.delivery, { area: true })}
      ${locField('pol.returns', 'Retours', s.policies?.returns, { area: true })}
      ${locField('pol.warranty', 'Garantie', s.policies?.warranty, { area: true })}
      ${locField('pol.care', 'Entretien du tissu', s.policies?.care, { area: true, rows: 5 })}
    </section>
    <section class="card"><h2>Pages légales</h2><p class="hint">Paragraphes séparés par une ligne vide.</p>
      ${locField('legal.legalNotice', 'Mentions légales', s.legal?.legalNotice, { area: true, rows: 8 })}
      ${locField('legal.terms', 'Conditions générales de vente', s.legal?.terms, { area: true, rows: 10 })}
      ${locField('legal.privacy', 'Politique de confidentialité', s.legal?.privacy, { area: true, rows: 8 })}
    </section>
    <section class="card"><h2>Bandeau de réassurance</h2>
      ${(s.reassurance || []).map((r, i) => `<fieldset class="variant"><legend>Élément ${i + 1}</legend><label class="a-field"><span class="a-label">Icône</span><select name="r${i}.icon">${['lock', 'truck', 'ruler', 'chat', 'check', 'layers'].map((ic) => `<option ${ic === r.icon ? 'selected' : ''}>${ic}</option>`).join('')}</select></label>${locField(`r${i}.title`, 'Titre', r.title)}${locField(`r${i}.text`, 'Texte', r.text)}</fieldset>`).join('')}
    </section>
  </form>`);
  $('#save').onclick = async () => {
    const f = $('#sf'); const E = f.elements;
    const out = { ...s };
    for (const k of ['storeName', 'legalName', 'siteUrl', 'contactEmail', 'orderNotificationEmail', 'phone', 'companyId', 'vatNumber', 'currency', 'address']) out[k] = E[k].value;
    out.social = { instagram: E['social.instagram'].value, pinterest: E['social.pinterest'].value };
    out.showLowStock = E.showLowStock.checked; out.lowStockThreshold = +E.lowStockThreshold.value;
    out.payments = { demoMode: E.demoMode.checked };
    out.policies = Object.fromEntries(['delivery', 'returns', 'warranty', 'care'].map((k) => [k, readLoc(f, `pol.${k}`)]));
    out.legal = Object.fromEntries(['legalNotice', 'terms', 'privacy'].map((k) => [k, readLoc(f, `legal.${k}`)]));
    out.reassurance = (s.reassurance || []).map((r, i) => ({ icon: E[`r${i}.icon`].value, title: readLoc(f, `r${i}.title`), text: readLoc(f, `r${i}.text`) }));
    try { await api('PUT', 'settings', out); toast('Paramètres enregistrés'); } catch (e) { toast(e.message, 'err'); }
  };
}

/* ------------------------------------------------------------------ */
/* Routeur                                                             */
/* ------------------------------------------------------------------ */
async function route() {
  const me = await fetch('/admin/api/me').then((r) => r.json()).catch(() => ({}));
  if (!me.authenticated) return renderLogin();
  const [view, id] = (location.hash.slice(1) || 'dashboard').split('/');
  if (view !== 'product') productDraft = null;
  try {
    const V = { dashboard: viewDashboard, orders: id ? () => viewOrder(id) : viewOrders, product: viewProduct, gallery: viewGallery, shipping: viewShipping, texts: viewTexts, faq: viewFaq, testimonials: viewTestimonials, messages: viewMessages, emails: viewEmails, settings: viewSettings };
    await (V[view] || viewDashboard)();
    $('#main')?.focus?.();
  } catch (err) { if (err.message !== 'Session expirée') toast(err.message, 'err'); }
}
addEventListener('hashchange', route);
route();
