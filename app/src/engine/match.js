// Checks a piece of work (a Jira work item or a free-text proposal) against recorded decisions.
//
// The work is read first (intent.js): what it adopts, what it removes, and what it only names. Then each decision is
// held against that reading:
//   conflict - the work adopts something the decision ruled out, removes or works around what it chose
//              ("remove passkey support", "launch without waiting for Legal"), or adopts another member of the chosen
//              option's category ("Use DynamoDB" against "PostgreSQL for all new services")
//   aligned  - the work adopts what the decision chose, or removes or keeps out what it ruled out
//   related  - the work names the decision's subject without acting on it (a fix, a spike, a document, a purpose)
// Naming a thing is never enough for a conflict: there has to be adoption evidence, and every finding carries the
// evidence it used (the term, the words that matched, the verb that decided) so it can be explained.
import { tokens, normalize, weight, GENERIC, product, category, isConcept } from './text.js';
import { analyseWork, mentionReason } from './intent.js';
import { parseRestriction } from './polarity.js';

const unique = (arr) => [...new Set(arr)];

// A prohibition tied to a specific action ("never log PII", "do not send transcripts to ...", "never store card
// numbers", "must not be exported to ...") only bites when the work does that action: an RFC that mentions phone
// numbers is not logging them. Generic verbs ("do not use X", "do not add X") carry no extra requirement.
const SEND = /\b(?:send\w*|sent|post\w*|upload\w*|shar\w*|forward\w*|transmit\w*|pass\w*|export\w*|stream\w*|call\w*|submit\w*)\b|\bto (?:the )?[\w-]+ api\b/;
const ACTIONS = {
  log: { re: /\b(?:log|logs|logged|logging|logger|trace|traces|tracing)\b/, label: 'logging' },
  send: { re: SEND, label: 'sending' },
  share: { re: SEND, label: 'sharing' },
  store: { re: /\b(?:stor\w*|sav\w*|keep\w*|kept|persist\w*|retain\w*|cach\w*|replicat\w*|cop(?:y|ies|ied|ying)|mirror\w*|sync\w*|dump\w*|back(?:s|ed|ing)? up|on file|in our database|in the database|column)\b/, label: 'storing' },
  collect: { re: /\b(?:collect\w*|gather\w*|captur\w*|ask\w* for|record\w*|field)\b/, label: 'collecting' },
  expose: { re: /\b(?:expos\w*|publish\w*|public\w*|make\w* public)\b/, label: 'exposing' },
  export: { re: /\b(?:export\w*|download\w*|dump\w*|extract\w*|cop(?:y|ies|ied|ying)|sync\w*|send\w*|sent|upload\w*|paste\w*|pull\w*|import\w*|load\w*)\b/, label: 'exporting' },
  commit: { re: /\b(?:commit\w*|push\w*|check(?:s|ed|ing)? in|merg\w*)\b/, label: 'committing' },
};
const ACTION_OF = {
  log: 'log', logging: 'log', send: 'send', sending: 'send', share: 'share', sharing: 'share', store: 'store', storing: 'store', keep: 'store', keeping: 'store',
  collect: 'collect', collecting: 'collect', expose: 'expose', exposing: 'expose', export: 'export', exporting: 'export', commit: 'commit', committing: 'commit',
};

/** The specific action a decision prohibits, if any: {key, label, re}. */
export function prohibitedAction(d) {
  const key = ACTION_OF[String(d.action ?? '').toLowerCase()];
  return key ? { key, ...ACTIONS[key] } : null;
}

/** Text of a work item used for matching. */
export function workText(work) {
  return [work.summary, work.description, (work.labels ?? []).join(' '), (work.components ?? []).join(' ')].filter(Boolean).join('. ');
}

// --- scope ---------------------------------------------------------------------------------------------------------
// "new" in a scope ("all new services") is met by work that says new or starts something.
const NEWISH = /\b(?:new|brand[\s-]new|greenfield|from scratch)\b|^\W*(?:\[[^\]]*\]\s*)*(?:create|bootstrap|scaffold|spin up|launch|start|build|stand up|set up|provision|write|expose|prototype|introduce)\b/i;
// Verbs that add to a place ("Add coupon codes to the legacy billing module").
const ADDING = /^(?:add|build|implement|introduce|create|ship|launch|develop|extend|support|allow|enable|expose|integrate|offer|provide|include|write|prototype|roll out|release)\b/;

// Where work runs: production and staging exclude each other.
const ENV_OF = {};
for (const [env, words] of Object.entries({ production: 'production prd', staging: 'staging stage preprod uat', development: 'dev development', qa: 'qa', sandbox: 'sandbox' })) for (const w of tokens(words)) ENV_OF[w] = env;
const envsIn = (toks) => new Set([...toks].map((t) => ENV_OF[t]).filter(Boolean));

// Qualifiers in a scope that the work can contradict: "customer identity" is not an internal admin tool.
const CONTRAST = {};
for (const [word, re] of [
  ['customer', /\b(?:internal|admin|staff|employees?|workforce|back office|contractors?)\b/],
  ['public', /\b(?:internal|private|admin|back office)\b/],
  ['external', /\binternal\b/],
  ['product', /\b(?:help cent(?:er|re)|docs? site|documentation|marketing site|blog|internal|admin)\b/],
  ['transactional', /\b(?:marketing|campaigns?|newsletters?|digests?|promo\w*)\b/],
  ['mobile', /\b(?:website|desktop|marketing site)\b/],
  ['internal', /\b(?:customers?|consumers?|end users?|shoppers?)\b/],
  ['marketing', /\b(?:transactional|order confirmations?|receipts?|passwordreset|password resets?|invoice emails?|verification emails?|onboarding|in-app|web app|dashboard)\b/],
]) for (const t of tokens(word)) CONTRAST[t] = re;
// Scope words a work can satisfy with a narrower word: a backend is a service or an API.
const SYNONYM = {};
for (const [word, alts] of [
  ['backend', 'service services api apis server worker microservice microservices'],
  ['frontend', 'widget widgets component components page pages ui screen screens button buttons form forms css web'],
  ['ticket', 'question questions enquiry enquiries inquiry inquiries complaint complaints case cases'],
]) for (const t of tokens(word)) SYNONYM[t] = tokens(alts);

// What a "for ..." phrase in the work ends on when it names who or what the work is for, or when or why it is done,
// rather than a use: "for the marketing team", "for the pricing page", "for another year", "for convenience".
const BENEFICIARY =
  /^(?:teams?|squad|org|department|sites?|website|portal|repo|repository|modul|widget|dashboard|pipelin|clients?|partners?|company|tenant|markets?|launch|sprint|quarter|demo|migration|rollout|year|month|today|tomorrow|now|later|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|q[1-4]|h[12]|20\d\d|testing|debugging|development|convenienc|speed|simplicity|consistency|reason|sake|moment|being|peopl|everyone|staff|stakeholder|leadership|management|engineer|developer|designer|analyst|agent|admin|member|hire|audit|complianc|hotfix|deadline|\d+)$/;
// "to save costs", "to speed things up": a reason, not a use.
const REASON_VERB = /^to (?:save|speed|cut|help|get|meet|comply|satisfy|match|align|line|see|free|hit|reach|cover|protect|ensure|simplify|make|give|be|have|do|work|win|unlock|boost|know|tell|stay|look|feel|fit|avoid|prevent|keep|let|reduce|improve|lower|unblock|support|allow|enable)\b/;

// "discounts above 20%", "free trials longer than 14 days": a limit on a number.
const LIMIT = /^(.*?)\b(above|over|more than|greater than|exceeding|beyond|longer than|larger than|bigger than|higher than)\s+(\d+(?:\.\d+)?)\s*(%|percent|days?|weeks?|months?|hours?|minutes?|users?|seats?|gb|mb|tb|requests?)?/i;
const UNIT = { percent: '%', day: 'day', days: 'day', week: 'week', weeks: 'week', month: 'month', months: 'month', hour: 'hour', hours: 'hour', minute: 'minute', minutes: 'minute', user: 'user', users: 'user', seat: 'seat', seats: 'seat', request: 'request', requests: 'request' };
const unitOf = (u) => (u === '%' ? '%' : UNIT[String(u ?? '').toLowerCase()] ?? String(u ?? '').toLowerCase());
/**
 * A number in the work beyond a ruled-out limit, next to the limited thing ("a 35% discount" against "no discounts
 * above 20%"). With an exception in the rule ("without VP approval"), only work that skips the exception conflicts.
 */
function limitHit(term, text, workSet) {
  const m = String(term).match(LIMIT);
  if (!m) return null;
  const head = unique(tokens(m[1])).filter((t) => weight(t) === 1);
  if (!head.length || !head.some((t) => workSet.has(t))) return null;
  const limit = Number(m[3]);
  const unit = unitOf(m[4]);
  const re = /(\d+(?:\.\d+)?)\s*-?\s*(%|percent|days?|weeks?|months?|hours?|minutes?|users?|seats?|gb|mb|tb|requests?)/gi;
  let n;
  const over = [];
  while ((n = re.exec(text))) if ((unitOf(n[2]) === unit || !m[4]) && Number(n[1]) > limit) over.push(n[0]);
  if (!over.length) return null;
  const exception = String(term).match(/\b(?:without|unless|except)\s+(.+)$/i);
  const skipped = exception && unique(tokens(exception[1])).some((t) => new RegExp(`\\b(?:without|skip\\w*|no|bypass\\w*)\\s+(?:\\w+\\s+){0,2}${t}`).test(normalize(text)));
  return { term, tokens: head, matched: over, anchors: head, coverage: 1, conflict: !exception || Boolean(skipped) };
}

// Capitalised words in the middle of a sentence: names of teams, tools and products ("reviewed by Legal").
function properNouns(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(/(?<=[a-z0-9,;:)]\s+(?:the\s+|a\s+|an\s+|by\s+|for\s+|to\s+|in\s+|on\s+|with\s+)?)([A-Z][a-zA-Z0-9]{2,})/g)) out.add(m[1].toLowerCase());
  return out;
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * True when the decision states a scope as "for ..." (a use the choice applies to: "for the design system", "for
 * password hashing and token signing"), not as its subject or a place.
 */
const statedAsUse = (phrase, statement) => new RegExp(`\\b(?:for|across|within)\\s+(?:[^.;:]*?\\s)?${escapeRe(phrase).replace(/\s+/g, '\\s+')}`, 'i').test(String(statement ?? ''));

/**
 * Where the work stands on a decision's scope. Each scope phrase is checked on its own:
 *   named      a distinctive word of the phrase is in the work
 *   open       the decision has no scope, or the phrase only names the kind of product involved ("emails" for SendGrid)
 *   different  the work says otherwise: another environment, a qualifier it contradicts ("customer" against an
 *              internal admin tool), another kind of the same product, or an explicit other use ("for password
 *              reset emails" against "campaigns", "to dedupe images" against "password hashing")
 *   unstated   the decision gave the scope as a use ("for the design system") and the work does not mention it
 *   outside    the scope is what the rule governs or where it holds ("auth tokens", "all new services", "outside
 *              the EU") and the work shows no sign of it
 * With alternative=true (work that adopts another member of the chosen option's category) half the distinctive words
 * are enough, and words naming the kind count as present.
 */
function scopeState(d, ctx, products, { alternative = false } = {}) {
  const { workSet, workNorm, text, otherEnv, purposes } = ctx;
  const scopeList = d.scope ?? [];
  if (!scopeList.length) return { state: 'open' };
  if (otherEnv) return { state: 'different', why: 'environment' };
  const kind = new Set(products.flatMap((p) => p.categories.flatMap((c) => [...category(c).wordSet])));
  const regions = [...workSet].filter((t) => product(t)?.categories.includes('region'));
  const has = (t) => workSet.has(t) || (SYNONYM[t] ?? []).some((x) => workSet.has(x));
  // A product of several kinds used as a kind the decision isn't about: RabbitMQ as a Celery job queue, against a
  // decision about event streaming.
  const scopeToks = new Set(scopeList.flatMap((s) => tokens(s)));
  for (const p of products) {
    if (p.categories.length < 2) continue;
    const words = (c) => [...category(c).wordSet];
    const declared = p.categories.filter((c) => words(c).some((w) => scopeToks.has(w)));
    const other = p.categories.filter((c) => !declared.includes(c));
    // A ruled-out product named outright needs two signs of the other kind (a word and a product, or two words):
    // "a RabbitMQ queue" alone is not one. An alternative needs only one ("a RabbitMQ exchange for order events").
    const signs = (c) => words(c).filter((w) => workSet.has(w)).length + [...workSet].filter((t) => t !== p.token && product(t)?.categories.includes(c)).length;
    if (declared.length && other.some((c) => signs(c) >= (alternative ? 1 : 2)) && !declared.some((c) => words(c).some((w) => workSet.has(w)))) return { state: 'different', why: 'kind' };
  }
  let named = false;
  let open = false;
  let different = null;
  let unstated = null;
  let outside = false;
  for (const s of scopeList) {
    const toks = unique(tokens(s));
    if (/^\s*outside\b/i.test(s)) {
      const inside = toks.filter((t) => product(t)?.categories.includes('region'));
      if (inside.length > 0 && regions.some((r) => !inside.includes(r))) named = true;
      else outside = true;
      continue;
    }
    if (/\bnew\b/i.test(s) && !NEWISH.test(text)) {
      outside = true;
      continue;
    }
    if (toks.some((t) => CONTRAST[t]?.test(workNorm) && !workSet.has(t))) {
      different = different ?? { state: 'different', why: 'qualifier', phrase: s };
      continue;
    }
    if (alternative) {
      const strong = toks.filter((t) => !ENV_OF[t] && !GENERIC.has(t));
      if (!strong.length) open = true;
      else if (strong.filter(has).length * 2 >= strong.length || strong.every((t) => has(t) || kind.has(t))) named = true;
      else outside = true;
      continue;
    }
    // A ruled-out product: words naming its kind prove nothing ("emails" for SendGrid).
    const strong = toks.filter((t) => !kind.has(t) && !ENV_OF[t] && !GENERIC.has(t));
    if (!strong.length) open = true;
    else if (strong.some(has)) named = true;
    else if (statedAsUse(s, d.statement)) unstated = unstated ?? s;
    else outside = true;
  }
  if (named) return { state: 'named' };
  if (open) return { state: 'open' };
  if (different) return different;
  if (outside) return { state: 'outside' };
  // The work may say what it is for instead: a different use is outside the scope.
  for (const p of purposes) {
    if (!/^(?:for|to)\s/.test(p) || REASON_VERB.test(p)) continue;
    const toks = unique(tokens(p));
    const content = toks.filter((t) => !GENERIC.has(t) && !WEAK.has(t) && !kind.has(t) && !ENV_OF[t]);
    const head = toks[toks.length - 1];
    if (!content.length || !head || GENERIC.has(head) || BENEFICIARY.test(head)) continue;
    if (content.some((t) => scopeToks.has(t))) continue;
    return { state: 'different', why: 'purpose', purpose: p.replace(/\s+/g, ' ') };
  }
  return { state: 'unstated', phrase: unstated };
}

// --- terms --------------------------------------------------------------------------------------------------------
const PREP_TAIL = /\s+(?:in|on|to|for|at|from|into|across|within|inside|outside|via|through|behind)\s+/i;

/**
 * Does the term occur in the work? Returns evidence or null.
 * Strict mode (for ruled-out terms, where a false conflict costs trust) needs two distinctive words when the
 * term has them, and one of them from the term's head: "carousels on the marketing site" needs "carousels".
 * Lenient mode (for chosen terms) accepts the head of the phrase, but a named product in it must be there.
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
  const needAnchors = lenient ? (anchors.length <= 2 ? anchors.length : Math.ceil(anchors.length / 2)) : anchors.length >= 2 ? 2 : anchors.length;
  const minCoverage = lenient ? 0.5 : toks.length > 5 ? 0.5 : 0.6;
  // A chosen phrase that names a product ("Kong gateway", "ADRs in Confluence") needs that product, and the
  // product is enough ("Use Stripe" follows "Stripe tokenization").
  const named = anchors.filter((t) => product(t) && !product(t).categories.includes('cloud'));
  const productHit = lenient && named.some((t) => workTokenSet.has(t));
  // ...unless the rest of a longer phrase is there ("Write an ADR" follows "ADRs in Confluence").
  const others = anchors.filter((t) => !named.includes(t));
  if (lenient && named.length && !productHit && !(others.length >= 2 && others.every((t) => workTokenSet.has(t)))) return null;
  if (!anchors.length || (!productHit && (anchorHits.length < Math.max(1, needAnchors) || coverage < minCoverage))) return null;
  // The head of a phrase with a place or target ("X in Y", "X to Y") must be there, not only the place; a head
  // with one distinctive word needs its other words too ("production data", "domain services").
  const head = unique(tokens(String(phrase).split(PREP_TAIL)[0]));
  const headAnchors = head.filter((t) => weight(t) === 1);
  if (head.length && !(headAnchors.length ? headAnchors : head).some((t) => workTokenSet.has(t))) return null;
  // A destination ("... to third-party LLM APIs") is part of what is ruled out: it must be there too.
  const dest = String(phrase).match(/\s+(?:to|into|via|through)\s+(.+)$/i);
  if (!lenient && dest) {
    const tail = unique(tokens(dest[1])).filter((t) => weight(t) === 1);
    if (tail.length && !tail.some((t) => workTokenSet.has(t))) return null;
  }
  if (!productHit && headAnchors.length === 1 && head.length > 1 && !head.every((t) => workTokenSet.has(t))) return null;
  return { term, tokens: toks, matched: hitToks, anchors: anchorHits, coverage: Math.round(coverage * 100) / 100 };
}

// "TLS 1.2 or higher", "iOS 15 and below": a version floor or ceiling in a term.
const RANGE = /^(.*?)\s*v?(\d+(?:\.\d+)*)\s*(?:\+|(?:or|and)\s+(higher|later|newer|above|up|greater|below|lower|earlier|older|under))/i;
const versionOf = (s) => s.split('.').map(Number);
const compareVersions = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};
/** Versions of the term's subject that the work mentions and that fall outside (floor) or inside (ceiling) its range. */
function versionHits(term, text) {
  const m = String(term).match(RANGE);
  if (!m || !m[1].trim()) return [];
  const name = m[1].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const limit = versionOf(m[2]);
  const floor = !/below|lower|earlier|older|under/i.test(m[3] ?? '');
  const out = [];
  const re = new RegExp(`\\b${name}\\s*v?(\\d+(?:\\.\\d+)*)`, 'gi');
  let v;
  while ((v = re.exec(text))) {
    const c = compareVersions(versionOf(v[1]), limit);
    if (floor ? c < 0 : c <= 0) out.push(`${m[1].trim()} ${v[1]}`);
  }
  return out;
}

// "two approvals": a work item that settles for fewer ("one approval") goes against it; "limited to three hops" the reverse.
const NUMBER = { one: 1, a: 1, an: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const COUNT = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|a single|single)\s+([a-z]+)/gi;
function countHits(term, statement, text) {
  const m = String(term).match(/^(?:at least\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+([a-z]+)/i);
  if (!m) return [];
  const need = Number(m[1]) || NUMBER[m[1].toLowerCase()];
  const noun = tokens(m[2])[0];
  if (!need || !noun) return [];
  const ceiling = /\b(?:limited to|capped at|at most|no more than|maximum of|max(?:imum)?)\b/i.test(statement ?? '');
  const out = [];
  let c;
  COUNT.lastIndex = 0;
  while ((c = COUNT.exec(text))) {
    const n = Number(c[1]) || NUMBER[c[1].toLowerCase().replace(/^a /, '')];
    if (tokens(c[2])[0] === noun && n && (ceiling ? n > need : n < need)) out.push(`${c[1]} ${c[2]}`);
  }
  // "without review", "skip the approval": none at all.
  if (!ceiling && new RegExp(`\\b(?:without|skip\\w*|bypass\\w*|no)\\s+(?:(?:a|an|the|any|code|peer|second)\\s+)*(?:${noun}\\w*|reviews?)\\b`).test(normalize(text))) out.push(`no ${m[2]}`);
  return out;
}

/**
 * The product a chosen term stands for: "PostgreSQL", "Okta SSO" -> {token, display, categories, rest}. A longer
 * term ("ADRs in Confluence") keeps its other words in rest; an alternative must come with them.
 */
function chosenProduct(term) {
  const head = String(term).split(/\s+(?:with|plus|backed by|using|via|for)\s+/i)[0];
  const toks = unique(tokens(head)).filter((t) => weight(t) === 1);
  const named = toks.filter((t) => product(t) && !product(t).categories.includes('cloud'));
  if (named.length !== 1) return null;
  const p = product(named[0]);
  return { token: p.token, display: p.display, categories: p.categories, rest: toks.length > 2 ? toks.filter((t) => t !== p.token) : [] };
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
    const key = new Set(tokens([d.title, ...(d.chosen ?? []), ...(d.rejected ?? []), ...(d.scope ?? [])].join(' ')).filter((t) => !GENERIC.has(t) && !WEAK.has(t)));
    // Search also knows what a named product is: "database" finds the decision about PostgreSQL and MongoDB.
    const stf = new Map(tf);
    for (const t of tf.keys()) for (const c of product(t)?.categories ?? []) for (const w of category(c).wordSet) if (!stf.has(w)) stf.set(w, 1);
    return { d, tf, stf, len: toks.length, key, restriction: parseRestriction(d.statement) };
  });
  const df = new Map();
  for (const doc of docs) for (const t of doc.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avgLen = docs.reduce((s, x) => s + x.len, 0) / Math.max(1, docs.length);
  return { docs, df, avgLen, n: docs.length };
}

function bm25(index, doc, queryToks, { k1 = 1.2, b = 0.75, search = false } = {}) {
  let score = 0;
  for (const q of queryToks) {
    const f = (search ? doc.stf : doc.tf).get(q);
    if (!f) continue;
    const n = search ? index.docs.filter((x) => x.stf.has(q)).length : (index.df.get(q) ?? 0);
    const idf = Math.log(1 + (index.n - n + 0.5) / (n + 0.5));
    score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.len) / (index.avgLen || 1)))) * weight(q);
  }
  return score;
}

// Words too common in decisions and tickets to show that two of them are about the same thing.
const WEAK = new Set(
  tokens(
    'allow enable remove move create set fix change show start stop run call send put make help ask try check write read open close turn include ensure prefer choose pick decide agree standard policy rule ' +
      'every all only must should never always default instead rather than over migrate switch replace drop keep store large small full single multiple good bad fast slow simple ' +
      'production staging customer internal public private legacy old remaining shared sync weekly monthly daily quarterly team engineering guild sync council review standup weekly planning',
  ),
);

const LOWER = { high: 'medium', medium: 'low', low: 'low' };

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
  const summary = String(work.summary ?? '');
  const summarySet = new Set(tokens(summary));
  // What the work intends, read once: what it adopts, removes, keeps out or merely names.
  const intent = analyseWork(work);
  const meta = ['inquiry', 'doc', 'report', 'maintain', 'admin'].includes(intent.intent);
  const upkeep = intent.intent === 'maintain' || intent.intent === 'report';
  const workNames = properNouns(text);
  // A hotfix goes to production unless the work says where else it goes.
  const workEnvs = envsIn(workSet);
  // A one-time code at sign-in, as a fallback or for recovery is a second factor even when the work never says 2FA.
  const implied = [];
  if (!workEnvs.size && workSet.has('hotfix')) implied.push('production');
  if (workSet.has('otp') && /\b(?:log ?in|sign[\s-]?in|signin|authenticat\w*|fallback|backup|recovery|new device|second factor|login)\b/i.test(text)) implied.push('mfa');
  const termSet = implied.length ? new Set([...workSet, ...implied]) : workSet;
  const workProducts = unique(workToks.filter((t) => product(t))).map((t) => product(t));
  const workDistinct = unique(workToks.filter((t) => !GENERIC.has(t) && !WEAK.has(t)));
  const index = opts.index ?? buildIndex(decisions);
  const queryToks = unique(workToks);
  const findings = [];
  // Bills, budgets and hiring name products without touching what was decided about them.
  const quiet = intent.quiet;

  for (const doc of index.docs) {
    const d = doc.d;
    if (d.status === 'proposed' || quiet) continue;
    const relevance = bm25(index, doc, queryToks);
    const shared = unique(workToks.filter((t) => doc.tf.has(t) && !GENERIC.has(t) && !WEAK.has(t)));
    const scopeHit = !(d.scope ?? []).length || (d.scope ?? []).some((s) => tokens(s).some((t) => workSet.has(t)));
    const superseded = d.status === 'superseded';
    const restriction = doc.restriction === undefined ? parseRestriction(d.statement) : doc.restriction;

    const limits = (d.rejected ?? []).map((t) => limitHit(t, text, workSet)).filter(Boolean);
    // A term with a numeric limit ("discounts above 20%") is judged by the number, not by its words.
    const rejectedHits = [
      ...(d.rejected ?? []).filter((t) => !LIMIT.test(t)).map((t) => findTerm(t, termSet) ?? rangeHit(t, text)).filter(Boolean),
      ...limits.filter((h) => h.conflict),
    ];
    // A chosen count ("two approvals") is only followed by work that says the count. In a restriction ("only senior
    // engineers can ...") the party is not an option anyone adopts.
    const chosenHits = restriction
      ? []
      : (d.chosen ?? [])
          .filter((t) => countOk(t, text))
          .map((t) => findTerm(t, workSet, { lenient: true }))
          .filter(Boolean);
    const action = prohibitedAction(d);
    const rejectedProducts = unique(rejectedHits.flatMap((h) => h.anchors.filter((t) => product(t)))).map((t) => product(t));
    // Work that says it runs somewhere else ("to staging") is outside a rule about production, and the reverse.
    const decisionEnvs = envsIn([...(d.rejected ?? []), ...(d.scope ?? [])].flatMap((t) => tokens(t)));
    const otherEnv = decisionEnvs.size > 0 && workEnvs.size > 0 && ![...workEnvs].some((e) => decisionEnvs.has(e));
    const ctx = { workSet: termSet, workNorm, text, otherEnv, purposes: intent.purposes };
    // A scope phrase whose distinctive words are all in the work, when they make up much of what the work is about.
    const strongScope = (d.scope ?? []).some((s) => {
      const strong = unique(tokens(s)).filter((t) => !GENERIC.has(t) && !WEAK.has(t));
      return strong.length > 0 && strong.every((t) => workSet.has(t)) && strong.length * 2 >= workDistinct.length;
    });

    let relation = null;
    let evidence = [];
    let confidence = 'medium';
    const set = (rel, ev, conf = 'medium') => {
      relation = superseded ? (rel === 'related' ? null : 'superseded') : rel;
      evidence = ev;
      confidence = conf;
    };
    const cue = (role) => ({ verb: role.verb ?? null, where: role.where ?? 'summary' });

    // --- a restriction: "Only senior engineers can approve database migrations" ---------------------------------------
    if (restriction) {
      const what = unique(tokens(`${restriction.action} ${restriction.what}`)).filter((t) => !GENERIC.has(t));
      const who = unique(tokens(restriction.who)).filter((t) => !GENERIC.has(t));
      if (what.length && what.every((t) => workSet.has(t))) {
        const other = otherParty(summary, restriction, who);
        if (other && !meta) set('conflict', [{ type: 'restricted-to', term: restriction.who, action: restriction.done ?? restriction.action, what: restriction.what, passive: Boolean(restriction.done), other, matched: what }]);
        else set('related', [{ type: 'topic-overlap', matched: what }]);
      }
    }

    // --- what the decision ruled out --------------------------------------------------------------------------------
    if (!relation && rejectedHits.length) {
      const role = intent.role(unique(rejectedHits.flatMap((h) => h.anchors)));
      // practice: the term names a way of working ("direct commits"), not a thing with a name ("Heroku", "Quartz").
      const isName = (h) => h.anchors.some((t) => isConcept(t)) || /^(?:[A-Z0-9][\w.+#-]*\s?){1,3}$/.test(String(h.term).trim());
      const ev = (type, extra = {}) => rejectedHits.map((h) => ({ type, term: h.term, matched: h.matched, practice: !isName(h), ...extra }));
      const actionMissing = action && !action.re.test(workNorm);
      // Mentioning data is not doing the prohibited thing with it; only show it when the work shares more of the topic.
      const sharesMore = shared.filter((t) => !rejectedHits.some((h) => h.tokens.includes(t))).length >= 1;
      const chosenRole = chosenHits.length ? intent.role(unique(chosenHits.flatMap((h) => h.anchors))) : null;
      if (role.kind === 'admin') {
        // nothing: a bill or a hire
      } else if (actionMissing) {
        if (sharesMore) set('related', ev('mentions-rejected-other-action', { action: action.label }));
      } else if (role.kind === 'removed' || role.kind === 'enforced' || role.kind === 'without') {
        set('aligned', ev('removes-rejected', { how: role.kind, ...cue(role) }));
      } else if (role.kind !== 'adopted' && chosenRole?.kind === 'adopted') {
        // The ruled-out option is only where things come from; the chosen one is where they go.
        set('aligned', chosenHits.map((h) => ({ type: 'mentions-chosen', term: h.term, matched: h.matched, ...cue(chosenRole) })));
      } else if (role.kind === 'adopted') {
        // Work that names both the ruled-out and the chosen option is on the decision's subject even without its
        // scope words (an RFC about account recovery that weighs SMS codes against passkeys is about 2FA).
        let scope = scopeState(d, ctx, rejectedProducts);
        if ((scope.state === 'unstated' || scope.state === 'outside') && chosenHits.length) scope = { state: 'named' };
        const full = rejectedHits.some((h) => h.coverage >= 0.99);
        const base = full && scopeHit ? 'high' : 'medium';
        if (scope.state === 'named' || scope.state === 'open') set('conflict', ev('mentions-rejected', { ...cue(role), action: action?.label }), base);
        else if (scope.state === 'unstated') set('conflict', ev('mentions-rejected', { ...cue(role), action: action?.label, scopeUnstated: scope.phrase ?? true }), LOWER[full ? 'high' : 'medium']);
        else if (scope.state === 'different' || otherEnv || rejectedHits.some((h) => h.anchors.some((t) => product(t)))) {
          set('related', ev('mentions-rejected-out-of-scope', { scope: d.scope, why: scope.why ?? null, purpose: scope.purpose ?? null }));
        }
      } else if (action) {
        // The action is there but the work only names the data: a fix, a report, a purpose.
        if (sharesMore || role.kind === 'titled') set('related', ev('mentions-rejected-other-action', { action: action.label }));
      } else {
        // Named, not adopted: a fix, a spike, a document, a purpose, a title.
        set('related', ev('mentions-rejected-not-adopted', { reason: mentionReason(role) }));
      }
    }

    // "No new features in the legacy billing module": work that adds something there goes against it.
    if (!relation && intent.intent === 'adopt' && ADDING.test(intent.verb ?? '')) {
      const frozen = (d.rejected ?? []).filter((t) => /^(?:any\s+)?new\s+(?:features?|functionality|code|endpoints?|services?|tables?|dependencies|integrations?|modules?|screens?|pages?|work)$/i.test(t));
      const where = (d.scope ?? []).filter((s) => {
        const strong = unique(tokens(s)).filter((t) => !GENERIC.has(t));
        return strong.length > 0 && strong.every((t) => workSet.has(t));
      });
      if (frozen.length && where.length && !['removed', 'without', 'enforced'].includes(intent.role(where.flatMap((s) => tokens(s))).kind)) {
        set('conflict', [{ type: 'adds-in-scope', term: frozen[0], scope: where, matched: unique(where.flatMap((s) => tokens(s))), verb: intent.verb }]);
      }
    }

    // --- what the decision chose -------------------------------------------------------------------------------------
    if (!relation && !rejectedHits.length) {
      const isProduct = (h) => h.anchors.length > 0 && h.anchors.every((t) => product(t));
      const roles = new Map(chosenHits.map((h) => [h, intent.role(h.anchors)]));
      // Removing or replacing what was chosen goes against it, and so does skipping a chosen requirement ("without
      // writing audit entries"); doing one thing without opening a chosen tool ("without opening Stripe") does not,
      // and neither does tidying up something that belongs to it ("delete the old Datadog dashboards").
      const against = chosenHits.filter((h) => {
        const r = roles.get(h);
        return (r.kind === 'removed' && !(r.part && isProduct(h))) || (r.kind === 'without' && !isProduct(h));
      });
      const below = (d.chosen ?? []).flatMap((t) => [...versionHits(t, text), ...countHits(t, d.statement, text)].map((alt) => ({ term: t, alternative: alt })));
      const named = alternativesFor(d, workProducts, summarySet, workSet);
      const alternatives = named.filter((a) => intent.role([a.product.token]).kind === 'adopted');
      const explicit = /\b(?:only|all new|every|standardi[sz]e|consolidate|must|always|exclusively|the standard)\b/i.test(d.statement ?? '') ? 'high' : 'medium';
      const adoptedChosen = chosenHits.filter((h) => roles.get(h).kind === 'adopted');
      const titledChosen = chosenHits.filter((h) => roles.get(h).kind === 'titled');
      if (against.length) {
        set('conflict', against.map((h) => ({ type: 'removes-chosen', term: h.term, matched: h.matched, how: roles.get(h).kind, ...cue(roles.get(h)) })), against.some((h) => h.coverage >= 0.99) ? 'high' : 'medium');
      } else if (below.length && !meta) set('conflict', below.map((x) => ({ type: 'uses-alternative', term: x.term, alternative: x.alternative, matched: [] })), explicit);
      else if (below.length && intent.intent !== 'inquiry') set('related', below.map((x) => ({ type: 'topic-overlap', matched: [x.alternative] })));
      else if (alternatives.length && ['named', 'open'].includes(scopeState(d, { ...ctx, workSet }, alternatives.map((a) => a.product), { alternative: true }).state)) {
        set('conflict', alternatives.map((a) => ({ type: 'uses-alternative', term: a.term, alternative: a.product.display, category: category(a.category).label, matched: [a.product.token], ...cue(intent.role([a.product.token])) })), explicit);
      } else if (chosenHits.length && chosenHits.some((h) => roles.get(h).kind !== 'admin')) {
        const ev = chosenHits.map((h) => ({ type: 'mentions-chosen', term: h.term, matched: h.matched, reason: roles.get(h).kind === 'mention' ? mentionReason(roles.get(h)) : null }));
        // A chosen product the work takes up follows the decision even without its scope words, unless the work
        // contradicts a qualifier of the scope; a chosen practice ("a pull request") needs the scope.
        const contradicted = (d.scope ?? []).some((s) => tokens(s).some((t) => CONTRAST[t]?.test(workNorm) && !workSet.has(t)));
        const takesProduct = adoptedChosen.some((h) => h.anchors.some((t) => product(t) && !product(t).categories.includes('cloud'))) && !contradicted;
        const earned = scopeHit || relevance >= 2 || takesProduct;
        // A named thing ("passkeys", "Legal", "iOS 16") or a whole distinctive phrase ("audit log entry") is specific
        // enough to follow without the scope; one common word ("a pull request") is not.
        const specific = adoptedChosen.some((h) => h.anchors.some((t) => isConcept(t) || workNames.has(t) || /[a-z]\d|\d[a-z]/.test(t)) || (h.anchors.length >= 2 && h.coverage >= 0.99));
        // A title that leads with the chosen thing follows it when the scope is there, or only names its kind.
        const titleFits = titledChosen.length > 0 && !contradicted && (scopeHit || ['named', 'open'].includes(scopeState(d, { ...ctx, workSet }, titledChosen.flatMap((h) => h.anchors.map((t) => product(t)).filter(Boolean))).state));
        if (!earned && !titleFits) {
          // falls through to topic overlap and the safety net
        } else if (!named.length && ((adoptedChosen.length && (scopeHit || takesProduct || specific || !(d.scope ?? []).length)) || titleFits)) set('aligned', ev);
        else set('related', ev);
      }
    }

    if (!relation && !rejectedHits.length && !chosenHits.length) {
      // Related must be earned: a distinctive scope word, or two distinctive shared words, one of them a key term.
      const keyShared = shared.filter((t) => doc.key.has(t));
      if ((keyShared.length >= 1 && distinctWords(shared) >= 2 && relevance >= 2.6) || (strongScope && relevance >= 1.2)) set('related', [{ type: 'topic-overlap', matched: shared.slice(0, 6) }]);
    }

    // A limit the work goes past, when the rule has an exception the work may meet ("without VP approval").
    if (!relation && limits.length) set('related', [{ type: 'topic-overlap', matched: limits.flatMap((h) => h.matched) }]);

    // Safety net: a decision whose own terms name something the work names is never invisible. Products, versions
    // ("iOS 15"), proper names ("Legal") and two-word nouns ("shared inbox") from what it chose or ruled out count;
    // generic words never do. Bug reports and maintenance on a chosen tool stay quiet.
    if (!relation && !upkeep && !restriction) {
      const net = netTerms(d, workSet, workToks, workNames);
      if (net.length) set('related', [{ type: 'topic-overlap', matched: net }]);
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

// Verbs that hand a permission to someone: "let junior developers approve ...", "allow anyone to merge ...".
const PERMIT = /^\W*(?:\[[^\]]*\]\s*)*(?:let|allow|allowing|enable|permit|authori[sz]e|empower|give|grant|open up)\b/i;
/**
 * The party a work item hands a restricted action to, when it is not the party the decision names:
 * "Let junior developers approve database migrations" against "Only senior engineers can approve ..." -> "junior developers".
 */
function otherParty(summary, restriction, who) {
  const action = escapeRe(restriction.action).replace(/e$/, '');
  const s = String(summary ?? '');
  let party = null;
  let m;
  if (PERMIT.test(s) && (m = s.match(new RegExp(`^\\W*(?:\\[[^\\]]*\\]\\s*)*\\w+(?:\\s+up)?\\s+(.+?)\\s+(?:to\\s+|permission to\\s+|the right to\\s+|access to\\s+)?${action}\\w*\\b`, 'i')))) party = m[1];
  else if ((m = s.match(new RegExp(`^(.+?)\\s+(?:can|may|should be able to|are allowed to|is allowed to|get to|gets to)\\s+${action}\\w*\\b`, 'i')))) party = m[1];
  else if ((m = s.match(new RegExp(`\\b${action}\\w*\\s+by\\s+(.+?)(?:\\s+(?:to|for|so|when|if|on|in)\\b|[,.;]|$)`, 'i')))) party = m[1];
  if (!party) return null;
  party = party.replace(/^(?:the|a|an|all|any|our|every|each)\s+/i, '').replace(/\s+(?:the|a|an)$/i, '').trim();
  const toks = new Set(tokens(party));
  if (!party || !toks.size || (who.length && who.every((t) => toks.has(t)))) return null;
  return party;
}

// Tokens that one phrase produces together ("the users table" gives customerdata and pii); they count once.
const TOGETHER = [
  ['customerdata', 'pii'],
  ['mobile', 'android', 'ios'],
  ['marketing', 'site'],
  ['sms', 'otp', 'mfa'],
  ['adr', 'architecture', 'decision'],
  ['production', 'productiondata', 'hotfix'],
  ['deploy', 'ship'],
  ['javascript', 'plainjs'],
  ['openai', 'anthropic', 'gemini', 'llm'],
  ['launchdarkly', 'featureflag'],
  ['euregion', 'usregion', 'apacregion', 'region'],
  ['azure', 'azureblob', 'azurefunctions', 'azurekeyvault'],
  ['gcp', 'gcs', 'cloudfunctions', 'google'],
].map((g) => g.map((w) => tokens(w)[0] ?? w));
/** How many separate words a set of shared tokens stands for. */
function distinctWords(toks) {
  const seen = new Set();
  for (const t of toks) {
    const group = TOGETHER.findIndex((g) => g.includes(t));
    seen.add(group >= 0 ? `g${group}` : t);
  }
  return seen.size;
}

/** A chosen term that starts with a count ("two approvals") needs that count in the work. */
function countOk(term, text) {
  const m = String(term).match(/^(?:at least\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+([a-z]+)/i);
  if (!m) return true;
  const n = Number(m[1]) || NUMBER[m[1].toLowerCase()];
  const noun = tokens(m[2])[0];
  COUNT.lastIndex = 0;
  let c;
  while ((c = COUNT.exec(text))) if ((Number(c[1]) || NUMBER[c[1].toLowerCase()]) === n && tokens(c[2])[0] === noun) return true;
  return false;
}

/**
 * What the work and the decision's own terms (what it chose and ruled out) both name: products, versions, proper
 * names and two-word nouns. Generic and weak words never count.
 */
function netTerms(d, workSet, workToks, workNames) {
  const terms = [...(d.chosen ?? []), ...(d.rejected ?? [])];
  if (!terms.length) {
    // Nothing parsed: fall back to names in the statement itself.
    const names = [...properNouns(d.statement)].filter((n) => workNames.has(n) && !STRONG_STOP.has(n));
    const products = unique(tokens(d.statement ?? '')).filter((t) => product(t) && workSet.has(t));
    return unique([...products, ...names]);
  }
  const out = [];
  for (const term of terms) {
    const toks = unique(tokens(term));
    for (const t of toks) if (workSet.has(t) && (product(t) || /[a-z]\d|\d[a-z]/.test(t))) out.push(t);
    const strong = tokens(term).filter((t) => !GENERIC.has(t) && !STRONG_STOP.has(t));
    for (let i = 0; i + 1 < strong.length; i++) {
      const [a, b] = [strong[i], strong[i + 1]];
      if (distinctWords([a, b]) === 2 && workToks.some((t, j) => t === a && workToks[j + 1] === b)) out.push(`${a} ${b}`);
    }
  }
  // A name counts when it stands on its own in both: "Google" in "Google Docs" and "Google Sheets" names two things.
  const termToks = new Set(terms.flatMap((t) => tokens(t)));
  const standsAlone = (n) => tokens(n).some((t) => termToks.has(t) && workSet.has(t));
  for (const n of properNouns(terms.join(', '))) if (workNames.has(n) && !STRONG_STOP.has(n) && standsAlone(n)) out.push(n);
  for (const n of properNouns(d.statement)) if (workNames.has(n) && !STRONG_STOP.has(n) && standsAlone(n) && terms.some((t) => t.toLowerCase().includes(n))) out.push(n);
  return unique(out);
}
// Capitalised words that name nothing in particular.
const STRONG_STOP = new Set(['the', 'this', 'that', 'all', 'any', 'every', 'new', 'use', 'api', 'apis', 'app', 'apps', 'ui', 'ux', 'pr', 'prs', 'friday', 'monday', 'tuesday', 'wednesday', 'thursday', 'saturday', 'sunday', 'decision', 'note', 'notes', 'shar', 'shared']);

/** A ruled-out version range the work falls into ("iOS 14" against "iOS 15 and below"). */
function rangeHit(term, text) {
  const hits = versionHits(term, text);
  return hits.length ? { term, tokens: tokens(term), matched: hits, anchors: tokens(hits[0]), coverage: 1 } : null;
}

/**
 * Other members of the chosen option's category that the work names, when it doesn't name the chosen option itself
 * (or names only the alternative in its summary): "Use Roboto for body text" against "Only use Inter".
 */
function alternativesFor(d, workProducts, summarySet, workSet) {
  if (!workProducts.length) return [];
  const chosen = (d.chosen ?? []).map((t) => ({ term: t, p: chosenProduct(t) })).filter((x) => x.p);
  if (!chosen.length) return [];
  const chosenTokens = new Set(chosen.map((x) => x.p.token));
  const rejected = new Set((d.rejected ?? []).flatMap((t) => tokens(t)));
  const out = [];
  for (const { term, p } of chosen) {
    if (p.rest.length && !p.rest.every((t) => workSet.has(t))) continue;
    for (const wp of workProducts) {
      if (chosenTokens.has(wp.token) || rejected.has(wp.token)) continue;
      const cat = wp.categories.find((c) => p.categories.includes(c));
      if (!cat) continue;
      // Naming both is a comparison or a migration unless the summary names only the alternative.
      if (workSet.has(p.token) && !(summarySet.has(wp.token) && !summarySet.has(p.token))) continue;
      out.push({ term, product: wp, category: cat });
    }
  }
  return out;
}

/** Free-text search over decisions (for the agent's search action and the MCP tool). */
export function searchDecisions(query, decisions, { limit = 5, index } = {}) {
  const idx = index ?? buildIndex(decisions);
  const q = unique(tokens(query));
  return idx.docs
    .map((doc) => ({ d: doc.d, score: bm25(idx, doc, q, { search: true }) }))
    .filter((x) => x.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => ({ decision: x.d, score: Math.round(x.score * 100) / 100 }));
}
