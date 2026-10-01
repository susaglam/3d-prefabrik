// GPU renders of the bedroom and youth scenarios with the procedural 2.10.3 pieces (bedside table, desk, task chair,
// bookcase): the room as the interior view frames it, then a close-up of each new piece, so the pieces are judged
// in the picture a visitor gets and not only by the box test.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir, homedir} from 'node:os';
import {join} from 'node:path';

const catalog = JSON.parse(await readFile('addons/cs_prefab_configurator/data/catalog.json', 'utf8'));
const out = join('docs', 'verification', 'modern-rooms');
await mkdir(out, {recursive: true});
const temporary = await mkdtemp(join(tmpdir(), 'prefab-rooms-'));
const server = spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(temporary, 'r.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const base = await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'), args: ['--enable-gpu', '--ignore-gpu-blocklist']});
const SHOTS = [
  {name: 'bedroom', scenario: 'bedroom', config: {width: 620, depth: 340, heating: 'left'}, closeups: ['bedside']},
  {name: 'youth-rooflight', scenario: 'youth', config: {width: 500, depth: 300, rooflight: 'gable-4', heating: 'left'}, closeups: ['desk', 'bookcase']},
  {name: 'youth-wall', scenario: 'youth', config: {width: 620, depth: 340, heating: 'right'}, closeups: ['deskChair']},
];
const report = [];
try {
  for (const shot of SHOTS) {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
    await context.addInitScript(({config, version, environment}) => { localStorage.setItem('cs-prefab-design-v1', JSON.stringify({version, config})); localStorage.setItem('cs-prefab-environment-v1', JSON.stringify(environment)); },
      {config: {...catalog.defaults, interior: true, plaster: true, frontOpening: 'sliding-2-black', ...shot.config},
       version: catalog.schemaVersion, environment: {scenario: shot.scenario, houseType: 'detached', floorFinish: 'laminate'}});
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/prefab`);
    await page.waitForFunction(() => window.__prefabPreview);
    await page.evaluate(() => window.__prefabPreview.assetsReady);
    const items = await page.evaluate(async () => {
      const p = window.__prefabPreview; p.setView('interior');
      await new Promise(resolve => setTimeout(resolve, 3500)); p.render();
      const found = []; p.root.traverse(o => { if (/^interior-/.test(o.name || '') && o.userData?.item) found.push(o.name + (o.userData.procedural ? ' (procedural)' : ' (glTF)')); });
      return found;
    });
    await page.waitForTimeout(800);
    await page.locator('canvas').first().screenshot({path: join(out, `${shot.name}.png`)});
    for (const item of shot.closeups) {
      const framed = await page.evaluate(async name => {
        const p = window.__prefabPreview, object = p.root.getObjectByName(`interior-${name}`);
        if (!object) return false;
        // Look from the room toward the piece: along the line to the interior view's own camera, which is always
        // inside. Along the piece's own front it would leave through the wall for a chair turned to face a wall desk.
        const centre = object.getWorldPosition(object.position.clone());
        window.__roomEye ??= p.camera.position.clone();
        const toward = window.__roomEye.clone().sub(centre).setY(0).normalize();
        p.controls.target.set(centre.x, centre.y + .35, centre.z);
        p.camera.position.set(centre.x + toward.x * 1.5 + toward.z * .5, centre.y + 1.05, centre.z + toward.z * 1.5 - toward.x * .5);
        p.controls.update(); p.render();
        await new Promise(resolve => setTimeout(resolve, 900)); p.render();
        return true;
      }, item);
      if (framed) await page.locator('canvas').first().screenshot({path: join(out, `${shot.name}-${item}.png`)});
    }
    report.push({shot: shot.name, items, errors});
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
}
await writeFile(join(out, 'rooms.json'), JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify(report, null, 1));
