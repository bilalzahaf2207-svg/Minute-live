// Alertes vers l'iPhone : ntfy (application gratuite) et/ou un webhook générique.
import { config } from './config.js';
import { logEvent } from './db.js';

export async function alert(title, message, priority = 'default') {
  logEvent(priority === 'high' ? 'warn' : 'info', 'alert', `${title} — ${message}`);
  const tasks = [];
  if (config.alerts.ntfyUrl) {
    tasks.push(fetch(config.alerts.ntfyUrl, {
      method: 'POST', body: message,
      headers: { Title: encodeURIComponent(title), Priority: priority === 'high' ? '4' : '3' },
    }));
  }
  if (config.alerts.webhookUrl) {
    tasks.push(fetch(config.alerts.webhookUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, message, priority }),
    }));
  }
  const results = await Promise.allSettled(tasks);
  for (const r of results) if (r.status === 'rejected') logEvent('error', 'alert', `envoi impossible : ${r.reason?.message}`);
}
