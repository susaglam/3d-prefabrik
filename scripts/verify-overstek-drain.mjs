// Browser proof (2.18.3) of where the rainwater goes, in the BUILT scene of the app that is served:
//  * always through the inner face of the roof EDGE (a kiezelbak on the membrane), never through a hole in the roof
//    floor — the owner on 2.18.2: "çatı üstünden bağlantı noktası ve deliğin yeri bu sefer tam doğru yerde";
//  * under an overstek the pipe stays INSIDE: against the facade, straight up into the soffit, right under the opening,
//    with no vergaarbak on the boeiboord and no zwanenhals ("onun içeriden olması lazım ... şu anki müşterim o şekilde
//    montaj yapmıyor");
//  * without an overstek the pipe hangs from its hopper on the facade under the daktrim (2.17.0).
// Writes close-ups to docs/verification/roof/served-*.png.
// PREFAB_ORIGIN=https://... node scripts/verify-overstek-drain.mjs   (without it: a local scripts/serve.py)
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

let origin = process.env.PREFAB_ORIGIN, server = null;
if (!origin) {
  server = spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(await mkdtemp(join(tmpdir(), 'prefab-drain-')), 'd.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
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
      const p = window.__prefabPreview, m = p.model, list = test => { const found = []; p.scene.traverse(o => { if (o.isMesh && test(o)) found.push(o); }); return found; };
      const box = objects => { const b = {minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity}; for (const o of objects) { o.geometry.computeBoundingBox(); o.updateWorldMatrix(true, false);
        const g = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); b.minY = Math.min(b.minY, g.min.y); b.maxY = Math.max(b.maxY, g.max.y); b.minZ = Math.min(b.minZ, g.min.z); b.maxZ = Math.max(b.maxZ, g.max.z); } return b; };
      const pipes = list(o => /^downpipe(-uitloop)?$/.test(o.name));
      return {overhangDepth: m.overhangDepth, front: m.bounds.front, soffit: m.height + m.roofThickness / 2 - m.fasciaHeight, drains: m.drains.length,
        trimReach: .09, outlets: list(o => o.name === 'roof-outlet').length, scupper: box(list(o => o.name === 'roof-scupper')), scuppers: list(o => o.name === 'roof-scupper').length,
        hopper: box(list(o => o.name === 'downpipe-hopper')), hoppers: list(o => o.name === 'downpipe-hopper').length, spouts: list(o => o.name === 'downpipe-spout').length,
        pipes: pipes.length, bends: pipes.filter(o => o.geometry.parameters?.path?.type === 'QuadraticBezierCurve3').length, pipe: box(pipes)};
    });
    facts[overhang] = seen;
    const face = seen.front + seen.overhangDepth;
    check(seen.outlets === 0, `${overhang}: there is a hole in the roof floor (${seen.outlets} roof-outlet parts)`);
    check(seen.scuppers === 2 * seen.drains && Math.abs(seen.scupper.maxZ - (face - seen.trimReach)) < .01, `${overhang}: the opening is not in the inner face of the roof edge`);
    check(seen.bends === 0 && seen.pipes === seen.drains, `${overhang}: the pipe is not one straight run (${seen.pipes} runs, ${seen.bends} bends)`);
    if (seen.overhangDepth) {
      check(seen.hoppers === 0 && seen.spouts === 0, `${overhang}: a vergaarbak or zijuitloop outside on the boeiboord (${seen.hoppers}, ${seen.spouts})`);
      check(Math.abs(seen.pipe.maxY - (seen.soffit + .02)) < .005, `${overhang}: the pipe does not go up into the soffit (${seen.pipe.maxY} vs ${seen.soffit})`);
      check(seen.pipe.maxZ < face && seen.pipe.minZ > seen.front, `${overhang}: the pipe is not inside, under the overstek`);
    } else check(seen.hoppers > 0 && Math.abs(seen.hopper.minZ - seen.front) < .006, `${overhang}: the hopper is not on the facade`);
    for (const [name, eye, target] of [['corner', [1.05, -.55, 1.25], [-.12, -.25, .12]], ['above', [.25, .85, .75], [-.2, .02, .02]]]) {
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
console.log(problems.length ? 'PROBLEMS: ' + problems.join('; ') : 'drain: through the edge, no hole in the roof; under an overstek the pipe stays inside, up into the soffit; without one it hangs from its hopper');
process.exit(problems.length ? 1 : 0);
