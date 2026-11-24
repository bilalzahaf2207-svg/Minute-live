// Garde-fou de dépenses : toute action payante passe par authorize() AVANT l'appel.
// Plafond mensuel 0 => aucune dépense possible. Le plafond ne se modifie que par
// le propriétaire (variable d'environnement ou tableau de bord avec confirmation),
// jamais par l'agent ni par le connecteur Claude.
import { config } from './config.js';
import { getDb, getSetting, setSetting, now, logEvent } from './db.js';
import { alert } from './alerts.js';

export class BudgetError extends Error {}

const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

export function monthlyCap() {
  return getSetting('budget.monthly_eur', config.budget.monthlyEur);
}

export function spentThisMonth() {
  const row = getDb().prepare("SELECT COALESCE(SUM(amount_eur), 0) AS s FROM spend WHERE substr(ts, 1, 7) = ?").get(monthKey());
  return row.s;
}

export function budgetStatus() {
  const cap = monthlyCap(), spent = spentThisMonth();
  const byProvider = getDb().prepare("SELECT provider, ROUND(SUM(amount_eur), 4) AS eur FROM spend WHERE substr(ts, 1, 7) = ? GROUP BY provider").all(monthKey());
  return { month: monthKey(), cap_eur: cap, spent_eur: Number(spent.toFixed(4)), remaining_eur: Number(Math.max(0, cap - spent).toFixed(4)), by_provider: byProvider, paid_actions_frozen: getSetting('budget.frozen', false) };
}

// Vérifie qu'une dépense estimée (pire cas) tient dans le budget restant.
export function authorize(provider, estimateEur, purpose) {
  const cap = monthlyCap();
  if (getSetting('budget.frozen', false)) throw new BudgetError('Dépenses gelées par le propriétaire.');
  if (cap <= 0) throw new BudgetError('Budget mensuel à 0 € : aucune dépense autorisée. Le propriétaire doit fixer un plafond.');
  const spent = spentThisMonth();
  if (spent + estimateEur > cap) {
    alert('Budget atteint', `Action « ${purpose} » refusée : ${spent.toFixed(2)} € dépensés sur ${cap} € ce mois-ci.`, 'high');
    throw new BudgetError(`Plafond mensuel atteint (${spent.toFixed(2)} / ${cap} €).`);
  }
  return { provider, estimateEur, purpose };
}

export function record(provider, amountEur, purpose, detail = null) {
  getDb().prepare('INSERT INTO spend(ts, provider, purpose, amount_eur, detail) VALUES(?, ?, ?, ?, ?)')
    .run(now(), provider, purpose, amountEur, detail ? JSON.stringify(detail) : null);
  checkThresholds();
}

function checkThresholds() {
  const cap = monthlyCap();
  if (cap <= 0) return;
  const ratio = spentThisMonth() / cap;
  const sent = getSetting(`budget.alerts.${monthKey()}`, []);
  for (const t of config.budget.thresholds) {
    if (ratio >= t && !sent.includes(t)) {
      sent.push(t);
      alert('Alerte budget', `${Math.round(t * 100)} % du budget mensuel consommé (${spentThisMonth().toFixed(2)} / ${cap} €).`, t >= 1 ? 'high' : 'default');
    }
  }
  setSetting(`budget.alerts.${monthKey()}`, sent);
}

// Réservé au propriétaire : appelé uniquement depuis la route admin avec confirmation explicite.
export function ownerSetCap(eur, confirmation) {
  if (confirmation !== `JE CONFIRME ${eur} EUR`) throw new BudgetError(`Confirmation requise : tapez exactement « JE CONFIRME ${eur} EUR ».`);
  setSetting('budget.monthly_eur', Number(eur));
  logEvent('warn', 'budget', `Plafond mensuel modifié par le propriétaire : ${eur} €`);
  return budgetStatus();
}
export function ownerFreeze(frozen) {
  setSetting('budget.frozen', Boolean(frozen));
  logEvent('warn', 'budget', frozen ? 'Dépenses gelées' : 'Dépenses dégelées');
  return budgetStatus();
}
