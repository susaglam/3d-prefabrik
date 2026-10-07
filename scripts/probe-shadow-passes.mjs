// Diagnostic (2.18.0): who renders, and who flags the shadow map, during ONE structural preview.update()? Prints the
// call stack of every render() and every shadow pass. Usage: node scripts/probe-shadow-passes.mjs
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const server = spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(await mkdtemp(join(tmpdir(), 'prefab-probe-')), 'p.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const origin = await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'), args: ['--enable-gpu', '--ignore-gpu-blocklist']});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  await page.goto(`${origin}/prefab`, {waitUntil: 'networkidle', timeout: 90000});
  await page.waitForFunction(() => window.__prefabPreview?.renderer);
  await page.evaluate(() => window.__prefabPreview.assetsReady);
  await page.waitForTimeout(1500);
  const report = await page.evaluate(() => {
    const p = window.__prefabPreview, log = [], original = p.render.bind(p);
    p.render = function () {
      const dirty = this.shadowsDirty, before = this.shadowPasses;
      original();
      log.push({dirtyOnEntry: dirty, pass: this.shadowPasses - before, stack: new Error().stack.split('\n').slice(2, 7).map(s => s.trim()).join(' <- ')});
    };
    const start = p.shadowPasses;
    p.update({...p.config, width: p.config.width + 10});
    const delta = p.shadowPasses - start;
    p.render = original;
    return {delta, cameraFocus: !!p.cameraFocus, cameraTouched: p.cameraTouched, view: p.view, log};
  });
  console.log(JSON.stringify(report, null, 1));
} finally { await browser.close(); server.kill(); }
