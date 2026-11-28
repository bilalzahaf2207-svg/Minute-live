#!/usr/bin/env node
/**
 * Génère les visuels du site à partir du modèle 3D (Chromium headless + ffmpeg).
 *   node tools/render-images.mjs            → tous les plans
 *   node tools/render-images.mjs hero macro → plans dont le nom contient « hero » ou « macro »
 * Sortie : public/img/renders/<plan>-<largeur>.{avif,webp,jpg}
 */
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/img/renders');
const TMP = path.join(ROOT, '.render-tmp');
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(TMP, { recursive: true });

const SIZES = {
  default: { w: 1600, h: 2000, widths: [640, 1000, 1600] },          // 4:5 portrait
  wide:    { w: 2400, h: 1350, widths: [800, 1400, 2400] },          // 16:9
  square:  { w: 1600, h: 1600, widths: [600, 1000, 1600] }
};
const FORMAT = (n) => (n.startsWith('interior') || n === 'hero' ? 'wide' : n.startsWith('macro') || n === 'studio-top' ? 'square' : 'default');
const SS = 1.5; // suréchantillonnage (anticrénelage)

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f;
  if (u.startsWith('/vendor/three/')) f = path.join(ROOT, 'node_modules/three', u.slice('/vendor/three/'.length));
  else if (u.startsWith('/tools/')) f = path.join(ROOT, u);
  else f = path.join(ROOT, 'public', u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, r));
const port = srv.address().port;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/tools/render.html`);
await page.waitForFunction(() => window.READY === true, null, { timeout: 60000 });
const names = await page.evaluate(() => window.SHOT_NAMES);
const filters = process.argv.slice(2);
const todo = filters.length ? names.filter((n) => filters.some((f) => n.includes(f))) : names;

for (const name of todo) {
  const fmt = SIZES[FORMAT(name)];
  let { w, h } = fmt;
  if (name === 'hero-portrait') { w = 1000; h = 2000; }
  const t0 = Date.now();
  const url = await page.evaluate(([n, W, H]) => window.renderShot(n, W, H), [name, Math.round(w * SS), Math.round(h * SS)]);
  const png = path.join(TMP, `${name}.png`);
  fs.writeFileSync(png, Buffer.from(url.split(',')[1], 'base64'));
  const widths = name === 'hero-portrait' ? [500, 750, 1000] : fmt.widths;
  for (const width of widths) {
    const base = path.join(OUT, `${name}-${width}`);
    const vf = `scale=${width}:-2:flags=lanczos`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-vf', vf, '-q:v', '3', `${base}.jpg`]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-vf', vf, '-c:v', 'libwebp', '-quality', '80', `${base}.webp`]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-vf', `${vf},format=yuv420p`, '-c:v', 'libaom-av1', '-still-picture', '1', '-crf', '23', '-cpu-used', '6', `${base}.avif`]);
  }
  console.log(`✓ ${name} (${Date.now() - t0} ms)`);
}
await browser.close(); srv.close();
