'use strict';
/** Petits utilitaires HTTP : réponses, corps, statiques, compression, en-têtes. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json'
};
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml|manifest)|image\/svg)/;

function securityHeaders(res, nonce) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (nonce) {
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://checkout.stripe.com"
    ].join('; '));
  }
}

function acceptsEncoding(req) {
  const ae = req.headers['accept-encoding'] || '';
  if (/\bbr\b/.test(ae)) return 'br';
  if (/\bgzip\b/.test(ae)) return 'gzip';
  return null;
}

function compress(buf, enc) {
  if (enc === 'br') return zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } });
  return zlib.gzipSync(buf, { level: 8 });
}

function send(req, res, status, body, type = 'text/html; charset=utf-8', headers = {}) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  const enc = buf.length > 1024 && COMPRESSIBLE.test(type) ? acceptsEncoding(req) : null;
  if (enc) { buf = compress(buf, enc); res.setHeader('Content-Encoding', enc); res.setHeader('Vary', 'Accept-Encoding'); }
  res.setHeader('Content-Length', buf.length);
  res.end(req.method === 'HEAD' ? undefined : buf);
}

function json(req, res, status, data, headers = {}) {
  send(req, res, status, JSON.stringify(data), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store', ...headers });
}

function redirect(res, location, status = 302) {
  res.statusCode = status;
  res.setHeader('Location', location);
  res.end();
}

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJSON(req, limit) {
  const ct = req.headers['content-type'] || '';
  if (!ct.includes('application/json')) throw Object.assign(new Error('JSON attendu'), { status: 415 });
  const raw = await readBody(req, limit);
  try { return JSON.parse(raw.toString('utf8') || '{}'); } catch (_) { throw Object.assign(new Error('JSON invalide'), { status: 400 }); }
}

/* ---- statiques avec cache mémoire des versions compressées ---- */
const staticCache = new Map();
function serveFile(req, res, f, { maxAge = 3600, immutable = false } = {}) {
  let st;
  try { st = fs.statSync(f); } catch (_) { return false; }
  if (!st.isFile()) return false;
  const type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
  const etag = `W/"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', immutable ? `public, max-age=${maxAge}, immutable` : `public, max-age=${maxAge}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.headers['if-none-match'] === etag) { res.statusCode = 304; res.end(); return true; }
  const enc = COMPRESSIBLE.test(type) ? acceptsEncoding(req) : null;
  if (enc) {
    const key = `${f}:${etag}:${enc}`;
    let buf = staticCache.get(key);
    if (!buf) { buf = compress(fs.readFileSync(f), enc); staticCache.set(key, buf); }
    res.writeHead(200, { 'Content-Type': type, 'Content-Encoding': enc, 'Vary': 'Accept-Encoding', 'Content-Length': buf.length });
    res.end(req.method === 'HEAD' ? undefined : buf);
    return true;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size });
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(f).pipe(res);
  return true;
}

/** Résout un chemin d'URL sous une racine, sans sortie possible (../). */
function safeJoin(root, urlPath) {
  const p = path.normalize(path.join(root, decodeURIComponent(urlPath)));
  return p.startsWith(root + path.sep) || p === root ? p : null;
}

function fileHash(f) {
  try { return crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 10); } catch (_) { return '0'; }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Limiteur simple en mémoire (par IP et clé). */
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key) || { n: 0, t: now };
  if (now - b.t > windowMs) { b.n = 0; b.t = now; }
  b.n++;
  buckets.set(key, b);
  return b.n <= max;
}
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
}

module.exports = { MIME, send, json, redirect, readBody, readJSON, serveFile, safeJoin, fileHash, parseCookies, escapeHtml, securityHeaders, rateLimit, clientIp };
