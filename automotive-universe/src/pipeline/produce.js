// Prépare les vidéos d'une journée : choix des sujets → script → montage → planification.
import { config } from '../config.js';
import { getDb, now, recall, logEvent } from '../db.js';
import { alert } from '../alerts.js';
import { localToUtcIso, localNow, addDays } from '../time.js';
import { writeScript } from './script.js';
import { renderVideo } from './render.js';

function pickTopics(n, series = null) {
  const db = getDb();
  const best = (recall('insights.best_series', []) ?? []).map(s => s.series);
  const rows = series
    ? db.prepare("SELECT * FROM topics WHERE status = 'new' AND series = ? ORDER BY id LIMIT ?").all(series, n)
    : db.prepare("SELECT * FROM topics WHERE status = 'new' ORDER BY score DESC, id LIMIT 50").all();
  rows.sort((a, b) => (best.indexOf(b.series) >= 0 ? 1 : 0) - (best.indexOf(a.series) >= 0 ? 1 : 0));
  return rows.slice(0, n);
}

export async function prepareDay(date = addDays(localNow().date, 1), { series = null } = {}) {
  const db = getDb();
  const slots = config.production.slots.slice(0, config.production.videosPerDay);
  const taken = new Set(db.prepare("SELECT scheduled_at FROM videos WHERE status IN ('scheduled','published') AND scheduled_at LIKE ?").all(`${date.slice(0, 7)}%`).map(r => r.scheduled_at));
  const freeSlots = slots.map(s => localToUtcIso(date, s)).filter(iso => !taken.has(iso));
  if (!freeSlots.length) return { date, created: [], message: 'Tous les créneaux de cette journée sont déjà remplis.' };

  const topics = pickTopics(freeSlots.length, series);
  if (topics.length < freeSlots.length) {
    await alert('Sujets insuffisants', `${topics.length}/${freeSlots.length} sujets disponibles pour le ${date}. Ajoutez une série ou ouvrez un budget IA.`);
  }
  const created = [];
  for (const [i, topic] of topics.entries()) {
    const ins = db.prepare("INSERT INTO videos(topic_id, title, status, created_at, updated_at) VALUES(?, ?, 'scripting', ?, ?)").run(topic.id, topic.title, now(), now());
    const id = Number(ins.lastInsertRowid);
    try {
      const script = await writeScript(topic);
      db.prepare("UPDATE videos SET script = ?, caption = ?, status = 'rendering', updated_at = ? WHERE id = ?").run(JSON.stringify(script), script.caption, now(), id);
      const file = await renderVideo(id, script);
      db.prepare("UPDATE videos SET file = ?, status = 'scheduled', scheduled_at = ?, updated_at = ? WHERE id = ?").run(file, freeSlots[i], now(), id);
      db.prepare("UPDATE topics SET status = 'used' WHERE id = ?").run(topic.id);
      created.push({ id, title: topic.title, scheduled_at: freeSlots[i] });
    } catch (e) {
      db.prepare("UPDATE videos SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(e.message, now(), id);
      logEvent('error', 'produce', `« ${topic.title} » : ${e.message}`, { video_id: id });
      await alert('Production échouée', `« ${topic.title} » : ${e.message}`, 'high');
    }
  }
  logEvent('info', 'produce', `${created.length} vidéo(s) prêtes pour le ${date}`);
  return { date, created };
}

// Maintenance de la mémoire : purge des journaux anciens et des fichiers publiés.
export function maintainMemory() {
  const db = getDb();
  const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString();
  const ev = db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff).changes;
  const old = db.prepare("SELECT id, file FROM videos WHERE status = 'published' AND published_at < ? AND file IS NOT NULL").all(new Date(Date.now() - 14 * 86400_000).toISOString());
  return { events_purged: ev, published_files_to_archive: old.length };
}
