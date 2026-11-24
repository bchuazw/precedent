// High-level operations shared by the Jira panel, the Rovo agent actions and the MCP tools.
// Every result shown to a person is filtered to decisions whose source they can already open.
import * as store from './store.js';
import * as confluence from './confluence.js';
import * as jira from './jira.js';
import { ensureFresh, indexPage, indexIssue, recomputeSupersession } from './sync.js';
import { adfDoc, adfParagraph } from '../engine/adf.js';
import { randomUUID } from 'node:crypto';
import { checkWork, searchDecisions, buildIndex } from '../engine/match.js';
import { label } from '../engine/text.js';
import { withTeams } from './graph.js';

/** Visibility check per invocation (cached). */
function visibilityChecker() {
  const cache = new Map();
  return async (d) => {
    const key = d.source?.kind === 'jira-comment' ? `i:${d.source.issueKey}` : `p:${d.source?.id}`;
    if (!cache.has(key)) cache.set(key, d.source?.kind === 'jira-comment' ? jira.userCanViewIssue(d.source.issueKey) : confluence.userCanView(d.source?.id));
    return cache.get(key);
  };
}

/** Keeps only items whose source the viewer can open. Checks run 8 at a time (one call per distinct source). */
async function visibleOnly(items, getDecision, { checkVisibility = true } = {}) {
  if (!checkVisibility) return items;
  const can = visibilityChecker();
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await can(getDecision(items[i]));
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, worker));
  return items.filter((_, i) => results[i]);
}

/** Plain-language reason for a finding. */
export function explain(f, d) {
  const ev = f.evidence?.[0] ?? {};
  const when = d.decidedAt ? ` on ${d.decidedAt}` : '';
  const scope = (d.scope ?? []).length ? ` for ${d.scope.join(', ')}` : '';
  switch (ev.type) {
    case 'mentions-rejected':
      return `Mentions ${quote(ev.term)}, which ${d.key} ruled out${scope}${when}.`;
    case 'removes-rejected':
      return `Removes ${quote(ev.term)}, in line with ${d.key}.`;
    case 'mentions-chosen':
      return `Uses ${quote(ev.term)}, the option ${d.key} chose${scope}.`;
    case 'mentions-rejected-out-of-scope':
      return `Mentions ${quote(ev.term)}, which ${d.key} ruled out${scope}; this work may be outside that scope.`;
    case 'topic-overlap':
      return `Touches the same topic as ${d.key}: ${(ev.matched ?? []).slice(0, 3).map(label).join(', ')}.`;
    default:
      return `Related to ${d.key}.`;
  }
}

const quote = (s) => `“${s}”`;

/** Compact decision view for UIs, Rovo and MCP. */
export function view(d) {
  if (!d) return null;
  return {
    id: d.id,
    key: d.key,
    title: d.title,
    statement: d.statement,
    status: d.status,
    decidedAt: d.decidedAt,
    chosen: d.chosen,
    rejected: d.rejected,
    scope: d.scope,
    rationale: d.rationale,
    owners: (d.owners ?? []).map((o) => ({ accountId: o.accountId, name: o.name, role: o.role })),
    source: { kind: d.source?.kind, title: d.source?.title, url: d.source?.url, space: d.source?.spaceName ?? null, issueKey: d.source?.issueKey ?? null },
    supersededBy: d.supersededBy ?? null,
  };
}

async function decisionsAndState(maxAge) {
  const fresh = await ensureFresh(maxAge);
  const decisions = await store.allDecisions();
  return { decisions, state: fresh.state, meta: fresh.meta };
}

function enrich(result, byId) {
  return result.findings.map((f) => {
    const d = byId.get(f.decisionId);
    return { ...f, reason: explain(f, d), decision: view(d) };
  });
}

/** For conflicts, look up the owners' teams in Teamwork Graph ("talk to Ryan Lee, Mobile Platform"). */
async function addTeams(findings, { enabled = true } = {}) {
  if (!enabled) return findings;
  return Promise.all(
    findings.map(async (f) => (f.relation === 'conflict' ? { ...f, decision: { ...f.decision, owners: await withTeams(f.decision.owners) } } : f)),
  );
}

/** Checks a Jira work item against decisions. */
export async function checkIssue(issueKey, { checkVisibility = true, maxAge = 60 } = {}) {
  const [work, { decisions, state, meta }] = await Promise.all([jira.getWorkItem(issueKey, { asUser: checkVisibility }), decisionsAndState(maxAge)]);
  const byId = new Map(decisions.map((d) => [d.id, d]));
  const result = checkWork(work, decisions, { index: buildIndex(decisions) });
  const visible = await visibleOnly(enrich(result, byId), (f) => byId.get(f.decisionId), { checkVisibility });
  const findings = await addTeams(visible, { enabled: checkVisibility });
  return summarise({ work, findings, state, meta, total: decisions.length });
}

/** Checks a free-text proposal against decisions. */
export async function checkProposal(text, { checkVisibility = true } = {}) {
  const { decisions, state, meta } = await decisionsAndState(120);
  const byId = new Map(decisions.map((d) => [d.id, d]));
  const result = checkWork({ summary: text }, decisions);
  const visible = await visibleOnly(enrich(result, byId), (f) => byId.get(f.decisionId), { checkVisibility });
  const findings = await addTeams(visible, { enabled: checkVisibility });
  return summarise({ work: { summary: text }, findings, state, meta, total: decisions.length });
}

function summarise({ work, findings, state, meta, total }) {
  const counts = { conflict: 0, aligned: 0, related: 0 };
  for (const f of findings) if (counts[f.relation] !== undefined) counts[f.relation]++;
  const headline = counts.conflict
    ? `${counts.conflict} possible conflict${counts.conflict > 1 ? 's' : ''} with past decisions`
    : counts.aligned
      ? `In line with ${counts.aligned} past decision${counts.aligned > 1 ? 's' : ''}`
      : counts.related
        ? `${counts.related} related decision${counts.related > 1 ? 's' : ''}`
        : state === 'indexing'
          ? 'Indexing your decisions…'
          : 'No related decisions found';
  return { work: { key: work.key ?? null, summary: work.summary, url: work.url ?? null }, headline, counts, findings, indexState: state, indexedDecisions: total, lastSyncAt: meta?.lastSyncAt ?? null };
}

/** Free-text search. */
export async function search(query, { limit = 5, checkVisibility = true } = {}) {
  const { decisions, state } = await decisionsAndState(120);
  const hits = searchDecisions(query, decisions.filter((d) => d.status !== 'proposed'), { limit: limit * 2 });
  const visible = await visibleOnly(hits, (h) => h.decision, { checkVisibility });
  return { query, indexState: state, results: visible.slice(0, limit).map((h) => ({ score: h.score, decision: view(h.decision) })) };
}

/** One decision by key ("ADR-007") or id. */
export async function getDecision(ref, { checkVisibility = true } = {}) {
  const { decisions } = await decisionsAndState(120);
  const r = String(ref ?? '').trim().toLowerCase();
  const d = decisions.find((x) => x.id.toLowerCase() === r || x.key?.toLowerCase() === r) ?? decisions.find((x) => x.title?.toLowerCase().includes(r));
  if (!d) return { found: false, ref };
  const [ok] = await visibleOnly([d], (x) => x, { checkVisibility });
  if (!ok) return { found: false, ref };
  const supersedes = decisions.filter((x) => x.supersededBy?.id === d.id).map(view);
  const base = view(d);
  const owners = checkVisibility ? await withTeams(base.owners) : base.owners;
  return { found: true, decision: { ...base, owners, background: d.background, outcome: d.outcome, options: d.options, contributors: d.contributors, supersedes } };
}

/** Most recent decisions (optionally only from one Confluence space key or Jira project). */
export async function recent({ limit = 10, space, checkVisibility = true } = {}) {
  const { decisions, state, meta } = await decisionsAndState(120);
  let list = decisions.filter((d) => d.status !== 'proposed');
  if (space) list = list.filter((d) => [d.source?.spaceKey, d.source?.issueKey?.split('-')[0]].some((k) => k && k.toLowerCase() === String(space).toLowerCase()));
  list.sort((a, b) => String(b.decidedAt ?? '').localeCompare(String(a.decidedAt ?? '')));
  const visible = await visibleOnly(list.slice(0, limit * 2), (x) => x, { checkVisibility });
  return { indexState: state, total: decisions.length, lastSyncAt: meta?.lastSyncAt ?? null, decisions: visible.slice(0, limit).map(view) };
}

/** Register view: every decision the viewer can see, newest first. */
export async function register({ checkVisibility = true } = {}) {
  const { decisions, state, meta } = await decisionsAndState(600);
  const list = [...decisions].sort((a, b) => String(b.decidedAt ?? '').localeCompare(String(a.decidedAt ?? '')));
  const visible = await visibleOnly(list, (x) => x, { checkVisibility });
  return { indexState: state, lastSyncAt: meta?.lastSyncAt ?? null, decisions: visible.map(view) };
}

const REGISTER_TITLE = 'Decision register';

function decisionText({ statement, rationale, supersedes }) {
  let s = String(statement ?? '').trim().replace(/[.]+$/, '');
  if (rationale && !/\bbecause\b/i.test(s)) s += `, because ${String(rationale).trim().replace(/^because\s+/i, '').replace(/[.]+$/, '')}`;
  s += '.';
  if (supersedes) s += ` Supersedes ${String(supersedes).trim()}.`;
  return s;
}

function decisionListNode(text) {
  return { type: 'decisionList', attrs: { localId: randomUUID() }, content: [{ type: 'decisionItem', attrs: { localId: randomUUID(), state: 'DECIDED' }, content: [{ type: 'text', text }] }] };
}

/**
 * Records a decision where the team already works:
 *  - on a Jira work item: a "Decision:" comment
 *  - on a Confluence page: a native decision item appended to that page
 *  - otherwise: a decision item on the "Decision register" page of the given space (created if missing)
 * The new decision is indexed immediately.
 */
export async function recordDecision({ statement, rationale, supersedes, issueKey, pageId, spaceKey }) {
  const text = decisionText({ statement, rationale, supersedes });
  if (!statement || String(statement).trim().length < 6) throw new Error('A decision needs a statement, for example "Use X instead of Y for Z".');

  if (issueKey) {
    await jira.addComment(issueKey, `Decision: ${text}`);
    const work = await jira.getWorkItem(issueKey);
    await indexIssue({ key: issueKey, summary: work.summary });
    await recomputeSupersession();
    return { recorded: true, where: { kind: 'jira-comment', issueKey, url: work.url }, text };
  }

  let page;
  if (pageId) {
    page = await confluence.getPage(pageId, { asUser: true });
  } else {
    if (!spaceKey) throw new Error('Tell me which Confluence space to record the decision in (space key), or ask from a Jira work item or Confluence page.');
    const spaceId = await confluence.spaceIdForKey(spaceKey);
    if (!spaceId) throw new Error(`No Confluence space with key ${spaceKey} that you can access.`);
    page = await confluence.findPageByTitle(spaceId, REGISTER_TITLE);
    if (!page) {
      const adf = adfDoc([
        adfParagraph('Decisions recorded with Precedent. Each item below is a native Confluence decision, so it shows up in search and in every Precedent check.'),
        decisionListNode(text),
      ]);
      const created = await confluence.createPage({ spaceId, title: REGISTER_TITLE, adf });
      const fresh = await confluence.getPage(created.id);
      await indexPage(fresh);
      await recomputeSupersession();
      return { recorded: true, where: { kind: 'confluence-page', pageId: created.id, title: REGISTER_TITLE, url: fresh.url, created: true }, text };
    }
    page = await confluence.getPage(page.id, { asUser: true });
  }
  const adf = page.adf ?? adfDoc([]);
  adf.content = [...(adf.content ?? []), decisionListNode(text)];
  const version = await confluence.pageVersion(page.id);
  await confluence.updatePage({ id: page.id, title: page.title, adf, version: version + 1 });
  const fresh = await confluence.getPage(page.id);
  await indexPage(fresh);
  await recomputeSupersession();
  return { recorded: true, where: { kind: 'confluence-page', pageId: page.id, title: page.title, url: fresh.url }, text };
}