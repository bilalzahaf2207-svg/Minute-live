// Configuration lue une seule fois depuis l'environnement (et .env s'il existe).
import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv(path.resolve('.env'));

const env = (k, d = '') => (process.env[k] ?? '') === '' ? d : process.env[k];
const num = (k, d) => Number(env(k, String(d)));
const list = (k, d = '') => env(k, d).split(',').map(s => s.trim()).filter(Boolean);

export const config = {
  port: num('PORT', 8080),
  tz: env('TZ_AGENT', 'Europe/Paris'),
  dataDir: path.resolve(env('DATA_DIR', './data')),
  adminToken: env('ADMIN_TOKEN'),
  mcpPathSecret: env('MCP_PATH_SECRET'),

  budget: {
    monthlyEur: num('BUDGET_MONTHLY_EUR', 0),
    thresholds: list('BUDGET_ALERT_THRESHOLDS', '0.5,0.8,1').map(Number),
    usdToEur: num('USD_TO_EUR', 0.93),
  },

  llm: {
    provider: env('LLM_PROVIDER', 'none'),
    model: env('ANTHROPIC_MODEL', 'claude-opus-5-5'),
    effort: env('ANTHROPIC_EFFORT', 'low'),
  },

  publish: {
    mode: env('PUBLISH_MODE', 'dry_run'),
    privacy: env('TIKTOK_PRIVACY', 'SELF_ONLY'),
    tiktokClientKey: env('TIKTOK_CLIENT_KEY'),
    tiktokClientSecret: env('TIKTOK_CLIENT_SECRET'),
  },

  production: {
    videosPerDay: num('VIDEOS_PER_DAY', 2),
    slots: list('PUBLISH_SLOTS', '12:30,19:00'),
    rssFeeds: list('RSS_FEEDS'),
    ttsCmd: env('TTS_CMD'),
  },

  alerts: {
    ntfyUrl: env('ALERT_NTFY_URL'),
    webhookUrl: env('ALERT_WEBHOOK_URL'),
  },
};

// Tarifs API Anthropic (USD par million de jetons) — à tenir à jour.
export const PRICES_USD = {
  'claude-opus-5-5': { in: 4.0, out: 20.0 },
  'claude-sonnet-5-5': { in: 2.0, out: 10.0 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5 },
};
