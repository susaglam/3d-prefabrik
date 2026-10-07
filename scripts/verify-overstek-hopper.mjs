// Browser proof (2.18.2, the owner: "yağmur borusu çözümünü uygula"): with an overstek the downpipe hangs from a
// vergaarbak on the boeiboord, under the daktrim, and a zwanenhals of two bends brings it back to the facade under the
// board — no hole in the roof any more; without an overstek the hopper stays on the facade with one straight pipe.
// Reads the BUILT scene of the app that is served, so it judges what a visitor gets. Writes close-ups to
// docs/verification/roof/served-*.png.
// PREFAB_ORIGIN=https://... node scripts/verify-overstek-hopper.mjs   (without it: a local scripts/serve.py)
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

let origin = process.env.PREFAB_ORIGIN, server = null;
if (!origin) {
  server = spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(await mkdtemp(join(tmpdir(), 'prefab-hopper-')), 'h.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
  origin = await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
}
const out = join('docs', 'verification', 'roof');
await mkdir(out, {recursive: true});
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'), args: ['--enable-gpu', '--ignore-gpu-blocklist']});
const problems = [], facts = {};
const check = (ok, message) => { if (!ok) problems.push(message); };
try {
  const catalog = await (await fetch(`${origin}/prefab/api/catalog`)).json();
  for (const overhang of ['pvc-white', 'none']) {
    const context = await browser.newContext({viewport: {width: 1200, height: 800}});
    await context.addInitScript(({config, version}) => localStorage.setItem('cs-prefab-design-v1', JSON.stringify({version, config})),
      {config: {...catalog.defaults, width: 500, depth: 300, overhang, drainSide: 'both'}, version: catalog.schemaVersion});
    const page = await context.newPage();
    await page.goto(`${origin}/prefab`, {waitUntil: 'networkidle', timeout: 90000});
    await page.waitForFunction(() => window.__prefabPreview?.renderer && window.__prefabPreview?.model, null, {timeout: 60000});
    await page.evaluate(() => window.__prefabPreview.assetsReady);
    const seen = await page.evaluate(() => {
      const p = window.__prefabPreview, m = p.model, list = name => { const found = []; p.scene.traverse(o => { if (o.isMesh && name(o)) found.push(o); }); return found; };
      const box = objects => { const b = {minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity}; for (const o of objects) { o.geometry.computeBoundingBox(); o.updateWorldMatrix(true, false);
        const g = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); b.minY = Math.min(b.minY, g.min.y); b.maxY = Math.max(b.maxY, g.max.y); b.minZ = Math.min(b.minZ, g.min.z); b.maxZ = Math.max(b.maxZ, g.max.z); } return b; };
      const bends = list(o => o.name === 'downpipe' && o.geometry.parameters?.path?.type === 'QuadraticBezierCurve3');
      return {overhangDepth: m.overhangDepth, front: m.bounds.front, soffit: m.height + m.roofThickness / 2 - m.fasciaHeight, drains: m.drains.length,
        outlets: list(o => o.name === 'roof-outlet').length, hopper: box(list(o => o.name === 'downpipe-hopper')), hoppers: list(o => o.name === 'downpipe-hopper' && o.geometry.type !== 'CylinderGeometry').length,
        bends: bends.length, bendBox: bends.length ? box(bends) : null, scuppers: list(o => o.name === 'roof-scupper').length};
    });
    facts[overhang] = seen;
    const face = seen.front + seen.overhangDepth;
    check(seen.outlets === 0, `${overhang}: there is still a hole in the roof (${seen.outlets} roof-outlet parts)`);
    check(seen.scuppers === 2 * seen.drains, `${overhang}: the opening in the roof edge is missing (${seen.scuppers})`);
    check(Math.abs(seen.hopper.minZ - face) < .006, `${overhang}: the hopper is not on the ${seen.overhangDepth ? 'boeiboord' : 'facade'} (${(seen.hopper.minZ - face).toFixed(3)} m off)`);
    if (seen.overhangDepth) {
      check(seen.bends === 2 * seen.drains, `${overhang}: no zwanenhals (${seen.bends} bends for ${seen.drains} pipes)`);
      check(seen.bendBox && seen.bendBox.maxY < seen.soffit - .01, `${overhang}: a bend reaches into the boeiboord`);
    } else check(seen.bends === 0, `${overhang}: a plain facade got bends (${seen.bends})`);
    // Close-ups: the garden corner and square from the side, as scripts/render-roof.mjs frames them.
    for (const [name, eye, target] of [['corner', [1.05, -.55, 1.25], [-.12, -.45, .12]], ['side', [1.6, -.35, .15], [-.12, -.35, .15]]]) {
      await page.evaluate(([eye, target]) => {
        const p = window.__prefabPreview, m = p.model, b = m.bounds, at = v => [b.right + v[0], m.height + v[1], b.front + v[2]];
        p.controls.target.set(...at(target)); p.camera.position.set(...at(eye)); p.controls.update(); p.render();
      }, [eye, target]);
      await page.waitForTimeout(1200);
      await page.locator('canvas').first().screenshot({path: join(out, `served-${overhang}-${name}.png`)});
    }
    await context.close();
  }
} finally { await browser.close(); server?.kill(); }
console.log(JSON.stringify({origin, facts, problems}, null, 1));
console.log(problems.length ? 'PROBLEMS: ' + problems.join('; ') : 'hopper: on the boeiboord with a zwanenhals under it on an overstek, on the facade without one, no hole in the roof');
process.exit(problems.length ? 1 : 0);
