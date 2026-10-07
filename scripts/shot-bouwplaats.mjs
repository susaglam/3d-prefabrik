// Screenshots of step 3 with the "Bouwplaats" postcode card and of the price breakdown with the kilometervergoeding
// (2.18.0), at a phone and a desktop width. Writes docs/verification/km/*.png. Usage: node scripts/shot-bouwplaats.mjs
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const out = join('docs', 'verification', 'km');
await mkdir(out, {recursive: true});
const server = spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(await mkdtemp(join(tmpdir(), 'prefab-km-')), 'k.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const origin = await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe')});
const report = [];
try {
  for (const [name, viewport] of [['phone', {width: 390, height: 844}], ['desktop', {width: 1440, height: 900}]]) {
    const page = await browser.newPage({viewport});
    await page.goto(`${origin}/prefab`, {waitUntil: 'networkidle', timeout: 90000});
    await page.waitForSelector('#panel-content');
    // Step 3 through the step navigation, the way a visitor gets there.
    const tab = page.locator('[data-step="2"], button:has-text("Situatie")').first();
    await tab.click();
    await page.waitForSelector('[data-group="bouwplaats"]', {timeout: 15000});
    await page.evaluate(() => { const card = document.querySelector('[data-group="bouwplaats"]'); if (!card.open) card.querySelector(':scope > summary').click(); });
    await page.waitForSelector('#postcode', {state: 'visible', timeout: 15000});
    await page.screenshot({path: join(out, `${name}-step3-empty.png`)});
    await page.fill('#postcode', '9711lm');
    await page.locator('#postcode').blur();
    await page.waitForTimeout(2500);
    const value = await page.inputValue('#postcode');
    await page.screenshot({path: join(out, `${name}-step3-groningen.png`)});
    await page.fill('#postcode', '12');
    await page.locator('#postcode').blur();
    await page.waitForTimeout(400);
    const error = await page.textContent('#postcode-error');
    await page.fill('#postcode', '9711 LM');
    await page.locator('#postcode').blur();
    await page.waitForTimeout(2500);
    await page.locator('[data-action="pricing"]').first().click();
    await page.waitForTimeout(800);
    const lines = await page.locator('.breakdown-list > div').allTextContents();
    await page.screenshot({path: join(out, `${name}-breakdown.png`)});
    report.push({name, normalised: value, error, travel: lines.find(line => line.includes('Kilometervergoeding')) || null});
    await page.close();
  }
} finally { await browser.close(); server.kill(); }
console.log(JSON.stringify(report, null, 1));
