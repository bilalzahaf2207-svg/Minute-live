// Analyse des performances (gratuit : API TikTok + calculs locaux) et mémoire apprise.
import { config } from '../config.js';
import { getDb, now, remember, logEvent } from '../db.js';
import * as tiktok from '../adapters/tiktok.js';

export async function collectMetrics() {
  if (config.publish.mode !== 'live' || !tiktok.isConnected()) return 0;
  const db = getDb();
  let n = 0;
  for (const s of await tiktok.listVideoStats()) {
    const v = db.prepare('SELECT id FROM videos WHERE remote_id = ? OR title = ?').get(s.id, s.title);
    if (!v) continue;
    db.prepare('INSERT INTO metrics(video_id, ts, views, likes, comments, shares) VALUES(?, ?, ?, ?, ?, ?)')
      .run(v.id, now(), s.view_count, s.like_count, s.comment_count, s.share_count);
    n++;
  }
  logEvent('info', 'analytics', `${n} vidéo(s) mises à jour`);
  learn();
  return n;
}

// Retient les créneaux et séries qui marchent le mieux (utilisés pour planifier).
export function learn() {
  const db = getDb();
  const bySlot = db.prepare(`SELECT substr(v.scheduled_at, 12, 5) AS slot, AVG(m.views) AS views FROM videos v
    JOIN (SELECT video_id, MAX(views) AS views FROM metrics GROUP BY video_id) m ON m.video_id = v.id GROUP BY slot ORDER BY views DESC`).all();
  const bySeries = db.prepare(`SELECT t.series, AVG(m.views) AS views FROM videos v JOIN topics t ON t.id = v.topic_id
    JOIN (SELECT video_id, MAX(views) AS views FROM metrics GROUP BY video_id) m ON m.video_id = v.id GROUP BY t.series ORDER BY views DESC`).all();
  remember('insights.best_slots_utc', bySlot);
  remember('insights.best_series', bySeries);
}

export function weeklyReport() {
  const db = getDb();
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const videos = db.prepare(`SELECT v.id, v.title, v.status, v.published_at,
      (SELECT MAX(views) FROM metrics WHERE video_id = v.id) AS views,
      (SELECT MAX(likes) FROM metrics WHERE video_id = v.id) AS likes,
      (SELECT MAX(shares) FROM metrics WHERE video_id = v.id) AS shares
    FROM videos v WHERE v.created_at >= ? ORDER BY views DESC`).all(since);
  const published = videos.filter(v => v.status === 'published');
  return {
    period: `${since.slice(0, 10)} → ${now().slice(0, 10)}`,
    produced: videos.length, published: published.length,
    failed: videos.filter(v => v.status === 'failed').length,
    total_views: published.reduce((a, v) => a + (v.views ?? 0), 0),
    top: published.slice(0, 3),
    note: config.publish.mode === 'live' ? null : 'Mode simulation : aucune statistique TikTok réelle.',
  };
}
