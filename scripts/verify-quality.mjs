// Browser proof for Weergave → Kwaliteit (2026-09-19): the chips exist, a click really switches the render tier
// (composer/AO on or off, 512 px scans downloaded for Snel), the choice survives a reload on this device only, and
// Automatisch hands the decision back to the device measurement. Exit code 1 on any failed expectation.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const out = join('docs', 'verification', 'quality');
await mkdir(out, {recursive: true});
const server = process.env.PREFAB_ORIGIN ? null : spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(await mkdtemp(join(tmpdir(), 'prefab-quality-')), 'q.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const origin = process.env.PREFAB_ORIGIN || await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'), args: ['--enable-gpu', '--ignore-gpu-blocklist']});
const steps = [], problems = [];
const expect = (label, ok, detail) => { steps.push({label, ok, ...detail}); if (!ok) problems.push(label); };
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const scans = []; page.on('request', r => { if (r.url().includes('/assets/materials/')) scans.push(r.url().split('/').pop()); });
  const state = () => page.evaluate(() => ({quality: window.__prefabPreview.quality, composer: !!window.__prefabPreview.composer,
    active: [...document.querySelectorAll('[data-action="render-quality"]')].filter(b => b.classList.contains('active')).map(b => b.dataset.renderQuality)}));
  const open = async () => { await page.goto(origin + '/prefab', {waitUntil: 'networkidle', timeout: 90000}); await page.waitForFunction(() => window.__prefabPreview?.renderer); await page.evaluate(() => window.__prefabPreview.assetsReady); };
  // Since 2.10.7 Weergave is a dialog; the picture is only screenshotted with it closed (conceal).
  const reveal = async () => { const strip = page.locator('[data-action="view-strip"]'); if (await strip.getAttribute('aria-expanded') !== 'true') await strip.click(); };
  const conceal = async () => { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#modal').open); };
  await open(); await reveal();
  let s = await state();
  expect('three quality chips, Automatisch active, full tier on a desktop', (await page.locator('[data-action="render-quality"]').count()) === 3 && s.active.join() === 'auto' && s.quality === 'full' && s.composer, s);
  scans.length = 0;
  await page.click('[data-action="render-quality"][data-render-quality="compact"]');
  await page.evaluate(() => window.__prefabPreview.assetsReady); await page.waitForTimeout(600);
  s = await state();
  expect('Snel: compact tier, no AO composer, 512 px scans loaded', s.quality === 'compact' && !s.composer && s.active.join() === 'compact' && scans.some(n => n.split('?')[0].endsWith('_512.jpg')), {...s, scans: scans.length});
  // On a fast computer the two tiers look almost alike, so the click must say what it did (2026-09-19).
  const told = await page.evaluate(() => ({toast: document.querySelector('#toast')?.textContent || '', visible: !!document.querySelector('#toast.visible'),
    title: document.querySelector('[data-render-quality="compact"]')?.getAttribute('title') || ''}));
  expect('Snel says what it did: a visible toast and an explanatory title', told.visible && /Snelle weergave staat aan/.test(told.toast) && /oudere computers/.test(told.title), told);
  await conceal(); await page.locator('canvas').first().screenshot({path: join(out, 'snel.png')});
  await open(); await reveal();
  s = await state();
  expect('the choice survives a reload on this device', s.quality === 'compact' && s.active.join() === 'compact', s);
  await page.click('[data-action="render-quality"][data-render-quality="full"]');
  await page.evaluate(() => window.__prefabPreview.assetsReady); await page.waitForTimeout(600);
  s = await state();
  expect('Hoog: full tier with the AO composer back', s.quality === 'full' && s.composer && s.active.join() === 'full', s);
  await conceal(); await page.locator('canvas').first().screenshot({path: join(out, 'hoog.png')});
  await reveal();
  await page.click('[data-action="render-quality"][data-render-quality="auto"]');
  await page.waitForTimeout(300);
  s = await state();
  expect('Automatisch: the device decides again (full on this desktop)', s.quality === 'full' && s.active.join() === 'auto', s);
  expect('no page errors', errors.length === 0, {errors});
} finally { await browser.close(); server?.kill(); }
await writeFile(join(out, 'quality.json'), JSON.stringify({steps, problems}, null, 1) + '\n');
console.log(JSON.stringify({steps, problems}, null, 1));
process.exit(problems.length ? 1 : 0);
