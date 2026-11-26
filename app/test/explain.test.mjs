// Every finding has to be explainable: explain() turns the evidence the engine kept into one sentence that names
// both sides, what the work does and what the decision said. Run: node --test test/explain.test.mjs
// (service.js imports the Forge packages, so this file needs node_modules; the engine tests do not.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionsFromPage } from '../src/engine/extract.js';
import { checkWork } from '../src/engine/match.js';
import { explain } from '../src/lib/service.js';

const decision = (id, key, statement) => {
  const page = { id, title: 'Notes', url: `https://example/wiki/${id}`, createdAt: '2026-03-01', adf: { type: 'doc', content: [{ type: 'decisionList', content: [{ type: 'decisionItem', attrs: { state: 'DECIDED', localId: id }, content: [{ type: 'text', text: statement }] }] }] } };
  return { ...decisionsFromPage(page)[0], key };
};
const decisions = [
  decision('host', 'D-1', "we're moving off Heroku to Fly.io."),
  decision('css', 'D-2', 'We picked Zephyr over Quartz for the design system.'),
  decision('err', 'D-3', 'Sentry is the standard for error tracking across all apps.'),
  decision('mail', 'D-4', 'Customer emails must not be exported to spreadsheets.'),
  decision('mig', 'D-5', 'Only senior engineers can approve database migrations.'),
  decision('copy', 'D-6', 'all customer-facing copy must be reviewed by Legal before launch.'),
  decision('main', 'D-7', 'No direct commits to main; everything goes through a pull request.'),
  decision('pay', 'D-8', 'Database migrations can only be approved by senior engineers.'),
];
const byId = new Map(decisions.map((d) => [d.id, d]));
const reasons = (summary, description) => Object.fromEntries(checkWork({ summary, description }, decisions).findings.map((f) => [f.key, `${f.relation}: ${explain(f, byId.get(f.decisionId))}`]));

test('a conflict names what the work uses, the word that decided it, and the decision', () => {
  assert.equal(reasons('Deploy the new admin tool on Heroku')['D-1'], 'conflict: Uses “Heroku” (the work says “deploy”), which D-1 ruled out on 2026-03-01.');
  assert.equal(reasons('Commit the hotfix directly to main')['D-7'], 'conflict: Goes ahead with “direct commits” (the work says “commit”), which D-7 ruled out for main on 2026-03-01.');
  assert.equal(
    reasons('Export customer emails to a Google Sheet for the marketing team')['D-4'],
    'conflict: Involves exporting “Customer emails” (the work says “export”), which D-4 ruled out for spreadsheets on 2026-03-01.',
  );
  assert.equal(
    reasons('Set up Bugsnag for the mobile app crashes')['D-3'],
    'conflict: Uses “Bugsnag” (another error tracker) (the work says “set up”), but D-3 chose “Sentry” for error tracking across all apps on 2026-03-01.',
  );
  assert.equal(reasons('Launch the pricing page copy without waiting for Legal')['D-6'], 'conflict: Goes ahead without “Legal” (the work says “launch”), which D-6 requires for all customer-facing copy on 2026-03-01.');
  assert.equal(reasons('Remove Sentry from the checkout service')['D-3'], 'conflict: Removes or replaces “Sentry” (the work says “remove”), which D-3 chose for error tracking across all apps on 2026-03-01.');
});

test('a conflict without the scope words says so; an explicit other use is only related', () => {
  assert.equal(
    reasons('Rebuild the settings screens with Quartz components')['D-2'],
    "conflict: Uses “Quartz” (the work says “rebuild”), which D-2 ruled out for the design system on 2026-03-01. The work doesn't say it is outside that scope, so this is flagged with lower confidence.",
  );
  assert.equal(reasons('Use Quartz to render PDF invoices')['D-2'], 'related: Mentions “Quartz”, which D-2 ruled out for the design system; this work names a different use, so it looks outside that scope.');
});

test('a restriction names who was handed the action and who it is reserved for', () => {
  const r = reasons('Let junior developers approve database migrations to speed things up');
  assert.equal(r['D-5'], 'conflict: Lets junior developers approve database migrations, which D-5 reserves for senior engineers on 2026-03-01.');
  assert.equal(r['D-8'], 'conflict: Has Database migrations approved by junior developers, which D-8 reserves for senior engineers on 2026-03-01.');
});

test('a mention says why it is not a conflict; alignment says what the work uses or takes away', () => {
  assert.equal(reasons('Fix the flaky Heroku release phase')['D-1'], 'related: Mentions “Heroku”, which D-1 ruled out on 2026-03-01; this work maintains what is already there, so it is not flagged as a conflict.');
  assert.equal(reasons('Spike: Heroku buildpacks for the ML service')['D-1'], 'related: Mentions “Heroku”, which D-1 ruled out on 2026-03-01; this work only looks into it, so it is not flagged as a conflict.');
  assert.equal(reasons('Move the docs site to Fly.io')['D-1'], 'aligned: Uses “Fly.io”, the option D-1 chose.');
  assert.equal(reasons('Migrate the last two apps off Heroku')['D-1'], 'aligned: Removes “Heroku” (the work says “migrate”), in line with D-1.');
  assert.equal(reasons('Block direct commits to main with a branch rule')['D-7'], 'aligned: Keeps out “direct commits” (the work says “block”), in line with D-7.');
});

test('a conflict found in the description says where the instruction was', () => {
  const r = reasons('Admin tool hosting', 'The tool is tiny. Deploy it on Heroku so we can skip the platform review.');
  assert.equal(r['D-1'], 'conflict: Uses “Heroku” (the description says “deploy”), which D-1 ruled out on 2026-03-01.');
});
