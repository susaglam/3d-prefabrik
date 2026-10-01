// Interior colour probe, part 1 of 2. Renders the scene from one or more cameras, screenshots the canvas, and
// writes the pixel coordinates that a raycast proves belong to a named surface (the prefab's own lining, the house
// room's lining, the floor slab). `scripts/measure-surface-colour.py` then averages the real rendered pixels at those
// coordinates — the measurement never trusts the material tint, only what the renderer put on screen.
// Usage: node scripts/measure-surface-colour.mjs <label> '<config json>'   env: VIEWS, ENV, NO_EXAMPLES
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir, homedir} from 'node:os';
import {join} from 'node:path';

const label = process.argv[2] || 'probe';
const overrides = JSON.parse(process.argv[3] || '{}');
const out = join('.data', 'render-compare'); await mkdir(out, {recursive: true});
const catalog = JSON.parse(await readFile('addons/cs_prefab_configurator/data/catalog.json', 'utf8'));
const temporary = await mkdtemp(join(tmpdir(), 'prefab-probe-'));
const server = spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(temporary, 'r.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const base = await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
const browser = await chromium.launch({headless: !process.env.HEADED, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'), args: ['--enable-gpu', '--ignore-gpu-blocklist']});
const report = {label, config: overrides, views: []};
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  await context.addInitScript(({config, version, environment}) => { localStorage.setItem('cs-prefab-design-v1', JSON.stringify({version, config})); if (environment) localStorage.setItem('cs-prefab-environment-v1', JSON.stringify(environment)); }, {config: {...catalog.defaults, ...overrides}, version: catalog.schemaVersion, environment: process.env.ENV ? JSON.parse(process.env.ENV) : null});
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/prefab`);
  await page.waitForFunction(() => window.__prefabPreview);
  await page.evaluate(() => window.__prefabPreview.assetsReady);
  if (process.env.NO_EXAMPLES) await page.evaluate(() => {window.__prefabPreview.setExamplesVisible(false); window.__prefabPreview.setDecorVisible(false);});
  await page.waitForTimeout(700);
  for (const view of (process.env.VIEWS || 'interior').split(',')) {
    await page.evaluate(v => { const p = window.__prefabPreview; if (v.startsWith('cam:')) { const [x, y, z, tx, ty, tz] = v.slice(4).split('_').map(Number); p.setView('interior'); p.camera.position.set(x, y, z); p.controls.target.set(tx, ty, tz); p.controls.update(); p.render(); } else p.setView(v); }, view);
    await page.waitForTimeout(400);
    const slug = `${label}-${view.replace(/[^a-z0-9-]/gi, '_')}`;
    await page.locator('#preview-scene canvas').first().screenshot({path: join(out, `${slug}.png`)});
    const points = await page.evaluate(() => {
      const p = window.__prefabPreview;
      const keyOf = new Map();
      for (const [key, material] of p.materials) keyOf.set(material.uuid, key);
      const canvas = p.renderer.domElement, ratio = p.renderer.getPixelRatio();
      const size = {w: Math.round(canvas.width / ratio), h: Math.round(canvas.height / ratio)};
      const found = [];
      for (let iy = 2; iy < 62; iy++) for (let ix = 2; ix < 82; ix++) {
        const nx = (ix / 84) * 2 - 1, ny = 1 - (iy / 64) * 2;
        p.raycaster.setFromCamera({x: nx, y: ny}, p.camera);
        const hits = p.raycaster.intersectObject(p.root, true).filter(h => h.object.isMesh && h.object.visible && h.object.material && !h.object.material.transparent);
        if (!hits.length) continue;
        const hit = hits[0], key = keyOf.get(hit.object.material.uuid);
        if (!key) continue;
        found.push({group: `${key}${hit.object.userData.existing ? ' [house]' : ' [prefab]'}`,
          px: Math.round((nx + 1) / 2 * size.w), py: Math.round((1 - ny) / 2 * size.h)});
      }
      return {found, size};
    });
    await writeFile(join(out, `${slug}-points.json`), JSON.stringify(points));
    report.views.push({view, image: `${slug}.png`, points: `${slug}-points.json`, hits: points.found.length, size: points.size});
  }
  report.errors = errors;
  console.log(JSON.stringify(report));
} finally { await browser.close(); server.kill(); }
