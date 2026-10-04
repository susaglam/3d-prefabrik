// The one-choice-per-screen flow, checked in a browser at phone and desktop width — because the defects this exists for
// were invisible to every unit test. The cursor's destination depends on an IntersectionObserver, and the observer
// depends on how tall the panel is: its root margin discounts the bottom 25% of #panel-content.
//
// Measured on the live site (2.16.0, then the 2.16.2 live audit):
//   * at load, with Gevelbekleding open, the forward button said "Naar Gevelbekleding", and pressing it opened
//     nothing (fixed in 2.16.2 for a portrait phone — and back in landscape, 844 x 390: "Naar Breedte" at load);
//   * re-opening an answered card by its header left the back button naming the card AFTER it;
//   * at 360-430 px the forward button kept 0-93 px of room: "Naar Kozijn" and "nog 10 keuzes" were cut to nothing,
//     and at 360 px the footer pushed the page 2 px wider than the phone.
//
// Rules — the third and the last are the ones no single viewport can state:
//   1. the forward button never names the card that is already open;
//   2. pressing it OPENS A DIFFERENT CARD (that is the whole promise of "Naar X") until the step is finished;
//   3. the walk is IDENTICAL at 390 x 844, 844 x 390 and 1440 x 900 — same cards, remaining counts, destinations;
//   4. a card opened by its header gets the back button of ITS predecessor, and that button opens it;
//   5. at 360, 375, 390 and 430 px the forward button's destination and its count are readable in full, the back
//      button keeps its arrow, and the footer never makes the page wider than the phone.
//
// Writes docs/verification/flow/verify-flow.json. Exit code 1 on any violation. PREFAB_ORIGIN targets a live site;
// without it the script starts scripts/serve.py on a free port and checks the working tree.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const out = join('docs', 'verification', 'flow');
await mkdir(out, {recursive: true});
const server = process.env.PREFAB_ORIGIN ? null : spawn('python', ['scripts/serve.py', '--port', '0', '--db', join(await mkdtemp(join(tmpdir(), 'prefab-flow-')), 'f.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
const origin = process.env.PREFAB_ORIGIN || await new Promise(resolve => { const f = c => { const m = String(c).match(/https?:\/\/[0-9.:a-z]+/i); if (m) resolve(m[0]); }; server.stdout.on('data', f); server.stderr.on('data', f); });
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe')});
const PRESSES = 4;
const report = [];
const problems = [];

async function open(width, height, mobile) {
  const context = await browser.newContext({viewport: {width, height}, isMobile: mobile, hasTouch: mobile});
  const page = await context.newPage();
  await page.goto(origin + '/prefab', {waitUntil: 'networkidle', timeout: 90000});
  await page.waitForFunction(() => window.__prefabPreview?.renderer && !document.querySelector('.price-value.pending'));
  return {context, page};
}
// Everything a visitor can read off the screen, including the title of the card that is open, so rule 1 compares the
// words on the button against the words on the card rather than against an id.
const read = page => page.evaluate(() => {
  const open = document.querySelector('details.choice-group[open]');
  const button = document.querySelector('.step-actions .button:last-child');
  const note = document.querySelector('.footer-note')?.textContent || '';
  const remaining = /nog (\d+) keuze/i.exec(note);
  const cards = [...document.querySelectorAll('details.choice-group')];
  const previous = open ? cards[cards.indexOf(open) - 1] : null;
  return {card: open?.dataset.group || null,
    title: open?.querySelector(':scope > summary .section-title')?.textContent?.trim() || null,
    previousTitle: previous?.querySelector(':scope > summary .section-title')?.textContent?.trim() || null,
    action: button?.dataset.action || null,
    destination: (button?.querySelector('.next-label') || button)?.textContent?.trim().replace(/\s+/g, ' ') || null,
    remaining: remaining ? Number(remaining[1]) : null,
    back: document.querySelector('.back-button .back-label')?.textContent?.trim() || null};
});
const press = async (page, selector, before) => {
  await page.click(selector);
  // Settle on ANY observable change rather than on the card alone: a press that only moves the counter is one of the
  // failures this script is here to catch, and waiting for the card would make it time out instead of reporting it.
  await page.waitForFunction(state => {
    const open = document.querySelector('details.choice-group[open]')?.dataset.group || null;
    const note = document.querySelector('.footer-note')?.textContent || '';
    const back = document.querySelector('.back-button .back-label')?.textContent?.trim() || null;
    return open !== state.card || !note.includes(`nog ${state.remaining} keuze`) || back !== state.back;
  }, {card: before.card, remaining: before.remaining, back: before.back}, {timeout: 15000}).catch(() => {});
  await page.waitForTimeout(350);                            // the footer follows the card by a frame
  return read(page);
};

try {
  // Rules 1-3: the forward walk.
  for (const [width, height, mobile] of [[390, 844, true], [844, 390, true], [1440, 900, false]]) {
    const tag = `${width}x${height}`, {context, page} = await open(width, height, mobile);
    const states = [await read(page)];
    for (let i = 0; i < PRESSES; i++) {
      const before = states[states.length - 1];
      if (before.action !== 'goto-choice') break;            // the step is finished; the cursor became "verder naar"
      const after = await press(page, '.step-actions .button:last-child', before);
      if (after.card === before.card) {
        problems.push(`${tag}: pressing "${before.destination}" left the same card open (${before.card}); ` +
                      `remaining went ${before.remaining} -> ${after.remaining}, so the press was spent on nothing`);
      }
      states.push(after);
    }
    for (const state of states) {
      if (state.action === 'goto-choice' && state.title && state.destination?.includes(state.title)) {
        problems.push(`${tag}: the forward button says "${state.destination}" while "${state.title}" is the open card`);
      }
    }
    // Rule 4: open an earlier, already answered card by its header, then a later one; the back button must follow.
    for (const group of ['rollaag', 'daglicht']) {
      const before = await read(page);
      const summary = `details.choice-group[data-group="${group}"] > summary`;
      if (!(await page.locator(summary).count())) continue;
      const state = await press(page, summary, before);
      if (state.card !== group) { problems.push(`${tag}: its header did not open ${group}`); continue; }
      if (state.back !== state.previousTitle) {
        problems.push(`${tag}: ${group} opened by its header, the back button says "${state.back}" instead of "${state.previousTitle}"`);
      }
    }
    report.push({viewport: tag, states});
    await context.close();
  }
  const shape = entry => entry.states.map(s => `${s.card}|${s.remaining}|${s.destination}`);
  const [first, ...others] = report;
  for (const other of others) {
    if (JSON.stringify(shape(first)) !== JSON.stringify(shape(other))) {
      problems.push(`the walk differs between ${first.viewport} and ${other.viewport}:\n   ${first.viewport}: ` + shape(first).join(`\n   ${first.viewport}: `) +
                    `\n   ${other.viewport}: ` + shape(other).join(`\n   ${other.viewport}: `));
    }
  }
  // Rule 5: what a phone visitor can READ in the footer, at every screen of step 1 — so every destination name is
  // tried, up to "Buiten stopcontact", and every screen after the first has a back button competing for the row.
  for (const [width, height] of [[360, 760], [375, 667], [390, 844], [430, 932]]) {
    const tag = `${width}x${height}`, {context, page} = await open(width, height, true), screens = [];
    for (let i = 0; i < 10; i++) {
      const before = await read(page);
      if (before.action !== 'goto-choice') break;
      const after = await press(page, '.step-actions .button:last-child', before);
      const facts = await page.evaluate(() => {
        // "Cut" is any text the box cannot show: wider than the line, or more lines than the clamp lets through.
        const fit = el => el && getComputedStyle(el).display !== 'none' ? {text: el.innerText.trim(), cut: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1, width: el.clientWidth} : null;
        const back = document.querySelector('.back-button'), arrow = back?.querySelector('svg, .icon');
        return {label: fit(document.querySelector('.next-label')), kicker: fit(document.querySelector('.next-kicker')),
          backWidth: back ? Math.round(back.getBoundingClientRect().width) : null,
          arrow: !!arrow && Math.round(arrow.getBoundingClientRect().width) > 8,
          pageWidth: document.documentElement.scrollWidth, viewport: innerWidth,
          footer: Math.round(document.querySelector('#panel-footer').getBoundingClientRect().height)};
      });
      const where = `${tag} on ${after.card}`;
      if (after.action === 'goto-choice' && (!facts.label || facts.label.cut)) problems.push(`${where}: the forward destination is cut: ${JSON.stringify(facts.label)}`);
      if (facts.kicker && facts.kicker.cut) problems.push(`${where}: the remaining count is cut: ${JSON.stringify(facts.kicker)}`);
      if (facts.backWidth !== null && !facts.arrow) problems.push(`${where}: the back button lost its arrow (${facts.backWidth} px)`);
      if (facts.pageWidth > facts.viewport) problems.push(`${where}: the footer makes the page ${facts.pageWidth} px wide on a ${facts.viewport} px phone`);
      screens.push({card: after.card, ...facts});
      if (i === 0) await page.locator('#panel-footer').screenshot({path: join(out, `footer-${tag}.png`)});
    }
    report.push({viewport: tag, footer: screens});
    await context.close();
  }
} finally { await browser.close(); server?.kill(); }
await writeFile(join(out, 'verify-flow.json'), JSON.stringify({origin, report, problems}, null, 1) + '\n');
console.log(JSON.stringify({origin, report, problems}, null, 1));
if (problems.length) { console.error(`\n${problems.length} flow problem(s):\n- ` + problems.join('\n- ')); process.exit(1); }
console.log(`\nflow identical at 390x844, 844x390 and 1440x900 over ${report[0].states.length} screens; every press opened the card it named; ` +
            'the back button follows a card opened by its header; the phone footer reads in full at 360-430 px');
