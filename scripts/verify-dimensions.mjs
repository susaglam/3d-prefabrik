// Browser proof for "Maten tonen": switching the dimensions on may only ADD the thin dimension lines and the two labels.
// Reported 2026-09-19: a black slab appeared next to each label and did not follow the measurement. Cause: the GTAO pass
// renders the scene into its normal/depth G-buffer with an override material, which draws a label SPRITE as a fixed,
// unbillboarded 1.9 × 0.48 m plate; the AO then darkens around that invisible plate.
// Measured here: two screenshots of the same camera, dimensions off and on, compared pixel by pixel in the page. A pixel
// counts as DARKENED when its luma drops by more than 35. Everything the dimensions legitimately draw is light (label
// plate) or 1.3 cm thin (lines), so darkened pixels must stay a thin sliver. Exit code 1 otherwise.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const LIMIT = Number(process.env.DARK_LIMIT || 1500);  // darkened pixels allowed at 1440 × 960 (the lines and their shadows)
const out = join('docs', 'verification', 'dimensions');
await mkdir(out, {recursive: true});
const catalog = JSON.parse(await readFile('addons/cs_prefab_configurator/data/catalog.json', 'utf8'));
// PREFAB_ORIGIN=https://… checks a deployed site instead of a local server (read-only: no quote is submitted).
const server = process.env.PREFAB_ORIGIN ? null : spawn(process.platform === 'win32' ? 'python' : 'python3',
  ['scripts/serve.py', '--port', '0', '--db', join(await mkdtemp(join(tmpdir(), 'prefab-dimensions-')), 'qa.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const origin = process.env.PREFAB_ORIGIN || await new Promise((resolve, reject) => {
  let stdout = '';
  const timer = setTimeout(() => reject(new Error('Local server start timed out')), 15000);
  server.stdout.on('data', chunk => { stdout += chunk; const m = stdout.match(/running at (http:\/\/[^\s]+)\/prefab/); if (m) { clearTimeout(timer); resolve(m[1]); } });
  server.once('exit', code => reject(new Error('Server exited ' + code)));
});
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'),
  args: ['--enable-gpu', '--ignore-gpu-blocklist']});
const report = [];
let failed = false;
try {
  for (const [width, depth] of [[750, 300], [500, 300]]) {
    const context = await browser.newContext({viewport: {width: 1440, height: 960}});
    await context.addInitScript(({config, version}) => localStorage.setItem('cs-prefab-design-v1', JSON.stringify({version, config})),
      {config: {...catalog.defaults, width, depth}, version: catalog.schemaVersion});
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/prefab', {waitUntil: 'networkidle', timeout: 90000});
    await page.waitForFunction(() => window.__prefabPreview?.camera, null, {timeout: 60000});
    await page.evaluate(() => window.__prefabPreview.assetsReady);
    // The screenshot's angle: from the garden side, high, looking down at the extension and the house.
    await page.evaluate(() => { const p = window.__prefabPreview; p.controls.target.set(0, .6, .4); p.camera.position.set(6.5, 6.2, 8.5); p.controls.update(); p.render(); });
    await page.waitForTimeout(2500);
    const canvas = page.locator('canvas').first();
    const shot = async name => { await page.evaluate(() => window.__prefabPreview.render()); await page.waitForTimeout(900); const b = await canvas.screenshot({path: join(out, name)}); return b.toString('base64'); };
    const off = await shot(`${width}x${depth}-off.png`);
    await page.evaluate(() => window.__prefabPreview.setDimensions(true));
    const on = await shot(`${width}x${depth}-on.png`);
    const diff = await page.evaluate(async ([a, b]) => {
      const load = src => new Promise(resolve => { const i = new Image(); i.onload = () => resolve(i); i.src = 'data:image/png;base64,' + src; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height; const ctx = c.getContext('2d');
      ctx.drawImage(ia, 0, 0); const pa = ctx.getImageData(0, 0, c.width, c.height).data;
      ctx.drawImage(ib, 0, 0); const pb = ctx.getImageData(0, 0, c.width, c.height).data;
      const luma = (p, i) => .2126 * p[i] + .7152 * p[i + 1] + .0722 * p[i + 2];
      let darkened = 0, changed = 0; const box = {x0: 1e9, y0: 1e9, x1: -1, y1: -1};
      for (let i = 0; i < pa.length; i += 4) {
        const d = luma(pb, i) - luma(pa, i);
        if (Math.abs(d) > 12) changed++;
        if (d < -35) { darkened++; const x = (i / 4) % c.width, y = Math.floor(i / 4 / c.width); box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y); }
      }
      return {darkened, changed, darkBox: darkened ? box : null, size: [c.width, c.height]};
    }, [off, on]);
    const ok = diff.darkened <= LIMIT && !errors.length;
    failed ||= !ok;
    report.push({width, depth, ...diff, ok, errors});
    await context.close();
  }
} finally {
  await browser.close();
  server?.kill();
}
await writeFile(join(out, 'dimensions.json'), JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify(report, null, 1));
process.exit(failed ? 1 : 0);
