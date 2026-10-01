// Browser proof of the cursor (footer button walks the visitor to the next choice): at 390 and 1440 px, press the
// primary button until it says "Verder naar …", and record what every press did — label before, label after, where
// the panel scrolled, which element took focus, the footer note. Fails on: a press that moves nothing, a label that
// repeats forever, a "Volgende sectie" row still in the DOM, a console error, or a step that never finishes.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const out = join('docs', 'verification', 'navigation');
await mkdir(out, {recursive: true});
const temporary = await mkdtemp(join(tmpdir(), 'prefab-nav-'));
const server = spawn(process.platform === 'win32' ? 'python' : 'python3', ['scripts/serve.py', '--port', '0', '--db', join(temporary, 'qa.sqlite3')],
  {stdio: ['ignore', 'pipe', 'pipe']});
const origin = await new Promise((resolve, reject) => {
  let stdout = '';
  const timer = setTimeout(() => reject(new Error('Local server start timed out')), 15000);
  server.stdout.on('data', chunk => { stdout += chunk; const m = stdout.match(/running at (http:\/\/[^\s]+)\/prefab/); if (m) { clearTimeout(timer); resolve(m[1]); } });
  server.once('exit', code => reject(new Error('Server exited ' + code)));
});
const executable = join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe');
const browser = await chromium.launch({headless: true, executablePath: executable});
const report = {origin, runs: []};
let failed = false;
const fail = (run, message) => { failed = true; run.failures.push(message); };
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({viewport: {width, height: width === 390 ? 844 : 960}, deviceScaleFactor: 1});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(origin + '/prefab', {waitUntil: 'networkidle', timeout: 90000});
    await page.waitForSelector('#panel-footer .next-button', {timeout: 60000});
    await page.waitForTimeout(800);
    const run = {width, steps: [], failures: []};
    const state = () => page.evaluate(() => {
      const button = document.querySelector('#panel-footer .next-button');
      const panel = document.querySelector('#panel-content');
      const active = document.activeElement;
      return {label: button?.querySelector('.next-label')?.textContent?.trim() || button?.textContent?.trim(),
        action: button?.dataset.action, choice: button?.dataset.choice || null,
        note: document.querySelector('#panel-footer .footer-note')?.textContent?.trim(),
        scroll: Math.round(panel?.scrollTop || 0),
        focus: active?.dataset?.field || active?.dataset?.dimension || (active?.closest?.('[data-group]')?.dataset.group ? 'section:' + active.closest('[data-group]').dataset.group : active?.tagName),
        step: document.querySelector('[aria-selected="true"], .step-tab.active, [aria-current="step"]')?.textContent?.trim()?.slice(0, 40) || null,
        volgendeSectie: document.body.innerText.includes('Volgende sectie')};
    });
    for (let stepIndex = 0; stepIndex < 3; stepIndex++) {
      const presses = [];
      for (let press = 0; press < 40; press++) {
        const before = await state();
        if (before.volgendeSectie) fail(run, 'a "Volgende sectie" row is still in the DOM');
        if (before.action !== 'goto-choice') { presses.push({final: before}); break; }
        await page.click('#panel-footer .next-button');
        await page.waitForTimeout(650);  // tween (≤260 ms) + dwell (300 ms) + slack
        const after = await state();
        presses.push({from: before.label, note: before.note, to: after.label, scroll: [before.scroll, after.scroll], focus: after.focus});
        if (after.scroll === before.scroll && after.focus === before.focus && after.label === before.label)
          fail(run, `step ${stepIndex + 1}: pressing "${before.label}" moved nothing`);
        if (press === 39) fail(run, `step ${stepIndex + 1}: the button never reached "Verder naar"`);
      }
      const last = presses.at(-1)?.final;
      run.steps.push({step: stepIndex + 1, presses: presses.length - 1, labels: presses.filter(p => p.from).map(p => p.from), final: last?.label, note: last?.note});
      await page.screenshot({path: join(out, `step${stepIndex + 1}-${width}.png`)});
      if (!last || !/^Verder naar/.test(last.label || '')) { fail(run, `step ${stepIndex + 1} did not end on "Verder naar …" (${last?.label})`); break; }
      await page.click('#panel-footer .next-button');  // the real step change
      await page.waitForTimeout(900);
    }
    if (errors.length) fail(run, 'console errors: ' + errors.slice(0, 5).join(' | '));
    run.errors = errors.slice(0, 10);
    report.runs.push(run);
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
}
await writeFile(join(out, 'navigation-results.json'), JSON.stringify(report, null, 1) + '\n');
for (const run of report.runs) {
  console.log(`${run.width}px`);
  for (const step of run.steps) console.log(`  stap ${step.step}: ${step.presses} presses -> "${step.final}" | ${step.note}\n    ${step.labels.join(' > ')}`);
  for (const failure of run.failures) console.log('  FAIL ' + failure);
}
process.exit(failed ? 1 : 0);
