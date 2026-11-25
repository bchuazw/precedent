// Renders the title cards (1920x1080 PNG) for the demo video into out/cards/.
//   node tools/video/cards.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'cards');
fs.mkdirSync(OUT, { recursive: true });

const base = `
  *{box-sizing:border-box}
  html,body{margin:0;width:1920px;height:1080px}
  body{background:radial-gradient(1200px 700px at 15% 10%,#16244a 0%,#0b1124 55%,#070b18 100%);color:#e8edf7;
       font-family:"Segoe UI","Inter",system-ui,sans-serif;display:flex;flex-direction:column;justify-content:center;padding:0 140px}
  .eyebrow{color:#7aa7ff;font-size:30px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;margin-bottom:22px}
  h1{font-size:88px;line-height:1.05;margin:0 0 26px;font-weight:700;letter-spacing:-.01em}
  .sub{font-size:38px;color:#b9c4dc;line-height:1.35;max-width:1500px}
  .brand{display:flex;align-items:center;gap:26px}
  .logo{width:104px;height:104px;border-radius:26px;background:linear-gradient(135deg,#2f6bff,#7b5cff);display:flex;align-items:center;justify-content:center;font-size:64px;font-weight:800;color:#fff;box-shadow:0 20px 60px rgba(47,107,255,.35)}
  .chips{display:flex;flex-wrap:wrap;gap:14px;margin-top:40px}
  .chip{border:1px solid #2b3a63;background:#0f1833;color:#c9d5f2;border-radius:999px;padding:12px 24px;font-size:26px}
  .card{background:#0f1833;border:1px solid #26365e;border-radius:22px;padding:30px 34px;box-shadow:0 24px 70px rgba(0,0,0,.35)}
  .k{font-size:24px;color:#8fa2c9;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px}
  .t{font-size:34px;font-weight:650;line-height:1.3}
  .muted{color:#94a3c4}
  .red{color:#ff8b8b}.green{color:#6fe0a8}.blue{color:#8db4ff}
`;

const cards = {
  problem: `
    <div class="eyebrow">The problem</div>
    <h1>Teams decide. Then they forget.</h1>
    <div style="display:flex;gap:46px;align-items:stretch;margin-top:46px">
      <div class="card" style="flex:1">
        <div class="k">Confluence · 12 March</div>
        <div class="t">ADR-007 · Second factor for customer sign-in</div>
        <div class="sub" style="font-size:30px;margin-top:14px">Use passkeys with a TOTP fallback <span class="green">instead of</span> <span class="red">SMS one-time passcodes</span>, because SIM-swap attacks make SMS unsafe.</div>
      </div>
      <div style="display:flex;align-items:center;font-size:70px;color:#5b6f9c">→</div>
      <div class="card" style="flex:1;border-color:#6b2a35;background:#1c1220">
        <div class="k">Jira · November</div>
        <div class="t">MOBL-58 · Add SMS one-time passcode fallback for 2FA</div>
        <div class="sub" style="font-size:30px;margin-top:14px">Written by someone who wasn't in the room. Nobody connects the two.</div>
      </div>
    </div>`,
  title: `
    <div class="brand"><div class="logo">P</div><div style="font-size:120px;font-weight:800;letter-spacing:-.02em">Precedent</div></div>
    <div class="sub" style="font-size:46px;margin-top:34px;max-width:1550px">Your team already decided. Precedent makes sure you remember — <span class="blue">before you ship.</span></div>
    <div class="chips"><span class="chip">Atlassian Forge</span><span class="chip">Jira</span><span class="chip">Confluence</span><span class="chip">Rovo agent</span><span class="chip">MCP server</span><span class="chip">Teamwork Graph</span></div>`,
  how: `
    <div class="eyebrow">How it works</div>
    <h1 style="font-size:72px">Decisions in. Explainable checks out.</h1>
    <div style="display:grid;grid-template-columns:1fr 1.15fr 1fr;gap:34px;margin-top:40px;align-items:stretch">
      <div class="card"><div class="k">Reads</div>
        <div class="t" style="font-size:30px;line-height:1.55">Confluence decision &amp; DACI pages<br>Decision items in any page<br>Jira “Decision:” comments<br><span class="muted">“Supersedes ADR-003” links</span></div></div>
      <div class="card" style="border-color:#3b5bd6"><div class="k">Understands</div>
        <div class="t" style="font-size:30px;line-height:1.55">What was <span class="green">chosen</span>, what was <span class="red">ruled out</span>, for what scope<br>BM25 relevance + rules<br>→ <span class="red">conflict</span> · <span class="green">aligned</span> · related, with evidence<br><span class="muted">No LLM inside: fast, free, reproducible</span></div></div>
      <div class="card"><div class="k">Shows up in</div>
        <div class="t" style="font-size:30px;line-height:1.55">Jira work-item panel<br>Confluence page byline<br>Rovo agent (7 actions)<br>MCP tools for coding agents<br>Decision register · Work at risk</div></div>
    </div>`,
  trust: `
    <div class="eyebrow">Built to be trusted</div>
    <h1 style="font-size:72px">Safe to install on day one.</h1>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:40px">
      <div class="card"><div class="t">Permission-filtered</div><div class="sub" style="font-size:28px;margin-top:8px">Every result is limited to sources the asker can already open — in Jira, Confluence, Rovo and over MCP.</div></div>
      <div class="card"><div class="t">No personal data stored</div><div class="sub" style="font-size:28px;margin-top:8px">Decision records keep account ids only; names are looked up when shown.</div></div>
      <div class="card"><div class="t">Runs on Atlassian</div><div class="sub" style="font-size:28px;margin-top:8px">Forge functions and storage only. No external services, no egress.</div></div>
      <div class="card"><div class="t">Explains itself</div><div class="sub" style="font-size:28px;margin-top:8px">Every flag cites the decision, what it ruled out, why, and who owns it.</div></div>
    </div>`,
  close: `
    <div class="brand"><div class="logo">P</div><div style="font-size:110px;font-weight:800">Precedent</div></div>
    <div class="sub" style="font-size:46px;margin-top:30px">Your team already decided.<br>Precedent makes sure you remember — <span class="blue">before you ship.</span></div>
    <div class="sub" style="font-size:30px;margin-top:46px">github.com/bchuazw/precedent · Atlassian Codegeist 2026</div>`,
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const [name, body] of Object.entries(cards)) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${base}</style></head><body>${body}</body></html>`);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`cards/${name}.png`);
}
await browser.close();
