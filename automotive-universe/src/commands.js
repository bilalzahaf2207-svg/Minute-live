// Liste BLANCHE des actions que l'on peut demander depuis l'iPhone (app Claude, tableau de bord, agentctl).
// Rien d'autre n'est exécutable à distance. Aucune commande ne peut augmenter le budget.
import { getDb, getSetting, setSetting, logEvent } from './db.js';
import { config } from './config.js';
import { budgetStatus } from './budget.js';
import { prepareDay } from './pipeline/produce.js';
import { importSeries, addTopic, research } from './pipeline/research.js';
import { weeklyReport } from './pipeline/analytics.js';
import { isPaused } from './pipeline/publish.js';
import { localNow, addDays } from './time.js';
import { generate, parseJson } from './llm.js';
import * as tiktok from './adapters/tiktok.js';

export const COMMANDS = {
  status: {
    description: "État général de l'agent : publications, file d'attente, budget, santé.",
    params: {},
    run: () => {
      const db = getDb();
      const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM videos GROUP BY status').all().map(r => [r.status, r.n]));
      return {
        publishing_paused: isPaused(), publish_mode: config.publish.mode, llm_provider: config.llm.provider,
        tiktok_connected: tiktok.isConnected(), videos: counts,
        next: db.prepare("SELECT id, title, scheduled_at FROM videos WHERE status = 'scheduled' ORDER BY scheduled_at LIMIT 5").all(),
        topics_available: db.prepare("SELECT COUNT(*) AS n FROM topics WHERE status = 'new'").get().n,
        budget: budgetStatus(), heartbeat: getSetting('scheduler.heartbeat'),
      };
    },
  },
  prepare_videos: {
    description: "Prépare (script + montage + planification) les vidéos d'un jour. Par défaut : demain.",
    params: { date: 'AAAA-MM-JJ (optionnel)', series: 'nom de série (optionnel)' },
    run: ({ date, series } = {}) => prepareDay(date || addDays(localNow().date, 1), { series }),
  },
  explain_failures: {
    description: 'Explique les échecs récents (publication ou production) avec les messages d’erreur.',
    params: { since_hours: 'nombre (défaut 24)' },
    run: ({ since_hours = 24 } = {}) => {
      const since = new Date(Date.now() - since_hours * 3600_000).toISOString();
      const db = getDb();
      return {
        failed_videos: db.prepare("SELECT id, title, status, error, attempts, scheduled_at FROM videos WHERE error IS NOT NULL AND updated_at >= ?").all(since),
        errors: db.prepare("SELECT ts, source, message FROM events WHERE level = 'error' AND ts >= ? ORDER BY ts DESC LIMIT 20").all(since),
      };
    },
  },
  weekly_report: { description: 'Analyse des performances des 7 derniers jours.', params: {}, run: () => weeklyReport() },
  plan_series: {
    description: 'Crée une série de sujets sur un thème (ex. « moteurs V12 »). Utilise la bibliothèque gratuite, ou l’IA si un budget est ouvert.',
    params: { theme: 'texte', count: 'nombre (défaut 5)' },
    run: async ({ theme, count = 5 }) => {
      if (!theme) throw new Error('Paramètre « theme » requis.');
      const db = getDb();
      const existing = db.prepare("SELECT title FROM topics WHERE status = 'new' AND (series LIKE ? OR title LIKE ?)").all(`%${theme}%`, `%${theme}%`);
      const text = await generate({
        purpose: 'plan_series',
        system: 'Tu planifies des séries TikTok automobiles francophones. Faits vérifiables uniquement. Réponds en JSON.',
        prompt: `Thème : ${theme}\nNombre d'épisodes : ${count}\nFormat : [{"title":"...","facts":["...","...","..."],"hashtags":["..."]}]`,
        maxTokens: 4000,
      });
      const items = parseJson(text) ?? [];
      let added = 0;
      for (const t of items) if (t?.title && addTopic({ ...t, series: theme, source: 'ai', score: 1 })) added++;
      return {
        theme, added_by_ai: added, already_available: existing.map(e => e.title),
        note: added ? null : "Aucun budget IA ouvert : demandez à Claude Code d'écrire les fiches de la série puis `agentctl import`, ou utilisez import_series.",
      };
    },
  },
  import_series: {
    description: 'Importe des fiches de série déjà rédigées (JSON { series: [{ series, topics: [{ title, facts, hashtags }] }] }).',
    params: { payload: 'objet JSON' },
    run: ({ payload }) => ({ added: importSeries(typeof payload === 'string' ? JSON.parse(payload) : payload) }),
  },
  run_research: { description: 'Lance une recherche de sujets maintenant.', params: {}, run: async () => ({ added: await research() }) },
  pending_messages: {
    description: 'Messages privés TikTok en attente.',
    params: {},
    run: () => ({
      available: false,
      reason: "TikTok n'offre pas d'API publique générale de lecture des messages privés pour ce type de compte. L'agent ne se connecte jamais avec votre mot de passe ni vos cookies. Consultez-les dans l'app TikTok, ou activez l'API Business Messaging si votre compte y devient éligible.",
    }),
  },
  pause_publishing: {
    description: 'Met en pause toutes les publications (la production continue).',
    params: {},
    run: () => { setSetting('publishing.paused', true); logEvent('warn', 'command', 'Publications en pause'); return { publishing_paused: true }; },
  },
  resume_publishing: {
    description: 'Reprend les publications.',
    params: {},
    run: () => { setSetting('publishing.paused', false); logEvent('info', 'command', 'Publications reprises'); return { publishing_paused: false }; },
  },
  budget_status: { description: 'Dépenses du mois, plafond et reste (lecture seule).', params: {}, run: () => budgetStatus() },
};

export async function execute(name, params = {}, origin = 'api') {
  const cmd = COMMANDS[name];
  if (!cmd) throw new Error(`Commande inconnue ou non autorisée : ${name}`);
  logEvent('info', 'command', `${name} (depuis ${origin})`, params);
  return cmd.run(params);
}

// Compréhension simple des phrases françaises (sans IA, donc gratuite) pour le tableau de bord.
export function parseIntent(text) {
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/reprend|relance|reactive/.test(t) && /publi/.test(t)) return ['resume_publishing', {}];
  if (/pause|stop|suspend/.test(t)) return ['pause_publishing', {}];
  if (/pourquoi|echou|echec|erreur|rate/.test(t)) return ['explain_failures', { since_hours: /semaine/.test(t) ? 168 : 24 }];
  if (/perf|analyse|semaine|stat/.test(t)) return ['weekly_report', {}];
  if (/serie/.test(t)) { const m = t.match(/serie (?:sur |de )?(?:les |la |le |l')?(.+)$/); return ['plan_series', { theme: m ? m[1].trim() : t }]; }
  if (/message|dm|prive/.test(t)) return ['pending_messages', {}];
  if (/budget|depense|cout/.test(t)) return ['budget_status', {}];
  if (/prepar|video/.test(t)) return ['prepare_videos', { date: /aujourd/.test(t) ? localNow().date : undefined }];
  if (/recherch|sujet/.test(t)) return ['run_research', {}];
  return ['status', {}];
}
