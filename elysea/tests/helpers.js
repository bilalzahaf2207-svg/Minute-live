'use strict';
/** Lance une instance isolée du serveur (données temporaires) et fournit un petit client HTTP. */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

async function startServer(env = {}) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elysea-test-'));
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, NODE_ENV: 'test', ADMIN_PASSWORD: 'test-pass', STRIPE_SECRET_KEY: '', RESEND_API_KEY: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d)); proc.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${base}/healthz`); if (r.ok) break; } catch (_) {}
    await new Promise((r) => setTimeout(r, 50));
  }
  let cookie = '';
  const req = async (method, p, body, headers = {}) => {
    const h = { ...headers };
    if (cookie) h.cookie = cookie;
    let payload = body;
    if (body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body)) { payload = JSON.stringify(body); h['content-type'] ||= 'application/json'; }
    const r = await fetch(base + p, { method, body: payload, headers: h, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (_) {}
    return { status: r.status, headers: r.headers, text, json };
  };
  return {
    base, dataDir, req, log: () => log,
    admin: (method, p, body) => req(method, `/admin/api/${p}`, body, { 'x-requested-with': 'elysea-admin' }),
    readData: (name) => JSON.parse(fs.readFileSync(path.join(dataDir, `${name}.json`), 'utf8')),
    outbox: () => fs.readdirSync(path.join(dataDir, 'outbox')).map((f) => JSON.parse(fs.readFileSync(path.join(dataDir, 'outbox', f), 'utf8'))),
    async stop() { proc.kill(); await new Promise((r) => proc.once('exit', r)); fs.rmSync(dataDir, { recursive: true, force: true }); }
  };
}

const CUSTOMER = {
  customer: { email: 'client@example.com', phone: '0600000000' },
  address: { firstName: 'Camille', lastName: 'Martin', line1: '1 rue de la Paix', line2: '', postalCode: '75002', city: 'Paris', country: 'FR', notes: '' },
  acceptTerms: true
};

module.exports = { startServer, freePort, CUSTOMER };
