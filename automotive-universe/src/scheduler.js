// Planificateur interne : tourne sur le serveur, indépendamment de Claude et de l'iPhone.
import { localNow } from './time.js';
import { getSetting, setSetting, logEvent } from './db.js';
import { alert } from './alerts.js';
import { research } from './pipeline/research.js';
import { prepareDay, maintainMemory } from './pipeline/produce.js';
import { publishDue } from './pipeline/publish.js';
import { collectMetrics, weeklyReport } from './pipeline/analytics.js';

// at = "HH:MM" heure locale (une fois par jour), every = minutes, day = jour de semaine
export const JOBS = [
  { name: 'research', at: '06:15', run: research },
  { name: 'prepare_tomorrow', at: '18:10', run: () => prepareDay() },
  { name: 'publish_due', every: 5, run: publishDue },
  { name: 'collect_metrics', at: '23:20', run: collectMetrics },
  { name: 'maintain_memory', at: '03:40', run: maintainMemory },
  { name: 'weekly_report', at: '08:05', day: 'Mon', run: async () => {
      const r = weeklyReport();
      await alert('Bilan de la semaine', `${r.published} publiée(s), ${r.failed} échec(s), ${r.total_views} vues.`);
      return r;
    } },
];

const running = new Set();

export async function runJob(job) {
  if (running.has(job.name)) return { skipped: 'déjà en cours' };
  running.add(job.name);
  const started = Date.now();
  try {
    const result = await job.run();
    setSetting(`job.${job.name}.last`, { ok: true, at: new Date().toISOString(), ms: Date.now() - started });
    return result;
  } catch (e) {
    setSetting(`job.${job.name}.last`, { ok: false, at: new Date().toISOString(), error: e.message });
    logEvent('error', `job:${job.name}`, e.message);
    await alert(`Tâche ${job.name} en erreur`, e.message, 'high');
    return { error: e.message };
  } finally { running.delete(job.name); }
}

export function tick(ts = Date.now()) {
  const { date, hhmm, weekday } = localNow(ts);
  const minutes = Math.floor(ts / 60000);
  for (const job of JOBS) {
    let due = false;
    if (job.every) due = minutes % job.every === 0;
    else if (job.at === hhmm && (!job.day || job.day === weekday)) {
      due = getSetting(`job.${job.name}.date`) !== date;
      if (due) setSetting(`job.${job.name}.date`, date);
    }
    if (due) runJob(job);
  }
}

export function startScheduler() {
  setSetting('scheduler.started_at', new Date().toISOString());
  const loop = () => { try { tick(); setSetting('scheduler.heartbeat', new Date().toISOString()); } catch (e) { logEvent('error', 'scheduler', e.message); } };
  loop();
  return setInterval(loop, 60_000);
}
