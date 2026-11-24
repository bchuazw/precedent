// Resolvers for the Jira UI (work-item side panel and the Decision register page), plus the dynamic
// status shown in the side panel's collapsed header.
import Resolver from '@forge/resolver';
import * as service from '../lib/service.js';
import * as store from '../lib/store.js';
import { requestFullSync, incrementalSync } from '../lib/sync.js';

const resolver = new Resolver();

const issueKeyOf = (context) => context?.extension?.issue?.key ?? null;

resolver.define('check', async ({ context }) => {
  const key = issueKeyOf(context);
  if (!key) return { error: 'No work item in context.' };
  return service.checkIssue(key, { maxAge: 45 });
});

resolver.define('register', async () => service.register());

resolver.define('status', async () => store.getMeta());

resolver.define('syncNow', async () => {
  const meta = await store.getMeta();
  if (!meta.lastFullSyncAt) {
    await requestFullSync();
    return { state: 'indexing' };
  }
  const ageMin = (Date.now() - Date.parse(meta.lastSyncAt)) / 60000;
  const res = await incrementalSync(Math.max(ageMin, 10));
  if (!res) {
    await requestFullSync();
    return { state: 'indexing' };
  }
  return { state: 'ready', meta: res };
});

resolver.define('reindex', async () => {
  await requestFullSync();
  return { state: 'indexing' };
});

export const handler = resolver.getDefinitions();

/** Collapsed-header status for the side panel: "2 conflicts", "Aligned" or nothing. */
export async function issueStatus(payload) {
  const key = payload?.extension?.issue?.key ?? payload?.context?.extension?.issue?.key ?? payload?.issueKey ?? null;
  if (!key) return {};
  try {
    const res = await service.checkIssue(key, { maxAge: 300 });
    if (res.counts.conflict) return { status: { type: 'lozenge', value: { label: `${res.counts.conflict} conflict${res.counts.conflict > 1 ? 's' : ''}`, type: 'removed' } } };
    if (res.counts.aligned) return { status: { type: 'lozenge', value: { label: 'Aligned', type: 'success' } } };
    if (res.counts.related) return { status: { type: 'badge', value: { label: String(res.counts.related) } } };
    return {};
  } catch (e) {
    console.error('issueStatus', e);
    return {};
  }
}
