// Montage vidéo 1080x1920 avec ffmpeg (gratuit, sur le serveur).
// Fond : images de data/media/ (libres de droits uniquement) sinon dégradé ; texte incrusté ;
// voix off optionnelle via une commande TTS locale (Piper…), sinon piste silencieuse.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';

const run = promisify(execFile);
const FONT = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf'].find(f => fs.existsSync(f));

function wrap(text, width = 20) {
  const lines = []; let line = '';
  for (const w of text.split(/\s+/)) {
    if ((line + ' ' + w).trim().length > width) { lines.push(line.trim()); line = w; } else line += ' ' + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join('\n');
}

export async function renderVideo(videoId, script) {
  const outDir = path.join(config.dataDir, 'out', String(videoId));
  fs.mkdirSync(outDir, { recursive: true });
  const media = fs.existsSync(path.join(config.dataDir, 'media'))
    ? fs.readdirSync(path.join(config.dataDir, 'media')).filter(f => /\.(jpe?g|png)$/i.test(f)) : [];

  const parts = [];
  for (const [i, scene] of script.scenes.entries()) {
    const txt = path.join(outDir, `s${i}.txt`);
    fs.writeFileSync(txt, wrap(scene.text));
    const part = path.join(outDir, `s${i}.mp4`);
    const secs = Math.min(Math.max(Number(scene.seconds) || 4, 2), 10);
    const bg = media.length
      ? ['-loop', '1', '-t', String(secs), '-i', path.join(config.dataDir, 'media', media[(videoId + i) % media.length])]
      : ['-f', 'lavfi', '-t', String(secs), '-i', `color=c=0x111418:s=1080x1920:r=30`];
    const draw = `drawtext=${FONT ? `fontfile=${FONT}:` : ''}textfile=${txt}:fontcolor=white:fontsize=62:line_spacing=18:box=1:boxcolor=black@0.55:boxborderw=40:x=(w-text_w)/2:y=(h-text_h)/2`;
    await run('ffmpeg', ['-y', ...bg, '-f', 'lavfi', '-t', String(secs), '-i', 'anullsrc=r=44100:cl=stereo',
      '-vf', `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${draw},format=yuv420p`,
      '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-shortest', part]);
    parts.push(part);
  }

  const list = path.join(outDir, 'list.txt');
  fs.writeFileSync(list, parts.map(p => `file '${p}'`).join('\n'));
  let final = path.join(outDir, 'final.mp4');
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', final]);

  if (config.production.ttsCmd) {
    const voice = path.join(outDir, 'voice.wav');
    const narration = script.scenes.map(s => s.text).join('. ');
    const [cmd, ...args] = config.production.ttsCmd.replace('{out}', voice).split(' ');
    const child = execFile(cmd, args);
    child.stdin.end(narration);
    await new Promise((ok, ko) => child.on('exit', c => c === 0 ? ok() : ko(new Error(`TTS code ${c}`))));
    const voiced = path.join(outDir, 'final_voice.mp4');
    await run('ffmpeg', ['-y', '-i', final, '-i', voice, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', voiced]);
    final = voiced;
  }
  for (const p of parts) fs.rmSync(p, { force: true });
  return final;
}
