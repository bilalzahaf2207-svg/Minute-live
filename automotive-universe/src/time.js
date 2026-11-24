// Heures locales (Europe/Paris par défaut) sans dépendance externe.
import { config } from './config.js';

function parts(ts, tz = config.tz) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  const o = Object.fromEntries(f.formatToParts(new Date(ts)).map(p => [p.type, p.value]));
  return o;
}

export function localNow(ts = Date.now()) {
  const p = parts(ts);
  return { date: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}`, weekday: p.weekday };
}

// "2026-11-25" + "19:00" heure locale → ISO UTC
export function localToUtcIso(date, hhmm) {
  const [y, m, d] = date.split('-').map(Number);
  const [H, M] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, H, M);
  const p = parts(guess);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(guess - (asUtc - guess)).toISOString();
}

export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
