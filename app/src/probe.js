// TEMPORARY debug web trigger (removed before submission). Runs as the app, without visibility filtering.
//   ?op=meta | ?op=sync | ?op=list | ?op=check&issue=KEY | ?op=proposal&text=... | ?op=search&q=...
import * as store from './lib/store.js';
import { requestFullSync, incrementalSync } from './lib/sync.js';
import * as service from './lib/service.js';

const json = (obj) => ({ statusCode: 200, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify(obj, null, 1) });

export async function probe(request) {
  const q = Object.fromEntries(Object.entries(request?.queryParameters ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  try {
    switch (q.op) {
      case 'sync':
        await requestFullSync();
        return json({ queued: true });
      case 'inc':
        return json(await incrementalSync(Number(q.minutes) || 30));
      case 'list': {
        const all = await store.allDecisions();
        return json({ count: all.length, decisions: all.map((d) => ({ key: d.key, status: d.status, title: d.title, chosen: d.chosen, rejected: d.rejected, scope: d.scope, src: d.source?.title })) });
      }
      case 'check':
        return json(await service.checkIssue(q.issue, { checkVisibility: false, maxAge: 30 }));
      case 'proposal':
        return json(await service.checkProposal(q.text, { checkVisibility: false }));
      case 'search':
        return json(await service.search(q.q, { checkVisibility: false }));
      default:
        return json(await store.getMeta());
    }
  } catch (e) {
    return json({ error: String(e?.stack ?? e) });
  }
}
