// MOBL-58: the team decides to reverse ADR-007 from the story itself. Record a decision, see what Precedent
// understood, pick "Reverses an earlier decision", save: the conflict clears and the story is now in line.
// Afterwards delete the "Decision:" comment (tools/atl.mjs) so the demo site returns to its seeded state.
await page.setViewportSize({ width: 1600, height: 900 });
await page.goto('https://one-atlas-rsvn.atlassian.net/browse/MOBL-58', { waitUntil: 'domcontentloaded' });
const header = page.locator('[role=button][aria-expanded]').filter({ hasText: /^Precedent/ }).first();
await header.waitFor({ timeout: 45000 });
await sleep(4000);
for (let i = 0; i < 3 && (await header.getAttribute('aria-expanded')) === 'false'; i++) {
  await header.click();
  await sleep(1500);
}
await page.getByText(/possible conflict with past decisions/).first().waitFor({ timeout: 45000 });
await page.evaluate(() => document.querySelectorAll('*').forEach((e) => { if (e.scrollTop > 0) e.scrollTop = 0; }));
await smoothScrollTo(page.getByText(/possible conflict with past decisions/).first(), 110, 10);
await installCursor();
await page.mouse.move(820, 300);
mx = 820;
my = 300;
await sleep(1500);

const rec = await startRecording('reverse');
await rec.mark('card');
await sleep(1200);
await moveTo(page.getByText(/Second factor for customer sign-in/).first(), 900);
await sleep(1600);
const recordBtn = page.getByRole('button', { name: /Record a decision/ }).first();
await smoothScrollTo(recordBtn, 520, 900);
await sleep(300);
await rec.mark('open-form');
await clickOn(recordBtn, 800);
const statement = page.locator('textarea[id*="precedent-statement"]').first();
await statement.waitFor({ timeout: 20000 });
await smoothScrollTo(statement, 200, 900);
await clickOn(statement, 600);
await rec.mark('type');
await statement.pressSequentially('Allow SMS one-time passcodes as a 2FA fallback for customers without a smartphone', { delay: 38 });
await sleep(900);
const why = page.locator('input[id*="precedent-rationale"]').first();
await clickOn(why, 600);
await why.pressSequentially('locked-out customers are flooding support', { delay: 38 });
await sleep(1200);
await rec.mark('supersede');
const sel = page.locator('input[id*="precedent-supersedes"]').first();
await clickOn(sel, 700);
await sleep(700);
await clickOn(page.getByRole('option', { name: /ADR-007/ }).first(), 600);
await sleep(900);
await rec.mark('preview');
await moveTo(page.getByText(/Precedent will read this as/).first(), 800);
await sleep(2600);
await moveTo(page.getByText(/will be marked superseded/).first(), 700);
await sleep(1800);
await rec.mark('record');
await clickOn(page.getByRole('button', { name: /Record on MOBL-58/ }).first(), 800);
await page.getByText('Decision recorded').first().waitFor({ timeout: 60000 });
await sleep(1200);
await rec.mark('recorded');
await smoothScrollTo(page.getByText('Decision recorded').first(), 120, 900);
await sleep(1500);
await moveTo(page.getByText(/In line with/).first(), 900);
await sleep(2500);
await rec.mark('aligned');
await sleep(2500);
const frames = await rec.stop();
return { frames };
