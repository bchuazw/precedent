// Contact sheet of a recorded segment: one frame shortly after each marker (plus start and end), 3 per row.
//   node tools/video/sheet.mjs <segment> [offsetSeconds=1.2]   -> out/sheet-<segment>.jpg
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const seg = process.argv[2];
const offset = Number(process.argv[3] ?? 1.2);
const dir = path.join(OUT, 'raw', seg);
const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const frames = [...idx.frames].sort((a, b) => a.t - b.t);
const t0 = frames[0].t;
const at = (s) => {
  let best = frames[0];
  for (const f of frames) {
    if (f.t - t0 <= s) best = f;
    else break;
  }
  return best;
};
const picks = [['start', 0.3], ...Object.entries(idx.markers).map(([k, v]) => [k, v - t0 + offset]), ['end', frames.at(-1).t - t0 - 0.2]];
console.log(`${seg}: ${frames.length} frames, ${(frames.at(-1).t - t0).toFixed(1)} s; markers ${Object.entries(idx.markers).map(([k, v]) => `${k}@${(v - t0).toFixed(1)}`).join(' ')}`);
const inputs = picks.flatMap(([, s]) => ['-i', path.join(dir, at(s).file)]);
const n = picks.length;
const cols = 3;
const FONT = "fontfile='C\\:/Windows/Fonts/arial.ttf'";
const scale = picks.map((_, i) => `[${i}:v]scale=640:360,drawtext=${FONT}:text='${picks[i][0]}':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6[s${i}]`).join(';');
const layout = picks.map((_, k) => `${k % cols ? Array.from({ length: k % cols }, () => 'w0').join('+') : '0'}_${Math.floor(k / cols) ? Array.from({ length: Math.floor(k / cols) }, () => 'h0').join('+') : '0'}`).join('|');
const out = path.join(OUT, `sheet-${seg}.jpg`);
execFileSync('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', `${scale};${picks.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${n}:layout=${layout}:fill=black`, '-frames:v', '1', out]);
console.log(out);
