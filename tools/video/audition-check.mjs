// Screens voice auditions (out/voices/*): transcribes each with Gemini and reports word match and speaking rate,
// to catch voices that mispronounce terms like "A.D.R. seven" or "SIM-swap" before anyone has to listen.
//   GEMINI_ENV_FILE=<.env with GEMINI_API_KEY> node tools/video/audition-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, 'out', 'voices');
const KEY = process.env.GEMINI_API_KEY ?? parseEnv(fs.readFileSync(process.env.GEMINI_ENV_FILE, 'utf8')).GEMINI_API_KEY;
const LINE = "Here's that story. Before anyone opens it, the panel says one conflict: A.D.R. seven chose passkeys over SMS, because SIM-swap attacks make SMS unsafe. Teamwork Graph shows who owns it.";
const NUM = { one: '1', seven: '7' };
const words = (t) => t.replace(/\b(?:[A-Za-z]\.){2,}/g, (m) => m.replace(/\./g, '')).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean).map((w) => NUM[w] ?? w.replace(/^0+(?=\d)/, ''));
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());

for (const f of fs.readdirSync(DIR).filter((x) => /\.(wav|mp3)$/.test(x)).sort()) {
  const file = path.join(DIR, f);
  const mime = f.endsWith('.mp3') ? 'audio/mp3' : 'audio/wav';
  let text = '';
  for (const model of ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest']) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: mime, data: fs.readFileSync(file).toString('base64') } }, { text: 'Transcribe this audio exactly. Output only the words spoken.' }] }] }),
    });
    if (res.ok) {
      text = (await res.json()).candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
      break;
    }
  }
  const want = words(LINE);
  const got = words(text);
  const have = new Set(got);
  const share = want.filter((w) => have.has(w)).length / want.length;
  const secs = dur(file);
  console.log(`${f.padEnd(44)} ${(share * 100).toFixed(0).padStart(3)}%  ${secs.toFixed(1)}s  ${((want.length / secs) * 60).toFixed(0)} wpm  "${text.slice(0, 110)}"`);
}
