// Records the MCP scene: a terminal-style replay of a real run of tools/agent-demo.mjs (Claude + Precedent's
// MCP tools), from tools/video/out/agent-transcript.json. Nothing in it is invented: every line comes from
// the transcript. Output: out/raw/terminal/terminal.webm + index.json (markers in seconds from video start).
//   node tools/video/terminal.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const T = JSON.parse(fs.readFileSync(path.join(OUT, 'agent-transcript.json'), 'utf8'));
const call = T.steps.find((s) => s.type === 'tool_call');
const result = T.steps.find((s) => s.type === 'tool_result');
const answer = T.steps.filter((s) => s.type === 'assistant').map((s) => s.text).join('\n\n');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Minimal markdown: **bold**, [text](url) as a link-coloured span, "- " bullets. */
function md(text) {
  return text
    .split('\n')
    .map((line) => {
      let h = esc(line)
        .replace(/\*\*\[([^\]]+)\]\(([^)]+)\)\*\*/g, '<b class="link">$1</b>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="link">$1</span>')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      if (/^- /.test(line)) h = `<span class="bullet">•</span> ${h.slice(2)}`;
      return h || '&nbsp;';
    })
    .map((h) => `<div class="ln">${h}</div>`)
    .join('');
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#0b1020;}
  body{display:flex;align-items:center;justify-content:center;font-family:"Cascadia Mono","Consolas",monospace;}
  .win{width:1480px;height:820px;background:#0f172a;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.55);overflow:hidden;border:1px solid #1e293b;display:flex;flex-direction:column}
  .bar{height:44px;background:#111827;display:flex;align-items:center;gap:10px;padding:0 18px;color:#94a3b8;font-size:17px;border-bottom:1px solid #1e293b}
  .dot{width:13px;height:13px;border-radius:50%} .r{background:#f87171}.y{background:#fbbf24}.g{background:#34d399}
  .title{margin-left:14px}
  .term{flex:1;padding:26px 34px;color:#e2e8f0;font-size:21px;line-height:1.5;overflow-y:auto;scrollbar-width:none}
  .muted{color:#94a3b8}.ok{color:#34d399}.warn{color:#fca5a5}.cyan{color:#67e8f9}.violet{color:#c4b5fd}
  .box{border:1px solid #334155;border-radius:10px;padding:12px 16px;margin:12px 0;background:#111a2e}
  .box.call{border-color:#6366f1}.box.res{border-color:#f87171;background:#1f1316}
  .link{color:#93c5fd;text-decoration:underline}
  .answer b{color:#fff}
  .ln{min-height:1.5em}
  .bullet{color:#a78bfa}
  .hidden{display:none}
  .cursor{display:inline-block;width:11px;height:22px;background:#e2e8f0;vertical-align:-3px;animation:b 1s steps(1) infinite}
  @keyframes b{50%{opacity:0}}
</style></head><body><div class="win">
  <div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
    <span class="title">coding agent · Claude (claude-opus-5-5) · MCP server: Precedent (Forge rovo:mcp)</span></div>
  <div class="term" id="t">
    <div id="cmd"><span class="ok">$</span> <span id="cmdtext"></span><span class="cursor" id="c1"></span></div>
    <div id="conn" class="hidden"><div class="muted">Connected to MCP server <span class="cyan">Precedent decisions</span> (OAuth, permission-filtered for this user)</div>
      <div class="muted">tools: ${T.tools.map((n) => `<span class="violet">${esc(n)}</span>`).join(', ')}</div></div>
    <div id="task" class="hidden" style="margin-top:16px"><span class="cyan">you ›</span> <span id="tasktext"></span><span class="cursor hidden" id="c2"></span></div>
    <div id="call" class="box call hidden"><span class="violet">● tool call</span> <b>${esc(call.name)}</b><div class="muted">${esc(JSON.stringify(call.input))}</div></div>
    <div id="res" class="box res hidden"><span class="warn">● result</span> ${md(result.summary.replace(/\n {2}/g, '\n'))}</div>
    <div id="ans" class="answer hidden" style="margin-top:10px"><span class="ok">claude ›</span><div id="anstext"></div></div>
  </div></div>
<script>
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const term = () => document.getElementById('t');
  const follow = () => term().scrollTo({ top: term().scrollHeight, behavior: 'smooth' });
  const show = (id) => { document.getElementById(id).classList.remove('hidden'); follow(); };
  async function type(el, text, ms) { for (const ch of text) { el.textContent += ch; await sleep(ms); } }
  window.run = async () => {
    await sleep(700);
    await type(document.getElementById('cmdtext'), 'node tools/agent-demo.mjs', 45);
    await sleep(500); document.getElementById('c1').remove(); show('conn'); await window.mark('connected');
    await sleep(1600); show('task'); show('c2');
    await type(document.getElementById('tasktext'), ${JSON.stringify(T.task)}, 28);
    document.getElementById('c2').remove(); await window.mark('task');
    await sleep(1400); show('call'); await window.mark('tool');
    await sleep(2200); show('res'); await window.mark('result');
    await sleep(2400); show('ans'); await window.mark('answer');
    const holder = document.getElementById('anstext');
    const html = ${JSON.stringify(md(answer))};
    const tmp = document.createElement('div'); tmp.innerHTML = html;
    for (const line of Array.from(tmp.children)) { holder.appendChild(line); follow(); await sleep(420); }
    await window.mark('answer-done');
    await sleep(4500);
  };
</script></body></html>`;

const dir = path.join(OUT, 'raw', 'terminal');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir, size: { width: 1600, height: 900 } } });
const t0 = Date.now();
const markers = {};
const page = await context.newPage();
await page.exposeFunction('mark', (m) => { markers[m] = (Date.now() - t0) / 1000; });
await page.setContent(html);
await page.evaluate(() => window.run());
markers.end = (Date.now() - t0) / 1000;
const video = page.video();
await context.close();
await browser.close();
const file = await video.path();
fs.renameSync(file, path.join(dir, 'terminal.webm'));
fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ video: 'terminal.webm', markers }, null, 1));
console.log('terminal.webm', markers);
