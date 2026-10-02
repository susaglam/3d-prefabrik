// Height budget of the configurator: how many pixels each fixed part takes and how much is left for the form
// (#panel-content), at phone and desktop sizes. Also opens the "Spotposities overstek" counter and presses + twice
// to record whether the scope note under it survives the price round trip (it used to vanish and return).
// Writes docs/verification/form-space/form-space.json; prints a table. Run before and after a layout change.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const out = join('docs', 'verification', 'form-space');
await mkdir(out, {recursive: true});
const server = process.env.PREFAB_ORIGIN ? null : spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(await mkdtemp(join(tmpdir(), 'prefab-space-')), 's.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const origin = process.env.PREFAB_ORIGIN || await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe')});
const rows = [];
try {
  for (const [width, height, mobile] of [[360, 800, true], [390, 844, true], [1440, 900, false]]) {
    const context = await browser.newContext({viewport: {width, height}, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1});
    const page = await context.newPage();
    // A design with an overhang and two spots under it, so the "Spotposities overstek" counter and its note exist.
    await page.addInitScript(() => { try { localStorage.setItem('cs-prefab-design-v1', JSON.stringify({config: {overhang: 'pvc-anthracite', overhangSpots: 2}})); } catch { /* storage may be off */ } });
    await page.goto(origin + '/prefab', {waitUntil: 'networkidle', timeout: 90000});
    await page.waitForFunction(() => window.__prefabPreview?.renderer && !document.querySelector('.price-value.pending'));
    const box = selector => page.evaluate(s => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return Math.round(r.height); }, selector);
    const row = {viewport: `${width}×${height}`, header: await box('.site-header'), preview: await box('.preview-card'), tabs: await box('.steps'),
      footer: await box('#panel-footer'), priceRow: await box('.price-peek'), button: await box('.step-actions'), note: await box('.footer-note'), form: await box('#panel-content')};
    row.formShare = Math.round(row.form / height * 100) + '%';
    // A count field with its scope note: open the card that HOLDS the counter, then press + and watch the note.
    // 2.16.0 put one choice per card, so the overhang counter moved out of a "roof" section into its own `overstek`
    // card. The card is found from the control upwards instead of by name, so the next regrouping cannot silently
    // hide the control again — a hidden control made this script fail with a click timeout, not with a measurement.
    await page.evaluate(() => {
      const control = document.querySelector('[data-count="overhangSpots"][data-delta="1"]');
      const closed = [];
      for (let node = control?.parentElement; node; node = node.parentElement) {
        if (node.tagName === 'DETAILS' && !node.open) closed.unshift(node);
      }
      for (const card of closed) card.querySelector(':scope > summary')?.click();  // outermost first
    });
    await page.waitForTimeout(300);
    const counter = page.locator('[data-count="overhangSpots"][data-delta="1"]');
    if (await counter.count()) {
      await counter.scrollIntoViewIfNeeded();
      await counter.click(); await page.waitForFunction(() => !document.querySelector('.price-value.pending'));
      const field = '[data-field="overhangSpots"]';
      row.countField = await box(field);
      row.scopeNote = await box(field + ' .field-scope');
      // Sample the note on every animation frame across one + press and the price round trip that follows it.
      row.noteState = await page.evaluate(f => document.querySelector(f + ' .field-scope')?.dataset.state || null, field);
      // Frames in which the note was missing, and how many different heights the field had, across one + press.
      row.noteVanished = await page.evaluate(async f => {
        const seen = [], heights = new Set(), priceSizes = new Set(); let running = true;
        const tick = () => { seen.push(!!document.querySelector(f + ' .field-scope')); heights.add(Math.round(document.querySelector(f).getBoundingClientRect().height));
          priceSizes.add(getComputedStyle(document.querySelector('.price-value')).fontSize); if (running) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        document.querySelector('[data-count="overhangSpots"][data-delta="1"]').click();
        await new Promise(r => setTimeout(r, 120));
        while (document.querySelector('.price-value.pending')) await new Promise(r => setTimeout(r, 30));
        await new Promise(r => setTimeout(r, 120)); running = false;
        return {missingFrames: seen.filter(x => !x).length, frames: seen.length, fieldHeights: [...heights].join('/'), priceSizes: [...priceSizes].join('/')};
      }, field);
      // The note closed and opened, for the eye: one line, then its explanation.
      const tag = `${width}x${height}`;
      await page.locator(field).screenshot({path: join(out, `note-closed-${tag}.png`)});
      await page.locator(field + ' .field-scope > summary').click();
      await page.locator(field).screenshot({path: join(out, `note-open-${tag}.png`)});
    }
    // Working in the form (2.10.9): scrolled down and at rest, a phone's preview snaps to its compact height and the
    // content under the finger must not move; back at the top it returns. The anchor is the first block whose top
    // is inside the form area just before the snap.
    row.working = await page.evaluate(async () => {
      const panel = document.querySelector('#panel-content'), card = document.querySelector('.preview-card'), wait = ms => new Promise(r => setTimeout(r, ms));
      panel.scrollTop = 0; await wait(450);
      // 2.11.0: a redraw or the "Naar …" button scrolls the form without anybody touching it — that must NOT shrink
      // the preview ("ekranı küçültme formdaki tıklamalarda").
      panel.scrollTop = 460; await wait(500);
      const programmatic = card.classList.contains('is-compact');
      panel.scrollTop = 0; await wait(450);
      // A real gesture does: a wheel turn here, a finger drag on a phone.
      panel.dispatchEvent(new WheelEvent('wheel', {deltaY: 460, bubbles: true}));
      panel.scrollTop = 460; await wait(40);
      const top = panel.getBoundingClientRect().top;
      const anchor = [...panel.querySelectorAll('.field-block,.dimension-field,details.section-card > summary')].find(el => el.getBoundingClientRect().top >= top);
      const before = anchor?.getBoundingClientRect().top ?? 0;
      await wait(500);
      const shot = {compact: card.classList.contains('is-compact'), preview: Math.round(card.getBoundingClientRect().height),
        form: Math.round(panel.getBoundingClientRect().height), anchorShift: Math.round((anchor?.getBoundingClientRect().top ?? 0) - before)};
      panel.scrollTop = 0; await wait(500);
      shot.expandedAtTop = !card.classList.contains('is-compact');
      shot.programmaticCompact = programmatic;
      return shot;
    });
    if (row.working.compact) {
      await page.evaluate(() => { const panel = document.querySelector('#panel-content'); panel.dispatchEvent(new WheelEvent('wheel', {deltaY: 460, bubbles: true})); panel.scrollTop = 460; });
      await page.waitForTimeout(600);
      await page.screenshot({path: join(out, `working-${width}x${height}.png`)});
      await page.evaluate(() => { document.querySelector('#panel-content').scrollTop = 0; });
      await page.waitForTimeout(500);
    }
    await page.screenshot({path: join(out, `rest-${width}x${height}.png`)});
    rows.push(row);
    await context.close();
  }
} finally { await browser.close(); server?.kill(); }
await writeFile(join(out, 'form-space.json'), JSON.stringify(rows, null, 1) + '\n');
// Plain ASCII under --assert: the release runner prints this through a cp1252 Windows console, and console.table's
// box-drawing characters made that print crash after a passing proof (2.10.8).
const flat = r => ({...r, working: undefined, noteVanished: undefined, compactForm: r.working?.compact ? r.working.form : null, anchorShift: r.working?.anchorShift,
  missingFrames: r.noteVanished?.missingFrames, fieldHeights: r.noteVanished?.fieldHeights, priceSizes: r.noteVanished?.priceSizes});
if (process.argv.includes('--assert')) for (const r of rows.map(flat)) console.log(`${r.viewport.replace('×', 'x')}  form ${r.form}px (${r.formShare})  working ${r.compactForm ?? '-'}px  shift ${r.anchorShift}  note ${r.noteState}  missing ${r.missingFrames}  heights ${r.fieldHeights}  price ${r.priceSizes}`);
else console.table(rows.map(flat));
// --assert, the release gate: the note never vanishes during a + press, the field keeps one height, the price keeps
// one size (2.10.9), and on a tall phone the preview snaps compact without moving the content and returns at the top.
if (process.argv.includes('--assert')) {
  const problems = [];
  for (const r of rows) {
    const v = r.noteVanished, w = r.working, phone = parseInt(r.viewport) <= 800 && parseInt(r.viewport.split('×')[1]) >= 780;
    if (!v || v.missingFrames > 0 || String(v.fieldHeights).includes('/')) problems.push(`${r.viewport} note ${JSON.stringify(v ?? 'no count field')}`);
    if (v && String(v.priceSizes).includes('/')) problems.push(`${r.viewport} price size changes: ${v.priceSizes}`);
    if (phone && !(w?.compact && !w.programmaticCompact && Math.abs(w.anchorShift) <= 2 && w.expandedAtTop)) problems.push(`${r.viewport} compact preview ${JSON.stringify(w)}`);
    if (!phone && w?.compact) problems.push(`${r.viewport} compact preview outside a phone`);
  }
  for (const line of problems) console.log('FAIL', line);
  process.exit(problems.length ? 1 : 0);
}
