// Reads a decision statement and works out what was chosen, what was ruled out and where it applies.
import { tokens, product, GENERIC } from './text.js';
// Example: "Use passkeys with a TOTP fallback instead of SMS one-time passcodes for 2FA"
//   -> chosen: ["passkeys with a TOTP fallback"], rejected: ["SMS one-time passcodes"], scope: ["2FA"]
// The statement is split into sentences and clauses ("We picked Lucide for icons; Font Awesome was rejected"), and
// each clause is read with an ordered list of deterministic patterns, so every result is explainable and testable.
// Under the grammar sits a safety net that works from the things a statement names rather than from its shape: any
// product or proper name the patterns left unassigned takes its polarity from the cue words in its own clause
// ("... never directly from S3", "We evaluated Stripe and decided against it").

// --- vocabulary ------------------------------------------------------------------------------------------------
const WE = String.raw`(?:we|i|the team|teams|all teams|everyone|engineering|you)`;
const AUX = String.raw`(?:will|shall|should|must|can|now|also|always|only|are going to|'re going to|are|'re|'ll|'ve|have|had|do|did|plan to|intend to)`;
const SUBJ = String.raw`(?:${WE}(?:'ll|'re|'ve|'d)?\s+(?:${AUX}\s+)*|let's\s+|let us\s+|it(?:'s|\s+is)\s+(?:ok|okay|fine|acceptable|allowed|permitted)\s+to\s+)`;
const DECIDED = String.raw`(?:${WE}(?:'ve|'d)?\s+(?:have\s+|had\s+)?(?:decided|agreed|chose|opted|elected|voted|resolved)\s+(?:to\s+|that\s+(?:${WE}(?:'ll|'re)?\s+(?:${AUX}\s+)*)?)?)`;
// Verbs that make a choice when a clause starts with them: "use X", "we'll stick with X", "allow X for Z".
const POSITIVE = String.raw`(?:use|using|adopt|adopting|standardi[sz]e\s+(?:on|to)|standardi[sz]ing\s+on|consolidate\s+(?:on|onto)|consolidating\s+on|(?:decided|agreed|settled?)\s+on|go\s+with|going\s+with|went\s+with|opt\s+for|opted\s+for|choose|chose|pick|picked|select|selected|prefer|keep|keeping|stay\s+(?:on|with)|staying\s+(?:on|with)|stick\s+(?:with|to)|sticking\s+with|continue\s+(?:to\s+use|using|with)|move\s+to|moving\s+to|switch\s+to|switching\s+to|migrate\s+to|migrating\s+to|build\s+on|rely\s+on|implement|ship|roll\s+out|self-host|self\s+host|host|allow|allowing|permit|permitting|enable|enabling|support|supporting|offer|offering|accept|accepting|add|adding|introduce|introducing|require|requiring|mandate|default\s+to|approve)`;
// A lead word followed by a modal is a noun ("Support can help customers ..."), not a choice.
const LEAD = new RegExp(String.raw`^(?:${DECIDED})?(?:${SUBJ})?(?:only\s+)?${POSITIVE}\s+(?!(?:can|could|will|would|should|must|may|might|is|are|was|were|has|have|had|team|teams|staff|agents?|engineers?)\b|\S+\s+(?:is|are|was|were|will|must|should|can|need|needs|get|gets|go|goes)\b)(?:only\s+)?`, 'i');

// Verbs a prohibition can name: "do not <verb> Y", "never <verb> Y".
const NEG_VERBS = String.raw`(?:use|using|allow|allowing|permit|support|supporting|send|sending|store|storing|log|logging|build|building|ship|shipping|deploy|deploying|add|adding|introduce|introducing|adopt|adopting|rely on|integrate|integrating|share|sharing|collect|collecting|offer|offering|enable|enabling|keep|keeping|run|running|expose|exposing|accept|accepting|read|reading|write|writing|copy|copying|replicate|replicating|move|moving|put|putting|place|call|calling|hard-?code|hard code|commit|committing|push|pushing|merge|merging|publish|publishing|release|releasing|upload|uploading|embed|embedding|install|installing|cache|caching|persist|persisting|retain|retaining|save|saving|track|tracking|record|recording|capture|capturing|request|requesting|ask for|asking for|print|printing|email|emailing|post|posting|paste|pasting|display|displaying|show|showing|return|returning|transmit|transmitting|forward|forwarding|sync|syncing|export|exporting|host|hosting|self-host|self-hosting|spin up|create|creating|provision|provisioning|launch|launching|schedule|scheduling|book|booking|depend on|depending on|query|querying|access|accessing|bypass|bypassing|skip|skipping|disable|disabling|turn off|go with|choose|pick|buy|buying|pay for|renew|renewing|train|training|mix|bring back|reintroduce|re-?enable|touch|get|getting|have|having|receive|receiving|give|giving|grant|granting|take|taking|do|doing|make|making)`;
// The verbs the original parser accepted after a bare "not" ("..., not using X"). Kept narrow on purpose.
const BARE_NOT_VERBS = String.raw`(?:use|using|allow|allowing|permit|support|supporting|send|sending|store|storing|log|logging|build|building|ship|shipping|deploy|deploying|add|adding|introduce|introducing|adopt|adopting|rely on|integrate|integrating|share|sharing|collect|collecting|offer|offering|enable|enabling|keep|keeping|run|running|expose|exposing|accept|accepting)`;
const NEGATION = String.raw`(?:do not|don't|dont|does not|doesn't|did not|will not|won't|must not|mustn't|should not|shouldn't|shall not|may not|cannot|can't|can not|never|no longer|let's not|let us not|stop|stopped|cease|avoid|(?:is|are|isn't|aren't)\s+(?:not\s+)?(?:allowed|permitted)\s+to|not\s+(?:allowed|permitted)\s+to|(?:am|are|is|'re|'m)\s+not(?=\s+\w+ing\b)|(?:aren't|isn't)(?=\s+\w+ing\b))`;
const NEGATED = new RegExp(String.raw`\b${NEGATION}\s`, 'i');
const NEG_RE = new RegExp(String.raw`\b${NEGATION}\s+(?:ever\s+|be\s+|directly\s+|manually\s+)?(${NEG_VERBS})(?:\s+(?:or|and|nor)\s+${NEG_VERBS})?\s+(.+)`, 'i');
const BARE_NOT_RE = new RegExp(String.raw`\bnot\s+(${BARE_NOT_VERBS})\s+(.+)`, 'i');
// "PII must not be stored or replicated outside the EU": the subject is what is ruled out.
const NEG_PASSIVE_RE = /^(.+?)\s+(?:must not|mustn't|must never|should not|shouldn't|should never|shall not|may not|cannot|can't|can not|will not|won't|will never|are not to|is not to|are never to|is never to)\s+(?:ever\s+)?be\s+([a-z-]+(?:ed|en|t))(?:\s+(?:or|and|nor)\s+[a-z-]+(?:ed|en|t))?(?:\s+(.+))?$/i;

const REJECTED_STATE = String.raw`(?:rejected|ruled out|dropped|banned|forbidden|prohibited|deprecated|retired|removed|discontinued|sunset(?:ted)?|phased out|decommissioned|disallowed|off[\s-]limits|off the table|out of scope|not allowed|not permitted|not supported|unsupported|not approved|not an option|no longer (?:used|allowed|supported|permitted|approved|in use|an option|accepted|welcome|valid|taken|needed|required)|not (?:accepted|welcome|valid)|not to be used|blocked|ripped out|torn out|pulled out|axed|scrapped|shelved|frozen|on hold|paused|going away|gone|out(?=\s*$))`;
const REJECT_PASSIVE_RE = new RegExp(
  String.raw`^(.+?)\s+(?:is|are|was|were|will be|has been|have been|gets?|got|is being|are being|has now been|have now been|is now|are now)\s+(?:now\s+|officially\s+|hereby\s+|being\s+)?${REJECTED_STATE}(.*)$`,
  'i',
);
const REPLACED_BY_RE = /^(.+?)\s+(?:is|are|was|were|will be|has been|have been|is being|are being|gets?)\s+replaced\s+(?:by|with)\s+(.+)$/i;
const REJECT_VERBS = String.raw`(?:ruled out|rule out|rejected|reject|dropped|drop|dropping|banned|ban|banning|deprecated|deprecate|deprecating|retired|retire|retiring|sunsetting|sunsetted|sunset|forbid|forbade|prohibit|prohibited|disallow|disallowed|discontinue|discontinued|discontinuing|phase out|phasing out|phased out|ditch|ditched|ditching|abandon|abandoned|abandoning|kill|killed|killing|get rid of|getting rid of|remove|removed|removing|decommission|decommissioned|decommissioning|eliminate|eliminated|turn off|turned off|switch off|stop supporting|stopped supporting|end support for|ending support for)`;
const REJECT_ACTIVE_RE = new RegExp(String.raw`^(?:${DECIDED})?(?:${SUBJ})?(?:officially\s+)?${REJECT_VERBS}\s+(?:support\s+for\s+|the\s+use\s+of\s+|use\s+of\s+|using\s+)?(.+)$`, 'i');

// Rules with a subject: "All internal calls must use mTLS", "Every PR needs two approvals", "Analysts get views".
const RULE_RE = new RegExp(
  String.raw`^((?:(?:all|every|each|any)\s+)?.+?)\s+(?:(?:must|should|shall|will|need to|needs to|have to|has to|are to|is to|can only|may only)\s+)?(?:only\s+|always\s+)?(?:be\s+)?` +
    String.raw`(uses?|used|requires?|required|needs?|follows?|go(?:es)? through|go(?:es)? in|go(?:es)? into|go(?:es)? to|go(?:es)? (?:behind|via|over|under|on)|go(?:es)? out (?:via|through|from|on)|sits? (?:on|in|under)|(?:(?:is|are|be|get|gets)\s+)?[a-z]+ed (?:through|via|using)|(?:is|are|get|gets)\s+[a-z]+ed with|lives? (?:in|on)|runs? on|stays? (?:with|on|in)|remains? (?:with|on|in)|happens? (?:on|in|at|over|through|via)|takes? place (?:on|in|at|over)|(?:(?:is|are|be|get|gets)\s+)?(?:written in|built (?:with|in|on)|tracked in|stored in|hosted (?:on|in)|kept for|retained for|deployed (?:on|to)|(?:sent|routed|delivered|handled|processed|served|managed|booked|bought|purchased|paid|ordered|filed|signed off|done|made) (?:through|via|by|with|on|in|using))|(?:be\s+)?(?:reviewed|approved|signed off|checked|vetted|audited|tested) by|sits? behind|be behind|supports?|targets?|adopts?|gets?|defaults? to|(?:are|is|be) limited to|(?:are|is|be) capped at|have an?|has an?|write|writes)\s+(.+)$`,
  'i',
);
// The subject of a rule must look like a noun phrase, not a clause that already says something.
const RULE_SUBJECT_BAD = /^(?:we|i|you|it|they|this|that|there|teams?|everyone|nobody|anyone|let's)\b|\b(?:is|are|was|were|will|must|should|not|never|no)\b|n't\b/i;
// "Store secrets in AWS Secrets Manager", "Display timestamps in the user's local time zone".
const VERB_OBJ_PREP_RE = /^(?:store|keep|put|host|run|deploy|manage|track|record|send|route|serve|handle|display|show|render|format|write|document|build|implement|process|schedule|publish|log|stream|forward|push)\s+(.+?)\s+(in|on|with|via|through|using|as|into|onto|to)\s+(.+)$/i;
// "Kafka is our event bus": the subject is the choice, the role says what for.
const COPULA_OUR_RE = /^(.+?)\s+(?:is|are|will be|remains?|stays?)\s+(?:now\s+)?our\s+(?!(?:only|top|main|biggest|first)\s+(?:priority|concern|goal)\b)(.+)$/i;
const COPULA_ROLE_RE = /^(.+?)\s+(?:is|are|will be|becomes?|remains?|stays?)\s+(?:now\s+)?(?:our|the)\s+(?:new\s+)?(?:[\w-]+\s+){0,3}?(?:default|standard|baseline|choice|go-to|preferred|approved|official|primary|recommended|way)\b(.*)$/i;
const COPULA_ADJ_RE = /^(.+?)\s+(?:is|are)\s+(?:now\s+)?(?:mandatory|required|compulsory|preferred|recommended|approved|allowed|permitted|ok|okay|fine|acceptable|encouraged|the default)\b(.*)$/i;
const USED_AS_RE = /^(.+?)\s+(?:will be|is|are|gets?|shall be|has been|have been)\s+(?:used|adopted|chosen|selected|picked|approved)\b(.*)$/i;
const COPULA_NP_RE = /^(.+?)\s+(?:is|are|will be|should be|must be|shall be|(?:has|have|needs?) to be)\s+(?!(?:not|no|never|being|going|still|done|live|ready|complete|completed|blocked|broken|out|off|under|in|on|at|to|for|by|with|from|currently|now|a|an|the|our|their|its|this|that|very|too|also|already|replaced|kept|retained|stored|held|deleted|limited|capped|\w+ed)\b)(.+)$/i;
const COMPARED_RE = /\s+(?:after|having)\s+(?:comparing|evaluating|considering|trialling|trialing|testing|looking at|reviewing|benchmarking)\s+(?:it\s+|them\s+)?(?:(?:with|against|to|alongside)\s+)?(.+)$/i;
const MIGRATE = String.raw`(?:migrat|mov|switch|shift|transition|port)(?:e|es|ed|ing)?`;
// The object between the verb and "from" is optional and tried last ("moving away from X", not object "away").
const MIGRATE_FROM_TO_RE = new RegExp(String.raw`\b${MIGRATE}\s+(?:(.+?)\s+)??(?:away\s+from|off(?:\s+of)?|from)\s+(.+?)\s+(?:to|onto|over to|into)\s+(.+)$`, 'i');
const MIGRATE_TO_FROM_RE = new RegExp(String.raw`\b${MIGRATE}\s+(?:(.+?)\s+)??(?:to|onto|over to)\s+(.+?)\s+(?:from|off(?:\s+of)?)\s+(.+)$`, 'i');
const MIGRATE_OFF_RE = new RegExp(String.raw`\b${MIGRATE}\s+(?:(.+?)\s+)??(?:away\s+from|off(?:\s+of)?)\s+(.+)$`, 'i');
const MOVE_TARGET_RE = new RegExp(String.raw`^(?:${SUBJ})?${MIGRATE}\s+(.+?)\s+(?:to|onto|over to)\s+(.+)$`, 'i');
const SCHEDULE = /^(?:the\s+)?(?:next\s+|following\s+)?(?:sprint|week|month|quarter|release|milestone|iteration|cycle|q[1-4]|h[12]|20\d\d|v?\d|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|later|backlog|january|february|march|april|may|june|july|august|september|october|november|december)\b/i;

// Words after a bare "over" that mean something else ("over HTTP", "over the weekend").
const OVER_GUARD = /^(?:the|a|an|time|budget|http|https|tcp|udp|ssh|tls|ssl|vpn|wi-?fi|[$€£]?\d)|\b(?:must|should|shall|need|needs|require|requires|will|can|may)\b/i;
const LANGUAGE = /^(?:go|golang|ruby|python|java|javascript|js|typescript|ts|php|perl|scala|kotlin|swift|rust|c\+\+|c#|elixir|clojure|haskell|erlang|dart|lua|cobol|coffeescript|objective-c|groovy)$/i;
const PRONOUN = /^(?:it|this|that|them|these|those|one|ones|any|anything|something|everything|either|both|so|there)$/i;
const VERBISH = /\b(?:is|are|was|were|be|been|will|would|should|must|can|could|ship|ships|go|goes|run|runs|need|needs|get|gets|has|have|had|use|uses|do|does|did|make|makes|move|moves|keep|keeps|send|sends|take|takes|stay|stays|follow|follows|live|lives)\b/i;
const FRAMING =
  /^(?:decision|decided|agreed|outcome|resolution|conclusion|final decision|tl;?dr|rule)\s*[:\-–—]\s*|^(?:agreed|decided)\s+(?:to|that)\s+|^(?:we|i|the team|everyone)(?:'ve)?\s+(?:have\s+|all\s+)?(?:decided|agreed|concluded)\s+that\s+|^(?:going forward|from now on|from now|for now|effective immediately|as of [^,]+|in future|from today),?\s+/i;
// "We will keep customer data in the EU region only": the place is the choice, the data is what it governs.
const KEEP_IN_RE = new RegExp(String.raw`^(?:${DECIDED})?(?:${SUBJ})?(?:keep|store|host|hold|house|process)\s+(.+?)\s+(?:in|on|inside|within)\s+(.+)$`, 'i');

// Clause boundaries that end a term. "for" starts a scope clause (captured separately).
const TERM_END =
  /\s*(?:[;:()]|\.\s|\.$|\s(?:because|since(?!\s+\d)|as(?=\s+(?:our|the|their|its|your|my|it|we|they|this|that|these|those|there)\b)|due to|so that|so|given|while|until|unless|except|which|where|when|whenever|if|after|before|but|and then|then|for now|going forward|from now on|by default|once|whereas|although|though|instead|regardless)\b)/i;
const LIST_STOP = /^(?:because|since|so|which|while|but|then|and then|as|for|in|on|to|with|unless|except|including|e\.g|i\.e|we|it|this|that|use|using|not|no|never|when|where|if)\b/i;
const LIST_VERB = /\b(?:not|n't|never|use|using|is|are|was|were|will|must|should|do|does|did)\b/i;
const RATIONALE = /,?\s*\b(?:because|since(?!\s+\d)|due to|so that|given that|as(?=\s+(?:it|we|they|this|that|there|these|those)\b))\b\s*(.*)$/i;

const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const WHEN = String.raw`(?:(?:q[1-4]|h[12])(?:\s+20\d\d)?|(?:fy|cy)?20\d\d|${MONTH}(?:\s+\d{1,2}(?:st|nd|rd|th)?)?(?:\s*(?:to|-|–|until|through)\s*${MONTH}?\s*\d{0,2})?|\d{1,2}\s+${MONTH}|(?:next|this|the next|the current|end of|the end of)\s+(?:the\s+)?(?:quarter|sprint|release|year|month|week|cycle|half)|(?:v|version\s+)?\d+(?:\.\d+)+(?:\s+release)?|(?:next|upcoming|coming)\s+(?:release|major release|version))`;
// "by Q3", "in the 6.0 release", "from Dec 15 to Jan 5": when, not what or where.
const DEADLINE = new RegExp(String.raw`\s+(?:by|before|after|until|till|from|starting(?:\s+(?:in|from|on|with))?|as of|effective|no later than|in|at|for|during)\s+(?:the\s+)?(?:end\s+of\s+(?:the\s+)?)?${WHEN}(?![\w.]).*$`, 'i');
// "a postmortem within five working days": a time limit, not a scope.
const DURATION = /\s+(?:within|in under|in less than|inside of)\s+(?:\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fourteen|thirty|ninety)\s+(?:working\s+|business\s+|calendar\s+)?(?:minutes?|hours?|days?|weeks?|months?|sprints?)\b.*$/i;
// "no new microservices this year", "the monolith for now": when, not what.
const TIME_QUALIFIER = /\s+(?:(?:this|next|the coming|the next)\s+(?:year|quarter|sprint|month|half|week|release|cycle)|for now|from now on|from here on|from today|as of today|starting today|going forward|henceforth|for the time being|for the foreseeable future|until further notice|until (?:q[1-4]|h[12]|20\d\d|next \w+)|(?:at|on|upon|after|before)\s+(?:the\s+)?(?:next\s+)?(?:renewal|contract end|end of (?:the\s+)?contract|end of life|eol|expiry))\b.*$/i;
// "iOS 15 and below", "TLS 1.2 or higher": one term, not a list.
const RANGE_TAIL = /\s+(?:and|or)\s+(?:below|above|earlier|later|older|newer|higher|lower|up|down|greater|less|beyond)\b/gi;

const SCOPE_MARK = String.raw`(?:for|across|within|at(?!\s+(?:least|most|all|once|scale|rest|random|first|times|any)\b))`;
const LOOSE_MARK = String.raw`(?:for|across|within|anywhere in|everywhere in|throughout|inside|outside(?:\s+of)?|in|on|at|to|into)`;
// Chosen terms also take "in the X" / "in all X" as scope ("Inter in the product UI").
const CHOSEN_MARK = String.raw`(?:for|across|within|at(?!\s+(?:least|most|all|once|scale|rest|random|first|times|any)\b)|in(?=\s+(?:the|all|our|every|any|each|production|prod|staging)\b))`;

// --- term helpers ----------------------------------------------------------------------------------------------
/** Index of the first clause boundary in a term; a comma that continues a list ("a, b or c") is part of the term. */
function boundary(t) {
  let from = 0;
  for (;;) {
    const rest = t.slice(from);
    const end = rest.match(TERM_END);
    const comma = rest.indexOf(',');
    const endAt = end ? from + end.index : -1;
    if (comma < 0 || (endAt >= 0 && endAt < from + comma)) return endAt;
    const after = t.slice(from + comma + 1).trim();
    const segment = after.split(/[;:()]|\.\s|\.$/)[0];
    if (!LIST_STOP.test(after) && /\b(?:and|or|nor)\b/i.test(segment) && !LIST_VERB.test(segment)) {
      from += comma + 1;
      continue;
    }
    return from + comma;
  }
}

/** Trims a captured term at the first clause boundary and strips leading articles, prepositions and deadlines. */
function cleanTerm(raw) {
  let t = String(raw ?? '').trim();
  const at = boundary(t);
  if (at > 0) t = t.slice(0, at);
  t = t.replace(DEADLINE, '').replace(DURATION, '').replace(TIME_QUALIFIER, '');
  // "never directly from S3": the adverb and the preposition are not part of what is named.
  t = t.replace(/^(?:directly|straight|ever|simply|just)\s+(?=(?:in|on|at|with|from|to|into)\s)/i, '');
  // ("our own Postgres" keeps its "our own": it says whose, which is the point.)
  t = t.replace(/^(?:the|a|an|any|our|all|some|its|their)\s+(?!own\b)/i, '').replace(/^(?:in|on|at|with|from|to|into)\s+(?=\S)/i, '').replace(/^(?:the|a|an|any|our|all|some)\s+(?!own\b)/i, '');
  t = t.replace(/\s+(?:instead|too|as well|any ?more|either|altogether|entirely|completely|everywhere|anywhere|for good|only|exclusively|yes|ok|okay)$/i, '');
  return t.replace(/[.!?,;:]+$/, '').trim();
}

/**
 * Splits "X, Y and Z" or "X or Y" lists into separate terms. Phrases with a shared tail
 * ("recordings or transcripts to third-party providers") stay whole, since splitting loses meaning.
 */
function splitList(term) {
  if (/\s(?:to|into|with|from|by|via|through|of)\s/i.test(term)) return [term.trim()];
  const ranges = [];
  const masked = term.replace(RANGE_TAIL, (m) => `\u0000${ranges.push(m) - 1}\u0000`);
  return masked
    .split(/\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or|nor)\s+(?=[a-z0-9])/i)
    .map((x) => x.replace(/\u0000(\d+)\u0000/g, (_, i) => ranges[Number(i)]).trim())
    .filter((x) => x.length > 1 && !PRONOUN.test(x));
}

/** Pulls a trailing "for <scope>" clause out of a term. */
function splitScope(term, mark = SCOPE_MARK) {
  const m = term.match(new RegExp(String.raw`^(.*?)\s+${mark}\s+(.+)$`, 'i'));
  if (m && m[1].trim() && m[2].split(/\s+/).length <= 6) return { term: m[1].trim(), scope: m[2].replace(DEADLINE, '').replace(/[.,;:]+$/, '').trim() };
  return { term, scope: null };
}

const VERB_BASE = { stored: 'store', logged: 'log', sent: 'send', shared: 'share', collected: 'collect', kept: 'keep', exposed: 'expose', copied: 'copy', written: 'write', shown: 'show', hardcoded: 'hardcode', 'hard-coded': 'hardcode', cached: 'cache', saved: 'save', moved: 'move', used: 'use' };
const verbBase = (w) => VERB_BASE[w.toLowerCase()] ?? w.toLowerCase().replace(/ied$/, 'y').replace(/ed$/, '');
/** True when a phrase is a product name from the lexicon ("GCP", "Azure", "Amazon SQS"). */
const namesProduct = (phrase) => {
  const toks = tokens(phrase).filter((x) => !GENERIC.has(x));
  return toks.length > 0 && toks.length <= 2 && toks.some((x) => product(x));
};
const subjectOk = (s) => !RULE_SUBJECT_BAD.test(s) && s.split(/\s+/).length <= 8;
const looksLikeNounPhrase = (t) =>
  t.split(/\s+/).length <= 8 && !VERBISH.test(t) && !/\b(?:it|we|they|you|us|ourselves|themselves|i)\b|n't\b|'(?:s|re|ll|ve|d)\b/i.test(t) && !LEAD.test(`${t} `);

/**
 * The shape of a positive clause: what it chooses and what it says the choice applies to.
 * "Customer 2FA will use passkeys" -> {choice: "passkeys", scope: ["Customer 2FA"]}. structured=false means no known
 * shape matched and the text is returned as it was (minus any lead verb).
 */
function choiceShape(text) {
  let t = String(text ?? '').trim();
  let structured = false;
  const scope = [];
  const keep = t.replace(FRAMING, '').match(KEEP_IN_RE);
  if (keep) return { choice: keep[2], scope: [keep[1]], structured: true };
  for (let i = 0; i < 3; i++) {
    if (LEAD.test(`${t} `)) {
      t = `${t} `.replace(LEAD, '').trim();
      structured = true;
    } else if (FRAMING.test(t)) t = t.replace(FRAMING, '').trim();
    else break;
  }
  let m;
  // "Move feature flags to LaunchDarkly" chooses LaunchDarkly; "Move the rollout to sprint 9" only reschedules.
  if ((m = t.match(MOVE_TARGET_RE)) && !SCHEDULE.test(m[2])) {
    scope.push(m[1]);
    t = m[2];
    structured = true;
  } else if (!structured && (m = t.match(VERB_OBJ_PREP_RE))) {
    scope.push(m[1]);
    t = m[3];
    structured = true;
  } else if (!structured && !t.match(COPULA_ROLE_RE) && (m = t.match(COPULA_OUR_RE)) && subjectOk(m[1]) && m[1].split(/\s+/).length <= 4) {
    scope.push(m[2]);
    t = m[1];
    structured = true;
  } else if (!structured && ((m = t.match(COPULA_ROLE_RE)) || (m = t.match(COPULA_ADJ_RE)) || (m = t.match(USED_AS_RE)))) {
    const where = m[2]
      .replace(/^\s*as\s+(?:a|an|the|our)\s+[\w\s-]+?(?=\s+for\b|$)/i, '')
      .replace(DEADLINE, '')
      .match(/^\s*(?:for|across|within|in|on)\s+(.+)$/i);
    if (where) scope.push(where[1]);
    t = m[1];
    structured = true;
  } else if (!structured && (m = t.match(RULE_RE)) && subjectOk(m[1])) {
    scope.push(m[1]);
    t = m[3];
    structured = true;
  } else if (!structured && (m = t.match(/^(.+?)\s+is\s+where\s+(?:we\s+)?(.+?)\s+(?:live|lives|go|goes|happen|happens|get\s+\w+|gets\s+\w+|are\s+\w+|is\s+\w+|keep|write|track|store|run|do)\b.*$/i)) && subjectOk(m[1]) && m[1].split(/\s+/).length <= 4) {
    // "Notion is where specs live now": the place is the choice, what lives there is what it governs.
    scope.push(m[2].replace(/^(?:all|our|the)\s+/i, ''));
    t = m[1];
    structured = true;
  } else if (!structured && (m = t.match(/^(.+?)\s+is\s+(?:how|the way|what)\s+(?:we|you|teams|everyone|the team)\s+(?:all\s+|now\s+|will\s+)?(?:use\s+(?:for|to)|[a-z-]+)\s+(.+)$/i)) && subjectOk(m[1]) && m[1].split(/\s+/).length <= 4) {
    // "Terraform is how we manage infrastructure": the means is the choice, what is managed is what it governs.
    scope.push(m[2].replace(/^(?:all|our|the)\s+/i, ''));
    t = m[1];
    structured = true;
  } else if (!structured && (m = t.match(COPULA_NP_RE)) && subjectOk(m[1]) && m[1].split(/\s+/).length <= 6 && m[2].split(/\s+/).length <= 8 && !(namesProduct(m[1]) && !namesProduct(cleanTerm(m[2])))) {
    // ("Confluence is read-only" describes a product; it chooses nothing.)
    scope.push(m[1]);
    t = m[2];
    structured = true;
  }
  return { choice: t, scope, structured };
}

// --- parsing ---------------------------------------------------------------------------------------------------
// A second decision joined to the first by "and <verb>" or by a comma before a clause of its own.
const CLAUSE_JOIN = new RegExp(
  String.raw`,?\s+and\s+(?=(?:retire|drop|deprecate|remove|sunset|phase out|ban|stop using|decommission|kill|ditch|get rid of|turn off|disable)\b)` +
    String.raw`|,\s+(?=(?:(?:the|a|an|our)\s+)?[\w.-]+(?:\s+[\w.-]+){0,3}\s+(?:is|are|was|were|will be|has been|have been|is being|are being|gets?)\s+(?:now\s+|being\s+|officially\s+)*${REJECTED_STATE})` +
    String.raw`|,\s+(?=(?:do not|don't|never|no|avoid|stop using)\s)`,
  'i',
);

/** Sentences; a full stop after an abbreviation ("e.g.") does not end one. */
function splitSentences(text) {
  const out = [];
  // (A full stop after a word also ends a sentence when the next one starts in lower case, as notes often do.)
  for (const piece of text.split(/(?<=[.!?])\s+(?=["'(]?[A-Z0-9])|(?<=[a-z]{3}\.)\s+(?=[a-z])/)) {
    if (out.length && /\b(?:e\.g|i\.e|etc|vs|approx|incl|esp|cf|no|nos|inc|ltd|fig|min|max|est|dept|ref|sec|para|std|misc|temp|avg|qty|resp|orig|ver|rev|v\d+(?:\.\d+)*)\.$/i.test(out[out.length - 1])) out[out.length - 1] += ` ${piece}`;
    else out.push(piece);
  }
  return out;
}
/**
 * Parses a decision statement.
 * @returns {{chosen: string[], rejected: string[], scope: string[], rationale: string|null, negativeVerb: string|null}}
 */
export function parseStatement(statement) {
  const text = String(statement ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  const out = { chosen: [], rejected: [], scope: [], rationale: null, negativeVerb: null };
  if (!text) return out;

  // "Only senior engineers can approve database migrations": the party is the choice, the action is what it governs.
  const restriction = parseRestriction(text);
  if (restriction) {
    const why = text.match(RATIONALE);
    return { ...out, chosen: [restriction.who], scope: [restriction.what], rationale: why?.[1]?.replace(/[.]+$/, '').trim() || null, restriction };
  }

  // Sentences, then clauses; each clause loses its rationale ("because ..."), and the first rationale is kept.
  const clauses = [];
  for (const sentence of splitSentences(text)) {
    const s = sentence.replace(/[.!?]+$/, '').trim();
    if (!s || /^(?:this\s+)?supersed(?:es|ed|ing)\b|^replaces\s+[A-Z]{2,6}-\d/i.test(s)) continue;
    for (let part of s.split(/\s*;\s*|\s+[-–—]\s+/)) {
      const why = part.match(RATIONALE);
      if (why) {
        if (!out.rationale && why[1].trim()) out.rationale = why[1].replace(/[.]+$/, '').trim();
        part = part.slice(0, why.index).trim();
      }
      // "Use OneTrust for cookie consent and retire the home-grown banner" is two decisions, and so is
      // "standardise on GitHub Actions for CI, Jenkins is being retired".
      for (const c of part.split(CLAUSE_JOIN)) {
        if (c.trim() && !/^(?:this\s+)?supersed(?:es|ed|ing)\b/i.test(c.trim())) clauses.push(c.trim());
      }
    }
  }

  const results = clauses.map(parseClause);
  const collect = (r) => {
    out.chosen.push(...r.chosen.splice(0));
    out.rejected.push(...r.rejected.splice(0));
    out.scope.push(...r.scope.splice(0));
    if (!out.negativeVerb && r.negativeVerb) out.negativeVerb = r.negativeVerb;
  };
  results.forEach(collect);
  // The safety net: names the patterns left unassigned are read from their own cue words.
  assignEntities(out, results);
  // A clause that names no option is the choice when another clause rules something out
  // ("Trunk-based development with short-lived branches. GitFlow is retired."), or after a framing colon.
  const anyRejection = out.rejected.length > 0;
  for (const r of results) {
    // (A clause that only says whose decision it is, "mobile team decision", names nothing.)
    if (r.empty && !r.assigned && (r.bare || anyRejection) && looksLikeNounPhrase(r.text) && !/\b(?:decisions?|outcome|verdict|conclusion|resolution|agreement|update|summary|recap|minutes|notes?|sync|meeting|review|retro)\s*$/i.test(r.text)) {
      addChosenTerms(r, r.text, { loose: true });
      collect(r);
    }
  }
  return dedupe(out);
}

// --- restrictions ------------------------------------------------------------------------------------------------
const MAY = String.raw`(?:can|may|should|must|are allowed to|is allowed to|are permitted to|is permitted to|have permission to|has permission to|are able to|is able to|get to|gets to|are authori[sz]ed to|is authori[sz]ed to)`;
const ONLY_WHO_RE = new RegExp(String.raw`^only\s+(.+?)\s+${MAY}\s+([a-z-]+)\s+(.+)$`, 'i');
const ONLY_BY_RE = /^(.+?)\s+(?:can|may|must|should)\s+only\s+be\s+([a-z-]+?)(?:ed|d)\s+by\s+(.+)$/i;
/**
 * A rule about who may do something: "Only senior engineers can approve database migrations",
 * "Production deploys can only be approved by the release manager" -> {who, action, what}. Null for anything else.
 */
export function parseRestriction(statement) {
  let s = String(statement ?? '').replace(/\s+/g, ' ').trim();
  s = splitSentences(s)[0] ?? '';
  for (let i = 0; i < 3 && FRAMING.test(s); i++) s = s.replace(FRAMING, '').trim();
  const why = s.match(RATIONALE);
  if (why) s = s.slice(0, why.index);
  s = s.replace(/[.!?]+$/, '').trim();
  let m;
  if ((m = s.match(ONLY_WHO_RE)) && !/^(?:be|have|get|use|do)$/i.test(m[2])) return { who: cleanTerm(m[1]), action: m[2].toLowerCase(), what: cleanTerm(m[3]) };
  // The passive keeps the stem ("approv") for matching; "done" says how the statement worded it.
  if ((m = s.match(ONLY_BY_RE))) return { who: cleanTerm(m[3]), action: m[2].toLowerCase(), what: cleanTerm(m[1]), done: s.match(/only\s+be\s+([a-z-]+)\s+by/i)?.[1]?.toLowerCase() ?? null };
  return null;
}

// --- entities ------------------------------------------------------------------------------------------------------
// Capitalised words that name nothing in particular, and acronyms for kinds of things rather than things.
const NOT_A_NAME = new Set(
  ('I We Our The This That These Those All Any Every Each No Not Never Only Use Using Decision Decided Agreed Outcome Going From For Now New Team Teams Everyone Engineering It They ' +
    'Monday Tuesday Wednesday Thursday Friday Saturday Sunday Mondays Tuesdays Wednesdays Thursdays Fridays Saturdays Sundays ' +
    'January February March April May June July August September October November December Jan Feb Mar Apr Jun Jul Aug Sep Sept Oct Nov Dec ' +
    'API APIs UI UX PR PRs CI CD QA PII EU US UK SLA SLO SSO MFA HTTP HTTPS URL URLs ID IDs OK FAQ VP CEO CTO CFO COO HR IT PM DB SQL CSV PDF JSON XML HTML TLS SSL VPN DNS SDK SDKs CLI GDPR SOC PCI DPA RFC ADR KPI OKR Q1 Q2 Q3 Q4 H1 H2 TBD FYI ETA').split(' '),
);
const COMPARATOR = String.raw`(?:rather than|instead of|in place of|as opposed to|in preference to|over|not|versus|vs\.?)`;
// (Whole words: "ban" is not "banner", "scrap" is not "scrape", "drop" is not "dropdown".)
const NEG_CUE = String.raw`(?:no|not|never|\w+n't|against|off|avoid(?:s|ed|ing)?|drop(?:s|ped|ping)?|ditch(?:es|ed|ing)?|retir(?:e|es|ed|ing)|ban(?:s|ned|ning)?|deprecat(?:e|es|ed|ing)|sunset(?:s|ted|ting)?|reject(?:s|ed|ing)?|rul\w+ out|phas\w+ out|stop(?:s|ped|ping)?|scrap(?:s|ped|ping)?|veto(?:es|ed)?|declin(?:e|es|ed|ing)|shelv(?:e|es|ed|ing)|abandon(?:s|ed|ing)?|lost|loses?|is out|are out|away from|no longer|forbid(?:s|den|ding)?|forbade|prohibit(?:s|ed|ing)?|disallow(?:s|ed|ing)?|said no|passed on|turned down|done with|finished with|goodbye to|rid of|too \w+|clos(?:es|ed|ing)|shut(?:s|ting)? down|go(?:es|ing)? away|ends|ending|ended|expir(?:es|ed|ing)|frozen|froze|freez(?:e|es|ing)|paus(?:e|es|ed|ing)|on hold|rip(?:s|ped|ping)? out|torn out|pull(?:s|ed|ing)? out|axed|gone|wound down|wind(?:s|ing)? down)`;
const POS_CUE = String.raw`(?:use|uses|using|adopt\w*|stay\w* (?:with|on)|stays|remains|stick\w* (?:with|to)|keep\w*|standard\w*|default\w*|pick\w*|chose|chosen|choos\w*|select\w*|prefer\w*|mov\w+ to|switch\w* to|migrat\w+ to|go\w* with|going with|went with|approved?|won|wins|it is|is in|are in|yes|mandatory|required|recommended)`;
// Words that say options were weighed: what was weighed and not chosen lost.
const WEIGHED = /\b(?:evaluat\w*|looked at|looking at|compar\w*|consider\w*|trial\w*|tested|tried|review\w*|assess\w*|shortlist\w*|weigh\w*|bake-?off)\b/i;
// Tokens a product name may bring along ("GPT-4o" is OpenAI and an LLM).
const IMPLIED = new Set(['llm', 'featureflag', 'google', 'pushnotification']);
const AGAINST_PRONOUN = /\b(?:decided against|voted against|ruled out|rejected|dropped|passed on|said no to|turned down|vetoed|discarded|dismissed|declined|scrapped|shelved|abandoned)\s+(?:it|them|that|this|those|both)\b|\b(?:ruled|turned|voted)\s+(?:it|them|that|this)\s+(?:out|down)\b|\b(?:it|they|that|both)\s+(?:was|were|is|are|got|has been|have been)\s+(?:rejected|ruled out|dropped|vetoed|turned down|declined|out)\b|\bdecided not to (?:use|adopt|go with|pursue|buy) (?:it|them|that|either)\b/i;
const FOR_PRONOUN = /\b(?:went with|going with|go with|chose|picked|selected|approved|adopted|sticking with|staying with|kept|standardi[sz]ed on)\s+(?:it|them|that)\b/i;

/**
 * The things a clause names: lexicon products, capitalised proper names and quoted terms, each with its place in the
 * clause. Sentence-initial capitals only count with a capital or digit inside ("GraphQL", "S3").
 */
function entitiesIn(clause) {
  const out = [];
  const taken = [];
  const free = (a, b) => !taken.some(([x, y]) => a < y && b > x);
  const add = (surface, index) => {
    out.push({ surface, index, end: index + surface.length });
    taken.push([index, index + surface.length]);
  };
  for (const m of clause.matchAll(/"([^"]{2,40})"|'([^']{2,40})'(?!\w)/g)) add(m[1] ?? m[2], m.index + 1);
  // Products, longest names first ("New Relic", "GitHub Actions", then single words).
  const words = [...clause.matchAll(/[A-Za-z0-9][\w.+#/-]*/g)].map((m) => ({ w: m[0].replace(/[.,;:]+$/, ''), i: m.index }));
  const endOf = (k) => words[k].i + words[k].w.length;
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const start = words[i].i;
      const end = endOf(i + n - 1);
      if (!free(start, end)) continue;
      if (n > 1 && words.slice(i, i + n).some((x) => /^(?:and|or|nor|vs|versus|to|from|with|for|in|on|not|over|the|a|an)$/i.test(x.w))) continue;
      const surface = clause.slice(start, end);
      const toks = tokens(surface);
      if (!toks.some((t) => product(t) && !product(t).categories.includes('region')) || !toks.every((t) => product(t) || IMPLIED.has(t))) continue;
      // A longer name must need all of its words ("New Relic", not "Heroku app").
      const all = toks.join(' ');
      if (n > 1 && (tokens(clause.slice(words[i + 1].i, end)).join(' ') === all || tokens(clause.slice(start, endOf(i + n - 2))).join(' ') === all)) continue;
      // A capitalised word right after a product names one of its parts: "Redis Streams" is not all of Redis.
      let stop = end;
      for (let k = i + n; words[k] && /^[A-Z][a-z]/.test(words[k].w) && !NOT_A_NAME.has(words[k].w) && clause.slice(stop, words[k].i) === ' ' && !tokens(words[k].w).some((t) => product(t)); k++) stop = endOf(k);
      add(clause.slice(start, stop), start);
    }
  }
  // Proper names: runs of capitalised words that are not at the start of the clause's sentence.
  for (const m of clause.matchAll(/\b[A-Z][A-Za-z0-9]*(?:[.+#-][A-Za-z0-9]+)*(?:\s+[A-Z][A-Za-z0-9]+)*/g)) {
    const surface = m[0];
    const first = surface.split(/\s+/)[0];
    // At the start of a clause a capital proves nothing, unless the word has one inside ("GraphQL", "S3") or is the
    // subject of a state ("Zapier was considered and rejected").
    const subject = !/\s/.test(surface) && /^\s+(?:is|are|was|were|will be|gets?|got|has been|have been)\b/.test(clause.slice(m.index + surface.length));
    const initial = !/[a-z0-9,;:)]\s+$/.test(clause.slice(0, m.index)) && !/^(?:[A-Z]?[a-z]+[A-Z0-9]|[A-Z]+\d)/.test(first) && !subject;
    if (initial || !free(m.index, m.index + surface.length)) continue;
    if (surface.split(/\s+/).every((w) => NOT_A_NAME.has(w))) continue;
    add(surface, m.index);
  }
  return out.sort((a, b) => a.index - b.index);
}

/** The polarity the cue words of a clause give the entity at [index, end): 'chosen', 'rejected' or null. */
function polarityIn(clause, e, all) {
  // Other entities in a list with this one ("Azure or GCP") share its cue: look past them.
  const others = all.filter((x) => x !== e);
  const names = others.map((x) => x.surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') || '\\u0000';
  const before = clause
    .slice(0, e.index)
    .replace(new RegExp(String.raw`(?:(?:${names})\s*(?:,|and|or|nor|&|/)?\s*)+$`, 'i'), '')
    .trimEnd();
  const after = clause.slice(e.end);
  // "... rather than REST", "... over Bootstrap": what comes after a comparator lost; what comes before it won.
  const nearBefore = before.replace(/(?:\s+(?:the|a|an|our|any|directly|straight|ever|just|from|in|on|to|with|into|onto|using|use))+$/i, '');
  if (new RegExp(String.raw`\b${COMPARATOR}$`, 'i').test(nearBefore) && !/\b(?:not only|if not)$/i.test(nearBefore)) return 'rejected';
  if (new RegExp(String.raw`^\s*,?\s*${COMPARATOR}\s`, 'i').test(after) && !/^\s*,?\s*not\s+(?:only|just)\b/i.test(after)) return 'chosen';
  // Otherwise the nearest cue decides; one before the entity wins a tie, and a negated positive is a negative.
  const cues = [];
  for (const [kind, src] of [['rejected', NEG_CUE], ['chosen', POS_CUE]]) {
    for (const m of before.matchAll(new RegExp(String.raw`\b${src}(?=\W|$)`, 'gi'))) cues.push({ kind, gap: before.slice(m.index + m[0].length).trim().split(/\s+/).filter(Boolean).length, side: 0, at: m.index, text: m[0] });
    for (const m of after.matchAll(new RegExp(String.raw`(?<=^|\W)${src}(?=\W|$)`, 'gi'))) cues.push({ kind, gap: after.slice(0, m.index).trim().split(/\s+/).filter(Boolean).length + 0.5, side: 1, at: m.index, text: m[0] });
  }
  if (!cues.length) return null;
  cues.sort((a, b) => a.gap - b.gap || a.side - b.side);
  const best = cues[0];
  if (best.gap > 6) return null;
  // "not approved", "won't use", "never adopted": a negative next to the positive cue flips it.
  if (best.kind === 'chosen') {
    const around = best.side === 0 ? before.slice(Math.max(0, best.at - 14), best.at) : after.slice(Math.max(0, best.at - 14), best.at);
    if (/\b(?:not|never|no longer|n't|won't|cannot|can't)\s+(?:be\s+|to\s+)?$/i.test(around)) return 'rejected';
  }
  return best.kind;
}

/**
 * The safety net: entities the clause grammar left unassigned take a polarity from the cues in their own clause, and
 * a pronoun after "decided against" or "ruled out" refers to the entity just evaluated.
 */
function assignEntities(out, results) {
  const covered = () => new Set([...out.chosen, ...out.rejected, ...out.scope].flatMap((t) => tokens(t)));
  const isCovered = (e) => {
    const toks = tokens(e.surface).filter((t) => !GENERIC.has(t));
    const have = covered();
    return !toks.length || toks.some((t) => have.has(t));
  };
  const subjectFits = (s) => s && s.split(/\s+/).length <= 5 && !/^(?:we|i|they|it|you|the team|everyone|let's)\b/i.test(s) && subjectOk(s) && !entitiesIn(` ${s}`).length;
  let last = null;
  const weighed = [];
  for (const r of results) {
    const subs = String(r.text ?? '').split(/,\s+|\s+(?:and|but)\s+(?=(?:we|i|they|it|then|later|decided|ruled|rejected|dropped|passed|went|chose|picked|voted)\b)/i);
    for (const sub of subs) {
      if (!sub) continue;
      const ents = entitiesIn(sub);
      const pronoun = AGAINST_PRONOUN.test(sub) ? 'rejected' : FOR_PRONOUN.test(sub) ? 'chosen' : null;
      for (const e of ents) {
        if (!isCovered(e)) {
          const polarity = polarityIn(sub, e, ents);
          const before = sub.slice(0, e.index);
          if (polarity) r.assigned = true;
          if (polarity === 'rejected') {
            out.rejected.push(e.surface);
            // "Customer PII never goes into Google Sheets": what the rule is about comes before the negative.
            const subject = before.match(/^((?:[\w'-]+\s+){1,5}?)(?:(?:must|should|can|may|will|do|does)\s+)?(?:never|not|no longer|cannot|can't|mustn't|shouldn't|doesn't|don't|won't)\b/i)?.[1]?.trim();
            if (subjectFits(subject)) addScope(out, subject);
          } else if (polarity === 'chosen') {
            out.chosen.push(e.surface);
            // "Payments stay with Adyen": a short subject before the cue says what the choice is for, and so does
            // a "for ..." after the name ("approved Rust for the new ingest pipeline").
            const subject = before.match(/^((?:[\w-]+\s+){1,4}?)(?:should|must|will|shall|stays?|remains?|goes?|go|is|are|uses?)\b/i)?.[1]?.trim();
            if (subjectFits(subject)) addScope(out, subject);
            const use = sub.slice(e.end).match(/^\s+(?:for|across)\s+(.+)$/i);
            if (use && cleanTerm(use[1]).split(/\s+/).length <= 6) addScope(out, cleanTerm(use[1]));
          } else if (WEIGHED.test(sub)) weighed.push(e);
        }
        last = e;
      }
      // "We evaluated Stripe and decided against it": the pronoun is the entity just named.
      if (pronoun && last && !isCovered(last)) {
        (pronoun === 'rejected' ? out.rejected : out.chosen).push(last.surface);
        r.assigned = true;
      }
    }
  }
  // "We looked at Tableau and Looker. Going with Looker.": what was weighed and not chosen lost.
  if (out.chosen.length) for (const e of weighed) if (!isCovered(e)) out.rejected.push(e.surface);
}

/** Reads one clause. */
function parseClause(clause) {
  const r = { text: clause, chosen: [], rejected: [], scope: [], negativeVerb: null, empty: false, bare: false };
  let c = clause;
  for (let i = 0; i < 3 && FRAMING.test(c); i++) c = c.replace(FRAMING, '').trim();
  // "We're going native: Swift on iOS and Kotlin on Android": a short framing before a colon.
  const colon = c.match(/^([^:]{1,40}):\s+(.+)$/);
  if (colon && colon[1].split(/\s+/).length <= 5) {
    c = colon[2].trim();
    r.bare = true;
    // "Payments: Stripe": a short label names what the choice is for.
    const label = colon[1].trim();
    if (label.split(/\s+/).length <= 3 && subjectOk(label) && !/^(?:note|notes|update|summary|result|results|context|background|rationale|reminder|action|actions|todo|status|option|options|alternative|alternatives|proposal|why|reason|verdict|answer|short version|tl;?dr|fyi|ps|edit|agreed|done|per|as per|according to|from|by|via|re|cc|source|owner|author)\b/i.test(label) && !/\b(?:agreed|decided|said|says|thinks|wants|vote|voted|going)\b/i.test(label)) addScope(r, label);
  }
  // "For search we're sticking with Elasticsearch": a leading "for ..." says what the choice is for.
  const lead = c.match(/^for\s+([^,]{2,40}?),?\s+((?:we|i|the team|everyone|let's|use|go with|stick with)\b.+)$/i);
  if (lead && lead[1].split(/\s+/).length <= 5 && !DEADLINE.test(` for ${lead[1]}`)) {
    addScope(r, lead[1]);
    c = lead[2].trim();
  }
  r.text = c;
  if (!readClause(r, c)) r.empty = true;
  return r;
}

/** Applies the clause patterns, strongest first. Returns true when the clause said something. */
function readClause(r, c) {
  let m;
  // "Replace Y with X", "Swap Y for X", "Y is being replaced by X", "X replaces Y"
  if ((m = c.match(/\breplac(?:e|es|ing)\s+(.+?)\s+(?:with|by)\s+(.+)/i)) || (m = c.match(/^(?:swap|swapping)\s+(.+?)\s+(?:for|with)\s+(.+)/i))) {
    addRejectedTerms(r, m[1]);
    addChosenTerms(r, m[2]);
    return true;
  }
  if ((m = c.match(REPLACED_BY_RE))) {
    addRejectedTerms(r, m[1]);
    addChosenTerms(r, m[2]);
    return true;
  }
  if ((m = c.match(/^(.+?)\s+replaces\s+(.+)$/i)) && m[1].split(/\s+/).length <= 6) {
    addChosenTerms(r, m[1]);
    addRejectedTerms(r, m[2]);
    return true;
  }
  // "Migrate / move / switch [things] from Y to X", "Switching product search to X from Y", "Moving off Y"
  if ((m = c.match(MIGRATE_FROM_TO_RE))) {
    if (m[1]) addScope(r, m[1]);
    addRejectedTerms(r, m[2]);
    addChosenTerms(r, m[3]);
    return true;
  }
  if ((m = c.match(MIGRATE_TO_FROM_RE)) && !/\s(?:instead of|rather than)\s/i.test(c)) {
    if (m[1]) addScope(r, m[1]);
    addChosenTerms(r, m[2]);
    addRejectedTerms(r, m[3]);
    return true;
  }
  if ((m = c.match(MIGRATE_OFF_RE))) {
    if (m[1] && !/^(?:we|i|teams?|everyone)$/i.test(m[1].trim())) addScope(r, m[1]);
    addRejectedTerms(r, m[2]);
    return true;
  }
  // "Instead of Y, use X"
  if ((m = c.match(/^(?:instead of|rather than|in place of)\s+(.+?),\s*(.+)$/i))) {
    addRejectedTerms(r, m[1]);
    addChosenTerms(r, m[2]);
    return true;
  }
  // "X instead of / rather than / in place of Y"
  if ((m = c.match(/^(.+?)\s+(?:instead of|rather than|in place of)\s+(.+)$/i))) {
    addChosenTerms(r, m[1], { needShape: true });
    // The alternative may carry its own place: "instead of a hamburger menu in the mobile apps".
    addRejectedTerms(r, m[2], { loose: true });
    return true;
  }
  // "Deprecate Y in favour of X"
  if ((m = c.match(/^(.+?)\s+in favou?r of\s+(.+)$/i))) {
    const left = { ...r, chosen: [], rejected: [], scope: [] };
    if (readClause(left, m[1]) && left.rejected.length) {
      r.rejected.push(...left.rejected);
      r.scope.push(...left.scope);
    } else addRejectedTerms(r, m[1]);
    addChosenTerms(r, m[2]);
    return true;
  }
  // "Choose X over Y", and "Kafka over RabbitMQ for event streaming" with no verb
  if ((m = c.match(/\b(?:choose|chose|chosen|prefer|preferred|pick|picked|go with|went with|going with|select|selected|favou?r)\s+(.+?)\s+over\s+(.+)/i))) {
    addChosenTerms(r, m[1]);
    addRejectedTerms(r, m[2]);
    return true;
  }
  if ((m = c.match(/^(.+?)\s+over\s+(.+)$/i)) && m[1].split(/\s+/).length <= 6 && !OVER_GUARD.test(m[2]) && !/\b(?:is|are|was|were|will|must|should|not|never|no)\b/i.test(m[1]) && !NEGATED.test(c)) {
    if (addChosenTerms(r, m[1], { needShape: true })) {
      addRejectedTerms(r, m[2]);
      return true;
    }
  }
  // "Use Terraform, not Pulumi", "Stripe, not Adyen, for card payments", "Auth tokens go in httpOnly cookies, not localStorage"
  // ("Go was considered but not picked" names no second option: the safety net reads it from its cue.)
  if ((m = c.match(/^(.+?)(?:,\s*|\s+(?:and|but)\s+)(?:and\s+|but\s+)?not\s+(?!(?:allowed|permitted|supported|approved|recommended|required|picked|chosen|selected|adopted|used|pursued|needed|taken|ready|yet|now|any ?more|sure|possible|feasible|viable|an option|worth)\b)(.+)$/i)) && !NEGATED.test(`${m[1]} `)) {
    let right = m[2];
    const tail = right.match(/^(.+?),\s*((?:for|in|on|across|within)\s+.+)$/i);
    if (tail) right = tail[1];
    addChosenTerms(r, m[1], { needShape: true });
    addRejectedTerms(r, right);
    if (tail) addScope(r, tail[2].replace(/^(?:for|in|on|across|within)\s+/i, ''));
    return true;
  }
  // "PII must not be stored or replicated outside the EU"
  if ((m = c.match(NEG_PASSIVE_RE))) {
    r.negativeVerb = verbBase(m[2]);
    addRejectedTerms(r, m[1], { loose: true });
    if (m[3]) addScope(r, m[3].replace(/^(?:to|in|into|on|at|with)\s+/i, ''));
    return true;
  }
  // "Do not / never / no longer / stop / avoid <verb> Y"
  if ((m = c.match(NEG_RE)) || (m = c.match(BARE_NOT_RE))) {
    r.negativeVerb = m[1].toLowerCase();
    addRejectedTerms(r, m[2]);
    // An explicit alternative later in the clause: "Don't use Y, use X instead".
    const later = c.slice(m.index);
    const alt = later.match(/\b(?:use|adopt|go with)\s+(.+?)\s+instead\b/i) ?? later.match(/(?:[,.]|\s[-–—])\s*(?:instead,?\s*)?(?:use|adopt|go with|rely on)\s+(.+)/i);
    if (alt) addChosenTerms(r, alt[1]);
    // "Services must not read another service's database": the subject says where the rule applies.
    // ("After two outages we are not hosting ..." has no such subject: it opens with when or why, and ends in "we".)
    const before = c.slice(0, m.index).trim();
    const aside = /^(?:after|before|since|because|when|if|as|for|in|on|at|with|due|given|following|despite)\b|\b(?:we|i|they|you|it)$/i.test(before);
    if (before && !aside && before.split(/\s+/).length <= 5 && !RULE_SUBJECT_BAD.test(before) && !LEAD.test(`${before} `) && !/(?:\band|\bor|\bbut|,)$/i.test(before)) addScope(r, before);
    return true;
  }
  // "..., never directly from S3", "not through shared inboxes": the rest of a sentence, ruling one thing out.
  if ((m = c.match(/^(?:never|not|no longer)\s+(?:(?:directly|straight|ever|just|simply)\s+)?(?:from|in|on|to|via|through|with|into|onto)\s+(.+)$/i)) && looksLikeNounPhrase(cleanTerm(m[1]))) {
    addRejectedTerms(r, m[1]);
    return true;
  }
  // "..., never by hand", "not by email": a way of doing it, which keeps its "by" ("hand" alone is another word).
  if ((m = c.match(/^(?:never|not|no longer)\s+(by\s+\w+(?:\s+\w+)?)$/i))) {
    r.rejected.push(m[1].trim());
    return true;
  }
  // "ThinkPads only by exception approved by IT": allowed as an exception, so ruled out as the norm.
  if ((m = c.match(/^(.+?)\s+(?:(?:is|are)\s+(?:allowed\s+|permitted\s+)?)?only\s+(?:by|with|on|after|upon|under)\s+(?:(?:an?|explicit|prior|written|special)\s+)*(?:exception|approval|request|permission|sign-?off|waiver)\b/i)) && looksLikeNounPhrase(cleanTerm(m[1]))) {
    addRejectedTerms(r, m[1], { loose: true });
    return true;
  }
  // "Avoid Redux"
  if ((m = c.match(/^(?:we\s+(?:should\s+|will\s+|must\s+)?|please\s+)?avoid\s+(.+)$/i))) {
    addRejectedTerms(r, m[1], { loose: true });
    return true;
  }
  // "No Y", at the start or after a comma ("Ship on Tuesdays, no Friday submissions")
  if ((m = c.match(/(?:^|,\s*)no\s+(?!longer\b|one\b)(?:more\s+)?(.+)/i))) {
    const t = cleanTerm(m[1]);
    // "No new services in Ruby": a language after "in" is what is ruled out.
    const lang = t.match(/^(.+?)\s+(?:in|written in)\s+([\w+#-]+)$/i);
    const on = t.match(/^(.+?)\s+(?:on|in|with|using|via)\s+(.+)$/i);
    if (lang && LANGUAGE.test(lang[2])) {
      addRejectedTerms(r, lang[2]);
      addScope(r, lang[1]);
    } else if (on && tokens(on[1]).every((x) => GENERIC.has(x)) && splitList(on[2]).every(namesProduct)) {
      addRejectedTerms(r, on[2]);
      addScope(r, on[1]);
    } else addRejectedTerms(r, m[1], { loose: true });
    const before = c.slice(0, m.index);
    if (before.trim() && LEAD.test(before)) addChosenTerms(r, before);
    return true;
  }
  // "Y was rejected / is banned / will be phased out / is off the table"
  if ((m = c.match(REJECT_PASSIVE_RE)) && !/^(?:it|this|that|there)$/i.test(m[1].trim())) {
    addRejectedTerms(r, m[1], { loose: true });
    const rest = m[2].trim();
    const favour = rest.match(/\bin favou?r of\s+(.+)$/i);
    if (favour) addChosenTerms(r, favour[1]);
    else {
      const where = ` ${rest}`.replace(DEADLINE, '').trim().match(/^(?:for|in|on|across|within|from)\s+(.+)$/i);
      if (where) addScope(r, where[1]);
    }
    return true;
  }
  // "We ruled out Y", "Drop Y", "Deprecate the v1 API by Q3"
  if ((m = c.match(REJECT_ACTIVE_RE))) {
    addRejectedTerms(r, m[1]);
    return true;
  }
  // Positive: "Use / adopt / stick with / allow X for Z", "Redis is our default for caching", "All PRs need two approvals"
  const shape = choiceShape(c);
  if (shape.structured) {
    addChosenTerms(r, c);
    return r.chosen.length > 0 || r.scope.length > 0;
  }
  return false;
}

function addScope(r, raw) {
  const s = String(raw ?? '')
    .replace(DEADLINE, '')
    .replace(/[.,;:]+$/, '')
    .trim();
  if (!s || PRONOUN.test(s)) return;
  for (const x of splitList(s)) r.scope.push(x);
}

/** Adds what a positive phrase chose. With needShape, a phrase that is neither a known shape nor a noun phrase adds nothing. */
function addChosenTerms(r, raw, { loose = false, needShape = false } = {}) {
  let text = String(raw ?? '').trim();
  // "Going with Sentry after comparing it with Bugsnag and Rollbar": the others were ruled out.
  const compared = text.match(COMPARED_RE);
  if (compared) {
    addRejectedTerms(r, compared[1]);
    text = text.slice(0, compared.index);
  }
  const shape = choiceShape(text);
  if (needShape && !shape.structured && !looksLikeNounPhrase(cleanTerm(shape.choice))) return false;
  for (const s of shape.scope) addScope(r, s);
  const asRole = shape.choice.match(/^(.+?)\s+as\s+(?:our|the|their|its)\s+(.+)$/i);
  const cleaned = cleanTerm(shape.choice);
  if (loose) {
    for (const t of splitList(cleaned)) {
      const each = splitScope(t, LOOSE_MARK);
      if (each.scope) addScope(r, each.scope);
      r.chosen.push(each.term);
    }
    return true;
  }
  const { term, scope } = splitScope(cleaned, CHOSEN_MARK);
  if (scope) addScope(r, scope);
  else if (asRole && cleanTerm(asRole[1]) === cleaned) addScope(r, cleanTerm(asRole[2]));
  for (const t of splitList(term)) r.chosen.push(t);
  return true;
}

function addRejectedTerms(r, raw, { loose = false } = {}) {
  const cleaned = cleanTerm(raw);
  const asRole = String(raw ?? '').match(/^(.+?)\s+as\s+(?:our|the|their|its)\s+(.+?)(?:[,;.]|$)/i);
  const { term, scope } = splitScope(cleaned, loose ? LOOSE_MARK : SCOPE_MARK);
  if (scope) addScope(r, scope);
  else if (asRole && cleanTerm(asRole[1]) === cleaned) addScope(r, cleanTerm(asRole[2]));
  for (const t of splitList(term)) r.rejected.push(t);
}

function dedupe(out) {
  const uniq = (arr) => [...new Set(arr.map((x) => x.trim()).filter(Boolean))];
  out.chosen = uniq(out.chosen);
  out.rejected = uniq(out.rejected);
  out.scope = uniq(out.scope);
  return out;
}
