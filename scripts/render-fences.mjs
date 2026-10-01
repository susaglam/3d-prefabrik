// The garden boundary styles (2.12.0), each seen from the opening camera (garden, right) and square on, with the count
// of panels that stepped aside for the camera. Writes docs/verification/fences/*.png and fences.json.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const out = join('docs', 'verification', 'fences');
await mkdir(out, {recursive: true});
const server = process.env.PREFAB_ORIGIN ? null : spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(await mkdtemp(join(tmpdir(), 'prefab-fences-')), 'f.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const origin = process.env.PREFAB_ORIGIN || await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'), args: ['--enable-gpu', '--ignore-gpu-blocklist']});
const rows = [];
try {
  for (const style of ['modern', 'hedge', 'classic']) {
    for (const houseType of ['terraced', 'semi']) {
      const page = await browser.newPage({viewport: {width: 1440, height: 900}});
      await page.addInitScript(([s, h]) => localStorage.setItem('cs-prefab-environment-v1', JSON.stringify({fenceStyle: s, houseType: h})), [style, houseType]);
      await page.goto(origin + '/prefab', {waitUntil: 'networkidle', timeout: 90000});
      await page.waitForFunction(() => window.__prefabPreview?.renderer);
      await page.evaluate(() => window.__prefabPreview.assetsReady);
      await page.waitForTimeout(800);
      const state = () => page.evaluate(() => { const p = window.__prefabPreview; return {panels: p.fencePanels?.length || 0, hidden: (p.fencePanels || []).filter(n => !n.visible).length, style: p.environment.fenceStyle}; });
      const right = await state();
      await page.locator('.preview-card').screenshot({path: join(out, `${style}-${houseType}-right.png`)});
      await page.evaluate(() => window.__prefabPreview.setView('front'));
      await page.waitForTimeout(500);
      const front = await state();
      await page.locator('.preview-card').screenshot({path: join(out, `${style}-${houseType}-front.png`)});
      rows.push({style, houseType, panels: right.panels, hiddenFromRight: right.hidden, hiddenSquareOn: front.hidden, drawn: right.style});
      await page.close();
    }
  }
} finally { await browser.close(); server?.kill(); }
await writeFile(join(out, 'fences.json'), JSON.stringify(rows, null, 1) + '\n');
console.table(rows);
