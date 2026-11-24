// Receives screencast frames posted by the browser recorder (scenes/*.js run inside the logged-in Playwright
// browser) and writes them to out/raw/<segment>/ with an index of timestamps and markers.
//   node tools/video/recv.mjs            (listens on 127.0.0.1:8899)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAW = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'raw');
const segs = new Map();

function seg(name) {
  if (!segs.has(name)) segs.set(name, { frames: [], markers: {} });
  return segs.get(name);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const name = (u.searchParams.get('seg') ?? 'default').replace(/[^a-z0-9_-]/gi, '');
  const dir = path.join(RAW, name);
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const s = seg(name);
    if (u.pathname === '/start') {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      segs.set(name, { frames: [], markers: {}, startedAt: Number(u.searchParams.get('t')) });
    } else if (u.pathname === '/frame') {
      const file = `${String(s.frames.length + 1).padStart(5, '0')}.jpg`;
      fs.writeFileSync(path.join(dir, file), Buffer.from(Buffer.concat(chunks).toString('utf8'), 'base64'));
      s.frames.push({ file, t: Number(u.searchParams.get('t')) });
    } else if (u.pathname === '/mark') {
      s.markers[u.searchParams.get('m')] = Number(u.searchParams.get('t'));
    } else if (u.pathname === '/stop') {
      const cur = seg(name);
      fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ ...cur, stoppedAt: Number(u.searchParams.get('t')) }, null, 1));
      console.log(`${name}: ${cur.frames.length} frames, markers ${Object.keys(cur.markers).join(', ')}`);
    }
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
  });
});
server.listen(8899, '127.0.0.1', () => console.log('frame receiver on 127.0.0.1:8899'));
