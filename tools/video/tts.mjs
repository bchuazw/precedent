// Narration with Gemini TTS: one clip per beat of script.json, cached by (model, voice, style, text).
// Each take is transcribed by a Gemini text model and kept only if it says the line (>= 85% of its words,
// at most 3 extra words), because TTS models sometimes read the style note aloud.
//   GEMINI_ENV_FILE=<path to .env with GEMINI_API_KEY> node tools/video/tts.mjs
// Writes out/narration.json. The key is read from the env file and sent only to Google's API, in a header.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const DIR = path.join(OUT, 'tts');
fs.mkdirSync(DIR, { recursive: true });
const S = JSON.parse(fs.readFileSync(path.join(HERE, 'script.json'), 'utf8'));
const KEY = process.env.GEMINI_API_KEY ?? parseEnv(fs.readFileSync(process.env.GEMINI_ENV_FILE, 'utf8')).GEMINI_API_KEY;
if (!KEY) throw new Error('GEMINI_API_KEY not found');
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function wav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function gemini(model, body) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body) });
    if (res.ok) return res.json();
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const delay = Number(/"retryDelay":\s*"(\d+)/.exec(text)?.[1] ?? 15);
      if (delay > 90) throw new Error(`${model}: quota spent (${delay}s retry)`);
      console.log(`  ${model}: HTTP ${res.status}, retry in ${delay}s`);
      await sleep((delay + 1) * 1000);
      continue;
    }
    throw new Error(`${model}: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
}

async function synthesize(model, text) {
  const j = await gemini(model, {
    contents: [{ parts: [{ text: `${S.tts.style}\n\n${text}` }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: S.tts.voice } } } },
  });
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!part) throw new Error(`${model}: no audio`);
  const data = Buffer.from(part.data, 'base64');
  return data.subarray(0, 4).toString() === 'RIFF' ? data : wav(data, Number(/rate=(\d+)/.exec(part.mimeType)?.[1] ?? 24000));
}

async function transcribe(file) {
  for (const model of ['gemini-3.5-flash', 'gemini-flash-latest']) {
    try {
      const j = await gemini(model, { contents: [{ parts: [{ inlineData: { mimeType: 'audio/wav', data: fs.readFileSync(file).toString('base64') } }, { text: 'Transcribe this audio exactly. Output only the words spoken.' }] }] });
      return j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
    } catch (e) {
      console.log(`  transcribe via ${model} failed: ${String(e.message).slice(0, 80)}`);
    }
  }
  return undefined;
}

const words = (t) => t.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
function verdict(text, transcript) {
  const want = words(text);
  const got = words(transcript);
  const have = new Set(got);
  const share = want.filter((w) => have.has(w)).length / Math.max(1, want.length);
  return { ok: share >= 0.85 && got.length <= want.length + 3, share };
}

const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
const tidy = (inp, out) => {
  const trim = 'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.06';
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', inp, '-af', `${trim},areverse,${trim},areverse,aresample=48000`, '-ac', '1', '-c:a', 'pcm_s16le', out]);
};

const manifest = {};
for (const beat of S.beats) {
  let done = null;
  for (const model of S.tts.models) {
    const key = crypto.createHash('sha256').update(JSON.stringify([model, S.tts.voice, S.tts.style, beat.narration])).digest('hex').slice(0, 16);
    const file = path.join(DIR, `${key}.wav`);
    if (fs.existsSync(file) && fs.existsSync(`${file}.json`)) {
      done = { file, model, ...JSON.parse(fs.readFileSync(`${file}.json`, 'utf8')), cached: true };
      break;
    }
    let best = null;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      try {
        const raw = path.join(DIR, `${key}.raw.wav`);
        fs.writeFileSync(raw, await synthesize(model, beat.narration));
        const take = path.join(DIR, `${key}.take${attempt}.wav`);
        tidy(raw, take);
        fs.rmSync(raw);
        const transcript = await transcribe(take);
        const v = transcript === undefined ? { ok: true, share: NaN } : verdict(beat.narration, transcript);
        if (v.ok) {
          fs.renameSync(take, file);
          fs.writeFileSync(`${file}.json`, JSON.stringify({ transcript, share: v.share, verified: transcript !== undefined }));
          done = { file, model, transcript, share: v.share, verified: transcript !== undefined };
        } else {
          console.log(`  ${beat.id} take ${attempt} on ${model}: ${(v.share * 100).toFixed(0)}% match, regenerating ("${(transcript ?? '').slice(0, 80)}")`);
          if (!best || v.share > best.share) best = { take, share: v.share, transcript };
        }
      } catch (e) {
        console.log(`  ${beat.id} on ${model}: ${String(e.message).slice(0, 120)}`);
        break;
      }
    }
    if (!done && best) {
      fs.copyFileSync(best.take, file);
      fs.writeFileSync(`${file}.json`, JSON.stringify({ transcript: best.transcript, share: best.share, verified: false }));
      done = { file, model, transcript: best.transcript, share: best.share, verified: false };
      console.log(`  WARNING ${beat.id}: kept closest take (${(best.share * 100).toFixed(0)}%); listen to it`);
    }
    if (done) break;
  }
  if (!done) throw new Error(`no audio for ${beat.id}`);
  done.seconds = dur(done.file);
  manifest[beat.id] = done;
  console.log(`${beat.id.padEnd(16)} ${done.seconds.toFixed(2)}s  ${done.model}${done.cached ? ' (cached)' : ''}  verified=${done.verified}`);
}
fs.writeFileSync(path.join(OUT, 'narration.json'), JSON.stringify({ voice: S.tts.voice, clips: manifest }, null, 1));
const total = Object.values(manifest).reduce((s, c) => s + c.seconds, 0);
console.log(`narration ${total.toFixed(1)}s`);
