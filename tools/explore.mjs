// One-off survey of the demo site's seeded content: Confluence spaces/pages (and any decision items),
// Jira projects and issue types. Prints a compact summary.
import { atl } from "./atl.mjs";

const spaces = await atl("GET", "/wiki/api/v2/spaces?limit=100");
console.log(`Confluence spaces: ${spaces.results.length}`);
for (const s of spaces.results) console.log(`  ${s.key.padEnd(12)} ${s.type.padEnd(10)} ${s.name}`);

// Pages containing decision items (ADF decisionList) are findable with CQL on macro/title; try a few probes.
const probes = [
  'type=page AND title ~ "decision"',
  'type=page AND title ~ "ADR"',
  'type=page AND label = "decision"',
  'type=page AND text ~ "we decided"',
  'type=page AND text ~ "decision"',
];
for (const cql of probes) {
  try {
    const r = await atl("GET", `/wiki/rest/api/search?limit=10&cql=${encodeURIComponent(cql)}`);
    console.log(`\nCQL [${cql}] -> ${r.totalSize ?? r.size}`);
    for (const x of r.results.slice(0, 8)) console.log(`  - ${x.content?.title ?? x.title} (${x.resultGlobalContainer?.title ?? ""}) id=${x.content?.id}`);
  } catch (e) {
    console.log(`\nCQL [${cql}] failed: ${e.message.slice(0, 120)}`);
  }
}

const total = await atl("GET", "/wiki/rest/api/search?limit=1&cql=" + encodeURIComponent("type=page"));
console.log(`\nTotal Confluence pages: ${total.totalSize}`);

const projects = await atl("GET", "/rest/api/3/project/search?maxResults=100");
console.log(`\nJira projects: ${projects.total}`);
for (const p of projects.values) console.log(`  ${p.key.padEnd(10)} ${p.projectTypeKey.padEnd(16)} ${p.style ?? ""} ${p.name}`);

const types = await atl("GET", "/rest/api/3/issuetype");
console.log(`\nIssue types: ${[...new Set(types.map((t) => t.name))].join(", ")}`);

const issues = await atl("POST", "/rest/api/3/search/jql", { jql: "order by created DESC", maxResults: 1, fields: ["summary"] }).catch((e) => ({ err: e.message }));
console.log(`\nJQL probe: ${JSON.stringify(issues).slice(0, 300)}`);
