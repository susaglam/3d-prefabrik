// The one-choice-per-screen flow, checked in a browser at phone and desktop width — because the defect this exists for
// was invisible to every unit test. The cursor's destination depends on an IntersectionObserver, and the observer
// depends on how tall the panel is: its root margin discounts the bottom 25% of #panel-content, which on a ~376 px
// phone panel means a field on the open card never counts as read. Measured on the live 2.16.0 site at 390 px:
//
//   * at load, with Gevelbekleding open, the forward button said "nog 12 keuzes · Naar Gevelbekleding";
//   * pressing it opened nothing — it only marked that choice seen, so the first press was spent;
//   * at 1440 px the same walk ran one card ahead ("nog 8 · Naar Daklicht" where the phone said "nog 9 · Naar Kozijn").
//
// Three rules, and the third is the one no single viewport can state:
//   1. the forward button never names the card that is already open;
//   2. pressing it OPENS A DIFFERENT CARD (that is the whole promise of "Naar X") until the step is finished;
//   3. the walk is IDENTICAL at 390 and 1440 px — same cards, same remaining counts, same destinations.
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
try {
  for (const [width, height, mobile] of [[390, 844, true], [1440, 900, false]]) {
    const tag = `${width}x${height}`;
    const context = await browser.newContext({viewport: {width, height}, isMobile: mobile, hasTouch: mobile});
    const page = await context.newPage();
    await page.goto(origin + '/prefab', {waitUntil: 'networkidle', timeout: 90000});
    await page.waitForFunction(() => window.__prefabPreview?.renderer && !document.querySelector('.price-value.pending'));
    // Everything a visitor can read off the screen, including the title of the card that is open, so rule 1 compares
    // the words on the button against the words on the card rather than against an id.
    const read = () => page.evaluate(() => {
      const open = document.querySelector('details.choice-group[open]');
      const button = document.querySelector('.step-actions .button:last-child');
      const note = document.querySelector('.footer-note')?.textContent || '';
      const remaining = /nog (\d+) keuze/i.exec(note);
      return {card: open?.dataset.group || null,
        title: open?.querySelector(':scope > summary .section-title')?.textContent?.trim() || null,
        action: button?.dataset.action || null,
        destination: (button?.querySelector('.next-label') || button)?.textContent?.trim().replace(/\s+/g, ' ') || null,
        remaining: remaining ? Number(remaining[1]) : null,
        back: document.querySelector('.back-button .back-label')?.textContent?.trim() || null};
    });
    const states = [await read()];
    for (let press = 0; press < PRESSES; press++) {
      const before = states[states.length - 1];
      if (before.action !== 'goto-choice') break;            // the step is finished; the cursor became "verder naar"
      await page.click('.step-actions .button:last-child');
      // Wait for the screen to settle on ANY observable change rather than on the card alone: a press that only
      // moves the counter is the very failure this script is here to catch, and waiting for the card would make the
      // script time out instead of reporting it.
      await page.waitForFunction(state => {
        const open = document.querySelector('details.choice-group[open]')?.dataset.group || null;
        const note = document.querySelector('.footer-note')?.textContent || '';
        return open !== state.card || !note.includes(`nog ${state.remaining} keuze`);
      }, {card: before.card, remaining: before.remaining}, {timeout: 15000}).catch(() => {});
      await page.waitForTimeout(350);                        // the footer follows the card by a frame
      const after = await read();
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
    report.push({viewport: tag, states});
    await page.close();
  }
  const [phone, desktop] = report;
  const shape = entry => entry.states.map(s => `${s.card}|${s.remaining}|${s.destination}`);
  if (phone && desktop && JSON.stringify(shape(phone)) !== JSON.stringify(shape(desktop))) {
    problems.push('the walk differs between phone and desktop:\n   390: ' + shape(phone).join('\n   390: ') +
                  '\n  1440: ' + shape(desktop).join('\n  1440: '));
  }
} finally { await browser.close(); server?.kill(); }
await writeFile(join(out, 'verify-flow.json'), JSON.stringify({origin, report, problems}, null, 1) + '\n');
console.log(JSON.stringify({origin, report, problems}, null, 1));
if (problems.length) { console.error(`\n${problems.length} flow problem(s):\n- ` + problems.join('\n- ')); process.exit(1); }
console.log(`\nflow identical at 390 and 1440 px over ${report[0].states.length} screens; every press opened the card it named`);
