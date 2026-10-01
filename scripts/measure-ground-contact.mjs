// Which walls stop ABOVE the ground they stand on (2.14.1, the customer: "bina biraz havada duruyormuş").
// Prints, per house type, the top of the ground plane and every tall mesh of the house or the neighbours whose
// underside is higher than it — that gap is what reads as a building hovering over the lawn. Read-only.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const server = spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(await mkdtemp(join(tmpdir(), 'prefab-ground-')), 'g.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const origin = await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'), args: ['--enable-gpu', '--ignore-gpu-blocklist']});
const rows = [];
try {
  for (const houseType of ['terraced', 'semi', 'detached']) {
    const context = await browser.newContext({viewport: {width: 900, height: 600}});
    await context.addInitScript(h => localStorage.setItem('cs-prefab-environment-v1', JSON.stringify({houseType: h})), houseType);
    const page = await context.newPage();
    await page.goto(origin + '/prefab', {waitUntil: 'networkidle', timeout: 90000});
    await page.waitForFunction(() => window.__prefabPreview?.renderer);
    await page.evaluate(() => window.__prefabPreview.assetsReady);
    rows.push({houseType, ...await page.evaluate(() => {
      const p = window.__prefabPreview, lowest = {};
      p.scene.updateMatrixWorld(true);
      let ground = null, lawn = null;
      const boxOf = o => { o.geometry.computeBoundingBox(); return o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); };
      p.scene.traverse(o => {
        if (!o.isMesh || !o.geometry) return;
        const world = boxOf(o);
        if (o.name === 'ground-grass') ground = world.max.y;
        if (o.name === 'garden-lawn') lawn = world.max.y;
        if (world.max.y - world.min.y < .25 || world.max.y < -.2) return;   // standing things, not paving or grass
        let group = 'aanbouw'; for (let n = o; n; n = n.parent) if (['existing-house', 'neighbours', 'garden', 'terrace-slab', 'terrace-apron', 'surroundings'].includes(n.name)) group = n.name;
        const key = `${group}/${o.name || 'mesh'}`;
        if (!(key in lowest) || world.min.y > lowest[key]) lowest[key] = +world.min.y.toFixed(3);
      });
      // What each thing stands on: the paving (-0.05) under the aanbouw, the garden lawn over the plot, the ground
      // plane everywhere else. A piece whose underside is higher than that surface is the hovering the customer saw.
      const terrace = -.05, surfaces = {aanbouw: terrace, 'terrace-slab': ground, 'terrace-apron': ground, garden: lawn ?? ground};
      return {ground: +ground.toFixed(3), lawn: lawn === null ? null : +lawn.toFixed(3), terrace,
        bottoms: Object.fromEntries(Object.entries(lowest).sort((a, b) => b[1] - a[1])),
        floating: Object.entries(lowest).filter(([name, bottom]) => bottom > (surfaces[name.split('/')[0]] ?? ground) + 1e-6)
          .map(([name, bottom]) => `${name} @ ${bottom} — ${Math.round((bottom - (surfaces[name.split('/')[0]] ?? ground)) * 1000)} mm above what it stands on`)};
    })});
    await context.close();
  }
} finally { await browser.close(); server.kill(); }
console.log(JSON.stringify(rows, null, 1));
