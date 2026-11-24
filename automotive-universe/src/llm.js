// Routeur IA. Par défaut (LLM_PROVIDER=none) : aucun appel payant, renvoie null
// et l'appelant utilise ses modèles gratuits. Avec LLM_PROVIDER=anthropic : appel
// via l'API Anthropic (clé API facturée à part — PAS l'abonnement Claude Pro),
// uniquement après accord du garde-fou budgétaire.
import { config, PRICES_USD } from './config.js';
import { authorize, record, BudgetError } from './budget.js';
import { logEvent } from './db.js';

const SAFETY_MARGIN = 1.5; // couvre un éventuel modèle de repli plus cher
const approxTokens = (text) => Math.ceil(text.length / 3);

export function estimateEur(model, inputText, maxTokens) {
  const p = PRICES_USD[model];
  if (!p) throw new Error(`Tarif inconnu pour ${model} : ajoutez-le dans PRICES_USD.`);
  const usd = (approxTokens(inputText) * p.in + maxTokens * p.out) / 1e6;
  return usd * config.budget.usdToEur * SAFETY_MARGIN;
}

export async function generate({ purpose, system, prompt, maxTokens = 4000 }) {
  if (config.llm.provider !== 'anthropic') return null;
  const model = config.llm.model;
  try {
    authorize('anthropic', estimateEur(model, system + prompt, maxTokens), purpose);
  } catch (e) {
    if (e instanceof BudgetError) { logEvent('warn', 'llm', `${purpose} : ${e.message} → mode gratuit`); return null; }
    throw e;
  }

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const params = {
    model, max_tokens: maxTokens, system,
    output_config: { effort: config.llm.effort },
    messages: [{ role: 'user', content: prompt }],
  };
  let res;
  try {
    // Repli automatique côté serveur en cas de refus (Opus / Sonnet 5.5).
    res = model === 'claude-haiku-5-5'
      ? await client.messages.create(params)
      : await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) logEvent('warn', 'llm', `${purpose} : limite de débit, réessai au prochain cycle`);
    else if (err instanceof Anthropic.AuthenticationError) logEvent('error', 'llm', 'Clé API Anthropic invalide ou absente');
    else logEvent('error', 'llm', `${purpose} : ${err.message}`);
    return null;
  }

  const p = PRICES_USD[res.model] ?? PRICES_USD[model];
  const u = res.usage;
  const inputTokens = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const eur = ((inputTokens * p.in + u.output_tokens * p.out) / 1e6) * config.budget.usdToEur;
  record('anthropic', eur, purpose, { model: res.model, in: inputTokens, out: u.output_tokens });

  if (res.stop_reason === 'refusal') { logEvent('warn', 'llm', `${purpose} : requête refusée par le modèle`); return null; }
  return res.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// Extrait un objet JSON d'une réponse texte (le prompt demande du JSON pur).
export function parseJson(text) {
  if (!text) return null;
  const m = text.match(/[\[{][\s\S]*[\]}]/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}
