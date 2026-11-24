// MOBL-58: the panel header says "1 conflict"; expand it; the card; then Ask Precedent opens Rovo.
await page.setViewportSize({ width: 1600, height: 900 });
await page.goto('https://one-atlas-rsvn.atlassian.net/browse/MOBL-58', { waitUntil: 'domcontentloaded' });
const header = page.locator('[role=button][aria-expanded]').filter({ hasText: /^Precedent/ }).first();
await header.waitFor({ timeout: 45000 });
await sleep(4000); // the panel restores its expanded state a moment after the header appears
for (let i = 0; i < 3 && (await header.getAttribute('aria-expanded')) === 'true'; i++) {
  await header.click();
  await sleep(1500);
}
await page.getByText('1 conflict', { exact: true }).first().waitFor({ timeout: 45000 });
await page.evaluate(() => document.querySelectorAll('*').forEach((e) => { if (e.scrollTop > 0) e.scrollTop = 0; }));
await installCursor();
await page.mouse.move(820, 300);
mx = 820;
my = 300;
await sleep(1500);

const rec = await startRecording('jira');
await rec.mark('issue');
await sleep(2500);
await smoothScrollTo(header, 260, 1600);
await sleep(300);
await rec.mark('lozenge');
await moveTo(page.getByText('1 conflict', { exact: true }).first(), 900);
await sleep(1800);
await rec.mark('expand');
await clickOn(header, 500);
await page.getByText(/possible conflict with past decisions/).first().waitFor({ timeout: 45000 });
await sleep(600);
await smoothScrollTo(page.getByText(/possible conflict with past decisions/).first(), 120, 1000);
await rec.mark('card');
await moveTo(page.getByText(/Second factor for customer sign-in/).first(), 900);
await sleep(2200);
await moveTo(page.getByText(/^Why it was decided/).first(), 800);
await sleep(2200);
await rec.mark('owner');
await moveTo(page.getByText('Open decision').first(), 800);
await sleep(2400);
await rec.mark('ask');
await clickOn(page.getByRole('button', { name: 'Ask Precedent' }).first(), 900);
await rec.mark('rovo-open');
await sleep(4000);
await waitForStableText('body', 4000, 100000);
await rec.mark('rovo-answer');
await sleep(4000);
const frames = await rec.stop();
return { frames };
