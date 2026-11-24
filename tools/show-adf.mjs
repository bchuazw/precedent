// Prints a compact outline of a Confluence page's ADF (node types, text) to learn template structure.
// Usage: node tools/show-adf.mjs <pageId>
import { atl } from "./atl.mjs";

const id = process.argv[2];
const p = await atl("GET", `/wiki/api/v2/pages/${id}?body-format=atlas_doc_format`);
const adf = JSON.parse(p.body.atlas_doc_format.value);
console.log(`# ${p.title}`);
function outline(n, depth = 0) {
  if (!n || typeof n !== "object") return;
  const pad = "  ".repeat(depth);
  if (n.type === "text") {
    console.log(`${pad}"${n.text.slice(0, 100)}"${n.marks ? " " + n.marks.map((m) => m.type).join("+") : ""}`);
    return;
  }
  const attrs = n.attrs ? " " + JSON.stringify(n.attrs).slice(0, 140) : "";
  console.log(`${pad}<${n.type}>${attrs}`);
  for (const c of n.content ?? []) outline(c, depth + 1);
}
outline(adf);
