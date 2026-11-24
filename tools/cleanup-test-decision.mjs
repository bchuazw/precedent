// Removes test "Decision:" comments added while testing record-decision. Usage: node tools/cleanup-test-decision.mjs MOBL-63 "rewards activity events"
import { atl } from './atl.mjs';

const [issue, needle] = process.argv.slice(2);
const data = await atl('GET', `/rest/api/3/issue/${issue}/comment?maxResults=100`);
let removed = 0;
for (const c of data.comments ?? []) {
  const text = JSON.stringify(c.body);
  if (text.includes('Decision:') && text.includes(needle)) {
    await atl('DELETE', `/rest/api/3/issue/${issue}/comment/${c.id}`);
    removed++;
  }
}
console.log(`removed ${removed} test decision comment(s) from ${issue}`);
