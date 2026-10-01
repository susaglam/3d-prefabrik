// The plot as an island (2026-09-19): grass only around the house, its garden and the buren, the rest dissolving into
// the haze. Renders the visitor's first view, a pulled-back overview and a terraced house (buren on both sides), and
// measures how much of the frame is grass-green, so "the lawn no longer runs to the horizon" is a number, not a look.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const catalog = JSON.parse(await readFile('addons/cs_prefab_configurator/data/catalog.json', 'utf8'));
const out = join('docs', 'verification', 'plot-island');
await mkdir(out, {recursive: true});
const server = process.env.PREFAB_ORIGIN ? null : spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(await mkdtemp(join(tmpdir(), 'prefab-plot-')), 'r.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const base = process.env.PREFAB_ORIGIN || await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'), args: ['--enable-gpu', '--ignore-gpu-blocklist']});
const SHOTS = [
  {name: 'first-view', environment: {houseType: 'detached'}, camera: null},
  {name: 'overview', environment: {houseType: 'detached'}, camera: {eye: [14, 13, 22], target: [0, 0, 3]}},
  {name: 'terraced-overview', environment: {houseType: 'terraced'}, camera: {eye: [14, 13, 22], target: [0, 0, 3]}},
  // Eye level from the back of the garden toward the open side: the haze meets the sky's horizon here, so any
  // seam between the two would show in this frame first.
  {name: 'eye-level-horizon', environment: {houseType: 'detached'}, camera: {eye: [-3, 1.6, 12], target: [-14, 1.4, 30]}},
  // The interior view looks out through the pui at the garden: the horizon behind the back schutting is seen here.
  {name: 'interior-out', environment: {houseType: 'detached'}, camera: 'interior'},
];
const report = [];
try {
  for (const shot of SHOTS) {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
    await context.addInitScript(({config, version, environment}) => { localStorage.setItem('cs-prefab-design-v1', JSON.stringify({version, config})); localStorage.setItem('cs-prefab-environment-v1', JSON.stringify(environment)); },
      {config: {...catalog.defaults, width: 661, depth: 302, rooflight: 'gable-4', frontOpening: 'folding-black'}, version: catalog.schemaVersion, environment: {scenario: 'living', ...shot.environment}});
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/prefab`, {waitUntil: 'networkidle', timeout: 90000});
    await page.waitForFunction(() => window.__prefabPreview);
    await page.evaluate(() => window.__prefabPreview.assetsReady);
    const facts = await page.evaluate(async ([camera, haze, quality]) => {
      const p = window.__prefabPreview;
      if (haze) p.scene.fog.color.set(haze);  // HAZE=#rrggbb tries another haze tone without a code change
      if (quality) { p.setQuality(quality); await p.assetsReady; }  // QUALITY=compact renders without the AO composer
      if (camera === 'interior') p.setView('interior');
      else if (camera) { p.controls.target.set(...camera.target); p.camera.position.set(...camera.eye); p.controls.update(); }
      await new Promise(resolve => setTimeout(resolve, 2500)); p.render();
      return {plot: p.updatePlotFade?.() ?? null};
    }, [shot.camera, process.env.HAZE || null, process.env.QUALITY || null]);
    await page.waitForTimeout(800);
    const png = await page.locator('canvas').first().screenshot({path: join(out, `${shot.name}${process.env.HAZE ? '-' + process.env.HAZE.slice(1) : ''}${process.env.QUALITY ? '-' + process.env.QUALITY : ''}.png`)});
    const green = await page.evaluate(async src => {
      const image = await new Promise(resolve => { const i = new Image(); i.onload = () => resolve(i); i.src = 'data:image/png;base64,' + src; });
      const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data; let grass = 0, topGrass = 0;
      // Olive lawn: green above blue by a margin, and not below red.
      for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; if (g >= r && g > b + 18) { grass++; if (i / 4 < c.width * c.height * .35) topGrass++; } }
      // A vertical strip down the frame's centre column: where the sky ends and the haze begins, and whether a band shows.
      const column = []; const x = Math.floor(c.width * .5);
      for (let y = 0; y < c.height; y += Math.floor(c.height / 20)) { const i = (y * c.width + x) * 4; column.push('#' + [d[i], d[i + 1], d[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('')); }
      return {grassShare: +(grass / (d.length / 4)).toFixed(3), grassInTopThird: +(topGrass / (c.width * c.height * .35)).toFixed(3), centreColumn: column};
    }, png.toString('base64'));
    report.push({shot: shot.name, ...facts, ...green, errors});
    await context.close();
  }
} finally { await browser.close(); server?.kill(); }
await writeFile(join(out, 'plot.json'), JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify(report, null, 1));
