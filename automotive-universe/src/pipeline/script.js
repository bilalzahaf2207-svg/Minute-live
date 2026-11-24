// Écriture du script vidéo : modèle gratuit à partir des faits, ou IA si budget ouvert.
import { generate, parseJson } from '../llm.js';

export function templateScript(topic) {
  const { facts = [], hashtags = [] } = JSON.parse(topic.facts || '{}');
  const scenes = [
    { text: topic.title, seconds: 3 },
    ...facts.slice(0, 4).map(f => ({ text: f, seconds: 5 })),
    { text: 'Abonne-toi pour la suite 🔧', seconds: 3 },
  ];
  const tags = ['automotiveuniverse', ...hashtags].map(h => `#${h.replace(/^#/, '')}`).join(' ');
  return { scenes, caption: `${topic.title} ${tags}`.slice(0, 2200), aiGenerated: false };
}

export async function writeScript(topic) {
  const base = templateScript(topic);
  const text = await generate({
    purpose: 'script',
    system: 'Tu écris des scripts TikTok automobiles de 20 à 35 secondes, en français, factuels, sans exagération. Réponds uniquement en JSON.',
    prompt: `Sujet : ${topic.title}\nFaits vérifiés : ${topic.facts}\nFormat : {"scenes":[{"text":"phrase courte à l'écran","seconds":4}],"caption":"légende avec hashtags"}`,
    maxTokens: 3000,
  });
  const ai = parseJson(text);
  if (ai?.scenes?.length) return { scenes: ai.scenes.slice(0, 8), caption: String(ai.caption ?? base.caption).slice(0, 2200), aiGenerated: true };
  return base;
}
