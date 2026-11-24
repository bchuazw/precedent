// Turns Confluence pages and Jira comments into normalised decision records.
//
// Sources understood:
//  1. Pages made from Confluence's "Decision documentation" template (details table with Status / Driver /
//     Approver, "Options considered" table, "Outcome" section). The option named in the outcome is the
//     choice; the other options are recorded as rejected.
//  2. Native Confluence decision items (/decision) anywhere, e.g. in meeting notes.
//  3. Jira comments that start with "Decision:" or contain a decision item.
import { walk, textOf, mentionsIn, isoDate, tableRows, sections } from './adf.js';
import { parseStatement } from './polarity.js';
import { tokenSet, sentences } from './text.js';

const DECIDED_STATUS = /\b(complete|completed|decided|done|approved|accepted|agreed|final)\b/i;
const PROPOSED_STATUS = /\b(not started|in progress|proposed|draft|under review|open|pending|discussing)\b/i;
const SUPERSEDED_STATUS = /\b(superseded|replaced|reversed|revoked|rejected|obsolete|deprecated|cancell?ed)\b/i;

/** Short display key: "ADR-007" style prefix from the title when present, else D-<hash>. */
export function displayKey(title, fallbackId) {
  const m = String(title ?? '').match(/\b([A-Z]{2,6}-\d{1,5})\b/);
  if (m) return m[1];
  let h = 0;
  for (const ch of String(fallbackId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `D-${(h % 9000) + 1000}`;
}

function cleanTitle(title) {
  return String(title ?? '')
    .replace(/^\s*[A-Z]{2,6}-\d{1,5}\s*[:\-–]\s*/, '')
    .replace(/^\s*(?:decision|daci|dec)\s*[:\-–#]\s*/i, '')
    .trim();
}

function statusFrom(text) {
  if (SUPERSEDED_STATUS.test(text)) return 'superseded';
  // A template cell lists every status ("Not started / In progress / Complete") until someone picks one.
  const hits = [DECIDED_STATUS.test(text), PROPOSED_STATUS.test(text)].filter(Boolean).length;
  if (hits > 1) return 'proposed';
  if (DECIDED_STATUS.test(text)) return 'decided';
  if (PROPOSED_STATUS.test(text)) return 'proposed';
  return 'decided';
}

function supersedesIn(text) {
  const out = [];
  const re = /\bsupersed(?:es|ed|ing)\s+(?:the\s+)?(?:decision\s+)?["“]?([^".;,)]+)["”]?/gi;
  let m;
  while ((m = re.exec(text))) out.push(m[1].trim());
  return out;
}

/** Finds the details table of a decision-template page: rows of [header, cell]. */
function detailsTable(doc) {
  let found = null;
  walk(doc, (n) => {
    if (found || n.type !== 'table') return;
    const rows = tableRows(n);
    const heads = rows.map((r) => textOf(r[0] ?? {}).toLowerCase());
    if (heads.includes('driver') || heads.includes('approver') || (heads.includes('status') && heads.includes('impact'))) found = rows;
  });
  if (!found) return null;
  const map = {};
  for (const row of found) {
    if (row.length < 2) continue;
    map[textOf(row[0]).toLowerCase()] = row[1];
  }
  return map;
}

/** Text of the first paragraph of a cell (often the option's bold name in DACI pages). */
function firstParagraph(cellNode) {
  const p = (cellNode?.content ?? []).find((n) => n.type === 'paragraph' && textOf(n));
  return p ? textOf(p) : '';
}

/**
 * Reads the "Options considered" table: [{name, description, index}] (first column is the row label).
 * Headers are either real names or "Option 1 / Option 2"; in the latter case the bold first line of the
 * description cell is used as the name (Atlassian's DACI pages do this).
 */
function optionsTable(sectionNodes) {
  const table = (sectionNodes ?? []).find((n) => n.type === 'table');
  if (!table) return [];
  const rows = tableRows(table);
  if (!rows.length) return [];
  const headers = rows[0].slice(1);
  const descRow = rows.find((r) => /description/i.test(textOf(r[0] ?? {})));
  return headers
    .map((head, i) => {
      // Drop status lozenges such as "recommended" from the header text.
      const headText = (head.content ?? []).map((p) => (p.content ?? []).filter((n) => n.type === 'text').map((n) => n.text).join('')).join(' ').trim();
      const generic = /^option\s*\d+\s*$/i.test(headText) || !headText;
      const descCell = descRow?.[i + 1];
      const name = generic ? firstParagraph(descCell) : headText.replace(/^option\s*\d+\s*[:\-–.]?\s*/i, '').trim();
      return { name, description: descCell ? textOf(descCell) : '', index: i + 1 };
    })
    .filter((o) => o.name && o.name.length > 1);
}

function sectionText(secs, ...names) {
  for (const [key, nodes] of secs) {
    if (names.some((n) => key.includes(n))) return nodes.map((n) => textOf(n)).join(' ').trim();
  }
  return '';
}

function sectionNodes(secs, ...names) {
  for (const [key, nodes] of secs) if (names.some((n) => key.includes(n))) return nodes;
  return [];
}

/** True when the outcome names the option ("Option 3" or most of its distinctive words). */
function optionMentioned(option, outcomeTokens, outcomeText) {
  if (option.index && new RegExp(`\\boption\\s*${option.index}\\b`, 'i').test(outcomeText)) return true;
  const toks = [...tokenSet(option.name)];
  if (!toks.length) return false;
  const hit = toks.filter((t) => outcomeTokens.has(t)).length;
  return hit / toks.length >= 0.6;
}

const looksLikeDecisionDoc = (title, secs, details) =>
  !/^\s*template\b/i.test(title ?? '') &&
  (details.outcome !== undefined ||
    [...secs.keys()].some((k) => /\b(outcome|options considered|decision)\b/.test(k)) ||
    /\b(decision|daci|adr|rapid)\b/i.test(title ?? ''));

function baseRecord(page) {
  return {
    title: cleanTitle(page.title) || page.title,
    source: {
      kind: 'confluence-page',
      id: String(page.id),
      title: page.title,
      url: page.url,
      spaceKey: page.spaceKey ?? null,
      spaceName: page.spaceName ?? null,
    },
    recordedBy: page.authorId ? { accountId: page.authorId } : null,
    updatedAt: page.updatedAt ?? null,
  };
}

/**
 * Extracts decision records from a Confluence page.
 * @param {{id, title, url, spaceKey?, spaceName?, authorId?, createdAt?, updatedAt?, adf}} page
 */
export function decisionsFromPage(page) {
  const doc = page.adf;
  if (!doc) return [];
  const out = [];
  const details = detailsTable(doc);
  const secs = sections(doc);

  // Native decision items, with the heading they sit under.
  const items = [];
  let lastHeading = '';
  walk(doc, (n) => {
    if (n.type === 'heading') lastHeading = textOf(n);
    if (n.type === 'decisionItem' && (n.attrs?.state ?? 'DECIDED') === 'DECIDED') {
      const text = textOf(n);
      if (text.replace(/[\s.…]+/g, '').length > 3) items.push({ localId: n.attrs?.localId ?? String(items.length), text, heading: lastHeading, owners: mentionsIn(n) });
    }
  });

  if (details && looksLikeDecisionDoc(page.title, secs, details)) {
    // Decision-template page: one primary record built from the whole document.
    const statusText = details.status ? textOf(details.status) : '';
    const owners = [
      ...mentionsIn(details.driver ?? {}).map((m) => ({ ...m, role: 'driver' })),
      ...mentionsIn(details.approver ?? {}).map((m) => ({ ...m, role: 'approver' })),
    ];
    const contributors = mentionsIn(details.contributors ?? {});
    let decidedAt = null;
    walk(details['due date'] ?? {}, (n) => {
      if (n.type === 'date') decidedAt = isoDate(n.attrs?.timestamp);
    });
    const outcome = (details.outcome ? textOf(details.outcome) : '') || sectionText(secs, 'outcome', 'decision');
    const background = sectionText(secs, 'background', 'context');
    const options = optionsTable(sectionNodes(secs, 'options considered', 'options'));
    const outcomeAll = `${outcome} ${items.map((i) => i.text).join(' ')}`;
    const outcomeTokens = tokenSet(outcomeAll);
    // What the decision items (or, failing that, the outcome's sentences) say was chosen and ruled out wins;
    // options are matched to those phrases. An option the outcome names ("Option 3", or by name) and that
    // nothing rules out is the choice; when only a choice is known, the other options count as ruled out.
    const said = { chosen: [], rejected: [] };
    for (const s of items.length ? items.map((i) => i.text) : sentences(outcome)) {
      const ps = parseStatement(s);
      said.chosen.push(...ps.chosen);
      said.rejected.push(...ps.rejected);
    }
    const overlaps = (name, terms) =>
      terms.some((t) => {
        const a = tokenSet(name);
        const b = tokenSet(t);
        const shared = [...a].filter((x) => b.has(x)).length;
        return shared && shared / Math.min(a.size, b.size) >= 0.5;
      });
    let rejectedOpts = options.filter((o) => overlaps(o.name, said.rejected));
    const chosenOpts = options.filter((o) => !rejectedOpts.includes(o) && (overlaps(o.name, said.chosen) || optionMentioned(o, outcomeTokens, outcomeAll)));
    if (chosenOpts.length && !rejectedOpts.length) rejectedOpts = options.filter((o) => !chosenOpts.includes(o));
    // Statement: a decision item if present; else a generated "Chose X over Y" when the outcome picks an
    // option; else the outcome's first sentence.
    const generated = chosenOpts.length
      ? `Chose ${chosenOpts.map((o) => o.name).join(' and ')}${rejectedOpts.length ? ` over ${rejectedOpts.map((o) => o.name).join(' and ')}` : ''}.`
      : null;
    const statement = items[0]?.text || generated || outcome.split(/(?<=[.!?])\s/)[0] || cleanTitle(page.title);
    // A generated statement adds nothing the options table didn't already say; outcome sentences do.
    const parsed = !items[0] && generated ? { chosen: [], rejected: [], scope: [], rationale: null } : parseStatement(statement);
    if (!items[0]) {
      parsed.chosen = [...parsed.chosen, ...said.chosen];
      parsed.rejected = [...parsed.rejected, ...said.rejected];
    }
    const rec = {
      ...baseRecord(page),
      id: `c:${page.id}:doc`,
      kind: 'decision-doc',
      statement,
      outcome: outcome || null,
      background: background ? background.slice(0, 600) : null,
      rationale: parsed.rationale ?? (outcome && outcome !== statement ? outcome.slice(0, 400) : null),
      chosen: dedupe([...parsed.chosen, ...chosenOpts.map((o) => o.name)]),
      rejected: dedupe([...parsed.rejected, ...rejectedOpts.map((o) => o.name)]),
      scope: parsed.scope,
      options,
      status: statusFrom(statusText),
      owners,
      contributors,
      decidedAt: decidedAt ?? page.createdAt ?? null,
      supersedes: supersedesIn(`${outcome} ${background} ${page.title}`),
    };
    rec.key = displayKey(page.title, rec.id);
    out.push(rec);
    // Further decision items on the same page become their own records.
    for (const item of items.slice(1)) out.push(itemRecord(page, item));
    return out;
  }

  for (const item of items) out.push(itemRecord(page, item));
  return out;
}

/** "2026-04-14 Mobile weekly sync" -> "2026-04-14" (meeting notes carry their date in the title). */
function dateFromTitle(title) {
  const m = String(title ?? '').match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function itemRecord(page, item) {
  const parsed = parseStatement(item.text);
  const rec = {
    ...baseRecord(page),
    id: `c:${page.id}:${item.localId}`,
    kind: 'decision-item',
    // The page names the topic ("Logging and observability standard"); the statement says what was decided.
    title: cleanTitle(page.title).replace(/^\d{4}-\d{2}-\d{2}\s+/, '') || (item.text.length <= 90 ? item.text : `${item.text.slice(0, 87)}...`),
    context: [cleanTitle(page.title), item.heading].filter(Boolean).join(' › '),
    statement: item.text,
    outcome: null,
    background: null,
    rationale: parsed.rationale,
    chosen: parsed.chosen,
    rejected: parsed.rejected,
    scope: parsed.scope,
    options: [],
    status: 'decided',
    owners: item.owners.map((m) => ({ ...m, role: 'mentioned' })),
    contributors: [],
    decidedAt: dateFromTitle(page.title) ?? page.createdAt ?? null,
    supersedes: supersedesIn(item.text),
  };
  rec.key = displayKey(item.text, rec.id);
  return rec;
}

/**
 * Extracts a decision from a Jira comment ("Decision: ..." or a decision item in the comment).
 * @param {{issueKey, issueSummary, issueUrl, commentId, authorId, authorName, created, adf}} c
 */
export function decisionsFromComment(c) {
  const out = [];
  const text = textOf(c.adf ?? {});
  const items = [];
  walk(c.adf ?? {}, (n) => {
    if (n.type === 'decisionItem' && (n.attrs?.state ?? 'DECIDED') === 'DECIDED') items.push(textOf(n));
  });
  const m = text.match(/^\s*decision\s*[:\-–]\s*(.+)$/i);
  if (m) items.unshift(m[1].trim());
  items.forEach((statement, i) => {
    if (statement.replace(/\s+/g, '').length < 4) return;
    const parsed = parseStatement(statement);
    const rec = {
      id: `j:${c.issueKey}:${c.commentId}:${i}`,
      kind: 'jira-comment',
      title: c.issueSummary ? `${c.issueSummary} (${c.issueKey})` : statement.length <= 90 ? statement : `${statement.slice(0, 87)}...`,
      context: `${c.issueKey} ${c.issueSummary ?? ''}`.trim(),
      statement,
      outcome: null,
      background: null,
      rationale: parsed.rationale,
      chosen: parsed.chosen,
      rejected: parsed.rejected,
      scope: parsed.scope,
      options: [],
      status: 'decided',
      owners: c.authorId ? [{ accountId: c.authorId, name: c.authorName ?? '', role: 'author' }] : [],
      contributors: [],
      decidedAt: c.created ? String(c.created).slice(0, 10) : null,
      supersedes: supersedesIn(statement),
      source: { kind: 'jira-comment', id: String(c.commentId), title: `${c.issueKey}: ${c.issueSummary ?? ''}`.trim(), url: c.issueUrl, issueKey: c.issueKey },
      recordedBy: c.authorId ? { accountId: c.authorId } : null,
      updatedAt: c.updated ?? c.created ?? null,
    };
    rec.key = displayKey(statement, rec.id);
    out.push(rec);
  });
  return out;
}

/** Marks decisions superseded when a later decision says it supersedes them (by key or title). */
export function applySupersession(decisions) {
  const byRef = (ref) => {
    const r = ref.toLowerCase();
    return decisions.filter((d) => d.key?.toLowerCase() === r || (d.title && d.title.toLowerCase().includes(r)) || d.source?.title?.toLowerCase().includes(r));
  };
  for (const d of decisions) {
    for (const ref of d.supersedes ?? []) {
      for (const old of byRef(ref)) {
        if (old.id === d.id) continue;
        old.status = 'superseded';
        old.supersededBy = { id: d.id, key: d.key, title: d.title };
      }
    }
  }
  return decisions;
}

/**
 * Removes duplicates and near-duplicates: when one phrase's words are all contained in another's
 * ("Atlassian-hosted models" vs "Atlassian-hosted models approved by Security"), the shorter one stays.
 */
function dedupe(arr) {
  const seen = new Set();
  const uniq = arr.filter((x) => {
    const k = x.toLowerCase().trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const sets = uniq.map((x) => tokenSet(x));
  return uniq.filter((x, i) => !uniq.some((y, j) => j !== i && sets[j].size && sets[j].size < sets[i].size && [...sets[j]].every((t) => sets[i].has(t))));
}
