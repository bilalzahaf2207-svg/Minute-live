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
  assert.ok(names.includes('prepare_videos') && !names.some(n => /set_budget|ownerSetCap/.test(n)));
  const call = await mcpHttp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'budget_status', arguments: {} } });
  assert.match(call.result.content[0].text, /cap_eur/);
  assert.equal(await mcpHttp({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('heure de Paris → UTC (hiver et été)', () => {
  assert.equal(localToUtcIso('2026-01-15', '19:00'), '2026-01-15T18:00:00.000Z');
  assert.equal(localToUtcIso('2026-07-15', '19:00'), '2026-07-15T17:00:00.000Z');
});

test('production complète d’une journée en simulation (ffmpeg)', { timeout: 120000 }, async () => {
  const r = await execute('prepare_videos', { date: '2026-11-26' });
  assert.equal(r.created.length, 2);
  const v = getDb().prepare("SELECT * FROM videos WHERE status = 'scheduled'").get();
  assert.ok(fs.statSync(v.file).size > 10000);
});
