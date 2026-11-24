// Checks every demo work item through Precedent's MCP tools and prints a compact verdict table.
//   node tools/check-all.mjs [development|production] [KEY ...]
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const env = ['development', 'staging', 'production'].includes(args[0]) ? args.shift() : 'development';
const tool = env === 'production' ? 'check-work-item' : `check-work-item_${env}`;
const keys = args.length ? args : ['MOBL-58', 'MOBL-59', 'MOBL-60', 'MOBL-61', 'MOBL-62', 'MOBL-63', 'MOBL-64', 'MOBL-65', 'MOBL-66', 'MOBL-50'];

for (const key of keys) {
  const out = execFileSync(process.execPath, [path.join(here, 'mcp-client.mjs'), 'call', tool, JSON.stringify({ issueKey: key })], { encoding: 'utf8' });
  let j;
  try {
    j = JSON.parse(out);
  } catch {
    console.log(`${key} ERROR ${out.slice(0, 200)}`);
    continue;
  }
  if (j.error) {
    console.log(`${key} ERROR ${j.error}`);
    continue;
  }
  console.log(`${key}  ${j.workItem?.summary}\n      => ${j.headline}`);
  for (const f of j.findings ?? []) console.log(`         [${f.relation}/${f.confidence}] ${f.decision.key} - ${f.reason}`);
}
