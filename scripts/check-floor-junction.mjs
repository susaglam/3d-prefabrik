// Proof for requirement (d): the prefab floor and the house room's floor ('floor-finish-house') must share ONE
// material instance and ONE metric UV origin, so the boards cross the doorbraak unbroken.
//
// metricUVs writes uv = (x/period, z/period) on a top face and floorUVs then swaps them, so every top vertex of
// every floor mesh must satisfy  u * period == worldZ  and  v * period == worldX  against the SAME period and the
// same origin at world (0,0). The probe reads the live scene and reports the largest residual in millimetres, plus
// the set of material uuids in the group - two uuids would mean two materials and two tiles.
// Usage: node scripts/check-floor-junction.mjs [laminate|herringbone]
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir, homedir} from 'node:os';
import {join} from 'node:path';

const finish = process.argv[2] || 'herringbone';
const catalog = JSON.parse(await readFile('addons/cs_prefab_configurator/data/catalog.json', 'utf8'));
const temporary = await mkdtemp(join(tmpdir(), 'prefab-junction-'));
const server = spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(temporary, 'r.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const base = await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'), args: ['--enable-gpu', '--ignore-gpu-blocklist']});
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  await context.addInitScript(({config, version, environment}) => { localStorage.setItem('cs-prefab-design-v1', JSON.stringify({version, config})); localStorage.setItem('cs-prefab-environment-v1', JSON.stringify(environment)); },
    {config: {...catalog.defaults, width: 700, depth: 340, interior: true, plaster: true, screed: true, demolition: true},
     version: catalog.schemaVersion, environment: {scenario: 'none', houseType: 'detached', floorFinish: finish}});
  const page = await context.newPage();
  await page.goto(`${base}/prefab`);
  await page.waitForFunction(() => window.__prefabPreview);
  await page.evaluate(() => window.__prefabPreview.assetsReady);
  await page.waitForTimeout(600);
  const result = await page.evaluate(() => {
    const preview = window.__prefabPreview;
    const period = preview.floorPeriod();
    const meshes = preview.floorFinishGroup.children.filter(object => object.isMesh);
    const report = meshes.map(mesh => {
      const points = mesh.geometry.attributes.position, normals = mesh.geometry.attributes.normal;
      const uv = mesh.geometry.attributes.uv;
      let worst = 0, n = 0, span = {z: [Infinity, -Infinity], x: [Infinity, -Infinity]};
      for (let i = 0; i < points.count; i++) {
        if (Math.abs(normals.getY(i)) < .5 || points.getY(i) < 0) continue;  // top face only
        const x = points.getX(i) + mesh.position.x, z = points.getZ(i) + mesh.position.z;
        worst = Math.max(worst, Math.abs(uv.getX(i) * period - z), Math.abs(uv.getY(i) * period - x));
        span.z = [Math.min(span.z[0], z), Math.max(span.z[1], z)];
        span.x = [Math.min(span.x[0], x), Math.max(span.x[1], x)];
        n++;
      }
      return {name: mesh.name || '(prefab floor)', existing: !!mesh.userData.existing, material: mesh.material.uuid,
              map: mesh.material.map?.image?.currentSrc?.split('/').pop() || null,
              topVertices: n, worstResidualMm: +(worst * 1000).toFixed(4),
              spanZ: span.z.map(v => +v.toFixed(3)), spanX: span.x.map(v => +v.toFixed(3))};
    });
    return {finish: preview.floorFinish, period, materials: [...new Set(report.map(m => m.material))].length, meshes: report};
  });
  console.log(JSON.stringify(result, null, 1));
  const ok = result.materials === 1 && result.meshes.length === 2 && result.meshes.every(m => m.worstResidualMm < 0.001);
  console.log(ok ? 'PASS one material, one metric origin, boards cross the doorbraak unbroken'
                 : 'FAIL the two floor meshes do not share one material and one metric origin');
  process.exitCode = ok ? 0 : 1;
} finally { await browser.close(); server.kill(); }
