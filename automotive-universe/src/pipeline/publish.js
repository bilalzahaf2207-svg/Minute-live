// Planification et publication. PUBLISH_MODE=dry_run : rien ne part chez TikTok.
import { config } from '../config.js';
import { getDb, getSetting, now, logEvent } from '../db.js';
import { alert } from '../alerts.js';
import * as tiktok from '../adapters/tiktok.js';

const MAX_ATTEMPTS = 3;

export function isPaused() { return getSetting('publishing.paused', false); }

export async function publishDue() {
  if (isPaused()) return 0;
  const db = getDb();
  const due = db.prepare("SELECT * FROM videos WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 3").all(now());
  let done = 0;
  for (const v of due) {
    try {
      let remoteId = 'dry-run';
      if (config.publish.mode === 'live') remoteId = await tiktok.publishVideo(v.file, v.caption);
      else logEvent('info', 'publish', `[simulation] « ${v.title} » aurait été publiée`);
      db.prepare("UPDATE videos SET status = 'published', published_at = ?, remote_id = ?, error = NULL, updated_at = ? WHERE id = ?").run(now(), remoteId, now(), v.id);
      done++;
    } catch (e) {
      const attempts = v.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      const retryAt = new Date(Date.now() + 15 * 60_000 * attempts).toISOString();
      db.prepare('UPDATE videos SET status = ?, attempts = ?, error = ?, scheduled_at = ?, updated_at = ? WHERE id = ?')
        .run(failed ? 'failed' : 'scheduled', attempts, e.message, failed ? v.scheduled_at : retryAt, now(), v.id);
      logEvent('error', 'publish', `« ${v.title} » : ${e.message}`, { video_id: v.id, attempts });
      if (failed) await alert('Publication échouée', `« ${v.title} » : ${e.message}`, 'high');
    }
  }
  return done;
}
