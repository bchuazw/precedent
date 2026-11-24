// Decision register: the table, a search, then the Work at risk tab.
await page.setViewportSize({ width: 1600, height: 900 });
await page.goto('https://one-atlas-rsvn.atlassian.net/jira/apps/d93cb16f-78d7-4259-aadd-e989600915f0/7c5501a2-161e-493a-971f-94b3f68f19a4', { waitUntil: 'domcontentloaded' });
await page.getByText(/of \d+ decisions/).first().waitFor({ timeout: 90000 });
await page.getByRole('tab', { name: /Work at risk \(\d+\)/ }).first().waitFor({ timeout: 90000 }).catch(() => {});
await sleep(1500);
await installCursor();
await page.mouse.move(900, 500);
mx = 900;
my = 500;
await sleep(1000);

const rec = await startRecording('register');
await rec.mark('table');
await sleep(2200);
await moveTo(page.getByText(/ADR-007 · Second factor/).first(), 1200);
await sleep(2000);
await rec.mark('search');
const box = page.getByPlaceholder(/Search decisions/).first();
await clickOn(box, 900);
await sleep(300);
for (const ch of 'MongoDB') {
  await page.keyboard.type(ch);
  await sleep(110);
}
await sleep(2600);
await page.keyboard.press('Control+A');
await page.keyboard.press('Backspace');
await sleep(800);
await rec.mark('risk');
await clickOn(page.getByRole('tab', { name: /Work at risk/ }).first(), 1000);
await page.getByText(/conflicts? in the \d+ most recently updated/).first().waitFor({ timeout: 60000 });
await sleep(1500);
await rec.mark('risk-table');
await moveTo(page.getByText('MOBL-63').first(), 900);
await sleep(1200);
await moveTo(page.getByText('MOBL-58').first(), 900);
await sleep(2500);
await rec.mark('end');
const frames = await rec.stop();
return { frames };
