// A coding agent that checks the team's decisions before it writes code: Claude (Anthropic API) with
// Precedent's MCP tools. This script is the MCP host: it lists the tools from Precedent's Forge MCP server,
// offers them to Claude, and runs every tool call Claude makes through the MCP server (tools/mcp-client.mjs).
// The Atlassian OAuth token stays on this machine; Claude only sees tool names, inputs and results.
//
//   node tools/agent-demo.mjs ["task for the agent"]
//
// Needs: `node tools/mcp-client.mjs login` once, and ANTHROPIC_API_KEY in the environment (or in the
// env file named by ANTHROPIC_ENV_FILE). Writes tools/video/out/agent-transcript.json for the demo video.
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { connect, listTools, callTool } from './mcp-client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_ENV_FILE) {
  const vars = parseEnv(fs.readFileSync(process.env.ANTHROPIC_ENV_FILE, 'utf8'));
  if (vars.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = vars.ANTHROPIC_API_KEY;
}

const TASK = process.argv[2] ?? 'Add an SMS one-time passcode fallback to the 2FA sign-in flow, so customers who lose their authenticator app can still get in.';
const SYSTEM = `You are a coding agent working in the team's mobile app and auth-service repositories.
The team records architecture, security and product decisions in Confluence and Jira. The Precedent tools check work against those decisions.
Before you change behaviour that a team decision could cover, check the plan with Precedent. If a decision rules the plan out, do not write the code: say which decision (key, link, why it was made, who owns it) and propose what you would build instead.
Keep the final reply under 120 words.`;

const client = new Anthropic();
await connect();
const mcpTools = await listTools();
const tools = mcpTools.map((t) => ({ name: t.name, description: t.description ?? '', input_schema: t.inputSchema ?? { type: 'object', properties: {} } }));

const transcript = { task: TASK, model: 'claude-opus-5-5', mcpServer: 'Precedent (Forge rovo:mcp)', tools: tools.map((t) => t.name), steps: [] };
const messages = [{ role: 'user', content: TASK }];
console.log(`> ${TASK}\n`);

for (let turn = 0; turn < 8; turn++) {
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: SYSTEM,
    tools,
    messages,
  });
  if (response.stop_reason === 'refusal') throw new Error(`refused: ${response.stop_details?.category ?? 'unknown'}`);
  messages.push({ role: 'assistant', content: response.content });

  for (const block of response.content) {
    if (block.type === 'text' && block.text.trim()) {
      transcript.steps.push({ type: 'assistant', text: block.text.trim() });
      console.log(`${block.text.trim()}\n`);
    }
  }
  if (response.stop_reason === 'pause_turn') continue;
  if (response.stop_reason !== 'tool_use') break;

  const results = [];
  for (const call of response.content.filter((b) => b.type === 'tool_use')) {
    console.log(`  -> ${call.name} ${JSON.stringify(call.input)}`);
    transcript.steps.push({ type: 'tool_call', name: call.name, input: call.input });
    const { text, isError } = await callTool(call.name, call.input);
    let summary = text.slice(0, 400);
    try {
      const j = JSON.parse(text);
      summary = j.headline ? `${j.headline}${(j.findings ?? []).map((f) => `\n  ${f.relation.toUpperCase()} ${f.decision.key}: ${f.reason}`).join('')}` : summary;
    } catch {
      /* not JSON: keep the text */
    }
    console.log(`  <- ${summary.split('\n').join('\n     ')}\n`);
    transcript.steps.push({ type: 'tool_result', name: call.name, summary, isError });
    results.push({ type: 'tool_result', tool_use_id: call.id, content: text, ...(isError ? { is_error: true } : {}) });
  }
  messages.push({ role: 'user', content: results });
}

const out = path.join(here, 'video', 'out');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'agent-transcript.json'), `${JSON.stringify(transcript, null, 2)}\n`);
console.log(`transcript: ${path.join(out, 'agent-transcript.json')}`);
