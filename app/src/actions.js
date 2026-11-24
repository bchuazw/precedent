// Rovo agent actions. The same functions are exposed as MCP tools (rovo:mcp), so coding agents such as
// Claude Code can ask "does this change contradict a team decision?" before writing code.
// Inputs from the model are treated as hints: the current work item / page comes from context when present.
import * as service from './lib/service.js';

const issueFromContext = (payload) => payload?.context?.jira?.issueKey ?? null;
const pageFromContext = (payload) => (payload?.context?.confluence?.resourceType === 'page' ? payload.context.confluence.contentId : null);
const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

/** Rovo shows errors to the model; keep them short and actionable. */
async function guarded(fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    return { error: String(e?.message ?? e).slice(0, 300) };
  }
}

/** People as "Ryan Lee (driver)" so the model names them instead of printing account ids. */
function peopleForModel(owners) {
  return (owners ?? []).map((o) => {
    const bits = [o.role && o.role !== 'mentioned' ? o.role : null, o.teams?.length ? `team: ${o.teams.map((t) => t.name).join(', ')}` : null].filter(Boolean);
    return `${o.name || 'someone'}${bits.length ? ` (${bits.join('; ')})` : ''}`;
  });
}

/** Decision view for the model: people by name, no account ids. */
function decisionForModel(d) {
  if (!d) return d;
  const { owners, contributors, supersedes, ...rest } = d;
  return {
    ...rest,
    owners: peopleForModel(owners),
    ...(contributors ? { contributors: peopleForModel(contributors) } : {}),
    ...(supersedes ? { supersedes: supersedes.map((s) => ({ key: s.key, title: s.title, link: s.source?.url })) } : {}),
  };
}

/** Trims a check result to what the model needs, with links for citations. */
function forModel(result) {
  return {
    headline: result.headline,
    workItem: result.work,
    indexState: result.indexState === 'indexing' ? 'Precedent is still indexing this site for the first time; results may be incomplete.' : 'ready',
    findings: result.findings.map((f) => ({
      relation: f.relation,
      confidence: f.confidence,
      reason: f.reason,
      decision: {
        key: f.decision.key,
        title: f.decision.title,
        statement: f.decision.statement,
        decidedAt: f.decision.decidedAt,
        status: f.decision.status,
        ruledOut: f.decision.rejected,
        chose: f.decision.chosen,
        scope: f.decision.scope,
        rationale: f.decision.rationale,
        owners: peopleForModel(f.decision.owners),
        link: f.decision.source.url,
        source: f.decision.source.title,
      },
    })),
    note: 'Cite each decision by key with its link. Conflicts are flagged by deterministic matching; confirm by reading the decision statement before advising.',
  };
}

export async function checkWorkItem(payload) {
  return guarded(async () => {
    const fromInput = String(payload?.issueKey ?? '').trim().toUpperCase();
    const key = ISSUE_KEY.test(fromInput) ? fromInput : issueFromContext(payload);
    if (!key) return { error: 'No work item to check. Open a Jira work item or give a key such as MOBL-12.' };
    return forModel(await service.checkIssue(key, { maxAge: 30 }));
  });
}

export async function checkProposal(payload) {
  return guarded(async () => {
    const text = String(payload?.proposal ?? '').trim();
    if (text.length < 8) return { error: 'Describe the proposed change in a sentence, for example "Add an SMS one-time passcode fallback for 2FA".' };
    return forModel(await service.checkProposal(text));
  });
}

export async function searchDecisions(payload) {
  return guarded(async () => {
    const q = String(payload?.query ?? '').trim();
    if (!q) return { error: 'Give a topic to search for, for example "two-factor authentication".' };
    const res = await service.search(q, { limit: Math.min(8, Number(payload?.limit) || 5) });
    return {
      query: res.query,
      results: res.results.map((r) => ({ score: r.score, decision: decisionForModel(r.decision) })),
      note: res.results.length ? 'Cite decisions by key with their link.' : 'No recorded decision matches. Say so plainly; do not invent one.',
    };
  });
}

export async function getDecision(payload) {
  return guarded(async () => {
    const res = await service.getDecision(String(payload?.decision ?? '').trim());
    return res.found ? { found: true, decision: decisionForModel(res.decision) } : res;
  });
}

export async function listRecentDecisions(payload) {
  return guarded(async () => {
    const res = await service.recent({ limit: Math.min(20, Number(payload?.limit) || 10), space: payload?.space || undefined });
    return { ...res, decisions: res.decisions.map(decisionForModel) };
  });
}

export async function recordDecision(payload) {
  return guarded(async () =>
    service.recordDecision({
      statement: payload?.statement,
      rationale: payload?.rationale,
      supersedes: payload?.supersedes,
      issueKey: issueFromContext(payload) ?? (ISSUE_KEY.test(String(payload?.issueKey ?? '').toUpperCase()) ? String(payload.issueKey).toUpperCase() : null),
      pageId: pageFromContext(payload),
      spaceKey: payload?.spaceKey,
    }),
  );
}
