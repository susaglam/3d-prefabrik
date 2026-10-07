/**
 * 2.9 rendering-pipeline gates: invariants that a broken commit could silently violate while every other test still
 * passes (a wrong composer size, an extra shadow pass per frame, a tier that no longer looks like its sibling, a
 * facade/frame/daktrim colour drifting off its catalogue reference, a picker chip promising a colour the wall it
 * stands for does not have - for the aanbouw AND for the existing house). Each gate is a real GPU render, not a
 * screenshot diff against a golden image - GPUs and driver versions differ across machines, budgets do not.
 *
 * Real GPU only (headless SwiftShader softens exactly the texture/AO differences these gates measure): launches
 * Chromium with --enable-gpu --ignore-gpu-blocklist, same as .data/b2_swatch.mjs and .data/scene_check.mjs.
 * PREFAB_TEST_OUTPUT (default docs/verification/2.9) receives rendering.json plus the tier-parity PNG pair.
 */
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir, homedir} from 'node:os';
import {join, resolve, dirname, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {waitAssetsReady} from './wait-assets-ready.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.PREFAB_TEST_OUTPUT || join(root, 'docs/verification/2.9');
await mkdir(output, {recursive: true});
const catalog = JSON.parse(await readFile(join(root, 'addons/cs_prefab_configurator/data/catalog.json'), 'utf8'));
const temporary = await mkdtemp(join(tmpdir(), 'cs-prefab-rendering-'));

// Budgets are documented inline at the point each is checked. All were set with a real margin above the numbers
// this script itself measured on 2026-09-16 (recorded per-gate in the JSON output as `observed`), not guessed.
const BUDGET = {
  swatchDeltaE00: 10.0,       // measured lit dE00: facade 3.70, frame 8.43, daktrim 7.02 - margin catches a wrong hex/material, not lighting noise.
  chipDeltaE00: 9.0,          // measured worst 6.75 (pvc-anthracite) across all 13 finishes; every chip sits DELIBERATELY
                              // lighter than its wall, because a chip at wall brightness reads as mud on a white form -
                              // so this budget bounds the spread of that offset, not the offset itself. brick-red's
                              // stale hex scored 13.0 before it was corrected, which is what the 2.25 of headroom catches.
  houseChipDeltaE00: 9.5,     // the same promise for the EXISTING HOUSE's six chips, on its own number because it is a
                              // different surface: a two-storey wall seen at a distance in the default perspective
                              // camera and partly under its own eaves, not a front wall sampled head-on. Measured
                              // 2026-09-17 over the house's upper wall: brick-red 6.44, brick-black 1.76, brick-white
                              // 7.47, brick-yellow 4.52, render-white 2.92, render-grey 3.42 - worst 7.47, so 2.03 of
                              // headroom, the same order as the 2.25 above. What it catches, measured against those
                              // very walls: the two hexes environment.js carried before 2.9.6, brick-red's #b88873 at
                              // 27.77 (3x the budget) and brick-yellow's #cbb17c at 10.18. Say the second one plainly:
                              // it clears the budget by 0.68, so this gate is a reliable detector of the brick-red
                              // class of drift and only a marginal one of a single-step-off chip. Tightening it
                              // further would start grading GPU-to-GPU lighting noise instead of the form.
  tierMeanAbsDiff: 20,        // measured 6.6 (0-255 per channel, averaged over the whole 1440x900 frame).
  tierFractionOver32: 0.15,   // measured 0.058 (share of pixels whose diff exceeds 32/255).
  tierGlassChannelDiff: 20,   // measured max component diff ~7 across ~4700 raycast-sampled glass pixels.
  lampGlowFloor: 60,          // 0-255 luminance; both tiers must still read as "lit", not "off".
};

// CIELAB + CIEDE2000, shared by the two colour gates below. dE00 is used rather than a raw RGB distance because a
// fixed RGB budget is far stricter on dark colours than on light ones, and three of the four bricks are dark.
  const lin = v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const lab = ([r, g, b]) => {
    const [R, G, B] = [lin(r), lin(g), lin(b)];
    const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
    const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  };
  const deltaE2000 = (l1, l2) => {
    const [L1, a1, b1] = l1, [L2, a2, b2] = l2, rad = Math.PI / 180, deg = 180 / Math.PI;
    const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
    const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
    const A1 = (1 + G) * a1, A2 = (1 + G) * a2;
    const Cp1 = Math.hypot(A1, b1), Cp2 = Math.hypot(A2, b2);
    const h = (a, b) => { if (a === 0 && b === 0) return 0; const v = Math.atan2(b, a) * deg; return v < 0 ? v + 360 : v; };
    const h1 = h(A1, b1), h2 = h(A2, b2);
    const dL = L2 - L1, dC = Cp2 - Cp1;
    let dh = 0; if (Cp1 * Cp2 !== 0) { dh = h2 - h1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
    const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dh / 2 * rad);
    const Lb = (L1 + L2) / 2, Cpb = (Cp1 + Cp2) / 2;
    let hb = (h1 + h2) / 2; if (Cp1 * Cp2 !== 0 && Math.abs(h1 - h2) > 180) hb = (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2;
    const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.20 * Math.cos((4 * hb - 63) * rad);
    const Sl = 1 + 0.015 * (Lb - 50) ** 2 / Math.sqrt(20 + (Lb - 50) ** 2), Sc = 1 + 0.045 * Cpb, Sh = 1 + 0.015 * Cpb * T;
    const Rt = -2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad);
    return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
  };
  const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const rgb2hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

const results = {release: '2.17.0', startedAt: new Date().toISOString(), gates: [], errors: []};
const gate = (name, passed, detail = {}) => { results.gates.push({name, passed, ...detail}); console.log((passed ? 'PASS ' : 'FAIL ') + name); };

let server, browser;
try {
  server = spawn(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['scripts/serve.py', '--port', '0', '--db', join(temporary, 'rendering.sqlite3')], {cwd: root, stdio: ['ignore', 'pipe', 'pipe']});
  const base = await new Promise((resolveBase, reject) => {
    let text = ''; const timer = setTimeout(() => reject(new Error('Test server start timed out')), 15000);
    const onData = chunk => { text += chunk; const m = text.match(/running at (http:\/\/[^\s]+)\/prefab/); if (m) { clearTimeout(timer); resolveBase(m[1]); } };
    server.stdout.on('data', onData); server.stderr.on('data', onData);
    server.once('exit', code => reject(new Error('Server exited ' + code)));
  });
  const executablePath = process.env.CHROMIUM_PATH || [join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'), join(homedir(), '.cache/ms-playwright/chromium-1217/chrome-linux64/chrome')].find(existsSync);
  browser = await chromium.launch({headless: true, executablePath, args: ['--enable-gpu', '--ignore-gpu-blocklist']});

  // ---- Gates 1, 2 and 4 share one page: the default-config app instance at 1440x1000, DPR 1.75 -----------------
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 1.75});
  const page = await context.newPage();
  const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(`${base}/prefab`);
  await page.waitForFunction(() => window.__prefabPreview);
  await waitAssetsReady(page);
  await page.waitForTimeout(300);

  // ---- Gate 1: composer size guard --------------------------------------------------------------------------
  // The drawing buffer, the EffectComposer's own render target, and the GTAO pass's normal+depth G-buffer target
  // must all agree in pixels. A mismatch here is exactly the half-pixel-wider-target bug sizeComposer()'s own
  // comment describes (composer multiplying by ITS OWN pixel ratio on top of the renderer's already-scaled buffer).
  {
    const sizes = await page.evaluate(() => {
      const p = window.__prefabPreview;
      return {
        dpr: window.devicePixelRatio,
        canvas: {w: p.renderer.domElement.width, h: p.renderer.domElement.height},
        composer: p.composer ? {w: p.composer.renderTarget1.width, h: p.composer.renderTarget1.height} : null,
        aoNormal: p.aoPass ? {w: p.aoPass.normalRenderTarget.width, h: p.aoPass.normalRenderTarget.height} : null,
        tier: p.quality,
      };
    });
    const composerOk = sizes.tier === 'full' && !!sizes.composer && sizes.composer.w === sizes.canvas.w && sizes.composer.h === sizes.canvas.h;
    const aoOk = sizes.tier === 'full' && !!sizes.aoNormal && sizes.aoNormal.w === sizes.canvas.w && sizes.aoNormal.h === sizes.canvas.h;
    gate('Composer size guard: renderTarget1 and GTAO normal target match the drawing buffer at DPR 1.75', composerOk && aoOk, {sizes});
  }

  // ---- Gate 4: swatch colour truth --------------------------------------------------------------------------
  // Front view lands the facade, frame and daktrim on the SAME hex geometry.js/preview.js hardcode for them (the
  // "catalogue" ground truth: preview.js's own VIEW_EXPOSURE comment - "the exterior lands the facade swatches on
  // their catalogue hex" - names this exact probe). facade uses the photographic scan mean (brick-red is a real
  // texture, not a flat colour); frame/daktrim are flat MeshStandardMaterial colours so the raw hex is the target.
  {
    // A white door/window frame is not the default (sliding-2-black); update() live so the same page instance
    // serves gates 1/2/4. materials{} never evicts a key, so match the FULL colour-qualified key, not just the
    // 'frame:' prefix - a stale 'frame:#303432:...' from preview.js's own empty-config first build (see buildCounts)
    // would otherwise sort first in Map iteration order and silently grade the wrong, invisible material.
    await page.evaluate(() => { window.__prefabPreview.update({...window.__prefabPreview.config, frontOpening: 'sliding-2-white'}); });
    const report = await page.evaluate(() => {
      const p = window.__prefabPreview; p.setView('front'); p.render();
      const canvas = p.renderer.domElement, flat = document.createElement('canvas');
      flat.width = canvas.width; flat.height = canvas.height;
      const ctx = flat.getContext('2d', {willReadFrequently: true}); ctx.drawImage(canvas, 0, 0);
      const px = ctx.getImageData(0, 0, flat.width, flat.height).data;
      const keyOf = prefix => [...p.materials.keys()].find(k => k.startsWith(prefix));
      const targets = [['facade', p.materials.get(keyOf('facade:'))], ['frame', p.materials.get(keyOf('frame:#efede6'))], ['daktrim', p.materials.get(keyOf('edge:'))]].filter(([, m]) => m);
      const sun = p.sun.position.clone().normalize();
      const byMaterial = new Map(targets.map(([name, material]) => [material, {name, lit: [], shade: []}]));
      const ray = p.raycaster; ray.camera = p.camera;
      const shown = object => { for (let n = object; n; n = n.parent) if (!n.visible) return false; return true; };
      for (let y = 4; y < flat.height; y += 4) for (let x = 4; x < flat.width; x += 4) {
        ray.setFromCamera({x: x / flat.width * 2 - 1, y: 1 - y / flat.height * 2}, p.camera);
        const hit = ray.intersectObject(p.root, true).find(h => h.object.isMesh && shown(h.object));
        if (!hit) continue;
        const bucket = byMaterial.get(hit.object.material); if (!bucket) continue;
        const i = (y * flat.width + x) * 4;
        const normal = hit.normal ? hit.normal.clone().transformDirection(hit.object.matrixWorld) : new p.camera.position.constructor(0, 1, 0);
        const facing = normal.dot(sun);
        const Ray = p.raycaster.constructor;
        const shadowRay = new Ray(hit.point.clone().addScaledVector(normal, 0.03), sun, 0.01, 60); shadowRay.camera = p.camera;
        const blocked = facing <= 0.03 || shadowRay.intersectObject(p.root, true).some(h => h.object.isMesh && shown(h.object) && !h.object.material?.userData?.glazing);
        (blocked ? bucket.shade : bucket.lit).push([px[i], px[i + 1], px[i + 2]]);
      }
      const mean = rows => rows.length ? [0, 1, 2].map(c => rows.reduce((a, r) => a + r[c], 0) / rows.length) : null;
      return {exposure: p.renderer.toneMappingExposure, materials: [...byMaterial.values()].map(b => ({name: b.name, lit: mean(b.lit), litCount: b.lit.length, shade: mean(b.shade), shadeCount: b.shade.length}))};
    });

    // facade: photographic scan mean (the texture's own measured average, not the small flat UI picker-card colour -
    // see .data/b2_swatch.mjs and its brick_ref.py note). frame/daktrim: the single hex geometry.js/preview.js both hardcode.
    // 2.17.0: "Baksteen rood" loads brick_red_diffuse.jpg, the lighter recolour (provenance meanSRGB 165.5/135/122);
    // the scan's #6a534b is now only the derivation source.
    const references = {facade: '#a5877a', frame: '#efede6', daktrim: '#3a3f3d'};
    const rows = [];
    for (const material of report.materials) {
      const want = references[material.name]; if (!want) continue;
      for (const state of ['lit', 'shade']) {
        if (!material[state] || material[`${state}Count`] < 12) continue;
        const got = material[state].map(Math.round), reference = hex2rgb(want);
        rows.push({name: material.name, state, pixels: material[`${state}Count`], want, got: rgb2hex(got), dE: +deltaE2000(lab(reference), lab(got)).toFixed(2)});
      }
    }
    const litRows = rows.filter(r => r.state === 'lit');
    const missing = ['facade', 'frame', 'daktrim'].filter(name => !litRows.some(r => r.name === name));
    const overBudget = litRows.filter(r => r.dE > BUDGET.swatchDeltaE00);
    const passed = missing.length === 0 && overBudget.length === 0;
    gate('Swatch colour truth: front-view facade/frame/daktrim sample within dE00 budget of their catalogue hex', passed, {budget: BUDGET.swatchDeltaE00, exposure: report.exposure, rows, missing});
    // Gate 5 below re-selects a finish and restores the catalogue default itself, so nothing is restored here.
  }

  // ---- Gate 5: the picker chip tells the truth about the wall ------------------------------------------------
  // model.js MATERIALS carries one flat hex per finish; it is what the customer clicks in the form and the only
  // preview they get of a finish they have not selected yet. Nothing tied it to the 3D wall, so brick-red's chip
  // sat three releases behind its own scan (#926557 against a wall that renders #765a53-ish, dE00 13) without a
  // single test noticing. Gate 4 cannot catch this class: it grades the wall against the TEXTURE's mean, which is
  // a statement about the scan and the lighting, not about the form. This gate walks every facade code, renders
  // the wall the chip promises, and grades the chip against it.
  {
    const chips = await page.evaluate(async () => {
      const {MATERIALS} = await import('/cs_prefab_configurator/static/src/model.js');
      return Object.fromEntries(Object.entries(MATERIALS).map(([code, m]) => [code, m.color]));
    });
    const codes = Object.keys(chips);
    const measured = [];
    for (const code of codes) {
      const sample = await page.evaluate(async facade => {
        const p = window.__prefabPreview;
        p.update({...p.config, facade});
        await p.assetsReady;
        p.setView('front'); p.render();
        const canvas = p.renderer.domElement, flat = document.createElement('canvas');
        flat.width = canvas.width; flat.height = canvas.height;
        const ctx = flat.getContext('2d', {willReadFrequently: true}); ctx.drawImage(canvas, 0, 0);
        const px = ctx.getImageData(0, 0, flat.width, flat.height).data;
        // Match the colour-qualified key for THIS facade, not the first 'facade:' key - materials{} never evicts, so
        // every finish visited earlier in this loop is still in the Map and would otherwise win on iteration order.
        const material = p.materials.get(`facade:${facade}`);
        if (!material) return null;
        const sun = p.sun.position.clone().normalize();
        const ray = p.raycaster; ray.camera = p.camera;
        const shown = object => { for (let n = object; n; n = n.parent) if (!n.visible) return false; return true; };
        const lit = [];
        // Step 12, not gate 4's step 4: this loop runs once per facade code, and a mean over the ~2-4k wall samples a
        // 12-grid returns is stable to well inside the budget while costing a ninth of the rays.
        for (let y = 6; y < flat.height; y += 12) for (let x = 6; x < flat.width; x += 12) {
          ray.setFromCamera({x: x / flat.width * 2 - 1, y: 1 - y / flat.height * 2}, p.camera);
          const hit = ray.intersectObject(p.root, true).find(h => h.object.isMesh && shown(h.object));
          if (!hit || hit.object.material !== material) continue;
          const normal = hit.normal ? hit.normal.clone().transformDirection(hit.object.matrixWorld) : null;
          if (!normal || normal.dot(sun) <= 0.03) continue;
          const shadowRay = new p.raycaster.constructor(hit.point.clone().addScaledVector(normal, 0.03), sun, 0.01, 60); shadowRay.camera = p.camera;
          if (shadowRay.intersectObject(p.root, true).some(h => h.object.isMesh && shown(h.object) && !h.object.material?.userData?.glazing)) continue;
          const i = (y * flat.width + x) * 4;
          lit.push([px[i], px[i + 1], px[i + 2]]);
        }
        if (lit.length < 120) return {pixels: lit.length, mean: null};
        return {pixels: lit.length, mean: [0, 1, 2].map(c => lit.reduce((a, r) => a + r[c], 0) / lit.length)};
      }, code);
      if (!sample || !sample.mean) { measured.push({code, chip: chips[code], pixels: sample?.pixels ?? 0, wall: null, dE: null}); continue; }
      const wall = sample.mean.map(Math.round);
      measured.push({code, chip: chips[code], wall: rgb2hex(wall), pixels: sample.pixels, dE: +deltaE2000(lab(hex2rgb(chips[code])), lab(wall)).toFixed(2)});
    }
    const unsampled = measured.filter(r => r.dE === null).map(r => r.code);
    const overBudget = measured.filter(r => r.dE !== null && r.dE > BUDGET.chipDeltaE00);
    const worst = measured.filter(r => r.dE !== null).sort((a, b) => b.dE - a.dE)[0] || null;
    gate('Picker chip truth: every facade chip in model.js MATERIALS is within dE00 budget of the wall it renders', unsampled.length === 0 && overBudget.length === 0,
      {budget: BUDGET.chipDeltaE00, worst, overBudget: overBudget.map(r => r.code), unsampled, rows: measured});
    // Leave the page on the catalogue default so the gates that follow start from a known configuration.
    await page.evaluate(facade => { const p = window.__prefabPreview; p.update({...p.config, facade, frontOpening: 'sliding-2-black'}); }, catalog.defaults.facade);
  }

  // ---- Gate 6: the same promise for the EXISTING HOUSE's chips ------------------------------------------------
  // Gate 5 grades the aanbouw's thirteen chips. The house has its own picker ("Woning & tuin" -> Gevelafwerking van
  // je woning) with its own six, and until 2.9.6 its own hexes: brick-red promised #b88873 there and #765a53 in the
  // aanbouw form, for the same scanned brick. Gate 5 could never see that - it walks model.js MATERIALS, which the
  // house list was not part of. Since 2.9.6 both read finishes.js, and this gate is what keeps them honest: it is
  // NOT a test that the two tables are equal (finishes.test.mjs does that, off a different failure mode) but a
  // measurement of the house chip against the house wall the customer gets when they click it.
  //
  // The house is driven through the ENVIRONMENT, not the config: app.js's applyEnvironment() hands the normalised
  // settings to Preview.setEnvironment(), which rebuilds the whole scene when sceneEnvironmentKey changes -
  // facadeFinish is part of that key. So each finish here is a real rebuild, exactly what a click in the form does.
  // Sampling is by MESH NAME, not by material: for a brick the house shares the aanbouw's own material instance
  // (that sharing is the point - one wall, one scan), so a material lookup cannot tell the two buildings apart.
  {
    const {houseChips, prefabBricks} = await page.evaluate(async () => {
      const {FACADE_FINISHES} = await import('/cs_prefab_configurator/static/src/environment.js');
      const {MATERIALS} = await import('/cs_prefab_configurator/static/src/model.js');
      return {houseChips: FACADE_FINISHES.map(item => [item.id, item.color, item.label]), prefabBricks: Object.keys(MATERIALS).filter(code => code.startsWith('brick'))};
    });
    const measured = [];
    for (const [code, chip, label] of houseChips) {
      const sample = await page.evaluate(async finish => {
        const p = window.__prefabPreview;
        const {defaultEnvironment} = await import('/cs_prefab_configurator/static/src/environment.js');
        p.setEnvironment({...defaultEnvironment(), facadeFinish: finish});
        await p.assetsReady;
        // The app's own default camera: this is the house as the customer sees it the moment the dialog closes.
        p.setView('perspective'); p.render();
        const canvas = p.renderer.domElement, flat = document.createElement('canvas');
        flat.width = canvas.width; flat.height = canvas.height;
        const ctx = flat.getContext('2d', {willReadFrequently: true}); ctx.drawImage(canvas, 0, 0);
        const px = ctx.getImageData(0, 0, flat.width, flat.height).data;
        const sun = p.sun.position.clone().normalize();
        const ray = p.raycaster; ray.camera = p.camera;
        const shown = object => { for (let n = object; n; n = n.parent) if (!n.visible) return false; return true; };
        // Under houseGroup AND named 'house-wall': the own house's big upper-floor plane. Not the neighbours (their
        // walls are a different group and, for stucwerk, a deliberately darker tint), and not the flanks, gables or
        // chimney - measured 2026-09-17, restricting to the wall changes no digit of the mean (those parts are
        // buried or edge-on in this camera) but it keeps the gate pointed at one surface instead of four.
        const inHouse = object => { for (let n = object; n; n = n.parent) if (n === p.houseGroup) return true; return false; };
        const lit = [];
        for (let y = 6; y < flat.height; y += 12) for (let x = 6; x < flat.width; x += 12) {
          ray.setFromCamera({x: x / flat.width * 2 - 1, y: 1 - y / flat.height * 2}, p.camera);
          const hit = ray.intersectObject(p.root, true).find(h => h.object.isMesh && shown(h.object));
          if (!hit || hit.object.name !== 'house-wall' || !inHouse(hit.object)) continue;
          const normal = hit.normal ? hit.normal.clone().transformDirection(hit.object.matrixWorld) : null;
          if (!normal || normal.dot(sun) <= 0.03) continue;
          const shadowRay = new p.raycaster.constructor(hit.point.clone().addScaledVector(normal, 0.03), sun, 0.01, 60); shadowRay.camera = p.camera;
          if (shadowRay.intersectObject(p.root, true).some(h => h.object.isMesh && shown(h.object) && !h.object.material?.userData?.glazing)) continue;
          const i = (y * flat.width + x) * 4;
          lit.push([px[i], px[i + 1], px[i + 2]]);
        }
        // Measured 1289 lit samples per finish in this camera; 120 is the same floor gate 5 uses - far enough below
        // to survive a reframing, far enough above to make the mean stable.
        if (lit.length < 120) return {pixels: lit.length, mean: null};
        return {pixels: lit.length, mean: [0, 1, 2].map(c => lit.reduce((a, r) => a + r[c], 0) / lit.length)};
      }, code);
      if (!sample.mean) { measured.push({code, label, chip, pixels: sample.pixels, wall: null, dE: null}); continue; }
      const wall = sample.mean.map(Math.round);
      measured.push({code, label, chip, wall: rgb2hex(wall), pixels: sample.pixels, dE: +deltaE2000(lab(hex2rgb(chip)), lab(wall)).toFixed(2)});
    }
    const unsampled = measured.filter(r => r.dE === null).map(r => r.code);
    const overBudget = measured.filter(r => r.dE !== null && r.dE > BUDGET.houseChipDeltaE00);
    const worst = measured.filter(r => r.dE !== null).sort((a, b) => b.dE - a.dE)[0] || null;
    // The customer's 2.9.6 request, gated: every baksteen the aanbouw offers must be offerable on the house too. A
    // list that silently shrinks back to red-and-yellow would otherwise pass every remaining check in this file.
    const bricks = measured.filter(r => r.code.startsWith('brick')).map(r => r.code);
    const missingBricks = prefabBricks.filter(code => !bricks.includes(code));
    gate('Picker chip truth (house): every "Woning & tuin" chip is within dE00 budget of the house wall it renders', unsampled.length === 0 && overBudget.length === 0 && missingBricks.length === 0,
      {budget: BUDGET.houseChipDeltaE00, worst, overBudget: overBudget.map(r => r.code), unsampled, missingBricks, rows: measured});
    await page.evaluate(async () => {
      const {defaultEnvironment} = await import('/cs_prefab_configurator/static/src/environment.js');
      window.__prefabPreview.setEnvironment(defaultEnvironment());
    });
  }

  // ---- Gate 7: the house is dressed on every side a camera can reach -----------------------------------------
  // The 2.9.6 report: "de buitengevel is hier niet toegepast". The existing house had no street elevation over the
  // extension's width at all, so what stood there was makeExistingRoom's PAINTED LINING — the inside of the room,
  // seen from outside, filling a fifth to a third of the frame at 180 degrees. Six gates were green while it
  // shipped, because every one of them looked at the house from the garden.
  //
  // This one orbits behind and raycasts. The first hit of every ray is taken, so a room legitimately seen THROUGH
  // the extension's glazing hits the glass and never counts; anything on this list that is the first hit is a hole
  // in the envelope. Three house types, because the wings and the neighbours cover different parts of that wall.
  {
    const INDOOR = ['surface:painted', 'surface:plaster', 'surface:gypsum-board', 'surface:floor', 'surface:existing-floor'];
    const rows = [];
    // Since 2.14.0 the visitor's camera stops level with the house's own front wall (preview.js CAMERA_LIMIT); only
    // Vormgeving -> "Vrij rondkijken" lets it behind the house. That switch is exactly the case this gate protects, so it
    // is lifted for the measurement and put back after: with the limit on, controls.update() swung every camera of
    // this loop back to the garden and the gate measured the front of the house three times over (2.16.2 / 2.17.0).
    const cameraLimit = await page.evaluate(() => { const p = window.__prefabPreview, was = p.cameraLimit; p.cameraLimit = false; return was; });
    for (const houseType of ['terraced', 'semi', 'detached']) {
      await page.evaluate(async type => {
        const {defaultEnvironment} = await import('/cs_prefab_configurator/static/src/environment.js');
        window.__prefabPreview.setEnvironment({...defaultEnvironment(), houseType: type});
      }, houseType);
      await page.waitForTimeout(150);
      for (const angle of [165, 180, 210]) {
        rows.push({houseType, angle, ...await page.evaluate(([a, indoor]) => {
          const p = window.__prefabPreview, b = p.model.bounds, mid = (b.back + b.front) / 2, rad = a * Math.PI / 180;
          p.cameraTouched = true;
          p.camera.position.set(Math.sin(rad) * 17, 3.4, mid + Math.cos(rad) * 17);
          p.controls.target.set(0, 1.6, mid); p.camera.lookAt(p.controls.target); p.controls.update(); p.render();
          const canvas = p.renderer.domElement, cache = [...p.materials.entries()], ray = p.raycaster; ray.camera = p.camera;
          const shown = o => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
          let hits = 0, inside = 0, rear = 0; const names = new Set();
          for (let y = 6; y < canvas.height; y += 12) for (let x = 6; x < canvas.width; x += 12) {
            ray.setFromCamera({x: x / canvas.width * 2 - 1, y: 1 - y / canvas.height * 2}, p.camera);
            const hit = ray.intersectObject(p.root, true).find(q => q.object.isMesh && shown(q.object));
            if (!hit) continue;
            hits++;
            const key = cache.find(([, v]) => v === hit.object.material)?.[0] || '';
            if (indoor.some(pre => key.startsWith(pre))) { inside++; names.add(key + ' | ' + (hit.object.name || '(unnamed)')); }
            if (hit.object.name === 'house-rear') rear++;
          }
          return {hits, insidePct: +(inside / (hits || 1) * 100).toFixed(2), rearPct: +(rear / (hits || 1) * 100).toFixed(2), found: [...names]};
        }, [angle, INDOOR])});
      }
    }
    // The leaf must not merely exist, it must be what the camera sees: at 180 degrees it is the whole ground floor
    // of the house. A budget of 0.05% (about one ray in two thousand) rather than a hard zero, so a single sliver
    // at a grazing angle is not a release blocker while a panel is.
    const worst = Math.max(...rows.map(r => r.insidePct));
    const rearSeen = rows.filter(r => r.angle === 180).every(r => r.rearPct >= 3);
    gate('Rear elevation is masonry: no interior lining is ever the first thing a camera behind the house hits',
      worst <= 0.05 && rearSeen, {budgetPct: 0.05, worstInsidePct: worst, rearSeenAt180: rearSeen, rows});
    await page.evaluate(async limit => {
      const {defaultEnvironment} = await import('/cs_prefab_configurator/static/src/environment.js');
      window.__prefabPreview.cameraLimit = limit;
      window.__prefabPreview.setEnvironment(defaultEnvironment());
    }, cameraLimit);
    await page.evaluate(() => window.__prefabPreview.setView('perspective'));
  }

  // ---- Gate 2: shadow-pass counter ---------------------------------------------------------------------------
  // render() consumes `shadowsDirty` once per call (preview.js ~line 1756): a pure camera orbit must NOT re-flag
  // it (no caster moved), a structural change MUST, exactly once. Calls preview.update() directly rather than
  // through the UI, because app.js's own price-debounce path (schedulePrice's immediate preview.setScope([]))
  // renders a second time on its own for unrelated reasons - this gate isolates the Preview class's own invariant.
  {
    const counts = await page.evaluate(() => {
      const p = window.__prefabPreview;
      const before0 = p.getSceneInfo().rendering.shadowPasses;
      p.camera.position.x += 0.6; p.controls.update(); p.render();
      const afterOrbit1 = p.getSceneInfo().rendering.shadowPasses;
      p.camera.position.z += 0.6; p.controls.update(); p.render();
      const afterOrbit2 = p.getSceneInfo().rendering.shadowPasses;
      const beforeStructural = afterOrbit2;
      p.update({...p.config, width: p.config.width + 10});
      const afterStructural = p.getSceneInfo().rendering.shadowPasses;
      p.update({...p.config, width: p.config.width}); // restore
      return {before0, afterOrbit1, afterOrbit2, orbitDelta1: afterOrbit1 - before0, orbitDelta2: afterOrbit2 - afterOrbit1, beforeStructural, afterStructural, structuralDelta: afterStructural - beforeStructural};
    });
    const passed = counts.orbitDelta1 === 0 && counts.orbitDelta2 === 0 && counts.structuralDelta === 1;
    gate('Shadow-pass counter: +0 per pure-orbit render, exactly +1 per structural change + render', passed, counts);
  }

  await context.close();

  // ---- Gate 3: tier parity (full vs compact) -----------------------------------------------------------------
  // Two Preview instances built directly (not through app.js), forced to 'full'/'compact' via the constructor's
  // own `quality` option, same 1440x900 CSS size and pixelRatio 1 so the ONLY difference is what the tier itself
  // does (composer/GTAO, shadow map resolution, 512px vs full-res textures, lamp slot count) - not DPR or layout.
  {
    const tierContext = await browser.newContext({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 1});
    const tierPage = await tierContext.newPage();
    const tierErrors = []; tierPage.on('pageerror', e => tierErrors.push(e.message));
    await tierPage.goto(`${base}/prefab`);
    await tierPage.waitForFunction(() => window.__prefabPreview);
    await waitAssetsReady(tierPage);

    // A glazed kozijn on purpose: since 2.16.1 the catalogue starts on "geen kozijn", an open rough opening with no
    // pane, and the "glass tight" half of this gate then found 0 glass pixels to compare and failed on nothing.
    const config = {...catalog.defaults, frontOpening: 'sliding-2-black', interior: true, plaster: true, heating: 'both', ceilingPositions: ['center'], spotPositions: ['r1c1', 'r3c5']};
    const environment = {scenario: 'living', floorFinish: 'laminate'};
    const report = await tierPage.evaluate(async ({config, environment}) => {
      const {Preview} = await import('/cs_prefab_configurator/static/src/preview.js');
      const make = quality => new Promise(resolveReady => {
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;left:-9999px;top:0;width:1440px;height:900px;';
        document.body.appendChild(el);
        const preview = new Preview(el, {quality, pixelRatio: 1, environment, initialConfig: config, onReady: () => resolveReady(preview)});
      });
      const full = await make('full'), compact = await make('compact');
      await full.assetsReady; await compact.assetsReady;
      for (const p of [full, compact]) { p.setEnvironment?.(environment); p.setFloorFinish?.(environment.floorFinish); await Promise.resolve(p.setScenario?.(environment.scenario)); p.setView('interior'); p.render(); }
      const flatten = p => { const c = document.createElement('canvas'); c.width = p.renderer.domElement.width; c.height = p.renderer.domElement.height; const ctx = c.getContext('2d', {willReadFrequently: true}); p.render(); ctx.drawImage(p.renderer.domElement, 0, 0); return {ctx, w: c.width, h: c.height, canvas: c}; };
      const A = flatten(full), B = flatten(compact);
      const dataA = A.ctx.getImageData(0, 0, A.w, A.h).data, dataB = B.ctx.getImageData(0, 0, B.w, B.h).data;
      let sumDiff = 0, over32 = 0, n = 0;
      for (let i = 0; i < dataA.length; i += 4) {
        const d = (Math.abs(dataA[i] - dataB[i]) + Math.abs(dataA[i + 1] - dataB[i + 1]) + Math.abs(dataA[i + 2] - dataB[i + 2])) / 3;
        sumDiff += d; if (d > 32) over32++; n++;
      }
      // Ray-cast on the FULL scene (same camera for both, so pixel coords line up) to isolate glass and a lamp fixture.
      const targets = [['glass', full.materials.get('glass')], ['lamp', full.materials.get('fixture-warm-diffuser')]].filter(([, m]) => m);
      const sample = (p, flat, material, {step = 6, fineStep = null} = {}) => {
        const ray = p.raycaster; ray.camera = p.camera;
        const scan = (x0, x1, y0, y1, st) => { const hits = []; for (let y = y0; y < y1; y += st) for (let x = x0; x < x1; x += st) { ray.setFromCamera({x: x / flat.w * 2 - 1, y: 1 - y / flat.h * 2}, p.camera); const hit = ray.intersectObject(p.root, true).find(h => h.object.isMesh && h.object.material === material); if (hit) hits.push([x, y]); } return hits; };
        const coarse = scan(4, flat.w, 4, flat.h, step);
        if (!fineStep || !coarse.length) return coarse;
        // Ray casting walks the whole scene graph per call: a fine step over the WHOLE frame is too slow (measured:
        // did not finish in 120s). Several fixtures can each hit the coarse pass, so fine-scan only a small window
        // around the FIRST coarse hit rather than their unioned bounding box - one representative lamp is enough.
        const [cx, cy] = coarse[0], pad = 22;
        return scan(Math.max(0, cx - pad), Math.min(flat.w, cx + pad), Math.max(0, cy - pad), Math.min(flat.h, cy + pad), fineStep);
      };
      const readAt = (data, w, pts) => pts.map(([x, y]) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; });
      const meanRGB = rows => rows.length ? [0, 1, 2].map(c => rows.reduce((a, r) => a + r[c], 0) / rows.length) : null;
      const regions = {};
      for (const [name, material] of targets) {
        const pts = sample(full, A, material, name === 'lamp' ? {step: 6, fineStep: 1} : {step: 6});
        regions[name] = {count: pts.length, meanFull: meanRGB(readAt(dataA, A.w, pts)), meanCompact: meanRGB(readAt(dataB, B.w, pts))};
      }
      return {
        canvasSize: {w: A.w, h: A.h}, pixelCount: n, meanAbsDiff: +(sumDiff / n).toFixed(3), fractionOver32: +(over32 / n).toFixed(4), regions,
        rendering: {full: full.getSceneInfo().rendering, compact: compact.getSceneInfo().rendering},
        pngFull: A.canvas.toDataURL('image/png'), pngCompact: B.canvas.toDataURL('image/png'),
      };
    }, {config, environment});

    await writeFile(join(output, 'rendering-tier-full.png'), Buffer.from(report.pngFull.split(',')[1], 'base64'));
    await writeFile(join(output, 'rendering-tier-compact.png'), Buffer.from(report.pngCompact.split(',')[1], 'base64'));

    const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const glass = report.regions.glass, lamp = report.regions.lamp;
    const glassOk = !!glass && glass.count > 50 && glass.meanFull && glass.meanCompact &&
      [0, 1, 2].every(c => Math.abs(glass.meanFull[c] - glass.meanCompact[c]) <= BUDGET.tierGlassChannelDiff);
    // The lamp glow region is NOT graded on full==compact: 'full' runs a screen-space GTAO pass that multiplies
    // ambient occlusion onto the whole framebuffer, including a ceiling fixture's own emissive contribution - it
    // cannot distinguish "this pixel emits light" from "this pixel reflects light". Measured 2026-09-16: full
    // lands ~[117,98,76] (luminance ~100), compact ~[222,197,172] (luminance ~200) for the SAME fixture - a real,
    // sizeable, but plausibly-intentional cross-tier asymmetry (screen-space AO darkening an emissive is a known
    // limitation, not obviously a bug), left for design review rather than silently loosened into a pass here.
    // What IS gated: the fixture must still read as lit (not switched off) in BOTH tiers.
    const lampOk = !!lamp && lamp.count > 5 && lamp.meanFull && lamp.meanCompact && luminance(lamp.meanFull) >= BUDGET.lampGlowFloor && luminance(lamp.meanCompact) >= BUDGET.lampGlowFloor;
    const wholeImageOk = report.meanAbsDiff <= BUDGET.tierMeanAbsDiff && report.fractionOver32 <= BUDGET.tierFractionOver32;
    const renderingOk = report.rendering.full.tier === 'full' && report.rendering.compact.tier === 'compact' &&
      Number.isInteger(report.rendering.full.maxSamples) && report.rendering.full.maxSamples > 0 &&
      Number.isInteger(report.rendering.compact.maxSamples) && report.rendering.compact.maxSamples > 0 &&
      report.rendering.full.toneMapping === 'neutral' && report.rendering.compact.toneMapping === 'neutral';
    const passed = wholeImageOk && glassOk && lampOk && renderingOk;
    gate('Tier parity: full vs compact read as the same design (glass tight, lamp still lit, whole-frame diff budget)', passed, {
      budget: {meanAbsDiff: BUDGET.tierMeanAbsDiff, fractionOver32: BUDGET.tierFractionOver32, glassChannelDiff: BUDGET.tierGlassChannelDiff, lampGlowFloor: BUDGET.lampGlowFloor},
      wholeImage: {meanAbsDiff: report.meanAbsDiff, fractionOver32: report.fractionOver32, canvasSize: report.canvasSize},
      regions: report.regions, rendering: report.rendering,
      note: 'lamp region is reported, not graded on full==compact - see inline comment: GTAO cannot separate an emissive from a reflectance.',
      screenshots: ['rendering-tier-full.png', 'rendering-tier-compact.png'], errors: tierErrors,
    });
    await tierContext.close();
  }

  results.errors = pageErrors;
  results.passed = results.gates.every(g => g.passed) && pageErrors.length === 0;
} catch (error) {
  results.passed = false; results.failure = error.stack; console.error(error); process.exitCode = 1;
} finally {
  results.finishedAt = new Date().toISOString();
  await writeFile(join(output, 'rendering.json'), JSON.stringify(results, null, 2) + '\n');
  await browser?.close();
  if (server && server.exitCode === null) { const stopped = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await stopped; }
  if (dirname(resolve(temporary)) !== resolve(tmpdir()) || !basename(temporary).startsWith('cs-prefab-rendering-')) throw new Error('Unexpected temporary workspace');
  await rm(temporary, {recursive: true, force: true});
  if (!results.passed) process.exitCode = 1;
}
