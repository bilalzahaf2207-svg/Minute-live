#!/usr/bin/env node
// Réencode les AVIF/WebP depuis les PNG de .render-tmp (sans refaire le rendu 3D).
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(ROOT, '.render-tmp'); const OUT = path.join(ROOT, 'public/img/renders');
for (const f of fs.readdirSync(TMP).filter((x) => x.endsWith('.png'))) {
  const name = f.slice(0, -4);
  const widths = fs.readdirSync(OUT).filter((x) => x.startsWith(name + '-') && x.endsWith('.jpg')).map((x) => +x.slice(name.length + 1, -4)).filter(Boolean);
  for (const w of widths) {
    const vf = `scale=${w}:-2:flags=lanczos`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(TMP, f), '-vf', `${vf},format=yuv420p`, '-c:v', 'libaom-av1', '-still-picture', '1', '-crf', '23', '-cpu-used', '6', path.join(OUT, `${name}-${w}.avif`)]);
  }
  console.log('✓', name);
}
