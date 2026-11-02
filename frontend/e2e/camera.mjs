/**
 * Camera (QR scanner) test in a real Chromium against a running, seeded stack. Chromium's fake camera plays a
 * .y4m video of a QR code, so html5-qrcode decodes it exactly as it would from a webcam.
 *
 * Usage:
 *   CAM_SKU_VIDEO=sku.y4m CAM_DNA_VIDEO=dna.y4m DNA_CODE=DNA-... npm run e2e:camera [-- <screenshot-dir>]
 * Make the videos from QR images (see docs/CAMERA_TEST.md):
 *   ffmpeg -loop 1 -i qr.png -t 6 -vf "scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2:white" -pix_fmt yuv420p -r 10 qr.y4m
 */
import fs from 'fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const shots = process.argv[2] ?? 'e2e/screenshots';
const { CAM_SKU_VIDEO, CAM_DNA_VIDEO, DNA_CODE } = process.env;
if (!CAM_SKU_VIDEO || !CAM_DNA_VIDEO || !DNA_CODE) {
  console.error('Set CAM_SKU_VIDEO, CAM_DNA_VIDEO and DNA_CODE');
  process.exit(2);
}
fs.mkdirSync(shots, { recursive: true });
const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const results = [];
const problems = [];

/** A browser whose camera is the given video (or no camera / permission denied). */
async function browserWith({ video, deny = false, noCamera = false }) {
  const args = [];
  if (!noCamera) args.push('--use-fake-device-for-media-stream');
  if (video) args.push(`--use-file-for-fake-video-capture=${video}`);
  if (!deny) args.push('--use-fake-ui-for-media-stream');
  else args.push('--deny-permission-prompts');
  return chromium.launch({ ...exe, args });
}

async function login(browser, email, { grant = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, permissions: grant ? ['camera'] : [] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => r.url().includes('/api/') && r.status() >= 500 && problems.push(`${r.status()} ${r.url()}`));
  await page.goto(`${BASE}/login`);
  await page.fill('#login-email', email);
  await page.fill('#login-password', 'Password123!');
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/`);
  return { ctx, page };
}

async function check(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, detail });
    console.log(`✔ ${name}${detail ? ` - ${detail}` : ''} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, detail: e.message });
    console.log(`✘ ${name} - ${e.message.split('\n')[0]}`);
  }
}

// 1-2. Product QR on the Scan page: camera starts, decodes the SKU, then scan-to-act dispatches by FEFO
{
  const browser = await browserWith({ video: CAM_SKU_VIDEO });
  const { ctx, page } = await login(browser, 'staff@example.com');
  await check('Scan page: camera starts and shows the live video', async () => {
    await page.goto(`${BASE}/scan`);
    await page.click('button:has-text("Start camera")');
    await page.locator('.scanner-view video').waitFor({ timeout: 15000 });
    await page.locator('button:has-text("Stop camera")').waitFor();
    // wait for the first decoded frame of the camera stream
    await page.waitForFunction(() => {
      const v = document.querySelector('.scanner-view video');
      return !!v && v.readyState >= 2 && v.videoWidth > 0 && !v.paused;
    }, null, { timeout: 15000 });
    return `video ${await page.locator('.scanner-view video').evaluate((v) => `${v.videoWidth}x${v.videoHeight}`)}`;
  });
  await check('Scan page: product QR decoded from the camera (SKU-BAT-004)', async () => {
    await page.getByText('Li-ion Battery Pack').first().waitFor({ timeout: 20000 });
    await page.screenshot({ path: `${shots}/camera_scan_product.png`, fullPage: true });
    const sku = await page.inputValue('#scan-sku');
    if (sku !== 'SKU-BAT-004') throw new Error(`SKU field shows "${sku}"`);
    return 'product card and stock table shown';
  });
  await check('Scan page: scan-to-act dispatches 1 unit by FEFO', async () => {
    await page.fill('#sc-qty', '1');
    await page.click('form button[type=submit]:has-text("Dispatch")');
    await page.getByText(/Dispatched 1:/).first().waitFor({ timeout: 15000 });
    return (await page.getByText(/Dispatched 1:/).first().innerText()).trim();
  });
  await check('Scan page: Stop camera releases the camera', async () => {
    await page.click('button:has-text("Stop camera")');
    await page.locator('button:has-text("Start camera")').waitFor();
    if (await page.locator('.scanner-view video').count()) throw new Error('video element still present');
  });
  await ctx.close();
  await browser.close();
}

// 3-4. A Stock DNA label: from the Scan page and from the Stock DNA page's "Scan label" dialog
{
  const browser = await browserWith({ video: CAM_DNA_VIDEO });
  const { ctx, page } = await login(browser, 'admin@example.com');
  await check('Scan page: DNA label decoded from the camera opens the lot', async () => {
    await page.goto(`${BASE}/scan`);
    await page.click('button:has-text("Start camera")');
    await page.waitForURL(/\/dna\/[0-9a-f]{24}$/, { timeout: 20000 });
    await page.locator('h1', { hasText: DNA_CODE }).waitFor();
    await page.screenshot({ path: `${shots}/camera_scan_dna.png` });
    return `${DNA_CODE} -> ${new URL(page.url()).pathname}`;
  });
  await check('Stock DNA page: "Scan label" dialog decodes the label and opens the lot', async () => {
    await page.goto(`${BASE}/dna`);
    await page.click('button:has-text("Scan label")');
    await page.locator('.modal button:has-text("Start camera")').click();
    await page.waitForURL(/\/dna\/[0-9a-f]{24}$/, { timeout: 20000 });
    await page.locator('h1', { hasText: DNA_CODE }).waitFor();
    return 'lot page opened';
  });
  await ctx.close();
  await browser.close();
}

// 5. Camera permission denied: clear message, manual entry still works
{
  const browser = await browserWith({ video: CAM_SKU_VIDEO, deny: true });
  const { ctx, page } = await login(browser, 'staff@example.com', { grant: false });
  await check('Permission denied: friendly message and manual SKU still works', async () => {
    await page.goto(`${BASE}/scan`);
    await page.click('button:has-text("Start camera")');
    const msg = page.locator('.scanner [role=alert]');
    await msg.waitFor({ timeout: 15000 });
    const text = await msg.innerText();
    if (!/denied/i.test(text)) throw new Error(`unexpected message: ${text}`);
    await page.fill('#scan-sku', 'SKU-BAT-004');
    await page.click('button:has-text("Resolve")');
    await page.getByText('Li-ion Battery Pack').first().waitFor();
    return text.trim();
  });
  await ctx.close();
  await browser.close();
}

// 6. No camera on the device
{
  const browser = await browserWith({ noCamera: true });
  const { ctx, page } = await login(browser, 'staff@example.com');
  await check('No camera: friendly message instead of a crash', async () => {
    await page.goto(`${BASE}/scan`);
    await page.click('button:has-text("Start camera")');
    const msg = page.locator('.scanner [role=alert]');
    await msg.waitFor({ timeout: 15000 });
    await page.screenshot({ path: `${shots}/camera_none.png` });
    return (await msg.innerText()).trim();
  });
  await ctx.close();
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} camera checks passed`);
console.log('PROBLEMS:\n' + (problems.join('\n') || 'none'));
process.exit(failed.length || problems.length ? 1 : 0);
