// Close-ups of the roof and its edges (2.13.0): the roof outlet and downpipe bends, the daktrim corner and upstand,
// the membrane, the ground junction and the house around the aanbouw. Writes docs/verification/roof/*.png.
// Usage: node scripts/render-roof.mjs [overhang=none|...] [houseType=terraced|semi|detached]
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const catalog = JSON.parse(await readFile('addons/cs_prefab_configurator/data/catalog.json', 'utf8'));
const [overhang = 'none', houseType = 'terraced', only = ''] = process.argv.slice(2);
const out = join('docs', 'verification', 'roof');
await mkdir(out, {recursive: true});
const server = spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(await mkdtemp(join(tmpdir(), 'prefab-roof-')), 'r.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const origin = await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'), args: ['--enable-gpu', '--ignore-gpu-blocklist']});
// Camera and target per shot, in terms of the aanbouw: b = bounds, H = wall height.
const SHOTS = {
  'roof-top': (b, H) => [[b.right + .7, H + 1.5, b.front + 1.0], [b.right - .5, H + .08, b.front - .4]],
  'roof-outlet': (b, H) => [[b.right - .5, H + .75, b.front + .25], [b.right - .12, H + .08, b.front - .05]],
  'drain-top': (b, H) => [[b.right + 1.1, H - .05, b.front + .9], [b.right - .12, H - .15, b.front + .1]],
  'drain-bottom': (b, H) => [[b.right + 1.0, .55, b.front + 1.1], [b.right - .12, .12, b.front + .1]],
  'trim-corner': (b, H) => [[b.right + .55, H + .6, b.front + .55], [b.right - .05, H + .05, b.front - .05]],
  'trim-back': (b, H) => [[b.right + .8, H + .7, b.back + .6], [b.right, H + .05, b.back]],
  'ground': (b, H) => [[b.right + 1.4, .45, b.front + 2.0], [b.right, .05, b.front - .6]],
  // The foot of the side wall, seen low and close as the customer reported it ("bina biraz havada duruyormuş").
  'base-side': (b, H) => [[b.right + 2.1, .55, b.front - .9], [b.right, -.02, b.back + .9]],
  'base-front': (b, H) => [[b.left + 1.1, .5, b.front + 1.9], [b.left + .4, -.02, b.front]],
  // Where the house's own facade meets the grass beside the aanbouw: the corner the customer circled.
  'base-house': (b, H) => [[b.left - 1.7, .5, b.front + .7], [b.left - .5, -.05, b.back - .1]],
  // The rollaag over the opening, and the outdoor tap on the side wall (2.16.0).
  'rollaag': (b, H) => [[.7, H - .2, b.front + 2.6], [0, H - .45, b.front]],
  'tap': (b, H) => [[b.right - .15, .92, b.front + 1.05], [b.right - .55, .62, b.front]],
  'house-corner': (b, H) => [[b.right + 2.2, 2.3, b.front + 3.2], [b.right + .4, 2.2, b.back]],
  'house-roof': (b, H) => [[b.right + 1.5, H + 3.2, b.front + 5.5], [0, H + 2.4, b.back - 1.5]],
  'wide': (b, H) => [[b.right + 4.5, 3.4, b.front + 7.5], [0, 1.6, b.back + .8]],
};
const rows = [];
try {
  const context = await browser.newContext({viewport: {width: 1200, height: 800}});
  await context.addInitScript(({config, version, environment}) => { localStorage.setItem('cs-prefab-design-v1', JSON.stringify({version, config})); localStorage.setItem('cs-prefab-environment-v1', JSON.stringify(environment)); },
    // ROOF_CONFIG='{"outsideTap":"right"}' overrides any catalogue field for the shot.
    {config: {...catalog.defaults, width: 500, depth: 300, overhang, drainSide: 'right', ...(process.env.ROOF_EDGE ? {roofEdge: process.env.ROOF_EDGE} : {}), ...JSON.parse(process.env.ROOF_CONFIG || '{}')}, version: catalog.schemaVersion, environment: {houseType}});
  const page = await context.newPage();
  await page.goto(`${origin}/prefab`, {waitUntil: 'networkidle', timeout: 90000});
  await page.waitForFunction(() => window.__prefabPreview?.renderer);
  await page.evaluate(() => window.__prefabPreview.assetsReady);
  await page.evaluate(() => window.__prefabPreview.gardenSetReady);
  for (const [name, shot] of Object.entries(SHOTS)) {
    if (only && !name.startsWith(only)) continue;
    // ROOF_PROBE='{"ground":[[500,390]]}' names the first visible mesh under each canvas pixel of that shot.
    const probe = JSON.parse(process.env.ROOF_PROBE || '{}')[name] || [];
    const facts = await page.evaluate(async ([source, points]) => {
      const p = window.__prefabPreview, m = p.model, [eye, target] = (0, eval)(source)(m.bounds, m.height);
      p.controls.target.set(...target); p.camera.position.set(...eye); p.controls.update();
      await new Promise(resolve => setTimeout(resolve, 1600));
      p.render();
      const box = p.renderer.domElement.getBoundingClientRect(), hits = [];
      for (const [x, y] of points) {
        p.raycaster.setFromCamera({x: x / box.width * 2 - 1, y: -y / box.height * 2 + 1}, p.camera);
        const hit = p.raycaster.intersectObject(p.scene, true).find(h => { for (let n = h.object; n; n = n.parent) if (!n.visible) return false; return h.object.isMesh; });
        const path = []; for (let n = hit?.object; n && n !== p.scene; n = n.parent) path.push(n.name || n.type);
        const material = hit?.object.material, size = hit?.object.geometry?.parameters;
        let key = ''; for (let n = hit?.object; n && !key; n = n.parent) key = n.userData?.scopeKey || '';
        hits.push({at: [x, y], path: path.join(' < '), key, colour: material?.color?.getHexString?.() || '', map: material?.map?.image?.src?.split('/').pop() || '',
          size: size ? [size.width, size.height, size.depth].map(v => v === undefined ? v : +v.toFixed(3)) : null,
          centre: hit ? hit.object.getWorldPosition(hit.point.clone()).toArray().map(v => +v.toFixed(3)) : null,
          point: hit ? hit.point.toArray().map(v => +v.toFixed(3)) : null});
      }
      return {hiddenFence: (p.fencePanels || []).filter(n => !n.visible).length, hits};
    }, [shot.toString(), probe]);
    if (facts.hits.length) console.log(name, JSON.stringify(facts.hits, null, 1));
    delete facts.hits;
    await page.waitForTimeout(600);
    const file = join(out, `${overhang}-${houseType}${process.env.ROOF_EDGE ? '-' + process.env.ROOF_EDGE : ''}-${name}.png`);
    await page.locator('canvas').first().screenshot({path: file});
    rows.push({name, ...facts, file});
  }
  await context.close();
} finally { await browser.close(); server.kill(); }
await writeFile(join(out, `${overhang}-${houseType}.json`), JSON.stringify(rows, null, 1) + '\n');
console.table(rows);
