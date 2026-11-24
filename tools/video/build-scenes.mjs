// Wraps each scenes/<name>.scene.js body with scenes/prelude.js into out/scenes/<name>.js, a single
// `async (page) => { ... }` function that the Playwright browser_run_code tool can load by filename.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const prelude = fs.readFileSync(path.join(dir, 'scenes', 'prelude.js'), 'utf8');
const out = path.join(dir, 'out', 'scenes');
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(path.join(dir, 'scenes')).filter((f) => f.endsWith('.scene.js'))) {
  const body = fs.readFileSync(path.join(dir, 'scenes', f), 'utf8');
  const name = f.replace('.scene.js', '');
  fs.writeFileSync(path.join(out, `${name}.js`), `async (page) => {\n${prelude}\n// ---- scene: ${name} ----\n${body}\n}\n`);
  console.log(`out/scenes/${name}.js`);
}
