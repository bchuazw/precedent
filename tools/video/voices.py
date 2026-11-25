"""Voice audition: renders the same narration line with local Kokoro-82M voices (Apache-2.0, runs on CPU) and,
for comparison, Microsoft Edge neural voices (free online service via edge-tts), into out/voices/.

    tools/video/out/ttsenv/Scripts/python.exe tools/video/voices.py
"""
import asyncio, os, sys, time
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out', 'voices')
MODELS = os.path.join(HERE, 'out', 'models')
os.makedirs(OUT, exist_ok=True)

LINE = ("Here's that story. Before anyone opens it, the panel says one conflict: A.D.R. seven chose passkeys over SMS, "
        "because SIM-swap attacks make SMS unsafe. Teamwork Graph shows who owns it.")
KOKORO = ['af_heart', 'af_bella', 'af_nicole', 'am_michael', 'am_fenrir', 'am_puck', 'bf_emma', 'bm_george', 'bm_fable']
EDGE = ['en-US-AndrewMultilingualNeural', 'en-US-BrianMultilingualNeural', 'en-US-AvaMultilingualNeural', 'en-US-EmmaMultilingualNeural']


def kokoro():
    from kokoro_onnx import Kokoro
    k = Kokoro(os.path.join(MODELS, 'kokoro-v1.0.onnx'), os.path.join(MODELS, 'voices-v1.0.bin'))
    for v in KOKORO:
        t0 = time.time()
        samples, sr = k.create(LINE, voice=v, speed=1.0, lang='en-gb' if v.startswith('b') else 'en-us')
        path = os.path.join(OUT, f'kokoro-{v}.wav')
        sf.write(path, samples, sr)
        print(f'kokoro {v:12} {len(samples) / sr:5.1f}s audio in {time.time() - t0:4.1f}s')


async def edge():
    import edge_tts
    for v in EDGE:
        path = os.path.join(OUT, f'edge-{v}.mp3')
        await edge_tts.Communicate(LINE, v).save(path)
        print(f'edge   {v}')


if __name__ == '__main__':
    which = sys.argv[1:] or ['kokoro', 'edge']
    if 'kokoro' in which:
        kokoro()
    if 'edge' in which:
        asyncio.run(edge())
