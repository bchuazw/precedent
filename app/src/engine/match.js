// Checks a piece of work (a Jira work item or a free-text proposal) against recorded decisions.
//
// Relations, strongest first:
//   conflict - the work names something a decision ruled out, within that decision's scope
//   aligned  - the work names what a decision chose, or removes something a decision ruled out
//   related  - the work overlaps a decision's topic (BM25 relevance) without a clear stance
// Everything is deterministic and returns the evidence it used, so every flag can be explained.
import { tokens, normalize, weight, GENERIC } from './text.js';

const REMOVAL =
  /\b(?:remov\w*|drop\w*|deprecat\w*|delet\w*|kill\w*|sunset\w*|retir\w*|migrat\w* (?:off|away|from)|replac\w*|phas\w* out|disabl\w*|stop\w*|rip\w* out|eliminat\w*|get rid of|decommission\w*|turn\w* off|no longer|do not|dont|never|without|ban\w*|block\w*|prevent\w*|forbid\w*)\b/;

const unique = (arr) => [...new Set(arr)];

/** Text of a work item used for matching. */
export function workText(work) {
  return [work.summary, work.description, (work.labels ?? []).join(' '), (work.components ?? []).join(' ')].filter(Boolean).join('. ');
}

/**
 * Does the term occur in the work? Returns evidence or null.
 * Strict mode (for ruled-out terms, where a false conflict costs trust) needs two distinctive words when the
 * term has them. Lenient mode (for chosen terms) accepts the head of the phrase.
 */
export function findTerm(term, workTokenSet, { lenient = false } = {}) {
  const phrase = lenient ? String(term).split(/\s+(?:with|plus|backed by|using|via)\s+/i)[0] : term;
  const toks = unique(tokens(phrase));
  if (!toks.length) return null;
  const anchors = toks.filter((t) => weight(t) === 1);
  const hitToks = toks.filter((t) => workTokenSet.has(t));
  const anchorHits = anchors.filter((t) => workTokenSet.has(t));
  const totalW = toks.reduce((s, t) => s + weight(t), 0);
  const hitW = hitToks.reduce((s, t) => s + weight(t), 0);
  const coverage = totalW ? hitW / totalW : 0;
  const needAnchors = lenient ? 1 : anchors.length >= 2 ? 2 : anchors.length;
  const minCoverage = lenient ? 0.4 : toks.length > 5 ? 0.5 : 0.6;
  if (!anchors.length || anchorHits.length < Math.max(1, needAnchors) || coverage < minCoverage) return null;
  return { term, tokens: toks, matched: hitToks, anchors: anchorHits, coverage: Math.round(coverage * 100) / 100 };
}

/** True when the work talks about removing/avoiding the term rather than adding it. */
function inRemovalContext(workNorm, matchedTokens) {
  for (const tok of matchedTokens) {
    const re = new RegExp(`\\b${tok.replace(/[^a-z0-9]/g, '')}\\w*`, 'g');
    let m;
    while ((m = re.exec(workNorm))) {
      const before = workNorm.slice(Math.max(0, m.index - 45), m.index);
      if (REMOVAL.test(before) || /\b(?:off|away from|out of|instead of|rather than|replacing)\s+$/.test(before)) return true;
    }
  }
  return false;
}

/** Document text of a decision for relevance scoring. */
export function decisionText(d) {
  return [
    d.title,
    d.statement,
    d.context,
    (d.chosen ?? []).join(' '),
    (d.rejected ?? []).join(' '),
    (d.scope ?? []).join(' '),
    (d.options ?? []).map((o) => `${o.name} ${o.description ?? ''}`).join(' '),
    d.outcome,
    d.rationale,
  ]
    .filter(Boolean)
    .join(' ');
}

/** BM25 index over decisions. */
export function buildIndex(decisions) {
  const docs = decisions.map((d) => {
    const toks = tokens(decisionText(d));
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { d, tf, len: toks.length };
  });
  const df = new Map();
  for (const doc of docs) for (const t of doc.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avgLen = docs.reduce((s, x) => s + x.len, 0) / Math.max(1, docs.length);
  return { docs, df, avgLen, n: docs.length };
}

function bm25(index, doc, queryToks, k1 = 1.2, b = 0.75) {
  let score = 0;
  for (const q of queryToks) {
    const f = doc.tf.get(q);
    if (!f) continue;
    const n = index.df.get(q) ?? 0;
    const idf = Math.log(1 + (index.n - n + 0.5) / (n + 0.5));
    score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.len) / (index.avgLen || 1)))) * weight(q);
  }
  return score;
}

/**
 * Checks work against decisions.
 * @param {{summary, description?, labels?, components?}} work
 * @param {object[]} decisions  normalised decision records
 * @param {{index?, relatedLimit?, includeSuperseded?}} opts
 * @returns {{findings: object[], counts: {conflict:number, aligned:number, related:number}}}
 */
export function checkWork(work, decisions, opts = {}) {
  const text = workText(work);
  const workToks = tokens(text);
  const workSet = new Set(workToks);
  const workNorm = normalize(text);
  const index = opts.index ?? buildIndex(decisions);
  const queryToks = unique(workToks);
  const findings = [];

  for (const doc of index.docs) {
    const d = doc.d;
    if (d.status === 'proposed') continue;
    const relevance = bm25(index, doc, queryToks);
    const shared = unique(workToks.filter((t) => doc.tf.has(t) && !GENERIC.has(t)));
    const scopeHit = !(d.scope ?? []).length || (d.scope ?? []).some((s) => tokens(s).some((t) => workSet.has(t)));

    const rejectedHits = (d.rejected ?? []).map((t) => findTerm(t, workSet)).filter(Boolean);
    const chosenHits = (d.chosen ?? []).map((t) => findTerm(t, workSet, { lenient: true })).filter(Boolean);

    let relation = null;
    let evidence = [];
    let confidence = 'medium';

    if (rejectedHits.length) {
      const removal = inRemovalContext(workNorm, rejectedHits.flatMap((h) => h.anchors));
      if (removal) {
        relation = 'aligned';
        evidence = rejectedHits.map((h) => ({ type: 'removes-rejected', term: h.term, matched: h.matched }));
      } else if (scopeHit || relevance >= 3) {
        relation = d.status === 'superseded' ? 'superseded' : 'conflict';
        evidence = rejectedHits.map((h) => ({ type: 'mentions-rejected', term: h.term, matched: h.matched }));
        const full = rejectedHits.some((h) => h.coverage >= 0.99);
        confidence = full && (d.scope ?? []).length && scopeHit ? 'high' : full || scopeHit ? 'medium' : 'low';
      } else {
        relation = 'related';
        evidence = rejectedHits.map((h) => ({ type: 'mentions-rejected-out-of-scope', term: h.term, matched: h.matched, scope: d.scope }));
      }
    } else if (chosenHits.length && (scopeHit || relevance >= 2)) {
      relation = d.status === 'superseded' ? 'superseded' : 'aligned';
      evidence = chosenHits.map((h) => ({ type: 'mentions-chosen', term: h.term, matched: h.matched }));
    } else if ((relevance >= 2.6 && shared.length >= 2) || ((d.scope ?? []).length && scopeHit && relevance >= 1.2 && shared.length >= 1)) {
      relation = d.status === 'superseded' ? null : 'related';
      evidence = [{ type: 'topic-overlap', matched: shared.slice(0, 6) }];
    }

    if (!relation) continue;
    if (relation === 'superseded' && !opts.includeSuperseded) continue;
    findings.push({
      decisionId: d.id,
      key: d.key,
      relation,
      confidence,
      relevance: Math.round(relevance * 100) / 100,
      evidence,
      scopeMatched: scopeHit,
    });
  }

  const order = { conflict: 0, aligned: 1, related: 2, superseded: 3 };
  findings.sort((a, b) => order[a.relation] - order[b.relation] || b.relevance - a.relevance);
  const limit = opts.relatedLimit ?? 3;
  let relatedSeen = 0;
  const trimmed = findings.filter((f) => f.relation !== 'related' || ++relatedSeen <= limit);
  const counts = { conflict: 0, aligned: 0, related: 0 };
  for (const f of trimmed) if (counts[f.relation] !== undefined) counts[f.relation]++;
  return { findings: trimmed, counts };
}

/** Free-text search over decisions (for the agent's search action and the MCP tool). */
export function searchDecisions(query, decisions, { limit = 5, index } = {}) {
  const idx = index ?? buildIndex(decisions);
  const q = unique(tokens(query));
  return idx.docs
    .map((doc) => ({ d: doc.d, score: bm25(idx, doc, q) }))
    .filter((x) => x.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => ({ decision: x.d, score: Math.round(x.score * 100) / 100 }));
}
