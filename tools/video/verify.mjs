// Re-checks narration clips that tts.mjs could not verify (for example when the transcription quota ran out):
// transcribes each one and checks it says its line (>= 85% of the words, at most 3 extra words).
//   GEMINI_ENV_FILE=<path to .env with GEMINI_API_KEY> node tools/video/verify.mjs [--all]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const S = JSON.parse(fs.readFileSync(path.join(HERE, 'script.json'), 'utf8'));
const N = JSON.parse(fs.readFileSync(path.join(OUT, 'narration.json'), 'utf8'));
const KEY = process.env.GEMINI_API_KEY ?? parseEnv(fs.readFileSync(process.env.GEMINI_ENV_FILE, 'utf8')).GEMINI_API_KEY;
if (!KEY) throw new Error('GEMINI_API_KEY not found');
const MODELS = ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const all = process.argv.includes('--all');

async function transcribe(file) {
  for (const model of MODELS) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: 'audio/wav', data: fs.readFileSync(file).toString('base64') } }, { text: 'Transcribe this audio exactly. Output only the words spoken.' }] }] }),
    });
    if (res.ok) {
      const j = await res.json();
      return { model, text: j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() };
    }
    console.log(`  ${model}: HTTP ${res.status}`);
  }
  return null;
}

const words = (t) => t.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
let failed = 0;
for (const beat of S.beats) {
  const clip = N.clips[beat.id];
  if (!all && clip.verified) continue;
  const file = clip.fitted ?? clip.file;
  const t = await transcribe(file);
  if (!t) { console.log(`${beat.id}: no transcription model available`); failed++; continue; }
  const want = words(beat.narration);
  const got = words(t.text);
  const have = new Set(got);
  const share = want.filter((w) => have.has(w)).length / Math.max(1, want.length);
  const ok = share >= 0.85 && got.length <= want.length + 3;
  console.log(`${beat.id.padEnd(16)} ${ok ? 'OK ' : 'BAD'} ${(share * 100).toFixed(0)}% via ${t.model}: "${t.text.slice(0, 140)}"`);
  if (ok) {
    Object.assign(clip, { verified: true, transcript: t.text, share });
    // Persist next to the cached clip too, so a later tts.mjs run (which rebuilds narration.json) keeps it.
    if (fs.existsSync(`${clip.file}.json`)) fs.writeFileSync(`${clip.file}.json`, JSON.stringify({ transcript: t.text, share, verified: true }));
  } else failed++;
}
fs.writeFileSync(path.join(OUT, 'narration.json'), JSON.stringify(N, null, 1));
if (failed) process.exitCode = 1;
