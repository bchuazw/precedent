// Minimal MCP client for testing Precedent's Forge MCP server (rovo:mcp) end to end.
//   node tools/mcp-client.mjs login            OAuth 2.1 (dynamic client registration + PKCE), prints a URL to open
//   node tools/mcp-client.mjs list             lists the tools
//   node tools/mcp-client.mjs call <tool> '<json args>'
// Tokens are kept in ~/.codegeist/mcp-token.json and never printed.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ID = 'd93cb16f-78d7-4259-aadd-e989600915f0';
const RESOURCE = `https://mcp.atlassian.com/forge/${APP_ID}`;
const PORT = 8765;
const REDIRECT = `http://localhost:${PORT}/callback`;
const DIR = path.join(os.homedir(), '.codegeist');
const TOKEN_FILE = path.join(DIR, 'mcp-token.json');

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function json(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function discover() {
  const prm = await json(`https://mcp.atlassian.com/.well-known/oauth-protected-resource/forge/${APP_ID}`);
  const issuer = prm.authorization_servers[0];
  const u = new URL(issuer);
  const as = await json(`${u.origin}/.well-known/oauth-authorization-server${u.pathname}`);
  return { prm, as };
}

async function login() {
  const { prm, as } = await discover();
  const client = await json(as.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Precedent MCP test client', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
  });
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  // The consent screen only enables "Accept" once product scopes are requested; ask for what Precedent's tools touch.
  const wanted = (process.env.MCP_SCOPES ?? 'offline_access read:me read:account read:jira-work write:jira-work search:confluence read:page:confluence').split(/\s+/);
  const scopes = wanted.filter((s) => prm.scopes_supported.includes(s)).join(' ');
  const auth = new URL(as.authorization_endpoint);
  for (const [k, v] of Object.entries({ response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state, scope: scopes, resource: RESOURCE })) auth.searchParams.set(k, v);

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/callback') return res.writeHead(404).end();
      const err = u.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end(err ? `Error: ${err}` : 'Precedent MCP test client authorized. You can close this tab.');
      server.close();
      if (err) reject(new Error(`${err}: ${u.searchParams.get('error_description') ?? ''}`));
      else if (u.searchParams.get('state') !== state) reject(new Error('state mismatch'));
      else resolve(u.searchParams.get('code'));
    });
    server.listen(PORT, () => console.log(`AUTHORIZE_URL ${auth.toString()}`));
    setTimeout(() => { server.close(); reject(new Error('timed out waiting for consent')); }, 10 * 60 * 1000);
  });

  const token = await json(as.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier, resource: RESOURCE }),
  });
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ client_id: client.client_id, token_endpoint: as.token_endpoint, ...token, obtained_at: Date.now() }), { mode: 0o600 });
  console.log(`Logged in. Token saved (expires in ${token.expires_in}s, refresh token: ${token.refresh_token ? 'yes' : 'no'}).`);
}

async function accessToken() {
  const t = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  if (Date.now() < t.obtained_at + (t.expires_in - 60) * 1000) return t.access_token;
  if (!t.refresh_token) throw new Error('token expired; run login again');
  const fresh = await json(t.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: t.client_id, resource: RESOURCE }),
  });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ ...t, ...fresh, obtained_at: Date.now() }), { mode: 0o600 });
  return fresh.access_token;
}

// --- MCP over Streamable HTTP (JSON or SSE responses) ---
let session = null;
let nextId = 1;

async function rpc(method, params, { notify = false } = {}) {
  const token = await accessToken();
  const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: nextId++, method, params };
  const res = await fetch(RESOURCE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18', ...(session ? { 'Mcp-Session-Id': session } : {}) },
    body: JSON.stringify(body),
  });
  session = res.headers.get('mcp-session-id') ?? session;
  if (notify) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} -> ${res.status} ${text.slice(0, 500)}`);
  const msgs = (res.headers.get('content-type') ?? '').includes('text/event-stream')
    ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)))
    : [JSON.parse(text)];
  const msg = msgs.find((m) => m.id === body.id) ?? msgs.at(-1);
  if (msg?.error) throw new Error(`${method} error ${JSON.stringify(msg.error)}`);
  return msg?.result;
}

export async function connect() {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'precedent-test', version: '0.1' } });
  await rpc('notifications/initialized', {}, { notify: true });
  return init;
}

/** Tools the server exposes (MCP tools/list). Call connect() first. */
export async function listTools() {
  return (await rpc('tools/list', {})).tools;
}

/** Calls one tool and returns its text content plus the error flag. Call connect() first. */
export async function callTool(name, args) {
  const result = await rpc('tools/call', { name, arguments: args ?? {} });
  return { text: (result.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n'), isError: !!result.isError };
}

const isMain = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const [cmd, ...rest] = isMain ? process.argv.slice(2) : [];
if (!isMain) {
  // imported as a library
} else if (cmd === 'login') await login();
else if (cmd === 'list') {
  const init = await connect();
  console.log(`server: ${init.serverInfo?.name} ${init.serverInfo?.version ?? ''}`);
  const { tools } = await rpc('tools/list', {});
  for (const t of tools) console.log(`- ${t.name}: ${(t.description ?? '').replace(/\s+/g, ' ').slice(0, 140)}\n    input: ${JSON.stringify(t.inputSchema?.properties ?? {})}`);
} else if (cmd === 'call') {
  await connect();
  const result = await rpc('tools/call', { name: rest[0], arguments: rest[1] ? JSON.parse(rest[1]) : {} });
  for (const c of result.content ?? []) console.log(c.type === 'text' ? c.text : JSON.stringify(c));
  if (result.isError) process.exitCode = 1;
} else console.log('usage: node tools/mcp-client.mjs login | list | call <tool> <json>');
