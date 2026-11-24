// Reads a decision statement and works out what was chosen and what was ruled out.
// Example: "Use passkeys with a TOTP fallback instead of SMS one-time passcodes for 2FA"
//   -> chosen: ["passkeys with a TOTP fallback"], rejected: ["SMS one-time passcodes"], scope: ["2FA"]
// Deterministic regular-expression patterns, so results are explainable and testable.

const LEAD_VERBS =
  /^(?:we(?:'ll| will| shall| should| must)?\s+|all new [\w\s-]+? (?:will |must |should )?|teams? (?:will |must |should )?)?(?:use|using|adopt|adopting|standardi[sz]e on|go with|went with|choose|chose|pick|picked|select|selected|keep|keeping|stay on|move to|build on|rely on|implement|ship|prefer)\s+/i;

// Clause boundaries that end a term. "for" starts a scope clause (captured separately).
const TERM_END = /\s*(?:[,;:()]|\.\s|\.$|\s(?:because|since|as|due to|so that|so|given|while|until|unless|except|which|where|when|after|before|but|and then|for now)\b)/i;

const NEGATIVE_VERB =
  '(?:use|using|allow|allowing|permit|support|supporting|send|sending|store|storing|log|logging|build|building|ship|shipping|deploy|deploying|add|adding|introduce|introducing|adopt|adopting|rely on|integrate|integrating|share|sharing|collect|collecting|offer|offering|enable|enabling|keep|keeping|run|running|expose|exposing|accept|accepting)';

/** Trims a captured term at the first clause boundary and strips leading articles. */
function cleanTerm(raw) {
  let t = String(raw ?? '').trim();
  const m = t.match(TERM_END);
  if (m && m.index > 0) t = t.slice(0, m.index);
  t = t.replace(/^(?:the|a|an|any|our|all)\s+/i, '').replace(/[.!?]+$/, '').trim();
  return t;
}

/**
 * Splits "X, Y and Z" or "X or Y" lists into separate terms. Phrases with a shared tail
 * ("recordings or transcripts to third-party providers") stay whole, since splitting loses meaning.
 */
function splitList(term) {
  if (/\s(?:to|into|with|from|by|via|through|of)\s/i.test(term)) return [term.trim()];
  return term
    .split(/\s*,\s*|\s+(?:and|or|nor)\s+(?=[a-z0-9])/i)
    .map((x) => x.trim())
    .filter((x) => x.length > 1);
}

/** Pulls a trailing "for <scope>" clause out of a term. */
function splitScope(term) {
  const m = term.match(/^(.*?)\s+(?:for|across|within)\s+(.+)$/i);
  if (m && m[1].split(/\s+/).length >= 1 && m[2].split(/\s+/).length <= 6) return { term: m[1].trim(), scope: m[2].trim() };
  return { term, scope: null };
}

/**
 * Parses a decision statement.
 * @returns {{chosen: string[], rejected: string[], scope: string[], rationale: string|null, negativeVerb: string|null}}
 */
export function parseStatement(statement) {
  const text = String(statement ?? '').replace(/\s+/g, ' ').trim();
  const out = { chosen: [], rejected: [], scope: [], rationale: null, negativeVerb: null };
  if (!text) return out;

  const because = text.match(/\b(?:because|since|due to|so that|as)\b\s+(.+)$/i);
  if (because) out.rationale = because[1].replace(/[.]+$/, '').trim();

  const addChosen = (raw) => {
    const { term, scope } = splitScope(cleanTerm(String(raw).replace(LEAD_VERBS, '')));
    if (scope) out.scope.push(scope);
    for (const t of splitList(term)) out.chosen.push(t);
  };
  const addRejected = (raw) => {
    const { term, scope } = splitScope(cleanTerm(raw));
    if (scope) out.scope.push(scope);
    for (const t of splitList(term)) out.rejected.push(t);
  };

  let m;
  // "Replace Y with X"
  if ((m = text.match(/\breplac(?:e|ing)\s+(.+?)\s+with\s+(.+)/i))) {
    addRejected(m[1]);
    addChosen(m[2]);
    return dedupe(out);
  }
  // "Migrate / move / switch from Y to X"
  if ((m = text.match(/\b(?:migrat|mov|switch)(?:e|ing|ed)?\s+(?:away\s+)?from\s+(.+?)\s+(?:to|onto)\s+(.+)/i))) {
    addRejected(m[1]);
    addChosen(m[2]);
    return dedupe(out);
  }
  // "X instead of / rather than / in place of Y"
  if ((m = text.match(/^(.+?)\s+(?:instead of|rather than|in place of)\s+(.+)$/i))) {
    addChosen(m[1]);
    addRejected(m[2]);
    return dedupe(out);
  }
  // "Choose X over Y"
  if ((m = text.match(/\b(?:choose|chose|prefer|preferred|pick|picked|go with|went with|select|selected|favou?r)\s+(.+?)\s+over\s+(.+)/i))) {
    addChosen(m[1]);
    addRejected(m[2]);
    return dedupe(out);
  }
  // "Do not / never / no longer / stop <verb> Y"
  const negRe = new RegExp(
    `\\b(?:do not|don't|dont|does not|doesn't|will not|won't|must not|mustn't|should not|shouldn't|never|no longer|stop|stopped|cease|avoid|not)\\s+(${NEGATIVE_VERB})\\s+(.+)`,
    'i',
  );
  if ((m = text.match(negRe))) {
    out.negativeVerb = m[1].toLowerCase();
    addRejected(m[2]);
    // An explicit alternative elsewhere in the sentence: "...; use X instead" or "Never store Y; use X."
    const alt = text.match(/\b(?:use|adopt|go with)\s+(.+?)\s+instead\b/i) ?? text.match(/(?:[;,.]|\s[-–—])\s*(?:instead,?\s*)?(?:use|adopt|go with|rely on)\s+(.+)/i);
    if (alt) addChosen(alt[1]);
    // A positive clause before the prohibition: "X go through Y; do not ..." is context, not a choice.
    return dedupe(out);
  }
  // "...; no Y" in the middle of a sentence ("Ship on Tuesdays; no Friday submissions")
  if ((m = text.match(/(?:[;,.]|\s[-–—])\s*no\s+(.+)/i))) {
    addRejected(m[1]);
    const before = text.slice(0, m.index);
    if (LEAD_VERBS.test(before)) addChosen(before);
    return dedupe(out);
  }
  // "Ban / reject / deprecate / sunset / forbid Y"
  if ((m = text.match(/\b(?:ban|banned|reject|rejected|deprecate|deprecated|sunset|forbid|forbidden|prohibit|prohibited|disallow|disallowed|retire|retired|drop|dropped)\s+(.+)/i))) {
    addRejected(m[1]);
    return dedupe(out);
  }
  // "Y is not allowed / is banned / is deprecated"
  if ((m = text.match(/^(.+?)\s+(?:is|are|will be|have been|has been)\s+(?:not allowed|not permitted|banned|forbidden|prohibited|deprecated|off[\s-]limits|not supported|out of scope|retired|removed|dropped|discontinued|sunset|phased out|no longer (?:used|allowed|supported))/i))) {
    addRejected(m[1]);
    return dedupe(out);
  }
  // "No Y" at the start
  if ((m = text.match(/^no\s+(.+)/i))) {
    addRejected(m[1]);
    return dedupe(out);
  }
  // Positive only: "Use / adopt / standardize on X"
  if (LEAD_VERBS.test(text)) {
    addChosen(text);
    return dedupe(out);
  }
  return dedupe(out);
}

function dedupe(out) {
  const uniq = (arr) => [...new Set(arr.map((x) => x.trim()).filter(Boolean))];
  out.chosen = uniq(out.chosen);
  out.rejected = uniq(out.rejected);
  out.scope = uniq(out.scope);
  return out;
}
