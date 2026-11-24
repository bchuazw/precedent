// Resolvers for the Jira UI (work-item side panel, Decision register page) and the Confluence page byline,
// plus the dynamic status shown in the panel's collapsed header and in the byline.
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

resolver.define('checkPage', async ({ context }) => {
  const id = context?.extension?.content?.id;
  if (!id) return { error: 'No page in context.' };
  return service.checkPage(id, { maxAge: 45 });
});

resolver.define('register', async () => service.register());

resolver.define('atRisk', async () => service.workAtRisk());

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
    const res = await service.checkIssue(key, { maxAge: 300, teams: false });
    if (res.counts.conflict) return { status: { type: 'lozenge', value: { label: `${res.counts.conflict} conflict${res.counts.conflict > 1 ? 's' : ''}`, type: 'removed' } } };
    if (res.counts.aligned) return { status: { type: 'lozenge', value: { label: 'Aligned', type: 'success' } } };
    if (res.counts.related) return { status: { type: 'badge', value: { label: String(res.counts.related) } } };
    return {};
  } catch (e) {
    console.error('issueStatus', e);
    return {};
  }
}

/** Confluence byline title: "1 conflict with past decisions", "Follows 2 decisions" or plain "Past decisions". */
export async function pageStatus(payload) {
  const id = payload?.extension?.content?.id ?? payload?.context?.extension?.content?.id ?? null;
  const idle = { title: 'Past decisions', tooltip: "Check this page against your team's recorded decisions" };
  if (!id) return idle;
  try {
    const res = await service.checkPage(id, { maxAge: 300, teams: false });
    const n = res.counts;
    if (n.conflict) return { title: `${n.conflict} conflict${n.conflict > 1 ? 's' : ''} with past decisions`, tooltip: 'This page contradicts a recorded team decision' };
    if (n.aligned) return { title: `Follows ${n.aligned} decision${n.aligned > 1 ? 's' : ''}`, tooltip: 'This page is in line with recorded team decisions' };
    if (n.related) return { title: `${n.related} related decision${n.related > 1 ? 's' : ''}`, tooltip: 'Recorded team decisions on the same topic' };
    return idle;
  } catch (e) {
    console.error('pageStatus', e);
    return idle;
  }
}
