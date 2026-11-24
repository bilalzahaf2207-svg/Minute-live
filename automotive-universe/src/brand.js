// Identité du compte et direction artistique. Rien n'est figé tant que le propriétaire
// n'a pas validé (brand.confirmed = false → la production refuse de démarrer).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSetting, setSetting, logEvent } from './db.js';

const FONTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');
const f = (name) => path.join(FONTS, name);

// charW = largeur moyenne d'un caractère / taille de police (pour le retour à la ligne)
export const PRESETS = {
  atelier: {
    label: 'Atelier — technique et mécanique',
    bg: '0x0E0F11', text: '0xFFFFFF', accent: '0xE10600', muted: '0x9AA0A6',
    titleFont: f('Oswald-Bold.ttf'), titleSize: 112, titleCharW: 0.48, uppercaseTitle: true,
    bodyFont: f('Inter-SemiBold.otf'), bodySize: 62, bodyCharW: 0.56,
    align: 'left', box: false, accentBar: 'left', textColorOnBox: null,
  },
  showroom: {
    label: 'Showroom — premium, magazine',
    bg: '0x1A1C20', text: '0xF2EFE9', accent: '0xC8A96A', muted: '0x8E8A82',
    titleFont: f('InterDisplay-Black.otf'), titleSize: 96, titleCharW: 0.6, uppercaseTitle: false,
    bodyFont: f('Inter-Regular.otf'), bodySize: 60, bodyCharW: 0.55,
    align: 'center', box: false, accentBar: 'lines', textColorOnBox: null,
  },
  turbo: {
    label: 'Turbo — énergique, « le saviez-vous »',
    bg: '0x0A0A0A', text: '0x0A0A0A', accent: '0xFFD400', muted: '0xFFD400',
    titleFont: f('BebasNeue-Regular.ttf'), titleSize: 150, titleCharW: 0.42, uppercaseTitle: true,
    bodyFont: f('Oswald-Regular.ttf'), bodySize: 70, bodyCharW: 0.47,
    align: 'center', box: true, accentBar: 'none', textColorOnBox: '0x0A0A0A',
  },
};

const DEFAULT_BRAND = { name: 'Automotive Universe', handle: '@automotive.vision', preset: 'atelier', cta: 'Abonne-toi pour la suite', confirmed: false };

export function getBrand() { return { ...DEFAULT_BRAND, ...getSetting('brand', {}) }; }

export function setBrand(changes) {
  const next = { ...getBrand() };
  for (const k of ['name', 'handle', 'preset', 'cta']) if (changes[k] !== undefined) next[k] = String(changes[k]).slice(0, 60);
  if (!PRESETS[next.preset]) throw new Error(`Direction artistique inconnue : ${next.preset}. Choix : ${Object.keys(PRESETS).join(', ')}`);
  if (next.handle && !next.handle.startsWith('@')) next.handle = '@' + next.handle;
  // Toute modification invalide la confirmation : il faut revalider l'ensemble.
  next.confirmed = changes.confirm === true;
  setSetting('brand', next);
  logEvent('info', 'brand', `Identité ${next.confirmed ? 'validée' : 'modifiée (à valider)'} : ${next.name} ${next.handle}, DA ${next.preset}`);
  return next;
}
