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
import path from 'node:path';
import { pendingApprovals, approve, reject, editScript, gates, mediaUrl } from './approvals.js';
import { getBrand, setBrand, PRESETS } from './brand.js';
import { renderPreview } from './pipeline/render.js';

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
        brand: getBrand(), approval_steps: gates(), awaiting_approval: pendingApprovals().total,
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

  pending_approvals: {
    description: 'Liste tout ce qui attend votre accord : sujets proposés, scripts, vidéos (avec lien de visionnage), publications.',
    params: {},
    run: () => pendingApprovals(),
  },
  approve: {
    description: "Valide UNE étape. kind = topic (id ou ids), series (series), ou video (id : valide l'étape où elle se trouve : script, vidéo ou publication). N'appeler que sur instruction explicite du propriétaire.",
    params: { kind: 'topic | series | video', id: 'nombre', ids: 'liste', series: 'nom' },
    run: (p) => approve(p),
  },
  reject: {
    description: 'Refuse un sujet ou une vidéo avec un motif. Une vidéo refusée revient à l’étape script.',
    params: { kind: 'topic | video', id: 'nombre', reason: 'texte' },
    run: (p) => reject(p),
  },
  edit_script: {
    description: "Modifie le texte des scènes et/ou la légende d'une vidéo en attente de validation du script.",
    params: { id: 'nombre', scenes: 'liste de phrases', caption: 'texte' },
    run: (p) => editScript(p),
  },
  get_brand: {
    description: 'Identité du compte (nom, @, direction artistique) et directions artistiques disponibles.',
    params: {},
    run: () => ({ brand: getBrand(), presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.label])) }),
  },
  set_brand: {
    description: "Propose une identité (nom, @, direction artistique, phrase d'appel) et renvoie un aperçu. Ne valide PAS : la validation se fait ensuite avec confirm_brand.",
    params: { name: 'texte', handle: '@...', preset: 'atelier | showroom | turbo', cta: 'texte' },
    run: async (p) => {
      const brand = setBrand({ ...p, confirm: false });
      await renderPreview(brand, { series: 'Moteurs V12 · épisode 1', title: 'Pourquoi un V12 tourne si doucement', fact: 'Une explosion tous les 60° de vilebrequin : la poussée ne s’interrompt jamais.' }, path.join(config.dataDir, 'out', 'preview.png'));
      return { brand, preview: mediaUrl('preview', 'png', 1), next: 'Regardez l’aperçu, puis confirm_brand pour valider.' };
    },
  },
  confirm_brand: {
    description: "Valide définitivement l'identité actuelle (nom, @, direction artistique). Sans cette validation, aucune vidéo n'est produite. N'appeler que sur instruction explicite du propriétaire.",
    params: {},
    run: () => setBrand({ ...getBrand(), confirm: true }),
  },
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
  if (/a valider|en attente de valid|validation|approuv/.test(t)) return ['pending_approvals', {}];
  if (/pourquoi|echou|echec|erreur|rate/.test(t)) return ['explain_failures', { since_hours: /semaine/.test(t) ? 168 : 24 }];
  if (/perf|analyse|semaine|stat/.test(t)) return ['weekly_report', {}];
  if (/serie/.test(t)) { const m = t.match(/serie (?:sur |de )?(?:les |la |le |l')?(.+)$/); return ['plan_series', { theme: m ? m[1].trim() : t }]; }
  if (/message|dm|prive/.test(t)) return ['pending_messages', {}];
  if (/budget|depense|cout/.test(t)) return ['budget_status', {}];
  if (/prepar|video/.test(t)) return ['prepare_videos', { date: /aujourd/.test(t) ? localNow().date : undefined }];
  if (/recherch|sujet/.test(t)) return ['run_research', {}];
  return ['status', {}];
}
