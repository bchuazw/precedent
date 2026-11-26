// Pins the demo verdicts: the decisions, RFC and work items that tools/seed.mjs creates on the demo site, built
// here as the same ADF, extracted and checked exactly as the app does. Run: node --test test/engine.test.mjs test/demo.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionsFromPage, decisionsFromComment, applySupersession } from '../src/engine/extract.js';
import { checkWork, buildIndex } from '../src/engine/match.js';
import { textOf } from '../src/engine/adf.js';

// --- ADF builders (as in tools/seed.mjs) ---------------------------------------------------------------------
let n = 0;
const id = () => `id-${++n}`;
const txt = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const bold = (text) => txt(text, [{ type: 'strong' }]);
const P = (...c) => ({ type: 'paragraph', content: c.map((x) => (typeof x === 'string' ? txt(x) : x)) });
const H = (text, level = 2) => ({ type: 'heading', attrs: { level }, content: [txt(text)] });
const mention = (u) => ({ type: 'mention', attrs: { id: u.id, text: `@${u.name}`, accessLevel: '' } });
const status = (text, color) => ({ type: 'status', attrs: { text, color, localId: id(), style: 'bold' } });
const date = (iso) => ({ type: 'date', attrs: { timestamp: String(Date.parse(`${iso}T00:00:00Z`)) } });
const cell = (...c) => ({ type: 'tableCell', attrs: {}, content: c.map((x) => (typeof x === 'string' ? P(x) : x)) });
const hcell = (...c) => ({ type: 'tableHeader', attrs: {}, content: c.map((x) => (typeof x === 'string' ? P(bold(x)) : x)) });
const row = (...cells) => ({ type: 'tableRow', content: cells });
const table = (...rows) => ({ type: 'table', attrs: { layout: 'default', localId: id() }, content: rows });
const decisions = (...items) => ({
  type: 'decisionList',
  attrs: { localId: id() },
  content: items.map((c) => ({ type: 'decisionItem', attrs: { localId: id(), state: 'DECIDED' }, content: (Array.isArray(c) ? c : [c]).map((x) => (typeof x === 'string' ? txt(x) : x)) })),
});
const tasks = (...items) => ({
  type: 'taskList',
  attrs: { localId: id() },
  content: items.map((c) => ({ type: 'taskItem', attrs: { localId: id(), state: 'TODO' }, content: (Array.isArray(c) ? c : [c]).map((x) => (typeof x === 'string' ? txt(x) : x)) })),
});
const bullets = (...items) => ({ type: 'bulletList', content: items.map((x) => ({ type: 'listItem', content: [typeof x === 'string' ? P(x) : x] })) });
const doc = (...content) => ({ type: 'doc', version: 1, content });
const U = Object.fromEntries(['ryan', 'ada', 'max', 'emma', 'mitch', 'kevin', 'alana'].map((k, i) => [k, { id: `acc-${i + 1}`, name: k }]));

function decisionDoc({ statusText = 'Complete', driver, approver, due, background, options, outcomeItem, outcomeText, actions = [] }) {
  return doc(
    table(
      row(hcell('Status'), cell(P(status(statusText, 'green')))),
      row(hcell('Impact'), cell(P(status('High', 'red')))),
      row(hcell('Driver'), cell(P(mention(driver)))),
      row(hcell('Approver'), cell(P(mention(approver)))),
      row(hcell('Due date'), cell(P(date(due)))),
    ),
    H('Background'),
    ...background.map((b) => P(b)),
    H('Options considered'),
    table(
      row(hcell(' '), ...options.map((o) => hcell(o.name))),
      row(hcell('Description'), ...options.map((o) => cell(o.description))),
      row(hcell('Pros and cons'), ...options.map((o) => cell(...o.pros.map((x) => P(`+ ${x}`)), ...o.cons.map((x) => P(`− ${x}`))))),
    ),
    H('Action items'),
    tasks(...(actions.length ? actions : ['Communicate the decision to affected teams'])),
    H('Outcome'),
    decisions(outcomeItem),
    ...(outcomeText ? [P(outcomeText)] : []),
  );
}

// --- the demo site's content (tools/seed.mjs) ------------------------------------------------------------------
const PAGES = [
  {
    id: 'p7',
    title: 'ADR-007: Second factor for customer sign-in',
    adf: decisionDoc({
      driver: U.ryan,
      approver: U.ada,
      due: '2026-03-12',
      background: [
        'Account takeovers in the mobile app spiked last quarter. Every confirmed case started with a SIM swap: the attacker moved the victim’s number to a new SIM and received the SMS code.',
        'We need one second factor for customer sign-in and account recovery that we can support for the next three years.',
      ],
      options: [
        { name: 'Passkeys with TOTP fallback', description: 'Passkeys by default; authenticator-app (TOTP) codes for devices without passkey support.', pros: ['Phishing-resistant', 'No per-message cost'], cons: ['Recovery flow needs design work'] },
        { name: 'SMS one-time passcodes', description: 'Text a six-digit code at sign-in and recovery.', pros: ['Familiar to customers'], cons: ['Vulnerable to SIM swap', 'About $0.04 per message'] },
      ],
      outcomeItem: 'Use passkeys with a TOTP fallback instead of SMS one-time passcodes for 2FA, because SIM-swap attacks make SMS codes unsafe for account recovery.',
      outcomeText: 'SMS codes are retired for sign-in and recovery. Support can help customers who lose a device through the verified recovery flow.',
      actions: ['Ship passkey sign-in on iOS and Android', 'Design the lost-device recovery flow with Support'],
    }),
  },
  {
    id: 'p8',
    title: '2026-04-14 Mobile weekly sync',
    adf: doc(
      P(bold('Attendees: '), mention(U.ryan), ', ', mention(U.emma), ', ', mention(U.mitch), ', ', mention(U.max)),
      H('Agenda'),
      bullets('Passkey rollout status', 'Feature flag tooling for the 5.x releases', 'Crash-free sessions after 5.1'),
      H('Notes'),
      bullets('Passkeys are live for 40% of iOS users; Android behind a flag.', 'Mitch compared LaunchDarkly with building our own toggle service. We already pay for LaunchDarkly seats and need audit history for SOC 2.', 'Crash-free sessions back to 99.6% after the 5.1.2 patch.'),
      H('Decisions'),
      decisions(['Use LaunchDarkly for feature flags instead of an in-house feature flag service, because we already pay for it and need audit history for SOC 2 (', mention(U.mitch), ').'], 'Move the Android passkey rollout to sprint 9.'),
      H('Action items'),
      tasks(['Migrate the remaining config toggles to LaunchDarkly ', mention(U.mitch)], ['Write the passkey recovery FAQ ', mention(U.emma)]),
    ),
  },
  {
    id: 'p14',
    title: 'ADR-014: Generative AI and customer conversations',
    adf: decisionDoc({
      driver: U.kevin,
      approver: U.ada,
      due: '2026-05-06',
      background: [
        'Teams want to summarise support calls and draft replies with large language models. Call transcripts routinely contain card details, health information and home addresses.',
        'Our data processing agreements with third-party model vendors do not cover this data.',
      ],
      options: [
        { name: 'Atlassian-hosted models', description: 'Use Rovo and Atlassian-hosted models already covered by our Atlassian agreements.', pros: ['Covered by existing DPA', 'Respects Jira and Confluence permissions'], cons: ['Fewer model choices'] },
        { name: 'Third-party LLM APIs', description: 'Call OpenAI or other model vendors directly from our services.', pros: ['Most model choice'], cons: ['No DPA for transcript data', 'New vendor review per provider'] },
      ],
      outcomeItem: 'Do not send customer call transcripts to third-party LLM providers; use Atlassian-hosted models approved by Security, because transcripts contain card and health details our vendor agreements do not cover.',
      actions: ['Publish the approved-models list', 'Add a transcript redaction step to the support pipeline'],
    }),
  },
  {
    id: 'p16',
    title: 'ADR-016: Handling customer payment details',
    adf: decisionDoc({
      driver: U.ada,
      approver: U.mitch,
      due: '2026-01-28',
      background: ['Checkout and reorder features keep asking to keep cards on file. Any system that stores a primary account number is in PCI DSS scope.'],
      options: [
        { name: 'Stripe tokenization', description: 'Keep cards in Stripe; store only the Stripe customer and payment-method tokens.', pros: ['Keeps us out of PCI scope'], cons: ['Tied to Stripe'] },
        { name: 'Store encrypted card numbers', description: 'Encrypt card numbers in our own database.', pros: ['Processor-independent'], cons: ['Puts the service and its database in PCI scope'] },
      ],
      outcomeItem: 'Never store card numbers in our systems; use Stripe tokenization, because storing them puts every touching service in PCI scope.',
    }),
  },
  {
    id: 'plog',
    title: 'Logging and observability standard',
    adf: doc(
      P('This standard applies to every service that ships logs to our observability vendor.'),
      H('Decisions'),
      decisions('Keep application logs for 30 days and never log PII, because logs are shipped to a third-party observability vendor.'),
      H('How to comply'),
      bullets('Use the shared logger; it redacts emails, phone numbers and card numbers.', 'Log request ids, not request bodies.'),
    ),
  },
  {
    id: 'p3',
    title: 'ADR-003: Activity feed datastore',
    adf: decisionDoc({
      driver: U.max,
      approver: U.mitch,
      due: '2024-05-20',
      background: ['The activity feed schema changes weekly while the product team experiments.'],
      options: [
        { name: 'MongoDB Atlas', description: 'Document store for the feed.', pros: ['Flexible schema'], cons: ['A second database to operate'] },
        { name: 'Aurora PostgreSQL', description: 'Relational store with JSONB columns.', pros: ['One database to operate'], cons: ['Migrations for every change'] },
      ],
      outcomeItem: 'Use MongoDB Atlas for the activity feed, because the feed schema is still changing every week.',
    }),
  },
  {
    id: 'p11',
    title: 'ADR-011: Datastore for new services',
    adf: decisionDoc({
      driver: U.max,
      approver: U.mitch,
      due: '2026-02-03',
      background: [
        'We run two databases (Aurora PostgreSQL and MongoDB Atlas) with one on-call rotation. Three incidents last year came from MongoDB operational gaps, and new services need multi-row transactions.',
      ],
      options: [
        { name: 'Aurora PostgreSQL', description: 'One relational database for all new transactional services.', pros: ['Transactions', 'One on-call skill set'], cons: ['Migrating the activity feed later'] },
        { name: 'MongoDB Atlas', description: 'Keep both databases and let teams choose.', pros: ['No migration'], cons: ['Two databases to operate'] },
      ],
      outcomeItem: 'Use Aurora PostgreSQL instead of MongoDB for new transactional services, because we need multi-row transactions and one on-call skill set. Supersedes ADR-003.',
      outcomeText: 'The activity feed moves to Aurora PostgreSQL in H2.',
    }),
  },
];

const RFC = {
  id: 'prfc',
  title: 'RFC: Self-service account recovery on mobile',
  adf: doc(
    P(bold('Author: '), mention(U.kevin), '   ', bold('Status: '), status('IN REVIEW', 'blue')),
    H('Problem'),
    P('About 1,400 support tickets a month come from customers who changed phones and can no longer sign in. Each one takes an agent around 12 minutes and the customer waits a day on average.'),
    H('Proposal'),
    bullets(
      'When sign-in fails three times, offer "Text me a code" and send an SMS one-time passcode to the phone number on file.',
      'After the code is verified, ask the customer to register a new passkey on the new phone.',
      'Roll the flow out behind a LaunchDarkly flag, 10% of Android users first.',
    ),
    H('Open questions'),
    bullets('Do we need a cool-down after a recovery before allowing payouts?', 'Which markets need a localized SMS sender id?'),
  ),
};

const COMMENT = {
  issueKey: 'MOBL-1',
  issueSummary: 'Mobile release train',
  issueUrl: 'https://demo.test/browse/MOBL-1',
  commentId: 'c1',
  authorId: U.max.id,
  created: '2026-04-02T10:00:00.000Z',
  adf: doc(P('Decision: Mobile releases ship on Tuesdays; no Friday App Store submissions, because nobody is on call to roll back over the weekend.')),
};

const ISSUES = {
  'MOBL-58': { summary: 'Add SMS one-time passcode fallback for 2FA', description: 'Some customers lose access to their authenticator app and call Support. Add an SMS one-time passcode fallback at sign-in so they can get back in without a ticket.' },
  'MOBL-59': { summary: 'Enable passkey sign-in on Android', description: 'Bring passkey sign-in to Android 14+, matching iOS.' },
  'MOBL-60': { summary: 'Remove SMS codes from account recovery', description: 'Account recovery still offers SMS codes for legacy accounts. Remove them and route users to the verified recovery flow.' },
  'MOBL-61': { summary: 'Summarise support call transcripts with GPT-4o', description: 'Send each call transcript to the OpenAI API after the call ends and post a summary to the Jira ticket.' },
  'MOBL-62': { summary: 'Build an in-house feature toggle service for the mobile app', description: 'A small service so mobile can flip features without a release.' },
  'MOBL-63': { summary: 'Store rewards activity events in MongoDB', description: 'The new rewards service needs a store for activity events. MongoDB fits the shape of the events.' },
  'MOBL-64': { summary: 'Submit the iOS 5.2 hotfix to the App Store on Friday', description: 'The crash fix is ready; submit it to the App Store this Friday so customers get it before Monday.' },
  'MOBL-65': { summary: "Save customers' card numbers for one-click reorder", description: 'Let returning customers reorder in one tap by keeping their card on file.' },
  'MOBL-66': { summary: 'Log full request bodies for checkout debugging', description: 'Checkout errors are hard to reproduce. Log the full request body, including email address and phone number, for 14 days.' },
  'MOBL-50': { summary: 'Conduct testing for two-factor authentication flow' },
};

// --- extraction, as sync.js indexes the site -----------------------------------------------------------------
const page = (p) => ({ ...p, url: `https://demo.test/wiki/${p.id}`, spaceKey: 'MD', createdAt: '2026-01-01' });
const all = applySupersession([...PAGES.flatMap((p) => decisionsFromPage(page(p))), ...decisionsFromComment(COMMENT)]);
const byTitle = (re) => all.find((d) => re.test(d.title) || re.test(d.source?.title ?? ''));
const KEY = {
  mfa: byTitle(/^ADR-007/).id,
  flags: all.find((d) => /LaunchDarkly/.test(d.statement)).id,
  ai: byTitle(/^ADR-014/).id,
  cards: byTitle(/^ADR-016/).id,
  logs: byTitle(/Logging and observability/).id,
  db: byTitle(/^ADR-011/).id,
  release: all.find((d) => d.kind === 'jira-comment').id,
};

const check = (key) => checkWork(ISSUES[key], all, { index: buildIndex(all) });
const relationTo = (result, decisionId) => result.findings.find((f) => f.decisionId === decisionId)?.relation ?? 'none';

test('the demo site extracts its decisions; ADR-003 is superseded by ADR-011', () => {
  assert.equal(all.find((d) => d.key === 'ADR-003').status, 'superseded');
  assert.equal(all.find((d) => d.key === 'ADR-003').supersededBy.key, 'ADR-011');
  assert.equal(decisionsFromPage(page(RFC)).length, 0);
  assert.deepEqual(all.find((d) => /sprint 9/.test(d.statement)).chosen, []);
});

const VERDICTS = [
  ['MOBL-58', 'mfa', 'conflict'],
  ['MOBL-59', 'mfa', 'aligned'],
  ['MOBL-60', 'mfa', 'aligned'],
  ['MOBL-61', 'ai', 'conflict'],
  ['MOBL-62', 'flags', 'conflict'],
  ['MOBL-63', 'db', 'conflict'],
  ['MOBL-64', 'release', 'conflict'],
  ['MOBL-65', 'cards', 'conflict'],
  ['MOBL-66', 'logs', 'conflict'],
  ['MOBL-50', 'mfa', 'related'],
];

for (const [key, decision, relation] of VERDICTS) {
  test(`${key} "${ISSUES[key].summary}" is ${relation} with its decision, and raises exactly ${relation === 'conflict' ? 'one conflict' : 'no conflict'}`, () => {
    const result = check(key);
    assert.equal(relationTo(result, KEY[decision]), relation);
    assert.equal(result.counts.conflict, relation === 'conflict' ? 1 : 0);
    assert.equal(result.findings[0].decisionId, KEY[decision], 'the demo decision is the first finding');
  });
}

test('the RFC page: conflicts with ADR-007 only; the logging rule is not broken by mentioning a phone number', () => {
  // As service.checkPage: the page body is the description, and weak topic overlaps are dropped.
  const work = { summary: RFC.title, description: textOf(RFC.adf).replace(/\s+/g, ' ').slice(0, 8000) };
  const result = checkWork(work, all, { index: buildIndex(all) });
  const findings = result.findings.filter((f) => f.relation !== 'related' || f.evidence?.[0]?.type !== 'topic-overlap' || (f.evidence[0].matched ?? []).length >= 3);
  const conflicts = findings.filter((f) => f.relation === 'conflict').map((f) => f.decisionId);
  assert.deepEqual(conflicts, [KEY.mfa]);
  assert.notEqual(relationTo({ findings }, KEY.logs), 'conflict');
});
