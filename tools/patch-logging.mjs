// Gives the logging-standard decision an owner (Ada Isadora) by rewriting the decision item with a mention.
import { randomUUID } from 'node:crypto';
import { atl } from './atl.mjs';

const space = (await atl('GET', '/wiki/api/v2/spaces?keys=SECOPS')).results[0];
const found = await atl('GET', `/wiki/api/v2/spaces/${space.id}/pages?title=${encodeURIComponent('Logging and observability standard')}&limit=1`);
const page = await atl('GET', `/wiki/api/v2/pages/${found.results[0].id}?body-format=atlas_doc_format`);
const adf = JSON.parse(page.body.atlas_doc_format.value);
let changed = false;
(function walk(n) {
  if (!n || typeof n !== 'object') return;
  if (n.type === 'decisionItem' && !JSON.stringify(n).includes('mention')) {
    n.content = [
      { type: 'text', text: 'Keep application logs for 30 days and never log PII, because logs are shipped to a third-party observability vendor (' },
      { type: 'mention', attrs: { id: '60ad31159e21bd0071e67bfa', text: '@Ada Isadora', accessLevel: '' } },
      { type: 'text', text: ').' },
    ];
    n.attrs = { ...n.attrs, localId: n.attrs?.localId ?? randomUUID() };
    changed = true;
  }
  for (const c of n.content ?? []) walk(c);
})(adf);
if (!changed) {
  console.log('already has an owner');
} else {
  await atl('PUT', `/wiki/api/v2/pages/${page.id}`, { id: page.id, status: 'current', title: page.title, version: { number: page.version.number + 1, message: 'Add decision owner' }, body: { representation: 'atlas_doc_format', value: JSON.stringify(adf) } });
  console.log('updated logging decision with owner');
}
