// Evens out narration pacing: caps every internal pause at about 0.3 s, then time-stretches each clip
// toward a common speech rate (default 155 wpm, stretch clamped to 1.0–1.45x so the voice stays natural).
//   node tools/video/fitvoice.mjs [wpm]
// Reads out/narration.json, writes out/narr/<beat>.wav and adds `fitted` + `fittedSeconds` to each clip.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const S = JSON.parse(fs.readFileSync(path.join(HERE, 'script.json'), 'utf8'));
const N = JSON.parse(fs.readFileSync(path.join(OUT, 'narration.json'), 'utf8'));
const WPM = Number(process.argv[2] ?? 155);
const dir = path.join(OUT, 'narr');
fs.mkdirSync(dir, { recursive: true });
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args]);

let total = 0;
for (const beat of S.beats) {
  const clip = N.clips[beat.id];
  const squeezed = path.join(dir, `${beat.id}.pauses.wav`);
  ff(['-i', clip.file, '-af', 'silenceremove=stop_periods=-1:stop_duration=0.3:stop_threshold=-40dB:stop_silence=0.3', squeezed]);
  const words = beat.narration.split(/\s+/).filter(Boolean).length;
  const d = dur(squeezed);
  const target = (words / WPM) * 60;
  const factor = Math.min(1.45, Math.max(1.0, d / target));
  const out = path.join(dir, `${beat.id}.wav`);
  ff(['-i', squeezed, '-af', `atempo=${factor.toFixed(3)},aresample=48000`, '-ac', '1', '-c:a', 'pcm_s16le', out]);
  fs.rmSync(squeezed);
  clip.fitted = out;
  clip.fittedSeconds = dur(out);
  total += clip.fittedSeconds;
  console.log(`${beat.id.padEnd(16)} ${clip.seconds.toFixed(1)}s -> ${clip.fittedSeconds.toFixed(1)}s  (pauses ${d.toFixed(1)}s, x${factor.toFixed(2)}, ${((words / clip.fittedSeconds) * 60).toFixed(0)} wpm)`);
}
fs.writeFileSync(path.join(OUT, 'narration.json'), JSON.stringify(N, null, 1));
console.log(`narration ${total.toFixed(1)}s at ~${WPM} wpm`);
