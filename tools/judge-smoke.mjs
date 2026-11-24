// Reproduces the README's "Try it in five minutes" steps on a fresh site:
// one Confluence decision item and one Jira work item that contradicts it.
//   ATL_SITE=https://<site>.atlassian.net node tools/judge-smoke.mjs [PROJECT_KEY]
import { randomUUID } from 'node:crypto';
import { atl, SITE } from './atl.mjs';

const projectKey = process.argv[2] ?? 'SCRUM';
const SPACE_KEY = 'ENG';
const TITLE = 'Sign-in security decisions';
const STATEMENT = 'Use passkeys with a TOTP fallback instead of SMS one-time passcodes for 2FA, because SIM-swap attacks make SMS codes unsafe.';
const SUMMARY = 'Add an SMS one-time passcode fallback for 2FA';

let space = (await atl('GET', `/wiki/api/v2/spaces?keys=${SPACE_KEY}`)).results?.[0];
if (!space) {
  await atl('POST', '/wiki/rest/api/space', { key: SPACE_KEY, name: 'Engineering' });
  space = (await atl('GET', `/wiki/api/v2/spaces?keys=${SPACE_KEY}`)).results[0];
  console.log(`created space ${SPACE_KEY}`);
}

const existing = (await atl('GET', `/wiki/api/v2/spaces/${space.id}/pages?title=${encodeURIComponent(TITLE)}&limit=1`)).results?.[0];
if (existing) console.log(`page exists: ${existing.id}`);
else {
  const adf = {
    type: 'doc',
    version: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Decisions from the March security review.' }] },
      { type: 'decisionList', attrs: { localId: randomUUID() }, content: [{ type: 'decisionItem', attrs: { localId: randomUUID(), state: 'DECIDED' }, content: [{ type: 'text', text: STATEMENT }] }] },
    ],
  };
  const page = await atl('POST', '/wiki/api/v2/pages', { spaceId: space.id, status: 'current', title: TITLE, body: { representation: 'atlas_doc_format', value: JSON.stringify(adf) } });
  console.log(`created page ${page.id}`);
}

const found = await atl('POST', '/rest/api/3/search/jql', { jql: `project = ${projectKey} AND summary ~ "\\"${SUMMARY}\\""`, maxResults: 1, fields: ['summary'] });
if (found.issues?.[0]) console.log(`issue exists: ${SITE}/browse/${found.issues[0].key}`);
else {
  const types = await atl('GET', `/rest/api/3/issue/createmeta/${projectKey}/issuetypes`);
  const type = (types.issueTypes ?? types.values ?? []).find((t) => ['Story', 'Task'].includes(t.name)) ?? (types.issueTypes ?? types.values)[0];
  const issue = await atl('POST', '/rest/api/3/issue', { fields: { project: { key: projectKey }, summary: SUMMARY, issuetype: { id: type.id } } });
  console.log(`created issue ${SITE}/browse/${issue.key}`);
}
