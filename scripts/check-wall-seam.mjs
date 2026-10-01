// Proof that the house's street elevation is ONE wall and not three boxes stacked in a plane.
//
// Since 2.9.6 the existing house's ground floor has an outer leaf of its own on the street side ('house-rear'). It
// meets the upper wall along a horizontal joint at the underside of the first floor, and the wings or the
// neighbours' walls along a vertical joint at the extension's own width. A brick that restarts its bond at either of
// those joints reads worse than no brick at all, so both are measured, twice, in two different currencies:
//
//   ANALYTIC — metricUVs writes uv = (worldX/periodX, worldY/periodY) on a wall face, so on EVERY vertex of every
//   mesh in that plane, u*periodX must be the vertex's own world x and v*periodY its world y, against one period and
//   one origin at world (0,0). This is the same proof scripts/check-floor-junction.mjs gives the floor. It is exact,
//   and it is blind to anything that goes wrong after the UVs (a second material instance, a texture with its own
//   repeat, a mesh nudged out of the plane).
//
//   PIXELS — a near-orthographic close-up of the elevation, a luminance profile across each joint, the mortar joints
//   located as minima in it, and the PHASE of the coursing fitted on each side of the joint. A bond that restarted
//   would land up to half a course out (31 mm vertically). This is blind to what the analytic pass sees best and
//   catches what it cannot see at all, which is the point of running both.
//
// Usage: node scripts/check-wall-seam.mjs [brick-red|brick-black|brick-white|brick-yellow]
// Real GPU only: the coursing has to be the photographic scan, not a software rasteriser's idea of it.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir, homedir} from 'node:os';
import {join} from 'node:path';

const finish = process.argv[2] || 'brick-red';
const BUDGET = {uvResidualMm: 0.01, phaseMm: 8};
const catalog = JSON.parse(await readFile('addons/cs_prefab_configurator/data/catalog.json', 'utf8'));
const temporary = await mkdtemp(join(tmpdir(), 'prefab-seam-'));
const server = spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(temporary, 's.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const base = await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'), args: ['--enable-gpu', '--ignore-gpu-blocklist']});

/**
 * One DFT bin: the amplitude and phase of a profile at one spatial pitch, measured against an index origin SHARED by
 * both sides of a joint (`from` is where this slice starts in the full profile). Hunting for local minima was the
 * first attempt and it graded the brick faces' own speckle — at this magnification a 63 mm course carries a dozen
 * darker pixels that are not mortar. A single frequency bin does not care about speckle; it only asks where the
 * coursing sits, which is exactly the quantity a restarted bond would change.
 */
function bin(profile, from, pitchPx) {
  const mean = profile.reduce((a, b) => a + b, 0) / profile.length;
  let re = 0, im = 0;
  for (let i = 0; i < profile.length; i++) {
    const a = 2 * Math.PI * (i + from) / pitchPx;
    re += (profile[i] - mean) * Math.cos(a); im += (profile[i] - mean) * Math.sin(a);
  }
  return {amp: Math.hypot(re, im) / profile.length, phase: Math.atan2(im, re)};
}
const median = list => { const s = [...list].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
/** The pitch in the given metric band that the whole profile carries most strongly, plus how far it stands out. */
function dominantPitch(profile, mpp, minM, maxM, step = .25) {
  const tries = [];
  for (let px = minM / mpp; px <= maxM / mpp; px += step) tries.push({px, amp: bin(profile, 0, px).amp});
  const best = tries.reduce((a, b) => b.amp > a.amp ? b : a);
  return {pitchPx: best.px, amp: best.amp, standsOut: +(best.amp / median(tries.map(t => t.amp))).toFixed(2)};
}
/**
 * Shift, in samples, that best lines up profile `b` with profile `a`, searched over ±`reach` and refined to a
 * fraction of a sample by a parabola through the peak. Zero means the two profiles already agree.
 */
function correlate(a, b, reach) {
  const mean = list => list.reduce((s, v) => s + v, 0) / list.length;
  const ma = mean(a), mb = mean(b);
  const at = s => {
    let dot = 0, n = 0;
    for (let i = Math.max(0, -s); i < Math.min(a.length, b.length - s); i++) { dot += (a[i] - ma) * (b[i + s] - mb); n++; }
    return n ? dot / n : -Infinity;
  };
  let best = -reach, score = -Infinity;
  for (let s = -reach; s <= reach; s++) { const v = at(s); if (v > score) { score = v; best = s; } }
  const y0 = at(best - 1), y2 = at(best + 1), denom = y0 - 2 * score + y2;
  return {shift: best + (denom ? (y0 - y2) / (2 * denom) : 0), peak: score};
}

try {
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}, deviceScaleFactor: 1});
  await context.addInitScript(({config, version, environment}) => {
    localStorage.setItem('cs-prefab-design-v1', JSON.stringify({version, config}));
    localStorage.setItem('cs-prefab-environment-v1', JSON.stringify(environment));
  }, {config: {...catalog.defaults, width: 500, depth: 300}, version: catalog.schemaVersion,
      environment: {houseType: 'terraced', facadeFinish: finish, scenario: 'none'}});
  const page = await context.newPage();
  await page.goto(`${base}/prefab`);
  await page.waitForFunction(() => window.__prefabPreview);
  await page.evaluate(() => window.__prefabPreview.assetsReady);
  await page.waitForTimeout(700);

  // ---- ANALYTIC ---------------------------------------------------------------------------------------------
  const analytic = await page.evaluate(code => {
    const p = window.__prefabPreview, m = p.model;
    const {periodX, periodY} = p.facadePeriods(code);
    const named = ['house-rear', 'house-wall', 'house-flank', 'house-chimney'];
    const rows = [], uuids = new Set(), repeats = new Set();
    p.root.traverse(mesh => {
      if (!mesh.isMesh || !named.includes(mesh.name)) return;
      const points = mesh.geometry.attributes.position, normals = mesh.geometry.attributes.normal, uv = mesh.geometry.attributes.uv;
      let worst = 0, n = 0;
      for (let i = 0; i < points.count; i++) {
        if (Math.abs(normals.getZ(i)) < .5) continue;                       // the two elevations, not the returns
        const x = points.getX(i) + mesh.position.x, y = points.getY(i) + mesh.position.y;
        worst = Math.max(worst, Math.abs(uv.getX(i) * periodX - x), Math.abs(uv.getY(i) * periodY - y));
        n++;
      }
      uuids.add(mesh.material.uuid);
      for (const slot of ['map', 'normalMap', 'roughnessMap']) if (mesh.material[slot]) repeats.add(slot + ':' + mesh.material[slot].repeat.toArray().join(','));
      rows.push({name: mesh.name, vertices: n, worstResidualMm: +(worst * 1000).toFixed(6)});
    });
    return {periodX, periodY, materials: [...uuids].length, repeats: [...repeats], rows, height: m.height, bounds: {...m.bounds}};
  }, finish);

  // ---- PIXELS -----------------------------------------------------------------------------------------------
  // Two close-ups, one per joint, both flat on the street elevation so the two sides are lit identically and any
  // difference in the profile is the texture and nothing else.
  const pixels = await page.evaluate(([code, sabotage]) => {
    const p = window.__prefabPreview, m = p.model, b = m.bounds;
    const zR = b.back - 5.2;
    // SABOTAGE=<metres> shifts the street elevation's UVs by that much before the pixel pass, so the probe can be
    // asked to prove it still detects a bond that restarts. Half a course is 0.0314 m; run it with SABOTAGE=0.0314
    // and the measurement must FAIL. A gate nobody has ever seen fail is a gate nobody should believe.
    if (sabotage) p.root.traverse(mesh => {
      if (mesh.name !== 'house-rear') return;
      const uv = mesh.geometry.attributes.uv, {periodY} = p.facadePeriods(code);
      for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) + sabotage / periodY);
      uv.needsUpdate = true;
    });
    const grab = (cx, cy, halfHeight, distance) => {
      p.cameraTouched = true;
      p.camera.fov = 2 * Math.atan(halfHeight / distance) * 180 / Math.PI;
      p.camera.position.set(cx, cy, zR - distance);
      p.controls.target.set(cx, cy, zR);
      p.camera.lookAt(p.controls.target); p.camera.updateProjectionMatrix(); p.controls.update(); p.render();
      const canvas = p.renderer.domElement, flat = document.createElement('canvas');
      flat.width = canvas.width; flat.height = canvas.height;
      const ctx = flat.getContext('2d', {willReadFrequently: true}); ctx.drawImage(canvas, 0, 0);
      const px = ctx.getImageData(0, 0, flat.width, flat.height).data;
      // Metres per pixel: the camera looks straight at the wall, so the vertical half-extent is halfHeight.
      return {px, w: flat.width, h: flat.height, mpp: 2 * halfHeight / flat.height, cx, cy};
    };
    const lum = (img, x, y) => { const i = (y * img.w + x) * 4; return .2126 * img.px[i] + .7152 * img.px[i + 1] + .0722 * img.px[i + 2]; };
    /** Mean luminance down a 24 px wide column at world x, as a profile indexed from the top of the frame. */
    const columnAt = (img, x) => {
      const cx = Math.round(img.w / 2 + (x - img.cx) / img.mpp), out = [];
      for (let y = 0; y < img.h; y++) { let s = 0; for (let k = -12; k < 12; k++) s += lum(img, cx + k, y); out.push(s / 24); }
      return out;
    };
    // Three near-orthographic elevations, all at x = 2,20 — clear wall from the living-room window's head at 2,24
    // to the eaves at 5,80: right of the window below, right of the bedroom window above, left of the flank.
    // `wide` calibrates the coursing on 2,65 m of unbroken upper wall; `tight` carries the joint itself at four
    // times the resolution, because a correlation wants pixels per course, not metres per frame.
    const seamY = m.height - .03;
    const wide = grab(2.2, 4.20, 1.35, 4.6), tight = grab(2.2, 2.965, .82, 3.0);
    const rowOf = (img, y) => (img.cy + img.mpp * img.h / 2 - y) / img.mpp;     // world y to row index
    const column = columnAt(wide, 2.2), near2 = columnAt(tight, 2.2);
    // The vertical joint is read from two columns 60 mm either side of it, over the same world height: the head
    // joints differ from one brick to the next, but the mortar BEDS are at the same heights on both sides if the
    // coursing is continuous. Cross-correlating the two needs no pitch at all, which is the point of doing it this
    // second way — a pitch estimate is exactly what the other measurement can get wrong.
    // Kept entirely BELOW the horizontal joint (y 2,28 - 2,76) so it reads the leaf against the neighbour's wall and
    // nothing else. A taller crop straddled the other joint as well, so half of the left-hand column was the upper
    // wall — and a deliberate half-course shift of the leaf then averaged out to nothing. A measurement that can be
    // fooled by the fault next door is not a second measurement, it is the first one wearing a hat.
    const near = grab(b.right, 2.52, .24, 3.0);
    // The two windows straddling the horizontal joint are exactly ONE TILE apart (periodY = 0,88 m), so they sample
    // the SAME rows of the scan. That matters: the scan is a photograph of a real wall and its fourteen courses are
    // not perfectly evenly spaced, so two windows a random distance apart disagree by a few millimetres even when
    // the mapping is exact — measured, that bias was 7,8 mm against a budget of 8. One tile apart, the irregularity
    // is identical on both sides and cancels completely; better still, it makes the correlation peak unmistakable.
    const {periodY} = p.facadePeriods(code);
    return {seamY, seamX: b.right, column: 2.2, tile: periodY,
      calibrate: {profile: column, mpp: wide.mpp, from: rowOf(wide, 5.50), to: rowOf(wide, 2.90)},
      joint: {profile: near2, mpp: tight.mpp,
        below: [rowOf(tight, 2.75), rowOf(tight, 2.30)], above: [rowOf(tight, 2.75 + periodY), rowOf(tight, 2.30 + periodY)]},
      sideMpp: near.mpp, left: columnAt(near, b.right - .06), right: columnAt(near, b.right + .06)};
  }, [finish, Number(process.env.SABOTAGE || 0)]);

  const report = {};
  {
    const p = pixels, cal = p.calibrate, jo = p.joint;
    // What the wall's coursing actually measures, over a 2,60 m run of UNBROKEN upper wall: reported so the two
    // correlations below can be read against a half course, and as a check on preview.js's own claim that 0,88 m
    // puts the scan's fourteen courses at 63 mm.
    const run = cal.profile.slice(Math.round(cal.from), Math.round(cal.to));
    const found = dominantPitch(run, cal.mpp, .045, .095, .02);
    const courseMm = found.pitchPx * cal.mpp * 1000, coursePx = courseMm / 1000 / jo.mpp;
    // ---- the horizontal joint: the leaf below it against the wall exactly one tile above it -------------------
    const slice = ([a, b2]) => jo.profile.slice(Math.round(a), Math.round(b2));
    const below = slice(jo.below), above = slice(jo.above);
    const hit = correlate(below, above, Math.round(coursePx / 2));
    report.horizontal = {
      what: 'the leaf below the joint against the wall one tile (0,88 m) above it',
      courseMm: +courseMm.toFixed(2), courseStandsOut: found.standsOut, calibratedOverCourses: +(run.length / found.pitchPx).toFixed(1),
      coursesPerWindow: +(below.length / coursePx).toFixed(1), samples: below.length,
      offsetMm: +(Math.abs(hit.shift) * jo.mpp * 1000).toFixed(2), peak: +hit.peak.toFixed(1),
      halfCourseMm: +(courseMm / 2).toFixed(1),
    };
    // ---- the vertical joint: the mortar beds left of it against the mortar beds right of it -------------------
    // The head joints differ from one brick to the next; the mortar BEDS are at the same heights on both sides if
    // the coursing is continuous. Needs no pitch at all, which is the point of doing it this second way.
    const side = correlate(p.left, p.right, Math.round(.04 / p.sideMpp));
    report.vertical = {
      what: 'the mortar beds 60 mm left of the joint against those 60 mm right of it',
      samples: p.left.length, searchedMm: +(Math.round(.04 / p.sideMpp) * p.sideMpp * 1000).toFixed(1),
      offsetMm: +(Math.abs(side.shift) * p.sideMpp * 1000).toFixed(2), peak: +side.peak.toFixed(1),
      halfCourseMm: +(courseMm / 2).toFixed(1),
    };
  }

  const worstUv = Math.max(...analytic.rows.map(r => r.worstResidualMm));
  // A phase is only worth reading when the coursing is actually in the picture: three periods a side, and a pitch
  // that stands clear of the rest of the band. Without that the measurement would pass on noise.
  // A measurement is only worth reading when the coursing is really in the picture: five courses per window, a pitch
  // that stands clear of the rest of the band, and a correlation peak that is a peak. Without those the probe would
  // be passing on noise, which is the one failure mode a gate must never have.
  const h = report.horizontal, v = report.vertical;
  const enough = h.coursesPerWindow >= 5 && h.courseStandsOut >= 1.5 && h.courseMm > 55 && h.courseMm < 72
    && h.peak > 1 && h.samples > 200 && v.samples > 200 && v.peak > 1;
  const phasesOk = h.offsetMm < BUDGET.phaseMm && v.offsetMm < BUDGET.phaseMm;
  const ok = analytic.materials === 1 && analytic.repeats.every(r => r.endsWith(':1,1')) && worstUv < BUDGET.uvResidualMm && enough && phasesOk;
  const result = {finish, budget: BUDGET, analytic: {...analytic, worstResidualMm: worstUv}, seam: report, passed: ok};
  console.log(JSON.stringify(result, null, 1));
  if (process.env.OUT) await writeFile(process.env.OUT, JSON.stringify(result, null, 1));
  console.log(ok ? `PASS one material, one metric origin, and the coursing crosses both joints within ${BUDGET.phaseMm} mm`
                 : 'FAIL the street elevation does not continue the coursing of the wall it joins');
  process.exitCode = ok ? 0 : 1;
} finally { await browser.close(); server.kill(); }
