// Browser proof of the kozijn motion (2.18.0): choosing a kozijn in the form plays it open and closed once; a real
// mouse click on a door opens it and a second click closes it; the frame still opens its card; with reduced motion
// nothing plays by itself and a click changes state at once. Screenshots of every family open:
// docs/verification/kozijn/<option>-open.png. Usage: node scripts/verify-kozijn-motion.mjs   (PREFAB_ORIGIN for live)
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const catalog = JSON.parse(await readFile('addons/cs_prefab_configurator/data/catalog.json', 'utf8'));
const out = join('docs', 'verification', 'kozijn');
await mkdir(out, {recursive: true});
let server = null, origin = process.env.PREFAB_ORIGIN;
if (!origin) {
  server = spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(await mkdtemp(join(tmpdir(), 'prefab-motion-')), 'm.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
  origin = await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
}
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'), args: ['--enable-gpu', '--ignore-gpu-blocklist']});
const problems = [], facts = {};
const check = (ok, message) => { if (!ok) problems.push(message); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function open(page, config) {
  await page.addInitScript(({config, version}) => localStorage.setItem('cs-prefab-design-v1', JSON.stringify({version, config})), {config, version: catalog.schemaVersion});
  await page.goto(`${origin}/prefab`, {waitUntil: 'networkidle', timeout: 90000});
  await page.waitForFunction(() => window.__prefabPreview?.renderer);
  await page.evaluate(() => window.__prefabPreview.assetsReady);
}
/** Screen point of the centre of the first glass pane of a moving section, or of a frame jamb. */
const pointOf = (page, what) => page.evaluate(what => {
  const p = window.__prefabPreview, THREE = p.camera.constructor.__proto__ ? null : null; // three is not on window
  const found = [];
  p.root.getObjectByName('opening').traverse(o => {
    if (!o.isMesh) return;
    const leaf = p.kozijnLeafOf(o);
    if (what === 'leaf' && leaf && o.name === 'clear-glazing') found.push(o);
    if (what === 'frame' && o.name === 'frame-jamb') found.push(o);
  });
  const mesh = found[0]; mesh.updateWorldMatrix(true, false);
  mesh.geometry.computeBoundingBox();
  const c = mesh.geometry.boundingBox.getCenter(mesh.position.clone()).applyMatrix4(mesh.matrixWorld).project(p.camera);
  const r = p.renderer.domElement.getBoundingClientRect();
  return {x: r.left + (c.x + 1) / 2 * r.width, y: r.top + (1 - c.y) / 2 * r.height};
}, what);
try {
  // 1. Choosing a kozijn in the form plays it once, then it is closed again.
  {
    const context = await browser.newContext({viewport: {width: 1440, height: 900}});
    const page = await context.newPage();
    await open(page, {...catalog.defaults, width: 600, depth: 300, frontOpening: 'none'});
    // Sampled on a clock, not per frame: the first build of a new kozijn compiles its materials and can hold the main
    // thread a second or more, so the whole sequence (delay, open, hold, close) is waited for up to 12 s.
    await page.evaluate(() => { const p = window.__prefabPreview, t0 = performance.now(); p.__samples = []; const tick = () => { p.__samples.push(p.kozijnOpenness || 0); if (performance.now() - t0 < 12000) setTimeout(tick, 100); }; tick(); });
    // The kozijn card: pick the openslaande deur through the form, the way a visitor does.
    await page.evaluate(() => { const input = document.querySelector('input[name="frontOpening"][value="french-white"]'); if (input) { input.checked = true; input.dispatchEvent(new Event('change', {bubbles: true})); } });
    await page.waitForFunction(() => { const s = window.__prefabPreview.__samples; const i = s.findIndex(v => v > .99); return i >= 0 && s.slice(i).some(v => v < .01); }, null, {timeout: 13000}).catch(() => {});
    const samples = await page.evaluate(() => window.__prefabPreview.__samples);
    const peak = Math.max(...samples), last = samples[samples.length - 1];
    facts.preview = {peak: +peak.toFixed(3), last: +last.toFixed(3), samples: samples.length};
    check(peak > .99, `choosing a kozijn did not play it open (peak openness ${peak.toFixed(2)})`);
    check(last < .01, `after the preview the kozijn did not close again (openness ${last.toFixed(2)})`);
    await context.close();
  }
  // 2. A mouse click on a door opens it, a second closes it; a click on the frame opens the card instead.
  {
    const context = await browser.newContext({viewport: {width: 1440, height: 900}});
    const page = await context.newPage();
    await open(page, {...catalog.defaults, width: 600, depth: 300, frontOpening: 'french-white'});
    await page.evaluate(() => { const p = window.__prefabPreview; p.stopKozijnMotion(); p.setKozijnOpen(false, {instant: true}); p.setView('front'); p.render(); });
    await sleep(300);
    let at = await pointOf(page, 'leaf');
    await page.mouse.click(at.x, at.y);
    await sleep(1400);
    facts.click = {afterFirst: await page.evaluate(() => [window.__prefabPreview.kozijnOpen, +window.__prefabPreview.kozijnOpenness.toFixed(3)])};
    check(facts.click.afterFirst[0] === true && facts.click.afterFirst[1] > .99, 'a click on the door did not open it');
    // The open door is out in the garden: click it where it now stands.
    at = await pointOf(page, 'leaf');
    await page.mouse.click(at.x, at.y);
    await sleep(1200);
    facts.click.afterSecond = await page.evaluate(() => [window.__prefabPreview.kozijnOpen, +window.__prefabPreview.kozijnOpenness.toFixed(3)]);
    check(facts.click.afterSecond[0] === false && facts.click.afterSecond[1] < .01, 'a second click did not close it');
    const frame = await pointOf(page, 'frame');
    await page.mouse.click(frame.x, frame.y);
    await sleep(500);
    facts.click.frameLeavesClosed = await page.evaluate(() => !window.__prefabPreview.kozijnOpen);
    check(facts.click.frameLeavesClosed, 'a click on the frame toggled the kozijn');
    await context.close();
  }
  // 3. Reduced motion: nothing plays by itself; a click changes state at once.
  {
    const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
    const page = await context.newPage();
    await open(page, {...catalog.defaults, width: 600, depth: 300, frontOpening: 'sliding-2-white'});
    facts.reduced = await page.evaluate(() => { const p = window.__prefabPreview; const played = p.previewKozijn(); p.toggleKozijn(); return {played, openness: p.kozijnOpenness}; });
    check(facts.reduced.played === false, 'with reduced motion the preview played');
    check(facts.reduced.openness === 1, 'with reduced motion a toggle did not change state at once');
    await context.close();
  }
  // 4. Every family open, from the standpoint the references are taken from.
  {
    const context = await browser.newContext({viewport: {width: 1200, height: 800}});
    const page = await context.newPage();
    await open(page, {...catalog.defaults, width: 600, depth: 300, frontOpening: 'sliding-2-white'});
    for (const option of ['sliding-2-white', 'sliding-4-black', 'folding-black', 'french-white']) {
      await page.evaluate(async option => {
        const p = window.__prefabPreview;
        p.update({...p.config, frontOpening: option});
        p.setKozijnOpen(true, {instant: true});
        const b = p.model.bounds;
        p.controls.target.set(-.2, 1.2, b.front); p.camera.position.set(3.9, 1.8, b.front + 5.4); p.controls.update();
        await new Promise(resolve => setTimeout(resolve, 900)); p.render();
      }, option);
      await sleep(400);
      await page.locator('canvas').first().screenshot({path: join(out, `${option}-open.png`)});
    }
    await context.close();
  }
} finally { await browser.close(); server?.kill(); }
console.log(JSON.stringify({facts, problems}, null, 1));
console.log(problems.length ? 'PROBLEMS: ' + problems.join('; ') : 'kozijn motion: plays once after a choice, a click on a door opens and closes it, the frame keeps its card, reduced motion holds');
process.exit(problems.length ? 1 : 0);
