// Keeps the decision index in step with Confluence and Jira.
//  - fullSync: crawls every current page and every issue with "Decision" comments (async consumer, up to 15 min)
//  - incrementalSync: only pages/issues changed since the last sync (fast enough to run inline)
//  - ensureFresh: called by every read path; never blocks the UI on a full crawl
import { Queue } from '@forge/events';
import * as confluence from './confluence.js';
import * as jira from './jira.js';
import * as store from './store.js';
import { decisionsFromPage, decisionsFromComment, applySupersession } from '../engine/extract.js';

export const SYNC_QUEUE = 'precedent-sync';
const queue = new Queue({ key: SYNC_QUEUE });
const INLINE_PAGE_CAP = 25;

export async function indexPage(page) {
  const recs = decisionsFromPage(page).map((d) => ({ ...d, baseStatus: d.status }));
  return store.replaceSource(`page:${page.id}`, recs);
}

export async function indexIssue(issue) {
  const base = await jira.jiraBase();
  const recs = [];
  for (const c of await jira.comments(issue.key)) {
    recs.push(
      ...decisionsFromComment({ issueKey: issue.key, issueSummary: issue.summary, issueUrl: `${base}/browse/${issue.key}`, commentId: c.id, authorId: c.authorId, authorName: c.authorName, created: c.created, updated: c.updated, adf: c.adf }).map((d) => ({ ...d, baseStatus: d.status })),
    );
  }
  return store.replaceSource(`issue:${issue.key}`, recs);
}

/** Recomputes "superseded" across the whole set and writes back only what changed. */
export async function recomputeSupersession() {
  const all = await store.allDecisions();
  const before = new Map(all.map((d) => [d.id, `${d.status}|${d.supersededBy?.id ?? ''}`]));
  const fresh = all.map((d) => ({ ...d, status: d.baseStatus ?? d.status, supersededBy: undefined }));
  applySupersession(fresh);
  const changed = fresh.filter((d) => before.get(d.id) !== `${d.status}|${d.supersededBy?.id ?? ''}`);
  await store.putDecisions(changed);
  return all.length;
}

export async function fullSync() {
  await store.setMeta({ running: true, startedAt: new Date().toISOString() });
  let pagesScanned = 0;
  let cursor = null;
  const seen = new Set();
  try {
    do {
      const { pages, next } = await confluence.listPages(cursor);
      for (const page of pages) {
        await indexPage(page);
        seen.add(`page:${page.id}`);
      }
      pagesScanned += pages.length;
      cursor = next;
    } while (cursor);
    for (const issue of await jira.issuesWithDecisionComments()) {
      await indexIssue(issue);
      seen.add(`issue:${issue.key}`);
    }
    // Sources that no longer exist or no longer contain decisions (deleted pages, removed comments).
    for (const src of await store.listSources()) if (!seen.has(src)) await store.replaceSource(src, []);
    const decisions = await recomputeSupersession();
    const now = new Date().toISOString();
    return await store.setMeta({ running: false, lastSyncAt: now, lastFullSyncAt: now, pagesScanned, decisions, error: null });
  } catch (e) {
    await store.setMeta({ running: false, error: String(e.message ?? e).slice(0, 300) });
    throw e;
  }
}

/** Indexes what changed in the last `minutes`. Returns null when too much changed to do inline. */
export async function incrementalSync(minutes, { inline = true } = {}) {
  const ids = await confluence.changedPageIds(minutes + 2);
  if (inline && ids.length > INLINE_PAGE_CAP) return null;
  for (const id of ids) {
    try {
      await indexPage(await confluence.getPage(id));
    } catch (e) {
      if (e.status !== 404 && e.status !== 403) throw e;
      await store.replaceSource(`page:${id}`, []);
    }
  }
  const touched = new Set();
  for (const issue of await jira.issuesWithDecisionComments({ updatedWithinMinutes: minutes + 2 })) {
    await indexIssue(issue);
    touched.add(issue.key);
  }
  // Known Jira sources that changed recently may have lost their decision comment.
  const known = (await store.listSources()).filter((s) => s.startsWith('issue:')).map((s) => s.slice(6)).filter((k) => !touched.has(k));
  for (const issue of await jira.recentlyUpdated(known, minutes + 2)) await indexIssue(issue);
  const decisions = await recomputeSupersession();
  return store.setMeta({ lastSyncAt: new Date().toISOString(), decisions, lastIncremental: { pages: ids.length } });
}

export async function requestFullSync() {
  await store.setMeta({ running: true, queuedAt: new Date().toISOString() });
  await queue.push({ body: { kind: 'full' } });
}

/**
 * Makes sure the index is reasonably fresh before a read.
 * @returns {Promise<{state: 'ready'|'indexing', meta: object}>}
 */
export async function ensureFresh(maxAgeSeconds = 60) {
  const meta = await store.getMeta();
  // A queued job that never started (e.g. pushed during a deploy) is re-queued after 5 minutes.
  const neverStarted = meta.running && meta.queuedAt && (!meta.startedAt || Date.parse(meta.startedAt) < Date.parse(meta.queuedAt)) && Date.now() - Date.parse(meta.queuedAt) > 5 * 60 * 1000;
  if (!meta.lastFullSyncAt) {
    const stale = !meta.queuedAt || Date.now() - Date.parse(meta.queuedAt) > 20 * 60 * 1000;
    if (!meta.running || stale || neverStarted) await requestFullSync();
    return { state: 'indexing', meta: await store.getMeta() };
  }
  if (neverStarted) await requestFullSync().catch(() => {});
  const ageSec = (Date.now() - Date.parse(meta.lastSyncAt)) / 1000;
  if (ageSec > maxAgeSeconds) {
    const res = await incrementalSync(ageSec / 60).catch(() => null);
    if (!res) await requestFullSync().catch(() => {});
    return { state: 'ready', meta: res ?? meta };
  }
  return { state: 'ready', meta };
}

/** Async consumer and scheduled trigger entry points. */
export async function consumer(event) {
  if (event?.body?.kind === 'full') await fullSync();
}

export async function scheduled() {
  const meta = await store.getMeta();
  if (!meta.lastFullSyncAt) return fullSync();
  const ageMin = (Date.now() - Date.parse(meta.lastSyncAt)) / 60000;
  return (await incrementalSync(ageMin, { inline: false })) ?? fullSync();
}
