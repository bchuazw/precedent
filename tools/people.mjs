// Lists human users on the demo site and the MOBL project's issue types (to plan seed data).
import { atl } from './atl.mjs';

const users = await atl('GET', '/rest/api/3/users/search?maxResults=200');
const humans = users.filter((u) => u.accountType === 'atlassian' && u.active);
console.log(`human users: ${humans.length}`);
for (const u of humans.slice(0, 60)) console.log(`  ${u.accountId}  ${u.displayName}`);

const meta = await atl('GET', '/rest/api/3/issue/createmeta/MOBL/issuetypes');
console.log(`\nMOBL issue types: ${(meta.issueTypes ?? meta.values ?? []).map((t) => `${t.name}(${t.id})`).join(', ')}`);
const epics = await atl('POST', '/rest/api/3/search/jql', { jql: 'project = MOBL AND issuetype = Epic', maxResults: 20, fields: ['summary', 'status'] });
console.log(`\nMOBL epics:`);
for (const i of epics.issues) console.log(`  ${i.key} ${i.fields.summary} [${i.fields.status.name}]`);
const me = await atl('GET', '/rest/api/3/myself');
console.log(`\nme: ${me.displayName} ${me.accountId}`);
