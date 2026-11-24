// Survey: which Confluence pages contain native decision items (ADF decisionItem nodes), and what the
// software projects' issues look like.
import { atl } from "./atl.mjs";

function walk(node, fn, path = []) {
  if (!node || typeof node !== "object") return;
  fn(node, path);
  for (const c of node.content ?? []) walk(c, fn, [...path, node]);
}
const textOf = (n) => {
  let s = "";
  walk(n, (x) => {
    if (x.type === "text") s += x.text;
    if (x.type === "mention") s += x.attrs?.text ?? "@someone";
    if (x.type === "date") s += new Date(Number(x.attrs?.timestamp)).toISOString().slice(0, 10);
  });
  return s.trim();
};

// Page through all pages with ADF bodies.
let cursor = `/wiki/api/v2/pages?limit=100&body-format=atlas_doc_format`;
let pages = 0, withDecisions = 0;
const decisions = [];
while (cursor) {
  const r = await atl("GET", cursor);
  for (const p of r.results) {
    pages++;
    let adf;
    try { adf = JSON.parse(p.body?.atlas_doc_format?.value ?? "null"); } catch { adf = null; }
    if (!adf) continue;
    const found = [];
    walk(adf, (n) => { if (n.type === "decisionItem") found.push({ state: n.attrs?.state, text: textOf(n) }); });
    if (found.length) {
      withDecisions++;
      decisions.push({ id: p.id, title: p.title, spaceId: p.spaceId, found });
    }
  }
  const next = r._links?.next;
  cursor = next ? next.replace(/^\/wiki/, "/wiki") : null;
  if (cursor && !cursor.startsWith("/wiki")) cursor = "/wiki" + cursor;
}
console.log(`pages scanned: ${pages}; pages with decision items: ${withDecisions}`);
for (const d of decisions) {
  console.log(`\n# ${d.title} (page ${d.id}, space ${d.spaceId})`);
  for (const f of d.found) console.log(`  [${f.state}] ${f.text.slice(0, 160)}`);
}

for (const key of ["PLAT", "MOBL", "TD", "MSD", "MP"]) {
  const r = await atl("POST", "/rest/api/3/search/jql", { jql: `project = ${key} ORDER BY created DESC`, maxResults: 8, fields: ["summary", "issuetype", "status", "labels"] });
  const n = await atl("POST", "/rest/api/3/search/approximate-count", { jql: `project = ${key}` }).catch(() => ({ count: "?" }));
  console.log(`\n== ${key}: ~${n.count} issues`);
  for (const i of r.issues) console.log(`  ${i.key.padEnd(9)} ${i.fields.issuetype.name.padEnd(10)} ${i.fields.status.name.padEnd(12)} ${i.fields.summary.slice(0, 90)}`);
}
