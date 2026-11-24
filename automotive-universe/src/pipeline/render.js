// Montage vidéo 1080x1920 avec ffmpeg, selon la direction artistique validée.
// Zones sûres TikTok respectées : rien d'important en bas (légende) ni à droite (boutons).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { PRESETS, getBrand } from '../brand.js';

const run = promisify(execFile);
const W = 1080, H = 1920, MARGIN = 130;
// Hauteur de ligne native des polices (hhea, mesurée) → interligne maîtrisé
const NATIVE_LH = { 'Oswald': 1.482, 'BebasNeue': 1.2, 'Inter': 1.21 };
const nativeLh = (font) => NATIVE_LH[Object.keys(NATIVE_LH).find(k => path.basename(font).startsWith(k))] ?? 1.2;

function wrap(text, maxChars) {
  const lines = []; let line = '';
  for (const w of String(text).split(/\s+/)) {
    if (line && (line + ' ' + w).length > maxChars) { lines.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines;
}

// Construit la chaîne de filtres d'une scène. kind : 'title' | 'body' | 'cta'
function sceneFilter({ kind, text, index, total, series }, p, brand, dir, i) {
  const isTitle = kind !== 'body';
  const font = isTitle ? p.titleFont : p.bodyFont;
  const size = kind === 'cta' ? Math.round(p.titleSize * 0.7) : isTitle ? p.titleSize : p.bodySize;
  const charW = isTitle ? p.titleCharW : p.bodyCharW;
  const usable = W - 2 * MARGIN - (p.accentBar === 'left' ? 40 : 0);
  const content = isTitle && p.uppercaseTitle ? text.toUpperCase() : text;
  const lines = wrap(content, Math.floor(usable / (size * charW)));
  const target = isTitle ? 1.12 : 1.38;
  const lh = nativeLh(font);
  const lineGap = Math.round(size * (target - lh));
  const blockH = Math.round(size * lh + (lines.length - 1) * size * target);
  const top = Math.round(H * 0.44 - blockH / 2);
  const txt = path.join(dir, `t${i}.txt`); fs.writeFileSync(txt, lines.join('\n'));
  const tag = path.join(dir, `g${i}.txt`); fs.writeFileSync(tag, (series || brand.name).toUpperCase());
  const handle = path.join(dir, `h${i}.txt`); fs.writeFileSync(handle, brand.handle);

  const x = p.align === 'left' ? MARGIN + (p.accentBar === 'left' ? 40 : 0) : '(w-text_w)/2';
  const color = kind === 'cta' ? p.accent : p.box ? p.textColorOnBox : p.text;
  const f = [];
  // barre de progression + étiquette de série (haut d'écran)
  f.push(`drawbox=x=${MARGIN}:y=120:w=${W - 2 * MARGIN}:h=8:color=${p.muted}@0.35:t=fill`);
  f.push(`drawbox=x=${MARGIN}:y=120:w=${Math.round((W - 2 * MARGIN) * (index + 1) / total)}:h=8:color=${p.accent}:t=fill`);
  f.push(`drawtext=fontfile=${p.bodyFont}:textfile=${tag}:fontsize=34:fontcolor=${p.box ? p.accent : p.muted}:x=${MARGIN}:y=170`);
  if (p.accentBar === 'left') f.push(`drawbox=x=${MARGIN}:y=${top - 10}:w=12:h=${blockH + 20}:color=${p.accent}:t=fill`);
  if (p.accentBar === 'lines') {
    f.push(`drawbox=x=${(W - 220) / 2}:y=${top - 70}:w=220:h=4:color=${p.accent}:t=fill`);
    f.push(`drawbox=x=${(W - 220) / 2}:y=${top + blockH + 66}:w=220:h=4:color=${p.accent}:t=fill`);
  }
  const box = p.box && kind !== 'cta' ? `:box=1:boxcolor=${p.accent}:boxborderw=34` : '';
  f.push(`drawtext=fontfile=${font}:textfile=${txt}:fontsize=${size}:line_spacing=${lineGap}:fontcolor=${color}${box}:x=${x}:y=${top}` + (p.align === 'center' ? ':text_align=center' : ''));
  f.push(`drawtext=fontfile=${p.bodyFont}:textfile=${handle}:fontsize=40:fontcolor=${p.muted}:x=${p.align === 'left' ? MARGIN : '(w-text_w)/2'}:y=${H - 520}`);
  return f.join(',');
}

function backgroundArgs(p, secs, mediaFile, still) {
  const t = still ? [] : ['-t', String(secs)];
  return mediaFile
    ? { input: [...(still ? [] : ['-loop', '1']), ...t, '-i', mediaFile], pre: `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},drawbox=x=0:y=0:w=iw:h=ih:color=black@0.6:t=fill,` }
    : { input: ['-f', 'lavfi', ...t, '-i', `color=c=${p.bg}:s=${W}x${H}:r=30`], pre: '' };
}

const kindOf = (i, n, scene) => scene.kind ?? (i === 0 ? 'title' : i === n - 1 ? 'cta' : 'body');

function mediaList() {
  const dir = path.join(config.dataDir, 'media');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.(jpe?g|png)$/i.test(f)).map(f => path.join(dir, f)) : [];
}

export async function renderVideo(videoId, script, { series = null, brand = getBrand() } = {}) {
  const p = PRESETS[brand.preset];
  const outDir = path.join(config.dataDir, 'out', String(videoId));
  fs.mkdirSync(outDir, { recursive: true });
  const media = mediaList();
  const n = script.scenes.length;
  const parts = [];
  for (const [i, scene] of script.scenes.entries()) {
    const secs = Math.min(Math.max(Number(scene.seconds) || 4, 2), 10);
    const bg = backgroundArgs(p, secs, media.length ? media[(videoId + i) % media.length] : null, false);
    const vf = bg.pre + sceneFilter({ kind: kindOf(i, n, scene), text: scene.text, index: i, total: n, series }, p, brand, outDir, i) + ',format=yuv420p';
    const part = path.join(outDir, `s${i}.mp4`);
    await run('ffmpeg', ['-y', ...bg.input, '-f', 'lavfi', '-t', String(secs), '-i', 'anullsrc=r=44100:cl=stereo',
      '-vf', vf, '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-shortest', part]);
    parts.push(part);
  }
  const list = path.join(outDir, 'list.txt');
  fs.writeFileSync(list, parts.map(x => `file '${x}'`).join('\n'));
  let final = path.join(outDir, 'final.mp4');
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', final]);

  if (config.production.ttsCmd) {
    const voice = path.join(outDir, 'voice.wav');
    const [cmd, ...args] = config.production.ttsCmd.replace('{out}', voice).split(' ');
    const child = execFile(cmd, args);
    child.stdin.end(script.scenes.map(s => s.text).join('. '));
    await new Promise((ok, ko) => child.on('exit', c => c === 0 ? ok() : ko(new Error(`TTS code ${c}`))));
    const voiced = path.join(outDir, 'final_voice.mp4');
    await run('ffmpeg', ['-y', '-i', final, '-i', voice, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', voiced]);
    final = voiced;
  }
  for (const x of parts) fs.rmSync(x, { force: true });
  return final;
}

// Planche d'aperçu (titre | fait | appel à l'action) pour valider une direction artistique.
export async function renderPreview(brand, sample, outFile) {
  const p = PRESETS[brand.preset];
  const dir = path.join(path.dirname(outFile), `.preview-${brand.preset}`);
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  const scenes = [{ kind: 'title', text: sample.title }, { kind: 'body', text: sample.fact }, { kind: 'cta', text: brand.cta }];
  for (const [i, s] of scenes.entries()) {
    const bg = backgroundArgs(p, 1, sample.media ?? null, true);
    const png = path.join(dir, `f${i}.png`);
    await run('ffmpeg', ['-y', ...bg.input, '-vf', bg.pre + sceneFilter({ ...s, index: i, total: 3, series: sample.series }, p, brand, dir, i), '-frames:v', '1', png]);
    frames.push(png);
  }
  await run('ffmpeg', ['-y', ...frames.flatMap(x => ['-i', x]), '-filter_complex', `${frames.map((_, i) => `[${i}]pad=iw+24:ih:0:0:color=white[p${i}]`).join(';')};${frames.map((_, i) => `[p${i}]`).join('')}hstack=inputs=${frames.length},scale=1500:-1`, '-frames:v', '1', outFile]);
  fs.rmSync(dir, { recursive: true, force: true });
  return outFile;
}
