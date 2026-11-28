'use strict';
/**
 * E-mails transactionnels.
 * Transport : Resend (RESEND_API_KEY) ou « outbox » — chaque e-mail est écrit
 * dans data/outbox/ et consultable dans l'admin (développement, recette).
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const store = require('./store');
const { t, L, url } = require('./i18n');
const { formatMoney } = require('./commerce');
const { escapeHtml: e } = require('./http');

async function deliver({ to, subject, html, text, tag }) {
  const rec = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), to, subject, tag, provider: config.mail.provider };
  if (!to) { rec.skipped = 'no-recipient'; }
  else if (config.mail.provider === 'resend') {
    try {
      const r = await fetch(`${config.mail.resendBase}/emails`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.mail.resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: config.mail.from, to: [to], subject, html, text })
      });
      rec.status = r.status;
      if (!r.ok) rec.error = (await r.text()).slice(0, 500);
    } catch (err) { rec.error = err.message; }
  }
  fs.writeFileSync(path.join(config.dataDir, 'outbox', `${rec.id}.json`), JSON.stringify({ ...rec, html, text }, null, 2));
  return rec;
}

function listOutbox(limit = 100) {
  const dir = path.join(config.dataDir, 'outbox');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, limit)
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { return null; } })
    .filter(Boolean);
}

function siteUrl() { return config.siteUrl || store.get('settings').siteUrl || `http://localhost:${config.port}`; }

/** Gabarit HTML sobre, compatible clients mail (tables, styles en ligne). */
function layout(lang, title, inner) {
  const s = store.get('settings');
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${e(title)}</title></head>
<body style="margin:0;background:#f4efe8;font-family:Helvetica,Arial,sans-serif;color:#2b211b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe8;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fffdf9;border-radius:4px">
<tr><td style="padding:36px 40px 8px;text-align:center;font-family:Georgia,serif;font-size:26px;letter-spacing:.28em;color:#2b211b">${e(s.storeName || 'ELYSÉA')}</td></tr>
<tr><td style="padding:0 40px 8px;text-align:center;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#8a7766">${e(t(lang, 'brand.collection'))}</td></tr>
<tr><td style="padding:24px 40px 40px;font-size:15px;line-height:1.6">${inner}</td></tr>
<tr><td style="padding:20px 40px;border-top:1px solid #eadfd2;font-size:12px;color:#8a7766;text-align:center">${e(s.legalName || s.storeName || 'ELYSÉA')}${s.contactEmail ? ` · <a href="mailto:${e(s.contactEmail)}" style="color:#8a7766">${e(s.contactEmail)}</a>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
}

function itemsTable(order, lang) {
  const rows = order.items.map((i) => `<tr><td style="padding:10px 0;border-bottom:1px solid #eadfd2">${e(i.name)}<br><span style="color:#8a7766;font-size:13px">${e(i.variantName)} × ${i.qty}</span></td><td align="right" style="padding:10px 0;border-bottom:1px solid #eadfd2;white-space:nowrap">${formatMoney(i.total, lang, order.currency)}</td></tr>`).join('');
  const line = (label, v, strong) => `<tr><td style="padding:6px 0;${strong ? 'font-weight:bold' : 'color:#5d4e43'}">${e(label)}</td><td align="right" style="padding:6px 0;${strong ? 'font-weight:bold' : ''}">${v}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0">${rows}
${line(t(lang, 'cart.subtotal'), formatMoney(order.subtotal, lang, order.currency))}
${line(t(lang, 'cart.shipping'), order.shipping ? formatMoney(order.shipping, lang, order.currency) : t(lang, 'cart.free'))}
${line(t(lang, 'cart.total'), formatMoney(order.total, lang, order.currency), true)}</table>`;
}

function addressBlock(o) {
  const a = o.shippingAddress;
  return `${e(o.customer.firstName)} ${e(o.customer.lastName)}<br>${e(a.line1)}${a.line2 ? `<br>${e(a.line2)}` : ''}<br>${e(a.postalCode)} ${e(a.city)}<br>${e(a.country)}`;
}

const COPY = {
  fr: {
    confirmSubject: (id) => `Votre commande ${id} est confirmée`,
    confirmIntro: (n) => `Bonjour ${n},<br><br>Merci pour votre commande. Votre paiement a bien été reçu ; nous préparons votre coiffeuse avec soin.`,
    shippedSubject: (id) => `Votre commande ${id} a été expédiée`,
    shippedIntro: (n) => `Bonjour ${n},<br><br>Bonne nouvelle : votre commande vient d'être expédiée.`,
    tracking: 'Suivi du colis', address: 'Adresse de livraison', view: 'Voir ma commande',
    adminSubject: (id, total) => `Nouvelle commande ${id} — ${total}`,
    contactSubject: (s) => `Message reçu : ${s}`,
    contactAck: (n) => `Bonjour ${n},<br><br>Nous avons bien reçu votre message et vous répondrons personnellement dans les meilleurs délais.`
  },
  en: {
    confirmSubject: (id) => `Your order ${id} is confirmed`,
    confirmIntro: (n) => `Hello ${n},<br><br>Thank you for your order. Your payment has been received and we're preparing your vanity with care.`,
    shippedSubject: (id) => `Your order ${id} has shipped`,
    shippedIntro: (n) => `Hello ${n},<br><br>Good news: your order is on its way.`,
    tracking: 'Parcel tracking', address: 'Shipping address', view: 'View my order',
    adminSubject: (id, total) => `New order ${id} — ${total}`,
    contactSubject: (s) => `Message received: ${s}`,
    contactAck: (n) => `Hello ${n},<br><br>We have received your message and will reply personally as soon as possible.`
  }
};

function orderLink(o) { return `${siteUrl()}${url('confirmation', o.lang, { order: o.id, t: o.token })}`; }
function button(href, label) { return `<p style="margin:28px 0;text-align:center"><a href="${e(href)}" style="display:inline-block;background:#2b211b;color:#fffdf9;text-decoration:none;padding:14px 28px;border-radius:999px;font-size:14px;letter-spacing:.04em">${e(label)}</a></p>`; }

async function orderConfirmation(o) {
  const c = COPY[o.lang] || COPY.fr;
  const inner = `<p>${c.confirmIntro(e(o.customer.firstName))}</p>
<p style="font-size:13px;color:#8a7766;text-transform:uppercase;letter-spacing:.12em;margin-top:28px">${e(t(o.lang, 'confirmation.order'))} ${e(o.id)}</p>
${itemsTable(o, o.lang)}<p style="font-size:13px;color:#8a7766;text-transform:uppercase;letter-spacing:.12em">${c.address}</p><p>${addressBlock(o)}</p>${button(orderLink(o), c.view)}`;
  const subject = c.confirmSubject(o.id);
  const text = `${subject}\n\n${o.items.map((i) => `${i.name} — ${i.variantName} × ${i.qty}`).join('\n')}\n${t(o.lang, 'cart.total')}: ${formatMoney(o.total, o.lang, o.currency)}\n\n${orderLink(o)}`;
  return deliver({ to: o.customer.email, subject, html: layout(o.lang, subject, inner), text, tag: 'order-confirmation' });
}

async function orderAdminNotification(o) {
  const s = store.get('settings');
  const to = s.orderNotificationEmail || s.contactEmail;
  const subject = COPY.fr.adminSubject(o.id, formatMoney(o.total, 'fr', o.currency));
  const inner = `<p><strong>${e(o.customer.firstName)} ${e(o.customer.lastName)}</strong> — ${e(o.customer.email)} — ${e(o.customer.phone)}</p>${itemsTable(o, 'fr')}<p>${addressBlock(o)}</p>${o.shippingAddress.notes ? `<p><em>${e(o.shippingAddress.notes)}</em></p>` : ''}${button(`${siteUrl()}/admin#orders/${o.id}`, 'Ouvrir dans l’admin')}`;
  return deliver({ to, subject, html: layout('fr', subject, inner), text: subject, tag: 'order-admin' });
}

async function orderShipped(o) {
  const c = COPY[o.lang] || COPY.fr;
  const tr = o.tracking || {};
  const trackLine = tr.number ? `<p style="font-size:13px;color:#8a7766;text-transform:uppercase;letter-spacing:.12em">${c.tracking}</p><p>${e(tr.carrier)} ${tr.url ? `<a href="${e(tr.url)}" style="color:#2b211b">${e(tr.number)}</a>` : e(tr.number)}</p>` : '';
  const subject = c.shippedSubject(o.id);
  const inner = `<p>${c.shippedIntro(e(o.customer.firstName))}</p>${trackLine}${itemsTable(o, o.lang)}${button(orderLink(o), c.view)}`;
  return deliver({ to: o.customer.email, subject, html: layout(o.lang, subject, inner), text: `${subject}\n${tr.carrier || ''} ${tr.number || ''} ${tr.url || ''}`, tag: 'order-shipped' });
}

async function contactMessage(msg) {
  const s = store.get('settings');
  const subject = `[Contact] ${msg.subject} — ${msg.name}`;
  const inner = `<p><strong>${e(msg.name)}</strong> &lt;${e(msg.email)}&gt;</p><p>${e(msg.subject)}${msg.order ? ` · ${e(msg.order)}` : ''}</p><p style="white-space:pre-wrap">${e(msg.message)}</p>`;
  await deliver({ to: s.contactEmail, subject, html: layout('fr', subject, inner), text: `${msg.name} <${msg.email}>\n\n${msg.message}`, tag: 'contact-admin' });
  const c = COPY[msg.lang] || COPY.fr;
  const ackSubject = c.contactSubject(msg.subject);
  return deliver({ to: msg.email, subject: ackSubject, html: layout(msg.lang, ackSubject, `<p>${c.contactAck(e(msg.name))}</p><blockquote style="margin:20px 0;padding-left:16px;border-left:2px solid #eadfd2;color:#5d4e43;white-space:pre-wrap">${e(msg.message)}</blockquote>`), text: ackSubject, tag: 'contact-ack' });
}

module.exports = { deliver, listOutbox, orderConfirmation, orderAdminNotification, orderShipped, contactMessage, layout, siteUrl };
