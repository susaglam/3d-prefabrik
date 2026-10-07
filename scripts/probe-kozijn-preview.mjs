// Diagnostic (2.18.0): the openness timeline after a kozijn is chosen in the form, and who calls previewKozijn.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const catalog = JSON.parse(await readFile('addons/cs_prefab_configurator/data/catalog.json', 'utf8'));
const server = spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(await mkdtemp(join(tmpdir(), 'prefab-probe-')), 'p.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const origin = await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe')});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  await page.addInitScript(({config, version}) => localStorage.setItem('cs-prefab-design-v1', JSON.stringify({version, config})), {config: {...catalog.defaults, width: 600, depth: 300, frontOpening: 'none'}, version: catalog.schemaVersion});
  await page.goto(`${origin}/prefab`, {waitUntil: 'networkidle', timeout: 90000});
  await page.waitForFunction(() => window.__prefabPreview?.renderer);
  await page.evaluate(() => window.__prefabPreview.assetsReady);
  await page.evaluate(() => {
    const p = window.__prefabPreview, t0 = performance.now(); p.__log = [];
    for (const name of ['previewKozijn', 'setKozijnOpen', 'makeOpening', 'stopKozijnMotion']) {
      const original = p[name].bind(p);
      p[name] = function (...args) { p.__log.push({t: Math.round(performance.now() - t0), call: name, args: JSON.stringify(args.map(a => typeof a === 'object' && a ? Object.keys(a) : a)), stack: new Error().stack.split('\n').slice(2, 4).map(s => s.trim()).join(' <- ')}); return original(...args); };
    }
    const tick = () => { p.__log.push({t: Math.round(performance.now() - t0), openness: +(p.kozijnOpenness || 0).toFixed(3)}); if (performance.now() - t0 < 7000) setTimeout(tick, 250); };
    tick();
    const input = document.querySelector('input[name="frontOpening"][value="french-white"]');
    input.checked = true; input.dispatchEvent(new Event('change', {bubbles: true}));
  });
  await new Promise(resolve => setTimeout(resolve, 7500));
  const log = await page.evaluate(() => window.__prefabPreview.__log);
  for (const row of log) console.log(JSON.stringify(row));
} finally { await browser.close(); server.kill(); }
