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
/** Bump when extraction changes, so every installation re-reads its sources once with the new rules. */
export const ENGINE_VERSION = 6;
const queue = new Queue({ key: SYNC_QUEUE });
const INLINE_PAGE_CAP = 25;

/** Account ids and roles only: no names or other personal data in storage. */
const people = (list) => (list ?? []).filter((p) => p.accountId).map((p) => ({ accountId: p.accountId, role: p.role }));
const forStorage = (d) => ({ ...d, owners: people(d.owners), contributors: people(d.contributors), baseStatus: d.status });

export async function indexPage(page) {
  const recs = decisionsFromPage(page).map(forStorage);
  return store.replaceSource(`page:${page.id}`, recs);
}

export async function indexIssue(issue) {
  const base = await jira.jiraBase();
  const recs = [];
  for (const c of await jira.comments(issue.key)) {
    recs.push(
      ...decisionsFromComment({ issueKey: issue.key, issueSummary: issue.summary, issueUrl: `${base}/browse/${issue.key}`, commentId: c.id, authorId: c.authorId, created: c.created, updated: c.updated, adf: c.adf }).map(forStorage),
    );
  }
  return store.replaceSource(`issue:${issue.key}`, recs);
}

/**
 * Recomputes "superseded" across the whole set and writes back only what changed.
 * People are stored as account ids only; names are looked up when a decision is shown (service.withNames),
 * so Precedent keeps no personal data.
 */
export async function recomputeSupersession() {
  const all = await store.allDecisions();
  const sig = (d) => `${d.status}|${d.supersededBy?.id ?? ''}`;
  const before = new Map(all.map((d) => [d.id, sig(d)]));
  const fresh = all.map((d) => ({ ...d, status: d.baseStatus ?? d.status, supersededBy: undefined }));
  applySupersession(fresh);
  const changed = fresh.filter((d) => before.get(d.id) !== sig(d));
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
    return await store.setMeta({ running: false, lastSyncAt: now, lastFullSyncAt: now, pagesScanned, decisions, error: null, engineVersion: ENGINE_VERSION });
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
export async function ensureFresh(maxAgeSeconds = 60, { inline = true } = {}) {
  const meta = await store.getMeta();
  // A queued job that never started (e.g. pushed during a deploy) is re-queued after 5 minutes.
  const neverStarted = meta.running && meta.queuedAt && (!meta.startedAt || Date.parse(meta.startedAt) < Date.parse(meta.queuedAt)) && Date.now() - Date.parse(meta.queuedAt) > 5 * 60 * 1000;
  if (!meta.lastFullSyncAt) {
    const stale = !meta.queuedAt || Date.now() - Date.parse(meta.queuedAt) > 20 * 60 * 1000;
    if (!meta.running || stale || neverStarted) await requestFullSync();
    return { state: 'indexing', meta: await store.getMeta() };
  }
  if (neverStarted) await requestFullSync().catch(() => {});
  // Index built by an older engine: keep serving it, and rebuild it in the background once.
  else if (meta.engineVersion !== ENGINE_VERSION && !meta.running && (!meta.queuedAt || Date.now() - Date.parse(meta.queuedAt) > 10 * 60 * 1000)) await requestFullSync().catch(() => {});
  const ageSec = (Date.now() - Date.parse(meta.lastSyncAt)) / 1000;
  if (ageSec > maxAgeSeconds && !inline) {
    // Pages that list everything (the register) answer from the index and refresh it in the background.
    const queued = meta.refreshQueuedAt ? Date.now() - Date.parse(meta.refreshQueuedAt) < 2 * 60 * 1000 : false;
    if (!queued) {
      await store.setMeta({ refreshQueuedAt: new Date().toISOString() });
      await queue.push({ body: { kind: 'incremental' } }).catch(() => {});
    }
    return { state: 'ready', meta };
  }
  if (ageSec > maxAgeSeconds) {
    const res = await incrementalSync(ageSec / 60).catch(() => null);
    if (!res) await requestFullSync().catch(() => {});
    return { state: 'ready', meta: res ?? meta };
  }
  return { state: 'ready', meta };
}

/** Async consumer and scheduled trigger entry points. */
export async function consumer(event) {
  if (event?.body?.kind === 'full') return fullSync();
  if (event?.body?.kind === 'incremental') {
    const meta = await store.getMeta();
    if (!meta.lastFullSyncAt) return fullSync();
    const ageMin = (Date.now() - Date.parse(meta.lastSyncAt)) / 60000;
    return (await incrementalSync(ageMin, { inline: false })) ?? fullSync();
  }
}

export async function scheduled() {
  const meta = await store.getMeta();
  if (!meta.lastFullSyncAt || meta.engineVersion !== ENGINE_VERSION) return fullSync();
  const ageMin = (Date.now() - Date.parse(meta.lastSyncAt)) / 60000;
  return (await incrementalSync(ageMin, { inline: false })) ?? fullSync();
}
