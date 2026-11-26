"""Narration with Kokoro-82M (Apache-2.0), locally on CPU: one clip per beat of script.json, cached by
(voice, speed, spoken text), trimmed and resampled exactly like tts.mjs, and listed in out/narration.json in the
same format, so verify.mjs, fitvoice.mjs and assemble.mjs work unchanged.

    tools/video/out/ttsenv/Scripts/python.exe tools/video/tts-local.py [voice] [speed]
"""
import hashlib, json, os, re, subprocess, sys
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
CACHE = os.path.join(OUT, 'tts-kokoro')
os.makedirs(CACHE, exist_ok=True)
VOICE = sys.argv[1] if len(sys.argv) > 1 else 'af_heart'
SPEED = float(sys.argv[2]) if len(sys.argv) > 2 else 1.15
S = json.load(open(os.path.join(HERE, 'script.json'), encoding='utf-8'))
k = Kokoro(os.path.join(OUT, 'models', 'kokoro-v1.0.onnx'), os.path.join(OUT, 'models', 'voices-v1.0.bin'))
TRIM = 'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.06'

# How to say it: spellings Kokoro's phonemiser reads correctly (checked with k.tokenizer.phonemize: "passkeys"
# comes out as "paskiz", "SIM-swap" is spelled out letter by letter, dotted acronyms get a pause per letter).
# Captions keep the written form; only the spoken text changes.
SAY = [
    (re.compile(r'\bA\.D\.R\.', re.I), 'ADR'),
    (re.compile(r'\bpasskey(s?)\b', re.I), r'pass key\1'),
    (re.compile(r'\bSIM-swap\b', re.I), 'sim swap'),
    (re.compile(r'\bT\.O\.T\.P\.', re.I), 'T O T P'),
]


def spoken(text):
    for pat, rep in SAY:
        text = pat.sub(rep, text)
    return text


def duration(f):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], capture_output=True, text=True).stdout.strip())


clips = {}
for beat in S['beats']:
    text = spoken(beat['narration'])
    key = hashlib.sha256(json.dumps(['kokoro', VOICE, SPEED, text], ensure_ascii=False).encode('utf-8')).hexdigest()[:16]
    final = os.path.join(CACHE, f'{key}.wav')
    meta = final + '.json'
    cached = os.path.exists(final) and os.path.exists(meta)
    if not cached:
        samples, sr = k.create(text, voice=VOICE, speed=SPEED, lang='en-gb' if VOICE.startswith('b') else 'en-us')
        raw = os.path.join(CACHE, f'{key}.raw.wav')
        sf.write(raw, samples, sr)
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', raw, '-af', f'{TRIM},areverse,{TRIM},areverse,aresample=48000', '-ac', '1', '-c:a', 'pcm_s16le', final], check=True)
        os.remove(raw)
        json.dump({'transcript': None, 'share': None, 'verified': False}, open(meta, 'w'))
    info = json.load(open(meta))
    clips[beat['id']] = {'file': final, 'model': f'kokoro-82m/{VOICE}@{SPEED}', 'spoken': text, **info, 'seconds': duration(final), **({'cached': True} if cached else {})}
    print(f"{beat['id']:16} {clips[beat['id']]['seconds']:5.2f}s  {'(cached)' if cached else ''}")

json.dump({'voice': f'kokoro/{VOICE}', 'clips': clips}, open(os.path.join(OUT, 'narration.json'), 'w', encoding='utf-8'), indent=1)
print(f"narration {sum(c['seconds'] for c in clips.values()):.1f}s")
