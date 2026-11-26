// Checks a piece of work (a Jira work item or a free-text proposal) against recorded decisions.
//
// Relations, strongest first:
//   conflict - the work adopts something a decision ruled out (within its scope), acts against what it chose
//              ("remove passkey support", "skip the postmortem"), or adopts another member of the chosen option's
//              category ("Use DynamoDB" against "PostgreSQL for all new services")
//   aligned  - the work adopts what a decision chose, or removes something a decision ruled out
//   related  - the work touches a decision's subject without a clear stance (a spike, a bug, a mention)
// Everything is deterministic and returns the evidence it used, so every flag can be explained.
import { tokens, normalize, weight, GENERIC, product, category } from './text.js';

const unique = (arr) => [...new Set(arr)];

// A prohibition tied to a specific action ("never log PII", "do not send transcripts to ...", "never store card
// numbers") only bites when the work does that action: an RFC that mentions phone numbers is not logging them.
// Generic verbs ("do not use X", "do not add X") carry no extra requirement.
const SEND = /\b(?:send\w*|sent|post\w*|upload\w*|shar\w*|forward\w*|transmit\w*|pass\w*|export\w*|stream\w*|call\w*|submit\w*)\b|\bto (?:the )?[\w-]+ api\b/;
const ACTIONS = {
  log: { re: /\b(?:log|logs|logged|logging|logger|trace|traces|tracing)\b/, label: 'logging' },
  send: { re: SEND, label: 'sending' },
  share: { re: SEND, label: 'sharing' },
  store: { re: /\b(?:stor\w*|sav\w*|keep\w*|kept|persist\w*|retain\w*|cach\w*|replicat\w*|cop(?:y|ies|ied|ying)|mirror\w*|sync\w*|dump\w*|back(?:s|ed|ing)? up|on file|in our database|in the database|column)\b/, label: 'storing' },
  collect: { re: /\b(?:collect\w*|gather\w*|captur\w*|ask\w* for|record\w*|field)\b/, label: 'collecting' },
  expose: { re: /\b(?:expos\w*|publish\w*|public\w*|make\w* public)\b/, label: 'exposing' },
};
const ACTION_OF = { log: 'log', logging: 'log', send: 'send', sending: 'send', share: 'share', sharing: 'share', store: 'store', storing: 'store', keep: 'store', keeping: 'store', collect: 'collect', collecting: 'collect', expose: 'expose', exposing: 'expose' };

/** The specific action a decision prohibits, if any: {key, label, re}. */
export function prohibitedAction(d) {
  const key = ACTION_OF[String(d.action ?? '').toLowerCase()];
  return key ? { key, ...ACTIONS[key] } : null;
}

/** Text of a work item used for matching. */
export function workText(work) {
  return [work.summary, work.description, (work.labels ?? []).join(' '), (work.components ?? []).join(' ')].filter(Boolean).join('. ');
}

// --- reading the work --------------------------------------------------------------------------------------------
// Words before a term that mean the work takes it away or keeps it out ("remove X", "migrate off X", "without X").
const AGAINST =
  /\b(?:remov|drop|deprecat|delet|kill|sunset|retir|replac|phas\w* out|disabl|stop|rip\w* out|eliminat|get\w* rid of|decommission|turn\w* off|switch\w* off|no longer|do not|does not|did not|never|uninstall|unregister|revok|skip|bypass|ignor|regardless of|defer|postpon|waiv|convert|swap|rehash|re hash|purg|downgrad|abandon|ditch|cancel|sunsett|retire|recreat|rebuild|re-?implement|move\w* away from|migrat\w* away from)\w*\b/;
const AGAINST_NEAR = /\b(?:off|away from|out of|without|instead of|rather than|in place of|other than)\s+(?:(?:a|an|the|any|our|their|its|legacy|old|remaining|existing|current)\s+){0,2}$/;
// Words before a term that keep a prohibition in force ("redact tokens", "a test that fails if PII ...").
const ENFORCE = /\b(?:redact|mask|scrub|strip|sanitiz|anonymi[sz]|pseudonymi[sz]|fail\w* if|detect|catch\w* (?:any|all)|lint|enforc|alert\w* (?:on|if|when)|block|prevent|forbid|ban|validat|filter\w* out|test\w* (?:that|for)|guard\w* against)\w*\b/;
const MOVE_VERB = /\b(?:migrat|mov|switch|shift|transition|port|convert)\w*\b/;
const TARGET_PREP = /\b(?:with|by|to|into|onto|as|in|on|using|via)\b/;
// Work that takes something up: "Use DynamoDB ...", "Add a yarn.lock ...", "[Android] Prototype ... in Flutter".
const ADOPT =
  /^\W*(?:\[[^\]]*\]\s*)*(?:(?:spike|poc)\s*:\s*)?(?:add|adding|use|using|adopt|introduce|integrate|set up|setup|spin up|create|build|deploy|migrate|move|switch|write|scaffold|bootstrap|provision|install|enable|implement|renew|load|put|paste|send|store|persist|replicate|ship|launch|start|roll out|run|host|stand up|bring|wire up|configure|keep|stay on|stick with|allow|support|offer|prototype|try|pilot|onboard|buy|subscribe|recreate|rebuild|port|split|standardi[sz]e|go with|choose|pick|select)\b/i;
// A spike or write-up reopens or explains a decision without acting on it.
const INQUIRY = /^\W*(?:spike|poc|investigate|evaluate|re-?evaluate|research|compare|assess|analy[sz]e|explore|benchmark|scan|audit|document|explain|write up|look into|estimate|survey|discuss)\b|\b(?:spike|poc)\s*:|\b(?:evaluat\w*|re-?evaluat\w*|investigat\w*|assess\w*|benchmark\w*|feasibility|trade-?offs?|pros and cons|document why|explain why|why we)\b/i;
// A bug report or tuning ticket works on what exists; it doesn't adopt or remove anything.
const MAINTENANCE = /\b(?:crash\w*|errors?|fail(?:s|ing|ed|ures?)?|broken|bug|flaky|out of (?:disk|memory|space)|exhausted|times? out|timeouts?|slow\w*|leak\w*|lag|outage|is down|stuck|not working|does not work|doesn't work|cannot|can't|unable|regression|hangs?|tun(?:e|ing)|misaligned|wrong|incorrect)\b/i;

// Hiring, training and talks mention a technology without adopting it ("Interview candidates for the Go role").
const META = /\b(?:interview\w*|candidates?|hir(?:e|es|ed|ing)\b|recruit\w*|job (?:ad|advert|post|posting|description|opening)s?|workshops?|lunch and learn|brown bag|meetups?|conference talks?|certifications?|onboarding docs? for new hires)\b/i;
// "new" in a scope ("all new services") is met by work that says new or starts something.
const NEWISH = /\b(?:new|brand[\s-]new|greenfield|from scratch)\b|^\W*(?:\[[^\]]*\]\s*)*(?:create|bootstrap|scaffold|spin up|launch|start|build|stand up|set up|provision|write)\b/i;
// Work that adds something ("Add coupon codes to the legacy billing module").
const ADDS = /^\W*(?:\[[^\]]*\]\s*)*(?:add|adding|build|implement|introduce|create|ship|launch|develop|extend|support|allow|enable|expose|integrate)\b/i;

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
]) for (const t of tokens(word)) CONTRAST[t] = re;
// Scope words a work can satisfy with a narrower word: a backend is a service or an API.
const SYNONYM = {};
for (const [word, alts] of [['backend', 'service services api apis server worker microservice microservices']]) for (const t of tokens(word)) SYNONYM[t] = tokens(alts);

/**
 * Does the work fall within a decision's scope? Each scope phrase is checked on its own:
 * - "outside the EU" is met by work in another region;
 * - "new" needs new work; a qualifier the work contradicts ("customer" vs "internal admin tool") rules it out;
 * - words that only name the kind of product involved ("emails" for SendGrid) prove nothing, and a phrase made
 *   only of such words or generic ones ("application caching" for Memcached) is met;
 * - otherwise a distinctive word must be in the work (half of them with half=true).
 */
function scopeHolds(scopeList, workSet, workNorm, text, products, { half = false } = {}) {
  if (!(scopeList ?? []).length) return true;
  const kind = new Set(products.flatMap((p) => p.categories.flatMap((c) => [...category(c).wordSet])));
  const regions = [...workSet].filter((t) => product(t)?.categories.includes('region'));
  const has = (t) => workSet.has(t) || (SYNONYM[t] ?? []).some((x) => workSet.has(x));
  return scopeList.some((s) => {
    const toks = unique(tokens(s));
    if (/^\s*outside\b/i.test(s)) {
      const inside = toks.filter((t) => product(t)?.categories.includes('region'));
      return inside.length > 0 && regions.some((r) => !inside.includes(r));
    }
    if (/\bnew\b/i.test(s) && !NEWISH.test(text)) return false;
    if (toks.some((t) => CONTRAST[t]?.test(workNorm) && !workSet.has(t))) return false;
    const strong = toks.filter((t) => !kind.has(t) && !ENV_OF[t] && !GENERIC.has(t));
    if (!strong.length) return true;
    const literal = strong.filter(has).length;
    return half ? literal * 2 >= strong.length : literal >= 1;
  });
}

/** Clauses of the work, normalised. Punctuation and "but"/"because" end a clause. */
function clausesOf(text) {
  return String(text ?? '')
    .split(/[.;:!?()\n]|,\s|\s[-–—]\s|\b(?:but|because|so that|although|though|whereas)\b/i)
    .map((c) => normalize(c))
    .filter(Boolean);
}

/**
 * How the work treats a term, judged from the words just before each of its tokens in the same clause:
 * 'against' (removes / replaces / avoids it), 'enforce' (keeps it out), 'target' (moves to it) or null.
 */
function stanceOn(clauses, toks) {
  let against = false;
  let enforce = false;
  let target = false;
  for (const clause of clauses) {
    for (const tok of toks) {
      const re = new RegExp(`\\b${tok.replace(/[^a-z0-9]/g, '')}\\w*`, 'g');
      let m;
      while ((m = re.exec(clause))) {
        const words = clause.slice(0, m.index).trim().split(' ').filter(Boolean);
        const before = words.slice(-6).join(' ');
        const cue = before.match(new RegExp(`${AGAINST.source}((?:\\s+\\S+){0,4})$`));
        if (AGAINST_NEAR.test(`${before} `) || (/\bfrom\s+(?:(?!(?:to|into|onto)\b)\S+\s+){0,2}$/.test(`${before} `) && MOVE_VERB.test(words.join(' '))) || (cue && !TARGET_PREP.test(cue[1] ?? ''))) against = true;
        else if (new RegExp(`${ENFORCE.source}(?:\\s+\\S+){0,5}$`).test(before)) enforce = true;
        else if (/\b(?:to|into|onto|for|with|as)\s+(?:(?:a|an|the|our)\s+)?$/.test(`${before} `) && MOVE_VERB.test(words.join(' '))) target = true;
      }
    }
  }
  // Moving from one place to another of the same kind ("from eu-west-1 to eu-central-1") leaves nothing behind.
  if (against && !target) return 'against';
  if (enforce) return 'enforce';
  return target ? 'target' : null;
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
  if (lenient && named.length && !productHit) return null;
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

// Nouns after a product that make the product a mere owner of the thing ("the Stripe webhook secret").
const OWNED = /^(?:secrets?|keys?|tokens?|credentials?|passwords?|accounts?|logins?|dashboards?|invoices?|bills?|contracts?|renewals?|seats?|licen[cs]es?|links?|ids?|urls?|domains?|quotas?|limits?|admins?|plans?)$/;
/** True when every mention of the token owns the next noun or the one after ("Twilio API key", "Stripe webhook secret"). */
function onlyOwner(tok, clauses) {
  let seen = false;
  for (const clause of clauses) {
    const re = new RegExp(`\\b${tok}\\b\\s*(\\S*)\\s*(\\S*)`, 'g');
    let m;
    while ((m = re.exec(clause))) {
      seen = true;
      if (!OWNED.test(m[1] ?? '') && !OWNED.test(m[2] ?? '')) return false;
    }
  }
  return seen;
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
    return { d, tf, stf, len: toks.length, key };
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
  const clauses = clausesOf(text);
  const summary = String(work.summary ?? '');
  const summarySet = new Set(tokens(summary));
  const inquiry = INQUIRY.test(summary) || META.test(summary);
  const maintenance = MAINTENANCE.test(summary);
  // A hotfix goes to production unless the work says where else it goes.
  const workEnvs = envsIn(workSet);
  const termSet = !workEnvs.size && workSet.has('hotfix') ? new Set([...workSet, 'production']) : workSet;
  const workProducts = unique(workToks.filter((t) => product(t))).map((t) => product(t));
  const workDistinct = unique(workToks.filter((t) => !GENERIC.has(t) && !WEAK.has(t)));
  const index = opts.index ?? buildIndex(decisions);
  const queryToks = unique(workToks);
  const findings = [];

  for (const doc of index.docs) {
    const d = doc.d;
    if (d.status === 'proposed') continue;
    const relevance = bm25(index, doc, queryToks);
    const shared = unique(workToks.filter((t) => doc.tf.has(t) && !GENERIC.has(t) && !WEAK.has(t)));
    const scopeHit = !(d.scope ?? []).length || (d.scope ?? []).some((s) => tokens(s).some((t) => workSet.has(t)));
    const superseded = d.status === 'superseded';

    const rejectedHits = (d.rejected ?? []).map((t) => findTerm(t, termSet) ?? rangeHit(t, text)).filter(Boolean);
    // A chosen count ("two approvals") is only followed by work that says the count; a product only by work that
    // uses it, not by work that merely owns something of it ("the Stripe webhook secret").
    const chosenHits = (d.chosen ?? [])
      .filter((t) => countOk(t, text))
      .map((t) => findTerm(t, workSet, { lenient: true }))
      .filter((h) => h && !(h.anchors.length && h.anchors.every((t) => product(t) && onlyOwner(t, clauses))));
    const action = prohibitedAction(d);
    // Work that names both the ruled-out and the chosen option is on the decision's subject even without its scope
    // words (an RFC about account recovery that weighs SMS codes against passkeys is about 2FA). So is work that
    // names a ruled-out product whose kind is the scope ("an ECS task" for "all production workloads").
    const rejectedProducts = unique(rejectedHits.flatMap((h) => h.anchors.filter((t) => product(t)))).map((t) => product(t));
    // Work that says it runs somewhere else ("to staging") is outside a rule about production, and the reverse.
    const decisionEnvs = envsIn([...(d.rejected ?? []), ...(d.scope ?? [])].flatMap((t) => tokens(t)));
    const otherEnv = decisionEnvs.size > 0 && workEnvs.size > 0 && ![...workEnvs].some((e) => decisionEnvs.has(e));
    const inScope = !otherEnv && (scopeHolds(d.scope, termSet, workNorm, text, rejectedProducts) || (rejectedHits.length > 0 && chosenHits.length > 0));
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

    if (rejectedHits.length) {
      const stance = stanceOn(clauses, rejectedHits.flatMap((h) => h.anchors));
      const actionMissing = action && !action.re.test(workNorm);
      const otherAction = (label) => set('related', rejectedHits.map((h) => ({ type: 'mentions-rejected-other-action', term: h.term, matched: h.matched, action: label })));
      if (inquiry) otherAction(action?.label ?? 'adopting');
      else if (actionMissing) {
        // Mentioning the data is not doing the prohibited thing; only show it when the work shares more of the topic.
        if (shared.filter((t) => !rejectedHits.some((h) => h.tokens.includes(t))).length >= 1) otherAction(action.label);
      } else if (stance === 'against' || stance === 'enforce') set('aligned', rejectedHits.map((h) => ({ type: 'removes-rejected', term: h.term, matched: h.matched })));
      else if (chosenHits.length && stanceOn(clauses, chosenHits.flatMap((h) => h.anchors)) === 'target') set('aligned', chosenHits.map((h) => ({ type: 'mentions-chosen', term: h.term, matched: h.matched })));
      else if (maintenance) otherAction('adopting');
      else if (inScope) {
        const full = rejectedHits.some((h) => h.coverage >= 0.99);
        set('conflict', rejectedHits.map((h) => ({ type: 'mentions-rejected', term: h.term, matched: h.matched })), full && (d.scope ?? []).length ? 'high' : full || (d.scope ?? []).length ? 'medium' : 'low');
      } else if (otherEnv || rejectedHits.some((h) => h.anchors.some((t) => product(t)))) {
        set('related', rejectedHits.map((h) => ({ type: 'mentions-rejected-out-of-scope', term: h.term, matched: h.matched, scope: d.scope })));
      }
    }

    // "No new features in the legacy billing module": work that adds something there goes against it.
    if (!relation && !inquiry && !maintenance && ADDS.test(summary)) {
      const frozen = (d.rejected ?? []).filter((t) => /^(?:any\s+)?new\s+(?:features?|functionality|code|endpoints?|services?|tables?|dependencies|integrations?|modules?|screens?|pages?|work)$/i.test(t));
      const where = (d.scope ?? []).filter((s) => {
        const strong = unique(tokens(s)).filter((t) => !GENERIC.has(t));
        return strong.length > 0 && strong.every((t) => workSet.has(t));
      });
      if (frozen.length && where.length && !stanceOn(clauses, where.flatMap((s) => tokens(s)))) {
        set('conflict', [{ type: 'adds-in-scope', term: frozen[0], scope: where, matched: unique(where.flatMap((s) => tokens(s))) }]);
      }
    }

    if (!relation && !rejectedHits.length) {
      const against = chosenHits.filter((h) => stanceOn(clauses, h.anchors) === 'against');
      const below = (d.chosen ?? []).flatMap((t) => [...versionHits(t, text), ...countHits(t, d.statement, text)].map((alt) => ({ term: t, alternative: alt })));
      const alternatives = alternativesFor(d, workProducts, summarySet, workSet).filter((a) => adopts(a.product.token, summary, clauses));
      const explicit = /\b(?:only|all new|every|standardi[sz]e|consolidate|must|always|exclusively)\b/i.test(d.statement ?? '') ? 'high' : 'medium';
      if (against.length && !inquiry) set('conflict', against.map((h) => ({ type: 'removes-chosen', term: h.term, matched: h.matched })), against.some((h) => h.coverage >= 0.99) ? 'high' : 'medium');
      else if (below.length && !inquiry) set('conflict', below.map((x) => ({ type: 'uses-alternative', term: x.term, alternative: x.alternative, matched: [] })), explicit);
      else if (alternatives.length && !inquiry && !maintenance && scopeHolds(d.scope, workSet, workNorm, text, alternatives.map((a) => a.product), { half: true })) {
        set('conflict', alternatives.map((a) => ({ type: 'uses-alternative', term: a.term, alternative: a.product.display, category: category(a.category).label, matched: [a.product.token] })), explicit);
      } else if (chosenHits.length && (scopeHit || relevance >= 2)) {
        const ev = chosenHits.map((h) => ({ type: 'mentions-chosen', term: h.term, matched: h.matched }));
        if (inquiry || maintenance || alternatives.length) set('related', ev);
        else set('aligned', ev);
      }
    }

    if (!relation && !rejectedHits.length && !chosenHits.length) {
      // Related must be earned: a distinctive scope word, or two distinctive shared words, one of them a key term.
      const keyShared = shared.filter((t) => doc.key.has(t));
      if ((keyShared.length >= 1 && distinctWords(shared) >= 2 && relevance >= 2.6) || (strongScope && relevance >= 1.2)) set('related', [{ type: 'topic-overlap', matched: shared.slice(0, 6) }]);
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
 * Does the work take the product up? Its summary starts with an adoption verb ("Use DynamoDB for ...") or leads with
 * the product ("Opsgenie schedule for ..."), and the product isn't only the owner of something ("the Grafana instance").
 */
function adopts(tok, summary, clauses) {
  if (onlyOwner(tok, clauses)) return false;
  if (ADOPT.test(summary)) return true;
  return tokens(summary.replace(/^\W*(?:\[[^\]]*\]\s*)*/, ''))[0] === tok;
}

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
