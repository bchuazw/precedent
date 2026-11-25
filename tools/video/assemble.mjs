// Assembles out/precedent-demo.mp4 (1080p30 H.264 + AAC, -16 LUFS) and out/precedent-demo.srt from
// script.json, out/narration.json (tts + fitvoice), out/cards (cards) and out/raw (scene recordings).
//   node tools/video/assemble.mjs
// Beat length = lead + narration + tail. Recorded footage is fitted to it: sped up (at most 3x) when longer,
// held on its last frame when shorter. Optional crops punch in on a region of the 1600x900 recording.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const BUILD = path.join(OUT, 'build');
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
const S = JSON.parse(fs.readFileSync(path.join(HERE, 'script.json'), 'utf8'));
const N = JSON.parse(fs.readFileSync(path.join(OUT, 'narration.json'), 'utf8'));
const W = 1920, H = 1080, FPS = 30, XF = S.crossfade ?? 0.5;
const r3 = (n) => Math.round(n * 1000) / 1000;
const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { maxBuffer: 1 << 26 });
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS)];

// ---- caption cues ------------------------------------------------------------------------------------
function cuesFor(text, start, length) {
  const parts = [];
  for (const sentence of text.match(/[^.!?]+[.!?]+["”]?|[^.!?]+$/g) ?? [text]) {
    let s = sentence.trim();
    while (s.length > 92) {
      const cut = s.lastIndexOf(', ', 92) > 30 ? s.lastIndexOf(', ', 92) + 1 : s.lastIndexOf(' ', 88);
      parts.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (s) parts.push(s);
  }
  const chars = parts.reduce((n, p) => n + p.length, 0);
  let t = start;
  return parts.map((p) => {
    const d = (p.length / chars) * length;
    const cue = { text: p, start: r3(t), end: r3(t + d) };
    t += d;
    return cue;
  });
}

const browser = await chromium.launch();
const capPage = await browser.newPage({ viewport: { width: W, height: 200 } });
let capN = 0;
async function captionPng(text) {
  const file = path.join(BUILD, `cap-${++capN}.png`);
  await capPage.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent;width:${W}px;height:200px;display:flex;align-items:flex-end;justify-content:center}
    div{max-width:1500px;margin-bottom:16px;padding:12px 26px;border-radius:14px;background:rgba(8,12,24,.78);color:#fff;
        font:600 34px/1.3 "Segoe UI",system-ui,sans-serif;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.35)}
  </style></head><body><div>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div></body></html>`);
  await capPage.screenshot({ path: file, omitBackground: true });
  return file;
}

// ---- footage ------------------------------------------------------------------------------------------
function segmentFrames(name) {
  const dir = path.join(OUT, 'raw', name);
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const frames = [...idx.frames].sort((a, b) => a.t - b.t);
  return { dir, frames, t0: frames[0].t };
}

const vf = (crop) => (crop ? `crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]},` : '') + `scale=${W}:${H}:flags=lanczos,setsar=1,format=yuv420p`;

/** Renders [from, to] (seconds from the first frame) of a frame recording, with a crop, at 30 fps CFR. */
function framesPiece(seg, from, to, crop, out) {
  const { dir, frames, t0 } = seg;
  let firstIdx = frames.findIndex((f) => f.t - t0 > from);
  firstIdx = Math.max(0, firstIdx - 1);
  const pick = [];
  for (let i = firstIdx; i < frames.length && frames[i].t - t0 < to; i++) pick.push(frames[i]);
  const lines = [];
  pick.forEach((f, i) => {
    const start = Math.max(f.t - t0, from);
    const end = i + 1 < pick.length ? pick[i + 1].t - t0 : to;
    lines.push(`file '${path.join(dir, f.file).replace(/\\/g, '/')}'`, `duration ${Math.max(0.001, end - start).toFixed(4)}`);
  });
  lines.push(`file '${path.join(dir, pick.at(-1).file).replace(/\\/g, '/')}'`);
  const list = `${out}.txt`;
  fs.writeFileSync(list, lines.join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${FPS},${vf(crop)}`, ...ENC, '-t', String(r3(to - from)), out]);
}

function videoPiece(file, from, to, crop, out) {
  ff(['-ss', String(from), '-to', String(to), '-i', file, '-vf', `fps=${FPS},${vf(crop)}`, ...ENC, '-an', out]);
}

/** The footage of one beat at real speed: its windows, each split by crop ranges, concatenated. */
function footage(beat, out) {
  const v = beat.visual;
  const pieces = [];
  const crops = v.crops ?? [];
  for (const [from, to] of v.windows) {
    const cuts = [from, ...crops.flatMap(([a, b]) => [a, b]).filter((x) => x > from && x < to), to].sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1];
      if (b - a < 0.05) continue;
      const crop = (crops.find(([c0, c1]) => a >= c0 - 1e-6 && b <= c1 + 1e-6) ?? [0, 0, null])[2];
      const piece = path.join(BUILD, `${beat.id}-p${pieces.length}.mp4`);
      if (v.clip === 'terminal') videoPiece(path.join(OUT, 'raw', 'terminal', 'terminal.webm'), a, b, crop, piece);
      else framesPiece(segmentFrames(v.clip), a, b, crop, piece);
      pieces.push(piece);
    }
  }
  const list = path.join(BUILD, `${beat.id}-pieces.txt`);
  fs.writeFileSync(list, pieces.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
}

// ---- beats ----------------------------------------------------------------------------------------------
const beats = S.beats;
const plans = [];
let length = 0;
const allCues = [];
for (let i = 0; i < beats.length; i++) {
  const b = beats[i];
  const clip = N.clips[b.id];
  const nd = clip.fittedSeconds ?? clip.seconds;
  const lead = (i === 0 ? 0.8 : 0.35) + (i > 0 ? XF : 0);
  const tail = i === beats.length - 1 ? 2.2 : 0.55 + XF;
  const D = r3(lead + nd + tail);
  const start = i === 0 ? 0 : r3(length - XF);
  length = start + D;
  const local = cuesFor(b.caption ?? b.narration, lead, nd);
  allCues.push(...local.map((c) => ({ ...c, start: c.start + start, end: c.end + start })));
  plans.push({ ...b, D, start, lead, nd, audio: clip.fitted ?? clip.file, local });
}

for (const p of plans) {
  const out = path.join(BUILD, `${p.id}.mp4`);
  const caps = [];
  for (const c of p.local) caps.push({ ...c, png: await captionPng(c.text) });
  const capInputs = caps.flatMap((c) => ['-loop', '1', '-i', c.png]);
  const capChain = caps.map((c, k) => `[v${k}][${k + 1}:v]overlay=x=0:y=${H - 200}:enable='between(t,${c.start},${c.end})':shortest=1[v${k + 1}]`).join(';');
  let base;
  if ('card' in p.visual) {
    const png = path.join(OUT, 'cards', `${p.visual.card}.png`);
    const frames = Math.round(p.D * FPS);
    base = ['-loop', '1', '-framerate', String(FPS), '-t', String(p.D), '-i', png];
    const zoom = `scale=${W * 2}:${H * 2},zoompan=z='1+0.035*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p[v0]`;
    ff([...base, ...capInputs, '-filter_complex', `[0:v]${zoom}${capChain ? `;${capChain}` : ''}`, '-map', `[v${caps.length}]`, ...ENC, '-t', String(p.D), out]);
  } else {
    const src = path.join(BUILD, `${p.id}-src.mp4`);
    footage(p, src);
    const L = dur(src);
    const speed = Math.min(3, Math.max(1, L / p.D));
    const hold = Math.max(0, p.D - L / speed + 0.2);
    p.speed = speed;
    const fit = `[0:v]setpts=(PTS-STARTPTS)/${r3(speed)},fps=${FPS},tpad=stop_mode=clone:stop_duration=${r3(hold)},format=yuv420p[v0]`;
    ff(['-i', src, ...capInputs, '-filter_complex', `${fit}${capChain ? `;${capChain}` : ''}`, '-map', `[v${caps.length}]`, ...ENC, '-t', String(p.D), out]);
  }
  p.file = out;
  console.log(`beat ${p.id.padEnd(16)} ${p.D.toFixed(2)}s at ${p.start.toFixed(2)}s${p.speed && p.speed > 1.01 ? ` (footage x${p.speed.toFixed(2)})` : ''}`);
}
await browser.close();

// ---- video: crossfades ------------------------------------------------------------------------------------
const vIn = plans.flatMap((p) => ['-i', p.file]);
const parts = plans.map((_, i) => `[${i}:v]setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p,settb=AVTB[b${i}]`);
let cur = 'b0';
let acc = plans[0].D;
for (let i = 1; i < plans.length; i++) {
  parts.push(`[${cur}][b${i}]xfade=transition=fade:duration=${XF}:offset=${r3(acc - XF)},settb=AVTB[x${i}]`);
  acc += plans[i].D - XF;
  cur = `x${i}`;
}
const silent = path.join(BUILD, 'video.mp4');
ff([...vIn, '-filter_complex', parts.join(';'), '-map', `[${cur}]`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), silent]);
const total = dur(silent);

// ---- audio: narration at absolute times, two-pass loudnorm to -16 LUFS -----------------------------------
const aIn = plans.flatMap((p) => ['-i', p.audio]);
const delays = plans.map((p, i) => `[${i}:a]aresample=48000,adelay=${Math.round((p.start + p.lead) * 1000)}:all=1[a${i}]`);
const mix = `${delays.join(';')};${plans.map((_, i) => `[a${i}]`).join('')}amix=inputs=${plans.length}:normalize=0:dropout_transition=0,apad=whole_dur=${r3(total)}[mix]`;
const raw = path.join(BUILD, 'narration-raw.wav');
ff([...aIn, '-filter_complex', mix, '-map', '[mix]', '-t', String(r3(total)), '-ac', '2', '-c:a', 'pcm_s16le', raw]);
let measure = '';
try {
  execFileSync('ffmpeg', ['-hide_banner', '-i', raw, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
} catch (e) {
  measure = String(e.stderr ?? '');
}
if (!measure) measure = execFileSync('ffmpeg', ['-hide_banner', '-i', raw, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const j = /\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(measure)?.[0];
const m = j ? JSON.parse(j) : null;
const ln = m ? `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true` : 'loudnorm=I=-16:TP=-1.5:LRA=11';
const audio = path.join(BUILD, 'narration.wav');
ff(['-i', raw, '-af', `${ln},aresample=48000`, '-ar', '48000', '-c:a', 'pcm_s16le', audio]);

const mp4 = path.join(OUT, 'precedent-demo.mp4');
ff(['-i', silent, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', mp4]);
const ts = (s) => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), mi = Math.floor((ms % 3600000) / 60000), se = Math.floor((ms % 60000) / 1000); return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
fs.writeFileSync(path.join(OUT, 'precedent-demo.srt'), allCues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n'));
console.log(`${mp4}: ${dur(mp4).toFixed(1)}s`);
