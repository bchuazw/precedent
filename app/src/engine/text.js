// Text utilities for Precedent's deterministic matching: normalisation, concept synonyms,
// tokenising and light stemming. Pure functions, no Forge APIs, so they run in unit tests too.

// Multi-word phrases and abbreviations that should count as one concept. Each entry maps a regular
// expression (applied to lower-cased text) to a canonical token. Order matters: longer phrases first.
// Some concepts also imply a broader one (for example a named LLM vendor implies "llm").
const CONCEPTS = [
  [/\bone[\s-]?time[\s-]?pass(?:code|word)s?\b/g, ' otp '],
  [/\botps?\b/g, ' otp '],
  [/\b(?:sms|text)[\s-]?codes?\b/g, ' sms otp '],
  [/\b(?:verification|security|login|sign[\s-]?in|one[\s-]?time)[\s-]?codes?\b/g, ' otp '],
  [/\b(?:two|2)[\s-]?(?:factor|step)(?:[\s-]?auth(?:entication)?)?\b/g, ' mfa '],
  [/\bmulti[\s-]?factor(?:[\s-]?auth(?:entication)?)?\b/g, ' mfa '],
  [/\b(?:2fa|mfa|2sv)\b/g, ' mfa '],
  [/\btext[\s-]?messages?\b/g, ' sms '],
  [/\bpasskeys?\b/g, ' passkey '],
  [/\bwebauthn\b|\bfido2?\b/g, ' passkey '],
  [/\bauthenticator[\s-]?apps?\b|\btotp\b/g, ' totp '],
  [/\bpostgre(?:s|sql)\b|\bpg\b|\baurora[\s-]?postgres(?:ql)?\b/g, ' postgres '],
  [/\bmongo(?:db)?\b|\bdocumentdb\b/g, ' mongodb '],
  [/\bk8s\b/g, ' kubernetes '],
  [/\blarge[\s-]?language[\s-]?models?\b|\bllms?\b|\bgenai\b|\bgenerative ai\b/g, ' llm '],
  [/\b(?:open[\s-]?ai|chat[\s-]?gpt|gpt[\s-]?\d[\w.-]*|gpt)\b/g, ' openai llm '],
  [/\b(?:anthropic|claude)\b/g, ' anthropic llm '],
  [/\b(?:gemini|bard)\b/g, ' gemini llm '],
  [/\bfeature[\s-]?(?:flags?|toggles?|switches?)\b/g, ' featureflag '],
  [/\blaunch[\s-]?darkly\b/g, ' launchdarkly featureflag '],
  [/\breact[\s-]?native\b/g, ' reactnative '],
  [/\bpush[\s-]?notifications?\b/g, ' pushnotification '],
  [/\bpersonally[\s-]?identifiable[\s-]?information\b|\bpii\b|\bpersonal data\b/g, ' pii '],
  [/\b(?:e-?mail address(?:es)?|phone numbers?|dates? of birth|social security numbers?|ssns?|passport numbers?|home address(?:es)?)\b/g, ' pii $& '],
  [/\bfirebase[\s-]?cloud[\s-]?messaging\b|\bfcm\b/g, ' fcm pushnotification '],
  [/\b(?:credit[\s-]?)?card[\s-]?numbers?\b|\bprimary account numbers?\b/g, ' cardnumber '],
  [/\bcall[\s-]?recordings?\b/g, ' callrecording '],
  [/\btranscripts?\b/g, ' transcript '],
  [/\bthird[\s-]?part(?:y|ies)\b|\b3rd[\s-]?party\b|\bexternal vendors?\b/g, ' thirdparty '],
  [/\bin[\s-]?house\b|\bhome[\s-]?(?:grown|built|rolled)\b|\bbuild our own\b/g, ' inhouse '],
  [/\bon[\s-]?prem(?:ise|ises)?\b/g, ' onprem '],
  [/\bdata[\s-]?residency\b/g, ' dataresidency '],
  [/\bapp[\s-]?store\b/g, ' appstore '],
  [/\bci\/cd\b/g, ' cicd '],
];

// Words that carry little meaning for matching. Kept short on purpose: domain words stay in.
const STOP = new Set(
  ('a an and are as at be been but by can could do does for from had has have how i if in into is it its ' +
    'may might more most must no not of on or our out over per should so than that the their them then there ' +
    'these they this those to too up us was we were what when where which while who will with would you your ' +
    'all any also each every other such only own same just via etc eg ie new use using used uses make made ' +
    'add adding added team teams work need needs needed want wants able going get got let lets ' +
    'back keep still already every last next week weekend day days time times nobody anyone someone many ' +
    'much few lot lots one two three first second without within before after again ever like').split(' '),
);

// Common but weak words: they count a little in term matching, never on their own.
export const GENERIC = new Set(
  ('service services system systems data app apps application applications user users customer customers ' +
    'feature features platform platforms support process tool tools provider providers flow flows update ' +
    'updates option options approach solution solutions change changes implementation project api apis ' +
    'layer component components new existing current fallback default primary directly direct internal ' +
    'external own them it thing things way ways part parts our general overall build building').split(' '),
);

/** Lower-cases, strips accents and applies concept synonyms, returning a cleaned string. */
export function normalize(text) {
  let s = String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’“”]/g, "'");
  for (const [re, rep] of CONCEPTS) s = s.replace(re, rep);
  return s.replace(/[^a-z0-9+#]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Very light stemmer: enough to match plurals and simple verb forms. */
export function stem(word) {
  const w = word;
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (/(?:ss|us|is)$/.test(w)) return w;
  if (/(?:sses|shes|ches|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s')) return w.slice(0, -1);
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  return w;
}

/** Content tokens: normalised, stop words removed, stemmed. Keeps order (duplicates allowed). */
export function tokens(text) {
  return normalize(text)
    .split(' ')
    .filter((t) => t && !STOP.has(t) && !/^\d{1,2}$/.test(t))
    .map(stem);
}

/** Token set helper. */
export function tokenSet(text) {
  return new Set(tokens(text));
}

// Human labels for canonical concept tokens (used when explaining a match).
const DISPLAY = {
  mfa: '2FA',
  otp: 'one-time passcodes',
  sms: 'SMS',
  passkey: 'passkeys',
  totp: 'authenticator apps',
  postgres: 'PostgreSQL',
  mongodb: 'MongoDB',
  kubernetes: 'Kubernetes',
  llm: 'LLMs',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  featureflag: 'feature flags',
  launchdarkly: 'LaunchDarkly',
  reactnative: 'React Native',
  pushnotification: 'push notifications',
  fcm: 'Firebase Cloud Messaging',
  pii: 'personal data',
  cardnumber: 'card numbers',
  callrecording: 'call recordings',
  transcript: 'transcripts',
  thirdparty: 'third parties',
  inhouse: 'in-house builds',
  onprem: 'on-premises',
  dataresidency: 'data residency',
  appstore: 'App Store',
  cicd: 'CI/CD',
};

/** Readable label for a token. */
export function label(tok) {
  return DISPLAY[tok] ?? tok;
}

/** Weight of a token in term matching. */
export function weight(tok) {
  return GENERIC.has(tok) ? 0.3 : 1;
}

/** Splits text into sentences (rough, good enough for decision statements and issue descriptions). */
export function sentences(text) {
  return String(text ?? '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
