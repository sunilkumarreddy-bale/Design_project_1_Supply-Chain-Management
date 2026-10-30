/**
 * Browser workflow test against a running, freshly seeded stack (npm run seed, API on :4000, Vite on :5173).
 * Usage: npm run e2e [-- <screenshot-dir>]   Set E2E_BASE to test another URL and CHROMIUM_PATH for a custom browser.
 */
import fs from 'fs';
import { chromium } from 'playwright';
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const shots = process.argv[2] ?? 'e2e/screenshots';
fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const problems = [];
async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${email} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`${email} console: ${m.text()}`));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`${email} ${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('#login-email', email);
  await page.fill('#login-password', 'Password123!');
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/`);
  return { ctx, page };
}
const step = (s) => console.log('✔', s);
const sel = async (page, id, label) => page.selectOption(id, { label });
const text = (page, t) => page.getByText(t, { exact: false }).first().waitFor({ timeout: 15000 });

// --- staff: receive, dispatch (FEFO), cycle count ---
{
  const { ctx, page } = await session('staff@example.com');
  await page.goto(`${BASE}/stock`);
  await page.selectOption('#rc-product', { label: 'SKU-BAT-004 · Li-ion Battery Pack' });
  await page.fill('#rc-qty', '10');
  await page.fill('#rc-batch', 'BAT-NEW');
  await page.fill('#rc-exp', '2027-06-30');
  await page.click('text=Receive stock');
  await text(page, 'Received 10');
  step('staff received stock');
  await page.click('role=tab[name="Dispatch"]');
  await page.selectOption('#dp-product', { label: 'SKU-BAT-004 · Li-ion Battery Pack' });
  await page.fill('#dp-qty', '35');
  await page.click('button:has-text("Dispatch stock")');
  await text(page, 'FEFO allocations');
  const alloc = await page.locator('.banner-info').innerText();
  console.log('   ', alloc.replace(/\n/g, ' | '));
  await page.screenshot({ path: `${shots}/flow_dispatch.png` });
  step('staff dispatched with FEFO');
  await page.goto(`${BASE}/counts`);
  await page.click('button:has-text("New count")');
  await page.locator('input[id^="cq-"]').first().waitFor();
  const inputs = await page.locator('input[id^="cq-"]').count();
  for (let i = 0; i < inputs; i++) {
    const inp = page.locator('input[id^="cq-"]').nth(i);
    const sys = await inp.locator('xpath=../preceding-sibling::td[1]').innerText();
    await inp.fill(String(Number(sys.replace(/,/g, '')) - (i === 0 ? 2 : 0)));
  }
  await page.locator('input[id^="cr-"]').first().fill('damaged');
  await page.click('button:has-text("Submit")');
  await text(page, 'line(s) with variance');
  step('staff created and submitted cycle count');
  await ctx.close();
}
// --- manager: reconcile, auto-draft, recovery analyze + propose, redistribution propose ---
{
  const { ctx, page } = await session('manager@example.com');
  await page.goto(`${BASE}/counts`);
  await page.locator('button:has-text("Open")').first().click();
  await page.click('button:has-text("Reconcile")');
  await text(page, 'Reconciled');
  step('manager reconciled count');
  await page.goto(`${BASE}/purchase-orders`);
  await page.click('text=Auto-draft from reorder points');
  await page.click('form button[type=submit]:has-text("Auto-draft")');
  await page.locator('text=Drafted POs').waitFor();
  await page.screenshot({ path: `${shots}/flow_autodraft.png`, fullPage: true });
  console.log('   ', (await page.locator('.grid.grid-3').innerText()).replace(/\n/g, ' | ').slice(0, 400));
  step('manager auto-drafted');
  await page.goto(`${BASE}/suppliers`);
  await page.locator('tr', { hasText: 'Acme Components' }).locator('button:has-text("Declare disruption")').click();
  await page.fill('#dis-reason', 'Fire');
  await page.click('button:has-text("Declare disruption") >> nth=-1');
  await page.click('.modal >> text=Run recovery');
  await page.waitForURL(/recovery/);
  await page.selectOption('#rc-product', { label: 'SKU-CMP-010 · Critical Component X' });
  await page.click('button:has-text("Analyze")');
  await text(page, 'Transfer 200 units from Warehouse B');
  await page.screenshot({ path: `${shots}/flow_recovery.png`, fullPage: true });
  await page.locator('.option-card.rank-1 button:has-text("Propose this plan")').click();
  await page.waitForURL(/recovery\/[0-9a-f]{24}/);
  step('manager proposed recovery plan (Example A)');
  await page.goto(`${BASE}/redistribution`);
  await page.click('text=Scan all batches');
  await page.locator('tr', { hasText: 'MLK-A-001' }).locator('button:has-text("Analyze")').click();
  await text(page, '120/day x 4 - 100 existing = 380');
  await page.screenshot({ path: `${shots}/flow_redistribution.png`, fullPage: true });
  await page.click('button:has-text("Propose plan")');
  await text(page, 'proposed');
  step('manager proposed redistribution (Example B)');
  await ctx.close();
}
// --- admin: approve plans, simulator, audit verify, reports ---
{
  const { ctx, page } = await session('admin@example.com');
  await page.goto(`${BASE}/recovery`);
  await page.locator('a:has-text("Open")').first().click();
  await page.click('button:has-text("Approve")');
  await text(page, 'Created 1 transfer(s) and 1 purchase order(s)');
  await page.screenshot({ path: `${shots}/flow_recovery_plan.png`, fullPage: true });
  step('admin approved recovery plan');
  await page.goto(`${BASE}/redistribution`);
  await page.locator('tr', { hasText: 'proposed' }).locator('button:has-text("Approve")').first().click();
  await text(page, 'transfers created');
  step('admin approved redistribution plan');
  await page.goto(`${BASE}/transfers`);
  for (let i = 0; i < 2; i++) {
    await page.locator('button:has-text("Dispatch")').first().click();
    await text(page, 'Transfer dispatched');
    await page.waitForTimeout(400);
  }
  for (let i = 0; i < 2; i++) {
    await page.locator('tbody button:has-text("Receive")').first().click();
    await page.waitForTimeout(800);
  }
  step('admin dispatched and received transfers');
  await page.goto(`${BASE}/simulator`);
  await page.selectOption('#sim-supplier', { label: 'Acme Components (disrupted)' });
  await page.click('button:has-text("Run simulation")');
  await text(page, 'Strategy comparison');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${shots}/flow_simulator.png`, fullPage: true });
  step('admin ran simulation');
  await page.goto(`${BASE}/audit`);
  await page.click('button:has-text("Verify integrity")');
  await text(page, 'Chain intact');
  console.log('   ', await page.locator('.banner-success').first().innerText());
  step('audit chain verified');
  await page.goto(`${BASE}/reports`);
  const dl = page.waitForEvent('download');
  await page.click('button:has-text("Stock PDF")');
  console.log('    downloaded', (await dl).suggestedFilename());
  step('report download');
  await page.goto(`${BASE}/purchase-orders`);
  await page.locator('tr', { hasText: 'Pending approval' }).first().locator('button:has-text("Why?")').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}/flow_why.png` });
  step('PO why modal');
  await ctx.close();
}
// --- Stock DNA: the milk lot from born to death, label, certificate, integrity, recall trace ---
{
  const { ctx, page } = await session('admin@example.com');
  await page.goto(`${BASE}/dna`);
  await page.locator('.chip-btn', { hasText: 'Dead' }).click();
  await page.fill('#dna-q', 'MLK-DNA-001');
  await page.locator('a.mono', { hasText: 'DNA-SKU-MLK-020' }).first().click();
  await text(page, 'Lifeline');
  await page.locator('.gene-death').waitFor();
  const genes = await page.locator('.lifeline .gene').count();
  console.log(`    milk lot shows ${genes} genes from Born to Death`);
  await page.screenshot({ path: `${shots}/flow_dna_milk.png`, fullPage: true });
  step('milk lot lifeline born -> death');
  await page.click('button:has-text("Verify integrity")');
  await text(page, 'Verified');
  step('lot integrity verified');
  const cert = page.waitForEvent('download');
  await page.click('button:has-text("Download certificate")');
  console.log('    downloaded', (await cert).suggestedFilename());
  step('life certificate download');
  await page.click('a:has-text("Print label")');
  await page.locator('.label-sheet svg').waitFor();
  await page.screenshot({ path: `${shots}/flow_dna_label.png` });
  step('label page with QR');
  await page.goto(`${BASE}/dna/recall-trace`);
  await page.fill('#rt-batch', 'BOX-RC-01');
  await page.click('button:has-text("Run trace")');
  await text(page, 'Where it went');
  console.log('   ', (await page.locator('.stats').first().innerText()).replace(/\n+/g, ' | '));
  await page.screenshot({ path: `${shots}/flow_dna_recall.png`, fullPage: true });
  step('recall trace on the recalled lot');
  await page.goto(`${BASE}/`);
  await text(page, 'Alive lots');
  step('dashboard DNA cards');
  await ctx.close();
}
await browser.close();
console.log('PROBLEMS:\n' + (problems.join('\n') || 'none'));
process.exit(problems.length ? 1 : 0);
