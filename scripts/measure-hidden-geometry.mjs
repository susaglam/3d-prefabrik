// What the scene spends on what the visitor can no longer reach (2.14.0 camera limit): meshes and triangles whose
// whole box lies behind the house's front wall, split by the group they hang in. Read-only; prints one JSON table.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const server = spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(await mkdtemp(join(tmpdir(), 'prefab-hidden-')), 'h.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const origin = await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'), args: ['--enable-gpu', '--ignore-gpu-blocklist']});
const rows = [];
try {
  for (const houseType of ['terraced', 'semi', 'detached']) {
    const context = await browser.newContext({viewport: {width: 1200, height: 800}});
    await context.addInitScript(h => localStorage.setItem('cs-prefab-environment-v1', JSON.stringify({houseType: h})), houseType);
    const page = await context.newPage();
    await page.goto(origin + '/prefab', {waitUntil: 'networkidle', timeout: 90000});
    await page.waitForFunction(() => window.__prefabPreview?.renderer);
    await page.evaluate(() => window.__prefabPreview.assetsReady);
    await page.evaluate(() => window.__prefabPreview.gardenSetReady);
    // The same scene twice, in one page: as the visitor gets it (camera limited) and with free rondkijken on, which
    // rebuilds it with the street elevations. The difference is what the limit saves.
    const scene = () => page.evaluate(() => {
      const p = window.__prefabPreview, wall = p.model.bounds.back;
      const THREE = p.camera.constructor.prototype.constructor === undefined ? null : null;
      const total = {meshes: 0, triangles: 0}, behind = {meshes: 0, triangles: 0}, groups = {};
      p.root.updateMatrixWorld(true);
      p.root.traverse(o => {
        if (!o.isMesh || !o.geometry) return;
        const index = o.geometry.index, position = o.geometry.attributes.position;
        const faces = ((index ? index.count : position ? position.count : 0) / 3) * (o.isInstancedMesh ? o.count : 1);
        total.meshes += 1; total.triangles += faces;
        const box = o.geometry.boundingBox || (o.geometry.computeBoundingBox(), o.geometry.boundingBox);
        const world = box.clone().applyMatrix4(o.matrixWorld);
        if (world.max.z >= wall) return;
        behind.meshes += 1; behind.triangles += faces;
        let name = ''; for (let n = o; n && !name; n = n.parent) name = n.name || '';
        for (let n = o; n; n = n.parent) if (['neighbours', 'existing-house', 'garden', 'surroundings'].includes(n.name)) { name = n.name + '/' + (o.name || 'mesh'); break; }
        groups[name || 'mesh'] = (groups[name || 'mesh'] || 0) + faces;
      });
      const top = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, faces]) => `${name}: ${Math.round(faces / 1000)}k`);
      return {meshes: total.meshes, triangles: total.triangles,
        behindMeshes: behind.meshes, behindTriangles: behind.triangles,
        share: (100 * behind.triangles / total.triangles).toFixed(1) + '%', top};
    });
    const limited = await scene();
    // The rebuild starts the CC0 garden set downloading again; without waiting for it the two counts compare a
    // procedural stand-in against a scanned set and the difference says nothing about the street elevation.
    await page.evaluate(async () => { window.__prefabPreview.setCameraLimit(false); await window.__prefabPreview.gardenSetReady; await new Promise(r => setTimeout(r, 600)); });
    const free = await scene();
    rows.push({houseType, meshes: limited.meshes, freeMeshes: free.meshes, savedMeshes: free.meshes - limited.meshes,
      triangles: Math.round(limited.triangles / 1000) + 'k', freeTriangles: Math.round(free.triangles / 1000) + 'k',
      savedTriangles: Math.round((free.triangles - limited.triangles) / 1000) + 'k',
      behindMeshes: limited.behindMeshes, share: limited.share});
    await context.close();
  }
} finally { await browser.close(); server.kill(); }
console.log(JSON.stringify(rows, null, 1));
