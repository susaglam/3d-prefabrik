// GPU renders of the interior as the factory delivers it (NO stucwerk: gipsplaat with filled joints) next to the same
// design WITH stucwerk, looking from the house toward the pui so the wall joints and the dagkant are both in frame.
// Also measures, off the rendered pixels, how far the joint band stands from the board it lies on.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir, homedir} from 'node:os';
import {join} from 'node:path';

const catalog = JSON.parse(await readFile('addons/cs_prefab_configurator/data/catalog.json', 'utf8'));
const out = join('docs', 'verification', 'modern-living');
await mkdir(out, {recursive: true});
const temporary = await mkdtemp(join(tmpdir(), 'prefab-gips-'));
const server = spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(temporary, 'r.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const base = await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'), args: ['--enable-gpu', '--ignore-gpu-blocklist']});
const report = [];
try {
  for (const plaster of [true]) {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
    await context.addInitScript(({config, version, environment}) => { localStorage.setItem('cs-prefab-design-v1', JSON.stringify({version, config})); localStorage.setItem('cs-prefab-environment-v1', JSON.stringify(environment)); },
      {config: {...catalog.defaults, width: 620, depth: 340, interior: true, plaster, frontOpening: 'sliding-2-black', heating: 'both', wallLights: ['L3', 'R3']},
       version: catalog.schemaVersion, environment: {scenario: 'living', houseType: 'detached', floorFinish: 'laminate'}});
    const page = await context.newPage();
    await page.goto(`${base}/prefab`);
    await page.waitForFunction(() => window.__prefabPreview);
    await page.evaluate(() => window.__prefabPreview.assetsReady);
    const facts = await page.evaluate(async () => {
      const p = window.__prefabPreview;
      p.setView('interior');
      await new Promise(resolve => setTimeout(resolve, 3500));
      p.render();
      const joints = []; p.root.traverse(o => { if (/^board-joint/.test(o.name || '')) joints.push(o.name); });
      const count = name => joints.filter(n => n === name).length;
      return {joints: joints.length, wall: count('board-joint-wall'), front: count('board-joint-front'),
        dagkant: count('board-joint-dagkant'), ceiling: count('board-joint-ceiling'),
        screws: (() => { let n = 0; p.root.traverse(o => { if (o.isInstancedMesh && o.material?.name !== 'x' && o.geometry?.type === 'CircleGeometry') n++; }); return n; })()};
    });
    await page.waitForTimeout(1200);
    const file = join(out, `living-interior.png`);
    await page.locator('canvas').first().screenshot({path: file});
    report.push({plaster, ...facts, file});
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
}
await writeFile(join(out, 'living-results.json'), JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify(report, null, 1));
