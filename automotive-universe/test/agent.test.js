import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-'));
process.env.DATA_DIR = dir;
process.env.LLM_PROVIDER = 'anthropic'; // pour prouver que le budget bloque même si l'IA est activée
process.env.BUDGET_MONTHLY_EUR = '0';
fs.copyFileSync(new URL('../data/series.json', import.meta.url), path.join(dir, 'series.json'));

const { openDb, getDb } = await import('../src/db.js');
const budget = await import('../src/budget.js');
const { generate } = await import('../src/llm.js');
const { execute, parseIntent } = await import('../src/commands.js');
const { mcpHttp } = await import('../src/mcp.js');
const { localToUtcIso } = await import('../src/time.js');
const { importLibrary } = await import('../src/pipeline/research.js');

before(() => { openDb(':memory:'); importLibrary(); });

test('budget à 0 : aucune dépense possible, l’IA retourne null sans appel réseau', async () => {
  assert.throws(() => budget.authorize('anthropic', 0.01, 't'), budget.BudgetError);
  assert.equal(await generate({ purpose: 't', system: 's', prompt: 'p' }), null);
});

test('le plafond exige une confirmation explicite du propriétaire', () => {
  assert.throws(() => budget.ownerSetCap(10, 'oui'), budget.BudgetError);
  budget.ownerSetCap(10, 'JE CONFIRME 10 EUR');
  budget.authorize('anthropic', 1, 't');
  budget.record('anthropic', 9.5, 't');
  assert.throws(() => budget.authorize('anthropic', 1, 't'), /Plafond/);
  budget.ownerFreeze(true);
  assert.throws(() => budget.authorize('anthropic', 0.01, 't'), /gelées/);
});

test('compréhension des demandes en français', () => {
  assert.equal(parseIntent('Prépare les vidéos de demain.')[0], 'prepare_videos');
  assert.equal(parseIntent('Pourquoi la publication de ce matin a échoué ?')[0], 'explain_failures');
  assert.equal(parseIntent('Analyse les performances de la semaine.')[0], 'weekly_report');
  assert.deepEqual(parseIntent('Prépare une série sur les moteurs V12.'), ['plan_series', { theme: 'moteurs v12.' }]);
  assert.equal(parseIntent('Consulte les messages privés en attente.')[0], 'pending_messages');
  assert.equal(parseIntent('Mets en pause les publications.')[0], 'pause_publishing');
});

test('pause / reprise', async () => {
  assert.equal((await execute('pause_publishing')).publishing_paused, true);
  assert.equal((await execute('status')).publishing_paused, true);
  await execute('resume_publishing');
});

test('commande hors liste blanche refusée', async () => {
  await assert.rejects(execute('set_budget', { eur: 1000 }), /non autorisée/);
});

test('MCP : initialize, tools/list sans outil budgétaire, tools/call', async () => {
  const init = await mcpHttp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.result.serverInfo.name, 'automotive-universe-agent');
  const list = await mcpHttp({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = list.result.tools.map(t => t.name);
  assert.ok(names.includes('prepare_videos') && names.includes('approve') && !names.some(n => /set_budget|ownerSetCap|approval_steps|gates/.test(n)));
  const call = await mcpHttp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'budget_status', arguments: {} } });
  assert.match(call.result.content[0].text, /cap_eur/);
  assert.equal(await mcpHttp({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('heure de Paris → UTC (hiver et été)', () => {
  assert.equal(localToUtcIso('2026-01-15', '19:00'), '2026-01-15T18:00:00.000Z');
  assert.equal(localToUtcIso('2026-07-15', '19:00'), '2026-07-15T17:00:00.000Z');
});

test('rien n’est produit tant que l’identité n’est pas validée', async () => {
  const r = await execute('prepare_videos', { date: '2026-11-26' });
  assert.equal(r.created.length, 0);
  assert.match(r.message, /Identité/);
});

test('identité : proposition avec aperçu, puis validation explicite', { timeout: 60000 }, async () => {
  const r = await execute('set_brand', { name: 'Automotive Universe', handle: 'automotive.universe', preset: 'showroom' });
  assert.equal(r.brand.handle, '@automotive.universe');
  assert.equal(r.brand.confirmed, false);
  assert.match(r.preview, /\/media\/preview\.png\?exp=\d+&sig=/);
  assert.ok(fs.statSync(path.join(dir, 'out', 'preview.png')).size > 5000);
  assert.equal((await execute('confirm_brand')).confirmed, true);
  await assert.rejects(execute('set_brand', { preset: 'inconnue' }), /inconnue/);
  assert.equal((await execute('get_brand')).brand.confirmed, true);
});

test('validation étape par étape : sujet → script → vidéo → publication', { timeout: 180000 }, async () => {
  const { publishDue } = await import('../src/pipeline/publish.js');
  // 1. les sujets importés sont seulement « proposés »
  let p = await execute('pending_approvals');
  assert.ok(p.topics.length >= 3);
  assert.equal((await execute('prepare_videos', { date: '2026-11-26' })).created.length, 0);
  await execute('approve', { kind: 'series', series: 'Moteurs V12' });

  // 2. production → arrêt à la validation du script
  const r = await execute('prepare_videos', { date: '2026-11-26' });
  assert.equal(r.created.length, 2);
  assert.ok(r.created.every(c => c.status === 'script_review'));
  const id = r.created[0].id;
  await execute('edit_script', { id, scenes: ['Titre corrigé', 'Un fait vérifié', 'Abonne-toi'], caption: 'Légende #v12' });

  // 3. script validé → montage → arrêt à la validation de la vidéo
  assert.equal((await execute('approve', { kind: 'video', id })).status, 'video_review');
  p = await execute('pending_approvals');
  assert.match(p.videos.find(v => v.id === id).watch, /\/media\/\d+\.mp4/);

  // 4. vidéo validée → arrêt à l’autorisation de publication
  assert.equal((await execute('approve', { kind: 'video', id })).status, 'publish_review');

  // garde-fou : une vidéo planifiée sans autorisation n’est jamais publiée
  getDb().prepare("UPDATE videos SET status = 'scheduled', scheduled_at = '2000-01-01T00:00:00Z' WHERE id = ?").run(id);
  assert.equal(await publishDue(), 0);
  assert.equal(getDb().prepare('SELECT status FROM videos WHERE id = ?').get(id).status, 'publish_review');

  // 5. publication autorisée → planifiée (créneau passé → reporté)
  const s = await execute('approve', { kind: 'video', id });
  assert.equal(s.status, 'scheduled');
  assert.ok(new Date(s.scheduled_at) > new Date());

  // un refus renvoie au script et efface toutes les validations
  const rej = await execute('reject', { kind: 'video', id, reason: 'Couleur du titre' });
  assert.equal(rej.status, 'script_review');
  assert.equal(getDb().prepare('SELECT approved_publish_at FROM videos WHERE id = ?').get(id).approved_publish_at, null);
});
