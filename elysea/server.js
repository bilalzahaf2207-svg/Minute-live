#!/usr/bin/env node
/**
 * ELYSÉA — Smart Vanity Collection
 * ----------------------------------------------------------------
 * Serveur Node natif : rendu HTML côté serveur (FR/EN), API e-commerce,
 * paiement Stripe Checkout, administration. Une seule dépendance : three.
 * Lancer : npm install && npm start   →  http://localhost:8790
 */
'use strict';
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const config = require('./src/config');
const i18n = require('./src/i18n');
const pages = require('./src/views/pages');
const api = require('./src/api');
const admin = require('./src/admin');
const commerce = require('./src/commerce');
const { send, json, redirect, serveFile, safeJoin, securityHeaders } = require('./src/http');
const { origin } = require('./src/views/layout');

const THREE_DIR = path.join(config.ROOT, 'node_modules', 'three');

function sitemap(req) {
  const o = origin(req);
  const urls = i18n.INDEXABLE.map((pg) => {
    const alts = i18n.LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${o}${i18n.url(pg, l)}"/>`).join('');
    return i18n.LANGS.map((l) => `<url><loc>${o}${i18n.url(pg, l)}</loc>${alts}<changefreq>${pg === 'product' ? 'weekly' : 'monthly'}</changefreq><priority>${pg === 'home' ? '1.0' : pg === 'product' ? '0.9' : '0.6'}</priority></url>`).join('');
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`;
}

async function route(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  const q = u.searchParams;

  if (p === '/healthz') return json(req, res, 200, { ok: true });
  if (p.startsWith('/api/')) return api.handle(req, res, p, q);
  if (p === '/admin' || p.startsWith('/admin/')) return admin.handle(req, res, p, q);

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, 'Method not allowed', 'text/plain');

  if (p === '/') { res.setHeader('Vary', 'Accept-Language'); return redirect(res, i18n.url('home', i18n.detect(req))); }
  if (/^\/(fr|en)$/.test(p)) return redirect(res, `${p}/`, 301);
  if (p === '/robots.txt') return send(req, res, 200, `User-agent: *\nDisallow: /admin\nDisallow: /api/\n${i18n.LANGS.map((l) => `Disallow: ${i18n.url('cart', l)}\nDisallow: ${i18n.url('checkout', l)}`).join('\n')}\nSitemap: ${origin(req)}/sitemap.xml\n`, 'text/plain; charset=utf-8');
  if (p === '/sitemap.xml') return send(req, res, 200, sitemap(req), 'application/xml; charset=utf-8', { 'Cache-Control': 'public, max-age=3600' });

  // Three.js (build + addons uniquement)
  if (p.startsWith('/vendor/three/')) {
    const rel = p.slice('/vendor/three/'.length);
    if (!/^(build|examples\/jsm)\//.test(rel)) return send(req, res, 404, 'Not found', 'text/plain');
    const f = safeJoin(THREE_DIR, rel);
    if (f && serveFile(req, res, f, { maxAge: 30 * 86400 })) return;
    return send(req, res, 404, 'Not found', 'text/plain');
  }
  if (p.startsWith('/uploads/')) {
    const f = safeJoin(path.join(config.dataDir, 'uploads'), p.slice('/uploads/'.length));
    if (f && serveFile(req, res, f, { maxAge: 30 * 86400, immutable: true })) return;
    return send(req, res, 404, 'Not found', 'text/plain');
  }

  // Pages
  const m = i18n.match(p);
  if (m) {
    const nonce = crypto.randomBytes(16).toString('base64');
    securityHeaders(res, nonce);
    const ctx = { req, nonce, lang: m.lang };
    let html;
    switch (m.page) {
      case 'home': html = pages.home(ctx); break;
      case 'product': html = pages.product(ctx); break;
      case 'design': html = pages.design(ctx); break;
      case 'materials': html = pages.materials(ctx); break;
      case 'inspiration': html = pages.inspiration(ctx); break;
      case 'contact': html = pages.contact(ctx); break;
      case 'cart': html = pages.cart(ctx); break;
      case 'checkout': html = pages.checkout(ctx); break;
      case 'confirmation': {
        let o = commerce.getOrder(q.get('order') || '');
        if (o && o.token !== q.get('t')) o = null;
        if (o) o = await api.syncStripe(o);
        html = pages.confirmation(ctx, o);
        break;
      }
      case 'legalNotice': case 'terms': case 'privacy': html = pages.legal(ctx, m.page); break;
      default: html = pages.notFound(ctx);
    }
    const priv = ['cart', 'checkout', 'confirmation'].includes(m.page);
    return send(req, res, 200, html, 'text/html; charset=utf-8', { 'Cache-Control': priv ? 'no-store' : 'public, max-age=0, must-revalidate', 'Content-Language': m.lang });
  }

  // Fichiers statiques
  const f = safeJoin(config.publicDir, p);
  if (f && !p.endsWith('/')) {
    const versioned = q.has('v');
    const isImg = /^\/(img|fonts)\//.test(p);
    if (serveFile(req, res, f, { maxAge: versioned || isImg ? 365 * 86400 : 3600, immutable: versioned || p.startsWith('/fonts/') })) return;
  }

  // 404 localisée
  const lang = p.startsWith('/en/') ? 'en' : p.startsWith('/fr/') ? 'fr' : i18n.detect(req);
  const nonce = crypto.randomBytes(16).toString('base64');
  securityHeaders(res, nonce);
  return send(req, res, 404, pages.notFound({ req, nonce, lang }), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
}

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    if (res.headersSent) return res.end();
    if (req.url.startsWith('/api/') || req.url.startsWith('/admin/api/')) return json(req, res, status, { error: status >= 500 ? 'server_error' : err.message });
    send(req, res, status, status >= 500 ? 'Erreur serveur' : err.message, 'text/plain; charset=utf-8');
  }
});

if (require.main === module) {
  server.listen(config.port, () => {
    console.log(`ELYSÉA — http://localhost:${config.port}  (paiement : ${require('./src/payments').paymentMode()}, e-mails : ${config.mail.provider})`);
    if (!config.isProd && !process.env.ADMIN_PASSWORD) console.log('Admin : /admin — mot de passe de développement « elysea-admin » (définissez ADMIN_PASSWORD en production).');
    if (config.isProd && !config.admin.password) console.warn('⚠ ADMIN_PASSWORD non défini : l’administration est désactivée.');
  });
}

module.exports = server;
