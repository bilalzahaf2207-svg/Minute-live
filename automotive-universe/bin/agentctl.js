#!/usr/bin/env node
// Pilotage en ligne de commande, utilisé notamment par Claude Code (onglet Code de l'app iPhone).
//   AGENT_URL=https://votre-agent  AGENT_TOKEN=...  agentctl "Mets en pause les publications"
//   agentctl run prepare_videos '{"date":"2026-11-26"}'
//   agentctl import fiches.json
// Dans une session cloud Claude Code, le jeton peut être injecté par le proxy (secret réseau
// de l'environnement) : AGENT_TOKEN peut alors rester une valeur factice.
import fs from 'node:fs';

const base = process.env.AGENT_URL;
const token = process.env.AGENT_TOKEN || 'injected-by-proxy';
if (!base) { console.error('Définissez AGENT_URL (ex. https://agent.exemple.fr)'); process.exit(1); }

const [first, ...rest] = process.argv.slice(2);
let body;
if (first === 'run') body = { name: rest[0], params: rest[1] ? JSON.parse(rest[1]) : {} };
else if (first === 'import') body = { name: 'import_series', params: { payload: JSON.parse(fs.readFileSync(rest[0], 'utf8')) } };
else if (first) body = { text: [first, ...rest].join(' ') };
else body = { name: 'status' };

const res = await fetch(new URL('/api/command', base), {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ ...body, origin: 'agentctl' }),
});
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
process.exit(res.ok ? 0 : 1);
