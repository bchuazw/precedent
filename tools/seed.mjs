// Seeds the Forge demo site with a coherent decision history and work items that collide with it.
// Idempotent: pages are matched by title per space, issues by summary in MOBL. Run: node tools/seed.mjs
import { randomUUID } from 'node:crypto';
import { atl } from './atl.mjs';

const U = {
  ryan: { id: '60ad37a4ad76ea0070d7fdf8', name: 'Ryan Lee' },
  ada: { id: '60ad31159e21bd0071e67bfa', name: 'Ada Isadora' },
  max: { id: '60ad3708411c2200684d57fd', name: 'Max Taylor' },
  emma: { id: '60ad34a79e21bd0071e6f4db', name: 'Emma Paris' },
  mitch: { id: '60ad2eb506bf0c006a432a17', name: 'Mitch Davis' },
  kevin: { id: '60ad35d906bf0c006a441102', name: 'Kevin Campbell' },
  alana: { id: '60ad2d2a06bf0c006a42fa84', name: 'Alana Grant' },
};

// ---- ADF builders -------------------------------------------------------------------------------------
const id = () => randomUUID();
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

/** A page in the shape of Confluence's "Decision documentation" template. */
function decisionDoc({ statusText = 'Complete', impact = 'High', driver, approver, contributors = [], informed = [], due, background, data, options, outcomeItem, outcomeText, actions = [] }) {
  return doc(
    table(
      row(hcell('Status'), cell(P(status(statusText, statusText === 'Complete' ? 'green' : 'yellow')))),
      row(hcell('Impact'), cell(P(status(impact, impact === 'High' ? 'red' : 'yellow')))),
      row(hcell('Driver'), cell(P(mention(driver)))),
      row(hcell('Approver'), cell(P(mention(approver)))),
      row(hcell('Contributors'), cell(P(...contributors.flatMap((u, i) => (i ? [', ', mention(u)] : [mention(u)])), ...(contributors.length ? [] : [' '])))),
      row(hcell('Informed'), cell(P(...informed.flatMap((u, i) => (i ? [', ', mention(u)] : [mention(u)])), ...(informed.length ? [] : [' '])))),
      row(hcell('Due date'), cell(P(date(due)))),
    ),
    H('Background'),
    ...background.map((b) => P(b)),
    H('Relevant data'),
    bullets(...data),
    H('Options considered'),
    table(
      row(hcell(' '), ...options.map((o) => hcell(o.name))),
      row(hcell('Description'), ...options.map((o) => cell(o.description))),
      row(hcell('Pros and cons'), ...options.map((o) => cell(...o.pros.map((x) => P(`+ ${x}`)), ...o.cons.map((x) => P(`− ${x}`))))),
      row(hcell('Estimated cost'), ...options.map((o) => cell(P(status(o.cost, o.cost === 'Large' ? 'red' : o.cost === 'Medium' ? 'yellow' : 'green'))))),
    ),
    H('Action items'),
    tasks(...(actions.length ? actions : ['Communicate the decision to affected teams'])),
    H('Outcome'),
    decisions(outcomeItem),
    ...(outcomeText ? [P(outcomeText)] : []),
  );
}

// ---- Content ------------------------------------------------------------------------------------------
const PAGES = [
  {
    space: 'MD',
    title: 'ADR-007: Second factor for customer sign-in',
    adf: decisionDoc({
      driver: U.ryan,
      approver: U.ada,
      contributors: [U.emma, U.mitch],
      informed: [U.alana],
      due: '2026-03-12',
      background: [
        'Account takeovers in the mobile app spiked last quarter. Every confirmed case started with a SIM swap: the attacker moved the victim’s number to a new SIM and received the SMS code.',
        'We need one second factor for customer sign-in and account recovery that we can support for the next three years.',
      ],
      data: ['14 confirmed account takeovers in Q4, all via SIM swap', '9% of active users already use an authenticator app', 'iOS 17+ and Android 14+ (91% of our users) support passkeys'],
      options: [
        { name: 'Passkeys with TOTP fallback', description: 'Passkeys by default; authenticator-app (TOTP) codes for devices without passkey support.', pros: ['Phishing-resistant', 'No per-message cost'], cons: ['Recovery flow needs design work'], cost: 'Medium' },
        { name: 'SMS one-time passcodes', description: 'Text a six-digit code at sign-in and recovery.', pros: ['Familiar to customers'], cons: ['Vulnerable to SIM swap', 'About $0.04 per message'], cost: 'Small' },
      ],
      outcomeItem: 'Use passkeys with a TOTP fallback instead of SMS one-time passcodes for 2FA, because SIM-swap attacks make SMS codes unsafe for account recovery.',
      outcomeText: 'SMS codes are retired for sign-in and recovery. Support can help customers who lose a device through the verified recovery flow.',
      actions: ['Ship passkey sign-in on iOS and Android', 'Design the lost-device recovery flow with Support'],
    }),
  },
  {
    space: 'MD',
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
    space: 'SECOPS',
    title: 'ADR-014: Generative AI and customer conversations',
    adf: decisionDoc({
      driver: U.kevin,
      approver: U.ada,
      contributors: [U.mitch],
      informed: [U.alana, U.emma],
      due: '2026-05-06',
      background: [
        'Teams want to summarise support calls and draft replies with large language models. Call transcripts routinely contain card details, health information and home addresses.',
        'Our data processing agreements with third-party model vendors do not cover this data.',
      ],
      data: ['31% of sampled transcripts contained a card number or CVV read aloud', 'Atlassian-hosted models (Rovo) run under our existing Atlassian DPA'],
      options: [
        { name: 'Atlassian-hosted models', description: 'Use Rovo and Atlassian-hosted models already covered by our Atlassian agreements.', pros: ['Covered by existing DPA', 'Respects Jira and Confluence permissions'], cons: ['Fewer model choices'], cost: 'Small' },
        { name: 'Third-party LLM APIs', description: 'Call OpenAI or other model vendors directly from our services.', pros: ['Most model choice'], cons: ['No DPA for transcript data', 'New vendor review per provider'], cost: 'Medium' },
      ],
      outcomeItem: 'Do not send customer call transcripts to third-party LLM providers; use Atlassian-hosted models approved by Security, because transcripts contain card and health details our vendor agreements do not cover.',
      actions: ['Publish the approved-models list', 'Add a transcript redaction step to the support pipeline'],
    }),
  },
  {
    space: 'SECOPS',
    title: 'ADR-016: Handling customer payment details',
    adf: decisionDoc({
      driver: U.ada,
      approver: U.mitch,
      contributors: [U.max],
      due: '2026-01-28',
      background: ['Checkout and reorder features keep asking to keep cards on file. Any system that stores a primary account number is in PCI DSS scope.'],
      data: ['PCI DSS scope today: the Stripe integration only', 'An in-scope service adds about 6 weeks of audit work a year'],
      options: [
        { name: 'Stripe tokenization', description: 'Keep cards in Stripe; store only the Stripe customer and payment-method tokens.', pros: ['Keeps us out of PCI scope'], cons: ['Tied to Stripe'], cost: 'Small' },
        { name: 'Store encrypted card numbers', description: 'Encrypt card numbers in our own database.', pros: ['Processor-independent'], cons: ['Puts the service and its database in PCI scope'], cost: 'Large' },
      ],
      outcomeItem: 'Never store card numbers in our systems; use Stripe tokenization, because storing them puts every touching service in PCI scope.',
    }),
  },
  {
    space: 'SECOPS',
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
    space: 'PDEV',
    title: 'ADR-003: Activity feed datastore',
    adf: decisionDoc({
      driver: U.max,
      approver: U.mitch,
      due: '2024-05-20',
      background: ['The activity feed schema changes weekly while the product team experiments.'],
      data: ['Feed writes: 2k/s peak', 'Schema changed 11 times last quarter'],
      options: [
        { name: 'MongoDB Atlas', description: 'Document store for the feed.', pros: ['Flexible schema'], cons: ['A second database to operate'], cost: 'Medium' },
        { name: 'Aurora PostgreSQL', description: 'Relational store with JSONB columns.', pros: ['One database to operate'], cons: ['Migrations for every change'], cost: 'Medium' },
      ],
      outcomeItem: 'Use MongoDB Atlas for the activity feed, because the feed schema is still changing every week.',
    }),
  },
  {
    space: 'PDEV',
    title: 'ADR-011: Datastore for new services',
    adf: decisionDoc({
      driver: U.max,
      approver: U.mitch,
      contributors: [U.ryan, U.kevin],
      due: '2026-02-03',
      background: [
        'We run two databases (Aurora PostgreSQL and MongoDB Atlas) with one on-call rotation. Three incidents last year came from MongoDB operational gaps, and new services need multi-row transactions.',
      ],
      data: ['3 Sev-2 incidents in 2025 traced to MongoDB failover', 'Every new service on the 2026 roadmap needs transactions'],
      options: [
        { name: 'Aurora PostgreSQL', description: 'One relational database for all new transactional services.', pros: ['Transactions', 'One on-call skill set'], cons: ['Migrating the activity feed later'], cost: 'Medium' },
        { name: 'MongoDB Atlas', description: 'Keep both databases and let teams choose.', pros: ['No migration'], cons: ['Two databases to operate'], cost: 'Medium' },
      ],
      outcomeItem: 'Use Aurora PostgreSQL instead of MongoDB for new transactional services, because we need multi-row transactions and one on-call skill set. Supersedes ADR-003.',
      outcomeText: 'The activity feed moves to Aurora PostgreSQL in H2.',
    }),
  },
  {
    // A proposal written months later by someone who wasn't in the ADR-007 discussion: the Confluence byline demo.
    space: 'MD',
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
  },
];

const DECISION_COMMENT = {
  issue: 'MOBL-1',
  text: 'Decision: Mobile releases ship on Tuesdays; no Friday App Store submissions, because nobody is on call to roll back over the weekend.',
};

const ISSUES = [
  { summary: 'Add SMS one-time passcode fallback for 2FA', parent: 'MOBL-2', type: 'Story', description: 'Some customers lose access to their authenticator app and call Support. Add an SMS one-time passcode fallback at sign-in so they can get back in without a ticket.' },
  { summary: 'Enable passkey sign-in on Android', parent: 'MOBL-2', type: 'Story', description: 'Bring passkey sign-in to Android 14+, matching iOS.' },
  { summary: 'Remove SMS codes from account recovery', parent: 'MOBL-2', type: 'Task', description: 'Account recovery still offers SMS codes for legacy accounts. Remove them and route users to the verified recovery flow.' },
  { summary: 'Summarise support call transcripts with GPT-4o', type: 'Story', description: 'Send each call transcript to the OpenAI API after the call ends and post a summary to the Jira ticket.' },
  { summary: 'Build an in-house feature toggle service for the mobile app', type: 'Story', description: 'A small service so mobile can flip features without a release.' },
  { summary: 'Store rewards activity events in MongoDB', type: 'Story', description: 'The new rewards service needs a store for activity events. MongoDB fits the shape of the events.' },
  { summary: 'Submit the iOS 5.2 hotfix to the App Store on Friday', parent: 'MOBL-1', type: 'Task', description: 'The crash fix is ready; submit it to the App Store this Friday so customers get it before Monday.' },
  { summary: "Save customers' card numbers for one-click reorder", type: 'Story', description: 'Let returning customers reorder in one tap by keeping their card on file.' },
  { summary: 'Log full request bodies for checkout debugging', type: 'Task', description: 'Checkout errors are hard to reproduce. Log the full request body, including email address and phone number, for 14 days.' },
];

// ---- Runner -------------------------------------------------------------------------------------------
async function ensureSpace(key, name) {
  const found = await atl('GET', `/wiki/api/v2/spaces?keys=${key}`);
  if (found.results?.[0]) return found.results[0].id;
  const created = await atl('POST', '/wiki/rest/api/space', { key, name, description: { plain: { value: 'Architecture decisions and runbooks for platform services.', representation: 'plain' } } });
  console.log(`created space ${key}`);
  const again = await atl('GET', `/wiki/api/v2/spaces?keys=${key}`);
  return again.results?.[0]?.id ?? created.id;
}

async function ensurePage(spaceId, title, adf) {
  const existing = await atl('GET', `/wiki/api/v2/spaces/${spaceId}/pages?title=${encodeURIComponent(title)}&limit=1`);
  if (existing.results?.[0]) {
    console.log(`  page exists: ${title}`);
    return existing.results[0].id;
  }
  const res = await atl('POST', '/wiki/api/v2/pages', { spaceId, status: 'current', title, body: { representation: 'atlas_doc_format', value: JSON.stringify(adf) } });
  console.log(`  created page: ${title} (${res.id})`);
  return res.id;
}

async function ensureIssue(it) {
  const jql = `project = MOBL AND summary ~ "\\"${it.summary.replace(/["']/g, '')}\\""`;
  const found = await atl('POST', '/rest/api/3/search/jql', { jql, maxResults: 5, fields: ['summary'] });
  const hit = found.issues?.find((i) => i.fields.summary === it.summary);
  if (hit) {
    console.log(`  issue exists: ${hit.key} ${it.summary}`);
    return hit.key;
  }
  const fields = {
    project: { key: 'MOBL' },
    summary: it.summary,
    issuetype: { name: it.type },
    description: doc(P(it.description)),
    ...(it.parent ? { parent: { key: it.parent } } : {}),
  };
  try {
    const res = await atl('POST', '/rest/api/3/issue', { fields });
    console.log(`  created ${res.key} ${it.summary}`);
    return res.key;
  } catch (e) {
    if (it.parent) {
      delete fields.parent;
      const res = await atl('POST', '/rest/api/3/issue', { fields });
      console.log(`  created ${res.key} ${it.summary} (without parent: ${e.message.slice(0, 80)})`);
      return res.key;
    }
    throw e;
  }
}

async function ensureDecisionComment({ issue, text }) {
  const data = await atl('GET', `/rest/api/3/issue/${issue}/comment?maxResults=100`);
  const exists = (data.comments ?? []).some((c) => JSON.stringify(c.body).includes(text.slice(0, 40)));
  if (exists) return console.log(`  decision comment exists on ${issue}`);
  await atl('POST', `/rest/api/3/issue/${issue}/comment`, { body: doc(P(text)) });
  console.log(`  added decision comment on ${issue}`);
}

const spaceIds = {
  MD: (await atl('GET', '/wiki/api/v2/spaces?keys=MD')).results[0].id,
  SECOPS: (await atl('GET', '/wiki/api/v2/spaces?keys=SECOPS')).results[0].id,
  PDEV: await ensureSpace('PDEV', 'Platform Development'),
};
console.log('Confluence pages');
for (const pg of PAGES) await ensurePage(spaceIds[pg.space], pg.title, pg.adf);
console.log('Jira decision comment');
await ensureDecisionComment(DECISION_COMMENT);
console.log('Jira work items');
for (const it of ISSUES) await ensureIssue(it);
console.log('done');
