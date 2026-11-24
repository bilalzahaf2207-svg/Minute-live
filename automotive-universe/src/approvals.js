// Circuit de validation : rien ne passe à l'étape suivante sans l'accord du propriétaire.
//   Sujet   proposed → new            (approve topic / series)
//   Script  script_review → rendering → video_review
//   Vidéo   video_review → publish_review
//   Publication publish_review → scheduled → published
// Chaque étape peut être désactivée (settings approval.gates), mais toutes sont actives par défaut.
import crypto from 'node:crypto';
import { config } from './config.js';
import { getDb, getSetting, setSetting, now, logEvent } from './db.js';
import { alert } from './alerts.js';
import { getBrand } from './brand.js';
import { renderVideo } from './pipeline/render.js';

export const ALL_GATES = ['topic', 'script', 'video', 'publish'];
export const gates = () => getSetting('approval.gates', ALL_GATES);
export const gateOn = (g) => gates().includes(g);

export function setGates(list) {
  const clean = list.filter(g => ALL_GATES.includes(g));
  setSetting('approval.gates', clean);
  logEvent('warn', 'approvals', `Étapes à valider : ${clean.join(', ') || 'aucune'}`);
  return clean;
}

// Lien de visionnage signé (valable 7 jours) — utilisable dans l'app Claude ou Safari.
export function mediaUrl(videoId, ext = 'mp4', days = 7) {
  const exp = Date.now() + days * 86400_000;
  const sig = crypto.createHmac('sha256', config.adminToken || 'dev').update(`${videoId}.${exp}`).digest('hex').slice(0, 32);
  return `${config.publicUrl}/media/${videoId}.${ext}?exp=${exp}&sig=${sig}`;
}
export function checkMediaSig(videoId, exp, sig) {
  if (!exp || Number(exp) < Date.now() || !sig) return false;
  const good = crypto.createHmac('sha256', config.adminToken || 'dev').update(`${videoId}.${exp}`).digest('hex').slice(0, 32);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}

export function pendingApprovals() {
  const db = getDb();
  const topics = db.prepare("SELECT id, title, series, source, facts FROM topics WHERE status = 'proposed' ORDER BY id").all()
    .map(t => ({ ...t, facts: JSON.parse(t.facts || '{}').facts ?? [] }));
  const videos = db.prepare("SELECT id, title, status, script, caption, planned_at, feedback FROM videos WHERE status IN ('script_review','video_review','publish_review') ORDER BY planned_at").all()
    .map(v => ({
      id: v.id, title: v.title, step: { script_review: 'script', video_review: 'vidéo', publish_review: 'publication' }[v.status],
      planned_at: v.planned_at, caption: v.caption, feedback: v.feedback,
      scenes: JSON.parse(v.script || '{}').scenes?.map(s => s.text),
      watch: v.status === 'script_review' ? null : mediaUrl(v.id),
      publish_as: v.status === 'publish_review' ? { account: getBrand().handle, visibility: config.publish.privacy, mode: config.publish.mode } : undefined,
    }));
  return { topics, videos, total: topics.length + videos.length, brand_confirmed: getBrand().confirmed };
}

export async function notifyPending(reason) {
  const p = pendingApprovals();
  if (p.total) await alert('Validation requise', `${reason} — ${p.total} élément(s) en attente de votre accord.`);
}

function getVideo(id) {
  const v = getDb().prepare('SELECT * FROM videos WHERE id = ?').get(Number(id));
  if (!v) throw new Error(`Vidéo ${id} introuvable.`);
  return v;
}

function nextFreeSlotAfter(iso) {
  // Si le créneau prévu est passé au moment de l'accord, on prend le créneau suivant (+ 24 h).
  let t = new Date(iso).getTime();
  while (t < Date.now() + 10 * 60_000) t += 86400_000;
  return new Date(t).toISOString();
}

async function advanceAfterScript(v) {
  const db = getDb();
  db.prepare("UPDATE videos SET status = 'rendering', updated_at = ? WHERE id = ?").run(now(), v.id);
  const topic = db.prepare('SELECT series FROM topics WHERE id = ?').get(v.topic_id);
  try {
    const file = await renderVideo(v.id, JSON.parse(v.script), { series: topic?.series });
    db.prepare('UPDATE videos SET file = ?, updated_at = ? WHERE id = ?').run(file, now(), v.id);
  } catch (e) {
    db.prepare("UPDATE videos SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(e.message, now(), v.id);
    throw e;
  }
  return gateOn('video') ? setStatus(v.id, 'video_review') : advanceAfterVideo(getVideo(v.id));
}
function advanceAfterVideo(v) {
  return gateOn('publish') ? setStatus(v.id, 'publish_review') : schedule(v);
}
function schedule(v) {
  const at = nextFreeSlotAfter(v.planned_at);
  getDb().prepare("UPDATE videos SET status = 'scheduled', scheduled_at = ?, updated_at = ? WHERE id = ?").run(at, now(), v.id);
  return { id: v.id, status: 'scheduled', scheduled_at: at };
}
function setStatus(id, status) {
  getDb().prepare('UPDATE videos SET status = ?, feedback = NULL, updated_at = ? WHERE id = ?').run(status, now(), id);
  return { id, status };
}

// Point d'entrée unique pour la progression d'un élément déjà existant (gates désactivées incluses).
export async function startPipeline(videoId) {
  const v = getVideo(videoId);
  return gateOn('script') ? setStatus(v.id, 'script_review') : advanceAfterScript(v);
}

export async function approve({ kind, id, series, ids }) {
  const db = getDb();
  const stamp = now();
  if (kind === 'series') {
    const n = db.prepare("UPDATE topics SET status = 'new' WHERE status = 'proposed' AND series = ?").run(series).changes;
    logEvent('info', 'approvals', `Série « ${series} » validée (${n} sujets)`);
    return { approved_topics: n };
  }
  if (kind === 'topic') {
    const list = ids ?? [id];
    let n = 0;
    for (const t of list) n += db.prepare("UPDATE topics SET status = 'new' WHERE status = 'proposed' AND id = ?").run(Number(t)).changes;
    logEvent('info', 'approvals', `${n} sujet(s) validé(s)`);
    return { approved_topics: n };
  }
  const v = getVideo(id);
  let result;
  if (v.status === 'script_review') {
    db.prepare('UPDATE videos SET approved_script_at = ? WHERE id = ?').run(stamp, v.id);
    result = await advanceAfterScript(v);
  } else if (v.status === 'video_review') {
    db.prepare('UPDATE videos SET approved_video_at = ? WHERE id = ?').run(stamp, v.id);
    result = advanceAfterVideo(v);
  } else if (v.status === 'publish_review') {
    db.prepare('UPDATE videos SET approved_publish_at = ? WHERE id = ?').run(stamp, v.id);
    result = schedule(v);
  } else throw new Error(`La vidéo ${v.id} n'attend pas de validation (état : ${v.status}).`);
  logEvent('info', 'approvals', `« ${v.title} » validée à l'étape ${v.status}`);
  if (result.status !== 'scheduled') await notifyPending(`« ${v.title} » est prête pour l'étape suivante`);
  return result;
}

export function reject({ kind, id, reason = '' }) {
  const db = getDb();
  if (kind === 'topic') {
    db.prepare("UPDATE topics SET status = 'rejected' WHERE id = ?").run(Number(id));
    return { id, status: 'rejected' };
  }
  const v = getVideo(id);
  if (!['script_review', 'video_review', 'publish_review', 'scheduled'].includes(v.status)) throw new Error(`Rien à refuser pour la vidéo ${v.id} (état : ${v.status}).`);
  // Un refus renvoie toujours au script : vous corrigez (ou demandez une correction), puis revalidez tout.
  db.prepare("UPDATE videos SET status = 'script_review', feedback = ?, scheduled_at = NULL, approved_script_at = NULL, approved_video_at = NULL, approved_publish_at = NULL, updated_at = ? WHERE id = ?")
    .run(reason || 'Refusé sans commentaire', now(), v.id);
  logEvent('warn', 'approvals', `« ${v.title} » refusée : ${reason}`);
  return { id: v.id, status: 'script_review', feedback: reason };
}

export function editScript({ id, scenes, caption }) {
  const v = getVideo(id);
  if (v.status !== 'script_review') throw new Error('Le script ne peut être modifié qu’à l’étape de validation du script (refusez d’abord la vidéo).');
  const script = JSON.parse(v.script || '{}');
  if (Array.isArray(scenes) && scenes.length) script.scenes = scenes.map(s => typeof s === 'string' ? { text: s, seconds: 4 } : s).slice(0, 10);
  if (caption) script.caption = String(caption).slice(0, 2200);
  getDb().prepare('UPDATE videos SET script = ?, caption = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(script), script.caption, now(), v.id);
  return { id: v.id, scenes: script.scenes.map(s => s.text), caption: script.caption };
}
