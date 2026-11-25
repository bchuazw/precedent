// Thumbnails with the real product in them: title on the left, the Jira conflict card on the right.
//   node tools/video/thumbs.mjs   (after gallery.mjs) -> out/thumbnail-devpost.png (1200x800), out/thumbnail-youtube.png (1280x720)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const BUILD = path.join(OUT, 'build');
fs.mkdirSync(BUILD, { recursive: true });

// The Precedent panel (header, conflict card, Ask Precedent) from the recorded Jira scene, one second after the
// card appears. The recording's mouse pointer rests in the card's empty pink area there; delogo fills it from the
// surrounding flat background.
const crop = path.join(BUILD, 'thumb-panel.png');
const idx = JSON.parse(fs.readFileSync(path.join(OUT, 'raw', 'jira', 'index.json'), 'utf8'));
const frames = [...idx.frames].sort((a, b) => a.t - b.t);
const at = idx.markers.card + 1.0;
const frame = frames.reduce((best, f) => (f.t <= at ? f : best), frames[0]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(OUT, 'raw', 'jira', frame.file),
  '-vf', 'crop=416:530:1148:268,delogo=x=172:y=382:w=36:h=42', crop]);
const panel = `data:image/png;base64,${fs.readFileSync(crop).toString('base64')}`;

const page = (w, h, s) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
  body{background:radial-gradient(${w}px ${h}px at 12% 8%,#1a2a55 0%,#0b1124 58%,#070b18 100%);color:#e8edf7;
       font-family:"Segoe UI","Inter",system-ui,sans-serif;display:flex;align-items:center;gap:${44 * s}px;padding:0 ${56 * s}px}
  .left{flex:1;min-width:0}
  .brand{display:flex;align-items:center;gap:${18 * s}px}
  .logo{width:${78 * s}px;height:${78 * s}px;border-radius:${20 * s}px;background:linear-gradient(135deg,#2f6bff,#7b5cff);display:flex;
        align-items:center;justify-content:center;font-size:${48 * s}px;font-weight:800;color:#fff;box-shadow:0 ${14 * s}px ${44 * s}px rgba(47,107,255,.4)}
  .name{font-size:${84 * s}px;font-weight:800;letter-spacing:-.02em}
  .tag{font-size:${36 * s}px;line-height:1.28;color:#c3cde3;margin-top:${26 * s}px;font-weight:600}
  .tag b{color:#ff9a9a;font-weight:700}
  .tag i{font-style:normal;color:#8db4ff}
  .chips{display:flex;flex-wrap:wrap;gap:${10 * s}px;margin-top:${30 * s}px}
  .chip{border:1px solid #2b3a63;background:#0f1833;color:#c9d5f2;border-radius:999px;padding:${8 * s}px ${16 * s}px;font-size:${19 * s}px}
  .shot{flex:none;height:${h - 96 * s}px;border-radius:${16 * s}px;box-shadow:0 ${24 * s}px ${70 * s}px rgba(0,0,0,.55),0 0 0 ${2 * s}px #2b3a63;background:#fff}
</style></head><body>
  <div class="left">
    <div class="brand"><div class="logo">P</div><div class="name">Precedent</div></div>
    <div class="tag">Your team already decided.<br><b>Catch work that contradicts it</b> <i>before you ship.</i></div>
    <div class="chips"><span class="chip">Jira</span><span class="chip">Confluence</span><span class="chip">Rovo agent</span><span class="chip">MCP</span><span class="chip">Teamwork Graph</span></div>
  </div>
  <img class="shot" src="${panel}">
</body></html>`;

const browser = await chromium.launch();
for (const [file, w, h, s] of [['thumbnail-devpost.png', 1200, 800, 1], ['thumbnail-youtube.png', 1280, 720, 0.95]]) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.setContent(page(w, h, s));
  await p.screenshot({ path: path.join(OUT, file) });
  await p.close();
  console.log(`out/${file} ${w}x${h}`);
}
await browser.close();
