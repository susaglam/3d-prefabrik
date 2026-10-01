// Browser proof for 2.10.7 (customer, 2026-09-19): the opening camera looks in from the garden's RIGHT and closer;
// Weergave is a dialog (closed at start) instead of a strip that shrank the picture; "Woning en tuin" and Weergave fit
// one desktop screen without a scrollbar; the standpoint popover and the camera tools are drawings; on a phone the
// tools fold behind one menu button. Screenshots in docs/verification/toolbar/. Exit code 1 on any failed expectation.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const out = join('docs', 'verification', 'toolbar');
await mkdir(out, {recursive: true});
const server = process.env.PREFAB_ORIGIN ? null : spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(await mkdtemp(join(tmpdir(), 'prefab-toolbar-')), 't.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const origin = process.env.PREFAB_ORIGIN || await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'), args: ['--enable-gpu', '--ignore-gpu-blocklist']});
const steps = [], problems = [];
const expect = (label, ok, detail = {}) => { steps.push({label, ok, ...detail}); if (!ok) problems.push(label); };

async function open(context) {
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/prefab', {waitUntil: 'networkidle', timeout: 90000});
  await page.waitForFunction(() => window.__prefabPreview?.renderer);
  await page.evaluate(() => window.__prefabPreview.assetsReady);
  await page.waitForTimeout(400);
  return {page, errors};
}
/** How much the open dialog would scroll: 0 means everything fits. */
const dialogOverflow = page => page.evaluate(() => { const d = document.querySelector('#modal'); return {open: d.open, overflow: d.scrollHeight - d.clientHeight, height: Math.round(d.getBoundingClientRect().height), viewport: innerHeight}; });
/** Where the camera stands (world metres: +x is the right, +z the garden) and how far it is from its aim point. */
const camera = page => page.evaluate(() => {
  const p = window.__prefabPreview, c = p.camera.position, t = p.controls.target;
  return {x: +c.x.toFixed(2), z: +c.z.toFixed(2), distance: +c.distanceTo(t).toFixed(2), view: p.view};
});

try {
  for (const viewport of [{width: 1440, height: 900}, {width: 1280, height: 800}]) {
    const tag = viewport.width + 'x' + viewport.height;
    const context = await browser.newContext({viewport});
    const {page, errors} = await open(context);
    const cam = await camera(page);
    expect(`${tag}: opening camera stands in the garden on the right (+x, +z)`, cam.x > 0.5 && cam.z > 0.5 && cam.view === 'perspective', cam);
    expect(`${tag}: opening camera is closer than 2.10.6 (≈9.2 m then; under 8 m now for the default design)`, cam.distance < 8, cam);
    expect(`${tag}: no Weergave strip under the picture, Weergave closed`, await page.locator('.preview-bottom-wrap,.preview-bottom').count() === 0 &&
      (await page.locator('[data-action="view-strip"]').getAttribute('aria-expanded')) === 'false');
    expect(`${tag}: six drawn camera tools on the plate, no menu button`, await page.locator('.camera-tools .tool-list .tool-button:visible').count() === 6 &&
      await page.locator('.camera-tools .tool-list .tool-icon:visible').count() === 6 && !(await page.locator('[data-action="tools-menu"]').isVisible()));
    if (viewport.width === 1440) await page.screenshot({path: join(out, `desktop-${tag}.png`)});

    await page.click('[data-action="viewpoints"]');
    const tiles = await page.locator('#viewpoints-menu [data-view]').evaluateAll(list => list.map(b => ({view: b.dataset.view, drawing: !!b.querySelector('svg.viewpoint-icon'), active: b.classList.contains('active')})));
    expect(`${tag}: standpoint popover shows seven drawn tiles, "Tuin rechts" marked`, tiles.length === 7 && tiles.every(t => t.drawing) && tiles.find(t => t.active)?.view === 'perspective', {tiles: tiles.map(t => t.view).join()});
    const inside = await page.evaluate(() => { const m = document.querySelector('#viewpoints-menu').getBoundingClientRect(), card = document.querySelector('.preview-card').getBoundingClientRect(); return m.top >= card.top && m.left >= card.left && m.right <= card.right; });
    expect(`${tag}: standpoint popover inside the picture`, inside);
    if (viewport.width === 1440) await page.screenshot({path: join(out, `standpunt-${tag}.png`)});
    await page.click('#viewpoints-menu [data-view="perspective-left"]');
    await page.waitForTimeout(200);
    const left = await camera(page);
    expect(`${tag}: "Tuin links" moves the camera to the left garden side`, left.x < -0.5 && left.z > 0.5 && left.view === 'perspective-left', left);

    await page.click('[data-action="environment"]');
    await page.waitForTimeout(150);
    const env = await dialogOverflow(page);
    expect(`${tag}: Woning en tuin fits without a scrollbar`, env.open && env.overflow <= 1, env);
    if (viewport.width === 1440) await page.screenshot({path: join(out, `woning-en-tuin-${tag}.png`)});
    await page.keyboard.press('Escape');

    await page.click('[data-action="view-strip"]');
    await page.waitForTimeout(150);
    const view = await dialogOverflow(page);
    const choices = await page.evaluate(() => ({floor: document.querySelectorAll('.view-modal [data-action="floor-finish"] .floor-swatch').length,
      quality: document.querySelectorAll('.view-modal [data-action="render-quality"] svg.quality-icon').length,
      expanded: document.querySelector('[data-action="view-strip"]').getAttribute('aria-expanded')}));
    expect(`${tag}: Weergave is a dialog with picture tiles and fits without a scrollbar`, view.open && view.overflow <= 1 && choices.floor === 3 && choices.quality === 3 && choices.expanded === 'true', {...view, ...choices});
    if (viewport.width === 1440) await page.screenshot({path: join(out, `weergave-${tag}.png`)});
    await page.click('.view-modal [data-floor-finish="herringbone"]');
    expect(`${tag}: a floor tile applies in the scene`, await page.evaluate(() => window.__prefabPreview.getSceneInfo().floorFinish) === 'herringbone');
    await page.keyboard.press('Escape');
    // The dialog's close event is queued, not synchronous, and on the live site the floor scan just requested can
    // hold the main thread for a moment: wait for the dialog itself, then give the event up to 3 s to land.
    await page.waitForFunction(() => !document.querySelector('#modal').open, null, {timeout: 5000}).catch(() => {});
    await page.waitForFunction(() => document.querySelector('[data-action="view-strip"]').getAttribute('aria-expanded') === 'false', null, {timeout: 3000}).catch(() => {});
    const closed = await page.evaluate(() => ({dialogOpen: document.querySelector('#modal').open, expanded: document.querySelector('[data-action="view-strip"]').getAttribute('aria-expanded')}));
    expect(`${tag}: closing Weergave resets its button`, !closed.dialogOpen && closed.expanded === 'false', closed);

    // 2.11.0 — "Opnieuw beginnen sadece değişiklik varsa gözüksün".
    expect(`${tag}: "Opnieuw beginnen" is hidden while the design is the default`, await page.locator('.reset-header').isHidden());
    await page.click('[data-adjust="width"][data-delta^="-"]');
    await page.waitForFunction(() => !document.querySelector('.price-value.pending'));
    expect(`${tag}: … and appears after the first change`, await page.locator('.reset-header').isVisible());
    // 2.11.0 — Vormgeving → Schutting in de tuin, switched off: no planks, no posts, a smaller island.
    const fence = await page.evaluate(() => {
      const p = window.__prefabPreview, count = () => { let n = 0; p.scene.traverse(o => { if (/^garden-fence-/.test(o.name)) n++; }); return n; };
      // Switched on first: the live Vormgeving may already have it off (the 2.12.0 live proof met exactly that), and
      // this check is about the switch, not about the administrator's choice. That choice is put back afterwards.
      const served = p.gardenFence !== false;
      p.setGardenFence(true);
      const before = {runs: count(), plot: p.updatePlotFade()};
      p.setGardenFence(false);
      const after = {runs: count(), plot: p.updatePlotFade()};
      p.setGardenFence(true);
      const back = count();
      p.setGardenFence(served);
      return {served, before: before.runs, after: after.runs, depthBefore: +(before.plot.z1 - before.plot.z0).toFixed(1), depthAfter: +(after.plot.z1 - after.plot.z0).toFixed(1),
        widthBefore: +(before.plot.x1 - before.plot.x0).toFixed(1), widthAfter: +(after.plot.x1 - after.plot.x0).toFixed(1), back};
    });
    expect(`${tag}: switching the schutting off removes it and narrows the island; on again brings it back`,
      fence.before > 0 && fence.after === 0 && fence.back === fence.before && fence.depthAfter < fence.depthBefore && fence.widthAfter <= fence.widthBefore, fence);
    // 2.14.0 — the visitor cannot walk round the back of the house, and indoors cannot back out through its wall.
    const limits = await page.evaluate(async () => {
      const p = window.__prefabPreview, m = p.model, wall = m.bounds.back;
      const push = (view, at, target) => {
        p.setView(view);
        p.controls.target.set(...target); p.camera.position.set(...at); p.controls.update();
        return +p.camera.position.z.toFixed(3);
      };
      const outside = push('perspective', [0, 3.4, wall - 6], [0, m.height * .48, -.2]);
      const aside = push('perspective', [7.2, 3.4, wall - 3], [0, m.height * .48, -.2]);
      p.setView('interior');
      const room = p.cameraBackLimit();
      const indoors = push('interior', [0, 1.5, room - 4], [0, 1.3, m.bounds.front - .5]);
      p.setView('perspective');
      return {wall: +wall.toFixed(3), outside, aside, room: +room.toFixed(3), indoors, free: p.cameraLimit === false};
    });
    expect(`${tag}: the camera stops level with the house wall, from behind and from the side`,
      !limits.free && limits.outside >= limits.wall - .01 && limits.aside >= limits.wall - .01, limits);
    expect(`${tag}: indoors it stops at the wall of the room behind the doorbraak`,
      limits.room < limits.wall - 3 && limits.indoors >= limits.room - .01, limits);
    // 2.11.0 — the logo leads back to the website after a confirmation that the design is kept.
    await page.click('.site-header .brand');
    const exit = await page.evaluate(() => ({open: document.querySelector('#modal').open, title: document.querySelector('#modal-title')?.textContent,
      text: document.querySelector('#modal .modal-body p')?.textContent || ''}));
    expect(`${tag}: the logo asks before leaving and says the design is kept`, exit.open && exit.title === 'Terug naar de website?' && /bewaard/.test(exit.text), exit);
    if (viewport.width === 1440) await page.screenshot({path: join(out, `exit-${tag}.png`)});
    await page.click('#modal [data-action="exit-confirm"]');
    await page.waitForURL(url => new URL(url).pathname === '/', {timeout: 10000}).catch(() => {});
    expect(`${tag}: confirming goes to the website`, new URL(page.url()).pathname === '/', {url: page.url()});
    expect(`${tag}: no page errors`, errors.length === 0, {errors});
    await context.close();
  }

  for (const viewport of [{width: 375, height: 812}, {width: 360, height: 640}]) {
    const tag = viewport.width + 'x' + viewport.height;
    const context = await browser.newContext({viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true});
    const {page, errors} = await open(context);
    const visibleTools = await page.locator('.camera-tools .tool-list .tool-button:visible').count();
    expect(`${tag}: the tools fold behind one menu button`, visibleTools === 0 && await page.locator('[data-action="tools-menu"]').isVisible(), {visibleTools});
    const cam = await camera(page);
    expect(`${tag}: opening camera from the right`, cam.x > 0.5 && cam.z > 0.5, cam);
    await page.screenshot({path: join(out, `phone-${tag}.png`)});
    await page.tap('[data-action="tools-menu"]');
    // 2.11.0: Opties is a sheet from the bottom of the screen holding every scene button — seven tools, Weergave and
    // volledig scherm — with Hulp last; it covers the form for a moment, never the picture.
    const panel = await page.evaluate(() => { const list = document.querySelector('.tool-list'), r = list.getBoundingClientRect(), card = document.querySelector('.preview-card').getBoundingClientRect();
      return {labels: [...list.querySelectorAll('.tool-label')].filter(l => l.offsetParent).map(l => l.textContent), top: Math.round(r.top), bottom: Math.round(r.bottom), cardBottom: Math.round(card.bottom), right: Math.round(r.right), width: innerWidth, height: innerHeight}; });
    expect(`${tag}: Opties opens a sheet below the picture with nine labelled buttons, Hulp last`, panel.labels.length === 9 && panel.labels.at(-1) === 'Hulp' &&
      panel.labels.includes('Weergave') && panel.labels.includes('Volledig scherm') && panel.top >= panel.cardBottom && panel.bottom >= panel.height - 1 && panel.right <= panel.width, panel);
    await page.screenshot({path: join(out, `phone-menu-${tag}.png`)});
    await page.tap('[data-action="viewpoints"]');
    const swap = await page.evaluate(() => ({tiles: [...document.querySelectorAll('#viewpoints-menu [data-view]')].filter(b => b.offsetParent).length,
      tools: [...document.querySelectorAll('.tool-list > .tool-button')].filter(b => b.offsetParent).length,
      top: Math.round(document.querySelector('.tool-list').getBoundingClientRect().top), cardBottom: Math.round(document.querySelector('.preview-card').getBoundingClientRect().bottom)}));
    expect(`${tag}: Standpunt swaps the sheet for the seven standpoint tiles, below the picture`, swap.tiles === 7 && swap.tools === 0 && swap.top >= swap.cardBottom, swap);
    await page.screenshot({path: join(out, `phone-standpunt-${tag}.png`)});
    await page.tap('#viewpoints-menu [data-view="front"]');
    await page.waitForTimeout(200);
    expect(`${tag}: choosing a standpoint closes the panel`, await page.evaluate(() => !document.querySelector('.camera-tools').classList.contains('open') && window.__prefabPreview.view === 'front'));
    // On a phone Weergave lives in the Opties sheet (placeViewTools) and the modes fold behind one button.
    const modes = await page.evaluate(() => ({toggle: !!document.querySelector('[data-action="modes-menu"]')?.offsetParent,
      buttons: [...document.querySelectorAll('.scene-modes button')].filter(b => b.offsetParent).length, label: document.querySelector('.modes-current')?.textContent}));
    expect(`${tag}: Buiten/Binnen/Plan fold behind one button naming the current mode`, modes.toggle && modes.buttons === 0 && modes.label === 'Buiten', modes);
    await page.tap('[data-action="modes-menu"]');
    expect(`${tag}: the modes button opens the three`, await page.evaluate(() => [...document.querySelectorAll('.scene-modes button')].filter(b => b.offsetParent).length) === 3);
    await page.tap('.scene-modes [data-scene-view="interior"]');
    await page.waitForTimeout(200);
    const chosen = await page.evaluate(() => ({label: document.querySelector('.modes-current')?.textContent, open: document.querySelector('.scene-modes-wrap').classList.contains('open'), view: window.__prefabPreview.view}));
    expect(`${tag}: choosing Binnen closes the three and names Binnen`, chosen.label === 'Binnen' && !chosen.open && chosen.view === 'interior', chosen);
    await page.tap('[data-action="tools-menu"]');
    await page.tap('[data-action="view-strip"]');
    await page.waitForTimeout(150);
    const view = await dialogOverflow(page);
    expect(`${tag}: Weergave opens from the Opties sheet on the phone`, view.open, view);
    await page.screenshot({path: join(out, `phone-weergave-${tag}.png`)});
    await page.keyboard.press('Escape');
    await page.tap('[data-action="tools-menu"]');
    await page.tap('[data-action="environment"]');
    await page.waitForTimeout(150);
    expect(`${tag}: a one-shot tool closes the panel`, await page.evaluate(() => !document.querySelector('.camera-tools').classList.contains('open') && document.querySelector('#modal').open));
    await page.screenshot({path: join(out, `phone-woning-${tag}.png`)});
    expect(`${tag}: no page errors`, errors.length === 0, {errors});
    await context.close();
  }
} finally { await browser.close(); server?.kill(); }
await writeFile(join(out, 'toolbar.json'), JSON.stringify({steps, problems}, null, 1) + '\n');
console.log(JSON.stringify({problems, passed: steps.filter(s => s.ok).length, total: steps.length}, null, 1));
for (const s of steps.filter(s => !s.ok)) console.log('FAIL', JSON.stringify(s));
process.exit(problems.length ? 1 : 0);
