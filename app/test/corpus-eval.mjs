// Measures Precedent's engine against a hand-labelled corpus (test/corpus.json): decision statements and Jira-style
// work items written blind to the parser, then reviewed. Not a unit test: it reports how well the engine copes with
// the way people actually write, and lists every miss.
//
//   node test/corpus-eval.mjs                  metrics and every failure
//   node test/corpus-eval.mjs --summary        metrics only
//   node test/corpus-eval.mjs --json           metrics as JSON
//   node test/corpus-eval.mjs --engine <dir>   evaluate another copy of src/engine (for example an older git checkout)
//
// Parse accuracy: a decision parses correctly when both its chosen and its rejected lists match the annotation.
// Two terms match when, lower-cased and without punctuation or articles, one equals or contains the other at word
// boundaries. Every expected term needs a match, and every extracted term must match an expected one.
//
// Matching: every work item is checked against every decision, as the app does. Pairs the corpus doesn't list are
// expected to be "none". A list of labels gives the acceptable readings, preferred first. A pair that allows both
// "conflict" and another reading counts as correct either way, and is left out of conflict precision and recall;
// the same holds for "aligned".
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const engineDir = resolve(value('engine') ?? join(here, '../src/engine'));
const corpusFile = resolve(value('corpus') ?? join(here, 'corpus.json'));
const load = (file) => import(pathToFileURL(join(engineDir, file)).href);
const { parseStatement } = await load('polarity.js');
const { decisionsFromPage, decisionsFromComment, applySupersession } = await load('extract.js');
const { checkWork, buildIndex } = await load('match.js');
const corpus = JSON.parse(readFileSync(corpusFile, 'utf8'));

// --- decisions, recorded the way the app sees them -------------------------------------------------------------
const textNode = (text) => ({ type: 'text', text });
function toRecord(d, i) {
  if (d.source === 'comment') {
    const key = `CORPUS-${i + 1}`;
    return decisionsFromComment({
      issueKey: key,
      issueSummary: d.title,
      issueUrl: `https://corpus.test/browse/${key}`,
      commentId: d.id,
      created: '2026-01-01T00:00:00.000Z',
      adf: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [textNode(`Decision: ${d.statement}`)] }] },
    })[0];
  }
  return decisionsFromPage({
    id: d.id,
    title: d.title,
    url: `https://corpus.test/wiki/${d.id}`,
    createdAt: '2026-01-01',
    adf: { type: 'doc', version: 1, content: [{ type: 'decisionList', content: [{ type: 'decisionItem', attrs: { state: 'DECIDED', localId: d.id }, content: [textNode(d.statement)] }] }] },
  })[0];
}

const records = [];
const corpusIdOf = new Map();
const unextracted = [];
corpus.decisions.forEach((d, i) => {
  const rec = toRecord(d, i);
  if (!rec) return unextracted.push(d.id);
  records.push(rec);
  corpusIdOf.set(rec.id, d.id);
});
applySupersession(records);
const index = buildIndex(records);

// --- parsing ---------------------------------------------------------------------------------------------------
const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const within = (a, b) => ` ${a} `.includes(` ${b} `);
const loose = (e, g) => {
  const x = norm(e);
  const y = norm(g);
  return Boolean(x && y) && (x === y || within(x, y) || within(y, x));
};
const exact = (e, g) => norm(e) === norm(g);
const fieldOk = (exp = [], got = [], same = loose) => (exp.length ? exp.every((e) => got.some((g) => same(e, g))) && got.every((g) => exp.some((e) => same(e, g))) : !got.length);

function parseCase(item) {
  const exp = item.expected ?? {};
  let got;
  try {
    got = parseStatement(item.statement);
  } catch (e) {
    got = { chosen: [], rejected: [], scope: [], negativeVerb: null, error: String(e) };
  }
  const r = {
    id: item.id,
    origin: item.origin ?? 'blind',
    statement: item.statement,
    exp,
    got,
    chosen: fieldOk(exp.chosen, got.chosen),
    rejected: fieldOk(exp.rejected, got.rejected),
    scope: exp.scope === undefined ? null : fieldOk(exp.scope, got.scope),
    negativeVerb: exp.negativeVerb === undefined ? null : (got.negativeVerb ?? null) === exp.negativeVerb,
    exact: fieldOk(exp.chosen, got.chosen, exact) && fieldOk(exp.rejected, got.rejected, exact),
  };
  r.ok = r.chosen && r.rejected && r.negativeVerb !== false;
  return r;
}

const parsed = corpus.decisions.map(parseCase);
const checks = (corpus.parseChecks ?? []).map(parseCase);

const ratio = (n, d) => ({ n, d, value: d ? n / d : null });
const count = (arr, fn) => arr.filter(fn).length;
function parseMetrics(rows) {
  const scoped = rows.filter((r) => r.scope !== null);
  return {
    cases: rows.length,
    accuracy: ratio(count(rows, (r) => r.ok), rows.length),
    chosen: ratio(count(rows, (r) => r.chosen), rows.length),
    rejected: ratio(count(rows, (r) => r.rejected), rows.length),
    exact: ratio(count(rows, (r) => r.exact), rows.length),
    scope: ratio(count(scoped, (r) => r.scope), scoped.length),
  };
}

// --- matching --------------------------------------------------------------------------------------------------
const acceptable = (v) => (v === undefined ? ['none'] : Array.isArray(v) ? v : [v]);
const items = [];
for (const w of corpus.work) {
  let findings = [];
  try {
    findings = checkWork({ summary: w.summary, description: w.description }, records, { index }).findings;
  } catch (e) {
    console.error(`${w.id}: checkWork threw ${e}`);
  }
  const got = new Map();
  for (const f of findings) {
    const id = corpusIdOf.get(f.decisionId);
    if (id && !got.has(id)) got.set(id, f);
  }
  const pairs = [...new Set([...Object.keys(w.expect ?? {}), ...got.keys()])].map((did) => {
    const accept = acceptable(w.expect?.[did]);
    const finding = got.get(did);
    const pred = finding?.relation ?? 'none';
    return { work: w, did, accept, listed: w.expect?.[did] !== undefined, pred, finding, ok: accept.includes(pred) };
  });
  const noneItem = Object.values(w.expect ?? {}).every((v) => acceptable(v).every((l) => l === 'none'));
  items.push({ work: w, origin: w.origin ?? 'blind', pairs, noneItem });
}

function precisionRecall(pairs, label) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const p of pairs) {
    const pos = p.accept.includes(label);
    if (pos && p.accept.some((l) => l !== label)) continue; // either reading is fine
    if (p.pred === label) pos ? tp++ : fp++;
    else if (pos) fn++;
  }
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 = precision.value !== null && recall.value !== null && precision.value + recall.value ? (2 * precision.value * recall.value) / (precision.value + recall.value) : null;
  return { tp, fp, fn, precision, recall, f1 };
}

function matchMetrics(subset) {
  const pairs = subset.flatMap((i) => i.pairs);
  const listed = pairs.filter((p) => p.listed);
  const unlisted = pairs.filter((p) => !p.listed && p.pred !== 'none');
  const none = subset.filter((i) => i.noneItem);
  const confusion = {};
  for (const e of ['conflict', 'aligned', 'related', 'none']) confusion[e] = { conflict: 0, aligned: 0, related: 0, none: 0 };
  for (const p of pairs) confusion[p.accept[0]][p.pred]++;
  return {
    workItems: subset.length,
    conflict: precisionRecall(pairs, 'conflict'),
    aligned: precisionRecall(pairs, 'aligned'),
    listedPairsCorrect: ratio(count(listed, (p) => p.ok), listed.length),
    unlistedFlagged: { conflict: count(unlisted, (p) => p.pred === 'conflict'), aligned: count(unlisted, (p) => p.pred === 'aligned'), related: count(unlisted, (p) => p.pred === 'related') },
    noneItemsFlagged: ratio(count(none, (i) => i.pairs.some((p) => p.pred !== 'none')), none.length),
    noneItemsWithConflict: ratio(count(none, (i) => i.pairs.some((p) => p.pred === 'conflict')), none.length),
    confusion,
  };
}

const blindItems = items.filter((i) => i.origin === 'blind');
const metrics = {
  engine: relative(process.cwd(), engineDir) || '.',
  corpus: { decisions: corpus.decisions.length, workItems: corpus.work.length, parseChecks: checks.length, unextracted },
  parse: parseMetrics(parsed),
  parseChecks: parseMetrics(checks),
  match: matchMetrics(items),
  matchBlind: blindItems.length !== items.length ? matchMetrics(blindItems) : null,
};

if (flag('json')) {
  console.log(JSON.stringify(metrics, null, 2));
  process.exit(0);
}

// --- report ----------------------------------------------------------------------------------------------------
const pct = (r) => (r.value === null ? 'n/a' : `${(r.value * 100).toFixed(1)}%`);
const frac = (r) => `${pct(r).padStart(6)} (${r.n}/${r.d})`;
const num = (x) => (x === null ? 'n/a' : x.toFixed(3));
const list = (a) => `[${(a ?? []).join(' | ')}]`;
const out = [];
const say = (s = '') => out.push(s);

say(`Precedent engine vs corpus: ${metrics.corpus.decisions} decisions, ${metrics.corpus.workItems} work items, ${metrics.corpus.parseChecks} parse checks`);
say(`engine: ${metrics.engine}`);
if (unextracted.length) say(`not extracted as decisions: ${unextracted.join(', ')}`);
say();
say('Parsing: corpus decisions');
say(`  parse accuracy (chosen and rejected)  ${frac(metrics.parse.accuracy)}`);
say(`    chosen                              ${frac(metrics.parse.chosen)}`);
say(`    rejected                            ${frac(metrics.parse.rejected)}`);
say(`    exact wording (both)                ${frac(metrics.parse.exact)}`);
say(`  scope                                 ${frac(metrics.parse.scope)}`);
if (checks.length) {
  say('Parsing: parse-only checks (live UI tests and known gaps)');
  say(`  parse accuracy (chosen and rejected)  ${frac(metrics.parseChecks.accuracy)}`);
  say(`  scope                                 ${frac(metrics.parseChecks.scope)}`);
}
say();
const matchBlock = (m, title) => {
  say(`${title}: ${m.workItems} work items x ${records.length} decisions`);
  say(`  conflict precision                    ${frac(m.conflict.precision)}`);
  say(`  conflict recall                       ${frac(m.conflict.recall)}`);
  say(`  conflict F1                           ${num(m.conflict.f1).padStart(6)}`);
  say(`  aligned precision                     ${frac(m.aligned.precision)}`);
  say(`  aligned recall                        ${frac(m.aligned.recall)}`);
  say(`  listed pairs labelled correctly       ${frac(m.listedPairsCorrect)}`);
  say(`  unlisted pairs flagged                conflict ${m.unlistedFlagged.conflict}, aligned ${m.unlistedFlagged.aligned}, related ${m.unlistedFlagged.related}`);
  say(`  false-positive rate on "none" items   ${frac(m.noneItemsFlagged)}  (any finding)`);
  say(`                                        ${frac(m.noneItemsWithConflict)}  (a conflict)`);
};
matchBlock(metrics.match, 'Matching: all work items');
if (metrics.matchBlind) {
  say();
  matchBlock(metrics.matchBlind, 'Matching: blind work items only');
}
say();
say('Confusion (rows: expected, preferred label; columns: engine)');
say(`  ${''.padEnd(10)}${['conflict', 'aligned', 'related', 'none'].map((c) => c.padStart(10)).join('')}`);
for (const [e, row] of Object.entries(metrics.match.confusion)) say(`  ${e.padEnd(10)}${['conflict', 'aligned', 'related', 'none'].map((c) => String(row[c]).padStart(10)).join('')}`);

if (!flag('summary')) {
  const parseFails = [...parsed, ...checks].filter((r) => !r.ok || r.scope === false);
  say();
  say(`Parse failures and scope misses (${parseFails.length})`);
  for (const r of parseFails) {
    say(`  ${r.id}${r.ok ? ' (scope only)' : ''}  ${r.statement}`);
    if (!r.chosen) say(`      chosen    expected ${list(r.exp.chosen)}  got ${list(r.got.chosen)}`);
    if (!r.rejected) say(`      rejected  expected ${list(r.exp.rejected)}  got ${list(r.got.rejected)}`);
    if (r.scope === false) say(`      scope     expected ${list(r.exp.scope)}  got ${list(r.got.scope)}`);
    if (r.negativeVerb === false) say(`      verb      expected ${r.exp.negativeVerb}  got ${r.got.negativeVerb}`);
  }
  const fails = items.flatMap((i) => i.pairs).filter((p) => !p.ok);
  const evidence = (f) => (f ? f.evidence.map((e) => `${e.type}${e.term ? `: ${e.term}` : ''}${e.matched ? ` {${e.matched.join(', ')}}` : ''}`).join('; ') : '');
  const show = (title, rows) => {
    say(`  ${title} (${rows.length})`);
    for (const p of rows) {
      const tag = p.work.origin === 'blind' ? '' : ` [${p.work.origin}]`;
      say(`    ${p.work.id} -> ${p.did}  expected ${p.accept.join('/')}, got ${p.pred}${tag}  "${p.work.summary}"`);
      if (p.finding) say(`        ${evidence(p.finding)}`);
    }
  };
  say();
  say(`Match failures (${fails.length})`);
  show('Missed conflicts', fails.filter((p) => p.accept[0] === 'conflict'));
  show('False conflicts', fails.filter((p) => p.pred === 'conflict'));
  show('Other mislabels', fails.filter((p) => p.accept[0] !== 'conflict' && p.pred !== 'conflict'));
}
console.log(out.join('\n'));
