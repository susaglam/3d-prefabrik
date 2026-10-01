// Browser proof that the visitor cannot take the 3D camera below the ground, with the REAL OrbitControls and real
// mouse gestures: a hard downward orbit, a right-button pan dragged far downward, and the same in the interior view.
// After every gesture the camera's eye and orbit point are read from window.__prefabPreview.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const out = join('docs', 'verification', 'camera-floor');
await mkdir(out, {recursive: true});
const temporary = await mkdtemp(join(tmpdir(), 'prefab-camera-'));
const server = spawn(process.platform === 'win32' ? 'python' : 'python3', ['scripts/serve.py', '--port', '0', '--db', join(temporary, 'qa.sqlite3')],
  {stdio: ['ignore', 'pipe', 'pipe']});
const origin = await new Promise((resolve, reject) => {
  let stdout = '';
  const timer = setTimeout(() => reject(new Error('Local server start timed out')), 15000);
  server.stdout.on('data', chunk => { stdout += chunk; const m = stdout.match(/running at (http:\/\/[^\s]+)\/prefab/); if (m) { clearTimeout(timer); resolve(m[1]); } });
  server.once('exit', code => reject(new Error('Server exited ' + code)));
});
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'),
  args: ['--enable-gpu', '--ignore-gpu-blocklist']});
const rows = [];
let failed = false;
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 960}});
  await page.goto(origin + '/prefab', {waitUntil: 'networkidle', timeout: 90000});
  await page.waitForFunction(() => window.__prefabPreview?.camera, null, {timeout: 60000});
  const canvas = await page.$('canvas');
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const read = () => page.evaluate(() => {
    const p = window.__prefabPreview;
    return {eye: +p.camera.position.y.toFixed(3), target: +p.controls.target.y.toFixed(3), view: p.view};
  });
  const drag = async (button, dx, dy) => {
    await page.mouse.move(cx, cy); await page.mouse.down({button});
    for (let i = 1; i <= 12; i++) await page.mouse.move(cx + dx * i / 12, cy + dy * i / 12);
    await page.mouse.up({button}); await page.waitForTimeout(150);
  };
  const gestures = [['orbit hard downward', 'left', 0, -900], ['pan far downward', 'right', 0, 900],
    ['pan far UPWARD (target down)', 'right', 0, -900], ['pan upward again', 'right', 0, -900], ['pan upward a third time', 'right', 0, -900], ['orbit + pan diagonal', 'left', 300, -700]];
  for (const view of ['perspective', 'interior']) {
    await page.evaluate(v => window.__prefabPreview.setView(v), view);
    await page.waitForTimeout(400);
    for (const [label, button, dx, dy] of gestures) {
      await drag(button, dx, dy);
      const state = await read();
      const ok = state.eye >= .25 - 1e-6 && state.target >= -1e-6;
      if (!ok) failed = true;
      rows.push({view, gesture: label, ...state, ok});
    }
    for (let i = 0; i < 8; i++) { await page.mouse.move(cx, cy); await page.mouse.wheel(0, 600); }
    await page.waitForTimeout(200);
    const zoomed = await read();
    rows.push({view, gesture: 'zoom out', ...zoomed, ok: zoomed.eye >= .25 - 1e-6});
    if (zoomed.eye < .25 - 1e-6) failed = true;
    await page.screenshot({path: join(out, `after-gestures-${view}.png`)});
  }
} finally {
  await browser.close();
  server.kill();
}
await writeFile(join(out, 'camera-floor-results.json'), JSON.stringify(rows, null, 1) + '\n');
for (const row of rows) console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${row.view.padEnd(12)} ${row.gesture.padEnd(30)} eye=${row.eye} target=${row.target}`);
process.exit(failed ? 1 : 0);
