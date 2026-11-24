// Recherche de sujets : 1) fiches de la bibliothèque (gratuit), 2) flux RSS (gratuit),
// 3) suggestions IA si un budget est ouvert.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb, now, logEvent } from '../db.js';
import { generate, parseJson } from '../llm.js';
import { gateOn } from '../approvals.js';

export function addTopic({ title, series = null, source = 'manual', facts = [], hashtags = [], score = 0 }) {
  const db = getDb();
  if (db.prepare('SELECT 1 FROM topics WHERE lower(title) = lower(?)').get(title)) return false;
  db.prepare('INSERT INTO topics(title, series, source, facts, score, status, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)')
    .run(title, series, source, JSON.stringify({ facts, hashtags }), score, gateOn('topic') ? 'proposed' : 'new', now());
  return true;
}

export function importLibrary(file = path.join(config.dataDir, 'series.json')) {
  if (!fs.existsSync(file)) return 0;
  return importSeries(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function importSeries(payload) {
  let added = 0;
  for (const s of payload.series ?? []) {
    for (const t of s.topics ?? []) if (addTopic({ ...t, series: s.series, source: 'library', score: 1 })) added++;
  }
  return added;
}

async function fetchRss(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'AutomotiveUniverseAgent/0.1' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<item[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g)].map(m => m[1].trim()).slice(0, 10);
}

export async function research() {
  let added = importLibrary();
  for (const url of config.production.rssFeeds) {
    try {
      for (const title of await fetchRss(url)) if (addTopic({ title, source: `rss:${new URL(url).hostname}`, score: 0.5 })) added++;
    } catch (e) { logEvent('warn', 'research', `Flux RSS ignoré : ${e.message}`); }
  }
  // Optionnel et payant : l'IA propose des angles à partir des titres récents.
  const recent = getDb().prepare("SELECT title FROM topics ORDER BY id DESC LIMIT 20").all().map(r => r.title);
  const text = await generate({
    purpose: 'research',
    system: 'Tu es rédacteur en chef d\'un compte TikTok automobile francophone. Réponds uniquement en JSON.',
    prompt: `Sujets récents : ${JSON.stringify(recent)}\nPropose 5 nouveaux sujets vérifiables, en JSON : [{"title":"...","facts":["..."],"hashtags":["..."]}]`,
    maxTokens: 3000,
  });
  for (const t of parseJson(text) ?? []) if (t?.title && addTopic({ ...t, source: 'ai', score: 0.8 })) added++;
  logEvent('info', 'research', `${added} nouveau(x) sujet(s)`);
  return added;
}
