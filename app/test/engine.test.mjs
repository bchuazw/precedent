// Unit tests for Precedent's deterministic engine. Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatement } from '../src/engine/polarity.js';
import { decisionsFromPage, decisionsFromComment, applySupersession } from '../src/engine/extract.js';
import { checkWork, searchDecisions } from '../src/engine/match.js';
import { analyseWork } from '../src/engine/intent.js';

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

// --- matching: rules added with the corpus (see test/corpus.json) ---------------------------------------------
const rules = applySupersession([
  itemDecision('pg', 'We decided to go with PostgreSQL for all new services; MongoDB was ruled out.', { key: 'ADR-012' }),
  itemDecision('cache', 'Redis is our default for application caching.', { key: 'ADR-027' }),
  itemDecision('mon', 'Consolidate on Datadog for metrics and APM.', { key: 'D-3001' }),
  itemDecision('k8s', "We're moving all production workloads from ECS to Kubernetes.", { key: 'ADR-019' }),
  itemDecision('mobile', "We're going native: Swift on iOS and Kotlin on Android. Flutter and React Native are off the table.", { key: 'D-3002' }),
  itemDecision('tls', 'All public endpoints require TLS 1.2 or higher.', { key: 'D-3003' }),
  itemDecision('pr', 'Every pull request needs two approvals before it can be merged.', { key: 'D-3004' }),
  itemDecision('api', 'Public APIs are REST with OpenAPI specs. GraphQL was rejected for the public surface.', { key: 'ADR-030' }),
  itemDecision('ci', "We're moving CI from Jenkins to GitHub Actions.", { key: 'ADR-040' }),
  itemDecision('pkg', "We'll use pnpm for all JS repos going forward.", { key: 'D-3005' }),
  itemDecision('pii', 'Never log PII.', { key: 'D-3006' }),
  itemDecision('mfa', 'Use passkeys with a TOTP fallback instead of SMS one-time passcodes for 2FA.', { key: 'ADR-007' }),
  itemDecision('flags', 'Use LaunchDarkly for feature flags instead of an in-house feature flag service.', { key: 'D-2001' }),
]);
const verdict = (summary, description) => {
  const r = checkWork({ summary, description }, rules);
  return Object.fromEntries(r.findings.map((f) => [f.key, f]));
};

test('adopting another member of the chosen option\'s category is a conflict that names both sides', () => {
  const f = verdict('Use DynamoDB for the new referral service state')['ADR-012'];
  assert.equal(f.relation, 'conflict');
  assert.deepEqual([f.evidence[0].type, f.evidence[0].alternative, f.evidence[0].term], ['uses-alternative', 'DynamoDB', 'PostgreSQL']);
  assert.equal(verdict('Put a Memcached layer in front of the catalog API')['ADR-027']?.relation, 'conflict');
  assert.equal(verdict('Add the New Relic agent to the search service')['D-3001']?.relation, 'conflict');
  assert.equal(verdict('Add a yarn.lock and Yarn workspaces to the web repo')['D-3005']?.relation, 'conflict');
});

test('naming another product without adopting it is not a conflict', () => {
  assert.notEqual(verdict('Give the Grafana instance a shared admin login for on-call')['D-3001']?.relation, 'conflict');
  assert.notEqual(verdict('Evaluate Memcached against Redis for the catalog cache')['ADR-027']?.relation, 'conflict');
  assert.notEqual(verdict('Python notebook to analyse churn')['ADR-012']?.relation, 'conflict');
  assert.equal(verdict('Migrate the design-system repo from npm to pnpm')['D-3005']?.relation, 'aligned');
});

test('acting against the chosen option is a conflict: remove, replace, older version, fewer approvals', () => {
  const removed = verdict('Remove passkey support from the Android app')['ADR-007'];
  assert.deepEqual([removed.relation, removed.evidence[0].type], ['conflict', 'removes-chosen']);
  assert.equal(verdict('Replace LaunchDarkly with Unleash to cut costs')['D-2001']?.relation, 'conflict');
  const tls = verdict('Re-enable TLS 1.1 on the payments API for a legacy partner')['D-3003'];
  assert.deepEqual([tls.relation, tls.evidence[0].alternative], ['conflict', 'TLS 1.1']);
  assert.equal(verdict('Allow merging with one approval on the docs repo')['D-3004']?.relation, 'conflict');
  assert.notEqual(verdict('Write audit log entries for refund approvals')['D-3004']?.relation, 'aligned');
});

test('abbreviations and variants: Mongo, k8s, RN, text message codes', () => {
  assert.equal(verdict('Spin up a Mongo cluster for the loyalty service')['ADR-012']?.relation, 'conflict');
  assert.equal(verdict('Deploy the pricing service to k8s')['ADR-019']?.relation, 'aligned');
  assert.equal(verdict('[iOS] Rebuild order tracking in RN so we can share code with web')['D-3002']?.relation, 'conflict');
  assert.equal(verdict('Text the user a one-time code when they log in from a new device', 'Second factor for new devices.')['ADR-007']?.relation, 'conflict');
});

test('a wish is not a removal; spikes and bug reports are related, not conflicts', () => {
  assert.equal(verdict('As a customer without a smartphone, I want my login code sent by text message for 2FA')['ADR-007']?.relation, 'conflict');
  assert.equal(verdict('Spike: re-evaluate GraphQL for the public API')['ADR-030']?.relation, 'related');
  assert.equal(verdict('Jenkins agent out of disk space')['ADR-040']?.relation, 'related');
  assert.equal(verdict('Move CI back to Jenkins for the monorepo')['ADR-040']?.relation, 'conflict');
});

test('signing in is not logging, and generic words alone earn no finding', () => {
  assert.equal(verdict("Customer can't log in after changing their email address")['D-3006'], undefined);
  assert.equal(checkWork({ summary: 'Mobile: increase tap target size on the quantity stepper' }, rules).findings.length, 0);
  assert.equal(checkWork({ summary: 'Add a request ID to every log line' }, rules).findings.length, 0);
});

// --- cases from the lead's blind test ------------------------------------------------------------------------------
const lead = applySupersession([
  itemDecision('ci2', 'standardise on GitHub Actions for CI, Jenkins is being retired.', { key: 'D-4001' }),
  itemDecision('rev', 'We agreed that every pull request needs two reviewers before merging.', { key: 'D-4002' }),
  itemDecision('eu', 'We will keep customer data in the EU region only.', { key: 'D-4003' }),
  itemDecision('mail', 'Marketing emails are sent through Mailchimp; do not use SendGrid for campaigns.', { key: 'D-4004' }),
  itemDecision('fri', "Don't deploy to production on Fridays.", { key: 'D-4005' }),
  itemDecision('go', 'All backend services must be written in Go.', { key: 'D-4006' }),
  itemDecision('bill', 'No new features in the legacy billing module.', { key: 'D-4007' }),
  itemDecision('pay', 'Go with Stripe for payments, not PayPal.', { key: 'D-4008' }),
]);
const leadVerdict = (summary, description) => Object.fromEntries(checkWork({ summary, description }, lead).findings.map((f) => [f.key, f.relation]));

test('parses: a comma before its own clause, "we agreed that", "keep X in Y", "are sent through"', () => {
  assert.deepEqual(parse('standardise on GitHub Actions for CI, Jenkins is being retired.'), { chosen: ['GitHub Actions'], rejected: ['Jenkins'], scope: ['CI'] });
  assert.deepEqual(parse('We agreed that every pull request needs two reviewers before merging.'), { chosen: ['two reviewers'], rejected: [], scope: ['every pull request'] });
  assert.deepEqual(parse('We will keep customer data in the EU region only.'), { chosen: ['EU region'], rejected: [], scope: ['customer data'] });
  assert.deepEqual(parse('Marketing emails are sent through Mailchimp; do not use SendGrid for campaigns.'), { chosen: ['Mailchimp'], rejected: ['SendGrid'], scope: ['Marketing emails', 'campaigns'] });
});

test('an environment the work names elsewhere ("to staging") is not a production rule broken', () => {
  assert.notEqual(leadVerdict('Deploy the hotfix to staging on Friday')['D-4005'], 'conflict');
  assert.equal(leadVerdict('Schedule the v2.3 production deploy for Friday afternoon')['D-4005'], 'conflict');
  assert.equal(leadVerdict('Ship the hotfix on Friday afternoon')['D-4005'], 'conflict');
});

test('a scope word that only names the product kind proves nothing ("emails" for SendGrid)', () => {
  assert.equal(leadVerdict('Use SendGrid for password reset emails', 'Transactional email only.')['D-4004'], 'related');
  assert.equal(leadVerdict('Send the spring campaign through SendGrid')['D-4004'], 'conflict');
});

test('languages are a category; hiring is a mention; "no new features in S" bites work that adds to S', () => {
  assert.equal(leadVerdict('Write the notification service in Python')['D-4006'], 'conflict');
  assert.notEqual(leadVerdict('Interview candidates for the Go backend role')['D-4006'], 'aligned');
  assert.equal(leadVerdict('Add coupon codes to the legacy billing module')['D-4007'], 'conflict');
  assert.equal(leadVerdict('Fix a rounding bug in the legacy billing module')['D-4007'], 'related');
});

test('fewer reviewers, another region, and a ruled-out or chosen payment provider', () => {
  assert.equal(leadVerdict('Allow merging pull requests with a single approval for hotfixes')['D-4002'], 'conflict');
  assert.equal(leadVerdict('Replicate the customers table to the us-east-1 region for analytics')['D-4003'], 'conflict');
  assert.equal(leadVerdict('Set up a Jenkins pipeline for the mobile app')['D-4001'], 'conflict');
  assert.equal(leadVerdict('Move the web build to GitHub Actions')['D-4001'], 'aligned');
  assert.equal(leadVerdict('Integrate Stripe webhooks for refunds')['D-4008'], 'aligned');
  assert.equal(leadVerdict('Remove PayPal from checkout')['D-4008'], 'aligned');
  assert.equal(checkWork({ summary: 'Lunch rota for the office' }, lead).findings.length, 0);
});

// --- cases from the lead's second blind test -----------------------------------------------------------------------
const lead2 = applySupersession([
  itemDecision('cloud', 'We chose AWS as our cloud provider; no workloads on Azure or GCP.', { key: 'D-5001' }),
  itemDecision('figma', 'Use Figma for design work. Sketch files are no longer accepted.', { key: 'D-5002' }),
  itemDecision('ts', 'TypeScript only for new frontend code - no plain JavaScript.', { key: 'D-5003' }),
  itemDecision('mono', 'We are sticking with the monolith for now - no new microservices this year.', { key: 'D-5004' }),
  itemDecision('bus', 'Kafka is our event bus. Do not introduce RabbitMQ or SQS for new integrations.', { key: 'D-5005' }),
  itemDecision('ios', 'The mobile app supports iOS 16 and above.', { key: 'D-5006' }),
  itemDecision('disc', 'We will not offer discounts above 20% without VP approval.', { key: 'D-5007' }),
  itemDecision('legal', 'all customer-facing copy must be reviewed by Legal before launch.', { key: 'D-5008' }),
  itemDecision('desk', 'Support tickets are handled in Zendesk, not in shared inboxes.', { key: 'D-5009' }),
]);
const lead2Verdict = (summary) => Object.fromEntries(checkWork({ summary }, lead2).findings.map((f) => [f.key, f.relation]));

test('parses: "no X on Y or Z" with products, "no longer accepted", "X is our Y", "supports X and above", "reviewed by Y"', () => {
  assert.deepEqual(parse('We chose AWS as our cloud provider; no workloads on Azure or GCP.'), { chosen: ['AWS'], rejected: ['Azure', 'GCP'], scope: ['cloud provider', 'workloads'] });
  assert.deepEqual(parse('Use Figma for design work. Sketch files are no longer accepted.').rejected, ['Sketch files']);
  assert.deepEqual(parse('We are sticking with the monolith for now - no new microservices this year.').rejected, ['new microservices']);
  assert.deepEqual(parse('Kafka is our event bus.'), { chosen: ['Kafka'], rejected: [], scope: ['event bus'] });
  assert.deepEqual(parse('The mobile app supports iOS 16 and above.').chosen, ['iOS 16 and above']);
  assert.deepEqual(parse('all customer-facing copy must be reviewed by Legal before launch.').chosen, ['Legal']);
  assert.deepEqual(parse('Support tickets are handled in Zendesk, not in shared inboxes.'), { chosen: ['Zendesk'], rejected: ['shared inboxes'], scope: ['Support tickets'] });
});

test('second blind set: each class of miss now conflicts or aligns', () => {
  assert.equal(lead2Verdict('Spin up an Azure VM for the reporting job')['D-5001'], 'conflict');
  assert.equal(lead2Verdict('Move the image pipeline to GCP Cloud Run')['D-5001'], 'conflict');
  assert.equal(lead2Verdict('Upload the Sketch file for the onboarding redesign')['D-5002'], 'conflict');
  assert.equal(lead2Verdict('Write the new checkout widget in plain JavaScript')['D-5003'], 'conflict');
  assert.equal(lead2Verdict('Extract the notifications code into a new microservice')['D-5004'], 'conflict');
  assert.equal(lead2Verdict('Publish order events to Kafka')['D-5005'], 'aligned');
  assert.equal(lead2Verdict('Add support for iOS 15 devices')['D-5006'], 'conflict');
  assert.equal(lead2Verdict('Offer Acme Corp a 35% discount on the annual plan')['D-5007'], 'related');
  assert.equal(lead2Verdict('Apply a 30% discount without VP approval')['D-5007'], 'conflict');
  assert.equal(lead2Verdict('Launch the new pricing page copy on Monday without waiting for Legal')['D-5008'], 'conflict');
  assert.equal(lead2Verdict('Add a Zendesk macro for refund requests')['D-5009'], 'aligned');
  assert.equal(lead2Verdict('Route billing questions to the shared finance inbox')['D-5009'], 'conflict');
});

test('second blind set: bills, decks, headcount, a lag alert and a small discount stay quiet', () => {
  for (const summary of ['AWS bill review for October', 'Azure OpenAI pricing for the board deck', 'Legal headcount planning for 2027', 'Add a 10% loyalty discount', 'Order team lunch for Thursday']) {
    assert.deepEqual(lead2Verdict(summary), {}, summary);
  }
  assert.notEqual(lead2Verdict('Kafka consumer lag alert for the payments topic')['D-5005'], 'aligned');
});

// --- the work is read first: intent and roles (intent.js) ----------------------------------------------------------
const intentOf = (summary, description) => analyseWork({ summary, description }).intent;
const roleOf = (summary, ...toks) => analyseWork({ summary }).role(toks);

test('intent: the lead verb classes a summary; verbless titles, questions and prefixes are read as what they are', () => {
  assert.equal(intentOf('Deploy the new admin tool on Heroku'), 'adopt');
  assert.equal(intentOf('Temporarily enable the legacy exporter'), 'adopt');
  assert.equal(intentOf('Rebuild the settings screens with Bootstrap components'), 'transform');
  assert.equal(intentOf('Migrate the CMS content store from MongoDB to Postgres'), 'move');
  assert.equal(intentOf('Upgrade the API image to Node.js 22'), 'adjust');
  assert.equal(intentOf('Remove PayPal from checkout'), 'remove');
  assert.equal(intentOf('Stop sending SMS codes at sign-in'), 'remove');
  assert.equal(intentOf('Block direct pushes to the release branch'), 'enforce');
  assert.equal(intentOf('Fix a typo in the REST API documentation'), 'maintain');
  assert.equal(intentOf('Spike: re-evaluate GraphQL for the public API'), 'inquiry');
  assert.equal(intentOf('Should we revisit Webflow for landing pages?'), 'inquiry');
  assert.equal(intentOf('Nomad vs Kubernetes'), 'inquiry');
  assert.equal(intentOf('Write a comparison of Tailwind and Bootstrap for the blog'), 'doc');
  assert.equal(intentOf('Heroku invoice for October'), 'admin');
  assert.equal(intentOf('Legal team headcount planning'), 'admin');
  assert.equal(intentOf('Hire two senior engineers'), 'admin');
  assert.equal(intentOf('Sentry alert: spike in 500s'), 'report');
  assert.equal(intentOf('Jenkins agent out of disk space'), 'report');
  assert.equal(intentOf('Figma file for the new settings page'), 'title');
  assert.equal(intentOf('Build pipeline for the mobile app'), 'title', 'a noun, not an instruction');
  assert.equal(intentOf('New Mailgun domain for order confirmation emails'), 'adopt', 'a title that says the thing is new');
  assert.equal(intentOf('As a shopper, I want to pay with PayPal'), 'adopt');
  assert.equal(intentOf('We should use Redis for the session store'), 'adopt');
  assert.equal(analyseWork({ summary: 'Renew the New Relic contract for another year' }).verb, 'renew');
  assert.equal(analyseWork({ summary: 'Pay the Webflow invoice' }).quiet, true);
});

test('roles: adopted, removed, kept out, gone without, or only named', () => {
  const s3 = 'Serve product images straight from the S3 bucket to save CDN costs';
  assert.equal(roleOf(s3, 's3').kind, 'adopted');
  assert.deepEqual([roleOf(s3, 'cdn').kind, roleOf(s3, 'cdn').why], ['mention', 'owned']);
  assert.equal(roleOf('Replace LaunchDarkly with Unleash to cut costs', 'launchdarkly').kind, 'removed');
  assert.equal(roleOf('Replace LaunchDarkly with Unleash to cut costs', 'unleash').kind, 'adopted');
  assert.equal(roleOf('Migrate the activity feed off MongoDB', 'mongodb').kind, 'removed');
  assert.equal(roleOf('Migrate the CMS content store from MongoDB to Postgres', 'postgres').kind, 'adopted');
  assert.equal(roleOf('Use passkeys instead of SMS codes', 'sms').kind, 'removed');
  assert.equal(roleOf('Launch the pricing page copy without waiting for Legal', 'legal').kind, 'without');
  assert.equal(roleOf('Redact card numbers in the request logger', 'cardnumber').kind, 'enforced');
  assert.equal(roleOf('Add a test that fails if PII shows up in logs', 'pii').kind, 'enforced');
  // A purpose, a place that is only changed, a new version and a source are named, not adopted.
  assert.deepEqual([roleOf('Set up DKIM for SendGrid', 'sendgrid').kind, roleOf('Set up DKIM for SendGrid', 'sendgrid').why], ['mention', 'purpose']);
  assert.deepEqual([roleOf('Add retries to the Jenkins pipeline', 'jenkins').kind, roleOf('Add retries to the Jenkins pipeline', 'jenkins').why], ['mention', 'place']);
  assert.equal(roleOf('Add the search rotation to PagerDuty', 'pagerduty').kind, 'adopted');
  assert.equal(roleOf('Upgrade the API image to Node.js 22', 'javascript').kind, 'mention');
  assert.equal(roleOf('Update the checkout to use Braintree', 'braintree').kind, 'adopted');
  assert.equal(roleOf("Sync GitHub issues labelled 'bug' into Jira", 'githubissues').kind, 'mention');
  assert.equal(roleOf("Sync GitHub issues labelled 'bug' into Jira", 'jira').kind, 'adopted');
  // Removing something that belongs to a product is housekeeping.
  assert.deepEqual([roleOf('Delete the old Datadog dashboards', 'datadog').kind, roleOf('Delete the old Datadog dashboards', 'datadog').part], ['removed', true]);
  // A verbless title leads with what it delivers; it never adopts.
  assert.equal(roleOf('Figma file for the new settings page', 'figma').kind, 'titled');
  // Doing the very thing a term names adopts it.
  assert.equal(roleOf('Commit the hotfix directly to main', 'commit', 'direct').kind, 'adopted');
});

test('the description supports the summary: instructions count, background does not', () => {
  const planned = analyseWork({ summary: 'Self-service account recovery', description: 'When sign-in fails three times, offer "Text me a code" and send an SMS one-time passcode to the phone number on file.' });
  assert.deepEqual([planned.role(['sms', 'otp']).kind, planned.role(['sms', 'otp']).where], ['adopted', 'description']);
  const background = analyseWork({ summary: 'Move the web build to the new runners', description: 'We currently use Jenkins for this. Jenkins is where the old jobs live.' });
  assert.equal(background.role(['jenkins']).kind, 'mention');
  const fix = analyseWork({ summary: 'Fix the flaky deploy step', description: 'Use Jenkins to reproduce it.' });
  assert.equal(fix.role(['jenkins']).kind, 'mention', 'a fix stays a fix whatever its description says');
});

// --- the lead's third blind set: conflicts need adoption evidence ---------------------------------------------------
const lead3 = applySupersession([
  itemDecision('api', 'Going forward, new APIs should be GraphQL rather than REST.', { key: 'D-6001' }),
  itemDecision('host', "we're moving off Heroku to Fly.io.", { key: 'D-6002' }),
  itemDecision('img', 'Images must be served through the CDN, never directly from S3.', { key: 'D-6003' }),
  itemDecision('err', 'Sentry is the standard for error tracking across all apps.', { key: 'D-6004' }),
  itemDecision('main', 'No direct commits to main; everything goes through a pull request.', { key: 'D-6005' }),
  itemDecision('css', 'We picked Tailwind over Bootstrap for the design system.', { key: 'D-6006' }),
  itemDecision('mail', 'Customer emails must not be exported to spreadsheets.', { key: 'D-6007' }),
  itemDecision('mon', 'use Datadog for monitoring; we are dropping New Relic at renewal.', { key: 'D-6008' }),
  itemDecision('pay', 'Payments stay with Adyen. We evaluated Stripe and decided against it.', { key: 'D-6009' }),
  itemDecision('mig', 'Only senior engineers can approve database migrations.', { key: 'D-6010' }),
]);
const lead3Finding = (summary) => Object.fromEntries(checkWork({ summary }, lead3).findings.map((f) => [f.key, f]));
const lead3Verdict = (summary) => Object.fromEntries(Object.entries(lead3Finding(summary)).map(([k, f]) => [k, f.relation]));

test('parses: "should be X rather than Y", "X, never from Y", "stay with X ... decided against it", "at renewal", a restriction', () => {
  assert.deepEqual(parse('Going forward, new APIs should be GraphQL rather than REST.'), { chosen: ['GraphQL'], rejected: ['REST'], scope: ['new APIs'] });
  assert.deepEqual(parse('Images must be served through the CDN, never directly from S3.'), { chosen: ['CDN'], rejected: ['S3'], scope: ['Images'] });
  assert.deepEqual(parse('Payments stay with Adyen. We evaluated Stripe and decided against it.'), { chosen: ['Adyen'], rejected: ['Stripe'], scope: ['Payments'] });
  assert.deepEqual(parse('use Datadog for monitoring; we are dropping New Relic at renewal.'), { chosen: ['Datadog'], rejected: ['New Relic'], scope: ['monitoring'] });
  assert.deepEqual(parse('Only senior engineers can approve database migrations.'), { chosen: ['senior engineers'], rejected: [], scope: ['database migrations'] });
  const exported = parseStatement('Customer emails must not be exported to spreadsheets.');
  assert.deepEqual([exported.rejected, exported.scope, exported.negativeVerb], [['Customer emails'], ['spreadsheets'], 'export']);
});

test('third blind set: naming a ruled-out option without adopting it is never a conflict', () => {
  assert.equal(lead3Verdict('Fix a typo in the REST API documentation')['D-6001'], 'related');
  assert.deepEqual(lead3Verdict('Heroku invoice for October'), {});
  assert.equal(lead3Verdict('Write a comparison of Tailwind and Bootstrap for the blog')['D-6006'], 'related');
  assert.equal(lead3Finding('Fix a typo in the REST API documentation')['D-6001'].evidence[0].type, 'mentions-rejected-not-adopted');
  for (const summary of ['Fix the flaky login test', 'Investigate S3 bucket costs', 'Book the team dinner', 'Hire two senior engineers', 'Archive old spreadsheets in the finance drive']) {
    assert.deepEqual(lead3Verdict(summary), {}, summary);
  }
  assert.notEqual(lead3Verdict('Open a pull request for the pricing change')['D-6005'], 'aligned', 'a common practice needs the scope');
});

test('third blind set: adopting a ruled-out option, another member of its category, or a restricted action is a conflict', () => {
  assert.equal(lead3Verdict('Expose the loyalty points service as a REST API')['D-6001'], 'conflict');
  assert.equal(lead3Verdict('Deploy the new admin tool on Heroku')['D-6002'], 'conflict');
  assert.equal(lead3Verdict('Serve product images straight from the S3 bucket to save CDN costs')['D-6003'], 'conflict');
  const bugsnag = lead3Finding('Set up Bugsnag for the mobile app crashes')['D-6004'];
  assert.deepEqual([bugsnag.relation, bugsnag.evidence[0].alternative, bugsnag.evidence[0].verb], ['conflict', 'Bugsnag', 'set up']);
  assert.equal(lead3Verdict('Commit the hotfix directly to main')['D-6005'], 'conflict');
  assert.equal(lead3Verdict('Rebuild the settings screens with Bootstrap components')['D-6006'], 'conflict');
  assert.equal(lead3Verdict('Export customer emails to a Google Sheet for the marketing team')['D-6007'], 'conflict');
  assert.equal(lead3Verdict('Renew the New Relic contract for another year')['D-6008'], 'conflict');
  assert.equal(lead3Verdict('Integrate Stripe Checkout for the subscription upgrade flow')['D-6009'], 'conflict');
  const migration = lead3Finding('Let junior developers approve database migrations to speed things up')['D-6010'];
  assert.deepEqual([migration.relation, migration.evidence[0].type, migration.evidence[0].other], ['conflict', 'restricted-to', 'junior developers']);
  assert.notEqual(lead3Verdict('Let senior engineers approve database migrations from the CLI')['D-6010'], 'conflict');
});

test('third blind set: using the chosen option is aligned, and so is taking the ruled-out one away', () => {
  assert.equal(lead3Verdict('Add a GraphQL mutation for updating addresses')['D-6001'], 'aligned');
  assert.equal(lead3Verdict('Move the docs site to Fly.io')['D-6002'], 'aligned');
  assert.equal(lead3Verdict('Put the product gallery images behind the CDN')['D-6003'], 'aligned');
  assert.equal(lead3Verdict('Add Sentry to the checkout service')['D-6004'], 'aligned');
  assert.equal(lead3Verdict('Style the onboarding screens with Tailwind')['D-6006'], 'aligned');
  assert.equal(lead3Verdict('Create Datadog dashboards for the API latency')['D-6008'], 'aligned');
  assert.equal(lead3Verdict('Add Adyen 3DS2 support')['D-6009'], 'aligned');
  assert.equal(lead3Verdict('Cancel the New Relic subscription')['D-6008'], 'aligned');
  assert.equal(lead3Verdict('Migrate the last two apps off Heroku')['D-6002'], 'aligned');
});

// --- the same principle on wording and names the engine has never seen ----------------------------------------------
test('the safety net under the grammar: names take their polarity from the cues in their own clause', () => {
  assert.deepEqual(parse("Kubernetes it is. Nomad didn't make the cut."), { chosen: ['Kubernetes'], rejected: ['Nomad'], scope: [] });
  assert.deepEqual(parse('After the bake-off, Vue won; Angular lost.'), { chosen: ['Vue'], rejected: ['Angular'], scope: [] });
  assert.deepEqual(parse('We looked at Tableau and Looker. Going with Looker.'), { chosen: ['Looker'], rejected: ['Tableau'], scope: [] });
  assert.deepEqual(parse('We trialled Cypress for a sprint and ruled it out. Playwright is the e2e standard.'), { chosen: ['Playwright'], rejected: ['Cypress'], scope: [] });
  assert.deepEqual(parse('CTO approved Rust for the new ingest pipeline; Go was considered but not picked.'), { chosen: ['Rust'], rejected: ['Go'], scope: ['new ingest pipeline'] });
  assert.deepEqual(parse('Customer PII never goes into Google Sheets.'), { chosen: [], rejected: ['Google Sheets'], scope: ['Customer PII'] });
  assert.deepEqual(parse("We're done with Jenkins.").rejected, ['Jenkins']);
  assert.deepEqual(parse('Decided against Redis Streams. Kafka stays.'), { chosen: ['Kafka'], rejected: ['Redis Streams'], scope: [] });
  // Names without a cue stay unassigned, and a rule with a subject is not an "X over Y" choice.
  assert.deepEqual(parse('Refunds over $500 must be approved by a team lead.'), { chosen: ['team lead'], rejected: [], scope: ['Refunds over $500'] });
  assert.deepEqual(parse('Confluence is read-only from March.'), { chosen: [], rejected: [], scope: [] });
});

const unseen = applySupersession([
  itemDecision('ui', 'We picked Zephyr over Quartz for the design system.', { key: 'D-7001' }),
  itemDecision('hash', 'MD5 and SHA-1 are banned for password hashing and token signing.', { key: 'D-7002' }),
  itemDecision('ci', "We're done with Jenkins.", { key: 'D-7003' }),
  itemDecision('pii', 'Customer PII never goes into Google Sheets.', { key: 'D-7004' }),
  itemDecision('deploy', 'Only the release manager can deploy to production.', { key: 'D-7005' }),
  itemDecision('refund', 'Refunds over $500 must be approved by a team lead.', { key: 'D-7006' }),
  itemDecision('mon', 'Consolidate on Datadog for metrics and APM.', { key: 'D-7007' }),
]);
const unseenFinding = (summary) => Object.fromEntries(checkWork({ summary }, unseen).findings.map((f) => [f.key, f]));
const unseenVerdict = (summary) => Object.fromEntries(Object.entries(unseenFinding(summary)).map(([k, f]) => [k, f.relation]));

test('scope is soft evidence: a ruled-out option adopted without the scope words is a conflict one step lower', () => {
  // Zephyr and Quartz are in no lexicon: nothing here leans on knowing what kind of product they are.
  const named = unseenFinding('Rebuild the design system buttons with Quartz')['D-7001'];
  const unstated = unseenFinding('Rebuild the settings screens with Quartz components')['D-7001'];
  assert.deepEqual([named.relation, named.confidence, named.evidence[0].scopeUnstated], ['conflict', 'high', undefined]);
  assert.deepEqual([unstated.relation, unstated.confidence, unstated.evidence[0].scopeUnstated], ['conflict', 'medium', 'the design system']);
  // An explicit other use moves it to related; who it is for or why it is done does not.
  const other = unseenFinding('Use Quartz to render PDF invoices')['D-7001'];
  assert.deepEqual([other.relation, other.evidence[0].type, other.evidence[0].why], ['related', 'mentions-rejected-out-of-scope', 'purpose']);
  assert.equal(unseenVerdict('Use Quartz for the partner portal to save time')['D-7001'], 'conflict');
  assert.equal(unseenVerdict('Use MD5 for the cache key checksum')['D-7002'], 'related');
  assert.equal(unseenVerdict('Hash reset tokens with SHA-1')['D-7002'], 'conflict');
  // A scope that says what the rule governs stays a requirement: no customer PII, no conflict.
  assert.equal(unseenVerdict('Paste the customer phone numbers into a Google Sheet for the callback campaign')['D-7004'], 'conflict');
  assert.deepEqual(unseenVerdict('Track the sprint goals in a Google Sheet'), {});
});

test('maintaining, reporting on or cleaning up what exists is not adopting or abandoning it', () => {
  assert.equal(unseenVerdict('Add a Jenkins job for the nightly build')['D-7003'], 'conflict');
  assert.equal(unseenVerdict('Add retries to the Jenkins deploy job')['D-7003'], 'related');
  assert.equal(unseenVerdict('Jenkins queue is backed up again')['D-7003'], 'related');
  assert.equal(unseenVerdict('Turn off the last Jenkins agent')['D-7003'], 'aligned');
  assert.equal(unseenVerdict('Docs: how we deploy with Jenkins')['D-7003'], 'related');
  assert.equal(unseenVerdict('Remove Datadog from the checkout service')['D-7007'], 'conflict');
  assert.notEqual(unseenVerdict('Delete the old Datadog dashboards')['D-7007'], 'conflict');
  assert.notEqual(unseenVerdict('Upgrade the Datadog agent to v7')['D-7007'], 'conflict');
});

test('restrictions: handing the action to someone else conflicts; doing it, or naming the party, does not', () => {
  const f = unseenFinding('Allow any engineer to deploy to production')['D-7005'];
  assert.deepEqual([f.relation, f.evidence[0].type, f.evidence[0].other], ['conflict', 'restricted-to', 'engineer']);
  assert.equal(unseenVerdict('Deploy the hotfix to production')['D-7005'], 'related');
  assert.deepEqual(unseenVerdict('Release manager onboarding checklist'), {});
  assert.equal(unseenVerdict('Issue the $800 refund without waiting for the team lead')['D-7006'], 'conflict');
});

test('word forms: adverbs, plurals of "API", spreadsheets by any name, a meeting tool written as "Teams"', () => {
  const d = [itemDecision('main', 'No direct commits to main.', { key: 'D-8001' }), itemDecision('sheet', 'Customer emails must not be exported to spreadsheets.', { key: 'D-8002' }), itemDecision('calls', 'Video calls happen on Zoom, not Teams.', { key: 'D-8003' })];
  const v = (summary) => Object.fromEntries(checkWork({ summary }, d).findings.map((f) => [f.key, f.relation]));
  assert.equal(v('Commit the fix directly to main')['D-8001'], 'conflict');
  assert.equal(v('Export customer emails to Excel for the newsletter')['D-8002'], 'conflict');
  assert.equal(v('Dump customer emails into a CSV for the agency')['D-8002'], 'conflict');
  assert.equal(v('Schedule the customer onboarding call on Teams')['D-8003'], 'conflict');
  assert.deepEqual(v('Teams should rotate the release duty every sprint'), {});
});

// --- a verb-led title does work unless its verb says otherwise ----------------------------------------------------
test('default adoption: an instruction whose verb is in no class still adopts, flagged as assumed', () => {
  const read = (summary) => analyseWork({ summary });
  // Verbs the classes do not list: a common verb, a verb before an article, a verb by its shape.
  for (const summary of ['Take notes for the sprint review in Google Docs', 'Trigger the release build from Jenkins', 'Containerize the billing worker with Docker', 'Leave review comments on the onboarding flow in Figma']) {
    assert.notEqual(read(summary).intent, 'title', summary);
  }
  assert.deepEqual([read('Trigger the release build from Jenkins').role(['jenkins']).kind, read('Trigger the release build from Jenkins').role(['jenkins']).assumed], ['adopted', true]);
  assert.equal(read('Deploy the release build from Jenkins').role(['jenkins']).assumed, false, 'a verb that names the adoption is not assumed');
  // The closed sets still say otherwise: looking into, maintaining, removing, money and people.
  assert.equal(read('Decide whether to keep Mocha for the legacy repo').intent, 'inquiry');
  assert.equal(read('Mention Heroku in the migration FAQ').intent, 'inquiry');
  assert.equal(read('Scale the Jenkins workers to ten').intent, 'adjust');
  assert.equal(read('Renew the TLS certificate on the gateway').intent, 'maintain');
  assert.equal(read('Decline the Tableau renewal').intent, 'remove');
  assert.equal(read('Train new joiners on Terraform').intent, 'admin');
  assert.equal(read('Train the fraud model on last year\'s chargebacks').intent, 'adopt');
  // A title that leads with a noun or a product is not an instruction, whatever the word could also mean.
  for (const summary of ['Terraform training session for new joiners', 'Redis memory alert on the cache cluster', 'Webflow pricing comparison for the finance review', 'Leave policy update', 'Bootstrap 5 upgrade notes', 'Open questions for the Q3 roadmap']) {
    assert.ok(['title', 'doc', 'report', 'admin'].includes(read(summary).intent), `${summary}: ${read(summary).intent}`);
  }
});

test('naming without adopting: what a thing is shown in, counted in, shipped out of or said about', () => {
  const kind = (summary, ...toks) => analyseWork({ summary }).role(toks).kind;
  assert.equal(kind('Take screenshots of the old Bootstrap navbar for the retro', 'bootstrapcss'), 'mention');
  assert.equal(kind('Collect feedback on the Tableau trial', 'tableau'), 'mention');
  assert.equal(kind('Compile a list of Jenkins jobs to port', 'jenkins'), 'mention');
  assert.equal(kind('Export the Heroku config vars before the cutover', 'heroku'), 'mention');
  assert.equal(kind('Share the New Relic dashboard link before access ends', 'newrelic'), 'mention');
  assert.equal(kind('Translate the Stripe error messages into French', 'stripe'), 'mention');
  assert.equal(kind('Add Heroku to the list of deprecated platforms', 'heroku'), 'mention');
  assert.equal(kind('Commit the Stripe API key to .env.production', 'stripe'), 'mention');
  assert.equal(kind('Finish the Jenkins migration', 'jenkins'), 'mention');
  assert.equal(kind('Schedule the Jenkins shutdown for March', 'jenkins'), 'removed');
  assert.equal(kind('Give the Grafana instance a shared admin login for on-call', 'grafana'), 'mention');
  // The same verbs adopt when the thing is what they work with.
  assert.equal(kind('Take card payments on the kiosk with Stripe Terminal', 'stripe'), 'adopted');
  assert.equal(kind('Run payroll through Stripe for the contractors', 'stripe'), 'adopted');
  assert.equal(kind('Host the hackathon demo on Heroku', 'heroku'), 'adopted');
  assert.equal(kind('Give the sales team a New Relic dashboard', 'newrelic'), 'adopted');
  assert.equal(kind('Collect design feedback for the checkout redesign in a Slack thread', 'slack'), 'adopted');
});

// --- the lead's fourth blind set ------------------------------------------------------------------------------------
const lead4 = applySupersession([
  itemDecision('notes', 'Use Notion for meeting notes instead of Google Docs.', { key: 'D-9001' }),
  itemDecision('json', 'API responses must be JSON. XML is not supported.', { key: 'D-9002' }),
  itemDecision('jest', 'We standardised on Jest for unit tests.', { key: 'D-9003' }),
  itemDecision('secrets', "Don't put secrets in environment files; use Vault.", { key: 'D-9004' }),
  itemDecision('support', 'Support is staffed Monday to Friday; no weekend coverage for now.', { key: 'D-9005' }),
  itemDecision('infra', 'Terraform is how we manage infrastructure; no manual changes in the AWS console.', { key: 'D-9006' }),
  itemDecision('ssr', 'Prefer server-side rendering for public pages.', { key: 'D-9007' }),
  itemDecision('vpn', 'All internal tools go behind the VPN.', { key: 'D-9008' }),
  itemDecision('queue', 'We use SQS for job queues, not Redis.', { key: 'D-9009' }),
  itemDecision('site', 'The marketing site stays on WordPress; Webflow was ruled out.', { key: 'D-9010' }),
]);
const lead4Finding = (summary) => Object.fromEntries(checkWork({ summary }, lead4).findings.map((f) => [f.key, f]));
const lead4Verdict = (summary) => Object.fromEntries(Object.entries(lead4Finding(summary)).map(([k, f]) => [k, f.relation]));

test('parses: "X is how we manage Y", "X go behind Y"', () => {
  assert.deepEqual(parse('Terraform is how we manage infrastructure; no manual changes in the AWS console.'), { chosen: ['Terraform'], rejected: ['manual changes'], scope: ['infrastructure', 'the AWS console'] });
  assert.deepEqual(parse('All internal tools go behind the VPN.'), { chosen: ['VPN'], rejected: [], scope: ['All internal tools'] });
});

test('fourth blind set: work that plainly does the ruled-out thing conflicts, whatever verb it opens with', () => {
  const notes = lead4Finding('Take notes for the sprint review in Google Docs')['D-9001'];
  assert.deepEqual([notes.relation, notes.confidence], ['conflict', 'medium']);
  assert.equal(lead4Verdict('Return XML from the orders endpoint for the legacy partner')['D-9002'], 'conflict');
  assert.deepEqual([lead4Finding('Write the cart reducer tests in Mocha')['D-9003'].relation, lead4Finding('Write the cart reducer tests in Mocha')['D-9003'].evidence[0].alternative], ['conflict', 'Mocha']);
  assert.equal(lead4Verdict('Commit the Stripe API key to .env.production')['D-9004'], 'conflict');
  assert.equal(lead4Verdict('Add Saturday support shifts for December')['D-9005'], 'conflict');
  assert.equal(lead4Verdict('Resize the production RDS instance manually in the AWS console')['D-9006'], 'conflict');
  assert.equal(lead4Verdict('Render the pricing page on the client with a React SPA')['D-9007'], 'conflict');
  assert.deepEqual([lead4Finding('Use Redis as the queue for image processing jobs')['D-9009'].relation, lead4Finding('Use Redis as the queue for image processing jobs')['D-9009'].confidence], ['conflict', 'high']);
  assert.deepEqual([lead4Finding('Migrate the marketing site to Webflow')['D-9010'].relation, lead4Finding('Migrate the marketing site to Webflow')['D-9010'].confidence], ['conflict', 'high']);
});

test('fourth blind set: mentions stay mentions, and keeping to the choice is aligned', () => {
  for (const summary of ['Redis memory alert on the cache cluster', 'Webflow pricing comparison for the finance review', 'Audit who has AWS console access', 'Terraform training session for new joiners', 'Decide whether to keep Mocha for the legacy repo', 'Order new laptops for the interns']) {
    assert.ok(!Object.values(lead4Verdict(summary)).includes('conflict'), summary);
  }
  assert.deepEqual(lead4Verdict('Decide whether to keep Mocha for the legacy repo'), {});
  assert.deepEqual(lead4Verdict('Order new laptops for the interns'), {});
  assert.equal(lead4Verdict('Spin up Azure Cache for Redis for the cart service')['D-9009'], 'related', 'Redis as a cache is not Redis as a job queue');
  assert.equal(lead4Verdict('Create a Notion template for meeting notes')['D-9001'], 'aligned');
  assert.equal(lead4Verdict('Add Jest tests for the discount calculator')['D-9003'], 'aligned');
  assert.equal(lead4Verdict('Move the database password into Vault')['D-9004'], 'aligned');
  assert.equal(lead4Verdict('Add a Terraform module for the new VPC')['D-9006'], 'aligned');
  assert.equal(lead4Verdict('Put the new metrics tool behind the VPN')['D-9008'], 'aligned');
  assert.equal(lead4Verdict('Add an SQS queue for the thumbnail jobs')['D-9009'], 'aligned');
  assert.equal(lead4Verdict('Update the WordPress theme for the marketing site')['D-9010'], 'aligned');
  // A product chosen for one use is not followed by work that shows no sign of that use.
  assert.equal(lead4Verdict('Write the onboarding guide in Notion')['D-9001'], 'related');
});

test('concept links: secrets, environment files, weekends and shifts, manual changes, client against server', () => {
  const d = [
    itemDecision('s', 'Never commit secrets to the repo.', { key: 'D-9101' }),
    itemDecision('w', 'No weekend deploys.', { key: 'D-9102' }),
    itemDecision('m', 'No manual changes to the production database.', { key: 'D-9103' }),
    itemDecision('r', 'Checkout validation happens server-side.', { key: 'D-9104' }),
  ];
  const v = (summary) => Object.fromEntries(checkWork({ summary }, d).findings.map((f) => [f.key, f.relation]));
  assert.equal(v('Commit the database credentials to the repo for the demo')['D-9101'], 'conflict');
  assert.equal(v('Schedule the billing deploy for Sunday night')['D-9102'], 'conflict');
  assert.equal(v('Fix the duplicate rows by hand in the production database')['D-9103'], 'conflict');
  assert.notEqual(v('Add an index to the production database through a migration')['D-9103'], 'conflict');
});

// --- what the engineer's own held-out group exposed (corpus origin "agent-held-out") --------------------------------
test('parses: state changes as rejections, "are not hosting our own X", "X don\'t get Y", "only by exception", an attribution before a colon', () => {
  assert.deepEqual(parse('Billing emails go out via Postmark from now on; the Mandrill account closes in June.'), { chosen: ['Postmark'], rejected: ['Mandrill'], scope: ['Billing emails'] });
  assert.deepEqual(parse('We are not hosting our own Kafka any more. Confluent Cloud only.').rejected, ['our own Kafka']);
  assert.deepEqual(parse('We are not hosting our own Kafka any more. Confluent Cloud only.').scope, []);
  const access = parseStatement("Contractors don't get production database access.");
  assert.deepEqual([access.chosen, access.rejected, access.scope, access.negativeVerb], [[], ['production database access'], ['Contractors'], 'get']);
  assert.deepEqual(parse('We settled on Vitest; Jest suites are frozen and will be ported gradually.'), { chosen: ['Vitest'], rejected: ['Jest suites'], scope: [] });
  assert.deepEqual(parse('web team decision — bundler is Vite. webpack gets ripped out in Q2'), { chosen: ['Vite'], rejected: ['webpack'], scope: ['bundler'] });
  assert.deepEqual(parse('Standard editor is VS Code; JetBrains licences only by exception approved by IT.').rejected, ['JetBrains licences']);
  assert.deepEqual(parse('Per finance: vendor contracts are signed through DocuSign only.'), { chosen: ['DocuSign'], rejected: [], scope: ['vendor contracts'] });
});

test('a ban on running something yourself is not a ban on the thing; unit and browser test tools are different kinds', () => {
  const d = [
    itemDecision('own', 'We are not hosting our own Kafka any more. Confluent Cloud only.', { key: 'D-9201' }),
    itemDecision('unit', 'We standardised on Jest for unit tests.', { key: 'D-9202' }),
    itemDecision('e2e', 'We settled on Playwright; Selenium suites are frozen and will be ported gradually.', { key: 'D-9203' }),
    itemDecision('copy', 'Production data must not be copied to staging.', { key: 'D-9204' }),
    itemDecision('files', 'Uploads live in GCS, not S3.', { key: 'D-9205' }),
  ];
  const v = (summary) => Object.fromEntries(checkWork({ summary }, d).findings.map((f) => [f.key, f.relation]));
  assert.equal(v('Spin up a self-managed Kafka cluster on EC2 for the audit stream')['D-9201'], 'conflict');
  assert.notEqual(v('Publish order events to Kafka')['D-9201'], 'conflict');
  assert.equal(v('Write new Selenium tests for the invoicing module')['D-9203'], 'conflict', 'a product and a plain noun for what it has');
  assert.notEqual(v('Write new Selenium tests for the invoicing module')['D-9202'], 'conflict');
  assert.notEqual(v('Add Jest tests for the discount calculator')['D-9203'], 'conflict');
  assert.equal(v('Add Mocha tests for the discount calculator')['D-9202'], 'conflict');
  // A scope that only says where is met by work that goes there.
  assert.equal(v('Restore the production database snapshot into staging')['D-9204'], 'conflict');
  assert.notEqual(v('Give the summer intern read access to the production database')['D-9204'], 'conflict');
  // A verb that is also a noun still opens an instruction when a tool or a place follows.
  assert.equal(v('Store files in S3 for the importer')['D-9205'], 'conflict');
  assert.equal(analyseWork({ summary: 'Build pipeline for the mobile app' }).intent, 'title');
});
