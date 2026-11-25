// Gallery stills for Devpost (1200x800, 3:2) and thumbnails, cut from the real scene recordings.
//   node tools/video/gallery.mjs   -> out/gallery/*.png, out/thumbnail-youtube.png, out/thumbnail-devpost.png
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const G = path.join(OUT, 'gallery');
fs.mkdirSync(G, { recursive: true });
const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args]);

function frameAt(seg, marker, offset) {
  const idx = JSON.parse(fs.readFileSync(path.join(OUT, 'raw', seg, 'index.json'), 'utf8'));
  const frames = [...idx.frames].sort((a, b) => a.t - b.t);
  const t = (idx.markers[marker] ?? frames[0].t) + offset;
  let best = frames[0];
  for (const f of frames) if (f.t <= t) best = f;
  return path.join(OUT, 'raw', seg, best.file);
}

const shots = [
  ['01-jira-panel', frameAt('jira', 'owner', 2.0), [400, 100, 1200, 800]],
  ['02-rovo-answer', frameAt('jira', 'rovo-answer', 3.0), [400, 60, 1200, 800]],
  ['03-confluence-byline', frameAt('confluence', 'popup', 3.0), [200, 60, 1200, 800]],
  ['04-decision-register', frameAt('register', 'table', 1.5), [300, 0, 1200, 800]],
  ['05-work-at-risk', frameAt('register', 'risk-table', 2.0), [300, 0, 1200, 800]],
];
for (const [name, file, [x, y, w, h]] of shots) {
  ff(['-i', file, '-vf', `crop=${w}:${h}:${x}:${y}`, path.join(G, `${name}.png`)]);
  console.log(`gallery/${name}.png`);
}
// 16:9 sources keep their full width: scaled to 1200 wide and padded to 3:2 with the page background.
const pad = (color) => `scale=1200:675:flags=lanczos,pad=1200:800:0:62:color=${color}`;
ff(['-ss', '21', '-i', path.join(OUT, 'raw', 'terminal', 'terminal.webm'), '-frames:v', '1', '-vf', pad('0x0b1020'), path.join(G, '06-mcp-coding-agent.png')]);
ff(['-i', path.join(OUT, 'cards', 'how.png'), '-vf', pad('0x0a1022'), path.join(G, '07-how-it-works.png')]);
ff(['-i', path.join(OUT, 'cards', 'title.png'), '-vf', 'scale=1280:720', path.join(OUT, 'thumbnail-youtube.png')]);
ff(['-i', path.join(OUT, 'cards', 'title.png'), '-vf', pad('0x0b1124'), path.join(OUT, 'thumbnail-devpost.png')]);
console.log('gallery/06-mcp-coding-agent.png, gallery/07-how-it-works.png, thumbnail-youtube.png, thumbnail-devpost.png');
