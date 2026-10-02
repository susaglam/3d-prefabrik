// The one-choice-per-screen flow (2.16.0): the panel as the visitor meets it, the cards of a step, and the named
// back button. Writes docs/verification/flow/*.png and flow.json (the card titles the walk produced).
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const out = join('docs', 'verification', 'flow');
await mkdir(out, {recursive: true});
const server = process.env.PREFAB_ORIGIN ? null : spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(await mkdtemp(join(tmpdir(), 'prefab-flow-')), 'f.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const origin = process.env.PREFAB_ORIGIN || await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'), args: ['--enable-gpu', '--ignore-gpu-blocklist']});
const report = [];
try {
  for (const viewport of [{width: 1440, height: 900}, {width: 390, height: 844}]) {
    const tag = `${viewport.width}x${viewport.height}`;
    const page = await browser.newPage({viewport});
    await page.goto(origin + '/prefab', {waitUntil: 'networkidle', timeout: 90000});
    await page.waitForFunction(() => window.__prefabPreview?.renderer);
    await page.waitForTimeout(800);
    const cards = await page.evaluate(() => [...document.querySelectorAll('details.choice-group')].map(node => ({
      title: node.querySelector(':scope > summary .section-title, :scope > summary')?.textContent?.trim().split('\n')[0] || '',
      id: node.dataset.group, open: node.open,
    })));
    const open = () => page.evaluate(() => {
      const node = document.querySelector('details.choice-group[open]');
      const fields = node ? [...node.querySelectorAll('[data-field]')].map(f => f.dataset.field) : [];
      const back = document.querySelector('.back-button');
      return {card: node?.dataset.group || null, fields, back: back?.textContent?.trim() || null, next: document.querySelector('.step-actions .button:last-child')?.textContent?.trim() || null};
    });
    const first = await open();
    await page.screenshot({path: join(out, `panel-${tag}.png`)});
    // Walk three choices with the primary button, then read what "back" offers.
    const walk = [];
    for (let i = 0; i < 3; i++) {
      await page.click('.step-actions .button:last-child');
      await page.waitForTimeout(450);
      walk.push(await open());
    }
    await page.screenshot({path: join(out, `third-choice-${tag}.png`)});
    report.push({viewport: tag, cards: cards.map(card => card.id), first, walk});
    await page.close();
  }
} finally { await browser.close(); server?.kill(); }
await writeFile(join(out, 'flow.json'), JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify(report, null, 1));
