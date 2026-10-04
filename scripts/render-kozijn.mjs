// Every kozijn as the 3D builds it (2.17.0), to hold against the customer's reference renders (kozijn/*.png): straight
// on, from the right as the references are taken, close at the handle, and from the room. Writes
// docs/verification/kozijn/<option>-<shot>.png. Usage: node scripts/render-kozijn.mjs [option-prefix] [shot-prefix]
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const catalog = JSON.parse(await readFile('addons/cs_prefab_configurator/data/catalog.json', 'utf8'));
const [onlyOption = '', onlyShot = ''] = process.argv.slice(2);
const OPTIONS = ['sliding-2-white', 'sliding-2-black', 'sliding-4-white', 'sliding-4-black', 'folding-white', 'folding-black',
  'french-white', 'french-black', 'french-bars-white', 'french-bars-black'].filter(id => id.startsWith(onlyOption));
const out = join('docs', 'verification', 'kozijn');
await mkdir(out, {recursive: true});
const server = spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(await mkdtemp(join(tmpdir(), 'prefab-kozijn-')), 'k.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const origin = await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'), args: ['--enable-gpu', '--ignore-gpu-blocklist']});
// Camera and target per shot: b = bounds; `h` is the handled section's handle point (x, y) in the scene.
const SHOTS = {
  front: (b, h) => [[0, 1.3, b.front + 6.6], [0, 1.25, b.front]],
  angle: (b, h) => [[3.7, 1.6, b.front + 4.7], [-.2, 1.2, b.front]],
  detail: (b, h) => [[h[0] + .75, h[1] + .25, b.front + 1.1], [h[0], h[1], b.front]],
  inside: (b, h) => [[.7, 1.55, b.front - 2.9], [0, 1.2, b.front]],
};
const rows = [];
try {
  const context = await browser.newContext({viewport: {width: 1200, height: 800}});
  await context.addInitScript(({config, version}) => { localStorage.setItem('cs-prefab-design-v1', JSON.stringify({version, config})); },
    {config: {...catalog.defaults, width: 600, depth: 300, frontOpening: OPTIONS[0], ...JSON.parse(process.env.KOZIJN_CONFIG || '{}')}, version: catalog.schemaVersion});
  const page = await context.newPage();
  await page.goto(`${origin}/prefab`, {waitUntil: 'networkidle', timeout: 90000});
  await page.waitForFunction(() => window.__prefabPreview?.renderer);
  await page.evaluate(() => window.__prefabPreview.assetsReady);
  for (const option of OPTIONS) {
    for (const [name, shot] of Object.entries(SHOTS)) {
      if (onlyShot && !name.startsWith(onlyShot)) continue;
      // The page's CSP forbids eval, so the scene facts come out first and the camera goes back in as numbers.
      const scene = await page.evaluate(async (option) => {
        const p = window.__prefabPreview;
        if (p.config.frontOpening !== option) p.update({...p.config, frontOpening: option});
        await new Promise(resolve => setTimeout(resolve, 900));
        const m = p.model, o = m.opening, handled = m.panels.find(panel => panel.handle);
        const hx = handled ? handled.x + (handled.handle.edge === 'left' ? -1 : 1) * handled.width / 2 : 0;
        return {bounds: m.bounds, handle: [hx, o.bottom + (handled?.handle?.type === 'lever' ? .87 : .92)],
          sections: m.panels.map(panel => panel.role).join(' '), width: o.width};
      }, option);
      const [eye, target] = shot(scene.bounds, scene.handle);
      await page.evaluate(async ([eye, target]) => {
        const p = window.__prefabPreview;
        p.controls.target.set(...target); p.camera.position.set(...eye); p.controls.update();
        await new Promise(resolve => setTimeout(resolve, 1400));
        p.render();
      }, [eye, target]);
      const facts = {sections: scene.sections, width: scene.width};
      await page.waitForTimeout(500);
      const file = join(out, `${option}-${name}.png`);
      await page.locator('canvas').first().screenshot({path: file});
      rows.push({option, name, ...facts, file});
    }
  }
  await context.close();
} finally { await browser.close(); server.kill(); }
await writeFile(join(out, 'shots.json'), JSON.stringify(rows, null, 1) + '\n');
console.table(rows.map(({option, name, sections, width}) => ({option, name, sections, width})));
