// Reads what a piece of work intends to do with the things it names, before any decision is looked at.
//
// A summary is read as [labels] <lead verb> <object> <phrases>. The lead verb puts the clause in a class, and every
// word gets a role from that class and from where it sits in the clause:
//   adopted   the work takes it up            "Deploy the admin tool on Heroku", "Rebuild the screens with Bootstrap"
//   titled    a verbless title leads with it  "Figma file for the new settings page"
//   removed   the work takes it away          "Remove PayPal", "Migrate off Heroku", "passkeys instead of SMS codes"
//   enforced  the work keeps it out           "Block direct commits", "Redact card numbers"
//   without   the work goes ahead without it  "Launch the copy without waiting for Legal"
//   mention   the work only names it          a fix, an investigation, a document, a purpose ("to save CDN costs")
//   admin     money and people                "Heroku invoice for October", "Hire two senior engineers"
// A decision is only contradicted by work that adopts what it ruled out or removes what it chose, so everything a
// conflict needs is decided here, in one place, and comes with the word that decided it.
import { normalize, tokenOf, product } from './text.js';

// --- verbs --------------------------------------------------------------------------------------------------------
const VERBS = {
  // Taking something up, or doing something with it.
  adopt:
    'add, use, adopt, introduce, integrate, set up, setup, spin up, stand up, create, build, deploy, expose, store, serve, export, renew, let, allow, enable, ' +
    'implement, install, provision, configure, wire up, hook up, connect, plug in, embed, ship, launch, roll out, rollout, release, publish, host, run, write, ' +
    'develop, code, scaffold, bootstrap, prototype, pilot, trial, try, onboard, buy, purchase, subscribe to, sign up for, sign, order, book, extend, put, place, ' +
    'keep, retain, stay on, stay with, stick with, continue with, support, offer, provide, permit, accept, send, route, forward, post, push, upload, import, load, ' +
    'fetch, pull, read, query, call, invoke, sync, replicate, copy, mirror, save, persist, cache, log, record, capture, collect, track, show, display, render, ' +
    'include, attach, apply, submit, schedule, text, email, notify, message, summarise, summarize, translate, transcribe, generate, extract, split, standardise on, ' +
    'standardize on, standardise, standardize, consolidate on, go with, choose, pick, select, default to, make, turn on, switch on, activate, register, process, ' +
    'handle, wrap, gate, power, back, style, design, mock up, bring back, reintroduce, re-enable, reenable, restore, reinstate, share, paste, print, return, pass, ' +
    'fine-tune, finetune, feed, index, ingest, stream, pipe, batch, queue, enqueue, proxy, mount, package, bundle, tokenize, tokenise, encrypt, hash, ' +
    'pay with, pay by, pay via, pay using, pay through, pay in, train, ' +
    'authenticate, grant, issue, charge, sell, invite, enrol, enroll, require, mandate, expand, pin, target, opt for, move back to, switch back to, go back to, ' +
    'fall back to, revert to, return to, rely on, depend on, commit, merge, check in, refresh, seed, populate, backfill, clone, dump, hydrate, automate, compute, ' +
    'calculate, parse, upsert, insert, append, expire, throttle, compress, crawl, scrape, subscribe, listen, consume, emit, dispatch, broadcast, bind, assign, ' +
    'delegate, outsource, hand over, hand off',
  // Giving something a new form: what it was goes away, what it becomes is taken up.
  transform: 'rebuild, rewrite, recreate, reimplement, re-implement, redo, convert, port, rehash, re-hash, refactor, rework, redesign, reskin, restyle, replatform, re-platform',
  // Moving or adjusting: the thing moved is only named; "from X" is left behind and "to Y" is taken up.
  move: 'migrate, move, switch, transition, shift, change, set, point, repoint, redirect, cut over',
  // Adjusting what exists: "to 22" is a new value, not a new tool, unless the clause goes on "to use X".
  adjust: 'update, upgrade, downgrade, raise, bump, lower, increase, decrease, reduce, shorten, lengthen, tweak, adjust, modify, edit, revise, amend, scale, scale up, scale down, scale out, resize, rescale, right-size, rightsize',
  // Taking something away, or not doing it.
  remove:
    'remove, drop, deprecate, delete, kill, sunset, retire, replace, swap, substitute, phase out, disable, stop, rip out, eliminate, get rid of, decommission, turn off, ' +
    'switch off, uninstall, unregister, revoke, cancel, abandon, ditch, purge, tear down, shut down, strip out, strip, end, terminate, unsubscribe from, roll back, ' +
    "rollback, revert, undo, skip, bypass, ignore, defer, postpone, waive, exclude, migrate off, migrate away from, move off, move away from, switch away from, " +
    "get off, wean off, offboard, close down, wind down, opt out of, do not, don't, dont, never, no longer, avoid, stop using, quit, decline, refuse, turn down, veto",
  // Keeping something out.
  enforce: 'block, prevent, forbid, ban, disallow, prohibit, redact, mask, scrub, sanitise, sanitize, anonymise, anonymize, pseudonymise, pseudonymize, restrict, reject, deny, enforce, lint, detect, guard against, guard, flag, fail, filter out, alert on, warn on',
  // Looking into something without acting on it.
  inquiry:
    'investigate, look into, look at, review, compare, evaluate, re-evaluate, reevaluate, assess, analyse, analyze, research, explore, benchmark, scan, audit, explain, ' +
    'survey, discuss, estimate, spike, measure, profile, trace, check, verify, confirm, ask, clarify, decide, consider, study, learn, understand, find out, figure out, ' +
    'determine, identify, brainstorm, scope, size, test, validate, revisit, rethink, reconsider, write up, document, describe, inventory, map out, think about, report on, ' +
    'monitor, watch, observe, alert, plan, draft, outline, propose, recommend, weigh, shortlist, demo, present, list, mention, reference, cite, note, remind, tell, ' +
    'inform, brief, meet, chat, talk, answer, reply, respond, comment, report, nudge, ping, find, see, read up on, catch up on, sync with, check in with, flag up, ' +
    'raise with, question, challenge, debate, vote on, poll, interview users, shadow, observe',
  // Keeping what exists working.
  maintain:
    'fix, debug, troubleshoot, diagnose, repair, resolve, patch, hotfix, triage, reproduce, tune, optimise, optimize, improve, speed up, rename, clean up, cleanup, tidy, ' +
    'tidy up, reorganise, reorganize, restart, reboot, rotate, archive, back up, backup, harden, rebase, reword, proofread, correct, address, unblock, unbreak, stabilise, ' +
    'stabilize, deflake, follow up, close, reopen, silence, mute, snooze, acknowledge, escalate',
  // Money and people. ("Pay with PayPal" is a product feature and sits with the adoption verbs; billing and
  // invoicing are read from their object: "bill customers through Stripe" against "the Stripe bill".)
  admin: 'pay, reimburse, hire, interview, recruit, attend, announce, celebrate, thank, congratulate, welcome, negotiate, teach, coach, mentor, educate, upskill',
};
// Ordinary verbs that open an instruction without saying what kind. A verb-led title does work unless its verb says
// otherwise, so these count as adoption, with less confidence than a verb that names it.
const COMMON_VERBS = new Set(
  ('take, give, get, bring, perform, conduct, complete, finish, finalise, finalize, arrange, organise, organize, coordinate, assemble, compile, gather, grab, enter, ' +
    'localise, localize, illustrate, animate, hide, unhide, reveal, predict, simulate, recover, rescue, lend, borrow, spend, advertise, relaunch, rebrand, allocate, appoint, ' +
    'nominate, elect, wipe, flush, drain, refill, reload, retry, repeat, iterate, warn, dial, manage, steer, oversee, supervise, divide, distribute, align, adapt, tailor, ' +
    'customise, customize, personalise, personalize, polish, refine, enhance, enrich, augment, grow, stretch, shrink, narrow, widen, deepen, slash, halve, protect, insure, ' +
    'certify, authorise, authorize, approve, countersign, ratify, reassign, enclose, omit, receive, obtain, acquire, procure, deliver, carry, declare, define, derive, detach, ' +
    'duplicate, inject, intercept, override, overwrite, prefill, pre-fill, preload, prepare, prepend, reroute, reuse, squash, unify, unlock, hardcode, hard-code, have, do').split(/,\s*/),
);
// The same, for words that are just as often a noun ("leave policy", "open questions", "stage environment"): these
// only open an instruction when an object and a phrase follow ("Leave review comments on the flow in Figma").
const NOUNY_VERBS = new Set(
  ('leave, hold, fill, cover, cut, lock, open, stage, drive, lift, double, own, help, clear, empty, reserve, transfer, supply, refund, promote, visit, join, mix, pack, slot, ' +
    'wire, toggle, surface, lease, rent, spread, fold, nest, loop, pool, stash, stitch, tie, zip, layer, plug, hook, craft, bolt, bake, vendor, whitelist, allowlist, shard, preview').split(/,\s*/),
);
const VERB = new Map();
for (const [cls, words] of Object.entries(VERBS)) for (const v of words.split(/,\s*/)) if (v && !VERB.has(v)) VERB.set(v, cls);
const FIRST = new Set([...VERB.keys()].map((v) => v.split(' ')[0]));
const ANY_VERB = new Set([...VERB.keys()].filter((v) => !v.includes(' ')));
// Verbs that state a purpose after "to": "to save costs", "to speed things up".
const PURPOSE_VERBS = new Set(
  'save, speed, cut, help, get, meet, comply, satisfy, match, align, line, see, free, hit, reach, cover, protect, ensure, simplify, dedupe, deduplicate, make, give, be, have, do, work, win, unlock, boost, catch, find, know, tell, stay, look, feel, fit, mention, reflect, say, note, show, avoid, prevent, keep, let, reduce, improve, lower'.split(', '),
);
// After "to", these keep the instruction going: "update the checkout to use Braintree".
const CARRY_VERB = /^(?:use|adopt|support|allow|call|include|run|host)$/;

/** The base form of an inflected verb when the base is one we know: "adding" -> "add", "stored" -> "store". */
function baseVerb(word) {
  const w = word.toLowerCase();
  const tries = [w];
  if (w.endsWith('ies')) tries.push(`${w.slice(0, -3)}y`);
  if (w.endsWith('es')) tries.push(w.slice(0, -2));
  if (w.endsWith('s')) tries.push(w.slice(0, -1));
  if (w.endsWith('ied')) tries.push(`${w.slice(0, -3)}y`);
  if (w.endsWith('ed')) tries.push(w.slice(0, -2), w.slice(0, -1), w.slice(0, -3));
  if (w.endsWith('ing')) tries.push(w.slice(0, -3), `${w.slice(0, -3)}e`, w.slice(0, -4));
  const known = tries.find((t) => t.length > 1 && FIRST.has(t));
  if (known) return known;
  // Doing it again is still doing it: "reindex", "re-run", "redeploy".
  const again = w.match(/^re-?([a-z]{3,})$/);
  return again ? baseVerb(again[1]) : null;
}

// Words that are a verb and a noun: followed by one of these nouns they head a title ("Build pipeline for mobile",
// "Release notes for 6.0", "Support ticket backlog"), not an instruction.
const NOUNISH_VERB = new Set(
  'build, deploy, test, release, design, support, log, cache, export, import, index, load, queue, schedule, process, store, host, record, track, package, bundle, stream, batch, back, power, gate, style, code, text, email, message, call, query, mirror, copy, post, push, pull, order, book, issue, sign, set, run, launch, review, audit, check, monitor, alert, plan, estimate, document, report, survey, research, benchmark, spike, patch, fix, budget, invoice, bill, target, pilot, trial, demo, change, update, upgrade, move, shift, switch, point, flag, guard, scope, size, profile, trace, list, return, pass, feed, pin, charge, commit, merge'.split(', '),
);
const NOUN_AFTER =
  /^(?:pipelines?|scripts?|plans?|notes|docs?|tickets?|retention|invalidation|jobs?|wizard|tests?|depth|policy|policies|process|servers?|times?|failures?|errors?|queues?|logs?|buttons?|pages?|screens?|flows?|steps?|stages?|config|configuration|settings|status|cadence|trains?|branch|branches|tags?|versions?|candidates?|checklist|agents?|runners?|keys?|targets?|artifacts?|size|speed|tooling|engineers?|team|manager|lead|reviews?|requests?|management|freeze|windows?|calendar|backlog|board|reports?|formats?|levels?|volumes?|rates?|limits?|lag|latency|duration|history|health|strategy|orders?|data|files?|records?|messages?|conflicts?|hooks?|bot|bots)$/;
const MODAL_AFTER = /^(?:can|could|will|would|should|must|may|might|is|are|was|were|has|have|had|isn't|aren't|doesn't|don't|didn't|won't|fails?|failed|failing|breaks?|broke|broken|keeps?|takes?|returns?|shows?|throws?|hangs?)$/;
const DETERMINER = /^(?:the|a|an|our|all|every|each|this|that|these|those|some|any|my|your|their|its|his|her|another|new|old|both|more|less|one|two|three|four|five|\d+)$/;
const PREPOSITION = /^(?:for|in|on|to|with|at|from|of|by|via|using|into|onto|across|behind|after|before|when|without|about|against|during|per|through|off|over|under|within)$/;

// --- nouns --------------------------------------------------------------------------------------------------------
// Money and people: a bill, a quote or a headcount plan names a product without touching what was decided about it.
const ADMIN_NOUN = /^(?:invoices?|bills?|budgets?|budgeting|spend|quotes?|headcount|reimbursements?|expenses?|payroll|salary|salaries|interviews?|candidates?|hiring|recruiting|recruitment|offsite|dinner|lunch|party|birthday|holiday|vacation|pto|deck|slides|costs?|receipts?|vacancy|vacancies|applicants?)$/;
const ADMIN_TITLE = /\b(?:invoices?|bills?|budgets?|budgeting|spend|quotes?|headcount|reimbursements?|expenses?|payroll|salary|salaries|interviews?|candidates?|hiring|recruiting|recruitment|offsite|deck|slides|costs?|receipts?|pricing(?!\s+(?:pages?|tables?|tiers?|plans?|models?|engine|service|api|rules?|calculator|experiments?|copy|section|component|logic|change|changes)\b))\b/;
// Writing, talking and looking: a comparison, a guide, a ticket or a meeting is about a thing, it does not adopt it.
const DOC_NOUN =
  /^(?:comparisons?|docs?|documentation|guides?|tutorials?|readme|handbook|runbooks?|playbooks?|faq|faqs|write-?ups?|audits?|analysis|analyses|assessments?|evaluations?|benchmarks?|investigations?|research|summary|summaries|notes|posts?|blog|blogs|articles?|announcements?|talks?|presentations?|workshops?|trainings?|courses?|questions?|surveys?|roadmaps?|proposals?|rfcs?|tickets?|meetings?|retros?|retrospectives?|postmortems?|typos?|sections?|paragraphs?|memos?|briefs?|overview|explainer|primer|glossary|reviews?|reports?|diagrams?)$/;
// Nouns that show, count or sum up what follows "of": "screenshots of the old Bootstrap navbar", "a list of Jenkins jobs".
const ABOUT_NOUN = /^(?:lists?|screenshots?|recordings?|videos?|photos?|pictures?|summary|summaries|overview|inventory|inventories|count|breakdown|map|diagrams?|audit|history|samples?|examples?|mockups?|demos?|copy|copies|snapshots?|backups?|exports?|dumps?|traces?|logs?|records?|review|reviews|comparison|analysis|usage|cost|costs|status)$/;
// Nouns followed by "on", "about" or "for" plus what they concern: "feedback on the Tableau trial".
const FEEDBACK_NOUN = /^(?:feedback|input|opinions?|views?|thoughts|comments?|ideas?|requirements?|quotes?|numbers|stats|statistics|metrics|info|information|details|learnings|lessons|findings|insights?|complaints?|updates?|progress|news|guidance|advice|notes|questions?|answers?|clarity|clarification|sign-?off|approval|consensus|agreement|alignment)$/;
// Nouns after a name that say it is going away, or only moving: "the Heroku shutdown", "the Jenkins migration".
const ENDING_NOUN = /^(?:shutdown|removal|deprecation|sunset|sunsetting|retirement|decommission|decommissioning|teardown|exit|phase-?out|phaseout|offboarding|cancellation|termination|wind-?down|eol|offramp|off-?boarding)$/;
const MOVING_NOUN = /^(?:migration|migrations|move|cutover|cut-?over|switch|switchover|transition|replacement|upgrade|upgrades|rename|handover|hand-?off|consolidation|rewrite|cleanup|clean-?up|deletion|purge)$/;
// Where a thing is only written down: "add Heroku to the list of deprecated platforms".
const LIST_NOUN = /^(?:list|lists|blocklist|denylist|allowlist|glossary|changelog|readme|faq|docs|documentation|wiki|handbook|runbook|agenda|roadmap|register|registry|inventory|comparison|matrix|backlog|radar)$/;
// Trouble: a title or a sentence about something going wrong reports on what exists.
const PROBLEM =
  /\b(?:crash\w*|errors?|fail(?:s|ing|ures?)?|failed(?![\s-](?:payments?|charges?|jobs?|logins?|attempts?|transactions?|orders?|webhooks?|deliver\w*))|broken|bugs?|flaky|out of (?:disk|memory|space)|exhausted|times? out|timeouts?|slow\w*|leak\w*|lag|outage|is down|stuck|not working|does not work|doesn't work|cannot|can't|unable|regression|hangs?|misaligned|wrong|incorrect|alerts?|incidents?|downtime|degraded|spike in|noisy|stale|missing|cut off|truncated|unresponsive|intermittent\w*)\b/i;
// A sentence with a subject and a finite verb reports or describes; it is not an instruction.
const FINITE = /\b(?:is|are|was|were|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|has|have|had|lands?|dumps?|returns|throws?|keeps|takes|stops|gets|goes|says|still)\b/i;
// Things that belong to a product without being it: removing them is housekeeping, not moving off the product.
const PART_NOUN =
  /^(?:tags?|dashboards?|alerts?|monitors?|flags?|index|indexes|indices|consumers?|topics?|partitions?|snapshots?|backups?|rules?|jobs?|queues?|tables?|columns?|rows?|records?|users?|seats?|keys?|secrets?|tokens?|credentials?|logs?|events?|metrics?|tests?|warnings?|errors?|duplicates?|branches|branch|channels?|templates?|macros?|tickets?|issues?|boards?|projects?|accounts?|invoices?|bills?|contracts?|renewals?|licen[cs]es?|links?|ids?|urls?|domains?|quotas?|limits?|admins?|plans?|webhooks?|buckets?|objects?|files?|entries|entry|nodes?|pods?|replicas?|instances?|volumes?|certificates?|certs?|sessions?|caches?|messages?|subscriptions?|pipelines?|runs?|builds?|artifacts?|workspaces?|spaces?|pages?|widgets?|comments?|drafts?|exports?|reports?)$/;
const CLEANUP = /^(?:old|unused|stale|duplicate|duplicated|obsolete|orphaned|orphan|dead|expired|temporary|temp|test|leftover|redundant|outdated|empty|broken|failed|inactive|abandoned|extra|spare)$/;
// Nouns that pass "for" through to what follows: support for X adopts X.
const SUPPORT_NOUN = /^(?:support|integration|integrations|connector|connectors|plugin|plugins|sdk|client|adapter|adapters|driver|drivers|wrapper|bindings?|handler|handlers|exporter|importer)$/;
// Buying and renewing make an owned thing ("the New Relic contract") an adoption.
const COMMERCIAL = /^(?:renew|extend|sign|buy|purchase|subscribe to|sign up for|order|upgrade)$/;
// Verbs that take what they use from a source: "serve images from S3" adopts S3.
const SOURCE_VERB = /^(?:serve|load|read|fetch|pull|import|copy|sync|replicate|stream|query|call|get|consume|ingest|feed|render|show|display|host|run|deploy|restore|send|export|mirror|proxy|pipe|refresh|seed|populate|backfill|clone|hydrate|dump|build|generate|train|scrape|crawl|trigger|launch|start|execute|schedule|publish|release|ship|kick)$/;
const MOVING = /^(?:mov\w+|migrat\w+|switch\w*|shift\w*|transition\w*|get|getting|wean\w*|come|coming|go|going)$/;

// --- clauses ------------------------------------------------------------------------------------------------------
const LABEL = /^\s*(?:\[[^\]]*\]|\([^)]*\))\s*/;
const PREFIX = /^\s*(spike|poc|research|investigation|question|discussion|rfc|proposal|idea|bug|defect|incident|postmortem|post-mortem|docs?|chore|task|story|feat|feature|epic|tech debt|todo|fix|hotfix|ui|ux|be|fe|backend|frontend|infra|ops|mobile|web|api)\s*[:\-–—]\s+/i;
const PREFIX_CLASS = { spike: 'inquiry', research: 'inquiry', investigation: 'inquiry', question: 'inquiry', discussion: 'inquiry', bug: 'maintain', defect: 'maintain', incident: 'maintain', postmortem: 'maintain', 'post-mortem': 'maintain', fix: 'maintain', hotfix: 'maintain', doc: 'doc', docs: 'doc' };
const STORY = /^\s*as an?\s+[^,]+?,?\s*(?:i|we)\s+(?:want|need|would like|wish|can|should be able)\s+(?:to\s+(?:be able to\s+)?)?/i;
const ASK = /^\s*(?:please|pls|kindly|todo:?|can you|could you|can we|could we|we should|we need to|we must|we have to|we want to|we will|we'll|we are going to|we're going to|i want to|i'd like to|let's|let us|need to|have to|must|should|want to|would like to|time to|plan to|planning to|going to|try to|trying to|make sure to|remember to|the plan is to|goal is to|the goal is to|this ticket will|this story will|this change will|this pr will)\s+/i;
const QUESTION = /\?\s*$|^\s*(?:should we|shall we|what|why|how|which|whether|does|is it|are we|do we)\b/i;
const VERSUS = /\b(?:vs\.?|versus)\b/i;
const SUBORDINATE = /^\s*(?:when|if|once|after|before|whenever|while|as soon as|every time|each time)\b[^,]*,\s*/i;
const BACKGROUND = /\b(?:currently|today|right now|at the moment|at present|already|existing|historically|used to|so far|still|previously|in the past|last (?:year|quarter|month|week|sprint))\b/i;
const JOINER = /^(?:and|then|&|\+|plus)$/i;
const ADVERB = /^(?:also|just|now|then|finally|first|next|temporarily|quickly|always|only|simply|please|properly|actually|maybe|probably|automatically|manually|explicitly|gradually|immediately|permanently|optionally|silently|eventually|partially|fully|safely|securely|directly|officially|formally|urgently)$/;
// Verbs that add to something that is already there: "add retries to the Jenkins pipeline" changes the pipeline,
// it does not take Jenkins up.
const ADDS_TO = /^(?:add|include|attach|append|insert|apply|extend|introduce)$/;
// Verbs that make a document, a ticket or a meeting.
const AUTHORING = /^(?:write|create|add|draft|prepare|publish|make|produce|give|run|schedule|book|post|share|host|record|generate|open|file|raise|log|extend|start|begin|send|build|design|develop|include|put|issue|provide|offer)$/;
// Kinds of product a document, a ticket or a meeting is made in.
const WRITING_TOOLS = new Set(['docs', 'design', 'tracker', 'chat', 'meetings', 'bi', 'cms', 'support', 'crm']);
// Verbs with a receiver and a thing given: "give X a Y", "grant the team an exception".
const GIVES = /^(?:give|grant|send|show|offer|lend|hand|assign|award|issue|bring|get)$/;
// Verbs that work on what is already there, as opposed to creating or setting something up.
const OPERATES =
  /^(?:translate|send|forward|post|show|display|render|print|return|pass|share|paste|copy|mirror|sync|replicate|read|query|fetch|pull|load|import|export|upload|save|persist|cache|log|record|capture|collect|track|summarise|summarize|transcribe|extract|split|process|handle|parse|compute|calculate|index|ingest|stream|pipe|batch|queue|route|notify|message|email|text|encrypt|hash|compress|expire|throttle|crawl|scrape|include|attach|apply|submit|schedule|assign|delegate|refresh|dump|clone)$/;
// Verbs that carry something from one place to another.
const TRANSFER = /^(?:sync|copy|mirror|replicate|import|export|forward|send|push|pull|load|feed|pipe|stream|route|post|publish|upload|dump|backfill|ingest)$/;
// Verbs that take a copy of what something holds, or pass it on.
const EXTRACTS = /^(?:export|download|dump|copy|pull|fetch|scrape|mirror|replicate|import|share|forward|print)$/;
// Words that keep the thing after them out, within a few words: "redact", "a test that fails if", "alert on".
// (Whole words: "strip" is not "Stripe", "ban" is not "banner", "block" is not "blockchain".)
const KEEPS_OUT =
  /\b(?:redact\w*|mask(?:s|ed|ing)?|scrub\w*|strip(?:s|ped|ping)?|sanitiz\w*|sanitis\w*|anonymi[sz]\w*|pseudonymi[sz]\w*|fail\w* if|detect\w*|catch\w* (?:any|all)|lint(?:s|ed|ing|er)?|enforc\w*|alert\w* (?:on|if|when)|block(?:s|ed|ing)?|prevent\w*|forbid\w*|ban(?:s|ned|ning)?|validat\w*|filter\w* out|test\w* (?:that|for)|guard\w* against)(?:\s+\S+){0,5}$/;
// Words after a name that do not make it describe something else: "to PagerDuty nightly", "in Kong again".
const AFTERWORD = /^(?:and|or|so|then|now|later|today|tomorrow|nightly|daily|weekly|monthly|only|too|again|first|instead|directly|automatically|manually)$|(?:ed|ing)$/;

/** Splits text into clauses: sentence punctuation, dashes, and a comma or "and" before another instruction. */
function splitClauses(text) {
  const out = [];
  for (const piece of String(text ?? '').split(/\.\s+|\.$|[;:!?()\n]+|\s[-–—]\s|\bbut\b/)) {
    const words = piece.trim().split(/\s+/).filter(Boolean);
    let from = 0;
    for (let i = 1; i < words.length - 1; i++) {
      const joined = JOINER.test(words[i]);
      if (!joined && !/,$/.test(words[i - 1])) continue;
      const at = joined ? i + 1 : i;
      const next = words[at];
      // A capitalised word in the middle of a sentence is a name ("Tailwind and Bootstrap"), never an instruction.
      if (!next || /^[A-Z]/.test(next) || !FIRST.has(next.toLowerCase().replace(/[^a-z'-]/g, '')) || !leadVerb(words.slice(at))) continue;
      // An instruction has an object: a determiner, or several words ("and drop the column", not "and email login").
      const rest = words.slice(at + 1);
      if (!(rest.length >= 3 || (rest[0] && DETERMINER.test(rest[0].toLowerCase())))) continue;
      out.push(words.slice(from, i).join(' '));
      from = at;
    }
    if (words.length) out.push(words.slice(from).join(' '));
  }
  return out.map((c) => c.replace(/,$/, '').trim()).filter(Boolean);
}

const PEOPLE = /^(?:team|teams|staff|people|engineers?|developers?|devs?|hires?|joiners?|starters?|everyone|users?|customers?|agents?|interns?|managers?|analysts?|designers?|colleagues?|employees?|contractors?|newcomers?|folks|squad|sales|support|marketing|finance|legal|hr|ops)$/;
const ARTICLE = /^(?:the|a|an|our|all|every|each|this|that|these|those|some|any|my|your|their|its|both|another)$/;
// Before an article almost any word is a verb ("Trigger the build", "Partition the table"); these are not.
const NOT_A_VERB =
  /^(?:why|when|where|what|how|who|which|whether|if|after|before|during|while|since|until|once|all|half|both|only|not|is|are|was|were|does|do|did|can|could|should|would|will|and|or|but|so|then|also|even|just|still|yet|for|in|on|at|to|from|with|by|of|as|per|via|into|onto|over|under|about|around|across|between|through|within|without|up|down|off|out|plus|minus|versus|vs|re|fwd|note|notes|reminder|fyi|new|old|next|last|first|final|main|top|key|one|two|three|team|customer|customers|user|users|admin|admins|staff|vendor|client|partner|people|everyone|nobody|someone)$/;
const VERB_SUFFIX = /^[a-z]{3,}(?:ize|ify)$|(?:al|ar|er|or|on|it|at|ic|iv|il|rd|th|im)ise$/;
const NOT_A_VERB_ISE = /^(?:franchise|treatise|expertise|mortise|premise|otherwise|likewise)$/;
/**
 * An instruction whose verb is in none of the classes: "Take notes ...", "Tokenize the saved cards". A verb-led
 * title does work unless its verb says otherwise, so it counts as adoption, flagged as assumed. Titles that lead
 * with a noun or a product name ("Terraform training session", "Leave policy update") are not instructions.
 */
function assumedVerb(w, i, strict) {
  const word = w[i];
  const next = w[i + 1];
  if (!word || !next || !/^[a-z][a-z-]*$/.test(word) || MODAL_AFTER.test(next)) return null;
  if (product(tokenOf(normalize(word)))) return null;
  const article = ARTICLE.test(next);
  const listed = COMMON_VERBS.has(word);
  const compound = NOUN_AFTER.test(next);
  const nouny = NOUNY_VERBS.has(word) && !compound && w.length - i >= 4 && w.slice(i + 2).some((x) => PREPOSITION.test(x));
  const shaped = VERB_SUFFIX.test(word) && !NOT_A_VERB_ISE.test(word) && !compound;
  const led = strict ? listed && article : listed || nouny || shaped || (article && !NOT_A_VERB.test(word));
  return led ? { verb: word, base: word, cls: 'adopt', len: i + 1, assumed: true } : null;
}

/**
 * The instruction a clause opens with: {verb, base, cls, len, assumed?} or null. An adverb or two may come first.
 * strict: only verbs we know, or a common verb followed by an article (for descriptions, where most sentences are
 * not instructions).
 */
function leadVerb(rawWords, { strict = false } = {}) {
  const w = rawWords.map((x) => x.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9'-]+$/g, ''));
  let i = 0;
  while (i < 2 && w[i] && ADVERB.test(w[i])) i++;
  if (!w[i]) return null;
  // A product whose name is also a verb leads a title: "Bootstrap 5 upgrade notes" (but "Bootstrap the cluster").
  if (product(tokenOf(normalize(rawWords.slice(i, i + 2).join(' ')).split(' ')[0] ?? ''))) return null;
  const base = baseVerb(w[i]);
  if (!base) return assumedVerb(w, i, strict);
  for (let n = 3; n >= 1; n--) {
    const phrase = [base, ...w.slice(i + 1, i + n)].join(' ');
    if (!VERB.has(phrase)) continue;
    // "Support can help customers", "Build pipeline for mobile": a noun, not an instruction.
    const after = w[i + n];
    if (n === 1 && after && (MODAL_AFTER.test(after) || (NOUNISH_VERB.has(base) && NOUN_AFTER.test(after)))) return null;
    let cls = VERB.get(phrase);
    let verb = phrase;
    let len = i + n;
    // "Start sending recordings", "Keep using Jenkins", "Stop sending SMS codes": the second verb says what.
    if (n === 1 && after && /ing$/.test(after) && /^(?:start|begin|continue|keep|try|consider|stop|avoid|quit)$/.test(base)) {
      const second = baseVerb(after);
      if (/^(?:stop|avoid|quit)$/.test(base)) cls = 'remove';
      else if (base === 'consider') cls = 'inquiry';
      else cls = second && VERB.has(second) ? VERB.get(second) : 'adopt';
      verb = `${base} ${after}`;
      len = i + 2;
    }
    return { verb, base, cls, len };
  }
  // "Start", "begin" and "continue" need something to start.
  if (/^(?:start|begin|continue)$/.test(base) && w[i + 1]) return { verb: base, base, cls: 'adopt', len: i + 1 };
  return assumedVerb(w, i, strict);
}

const PURPOSE_MARK = /^(?:so|because|since|when|whenever|if|after|before|while|until|unless|once|whereas|although|though)$/;
const INSTRUMENT_MARK = /^(?:with|using|via|through|in|on|into|onto|as|behind|at|by|across|within|inside|under|against|alongside|beside|per|between)$/;

/**
 * Reads one clause: its class and, for every normalised word, the zone it sits in.
 * @param {string} raw   the clause as written
 * @param {object} opts  first: the summary's first clause; described: a clause of the description; inherit: the
 *                       class a clause without an instruction of its own takes from the summary's first clause
 */
function readClause(raw, { first = false, described = false, inherit = null } = {}) {
  let text = raw;
  let desire = false;
  if (first) {
    while (LABEL.test(text)) text = text.replace(LABEL, '');
    if (STORY.test(text)) {
      text = text.replace(STORY, '');
      desire = true;
    }
  }
  if (described) text = text.replace(SUBORDINATE, '');
  let asked = false;
  for (let i = 0; i < 2 && ASK.test(text); i++) {
    text = text.replace(ASK, '');
    asked = true;
  }
  const arrow = /\s(?:->|→|=>)\s/.test(text);
  if (arrow) text = text.replace(/\s(?:->|→|=>)\s/g, ' to ');
  const rawWords = text.trim().split(/\s+/).filter(Boolean);
  const lead = leadVerb(rawWords, { strict: described });
  // Names written with a capital after the first word: tools and products the lexicon may not know.
  const names = new Set([...text.matchAll(/(?<=\S\s+)[A-Z][\w.+#-]*/g)].map((m) => m[0].toLowerCase().replace(/[^a-z0-9]+$/, '')));
  // "X wants Y", "X needs Y": what follows is asked for.
  const want = !lead && !described ? text.match(/^(.{2,40}?)\s+(?:wants?|needs?|would like)\s+(?:to\s+)?(.+)$/i) : null;
  const words = normalize(text).split(' ').filter(Boolean);
  const stems = words.map(tokenOf);
  const firstPrep = words.findIndex((w, i) => i > 0 && PREPOSITION.test(w));
  const headEnd = firstPrep < 0 ? words.length : firstPrep;
  const head = words.slice(0, headEnd).join(' ');

  let cls;
  let verb = null;
  let leadBase = null;
  if (lead) {
    cls = lead.cls;
    verb = lead.verb;
    leadBase = lead.base;
    // What the instruction is about: its object, up to the first preposition, and the noun that heads it.
    const objectRaw = rawWords.slice(lead.len).join(' ');
    const object = normalize(objectRaw.split(/\s(?:for|in|on|to|with|at|from|of|by|via|using|into|onto|across|behind|about|against|through)\s/i)[0] ?? '').split(' ').filter((w) => w && !DETERMINER.test(w));
    const headNoun = object[object.length - 1] ?? '';
    // "Pay the Webflow invoice" is money; "run payroll through Stripe" still says what it runs on.
    const through = words.some((x, k) => /^(?:through|via|using|with)$/.test(x) && (product(tokenOf(words[k + 1] ?? '')) || names.has(words[k + 1] ?? '')));
    if (ADMIN_NOUN.test(headNoun) && !COMMERCIAL.test(verb) && cls !== 'remove' && !through) cls = 'admin';
    // "Train new joiners on Terraform", "onboard the new hire": people, not systems.
    else if (/^(?:train|onboard|brief|induct)$/.test(lead.base) && object.some((w) => PEOPLE.test(w))) cls = 'admin';
    // "Renew the TLS certificate" keeps something alive; "renew the contract" takes it up again.
    else if (lead.base === 'renew' && /^(?:certificates?|certs?|domains?|tokens?|keys?|passwords?)$/.test(headNoun)) cls = 'maintain';
    // "Write a comparison of ...", "schedule a meeting about ...", "take notes ...": making a document is about a
    // thing. Routing questions or storing notes somewhere is not making one.
    else if (cls === 'adopt' && (AUTHORING.test(lead.base) || lead.assumed) && DOC_NOUN.test(headNoun)) cls = 'doc';
  } else if (want && !PROBLEM.test(want[1])) {
    cls = 'adopt';
    verb = 'want';
  } else if (described) {
    cls = 'context';
  } else if (arrow) {
    cls = 'move';
    verb = 'move';
  } else if (ADMIN_TITLE.test(head) || /\b(?:invoices?|bills?|headcount|budgets?|payroll|reimbursements?)\b/.test(words.join(' '))) {
    cls = 'admin';
  } else if (PROBLEM.test(text) || FINITE.test(text)) {
    cls = 'report';
  } else if (head.split(' ').some((w) => DOC_NOUN.test(w))) {
    cls = 'doc';
  } else if (/^new\s+\S/i.test(text.trim())) {
    // "New Mailgun domain for order confirmation emails": a title that says the thing is being created.
    cls = 'adopt';
    verb = 'new';
  } else if (inherit) {
    cls = inherit;
  } else if (rawWords.length > 1 && DETERMINER.test(rawWords[1].toLowerCase()) && /^[a-z]+$/i.test(rawWords[0]) && !/(?:s|ion|ment|ness|ity)$/i.test(rawWords[0])) {
    // An unknown first word followed by a determiner is an instruction we have no class for ("Celebrate the launch").
    cls = 'unknown';
    leadBase = rawWords[0].toLowerCase();
    verb = leadBase;
  } else {
    cls = 'title';
  }
  if (desire && ['title', 'unknown', 'report'].includes(cls)) {
    cls = 'adopt';
    verb = 'want';
  }
  if (asked && !lead && cls === 'title') cls = 'unknown';
  // An instruction in a description only counts as planned work when nothing marks it as how things are today.
  if (described && lead && BACKGROUND.test(text)) cls = 'context';

  // Zones: each word belongs to the phrase the last marker before it opened.
  const zones = [];
  const purposeAt = [];
  const breaks = new Set();
  let zone = 'object';
  let withoutAt = -9;
  const moving = cls === 'move' || cls === 'remove';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    const prev = words[i - 1] ?? '';
    // "without waiting for Legal": the phrase runs on to what is done without.
    const inWithout = zone === 'without' && i - withoutAt <= 2 && /^(?:for|on|to|from|of)$/.test(w);
    const was = zone;
    if (inWithout) {
      // keep the zone
    } else if ((w === 'of' && ABOUT_NOUN.test(prev)) || (/^(?:on|about|regarding|around|for|from)$/.test(w) && FEEDBACK_NOUN.test(prev))) {
      // "screenshots of the old navbar", "feedback on the trial": what follows is what it shows or concerns.
      zone = 'about';
    } else if (w === 'for') {
      if (!SUPPORT_NOUN.test(prev) && cls !== 'remove') zone = 'purpose';
      if (zone === 'purpose') purposeAt.push(i);
    } else if (w === 'about') {
      zone = 'purpose';
      purposeAt.push(i);
    } else if (w === 'to') {
      // "to save costs" states a purpose; "to queue the emails" does too, but "to main" and "to staging" are places.
      const infinitive = next && (PURPOSE_VERBS.has(next) || (ANY_VERB.has(next) && (!NOUNISH_VERB.has(next) || DETERMINER.test(words[i + 2] ?? ''))));
      if (next && CARRY_VERB.test(next)) zone = 'carry';
      else zone = infinitive ? 'purpose' : 'dest';
      if (zone === 'purpose') purposeAt.push(i);
    } else if (PURPOSE_MARK.test(w)) {
      zone = 'purpose';
      purposeAt.push(i);
    } else if (w === 'from') zone = 'source';
    else if ((w === 'off' && (moving || MOVING.test(prev))) || (w === 'away' && next === 'from') || (w === 'out' && next === 'of' && moving)) zone = 'away';
    else if ((w === 'instead' && next === 'of') || (w === 'rather' && next === 'than') || (w === 'in' && next === 'place' && words[i + 2] === 'of') || (w === 'other' && next === 'than')) zone = 'displaced';
    else if (w === 'without' || w === 'despite' || w === 'ignoring' || ((w === 'regardless' || w === 'irrespective') && next === 'of')) {
      zone = 'without';
      withoutAt = i;
    } else if (INSTRUMENT_MARK.test(w) && !(prev === 'instead' || prev === 'rather' || (w === 'in' && next === 'place'))) {
      // A purpose keeps its place ("for password reset emails in the billing service") unless a tool follows:
      // "with ...", or a name ("take notes for the sprint review in Google Docs").
      const after = words.slice(i + 1, i + 4).find((x) => !DETERMINER.test(x)) ?? '';
      const named = product(tokenOf(after)) || names.has(after) || after === 'spreadsheet';
      if ((zone !== 'purpose' && zone !== 'about') || /^(?:with|using|via|through)$/.test(w) || (named && /^(?:in|on|into|onto|at)$/.test(w))) zone = 'instrument';
      else breaks.add(i);
    }
    if (zone !== was) breaks.add(i);
    zones.push(zone);
  }
  // What the clause says it is for, one phrase per marker: "for the partner portal", "to save time".
  const purposes = purposeAt.map((at, k) => {
    let end = at + 1;
    while (end < words.length && zones[end] === 'purpose' && !breaks.has(end) && end !== purposeAt[k + 1]) end++;
    return words.slice(at, end).join(' ');
  });
  return { raw, text, cls, verb, leadBase, words, stems, zones, headEnd, described, purposes, names, assumed: Boolean(lead?.assumed) };
}

/** The marker that opened the phrase position i belongs to. */
function markOf(c, i) {
  let j = i;
  while (j > 0 && c.zones[j - 1] === c.zones[i]) j--;
  return c.words[j] ?? '';
}

/** The role a clause gives the word at position i. term: every word of the term being asked about. */
function roleAt(c, i, term = new Set()) {
  const zone = c.zones[i];
  const after = c.words[i + 1] ?? '';
  const after2 = c.words[i + 2] ?? '';
  const before = c.words.slice(Math.max(0, i - 3), i);
  // "Delete the old Datadog dashboards": a part of it, or a tidy-up.
  const part = PART_NOUN.test(after) || before.some((w) => CLEANUP.test(w));
  // "the Heroku invoice", "the REST API documentation": it belongs to something that is only money or writing.
  const docTool = product(c.stems[i])?.categories.includes('docs');
  // "the Stripe API key", "the Twilio auth token": a credential belongs to a product; handling it is not taking the
  // product up.
  const credential = Boolean(product(c.stems[i])) && c.stems.slice(i + 1, i + 4).some((s, k) => (s === 'secret' || s === 'authtoken') && !c.words.slice(i + 1, i + 1 + k).some((w) => PREPOSITION.test(w)));
  const owned = credential || ADMIN_NOUN.test(after) || ADMIN_NOUN.test(after2) || (!docTool && (DOC_NOUN.test(after) || (DOC_NOUN.test(after2) && !PREPOSITION.test(after))));
  const mark = markOf(c, i);
  const out = (kind, why) => ({ kind, why, verb: c.verb, cls: c.cls, zone, part, described: c.described, assumed: c.assumed && kind === 'adopted' });
  if (c.cls === 'admin') return out('admin');
  // Local cues hold in every clause that acts.
  const acting = !['inquiry', 'doc', 'report', 'context'].includes(c.cls);
  if (acting && zone === 'without') return out('without');
  if (acting && (zone === 'away' || zone === 'displaced')) return out('removed');
  // "Schedule the Jenkins shutdown": the noun after it says it is going away; "finish the Jenkins migration" only
  // says it is moving, not which way.
  if (acting && c.cls !== 'title' && zone !== 'purpose' && (ENDING_NOUN.test(after) || (ENDING_NOUN.test(after2) && !PREPOSITION.test(after)))) return out('removed');
  if (acting && (MOVING_NOUN.test(after) || (MOVING_NOUN.test(after2) && !PREPOSITION.test(after)))) return out('mention', 'moved');
  // "screenshots of the old Bootstrap navbar", "feedback on the Tableau trial": shown or discussed, not taken up.
  if (zone === 'about') return out('mention', 'document');
  // How a thing is done is done whatever the verb: "resize the instance manually" makes a manual change.
  if (acting && c.cls !== 'title' && (c.words[i - 1] === 'byhand' || c.words[i - 2] === 'byhand')) return out('adopted');
  // "a test that fails if PII shows up in logs", "alert on plaintext passwords": the words just before keep it out.
  if (acting && (zone === 'object' || zone === 'purpose') && KEEPS_OUT.test(c.words.slice(Math.max(0, i - 6), i).join(' '))) return out('enforced');
  const tool = zone === 'dest' || zone === 'carry' || (zone === 'instrument' && /^(?:with|using|via|through|in|into|onto|as|behind)$/.test(mark));
  // It describes the noun after it ("the Jenkins pipeline", "GitHub issues") rather than standing on its own.
  const modifies = Boolean(after) && !PREPOSITION.test(after) && !AFTERWORD.test(after);
  switch (c.cls) {
    case 'adopt':
      if (owned && !COMMERCIAL.test(c.verb ?? '')) return out('mention', 'owned');
      if (zone === 'purpose') return out('mention', 'purpose');
      if (zone === 'source') return SOURCE_VERB.test(c.leadBase ?? '') ? out('adopted') : c.zones.includes('dest') ? out('removed') : out('mention', 'source');
      // "Add retries to the Jenkins pipeline" changes a pipeline; "add the rotation to PagerDuty" uses PagerDuty.
      if (ADDS_TO.test(c.leadBase ?? '') && modifies && (zone === 'dest' || (zone === 'instrument' && /^(?:in|on|at|within|inside|across|under|per|between)$/.test(mark)))) return out('mention', 'place');
      // "Translate the Stripe error messages", "chase the New Relic account manager": work on something that is
      // already there and only carries the name. (Creating verbs differ: "create Datadog dashboards" uses Datadog.)
      if (zone === 'object' && modifies && !term.has(c.stems[i + 1]) && (c.assumed || OPERATES.test(c.leadBase ?? '')) && (product(c.stems[i]) || c.names.has(c.words[i])) && before.some((w) => /^(?:the|our|this|that|these|those|existing|current|old|legacy)$/.test(w))) return out('mention', 'owned');
      // "Give the Grafana instance a shared login": what receives is only changed; what is given is taken up.
      if (zone === 'object' && GIVES.test(c.leadBase ?? '') && c.words.slice(i + 1).some((x, j) => /^(?:a|an)$/.test(x) && c.zones[i + 1 + j] === 'object')) return out('mention', 'place');
      // "Sync GitHub issues into Jira": a product whose things are carried somewhere else is where they come from.
      if (zone === 'object' && TRANSFER.test(c.leadBase ?? '') && product(c.stems[i]) && c.zones.some((z, j) => j > i && (z === 'dest' || (z === 'instrument' && /^(?:into|onto)$/.test(markOf(c, j)))))) return out('mention', 'source');
      // "Export the Heroku config vars", "share the New Relic dashboard link": taking a copy of what a product
      // holds, or passing it on, reads from it.
      if (zone === 'object' && EXTRACTS.test(c.leadBase ?? '') && modifies && (product(c.stems[i]) || c.names.has(c.words[i]))) return out('mention', 'source');
      // "Add Heroku to the list of deprecated platforms": the name itself is written down, not taken up.
      if (zone === 'object' && !modifies && ADDS_TO.test(c.leadBase ?? '') && c.words.some((x, j) => c.zones[j] === 'dest' && LIST_NOUN.test(x) && j - c.zones.indexOf('dest') <= 3)) return out('mention', 'document');
      return out('adopted');
    case 'transform':
      // What is rebuilt goes away only when the clause says what it becomes.
      if (zone === 'object') return !owned && c.zones.some((z) => z === 'instrument' || z === 'dest') ? out('removed') : out('mention', 'maintained');
      if (zone === 'source') return out('removed');
      if (zone === 'purpose' || owned) return out('mention', zone === 'purpose' ? 'purpose' : 'owned');
      return out('adopted');
    case 'move':
      if (zone === 'source') return out('removed');
      if (zone === 'purpose') return out('mention', 'purpose');
      if (owned) return out('mention', 'owned');
      if (zone === 'dest' || zone === 'carry' || (zone === 'instrument' && /^(?:with|using|via|through|into|onto)$/.test(mark))) return out('adopted');
      return out('mention', 'moved');
    case 'adjust':
      // "Upgrade the API image to Node.js 22" keeps what is there; "update the checkout to use Braintree" switches.
      return zone === 'carry' && !owned ? out('adopted') : out('mention', 'maintained');
    case 'remove':
      if (zone === 'object') return out('removed');
      // "Replace X with Y", "swap X for Y": Y is taken up.
      if (/^(?:replace|swap|substitute)$/.test(c.leadBase ?? '') && /^(?:with|by|for)$/.test(mark)) return out('adopted');
      return out('mention', 'place');
    case 'enforce':
      return zone === 'object' ? out('enforced') : out('mention', 'place');
    case 'maintain':
      // "Fix the checkout to use Braintree": a fix that says what it switches to.
      return zone === 'carry' && !owned ? out('adopted') : out('mention', 'maintained');
    case 'doc': {
      // "Write the retro notes in a Google Doc": the tool a document is written in is still taken up. Anything
      // else a document names is what it is about ("Docs: how we deploy to Heroku").
      const writtenIn = (product(c.stems[i])?.categories ?? []).some((k) => WRITING_TOOLS.has(k)) || c.stems[i] === 'spreadsheet';
      return tool && writtenIn && !owned && /^(?:with|using|via|in|into|onto|to)$/.test(mark) ? out('adopted') : out('mention', 'document');
    }
    case 'title':
      // A title leads with what it delivers, or says what it is built with ("... widget in Kotlin").
      return (i < c.headEnd || (zone === 'instrument' && /^(?:with|using|via|through|in|into|onto)$/.test(mark))) && !owned ? out('titled') : out('mention', zone === 'purpose' ? 'purpose' : 'named');
    case 'inquiry':
      return out('mention', 'inquiry');
    case 'report':
      return out('mention', 'report');
    case 'context':
      return out('mention', 'context');
    default:
      // An instruction we have no class for still says what it works with: "... with Stripe", "... using Kong".
      return zone === 'instrument' && /^(?:with|using|via|through)$/.test(mark) && !owned ? out('adopted') : out('mention', 'unknown');
  }
}

const WHY = {
  inquiry: 'only looks into it',
  document: 'only writes about it',
  report: 'reports on what is already there',
  maintained: 'maintains what is already there',
  purpose: 'names it only as a purpose',
  owned: 'concerns something that belongs to it',
  moved: 'moves it without taking it up',
  place: 'names it only as the place it changes',
  source: 'names it only as a source',
  named: 'only names it',
  context: 'names it only as background',
  unknown: "doesn't say it takes it up",
};
const META_CLASSES = ['inquiry', 'admin', 'doc', 'report', 'maintain'];

/**
 * Analyses a work item.
 * @param {{summary?: string, description?: string}} work
 * @returns {{intent: string, verb: string|null, role: (tokens: string[]) => object, purposes: string[], quiet: boolean}}
 *   intent: the class of the summary's first clause. role(tokens) says what the work does with a term, given the
 *   tokens it matched: {kind, verb, cls, why, where, part}. quiet: the work is about money or people.
 */
export function analyseWork(work) {
  let summary = String(work?.summary ?? '').trim();
  let taint = null;
  while (LABEL.test(summary)) summary = summary.replace(LABEL, '');
  const prefix = summary.match(PREFIX);
  if (prefix) {
    taint = PREFIX_CLASS[prefix[1].toLowerCase()] ?? null;
    summary = summary.slice(prefix[0].length);
  }
  if (QUESTION.test(summary) || VERSUS.test(summary)) taint = taint ?? 'inquiry';
  const clauses = [];
  splitClauses(summary).forEach((raw, i) => {
    const c = readClause(raw, { first: i === 0, inherit: i > 0 && META_CLASSES.includes(clauses[0]?.cls) ? clauses[0].cls : null });
    if (taint && c.cls !== 'admin') c.cls = taint;
    clauses.push(c);
  });
  const first = clauses[0] ?? { cls: 'title', verb: null };
  // The description supports the summary: its instructions count as planned work unless the summary itself only
  // looks into, fixes or reports something.
  const supports = !taint && !META_CLASSES.includes(first.cls);
  const described = supports ? splitClauses(String(work?.description ?? '').slice(0, 8000)).map((raw) => readClause(raw, { described: true })) : [];

  const collect = (list, anchors, term) => {
    const roles = [];
    for (const c of list) for (let i = 0; i < c.stems.length; i++) if (anchors.has(c.stems[i])) roles.push(roleAt(c, i, term));
    return roles;
  };
  const pick = (roles) => {
    if (!roles.length) return null;
    const of = (k) => roles.find((r) => r.kind === k);
    if (of('admin') && roles.every((r) => r.kind === 'admin')) return of('admin');
    // Moving from one thing to another of the same name ("from eu-west-1 to eu-central-1") leaves nothing behind.
    const arrives = roles.find((r) => r.kind === 'adopted' && r.cls === 'move');
    if (of('removed') && !arrives) return of('removed');
    return of('without') ?? of('enforced') ?? of('adopted') ?? of('titled') ?? roles.find((r) => r.kind === 'mention') ?? roles[0];
  };

  /** tokens: the distinctive words of a term that the work matched; all: every word of the term, when it has more. */
  function role(tokens, all = tokens) {
    const anchors = new Set(tokens);
    const term = new Set(all);
    const inSummary = pick(collect(clauses, anchors, term));
    // Doing the very thing a term names ("Commit ... directly" for "direct commits") adopts it.
    const act = clauses.find((c) => c.leadBase && anchors.has(tokenOf(normalize(c.leadBase))) && ['unknown', 'move', 'transform', 'adopt'].includes(c.cls));
    if (act && (!inSummary || inSummary.kind === 'mention')) return { kind: 'adopted', verb: act.verb, cls: act.cls, where: 'summary', act: true };
    if (inSummary && inSummary.kind !== 'mention') return { ...inSummary, where: 'summary' };
    const inDescription = pick(collect(described, anchors, term));
    if (inDescription && inDescription.kind !== 'mention' && inDescription.kind !== 'titled') return { ...inDescription, where: 'description' };
    if (inSummary) return { ...inSummary, where: 'summary' };
    if (inDescription) return { ...inDescription, kind: 'mention', why: inDescription.why ?? 'context', where: 'description' };
    // Named only through something the work implies (a hotfix goes to production): the summary's class decides.
    if (first.cls === 'admin') return { kind: 'admin', verb: first.verb, cls: first.cls, where: 'summary' };
    if (first.cls === 'adopt' || first.cls === 'transform') return { kind: 'adopted', verb: first.verb, cls: first.cls, where: 'summary', implied: true };
    const why = { inquiry: 'inquiry', maintain: 'maintained', report: 'report', doc: 'document' }[first.cls] ?? 'unknown';
    return { kind: 'mention', why, verb: first.verb, cls: first.cls, where: 'summary', implied: true };
  }

  // What the work says it is for: "for password reset emails", "to dedupe images".
  const purposes = clauses.flatMap((c) => c.purposes);
  return { intent: first.cls, verb: first.verb, clauses, described, role, purposes, quiet: clauses.length > 0 && clauses.every((c) => c.cls === 'admin') };
}

/** Why a mention is only a mention, as the end of a sentence that starts "this work ...". */
export function mentionReason(role) {
  return WHY[role?.why] ?? WHY.unknown;
}
