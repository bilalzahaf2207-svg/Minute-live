// Point d'entrée de l'agent de production : API admin, tableau de bord mobile,
// connecteur MCP pour Claude, OAuth TikTok, et planificateur interne.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { openDb, getDb, logEvent } from './db.js';
import { execute, parseIntent, COMMANDS } from './commands.js';
import { ownerSetCap, ownerFreeze, budgetStatus, BudgetError } from './budget.js';
import { mcpHttp } from './mcp.js';
import { startScheduler } from './scheduler.js';
import { importLibrary } from './pipeline/research.js';
import * as tiktok from './adapters/tiktok.js';
import { checkMediaSig, setGates, ALL_GATES } from './approvals.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD = path.join(here, '..', 'public', 'dashboard.html');

const safeEq = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const failures = new Map();
function throttled(ip) {
  const f = failures.get(ip); if (!f) return false;
  if (Date.now() - f.since > 10 * 60_000) { failures.delete(ip); return false; }
  return f.n >= 20;
}
function fail(ip) { const f = failures.get(ip) ?? { n: 0, since: Date.now() }; f.n++; failures.set(ip, f); }

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
async function readJson(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 1e6) throw new Error('Corps trop volumineux'); }
  return raw ? JSON.parse(raw) : {};
}

const oauthStates = new Set();

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    try {
      if (url.pathname === '/health') return send(res, 200, { ok: true });
      if (url.pathname === '/' || url.pathname === '/dashboard') return send(res, 200, fs.readFileSync(DASHBOARD), 'text/html; charset=utf-8');
      if (throttled(ip)) return send(res, 429, { error: 'Trop de tentatives' });

      // ── Vidéos et aperçus à valider (liens signés, expirants) ──
      const media = url.pathname.match(/^\/media\/(\d+|preview)\.(mp4|png)$/);
      if (media) {
        if (!checkMediaSig(media[1], url.searchParams.get('exp'), url.searchParams.get('sig'))) { fail(ip); return send(res, 403, { error: 'lien expiré ou invalide' }); }
        const file = media[1] === 'preview' ? path.join(config.dataDir, 'out', 'preview.png')
          : getDb().prepare('SELECT file FROM videos WHERE id = ?').get(Number(media[1]))?.file;
        if (!file || !fs.existsSync(file)) return send(res, 404, { error: 'fichier absent' });
        return send(res, 200, fs.readFileSync(file), media[2] === 'png' ? 'image/png' : 'video/mp4');
      }

      // ── Connecteur MCP (app Claude / Claude Code) ──
      if (url.pathname.startsWith('/mcp/')) {
        if (!safeEq(url.pathname.slice(5), config.mcpPathSecret)) { fail(ip); return send(res, 404, { error: 'introuvable' }); }
        if (req.method !== 'POST') return send(res, 405, { error: 'POST uniquement' });
        const out = await mcpHttp(await readJson(req));
        if (!out) { res.writeHead(202); return res.end(); }
        return send(res, 200, out);
      }

      // ── OAuth TikTok (le propriétaire autorise une fois, depuis son téléphone) ──
      const redirectUri = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}/oauth/tiktok/callback`;
      if (url.pathname === '/oauth/tiktok/start') {
        if (!safeEq(url.searchParams.get('token') ?? '', config.adminToken)) { fail(ip); return send(res, 401, { error: 'non autorisé' }); }
        const state = crypto.randomBytes(16).toString('hex'); oauthStates.add(state);
        res.writeHead(302, { location: tiktok.authorizeUrl(redirectUri, state) }); return res.end();
      }
      if (url.pathname === '/oauth/tiktok/callback') {
        const state = url.searchParams.get('state');
        if (!oauthStates.delete(state)) return send(res, 400, { error: 'état OAuth invalide' });
        await tiktok.exchangeCode(url.searchParams.get('code'), redirectUri);
        logEvent('info', 'oauth', 'Compte TikTok connecté');
        return send(res, 200, '<p>Compte TikTok connecté. Vous pouvez fermer cette page.</p>', 'text/html; charset=utf-8');
      }

      // ── API d'administration (Bearer ADMIN_TOKEN) ──
      if (url.pathname.startsWith('/api/')) {
        const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        if (!safeEq(token, config.adminToken)) { fail(ip); return send(res, 401, { error: 'non autorisé' }); }
        const db = getDb();
        if (url.pathname === '/api/commands') return send(res, 200, Object.fromEntries(Object.entries(COMMANDS).map(([k, c]) => [k, { description: c.description, params: c.params }])));
        if (url.pathname === '/api/videos') return send(res, 200, db.prepare('SELECT id, title, status, scheduled_at, published_at, error FROM videos ORDER BY id DESC LIMIT 50').all());
        if (url.pathname === '/api/events') return send(res, 200, db.prepare('SELECT ts, level, source, message FROM events ORDER BY id DESC LIMIT 100').all());
        if (url.pathname === '/api/command' && req.method === 'POST') {
          const body = await readJson(req);
          const [name, params] = body.text ? parseIntent(body.text) : [body.name, body.params ?? {}];
          return send(res, 200, { command: name, result: await execute(name, params, body.origin ?? 'api') });
        }
        if (url.pathname === '/api/approval-steps' && req.method === 'POST') {
          // Réservé au propriétaire : retirer une étape de validation exige une confirmation écrite.
          const body = await readJson(req);
          const removed = ALL_GATES.filter(g => !(body.steps ?? []).includes(g));
          if (removed.length && body.confirmation !== `JE NE VALIDE PLUS ${removed.join(' ').toUpperCase()}`) {
            return send(res, 400, { error: `Confirmation requise : « JE NE VALIDE PLUS ${removed.join(' ').toUpperCase()} »` });
          }
          return send(res, 200, { steps: setGates(body.steps ?? ALL_GATES) });
        }
        if (url.pathname === '/api/budget' && req.method === 'GET') return send(res, 200, budgetStatus());
        if (url.pathname === '/api/budget' && req.method === 'POST') {
          const body = await readJson(req);
          if ('frozen' in body) return send(res, 200, ownerFreeze(body.frozen));
          return send(res, 200, ownerSetCap(Number(body.monthly_eur), body.confirmation));
        }
        return send(res, 404, { error: 'route inconnue' });
      }
      return send(res, 404, { error: 'introuvable' });
    } catch (e) {
      logEvent('error', 'http', `${url.pathname} : ${e.message}`);
      return send(res, e instanceof BudgetError ? 400 : 500, { error: e.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if ((config.adminToken ?? '').length < 24 || (config.mcpPathSecret ?? '').length < 24) {
    console.error('ADMIN_TOKEN et MCP_PATH_SECRET doivent faire au moins 24 caractères aléatoires. Voir .env.example.');
    process.exit(1);
  }
  openDb();
  importLibrary();
  startScheduler();
  createServer().listen(config.port, () => {
    logEvent('info', 'server', `Agent démarré sur :${config.port} (publication ${config.publish.mode}, IA ${config.llm.provider}, budget ${budgetStatus().cap_eur} €)`);
  });
}
