// Tiny Atlassian Cloud REST helper used by the seed script.
// Credentials: ATL_EMAIL and ATL_API_TOKEN environment variables, or the files atlassian-email and
// atlassian-api-token in ~/.codegeist. The token is never printed.
// Usage: ATL_SITE=https://<site>.atlassian.net node tools/atl.mjs <METHOD> <path> [jsonBodyFile]
//   e.g. node tools/atl.mjs GET "/wiki/api/v2/spaces?limit=50"
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SITE = process.env.ATL_SITE ?? "https://one-atlas-rsvn.atlassian.net";
const dir = join(homedir(), ".codegeist");
const email = (process.env.ATL_EMAIL ?? readFileSync(join(dir, "atlassian-email"), "utf8")).trim();
const token = (process.env.ATL_API_TOKEN ?? readFileSync(join(dir, "atlassian-api-token"), "utf8")).trim();
const auth = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");

export async function atl(method, path, body) {
  const res = await fetch(SITE + path, {
    method,
    headers: {
      Authorization: auth,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> HTTP ${res.status}: ${typeof data === "string" ? data.slice(0, 400) : JSON.stringify(data).slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

if (process.argv[1]?.endsWith("atl.mjs")) {
  const [method, path, bodyFile] = process.argv.slice(2);
  const body = bodyFile ? JSON.parse(readFileSync(bodyFile, "utf8")) : undefined;
  const out = await atl(method, path, body);
  console.log(JSON.stringify(out, null, 2));
}
