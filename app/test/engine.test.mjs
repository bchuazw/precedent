// Unit tests for Precedent's deterministic engine. Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatement } from '../src/engine/polarity.js';
import { decisionsFromPage, decisionsFromComment, applySupersession } from '../src/engine/extract.js';
import { checkWork, searchDecisions } from '../src/engine/match.js';

// --- helpers -------------------------------------------------------------------------------------------
const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...content) => ({ type: 'paragraph', content: content.map((c) => (typeof c === 'string' ? t(c) : c)) });
const h = (text) => ({ type: 'heading', attrs: { level: 2 }, content: [t(text)] });
const mention = (id, name) => ({ type: 'mention', attrs: { id, text: `@${name}` } });
const status = (text) => ({ type: 'status', attrs: { text, color: 'green' } });
const cell = (...content) => ({ type: 'tableCell', content: content.map((c) => (typeof c === 'string' ? p(c) : c)) });
const head = (text) => ({ type: 'tableHeader', content: [p(t(text, [{ type: 'strong' }]))] });
const row = (...cells) => ({ type: 'tableRow', content: cells });
const decisionList = (...items) => ({ type: 'decisionList', content: items.map((text, i) => ({ type: 'decisionItem', attrs: { state: 'DECIDED', localId: `d${i}` }, content: [t(text)] })) });

function itemDecision(id, statement, extra = {}) {
  const page = { id, title: extra.title ?? 'Notes', url: `https://example/wiki/${id}`, adf: { type: 'doc', content: [decisionList(statement)] } };
  return { ...decisionsFromPage(page)[0], ...extra };
}

// --- polarity ------------------------------------------------------------------------------------------
test('instead of: chosen, rejected and scope', () => {
  const r = parseStatement('Use passkeys with a TOTP fallback instead of SMS one-time passcodes for 2FA, because SIM-swap attacks make SMS codes unsafe.');
  assert.deepEqual(r.chosen, ['passkeys with a TOTP fallback']);
  assert.deepEqual(r.rejected, ['SMS one-time passcodes']);
  assert.deepEqual(r.scope, ['2FA']);
  assert.match(r.rationale, /SIM-swap/);
});

test('negative verb with an alternative after a semicolon', () => {
  const r = parseStatement('Never store card numbers in our systems; use Stripe tokenization.');
  assert.deepEqual(r.rejected, ['card numbers in our systems']);
  assert.deepEqual(r.chosen, ['Stripe tokenization']);
});

test('shared-tail phrase is not split', () => {
  const r = parseStatement('Do not send customer call recordings or transcripts to third-party LLM providers.');
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0], /transcripts to third-party LLM providers/);
});

test('mid-sentence "no"', () => {
  const r = parseStatement('Mobile releases ship on Tuesdays; no Friday App Store submissions.');
  assert.deepEqual(r.rejected, ['Friday App Store submissions']);
});

test('replace / migrate / over', () => {
  assert.deepEqual(parseStatement('Replace Jenkins with Bitbucket Pipelines').rejected, ['Jenkins']);
  assert.deepEqual(parseStatement('Migrate from MongoDB to Aurora PostgreSQL').chosen, ['Aurora PostgreSQL']);
  const o = parseStatement('We chose React Native over Flutter for the customer app');
  assert.deepEqual(o.chosen, ['React Native']);
  assert.deepEqual(o.rejected, ['Flutter']);
  assert.deepEqual(o.scope, ['the customer app']);
});

// --- extraction ----------------------------------------------------------------------------------------
test('decision-template page: options + outcome give chosen/rejected, owners from driver/approver', () => {
  const adf = {
    type: 'doc',
    content: [
      {
        type: 'bodiedExtension',
        attrs: { extensionKey: 'details' },
        content: [
          {
            type: 'table',
            content: [
              row(head('Status'), cell(p(status('Complete')))),
              row(head('Impact'), cell(p(status('High')))),
              row(head('Driver'), cell(p(mention('acc-1', 'Priya Raman')))),
              row(head('Approver'), cell(p(mention('acc-2', 'Marcus Lee')))),
              row(head('Due date'), cell(p({ type: 'date', attrs: { timestamp: String(Date.UTC(2026, 2, 12)) } }))),
            ],
          },
        ],
      },
      h('Background'),
      p('Customers lose accounts to SIM-swap fraud.'),
      h('Options considered'),
      {
        type: 'table',
        content: [
          row(head(''), head('Passkeys with TOTP fallback'), head('SMS one-time passcodes')),
          row(head('Description'), cell('Phishing-resistant'), cell('Familiar, but SIM-swap risk')),
        ],
      },
      h('Outcome'),
      p('We will use passkeys with a TOTP fallback for 2FA. SMS codes are retired.'),
    ],
  };
  const [d] = decisionsFromPage({ id: 101, title: 'ADR-007: Second factor for customer sign-in', url: 'u', adf });
  assert.equal(d.key, 'ADR-007');
  assert.equal(d.status, 'decided');
  assert.equal(d.decidedAt, '2026-03-12');
  assert.ok(d.chosen.some((c) => /passkeys/i.test(c)));
  assert.ok(d.rejected.some((r) => /SMS one-time passcodes/i.test(r)));
  assert.deepEqual(d.owners.map((o) => o.role), ['driver', 'approver']);
});

test('template pages are skipped; an unfilled status means proposed', () => {
  const adf = {
    type: 'doc',
    content: [
      { type: 'table', content: [row(head('Status'), cell(p(status('Not started'), ' / ', status('In progress'), ' / ', status('Complete')))), row(head('Driver'), cell(''))] },
      h('Outcome'),
      p(''),
    ],
  };
  assert.equal(decisionsFromPage({ id: 7, title: 'Template - Decision documentation', url: 'u', adf }).length, 0);
  const [d] = decisionsFromPage({ id: 8, title: 'Decision: logging vendor', url: 'u', adf });
  assert.equal(d.status, 'proposed');
});

test('DACI page: outcome in the details table picks "Option 3", names come from the description row', () => {
  const optHead = (n, extra) => ({ type: 'tableHeader', content: [p(t(`Option ${n} `, [{ type: 'strong' }]), ...(extra ? [extra] : []))] });
  const adf = {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          row(cell(p(t('Status', [{ type: 'strong' }]))), cell(p(status('decided')))),
          row(cell(p(t('Driver', [{ type: 'strong' }]))), cell(p(mention('a1', 'Alana Grant')))),
          row(cell(p(t('Outcome', [{ type: 'strong' }]))), cell(p('Option 3. Virtual Async'), p('Quick and effective'))),
        ],
      },
      h('Options considered'),
      {
        type: 'table',
        content: [
          row(head(' '), optHead(1), optHead(2), optHead(3, status('recommended'))),
          row(head('Description'), cell(p(t('Face To Face Enablement', [{ type: 'strong' }])), p('In person')), cell(p(t('Virtual Real Time', [{ type: 'strong' }]))), cell(p(t('Virtual Async', [{ type: 'strong' }])), p('Self paced'))),
        ],
      },
    ],
  };
  const [d] = decisionsFromPage({ id: 9, title: 'DACI: Enablement Experience Approach', url: 'u', adf });
  assert.equal(d.status, 'decided');
  assert.deepEqual(d.chosen, ['Virtual Async']);
  assert.deepEqual(d.rejected, ['Face To Face Enablement', 'Virtual Real Time']);
  assert.match(d.statement, /^Chose Virtual Async over Face To Face Enablement and Virtual Real Time/);
});

test('Jira "Decision:" comment', () => {
  const [d] = decisionsFromComment({
    issueKey: 'MOBL-12',
    issueSummary: 'Release train',
    issueUrl: 'u',
    commentId: 55,
    authorId: 'acc-3',
    created: '2026-04-02T10:00:00.000Z',
    adf: { type: 'doc', content: [p('Decision: Mobile releases ship on Tuesdays; no Friday App Store submissions.')] },
  });
  assert.equal(d.kind, 'jira-comment');
  assert.deepEqual(d.rejected, ['Friday App Store submissions']);
  assert.equal(d.decidedAt, '2026-04-02');
});

// --- matching ------------------------------------------------------------------------------------------
const decisions = applySupersession([
  itemDecision('mfa', 'Use passkeys with a TOTP fallback instead of SMS one-time passcodes for 2FA.', { key: 'ADR-007' }),
  itemDecision('db', 'Use Aurora PostgreSQL instead of MongoDB for new transactional services. Supersedes ADR-003.', { key: 'ADR-011' }),
  itemDecision('olddb', 'Use MongoDB Atlas for the activity feed.', { key: 'ADR-003', title: 'ADR-003 Activity feed store' }),
  itemDecision('ai', 'Do not send customer call transcripts to third-party LLM providers.', { key: 'ADR-014' }),
  itemDecision('flags', 'Use LaunchDarkly for feature flags instead of an in-house feature flag service.', { key: 'D-2001' }),
  itemDecision('release', 'Mobile releases ship on Tuesdays; no Friday App Store submissions.', { key: 'D-2002' }),
  itemDecision('cards', 'Never store card numbers in our systems; use Stripe tokenization.', { key: 'ADR-016' }),
  itemDecision('pii', 'Keep application logs for 30 days and never log PII.', { key: 'D-2003' }),
]);

const rel = (work) => Object.fromEntries(checkWork(work, decisions).findings.map((f) => [f.key, f.relation]));

test('superseded decision is marked', () => {
  const old = decisions.find((d) => d.key === 'ADR-003');
  assert.equal(old.status, 'superseded');
  assert.equal(old.supersededBy.key, 'ADR-011');
});

test('conflicts are caught', () => {
  assert.equal(rel({ summary: 'Add SMS OTP fallback for 2FA when users lose their authenticator' })['ADR-007'], 'conflict');
  assert.equal(rel({ summary: 'Store session events in MongoDB for the new rewards service' })['ADR-011'], 'conflict');
  assert.equal(rel({ summary: 'Summarise support call transcripts with OpenAI GPT-4o' })['ADR-014'], 'conflict');
  assert.equal(rel({ summary: 'Build our own feature toggle service for the mobile app' })['D-2001'], 'conflict');
  assert.equal(rel({ summary: 'Submit the iOS hotfix to the App Store on Friday' })['D-2002'], 'conflict');
  assert.equal(rel({ summary: "Save customers' card numbers for one-click reorder" })['ADR-016'], 'conflict');
  assert.equal(rel({ summary: 'Log full request bodies, including email address and phone number, for debugging' })['D-2003'], 'conflict');
});

test('removing a ruled-out thing is aligned, not a conflict', () => {
  assert.equal(rel({ summary: 'Remove SMS one-time passcodes from 2FA settings' })['ADR-007'], 'aligned');
  assert.equal(rel({ summary: 'Migrate the activity feed off MongoDB' })['ADR-011'], 'aligned');
});

test('choosing the decided option is aligned', () => {
  assert.equal(rel({ summary: 'Enable passkeys for 2FA on Android' })['ADR-007'], 'aligned');
  assert.equal(rel({ summary: 'Wrap mobile checkout behind a LaunchDarkly feature flag' })['D-2001'], 'aligned');
});

test('out-of-scope mention is not a conflict', () => {
  const r = rel({ summary: 'Send SMS delivery notifications when an order ships' });
  assert.notEqual(r['ADR-007'], 'conflict');
});

test('unrelated work is quiet', () => {
  const r = checkWork({ summary: 'Update the office wifi password poster' }, decisions);
  assert.equal(r.counts.conflict, 0);
  assert.equal(r.findings.length, 0);
});

test('search finds the right decision', () => {
  const [top] = searchDecisions('what did we decide about two-factor authentication?', decisions);
  assert.equal(top.decision.key, 'ADR-007');
  const [db] = searchDecisions('database for new services', decisions);
  assert.equal(db.decision.key, 'ADR-011');
});

// --- regressions found on the seeded demo site ------------------------------------------------------------
test('template doc: decision item decides; an option named in the outcome is not automatically chosen', () => {
  const adf = {
    type: 'doc',
    content: [
      { type: 'table', content: [row(head('Status'), cell(p(status('Complete')))), row(head('Driver'), cell(p(mention('r', 'Ryan Lee'))))] },
      h('Options considered'),
      { type: 'table', content: [row(head(''), head('Passkeys with TOTP fallback'), head('SMS one-time passcodes')), row(head('Description'), cell('a'), cell('b'))] },
      h('Outcome'),
      decisionList('Use passkeys with a TOTP fallback instead of SMS one-time passcodes for 2FA, because SIM-swap attacks make SMS codes unsafe.'),
      p('SMS codes are retired for sign-in and recovery.'),
    ],
  };
  const [d] = decisionsFromPage({ id: 11, title: 'ADR-007: Second factor', url: 'u', adf });
  assert.ok(!d.chosen.some((c) => /sms/i.test(c)), `chosen should not include SMS: ${d.chosen}`);
  assert.ok(d.rejected.some((r) => /sms/i.test(r)));
});

test('"SMS codes" means SMS one-time passcodes; removing them is aligned', () => {
  const r = checkWork({ summary: 'Remove SMS codes from account recovery' }, decisions);
  const f = r.findings.find((x) => x.key === 'ADR-007');
  assert.equal(f?.relation, 'aligned');
  assert.equal(f.evidence[0].type, 'removes-rejected');
});

test('in-scope topic without a stance is related', () => {
  assert.equal(rel({ summary: 'Conduct testing for two-factor authentication flow' })['ADR-007'], 'related');
});

test('weak shared words do not create related matches', () => {
  const r = rel({ summary: 'Customers who lose their phone call Support to get back in' });
  assert.equal(r['D-2002'], undefined);
});
test('owner tags in a decision item are not part of the statement, but the owner is kept', () => {
  const mention = { type: 'mention', attrs: { id: 'acc-1', text: '@Ada Isadora' } };
  const item = { type: 'decisionItem', attrs: { state: 'DECIDED', localId: 'x' }, content: [t('Keep application logs for 30 days and never log PII, because logs go to a third-party vendor ('), mention, t(').')] };
  const page = { id: 'p9', title: 'Logging standard', url: 'https://example/wiki/p9', adf: { type: 'doc', content: [{ type: 'decisionList', content: [item] }] } };
  const [d] = decisionsFromPage(page);
  assert.equal(d.statement, 'Keep application logs for 30 days and never log PII, because logs go to a third-party vendor.');
  assert.ok(!/@/.test(d.rationale ?? ''));
  assert.deepEqual(d.owners.map((o) => o.accountId), ['acc-1']);
});

test('a prohibition on an action ("never log PII") only conflicts with work that does that action', () => {
  const logging = itemDecision('lg', 'Keep application logs for 30 days and never log PII, because logs go to a third-party vendor.');
  assert.equal(logging.action, 'log');
  const rfc = checkWork({ summary: 'Self-service account recovery', description: 'Send a one-time code to the phone number on file when sign-in fails.' }, [logging]);
  assert.equal(rfc.counts.conflict, 0);
  const logs = checkWork({ summary: 'Log full request bodies for checkout debugging', description: 'Include email address and phone number.' }, [logging]);
  assert.equal(logs.counts.conflict, 1);
});

test('a decision recorded in a Jira comment never takes the key of the decision it supersedes or of a work item it mentions', () => {
  const adf = (text) => ({ type: 'doc', version: 1, content: [p(text)] });
  const [reversal] = decisionsFromComment({
    issueKey: 'MOBL-58', issueSummary: 'Add SMS one-time passcode fallback for 2FA', commentId: '9001', created: '2026-11-25T08:00:00Z',
    adf: adf('Decision: Use SMS one-time passcodes as a 2FA fallback for customers without a smartphone, because locked-out customers are flooding support. Supersedes ADR-007.'),
  });
  assert.notEqual(reversal.key, 'ADR-007');
  assert.match(reversal.key, /^D-\d{4}$/);
  assert.deepEqual(reversal.supersedes, ['ADR-007']);
  const [mentions] = decisionsFromComment({ issueKey: 'MOBL-1', issueSummary: 'Release train', commentId: '9002', created: '2026-11-25T08:00:00Z', adf: adf('Decision: Ship the MOBL-12 fix on Tuesdays only.') });
  assert.match(mentions.key, /^D-\d{4}$/);
  const [own] = decisionsFromComment({ issueKey: 'ARCH-3', issueSummary: 'Datastore', commentId: '9003', created: '2026-11-25T08:00:00Z', adf: adf('Decision: ADR-012: Use PostgreSQL instead of MongoDB for new services.') });
  assert.equal(own.key, 'ADR-012');
});

// --- polarity: phrasings people actually use (see test/corpus.json) ------------------------------------------
const parse = (s) => {
  const r = parseStatement(s);
  return { chosen: r.chosen, rejected: r.rejected, scope: r.scope };
};

test('"allow X for Z" makes a choice; "do not allow X" rules it out', () => {
  const allow = parseStatement('Allow SMS one-time passcodes as a 2FA fallback for customers without a smartphone.');
  assert.deepEqual(allow.chosen, ['SMS one-time passcodes as a 2FA fallback']);
  assert.deepEqual(allow.scope, ['customers without a smartphone']);
  assert.deepEqual(allow.rejected, []);
  assert.equal(allow.rationale, null);
  const ban = parseStatement('Do not allow SMS one-time passcodes for 2FA.');
  assert.deepEqual(ban.rejected, ['SMS one-time passcodes']);
  assert.equal(ban.negativeVerb, 'allow');
  assert.deepEqual(parse('We will allow guest checkout for first-time buyers.').chosen, ['guest checkout']);
  assert.deepEqual(parse("It's OK to use Slack huddles for incident calls.").chosen, ['Slack huddles']);
  assert.deepEqual(parse('Enable passkeys for all customer accounts.').chosen, ['passkeys']);
  assert.deepEqual(parseStatement('Do not enable public sharing links for customer documents.').negativeVerb, 'enable');
});

test('decided / go with / stick with / only use, and passive rejections in a second clause', () => {
  assert.deepEqual(parse('We decided to go with PostgreSQL for all new services; MongoDB was ruled out because we need transactions.'), {
    chosen: ['PostgreSQL'],
    rejected: ['MongoDB'],
    scope: ['all new services'],
  });
  assert.deepEqual(parse("We'll stick with Zendesk for customer support.").chosen, ['Zendesk']);
  assert.deepEqual(parse('Only use Inter in the product UI.'), { chosen: ['Inter'], rejected: [], scope: ['the product UI'] });
  assert.deepEqual(parse('We picked Lucide for icons; Font Awesome was rejected because of bundle size.'), { chosen: ['Lucide'], rejected: ['Font Awesome'], scope: ['icons'] });
  assert.deepEqual(parse('Going with Sentry after comparing it with Bugsnag and Rollbar.'), { chosen: ['Sentry'], rejected: ['Bugsnag', 'Rollbar'], scope: [] });
});

test('passive and active rejections: was rejected, were dropped, are banned for, off the table, drop support for', () => {
  assert.deepEqual(parse('Micro-frontends were rejected for the web app.'), { chosen: [], rejected: ['Micro-frontends'], scope: ['the web app'] });
  assert.deepEqual(parse('Self-hosted GitHub runners were dropped.').rejected, ['Self-hosted GitHub runners']);
  assert.deepEqual(parse('MD5 and SHA-1 are banned for password hashing and token signing.'), { chosen: [], rejected: ['MD5', 'SHA-1'], scope: ['password hashing', 'token signing'] });
  assert.deepEqual(parse("We're going native: Swift on iOS and Kotlin on Android. Flutter and React Native are off the table."), {
    chosen: ['Swift', 'Kotlin'],
    rejected: ['Flutter', 'React Native'],
    scope: ['iOS', 'Android'],
  });
  assert.deepEqual(parse('Drop support for iOS 15 and below in the 6.0 release.').rejected, ['iOS 15 and below']);
  assert.deepEqual(parse('Deprecate the v1 API by Q3.').rejected, ['v1 API']);
  assert.deepEqual(parse('Kafka was ruled out because of the operational cost.').rejected, ['Kafka']);
});

test('"X, not Y", "Instead of Y, X", bare "X over Y"', () => {
  assert.deepEqual(parse('Use Terraform, not Pulumi.'), { chosen: ['Terraform'], rejected: ['Pulumi'], scope: [] });
  assert.deepEqual(parse('Stripe, not Adyen, for card payments.'), { chosen: ['Stripe'], rejected: ['Adyen'], scope: ['card payments'] });
  assert.deepEqual(parse('All new frontend code is TypeScript, not plain JS.'), { chosen: ['TypeScript'], rejected: ['plain JS'], scope: ['All new frontend code'] });
  assert.deepEqual(parse('Auth tokens go in httpOnly cookies, not localStorage.'), { chosen: ['httpOnly cookies'], rejected: ['localStorage'], scope: ['Auth tokens'] });
  assert.deepEqual(parse('Instead of Jenkins, use GitHub Actions for CI.'), { chosen: ['GitHub Actions'], rejected: ['Jenkins'], scope: ['CI'] });
  assert.deepEqual(parse('Kafka over RabbitMQ for event streaming between services.'), { chosen: ['Kafka'], rejected: ['RabbitMQ'], scope: ['event streaming between services'] });
  assert.deepEqual(parse('Send events over HTTPS to the collector.').rejected, []);
});

test('moving off / away from / from Y to X, avoid X', () => {
  assert.deepEqual(parse("We're moving off Heroku.").rejected, ['Heroku']);
  assert.deepEqual(parse("We're moving away from cron jobs on EC2 boxes.").rejected, ['cron jobs on EC2 boxes']);
  assert.deepEqual(parse("We're moving all production workloads from ECS to Kubernetes."), { chosen: ['Kubernetes'], rejected: ['ECS'], scope: ['all production workloads'] });
  assert.deepEqual(parse('Switching product search to OpenSearch from Algolia.'), { chosen: ['OpenSearch'], rejected: ['Algolia'], scope: ['product search'] });
  assert.deepEqual(parse('Moving away from Angular to React for the admin app.'), { chosen: ['React'], rejected: ['Angular'], scope: ['the admin app'] });
  assert.deepEqual(parse('Avoid Redux.').rejected, ['Redux']);
});

test('prohibitions: lists, passive "must not be stored", "no X in Y", subject as scope', () => {
  assert.deepEqual(parse('Never log access tokens, passwords or session cookies.').rejected, ['access tokens', 'passwords', 'session cookies']);
  const pii = parseStatement('PII must not be stored or replicated outside the EU.');
  assert.deepEqual(pii.rejected, ['PII']);
  assert.equal(pii.negativeVerb, 'store');
  assert.deepEqual(parse('No customer data in Slack.'), { chosen: [], rejected: ['customer data'], scope: ['Slack'] });
  assert.deepEqual(parse('No new services in Ruby.'), { chosen: [], rejected: ['Ruby'], scope: ['new services'] });
  assert.deepEqual(parse("Services must not read or write another service's database."), { chosen: [], rejected: ["another service's database"], scope: ['Services'] });
});

test('rules with a subject, roles and defaults', () => {
  assert.deepEqual(parse('All internal service-to-service calls must use mTLS.'), { chosen: ['mTLS'], rejected: [], scope: ['All internal service-to-service calls'] });
  assert.deepEqual(parse('Every pull request needs two approvals before it can be merged.'), { chosen: ['two approvals'], rejected: [], scope: ['Every pull request'] });
  assert.deepEqual(parse('Redis is our default for application caching.'), { chosen: ['Redis'], rejected: [], scope: ['application caching'] });
  assert.deepEqual(parse('BigQuery will be used as the warehouse for product analytics.'), { chosen: ['BigQuery'], rejected: [], scope: ['product analytics'] });
  assert.deepEqual(parse('Customer 2FA will use passkeys with a TOTP fallback instead of SMS codes.'), { chosen: ['passkeys with a TOTP fallback'], rejected: ['SMS codes'], scope: ['Customer 2FA'] });
  const role = parseStatement('Use Snowflake as our data warehouse instead of Redshift.');
  assert.deepEqual([role.chosen, role.rejected, role.rationale], [['Snowflake'], ['Redshift'], null]);
});

test('statements that decide nothing stay empty', () => {
  assert.deepEqual(parse('Move the Android passkey rollout to sprint 9.'), { chosen: [], rejected: [], scope: [] });
  assert.deepEqual(parse('Support can help customers who lose a device through the verified recovery flow.').chosen, []);
  assert.deepEqual(parse('Mobile releases ship on Tuesdays; no Friday App Store submissions.'), { chosen: [], rejected: ['Friday App Store submissions'], scope: [] });
  assert.equal(parseStatement('Use Aurora PostgreSQL instead of MongoDB for new transactional services, because we need multi-row transactions. Supersedes ADR-003.').rationale, 'we need multi-row transactions');
});
