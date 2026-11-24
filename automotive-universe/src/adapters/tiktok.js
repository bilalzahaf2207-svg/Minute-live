// Adaptateur TikTok officiel (Content Posting API + Display API), via OAuth.
// Aucun mot de passe ni cookie : le propriétaire autorise l'application une fois
// (/oauth/tiktok/start), l'agent ne conserve que les jetons OAuth révocables.
// Points à confirmer à l'activation (la documentation TikTok évolue) :
//  - sans audit de l'application, publication en privé (SELF_ONLY) uniquement ;
//  - quota quotidien de publications par compte ;
//  - aucune API publique générale pour lire les messages privés.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logEvent } from '../db.js';

const API = 'https://open.tiktokapis.com/v2';
const tokenFile = () => path.join(config.dataDir, 'tokens.json');

export const SCOPES = 'user.info.basic,video.publish,video.list';

export function authorizeUrl(redirectUri, state) {
  const q = new URLSearchParams({ client_key: config.publish.tiktokClientKey, scope: SCOPES, response_type: 'code', redirect_uri: redirectUri, state });
  return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
}

async function tokenRequest(body) {
  const res = await fetch(`${API}/oauth/token/`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: config.publish.tiktokClientKey, client_secret: config.publish.tiktokClientSecret, ...body }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`OAuth TikTok : ${json.error_description || json.error || res.status}`);
  const tokens = { ...json, obtained_at: Date.now() };
  fs.writeFileSync(tokenFile(), JSON.stringify(tokens), { mode: 0o600 });
  return tokens;
}

export const exchangeCode = (code, redirectUri) => tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri });

export function isConnected() { return fs.existsSync(tokenFile()); }

async function accessToken() {
  if (!isConnected()) throw new Error('Compte TikTok non connecté (ouvrir /oauth/tiktok/start).');
  let t = JSON.parse(fs.readFileSync(tokenFile(), 'utf8'));
  if (Date.now() > t.obtained_at + (t.expires_in - 300) * 1000) t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  return t.access_token;
}

async function call(pathname, body) {
  const res = await fetch(`${API}${pathname}`, {
    method: 'POST', headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json();
  if (json.error?.code && json.error.code !== 'ok') throw new Error(`TikTok ${pathname} : ${json.error.code} — ${json.error.message}`);
  return json.data;
}

export async function publishVideo(file, caption) {
  const creator = await call('/post/publish/creator_info/query/');
  const privacy = creator.privacy_level_options?.includes(config.publish.privacy) ? config.publish.privacy : 'SELF_ONLY';
  const size = fs.statSync(file).size;
  const init = await call('/post/publish/video/init/', {
    post_info: { title: caption, privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false, is_aigc: false },
    source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 },
  });
  const up = await fetch(init.upload_url, {
    method: 'PUT', body: fs.readFileSync(file),
    headers: { 'content-type': 'video/mp4', 'content-range': `bytes 0-${size - 1}/${size}` },
  });
  if (!up.ok) throw new Error(`Envoi du fichier refusé : HTTP ${up.status}`);
  logEvent('info', 'tiktok', `Vidéo envoyée (publish_id ${init.publish_id}, visibilité ${privacy})`);
  return init.publish_id;
}

export async function publishStatus(publishId) {
  return call('/post/publish/status/fetch/', { publish_id: publishId });
}

export async function listVideoStats() {
  const fields = 'id,title,create_time,view_count,like_count,comment_count,share_count';
  const res = await fetch(`${API}/video/list/?fields=${fields}`, {
    method: 'POST', headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ max_count: 20 }),
  });
  const json = await res.json();
  return json.data?.videos ?? [];
}
